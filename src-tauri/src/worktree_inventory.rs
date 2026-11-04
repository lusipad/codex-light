//! Read-only managed-worktree inventory. No cleanup or user scripts run here.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWorktreeRecord {
    pub path: String,
    pub git_dir: String,
    pub repo_path: String,
    pub managed_root: String,
    pub owner_thread_id: Option<String>,
    pub owner_read_failed: bool,
    pub created_at_ms: Option<u64>,
    pub identity_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryError {
    pub path: String,
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub records: Vec<ManagedWorktreeRecord>,
    pub errors: Vec<InventoryError>,
}

fn path_string(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}

fn key(path: &Path) -> String {
    let text = path_string(path);
    #[cfg(windows)]
    {
        text.replace('\\', "/").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        text
    }
}

fn checked_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("托管路径必须是不含父目录跳转的绝对路径。".into());
    }
    for ancestor in path.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).map_err(|error| error.to_string())?;
        #[allow(unused_mut)]
        let mut redirected = metadata.file_type().is_symlink();
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            redirected |= metadata.file_attributes() & 0x400 != 0;
        }
        if redirected {
            return Err("托管采集拒绝符号链接或重解析路径。".into());
        }
    }
    fs::canonicalize(path).map_err(|error| error.to_string())
}

fn strict_child(path: &Path, root: &Path) -> bool {
    let path = key(path);
    let root = key(root);
    path != root && path.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

fn git_output(cwd: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(path_string(cwd))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Inventory must resolve the scanned repository, not inherited Git context.
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_CONFIG",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
    ] {
        command.env_remove(name);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.output().map_err(|error| error.to_string())
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_output(cwd, args)?;
    if !output.status.success() {
        return Err(format!(
            "Git {:?} 失败（{}）：{}",
            args,
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

fn created_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .created()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn identity(path: &Path, git_dir: &Path) -> Result<String, String> {
    let dot_git = path.join(".git");
    checked_path(&dot_git)?;
    let metadata = fs::metadata(&dot_git).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("附加工作树 .git 必须为普通文件。".into());
    }
    let admin = fs::metadata(git_dir).map_err(|error| error.to_string())?;
    let time = |value: std::io::Result<std::time::SystemTime>| {
        value
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_nanos().to_string())
    };
    Ok(serde_json::json!({
        "dotGitBytes": fs::read(&dot_git).map_err(|error| error.to_string())?,
        "dotGitCreatedNs": time(metadata.created()),
        "dotGitModifiedNs": time(metadata.modified()),
        "gitDir": path_string(git_dir),
        "gitDirCreatedNs": time(admin.created()),
    })
    .to_string())
}

fn inspect(path: &Path, root: &Path) -> Result<ManagedWorktreeRecord, String> {
    let path = checked_path(path)?;
    if !strict_child(&path, root) {
        return Err("工作树不严格位于本次指定托管根目录内。".into());
    }
    let dot_git = checked_path(&path.join(".git"))?;
    let pointer = fs::read_to_string(&dot_git).map_err(|error| error.to_string())?;
    let pointer = Path::new(
        pointer
            .trim()
            .strip_prefix("gitdir: ")
            .ok_or("工作树 .git 不是有效管理目录指针。")?,
    );
    let pointed_git_dir = checked_path(&if pointer.is_absolute() {
        pointer.to_path_buf()
    } else {
        path.join(pointer)
    })?;
    let token = identity(&path, &pointed_git_dir)?;
    let top = checked_path(Path::new(
        git(&path, &["rev-parse", "--show-toplevel"])?.trim(),
    ))?;
    if key(&top) != key(&path) {
        return Err("目录不是完整工作树根。".into());
    }
    let common = checked_path(Path::new(
        git(
            &path,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?
        .trim(),
    ))?;
    let git_dir = checked_path(Path::new(
        git(&path, &["rev-parse", "--absolute-git-dir"])?.trim(),
    ))?;
    if key(&git_dir) != key(&pointed_git_dir) {
        return Err("Git 管理目录与采集起始身份不一致。".into());
    }
    if git_dir.parent().map(key) != Some(key(&common.join("worktrees"))) {
        return Err("工作树管理目录不是所属仓库的附加工作树登记目录。".into());
    }
    let listed = git(&path, &["worktree", "list", "--porcelain", "-z"])?;
    let registrations: Vec<_> = listed
        .split('\0')
        .filter_map(|part| part.strip_prefix("worktree "))
        .collect();
    let primary = checked_path(Path::new(
        registrations.first().ok_or("Git 未登记主工作树。")?,
    ))?;
    if key(&primary) == key(&path) {
        return Err("主工作树不能进入托管清理记录。".into());
    }
    if !registrations
        .iter()
        .skip(1)
        .any(|registered| key(Path::new(registered)) == key(&path))
    {
        return Err("目标没有对应的真实 Git 工作树登记。".into());
    }
    let primary_common = checked_path(Path::new(
        git(
            &primary,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?
        .trim(),
    ))?;
    if key(&primary_common) != key(&common) {
        return Err("工作树与主仓库的 Git 身份不一致。".into());
    }
    let registered_dot_git =
        fs::read_to_string(git_dir.join("gitdir")).map_err(|error| error.to_string())?;
    let backlink = checked_path(Path::new(registered_dot_git.trim()))?;
    if key(&backlink) != key(&path.join(".git")) {
        return Err("Git 管理目录的反向登记与工作树不一致。".into());
    }
    let created_at_ms = created_ms(&fs::metadata(&path).map_err(|error| error.to_string())?);
    if identity(&path, &git_dir)? != token {
        return Err("采集时工作树身份发生变化，请重试。".into());
    }
    Ok(ManagedWorktreeRecord {
        path: path_string(&path),
        git_dir: path_string(&git_dir),
        repo_path: path_string(&primary),
        managed_root: path_string(root),
        owner_thread_id: None,
        owner_read_failed: false,
        created_at_ms,
        identity_token: token,
    })
}

impl Inventory {
    fn error(&mut self, path: &Path, stage: &str, message: String) {
        self.errors.push(InventoryError {
            path: path_string(path),
            stage: stage.into(),
            message,
        });
    }
}

fn scan(
    inventory: &mut Inventory,
    path: &Path,
    root: &Path,
    depth: u8,
    seen: &mut HashSet<String>,
) {
    let checked = match checked_path(path) {
        Ok(path) => path,
        Err(error) => {
            inventory.error(path, "path", error);
            return;
        }
    };
    if !fs::metadata(&checked).is_ok_and(|metadata| metadata.is_dir()) {
        return;
    }
    match fs::symlink_metadata(checked.join(".git")) {
        Ok(_) => {
            match inspect(&checked, root) {
                Ok(mut record) if seen.insert(key(&checked)) => {
                    match crate::git::read_worktree_owner(&record.path) {
                        Ok(owner) => record.owner_thread_id = owner,
                        Err(error) => {
                            record.owner_read_failed = true;
                            inventory.error(&checked, "owner", error);
                        }
                    }
                    match identity(&checked, Path::new(&record.git_dir)) {
                        Ok(current) if current == record.identity_token => {
                            inventory.records.push(record)
                        }
                        Ok(_) => inventory.error(
                            &checked,
                            "identity",
                            "读取归属时工作树身份发生变化。".into(),
                        ),
                        Err(error) => inventory.error(&checked, "identity", error),
                    }
                }
                Ok(_) => {}
                Err(error) => inventory.error(&checked, "identity", error),
            }
            return;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            inventory.error(&checked, "dot-git", error.to_string());
            return;
        }
    }
    if depth == 0 {
        return;
    }
    let entries = match fs::read_dir(&checked) {
        Ok(entries) => entries,
        Err(error) => {
            inventory.error(&checked, "read-directory", error.to_string());
            return;
        }
    };
    for entry in entries {
        match entry {
            Ok(entry) => scan(inventory, &entry.path(), root, depth - 1, seen),
            Err(error) => inventory.error(&checked, "read-entry", error.to_string()),
        }
    }
}

/// Only the supplied managed roots are scanned; roots do not grant deletion rights.
pub fn collect(managed_roots: &[String]) -> Result<Inventory, String> {
    let mut inventory = Inventory::default();
    let mut seen = HashSet::new();
    for root in managed_roots {
        let path = Path::new(root);
        match checked_path(path) {
            Ok(root) => scan(&mut inventory, &root, &root, 2, &mut seen),
            Err(error) => inventory.error(path, "managed-root", error),
        }
    }
    inventory
        .records
        .sort_by(|left, right| left.path.cmp(&right.path));
    Ok(inventory)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        repo: PathBuf,
        managed: PathBuf,
        worktree: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("codex-inventory-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let root = PathBuf::from(path_string(&fs::canonicalize(&root).unwrap()));
            let repo = root.join("repo");
            let managed = root.join("managed");
            let worktree = managed.join("group/project");
            fs::create_dir_all(&repo).unwrap();
            fs::create_dir_all(worktree.parent().unwrap()).unwrap();
            git(&repo, &["init", "--quiet"]).unwrap();
            git(
                &repo,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--quiet",
                    "--allow-empty",
                    "-m",
                    "fixture",
                ],
            )
            .unwrap();
            git(
                &repo,
                &[
                    "worktree",
                    "add",
                    "--quiet",
                    "--detach",
                    &path_string(&worktree),
                ],
            )
            .unwrap();
            Self {
                root,
                repo,
                managed,
                worktree,
            }
        }
        fn collect(&self) -> Inventory {
            collect(&[path_string(&self.managed)]).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let root = fs::canonicalize(&self.root).unwrap();
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert!(root.is_absolute() && root.starts_with(temp));
            assert!(self
                .root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("codex-inventory-"));
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn wb05_collects_only_registered_strict_managed_roots() {
        let fixture = Fixture::new();
        let sibling = fixture.root.join("managed-neighbor/group/other");
        fs::create_dir_all(sibling.parent().unwrap()).unwrap();
        git(
            &fixture.repo,
            &[
                "worktree",
                "add",
                "--quiet",
                "--detach",
                &path_string(&sibling),
            ],
        )
        .unwrap();
        let outside = fixture.root.join("external");
        git(
            &fixture.repo,
            &[
                "worktree",
                "add",
                "--quiet",
                "--detach",
                &path_string(&outside),
            ],
        )
        .unwrap();
        let result = fixture.collect();
        assert_eq!(result.records.len(), 1);
        assert_eq!(
            key(Path::new(&result.records[0].path)),
            key(&fixture.worktree)
        );
        assert_eq!(
            key(Path::new(&result.records[0].repo_path)),
            key(&fixture.repo)
        );
        #[cfg(windows)]
        assert!(result.records[0].created_at_ms.is_some());
        let token: serde_json::Value =
            serde_json::from_str(&result.records[0].identity_token).unwrap();
        assert_eq!(
            token["dotGitBytes"],
            serde_json::json!(fs::read(fixture.worktree.join(".git")).unwrap())
        );
        let both = collect(&[
            path_string(&fixture.managed),
            path_string(sibling.parent().unwrap()),
        ])
        .unwrap();
        assert_eq!(both.records.len(), 2);
        let duplicate =
            collect(&[path_string(&fixture.managed), path_string(&fixture.managed)]).unwrap();
        assert_eq!(duplicate.records.len(), 1);
        assert!(!strict_child(&sibling, &fixture.managed));
    }

    #[test]
    fn wb05_primary_and_corrupt_or_unregistered_git_are_errors() {
        let fixture = Fixture::new();
        let primary = fixture.managed.join("group/primary");
        fs::create_dir(&primary).unwrap();
        git(&primary, &["init", "--quiet"]).unwrap();
        let corrupt = fixture.managed.join("group/corrupt");
        fs::create_dir(&corrupt).unwrap();
        fs::write(corrupt.join(".git"), "not a git file").unwrap();
        let fake = fixture.managed.join("group/fake");
        fs::create_dir(&fake).unwrap();
        fs::copy(fixture.worktree.join(".git"), fake.join(".git")).unwrap();
        let result = fixture.collect();
        assert_eq!(result.records.len(), 1);
        for rejected in [&primary, &corrupt, &fake] {
            assert!(
                result
                    .errors
                    .iter()
                    .any(|error| key(Path::new(&error.path)) == key(rejected)),
                "missing error for {}: {:?}",
                rejected.display(),
                result.errors
            );
        }
        let bad_roots = collect(&[
            "relative".into(),
            path_string(&fixture.root.join("missing")),
        ])
        .unwrap();
        assert_eq!(bad_roots.errors.len(), 2);
        assert!(bad_roots.records.is_empty());
    }

    #[test]
    fn wb05_identity_changes_when_dot_git_is_replaced() {
        let fixture = Fixture::new();
        let first = fixture.collect().records.remove(0);
        let dot_git = fixture.worktree.join(".git");
        let bytes = fs::read(&dot_git).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&dot_git, [&bytes[..], b"\n"].concat()).unwrap();
        let second = fixture.collect().records.remove(0);
        assert_ne!(first.identity_token, second.identity_token);
    }

    #[test]
    fn wb05_private_owner_missing_valid_and_corrupt_are_distinct() {
        let fixture = Fixture::new();
        // Legacy shared config is not authoritative worktree ownership.
        git(
            &fixture.worktree,
            &["config", "codex.ownerThreadId", "legacy-wrong"],
        )
        .unwrap();
        let missing = fixture.collect();
        assert!(missing.errors.is_empty(), "{:?}", missing.errors);
        assert!(missing.records[0].owner_thread_id.is_none());
        assert!(!missing.records[0].owner_read_failed);
        let metadata = PathBuf::from(
            git(
                &fixture.worktree,
                &[
                    "rev-parse",
                    "--path-format=absolute",
                    "--git-path",
                    "codex-thread.json",
                ],
            )
            .unwrap()
            .trim(),
        );
        fs::write(&metadata, r#"{"version":1,"ownerThreadId":"actual-owner"}"#).unwrap();
        let owned = fixture.collect();
        assert_eq!(
            owned.records[0].owner_thread_id.as_deref(),
            Some("actual-owner")
        );
        assert!(!owned.records[0].owner_read_failed);
        fs::write(&metadata, "{broken json").unwrap();
        let broken = fixture.collect();
        assert_eq!(broken.records.len(), 1);
        assert!(broken.records[0].owner_thread_id.is_none());
        assert!(broken.records[0].owner_read_failed);
        assert_eq!(broken.errors.len(), 1);
        assert_eq!(broken.errors[0].stage, "owner");
        fs::remove_file(&metadata).unwrap();
        fs::create_dir(&metadata).unwrap();
        let unreadable = fixture.collect();
        assert!(unreadable.records[0].owner_read_failed);
        assert_eq!(unreadable.errors[0].stage, "owner");
    }

    #[test]
    fn wb05_symlink_or_junction_in_any_component_is_rejected() {
        let fixture = Fixture::new();
        let redirect = fixture.managed.join("redirect");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let status = Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&redirect)
                .arg(fixture.worktree.parent().unwrap())
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                status.status.success(),
                "{}",
                String::from_utf8_lossy(&status.stderr)
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(fixture.worktree.parent().unwrap(), &redirect).unwrap();
        assert!(checked_path(&redirect.join("project")).is_err());
        let result = fixture.collect();
        assert_eq!(result.records.len(), 1);
        assert!(result
            .errors
            .iter()
            .any(|error| key(Path::new(&error.path)) == key(&redirect)));
        let redirected_root = collect(&[path_string(&redirect)]).unwrap();
        assert!(redirected_root.records.is_empty());
        assert_eq!(redirected_root.errors.len(), 1);
        #[cfg(windows)]
        fs::remove_dir(&redirect).unwrap();
        #[cfg(unix)]
        fs::remove_file(&redirect).unwrap();
    }
}
