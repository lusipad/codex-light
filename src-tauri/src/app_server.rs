use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerStatus {
    pub connected: bool,
    pub connecting: bool,
    pub binary_path: String,
    pub app_server_version: Option<String>,
    pub user_agent: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingServerRequest {
    pub id: Value,
    pub method: String,
    pub params: Value,
    pub generation: u64,
    pub response_delivery_unknown: bool,
}

struct InnerState {
    generation: u64,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending_requests: HashMap<u64, oneshot::Sender<Result<Value, String>>>,
    pending_server_requests: HashMap<String, PendingServerRequest>,
    status: AppServerStatus,
    custom_cli_path: Option<String>,
}

impl InnerState {
    fn resolve_server_request(&mut self, generation: u64, params: &Value) {
        if self.generation != generation {
            return;
        }
        let Some(id) = params.get("requestId") else { return };
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else { return };
        let key = server_request_key(id);
        if self.pending_server_requests.get(&key).is_some_and(|request| {
            request.generation == generation
                && request.params.get("threadId").and_then(Value::as_str)
                    .or_else(|| request.params.get("conversationId").and_then(Value::as_str)) == Some(thread_id)
        }) {
            self.pending_server_requests.remove(&key);
        }
    }

    fn close_generation(&mut self, generation: u64) -> bool {
        if self.generation != generation {
            return false;
        }
        self.status.connected = false;
        self.status.connecting = false;
        self.stdin = None;
        self.pending_server_requests.clear();
        for (_, tx) in self.pending_requests.drain() {
            let _ = tx.send(Err("app-server connection closed".to_string()));
        }
        true
    }
}

#[derive(Clone)]
pub struct AppServerManager {
    inner: Arc<Mutex<InnerState>>,
    next_id: Arc<AtomicU64>,
    lifecycle: Arc<Mutex<()>>,
}

impl AppServerManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(InnerState {
                generation: 0,
                child: None,
                stdin: None,
                pending_requests: HashMap::new(),
                pending_server_requests: HashMap::new(),
                status: AppServerStatus {
                    connected: false,
                    connecting: false,
                    binary_path: String::from("codex"),
                    app_server_version: None,
                    user_agent: None,
                    last_error: None,
                },
                custom_cli_path: None,
            })),
            next_id: Arc::new(AtomicU64::new(1)),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }

    pub async fn get_status(&self) -> AppServerStatus {
        let guard = self.inner.lock().await;
        guard.status.clone()
    }

    pub async fn list_pending_server_requests(&self) -> Vec<PendingServerRequest> {
        let guard = self.inner.lock().await;
        guard.pending_server_requests.values().cloned().collect()
    }

    pub async fn set_custom_cli_path(&self, path: Option<String>) {
        let mut guard = self.inner.lock().await;
        guard.custom_cli_path = path.filter(|s| !s.trim().is_empty());
    }

    fn resolve_codex_binary(custom_path: Option<&str>) -> String {
        if let Some(custom) = custom_path {
            let trimmed = custom.trim();
            if !trimmed.is_empty() && PathBuf::from(trimmed).exists() {
                return trimmed.to_string();
            }
        }
        if let Ok(env_bin) = std::env::var("CODEX_CLI_PATH") {
            if !env_bin.trim().is_empty() && PathBuf::from(env_bin.trim()).exists() {
                return env_bin.trim().to_string();
            }
        }
        // Check common offline package relative locations first
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidates = [
                    exe_dir.join("codex.exe"),
                    exe_dir.join("resources").join("codex.exe"),
                    exe_dir.join("_internal").join("app").join("resources").join("codex.exe"),
                ];
                for candidate in candidates {
                    if candidate.exists() {
                        return candidate.to_string_lossy().to_string();
                    }
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            // Check npm global location on Windows (%APPDATA%\npm\codex.cmd)
            if let Some(appdata) = std::env::var_os("APPDATA") {
                let npm_cmd = PathBuf::from(appdata).join("npm").join("codex.cmd");
                if npm_cmd.exists() {
                    return npm_cmd.to_string_lossy().to_string();
                }
            }
            "codex.cmd".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "codex".to_string()
        }
    }

    pub async fn ensure_connected(&self, app: &AppHandle) -> Result<AppServerStatus, String> {
        let _lifecycle = self.lifecycle.lock().await;
        {
            let guard = self.inner.lock().await;
            if guard.status.connected && guard.stdin.is_some() {
                return Ok(guard.status.clone());
            }
        }
        self.restart_locked(app).await
    }

    pub async fn restart(&self, app: &AppHandle) -> Result<AppServerStatus, String> {
        let _lifecycle = self.lifecycle.lock().await;
        self.restart_locked(app).await
    }

    async fn restart_locked(&self, app: &AppHandle) -> Result<AppServerStatus, String> {
        crate::invalidate_chatgpt_service(app);
        let (binary_path, generation) = {
            let mut guard = self.inner.lock().await;
            guard.generation += 1;
            if let Some(mut old_child) = guard.child.take() {
                let _ = old_child.start_kill();
            }
            guard.stdin = None;
            for (_, tx) in guard.pending_requests.drain() {
                let _ = tx.send(Err("app-server restarting".to_string()));
            }
            guard.pending_server_requests.clear();
            guard.status.connected = false;
            guard.status.connecting = true;
            guard.status.last_error = None;
            let resolved = Self::resolve_codex_binary(guard.custom_cli_path.as_deref());
            guard.status.binary_path = resolved.clone();
            let _ = app.emit("app-server:status", guard.status.clone());
            (resolved, guard.generation)
        };

        let mut cmd = if cfg!(target_os = "windows")
            && (binary_path.to_lowercase().ends_with(".cmd")
                || binary_path.to_lowercase().ends_with(".bat")
                || binary_path == "codex")
        {
            let mut c = Command::new("cmd.exe");
            c.args(["/C", &binary_path, "app-server", "--listen", "stdio://"]);
            c
        } else {
            let mut c = Command::new(&binary_path);
            c.args(["app-server", "--listen", "stdio://"]);
            c
        };

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(err) => {
                let msg = format!("Failed to spawn `{}`: {}", binary_path, err);
                let mut guard = self.inner.lock().await;
                guard.status.connecting = false;
                guard.status.connected = false;
                guard.status.last_error = Some(msg.clone());
                let status = guard.status.clone();
                let _ = app.emit("app-server:status", status);
                return Err(msg);
            }
        };

        let stdin = child.stdin.take().ok_or("Failed to open app-server stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open app-server stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open app-server stderr")?;

        {
            let mut guard = self.inner.lock().await;
            guard.child = Some(child);
            guard.stdin = Some(stdin);
        }

        // Spawn stdout reader task
        let inner_stdout = self.inner.clone();
        let app_stdout = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(msg) = serde_json::from_str::<Value>(trimmed) {
                    handle_incoming_message(&inner_stdout, &app_stdout, generation, msg).await;
                }
            }
            // EOF reached -> process exited
            let mut guard = inner_stdout.lock().await;
            if guard.close_generation(generation) {
                crate::invalidate_chatgpt_service(&app_stdout);
                let _ = app_stdout.emit("app-server:status", guard.status.clone());
            }
        });

        // Spawn stderr reader task
        let app_stderr = app.clone();
        let inner_stderr = self.inner.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                let guard = inner_stderr.lock().await;
                if guard.generation != generation {
                    break;
                }
                if !trimmed.is_empty() {
                    let _ = app_stderr.emit("app-server:stderr", trimmed.to_string());
                }
            }
        });

        // Perform JSON-RPC initialize handshake
        let init_params = json!({
            "clientInfo": {
                "name": "codex-tauri-native",
                "title": "Codex Native (Tauri)",
                "version": "0.1.0"
            },
            "capabilities": {
                "experimentalApi": true,
                "requestAttestation": false
            }
        });

        let initialized = async {
            let result = self
                .send_raw_request("initialize", init_params, Duration::from_secs(15))
                .await?;
            self.send_raw_notification("initialized", None).await?;
            Ok::<Value, String>(result)
        }
        .await;
        match initialized {
            Ok(init_result) => {
                let user_agent = init_result
                    .get("userAgent")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let version = user_agent
                    .as_deref()
                    .and_then(|ua| ua.split('/').nth(1))
                    .and_then(|v| v.split_whitespace().next())
                    .map(|s| s.to_string());

                let mut guard = self.inner.lock().await;
                if guard.generation != generation || guard.stdin.is_none() {
                    return Err("app-server connection closed during initialization".to_string());
                }
                guard.status.connected = true;
                guard.status.connecting = false;
                guard.status.user_agent = user_agent;
                guard.status.app_server_version = version;
                guard.status.last_error = None;
                let status = guard.status.clone();
                let _ = app.emit("app-server:status", status.clone());
                Ok(status)
            }
            Err(err) => {
                let mut guard = self.inner.lock().await;
                guard.status.connected = false;
                guard.status.connecting = false;
                guard.status.last_error = Some(format!("Initialize handshake failed: {}", err));
                let status = guard.status.clone();
                let _ = app.emit("app-server:status", status);
                Err(err)
            }
        }
    }

    async fn write_json_line(&self, payload: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(payload).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut guard = self.inner.lock().await;
        let stdin = guard
            .stdin
            .as_mut()
            .ok_or_else(|| "codex app-server is not connected".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to app-server stdin: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush app-server stdin: {}", e))?;
        Ok(())
    }

    async fn send_raw_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let payload = match params {
            Some(p) => json!({ "method": method, "params": p }),
            None => json!({ "method": method }),
        };
        self.write_json_line(&payload).await
    }

    async fn send_raw_request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut guard = self.inner.lock().await;
            guard.pending_requests.insert(id, tx);
        }

        let payload = json!({
            "id": id,
            "method": method,
            "params": params,
        });

        if let Err(err) = self.write_json_line(&payload).await {
            let mut guard = self.inner.lock().await;
            guard.pending_requests.remove(&id);
            return Err(err);
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err(format!("Request `{}` cancelled", method)),
            Err(_) => {
                let mut guard = self.inner.lock().await;
                guard.pending_requests.remove(&id);
                Err(format!(
                    "app-server request timed out after {}s: {}",
                    timeout.as_secs(),
                    method
                ))
            }
        }
    }

    // Destruction cleanup must never restart a disconnected app-server.
    pub async fn release_file_watch(&self, watch_id: &str) -> Result<(), String> {
        self.send_raw_request(
            "fs/unwatch",
            json!({ "watchId": watch_id }),
            Duration::from_secs(10),
        )
        .await
        .map(|_| ())
    }

    pub async fn call(
        &self,
        app: &AppHandle,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        self.ensure_connected(app).await?;
        let actual_method = if method == "mcpServer/list" {
            "mcpServerStatus/list"
        } else {
            method
        };
        let normalized_params = normalize_request_params(actual_method, params);
        let raw_result = self
            .send_raw_request(actual_method, normalized_params, Duration::from_secs(60))
            .await?;
        Ok(post_process_result(actual_method, raw_result))
    }

    pub async fn respond_to_server_request(
        &self,
        app: &AppHandle,
        id: Value,
        generation: u64,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if guard.generation != generation {
            return Err("Approval belongs to a previous app-server connection".to_string());
        }
        let InnerState { stdin, pending_server_requests, .. } = &mut *guard;
        write_server_response(pending_server_requests, stdin.as_mut(), &id, generation, result, error).await?;
        let _ = app.emit("app-server:server-request-resolved", json!({ "id": id, "generation": generation }));
        Ok(())
    }
}

