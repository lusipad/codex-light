//! Windows transport for the fixed durable app-server host.
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

type Handle = *mut c_void;
type Callback = unsafe extern "system" fn(Handle, usize, u32, *const c_void, u32);
const SEND_REQUEST: u32 = 0x00400000;
const HEADERS: u32 = 0x00020000;
const READ: u32 = 0x00080000;
const WRITE: u32 = 0x00100000;
const ERROR: u32 = 0x00200000;
const CLOSE: u32 = 0x02000000;
// The fixed desktop WebSocket client leaves the bundled ws inbound default in place.
const MAX_INBOUND_MESSAGE: usize = 100 * 1024 * 1024;
const DURABLE_HOST: &str = "codex-cloud-backend.chatgpt.com";
const PROTOCOL: &str = "codex-app-server";

#[link(name = "winhttp")]
extern "system" {
    fn WinHttpOpen(
        agent: *const u16,
        access: u32,
        proxy: *const u16,
        bypass: *const u16,
        flags: u32,
    ) -> Handle;
    fn WinHttpConnect(session: Handle, host: *const u16, port: u16, reserved: u32) -> Handle;
    fn WinHttpOpenRequest(
        connect: Handle,
        verb: *const u16,
        route: *const u16,
        version: *const u16,
        referer: *const u16,
        accept: *const *const u16,
        flags: u32,
    ) -> Handle;
    fn WinHttpSetOption(handle: Handle, option: u32, buffer: *const c_void, length: u32) -> i32;
    fn WinHttpSetStatusCallback(
        handle: Handle,
        callback: Callback,
        flags: u32,
        reserved: usize,
    ) -> usize;
    fn WinHttpCloseHandle(handle: Handle) -> i32;
    fn WinHttpAddRequestHeaders(
        request: Handle,
        headers: *const u16,
        length: u32,
        flags: u32,
    ) -> i32;
    fn WinHttpSendRequest(
        request: Handle,
        headers: *const u16,
        header_length: u32,
        body: *const c_void,
        body_length: u32,
        total: u32,
        context: usize,
    ) -> i32;
    fn WinHttpReceiveResponse(request: Handle, reserved: *mut c_void) -> i32;
    fn WinHttpQueryHeaders(
        request: Handle,
        level: u32,
        name: *const u16,
        buffer: *mut c_void,
        size: *mut u32,
        index: *mut u32,
    ) -> i32;
    fn WinHttpWebSocketCompleteUpgrade(request: Handle, context: usize) -> Handle;
    fn WinHttpWebSocketSend(socket: Handle, kind: u32, data: *const c_void, length: u32) -> u32;
    fn WinHttpWebSocketReceive(
        socket: Handle,
        data: *mut c_void,
        length: u32,
        read: *mut u32,
        kind: *mut u32,
    ) -> u32;
    fn WinHttpWebSocketClose(socket: Handle, code: u16, reason: *const c_void, length: u32) -> u32;
    fn WinHttpWebSocketQueryCloseStatus(
        socket: Handle,
        code: *mut u16,
        reason: *mut c_void,
        length: u32,
        read: *mut u32,
    ) -> u32;
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateEventW(
        attributes: *const c_void,
        manual: i32,
        initial: i32,
        name: *const u16,
    ) -> Handle;
    fn WaitForSingleObject(event: Handle, millis: u32) -> u32;
    fn CloseHandle(handle: Handle) -> i32;
}

#[derive(Debug, PartialEq, Eq)]
pub enum SocketError {
    InvalidHeaders,
    Cancelled,
    Timeout,
    Status(u32),
    Protocol,
    MessageLimit,
    Teardown,
    Native(u32),
}
type Result<T> = std::result::Result<T, SocketError>;

