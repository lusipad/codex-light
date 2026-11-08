use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

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
    #[serde(default)]
    pub notification_nonce: String,
}

struct InnerState {
    generation: u64,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending_requests: HashMap<u64, oneshot::Sender<Result<Value, String>>>,
    pending_server_requests: HashMap<String, PendingServerRequest>,
    active_schedule_turns: HashMap<String, String>,
    schedule_mcp_token: String,
    status: AppServerStatus,
    custom_cli_path: Option<String>,
    private_threads: HashMap<String, Option<mpsc::UnboundedSender<Value>>>,
    private_starts: HashMap<u64, Option<mpsc::UnboundedSender<Value>>>,
    held_private_events: Vec<Value>,
    private_tool_starts: HashSet<u64>,
    private_tool_threads: HashSet<String>,
    private_tool_requests: HashMap<String, Value>,
    private_tool_seen: HashSet<String>,
    private_turn_starts: HashMap<u64,String>,
    private_turns: HashMap<String,String>,
}

enum PrivateRoute {Global,Held,Owned {thread_id:String,delivered:bool}}

impl InnerState {
    fn schedule_turn_is_active(&self, params: &Value) -> bool {
        params["threadId"].as_str().and_then(|id| self.active_schedule_turns.get(id))
            .is_some_and(|turn| params["turnId"] == turn.as_str())
    }

    fn update_schedule_turns(&mut self, method: &str, params: &Value) -> Vec<PendingServerRequest> {
        let turn = params["threadId"].as_str().zip(params.pointer("/turn/id").and_then(Value::as_str));
        match (method, turn) {
            ("turn/started", Some((thread, turn))) => {
                self.active_schedule_turns.insert(thread.into(), turn.into());
            }
            ("turn/completed", Some((thread, turn))) => {
                if self.active_schedule_turns.get(thread).is_some_and(|active| active == turn) {
                    self.active_schedule_turns.remove(thread);
                }
            }
            ("account/updated", _) => self.active_schedule_turns.clear(),
            _ => return Vec::new(),
        }
        let expired: Vec<_> = self.pending_server_requests.iter().filter(|(_, request)| {
            request.method == crate::automation_tool::APPROVAL_METHOD && !self.schedule_turn_is_active(&request.params)
        }).map(|(key, _)| key.clone()).collect();
        expired.into_iter().filter_map(|key| self.pending_server_requests.remove(&key)).collect()
    }

    fn claim_private_start(&mut self,id:u64,message:&Value)->Option<Option<String>> {
        let sender=self.private_starts.remove(&id)?;
        let tools=self.private_tool_starts.remove(&id);
        if let Some(thread)=message.pointer("/result/thread/id").and_then(Value::as_str) {
            self.private_threads.insert(thread.into(),sender);
            if tools {self.private_tool_threads.insert(thread.into());}
            Some(Some(thread.into()))
        } else {
            // A failed/malformed start must not release already observed ephemeral metadata to the UI.
            for event in &self.held_private_events {
                if event.pointer("/params/thread/ephemeral")==Some(&Value::Bool(true)) {
                    if let Some(thread)=incoming_thread_id(event) {self.private_threads.insert(thread.into(),None);}
                }
            }
            Some(None)
        }
    }
    fn route_private(&mut self,message:&Value)->PrivateRoute {
        let Some(thread_id)=incoming_thread_id(message).map(str::to_owned) else {return PrivateRoute::Global;};
        if !self.private_threads.contains_key(&thread_id) && !self.private_starts.is_empty() &&
            message.pointer("/params/thread/ephemeral")==Some(&Value::Bool(true)) && self.private_starts.values().all(Option::is_none) {
            self.private_threads.insert(thread_id.clone(),None);
        }
        if let Some(sender)=self.private_threads.get(&thread_id) {
            if self.private_tool_threads.contains(&thread_id) && message["method"]=="item/tool/call" && message.get("id").is_some() {
                let key=server_request_key(&message["id"]);
                if !self.private_tool_seen.insert(key.clone()) {return PrivateRoute::Owned {thread_id,delivered:true};}
                self.private_tool_requests.insert(key,message.clone());
            }
            let delivered=sender.as_ref().is_some_and(|sender|sender.send(message.clone()).is_ok());
            if message["method"]=="turn/started" {
                if let Some(turn_id)=message.pointer("/params/turn/id").and_then(Value::as_str) {self.private_turns.insert(thread_id.clone(),turn_id.to_owned());}
            }
            return PrivateRoute::Owned {thread_id,delivered};
        }
        if self.private_starts.values().any(Option::is_some) {self.held_private_events.push(message.clone());return PrivateRoute::Held;}
        PrivateRoute::Global
    }
    fn resolve_server_request(&mut self, generation: u64, params: &Value) -> Option<PendingServerRequest> {
        if self.generation != generation {
            return None;
        }
        let id = params.get("requestId")?;
        let thread_id = params.get("threadId").and_then(Value::as_str)?;
        let key = server_request_key(id);
        if self.pending_server_requests.get(&key).is_some_and(|request| {
            request.generation == generation
                && request.params.get("threadId").and_then(Value::as_str)
                    .or_else(|| request.params.get("conversationId").and_then(Value::as_str)) == Some(thread_id)
        }) {
            return self.pending_server_requests.remove(&key);
        }
        None
    }

