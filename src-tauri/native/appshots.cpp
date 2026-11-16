#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <UIAutomation.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wincodec.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <atomic>
#include <algorithm>
#include <cstring>
#include <cwchar>
#include <filesystem>
#include <memory>
#include <string>
#include "appshots.h"

using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
static_assert(sizeof(CodexAppshotResult) == 28 && alignof(CodexAppshotResult) == 4);

namespace {
constexpr uint32_t target_changed = 2, frame_timeout = 4, capture_failed = 6, output_failed = 7;
// Local worker resource limits, not official Codex limits. A BGRA texture is at
// most 128 MiB; the frame pool can retain two such frames. Runtime testing remains required.
constexpr uint32_t maximum_edge = 16384;
constexpr uint64_t maximum_pixels = 33554432;
bool valid_size(uint32_t width, uint32_t height) {
    return width && height && width <= maximum_edge && height <= maximum_edge
        && static_cast<uint64_t>(width) * height <= maximum_pixels;
}
struct Failure { uint32_t code; HRESULT hr; };
struct Handle {
    HANDLE value = nullptr;
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};
struct Bstr {
    BSTR value = nullptr;
    ~Bstr() { SysFreeString(value); }
};
uint64_t filetime_value(FILETIME time) {
    return (static_cast<uint64_t>(time.dwHighDateTime) << 32) | time.dwLowDateTime;
}
struct Target {
    HWND window;
    DWORD pid;
    uint64_t creation;
    Handle process;
    std::shared_ptr<std::atomic<bool>> closed = std::make_shared<std::atomic<bool>>(false);
    bool valid() const {
        if (closed->load() || !IsWindow(window) ||
            WaitForSingleObject(process.value, 0) != WAIT_TIMEOUT) return false;
        DWORD actual_pid = 0;
        GetWindowThreadProcessId(window, &actual_pid);
        FILETIME start{}, end{}, kernel{}, user{};
        return actual_pid == pid && GetProcessTimes(process.value, &start, &end, &kernel, &user)
            && filetime_value(start) == creation;
    }
    void check() const { if (!valid()) throw Failure{target_changed, HRESULT_FROM_WIN32(ERROR_INVALID_WINDOW_HANDLE)}; }
};
struct CaptureScope {
    GraphicsCaptureItem item{nullptr};
    Direct3D11CaptureFramePool pool{nullptr};
    GraphicsCaptureSession session{nullptr};
    event_token frame_token{}, closed_token{};
    bool frames_subscribed = false, closed_subscribed = false;
    ~CaptureScope() {
        try { if (pool && frames_subscribed) pool.FrameArrived(frame_token); } catch (...) {}
        try { if (item && closed_subscribed) item.Closed(closed_token); } catch (...) {}
        try { if (session) session.Close(); } catch (...) {}
        try { if (pool) pool.Close(); } catch (...) {}
    }
};
struct Output {
    Handle file;
    bool committed = false;
    ~Output() {
        if (!committed && file.value && file.value != INVALID_HANDLE_VALUE) {
            FILE_DISPOSITION_INFO disposition{TRUE};
            SetFileInformationByHandle(file.value, FileDispositionInfo, &disposition, sizeof(disposition));
        }
    }
};

com_ptr<IStream> encode_png(ID3D11Device* device, ID3D11DeviceContext* context,
    ID3D11Texture2D* texture, uint32_t width, uint32_t height) {
    D3D11_TEXTURE2D_DESC description{};
    texture->GetDesc(&description);
    if (!valid_size(width, height) || !valid_size(description.Width, description.Height) ||
        description.Width < width || description.Height < height ||
        description.Format != DXGI_FORMAT_B8G8R8A8_UNORM)
        throw Failure{capture_failed, E_INVALIDARG};
    description.Usage = D3D11_USAGE_STAGING;
    description.BindFlags = 0;
    description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    description.MiscFlags = 0;
    com_ptr<ID3D11Texture2D> staging;
    check_hresult(device->CreateTexture2D(&description, nullptr, staging.put()));
    context->CopyResource(staging.get(), texture);
    D3D11_MAPPED_SUBRESOURCE mapped{};
    check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
    struct Unmap {
        ID3D11DeviceContext* context; ID3D11Texture2D* texture;
        ~Unmap() { context->Unmap(texture, 0); }
    } unmap{context, staging.get()};
    const uint64_t mapped_bytes = static_cast<uint64_t>(mapped.RowPitch) * height;
    if (mapped_bytes > UINT32_MAX) throw Failure{capture_failed, E_INVALIDARG};
    com_ptr<IWICImagingFactory> factory;
    check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
        __uuidof(IWICImagingFactory), factory.put_void()));
    com_ptr<IStream> stream;
    check_hresult(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()));
    com_ptr<IWICBitmapEncoder> encoder;
    check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
    check_hresult(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache));
    com_ptr<IWICBitmapFrameEncode> frame;
    check_hresult(encoder->CreateNewFrame(frame.put(), nullptr));
    check_hresult(frame->Initialize(nullptr));
    check_hresult(frame->SetSize(width, height));
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    check_hresult(frame->SetPixelFormat(&format));
    if (!IsEqualGUID(format, GUID_WICPixelFormat32bppBGRA)) throw Failure{capture_failed, E_UNEXPECTED};
    check_hresult(frame->WritePixels(height, mapped.RowPitch, static_cast<UINT>(mapped_bytes),
        static_cast<BYTE*>(mapped.pData)));
    check_hresult(frame->Commit());
    check_hresult(encoder->Commit());
    return stream;
}

