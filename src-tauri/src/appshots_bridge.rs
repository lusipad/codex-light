//! Main-window adapter for the actual Appshot owner. Renderer requests contain
//! opaque flights and confirmed service identities, never native window handles.
use crate::{
    appshots_entry::{Hotkey, PrimaryWindow, Registration, Route, Scope, State as EntryState},
    appshots_preferences,
    appshots_runtime::{
        AppshotsRuntime, HandoffContext, RuntimeConfiguration, RuntimeError, RuntimeEvent,
    },
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
    destination_revision: AtomicU64,
    context_revision: AtomicU64,
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
    fn destination_ticket(&self) -> u64 {
        self.destination_revision.fetch_add(1, Ordering::SeqCst) + 1
    }
    fn destination_current(&self, revision: u64, ticket: u64) -> Result<(), String> {
        if self.current(revision) && self.destination_revision.load(Ordering::SeqCst) == ticket {
            Ok(())
        } else {
            Err("应用快照目标读取已被新的入口或读取替代。".into())
        }
    }
    fn context_ticket(&self) -> u64 {
        self.context_revision.fetch_add(1, Ordering::SeqCst) + 1
    }
    fn context_current(&self, revision: u64, ticket: u64) -> Result<(), String> {
        if self.current(revision) && self.context_revision.load(Ordering::SeqCst) == ticket {
            Ok(())
        } else {
            Err("应用快照输入框更新已失效。".into())
        }
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
    capture_generation: u64,
    can_accept: bool,
    is_new_chat: bool,
    #[serde(default)]
    work_allowed: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FlightRequest {
    identity: ServiceIdentity,
    id: String,
    composer: String,
    capture_generation: u64,
    #[serde(default)]
    accept_intro: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContextRequest {
    identity: ServiceIdentity,
    previous_composer: String,
    previous_capture_generation: u64,
    composer: String,
    capture_generation: u64,
    can_accept: bool,
    is_new_chat: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HandoffRequest {
    identity: ServiceIdentity,
    id: String,
    composer: String,
    capture_generation: u64,
    target_composer: String,
    target_capture_generation: u64,
    can_accept: bool,
    is_new_chat: bool,
}

fn handoff_configuration(
    session: &Session,
    revision: u64,
    request: &HandoffRequest,
) -> Result<RuntimeConfiguration, String> {
    valid_context(&request.composer, request.capture_generation)?;
    valid_context(&request.target_composer, request.target_capture_generation)?;
    if session.revision != revision
        || session.identity != request.identity
        || session.config.scope.composer != request.composer
        || session.config.capture_generation != request.capture_generation
    {
        return Err("应用快照原交接作用域或账号已变化。".into());
    }
    if session.config.work_allowed != Some(true) || !request.can_accept || !request.is_new_chat {
        return Err("Work 新聊天输入尚未获准或未就绪。".into());
    }
    let mut config = session.config.clone();
    let primary = config
        .primary
        .as_mut()
        .filter(|primary| primary.is_primary && primary.alive)
        .ok_or("应用快照主窗口不可用。")?;
    primary.can_accept = request.can_accept;
    primary.is_new_chat = request.is_new_chat;
    config.scope.composer = request.target_composer.clone();
    config.capture_generation = request.target_capture_generation;
    Ok(config)
}

fn retire_handoff(session: &Session, id: Uuid) -> Result<(), String> {
    session
        .runtime
        .decline(id, "main".into(), session.config.scope.clone())
        .map(|_| ())
        .map_err(|error| format!("应用快照交接取消失败：{error:?}"))
}

fn claim_needs_intro(route: Option<Route>, intro_accepted: bool) -> bool {
    route == Some(Route::Current) && !intro_accepted
}

#[tauri::command]
pub(crate) async fn appshots_entry_handoff(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    bridge: State<'_, AppshotsBridge>,
    request: HandoffRequest,
) -> Result<Value, String> {
    require_main(&window)?;
    let id = Uuid::parse_str(&request.id).map_err(|_| "应用快照交接请求无效。")?;
    valid_context(&request.composer, request.capture_generation)?;
    valid_context(&request.target_composer, request.target_capture_generation)?;
    let bridge = bridge.inner().clone();
    let revision = bridge.0.revision.load(Ordering::SeqCst);
    let ticket = bridge.0.context_ticket();
    let identity = state
        .chatgpt_service
        .identity(&Uuid::new_v4().to_string(), |method, params| {
            let state = &state;
            let app = &app;
            async move { state.app_server.call(app, method, Some(params)).await }
        })
        .await
        .map_err(|_| "无法确认应用快照交接账号身份。".to_owned());
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = bridge
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        // Stale handoffs cannot even cancel a flight adopted by a newer caller.
        bridge.0.context_current(revision, ticket)?;
        let session = slot
            .as_mut()
            .filter(|session| session.revision == revision && session.identity == request.identity)
            .ok_or("应用快照原入口或账号已变化。")?;
        let result = (|| {
            settings_current(&bridge, &state, revision, &request.identity)?;
            if identity? != request.identity {
                return Err("应用快照交接账号已变化。".into());
            }
            let config = handoff_configuration(session, revision, &request)?;
            let accepted = session
                .runtime
                .handoff_context(
                    id,
                    "main".into(),
                    HandoffContext {
                        from: session.config.scope.clone(),
                        from_capture_generation: request.capture_generation,
                        to: config.scope.clone(),
                        capture_generation: config.capture_generation,
                        can_accept: request.can_accept,
                        is_new_chat: request.is_new_chat,
                    },
                )
                .map_err(|error| format!("应用快照原子交接失败：{error:?}"))?;
            if !accepted {
                retire_handoff(session, id)?;
            }
            if accepted {
                session.config = config;
                settings_current(&bridge, &state, revision, &request.identity)?;
                bridge.0.context_current(revision, ticket)?;
                window
                    .unminimize()
                    .and_then(|_| window.show())
                    .and_then(|_| window.set_focus())
                    .map_err(|error| format!("无法显示 Work 应用快照输入：{error}"))?;
            }
            let intro_accepted =
                appshots_preferences::read_intro(&state.desktop_state, &session.identity)?;
            let current = session
                .runtime
                .state()
                .map_err(|error| format!("无法确认应用快照交接状态：{error:?}"))?;
            if accepted
                && !session
                    .runtime
                    .handoff_current(
                        id,
                        "main".into(),
                        session.config.scope.clone(),
                        session.config.capture_generation,
                    )
                    .map_err(|error| format!("应用快照交接确认失败：{error:?}"))?
            {
                return Err("应用快照交接在确认前已失效。".into());
            }
            let mut payload = context_payload(&current, &session.config);
            payload["accepted"] = json!(accepted);
            payload["introAccepted"] = json!(intro_accepted);
            settings_current(&bridge, &state, revision, &request.identity)?;
            bridge.0.context_current(revision, ticket)?;
            Ok(payload)
        })();
        if result.is_err() && bridge.0.context_current(revision, ticket).is_ok() {
            if let Err(cleanup) = retire_handoff(session, id) {
                return Err(format!("{}；{cleanup}", result.err().unwrap_or_default()));
            }
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

fn valid_context(composer: &str, capture_generation: u64) -> Result<(), String> {
    if composer.is_empty() || composer.len() > 4096 || capture_generation > 9_007_199_254_740_991 {
        Err("应用快照输入框作用域或附件代次无效。".into())
    } else {
        Ok(())
    }
}

fn context_configuration(
    old: &RuntimeConfiguration,
    request: &ContextRequest,
) -> Result<Option<RuntimeConfiguration>, String> {
    valid_context(
        &request.previous_composer,
        request.previous_capture_generation,
    )?;
    valid_context(&request.composer, request.capture_generation)?;
    if old.scope.account != account(&request.identity)
        || old.scope.composer != request.previous_composer
        || old.capture_generation != request.previous_capture_generation
    {
        return Err("应用快照输入框更新的原作用域已变化。".into());
    }
    let primary = old
        .primary
        .as_ref()
        .filter(|primary| primary.is_primary && primary.alive)
        .ok_or("应用快照主窗口不可用。")?;
    if old.scope.composer == request.composer
        && old.capture_generation == request.capture_generation
        && primary.can_accept == request.can_accept
        && primary.is_new_chat == request.is_new_chat
    {
        return Ok(None);
    }
    let mut candidate = old.clone();
    candidate.scope.composer = request.composer.clone();
    candidate.capture_generation = request.capture_generation;
    let primary = candidate.primary.as_mut().unwrap();
    primary.can_accept = request.can_accept;
    primary.is_new_chat = request.is_new_chat;
    Ok(Some(candidate))
}

fn context_payload(state: &EntryState, config: &RuntimeConfiguration) -> Value {
    let mut value = state_payload(state);
    value["composer"] = json!(config.scope.composer);
    value["captureGeneration"] = json!(config.capture_generation);
    value["canAccept"] = json!(config
        .primary
        .as_ref()
        .is_some_and(|primary| primary.can_accept));
    value["isNewChat"] = json!(config
        .primary
        .as_ref()
        .is_some_and(|primary| primary.is_new_chat));
    value
}

fn update_context(
    session: &mut Session,
    revision: u64,
    request: &ContextRequest,
) -> Result<Value, String> {
    if session.revision != revision || session.identity != request.identity {
        return Err("应用快照原入口已停止或账号已变化。".into());
    }
    if let Some(config) = context_configuration(&session.config, request)? {
        session
            .runtime
            .configure(config.clone())
            .map_err(|error| format!("应用快照输入框更新失败：{error:?}"))?;
        session.config = config;
    }
    let current = session
        .runtime
        .state()
        .map_err(|error| format!("应用快照入口不可用：{error:?}"))?;
    Ok(context_payload(&current, &session.config))
}

#[tauri::command]
pub(crate) async fn appshots_entry_context(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    bridge: State<'_, AppshotsBridge>,
    request: ContextRequest,
) -> Result<Value, String> {
    require_main(&window)?;
    valid_context(
        &request.previous_composer,
        request.previous_capture_generation,
    )?;
    valid_context(&request.composer, request.capture_generation)?;
    let bridge = bridge.inner().clone();
    let revision = bridge.0.revision.load(Ordering::SeqCst);
    let ticket = bridge.0.context_ticket();
    let identity = state
        .chatgpt_service
        .identity(&Uuid::new_v4().to_string(), |method, params| {
            let state = &state;
            let app = &app;
            async move { state.app_server.call(app, method, Some(params)).await }
        })
        .await
        .map_err(|_| "无法确认应用快照账号身份。")?;
    if identity != request.identity {
        return Err("应用快照账号已变化。".into());
    }
    bridge.0.context_current(revision, ticket)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = bridge
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        bridge.0.context_current(revision, ticket)?;
        let session = slot.as_mut().ok_or("应用快照原入口已停止。")?;
        let result = update_context(session, revision, &request)?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        bridge.0.context_current(revision, ticket)?;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SettingsRequest {
    identity: ServiceIdentity,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HotkeyRequest {
    identity: ServiceIdentity,
    hotkey: Value,
}

fn selected_hotkey(value: &Value) -> Result<Option<Hotkey>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(value) if value == "DoubleAlt" => Ok(Some(Hotkey::DoubleAlt)),
        Value::String(value) if value == "DoubleShift" => Ok(Some(Hotkey::DoubleShift)),
        _ => Err("当前应用快照注册器仅支持 Alt + Alt、Shift + Shift 或无。".into()),
    }
}

async fn settings_scope(
    app: &AppHandle,
    state: &AppState,
    bridge: &AppshotsBridge,
    expected: &ServiceIdentity,
) -> Result<(u64, Option<bool>), String> {
    let revision = bridge.0.revision.load(Ordering::SeqCst);
    let identity = state
        .chatgpt_service
        .identity(&Uuid::new_v4().to_string(), |method, params| async move {
            state.app_server.call(app, method, Some(params)).await
        })
        .await
        .map_err(|_| "无法确认应用快照账号身份。")?;
    if identity != *expected || !bridge.0.current(revision) {
        return Err("应用快照账号或入口已变化。".into());
    }
    let requirements = state
        .app_server
        .call(app, "configRequirements/read", Some(json!({})))
        .await?;
    if state.chatgpt_service.generation() != expected.generation || !bridge.0.current(revision) {
        return Err("读取应用快照设置期间账号或入口已变化。".into());
    }
    Ok((revision, requirements_allowed(&requirements)))
}

fn settings_current(
    bridge: &AppshotsBridge,
    state: &AppState,
    revision: u64,
    identity: &ServiceIdentity,
) -> Result<(), String> {
    if !bridge.0.current(revision) || state.chatgpt_service.generation() != identity.generation {
        return Err("应用快照设置所属账号或入口已变化。".into());
    }
    if let Some(error) = bridge
        .0
        .cleanup_error
        .lock()
        .map_err(|_| "应用快照错误状态不可用。")?
        .as_ref()
    {
        return Err(error.clone());
    }
    Ok(())
}

fn settings_payload(
    identity: &ServiceIdentity,
    configured: (Option<String>, bool),
    session: Option<&Session>,
    requirements: Option<bool>,
) -> Result<Value, String> {
    let (supported, registration, eligible) = if let Some(session) = session {
        let current = session
            .runtime
            .state()
            .map_err(|error| format!("无法读取应用快照注册状态：{error:?}"))?;
        let eligible = match (session.config.eligible, requirements) {
            (Some(false), _) | (_, Some(false)) => Some(false),
            (Some(true), Some(true)) => Some(true),
            _ => None,
        };
        (
            Some(current.supported),
            match current.registration {
                Registration::None => "none",
                Registration::Pending => "pending",
                Registration::Ready => "ready",
            },
            eligible,
        )
    } else {
        (None, "none", None)
    };
    Ok(
        json!({"identity":identity,"configuredHotkey":configured.0,"configuredHotkeyDefaulted":configured.1,
        "eligible":eligible,"ownerState":if session.is_some() {"active"} else {"unavailable"},
        "supported":supported,"registration":registration}),
    )
}

// Keep the synchronous registration transaction separate from late native events.
// Rollback failure is reported, never represented as restored readiness.
fn replace_hotkey(
    old: &RuntimeConfiguration,
    hotkey: Option<Hotkey>,
    mut configure: impl FnMut(RuntimeConfiguration) -> Result<EntryState, RuntimeError>,
    persist: impl FnOnce() -> Result<(), String>,
    current: impl Fn() -> Result<(), String>,
) -> Result<RuntimeConfiguration, String> {
    current()?;
    let mut candidate = old.clone();
    candidate.hotkey = hotkey;
    let result = configure(candidate.clone())
        .map(|_| ())
        .map_err(|error| format!("应用快照注册失败：{error:?}"))
        .and_then(|_| current())
        .and_then(|_| persist());
    if let Err(error) = result {
        return match configure(old.clone()) {
            Ok(_) => Err(error),
            Err(restore) => Err(format!("{error}；旧注册恢复失败：{restore:?}")),
        };
    }
    // A committed global preference is retained even if the owner is now stale.
    current()?;
    Ok(candidate)
}

fn refresh_destination(
    config: &mut RuntimeConfiguration,
    destination: crate::appshots_entry::Destination,
    configure: impl FnOnce(RuntimeConfiguration) -> Result<EntryState, RuntimeError>,
) -> Result<(), String> {
    if config.destination == destination {
        return Ok(());
    }
    let mut candidate = config.clone();
    candidate.destination = destination;
    configure(candidate.clone()).map_err(|error| format!("应用快照目标尚未应用：{error:?}"))?;
    *config = candidate;
    Ok(())
}

#[tauri::command]
pub(crate) async fn appshots_settings_read(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    bridge: State<'_, AppshotsBridge>,
    request: SettingsRequest,
) -> Result<Value, String> {
    require_main(&window)?;
    let bridge = bridge.inner().clone();
    let (revision, requirements) = settings_scope(&app, &state, &bridge, &request.identity).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let slot = bridge
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        let session = slot
            .as_ref()
            .filter(|session| session.identity == request.identity && session.revision == revision);
        let result = settings_payload(
            &request.identity,
            appshots_preferences::configured_hotkey(&state.desktop_state)?,
            session,
            requirements,
        )?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn appshots_hotkey_set(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    bridge: State<'_, AppshotsBridge>,
    request: HotkeyRequest,
) -> Result<Value, String> {
    let hotkey = selected_hotkey(&request.hotkey)?;
    require_main(&window)?;
    let bridge = bridge.inner().clone();
    let (revision, requirements) = settings_scope(&app, &state, &bridge, &request.identity).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = bridge
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        let session = slot
            .as_mut()
            .filter(|session| session.identity == request.identity && session.revision == revision)
            .ok_or("应用快照当前没有有效入口，未保存快捷键。")?;
        if session.config.eligible != Some(true)
            || requirements != Some(true)
            || !session.config.capable
        {
            return Err("应用快照资格尚未确认或当前不可用，未保存快捷键。".into());
        }
        if !session
            .runtime
            .state()
            .map_err(|error| format!("无法确认应用快照注册状态：{error:?}"))?
            .supported
        {
            return Err("应用快照原生入口当前不可用，未保存快捷键。".into());
        }
        let configured = appshots_preferences::configured_hotkey(&state.desktop_state)?;
        if configured.0.as_deref() != request.hotkey.as_str() {
            let config = replace_hotkey(
                &session.config,
                hotkey,
                |config| session.runtime.configure(config),
                || appshots_preferences::write_hotkey(&state.desktop_state, hotkey),
                || settings_current(&bridge, &state, revision, &request.identity),
            )?;
            session.config = config;
        }
        let result = settings_payload(
            &request.identity,
            appshots_preferences::configured_hotkey(&state.desktop_state)?,
            Some(session),
            requirements,
        )?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn appshots_destination_refresh(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    bridge: State<'_, AppshotsBridge>,
    request: SettingsRequest,
) -> Result<Value, String> {
    require_main(&window)?;
    let bridge = bridge.inner().clone();
    let destination_ticket = bridge.0.destination_ticket();
    let (revision, requirements) = settings_scope(&app, &state, &bridge, &request.identity).await?;
    bridge.0.destination_current(revision, destination_ticket)?;
    let response = state
        .app_server
        .call(&app, "config/read", Some(json!({"includeLayers":false})))
        .await?;
    bridge.0.destination_current(revision, destination_ticket)?;
    let (destination, destination_defaulted) =
        appshots_preferences::read_destination_setting(&response)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = bridge
            .0
            .session
            .lock()
            .map_err(|_| "应用快照管理线程不可用。")?;
        settings_current(&bridge, &state, revision, &request.identity)?;
        bridge.0.destination_current(revision, destination_ticket)?;
        let mut session = slot
            .as_mut()
            .filter(|session| session.identity == request.identity && session.revision == revision);
        if let Some(session) = session.as_deref_mut() {
            let runtime = &session.runtime;
            refresh_destination(&mut session.config, destination, |config| {
                runtime.configure(config)
            })?;
        }
        settings_current(&bridge, &state, revision, &request.identity)?;
        bridge.0.destination_current(revision, destination_ticket)?;
        let mut result = settings_payload(
            &request.identity,
            appshots_preferences::configured_hotkey(&state.desktop_state)?,
            session.as_deref(),
            requirements,
        )?;
        result["destination"] = json!(match destination {
            crate::appshots_entry::Destination::Automatic => "automatic",
            crate::appshots_entry::Destination::LastChat => "last-chat",
            crate::appshots_entry::Destination::NewChat => "new-chat",
        });
        result["destinationDefaulted"] = json!(destination_defaulted);
        bridge.0.destination_current(revision, destination_ticket)?;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
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
    valid_context(&request.composer, request.capture_generation)?;
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
    let hotkey = appshots_preferences::read_runtime_hotkey(&state.desktop_state)?;
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
                RuntimeEvent::Route { id, scope, route, capture_generation, metadata: target, .. } => json!({"type":"route","id":id.to_string(),"captureGeneration":capture_generation,
                    "account":scope.account,"composer":scope.composer,"route":match route {Route::Current=>"current",Route::NewChat=>"new-chat",Route::Skip=>"skip"},
                    "metadata":metadata(&target),"requestedAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true)}),
                RuntimeEvent::CaptureReady { id, scope, capture_generation, metadata: target, capture, .. } => json!({"type":"capture","id":id.to_string(),"captureGeneration":capture_generation,
                    "account":scope.account,"composer":scope.composer,"metadata":metadata(&target),
                    "imageDataUrl":format!("data:image/png;base64,{}",STANDARD.encode(capture.png)),"axTree":capture.capture.text}),
                RuntimeEvent::Retired { id } => json!({"type":"retired","id":id.to_string()}),
                RuntimeEvent::Failed { id, error } => failure_payload(id, error),
            };
            let _ = event_app.emit_to("main", "appshots:entry", payload);
        }).map_err(|e| format!("无法启动应用快照管理线程：{e}"))?;
        let config = RuntimeConfiguration {
            scope: Scope {account:account(&identity),composer:request.composer},origin:"main".into(),
            capture_generation:request.capture_generation,
            eligible:match (request.eligible,requirements_allowed(&requirements)) {
                (Some(false),_) | (_,Some(false)) => Some(false),
                (Some(true),Some(true)) => Some(true),
                _ => None,
            },capable:cfg!(windows),hotkey,destination,
            primary:Some(PrimaryWindow { is_primary:true,alive:true,can_accept:request.can_accept,focused,
                last_active_ms:Some(bridge.0.last_active_ms.load(Ordering::SeqCst)).filter(|value|*value!=0),is_new_chat:request.is_new_chat }),
            // This requires an independent Work projection, not the Appshots gate.
            work_allowed:request.work_allowed,
        };
        let result = runtime.configure(config.clone()).map_err(|e| format!("应用快照注册失败：{e:?}"))?;
        *slot = Some(Session {revision,identity,runtime,config});
        let mut payload = context_payload(&result, &slot.as_ref().unwrap().config);
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
            || session.config.capture_generation != request.capture_generation
            || session.revision != bridge.0.revision.load(Ordering::SeqCst)
            || state.chatgpt_service.generation() != request.identity.generation
        {
            return Err("应用快照账号或输入框已变化。".into());
        }
        let origin = "main".to_string();
        let scope = session.config.scope.clone();
        match action {
            "claim" => {
                let route = session
                    .runtime
                    .claim_route(id, origin, scope)
                    .map_err(|e| format!("应用快照认领失败：{e:?}"))?;
                let accepted = route.is_some();
                let intro_accepted =
                    appshots_preferences::read_intro(&state.desktop_state, &session.identity)?;
                if claim_needs_intro(route, intro_accepted) {
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

    fn context_identity() -> ServiceIdentity {
        ServiceIdentity {
            account_id: "context-account".into(),
            user_id: "context-user".into(),
            generation: 4,
        }
    }
    fn handoff_request() -> HandoffRequest {
        HandoffRequest {
            identity: context_identity(),
            id: Uuid::new_v4().to_string(),
            composer: "home".into(),
            capture_generation: 10,
            target_composer: "home".into(),
            target_capture_generation: 0,
            can_accept: true,
            is_new_chat: true,
        }
    }

    #[test]
    fn handoff_target_configuration_preserves_owner_and_requires_exact_ready_work_tuple() {
        let (mut session, states) = context_session();
        session.config.work_allowed = Some(true);
        let request = handoff_request();
        let target = handoff_configuration(&session, 7, &request).unwrap();
        assert_eq!(target.scope, session.config.scope);
        assert_eq!(target.capture_generation, 0);
        assert_eq!(target.hotkey, session.config.hotkey);
        assert_eq!(target.destination, session.config.destination);
        assert_eq!(target.eligible, session.config.eligible);
        assert_eq!(target.work_allowed, Some(true));
        assert!(target.primary.as_ref().unwrap().is_new_chat);
        assert_eq!(session.config.capture_generation, 10);
        for mismatch in [
            "identity",
            "source",
            "generation",
            "unknown",
            "denied",
            "unready",
            "not-home",
            "revision",
        ] {
            let mut request = handoff_request();
            session.config.work_allowed = Some(true);
            match mismatch {
                "identity" => request.identity.generation += 1,
                "source" => request.composer = "different".into(),
                "generation" => request.capture_generation = 9,
                "unknown" => session.config.work_allowed = None,
                "denied" => session.config.work_allowed = Some(false),
                "unready" => request.can_accept = false,
                "not-home" => request.is_new_chat = false,
                _ => {}
            }
            assert!(handoff_configuration(
                &session,
                if mismatch == "revision" { 8 } else { 7 },
                &request
            )
            .is_err());
        }
        assert_eq!(
            states.load(Ordering::SeqCst),
            0,
            "preparation alone cannot configure/re-register"
        );
        session.runtime.shutdown().unwrap();
    }

    #[test]
    fn new_chat_claim_never_opens_intro_before_target_handoff_and_work_defaults_unknown() {
        assert!(!claim_needs_intro(Some(Route::NewChat), false));
        assert!(!claim_needs_intro(Some(Route::NewChat), true));
        assert!(!claim_needs_intro(None, false));
        assert!(claim_needs_intro(Some(Route::Current), false));
        assert!(!claim_needs_intro(Some(Route::Current), true));
        let raw = json!({"identity":context_identity(),"eligible":true,"composer":"home","captureGeneration":10,
            "canAccept":true,"isNewChat":true});
        assert!(serde_json::from_value::<ConfigureRequest>(raw.clone())
            .unwrap()
            .work_allowed
            .is_none());
        for allowed in [Value::Null, json!(false), json!(true)] {
            let mut raw = raw.clone();
            raw["workAllowed"] = allowed.clone();
            assert_eq!(
                serde_json::from_value::<ConfigureRequest>(raw)
                    .unwrap()
                    .work_allowed,
                allowed.as_bool()
            );
        }
    }

    #[tokio::test]
    async fn delayed_handoff_uses_context_ticket_and_cannot_cancel_or_ack_after_new_context() {
        let inner = Inner::default();
        let revision = inner.ticket();
        let handoff = inner.context_ticket();
        let (send, pending) = tokio::sync::oneshot::channel();
        let consumer = inner.context_ticket();
        send.send(()).unwrap();
        pending.await.unwrap();
        assert!(inner.context_current(revision, handoff).is_err());
        assert!(inner.context_current(revision, consumer).is_ok());
        assert!(inner.current(revision));
        inner.ticket();
        assert!(inner.context_current(revision, consumer).is_err());
    }
    fn context_request(
        previous: &str,
        previous_generation: u64,
        composer: &str,
        generation: u64,
    ) -> ContextRequest {
        ContextRequest {
            identity: context_identity(),
            previous_composer: previous.into(),
            previous_capture_generation: previous_generation,
            composer: composer.into(),
            capture_generation: generation,
            can_accept: true,
            is_new_chat: false,
        }
    }
    fn context_session() -> (Session, Arc<std::sync::atomic::AtomicUsize>) {
        let states = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let emitted = states.clone();
        let runtime = AppshotsRuntime::start(std::env::temp_dir(), move |event| {
            if matches!(event, RuntimeEvent::State(_)) {
                emitted.fetch_add(1, Ordering::SeqCst);
            }
        })
        .unwrap();
        let mut config = settings_config();
        config.eligible = Some(false); // no OS registration in this bridge fixture
        config.scope = Scope {
            account: account(&context_identity()),
            composer: "home".into(),
        };
        config.capture_generation = 10;
        config.primary = Some(PrimaryWindow {
            is_primary: true,
            alive: true,
            can_accept: true,
            focused: false,
            last_active_ms: Some(1),
            is_new_chat: false,
        });
        runtime.configure(config.clone()).unwrap();
        states.store(0, Ordering::SeqCst);
        (
            Session {
                revision: 7,
                identity: context_identity(),
                runtime,
                config,
            },
            states,
        )
    }

    #[test]
    fn context_ack_same_fields_is_read_only_and_account_scoped_counters_can_decrease() {
        let (mut session, states) = context_session();
        let unchanged =
            update_context(&mut session, 7, &context_request("home", 10, "home", 10)).unwrap();
        assert_eq!(states.load(Ordering::SeqCst), 0);
        assert_eq!(unchanged["composer"], "home");
        assert_eq!(unchanged["captureGeneration"], 10);
        assert_eq!(unchanged["canAccept"], true);
        assert_eq!(unchanged["isNewChat"], false);
        let original_hotkey = session.config.hotkey;
        update_context(&mut session, 7, &context_request("home", 10, "thread:B", 0)).unwrap();
        update_context(&mut session, 7, &context_request("thread:B", 0, "home", 10)).unwrap();
        assert_eq!(states.load(Ordering::SeqCst), 2);
        assert_eq!(session.config.hotkey, original_hotkey);
        assert_eq!(session.config.eligible, Some(false));
        assert_eq!(session.config.destination, Destination::Automatic);
        assert_eq!(session.config.work_allowed, None);
        assert_eq!(session.revision, 7);
        session.runtime.shutdown().unwrap();
    }

    #[test]
    fn context_wrong_previous_identity_lifecycle_and_unsafe_generation_are_rejected() {
        let (mut session, states) = context_session();
        for mismatch in [
            "previous-scope",
            "previous-generation",
            "account",
            "user",
            "service-generation",
            "unsafe-generation",
            "lifecycle",
        ] {
            let mut request = context_request("home", 10, "thread:new", 0);
            match mismatch {
                "previous-scope" => request.previous_composer = "other".into(),
                "previous-generation" => request.previous_capture_generation = 9,
                "account" => request.identity.account_id = "other-account".into(),
                "user" => request.identity.user_id = "other-user".into(),
                "service-generation" => request.identity.generation += 1,
                "unsafe-generation" => request.capture_generation = 9_007_199_254_740_992,
                _ => {}
            }
            assert!(update_context(
                &mut session,
                if mismatch == "lifecycle" { 8 } else { 7 },
                &request
            )
            .is_err());
        }
        assert_eq!(states.load(Ordering::SeqCst), 0);
        assert_eq!(session.config.scope.composer, "home");
        assert_eq!(session.config.capture_generation, 10);
        session.runtime.shutdown().unwrap();
        assert!(update_context(
            &mut session,
            7,
            &context_request("home", 10, "thread:new", 0)
        )
        .is_err());
        assert_eq!(session.config.scope.composer, "home");
    }

    #[tokio::test]
    async fn context_ticket_rejects_late_aba_and_stopped_owner_without_changing_lifecycle() {
        let inner = Inner::default();
        let revision = inner.ticket();
        let old = inner.context_ticket();
        let (send, pending) = tokio::sync::oneshot::channel();
        let newer = inner.context_ticket();
        inner.context_current(revision, newer).unwrap();
        let back_to_same_context = inner.context_ticket();
        inner
            .context_current(revision, back_to_same_context)
            .unwrap();
        send.send(()).unwrap();
        pending.await.unwrap();
        assert!(inner.context_current(revision, old).is_err());
        assert!(inner.context_current(revision, newer).is_err());
        assert!(inner.current(revision));
        inner.destination_ticket();
        assert!(inner
            .context_current(revision, back_to_same_context)
            .is_ok());
        inner.ticket(); // stop/configure invalidates every context update
        assert!(inner
            .context_current(revision, back_to_same_context)
            .is_err());
    }

    fn settings_config() -> RuntimeConfiguration {
        RuntimeConfiguration {
            capture_generation: 1,
            scope: Scope {
                account: "fixture".into(),
                composer: "home".into(),
            },
            origin: "main".into(),
            eligible: Some(true),
            capable: true,
            hotkey: Some(Hotkey::DoubleAlt),
            destination: Destination::Automatic,
            primary: None,
            work_allowed: None,
        }
    }
    fn configured_state(config: &RuntimeConfiguration) -> EntryState {
        EntryState {
            eligible: config.eligible,
            supported: true,
            configured_hotkey: config.hotkey,
            registration: if config.hotkey.is_some() {
                Registration::Pending
            } else {
                Registration::None
            },
            input_epoch: 0,
        }
    }

    #[test]
    fn settings_hotkey_sync_failure_never_persists_and_restores_old_runtime() {
        use std::cell::{Cell, RefCell};
        let calls = RefCell::new(Vec::new());
        let writes = Cell::new(0);
        let result = replace_hotkey(
            &settings_config(),
            Some(Hotkey::DoubleShift),
            |config| {
                calls.borrow_mut().push(config.hotkey);
                if calls.borrow().len() == 1 {
                    Err(RuntimeError::NativeStart(87))
                } else {
                    Ok(configured_state(&config))
                }
            },
            || {
                writes.set(writes.get() + 1);
                Ok(())
            },
            || Ok(()),
        );
        assert!(result.err().unwrap().contains("NativeStart(87)"));
        assert_eq!(writes.get(), 0);
        assert_eq!(
            *calls.borrow(),
            vec![Some(Hotkey::DoubleShift), Some(Hotkey::DoubleAlt)]
        );
    }

    #[test]
    fn settings_destination_same_value_is_read_only_and_change_configures_once() {
        use std::cell::Cell;
        let count = Cell::new(0);
        let mut config = settings_config();
        for destination in [
            Destination::Automatic,
            Destination::NewChat,
            Destination::NewChat,
        ] {
            refresh_destination(&mut config, destination, |candidate| {
                count.set(count.get() + 1);
                Ok(configured_state(&candidate))
            })
            .unwrap();
        }
        assert_eq!(count.get(), 1);
        assert_eq!(config.destination, Destination::NewChat);
        assert!(
            refresh_destination(&mut config, Destination::LastChat, |_| Err(
                RuntimeError::Closed
            ))
            .is_err()
        );
        assert_eq!(config.destination, Destination::NewChat);
    }

    #[tokio::test]
    async fn destination_refresh_late_old_read_cannot_replace_new_applied_value() {
        let inner = Inner::default();
        let revision = inner.ticket();
        let old_ticket = inner.destination_ticket();
        let (send_old, delayed_old) = tokio::sync::oneshot::channel();
        let new_ticket = inner.destination_ticket();
        let mut config = settings_config();
        let mut configurations = 0;
        inner.destination_current(revision, new_ticket).unwrap();
        refresh_destination(&mut config, Destination::NewChat, |candidate| {
            configurations += 1;
            Ok(configured_state(&candidate))
        })
        .unwrap();
        send_old.send(Destination::Automatic).unwrap();
        let stale_destination = delayed_old.await.unwrap();
        if inner.destination_current(revision, old_ticket).is_ok() {
            refresh_destination(&mut config, stale_destination, |candidate| {
                configurations += 1;
                Ok(configured_state(&candidate))
            })
            .unwrap();
        }
        assert_eq!(
            config.destination,
            Destination::NewChat,
            "late old read overwrote the newer applied destination"
        );
        assert_eq!(configurations, 1);
        assert!(
            inner.current(revision),
            "refresh does not invalidate the owner lifecycle"
        );
        let stopped = inner.ticket();
        assert!(inner.destination_current(revision, new_ticket).is_err());
        assert!(inner.current(stopped));
    }

    #[test]
    fn destination_refresh_new_read_fences_old_even_if_new_read_fails() {
        let inner = Inner::default();
        let revision = inner.ticket();
        let old = inner.destination_ticket();
        assert!(inner.destination_current(revision, old).is_ok());
        let newer = inner.destination_ticket();
        // Allocating the newer read is the fence, independent of its RPC result.
        assert!(inner.destination_current(revision, old).is_err());
        assert!(inner.destination_current(revision, newer).is_ok());
        assert!(inner.current(revision));
    }

    #[test]
    fn settings_hotkey_persist_failure_restores_and_restore_failure_is_visible() {
        use std::cell::RefCell;
        for restore_fails in [false, true] {
            let calls = RefCell::new(Vec::new());
            let result = replace_hotkey(
                &settings_config(),
                None,
                |config| {
                    calls.borrow_mut().push(config.hotkey);
                    if restore_fails && calls.borrow().len() == 2 {
                        Err(RuntimeError::NativeStart(5))
                    } else {
                        Ok(configured_state(&config))
                    }
                },
                || Err("private persistence failure".into()),
                || Ok(()),
            );
            let error = result.err().unwrap();
            assert!(error.contains("private persistence failure"));
            assert_eq!(error.contains("旧注册恢复失败"), restore_fails);
            assert_eq!(*calls.borrow(), vec![None, Some(Hotkey::DoubleAlt)]);
        }
    }

    #[test]
    fn settings_hotkey_null_commits_without_waiting_for_ready() {
        use std::cell::Cell;
        let writes = Cell::new(0);
        let updated = replace_hotkey(
            &settings_config(),
            None,
            |config| Ok(configured_state(&config)),
            || {
                writes.set(writes.get() + 1);
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();
        assert_eq!(updated.hotkey, None);
        assert_eq!(writes.get(), 1);
        let pending = replace_hotkey(
            &settings_config(),
            Some(Hotkey::DoubleShift),
            |config| {
                let state = configured_state(&config);
                assert_eq!(state.registration, Registration::Pending);
                Ok(state)
            },
            || {
                writes.set(writes.get() + 1);
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();
        assert_eq!(pending.hotkey, Some(Hotkey::DoubleShift));
        assert_eq!(writes.get(), 2);
    }

    #[test]
    fn settings_custom_is_preserved_until_explicit_known_selection_succeeds() {
        use std::cell::RefCell;
        for fails in [true, false] {
            let raw = RefCell::new(json!("Ctrl+Alt+A"));
            let mut old = settings_config();
            old.hotkey = None; // unsupported existing custom has no native hook
            let configured = RefCell::new(None);
            let result = replace_hotkey(
                &old,
                Some(Hotkey::DoubleShift),
                |config| {
                    *configured.borrow_mut() = config.hotkey;
                    if fails && config.hotkey.is_some() {
                        Err(RuntimeError::NativeStart(87))
                    } else {
                        Ok(configured_state(&config))
                    }
                },
                || {
                    *raw.borrow_mut() = json!("DoubleShift");
                    Ok(())
                },
                || Ok(()),
            );
            if fails {
                assert!(result.is_err());
                assert_eq!(*raw.borrow(), json!("Ctrl+Alt+A"));
                assert_eq!(*configured.borrow(), None);
            } else {
                assert!(result.is_ok());
                assert_eq!(*raw.borrow(), json!("DoubleShift"));
            }
        }
    }

    #[test]
    fn settings_stale_scope_before_registration_or_before_persist_never_writes() {
        use std::cell::Cell;
        for stale_at in [1, 2] {
            let checks = Cell::new(0);
            let configurations = Cell::new(0);
            let writes = Cell::new(0);
            let result = replace_hotkey(
                &settings_config(),
                None,
                |config| {
                    configurations.set(configurations.get() + 1);
                    Ok(configured_state(&config))
                },
                || {
                    writes.set(writes.get() + 1);
                    Ok(())
                },
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == stale_at {
                        Err("stale fixture scope".into())
                    } else {
                        Ok(())
                    }
                },
            );
            assert!(result.is_err());
            assert_eq!(writes.get(), 0);
            assert_eq!(configurations.get(), if stale_at == 1 { 0 } else { 2 });
        }
    }

    #[test]
    fn settings_no_owner_is_explicit_unknown_and_custom_inputs_cannot_be_written() {
        let identity = ServiceIdentity {
            user_id: "u".into(),
            account_id: "a".into(),
            generation: 1,
        };
        let result = settings_payload(
            &identity,
            (Some("Ctrl+Alt+A".into()), false),
            None,
            Some(true),
        )
        .unwrap();
        assert_eq!(result["configuredHotkey"], "Ctrl+Alt+A");
        assert_eq!(result["ownerState"], "unavailable");
        assert!(result["supported"].is_null());
        assert!(result["eligible"].is_null());
        for invalid in [
            json!("Ctrl+Alt+A"),
            json!(""),
            json!(true),
            json!({}),
            json!(4),
        ] {
            assert!(selected_hotkey(&invalid).is_err());
        }
        assert_eq!(selected_hotkey(&Value::Null).unwrap(), None);
        assert_eq!(
            selected_hotkey(&json!("DoubleAlt")).unwrap(),
            Some(Hotkey::DoubleAlt)
        );
        assert!(serde_json::from_value::<HotkeyRequest>(
            json!({"identity":identity,"hotkey":null,"eligible":true})
        )
        .is_err());
    }

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
            capture_generation: 1,
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
