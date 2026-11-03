//! Isolated, read-only ephemeral turns for Git form text; never stages, commits or creates PRs.
use crate::app_server::AppServerManager;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::{mpsc, Notify};

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GenerationMode {
    Commit,
    PullRequest,
    Combined,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationRequest {
    pub operation_id: String,
    pub cwd: String,
    pub mode: GenerationMode,
    pub prompt: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResponse {
    pub operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}
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
    async fn wait_cancelled(&self) {
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return;
            }
            self.notify.notified().await;
        }
    }
}
#[derive(Default)]
pub struct GenerationState {
    operations: Mutex<HashMap<String, Arc<Operation>>>,
    pre_cancelled: Mutex<VecDeque<(String, String)>>,
    finished: Mutex<VecDeque<(String, String)>>,
}
impl GenerationState {
    fn register(&self, owner: &str, id: &str) -> Result<Arc<Operation>, String> {
        if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
            return Err("Invalid generation operation ID".into());
        }
        let mut operations = self
            .operations
            .lock()
            .map_err(|_| "Generation state is unavailable")?;
        if operations.contains_key(id) {
            return Err("This generation is already running".into());
        }
        if self
            .finished
            .lock()
            .map_err(|_| "Generation state is unavailable")?
            .iter()
            .any(|(_, operation)| operation == id)
        {
            return Err(
                "This generation operation has already finished; use a new operation ID".into(),
            );
        }
        let cancelled = self
            .pre_cancelled
            .lock()
            .map_err(|_| "Generation state is unavailable")?;
        if cancelled
            .iter()
            .any(|(window, operation)| window == owner && operation == id)
        {
            return Err("Git message generation cancelled".into());
        }
        let operation = Arc::new(Operation {
            owner: owner.into(),
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        });
        operations.insert(id.into(), operation.clone());
        Ok(operation)
    }
    pub fn cancel(&self, owner: &str, id: &str) -> Result<bool, String> {
        if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
            return Err("Invalid generation operation ID".into());
        }
        let operations = self
            .operations
            .lock()
            .map_err(|_| "Generation state is unavailable")?;
        if let Some(operation) = operations.get(id) {
            if operation.owner != owner {
                return Err("Generation belongs to another window".into());
            }
            operation.cancel();
            return Ok(true);
        }
        let mut pending = self
            .pre_cancelled
            .lock()
            .map_err(|_| "Generation state is unavailable")?;
        if !pending
            .iter()
            .any(|(window, operation)| window == owner && operation == id)
        {
            pending.push_back((owner.into(), id.into()));
        }
        while pending.len() > 128 {
            pending.pop_front();
        }
        Ok(false)
    }
    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(operations) = self.operations.lock() {
            for operation in operations
                .values()
                .filter(|operation| operation.owner == owner)
            {
                operation.cancel();
            }
        }
    }
}
struct Registration<'a> {
    state: &'a GenerationState,
    id: String,
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.state.operations.lock() {
            if let Some(operation) = operations.remove(&self.id) {
                if let Ok(mut finished) = self.state.finished.lock() {
                    finished.push_back((operation.owner.clone(), self.id.clone()));
                    while finished.len() > 128 {
                        finished.pop_front();
                    }
                }
            }
        }
    }
}

type CallFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
trait GenerationClient: Send + Sync {
    fn call(&self, method: &'static str, params: Value) -> CallFuture<'_, Value>;
    fn start(&self, params: Value) -> CallFuture<'_, (Value, mpsc::UnboundedReceiver<Value>)>;
    fn finish(&self, thread: String, interrupt: bool) -> CallFuture<'_, ()>;
    fn check_current(&self) -> CallFuture<'_, ()>;
}
struct ManagerClient<'a> {
    manager: &'a AppServerManager,
    app: &'a AppHandle,
    generation: u64,
}
impl GenerationClient for ManagerClient<'_> {
    fn call(&self, method: &'static str, params: Value) -> CallFuture<'_, Value> {
        Box::pin(self.manager.isolated_call(self.generation, method, params))
    }
    fn start(&self, params: Value) -> CallFuture<'_, (Value, mpsc::UnboundedReceiver<Value>)> {
        Box::pin(
            self.manager
                .isolated_start(self.app, self.generation, params),
        )
    }
    fn finish(&self, thread: String, interrupt: bool) -> CallFuture<'_, ()> {
        Box::pin(async move {
            self.manager
                .isolate_finish(self.generation, &thread, interrupt)
                .await;
            Ok(())
        })
    }
    fn check_current(&self) -> CallFuture<'_, ()> {
        Box::pin(self.manager.require_generation(self.generation))
    }
}