#[derive(Debug)]
enum Event {
    RequestSent,
    Headers,
    Read { bytes: usize, kind: u32 },
    Written,
    Closed,
    Failed(u32),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Poll {
    Pending,
    Message(String),
    Closed { code: u16, reason: String },
}

#[derive(Debug, PartialEq, Eq)]
#[cfg(test)]
pub enum CloseOutcome {
    Graceful,
    Aborted,
}

unsafe extern "system" fn status_callback(
    _: Handle,
    context: usize,
    status: u32,
    info: *const c_void,
    size: u32,
) {
    if context == 0 {
        return;
    }
    let event = match status {
        SEND_REQUEST => Event::RequestSent,
        HEADERS => Event::Headers,
        READ if !info.is_null() && size >= 8 => Event::Read {
            bytes: unsafe { info.cast::<u32>().read_unaligned() } as usize,
            kind: unsafe { info.cast::<u32>().add(1).read_unaligned() },
        },
        WRITE => Event::Written,
        CLOSE => Event::Closed,
        ERROR if !info.is_null() && size as usize >= std::mem::size_of::<usize>() + 4 => {
            Event::Failed(unsafe {
                info.cast::<u8>()
                    .add(std::mem::size_of::<usize>())
                    .cast::<u32>()
                    .read_unaligned()
            })
        }
        _ => return,
    };
    // The session unload event fences all callbacks before the sender is released.
    let _ = unsafe { &*(context as *const mpsc::Sender<Event>) }.send(event);
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain([0]).collect()
}
fn last_error() -> SocketError {
    SocketError::Native(std::io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32)
}
fn check(result: i32) -> Result<()> {
    if result != 0 {
        Ok(())
    } else {
        Err(last_error())
    }
}
fn check_handle(handle: Handle) -> Result<Handle> {
    if !handle.is_null() {
        Ok(handle)
    } else {
        Err(last_error())
    }
}
fn start(result: u32) -> Result<()> {
    if result == 0 || result == 997 {
        Ok(())
    } else {
        Err(SocketError::Native(result))
    }
}
fn set<T>(handle: Handle, option: u32, value: &T) -> Result<()> {
    check(unsafe {
        WinHttpSetOption(
            handle,
            option,
            (value as *const T).cast(),
            std::mem::size_of::<T>() as u32,
        )
    })
}

fn request_headers(token: &str, account: &str) -> Result<Vec<u16>> {
    let token_char = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.');
    if token.is_empty()
        || token.len() > 16_384
        || !token.bytes().all(token_char)
        || account.is_empty()
        || account.len() > 256
        || !account.bytes().all(token_char)
    {
        return Err(SocketError::InvalidHeaders);
    }
    Ok(wide(&format!("Sec-WebSocket-Protocol: {PROTOCOL}, codex-client.desktop, openai-bearer.{token}\r\nX-OpenAI-Product-Sku: codex\r\nChatGPT-Account-Id: {account}\r\noriginator: Codex Desktop\r\n")))
}

struct IoStorage {
    sender: mpsc::Sender<Event>,
    incoming: [u8; 16 * 1024],
    outgoing: Vec<u8>,
}

pub struct DurableSocket {
    session: Handle,
    connection: Handle,
    request: Handle,
    socket: Handle,
    unloaded: Handle,
    unload_registered: bool,
    storage: *mut IoStorage,
    events: mpsc::Receiver<Event>,
    fragment: Vec<u8>,
    pending_read: bool,
    read_completed: Option<Event>,
    ended: bool,
}

impl DurableSocket {
    pub fn connect(
        token: &str,
        account: &str,
        user_agent: &str,
        cancel: &AtomicBool,
    ) -> Result<Self> {
        Self::open(
            DURABLE_HOST,
            443,
            "/",
            true,
            token,
            account,
            user_agent,
            cancel,
            Duration::from_secs(15),
        )
    }

