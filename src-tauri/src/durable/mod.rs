//! Identity-scoped app-server connections to the fixed durable cloud host.
#[cfg(windows)]
mod windows;
mod protocol;

use crate::chatgpt_service::ServiceIdentity;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Error { Unavailable, Busy, Cancelled, Closed, Timeout, Protocol, Remote(i64) }
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Notification {
    pub host_id: &'static str,
    pub identity: ServiceIdentity,
    pub method: String,
    pub params: Value,
}
pub(crate) type Notify = Arc<dyn Fn(Notification) + Send + Sync>;

pub(crate) struct ConnectionConfig {
    pub identity: ServiceIdentity,
    pub token: String,
    pub user_agent: String,
}

struct Command {
    id: String,
    cursor: Option<String>,
    cancel: Arc<AtomicBool>,
    expires: Instant,
    reply: oneshot::Sender<Result<Value>>,
}

struct Session {
    identity: ServiceIdentity,
    sender: mpsc::SyncSender<Command>,
    stop: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
}
impl Drop for Session { fn drop(&mut self) { self.stop.store(true, Ordering::SeqCst); } }

#[derive(Default)]
pub(crate) struct Manager { current: Arc<Mutex<Option<Session>>> }

impl Manager {
    pub(crate) fn invalidate(&self) {
        if let Ok(mut current) = self.current.lock() { current.take(); }
    }

    pub(crate) fn invalidate_identity(&self, identity: &ServiceIdentity) {
        if let Ok(mut current) = self.current.lock() {
            if current.as_ref().is_some_and(|session| &session.identity == identity) { current.take(); }
        }
    }

    fn session_notify(&self, stop: Arc<AtomicBool>, identity: ServiceIdentity, notify: Notify) -> Notify {
        let current = Arc::downgrade(&self.current);
        Arc::new(move |notification| {
            let Some(current) = current.upgrade() else { return; };
            let Ok(current) = current.lock() else { return; };
            if current.as_ref().is_some_and(|session| Arc::ptr_eq(&session.stop, &stop)
                && session.identity == identity && notification.identity == identity && !stop.load(Ordering::SeqCst)) {
                // Keep retirement and publication ordered. The sink must not reenter Manager.
                notify(notification);
            }
        })
    }

    #[cfg(test)]
    pub(crate) fn test_session(&self, identity: ServiceIdentity) -> Arc<AtomicBool> {
        let (sender, _) = mpsc::sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false));
        *self.current.lock().unwrap() = Some(Session { identity, sender, stop: stop.clone(), alive: Arc::new(AtomicBool::new(true)) });
        stop
    }

    pub(crate) async fn models(&self, config: ConnectionConfig, cursor: Option<String>, cancel: Arc<AtomicBool>, notify: Notify) -> Result<Value> {
        #[cfg(windows)]
        {
            self.request_with(config, cursor, cancel, notify, |config, stop| {
                windows::DurableSocket::connect(&config.token, &config.identity.account_id, &config.user_agent, stop)
                    .map(|socket| Box::new(socket) as Box<dyn Wire>)
                    .map_err(|_| Error::Unavailable)
            }).await
        }
        #[cfg(not(windows))]
        { let _ = (config, cursor, cancel, notify); Err(Error::Unavailable) }
    }

    async fn request_with<F>(&self, config: ConnectionConfig, cursor: Option<String>, cancel: Arc<AtomicBool>, notify: Notify, connect: F) -> Result<Value>
    where F: FnOnce(&ConnectionConfig, &AtomicBool) -> Result<Box<dyn Wire>> + Send + 'static {
        if cancel.load(Ordering::SeqCst) { return Err(Error::Cancelled); }
        let sender = {
            let mut current = self.current.lock().map_err(|_| Error::Unavailable)?;
            let reuse = current.as_ref().is_some_and(|session| session.identity == config.identity
                && session.alive.load(Ordering::SeqCst) && !session.stop.load(Ordering::SeqCst));
            if !reuse {
                current.take();
                let (sender, incoming) = mpsc::sync_channel(64);
                let stop = Arc::new(AtomicBool::new(false));
                let alive = Arc::new(AtomicBool::new(true));
                let session = Session { identity: config.identity.clone(), sender, stop: stop.clone(), alive: alive.clone() };
                let notify = self.session_notify(stop.clone(), config.identity.clone(), notify);
                std::thread::Builder::new().name("codex-durable".into()).spawn(move || {
                    struct Lifetime(Arc<AtomicBool>);
                    impl Drop for Lifetime { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }
                    let _lifetime = Lifetime(alive);
                    let result = connect(&config, &stop).and_then(|mut wire| run_actor(wire.as_mut(), &config.identity, &stop, &incoming, notify));
                    let error = result.err().unwrap_or(Error::Closed);
                    for command in incoming.try_iter() { let _ = command.reply.send(Err(error.clone())); }
                }).map_err(|_| Error::Unavailable)?;
                *current = Some(session);
            }
            current.as_ref().ok_or(Error::Unavailable)?.sender.clone()
        };
        let (reply, result) = oneshot::channel();
        let command = Command { id: format!("model/list:{}", uuid::Uuid::new_v4()), cursor, cancel: cancel.clone(), expires: Instant::now() + Duration::from_secs(75), reply };
        sender.try_send(command).map_err(|error| match error { mpsc::TrySendError::Full(_) => Error::Busy, mpsc::TrySendError::Disconnected(_) => Error::Closed })?;
        let cancelled = async {
            while !cancel.load(Ordering::SeqCst) { tokio::time::sleep(Duration::from_millis(20)).await; }
        };
        let result = tokio::select! {
            _ = cancelled => return Err(Error::Cancelled),
            result = result => result.map_err(|_| Error::Closed)?,
        };
        if cancel.load(Ordering::SeqCst) { return Err(Error::Cancelled); }
        result
    }
}
impl Drop for Manager { fn drop(&mut self) { self.invalidate(); } }

