//! Restricted Work owner projection and explicit canonical-only mode activation.
use crate::{appshots_preferences::owner_key, chatgpt_service::ServiceIdentity};
use serde_json::{json, Map, Value};

const ATOMS: &str = "electron-persisted-atom-state";
const MARKER: &str = "electron-renderer-content-owner";
const WORK_MARKER: &str = "codex-native-work-content-owner";
const KEYS: [&str; 5] = [
    "work-run-location-v1",
    "home-composer-mode-v1",
    "chatgpt-last-selected-home-model-v1",
    "chatgpt-last-selected-model-v1",
    "default-mode-request-user-input-enabled",
];

fn dictionary(value: Option<&Value>) -> Result<Option<&Map<String, Value>>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(value)) => Ok(Some(value)),
        _ => Err("Work 偏好容器格式无效，未覆盖原记录。".into()),
    }
}

fn marker(value: Option<&Value>) -> Result<Option<&str>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(owner))
            if !owner.is_empty() && owner.len() <= 512 && !owner.chars().any(char::is_control) =>
        {
            Ok(Some(owner))
        }
        _ => Err("Work 身份标记格式未知，未覆盖原记录。".into()),
    }
}

pub(crate) fn activate(
    state: &Map<String, Value>,
    identity: &ServiceIdentity,
) -> Result<Map<String, Value>, String> {
    let target_key = owner_key(identity)?;
    let target_owner = target_key.strip_prefix("electron-owner-atoms:").unwrap();
    let official_owner = marker(state.get(MARKER))?;
    let native_owner = marker(state.get(WORK_MARKER))?;
    let previous_owner = official_owner.or(native_owner);
    let mut flat = dictionary(state.get(ATOMS))?.cloned().unwrap_or_default();
    let mut next = state.clone();
    let has_work_flat = KEYS.iter().any(|key| flat.contains_key(*key));
    if has_work_flat {
        let owner = previous_owner.unwrap_or(target_owner);
        let key = format!("electron-owner-atoms:{owner}");
        let mut bucket = dictionary(next.get(&key))?.cloned().unwrap_or_default();
        for key in KEYS {
            if let Some(value) = flat.remove(key) {
                bucket.insert(key.into(), value);
            }
        }
        next.insert(key, Value::Object(bucket));
        // Never replace the entire atom map: unrelated generic readers still
        // own the remaining preferences and the native legacy project layout.
        next.insert(ATOMS.into(), Value::Object(flat.clone()));
    }
    // This explicit first action binds legacy selection to its proven prior
    // owner (or to the target only when no owner proof exists). Retain raw data.
    // After the first Work confirmation it must never be adopted by a new user.
    if native_owner.is_none() {
        if let Some(selected) = state
            .get("selected-project")
            .or_else(|| flat.get("selected-project"))
        {
            let owner = previous_owner.unwrap_or(target_owner);
            next.entry(format!("electron-owner-value:selected-project:{owner}"))
                .or_insert_with(|| selected.clone());
        }
    }
    let mut target = dictionary(next.get(&target_key))?
        .cloned()
        .unwrap_or_default();
    target.insert("home-composer-mode-v1".into(), Value::String("work".into()));
    // This is only a Work confirmation marker, not the official all-atom owner
    // lifecycle. Canonical Work values are deliberately not restored to flat.
    next.insert(WORK_MARKER.into(), Value::String(target_owner.into()));
    next.insert(target_key, Value::Object(target));
    project(&next, identity)?;
    Ok(next)
}

