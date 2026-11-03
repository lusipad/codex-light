#[cfg(windows)]
use crate::desktop_open;
use crate::{git, local_environment};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const ENV_FILE: &str = "codex-setup-environment.json";
const LOG_LIMIT: usize = 256 * 1024;
pub(crate) type EnvironmentDelta = BTreeMap<String, Option<String>>;

#[derive(Default)]
struct Operations {
    tokens: HashMap<(String, String), (Arc<AtomicBool>, Instant)>,
    refresh_skips: HashMap<(String, String), (Arc<AtomicBool>, Instant)>,
    running: HashMap<String, String>,
    closed: HashMap<String, Instant>,
}
impl Operations {
    fn prune(&mut self) {
        let mut skips = self.refresh_skips.iter()
            .filter(|((owner, id), _)| self.running.get(owner) != Some(id))
            .map(|(key, (_, time))| (key.clone(), *time)).collect::<Vec<_>>();
        skips.sort_by_key(|(_, time)| *time);
        let excess = skips.len().saturating_sub(256);
        for (index, (key, time)) in skips.into_iter().enumerate() {
            if index < excess || time.elapsed() > Duration::from_secs(600) {
                self.refresh_skips.remove(&key);
            }
        }
        let mut inactive = self
            .tokens
            .iter()
            .filter(|((owner, id), _)| self.running.get(owner) != Some(id))
            .map(|(key, (_, time))| (key.clone(), *time))
            .collect::<Vec<_>>();
        inactive.sort_by_key(|(_, time)| *time);
        let excess = inactive.len().saturating_sub(256);
        for (index, (key, time)) in inactive.into_iter().enumerate() {
            if index < excess || time.elapsed() > Duration::from_secs(600) {
                self.tokens.remove(&key);
            }
        }
        if self.closed.len() > 256 {
            let mut closed = self
                .closed
                .iter()
                .map(|(owner, time)| (owner.clone(), *time))
                .collect::<Vec<_>>();
            closed.sort_by_key(|(_, time)| *time);
            for (owner, _) in closed.into_iter().take(self.closed.len() - 256) {
                self.closed.remove(&owner);
            }
        }
    }
}
#[derive(Clone, Default)]
pub struct SetupState {
    operations: Arc<Mutex<Operations>>,
}
impl SetupState {
    pub fn skip_upstream_refresh(&self, owner: &str, id: &str) {
        if let Ok(mut state) = self.operations.lock() {
            state.refresh_skips.entry((owner.into(), id.into()))
                .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()))
                .0.store(true, Ordering::SeqCst);
            state.prune();
        }
    }
    pub fn cancel(&self, owner: &str, id: &str) {
        if let Ok(mut state) = self.operations.lock() {
            state
                .tokens
                .entry((owner.into(), id.into()))
                .or_insert_with(|| (Arc::new(AtomicBool::new(true)), Instant::now()))
                .0
                .store(true, Ordering::SeqCst);
            state.prune();
        }
    }
    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(mut state) = self.operations.lock() {
            state.closed.insert(owner.into(), Instant::now());
            for ((window, _), (token, _)) in &state.tokens {
                if window == owner {
                    token.store(true, Ordering::SeqCst);
                }
            }
            state.prune();
        }
    }
    /// Reopen a destroyed label before reserving work, then verify the native window still exists.
    pub fn reopen_owner(&self, owner: &str) {
        if let Ok(mut state) = self.operations.lock() {
            if state.closed.remove(owner).is_some() {
                if let Some(id) = state.running.get(owner) {
                    if state
                        .tokens
                        .get(&(owner.into(), id.clone()))
                        .is_some_and(|(token, _)| token.load(Ordering::SeqCst))
                    {
                        state.running.remove(owner);
                    }
                }
            }
        }
    }
    pub fn prepare_operation(&self, owner: &str, id: &str) -> Result<SetupOperation, String> {
        let token = self.begin(owner, id)?;
        let skip_refresh = self.operations.lock().map_err(|error| error.to_string())?
            .refresh_skips.entry((owner.into(), id.into()))
            .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now())).0.clone();
        Ok(SetupOperation {
            state: self.clone(),
            owner: owner.into(),
            id: id.into(),
            token,
            skip_refresh,
        })
    }
    fn begin(&self, owner: &str, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut state = self.operations.lock().map_err(|e| e.to_string())?;
        state.prune();
        if owner.is_empty() || id.is_empty() || state.closed.contains_key(owner) {
            return Err("环境设置操作已取消。".into());
        }
        if state.running.contains_key(owner) {
            return Err("此窗口已有工作树设置正在进行。".into());
        }
        if state.tokens.contains_key(&(owner.into(), id.into())) {
            return Err("环境设置操作已取消或已经执行，请勿重复提交。".into());
        }
        let token = Arc::new(AtomicBool::new(false));
        state
            .tokens
            .insert((owner.into(), id.into()), (token.clone(), Instant::now()));
        state.running.insert(owner.into(), id.into());
        Ok(token)
    }
}
pub struct SetupOperation {
    state: SetupState,
    owner: String,
    id: String,
    token: Arc<AtomicBool>,
    skip_refresh: Arc<AtomicBool>,
}
impl Drop for SetupOperation {
    fn drop(&mut self) {
        self.token.store(true, Ordering::SeqCst);
        if let Ok(mut state) = self.state.operations.lock() {
            state.refresh_skips.remove(&(self.owner.clone(), self.id.clone()));
            if state.running.get(&self.owner) == Some(&self.id) {
                state.running.remove(&self.owner);
            }
            state.prune();
        }
    }
}
impl SetupOperation {
    pub(crate) fn upstream_skip_signal(&self) -> &AtomicBool {
        &self.skip_refresh
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        if self.token.load(Ordering::SeqCst) {
            Err("环境设置已取消。".into())
        } else {
            Ok(())
        }
    }
}

fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}
fn git_output(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = command("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}
fn git_matches(cwd: &Path, args: &[&str]) -> Result<bool, String> {
    let output = command("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(format!(
            "无法核对环境文件的 Git 状态：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        )),
    }
}
fn regular(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("环境配置必须是普通文件，不能是符号链接。".into());
    }
    Ok(())
}
fn inside(root: &Path, relative: &Path, create: bool) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for part in relative.components() {
        let Component::Normal(part) = part else {
            return Err("环境路径不能越过工作树边界。".into());
        };
        path.push(part);
        if path.exists() {
            if fs::symlink_metadata(&path)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("环境路径不能经过符号链接。".into());
            }
            if !fs::canonicalize(&path)
                .map_err(|e| e.to_string())?
                .starts_with(root)
            {
                return Err("环境路径越过工作树边界。".into());
            }
        } else if create {
            fs::create_dir(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(path)
}
fn mapped_config(
    source_root: &Path,
    worktree: &Path,
    source: &Path,
) -> Result<Option<PathBuf>, String> {
    regular(source)?;
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    let relative = source
        .strip_prefix(source_root)
        .map_err(|_| "选中的环境不属于源仓库。")?;
    let target = inside(worktree, relative, false)?;
    if target.exists() {
        regular(&target)?;
        return Ok(Some(target));
    }
    if git_matches(
        source_root,
        &[
            "ls-files",
            "--error-unmatch",
            "--",
            &relative.to_string_lossy(),
        ],
    )? {
        return Ok(None);
    }
    let ignored = |cwd: &Path| {
        git_matches(
            cwd,
            &["check-ignore", "--quiet", "--", &relative.to_string_lossy()],
        )
    };
    if ignored(source_root)? && !ignored(worktree)? {
        return Ok(Some(source));
    }
    let parent = relative.parent().ok_or("环境路径无效。")?;
    inside(worktree, parent, true)?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    use std::io::Write;
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&target)
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|e| e.to_string())?;
    Ok(Some(target))
}
fn private_path(cwd: &Path) -> Result<PathBuf, String> {
    let dir = git_output(cwd, &["rev-parse", "--absolute-git-dir"])?;
    fs::canonicalize(dir).map_err(|e| e.to_string())
}
fn valid_key(key: &str) -> bool {
    !key.is_empty() && !key.contains(['=', '\0', '\r', '\n'])
}
fn excluded(key: &str) -> bool {
    matches!(
        key.to_ascii_uppercase().as_str(),
        "CODEX_SOURCE_TREE_PATH"
            | "CODEX_WORKTREE_PATH"
            | "CODEX_SETUP_EXIT_CODE"
            | "OLDPWD"
            | "PWD"
            | "SHELLOPTS"
            | "SHLVL"
            | "_"
    )
}
pub fn shell_environment(cwd: &str) -> Result<EnvironmentDelta, String> {
    let path = private_path(Path::new(cwd))?.join(ENV_FILE);
    if path.exists() {
        regular(&path)?;
    }
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(e.to_string()),
    };
    if raw.len() > 1024 * 1024 {
        return Err("工作树环境记录过大。".into());
    }
    let values: EnvironmentDelta = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    if values.iter().any(|(key, value)| {
        !valid_key(key) || excluded(key) || value.as_ref().is_some_and(|v| v.contains('\0'))
    }) {
        return Err("工作树环境记录无效。".into());
    }
    Ok(values)
}
fn read_env(path: &Path, json: bool) -> Result<BTreeMap<String, String>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("设置脚本环境输出过大。".into());
    }
    if json {
        return serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes))
            .map_err(|e| e.to_string());
    }
    let raw = if cfg!(windows) {
        if bytes.len() % 2 != 0 {
            return Err("命令提示符环境输出编码无效。".into());
        }
        String::from_utf16(
            &bytes
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string())?
    } else {
        String::from_utf8(bytes).map_err(|e| e.to_string())?
    };
    Ok(raw
        .split(if cfg!(windows) { '\n' } else { '\0' })
        .filter_map(|line| {
            let (key, value) = line.trim_end_matches('\r').split_once('=')?;
            valid_key(key).then(|| (key.into(), value.into()))
        })
        .collect())
}
fn delta(before: BTreeMap<String, String>, after: BTreeMap<String, String>) -> EnvironmentDelta {
    let normalize = |values: BTreeMap<String, String>| {
        values
            .into_iter()
            .map(|(key, value)| {
                (
                    if cfg!(windows) {
                        key.to_ascii_uppercase()
                    } else {
                        key
                    },
                    value,
                )
            })
            .collect::<BTreeMap<_, _>>()
    };
    let before = normalize(before);
    let after = normalize(after);
    before
        .keys()
        .chain(after.keys())
        .filter(|key| !excluded(key))
        .filter_map(|key| {
            (before.get(key) != after.get(key)).then(|| (key.clone(), after.get(key).cloned()))
        })
        .collect()
}
fn escaped(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn write_private(cwd: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let root = private_path(cwd)?;
    let temporary = root.join(format!("codex-setup-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, root.join(name)).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
fn bounded_read(mut source: impl Read) -> Vec<u8> {
    let mut output = Vec::new();
    let mut chunk = [0; 8192];
    while let Ok(count) = source.read(&mut chunk) {
        if count == 0 {
            break;
        }
        let remaining = LOG_LIMIT.saturating_sub(output.len());
        output.extend_from_slice(&chunk[..count.min(remaining)]);
    }
    output
}
fn run_setup(
    op: &SetupOperation,
    cwd: &Path,
    source_cwd: &str,
    worktree: &str,
    script: &str,
    shell: Option<String>,
) -> Result<EnvironmentDelta, String> {
    run_script(op, cwd, worktree, script, shell, Some(source_cwd))
}
fn run_script(
    op: &SetupOperation,
    cwd: &Path,
    worktree: &str,
    script: &str,
    shell: Option<String>,
    source_cwd: Option<&str>,
) -> Result<EnvironmentDelta, String> {
    op.check()?;
    let temporary =
        Temporary(std::env::temp_dir().join(format!("codex-setup-{}", uuid::Uuid::new_v4())));
    fs::create_dir(&temporary.0).map_err(|e| e.to_string())?;
    let before = temporary.0.join("before");
    let after = temporary.0.join("after");
    #[cfg(windows)]
    let (executable, _) = desktop_open::resolve_shell(shell.as_deref().unwrap_or("powershell"))?;
    #[cfg(not(windows))]
    let executable = {
        let _ = shell;
        "bash".to_string()
    };
    let lower = executable.to_ascii_lowercase();
    let powershell = lower.ends_with("powershell.exe") || lower.ends_with("pwsh.exe");
    let cmd = lower.ends_with("cmd.exe");
    if cfg!(windows) && !powershell && !cmd {
        return Err("环境设置目前仅支持 PowerShell 或命令提示符，请更改终端 Shell 后重试。".into());
    }
    let input = temporary.0.join(if powershell {
        "script.ps1"
    } else if cmd {
        "script.cmd"
    } else {
        "script.sh"
    });
    let wrapper = temporary.0.join(if powershell {
        "wrapper.ps1"
    } else if cmd {
        "wrapper.cmd"
    } else {
        "wrapper.sh"
    });
    let script_text = if cmd {
        format!("@chcp 65001 >nul\r\n{}", script.replace("\r\n", "\n"))
    } else {
        script.replace("\r\n", "\n")
    };
    fs::write(&input, script_text).map_err(|e| e.to_string())?;
    let capture = |path: &Path| {
        format!("$snapshot = @{{}}; Get-ChildItem Env: | ForEach-Object {{ $snapshot[$_.Name] = $_.Value }}; [System.IO.File]::WriteAllText('{}', (ConvertTo-Json -InputObject $snapshot -Compress), (New-Object System.Text.UTF8Encoding($false)))", escaped(path))
    };
    let body = if source_cwd.is_none() {
        if powershell {
            format!("$ErrorActionPreference = 'Stop'\n$PSNativeCommandUseErrorActionPreference = $true\n$global:LASTEXITCODE = 0\ntry {{ & '{}'; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }} }} catch {{ [Console]::Error.WriteLine($_); exit 1 }}\nexit 0\n", escaped(&input))
        } else if cmd {
            format!(
                "@echo off\r\ncall \"{}\"\r\nexit /b %ERRORLEVEL%\r\n",
                input.to_string_lossy()
            )
        } else {
            format!(
                "set -e -o pipefail\n. '{}'\n",
                input.to_string_lossy().replace('\'', "'\\''")
            )
        }
    } else if powershell {
        format!("$ErrorActionPreference = 'Stop'\n$PSNativeCommandUseErrorActionPreference = $true\n$global:LASTEXITCODE = 0\n{}\ntry {{\n & '{}'\n if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}\n {}\n}} catch {{ [Console]::Error.WriteLine($_); exit 1 }}\nexit 0\n", capture(&before), escaped(&input), capture(&after))
    } else if cmd {
        let quote = |path: &Path| format!("\"{}\"", path.to_string_lossy());
        format!("@echo off\r\nset > {}\r\ncall {}\r\nset CODEX_SETUP_EXIT_CODE=%ERRORLEVEL%\r\nif not \"%CODEX_SETUP_EXIT_CODE%\"==\"0\" exit /b %CODEX_SETUP_EXIT_CODE%\r\nset > {}\r\nexit /b 0\r\n", quote(&before), quote(&input), quote(&after))
    } else {
        let quote = |path: &Path| path.to_string_lossy().replace('\'', "'\\''");
        format!(
            "set -e -o pipefail\nenv -0 > '{}'\n. '{}'\nenv -0 > '{}'\n",
            quote(&before),
            quote(&input),
            quote(&after)
        )
    };
    fs::write(&wrapper, body).map_err(|e| e.to_string())?;
    let mut process = command(&executable);
    if powershell {
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
    } else if cmd {
        process.args(["/d", "/u", "/c"]);
    }
    process
        .arg(&wrapper)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(source_cwd) = source_cwd {
        process
            .env("CODEX_SOURCE_TREE_PATH", source_cwd)
            .env("CODEX_WORKTREE_PATH", worktree);
    }
    #[cfg(windows)]
    process.creation_flags(0x08000000 | 0x00000004);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        process.process_group(0);
    }
    let mut child = process
        .spawn()
        .map_err(|e| format!("无法启动设置脚本：{e}"))?;
    #[cfg(windows)]
    let job = match crate::recommended_skills::git_job::Job::attach_and_resume(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("无法建立设置脚本进程树：{error}"));
        }
    };
    let stdout = child.stdout.take().ok_or("未能读取设置脚本输出。")?;
    let stderr = child.stderr.take().ok_or("未能读取设置脚本错误输出。")?;
    let (output_tx, output) = std::sync::mpsc::channel();
    let (error_tx, errors) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let _ = output_tx.send(bounded_read(stdout));
    });
    thread::spawn(move || {
        let _ = error_tx.send(bounded_read(stderr));
    });
    let status = loop {
        if op.check().is_err() {
            #[cfg(windows)]
            {
                let _ = job.stop();
            }
            #[cfg(unix)]
            {
                let _ = command("kill")
                    .args(["-KILL", "--", &format!("-{}", child.id())])
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
            break Err("环境设置已取消。".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
    };
    // A successfully exited shell can leave helpers holding the output pipes.
    // Close the owned process tree before waiting for either reader.
    #[cfg(windows)]
    let tree_result = job.stop();
    #[cfg(windows)]
    drop(job);
    #[cfg(unix)]
    let tree_result: Result<(), String> = {
        let _ = command("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .output();
        Ok(())
    };
    let stdout = output
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "设置脚本输出管道未能关闭。".to_string())?;
    let stderr = errors
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "设置脚本错误管道未能关闭。".to_string())?;
    tree_result?;
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
    write_private(
        Path::new(worktree),
        if source_cwd.is_some() {
            "codex-setup.log"
        } else {
            "codex-cleanup.log"
        },
        log.as_bytes(),
    )?;
    let status = status?;
    if !status.success() {
        return Err(format!(
            "设置脚本退出失败（{status}）：{}",
            log.chars().take(4000).collect::<String>()
        ));
    }
    op.check()?;
    if source_cwd.is_none() {
        return Ok(BTreeMap::new());
    }
    Ok(delta(
        read_env(&before, powershell)?,
        read_env(&after, powershell)?,
    ))
}

/// Configuration failures are warnings; actual lifecycle failures must retain the worktree.
pub(crate) fn cleanup_worktree(
    op: &SetupOperation,
    target: &Path,
    primary: &Path,
    shell: Option<String>,
) -> Result<Option<String>, String> {
    op.check()?;
    let loaded = (|| {
        let config_file = private_path(target)?.join("config.worktree");
        if !config_file.exists() {
            return Ok(None);
        }
        regular(&config_file)?;
        let output = command("git")
            .args(["config", "--file"])
            .arg(crate::state::normalize_fs_path(
                &config_file.to_string_lossy(),
            ))
            .args(["--get", "codex.localEnvironmentConfigPath"])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.code() == Some(1) {
            return Ok(None);
        }
        if !output.status.success() {
            return Err("无法读取目标工作树环境选择。".to_string());
        }
        let selected = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
        let selected = selected.trim();
        if selected.is_empty() || selected == "__none__" {
            return Ok(None);
        }
        let config = Path::new(selected);
        if !config.is_absolute()
            || config
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err("环境配置路径无效。".into());
        }
        let directory = config.parent().ok_or("环境目录无效。")?;
        let codex = directory.parent().ok_or("环境目录无效。")?;
        if directory.file_name().and_then(|name| name.to_str()) != Some("environments")
            || codex.file_name().and_then(|name| name.to_str()) != Some(".codex")
        {
            return Err("环境配置必须位于 .codex/environments。".into());
        }
        let definition = fs::canonicalize(codex.parent().ok_or("环境定义根无效。")?)
            .map_err(|e| e.to_string())?;
        let target = fs::canonicalize(target).map_err(|e| e.to_string())?;
        let primary = fs::canonicalize(primary).map_err(|e| e.to_string())?;
        let relative = if let Ok(relative) = definition.strip_prefix(&target) {
            relative
        } else {
            let relative = definition
                .strip_prefix(&primary)
                .map_err(|_| "环境配置不属于目标或源仓库。")?;
            let config_relative = config
                .strip_prefix(codex.parent().unwrap())
                .map_err(|_| "环境配置路径无效。")?;
            let source_config = inside(&primary, &relative.join(config_relative), false)?;
            // B only keeps a source fallback when the definition is ignored in source but not target.
            let repository_relative = source_config
                .strip_prefix(&primary)
                .map_err(|_| "源环境路径无效。")?;
            if !git_matches(
                &primary,
                &[
                    "check-ignore",
                    "--quiet",
                    "--",
                    &repository_relative.to_string_lossy(),
                ],
            )? || git_matches(
                &target,
                &[
                    "check-ignore",
                    "--quiet",
                    "--",
                    &repository_relative.to_string_lossy(),
                ],
            )? || git_matches(
                &primary,
                &[
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    &repository_relative.to_string_lossy(),
                ],
            )? {
                return Err("源环境配置不是有效的忽略文件回退。".into());
            }
            relative
        };
        let execution = inside(&target, relative, false)?;
        if !execution.is_dir() {
            return Err("cleanup 工作目录不存在。".into());
        }
        let snapshot = local_environment::read_config(&definition.to_string_lossy(), selected)?;
        if !snapshot.exists {
            return Err("选中环境文件不存在。".into());
        }
        let environment = snapshot.environment.ok_or_else(|| {
            snapshot
                .schema_error
                .unwrap_or_else(|| "环境配置无效。".into())
        })?;
        let Some(cleanup) = environment.cleanup else {
            return Ok(None);
        };
        let platform = if cfg!(windows) {
            cleanup.win32
        } else if cfg!(target_os = "macos") {
            cleanup.darwin
        } else {
            cleanup.linux
        };
        let script = platform
            .map(|script| script.script)
            .filter(|script| !script.trim().is_empty())
            .unwrap_or(cleanup.script);
        if script.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some((execution, script)))
    })();
    let (cwd, script) = match loaded {
        Ok(Some(value)) => value,
        Ok(None) => return Ok(None),
        Err(error) => {
            return Ok(Some(format!(
                "cleanup-config-unavailable：环境配置不可用，继续删除：{error}"
            )))
        }
    };
    run_script(op, &cwd, &target.to_string_lossy(), &script, shell, None)
        .map_err(|error| format!("cleanup 失败，工作树已保留：{error}"))?;
    Ok(None)
}

