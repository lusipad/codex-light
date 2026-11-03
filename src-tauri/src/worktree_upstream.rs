//! Exact upstream refresh before worktree creation; never creates a worktree.
use crate::local_environment_setup::SetupOperation;
use crate::worktree_preferences::UpstreamRefreshMode;
use std::collections::HashSet;
use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct RefreshRequest<'a> {
    pub cwd: &'a str,
    pub starting_mode: &'a str,
    pub branch_name: Option<&'a str>,
    pub remote_ref: Option<&'a str>,
    pub resolved_starting_commit: Option<&'a str>,
    pub mode: UpstreamRefreshMode,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RefreshOutcome {
    Skipped,
    Refreshed { destination_ref: String },
    Warning { message: String },
}
pub type LogSink = Arc<dyn Fn(&str, &str) + Send + Sync>;

struct GitOutput {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}
enum RunOutcome {
    Finished(GitOutput),
    Skipped,
}

fn command(cwd: &str) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
    ] {
        command.env_remove(name);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00000004);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

fn read_pipe(
    mut pipe: impl Read,
    progress: Option<(LogSink, Arc<std::sync::Mutex<Instant>>)>,
) -> Result<String, String> {
    let mut retained = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut line = Vec::new();
    loop {
        let count = match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.to_string()),
        };
        let room = (256 * 1024usize).saturating_sub(retained.len());
        retained.extend_from_slice(&chunk[..count.min(room)]);
        if let Some((sink, last_progress)) = &progress {
            for byte in &chunk[..count] {
                if matches!(byte, b'\r' | b'\n') {
                    let text = String::from_utf8_lossy(&line);
                    if [
                        "remote:",
                        "Receiving objects:",
                        "Resolving deltas:",
                        "Unpacking objects:",
                        "Updating files:",
                    ]
                    .iter()
                    .any(|prefix| text.starts_with(prefix))
                    {
                        sink("stderr", &format!("{text}\n"));
                        *last_progress.lock().unwrap() = Instant::now();
                    }
                    line.clear();
                } else if line.len() < 1024 {
                    line.push(*byte);
                }
            }
        }
    }
    Ok(String::from_utf8_lossy(&retained).to_string())
}

