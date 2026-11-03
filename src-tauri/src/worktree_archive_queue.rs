//! Durable automatic archive queue. This module never executes scripts or removes worktrees.
use crate::state::DesktopStateManager;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

pub const QUEUE_KEY: &str = "electron-managed-worktree-archives";

#[derive(Clone, Debug)]
pub struct AutomaticClaim {
    pub id: String,
    pub owner: String,
    pub host_id: String,
    pub owner_window: String,
    pub token: String,
    pub revision: u64,
    cancelled: Arc<AtomicBool>,
}
impl AutomaticClaim {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("工作树清理已取消。".into())
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FinishOutcome {
    Completed,
    Failed,
    Cancelled,
}
#[derive(Default)]
struct Retry {
    failures: u32,
    not_before_ms: u64,
}
#[derive(Default)]
struct Runtime {
    claims: HashMap<String, AutomaticClaim>,
    retries: HashMap<String, Retry>,
    closed_windows: HashSet<String>,
    disconnected_hosts: HashSet<String>,
}
#[derive(Default)]
pub struct ArchiveQueueState {
    runtime: Mutex<Runtime>,
}

fn entries(value: Value) -> Result<Vec<Value>, String> {
    let values = if value.is_null() {
        Vec::new()
    } else {
        value
            .as_array()
            .cloned()
            .ok_or("工作树归档队列不是列表，未覆盖原记录。")?
    };
    let mut ids = HashSet::new();
    for entry in &values {
        if let Some(id) = entry.get("id").and_then(Value::as_str) {
            if !ids.insert(id) {
                return Err("工作树归档队列含重复身份，未执行清理。".into());
            }
        }
        if entry.get("kind").and_then(Value::as_str) != Some("automatic") {
            continue;
        }
        for key in ["id", "owner", "hostId"] {
            if !entry
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
            {
                return Err(format!("自动清理队列的 {key} 无效，未执行清理。"));
            }
        }
        if entry.get("revision").and_then(Value::as_u64).is_none()
            || !matches!(
                entry.get("phase").and_then(Value::as_str),
                Some("detaching" | "queued" | "running" | "reattaching" | "failed" | "completed")
            )
        {
            return Err("自动清理队列的版本或阶段无效，未执行清理。".into());
        }
    }
    Ok(values)
}
fn is_automatic(entry: &Value) -> bool {
    entry.get("kind").and_then(Value::as_str) == Some("automatic")
}
fn field<'a>(entry: &'a Value, key: &str) -> &'a str {
    entry[key].as_str().expect("validated automatic entry")
}
fn identity(owner: &str, host: &str) -> Result<(), String> {
    if owner.is_empty() || host.is_empty() {
        Err("清理账号或主机身份为空。".into())
    } else {
        Ok(())
    }
}

impl ArchiveQueueState {
    pub fn read(&self, state: &DesktopStateManager) -> Result<Vec<Value>, String> {
        entries(state.get_value(QUEUE_KEY))
    }

    /// Run once when the manager starts, before accepting work; thread/attached entries stay intact.
    pub fn recover_startup(&self, state: &DesktopStateManager) -> Result<(), String> {
        let runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        state.update_value_persisted(QUEUE_KEY, |previous| {
            let mut values = entries(previous)?;
            for entry in &mut values {
                if is_automatic(entry)
                    && !runtime.claims.contains_key(field(entry, "id"))
                    && field(entry, "phase") == "running"
                {
                    entry["phase"] = json!("queued");
                }
            }
            Ok(json!(values))
        })?;
        Ok(())
    }

    pub fn enqueue(
        &self,
        state: &DesktopStateManager,
        owner: &str,
        host_id: &str,
    ) -> Result<String, String> {
        identity(owner, host_id)?;
        let runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        let mut id = String::new();
        state.update_value_persisted(QUEUE_KEY, |previous| {
            let mut values = entries(previous)?;
            if let Some(entry) = values.iter_mut().find(|entry| is_automatic(entry) && field(entry, "owner") == owner && field(entry, "hostId") == host_id && field(entry, "phase") != "completed") {
                id = field(entry, "id").into();
                if let Some(claim) = runtime.claims.get(&id) {
                    let revision = entry["revision"].as_u64().unwrap();
                    if revision == claim.revision { entry["revision"] = json!(revision.checked_add(1).ok_or("自动清理队列版本已溢出。")?); }
                }
            } else {
                id = uuid::Uuid::new_v4().to_string();
                values.push(json!({ "id": id, "kind": "automatic", "owner": owner, "hostId": host_id, "revision": 0, "phase": "queued" }));
            }
            Ok(json!(values))
        })?;
        Ok(id)
    }

