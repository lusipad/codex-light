use crate::state::DesktopStateManager;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static OPEN_PREFERENCE_LOCK: Mutex<()> = Mutex::new(());
const TARGET_IDS: &[&str] = &["vscode", "vscodeInsiders", "cursor", "sublimeText", "zed", "antigravity", "systemDefault", "fileManager"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTarget {
    pub id: String,
    pub label: String,
    pub executable: String,
    pub kind: String,
    pub hidden: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenTargets {
    pub cwd: String,
    pub targets: Vec<OpenTarget>,
    pub preferred_target: Option<String>,
}

fn target(id: &str, label: &str, executable: String) -> OpenTarget {
    OpenTarget { id: id.into(), label: label.into(), executable,
        kind: if id == "systemDefault" { "systemDefault" } else if id == "fileManager" { "fileManager" } else { "editor" }.into(),
        hidden: id == "systemDefault", available: true }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellTarget {
    pub id: String,
    pub label: String,
    pub executable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOpenPreferences {
    pub platform: String,
    pub targets: Vec<OpenTarget>,
    pub preferred_target: Option<String>,
    pub shells: Vec<ShellTarget>,
    pub preferred_shell: String,
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for root in std::env::split_paths(&path) {
        let candidate = root.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(target_os = "windows")]
        for suffix in ["", ".exe", ".cmd", ".bat"] {
            let candidate = root.join(format!("{name}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") { roots.push(PathBuf::from(local).join("Programs")); }
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(key) { roots.push(PathBuf::from(root)); }
    }
    roots
}

fn editor_executable(names: &[&str], exe: &str, directory: &str) -> Option<PathBuf> {
    for name in names {
        if let Some(cli) = executable_on_path(name) {
            for root in cli.ancestors().skip(1).take(5) {
                let native = root.join(exe);
                if native.is_file() { return Some(native); }
            }
            if cli.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe")) { return Some(cli); }
        }
    }
    install_roots().into_iter().map(|root| root.join(directory).join(exe)).find(|path| path.is_file())
}

fn available_targets() -> Vec<OpenTarget> {
    let mut result = Vec::new();
    for (id, label, cli, exe, directory) in [
        ("vscode", "Visual Studio Code", "code", "Code.exe", "Microsoft VS Code"),
        ("vscodeInsiders", "Visual Studio Code Insiders", "code-insiders", "Code - Insiders.exe", "Microsoft VS Code Insiders"),
        ("cursor", "Cursor", "cursor", "Cursor.exe", "Cursor"),
        ("sublimeText", "Sublime Text", "subl", "sublime_text.exe", "Sublime Text"),
        ("zed", "Zed", "zed", "Zed.exe", "Zed"),
        ("antigravity", "Antigravity", "antigravity", "Antigravity.exe", "Antigravity"),
    ] {
        if let Some(path) = editor_executable(&[cli, exe], exe, directory) {
            result.push(target(id, label, path.to_string_lossy().into_owned()));
        }
    }
    #[cfg(target_os = "windows")]
    {
        result.push(target("systemDefault", "系统默认应用", String::new()));
        let explorer = ["SystemRoot", "windir"].into_iter()
            .filter_map(std::env::var_os).map(|root| PathBuf::from(root).join("explorer.exe"))
            .find(|path| path.is_file()).unwrap_or_else(|| PathBuf::from("explorer.exe"));
        if explorer.is_file() {
            result.push(target("fileManager", "文件资源管理器", explorer.to_string_lossy().into_owned()));
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(executable) = executable_on_path(if cfg!(target_os = "macos") { "open" } else { "xdg-open" }) {
        result.push(target("systemDefault", "系统默认应用", executable.to_string_lossy().into_owned()));
    }

    result
}

fn shell_target(id: &str, label: &str, names: &[&str]) -> Option<ShellTarget> {
    names
        .iter()
        .find_map(|name| executable_on_path(name))
        .map(|path| ShellTarget {
            id: id.to_string(),
            label: label.to_string(),
            executable: path.to_string_lossy().into_owned(),
        })
}

fn available_shells() -> Vec<ShellTarget> {
    let mut result = Vec::new();
    if let Some(shell) = shell_target("powershell", "PowerShell", &["pwsh", "powershell"]) {
        result.push(shell);
    }
    let cmd_name = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    if Path::new(&cmd_name).is_file() || executable_on_path(&cmd_name).is_some() {
        result.push(ShellTarget {
            id: "commandPrompt".to_string(),
            label: "命令提示符".to_string(),
            executable: cmd_name,
        });
    }
    let git_bash = executable_on_path("git-bash.exe").or_else(|| {
        executable_on_path("git.exe").and_then(|git| {
            let parent = git.parent()?;
            [parent.join("bash.exe"), parent.join("../bin/bash.exe")].into_iter().find(|path| path.is_file())
        })
    }).or_else(|| install_roots().into_iter().map(|root| root.join("Git/bin/bash.exe")).find(|path| path.is_file()));
    if let Some(path) = git_bash {
        result.push(ShellTarget { id: "gitBash".into(), label: "Git Bash".into(), executable: path.to_string_lossy().into_owned() });
    }
    if let Some(shell) = shell_target("wsl", "WSL", &["wsl.exe", "wsl"]) {
        result.push(shell);
    }
    result
}

fn preferred_id(state: &DesktopStateManager, key: &str) -> Option<String> {
    let value = state.get_value(key);
    value.as_str().map(ToOwned::to_owned)
}

fn known_target(value: &serde_json::Value) -> Option<&str> {
    let id = match value.as_str()? { "finder" => "fileManager", id => id };
    TARGET_IDS.contains(&id).then_some(id)
}

fn normalized_preferences(stored: &serde_json::Value) -> serde_json::Value {
    let mut per_path = serde_json::Map::new();
    if let Some(paths) = stored.get("perPath").and_then(serde_json::Value::as_object) {
        for (path, value) in paths {
            if let Some(id) = known_target(value) { per_path.insert(path.clone(), json!(id)); }
        }
    }
    json!({"global": stored.get("global").and_then(known_target), "perPath": per_path})
}

fn preferred_target_id(stored: &serde_json::Value, targets: &[OpenTarget], cwd: Option<&str>) -> Option<String> {
    let normalized = normalized_preferences(stored);
    let id = cwd.and_then(|path| normalized.get("perPath")?.get(path)?.as_str())
        .or_else(|| normalized.get("global").and_then(serde_json::Value::as_str));
    id.filter(|id| targets.iter().any(|target| target.id == *id && target.available))
        .map(ToOwned::to_owned)
        .or_else(|| targets.iter().find(|target| target.available).map(|target| target.id.clone()))
}

fn updated_preferences(stored: &serde_json::Value, id: &str, cwd: Option<&str>) -> serde_json::Value {
    let mut next = normalized_preferences(stored);
    next["global"] = json!(id);
    if let Some(cwd) = cwd { next["perPath"][cwd] = json!(id); }
    next
}

pub fn preferences(state: &DesktopStateManager) -> DesktopOpenPreferences {
    let targets = available_targets();
    let shells = available_shells();
    let shell_id = preferred_id(state, "integratedTerminalShell")
        .filter(|id| shells.iter().any(|shell| shell.id == *id))
        .or_else(|| shells.first().map(|shell| shell.id.clone()))
        .unwrap_or_else(|| "powershell".to_string());
    DesktopOpenPreferences {
        platform: std::env::consts::OS.to_string(),
        preferred_target: preferred_target_id(&state.get_value("openInTargetPreferences"), &targets, None),
        targets,
        shells,
        preferred_shell: shell_id,
    }
}

pub fn set_preference(
    state: &DesktopStateManager,
    kind: &str,
    value: &str,
) -> Result<(), String> {
    let current = preferences(state);
    match kind {
        "target" if current.targets.iter().any(|target| target.id == value) => {
            let _guard = OPEN_PREFERENCE_LOCK.lock().map_err(|_| "打开方式偏好锁不可用")?;
            let previous = state.get_value("openInTargetPreferences");
            state.set_value_persisted(
                "openInTargetPreferences",
                updated_preferences(&previous, value, None),
            )
        }
        "shell" if current.shells.iter().any(|shell| shell.id == value) => {
            state.set_value_persisted("integratedTerminalShell", json!(value))
        }
        _ => Err("目标或 Shell 当前不可用".to_string()),
    }
}

pub fn resolve_shell(value: &str) -> Result<(String, Vec<String>), String> {
    let shells = available_shells();
    let id = match value { "powershell.exe" => "powershell", "cmd.exe" => "commandPrompt", "wsl.exe" => "wsl", other => other };
    if let Some(shell) = shells.iter().find(|shell| shell.id == id) {
        let args = if id == "gitBash" { vec!["--login".into(), "-i".into()] } else { vec![] };
        return Ok((shell.executable.clone(), args));
    }
    Err(format!("终端 Shell 不可用：{value}"))
}

fn open_command(target: &OpenTarget, path: &Path) -> Command {
    let mut cmd = Command::new(&target.executable);
    if target.id == "fileManager" && path.is_file() {
        let mut selected = std::ffi::OsString::from("/select,");
        selected.push(path);
        cmd.arg(selected);
    } else {
        cmd.arg(path);
    }
    cmd
}

// VS Code's installed code.cmd runs this CLI in Electron's Node mode. Recent
// Windows installs put resources under a version directory next to Code.exe.
fn electron_cli(executable: &Path) -> Option<PathBuf> {
    let root = executable.parent()?;
    let direct = root.join("resources/app/out/cli.js");
    if direct.is_file() { return Some(direct); }
    let mut candidates = std::fs::read_dir(root).ok()?.filter_map(Result::ok)
        .map(|entry| entry.path().join("resources/app/out/cli.js"))
        .filter(|path| path.is_file());
    let only = candidates.next()?;
    if candidates.next().is_some() { return None; }
    Some(only)
}

fn editor_cli_command(target: &OpenTarget, path: &Path) -> Option<Command> {
    if !["vscode", "vscodeInsiders", "cursor", "antigravity"].contains(&target.id.as_str()) { return None; }
    let cli = electron_cli(Path::new(&target.executable))?;
    let mut command = Command::new(&target.executable);
    command.env("ELECTRON_RUN_AS_NODE", "1").env_remove("VSCODE_DEV")
        .env_remove("NODE_OPTIONS").env_remove("NODE_REPL_EXTERNAL_MODULE")
        .arg(cli).arg(path);
    Some(command)
}

fn run_launcher(mut command: Command, label: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut child = command.spawn().map_err(|error| format!("无法在 {label} 打开：{error}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(25)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => format!("无法读取 {label} 启动器结果：{error}"),
                    _ => format!("{label} 启动器在 30 秒内未退出，未确认打开成功"),
                });
            }
        }
    };
    if !status.success() { return Err(format!("{label} 启动器退出失败：{status}")); }
    Ok(())
}

#[cfg(target_os = "windows")]
fn system_open(path: &Path) -> Result<(), String> {
    shell_open(path, None)
}

#[cfg(target_os = "windows")]
fn shell_open(path: &Path, parameters: Option<&std::ffi::OsStr>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(window: *mut std::ffi::c_void, operation: *const u16, file: *const u16,
            parameters: *const u16, directory: *const u16, show: i32) -> isize;
    }
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    if file[..file.len() - 1].contains(&0) { return Err("打开路径包含无效字符".into()); }
    let parameters: Option<Vec<u16>> = parameters.map(|value| value.encode_wide().chain(Some(0)).collect());
    if parameters.as_ref().is_some_and(|value| value[..value.len() - 1].contains(&0)) { return Err("打开参数包含无效字符".into()); }
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(),
        parameters.as_ref().map_or(std::ptr::null(), |value| value.as_ptr()), std::ptr::null(), 1) };
    if result <= 32 { return Err(format!("系统打开失败，Windows 错误码：{result}")); }
    Ok(())
}

#[cfg(target_os = "windows")]
fn quoted_windows_argument(value: &std::ffi::OsStr) -> std::ffi::OsString {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let mut result = vec![34_u16];
    let mut slashes = 0;
    for unit in value.encode_wide() {
        if unit == 92 { slashes += 1; continue; }
        result.extend(std::iter::repeat_n(92, slashes * if unit == 34 { 2 } else { 1 }));
        if unit == 34 { result.push(92); }
        result.push(unit);
        slashes = 0;
    }
    result.extend(std::iter::repeat_n(92, slashes * 2));
    result.push(34);
    std::ffi::OsString::from_wide(&result)
}

fn execute_target(target: &OpenTarget, path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if target.id == "systemDefault" { return system_open(path); }
        if !Path::new(&target.executable).is_file() { return Err(format!("{} 已不可用", target.label)); }
        if let Some(command) = editor_cli_command(target, path) { return run_launcher(command, &target.label); }
        // ShellExecute confirms Windows accepted the request, not GUI readiness.
        // Do not wait for the lifetime of a GUI executable.
        let command = open_command(target, path);
        let argument = command.get_args().next().ok_or("缺少打开参数")?;
        return shell_open(Path::new(&target.executable), Some(&quoted_windows_argument(argument)));
    }
    #[cfg(not(target_os = "windows"))]
    run_launcher(open_command(target, path), &target.label)
}

