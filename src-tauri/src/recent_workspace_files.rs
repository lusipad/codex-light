use std::path::{Component, Path};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

const EXCLUDED_DIRS: &[&str] = &[
    ".git", ".gradle", ".idea", ".kotlin", ".next", ".turbo", ".venv", "build",
    "coverage", "dist", "node_modules", "out", "target", "vendor",
];
const MAX_CANDIDATES: usize = 20;
static ACTIVE_SCAN: Mutex<Option<(String, oneshot::Sender<()>)>> = Mutex::new(None);
const ATOMS_KEY: &str = "electron-persisted-atom-state";
const HISTORY_KEY: &str = "recent-workspace-files-v3";
const MAX_HISTORY: usize = 100;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentWorkspaceFile {
    path: String,
    updated_at: u64,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileAccess {
    host_id: String,
    thread_id: String,
    path: String,
    updated_at: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    deleted: bool,
}

fn path_key(path: &str) -> String {
    let mut key = path.replace('\\', "/");
    key.truncate(key.trim_end_matches('/').len());
    if key.as_bytes().get(1) == Some(&b':') || key.starts_with("//") {
        key = key.to_lowercase();
    }
    key
}

fn in_scope(path: &str, root: &str) -> bool {
    let valid = |value: &str| Path::new(value).is_absolute()
        && !Path::new(value).components().any(|part| part == Component::ParentDir);
    valid(path) && valid(root) && path_key(path).strip_prefix(&path_key(root)).is_some_and(|tail| tail.starts_with('/') && tail.len() > 1)
}

fn object_or_empty(value: Value) -> Result<Map<String, Value>, String> {
    match value {
        Value::Null => Ok(Map::new()),
        Value::Object(map) => Ok(map),
        _ => Err("最近文件记录格式无效".into()),
    }
}

fn merge_access(previous: Value, access: FileAccess) -> Result<Value, String> {
    let mut atoms = object_or_empty(previous)?;
    let mut history = object_or_empty(atoms.remove(HISTORY_KEY).unwrap_or(Value::Null))?;
    let key = json!([access.host_id, access.thread_id, path_key(&access.path)]).to_string();
    let timestamp = |value: &Value| value["updatedAt"].as_u64().unwrap_or_default();
    if history.get(&key).is_none_or(|record| timestamp(record) <= access.updated_at) {
        history.insert(key, serde_json::to_value(access).map_err(|error| error.to_string())?);
    }
    let mut records: Vec<_> = history.into_iter().collect();
    records.sort_by_key(|(_, record)| std::cmp::Reverse(timestamp(record)));
    atoms.insert(HISTORY_KEY.into(), Value::Object(records.into_iter().take(MAX_HISTORY).collect()));
    Ok(Value::Object(atoms))
}

pub(crate) fn record_access(state: &crate::state::DesktopStateManager, root: &str, path: String, thread_id: String, updated_at: u64) -> Result<(), String> {
    if !in_scope(&path, root) {
        return Err("最近文件超出工作区范围".into());
    }
    state.update_value_persisted(ATOMS_KEY, |previous| merge_access(previous, FileAccess {
        host_id: "local".into(), thread_id, path, updated_at, deleted: false,
    }))?;
    Ok(())
}

pub(crate) async fn read_history(atoms: Value, roots: &[String]) -> Result<Vec<RecentWorkspaceFile>, String> {
    let mut atoms = object_or_empty(atoms)?;
    let history = object_or_empty(atoms.remove(HISTORY_KEY).unwrap_or(Value::Null))?;
    let mut records: Vec<FileAccess> = history.into_values().filter_map(|record| serde_json::from_value(record).ok())
        .filter(|record: &FileAccess| record.host_id == "local" && roots.iter().any(|root| in_scope(&record.path, root))).collect();
    records.sort_by_key(|record| (std::cmp::Reverse(record.updated_at), !record.deleted));
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for record in records {
        if !seen.insert(path_key(&record.path)) || record.deleted {
            continue;
        }
        if tokio::fs::symlink_metadata(&record.path).await.is_ok_and(|metadata| metadata.is_file()) {
            files.push(RecentWorkspaceFile { path: record.path, updated_at: record.updated_at });
            if files.len() == 10 { break; }
        }
    }
    Ok(files)
}

pub(crate) fn history_snapshot(state: &crate::state::DesktopStateManager) -> Value {
    state.get_value(ATOMS_KEY)
}

pub(crate) fn cancel(request_id: &str) {
    let mut active = ACTIVE_SCAN.lock().unwrap_or_else(|error| error.into_inner());
    if active.as_ref().is_some_and(|(id, _)| id == request_id) {
        active.take();
    }
}

pub(crate) async fn list(roots: &[String], cli_path: &str, request_id: String) -> Result<Vec<RecentWorkspaceFile>, String> {
    if roots.is_empty() || roots.iter().any(|root| !Path::new(root).is_absolute()) {
        return Err("An absolute workspace path is required".into());
    }
    let (send, cancelled) = oneshot::channel();
    *ACTIVE_SCAN.lock().unwrap_or_else(|error| error.into_inner()) = Some((request_id.clone(), send));
    let result = tokio::select! {
        _ = cancelled => Err("Recent file scan cancelled".into()),
        result = scan_roots(roots, cli_path) => result,
    };
    cancel(&request_id);
    result
}

async fn scan_roots(roots: &[String], cli_path: &str) -> Result<Vec<RecentWorkspaceFile>, String> {
    let mut files = Vec::new();
    for root in roots {
        files.extend(tokio::time::timeout(Duration::from_secs(30), scan(Path::new(root), cli_path))
            .await.map_err(|_| "Recent file scan timed out")??);
    }
    files.sort_by_key(|file| std::cmp::Reverse(file.updated_at));
    let mut seen = std::collections::HashSet::new();
    files.retain(|file| seen.insert(path_key(&file.path)));
    files.truncate(MAX_CANDIDATES);
    Ok(files)
}

async fn scan(root: &Path, cli_path: &str) -> Result<Vec<RecentWorkspaceFile>, String> {
    let rg_name = if cfg!(windows) { "rg.exe" } else { "rg" };
    let cli = Path::new(cli_path);
    let companion = cli.with_file_name(rg_name);
    let executable = if cli.is_absolute() && companion.is_file() {
        companion
    } else {
        std::env::var_os("PATH").into_iter().flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
            .filter(|dir| dir.is_absolute()).map(|dir| dir.join(rg_name)).find(|path| path.is_file())
            .ok_or("ripgrep unavailable")?
    };
    let mut command = Command::new(executable);
    command.args(["--files", "--hidden", "--no-config", "--no-follow", "--sortr", "modified", "--null"]);
    for dir in EXCLUDED_DIRS {
        command.args(["--iglob", &format!("!**/{dir}/**")]);
    }
    command.args(["--", "."]).current_dir(root).stdin(Stdio::null())
        .stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("Recent file scan has no output pipe")?;
    let mut reader = BufReader::new(stdout.take(2 * 1024 * 1024));
    let mut candidates = Vec::new();
    while candidates.len() < MAX_CANDIDATES {
        let mut entry = Vec::new();
        if reader.read_until(0, &mut entry).await.map_err(|error| error.to_string())? == 0 {
            break;
        }
        if entry.pop() != Some(0) {
            return Err("Incomplete recent file scan output".into());
        }
        candidates.push(entry);
    }
    if candidates.len() == MAX_CANDIDATES {
        let _ = child.kill().await;
    } else {
        let status = child.wait().await.map_err(|error| error.to_string())?;
        if !status.success() && status.code() != Some(1) {
            return Err("Recent file scan failed".into());
        }
    }
    let mut results = Vec::new();
    for candidate in candidates {
        if let Some(file) = file_entry(root, &candidate).await? {
            results.push(file);
        }
    }
    results.sort_by_key(|file| std::cmp::Reverse(file.updated_at));
    Ok(results)
}

async fn file_entry(root: &Path, candidate: &[u8]) -> Result<Option<RecentWorkspaceFile>, String> {
    let Ok(candidate) = std::str::from_utf8(candidate) else { return Ok(None) };
    let relative = Path::new(candidate);
    let relative = relative.strip_prefix(".").unwrap_or(relative);
    if relative.as_os_str().is_empty() || !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return Ok(None);
    }
    let path = root.join(relative);
    let metadata = match tokio::fs::symlink_metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    let updated_at = metadata.modified().map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    Ok(Some(RecentWorkspaceFile { path: path.to_string_lossy().into_owned(), updated_at }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recent_candidate_requires_a_regular_relative_file() {
        let root = std::env::temp_dir().join(format!("codex-recent-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("测试🚀.rs");
        std::fs::write(&path, b"private fixture").unwrap();
        let entry = file_entry(&root, "./测试🚀.rs".as_bytes()).await.unwrap().unwrap();
        assert_eq!(Path::new(&entry.path), path);
        assert!(entry.updated_at > 0);
        for invalid in [".", "missing", "../测试🚀.rs", path.to_str().unwrap()] {
            assert!(file_entry(&root, invalid.as_bytes()).await.unwrap().is_none());
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[tokio::test]
    async fn recent_history_projects_local_existing_files_and_respects_tombstones() {
        let root = std::env::temp_dir().join(format!("codex-recent-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("测试🚀.txt");
        let other = root.join("other");
        let roots = [other.to_string_lossy().into_owned(), root.to_string_lossy().into_owned()];
        std::fs::write(&path, b"private fixture").unwrap();
        let access = |host: &str, thread: &str, updated_at, deleted| FileAccess {
            host_id: host.into(), thread_id: thread.into(), path: path.to_string_lossy().into_owned(), updated_at, deleted,
        };
        let mut atoms = merge_access(json!({ "unrelated": 5 }), access("local", "one", 10, false)).unwrap();
        atoms = merge_access(atoms, access("local", "one", 5, false)).unwrap();
        atoms = merge_access(atoms, access("remote", "one", 20, false)).unwrap();
        let serialized = serde_json::to_vec(&atoms).unwrap();
        let rows = read_history(serde_json::from_slice(&serialized).unwrap(), &roots).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].updated_at, 10);
        atoms = merge_access(atoms, access("local", "other", 10, true)).unwrap();
        assert!(read_history(atoms.clone(), &roots).await.unwrap().is_empty());
        atoms = merge_access(atoms, access("local", "one", 30, false)).unwrap();
        assert_eq!(read_history(atoms.clone(), &roots).await.unwrap()[0].updated_at, 30);
        assert!(read_history(atoms.clone(), &roots[..1]).await.unwrap().is_empty());
        std::fs::remove_file(path.clone()).unwrap();
        assert!(read_history(atoms.clone(), &roots).await.unwrap().is_empty());
        assert_eq!(atoms["unrelated"], 5);
        for i in 1..=110 {
            atoms = merge_access(atoms, access("local", &format!("thread-{i}"), 30 + i, false)).unwrap();
        }
        assert_eq!(atoms[HISTORY_KEY].as_object().unwrap().len(), 100);
        assert!(merge_access(json!({(HISTORY_KEY): []}), access("local", "one", 40, false)).is_err());
        std::fs::remove_dir(root).unwrap();
    }
}
