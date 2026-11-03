use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppearancePreferencesState(Mutex<()>);

const KEYS: [&str; 8] = [
    "appearanceTheme", "sansFontSize", "codeFontSize", "reduced-motion-preference",
    "appearanceLightChromeTheme", "appearanceDarkChromeTheme",
    "appearanceLightCodeThemeId", "appearanceDarkCodeThemeId",
];

fn validate(key: &str, value: &Value) -> Result<(), String> {
    if !KEYS.contains(&key) { return Err("不支持的外观设置。".into()); }
    let valid = match key {
        "appearanceTheme" => value.as_str().is_some_and(|v| ["system", "light", "dark"].contains(&v)),
        "reduced-motion-preference" => value.as_str().is_some_and(|v| ["system", "on", "off"].contains(&v)),
        "sansFontSize" => value.as_f64().is_some_and(|v| (11.0..=16.0).contains(&v)),
        "codeFontSize" => value.as_f64().is_some_and(|v| (8.0..=24.0).contains(&v)),
        "appearanceLightChromeTheme" | "appearanceDarkChromeTheme" => valid_theme(value),
        _ => value.as_str().is_some_and(|v| [
            "ayu", "catppuccin", "codex", "dracula", "everforest", "github", "gruvbox",
            "linear", "lobster", "material", "matrix", "monokai", "absolutely", "night-owl",
            "nord", "notion", "og", "oscurange", "one", "proof", "raycast", "rose-pine",
            "sentry", "solarized", "temple", "tokyo-night", "vercel", "vscode-plus", "xcode",
        ].contains(&v)),
    };
    if valid { Ok(()) } else { Err("外观设置值无效。".into()) }
}

fn valid_theme(value: &Value) -> bool {
    let color = |v: &Value| v.as_str().is_some_and(|s| s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit()));
    let Some(theme) = value.as_object() else { return false; };
    let Some(fonts) = theme.get("fonts").and_then(Value::as_object) else { return false; };
    let Some(semantic) = theme.get("semanticColors").and_then(Value::as_object) else { return false; };
    ["accent", "surface", "ink"].iter().all(|key| color(&value[key]))
        && value["contrast"].as_u64().is_some_and(|v| v <= 100)
        && value["opaqueWindows"].is_boolean()
        && theme.get("accentSource").is_none_or(|v| v.as_str().is_some_and(|s| ["chatgpt", "custom"].contains(&s)))
        && ["code", "ui"].iter().all(|key| fonts.get(*key).is_some_and(|v| v.is_null() || v.is_string()))
        && fonts.get("content").is_none_or(|v| v.is_null() || v.is_string())
        && ["codeFace", "uiFace", "contentFace"].iter().all(|key| fonts.get(*key).is_none_or(|face|
            face.as_object().is_some_and(|fields| ["family", "fullName", "postscriptName"].iter().all(|name| fields.get(*name).is_some_and(Value::is_string)))))
        && ["diffAdded", "diffRemoved", "skill"].iter().all(|key| semantic.get(*key).is_some_and(color))
}

fn collect_values(snapshot: &Value, legacy: impl Fn(&str) -> Value) -> Result<Value, String> {
    let config = snapshot.get("config").and_then(Value::as_object).ok_or("外观配置响应无效。")?;
    let desktop = config.get("desktop");
    if desktop.is_some_and(|v| !v.is_null() && !v.is_object()) { return Err("桌面配置格式无效。".into()); }
    let mut result = Map::new();
    for key in KEYS {
        let mut value = desktop.and_then(|v| v.get(key)).cloned().unwrap_or_else(|| legacy(key));
        if key.ends_with("ChromeTheme") {
            if let Some(fonts) = value.get_mut("fonts").and_then(Value::as_object_mut) {
                for name in ["code", "ui", "content"] { fonts.entry(name).or_insert(Value::Null); }
            }
        }
        result.insert(key.to_owned(), value);
    }
    Ok(Value::Object(result))
}

fn write_params(snapshot: &Value, key: &str, mut value: Value) -> Result<Value, String> {
    validate(key, &value)?;
    if key.ends_with("ChromeTheme") {
        if let Some(fonts) = value.get_mut("fonts").and_then(Value::as_object_mut) {
            for name in ["code", "ui", "content"] {
                if fonts.get(name).is_some_and(Value::is_null) { fonts.remove(name); }
            }
        }
    }
    let layer = snapshot["layers"].as_array().and_then(|layers| layers.iter().find(|layer|
        layer["name"]["type"] == "user" && layer["name"]["profile"].is_null()))
        .ok_or("缺少用户配置层，未写入外观设置。")?;
    let path = layer["name"]["file"].as_str().filter(|s| !s.is_empty()).ok_or("用户配置路径无效。")?;
    let version = layer["version"].as_str().filter(|s| !s.is_empty()).ok_or("用户配置版本无效。")?;
    Ok(json!({"edits":[{"keyPath":format!("desktop.{key}"),"value":value,"mergeStrategy":"replace"}],
        "filePath":path,"expectedVersion":version,"reloadUserConfig":true}))
}