pub(crate) fn project(
    state: &Map<String, Value>,
    identity: &ServiceIdentity,
) -> Result<Value, String> {
    let bucket_key = owner_key(identity)?;
    let owner = bucket_key.strip_prefix("electron-owner-atoms:").unwrap();
    let work_marker = marker(state.get(WORK_MARKER))?;
    let marker = marker(state.get(MARKER))?.or(work_marker);
    let bucket = dictionary(state.get(&bucket_key))?;
    // A foreign owner's live container is not this request's input, including
    // corrupt foreign data. Never return or enumerate its contents.
    let flat = if marker.is_none() || marker == Some(owner) {
        dictionary(state.get(ATOMS))?
    } else {
        None
    };
    let mut atoms = Map::new();
    let mut unbound = Vec::new();
    for key in KEYS {
        let live = flat.and_then(|values| values.get(key));
        if marker.is_none() && live.is_some() {
            unbound.push(key);
        } else if let Some(value) = live.or_else(|| bucket.and_then(|values| values.get(key))) {
            atoms.insert(key.into(), value.clone());
        }
    }
    let selected_key = format!("electron-owner-value:selected-project:{owner}");
    let selected = if let Some(value) = state.get(&selected_key) {
        json!({"placement":"owner-value","binding":"confirmed","value":value})
    } else if work_marker.is_none() && (marker.is_none() || marker == Some(owner)) {
        if state.contains_key("selected-project") {
            json!({"placement":"legacy-root","binding":"legacy-unbound"})
        } else if flat.is_some_and(|values| values.contains_key("selected-project")) {
            json!({"placement":"legacy-atom","binding":"legacy-unbound"})
        } else {
            json!({"placement":"missing","binding":"confirmed"})
        }
    } else {
        json!({"placement":"missing","binding":"confirmed"})
    };
    // LOCAL_PROJECTS is a global inventory. The nested location is an existing
    // native-client layout; preserve and label it rather than moving records.
    let local = if let Some(value) = state.get("local-projects") {
        json!({"placement":"root","value":value})
    } else {
        match state.get(ATOMS) {
            Some(Value::Object(values)) => match values.get("local-projects") {
                Some(value) => json!({"placement":"legacy-atom","value":value}),
                None => json!({"placement":"missing"}),
            },
            None | Some(Value::Null) => json!({"placement":"missing"}),
            // Report invalid inventory placement without returning unrelated
            // malformed foreign-owner data to the renderer.
            _ => json!({"placement":"legacy-atom"}),
        }
    };
    let legacy_detail = if state.contains_key("conversationDetailMode") {
        "unbound"
    } else {
        "missing"
    };
    Ok(
        json!({"owner":"bound","atoms":atoms,"unboundAtoms":unbound,"selectedProject":selected,"localProjects":local,"legacyDetail":legacy_detail}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity(user: &str) -> ServiceIdentity {
        ServiceIdentity {
            user_id: user.into(),
            account_id: "account".into(),
            generation: 3,
        }
    }
    fn fixture(state: Value) -> Map<String, Value> { state.as_object().unwrap().clone() }
    struct PrivateState(std::path::PathBuf);
    impl PrivateState {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("work-activate-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            Self(root.join("state.json"))
        }
    }
    impl Drop for PrivateState {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            let _ = std::fs::remove_dir(&self.0);
            let _ = std::fs::remove_dir(self.0.parent().unwrap());
        }
    }

    #[test]
    fn explicit_work_activation_adopts_legacy_once_and_persists_canonical_owner_mode() {
        let identity = identity("first-user");
        let key = owner_key(&identity).unwrap();
        let owner = key.strip_prefix("electron-owner-atoms:").unwrap();
        let selected_key = format!("electron-owner-value:selected-project:{owner}");
        let raw = fixture(json!({ATOMS:{KEYS[0]:"local",KEYS[1]:"chat",KEYS[4]:false,
            "selected-project":{"projectId":"nested"},"local-projects":{"keep":true},"other-pref":19},
            key.clone():{KEYS[0]:"cloud","unknown-owner-key":"keep"},
            "selected-project":{"projectId":"root"},"unrelated-top":{"keep":true}}));
        let state = crate::state::DesktopStateManager::fixture_for_appshots_preferences(raw);
        let file = PrivateState::new();
        let ack = state
            .activate_work_home_fixture(&identity, &file.0, || Ok(()))
            .unwrap();
        assert_eq!(ack["atoms"][KEYS[0]], "local");
        assert_eq!(ack["atoms"][KEYS[1]], "work");
        assert_eq!(ack["atoms"][KEYS[4]], false);
        assert_eq!(ack["selectedProject"]["value"], json!({"projectId":"root"}));
        let saved: Value = serde_json::from_slice(&std::fs::read(&file.0).unwrap()).unwrap();
        assert_eq!(saved[&key]["unknown-owner-key"], "keep");
        assert_eq!(saved[&selected_key], json!({"projectId":"root"}));
        assert_eq!(
            saved[ATOMS]["selected-project"],
            json!({"projectId":"nested"})
        );
        assert_eq!(saved[ATOMS]["local-projects"], json!({"keep":true}));
        assert_eq!(saved[ATOMS]["other-pref"], 19);
        assert_eq!(saved["unrelated-top"], json!({"keep":true}));
        assert!(saved.get(MARKER).is_none());
        assert_eq!(saved[WORK_MARKER], owner);
        for key in KEYS {
            assert!(saved[ATOMS].get(key).is_none());
        }
        assert_eq!(state.work_home_preferences(&identity).unwrap(), ack);
        assert_eq!(project(&fixture(saved), &identity).unwrap(), ack);
    }

    #[test]
    fn activation_switches_only_work_flat_and_never_reassigns_legacy_selection() {
        let first = identity("first-user");
        let second = identity("second-user");
        let first_key = owner_key(&first).unwrap();
        let second_key = owner_key(&second).unwrap();
        let first_owner = first_key.strip_prefix("electron-owner-atoms:").unwrap();
        let second_owner = second_key.strip_prefix("electron-owner-atoms:").unwrap();
        let first_selected = format!("electron-owner-value:selected-project:{first_owner}");
        let second_selected = format!("electron-owner-value:selected-project:{second_owner}");
        let raw = fixture(
            json!({MARKER:first_owner,ATOMS:{KEYS[0]:"local",KEYS[1]:"chat","other":true,
            "selected-project":{"projectId":"old-nested"}},first_key.clone():{"keep":"first"},
            second_key.clone():{KEYS[0]:"cloud","keep":"second"},first_selected.clone():null,
            "selected-project":{"projectId":"old-root"}}),
        );
        let state = crate::state::DesktopStateManager::fixture_for_appshots_preferences(raw);
        let file = PrivateState::new();
        let second_ack = state
            .activate_work_home_fixture(&second, &file.0, || Ok(()))
            .unwrap();
        assert_eq!(second_ack["atoms"][KEYS[0]], "cloud");
        assert_eq!(second_ack["atoms"][KEYS[1]], "work");
        assert_eq!(second_ack["selectedProject"]["placement"], "missing");
        assert_eq!(state.get_value(&first_selected), Value::Null);
        assert_eq!(state.get_value(&first_key)[KEYS[0]], "local");
        assert_eq!(state.get_value(&first_key)[KEYS[1]], "chat");
        assert_eq!(state.get_optional_value(&second_selected), None);
        assert_eq!(state.get_value(MARKER), json!(first_owner));
        assert_eq!(state.get_value(ATOMS)["other"], true);
        // No official proof: later flat writes belong to the last native Work
        // owner, while legacy selected remains bound only to its first owner.
        let mut without_official: Map<String, Value> =
            serde_json::from_slice(&std::fs::read(&file.0).unwrap()).unwrap();
        without_official.remove(MARKER);
        without_official
            .get_mut(ATOMS)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert(KEYS[0].into(), json!("local"));
        let state =
            crate::state::DesktopStateManager::fixture_for_appshots_preferences(without_official);
        state
            .activate_work_home_fixture(&first, &file.0, || Ok(()))
            .unwrap();
        assert_eq!(state.get_value(&second_key)[KEYS[0]], "local");
        assert_eq!(state.get_optional_value(&second_selected), None);
        assert_eq!(
            state.work_home_preferences(&second).unwrap()["selectedProject"]["placement"],
            "missing"
        );
        assert_eq!(state.get_value(&first_key)["keep"], "first");
        assert_eq!(state.get_value(&second_key)["keep"], "second");
        assert_eq!(
            state.get_value("selected-project"),
            json!({"projectId":"old-root"})
        );
    }

    #[test]
    fn activation_same_value_skips_persistence_and_failed_write_or_scope_keeps_memory() {
        let first = identity("first-user");
        let second = identity("second-user");
        let state = crate::state::DesktopStateManager::fixture_for_appshots_preferences(fixture(
            json!({ATOMS:{"other":17}}),
        ));
        let file = PrivateState::new();
        let first_ack = state
            .activate_work_home_fixture(&first, &file.0, || Ok(()))
            .unwrap();
        let bytes = std::fs::read(&file.0).unwrap();
        let blocked = file.0.parent().unwrap().join("blocked");
        std::fs::create_dir(&blocked).unwrap();
        assert_eq!(
            state
                .activate_work_home_fixture(&first, &blocked, || Ok(()))
                .unwrap(),
            first_ack,
            "unchanged state must not attempt a write to the injected failing path"
        );
        assert!(state
            .activate_work_home_fixture(&second, &blocked, || Ok(()))
            .is_err());
        assert_eq!(state.work_home_preferences(&first).unwrap(), first_ack);
        assert_eq!(state.get_optional_value(&owner_key(&second).unwrap()), None);
        assert_eq!(std::fs::read(&file.0).unwrap(), bytes);
        std::fs::remove_dir(blocked).unwrap();
        let pristine = fixture(json!({ATOMS:{KEYS[0]:"local","other":17}}));
        let state =
            crate::state::DesktopStateManager::fixture_for_appshots_preferences(pristine.clone());
        let checks = std::cell::Cell::new(0);
        assert!(state
            .activate_work_home_fixture(&first, &file.0, || {
                checks.set(checks.get() + 1);
                if checks.get() == 2 {
                    Err("cancelled before commit".into())
                } else {
                    Ok(())
                }
            })
            .is_err());
        assert_eq!(state.get_value(ATOMS), pristine[ATOMS]);
        assert_eq!(state.get_optional_value(WORK_MARKER), None);
        assert_eq!(std::fs::read(&file.0).unwrap(), bytes);
    }

    #[test]
    fn activation_unknown_marker_or_container_never_repairs_or_overwrites_data() {
        let identity = identity("user");
        for raw in [
            json!({MARKER:{"owner":"unknown"}}),
            json!({WORK_MARKER:[]}),
            json!({WORK_MARKER:false}),
            json!({ATOMS:17}),
            json!({owner_key(&identity).unwrap():false}),
        ] {
            let state = fixture(raw);
            let before = state.clone();
            assert!(activate(&state, &identity).is_err());
            assert_eq!(state, before);
        }
    }
    #[test]
    fn same_owner_flat_overrides_bucket_without_exposing_other_keys_or_mutating_state() {
        let identity = identity("user");
        let key = owner_key(&identity).unwrap();
        let owner = key.strip_prefix("electron-owner-atoms:").unwrap();
        let state = fixture(
            json!({MARKER:owner,ATOMS:{KEYS[0]:"local", "unrelated":"private"},key.clone():{KEYS[0]:"cloud",KEYS[1]:"work","other":"private"}}),
        );
        let before = state.clone();
        let result = project(&state, &identity).unwrap();
        assert_eq!(result["atoms"], json!({KEYS[0]:"local",KEYS[1]:"work"}));
        assert_eq!(result["owner"], "bound");
        assert_eq!(state, before);
        assert!(!result.to_string().contains("private"));
        assert!(!result.to_string().contains(owner));
    }
    #[test]
    fn foreign_and_signed_out_flat_cannot_supply_work_values_or_selection() {
        for marker in ["other-owner", "signed-out"] {
            let identity = identity("user");
            let key = owner_key(&identity).unwrap();
            let state = fixture(
                json!({MARKER:marker,ATOMS:{KEYS[0]:"cloud","selected-project":{"type":"chatgpt","projectId":"foreign"}},
                "selected-project":{"type":"chatgpt","projectId":"foreign"},key:{KEYS[0]:"local"}}),
            );
            let result = project(&state, &identity).unwrap();
            assert_eq!(result["atoms"][KEYS[0]], "local");
            assert_eq!(result["selectedProject"]["placement"], "missing");
            assert!(!result.to_string().contains("foreign"));
        }
        let identity = identity("user");
        let key = owner_key(&identity).unwrap();
        let result = project(
            &fixture(json!({MARKER:"other-owner",ATOMS:["foreign-private"],key:{KEYS[0]:"local"}})),
            &identity,
        )
        .unwrap();
        assert_eq!(result["atoms"][KEYS[0]], "local");
        assert!(!result.to_string().contains("foreign-private"));
        assert!(result["localProjects"].get("value").is_none());
    }
    #[test]
    fn unbound_legacy_values_block_instead_of_adopting_or_defaulting() {
        let identity = identity("user");
        let key = owner_key(&identity).unwrap();
        let state = fixture(
            json!({ATOMS:{KEYS[0]:null,"selected-project":{"projectId":"legacy"}},key:{KEYS[0]:"local",KEYS[1]:"work"}}),
        );
        let before = state.clone();
        let result = project(&state, &identity).unwrap();
        assert_eq!(result["unboundAtoms"], json!([KEYS[0]]));
        assert!(result["atoms"].get(KEYS[0]).is_none());
        assert_eq!(result["atoms"][KEYS[1]], "work");
        assert_eq!(result["selectedProject"]["binding"], "legacy-unbound");
        assert!(result["selectedProject"].get("value").is_none());
        assert_eq!(state, before);
    }
    #[test]
    fn owned_selection_wins_and_local_inventory_keeps_actual_storage_placement() {
        let identity = identity("user");
        let key = owner_key(&identity).unwrap();
        let owner = key.strip_prefix("electron-owner-atoms:").unwrap();
        let selected_key = format!("electron-owner-value:selected-project:{owner}");
        let state = fixture(
            json!({selected_key:null,"selected-project":{"projectId":"legacy"},
            "local-projects":{"root":{"id":"root","chatGptBacking":{"accountId":"a","userId":"u","projectId":"g-p-a"}}},
            ATOMS:{"local-projects":{"nested":{"id":"nested"}}}}),
        );
        let result = project(&state, &identity).unwrap();
        assert_eq!(result["selectedProject"]["placement"], "owner-value");
        assert_eq!(result["selectedProject"]["value"], Value::Null);
        assert_eq!(result["localProjects"]["placement"], "root");
        assert!(result["localProjects"]["value"].get("root").is_some());
        let nested = project(
            &fixture(json!({ATOMS:{"local-projects":{"nested":{"id":"nested"}}}})),
            &identity,
        )
        .unwrap();
        assert_eq!(nested["localProjects"]["placement"], "legacy-atom");
    }
    #[test]
    fn missing_null_and_invalid_containers_are_distinct() {
        let identity = identity("user");
        for state in [json!({}), json!({ATOMS:null})] {
            let result = project(&fixture(state), &identity).unwrap();
            assert_eq!(result["atoms"], json!({}));
            assert_eq!(result["selectedProject"]["placement"], "missing");
        }
        for state in [
            json!({ATOMS:[]}),
            json!({ATOMS:7}),
            json!({owner_key(&identity).unwrap():false}),
        ] {
            assert!(project(&fixture(state), &identity).is_err());
        }
        assert!(project(
            &fixture(json!({})),
            &ServiceIdentity {
                user_id: String::new(),
                ..identity
            }
        )
        .is_err());
    }
    #[test]
    fn default_request_input_false_is_not_missing_or_an_unbound_default() {
        let identity = identity("user");
        let key = owner_key(&identity).unwrap();
        let owner = key.strip_prefix("electron-owner-atoms:").unwrap();
        let result = project(
            &fixture(json!({MARKER:owner,ATOMS:{KEYS[4]:false},key.clone():{KEYS[4]:true}})),
            &identity,
        )
        .unwrap();
        assert_eq!(result["atoms"][KEYS[4]], false);
        let unbound = project(&fixture(json!({ATOMS:{KEYS[4]:false}})), &identity).unwrap();
        assert_eq!(unbound["unboundAtoms"], json!([KEYS[4]]));
        assert!(unbound["atoms"].get(KEYS[4]).is_none());
    }
    #[test]
    fn legacy_detail_presence_is_reported_without_adopting_or_returning_its_value() {
        let identity=identity("user");
        assert_eq!(project(&fixture(json!({})),&identity).unwrap()["legacyDetail"],"missing");
        let state=fixture(json!({"conversationDetailMode":"unknown-owner-value"}));let before=state.clone();
        let result=project(&state,&identity).unwrap();assert_eq!(result["legacyDetail"],"unbound");
        assert!(!result.to_string().contains("unknown-owner-value"));assert_eq!(state,before);
    }
}
