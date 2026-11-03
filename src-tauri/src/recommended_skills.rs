use crate::config_skills::{parse_skill_dir, SkillInfoItem};
use crate::state::{codex_home_dir, normalize_fs_path};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const ORIGIN: &str = "https://github.com/openai/skills.git";
const CACHE_AGE_MS: u64 = 10 * 60 * 1000;

#[cfg(windows)]
pub(crate) mod git_job {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::time::{Duration, Instant};

    type Handle = *mut c_void;
    #[repr(C)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_limit: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[repr(C)]
    struct Accounting {
        times: [i64; 4],
        page_faults: u32,
        total: u32,
        active: u32,
        terminated: u32,
    }
    #[repr(C)]
    struct ThreadEntry {
        size: u32,
        usage: u32,
        id: u32,
        owner: u32,
        priority: i32,
        base_priority: i32,
        flags: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            class: i32,
            information: *const c_void,
            size: u32,
        ) -> i32;
        fn QueryInformationJobObject(
            job: Handle,
            class: i32,
            information: *mut c_void,
            size: u32,
            returned: *mut u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process: u32) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn OpenThread(access: u32, inherit: i32, id: u32) -> Handle;
        fn ResumeThread(thread: Handle) -> u32;
        fn OpenProcess(access: u32, inherit: i32, process: u32) -> Handle;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    pub(crate) struct Job(Handle);
    // A Job owns a kernel handle; Windows permits using/closing it on another thread.
    unsafe impl Send for Job {}
    struct ProcessHandles(Vec<Handle>);
    impl Drop for ProcessHandles {
        fn drop(&mut self) {
            for handle in &self.0 {
                unsafe {
                    CloseHandle(*handle);
                }
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    impl Job {
        pub(crate) fn attach_running(process: Handle) -> Result<Self, String> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                let job = Self(handle);
                let mut limits: ExtendedLimits = zeroed();
                limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
                if SetInformationJobObject(
                    handle,
                    9,
                    &limits as *const _ as *const c_void,
                    size_of::<ExtendedLimits>() as u32,
                ) == 0
                    || AssignProcessToJobObject(handle, process) == 0
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                Ok(job)
            }
        }

        pub(crate) fn attach_and_resume(child: &Child) -> Result<Self, String> {
            let job = Self::attach_running(child.as_raw_handle())?;
            unsafe {
                // The process is still suspended, so no helper can escape before job assignment.
                let snapshot = CreateToolhelp32Snapshot(4, 0);
                if snapshot as isize == -1 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                let mut entry: ThreadEntry = zeroed();
                entry.size = size_of::<ThreadEntry>() as u32;
                let mut more = Thread32First(snapshot, &mut entry);
                let mut resumed = false;
                while more != 0 {
                    if entry.owner == child.id() {
                        let thread = OpenThread(2, 0, entry.id);
                        if !thread.is_null() {
                            resumed = ResumeThread(thread) != u32::MAX;
                            CloseHandle(thread);
                        }
                        break;
                    }
                    more = Thread32Next(snapshot, &mut entry);
                }
                CloseHandle(snapshot);
                if !resumed {
                    return Err("无法恢复受控 Git 进程主线程".into());
                }
                Ok(job)
            }
        }

        pub(crate) fn stop(&self) -> Result<(), String> {
            unsafe {
                // Retain handles before termination: ActiveProcesses may reach zero
                // slightly before the final process handles become signalled.
                let mut ids = vec![0usize; 258];
                loop {
                    if QueryInformationJobObject(
                        self.0,
                        3,
                        ids.as_mut_ptr() as *mut c_void,
                        (ids.len() * size_of::<usize>()) as u32,
                        std::ptr::null_mut(),
                    ) != 0
                    {
                        break;
                    }
                    if std::io::Error::last_os_error().raw_os_error() != Some(234) {
                        return Err(std::io::Error::last_os_error().to_string());
                    }
                    ids.resize(ids.len() * 2, 0);
                }
                let count = *((ids.as_ptr() as *const u32).add(1)) as usize;
                let first = ids.as_ptr().cast::<u8>().add(8).cast::<usize>();
                let mut handles = ProcessHandles(Vec::new());
                for index in 0..count {
                    let handle = OpenProcess(0x100000, 0, *first.add(index) as u32);
                    if !handle.is_null() {
                        handles.0.push(handle);
                    }
                }
                if TerminateJobObject(self.0, 1) == 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                let cleanup_deadline = Instant::now() + Duration::from_secs(2);
                loop {
                    let mut info: Accounting = zeroed();
                    if QueryInformationJobObject(
                        self.0,
                        1,
                        &mut info as *mut _ as *mut c_void,
                        size_of::<Accounting>() as u32,
                        std::ptr::null_mut(),
                    ) == 0
                    {
                        return Err(std::io::Error::last_os_error().to_string());
                    }
                    if info.active == 0 {
                        for handle in &handles.0 {
                            let remaining = cleanup_deadline
                                .saturating_duration_since(Instant::now())
                                .as_millis()
                                .min(u32::MAX as u128)
                                as u32;
                            if WaitForSingleObject(*handle, remaining) != 0 {
                                return Err("Git 子进程终止未能在清理时限内确认".into());
                            }
                        }
                        return Ok(());
                    }
                    if Instant::now() >= cleanup_deadline {
                        return Err("Git 进程树终止未能在清理时限内确认".into());
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub repo_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedSkillsResult {
    pub skills: Vec<RecommendedSkill>,
    pub repo_root: String,
    pub source: String,
    pub fetched_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedSkillInstallResult {
    pub destination: String,
    pub skill: SkillInfoItem,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn path_text(path: &Path) -> String {
    normalize_fs_path(&path.to_string_lossy())
}

#[derive(Default)]
struct HomeLock {
    operation: Mutex<()>,
    refresh_generation: AtomicU64,
    last_refresh: Mutex<Option<RecommendedSkillsResult>>,
}

fn home_lock(home: &Path) -> Result<Arc<HomeLock>, String> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<HomeLock>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "技能目录锁不可用")?;
    Ok(locks.entry(home.to_path_buf()).or_default().clone())
}

// Reject junctions too: is_symlink alone does not cover every Windows reparse point.
fn reject_links(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("技能目录必须是没有相对路径段的绝对路径".into());
    }
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        if !matches!(part, Component::Normal(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                #[cfg(windows)]
                let linked = {
                    use std::os::windows::fs::MetadataExt;
                    meta.file_attributes() & 0x400 != 0
                };
                #[cfg(not(windows))]
                let linked = meta.file_type().is_symlink();
                if linked {
                    return Err(format!("技能目录不能经过链接: {}", path_text(&current)));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn prepare_home(home: &Path) -> Result<PathBuf, String> {
    reject_links(home)?;
    fs::create_dir_all(home).map_err(|e| e.to_string())?;
    fs::canonicalize(home).map_err(|e| e.to_string())
}

fn git(cwd: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(key);
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let (status, output, error) = run_git_process(command, Duration::from_secs(30))?;
    if !status.success() {
        return Err(format!(
            "Git 操作失败: {}",
            String::from_utf8_lossy(&error).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output).trim().to_string())
}

// Private to this Git bridge: the deadline includes inherited output pipes, and
// Windows helpers enter the job before the suspended root process can run.
fn run_git_process(
    mut command: Command,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    let deadline = Instant::now() + timeout;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000004); // CREATE_NO_WINDOW | CREATE_SUSPENDED
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| format!("Git 启动失败: {e}"))?;
    #[cfg(windows)]
    let job = match git_job::Job::attach_and_resume(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Git 进程树隔离失败: {error}"));
        }
    };
    let stdout = child.stdout.take().ok_or("Git stdout 不可用")?;
    let stderr = child.stderr.take().ok_or("Git stderr 不可用")?;
    let read_output = |mut pipe: Box<dyn Read + Send>| {
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = pipe
                .read_to_end(&mut bytes)
                .map(|_| bytes)
                .map_err(|e| e.to_string());
            let _ = send.send(result);
        });
        receive
    };
    let out = read_output(Box::new(stdout));
    let err = read_output(Box::new(stderr));
    let result = (|| {
        let status = loop {
            if Instant::now() >= deadline {
                return Err("Git 操作超过时限，未确认刷新成功".to_string());
            }
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) => break status,
                None => std::thread::sleep(Duration::from_millis(5)),
            }
        };
        let output = out
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| "Git 输出收尾超过时限".to_string())??;
        let error = err
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| "Git 错误输出收尾超过时限".to_string())??;
        Ok((status, output, error))
    })();
    #[cfg(windows)]
    let stopped = job.stop();
    #[cfg(unix)]
    let stopped: Result<(), String> = {
        extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        unsafe {
            kill(-(child.id() as i32), 9);
        }
        Ok(())
    };
    let _ = child.kill();
    let _ = child.wait();
    stopped?;
    result
}

fn validate_repository(root: &Path, expected_origin: &str) -> Result<(), String> {
    reject_links(root)?;
    reject_links(&root.join(".git"))?;
    if !root.join(".git").is_dir() {
        return Err("推荐技能托管位置已存在，但不是独立 Git 仓库；原目录已保留".into());
    }
    let actual = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let top = git(Some(root), &["rev-parse", "--show-toplevel"])?;
    if fs::canonicalize(top).map_err(|e| e.to_string())? != actual {
        return Err("推荐技能仓库根目录不匹配".into());
    }
    if git(Some(root), &["remote", "get-url", "origin"])? != expected_origin {
        return Err("推荐技能仓库 origin 不匹配；未更新原目录".into());
    }
    Ok(())
}

fn update_repository(home: &Path, origin: &str) -> Result<PathBuf, String> {
    let parent = home.join("vendor_imports");
    let root = parent.join("skills");
    reject_links(&root)?;
    if root.exists() {
        validate_repository(&root, origin)?;
        git(Some(&root), &["fetch", "--depth=1", "origin", "main"])?;
        git(Some(&root), &["reset", "--hard", "FETCH_HEAD"])?;
    } else {
        fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        let staging = parent.join(format!(".skills-clone-{}", uuid::Uuid::new_v4()));
        let clone_result = (|| {
            git(
                None,
                &[
                    "clone",
                    "--depth=1",
                    "--filter=blob:none",
                    "--sparse",
                    "--branch",
                    "main",
                    "--",
                    origin,
                    &path_text(&staging),
                ],
            )?;
            validate_repository(&staging, origin)?;
            git(
                Some(&staging),
                &[
                    "sparse-checkout",
                    "set",
                    "skills/.curated",
                    "skills/.experimental",
                ],
            )?;
            fs::rename(&staging, &root).map_err(|e| e.to_string())
        })();
        if clone_result.is_err() && staging.is_dir() {
            let _ = fs::remove_dir_all(&staging);
        }
        clone_result?;
    }
    Ok(root)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn validate_repo_path(id: &str, repo_path: &str) -> Result<(), String> {
    if !valid_id(id)
        || ![
            format!("skills/.curated/{id}"),
            format!("skills/.experimental/{id}"),
        ]
        .contains(&repo_path.to_string())
    {
        return Err("推荐技能 ID 或来源路径无效".into());
    }
    Ok(())
}

fn read_catalog(root: &Path) -> Result<Vec<RecommendedSkill>, String> {
    reject_links(root)?;
    let mut seen = HashSet::new();
    let mut skills = Vec::new();
    for category in [".curated", ".experimental"] {
        let directory = root.join("skills").join(category);
        reject_links(&directory)?;
        if !directory.exists() {
            continue;
        }
        let mut entries = fs::read_dir(&directory)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            reject_links(&path)?;
            if !path.is_dir() {
                continue;
            }
            reject_links(&path.join("SKILL.md"))?;
            if let Some(skill) = parse_skill_dir(&path, false) {
                if !valid_id(&skill.id) || !seen.insert(skill.id.clone()) {
                    continue;
                }
                let mut name = skill.name;
                if let Some(frontmatter) = skill
                    .content
                    .strip_prefix("---\n")
                    .or_else(|| skill.content.strip_prefix("---\r\n"))
                {
                    for line in frontmatter.lines().take_while(|line| line.trim() != "---") {
                        if let Some(value) = line.trim().strip_prefix("name:") {
                            let value = value.trim().trim_matches('"').trim_matches('\'');
                            if !value.is_empty() {
                                name = value.to_string();
                            }
                        }
                    }
                }
                skills.push(RecommendedSkill {
                    repo_path: format!("skills/{category}/{}", skill.id),
                    id: skill.id,
                    name,
                    description: skill.description,
                });
            }
        }
    }
    skills.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(skills)
}

fn read_cache(home: &Path) -> Option<RecommendedSkillsResult> {
    let path = home.join("skills-curated-cache.json");
    reject_links(&path).ok()?;
    let cache: RecommendedSkillsResult = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if cache
        .skills
        .iter()
        .any(|skill| validate_repo_path(&skill.id, &skill.repo_path).is_err())
    {
        return None;
    }
    Some(cache)
}

fn save_cache(home: &Path, result: &RecommendedSkillsResult) -> Result<(), String> {
    let destination = home.join("skills-curated-cache.json");
    reject_links(&destination)?;
    let temporary = home.join(format!(".skills-cache-{}.json", uuid::Uuid::new_v4()));
    fs::write(
        &temporary,
        serde_json::to_vec(result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let result = fs::rename(&temporary, &destination).map_err(|e| e.to_string());
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn list_at_home(
    home: &Path,
    local_source: Option<&Path>,
    refresh: bool,
    origin: &str,
) -> Result<RecommendedSkillsResult, String> {
    let home = prepare_home(home)?;
    let lock = home_lock(&home)?;
    let generation = lock.refresh_generation.load(Ordering::Acquire);
    let _guard = lock.operation.lock().map_err(|_| "技能目录锁不可用")?;
    if refresh && lock.refresh_generation.load(Ordering::Acquire) != generation {
        if let Some(result) = lock
            .last_refresh
            .lock()
            .map_err(|_| "技能目录锁不可用")?
            .clone()
        {
            return Ok(result);
        }
    }
    let result = list_locked(&home, local_source, refresh, origin)?;
    if refresh {
        *lock.last_refresh.lock().map_err(|_| "技能目录锁不可用")? = Some(result.clone());
        lock.refresh_generation.fetch_add(1, Ordering::Release);
    }
    Ok(result)
}

fn list_locked(
    home: &Path,
    local_source: Option<&Path>,
    refresh: bool,
    origin: &str,
) -> Result<RecommendedSkillsResult, String> {
    let root = home.join("vendor_imports").join("skills");
    let cache = read_cache(home);
    let identity = if root.exists() || fs::symlink_metadata(&root).is_ok() {
        validate_repository(&root, origin)
    } else {
        Ok(())
    };
    if let Err(error) = identity {
        return Ok(fallback(cache, &root, error));
    }
    if !refresh {
        if let Some(cache) = cache.as_ref().filter(|cache| {
            cache
                .fetched_at
                .is_some_and(|time| now_ms().saturating_sub(time) < CACHE_AGE_MS)
        }) {
            let mut result = cache.clone();
            result.source = "cache".into();
            result.error = None;
            return Ok(result);
        }
        if !root.exists() {
            if let Some(local_source) = local_source {
                let skills = read_catalog(local_source)?;
                if !skills.is_empty() {
                    return Ok(RecommendedSkillsResult {
                        skills,
                        repo_root: path_text(local_source),
                        source: "local-source".into(),
                        fetched_at: None,
                        error: None,
                    });
                }
            }
        }
    }
    match update_repository(home, origin).and_then(|path| read_catalog(&path)) {
        Ok(skills) => {
            let mut result = RecommendedSkillsResult {
                skills,
                repo_root: path_text(&root),
                source: "github".into(),
                fetched_at: Some(now_ms()),
                error: None,
            };
            if let Err(error) = save_cache(home, &result) {
                result.error = Some(format!("目录已读取，但缓存保存失败: {error}"));
            }
            Ok(result)
        }
        Err(error) => Ok(fallback(cache, &root, error)),
    }
}

fn fallback(
    cache: Option<RecommendedSkillsResult>,
    root: &Path,
    error: String,
) -> RecommendedSkillsResult {
    if let Some(mut cache) = cache {
        cache.source = "cache".into();
        cache.error = Some(error);
        cache
    } else {
        RecommendedSkillsResult {
            skills: Vec::new(),
            repo_root: path_text(root),
            source: "unavailable".into(),
            fetched_at: None,
            error: Some(error),
        }
    }
}

fn local_source() -> Option<PathBuf> {
    std::env::var_os("CODEX_SKILL_SOURCE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn list_recommended_skills(refresh: bool) -> Result<RecommendedSkillsResult, String> {
    list_at_home(
        &codex_home_dir(),
        local_source().as_deref(),
        refresh,
        ORIGIN,
    )
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    reject_links(source)?;
    fs::create_dir(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        reject_links(&from)?;
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else if from.is_file() {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        } else {
            return Err("技能包含无法复制的文件类型".into());
        }
    }
    Ok(())
}

fn installed_result(destination: &Path) -> Result<RecommendedSkillInstallResult, String> {
    reject_links(destination)?;
    reject_links(&destination.join("SKILL.md"))?;
    let skill = parse_skill_dir(destination, true)
        .ok_or("目标已存在但没有可读 SKILL.md，未覆盖原有目录")?;
    Ok(RecommendedSkillInstallResult {
        destination: path_text(destination),
        skill,
    })
}

fn install_at_home(
    home: &Path,
    local_source: Option<&Path>,
    id: &str,
    repo_path: &str,
    install_root: Option<&Path>,
    origin: &str,
) -> Result<RecommendedSkillInstallResult, String> {
    validate_repo_path(id, repo_path)?;
    let home = prepare_home(home)?;
    let lock = home_lock(&home)?;
    let _guard = lock.operation.lock().map_err(|_| "技能目录锁不可用")?;
    let parent = if let Some(project) = install_root {
        reject_links(project)?;
        if !project.is_dir() {
            return Err("项目目录不存在".into());
        }
        fs::canonicalize(project)
            .map_err(|e| e.to_string())?
            .join(".codex")
            .join("skills")
    } else {
        home.join("skills")
    };
    reject_links(&parent)?;
    let destination = parent.join(id);
    reject_links(&destination)?;
    if destination.exists() {
        return installed_result(&destination);
    }
    let managed = home.join("vendor_imports").join("skills");
    let source_root = if managed.exists() {
        validate_repository(&managed, origin)?;
        managed.clone()
    } else if let Some(local_source) = local_source {
        reject_links(local_source)?;
        local_source.to_path_buf()
    } else {
        managed.clone()
    };
    let mut source = source_root.join(repo_path);
    if !source.join("SKILL.md").is_file() {
        let result = list_locked(&home, local_source, true, origin)?;
        if let Some(error) = result.error {
            return Err(format!("推荐来源无法准备: {error}"));
        }
        source = managed.join(repo_path);
    }
    reject_links(&source)?;
    let canonical_root = fs::canonicalize(
        source
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .ok_or("来源目录无效")?,
    )
    .map_err(|e| e.to_string())?;
    let canonical_source = fs::canonicalize(&source).map_err(|e| e.to_string())?;
    if !canonical_source.starts_with(&canonical_root)
        || parse_skill_dir(&canonical_source, false).is_none()
    {
        return Err("推荐技能来源不可读或越界".into());
    }
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".skill-install-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        copy_tree(&canonical_source, &staging)?;
        reject_links(&staging.join("SKILL.md"))?;
        if parse_skill_dir(&staging, true).is_none() {
            return Err("复制后的技能无法读回".into());
        }
        // Never replace an existing destination, including a concurrently created empty directory.
        if fs::symlink_metadata(&destination).is_ok() {
            return installed_result(&destination);
        }
        fs::rename(&staging, &destination).map_err(|e| e.to_string())?;
        installed_result(&destination)
    })();
    if staging.is_dir() {
        let _ = fs::remove_dir_all(staging);
    }
    result
}

pub fn install_recommended_skill(
    id: &str,
    repo_path: &str,
    install_root: Option<String>,
) -> Result<RecommendedSkillInstallResult, String> {
    install_at_home(
        &codex_home_dir(),
        local_source().as_deref(),
        id,
        repo_path,
        install_root.as_deref().map(Path::new),
        ORIGIN,
    )
}

#[cfg(test)]
mod recommended_skills_tests {
    use super::*;

    #[test]
    fn process_tree_fixture() {
        let Ok(mode) = std::env::var("CODEX_SKILL_TEST_PROCESS_MODE") else {
            return;
        };
        let marker = PathBuf::from(std::env::var_os("CODEX_SKILL_TEST_PROCESS_MARKER").unwrap());
        if mode == "child" {
            fs::write(marker.with_extension("ready"), b"ready").unwrap();
            let setup_deadline = Instant::now() + Duration::from_secs(10);
            while !marker.with_extension("go").exists() {
                assert!(
                    Instant::now() < setup_deadline,
                    "test fixture setup handshake timed out"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            std::thread::sleep(Duration::from_millis(4500));
            fs::write(&marker, b"late helper write").unwrap();
            return;
        }
        let mut helper = Command::new(std::env::current_exe().unwrap());
        helper
            .args([
                "--exact",
                "recommended_skills::recommended_skills_tests::process_tree_fixture",
                "--nocapture",
            ])
            .env("CODEX_SKILL_TEST_PROCESS_MODE", "child")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        let child = helper.spawn().unwrap();
        fs::write(marker.with_extension("pid"), child.id().to_string()).unwrap();
        if mode == "parent-hang" {
            std::thread::sleep(Duration::from_secs(10));
        }
        // parent-exit deliberately leaves a child holding the inherited output pipe.
    }

    #[test]
    #[cfg(windows)]
    fn git_deadline_stops_helpers_even_after_parent_exit_and_releases_clean_lock() {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, process: u32) -> *mut c_void;
            fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        let f = Fixture::new();
        let home = prepare_home(&f.home).unwrap();
        let lock = home_lock(&home).unwrap();
        for mode in ["parent-hang", "parent-exit"] {
            let marker = f.root.join(format!("{mode}.marker"));
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "recommended_skills::recommended_skills_tests::process_tree_fixture",
                    "--nocapture",
                ])
                .env("CODEX_SKILL_TEST_PROCESS_MODE", mode)
                .env("CODEX_SKILL_TEST_PROCESS_MARKER", &marker);
            let started = Instant::now();
            let operation_lock = lock.clone();
            let operation = std::thread::spawn(move || {
                let _guard = operation_lock.operation.lock().unwrap();
                run_git_process(command, Duration::from_millis(3000))
            });
            // Setup is separately diagnosed; the production deadline still
            // includes process startup and inherited output-pipe completion.
            let setup_deadline = started + Duration::from_secs(2);
            while !marker.with_extension("ready").is_file() {
                assert!(
                    Instant::now() < setup_deadline,
                    "helper did not reach setup handshake before timeout test"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            fs::write(marker.with_extension("go"), b"exercise deadline").unwrap();
            assert!(operation.join().unwrap().unwrap_err().contains("时限"));
            assert!(started.elapsed() < Duration::from_secs(5));
            let pid: u32 = fs::read_to_string(marker.with_extension("pid"))
                .unwrap()
                .parse()
                .unwrap();
            unsafe {
                let handle = OpenProcess(0x100000, 0, pid);
                if !handle.is_null() {
                    assert_eq!(
                        WaitForSingleObject(handle, 0),
                        0,
                        "helper still running after deadline"
                    );
                    CloseHandle(handle);
                }
            }
            {
                let _guard = lock.operation.lock().unwrap();
                fs::write(&marker, b"next operation").unwrap();
            }
            std::thread::sleep(Duration::from_millis(5000));
            assert_eq!(fs::read(&marker).unwrap(), b"next operation");
        }
    }

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
        origin: String,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("codex-recommended-skills-{}", uuid::Uuid::new_v4()));
            let source = root.join("remote");
            fs::create_dir_all(&source).unwrap();
            git(Some(&source), &["init", "-b", "main"]).unwrap();
            git(Some(&source), &["config", "user.name", "Skills test"]).unwrap();
            git(
                Some(&source),
                &["config", "user.email", "skills@example.invalid"],
            )
            .unwrap();
            Self::skill(&source, ".curated", "sample", "Curated sample");
            Self::skill(&source, ".experimental", "sample", "Experimental sample");
            Self::skill(&source, ".experimental", "second", "Another skill");
            fs::create_dir_all(source.join("skills/.curated/missing")).unwrap();
            git(Some(&source), &["add", "."]).unwrap();
            git(Some(&source), &["commit", "-m", "Fixture skills"]).unwrap();
            let origin = path_text(&source);
            let home = root.join("home");
            Self { root, home, origin }
        }
        fn skill(root: &Path, category: &str, id: &str, name: &str) {
            let dir = root.join("skills").join(category).join(id);
            fs::create_dir_all(dir.join("assets/nested")).unwrap();
            fs::write(
                dir.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: Real description\n---\n# Heading\n"),
            )
            .unwrap();
            fs::write(dir.join("assets/nested/data.bin"), [0, 1, 255, 10, 13]).unwrap();
        }
        fn list(&self, refresh: bool) -> RecommendedSkillsResult {
            list_at_home(&self.home, None, refresh, &self.origin).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn sr01_catalog_prioritizes_curated_and_reads_real_frontmatter() {
        let f = Fixture::new();
        let result = f.list(false);
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(result.skills.len(), 2);
        let item = result
            .skills
            .iter()
            .find(|item| item.id == "sample")
            .unwrap();
        assert_eq!(item.name, "Curated sample");
        assert_eq!(item.repo_path, "skills/.curated/sample");
        assert_eq!(item.description, "Real description");
    }

    #[test]
    fn sr02_cache_age_and_explicit_refresh_control_git_access() {
        let f = Fixture::new();
        let initial = f.list(false);
        assert_eq!(initial.source, "github");
        fs::rename(f.root.join("remote"), f.root.join("offline")).unwrap();
        let cached = f.list(false);
        assert_eq!(cached.source, "cache");
        assert!(cached.error.is_none());
        assert_eq!(cached.fetched_at, initial.fetched_at);
        assert!(f.list(true).error.is_some());
        let mut expired = initial;
        expired.fetched_at = Some(now_ms() - CACHE_AGE_MS - 1);
        save_cache(&f.home, &expired).unwrap();
        let result = f.list(false);
        assert!(result.error.is_some());
        assert_eq!(result.skills.len(), 2);
    }

    #[test]
    fn sr03_failed_refresh_preserves_cache_and_empty_error_is_visible() {
        let f = Fixture::new();
        let initial = f.list(false);
        fs::rename(f.root.join("remote"), f.root.join("offline")).unwrap();
        let result = f.list(true);
        assert_eq!(result.skills[0].id, initial.skills[0].id);
        assert!(result.error.is_some());
        fs::remove_file(f.home.join("skills-curated-cache.json")).unwrap();
        let result = f.list(true);
        assert!(result.skills.is_empty());
        assert_eq!(result.source, "unavailable");
        assert!(result.error.is_some());
    }

    #[test]
    fn sr04_foreign_directories_and_origins_are_untouched() {
        let f = Fixture::new();
        let managed = f.home.join("vendor_imports/skills");
        fs::create_dir_all(&managed).unwrap();
        fs::write(managed.join("keep"), b"user bytes").unwrap();
        assert!(f.list(true).error.is_some());
        assert_eq!(fs::read(managed.join("keep")).unwrap(), b"user bytes");
        git(Some(&managed), &["init", "-b", "main"]).unwrap();
        git(
            Some(&managed),
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/user.git",
            ],
        )
        .unwrap();
        assert!(f.list(true).error.unwrap().contains("origin"));
        assert_eq!(fs::read(managed.join("keep")).unwrap(), b"user bytes");
    }

    #[test]
    fn sr05_complete_install_preserves_every_file_and_source() {
        let f = Fixture::new();
        f.list(false);
        let result = install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin,
        )
        .unwrap();
        assert_eq!(result.skill.id, "sample");
        let destination = PathBuf::from(result.destination);
        assert_eq!(
            fs::read(destination.join("assets/nested/data.bin")).unwrap(),
            [0, 1, 255, 10, 13]
        );
        assert_eq!(
            fs::read(destination.join("SKILL.md")).unwrap(),
            fs::read(
                f.home
                    .join("vendor_imports/skills/skills/.curated/sample/SKILL.md")
            )
            .unwrap()
        );
        assert!(git(
            Some(&f.home.join("vendor_imports/skills")),
            &["status", "--porcelain"]
        )
        .unwrap()
        .is_empty());
    }

    #[test]
    fn sr06_project_scope_and_existing_targets_do_not_overwrite() {
        let f = Fixture::new();
        f.list(false);
        let project = f.root.join("project");
        fs::create_dir(&project).unwrap();
        let result = install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            Some(&project),
            &f.origin,
        )
        .unwrap();
        assert!(PathBuf::from(result.destination).starts_with(&project));
        assert!(!f.home.join("skills/sample").exists());
        let target = project.join(".codex/skills/sample");
        fs::write(
            target.join("SKILL.md"),
            "# My customized skill\nDo not replace",
        )
        .unwrap();
        install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            Some(&project),
            &f.origin,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "# My customized skill\nDo not replace"
        );
        fs::create_dir_all(f.home.join("skills/sample")).unwrap();
        assert!(install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin
        )
        .is_err());
    }

    #[test]
    fn sr07_invalid_identity_and_copy_failure_leave_no_partial_skill() {
        let f = Fixture::new();
        f.list(false);
        for (id, path) in [
            ("../escape", "skills/.curated/../escape"),
            ("sample", "skills/.curated/../../outside"),
            ("sample", "skills/.experimental/other"),
        ] {
            assert!(install_at_home(&f.home, None, id, path, None, &f.origin).is_err());
        }
        fs::write(f.home.join("skills"), b"not directory").unwrap();
        assert!(install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin
        )
        .is_err());
        fs::remove_file(f.home.join("skills")).unwrap();
        assert!(install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin
        )
        .is_ok());
    }

    #[test]
    fn sr04_sr07_source_and_managed_links_are_rejected() {
        let f = Fixture::new();
        f.list(false);
        let outside = f.root.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("keep"), b"untouched").unwrap();
        let link = f
            .home
            .join("vendor_imports/skills/skills/.curated/sample/link");
        #[cfg(windows)]
        {
            let status = Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(link.to_string_lossy().replace('/', "\\"))
                .arg(outside.to_string_lossy().replace('/', "\\"))
                .stdout(Stdio::null())
                .status()
                .unwrap();
            assert!(status.success());
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin
        )
        .is_err());
        assert!(!f.home.join("skills/sample").exists());
        assert_eq!(fs::read(outside.join("keep")).unwrap(), b"untouched");
        assert_eq!(fs::read_dir(f.home.join("skills")).unwrap().count(), 0);
        #[cfg(windows)]
        fs::remove_dir(&link).unwrap();
        #[cfg(not(windows))]
        fs::remove_file(&link).unwrap();
        assert!(install_at_home(
            &f.home,
            None,
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin
        )
        .is_ok());
    }

    #[test]
    fn sr02_overlapping_refresh_and_install_share_managed_operations() {
        let f = Arc::new(Fixture::new());
        prepare_home(&f.home).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(6));
        let workers = (0..6)
            .map(|_| {
                let f = f.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    f.list(true)
                })
            })
            .collect::<Vec<_>>();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        for result in &results {
            assert!(result.error.is_none());
            assert_eq!(result.fetched_at, results[0].fetched_at);
        }
        let lock = home_lock(&fs::canonicalize(&f.home).unwrap()).unwrap();
        assert_eq!(lock.refresh_generation.load(Ordering::Acquire), 1);
        let workers = (0..4)
            .map(|_| {
                let f = f.clone();
                std::thread::spawn(move || {
                    install_at_home(
                        &f.home,
                        None,
                        "sample",
                        "skills/.curated/sample",
                        None,
                        &f.origin,
                    )
                    .unwrap()
                })
            })
            .collect::<Vec<_>>();
        let destinations = workers
            .into_iter()
            .map(|worker| worker.join().unwrap().destination)
            .collect::<Vec<_>>();
        assert!(destinations
            .iter()
            .all(|destination| destination == &destinations[0]));
        assert_eq!(fs::read_dir(f.home.join("skills")).unwrap().count(), 1);
    }

    #[test]
    fn sr03_explicit_local_source_is_labelled_and_can_install_without_network() {
        let f = Fixture::new();
        let local_source = f.root.join("remote");
        let result = list_at_home(
            &f.home,
            Some(&local_source),
            false,
            "https://example.invalid/no-repository",
        )
        .unwrap();
        assert_eq!(result.source, "local-source");
        assert!(result.fetched_at.is_none());
        assert!(!f.home.join("vendor_imports").exists());
        let installed = install_at_home(
            &f.home,
            Some(&local_source),
            "sample",
            "skills/.curated/sample",
            None,
            &f.origin,
        )
        .unwrap();
        assert!(Path::new(&installed.skill.path).is_file());
        assert!(!f.home.join("vendor_imports").exists());
    }
}