pub fn workspace_targets(state: &DesktopStateManager, cwd: String) -> Result<WorkspaceOpenTargets, String> {
    if !Path::new(&cwd).is_dir() { return Err(format!("工作区目录不存在：{cwd}")); }
    let targets = available_targets();
    let preferred_target = preferred_target_id(&state.get_value("openInTargetPreferences"), &targets, Some(&cwd));
    Ok(WorkspaceOpenTargets { cwd, targets, preferred_target })
}

fn persist_then_execute<F, G>(persist: F, execute: G) -> Result<(), String>
where F: FnOnce() -> Result<(), String>, G: FnOnce() -> Result<(), String> {
    persist()?;
    execute()
}

fn persist_workspace_target(state: &DesktopStateManager, cwd: &str, id: &str) -> Result<(), String> {
    let _guard = OPEN_PREFERENCE_LOCK.lock().map_err(|_| "打开方式偏好锁不可用")?;
    let next = updated_preferences(&state.get_value("openInTargetPreferences"), id, Some(cwd));
    state.set_value_persisted("openInTargetPreferences", next)
}

pub fn open_workspace(state: &DesktopStateManager, cwd: &str, id: &str) -> Result<(), String> {
    if !Path::new(cwd).is_dir() { return Err(format!("工作区目录不存在：{cwd}")); }
    let targets = available_targets();
    let target = targets.iter().find(|target| target.id == id && target.available)
        .ok_or_else(|| format!("打开目标当前不可用：{id}"))?;
    persist_then_execute(|| persist_workspace_target(state, cwd, id), || execute_target(target, Path::new(cwd)))
}

