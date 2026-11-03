//! Same-user, local-machine single-instance delivery. No Tauri or protocol registration.
//! Pipe possession is coordination, not a security boundary against same-user processes.
#[cfg(windows)]
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::sync::{mpsc as async_mpsc, oneshot};

const MAX_FRAME: usize = 32 * 1024;
const MAX_ARGUMENTS: usize = 32;
const MAX_ARGUMENT: usize = 8192;
const QUEUE_SIZE: usize = 16;
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(2);
const FORWARD_TIMEOUT: Duration = Duration::from_secs(3);

pub fn instance_scope(executable: &std::path::Path, home: &std::path::Path) -> Result<String, String> {
    // canonicalize depends on existence and adds a Windows device prefix only
    // after a new home is created. Absolute lexical paths remain stable at boot.
    let executable = std::path::absolute(executable).map_err(|_| "无法解析应用路径。")?;
    let home = std::path::absolute(home).map_err(|_| "无法解析应用数据目录。")?;
    let scope = serde_json::to_string(&(executable, home)).map_err(|_| "无法编码应用实例作用域。")?;
    #[cfg(windows)]
    let scope = scope.to_lowercase();
    Ok(scope)
}

pub struct PrimaryInstance {
    receiver: Option<async_mpsc::Receiver<Vec<String>>>,
    shutdown: Option<oneshot::Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl PrimaryInstance {
    /// Take once in application setup. Empty argv means restore the main window.
    pub fn take_receiver(&mut self) -> Option<async_mpsc::Receiver<Vec<String>>> {
        self.receiver.take()
    }
}

impl Drop for PrimaryInstance {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn encode_payload(payload: &[String]) -> Result<Vec<u8>, String> {
    if payload.len() > MAX_ARGUMENTS || payload.iter().any(|arg|
        arg.len() > MAX_ARGUMENT || arg.contains('\0')) {
        return Err("启动参数超过实例传输限制。".into());
    }
    let bytes = serde_json::to_vec(payload).map_err(|_| "无法编码启动参数。")?;
    if bytes.len() > MAX_FRAME {
        return Err("启动参数帧过大。".into());
    }
    Ok(bytes)
}

fn pipe_name(scope: &str) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    if scope.is_empty() || scope.len() > 32 * 1024 || scope.chars().any(char::is_control) {
        return Err("无效的实例作用域。".into());
    }
    // Only this exact executable/home scope participates. No raw paths enter the
    // pipe name. The hash is coordination naming, not authentication.
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    scope.hash(&mut hash);
    Ok(format!(r"\\.\pipe\codex-native-instance-{:016x}", hash.finish()))
}

/// Call before constructing Tauri. Some owns the primary listener; None means the
/// existing instance acknowledged enqueueing this payload. Errors never mean delivered.
/// The caller supplies a stable scope derived from executable path and Codex home.
pub fn acquire_or_forward(scope: &str, payload: Vec<String>) -> Result<Option<PrimaryInstance>, String> {
    let name = pipe_name(scope)?;
    let bytes = encode_payload(&payload)?;
    #[cfg(not(windows))]
    {
        let _ = (name, bytes);
        return Err("当前平台尚未实现实例转发。".into());
    }
    #[cfg(windows)]
    {
        let (sender, receiver) = async_mpsc::channel(QUEUE_SIZE);
        let (shutdown, stopped) = oneshot::channel();
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let worker = std::thread::Builder::new().name("codex-instance-pipe".into()).spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(_) => { let _ = started_tx.send(Err("无法启动实例传输运行时。".into())); return; }
            };
            runtime.block_on(async move {
                use tokio::net::windows::named_pipe::ServerOptions;
                match ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).create(&name) {
                    Ok(server) => {
                        // Initial arguments use the same queue as secondary instances.
                        if sender.try_send(payload).is_err() {
                            let _ = started_tx.send(Err("无法缓存初始启动参数。".into()));
                            return;
                        }
                        if started_tx.send(Ok(true)).is_err() { return; }
                        tokio::select! {
                            _ = stopped => {}
                            _ = serve(&name, server, sender) => {}
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                        let result = forward(&name, &bytes).await.map(|()| false);
                        let _ = started_tx.send(result);
                    }
                    Err(_) => { let _ = started_tx.send(Err("无法创建本地实例管道。".into())); }
                }
            });
        }).map_err(|_| "无法启动实例传输线程。")?;
        let mut primary = PrimaryInstance {
            receiver: Some(receiver), shutdown: Some(shutdown), worker: Some(worker),
        };
        match started_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(true)) => Ok(Some(primary)),
            Ok(Ok(false)) => { primary.receiver.take(); Ok(None) }
            Ok(Err(error)) => Err(error),
            Err(_) => Err("实例传输启动未确认。".into()),
        }
    }
}

