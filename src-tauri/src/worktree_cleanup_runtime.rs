//! Native two-phase automatic cleanup. Candidate ordering is delegated to the verified TS planner;
//! every destructive boundary re-reads native identity, protocol and filesystem protections.
use crate::{
    git,
    local_environment_setup::SetupState,
    state::DesktopStateManager,
    worktree_archive_queue::{ArchiveQueueState, AutomaticClaim, FinishOutcome},
    worktree_inventory::{self, ManagedWorktreeRecord},
    worktree_preferences::{self, WorktreePreferences},
    AppState,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const MIGRATION_KEY: &str = "electron-worktree-cleanup-buffer-start-ms";
const HOST: &str = "local";
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
fn path_key(path: &str) -> String {
    let value = crate::state::normalize_fs_path(path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}
fn within(child: &str, parent: &str) -> bool {
    let child = path_key(child);
    let parent = path_key(parent);
    child == parent || child.starts_with(&format!("{parent}/"))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    owner: String,
    connection: u64,
    service: u64,
}
async fn identity(state: &AppState) -> Result<Identity, String> {
    if !state.app_server.get_status().await.connected {
        return Err("清理服务未连接。".into());
    }
    let connection = state.app_server.connection_generation().await;
    state.app_server.require_generation(connection).await?;
    let account = state
        .app_server
        .isolated_call(connection, "account/read", json!({"refreshToken":false}))
        .await?;
    if account["account"].is_null() && account["requiresOpenaiAuth"] != false {
        return Err("清理账号不可用。".into());
    }
    let owner = if account.pointer("/account/type").and_then(Value::as_str) == Some("apiKey")
        || account["requiresOpenaiAuth"] == false
    {
        "apikey".to_owned()
    } else {
        let principal = state
            .chatgpt_service
            .identity(
                &format!("worktree-cleanup-{}", uuid::Uuid::new_v4()),
                |method, params| state.app_server.isolated_call(connection, method, params),
            )
            .await
            .map_err(|error| format!("无法确认清理账号：{}", error.message))?;
        json!([principal.account_id, principal.user_id]).to_string()
    };
    state.app_server.require_generation(connection).await?;
    Ok(Identity {
        owner,
        connection,
        service: state.chatgpt_service.generation(),
    })
}

#[derive(Clone)]
struct Snapshot {
    records: Vec<ManagedWorktreeRecord>,
    preferences: WorktreePreferences,
    roots: Vec<String>,
    pins: Vec<String>,
    metadata: Map<String, Value>,
    protected: Vec<String>,
    now: u64,
    migration: bool,
    warnings: Vec<String>,
    attachment_generations: HashMap<String, u64>,
}
impl Snapshot {
    fn input(&self) -> Value {
        json!({
            "records":self.records.iter().map(|record|json!({"path":record.path,"ownerThreadId":record.owner_thread_id,"createdAtMs":record.created_at_ms})).collect::<Vec<_>>(),
            "keepCount":self.preferences.keep_count,"threadMetadataById":self.metadata,"pinnedThreadIds":self.pins,
            "protectedWorktreeDirs":self.protected,"nowMs":self.now,"protectPreMigrationOwnerlessWorktrees":self.migration
        })
    }
    fn eligible(&self, record: &ManagedWorktreeRecord) -> bool {
        if record.owner_read_failed
            || self
                .protected
                .iter()
                .any(|path| path_key(path) == path_key(&record.path))
        {
            return false;
        }
        if let Some(owner) = &record.owner_thread_id {
            !self.pins.contains(owner)
                && self
                    .metadata
                    .get(owner)
                    .and_then(|value| value["isInProgress"].as_bool())
                    != Some(true)
        } else {
            !record.created_at_ms.is_some_and(|created| {
                self.now.saturating_sub(created) < 3_600_000
                    || self.migration && created < 1_771_632_000_000
            })
        }
    }
    fn eligible_count(&self) -> usize {
        self.records
            .iter()
            .filter(|record| self.eligible(record))
            .count()
    }
}
#[derive(Clone)]
struct Context {
    claim: AutomaticClaim,
    identity: Identity,
    snapshot: Snapshot,
    running: bool,
}
#[derive(Default)]
struct Runtime {
    initialized: bool,
    contexts: HashMap<String, Context>,
    active_operations: HashMap<String, String>,
    pending_finishes: HashMap<String, (AutomaticClaim, FinishOutcome)>,
    protected: HashSet<String>,
    protected_repositories: HashMap<String, u32>,
    attachment_generations: HashMap<String, u64>,
    attaching: HashMap<String, u32>,
    deleting: HashSet<String>,
}
#[derive(Clone, Default)]
pub struct WorktreeCleanupRuntime {
    queue: Arc<ArchiveQueueState>,
    inner: Arc<Mutex<Runtime>>,
}
pub struct SourceProtection {
    inner: Arc<Mutex<Runtime>>,
    repository: String,
}
impl Drop for SourceProtection {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.inner.lock() {
            if let Some(count) = runtime.protected_repositories.get_mut(&self.repository) {
                *count -= 1;
                if *count == 0 {
                    runtime.protected_repositories.remove(&self.repository);
                }
            }
        }
    }
}
pub struct AttachmentProtection {
    inner: Arc<Mutex<Runtime>>,
    path: String,
}
impl Drop for AttachmentProtection {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.inner.lock() {
            if let Some(count) = runtime.attaching.get_mut(&self.path) {
                *count -= 1;
                if *count == 0 {
                    runtime.attaching.remove(&self.path);
                }
            }
            let generation = runtime
                .attachment_generations
                .entry(self.path.clone())
                .or_default();
            *generation = generation.saturating_add(1);
        }
    }
}
struct DeletionProtection {
    inner: Arc<Mutex<Runtime>>,
    path: String,
}
impl Drop for DeletionProtection {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.inner.lock() {
            runtime.deleting.remove(&self.path);
        }
    }
}

