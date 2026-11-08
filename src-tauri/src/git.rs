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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
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
    pub is_primary: bool,
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
    run_git_with_diff_status(cwd, args, false)
}

fn run_git_with_diff_status(cwd: &str, args: &[&str], accept_difference: bool) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success()
        || (accept_difference && output.status.code() == Some(1) && !output.stdout.is_empty())
    {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

pub fn merge_base(cwd: &str, base_branch: &str) -> Result<String, String> {
    let base_branch = base_branch.trim();
    if base_branch.is_empty() {
        return Err("Base branch is required".to_string());
    }
    let reference = format!("{}^{{commit}}", base_branch);
    let resolved = run_git(
        cwd,
        &["rev-parse", "--verify", "--end-of-options", &reference],
    )?;
    let base = run_git(cwd, &["merge-base", "HEAD", resolved.trim()]).map_err(|error| {
        if error.is_empty() {
            "No common ancestor with base branch".to_string()
        } else {
            error
        }
    })?;
    let base = base.trim();
    if base.is_empty() {
        return Err("No common ancestor with base branch".to_string());
    }
    Ok(base.to_string())
}

#[cfg(test)]
mod merge_base_tests {
    use super::*;

    #[test]
    fn review_diff_includes_committed_and_working_changes_and_filters_file() {
        let root = std::env::temp_dir().join(format!("codex-review-diff-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let cwd = root.to_string_lossy().to_string();
        run_git(&cwd, &["init", "--quiet"]).unwrap();
        let commit = |message: &str| {
            run_git(&cwd, &["add", "."]).unwrap();
            run_git(
                &cwd,
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
                    message,
                ],
            )
            .unwrap();
        };
        fs::write(root.join("first.txt"), "original first\n").unwrap();
        fs::write(root.join("second.txt"), "original second\n").unwrap();
        commit("base");
        let base = run_git(&cwd, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        fs::write(root.join("first.txt"), "committed first\n").unwrap();
        commit("after base");
        fs::write(root.join("first.txt"), "committed first\nworking first\n").unwrap();
        fs::write(root.join("second.txt"), "working second\n").unwrap();
        let diff = git_diff_for_path(&cwd, None, GitDiffScope::Uncommitted, None, Some(base.clone()), None).unwrap();
        assert!(diff.contains("+committed first"));
        assert!(diff.contains("+working first"));
        assert!(diff.contains("+working second"));
        let file_diff = git_diff_for_path(
            &cwd,
            Some("first.txt".to_string()),
            GitDiffScope::Staged,
            Some("missing-ignored-branch".to_string()),
            Some(base),
            None,
        )
        .unwrap();
        assert!(file_diff.contains("+committed first"));
        assert!(file_diff.contains("+working first"));
        assert!(!file_diff.contains("second.txt"));
        for invalid in ["missing-ref", "--all", ""] {
            assert!(git_diff_for_path(&cwd, None, GitDiffScope::Uncommitted, None, Some(invalid.to_string()), None).is_err());
        }
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolves_divergent_branches_and_rejects_missing_or_unrelated_refs() {
        let root = std::env::temp_dir().join(format!("codex-merge-base-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let cwd = root.to_string_lossy().to_string();
        run_git(&cwd, &["init", "--quiet"]).unwrap();
        let commit = |message: &str| {
            run_git(
                &cwd,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "--quiet",
                    "--allow-empty",
                    "-m",
                    message,
                ],
            )
            .unwrap();
        };
        commit("common");
        let common = run_git(&cwd, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        run_git(&cwd, &["branch", "base"]).unwrap();
        commit("head");
        run_git(&cwd, &["checkout", "--quiet", "base"]).unwrap();
        commit("base");
        run_git(&cwd, &["checkout", "--quiet", "--detach", "HEAD~1"]).unwrap();
        run_git(&cwd, &["checkout", "--quiet", "-b", "topic"]).unwrap();
        commit("topic");
        assert_eq!(merge_base(&cwd, "base").unwrap(), common);
        assert!(merge_base(&cwd, "missing-ref").is_err());
        assert!(merge_base(&cwd, "--all").is_err());
        assert!(merge_base(&cwd, "").is_err());
        run_git(&cwd, &["checkout", "--quiet", "--orphan", "unrelated"]).unwrap();
        commit("unrelated");
        assert!(merge_base(&cwd, "base")
            .unwrap_err()
            .contains("No common ancestor"));
        fs::remove_dir_all(&root).unwrap();
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
    if let Ok(raw_status) = run_git(&git_root, &["status", "--porcelain=v1", "-z", "-uall"]) {
        let mut records = raw_status.split_terminator('\0');
        while let Some(record) = records.next() {
            let (Some(status_code), Some(file_path)) = (record.get(..2), record.get(3..)) else {
                continue;
            };
            // Porcelain -z puts the destination first and the source in its own record.
            let previous_path = if status_code.contains(['R', 'C']) {
                records.next().filter(|path| status_code.contains('R') && !path.is_empty())
            } else {
                None
            };
            let b0 = status_code.as_bytes()[0] as char;
            let b1 = status_code.as_bytes()[1] as char;
            let untracked = status_code == "??";
            let staged = b0 != ' ' && b0 != '?';
            let unstaged = b1 != ' ';
            entries.push(GitFileEntry {
                status: status_code.trim().to_string(),
                path: file_path.to_string(),
                previous_path: previous_path.map(str::to_owned),
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GitDiffScope {
    Uncommitted,
    Staged,
    Unstaged,
}

pub fn git_diff_for_path(
    target_path: &str,
    file_path: Option<String>,
    scope: GitDiffScope,
    base_branch: Option<String>,
    review_base_commit: Option<String>,
    previous_file_path: Option<String>,
) -> Result<String, String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let selected = file_path.as_deref().filter(|path| !path.is_empty());
    let read_diff = |options: &[&str]| {
        let previous = previous_file_path.as_deref().filter(|old| {
            scope != GitDiffScope::Unstaged && !old.is_empty() && selected.is_some_and(|path| path != *old)
        });
        let mut args = vec!["--literal-pathspecs", "diff"];
        if previous.is_some() {
            args.push("--find-renames");
        }
        args.extend_from_slice(options);
        args.push("--");
        args.extend(selected);
        args.extend(previous);
        run_git(&git_root, &args)
    };
    if let Some(base) = review_base_commit {
        if base.trim().is_empty() {
            return Err("Review base commit is required".to_string());
        }
        let reference = format!("{}^{{commit}}", base.trim());
        let resolved = run_git(
            &git_root,
            &["rev-parse", "--verify", "--end-of-options", &reference],
        )?;
        return read_diff(&[resolved.trim()]);
    }
    if let Some(base) = base_branch.filter(|b| !b.trim().is_empty()) {
        let range = format!("{}...HEAD", base.trim());
        return read_diff(&[&range]);
    }

    if scope == GitDiffScope::Staged {
        return read_diff(&["--staged"]);
    }

    let mut patch = if scope == GitDiffScope::Unstaged {
        read_diff(&[])?
    } else {
        // An unborn branch compares against an empty tree, using the repository's hash format.
        let base = run_git(&git_root, &["rev-parse", "--verify", "--quiet", "HEAD"])
            .or_else(|_| run_git(&git_root, &["hash-object", "-t", "tree", "--stdin"]))?;
        read_diff(&[base.trim()])?
    };
    let mut untracked = vec!["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--"];
    untracked.extend(selected);
    for path in run_git(&git_root, &untracked)?.split_terminator('\0') {
        // Nested repositories are listed as directories, not individual untracked files.
        if !path.is_empty() && !path.ends_with('/') {
            patch.push_str(&run_git_with_diff_status(
                &git_root,
                &["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", path],
                true,
            )?);
        }
    }
    Ok(patch)
}

pub fn git_stage_file(target_path: &str, file_path: Option<String>) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    match file_path.filter(|s| !s.is_empty()) {
        Some(fp) => {
            run_git(&git_root, &["--literal-pathspecs", "add", "--", &fp])?;
        }
        None => {
            run_git(&git_root, &["add", "-A"])?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMessageContext {
    pub unified_diff: String,
    pub files_changed: u64,
    pub lines_added: u64,
    pub lines_removed: u64,
    pub file_paths: Vec<String>,
    pub head_branch: Option<String>,
    pub base_branch: Option<String>,
}

pub fn message_generation_context(target_path: &str, mode: &str, include_unstaged: bool, base_branch: Option<String>) -> Result<GitMessageContext, String> {
    let root = find_git_root(target_path).ok_or("Not a git repository")?;
    let head_branch = run_git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok().map(|s| s.trim().to_string());
    let has_head = run_git(&root, &["rev-parse", "--verify", "HEAD^{commit}"]).is_ok();
    let mut ranges: Vec<Vec<String>> = Vec::new();
    let base = match mode {
        "commit" => {
            if include_unstaged && has_head { ranges.push(vec!["HEAD".into()]); }
            else {
                ranges.push(vec!["--cached".into()]);
                if include_unstaged { ranges.push(vec![]); }
            }
            None
        },
        "pull_request" => {
            if !has_head || head_branch.is_none() { return Err("Pull request generation requires a named branch with commits".into()); }
            let base = base_branch.filter(|s| !s.trim().is_empty()).or_else(|| default_branch(&root)).ok_or("Unable to determine pull request base branch")?;
            let merge = merge_base(&root, &base)?;
            ranges.push(vec![merge]);
            Some(base)
        },
        _ => return Err("Unsupported Git message context mode".into()),
    };
    let mut result = GitMessageContext { unified_diff: String::new(), files_changed: 0, lines_added: 0, lines_removed: 0, file_paths: Vec::new(), head_branch, base_branch: base };
    for range in ranges {
        let read = |format: &[&str]| {
            let mut args = vec!["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-textconv"];
            args.extend_from_slice(format);
            args.extend(range.iter().map(String::as_str)); args.push("--");
            run_git(&root, &args)
        };
        let patch = read(&[])?;
        if !patch.is_empty() { result.unified_diff.push_str(&patch); }
        let stats = read(&["--numstat", "-z"])?;
        let mut records = stats.split('\0');
        while let Some(record) = records.next() {
            if record.is_empty() { continue; }
            let mut fields = record.splitn(3, '\t');
            let added = fields.next().ok_or("Invalid Git numstat")?;
            let removed = fields.next().ok_or("Invalid Git numstat")?;
            let mut path = fields.next().ok_or("Invalid Git numstat path")?;
            if path.is_empty() {
                records.next().ok_or("Invalid Git rename source")?;
                path = records.next().filter(|s| !s.is_empty()).ok_or("Invalid Git rename destination")?;
            }
            result.lines_added += if added == "-" { 0 } else { added.parse::<u64>().map_err(|_| "Invalid Git addition count")? };
            result.lines_removed += if removed == "-" { 0 } else { removed.parse::<u64>().map_err(|_| "Invalid Git deletion count")? };
            if !result.file_paths.iter().any(|p| p == path) { result.file_paths.push(path.to_string()); }
        }
    }
    result.files_changed = result.file_paths.len() as u64;
    Ok(result)
}

pub fn git_unstage_file(
    target_path: &str,
    file_path: Option<String>,
    previous_file_path: Option<String>,
) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    match file_path.filter(|s| !s.is_empty()) {
        Some(fp) => {
            let mut args = vec!["--literal-pathspecs", "reset", "--", fp.as_str()];
            if let Some(previous) = previous_file_path.as_deref() {
                let pair = run_git(&git_root, &[
                    "--literal-pathspecs", "diff", "--cached", "--name-status", "-z",
                    "--find-renames", "--", previous, &fp,
                ])?;
                let mut fields = pair.split_terminator('\0');
                if !fields.next().is_some_and(|status| status.starts_with('R'))
                    || fields.next() != Some(previous)
                    || fields.next() != Some(fp.as_str())
                    || fields.next().is_some()
                {
                    return Err("暂存区的重命名已变化，请刷新后重试。".into());
                }
                args.push(previous);
            }
            run_git(&git_root, &args)?;
        }
        None if previous_file_path.is_some() => return Err("取消暂存重命名需要目标路径。".into()),
        None => {
            run_git(&git_root, &["reset", "--"])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod index_action_tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        cwd: String,
    }

    impl Fixture {
        fn new(committed: bool) -> Self {
            let root = std::env::temp_dir()
                .join(format!("codex-index-actions-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let cwd = root.to_string_lossy().to_string();
            run_git(&cwd, &["init", "--quiet"]).unwrap();
            run_git(&cwd, &["config", "core.autocrlf", "false"]).unwrap();
            run_git(&cwd, &["config", "core.hooksPath", &root.join("no-hooks").to_string_lossy()]).unwrap();
            let fixture = Self { root, cwd };
            if committed {
                fixture.write("tracked.txt", b"original\n");
                git_stage_file(&fixture.cwd, None).unwrap();
                run_git(
                    &fixture.cwd,
                    &[
                        "-c", "user.name=Fixture",
                        "-c", "user.email=fixture@example.invalid",
                        "-c", "commit.gpgsign=false",
                        "commit", "--quiet", "-m", "fixture",
                    ],
                ).unwrap();
            }
            fixture
        }

        fn write(&self, name: &str, bytes: &[u8]) {
            fs::write(self.root.join(name), bytes).unwrap();
        }

        fn read(&self, name: &str) -> Vec<u8> {
            fs::read(self.root.join(name)).unwrap()
        }

        fn git(&self, args: &[&str]) -> String {
            run_git(&self.cwd, args).unwrap()
        }

        fn index_empty(&self) -> bool {
            self.git(&["diff", "--cached", "--name-only"]).trim().is_empty()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let target = fs::canonicalize(&self.root).unwrap();
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert!(target.is_absolute() && target.starts_with(temp));
            assert!(target.file_name().unwrap().to_string_lossy()
                .starts_with("codex-index-actions-"));
            fs::remove_dir_all(target).unwrap();
        }
    }

    #[test]
    fn status_and_single_file_actions_preserve_literal_paths() {
        let fixture = Fixture::new(true);
        let target = " 中文 [1].txt";
        let neighbor = " 中文 1.txt";
        fixture.git(&["config", "core.quotePath", "true"]);
        fixture.write(target, b"target before\n");
        fixture.write(neighbor, b"neighbor before\n");
        fixture.git(&["add", "-A"]);
        fixture.git(&["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
            "-c", "commit.gpgsign=false", "commit", "-m", "literal paths"]);
        fixture.write(target, b"target after\n");
        fixture.write(neighbor, b"neighbor after\n");
        let status = git_status_for_path(&fixture.cwd);
        assert!(status.entries.iter().any(|entry| entry.path == target && entry.unstaged));
        let diff = git_diff_for_path(&fixture.cwd, Some(target.into()), GitDiffScope::Uncommitted, None, None, None).unwrap();
        assert!(diff.contains("+target after"));
        assert!(!diff.contains("neighbor after"));
        git_stage_file(&fixture.cwd, Some(target.into())).unwrap();
        assert_eq!(fixture.git(&["diff", "--cached", "--name-only", "-z"]), format!("{target}\0"));
        git_unstage_file(&fixture.cwd, Some(target.into()), None).unwrap();
        assert!(fixture.index_empty());
        git_discard_file(&fixture.cwd, target).unwrap();
        assert_eq!(fixture.read(target), b"target before\n");
        assert_eq!(fixture.read(neighbor), b"neighbor after\n");
    }

    #[test]
    fn status_reads_rename_destination_and_continues_to_next_entry() {
        let fixture = Fixture::new(true);
        fixture.git(&["config", "status.renames", "true"]);
        fixture.git(&["mv", "tracked.txt", "改名 后.txt"]);
        fixture.write("second.txt", b"untracked\n");
        let status = git_status_for_path(&fixture.cwd);
        assert_eq!(status.entries.len(), 2);
        assert!(status.entries.iter().any(|entry| entry.path == "改名 后.txt" && entry.staged && entry.status == "R"));
        assert!(status.entries.iter().any(|entry| entry.path == "second.txt" && entry.untracked));
    }

    #[test]
    fn selected_rename_diff_keeps_old_and_new_content() {
        let fixture = Fixture::new(true);
        fixture.git(&["config", "status.renames", "true"]);
        let destination = "改名 [1].txt";
        fixture.git(&["mv", "tracked.txt", destination]);
        fixture.write("改名 1.txt", b"unrelated content\n");
        git_stage_file(&fixture.cwd, Some("改名 1.txt".into())).unwrap();
        let entry = git_status_for_path(&fixture.cwd).entries.into_iter().find(|entry| entry.path == destination).unwrap();
        assert_eq!(entry.previous_path.as_deref(), Some("tracked.txt"));
        let staged = git_diff_for_path(&fixture.cwd, Some(entry.path.clone()), GitDiffScope::Staged, None, None, entry.previous_path.clone()).unwrap();
        assert!(staged.contains("rename from tracked.txt"), "{staged}");
        assert!(staged.contains("similarity index 100%"), "{staged}");
        assert!(!staged.contains("new file mode"));
        fixture.write(destination, b"original\nx\n");
        let unstaged = git_diff_for_path(&fixture.cwd, Some(entry.path.clone()), GitDiffScope::Unstaged, None, None, entry.previous_path.clone()).unwrap();
        assert!(unstaged.contains("+x\n"));
        assert!(!unstaged.contains("rename from"));
        let working = git_diff_for_path(&fixture.cwd, Some(entry.path), GitDiffScope::Uncommitted, None, None, entry.previous_path).unwrap();
        assert!(working.contains("rename from tracked.txt"), "{working}");
        assert!(working.contains("+x\n"));
        assert!(!working.contains("+original"));
        assert!(!working.contains("unrelated content"));
    }

    #[test]
    fn unstaged_diff_uses_index_and_includes_untracked_files_without_head() {
        let fixture = Fixture::new(false);
        fixture.write("tracked.txt", b"index content\n");
        fixture.write("staged-only.txt", b"staged-only content\n");
        git_stage_file(&fixture.cwd, None).unwrap();
        fixture.write("tracked.txt", b"later edit\n");
        let new_file = "新文件 [1].txt";
        fixture.write(new_file, b"untracked content\n");
        let all = git_diff_for_path(&fixture.cwd, None, GitDiffScope::Unstaged, None, None, None).unwrap();
        assert!(all.contains("-index content"));
        assert!(all.contains("+later edit"));
        assert!(all.contains("+untracked content"));
        assert!(!all.contains("staged-only"));
        let selected = git_diff_for_path(&fixture.cwd, Some(new_file.into()), GitDiffScope::Unstaged, None, None, None).unwrap();
        assert!(selected.contains("+untracked content"));
        assert!(!selected.contains("+later edit"));
        let staged = git_diff_for_path(&fixture.cwd, Some(new_file.into()), GitDiffScope::Staged, None, None, None).unwrap();
        assert!(staged.is_empty());
    }

    #[test]
    fn uncommitted_diff_includes_untracked_and_index_changes_with_or_without_head() {
        for committed in [true, false] {
            let fixture = Fixture::new(committed);
            fixture.write("tracked.txt", b"index content\n");
            fixture.write("staged-only.txt", b"staged-only content\n");
            git_stage_file(&fixture.cwd, None).unwrap();
            fixture.write("tracked.txt", b"index content\nworking addition\n");
            fixture.write("新文件 [1].txt", b"untracked content\n");
            fixture.write(".git/info/exclude", b"ignored.txt\n");
            fixture.write("ignored.txt", b"ignored content\n");
            let diff = git_diff_for_path(&fixture.cwd, None, GitDiffScope::Uncommitted, None, None, None).unwrap();
            for line in ["+index content", "+working addition", "+staged-only content", "+untracked content"] {
                assert!(diff.contains(line), "missing {line} with HEAD={committed}: {diff}");
            }
            assert!(!diff.contains("ignored content"));
            let selected = git_diff_for_path(&fixture.cwd, Some("新文件 [1].txt".into()), GitDiffScope::Uncommitted, None, None, None).unwrap();
            assert!(selected.contains("+untracked content"));
            assert!(!selected.contains("working addition"));
            let ignored = git_diff_for_path(&fixture.cwd, Some("ignored.txt".into()), GitDiffScope::Uncommitted, None, None, None).unwrap();
            assert!(ignored.is_empty());
        }
    }

    #[test]
    fn unstage_selected_rename_releases_both_paths_and_preserves_edits() {
        let fixture = Fixture::new(true);
        let destination = "改名 [1].txt";
        fixture.git(&["config", "status.renames", "true"]);
        fixture.git(&["mv", "tracked.txt", destination]);
        fixture.write(destination, b"original\nworking edit\n");
        fixture.write("unrelated.txt", b"keep staged\n");
        git_stage_file(&fixture.cwd, Some("unrelated.txt".into())).unwrap();
        let entry = git_status_for_path(&fixture.cwd).entries.into_iter().find(|entry| entry.path == destination).unwrap();
        let before = fixture.git(&["diff", "--cached", "--name-status", "-z"]);
        assert!(git_unstage_file(&fixture.cwd, Some(destination.into()), Some("unrelated.txt".into())).is_err());
        assert_eq!(fixture.git(&["diff", "--cached", "--name-status", "-z"]), before);
        let lock = fixture.root.join(".git/index.lock");
        fs::write(&lock, b"fixture lock").unwrap();
        let failed = git_unstage_file(&fixture.cwd, Some(entry.path.clone()), entry.previous_path.clone());
        fs::remove_file(lock).unwrap();
        assert!(failed.is_err());
        assert_eq!(fixture.git(&["diff", "--cached", "--name-status", "-z"]), before);
        git_unstage_file(&fixture.cwd, Some(entry.path), entry.previous_path).unwrap();
        assert_eq!(fixture.git(&["diff", "--cached", "--name-only", "-z"]), "unrelated.txt\0");
        assert_eq!(fixture.git(&["show", ":tracked.txt"]), "original\n");
        assert!(!fixture.root.join("tracked.txt").exists());
        assert_eq!(fixture.read(destination), b"original\nworking edit\n");
    }

    #[test]
    fn message_context_uses_actual_index_or_tracked_worktree_without_untracked_content() {
        let fixture = Fixture::new(true);
        fixture.write("tracked.txt", b"staged content\n");
        fixture.git(&["add", "tracked.txt"]);
        fixture.write("tracked.txt", b"working content\n");
        fixture.write("untracked.txt", b"must not enter generation context\n");
        let before = fixture.git(&["status", "--porcelain=v1"]);
        let staged = message_generation_context(&fixture.cwd, "commit", false, None).unwrap();
        assert!(staged.unified_diff.contains("+staged content"));
        assert!(!staged.unified_diff.contains("working content"));
        let working = message_generation_context(&fixture.cwd, "commit", true, None).unwrap();
        assert!(working.unified_diff.contains("+working content"));
        assert!(!working.unified_diff.contains("untracked"));
        assert_eq!(working.file_paths, vec!["tracked.txt"]);
        assert_eq!((working.files_changed, working.lines_added, working.lines_removed), (1, 1, 1));
        assert_eq!(before, fixture.git(&["status", "--porcelain=v1"]));
        assert_eq!(fixture.git(&["show", ":tracked.txt"]), "staged content\n");
    }

    #[test]
    fn message_context_unborn_keeps_staged_changes_and_pr_requires_real_branch_base() {
        let unborn = Fixture::new(false);
        unborn.write("first.txt", b"staged initial\n"); unborn.git(&["add", "first.txt"]);
        unborn.write("first.txt", b"working initial\n");
        let context = message_generation_context(&unborn.cwd, "commit", true, None).unwrap();
        assert!(context.unified_diff.contains("staged initial") && context.unified_diff.contains("working initial"));
        assert_eq!(context.files_changed, 1);
        assert!(message_generation_context(&unborn.cwd, "pull_request", true, None).is_err());
        let fixture = Fixture::new(true);
        fixture.git(&["branch", "base-fixture"]);
        fixture.git(&["checkout", "-b", "feature-fixture"]);
        fixture.write("tracked.txt", b"feature content\n");
        let context = message_generation_context(&fixture.cwd, "pull_request", true, Some("base-fixture".into())).unwrap();
        assert!(context.unified_diff.contains("feature content"));
        assert_eq!(context.head_branch.as_deref(), Some("feature-fixture"));
        assert_eq!(context.base_branch.as_deref(), Some("base-fixture"));
        assert!(message_generation_context(&fixture.cwd, "pull_request", true, Some("--bad-option".into())).is_err());
    }

    #[test]
    fn tracked_roundtrip_and_edits_after_staging_preserve_worktree_bytes() {
        let fixture = Fixture::new(true);
        fixture.write("tracked.txt", b"staged content\n");
        git_stage_file(&fixture.cwd, Some("tracked.txt".into())).unwrap();
        assert_eq!(fixture.git(&["show", ":tracked.txt"]), "staged content\n");
        fixture.write("tracked.txt", b"latest content\r\n\0end");
        assert!(fixture.git(&["diff", "--name-only"]).contains("tracked.txt"));
        git_unstage_file(&fixture.cwd, Some("tracked.txt".into()), None).unwrap();
        assert!(fixture.index_empty());
        assert_eq!(fixture.git(&["show", ":tracked.txt"]), "original\n");
        assert_eq!(fixture.read("tracked.txt"), b"latest content\r\n\0end");
    }

    #[test]
    fn new_file_roundtrip_restores_untracked_without_deleting_file() {
        let fixture = Fixture::new(true);
        fixture.write("new file.txt", b"new file\n");
        git_stage_file(&fixture.cwd, Some("new file.txt".into())).unwrap();
        assert!(fixture.git(&["diff", "--cached", "--name-only"]).contains("new file.txt"));
        git_unstage_file(&fixture.cwd, Some("new file.txt".into()), None).unwrap();
        assert!(fixture.index_empty());
        assert!(fixture.git(&["ls-files", "--others", "--exclude-standard"]).contains("new file.txt"));
        assert_eq!(fixture.read("new file.txt"), b"new file\n");
    }

    #[test]
    fn all_actions_preserve_modified_new_and_deleted_worktree_state() {
        let fixture = Fixture::new(true);
        fixture.write("new.txt", b"new\n");
        fs::remove_file(fixture.root.join("tracked.txt")).unwrap();
        git_stage_file(&fixture.cwd, None).unwrap();
        let cached = fixture.git(&["diff", "--cached", "--name-status"]);
        assert!(cached.contains("A\tnew.txt") && cached.contains("D\ttracked.txt"));
        git_unstage_file(&fixture.cwd, None, None).unwrap();
        assert!(fixture.index_empty());
        assert!(!fixture.root.join("tracked.txt").exists());
        assert_eq!(fixture.read("new.txt"), b"new\n");
    }

    #[test]
    fn omitted_reset_revision_supports_unborn_head_for_single_and_all() {
        let fixture = Fixture::new(false);
        fixture.write("first.txt", b"first\n");
        fixture.write("second.txt", b"second\n");
        git_stage_file(&fixture.cwd, None).unwrap();
        fixture.git(&["reset", "--", "first.txt"]);
        assert!(!fixture.git(&["ls-files"]).contains("first.txt"));
        git_unstage_file(&fixture.cwd, Some("second.txt".into()), None).unwrap();
        assert!(fixture.git(&["ls-files"]).trim().is_empty());
        git_stage_file(&fixture.cwd, None).unwrap();
        git_unstage_file(&fixture.cwd, None, None).unwrap();
        assert!(fixture.git(&["ls-files"]).trim().is_empty());
        assert_eq!(fixture.read("first.txt"), b"first\n");
        assert_eq!(fixture.read("second.txt"), b"second\n");
    }

    #[test]
    fn index_lock_errors_propagate_and_unlock_allows_retry() {
        let fixture = Fixture::new(true);
        fixture.write("tracked.txt", b"changed\n");
        git_stage_file(&fixture.cwd, None).unwrap();
        let index_before = fs::read(fixture.root.join(".git/index")).unwrap();
        let lock = fixture.root.join(".git/index.lock");
        fs::write(&lock, b"test lock").unwrap();
        for file in [Some("tracked.txt".to_string()), None] {
            let error = git_unstage_file(&fixture.cwd, file.clone(), None).unwrap_err();
            assert!(error.contains("index.lock"), "{error}");
            let error = git_stage_file(&fixture.cwd, file).unwrap_err();
            assert!(error.contains("index.lock"), "{error}");
        }
        assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index_before);
        assert_eq!(fixture.read("tracked.txt"), b"changed\n");
        fs::remove_file(lock).unwrap();
        git_unstage_file(&fixture.cwd, None, None).unwrap();
        assert!(fixture.index_empty());
        git_stage_file(&fixture.cwd, Some("tracked.txt".into())).unwrap();
        assert!(!fixture.index_empty());
        git_unstage_file(&fixture.cwd, Some("tracked.txt".into()), None).unwrap();
        assert!(fixture.index_empty());
    }
}

pub fn git_discard_file(target_path: &str, file_path: &str) -> Result<(), String> {
    let git_root = find_git_root(target_path).ok_or("Not a git repository")?;
    let is_untracked = run_git(&git_root, &["--literal-pathspecs", "ls-files", "--error-unmatch", "--", file_path]).is_err();
    if is_untracked {
        let full = Path::new(&git_root).join(file_path);
        if full.is_file() {
            fs::remove_file(full).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    run_git(&git_root, &["--literal-pathspecs", "checkout", "--", file_path])?;
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

pub(crate) const WORKTREE_ROOT_KEY: &str = "git-worktree-root";

pub(crate) fn validate_worktree_root(value: &str) -> Result<String, String> {
    let value = value.trim();
    if !value.is_empty() && (!Path::new(value).is_absolute() || value.contains('\0')) {
        return Err("工作树目录必须为空或绝对路径。".to_string());
    }
    Ok(value.to_string())
}

pub(crate) fn managed_worktree_roots(value: &serde_json::Value) -> Result<Vec<String>, String> {
    let configured = match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(value) => validate_worktree_root(value)?,
        _ => return Err("工作树目录配置不是字符串。".to_string()),
    };
    let default = normalize_fs_path(&codex_home_dir().join("worktrees").to_string_lossy());
    let mut roots = vec![if configured.is_empty() { default.clone() } else { normalize_fs_path(&configured) }];
    if !roots[0].eq_ignore_ascii_case(&default) { roots.push(default); }
    Ok(roots)
}

pub fn list_worktrees(target_path: Option<String>) -> Vec<GitWorktreeInfo> {
    list_worktrees_at_roots(target_path, &managed_worktree_roots(&serde_json::Value::Null).unwrap())
}

pub(crate) fn list_worktrees_at_roots(target_path: Option<String>, managed_roots: &[String]) -> Vec<GitWorktreeInfo> {
    let mut results = Vec::new();

    if let Some(ref target) = target_path {
        if let Some(git_root) = find_git_root(target) {
            if let Ok(raw) = run_git(&git_root, &["worktree", "list", "--porcelain"]) {
                let primary = raw.lines().find_map(|line| line.strip_prefix("worktree "))
                    .map(|path| worktree_path_key(Path::new(path)));
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
                    let owner = read_worktree_owner(&norm_path).ok().flatten();
                    let dirty = run_git(&norm_path, &["status", "--porcelain"])
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);
                    let is_codex = managed_roots.iter().any(|root| path_is_within(&norm_path, root));
                    let is_primary = primary.as_ref()
                        .map(|primary| *primary == worktree_path_key(Path::new(&norm_path)))
                        .unwrap_or(true);
                    out.push(GitWorktreeInfo {
                        path: norm_path,
                        git_dir: git_root.clone(),
                        is_primary,
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

    // Include both the configured and default roots without moving existing worktrees.
    for managed_root in managed_roots {
        let wt_root_path = Path::new(managed_root);
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
                        let owner = read_worktree_owner(&norm_dir).ok().flatten();
                        let dirty = run_git(&norm_dir, &["status", "--porcelain"])
                            .map(|s| !s.trim().is_empty())
                            .unwrap_or(false);
                        let branch = current_branch(&norm_dir);
                        let head = run_git(&norm_dir, &["rev-parse", "--short", "HEAD"])
                            .ok()
                            .map(|s| s.trim().to_string());
                        let is_primary = registered_worktree_paths(&norm_dir).ok()
                            .and_then(|paths| paths.into_iter().next())
                            .map(|primary| worktree_path_key(Path::new(&primary)) == worktree_path_key(&dir))
                            .unwrap_or(true);
                        results.push(GitWorktreeInfo {
                            path: norm_dir.clone(),
                            git_dir: norm_dir,
                            is_primary,
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

    }
    results
}

/// Resolves an existing Codex-managed worktree for a project move.
///
/// This function is intentionally read-only: it never creates, repairs, removes,
/// or checks out a worktree. Ownership is read from the official
/// `codex-thread.json` worktree metadata rather than git config.
pub(crate) fn resolve_thread_project_worktree_at_roots(
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
        let owner_matches = read_worktree_owner(&candidate_path).ok().flatten().as_deref() == Some(thread_id);
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
    path == root || path.starts_with(&format!("{}{}", root.trim_end_matches(['\\', '/']), std::path::MAIN_SEPARATOR))
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
    fn worktree_owner_metadata_is_private_across_linked_trees_and_all_consumers() {
        let fixture = Fixture::new();
        let custom = normalize_fs_path(&fixture.root.join("owner-custom").to_string_lossy());
        let created = create_codex_worktree(&fixture.repo, "branch", None, Some("owner-created".into()), &custom).unwrap();
        assert_eq!(read_worktree_owner(&created.path).unwrap().as_deref(), Some("owner-created"));
        assert!(run_git(&fixture.repo, &["config", "--get", "codex.ownerThreadId"]).is_err());
        set_worktree_owner_thread(&fixture.worktree, "owner-a").unwrap();
        set_worktree_owner_thread(&created.path, "owner-b").unwrap();
        assert_eq!(read_worktree_owner(&fixture.worktree).unwrap().as_deref(), Some("owner-a"));
        assert_eq!(read_worktree_owner(&created.path).unwrap().as_deref(), Some("owner-b"));
        assert!(read_worktree_owner(&fixture.repo).unwrap().is_none());
        let roots = vec![custom.clone()];
        let linked = list_worktrees_at_roots(Some(fixture.repo.clone()), &roots);
        assert!(linked.iter().any(|item| item.path == created.path && item.owner_thread_id.as_deref() == Some("owner-b")));
        let scanned = list_worktrees_at_roots(None, &roots);
        assert!(scanned.iter().any(|item| item.path == created.path && item.owner_thread_id.as_deref() == Some("owner-b")));
        assert_eq!(resolve_thread_project_worktree_at_roots("owner-b", &fixture.repo, &fixture.target(), &roots),
            Some((fixture.target(), normalize_fs_path(&Path::new(&created.path).join("nested").to_string_lossy()))));
        let path = owner_context(&created.path).unwrap().1.join("codex-thread.json");
        assert!(fs::read_to_string(path).unwrap().ends_with('\n'));
    }

    #[test]
    fn worktree_owner_metadata_distinguishes_missing_empty_corrupt_and_legacy_shared() {
        let fixture = Fixture::new();
        run_git(&fixture.repo, &["config", "codex.ownerThreadId", "legacy-shared"]).unwrap();
        assert!(read_worktree_owner(&fixture.worktree).unwrap().is_none());
        let path = owner_context(&fixture.worktree).unwrap().1.join("codex-thread.json");
        for raw in ["{", "null", r#"{"version":2,"ownerThreadId":"x"}"#, r#"{"version":1,"ownerThreadId":42}"#, r#"{"ownerThreadId":"x"}"#] {
            fs::write(&path, raw).unwrap(); assert!(read_worktree_owner(&fixture.worktree).is_err(), "{raw}");
        }
        set_worktree_owner_thread(&fixture.worktree, "").unwrap();
        assert_eq!(read_worktree_owner(&fixture.worktree).unwrap(), Some(String::new()));
        assert_eq!(run_git(&fixture.repo, &["config", "--get", "codex.ownerThreadId"]).unwrap().trim(), "legacy-shared");
        fs::remove_file(&path).unwrap(); fs::create_dir(&path).unwrap();
        assert!(read_worktree_owner(&fixture.worktree).is_err());
        assert!(set_worktree_owner_thread(&fixture.worktree, "must-not-succeed").is_err());
        assert!(path.is_dir(), "write failure must preserve existing path");
    }

    #[test]
    fn worktree_owner_metadata_rejects_redirected_git_marker_without_external_write() {
        let fixture = Fixture::new(); let other = Fixture::new();
        let marker = Path::new(&fixture.worktree).join(".git"); let before = fs::read(&marker).unwrap();
        fs::write(&marker, format!("gitdir: {}\n", Path::new(&other.repo).join(".git").to_string_lossy())).unwrap();
        assert!(set_worktree_owner_thread(&fixture.worktree, "must-not-leak").is_err());
        assert!(!Path::new(&other.repo).join(".git/codex-thread.json").exists());
        fs::write(marker, before).unwrap();
        assert!(read_worktree_owner(&fixture.worktree).unwrap().is_none());
    }

    #[test]
    fn worktree_root_validates_absolute_paths_and_keeps_default_discovery() {
        assert_eq!(validate_worktree_root("  ").unwrap(), "");
        assert!(validate_worktree_root("relative/path").is_err());
        assert!(managed_worktree_roots(&json!(42)).is_err());
        let fixture = Fixture::new();
        let custom = fixture.root.join("custom").to_string_lossy().to_string();
        let roots = managed_worktree_roots(&json!(format!("  {}  ", custom))).unwrap();
        assert_eq!(roots[0], normalize_fs_path(&custom));
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[1], managed_worktree_roots(&serde_json::Value::Null).unwrap()[0]);
        assert!(!Path::new(&custom).exists(), "reading settings must not create directories");
    }

    #[test]
    fn worktree_root_drives_creation_listing_and_owned_project_resolution() {
        let fixture = Fixture::new();
        let custom = normalize_fs_path(&fixture.root.join("custom").to_string_lossy());
        let created = create_codex_worktree(&fixture.repo, "branch", None, None, &custom).unwrap();
        assert!(path_is_within(&created.path, &custom));
        fixture.set_owner(&created.path, "custom-owner");
        let sibling = fixture.add_worktree("custom-sibling/segment/repo");
        let roots = vec![custom.clone(), normalize_fs_path(&fixture.root.join("managed").to_string_lossy())];
        let listed = list_worktrees_at_roots(Some(fixture.repo.clone()), &roots);
        assert!(listed.iter().any(|wt| wt.path == created.path && wt.is_codex_managed));
        assert!(listed.iter().any(|wt| wt.path == fixture.worktree && wt.is_codex_managed));
        assert!(listed.iter().any(|wt| wt.path == sibling && !wt.is_codex_managed));
        let scanned = list_worktrees_at_roots(None, &roots);
        assert!(scanned.iter().any(|wt| wt.path == created.path));
        assert_eq!(resolve_thread_project_worktree_at_roots("custom-owner", &fixture.repo, &fixture.target(), &roots),
            Some((fixture.target(), normalize_fs_path(&Path::new(&created.path).join("nested").to_string_lossy()))));
        assert!(create_codex_worktree(&fixture.repo, "branch", None, None, "relative").is_err());
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
    worktrees_root: &str,
) -> Result<GitWorktreeInfo, String> {
    let worktrees_root = validate_worktree_root(worktrees_root)?;
    if worktrees_root.is_empty() { return Err("缺少工作树根目录。".to_string()); }
    let worktrees_root = Path::new(&worktrees_root);
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
        set_worktree_owner_thread(&worktree_path_str, tid).map_err(|error|
            format!("工作树已创建并保留在 {worktree_path_str}，但所属会话元数据未保存：{error}"))?;
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
        is_primary: false,
        head,
        branch: Some(starting_ref),
        detached: true,
        is_codex_managed: true,
        owner_thread_id,
        has_uncommitted_changes: dirty,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemovalResult {
    pub worktree_path: String,
    pub snapshot_ref: Option<String>,
    pub warnings: Vec<String>,
}

// The same checkout can be requested from multiple windows. A rejected duplicate is
// an error, never a successful deletion of an operation that has not finished.
struct WorktreeOperation(PathBuf);

fn worktree_operations() -> &'static std::sync::Mutex<std::collections::HashSet<PathBuf>> {
    static OPERATIONS: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashSet<PathBuf>>,
    > = std::sync::OnceLock::new();
    OPERATIONS.get_or_init(Default::default)
}

impl WorktreeOperation {
    fn acquire(path: &Path) -> Result<Self, String> {
        let key = PathBuf::from(worktree_path_key(path));
        let mut operations = worktree_operations().lock().map_err(|e| e.to_string())?;
        if !operations.insert(key.clone()) {
            return Err("此工作树已有正在执行的删除或恢复操作。".into());
        }
        Ok(Self(key))
    }
}

impl Drop for WorktreeOperation {
    fn drop(&mut self) {
        if let Ok(mut operations) = worktree_operations().lock() {
            operations.remove(&self.0);
        }
    }
}

fn worktree_path_key(path: &Path) -> String {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let value = worktree_path_string(&canonical);
    #[cfg(target_os = "windows")]
    { value.replace('\\', "/").to_lowercase() }
    #[cfg(not(target_os = "windows"))]
    { value }
}

fn worktree_path_string(path: &Path) -> String {
    let value = path.to_string_lossy();
    // Git for Windows does not accept verbatim-prefix paths as worktree add
    // targets. Preserve UNC semantics when removing the canonical Windows prefix.
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
    }
}

fn worktree_checked_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("工作树操作需要不含父目录跳转的绝对路径。".into());
    }
    for ancestor in path.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).map_err(|e| e.to_string())?;
        let mut redirected = metadata.file_type().is_symlink();
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::MetadataExt;
            redirected |= metadata.file_attributes() & 0x400 != 0;
        }
        if redirected {
            return Err("工作树操作不接受符号链接或重解析目录路径。".into());
        }
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

fn registered_worktree_paths(repo: &str) -> Result<Vec<String>, String> {
    Ok(run_git(repo, &["worktree", "list", "--porcelain", "-z"])?
        .split('\0')
        .filter_map(|part| part.strip_prefix("worktree ").map(str::to_string))
        .collect())
}

fn validate_registered_worktree(repo: &str, target: &Path) -> Result<(), String> {
    let target_string = worktree_path_string(target);
    let top = run_git(&target_string, &["rev-parse", "--show-toplevel"])?;
    if worktree_path_key(&worktree_checked_path(top.trim())?) != worktree_path_key(target) {
        return Err("删除目标必须是完整的工作树根目录。".into());
    }
    let common_args = ["rev-parse", "--path-format=absolute", "--git-common-dir"];
    let repo_common = worktree_checked_path(run_git(repo, &common_args)?.trim())?;
    let target_common = worktree_checked_path(run_git(&target_string, &common_args)?.trim())?;
    if worktree_path_key(&repo_common) != worktree_path_key(&target_common) {
        return Err("工作树与指定仓库不匹配。".into());
    }
    let registered = registered_worktree_paths(repo)?;
    let primary = registered.first().ok_or("仓库未登记任何工作树。")?;
    if worktree_path_key(&worktree_checked_path(primary)?) == worktree_path_key(target) {
        return Err("不能删除仓库的主工作树。".into());
    }
    if !registered.iter().skip(1).any(|path| {
        worktree_checked_path(path).map(|path| worktree_path_key(&path) == worktree_path_key(target))
            .unwrap_or(false)
    }) {
        return Err("目标不是指定仓库登记的附加工作树。".into());
    }
    Ok(())
}

pub fn validate_worktree_removal(worktree_path: &str, git_dir: Option<String>) -> Result<String, String> {
    let target = worktree_checked_path(worktree_path)?;
    let repo = worktree_checked_path(git_dir.as_deref().filter(|s| !s.trim().is_empty())
        .ok_or("删除工作树需要明确指定所属仓库。")?)?;
    validate_registered_worktree(&worktree_path_string(&repo), &target)?;
    Ok(worktree_path_string(&target))
}

struct SnapshotIndex(PathBuf);

impl Drop for SnapshotIndex {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
        let _ = fs::remove_file(format!("{}.lock", self.0.to_string_lossy()));
    }
}

fn run_snapshot_git(cwd: &str, args: &[&str], index: &Path) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(cwd).args(args)
        .env("GIT_INDEX_FILE", index)
        .env("GIT_AUTHOR_NAME", "Codex")
        .env("GIT_AUTHOR_EMAIL", "codex@local.invalid")
        .env("GIT_COMMITTER_NAME", "Codex")
        .env("GIT_COMMITTER_EMAIL", "codex@local.invalid")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn snapshot_worktree(target: &Path) -> Result<String, String> {
    let cwd = worktree_path_string(target);
    let entries = run_git(&cwd, &["ls-files", "--stage", "--others", "--exclude-standard", "-z"])?;
    for entry in entries.split('\0').filter(|entry| !entry.is_empty()) {
        let candidate = if entry.starts_with("160000 ") {
            entry.split_once('\t').map(|(_, path)| path)
        } else if entry.ends_with('/') {
            Some(entry)
        } else {
            None
        };
        if candidate.is_some_and(|path| fs::symlink_metadata(target.join(path).join(".git")).is_ok()) {
            return Err("快照不能保留已初始化的子模块或嵌套 Git 仓库。".into());
        }
    }
    let git_dir = run_git(&cwd, &["rev-parse", "--absolute-git-dir"])?;
    let index = SnapshotIndex(Path::new(git_dir.trim())
        .join(format!("codex-snapshot-index-{}", uuid::Uuid::new_v4().simple())));
    let head = run_git(&cwd, &["rev-parse", "--verify", "HEAD"])?;
    run_snapshot_git(&cwd, &["read-tree", head.trim()], &index.0)?;
    run_snapshot_git(&cwd, &["add", "-A", "--", "."], &index.0)?;
    let tree = run_snapshot_git(&cwd, &["write-tree"], &index.0)?;
    let old_tree = run_git(&cwd, &["rev-parse", "HEAD^{tree}"])?;
    let commit = if tree == old_tree.trim() {
        head.trim().to_string()
    } else {
        run_snapshot_git(&cwd, &["-c", "commit.gpgsign=false", "commit-tree", &tree,
            "-p", head.trim(), "-m", "Codex worktree snapshot (settings-delete-targeted)"], &index.0)?
    };
    let snapshot_ref = format!("refs/codex/snapshots/{}", uuid::Uuid::new_v4().simple());
    run_git(&cwd, &["update-ref", &snapshot_ref, &commit, ""])?;
    Ok(snapshot_ref)
}

pub fn delete_worktree(worktree_path: &str, git_dir: Option<String>) -> Result<WorktreeRemovalResult, String> {
    let state = crate::local_environment_setup::SetupState::default();
    let operation = state.prepare_operation("worktree-delete", &uuid::Uuid::new_v4().to_string())?;
    delete_worktree_with_cleanup_context(worktree_path, git_dir, operation, None)
}

fn removal_identity(target: &Path) -> Result<(PathBuf, Vec<u8>, Option<std::time::SystemTime>), String> {
    let marker = target.join(".git");
    let metadata = fs::symlink_metadata(&marker).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("工作树身份标记已改变。".into()); }
    Ok((worktree_checked_path(run_git(&worktree_path_string(target), &["rev-parse", "--absolute-git-dir"])?.trim())?,
        fs::read(marker).map_err(|error| error.to_string())?, metadata.created().ok()))
}

pub fn delete_worktree_with_cleanup_context(
    worktree_path: &str,
    git_dir: Option<String>,
    operation: crate::local_environment_setup::SetupOperation,
    shell: Option<String>,
) -> Result<WorktreeRemovalResult, String> {
    delete_worktree_for_reason(worktree_path, git_dir, operation, shell, WorktreeRemovalReason::SettingsTargeted)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorktreeRemovalReason { SettingsTargeted, AutomaticCleanup }

pub fn delete_worktree_for_reason(
    worktree_path: &str,
    git_dir: Option<String>,
    operation: crate::local_environment_setup::SetupOperation,
    shell: Option<String>,
    reason: WorktreeRemovalReason,
) -> Result<WorktreeRemovalResult, String> {
    delete_worktree_with_guard(worktree_path, git_dir, operation, shell, reason, &|| Ok(()))
}

pub fn delete_worktree_with_guard(
    worktree_path: &str,
    git_dir: Option<String>,
    operation: crate::local_environment_setup::SetupOperation,
    shell: Option<String>,
    reason: WorktreeRemovalReason,
    guard: &dyn Fn() -> Result<(), String>,
) -> Result<WorktreeRemovalResult, String> {
    operation.check()?;
    let target = worktree_checked_path(worktree_path)?;
    let _operation = WorktreeOperation::acquire(&target)?;
    guard()?;
    let repo = worktree_checked_path(git_dir.as_deref().filter(|s| !s.trim().is_empty())
        .ok_or("删除工作树需要明确指定所属仓库。")?)?;
    let repo = worktree_path_string(&repo);
    validate_registered_worktree(&repo, &target)?;
    // A list discovered from a linked checkout may use that same checkout as
    // gitDir. Do not run removal or its readback with a cwd being deleted.
    let primary = registered_worktree_paths(&repo)?.into_iter().next()
        .ok_or("仓库未登记主工作树，无法确定稳定的删除上下文。")?;
    let repo = worktree_path_string(&worktree_checked_path(&primary)?);
    validate_registered_worktree(&repo, &target)?;
    let identity = removal_identity(&target)?;
    let mut warnings = Vec::new();
    // Official settings-delete-targeted proceeds after a snapshot failure. Surface
    // that exception explicitly rather than implying the deleted checkout is recoverable.
    let snapshot_ref = match snapshot_worktree(&target) {
        Ok(reference) => Some(reference),
        Err(error) if reason == WorktreeRemovalReason::AutomaticCleanup => {
            return Err(format!("自动清理快照失败，工作树保留在 {}：{error}", worktree_path_string(&target)));
        }
        Err(error) => {
            warnings.push(format!("恢复快照保存失败；本次删除没有可恢复快照：{error}"));
            None
        }
    };
    let retained_error = |error: String| format!("工作树保留在 {}（已保存快照：{}）：{error}",
        worktree_path_string(&target), snapshot_ref.as_deref().unwrap_or("无"));
    operation.check().map_err(&retained_error)?;
    guard().map_err(&retained_error)?;
    if let Some(warning) = crate::local_environment_setup::cleanup_worktree(&operation, &target, Path::new(&repo), shell).map_err(&retained_error)? {
        warnings.push(warning);
    }
    operation.check().map_err(&retained_error)?;
    validate_registered_worktree(&repo, &target).map_err(&retained_error)?;
    if removal_identity(&target).map_err(&retained_error)? != identity {
        return Err(retained_error("cleanup 后工作树身份已变化，未执行删除。".into()));
    }
    operation.check().map_err(&retained_error)?;
    guard().map_err(&retained_error)?;
    run_git(&repo, &["worktree", "remove", "--force", &worktree_path_string(&target)])
        .map_err(|error| format!("删除工作树失败（已保存快照：{}）：{error}",
            snapshot_ref.as_deref().unwrap_or("无")))?;
    let key = worktree_path_key(&target);
    if registered_worktree_paths(&repo)?.iter().any(|path| worktree_path_key(Path::new(path)) == key)
        || fs::symlink_metadata(&target).is_ok()
    {
        return Err("Git 删除后复核失败：工作树登记或目录仍然存在。".into());
    }
    Ok(WorktreeRemovalResult {
        worktree_path: worktree_path_string(&target),
        snapshot_ref,
        warnings,
    })
}

pub fn restore_worktree_snapshot(
    repo_cwd: &str,
    snapshot_ref: &str,
    target_path: &str,
) -> Result<WorktreeRemovalResult, String> {
    snapshot_ref.strip_prefix("refs/codex/snapshots/")
        .filter(|suffix| !suffix.is_empty() && suffix.bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'))
        .ok_or("无效的工作树快照引用。")?;
    let repo = worktree_checked_path(repo_cwd)?;
    let target = Path::new(target_path);
    if !target.is_absolute() || target.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("恢复工作树需要绝对目标路径。".into());
    }
    if fs::symlink_metadata(target).is_ok() {
        return Err("恢复目标必须不存在，以避免覆盖现有文件。".into());
    }
    let parent = worktree_checked_path(&target.parent().ok_or("缺少恢复目标父目录。")?.to_string_lossy())?;
    let target = parent.join(target.file_name().ok_or("缺少恢复目标目录名。")?);
    let _operation = WorktreeOperation::acquire(&target)?;
    let repo = worktree_path_string(&repo);
    let commit = run_git(&repo, &["show-ref", "--verify", "--hash", snapshot_ref])?;
    if run_git(&repo, &["cat-file", "-t", commit.trim()])?.trim() != "commit" {
        return Err("恢复引用必须直接指向当前仓库中的提交。".into());
    }
    run_git(&repo, &["worktree", "add", "--detach", &worktree_path_string(&target), commit.trim()])?;
    let actual = worktree_checked_path(&target.to_string_lossy())?;
    validate_registered_worktree(&repo, &actual)?;
    if run_git(&worktree_path_string(&target), &["rev-parse", "HEAD"])?.trim() != commit.trim() {
        return Err("恢复后提交校验失败。".into());
    }
    Ok(WorktreeRemovalResult {
        worktree_path: worktree_path_string(&actual),
        snapshot_ref: Some(snapshot_ref.to_string()),
        warnings: Vec::new(),
    })
}

#[cfg(test)]
mod worktree_removal_tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        repo: String,
        checkout: String,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("codex-worktree-removal-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let root = PathBuf::from(worktree_path_string(&fs::canonicalize(&root).unwrap()));
            let repo = root.join("repo");
            fs::create_dir_all(&repo).unwrap();
            let repo = repo.to_string_lossy().to_string();
            run_git(&repo, &["init", "--quiet"]).unwrap();
            run_git(&repo, &["config", "core.autocrlf", "false"]).unwrap();
            run_git(&repo, &["config", "user.name", "Fixture"]).unwrap();
            run_git(&repo, &["config", "user.email", "fixture@example.invalid"]).unwrap();
            run_git(&repo, &["config", "core.hooksPath", &root.join("no-hooks").to_string_lossy()]).unwrap();
            fs::write(Path::new(&repo).join("tracked.bin"), b"original\0\r\n").unwrap();
            fs::write(Path::new(&repo).join("deleted.txt"), b"delete me\n").unwrap();
            fs::write(Path::new(&repo).join(".gitignore"), b"ignored.txt\n").unwrap();
            run_git(&repo, &["add", "."]).unwrap();
            run_git(&repo, &["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "base"]).unwrap();
            let checkout = root.join("checkout").to_string_lossy().to_string();
            run_git(&repo, &["worktree", "add", "--quiet", "--detach", &checkout]).unwrap();
            Self { root, repo, checkout }
        }

        fn checked(&self, path: &str) {
            let canonical = fs::canonicalize(path).unwrap();
            let root = fs::canonicalize(&self.root).unwrap();
            assert!(canonical.starts_with(root) && canonical.is_absolute());
        }

        fn delete(&self) -> Result<WorktreeRemovalResult, String> {
            self.checked(&self.checkout);
            self.checked(&self.repo);
            delete_worktree(&self.checkout, Some(self.repo.clone()))
        }

        fn restore(&self, reference: &str, name: &str) -> WorktreeRemovalResult {
            let path = self.root.join(name);
            let root = fs::canonicalize(&self.root).unwrap();
            assert!(fs::canonicalize(path.parent().unwrap()).unwrap().starts_with(root));
            restore_worktree_snapshot(&self.repo, reference, &path.to_string_lossy()).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let root = fs::canonicalize(&self.root).unwrap();
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert!(root.is_absolute() && root.starts_with(temp));
            assert!(root.file_name().unwrap().to_string_lossy().starts_with("codex-worktree-removal-"));
            fs::remove_dir_all(root).unwrap();
        }
    }

    fn cleanup_config(fixture: &Fixture, script: &str) -> PathBuf {
        let directory = Path::new(&fixture.checkout).join(".codex/environments");
        fs::create_dir_all(&directory).unwrap();
        let config = directory.join("environment.toml");
        fs::write(&config, format!("version = 1\nname = 'Cleanup fixture'\n[setup]\nscript = ''\n[cleanup]\nscript = {}\n", serde_json::to_string(script).unwrap())).unwrap();
        run_git(&fixture.checkout, &["config", "extensions.worktreeConfig", "true"]).unwrap();
        run_git(&fixture.checkout, &["config", "--worktree", "codex.localEnvironmentConfigPath", &config.to_string_lossy()]).unwrap();
        config
    }

    #[test]
    fn cleanup_runs_after_snapshot_in_target_and_force_does_not_skip_it() {
        let fixture = Fixture::new();
        let marker = fixture.root.join("cleanup-observed.txt");
        let script = if cfg!(windows) {
            format!("$refs = @(git for-each-ref --format='%(refname)' refs/codex/snapshots); if ($refs.Count -lt 1) {{ exit 9 }}; [IO.File]::WriteAllText('{}', ((Get-Location).Path + [Environment]::NewLine + [string]$env:CODEX_SOURCE_TREE_PATH + [Environment]::NewLine + [string]$env:CODEX_WORKTREE_PATH)); [IO.File]::WriteAllText('tracked.bin', 'cleanup changed')", marker.to_string_lossy().replace('\'', "''"))
        } else {
            format!("test -n \"$(git for-each-ref refs/codex/snapshots)\"; printf '%s\\n%s\\n%s' \"$PWD\" \"$CODEX_SOURCE_TREE_PATH\" \"$CODEX_WORKTREE_PATH\" > '{}'; printf cleanup > tracked.bin", marker.to_string_lossy())
        };
        cleanup_config(&fixture, &script);
        let expected_checkout = worktree_path_string(&fs::canonicalize(&fixture.checkout).unwrap());
        let result = fixture.delete().unwrap();
        let observed = fs::read_to_string(marker).unwrap();
        assert!(!Path::new(observed.lines().next().unwrap()).exists(), "observed target must have been removed");
        assert_eq!(worktree_path_string(Path::new(observed.lines().next().unwrap())), expected_checkout);
        assert_eq!(observed.lines().nth(1).unwrap_or(""), std::env::var("CODEX_SOURCE_TREE_PATH").unwrap_or_default());
        assert_eq!(observed.lines().nth(2).unwrap_or(""), std::env::var("CODEX_WORKTREE_PATH").unwrap_or_default());
        let reference = result.snapshot_ref.unwrap();
        assert!(!run_git(&fixture.repo, &["show", &format!("{reference}:tracked.bin")]).unwrap().contains("cleanup"));
        assert!(result.warnings.is_empty()); assert!(!Path::new(&fixture.checkout).exists());
    }

    #[test]
    fn cleanup_failure_preserves_directory_snapshot_and_environment_delta() {
        let fixture = Fixture::new(); cleanup_config(&fixture, "exit 7");
        let git_dir = run_git(&fixture.checkout, &["rev-parse", "--absolute-git-dir"]).unwrap();
        let delta = Path::new(git_dir.trim()).join("codex-setup-environment.json");
        fs::write(&delta, b"{\"KEEP\":\"original\"}").unwrap();
        let error = fixture.delete().unwrap_err();
        assert!(error.contains("cleanup") && error.contains("refs/codex/snapshots/") && error.contains(&fixture.checkout), "{error}");
        assert!(Path::new(&fixture.checkout).is_dir());
        assert_eq!(fs::read(delta).unwrap(), b"{\"KEEP\":\"original\"}");
        assert!(Path::new(git_dir.trim()).join("codex-cleanup.log").is_file());
        assert!(!run_git(&fixture.repo, &["for-each-ref", "refs/codex/snapshots"]).unwrap().is_empty());
    }

    #[test]
    fn cleanup_cancel_and_concurrent_delete_retain_target() {
        let fixture = Fixture::new(); let ready = fixture.root.join("cleanup-ready");
        let script = if cfg!(windows) {
            format!("[IO.File]::WriteAllText('{}', 'ready'); Start-Sleep -Seconds 30", ready.to_string_lossy().replace('\'', "''"))
        } else { format!("touch '{}'; sleep 30", ready.to_string_lossy()) };
        cleanup_config(&fixture, &script);
        let state = crate::local_environment_setup::SetupState::default();
        let operation = state.prepare_operation("cleanup-test", "cancel").unwrap();
        std::thread::scope(|scope| {
            let task = scope.spawn(|| delete_worktree_with_cleanup_context(&fixture.checkout, Some(fixture.repo.clone()), operation, None));
            // The snapshot and Git checks precede shell startup. Synchronize with
            // the real script rather than imposing a startup performance limit.
            while !ready.exists() && !task.is_finished() { std::thread::sleep(std::time::Duration::from_millis(20)); }
            if !ready.exists() { panic!("cleanup ended before readiness: {:?}", task.join().unwrap()); }
            assert!(fixture.delete().is_err(), "concurrent delete must not enter cleanup");
            state.cancel_owner("cleanup-test");
            let error = task.join().unwrap().unwrap_err();
            assert!(error.contains("取消") && error.contains("refs/codex/snapshots/"), "{error}");
        });
        assert!(Path::new(&fixture.checkout).is_dir());
    }

    #[test]
    fn cleanup_identity_change_blocks_late_remove() {
        let fixture = Fixture::new();
        let script = if cfg!(windows) { "[IO.File]::AppendAllText((Join-Path (Get-Location).Path '.git'), [Environment]::NewLine)" } else { "printf '\\n' >> .git" };
        cleanup_config(&fixture, script);
        let error = fixture.delete().unwrap_err();
        assert!(error.contains("身份") && error.contains("refs/codex/snapshots/"), "{error}");
        assert!(Path::new(&fixture.checkout).is_dir());
    }

    #[test]
    fn cleanup_ignored_source_fallback_uses_target_cwd_and_platform_script() {
        let fixture = Fixture::new();
        let marker = fixture.root.join("source-fallback-marker");
        let script = if cfg!(windows) {
            format!("[IO.File]::WriteAllText('{}', (Get-Location).Path)", marker.to_string_lossy().replace('\'', "''"))
        } else { format!("printf '%s' \"$PWD\" > '{}'", marker.to_string_lossy()) };
        let target_config = cleanup_config(&fixture, "exit 99");
        let platform = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };
        let directory = Path::new(&fixture.repo).join(".codex/environments"); fs::create_dir_all(&directory).unwrap();
        let source_config = directory.join("environment.toml");
        fs::write(&source_config, format!("version = 1\nname = 'Source fallback'\n[setup]\nscript = ''\n[cleanup]\nscript = 'exit 99'\n[cleanup.{platform}]\nscript = {}\n", serde_json::to_string(&script).unwrap())).unwrap();
        fs::write(Path::new(&fixture.repo).join(".gitignore"), ".codex/\n").unwrap();
        fs::remove_file(target_config).unwrap();
        run_git(&fixture.checkout, &["config", "--worktree", "codex.localEnvironmentConfigPath", &source_config.to_string_lossy()]).unwrap();
        let expected_checkout = worktree_path_string(&fs::canonicalize(&fixture.checkout).unwrap());
        let result = fixture.delete().unwrap();
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
        assert_eq!(worktree_path_string(Path::new(&fs::read_to_string(marker).unwrap())), expected_checkout);
        assert!(source_config.is_file(), "cleanup must not remove source configuration");
    }

    #[test]
    fn cleanup_missing_none_empty_and_unavailable_are_distinct() {
        for scenario in ["missing-key", "none", "no-cleanup", "empty-script", "unavailable"] {
            let fixture = Fixture::new();
            let config = cleanup_config(&fixture, "");
            match scenario {
                "missing-key" => { run_git(&fixture.checkout, &["config", "--worktree", "--unset", "codex.localEnvironmentConfigPath"]).unwrap(); },
                "none" => { run_git(&fixture.checkout, &["config", "--worktree", "codex.localEnvironmentConfigPath", "__none__"]).unwrap(); },
                "no-cleanup" => fs::write(&config, "version = 1\nname = 'No cleanup'\n[setup]\nscript = ''\n").unwrap(),
                "unavailable" => fs::write(&config, "broken = [").unwrap(),
                _ => {},
            }
            let result = fixture.delete().unwrap();
            assert_eq!(result.warnings.len(), usize::from(scenario == "unavailable"), "{scenario}");
            if scenario == "unavailable" { assert!(result.warnings[0].contains("cleanup-config-unavailable")); }
        }
    }

    #[test]
    fn snapshot_preserves_changed_deleted_untracked_and_unpushed_commit_without_touching_index() {
        let fixture = Fixture::new();
        let checkout = Path::new(&fixture.checkout);
        fs::write(checkout.join("committed.txt"), b"unpushed\n").unwrap();
        run_git(&fixture.checkout, &["add", "."]).unwrap();
        run_git(&fixture.checkout, &["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "unpushed"]).unwrap();
        let head = run_git(&fixture.checkout, &["rev-parse", "HEAD"]).unwrap();
        fs::write(checkout.join("tracked.bin"), b"staged\n").unwrap();
        run_git(&fixture.checkout, &["add", "tracked.bin"]).unwrap();
        fs::write(checkout.join("tracked.bin"), b"latest\0\r\n").unwrap();
        fs::remove_file(checkout.join("deleted.txt")).unwrap();
        fs::write(checkout.join("新文件.txt"), "中文🚀\r\n").unwrap();
        fs::write(checkout.join("ignored.txt"), b"not preserved").unwrap();
        let index_path = run_git(&fixture.checkout, &["rev-parse", "--path-format=absolute", "--git-path", "index"]).unwrap();
        let before = fs::read(index_path.trim()).unwrap();
        fixture.checked(&fixture.checkout);
        let preview = snapshot_worktree(checkout).unwrap();
        assert_eq!(fs::read(index_path.trim()).unwrap(), before);
        let main_index = fs::read(Path::new(&fixture.repo).join(".git/index")).unwrap();
        let result = fixture.delete().unwrap();
        assert!(result.warnings.is_empty());
        assert!(!checkout.exists());
        assert_eq!(fs::read(Path::new(&fixture.repo).join(".git/index")).unwrap(), main_index);
        let restored = fixture.restore(result.snapshot_ref.as_ref().unwrap(), "restored");
        let restored = Path::new(&restored.worktree_path);
        assert_eq!(fs::read(restored.join("tracked.bin")).unwrap(), b"latest\0\r\n");
        assert_eq!(fs::read(restored.join("新文件.txt")).unwrap(), "中文🚀\r\n".as_bytes());
        assert_eq!(fs::read(restored.join("committed.txt")).unwrap(), b"unpushed\n");
        assert!(!restored.join("deleted.txt").exists());
        assert!(!restored.join("ignored.txt").exists());
        assert_eq!(run_git(&fixture.repo, &["rev-parse", &format!("{preview}^")]).unwrap().trim(), head.trim());
        assert!(!registered_worktree_paths(&fixture.repo).unwrap().iter()
            .any(|path| worktree_path_key(Path::new(path)) == worktree_path_key(checkout)));
    }

    #[test]
    fn clean_checkout_snapshot_keeps_original_head_and_survives_repository_reopen() {
        let fixture = Fixture::new();
        let head = run_git(&fixture.checkout, &["rev-parse", "HEAD"]).unwrap();
        let result = fixture.delete().unwrap();
        let reference = result.snapshot_ref.unwrap();
        assert_eq!(run_git(&fixture.repo, &["rev-parse", &reference]).unwrap(), head);
        let restored = fixture.restore(&reference, "restored");
        assert_eq!(run_git(&restored.worktree_path, &["rev-parse", "HEAD"]).unwrap(), head);
        assert_eq!(run_git(&restored.worktree_path, &["status", "--porcelain"]).unwrap(), "");
    }

    #[test]
    fn deleting_from_target_checkout_uses_surviving_repository_for_readback() {
        let fixture = Fixture::new();
        fs::write(Path::new(&fixture.checkout).join("self-origin.txt"), b"recover me\n").unwrap();
        fixture.checked(&fixture.checkout);
        fixture.checked(&fixture.repo);
        let result = delete_worktree(&fixture.checkout, Some(fixture.checkout.clone())).unwrap();
        assert!(result.warnings.is_empty());
        assert!(!Path::new(&fixture.checkout).exists());
        let restored = fixture.restore(result.snapshot_ref.as_ref().unwrap(), "restored-self-origin");
        assert_eq!(fs::read(Path::new(&restored.worktree_path).join("self-origin.txt")).unwrap(), b"recover me\n");
    }

    #[test]
    fn primary_identity_comes_from_git_even_when_listing_from_linked_checkout_or_discovery() {
        let fixture = Fixture::new();
        let listed = list_worktrees_at_roots(Some(fixture.checkout.clone()), &[]);
        assert!(listed.iter().find(|entry| worktree_path_key(Path::new(&entry.path))
            == worktree_path_key(Path::new(&fixture.repo))).unwrap().is_primary);
        assert!(!listed.iter().find(|entry| worktree_path_key(Path::new(&entry.path))
            == worktree_path_key(Path::new(&fixture.checkout))).unwrap().is_primary);
        let managed = fixture.root.join("managed");
        let primary = managed.join("group/primary");
        let linked = managed.join("group/linked");
        fs::create_dir_all(&primary).unwrap();
        run_git(&primary.to_string_lossy(), &["init", "--quiet"]).unwrap();
        run_git(&fixture.repo, &["worktree", "add", "--quiet", "--detach", &linked.to_string_lossy()]).unwrap();
        let scanned = list_worktrees_at_roots(None, &[managed.to_string_lossy().to_string()]);
        assert!(scanned.iter().find(|entry| worktree_path_key(Path::new(&entry.path))
            == worktree_path_key(&primary)).unwrap().is_primary);
        assert!(!scanned.iter().find(|entry| worktree_path_key(Path::new(&entry.path))
            == worktree_path_key(&linked)).unwrap().is_primary);
    }

    #[test]
    fn rejects_primary_wrong_repository_relative_and_subdirectory_without_mutation() {
        let fixture = Fixture::new();
        let other = Fixture::new();
        fixture.checked(&fixture.repo);
        fixture.checked(&fixture.checkout);
        assert!(delete_worktree(&fixture.repo, Some(fixture.repo.clone())).is_err());
        assert!(delete_worktree(&fixture.checkout, Some(other.repo.clone())).is_err());
        assert!(delete_worktree("checkout", Some(fixture.repo.clone())).is_err());
        assert!(delete_worktree(&fixture.checkout, None).is_err());
        let subdir = Path::new(&fixture.checkout).join("subdir");
        fs::create_dir_all(&subdir).unwrap();
        assert!(delete_worktree(&subdir.to_string_lossy(), Some(fixture.repo.clone())).is_err());
        assert_eq!(fs::read(Path::new(&fixture.repo).join("tracked.bin")).unwrap(), b"original\0\r\n");
        assert!(Path::new(&fixture.checkout).exists());
        assert!(run_git(&fixture.repo, &["for-each-ref", "refs/codex/snapshots"]).unwrap().is_empty());
    }

    #[test]
    fn locked_worktree_git_remove_failure_keeps_files_and_snapshot() {
        let fixture = Fixture::new();
        run_git(&fixture.repo, &["worktree", "lock", &fixture.checkout]).unwrap();
        let error = fixture.delete().unwrap_err();
        assert!(error.contains("删除工作树失败"), "{error}");
        assert!(Path::new(&fixture.checkout).join("tracked.bin").exists());
        assert!(!run_git(&fixture.repo, &["for-each-ref", "refs/codex/snapshots"]).unwrap().is_empty());
        run_git(&fixture.repo, &["worktree", "unlock", &fixture.checkout]).unwrap();
        assert!(fixture.delete().unwrap().snapshot_ref.is_some());
    }

    #[test]
    fn nested_repository_snapshot_failure_is_an_explicit_targeted_delete_warning() {
        let fixture = Fixture::new();
        let nested = Path::new(&fixture.checkout).join("nested");
        fs::create_dir_all(&nested).unwrap();
        run_git(&nested.to_string_lossy(), &["init", "--quiet"]).unwrap();
        assert!(snapshot_worktree(Path::new(&fixture.checkout)).unwrap_err().contains("嵌套"));
        let result = fixture.delete().unwrap();
        assert!(result.snapshot_ref.is_none());
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("没有可恢复快照"));
        assert!(!Path::new(&fixture.checkout).exists());
    }

    #[test]
    fn automatic_cleanup_requires_snapshot_before_script_or_removal() {
        let fixture = Fixture::new();
        let marker = fixture.root.join("automatic-cleanup-ran");
        let script = if cfg!(windows) {
            format!("[IO.File]::WriteAllText('{}', 'cleanup')", marker.to_string_lossy().replace('\'', "''"))
        } else { format!("printf cleanup > '{}'", marker.to_string_lossy()) };
        cleanup_config(&fixture, &script);
        let nested = Path::new(&fixture.checkout).join("nested");
        fs::create_dir_all(&nested).unwrap();
        run_git(&nested.to_string_lossy(), &["init", "--quiet"]).unwrap();
        let state = crate::local_environment_setup::SetupState::default();
        let operation = state.prepare_operation("automatic-cleanup-test", "snapshot-failure").unwrap();
        let error = delete_worktree_for_reason(&fixture.checkout, Some(fixture.repo.clone()), operation, None, WorktreeRemovalReason::AutomaticCleanup).unwrap_err();
        assert!(error.contains("自动清理快照失败") && error.contains(&fixture.checkout), "{error}");
        assert!(Path::new(&fixture.checkout).is_dir());
        assert!(!marker.exists(), "cleanup must not run without a recovery snapshot");
        assert!(registered_worktree_paths(&fixture.repo).unwrap().iter().any(|path| worktree_path_key(Path::new(path)) == worktree_path_key(Path::new(&fixture.checkout))));
        // The same snapshot failure remains an explicit exception for manual settings deletion.
        let result = fixture.delete().unwrap();
        assert!(result.snapshot_ref.is_none());
        assert!(marker.exists());
        assert!(!Path::new(&fixture.checkout).exists());
    }

    #[test]
    fn initialized_submodule_snapshot_failure_and_locked_removal_do_not_claim_recoverability() {
        let fixture = Fixture::new();
        let source = Fixture::new();
        run_git(&fixture.checkout, &["-c", "protocol.file.allow=always", "submodule", "add", "--quiet",
            &source.repo, "module"]).unwrap();
        assert!(snapshot_worktree(Path::new(&fixture.checkout)).unwrap_err().contains("子模块"));
        run_git(&fixture.repo, &["worktree", "lock", &fixture.checkout]).unwrap();
        let error = fixture.delete().unwrap_err();
        assert!(error.contains("删除工作树失败") && error.contains("已保存快照：无"), "{error}");
        assert!(Path::new(&fixture.checkout).join("module/tracked.bin").exists());
        assert!(Path::new(&source.repo).join("tracked.bin").exists());
        run_git(&fixture.repo, &["worktree", "unlock", &fixture.checkout]).unwrap();
        let result = fixture.delete().unwrap();
        assert!(result.snapshot_ref.is_none());
        assert_eq!(result.warnings.len(), 1);
        assert!(!Path::new(&fixture.checkout).exists());
        assert!(Path::new(&source.repo).join("tracked.bin").exists());
    }

    #[test]
    fn restore_rejects_arbitrary_ref_wrong_repo_existing_and_relative_targets() {
        let fixture = Fixture::new();
        let other = Fixture::new();
        let result = fixture.delete().unwrap();
        let reference = result.snapshot_ref.unwrap();
        let target = fixture.root.join("restore");
        assert!(restore_worktree_snapshot(&fixture.repo, "HEAD", &target.to_string_lossy()).is_err());
        assert!(restore_worktree_snapshot(&fixture.repo, "refs/codex/snapshots/../heads/main",
            &target.to_string_lossy()).is_err());
        assert!(restore_worktree_snapshot(&other.repo, &reference, &target.to_string_lossy()).is_err());
        assert!(restore_worktree_snapshot(&fixture.repo, &reference, &fixture.repo).is_err());
        assert!(restore_worktree_snapshot(&fixture.repo, &reference, "relative").is_err());
        let tree = run_git(&fixture.repo, &["rev-parse", "HEAD^{tree}"]).unwrap();
        run_git(&fixture.repo, &["update-ref", "refs/codex/snapshots/not-a-commit", tree.trim()]).unwrap();
        assert!(restore_worktree_snapshot(&fixture.repo, "refs/codex/snapshots/not-a-commit",
            &target.to_string_lossy()).is_err());
        assert!(!target.exists());
    }

    #[test]
    fn same_canonical_target_is_single_flight_and_guard_releases_after_error() {
        let fixture = Fixture::new();
        let target = worktree_checked_path(&fixture.checkout).unwrap();
        let operation = WorktreeOperation::acquire(&target).unwrap();
        let error = fixture.delete().unwrap_err();
        assert!(error.contains("正在执行"), "{error}");
        assert!(Path::new(&fixture.checkout).exists());
        assert!(WorktreeOperation::acquire(&worktree_checked_path(&fixture.repo).unwrap()).is_ok());
        drop(operation);
        assert!(fixture.delete().is_ok());
        assert!(delete_worktree(&fixture.checkout, Some(fixture.repo.clone())).is_err());
    }

    #[test]
    fn redirected_checkout_path_is_rejected() {
        let fixture = Fixture::new();
        let alias = fixture.root.join("alias");
        #[cfg(target_os = "windows")]
        {
            let mut command = Command::new("cmd");
            command.args(["/C", "mklink", "/J"]).arg(&alias).arg(&fixture.checkout)
                .creation_flags(CREATE_NO_WINDOW);
            assert!(command.output().unwrap().status.success());
        }
        #[cfg(not(target_os = "windows"))]
        std::os::unix::fs::symlink(&fixture.checkout, &alias).unwrap();
        assert!(delete_worktree(&alias.to_string_lossy(), Some(fixture.repo.clone())).is_err());
        let redirected_restore = alias.join("restore");
        let reference = snapshot_worktree(Path::new(&fixture.checkout)).unwrap();
        assert!(restore_worktree_snapshot(&fixture.repo, &reference, &redirected_restore.to_string_lossy()).is_err());
        assert!(Path::new(&fixture.checkout).join("tracked.bin").exists());
        #[cfg(target_os = "windows")]
        fs::remove_dir(alias).unwrap();
        #[cfg(not(target_os = "windows"))]
        fs::remove_file(alias).unwrap();
    }
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeOwnerMetadata { version: u64, owner_thread_id: String }

fn owner_context(cwd: &str) -> Result<(PathBuf, PathBuf, Vec<u8>), String> {
    let cwd = worktree_checked_path(cwd)?;
    let root = worktree_checked_path(run_git(&worktree_path_string(&cwd), &["rev-parse", "--show-toplevel"])?.trim())?;
    if !cwd.starts_with(&root) { return Err("所属会话目标不属于当前工作树。".into()); }
    let marker = root.join(".git");
    worktree_checked_path(&marker.to_string_lossy())?;
    let marker_content = if marker.is_file() { fs::read(&marker).map_err(|e| e.to_string())? } else { Vec::new() };
    if !registered_worktree_paths(&worktree_path_string(&root))?.iter().any(|path| worktree_path_key(Path::new(path)) == worktree_path_key(&root)) {
        return Err("所属会话目标不是其 Git 仓库登记的工作树。".into());
    }
    let git_dir = worktree_checked_path(run_git(&worktree_path_string(&root), &["rev-parse", "--absolute-git-dir"])?.trim())?;
    let path = PathBuf::from(normalize_fs_path(run_git(&worktree_path_string(&root), &["rev-parse", "--path-format=absolute", "--git-path", "codex-thread.json"])?.trim()));
    if worktree_path_key(&path) != worktree_path_key(&git_dir.join("codex-thread.json")) {
        return Err("所属会话元数据不在工作树私有 Git 路径。".into());
    }
    Ok((root, git_dir, marker_content))
}
fn owner_file_is_regular(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let mut redirected = metadata.file_type().is_symlink();
            #[cfg(windows)] { use std::os::windows::fs::MetadataExt; redirected |= metadata.file_attributes() & 0x400 != 0; }
            if redirected || !metadata.is_file() { return Err("所属会话元数据必须是私有普通文件，不能是重定向路径。".into()); }
            Ok(())
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
pub fn read_worktree_owner(cwd: &str) -> Result<Option<String>, String> {
    let context = owner_context(cwd)?;
    let path = context.1.join("codex-thread.json"); owner_file_is_regular(&path)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法读取所属会话元数据：{error}")),
    };
    let value: WorktreeOwnerMetadata = serde_json::from_str(&raw).map_err(|error| format!("所属会话元数据结构无效：{error}"))?;
    if value.version != 1 { return Err("所属会话元数据版本必须为 1。".into()); }
    if owner_context(cwd)? != context { return Err("读取所属会话期间工作树身份已变化。".into()); }
    Ok(Some(value.owner_thread_id))
}
pub fn set_worktree_owner_thread(worktree_path: &str, thread_id: &str) -> Result<(), String> {
    static WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITE.lock().map_err(|error| error.to_string())?;
    let context = owner_context(worktree_path)?;
    if worktree_path_key(&worktree_checked_path(worktree_path)?) != worktree_path_key(&context.0) {
        return Err("写入所属会话需要完整工作树根目录。".into());
    }
    let path = context.1.join("codex-thread.json"); owner_file_is_regular(&path)?;
    let raw = format!("{}\n", serde_json::to_string_pretty(&WorktreeOwnerMetadata { version: 1, owner_thread_id: thread_id.into() }).map_err(|e| e.to_string())?);
    let temporary = context.1.join(format!("codex-thread-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(raw.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?; drop(file);
        if owner_context(worktree_path)? != context { return Err("写入所属会话期间工作树身份已变化。".into()); }
        owner_file_is_regular(&path)?;
        fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        if read_worktree_owner(worktree_path)?.as_deref() != Some(thread_id) { return Err("所属会话元数据已写入，但读回不一致。".into()); }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
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


