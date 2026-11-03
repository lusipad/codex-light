// SDK-level tests use no toast Show, Start Menu registration or global settings.
#include "desktop_notifications.cpp"
#include <iostream>
int main() {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    if (xml(L"a&<>'\"") != L"a&amp;&lt;&gt;&apos;&quot;") return 1;
    auto first = tag_for(L"host:thread:turn-1");
    if (first.size() != 16 || first != tag_for(L"host:thread:turn-1")) return 2;
    if (first == tag_for(L"host:thread:turn-2") || first == tag_for(L"中文通知")) return 3;
    auto output = codex_notification_call("{not valid json");
    if (!output) return 4;
    auto parsed = JsonObject::Parse(winrt::to_hstring(output));
    codex_notification_free(output);
    if (parsed.GetNamedBoolean(L"ok") || parsed.GetNamedString(L"status") != L"native-error") return 5;
    output = codex_notification_call("{\"command\":\"show\"}");
    if (!output) return 6;
    parsed = JsonObject::Parse(winrt::to_hstring(output));
    codex_notification_free(output);
    if (parsed.GetNamedBoolean(L"ok")) return 7;
    output = codex_notification_call("{\"command\":\"permission\",\"appId\":\"com.codex.native.tauri\"}");
    if (!output) return 8;
    parsed = JsonObject::Parse(winrt::to_hstring(output));
    codex_notification_free(output);
    // Both actual OS denial/errors and a concrete Setting value are observable
    // outcomes. The test does not assume an installed identity or OS permission.
    if (parsed.GetNamedBoolean(L"ok")) {
        auto status = parsed.GetNamedString(L"status");
        if (status != L"enabled" && status != L"disabled") return 9;
        if (!parsed.HasKey(L"setting")) return 10;
    } else if (parsed.GetNamedString(L"error", L"").empty()) return 11;
    if (notifier || !app_id.empty() || !entries.empty()) return 12;
    if (!delivery_allowed(NotificationSetting::Enabled)) return 13;
    if (delivery_allowed(NotificationSetting::DisabledForApplication)
        || delivery_allowed(NotificationSetting::DisabledForUser)
        || delivery_allowed(NotificationSetting::DisabledByGroupPolicy)
        || delivery_allowed(NotificationSetting::DisabledByManifest)) return 14;
    if (parsed.GetNamedBoolean(L"ok") && delivery_allowed(static_cast<NotificationSetting>(static_cast<int>(parsed.GetNamedNumber(L"setting"))))
        != (parsed.GetNamedString(L"status") == L"enabled")) return 15;
    std::cout << "Read-only Windows permission result: " << winrt::to_string(parsed.Stringify()) << "\n";
    std::cout << "PASS: XML escaping, stable SHA256 tag, distinct IDs, malformed JSON and uninitialized delivery rejection\n";
    return 0;
}
