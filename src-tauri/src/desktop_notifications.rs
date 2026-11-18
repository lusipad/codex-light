//! Windows toast identity/history adapter. Successful Show means submitted, not visible.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Clone)]
struct Record {
    payload: Value,
    source: String,
    generation: u64,
}

#[derive(Default)]
struct Registry {
    records: HashMap<String, Record>,
    hidden: HashMap<String, f64>,
    read: HashMap<(String, String), f64>,
    account: Option<String>,
    clear_pending: bool,
    generation: u64,
}
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
static OPERATION: Mutex<()> = Mutex::new(());

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}
fn account_key(app: &AppHandle) -> String {
    app.state::<crate::AppState>()
        .chatgpt_service
        .generation()
        .to_string()
}
fn native_initialized() -> bool {
    INITIALIZED.get().is_some_and(Result::is_ok)
}
fn field<'a>(payload: &'a Value, key: &str) -> &'a str {
    payload.get(key).and_then(Value::as_str).unwrap_or("")
}
fn timestamp(payload: &Value) -> f64 {
    payload
        .get("createdAt")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}
fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}
fn eligible(state: &Registry, payload: &Value) -> bool {
    if state.account.as_deref() != Some(field(payload, "accountKey")) {
        return false;
    }
    let created = timestamp(payload);
    !state
        .hidden
        .get(field(payload, "id"))
        .is_some_and(|cutoff| created <= *cutoff)
        && !state
            .read
            .get(&(
                field(payload, "hostId").into(),
                field(payload, "threadId").into(),
            ))
            .is_some_and(|cutoff| created <= *cutoff)
}

fn conversation_ids(state: &Registry, host_id: &str, thread_id: &str, cutoff: f64) -> Vec<String> {
    state
        .records
        .iter()
        .filter(|(_, record)| {
            field(&record.payload, "hostId") == host_id
                && field(&record.payload, "threadId") == thread_id
                && timestamp(&record.payload) <= cutoff
        })
        .map(|(id, _)| id.clone())
        .collect()
}