    fn open(
        host: &str,
        port: u16,
        path: &str,
        secure: bool,
        token: &str,
        account: &str,
        agent: &str,
        cancel: &AtomicBool,
        timeout: Duration,
    ) -> Result<Self> {
        if cancel.load(Ordering::Acquire) {
            return Err(SocketError::Cancelled);
        }
        if agent.is_empty() || agent.len() > 1024 || agent.chars().any(char::is_control) {
            return Err(SocketError::InvalidHeaders);
        }
        let mut headers = request_headers(token, account)?;
        let (sender, events) = mpsc::channel();
        let mut result = Self {
            session: null_mut(),
            connection: null_mut(),
            request: null_mut(),
            socket: null_mut(),
            unloaded: null_mut(),
            unload_registered: false,
            storage: Box::into_raw(Box::new(IoStorage {
                sender,
                incoming: [0; 16 * 1024],
                outgoing: Vec::new(),
            })),
            events,
            fragment: Vec::new(),
            pending_read: false,
            read_completed: None,
            ended: false,
        };
        let deadline = Instant::now() + timeout;
        let access = if secure { 4 } else { 1 }; // Automatic Windows proxy for WSS, direct for loopback.
        result.session = check_handle(unsafe {
            WinHttpOpen(wide(agent).as_ptr(), access, null(), null(), 0x10000000)
        })?;
        result.unloaded = check_handle(unsafe { CreateEventW(null(), 1, 0, null()) })?;
        set(result.session, 99, &result.unloaded)?;
        result.unload_registered = true;
        if unsafe {
            WinHttpSetStatusCallback(
                result.session,
                status_callback,
                SEND_REQUEST | HEADERS | READ | WRITE | ERROR | CLOSE,
                0,
            )
        } == usize::MAX
        {
            return Err(last_error());
        }
        result.connection =
            check_handle(unsafe { WinHttpConnect(result.session, wide(host).as_ptr(), port, 0) })?;
        let flags = if secure { 0x00800000 } else { 0 };
        result.request = check_handle(unsafe {
            WinHttpOpenRequest(
                result.connection,
                wide("GET").as_ptr(),
                wide(path).as_ptr(),
                null(),
                null(),
                null(),
                flags,
            )
        })?;
        set(result.request, 88, &0u32)?; // Never redirect credentials.
        set(result.request, 77, &2u32)?; // Disable automatic Windows logon.
        check(unsafe { WinHttpSetOption(result.request, 114, null(), 0) })?;
        let add = unsafe {
            WinHttpAddRequestHeaders(result.request, headers.as_ptr(), u32::MAX, 0x20000000)
        };
        headers.fill(0);
        check(add)?;
        let context = unsafe { std::ptr::addr_of!((*result.storage).sender) } as usize;
        check(unsafe { WinHttpSendRequest(result.request, null(), 0, null(), 0, 0, context) })?;
        if !matches!(result.next(cancel, deadline)?, Event::RequestSent) {
            return Err(SocketError::Protocol);
        }
        check(unsafe { WinHttpReceiveResponse(result.request, null_mut()) })?;
        if !matches!(result.next(cancel, deadline)?, Event::Headers) {
            return Err(SocketError::Protocol);
        }
        let mut status = 0u32;
        let mut bytes = 4u32;
        check(unsafe {
            WinHttpQueryHeaders(
                result.request,
                0x20000013,
                null(),
                (&mut status as *mut u32).cast(),
                &mut bytes,
                null_mut(),
            )
        })?;
        if status != 101 {
            return Err(SocketError::Status(status));
        }
        let mut negotiated = vec![0u16; token.len() + 32];
        let capacity = (negotiated.len() * 2) as u32;
        let mut bytes = capacity;
        let mut index = 0;
        let protocol_header = wide("Sec-WebSocket-Protocol");
        let queried = unsafe {
            WinHttpQueryHeaders(
                result.request,
                65535,
                protocol_header.as_ptr(),
                negotiated.as_mut_ptr().cast(),
                &mut bytes,
                &mut index,
            )
        };
        if queried == 0 || bytes % 2 != 0 || bytes > capacity {
            return Err(SocketError::Protocol);
        }
        let selected = &negotiated[..bytes as usize / 2];
        let offered = selected.iter().copied().eq(PROTOCOL.encode_utf16())
            || selected
                .iter()
                .copied()
                .eq("codex-client.desktop".encode_utf16())
            || selected
                .iter()
                .copied()
                .eq("openai-bearer.".encode_utf16().chain(token.encode_utf16()));
        bytes = capacity;
        let duplicate = unsafe {
            WinHttpQueryHeaders(
                result.request,
                65535,
                protocol_header.as_ptr(),
                negotiated.as_mut_ptr().cast(),
                &mut bytes,
                &mut index,
            )
        };
        let absent = duplicate == 0 && last_error() == SocketError::Native(12150);
        negotiated.fill(0);
        if !offered || !absent {
            return Err(SocketError::Protocol);
        }
        result.socket =
            check_handle(unsafe { WinHttpWebSocketCompleteUpgrade(result.request, context) })?;
        Ok(result)
    }