void write_new_png(IStream* stream, const wchar_t* path, Output& output) {
    STATSTG information{};
    check_hresult(stream->Stat(&information, STATFLAG_NONAME));
    if (!information.cbSize.QuadPart || information.cbSize.QuadPart > 25ULL * 1024 * 1024)
        throw Failure{output_failed, HRESULT_FROM_WIN32(ERROR_FILE_TOO_LARGE)};
    output.file.value = CreateFileW(path, GENERIC_WRITE | DELETE, 0, nullptr,
        CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (output.file.value == INVALID_HANDLE_VALUE) throw Failure{output_failed, HRESULT_FROM_WIN32(GetLastError())};
    LARGE_INTEGER beginning{};
    check_hresult(stream->Seek(beginning, STREAM_SEEK_SET, nullptr));
    char buffer[16384];
    uint64_t remaining = information.cbSize.QuadPart;
    while (remaining) {
        ULONG read = 0;
        check_hresult(stream->Read(buffer, static_cast<ULONG>((std::min)(remaining,
            static_cast<uint64_t>(sizeof(buffer)))), &read));
        if (!read) throw Failure{output_failed, E_UNEXPECTED};
        DWORD written = 0;
        if (!WriteFile(output.file.value, buffer, read, &written, nullptr) || written != read)
            throw Failure{output_failed, HRESULT_FROM_WIN32(GetLastError())};
        remaining -= read;
    }
    if (!FlushFileBuffers(output.file.value)) throw Failure{output_failed, HRESULT_FROM_WIN32(GetLastError())};
}

struct Text {
    std::wstring value;
    uint32_t source = 0;
    uint32_t visited = 0;
    bool partial = false, error = false;
    void append(const std::wstring& part, uint32_t next_source) {
        if (part.empty()) return;
        if (value.size() >= 65536) { partial = true; return; }
        if (source && source != next_source) source = 3; else if (!source) source = next_source;
        if (!value.empty()) value += L'\n';
        size_t available = 65536 - value.size();
        value.append(part, 0, (std::min)(available, part.size()));
        if (part.size() > available) partial = true;
    }
};

void collect_text(IUIAutomationElement* element, IUIAutomationTreeWalker* walker,
    const Target& target, Text& text, unsigned depth) {
    target.check();
    if (++text.visited > 128 || depth > 16 || text.value.size() >= 65536) { text.partial = true; return; }
    int pid = 0;
    if (FAILED(element->get_CurrentProcessId(&pid)) || pid != static_cast<int>(target.pid)) {
        text.partial = true; return;
    }
    BOOL password = TRUE;
    if (FAILED(element->get_CurrentIsPassword(&password)) || password) return;
    com_ptr<IUIAutomationTextPattern> pattern;
    if (SUCCEEDED(element->GetCurrentPatternAs(UIA_TextPatternId,
        __uuidof(IUIAutomationTextPattern), pattern.put_void())) && pattern) {
        try {
            com_ptr<IUIAutomationTextRange> range;
            check_hresult(pattern->get_DocumentRange(range.put()));
            Bstr raw;
            check_hresult(range->GetText(32769, &raw.value));
            std::wstring value(raw.value ? raw.value : L"", raw.value ? SysStringLen(raw.value) : 0);
            if (value.size() > 32768) { value.resize(32768); text.partial = true; }
            text.append(value, 1);
            return; // A document range includes descendants; do not duplicate their text.
        } catch (...) { text.error = true; }
    }
    com_ptr<IUIAutomationValuePattern> value_pattern;
    if (SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId,
        __uuidof(IUIAutomationValuePattern), value_pattern.put_void())) && value_pattern) {
        Bstr raw;
        if (SUCCEEDED(value_pattern->get_CurrentValue(&raw.value))) {
            auto length = raw.value ? SysStringLen(raw.value) : 0;
            std::wstring value(raw.value ? raw.value : L"", (std::min)(length, 65536U));
            text.partial = true; // ValuePattern's extent cannot be trusted (Classic Edit: 4096).
            text.append(value, 2);
            return;
        }
        text.error = true;
    }
    com_ptr<IUIAutomationElement> child;
    if (FAILED(walker->GetFirstChildElement(element, child.put()))) { text.error = true; return; }
    while (child) {
        collect_text(child.get(), walker, target, text, depth + 1);
        if (text.visited >= 128 || text.value.size() >= 65536) { text.partial = true; break; }
        com_ptr<IUIAutomationElement> next;
        if (FAILED(walker->GetNextSiblingElement(child.get(), next.put()))) { text.error = true; break; }
        child = std::move(next);
    }
}

