//! Local storage only. The caller must confirm ServiceIdentity and reject stale
//! continuations; an intro acceptance is neither a gate nor an OS permission.
use crate::{
    appshots_entry::{Destination, Hotkey},
    chatgpt_service::ServiceIdentity,
    notification_audio::sha256,
    state::DesktopStateManager,
};
use serde_json::Value;

const INTRO: &str = "has-accepted-appshot-intro";
const HOTKEY: &str = "appshotHotkey";

pub(crate) fn configured_hotkey(
    state: &DesktopStateManager,
) -> Result<(Option<String>, bool), String> {
    match state.get_optional_value(HOTKEY) {
        None => Ok((Some("DoubleAlt".into()), true)),
        Some(Value::Null) => Ok((None, false)),
        Some(Value::String(value)) => Ok((Some(value), false)),
        _ => Err("应用快照快捷键存储格式无效，未覆盖原记录。".into()),
    }
}

pub(crate) fn hotkey_value(hotkey: Option<Hotkey>) -> Value {
    match hotkey {
        Some(Hotkey::DoubleAlt) => Value::String("DoubleAlt".into()),
        Some(Hotkey::DoubleShift) => Value::String("DoubleShift".into()),
        None => Value::Null,
    }
}

pub(crate) fn write_hotkey(
    state: &DesktopStateManager,
    hotkey: Option<Hotkey>,
) -> Result<(), String> {
    state.update_value_persisted(HOTKEY, |_| Ok(hotkey_value(hotkey)))?;
    Ok(())
}

/// Unsupported existing custom strings stay visible without becoming defaults.
pub(crate) fn read_runtime_hotkey(state: &DesktopStateManager) -> Result<Option<Hotkey>, String> {
    let (configured, _) = configured_hotkey(state)?;
    Ok(match configured.as_deref() {
        Some("DoubleAlt") => Some(Hotkey::DoubleAlt),
        Some("DoubleShift") => Some(Hotkey::DoubleShift),
        _ => None,
    })
}

fn owner_key(identity: &ServiceIdentity) -> Result<String, String> {
    if identity.user_id.is_empty() || identity.account_id.is_empty() {
        return Err("尚未确认应用快照账号，未读取或写入接受状态。".into());
    }
    let owner = serde_json::to_vec(&[&identity.user_id, &identity.account_id])
        .map_err(|_| "无法编码应用快照账号身份。")?;
    Ok(format!("electron-owner-atoms:{}", sha256(&owner)))
}

fn intro_value(bucket: Option<&Value>) -> Result<bool, String> {
    let Some(bucket) = bucket else {
        return Ok(false);
    };
    let values = bucket.as_object().ok_or("应用快照账号偏好容器损坏。")?;
    match values.get(INTRO) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        _ => Err("应用快照介绍接受状态格式无效。".into()),
    }
}

fn accepted_bucket(bucket: Value) -> Result<Value, String> {
    let mut values = if bucket.is_null() {
        serde_json::Map::new()
    } else {
        bucket
            .as_object()
            .cloned()
            .ok_or("应用快照账号偏好容器损坏，未覆盖原记录。")?
    };
    values.insert(INTRO.into(), Value::Bool(true));
    Ok(Value::Object(values))
}

pub(crate) fn read_intro(
    state: &DesktopStateManager,
    identity: &ServiceIdentity,
) -> Result<bool, String> {
    intro_value(state.get_optional_value(&owner_key(identity)?).as_ref())
}

/// Call only for an explicit accepted continuation. Cancel/close has no write API.
pub(crate) fn accept_intro(
    state: &DesktopStateManager,
    identity: &ServiceIdentity,
) -> Result<bool, String> {
    state.update_value_persisted(&owner_key(identity)?, accepted_bucket)?;
    read_intro(state, identity)
}

/// The real config/read response, not a global-state or owner-atom alias.
pub(crate) fn read_destination(response: &Value) -> Result<Destination, String> {
    read_destination_setting(response).map(|(destination, _)| destination)
}

