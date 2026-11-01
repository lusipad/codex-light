use crate::state::{codex_home_dir, normalize_fs_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub status: String,
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInfo {
    pub is_git_repo: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub upstream_ref: Option<String>,
    pub commits_ahead: u32,
    pub clean: bool,
    pub additions: u32,
    pub deletions: u32,
    pub files_changed: u32,
    pub entries: Vec<GitFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeInfo {
    pub path: String,
    pub git_dir: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub is_codex_managed: bool,
    pub owner_thread_id: Option<String>,
    pub has_uncommitted_changes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhCliStatus {
    pub is_installed: bool,
    pub is_authenticated: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub relative_time: String,
}

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

pub fn find_git_root(target_path: &str) -> Option<String> {
    let normalized = normalize_fs_path(target_path);
    if normalized.is_empty() {
        return None;
    }
    let p = Path::new(&normalized);
    let cwd = if p.is_dir() {
        normalized
    } else {
        p.parent()?.to_string_lossy().to_string()
    };
    let out = run_git(&cwd, &["rev-parse", "--show-toplevel"]).ok()?;
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(normalize_fs_path(trimmed))
    }
}

pub fn current_branch(git_root: &str) -> Option<String> {
    if let Ok(b) = run_git(git_root, &["branch", "--show-current"]) {
        let t = b.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if let Ok(b) = run_git(git_root, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        let t = b.trim();
        if !t.is_empty() && t != "HEAD" {
            return Some(t.to_string());
        }
    }
    if let Ok(rev) = run_git(git_root, &["rev-parse", "--short", "HEAD"]) {
        let t = rev.trim();
        if !t.is_empty() {
            return Some(format!("HEAD ({})", t));
        }
    }
    None
}

pub fn default_branch(git_root: &str) -> Option<String> {
    if let Ok(sym) = run_git(git_root, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let t = sym.trim();
        if let Some((_, branch)) = t.split_once('/') {
            if !branch.is_empty() {
                return Some(branch.to_string());
            }
        }
    }
    if let Ok(list) = run_git(git_root, &["branch", "--format=%(refname:short)"]) {
        let branches: Vec<&str> = list.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        if branches.contains(&"main") {
            return Some("main".to_string());
        }
        if branches.contains(&"master") {
            return Some("master".to_string());
        }
        if let Some(first) = branches.first() {
            return Some((*first).to_string());
        }
    }
    current_branch(git_root)
}

pub fn git_status_for_path(target_path: &str) -> GitStatusInfo {
    let Some(git_root) = find_git_root(target_path) else {
        return GitStatusInfo {
            is_git_repo: false,
            root: None,
            branch: None,
            default_branch: None,
            upstream_ref: None,
            commits_ahead: 0,
            clean: true,
            additions: 0,
            deletions: 0,
            files_changed: 0,
            entries: Vec::new(),
        };
    };

    let branch = current_branch(&git_root);
    let def_branch = default_branch(&git_root);
    let upstream_ref = run_git(
        &git_root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());

    let commits_ahead = if let Some(ref up) = upstream_ref {
        run_git(&git_root, &["rev-list", "--count", &format!("{}..HEAD", up)])
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0)
    } else {
        0
    };

    let mut entries = Vec::new();
    if let Ok(raw_status) = run_git(&git_root, &["status", "--porcelain=v1", "-uall"]) {
        for line in raw_status.lines() {
            if line.len() < 3 {
                continue;
            }
            let status_code = &line[..2];
            let file_path = line[3..].trim().to_string();
            let b0 = status_code.as_bytes()[0] as char;
            let b1 = status_code.as_bytes()[1] as char;
            let untracked = status_code == "??";
            let staged = b0 != ' ' && b0 != '?';
            let unstaged = b1 != ' ';
            entries.push(GitFileEntry {
                status: status_code.trim().to_string(),
                path: file_path,
                staged,
                unstaged,
                untracked,
            });
        }
    }

    // Compute working tree + staged numstat against HEAD
    let mut additions = 0u32;
    let mut deletions = 0u32;
    let mut files_changed = 0u32;
    let numstat_out = run_git(&git_root, &["diff", "--numstat", "HEAD"])
        .or_else(|_| run_git(&git_root, &["diff", "--numstat"]));
    if let Ok(raw_stat) = numstat_out {
        for line in raw_stat.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                if let Ok(a) = parts[0].parse::<u32>() {
                    additions += a;
                }
                if let Ok(d) = parts[1].parse::<u32>() {
                    deletions += d;
                }
                files_changed += 1;
            }
        }
    }

    GitStatusInfo {
        is_git_repo: true,
        root: Some(git_root),
        branch,
        default_branch: def_branch,
        upstream_ref,
        commits_ahead,
        clean: entries.is_empty(),
        additions,
        deletions,
        files_changed,
        entries,
    }
}

