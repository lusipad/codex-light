#pragma once
#include <stdint.h>

// Synchronous worker-only ABI. Do not call on the Tauri/UI thread.
// code 0 means PNG success; text status is independent and never promises full text.
typedef struct CodexAppshotResult {
    uint32_t code;
    int32_t hresult;
    uint32_t width;
    uint32_t height;
    uint32_t text_length;
    uint32_t text_status; // 0 unavailable, 1 available/unknown extent, 2 partial, 3 error
    uint32_t text_source; // 0 none, 1 TextPattern, 2 ValuePattern, 3 mixed
} CodexAppshotResult;

// Return codes: 0 PNG success, 1 invalid argument, 2 target closed/identity changed,
// 3 unsupported, 4 frame timeout, 5 permission denied, 6 capture failed, 7 output failed.
// creation_filetime is GetProcessTimes' creation FILETIME as an unsigned 64-bit value.
// png_path is an absolute UTF-16 path; CREATE_NEW prevents overwriting existing files.
// text_capacity is 1..262144; text_length excludes the trailing NUL.
// Local resource limits: edge <=16384, pixels <=33554432, encoded PNG <=25 MiB.
// These are implementation limits pending runtime validation, not official limits.
// The process handle and WGC item lock their observed lifetimes, but do not prove
// that same-process HWND reuse before item acquisition is completely eliminated.
#ifdef __cplusplus
extern "C" {
int32_t __cdecl codex_appshot_capture(uint64_t hwnd, uint32_t pid,
    uint64_t creation_filetime, const wchar_t* png_path, uint32_t frame_timeout_ms,
    CodexAppshotResult* result, char* utf8_text, uint32_t text_capacity) noexcept;
}
#endif