pub async fn generate(
    state: &GenerationState,
    manager: &AppServerManager,
    app: &AppHandle,
    owner: &str,
    request: GenerationRequest,
) -> Result<GenerationResponse, String> {
    if !std::path::Path::new(&request.cwd).is_absolute()
        || !std::path::Path::new(&request.cwd).is_dir()
    {
        return Err("Generation requires an existing absolute workspace directory".into());
    }
    let operation = state.register(owner, &request.operation_id)?;
    let _registration = Registration {
        state,
        id: request.operation_id.clone(),
    };
    if request.prompt.trim().is_empty() {
        return Err("No Git context to generate from".into());
    }
    let connect = manager.ensure_connected(app);
    tokio::select! {_=operation.wait_cancelled()=>return Err("Git message generation cancelled".into()), result=connect=>{result?;}}
    let client = ManagerClient {
        manager,
        app,
        generation: manager.connection_generation().await,
    };
    generate_with(&client, &operation, request, None).await
}

async fn generate_with<C: GenerationClient>(
    client: &C,
    operation: &Operation,
    request: GenerationRequest,
    timeout: Option<Duration>,
) -> Result<GenerationResponse, String> {
    if operation.cancelled.load(Ordering::SeqCst) {
        return Err("Git message generation cancelled".into());
    }
    let thread = Arc::new(Mutex::new(None::<String>));
    let run = run_generation(client, operation, &request, thread.clone());
    let duration = timeout.unwrap_or(Duration::from_secs(
        if request.mode == GenerationMode::Commit {
            30
        } else {
            45
        },
    ));
    let result = tokio::select! {
        _=operation.wait_cancelled()=>Err("Git message generation cancelled".into()),
        result=tokio::time::timeout(duration,run)=>result.unwrap_or_else(|_|Err("Git message generation timed out".into())),
    };
    let created = thread
        .lock()
        .map_err(|_| "Generation state is unavailable")?
        .clone();
    if let Some(thread) = created {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            client.finish(thread, result.is_err()),
        )
        .await;
    }
    if operation.cancelled.load(Ordering::SeqCst) {
        return Err("Git message generation cancelled".into());
    }
    if result.is_ok() {
        client.check_current().await?;
    }
    result
}

async fn choose_model<C: GenerationClient>(
    client: &C,
    cwd: &str,
) -> Result<(String, Option<String>), String> {
    let config = client
        .call("config/read", json!({"cwd":cwd,"includeLayers":false}))
        .await?;
    let provider = config
        .pointer("/config/model_provider")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let configured = config
        .pointer("/config/model")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    // The fixed Store seed is only used if the actual runtime advertises it. Custom providers keep their actual configured model.
    if provider
        .as_deref()
        .is_some_and(|provider| provider != "openai")
    {
        return configured
            .map(|model| (model, provider))
            .ok_or_else(|| "The configured provider has no generation model".into());
    }
    let mut cursor = Value::Null;
    let mut seen = std::collections::HashSet::new();
    let mut models = Vec::new();
    loop {
        let response = match client
            .call("model/list", json!({"cursor":cursor,"includeHidden":true}))
            .await
        {
            Ok(response) => response,
            Err(error) => return configured.map(|model| (model, provider)).ok_or(error),
        };
        let rows = response
            .get("data")
            .and_then(Value::as_array)
            .ok_or("Model catalog is invalid")?;
        models.extend(rows.iter().cloned());
        match response.get("nextCursor") {
            None | Some(Value::Null) => break,
            Some(Value::String(next)) if !next.is_empty() && seen.insert(next.clone()) => {
                cursor = Value::String(next.clone())
            }
            _ => return Err("Model catalog pagination is invalid".into()),
        }
    }
    let supported = |row: &&Value| {
        row.get("hidden") != Some(&Value::Bool(true))
            && row.get("modelSpecialty").is_none_or(Value::is_null)
            && row
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .is_some_and(|efforts| {
                    efforts
                        .iter()
                        .any(|effort| effort["reasoningEffort"] == "low")
                })
    };
    let candidates: Vec<_> = models.iter().filter(supported).collect();
    let selected = models
        .iter()
        .find(|row| row["model"] == "gpt-6-luna")
        .or_else(|| {
            candidates
                .iter()
                .find(|row| row["isDefault"] == true)
                .copied()
        })
        .or_else(|| candidates.first().copied());
    selected
        .and_then(|row| row.get("model"))
        .and_then(Value::as_str)
        .filter(|model| !model.is_empty())
        .map(|model| (model.to_owned(), provider))
        .ok_or_else(|| "No runtime model supports the required generation reasoning effort".into())
}

