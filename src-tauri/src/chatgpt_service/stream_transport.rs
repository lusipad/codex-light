//! Incremental SSE framing and independent system-curl transport. WHATWG framing
//! does not define ChatGPT business events. No reconnect or automatic replay.
use super::*;

// Local resource safeguards, not official ChatGPT limits. The idle fallback is
// 60 seconds; a future verified producer can supply its dynamic deadline.
const HEADER_LIMIT: usize = 64 * 1024;
const FRAME_LIMIT: usize = 2 * 1024 * 1024;
const STREAM_LIMIT: usize = 64 * 1024 * 1024;
const ERROR_LIMIT: usize = 1024 * 1024;
const IDLE: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
pub(super) struct StreamFrame {
    pub event: String,
    pub data: String,
    pub id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum StreamEvent {
    Response(u16),
    Frame(StreamFrame),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StreamControl {
    Continue,
    Stop,
}

#[derive(Debug)]
pub(super) struct StreamSummary {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    /// Only non-2xx response bodies are collected. Successful SSE is incremental.
    pub body: Vec<u8>,
    pub event_count: u64,
    /// EOF tail only; never dispatched or interpreted as business completion.
    pub pending_frame: Option<StreamFrame>,
}

pub(super) async fn stream_request<F>(
    request: HttpRequest,
    cancel: Arc<AtomicBool>,
    on_frame: &mut F,
) -> ServiceResult<StreamSummary>
where
    F: FnMut(StreamEvent) -> ServiceResult<StreamControl> + ?Sized,
{
    if !request.url.starts_with("https://") {
        return Err(failure("invalid_request", "Streaming requires HTTPS"));
    }
    run_stream(request, cancel, on_frame, "=https", IDLE).await
}

async fn run_stream<F>(
    request: HttpRequest,
    cancel: Arc<AtomicBool>,
    on_frame: &mut F,
    protocol: &'static str,
    idle: Duration,
) -> ServiceResult<StreamSummary>
where
    F: FnMut(StreamEvent) -> ServiceResult<StreamControl> + ?Sized,
{
    if cancel.load(Ordering::SeqCst) {
        return Err(failure("cancelled", "Stream request cancelled"));
    }
    let mut config = curl_config_with_post_limit(&request, 2 * 1024 * 1024)?;
    let body_file = curl_upload_body(&request, &mut config)?;
    #[cfg(windows)]
    let executable = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
    )
    .join("System32/curl.exe");
    #[cfg(not(windows))]
    let executable = std::path::PathBuf::from("/usr/bin/curl");
    let mut command = tokio::process::Command::new(executable);
    command
        .args([
            "-q",
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--no-buffer",
            "--request",
            curl_method(request.method),
            "--proto",
            protocol,
            "--proto-redir",
            "=https",
            "--max-redirs",
            "0",
            "--connect-timeout",
            "15",
            // --include can delay header output until body/EOF even with
            // --no-buffer (observed on system curl 8.21.0). Dump's header
            // callback flushes stdout, so acceptance precedes body arrival.
            "--dump-header",
            "-",
            "--suppress-connect-headers",
            "--compressed",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .env_remove("SSLKEYLOGFILE")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| {
        failure(
            "transport_unavailable",
            "System streaming transport unavailable",
        )
    })?;
    let outcome = {
        let transfer = async {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| failure("transport_error", "Stream transport input unavailable"))?;
            let mut stdout = child
                .stdout
                .take()
                .ok_or_else(|| failure("transport_error", "Stream transport output unavailable"))?;
            tokio::time::timeout(idle, stdin.write_all(config.as_bytes()))
                .await
                .map_err(|_| failure("stream_idle_timeout", "Stream transport input timed out"))?
                .map_err(|_| failure("transport_error", "Stream transport input failed"))?;
            drop(stdin);
            let mut response = ResponseParser::default();
            let mut buffer = [0u8; 8192];
            loop {
                // Any actual bytes, including comments, reset the idle timer.
                let count = tokio::time::timeout(idle, stdout.read(&mut buffer))
                    .await
                    .map_err(|_| failure("stream_idle_timeout", "Stream response idle timeout"))?
                    .map_err(|_| failure("network_error", "Stream response read failed"))?;
                if count == 0 {
                    break;
                }
                response.feed_events(&buffer[..count], &mut |frame| {
                    if cancel.load(Ordering::SeqCst) {
                        return Err(failure("cancelled", "Stream request cancelled"));
                    }
                    on_frame(frame)
                })?;
                if response.events.stopped {
                    // Business completion is a successful local stop, not EOF
                    // and not a magic error. Close/reap before releasing upload
                    // bytes; the transport never interprets the event payload.
                    let _ = child.kill().await;
                    child
                        .wait()
                        .await
                        .map_err(|_| failure("network_error", "Stream transport wait failed"))?;
                    if cancel.load(Ordering::SeqCst) {
                        return Err(failure("cancelled", "Stream request cancelled"));
                    }
                    return response.finish();
                }
            }
            let status = child
                .wait()
                .await
                .map_err(|_| failure("network_error", "Stream transport wait failed"))?;
            if !status.success() {
                return Err(failure("network_error", "Stream transport failed"));
            }
            response.finish()
        };
        tokio::select! {
            _ = cancelled(&cancel) => Err(failure("cancelled", "Stream request cancelled")),
            result = transfer => result,
        }
    };
    if outcome.is_err() {
        // kill_on_drop alone is not sufficient: explicitly reap before deleting
        // the upload body (Windows also requires curl's file handle to close).
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    drop(body_file);
    outcome
}

#[derive(Default)]
struct EventParser {
    line: Vec<u8>,
    data: String,
    event: String,
    id: String,
    skip_lf: bool,
    started: bool,
    event_count: u64,
    stopped: bool,
}
impl EventParser {
    fn feed<F>(&mut self, bytes: &[u8], on_frame: &mut F) -> ServiceResult<()>
    where
        F: FnMut(StreamFrame) -> ServiceResult<StreamControl> + ?Sized,
    {
        if self.stopped {
            return Ok(());
        }
        for byte in bytes {
            if self.skip_lf {
                self.skip_lf = false;
                if *byte == b'\n' {
                    continue;
                }
            }
            match byte {
                b'\r' => {
                    self.process_line(on_frame)?;
                    self.skip_lf = true;
                }
                b'\n' => self.process_line(on_frame)?,
                _ => {
                    self.line.push(*byte);
                    self.check_size()?;
                }
            }
            if self.stopped {
                break;
            }
        }
        Ok(())
    }
    fn check_size(&self) -> ServiceResult<()> {
        if self.line.len() + self.data.len() + self.event.len() + self.id.len() > FRAME_LIMIT {
            return Err(failure(
                "response_too_large",
                "Stream frame exceeded local resource limit",
            ));
        }
        Ok(())
    }
    fn process_line<F>(&mut self, on_frame: &mut F) -> ServiceResult<()>
    where
        F: FnMut(StreamFrame) -> ServiceResult<StreamControl> + ?Sized,
    {
        // Decode whole lines, never arbitrary network chunks. WHATWG UTF-8
        // replacement semantics preserve valid multibyte characters split by IO.
        let bytes = std::mem::take(&mut self.line);
        let text = String::from_utf8_lossy(&bytes);
        let line = if !self.started {
            text.strip_prefix('\u{feff}').unwrap_or(&text)
        } else {
            &text
        };
        self.started = true;
        if line.is_empty() {
            let event = std::mem::take(&mut self.event);
            if self.data.is_empty() {
                return Ok(());
            }
            self.data.pop(); // Every data field appends exactly one LF.
            let data = std::mem::take(&mut self.data);
            let control = on_frame(StreamFrame {
                event: if event.is_empty() {
                    "message".into()
                } else {
                    event
                },
                data,
                id: self.id.clone(),
            })?;
            self.event_count += 1;
            self.stopped = control == StreamControl::Stop;
        } else if !line.starts_with(':') {
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "data" => {
                    self.data.push_str(value);
                    self.data.push('\n');
                }
                "event" => self.event = value.into(),
                "id" if !value.contains('\0') => self.id = value.into(),
                // retry belongs to reconnect policy, which this write transport
                // intentionally does not implement. Unknown fields are ignored.
                _ => {}
            }
            self.check_size()?;
        }
        Ok(())
    }
    fn take_pending_frame(&mut self) -> ServiceResult<Option<StreamFrame>> {
        if self.stopped {
            return Ok(None);
        }
        if !self.line.is_empty() {
            // A final nonempty field line can lack a line terminator. Process
            // its field value, never synthesize a blank-line dispatch at EOF.
            self.process_line(&mut |_| Ok(StreamControl::Continue))?;
        }
        if self.data.is_empty() {
            return Ok(None);
        }
        self.data.pop();
        let event = std::mem::take(&mut self.event);
        Ok(Some(StreamFrame {
            event: if event.is_empty() {
                "message".into()
            } else {
                event
            },
            data: std::mem::take(&mut self.data),
            id: self.id.clone(),
        }))
    }

    fn finish(&mut self) {
        // EOF is not a blank line: do not dispatch partial events.
        self.line.clear();
        self.data.clear();
        self.event.clear();
    }
}

#[derive(Default)]
struct ResponseParser {
    header: Vec<u8>,
    header_bytes: usize,
    received: usize,
    summary: Option<StreamSummary>,
    events: EventParser,
}
impl ResponseParser {
    #[cfg(test)]
    fn feed<F>(&mut self, bytes: &[u8], on_frame: &mut F) -> ServiceResult<()>
    where
        F: FnMut(StreamFrame) -> ServiceResult<StreamControl> + ?Sized,
    {
        self.feed_events(bytes, &mut |event| match event {
            StreamEvent::Response(_) => Ok(StreamControl::Continue),
            StreamEvent::Frame(frame) => on_frame(frame),
        })
    }

