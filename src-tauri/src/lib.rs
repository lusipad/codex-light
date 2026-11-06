pub mod local_environment;
mod local_environment_setup;
pub mod app_server;
pub mod automations;
pub mod config_skills;
pub mod recommended_skills;
pub mod desktop_open;
mod desktop_open_context;
pub mod git;
mod worktree_preferences;
mod worktree_inventory;
mod worktree_archive_queue;
mod worktree_upstream;
mod worktree_cleanup_runtime;
pub mod menu;
pub mod keybindings;
pub mod personal_instructions;
pub mod pets;
pub mod quick_chat;
pub mod thread_window;
pub mod notification_broker;
pub mod desktop_notifications;
pub mod notification_audio;
pub mod notification_preferences;
mod model_preferences;
mod review_provider;
mod memory_preferences;
mod agent_configuration;
mod image_save;
mod chatgpt_service;
mod share_assets;
mod deep_links;
mod instance_transport;
pub mod state;
pub mod terminal;
mod thread_workspace;
mod archive_delete;
mod appearance_preferences;
mod system_fonts;
mod plugin_operations;
mod git_message_generation;
mod remote_review;

use app_server::{AppServerManager, AppServerStatus, PendingServerRequest};
use config_skills::{
    AutomationItem, CodexConfigOverview, CodexConfigUpdatePayload, SkillInfoItem,
    StorageStatsOverview,
};
use git::{GhCliStatus, GitCommitInfo, GitStatusInfo, GitWorktreeInfo};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use state::{
    find_agents_md, list_directory_entries, read_file_preview, search_workspace_files,
    DesktopStateManager, DirectoryEntryItem, FilePreviewResult, WorkspaceFileHit,
    WorkspaceRootItem,
};
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use terminal::{TerminalManager, TerminalSessionInfo};

pub struct AppState {
    pub app_server: AppServerManager,
    pub chatgpt_service: chatgpt_service::ChatgptService,
    pub desktop_state: DesktopStateManager,
    pub terminal: TerminalManager,
}

fn invalidate_chatgpt_service(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let generation = state.chatgpt_service.invalidate();
        if let Err(error) = desktop_notifications::invalidate_context(app, &generation.to_string()) {
            eprintln!("Cannot withdraw notifications after identity change: {error}");
        }
        let _ = app.emit("chatgpt-service:invalidated", generation);
        if let (Some(cleanup), Some(setup)) = (
            app.try_state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>(),
            app.try_state::<local_environment_setup::SetupState>(),
        ) {
            cleanup.invalidate(&state.desktop_state, &setup);
        }
        request_worktree_cleanup(app);
    }
}

fn request_worktree_cleanup(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let cleanup = app.state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>();
        if let Err(error) = cleanup.request_cleanup(&state).await {
            eprintln!("工作树自动清理排队失败：{error}");
        }
        let _ = app.emit("worktree:cleanup-requested", ());
    });
}

#[tauri::command]
fn shortcut_menu_sync(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, menu::ShortcutMenuState>,
    accelerators: std::collections::BTreeMap<String, Option<String>>,
    capturing: Option<bool>,
) -> Result<(), String> {
    menu::sync_shortcut_menu(&app, &state, accelerators, window.label(), capturing.unwrap_or(false))
}

#[tauri::command]
async fn app_server_status(state: State<'_, AppState>) -> Result<AppServerStatus, String> {
    Ok(state.app_server.get_status().await)
}

#[tauri::command]
async fn git_message_generate(app:AppHandle,window:tauri::WebviewWindow,state:State<'_,AppState>,generation:State<'_,git_message_generation::GenerationState>,request:git_message_generation::GenerationRequest)->Result<git_message_generation::GenerationResponse,String> {
    git_message_generation::generate(&generation,&state.app_server,&app,window.label(),request).await
}

#[tauri::command]
fn git_message_generation_cancel(window:tauri::WebviewWindow,state:State<'_,git_message_generation::GenerationState>,operation_id:String)->Result<bool,String> {
    state.cancel(window.label(),&operation_id)
}

#[tauri::command]
async fn git_message_context(cwd:String,mode:String,include_unstaged:bool,base_branch:Option<String>)->Result<git::GitMessageContext,String> {
    tauri::async_runtime::spawn_blocking(move||git::message_generation_context(&cwd,&mode,include_unstaged,base_branch)).await.map_err(|error|error.to_string())?
}

#[tauri::command]
async fn app_server_connect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppServerStatus, String> {
    state.app_server.ensure_connected(&app).await
}

#[tauri::command]
async fn app_server_restart(
    app: AppHandle,
    state: State<'_, AppState>,
    custom_cli_path: Option<String>,
) -> Result<AppServerStatus, String> {
    if custom_cli_path.is_some() {
        state.app_server.set_custom_cli_path(custom_cli_path).await;
    }
    state.app_server.restart(&app).await
}

#[tauri::command]
async fn app_server_call(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    if method == "getAuthStatus" {
        return Err("认证状态令牌只能由宿主服务读取".to_string());
    }
    if matches!(method.as_str(), "account/logout" | "account/login/start") {
        invalidate_chatgpt_service(&app);
    }
    let attachment_mutation = matches!(method.as_str(), "thread/attachment/add" | "thread/attachment/remove")
        && params.as_ref().and_then(|params| params["attachmentType"].as_str()) == Some("worktree");
    let attachment_protection = if attachment_mutation {
        let path = params.as_ref().and_then(|params| params["identityKey"].as_str())
            .ok_or("工作树附件缺少明确路径，未执行。")?;
        Some(app.state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>().protect_attachment(path)?)
    } else { None };
    let res = if window.label().starts_with("thread-") && matches!(method.as_str(), "fs/watch" | "fs/unwatch") {
        app.state::<thread_window::ThreadWindowState>()
            .call_watch(window.label(), &method, params.clone(), |params| {
                state.app_server.call(&app, &method, params)
            })
            .await?
    } else if method == "turn/start" {
        let (result, warning) = state
            .desktop_state
            .call_turn_with_workspace(
                params.clone().unwrap_or(Value::Null),
                |rpc_method, request| {
                    let app = &app;
                    let state = &state;
                    async move { state.app_server.call(app, &rpc_method, Some(request)).await }
                },
            )
            .await?;
        if let Some(message) = warning {
            let _ = app.emit(
                "thread-workspace:sync-warning",
                json!({
                    "threadId": params.as_ref().and_then(|params| params.get("threadId")),
                    "message": message,
                }),
            );
        }
        result
    } else if plugin_operations::is_plugin_mutation(&method, params.as_ref()) {
        state.app_server.ensure_connected(&app).await?;
        let generation = state.app_server.connection_generation().await;
        let result = app.state::<plugin_operations::PluginOperationState>()
            .call(&method, params.clone(), |method, params| {
                let app = &app;
                let state = &state;
                async move {
                    if state.app_server.connection_generation().await != generation {
                        return Err("插件操作所属连接已更改，请重新读取状态".to_string());
                    }
                    state.app_server.call(app, &method, params).await
                }
            }).await;
        let _ = app.emit("plugin-management-changed", json!({}));
        if is_mcp_config_write(&method, params.as_ref()) {
            let _ = app.emit("mcp-settings-changed", json!({}));
        }
        result?
    } else {
        let result = state.app_server.call(&app, &method, params.clone()).await;
        if is_mcp_config_write(&method, params.as_ref()) {
            // An unsuccessful response can still follow a delivered write. Ask
            // other windows to reread; never broadcast config values or secrets.
            let _ = app.emit("mcp-settings-changed", json!({}));
        }
        result?
    };
    if method == "thread/start" {
        let tid = res
            .get("threadId")
            .or_else(|| res.get("conversationId"))
            .or_else(|| res.get("thread").and_then(|t| t.get("id")))
            .and_then(|v| v.as_str());
        let cwd = params
            .as_ref()
            .and_then(|p| p.get("cwd"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                res.get("thread")
                    .and_then(|t| t.get("cwd"))
                    .and_then(|v| v.as_str())
            });
        if let (Some(t), Some(c)) = (tid, cwd) {
            state.desktop_state.record_thread_workspace(t, c);
            let cleanup = app.state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>();
            if let Some(root) = git::find_git_root(c).filter(|root| cleanup.is_newborn(root)) {
                git::set_worktree_owner_thread(&root, t)?;
                cleanup.release_worktree(&root);
                request_worktree_cleanup(&app);
            }
        }
    }
    drop(attachment_protection);
    if attachment_mutation { request_worktree_cleanup(&app); }
    Ok(res)
}

fn is_mcp_config_write(method: &str, params: Option<&Value>) -> bool {
    let Some(params) = params else { return false; };
    let mcp_key = |value: &Value| value.get("keyPath").and_then(Value::as_str)
        .is_some_and(|key| key == "mcp_servers" || key.starts_with("mcp_servers.")
            || key == "\"mcp_servers\"" || key.starts_with("\"mcp_servers\"."));
    match method {
        "config/value/write" => mcp_key(params),
        "config/batchWrite" => params.get("edits").and_then(Value::as_array)
            .is_some_and(|edits| edits.iter().any(mcp_key)),
        _ => false,
    }
}

