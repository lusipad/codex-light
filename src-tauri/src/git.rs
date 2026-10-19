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

