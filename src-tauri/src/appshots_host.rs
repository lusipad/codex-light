//! Internal parent-side worker execution. Target selection, permission and routing
//! belong to the caller; this module does not expose a renderer command.
use crate::appshots_worker::{
    WorkerCapture, WorkerError, WorkerRequest, WorkerResponse, ARGUMENT, MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::oneshot,
};
use uuid::Uuid;

const MAX_PNG_BYTES: u64 = 25 * 1024 * 1024;
const MAX_DIMENSION: u32 = 16_384;
// Includes an 8K frame while bounding decoded RGBA to 128 MiB.
const MAX_PIXELS: u64 = 33_554_432;

#[derive(Clone, Copy, Debug)]
pub(crate) struct CaptureTarget {
    pub hwnd: u64,
    pub pid: u32,
    pub process_creation_time: u64,
}

#[derive(Debug)]
pub(crate) struct HostCapture {
    pub request_id: String,
    pub png: Vec<u8>,
    pub capture: WorkerCapture,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum HostError {
    InvalidTarget,
    InvalidOutput,
    Unavailable,
    Transport,
    ResponseTooLarge,
    InvalidResponse,
    InvalidImage,
    Worker(WorkerError),
    Cancelled,
    TimedOut,
    ReapFailed,
    CleanupFailed,
}

fn cancelled(receiver: &mut oneshot::Receiver<()>) -> bool {
    !matches!(
        receiver.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    )
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

struct RunOutput {
    root: PathBuf,
    directory: PathBuf,
    png: PathBuf,
    cleaned: bool,
}

impl RunOutput {
    fn create(root: &Path) -> Result<Self, HostError> {
        if !root.is_absolute() || root.components().any(|p| matches!(p, Component::ParentDir)) {
            return Err(HostError::InvalidOutput);
        }
        // The caller owns this existing trusted root. No user path is created.
        let root = fs::canonicalize(root).map_err(|_| HostError::InvalidOutput)?;
        if !root.is_dir() {
            return Err(HostError::InvalidOutput);
        }
        let directory = root.join(format!("appshot-{}", Uuid::new_v4()));
        fs::create_dir(&directory).map_err(|_| HostError::InvalidOutput)?;
        Ok(Self {
            png: directory.join("capture.png"),
            root,
            directory,
            cleaned: false,
        })
    }

    fn owned_directory(&self) -> bool {
        self.directory.parent() == Some(self.root.as_path())
            && fs::canonicalize(&self.root).ok().as_ref() == Some(&self.root)
            && fs::symlink_metadata(&self.directory).is_ok_and(|m| m.is_dir() && !is_reparse(&m))
            && fs::canonicalize(&self.directory).ok().as_ref() == Some(&self.directory)
    }

    fn cleanup(&mut self) -> Result<(), HostError> {
        if self.cleaned {
            return Ok(());
        }
        if !self.owned_directory() {
            return Err(HostError::CleanupFailed);
        }
        match fs::remove_file(&self.png) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(HostError::CleanupFailed),
        }
        // Never recursively remove unexpected files or traverse a junction.
        fs::remove_dir(&self.directory).map_err(|_| HostError::CleanupFailed)?;
        self.cleaned = true;
        Ok(())
    }
}

impl Drop for RunOutput {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn read_png(output: &RunOutput, capture: &WorkerCapture) -> Result<Vec<u8>, HostError> {
    if !output.owned_directory() {
        return Err(HostError::InvalidOutput);
    }
    let metadata = fs::symlink_metadata(&output.png).map_err(|_| HostError::InvalidImage)?;
    if !metadata.is_file() || is_reparse(&metadata) || metadata.len() > MAX_PNG_BYTES {
        return Err(HostError::InvalidImage);
    }
    if fs::canonicalize(&output.png).map_err(|_| HostError::InvalidImage)? != output.png {
        return Err(HostError::InvalidImage);
    }
    let mut bytes = Vec::new();
    fs::File::open(&output.png)
        .map_err(|_| HostError::InvalidImage)?
        .take(MAX_PNG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| HostError::InvalidImage)?;
    if bytes.len() as u64 > MAX_PNG_BYTES
        || bytes.len() < 33
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || bytes[8..12] != [0, 0, 0, 13]
        || &bytes[12..16] != b"IHDR"
    {
        return Err(HostError::InvalidImage);
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
        || width != capture.width
        || height != capture.height
    {
        return Err(HostError::InvalidImage);
    }
    // Decode only after the allocation bound and claimed dimensions are checked.
    let decoded = tauri::image::Image::from_bytes(&bytes).map_err(|_| HostError::InvalidImage)?;
    if decoded.width() != width || decoded.height() != height {
        return Err(HostError::InvalidImage);
    }
    Ok(bytes)
}

async fn exchange(
    command: &mut Command,
    request: &[u8],
    timeout: Duration,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<(ExitStatus, Vec<u8>), HostError> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW for our worker only.
    if cancelled(cancel) {
        return Err(HostError::Cancelled);
    }
    let mut child = command.spawn().map_err(|_| HostError::Unavailable)?;
    let (mut stdin, stdout) = match (child.stdin.take(), child.stdout.take()) {
        (Some(stdin), Some(stdout)) => (stdin, stdout),
        _ => {
            let _ = child.start_kill();
            child.wait().await.map_err(|_| HostError::ReapFailed)?;
            return Err(HostError::Transport);
        }
    };
    let result = {
        let operation = async {
            stdin
                .write_all(request)
                .await
                .map_err(|_| HostError::Transport)?;
            stdin.shutdown().await.map_err(|_| HostError::Transport)?;
            drop(stdin); // EOF is the worker's single-request boundary.
            let mut bytes = Vec::new();
            stdout
                .take((MAX_RESPONSE_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| HostError::Transport)?;
            if bytes.len() > MAX_RESPONSE_BYTES {
                return Err(HostError::ResponseTooLarge);
            }
            let status = child.wait().await.map_err(|_| HostError::Transport)?;
            Ok((status, bytes))
        };
        tokio::pin!(operation);
        tokio::select! {
            biased;
            _ = cancel => Err(HostError::Cancelled), // Sender drop is cancellation too.
            _ = tokio::time::sleep(timeout) => Err(HostError::TimedOut),
            result = &mut operation => result,
        }
    };
    if result.is_err() {
        let _ = child.start_kill();
        if child.wait().await.is_err() {
            return Err(HostError::ReapFailed);
        }
    }
    result
}

async fn capture_with_command(
    target: CaptureTarget,
    root: &Path,
    timeout: Duration,
    mut cancel: oneshot::Receiver<()>,
    mut command: Command,
) -> Result<HostCapture, HostError> {
    if cancelled(&mut cancel) {
        return Err(HostError::Cancelled);
    }
    if target.hwnd == 0 || target.pid == 0 || target.process_creation_time == 0 {
        return Err(HostError::InvalidTarget);
    }
    let deadline = tokio::time::Instant::now() + timeout;
    let mut output = RunOutput::create(root)?;
    let result = async {
        let request_id = Uuid::new_v4().to_string();
        let request = WorkerRequest {
            request_id: request_id.clone(),
            hwnd: target.hwnd,
            pid: target.pid,
            process_creation_time: target.process_creation_time,
            output_path: output
                .png
                .to_str()
                .ok_or(HostError::InvalidOutput)?
                .to_owned(),
        };
        let bytes = serde_json::to_vec(&request).map_err(|_| HostError::InvalidOutput)?;
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(HostError::InvalidOutput);
        }
        let (status, bytes) = exchange(
            &mut command,
            &bytes,
            deadline.saturating_duration_since(tokio::time::Instant::now()),
            &mut cancel,
        )
        .await?;
        if cancelled(&mut cancel) {
            return Err(HostError::Cancelled);
        }
        let response: WorkerResponse =
            serde_json::from_slice(&bytes).map_err(|_| HostError::InvalidResponse)?;
        if response.request_id.as_deref() != Some(request_id.as_str()) {
            return Err(HostError::InvalidResponse);
        }
        let capture = match (response.error, response.capture) {
            (None, Some(capture)) if status.success() => capture,
            (Some(error), None) if !status.success() => return Err(HostError::Worker(error)),
            _ => return Err(HostError::InvalidResponse),
        };
        let png = read_png(&output, &capture)?;
        if cancelled(&mut cancel) {
            return Err(HostError::Cancelled);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(HostError::TimedOut);
        }
        Ok(HostCapture {
            request_id,
            png,
            capture,
        })
    }
    .await;
    output.cleanup()?;
    result
}

/// Send cancellation and await this future to guarantee child reaping and cleanup.
/// Aborting the future itself is not a substitute for the cancellation channel.
pub(crate) async fn capture_target(
    target: CaptureTarget,
    trusted_existing_root: &Path,
    timeout: Duration,
    cancel: oneshot::Receiver<()>,
) -> Result<HostCapture, HostError> {
    let mut command = Command::new(std::env::current_exe().map_err(|_| HostError::Unavailable)?);
    command.arg(ARGUMENT);
    capture_with_command(target, trusted_existing_root, timeout, cancel, command).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appshots_worker::{TextSource, TextStatus};

    const PNG: &[u8] = include_bytes!("../icons/icon.png");

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("appshot-host-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(fs::canonicalize(root).unwrap())
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            // Remove only the two files this fixture owns, never recursively.
            let _ = fs::remove_file(self.0.join("fixture.png"));
            let _ = fs::remove_file(self.0.join("pid.txt"));
            let _ = fs::remove_dir(&self.0);
        }
    }