fn common_repository(cwd: &str) -> Result<String, String> {
    let mut command = std::process::Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    for key in [
        "GIT_DIR",
        "GIT_COMMON_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
    ] {
        command.env_remove(key);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("无法确认创建源仓库身份，未解除保护。".into());
    }
    let path = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    let path = std::fs::canonicalize(path.trim()).map_err(|error| error.to_string())?;
    Ok(path_key(&path.to_string_lossy()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreparation {
    pub token: String,
    pub input: Value,
    pub warnings: Vec<String>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub deleted: Vec<git::WorktreeRemovalResult>,
    pub retained: Vec<String>,
    pub errors: Vec<String>,
}

fn pending_archive_owners(entries: &[Value], owner: &str, host: &str) -> HashSet<String> {
    entries
        .iter()
        .filter(|entry| {
            entry["kind"] != "automatic"
                && entry["owner"].as_str() == Some(owner)
                && entry["hostId"].as_str() == Some(host)
                && entry["phase"] != "completed"
        })
        .filter_map(|entry| entry["threadId"].as_str().map(str::to_owned))
        .collect()
}

fn native_protected(
    record: &ManagedWorktreeRecord,
    workspaces: &[String],
    exact: &HashSet<String>,
) -> bool {
    exact.contains(&path_key(&record.path))
        || workspaces.iter().any(|root| within(root, &record.path))
}

fn workspace_roots(state: &DesktopStateManager) -> Result<Vec<String>, String> {
    let raw = state.get_value("electron-saved-workspace-roots");
    if !raw.is_null()
        && !raw
            .as_array()
            .is_some_and(|roots| roots.iter().all(Value::is_string))
    {
        return Err("项目根目录记录不可确认，保留工作树。".into());
    }
    let mut roots = state
        .list_workspace_roots()
        .into_iter()
        .map(|root| root.path)
        .collect::<Vec<_>>();
    if let Some(projects) = state.sidebar_project_membership()["localProjects"].as_array() {
        for project in projects {
            if let Some(paths) = project["rootPaths"].as_array() {
                roots.extend(paths.iter().filter_map(Value::as_str).map(str::to_owned));
            }
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}
fn read_pins(state: &DesktopStateManager) -> Result<Vec<String>, String> {
    let raw = state.get_value("pinned-thread-ids");
    if !raw.is_null()
        && !raw
            .as_array()
            .is_some_and(|ids| ids.iter().all(Value::is_string))
    {
        return Err("置顶记录不可确认，保留工作树。".into());
    }
    let mut pins = state.list_pinned_threads();
    pins.sort();
    pins.dedup();
    Ok(pins)
}
fn migration(state: &DesktopStateManager, now: u64) -> Result<bool, String> {
    let value = state.get_value(MIGRATION_KEY);
    let start = if let Some(start) = value.as_u64().filter(|start| *start > 0) {
        start
    } else {
        let written = state.update_value_persisted(MIGRATION_KEY, |current| {
            Ok(json!(current
                .as_u64()
                .filter(|start| *start > 0)
                .unwrap_or(now)))
        })?;
        written.as_u64().ok_or("迁移保护起点未保存。")?
    };
    Ok(now < start.saturating_add(432_000_000))
}
fn supports_owners(version: Option<&str>) -> bool {
    let Some(version) = version else {
        return false;
    };
    if version == "0.0.0" {
        return true;
    }
    let version = version.split('+').next().unwrap_or(version);
    let (core, suffix) = version
        .split_once('-')
        .map(|(core, suffix)| (core, Some(suffix)))
        .unwrap_or((version, None));
    let Ok(parts) = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
    else {
        return false;
    };
    if parts.len() != 3 {
        return false;
    }
    if parts.as_slice() != [0, 162, 0] {
        return parts.as_slice() > [0, 162, 0].as_slice();
    }
    suffix.is_none_or(|suffix| {
        suffix == "alpha.1"
            || suffix
                .strip_prefix("alpha.")
                .and_then(|value| value.parse::<u64>().ok())
                .is_some_and(|value| value >= 1)
            || suffix.starts_with("beta.")
            || suffix.starts_with("rc.")
    })
}

fn thread_metadata(thread: &Value) -> Value {
    let updated = thread["updatedAt"]
        .as_f64()
        .map(|value| value * 1000.0)
        .filter(|value| value.is_finite());
    let file_modified = thread["path"]
        .as_str()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_secs_f64() * 1000.0)
        .filter(|value| value.is_finite());
    let timestamp = match (updated, file_modified) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (left, right) => left.or(right),
    };
    let status = thread.pointer("/status/type").and_then(Value::as_str);
    json!({"updatedAtMs":timestamp,"isInProgress":status==Some("active") || status.is_none(),"cwd":thread["cwd"],"readFailed":false})
}

async fn protocol<F, Fut>(
    records: &[ManagedWorktreeRecord],
    pins: &[String],
    supports_owners: bool,
    call: F,
) -> Result<(Map<String, Value>, Vec<String>, Vec<String>), String>
where
    F: Fn(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut ids = records
        .iter()
        .filter_map(|record| record.owner_thread_id.clone())
        .chain(pins.iter().cloned())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    let mut metadata = Map::new();
    let mut protected = Vec::new();
    let mut warnings = Vec::new();
    for id in ids {
        let result = call("thread/read", json!({"threadId":id,"includeTurns":false})).await;
        let value = match result {
            Ok(value)
                if value.pointer("/thread/id").and_then(Value::as_str) == Some(id.as_str()) =>
            {
                thread_metadata(&value["thread"])
            }
            _ if pins.contains(&id) => {
                return Err("置顶聊天元数据不可确认，本轮不删除工作树。".into())
            }
            _ => {
                warnings.push(format!("聊天 {id} 元数据不可读，保护其工作树。"));
                json!({"updatedAtMs":null,"isInProgress":true,"cwd":null,"readFailed":true})
            }
        };
        if pins.contains(&id) {
            let cwd = value["cwd"]
                .as_str()
                .ok_or("置顶聊天缺少目录，未删除工作树。")?;
            {
                for record in records {
                    if within(cwd, &record.path) {
                        protected.push(record.path.clone());
                    }
                }
            }
        }
        metadata.insert(id, value);
    }
    // Protect active conversations even when their private owner metadata was lost.
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    loop {
        let page=call("thread/list",json!({"archived":false,"cursor":cursor,"limit":100,"modelProviders":null,"sortKey":"updated_at","sourceKinds":null,"useStateDbOnly":true})).await?;
        let rows = page["data"]
            .as_array()
            .ok_or("活动聊天列表结构无效，未删除。")?;
        for row in rows {
            if row.pointer("/status/type").and_then(Value::as_str) == Some("active") {
                let cwd = row["cwd"].as_str().ok_or("活动聊天缺少目录，未删除。")?;
                for record in records {
                    if within(cwd, &record.path) {
                        protected.push(record.path.clone());
                    }
                }
            }
        }
        cursor = match page.get("nextCursor") {
            Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.clone()),
            _ => return Err("活动聊天分页游标无效。".into()),
        };
        let Some(next) = &cursor else {
            break;
        };
        if !seen.insert(next.clone()) {
            return Err("活动聊天分页重复，未删除。".into());
        }
    }
    for record in records {
        if record.owner_read_failed {
            protected.push(record.path.clone());
            warnings.push(format!(
                "保护增强：{} 的私有owner读取失败，未降级为可删ownerless。",
                record.path
            ));
            continue;
        }
        if supports_owners {
            let mut cursor: Option<String> = None;
            let mut seen = HashSet::new();
            let mut other = false;
            let mut failed = false;
            loop {
                let result=call("thread/attachmentOwner/list",json!({"attachmentType":"worktree","identityKey":record.path,"archived":false,"cursor":cursor,"limit":100})).await;
                let Ok(page) = result else {
                    failed = true;
                    break;
                };
                let Some(rows) = page["data"].as_array() else {
                    failed = true;
                    break;
                };
                for owner in rows {
                    let Some(id) = owner["threadId"].as_str() else {
                        failed = true;
                        break;
                    };
                    let Some(archived) = owner["archived"].as_bool() else {
                        failed = true;
                        break;
                    };
                    if !archived && Some(id) != record.owner_thread_id.as_deref() {
                        other = true;
                    }
                }
                if failed || other {
                    break;
                }
                cursor = match page.get("nextCursor") {
                    Some(Value::Null) => None,
                    Some(Value::String(value)) => Some(value.clone()),
                    _ => {
                        failed = true;
                        break;
                    }
                };
                let Some(next) = &cursor else {
                    break;
                };
                if !seen.insert(next.clone()) {
                    failed = true;
                    break;
                }
            }
            if other {
                protected.push(record.path.clone());
            }
            if failed {
                warnings.push(format!(
                    "{} attachment owner查询为unknown；按官方仅true阻断，其他保护仍重验。",
                    record.path
                ));
            }
        }
    }
    protected.sort();
    protected.dedup();
    Ok((metadata, protected, warnings))
}

impl WorktreeCleanupRuntime {
    fn initialize(&self, state: &DesktopStateManager) -> Result<(), String> {
        let mut runtime = self.inner.lock().map_err(|error| error.to_string())?;
        if !runtime.initialized {
            self.queue.recover_startup(state)?;
            runtime.initialized = true;
        }
        Ok(())
    }
    pub fn reopen_window(&self, window: &str) {
        self.queue.reopen_window(window);
    }
    /// Protection enhancement: all linked worktrees in this repository remain protected
    /// until creation, owner registration and setup have left the native command.
    pub fn protect_source_repository(&self, cwd: &str) -> Result<SourceProtection, String> {
        let repository = common_repository(cwd)?;
        *self
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .protected_repositories
            .entry(repository.clone())
            .or_default() += 1;
        Ok(SourceProtection {
            inner: self.inner.clone(),
            repository,
        })
    }
    pub fn is_newborn(&self, path: &str) -> bool {
        self.inner
            .lock()
            .is_ok_and(|runtime| runtime.protected.contains(&path_key(path)))
    }
    pub fn attachment_changed(&self, path: &str) {
        if let Ok(mut runtime) = self.inner.lock() {
            let generation = runtime
                .attachment_generations
                .entry(path_key(path))
                .or_default();
            *generation = generation.saturating_add(1);
        }
    }
    pub fn protect_attachment(&self, path: &str) -> Result<AttachmentProtection, String> {
        let path = path_key(path);
        let mut runtime = self.inner.lock().map_err(|error| error.to_string())?;
        if runtime.deleting.contains(&path) {
            return Err("工作树清理正在进行，稍后重试附件操作。".into());
        }
        *runtime.attaching.entry(path.clone()).or_default() += 1;
        let generation = runtime
            .attachment_generations
            .entry(path.clone())
            .or_default();
        *generation = generation.saturating_add(1);
        Ok(AttachmentProtection {
            inner: self.inner.clone(),
            path,
        })
    }
    fn protect_deletion(&self, path: &str) -> Result<DeletionProtection, String> {
        let path = path_key(path);
        let mut runtime = self.inner.lock().map_err(|error| error.to_string())?;
        if runtime.deleting.contains(&path) || runtime.attaching.contains_key(&path) {
            return Err("工作树附件或清理操作正在进行，保留工作树。".into());
        }
        runtime.deleting.insert(path.clone());
        Ok(DeletionProtection {
            inner: self.inner.clone(),
            path,
        })
    }
    pub fn protect_worktree(&self, path: &str) {
        if let Ok(mut runtime) = self.inner.lock() {
            runtime.protected.insert(path_key(path));
        }
    }
    pub fn release_worktree(&self, path: &str) {
        if let Ok(mut runtime) = self.inner.lock() {
            runtime.protected.remove(&path_key(path));
        }
    }
    pub async fn request_cleanup(&self, state: &AppState) -> Result<(), String> {
        self.initialize(&state.desktop_state)?;
        let Ok(owner) = identity(state).await else {
            return Ok(());
        };
        self.queue.reopen_host(HOST);
        self.queue
            .enqueue(&state.desktop_state, &owner.owner, HOST)?;
        Ok(())
    }
    async fn snapshot(&self, state: &AppState, identity: &Identity) -> Result<Snapshot, String> {
        state
            .app_server
            .require_generation(identity.connection)
            .await?;
        let preferences = worktree_preferences::read(&state.desktop_state, HOST)?.preferences;
        let roots =
            git::managed_worktree_roots(&state.desktop_state.get_value(git::WORKTREE_ROOT_KEY))?;
        let roots_scan = roots.clone();
        let inventory =
            tokio::task::spawn_blocking(move || worktree_inventory::collect(&roots_scan))
                .await
                .map_err(|error| error.to_string())??;
        let now = now_ms();
        let pins = read_pins(&state.desktop_state)?;
        let workspaces = workspace_roots(&state.desktop_state)?;
        let protected_native = self
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .protected
            .clone();
        let mut protected = inventory
            .records
            .iter()
            .filter(|record| native_protected(record, &workspaces, &protected_native))
            .map(|record| record.path.clone())
            .collect::<Vec<_>>();
        let status = state.app_server.get_status().await;
        let (metadata, protocol_protected, mut warnings) = protocol(
            &inventory.records,
            &pins,
            supports_owners(status.app_server_version.as_deref()),
            |method, params| {
                state
                    .app_server
                    .isolated_call(identity.connection, method, params)
            },
        )
        .await?;
        let protected_repositories = self
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .protected_repositories
            .keys()
            .cloned()
            .collect::<HashSet<_>>();
        if !protected_repositories.is_empty() {
            for record in &inventory.records {
                match common_repository(&record.repo_path) {
                    Ok(repository) if protected_repositories.contains(&repository) => {
                        protected.push(record.path.clone())
                    }
                    Err(error) => {
                        protected.push(record.path.clone());
                        warnings.push(error);
                    }
                    _ => {}
                }
            }
        }
        let (latest_exact, attachment_generations) = {
            let runtime = self.inner.lock().map_err(|error| error.to_string())?;
            let mut exact = runtime.protected.clone();
            exact.extend(runtime.attaching.keys().cloned());
            let generations = inventory
                .records
                .iter()
                .map(|record| {
                    let key = path_key(&record.path);
                    let generation = runtime
                        .attachment_generations
                        .get(&key)
                        .copied()
                        .unwrap_or(0);
                    (key, generation)
                })
                .collect::<HashMap<_, _>>();
            (exact, generations)
        };
        protected.extend(
            inventory
                .records
                .iter()
                .filter(|record| native_protected(record, &workspaces, &latest_exact))
                .map(|record| record.path.clone()),
        );
        // Automatic cleanup must not compete with pending thread/attachment archival.
        // Preserve those foreign entries; only their owner/host/thread protection is consumed.
        let pending_archive = pending_archive_owners(
            &self.queue.read(&state.desktop_state)?,
            &identity.owner,
            HOST,
        );
        protected.extend(
            inventory
                .records
                .iter()
                .filter(|record| {
                    record
                        .owner_thread_id
                        .as_ref()
                        .is_some_and(|owner| pending_archive.contains(owner))
                })
                .map(|record| record.path.clone()),
        );
        protected.extend(protocol_protected);
        protected.sort();
        protected.dedup();
        warnings.extend(
            inventory
                .errors
                .iter()
                .map(|error| format!("{} {}：{}", error.path, error.stage, error.message)),
        );
        // A skipped filesystem candidate is never reconstructed from renderer input.
        state
            .app_server
            .require_generation(identity.connection)
            .await?;
        if read_pins(&state.desktop_state)? != pins
            || workspace_roots(&state.desktop_state)? != workspaces
            || worktree_preferences::read(&state.desktop_state, HOST)?.preferences != preferences
        {
            return Err("清理采集期间置顶、项目或偏好变化，保留工作树等待重试。".into());
        }
        let migration = if inventory.records.len() > preferences.keep_count as usize {
            migration(&state.desktop_state, now)?
        } else {
            false
        };
        Ok(Snapshot {
            records: inventory.records,
            preferences,
            roots,
            pins,
            metadata,
            protected,
            now,
            migration,
            warnings,
            attachment_generations,
        })
    }
    pub async fn prepare(
        &self,
        state: &AppState,
        window: &str,
    ) -> Result<Option<CleanupPreparation>, String> {
        self.initialize(&state.desktop_state)?;
        self.retry_pending(&state.desktop_state)?;
        let Ok(identity) = identity(state).await else {
            return Ok(None);
        };
        let Some(claim) = self.queue.claim(
            &state.desktop_state,
            &identity.owner,
            HOST,
            window,
            now_ms(),
        )?
        else {
            return Ok(None);
        };
        let preferences = match worktree_preferences::read(&state.desktop_state, HOST) {
            Ok(value) => value,
            Err(error) => {
                self.finish_claim(&state.desktop_state, &claim, FinishOutcome::Failed)?;
                return Err(error);
            }
        };
        if !preferences.preferences.auto_cleanup_enabled {
            self.finish_claim(&state.desktop_state, &claim, FinishOutcome::Completed)?;
            return Ok(None);
        }
        let snapshot = match self.snapshot(state, &identity).await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                self.finish_claim(&state.desktop_state, &claim, FinishOutcome::Failed)?;
                return Err(error);
            }
        };
        if !snapshot.preferences.auto_cleanup_enabled {
            self.finish_claim(&state.desktop_state, &claim, FinishOutcome::Completed)?;
            return Ok(None);
        }
        if let Err(error) = claim.check() {
            self.finish_claim(&state.desktop_state, &claim, FinishOutcome::Cancelled)?;
            return Err(error);
        }
        let token = claim.token.clone();
        let result = CleanupPreparation {
            token: token.clone(),
            input: snapshot.input(),
            warnings: snapshot.warnings.clone(),
        };
        self.inner
            .lock()
            .map_err(|error| error.to_string())?
            .contexts
            .insert(
                token,
                Context {
                    claim,
                    identity,
                    snapshot,
                    running: false,
                },
            );
        Ok(Some(result))
    }
    async fn revalidate(
        &self,
        state: &AppState,
        context: &Context,
        record: &ManagedWorktreeRecord,
    ) -> Result<(), String> {
        context.claim.check()?;
        validate_identity(&context.identity, &identity(state).await?)?;
        let current = self.snapshot(state, &context.identity).await?;
        validate_identity(&context.identity, &identity(state).await?)?;
        validate_current(&context.snapshot, &current, record)?;
        context.claim.check()?;
        Ok(())
    }
    pub async fn execute(
        &self,
        state: &AppState,
        setup: &SetupState,
        window: &str,
        token: &str,
        candidate_paths: Vec<String>,
    ) -> Result<CleanupReport, String> {
        let context = {
            let mut runtime = self.inner.lock().map_err(|error| error.to_string())?;
            let context = runtime
                .contexts
                .get_mut(token)
                .ok_or("清理准备记录不存在。")?;
            if context.claim.owner_window != window || context.running {
                return Err("清理令牌不属于当前窗口或已经执行。".into());
            }
            context.running = true;
            context.clone()
        };
        let result = self
            .execute_context(state, setup, &context, candidate_paths)
            .await;
        let outcome = if context.claim.is_cancelled() {
            FinishOutcome::Cancelled
        } else if result.as_ref().is_ok_and(|report| report.errors.is_empty()) {
            FinishOutcome::Completed
        } else {
            FinishOutcome::Failed
        };
        self.finish_claim(&state.desktop_state, &context.claim, outcome)?;
        result
    }
    async fn execute_context(
        &self,
        state: &AppState,
        setup: &SetupState,
        context: &Context,
        candidates: Vec<String>,
    ) -> Result<CleanupReport, String> {
        context.claim.check()?;
        validate_candidates(&context.snapshot, &candidates)?;
        let mut report = CleanupReport::default();
        let handle = tokio::runtime::Handle::current();
        for path in candidates {
            let record = context
                .snapshot
                .records
                .iter()
                .find(|record| record.path == path)
                .ok_or("清理候选不在原生准备清单。")?;
            let _deletion = match self.protect_deletion(&record.path) {
                Ok(lease) => lease,
                Err(error) => {
                    report.retained.push(path);
                    report.errors.push(error);
                    continue;
                }
            };
            if let Err(error) = self.revalidate(state, context, record).await {
                report.retained.push(path);
                report.errors.push(error);
                break;
            }
            let operation_id = format!("cleanup:{}", uuid::Uuid::new_v4());
            self.inner
                .lock()
                .map_err(|error| error.to_string())?
                .active_operations
                .insert(context.claim.token.clone(), operation_id.clone());
            let operation = setup.prepare_operation(&context.claim.owner_window, &operation_id)?;
            let shell =
                Some(crate::desktop_open::preferences(&state.desktop_state).preferred_shell);
            let result = tokio::task::block_in_place(|| {
                git::delete_worktree_with_guard(
                    &record.path,
                    Some(record.repo_path.clone()),
                    operation,
                    shell,
                    git::WorktreeRemovalReason::AutomaticCleanup,
                    &|| handle.block_on(self.revalidate(state, context, record)),
                )
            });
            self.inner
                .lock()
                .map_err(|error| error.to_string())?
                .active_operations
                .remove(&context.claim.token);
            match result {
                Ok(result) => report.deleted.push(result),
                Err(error) => {
                    report.retained.push(path);
                    report.errors.push(error);
                    continue;
                }
            }
        }
        Ok(report)
    }
    fn finish_claim(
        &self,
        state: &DesktopStateManager,
        claim: &AutomaticClaim,
        outcome: FinishOutcome,
    ) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|error| error.to_string())?
            .pending_finishes
            .insert(claim.token.clone(), (claim.clone(), outcome));
        self.queue.finish(state, claim, outcome, now_ms())?;
        let mut runtime = self.inner.lock().map_err(|error| error.to_string())?;
        runtime.pending_finishes.remove(&claim.token);
        runtime.contexts.remove(&claim.token);
        runtime.active_operations.remove(&claim.token);
        Ok(())
    }
    fn retry_pending(&self, state: &DesktopStateManager) -> Result<(), String> {
        let pending = self
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .pending_finishes
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for (claim, outcome) in pending {
            self.finish_claim(state, &claim, outcome)?;
        }
        Ok(())
    }
    pub fn cancel_token(
        &self,
        state: &DesktopStateManager,
        setup: &SetupState,
        window: &str,
        token: &str,
    ) -> Result<(), String> {
        let context = self
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .contexts
            .get(token)
            .cloned();
        let Some(context) = context else {
            return Ok(());
        };
        if context.claim.owner_window != window {
            return Err("清理令牌不属于当前窗口。".into());
        }
        context.claim.cancel();
        if let Some(operation) = self
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .active_operations
            .get(token)
            .cloned()
        {
            setup.cancel(window, &operation);
        }
        if !context.running {
            self.finish_claim(state, &context.claim, FinishOutcome::Cancelled)?;
        }
        Ok(())
    }
    pub fn cancel_window(&self, state: &DesktopStateManager, setup: &SetupState, window: &str) {
        self.queue.close_window(window);
        self.cancel_matching(state, setup, |context| context.claim.owner_window == window);
    }
    pub fn invalidate(&self, state: &DesktopStateManager, setup: &SetupState) {
        self.queue.cancel_host(HOST);
        self.cancel_matching(state, setup, |_| true);
    }
    fn cancel_matching(
        &self,
        state: &DesktopStateManager,
        setup: &SetupState,
        matches: impl Fn(&Context) -> bool,
    ) {
        let contexts = self
            .inner
            .lock()
            .map(|runtime| {
                runtime
                    .contexts
                    .values()
                    .filter(|context| matches(context))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for context in contexts {
            if let Ok(runtime) = self.inner.lock() {
                if let Some(operation) = runtime.active_operations.get(&context.claim.token) {
                    setup.cancel(&context.claim.owner_window, operation);
                }
            }
            if !context.running {
                if let Err(error) =
                    self.finish_claim(state, &context.claim, FinishOutcome::Cancelled)
                {
                    eprintln!("工作树清理取消状态尚未保存：{error}");
                }
            }
        }
    }
}

fn validate_identity(expected: &Identity, actual: &Identity) -> Result<(), String> {
    if expected != actual {
        Err("清理连接或账号已变化，保留工作树。".into())
    } else {
        Ok(())
    }
}

fn validate_current(
    prepared: &Snapshot,
    current: &Snapshot,
    record: &ManagedWorktreeRecord,
) -> Result<(), String> {
    let key = path_key(&record.path);
    if current
        .attachment_generations
        .get(&key)
        .copied()
        .unwrap_or(0)
        != prepared
            .attachment_generations
            .get(&key)
            .copied()
            .unwrap_or(0)
    {
        return Err("工作树附件身份代次已变化，保留工作树。".into());
    }
    if current.preferences != prepared.preferences
        || current.roots != prepared.roots
        || !current.preferences.auto_cleanup_enabled
    {
        return Err("清理偏好或目录作用域已变化，保留工作树。".into());
    }
    if current.pins.iter().any(|pin| !prepared.pins.contains(pin)) {
        return Err("新增置顶聊天，保留工作树并等待下一轮。".into());
    }
    let found = current
        .records
        .iter()
        .find(|candidate| path_key(&candidate.path) == path_key(&record.path))
        .ok_or("候选工作树已丢失或身份不可确认。")?;
    if found.identity_token != record.identity_token
        || found.owner_thread_id != record.owner_thread_id
        || found.git_dir != record.git_dir
        || found.created_at_ms != record.created_at_ms
        || !current.eligible(found)
    {
        return Err("候选工作树身份、owner或保护条件已变化，保留。".into());
    }
    if current.eligible_count() <= current.preferences.keep_count as usize {
        return Err("剩余可清理工作树已达到保留数，停止删除。".into());
    }
    Ok(())
}

fn validate_candidates(snapshot: &Snapshot, candidates: &[String]) -> Result<(), String> {
    let eligible = snapshot
        .records
        .iter()
        .filter(|record| snapshot.eligible(record))
        .collect::<Vec<_>>();
    let count = if snapshot.records.len() <= snapshot.preferences.keep_count as usize {
        0
    } else {
        eligible
            .len()
            .saturating_sub(snapshot.preferences.keep_count as usize)
    };
    let selected = candidates.iter().collect::<HashSet<_>>();
    if selected.len() != candidates.len()
        || candidates.len() != count
        || candidates
            .iter()
            .any(|path| !eligible.iter().any(|record| record.path == *path))
    {
        return Err("清理候选与原生保护清单或保留额度不一致，未删除。".into());
    }
    // Validate the primary ordering/cutoff natively; localeCompare ties remain the TS planner's job.
    let rank = |record: &ManagedWorktreeRecord| {
        if let Some(owner) = &record.owner_thread_id {
            (
                1u8,
                snapshot
                    .metadata
                    .get(owner)
                    .and_then(|metadata| metadata["updatedAtMs"].as_f64())
                    .unwrap_or(0.0),
            )
        } else {
            (
                0,
                record
                    .created_at_ms
                    .map(|value| value as f64)
                    .unwrap_or(9_007_199_254_740_991.0),
            )
        }
    };
    for picked in eligible
        .iter()
        .filter(|record| selected.contains(&record.path))
    {
        if eligible
            .iter()
            .any(|other| !selected.contains(&other.path) && rank(other) < rank(picked))
        {
            return Err("清理候选跳过了更旧工作树，未删除。".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(path: &str, created: u64) -> ManagedWorktreeRecord {
        ManagedWorktreeRecord {
            path: path.into(),
            git_dir: "git".into(),
            repo_path: "repo".into(),
            managed_root: "root".into(),
            owner_thread_id: None,
            owner_read_failed: false,
            created_at_ms: Some(created),
            identity_token: "identity".into(),
        }
    }
    fn snapshot() -> Snapshot {
        Snapshot {
            records: vec![record("old", 10), record("middle", 20), record("new", 30)],
            preferences: WorktreePreferences {
                keep_count: 1,
                ..Default::default()
            },
            roots: vec![],
            pins: vec![],
            metadata: Map::new(),
            protected: vec![],
            now: 10_000_000,
            migration: false,
            warnings: vec![],
            attachment_generations: HashMap::new(),
        }
    }
    #[test]
    fn native_candidates_reject_extra_protected_duplicate_and_newer_paths() {
        let mut value = snapshot();
        assert!(validate_candidates(&value, &["old".into(), "middle".into()]).is_ok());
        for paths in [
            vec!["old".into(), "old".into()],
            vec!["old".into(), "outside".into()],
            vec!["middle".into(), "new".into()],
        ] {
            assert!(validate_candidates(&value, &paths).is_err());
        }
        value.protected.push("old".into());
        assert!(validate_candidates(&value, &["middle".into()]).is_ok());
        assert!(validate_candidates(&value, &["old".into()]).is_err());
        value.records[1].owner_read_failed = true;
        assert!(validate_candidates(&value, &[]).is_ok());
    }
    #[tokio::test]
    async fn protocol_pins_active_paths_and_unknown_owner_semantics() {
        let records = vec![record("/managed/a", 10)];
        let (meta, protected, warnings) = protocol(&records, &[], true, |method, _| {
            std::future::ready(match method {
                "thread/list" => Ok(json!({"data":[],"nextCursor":null})),
                "thread/attachmentOwner/list" => Err("unsupported".into()),
                _ => panic!("unexpected request"),
            })
        })
        .await
        .unwrap();
        assert!(meta.is_empty() && protected.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(protocol(&records, &["pinned".into()], false, |_, _| {
            std::future::ready(Err("unavailable".into()))
        })
        .await
        .is_err());
        let (_,protected,_)=protocol(&records,&[],true,|method,_|std::future::ready(Ok(if method=="thread/list"{json!({"data":[{"cwd":"/managed/a/sub","status":{"type":"active"}}],"nextCursor":null})}else{json!({"data":[{"threadId":"other","archived":false}],"nextCursor":null})}))).await.unwrap();
        assert_eq!(protected, ["/managed/a"]);
    }
    #[test]
    fn protection_clock_boundaries_and_owner_capability() {
        let mut value = snapshot();
        value.now = 3_600_010;
        assert!(value.eligible(&value.records[0]));
        value.now -= 1;
        assert!(!value.eligible(&value.records[0]));
        value.migration = true;
        value.now = 10_000_000;
        assert!(!value.eligible(&value.records[0]));
        assert!(supports_owners(Some("0.162.0-alpha.1")));
        assert!(supports_owners(Some("0.163.0")));
        assert!(!supports_owners(Some("0.162.0-alpha.0")));
        assert!(!supports_owners(Some("0.161.0")));
    }
    #[test]
    fn real_cleanup_final_guard_rechecks_pin_owner_active_and_connection() {
        use std::{
            fs,
            path::Path,
            sync::atomic::{AtomicUsize, Ordering},
        };
        fn run(cwd: &Path, args: &[&str]) {
            let mut command = std::process::Command::new("git");
            command.arg("-C").arg(cwd).args(args);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        for race in ["pin", "owner", "active", "connection"] {
            let root =
                std::env::temp_dir().join(format!("codex-cleanup-guard-{}", uuid::Uuid::new_v4()));
            let repo = root.join("repo");
            let managed = root.join("managed");
            let target = managed.join("one/tree");
            let other = managed.join("two/tree");
            fs::create_dir_all(&repo).unwrap();
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::create_dir_all(other.parent().unwrap()).unwrap();
            run(&repo, &["init", "--quiet"]);
            run(
                &repo,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--allow-empty",
                    "-qm",
                    "fixture",
                ],
            );
            run(
                &repo,
                &[
                    "worktree",
                    "add",
                    "--detach",
                    target.to_str().unwrap(),
                    "HEAD",
                ],
            );
            run(
                &repo,
                &[
                    "worktree",
                    "add",
                    "--detach",
                    other.to_str().unwrap(),
                    "HEAD",
                ],
            );
            let config = target.join(".codex/environments/environment.toml");
            fs::create_dir_all(config.parent().unwrap()).unwrap();
            let script = if cfg!(windows) {
                "[IO.File]::WriteAllText((Join-Path (Get-Location).Path 'cleanup-marker'), 'done')"
            } else {
                "printf done > cleanup-marker"
            };
            fs::write(
                &config,
                format!(
                    "version=1\nname='guard fixture'\n[setup]\nscript=''\n[cleanup]\nscript={}\n",
                    serde_json::to_string(script).unwrap()
                ),
            )
            .unwrap();
            run(&repo, &["config", "extensions.worktreeConfig", "true"]);
            run(
                &target,
                &[
                    "config",
                    "--worktree",
                    "codex.localEnvironmentConfigPath",
                    config.to_str().unwrap(),
                ],
            );
            let records = worktree_inventory::collect(&[managed.to_string_lossy().into_owned()])
                .unwrap()
                .records;
            assert_eq!(records.len(), 2);
            let expected = Snapshot {
                records,
                now: now_ms() + 7_200_000,
                ..snapshot()
            };
            let record = expected
                .records
                .iter()
                .find(|record| path_key(&record.path) == path_key(&target.to_string_lossy()))
                .unwrap()
                .clone();
            let identity = Identity {
                owner: "fixture".into(),
                connection: 1,
                service: 1,
            };
            let checks = AtomicUsize::new(0);
            let setup = SetupState::default();
            let operation = setup.prepare_operation("guard-fixture", race).unwrap();
            let error = git::delete_worktree_with_guard(
                &record.path,
                Some(record.repo_path.clone()),
                operation,
                None,
                git::WorktreeRemovalReason::AutomaticCleanup,
                &|| {
                    checks.fetch_add(1, Ordering::SeqCst);
                    let mut current = expected.clone();
                    let mut actual_identity = identity.clone();
                    if target.join("cleanup-marker").exists() {
                        match race {
                            "pin" => current.pins.push("new-pin".into()),
                            "owner" => {
                                git::set_worktree_owner_thread(&record.path, "other-owner")?;
                                current.records = worktree_inventory::collect(&[managed
                                    .to_string_lossy()
                                    .into_owned()])?
                                .records;
                            }
                            "active" => current.protected.push(record.path.clone()),
                            "connection" => actual_identity.connection += 1,
                            _ => unreachable!(),
                        }
                    }
                    validate_identity(&identity, &actual_identity)?;
                    validate_current(&expected, &current, &record)
                },
            )
            .unwrap_err();
            assert!(
                target.join("cleanup-marker").exists(),
                "cleanup never ran: {error}"
            );
            assert!(
                checks.load(Ordering::SeqCst) >= 3,
                "final native guard was not reached"
            );
            assert!(target.is_dir(), "{race} race deleted target");
            assert!(error.contains("refs/codex/snapshots/"), "{error}");
            let runtime = WorktreeCleanupRuntime::default();
            let lease = runtime
                .protect_source_repository(repo.to_str().unwrap())
                .unwrap();
            let duplicate = runtime
                .protect_source_repository(target.to_str().unwrap())
                .unwrap();
            assert_eq!(
                runtime
                    .inner
                    .lock()
                    .unwrap()
                    .protected_repositories
                    .values()
                    .next(),
                Some(&2)
            );
            drop(lease);
            assert_eq!(
                runtime
                    .inner
                    .lock()
                    .unwrap()
                    .protected_repositories
                    .values()
                    .next(),
                Some(&1)
            );
            runtime.protect_worktree(&record.path);
            drop(duplicate);
            assert!(native_protected(
                &record,
                &[],
                &runtime.inner.lock().unwrap().protected
            ));
            let mut protected_after_long_setup = expected.clone();
            protected_after_long_setup
                .protected
                .push(record.path.clone());
            assert!(validate_current(&expected, &protected_after_long_setup, &record).is_err());
            runtime.release_worktree(&record.path);
            assert!(!native_protected(
                &record,
                &[],
                &runtime.inner.lock().unwrap().protected
            ));
            assert!(runtime
                .inner
                .lock()
                .unwrap()
                .protected_repositories
                .is_empty());
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn private_finish_retry_never_reexecutes_and_token_cancel_is_window_scoped() {
        use std::fs;
        const MARKER: &str = "CODEX_CLEANUP_RUNTIME_PRIVATE";
        if std::env::var_os(MARKER).is_none() {
            let root = std::env::temp_dir()
                .join(format!("codex-cleanup-persist-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args(["--exact","worktree_cleanup_runtime::tests::private_finish_retry_never_reexecutes_and_token_cancel_is_window_scoped","--nocapture"]).env("CODEX_HOME",&root).env(MARKER,"1");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let output = command.output().unwrap();
            let _ = fs::remove_dir_all(&root);
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let runtime = WorktreeCleanupRuntime::default();
        let state = DesktopStateManager::new();
        let setup = SetupState::default();
        runtime.queue.enqueue(&state, "account", "local").unwrap();
        runtime.queue.enqueue(&state, "account", "remote").unwrap();
        let a = runtime
            .queue
            .claim(&state, "account", "local", "window-a", 0)
            .unwrap()
            .unwrap();
        let b = runtime
            .queue
            .claim(&state, "account", "remote", "window-b", 0)
            .unwrap()
            .unwrap();
        let context = |claim: AutomaticClaim| Context {
            claim,
            identity: Identity {
                owner: "account".into(),
                connection: 1,
                service: 1,
            },
            snapshot: snapshot(),
            running: false,
        };
        runtime
            .inner
            .lock()
            .unwrap()
            .contexts
            .insert(a.token.clone(), context(a.clone()));
        runtime
            .inner
            .lock()
            .unwrap()
            .contexts
            .insert(b.token.clone(), context(b.clone()));
        assert!(runtime
            .cancel_token(&state, &setup, "window-b", &a.token)
            .is_err());
        assert!(!a.is_cancelled());
        runtime
            .cancel_token(&state, &setup, "window-a", &a.token)
            .unwrap();
        assert!(a.is_cancelled());
        assert!(!b.is_cancelled());
        assert!(!runtime
            .inner
            .lock()
            .unwrap()
            .contexts
            .contains_key(&a.token));
        assert!(runtime
            .inner
            .lock()
            .unwrap()
            .contexts
            .contains_key(&b.token));
        let path = crate::state::desktop_global_state_path();
        let saved = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(runtime
            .finish_claim(&state, &b, FinishOutcome::Completed)
            .is_err());
        assert!(runtime
            .inner
            .lock()
            .unwrap()
            .pending_finishes
            .contains_key(&b.token));
        assert!(runtime.retry_pending(&state).is_err());
        assert!(runtime
            .inner
            .lock()
            .unwrap()
            .contexts
            .contains_key(&b.token));
        fs::remove_dir(&path).unwrap();
        fs::write(&path, saved).unwrap();
        runtime.retry_pending(&state).unwrap();
        assert!(runtime.inner.lock().unwrap().pending_finishes.is_empty());
        assert!(!runtime
            .inner
            .lock()
            .unwrap()
            .contexts
            .contains_key(&b.token));
        assert!(runtime
            .queue
            .read(&state)
            .unwrap()
            .iter()
            .all(|entry| entry["hostId"] != "remote"));
        let archives = json!([
            {"id":"pending-thread","kind":"thread","owner":"account","hostId":"local","threadId":"same","phase":"queued","unknown":{"preserve":true}},
            {"id":"pending-attached","kind":"attached","owner":"account","hostId":"local","threadId":"attached","phase":"reattaching"},
            {"id":"other-owner","kind":"thread","owner":"other","hostId":"local","threadId":"different-account","phase":"queued"},
            {"id":"other-host","kind":"attached","owner":"account","hostId":"remote","threadId":"different-host","phase":"running"},
            {"id":"completed-thread","kind":"thread","owner":"account","hostId":"local","threadId":"done","phase":"completed"}
        ]);
        state
            .set_value_persisted(crate::worktree_archive_queue::QUEUE_KEY, archives.clone())
            .unwrap();
        let queued = runtime.queue.read(&state).unwrap();
        let protected = pending_archive_owners(&queued, "account", "local");
        assert_eq!(
            protected,
            HashSet::from(["same".to_string(), "attached".to_string()])
        );
        assert!(pending_archive_owners(&queued, "account", "another-host").is_empty());
        let mut prepared = snapshot();
        prepared.records[0].owner_thread_id = Some("same".into());
        let mut current = prepared.clone();
        current.protected.extend(
            current
                .records
                .iter()
                .filter(|record| {
                    record
                        .owner_thread_id
                        .as_ref()
                        .is_some_and(|owner| protected.contains(owner))
                })
                .map(|record| record.path.clone()),
        );
        assert!(validate_current(&prepared, &current, &prepared.records[0]).is_err());
        assert!(!current.protected.contains(&prepared.records[1].path));
        assert_eq!(
            state.get_value(crate::worktree_archive_queue::QUEUE_KEY),
            archives,
            "protect pending archive owners without consuming foreign records"
        );
    }
    #[test]
    fn rollout_file_mtime_changes_retention_order_with_official_max_timestamp() {
        use std::{
            fs::{self, File, FileTimes},
            time::Duration,
        };
        let root =
            std::env::temp_dir().join(format!("codex-cleanup-mtime-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let a = root.join("a.jsonl");
        let b = root.join("b.jsonl");
        File::create(&a)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(100)))
            .unwrap();
        File::create(&b)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(50)))
            .unwrap();
        let a_meta =
            thread_metadata(&json!({"updatedAt":1,"path":a,"cwd":"a","status":{"type":"idle"}}));
        let b_meta =
            thread_metadata(&json!({"updatedAt":50,"path":b,"cwd":"b","status":{"type":"idle"}}));
        assert_eq!(a_meta["updatedAtMs"], 100_000.0);
        assert_eq!(b_meta["updatedAtMs"], 50_000.0);
        let mut value = snapshot();
        value.records.truncate(2);
        value.records[0].owner_thread_id = Some("a".into());
        value.records[1].owner_thread_id = Some("b".into());
        value.metadata.insert("a".into(), a_meta);
        value.metadata.insert("b".into(), b_meta);
        assert!(validate_candidates(&value, &["middle".into()]).is_ok());
        assert!(validate_candidates(&value, &["old".into()]).is_err());
        assert_eq!(
            thread_metadata(
                &json!({"updatedAt":12,"path":root.join("missing"),"status":{"type":"idle"}})
            )["updatedAtMs"],
            12_000.0
        );
        assert!(
            thread_metadata(&json!({"path":root.join("missing"),"status":{"type":"idle"}}))
                ["updatedAtMs"]
                .is_null()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn attachment_generation_leases_and_newborn_are_independent() {
        let runtime = WorktreeCleanupRuntime::default();
        let path = "/managed/tree";
        runtime.protect_worktree(path);
        assert!(runtime.is_newborn(path));
        let a = runtime.protect_attachment(path).unwrap();
        let b = runtime.protect_attachment(path).unwrap();
        assert_eq!(
            runtime.inner.lock().unwrap().attaching.get(&path_key(path)),
            Some(&2)
        );
        assert!(runtime.protect_deletion(path).is_err());
        drop(a);
        assert!(runtime.is_newborn(path));
        drop(b);
        assert!(runtime.is_newborn(path));
        assert!(!runtime
            .inner
            .lock()
            .unwrap()
            .attaching
            .contains_key(&path_key(path)));
        runtime.release_worktree(path);
        assert!(!runtime.is_newborn(path));
        let deletion = runtime.protect_deletion(path).unwrap();
        assert!(runtime.protect_attachment(path).is_err());
        drop(deletion);
        let prepared = snapshot();
        let mut current = prepared.clone();
        current.attachment_generations.insert(path_key("old"), 1);
        assert!(validate_current(&prepared, &current, &prepared.records[0]).is_err());
        let before = runtime.inner.lock().unwrap().attachment_generations[&path_key(path)];
        runtime.attachment_changed(path);
        assert_eq!(
            runtime.inner.lock().unwrap().attachment_generations[&path_key(path)],
            before + 1
        );
    }
}