fn server_request_key(id: &Value) -> String {
    id.to_string()
}

async fn write_server_response<W: tokio::io::AsyncWrite + Unpin>(
    pending: &mut HashMap<String, PendingServerRequest>,
    writer: Option<&mut W>,
    id: &Value,
    generation: u64,
    result: Option<Value>,
    error: Option<Value>,
) -> Result<(), String> {
    let key = server_request_key(id);
    let request = pending.get_mut(&key).ok_or("Approval is no longer pending")?;
    if request.generation != generation {
        return Err("Approval belongs to a previous app-server connection".to_string());
    }
    if request.response_delivery_unknown {
        return Err("Approval response delivery is unknown; wait for resolution or reconnect before retrying".to_string());
    }
    let writer = writer.ok_or("codex app-server is not connected")?;
    let response = if let Some(error) = error {
        json!({ "id": request.id, "error": error })
    } else {
        json!({ "id": request.id, "result": result.unwrap_or_else(|| json!({})) })
    };
    let mut line = serde_json::to_vec(&response).map_err(|e| e.to_string())?;
    line.push(b'\n');
    // A failed or cancelled write may already have delivered bytes. Do not resend it.
    request.response_delivery_unknown = true;
    writer.write_all(&line).await.map_err(|e| format!("Approval response delivery is unknown: {}", e))?;
    writer.flush().await.map_err(|e| format!("Approval response delivery is unknown: {}", e))?;
    pending.remove(&key);
    Ok(())
}

