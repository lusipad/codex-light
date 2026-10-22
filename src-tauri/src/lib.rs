pub mod app_server;
pub mod config_skills;
pub mod git;
pub mod menu;
pub mod state;
pub mod terminal;

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
use tauri::{AppHandle, State};
use terminal::{TerminalManager, TerminalSessionInfo};

pub struct AppState {
    pub app_server: AppServerManager,
    pub desktop_state: DesktopStateManager,
    pub terminal: TerminalManager,
}

#[tauri::command]
async fn app_server_status(state: State<'_, AppState>) -> Result<AppServerStatus, String> {
    Ok(state.app_server.get_status().await)
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
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let res = state.app_server.call(&app, &method, params.clone()).await?;
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
        }
    }
    Ok(res)
}

#[tauri::command]
async fn app_server_respond(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Value,
    result: Option<Value>,
    error: Option<Value>,
) -> Result<(), String> {
    state
        .app_server
        .respond_to_server_request(&app, id, result, error)
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
fn workspace_agents_md(cwd: String) -> Result<Value, String> {
    match find_agents_md(&cwd) {
        Some((path, content)) => Ok(json!({ "found": true, "path": path, "content": content })),
        None => Ok(json!({ "found": false, "path": null, "content": "" })),
    }
}

#[tauri::command]
fn fs_list_dir(
    path: String,
    show_hidden: Option<bool>,
) -> Result<Vec<DirectoryEntryItem>, String> {
    list_directory_entries(&path, show_hidden.unwrap_or(false))
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
fn fs_search_files(
    cwd: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<WorkspaceFileHit>, String> {
    Ok(search_workspace_files(
        &cwd,
        query.as_deref(),
        limit.unwrap_or(60),
    ))
}

#[tauri::command]
fn desktop_state_get(state: State<'_, AppState>, key: String) -> Result<Value, String> {
    Ok(state.desktop_state.get_value(&key))
}

#[tauri::command]
fn desktop_state_set(state: State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    state.desktop_state.set_value(&key, value);
    Ok(())
}

#[tauri::command]
fn thread_record_workspace(
    state: State<'_, AppState>,
    thread_id: String,
    cwd: String,
) -> Result<(), String> {
    state.desktop_state.record_thread_workspace(&thread_id, &cwd);
    Ok(())
}

#[tauri::command]
fn threads_meta_get(state: State<'_, AppState>) -> Result<Value, String> {
    let pinned: Vec<String> = state.desktop_state.list_pinned_threads();
    let archived: Vec<Value> = state.desktop_state.list_archived_threads();
    let workspace_hints: HashMap<String, String> =
        state.desktop_state.get_thread_workspace_hints();
    Ok(json!({
        "pinnedThreadIds": pinned,
        "archivedThreads": archived,
        "workspaceHints": workspace_hints,
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
    let tid = thread
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing thread.id")?
        .to_string();
    let mut archived = state.desktop_state.list_archived_threads();
    archived.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(&tid));
    if archive {
        archived.insert(0, thread);
        let _ = state
            .app_server
            .call(&app, "thread/archive", Some(json!({ "threadId": tid })))
            .await;
    } else {
        let _ = state
            .app_server
            .call(&app, "thread/unarchive", Some(json!({ "threadId": tid })))
            .await;
    }
    state.desktop_state.set_archived_threads(archived.clone());
    Ok(archived)
}

#[tauri::command]
async fn thread_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    state.desktop_state.remove_thread_record(&thread_id);
    let _ = state
        .app_server
        .call(&app, "thread/delete", Some(json!({ "threadId": &thread_id })))
        .await;
    let _ = state
        .app_server
        .call(&app, "thread/archive", Some(json!({ "threadId": &thread_id })))
        .await;
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
        let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Opens a file or directory with the OS native handler.
///
/// Used by the native Help → "Open config.toml" menu item (the frontend
/// invokes it with the path sent in the `native-menu` payload) and available to
/// any other frontend feature that needs "open externally".
///
/// * Windows: directories via `explorer`, files via `notepad` (no console window).
/// * macOS: `open`; other unix: `xdg-open`.
#[tauri::command]
fn open_path_external(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = if p.is_dir() {
            let mut c = std::process::Command::new("explorer");
            c.arg(&path);
            c
        } else {
            let mut c = std::process::Command::new("notepad");
            c.arg(&path);
            c
        };
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptCommands {
    pub run_command: String,
    pub test_command: String,
    pub build_command: String,
    pub project_type: String,
}

#[tauri::command]
fn detect_project_scripts(cwd: String) -> ProjectScriptCommands {
    let root = std::path::Path::new(&cwd);
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
                        run_cmd = if pm == "npm" { "npm start".to_string() } else { format!("{} start", pm) };
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

    if root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() || root.join("Pipfile").is_file() {
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
fn git_status(cwd: String) -> Result<GitStatusInfo, String> {
    Ok(git::git_status_for_path(&cwd))
}

#[tauri::command]
fn git_diff(
    cwd: String,
    file_path: Option<String>,
    staged: Option<bool>,
    base_branch: Option<String>,
) -> Result<String, String> {
    git::git_diff_for_path(&cwd, file_path, staged.unwrap_or(false), base_branch)
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
fn git_branches(cwd: String) -> Result<Vec<String>, String> {
    git::list_branches(&cwd)
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
fn git_worktrees_list(cwd: Option<String>) -> Result<Vec<GitWorktreeInfo>, String> {
    Ok(git::list_worktrees(cwd))
}

#[tauri::command]
fn git_worktree_create(
    source_cwd: String,
    starting_mode: String,
    branch_name: Option<String>,
    owner_thread_id: Option<String>,
) -> Result<GitWorktreeInfo, String> {
    git::create_codex_worktree(&source_cwd, &starting_mode, branch_name, owner_thread_id)
}

#[tauri::command]
fn git_worktree_delete(worktree_path: String, git_dir: Option<String>) -> Result<(), String> {
    git::delete_worktree(&worktree_path, git_dir)
}

#[tauri::command]
fn git_worktree_set_owner(worktree_path: String, thread_id: String) -> Result<(), String> {
    git::set_worktree_owner_thread(&worktree_path, &thread_id)
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
fn storage_stats_get() -> Result<StorageStatsOverview, String> {
    Ok(config_skills::compute_storage_stats())
}

#[tauri::command]
fn storage_clean_cache() -> Result<u64, String> {
    config_skills::clean_storage_cache()
}

#[tauri::command]
fn import_external_tool_config(kind: String, cwd: Option<String>) -> Result<Value, String> {
    config_skills::import_external_tool_config(&kind, cwd.as_deref())
}

#[tauri::command]
fn local_environment_read(cwd: String) -> Result<Value, String> {
    config_skills::read_local_environment_toml(&cwd)
}

#[tauri::command]
fn local_environment_save(cwd: String, content: String) -> Result<String, String> {
    config_skills::save_local_environment_toml(&cwd, &content)
}

#[tauri::command]
fn terminal_create_or_attach(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<TerminalSessionInfo, String> {
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
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.terminal.write(&session_id, &data)
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
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
fn terminal_close(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
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
fn skills_list_local(workspace_root: Option<String>) -> Result<Vec<SkillInfoItem>, String> {
    Ok(config_skills::list_local_and_recommended_skills(
        workspace_root,
    ))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        app_server: AppServerManager::new(),
        desktop_state: DesktopStateManager::new(),
        terminal: TerminalManager::new(),
    };

    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
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

            Ok(())
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            app_server_status,
            app_server_connect,
            app_server_restart,
            app_server_call,
            app_server_respond,
            app_server_pending_requests,
            workspace_list,
            workspace_add,
            workspace_remove,
            workspace_set_active,
            pick_folder_dialog,
            pick_files_dialog,
            workspace_agents_md,
            fs_list_dir,
            fs_read_preview,
            fs_write_file,
            fs_search_files,
            desktop_state_get,
            desktop_state_set,
            thread_record_workspace,
            threads_meta_get,
            thread_toggle_pin,
            thread_archive_toggle,
            thread_delete,
            reveal_path_in_explorer,
            open_path_external,
            detect_project_scripts,
            git_status,
            git_diff,
            git_stage,
            git_unstage,
            git_discard,
            git_commit_changes,
            git_branches,
            git_branch_create,
            git_branch_checkout,
            git_worktrees_list,
            git_worktree_create,
            git_worktree_delete,
            git_worktree_set_owner,
            gh_status,
            git_log_commits,
            git_commit_diff,
            git_push_changes,
            git_create_pr,
            storage_stats_get,
            storage_clean_cache,
            import_external_tool_config,
            local_environment_read,
            local_environment_save,
            terminal_create_or_attach,
            terminal_write,
            terminal_resize,
            terminal_close,
            config_read,
            config_save_raw,
            config_update,
            config_generate_models_api,
            skills_list_local,
            skill_save_or_install,
            skill_delete,
            automations_list,
            automation_save,
            automation_delete,
            exec_shell_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running codex-tauri application");
}