    fn capture() -> WorkerCapture {
        WorkerCapture {
            width: u32::from_be_bytes(PNG[16..20].try_into().unwrap()),
            height: u32::from_be_bytes(PNG[20..24].try_into().unwrap()),
            text_status: TextStatus::Unavailable,
            text_source: TextSource::None,
            text: None,
        }
    }

    fn target() -> CaptureTarget {
        // Transport fixtures never inspect a window or use this target.
        CaptureTarget {
            hwnd: 1,
            pid: 1,
            process_creation_time: 1,
        }
    }

    fn assert_no_runs(root: &TestRoot) {
        assert!(fs::read_dir(&root.0).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("appshot-")
        }));
    }

    #[test]
    fn appshots_host_png_checks_claimed_dimensions_and_allocation_before_decode() {
        let root = TestRoot::new();
        let mut output = RunOutput::create(&root.0).unwrap();
        fs::write(&output.png, PNG).unwrap();
        assert_eq!(read_png(&output, &capture()).unwrap(), PNG);
        let mut wrong = capture();
        wrong.width += 1;
        assert_eq!(read_png(&output, &wrong), Err(HostError::InvalidImage));
        let mut bytes = PNG.to_vec();
        bytes[16..20].copy_from_slice(&MAX_DIMENSION.to_be_bytes());
        bytes[20..24].copy_from_slice(&MAX_DIMENSION.to_be_bytes());
        wrong.width = MAX_DIMENSION;
        wrong.height = MAX_DIMENSION;
        fs::write(&output.png, bytes).unwrap();
        assert_eq!(read_png(&output, &wrong), Err(HostError::InvalidImage));
        fs::write(&output.png, b"not a png").unwrap();
        assert_eq!(read_png(&output, &capture()), Err(HostError::InvalidImage));
        output.cleanup().unwrap();
        assert_no_runs(&root);
    }