fn navigation_label(source: &str, labels: &[String]) -> Option<String> {
    if source != "quick-chat" && labels.iter().any(|label| label == source) {
        return Some(source.into());
    }
    if labels.iter().any(|label| label == "main") {
        return Some("main".into());
    }
    labels
        .iter()
        .filter(|label| label.as_str() != "quick-chat")
        .min()
        .cloned()
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::{c_char, CStr, CString};
    unsafe extern "C" {
        fn codex_notification_call(input: *const c_char) -> *mut c_char;
        fn codex_notification_free(value: *mut c_char);
        fn codex_notification_callback(callback: extern "C" fn(*const c_char));
    }
    extern "C" fn event(input: *const c_char) {
        // Never unwind into Windows/COM callbacks.
        let _ = std::panic::catch_unwind(|| {
            if input.is_null() {
                return;
            }
            let bytes = unsafe { CStr::from_ptr(input) }.to_bytes();
            let Ok(mut event) = serde_json::from_slice::<Value>(bytes) else {
                return;
            };
            let Some(app) = APP.get() else {
                return;
            };
            let live_account = account_key(app);
            let record = {
                let Ok(state) = registry().lock() else {
                    return;
                };
                let Some(record) = state.records.get(field(&event, "id")) else {
                    return;
                };
                if event.get("generation").and_then(Value::as_u64) != Some(record.generation)
                    || field(&record.payload, "accountKey") != live_account
                    || !eligible(&state, &record.payload)
                {
                    return;
                }
                record.clone()
            };
            // UserCanceled/ApplicationHidden remove the history entry; TimedOut
            // only ends the banner and must retain its Action Center callback.
            let release = field(&event, "kind") == "failed"
                || (field(&event, "kind") == "dismissed"
                    && event
                        .get("reason")
                        .and_then(Value::as_u64)
                        .is_some_and(|reason| reason != 2));
            if release {
                if let Ok(mut state) = registry().lock() {
                    let id = field(&record.payload, "id");
                    if state
                        .records
                        .get(id)
                        .is_some_and(|current| current.generation == record.generation)
                    {
                        state.records.remove(id);
                    }
                }
            }
            let Some(app) = APP.get() else {
                return;
            };
            let windows = app.webview_windows();
            let labels: Vec<_> = windows.keys().cloned().collect();
            let Some(label) = navigation_label(&record.source, &labels) else {
                eprintln!("Notification activation has no normal navigation window; quick-chat is excluded");
                return;
            };
            let Some(window) = windows.get(&label) else {
                return;
            };
            event["sourceWindow"] = json!(record.source);
            if field(&event, "kind") == "activated" {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = window.emit("desktop-notification-event", event);
        });
    }
    pub fn call(request: Value) -> Result<Value, String> {
        let bytes = CString::new(request.to_string()).map_err(|error| error.to_string())?;
        let output = unsafe { codex_notification_call(bytes.as_ptr()) };
        if output.is_null() {
            return Err("原生通知返回空结果".into());
        }
        let result = serde_json::from_slice(unsafe { CStr::from_ptr(output) }.to_bytes());
        unsafe {
            codex_notification_free(output);
        }
        let result: Value = result.map_err(|error| format!("无法解析原生通知结果：{error}"))?;
        if result.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(field(&result, "error").to_string());
        }
        Ok(result)
    }
    pub fn initialize(app: &AppHandle) -> Result<(), String> {
        APP.get_or_init(|| app.clone());
        INITIALIZED.get_or_init(|| {
            let roaming = std::env::var_os("APPDATA").ok_or("无法定位 Windows 开始菜单")?;
            let directory = std::path::PathBuf::from(roaming).join("Microsoft/Windows/Start Menu/Programs");
            std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            unsafe { codex_notification_callback(event); }
            call(json!({"command":"initialize", "appId":app.config().identifier,
                "executable":executable, "shortcut":directory.join("Codex Light Notifications.lnk")})).map(|_| ())
        }).clone()
    }
}
#[cfg(not(target_os = "windows"))]
mod platform {
    use super::*;
    pub fn initialize(_: &AppHandle) -> Result<(), String> {
        Err("此通知适配器仅支持 Windows".into())
    }
    pub fn call(_: Value) -> Result<Value, String> {
        Err("此通知适配器仅支持 Windows".into())
    }
}

