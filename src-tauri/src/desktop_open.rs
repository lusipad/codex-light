use crate::state::DesktopStateManager;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTarget {
    pub id: String,
    pub label: String,
    pub executable: String,
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
            result.push(OpenTarget { id: id.into(), label: label.into(), executable: path.to_string_lossy().into_owned() });
        }
    }
    #[cfg(target_os = "windows")]
    {
        result.push(OpenTarget { id: "systemDefault".into(), label: "系统默认应用".into(), executable: String::new() });
        let explorer = ["SystemRoot", "windir"].into_iter()
            .filter_map(std::env::var_os).map(|root| PathBuf::from(root).join("explorer.exe"))
            .find(|path| path.is_file()).unwrap_or_else(|| PathBuf::from("explorer.exe"));
        result.push(OpenTarget { id: "fileManager".into(), label: "文件资源管理器".into(), executable: explorer.to_string_lossy().into_owned() });
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(executable) = executable_on_path(if cfg!(target_os = "macos") { "open" } else { "xdg-open" }) {
        result.push(OpenTarget { id: "systemDefault".into(), label: "系统默认应用".into(), executable: executable.to_string_lossy().into_owned() });
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

fn preferred_target_id(stored: &serde_json::Value, targets: &[OpenTarget]) -> Option<String> {
    let global = stored.get("global").and_then(serde_json::Value::as_str);
    global
        .filter(|id| targets.iter().any(|target| target.id == *id))
        .map(ToOwned::to_owned)
        .or_else(|| targets.first().map(|target| target.id.clone()))
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
        preferred_target: preferred_target_id(&state.get_value("openInTargetPreferences"), &targets),
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
            let previous = state.get_value("openInTargetPreferences");
            let per_path = previous.get("perPath").cloned();
            state.set_value_persisted(
                "openInTargetPreferences",
                json!({"global": value, "perPath": per_path}),
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

#[cfg(target_os = "windows")]
fn system_open(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(window: *mut std::ffi::c_void, operation: *const u16, file: *const u16,
            parameters: *const u16, directory: *const u16, show: i32) -> isize;
    }
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(),
        std::ptr::null(), std::ptr::null(), 1) };
    if result <= 32 { return Err(format!("系统打开失败，Windows 错误码：{result}")); }
    Ok(())
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
    #[cfg(target_os = "windows")]
    if target.id == "systemDefault" { return system_open(path); }
    let mut command = open_command(target, path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|error| format!("无法在 {} 打开：{error}", target.label))?;
    Ok(())
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
        let target = OpenTarget { id: "vscode".into(), label: "Code".into(), executable: "Code.exe".into() };
        let command = open_command(&target, path);
        assert_eq!(command.get_program(), "Code.exe");
        assert_eq!(command.get_args().collect::<Vec<_>>(), vec![path.as_os_str()]);
    }

    #[test]
    fn global_selection_uses_available_order_and_ignores_per_path_for_general() {
        let targets = vec![OpenTarget { id: "cursor".into(), label: "Cursor".into(), executable: "Cursor.exe".into() },
            OpenTarget { id: "vscode".into(), label: "Code".into(), executable: "Code.exe".into() }];
        assert_eq!(preferred_target_id(&json!({"global":"vscode","perPath":{"D:/other":"cursor"}}), &targets), Some("vscode".into()));
        assert_eq!(preferred_target_id(&json!({"global":"missing"}), &targets), Some("cursor".into()));
        assert_eq!(preferred_target_id(&json!({}), &[]), None);
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
        let target = OpenTarget { id: "fileManager".into(), label: "Explorer".into(), executable: "explorer.exe".into() };
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
}