fn run(
    mut command: Command,
    operation: &SetupOperation,
    skip: Option<&AtomicBool>,
    log: Option<&LogSink>,
) -> Result<RunOutcome, String> {
    operation.check()?;
    if skip.is_some_and(|skip| skip.load(Ordering::SeqCst)) {
        return Ok(RunOutcome::Skipped);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Git 上游刷新：{error}"))?;
    #[cfg(windows)]
    let job = match crate::recommended_skills::git_job::Job::attach_and_resume(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let (out_tx, out_rx) = mpsc::channel();
    let (err_tx, err_rx) = mpsc::channel();
    let last_progress = Arc::new(std::sync::Mutex::new(Instant::now()));
    let progress = log.map(|sink| (sink.clone(), last_progress.clone()));
    let stdout = child.stdout.take().ok_or("Git 标准输出管道不可用。")?;
    let stderr = child.stderr.take().ok_or("Git 错误输出管道不可用。")?;
    std::thread::spawn(move || {
        let _ = out_tx.send(read_pipe(stdout, None));
    });
    std::thread::spawn(move || {
        let _ = err_tx.send(read_pipe(stderr, progress));
    });
    let started = Instant::now();
    let mut notice_at = Instant::now();
    let mut skipped = false;
    let result = loop {
        if let Err(error) = operation.check() {
            break Err(error);
        }
        if skip.is_some_and(|skip| skip.load(Ordering::SeqCst)) {
            skipped = true;
            break Ok(None);
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(Some(status)),
            Ok(None) => {}
            Err(error) => break Err(error.to_string()),
        }
        if notice_at.elapsed() >= Duration::from_secs(15) {
            if last_progress.lock().unwrap().elapsed() >= Duration::from_secs(15) {
                if let Some(log) = log {
                    log(
                        "info",
                        &format!(
                            "[info] Refreshing upstream before creating worktree ({}s elapsed)\n",
                            started.elapsed().as_secs()
                        ),
                    );
                }
            }
            notice_at = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    // Confirm all helpers are gone before joining readers, including on natural exit.
    #[cfg(windows)]
    let tree_result = job.stop();
    #[cfg(unix)]
    let tree_result = {
        let output = Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .output()
            .map_err(|error| error.to_string());
        output.and_then(|output| {
            if output.status.success()
                || String::from_utf8_lossy(&output.stderr).contains("No such process")
            {
                Ok(())
            } else {
                Err("无法停止 Git 刷新进程组。".into())
            }
        })
    };
    if result.as_ref().is_err() || skipped {
        let _ = child.kill();
        let _ = child.wait();
    }
    let stdout = out_rx
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Git 刷新输出管道未释放。".to_string())??;
    let stderr = err_rx
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Git 刷新错误管道未释放。".to_string())??;
    tree_result?;
    let status = result?;
    operation.check()?;
    if skipped || skip.is_some_and(|skip| skip.load(Ordering::SeqCst)) {
        return Ok(RunOutcome::Skipped);
    }
    Ok(RunOutcome::Finished(GitOutput {
        status: status.ok_or("Git 缺少退出状态。")?,
        stdout,
        stderr,
    }))
}

fn read(cwd: &str, args: &[&str], operation: &SetupOperation) -> Result<GitOutput, String> {
    let mut command = command(cwd);
    command.args(args);
    match run(command, operation, None, None)? {
        RunOutcome::Finished(output) => Ok(output),
        RunOutcome::Skipped => Err("读取 Git 状态意外取消。".into()),
    }
}
fn value(cwd: &str, args: &[&str], operation: &SetupOperation) -> Result<Option<String>, String> {
    let output = read(cwd, args, operation)?;
    if output.status.success() {
        Ok(Some(output.stdout.trim().to_string()))
    } else if output.status.code() == Some(1) {
        Ok(None)
    } else {
        Err(format!("读取 Git 上游状态失败：{}", output.stderr.trim()))
    }
}

fn capture<'a>(pattern: &str, value: &'a str) -> Option<&'a str> {
    match pattern.split_once('*') {
        Some((prefix, suffix)) if !suffix.contains('*') => {
            value.strip_prefix(prefix)?.strip_suffix(suffix)
        }
        None if pattern == value => Some(""),
        _ => None,
    }
}
fn source_for_refspec(destination: &str, refspecs: &[&str]) -> Option<String> {
    let mut sources = HashSet::new();
    for refspec in refspecs {
        let positive = refspec.strip_prefix('+').unwrap_or(refspec);
        if let Some((source, target)) = positive.split_once(':') {
            if let Some(captured) = capture(target, destination) {
                sources.insert(source.replacen('*', captured, 1));
            }
        }
    }
    if sources.len() != 1 {
        return None;
    }
    let source = sources.into_iter().next()?;
    if refspecs
        .iter()
        .filter_map(|refspec| refspec.strip_prefix('^'))
        .any(|negative| capture(negative, &source).is_some())
    {
        None
    } else {
        Some(source)
    }
}

fn commit(
    cwd: &str,
    reference: &str,
    operation: &SetupOperation,
) -> Result<Option<String>, String> {
    let output = read(
        cwd,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
        operation,
    )?;
    if output.status.success() {
        Ok(Some(output.stdout.trim().to_string()))
    } else if matches!(output.status.code(), Some(1 | 128)) {
        Ok(None)
    } else {
        Err("无法解析工作树起始提交。".into())
    }
}

/// Mirrors the official local branch path after refresh; never moves a local branch.
pub fn resolve_starting_ref(
    request: &RefreshRequest<'_>,
    operation: &SetupOperation,
) -> Result<String, String> {
    operation.check()?;
    if let Some(resolved) = request.resolved_starting_commit {
        return Ok(resolved.to_string());
    }
    if request.starting_mode != "branch" {
        return Ok("HEAD".into());
    }
    let branch = request
        .branch_name
        .filter(|branch| !branch.is_empty())
        .unwrap_or("HEAD");
    if matches!(branch, "HEAD" | "@") {
        return Ok(branch.into());
    }
    if request.remote_ref.is_some() {
        return Err("显式远程起始引用尚未接入此本地创建消费者。".into());
    }
    let local = if branch.starts_with("refs/heads/") {
        Some(branch.to_string())
    } else if branch.starts_with("refs/") {
        None
    } else {
        Some(format!("refs/heads/{branch}"))
    };
    let upstream = read(
        request.cwd,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &format!("{branch}@{{u}}"),
        ],
        operation,
    )?;
    if upstream.status.success() && !upstream.stdout.trim().is_empty() {
        let upstream = upstream.stdout.trim();
        let remote = format!("refs/remotes/{upstream}");
        let target = if commit(request.cwd, &remote, operation)?.is_some() {
            remote
        } else if upstream.starts_with("refs/") {
            upstream.to_string()
        } else {
            format!("refs/heads/{upstream}")
        };
        let left = local.as_deref().unwrap_or(branch);
        let counts = read(
            request.cwd,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("{left}...{target}"),
            ],
            operation,
        )?;
        if counts.status.success() {
            let mut counts = counts.stdout.split_whitespace();
            let left_count = counts.next().and_then(|number| number.parse::<u64>().ok());
            let right_count = counts.next().and_then(|number| number.parse::<u64>().ok());
            if left_count == Some(0) && right_count.is_some_and(|count| count > 0) {
                return Ok(target);
            }
        } else if !matches!(counts.status.code(), Some(1 | 128)) {
            return Err("无法比较本地分支和上游分支。".into());
        }
        return Ok(left.to_string());
    }
    if !upstream.status.success() && !matches!(upstream.status.code(), Some(1 | 128)) {
        return Err("无法读取起始分支的上游。".into());
    }
    if let Some(local) = local {
        if commit(request.cwd, &local, operation)?.is_some() {
            return Ok(local);
        }
    }
    if branch.starts_with("refs/remotes/") && commit(request.cwd, branch, operation)?.is_some() {
        return Ok(branch.to_string());
    }
    // Existing tags/full object IDs can resolve locally without adding a network consumer.
    Ok(commit(request.cwd, branch, operation)?.unwrap_or_else(|| branch.to_string()))
}

