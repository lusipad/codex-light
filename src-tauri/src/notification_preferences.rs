use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct NotificationPreferencesState(Mutex<()>);

const KEYS: [&str; 5] = ["notifications-turn-mode", "notifications-permissions-enabled",
    "notifications-questions-enabled", "notifications-dot-enabled", "notifications-sound"];

fn valid_value(key: &str, value: &Value) -> bool {
    match key {
        "notifications-turn-mode" => value.as_str().is_some_and(|v| ["off", "unfocused", "always"].contains(&v)),
        "notifications-permissions-enabled" | "notifications-questions-enabled" | "notifications-dot-enabled" => value.is_boolean(),
        "notifications-sound" => {
            if value.as_str().is_some_and(|v| ["default", "classic", "none", "Basso", "Glass", "Ping", "Pop", "Purr", "Tink"].contains(&v)) { return true; }
            value.as_object().is_some_and(|v| v.get("name").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()) &&
                v.get("fileName").and_then(Value::as_str).is_some_and(|s| s.strip_prefix("codex-custom-").and_then(|s| s.strip_suffix(".wav"))
                    .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))))
        }
        _ => false,
    }
}

fn collect_values(snapshot: &Value, legacy: impl Fn(&str) -> Value) -> Result<Value, String> {
    let config = snapshot.get("config").and_then(Value::as_object).ok_or("通知配置响应无效。")?;
    let desktop = config.get("desktop");
    if desktop.is_some_and(|v| !v.is_null() && !v.is_object()) { return Err("桌面配置格式无效。".into()); }
    let mut values = Map::new();
    for key in KEYS { values.insert(key.into(), desktop.and_then(|d| d.get(key)).cloned().unwrap_or_else(|| legacy(key))); }
    Ok(Value::Object(values))
}

fn write_params(snapshot: &Value, key: &str, value: Value) -> Result<Value, String> {
    if !valid_value(key, &value) { return Err("通知设置字段或值无效。".into()); }
    let user = snapshot["layers"].as_array().and_then(|layers| layers.iter().find(|layer| layer["name"]["type"] == "user"))
        .ok_or("缺少用户配置层，未写入通知设置。")?;
    let file = user["name"]["file"].as_str().filter(|s| !s.is_empty()).ok_or("用户配置路径无效。")?;
    let version = user["version"].as_str().filter(|s| !s.is_empty()).ok_or("用户配置版本无效。")?;
    Ok(json!({"edits":[{"keyPath":format!("desktop.{key}"),"value":value,"mergeStrategy":"replace"}],
        "filePath":file,"expectedVersion":version,"reloadUserConfig":true}))
}

pub async fn read_effective(app: &AppHandle, host: &crate::AppState) -> Result<Value, String> {
    let snapshot = host.app_server.call(app, "config/read", Some(json!({"includeLayers":true}))).await?;
    collect_values(&snapshot, |key| host.desktop_state.get_value(key))
}

#[tauri::command]
pub async fn notification_preferences_read(app: AppHandle, host: State<'_, crate::AppState>, state: State<'_, NotificationPreferencesState>) -> Result<Value, String> {
    let _guard = state.0.lock().await;
    read_effective(&app, &host).await
}

#[tauri::command]
pub async fn notification_preference_write(app: AppHandle, window: WebviewWindow, host: State<'_, crate::AppState>, state: State<'_, NotificationPreferencesState>, key: String, value: Value) -> Result<(), String> {
    if !valid_value(&key, &value) { return Err("通知设置字段或值无效。".into()); }
    let _guard = state.0.lock().await;
    let snapshot = host.app_server.call(&app, "config/read", Some(json!({"includeLayers":true}))).await?;
    let params = write_params(&snapshot, &key, value)?;
    let result = host.app_server.call(&app, "config/batchWrite", Some(params)).await?;
    if ![Some("ok"), Some("okOverridden")].contains(&result["status"].as_str()) { return Err("服务未确认通知设置写入。".into()); }
    for label in app.webview_windows().keys().filter(|label| label.as_str() != window.label()) {
        let _ = app.emit_to(label.as_str(), "notification-preferences-changed", json!({"key":key}));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn user_versions_and_missing_only_legacy_preserve_independent_keys() {
        let source = json!({"config":{"desktop":{"notifications-turn-mode":"off","notifications-questions-enabled":false}},
            "layers":[{"name":{"type":"project","file":"project"},"version":"p"},{"name":{"type":"user","file":"home/config.toml"},"version":"v1"}]});
        let values = collect_values(&source, |_| json!(true)).unwrap();
        assert_eq!(values["notifications-turn-mode"], "off");
        assert_eq!(values["notifications-questions-enabled"], false);
        assert_eq!(values["notifications-permissions-enabled"], true);
        let params = write_params(&source, "notifications-sound", json!("none")).unwrap();
        assert_eq!(params["filePath"], "home/config.toml");
        assert_eq!(params["expectedVersion"], "v1");
        assert_eq!(params["edits"], json!([{"keyPath":"desktop.notifications-sound","value":"none","mergeStrategy":"replace"}]));
        assert!(collect_values(&json!({"config":{"desktop":[]}}), |_| Value::Null).is_err());
        assert!(write_params(&json!({"layers":[]}), "notifications-sound", json!("none")).is_err());
    }
    #[test]
    fn unsafe_custom_files_and_unrelated_keys_never_write() {
        assert!(valid_value("notifications-sound", &json!({"fileName":format!("codex-custom-{}.wav", "a".repeat(64)),"name":"声音"})));
        for value in [json!("../bad.wav"), json!({"fileName":"../bad.wav","name":"x"}), json!({"fileName":format!("codex-custom-{}.wav", "a".repeat(64)),"name":""})] {
            assert!(!valid_value("notifications-sound", &value));
        }
        assert!(!valid_value("model", &json!("x")));
        assert!(!valid_value("notifications-turn-mode", &json!(true)));
        assert!(!valid_value("notifications-questions-enabled", &json!("false")));
    }
}
