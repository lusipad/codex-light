#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <wtsapi32.h>
#include "appshots_entry_native.h"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>

namespace {
std::atomic<bool> occupied{false};
struct Entry;
thread_local Entry* current = nullptr;

struct Entry {
    uint32_t mode;
    HANDLE stop = nullptr;
    DWORD thread_id = 0;
    std::thread thread;
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<CodexAppshotEntryEvent> events;
    bool queued = false, overflowed = false;
    std::atomic<bool> closed{false}, stopping{false}, installed{false};
    std::atomic<uint64_t> input_epoch{1};
    HWND notice_window = nullptr;
    DWORD session_id = 0;
    HWINEVENTHOOK desktop_hook = nullptr;
    bool wts_registered = false, class_owned = false;
    static constexpr const wchar_t* notice_class = L"CodexNativeAppshotInputLossWindow";
    codex_appshots::ModifierChord chord;

    explicit Entry(uint32_t value) : mode(value) {}
    ~Entry() { if (stop) CloseHandle(stop); }
    void push(CodexAppshotEntryEvent event) {
        if (event.phase == 4) {
            stopping.store(true);
            SetEvent(stop);
        }
        if (event.phase == 5) {
            if (stopping.load()) return;
            chord.reset();
            event.input_epoch = input_epoch.fetch_add(1) + 1;
        } else if (!event.input_epoch) event.input_epoch = input_epoch.load();
        std::lock_guard lock(mutex);
        if (overflowed) return;
        if (event.phase != 4 && (stopping.load() || event.input_epoch != input_epoch.load())) return;
        if (event.phase == 5) {
            // Preserve installation/failure facts; queued old gesture frames
            // and older Reset frames must not restore an obsolete target.
            std::erase_if(events, [](const auto& value) { return value.phase != 1 && value.phase != 4; });
        }
        if (events.size() >= 64) {
            events.clear();
            event = {4, ERROR_NOT_ENOUGH_QUOTA};
            event.input_epoch = input_epoch.load();
            overflowed = true;
            stopping.store(true);
            SetEvent(stop);
        }
        events.push_back(event);
        changed.notify_all();
    }
    bool current_event(const CodexAppshotEntryEvent& event) const noexcept {
        if (event.phase == 4) return true;
        if (stopping.load() || closed.load()) return false;
        // Installed is a registration fact. A delayed installation ACK must
        // not be lost if a newer Reset happened while the reader dequeued it.
        if (event.phase == 1) return installed.load();
        return event.input_epoch == input_epoch.load();
    }
    void invalidate(uint32_t reason) noexcept {
        try {
            CodexAppshotEntryEvent event{5};
            event.reset_reason = reason;
            push(event);
        } catch (...) { stopping.store(true); SetEvent(stop); }
    }
    static void CALLBACK desktop_changed(HWINEVENTHOOK, DWORD event, HWND, LONG, LONG, DWORD, DWORD) noexcept {
        if (current && event == EVENT_SYSTEM_DESKTOPSWITCH) current->invalidate(1);
    }
    static LRESULT CALLBACK notice(HWND window, UINT message, WPARAM w, LPARAM l) noexcept {
        if (message == WM_NCCREATE) {
            const auto* create = reinterpret_cast<const CREATESTRUCTW*>(l);
            SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
        }
        auto* entry = reinterpret_cast<Entry*>(GetWindowLongPtrW(window, GWLP_USERDATA));
        if (entry && message == WM_WTSSESSION_CHANGE && l == static_cast<LPARAM>(entry->session_id)) {
            switch (w) {
                case WTS_SESSION_LOCK: entry->invalidate(2); break;
                case WTS_SESSION_UNLOCK: entry->invalidate(3); break;
                case WTS_SESSION_LOGOFF: entry->invalidate(4); break;
                case WTS_CONSOLE_DISCONNECT: case WTS_REMOTE_DISCONNECT: entry->invalidate(5); break;
                case WTS_CONSOLE_CONNECT: case WTS_REMOTE_CONNECT: entry->invalidate(6); break;
                case WTS_SESSION_REMOTE_CONTROL: entry->invalidate(7); break;
                case WTS_SESSION_DESKTOP_READY: entry->invalidate(8); break;
            }
            return 0;
        }
        return DefWindowProcW(window, message, w, l);
    }
    bool create_notice_window() noexcept {
        if (!ProcessIdToSessionId(GetCurrentProcessId(), &session_id)) return false;
        WNDCLASSW wc{};
        wc.lpfnWndProc = notice;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.lpszClassName = notice_class;
        class_owned = RegisterClassW(&wc) != 0;
        if (!class_owned) {
            if (GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
            WNDCLASSW existing{};
            if (!GetClassInfoW(wc.hInstance, notice_class, &existing) || existing.lpfnWndProc != notice) {
                SetLastError(ERROR_CLASS_ALREADY_EXISTS);
                return false;
            }
        }
        // Hidden ordinary HWND: message-only WTS delivery has not been proved.
        notice_window = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            notice_class, L"", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, wc.hInstance, this);
        return notice_window != nullptr;
    }
    CodexAppshotEntryEvent target() const noexcept {
        CodexAppshotEntryEvent result{2};
        HWND window = GetForegroundWindow();
        DWORD pid = 0;
        if (!window || !IsWindow(window) || !GetWindowThreadProcessId(window, &pid) || !pid) {
            result.error = ERROR_INVALID_WINDOW_HANDLE;
            return result;
        }
        result.hwnd = reinterpret_cast<uintptr_t>(window);
        result.pid = pid;
        FILETIME latched{};
        GetSystemTimeAsFileTime(&latched);
        result.latched_filetime = (uint64_t(latched.dwHighDateTime) << 32) | latched.dwLowDateTime;
        return result;
    }
    static LRESULT CALLBACK keyboard(int code, WPARAM message, LPARAM data) noexcept {
        if (code == HC_ACTION && current && !current->stopping.load() && (message == WM_KEYDOWN || message == WM_SYSKEYDOWN || message == WM_KEYUP || message == WM_SYSKEYUP)) {
            const auto& key = *reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
            // Our physical-gesture policy ignores injected keys. This is an own
            // implementation policy, not a recovered official helper guarantee.
            if ((key.vkCode == VK_MENU || key.vkCode == VK_LMENU || key.vkCode == VK_RMENU ||
                 key.vkCode == VK_SHIFT || key.vkCode == VK_LSHIFT || key.vkCode == VK_RSHIFT)) {
                const UINT scan = key.scanCode | ((key.flags & LLKHF_EXTENDED) ? 0xE000 : 0);
                const UINT mapped = MapVirtualKeyW(scan, MAPVK_VSC_TO_VK_EX);
                const UINT vk = mapped ? mapped : key.vkCode;
                const UINT left = current->mode == 1 ? VK_LMENU : VK_LSHIFT;
                const UINT right = current->mode == 1 ? VK_RMENU : VK_RSHIFT;
                if (vk == left || vk == right) {
                    const uint64_t epoch = current->input_epoch.load();
                    const auto phase = current->chord.update(vk == right, message == WM_KEYDOWN || message == WM_SYSKEYDOWN,
                        (key.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0);
                    if (phase) {
                        try {
                            auto event = phase == 2 ? current->target() : CodexAppshotEntryEvent{3};
                            event.input_epoch = epoch;
                            current->push(event);
                        } catch (...) { current->stopping.store(true); SetEvent(current->stop); }
                    }
                }
            }
        }
        return CallNextHookEx(nullptr, code, message, data);
    }
    void pump() {
        MSG message{};
        while (WaitForSingleObject(stop, 0) != WAIT_OBJECT_0) {
            const DWORD outcome = MsgWaitForMultipleObjects(1, &stop, FALSE, INFINITE, QS_ALLINPUT);
            if (outcome == WAIT_OBJECT_0) break;
            if (outcome == WAIT_FAILED) { push({4, GetLastError()}); break; }
            while (WaitForSingleObject(stop, 0) != WAIT_OBJECT_0 && PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                if (message.message == WM_QUIT) { SetEvent(stop); break; }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
    void cleanup(HHOOK hook = nullptr) noexcept {
        stopping.store(true);
        installed.store(false);
        const auto failure = [&] { try { push({4, GetLastError()}); } catch (...) {} };
        if (desktop_hook && !UnhookWinEvent(desktop_hook)) failure();
        desktop_hook = nullptr;
        if (wts_registered && !WTSUnRegisterSessionNotification(notice_window)) failure();
        wts_registered = false;
        if (hook && !UnhookWindowsHookEx(hook)) failure();
        if (notice_window && !DestroyWindow(notice_window)) failure();
        notice_window = nullptr;
        if (class_owned && !UnregisterClassW(notice_class, GetModuleHandleW(nullptr))) failure();
        class_owned = false;
    }
    void run() noexcept {
        current = this;
        MSG message{};
        PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
        {
            std::lock_guard lock(mutex);
            thread_id = GetCurrentThreadId();
            queued = true;
            changed.notify_all();
        }
        HHOOK hook = nullptr;
        try {
            if (!create_notice_window()) push({4, GetLastError()});
            else if (!(wts_registered = WTSRegisterSessionNotification(notice_window, NOTIFY_FOR_THIS_SESSION) != FALSE)) push({4, GetLastError()});
            else if (!(desktop_hook = SetWinEventHook(EVENT_SYSTEM_DESKTOPSWITCH, EVENT_SYSTEM_DESKTOPSWITCH,
                nullptr, desktop_changed, 0, 0, WINEVENT_OUTOFCONTEXT))) push({4, GetLastError()});
            else if (!(hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, GetModuleHandleW(nullptr), 0))) push({4, GetLastError()});
            else {
                installed.store(true);
                push({1});
                pump();
            }
        } catch (...) { /* Close below, never unwind through Win32 or C ABI. */ }
        cleanup(hook);
        current = nullptr;
        std::lock_guard lock(mutex);
        closed = true;
        changed.notify_all();
    }
};

// Process lookup is outside the hook callback and its queue lock. Only enrich
// the latched HWND/PID, never replace it with a new GetForegroundWindow result.
void enrich_target(CodexAppshotEntryEvent& event) noexcept {
    if (event.phase != 2 || event.error) return;
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, event.pid);
    if (!process) { event.error = GetLastError(); return; }
    FILETIME creation{}, exit{}, kernel{}, user{};
    const BOOL times = GetProcessTimes(process, &creation, &exit, &kernel, &user);
    const DWORD error = times ? ERROR_SUCCESS : GetLastError();
    CloseHandle(process);
    const uint64_t created = (uint64_t(creation.dwHighDateTime) << 32) | creation.dwLowDateTime;
    const HWND window = reinterpret_cast<HWND>(static_cast<uintptr_t>(event.hwnd));
    DWORD confirmed = 0;
    if (!times || !created || created > event.latched_filetime ||
        !IsWindow(window) || !GetWindowThreadProcessId(window, &confirmed) || confirmed != event.pid) {
        event.error = error ? error : ERROR_INVALID_WINDOW_HANDLE;
        return;
    }
    event.creation_filetime = created;
}
}

extern "C" void* __cdecl codex_appshot_entry_start(uint32_t mode, uint32_t* error) noexcept {
    if (!error) return nullptr;
    *error = ERROR_INVALID_PARAMETER;
    if (mode != 1 && mode != 2) return nullptr;
    bool expected = false;
    if (!occupied.compare_exchange_strong(expected, true)) { *error = ERROR_ALREADY_EXISTS; return nullptr; }
    Entry* entry = nullptr;
    try {
        entry = new Entry(mode);
        entry->stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!entry->stop) {
            *error = GetLastError();
            delete entry;
            occupied.store(false);
            return nullptr;
        }
        entry->thread = std::thread([entry] { entry->run(); });
        std::unique_lock lock(entry->mutex);
        entry->changed.wait(lock, [entry] { return entry->queued; });
        *error = ERROR_SUCCESS;
        return entry;
    } catch (...) {
        if (entry && entry->thread.joinable()) { SetEvent(entry->stop); entry->thread.join(); }
        delete entry;
        occupied.store(false);
        *error = ERROR_NOT_ENOUGH_MEMORY;
        return nullptr;
    }
}

extern "C" int32_t __cdecl codex_appshot_entry_next(void* handle, uint32_t timeout_ms, CodexAppshotEntryEvent* event) noexcept {
    if (!handle || !event) return -1;
    try {
        auto& entry = *static_cast<Entry*>(handle);
        std::unique_lock lock(entry.mutex);
        entry.changed.wait_for(lock, std::chrono::milliseconds(timeout_ms > 1000 ? 1000 : timeout_ms), [&] { return entry.closed || !entry.events.empty(); });
        if (entry.events.empty()) return entry.closed ? -1 : 0;
        *event = entry.events.front();
        entry.events.pop_front();
        lock.unlock();
        enrich_target(*event);
        if (!entry.current_event(*event)) return 0;
        return 1;
    } catch (...) { return -1; }
}

extern "C" uint64_t __cdecl codex_appshot_entry_epoch(void* handle) noexcept {
    if (!handle) return 0;
    auto& entry = *static_cast<Entry*>(handle);
    if (!entry.installed.load() || entry.stopping.load() || entry.closed.load()) return 0;
    return entry.input_epoch.load();
}

extern "C" void __cdecl codex_appshot_entry_stop(void* handle) noexcept {
    if (!handle) return;
    auto* entry = static_cast<Entry*>(handle);
    entry->stopping.store(true);
    SetEvent(entry->stop);
    if (entry->thread.joinable()) entry->thread.join();
    delete entry;
    occupied.store(false);
}