async fn handle_incoming_message(
    inner: &Arc<Mutex<InnerState>>,
    app: &AppHandle,
    generation: u64,
    msg: Value,
) {
    // Keep the generation check, mutations and event emission atomic with restart.
    let mut guard = inner.lock().await;
    if guard.generation != generation {
        return;
    }
    let has_id = msg.get("id").is_some();
    let has_method = msg.get("method").and_then(|m| m.as_str()).is_some();
    let has_result = msg.get("result").is_some();
    let has_error = msg.get("error").is_some();

    // 1. Response to a client-initiated request
    if has_id && (has_result || has_error) {
        if let Some(id_u64) = msg.get("id").and_then(|v| v.as_u64()) {
            let tx_opt = guard.pending_requests.remove(&id_u64);
            if let Some(tx) = tx_opt {
                if let Some(err) = msg.get("error") {
                    let err_msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| err.to_string());
                    let _ = tx.send(Err(err_msg));
                } else {
                    let result = msg.get("result").cloned().unwrap_or(Value::Null);
                    let _ = tx.send(Ok(result));
                }
                return;
            }
        }
    }

    // 2. Server-initiated request (e.g. command/patch/tool approval or user input)
    if has_id && has_method && !has_result && !has_error {
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let method = msg
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let req = PendingServerRequest {
            id: id.clone(),
            method,
            params,
            generation,
            response_delivery_unknown: false,
        };
        let req = guard
            .pending_server_requests
            .entry(server_request_key(&id)).or_insert(req).clone();
        let _ = app.emit("app-server:server-request", req);
        return;
    }

    // 3. Server notification (streaming deltas, turn/started, turn/completed, etc.)
    if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
        if method == "account/updated" {
            crate::invalidate_chatgpt_service(app);
        }
        let params = msg
            .get("params")
            .or_else(|| msg.get("result"))
            .cloned()
            .unwrap_or(Value::Null);
        if method == "serverRequest/resolved" {
            guard.resolve_server_request(generation, &params);
        }
        let _ = app.emit(
            "app-server:notification",
            json!({
                "method": method,
                "params": params,
            }),
        );
    }
}

