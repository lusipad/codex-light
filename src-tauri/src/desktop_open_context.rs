use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Resolve on both menu query and selection. Never reuse the caller's stale cwd
/// for a conversation, and never resume or mutate its execution workspace here.
pub(crate) async fn resolve(
    app: &tauri::AppHandle,
    state: &crate::AppState,
    thread_id: Option<&str>,
    cwd: Option<&str>,
) -> Result<String, String> {
    let Some(thread_id) = thread_id else {
        return local_directory(cwd.ok_or("缺少本地工作区目录。")?);
    };
    if thread_id.trim().is_empty() {
        return Err("缺少会话身份，无法打开工作区。".into());
    }
    let root = read_thread_directory(thread_id, |params| {
        state.app_server.call(app, "thread/read", Some(params))
    }, || {
        state.desktop_state.get_value("electron-persisted-atom-state")
            [&format!("thread-workspace-state-v1:{thread_id}")].clone()
    }).await?;
    let thread_id = thread_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || owned_workspace(&thread_id, &root))
        .await.map_err(|_| "读取会话 worktree 失败。".to_string())?
}

async fn read_thread_directory<F, R, W>(thread_id: &str, read: F, workspace: W) -> Result<String, String>
where
    F: FnOnce(Value) -> R,
    R: std::future::Future<Output = Result<Value, String>>,
    W: FnOnce() -> Value,
{
    let current = read(json!({"threadId":thread_id,"includeTurns":false})).await?;
    thread_directory(thread_id, &current, &workspace())
}

fn local_directory(raw: &str) -> Result<String, String> {
    let path = Path::new(raw);
    if !path.is_absolute() || !path.is_dir() {
        return Err("工作区必须是当前存在的本地绝对目录。".into());
    }
    Ok(crate::state::normalize_fs_path(raw))
}

fn thread_directory(thread_id: &str, current: &Value, workspace: &Value) -> Result<String, String> {
    let thread = &current["thread"];
    if thread["id"].as_str() != Some(thread_id) {
        return Err("服务返回的会话身份不匹配，未打开工作区。".into());
    }
    // Both supported local app-server versions return null environments for
    // notLoaded threads. Reading these does not require resuming execution.
    let environments = if thread["environments"].is_null() { &[][..] } else {
        thread["environments"].as_array().ok_or("会话执行环境格式无效。")?.as_slice()
    };
    if environments.iter().any(|environment| environment["environmentId"] != "local"
        || environment["hostId"].as_str().is_some_and(|host| host != "local"))
        || thread["hostId"].as_str().is_some_and(|host| host != "local")
        || workspace["projectMembership"]["projectKind"] == "remote"
        || (workspace["projectMembership"].is_null() && workspace["project"]["projectKind"] == "remote")
    {
        return Err("远程会话不能通过本地应用打开工作区。".into());
    }
    // Applied is committed only after an accepted real turn; pending is merely
    // a proposed migration and must not redirect an external application.
    let cwd = if let Some(cwd) = environments.first().and_then(|environment| environment["cwd"].as_str()) {
        Some(cwd)
    } else if !workspace["applied"].is_null() {
        workspace["applied"]["cwd"].as_str()
    } else {
        thread["cwd"].as_str()
    }.ok_or("无法确认会话当前工作区目录。")?;
    local_directory(cwd)
}

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(cwd).args(args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|error| format!("读取工作区 Git 信息失败：{error}"))?;
    if !output.status.success() {
        return Err(format!("读取工作区 Git 信息失败：{}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    String::from_utf8(output.stdout).map_err(|_| "工作区 Git 路径不是有效 UTF-8。".into())
}

fn owned_workspace(thread_id: &str, cwd: &str) -> Result<String, String> {
    // Distinguish an ordinary folder from a failed repository read; swallowing
    // rev-parse errors here could silently open an obsolete checkout.
    if !Path::new(cwd).ancestors().any(|parent| parent.join(".git").exists()) {
        return Ok(cwd.into());
    }
    let listing = git(cwd, &["worktree", "list", "--porcelain", "-z"])?;
    let mut owned = Vec::new();
    for entry in listing.split('\0').filter_map(|field| field.strip_prefix("worktree ")) {
        if !Path::new(entry).is_dir() { continue; }
        let metadata = git(entry, &["rev-parse", "--path-format=absolute", "--git-path", "codex-thread.json"])?;
        let metadata = PathBuf::from(metadata.trim());
        let text = match std::fs::read_to_string(&metadata) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("读取 worktree 归属失败：{error}")),
        };
        let value: Value = serde_json::from_str(&text).map_err(|_| "worktree 归属记录损坏。")?;
        if value["version"] != 1 {
            return Err("worktree 归属记录版本未知。".into());
        }
        if value["ownerThreadId"].as_str() == Some(thread_id) {
            owned.push(local_directory(entry)?);
        }
    }
    choose_owned(cwd, owned)
}