#[cfg(test)]
mod mcp_config_event_tests {
    use super::*;

    #[test]
    fn writes_invalidate_other_windows_without_matching_values_or_other_config() {
        assert!(is_mcp_config_write("config/value/write", Some(&json!({"keyPath":"mcp_servers.\"a.b\".enabled","value":false}))));
        assert!(is_mcp_config_write("config/batchWrite", Some(&json!({"edits":[{"keyPath":"\"mcp_servers\".\"a.b\".\"enabled\"","value":false}]}))));
        assert!(is_mcp_config_write("config/batchWrite", Some(&json!({"edits":[{"keyPath":"model","value":"x"},{"keyPath":"mcp_servers.\"a.b\".http_headers.\"X.Secret\"","value":"fixture-only"}]}))));
        assert!(!is_mcp_config_write("config/read", Some(&json!({"keyPath":"mcp_servers"}))));
        assert!(!is_mcp_config_write("config/value/write", Some(&json!({"keyPath":"mcp_servers_other","value":"mcp_servers.foo"}))));
        assert!(!is_mcp_config_write("config/batchWrite", Some(&json!({"edits":[{"keyPath":"model","value":"mcp_servers.foo"}]}))));
        assert!(!is_mcp_config_write("config/batchWrite", None));
    }
}

