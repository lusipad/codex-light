//! Internal, one-request worker transport. No renderer-facing command lives here.
//!
//! EOF terminates the request: the parent must close stdin after writing one JSON
//! object. A byte bound does not impose a read deadline; the parent must still
//! enforce timeout/cancellation by terminating and waiting for its own child.
use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read, Write},
    path::{Component, Path},
};

pub const ARGUMENT: &str = "--appshots-worker";
pub const MAX_REQUEST_BYTES: usize = 16 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const TEXT_CAPACITY: usize = 262144;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerRequest {
    pub request_id: String,
    pub hwnd: u64,
    pub pid: u32,
    pub process_creation_time: u64,
    pub output_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerError {
    InvalidRequest,
    RequestTooLarge,
    InputError,
    TargetChanged,
    Unsupported,
    FrameTimeout,
    PermissionDenied,
    CaptureFailed,
    OutputFailed,
    InvalidNativeResult,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextStatus {
    Unavailable,
    AvailableUnknownExtent,
    Partial,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextSource {
    None,
    TextPattern,
    ValuePattern,
    Mixed,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerCapture {
    pub width: u32,
    pub height: u32,
    pub text_status: TextStatus,
    pub text_source: TextSource,
    pub text: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerResponse {
    pub request_id: Option<String>,
    pub error: Option<WorkerError>,
    pub capture: Option<WorkerCapture>,
}

#[repr(C)]
#[derive(Default)]
struct NativeResult {
    code: u32,
    hresult: i32,
    width: u32,
    height: u32,
    text_length: u32,
    text_status: u32,
    text_source: u32,
}

fn decode_native(
    code: i32,
    result: NativeResult,
    text: &[u8],
) -> Result<WorkerCapture, WorkerError> {
    if code < 0 || code as u32 != result.code {
        return Err(WorkerError::InvalidNativeResult);
    }
    if code != 0 {
        return Err(match code {
            1 => WorkerError::InvalidRequest,
            2 => WorkerError::TargetChanged,
            3 => WorkerError::Unsupported,
            4 => WorkerError::FrameTimeout,
            5 => WorkerError::PermissionDenied,
            6 => WorkerError::CaptureFailed,
            7 => WorkerError::OutputFailed,
            _ => WorkerError::InvalidNativeResult,
        });
    }
    if result.width == 0 || result.height == 0 || result.text_length as usize >= text.len() {
        return Err(WorkerError::InvalidNativeResult);
    }
    let text_status = match result.text_status {
        0 => TextStatus::Unavailable,
        1 => TextStatus::AvailableUnknownExtent,
        2 => TextStatus::Partial,
        3 => TextStatus::Error,
        _ => return Err(WorkerError::InvalidNativeResult),
    };
    let text_source = match result.text_source {
        0 => TextSource::None,
        1 => TextSource::TextPattern,
        2 => TextSource::ValuePattern,
        3 => TextSource::Mixed,
        _ => return Err(WorkerError::InvalidNativeResult),
    };
    let bytes = &text[..result.text_length as usize];
    let text = if bytes.is_empty() {
        None
    } else {
        Some(
            std::str::from_utf8(bytes)
                .map_err(|_| WorkerError::InvalidNativeResult)?
                .to_owned(),
        )
    };
    Ok(WorkerCapture {
        width: result.width,
        height: result.height,
        text_status,
        text_source,
        text,
    })
}

#[cfg(windows)]
fn capture(request: &WorkerRequest) -> Result<WorkerCapture, WorkerError> {
    use std::os::windows::ffi::OsStrExt;
    extern "C" {
        fn codex_appshot_capture(
            hwnd: u64,
            pid: u32,
            creation_filetime: u64,
            png_path: *const u16,
            frame_timeout_ms: u32,
            result: *mut NativeResult,
            utf8_text: *mut u8,
            text_capacity: u32,
        ) -> i32;
    }
    let path: Vec<u16> = std::ffi::OsStr::new(&request.output_path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut result = NativeResult::default();
    let mut text = vec![0u8; TEXT_CAPACITY];
    // All buffers are caller-owned and live until the synchronous ABI returns.
    // The parent must kill this worker for hard UIA cancellation/timeout.
    let code = unsafe {
        codex_appshot_capture(
            request.hwnd,
            request.pid,
            request.process_creation_time,
            path.as_ptr(),
            10000,
            &mut result,
            text.as_mut_ptr(),
            text.len() as u32,
        )
    };
    decode_native(code, result, &text)
}

#[cfg(not(windows))]
fn capture(_: &WorkerRequest) -> Result<WorkerCapture, WorkerError> {
    Err(WorkerError::Unsupported)
}

impl WorkerRequest {
    fn validate(&self) -> Result<(), WorkerError> {
        let path = Path::new(&self.output_path);
        if self.request_id.is_empty()
            || self.request_id.len() > 128
            || self.request_id.chars().any(char::is_control)
            || self.request_id.trim() != self.request_id
            || self.hwnd == 0
            || self.pid == 0
            || self.process_creation_time == 0
            || self.output_path.chars().any(char::is_control)
            || !path.is_absolute()
            || path.file_name().is_none()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(WorkerError::InvalidRequest);
        }
        // These fields are input checks, not proof against HWND/PID reuse.
        // The native executor must bind and verify the actual target lifetime.
        Ok(())
    }
}

pub fn parse_request(bytes: &[u8]) -> Result<WorkerRequest, WorkerError> {
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err(WorkerError::RequestTooLarge);
    }
    // from_slice rejects incomplete JSON, extra objects, garbage and unknown
    // fields. JSON whitespace is allowed; there is no second request/frame.
    let request: WorkerRequest =
        serde_json::from_slice(bytes).map_err(|_| WorkerError::InvalidRequest)?;
    request.validate()?;
    Ok(request)
}

fn read_request(mut reader: impl Read) -> Result<WorkerRequest, WorkerError> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| WorkerError::InputError)?;
    parse_request(&bytes)
}

fn write_response(mut writer: impl Write, response: &WorkerResponse) -> io::Result<()> {
    let bytes = serde_json::to_vec(response).map_err(io::Error::other)?;
    if bytes.len() + 1 > MAX_RESPONSE_BYTES {
        return Err(io::Error::other("Appshots worker response exceeds limit"));
    }
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn serve_with(
    reader: impl Read,
    writer: impl Write,
    execute: fn(&WorkerRequest) -> Result<WorkerCapture, WorkerError>,
) -> i32 {
    let (response, code) = match read_request(reader) {
        Ok(request) => {
            let result = execute(&request);
            let (capture, error, code) = match result {
                Ok(capture) => (Some(capture), None, 0),
                Err(error) => (None, Some(error), 3),
            };
            (
                WorkerResponse {
                    request_id: Some(request.request_id),
                    error,
                    capture,
                },
                code,
            )
        }
        Err(error) => (
            WorkerResponse {
                request_id: None,
                error: Some(error),
                capture: None,
            },
            2,
        ),
    };
    // Never echo malformed input/paths to diagnostics.
    if write_response(writer, &response).is_err() {
        4
    } else {
        code
    }
}

/// Called before Tauri/window initialization; the caller exits with this code.
pub fn run_stdio() -> i32 {
    serve_with(io::stdin().lock(), io::stdout().lock(), capture)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn request() -> Value {
        json!({"requestId":"private-request-1", "hwnd":42, "pid":120,
            "processCreationTime":133700000000000000u64,
            "outputPath":std::env::temp_dir().join("appshots-private.png").to_string_lossy()})
    }

    #[test]
    fn valid_target_fields_are_preserved_without_claiming_lifetime_proof() {
        let expected = request();
        let parsed = parse_request(&serde_json::to_vec(&expected).unwrap()).unwrap();
        assert_eq!(parsed.hwnd, 42);
        assert_eq!(parsed.pid, 120);
        assert_eq!(parsed.process_creation_time, 133700000000000000);
        assert_eq!(serde_json::to_value(parsed).unwrap(), expected);
    }

    #[test]
    fn incomplete_malformed_unknown_and_trailing_requests_are_rejected() {
        for bytes in [&b""[..], b"{", b"null", b"[]", b"{}", b"\xff"] {
            assert_eq!(
                parse_request(bytes).unwrap_err(),
                WorkerError::InvalidRequest
            );
        }
        let mut extra = request();
        extra["command"] = json!("capture");
        assert!(parse_request(&serde_json::to_vec(&extra).unwrap()).is_err());
        let bytes = serde_json::to_vec(&request()).unwrap();
        for trailing in [&b"{}"[..], b"x", &bytes] {
            let mut multiple = bytes.clone();
            multiple.extend_from_slice(trailing);
            assert_eq!(
                parse_request(&multiple).unwrap_err(),
                WorkerError::InvalidRequest
            );
        }
        let duplicate = String::from_utf8(bytes)
            .unwrap()
            .replacen("{", "{\"pid\":99,", 1);
        assert!(parse_request(duplicate.as_bytes()).is_err());
    }

    #[test]
    fn missing_zero_or_wrong_typed_identity_is_rejected() {
        for key in [
            "requestId",
            "hwnd",
            "pid",
            "processCreationTime",
            "outputPath",
        ] {
            let mut missing = request();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                parse_request(&serde_json::to_vec(&missing).unwrap()).is_err(),
                "{key}"
            );
            let mut null = request();
            null[key] = Value::Null;
            assert!(
                parse_request(&serde_json::to_vec(&null).unwrap()).is_err(),
                "{key}"
            );
        }
        for key in ["hwnd", "pid", "processCreationTime"] {
            for value in [json!(0), json!(-1), json!(1.5), json!("42")] {
                let mut invalid = request();
                invalid[key] = value;
                assert!(
                    parse_request(&serde_json::to_vec(&invalid).unwrap()).is_err(),
                    "{key}"
                );
            }
        }
        for id in ["", " ", " leading", "trailing ", "line\nbreak"] {
            let mut invalid = request();
            invalid["requestId"] = json!(id);
            assert!(parse_request(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
    }

    #[test]
    fn relative_parent_and_control_character_output_paths_are_rejected() {
        for output in [
            "relative.png",
            "../outside.png",
            "C:drive-relative.png",
            "bad\0path.png",
        ] {
            let mut invalid = request();
            invalid["outputPath"] = json!(output);
            assert!(parse_request(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
        let mut invalid = request();
        invalid["outputPath"] = json!(std::env::temp_dir()
            .join("..")
            .join("outside.png")
            .to_string_lossy());
        assert!(parse_request(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }

    #[test]
    fn oversized_input_is_rejected_after_a_bounded_read() {
        struct Infinite {
            read: usize,
        }
        impl Read for Infinite {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                buffer.fill(b' ');
                self.read += buffer.len();
                Ok(buffer.len())
            }
        }
        let mut reader = Infinite { read: 0 };
        assert_eq!(
            read_request(&mut reader).unwrap_err(),
            WorkerError::RequestTooLarge
        );
        assert_eq!(reader.read, MAX_REQUEST_BYTES + 1);
    }

    #[test]
    fn failed_executor_never_reports_capture_success() {
        let mut output = Vec::new();
        assert_eq!(
            serve_with(
                &serde_json::to_vec(&request()).unwrap()[..],
                &mut output,
                |_| Err(WorkerError::CaptureFailed)
            ),
            3
        );
        assert!(output.len() <= MAX_RESPONSE_BYTES);
        let response: WorkerResponse = serde_json::from_slice(&output).unwrap();
        assert_eq!(response.request_id.as_deref(), Some("private-request-1"));
        assert_eq!(response.error, Some(WorkerError::CaptureFailed));
        assert!(response.capture.is_none());
        assert!(!String::from_utf8(output).unwrap().contains("outputPath"));
    }

    #[test]
    fn input_or_output_failure_has_a_nonzero_return_code() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("private detail"))
            }
        }
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::other("private detail"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut output = Vec::new();
        assert_eq!(
            serve_with(Broken, &mut output, |_| panic!(
                "invalid input reached executor"
            )),
            2
        );
        assert_eq!(
            serde_json::from_slice::<WorkerResponse>(&output)
                .unwrap()
                .error,
            Some(WorkerError::InputError)
        );
        assert!(!String::from_utf8(output)
            .unwrap()
            .contains("private detail"));
        assert_eq!(
            serve_with(&b"{}"[..], Broken, |_| panic!(
                "invalid input reached executor"
            )),
            4
        );
    }

    #[test]
    fn native_layout_and_partial_text_are_explicit_without_full_text_claim() {
        assert_eq!(std::mem::size_of::<NativeResult>(), 28);
        assert_eq!(std::mem::align_of::<NativeResult>(), 4);
        let result = NativeResult {
            width: 100,
            height: 90,
            text_length: 6,
            text_status: 2,
            text_source: 2,
            ..Default::default()
        };
        let capture = decode_native(0, result, "中文\0".as_bytes()).unwrap();
        assert_eq!(capture.text_status, TextStatus::Partial);
        assert_eq!(capture.text_source, TextSource::ValuePattern);
        assert_eq!(capture.text.as_deref(), Some("中文"));
    }

    #[test]
    fn invalid_native_lengths_utf8_or_status_cannot_report_success() {
        for result in [
            NativeResult::default(),
            NativeResult {
                code: 3,
                ..Default::default()
            },
            NativeResult {
                width: 1,
                height: 1,
                text_length: 1,
                ..Default::default()
            },
            NativeResult {
                width: 1,
                height: 1,
                text_status: 99,
                ..Default::default()
            },
            NativeResult {
                width: 1,
                height: 1,
                text_source: 99,
                ..Default::default()
            },
        ] {
            assert!(decode_native(0, result, &[0]).is_err());
        }
        let result = NativeResult {
            width: 1,
            height: 1,
            text_length: 1,
            ..Default::default()
        };
        assert!(decode_native(0, result, &[0xff, 0]).is_err());
    }

    #[test]
    fn bounded_text_worst_json_escaping_still_fits_response_limit() {
        let response = WorkerResponse {
            request_id: Some("x".repeat(128)),
            error: None,
            capture: Some(WorkerCapture {
                width: 1,
                height: 1,
                text_status: TextStatus::Partial,
                text_source: TextSource::TextPattern,
                text: Some("\u{1}".repeat(TEXT_CAPACITY - 1)),
            }),
        };
        let mut output = Vec::new();
        write_response(&mut output, &response).unwrap();
        assert!(output.len() <= MAX_RESPONSE_BYTES);
    }
}
