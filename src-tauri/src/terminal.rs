use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const REPLAY_BUFFER_LIMIT: usize = 128 * 1024;

pub struct TerminalSession {
    pub id: String,
    pub cwd: String,
    pub shell: String,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub output_buffer: Arc<Mutex<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub cwd: String,
    pub shell: String,
    pub replay_log: String,
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn default_shell() -> String {
        if let Ok(sh) = std::env::var("SHELL") {
            if !sh.trim().is_empty() {
                return sh;
            }
        }
        #[cfg(target_os = "windows")]
        {
            "powershell.exe".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "/bin/zsh".to_string()
        }
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
        {
            let mut guard = self.sessions.lock().unwrap();
            if let Some(existing) = guard.get_mut(session_id) {
                let _ = existing.master.resize(PtySize {
                    rows: rows.max(2),
                    cols: cols.max(2),
                    pixel_width: 0,
                    pixel_height: 0,
                });
                let replay_log = existing.output_buffer.lock().unwrap().clone();
                return Ok(TerminalSessionInfo {
                    session_id: existing.id.clone(),
                    cwd: existing.cwd.clone(),
                    shell: existing.shell.clone(),
                    replay_log,
                });
            }
        }

        let shell = shell_override
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(Self::default_shell);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&shell);
        if std::path::Path::new(cwd).is_dir() {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell `{}`: {}", shell, e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        let output_buffer = Arc::new(Mutex::new(String::new()));
        let buf_clone = output_buffer.clone();
        let sid = session_id.to_string();
        let app_clone = app.clone();
        let sessions_clone = self.sessions.clone();

        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n]).to_string();
                        {
                            let mut b = buf_clone.lock().unwrap();
                            b.push_str(&text);
                            if b.len() > REPLAY_BUFFER_LIMIT {
                                let drain_to = b.len() - REPLAY_BUFFER_LIMIT;
                                // Ensure valid char boundary
                                let mut idx = drain_to;
                                while idx < b.len() && !b.is_char_boundary(idx) {
                                    idx += 1;
                                }
                                b.drain(..idx);
                            }
                        }
                        let _ = app_clone.emit(
                            "terminal:data",
                            json!({
                                "sessionId": sid,
                                "data": text,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
            sessions_clone.lock().unwrap().remove(&sid);
            let _ = app_clone.emit(
                "terminal:exit",
                json!({
                    "sessionId": sid,
                }),
            );
        });

        let info = TerminalSessionInfo {
            session_id: session_id.to_string(),
            cwd: cwd.to_string(),
            shell: shell.clone(),
            replay_log: String::new(),
        };

        let mut guard = self.sessions.lock().unwrap();
        guard.insert(
            session_id.to_string(),
            TerminalSession {
                id: session_id.to_string(),
                cwd: cwd.to_string(),
                shell,
                master: pair.master,
                writer,
                child,
                output_buffer,
            },
        );
        Ok(info)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut guard = self.sessions.lock().unwrap();
        let session = guard
            .get_mut(session_id)
            .ok_or_else(|| format!("Terminal session not found: {}", session_id))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        let _ = session.writer.flush();
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut guard = self.sessions.lock().unwrap();
        if let Some(session) = guard.get_mut(session_id) {
            let _ = session.master.resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            });
        }
        Ok(())
    }

    pub fn close(&self, session_id: &str) -> Result<(), String> {
        let mut guard = self.sessions.lock().unwrap();
        if let Some(mut session) = guard.remove(session_id) {
            let _ = session.child.kill();
        }
        Ok(())
    }
}
