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
    static_assert(sizeof(CodexAppshotEntryEvent) == 56);
    static_assert(offsetof(CodexAppshotEntryEvent, hwnd) == 8);
    static_assert(offsetof(CodexAppshotEntryEvent, pid) == 16);
    static_assert(offsetof(CodexAppshotEntryEvent, creation_filetime) == 24);
    static_assert(offsetof(CodexAppshotEntryEvent, latched_filetime) == 32);
    static_assert(offsetof(CodexAppshotEntryEvent, input_epoch) == 40);
    static_assert(offsetof(CodexAppshotEntryEvent, reset_reason) == 48);
    uint32_t error = 0;
    assert(!codex_appshot_entry_start(0, &error) && error == ERROR_INVALID_PARAMETER);
    assert(!codex_appshot_entry_start(3, &error) && error == ERROR_INVALID_PARAMETER);
    CodexAppshotEntryEvent event{};
    assert(codex_appshot_entry_next(nullptr, 0, &event) == -1);
    codex_appshot_entry_stop(nullptr);
}

static void reset_barrier_contract() {
    for (const bool side : {false, true}) {
        codex_appshots::ModifierChord chord;
        assert(chord.update(side, true) == 0);
        chord.reset();
        assert(chord.update(!side, true) == 0);
        assert(chord.update(side, true) == 0); // held autorepeat after loss
        assert(chord.update(false, false, true) == 0);
        assert(chord.update(true, false, true) == 0); // injected up cannot arm
        assert(chord.update(false, true) == 0);
        assert(chord.update(true, true) == 0);
        assert(chord.update(false, false) == 0);
        assert(chord.update(true, false) == 0);
        assert(chord.update(false, true) == 0);
        assert(chord.update(true, true) == 2);
        assert(chord.update(false, false) == 3);
    }
    Entry entry(1);
    entry.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    assert(entry.stop);
    assert(codex_appshot_entry_epoch(&entry) == 0); // not installed is not a live lease
    entry.installed.store(true); // private state fixture, no hook registered
    CodexAppshotEntryEvent down{2};
    down.input_epoch = 1;
    entry.push(down);
    CodexAppshotEntryEvent reset{5};
    reset.reset_reason = 1;
    entry.push(reset);
    assert(entry.events.size() == 1 && entry.events.front().phase == 5);
    assert(entry.events.front().input_epoch > down.input_epoch);
    assert(!entry.current_event(down)); // already-dequeued enrichment is stale
    assert(codex_appshot_entry_epoch(&entry) == 2);
    CodexAppshotEntryEvent fresh{2};
    fresh.input_epoch = 2;
    assert(entry.current_event(fresh));
    entry.push(down);
    assert(entry.events.size() == 1); // late producer cannot requeue an old down
    entry.installed.store(true);
    assert(entry.current_event(CodexAppshotEntryEvent{1})); // installation fact
    entry.cleanup();
    assert(!entry.current_event(fresh));
    assert(codex_appshot_entry_epoch(&entry) == 0);
    assert(codex_appshot_entry_epoch(nullptr) == 0);
    Entry overflow(1);
    overflow.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    assert(overflow.stop);
    overflow.installed.store(true);
    for (int index = 0; index < 65; ++index) overflow.push(down);
    assert(overflow.overflowed && overflow.stopping.load());
    assert(overflow.events.size() == 1 && overflow.events.front().phase == 4);
    assert(codex_appshot_entry_epoch(&overflow) == 0);
    Entry failure(1);
    failure.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    assert(failure.stop);
    failure.installed.store(true);
    failure.push(CodexAppshotEntryEvent{4, ERROR_GEN_FAILURE});
    assert(codex_appshot_entry_epoch(&failure) == 0);
    assert(failure.current_event(failure.events.front())); // failure stays visible
}