#[cfg(windows)]
async fn forward(name: &str, bytes: &[u8]) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::ClientOptions;
    tokio::time::timeout(FORWARD_TIMEOUT, async {
        let mut client = loop {
            match ClientOptions::new().open(name) {
                Ok(client) => break client,
                Err(error) if error.raw_os_error() == Some(231) || error.kind() == std::io::ErrorKind::NotFound => {
                    // ERROR_PIPE_BUSY: the primary exists, but every instance is busy.
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Err(_) => return Err("无法连接已有实例。".into()),
            }
        };
        client.write_all(&(bytes.len() as u32).to_le_bytes()).await.map_err(|_| "无法发送实例帧长度。")?;
        client.write_all(bytes).await.map_err(|_| "无法发送启动参数。")?;
        let mut acknowledgement = [0u8];
        client.read_exact(&mut acknowledgement).await.map_err(|_| "已有实例未确认启动参数。")?;
        if acknowledgement != [1] { return Err("已有实例拒绝启动参数或接收队列已满。".into()); }
        Ok(())
    }).await.map_err(|_| "实例转发超时，未确认交付。")?
}

#[cfg(windows)]
async fn serve(
    name: &str,
    mut server: tokio::net::windows::named_pipe::NamedPipeServer,
    sender: async_mpsc::Sender<Vec<String>>,
) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;
    loop {
        server.connect().await.map_err(|_| "实例管道监听失败。")?;
        // Keep a listening instance alive before processing this connection. Without
        // it, simultaneous launchers can see a gap or try to become another primary.
        let next = ServerOptions::new().reject_remote_clients(true).create(name)
            .map_err(|_| "无法继续监听实例管道。")?;
        let _ = tokio::time::timeout(TRANSFER_TIMEOUT, receive(&mut server, &sender)).await;
        server = next;
    }
}