    fn next(&self, cancel: &AtomicBool, deadline: Instant) -> Result<Event> {
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err(SocketError::Cancelled);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(SocketError::Timeout);
            }
            match self
                .events
                .recv_timeout(remaining.min(Duration::from_millis(25)))
            {
                Ok(_) if cancel.load(Ordering::Acquire) => return Err(SocketError::Cancelled),
                Ok(Event::Failed(code)) => return Err(SocketError::Native(code)),
                Ok(event) => return Ok(event),
                Err(mpsc::RecvTimeoutError::Timeout) => (),
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(SocketError::Protocol),
            }
        }
    }

    pub fn send(&mut self, text: &str, cancel: &AtomicBool, deadline: Instant) -> Result<()> {
        self.run(cancel, |socket| {
            if Instant::now() >= deadline {
                return Err(SocketError::Timeout);
            }
            let length = u32::try_from(text.len()).map_err(|_| SocketError::MessageLimit)?;
            let outgoing = unsafe { &mut (*socket.storage).outgoing };
            outgoing.extend_from_slice(text.as_bytes());
            start(unsafe {
                WinHttpWebSocketSend(socket.socket, 2, outgoing.as_ptr().cast(), length)
            })?;
            loop {
                match socket.next(cancel, deadline)? {
                    Event::Written => {
                        outgoing.clear();
                        return Ok(());
                    }
                    event @ Event::Read { .. }
                        if socket.pending_read && socket.read_completed.is_none() =>
                    {
                        socket.read_completed = Some(event)
                    }
                    _ => return Err(SocketError::Protocol),
                }
            }
        })
    }

    #[cfg(test)]
    pub fn receive(&mut self, cancel: &AtomicBool, deadline: Instant) -> Result<Option<String>> {
        match self.poll_receive(cancel, deadline)? {
            Poll::Message(text) => Ok(Some(text)),
            Poll::Closed { .. } => Ok(None),
            Poll::Pending => {
                self.ended = true;
                self.teardown()?;
                Err(SocketError::Timeout)
            }
        }
    }

    pub fn poll_receive(&mut self, cancel: &AtomicBool, deadline: Instant) -> Result<Poll> {
        if Instant::now() >= deadline && !cancel.load(Ordering::Acquire) && !self.ended {
            return Ok(Poll::Pending);
        }
        self.run(cancel, |socket| {
            loop {
                let incoming =
                    unsafe { std::ptr::addr_of_mut!((*socket.storage).incoming).cast::<u8>() };
                if !socket.pending_read {
                    start(unsafe {
                        WinHttpWebSocketReceive(
                            socket.socket,
                            incoming.cast(),
                            16 * 1024,
                            null_mut(),
                            null_mut(),
                        )
                    })?;
                    socket.pending_read = true;
                }
                let event = match socket
                    .read_completed
                    .take()
                    .map(Ok)
                    .unwrap_or_else(|| socket.next(cancel, deadline))
                {
                    Ok(event) => event,
                    Err(SocketError::Timeout) => return Ok(Poll::Pending),
                    Err(error) => return Err(error),
                };
                socket.pending_read = false;
                match event {
                    Event::Read { kind: 4, .. } => {
                        let (mut code, mut length, mut buffer) = (0, 0, [0u8; 123]);
                        let status = unsafe {
                            WinHttpWebSocketQueryCloseStatus(
                                socket.socket,
                                &mut code,
                                buffer.as_mut_ptr().cast(),
                                buffer.len() as u32,
                                &mut length,
                            )
                        };
                        if status != 0 || length as usize > buffer.len() {
                            return Err(SocketError::Protocol);
                        }
                        let reason = std::str::from_utf8(&buffer[..length as usize])
                            .map_err(|_| SocketError::Protocol)?;
                        socket.finish_close(
                            cancel,
                            Instant::now() + Duration::from_secs(2),
                            code,
                            reason,
                        )?;
                        return Ok(Poll::Closed {
                            code,
                            reason: reason.to_owned(),
                        });
                    }
                    Event::Read {
                        bytes,
                        kind: kind @ (2 | 3),
                    } if bytes <= 16 * 1024 => {
                        if socket.fragment.len() + bytes > MAX_INBOUND_MESSAGE {
                            return Err(SocketError::MessageLimit);
                        }
                        // This read completion fences the native writer before constructing the slice.
                        socket.fragment.extend_from_slice(unsafe {
                            std::slice::from_raw_parts(incoming, bytes)
                        });
                        if kind == 2 {
                            return String::from_utf8(std::mem::take(&mut socket.fragment))
                                .map(Poll::Message)
                                .map_err(|_| SocketError::Protocol);
                        }
                    }
                    _ => return Err(SocketError::Protocol),
                }
            }
        })
    }

    #[cfg(test)]
    pub fn close(mut self, cancel: &AtomicBool, deadline: Instant) -> Result<CloseOutcome> {
        if self.pending_read {
            self.teardown()?;
            return Ok(CloseOutcome::Aborted);
        }
        self.run(cancel, |socket| {
            socket.finish_close(cancel, deadline, 1000, "")
        })?;
        self.teardown()?;
        Ok(CloseOutcome::Graceful)
    }

    fn finish_close(
        &mut self,
        cancel: &AtomicBool,
        deadline: Instant,
        code: u16,
        reason: &str,
    ) -> Result<()> {
        if Instant::now() >= deadline {
            return Err(SocketError::Timeout);
        }
        let outgoing = unsafe { &mut (*self.storage).outgoing };
        outgoing.extend_from_slice(reason.as_bytes());
        let reason_ptr = if outgoing.is_empty() {
            null()
        } else {
            outgoing.as_ptr().cast()
        };
        start(unsafe {
            WinHttpWebSocketClose(self.socket, code, reason_ptr, outgoing.len() as u32)
        })?;
        if !matches!(self.next(cancel, deadline)?, Event::Closed) {
            return Err(SocketError::Protocol);
        }
        self.ended = true;
        Ok(())
    }

    fn run<T>(
        &mut self,
        cancel: &AtomicBool,
        action: impl FnOnce(&mut Self) -> Result<T>,
    ) -> Result<T> {
        if self.ended {
            return Err(SocketError::Protocol);
        }
        let result = if cancel.load(Ordering::Acquire) {
            Err(SocketError::Cancelled)
        } else {
            action(self)
        };
        if result.is_err() {
            self.ended = true;
            self.teardown()?;
        }
        result
    }

    fn teardown(&mut self) -> Result<()> {
        if self.storage.is_null() {
            return Ok(());
        }
        let storage = std::mem::replace(&mut self.storage, null_mut());
        let mut closed = true;
        for handle in [
            &mut self.socket,
            &mut self.request,
            &mut self.connection,
            &mut self.session,
        ] {
            if !handle.is_null() {
                closed &= unsafe { WinHttpCloseHandle(*handle) } != 0;
                *handle = null_mut();
            }
        }
        if !self.unloaded.is_null() {
            // No operation or callback may retain the sender or either I/O buffer after this fence.
            if self.unload_registered
                && (!closed || unsafe { WaitForSingleObject(self.unloaded, 2_000) } != 0)
            {
                // An unproven unload must never free callback context, event or native I/O memory.
                return Err(SocketError::Teardown);
            }
            unsafe { CloseHandle(self.unloaded) };
            self.unloaded = null_mut();
        }
        unsafe { drop(Box::from_raw(storage)) };
        Ok(())
    }
}

