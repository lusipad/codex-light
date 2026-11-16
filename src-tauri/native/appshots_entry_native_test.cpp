// Like the notification SDK tests, compile the real implementation to test
// internal message pumping without exposing test exports in the product ABI.
#include "appshots_entry_native.cpp"
#include <cassert>
#include <chrono>
#include <cstring>
#include <cstddef>
#include <iostream>

#ifdef NDEBUG
#error Entry tests require enabled assertions
#endif

static void chord_contract() {
    for (const bool first_right : {false, true}) {
        codex_appshots::ModifierChord chord;
        assert(chord.update(first_right, true) == 0);
        assert(chord.update(first_right, true) == 0); // one-side autorepeat
        assert(chord.update(!first_right, true) == 2);
        assert(chord.update(!first_right, true) == 0);
        assert(chord.update(first_right, true) == 0); // no duplicate flight
        assert(chord.update(first_right, false) == 3);
        assert(chord.update(first_right, false) == 0);
        assert(chord.update(!first_right, false) == 0);
        assert(chord.update(first_right, true) == 0);
        assert(chord.update(first_right, false) == 0); // double-tap is not both
        assert(chord.update(first_right, true) == 0);
        assert(chord.update(first_right, false) == 0);
    }
    static_assert(sizeof(CodexAppshotEntryEvent) == 40);
    static_assert(offsetof(CodexAppshotEntryEvent, hwnd) == 8);
    static_assert(offsetof(CodexAppshotEntryEvent, pid) == 16);
    static_assert(offsetof(CodexAppshotEntryEvent, creation_filetime) == 24);
    static_assert(offsetof(CodexAppshotEntryEvent, latched_filetime) == 32);
    uint32_t error = 0;
    assert(!codex_appshot_entry_start(0, &error) && error == ERROR_INVALID_PARAMETER);
    assert(!codex_appshot_entry_start(3, &error) && error == ERROR_INVALID_PARAMETER);
    CodexAppshotEntryEvent event{};
    assert(codex_appshot_entry_next(nullptr, 0, &event) == -1);
    codex_appshot_entry_stop(nullptr);
}

struct Flood {
    Entry* entry;
    ULONGLONG until;
};
static LRESULT CALLBACK flood_window(HWND window, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_APP) {
        auto* flood = reinterpret_cast<Flood*>(GetWindowLongPtrW(window, GWLP_USERDATA));
        SetEvent(flood->entry->stop);
        if (GetTickCount64() < flood->until) PostMessageW(window, WM_APP, 0, 0);
        return 0;
    }
    return DefWindowProcW(window, message, w, l);
}
static void stop_during_message_flood() {
    Entry entry(1);
    entry.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    assert(entry.stop);
    WNDCLASSW wc{};
    wc.lpfnWndProc = flood_window;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"CodexOwnedEntryFloodTest";
    assert(RegisterClassW(&wc));
    HWND window = CreateWindowW(wc.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, wc.hInstance, nullptr);
    assert(window);
    Flood flood{&entry, GetTickCount64() + 1500};
    std::mutex guard_mutex;
    std::condition_variable guard_changed;
    bool finished = false;
    std::thread guard([&] {
        std::unique_lock lock(guard_mutex);
        if (!guard_changed.wait_for(lock, std::chrono::seconds(3), [&] { return finished; })) {
            std::cerr << "FAIL entry message pump exceeded private test deadline\n";
            std::_Exit(2);
        }
    });
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&flood));
    assert(PostMessageW(window, WM_APP, 0, 0));
    const auto before = std::chrono::steady_clock::now();
    entry.pump();
    const auto elapsed = std::chrono::steady_clock::now() - before;
    DestroyWindow(window);
    UnregisterClassW(wc.lpszClassName, wc.hInstance);
    { std::lock_guard lock(guard_mutex); finished = true; }
    guard_changed.notify_all();
    guard.join();
    assert(elapsed < std::chrono::milliseconds(800));
}

// Explicit private desktop probe only. Default SDK/CI tests never register a
// global listener, inject keyboard input, capture pixels, or record user keys.
static void lifecycle_probe() {
    for (const uint32_t mode : {1u, 2u, 1u}) {
        uint32_t error = 0;
        void* entry = codex_appshot_entry_start(mode, &error);
        assert(entry && error == 0);
        CodexAppshotEntryEvent event{};
        const int result = codex_appshot_entry_next(entry, 1000, &event);
        const bool ready = result == 1 && event.phase == 1 && !event.error;
        uint32_t duplicate_error = 0;
        void* duplicate = codex_appshot_entry_start(mode, &duplicate_error);
        const auto before = std::chrono::steady_clock::now();
        codex_appshot_entry_stop(entry);
        const auto elapsed = std::chrono::steady_clock::now() - before;
        assert(ready);
        assert(!duplicate && duplicate_error == ERROR_ALREADY_EXISTS);
        assert(elapsed < std::chrono::seconds(2));
    }
}

int main(int argc, char** argv) {
    chord_contract();
    stop_during_message_flood();
    if (argc == 2 && std::strcmp(argv[1], "--lifecycle") == 0) {
        lifecycle_probe();
        std::cout << "PASS native installed/message-loop-ready, duplicate rejection, stop/join and re-registration; no physical key or capture proof\n";
    } else {
        std::cout << "PASS modifier chord: simultaneous order, autorepeat, release, no double-tap; ABI, invalid arguments and stop during continuous message flood\n";
    }
    return 0;
}