async fn run_generation<C: GenerationClient>(
    client: &C,
    operation: &Operation,
    request: &GenerationRequest,
    created: Arc<Mutex<Option<String>>>,
) -> Result<GenerationResponse, String> {
    let (model, provider) = choose_model(client, &request.cwd).await?;
    if operation.cancelled.load(Ordering::SeqCst) {
        return Err("Git message generation cancelled".into());
    }
    let source = match request.mode {
        GenerationMode::Commit => "commit_message",
        GenerationMode::PullRequest => "pull_request_message",
        GenerationMode::Combined => "commit_pull_request_message",
    };
    // Both pinned protocol schemas support this legacy read-only policy; never mix it with named permissions.
    let (started,mut events)=client.start(json!({"model":model,"modelProvider":provider,"cwd":request.cwd,"ephemeral":true,
        "approvalPolicy":"never","sandbox":"read-only","serviceTier":null,"personality":null,"threadSource":source,"experimentalRawEvents":false,"dynamicTools":null,
        "config":{"mcp_servers.codex_app":{"enabled":false,"command":""},"model_reasoning_effort":"low","features.enable_fanout":false,"features.multi_agent":false,"features.multi_agent_v2":false,"web_search":"disabled"}})).await?;
    let thread_id = started
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or("Temporary thread response has no ID")?
        .to_owned();
    *created
        .lock()
        .map_err(|_| "Generation state is unavailable")? = Some(thread_id.clone());
    if operation.cancelled.load(Ordering::SeqCst) {
        return Err("Git message generation cancelled".into());
    }
    let mut starting=client.call("turn/start",json!({"threadId":thread_id,"input":[{"type":"text","text":build_prompt(request.mode,&request.prompt),"text_elements":[]}],
        "approvalPolicy":"never","sandboxPolicy":{"type":"readOnly"},"effort":"low","serviceTier":null,"outputSchema":output_schema(request.mode)}));
    let mut start_returned = false;
    let mut turn_id: Option<String> = None;
    let mut queued = VecDeque::new();
    let mut transcript = Transcript::default();
    loop {
        if operation.cancelled.load(Ordering::SeqCst) {
            return Err("Git message generation cancelled".into());
        }
        tokio::select! {
            response=&mut starting,if !start_returned=>{
                let response=response?;
                let id=response.pointer("/turn/id").and_then(Value::as_str).filter(|id|!id.is_empty()).ok_or("Temporary turn response has no ID")?;
                if turn_id.as_deref().is_some_and(|known|known!=id) {return Err("Temporary turn response does not match its notification stream".into());}
                turn_id=Some(id.to_owned());start_returned=true;
            },
            event=events.recv()=>{
                let event=event.ok_or("Temporary generation connection closed before completion")?;
                if event.pointer("/params/threadId").and_then(Value::as_str)==Some(thread_id.as_str()) {
                    if event.get("id").is_some() {return Err("Temporary generation requested a tool or approval; it was refused".into());}
                    if turn_id.is_none() && matches!(event["method"].as_str(),Some("turn/started"|"turn/completed"|"error")) {
                        turn_id=event.pointer("/params/turn/id").or_else(||event.pointer("/params/turnId")).and_then(Value::as_str).filter(|id|!id.is_empty()).map(str::to_owned);
                    }
                }
                queued.push_back(event);
            },
        }
        if let Some(turn_id) = turn_id.as_deref() {
            while let Some(event) = queued.pop_front() {
                if let Some(text) = transcript.consume(&event, &thread_id, turn_id)? {
                    client.check_current().await?;
                    return parse_result(request.mode, &request.operation_id, &text);
                }
            }
        }
    }
}

