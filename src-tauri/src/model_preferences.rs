use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const ATOMS: &str = "electron-persisted-atom-state";
const RECENT: &str = "composer-recent-model-configurations-v1";

#[derive(Default)]
pub struct ModelPreferencesState(pub tokio::sync::Mutex<()>);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfiguration {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub service_tier: Option<String>,
}

fn configuration(config: &Value) -> ModelConfiguration {
    ModelConfiguration {
        model: config["model"].as_str().map(str::to_owned),
        reasoning_effort: config["model_reasoning_effort"].as_str().map(str::to_owned),
        service_tier: config["service_tier"].as_str().filter(|tier| *tier != "default").map(str::to_owned),
    }
}

fn user_layer(snapshot: &Value) -> Result<&Value, String> {
    let layers = snapshot["layers"].as_array().ok_or("模型配置缺少配置层。")?;
    layers.iter().rev().find(|layer| layer["name"]["type"] == "user")
        .filter(|layer| layer["name"]["file"].as_str().is_some_and(|path| !path.is_empty())
            && layer["version"].as_str().is_some_and(|version| !version.is_empty()))
        .ok_or_else(|| "模型配置缺少可写用户层或版本。".into())
}

fn recents(atoms: &Value) -> Result<Value, String> {
    if !atoms.is_null() && !atoms.is_object() { return Err("桌面持久状态格式无效，未覆盖原始数据。".into()); }
    let value = atoms.get(RECENT).cloned().unwrap_or_else(|| json!([]));
    if !value.is_array() { return Err("最近模型记录格式无效，未覆盖原始数据。".into()); }
    Ok(value)
}

fn recent_update(mut atoms: Value, mut selected: ModelConfiguration) -> Result<Value, String> {
    if selected.model.as_deref().is_none_or(|model| model.trim().is_empty()) {
        return Err("缺少已实际使用的模型。".into());
    }
    if selected.service_tier.as_deref() == Some("default") { selected.service_tier = None; }
    let previous = recents(&atoms)?;
    let fast = |tier: Option<&str>| matches!(tier, Some("fast" | "priority"));
    let mut next = vec![serde_json::to_value(&selected).map_err(|error| error.to_string())?];
    for entry in previous.as_array().unwrap() {
        // Unknown future records are retained verbatim, not decoded and rewritten.
        let duplicate = entry.get("version").is_none() && serde_json::from_value::<ModelConfiguration>(entry.clone()).ok().is_some_and(|old|
            old.model == selected.model && old.reasoning_effort == selected.reasoning_effort
                && (old.service_tier.as_deref().filter(|tier| *tier != "default") == selected.service_tier.as_deref()
                    || fast(old.service_tier.as_deref()) && fast(selected.service_tier.as_deref())));
        if !duplicate { next.push(entry.clone()); }
        if next.len() == 3 { break; }
    }
    if atoms.is_null() { atoms = json!({}); }
    atoms[RECENT] = json!(next);
    Ok(atoms)
}

async fn read(app: &AppHandle, state: &crate::AppState, cwd: Option<&str>) -> Result<Value, String> {
    let snapshot = state.app_server.call(app, "config/read", Some(json!({"includeLayers":true,"cwd":cwd}))).await?;
    let requirements = state.app_server.call(app, "configRequirements/read", Some(json!({}))).await?;
    let layer = user_layer(&snapshot)?;
    let (recent, warning) = match recents(&state.desktop_state.get_value(ATOMS)) {
        Ok(value) => (value, None), Err(error) => (json!([]), Some(error)),
    };
    Ok(json!({"config":snapshot["config"],"origins":snapshot["origins"],"layers":snapshot["layers"],
        "requirements":requirements,"revision":layer["version"],"userFile":layer["name"]["file"],
        "profile":snapshot["config"]["profile"],"defaults":configuration(&snapshot["config"]),"recents":recent,"warning":warning}))
}

#[tauri::command]
pub async fn model_preferences_read(app: AppHandle, state: State<'_, crate::AppState>, preferences: State<'_, ModelPreferencesState>, cwd: Option<String>) -> Result<Value, String> {
    let _guard = preferences.0.lock().await;
    read(&app, &state, cwd.as_deref()).await
}

fn write_params(snapshot: &Value, expected_version: &str, selected: &ModelConfiguration) -> Result<Value, String> {
    let layer = user_layer(snapshot)?;
    if layer["version"].as_str() != Some(expected_version) { return Err("模型默认配置已改变，请刷新后重试。".into()); }
    if [&selected.model, &selected.reasoning_effort, &selected.service_tier].iter().any(|value|
        value.as_deref().is_some_and(|text| text.trim().is_empty())) { return Err("模型配置不能包含空字符串。".into()); }
    // Legacy profiles are explicitly rejected by the current CLI. Never silently write root defaults instead.
    if snapshot["config"]["profile"].as_str().is_some() { return Err("当前配置使用旧版 profile；请先迁移到独立 profile 配置文件，未修改根默认值。".into()); }
    // An explicit standard selection must survive a catalog whose default tier is fast.
    let service_tier = selected.model.as_ref().map(|_| selected.service_tier.as_deref().unwrap_or("default"));
    Ok(json!({"edits":[
        {"keyPath":"model","value":selected.model,"mergeStrategy":"replace"},
        {"keyPath":"model_reasoning_effort","value":selected.reasoning_effort,"mergeStrategy":"replace"},
        {"keyPath":"service_tier","value":service_tier,"mergeStrategy":"replace"}],
        "filePath":layer["name"]["file"],"expectedVersion":expected_version,"reloadUserConfig":true}))
}

