use super::*;
use std::collections::VecDeque;
use std::sync::atomic::AtomicUsize;

#[derive(Default)]
struct Peer {
    sent: Vec<Value>,
    inbound: VecDeque<Incoming>,
    manual_models: bool,
    initialize_error: bool,
}
struct FakeWire(Arc<Mutex<Peer>>);
impl Wire for FakeWire {
    fn send(&mut self, message: &str, _: &AtomicBool, _: Instant) -> Result<()> {
        let message: Value = serde_json::from_str(message).unwrap();
        let mut peer = self.0.lock().unwrap();
        peer.sent.push(message.clone());
        match message["method"].as_str() {
            Some("initialize") => {
                peer.inbound.push_back(Incoming::Message(json!({"method":"early-notification","params":{}}).to_string()));
                let reply = if peer.initialize_error { json!({"id":message["id"],"error":{"code":-32001}}) }
                    else { json!({"id":message["id"],"result":{"userAgent":"fixture-server"}}) };
                peer.inbound.push_back(Incoming::Message(reply.to_string()));
            }
            Some("model/list") if !peer.manual_models => {
                peer.inbound.push_back(Incoming::Message(json!({"id":message["id"],"result":{"data":[{"id":"model-fixture"}],"nextCursor":null}}).to_string()));
            }
            _ => (),
        }
        Ok(())
    }
    fn receive(&mut self, stop: &AtomicBool, deadline: Instant) -> Result<Incoming> {
        loop {
            if stop.load(Ordering::SeqCst) { return Err(Error::Cancelled); }
            if let Some(message) = self.0.lock().unwrap().inbound.pop_front() { return Ok(message); }
            if Instant::now() >= deadline { return Ok(Incoming::Pending); }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

fn identity(generation: u64) -> ServiceIdentity {
    ServiceIdentity { account_id: "account-fixture".into(), user_id: "user-fixture".into(), generation }
}
fn config(generation: u64) -> ConnectionConfig {
    ConnectionConfig { identity: identity(generation), token: "fixture-token-native-only".into(), user_agent: "fixture-agent".into() }
}
fn connect(peer: Arc<Mutex<Peer>>, count: Arc<AtomicUsize>) -> impl FnOnce(&ConnectionConfig, &AtomicBool) -> Result<Box<dyn Wire>> + Send {
    move |config, _| {
        assert_eq!(config.token, "fixture-token-native-only");
        count.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeWire(peer)))
    }
}
fn notify() -> Notify { Arc::new(|_| {}) }
fn cancel() -> Arc<AtomicBool> { Arc::new(AtomicBool::new(false)) }
async fn until(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while !condition() { tokio::time::sleep(Duration::from_millis(1)).await; }
    }).await.unwrap();
}
fn model_requests(peer: &Arc<Mutex<Peer>>) -> Vec<Value> {
    peer.lock().unwrap().sent.iter().filter(|message| message["method"] == "model/list").cloned().collect()
}
fn reply(peer: &Arc<Mutex<Peer>>, message: Value) {
    peer.lock().unwrap().inbound.push_back(Incoming::Message(message.to_string()));
}

#[tokio::test]
async fn durable_concurrent_reads_initialize_once_and_keep_credential_out_of_messages() {
    let manager = Manager::default();
    let peer = Arc::new(Mutex::new(Peer::default()));
    let calls = Arc::new(AtomicUsize::new(0));
    let (first, second) = tokio::join!(
        manager.request_with(config(1), None, cancel(), notify(), connect(peer.clone(), calls.clone())),
        manager.request_with(config(1), Some("cursor-fixture".into()), cancel(), notify(), connect(peer.clone(), calls.clone()))
    );
    assert_eq!(first.unwrap()["data"][0]["id"], "model-fixture");
    assert!(second.is_ok());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let peer = peer.lock().unwrap();
    assert_eq!(peer.sent.iter().filter(|message| message["method"] == "initialize").count(), 1);
    assert_eq!(peer.sent.iter().filter(|message| message["method"] == "initialized").count(), 0);
    assert!(!serde_json::to_string(&peer.sent).unwrap().contains("fixture-token-native-only"));
    assert_eq!(peer.sent.last().unwrap()["params"]["limit"], 100);
    assert_eq!(peer.sent.last().unwrap()["params"]["includeHidden"], true);
}

#[tokio::test]
async fn durable_out_of_order_and_unmatched_responses_stay_with_their_request() {
    let manager = Arc::new(Manager::default());
    let peer = Arc::new(Mutex::new(Peer { manual_models: true, ..Peer::default() }));
    let calls = Arc::new(AtomicUsize::new(0));
    let spawn = |cursor: &'static str| {
        let manager = manager.clone(); let peer = peer.clone(); let calls = calls.clone();
        tokio::spawn(async move { manager.request_with(config(1), Some(cursor.into()), cancel(), notify(), connect(peer, calls)).await })
    };
    let one = spawn("first"); let two = spawn("second");
    until(|| model_requests(&peer).len() == 2).await;
    let requests = model_requests(&peer);
    reply(&peer, json!({"id":"model/list:stale","result":{"marker":"stale"}}));
    for request in requests.iter().rev() {
        reply(&peer, json!({"id":request["id"],"result":{"marker":request["params"]["cursor"]}}));
    }
    assert_eq!(one.await.unwrap().unwrap()["marker"], "first");
    assert_eq!(two.await.unwrap().unwrap()["marker"], "second");
    assert_eq!(model_requests(&peer).len(), 2);
}