pub(crate) fn read_destination_setting(response: &Value) -> Result<(Destination, bool), String> {
    let config = response
        .get("config")
        .and_then(Value::as_object)
        .ok_or("尚未读取应用快照宿主配置。")?;
    let desktop = match config.get("desktop") {
        None | Some(Value::Null) => None,
        Some(Value::Object(value)) => Some(value),
        _ => return Err("应用快照桌面配置格式无效。".into()),
    };
    match desktop.and_then(|values| values.get("appshotDestination")) {
        Some(Value::String(value)) if value == "automatic" => Ok((Destination::Automatic, false)),
        Some(Value::String(value)) if value == "last-chat" => Ok((Destination::LastChat, false)),
        Some(Value::String(value)) if value == "new-chat" => Ok((Destination::NewChat, false)),
        // The official settings store drops enum-invalid fields, then reads
        // the registry default. This projection never rewrites the raw config.
        _ => Ok((Destination::Automatic, true)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};
    use std::fs;

    fn identity(user: &str, account: &str) -> ServiceIdentity {
        ServiceIdentity {
            user_id: user.into(),
            account_id: account.into(),
            generation: 1,
        }
    }
    fn fixture(value: Value) -> DesktopStateManager {
        DesktopStateManager::fixture_for_appshots_preferences(value.as_object().unwrap().clone())
    }

    #[test]
    fn configured_hotkey_preserves_custom_and_missing_versus_explicit_null() {
        assert_eq!(
            configured_hotkey(&fixture(json!({}))).unwrap(),
            (Some("DoubleAlt".into()), true)
        );
        assert_eq!(
            configured_hotkey(&fixture(json!({HOTKEY:null}))).unwrap(),
            (None, false)
        );
        for custom in ["Ctrl+Alt+A", "", "DoubleShift"] {
            let state = fixture(json!({HOTKEY:custom}));
            assert_eq!(
                configured_hotkey(&state).unwrap(),
                (Some(custom.into()), false)
            );
            assert_eq!(state.get_optional_value(HOTKEY), Some(json!(custom)));
            if custom != "DoubleShift" {
                assert_eq!(read_runtime_hotkey(&state).unwrap(), None);
                assert_eq!(state.get_optional_value(HOTKEY), Some(json!(custom)));
            }
        }
        assert!(configured_hotkey(&fixture(json!({HOTKEY:true}))).is_err());
    }

    #[test]
    fn hotkey_persistence_private_roundtrip_and_failed_write_keep_previous_value() {
        let root = std::env::temp_dir().join(format!("appshots-hotkey-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("state.json");
        let state = fixture(json!({HOTKEY:"Ctrl+Alt+A","sibling":17}));
        state
            .update_appshots_fixture(
                HOTKEY,
                |_| Ok(hotkey_value(Some(Hotkey::DoubleShift))),
                &path,
            )
            .unwrap();
        assert_eq!(
            configured_hotkey(&state).unwrap(),
            (Some("DoubleShift".into()), false)
        );
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk["sibling"], 17);
        assert_eq!(
            configured_hotkey(&fixture(disk)).unwrap(),
            (Some("DoubleShift".into()), false)
        );
        let blocked = root.join("directory");
        fs::create_dir(&blocked).unwrap();
        assert!(state
            .update_appshots_fixture(HOTKEY, |_| Ok(hotkey_value(None)), &blocked)
            .is_err());
        assert_eq!(
            configured_hotkey(&state).unwrap(),
            (Some("DoubleShift".into()), false)
        );
        state
            .update_appshots_fixture(HOTKEY, |_| Ok(hotkey_value(None)), &path)
            .unwrap();
        assert_eq!(configured_hotkey(&state).unwrap(), (None, false));
        fs::remove_file(path).unwrap();
        fs::remove_dir(blocked).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn appshots_preferences_owner_key_matches_json_stringify_order_not_generation() {
        let first = identity("user-a", "account-a");
        assert_eq!(
            owner_key(&first).unwrap(),
            "electron-owner-atoms:567b1ccd06bd57086baaf486a2b8bb6f3bc056178d6ea5109162d06cd42b62f1"
        );
        assert_eq!(
            owner_key(&ServiceIdentity {
                generation: 2,
                ..first.clone()
            })
            .unwrap(),
            owner_key(&first).unwrap()
        );
        assert_ne!(
            owner_key(&identity("user-b", "account-a")).unwrap(),
            owner_key(&first).unwrap()
        );
        assert_ne!(
            owner_key(&identity("user-a", "account-b")).unwrap(),
            owner_key(&first).unwrap()
        );
        let state = fixture(json!({}));
        for unknown in [identity("", "account-a"), identity("user-a", "")] {
            assert!(read_intro(&state, &unknown).is_err());
            assert!(
                accept_intro(&state, &unknown).is_err(),
                "invalid identity fails before any persisted write"
            );
        }
    }

    #[test]
    fn appshots_preferences_real_private_write_readback_preserves_owner_and_sibling_keys() {
        let root =
            std::env::temp_dir().join(format!("appshots-preferences-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("private-state.json");
        let first = identity("user-a", "account-a");
        let second = identity("user-a", "account-b");
        let third = identity("user-b", "account-a");
        let key = owner_key(&first).unwrap();
        let mut values = Map::new();
        values.insert("unrelated-top".into(), json!({"keep": true}));
        values.insert("electron-persisted-atom-state".into(), json!({INTRO: true}));
        values.insert(key.clone(), json!({"unknown-owner-atom": {"keep": [1,2]}}));
        let state = DesktopStateManager::fixture_for_appshots_preferences(values);
        for _ in 0..2 {
            assert!(
                !read_intro(&state, &first).unwrap(),
                "global acceptance cannot skip this owner's intro"
            );
            assert!(
                !path.exists(),
                "read/cancel without explicit accept performs no persistence"
            );
        }
        // Same updater and real locked persistence primitive used by accept_intro;
        // only its destination path is private. No process/global env is changed.
        state
            .update_appshots_fixture(&key, accepted_bucket, &path)
            .unwrap();
        assert!(read_intro(&state, &first).unwrap());
        assert!(!read_intro(&state, &second).unwrap());
        assert!(!read_intro(&state, &third).unwrap());
        let saved = fs::read(&path).unwrap();
        let disk: Value = serde_json::from_slice(&saved).unwrap();
        assert_eq!(disk[&key][INTRO], true);
        assert_eq!(disk[&key]["unknown-owner-atom"], json!({"keep":[1,2]}));
        assert_eq!(disk["unrelated-top"], json!({"keep": true}));
        let reopened = fixture(disk);
        assert!(read_intro(&reopened, &first).unwrap());
        assert!(!read_intro(&reopened, &second).unwrap());
        assert_eq!(
            fs::read(&path).unwrap(),
            saved,
            "reopen/read/cancel is still read-only"
        );

        let blocked = root.join("blocked");
        fs::create_dir(&blocked).unwrap();
        let other_key = owner_key(&second).unwrap();
        assert!(state
            .update_appshots_fixture(&other_key, accepted_bucket, &blocked)
            .is_err());
        assert!(
            !read_intro(&state, &second).unwrap(),
            "failed write cannot commit acceptance in memory"
        );
        assert_eq!(state.get_optional_value(&other_key), None);
        fs::remove_dir(blocked).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn appshots_preferences_invalid_buckets_and_unknown_values_never_enable_defaults() {
        let owner = identity("user-a", "account-a");
        let key = owner_key(&owner).unwrap();
        for bad in [json!([]), json!("unknown"), json!(1)] {
            let state = fixture(json!({key.clone(): bad.clone()}));
            assert!(read_intro(&state, &owner).is_err());
            assert!(accepted_bucket(bad).is_err());
        }
        assert!(intro_value(Some(&json!({INTRO:"true"}))).is_err());
        assert!(!intro_value(Some(&json!({INTRO:false}))).unwrap());
        assert!(intro_value(Some(&json!({INTRO:true}))).unwrap());
    }

    #[test]
    fn appshots_preferences_missing_hotkey_and_explicit_null_are_distinct() {
        assert_eq!(
            read_runtime_hotkey(&fixture(json!({}))).unwrap(),
            Some(Hotkey::DoubleAlt)
        );
        assert_eq!(read_runtime_hotkey(&fixture(json!({HOTKEY:null}))).unwrap(), None);
        assert_eq!(
            read_runtime_hotkey(&fixture(json!({HOTKEY:"DoubleShift"}))).unwrap(),
            Some(Hotkey::DoubleShift)
        );
        assert_eq!(
            read_runtime_hotkey(&fixture(json!({HOTKEY:"DoubleAlt"}))).unwrap(),
            Some(Hotkey::DoubleAlt)
        );
        for custom in ["Ctrl+Alt+A", ""] {
            let state = fixture(json!({HOTKEY:custom}));
            assert_eq!(read_runtime_hotkey(&state).unwrap(), None);
            assert_eq!(configured_hotkey(&state).unwrap().0.as_deref(), Some(custom));
        }
        for malformed in [json!(true), json!([])] {
            assert!(read_runtime_hotkey(&fixture(json!({HOTKEY:malformed}))).is_err());
        }
    }

    #[test]
    fn appshots_preferences_destination_uses_real_desktop_config_not_global_aliases() {
        assert_eq!(
            read_destination(&json!({"config":{}})).unwrap(),
            Destination::Automatic
        );
        for (value, expected) in [
            ("automatic", Destination::Automatic),
            ("last-chat", Destination::LastChat),
            ("new-chat", Destination::NewChat),
        ] {
            assert_eq!(
                read_destination(&json!({"config":{"desktop":{"appshotDestination":value}}}))
                    .unwrap(),
                expected
            );
        }
        assert!(read_destination(&json!({"appshotDestination":"last-chat"})).is_err());
        for unknown in [json!(null), json!(false), json!([]), json!("unknown")] {
            assert_eq!(
                read_destination(&json!({"config":{"desktop":{"appshotDestination":unknown}}}))
                    .unwrap(),
                Destination::Automatic
            );
        }
        assert!(read_destination(&json!({"config":{"desktop":[]}})).is_err());
    }

    #[test]
    fn destination_invalid_field_defaults_without_changing_response_or_private_disk() {
        let path = std::env::temp_dir().join(format!(
            "appshots-destination-{}.json",
            uuid::Uuid::new_v4()
        ));
        for raw in [
            json!(null),
            json!(17),
            json!("future-custom"),
            json!({"unknown":true}),
        ] {
            let response = json!({"config":{"desktop":{"appshotDestination":raw,"unrelated":42}}});
            let original = response.clone();
            let bytes = serde_json::to_vec(&response).unwrap();
            fs::write(&path, &bytes).unwrap();
            assert_eq!(
                read_destination_setting(&response).unwrap(),
                (Destination::Automatic, true)
            );
            assert_eq!(response, original);
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(path).unwrap();
        assert_eq!(
            read_destination_setting(&json!({"config":{}})).unwrap(),
            (Destination::Automatic, true)
        );
        assert_eq!(
            read_destination_setting(
                &json!({"config":{"desktop":{"appshotDestination":"automatic"}}})
            )
            .unwrap(),
            (Destination::Automatic, false)
        );
        for bad_parent in [json!(false), json!("unknown"), json!([])] {
            assert!(read_destination_setting(&json!({"config":{"desktop":bad_parent}})).is_err());
        }
        assert!(read_destination_setting(&json!({"config":null})).is_err());
    }
}