fn notify(app: &AppHandle, window: &WebviewWindow) {
    for label in app.webview_windows().keys().filter(|label| label.as_str() != window.label()) {
        let _ = app.emit_to(label.as_str(), "model-preferences-changed", json!({"changed":true}));
    }
}

#[tauri::command]
pub async fn model_preferences_write_default(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, preferences: State<'_, ModelPreferencesState>, cwd: Option<String>, expected_version: String, configuration: ModelConfiguration) -> Result<Value, String> {
    let _guard = preferences.0.lock().await;
    let mut configuration = configuration;
    if configuration.model.is_none() || configuration.service_tier.as_deref() == Some("default") { configuration.service_tier = None; }
    let snapshot = state.app_server.call(&app, "config/read", Some(json!({"includeLayers":true,"cwd":cwd}))).await?;
    let params = write_params(&snapshot, &expected_version, &configuration)?;
    let result = state.app_server.call(&app, "config/batchWrite", Some(params)).await?;
    if ![Some("ok"),Some("okOverridden")].contains(&result["status"].as_str()) { return Err("服务未确认模型默认设置写入。".into()); }
    notify(&app, &window);
    let snapshot = read(&app, &state, cwd.as_deref()).await.map_err(|error| format!("模型默认设置已保存，但读回失败：{error}"))?;
    if serde_json::from_value::<ModelConfiguration>(snapshot["defaults"].clone()).ok().as_ref() != Some(&configuration) {
        return Err("模型默认设置已保存，但有效值被其他配置层覆盖。".into());
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn model_recent_record(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, configuration: ModelConfiguration) -> Result<Value, String> {
    let atoms = state.desktop_state.update_value_persisted(ATOMS, |atoms| recent_update(atoms, configuration))?;
    notify(&app, &window);
    Ok(json!({"recents":recents(&atoms)?}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn choice(model: &str, tier: Option<&str>) -> ModelConfiguration { ModelConfiguration { model:Some(model.into()),reasoning_effort:Some("high".into()),service_tier:tier.map(str::to_owned) } }

    #[test]
    fn recent_deduplicates_fast_and_default_and_preserves_other_atoms() {
        let atoms=json!({"other":{"future":true},(RECENT):[{"model":"m","reasoningEffort":"high","serviceTier":"priority","extra":7},{"model":"n","reasoningEffort":"high","serviceTier":null}]});
        let next=recent_update(atoms,choice("m",Some("fast"))).unwrap();
        assert_eq!(next[RECENT].as_array().unwrap().len(),2);
        assert_eq!(next["other"],json!({"future":true}));
        let next=recent_update(next,choice("n",Some("default"))).unwrap();
        assert_eq!(next[RECENT][0]["serviceTier"],Value::Null);
        assert_eq!(next[RECENT].as_array().unwrap().len(),2);
    }

    #[test]
    fn recent_limits_three_preserves_unknown_and_rejects_corrupt_container() {
        let next=recent_update(json!({(RECENT):[{"future":1},{"future":2},{"future":3}]}),choice("m",None)).unwrap();
        assert_eq!(next[RECENT],json!([{"model":"m","reasoningEffort":"high","serviceTier":null},{"future":1},{"future":2}]));
        assert!(recent_update(json!({(RECENT):{}}),choice("m",None)).is_err());
        let future=json!({"model":"m","reasoningEffort":"high","serviceTier":null,"version":2});
        let next=recent_update(json!({(RECENT):[future.clone()]}),choice("m",None)).unwrap();
        assert_eq!(next[RECENT][1],future);
    }

    #[test]
    fn default_write_requires_user_version_and_does_not_overwrite_legacy_profile() {
        let snapshot=json!({"config":{},"layers":[{"name":{"type":"user","file":"C:/isolated/config.toml"},"version":"v1"}]});
        let params=write_params(&snapshot,"v1",&choice("m",None)).unwrap();
        assert_eq!(params["expectedVersion"],"v1");
        assert_eq!(params["edits"][0]["keyPath"],"model");
        assert_eq!(params["edits"][2]["value"],"default");
        let default=ModelConfiguration { model:None,reasoning_effort:None,service_tier:None };
        assert_eq!(write_params(&snapshot,"v1",&default).unwrap()["edits"][2]["value"],Value::Null);
        assert!(write_params(&snapshot,"v0",&choice("m",None)).is_err());
        let mut legacy=snapshot;legacy["config"]["profile"]=json!("work");
        assert!(write_params(&legacy,"v1",&choice("m",None)).is_err());
    }
}
