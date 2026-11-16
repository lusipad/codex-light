#pragma once
#include <stdint.h>

// An owned listener; never pass this pointer to the renderer. One per process.
// start only starts its message thread. Await a Ready event before treating the
// hook as installed. Windows may silently remove a timed-out low-level hook;
// Ready is not proof of indefinitely active or physically tested registration.
typedef struct CodexAppshotEntryEvent {
    uint32_t phase; // 1 Ready, 2 Down, 3 Up, 4 Error
    uint32_t error;
    uint64_t hwnd;
    uint32_t pid;
    uint64_t creation_filetime;
    uint64_t latched_filetime;
} CodexAppshotEntryEvent;

#ifdef __cplusplus
extern "C" {
void* __cdecl codex_appshot_entry_start(uint32_t mode, uint32_t* error) noexcept;
// mode: 1 left+right Alt, 2 left+right Shift. No other key syntax is inferred.
// next: 1 event, 0 timeout, -1 closed/invalid. timeout is capped at 1000ms.
int32_t __cdecl codex_appshot_entry_next(void* handle, uint32_t timeout_ms,
    CodexAppshotEntryEvent* event) noexcept;
// Sole owner calls stop after its reader returns. No concurrent next/stop.
void __cdecl codex_appshot_entry_stop(void* handle) noexcept;
}

namespace codex_appshots {
// Only the chosen pair reaches this state machine. No key/text history is kept.
class ModifierChord {
    bool left_ = false, right_ = false, pressed_ = false;
public:
    uint32_t update(bool right, bool down) noexcept {
        (right ? right_ : left_) = down;
        const bool pressed = left_ && right_;
        if (pressed == pressed_) return 0;
        pressed_ = pressed;
        return pressed ? 2 : 3;
    }
};
}
#endif