#[derive(Default)]
struct Transcript {
    text: String,
    error: bool,
}
impl Transcript {
    fn consume(
        &mut self,
        event: &Value,
        thread: &str,
        turn: &str,
    ) -> Result<Option<String>, String> {
        let params = &event["params"];
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .or_else(|| params.pointer("/thread/id").and_then(Value::as_str));
        if thread_id != Some(thread) {
            return Ok(None);
        }
        if event.get("id").is_some() {
            return Err(
                "A temporary generation requested a tool or approval; the request was refused"
                    .into(),
            );
        }
        let event_turn = params
            .get("turnId")
            .and_then(Value::as_str)
            .or_else(|| params.pointer("/turn/id").and_then(Value::as_str));
        if event_turn.is_some_and(|id| id != turn) {
            return Ok(None);
        }
        if matches!(
            event["method"].as_str(),
            Some(
                "error"
                    | "item/agentMessage/delta"
                    | "item/started"
                    | "item/completed"
                    | "turn/completed"
            )
        ) && event_turn != Some(turn)
        {
            return Ok(None);
        }
        match event["method"].as_str().unwrap_or("") {
            "error" => self.error = true,
            "item/agentMessage/delta" => {
                if let Some(delta) = params["delta"].as_str() {
                    self.text.push_str(delta);
                }
            }
            "item/started" | "item/completed" => {
                let kind = params
                    .pointer("/item/type")
                    .and_then(Value::as_str)
                    .ok_or("Generation emitted an invalid item")?;
                if !matches!(kind, "agentMessage" | "userMessage" | "reasoning") {
                    return Err("Tools are not allowed during Git message generation".into());
                }
                if event["method"] == "item/completed" && kind == "agentMessage" {
                    self.text = params
                        .pointer("/item/text")
                        .and_then(Value::as_str)
                        .ok_or("Generation returned invalid text")?
                        .into();
                }
            }
            "turn/completed" => {
                if self.error
                    || params.pointer("/turn/status").and_then(Value::as_str) != Some("completed")
                {
                    return Err("Git message generation failed or was interrupted".into());
                }
                return Ok(Some(self.text.clone()));
            }
            _ => {}
        }
        if self.text.len() > 256 * 1024 {
            return Err("Structured generation output exceeded its transport limit".into());
        }
        Ok(None)
    }
}