fn review_url(value: &str) -> Result<String, String> {
    let url = tauri::Url::parse(value).map_err(|_| "审查链接无效。")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
        || value.chars().any(char::is_control) {
        return Err("审查链接必须为无凭据的HTTPS地址。".to_string());
    }
    Ok(url.to_string())
}

pub fn open_review_link(value: &str) -> Result<(), String> {
    let url = review_url(value)?;
    #[cfg(target_os = "windows")]
    { system_open(Path::new(&url)) }
    #[cfg(not(target_os = "windows"))]
    {
        let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        Command::new(program).arg(url).spawn().map_err(|error| error.to_string())?;
        Ok(())
    }
}

pub fn open_external(state: &DesktopStateManager, path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if !path.exists() { return Err(format!("路径不存在: {}", path.display())); }
    let prefs = preferences(state);
    let target = prefs.targets.iter().find(|target| Some(&target.id) == prefs.preferred_target.as_ref())
        .ok_or_else(|| "未找到可用的文件打开目标".to_string())?;
    execute_target(target, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_preferences_external_links_reject_non_https_credentials_and_controls() {
        for value in ["file:///C:/Windows", "javascript:alert(1)", "--help", "https://user:secret@example.invalid/pr/1", "https://example.invalid/\n"] {
            assert!(review_url(value).is_err());
        }
        assert_eq!(review_url("https://github.com/org/repo/pull/1?x=a&y=b").unwrap(), "https://github.com/org/repo/pull/1?x=a&y=b");
    }

    #[test]
    fn open_path_is_a_single_argument_and_never_a_shell_command() {
        let path = Path::new("D:/fixture space/a & $(danger).toml");
        let target = target("vscode", "Code", "Code.exe".into());
        let command = open_command(&target, path);
        assert_eq!(command.get_program(), "Code.exe");
        assert_eq!(command.get_args().collect::<Vec<_>>(), vec![path.as_os_str()]);
    }

    #[test]
    fn global_selection_uses_available_order_and_ignores_per_path_for_general() {
        let targets = vec![target("cursor", "Cursor", "Cursor.exe".into()), target("vscode", "Code", "Code.exe".into())];
        assert_eq!(preferred_target_id(&json!({"global":"vscode","perPath":{"D:/other":"cursor"}}), &targets, None), Some("vscode".into()));
        assert_eq!(preferred_target_id(&json!({"global":"missing"}), &targets, None), Some("cursor".into()));
        assert_eq!(preferred_target_id(&json!({}), &[], None), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detected_shell_runs_a_real_isolated_pty_command() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;
        let (executable, args) = resolve_shell("commandPrompt").unwrap();
        let pty = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut command = CommandBuilder::new(executable);
        command.args(args);
        command.args(["/d", "/c", "echo codex-shell-preference-probe"]);
        command.cwd(std::env::temp_dir());
        let mut child = pty.slave.spawn_command(command).unwrap();
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = String::new();
            let mut buffer = [0; 4096];
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 { break; }
                output.push_str(&String::from_utf8_lossy(&buffer[..count]));
                if output.contains("codex-shell-preference-probe") { break; }
            }
            let _ = send.send(output);
        });
        let output = receive.recv_timeout(std::time::Duration::from_secs(10));
        if output.is_err() { let _ = child.kill(); }
        assert!(output.unwrap().contains("codex-shell-preference-probe"));
        assert!(child.wait().unwrap().success());
    }

    #[test]
    fn file_manager_reveals_files_but_opens_directories() {
        let root = std::env::temp_dir().join(format!("codex-open-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("test with space &.toml");
        std::fs::write(&file, "").unwrap();
        let target = target("fileManager", "Explorer", "explorer.exe".into());
        let command = open_command(&target, &file);
        let mut expected = std::ffi::OsString::from("/select,"); expected.push(&file);
        assert_eq!(command.get_args().collect::<Vec<_>>(), vec![expected.as_os_str()]);
        let command = open_command(&target, &root);
        assert_eq!(command.get_args().collect::<Vec<_>>(), vec![root.as_os_str()]);
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn unknown_shell_does_not_execute_arbitrary_commands() {
        assert!(resolve_shell("powershell.exe -Command Remove-Item").is_err());
    }

    #[test]
    fn workspace_preference_is_exact_with_migration_and_unavailable_fallback() {
        let targets = vec![target("cursor", "Cursor", "cursor.exe".into()), target("vscode", "Code", "code.exe".into()), target("fileManager", "Explorer", "explorer.exe".into())];
        let stored = json!({"global":"vscode","perPath":{"D:/A":"cursor", "D:/legacy":"finder", "D:/bad":"unknown", "D:/offline":"zed"}});
        assert_eq!(preferred_target_id(&stored, &targets, Some("D:/A")), Some("cursor".into()));
        for path in ["D:/A/child", "d:/a", "D:/bad"] {
            assert_eq!(preferred_target_id(&stored, &targets, Some(path)), Some("vscode".into()));
        }
        assert_eq!(preferred_target_id(&stored, &targets, Some("D:/legacy")), Some("fileManager".into()));
        assert_eq!(preferred_target_id(&stored, &targets, Some("D:/offline")), Some("cursor".into()));
        let next = updated_preferences(&stored, "cursor", Some("D:/new"));
        assert_eq!(next["global"], "cursor");
        assert_eq!(next["perPath"]["D:/A"], "cursor");
        assert_eq!(next["perPath"]["D:/legacy"], "fileManager");
        assert!(next["perPath"].get("D:/bad").is_none());
        assert_eq!(next["perPath"]["D:/new"], "cursor");
        assert_eq!(updated_preferences(&next, "vscode", None)["perPath"], next["perPath"]);
    }

    #[test]
    fn persistence_precedes_execution_and_failure_does_not_execute_or_roll_back() {
        let events = std::cell::RefCell::new(Vec::new());
        assert!(persist_then_execute(|| { events.borrow_mut().push("persist-failed"); Err("disk".into()) },
            || { events.borrow_mut().push("execute"); Ok(()) }).is_err());
        assert_eq!(*events.borrow(), vec!["persist-failed"]);
        events.borrow_mut().clear();
        assert!(persist_then_execute(|| { events.borrow_mut().push("persist"); Ok(()) },
            || { events.borrow_mut().push("execute-failed"); Err("process".into()) }).is_err());
        assert_eq!(*events.borrow(), vec!["persist", "execute-failed"]);
    }

    #[test]
    fn electron_cli_uses_installed_entry_and_literal_path() {
        let root = std::env::temp_dir().join(format!("codex-open-cli-{}", uuid::Uuid::new_v4()));
        let cli = root.join("version").join("resources/app/out/cli.js");
        std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
        std::fs::write(&cli, "").unwrap();
        let executable = root.join("Code.exe");
        let target = target("vscode", "Code", executable.to_string_lossy().into_owned());
        let path = Path::new("D:/空 格 & \"quoted\"/$(not-a-command)");
        let command = editor_cli_command(&target, path).unwrap();
        assert_eq!(command.get_program(), executable.as_os_str());
        assert_eq!(command.get_args().collect::<Vec<_>>(), vec![cli.as_os_str(), path.as_os_str()]);
        assert!(command.get_envs().any(|(key, value)| key == "ELECTRON_RUN_AS_NODE" && value == Some(std::ffi::OsStr::new("1"))));
        std::fs::remove_file(&cli).unwrap();
        for directory in [root.join("version/resources/app/out"), root.join("version/resources/app"), root.join("version/resources"), root.join("version"), root] {
            std::fs::remove_dir(directory).unwrap();
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn launcher_reports_actual_controlled_process_exit_and_missing_program() {
        let mut success = Command::new(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()));
        success.args(["/d", "/c", "exit 0"]);
        assert!(run_launcher(success, "fixture").is_ok());
        let mut failure = Command::new(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()));
        failure.args(["/d", "/c", "exit 7"]);
        assert!(run_launcher(failure, "fixture").unwrap_err().contains("7"));
        assert!(run_launcher(Command::new("Z:/codex-missing-fixture/executable.exe"), "fixture").is_err());
        assert_eq!(quoted_windows_argument(std::ffi::OsStr::new("C:\\with space\\")), "\"C:\\with space\\\\\"");
        assert_eq!(quoted_windows_argument(std::ffi::OsStr::new("a\"b")), "\"a\\\"b\"");
    }

    #[test]
    fn launcher_preserves_real_unicode_and_metacharacter_arguments() {
        let node = executable_on_path(if cfg!(windows) { "node.exe" } else { "node" }).expect("开发环境需要 Node.js");
        let output = std::env::temp_dir().join(format!("codex-open-argument-{}.json", uuid::Uuid::new_v4()));
        let literal = "D:/中文 空格/a & $(not-command) \"quoted\"/";
        let mut command = Command::new(node);
        command.args(["-e", "require('node:fs').writeFileSync(process.argv[1],JSON.stringify(process.argv[2]))"])
            .arg(&output).arg(literal);
        run_launcher(command, "隔离参数探针").unwrap();
        let received: String = serde_json::from_str(&std::fs::read_to_string(&output).unwrap()).unwrap();
        assert_eq!(received, literal);
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn workspace_preferences_round_trip_in_private_process() {
        const MARKER: &str = "CODEX_OPEN_PRIVATE_FIXTURE";
        if std::env::var_os(MARKER).is_some() {
            let home = PathBuf::from(std::env::var_os(MARKER).unwrap());
            assert_eq!(crate::state::codex_home_dir(), home);
            let state = DesktopStateManager::new();
            state.set_value_persisted("openInTargetPreferences", json!({"global":"cursor","perPath":{"D:/old":"finder","D:/keep":"vscode"}})).unwrap();
            persist_workspace_target(&state, "D:/exact", "vscode").unwrap();
            let reloaded = DesktopStateManager::new();
            assert_eq!(reloaded.get_value("openInTargetPreferences"), json!({"global":"vscode","perPath":{"D:/old":"fileManager","D:/keep":"vscode","D:/exact":"vscode"}}));
            std::thread::scope(|scope| {
                for index in 0..8 {
                    let state = &state;
                    scope.spawn(move || persist_workspace_target(state, &format!("D:/concurrent-{index}"), "cursor").unwrap());
                }
            });
            let reloaded = DesktopStateManager::new();
            for index in 0..8 { assert_eq!(reloaded.get_value("openInTargetPreferences")["perPath"][format!("D:/concurrent-{index}")], "cursor"); }
            let targets = available_targets();
            if let Some(target) = targets.first() {
                let paths = state.get_value("openInTargetPreferences")["perPath"].clone();
                set_preference(&state, "target", &target.id).unwrap();
                assert_eq!(DesktopStateManager::new().get_value("openInTargetPreferences")["perPath"], paths);
            }
            let before = state.get_value("openInTargetPreferences");
            assert!(open_workspace(&state, &home.to_string_lossy(), "unknown-target").is_err());
            assert_eq!(state.get_value("openInTargetPreferences"), before);
            let state_file = home.join(".codex-global-state.json");
            std::fs::remove_file(&state_file).unwrap();
            std::fs::create_dir(&state_file).unwrap();
            let executed = std::cell::Cell::new(false);
            assert!(persist_then_execute(|| persist_workspace_target(&state, "D:/blocked", "vscode"), || { executed.set(true); Ok(()) }).is_err());
            assert!(!executed.get());
            assert_eq!(state.get_value("openInTargetPreferences"), before);
            std::fs::remove_dir(&state_file).unwrap();
            return;
        }
        let home = std::env::temp_dir().join(format!("codex-open-state-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&home).unwrap();
        let result = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "desktop_open::tests::workspace_preferences_round_trip_in_private_process", "--nocapture"])
            .env("CODEX_HOME", &home).env(MARKER, &home).output().unwrap();
        assert!(result.status.success(), "{}\n{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
        std::fs::remove_dir(&home).unwrap();
    }
}