fn normalize_request_params(method: &str, params: Option<Value>) -> Value {
    let mut p = params.unwrap_or_else(|| json!({}));
    if p.is_null() {
        p = json!({});
    }
    // Sanitize incomplete codex_app MCP config overrides on thread/turn methods
    if matches!(
        method,
        "thread/start" | "thread/resume" | "thread/fork" | "turn/start"
    ) {
        if let Some(obj) = p.as_object_mut() {
            if let Some(cfg) = obj.get_mut("config") {
                sanitize_codex_app_mcp_config(cfg);
            }
        }
    }
    p
}

fn sanitize_codex_app_mcp_config(config: &mut Value) {
    let Some(obj) = config.as_object_mut() else {
        return;
    };
    let prefixes = [
        "mcp_servers.codex_app.",
        "plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.",
    ];
    for prefix in prefixes {
        let matching_keys: Vec<String> = obj
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        if matching_keys.is_empty() {
            continue;
        }
        let has_transport = matching_keys
            .iter()
            .any(|k| k == &format!("{}command", prefix) || k == &format!("{}url", prefix));
        if !has_transport {
            for k in matching_keys {
                obj.remove(&k);
            }
        }
    }
    if let Some(mcp_servers) = obj.get_mut("mcp_servers").and_then(|v| v.as_object_mut()) {
        if let Some(codex_app) = mcp_servers.get("codex_app").and_then(|v| v.as_object()) {
            let has_cmd = codex_app.get("command").and_then(|v| v.as_str()).is_some();
            let has_url = codex_app.get("url").and_then(|v| v.as_str()).is_some();
            if !has_cmd && !has_url {
                mcp_servers.remove("codex_app");
            }
        }
    }
}