fn output_schema(mode: GenerationMode) -> Value {
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();
    if mode != GenerationMode::PullRequest {
        properties.insert("message".into(),json!({"type":"string","minLength":8,"maxLength":4000,"pattern":"^[^\\r\\n]{1,72}(?:\\r?\\n[\\s\\S]*)?$"}));
        required.push("message");
    }
    if mode != GenerationMode::Commit {
        properties.insert(
            "title".into(),
            json!({"type":"string","minLength":8,"maxLength":120}),
        );
        properties.insert(
            "body".into(),
            json!({"type":"string","minLength":12,"maxLength":30000}),
        );
        required.extend(["title", "body"]);
    }
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn parse_result(mode: GenerationMode, id: &str, text: &str) -> Result<GenerationResponse, String> {
    let value: Value = serde_json::from_str(text.trim())
        .map_err(|_| "Generation did not return valid structured JSON")?;
    let expected: &[&str] = match mode {
        GenerationMode::Commit => &["message"],
        GenerationMode::PullRequest => &["title", "body"],
        GenerationMode::Combined => &["message", "title", "body"],
    };
    let object = value
        .as_object()
        .ok_or("Generation did not return a structured object")?;
    if object.len() != expected.len() || object.keys().any(|key| !expected.contains(&key.as_str()))
    {
        return Err("Generation returned fields outside its output schema".into());
    }
    let read = |key: &str, min: usize, max: usize| -> Result<String, String> {
        let text = value
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Generation is missing {key}"))?;
        let length = text.encode_utf16().count();
        if !(min..=max).contains(&length) || text.trim().is_empty() {
            return Err(format!("Generated {key} is outside the required bounds"));
        }
        Ok(text.into())
    };
    let message = if mode != GenerationMode::PullRequest {
        let message = read("message", 8, 4000)?;
        let subject = message.split('\n').next().unwrap();
        let subject = if message.contains('\n') {
            subject.strip_suffix('\r').unwrap_or(subject)
        } else {
            subject
        };
        if subject.contains('\r') || subject.is_empty() || subject.encode_utf16().count() > 72 {
            return Err("Generated commit subject is outside the required bounds".into());
        }
        Some(message)
    } else {
        None
    };
    Ok(GenerationResponse {
        operation_id: id.into(),
        message,
        title: if mode != GenerationMode::Commit {
            let title = read("title", 8, 120)?;
            if title.contains(['\r', '\n']) {
                return Err("Generated pull request title must be a single line".into());
            }
            Some(title)
        } else {
            None
        },
        body: if mode != GenerationMode::Commit {
            Some(read("body", 12, 30000)?)
        } else {
            None
        },
    })
}
fn build_prompt(mode: GenerationMode, context: &str) -> String {
    let limit = match mode {
        GenerationMode::Commit => 20000,
        GenerationMode::PullRequest => 30000,
        GenerationMode::Combined => 40000,
    };
    let context = String::from_utf16_lossy(
        &context
            .trim()
            .encode_utf16()
            .take(limit)
            .collect::<Vec<_>>(),
    );
    format!(
        "{}{}",
        match mode {
            GenerationMode::Commit => COMMIT_PREFIX,
            GenerationMode::PullRequest => PR_PREFIX,
            GenerationMode::Combined => COMBINED_PREFIX,
        },
        context
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    struct FakeClient {
        calls: Mutex<Vec<(&'static str, Value)>>,
        events: Vec<Value>,
        sender: Mutex<Option<mpsc::UnboundedSender<Value>>>,
        hang_turn: bool,
        current: AtomicBool,
    }
    impl FakeClient {
        fn new(events: Vec<Value>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                events,
                sender: Mutex::new(None),
                hang_turn: false,
                current: AtomicBool::new(true),
            }
        }
    }
    impl GenerationClient for FakeClient {
        fn call(&self, method: &'static str, params: Value) -> CallFuture<'_, Value> {
            Box::pin(async move {
                self.calls.lock().unwrap().push((method, params));
                match method {
                    "config/read" => Ok(json!({"config":{"model":"actual-configured-model"}})),
                    "model/list" => Ok(
                        json!({"data":[{"model":"actual-catalog-model","hidden":false,"modelSpecialty":null,"isDefault":true,"supportedReasoningEfforts":[{"reasoningEffort":"low"}]}],"nextCursor":null}),
                    ),
                    "turn/start" => {
                        for event in &self.events {
                            let _ = self
                                .sender
                                .lock()
                                .unwrap()
                                .as_ref()
                                .unwrap()
                                .send(event.clone());
                        }
                        if self.hang_turn {
                            std::future::pending::<()>().await;
                        }
                        Ok(json!({"turn":{"id":"turn-private"}}))
                    }
                    _ => Err("Unexpected generation RPC".into()),
                }
            })
        }
        fn start(&self, params: Value) -> CallFuture<'_, (Value, mpsc::UnboundedReceiver<Value>)> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(("thread/start", params));
                let (sender, receiver) = mpsc::unbounded_channel();
                *self.sender.lock().unwrap() = Some(sender);
                Ok((
                    json!({"thread":{"id":"thread-private","ephemeral":true}}),
                    receiver,
                ))
            })
        }
        fn finish(&self, thread: String, interrupt: bool) -> CallFuture<'_, ()> {
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push(("cleanup", json!({"threadId":thread,"interrupt":interrupt})));
                self.sender.lock().unwrap().take();
                Ok(())
            })
        }
        fn check_current(&self) -> CallFuture<'_, ()> {
            Box::pin(async {
                if self.current.load(Ordering::SeqCst) {
                    Ok(())
                } else {
                    Err("Connection generation changed".into())
                }
            })
        }
    }
    fn operation() -> Operation {
        Operation {
            owner: "main".into(),
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
    fn request(mode: GenerationMode) -> GenerationRequest {
        GenerationRequest {
            operation_id: "operation-private".into(),
            cwd: "fixture".into(),
            mode,
            prompt: "real supplied Git context".into(),
        }
    }
    fn event(method: &str, params: Value) -> Value {
        json!({"method":method,"params":params})
    }
    fn result_events(text: &str, status: &str) -> Vec<Value> {
        vec![
            event(
                "turn/started",
                json!({"threadId":"thread-private","turn":{"id":"turn-private"}}),
            ),
            event(
                "item/agentMessage/delta",
                json!({"threadId":"thread-private","turnId":"turn-private","delta":"partial"}),
            ),
            event(
                "item/completed",
                json!({"threadId":"thread-private","turnId":"turn-private","item":{"type":"agentMessage","text":text}}),
            ),
            event(
                "turn/completed",
                json!({"threadId":"thread-private","turn":{"id":"turn-private","status":status}}),
            ),
        ]
    }

    #[tokio::test]
    async fn git_generation_real_pipeline_uses_runtime_model_read_only_ephemeral_and_schema() {
        for (mode, text) in [
            (
                GenerationMode::Commit,
                r#"{"message":"Preserve user drafts"}"#,
            ),
            (
                GenerationMode::PullRequest,
                r#"{"title":"Preserve user drafts","body":"Summary\nKeep user edits\n\nTesting\nNot run"}"#,
            ),
            (
                GenerationMode::Combined,
                r#"{"message":"Preserve user drafts","title":"Preserve user drafts","body":"Summary\nKeep user edits\n\nTesting\nNot run"}"#,
            ),
        ] {
            let client = FakeClient::new(result_events(text, "completed"));
            let result = generate_with(&client, &operation(), request(mode), None)
                .await
                .unwrap();
            assert_eq!(result.operation_id, "operation-private");
            let calls = client.calls.lock().unwrap();
            assert_eq!(calls.len(), 5);
            let start = &calls[2].1;
            assert_eq!(calls[2].0, "thread/start");
            assert_eq!(start["model"], "actual-catalog-model");
            assert_eq!(start["ephemeral"], true);
            assert_eq!(start["approvalPolicy"], "never");
            assert_eq!(start["sandbox"], "read-only");
            assert!(start.get("permissions").is_none());
            assert!(start["serviceTier"].is_null());
            assert_eq!(start["config"]["features.multi_agent"], false);
            assert_eq!(start["config"]["features.enable_fanout"], false);
            assert_eq!(start["config"]["web_search"], "disabled");
            assert_eq!(start["config"]["mcp_servers.codex_app"]["enabled"], false);
            let turn = &calls[3].1;
            assert_eq!(calls[3].0, "turn/start");
            assert_eq!(turn["sandboxPolicy"]["type"], "readOnly");
            assert!(turn.get("permissions").is_none());
            assert!(turn["outputSchema"]["required"].as_array().unwrap().len() >= 1);
            assert!(turn["input"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Make 0 tool calls."));
            assert_eq!(calls[4].1["interrupt"], false);
            assert!(client.sender.lock().unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn git_generation_completed_before_start_response_and_other_thread_events_do_not_mix() {
        let mut events = vec![
            event(
                "item/completed",
                json!({"threadId":"another-thread","turnId":"turn-private","item":{"type":"agentMessage","text":"not JSON"}}),
            ),
            event(
                "item/completed",
                json!({"threadId":"thread-private","turnId":"another-turn","item":{"type":"agentMessage","text":"not JSON"}}),
            ),
        ];
        events.extend(result_events(
            r#"{"message":"Preserve final response"}"#,
            "completed",
        ));
        let client = FakeClient::new(events);
        let result = generate_with(&client, &operation(), request(GenerationMode::Commit), None)
            .await
            .unwrap();
        assert_eq!(result.message.as_deref(), Some("Preserve final response"));
        let mut delayed = FakeClient::new(result_events(
            r#"{"message":"Finish before delayed response"}"#,
            "completed",
        ));
        delayed.hang_turn = true;
        let result = generate_with(
            &delayed,
            &operation(),
            request(GenerationMode::Commit),
            Some(Duration::from_millis(30)),
        )
        .await
        .unwrap();
        assert_eq!(
            result.message.as_deref(),
            Some("Finish before delayed response"),
            "completed notification must win even when turn/start response never arrives"
        );
        assert_eq!(
            delayed.calls.lock().unwrap().last().unwrap().1["interrupt"],
            false
        );
        // The fake queues all notifications before returning turn/start: final replaces delta exactly once.
        assert_eq!(
            client
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(method, _)| *method == "turn/start")
                .count(),
            1
        );
        let client = FakeClient::new(result_events(
            r#"{"message":"Old generation output"}"#,
            "completed",
        ));
        client.current.store(false, Ordering::SeqCst);
        assert!(
            generate_with(&client, &operation(), request(GenerationMode::Commit), None)
                .await
                .is_err(),
            "queued completed cannot succeed after a connection change"
        );
    }

    #[tokio::test]
    async fn git_generation_failed_interrupted_error_and_tool_requests_never_become_success() {
        for events in [
            result_events(r#"{"message":"Valid output text"}"#, "failed"),
            result_events(r#"{"message":"Valid output text"}"#, "interrupted"),
            {
                let mut events = vec![event(
                    "error",
                    json!({"threadId":"thread-private","turnId":"turn-private","error":{"message":"failed"}}),
                )];
                events.extend(result_events(
                    r#"{"message":"Valid output text"}"#,
                    "completed",
                ));
                events
            },
            vec![event(
                "item/started",
                json!({"threadId":"thread-private","turnId":"turn-private","item":{"type":"commandExecution"}}),
            )],
            vec![
                json!({"id":99,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-private","turnId":"turn-private"}}),
            ],
            result_events("", "completed"),
            result_events("not JSON", "completed"),
            result_events(r#"{"message":"short"}"#, "completed"),
        ] {
            let client = FakeClient::new(events);
            assert!(
                generate_with(&client, &operation(), request(GenerationMode::Commit), None)
                    .await
                    .is_err()
            );
            assert_eq!(
                client.calls.lock().unwrap().last().unwrap().1["interrupt"],
                true
            );
            assert!(client.sender.lock().unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn git_generation_cancel_and_timeout_cleanup_without_restarting_a_turn() {
        let client = FakeClient::new(vec![]);
        let op = operation();
        op.cancel();
        assert!(
            generate_with(&client, &op, request(GenerationMode::Commit), None)
                .await
                .is_err()
        );
        assert!(client.calls.lock().unwrap().is_empty());
        for cancel in [false, true] {
            let mut client = FakeClient::new(vec![]);
            client.hang_turn = true;
            let op = operation();
            let generate = generate_with(
                &client,
                &op,
                request(GenerationMode::Commit),
                Some(Duration::from_millis(30)),
            );
            let trigger = async {
                if cancel {
                    while !client
                        .calls
                        .lock()
                        .unwrap()
                        .iter()
                        .any(|(method, _)| *method == "turn/start")
                    {
                        tokio::task::yield_now().await;
                    }
                    op.cancel();
                }
            };
            assert!(tokio::join!(generate, trigger).0.is_err());
            let calls = client.calls.lock().unwrap();
            assert_eq!(
                calls
                    .iter()
                    .filter(|(method, _)| *method == "turn/start")
                    .count(),
                1
            );
            assert_eq!(calls.last().unwrap().1["interrupt"], true);
            assert!(client.sender.lock().unwrap().is_none());
        }
    }

    #[test]
    fn git_generation_owner_and_pre_cancel_do_not_allow_cross_window_or_duplicate_operations() {
        let state = GenerationState::default();
        let op = state.register("main", "owned").unwrap();
        assert!(state.register("main", "owned").is_err());
        assert!(state.cancel("other", "owned").is_err());
        assert!(!op.cancelled.load(Ordering::SeqCst));
        state.cancel_owner("main");
        assert!(op.cancelled.load(Ordering::SeqCst));
        state.cancel("main", "pre-cancelled").unwrap();
        assert!(state.register("main", "pre-cancelled").is_err());
        assert!(
            state.register("main", "pre-cancelled").is_err(),
            "cancelled IDs cannot be replayed"
        );
        drop(Registration {
            state: &state,
            id: "owned".into(),
        });
        assert!(
            state.register("main", "owned").is_err(),
            "completed IDs cannot replay a model turn"
        );
    }

    #[test]
    fn git_generation_output_bounds_and_utf16_context_limits_are_enforced() {
        assert!(parse_result(
            GenerationMode::Commit,
            "id",
            &json!({"message":"Valid subject","extra":"not allowed"}).to_string()
        )
        .is_err());
        assert!(parse_result(
            GenerationMode::PullRequest,
            "id",
            &json!({"title":"Valid\ntitle","body":"Valid body content"}).to_string()
        )
        .is_err());
        assert!(parse_result(
            GenerationMode::Combined,
            "id",
            &json!({"message":"Valid subject","title":"Valid\rtitle","body":"Valid body content"})
                .to_string()
        )
        .is_err());
        for (mode, limit, prefix) in [
            (GenerationMode::Commit, 20000, COMMIT_PREFIX),
            (GenerationMode::PullRequest, 30000, PR_PREFIX),
            (GenerationMode::Combined, 40000, COMBINED_PREFIX),
        ] {
            let prompt = build_prompt(mode, &"中".repeat(limit + 1));
            assert_eq!(prompt, format!("{prefix}{}", "中".repeat(limit)));
        }
        for value in [
            json!({"message":"a".repeat(73)}),
            json!({"message":"a".repeat(4001)}),
            json!({"message":"invalid\rsubject"}),
            json!({"message":"Valid subject\r"}),
            json!({"message":null}),
        ] {
            assert!(parse_result(GenerationMode::Commit, "id", &value.to_string()).is_err());
        }
        assert!(parse_result(
            GenerationMode::Commit,
            "id",
            &json!({"message":format!("{}\nbody","a".repeat(72))}).to_string()
        )
        .is_ok());
        assert!(parse_result(
            GenerationMode::PullRequest,
            "id",
            &json!({"title":"Valid title","body":"short"}).to_string()
        )
        .is_err());
    }

    #[test]
    fn git_generation_full_prompts_match_fixed_store_golden() {
        let golden: Value = serde_json::from_str(include_str!(
            "../../scripts/fixtures/git-message-golden.json"
        ))
        .unwrap();
        for sample in golden["hostGolden"].as_array().unwrap() {
            let mode = match sample["kind"].as_str().unwrap() {
                "commit" => GenerationMode::Commit,
                "pullRequest" => GenerationMode::PullRequest,
                "commitPullRequest" => GenerationMode::Combined,
                _ => panic!("unknown golden mode"),
            };
            assert_eq!(
                build_prompt(mode, sample["inputContext"].as_str().unwrap()),
                sample["prompt"].as_str().unwrap()
            );
        }
    }
}

// Fixed Store generation builders, evaluated only with empty synthetic context during extraction.
const COMMIT_PREFIX: &str = r###"Using the supplied git context below, generate a git commit message.
Write the result into the structured response field message.
message must contain plain commit-message text only, not JSON, field labels, or code fences.
Custom commit instructions for message content and formatting override the fallback rules below.
Make 0 tool calls.
Bounds:
- Keep the complete message under 4000 characters.
- Keep the subject under 72 characters.
Fallback rules:
- Generate a concise single-line subject.
- Use an imperative verb first.
- Do not add a scope prefix unless the context already clearly uses one.
- Do not include markdown, quotes, or trailing punctuation.

Diff context:
"###;
const PR_PREFIX: &str = r###"You are a helpful assistant. Generate a pull request title and body.
Write the result into the structured response fields title and body.
Make 0 tool calls.
If context includes pull request instructions, follow them even when they conflict with the default rules below.
Language rules:
- Match the primary language of the supplied context; default to English.
- Translate standard section headings such as Summary and Testing when writing in another language.
Fallback PR title rules:
- title must contain only the PR title, not JSON, field labels, or body content.
- Use an imperative or action-oriented phrasing first.
- Keep the title under 120 characters.
- No trailing punctuation.
Body rules:
- body must contain only the PR body, not JSON, field labels, the title, or a full PR draft.
- Do not repeat, restate, or label the title inside body.
- Keep the body concise and scannable.
- Keep the body under 30000 characters.
- Use Markdown with short bullets.
- Include a Summary section and a Testing section.
- In Testing, describe meaningful validation at a high level, such as new unit or integration tests, or local UI testing with Playwright.
- Do not paste command transcripts. For routine checks, summarize the result, for example: lint and formatting passed.
- If tests were not run, say "Not run (not requested)".
- If context includes pull request instructions, apply them to the title/body content only.

Context:
"###;
const COMBINED_PREFIX: &str = r###"Using the supplied commit and pull request contexts below, generate one git commit message plus one pull request title and body.
Write the result into the structured response fields message, title, and body.
message must contain plain commit-message text only, not JSON, field labels, or code fences.
Make 0 tool calls.
If context includes pull request instructions, follow them even when they conflict with the default pull request rules below.
Custom commit instructions for message content and formatting apply to message only and override the fallback commit message rules below.
Commit message bounds:
- Keep the complete message under 4000 characters.
- Keep the subject under 72 characters.
Fallback commit message rules:
- Generate a concise single-line subject.
- Use an imperative verb first.
- Do not add a scope prefix unless the context already clearly uses one.
- Do not include markdown, quotes, or trailing punctuation.
Pull request language rules:
- Match the primary language of the supplied context; default to English.
- Translate standard section headings such as Summary and Testing when writing in another language.
Fallback PR title rules:
- title must contain only the PR title, not JSON, field labels, or body content.
- Use an imperative or action-oriented phrasing first.
- Keep title under 120 characters.
- No trailing punctuation.
Pull request body rules:
- body must contain only the PR body, not JSON, field labels, the title, or a full PR draft.
- Do not repeat, restate, or label the title inside body.
- Keep the body concise and scannable.
- Keep the body under 30000 characters.
- Use Markdown with short bullets.
- Include a Summary section and a Testing section.
- In Testing, describe meaningful validation at a high level, such as new unit or integration tests, or local UI testing with Playwright.
- Do not paste command transcripts. For routine checks, summarize the result, for example: lint and formatting passed.
- If tests were not run, say "Not run (not requested)".
- If context includes pull request instructions, apply them to title/body only.

Commit and pull request context:
"###;