fn resolve(
    request: &RefreshRequest<'_>,
    operation: &SetupOperation,
) -> Result<Option<(String, String, String)>, String> {
    let cwd = request.cwd;
    let branch = request
        .branch_name
        .filter(|branch| !branch.is_empty())
        .unwrap_or("HEAD");
    let branch = if branch == "HEAD" {
        match value(
            cwd,
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            operation,
        )? {
            Some(branch) => branch,
            None => return Ok(None),
        }
    } else {
        branch.to_string()
    };
    let (remote, source, destination) = if branch.starts_with("refs/remotes/") {
        let destination =
            value(cwd, &["symbolic-ref", "--quiet", &branch], operation)?.unwrap_or(branch);
        let remotes = read(cwd, &["remote"], operation)?;
        if !remotes.status.success() {
            return Err("读取 Git 远程名称失败。".into());
        }
        let remote = remotes
            .stdout
            .lines()
            .filter(|remote| destination.starts_with(&format!("refs/remotes/{remote}/")))
            .max_by_key(|remote| remote.len());
        let Some(remote) = remote else {
            return Ok(None);
        };
        let refs = read(
            cwd,
            &["config", "--get-all", &format!("remote.{remote}.fetch")],
            operation,
        )?;
        if !refs.status.success() {
            return Ok(None);
        }
        let Some(source) =
            source_for_refspec(&destination, &refs.stdout.lines().collect::<Vec<_>>())
        else {
            return Ok(None);
        };
        (remote.to_string(), source, destination)
    } else {
        let Some(remote) = value(
            cwd,
            &["config", "--get", &format!("branch.{branch}.remote")],
            operation,
        )?
        else {
            return Ok(None);
        };
        let Some(source) = value(
            cwd,
            &["config", "--get", &format!("branch.{branch}.merge")],
            operation,
        )?
        else {
            return Ok(None);
        };
        if remote == "." {
            return Ok(None);
        }
        let upstream = read(
            cwd,
            &[
                "for-each-ref",
                "--format=%(upstream)",
                "--count=1",
                &format!("refs/heads/{branch}"),
            ],
            operation,
        )?;
        if !upstream.status.success() || upstream.stdout.trim().is_empty() {
            return Ok(None);
        }
        (remote, source, upstream.stdout.trim().to_string())
    };
    let Some(url) = value(
        cwd,
        &["config", "--get", &format!("remote.{remote}.url")],
        operation,
    )?
    else {
        return Ok(None);
    };
    Ok(Some((url, source, destination)))
}

