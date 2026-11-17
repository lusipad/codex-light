//! Metadata for the already latched target, never a new foreground lookup.
//! `process:<path>` is an evidenced consumer format, not proof that the official
//! helper chooses this identifier for every Windows application type.
use crate::appshots_host::CaptureTarget;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TargetMetadata {
    pub app_identifier: String,
    pub display_name: String,
    pub window_title: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TargetError {
    InvalidTarget,
    TargetChanged,
    Unreadable,
    Unsupported,
}

trait TargetReader {
    fn validate(&self, target: CaptureTarget) -> Result<(), TargetError>;
    fn read(&self, target: CaptureTarget) -> Result<(String, Option<String>), TargetError>;
}

fn metadata_with(
    reader: &impl TargetReader,
    target: CaptureTarget,
) -> Result<TargetMetadata, TargetError> {
    if target.hwnd == 0 || target.pid == 0 || target.process_creation_time == 0 {
        return Err(TargetError::InvalidTarget);
    }
    reader.validate(target)?;
    let (process_path, window_title) = reader.read(target)?;
    reader.validate(target)?;
    // QueryFullProcessImageNameW returns a Win32 absolute path. Keep its actual
    // spelling for identity and apply only the official eDN filename fallback.
    let bytes = process_path.as_bytes();
    let absolute = (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/'))
        || process_path.starts_with("\\\\");
    if !absolute || process_path.chars().any(char::is_control) {
        return Err(TargetError::Unreadable);
    }
    let filename = process_path.rsplit(['\\', '/']).next().unwrap_or("");
    let display_name = if filename.to_ascii_lowercase().ends_with(".exe") {
        &filename[..filename.len() - 4]
    } else {
        filename
    };
    if display_name.trim().is_empty() {
        return Err(TargetError::Unreadable);
    }
    Ok(TargetMetadata {
        app_identifier: format!("process:{process_path}"),
        display_name: display_name.to_owned(),
        window_title,
    })
}

pub(crate) fn read_target_metadata(target: CaptureTarget) -> Result<TargetMetadata, TargetError> {
    #[cfg(windows)]
    {
        if target.hwnd == 0 || target.pid == 0 || target.process_creation_time == 0 {
            return Err(TargetError::InvalidTarget);
        }
        let reader = win::Reader::open(target.pid)?;
        metadata_with(&reader, target)
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err(TargetError::Unsupported)
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{ffi::c_void, ptr::NonNull};

    #[repr(C)]
    #[derive(Default)]
    pub(super) struct FileTime {
        low: u32,
        high: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
        pub(super) fn GetProcessTimes(
            handle: *mut c_void,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn GetExitCodeProcess(handle: *mut c_void, code: *mut u32) -> i32;
        fn QueryFullProcessImageNameW(
            handle: *mut c_void,
            flags: u32,
            path: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn SetLastError(error: u32);
        fn GetLastError() -> u32;
        fn GetModuleHandleW(name: *const u16) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn IsWindow(hwnd: *mut c_void) -> i32;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, pid: *mut u32) -> u32;
    }

    pub(super) type CaptionReader = unsafe extern "system" fn(*mut c_void, *mut u16, i32) -> i32;

    fn caption_reader() -> Option<CaptionReader> {
        let module_name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        // User32 is already a static import above, so its module remains loaded.
        // This optional entry point must not become a mandatory loader import.
        let module = unsafe { GetModuleHandleW(module_name.as_ptr()) };
        if module.is_null() {
            return None;
        }
        let address = unsafe { GetProcAddress(module, b"InternalGetWindowText\0".as_ptr()) };
        if address.is_null() {
            None
        } else {
            // Exact documented WINAPI signature for this named User32 export.
            Some(unsafe { std::mem::transmute::<*mut c_void, CaptionReader>(address) })
        }
    }

    pub(super) fn read_caption(
        target: CaptureTarget,
        read: Option<CaptionReader>,
    ) -> Result<Option<String>, TargetError> {
        let read = read.ok_or(TargetError::Unreadable)?;
        // Read the system caption directly, including for our own windows.
        // GetWindowTextW would synchronously send WM_GETTEXT in-process and can
        // deadlock against UI shutdown waiting for this background owner.
        let mut title = vec![0u16; 32_768];
        unsafe {
            SetLastError(0);
        }
        let count = unsafe {
            read(
                target.hwnd as usize as *mut c_void,
                title.as_mut_ptr(),
                title.len() as i32,
            )
        };
        if count < 0
            || count as usize >= title.len() - 1
            || (count == 0 && unsafe { GetLastError() } != 0)
        {
            return Err(TargetError::Unreadable);
        }
        if count == 0 {
            Ok(None)
        } else {
            String::from_utf16(&title[..count as usize])
                .map(Some)
                .map_err(|_| TargetError::Unreadable)
        }
    }

    pub(super) struct Reader(NonNull<c_void>);
    impl Reader {
        pub fn open(pid: u32) -> Result<Self, TargetError> {
            NonNull::new(unsafe { OpenProcess(0x1000, 0, pid) })
                .map(Self)
                .ok_or(TargetError::Unreadable)
        }
        pub(super) fn creation_time(&self) -> Result<u64, TargetError> {
            let mut creation = FileTime::default();
            let mut exit = FileTime::default();
            let mut kernel = FileTime::default();
            let mut user = FileTime::default();
            if unsafe {
                GetProcessTimes(
                    self.0.as_ptr(),
                    &mut creation,
                    &mut exit,
                    &mut kernel,
                    &mut user,
                )
            } == 0
            {
                return Err(TargetError::Unreadable);
            }
            if exit.low != 0 || exit.high != 0 {
                return Err(TargetError::TargetChanged);
            }
            Ok((u64::from(creation.high) << 32) | u64::from(creation.low))
        }
    }
    impl Drop for Reader {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0.as_ptr());
            }
        }
    }
    impl TargetReader for Reader {
        fn validate(&self, target: CaptureTarget) -> Result<(), TargetError> {
            let hwnd = target.hwnd as usize as *mut c_void;
            let mut pid = 0;
            let mut exit_code = 0;
            if unsafe { IsWindow(hwnd) } == 0
                || unsafe { GetWindowThreadProcessId(hwnd, &mut pid) } == 0
                || pid != target.pid
            {
                return Err(TargetError::TargetChanged);
            }
            if self.creation_time()? != target.process_creation_time {
                return Err(TargetError::TargetChanged);
            }
            if unsafe { GetExitCodeProcess(self.0.as_ptr(), &mut exit_code) } == 0 {
                return Err(TargetError::Unreadable);
            }
            if exit_code != 259 {
                return Err(TargetError::TargetChanged);
            }
            Ok(())
        }
        fn read(&self, target: CaptureTarget) -> Result<(String, Option<String>), TargetError> {
            let mut path = vec![0u16; 32_768];
            let mut size = path.len() as u32;
            if unsafe {
                QueryFullProcessImageNameW(self.0.as_ptr(), 0, path.as_mut_ptr(), &mut size)
            } == 0
                || size == 0
                || size as usize >= path.len()
            {
                return Err(TargetError::Unreadable);
            }
            let path =
                String::from_utf16(&path[..size as usize]).map_err(|_| TargetError::Unreadable)?;
            let title = read_caption(target, caption_reader())?;
            Ok((path, title))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    struct Fixture {
        validations: Cell<u32>,
        fail_at: u32,
        path: &'static str,
        unreadable: bool,
    }
    impl TargetReader for Fixture {
        fn validate(&self, _: CaptureTarget) -> Result<(), TargetError> {
            let step = self.validations.get() + 1;
            self.validations.set(step);
            if step == self.fail_at {
                Err(TargetError::TargetChanged)
            } else {
                Ok(())
            }
        }
        fn read(&self, _: CaptureTarget) -> Result<(String, Option<String>), TargetError> {
            if self.unreadable {
                return Err(TargetError::Unreadable);
            }
            Ok((self.path.into(), Some("  Original title 中文  ".into())))
        }
    }
    fn target() -> CaptureTarget {
        CaptureTarget {
            hwnd: 12,
            pid: 34,
            process_creation_time: 56,
        }
    }
    fn fixture() -> Fixture {
        Fixture {
            validations: Cell::new(0),
            fail_at: 0,
            path: r"C:\Apps\Actual App.EXE",
            unreadable: false,
        }
    }
    #[test]
    fn target_metadata_keeps_original_title_and_real_path_fallback() {
        let reader = fixture();
        let metadata = metadata_with(&reader, target()).unwrap();
        assert_eq!(reader.validations.get(), 2);
        assert_eq!(metadata.app_identifier, r"process:C:\Apps\Actual App.EXE");
        assert_eq!(metadata.display_name, "Actual App");
        assert_eq!(
            metadata.window_title.as_deref(),
            Some("  Original title 中文  ")
        );
    }
    #[test]
    fn target_metadata_rejects_before_or_after_identity_change() {
        for fail_at in [1, 2] {
            let mut reader = fixture();
            reader.fail_at = fail_at;
            assert_eq!(
                metadata_with(&reader, target()),
                Err(TargetError::TargetChanged)
            );
        }
    }
    #[test]
    fn target_metadata_rejects_unreadable_relative_and_empty_names() {
        for path in ["relative.exe", r"C:\Apps\", r"C:\.exe", "C:\\bad\n.exe"] {
            let mut reader = fixture();
            reader.path = path;
            assert_eq!(
                metadata_with(&reader, target()),
                Err(TargetError::Unreadable)
            );
        }
        let mut reader = fixture();
        reader.unreadable = true;
        assert_eq!(
            metadata_with(&reader, target()),
            Err(TargetError::Unreadable)
        );
        let reader = fixture();
        let mut invalid = target();
        invalid.hwnd = 0;
        assert_eq!(
            metadata_with(&reader, invalid),
            Err(TargetError::InvalidTarget)
        );
        assert_eq!(reader.validations.get(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn target_metadata_reads_only_owned_hidden_fixture_window() {
        use std::{ffi::c_void, ptr::null_mut};
        #[link(name = "user32")]
        unsafe extern "system" {
            fn CreateWindowExW(
                ex: u32,
                class: *const u16,
                title: *const u16,
                style: u32,
                x: i32,
                y: i32,
                width: i32,
                height: i32,
                parent: *mut c_void,
                menu: *mut c_void,
                instance: *mut c_void,
                param: *mut c_void,
            ) -> *mut c_void;
            fn DestroyWindow(hwnd: *mut c_void) -> i32;
        }
        struct OwnedWindow(*mut c_void);
        impl Drop for OwnedWindow {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "Private B3 metadata fixture 中文\0"
            .encode_utf16()
            .collect();
        // No WS_VISIBLE, ShowWindow, foreground lookup or screenshot. The test
        // reads only its own test-process window and closes it through RAII.
        let window = OwnedWindow(unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                0,
                0,
                0,
                100,
                100,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
            )
        });
        assert!(!window.0.is_null());
        let pid = std::process::id();
        let reader = win::Reader::open(pid).unwrap();
        let target = CaptureTarget {
            hwnd: window.0 as usize as u64,
            pid,
            process_creation_time: reader.creation_time().unwrap(),
        };
        let metadata = read_target_metadata(target).unwrap();
        assert_eq!(
            metadata.window_title.as_deref(),
            Some("Private B3 metadata fixture 中文")
        );
        assert_eq!(
            std::fs::canonicalize(metadata.app_identifier.strip_prefix("process:").unwrap())
                .unwrap(),
            std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap()
        );
        let mut wrong_creation = target;
        wrong_creation.process_creation_time += 1;
        assert_eq!(
            read_target_metadata(wrong_creation),
            Err(TargetError::TargetChanged)
        );
        let mut wrong_pid = target;
        wrong_pid.pid += 1;
        assert_eq!(
            metadata_with(&reader, wrong_pid),
            Err(TargetError::TargetChanged)
        );
        drop(window);
        assert_eq!(
            read_target_metadata(target),
            Err(TargetError::TargetChanged)
        );
    }

    #[cfg(windows)]
    #[test]
    fn target_metadata_caption_does_not_wait_for_owned_window_message_pump() {
        use std::{ffi::c_void, ptr::null_mut, sync::mpsc, thread, time::Duration};
        #[link(name = "user32")]
        unsafe extern "system" {
            fn CreateWindowExW(
                ex: u32,
                class: *const u16,
                title: *const u16,
                style: u32,
                x: i32,
                y: i32,
                width: i32,
                height: i32,
                parent: *mut c_void,
                menu: *mut c_void,
                instance: *mut c_void,
                param: *mut c_void,
            ) -> *mut c_void;
            fn DestroyWindow(hwnd: *mut c_void) -> i32;
        }
        let (target_tx, target_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let owner = thread::spawn(move || {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title: Vec<u16> = "Private unpumped caption 中文\0".encode_utf16().collect();
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    title.as_ptr(),
                    0,
                    0,
                    0,
                    100,
                    100,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };
            assert!(!hwnd.is_null());
            let pid = std::process::id();
            let reader = win::Reader::open(pid).unwrap();
            target_tx
                .send(CaptureTarget {
                    hwnd: hwnd as usize as u64,
                    pid,
                    process_creation_time: reader.creation_time().unwrap(),
                })
                .unwrap();
            // Deliberately no GetMessage/PeekMessage. Releasing this owner
            // destroys its private window, unblocking even the old bad reader.
            let _ = release_rx.recv();
            assert_ne!(unsafe { DestroyWindow(hwnd) }, 0);
        });
        let target = target_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (result_tx, result_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            let _ = result_tx.send(read_target_metadata(target));
        });
        let timely_result = result_rx.recv_timeout(Duration::from_secs(2));
        // Cleanup precedes every assertion: red tests must not leave a thread
        // stuck in the old synchronous WM_GETTEXT call.
        let _ = release_tx.send(());
        owner.join().unwrap();
        reader.join().unwrap();
        let metadata = timely_result
            .expect("caption reader waited for the window message pump")
            .unwrap();
        assert_eq!(
            metadata.window_title.as_deref(),
            Some("Private unpumped caption 中文")
        );
    }

    #[cfg(windows)]
    #[test]
    fn target_metadata_missing_caption_api_is_unreadable_without_fallback() {
        assert_eq!(
            win::read_caption(target(), None),
            Err(TargetError::Unreadable)
        );
    }
}