pub fn git_diff_for_path(
    target_path: &str,
    file_path: Option<String>,
    staged: bool,
    base_branch: Option<String>,
) -> Result<String, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    if let Some(base) = base_branch.filter(|b| !b.trim().is_empty()) {
        let range = format!("{}...HEAD", base.trim());
        if let Some(fp) = file_path.filter(|f| !f.trim().is_empty()) {
            return run_git(&git_root, &["diff", &range, "--", &fp]);
        }
        return run_git(&git_root, &["diff", &range]);
    }

    if let Some(fp) = file_path.filter(|f| !f.trim().is_empty()) {
        let full_file = Path::new(&git_root).join(&fp);
        // Check if file is untracked; if so, synthesize a unified diff
        let is_untracked = run_git(&git_root, &["ls-files", "--error-unmatch", "--", &fp]).is_err();
        if is_untracked && full_file.is_file() {
            if let Ok(content) = fs::read_to_string(&full_file) {
                let mut synth = format!(
                    "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n",
                    fp,
                    content.lines().count()
                );
                for line in content.lines() {
                    synth.push('+');
                    synth.push_str(line);
                    synth.push('\n');
                }
                return Ok(synth);
            }
        }
        if staged {
            return run_git(&git_root, &["diff", "--staged", "--", &fp]);
        }
        let wt_diff = run_git(&git_root, &["diff", "HEAD", "--", &fp])
            .or_else(|_| run_git(&git_root, &["diff", "--", &fp]))?;
        return Ok(wt_diff);
    }

    if staged {
        run_git(&git_root, &["diff", "--staged"])
    } else {
        run_git(&git_root, &["diff", "HEAD"]).or_else(|_| run_git(&git_root, &["diff"]))
    }
}

pub fn git_stage_file(target_path: &str, file_path: Option<String>) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    match file_path.filter(|s| !s.trim().is_empty()) {
        Some(fp) => {
            run_git(&git_root, &["add", "--", &fp])?;
        }
        None => {
            run_git(&git_root, &["add", "-A"])?;
        }
    }
    Ok(())
}

pub fn git_unstage_file(target_path: &str, file_path: Option<String>) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    match file_path.filter(|s| !s.trim().is_empty()) {
        Some(fp) => {
            let _ = run_git(&git_root, &["reset", "HEAD", "--", &fp]);
        }
        None => {
            let _ = run_git(&git_root, &["reset", "HEAD"]);
        }
    }
    Ok(())
}

pub fn git_discard_file(target_path: &str, file_path: &str) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let is_untracked = run_git(&git_root, &["ls-files", "--error-unmatch", "--", file_path]).is_err();
    if is_untracked {
        let full = Path::new(&git_root).join(file_path);
        if full.is_file() {
            fs::remove_file(full).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    run_git(&git_root, &["checkout", "--", file_path])?;
    Ok(())
}

pub fn git_commit(target_path: &str, message: &str) -> Result<String, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    run_git(&git_root, &["commit", "-m", message.trim()])
}

pub fn list_branches(target_path: &str) -> Result<Vec<String>, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let mut branches = Vec::new();
    if let Some(curr) = current_branch(&git_root) {
        branches.push(curr);
    }
    if let Ok(raw) = run_git(
        &git_root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads",
        ],
    ) {
        for line in raw.lines() {
            let b = line.trim().to_string();
            if !b.is_empty() && !branches.contains(&b) {
                branches.push(b);
            }
        }
    }
    Ok(branches)
}

pub fn create_branch(target_path: &str, branch: &str, checkout: bool) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let b = branch.trim();
    if b.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    run_git(&git_root, &["check-ref-format", "--branch", b])?;
    if checkout {
        run_git(&git_root, &["checkout", "-b", b])?;
    } else {
        run_git(&git_root, &["branch", b])?;
    }
    Ok(())
}

pub fn checkout_branch(target_path: &str, branch: &str) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    run_git(&git_root, &["checkout", branch.trim()])?;
    Ok(())
}

