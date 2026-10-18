use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

const DESKTOP_PROJECT_ROOTS_KEY: &str = "electron-saved-workspace-roots";
const DESKTOP_WORKSPACE_LABELS_KEY: &str = "electron-workspace-root-labels";
const ACTIVE_WORKSPACE_ROOTS_KEY: &str = "active-workspace-roots";
const PINNED_THREAD_IDS_KEY: &str = "pinned-thread-ids";
const ARCHIVED_THREADS_KEY: &str = "archivedThreads";
const THREAD_WORKSPACE_HINTS_KEY: &str = "thread-workspace-root-hints";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootItem {
    pub id: String,
    pub path: String,
    pub label: String,
    pub active: bool,
    pub has_agents_md: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntryItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewResult {
    pub path: String,
    pub is_binary: bool,
    pub is_image: bool,
    pub content: Option<String>,
    pub base64_data_url: Option<String>,
    pub size_bytes: u64,
    pub mtime_ms: u64,
}

pub fn codex_home_dir() -> PathBuf {
    if let Ok(env_home) = std::env::var("CODEX_HOME") {
        if !env_home.trim().is_empty() {
            return PathBuf::from(env_home.trim());
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

pub fn desktop_global_state_path() -> PathBuf {
    codex_home_dir().join(".codex-global-state.json")
}

pub fn normalize_fs_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let expanded = if trimmed == "~" || trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            home.join(&trimmed[2..]).to_string_lossy().to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    let p = PathBuf::from(&expanded);
    let resolved = fs::canonicalize(&p).unwrap_or(p);
    let s = resolved.to_string_lossy().to_string();
    // Strip Windows extended-length prefix \\?\
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        s
    }
}

#[derive(Clone)]
pub struct DesktopStateManager {
    state_map: Arc<Mutex<Map<String, Value>>>,
}

impl DesktopStateManager {
    pub fn new() -> Self {
        let mut initial = Map::new();
        let state_path = desktop_global_state_path();
        if let Ok(raw) = fs::read_to_string(&state_path) {
            if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) {
                initial = obj;
            }
        }
        Self {
            state_map: Arc::new(Mutex::new(initial)),
        }
    }

    fn save_locked(map: &Map<String, Value>) {
        let state_path = desktop_global_state_path();
        if let Some(parent) = state_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(serialized) = serde_json::to_string_pretty(&Value::Object(map.clone())) {
            let _ = fs::write(&state_path, serialized);
        }
    }

    pub fn get_value(&self, key: &str) -> Value {
        let guard = self.state_map.lock().unwrap();
        guard.get(key).cloned().unwrap_or(Value::Null)
    }

    pub fn set_value(&self, key: &str, value: Value) {
        let mut guard = self.state_map.lock().unwrap();
        guard.insert(key.to_string(), value);
        Self::save_locked(&guard);
    }

    pub fn list_workspace_roots(&self) -> Vec<WorkspaceRootItem> {
        let guard = self.state_map.lock().unwrap();
        let mut roots: Vec<String> = guard
            .get(DESKTOP_PROJECT_ROOTS_KEY)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str())
                    .map(normalize_fs_path)
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        if roots.is_empty() {
            if let Ok(cwd) = std::env::current_dir() {
                roots.push(normalize_fs_path(&cwd.to_string_lossy()));
            }
        }

        let labels: HashMap<String, String> = guard
            .get(DESKTOP_WORKSPACE_LABELS_KEY)
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (normalize_fs_path(k), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        let active_roots: Vec<String> = guard
            .get(ACTIVE_WORKSPACE_ROOTS_KEY)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(normalize_fs_path)
                    .collect()
            })
            .unwrap_or_default();

        let primary_active = active_roots
            .first()
            .cloned()
            .or_else(|| roots.first().cloned())
            .unwrap_or_default();

        roots
            .into_iter()
            .map(|path| {
                let default_label = Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&path)
                    .to_string();
                let label = labels.get(&path).cloned().unwrap_or(default_label);
                let active = path.eq_ignore_ascii_case(&primary_active);
                let has_agents_md = find_agents_md(&path).is_some();
                WorkspaceRootItem {
                    id: path.clone(),
                    path,
                    label,
                    active,
                    has_agents_md,
                }
            })
            .collect()
    }

    pub fn active_workspace_root(&self) -> String {
        let items = self.list_workspace_roots();
        items
            .iter()
            .find(|i| i.active)
            .or_else(|| items.first())
            .map(|i| i.path.clone())
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .map(|p| normalize_fs_path(&p.to_string_lossy()))
                    .unwrap_or_else(|_| ".".to_string())
            })
    }

    pub fn add_workspace_root(
        &self,
        raw_path: &str,
        label: Option<String>,
        set_active: bool,
    ) -> Result<Vec<WorkspaceRootItem>, String> {
        let normalized = normalize_fs_path(raw_path);
        if normalized.is_empty() || !Path::new(&normalized).exists() {
            return Err(format!("Path does not exist: {}", raw_path));
        }
        {
            let mut guard = self.state_map.lock().unwrap();
            let mut current: Vec<String> = guard
                .get(DESKTOP_PROJECT_ROOTS_KEY)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .map(normalize_fs_path)
                        .collect()
                })
                .unwrap_or_default();
            current.retain(|p| !p.eq_ignore_ascii_case(&normalized));
            current.insert(0, normalized.clone());
            guard.insert(DESKTOP_PROJECT_ROOTS_KEY.to_string(), json!(current));

            if let Some(lbl) = label.filter(|s| !s.trim().is_empty()) {
                let mut labels_obj = guard
                    .get(DESKTOP_WORKSPACE_LABELS_KEY)
                    .and_then(|v| v.as_object())
                    .cloned()
                    .unwrap_or_default();
                labels_obj.insert(normalized.clone(), Value::String(lbl.trim().to_string()));
                guard.insert(
                    DESKTOP_WORKSPACE_LABELS_KEY.to_string(),
                    Value::Object(labels_obj),
                );
            }

            if set_active {
                guard.insert(ACTIVE_WORKSPACE_ROOTS_KEY.to_string(), json!([normalized]));
            }
            Self::save_locked(&guard);
        }
        Ok(self.list_workspace_roots())
    }

    pub fn remove_workspace_root(&self, raw_path: &str) -> Vec<WorkspaceRootItem> {
        let normalized = normalize_fs_path(raw_path);
        {
            let mut guard = self.state_map.lock().unwrap();
            let mut current: Vec<String> = guard
                .get(DESKTOP_PROJECT_ROOTS_KEY)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .map(normalize_fs_path)
                        .filter(|p| !p.eq_ignore_ascii_case(&normalized))
                        .collect()
                })
                .unwrap_or_default();
            guard.insert(DESKTOP_PROJECT_ROOTS_KEY.to_string(), json!(current));

            let active: Vec<String> = guard
                .get(ACTIVE_WORKSPACE_ROOTS_KEY)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .map(normalize_fs_path)
                        .filter(|p| !p.eq_ignore_ascii_case(&normalized))
                        .collect()
                })
                .unwrap_or_default();
            let next_active = if active.is_empty() {
                current.drain(..1).collect::<Vec<_>>()
            } else {
                active
            };
            guard.insert(ACTIVE_WORKSPACE_ROOTS_KEY.to_string(), json!(next_active));
            Self::save_locked(&guard);
        }
        self.list_workspace_roots()
    }

    pub fn set_active_workspace_root(&self, raw_path: &str) -> Vec<WorkspaceRootItem> {
        let normalized = normalize_fs_path(raw_path);
        if !normalized.is_empty() {
            let mut guard = self.state_map.lock().unwrap();
            guard.insert(ACTIVE_WORKSPACE_ROOTS_KEY.to_string(), json!([normalized]));
            Self::save_locked(&guard);
        }
        self.list_workspace_roots()
    }

    pub fn list_pinned_threads(&self) -> Vec<String> {
        let guard = self.state_map.lock().unwrap();
        guard
            .get(PINNED_THREAD_IDS_KEY)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn toggle_thread_pinned(&self, thread_id: &str, pinned: bool) -> Vec<String> {
        let mut current = self.list_pinned_threads();
        current.retain(|id| id != thread_id);
        if pinned {
            current.insert(0, thread_id.to_string());
        }
        self.set_value(PINNED_THREAD_IDS_KEY, json!(current));
        current
    }

    pub fn list_archived_threads(&self) -> Vec<Value> {
        let guard = self.state_map.lock().unwrap();
        guard
            .get(ARCHIVED_THREADS_KEY)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_archived_threads(&self, threads: Vec<Value>) {
        self.set_value(ARCHIVED_THREADS_KEY, Value::Array(threads));
    }

    pub fn record_thread_workspace(&self, thread_id: &str, cwd: &str) {
        if thread_id.trim().is_empty() || cwd.trim().is_empty() {
            return;
        }
        let mut guard = self.state_map.lock().unwrap();
        let mut hints = guard
            .get(THREAD_WORKSPACE_HINTS_KEY)
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        hints.insert(
            thread_id.to_string(),
            Value::String(normalize_fs_path(cwd)),
        );
        guard.insert(THREAD_WORKSPACE_HINTS_KEY.to_string(), Value::Object(hints));
        Self::save_locked(&guard);
    }

    pub fn get_thread_workspace_hints(&self) -> HashMap<String, String> {
        let guard = self.state_map.lock().unwrap();
        guard
            .get(THREAD_WORKSPACE_HINTS_KEY)
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    }
}

pub fn find_agents_md(root_dir: &str) -> Option<(String, String)> {
    let candidates = ["AGENTS.md", "CLAUDE.md", "agents.md", "claude.md"];
    let base = Path::new(root_dir);
    for name in candidates {
        let candidate = base.join(name);
        if candidate.is_file() {
            if let Ok(content) = fs::read_to_string(&candidate) {
                if !content.trim().is_empty() {
                    return Some((
                        candidate.to_string_lossy().to_string(),
                        content.trim().to_string(),
                    ));
                }
            }
        }
    }
    None
}

pub fn list_directory_entries(dir_path: &str, show_hidden: bool) -> Result<Vec<DirectoryEntryItem>, String> {
    let normalized = normalize_fs_path(dir_path);
    let path = Path::new(&normalized);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path));
    }
    let mut items = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !show_hidden && name.starts_with('.') && name != ".env" && name != ".gitignore" {
            continue;
        }
        if name == "node_modules" || name == "target" || name == ".git" {
            if !show_hidden {
                continue;
            }
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        items.push(DirectoryEntryItem {
            name,
            path: normalize_fs_path(&entry.path().to_string_lossy()),
            is_directory: meta.is_dir(),
            size: meta.len(),
            mtime_ms,
        });
    }
    items.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