#[cfg(windows)]
async fn receive(
    server: &mut tokio::net::windows::named_pipe::NamedPipeServer,
    sender: &async_mpsc::Sender<Vec<String>>,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut size = [0u8; 4];
    server.read_exact(&mut size).await.map_err(|_| "无法读取实例帧长度。")?;
    let size = u32::from_le_bytes(size) as usize;
    if size == 0 || size > MAX_FRAME {
        let _ = server.write_all(&[0]).await;
        return Err("无效的实例帧长度。".into());
    }
    let mut bytes = vec![0; size];
    server.read_exact(&mut bytes).await.map_err(|_| "实例参数帧不完整。")?;
    let payload = serde_json::from_slice::<Vec<String>>(&bytes)
        .map_err(|_| "无效的实例参数 JSON。")?;
    encode_payload(&payload)?;
    let accepted = sender.try_send(payload).is_ok();
    server.write_all(&[u8::from(accepted)]).await.map_err(|_| "无法确认实例参数。")?;
    if !accepted { return Err("实例接收队列已满或已关闭。".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_scope_stays_stable_when_a_new_home_is_created() {
        let root = std::env::temp_dir().join(format!("codex-instance-scope-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let home = root.join("new-home");
        let executable = root.join("app.exe");
        let before = instance_scope(&executable, &home).unwrap();
        std::fs::create_dir(&home).unwrap();
        assert_eq!(before, instance_scope(&executable, &home).unwrap());
        assert_ne!(before, instance_scope(&executable, &root.join("other-home")).unwrap());
        std::fs::remove_dir(home).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn instance_transport_bounds_and_scope_are_deterministic() {
        assert_eq!(pipe_name("exe|home").unwrap(), pipe_name("exe|home").unwrap());
        assert_ne!(pipe_name("exe|home").unwrap(), pipe_name("exe|other").unwrap());
        assert_ne!(pipe_name("exe|home").unwrap(), pipe_name("other|home").unwrap());
        assert!(pipe_name("").is_err());
        assert!(pipe_name("scope\nescape").is_err());
        assert!(encode_payload(&vec!["x".into(); MAX_ARGUMENTS + 1]).is_err());
        assert!(encode_payload(&["x".repeat(MAX_ARGUMENT + 1)]).is_err());
        assert!(encode_payload(&["nul\0value".into()]).is_err());
        assert!(encode_payload(&vec!["x".repeat(MAX_ARGUMENT); 5]).is_err());
        assert_eq!(encode_payload(&[]).unwrap(), b"[]");
    }

    #[cfg(windows)]
    fn receive_with_timeout(receiver: &mut async_mpsc::Receiver<Vec<String>>) -> Vec<String> {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            tokio::time::timeout(Duration::from_secs(5), receiver.recv()).await.unwrap().unwrap()
        })
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_pipe_roundtrip_secondaries_and_empty_restore() {
        let scope = uuid::Uuid::new_v4().to_string();
        let initial = vec!["codex://threads/12345678-1234-1234-1234-123456789abc".into()];
        let mut primary = acquire_or_forward(&scope, initial.clone()).unwrap().unwrap();
        let mut receiver = primary.take_receiver().unwrap();
        assert!(primary.take_receiver().is_none());
        assert_eq!(receive_with_timeout(&mut receiver), initial);
        assert!(acquire_or_forward(&scope, vec![]).unwrap().is_none());
        assert_eq!(receive_with_timeout(&mut receiver), Vec::<String>::new());
        let next = vec!["codex://threads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()];
        assert!(acquire_or_forward(&scope, next.clone()).unwrap().is_none());
        assert_eq!(receive_with_timeout(&mut receiver), next);
        drop(primary);
        assert!(acquire_or_forward(&scope, vec![]).unwrap().is_some());
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_malformed_frames_do_not_stop_the_listener() {
        let scope = uuid::Uuid::new_v4().to_string();
        let name = pipe_name(&scope).unwrap();
        let mut primary = acquire_or_forward(&scope, vec![]).unwrap().unwrap();
        let mut receiver = primary.take_receiver().unwrap();
        receive_with_timeout(&mut receiver);
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            use tokio::net::windows::named_pipe::ClientOptions;
            let mut client = ClientOptions::new().open(&name).unwrap();
            client.write_all(&((MAX_FRAME + 1) as u32).to_le_bytes()).await.unwrap();
            let mut ack = [1];
            tokio::time::timeout(Duration::from_secs(3), client.read_exact(&mut ack)).await.unwrap().unwrap();
            assert_eq!(ack, [0]);
        });
        assert!(acquire_or_forward(&scope, vec!["later".into()]).unwrap().is_none());
        assert_eq!(receive_with_timeout(&mut receiver), vec!["later"]);
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_simultaneous_launchers_elect_one_primary() {
        let scope = uuid::Uuid::new_v4().to_string();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let launchers: Vec<_> = (0..2).map(|index| {
            let scope = scope.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                acquire_or_forward(&scope, vec![format!("launcher-{index}")]).unwrap()
            })
        }).collect();
        let mut results: Vec<_> = launchers.into_iter().map(|thread| thread.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|result| result.is_some()).count(), 1);
        let mut primary = results.iter_mut().find_map(Option::take).unwrap();
        let mut receiver = primary.take_receiver().unwrap();
        let mut payloads = vec![receive_with_timeout(&mut receiver), receive_with_timeout(&mut receiver)];
        payloads.sort();
        assert_eq!(payloads, vec![vec!["launcher-0"], vec!["launcher-1"]]);
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_full_queue_is_not_acknowledged_as_delivery() {
        let scope = uuid::Uuid::new_v4().to_string();
        let mut primary = acquire_or_forward(&scope, vec![]).unwrap().unwrap();
        let mut receiver = primary.take_receiver().unwrap();
        for _ in 1..QUEUE_SIZE {
            assert!(acquire_or_forward(&scope, vec![]).unwrap().is_none());
        }
        assert!(acquire_or_forward(&scope, vec!["overflow".into()]).is_err());
        for _ in 0..QUEUE_SIZE { assert!(receive_with_timeout(&mut receiver).is_empty()); }
        assert!(acquire_or_forward(&scope, vec!["after-drain".into()]).unwrap().is_none());
        assert_eq!(receive_with_timeout(&mut receiver), vec!["after-drain"]);
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_shutdown_interrupts_a_stalled_client() {
        let scope = uuid::Uuid::new_v4().to_string();
        let name = pipe_name(&scope).unwrap();
        let primary = acquire_or_forward(&scope, vec![]).unwrap().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let client = runtime.block_on(async {
            tokio::net::windows::named_pipe::ClientOptions::new().open(&name).unwrap()
        });
        let started = std::time::Instant::now();
        drop(primary);
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(client);
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_child() {
        let Ok(scope) = std::env::var("CODEX_INSTANCE_TEST_SCOPE") else { return };
        let payload: Vec<String> = serde_json::from_str(&std::env::var("CODEX_INSTANCE_TEST_PAYLOAD").unwrap()).unwrap();
        assert!(acquire_or_forward(&scope, payload).unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn instance_transport_real_child_process_acknowledges_delivery() {
        use std::os::windows::process::CommandExt;
        let scope = uuid::Uuid::new_v4().to_string();
        let mut primary = acquire_or_forward(&scope, vec![]).unwrap().unwrap();
        let mut receiver = primary.take_receiver().unwrap();
        receive_with_timeout(&mut receiver);
        let payload = vec!["codex://threads/12345678-1234-1234-1234-123456789abc".to_owned()];
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "instance_transport::tests::instance_transport_child", "--nocapture"])
            .env("CODEX_INSTANCE_TEST_SCOPE", &scope)
            .env("CODEX_INSTANCE_TEST_PAYLOAD", serde_json::to_string(&payload).unwrap())
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .creation_flags(0x08000000)
            .spawn().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() { break status; }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill(); let _ = child.wait();
                panic!("instance transport child timed out");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        assert!(status.success());
        assert_eq!(receive_with_timeout(&mut receiver), payload);
    }
}