pub fn list_worktrees(target_path: Option<String>) -> Vec<GitWorktreeInfo> {
    let mut results = Vec::new();
    let codex_wt_root = normalize_fs_path(&codex_home_dir().join("worktrees").to_string_lossy());

    if let Some(ref target) = target_path {
        if let Some(git_root) = find_git_root(target) {
            if let Ok(raw) = run_git(&git_root, &["worktree", "list", "--porcelain"]) {
                let mut curr_path: Option<String> = None;
                let mut curr_head: Option<String> = None;
                let mut curr_branch: Option<String> = None;
                let mut curr_detached = false;

                let push_wt = |path: String,
                               head: Option<String>,
                               branch: Option<String>,
                               detached: bool,
                               out: &mut Vec<GitWorktreeInfo>| {
                    let norm_path = normalize_fs_path(&path);
                    let owner = run_git(&norm_path, &["config", "--get", "codex.ownerThreadId"])
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    let dirty = run_git(&norm_path, &["status", "--porcelain"])
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);
                    let is_codex = norm_path
                        .to_lowercase()
                        .starts_with(&codex_wt_root.to_lowercase());
                    out.push(GitWorktreeInfo {
                        path: norm_path,
                        git_dir: git_root.clone(),
                        head,
                        branch,
                        detached,
                        is_codex_managed: is_codex,
                        owner_thread_id: owner,
                        has_uncommitted_changes: dirty,
                    });
                };

                for line in raw.lines() {
                    if let Some(rest) = line.strip_prefix("worktree ") {
                        if let Some(p) = curr_path.take() {
                            push_wt(
                                p,
                                curr_head.take(),
                                curr_branch.take(),
                                curr_detached,
                                &mut results,
                            );
                        }
                        curr_path = Some(rest.trim().to_string());
                        curr_head = None;
                        curr_branch = None;
                        curr_detached = false;
                    } else if let Some(rest) = line.strip_prefix("HEAD ") {
                        curr_head = Some(rest.trim().chars().take(8).collect());
                    } else if let Some(rest) = line.strip_prefix("branch ") {
                        curr_branch = Some(
                            rest.trim()
                                .strip_prefix("refs/heads/")
                                .unwrap_or(rest.trim())
                                .to_string(),
                        );
                    } else if line.trim() == "detached" {
                        curr_detached = true;
                    }
                }
                if let Some(p) = curr_path.take() {
                    push_wt(
                        p,
                        curr_head.take(),
                        curr_branch.take(),
                        curr_detached,
                        &mut results,
                    );
                }
            }
        }
    }

    // Also scan ~/.codex/worktrees/*/* for any worktrees not already in `results`
    let wt_root_path = Path::new(&codex_wt_root);
    if let Ok(parents) = fs::read_dir(wt_root_path) {
        for parent in parents.flatten() {
            if !parent.path().is_dir() {
                continue;
            }
            if let Ok(children) = fs::read_dir(parent.path()) {
                for child in children.flatten() {
                    let dir = child.path();
                    if !dir.join(".git").exists() {
                        continue;
                    }
                    let norm_dir = normalize_fs_path(&dir.to_string_lossy());
                    if results
                        .iter()
                        .any(|w| w.path.eq_ignore_ascii_case(&norm_dir))
                    {
                        continue;
                    }
                    let owner = run_git(&norm_dir, &["config", "--get", "codex.ownerThreadId"])
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    let dirty = run_git(&norm_dir, &["status", "--porcelain"])
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);
                    let branch = current_branch(&norm_dir);
                    let head = run_git(&norm_dir, &["rev-parse", "--short", "HEAD"])
                        .ok()
                        .map(|s| s.trim().to_string());
                    results.push(GitWorktreeInfo {
                        path: norm_dir.clone(),
                        git_dir: norm_dir,
                        head,
                        branch,
                        detached: true,
                        is_codex_managed: true,
                        owner_thread_id: owner,
                        has_uncommitted_changes: dirty,
                    });
                }
            }
        }
    }

    results
}

/// Resolves an existing Codex-managed worktree for a project move.
///
/// This function is intentionally read-only: it never creates, repairs, removes,
/// or checks out a worktree. Ownership is read from the official
/// `codex-thread.json` worktree metadata rather than git config.
pub(crate) fn resolve_thread_project_worktree(
    thread_id: &str,
    current_cwd: &str,
    target_root: &str,
) -> Option<(String, String)> {
    let managed_root = normalize_fs_path(&codex_home_dir().join("worktrees").to_string_lossy());
    resolve_thread_project_worktree_at_roots(thread_id, current_cwd, target_root, &[managed_root])
}