void read_text(const Target& target, CodexAppshotResult& result, char* buffer, uint32_t capacity) {
    com_ptr<IUIAutomation> automation;
    check_hresult(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
        __uuidof(IUIAutomation), automation.put_void()));
    com_ptr<IUIAutomationElement> root;
    check_hresult(automation->ElementFromHandle(target.window, root.put()));
    com_ptr<IUIAutomationTreeWalker> walker;
    check_hresult(automation->get_ControlViewWalker(walker.put()));
    Text text;
    collect_text(root.get(), walker.get(), target, text, 0);
    if (!text.value.empty() && IS_HIGH_SURROGATE(text.value.back())) text.value.pop_back();
    int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.value.data(),
        static_cast<int>(text.value.size()), nullptr, 0, nullptr, nullptr);
    if (!length) { result.text_status = text.error || !text.value.empty() ? 3 : 0; return; }
    std::string utf8(length, '\0');
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.value.data(),
        static_cast<int>(text.value.size()), utf8.data(), length, nullptr, nullptr))
        throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
    size_t count = (std::min)(utf8.size(), static_cast<size_t>(capacity - 1));
    if (count < utf8.size()) {
        while (count && (static_cast<unsigned char>(utf8[count]) & 0xC0) == 0x80) --count;
        text.partial = true;
    }
    memcpy(buffer, utf8.data(), count);
    buffer[count] = '\0';
    result.text_length = static_cast<uint32_t>(count);
    result.text_source = text.source;
    result.text_status = text.partial || text.error ? 2 : 1;
}
} // namespace

