use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const ATOMS_KEY: &str = "electron-persisted-atom-state";
const AUTO_CLEANUP: &str = "worktree-auto-cleanup-enabled";
const KEEP_COUNT: &str = "worktree-keep-count";
const UPSTREAM_REFRESH: &str = "worktree-upstream-refresh-mode";
const CONFIRM_DELETE: &str = "worktree-confirm-before-delete";
const KEYS: [&str; 4] = [AUTO_CLEANUP, KEEP_COUNT, UPSTREAM_REFRESH, CONFIRM_DELETE];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpstreamRefreshMode {
    Never,
    BestEffort,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreePreferences {
    pub auto_cleanup_enabled: bool,
    pub keep_count: u64,
    pub upstream_refresh_mode: UpstreamRefreshMode,
    pub confirm_before_delete: bool,
}
impl Default for WorktreePreferences {
    fn default() -> Self {
        Self {
            auto_cleanup_enabled: true,
            keep_count: 15,
            upstream_refresh_mode: UpstreamRefreshMode::Never,
            confirm_before_delete: true,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePreferencesSnapshot {
    pub host_id: String,
    pub preferences: WorktreePreferences,
    pub expected: Value,
}

fn local_host(host_id: &str) -> Result<(), String> {
    if host_id != "local" {
        return Err("工作树偏好目前仅支持真实本地主机作用域。".into());
    }
    Ok(())
}
fn atoms(value: &Value) -> Result<Option<&Map<String, Value>>, String> {
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_object()
        .map(Some)
        .ok_or("工作树偏好容器损坏，未覆盖原记录。".into())
}
fn revision(value: &Value) -> Result<Value, String> {
    let source = atoms(value)?;
    let mut selected = Map::new();
    for key in KEYS {
        if let Some(value) = source.and_then(|source| source.get(key)) {
            selected.insert(key.into(), value.clone());
        }
    }
    Ok(Value::Object(selected))
}
fn snapshot(host_id: &str, value: &Value) -> Result<WorktreePreferencesSnapshot, String> {
    let expected = revision(value)?;
    let defaults = WorktreePreferences::default();
    // Official schema normalization falls back per field; retain raw values in the CAS revision.
    let preferences = WorktreePreferences {
        auto_cleanup_enabled: expected[AUTO_CLEANUP]
            .as_bool()
            .unwrap_or(defaults.auto_cleanup_enabled),
        keep_count: expected[KEEP_COUNT]
            .as_u64()
            .filter(|count| *count >= 1)
            .or_else(|| {
                expected[KEEP_COUNT]
                    .as_f64()
                    .filter(|count| {
                        count.is_finite()
                            && *count >= 1.0
                            && count.fract() == 0.0
                            && *count < u64::MAX as f64
                    })
                    .map(|count| count as u64)
            })
            .unwrap_or(defaults.keep_count),
        upstream_refresh_mode: serde_json::from_value(expected[UPSTREAM_REFRESH].clone())
            .unwrap_or(defaults.upstream_refresh_mode),
        confirm_before_delete: expected[CONFIRM_DELETE]
            .as_bool()
            .unwrap_or(defaults.confirm_before_delete),
    };
    Ok(WorktreePreferencesSnapshot {
        host_id: host_id.into(),
        preferences,
        expected,
    })
}
pub fn read(
    state: &crate::state::DesktopStateManager,
    host_id: &str,
) -> Result<WorktreePreferencesSnapshot, String> {
    local_host(host_id)?;
    snapshot(host_id, &state.get_value(ATOMS_KEY))
}
pub fn update(
    state: &crate::state::DesktopStateManager,
    host_id: &str,
    preferences: WorktreePreferences,
    expected: Value,
) -> Result<WorktreePreferencesSnapshot, String> {
    local_host(host_id)?;
    if preferences.keep_count < 1 {
        return Err("工作树保留数必须为至少 1 的整数。".into());
    }
    let expected_map = expected.as_object().ok_or("工作树偏好版本必须为对象。")?;
    if expected_map.keys().any(|key| !KEYS.contains(&key.as_str())) {
        return Err("工作树偏好版本包含未知字段。".into());
    }
    let written = state.update_value_persisted(ATOMS_KEY, |previous| {
        if revision(&previous)? != expected {
            return Err("工作树偏好已变化，请重新读取后再保存；草稿已保留。".into());
        }
        let before = snapshot(host_id, &previous)?.preferences;
        let mut next = atoms(&previous)?.cloned().unwrap_or_default();
        if before.auto_cleanup_enabled != preferences.auto_cleanup_enabled {
            next.insert(AUTO_CLEANUP.into(), json!(preferences.auto_cleanup_enabled));
        }
        if before.keep_count != preferences.keep_count {
            next.insert(KEEP_COUNT.into(), json!(preferences.keep_count));
        }
        if before.upstream_refresh_mode != preferences.upstream_refresh_mode {
            next.insert(
                UPSTREAM_REFRESH.into(),
                json!(preferences.upstream_refresh_mode),
            );
        }
        if before.confirm_before_delete != preferences.confirm_before_delete {
            next.insert(
                CONFIRM_DELETE.into(),
                json!(preferences.confirm_before_delete),
            );
        }
        Ok(Value::Object(next))
    })?;
    let persisted = std::fs::read(crate::state::desktop_global_state_path())
        .map_err(|error| format!("工作树偏好已写入，但无法读回：{error}"))?;
    let persisted: Value = serde_json::from_slice(&persisted)
        .map_err(|error| format!("工作树偏好已写入，但读回结构无效：{error}"))?;
    let result = snapshot(host_id, &persisted[ATOMS_KEY])?;
    if result.expected != revision(&written)? || result.preferences != preferences {
        return Err("工作树偏好已写入，但读回不一致。".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    #[test]
    fn worktree_preferences_schema_defaults_and_strict_write_shape() {
        assert_eq!(
            snapshot("local", &Value::Null).unwrap().preferences,
            WorktreePreferences::default()
        );
        let invalid = json!({AUTO_CLEANUP: "false", KEEP_COUNT: 0, UPSTREAM_REFRESH: "always", CONFIRM_DELETE: 1});
        let result = snapshot("local", &invalid).unwrap();
        assert_eq!(result.preferences, WorktreePreferences::default());
        assert_eq!(result.expected, invalid);
        for count in [json!(-1), json!(0), json!(1.5), json!("15"), Value::Null] {
            assert_eq!(
                snapshot("local", &json!({KEEP_COUNT: count}))
                    .unwrap()
                    .preferences
                    .keep_count,
                15
            );
        }
        assert_eq!(
            snapshot("local", &json!({KEEP_COUNT: 1}))
                .unwrap()
                .preferences
                .keep_count,
            1
        );
        assert_eq!(
            snapshot("local", &json!({KEEP_COUNT: 1.0}))
                .unwrap()
                .preferences
                .keep_count,
            1
        );
        assert!(snapshot("local", &json!([1])).is_err());
        for invalid in [
            json!({"autoCleanupEnabled": "false", "keepCount": 15, "upstreamRefreshMode": "never", "confirmBeforeDelete": true}),
            json!({"autoCleanupEnabled": true, "keepCount": 1.5, "upstreamRefreshMode": "never", "confirmBeforeDelete": true}),
            json!({"autoCleanupEnabled": true, "keepCount": 15, "upstreamRefreshMode": "always", "confirmBeforeDelete": true}),
        ] {
            assert!(serde_json::from_value::<WorktreePreferences>(invalid).is_err());
        }
        assert!(local_host("remote-host").is_err());
        assert!(local_host("").is_err());
    }

    #[test]
    fn worktree_preferences_private_restart_cas_and_write_failure() {
        const MARKER: &str = "CODEX_WORKTREE_PREFERENCES_FIXTURE";
        const PHASE: &str = "CODEX_WORKTREE_PREFERENCES_PHASE";
        if let Some(root) = std::env::var_os(MARKER) {
            let root = PathBuf::from(root);
            assert_eq!(crate::state::codex_home_dir(), root.join("home"));
            let state = crate::state::DesktopStateManager::new();
            if std::env::var(PHASE).unwrap() == "write" {
                assert_eq!(
                    read(&state, "local").unwrap().preferences,
                    WorktreePreferences::default()
                );
                state
                    .set_value_persisted("unrelated-top", json!("retain"))
                    .unwrap();
                state
                    .set_value_persisted(
                        ATOMS_KEY,
                        json!({"sibling-atom": {"retain": true}, "worktree-keep-count": "invalid"}),
                    )
                    .unwrap();
                let initial = read(&state, "local").unwrap();
                assert_eq!(initial.preferences.keep_count, 15);
                let mut one_field = initial.preferences.clone();
                one_field.auto_cleanup_enabled = false;
                let one_field =
                    update(&state, "local", one_field, initial.expected.clone()).unwrap();
                let atoms = state.get_value(ATOMS_KEY);
                assert_eq!(
                    atoms[KEEP_COUNT], "invalid",
                    "editing another preference must not normalize stored invalid values"
                );
                assert!(atoms.get(UPSTREAM_REFRESH).is_none());
                assert!(atoms.get(CONFIRM_DELETE).is_none());
                state
                    .update_value_persisted(ATOMS_KEY, |mut atoms| {
                        atoms["late-sibling"] = json!("retain");
                        Ok(atoms)
                    })
                    .unwrap();
                let preferences = WorktreePreferences {
                    auto_cleanup_enabled: false,
                    keep_count: 1,
                    upstream_refresh_mode: UpstreamRefreshMode::BestEffort,
                    confirm_before_delete: false,
                };
                let result =
                    update(&state, "local", preferences.clone(), one_field.expected).unwrap();
                assert_eq!(result.preferences, preferences);
                assert!(update(
                    &state,
                    "local",
                    WorktreePreferences::default(),
                    initial.expected
                )
                .is_err());
                let before = state.get_value(ATOMS_KEY);
                let mut invalid = preferences.clone();
                invalid.keep_count = 0;
                assert!(update(&state, "local", invalid, result.expected.clone()).is_err());
                assert!(update(&state, "remote-host", preferences, result.expected).is_err());
                assert_eq!(state.get_value(ATOMS_KEY), before);
            } else {
                let before = read(&state, "local").unwrap();
                assert_eq!(before.preferences.keep_count, 1);
                assert!(!before.preferences.auto_cleanup_enabled);
                assert_eq!(
                    before.preferences.upstream_refresh_mode,
                    UpstreamRefreshMode::BestEffort
                );
                assert!(!before.preferences.confirm_before_delete);
                assert_eq!(state.get_value("unrelated-top"), "retain");
                assert_eq!(
                    state.get_value(ATOMS_KEY)["sibling-atom"],
                    json!({"retain": true})
                );
                assert_eq!(state.get_value(ATOMS_KEY)["late-sibling"], "retain");
                for key in KEYS {
                    assert!(
                        state.get_value(key).is_null(),
                        "preferences must not create private top-level aliases"
                    );
                }
                let path = crate::state::desktop_global_state_path();
                let backup = root.join("state-backup.json");
                fs::rename(&path, &backup).unwrap();
                fs::create_dir(&path).unwrap();
                let blocked = update(
                    &state,
                    "local",
                    WorktreePreferences::default(),
                    before.expected.clone(),
                );
                assert!(blocked.is_err());
                assert_eq!(read(&state, "local").unwrap().expected, before.expected);
                fs::remove_dir(&path).unwrap();
                fs::rename(&backup, &path).unwrap();
                assert_eq!(
                    read(&crate::state::DesktopStateManager::new(), "local")
                        .unwrap()
                        .expected,
                    before.expected
                );
            }
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "codex-worktree-preferences-{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        for phase in ["write", "restart"] {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "worktree_preferences::tests::worktree_preferences_private_restart_cas_and_write_failure", "--nocapture"])
                .env("CODEX_HOME", &home).env(MARKER, &root).env(PHASE, phase);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let result = command.output().unwrap();
            assert!(
                result.status.success(),
                "{phase}: {}\n{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
