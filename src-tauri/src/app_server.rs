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
}

struct InnerState {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending_requests: HashMap<u64, oneshot::Sender<Result<Value, String>>>,
    pending_server_requests: HashMap<String, PendingServerRequest>,
    status: AppServerStatus,
    custom_cli_path: Option<String>,
}

#[derive(Clone)]
pub struct AppServerManager {
    inner: Arc<Mutex<InnerState>>,
    next_id: Arc<AtomicU64>,
}

impl AppServerManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(InnerState {
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
        {
            let guard = self.inner.lock().await;
            if guard.status.connected && guard.stdin.is_some() {
                return Ok(guard.status.clone());
            }
        }
        self.restart(app).await
    }

    pub async fn restart(&self, app: &AppHandle) -> Result<AppServerStatus, String> {
        let binary_path = {
            let mut guard = self.inner.lock().await;
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
            resolved
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
                    handle_incoming_message(&inner_stdout, &app_stdout, msg).await;
                }
            }
            // EOF reached -> process exited
            let mut guard = inner_stdout.lock().await;
            guard.status.connected = false;
            guard.status.connecting = false;
            guard.stdin = None;
            for (_, tx) in guard.pending_requests.drain() {
                let _ = tx.send(Err("app-server connection closed".to_string()));
            }
            let _ = app_stdout.emit("app-server:status", guard.status.clone());
        });

        // Spawn stderr reader task
        let app_stderr = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
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

        match self
            .send_raw_request("initialize", init_params, Duration::from_secs(15))
            .await
        {
            Ok(init_result) => {
                let _ = self.send_raw_notification("initialized", None).await;
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
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<(), String> {
        let key = server_request_key(&id);
        let wire_id = {
            let mut guard = self.inner.lock().await;
            guard
                .pending_server_requests
                .remove(&key)
                .map(|r| r.id)
                .unwrap_or(id)
        };
        let response = if let Some(err) = error {
            json!({ "id": wire_id, "error": err })
        } else {
            json!({ "id": wire_id, "result": result.unwrap_or_else(|| json!({})) })
        };
        self.write_json_line(&response).await?;
        let _ = app.emit("app-server:server-request-resolved", json!({ "id": wire_id }));
        Ok(())
    }
}

fn server_request_key(id: &Value) -> String {
    match id {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

async fn handle_incoming_message(inner: &Arc<Mutex<InnerState>>, app: &AppHandle, msg: Value) {
    let has_id = msg.get("id").is_some();
    let has_method = msg.get("method").and_then(|m| m.as_str()).is_some();
    let has_result = msg.get("result").is_some();
    let has_error = msg.get("error").is_some();

    // 1. Response to a client-initiated request
    if has_id && (has_result || has_error) {
        if let Some(id_u64) = msg.get("id").and_then(|v| v.as_u64()) {
            let tx_opt = {
                let mut guard = inner.lock().await;
                guard.pending_requests.remove(&id_u64)
            };
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
        };
        {
            let mut guard = inner.lock().await;
            guard
                .pending_server_requests
                .insert(server_request_key(&id), req.clone());
        }
        let _ = app.emit("app-server:server-request", req);
        return;
    }

    // 3. Server notification (streaming deltas, turn/started, turn/completed, etc.)
    if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
        let params = msg
            .get("params")
            .or_else(|| msg.get("result"))
            .cloned()
            .unwrap_or(Value::Null);
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

/// Ported from scripts/desktop-patches/model-catalog-compat.cjs & appServerBridge.ts
fn post_process_result(method: &str, mut result: Value) -> Value {
    match method {
        "model/list" => patch_model_list_result(result),
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

fn patch_model_list_result(mut result: Value) -> Value {
    let models_opt = if result.is_array() {
        result.as_array_mut()
    } else {
        result.get_mut("data").and_then(|d| d.as_array_mut())
    };
    let Some(models) = models_opt else {
        return result;
    };

    let mut found_astra = false;
    for model in models.iter_mut() {
        let slug = model
            .get("model")
            .or_else(|| model.get("slug"))
            .or_else(|| model.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if slug == "gpt-6-astra" {
            found_astra = true;
            if let Some(obj) = model.as_object_mut() {
                obj.insert("hidden".to_string(), Value::Bool(false));
            }
        } else if slug == "gpt-6.1-sol" {
            if let Some(obj) = model.as_object_mut() {
                obj.insert("hidden".to_string(), Value::Bool(false));
            }
        }
    }

    if !found_astra {
        models.insert(0, create_astra_model());
    }
    result
}

fn create_astra_model() -> Value {
    json!({
        "id": "gpt-6-astra",
        "model": "gpt-6-astra",
        "upgrade": null,
        "upgradeInfo": null,
        "availabilityNux": null,
        "displayName": "GPT-6-Astra",
        "description": "Our most capable model for complex, demanding work.",
        "modelSpecialty": null,
        "hidden": false,
        "supportedReasoningEfforts": [
            { "reasoningEffort": "low", "description": "Fast responses with lighter reasoning" },
            { "reasoningEffort": "medium", "description": "Balances speed and reasoning depth for everyday tasks" },
            { "reasoningEffort": "high", "description": "Greater reasoning depth for complex problems" },
            { "reasoningEffort": "xhigh", "description": "Extra high reasoning depth for complex problems" },
            { "reasoningEffort": "max", "description": "Maximum reasoning depth for the hardest problems" },
            { "reasoningEffort": "ultra", "description": "Maximum reasoning with automatic task delegation" }
        ],
        "defaultReasoningEffort": "medium",
        "inputModalities": ["text", "image"],
        "supportsPersonality": true,
        "multiAgentVersion": "v2",
        "additionalSpeedTiers": ["fast"],
        "serviceTiers": [
            {
                "id": "priority",
                "name": "Fast",
                "description": "2x speed, increased usage"
            }
        ],
        "defaultServiceTier": null,
        "isDefault": false
    })
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

    #[test]
    fn patches_model_list_with_astra_and_unhides_sol() {
        let raw = json!({
            "data": [
                { "id": "gpt-6.1-sol", "model": "gpt-6.1-sol", "hidden": true },
                { "id": "gpt-5.4", "model": "gpt-5.4", "hidden": false }
            ]
        });
        let patched = patch_model_list_result(raw);
        let arr = patched.get("data").and_then(|d| d.as_array()).unwrap();
        assert_eq!(arr[0].get("model").and_then(|v| v.as_str()), Some("gpt-6-astra"));
        assert_eq!(arr[1].get("model").and_then(|v| v.as_str()), Some("gpt-6.1-sol"));
        assert_eq!(arr[1].get("hidden").and_then(|v| v.as_bool()), Some(false));
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