    fn close_generation(&mut self, generation: u64) -> bool {
        if self.generation != generation {
            return false;
        }
        self.status.connected = false;
        self.status.connecting = false;
        self.stdin = None;
        self.pending_server_requests.clear();
        self.active_schedule_turns.clear();
        self.schedule_mcp_token.clear();
        self.private_tool_starts.clear();
        self.private_tool_threads.clear();
        self.private_tool_requests.clear();
        self.private_tool_seen.clear();
        self.private_threads.clear();
        self.private_starts.clear();
        self.held_private_events.clear();
        self.private_turn_starts.clear();
        self.private_turns.clear();
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
    private_creation: Arc<Mutex<()>>,
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
                active_schedule_turns: HashMap::new(),
                schedule_mcp_token: String::new(),
                status: AppServerStatus {
                    connected: false,
                    connecting: false,
                    binary_path: String::from("codex"),
                    app_server_version: None,
                    user_agent: None,
                    last_error: None,
                },
                custom_cli_path: None,
                private_threads: HashMap::new(),
                private_starts: HashMap::new(),
                held_private_events: Vec::new(),
                private_tool_starts: HashSet::new(),
                private_tool_threads: HashSet::new(),
                private_tool_requests: HashMap::new(),
                private_tool_seen: HashSet::new(),
                private_turn_starts: HashMap::new(),
                private_turns: HashMap::new(),
            })),
            next_id: Arc::new(AtomicU64::new(1)),
            lifecycle: Arc::new(Mutex::new(())),
            private_creation: Arc::new(Mutex::new(())),
        }
    }

    pub async fn get_status(&self) -> AppServerStatus {
        let guard = self.inner.lock().await;
        guard.status.clone()
    }

    pub async fn connection_generation(&self) -> u64 {
        self.inner.lock().await.generation
    }

    pub async fn require_generation(&self,generation:u64)->Result<(),String> {
        let guard=self.inner.lock().await;
        if guard.generation!=generation || !guard.status.connected || guard.stdin.is_none() {return Err("Temporary generation connection changed or disconnected".into());}
        Ok(())
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
            guard.active_schedule_turns.clear();
            guard.schedule_mcp_token = uuid::Uuid::new_v4().to_string();
            guard.private_tool_starts.clear();
            guard.private_tool_threads.clear();
            guard.private_tool_requests.clear();
            guard.private_tool_seen.clear();
            guard.private_threads.clear();
            guard.private_starts.clear();
            guard.held_private_events.clear();
            guard.private_turn_starts.clear();
            guard.private_turns.clear();
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

    /// Dedicated temporary generation calls never reconnect or bind a user's workspace thread.
    pub async fn isolated_call(&self, generation: u64, method: &str, params: Value) -> Result<Value, String> {
        self.isolated_request(generation, method, params, None, None).await
    }

    pub async fn isolated_start(&self, app:&AppHandle, generation: u64, params: Value) -> Result<(Value, mpsc::UnboundedReceiver<Value>), String> {
        if params.get("dynamicTools").is_some_and(|tools|!tools.is_null()) {return Err("Git generation cannot register tools".into());}
        self.isolated_review_start(app,generation,params).await
    }

    pub(crate) async fn isolated_review_start(&self, app:&AppHandle,generation:u64,params:Value)->Result<(Value,mpsc::UnboundedReceiver<Value>),String> {
        let _creation = self.private_creation.lock().await;
        let (sender, receiver) = mpsc::unbounded_channel();
        let result = self.isolated_request(generation, "thread/start", params, Some(sender), Some(app.clone())).await?;
        Ok((result, receiver))
    }

    async fn isolated_request(&self, generation: u64, method: &str, params: Value, sender: Option<mpsc::UnboundedSender<Value>>, app:Option<AppHandle>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        let mut line = serde_json::to_vec(&json!({"id":id,"method":method,"params":params})).map_err(|error|error.to_string())?;
        line.push(b'\n');
        {
            let mut guard = self.inner.lock().await;
            if guard.generation != generation || guard.stdin.is_none() { return Err("Temporary generation belongs to a disconnected app-server".into()); }
            guard.pending_requests.insert(id,tx);
            if let Some(sender) = sender {
                if params.get("dynamicTools").and_then(Value::as_array).is_some_and(|tools| !tools.is_empty()) {guard.private_tool_starts.insert(id);}
                guard.private_starts.insert(id,Some(sender));
            }
            if method=="turn/start" {
                if let Some(thread_id)=params.get("threadId").and_then(Value::as_str) {
                    if guard.private_threads.contains_key(thread_id) {guard.private_turn_starts.insert(id,thread_id.to_owned());}
                }
            }
            let writer = guard.stdin.as_mut().unwrap();
            if let Err(error) = async {writer.write_all(&line).await?; writer.flush().await}.await {
                guard.pending_requests.remove(&id);
                if let Some(slot)=guard.private_starts.get_mut(&id) {*slot=None;}
                return Err(format!("Temporary request delivery is unknown: {error}"));
            }
        }
        let replay=app.map(|app| {
            let inner=self.inner.clone();
            Arc::new(move |messages:Vec<Value>| {
                let inner=inner.clone();let app=app.clone();
                tokio::spawn(async move {for message in messages {handle_incoming_message(&inner,&app,generation,message).await;}});
            }) as PrivateReplay
        });
        let _cleanup = IsolatedPendingCleanup { inner:self.inner.clone(), generation, id, replay };
        match tokio::time::timeout(Duration::from_secs(10),rx).await {
            Ok(Ok(result))=>result,
            Ok(Err(_))=>Err("Temporary generation connection closed".into()),
            Err(_)=>Err("Temporary generation request timed out; it will not be replayed".into()),
        }
    }

    /// Only a request captured on an explicitly dynamic private thread can be answered here.
    pub async fn isolated_tool_respond(&self,generation:u64,thread:&str,turn:&str,id:&Value,result:Value)->Result<(),String> {
        let mut guard=self.inner.lock().await;
        if guard.generation!=generation || !guard.private_tool_threads.contains(thread) || guard.private_threads.get(thread).is_none_or(|sender|sender.as_ref().is_none_or(|sender|sender.is_closed())) {return Err("Private review is no longer active".into());}
        let key=server_request_key(id);
        let request=guard.private_tool_requests.get(&key).ok_or("Unknown or already answered private tool request")?;
        if request.pointer("/params/threadId").and_then(Value::as_str)!=Some(thread) || request.pointer("/params/turnId").and_then(Value::as_str)!=Some(turn) || guard.private_turns.get(thread).is_some_and(|known|known!=turn) {return Err("Private tool request scope does not match".into());}
        let mut line=serde_json::to_vec(&json!({"id":id,"result":result})).map_err(|error|error.to_string())?;line.push(b'\n');
        guard.private_tool_requests.remove(&key);
        let writer=guard.stdin.as_mut().ok_or("Private review connection closed")?;
        writer.write_all(&line).await.map_err(|error|error.to_string())?;
        writer.flush().await.map_err(|error|error.to_string())
    }

    pub async fn isolate_finish(&self, generation:u64, thread_id:&str, interrupt:bool) {
        let mut guard=self.inner.lock().await;
        if guard.generation==generation {
            if let Some(sender)=guard.private_threads.get_mut(thread_id) {*sender=None;}
            guard.private_tool_threads.remove(thread_id);
            guard.private_tool_requests.retain(|_,request|request.pointer("/params/threadId").and_then(Value::as_str)!=Some(thread_id));
            if interrupt {
                if let Some(turn_id)=guard.private_turns.get(thread_id).cloned() {
                    private_cleanup_write(&mut guard,"turn/interrupt",json!({"threadId":thread_id,"turnId":turn_id})).await;
                }
            }
            private_cleanup_write(&mut guard,"thread/unsubscribe",json!({"threadId":thread_id})).await;
        }
    }

    pub async fn respond_to_server_request(
        &self,
        app: &AppHandle,
        id: Value,
        generation: u64,
        result: Option<Value>,
        error: Option<Value>,
        notification_nonce: Option<String>,
    ) -> Result<(), String> {
        let schedule_thread = {
            let guard = self.inner.lock().await;
            let req = guard.pending_server_requests.get(&server_request_key(&id));
            if let Some(req) = req.filter(|req| req.method == crate::automation_tool::APPROVAL_METHOD) {
                if guard.generation != generation || req.generation != generation ||
                    req.response_delivery_unknown || !guard.schedule_turn_is_active(&req.params) ||
                    notification_nonce.as_deref() != Some(req.notification_nonce.as_str())
                {
                    return Err("定时任务确认已失效".into());
                }
                if error.is_some() || !matches!(result.as_ref().and_then(|value| value["decision"].as_str()), Some("create" | "decline")) {
                    return Err("请选择创建或拒绝定时任务".into());
                }
                (result.as_ref().unwrap()["decision"] == "create")
                    .then(|| req.params["threadId"].as_str().unwrap_or_default().to_owned())
            } else {
                None
            }
        };
        let thread_valid = if let Some(thread_id) = schedule_thread.as_deref() {
            self.call(app, "thread/read", Some(json!({"threadId":thread_id,"includeTurns":false})))
                .await.is_ok_and(|response| crate::automation_tool::can_schedule_in_thread(thread_id, &response))
        } else {
            false
        };
        let mut guard = self.inner.lock().await;
        if guard.generation != generation {
            return Err("Approval belongs to a previous app-server connection".to_string());
        }
        let active_schedule_request = guard.pending_server_requests.get(&server_request_key(&id))
            .is_some_and(|request| guard.schedule_turn_is_active(&request.params));
        let InnerState { stdin, pending_server_requests, .. } = &mut *guard;
        validate_notification_nonce(pending_server_requests, &id, notification_nonce.as_deref())?;
        let request = pending_server_requests.get(&server_request_key(&id));
        let instance = request.map(|request| request.notification_nonce.clone());
        let result = if let Some(request) = request.filter(|request| request.method == crate::automation_tool::APPROVAL_METHOD) {
            if request.response_delivery_unknown || !active_schedule_request ||
                notification_nonce.as_deref() != Some(request.notification_nonce.as_str())
            {
                return Err("定时任务确认已失效".into());
            }
            let receipt = if schedule_thread.is_none() {
                Err("User declined scheduling the task.".into())
            } else if !thread_valid || request.params["threadId"].as_str() != schedule_thread.as_deref() || stdin.is_none() {
                Err("The linked local chat is no longer available.".into())
            } else {
                crate::automation_tool::create(&request.params)
            };
            Some(schedule_reply(request.params["scheduleTransport"] == "mcp", receipt))
        } else {
            result
        };
        write_server_response(pending_server_requests, stdin.as_mut(), &id, generation, result, error).await?;
        let _ = app.emit("app-server:server-request-resolved", json!({ "id": id, "generation": generation, "notificationNonce":instance }));
        Ok(())
    }

    pub(crate) async fn schedule_mcp_token(&self) -> String {
        self.inner.lock().await.schedule_mcp_token.clone()
    }
}

