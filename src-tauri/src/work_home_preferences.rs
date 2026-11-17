//! Read-only owner projection. No legacy adoption, migration, or default write.
use crate::{appshots_preferences::owner_key, chatgpt_service::ServiceIdentity};
use serde_json::{json, Map, Value};

const ATOMS: &str = "electron-persisted-atom-state";
const MARKER: &str = "electron-renderer-content-owner";
const KEYS: [&str; 5] = ["work-run-location-v1", "home-composer-mode-v1",
    "chatgpt-last-selected-home-model-v1", "chatgpt-last-selected-model-v1", "default-mode-request-user-input-enabled"];

fn dictionary(value: Option<&Value>) -> Result<Option<&Map<String, Value>>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(value)) => Ok(Some(value)),
        _ => Err("Work 偏好容器格式无效，未覆盖原记录。".into()),
    }
}

pub(crate) fn project(state: &Map<String, Value>, identity: &ServiceIdentity) -> Result<Value, String> {
    let bucket_key = owner_key(identity)?;
    let owner = bucket_key.strip_prefix("electron-owner-atoms:").unwrap();
    let marker = state.get(MARKER).and_then(Value::as_str);
    let bucket = dictionary(state.get(&bucket_key))?;
    // A foreign owner's live container is not this request's input, including
    // corrupt foreign data. Never return or enumerate its contents.
    let flat = if marker.is_none() || marker == Some(owner) { dictionary(state.get(ATOMS))? } else { None };
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
    } else if marker.is_none() || marker == Some(owner) {
        if state.contains_key("selected-project") {
            json!({"placement":"legacy-root","binding":"legacy-unbound"})
        } else if flat.is_some_and(|values| values.contains_key("selected-project")) {
            json!({"placement":"legacy-atom","binding":"legacy-unbound"})
        } else { json!({"placement":"missing","binding":"confirmed"}) }
    } else { json!({"placement":"missing","binding":"confirmed"}) };
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
    let legacy_detail = if state.contains_key("conversationDetailMode") { "unbound" } else { "missing" };
    Ok(json!({"owner":"bound","atoms":atoms,"unboundAtoms":unbound,"selectedProject":selected,"localProjects":local,"legacyDetail":legacy_detail}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity(user: &str) -> ServiceIdentity { ServiceIdentity { user_id:user.into(), account_id:"account".into(), generation:3 } }
    fn fixture(state: Value) -> Map<String, Value> { state.as_object().unwrap().clone() }
    #[test]
    fn same_owner_flat_overrides_bucket_without_exposing_other_keys_or_mutating_state() {
        let identity=identity("user"); let key=owner_key(&identity).unwrap(); let owner=key.strip_prefix("electron-owner-atoms:").unwrap();
        let state=fixture(json!({MARKER:owner,ATOMS:{KEYS[0]:"local", "unrelated":"private"},key.clone():{KEYS[0]:"cloud",KEYS[1]:"work","other":"private"}}));
        let before=state.clone();let result=project(&state,&identity).unwrap();
        assert_eq!(result["atoms"],json!({KEYS[0]:"local",KEYS[1]:"work"}));
        assert_eq!(result["owner"],"bound"); assert_eq!(state,before);
        assert!(!result.to_string().contains("private")); assert!(!result.to_string().contains(owner));
    }
    #[test]
    fn foreign_and_signed_out_flat_cannot_supply_work_values_or_selection() {
        for marker in ["other-owner","signed-out"] {
            let identity=identity("user");let key=owner_key(&identity).unwrap();
            let state=fixture(json!({MARKER:marker,ATOMS:{KEYS[0]:"cloud","selected-project":{"type":"chatgpt","projectId":"foreign"}},
                "selected-project":{"type":"chatgpt","projectId":"foreign"},key:{KEYS[0]:"local"}}));
            let result=project(&state,&identity).unwrap();assert_eq!(result["atoms"][KEYS[0]],"local");
            assert_eq!(result["selectedProject"]["placement"],"missing");assert!(!result.to_string().contains("foreign"));
        }
        let identity=identity("user");let key=owner_key(&identity).unwrap();
        let result=project(&fixture(json!({MARKER:"other-owner",ATOMS:["foreign-private"],key:{KEYS[0]:"local"}})),&identity).unwrap();
        assert_eq!(result["atoms"][KEYS[0]],"local"); assert!(!result.to_string().contains("foreign-private"));
        assert!(result["localProjects"].get("value").is_none());
    }
    #[test]
    fn unbound_legacy_values_block_instead_of_adopting_or_defaulting() {
        let identity=identity("user");let key=owner_key(&identity).unwrap();
        let state=fixture(json!({ATOMS:{KEYS[0]:null,"selected-project":{"projectId":"legacy"}},key:{KEYS[0]:"local",KEYS[1]:"work"}}));
        let before=state.clone();let result=project(&state,&identity).unwrap();
        assert_eq!(result["unboundAtoms"],json!([KEYS[0]])); assert!(result["atoms"].get(KEYS[0]).is_none());
        assert_eq!(result["atoms"][KEYS[1]],"work"); assert_eq!(result["selectedProject"]["binding"],"legacy-unbound");
        assert!(result["selectedProject"].get("value").is_none());assert_eq!(state,before);
    }
    #[test]
    fn owned_selection_wins_and_local_inventory_keeps_actual_storage_placement() {
        let identity=identity("user");let key=owner_key(&identity).unwrap();let owner=key.strip_prefix("electron-owner-atoms:").unwrap();
        let selected_key=format!("electron-owner-value:selected-project:{owner}");
        let state=fixture(json!({selected_key:null,"selected-project":{"projectId":"legacy"},
            "local-projects":{"root":{"id":"root","chatGptBacking":{"accountId":"a","userId":"u","projectId":"g-p-a"}}},
            ATOMS:{"local-projects":{"nested":{"id":"nested"}}}}));
        let result=project(&state,&identity).unwrap(); assert_eq!(result["selectedProject"]["placement"],"owner-value");
        assert_eq!(result["selectedProject"]["value"],Value::Null);assert_eq!(result["localProjects"]["placement"],"root");
        assert!(result["localProjects"]["value"].get("root").is_some());
        let nested=project(&fixture(json!({ATOMS:{"local-projects":{"nested":{"id":"nested"}}}})),&identity).unwrap();
        assert_eq!(nested["localProjects"]["placement"],"legacy-atom");
    }
    #[test]
    fn missing_null_and_invalid_containers_are_distinct() {
        let identity=identity("user");
        for state in [json!({}),json!({ATOMS:null})] {
            let result=project(&fixture(state),&identity).unwrap();assert_eq!(result["atoms"],json!({}));
            assert_eq!(result["selectedProject"]["placement"],"missing");
        }
        for state in [json!({ATOMS:[]}),json!({ATOMS:7}),json!({owner_key(&identity).unwrap():false})] {
            assert!(project(&fixture(state),&identity).is_err());
        }
        assert!(project(&fixture(json!({})),&ServiceIdentity {user_id:String::new(), ..identity}).is_err());
    }
    #[test]
    fn default_request_input_false_is_not_missing_or_an_unbound_default() {
        let identity=identity("user");let key=owner_key(&identity).unwrap();let owner=key.strip_prefix("electron-owner-atoms:").unwrap();
        let result=project(&fixture(json!({MARKER:owner,ATOMS:{KEYS[4]:false},key.clone():{KEYS[4]:true}})),&identity).unwrap();
        assert_eq!(result["atoms"][KEYS[4]],false);
        let unbound=project(&fixture(json!({ATOMS:{KEYS[4]:false}})),&identity).unwrap();
        assert_eq!(unbound["unboundAtoms"],json!([KEYS[4]]));assert!(unbound["atoms"].get(KEYS[4]).is_none());
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