#[tokio::test]
async fn durable_cancelled_read_does_not_replay_or_consume_another_reply() {
    let manager = Arc::new(Manager::default());
    let peer = Arc::new(Mutex::new(Peer { manual_models: true, ..Peer::default() }));
    let calls = Arc::new(AtomicUsize::new(0));
    let cancellation = cancel();
    let task = {
        let manager = manager.clone(); let peer = peer.clone(); let calls = calls.clone(); let cancellation = cancellation.clone();
        tokio::spawn(async move { manager.request_with(config(1), None, cancellation, notify(), connect(peer, calls)).await })
    };
    until(|| model_requests(&peer).len() == 1).await;
    let old = model_requests(&peer)[0].clone();
    cancellation.store(true, Ordering::SeqCst);
    assert_eq!(task.await.unwrap(), Err(Error::Cancelled));
    let next = {
        let manager = manager.clone(); let peer = peer.clone(); let calls = calls.clone();
        tokio::spawn(async move { manager.request_with(config(1), None, cancel(), notify(), connect(peer, calls)).await })
    };
    until(|| model_requests(&peer).len() == 2).await;
    reply(&peer, json!({"id":old["id"],"result":{"marker":"cancelled"}}));
    reply(&peer, json!({"id":model_requests(&peer)[1]["id"],"result":{"marker":"current"}}));
    assert_eq!(next.await.unwrap().unwrap()["marker"], "current");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn durable_identity_invalidation_retires_pending_requests_and_old_notifications() {
    let manager = Arc::new(Manager::default());
    let peer = Arc::new(Mutex::new(Peer { manual_models: true, ..Peer::default() }));
    let calls = Arc::new(AtomicUsize::new(0));
    let events = Arc::new(Mutex::new(Vec::new()));
    let listener: Notify = { let events = events.clone(); Arc::new(move |event| events.lock().unwrap().push(event)) };
    let task = {
        let manager = manager.clone(); let peer = peer.clone(); let calls = calls.clone();
        tokio::spawn(async move { manager.request_with(config(1), None, cancel(), listener, connect(peer, calls)).await })
    };
    until(|| model_requests(&peer).len() == 1).await;
    reply(&peer, json!({"method":"item/agentMessage/delta","params":{"delta":"current"}}));
    until(|| events.lock().unwrap().len() == 1).await;
    assert_eq!(events.lock().unwrap()[0].host_id, "durable");
    assert_eq!(events.lock().unwrap()[0].identity, identity(1));
    manager.invalidate();
    reply(&peer, json!({"method":"item/agentMessage/delta","params":{"delta":"retired"}}));
    assert!(matches!(task.await.unwrap(), Err(Error::Cancelled | Error::Closed)));
    assert_eq!(events.lock().unwrap().len(), 1);
    let next_peer = Arc::new(Mutex::new(Peer::default()));
    assert!(manager.request_with(config(2), None, cancel(), notify(), connect(next_peer, calls.clone())).await.is_ok());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn durable_initialize_error_finishes_queued_reads_without_dispatching_them() {
    let manager = Manager::default();
    let peer = Arc::new(Mutex::new(Peer { initialize_error: true, ..Peer::default() }));
    let calls = Arc::new(AtomicUsize::new(0));
    let error = manager.request_with(config(1), None, cancel(), notify(), connect(peer.clone(), calls)).await.unwrap_err();
    assert!(matches!(error, Error::Remote(-32001) | Error::Closed));
    assert!(model_requests(&peer).is_empty());
}

#[test]
fn durable_notification_sink_rejects_late_callbacks_from_replaced_sessions() {
    for same_identity in [false, true] {
        let manager = Manager::default();
        let old_identity = identity(1);
        let old_stop = manager.test_session(old_identity.clone());
        let count = Arc::new(AtomicUsize::new(0));
        let sink: Notify = { let count = count.clone(); Arc::new(move |_| { count.fetch_add(1, Ordering::SeqCst); }) };
        let old = manager.session_notify(old_stop.clone(), old_identity.clone(), sink.clone());
        let event = |identity| Notification { host_id: "durable", identity, method: "fixture".into(), params: Value::Null };
        old(event(old_identity.clone()));
        assert_eq!(count.load(Ordering::SeqCst), 1);

        // Even an actor that passed its stop check before replacement cannot publish late.
        assert!(!old_stop.load(Ordering::SeqCst));
        let mut next_identity = old_identity.clone();
        if !same_identity { next_identity.account_id = "other-account".into(); }
        let next_stop = manager.test_session(next_identity.clone());
        old(event(old_identity));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let next = manager.session_notify(next_stop, next_identity.clone(), sink);
        assert_eq!(Arc::strong_count(&manager.current), 1, "Notification callbacks must not own the current slot");
        next(event(next_identity.clone()));
        assert_eq!(count.load(Ordering::SeqCst), 2);
        manager.invalidate();
        next(event(next_identity.clone()));
        assert_eq!(count.load(Ordering::SeqCst), 2);
        drop(manager);
        next(event(next_identity));
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }
}