fn resolve_thread_project_worktree_at_roots(
    thread_id: &str,
    current_cwd: &str,
    target_root: &str,
    managed_roots: &[String],
) -> Option<(String, String)> {
    if thread_id.trim().is_empty() {
        return None;
    }
    let current_path = normalize_fs_path(current_cwd);
    let target_path = normalize_fs_path(target_root);
    if current_path.is_empty() || target_path.is_empty() || !Path::new(&target_path).is_dir() {
        return None;
    }
    let current_git_root = find_git_root(&current_path)?;
    let target_git_root = find_git_root(&target_path)?;
    if !same_git_common_dir(&current_git_root, &target_git_root) {
        return None;
    }
    let target_relative = relative_path(&target_git_root, &target_path)?;

    let raw = run_git(&current_git_root, &["worktree", "list", "--porcelain"]).ok()?;
    let mut candidates = Vec::new();
    let mut path: Option<String> = None;
    for line in raw.lines().chain(std::iter::once("")) {
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(previous) = path.take() {
                candidates.push(previous);
            }
            path = Some(rest.trim().to_string());
        } else if line.trim().is_empty() {
            if let Some(previous) = path.take() {
                candidates.push(previous);
            }
        }
    }

    let mut owned = Vec::new();
    let mut current_worktree = None;
    for candidate in candidates {
        let candidate_path = normalize_fs_path(&candidate);
        if !Path::new(&candidate_path).is_dir() {
            continue;
        }
        let Some(candidate_root) = find_git_root(&candidate_path) else {
            continue;
        };
        if !same_git_common_dir(&target_git_root, &candidate_root) {
            continue;
        }
        let metadata_path = run_git(
            &candidate_path,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                "codex-thread.json",
            ],
        )
        .ok()
        .map(|s| normalize_fs_path(s.trim()));
        let metadata = metadata_path.and_then(|path| fs::read_to_string(path).ok());
        let owner_matches = metadata
            .as_deref()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
            .and_then(|value| {
                (value.get("version").and_then(|v| v.as_i64()) == Some(1)
                    && value.get("ownerThreadId").and_then(|v| v.as_str()) == Some(thread_id))
                .then_some(true)
            })
            .unwrap_or(false);
        let candidate_is_managed = managed_roots
            .iter()
            .any(|root| path_is_within(&candidate_path, root));
        if path_is_within(&current_path, &candidate_path)
            && (candidate_is_managed || owner_matches)
        {
            current_worktree = Some(candidate_path);
            break;
        }
        if owner_matches {
            let created = fs::metadata(&candidate_path)
                .and_then(|m| m.created())
                .ok();
            let modified = fs::metadata(&candidate_path)
                .and_then(|m| m.modified())
                .ok();
            owned.push((candidate_path, created, modified));
        }
    }
    if let Some(worktree_root) = current_worktree {
        return map_worktree_target(target_path, target_relative, worktree_root);
    }
    if owned.is_empty() {
        return None;
    }
    owned.sort_by(|(left_path, left_created, left_modified), (right_path, right_created, right_modified)| {
        right_created
            .or(*right_modified)
            .cmp(&left_created.or(*left_modified))
            .then_with(|| right_path.to_lowercase().cmp(&left_path.to_lowercase()))
    });
    let (worktree_root, _, _) = owned.into_iter().next()?;
    map_worktree_target(target_path, target_relative, worktree_root)
}

fn map_worktree_target(
    target_path: String,
    target_relative: String,
    worktree_root: String,
) -> Option<(String, String)> {
    let workspace_root = if target_relative.is_empty() {
        worktree_root
    } else {
        normalize_fs_path(
            &Path::new(&worktree_root)
                .join(target_relative)
                .to_string_lossy(),
        )
    };
    if !Path::new(&workspace_root).is_dir() {
        return None;
    }
    Some((target_path, workspace_root))
}

fn relative_path(root: &str, path: &str) -> Option<String> {
    let root = Path::new(root);
    let path = Path::new(path);
    path.strip_prefix(root).ok().map(|relative| {
        relative
            .to_string_lossy()
            .trim_matches(['\\', '/'])
            .to_string()
    })
}