impl Drop for DurableSocket {
    fn drop(&mut self) {
        let _ = self.teardown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpStream;
    use std::path::Path;
    use std::process::{Child, Command, Stdio};

    struct Peer {
        child: Child,
        port: u16,
        tls_port: u16,
    }

    impl Peer {
        fn start() -> Self {
            let script = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("scripts/fixtures/durable-peer.mjs");
            let mut command = Command::new("node");
            command
                .arg(script)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut peer = Self {
                child: command.spawn().expect("start loopback Node fixture"),
                port: 0,
                tls_port: 0,
            };
            let stdout = peer.child.stdout.take().unwrap();
            let (sender, ready) = mpsc::channel();
            let reader = std::thread::spawn(move || {
                let mut line = String::new();
                let result = BufReader::new(stdout)
                    .take(1024)
                    .read_line(&mut line)
                    .map(|_| line);
                let _ = sender.send(result);
            });
            let line = match ready.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(line)) => line,
                _ => {
                    peer.stop();
                    let _ = reader.join();
                    panic!("loopback fixture did not become ready");
                }
            };
            reader.join().unwrap();
            let fields = line
                .trim()
                .strip_prefix('{')
                .and_then(|value| value.strip_suffix('}'))
                .expect("fixture readiness object");
            for field in fields.split(',') {
                let (name, value) = field.split_once(':').expect("fixture readiness field");
                match name {
                    "\"port\"" => peer.port = value.parse().unwrap(),
                    "\"tlsPort\"" => peer.tls_port = value.parse().unwrap(),
                    _ => panic!("unexpected fixture readiness field"),
                }
            }
            assert_ne!(peer.port, 0);
            assert_ne!(peer.tls_port, 0);
            peer
        }