type PrivateReplay=Arc<dyn Fn(Vec<Value>)+Send+Sync>;
struct IsolatedPendingCleanup {inner:Arc<Mutex<InnerState>>,generation:u64,id:u64,replay:Option<PrivateReplay>}
impl Drop for IsolatedPendingCleanup {
    fn drop(&mut self) {
        let inner=self.inner.clone(); let generation=self.generation; let id=self.id;let replay=self.replay.clone();
        tokio::spawn(async move {
            let mut guard=inner.lock().await;
            if guard.generation==generation {
                guard.pending_requests.remove(&id);
                if let Some(sender)=guard.private_starts.get_mut(&id) {*sender=None;}
                let closed:Vec<_>=guard.private_threads.iter().filter_map(|(thread,sender)|sender.as_ref().filter(|sender|sender.is_closed()).map(|_|thread.clone())).collect();
                for thread in closed {
                    guard.private_threads.insert(thread.clone(),None);
                    if let Some(turn)=guard.private_turns.get(&thread).cloned() {private_cleanup_write(&mut guard,"turn/interrupt",json!({"threadId":thread,"turnId":turn})).await;}
                    private_cleanup_write(&mut guard,"thread/unsubscribe",json!({"threadId":thread})).await;
                }
                if replay.is_some() && !guard.private_starts.values().any(Option::is_some) {
                    let messages=std::mem::take(&mut guard.held_private_events);
                    for message in &messages {
                        if message.pointer("/params/thread/ephemeral")==Some(&Value::Bool(true)) {
                            if let Some(thread_id)=incoming_thread_id(message) {guard.private_threads.insert(thread_id.to_owned(),None);}
                        }
                    }
                    drop(guard);
                    replay.as_ref().unwrap()(messages);
                }
            }
        });
    }
}

