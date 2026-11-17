//! Main-window adapter for the actual Appshot owner. Renderer requests contain
//! opaque flights and confirmed service identities, never native window handles.
use crate::{
    appshots_entry::{PrimaryWindow, Registration, Route, Scope, State as EntryState},
    appshots_preferences,
    appshots_runtime::{AppshotsRuntime, RuntimeConfiguration, RuntimeEvent},
    chatgpt_service::ServiceIdentity,
    AppState,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

#[derive(Default, Clone)]
pub(crate) struct AppshotsBridge(Arc<Inner>);

#[derive(Default)]
struct Inner {
    revision: AtomicU64,
    focused: AtomicBool,
    last_active_ms: AtomicU64,
    session: Mutex<Option<Session>>,
    cleanup_error: Mutex<Option<String>>,
}

impl Inner {
    fn ticket(&self) -> u64 {
        self.revision.fetch_add(1, Ordering::SeqCst) + 1
    }
    fn current(&self, ticket: u64) -> bool {
        self.revision.load(Ordering::SeqCst) == ticket
    }
}

struct Session {
    revision: u64,
    identity: ServiceIdentity,
    runtime: AppshotsRuntime,
    config: RuntimeConfiguration,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfigureRequest {
    identity: ServiceIdentity,
    eligible: Option<bool>,
    composer: String,
    can_accept: bool,
    is_new_chat: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FlightRequest {
    identity: ServiceIdentity,
    id: String,
    composer: String,
    #[serde(default)]
    accept_intro: bool,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn account(identity: &ServiceIdentity) -> String {
    json!([identity.user_id, identity.account_id, identity.generation]).to_string()
}

fn requirements_allowed(response: &Value) -> Option<bool> {
    let requirements = response.as_object()?.get("requirements")?;
    if requirements.is_null() {
        return Some(true);
    }
    match requirements.as_object()?.get("allowAppshots") {
        None | Some(Value::Null) => Some(true),
        Some(Value::Bool(value)) => Some(*value),
        _ => None,
    }
}

fn state_payload(state: &EntryState) -> Value {
    json!({"type":"state", "supported":state.supported,
        "registration": match state.registration { Registration::None => "none", Registration::Pending => "pending", Registration::Ready => "ready" }})
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("应用快照仅支持主窗口。".into())
    }
}

fn metadata(value: &crate::appshots_target::TargetMetadata) -> Value {
    json!({"appName":value.display_name,"bundleIdentifier":value.app_identifier,"windowTitle":value.window_title})
}

fn failure_payload(id: Option<Uuid>, error: crate::appshots_runtime::RuntimeFailure) -> Value {
    // Target lookup fails before Route has introduced its flight to the renderer.
    // Keep that error visible instead of sending an unknown ID it must discard.
    let id = if matches!(&error, crate::appshots_runtime::RuntimeFailure::Target(_)) {
        None
    } else {
        id
    };
    json!({"type":"failed","id":id.map(|value|value.to_string()),"message":format!("应用快照失败：{error:?}")})
}

impl AppshotsBridge {
    /// Immediately fence emissions before waiting for the owner to cancel/reap.
    pub fn invalidate(&self) {
        let revision = self.0.ticket();
        let bridge = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = bridge.stop_before(revision) {
                eprintln!("Cannot stop Appshots: {error}");
            }
        });
    }

    pub fn stop(&self) -> Result<(), String> {
        let revision = self.0.ticket();
        self.stop_before(revision)
    }

    fn stop_before(&self, revision: u64) -> Result<(), String> {
        let mut slot = self
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        if slot
            .as_ref()
            .is_some_and(|session| session.revision > revision)
        {
            return Ok(());
        }
        let session = slot.take();
        if let Some(session) = session {
            if let Err(error) = session.runtime.shutdown() {
                let message = format!("无法确认旧应用快照已停止，未开启新的捕获：{error:?}");
                *self
                    .0
                    .cleanup_error
                    .lock()
                    .map_err(|_| "应用快照错误状态不可用。")? = Some(message.clone());
                return Err(message);
            }
        }
        Ok(())
    }

    pub fn focus_changed(&self, focused: bool) {
        self.0.focused.store(focused, Ordering::SeqCst);
        if focused {
            self.0.last_active_ms.store(now_ms(), Ordering::SeqCst);
        }
        let bridge = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let Ok(mut session) = bridge.0.session.lock() else {
                return;
            };
            if let Some(session) = session.as_mut() {
                if let Some(primary) = session.config.primary.as_mut() {
                    primary.focused = bridge.0.focused.load(Ordering::SeqCst);
                    primary.last_active_ms = Some(bridge.0.last_active_ms.load(Ordering::SeqCst))
                        .filter(|value| *value != 0);
                }
                if let Err(error) = session.runtime.configure(session.config.clone()) {
                    eprintln!("Cannot update Appshot window focus: {error:?}");
                }
            }
        });
    }
}

