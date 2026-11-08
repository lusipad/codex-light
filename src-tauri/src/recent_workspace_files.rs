use std::path::{Component, Path};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

const EXCLUDED_DIRS: &[&str] = &[
    ".git", ".gradle", ".idea", ".kotlin", ".next", ".turbo", ".venv", "build",
    "coverage", "dist", "node_modules", "out", "target", "vendor",
];
const MAX_CANDIDATES: usize = 20;
static ACTIVE_SCAN: Mutex<Option<(String, oneshot::Sender<()>)>> = Mutex::new(None);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentWorkspaceFile {
    path: String,
    updated_at: u64,
}

pub(crate) fn cancel(request_id: &str) {
    let mut active = ACTIVE_SCAN.lock().unwrap_or_else(|error| error.into_inner());
    if active.as_ref().is_some_and(|(id, _)| id == request_id) {
        active.take();
    }
}

pub(crate) async fn list(root: &str, cli_path: &str, request_id: String) -> Result<Vec<RecentWorkspaceFile>, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err("An absolute workspace path is required".into());
    }
    let (send, cancelled) = oneshot::channel();
    *ACTIVE_SCAN.lock().unwrap_or_else(|error| error.into_inner()) = Some((request_id.clone(), send));
    let result = tokio::select! {
        _ = cancelled => Err("Recent file scan cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(30), scan(root, cli_path)) => {
            result.unwrap_or_else(|_| Err("Recent file scan timed out".into()))
        }
    };
    cancel(&request_id);
    result
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
}
