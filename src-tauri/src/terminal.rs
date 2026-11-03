use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const REPLAY_BUFFER_LIMIT: usize = 128 * 1024;
type EventSink = Arc<dyn Fn(&str, Value) + Send + Sync>;
type ExitResult = Arc<(Mutex<Option<Result<u32, String>>>, Condvar)>;

fn action_command(
    shell: Option<String>,
    cwd: &str,
    command: &str,
) -> Result<(String, Vec<String>, String), String> {
    #[cfg(windows)]
    {
        let selected = shell
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("powershell");
        let (executable, _) = crate::desktop_open::resolve_shell(selected)?;
        let filename = std::path::Path::new(&executable)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        let command = command
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\n', "\r\n");
        match filename.as_str() {
            "pwsh.exe" | "powershell.exe" => Ok((
                executable,
                vec!["-NoLogo".into(), "-NoProfile".into()],
                format!(
                    "Set-Location -LiteralPath '{}'; if ($?) {{\r\n{command}\r\n}}\r\n\r\n",
                    cwd.replace('\'', "''")
                ),
            )),
            "cmd.exe" if !cwd.contains(['"', '\r', '\n']) => Ok((
                executable,
                vec!["/d".into(), "/q".into()],
                format!("cd /d \"{cwd}\" && {command}\r\n"),
            )),
            _ => Err("此 Shell 尚不支持受控环境操作终端，请选择 PowerShell 或命令提示符。".into()),
        }
    }
    #[cfg(not(windows))]
    {
        let executable = shell
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(TerminalManager::default_shell);
        Ok((
            executable,
            vec![],
            format!("cd '{}' && {command}\n", cwd.replace('\'', "'\\''")),
        ))
    }
}

struct TerminalProcess {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    tree: Option<Arc<ProcessTree>>,
}

struct ProcessTree {
    #[cfg(windows)]
    job: Mutex<Option<crate::recommended_skills::git_job::Job>>,
    #[cfg(unix)]
    pid: u32,
}
impl ProcessTree {
    fn stop(&self) -> Result<(), String> {
        #[cfg(windows)]
        {
            let mut job = self.job.lock().map_err(|e| e.to_string())?;
            if let Some(handle) = job.as_ref() {
                handle.stop()?;
            }
            job.take();
        }
        #[cfg(unix)]
        {
            let result = std::process::Command::new("kill")
                .args(["-KILL", "--", &format!("-{}", self.pid)])
                .output()
                .map_err(|e| e.to_string())?;
            if !result.status.success()
                && !String::from_utf8_lossy(&result.stderr).contains("No such process")
            {
                return Err("终端操作进程组未能终止。".into());
            }
        }
        Ok(())
    }
}
impl TerminalProcess {
    fn stop(&mut self) -> Result<(), String> {
        if let Some(tree) = &self.tree {
            tree.stop()?;
        }
        // Ordinary terminal close historically tolerates an already exited shell.
        // Actions require the confirmed tree stop above, not this redundant kill.
        let _ = self.killer.kill();
        Ok(())
    }
}

#[derive(Default)]
struct ActionOwners {
    sessions: HashMap<String, String>,
    closed: HashMap<String, Instant>,
}
pub struct TerminalAuthorization<'a> {
    _guard: MutexGuard<'a, ActionOwners>,
}

struct OutputLog {
    text: String,
    end_offset: u64,
    exited: bool,
}

impl OutputLog {
    fn new() -> Self {
        Self {
            text: String::new(),
            end_offset: 0,
            exited: false,
        }
    }

    fn append(&mut self, text: &str) -> (u64, u64) {
        let start = self.end_offset;
        self.end_offset += text.len() as u64;
        self.text.push_str(text);
        if self.text.len() > REPLAY_BUFFER_LIMIT {
            let mut trim = self.text.len() - REPLAY_BUFFER_LIMIT;
            while !self.text.is_char_boundary(trim) {
                trim += 1;
            }
            self.text.drain(..trim);
        }
        (start, self.end_offset)
    }

    fn start_offset(&self) -> u64 {
        self.end_offset - self.text.len() as u64
    }
}

// Incomplete UTF-8 is retained until the next read. Invalid bytes and an
// incomplete suffix at EOF use the same replacement semantics as from_utf8_lossy.
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn decode(&mut self, bytes: &[u8], eof: bool) -> String {
        self.pending.extend_from_slice(bytes);
        let mut text = String::new();
        let mut consumed = 0;
        while consumed < self.pending.len() {
            match std::str::from_utf8(&self.pending[consumed..]) {
                Ok(valid) => {
                    text.push_str(valid);
                    consumed = self.pending.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    text.push_str(std::str::from_utf8(&self.pending[consumed..valid_end]).unwrap());
                    consumed = valid_end;
                    match error.error_len() {
                        Some(count) => {
                            text.push('\u{fffd}');
                            consumed += count;
                        }
                        None if eof => {
                            text.push('\u{fffd}');
                            consumed = self.pending.len();
                        }
                        None => break,
                    }
                }
            }
        }
        self.pending.drain(..consumed);
        text
    }
}