    /// The caller must supply the current authenticated owner and a connected, supported host.
    /// Returning a claim proves the queue was durably persisted; it does not prove deletion ran.
    pub fn claim(
        &self,
        state: &DesktopStateManager,
        owner: &str,
        host_id: &str,
        owner_window: &str,
        now_ms: u64,
    ) -> Result<Option<AutomaticClaim>, String> {
        identity(owner, host_id)?;
        if owner_window.is_empty() {
            return Err("清理窗口身份为空。".into());
        }
        let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        if runtime.claims.len() >= 2
            || runtime.closed_windows.contains(owner_window)
            || runtime.disconnected_hosts.contains(host_id)
        {
            return Ok(None);
        }
        let mut selected = None;
        state.update_value_persisted(QUEUE_KEY, |previous| {
            let mut values = entries(previous)?;
            // Completed automatic entries can be removed without touching foreign queue kinds.
            values.retain(|entry| {
                !is_automatic(entry)
                    || field(entry, "phase") != "completed"
                    || field(entry, "owner") != owner
                    || field(entry, "hostId") != host_id
            });
            if let Some(entry) = values.iter_mut().find(|entry| {
                is_automatic(entry)
                    && field(entry, "owner") == owner
                    && field(entry, "hostId") == host_id
                    && matches!(field(entry, "phase"), "queued" | "running")
                    && !runtime.claims.contains_key(field(entry, "id"))
                    && runtime
                        .retries
                        .get(field(entry, "id"))
                        .is_none_or(|retry| retry.not_before_ms <= now_ms)
            }) {
                entry["phase"] = json!("queued"); // Official automatic execution does not persist runtime claims.
                selected = Some(AutomaticClaim {
                    id: field(entry, "id").into(),
                    owner: owner.into(),
                    host_id: host_id.into(),
                    owner_window: owner_window.into(),
                    token: uuid::Uuid::new_v4().to_string(),
                    revision: entry["revision"].as_u64().unwrap(),
                    cancelled: Arc::new(AtomicBool::new(false)),
                });
            }
            Ok(json!(values))
        })?;
        if let Some(claim) = &selected {
            runtime.claims.insert(claim.id.clone(), claim.clone());
        }
        Ok(selected)
    }