fn incoming_thread_id(message:&Value)->Option<&str> {
    message.pointer("/params/threadId").and_then(Value::as_str)
        .or_else(||message.pointer("/params/conversationId").and_then(Value::as_str))
        .or_else(||message.pointer("/params/thread/id").and_then(Value::as_str))
}

async fn private_cleanup_write(guard:&mut InnerState, method:&str, params:Value) {
    let payload=json!({"id":format!("private-cleanup-{}",uuid::Uuid::new_v4()),"method":method,"params":params});
    if let (Some(writer),Ok(mut line))=(guard.stdin.as_mut(),serde_json::to_vec(&payload)) {
        line.push(b'\n'); let _=writer.write_all(&line).await; let _=writer.flush().await;
    }
}

fn server_request_key(id: &Value) -> String {
    id.to_string()
}

fn validate_notification_nonce(pending: &HashMap<String, PendingServerRequest>, id: &Value, nonce: Option<&str>) -> Result<(), String> {
    if let Some(nonce) = nonce {
        if nonce.is_empty() || !pending.get(&server_request_key(id)).is_some_and(|request| request.notification_nonce == nonce) {
            return Err("Notification approval belongs to an expired request instance".into());
        }
    }
    Ok(())
}

fn schedule_reply(mcp: bool, receipt: Result<Value, String>) -> Value {
    match (mcp, receipt) {
        (true, Ok(receipt)) => json!({"action":"accept","content":{"receipt":receipt.to_string()}}),
        (true, Err(_)) => json!({"action":"decline"}),
        (false, Ok(receipt)) => crate::automation_tool::reply(true, receipt.to_string()),
        (false, Err(error)) => crate::automation_tool::reply(false, error),
    }
}