fn validate(payload: &Value) -> Result<(), String> {
    for key in ["id", "hostId", "threadId", "title", "accountKey"] {
        if field(payload, key).is_empty() || field(payload, key).len() > 2048 {
            return Err(format!("通知字段 {key} 无效"));
        }
    }
    if !payload.get("body").is_some_and(Value::is_string)
        || field(payload, "body").len() > 16384
        || !payload
            .get("createdAt")
            .and_then(Value::as_f64)
            .is_some_and(|value| value.is_finite() && value > 0.0)
    {
        return Err("通知正文或创建时间无效".into());
    }
    if let Some(actions) = payload.get("actions") {
        let actions = actions.as_array().ok_or("通知动作必须为数组")?;
        if actions.len() > 4
            || actions.iter().any(|action| {
                !matches!(
                    field(action, "id"),
                    "approve" | "approve-for-session" | "decline"
                ) || field(action, "title").is_empty()
            })
        {
            return Err("通知动作无效".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_notification_show(
    window: WebviewWindow,
    mut payload: Value,
) -> Result<Value, String> {
    validate(&payload)?;
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    let current_account = account_key(window.app_handle());
    if field(&payload, "accountKey") != current_account {
        return Ok(json!({"ok":true,"status":"suppressed","id":field(&payload,"id")}));
    }
    reset_context_locked(&current_account)?;
    platform::initialize(window.app_handle())?;
    let id = field(&payload, "id").to_string();
    let generation = {
        let mut state = registry().lock().map_err(|_| "通知登记锁失效")?;
        if !eligible(&state, &payload) {
            return Ok(json!({"ok":true,"status":"suppressed","id":id}));
        }
        state.generation += 1;
        let generation = state.generation;
        payload["_nativeGeneration"] = json!(generation);
        state.records.insert(
            id.clone(),
            Record {
                payload: payload.clone(),
                source: window.label().into(),
                generation,
            },
        );
        generation
    };
    let result = platform::call(json!({"command":"show","payload":payload}));
    if !result
        .as_ref()
        .is_ok_and(|value| field(value, "status") == "submitted")
    {
        if let Ok(mut state) = registry().lock() {
            if state
                .records
                .get(&id)
                .is_some_and(|record| record.generation == generation)
            {
                state.records.remove(&id);
            }
        }
    }
    result
}

#[tauri::command]
pub fn desktop_notification_hide(app: AppHandle, id: String) -> Result<Value, String> {
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    reset_context_locked(&account_key(&app))?;
    {
        let mut state = registry().lock().map_err(|_| "通知登记锁失效")?;
        let cutoff = state
            .records
            .get(&id)
            .map(|record| timestamp(&record.payload))
            .unwrap_or_else(now);
        state
            .hidden
            .entry(id.clone())
            .and_modify(|value| *value = value.max(cutoff))
            .or_insert(cutoff);
    }
    if !native_initialized() {
        return Ok(json!({"ok":true,"status":"tombstoned"}));
    }
    let result = platform::call(json!({"command":"hide","id":id}))?;
    registry()
        .lock()
        .map_err(|_| "通知登记锁失效")?
        .records
        .remove(&id);
    Ok(result)
}

#[tauri::command]
pub fn desktop_notification_hide_conversation(
    app: AppHandle,
    host_id: String,
    thread_id: String,
    message_created_at_or_before: Option<f64>,
) -> Result<Value, String> {
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    reset_context_locked(&account_key(&app))?;
    let cutoff = message_created_at_or_before.unwrap_or_else(now);
    if !cutoff.is_finite() || cutoff < 0.0 {
        return Err("通知撤回时间无效".into());
    }
    let ids = {
        let mut state = registry().lock().map_err(|_| "通知登记锁失效")?;
        state
            .read
            .entry((host_id.clone(), thread_id.clone()))
            .and_modify(|value| *value = value.max(cutoff))
            .or_insert(cutoff);
        conversation_ids(&state, &host_id, &thread_id, cutoff)
    };
    if !native_initialized() {
        return Ok(json!({"ok":true,"status":"tombstoned","count":0}));
    }
    for id in &ids {
        platform::call(json!({"command":"hide","id":id}))?;
        registry()
            .lock()
            .map_err(|_| "通知登记锁失效")?
            .records
            .remove(id);
    }
    Ok(json!({"ok":true,"status":"removed","count":ids.len()}))
}

#[tauri::command]
pub fn desktop_notification_hide_all(app: AppHandle) -> Result<Value, String> {
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    reset_context_locked(&account_key(&app))?;
    let ids = {
        let mut state = registry().lock().map_err(|_| "通知登记锁失效")?;
        for (id, cutoff) in state
            .records
            .iter()
            .map(|(id, record)| (id.clone(), timestamp(&record.payload)))
            .collect::<Vec<_>>()
        {
            state
                .hidden
                .entry(id)
                .and_modify(|value| *value = value.max(cutoff))
                .or_insert(cutoff);
        }
        state.records.keys().cloned().collect::<Vec<_>>()
    };
    if !native_initialized() {
        return Ok(json!({"ok":true,"status":"removed","count":0}));
    }
    platform::call(json!({"command":"hide_all"}))?;
    registry()
        .lock()
        .map_err(|_| "通知登记锁失效")?
        .records
        .clear();
    Ok(json!({"ok":true,"status":"removed","count":ids.len()}))
}

fn reset_context_locked(account_key: &str) -> Result<Value, String> {
    {
        let mut state = registry().lock().map_err(|_| "通知登记锁失效")?;
        if state.account.as_deref() == Some(account_key) && !state.clear_pending {
            return Ok(json!({"ok":true,"status":"unchanged"}));
        }
        // Invalidate callbacks before touching Windows. If history removal fails,
        // stale actions remain suppressed and the real error propagates.
        if state.account.as_deref() != Some(account_key) {
            state.account = Some(account_key.into());
            state.records.clear();
            state.hidden.clear();
            state.read.clear();
        }
        state.clear_pending = true;
    }
    let result = if native_initialized() {
        platform::call(json!({"command":"hide_all"}))?
    } else {
        json!({"ok":true,"status":"invalidated"})
    };
    registry()
        .lock()
        .map_err(|_| "通知登记锁失效")?
        .clear_pending = false;
    Ok(result)
}

pub fn invalidate_context(app: &AppHandle, _new_generation: &str) -> Result<Value, String> {
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    reset_context_locked(&account_key(app))
}

#[tauri::command]
pub fn notification_account_context(app: AppHandle) -> Result<Value, String> {
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    let key = account_key(&app);
    reset_context_locked(&key)?;
    Ok(json!({"accountKey":key}))
}

#[tauri::command]
pub fn notification_permission_read(app: AppHandle) -> Result<Value, String> {
    let _operation = OPERATION.lock().map_err(|_| "通知操作锁失效")?;
    Ok(
        platform::call(json!({"command":"permission","appId":app.config().identifier}))
            .unwrap_or_else(|error| json!({"status":"unknown","error":error})),
    )
}

#[tauri::command]
pub fn notification_settings_open() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let child = std::process::Command::new("explorer.exe")
            .arg("ms-settings:notifications")
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| error.to_string())?;
        drop(child);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("此设置入口仅支持 Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payload(id: &str, at: f64) -> Value {
        json!({"id":id,"hostId":"local","threadId":"thread","title":"完成","body":"","createdAt":at,"accountKey":"current"})
    }
    #[test]
    fn resolved_and_read_tombstones_reject_late_delivery_and_preserve_newer() {
        let mut state = Registry::default();
        state.account = Some("current".into());
        state.hidden.insert("request".into(), 20.0);
        assert!(!eligible(&state, &payload("request", 19.0)));
        assert!(eligible(&state, &payload("request", 21.0)));
        state.read.insert(("local".into(), "thread".into()), 30.0);
        assert!(!eligible(&state, &payload("other", 29.0)));
        assert!(eligible(&state, &payload("other", 31.0)));
    }
    #[test]
    fn account_switch_rejects_old_queued_payload() {
        let mut state = Registry::default();
        state.account = Some("new".into());
        assert!(!eligible(&state, &payload("old", 10.0)));
        let mut new = payload("new", 10.0);
        new["accountKey"] = json!("new");
        assert!(eligible(&state, &new));
    }
    #[test]
    fn actions_are_known_intents_and_not_executable_routes() {
        let mut value = payload("one", 10.0);
        assert!(validate(&value).is_ok());
        value["actions"] = json!([{"id":"shell:run","title":"执行"}]);
        assert!(validate(&value).is_err());
        value["actions"] = json!([{"id":"decline","title":"拒绝"}]);
        assert!(validate(&value).is_ok());
    }
    #[test]
    fn conversation_removal_keeps_other_thread_and_newer_message() {
        let mut state = Registry::default();
        for (id, at, thread) in [
            ("old", 10.0, "thread"),
            ("new", 30.0, "thread"),
            ("other", 10.0, "other"),
        ] {
            let mut value = payload(id, at);
            value["threadId"] = json!(thread);
            state.records.insert(
                id.into(),
                Record {
                    payload: value,
                    source: "main".into(),
                    generation: 1,
                },
            );
        }
        assert_eq!(
            conversation_ids(&state, "local", "thread", 20.0),
            vec!["old"]
        );
        assert_eq!(state.records.len(), 3);
    }
    #[test]
    fn notification_routes_to_one_normal_window_and_never_quick_chat() {
        let labels = vec!["quick-chat".into(), "thread-b".into(), "main".into()];
        assert_eq!(navigation_label("quick-chat", &labels), Some("main".into()));
        assert_eq!(
            navigation_label("thread-b", &labels),
            Some("thread-b".into())
        );
        assert_eq!(navigation_label("closed", &labels), Some("main".into()));
        assert_eq!(
            navigation_label(
                "closed",
                &["thread-b".into(), "quick-chat".into(), "thread-a".into()]
            ),
            Some("thread-a".into())
        );
        assert_eq!(navigation_label("quick-chat", &["quick-chat".into()]), None);
    }
}
