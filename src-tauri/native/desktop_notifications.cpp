#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shobjidl.h>
#include <propkey.h>
#include <propvarutil.h>
#include <roapi.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Xml.Dom.h>
#include <winrt/Windows.UI.Notifications.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#include <map>
#include <mutex>
#include <memory>
#include <string>

using namespace winrt;
using namespace winrt::Windows::Data::Json;
using namespace winrt::Windows::UI::Notifications;
using Callback = void(__cdecl *)(const char*);
static Callback callback;
static ToastNotifier notifier{nullptr};
static std::wstring app_id;
static std::recursive_mutex guard;
struct Entry {
    JsonObject payload;
    hstring tag;
    ToastNotification toast{nullptr};
    uint64_t generation;
    event_token activated{}, dismissed{}, failed{};
};
static std::map<std::wstring, std::shared_ptr<Entry>> entries;
static uint64_t generation = 0;
static const hstring group{L"codex-native"};
static bool delivery_allowed(NotificationSetting setting) {
    return setting == NotificationSetting::Enabled;
}

static std::wstring xml(std::wstring text) {
    std::wstring result;
    for (auto c : text) {
        switch (c) {
        case L'&': result += L"&amp;"; break;
        case L'<': result += L"&lt;"; break;
        case L'>': result += L"&gt;"; break;
        case L'\"': result += L"&quot;"; break;
        case L'\'': result += L"&apos;"; break;
        default: result += c;
        }
    }
    return result;
}
static JsonObject result(bool ok, const char* status) {
    JsonObject value;
    value.Insert(L"ok", JsonValue::CreateBooleanValue(ok));
    value.Insert(L"status", JsonValue::CreateStringValue(to_hstring(status)));
    return value;
}
static JsonObject error(const hresult_error& exception) {
    auto value = result(false, "native-error");
    value.Insert(L"error", JsonValue::CreateStringValue(exception.message()));
    value.Insert(L"code", JsonValue::CreateNumberValue(static_cast<int32_t>(exception.code())));
    return value;
}
static void emit(const std::shared_ptr<Entry>& entry, const wchar_t* kind,
                 JsonObject extra = JsonObject()) {
    std::lock_guard lock(guard);
    auto id = entry->payload.GetNamedString(L"id");
    auto current = entries.find(std::wstring(id));
    if (current == entries.end() || current->second != entry) return;
    extra.Insert(L"kind", JsonValue::CreateStringValue(kind));
    extra.Insert(L"id", JsonValue::CreateStringValue(id));
    extra.Insert(L"generation", JsonValue::CreateNumberValue(static_cast<double>(entry->generation)));
    extra.Insert(L"payload", entry->payload);
    if (callback) {
        auto bytes = to_string(extra.Stringify());
        callback(bytes.c_str());
    }
}
static void detach(const std::shared_ptr<Entry>& entry) {
    entry->toast.Activated(entry->activated);
    entry->toast.Dismissed(entry->dismissed);
    entry->toast.Failed(entry->failed);
}
static void forget(const std::shared_ptr<Entry>& entry) {
    std::lock_guard lock(guard);
    auto found = entries.find(std::wstring(entry->payload.GetNamedString(L"id")));
    if (found != entries.end() && found->second == entry) {
        detach(entry);
        entries.erase(found);
    }
}
static hstring tag_for(hstring const& id) {
    using namespace winrt::Windows::Security::Cryptography;
    using namespace winrt::Windows::Security::Cryptography::Core;
    auto hash = HashAlgorithmProvider::OpenAlgorithm(HashAlgorithmNames::Sha256());
    auto bytes = CryptographicBuffer::ConvertStringToBinary(id, BinaryStringEncoding::Utf8);
    auto hex = CryptographicBuffer::EncodeToHexString(hash.HashData(bytes));
    return hstring(std::wstring(hex).substr(0, 16));
}
// Give unpackaged builds their own AUMID instead of PowerShell's identity.
static void register_identity(const wchar_t* executable, const wchar_t* shortcut) {
    auto link = create_instance<IShellLinkW>(CLSID_ShellLink);
    check_hresult(link->SetPath(executable));
    check_hresult(link->SetDescription(L"Codex Light"));
    auto store = link.as<IPropertyStore>();
    PROPVARIANT value;
    check_hresult(InitPropVariantFromString(app_id.c_str(), &value));
    auto hr = store->SetValue(PKEY_AppUserModel_ID, value);
    PropVariantClear(&value);
    check_hresult(hr);
    check_hresult(store->Commit());
    check_hresult(link.as<IPersistFile>()->Save(shortcut, TRUE));
    check_hresult(SetCurrentProcessExplicitAppUserModelID(app_id.c_str()));
}
extern "C" __declspec(dllexport) char* __cdecl codex_notification_call(const char* input) noexcept {
    std::string output;
    try {
        struct Apartment {
            HRESULT status = RoInitialize(RO_INIT_MULTITHREADED);
            Apartment() { if (FAILED(status) && status != RPC_E_CHANGED_MODE) check_hresult(status); }
            ~Apartment() { if (SUCCEEDED(status)) RoUninitialize(); }
        };
        // Keep the apartment alive for retained ToastNotification COM objects.
        thread_local Apartment apartment;
        auto request = JsonObject::Parse(to_hstring(input));
        auto command = request.GetNamedString(L"command");
        std::lock_guard lock(guard);
        JsonObject response;
        if (command == L"initialize") {
            app_id = request.GetNamedString(L"appId");
            register_identity(request.GetNamedString(L"executable").c_str(),
                              request.GetNamedString(L"shortcut").c_str());
            notifier = ToastNotificationManager::CreateToastNotifier(app_id);
            response = result(true, "initialized");
        } else if (command == L"permission") {
            // A permission read must never register a shortcut or mutate the
            // process AUMID. Query Windows using an independent notifier.
            auto identity = request.GetNamedString(L"appId");
            if (identity.empty()) throw hresult_error(E_INVALIDARG, L"通知应用身份为空");
            auto permission_notifier = ToastNotificationManager::CreateToastNotifier(identity);
            auto setting = permission_notifier.Setting();
            auto status = delivery_allowed(setting) ? "enabled" : "disabled";
            response = result(true, status);
            response.Insert(L"setting", JsonValue::CreateNumberValue(static_cast<int>(setting)));
        } else if (!notifier) {
            throw hresult_error(E_UNEXPECTED, L"Windows 通知服务尚未初始化");
        } else if (command == L"show" && !delivery_allowed(notifier.Setting())) {
            // Windows may accept Show without visibly displaying a disabled
            // notification. Suppress before allocating an entry so the caller
            // also suppresses its separate notification audio.
            response = result(true, "suppressed");
            response.Insert(L"reason", JsonValue::CreateStringValue(L"permission-disabled"));
            response.Insert(L"id", JsonValue::CreateStringValue(request.GetNamedObject(L"payload").GetNamedString(L"id")));
        } else if (command == L"show") {
            auto payload = request.GetNamedObject(L"payload");
            auto id = payload.GetNamedString(L"id");
            auto tag = tag_for(id);
            for (auto const& pair : entries) {
                if (pair.first != std::wstring(id) && pair.second->tag == tag)
                    throw hresult_error(E_INVALIDARG, L"通知身份摘要冲突，未覆盖其他通知");
            }
            auto prior = entries.find(std::wstring(id));
            if (prior != entries.end()) {
                detach(prior->second);
                entries.erase(prior);
            }
            auto entry = std::make_shared<Entry>();
            entry->payload = payload;
            entry->tag = tag;
            entry->generation = static_cast<uint64_t>(payload.GetNamedNumber(L"_nativeGeneration", static_cast<double>(++generation)));
            std::wstring document = L"<toast launch=\"open\"";
            if (payload.GetNamedBoolean(L"persistent", false)) document += L" duration=\"long\" scenario=\"reminder\"";
            document += L"><visual><binding template=\"ToastGeneric\"><text>";
            document += xml(std::wstring(payload.GetNamedString(L"title")));
            document += L"</text><text>" + xml(std::wstring(payload.GetNamedString(L"body"))) + L"</text></binding></visual><audio silent=\"true\"/>";
            auto actions = payload.GetNamedArray(L"actions", JsonArray());
            auto placeholder = payload.GetNamedString(L"replyPlaceholder", L"");
            if (actions.Size() || !placeholder.empty()) {
                document += L"<actions>";
                if (!placeholder.empty()) document += L"<input id=\"reply\" type=\"text\" placeHolder=\"" + xml(std::wstring(placeholder)) + L"\"/><action content=\"发送\" arguments=\"reply\" activationType=\"foreground\" hint-inputId=\"reply\"/>";
                if (actions.Size() > 4) throw hresult_error(E_INVALIDARG, L"通知动作不能超过四项");
                for (auto const& action_value : actions) {
                    auto action = action_value.GetObject();
                    document += L"<action content=\"" + xml(std::wstring(action.GetNamedString(L"title"))) + L"\" arguments=\"" + xml(std::wstring(action.GetNamedString(L"id"))) + L"\" activationType=\"foreground\"/>";
                }
                document += L"</actions>";
            }
            document += L"</toast>";
            winrt::Windows::Data::Xml::Dom::XmlDocument dom;
            dom.LoadXml(document);
            entry->toast = ToastNotification(dom);
            entry->toast.Tag(tag);
            entry->toast.Group(group);
            std::weak_ptr<Entry> weak = entry;
            entry->activated = entry->toast.Activated([weak](auto const&, winrt::Windows::Foundation::IInspectable const& args) {
                if (auto value = weak.lock()) {
                    try {
                        auto activation = args.as<ToastActivatedEventArgs>();
                        JsonObject extra;
                        extra.Insert(L"action", JsonValue::CreateStringValue(activation.Arguments()));
                        if (activation.UserInput().HasKey(L"reply")) {
                            extra.Insert(L"reply", JsonValue::CreateStringValue(unbox_value<hstring>(activation.UserInput().Lookup(L"reply"))));
                        }
                        emit(value, L"activated", extra);
                    } catch (hresult_error const& ex) { emit(value, L"failed", error(ex)); }
                }
            });
            entry->dismissed = entry->toast.Dismissed([weak](auto const&, ToastDismissedEventArgs const& args) {
                if (auto value = weak.lock()) {
                    JsonObject extra;
                    extra.Insert(L"reason", JsonValue::CreateNumberValue(static_cast<int>(args.Reason())));
                    emit(value, L"dismissed", extra);
                    // TimedOut means banner hidden, not removed from Action Center.
                    // Keep the object and its activation callbacks until explicit removal.
                    if (args.Reason() != ToastDismissalReason::TimedOut) forget(value);
                }
            });
            entry->failed = entry->toast.Failed([weak](auto const&, ToastFailedEventArgs const& args) {
                if (auto value = weak.lock()) {
                    emit(value, L"failed", error(hresult_error(args.ErrorCode())));
                    forget(value);
                }
            });
            entries[std::wstring(id)] = entry;
            try { notifier.Show(entry->toast); }
            catch (...) { detach(entry); entries.erase(std::wstring(id)); throw; }
            response = result(true, "submitted");
            response.Insert(L"id", JsonValue::CreateStringValue(id));
            response.Insert(L"generation", JsonValue::CreateNumberValue(static_cast<double>(entry->generation)));
            response.Insert(L"tag", JsonValue::CreateStringValue(tag));
            response.Insert(L"group", JsonValue::CreateStringValue(group));
        } else if (command == L"hide_all") {
            // Clear only this product's AUMID, including previous-process history.
            ToastNotificationManager::History().Clear(app_id);
            for (auto const& pair : entries) detach(pair.second);
            for (auto const& pair : entries) notifier.Hide(pair.second->toast);
            entries.clear();
            response = result(true, "removed");
        } else if (command == L"hide") {
            auto id = request.GetNamedString(L"id");
            auto tag = tag_for(id);
            auto existing = entries.find(std::wstring(id));
            if (existing != entries.end()) {
                detach(existing->second);
                notifier.Hide(existing->second->toast);
                entries.erase(existing);
            }
            ToastNotificationManager::History().Remove(tag, group, app_id);
            response = result(true, "removed");
        } else {
            throw hresult_error(E_INVALIDARG, L"未知通知宿主命令");
        }
        output = to_string(response.Stringify());
    } catch (hresult_error const& ex) { output = to_string(error(ex).Stringify()); }
    catch (...) { output = "{\"ok\":false,\"status\":\"native-error\",\"error\":\"未知原生通知错误\"}"; }
    auto memory = static_cast<char*>(CoTaskMemAlloc(output.size() + 1));
    if (!memory) return nullptr;
    memcpy(memory, output.c_str(), output.size() + 1);
    return memory;
}
extern "C" __declspec(dllexport) void __cdecl codex_notification_callback(Callback value) noexcept {
    std::lock_guard lock(guard);
    callback = value;
}
extern "C" __declspec(dllexport) void __cdecl codex_notification_free(char* value) noexcept {
    CoTaskMemFree(value);
}