async fn reject_schedule_call(writer: Option<&mut ChildStdin>, id: &Value, mcp: bool, reason: &str) {
    let response = json!({"id":id,"result":schedule_reply(mcp, Err(reason.into()))});
    if let (Some(writer), Ok(mut bytes)) = (writer, serde_json::to_vec(&response)) {
        bytes.push(b'\n');
        if writer.write_all(&bytes).await.is_ok() {
            let _ = writer.flush().await;
        }
    }
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
    let mut queue=std::collections::VecDeque::from([msg]);
    while let Some(msg)=queue.pop_front() {
    let has_id = msg.get("id").is_some();
    let has_method = msg.get("method").and_then(|m| m.as_str()).is_some();
    let has_result = msg.get("result").is_some();
    let has_error = msg.get("error").is_some();

    // 1. Response to a client-initiated request
    if has_id && (has_result || has_error) {
        if let Some(id_u64) = msg.get("id").and_then(|v| v.as_u64()) {
            if let Some(thread_id)=guard.private_turn_starts.remove(&id_u64) {
                if let Some(turn_id)=msg.pointer("/result/turn/id").and_then(Value::as_str) {
                    guard.private_turns.insert(thread_id.clone(),turn_id.to_owned());
                    if guard.private_threads.get(&thread_id).is_some_and(Option::is_none) {
                        private_cleanup_write(&mut guard,"turn/interrupt",json!({"threadId":thread_id,"turnId":turn_id})).await;
                    }
                }
            }
            if let Some(thread_id)=guard.claim_private_start(id_u64,&msg) {
                if let Some(thread_id)=thread_id {
                    if guard.private_threads[&thread_id].is_none() {
                        private_cleanup_write(&mut guard,"thread/unsubscribe",json!({"threadId":thread_id})).await;
                    }
                }
                queue.extend(std::mem::take(&mut guard.held_private_events));
            }
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
                continue;
            }
        }
    }

    if has_method {
        match guard.route_private(&msg) {
            PrivateRoute::Held=>continue,
            PrivateRoute::Owned {thread_id,delivered}=>{
                let dynamic = delivered && guard.private_tool_threads.contains(&thread_id) && msg["method"]=="item/tool/call";
                if !dynamic && has_id && !has_result && !has_error {
                    // No private tool/approval request enters global pending state or the renderer.
                    let response=json!({"id":msg["id"],"error":{"code":-32601,"message":"Tools and approvals are disabled for temporary Git message generation"}});
                    if let (Some(writer),Ok(mut line))=(guard.stdin.as_mut(),serde_json::to_vec(&response)) {
                        line.push(b'\n');let _=writer.write_all(&line).await;let _=writer.flush().await;
                    }
                }
                if !delivered {
                    guard.private_threads.insert(thread_id.clone(),None);
                    if msg["method"]=="turn/started" {
                        if let Some(turn_id)=msg.pointer("/params/turn/id").and_then(Value::as_str) {
                            private_cleanup_write(&mut guard,"turn/interrupt",json!({"threadId":thread_id,"turnId":turn_id})).await;
                        }
                    }
                    if msg["method"]=="thread/started" {private_cleanup_write(&mut guard,"thread/unsubscribe",json!({"threadId":thread_id})).await;}
                }
                continue;
            },
            PrivateRoute::Global=>{},
        }
    }

    // 2. Server-initiated request (e.g. command/patch/tool approval or user input)
    if has_id && has_method && !has_result && !has_error {
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let mut method = msg
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let mut params = msg.get("params").cloned().unwrap_or(Value::Null);
        let mcp_schedule = crate::schedule_mcp::is_schedule_elicitation(&method, &params);
        if mcp_schedule || crate::automation_tool::matches_tool(&method, &params) {
            let validated = if !guard.schedule_turn_is_active(&params) {
                Err("The scheduling turn is no longer active".into())
            } else if mcp_schedule {
                crate::schedule_mcp::proposal(&params, &guard.schedule_mcp_token).map(|proposal| params = proposal)
            } else {
                crate::automation_tool::validate(&params)
            };
            if let Err(error) = validated {
                reject_schedule_call(guard.stdin.as_mut(), &id, mcp_schedule, &error).await;
                continue;
            }
            method = crate::automation_tool::APPROVAL_METHOD.into();
        }
        let req = PendingServerRequest {
            id: id.clone(),
            method,
            params,
            generation,
            response_delivery_unknown: false,
            notification_nonce: uuid::Uuid::new_v4().to_string(),
        };
        let req = guard
            .pending_server_requests
            .entry(server_request_key(&id)).or_insert(req).clone();
        let _ = app.emit("app-server:server-request", req);
        continue;
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
        for request in guard.update_schedule_turns(method, &params) {
            if method != "turn/completed" && !request.response_delivery_unknown {
                reject_schedule_call(guard.stdin.as_mut(), &request.id, request.params["scheduleTransport"] == "mcp", "The scheduling approval expired.").await;
            }
            let _ = app.emit("app-server:server-request-resolved", json!({
                "id":request.id,"generation":request.generation,"notificationNonce":request.notification_nonce
            }));
        }
        if method == "serverRequest/resolved" {
            if let Some(request) = guard.resolve_server_request(generation, &params)
                .filter(|request| request.method == crate::automation_tool::APPROVAL_METHOD)
            {
                let _ = app.emit("app-server:server-request-resolved", json!({
                    "id":request.id,"generation":request.generation,"notificationNonce":request.notification_nonce
                }));
            }
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
    async fn private_review_tool_roundtrip_uses_actual_stdin_and_request_id() {
        // A controlled child acts as an app-server: emits one request and echoes the actual response.
        let script = r#"$request='{"id":"wire-7","method":"item/tool/call","params":{"threadId":"review","turnId":"turn","callId":"call-99","tool":"native_pinned_review_diff","arguments":{}}}';[Console]::Out.WriteLine($request);[Console]::Out.Flush();$line=[Console]::ReadLine();[Console]::Out.WriteLine($line);[Console]::Out.Flush()"#;
        let mut command=Command::new("pwsh");command.args(["-NoProfile","-NonInteractive","-Command",script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(target_os="windows")] command.creation_flags(CREATE_NO_WINDOW);
        let mut child=command.spawn().unwrap();let stdin=child.stdin.take().unwrap();let stdout=child.stdout.take().unwrap();let mut lines=BufReader::new(stdout).lines();
        let request:Value=serde_json::from_str(&tokio::time::timeout(Duration::from_secs(10),lines.next_line()).await.unwrap().unwrap().unwrap()).unwrap();
        let manager=AppServerManager::new();let (sender,mut receiver)=mpsc::unbounded_channel();
        {let mut state=manager.inner.lock().await;state.generation=9;state.stdin=Some(stdin);state.private_threads.insert("review".into(),Some(sender));state.private_tool_threads.insert("review".into());state.private_turns.insert("review".into(),"turn".into());
            assert!(matches!(state.route_private(&request),PrivateRoute::Owned{delivered:true,..}));
            assert!(state.pending_server_requests.is_empty());
            assert!(matches!(state.route_private(&request),PrivateRoute::Owned{delivered:true,..}));}
        assert_eq!(receiver.recv().await.unwrap(),request);assert!(receiver.try_recv().is_err(),"duplicate wire id is not executed twice");
        let result=json!({"success":false,"contentItems":[{"type":"inputText","text":"fixture unavailable"}]});
        for (generation,thread,turn) in [(8,"review","turn"),(9,"other","turn"),(9,"review","stale")] {assert!(manager.isolated_tool_respond(generation,thread,turn,&request["id"],result.clone()).await.is_err());}
        manager.isolated_tool_respond(9,"review","turn",&request["id"],result.clone()).await.unwrap();
        let response:Value=serde_json::from_str(&tokio::time::timeout(Duration::from_secs(10),lines.next_line()).await.unwrap().unwrap().unwrap()).unwrap();
        assert_eq!(response,json!({"id":"wire-7","result":result}));assert_ne!(response["id"],request["params"]["callId"]);
        assert!(manager.isolated_tool_respond(9,"review","turn",&request["id"],json!({})).await.is_err());
        assert!(child.wait().await.unwrap().success());
        manager.isolate_finish(9,"review",true).await;
        assert!(manager.isolated_tool_respond(9,"review","turn",&request["id"],json!({})).await.is_err());
    }

    #[tokio::test]
    async fn git_generation_isolation_claims_before_releasing_early_events_and_preserves_user_events() {
        let manager=AppServerManager::new();let (sender,mut receiver)=mpsc::unbounded_channel();
        let mut state=manager.inner.lock().await;state.generation=2;state.private_starts.insert(7,Some(sender));
        let private=json!({"method":"thread/started","params":{"thread":{"id":"private","ephemeral":true}}});
        let user=json!({"method":"item/agentMessage/delta","params":{"threadId":"user","delta":"user text"}});
        assert!(matches!(state.route_private(&private),PrivateRoute::Held));assert!(matches!(state.route_private(&user),PrivateRoute::Held));
        assert_eq!(state.claim_private_start(7,&json!({"result":{"thread":{"id":"private"}}})),Some(Some("private".into())));
        let held=std::mem::take(&mut state.held_private_events);
        assert!(matches!(state.route_private(&held[0]),PrivateRoute::Owned {delivered:true,..}));
        assert!(matches!(state.route_private(&held[1]),PrivateRoute::Global));assert_eq!(receiver.try_recv().unwrap(),private);
        let approval=json!({"id":10,"method":"item/commandExecution/requestApproval","params":{"threadId":"private","turnId":"private-turn"}});
        assert!(matches!(state.route_private(&approval),PrivateRoute::Owned {delivered:true,..}));
        assert!(state.pending_server_requests.is_empty(),"private requests never enter global approval state");
        assert_eq!(receiver.try_recv().unwrap(),approval);
    }

    #[tokio::test]
    async fn git_generation_isolation_tombstones_hide_late_events_and_old_cleanup_cannot_touch_new_generation() {
        let manager=AppServerManager::new();
        {
            let mut state=manager.inner.lock().await;state.generation=2;state.private_starts.insert(7,None);
            let late=json!({"method":"thread/started","params":{"thread":{"id":"private","ephemeral":true}}});
            assert!(matches!(state.route_private(&late),PrivateRoute::Owned {delivered:false,..}));
            let turn=json!({"method":"turn/started","params":{"threadId":"private","turn":{"id":"turn-private"}}});
            assert!(matches!(state.route_private(&turn),PrivateRoute::Owned {delivered:false,..}));
            assert_eq!(state.private_turns["private"],"turn-private");
            assert!(matches!(state.route_private(&json!({"method":"turn/completed","params":{"threadId":"user","turn":{"id":"user-turn"}}})),PrivateRoute::Global));
        }
        manager.isolate_finish(1,"private",true).await;
        let mut state=manager.inner.lock().await;assert!(state.private_threads.contains_key("private"));
        state.close_generation(2);assert!(state.private_threads.is_empty());assert!(state.private_starts.is_empty());assert!(state.private_turns.is_empty());
    }

    #[tokio::test]
    async fn git_generation_isolation_malformed_start_does_not_release_private_metadata() {
        let manager=AppServerManager::new();let (sender,_receiver)=mpsc::unbounded_channel();let mut state=manager.inner.lock().await;
        state.private_starts.insert(9,Some(sender));let event=json!({"method":"thread/started","params":{"thread":{"id":"created-before-error","ephemeral":true}}});
        assert!(matches!(state.route_private(&event),PrivateRoute::Held));
        assert_eq!(state.claim_private_start(9,&json!({"error":{"message":"malformed fixture"}})),Some(None));
        assert!(matches!(state.route_private(&event),PrivateRoute::Owned {delivered:false,..}));
    }

    #[tokio::test]
    async fn git_generation_dropped_request_removes_pending_and_retires_closed_private_receivers() {
        let manager=AppServerManager::new();let (sender,receiver)=mpsc::unbounded_channel();drop(receiver);let (tx,_rx)=oneshot::channel();
        {let mut state=manager.inner.lock().await;state.generation=2;state.pending_requests.insert(7,tx);state.private_starts.insert(7,Some(sender.clone()));state.private_threads.insert("orphan".into(),Some(sender));}
        drop(IsolatedPendingCleanup{inner:manager.inner.clone(),generation:2,id:7,replay:None});
        loop {if !manager.inner.lock().await.pending_requests.contains_key(&7) {break;}tokio::task::yield_now().await;}
        let state=manager.inner.lock().await;assert!(state.private_starts[&7].is_none());assert!(state.private_threads["orphan"].is_none());
    }

    #[tokio::test]
    async fn git_generation_old_request_drop_cannot_remove_new_generation_pending_calls() {
        let manager=AppServerManager::new();let (tx,_rx)=oneshot::channel();
        {let mut state=manager.inner.lock().await;state.generation=3;state.pending_requests.insert(7,tx);}
        drop(IsolatedPendingCleanup{inner:manager.inner.clone(),generation:2,id:7,replay:None});tokio::task::yield_now().await;
        assert!(manager.inner.lock().await.pending_requests.contains_key(&7));
    }

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
            notification_nonce: "original-instance".into(),
        }
    }

    #[test]
    fn notification_response_nonce_rejects_reused_id_before_writing() {
        let mut pending = approvals();
        assert!(validate_notification_nonce(&pending, &json!(7), Some("original-instance")).is_ok());
        pending.get_mut(&server_request_key(&json!(7))).unwrap().notification_nonce = "new-instance".into();
        assert!(validate_notification_nonce(&pending, &json!(7), Some("original-instance")).is_err());
        assert!(validate_notification_nonce(&pending, &json!(7), Some("new-instance")).is_ok());
        assert!(validate_notification_nonce(&pending, &json!("missing"), Some("original-instance")).is_err());
        assert_eq!(pending.len(), 2);
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

    #[tokio::test]
    async fn schedule_approval_expires_with_its_turn_or_account() {
        let manager = AppServerManager::new();
        let mut state = manager.inner.lock().await;
        let turn = |thread, id| json!({"threadId":thread,"turn":{"id":id}});
        state.update_schedule_turns("turn/started", &turn("chat", "a"));
        let request = PendingServerRequest {
            id: json!("approve"), method: crate::automation_tool::APPROVAL_METHOD.into(),
            params: json!({"threadId":"chat","turnId":"a"}), generation: 0,
            response_delivery_unknown: false, notification_nonce: "fixture".into(),
        };
        assert!(state.schedule_turn_is_active(&request.params));
        state.pending_server_requests.insert(server_request_key(&request.id), request.clone());
        assert!(state.update_schedule_turns("turn/completed", &turn("chat", "other")).is_empty());
        assert_eq!(state.update_schedule_turns("turn/started", &turn("chat", "b")).len(), 1);
        assert!(!state.schedule_turn_is_active(&request.params));
        let mut request = request;
        request.params["turnId"] = json!("b");
        state.pending_server_requests.insert(server_request_key(&request.id), request.clone());
        assert_eq!(state.update_schedule_turns("account/updated", &Value::Null).len(), 1);
        assert!(!state.schedule_turn_is_active(&request.params));
    }