struct TerminalSession {
    id: String,
    generation: String,
    cwd: String,
    shell: String,
    process: Option<TerminalProcess>,
    output: Arc<Mutex<OutputLog>>,
}

impl TerminalSession {
    fn snapshot(&self) -> TerminalSessionInfo {
        let output = self.output.lock().unwrap();
        TerminalSessionInfo {
            session_id: self.id.clone(),
            generation: self.generation.clone(),
            cwd: self.cwd.clone(),
            shell: self.shell.clone(),
            replay_log: output.text.clone(),
            start_offset: output.start_offset(),
            end_offset: output.end_offset,
            exited: output.exited,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub generation: String,
    pub cwd: String,
    pub shell: String,
    pub replay_log: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub exited: bool,
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    action_owners: Arc<Mutex<ActionOwners>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            action_owners: Arc::new(Mutex::new(ActionOwners::default())),
        }
    }

    pub fn authorize(
        &self,
        owner: &str,
        session_id: &str,
    ) -> Result<TerminalAuthorization<'_>, String> {
        let guard = self.action_owners.lock().map_err(|e| e.to_string())?;
        if guard.closed.contains_key(owner)
            || guard
                .sessions
                .get(session_id)
                .is_some_and(|actual| actual != owner)
        {
            return Err("此操作终端不属于当前窗口。".into());
        }
        Ok(TerminalAuthorization { _guard: guard })
    }
    pub fn reopen_owner(&self, owner: &str) {
        if let Ok(mut owners) = self.action_owners.lock() {
            owners.closed.remove(owner);
        }
    }
    pub fn close_owner(&self, owner: &str) -> Result<(), String> {
        let mut owners = self.action_owners.lock().map_err(|e| e.to_string())?;
        owners.closed.insert(owner.into(), Instant::now());
        let sessions = owners
            .sessions
            .iter()
            .filter_map(|(id, actual)| (actual == owner).then_some(id.clone()))
            .collect::<Vec<_>>();
        let mut errors = Vec::new();
        for id in &sessions {
            if let Err(error) = self.close(id) {
                errors.push(error);
            }
        }
        owners.sessions.retain(|_, actual| actual != owner);
        if owners.closed.len() > 256 {
            let mut closed = owners
                .closed
                .iter()
                .map(|(owner, time)| (owner.clone(), *time))
                .collect::<Vec<_>>();
            closed.sort_by_key(|(_, time)| *time);
            for (owner, _) in closed.into_iter().take(owners.closed.len() - 256) {
                owners.closed.remove(&owner);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("；"))
        }
    }

    pub fn run_action(
        &self,
        app: &AppHandle,
        owner: &str,
        session_id: &str,
        cwd: &str,
        command: &str,
        cols: u16,
        rows: u16,
        shell: Option<String>,
    ) -> Result<TerminalSessionInfo, String> {
        let app = app.clone();
        self.run_action_with(
            owner,
            session_id,
            cwd,
            command,
            cols,
            rows,
            shell,
            Arc::new(move |event, payload| {
                let _ = app.emit(event, payload);
            }),
        )
    }
    fn run_action_with(
        &self,
        owner: &str,
        session_id: &str,
        cwd: &str,
        command: &str,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        emit: EventSink,
    ) -> Result<TerminalSessionInfo, String> {
        if owner.is_empty()
            || session_id.is_empty()
            || command.trim().is_empty()
            || !std::path::Path::new(cwd).is_dir()
        {
            return Err("操作终端的窗口、目录或命令无效。".into());
        }
        let mut owners = self.action_owners.lock().map_err(|e| e.to_string())?;
        if owners.closed.contains_key(owner)
            || owners
                .sessions
                .get(session_id)
                .is_some_and(|actual| actual != owner)
        {
            return Err("此操作终端不属于当前窗口。".into());
        }
        if !owners.sessions.contains_key(session_id)
            && self
                .sessions
                .lock()
                .map_err(|e| e.to_string())?
                .contains_key(session_id)
        {
            return Err("不能使用普通终端会话运行环境操作，请创建专用操作终端。".into());
        }
        owners.sessions.insert(session_id.into(), owner.into());
        self.close(session_id)?;
        let (shell, args, text) = action_command(shell, cwd, command)?;
        let info = self.create_backend_with(
            session_id,
            cwd,
            cols,
            rows,
            None,
            Some((shell, args)),
            true,
            emit,
        )?;
        if let Err(error) = self.write(session_id, &text) {
            let _ = self.close(session_id);
            return Err(error);
        }
        Ok(info)
    }

    #[cfg(not(target_os = "windows"))]
    fn default_shell() -> String {
        std::env::var("SHELL")
            .ok()
            .filter(|sh| !sh.trim().is_empty())
            .unwrap_or_else(|| "/bin/zsh".to_string())
    }

    pub fn create_or_attach(
        &self,
        app: &AppHandle,
        session_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        shell_override: Option<String>,
    ) -> Result<TerminalSessionInfo, String> {
        let app = app.clone();
        self.create_or_attach_with(
            session_id,
            cwd,
            cols,
            rows,
            shell_override,
            None,
            Arc::new(move |event, payload| {
                let _ = app.emit(event, payload);
            }),
        )
    }

    fn create_or_attach_with(
        &self,
        session_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        shell_override: Option<String>,
        command: Option<(String, Vec<String>)>,
        emit: EventSink,
    ) -> Result<TerminalSessionInfo, String> {
        self.create_backend_with(
            session_id,
            cwd,
            cols,
            rows,
            shell_override,
            command,
            false,
            emit,
        )
    }

    fn create_backend_with(
        &self,
        session_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        shell_override: Option<String>,
        command: Option<(String, Vec<String>)>,
        action: bool,
        emit: EventSink,
    ) -> Result<TerminalSessionInfo, String> {
        // Keep creation and attach for the same id serialized. Register before
        // either worker can run, so a short-lived child cannot become a ghost.
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(existing) = sessions.get(session_id) {
            if let Some(process) = &existing.process {
                let size = process.master.get_size();
                if !size.is_ok_and(|size| size.rows == rows.max(2) && size.cols == cols.max(2)) {
                    let _ = process.master.resize(PtySize {
                        rows: rows.max(2),
                        cols: cols.max(2),
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
            return Ok(existing.snapshot());
        }
        let (shell, args) = if let Some(command) = command {
            command
        } else {
            let selected = shell_override.filter(|value| !value.trim().is_empty());
            #[cfg(target_os = "windows")]
            let resolved =
                crate::desktop_open::resolve_shell(selected.as_deref().unwrap_or("powershell"))?;
            #[cfg(not(target_os = "windows"))]
            let resolved = (selected.unwrap_or_else(Self::default_shell), vec![]);
            resolved
        };
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;
        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(&args);
        if std::path::Path::new(cwd).is_dir() {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if crate::git::find_git_root(cwd).is_some() {
            for (key, value) in crate::local_environment_setup::shell_environment(cwd)? {
                if let Some(value) = value {
                    cmd.env(key, value);
                } else {
                    cmd.env_remove(key);
                }
            }
        }
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {e}"))?;
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell `{shell}`: {e}"))?;
        let tree = if action {
            #[cfg(windows)]
            let tree = child
                .as_raw_handle()
                .ok_or_else(|| "无法取得操作终端进程句柄。".to_string())
                .and_then(crate::recommended_skills::git_job::Job::attach_running)
                .map(|job| ProcessTree {
                    job: Mutex::new(Some(job)),
                });
            #[cfg(unix)]
            let tree = child
                .process_id()
                .map(|pid| ProcessTree { pid })
                .ok_or_else(|| "无法取得操作终端进程组。".to_string());
            match tree {
                Ok(tree) => Some(Arc::new(tree)),
                Err(error) => {
                    let _ = child.kill();
                    return Err(error);
                }
            }
        } else {
            None
        };
        drop(pair.slave);
        let completion: ExitResult = Arc::new((Mutex::new(None), Condvar::new()));
        let output = Arc::new(Mutex::new(OutputLog::new()));
        let generation = uuid::Uuid::new_v4().to_string();
        let session = TerminalSession {
            id: session_id.to_string(),
            generation: generation.clone(),
            cwd: cwd.to_string(),
            shell,
            process: Some(TerminalProcess {
                master: pair.master,
                writer,
                killer: child.clone_killer(),
                tree: tree.clone(),
            }),
            output: output.clone(),
        };
        // This exact snapshot precedes the reader. Events cover all later bytes;
        // never take a second snapshot after starting it.
        let info = session.snapshot();
        sessions.insert(session_id.to_string(), session);
        let manager = self.clone();
        let sid = session_id.to_string();
        let reader_generation = generation.clone();
        let reader_completion = completion.clone();
        std::thread::spawn(move || {
            let mut decoder = Utf8Stream::default();
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => Self::publish(
                        &output,
                        &emit,
                        &sid,
                        &reader_generation,
                        decoder.decode(&chunk[..n], false),
                    ),
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            Self::publish(
                &output,
                &emit,
                &sid,
                &reader_generation,
                decoder.decode(&[], true),
            );
            let end_offset = {
                let mut log = output.lock().unwrap();
                log.exited = true;
                log.end_offset
            };
            if let Some(mut process) = manager.take_process(&sid, &reader_generation) {
                let _ = process.stop();
            }
            let (result, ready) = &*reader_completion;
            let result = result.lock().unwrap();
            let (result, _) = ready
                .wait_timeout_while(result, Duration::from_secs(5), |result| result.is_none())
                .unwrap();
            let (exit_code, error) = match result.as_ref() {
                Some(Ok(code)) => (Some(*code), None),
                Some(Err(error)) => (None, Some(error.clone())),
                None => (None, Some("终端进程退出状态未在时限内返回。".into())),
            };
            emit(
                "terminal:exit",
                json!({ "sessionId": sid, "generation": reader_generation, "endOffset": end_offset, "exitCode": exit_code, "error": error }),
            );
        });
        let manager = self.clone();
        let sid = session_id.to_string();
        std::thread::spawn(move || {
            let mut result = child
                .wait()
                .map(|status| status.exit_code())
                .map_err(|error| error.to_string());
            if let Some(tree) = tree {
                if let Err(error) = tree.stop() {
                    result = Err(error);
                }
            }
            *completion.0.lock().unwrap() = Some(result);
            completion.1.notify_all();
            // ConPTY retains its output pipe until the pseudo-console closes.
            // Drop its master on this waiter while the reader drains final bytes.
            drop(manager.take_process(&sid, &generation));
        });
        Ok(info)
    }

    fn publish(
        output: &Mutex<OutputLog>,
        emit: &EventSink,
        sid: &str,
        generation: &str,
        text: String,
    ) {
        if text.is_empty() {
            return;
        }
        let (start, end) = output.lock().unwrap().append(&text);
        emit(
            "terminal:data",
            json!({
                "sessionId": sid, "generation": generation,
                "startOffset": start, "endOffset": end, "data": text,
            }),
        );
    }

    fn take_process(&self, sid: &str, generation: &str) -> Option<TerminalProcess> {
        self.sessions
            .lock()
            .unwrap()
            .get_mut(sid)
            .filter(|session| session.generation == generation)
            .and_then(|session| session.process.take())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Terminal session not found: {session_id}"))?;
        let process = session
            .process
            .as_mut()
            .ok_or_else(|| format!("Terminal session exited: {session_id}"))?;
        if session.output.lock().unwrap().exited {
            return Err(format!("Terminal session exited: {session_id}"));
        }
        process
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        process.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(process) = sessions
            .get(session_id)
            .and_then(|session| session.process.as_ref())
        {
            let _ = process.master.resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            });
        }
        Ok(())
    }

    pub fn close(&self, session_id: &str) -> Result<(), String> {
        let session = self.sessions.lock().unwrap().remove(session_id);
        if let Some(mut session) = session {
            if let Some(process) = session.process.as_mut() {
                if let Err(error) = process.stop() {
                    self.sessions
                        .lock()
                        .unwrap()
                        .insert(session_id.into(), session);
                    return Err(error);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver};
    use std::time::{Duration, Instant};

    fn action_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("codex-action-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn real_action_cwd_one_write_and_true_exit() {
        let root = action_root();
        let manager = TerminalManager::new();
        let (sink, receiver) = events();
        #[cfg(windows)]
        let command = "[IO.File]::AppendAllText('count.txt', 'once'); [IO.File]::WriteAllText('cwd.txt', (Get-Location).Path); [Console]::WriteLine('ACTION_OUTPUT'); exit 7";
        #[cfg(not(windows))]
        let command = "printf once >> count.txt; pwd > cwd.txt; printf 'ACTION_OUTPUT\\n'; exit 7";
        let info = manager
            .run_action_with(
                "window-a",
                "action",
                &root.to_string_lossy(),
                command,
                120,
                30,
                None,
                sink,
            )
            .unwrap();
        let observed = until_exit(&receiver, &info.generation);
        assert!(joined(&observed, &info.generation).contains("ACTION_OUTPUT"));
        assert_eq!(observed.last().unwrap().1["exitCode"], 7);
        assert!(observed.last().unwrap().1["error"].is_null());
        assert_eq!(
            std::fs::read_to_string(root.join("count.txt")).unwrap(),
            "once"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("cwd.txt"))
                .unwrap()
                .trim(),
            root.to_string_lossy()
        );
        assert!(manager.authorize("window-b", "action").is_err());
        manager.close_owner("window-a").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn action_owner_lifecycle_and_ordinary_session_cannot_be_claimed() {
        let root = action_root();
        let manager = TerminalManager::new();
        let (sink, _) = events();
        // A real, already exited ordinary backend still retains its session identity.
        create(&manager, "ordinary", "exit 0", sink.clone());
        assert!(manager
            .run_action_with(
                "a",
                "ordinary",
                &root.to_string_lossy(),
                "exit 0",
                80,
                24,
                None,
                sink.clone()
            )
            .is_err());
        manager.close_owner("a").unwrap();
        assert!(manager.authorize("a", "new").is_err());
        assert!(manager
            .run_action_with(
                "a",
                "new",
                &root.to_string_lossy(),
                "exit 0",
                80,
                24,
                None,
                sink.clone()
            )
            .is_err());
        manager.reopen_owner("a");
        let info = manager
            .run_action_with(
                "a",
                "new",
                &root.to_string_lossy(),
                "exit 0",
                80,
                24,
                None,
                sink,
            )
            .unwrap();
        assert!(!info.generation.is_empty());
        manager.close_owner("a").unwrap();
        manager.close("ordinary").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn action_authorization_guard_serializes_ownership_changes() {
        let manager = TerminalManager::new();
        let access = manager.authorize("a", "guard").unwrap();
        let manager_clone = manager.clone();
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            manager_clone.close_owner("a").unwrap();
            sender.send(()).unwrap();
        });
        assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
        drop(access);
        receiver.recv_timeout(Duration::from_secs(2)).unwrap();
        worker.join().unwrap();
        assert!(manager.authorize("a", "guard").is_err());
    }

    #[test]
    fn real_action_concurrent_restart_leaves_one_current_generation() {
        let root = action_root();
        let manager = TerminalManager::new();
        let (sink, _) = events();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let manager = manager.clone();
                let root = root.clone();
                let sink = sink.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    #[cfg(windows)]
                    let command = "Start-Sleep -Seconds 20";
                    #[cfg(not(windows))]
                    let command = "sleep 20";
                    manager
                        .run_action_with(
                            "a",
                            "action",
                            &root.to_string_lossy(),
                            command,
                            80,
                            24,
                            None,
                            sink,
                        )
                        .unwrap()
                })
            })
            .collect();
        barrier.wait();
        let infos: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_ne!(infos[0].generation, infos[1].generation);
        let sessions = manager.sessions.lock().unwrap();
        assert_eq!(sessions.len(), 1);
        let current = &sessions["action"];
        assert!(infos
            .iter()
            .any(|info| info.generation == current.generation));
        assert!(current.process.is_some());
        drop(sessions);
        manager.close_owner("a").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn real_action_command_prompt_uses_cwd_and_exit_code() {
        let root = action_root();
        let manager = TerminalManager::new();
        let (sink, receiver) = events();
        let info = manager
            .run_action_with(
                "a",
                "cmd-action",
                &root.to_string_lossy(),
                "echo once>cmd.txt\r\nexit 9",
                80,
                24,
                Some("commandPrompt".into()),
                sink,
            )
            .unwrap();
        let observed = until_exit(&receiver, &info.generation);
        assert_eq!(observed.last().unwrap().1["exitCode"], 9);
        assert_eq!(
            std::fs::read_to_string(root.join("cmd.txt"))
                .unwrap()
                .trim(),
            "once"
        );
        manager.close_owner("a").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn real_action_restart_kills_descendants_before_replacement() {
        let root = action_root();
        let manager = TerminalManager::new();
        let (sink, receiver) = events();
        // Child inherits the Job. It would leave a delayed file after the old shell is gone.
        let child_script = root.join("child.ps1");
        let marker = root.join("orphan.txt");
        std::fs::write(
            &child_script,
            format!(
                "Start-Sleep -Seconds 2; [IO.File]::WriteAllText('{}','orphan')",
                marker.to_string_lossy().replace('\'', "''")
            ),
        )
        .unwrap();
        let command = format!("$p = Start-Process powershell.exe -ArgumentList '-NoProfile','-File','{}' -PassThru; [IO.File]::WriteAllText('ready.txt', [string]$p.Id); Start-Sleep -Seconds 30", child_script.to_string_lossy());
        let old = manager
            .run_action_with(
                "a",
                "action",
                &root.to_string_lossy(),
                &command,
                120,
                30,
                None,
                sink.clone(),
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !root.join("ready.txt").exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert!(
            root.join("ready.txt").exists(),
            "old action did not launch child"
        );
        assert!(manager
            .run_action_with(
                "b",
                "action",
                &root.to_string_lossy(),
                "exit 0",
                120,
                30,
                None,
                sink.clone()
            )
            .is_err());
        let next = manager
            .run_action_with(
                "a",
                "action",
                &root.to_string_lossy(),
                "[IO.File]::WriteAllText('new.txt','new'); exit 3",
                120,
                30,
                None,
                sink,
            )
            .unwrap();
        assert_ne!(old.generation, next.generation);
        assert!(manager.take_process("action", &old.generation).is_none());
        let observed = until_exit(&receiver, &next.generation);
        assert_eq!(observed.last().unwrap().1["exitCode"], 3);
        std::thread::sleep(Duration::from_millis(2300));
        assert!(!marker.exists(), "old descendant survived action restart");
        assert_eq!(
            std::fs::read_to_string(root.join("new.txt")).unwrap(),
            "new"
        );
        manager.close_owner("a").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn real_action_shell_exit_cleans_background_pipe_owner() {
        let root = action_root();
        let manager = TerminalManager::new();
        let (sink, receiver) = events();
        let info = manager.run_action_with("a", "action", &root.to_string_lossy(), "Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -NoNewWindow; exit 5", 120, 30, None, sink).unwrap();
        let began = Instant::now();
        let observed = until_exit(&receiver, &info.generation);
        assert_eq!(observed.last().unwrap().1["exitCode"], 5);
        assert!(began.elapsed() < Duration::from_secs(15));
        manager.close_owner("a").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn utf8_stream_preserves_every_boundary_and_eof() {
        let expected = "开始\u{1b}[31m中文🙂🚀\u{1b}[0m\r\n末尾";
        let bytes = expected.as_bytes();
        for first in 0..=bytes.len() {
            for second in first..=bytes.len() {
                let mut decoder = Utf8Stream::default();
                let actual = decoder.decode(&bytes[..first], false)
                    + &decoder.decode(&bytes[first..second], false)
                    + &decoder.decode(&bytes[second..], false)
                    + &decoder.decode(&[], true);
                assert_eq!(actual, expected, "split at {first}/{second}");
            }
        }
        let mut decoder = Utf8Stream::default();
        let actual: String = bytes
            .iter()
            .map(|byte| decoder.decode(&[*byte], false))
            .collect();
        assert_eq!(actual + &decoder.decode(&[], true), expected);
    }

    #[test]
    fn utf8_stream_invalid_bytes_match_whole_stream_lossy_decode() {
        for bytes in [
            vec![0xf0, 0x9f],
            vec![0xe4, 0xb8, 0xad, 0xff, 0xe4],
            vec![0xc0, 0xaf, 0xf0, 0x80, 0x80, 0x80],
        ] {
            for split in 0..=bytes.len() {
                let mut decoder = Utf8Stream::default();
                assert_eq!(
                    decoder.decode(&bytes[..split], false) + &decoder.decode(&bytes[split..], true),
                    String::from_utf8_lossy(&bytes)
                );
            }
        }
    }

    #[test]
    fn replay_trims_only_character_boundaries_and_preserves_absolute_watermarks() {
        let mut log = OutputLog::new();
        let text = "中🙂\u{1b}[31m".repeat(REPLAY_BUFFER_LIMIT / 5);
        let (start, end) = log.append(&text);
        assert_eq!(start, 0);
        assert_eq!(end, text.len() as u64);
        assert!(log.text.len() <= REPLAY_BUFFER_LIMIT);
        assert_eq!(log.text, text[log.start_offset() as usize..]);
        let previous_end = log.end_offset;
        assert_eq!(log.append("末尾"), (previous_end, previous_end + 6));
        assert!(log.text.ends_with("末尾"));
        assert_eq!(log.start_offset() + log.text.len() as u64, log.end_offset);
    }

    struct Cleanup {
        manager: TerminalManager,
        id: String,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.manager.close(&self.id);
        }
    }

    fn test_command(script: &str) -> (String, Vec<String>) {
        #[cfg(windows)]
        {
            (
                "powershell.exe".into(),
                vec![
                    "-NoLogo".into(),
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-Command".into(),
                    script.into(),
                ],
            )
        }
        #[cfg(not(windows))]
        {
            ("/bin/sh".into(), vec!["-c".into(), script.into()])
        }
    }

    fn events() -> (EventSink, Receiver<(String, Value)>) {
        let (sender, receiver) = mpsc::channel();
        (
            Arc::new(move |event, payload| {
                let _ = sender.send((event.into(), payload));
            }),
            receiver,
        )
    }

    fn create(
        manager: &TerminalManager,
        id: &str,
        script: &str,
        emit: EventSink,
    ) -> TerminalSessionInfo {
        manager
            .create_or_attach_with(
                id,
                &std::env::temp_dir().to_string_lossy(),
                200,
                40,
                None,
                Some(test_command(script)),
                emit,
            )
            .unwrap()
    }

    fn until_exit(receiver: &Receiver<(String, Value)>, generation: &str) -> Vec<(String, Value)> {
        let deadline = Instant::now() + Duration::from_secs(25);
        let mut events = Vec::new();
        loop {
            let (name, data) = receiver
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("real PTY did not deliver output/exit before deadline");
            let exited = name == "terminal:exit" && data["generation"] == generation;
            events.push((name, data));
            if exited {
                break;
            }
        }
        events
    }

    fn joined(events: &[(String, Value)], generation: &str) -> String {
        let mut text = String::new();
        let mut offset = 0;
        for (name, event) in events {
            if event["generation"] != generation {
                continue;
            }
            if name == "terminal:data" {
                assert_eq!(event["startOffset"].as_u64(), Some(offset));
                let chunk = event["data"].as_str().unwrap();
                offset += chunk.len() as u64;
                assert_eq!(event["endOffset"].as_u64(), Some(offset));
                text.push_str(chunk);
            } else if name == "terminal:exit" {
                assert_eq!(event["endOffset"].as_u64(), Some(offset));
            }
        }
        text
    }

    #[test]
    fn real_pty_fast_exit_preserves_first_tail_and_is_not_writable() {
        let manager = TerminalManager::new();
        let id = format!("terminal-fast-{}", uuid::Uuid::new_v4());
        let _cleanup = Cleanup {
            manager: manager.clone(),
            id: id.clone(),
        };
        let (sink, receiver) = events();
        #[cfg(windows)]
        let script =
            "[Console]::WriteLine('TO01_FIRST'); [Console]::WriteLine('TO01_TAIL'); exit 0";
        #[cfg(not(windows))]
        let script = "printf 'TO01_FIRST\\nTO01_TAIL\\n'";
        let info = create(&manager, &id, script, sink.clone());
        assert_eq!(info.start_offset, 0);
        assert_eq!(info.end_offset, 0);
        assert_eq!(info.replay_log, "");
        assert!(!info.exited);
        let observed = until_exit(&receiver, &info.generation);
        let output = joined(&observed, &info.generation);
        assert_eq!(output.matches("TO01_FIRST").count(), 1, "{output:?}");
        assert_eq!(output.matches("TO01_TAIL").count(), 1, "{output:?}");
        assert!(output.find("TO01_FIRST") < output.find("TO01_TAIL"));
        assert!(manager.write(&id, "should-not-write").is_err());
        let attached = create(&manager, &id, script, sink);
        assert_eq!(attached.generation, info.generation);
        assert!(attached.exited);
        assert_eq!(attached.replay_log, output);
        assert_eq!(attached.end_offset, output.len() as u64);
        assert!(manager.sessions.lock().unwrap()[&id].process.is_none());
        println!(
            "TO01 real PTY events: {}",
            serde_json::to_string(&observed).unwrap()
        );
    }

    #[test]
    fn real_pty_consumes_worktree_setup_environment_and_unset_values() {
        let root =
            std::env::temp_dir().join(format!("codex-terminal-setup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let mut git = std::process::Command::new("git");
        git.arg("-C").arg(&root).args(["init", "--quiet"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            git.creation_flags(0x08000000);
        }
        assert!(git.status().unwrap().success());
        std::fs::write(
            root.join(".git/codex-setup-environment.json"),
            r#"{"CODEX_PARITY_SETUP":"saved value 中文","COLORTERM":null}"#,
        )
        .unwrap();
        let manager = TerminalManager::new();
        let id = format!("terminal-setup-{}", uuid::Uuid::new_v4());
        let (sink, receiver) = events();
        #[cfg(windows)]
        let script = "[Console]::WriteLine('ENV=' + $env:CODEX_PARITY_SETUP); if ($null -eq $env:COLORTERM) { [Console]::WriteLine('UNSET') }";
        #[cfg(not(windows))]
        let script = "printf 'ENV=%s\\n' \"$CODEX_PARITY_SETUP\"; test -z \"${COLORTERM+x}\" && printf 'UNSET\\n'";
        let info = manager
            .create_or_attach_with(
                &id,
                &root.to_string_lossy(),
                200,
                40,
                None,
                Some(test_command(script)),
                sink,
            )
            .unwrap();
        let output = joined(&until_exit(&receiver, &info.generation), &info.generation);
        assert!(output.contains("ENV=saved value 中文"), "{output:?}");
        assert!(output.contains("UNSET"), "{output:?}");
        manager.close(&id).unwrap();
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn real_pty_attach_during_output_has_one_shared_watermark() {
        let manager = TerminalManager::new();
        let id = format!("terminal-attach-{}", uuid::Uuid::new_v4());
        let _cleanup = Cleanup {
            manager: manager.clone(),
            id: id.clone(),
        };
        let (sink, receiver) = events();
        #[cfg(windows)]
        let script = "0..19 | ForEach-Object { [Console]::WriteLine(('TO03_{0:D3}' -f $_)); Start-Sleep -Milliseconds 35 }";
        #[cfg(not(windows))]
        let script =
            "i=0; while [ $i -lt 20 ]; do printf 'TO03_%03d\\n' $i; i=$((i+1)); sleep 0.04; done";
        let info = create(&manager, &id, script, sink.clone());
        let mut observed = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(25);
        loop {
            let event = receiver
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap();
            observed.push(event);
            let text = observed
                .iter()
                .filter_map(|(name, data)| {
                    if name == "terminal:data" {
                        data["data"].as_str()
                    } else {
                        None
                    }
                })
                .collect::<String>();
            if text.contains("TO03_000") {
                break;
            }
        }
        let attached = create(&manager, &id, script, sink);
        assert_eq!(attached.generation, info.generation);
        assert!(!attached.exited);
        observed.extend(until_exit(&receiver, &info.generation));
        let output = joined(&observed, &info.generation);
        assert_eq!(
            attached.replay_log,
            output[attached.start_offset as usize..attached.end_offset as usize]
        );
        let mut last = 0;
        for n in 0..20 {
            let marker = format!("TO03_{n:03}");
            assert_eq!(output.matches(&marker).count(), 1, "{output:?}");
            let pos = output.find(&marker).unwrap();
            assert!(pos >= last);
            last = pos;
        }
        println!(
            "TO03 real PTY snapshot: {}",
            serde_json::to_string(&attached).unwrap()
        );
        println!(
            "TO03 real PTY events: {}",
            serde_json::to_string(&observed).unwrap()
        );
    }

    #[test]
    fn real_pty_old_generation_cleanup_cannot_remove_replacement() {
        let manager = TerminalManager::new();
        let id = format!("terminal-generation-{}", uuid::Uuid::new_v4());
        let _cleanup = Cleanup {
            manager: manager.clone(),
            id: id.clone(),
        };
        let (sink, receiver) = events();
        #[cfg(windows)]
        let script = "[Console]::WriteLine('TO06_LIVE'); Start-Sleep -Seconds 3; [Console]::WriteLine('TO06_END')";
        #[cfg(not(windows))]
        let script = "printf 'TO06_LIVE\\n'; sleep 3; printf 'TO06_END\\n'";
        let old = create(&manager, &id, script, sink.clone());
        manager.close(&id).unwrap();
        let replacement = create(&manager, &id, script, sink.clone());
        assert_ne!(old.generation, replacement.generation);
        assert!(manager.take_process(&id, &old.generation).is_none());
        let attached = create(&manager, &id, script, sink);
        assert_eq!(attached.generation, replacement.generation);
        assert!(!attached.exited);
        let observed = until_exit(&receiver, &replacement.generation);
        let output = joined(&observed, &replacement.generation);
        assert!(output.contains("TO06_END"));
        println!(
            "TO06 real PTY events: {}",
            serde_json::to_string(&observed).unwrap()
        );
    }

    #[test]
    fn real_pty_concurrent_create_attaches_one_generation() {
        let manager = TerminalManager::new();
        let id = format!("terminal-concurrent-{}", uuid::Uuid::new_v4());
        let _cleanup = Cleanup {
            manager: manager.clone(),
            id: id.clone(),
        };
        let (sink, receiver) = events();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        #[cfg(windows)]
        let script = "[Console]::WriteLine('TO06_ONLY_CHILD'); Start-Sleep -Milliseconds 250";
        #[cfg(not(windows))]
        let script = "printf 'TO06_ONLY_CHILD\\n'; sleep 0.25";
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let manager = manager.clone();
                let id = id.clone();
                let sink = sink.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    create(&manager, &id, script, sink)
                })
            })
            .collect();
        barrier.wait();
        let infos: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(infos[0].generation, infos[1].generation);
        let observed = until_exit(&receiver, &infos[0].generation);
        let output = joined(&observed, &infos[0].generation);
        assert_eq!(output.matches("TO06_ONLY_CHILD").count(), 1, "{output:?}");
        println!(
            "TO06 concurrent real PTY events: {}",
            serde_json::to_string(&observed).unwrap()
        );
    }
}