enum Incoming { Pending, Message(String), Closed }
trait Wire {
    fn send(&mut self, message: &str, stop: &AtomicBool, deadline: Instant) -> Result<()>;
    fn receive(&mut self, stop: &AtomicBool, deadline: Instant) -> Result<Incoming>;
}

#[cfg(windows)]
impl Wire for windows::DurableSocket {
    fn send(&mut self, message: &str, stop: &AtomicBool, deadline: Instant) -> Result<()> {
        windows::DurableSocket::send(self, message, stop, deadline).map_err(|_| Error::Closed)
    }
    fn receive(&mut self, stop: &AtomicBool, deadline: Instant) -> Result<Incoming> {
        self.poll_receive(stop, deadline).map(|message| match message {
            windows::Poll::Pending => Incoming::Pending,
            windows::Poll::Message(text) => Incoming::Message(text),
            windows::Poll::Closed { .. } => Incoming::Closed,
        }).map_err(|_| if stop.load(Ordering::SeqCst) { Error::Cancelled } else { Error::Closed })
    }
}

fn send(wire: &mut dyn Wire, message: Value, stop: &AtomicBool) -> Result<()> {
    if stop.load(Ordering::SeqCst) { return Err(Error::Cancelled); }
    wire.send(&message.to_string(), stop, Instant::now() + Duration::from_secs(15))
}

fn run_actor(wire: &mut dyn Wire, identity: &ServiceIdentity, stop: &AtomicBool, incoming: &mpsc::Receiver<Command>, notify: Notify) -> Result<()> {
    let mut pending: HashMap<String, Command> = HashMap::new();
    let outcome = (|| {
        send(wire, protocol::initialize(), stop)?;
        let initialize_deadline = Instant::now() + Duration::from_secs(30);
        let mut ready = false;
        loop {
            if stop.load(Ordering::SeqCst) { return Err(Error::Cancelled); }
            if !ready && Instant::now() >= initialize_deadline { return Err(Error::Timeout); }
            if ready {
                let expired: Vec<_> = pending.iter().filter(|(_, request)| request.cancel.load(Ordering::SeqCst) || Instant::now() >= request.expires)
                    .map(|(id, _)| id.clone()).collect();
                for id in expired {
                    if let Some(command) = pending.remove(&id) {
                        let error = if command.cancel.load(Ordering::SeqCst) { Error::Cancelled } else { Error::Timeout };
                        let _ = command.reply.send(Err(error));
                    }
                }
                if pending.len() < 64 {
                    match incoming.try_recv() {
                        Ok(command) => {
                            if command.cancel.load(Ordering::SeqCst) || Instant::now() >= command.expires {
                                let error = if command.cancel.load(Ordering::SeqCst) { Error::Cancelled } else { Error::Timeout };
                                let _ = command.reply.send(Err(error));
                            } else {
                                let message = json!({"id":command.id,"method":"model/list","params":{"cursor":command.cursor,"includeHidden":true,"limit":100}});
                                let id = command.id.clone();
                                pending.insert(id, command);
                                send(wire, message, stop)?;
                            }
                        }
                        Err(mpsc::TryRecvError::Empty) => (),
                        Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
                    }
                }
            }
            let text = match wire.receive(stop, Instant::now() + Duration::from_millis(20))? {
                Incoming::Pending => continue,
                Incoming::Closed => return Err(Error::Closed),
                Incoming::Message(text) => text,
            };
            if stop.load(Ordering::SeqCst) { return Err(Error::Cancelled); }
            let message: Value = serde_json::from_str(&text).map_err(|_| Error::Protocol)?;
            match protocol::classify(&message)? {
                protocol::Packet::ServerRequest => send(wire, protocol::server_response(&message)?, stop)?,
                protocol::Packet::Notification if ready => {
                    if !stop.load(Ordering::SeqCst) {
                        notify(Notification { host_id: "durable", identity: identity.clone(), method: message["method"].as_str().unwrap().into(), params: message.get("params").cloned().unwrap_or(Value::Null) });
                    }
                }
                protocol::Packet::Notification => (),
                protocol::Packet::Response => {
                    let id = protocol::response_id(&message)?;
                    let result = protocol::result(&message);
                    if !ready && id == "__codex_initialize__" {
                        if !result?.is_object() { return Err(Error::Protocol); }
                        ready = true;
                    } else if ready {
                        if let Some(command) = pending.remove(&id) {
                            let response = if command.cancel.load(Ordering::SeqCst) { Err(Error::Cancelled) } else { result };
                            let _ = command.reply.send(response);
                        }
                    }
                }
            }
        }
    })();
    let error = outcome.as_ref().err().cloned().unwrap_or(Error::Closed);
    for (_, command) in pending { let _ = command.reply.send(Err(error.clone())); }
    outcome
}

#[cfg(test)]
mod tests;