#[tauri::command]
async fn chatgpt_service_identity(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<chatgpt_service::ServiceIdentity, chatgpt_service::ServiceError> {
    state.chatgpt_service.identity(&request_id, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn chatgpt_service_read(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::ServiceRequest,
) -> Result<chatgpt_service::ServiceResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.read(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn chatgpt_service_site_pin(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::SitesPinRequest,
) -> Result<chatgpt_service::SitesPinResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.site_pin(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn remote_plugin_inventory(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::RemotePluginInventoryRequest,
) -> Result<chatgpt_service::RemotePluginInventoryResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.remote_plugin_inventory(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn remote_plugin_mutation(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::RemotePluginMutationRequest,
) -> Result<chatgpt_service::RemotePluginMutationResponse, chatgpt_service::ServiceError> {
    let _guard = app.state::<plugin_operations::PluginOperationState>().acquire_remote(&request.plugin_id)
        .map_err(|_| chatgpt_service::ServiceError { code: "plugin_busy", status: None, message: "该插件正在执行另一项操作，请等待完成后重新读取状态" })?;
    let result = state.chatgpt_service.remote_plugin_mutation(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await;
    let _ = app.emit("plugin-management-changed", ());
    result
}

#[tauri::command]
async fn account_notifications_read(
    app: AppHandle, state: State<'_, AppState>, request: chatgpt_service::AccountNotificationsRequest,
) -> Result<chatgpt_service::AccountNotificationsResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.account_notifications_read(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn account_notifications_write(
    app: AppHandle, state: State<'_, AppState>, request: chatgpt_service::AccountNotificationsWriteRequest,
) -> Result<chatgpt_service::ProfileMutationResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.account_notifications_write(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn profile_mutation(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::ProfileMutationRequest,
) -> Result<chatgpt_service::ProfileMutationResponse, chatgpt_service::ServiceError> {
    let identity = request.expected_identity.clone();
    let writes = !matches!(request.operation, chatgpt_service::ProfileMutationOperation::UsernameCheck);
    let result = state.chatgpt_service.profile_mutation(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await;
    if writes && (result.is_ok() || result.as_ref().err().is_some_and(|error| error.code == "profile_write_unknown")) {
        let _ = app.emit("account-profile-changed", serde_json::json!({"identity":identity}));
    }
    result
}

#[tauri::command]
async fn account_instructions_read(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::AccountInstructionsRequest,
) -> Result<chatgpt_service::AccountInstructionsResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.account_instructions_read(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn account_instructions_write(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::AccountInstructionsWriteRequest,
) -> Result<chatgpt_service::AccountInstructionsResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.account_instructions_write(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn share_thread_prepare(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::SharePrepareRequest,
) -> Result<chatgpt_service::SharePreparation, chatgpt_service::ServiceError> {
    state.chatgpt_service.share_prepare(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn share_thread_publish(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::SharePublishRequest,
) -> Result<chatgpt_service::PublishedShare, chatgpt_service::ServiceError> {
    state.chatgpt_service.share_publish(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
fn share_thread_discard(
    state: State<'_, AppState>,
    preparation_id: String,
    expected_identity: chatgpt_service::ServiceIdentity,
) -> Result<(), chatgpt_service::ServiceError> {
    state.chatgpt_service.share_discard(&preparation_id, &expected_identity)
}

#[tauri::command]
async fn share_thread_url_safe(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::ShareUrlSafeRequest,
) -> Result<bool, chatgpt_service::ServiceError> {
    state.chatgpt_service.share_url_safe(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn share_thread_asset_read(
    app: AppHandle,
    state: State<'_, AppState>,
    expected_identity: chatgpt_service::ServiceIdentity,
    host_id: String,
    thread_id: String,
    source: String,
    kind: String,
) -> Result<Option<share_assets::LocalShareAsset>, String> {
    if host_id != "local" || state.chatgpt_service.generation() != expected_identity.generation {
        return Err("分享主机或账号已改变。".into());
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let identity = state.chatgpt_service.identity(&request_id, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await.map_err(|error| error.message.to_string())?;
    if identity != expected_identity {
        return Err("分享账号已改变。".into());
    }
    let metadata = state.app_server.call(&app, "thread/read",
        Some(json!({"threadId":thread_id,"includeTurns":false}))).await?;
    if state.chatgpt_service.generation() != expected_identity.generation {
        return Err("分享账号已改变。".into());
    }
    let thread = metadata.get("thread").cloned().ok_or("无法读取分享会话。")?;
    let path = if source.starts_with("file:") {
        let url = tauri::Url::parse(&source).map_err(|_| "无效的分享文件地址。")?;
        if url.host_str().is_some_and(|host| host != "localhost" && !host.is_empty()) {
            return Err("分享不支持远程文件地址。".into());
        }
        url.to_file_path().map_err(|_| "无效的分享文件地址。")?
            .to_string_lossy().into_owned()
    } else {
        #[cfg(windows)]
        let source = if source.as_bytes().get(0) == Some(&b'/')
            && source.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic)
            && source.as_bytes().get(2) == Some(&b':') {
            source[1..].to_owned()
        } else { source };
        source
    };
    let home = state::codex_home_dir();
    let result = tauri::async_runtime::spawn_blocking(move ||
        share_assets::read_local_share_asset(&thread_id, &path, &kind, &thread, &home))
        .await.map_err(|_| "分享资产读取失败。")??;
    if state.chatgpt_service.generation() != expected_identity.generation {
        return Err("分享账号已改变。".into());
    }
    Ok(result)
}

fn share_system_version() -> Option<String> {
    static VERSION: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    VERSION.get_or_init(|| {
        #[cfg(windows)]
        let output = {
            use std::os::windows::process::CommandExt;
            let command = std::path::PathBuf::from(std::env::var_os("SystemRoot")?)
                .join("System32/cmd.exe");
            std::process::Command::new(command).args(["/d", "/c", "ver"])
                .creation_flags(0x08000000).output().ok()?
        };
        #[cfg(not(windows))]
        let output = std::process::Command::new("/usr/bin/uname").arg("-r").output().ok()?;
        if !output.status.success() { return None; }
        let value = String::from_utf8_lossy(&output.stdout).split_whitespace().collect::<Vec<_>>().join(" ");
        (!value.is_empty()).then_some(value)
    }).clone()
}

fn desktop_bootstrap_context(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<chatgpt_service::ShareBootstrapContext, chatgpt_service::ServiceError> {
    static SESSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    let version = share_system_version().ok_or(chatgpt_service::ServiceError {
        code: "desktop_context_unavailable", message: "Host system version unavailable", status: None,
    })?;
    Ok(chatgpt_service::ShareBootstrapContext {
        app_session_id: SESSION.get_or_init(|| uuid::Uuid::new_v4().to_string()).clone(),
        app_version: app.package_info().version.to_string(),
        brand_name: app.config().product_name.clone().unwrap_or_else(|| app.package_info().name.clone()),
        build_flavor: if cfg!(debug_assertions) { "debug" } else { "release" }.into(),
        system_name: std::env::consts::OS.into(), system_version: version,
        window_type: if window.label().starts_with("thread-") { "thread" } else { window.label() }.into(),
    })
}

#[tauri::command]
async fn share_thread_access(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    request: chatgpt_service::ShareAccessRequest,
) -> Result<Value, chatgpt_service::ServiceError> {
    let context = desktop_bootstrap_context(&app, &window)?;
    state.chatgpt_service.share_access_bootstrap(request, context, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn archive_conversations_read(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    request: chatgpt_service::ArchiveConversationsRequest,
) -> Result<chatgpt_service::ArchiveConversationsResponse, chatgpt_service::ServiceError> {
    let context = desktop_bootstrap_context(&app, &window)?;
    state.chatgpt_service.archive_conversations_read(request, context, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn archive_unarchive(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::ArchiveUnarchiveRequest,
) -> Result<chatgpt_service::ArchiveUnarchiveResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.archive_unarchive(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn archive_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::ArchiveDeleteRequest,
) -> Result<chatgpt_service::ArchiveDeleteResponse, chatgpt_service::ServiceError> {
    state.chatgpt_service.archive_delete(request, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn cloud_service_access(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<chatgpt_service::CloudAccess, chatgpt_service::ServiceError> {
    state.chatgpt_service.cloud_access(&request_id, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn cloud_service_identity(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<chatgpt_service::ServiceIdentity, chatgpt_service::ServiceError> {
    state.chatgpt_service.cloud_identity(&request_id, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
async fn cloud_service_read(
    app: AppHandle,
    state: State<'_, AppState>,
    request: chatgpt_service::CloudServiceRequest,
) -> Result<chatgpt_service::ServiceResponse, chatgpt_service::ServiceError> {
    let status = state.app_server.get_status().await;
    let user_agent = status.user_agent.filter(|value| !value.is_empty())
        .ok_or(chatgpt_service::ServiceError {
            code: "desktop_context_unavailable",
            message: "Desktop app-server context unavailable",
            status: None,
        })?;
    let profile = chatgpt_service::CloudProfile {
        user_agent,
        originator: "codex-tauri-native".to_owned(),
    };
    state.chatgpt_service.cloud_read(request, profile, |method, params| {
        let app = &app;
        let state = &state;
        async move { state.app_server.call(app, method, Some(params)).await }
    }).await
}

#[tauri::command]
fn chatgpt_service_cancel(state: State<'_, AppState>, request_id: String) -> bool {
    state.chatgpt_service.cancel(&request_id)
}

#[tauri::command]
async fn app_server_respond(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Value,
    generation: u64,
    result: Option<Value>,
    error: Option<Value>,
    notification_nonce: Option<String>,
) -> Result<(), String> {
    state
        .app_server
        .respond_to_server_request(&app, id, generation, result, error, notification_nonce)
        .await
}

#[tauri::command]
async fn app_server_pending_requests(
    state: State<'_, AppState>,
) -> Result<Vec<PendingServerRequest>, String> {
    Ok(state.app_server.list_pending_server_requests().await)
}

#[tauri::command]
fn workspace_list(state: State<'_, AppState>) -> Result<Vec<WorkspaceRootItem>, String> {
    Ok(state.desktop_state.list_workspace_roots())
}

#[tauri::command]
fn workspace_add(
    state: State<'_, AppState>,
    path: String,
    label: Option<String>,
    set_active: Option<bool>,
) -> Result<Vec<WorkspaceRootItem>, String> {
    state
        .desktop_state
        .add_workspace_root(&path, label, set_active.unwrap_or(true))
}

#[tauri::command]
fn workspace_remove(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<WorkspaceRootItem>, String> {
    Ok(state.desktop_state.remove_workspace_root(&path))
}

#[tauri::command]
fn workspace_set_active(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<WorkspaceRootItem>, String> {
    Ok(state.desktop_state.set_active_workspace_root(&path))
}

#[tauri::command]
fn workspace_select_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    let workspaces = state.desktop_state.select_local_project(&project_id)?;
    Ok(json!({
        "workspaces": workspaces,
        "projectMembership": state.desktop_state.sidebar_project_membership(),
    }))
}

#[tauri::command]
async fn thread_project_move_prepare(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    target_project_id: Option<String>,
) -> Result<Value, String> {
    state
        .desktop_state
        .prepare_thread_project_move_with_rpc(
            &thread_id, target_project_id.as_deref(), |method, params| {
                let app = &app;
                let state = &state;
                async move { state.app_server.call(app, &method, Some(params)).await }
            },
        ).await
}

#[tauri::command]
async fn thread_project_move_commit(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    target_project_id: Option<String>,
    plan: Value,
    confirm_missing_sources: bool,
) -> Result<Value, String> {
    let state_path = state::desktop_global_state_path();
    state.desktop_state.commit_thread_project_move_with_rpc(
        &thread_id,
        target_project_id.as_deref(),
        &plan,
        confirm_missing_sources,
        &state_path,
        |method, params| {
            let app = &app;
            let state = &state;
            async move { state.app_server.call(app, &method, Some(params)).await }
        },
    ).await
}

#[tauri::command]
async fn thread_project_move_reconcile(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Value, String> {
    let state_path = state::desktop_global_state_path();
    state.desktop_state.reconcile_thread_project_move_with_rpc(
        &thread_id,
        &state_path,
        |method, params| {
            let app = &app;
            let state = &state;
            async move { state.app_server.call(app, &method, Some(params)).await }
        },
    ).await
}

#[tauri::command]
async fn pick_folder_dialog() -> Result<Option<String>, String> {
    let picked = tokio::task::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    Ok(picked.map(|p| state::normalize_fs_path(&p.to_string_lossy())))
}

#[tauri::command]
async fn pick_files_dialog() -> Result<Vec<String>, String> {
    let picked = tokio::task::spawn_blocking(|| rfd::FileDialog::new().pick_files())
        .await
        .map_err(|e| e.to_string())?;
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .map(|p| state::normalize_fs_path(&p.to_string_lossy()))
        .collect())
}

#[tauri::command]
async fn workspace_agents_md(cwd: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || match find_agents_md(&cwd) {
        Some((path, content)) => Ok(json!({ "found": true, "path": path, "content": content })),
        None => Ok(json!({ "found": false, "path": null, "content": "" })),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_list_dir(
    path: String,
    show_hidden: Option<bool>,
) -> Result<Vec<DirectoryEntryItem>, String> {
    tokio::task::spawn_blocking(move || list_directory_entries(&path, show_hidden.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn fs_read_preview(path: String, max_bytes: Option<usize>) -> Result<FilePreviewResult, String> {
    read_file_preview(&path, max_bytes.unwrap_or(256 * 1024))
}

#[tauri::command]
fn fs_write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_search_files(
    cwd: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<WorkspaceFileHit>, String> {
    tokio::task::spawn_blocking(move || {
        Ok(search_workspace_files(
            &cwd,
            query.as_deref(),
            limit.unwrap_or(60),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn code_review_preferences_get(state: State<'_, AppState>) -> Result<Value, String> {
    state.desktop_state.review_preferences()
}

#[tauri::command]
fn code_review_preferences_update(app: AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, patch: Value) -> Result<Value, String> {
    let readback = state.desktop_state.update_review_preferences(patch)?;
    for label in app.webview_windows().keys().filter(|label| label.as_str() != window.label()) {
        let _ = app.emit_to(label.as_str(), "code-review-preferences-changed", ());
    }
    Ok(readback)
}

#[tauri::command]
fn desktop_state_get(state: State<'_, AppState>, key: String) -> Result<Value, String> {
    Ok(state.desktop_state.get_value(&key))
}

#[tauri::command]
fn desktop_state_set(state: State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    state.desktop_state.set_value_persisted(&key, value)
}

#[tauri::command]
fn thread_record_workspace(
    state: State<'_, AppState>,
    thread_id: String,
    cwd: String,
) -> Result<(), String> {
    state
        .desktop_state
        .record_thread_workspace(&thread_id, &cwd);
    Ok(())
}

#[tauri::command]
fn threads_meta_get(state: State<'_, AppState>) -> Result<Value, String> {
    let pinned: Vec<String> = state.desktop_state.list_pinned_threads();
    let archived: Vec<Value> = state.desktop_state.list_archived_threads();
    let workspace_hints: HashMap<String, String> = state.desktop_state.get_thread_workspace_hints();
    Ok(json!({
        "pinnedThreadIds": pinned,
        "archivedThreads": archived,
        "workspaceHints": workspace_hints,
        "projectMembership": state.desktop_state.sidebar_project_membership(),
    }))
}

#[tauri::command]
fn thread_toggle_pin(
    state: State<'_, AppState>,
    thread_id: String,
    pinned: bool,
) -> Result<Vec<String>, String> {
    Ok(state.desktop_state.toggle_thread_pinned(&thread_id, pinned))
}

#[tauri::command]
async fn thread_archive_toggle(
    app: AppHandle,
    state: State<'_, AppState>,
    thread: Value,
    archive: bool,
) -> Result<Vec<Value>, String> {
    thread_archive_with(
        thread,
        archive,
        |method, params| state.app_server.call(&app, method, Some(params)),
        |thread, archive| state.desktop_state.update_archived_thread(thread, archive),
    ).await
}

async fn thread_archive_with<Call, Rpc, Merge>(
    thread: Value,
    archive: bool,
    call: Call,
    merge: Merge,
) -> Result<Vec<Value>, String>
where
    Call: FnOnce(&'static str, Value) -> Rpc,
    Rpc: std::future::Future<Output = Result<Value, String>>,
    Merge: FnOnce(Value, bool) -> Vec<Value>,
{
    let tid = thread.get("id").and_then(Value::as_str).ok_or("Missing thread.id")?.to_string();
    let method = if archive { "thread/archive" } else { "thread/unarchive" };
    call(method, json!({"threadId": tid})).await?;
    Ok(merge(thread, archive))
}

#[cfg(test)]
mod thread_archive_tests {
    use super::*;
    use std::cell::RefCell;

    #[tokio::test]
    async fn service_failure_preserves_records_for_archive_and_unarchive() {
        for archive in [true, false] {
            let original = vec![json!({"id":"target","name":"original"}), json!({"id":"other"})];
            let records = RefCell::new(original.clone());
            let writes = RefCell::new(0);
            let result = thread_archive_with(
                json!({"id":"target","name":"new"}), archive,
                |method, params| async move {
                    assert_eq!(method, if archive { "thread/archive" } else { "thread/unarchive" });
                    assert_eq!(params, json!({"threadId":"target"}));
                    Err("fixture server rejected request".to_string())
                },
                |_, _| { *writes.borrow_mut() += 1; records.borrow().clone() },
            ).await;
            assert_eq!(result, Err("fixture server rejected request".to_string()));
            assert_eq!(*records.borrow(), original);
            assert_eq!(*writes.borrow(), 0);
        }
    }

    #[tokio::test]
    async fn success_merges_records_changed_while_rpc_was_pending() {
        for archive in [true, false] {
            let records = RefCell::new(vec![json!({"id":"target","name":"old"}), json!({"id":"removed"})]);
            let (complete, reply) = tokio::sync::oneshot::channel();
            let operation = thread_archive_with(
                json!({"id":"target","name":"new"}), archive,
                |method, params| async move {
                    assert_eq!(method, if archive { "thread/archive" } else { "thread/unarchive" });
                    assert_eq!(params, json!({"threadId":"target"}));
                    reply.await.unwrap()
                },
                |thread, archive| {
                    let mut latest = records.borrow_mut();
                    latest.retain(|item| item["id"] != thread["id"]);
                    if archive { latest.insert(0, thread); }
                    latest.clone()
                },
            );
            let concurrent_change = async {
                tokio::task::yield_now().await;
                *records.borrow_mut() = vec![json!({"id":"concurrent"}), json!({"id":"target","name":"old"})];
                complete.send(Ok(Value::Null)).unwrap();
            };
            let (result, ()) = tokio::join!(operation, concurrent_change);
            let expected = if archive {
                vec![json!({"id":"target","name":"new"}), json!({"id":"concurrent"})]
            } else { vec![json!({"id":"concurrent"})] };
            assert_eq!(result.unwrap(), expected);
            assert_eq!(*records.borrow(), expected);
        }
    }
}

#[tauri::command]
async fn thread_delete_archived(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: Option<String>,
) -> Result<archive_delete::ArchivedDeleteResult, String> {
    archive_delete::delete_archived(
        thread_id.as_deref(),
        |method, params| state.app_server.call(&app, method, Some(params)),
        |id| state.desktop_state.remove_thread_record(id),
    )
    .await
}

#[tauri::command]
async fn thread_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    state
        .app_server
        .call(
            &app,
            "thread/delete",
            Some(json!({ "threadId": &thread_id })),
        )
        .await?;
    state.desktop_state.remove_thread_record(&thread_id);
    Ok(())
}

#[tauri::command]
fn reveal_path_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .args(["/select,", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let target = if p.is_dir() {
            p
        } else {
            p.parent().unwrap_or(p)
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_open_preferences(state: State<'_, AppState>) -> desktop_open::DesktopOpenPreferences {
    desktop_open::preferences(&state.desktop_state)
}

#[tauri::command]
fn desktop_open_preference_set(state: State<'_, AppState>, kind: String, value: String) -> Result<(), String> {
    desktop_open::set_preference(&state.desktop_state, &kind, &value)
}

#[tauri::command]
async fn desktop_open_targets(
    app: AppHandle, state: State<'_, AppState>, thread_id: Option<String>, cwd: Option<String>,
) -> Result<desktop_open::WorkspaceOpenTargets, String> {
    let cwd = desktop_open_context::resolve(&app, &state, thread_id.as_deref(), cwd.as_deref()).await?;
    let desktop_state = state.desktop_state.clone();
    tauri::async_runtime::spawn_blocking(move || desktop_open::workspace_targets(&desktop_state, cwd))
        .await.map_err(|error| format!("读取打开方式失败：{error}"))?
}

#[tauri::command]
async fn desktop_open_workspace(
    app: AppHandle, state: State<'_, AppState>, thread_id: Option<String>, cwd: Option<String>, target: String,
) -> Result<(), String> {
    let cwd = desktop_open_context::resolve(&app, &state, thread_id.as_deref(), cwd.as_deref()).await?;
    let desktop_state = state.desktop_state.clone();
    tauri::async_runtime::spawn_blocking(move || desktop_open::open_workspace(&desktop_state, &cwd, &target))
        .await.map_err(|error| format!("打开工作区失败：{error}"))?
}

#[tauri::command]
fn review_link_open(url: String) -> Result<(), String> {
    desktop_open::open_review_link(&url)
}

#[tauri::command]
async fn open_path_external(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let desktop_state = state.desktop_state.clone();
    tauri::async_runtime::spawn_blocking(move || desktop_open::open_external(&desktop_state, &path))
        .await.map_err(|error| format!("打开文件失败：{error}"))?
}

fn help_link_command(target: &str) -> Result<std::process::Command, String> {
    let url = match target {
        "guide" => "https://learn.chatgpt.com/docs/quickstart",
        "changelog" => "https://developers.openai.com/codex/changelog",
        "configuration" => "https://developers.openai.com/codex/config-basic",
        "global-guidance" => "https://developers.openai.com/codex/guides/agents-md/#create-global-guidance",
        _ => return Err("未知帮助链接".to_string()),
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("explorer.exe");
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url);
    Ok(command)
}

#[tauri::command]
fn open_help_link(target: String) -> Result<(), String> {
    help_link_command(&target)?
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod help_link_tests {
    use super::help_link_command;

    #[test]
    fn rejects_arbitrary_urls_paths_and_shell_arguments() {
        for target in [
            "",
            "https://example.invalid",
            "file:///C:/Windows",
            "guide & calc",
            "guide\n",
            "--help",
            "changelog?x=1",
        ] {
            assert!(help_link_command(target).is_err(), "accepted {target:?}");
        }
    }

    #[test]
    fn official_link_is_a_single_argument_without_a_shell() {
        let command = help_link_command("guide").unwrap();
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![std::ffi::OsStr::new(
                "https://learn.chatgpt.com/docs/quickstart"
            )]
        );
        let program = command.get_program().to_string_lossy();
        assert!(["explorer.exe", "open", "xdg-open"].contains(&program.as_ref()));
        let command = help_link_command("changelog").unwrap();
        assert_eq!(command.get_args().count(), 1);
        assert_eq!(
            command.get_args().next().unwrap(),
            "https://developers.openai.com/codex/changelog"
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptCommands {
    pub run_command: String,
    pub test_command: String,
    pub build_command: String,
    pub project_type: String,
}

fn detect_project_scripts_internal(cwd: &str) -> ProjectScriptCommands {
    let root = std::path::Path::new(cwd);
    let pkg_json_path = root.join("package.json");
    if pkg_json_path.is_file() {
        let pm = if root.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if root.join("yarn.lock").exists() {
            "yarn"
        } else if root.join("bun.lockb").exists() || root.join("bun.lock").exists() {
            "bun"
        } else {
            "npm"
        };

        let mut run_cmd = format!("{} run dev", pm);
        let mut test_cmd = format!("{} test", pm);
        let mut build_cmd = format!("{} run build", pm);

        if let Ok(content) = std::fs::read_to_string(&pkg_json_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(scripts) = parsed.get("scripts").and_then(|s| s.as_object()) {
                    if scripts.contains_key("dev") {
                        run_cmd = format!("{} run dev", pm);
                    } else if scripts.contains_key("start") {
                        run_cmd = if pm == "npm" {
                            "npm start".to_string()
                        } else {
                            format!("{} start", pm)
                        };
                    } else if scripts.contains_key("serve") {
                        run_cmd = format!("{} run serve", pm);
                    }

                    if !scripts.contains_key("test") {
                        test_cmd = format!("{} test", pm);
                    }

                    if scripts.contains_key("build") {
                        build_cmd = format!("{} run build", pm);
                    }
                }
            }
        }

        return ProjectScriptCommands {
            run_command: run_cmd,
            test_command: test_cmd,
            build_command: build_cmd,
            project_type: "node".to_string(),
        };
    }

    if root.join("Cargo.toml").is_file() {
        return ProjectScriptCommands {
            run_command: "cargo run".to_string(),
            test_command: "cargo test".to_string(),
            build_command: "cargo build".to_string(),
            project_type: "rust".to_string(),
        };
    }

    if root.join("pyproject.toml").is_file()
        || root.join("requirements.txt").is_file()
        || root.join("Pipfile").is_file()
    {
        let run_cmd = if root.join("main.py").is_file() {
            "python main.py".to_string()
        } else if root.join("app.py").is_file() {
            "python app.py".to_string()
        } else if root.join("manage.py").is_file() {
            "python manage.py runserver".to_string()
        } else {
            "python main.py".to_string()
        };
        return ProjectScriptCommands {
            run_command: run_cmd,
            test_command: "pytest".to_string(),
            build_command: "python -m build".to_string(),
            project_type: "python".to_string(),
        };
    }

    if root.join("go.mod").is_file() {
        return ProjectScriptCommands {
            run_command: "go run .".to_string(),
            test_command: "go test ./...".to_string(),
            build_command: "go build".to_string(),
            project_type: "go".to_string(),
        };
    }

    if root.join("Makefile").is_file() {
        return ProjectScriptCommands {
            run_command: "make run".to_string(),
            test_command: "make test".to_string(),
            build_command: "make build".to_string(),
            project_type: "make".to_string(),
        };
    }

    ProjectScriptCommands {
        run_command: "npm run dev".to_string(),
        test_command: "npm test".to_string(),
        build_command: "npm run build".to_string(),
        project_type: "generic".to_string(),
    }
}

#[tauri::command]
async fn detect_project_scripts(cwd: String) -> Result<ProjectScriptCommands, String> {
    tokio::task::spawn_blocking(move || detect_project_scripts_internal(&cwd))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn git_status(cwd: String) -> Result<GitStatusInfo, String> {
    tokio::task::spawn_blocking(move || Ok(git::git_status_for_path(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn git_diff(
    cwd: String,
    file_path: Option<String>,
    staged: Option<bool>,
    base_branch: Option<String>,
    review_base_commit: Option<String>,
) -> Result<String, String> {
    git::git_diff_for_path(
        &cwd,
        file_path,
        staged.unwrap_or(false),
        base_branch,
        review_base_commit,
    )
}

#[tauri::command]
async fn git_merge_base(cwd: String, base_branch: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::merge_base(&cwd, &base_branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn git_stage(cwd: String, file_path: Option<String>) -> Result<GitStatusInfo, String> {
    git::git_stage_file(&cwd, file_path)?;
    Ok(git::git_status_for_path(&cwd))
}

#[tauri::command]
fn git_unstage(cwd: String, file_path: Option<String>) -> Result<GitStatusInfo, String> {
    git::git_unstage_file(&cwd, file_path)?;
    Ok(git::git_status_for_path(&cwd))
}

#[tauri::command]
fn git_discard(cwd: String, file_path: String) -> Result<GitStatusInfo, String> {
    git::git_discard_file(&cwd, &file_path)?;
    Ok(git::git_status_for_path(&cwd))
}

#[tauri::command]
fn git_commit_changes(cwd: String, message: String) -> Result<String, String> {
    git::git_commit(&cwd, &message)
}

#[tauri::command]
async fn git_branches(cwd: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || git::list_branches(&cwd))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn git_branch_create(
    cwd: String,
    branch: String,
    checkout: Option<bool>,
) -> Result<GitStatusInfo, String> {
    git::create_branch(&cwd, &branch, checkout.unwrap_or(true))?;
    Ok(git::git_status_for_path(&cwd))
}

#[tauri::command]
fn git_branch_checkout(cwd: String, branch: String) -> Result<GitStatusInfo, String> {
    git::checkout_branch(&cwd, &branch)?;
    Ok(git::git_status_for_path(&cwd))
}

#[tauri::command]
fn git_worktrees_list(state: State<'_, AppState>, cwd: Option<String>) -> Result<Vec<GitWorktreeInfo>, String> {
    let roots = git::managed_worktree_roots(&state.desktop_state.get_value(git::WORKTREE_ROOT_KEY))?;
    Ok(git::list_worktrees_at_roots(cwd, &roots))
}

#[tauri::command]
async fn git_worktree_create(
    state: State<'_, AppState>,
    setup: State<'_, local_environment_setup::SetupState>,
    cleanup: State<'_, worktree_cleanup_runtime::WorktreeCleanupRuntime>,
    window: tauri::WebviewWindow,
    source_cwd: String,
    starting_mode: String,
    branch_name: Option<String>,
    owner_thread_id: Option<String>,
    operation_id: Option<String>,
) -> Result<GitWorktreeInfo, String> {
    let roots = git::managed_worktree_roots(&state.desktop_state.get_value(git::WORKTREE_ROOT_KEY))?;
    let desktop = state.desktop_state.clone();
    let owner = window.label().to_owned();
    let operation_id = operation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    setup.reopen_owner(&owner);
    let operation = setup.prepare_operation(&owner, &operation_id)?;
    if let Err(error) = window.is_visible() {
        setup.cancel(&owner, &operation_id);
        return Err(format!("工作树创建窗口已关闭：{error}"));
    }
    let shell = Some(desktop_open::preferences(&desktop).preferred_shell);
    let refresh_mode = worktree_preferences::read(&desktop, "local")?.preferences.upstream_refresh_mode;
    let progress_id = operation_id.clone();
    let progress_window = window.clone();
    let source_protection = cleanup.protect_source_repository(&source_cwd)?;
    let result = tokio::task::spawn_blocking(move || {
        let selection = serde_json::to_value(local_environment::selection_get(&desktop, &source_cwd)?).map_err(|error| error.to_string())?;
        let explicit = selection.get("explicit").and_then(Value::as_bool).ok_or("环境选择状态无效。")?;
        let config_path = if explicit {
            match &selection["configPath"] { Value::Null => None, Value::String(path) => Some(path.clone()), _ => return Err("环境选择路径无效。".into()) }
        } else {
            let list = serde_json::to_value(local_environment::list(&source_cwd)?).map_err(|error| error.to_string())?;
            list["defaultPath"].as_str().map(str::to_owned)
        };
        let refresh_log_window = progress_window.clone();
        let refresh_log_id = progress_id.clone();
        let log: worktree_upstream::LogSink = std::sync::Arc::new(move |kind, text| {
            let _ = refresh_log_window.emit_to(tauri::EventTarget::webview_window(refresh_log_window.label()), "worktree:create-progress", json!({
                "operationId": refresh_log_id, "phase": "upstream-refresh", "kind": kind, "text": text,
            }));
        });
        let refresh_mode_name = if starting_mode == "HEAD" { "branch" } else { &starting_mode };
        let refresh_request = worktree_upstream::RefreshRequest {
            cwd: &source_cwd,
            starting_mode: refresh_mode_name,
            branch_name: if starting_mode == "HEAD" { Some("HEAD") } else { branch_name.as_deref() },
            remote_ref: None,
            resolved_starting_commit: None,
            mode: refresh_mode,
        };
        worktree_upstream::refresh(refresh_request.clone(), &operation, operation.upstream_skip_signal(), log)?;
        let resolved_ref = worktree_upstream::resolve_starting_ref(&refresh_request, &operation)?;
        operation.check()?;
        let _ = progress_window.emit_to(tauri::EventTarget::webview_window(progress_window.label()), "worktree:create-progress", json!({"operationId": progress_id, "phase": "creating"}));
        let branch_name = if starting_mode == "branch" { Some(resolved_ref) } else { branch_name };
        local_environment_setup::create_worktree_prepared(operation, &source_cwd, &starting_mode, branch_name, owner_thread_id, &roots[0], config_path, shell)
    }).await.map_err(|error| error.to_string()).and_then(|result| result);
    if let Ok(worktree) = &result { cleanup.protect_worktree(&worktree.path); }
    drop(source_protection);
    request_worktree_cleanup(window.app_handle());
    result
}

#[tauri::command]
fn git_worktree_create_cancel(window: tauri::WebviewWindow, setup: State<'_, local_environment_setup::SetupState>, operation_id: String) {
    setup.cancel(window.label(), &operation_id);
}

#[tauri::command]
fn git_worktree_refresh_skip(window: tauri::WebviewWindow, setup: State<'_, local_environment_setup::SetupState>, operation_id: String) {
    setup.skip_upstream_refresh(window.label(), &operation_id);
}

#[tauri::command]
fn worktree_preferences_read(state: State<'_, AppState>, host_id: String) -> Result<worktree_preferences::WorktreePreferencesSnapshot, String> {
    worktree_preferences::read(&state.desktop_state, &host_id)
}

#[tauri::command]
fn worktree_preferences_write(state: State<'_, AppState>, host_id: String, preferences: worktree_preferences::WorktreePreferences, expected: Value) -> Result<worktree_preferences::WorktreePreferencesSnapshot, String> {
    worktree_preferences::update(&state.desktop_state, &host_id, preferences, expected)
}

#[tauri::command]
async fn worktree_policy_inventory(state: State<'_, AppState>) -> Result<worktree_inventory::Inventory, String> {
    let roots = git::managed_worktree_roots(&state.desktop_state.get_value(git::WORKTREE_ROOT_KEY))?;
    tokio::task::spawn_blocking(move || worktree_inventory::collect(&roots)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn worktree_cleanup_prepare(state: State<'_, AppState>, cleanup: State<'_, worktree_cleanup_runtime::WorktreeCleanupRuntime>, window: tauri::WebviewWindow) -> Result<Option<worktree_cleanup_runtime::CleanupPreparation>, String> {
    window.is_visible().map_err(|error| format!("工作树清理窗口已关闭：{error}"))?;
    cleanup.reopen_window(window.label());
    cleanup.prepare(&state, window.label()).await
}

#[tauri::command]
async fn worktree_cleanup_execute(state: State<'_, AppState>, cleanup: State<'_, worktree_cleanup_runtime::WorktreeCleanupRuntime>, setup: State<'_, local_environment_setup::SetupState>, window: tauri::WebviewWindow, token: String, candidate_paths: Vec<String>) -> Result<worktree_cleanup_runtime::CleanupReport, String> {
    window.is_visible().map_err(|error| format!("工作树清理窗口已关闭：{error}"))?;
    let result = cleanup.execute(&state, &setup, window.label(), &token, candidate_paths).await?;
    if !result.deleted.is_empty() { let _ = window.app_handle().emit("worktrees-reload-requested", ()); }
    Ok(result)
}

#[tauri::command]
fn worktree_cleanup_cancel(state: State<'_, AppState>, cleanup: State<'_, worktree_cleanup_runtime::WorktreeCleanupRuntime>, setup: State<'_, local_environment_setup::SetupState>, window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    cleanup.cancel_token(&state.desktop_state, &setup, window.label(), &token)
}

#[tauri::command]
async fn git_worktree_delete(state: State<'_, AppState>, setup: State<'_, local_environment_setup::SetupState>, window: tauri::WebviewWindow, worktree_path: String, git_dir: Option<String>, operation_id: Option<String>) -> Result<git::WorktreeRemovalResult, String> {
    let owner = window.label().to_owned();
    let id = operation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    setup.reopen_owner(&owner);
    let operation = setup.prepare_operation(&owner, &id)?;
    if let Err(error) = window.is_visible() { setup.cancel(&owner, &id); return Err(format!("删除窗口已关闭：{error}")); }
    let shell = Some(desktop_open::preferences(&state.desktop_state).preferred_shell);
    let result = tokio::task::spawn_blocking(move || git::delete_worktree_with_cleanup_context(&worktree_path, git_dir, operation, shell))
        .await
        .map_err(|e| e.to_string())??;
    window.app_handle().state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>()
        .release_worktree(&result.worktree_path);
    request_worktree_cleanup(window.app_handle());
    Ok(result)
}

#[tauri::command]
fn git_worktree_delete_cancel(window: tauri::WebviewWindow, setup: State<'_, local_environment_setup::SetupState>, operation_id: String) {
    setup.cancel(window.label(), &operation_id);
}

#[tauri::command]
async fn git_worktree_delete_prepare(worktree_path: String, git_dir: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::validate_worktree_removal(&worktree_path, git_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_worktree_restore_snapshot(repo_cwd: String, snapshot_ref: String, target_path: String) -> Result<git::WorktreeRemovalResult, String> {
    tokio::task::spawn_blocking(move || git::restore_worktree_snapshot(&repo_cwd, &snapshot_ref, &target_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_worktree_bring_changes_back(
    worktree_path: String,
    target_cwd: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        git::bring_worktree_changes_back(&worktree_path, &target_cwd)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_worktree_repair(cwd: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::repair_worktrees(&cwd))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn git_worktree_set_owner(app: AppHandle, worktree_path: String, thread_id: String) -> Result<(), String> {
    git::set_worktree_owner_thread(&worktree_path, &thread_id)?;
    app.state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>().release_worktree(&worktree_path);
    request_worktree_cleanup(&app);
    Ok(())
}

#[tauri::command]
fn gh_status() -> Result<GhCliStatus, String> {
    Ok(git::check_gh_cli_status())
}

#[tauri::command]
fn git_log_commits(cwd: String, limit: Option<usize>) -> Result<Vec<GitCommitInfo>, String> {
    git::list_commits(&cwd, limit.unwrap_or(50))
}

#[tauri::command]
fn git_commit_diff(cwd: String, commit_hash: String) -> Result<String, String> {
    git::commit_diff(&cwd, &commit_hash)
}

#[tauri::command]
fn git_push_changes(cwd: String, force_with_lease: Option<bool>) -> Result<String, String> {
    git::push_changes(&cwd, force_with_lease.unwrap_or(false))
}

#[tauri::command]
fn git_create_pr(
    cwd: String,
    title: String,
    body: String,
    base_branch: Option<String>,
    draft: Option<bool>,
) -> Result<String, String> {
    git::create_pull_request(&cwd, &title, &body, base_branch, draft.unwrap_or(false))
}

#[tauri::command]
fn git_list_prs(cwd: String, limit: Option<usize>) -> Result<Vec<git::GitPullRequestInfo>, String> {
    git::list_pull_requests(&cwd, limit)
}

#[tauri::command]
fn storage_stats_get() -> Result<StorageStatsOverview, String> {
    Ok(config_skills::compute_storage_stats())
}

#[tauri::command]
fn import_external_tool_config(kind: String, cwd: Option<String>) -> Result<Value, String> {
    config_skills::import_external_tool_config(&kind, cwd.as_deref())
}

#[tauri::command]
fn local_environment_read(cwd: String, file_name: Option<String>) -> Result<Value, String> {
    local_environment::read(&cwd, file_name.as_deref())
}

#[tauri::command]
fn local_environment_save(cwd: String, file_name: String, content: String, expected_content: Option<String>) -> Result<Value, String> {
    local_environment::save(&cwd, &file_name, &content, expected_content.as_deref())
}

#[tauri::command]
fn local_environment_action(cwd: String, file_name: String, expected_content: String, index: usize) -> Result<String, String> {
    local_environment::action(&cwd, &file_name, &expected_content, index)
}

#[tauri::command]
fn local_environments_list(cwd: String) -> Result<Value, String> {
    serde_json::to_value(local_environment::list(&cwd)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_read_config(cwd: String, config_path: String) -> Result<Value, String> {
    serde_json::to_value(local_environment::runtime_read_config(&cwd, &config_path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_save_config(cwd: String, config_path: Option<String>, environment: local_environment::Environment, expected_content: Option<String>) -> Result<Value, String> {
    serde_json::to_value(local_environment::runtime_save_config(&cwd, config_path.as_deref(), environment, expected_content.as_deref())?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_selection_get(state: State<'_, AppState>, cwd: String) -> Result<Value, String> {
    serde_json::to_value(local_environment::selection_get(&state.desktop_state, &cwd)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_select(state: State<'_, AppState>, cwd: String, config_path: Option<String>) -> Result<Value, String> {
    serde_json::to_value(local_environment::select(&state.desktop_state, &cwd, config_path.as_deref())?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_action_config(cwd: String, config_path: String, expected_content: String, index: usize) -> Result<String, String> {
    local_environment::action_config(&cwd, &config_path, &expected_content, index)
}

#[tauri::command]
fn local_environment_runtime(state: State<'_, AppState>, cwd: String) -> Result<Value, String> {
    serde_json::to_value(local_environment::runtime(&state.desktop_state, &cwd)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_runtime_select(state: State<'_, AppState>, cwd: String, config_path: Option<String>) -> Result<Value, String> {
    serde_json::to_value(local_environment::runtime_select(&state.desktop_state, &cwd, config_path.as_deref())?).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_environment_recent_actions_get(state: State<'_, AppState>, cwd: String, config_path: String) -> Result<Vec<String>, String> {
    local_environment::recent_actions_get(&state.desktop_state, &cwd, &config_path)
}

#[tauri::command]
fn local_environment_record_action(state: State<'_, AppState>, cwd: String, config_path: String, expected_content: String, index: usize) -> Result<Vec<String>, String> {
    local_environment::record_action(&state.desktop_state, &cwd, &config_path, &expected_content, index)
}

#[tauri::command]
fn terminal_run_environment_action(app: AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, session_id: String, cwd: String, config_path: String, expected_content: String, index: usize, cols: Option<u16>, rows: Option<u16>, shell: Option<String>) -> Result<TerminalSessionInfo, String> {
    let (execution_cwd, command, _) = local_environment::selected_action(&state.desktop_state, &cwd, &config_path, &expected_content, index)?;
    let shell = Some(shell.filter(|value| !value.is_empty()).unwrap_or_else(|| desktop_open::preferences(&state.desktop_state).preferred_shell));
    state.terminal.run_action(&app, window.label(), &session_id, &execution_cwd, &command, cols.unwrap_or(100), rows.unwrap_or(28), shell)
}

#[tauri::command]
fn terminal_create_or_attach(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    let _access = state.terminal.authorize(window.label(), &session_id)?;
    #[cfg(target_os = "windows")]
    let shell = Some(shell.filter(|value| !value.is_empty()).unwrap_or_else(|| {
        desktop_open::preferences(&state.desktop_state).preferred_shell
    }));
    state.terminal.create_or_attach(
        &app,
        &session_id,
        &cwd,
        cols.unwrap_or(100),
        rows.unwrap_or(28),
        shell,
    )
}

#[tauri::command]
fn terminal_write(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let _access = state.terminal.authorize(window.label(), &session_id)?;
    state.terminal.write(&session_id, &data)
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let _access = state.terminal.authorize(window.label(), &session_id)?;
    state.terminal.resize(&session_id, cols, rows)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ShellExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[tauri::command]
async fn exec_shell_command(cwd: String, command: String) -> Result<ShellExecResult, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let mut cmd = std::process::Command::new("powershell");
        #[cfg(target_os = "windows")]
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &command]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = std::process::Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        cmd.args(["-c", &command]);

        cmd.current_dir(&cwd);
        let output = cmd.output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);
        Ok(ShellExecResult {
            exit_code,
            stdout,
            stderr,
            success: output.status.success(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn terminal_close(state: State<'_, AppState>, window: tauri::WebviewWindow, session_id: String) -> Result<(), String> {
    let _access = state.terminal.authorize(window.label(), &session_id)?;
    state.terminal.close(&session_id)
}

#[tauri::command]
fn config_read() -> Result<CodexConfigOverview, String> {
    config_skills::read_config_overview()
}

#[tauri::command]
fn config_save_raw(raw_toml: String) -> Result<CodexConfigOverview, String> {
    config_skills::save_raw_config_toml(&raw_toml)
}

#[tauri::command]
fn config_update(payload: CodexConfigUpdatePayload) -> Result<CodexConfigOverview, String> {
    config_skills::update_structured_config(payload)
}

#[tauri::command]
fn config_generate_models_api() -> Result<String, String> {
    config_skills::generate_sample_models_api_catalog()
}

#[tauri::command]
async fn pets_list_installed() -> Result<Vec<pets::InstalledPetInfo>, String> {
    tokio::task::spawn_blocking(pets::list_installed).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn pet_preferences_get(state: State<'_, AppState>) -> Result<Value, String> {
    state.desktop_state.pet_preferences()
}

#[tauri::command]
fn pet_preferences_update(state: State<'_, AppState>, patch: Value) -> Result<Value, String> {
    state.desktop_state.update_pet_preferences(patch)
}

#[tauri::command]
fn pets_open_folder() -> Result<(), String> {
    pets::open_folder()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppshotResult {
    pub path: String,
    pub name: String,
}

#[tauri::command]
async fn capture_appshot() -> Result<AppshotResult, String> {
    tokio::task::spawn_blocking(|| {
        let appshots_dir = state::codex_home_dir().join("appshots");
        std::fs::create_dir_all(&appshots_dir).map_err(|e| e.to_string())?;

        let file_name = format!("appshot_{}.png", uuid::Uuid::new_v4());
        let out_path = appshots_dir.join(&file_name);
        let out_path_str = out_path.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        {
            let ps_script =
                "$ErrorActionPreference = 'Stop'; \
                 Add-Type -AssemblyName System.Windows.Forms; \
                 Add-Type -AssemblyName System.Drawing; \
                 $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
                 $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height; \
                 try { \
                   $graphics = [System.Drawing.Graphics]::FromImage($bitmap); \
                   try { \
                     $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); \
                     $bitmap.Save($env:CODEX_APPSHOT_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png); \
                   } finally { $graphics.Dispose(); } \
                 } finally { $bitmap.Dispose(); }";

            let mut cmd = std::process::Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
                .env("CODEX_APPSHOT_OUTPUT", &out_path);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let status = cmd.status().map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Failed to capture screen using Windows Drawing API".to_string());
            }
        }

        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("screencapture")
                .arg("-x")
                .arg(&out_path_str)
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Failed to capture screen using screencapture".to_string());
            }
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let status = std::process::Command::new("grim")
                .arg(&out_path_str)
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Failed to capture screen using grim".to_string());
            }
        }

        let bytes = std::fs::read(&out_path).map_err(|e| e.to_string())?;
        tauri::image::Image::from_bytes(&bytes)
            .map_err(|e| format!("Captured screenshot is not a valid image: {e}"))?;

        Ok(AppshotResult {
            path: out_path_str,
            name: file_name,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn skills_list_local(workspace_root: Option<String>) -> Result<Vec<SkillInfoItem>, String> {
    tokio::task::spawn_blocking(move || {
        Ok(config_skills::list_local_and_recommended_skills(
            workspace_root,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn skill_save_or_install(
    id: String,
    content: String,
    source_dir: Option<String>,
) -> Result<SkillInfoItem, String> {
    config_skills::save_or_install_skill(&id, &content, source_dir)
}

#[tauri::command]
async fn recommended_skills_list(refresh: bool) -> Result<recommended_skills::RecommendedSkillsResult, String> {
    tokio::task::spawn_blocking(move || recommended_skills::list_recommended_skills(refresh))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn recommended_skill_install(
    state: State<'_, AppState>,
    skill_id: String,
    repo_path: String,
    install_root: Option<String>,
) -> Result<recommended_skills::RecommendedSkillInstallResult, String> {
    if let Some(root) = &install_root {
        if !std::path::Path::new(root).is_absolute() {
            return Err("项目技能安装需要绝对项目根目录".into());
        }
        let canonical = fs::canonicalize(root).map_err(|e| e.to_string())?;
        if !state.desktop_state.list_workspace_roots().iter().any(|workspace| {
            fs::canonicalize(&workspace.path).map(|path| path == canonical).unwrap_or(false)
        }) {
            return Err("技能只能安装到当前已登记的项目根目录".into());
        }
    }
    tokio::task::spawn_blocking(move || {
        recommended_skills::install_recommended_skill(&skill_id, &repo_path, install_root)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn skill_delete(id: String) -> Result<(), String> {
    config_skills::delete_installed_skill(&id)
}

#[tauri::command]
fn automations_list() -> Result<Vec<AutomationItem>, String> {
    Ok(config_skills::list_automations())
}

#[tauri::command]
fn automation_save(item: AutomationItem) -> Result<Vec<AutomationItem>, String> {
    config_skills::save_automation(item)
}

#[tauri::command]
fn automation_delete(id: String) -> Result<Vec<AutomationItem>, String> {
    config_skills::delete_automation(&id)
}

#[tauri::command]
fn automations_scheduler_status() -> Value {
    automations::scheduler_status()
}

#[tauri::command]
fn automations_refresh_schedule() -> Value {
    automations::refresh_schedule()
}

#[tauri::command]
async fn automations_run_now(app: AppHandle, id: String) -> Result<Value, String> {
    automations::run_now(app, id).await
}

/// Show a native OS notification (Windows toast / macOS / Linux).
/// Frontend gates this by user preference before calling.
#[tauri::command]
fn show_desktop_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification failed: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    let mut primary_instance = {
        let executable = match std::env::current_exe() {
            Ok(path) => path,
            Err(error) => { eprintln!("无法定位应用实例：{error}"); return; }
        };
        let scope = match instance_transport::instance_scope(&executable, &state::codex_home_dir()) {
            Ok(scope) => scope,
            Err(error) => { eprintln!("无法定位应用数据目录：{error}"); return; }
        };
        let args = std::env::args_os().skip(1).filter_map(|arg| arg.into_string().ok())
            .filter(|arg| {
                let lower = arg.to_ascii_lowercase();
                lower.starts_with("codex:") || lower.starts_with("codex-dev:")
            }).collect();
        match instance_transport::acquire_or_forward(&scope, args) {
            Ok(Some(instance)) => instance,
            Ok(None) => return,
            Err(error) => {
                eprintln!("应用实例启动失败：{error}");
                rfd::MessageDialog::new().set_title("无法启动 Codex")
                    .set_description(&error).set_level(rfd::MessageLevel::Error).show();
                return;
            }
        }
    };
    #[cfg(windows)]
    let mut instance_receiver = primary_instance.take_receiver();
    let app_state = AppState {
        app_server: AppServerManager::new(),
        chatgpt_service: chatgpt_service::ChatgptService::default(),
        desktop_state: DesktopStateManager::new(),
        terminal: TerminalManager::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            use tauri::Manager;
            let cleanup_app = app.handle().clone();
            app.listen("app-server:status", move |event| {
                let Ok(status) = serde_json::from_str::<AppServerStatus>(event.payload()) else { return; };
                if status.connected {
                    request_worktree_cleanup(&cleanup_app);
                } else {
                    let state = cleanup_app.state::<AppState>();
                    let setup = cleanup_app.state::<local_environment_setup::SetupState>();
                    cleanup_app.state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>()
                        .invalidate(&state.desktop_state, &setup);
                }
            });
            let attachment_app = app.handle().clone();
            app.listen("app-server:notification", move |event| {
                let Ok(value) = serde_json::from_str::<Value>(event.payload()) else { return; };
                if value["method"] != "thread/attachment/updated" || value["params"]["attachmentType"] != "worktree" { return; }
                if let Some(path) = value["params"]["identityKey"].as_str() {
                    attachment_app.state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>().attachment_changed(path);
                    request_worktree_cleanup(&attachment_app);
                }
            });
            #[cfg(windows)]
            if let Some(mut receiver) = instance_receiver.take() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(args) = receiver.recv().await {
                        if let Err(error) = deep_links::receive_args(&handle, &args).await {
                            eprintln!("无法接收应用链接：{error}");
                        }
                    }
                    eprintln!("应用实例接收器已停止。");
                    // The pipe guard lost its listener. Do not leave an orphan primary
                    // alive while another launch can acquire the same scope.
                    handle.exit(1);
                });
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Native application menu (File / Edit / View / Window / Help).
            // Menu item clicks are forwarded to the webview as `native-menu`
            // events and consumed by `src/nativeShell.ts`.
            let app_menu = menu::build_app_menu(app.handle())?;
            app.set_menu(app_menu)?;
            app.on_menu_event(|handle, event| {
                menu::handle_menu_event(handle, event.id().as_ref());
            });

            // System tray icon + context menu (Open / New Chat / Quit).
            // A failure here must not prevent the app from starting (e.g. on
            // environments without a tray), so it is only logged.
            if let Err(err) = menu::build_tray(app.handle()) {
                eprintln!("[menu] failed to build system tray: {err}");
            }

            // Local automation scheduler: scans RRULE automations every 30s and
            // executes due ones through the app-server. Idempotent.
            automations::start(app.handle().clone());

            Ok(())
        })
        .manage(app_state)
        .manage(deep_links::DeepLinkState::default())
        .manage(menu::ShortcutMenuState::default())
        .manage(keybindings::KeyBindingsState::default())
        .manage(personal_instructions::PersonalInstructionsState::default())
        .manage(appearance_preferences::AppearancePreferencesState::default())
        .manage(quick_chat::QuickChatState::default())
        .manage(thread_window::ThreadWindowState::default())
        .manage(notification_broker::NotificationBroker::default())
        .manage(notification_preferences::NotificationPreferencesState::default())
        .manage(model_preferences::ModelPreferencesState::default())
        .manage(agent_configuration::AgentConfigurationState::default())
        .manage(memory_preferences::MemoryPreferencesState::default())
        .manage(plugin_operations::PluginOperationState::default())
        .manage(git_message_generation::GenerationState::default())
        .manage(remote_review::RemoteReviewState::default())
        .manage(local_environment_setup::SetupState::default())
        .manage(worktree_cleanup_runtime::WorktreeCleanupRuntime::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.app_handle().state::<AppState>();
                let setup = window.app_handle().state::<local_environment_setup::SetupState>();
                window.app_handle().state::<worktree_cleanup_runtime::WorktreeCleanupRuntime>()
                    .cancel_window(&state.desktop_state, &setup, window.label());
                if let Err(error) = window.app_handle().state::<AppState>().terminal.close_owner(window.label()) {
                    eprintln!("Cannot close window action terminals: {error}");
                }
                window.app_handle().state::<git_message_generation::GenerationState>().cancel_owner(window.label());
                window.app_handle().state::<remote_review::RemoteReviewState>().cancel_owner(window.label());
                window.app_handle().state::<local_environment_setup::SetupState>().cancel_owner(window.label());
                if let Err(error) = menu::remove_shortcut_window(window.app_handle(), window.label()) {
                    eprintln!("Cannot restore native shortcuts after window close: {error}");
                }
                window.app_handle().state::<notification_broker::NotificationBroker>()
                    .remove_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            deep_links::deep_link_pending,
            deep_links::deep_link_acknowledge,
            notification_broker::notification_view_update,
            notification_broker::notification_claim,
            notification_preferences::notification_preferences_read,
            notification_preferences::notification_preference_write,
            model_preferences::model_preferences_read,
            model_preferences::model_preferences_write_default,
            model_preferences::model_recent_record,
            agent_configuration::agent_configuration_read,
            agent_configuration::agent_configuration_write,
            agent_configuration::agent_configuration_open,
            memory_preferences::memory_preferences_read,
            memory_preferences::memory_preferences_write,
            memory_preferences::memory_preferences_reset,
            desktop_notifications::desktop_notification_show,
            desktop_notifications::desktop_notification_hide,
            desktop_notifications::desktop_notification_hide_conversation,
            desktop_notifications::desktop_notification_hide_all,
            desktop_notifications::notification_account_context,
            desktop_notifications::notification_permission_read,
            desktop_notifications::notification_settings_open,
            notification_audio::notification_audio_pick,
            notification_audio::notification_audio_store,
            notification_audio::notification_audio_play,
            notification_audio::notification_audio_stop,
            thread_window::open_thread_window,
            quick_chat::quick_chat_toggle,
            quick_chat::quick_chat_hide,
            quick_chat::quick_chat_continue,
            image_save::generated_image_save,
            chatgpt_service_identity,
            chatgpt_service_read,
            chatgpt_service_site_pin,
            remote_plugin_inventory,
            remote_plugin_mutation,
            profile_mutation,
            account_notifications_read,
            account_notifications_write,
            account_instructions_read,
            account_instructions_write,
            share_thread_prepare,
            share_thread_publish,
            share_thread_discard,
            share_thread_url_safe,
            share_thread_asset_read,
            share_thread_access,
            archive_conversations_read,
            archive_unarchive,
            archive_delete,
            chatgpt_service_cancel,
            cloud_service_identity,
            cloud_service_access,
            cloud_service_read,
            shortcut_menu_sync,
            keybindings::keyboard_bindings_read,
            keybindings::keyboard_bindings_write,
            keybindings::keyboard_number_target_read,
            keybindings::keyboard_number_target_write,
            personal_instructions::personal_instructions_read,
            personal_instructions::personal_instructions_write,
            app_server_status,
            app_server_connect,
            app_server_restart,
            app_server_call,
            git_message_generate,
            git_message_generation_cancel,
            git_message_context,
            app_server_respond,
            app_server_pending_requests,
            workspace_list,
            workspace_add,
            workspace_remove,
            workspace_set_active,
            workspace_select_project,
            thread_project_move_prepare,
            thread_project_move_commit,
            thread_project_move_reconcile,
            pick_folder_dialog,
            pick_files_dialog,
            workspace_agents_md,
            fs_list_dir,
            fs_read_preview,
            fs_write_file,
            fs_search_files,
            code_review_preferences_get,
            remote_review::code_review_private_preflight,
            remote_review::code_review_private_cancel,
            review_provider::code_review_provider_read,
            review_provider::code_review_pull_request_read,
            review_provider::code_review_comparison_read,
            review_provider::code_review_revision_file_read,
            review_provider::code_review_provider_update,
            code_review_preferences_update,
            desktop_state_get,
            desktop_state_set,
            appearance_preferences::appearance_preferences_read,
            system_fonts::system_font_families,
            appearance_preferences::appearance_preference_write,
            thread_record_workspace,
            threads_meta_get,
            thread_toggle_pin,
            thread_archive_toggle,
            thread_delete,
            thread_delete_archived,
            reveal_path_in_explorer,
            review_link_open,
            open_path_external,
            desktop_open_preferences,
            desktop_open_preference_set,
            desktop_open_targets,
            desktop_open_workspace,
            open_help_link,
            detect_project_scripts,
            git_status,
            git_diff,
            git_merge_base,
            git_stage,
            git_unstage,
            git_discard,
            git_commit_changes,
            git_branches,
            git_branch_create,
            git_branch_checkout,
            git_worktrees_list,
            git_worktree_create,
            git_worktree_create_cancel,
            git_worktree_refresh_skip,
            git_worktree_delete,
            worktree_preferences_read,
            worktree_preferences_write,
            worktree_policy_inventory,
            worktree_cleanup_prepare,
            worktree_cleanup_execute,
            worktree_cleanup_cancel,
            git_worktree_delete_cancel,
            git_worktree_delete_prepare,
            git_worktree_restore_snapshot,
            git_worktree_bring_changes_back,
            git_worktree_repair,
            git_worktree_set_owner,
            gh_status,
            git_log_commits,
            git_commit_diff,
            git_push_changes,
            git_create_pr,
            git_list_prs,
            storage_stats_get,
            import_external_tool_config,
            local_environment_read,
            local_environment_save,
            local_environment_action,
            local_environments_list,
            local_environment_read_config,
            local_environment_save_config,
            local_environment_selection_get,
            local_environment_select,
            local_environment_runtime,
            local_environment_runtime_select,
            local_environment_recent_actions_get,
            local_environment_record_action,
            terminal_run_environment_action,
            local_environment_action_config,
            terminal_create_or_attach,
            terminal_write,
            terminal_resize,
            terminal_close,
            config_read,
            config_save_raw,
            config_update,
            config_generate_models_api,
            skills_list_local,
            recommended_skills_list,
            recommended_skill_install,
            skill_save_or_install,
            skill_delete,
            automations_list,
            automation_save,
            automation_delete,
            automations_scheduler_status,
            automations_refresh_schedule,
            automations_run_now,
            pets_list_installed,
            pet_preferences_get,
            pet_preferences_update,
            pets_open_folder,
            capture_appshot,
            show_desktop_notification,
            exec_shell_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running codex-tauri application");
}