#[tauri::command]
pub(crate) async fn appshots_entry_configure(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    bridge: State<'_, AppshotsBridge>,
    request: ConfigureRequest,
) -> Result<Value, String> {
    require_main(&window)?;
    // Allocate before any await: a delayed identity/config response must never
    // obtain a newer ticket than a stop or a subsequently configured composer.
    let bridge = bridge.inner().clone();
    let revision = bridge.0.ticket();
    if let Some(error) = bridge
        .0
        .cleanup_error
        .lock()
        .map_err(|_| "应用快照错误状态不可用。")?
        .as_ref()
    {
        return Err(error.clone());
    }
    let retiring = bridge.clone();
    tauri::async_runtime::spawn_blocking(move || retiring.stop_before(revision))
        .await
        .map_err(|e| e.to_string())??;
    if !bridge.0.current(revision) {
        return Err("应用快照入口已失效。".into());
    }
    if request.composer.is_empty() || request.composer.len() > 4096 {
        return Err("应用快照输入框作用域无效。".into());
    }
    let identity = state
        .chatgpt_service
        .identity(&Uuid::new_v4().to_string(), |method, params| {
            let state = &state;
            let app = &app;
            async move { state.app_server.call(app, method, Some(params)).await }
        })
        .await
        .map_err(|_| "无法确认应用快照账号身份。")?;
    if bridge.0.revision.load(Ordering::SeqCst) != revision || identity != request.identity {
        return Err("应用快照账号已变化，请重试。".into());
    }
    let config_response = state
        .app_server
        .call(&app, "config/read", Some(json!({"includeLayers":false})))
        .await?;
    let requirements = state
        .app_server
        .call(&app, "configRequirements/read", Some(json!({})))
        .await?;
    if bridge.0.revision.load(Ordering::SeqCst) != revision
        || state.chatgpt_service.generation() != identity.generation
    {
        return Err("读取应用快照配置期间账号已变化。".into());
    }
    let hotkey = appshots_preferences::read_hotkey(&state.desktop_state)?;
    let destination = appshots_preferences::read_destination(&config_response)?;
    let intro_accepted = appshots_preferences::read_intro(&state.desktop_state, &identity)?;
    let focused = window.is_focused().map_err(|e| e.to_string())?;
    bridge.0.focused.store(focused, Ordering::SeqCst);
    if focused {
        bridge.0.last_active_ms.store(now_ms(), Ordering::SeqCst);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = bridge.0.session.lock().map_err(|_| "应用快照管理线程不可用。")?;
        if bridge.0.revision.load(Ordering::SeqCst) != revision { return Err("应用快照入口已失效。".into()); }
        if let Some(old) = slot.take() { old.runtime.shutdown().map_err(|e| format!("应用快照旧任务停止失败：{e:?}"))?; }
        if bridge.0.revision.load(Ordering::SeqCst) != revision
            || app.state::<AppState>().chatgpt_service.generation() != identity.generation {
            return Err("应用快照入口已失效。".into());
        }
        let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("appshots");
        std::fs::create_dir_all(&root).map_err(|e| format!("无法创建应用快照临时目录：{e}"))?;
        let inner = bridge.0.clone();
        let event_app = app.clone();
        let event_identity = identity.clone();
        let runtime = AppshotsRuntime::start(root, move |event| {
            if inner.revision.load(Ordering::SeqCst) != revision
                || event_app.state::<AppState>().chatgpt_service.generation() != event_identity.generation { return; }
            let payload = match event {
                RuntimeEvent::State(value) => state_payload(&value),
                RuntimeEvent::Route { id, scope, route, metadata: target, .. } => json!({"type":"route","id":id.to_string(),
                    "account":scope.account,"composer":scope.composer,"route":match route {Route::Current=>"current",Route::NewChat=>"new-chat",Route::Skip=>"skip"},
                    "metadata":metadata(&target),"requestedAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true)}),
                RuntimeEvent::CaptureReady { id, scope, metadata: target, capture, .. } => json!({"type":"capture","id":id.to_string(),
                    "account":scope.account,"composer":scope.composer,"metadata":metadata(&target),
                    "imageDataUrl":format!("data:image/png;base64,{}",STANDARD.encode(capture.png)),"axTree":capture.capture.text}),
                RuntimeEvent::Retired { id } => json!({"type":"retired","id":id.to_string()}),
                RuntimeEvent::Failed { id, error } => failure_payload(id, error),
            };
            let _ = event_app.emit_to("main", "appshots:entry", payload);
        }).map_err(|e| format!("无法启动应用快照管理线程：{e}"))?;
        let config = RuntimeConfiguration {
            scope: Scope {account:account(&identity),composer:request.composer},origin:"main".into(),
            eligible:match (request.eligible,requirements_allowed(&requirements)) {
                (Some(false),_) | (_,Some(false)) => Some(false),
                (Some(true),Some(true)) => Some(true),
                _ => None,
            },capable:cfg!(windows),hotkey,destination,
            primary:Some(PrimaryWindow { is_primary:true,alive:true,can_accept:request.can_accept,focused,
                last_active_ms:Some(bridge.0.last_active_ms.load(Ordering::SeqCst)).filter(|value|*value!=0),is_new_chat:request.is_new_chat }),
            // This requires an independent Work projection, not the Appshots gate.
            work_allowed:None,
        };
        let result = runtime.configure(config.clone()).map_err(|e| format!("应用快照注册失败：{e:?}"))?;
        *slot = Some(Session {revision,identity,runtime,config});
        let mut payload = state_payload(&result);
        payload["introAccepted"] = json!(intro_accepted);
        Ok(payload)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn appshots_entry_stop(
    window: WebviewWindow,
    bridge: State<'_, AppshotsBridge>,
) -> Result<(), String> {
    require_main(&window)?;
    let bridge = bridge.inner().clone();
    // Fence immediately, including while waiting behind a previous command.
    let revision = bridge.0.ticket();
    tauri::async_runtime::spawn_blocking(move || bridge.stop_before(revision))
        .await
        .map_err(|e| e.to_string())?
}

async fn flight_action(
    app: AppHandle,
    window: WebviewWindow,
    bridge: AppshotsBridge,
    request: FlightRequest,
    action: &'static str,
) -> Result<Value, String> {
    require_main(&window)?;
    let id = Uuid::parse_str(&request.id).map_err(|_| "应用快照请求无效。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let slot = bridge
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        let session = slot.as_ref().ok_or("应用快照入口已停止。")?;
        let state = app.state::<AppState>();
        if session.identity != request.identity
            || session.config.scope.composer != request.composer
            || session.revision != bridge.0.revision.load(Ordering::SeqCst)
            || state.chatgpt_service.generation() != request.identity.generation
        {
            return Err("应用快照账号或输入框已变化。".into());
        }
        let origin = "main".to_string();
        let scope = session.config.scope.clone();
        match action {
            "claim" => {
                let accepted = session
                    .runtime
                    .claim(id, origin, scope)
                    .map_err(|e| format!("应用快照认领失败：{e:?}"))?;
                let intro_accepted =
                    appshots_preferences::read_intro(&state.desktop_state, &session.identity)?;
                if accepted && !intro_accepted {
                    if let Err(error) = window
                        .unminimize()
                        .and_then(|_| window.show())
                        .and_then(|_| window.set_focus())
                    {
                        let _ = session.runtime.decline(
                            id,
                            "main".into(),
                            session.config.scope.clone(),
                        );
                        return Err(format!("无法显示应用快照说明：{error}"));
                    }
                }
                Ok(json!({"accepted":accepted,"introAccepted":intro_accepted}))
            }
            "accept" => {
                let reserved = session
                    .runtime
                    .reserve_accept(id, origin.clone(), scope.clone())
                    .map_err(|e| format!("应用快照请求已失效：{e:?}"))?;
                if !reserved {
                    return Ok(json!(false));
                }
                let accepted = if request.accept_intro {
                    appshots_preferences::accept_intro(&state.desktop_state, &session.identity)
                } else {
                    appshots_preferences::read_intro(&state.desktop_state, &session.identity)
                };
                if !matches!(accepted, Ok(true)) {
                    session
                        .runtime
                        .decline(id, origin.clone(), scope.clone())
                        .map_err(|e| format!("应用快照取消失败：{e:?}"))?;
                    return Err(accepted
                        .err()
                        .unwrap_or_else(|| "请先确认应用快照说明。".into()));
                }
                if session.revision != bridge.0.revision.load(Ordering::SeqCst)
                    || state.chatgpt_service.generation() != request.identity.generation
                {
                    session
                        .runtime
                        .decline(id, origin.clone(), scope.clone())
                        .map_err(|e| format!("应用快照取消失败：{e:?}"))?;
                    return Err("应用快照账号或输入框已变化。".into());
                }
                session
                    .runtime
                    .commit_accept(id, origin, scope)
                    .map(|value| json!(value))
                    .map_err(|e| format!("应用快照启动失败：{e:?}"))
            }
            _ => session
                .runtime
                .decline(id, origin, scope)
                .map(|value| json!(value))
                .map_err(|e| format!("应用快照取消失败：{e:?}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn appshots_entry_claim(
    app: AppHandle,
    window: WebviewWindow,
    bridge: State<'_, AppshotsBridge>,
    request: FlightRequest,
) -> Result<Value, String> {
    flight_action(app, window, bridge.inner().clone(), request, "claim").await
}
#[tauri::command]
pub(crate) async fn appshots_entry_accept(
    app: AppHandle,
    window: WebviewWindow,
    bridge: State<'_, AppshotsBridge>,
    request: FlightRequest,
) -> Result<Value, String> {
    flight_action(app, window, bridge.inner().clone(), request, "accept").await
}
#[tauri::command]
pub(crate) async fn appshots_entry_decline(
    app: AppHandle,
    window: WebviewWindow,
    bridge: State<'_, AppshotsBridge>,
    request: FlightRequest,
) -> Result<Value, String> {
    flight_action(app, window, bridge.inner().clone(), request, "decline").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appshots_entry::{Destination, Hotkey};

    #[tokio::test]
    async fn configure_ticket_cannot_become_current_after_a_later_stop_or_scope() {
        let inner = Inner::default();
        let old = inner.ticket();
        let (response, delayed) = tokio::sync::oneshot::channel();
        let newer = inner.ticket(); // stop or the next composer synchronously fences A
        response.send(()).unwrap();
        delayed.await.unwrap();
        assert!(!inner.current(old));
        assert!(inner.current(newer));
    }

    #[test]
    fn late_stop_does_not_shut_down_a_newer_owner() {
        let bridge = AppshotsBridge::default();
        let old_stop = bridge.0.ticket();
        let revision = bridge.0.ticket();
        let identity = ServiceIdentity {
            user_id: "user".into(),
            account_id: "account".into(),
            generation: 4,
        };
        let config = RuntimeConfiguration {
            scope: Scope {
                account: account(&identity),
                composer: "home".into(),
            },
            origin: "main".into(),
            eligible: Some(false),
            capable: true,
            hotkey: Some(Hotkey::DoubleAlt),
            destination: Destination::Automatic,
            primary: None,
            work_allowed: None,
        };
        let runtime = AppshotsRuntime::start(std::env::temp_dir(), |_| {}).unwrap();
        runtime.configure(config.clone()).unwrap(); // denied: no native hook or capture
        *bridge.0.session.lock().unwrap() = Some(Session {
            revision,
            identity,
            runtime,
            config,
        });
        bridge.stop_before(old_stop).unwrap();
        assert!(bridge.0.session.lock().unwrap().is_some());
        bridge.stop().unwrap();
        assert!(bridge.0.session.lock().unwrap().is_none());
    }

    #[test]
    fn renderer_metadata_projection_excludes_native_transport_fields() {
        let result = metadata(&crate::appshots_target::TargetMetadata {
            app_identifier: "process:C:\\Editor.exe".into(),
            display_name: "Editor".into(),
            window_title: Some("Original".into()),
        });
        assert_eq!(
            result,
            json!({"appName":"Editor","bundleIdentifier":"process:C:\\Editor.exe","windowTitle":"Original"})
        );
        assert!(result.get("process_path").is_none());
        assert!(result.get("hwnd").is_none());
        assert!(result.get("pid").is_none());
    }

    #[test]
    fn unknown_or_malformed_host_requirements_do_not_install_a_hotkey() {
        for value in [
            json!({}),
            json!({"requirements":[]}),
            json!({"requirements":{"allowAppshots":"true"}}),
        ] {
            assert_eq!(requirements_allowed(&value), None);
        }
        assert_eq!(
            requirements_allowed(&json!({"requirements":null})),
            Some(true)
        );
        assert_eq!(
            requirements_allowed(&json!({"requirements":{}})),
            Some(true)
        );
        assert_eq!(
            requirements_allowed(&json!({"requirements":{"allowAppshots":false}})),
            Some(false)
        );
    }

    #[test]
    fn target_lookup_errors_are_visible_before_renderer_knows_the_flight() {
        let payload = failure_payload(
            Some(Uuid::new_v4()),
            crate::appshots_runtime::RuntimeFailure::Target(
                crate::appshots_target::TargetError::TargetChanged,
            ),
        );
        assert_eq!(payload["type"], "failed");
        assert!(payload["id"].is_null());
        assert!(payload["message"]
            .as_str()
            .unwrap()
            .contains("应用快照失败"));
    }
}