    fn feed_events<F>(&mut self, bytes: &[u8], on_event: &mut F) -> ServiceResult<()>
    where
        F: FnMut(StreamEvent) -> ServiceResult<StreamControl> + ?Sized,
    {
        let mut offset = 0;
        while self.summary.is_none() && offset < bytes.len() {
            self.header.push(bytes[offset]);
            self.header_bytes += 1;
            offset += 1;
            if self.header_bytes > HEADER_LIMIT {
                return Err(failure(
                    "invalid_response",
                    "Stream headers exceeded local resource limit",
                ));
            }
            if !self.header.ends_with(b"\r\n\r\n") {
                continue;
            }
            let status = std::str::from_utf8(&self.header)
                .ok()
                .and_then(|text| text.lines().next())
                .filter(|line| line.starts_with("HTTP/"))
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|status| status.parse::<u16>().ok())
                .filter(|status| (100..600).contains(status))
                .ok_or_else(|| failure("invalid_response", "Invalid stream HTTP status"))?;
            if (100..200).contains(&status) {
                if status == 101 {
                    return Err(failure(
                        "invalid_response",
                        "Stream protocol upgrade is unsupported",
                    ));
                }
                self.header.clear();
                continue;
            }
            let parsed = parse_http(&self.header)?;
            if (200..300).contains(&parsed.status)
                && !parsed.headers.get("content-type").is_some_and(|mime| {
                    mime.split(';')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .eq_ignore_ascii_case("text/event-stream")
                })
            {
                return Err(failure(
                    "invalid_response",
                    "Successful stream requires text/event-stream",
                ));
            }
            self.summary = Some(StreamSummary {
                status: parsed.status,
                headers: parsed.headers,
                body: Vec::new(),
                event_count: 0,
                pending_frame: None,
            });
            self.header.clear();
            if (200..300).contains(&parsed.status) {
                if on_event(StreamEvent::Response(parsed.status))? == StreamControl::Stop {
                    self.events.stopped = true;
                    return Ok(());
                }
            }
        }
        if let Some(summary) = &mut self.summary {
            let body = &bytes[offset..];
            self.received = self.received.checked_add(body.len()).ok_or_else(|| {
                failure("response_too_large", "Stream exceeded local resource limit")
            })?;
            if (200..300).contains(&summary.status) {
                if self.received > STREAM_LIMIT {
                    return Err(failure(
                        "response_too_large",
                        "Stream exceeded local resource limit",
                    ));
                }
                self.events
                    .feed(body, &mut |frame| on_event(StreamEvent::Frame(frame)))?;
            } else {
                if self.received > ERROR_LIMIT {
                    return Err(failure(
                        "response_too_large",
                        "Stream error body exceeded local resource limit",
                    ));
                }
                summary.body.extend_from_slice(body);
            }
        }
        Ok(())
    }
    fn finish(mut self) -> ServiceResult<StreamSummary> {
        let pending_frame = self.events.take_pending_frame()?;
        self.events.finish();
        let mut summary = self
            .summary
            .ok_or_else(|| failure("invalid_response", "Stream ended before final HTTP headers"))?;
        summary.event_count = self.events.event_count;
        summary.pending_frame = pending_frame;
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn run_fixture_stream<F>(
        request: HttpRequest,
        cancel: Arc<AtomicBool>,
        sink: &mut F,
        protocol: &'static str,
        idle: Duration,
    ) -> ServiceResult<StreamSummary>
    where
        F: FnMut(StreamFrame) -> ServiceResult<StreamControl> + ?Sized,
    {
        run_stream(
            request,
            cancel,
            &mut |event| match event {
                StreamEvent::Response(_) => Ok(StreamControl::Continue),
                StreamEvent::Frame(frame) => sink(frame),
            },
            protocol,
            idle,
        )
        .await
    }

    #[test]
    fn sse_body_configuration_uses_its_own_local_bound_without_changing_buffered_requests() {
        let mut request = HttpRequest {
            url: "https://chatgpt.com/backend-api/f/conversation".into(),
            headers: BTreeMap::new(),
            method: HttpMethod::Post,
            body: vec![b'x'; 256 * 1024 + 1],
        };
        assert!(curl_config(&request).is_err());
        assert!(curl_config_with_post_limit(&request, 2 * 1024 * 1024).is_ok());
        request.body.resize(2 * 1024 * 1024 + 1, b'x');
        assert!(curl_config_with_post_limit(&request, 2 * 1024 * 1024).is_err());
    }
    #[test]
    fn sse_split_chinese_and_crlf_dispatches_before_eof() {
        let mut parser = EventParser::default();
        let mut frames = Vec::new();
        let mut consume = |frame| {
            frames.push(frame);
            Ok(StreamControl::Continue)
        };
        for byte in "\u{feff}id: one\r\nevent: delta\r\ndata: 中文\r\n\r\n".as_bytes() {
            parser.feed(&[*byte], &mut consume).unwrap();
        }
        assert_eq!(
            frames,
            vec![StreamFrame {
                event: "delta".into(),
                data: "中文".into(),
                id: "one".into()
            }]
        );
    }
    fn parse_events(bytes: &[u8], chunk: usize) -> Vec<StreamFrame> {
        let mut parser = EventParser::default();
        let mut frames = Vec::new();
        for bytes in bytes.chunks(chunk) {
            parser
                .feed(bytes, &mut |frame| {
                    frames.push(frame);
                    Ok(StreamControl::Continue)
                })
                .unwrap();
        }
        parser.finish();
        frames
    }

    #[test]
    fn sse_fields_line_endings_id_reset_and_eof_follow_whatwg() {
        let input="\u{feff}:comment\rid: retained\r\nevent: ignored\n\ndata:first\rdata: second\revent:\r\nid: bad\0id\r\n\r\nretry: 10\nid\ndata\n\nevent: incomplete\ndata: discarded";
        let expected = vec![
            StreamFrame {
                event: "message".into(),
                data: "first\nsecond".into(),
                id: "retained".into(),
            },
            StreamFrame {
                event: "message".into(),
                data: "".into(),
                id: "".into(),
            },
        ];
        for chunk in 1..input.len() {
            assert_eq!(parse_events(input.as_bytes(), chunk), expected);
        }
        assert!(parse_events(b"event: not-dispatched\ndata: partial\n", 1).is_empty());
        assert!(parse_events(b"data: partial", 1).is_empty());
    }

    #[test]
    fn sse_utf8_replacement_happens_on_complete_lines_not_network_chunks() {
        let mut input = "data: 中文".as_bytes().to_vec();
        input.extend_from_slice(&[0xff, 0xe4, b'\n', b'\n']);
        for chunk in 1..input.len() {
            assert_eq!(parse_events(&input, chunk)[0].data, "中文\u{fffd}\u{fffd}");
        }
    }

    #[test]
    fn sse_final_headers_gate_delivery_and_http_errors_preserve_bounded_body() {
        let mut parser = ResponseParser::default();
        let mut frames = Vec::new();
        let input=b"HTTP/1.1 103 Early Hints\r\nLink: </local>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: Text/Event-Stream; charset=utf-8\r\n\r\ndata: real\n\n";
        for byte in input {
            parser
                .feed(&[*byte], &mut |frame| {
                    frames.push(frame);
                    Ok(StreamControl::Continue)
                })
                .unwrap();
        }
        let summary = parser.finish().unwrap();
        assert_eq!(summary.status, 200);
        assert_eq!(summary.event_count, 1);
        assert!(summary.body.is_empty());
        assert_eq!(frames[0].data, "real");
        let mut parser = ResponseParser::default();
        parser.feed(b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/event-stream\r\n\r\ndata: not-business\n\n",&mut |_|panic!("error HTTP dispatched a business event")).unwrap();
        let summary = parser.finish().unwrap();
        assert_eq!(summary.status, 403);
        assert_eq!(summary.body, b"data: not-business\n\n");
        assert_eq!(summary.event_count, 0);
        for input in [
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}".as_slice(),
            b"HTTP/1.1 204 No Content\r\n\r\n",
            b"HTTP/1.1 101 Switching Protocols\r\n\r\n",
        ] {
            assert!(ResponseParser::default()
                .feed(input, &mut |_| panic!("bad MIME dispatched"))
                .is_err());
        }
        assert!(ResponseParser::default().finish().is_err());
    }

    #[test]
    fn sse_resource_limits_and_callback_failure_are_explicit_errors() {
        let mut parser = EventParser::default();
        let mut input = b"data:".to_vec();
        input.extend(vec![b'x'; FRAME_LIMIT]);
        assert_eq!(
            parser
                .feed(&input, &mut |_| Ok(StreamControl::Continue))
                .unwrap_err()
                .code,
            "response_too_large"
        );
        let mut parser = EventParser::default();
        assert_eq!(
            parser
                .feed(b"data: one\n\n", &mut |_| Err(failure(
                    "fixture_callback",
                    "Fixture rejected event"
                )))
                .unwrap_err()
                .code,
            "fixture_callback"
        );
        let mut parser = ResponseParser::default();
        assert!(parser
            .feed(&vec![b'x'; HEADER_LIMIT + 1], &mut |_| Ok(
                StreamControl::Continue
            ))
            .is_err());
        let mut parser = ResponseParser::default();
        parser
            .feed(b"HTTP/1.1 500 Error\r\n\r\n", &mut |_| {
                Ok(StreamControl::Continue)
            })
            .unwrap();
        assert_eq!(
            parser
                .feed(&vec![b'x'; ERROR_LIMIT + 1], &mut |_| Ok(
                    StreamControl::Continue
                ))
                .unwrap_err()
                .code,
            "response_too_large"
        );
        let mut parser = ResponseParser::default();
        parser
            .feed(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n",
                &mut |_| Ok(StreamControl::Continue),
            )
            .unwrap();
        parser.received = STREAM_LIMIT;
        assert_eq!(
            parser
                .feed(b":", &mut |_| Ok(StreamControl::Continue))
                .unwrap_err()
                .code,
            "response_too_large"
        );
    }

    fn request(url: String) -> HttpRequest {
        HttpRequest {
            url,
            headers: BTreeMap::from([(
                "Authorization".into(),
                "Bearer private-fixture-only".into(),
            )]),
            method: HttpMethod::Post,
            body: b"{\"private\":\"fixture-only\"}".to_vec(),
        }
    }
    async fn fixture_socket(listener: tokio::net::TcpListener) -> tokio::net::TcpStream {
        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut input = Vec::new();
        let mut buf = [0u8; 1024];
        loop {
            let count = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buf))
                .await
                .unwrap()
                .unwrap();
            assert_ne!(count, 0);
            input.extend_from_slice(&buf[..count]);
            if let Some(end) = input.windows(4).position(|v| v == b"\r\n\r\n") {
                let head = std::str::from_utf8(&input[..end]).unwrap();
                let length = head
                    .lines()
                    .find_map(|line| {
                        let (k, v) = line.split_once(':')?;
                        k.eq_ignore_ascii_case("content-length")
                            .then(|| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if input.len() >= end + 4 + length {
                    assert!(head.starts_with("POST /fixture HTTP/1.1"));
                    assert!(head.contains("Bearer private-fixture-only"));
                    assert_eq!(&input[end + 4..], b"{\"private\":\"fixture-only\"}");
                    return socket;
                }
            }
        }
    }

    #[tokio::test]
    async fn sse_real_curl_delivers_split_chinese_before_fixture_eof() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (first_tx, first_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let mut socket = fixture_socket(listener).await;
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").await.unwrap();
            for byte in "id: first\ndata: 中文\n\n".as_bytes() {
                socket.write_all(&[*byte]).await.unwrap();
                tokio::task::yield_now().await;
            }
            // The server cannot reach EOF until the client delivers frame one.
            tokio::time::timeout(Duration::from_secs(5), first_rx)
                .await
                .unwrap()
                .unwrap();
            socket.write_all(b"data: second\n\n").await.unwrap();
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let mut first = Some(first_tx);
        let mut frames = Vec::new();
        let result = run_fixture_stream(
            request(format!("http://{address}/fixture")),
            cancel,
            &mut |frame| {
                if let Some(tx) = first.take() {
                    let _ = tx.send(());
                }
                frames.push(frame);
                Ok(StreamControl::Continue)
            },
            "=http",
            Duration::from_secs(8),
        )
        .await;
        server.await.unwrap();
        let summary = result.unwrap();
        assert_eq!(summary.event_count, 2);
        assert_eq!(frames[0].data, "中文");
        assert_eq!(frames[1].id, "first");
    }

    #[tokio::test]
    async fn sse_real_curl_cancel_callback_error_and_idle_reap_connection() {
        for phase in ["cancel", "callback", "idle"] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let mut socket = fixture_socket(listener).await;
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").await.unwrap();
                if phase != "idle" {
                    socket.write_all(b"data: first\n\n").await.unwrap();
                }
                let mut byte = [0u8; 1];
                let closed = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut byte))
                    .await
                    .unwrap();
                assert!(
                    matches!(closed, Ok(0) | Err(_)),
                    "curl connection must close after failure"
                );
            });
            let cancel = Arc::new(AtomicBool::new(false));
            let observer = cancel.clone();
            let error = run_fixture_stream(
                request(format!("http://{address}/fixture")),
                cancel,
                &mut |_| {
                    if phase == "cancel" {
                        observer.store(true, Ordering::SeqCst);
                        Ok(StreamControl::Continue)
                    } else {
                        Err(failure("fixture_callback", "Fixture rejected frame"))
                    }
                },
                "=http",
                if phase == "idle" {
                    Duration::from_secs(1)
                } else {
                    Duration::from_secs(5)
                },
            )
            .await
            .unwrap_err();
            assert_eq!(
                error.code,
                match phase {
                    "cancel" => "cancelled",
                    "callback" => "fixture_callback",
                    _ => "stream_idle_timeout",
                }
            );
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn sse_real_curl_http_error_is_not_a_business_stream_and_production_rejects_http() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut socket = fixture_socket(listener).await;
            socket.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 17\r\nConnection: close\r\n\r\n{\"error\":\"local\"}").await.unwrap();
        });
        let summary = run_fixture_stream(
            request(format!("http://{address}/fixture")),
            Arc::new(AtomicBool::new(false)),
            &mut |_| panic!("401 dispatched event"),
            "=http",
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(summary.status, 401);
        assert_eq!(summary.body, b"{\"error\":\"local\"}");
        let error = stream_request(
            request("http://127.0.0.1:1/fixture".into()),
            Arc::new(AtomicBool::new(false)),
            &mut |_| Ok(StreamControl::Continue),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "invalid_request");
    }
    #[tokio::test]
    async fn sse_callback_stop_closes_live_connection_and_returns_success_without_eof() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut socket = fixture_socket(listener).await;
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: business-finished\n\n").await.unwrap();
            // Keep the response alive until the client closes it. A broken Stop
            // falls back to EOF only after this bounded test failure window.
            let mut byte = [0u8; 1];
            matches!(
                tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
                Ok(Ok(0)) | Ok(Err(_))
            )
        });
        let started = std::time::Instant::now();
        let mut delivered = 0;
        let summary = run_fixture_stream(
            request(format!("http://{address}/fixture")),
            Arc::new(AtomicBool::new(false)),
            &mut |_| {
                delivered += 1;
                Ok(StreamControl::Stop)
            },
            "=http",
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        assert!(
            server.await.unwrap(),
            "callback Stop did not close the live connection before EOF"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(delivered, 1);
        assert_eq!(summary.status, 200);
        assert_eq!(summary.event_count, 1);
    }
    #[test]
    fn sse_callback_stop_discards_remaining_frames_in_same_chunk_and_future_feeds() {
        let mut parser = EventParser::default();
        let mut frames = Vec::new();
        let mut consume = |frame| {
            frames.push(frame);
            Ok(StreamControl::Stop)
        };
        parser
            .feed(
                b"data: accepted\n\ndata: must-not-deliver\n\n",
                &mut consume,
            )
            .unwrap();
        parser.feed(b"data: also-late\n\n", &mut consume).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "accepted");
        assert_eq!(parser.event_count, 1);
        assert!(parser.stopped);
    }
    #[test]
    fn sse_eof_retains_pending_json_without_dispatching_or_accepting_incomplete_done() {
        for tail in [
            "event: delta\ndata: {\"text\":\"中文\"}",
            "event: delta\ndata: {\"text\":\"中文\"}\n",
        ] {
            let mut parser = ResponseParser::default();
            let mut count = 0;
            parser
                .feed(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n",
                    &mut |_| Ok(StreamControl::Continue),
                )
                .unwrap();
            for byte in tail.as_bytes() {
                parser
                    .feed(&[*byte], &mut |_| {
                        count += 1;
                        Ok(StreamControl::Continue)
                    })
                    .unwrap();
            }
            let summary = parser.finish().unwrap();
            assert_eq!(count, 0);
            assert_eq!(summary.event_count, 0);
            assert_eq!(
                summary.pending_frame,
                Some(StreamFrame {
                    event: "delta".into(),
                    data: "{\"text\":\"中文\"}".into(),
                    id: "".into()
                })
            );
        }
        let mut parser = ResponseParser::default();
        parser
            .feed(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\ndata: [DONE]",
                &mut |_| panic!("incomplete DONE dispatched"),
            )
            .unwrap();
        let summary = parser.finish().unwrap();
        assert_eq!(summary.event_count, 0);
        assert_eq!(summary.pending_frame.unwrap().data, "[DONE]");
    }
    #[test]
    fn sse_pending_tail_preserves_id_multiline_and_is_taken_only_once() {
        let mut parser = EventParser::default();
        let mut count = 0;
        parser
            .feed(
                b"id: inherited\n\nevent: tail\ndata: first\ndata: second",
                &mut |_| {
                    count += 1;
                    Ok(StreamControl::Continue)
                },
            )
            .unwrap();
        assert_eq!(
            parser.take_pending_frame().unwrap(),
            Some(StreamFrame {
                event: "tail".into(),
                data: "first\nsecond".into(),
                id: "inherited".into()
            })
        );
        assert!(parser.take_pending_frame().unwrap().is_none());
        assert_eq!(count, 0);
        assert_eq!(parser.event_count, 0);
        for empty in [b": comment".as_slice(), b"id: only", b"event: only", b""] {
            let mut parser = EventParser::default();
            parser
                .feed(empty, &mut |_| panic!("no event data"))
                .unwrap();
            assert!(parser.take_pending_frame().unwrap().is_none());
        }
    }

    #[test]
    fn sse_stop_and_http_error_never_expose_pending_sse_tail() {
        let mut parser = ResponseParser::default();
        parser.feed(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\ndata: business-complete\n\ndata: ignored-tail",&mut |_|Ok(StreamControl::Stop)).unwrap();
        let summary = parser.finish().unwrap();
        assert_eq!(summary.event_count, 1);
        assert!(summary.pending_frame.is_none());
        let mut parser = ResponseParser::default();
        parser
            .feed(
                b"HTTP/1.1 403 Forbidden\r\n\r\ndata: not-an-event",
                &mut |_| panic!("HTTP error dispatched"),
            )
            .unwrap();
        assert!(parser.finish().unwrap().pending_frame.is_none());
    }
    #[test]
    fn sse_final_response_acceptance_precedes_frames_without_requiring_business_data() {
        let mut parser = ResponseParser::default();
        let mut events = Vec::new();
        parser.feed_events(b"HTTP/1.1 103 Early Hints\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nSet-Cookie: private-fixture\r\n\r\n",&mut |event|{events.push(event);Ok(StreamControl::Continue)}).unwrap();
        assert_eq!(events, vec![StreamEvent::Response(200)]);
        parser
            .feed_events(b"data: first\n\n", &mut |event| {
                events.push(event);
                Ok(StreamControl::Continue)
            })
            .unwrap();
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[1],StreamEvent::Frame(frame) if frame.data=="first"));
    }
    #[test]
    fn sse_response_metadata_is_never_emitted_for_interim_errors_or_invalid_mime() {
        for input in [
            b"HTTP/1.1 103 Early Hints\r\n\r\n".as_slice(),
            b"HTTP/1.1 401 Unauthorized\r\n\r\nerror",
        ] {
            let mut parser = ResponseParser::default();
            parser
                .feed_events(input, &mut |_| {
                    panic!("unaccepted response emitted metadata")
                })
                .unwrap();
        }
        let mut parser = ResponseParser::default();
        assert!(parser
            .feed_events(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}",
                &mut |_| panic!("invalid MIME emitted metadata")
            )
            .is_err());
    }

    #[tokio::test]
    async fn sse_real_response_metadata_arrives_before_body_and_failure_reaps_curl() {
        for rejected in [false, true] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let mut socket = fixture_socket(listener).await;
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nSet-Cookie: fixture-private\r\nConnection: close\r\n\r\n").await.unwrap();
                let mut byte = [0u8; 1];
                matches!(
                    tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
                    Ok(Ok(0)) | Ok(Err(_))
                )
            });
            let mut received = 0;
            let result = run_stream(
                request(format!("http://{address}/fixture")),
                Arc::new(AtomicBool::new(false)),
                &mut |event| {
                    assert_eq!(event, StreamEvent::Response(200));
                    received += 1;
                    if rejected {
                        Err(failure(
                            "fixture_response_rejected",
                            "Response callback rejected",
                        ))
                    } else {
                        Ok(StreamControl::Stop)
                    }
                },
                "=http",
                Duration::from_secs(5),
            )
            .await;
            assert!(
                server.await.unwrap(),
                "response metadata must arrive while body is still pending"
            );
            assert_eq!(received, 1);
            if rejected {
                assert_eq!(result.unwrap_err().code, "fixture_response_rejected");
            } else {
                let summary = result.unwrap();
                assert_eq!(summary.event_count, 0);
                assert!(summary.pending_frame.is_none());
            }
        }
    }
}
