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
    input_epoch: u64,
    reset_reason: u32,
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
    fn codex_appshot_entry_epoch(handle: *mut c_void) -> u64;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResetReason {
    Desktop,
    Lock,
    Unlock,
    Logoff,
    Disconnect,
    Connect,
    RemoteControl,
    DesktopReady,
}

#[derive(Debug)]
pub(crate) enum EntryEvent {
    Installed {
        input_epoch: u64,
    },
    Down {
        input_epoch: u64,
        target: Result<CaptureTarget, u32>,
    },
    Up {
        input_epoch: u64,
    },
    Reset {
        input_epoch: u64,
        reason: ResetReason,
    },
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
    /// Actual native atomic epoch, not a time-based estimate or cached event.
    /// Reconcile it before using dequeued targets or late results: native Reset
    /// may already have invalidated input before its queued event is consumed.
    /// Zero invalidates the registration, not a Reset to pass to input_reset:
    /// the native owner is not installed, stopping or closed. This cannot detect
    /// Windows silently removing a low-level hook.
    pub fn input_epoch(&self) -> u64 {
        #[cfg(windows)]
        unsafe {
            codex_appshot_entry_epoch(self.0.as_ptr())
        }
        #[cfg(not(windows))]
        {
            0
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
    if matches!(event.phase, 1 | 2 | 3 | 5) && event.input_epoch == 0 {
        return EntryEvent::Failed(13);
    }
    match event.phase {
        1 if event.error == 0 => EntryEvent::Installed {
            input_epoch: event.input_epoch,
        },
        2 => EntryEvent::Down {
            input_epoch: event.input_epoch,
            target: if event.error != 0 {
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
            },
        },
        3 if event.error == 0 => EntryEvent::Up {
            input_epoch: event.input_epoch,
        },
        5 if event.error == 0 => {
            let reason = match event.reset_reason {
                1 => ResetReason::Desktop,
                2 => ResetReason::Lock,
                3 => ResetReason::Unlock,
                4 => ResetReason::Logoff,
                5 => ResetReason::Disconnect,
                6 => ResetReason::Connect,
                7 => ResetReason::RemoteControl,
                8 => ResetReason::DesktopReady,
                _ => return EntryEvent::Failed(13),
            };
            EntryEvent::Reset {
                input_epoch: event.input_epoch,
                reason,
            }
        }
        _ => EntryEvent::Failed(if event.error == 0 { 13 } else { event.error }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appshots_native_entry_layout_and_decode_require_actual_target_identity() {
        assert_eq!(std::mem::size_of::<NativeEvent>(), 56);
        assert_eq!(std::mem::offset_of!(NativeEvent, hwnd), 8);
        assert_eq!(std::mem::offset_of!(NativeEvent, pid), 16);
        assert_eq!(std::mem::offset_of!(NativeEvent, creation_filetime), 24);
        assert_eq!(std::mem::offset_of!(NativeEvent, latched_filetime), 32);
        assert_eq!(std::mem::offset_of!(NativeEvent, input_epoch), 40);
        assert_eq!(std::mem::offset_of!(NativeEvent, reset_reason), 48);
        assert!(matches!(
            decode(NativeEvent {
                phase: 1,
                input_epoch: 1,
                ..Default::default()
            }),
            EntryEvent::Installed { input_epoch: 1 }
        ));
        assert!(matches!(
            decode(NativeEvent {
                phase: 2,
                input_epoch: 1,
                ..Default::default()
            }),
            EntryEvent::Down { target: Err(_), .. }
        ));
        let event = || NativeEvent {
            phase: 2,
            hwnd: 7,
            pid: 8,
            creation_filetime: 9,
            latched_filetime: 10,
            input_epoch: 2,
            ..Default::default()
        };
        let EntryEvent::Down {
            input_epoch: 2,
            target: Ok(target),
        } = decode(event())
        else {
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
            EntryEvent::Down { target: Err(_), .. }
        ));
        assert!(matches!(
            decode(NativeEvent {
                error: 5,
                ..event()
            }),
            EntryEvent::Down { target: Err(5), .. }
        ));
        assert!(matches!(
            decode(NativeEvent {
                phase: 3,
                input_epoch: 2,
                ..Default::default()
            }),
            EntryEvent::Up { input_epoch: 2 }
        ));
        assert!(matches!(
            decode(NativeEvent::default()),
            EntryEvent::Failed(13)
        ));
    }

    #[test]
    fn appshots_native_entry_reset_reasons_and_nonzero_business_epochs_are_strict() {
        for phase in [1, 2, 3, 5] {
            assert!(matches!(
                decode(NativeEvent {
                    phase,
                    reset_reason: 1,
                    ..Default::default()
                }),
                EntryEvent::Failed(13)
            ));
        }
        for (code, reason) in [
            (1, ResetReason::Desktop),
            (2, ResetReason::Lock),
            (3, ResetReason::Unlock),
            (4, ResetReason::Logoff),
            (5, ResetReason::Disconnect),
            (6, ResetReason::Connect),
            (7, ResetReason::RemoteControl),
            (8, ResetReason::DesktopReady),
        ] {
            assert!(
                matches!(decode(NativeEvent { phase: 5, input_epoch: 7, reset_reason: code, ..Default::default() }),
                EntryEvent::Reset { input_epoch: 7, reason: actual } if actual == reason)
            );
        }
        for code in [0, 9, u32::MAX] {
            assert!(matches!(
                decode(NativeEvent {
                    phase: 5,
                    input_epoch: 7,
                    reset_reason: code,
                    ..Default::default()
                }),
                EntryEvent::Failed(13)
            ));
        }
        assert!(matches!(
            decode(NativeEvent {
                phase: 5,
                input_epoch: 7,
                reset_reason: 1,
                error: 5,
                ..Default::default()
            }),
            EntryEvent::Failed(5)
        ));
        assert!(matches!(
            decode(NativeEvent {
                phase: 4,
                error: 6,
                ..Default::default()
            }),
            EntryEvent::Failed(6)
        ));
    }
}