#[cfg(test)]
pub fn create_worktree(
    state: &SetupState,
    owner: &str,
    operation_id: &str,
    source_cwd: &str,
    starting_mode: &str,
    branch_name: Option<String>,
    owner_thread_id: Option<String>,
    worktrees_root: &str,
    config_path: Option<String>,
    shell: Option<String>,
) -> Result<git::GitWorktreeInfo, String> {
    create_worktree_prepared(
        state.prepare_operation(owner, operation_id)?,
        source_cwd,
        starting_mode,
        branch_name,
        owner_thread_id,
        worktrees_root,
        config_path,
        shell,
    )
}

pub fn create_worktree_prepared(
    op: SetupOperation,
    source_cwd: &str,
    starting_mode: &str,
    branch_name: Option<String>,
    owner_thread_id: Option<String>,
    worktrees_root: &str,
    config_path: Option<String>,
    shell: Option<String>,
) -> Result<git::GitWorktreeInfo, String> {
    op.check()?;
    let source_root =
        fs::canonicalize(git::find_git_root(source_cwd).ok_or("源工作区不是 Git 仓库。")?)
            .map_err(|e| e.to_string())?;
    let original = config_path
        .as_ref()
        .map(|path| local_environment::read_config(source_cwd, path))
        .transpose()?;
    if original
        .as_ref()
        .is_some_and(|snapshot| snapshot.environment.is_none() || !snapshot.exists)
    {
        return Err("选中的环境配置不可用，请重新读取。".into());
    }
    op.check()?;
    let mut worktree = git::create_codex_worktree(
        source_cwd,
        starting_mode,
        branch_name,
        owner_thread_id,
        worktrees_root,
    )?;
    let result = (|| {
        op.check()?;
        let root = fs::canonicalize(&worktree.path).map_err(|e| e.to_string())?;
        let source_workspace = fs::canonicalize(source_cwd).map_err(|e| e.to_string())?;
        let workspace_relative = source_workspace
            .strip_prefix(&source_root)
            .map_err(|_| "源工作区不属于仓库。")?;
        let worktree_workspace = inside(&root, workspace_relative, false)?;
        if !worktree_workspace.is_dir() {
            return Err("新工作树中缺少项目子目录。".into());
        }
        if let Some(snapshot) = &original {
            if fs::read_to_string(&snapshot.path).map_err(|e| e.to_string())? != snapshot.content {
                return Err("环境配置在工作树创建期间已变化，请重新读取。".into());
            }
        }
        let mapped = original
            .as_ref()
            .map(|snapshot| mapped_config(&source_root, &root, Path::new(&snapshot.path)))
            .transpose()?
            .flatten();
        op.check()?;
        // --worktree only isolates writes when this extension is enabled.
        if !git_output(&root, &["config", "--get", "core.worktree"])
            .unwrap_or_default()
            .is_empty()
        {
            return Err("此仓库使用特殊 core.worktree 配置，无法安全启用独立环境设置。".into());
        }
        git_output(&root, &["config", "extensions.worktreeConfig", "true"])?;
        git_output(
            &root,
            &[
                "config",
                "--worktree",
                "codex.localEnvironmentConfigPath",
                mapped
                    .as_ref()
                    .map(|path| path.to_str().unwrap_or(""))
                    .unwrap_or("__none__"),
            ],
        )?;
        if let (Some(original), Some(path)) = (original.as_ref(), mapped.as_ref()) {
            let definition_root = fs::canonicalize(&original.cwd).map_err(|e| e.to_string())?;
            let definition = definition_root
                .strip_prefix(&source_root)
                .map_err(|_| "环境定义根不属于源仓库。")?;
            let execution_cwd = inside(&root, definition, false)?;
            let read_cwd = if path.starts_with(&root) {
                execution_cwd.to_string_lossy().into_owned()
            } else {
                source_cwd.to_string()
            };
            let reloaded = local_environment::read_config(&read_cwd, &path.to_string_lossy())?;
            let parsed = reloaded.environment.ok_or_else(|| {
                format!(
                    "新工作树环境无效：{}",
                    reloaded
                        .schema_error
                        .unwrap_or_else(|| "配置不存在。".into())
                )
            })?;
            let platform = if cfg!(windows) {
                parsed.setup.win32.as_ref()
            } else if cfg!(target_os = "macos") {
                parsed.setup.darwin.as_ref()
            } else {
                parsed.setup.linux.as_ref()
            };
            let script = platform
                .map(|script| script.script.trim())
                .filter(|script| !script.is_empty())
                .unwrap_or(parsed.setup.script.trim());
            if !script.is_empty() {
                let values = run_setup(
                    &op,
                    &execution_cwd,
                    source_cwd,
                    &worktree_workspace.to_string_lossy(),
                    script,
                    shell,
                )?;
                write_private(
                    &root,
                    ENV_FILE,
                    &serde_json::to_vec(&values).map_err(|e| e.to_string())?,
                )?;
            }
        }
        worktree.has_uncommitted_changes =
            !git_output(&root, &["status", "--porcelain=v1", "-uall"])?.is_empty();
        op.check()
    })();
    result.map_err(|error| {
        format!(
            "工作树已创建并保留在 {}，环境设置未完成：{error}",
            worktree.path
        )
    })?;
    Ok(worktree)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "codex-environment-setup-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(root.join("source/nested")).unwrap();
            let source = root.join("source");
            git_output(&source, &["init", "-q"]).unwrap();
            fs::write(source.join("nested/keep.txt"), "fixture").unwrap();
            git_output(&source, &["add", "."]).unwrap();
            git_output(
                &source,
                &[
                    "-c",
                    "user.name=Parity",
                    "-c",
                    "user.email=parity@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-qm",
                    "fixture",
                ],
            )
            .unwrap();
            Self(root)
        }
        fn source(&self) -> PathBuf {
            self.0.join("source")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn cancellation_owner_scope_pre_cancel_and_bounded_records() {
        let state = SetupState::default();
        state.cancel("one", "early");
        assert!(state.begin("one", "early").is_err());
        let token = state.begin("one", "running").unwrap();
        let other = state.begin("two", "running").unwrap();
        assert!(state.begin("one", "duplicate").is_err());
        state.cancel_owner("one");
        assert!(token.load(Ordering::SeqCst));
        assert!(!other.load(Ordering::SeqCst));
        assert!(state.begin("one", "after-close").is_err());
        for i in 0..600 {
            state.cancel("unused", &format!("id-{i}"));
        }
        assert!(state.operations.lock().unwrap().tokens.len() <= 258);
    }
    #[test]
    fn upstream_skip_is_scoped_and_never_cancels_creation() {
        let state = SetupState::default();
        state.skip_upstream_refresh("first", "early");
        let early = state.prepare_operation("first", "early").unwrap();
        assert!(early.upstream_skip_signal().load(Ordering::SeqCst));
        assert!(early.check().is_ok());
        let other = state.prepare_operation("second", "early").unwrap();
        assert!(!other.upstream_skip_signal().load(Ordering::SeqCst));
        state.skip_upstream_refresh("second", "early");
        assert!(other.upstream_skip_signal().load(Ordering::SeqCst));
        assert!(other.check().is_ok());
        state.cancel("second", "early");
        assert!(other.check().is_err());
        drop(early);
        let next = state.prepare_operation("first", "next").unwrap();
        assert!(!next.upstream_skip_signal().load(Ordering::SeqCst));
        state.cancel_owner("first");
        assert!(next.check().is_err());
    }

    #[test]
    fn environment_delta_preserves_unset_and_excludes_wrapper_values() {
        let before = BTreeMap::from([
            ("SETUP_REMOVE".into(), "old".into()),
            ("SAME".into(), "same".into()),
            ("PWD".into(), "old".into()),
        ]);
        let after = BTreeMap::from([
            ("SETUP_ADD".into(), "中文\nsecond".into()),
            ("SAME".into(), "same".into()),
            ("PWD".into(), "new".into()),
        ]);
        let values = delta(before, after);
        assert_eq!(values.get("SETUP_REMOVE"), Some(&None));
        assert_eq!(values.get("SETUP_ADD"), Some(&Some("中文\nsecond".into())));
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn tracking_probe_distinguishes_missing_file_from_git_failure() {
        let fixture = Fixture::new();
        let source = fixture.source();
        assert!(git_matches(
            &source,
            &["ls-files", "--error-unmatch", "--", "nested/keep.txt"]
        )
        .unwrap());
        assert!(!git_matches(
            &source,
            &["ls-files", "--error-unmatch", "--", "missing.toml"]
        )
        .unwrap());
        assert!(git_matches(
            &fixture.0,
            &["ls-files", "--error-unmatch", "--", "missing.toml"]
        )
        .is_err());
    }

    #[test]
    fn reopened_window_does_not_revive_queued_operation_or_release_new_owner() {
        let fixture = Fixture::new();
        let state = SetupState::default();
        let old = state.prepare_operation("same-window", "old").unwrap();
        state.cancel_owner("same-window");
        state.reopen_owner("same-window");
        let new = state.prepare_operation("same-window", "new").unwrap();
        let source = fixture.source();
        let managed = fixture.0.join("managed");
        let error = create_worktree_prepared(
            old,
            &source.to_string_lossy(),
            "HEAD",
            None,
            None,
            &managed.to_string_lossy(),
            None,
            None,
        )
        .unwrap_err();
        assert!(error.contains("取消"));
        assert!(state.prepare_operation("same-window", "third").is_err());
        let worktree = create_worktree_prepared(
            new,
            &source.to_string_lossy(),
            "HEAD",
            None,
            None,
            &managed.to_string_lossy(),
            None,
            None,
        )
        .unwrap();
        assert!(Path::new(&worktree.path).is_dir());
        assert_eq!(
            git_output(&source, &["worktree", "list", "--porcelain"])
                .unwrap()
                .lines()
                .filter(|line| line.starts_with("worktree "))
                .count(),
            2
        );
    }
    #[test]
    fn real_worktree_setup_maps_workspace_and_captures_environment() {
        let fixture = Fixture::new();
        let source = fixture.source();
        let directory = source.join(".codex/environments");
        fs::create_dir_all(&directory).unwrap();
        let script = if cfg!(windows) {
            "$env:PARITY_SETUP_VALUE = '中文值'\n[System.IO.File]::WriteAllText((Join-Path $env:CODEX_WORKTREE_PATH 'setup-marker.txt'), $env:CODEX_SOURCE_TREE_PATH)"
        } else {
            "export PARITY_SETUP_VALUE='中文值'\nprintf '%s' \"$CODEX_SOURCE_TREE_PATH\" > \"$CODEX_WORKTREE_PATH/setup-marker.txt\""
        };
        let raw = format!(
            "version = 1\nname = 'Fixture'\n[setup]\nscript = {}\n",
            serde_json::to_string(script).unwrap()
        );
        let config = directory.join("environment.toml");
        fs::write(&config, raw).unwrap();
        let nested = source.join("nested");
        let result = create_worktree(
            &SetupState::default(),
            "test",
            "success",
            &nested.to_string_lossy(),
            "HEAD",
            None,
            None,
            &fixture.0.join("managed").to_string_lossy(),
            Some(config.to_string_lossy().into()),
            None,
        )
        .unwrap();
        assert!(result.has_uncommitted_changes);
        assert_eq!(
            fs::read_to_string(Path::new(&result.path).join("nested/setup-marker.txt")).unwrap(),
            nested.to_string_lossy()
        );
        assert_eq!(
            shell_environment(&result.path)
                .unwrap()
                .get("PARITY_SETUP_VALUE"),
            Some(&Some("中文值".into()))
        );
        assert!(git_output(
            Path::new(&result.path),
            &[
                "config",
                "--worktree",
                "--get",
                "codex.localEnvironmentConfigPath"
            ]
        )
        .unwrap()
        .ends_with("environment.toml"));
        assert!(git_output(
            &source,
            &[
                "config",
                "--local",
                "--get",
                "codex.localEnvironmentConfigPath"
            ]
        )
        .is_err());
    }
    #[test]
    fn setup_failure_retains_created_worktree_and_does_not_save_environment() {
        let fixture = Fixture::new();
        let source = fixture.source();
        let directory = source.join(".codex/environments");
        fs::create_dir_all(&directory).unwrap();
        let config = directory.join("environment.toml");
        fs::write(
            &config,
            "version = 1\nname = 'Failure'\n[setup]\nscript = 'exit 7'\n",
        )
        .unwrap();
        let error = create_worktree(
            &SetupState::default(),
            "test",
            "failure",
            &source.to_string_lossy(),
            "HEAD",
            None,
            None,
            &fixture.0.join("managed").to_string_lossy(),
            Some(config.to_string_lossy().into()),
            None,
        )
        .unwrap_err();
        assert!(error.contains("工作树已创建并保留"));
        let worktrees = git_output(&source, &["worktree", "list", "--porcelain"]).unwrap();
        let created = worktrees
            .lines()
            .filter_map(|line| line.strip_prefix("worktree "))
            .find(|path| path.contains("managed"))
            .unwrap();
        assert!(Path::new(created).is_dir());
        assert!(shell_environment(created).unwrap().is_empty());
    }
    #[test]
    fn cancellation_stops_live_script_and_readers() {
        let fixture = Fixture::new();
        let state = SetupState::default();
        let op = state.prepare_operation("cancel", "id").unwrap();
        let marker = fixture.source().join("ready");
        let script = if cfg!(windows) {
            "[System.IO.File]::WriteAllText('ready', 'ready')\nStart-Sleep -Seconds 20"
        } else {
            "printf ready > ready\nsleep 20"
        };
        thread::scope(|scope| {
            let started = Instant::now();
            let cwd = fixture.source();
            let task = scope.spawn(move || {
                run_setup(
                    &op,
                    &cwd,
                    &cwd.to_string_lossy(),
                    &cwd.to_string_lossy(),
                    script,
                    None,
                )
            });
            while !marker.exists() && started.elapsed() < Duration::from_secs(8) {
                thread::sleep(Duration::from_millis(20));
            }
            assert!(marker.exists(), "setup process did not start");
            state.cancel("cancel", "id");
            assert!(task.join().unwrap().unwrap_err().contains("取消"));
            assert!(started.elapsed() < Duration::from_secs(12));
        });
    }

    #[test]
    fn successful_shell_with_background_pipe_owner_finishes_promptly() {
        let fixture = Fixture::new();
        let state = SetupState::default();
        let op = state.prepare_operation("background", "id").unwrap();
        let script = if cfg!(windows) {
            "Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c ping -n 20 127.0.0.1 >nul' -NoNewWindow | Out-Null\n$env:PARITY_BACKGROUND = 'done'"
        } else {
            "sleep 20 &\nexport PARITY_BACKGROUND=done"
        };
        let cwd = fixture.source();
        let started = Instant::now();
        let values = run_setup(
            &op,
            &cwd,
            &cwd.to_string_lossy(),
            &cwd.to_string_lossy(),
            script,
            None,
        )
        .unwrap();
        assert_eq!(values.get("PARITY_BACKGROUND"), Some(&Some("done".into())));
        assert!(started.elapsed() < Duration::from_secs(12));
    }

    #[cfg(windows)]
    #[test]
    fn command_prompt_captures_real_environment() {
        let fixture = Fixture::new();
        let state = SetupState::default();
        let op = state.prepare_operation("cmd", "id").unwrap();
        let cwd = fixture.source();
        let values = run_setup(
            &op,
            &cwd,
            &cwd.to_string_lossy(),
            &cwd.to_string_lossy(),
            "set PARITY_CMD_VALUE=actual\r\nexit /b 0",
            Some("commandPrompt".into()),
        )
        .unwrap();
        assert_eq!(values.get("PARITY_CMD_VALUE"), Some(&Some("actual".into())));
    }
}