/// A main cancellation is an error. Only the dedicated skip signal may continue.
pub fn refresh(
    request: RefreshRequest<'_>,
    operation: &SetupOperation,
    skip_refresh: &AtomicBool,
    log: LogSink,
) -> Result<RefreshOutcome, String> {
    operation.check()?;
    if request.mode == UpstreamRefreshMode::Never
        || request.starting_mode != "branch"
        || request.remote_ref.is_some()
        || request.resolved_starting_commit.is_some()
    {
        return Ok(RefreshOutcome::Skipped);
    }
    let Some((url, source, destination)) = resolve(&request, operation)? else {
        return Ok(RefreshOutcome::Skipped);
    };
    let mut credentials = Vec::new();
    for scope in ["--system", "--global"] {
        let mut command = command(request.cwd);
        command.args([
            "config",
            scope,
            "--includes",
            "--null",
            "--get-regexp",
            "^credential\\.",
        ]);
        match run(command, operation, Some(skip_refresh), None)? {
            RunOutcome::Skipped => {
                log("info", "[info] Continuing without updating\n");
                return Ok(RefreshOutcome::Skipped);
            }
            RunOutcome::Finished(output) if output.status.success() => {
                for entry in output.stdout.split('\0') {
                    if let Some((name, value)) = entry.split_once('\n') {
                        if !name.is_empty() {
                            credentials.push(format!("{name}={value}"));
                        }
                    }
                }
            }
            RunOutcome::Finished(_) => {}
        }
    }
    operation.check()?;
    if skip_refresh.load(Ordering::SeqCst) {
        log("info", "[info] Continuing without updating\n");
        return Ok(RefreshOutcome::Skipped);
    }
    log(
        "info",
        "[info] Refreshing upstream before creating worktree\n",
    );
    let mut command = command(request.cwd);
    for credential in credentials {
        command.args(["-c", &credential]);
    }
    command.args([
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "--progress",
        "--no-tags",
        "--no-recurse-submodules",
        "--",
        &url,
        &format!("+{source}:{destination}"),
    ]);
    #[cfg(windows)]
    let null = "NUL";
    #[cfg(not(windows))]
    let null = "/dev/null";
    command
        .env("GIT_CONFIG", null)
        .env("GIT_CONFIG_GLOBAL", null)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_PROTOCOL_FROM_USER", "0");
    let output = match run(command, operation, Some(skip_refresh), Some(&log))? {
        RunOutcome::Skipped => {
            log("info", "[info] Continuing without updating\n");
            return Ok(RefreshOutcome::Skipped);
        }
        RunOutcome::Finished(output) => output,
    };
    if output.status.success() {
        log("info", "[info] Upstream refreshed\n");
        Ok(RefreshOutcome::Refreshed {
            destination_ref: destination,
        })
    } else {
        let auth = output.stderr.to_ascii_lowercase();
        if [
            "authentication failed",
            "could not read username",
            "permission denied (publickey)",
        ]
        .iter()
        .any(|message| auth.contains(message))
        {
            log(
                "stderr",
                "[warning] Git authentication failed; sign in again before retrying\n",
            );
        }
        let message = "Could not refresh upstream; using cached Git state".to_string();
        log("stderr", &format!("[warning] {message}\n"));
        Ok(RefreshOutcome::Warning { message })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_environment_setup::SetupState;
    use std::path::{Path, PathBuf};

    fn git(cwd: &Path, args: &[&str]) -> String {
        let mut command = Command::new("git");
        command.arg("-C").arg(cwd).args(args).stdin(Stdio::null());
        #[cfg(windows)]
        let null = "NUL";
        #[cfg(not(windows))]
        let null = "/dev/null";
        command
            .env("GIT_CONFIG_GLOBAL", null)
            .env("GIT_CONFIG_NOSYSTEM", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "Git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }
    struct Fixture {
        root: PathBuf,
        remote: PathBuf,
        producer: PathBuf,
        local: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("codex-upstream-{}", uuid::Uuid::new_v4()));
            let remote = root.join("remote.git");
            let producer = root.join("producer");
            let local = root.join("local");
            std::fs::create_dir_all(&producer).unwrap();
            git(
                &root,
                &[
                    "init",
                    "--bare",
                    "--quiet",
                    "-b",
                    "main",
                    remote.to_str().unwrap(),
                ],
            );
            git(&producer, &["init", "--quiet", "-b", "main"]);
            git(
                &producer,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--quiet",
                    "--allow-empty",
                    "-m",
                    "initial",
                ],
            );
            git(
                &producer,
                &["remote", "add", "origin", remote.to_str().unwrap()],
            );
            git(
                &producer,
                &[
                    "push",
                    "--quiet",
                    "origin",
                    "HEAD:refs/heads/main",
                    "HEAD:refs/heads/other",
                ],
            );
            git(
                &root,
                &[
                    "clone",
                    "--quiet",
                    remote.to_str().unwrap(),
                    local.to_str().unwrap(),
                ],
            );
            std::fs::create_dir_all(local.join("nested")).unwrap();
            Self {
                root,
                remote,
                producer,
                local,
            }
        }
        fn advance(&self) -> String {
            git(
                &self.producer,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--quiet",
                    "--allow-empty",
                    "-m",
                    "next",
                ],
            );
            git(&self.producer, &["tag", "new-tag"]);
            git(
                &self.producer,
                &[
                    "push",
                    "--quiet",
                    "origin",
                    "HEAD:refs/heads/main",
                    "HEAD:refs/heads/other",
                    "refs/tags/new-tag",
                ],
            );
            git(&self.producer, &["rev-parse", "HEAD"])
        }
        fn request(&self) -> RefreshRequest<'_> {
            RefreshRequest {
                cwd: self.local.to_str().unwrap(),
                starting_mode: "branch",
                branch_name: Some("HEAD"),
                remote_ref: None,
                resolved_starting_commit: None,
                mode: UpstreamRefreshMode::BestEffort,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert!(self.root.starts_with(std::env::temp_dir()));
            assert!(self
                .root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("codex-upstream-"));
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    fn logs() -> (LogSink, Arc<std::sync::Mutex<Vec<String>>>) {
        let records = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = records.clone();
        (
            Arc::new(move |kind, text| sink.lock().unwrap().push(format!("{kind}:{text}"))),
            records,
        )
    }

    #[test]
    fn wu01_fetches_only_exact_upstream_without_tags_or_other_refs() {
        let fixture = Fixture::new();
        let old = git(&fixture.local, &["rev-parse", "refs/remotes/origin/other"]);
        let expected = fixture.advance();
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "fetch").unwrap();
        let (log, records) = logs();
        let mut request = fixture.request();
        let nested = fixture.local.join("nested");
        request.cwd = nested.to_str().unwrap();
        assert_eq!(
            refresh(request, &operation, &AtomicBool::new(false), log).unwrap(),
            RefreshOutcome::Refreshed {
                destination_ref: "refs/remotes/origin/main".into()
            }
        );
        assert_eq!(
            git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
            expected
        );
        assert_eq!(
            git(&fixture.local, &["rev-parse", "refs/remotes/origin/other"]),
            old
        );
        assert_eq!(git(&fixture.local, &["tag", "--list"]), "");
        assert_eq!(git(&fixture.local, &["rev-parse", "HEAD"]), old);
        let logs = records.lock().unwrap().join("");
        assert!(logs.find("Refreshing upstream") < logs.find("Upstream refreshed"));
        assert!(!logs.contains(fixture.remote.to_str().unwrap()));
    }

    #[test]
    fn wu02_never_exact_remote_working_tree_and_detached_skip() {
        let fixture = Fixture::new();
        let old = git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]);
        fixture.advance();
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "skip").unwrap();
        for case in 0..4 {
            let mut request = fixture.request();
            match case {
                0 => request.mode = UpstreamRefreshMode::Never,
                1 => request.resolved_starting_commit = Some(&old),
                2 => request.remote_ref = Some("origin/main"),
                _ => request.starting_mode = "working-tree",
            }
            assert_eq!(
                refresh(request, &operation, &AtomicBool::new(false), logs().0).unwrap(),
                RefreshOutcome::Skipped
            );
        }
        git(&fixture.local, &["checkout", "--quiet", "--detach"]);
        assert_eq!(
            refresh(
                fixture.request(),
                &operation,
                &AtomicBool::new(false),
                logs().0
            )
            .unwrap(),
            RefreshOutcome::Skipped
        );
        assert_eq!(
            git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
            old
        );
    }

    #[test]
    fn wu03_fetch_nonzero_warns_but_main_cancel_is_error() {
        let fixture = Fixture::new();
        git(
            &fixture.local,
            &[
                "remote",
                "set-url",
                "origin",
                fixture.root.join("missing.git").to_str().unwrap(),
            ],
        );
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "nonzero").unwrap();
        let (log, records) = logs();
        assert!(matches!(
            refresh(fixture.request(), &operation, &AtomicBool::new(false), log).unwrap(),
            RefreshOutcome::Warning { .. }
        ));
        assert!(records
            .lock()
            .unwrap()
            .join("")
            .contains("using cached Git state"));
        state.cancel("upstream", "nonzero");
        assert!(refresh(
            fixture.request(),
            &operation,
            &AtomicBool::new(false),
            logs().0
        )
        .is_err());
    }

    #[test]
    fn wu04_skip_refresh_continues_without_fetching() {
        let fixture = Fixture::new();
        let old = git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]);
        fixture.advance();
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "skip-only").unwrap();
        let (log, records) = logs();
        assert_eq!(
            refresh(fixture.request(), &operation, &AtomicBool::new(true), log).unwrap(),
            RefreshOutcome::Skipped
        );
        assert!(operation.check().is_ok());
        assert!(records
            .lock()
            .unwrap()
            .join("")
            .contains("Continuing without updating"));
        assert_eq!(
            git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
            old
        );
    }

    #[test]
    fn wu05_refspec_unique_mapping_negative_and_longest_remote() {
        assert_eq!(
            source_for_refspec(
                "refs/remotes/origin/main",
                &["+refs/heads/*:refs/remotes/origin/*"]
            ),
            Some("refs/heads/main".into())
        );
        assert_eq!(
            source_for_refspec(
                "refs/remotes/origin/main",
                &["+refs/heads/*:refs/remotes/origin/*", "^refs/heads/main"]
            ),
            None
        );
        assert_eq!(
            source_for_refspec(
                "refs/remotes/origin/main",
                &[
                    "+refs/heads/*:refs/remotes/origin/*",
                    "+refs/other/*:refs/remotes/origin/*"
                ]
            ),
            None
        );
        let fixture = Fixture::new();
        let expected = fixture.advance();
        git(
            &fixture.local,
            &[
                "config",
                "remote.origin/team.url",
                fixture.remote.to_str().unwrap(),
            ],
        );
        git(
            &fixture.local,
            &[
                "config",
                "remote.origin/team.fetch",
                "+refs/heads/*:refs/remotes/origin/team/*",
            ],
        );
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "longest").unwrap();
        let mut request = fixture.request();
        request.branch_name = Some("refs/remotes/origin/team/main");
        assert_eq!(
            refresh(request, &operation, &AtomicBool::new(false), logs().0).unwrap(),
            RefreshOutcome::Refreshed {
                destination_ref: "refs/remotes/origin/team/main".into()
            }
        );
        assert_eq!(
            git(
                &fixture.local,
                &["rev-parse", "refs/remotes/origin/team/main"]
            ),
            expected
        );
    }

    #[test]
    fn wu06_live_skip_and_main_cancel_stop_owned_process_tree() {
        let state = SetupState::default();
        for main_cancel in [false, true] {
            let operation = state
                .prepare_operation("upstream", if main_cancel { "main" } else { "skip" })
                .unwrap();
            let skip = AtomicBool::new(false);
            let (ready_tx, ready_rx) = mpsc::channel();
            let log: LogSink = Arc::new(move |_, text| {
                if text.contains("READY") {
                    let _ = ready_tx.send(());
                }
            });
            let (result_tx, result_rx) = mpsc::channel();
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    // A harmless child holds inherited pipes. Reader completion proves tree cleanup.
                    #[cfg(windows)]
                    let mut command = {
                        let mut command = Command::new("powershell.exe");
                        use std::os::windows::process::CommandExt;
                        command
                            .args([
                                "-NoLogo",
                                "-NoProfile",
                                "-NonInteractive",
                                "-Command",
                                "Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -NoNewWindow; [Console]::Error.WriteLine('remote: READY'); Start-Sleep -Seconds 30",
                            ])
                            .creation_flags(0x08000000 | 0x00000004);
                        command
                    };
                    #[cfg(unix)]
                    let mut command = {
                        let mut command = Command::new("/bin/sh");
                        use std::os::unix::process::CommandExt;
                        command.args(["-c", "sleep 30 & printf 'remote: READY\\n' >&2; wait"]).process_group(0);
                        command
                    };
                    command
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped());
                    result_tx
                        .send(run(command, &operation, Some(&skip), Some(&log)))
                        .unwrap();
                });
                ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                if main_cancel {
                    state.cancel("upstream", "main");
                } else {
                    skip.store(true, Ordering::SeqCst);
                }
                let result = result_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                if main_cancel {
                    assert!(result.is_err());
                } else {
                    assert!(matches!(result.unwrap(), RunOutcome::Skipped));
                }
            });
        }
    }

    #[test]
    fn wu07_real_creation_follows_refreshed_cached_skipped_and_cancelled_outcomes() {
        for case in ["refreshed", "cached", "skipped", "cancelled"] {
            let fixture = Fixture::new();
            let old = git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]);
            let new = fixture.advance();
            let state = SetupState::default();
            let operation = state.prepare_operation("upstream-create", case).unwrap();
            if case == "cached" {
                git(
                    &fixture.local,
                    &[
                        "remote",
                        "set-url",
                        "origin",
                        fixture.root.join("missing.git").to_str().unwrap(),
                    ],
                );
            }
            if case == "cancelled" {
                state.cancel("upstream-create", case);
            }
            let managed = fixture.root.join("managed");
            let mut request = fixture.request();
            request.branch_name = Some("main");
            let result = refresh(
                request,
                &operation,
                &AtomicBool::new(case == "skipped"),
                logs().0,
            )
            .and_then(|outcome| {
                operation.check()?;
                let mut request = fixture.request();
                request.branch_name = Some("main");
                let starting_ref = resolve_starting_ref(&request, &operation)?;
                let created = crate::local_environment_setup::create_worktree_prepared(
                    operation,
                    fixture.local.to_str().unwrap(),
                    "branch",
                    Some(starting_ref),
                    None,
                    managed.to_str().unwrap(),
                    None,
                    None,
                )?;
                Ok((outcome, created))
            });
            if case == "cancelled" {
                assert!(result.is_err());
                assert!(
                    !managed.exists(),
                    "cancelled refresh must not create a worktree directory"
                );
                continue;
            }
            let (outcome, created) = result.unwrap();
            assert_eq!(
                git(&fixture.local, &["rev-parse", "refs/heads/main"]),
                old,
                "resolving starting ref must not move the local branch"
            );
            let expected = if case == "refreshed" { new } else { old };
            assert_eq!(
                git(Path::new(&created.path), &["rev-parse", "HEAD"]),
                expected,
                "{case}"
            );
            match case {
                "refreshed" => assert!(matches!(outcome, RefreshOutcome::Refreshed { .. })),
                "cached" => assert!(matches!(outcome, RefreshOutcome::Warning { .. })),
                "skipped" => assert_eq!(outcome, RefreshOutcome::Skipped),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn wu08_process_spawn_exception_is_not_best_effort_success() {
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "spawn-error").unwrap();
        let nonexistent =
            std::env::temp_dir().join(format!("codex-missing-executable-{}", uuid::Uuid::new_v4()));
        assert!(run(
            Command::new(nonexistent),
            &operation,
            Some(&AtomicBool::new(false)),
            None
        )
        .is_err());
    }

    #[test]
    fn wu09_starting_ref_matches_right_ahead_equal_local_ahead_and_diverged() {
        let fixture = Fixture::new();
        let old = git(&fixture.local, &["rev-parse", "main"]);
        fixture.advance();
        let state = SetupState::default();
        let operation = state.prepare_operation("upstream", "starting-ref").unwrap();
        let mut request = fixture.request();
        request.branch_name = Some("main");
        refresh(
            fixture.request(),
            &operation,
            &AtomicBool::new(false),
            logs().0,
        )
        .unwrap();
        assert_eq!(
            resolve_starting_ref(&request, &operation).unwrap(),
            "refs/remotes/origin/main"
        );
        assert_eq!(
            resolve_starting_ref(&fixture.request(), &operation).unwrap(),
            "HEAD",
            "official HEAD short circuit must not become tracking branch"
        );
        git(
            &fixture.local,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "--allow-empty",
                "-m",
                "local-diverged",
            ],
        );
        assert_eq!(
            resolve_starting_ref(&request, &operation).unwrap(),
            "refs/heads/main",
            "divergence retains local branch"
        );
        git(
            &fixture.local,
            &["update-ref", "refs/remotes/origin/main", &old],
        );
        assert_eq!(
            resolve_starting_ref(&request, &operation).unwrap(),
            "refs/heads/main",
            "local ahead retains local branch"
        );
        let local = git(&fixture.local, &["rev-parse", "main"]);
        git(
            &fixture.local,
            &["update-ref", "refs/remotes/origin/main", &local],
        );
        assert_eq!(
            resolve_starting_ref(&request, &operation).unwrap(),
            "refs/heads/main",
            "equal retains local branch"
        );
        git(&fixture.local, &["config", "--unset", "branch.main.remote"]);
        assert_eq!(
            resolve_starting_ref(&request, &operation).unwrap(),
            "refs/heads/main",
            "missing upstream retains existing local branch"
        );
        request.resolved_starting_commit = Some(&old);
        assert_eq!(resolve_starting_ref(&request, &operation).unwrap(), old);
    }
}