        fn metrics(&self) -> String {
            let address = ([127, 0, 0, 1], self.port).into();
            let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .write_all(b"GET /metrics HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .unwrap();
            let mut response = String::new();
            stream.take(8192).read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 200"));
            response.split_once("\r\n\r\n").unwrap().1.to_owned()
        }

        fn stop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    impl Drop for Peer {
        fn drop(&mut self) {
            self.stop();
        }
    }

    #[test]
    fn credentials_are_rejected_before_the_fixed_wss_dial() {
        for (token, account) in [
            ("", "fixture"),
            ("first,second", "fixture"),
            ("fixture-only", "evil\r\nHeader: bad"),
        ] {
            assert!(matches!(
                DurableSocket::connect(token, account, "fixture", &AtomicBool::new(false)),
                Err(SocketError::InvalidHeaders)
            ));
        }
        assert!(matches!(
            DurableSocket::connect("fixture-only", "fixture", "fixture", &AtomicBool::new(true)),
            Err(SocketError::Cancelled)
        ));
    }

    #[test]
    fn windows_loopback_exercises_upgrade_frames_close_and_cancellation() {
        let peer = Peer::start();
        let cancel = AtomicBool::new(false);
        let dial = |path| {
            DurableSocket::open(
                "127.0.0.1",
                peer.port,
                path,
                false,
                "fixture-only",
                "fixture-account",
                "fixture",
                &cancel,
                Duration::from_secs(2),
            )
        };
        let deadline = || Instant::now() + Duration::from_secs(2);
        let mut socket = dial("/durable").unwrap();
        socket
            .send(
                r#"{"id":"__codex_initialize__","method":"initialize"}"#,
                &cancel,
                deadline(),
            )
            .unwrap();
        assert_eq!(
            socket.receive(&cancel, deadline()).unwrap().as_deref(),
            Some(r#"{"id":"__codex_initialize__","result":{"label":"分段回执"}}"#)
        );
        assert_eq!(
            socket
                .poll_receive(&cancel, Instant::now() + Duration::from_millis(40))
                .unwrap(),
            Poll::Pending
        );
        socket.send(r#"{"id":"resume:fixture","method":"thread/resume","params":{"threadId":"thread-fixture"}}"#, &cancel, deadline()).unwrap();
        assert_eq!(
            socket.receive(&cancel, deadline()).unwrap().as_deref(),
            Some(r#"{"method":"item/agentMessage/delta","params":{"delta":"通知"}}"#)
        );
        assert_eq!(
            socket.receive(&cancel, deadline()).unwrap().as_deref(),
            Some(r#"{"id":"resume:fixture","result":{"thread":{"id":"thread-fixture"}}}"#)
        );
        assert_eq!(
            socket.close(&cancel, deadline()),
            Ok(CloseOutcome::Graceful)
        );
        assert!(matches!(dial("/redirect"), Err(SocketError::Status(307))));
        assert!(matches!(dial("/bad-protocol"), Err(SocketError::Protocol)));
        assert!(matches!(dial("/no-protocol"), Err(SocketError::Protocol)));
        assert!(matches!(
            dial("/duplicate-protocol"),
            Err(SocketError::Protocol)
        ));
        drop(dial("/alternate-protocol").unwrap());
        let mut closing = dial("/server-close").unwrap();
        assert_eq!(
            closing.poll_receive(&cancel, deadline()).unwrap(),
            Poll::Closed {
                code: 4001,
                reason: "隔离关闭".to_owned()
            }
        );
        let mut idle = dial("/cancel").unwrap();
        assert_eq!(
            idle.poll_receive(&cancel, Instant::now() + Duration::from_millis(40))
                .unwrap(),
            Poll::Pending
        );
        std::thread::scope(|scope| {
            scope.spawn(|| {
                cancel.store(true, Ordering::Release);
            });
            assert_eq!(
                idle.receive(&cancel, deadline()),
                Err(SocketError::Cancelled)
            );
        });
        cancel.store(false, Ordering::Release);
        assert_eq!(
            idle.receive(&cancel, deadline()),
            Err(SocketError::Protocol)
        );
        let mut idle = dial("/timeout").unwrap();
        assert_eq!(
            idle.receive(&cancel, Instant::now() + Duration::from_millis(75)),
            Err(SocketError::Timeout)
        );
        let mut idle = dial("/abort").unwrap();
        assert_eq!(
            idle.poll_receive(&cancel, Instant::now() + Duration::from_millis(40))
                .unwrap(),
            Poll::Pending
        );
        assert_eq!(idle.close(&cancel, deadline()), Ok(CloseOutcome::Aborted));
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let until = Instant::now() + Duration::from_secs(2);
                while !peer.metrics().contains("\"/stall\"") {
                    assert!(
                        Instant::now() < until,
                        "stalled upgrade must reach the loopback peer"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                cancel.store(true, Ordering::Release);
            });
            assert!(matches!(dial("/stall"), Err(SocketError::Cancelled)));
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        let metrics = loop {
            let metrics = peer.metrics();
            if metrics.contains("\"canceledPeers\":4") {
                break metrics;
            }
            assert!(
                Instant::now() < deadline,
                "all canceled loopback sockets must close"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        assert!(metrics.contains("\"routes\":[\"/durable\",\"/redirect\",\"/bad-protocol\",\"/no-protocol\",\"/duplicate-protocol\",\"/alternate-protocol\",\"/server-close\",\"/cancel\",\"/timeout\",\"/abort\",\"/stall\"]"));
        assert!(metrics.contains("\"upgraded\":1,\"redirects\":1,\"followed\":0,\"closed\":1"));
        assert!(metrics.contains("\"serverCloseReply\":{\"code\":4001,\"reason\":\"隔离关闭\"}"));
    }

    #[test]
    fn untrusted_tls_peer_does_not_receive_the_upgrade() {
        let peer = Peer::start();
        let cancel = AtomicBool::new(false);
        assert!(matches!(
            DurableSocket::open(
                "127.0.0.1",
                peer.tls_port,
                "/",
                true,
                "fixture-only",
                "fixture-account",
                "fixture",
                &cancel,
                Duration::from_secs(3)
            ),
            Err(SocketError::Native(12175))
        ));
        let metrics = peer.metrics();
        assert!(metrics.contains("\"tlsRequests\":0,\"tlsConnections\":1"));
    }

    #[tokio::test]
    async fn manager_reuses_the_windows_session_for_models_and_thread_hydration() {
        use super::super::{ConnectionConfig, Error, Manager, Notification, Notify, Request, Wire};
        use crate::chatgpt_service::ServiceIdentity;
        use serde_json::Value;
        use std::sync::{Arc, Mutex};

        let peer = Peer::start();
        let manager = Manager::default();
        let identity = ServiceIdentity {
            account_id: "fixture-account".into(),
            user_id: "fixture-user".into(),
            generation: 7,
        };
        let config = || ConnectionConfig {
            identity: identity.clone(),
            token: "fixture-only".into(),
            user_agent: "fixture".into(),
        };
        let connect = || {
            let port = peer.port;
            move |config: &ConnectionConfig, stop: &AtomicBool| {
                DurableSocket::open(
                    "127.0.0.1",
                    port,
                    "/session",
                    false,
                    &config.token,
                    &config.identity.account_id,
                    &config.user_agent,
                    stop,
                    Duration::from_secs(2),
                )
                .map(|socket| Box::new(socket) as Box<dyn Wire>)
                .map_err(|_| Error::Unavailable)
            }
        };
        let notifications = Arc::new(Mutex::new(Vec::<Notification>::new()));
        let captured = notifications.clone();
        let notify: Notify =
            Arc::new(move |notification| captured.lock().unwrap().push(notification));
        // Exercise masked 127-length requests and large inbound replies as well as initialize's 126 length.
        let cursor = "x".repeat(70_000);
        let (first, second) = tokio::time::timeout(Duration::from_secs(8), async {
            tokio::join!(
                manager.request_with(
                    config(),
                    Request::models(None),
                    Arc::new(AtomicBool::new(false)),
                    notify.clone(),
                    connect()
                ),
                manager.request_with(
                    config(),
                    Request::models(Some(cursor.clone())),
                    Arc::new(AtomicBool::new(false)),
                    notify.clone(),
                    connect()
                )
            )
        })
        .await
        .expect("both concurrent model reads must complete");
        assert_eq!(first.unwrap()["data"][0]["id"], "first-page");
        assert_eq!(second.unwrap()["data"][0]["id"], cursor);
        let thread = "thread-fixture";
        let requests = [
            ("configRequirements/read", Value::Null, serde_json::json!({"requirements":null})),
            ("thread/name/set", serde_json::json!({"threadId":thread,"name":"编辑 fixture"}), serde_json::json!({})),
            ("thread/archive", serde_json::json!({"threadId":thread}), serde_json::json!({})),
            ("thread/unarchive", serde_json::json!({"threadId":thread}), serde_json::json!({})),
            ("thread/read", serde_json::json!({"threadId":thread,"includeTurns":false}), serde_json::json!({"thread":{"id":thread}})),
            ("thread/list", serde_json::json!({"cursor":"page-token","limit":100,"archived":false,"useStateDbOnly":true,"sortKey":"updated_at"}), serde_json::json!({"data":[{"id":thread}],"nextCursor":null})),
            ("thread/list", serde_json::json!({"cursor":"archived-page","limit":100,"archived":true,"useStateDbOnly":true,"sortKey":"updated_at"}), serde_json::json!({"data":[{"id":thread,"archived":true}],"nextCursor":null})),
            ("thread/resume", serde_json::json!({"threadId":thread,"history":null,"model":null,"serviceTier":null,"excludeTurns":true}), serde_json::json!({"thread":{"id":thread}})),
            ("thread/turns/list", serde_json::json!({"threadId":thread,"limit":5,"cursor":null,"sortDirection":"desc","itemsView":"notLoaded"}), serde_json::json!({"data":[{"id":"turn-fixture"}],"nextCursor":null})),
            ("thread/items/list", serde_json::json!({"threadId":thread,"turnId":"turn-fixture","limit":98,"cursor":null,"sortDirection":"desc"}), serde_json::json!({"data":[{"turnId":"turn-fixture","item":{"id":"item-fixture"}}],"nextCursor":null})),
        ];
        for (method, params, expected) in requests {
            if method == "thread/resume" {
                for error in [Error::Remote(-32603), Error::ThreadClosing] {
                    let result = manager.request_with(config(), Request { method, params: params.clone(), timeout: Duration::from_secs(3) },
                        Arc::new(AtomicBool::new(false)), notify.clone(), connect()).await;
                    assert_eq!(result, Err(error));
                }
            }
            let response = manager.request_with(config(), Request { method, params, timeout: Duration::from_secs(3) },
                Arc::new(AtomicBool::new(false)), notify.clone(), connect()).await.unwrap();
            assert_eq!(response, expected);
        }
        {
            let notifications = notifications.lock().unwrap();
            assert_eq!(
                notifications.len(),
                1,
                "pre-initialize notification must be dropped"
            );
            assert_eq!(notifications[0].host_id, "durable");
            assert_eq!(notifications[0].identity, identity);
            assert_eq!(notifications[0].method, "fixture/notice");
            assert_eq!(notifications[0].params["threadId"], "thread-fixture");
            assert_eq!(notifications[0].params["delta"], "来自回环");
        }
        let metrics: Value = serde_json::from_str(&peer.metrics()).unwrap();
        let session = &metrics["session"];
        assert_eq!(session["connections"], 1);
        assert_eq!(session["initializeCount"], 1);
        assert_eq!(session["attestations"], 1);
        assert_eq!(session["capabilities"]["requestAttestation"], true);
        assert_eq!(
            session["capabilities"],
            super::super::protocol::initialize()["params"]["capabilities"]
        );
        let models = session["models"].as_array().unwrap();
        assert_eq!(models.len(), 2);
        assert_ne!(models[0]["id"], models[1]["id"]);
        assert_eq!(models[0]["cursorLength"], 0);
        assert_eq!(models[1]["cursorLength"], 70_000);
        assert!(session["maxClientLength"].as_u64().unwrap() > 65_535);
        manager.invalidate();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let metrics: Value = serde_json::from_str(&peer.metrics()).unwrap();
            if metrics["session"]["closed"] == 1 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "invalidating Manager must close the native socket"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
