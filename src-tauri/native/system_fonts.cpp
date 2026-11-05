#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwrite_1.h>
#include <wrl/client.h>
#include <new>
#include <string>

using Microsoft::WRL::ComPtr;
using FontCallback = void(__cdecl *)(void*, const wchar_t*, size_t,
    const wchar_t*, size_t, const wchar_t*, size_t, const wchar_t*, size_t, unsigned char);

static HRESULT localized(IDWriteLocalizedStrings* names, std::wstring& value) {
    UINT32 index = 0, length = 0;
    BOOL exists = FALSE;
    HRESULT hr = names->FindLocaleName(L"en-us", &index, &exists);
    if (FAILED(hr)) return hr;
    if (!exists) index = 0;
    if (names->GetCount() == 0) { value.clear(); return S_OK; }
    hr = names->GetStringLength(index, &length);
    if (FAILED(hr)) return hr;
    value.resize(static_cast<size_t>(length) + 1);
    hr = names->GetString(index, value.data(), length + 1);
    value.resize(length);
    return hr;
}

static HRESULT information(IDWriteFont* font, DWRITE_INFORMATIONAL_STRING_ID id,
    std::wstring& value) {
    ComPtr<IDWriteLocalizedStrings> names;
    BOOL exists = FALSE;
    HRESULT hr = font->GetInformationalStrings(id, &names, &exists);
    if (FAILED(hr)) return hr;
    if (!exists) { value.clear(); return S_OK; }
    return localized(names.Get(), value);
}

extern "C" HRESULT __cdecl codex_system_fonts(void* context, FontCallback callback) noexcept {
    if (!callback) return E_INVALIDARG;
    try {
        ComPtr<IDWriteFactory> factory;
        HRESULT hr = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
            reinterpret_cast<IUnknown**>(factory.GetAddressOf()));
        if (FAILED(hr)) return hr;
        ComPtr<IDWriteFontCollection> collection;
        hr = factory->GetSystemFontCollection(&collection, FALSE);
        if (FAILED(hr)) return hr;
        for (UINT32 i = 0; i < collection->GetFontFamilyCount(); ++i) {
            ComPtr<IDWriteFontFamily> family;
            hr = collection->GetFontFamily(i, &family);
            if (FAILED(hr)) return hr;
            ComPtr<IDWriteLocalizedStrings> names;
            hr = family->GetFamilyNames(&names);
            if (FAILED(hr)) return hr;
            std::wstring family_name;
            hr = localized(names.Get(), family_name);
            if (FAILED(hr)) return hr;
            if (family_name.empty()) continue;
            const UINT32 count = family->GetFontCount();
            UINT32 default_index = count;
            ComPtr<IDWriteFont> default_font;
            // Match the CSS normal face rather than assuming collection index zero
            // is Regular. This adaptation does not establish Electron's ordering.
            if (SUCCEEDED(family->GetFirstMatchingFont(DWRITE_FONT_WEIGHT_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, &default_font))) {
                std::wstring default_postscript;
                hr = information(default_font.Get(), DWRITE_INFORMATIONAL_STRING_POSTSCRIPT_NAME,
                    default_postscript);
                if (FAILED(hr)) return hr;
                for (UINT32 candidate_index = 0; candidate_index < count; ++candidate_index) {
                    ComPtr<IDWriteFont> candidate;
                    hr = family->GetFont(candidate_index, &candidate);
                    if (FAILED(hr)) return hr;
                    if (candidate->GetSimulations() != DWRITE_FONT_SIMULATIONS_NONE) continue;
                    std::wstring candidate_postscript;
                    hr = information(candidate.Get(), DWRITE_INFORMATIONAL_STRING_POSTSCRIPT_NAME,
                        candidate_postscript);
                    if (FAILED(hr)) return hr;
                    const bool matches = !default_postscript.empty()
                        ? candidate_postscript == default_postscript
                        : candidate->GetWeight() == default_font->GetWeight()
                            && candidate->GetStretch() == default_font->GetStretch()
                            && candidate->GetStyle() == default_font->GetStyle();
                    if (matches) { default_index = candidate_index; break; }
                }
            }
            for (UINT32 ordinal = 0; ordinal < count; ++ordinal) {
                const UINT32 j = default_index == count ? ordinal
                    : ordinal == 0 ? default_index
                    : ordinal <= default_index ? ordinal - 1 : ordinal;
                ComPtr<IDWriteFont> font;
                hr = family->GetFont(j, &font);
                if (FAILED(hr)) return hr;
                if (font->GetSimulations() != DWRITE_FONT_SIMULATIONS_NONE) continue;
                std::wstring full_name, postscript, style;
                hr = information(font.Get(), DWRITE_INFORMATIONAL_STRING_FULL_NAME, full_name);
                if (FAILED(hr)) return hr;
                hr = information(font.Get(), DWRITE_INFORMATIONAL_STRING_POSTSCRIPT_NAME, postscript);
                if (FAILED(hr)) return hr;
                if (full_name.empty() || postscript.empty()) continue;
                ComPtr<IDWriteLocalizedStrings> face_names;
                hr = font->GetFaceNames(&face_names);
                if (FAILED(hr)) return hr;
                hr = localized(face_names.Get(), style);
                if (FAILED(hr)) return hr;
                ComPtr<IDWriteFont1> font1;
                hr = font.As(&font1);
                if (FAILED(hr)) return hr;
                callback(context, family_name.data(), family_name.size(), full_name.data(),
                    full_name.size(), postscript.data(), postscript.size(), style.data(),
                    style.size(), font1->IsMonospacedFont() ? 1 : 0);
            }
        }
        return S_OK;
    } catch (const std::bad_alloc&) {
        return E_OUTOFMEMORY;
    } catch (...) {
        return E_FAIL;
    }
}