static void notice_contract_without_system_observers() {
    Entry entry(1);
    entry.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    assert(entry.stop && entry.create_notice_window());
    const HWND window = entry.notice_window;
    assert(!IsWindowVisible(window));
    DWORD session = 0;
    assert(ProcessIdToSessionId(GetCurrentProcessId(), &session));
    const struct { WPARAM code; uint32_t reason; } cases[] = {
        {WTS_SESSION_LOCK,2}, {WTS_SESSION_UNLOCK,3}, {WTS_SESSION_LOGOFF,4},
        {WTS_CONSOLE_DISCONNECT,5}, {WTS_REMOTE_DISCONNECT,5},
        {WTS_CONSOLE_CONNECT,6}, {WTS_REMOTE_CONNECT,6},
        {WTS_SESSION_REMOTE_CONTROL,7}, {WTS_SESSION_DESKTOP_READY,8},
    };
    uint64_t epoch = 1;
    for (const auto& sample : cases) {
        SendMessageW(window, WM_WTSSESSION_CHANGE, sample.code, session);
        assert(entry.input_epoch.load() == ++epoch);
        assert(entry.events.size() == 1 && entry.events.front().reset_reason == sample.reason);
    }
    SendMessageW(window, WM_WTSSESSION_CHANGE, 0xffff, session);
    assert(entry.input_epoch.load() == epoch);
    SendMessageW(window, WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK, session + 1);
    assert(entry.input_epoch.load() == epoch); // this-session subscription boundary
    current = &entry;
    Entry::desktop_changed(nullptr, EVENT_SYSTEM_FOREGROUND, nullptr, 0, 0, 0, 0);
    assert(entry.input_epoch.load() == epoch); // ordinary foreground is not loss
    Entry::desktop_changed(nullptr, EVENT_SYSTEM_DESKTOPSWITCH, nullptr, 0, 0, 0, 0);
    assert(entry.input_epoch.load() == ++epoch);
    assert(entry.events.front().reset_reason == 1);
    current = nullptr;
    entry.cleanup();
    assert(!IsWindow(window) && !entry.notice_window && !entry.desktop_hook && !entry.wts_registered);
    const auto count = entry.events.size();
    entry.invalidate(1);
    assert(entry.events.size() == count); // no late business events after cleanup
}

static void foreign_window_class_is_not_removed() {
    WNDCLASSW foreign{};
    foreign.lpfnWndProc = DefWindowProcW;
    foreign.hInstance = GetModuleHandleW(nullptr);
    foreign.lpszClassName = Entry::notice_class;
    assert(RegisterClassW(&foreign));
    Entry entry(1);
    entry.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    assert(entry.stop);
    assert(!entry.create_notice_window());
    assert(GetLastError() == ERROR_CLASS_ALREADY_EXISTS);
    entry.cleanup();
    WNDCLASSW retained{};
    assert(GetClassInfoW(foreign.hInstance, foreign.lpszClassName, &retained));
    assert(retained.lpfnWndProc == DefWindowProcW);
    assert(UnregisterClassW(foreign.lpszClassName, foreign.hInstance));
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
        bool ready = false;
        for (int attempt = 0; attempt < 10 && !ready; ++attempt) {
            const int result = codex_appshot_entry_next(entry, 100, &event);
            if (result < 0 || (result == 1 && event.phase == 4)) break;
            ready = result == 1 && event.phase == 1 && !event.error && event.input_epoch > 0;
        }
        auto* owned = static_cast<Entry*>(entry);
        const HWND window = owned->notice_window;
        assert(ready && window && owned->desktop_hook && owned->wts_registered && !IsWindowVisible(window));
        uint32_t duplicate_error = 0;
        void* duplicate = codex_appshot_entry_start(mode, &duplicate_error);
        const auto before = std::chrono::steady_clock::now();
        owned->stopping.store(true);
        SetEvent(owned->stop);
        owned->thread.join();
        assert(!IsWindow(window) && !owned->desktop_hook && !owned->wts_registered && owned->closed.load());
        for (const auto& pending : owned->events) assert(pending.phase != 4);
        codex_appshot_entry_stop(entry);
        const auto elapsed = std::chrono::steady_clock::now() - before;
        assert(ready);
        assert(!duplicate && duplicate_error == ERROR_ALREADY_EXISTS);
        assert(elapsed < std::chrono::seconds(2));
    }
}

int main(int argc, char** argv) {
    chord_contract();
    reset_barrier_contract();
    notice_contract_without_system_observers();
    foreign_window_class_is_not_removed();
    stop_during_message_flood();
    if (argc == 2 && std::strcmp(argv[1], "--lifecycle") == 0) {
        lifecycle_probe();
        std::cout << "PASS hidden HWND/WTS/WinEvent/keyboard installed, duplicate rejection, unregister/stop/join and re-registration; no actual session change, physical key or capture proof\n";
    } else {
        std::cout << "PASS modifier chord/reset barrier, live epoch/queue invalidation, this-session notice mapping, partial cleanup, ABI and stop during continuous message flood; no system observer registration\n";
    }
    return 0;
}
