//! Owned native listener. Construct, poll and drop on a background owner thread.
//! No renderer commands, registration policy, key injection or capture here.
use crate::{appshots_entry::Hotkey, appshots_host::CaptureTarget};
use std::{ffi::c_void, ptr::NonNull, time::Duration};

#[repr(C)]
#[derive(Default)]
struct NativeEvent {
    phase: u32,
    error: u32,
    hwnd: u64,
    pid: u32,
    creation_filetime: u64,
    latched_filetime: u64,
}

#[cfg(windows)]
unsafe extern "C" {
    fn codex_appshot_entry_start(mode: u32, error: *mut u32) -> *mut c_void;
    fn codex_appshot_entry_next(
        handle: *mut c_void,
        timeout_ms: u32,
        event: *mut NativeEvent,
    ) -> i32;
    fn codex_appshot_entry_stop(handle: *mut c_void);
}

#[derive(Debug)]
pub(crate) enum EntryEvent {
    Installed,
    Down(Result<CaptureTarget, u32>),
    Up,
    Failed(u32),
    Closed,
}

pub(crate) struct NativeEntry(NonNull<c_void>);
impl NativeEntry {
    pub fn start(hotkey: Hotkey) -> Result<Self, u32> {
        #[cfg(windows)]
        {
            let mode = match hotkey {
                Hotkey::DoubleAlt => 1,
                Hotkey::DoubleShift => 2,
            };
            let mut error = 0;
            // Exclusive ownership; next and Drop cannot run concurrently. The
            // native implementation owns/join its message thread before free.
            let handle = unsafe { codex_appshot_entry_start(mode, &mut error) };
            NonNull::new(handle).map(Self).ok_or(error)
        }
        #[cfg(not(windows))]
        {
            let _ = hotkey;
            Err(50)
        }
    }
    pub fn next(&mut self, timeout: Duration) -> Option<EntryEvent> {
        #[cfg(windows)]
        {
            let mut event = NativeEvent::default();
            let outcome = unsafe {
                codex_appshot_entry_next(
                    self.0.as_ptr(),
                    timeout.as_millis().min(1000) as u32,
                    &mut event,
                )
            };
            match outcome {
                0 => None,
                1 => Some(decode(event)),
                _ => Some(EntryEvent::Closed),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = timeout;
            Some(EntryEvent::Closed)
        }
    }
}
impl Drop for NativeEntry {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            codex_appshot_entry_stop(self.0.as_ptr());
        }
    }
}

fn decode(event: NativeEvent) -> EntryEvent {
    match event.phase {
        1 if event.error == 0 => EntryEvent::Installed,
        2 => EntryEvent::Down(if event.error != 0 {
            Err(event.error)
        } else if event.hwnd == 0
            || event.pid == 0
            || event.creation_filetime == 0
            || event.latched_filetime < event.creation_filetime
        {
            Err(1400)
        } else {
            Ok(CaptureTarget {
                hwnd: event.hwnd,
                pid: event.pid,
                process_creation_time: event.creation_filetime,
            })
        }),
        3 if event.error == 0 => EntryEvent::Up,
        _ => EntryEvent::Failed(if event.error == 0 { 13 } else { event.error }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appshots_native_entry_layout_and_decode_require_actual_target_identity() {
        assert_eq!(std::mem::size_of::<NativeEvent>(), 40);
        assert_eq!(std::mem::offset_of!(NativeEvent, hwnd), 8);
        assert_eq!(std::mem::offset_of!(NativeEvent, pid), 16);
        assert_eq!(std::mem::offset_of!(NativeEvent, creation_filetime), 24);
        assert_eq!(std::mem::offset_of!(NativeEvent, latched_filetime), 32);
        assert!(matches!(
            decode(NativeEvent {
                phase: 1,
                ..Default::default()
            }),
            EntryEvent::Installed
        ));
        assert!(matches!(
            decode(NativeEvent {
                phase: 2,
                ..Default::default()
            }),
            EntryEvent::Down(Err(_))
        ));
        let event = || NativeEvent {
            phase: 2,
            hwnd: 7,
            pid: 8,
            creation_filetime: 9,
            latched_filetime: 10,
            ..Default::default()
        };
        let EntryEvent::Down(Ok(target)) = decode(event()) else {
            panic!("latched target expected")
        };
        assert_eq!(
            (target.hwnd, target.pid, target.process_creation_time),
            (7, 8, 9)
        );
        assert!(matches!(
            decode(NativeEvent {
                creation_filetime: 11,
                ..event()
            }),
            EntryEvent::Down(Err(_))
        ));
        assert!(matches!(
            decode(NativeEvent {
                error: 5,
                ..event()
            }),
            EntryEvent::Down(Err(5))
        ));
        assert!(matches!(
            decode(NativeEvent {
                phase: 3,
                ..Default::default()
            }),
            EntryEvent::Up
        ));
        assert!(matches!(
            decode(NativeEvent::default()),
            EntryEvent::Failed(13)
        ));
    }
}