#[tauri::command]
pub async fn appearance_preferences_read(app: AppHandle, state: State<'_, crate::AppState>, preferences: State<'_, AppearancePreferencesState>) -> Result<Value, String> {
    let _guard = preferences.0.lock().await;
    let snapshot = state.app_server.call(&app, "config/read", Some(json!({"includeLayers":true}))).await?;
    collect_values(&snapshot, |key| state.desktop_state.get_value(key))
}

#[tauri::command]
pub async fn appearance_preference_write(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, preferences: State<'_, AppearancePreferencesState>, key: String, value: Value) -> Result<(), String> {
    validate(&key, &value)?;
    let _guard = preferences.0.lock().await;
    let snapshot = state.app_server.call(&app, "config/read", Some(json!({"includeLayers":true}))).await?;
    let params = write_params(&snapshot, &key, value)?;
    let result = state.app_server.call(&app, "config/batchWrite", Some(params)).await?;
    if ![Some("ok"), Some("okOverridden")].contains(&result["status"].as_str()) {
        return Err("服务未确认外观设置写入。".into());
    }
    // A committed write remains successful if a closing webview cannot receive its event.
    for label in app.webview_windows().keys().filter(|label| label.as_str() != window.label()) {
        let _ = app.emit_to(label.as_str(), "appearance-preferences-changed", json!({"key":key}));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_is_used_only_for_missing_keys_and_user_layer_is_explicit() {
        let snapshot = json!({"config":{"desktop":{"appearanceTheme":"light"}},"layers":[
            {"name":{"type":"project","file":"project/config.toml"},"version":"project"},
            {"name":{"type":"user","file":"home/config.toml"},"version":"user-v1"}]});
        let values = collect_values(&snapshot, |_| json!("legacy")).unwrap();
        assert_eq!(values["appearanceTheme"], "light");
        assert_eq!(values["appearanceDarkCodeThemeId"], "legacy");
        let params = write_params(&snapshot, "appearanceTheme", json!("dark")).unwrap();
        assert_eq!(params["filePath"], "home/config.toml");
        assert_eq!(params["expectedVersion"], "user-v1");
        assert_eq!(params["edits"][0]["keyPath"], "desktop.appearanceTheme");
        assert!(write_params(&json!({"layers":[]}), "appearanceTheme", json!("dark")).is_err());
    }
    #[test]
    fn invalid_values_and_unknown_keys_never_create_config_edits() {
        assert!(validate("model", &json!("x")).is_err());
        assert!(validate("appearanceTheme", &json!("blue")).is_err());
        assert!(validate("sansFontSize", &json!(17)).is_err());
        assert!(validate("appearanceLightChromeTheme", &json!({"accent":"#ff0000"})).is_err());
        assert!(collect_values(&json!({"config":{"desktop":[]}}), |_| Value::Null).is_err());
        let theme = json!({"accent":"#339cff","surface":"#181818","ink":"#ffffff","contrast":60,"opaqueWindows":false,
            "fonts":{"code":null,"ui":null},"semanticColors":{"diffAdded":"#112233","diffRemoved":"#445566","skill":"#778899"}});
        assert!(validate("appearanceDarkChromeTheme", &theme).is_ok());
        let snapshot = json!({"layers":[{"name":{"type":"user","file":"home/config.toml"},"version":"v1"}]});
        let params = write_params(&snapshot, "appearanceDarkChromeTheme", theme.clone()).unwrap();
        assert_eq!(params["edits"][0]["value"]["fonts"], json!({}));
        let restored = collect_values(&json!({"config":{"desktop":{"appearanceDarkChromeTheme":params["edits"][0]["value"]}}}), |_| Value::Null).unwrap();
        assert_eq!(restored["appearanceDarkChromeTheme"]["fonts"], json!({"ui":null,"code":null,"content":null}));
        let mut invalid = theme.clone(); invalid["contrast"] = json!(60.5);
        assert!(validate("appearanceDarkChromeTheme", &invalid).is_err());
    }
}
