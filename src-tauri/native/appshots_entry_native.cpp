#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
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
    bool queued = false, closed = false, overflowed = false;
    codex_appshots::ModifierChord chord;

    explicit Entry(uint32_t value) : mode(value) {}
    ~Entry() { if (stop) CloseHandle(stop); }
    void push(CodexAppshotEntryEvent event) {
        std::lock_guard lock(mutex);
        if (overflowed) return;
        if (events.size() >= 64) {
            events.clear();
            event = {4, ERROR_NOT_ENOUGH_QUOTA};
            overflowed = true;
            SetEvent(stop);
        }
        events.push_back(event);
        changed.notify_all();
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
        if (code == HC_ACTION && current && (message == WM_KEYDOWN || message == WM_SYSKEYDOWN || message == WM_KEYUP || message == WM_SYSKEYUP)) {
            const auto& key = *reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
            // Our physical-gesture policy ignores injected keys. This is an own
            // implementation policy, not a recovered official helper guarantee.
            if (!(key.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) &&
                (key.vkCode == VK_MENU || key.vkCode == VK_LMENU || key.vkCode == VK_RMENU ||
                 key.vkCode == VK_SHIFT || key.vkCode == VK_LSHIFT || key.vkCode == VK_RSHIFT)) {
                const UINT scan = key.scanCode | ((key.flags & LLKHF_EXTENDED) ? 0xE000 : 0);
                const UINT mapped = MapVirtualKeyW(scan, MAPVK_VSC_TO_VK_EX);
                const UINT vk = mapped ? mapped : key.vkCode;
                const UINT left = current->mode == 1 ? VK_LMENU : VK_LSHIFT;
                const UINT right = current->mode == 1 ? VK_RMENU : VK_RSHIFT;
                if (vk == left || vk == right) {
                    const auto phase = current->chord.update(vk == right, message == WM_KEYDOWN || message == WM_SYSKEYDOWN);
                    if (phase) {
                        try { current->push(phase == 2 ? current->target() : CodexAppshotEntryEvent{3}); }
                        catch (...) { SetEvent(current->stop); }
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
        HHOOK hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, GetModuleHandleW(nullptr), 0);
        try {
            if (!hook) push({4, GetLastError()});
            else {
                push({1});
                pump();
            }
        } catch (...) { /* Close below, never unwind through Win32 or C ABI. */ }
        if (hook) UnhookWindowsHookEx(hook);
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
        return 1;
    } catch (...) { return -1; }
}

extern "C" void __cdecl codex_appshot_entry_stop(void* handle) noexcept {
    if (!handle) return;
    auto* entry = static_cast<Entry*>(handle);
    SetEvent(entry->stop);
    if (entry->thread.joinable()) entry->thread.join();
    delete entry;
    occupied.store(false);
}
