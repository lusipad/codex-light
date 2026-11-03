//! Honest remote-review preflight. No model turn is created until source coverage is established.
use crate::chatgpt_service::ShareAccessRequest;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tokio::sync::Notify;

struct Operation {
    owner: String,
    cancelled: AtomicBool,
    notify: Notify,
}
impl Operation {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
    async fn cancelled(&self) {
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return;
            }
            self.notify.notified().await;
        }
    }
}
#[derive(Default)]
struct ReviewOperations {
    operations: HashMap<String, Arc<Operation>>,
    pre_cancelled: VecDeque<(String, String)>,
    finished: VecDeque<(String, String)>,
}
#[derive(Default)]
pub struct RemoteReviewState {
    inner: Mutex<ReviewOperations>,
}
fn validate_review_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
        return Err("Invalid private review ID".into());
    }
    Ok(())
}
impl RemoteReviewState {
    fn register(&self, owner: &str, id: &str) -> Result<Arc<Operation>, String> {
        validate_review_id(id)?;
        let mut rows = self.inner.lock().map_err(|_| "审查状态不可用")?;
        if rows.operations.contains_key(id) {
            return Err("This review is already running".into());
        }
        if rows.finished.iter().any(|(_, known)| known == id) {
            return Err("This review has already finished; use a new review ID".into());
        }
        if rows
            .pre_cancelled
            .iter()
            .any(|(window, known)| window == owner && known == id)
        {
            return Err("Private review cancelled".into());
        }
        let operation = Arc::new(Operation {
            owner: owner.into(),
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        });
        rows.operations.insert(id.into(), operation.clone());
        Ok(operation)
    }
    fn cancel(&self, owner: &str, id: &str) -> Result<bool, String> {
        validate_review_id(id)?;
        let mut rows = self.inner.lock().map_err(|_| "审查状态不可用")?;
        if let Some(operation) = rows.operations.get(id) {
            if operation.owner != owner {
                return Err("审查属于其他窗口".into());
            }
            operation.cancel();
            return Ok(true);
        }
        if let Some((window, _)) = rows.finished.iter().find(|(_, known)| known == id) {
            if window != owner {
                return Err("审查属于其他窗口".into());
            }
            return Ok(false);
        }
        if !rows
            .pre_cancelled
            .iter()
            .any(|(window, known)| window == owner && known == id)
        {
            rows.pre_cancelled.push_back((owner.into(), id.into()));
        }
        while rows.pre_cancelled.len() > 128 {
            rows.pre_cancelled.pop_front();
        }
        Ok(false)
    }
    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(rows) = self.inner.lock() {
            for operation in rows
                .operations
                .values()
                .filter(|operation| operation.owner == owner)
            {
                operation.cancel();
            }
        }
    }
}
struct Registration<'a> {
    state: &'a RemoteReviewState,
    id: String,
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        if let Ok(mut rows) = self.state.inner.lock() {
            if let Some(operation) = rows.operations.remove(&self.id) {
                rows.finished
                    .push_back((operation.owner.clone(), self.id.clone()));
                while rows.finished.len() > 128 {
                    rows.finished.pop_front();
                }
            }
        }
    }
}
#[tauri::command]
pub fn code_review_private_cancel(
    window: WebviewWindow,
    state: State<'_, RemoteReviewState>,
    review_id: String,
) -> Result<bool, String> {
    state.cancel(window.label(), &review_id)
}
fn event(window: &WebviewWindow, id: &str, state: &str, mut data: Value) {
    data["reviewId"] = json!(id);
    data["state"] = json!(state);
    let _ = window.emit("remote-review-progress", data);
}
fn request_copy(request: &ShareAccessRequest) -> ShareAccessRequest {
    ShareAccessRequest {
        request_id: request.request_id.clone(),
        expected_identity: request.expected_identity.clone(),
        profile: request.profile.clone(),
    }
}
async fn read(
    app: &AppHandle,
    window: &WebviewWindow,
    state: &State<'_, crate::AppState>,
    request: &ShareAccessRequest,
    url: &str,
    snapshot: &str,
    commit: &Option<String>,
) -> Result<Value, String> {
    crate::review_provider::pinned_comparison_read(
        app.clone(),
        window.clone(),
        state.clone(),
        request_copy(request),
        url.into(),
        Some(snapshot.into()),
        commit.clone(),
        None,
    )
    .await
    .map(|value| value["body"].clone())
}
/// A callable catalog entry is not proof of its selected login, pagination or complete patch coverage.
/// No current host capability establishes the official fresh reviewer/coordinator prerequisite.
fn source_capability_limit(installed: &Value, mcp: &Value) -> String {
    let empty_apps = installed
        .get("apps")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty);
    let empty_mcp = mcp
        .get("data")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty);
    if mcp
        .get("nextCursor")
        .is_some_and(|cursor| !cursor.is_null())
    {
        return "私人审查尚不可用：本次工具目录仍有未读取的后续分页，尚未核定源码账号、完整比较及 独立审查者流程；未启动模型轮次。".into();
    }
    if empty_apps && empty_mcp {
        return "私人审查尚不可用：本次目录未见远程源码工具，尚未核定完整比较及 独立审查者流程；未启动模型轮次。".into();
    }
    "私人审查尚不可用：尚未核定源码工具对应的选定账号、完整变更文件、分页与补丁覆盖，也未接通官方独立审查者流程；未启动模型轮次。".into()
}
fn preflight_thread_params(model: &str, cwd: &str) -> Value {
    // Observe the effective runtime as configured; do not disable or force-enable plugins/features.
    json!({"model":model,"cwd":cwd,"ephemeral":true,"approvalPolicy":"never","sandbox":"read-only","experimentalRawEvents":false,"dynamicTools":null})
}
fn disabled_plugin_ids(started: &Value) -> Result<Value, String> {
    started
        .get("disabledPluginIds")
        .filter(|ids| {
            ids.as_array()
                .is_some_and(|ids| ids.iter().all(Value::is_string))
        })
        .cloned()
        .ok_or_else(|| "预检无法确认当前线程的 disabledPluginIds；未启动模型轮次。".into())
}
async fn choose_model(
    manager: &crate::app_server::AppServerManager,
    generation: u64,
    selected: Option<&str>,
) -> Result<String, String> {
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    loop {
        let response = manager
            .isolated_call(
                generation,
                "model/list",
                json!({"cursor":cursor,"includeHidden":false}),
            )
            .await?;
        rows.extend(
            response["data"]
                .as_array()
                .ok_or("Runtime model catalog unavailable")?
                .iter()
                .cloned(),
        );
        match response.get("nextCursor") {
            None | Some(Value::Null) => break,
            Some(Value::String(next)) if !next.is_empty() && seen.insert(next.clone()) => {
                cursor = json!(next)
            }
            _ => return Err("Invalid model catalog pagination".into()),
        }
    }
    let rows: Vec<_> = rows
        .iter()
        .filter(|row| row["hidden"] != true && row.get("modelSpecialty").is_none_or(Value::is_null))
        .collect();
    let chosen = if let Some(selected) = selected {
        rows.iter()
            .find(|row| row["model"] == selected || row["id"] == selected)
            .copied()
    } else {
        rows.iter().find(|row| row["isDefault"] == true).copied()
    };
    chosen
        .and_then(|row| row["model"].as_str())
        .filter(|model| !model.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            "No selected or default runtime model is available for the limited review".into()
        })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn code_review_private_preflight(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
    reviews: State<'_, RemoteReviewState>,
    request: ShareAccessRequest,
    url: String,
    snapshot_id: String,
    commit_sha: Option<String>,
    model_id: Option<String>,
    review_id: String,
) -> Result<Value, String> {
    let operation = reviews.register(window.label(), &review_id)?;
    let _registration = Registration {
        state: &reviews,
        id: review_id.clone(),
    };
    event(
        &window,
        &review_id,
        "starting",
        json!({"coverage":"unverified"}),
    );
    let mut created = None;
    let run = async {
        state.app_server.ensure_connected(&app).await?;
        let generation = state.app_server.connection_generation().await;
        let bound = read(
            &app,
            &window,
            &state,
            &request,
            &url,
            &snapshot_id,
            &commit_sha,
        )
        .await?;
        let model = choose_model(&state.app_server, generation, model_id.as_deref()).await?;
        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let (started, _incoming) = state
            .app_server
            .isolated_start(&app, generation, preflight_thread_params(&model, &cwd))
            .await?;
        let thread = started
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("Private thread has no ID")?
            .to_owned();
        created = Some((generation, thread.clone()));
        if started.pointer("/thread/ephemeral") != Some(&Value::Bool(true)) {
            return Err("Review thread is not ephemeral".into());
        }
        let disabled = disabled_plugin_ids(&started)?;
        // Preserve real thread-scoped metadata. Display-only app summaries never grant tool access.
        let installed = state
            .app_server
            .isolated_call(
                generation,
                "app/installed",
                json!({"threadId":thread,"forceRefresh":false}),
            )
            .await?;
        let mcp = state
            .app_server
            .isolated_call(
                generation,
                "mcpServerStatus/list",
                json!({"threadId":thread,"cursor":null,"limit":100,"detail":"toolsAndAuthOnly"}),
            )
            .await?;
        let runtime = json!({"modelId":model,"disabledPluginIds":disabled,"tools":[],"installedApps":installed,"mcp":mcp});
        event(
            &window,
            &review_id,
            "starting",
            json!({"threadId":thread,"runtime":runtime,"coverage":"unverified","preflight":"source-capability"}),
        );
        let current = read(
            &app,
            &window,
            &state,
            &request,
            &url,
            &snapshot_id,
            &commit_sha,
        )
        .await?;
        if [
            "snapshotId",
            "account",
            "pullRequest",
            "snapshot",
            "comparison",
        ]
        .iter()
        .any(|key| bound[*key] != current[*key])
        {
            return Err("审查预检期间源码账号或固定比较已改变。".into());
        }
        state.app_server.require_generation(generation).await?;
        let reason = source_capability_limit(&installed, &mcp);
        Ok(
            json!({"reviewId":review_id,"snapshotId":snapshot_id,"commitSha":commit_sha,"threadId":thread,"available":false,"account":bound["account"],"snapshot":bound["snapshot"],"comparison":bound["comparison"],"reason":reason,"runtime":runtime,"coverage":"unverified","missing":["尚未核验远程源码工具对应的账号与当前选定账号一致。","尚未核验完整变更文件清单及最后一页。","尚未核验补丁完整性及缺失补丁的精确版本文件补全。","尚未接通独立审查者与协调者的只读审查流程。"]}),
        )
    };
    let result: Result<Value, String> = tokio::select! {_=operation.cancelled()=>Err("Private review cancelled".into()),result=tokio::time::timeout(Duration::from_secs(90),run)=>result.unwrap_or_else(|_|Err("Private review timed out".into()))};
    if let Some((generation, thread)) = created {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            state
                .app_server
                .isolate_finish(generation, &thread, result.is_err()),
        )
        .await;
    }
    match &result {
        Ok(value) => event(&window, &review_id, "unavailable", value.clone()),
        Err(error) => event(
            &window,
            &review_id,
            if operation.cancelled.load(Ordering::SeqCst) {
                "cancelled"
            } else {
                "failed"
            },
            json!({"error":error,"coverage":"unverified"}),
        ),
    };
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_review_cancel_before_register_is_scoped_and_bounded() {
        let state = RemoteReviewState::default();
        assert!(!state.cancel("owner", "early").unwrap());
        assert!(state.register("owner", "early").is_err());
        assert!(state.inner.lock().unwrap().operations.is_empty());
        let other = state.register("other", "early").unwrap();
        assert!(!other.cancelled.load(Ordering::SeqCst));
        assert!(state.cancel("owner", "early").is_err());
        assert!(state.cancel("other", "early").unwrap());
        assert!(other.cancelled.load(Ordering::SeqCst));
        drop(Registration {
            state: &state,
            id: "early".into(),
        });
        assert!(!state.cancel("other", "early").unwrap());
        assert!(state.cancel("owner", "early").is_err());
        assert!(state.register("other", "early").is_err());
        for index in 0..256 {
            state.cancel("owner", &format!("pending-{index}")).unwrap();
        }
        let rows = state.inner.lock().unwrap();
        assert_eq!(rows.pre_cancelled.len(), 128);
        assert!(!rows.pre_cancelled.iter().any(|(_, id)| id == "pending-0"));
        assert!(!rows
            .pre_cancelled
            .iter()
            .any(|(owner, id)| owner == "other" && id == "early"));
    }
    #[test]
    fn private_review_finished_ids_reject_replay_and_keep_history_bounded() {
        let state = RemoteReviewState::default();
        for index in 0..256 {
            let id = format!("done-{index}");
            state.register("owner", &id).unwrap();
            drop(Registration { state: &state, id });
        }
        assert_eq!(state.inner.lock().unwrap().finished.len(), 128);
        assert!(state.register("other", "done-255").is_err());
        assert!(state.cancel("other", "done-255").is_err());
        assert!(!state.cancel("owner", "done-255").unwrap());
        assert!(state.inner.lock().unwrap().pre_cancelled.is_empty());
        for id in ["", "bad\nvalue"] {
            assert!(state.register("owner", id).is_err());
            assert!(state.cancel("owner", id).is_err());
        }
    }
    #[test]
    fn private_review_preflight_preserves_effective_runtime_configuration() {
        let params = preflight_thread_params("runtime-model", "C:/Temp");
        assert!(params.get("config").is_none());
        assert_eq!(params["ephemeral"], true);
        assert_eq!(params["approvalPolicy"], "never");
        assert_eq!(params["sandbox"], "read-only");
        assert!(params["dynamicTools"].is_null());
    }
    #[test]
    fn private_review_disabled_plugin_metadata_is_not_invented() {
        assert_eq!(
            disabled_plugin_ids(&json!({"disabledPluginIds":[]})).unwrap(),
            json!([])
        );
        assert_eq!(
            disabled_plugin_ids(&json!({"disabledPluginIds":["blocked"]})).unwrap(),
            json!(["blocked"])
        );
        for started in [
            json!({}),
            json!({"disabledPluginIds":null}),
            json!({"disabledPluginIds":[1]}),
        ] {
            assert!(disabled_plugin_ids(&started).is_err());
        }
    }
    #[test]
    fn private_review_empty_or_unverified_catalog_reports_missing_source_evidence() {
        assert!(
            source_capability_limit(&json!({"apps":[]}), &json!({"data":[]}))
                .contains("未启动模型轮次")
        );
        assert!(source_capability_limit(
            &json!({"apps":[{"enabled":true,"callable":true}]}),
            &json!({"data":[{}]})
        )
        .contains("完整变更文件"));
        assert!(source_capability_limit(&Value::Null, &Value::Null).contains("尚未核定"));
        assert!(source_capability_limit(
            &json!({"apps":[]}),
            &json!({"data":[],"nextCursor":"more"})
        )
        .contains("未读取的后续分页"));
        assert!(source_capability_limit(
            &json!({"apps":[]}),
            &json!({"data":[],"nextCursor":null})
        )
        .contains("本次目录未见"));
    }
}
