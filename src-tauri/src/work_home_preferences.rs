//! Restricted Work owner projection and explicit canonical-only mode activation.
use crate::{appshots_preferences::owner_key, chatgpt_service::ServiceIdentity};
use serde_json::{json, Map, Value};

const ATOMS: &str = "electron-persisted-atom-state";
const MARKER: &str = "electron-renderer-content-owner";
const WORK_MARKER: &str = "codex-native-work-content-owner";
const MODEL_VERSION: &str = "chatgpt-merged-model-picker-version-v1";
const KEYS: [&str; 5] = [
    "work-run-location-v1",
    "home-composer-mode-v1",
    "chatgpt-last-selected-home-model-v1",
    "chatgpt-last-selected-model-v1",
    "default-mode-request-user-input-enabled",
];

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkHomeModel {
    pub slug: String,
    #[serde(deserialize_with = "nullable")]
    pub thinking_effort: Option<WorkThinkingEffort>,
    #[serde(deserialize_with = "nullable")]
    pub version_id: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkThinkingEffort { Standard, Extended, Min, Max, Ultra, Xhigh, Zero }

fn nullable<'de, D: serde::Deserializer<'de>, T: serde::Deserialize<'de>>(deserializer: D) -> Result<Option<T>, D::Error> {
    serde::Deserialize::deserialize(deserializer)
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkHomeModelVersion {
    pub version_id: String,
    pub selection_mode: WorkVersionSelectionMode,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkVersionSelectionMode { Default, Model }

pub(crate) fn set_home_model(
    state: &Map<String, Value>, identity: &ServiceIdentity, model: &WorkHomeModel,
) -> Result<Map<String, Value>, String> {
    set_model_atom(state, identity, KEYS[2], serde_json::to_value(model).map_err(|_| "Work 首页模型格式无效。")?)
}

pub(crate) fn set_home_model_version(state: &Map<String, Value>, identity: &ServiceIdentity, version: &WorkHomeModelVersion) -> Result<Map<String, Value>, String> {
    set_model_atom(state, identity, MODEL_VERSION, serde_json::to_value(version).map_err(|_| "Work 模型版本格式无效。")?)
}

fn set_model_atom(state: &Map<String, Value>, identity: &ServiceIdentity, atom: &str, value: Value) -> Result<Map<String, Value>, String> {
    let bucket_key = owner_key(identity)?;
    let owner = bucket_key.strip_prefix("electron-owner-atoms:").unwrap();
    let live_owner = marker(state.get(MARKER))?.or(marker(state.get(WORK_MARKER))?);
    let mut next = state.clone();
    let mut bucket = dictionary(state.get(&bucket_key))?.cloned().unwrap_or_default();
    bucket.insert(atom.into(), value);
    next.insert(bucket_key.clone(), Value::Object(bucket));
    // Only this selected atom is superseded. Never adopt unrelated legacy
    // selection, change mode, or remove a foreign owner's live preferences.
    if live_owner.is_none() || live_owner == Some(owner) {
        if let Some(flat) = dictionary(state.get(ATOMS))? {
            if flat.contains_key(atom) {
                let mut flat = flat.clone();
                flat.remove(atom);
                next.insert(ATOMS.into(), Value::Object(flat));
            }
        }
    }
    project(&next, identity)?;
    Ok(next)
}

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
    for key in KEYS.into_iter().chain(std::iter::once(MODEL_VERSION)) {
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
    fn work_home_model_set_persists_home_only_and_removes_same_owner_flat_shadow() {
        let identity = identity("model-user");
        let key = owner_key(&identity).unwrap();
        let owner = key.strip_prefix("electron-owner-atoms:").unwrap();
        let raw = fixture(json!({MARKER:owner,ATOMS:{KEYS[2]:{"slug":"old"},KEYS[1]:"chat",KEYS[3]:{"slug":"last"},"other":41},
            key.clone():{KEYS[2]:{"slug":"bucket"},"unknown":"keep"},"selected-project":{"projectId":"legacy"}}));
        let state = crate::state::DesktopStateManager::fixture_for_appshots_preferences(raw.clone());
        let file = PrivateState::new();
        let model: WorkHomeModel = serde_json::from_value(json!({"slug":"work-model","thinkingEffort":"extended","versionId":"v2"})).unwrap();
        let ack = state.set_work_home_model_fixture(&identity, &model, &file.0, || Ok(())).unwrap();
        let disk: Value = serde_json::from_slice(&std::fs::read(&file.0).unwrap()).unwrap();
        assert_eq!(disk[&key][KEYS[2]], serde_json::to_value(&model).unwrap());
        assert!(disk[ATOMS].get(KEYS[2]).is_none());
        assert_eq!(disk[ATOMS][KEYS[1]], raw[ATOMS][KEYS[1]]);
        assert_eq!(disk[ATOMS][KEYS[3]], raw[ATOMS][KEYS[3]]);
        assert_eq!(disk["selected-project"], raw["selected-project"]);
        assert!(disk.get(WORK_MARKER).is_none());
        assert_eq!(disk[&key]["unknown"], "keep");
        assert_eq!(ack["atoms"][KEYS[2]], serde_json::to_value(&model).unwrap());
        assert_eq!(state.work_home_preferences(&identity).unwrap(), ack);
    }

    #[test]
    fn work_home_model_writers_leave_foreign_flat_and_all_unselected_atoms_untouched() {
        let identity = identity("model-user");
        let key = owner_key(&identity).unwrap();
        let model: WorkHomeModel = serde_json::from_value(json!({"slug":" Raw Model ","thinkingEffort":null,"versionId":null})).unwrap();
        for owner in [None, Some("foreign-owner")] {
            let mut raw = fixture(json!({ATOMS:{KEYS[2]:{"slug":"old"},KEYS[3]:{"slug":"last"},KEYS[1]:"chat",MODEL_VERSION:{"versionId":"old","selectionMode":"model"}},
                "selected-project":{"projectId":"unbound"},"unrelated":"keep"}));
            if let Some(owner) = owner { raw.insert(MARKER.into(),json!(owner)); }
            let next = set_home_model(&raw,&identity,&model).unwrap();
            assert_eq!(next[&key][KEYS[2]],serde_json::to_value(&model).unwrap());
            if owner.is_some() { assert_eq!(next[ATOMS],raw[ATOMS]); }
            else { assert!(next[ATOMS].get(KEYS[2]).is_none()); }
            assert_eq!(next[ATOMS][KEYS[3]],raw[ATOMS][KEYS[3]]);
            assert_eq!(next[ATOMS][KEYS[1]],raw[ATOMS][KEYS[1]]);
            assert_eq!(next[ATOMS][MODEL_VERSION],raw[ATOMS][MODEL_VERSION]);
            assert_eq!(next["selected-project"],raw["selected-project"]);
            assert!(next.get(WORK_MARKER).is_none());
            assert_eq!(project(&next,&identity).unwrap()["atoms"][KEYS[2]],serde_json::to_value(&model).unwrap());
        }
    }

    #[test]
    fn work_home_model_version_is_independent_and_unbound_until_explicitly_selected() {
        let identity = identity("version-user");
        let key = owner_key(&identity).unwrap();
        let raw = fixture(json!({ATOMS:{MODEL_VERSION:{"versionId":"legacy","selectionMode":"model"},KEYS[2]:{"slug":"home"},KEYS[3]:{"slug":"last"},KEYS[1]:"chat"}}));
        let before = project(&raw,&identity).unwrap();
        assert!(before["unboundAtoms"].as_array().unwrap().contains(&json!(MODEL_VERSION)));
        let state = crate::state::DesktopStateManager::fixture_for_appshots_preferences(raw.clone());
        let file = PrivateState::new();
        for (version_id,selection_mode) in [("latest",WorkVersionSelectionMode::Default),("v2",WorkVersionSelectionMode::Model)] {
            let version = WorkHomeModelVersion{version_id:version_id.into(),selection_mode};
            let ack = state.set_work_home_model_version_fixture(&identity,&version,&file.0,||Ok(())).unwrap();
            assert_eq!(ack["atoms"][MODEL_VERSION],serde_json::to_value(&version).unwrap());
            assert!(!ack["unboundAtoms"].as_array().unwrap().contains(&json!(MODEL_VERSION)));
            let disk:Value=serde_json::from_slice(&std::fs::read(&file.0).unwrap()).unwrap();
            assert_eq!(disk[&key][MODEL_VERSION],serde_json::to_value(&version).unwrap());
            assert!(disk[ATOMS].get(MODEL_VERSION).is_none());
            assert_eq!(disk[ATOMS][KEYS[2]],raw[ATOMS][KEYS[2]]);
            assert_eq!(disk[ATOMS][KEYS[3]],raw[ATOMS][KEYS[3]]);
            assert_eq!(disk[ATOMS][KEYS[1]],raw[ATOMS][KEYS[1]]);
            let blocked=file.0.parent().unwrap().join("blocked-version");std::fs::create_dir(&blocked).unwrap();
            assert_eq!(state.set_work_home_model_version_fixture(&identity,&version,&blocked,||Ok(())).unwrap(),ack,"same version does not attempt persistence");
            std::fs::remove_dir(blocked).unwrap();
        }
    }

    #[test]
    fn work_home_model_writes_fail_atomically_and_skip_unchanged_persistence() {
        let identity = identity("model-user");
        let model:WorkHomeModel=serde_json::from_value(json!({"slug":"home","thinkingEffort":"ultra","versionId":null})).unwrap();
        let raw=fixture(json!({ATOMS:{KEYS[2]:{"slug":"old"},"other":true}}));
        let state=crate::state::DesktopStateManager::fixture_for_appshots_preferences(raw.clone());
        let file=PrivateState::new();
        let blocked=file.0.parent().unwrap().join("blocked");std::fs::create_dir(&blocked).unwrap();
        assert!(state.set_work_home_model_fixture(&identity,&model,&blocked,||Ok(())).is_err());
        assert_eq!(state.get_value(ATOMS),raw[ATOMS]);
        assert_eq!(state.get_optional_value(&owner_key(&identity).unwrap()),None);
        let checks=std::cell::Cell::new(0);
        assert!(state.set_work_home_model_fixture(&identity,&model,&file.0,||{checks.set(checks.get()+1);if checks.get()==2 {Err("stale".into())} else {Ok(())}}).is_err());
        assert!(!file.0.exists());assert_eq!(state.get_value(ATOMS),raw[ATOMS]);
        let ack=state.set_work_home_model_fixture(&identity,&model,&file.0,||Ok(())).unwrap();
        assert_eq!(state.set_work_home_model_fixture(&identity,&model,&blocked,||Ok(())).unwrap(),ack);
        let version=WorkHomeModelVersion{version_id:"latest".into(),selection_mode:WorkVersionSelectionMode::Default};
        assert!(state.set_work_home_model_version_fixture(&identity,&version,&blocked,||Ok(())).is_err());
        assert_eq!(state.work_home_preferences(&identity).unwrap(),ack);
        std::fs::remove_dir(blocked).unwrap();
    }

    #[test]
    fn work_home_model_writers_reject_ambiguous_owner_or_bucket_without_overwrite() {
        let identity=identity("model-user");let key=owner_key(&identity).unwrap();
        let model:WorkHomeModel=serde_json::from_value(json!({"slug":"raw","thinkingEffort":null,"versionId":null})).unwrap();
        for raw in [fixture(json!({MARKER:{"unknown":true}})),fixture(json!({key.clone():false})),fixture(json!({ATOMS:false}))] {
            let original=raw.clone();assert!(set_home_model(&raw,&identity,&model).is_err());assert_eq!(raw,original);
        }
        let foreign=fixture(json!({MARKER:"foreign-owner",ATOMS:false}));
        assert!(set_home_model(&foreign,&identity,&model).is_ok(),"unrelated foreign malformed flat is not this writer input");
    }

    #[test]
    fn work_home_model_typed_values_reject_unknown_shapes_without_reinterpreting_effort() {
        for effort in ["standard","extended","min","max","ultra","xhigh","zero"] {
            assert!(serde_json::from_value::<WorkHomeModel>(json!({"slug":"raw","thinkingEffort":effort,"versionId":null})).is_ok());
        }
        for bad in [json!({"slug":"raw","thinkingEffort":"high","versionId":null}),json!({"slug":"raw","versionId":null}),json!({"slug":"raw","thinkingEffort":null}),json!({"slug":"raw","thinkingEffort":null,"versionId":null,"key":"arbitrary"})] {
            assert!(serde_json::from_value::<WorkHomeModel>(bad).is_err());
        }
        assert!(serde_json::from_value::<WorkHomeModelVersion>(json!({"versionId":"v2","selectionMode":"unknown"})).is_err());
        assert!(serde_json::from_value::<WorkHomeModelVersion>(json!({"versionId":"v2","selectionMode":"model","conversationId":"invented"})).is_err());
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
