//! Fixed local heartbeat projection (WLR18-24). No migration, enrollment,
//! scheduler startup or logical database writes. WinSQLite read leases can touch
//! existing WAL shared-memory bookkeeping; this is not a zero-byte-write claim.
use crate::chatgpt_service::ServiceIdentity;
use serde::Serialize;
use serde_json::{Map, Value};
use std::{collections::HashSet, fs, io::Read, path::Path};

const INSTALLATION: &str = "electron-automations-installation-id";
const MIGRATION: &str = "electron-automations-habitat-migration-state";
const READ_LIMIT: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkHeartbeatEntry {
    pub kind: String,
    pub status: String,
    pub target_thread_id: String,
}

#[derive(Debug, PartialEq, Eq)]
struct Markers {
    installation: Option<String>,
    status: Option<Value>,
}

fn markers(values: &Map<String, Value>, identity: &ServiceIdentity) -> Result<Markers, String> {
    let installation = match values.get(INSTALLATION) {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        _ => return Err("Work heartbeat installation marker is invalid".into()),
    };
    let migration = match values.get(MIGRATION) {
        None | Some(Value::Null) => None,
        Some(Value::Object(values)) => Some(values),
        _ => return Err("Work heartbeat migration marker is invalid".into()),
    };
    let status = installation
        .as_ref()
        .and_then(|installation| {
            migration.and_then(|values| {
                values.get(&format!(
                    "{}:{}:{installation}",
                    identity.account_id, identity.user_id
                ))
            })
        })
        .cloned();
    Ok(Markers {
        installation,
        status,
    })
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Work heartbeat local file could not be read".into()),
    };
    let mut bytes = Vec::new();
    file.take(READ_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Work heartbeat local file could not be read")?;
    if bytes.len() as u64 > READ_LIMIT {
        return Err("Work heartbeat local file exceeds the read limit".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "Work heartbeat local file is not UTF-8".into())
}

fn number(value: &toml::Value) -> bool {
    value.as_integer().is_some() || value.as_float().is_some_and(f64::is_finite)
}

fn legacy_entry(raw: &str, directory: &str) -> Option<(String, WorkHeartbeatEntry)> {
    let value: toml::Value = toml::from_str(raw).ok()?;
    let table = value.as_table()?;
    let string = |key| table.get(key).and_then(toml::Value::as_str);
    let id = string("id")?;
    if id != directory
        || string("name").is_none()
        || string("prompt").is_none()
        || !number(table.get("created_at")?)
        || !number(table.get("updated_at")?)
    {
        return None;
    }
    if let Some(version) = table.get("version") {
        if !number(version) || !(version.as_integer() == Some(1) || version.as_float() == Some(1.0))
        {
            return None;
        }
    }
    // The source validates its full legacy schema before retaining a heartbeat.
    for key in [
        "rrule",
        "local_environment_config_path",
        "model",
        "plugin_template_id",
        "target_thread_id",
        "model_prompt_sha256",
    ] {
        if table.get(key).is_some_and(|value| !value.is_str()) {
            return None;
        }
    }
    if table
        .get("execution_environment")
        .is_some_and(|value| !matches!(value.as_str(), Some("local" | "worktree")))
        || table.get("reasoning_effort").is_some_and(|value| {
            !matches!(
                value.as_str(),
                Some("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra")
            )
        })
        || table
            .get("notification_policy")
            .is_some_and(|value| value.as_str() != Some("failed_runs_only"))
        || table
            .get("auto_archive")
            .is_some_and(|value| !value.is_bool())
    {
        return None;
    }
    if let Some(cwds) = table.get("cwds") {
        if !cwds
            .as_array()
            .is_some_and(|values| values.iter().all(toml::Value::is_str))
        {
            return None;
        }
    }
    if let Some(target) = table.get("target") {
        let target = target.as_table()?;
        match target.get("type")?.as_str()? {
            "projectless" => {}
            "project" if target.get("project_id").is_some_and(toml::Value::is_str) => {}
            _ => return None,
        }
    }
    if string("kind")? != "heartbeat" {
        return None;
    }
    let status = match string("status")? {
        "DISABLED" => "PAUSED",
        value @ ("ACTIVE" | "PAUSED" | "DELETED") => value,
        _ => return None,
    };
    let thread = string("target_thread_id")?;
    if thread.trim().is_empty() {
        return None;
    }
    Some((
        id.into(),
        WorkHeartbeatEntry {
            kind: "heartbeat".into(),
            status: status.into(),
            target_thread_id: thread.into(),
        },
    ))
}

fn legacy(root: &Path, thread_id: &str) -> Result<Vec<(String, WorkHeartbeatEntry)>, String> {
    let entries = match fs::read_dir(root.join("automations")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => {
            eprintln!(
                "Work heartbeat legacy enumeration failed; using source empty legacy fallback"
            );
            return Ok(Vec::new());
        }
    };
    let mut result = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else {
            eprintln!(
                "Work heartbeat legacy enumeration failed; using source empty legacy fallback"
            );
            return Ok(Vec::new());
        };
        let Ok(file_type) = entry.file_type() else {
            eprintln!(
                "Work heartbeat legacy entry inspection failed; using source empty legacy fallback"
            );
            return Ok(Vec::new());
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(id) = name
            .to_str()
            .filter(|id| !id.is_empty() && *id != "." && *id != ".." && !id.contains(['/', '\\']))
        else {
            continue;
        };
        // en() discards unavailable/unreadable and invalid legacy records.
        let Some(raw) = read_optional(&entry.path().join("automation.toml"))
            .ok()
            .flatten()
        else {
            continue;
        };
        if let Some((id, value)) =
            legacy_entry(&raw, id).filter(|(_, value)| value.target_thread_id == thread_id)
        {
            result.push((id, value));
        }
    }
    Ok(result)
}

pub(crate) fn read_work_heartbeat(
    root: &Path,
    identity: &ServiceIdentity,
    thread_id: &str,
) -> Result<Vec<WorkHeartbeatEntry>, String> {
    if identity.account_id.is_empty()
        || identity.user_id.is_empty()
        || thread_id.is_empty()
        || thread_id.len() > 4096
        || thread_id.chars().any(char::is_control)
    {
        return Err("Work heartbeat identity or thread is invalid".into());
    }
    #[cfg(windows)]
    {
        let flavor = std::env::var("BUILD_FLAVOR")
            .map(Some)
            .or_else(|error| match error {
                std::env::VarError::NotPresent => Ok(None),
                _ => Err("Work heartbeat build flavor is invalid"),
            })?;
        read_at(root, identity, thread_id, flavor.as_deref())
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        Err("Work heartbeat SQLite reader is unsupported on this platform".into())
    }
}

#[cfg(windows)]
fn global_markers(root: &Path, identity: &ServiceIdentity) -> Result<Markers, String> {
    if let Some(db) = win::Database::open_existing(&root.join(".codex-global-state.sqlite"))? {
        db.control("BEGIN")?;
        let rows = db.query("PRAGMA user_version", &[], 1)?;
        match rows.first().and_then(|row| row.first()) {
            Some(win::Cell::Integer(1)) => {
                let rows = db.query(
                    "SELECT key,value FROM settings WHERE scope='global' AND key IN (?,?)",
                    &[INSTALLATION, MIGRATION],
                    2,
                )?;
                let mut values = Map::new();
                for row in rows {
                    let key = row[0]
                        .text()?
                        .ok_or("Work heartbeat settings key is missing")?;
                    let value = row[1]
                        .text()?
                        .ok_or("Work heartbeat settings value is missing")?;
                    if values
                        .insert(
                            key.to_owned(),
                            serde_json::from_str(value)
                                .map_err(|_| "Work heartbeat global setting is invalid JSON")?,
                        )
                        .is_some()
                    {
                        return Err("Work heartbeat global setting is duplicated".into());
                    }
                }
                return markers(&values, identity);
            }
            Some(win::Cell::Integer(0)) => {}
            _ => return Err("Work heartbeat global database version is unsupported".into()),
        }
    }
    let values = match read_optional(&root.join(".codex-global-state.json"))? {
        None => Map::new(),
        Some(raw) => serde_json::from_str::<Value>(&raw)
            .map_err(|_| "Work heartbeat global state is invalid JSON")?
            .as_object()
            .cloned()
            .ok_or("Work heartbeat global state is not an object")?,
    };
    markers(&values, identity)
}

#[cfg(windows)]
fn read_at(
    root: &Path,
    identity: &ServiceIdentity,
    thread_id: &str,
    flavor: Option<&str>,
) -> Result<Vec<WorkHeartbeatEntry>, String> {
    read_at_with(root, identity, thread_id, flavor, || {})
}

#[cfg(windows)]
fn read_at_with(
    root: &Path,
    identity: &ServiceIdentity,
    thread_id: &str,
    flavor: Option<&str>,
    before_verify: impl FnOnce(),
) -> Result<Vec<WorkHeartbeatEntry>, String> {
    let before = global_markers(root, identity)?;
    let migrated = before
        .installation
        .as_ref()
        .zip(before.status.as_ref().and_then(Value::as_str))
        .filter(|(_, status)| matches!(*status, "in_progress" | "complete"));
    let include_legacy = migrated.is_none_or(|(_, status)| status == "in_progress");
    let old = if include_legacy {
        legacy(root, thread_id)?
    } else {
        Vec::new()
    };
    let projected = (|| -> Result<Vec<WorkHeartbeatEntry>, String> {
        let mut result = Vec::new();
        if let Some((installation, _)) = migrated {
            let filename = if flavor.is_some_and(|flavor| !flavor.is_empty() && flavor != "prod") {
                "codex-dev.db"
            } else {
                "codex.db"
            };
            if let Some(db) = win::Database::open_existing(&root.join("sqlite").join(filename))? {
                db.control("BEGIN")?;
                let rows = db.query("SELECT id,kind,status,target_thread_id,remote_host,account_id,user_id,installation_id,legacy_automation_id FROM automations WHERE account_id=? AND user_id=? AND installation_id=?",
                &[&identity.account_id,&identity.user_id,installation],9)?;
                let mut occupied = HashSet::new();
                for row in rows {
                    let id = row[0]
                        .text()?
                        .ok_or("Work heartbeat automation id is missing")?;
                    occupied.insert(id.to_owned());
                    if let Some(id) = row[8].text()? {
                        occupied.insert(id.to_owned());
                    }
                    if row[5].text()? != Some(identity.account_id.as_str())
                        || row[6].text()? != Some(identity.user_id.as_str())
                        || row[7].text()? != Some(installation.as_str())
                    {
                        return Err("Work heartbeat automation owner changed".into());
                    }
                    let kind = row[1]
                        .text()?
                        .ok_or("Work heartbeat automation kind is missing")?;
                    let status = row[2]
                        .text()?
                        .ok_or("Work heartbeat automation status is missing")?;
                    if kind != "heartbeat" || status == "DELETED" {
                        continue;
                    }
                    let target = if let Some(remote) = row[4].text()? {
                        let value: Value = serde_json::from_str(remote)
                            .map_err(|_| "Work heartbeat remote target is invalid")?;
                        for key in ["id", "identity", "threadId"] {
                            if !value
                                .get(key)
                                .and_then(Value::as_str)
                                .is_some_and(|value| !value.is_empty())
                            {
                                return Err("Work heartbeat remote target is incomplete".into());
                            }
                        }
                        if identity.account_id.is_empty()
                            || identity.user_id.is_empty()
                            || installation.is_empty()
                        {
                            continue;
                        }
                        value["threadId"].as_str().unwrap().to_owned()
                    } else {
                        row[3].text()?.unwrap_or("").to_owned()
                    };
                    if !target.is_empty() && target == thread_id {
                        result.push(WorkHeartbeatEntry {
                            kind: kind.into(),
                            status: status.into(),
                            target_thread_id: target,
                        });
                    }
                }
                if include_legacy {
                    for (id, entry) in old.iter().filter(|(id, _)| !occupied.contains(id)) {
                        // G(O(id)) must consult all owners, in the same transaction
                        // as n, including rows not in the current owner's n set.
                        let rows = db.query(
                            "SELECT account_id,user_id,installation_id FROM automations WHERE id=?",
                            &[&id],
                            3,
                        )?;
                        let allowed = match rows.as_slice() {
                            [] => true,
                            [row] if row[0].text()?.is_none() => {
                                row[1].text()?.is_none() && row[2].text()?.is_none()
                            }
                            [row] => {
                                row[0].text()? == Some(identity.account_id.as_str())
                                    && row[1].text()? == Some(identity.user_id.as_str())
                                    && row[2].text()? == Some(installation.as_str())
                            }
                            _ => return Err("Work heartbeat automation id is duplicated".into()),
                        };
                        if allowed {
                            result.push(entry.clone());
                        }
                    }
                }
            } else {
                result.extend(old.iter().map(|(_, entry)| entry.clone()));
            }
        } else {
            result.extend(old.iter().map(|(_, entry)| entry.clone()));
        }
        Ok(result)
    })();
    // F() catches automation database/projection errors and returns the original
    // legacy set, not a partially merged or filtered result. Marker reads remain
    // outside this catch because unknown owner proof must not be guessed.
    let result = projected.unwrap_or_else(|_| {
        eprintln!("Work heartbeat automation database read failed; using source legacy fallback");
        old.into_iter().map(|(_, entry)| entry).collect()
    });
    before_verify();
    if global_markers(root, identity)? != before {
        return Err("Work heartbeat migration owner changed during read".into());
    }
    Ok(result)
}

// Normal SQLite READONLY locking is intentional: WAL reads may update SHM reader
// leases. This prevents logical writes, migrations and marker creation; it does
// not promise zero physical sidecar bookkeeping. Do not use immutable/nolock or
// copy an active database to evade normal consistency/locking semantics.
#[cfg(windows)]
mod win {
    use std::{
        ffi::{c_char, c_int, c_void, CString},
        path::Path,
        ptr::{self, NonNull},
        time::{Duration, Instant},
    };
    const OK: c_int = 0;
    const ROW: c_int = 100;
    const DONE: c_int = 101;
    #[link(name = "winsqlite3")]
    unsafe extern "system" {
        fn sqlite3_open_v2(
            path: *const c_char,
            db: *mut *mut c_void,
            flags: c_int,
            vfs: *const c_char,
        ) -> c_int;
        fn sqlite3_close(db: *mut c_void) -> c_int;
        fn sqlite3_db_readonly(db: *mut c_void, name: *const c_char) -> c_int;
        fn sqlite3_busy_timeout(db: *mut c_void, ms: c_int) -> c_int;
        fn sqlite3_progress_handler(
            db: *mut c_void,
            steps: c_int,
            callback: Option<unsafe extern "system" fn(*mut c_void) -> c_int>,
            context: *mut c_void,
        );
        fn sqlite3_prepare_v2(
            db: *mut c_void,
            sql: *const c_char,
            bytes: c_int,
            statement: *mut *mut c_void,
            tail: *mut *const c_char,
        ) -> c_int;
        fn sqlite3_stmt_readonly(statement: *mut c_void) -> c_int;
        fn sqlite3_bind_text(
            statement: *mut c_void,
            index: c_int,
            text: *const c_char,
            bytes: c_int,
            destructor: Option<unsafe extern "system" fn(*mut c_void)>,
        ) -> c_int;
        fn sqlite3_step(statement: *mut c_void) -> c_int;
        fn sqlite3_column_type(statement: *mut c_void, index: c_int) -> c_int;
        fn sqlite3_column_bytes(statement: *mut c_void, index: c_int) -> c_int;
        fn sqlite3_column_text(statement: *mut c_void, index: c_int) -> *const u8;
        fn sqlite3_column_int64(statement: *mut c_void, index: c_int) -> i64;
        fn sqlite3_finalize(statement: *mut c_void) -> c_int;
    }
    pub(super) enum Cell {
        Null,
        Text(String),
        Integer(i64),
    }
    impl Cell {
        pub fn text(&self) -> Result<Option<&str>, String> {
            match self {
                Self::Null => Ok(None),
                Self::Text(value) => Ok(Some(value)),
                _ => Err("Work heartbeat SQLite field type is invalid".into()),
            }
        }
    }
    pub(super) struct Database {
        raw: NonNull<c_void>,
        _deadline: Box<Instant>,
    }
    unsafe extern "system" fn expired(context: *mut c_void) -> c_int {
        i32::from(Instant::now() >= unsafe { *(context.cast::<Instant>()) })
    }
    impl Database {
        pub fn open_existing(path: &Path) -> Result<Option<Self>, String> {
            match std::fs::metadata(path) {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("Work heartbeat SQLite file could not be inspected".into()),
            }
            Self::open(path, true).map(Some)
        }
        fn open(path: &Path, readonly: bool) -> Result<Self, String> {
            let path = CString::new(
                path.to_str()
                    .ok_or("Work heartbeat SQLite path is not UTF-8")?,
            )
            .map_err(|_| "Work heartbeat SQLite path is invalid")?;
            let mut raw = ptr::null_mut();
            let code = unsafe {
                sqlite3_open_v2(
                    path.as_ptr(),
                    &mut raw,
                    if readonly {
                        1 | 0x40000
                    } else {
                        2 | 4 | 0x40000
                    },
                    ptr::null(),
                )
            };
            let raw = NonNull::new(raw).ok_or("Work heartbeat SQLite connection unavailable")?;
            let mut db = Self {
                raw,
                _deadline: Box::new(Instant::now() + Duration::from_secs(3)),
            };
            if code != OK {
                return Err("Work heartbeat SQLite could not be opened".into());
            }
            if readonly
                && unsafe { sqlite3_db_readonly(raw.as_ptr(), b"main\0".as_ptr().cast()) } != 1
            {
                return Err("Work heartbeat SQLite connection is not read-only".into());
            }
            if unsafe { sqlite3_busy_timeout(raw.as_ptr(), 1000) } != OK {
                return Err("Work heartbeat SQLite busy policy failed".into());
            }
            unsafe {
                sqlite3_progress_handler(
                    raw.as_ptr(),
                    1000,
                    Some(expired),
                    (&mut *db._deadline as *mut Instant).cast(),
                );
            }
            if readonly {
                db.control("PRAGMA query_only = ON")?;
            }
            Ok(db)
        }
        pub fn control(&self, sql: &str) -> Result<(), String> {
            self.run(sql, &[], 0, false).map(|_| ())
        }
        pub fn query(
            &self,
            sql: &str,
            bindings: &[&str],
            columns: usize,
        ) -> Result<Vec<Vec<Cell>>, String> {
            self.run(sql, bindings, columns, true)
        }
        fn run(
            &self,
            sql: &str,
            bindings: &[&str],
            columns: usize,
            readonly: bool,
        ) -> Result<Vec<Vec<Cell>>, String> {
            if Instant::now() >= *self._deadline {
                return Err("Work heartbeat SQLite read timed out".into());
            }
            // Bindings live until after Statement's RAII finalize (SQLITE_STATIC).
            let bindings: Vec<CString> = bindings
                .iter()
                .map(|value| {
                    CString::new(*value)
                        .map_err(|_| "Work heartbeat SQLite parameter is invalid".to_owned())
                })
                .collect::<Result<_, _>>()?;
            let sql =
                CString::new(sql).map_err(|_| "Work heartbeat SQLite statement is invalid")?;
            let mut raw = ptr::null_mut();
            let code = unsafe {
                sqlite3_prepare_v2(
                    self.raw.as_ptr(),
                    sql.as_ptr(),
                    -1,
                    &mut raw,
                    ptr::null_mut(),
                )
            };
            let statement = Statement {
                raw: NonNull::new(raw).ok_or("Work heartbeat SQLite schema is unavailable")?,
                _db: self,
            };
            if code != OK {
                return Err("Work heartbeat SQLite schema could not be read".into());
            }
            if readonly && unsafe { sqlite3_stmt_readonly(statement.raw.as_ptr()) } != 1 {
                return Err("Work heartbeat SQLite statement is not read-only".into());
            }
            for (index, value) in bindings.iter().enumerate() {
                if unsafe {
                    sqlite3_bind_text(
                        statement.raw.as_ptr(),
                        index as c_int + 1,
                        value.as_ptr(),
                        value.as_bytes().len() as c_int,
                        None,
                    )
                } != OK
                {
                    return Err("Work heartbeat SQLite parameter binding failed".into());
                }
            }
            let mut rows = Vec::new();
            loop {
                match unsafe { sqlite3_step(statement.raw.as_ptr()) } {
                    DONE => return Ok(rows),
                    ROW => {}
                    _ => return Err("Work heartbeat SQLite snapshot could not be read".into()),
                }
                if rows.len() >= 100_000 {
                    return Err("Work heartbeat SQLite result exceeds the read limit".into());
                }
                if Instant::now() >= *self._deadline {
                    return Err("Work heartbeat SQLite read timed out".into());
                }
                let mut row = Vec::new();
                for index in 0..columns {
                    let index = index as c_int;
                    row.push(
                        match unsafe { sqlite3_column_type(statement.raw.as_ptr(), index) } {
                            5 => Cell::Null,
                            1 => Cell::Integer(unsafe {
                                sqlite3_column_int64(statement.raw.as_ptr(), index)
                            }),
                            3 => {
                                let count =
                                    unsafe { sqlite3_column_bytes(statement.raw.as_ptr(), index) };
                                let text =
                                    unsafe { sqlite3_column_text(statement.raw.as_ptr(), index) };
                                if count < 0 || count as u64 > super::READ_LIMIT || text.is_null() {
                                    return Err("Work heartbeat SQLite text is unavailable".into());
                                }
                                Cell::Text(
                                    std::str::from_utf8(unsafe {
                                        std::slice::from_raw_parts(text, count as usize)
                                    })
                                    .map_err(|_| "Work heartbeat SQLite text is invalid UTF-8")?
                                    .to_owned(),
                                )
                            }
                            _ => return Err("Work heartbeat SQLite field type is invalid".into()),
                        },
                    );
                }
                rows.push(row);
            }
        }
    }
    impl Drop for Database {
        fn drop(&mut self) {
            unsafe {
                sqlite3_close(self.raw.as_ptr());
            }
        }
    }
    struct Statement<'a> {
        raw: NonNull<c_void>,
        _db: &'a Database,
    }
    impl Drop for Statement<'_> {
        fn drop(&mut self) {
            unsafe {
                sqlite3_finalize(self.raw.as_ptr());
            }
        }
    }
    #[cfg(test)]
    pub(super) fn fixture_write(path: &Path, sql: &str, bindings: &[&str]) -> Result<(), String> {
        Database::open(path, false)?
            .run(sql, bindings, 0, false)
            .map(|_| ())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("work-heartbeat-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn legacy(&self, id: &str, status: &str, thread: &str) {
            let directory = self.0.join("automations").join(id);
            fs::create_dir_all(&directory).unwrap();
            let value = toml::Value::Table(toml::map::Map::from_iter([
                ("version".into(), toml::Value::Integer(1)),
                ("id".into(), toml::Value::String(id.into())),
                ("name".into(), toml::Value::String("private fixture".into())),
                ("prompt".into(), toml::Value::String("not returned".into())),
                ("kind".into(), toml::Value::String("heartbeat".into())),
                ("status".into(), toml::Value::String(status.into())),
                (
                    "target_thread_id".into(),
                    toml::Value::String(thread.into()),
                ),
                ("created_at".into(), toml::Value::Integer(1)),
                ("updated_at".into(), toml::Value::Integer(1)),
            ]));
            fs::write(
                directory.join("automation.toml"),
                toml::to_string(&value).unwrap(),
            )
            .unwrap();
        }
        fn marker(&self, status: &str) {
            fs::write(
                self.0.join(".codex-global-state.json"),
                serde_json::to_vec(&json!({
                INSTALLATION:"fixture-install",MIGRATION:{"account:user:fixture-install":status}}))
                .unwrap(),
            )
            .unwrap();
        }
        fn database(&self) -> PathBuf {
            let path = self.0.join("sqlite").join("codex.db");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            win::fixture_write(&path,"CREATE TABLE automations(id TEXT PRIMARY KEY,kind TEXT,status TEXT,target_thread_id TEXT,remote_host TEXT,account_id TEXT,user_id TEXT,installation_id TEXT,legacy_automation_id TEXT)",&[]).unwrap();
            path
        }
        fn row(
            &self,
            id: &str,
            status: &str,
            thread: &str,
            owner: Option<(&str, &str, &str)>,
            legacy: &str,
        ) {
            let path = self.0.join("sqlite/codex.db");
            if let Some((account, user, installation)) = owner {
                win::fixture_write(
                    &path,
                    "INSERT INTO automations VALUES(?, 'heartbeat', ?, ?, NULL, ?, ?, ?, ?)",
                    &[id, status, thread, account, user, installation, legacy],
                )
                .unwrap();
            } else {
                win::fixture_write(&path,"INSERT INTO automations VALUES(?, 'heartbeat', ?, ?, NULL, NULL, NULL, NULL, NULL)",&[id,status,thread]).unwrap();
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Recursive cleanup is restricted to this exact private UUID root.
            if let (Ok(root), Ok(temp)) = (
                fs::canonicalize(&self.0),
                fs::canonicalize(std::env::temp_dir()),
            ) {
                if root.parent() == Some(temp.as_path())
                    && root
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with("work-heartbeat-"))
                {
                    let _ = fs::remove_dir_all(root);
                }
            }
        }
    }
    fn identity() -> ServiceIdentity {
        ServiceIdentity {
            account_id: "account".into(),
            user_id: "user".into(),
            generation: 7,
        }
    }
    fn owner() -> Option<(&'static str, &'static str, &'static str)> {
        Some(("account", "user", "fixture-install"))
    }
    fn read(fixture: &Fixture) -> Vec<WorkHeartbeatEntry> {
        read_at(&fixture.0, &identity(), "thread", None).unwrap()
    }

    #[test]
    fn heartbeat_legacy_no_owner_is_valid_and_preserves_exact_status_and_target() {
        let fixture = Fixture::new();
        assert!(read(&fixture).is_empty());
        fixture.legacy("active", "ACTIVE", "thread");
        fixture.legacy("paused", "PAUSED", "thread");
        fixture.legacy("disabled", "DISABLED", "thread");
        fixture.legacy("other", "ACTIVE", "different-thread");
        let mut statuses = read(&fixture)
            .into_iter()
            .map(|entry| {
                assert_eq!(entry.kind, "heartbeat");
                assert_eq!(entry.target_thread_id, "thread");
                entry.status
            })
            .collect::<Vec<_>>();
        statuses.sort();
        assert_eq!(statuses, vec!["ACTIVE", "PAUSED", "PAUSED"]);
        let unchanged = fs::read(fixture.0.join("automations/active/automation.toml")).unwrap();
        read(&fixture);
        assert_eq!(
            fs::read(fixture.0.join("automations/active/automation.toml")).unwrap(),
            unchanged
        );
        assert!(!fixture.0.join(".codex-global-state.json").exists());
        assert!(!fixture.0.join("sqlite").exists());
    }

    #[test]
    fn heartbeat_legacy_invalid_schema_ids_versions_and_case_are_source_discarded() {
        let fixture = Fixture::new();
        fixture.legacy("valid", "ACTIVE", "thread");
        for (id, replace, with) in [
            ("wrong-id", "id = \"wrong-id\"", "id = \"other\""),
            ("wrong-version", "version = 1", "version = 2"),
            ("lowercase", "status = \"ACTIVE\"", "status = \"active\""),
            ("wrong-kind", "kind = \"heartbeat\"", "kind = \"cron\""),
            (
                "missing-target",
                "target_thread_id = \"thread\"",
                "target_thread_id = \" \"",
            ),
            ("wrong-created", "created_at = 1", "created_at = 'bad'"),
            (
                "wrong-model",
                "name = \"private fixture\"",
                "name = \"private fixture\"\nmodel = 17",
            ),
        ] {
            fixture.legacy(id, "ACTIVE", "thread");
            let path = fixture
                .0
                .join("automations")
                .join(id)
                .join("automation.toml");
            let text = fs::read_to_string(&path).unwrap();
            assert!(text.contains(replace));
            fs::write(path, text.replace(replace, with)).unwrap();
        }
        let bad = fixture.0.join("automations/bad");
        fs::create_dir(&bad).unwrap();
        fs::write(bad.join("automation.toml"), "invalid [").unwrap();
        assert_eq!(read(&fixture).len(), 1);
    }

    #[test]
    fn heartbeat_in_progress_merges_owner_rows_with_deleted_occupancy_and_foreign_id_guard() {
        let fixture = Fixture::new();
        fixture.marker("in_progress");
        let db = fixture.database();
        for id in ["legacy", "deleted", "foreign", "unowned", "partial"] {
            fixture.legacy(id, "ACTIVE", "thread");
        }
        fixture.row("new", "ACTIVE", "thread", owner(), "legacy");
        fixture.row("deleted-row", "DELETED", "thread", owner(), "deleted");
        fixture.row(
            "foreign",
            "ACTIVE",
            "thread",
            Some(("other-account", "user", "fixture-install")),
            "",
        );
        fixture.row("unowned", "PAUSED", "thread", None, "");
        fixture.row("partial", "ACTIVE", "thread", None, "");
        win::fixture_write(
            &db,
            "UPDATE automations SET user_id='foreign-user' WHERE id='partial'",
            &[],
        )
        .unwrap();
        fixture.row("db-paused", "PAUSED", "thread", owner(), "");
        fixture.row("other-thread", "ACTIVE", "other-thread", owner(), "");
        let before = fs::read(&db).unwrap();
        let rows = read(&fixture);
        assert_eq!(rows.iter().filter(|row| row.status == "ACTIVE").count(), 2); // owner new + unowned legacy
        assert_eq!(rows.iter().filter(|row| row.status == "PAUSED").count(), 1);
        assert_eq!(rows.len(), 3);
        assert_eq!(fs::read(&db).unwrap(), before);
        assert!(!serde_json::to_string(&rows).unwrap().contains("account"));
    }

    #[test]
    fn heartbeat_complete_uses_only_owner_db_and_remote_json_real_target() {
        let fixture = Fixture::new();
        fixture.marker("complete");
        let db = fixture.database();
        fixture.legacy("legacy", "ACTIVE", "thread");
        fixture.row("owner", "ACTIVE", "thread", owner(), "");
        fixture.row("deleted", "DELETED", "thread", owner(), "");
        fixture.row("remote", "PAUSED", "wrong-target", owner(), "");
        win::fixture_write(
            &db,
            "UPDATE automations SET remote_host=? WHERE id='remote'",
            &[r#"{"id":"remote-host","identity":"remote-identity","threadId":"thread"}"#],
        )
        .unwrap();
        fixture.row(
            "foreign",
            "ACTIVE",
            "thread",
            Some(("account", "other-user", "fixture-install")),
            "",
        );
        let rows = read(&fixture);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row.status == "PAUSED"));
        win::fixture_write(
            &db,
            "UPDATE automations SET remote_host='{}' WHERE id='remote'",
            &[],
        )
        .unwrap();
        assert!(
            read(&fixture).is_empty(),
            "complete registry errors fall back to the empty legacy set"
        );
    }

    #[test]
    fn heartbeat_late_registry_failure_restores_entire_original_legacy_set() {
        let fixture = Fixture::new();
        fixture.marker("in_progress");
        let db = fixture.database();
        fixture.legacy("occupied", "ACTIVE", "thread");
        fixture.legacy("bad-owner", "PAUSED", "thread");
        fixture.row("deleted", "DELETED", "thread", owner(), "occupied");
        fixture.row("bad-owner", "ACTIVE", "thread", None, "");
        // This row is outside n. G(O(id)) fails after n has already occupied a
        // legacy id; F must return the original legacy vector, not its remainder.
        // TEXT affinity would coerce a number to text; use a BLOB for bad type.
        win::fixture_write(
            &db,
            "UPDATE automations SET account_id=x'31' WHERE id='bad-owner'",
            &[],
        )
        .unwrap();
        let rows = read(&fixture);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row.status == "ACTIVE"));
        assert!(rows.iter().any(|row| row.status == "PAUSED"));
    }

    #[test]
    fn heartbeat_sqlite_connection_rejects_writes_and_handles_unicode_paths() {
        let fixture = Fixture::new();
        let directory = fixture.0.join("私有只读测试");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("注册表.sqlite");
        win::fixture_write(&path, "CREATE TABLE sample(value TEXT)", &[]).unwrap();
        win::fixture_write(&path, "INSERT INTO sample VALUES(?)", &["真实文字"]).unwrap();
        let original = fs::read(&path).unwrap();
        let db = win::Database::open_existing(&path).unwrap().unwrap();
        assert_eq!(
            db.query("SELECT value FROM sample", &[], 1).unwrap()[0][0]
                .text()
                .unwrap(),
            Some("真实文字")
        );
        assert!(db.query("DELETE FROM sample", &[], 0).is_err());
        assert!(db.control("DELETE FROM sample").is_err());
        drop(db);
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn heartbeat_global_sqlite_settings_override_stale_json_and_unknown_versions_fail() {
        let fixture = Fixture::new();
        fixture.marker("in_progress");
        fixture.legacy("legacy", "ACTIVE", "thread");
        let path = fixture.0.join(".codex-global-state.sqlite");
        win::fixture_write(&path,"CREATE TABLE settings(scope TEXT,key TEXT,value TEXT,PRIMARY KEY(scope,key)) WITHOUT ROWID",&[]).unwrap();
        win::fixture_write(&path, "PRAGMA user_version=1", &[]).unwrap();
        win::fixture_write(
            &path,
            "INSERT INTO settings VALUES('global',?,?)",
            &[INSTALLATION, "\"fixture-install\""],
        )
        .unwrap();
        win::fixture_write(
            &path,
            "INSERT INTO settings VALUES('global',?,?)",
            &[MIGRATION, r#"{"account:user:fixture-install":"complete"}"#],
        )
        .unwrap();
        assert!(
            read(&fixture).is_empty(),
            "complete+missing automation DB follows the source empty legacy branch"
        );
        let before = fs::read(&path).unwrap();
        read(&fixture);
        assert_eq!(fs::read(&path).unwrap(), before);
        win::fixture_write(&path, "PRAGMA user_version=2", &[]).unwrap();
        assert!(read_at(&fixture.0, &identity(), "thread", None).is_err());
        win::fixture_write(&path, "PRAGMA user_version=0", &[]).unwrap();
        assert_eq!(
            read(&fixture).len(),
            1,
            "uninitialized global sqlite uses real JSON"
        );
    }

    #[test]
    fn heartbeat_bad_markers_error_but_registry_and_directory_failures_use_source_fallback() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join(".codex-global-state.json"), "bad JSON").unwrap();
        assert!(read_at(&fixture.0, &identity(), "thread", None).is_err());
        fs::write(
            fixture.0.join(".codex-global-state.json"),
            serde_json::to_vec(&json!({INSTALLATION:17})).unwrap(),
        )
        .unwrap();
        assert!(read_at(&fixture.0, &identity(), "thread", None).is_err());
        fixture.marker("complete");
        let db = fixture.0.join("sqlite/codex.db");
        fs::create_dir_all(db.parent().unwrap()).unwrap();
        win::fixture_write(&db, "CREATE TABLE automations(id TEXT)", &[]).unwrap();
        assert!(read(&fixture).is_empty());
        fixture.marker("in_progress");
        fixture.legacy("legacy", "ACTIVE", "thread");
        assert_eq!(
            read(&fixture).len(),
            1,
            "missing columns use complete original legacy fallback"
        );
        let fixture = Fixture::new();
        fs::write(fixture.0.join("automations"), "not a directory").unwrap();
        assert!(read(&fixture).is_empty());
    }

    #[test]
    fn heartbeat_marker_recheck_rejects_mid_read_migration_and_old_account_user_key_is_not_owner() {
        let fixture = Fixture::new();
        fixture.legacy("legacy", "ACTIVE", "thread");
        fs::write(
            fixture.0.join(".codex-global-state.json"),
            serde_json::to_vec(
                &json!({INSTALLATION:"fixture-install",MIGRATION:{"account:user":"complete"}}),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            read(&fixture).len(),
            1,
            "do not infer owner from the older two-field enrollment key"
        );
        assert!(
            read_at_with(&fixture.0, &identity(), "thread", None, || fixture
                .marker("complete"))
            .is_err()
        );
    }

    #[test]
    fn heartbeat_dev_filename_and_same_transaction_snapshot_are_real_sqlite_reads() {
        let fixture = Fixture::new();
        fixture.marker("complete");
        let db = fixture.database();
        fixture.row("prod", "ACTIVE", "thread", owner(), "");
        let dev = fixture.0.join("sqlite/codex-dev.db");
        fs::rename(&db, &dev).unwrap();
        assert!(read_at(&fixture.0, &identity(), "thread", Some("prod"))
            .unwrap()
            .is_empty());
        assert_eq!(
            read_at(&fixture.0, &identity(), "thread", Some("dev"))
                .unwrap()
                .len(),
            1
        );
        // A second connection can commit while this read transaction retains
        // the original WAL snapshot for both owner and G(id) queries.
        win::fixture_write(&dev, "PRAGMA journal_mode=WAL", &[]).unwrap();
        let reader = win::Database::open_existing(&dev).unwrap().unwrap();
        reader.control("BEGIN").unwrap();
        assert_eq!(
            reader
                .query("SELECT id FROM automations", &[], 1)
                .unwrap()
                .len(),
            1
        );
        win::fixture_write(&dev,"INSERT INTO automations(id,kind,status,target_thread_id) VALUES('later','heartbeat','ACTIVE','thread')",&[]).unwrap();
        assert!(reader
            .query(
                "SELECT account_id,user_id,installation_id FROM automations WHERE id=?",
                &["later"],
                3
            )
            .unwrap()
            .is_empty());
        drop(reader);
        let latest = win::Database::open_existing(&dev).unwrap().unwrap();
        assert_eq!(
            latest
                .query("SELECT id FROM automations", &[], 1)
                .unwrap()
                .len(),
            2
        );
    }
}