pub fn read_file_preview(file_path: &str, max_bytes: usize) -> Result<FilePreviewResult, String> {
    let normalized = normalize_fs_path(file_path);
    let path = Path::new(&normalized);
    if !path.is_file() {
        return Err(format!("Not a file: {}", file_path));
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let size_bytes = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let image_mime = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    };

    if let Some(mime) = image_mime {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(FilePreviewResult {
            path: normalized,
            is_binary: true,
            is_image: true,
            content: None,
            base64_data_url: Some(format!("data:{};base64,{}", mime, b64)),
            size_bytes,
            mtime_ms,
        });
    }

    let raw_bytes = fs::read(path).map_err(|e| e.to_string())?;
    let slice = if raw_bytes.len() > max_bytes {
        &raw_bytes[..max_bytes]
    } else {
        &raw_bytes[..]
    };

    // Heuristic binary check: null byte in first 8KB
    let check_len = slice.len().min(8192);
    if slice[..check_len].contains(&0) {
        return Ok(FilePreviewResult {
            path: normalized,
            is_binary: true,
            is_image: false,
            content: None,
            base64_data_url: None,
            size_bytes,
            mtime_ms,
        });
    }

    let mut text = String::from_utf8_lossy(slice).to_string();
    if raw_bytes.len() > max_bytes {
        text.push_str(&format!(
            "\n\n... [Truncated: showing {} KB of {} KB]",
            max_bytes / 1024,
            raw_bytes.len() / 1024
        ));
    }

    Ok(FilePreviewResult {
        path: normalized,
        is_binary: false,
        is_image: false,
        content: Some(text),
        base64_data_url: None,
        size_bytes,
        mtime_ms,
    })
}