    /// Failed persistence retains the claim so no replacement can run before its result is saved.
    pub fn finish(
        &self,
        state: &DesktopStateManager,
        claim: &AutomaticClaim,
        outcome: FinishOutcome,
        now_ms: u64,
    ) -> Result<bool, String> {
        let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        let Some(current) = runtime.claims.get(&claim.id) else {
            return Ok(false);
        };
        if current.token != claim.token
            || current.owner != claim.owner
            || current.host_id != claim.host_id
            || current.owner_window != claim.owner_window
        {
            return Ok(false);
        }
        let cancelled = current.is_cancelled() || outcome == FinishOutcome::Cancelled;
        let mut requeued = false;
        state.update_value_persisted(QUEUE_KEY, |previous| {
            let mut values = entries(previous)?;
            let Some(index) = values
                .iter()
                .position(|entry| is_automatic(entry) && field(entry, "id") == claim.id)
            else {
                return Err("运行中的清理队列记录已丢失，未确认完成。".into());
            };
            if field(&values[index], "owner") != claim.owner
                || field(&values[index], "hostId") != claim.host_id
            {
                return Err("运行中的清理队列身份已变化。".into());
            }
            requeued = cancelled
                || outcome == FinishOutcome::Failed
                || values[index]["revision"].as_u64() != Some(claim.revision);
            if requeued {
                values[index]["phase"] = json!("queued");
            } else {
                values.remove(index);
            }
            Ok(json!(values))
        })?;
        runtime.claims.remove(&claim.id);
        if !cancelled && outcome == FinishOutcome::Failed {
            let retry = runtime.retries.entry(claim.id.clone()).or_default();
            retry.failures = retry.failures.saturating_add(1);
            let delay =
                (30_000u64 * (1u64 << retry.failures.saturating_sub(1).min(4))).min(300_000);
            retry.not_before_ms = now_ms.saturating_add(delay);
        } else if !requeued || (!cancelled && outcome == FinishOutcome::Completed) {
            runtime.retries.remove(&claim.id);
        }
        Ok(true)
    }

    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(runtime) = self.runtime.lock() {
            for claim in runtime.claims.values().filter(|claim| claim.owner == owner) {
                claim.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
    pub fn cancel_host(&self, host_id: &str) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.disconnected_hosts.insert(host_id.into());
            for claim in runtime
                .claims
                .values()
                .filter(|claim| claim.host_id == host_id)
            {
                claim.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
    pub fn reopen_host(&self, host_id: &str) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.disconnected_hosts.remove(host_id);
        }
    }
    pub fn close_window(&self, owner_window: &str) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.closed_windows.insert(owner_window.into());
            for claim in runtime
                .claims
                .values()
                .filter(|claim| claim.owner_window == owner_window)
            {
                claim.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
    pub fn reopen_window(&self, owner_window: &str) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.closed_windows.remove(owner_window);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn private_durable_queue_fixed_clock_and_claim_lifecycle() {
        const MARKER: &str = "CODEX_ARCHIVE_QUEUE_PRIVATE";
        if std::env::var_os(MARKER).is_none() {
            let root =
                std::env::temp_dir().join(format!("codex-archive-queue-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "worktree_archive_queue::tests::private_durable_queue_fixed_clock_and_claim_lifecycle", "--nocapture"]).env("CODEX_HOME", &root).env(MARKER, "1");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let output = command.output().unwrap();
            let _ = fs::remove_dir_all(&root);
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let state = DesktopStateManager::new();
        let queue = ArchiveQueueState::default();
        let foreign = json!([{"kind":"thread","id":"thread","opaque":{"keep":[1,2]},"phase":"running"},{"kind":"future","new":true}]);
        state
            .set_value_persisted(QUEUE_KEY, foreign.clone())
            .unwrap();
        let id = queue.enqueue(&state, "account", "local").unwrap();
        assert_eq!(queue.enqueue(&state, "account", "local").unwrap(), id);
        let claim = queue
            .claim(&state, "account", "local", "window", 100)
            .unwrap()
            .unwrap();
        queue.enqueue(&state, "account", "local").unwrap();
        queue.enqueue(&state, "account", "local").unwrap();
        assert_eq!(queue.read(&state).unwrap()[2]["revision"], 1);
        assert!(queue
            .finish(&state, &claim, FinishOutcome::Completed, 100)
            .unwrap());
        assert!(!queue
            .finish(&state, &claim, FinishOutcome::Completed, 100)
            .unwrap());
        let next = queue
            .claim(&state, "account", "local", "window", 100)
            .unwrap()
            .unwrap();
        assert_ne!(next.token, claim.token);
        assert_eq!(next.revision, 1);
        assert!(!queue
            .finish(&state, &claim, FinishOutcome::Completed, 100)
            .unwrap());
        queue
            .finish(&state, &next, FinishOutcome::Completed, 100)
            .unwrap();
        assert_eq!(state.get_value(QUEUE_KEY), foreign);
        assert_eq!(DesktopStateManager::new().get_value(QUEUE_KEY), foreign);

        queue.enqueue(&state, "account", "local").unwrap();
        queue.enqueue(&state, "other", "local").unwrap();
        queue.enqueue(&state, "account", "remote").unwrap();
        let a = queue
            .claim(&state, "account", "local", "window", 0)
            .unwrap()
            .unwrap();
        let b = queue
            .claim(&state, "account", "remote", "window2", 0)
            .unwrap()
            .unwrap();
        assert!(queue
            .claim(&state, "other", "local", "window", 0)
            .unwrap()
            .is_none());
        queue.cancel_owner("account");
        assert!(a.is_cancelled() && b.is_cancelled());
        queue
            .finish(&state, &a, FinishOutcome::Completed, 0)
            .unwrap();
        queue
            .finish(&state, &b, FinishOutcome::Cancelled, 0)
            .unwrap();
        let a = queue
            .claim(&state, "account", "local", "window", 0)
            .unwrap()
            .unwrap();
        queue.close_window("window");
        assert!(a.check().is_err());
        queue
            .finish(&state, &a, FinishOutcome::Completed, 0)
            .unwrap();
        assert!(queue
            .claim(&state, "account", "local", "window", 0)
            .unwrap()
            .is_none());
        queue.reopen_window("window");
        let a = queue
            .claim(&state, "account", "local", "window", 0)
            .unwrap()
            .unwrap();
        queue.cancel_host("local");
        assert!(a.is_cancelled());
        queue
            .finish(&state, &a, FinishOutcome::Cancelled, 0)
            .unwrap();
        assert!(queue
            .claim(&state, "account", "local", "window", 0)
            .unwrap()
            .is_none());
        queue.reopen_host("local");
        let mut now = 1_000;
        for delay in [30_000, 60_000, 120_000, 240_000, 300_000, 300_000] {
            let claim = queue
                .claim(&state, "account", "local", "window", now)
                .unwrap()
                .unwrap();
            queue
                .finish(&state, &claim, FinishOutcome::Failed, now)
                .unwrap();
            assert!(queue
                .claim(&state, "account", "local", "window", now + delay - 1)
                .unwrap()
                .is_none());
            now += delay;
        }
        // A successful revision resets prior failures even if a merged request needs another pass.
        let successful = queue.claim(&state, "account", "local", "window", now).unwrap().unwrap();
        queue.enqueue(&state, "account", "local").unwrap();
        queue.finish(&state, &successful, FinishOutcome::Completed, now).unwrap();
        let follow_up = queue.claim(&state, "account", "local", "window", now).unwrap().unwrap();
        queue.finish(&state, &follow_up, FinishOutcome::Failed, now).unwrap();
        assert!(queue.claim(&state, "account", "local", "window", now + 29_999).unwrap().is_none());
        now += 30_000;
        let retried = queue.claim(&state, "account", "local", "window", now).unwrap().unwrap();
        queue.finish(&state, &retried, FinishOutcome::Cancelled, now).unwrap();
        // Restart has no ephemeral retries/claims, but preserves all persisted records.
        let restarted = ArchiveQueueState::default();
        let disk = DesktopStateManager::new();
        disk.update_value_persisted(QUEUE_KEY, |value| {
            let mut values = entries(value)?;
            values.last_mut().unwrap()["phase"] = json!("running");
            Ok(json!(values))
        })
        .unwrap();
        restarted.recover_startup(&disk).unwrap();
        assert_eq!(
            restarted.read(&disk).unwrap().last().unwrap()["phase"],
            "queued"
        );
        assert_eq!(restarted.read(&disk).unwrap()[0], foreign[0]);
        let path = crate::state::desktop_global_state_path();
        let saved = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        let before = disk.get_value(QUEUE_KEY);
        assert!(restarted.enqueue(&disk, "no-write", "local").is_err());
        assert!(restarted
            .claim(&disk, "account", "local", "window", now)
            .is_err());
        assert_eq!(disk.get_value(QUEUE_KEY), before);
        assert!(restarted.runtime.lock().unwrap().claims.is_empty());
        fs::remove_dir(&path).unwrap();
        fs::write(&path, saved).unwrap();
        let claim = restarted
            .claim(&disk, "account", "local", "window", now)
            .unwrap()
            .unwrap();
        let saved = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(restarted
            .finish(&disk, &claim, FinishOutcome::Completed, now)
            .is_err());
        assert!(restarted
            .runtime
            .lock()
            .unwrap()
            .claims
            .contains_key(&claim.id));
        fs::remove_dir(&path).unwrap();
        fs::write(&path, saved).unwrap();
        restarted
            .finish(&disk, &claim, FinishOutcome::Completed, now)
            .unwrap();
        assert!(!restarted
            .runtime
            .lock()
            .unwrap()
            .claims
            .contains_key(&claim.id));
    }

    #[test]
    fn invalid_automatic_records_never_erase_foreign_data() {
        for value in [
            json!({}),
            json!([{"kind":"automatic","id":"a","owner":"x","hostId":"local","revision":-1,"phase":"queued"}]),
            json!([{"id":"same"},{"id":"same"}]),
        ] {
            assert!(entries(value).is_err());
        }
        let value = json!([{"kind":"future","payload":{"nested":true}},{"kind":"attached","id":"keep","extra":[1,2]}]);
        assert_eq!(
            entries(value.clone()).unwrap(),
            value.as_array().unwrap().clone()
        );
    }
}