    #[test]
    fn appshots_host_cleanup_preserves_unowned_files_and_never_recurses() {
        let root = TestRoot::new();
        fs::write(root.0.join("fixture.png"), b"root sentinel").unwrap();
        let mut output = RunOutput::create(&root.0).unwrap();
        let unexpected = output.directory.join("unknown.txt");
        fs::write(&unexpected, b"run sentinel").unwrap();
        fs::write(&output.png, PNG).unwrap();
        assert_eq!(output.cleanup(), Err(HostError::CleanupFailed));
        assert_eq!(fs::read(&unexpected).unwrap(), b"run sentinel");
        assert_eq!(
            fs::read(root.0.join("fixture.png")).unwrap(),
            b"root sentinel"
        );
        fs::remove_file(unexpected).unwrap();
        output.cleanup().unwrap();
        assert_no_runs(&root);
    }

    #[cfg(windows)]
    fn fixture(root: &TestRoot, mode: &str) -> Command {
        fs::write(root.0.join("fixture.png"), PNG).unwrap();
        let mut command = Command::new("pwsh");
        command.args(["-NoProfile", "-NonInteractive", "-Command", r#"
$ErrorActionPreference = 'Stop'
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
[IO.File]::WriteAllText($env:APP_SHOT_TEST_PID, [string]$PID)
if ($env:APP_SHOT_TEST_MODE -eq 'hang') { Start-Sleep -Seconds 30; exit 8 }
if ($env:APP_SHOT_TEST_MODE -eq 'overflow') {
  [Console]::Out.Write(('x' * 2097153)); [Console]::Out.Flush()
  Start-Sleep -Seconds 30; exit 8
}
if ($env:APP_SHOT_TEST_MODE -eq 'worker_error') {
  [Console]::Out.Write((@{requestId=$r.requestId; error='target_changed'; capture=$null} | ConvertTo-Json -Compress))
  exit 3
}
[IO.File]::Copy($env:APP_SHOT_TEST_PNG, $r.outputPath)
$cap = @{width=[uint32]$env:APP_SHOT_TEST_WIDTH; height=[uint32]$env:APP_SHOT_TEST_HEIGHT; textStatus='unavailable'; textSource='none'; text=$null}
$result = @{requestId=$r.requestId; error=$null; capture=$cap}
if ($env:APP_SHOT_TEST_MODE -eq 'wrong_id') { $result.requestId = 'other-request' }
if ($env:APP_SHOT_TEST_MODE -eq 'both') { $result.error = 'capture_failed' }
if ($env:APP_SHOT_TEST_MODE -eq 'extra_path') { $result.outputPath = $r.outputPath }
if ($env:APP_SHOT_TEST_MODE -eq 'bad_png') { [IO.File]::WriteAllText($r.outputPath, 'bad image') }
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
exit 0
"#]);
        command
            .env("APP_SHOT_TEST_PID", root.0.join("pid.txt"))
            .env("APP_SHOT_TEST_PNG", root.0.join("fixture.png"))
            .env("APP_SHOT_TEST_MODE", mode)
            .env("APP_SHOT_TEST_WIDTH", capture().width.to_string())
            .env("APP_SHOT_TEST_HEIGHT", capture().height.to_string());
        command
    }

    #[cfg(windows)]
    fn assert_fixture_exited(root: &TestRoot) {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
            fn GetExitCodeProcess(process: *mut c_void, code: *mut u32) -> i32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        let pid: u32 = fs::read_to_string(root.0.join("pid.txt"))
            .unwrap()
            .parse()
            .unwrap();
        unsafe {
            let process = OpenProcess(0x1000, 0, pid);
            if !process.is_null() {
                let mut code = 259;
                let read = GetExitCodeProcess(process, &mut code);
                CloseHandle(process);
                assert_ne!(read, 0);
                assert_ne!(code, 259, "owned fixture process is still running");
            }
        }
    }

    #[cfg(windows)]
    async fn wait_for_fixture(root: &TestRoot) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while !root.0.join("pid.txt").is_file() {
            assert!(
                tokio::time::Instant::now() < deadline,
                "fixture never read EOF"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn appshots_host_real_process_eof_success_and_invalid_responses() {
        for mode in [
            "success",
            "wrong_id",
            "both",
            "extra_path",
            "bad_png",
            "worker_error",
        ] {
            let root = TestRoot::new();
            let command = fixture(&root, mode);
            let (_sender, receiver) = oneshot::channel();
            let result = capture_with_command(
                target(),
                &root.0,
                Duration::from_secs(15),
                receiver,
                command,
            )
            .await;
            match mode {
                "success" => {
                    let value = result.unwrap();
                    assert_eq!(value.png, PNG);
                    assert_eq!(value.capture.width, capture().width);
                    assert!(Uuid::parse_str(&value.request_id).is_ok());
                }
                "bad_png" => assert_eq!(result.unwrap_err(), HostError::InvalidImage),
                "worker_error" => assert_eq!(
                    result.unwrap_err(),
                    HostError::Worker(WorkerError::TargetChanged)
                ),
                _ => assert_eq!(result.unwrap_err(), HostError::InvalidResponse),
            }
            assert_fixture_exited(&root);
            assert_no_runs(&root);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn appshots_host_overflow_kills_child_without_waiting_for_stdout_eof() {
        let root = TestRoot::new();
        let command = fixture(&root, "overflow");
        let (_sender, receiver) = oneshot::channel();
        let started = tokio::time::Instant::now();
        let result = capture_with_command(
            target(),
            &root.0,
            Duration::from_secs(15),
            receiver,
            command,
        )
        .await;
        assert_eq!(result.unwrap_err(), HostError::ResponseTooLarge);
        assert!(started.elapsed() < Duration::from_secs(15));
        assert_fixture_exited(&root);
        assert_no_runs(&root);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn appshots_host_timeout_kills_and_reaps_owned_child() {
        let root = TestRoot::new();
        let command = fixture(&root, "hang");
        let (_sender, receiver) = oneshot::channel();
        let result =
            capture_with_command(target(), &root.0, Duration::from_secs(5), receiver, command)
                .await;
        assert_eq!(result.unwrap_err(), HostError::TimedOut);
        assert_fixture_exited(&root);
        assert_no_runs(&root);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn appshots_host_cancel_and_sender_drop_kill_and_reap_owned_child() {
        for sender_drop in [false, true] {
            let root = TestRoot::new();
            let command = fixture(&root, "hang");
            let (sender, receiver) = oneshot::channel();
            let operation = capture_with_command(
                target(),
                &root.0,
                Duration::from_secs(20),
                receiver,
                command,
            );
            let cancel = async {
                wait_for_fixture(&root).await;
                if sender_drop {
                    drop(sender);
                } else {
                    sender.send(()).unwrap();
                }
            };
            let (result, ()) = tokio::join!(operation, cancel);
            assert_eq!(result.unwrap_err(), HostError::Cancelled);
            assert_fixture_exited(&root);
            assert_no_runs(&root);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn appshots_host_already_cancelled_never_launches_or_creates_a_run() {
        let root = TestRoot::new();
        let command = fixture(&root, "success");
        let (sender, receiver) = oneshot::channel();
        sender.send(()).unwrap();
        let result = capture_with_command(
            target(),
            &root.0,
            Duration::from_secs(15),
            receiver,
            command,
        )
        .await;
        assert_eq!(result.unwrap_err(), HostError::Cancelled);
        assert!(!root.0.join("pid.txt").exists());
        assert_no_runs(&root);
    }
}