extern "C" int32_t __cdecl codex_appshot_capture(uint64_t hwnd, uint32_t pid,
    uint64_t creation_filetime, const wchar_t* png_path, uint32_t frame_timeout_ms,
    CodexAppshotResult* result, char* utf8_text, uint32_t text_capacity) noexcept {
    if (!result) return 1;
    *result = {};
    result->code = 1;
    if (!hwnd || !pid || !creation_filetime || !png_path || !utf8_text ||
        !text_capacity || text_capacity > 262144 || !frame_timeout_ms || frame_timeout_ms > 10000)
        return 1;
    utf8_text[0] = '\0';
    uint32_t stage = capture_failed;
    try {
        size_t path_length = wcsnlen_s(png_path, 32768);
        if (!path_length || path_length == 32768 || !std::filesystem::path(png_path).is_absolute()) return 1;
        HRESULT apartment_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        check_hresult(apartment_result);
        struct Apartment { ~Apartment() { CoUninitialize(); } } apartment;
        Target target{reinterpret_cast<HWND>(static_cast<uintptr_t>(hwnd)), pid, creation_filetime};
        target.process.value = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
        if (!target.process.value) {
            DWORD error = GetLastError();
            throw Failure{error == ERROR_ACCESS_DENIED ? 5U : target_changed, HRESULT_FROM_WIN32(error)};
        }
        target.check();
        if (!GraphicsCaptureSession::IsSupported()) throw Failure{3, E_NOTIMPL};
        CaptureScope capture;
        auto factory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        HRESULT item_result = factory->CreateForWindow(target.window,
            guid_of<GraphicsCaptureItem>(), put_abi(capture.item));
        target.check();
        check_hresult(item_result);
        auto signal = std::make_shared<Handle>();
        signal->value = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (!signal->value) throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
        capture.closed_token = capture.item.Closed([closed = target.closed, signal](auto const&, auto const&) {
            closed->store(true); SetEvent(signal->value);
        });
        capture.closed_subscribed = true;
        target.check();
        com_ptr<ID3D11Device> device;
        com_ptr<ID3D11DeviceContext> context;
        check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
            device.put(), nullptr, context.put()));
        auto dxgi = device.as<IDXGIDevice>();
        com_ptr<IInspectable> inspectable;
        check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
        auto direct3d = inspectable.as<IDirect3DDevice>();
        auto size = capture.item.Size();
        if (size.Width <= 0 || size.Height <= 0 || !valid_size(size.Width, size.Height))
            throw Failure{capture_failed, E_INVALIDARG};
        capture.pool = Direct3D11CaptureFramePool::CreateFreeThreaded(direct3d,
            DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
        capture.frame_token = capture.pool.FrameArrived([signal](auto const&, auto const&) { SetEvent(signal->value); });
        capture.frames_subscribed = true;
        capture.session = capture.pool.CreateCaptureSession(capture.item);
        capture.session.StartCapture();
        const ULONGLONG deadline = GetTickCount64() + frame_timeout_ms;
        Direct3D11CaptureFrame frame{nullptr};
        while (!frame) {
            target.check();
            if (GetTickCount64() >= deadline) throw Failure{frame_timeout, HRESULT_FROM_WIN32(WAIT_TIMEOUT)};
            DWORD wait = WaitForSingleObject(signal->value, 50);
            if (wait == WAIT_FAILED) throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
            target.check();
            frame = capture.pool.TryGetNextFrame();
        }
        auto content = frame.ContentSize();
        if (content.Width <= 0 || content.Height <= 0 || !valid_size(content.Width, content.Height))
            throw Failure{capture_failed, E_INVALIDARG};
        auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        com_ptr<ID3D11Texture2D> texture;
        check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D), texture.put_void()));
        auto encoded = encode_png(device.get(), context.get(), texture.get(), content.Width, content.Height);
        target.check();
        stage = output_failed;
        Output output;
        write_new_png(encoded.get(), png_path, output);
        target.check();
        result->width = content.Width;
        result->height = content.Height;
        // UIA is deliberately isolated to this worker. A hung provider requires the
        // parent to terminate and wait for the worker; frame_timeout_ms does not bound UIA.
        try { read_text(target, *result, utf8_text, text_capacity); }
        catch (const Failure&) { throw; }
        catch (...) { result->text_status = 3; result->text_length = 0; result->text_source = 0; utf8_text[0] = '\0'; }
        target.check();
        output.committed = true;
        result->code = 0;
        result->hresult = S_OK;
        return 0;
    } catch (const Failure& failure) {
        result->code = failure.code;
        result->hresult = failure.hr;
    } catch (const hresult_error& error) {
        result->code = error.code() == E_ACCESSDENIED ? 5 : stage;
        result->hresult = error.code();
    } catch (...) {
        result->code = stage;
        result->hresult = E_FAIL;
    }
    result->text_length = 0;
    utf8_text[0] = '\0';
    return static_cast<int32_t>(result->code);
}