/// Enrich thread timing fields for the desktop UI; preserve runtime model capabilities.
fn post_process_result(method: &str, mut result: Value) -> Value {
    match method {
        "thread/resume" | "thread/read" => {
            if let Some(thread) = result.get_mut("thread") {
                enrich_thread_timings(thread);
            }
            result
        }
        "thread/turns/list" => {
            if let Some(turns) = result.get_mut("data").and_then(|d| d.as_array_mut()) {
                for turn in turns {
                    enrich_turn_timing(turn);
                }
            }
            result
        }
        _ => result,
    }
}

fn enrich_thread_timings(thread: &mut Value) {
    if let Some(turns) = thread.get_mut("turns").and_then(|t| t.as_array_mut()) {
        for turn in turns {
            enrich_turn_timing(turn);
        }
    }
}

fn enrich_turn_timing(turn: &mut Value) {
    let Some(obj) = turn.as_object_mut() else {
        return;
    };
    if obj.get("firstTurnWorkItemStartedAt").is_some() {
        return;
    }
    if let Some(existing_ms) = obj.get("firstTurnWorkItemStartedAtMs").and_then(|v| v.as_f64()) {
        obj.insert(
            "firstTurnWorkItemStartedAt".to_string(),
            json!(existing_ms / 1000.0),
        );
        return;
    }
    let completed_at = obj.get("completedAt").and_then(|v| v.as_f64());
    let duration_ms = obj.get("durationMs").and_then(|v| v.as_f64());
    if let (Some(c), Some(d)) = (completed_at, duration_ms) {
        if d >= 0.0 {
            let start = c - d / 1000.0;
            obj.insert("firstTurnWorkItemStartedAt".to_string(), json!(start));
            obj.insert(
                "firstTurnWorkItemStartedAtMs".to_string(),
                json!(start * 1000.0),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn thread_window_watch_cleanup_does_not_connect_or_leave_pending_request() {
        let manager = AppServerManager::new();
        let generation = manager.inner.lock().await.generation;
        assert!(manager.release_file_watch("window-watch").await.unwrap_err().contains("not connected"));
        let state = manager.inner.lock().await;
        assert_eq!(state.generation, generation);
        assert!(state.child.is_none());
        assert!(state.pending_requests.is_empty());
    }

    #[test]
    fn server_request_ids_preserve_json_type() {
        assert_ne!(server_request_key(&json!(7)), server_request_key(&json!("7")));
    }

    fn approval(id: Value) -> PendingServerRequest {
        PendingServerRequest {
            id, method: "item/commandExecution/requestApproval".to_string(),
            params: json!({"threadId": "thread-a"}), generation: 2,
            response_delivery_unknown: false,
        }
    }

    fn approvals() -> HashMap<String, PendingServerRequest> {
        [json!(7), json!("7")].into_iter()
            .map(|id| (server_request_key(&id), approval(id))).collect()
    }

    #[tokio::test]
    async fn approval_response_writes_once_and_preserves_wire_id_type() {
        let mut pending = approvals();
        let mut output = Vec::new();
        write_server_response(&mut pending, Some(&mut output), &json!(7), 2, Some(json!({"decision": "decline"})), None).await.unwrap();
        let payload: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(payload, json!({"id": 7, "result": {"decision": "decline"}}));
        let written = output.len();
        assert!(write_server_response(&mut pending, Some(&mut output), &json!(7), 2, None, None).await.is_err());
        assert_eq!(output.len(), written);
        assert!(pending.contains_key(&server_request_key(&json!("7"))));
        output.clear();
        write_server_response(&mut pending, Some(&mut output), &json!("7"), 2, None, Some(json!({"code": -1}))).await.unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&output).unwrap(), json!({"id": "7", "error": {"code": -1}}));
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn approval_without_stdin_or_with_stale_generation_does_not_consume_request() {
        let mut pending = approvals();
        let mut output = Vec::new();
        assert!(write_server_response::<Vec<u8>>(&mut pending, None, &json!(7), 2, None, None).await.is_err());
        assert!(!pending[&server_request_key(&json!(7))].response_delivery_unknown);
        assert!(write_server_response(&mut pending, Some(&mut output), &json!(7), 1, None, None).await.is_err());
        assert!(output.is_empty());
        assert_eq!(pending.len(), 2);
    }

    #[tokio::test]
    async fn failed_approval_write_is_retained_but_cannot_be_resent() {
        let mut pending = approvals();
        let (mut writer, reader) = tokio::io::duplex(64);
        drop(reader);
        assert!(write_server_response(&mut pending, Some(&mut writer), &json!(7), 2, None, None).await.unwrap_err().contains("delivery is unknown"));
        assert!(pending[&server_request_key(&json!(7))].response_delivery_unknown);
        let mut output = Vec::new();
        assert!(write_server_response(&mut pending, Some(&mut output), &json!(7), 2, None, None).await.is_err());
        assert!(output.is_empty());
    }

    #[tokio::test]
    async fn failed_approval_flush_keeps_unknown_delivery_state() {
        struct FlushFailure(Vec<u8>);
        impl tokio::io::AsyncWrite for FlushFailure {
            fn poll_write(mut self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>, bytes: &[u8]) -> std::task::Poll<std::io::Result<usize>> {
                self.0.extend_from_slice(bytes);
                std::task::Poll::Ready(Ok(bytes.len()))
            }
            fn poll_flush(self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
                std::task::Poll::Ready(Err(std::io::ErrorKind::BrokenPipe.into()))
            }
            fn poll_shutdown(self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
                std::task::Poll::Ready(Ok(()))
            }
        }
        let mut pending = approvals();
        let mut writer = FlushFailure(Vec::new());
        assert!(write_server_response(&mut pending, Some(&mut writer), &json!(7), 2, None, None).await.unwrap_err().contains("delivery is unknown"));
        assert!(!writer.0.is_empty());
        assert!(pending[&server_request_key(&json!(7))].response_delivery_unknown);
    }

    #[tokio::test]
    async fn interrupted_approval_write_cannot_be_repeated() {
        let mut pending = approvals();
        let (mut writer, _reader) = tokio::io::duplex(1);
        assert!(tokio::time::timeout(Duration::from_millis(10),
            write_server_response(&mut pending, Some(&mut writer), &json!(7), 2, None, None)
        ).await.is_err());
        assert!(pending[&server_request_key(&json!(7))].response_delivery_unknown);
        let mut output = Vec::new();
        assert!(write_server_response(&mut pending, Some(&mut output), &json!(7), 2, None, None).await.is_err());
        assert!(output.is_empty());
    }

    #[tokio::test]
    async fn concurrent_approval_responses_write_only_once_under_state_lock() {
        let state = Arc::new(Mutex::new((approvals(), Vec::new())));
        let respond = |state: Arc<Mutex<(HashMap<String, PendingServerRequest>, Vec<u8>)>>| async move {
            let mut guard = state.lock().await;
            let (pending, writer) = &mut *guard;
            write_server_response(pending, Some(writer), &json!(7), 2, None, None).await
        };
        let (first, second) = tokio::join!(respond(state.clone()), respond(state.clone()));
        assert_ne!(first.is_ok(), second.is_ok());
        let guard = state.lock().await;
        assert_eq!(guard.1.iter().filter(|byte| **byte == b'\n').count(), 1);
    }

    #[tokio::test]
    async fn resolved_approval_requires_thread_generation_and_typed_id() {
        let manager = AppServerManager::new();
        let mut state = manager.inner.lock().await;
        state.generation = 2;
        state.pending_server_requests = approvals();
        state.resolve_server_request(1, &json!({"threadId": "thread-a", "requestId": 7}));
        state.resolve_server_request(2, &json!({"threadId": "thread-b", "requestId": 7}));
        state.resolve_server_request(2, &json!({"requestId": 7}));
        assert_eq!(state.pending_server_requests.len(), 2);
        state.resolve_server_request(2, &json!({"threadId": "thread-a", "requestId": 7}));
        assert!(!state.pending_server_requests.contains_key(&server_request_key(&json!(7))));
        assert!(state.pending_server_requests.contains_key(&server_request_key(&json!("7"))));
        state.resolve_server_request(2, &json!({"threadId": "thread-a", "requestId": "7"}));
        assert!(state.pending_server_requests.is_empty());
        let mut legacy = approval(json!(8));
        legacy.params = json!({"conversationId": "thread-a"});
        state.pending_server_requests.insert(server_request_key(&legacy.id), legacy);
        state.resolve_server_request(2, &json!({"threadId": "thread-a", "requestId": 8}));
        assert!(state.pending_server_requests.is_empty());
        let mut scoped = approval(json!(9));
        scoped.params = json!({"threadId": "thread-b", "conversationId": "thread-a"});
        state.pending_server_requests.insert(server_request_key(&scoped.id), scoped);
        state.resolve_server_request(2, &json!({"threadId": "thread-a", "requestId": 9}));
        assert_eq!(state.pending_server_requests.len(), 1);
    }

    #[tokio::test]
    async fn stale_reader_cannot_disconnect_new_connection() {
        let manager = AppServerManager::new();
        let mut state = manager.inner.lock().await;
        state.generation = 2;
        state.status.connected = true;
        let (tx, mut rx) = oneshot::channel();
        state.pending_requests.insert(42, tx);
        assert!(!state.close_generation(1));
        assert!(state.status.connected);
        assert!(matches!(rx.try_recv(), Err(oneshot::error::TryRecvError::Empty)));
        assert!(state.close_generation(2));
        assert!(!state.status.connected);
        assert_eq!(rx.await.unwrap(), Err("app-server connection closed".to_string()));
    }

    #[test]
    fn model_list_preserves_runtime_capabilities() {
        let models = json!([
            { "id": "gpt-6.1-sol", "hidden": true,
              "supportedReasoningEfforts": [{"reasoningEffort": "low"}],
              "additionalSpeedTiers": [] },
            { "id": "gpt-6-astra", "hidden": true,
              "supportedReasoningEfforts": [], "additionalSpeedTiers": ["fast"] }
        ]);
        for raw in [models.clone(), json!({"data": models, "nextCursor": "next"}), json!([]), json!({"data": []})] {
            assert_eq!(post_process_result("model/list", raw.clone()), raw);
        }
    }

    #[test]
    fn sanitizes_incomplete_codex_app_mcp_config() {
        let mut cfg = json!({
            "mcp_servers.codex_app.enabled_tools": ["foo"],
            "mcp_servers": {
                "codex_app": { "enabled": true },
                "valid_srv": { "command": "npx" }
            }
        });
        sanitize_codex_app_mcp_config(&mut cfg);
        let obj = cfg.as_object().unwrap();
        assert!(!obj.contains_key("mcp_servers.codex_app.enabled_tools"));
        let srvs = obj.get("mcp_servers").and_then(|v| v.as_object()).unwrap();
        assert!(!srvs.contains_key("codex_app"));
        assert!(srvs.contains_key("valid_srv"));
    }
}