fn choose_owned(cwd: &str, owned: Vec<String>) -> Result<String, String> {
    let current = Path::new(cwd);
    if let Some(root) = owned.iter().find(|root| current.starts_with(Path::new(root))) {
        return Ok(root.clone());
    }
    match owned.as_slice() {
        [] => Ok(cwd.into()),
        [root] => Ok(root.clone()),
        _ => Err("同一会话存在多个 worktree，无法确认当前工作区；未打开旧目录。".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("codex-open-context-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn path(&self) -> String { self.0.to_string_lossy().into_owned() }
        fn thread(&self) -> Value {
            json!({"thread":{"id":"t","cwd":self.path(),"environments":[{"environmentId":"local"}]}})
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn desktop_open_context_rejects_unknown_identity_and_remote() {
        let fixture = Fixture::new();
        let mut current = fixture.thread();
        assert!(thread_directory("another", &current, &Value::Null).is_err());
        current["thread"]["environments"] = json!({"bad":true});
        assert!(thread_directory("t", &current, &Value::Null).is_err());
        current["thread"]["environments"] = json!([{"environmentId":"remote","cwd":fixture.path()}]);
        assert!(thread_directory("t", &current, &Value::Null).is_err());
        assert!(thread_directory("t", &fixture.thread(), &json!({"projectMembership":{"projectKind":"remote"}})).is_err());
        assert!(local_directory("relative").is_err());
    }

    #[tokio::test]
    async fn desktop_open_context_requeries_unloaded_local_thread_without_resume() {
        let fixture = Fixture::new();
        let next = fixture.0.join("next");
        std::fs::create_dir(&next).unwrap();
        for cwd in [fixture.path(), next.to_string_lossy().into_owned()] {
            let result = read_thread_directory("t", |request| {
                assert_eq!(request, json!({"threadId":"t","includeTurns":false}));
                let current = json!({"thread":{"id":"t","cwd":cwd,"status":{"type":"notLoaded"},"environments":null}});
                async move { Ok(current) }
            }, || Value::Null).await.unwrap();
            assert_eq!(result, crate::state::normalize_fs_path(&cwd));
        }
        assert!(read_thread_directory("t", |_| async { Err("read failed".into()) }, || Value::Null).await.is_err());
    }

    #[test]
    fn desktop_open_context_uses_applied_not_pending_and_rechecks_change() {
        let fixture = Fixture::new();
        let applied = fixture.0.join("应用");
        std::fs::create_dir(&applied).unwrap();
        let state = json!({"applied":{"cwd":applied},"pending":{"cwd":"missing"}});
        assert_eq!(thread_directory("t", &fixture.thread(), &state).unwrap(), crate::state::normalize_fs_path(&applied.to_string_lossy()));
        let mut loaded = fixture.thread();
        loaded["thread"]["environments"][0]["cwd"] = json!(fixture.path());
        assert_eq!(thread_directory("t", &loaded, &state).unwrap(), crate::state::normalize_fs_path(&fixture.path()));
        assert_eq!(thread_directory("t", &fixture.thread(), &json!({"pending":{"cwd":applied}})).unwrap(), crate::state::normalize_fs_path(&fixture.path()));
        std::fs::remove_dir(&applied).unwrap();
        assert!(thread_directory("t", &fixture.thread(), &state).is_err());
    }

    #[test]
    fn desktop_open_context_does_not_pick_arbitrary_owned_checkout() {
        assert!(choose_owned("/repo", vec!["/one".into(), "/two".into()]).is_err());
        assert_eq!(choose_owned("/one/sub", vec!["/one".into(), "/two".into()]).unwrap(), "/one");
    }

    #[test]
    fn desktop_open_context_reads_real_owner_metadata_not_shared_config() {
        let fixture = Fixture::new();
        let repo = fixture.0.join("repo");
        std::fs::create_dir(&repo).unwrap();
        let repo = repo.to_string_lossy().into_owned();
        git(&repo, &["init"]).unwrap();
        git(&repo, &["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--allow-empty", "-m", "fixture"]).unwrap();
        let worktree = fixture.0.join("owned 工作区").to_string_lossy().into_owned();
        git(&repo, &["worktree", "add", "--detach", &worktree]).unwrap();
        git(&repo, &["config", "codex.ownerThreadId", "t"]).unwrap();
        assert_eq!(owned_workspace("t", &repo).unwrap(), repo);
        let metadata = git(&worktree, &["rev-parse", "--path-format=absolute", "--git-path", "codex-thread.json"]).unwrap();
        std::fs::write(metadata.trim(), json!({"version":1,"ownerThreadId":"t"}).to_string()).unwrap();
        assert_eq!(owned_workspace("t", &repo).unwrap(), crate::state::normalize_fs_path(&worktree));
        assert_eq!(owned_workspace("other", &repo).unwrap(), repo);
        std::fs::write(metadata.trim(), "bad").unwrap();
        assert!(owned_workspace("t", &repo).is_err());
    }
}