fn path_is_within(path: &str, root: &str) -> bool {
    let path = normalize_fs_path(path).to_lowercase();
    let root = normalize_fs_path(root).to_lowercase();
    path == root || path.starts_with(&(root + std::path::MAIN_SEPARATOR.to_string().as_str()))
}

fn same_git_common_dir(left: &str, right: &str) -> bool {
    let common = |root: &str| {
        let value = run_git(
            root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .ok()?;
        Some(normalize_fs_path(value.trim()).to_lowercase())
    };
    common(left).is_some() && common(left) == common(right)
}

#[cfg(test)]
mod project_worktree_tests {
    use super::*;
    use serde_json::json;

    struct Fixture {
        root: PathBuf,
        repo: String,
        worktree: String,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("codex-project-worktree-{}", uuid::Uuid::new_v4()));
            let repo_path = root.join("repo");
            fs::create_dir_all(repo_path.join("nested")).unwrap();
            fs::write(repo_path.join("nested/file.txt"), "fixture").unwrap();
            let repo = normalize_fs_path(&repo_path.to_string_lossy());
            run_git(&repo, &["init", "--quiet"]).unwrap();
            run_git(&repo, &["add", "."]).unwrap();
            run_git(
                &repo,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "--quiet",
                    "-m",
                    "fixture",
                ],
            )
            .unwrap();
            let worktree = root
                .join("managed")
                .join("owned")
                .to_string_lossy()
                .to_string();
            run_git(
                &repo,
                &["worktree", "add", "--quiet", "--detach", &worktree],
            )
            .unwrap();
            Self {
                root,
                repo,
                worktree: normalize_fs_path(&worktree),
            }
        }

        fn owner(&self, thread_id: &str) {
            self.set_owner(&self.worktree, thread_id);
        }

        fn set_owner(&self, worktree: &str, thread_id: &str) {
            let path = run_git(
                worktree,
                &[
                    "rev-parse",
                    "--path-format=absolute",
                    "--git-path",
                    "codex-thread.json",
                ],
            )
            .unwrap();
            fs::write(path.trim(), json!({"version": 1, "ownerThreadId": thread_id}).to_string())
                .unwrap();
        }

        fn add_worktree(&self, relative_path: &str) -> String {
            let worktree = self.root.join(relative_path).to_string_lossy().to_string();
            run_git(
                &self.repo,
                &["worktree", "add", "--quiet", "--detach", &worktree],
            )
            .unwrap();
            normalize_fs_path(&worktree)
        }

        fn target(&self) -> String {
            Path::new(&self.repo)
                .join("nested")
                .to_string_lossy()
                .to_string()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let target = fs::canonicalize(&self.root).unwrap();
            let temp_root = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert!(target.starts_with(temp_root));
            assert!(target
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("codex-project-worktree-"));
            fs::remove_dir_all(target).unwrap();
        }
    }

    #[test]
    fn project_worktree_reuses_owned_checkout_and_maps_nested_source() {
        let fixture = Fixture::new();
        fixture.owner("thread-a");
        let target = fixture.target();
        let managed_root = fixture.root.join("managed").to_string_lossy().to_string();
        let before = run_git(&fixture.repo, &["worktree", "list", "--porcelain"]).unwrap();
        let result = resolve_thread_project_worktree_at_roots(
            "thread-a",
            &fixture.repo,
            &target,
            &[managed_root],
        );
        assert_eq!(
            result,
            Some((
                target,
                normalize_fs_path(
                    &Path::new(&fixture.worktree)
                        .join("nested")
                        .to_string_lossy()
                ),
            ))
        );
        assert_eq!(
            before,
            run_git(&fixture.repo, &["worktree", "list", "--porcelain"]).unwrap()
        );
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "other-thread",
                &fixture.repo,
                &fixture.target(),
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            None
        );
    }

    #[test]
    fn project_worktree_does_not_treat_shared_git_config_as_ownership() {
        let fixture = Fixture::new();
        run_git(
            &fixture.worktree,
            &["config", "codex.ownerThreadId", "thread-a"],
        )
        .unwrap();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.repo,
                &fixture.target(),
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            None
        );
    }

    #[test]
    fn project_worktree_managed_current_requires_same_repository() {
        let fixture = Fixture::new();
        let target = fixture.target();
        let managed_root = fixture.root.join("managed").to_string_lossy().to_string();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.worktree,
                &target,
                &[managed_root.clone()],
            ),
            Some((
                target,
                normalize_fs_path(
                    &Path::new(&fixture.worktree)
                        .join("nested")
                        .to_string_lossy()
                ),
            ))
        );
        let unrelated = Fixture::new();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.worktree,
                &unrelated.target(),
                &[managed_root],
            ),
            None
        );
    }

    #[test]
    fn project_worktree_prefers_current_managed_worktree_to_other_owned_worktree() {
        let fixture = Fixture::new();
        let external = fixture.add_worktree("external/owned");
        fixture.set_owner(&external, "thread-a");
        let target = fixture.target();
        let result = resolve_thread_project_worktree_at_roots(
            "thread-a",
            &fixture.worktree,
            &target,
            &[fixture.root.join("managed").to_string_lossy().to_string()],
        );
        assert_eq!(
            result,
            Some((
                target,
                normalize_fs_path(
                    &Path::new(&fixture.worktree)
                        .join("nested")
                        .to_string_lossy()
                ),
            ))
        );
    }

    #[test]
    fn project_worktree_can_reuse_owned_worktree_outside_managed_roots() {
        let fixture = Fixture::new();
        let external = fixture.add_worktree("external/owned");
        fixture.set_owner(&external, "thread-a");
        let target = fixture.target();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.repo,
                &target,
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            Some((
                target,
                normalize_fs_path(&Path::new(&external).join("nested").to_string_lossy()),
            ))
        );
    }

    #[test]
    fn project_worktree_uses_creation_time_before_modified_time() {
        let fixture = Fixture::new();
        let older = fixture.add_worktree("external/older");
        fixture.set_owner(&older, "thread-a");
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let newer = fixture.add_worktree("external/newer");
        fixture.set_owner(&newer, "thread-a");
        fs::write(Path::new(&older).join("new-file.txt"), "touch directory").unwrap();
        let target = fixture.target();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.repo,
                &target,
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            Some((
                target,
                normalize_fs_path(&Path::new(&newer).join("nested").to_string_lossy()),
            ))
        );
    }

    #[test]
    fn project_worktree_rejects_missing_mapping_and_invalid_owner_metadata() {
        let fixture = Fixture::new();
        fixture.owner("thread-a");
        fs::create_dir_all(Path::new(&fixture.repo).join("untracked-dir")).unwrap();
        let target = Path::new(&fixture.repo)
            .join("untracked-dir")
            .to_string_lossy()
            .to_string();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.repo,
                &target,
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            None
        );
        let config = run_git(
            &fixture.worktree,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                "codex-thread.json",
            ],
        )
        .unwrap();
        fs::write(config.trim(), r#"{"version":2,"ownerThreadId":"thread-a"}"#).unwrap();
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.repo,
                &fixture.target(),
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            None
        );
        assert_eq!(
            resolve_thread_project_worktree_at_roots(
                "thread-a",
                &fixture.repo,
                &fixture.root.to_string_lossy(),
                &[fixture.root.join("managed").to_string_lossy().to_string()],
            ),
            None
        );
    }
}

/// Ported from web-gateway/gateway/src/ipc/codex/pendingWorktrees.ts
pub fn create_codex_worktree(
    source_cwd: &str,
    starting_mode: &str, // "branch" | "working-tree"
    branch_name: Option<String>,
    owner_thread_id: Option<String>,
) -> Result<GitWorktreeInfo, String> {
    let repo_root = find_git_root(source_cwd).ok_or("Source directory is not a git repository")?;
    let starting_ref = if starting_mode == "branch" {
        branch_name
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| "HEAD".to_string())
    } else {
        "HEAD".to_string()
    };

    // Capture working-tree diff + untracked files if requested
    let mut pending_diff: Option<String> = None;
    let mut untracked_files: Vec<String> = Vec::new();
    if starting_mode == "working-tree" {
        if let Ok(diff_out) = run_git(&repo_root, &["diff", "HEAD", "--binary"]) {
            if !diff_out.is_empty() {
                pending_diff = Some(diff_out);
            }
        }
        if let Ok(ls_out) = run_git(
            &repo_root,
            &["ls-files", "--others", "--exclude-standard", "-z"],
        ) {
            untracked_files = ls_out
                .split('\0')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
        }
    }

    let worktrees_root = codex_home_dir().join("worktrees");
    let segment = uuid::Uuid::new_v4().simple().to_string()[..4].to_string();
    let repo_name = Path::new(&repo_root)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("worktree");
    let parent = worktrees_root.join(&segment);
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;

    let mut candidate: PathBuf = parent.join(repo_name);
    let mut counter = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{}-{}", repo_name, counter));
        counter += 1;
    }
    let worktree_path_str = candidate.to_string_lossy().to_string();

    run_git(
        &repo_root,
        &["worktree", "add", "--detach", &worktree_path_str, &starting_ref],
    )?;

    if let Some(patch_text) = pending_diff {
        let mut child = Command::new("git");
        child
            .arg("-C")
            .arg(&worktree_path_str)
            .args(["apply", "--whitespace=nowarn", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        child.creation_flags(CREATE_NO_WINDOW);

        if let Ok(mut spawned) = child.spawn() {
            if let Some(mut stdin) = spawned.stdin.take() {
                let _ = stdin.write_all(patch_text.as_bytes());
            }
            let out = spawned.wait_with_output().map_err(|e| e.to_string())?;
            if !out.status.success() {
                let _ = run_git(
                    &repo_root,
                    &["worktree", "remove", "--force", &worktree_path_str],
                );
                return Err(format!(
                    "Failed to apply working-tree changes: {}",
                    String::from_utf8_lossy(&out.stderr)
                ));
            }
        }
    }

    for rel in untracked_files {
        let from = Path::new(&repo_root).join(&rel);
        let to = candidate.join(&rel);
        if let Some(p) = to.parent() {
            let _ = fs::create_dir_all(p);
        }
        let _ = fs::copy(from, to);
    }

    if let Some(ref tid) = owner_thread_id {
        let _ = run_git(&worktree_path_str, &["config", "codex.ownerThreadId", tid]);
    }

    let norm_wt = normalize_fs_path(&worktree_path_str);
    let head = run_git(&norm_wt, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());
    let dirty = run_git(&norm_wt, &["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    Ok(GitWorktreeInfo {
        path: norm_wt,
        git_dir: repo_root,
        head,
        branch: Some(starting_ref),
        detached: true,
        is_codex_managed: true,
        owner_thread_id,
        has_uncommitted_changes: dirty,
    })
}

pub fn delete_worktree(worktree_path: &str, git_dir: Option<String>) -> Result<(), String> {
    let repo = git_dir
        .filter(|s| !s.trim().is_empty())
        .or_else(|| find_git_root(worktree_path))
        .unwrap_or_else(|| worktree_path.to_string());
    run_git(&repo, &["worktree", "remove", "--force", worktree_path])?;
    Ok(())
}

pub fn bring_worktree_changes_back(worktree_path: &str, target_cwd: &str) -> Result<String, String> {
    let target_root = find_git_root(target_cwd).ok_or("Target directory is not a git repository")?;
    let diff_out = run_git(worktree_path, &["diff", "HEAD", "--binary"]).unwrap_or_default();
    if diff_out.trim().is_empty() {
        return Ok("Worktree 没有未提交的修改需要带回。".to_string());
    }

    let mut child = Command::new("git");
    child
        .arg("-C")
        .arg(&target_root)
        .args(["apply", "--whitespace=nowarn", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    child.creation_flags(CREATE_NO_WINDOW);

    let mut spawned = child.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = spawned.stdin.take() {
        let _ = stdin.write_all(diff_out.as_bytes());
    }
    let out = spawned.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("应用改动失败: {}", err));
    }
    Ok("✓ 已成功将 Worktree 的改动应用回主工作区！".to_string())
}

pub fn repair_worktrees(cwd: &str) -> Result<String, String> {
    let repo = find_git_root(cwd).ok_or("Not a git repository")?;
    run_git(&repo, &["worktree", "repair"])
}

pub fn set_worktree_owner_thread(worktree_path: &str, thread_id: &str) -> Result<(), String> {
    run_git(worktree_path, &["config", "codex.ownerThreadId", thread_id])?;
    Ok(())
}

pub fn check_gh_cli_status() -> GhCliStatus {
    let mut cmd = Command::new("gh");
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let Ok(ver_out) = cmd.output() else {
        return GhCliStatus {
            is_installed: false,
            is_authenticated: false,
            version: None,
        };
    };
    if !ver_out.status.success() {
        return GhCliStatus {
            is_installed: false,
            is_authenticated: false,
            version: None,
        };
    }
    let version = String::from_utf8_lossy(&ver_out.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string());

    let mut auth_cmd = Command::new("gh");
    auth_cmd.args(["auth", "status", "--hostname", "github.com"]);
    #[cfg(target_os = "windows")]
    auth_cmd.creation_flags(CREATE_NO_WINDOW);
    let is_authenticated = auth_cmd
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    GhCliStatus {
        is_installed: true,
        is_authenticated,
        version,
    }
}

pub fn list_commits(target_path: &str, limit: usize) -> Result<Vec<GitCommitInfo>, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let limit_arg = format!("-n{}", limit.clamp(1, 200));
    let raw = run_git(
        &git_root,
        &[
            "log",
            &limit_arg,
            "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cr",
        ],
    )?;
    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() >= 5 {
            commits.push(GitCommitInfo {
                hash: parts[0].trim().to_string(),
                short_hash: parts[1].trim().to_string(),
                subject: parts[2].trim().to_string(),
                author: parts[3].trim().to_string(),
                relative_time: parts[4].trim().to_string(),
            });
        }
    }
    Ok(commits)
}

pub fn commit_diff(target_path: &str, commit_hash: &str) -> Result<String, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let h = commit_hash.trim();
    if h.is_empty() {
        return Err("Commit hash cannot be empty".to_string());
    }
    run_git(&git_root, &["show", "--patch", "--format=medium", h])
}

pub fn push_changes(target_path: &str, force_with_lease: bool) -> Result<String, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let branch = current_branch(&git_root).unwrap_or_else(|| "HEAD".to_string());
    if force_with_lease {
        run_git(&git_root, &["push", "--force-with-lease", "-u", "origin", &branch])
    } else {
        run_git(&git_root, &["push", "-u", "origin", &branch])
    }
}

pub fn create_pull_request(
    target_path: &str,
    title: &str,
    body: &str,
    base_branch: Option<String>,
    draft: bool,
) -> Result<String, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    if title.trim().is_empty() {
        return Err("PR title cannot be empty".to_string());
    }
    let mut cmd = Command::new("gh");
    cmd.current_dir(&git_root)
        .args(["pr", "create", "--title", title.trim(), "--body", body]);
    if let Some(base) = base_branch.filter(|b| !b.trim().is_empty()) {
        cmd.args(["--base", base.trim()]);
    }
    if draft {
        cmd.arg("--draft");
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("Failed to invoke gh CLI: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitPullRequestInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub is_draft: bool,
    pub author: Option<String>,
    pub head_ref_name: Option<String>,
    pub base_ref_name: Option<String>,
    pub updated_at: Option<String>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub url: Option<String>,
}

pub fn list_pull_requests(
    target_path: &str,
    limit: Option<usize>,
) -> Result<Vec<GitPullRequestInfo>, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let limit_val = limit.unwrap_or(30).to_string();
    let mut cmd = Command::new("gh");
    cmd.current_dir(&git_root).args([
        "pr",
        "list",
        "--limit",
        &limit_val,
        "--json",
        "number,title,state,isDraft,author,headRefName,baseRefName,updatedAt,additions,deletions,url",
    ]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("Failed to invoke gh CLI: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(stderr);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);

    #[derive(Deserialize)]
    struct GhPrJson {
        number: u64,
        title: String,
        state: String,
        #[serde(rename = "isDraft", default)]
        is_draft: bool,
        author: Option<GhAuthor>,
        #[serde(rename = "headRefName")]
        head_ref_name: Option<String>,
        #[serde(rename = "baseRefName")]
        base_ref_name: Option<String>,
        #[serde(rename = "updatedAt")]
        updated_at: Option<String>,
        additions: Option<u64>,
        deletions: Option<u64>,
        url: Option<String>,
    }
    #[derive(Deserialize)]
    struct GhAuthor {
        login: Option<String>,
    }

    let parsed: Vec<GhPrJson> =
        serde_json::from_str(&stdout).map_err(|e| format!("JSON parse error: {}", e))?;
    let list = parsed
        .into_iter()
        .map(|p| GitPullRequestInfo {
            number: p.number,
            title: p.title,
            state: p.state,
            is_draft: p.is_draft,
            author: p.author.and_then(|a| a.login),
            head_ref_name: p.head_ref_name,
            base_ref_name: p.base_ref_name,
            updated_at: p.updated_at,
            additions: p.additions,
            deletions: p.deletions,
            url: p.url,
        })
        .collect();
    Ok(list)
}


