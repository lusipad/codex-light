use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

// Keep the wire records intact, including fields or commands understood by a newer client.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct KeyBinding {
    pub command: String,
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Serialize)]
pub struct KeyBindingsRead {
    pub bindings: Vec<Value>,
    pub warning: Option<String>,
    pub revision: String,
}

#[derive(Default)]
pub struct KeyBindingsState(Mutex<()>, tokio::sync::Mutex<()>);

fn safe_records(bindings: &[Value]) -> bool {
    bindings.iter().all(|binding| binding.as_object().is_some_and(|record|
        record.get("command").is_some_and(Value::is_string)
            && record.get("key").is_some_and(|key| key.is_null() || key.is_string())))
}

fn content_revision(contents: &[u8]) -> String {
    // Exact bytes make revisions collision-free without adding a hashing dependency.
    format!("content:{}", base64::engine::general_purpose::STANDARD.encode(contents))
}

fn read_at(directory: &Path) -> Result<KeyBindingsRead, String> {
    if directory.is_file() {
        return Err(format!("Keybindings directory is a file: {}", directory.display()));
    }
    let path = directory.join("keybindings.json");
    match fs::read(&path) {
        Ok(contents) => {
            let revision = content_revision(&contents);
            match serde_json::from_slice::<Vec<Value>>(&contents) {
                Ok(bindings) if safe_records(&bindings) => Ok(KeyBindingsRead { bindings, warning: None, revision }),
                Ok(_) => Ok(KeyBindingsRead { bindings: Vec::new(), warning: Some("Invalid keybindings.json: unsupported record shape".into()), revision }),
                Err(error) => Ok(KeyBindingsRead {
                    bindings: Vec::new(),
                    warning: Some(format!("Invalid keybindings.json: {error}")),
                    revision,
                }),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(KeyBindingsRead { bindings: Vec::new(), warning: None, revision: "missing".into() })
        }
        Err(error) => Err(format!("Cannot read {}: {error}", path.display())),
    }
}

fn write_at(directory: &Path, mut bindings: Vec<Value>, expected_revision: &str) -> Result<KeyBindingsRead, String> {
    if !safe_records(&bindings) { return Err("Unsupported keybinding record shape; file was not changed".into()); }
    let previous = read_at(directory)?;
    if previous.revision != expected_revision {
        return Err("Keybindings changed since they were loaded; reload before saving".into());
    }
    if previous.warning.is_some() {
        return Err("Invalid keybindings.json must be repaired before saving; original file was not changed".into());
    }
    // Stable sorting preserves the order of duplicate bindings and unknown records.
    bindings.sort_by(|left, right| left.get("command").and_then(Value::as_str).unwrap_or("")
        .cmp(right.get("command").and_then(Value::as_str).unwrap_or("")));
    let contents = serde_json::to_string_pretty(&bindings).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("Cannot create keybindings directory: {error}"))?;
    let path = directory.join("keybindings.json");
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true);
    if expected_revision == "missing" { options.create_new(true); }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Keep other Windows processes from writing or replacing the file between check and write.
        options.share_mode(0);
    }
    let mut file = options.open(&path).map_err(|error| format!("Cannot lock {} for writing: {error}", path.display()))?;
    let mut current = Vec::new();
    file.read_to_end(&mut current).map_err(|error| format!("Cannot recheck keybindings: {error}"))?;
    if expected_revision != "missing" && content_revision(&current) != expected_revision {
        return Err("Keybindings changed since they were loaded; reload before saving".into());
    }
    file.seek(SeekFrom::Start(0)).and_then(|_| file.write_all(contents.as_bytes()))
        .and_then(|_| file.set_len(contents.len() as u64))
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))?;
    drop(file);
    let result = read_at(directory)
        .map_err(|error| format!("Keybindings saved but readback failed: {error}"))?;
    if let Some(warning) = &result.warning {
        return Err(format!("Keybindings saved but readback failed: {warning}"));
    }
    if result.bindings != bindings {
        return Err("Keybindings saved but readback did not match the written bindings".into());
    }
    Ok(result)
}

const NUMBER_TARGET_KEY: &str = "primary-number-shortcut-target";

fn number_target(snapshot: &Value, legacy: Value) -> Result<String, String> {
    let config = snapshot.get("config").and_then(Value::as_object).ok_or("快捷键配置响应无效。")?;
    let desktop = config.get("desktop");
    if desktop.is_some_and(|value| !value.is_null() && !value.is_object()) { return Err("桌面配置格式无效。".into()); }
    let value = desktop.and_then(|value| value.get(NUMBER_TARGET_KEY)).unwrap_or(&legacy);
    match value.as_str() {
        Some("tabs") => Ok("tabs".into()),
        Some("sidebar") => Ok("sidebar".into()),
        _ if value.is_null() => Ok("tabs".into()),
        _ => Err("编号快捷键目标配置无效。".into()),
    }
}

fn number_target_write_params(snapshot: &Value, value: &str) -> Result<Value, String> {
    if !["tabs", "sidebar"].contains(&value) { return Err("编号快捷键目标无效。".into()); }
    let layer = snapshot["layers"].as_array().and_then(|layers| layers.iter().find(|layer|
        layer["name"]["type"] == "user" && layer["name"]["profile"].is_null()))
        .ok_or("缺少用户配置层，未写入快捷键设置。")?;
    let path = layer["name"]["file"].as_str().filter(|value| !value.is_empty()).ok_or("用户配置路径无效。")?;
    let version = layer["version"].as_str().filter(|value| !value.is_empty()).ok_or("用户配置版本无效。")?;
    Ok(json!({"edits":[{"keyPath":format!("desktop.{NUMBER_TARGET_KEY}"),"value":value,"mergeStrategy":"replace"}],
        "filePath":path,"expectedVersion":version,"reloadUserConfig":true}))
}

#[tauri::command]
pub async fn keyboard_number_target_read(app: AppHandle, state: State<'_, crate::AppState>, preferences: State<'_, KeyBindingsState>) -> Result<Value, String> {
    let _guard = preferences.1.lock().await;
    let snapshot = state.app_server.call(&app, "config/read", Some(json!({"includeLayers":true}))).await?;
    Ok(json!({"value":number_target(&snapshot, state.desktop_state.get_value(NUMBER_TARGET_KEY))?}))
}

#[tauri::command]
pub async fn keyboard_number_target_write(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, preferences: State<'_, KeyBindingsState>, value: String) -> Result<Value, String> {
    if !["tabs", "sidebar"].contains(&value.as_str()) { return Err("编号快捷键目标无效。".into()); }
    let _guard = preferences.1.lock().await;
    let snapshot = state.app_server.call(&app, "config/read", Some(json!({"includeLayers":true}))).await?;
    let params = number_target_write_params(&snapshot, &value)?;
    let result = state.app_server.call(&app, "config/batchWrite", Some(params)).await?;
    if ![Some("ok"), Some("okOverridden")].contains(&result["status"].as_str()) {
        return Err("服务未确认编号快捷键设置写入。".into());
    }
    for label in app.webview_windows().keys().filter(|label| label.as_str() != window.label()) {
        let _ = app.emit_to(label.as_str(), "keyboard-bindings-changed", json!({"changed":true}));
    }
    let snapshot = state.app_server.call(&app, "config/read", Some(json!({"includeLayers":true}))).await
        .map_err(|error| format!("编号快捷键设置已保存，但读回失败：{error}"))?;
    let readback = number_target(&snapshot, Value::Null)?;
    if readback != value { return Err("编号快捷键设置已保存，但有效配置被其他配置层覆盖。".into()); }
    Ok(json!({"value":readback}))
}

#[tauri::command]
pub fn keyboard_bindings_read(state: State<'_, KeyBindingsState>) -> Result<KeyBindingsRead, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    read_at(&crate::state::codex_home_dir())
}

#[tauri::command]
pub fn keyboard_bindings_write(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, KeyBindingsState>,
    bindings: Vec<Value>,
    expected_revision: String,
) -> Result<KeyBindingsRead, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let result = write_at(&crate::state::codex_home_dir(), bindings, &expected_revision)?;
    for label in app.webview_windows().keys().filter(|label| label.as_str() != window.label()) {
        let _ = app.emit_to(label.as_str(), "keyboard-bindings-changed", json!({"changed": true}));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("codex-keybindings-{}", uuid::Uuid::new_v4()))
    }
    fn cleanup(directory: &Path) {
        fs::remove_file(directory.join("keybindings.json")).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn isolated_roundtrip_preserves_unknown_commands_versions_and_records() {
        let directory = directory();
        let initial = read_at(&directory).unwrap();
        assert_eq!(initial.revision, "missing");
        let bindings = vec![
            json!({"command":"z-future-command","key":"Ctrl+K Ctrl+Q","version":2,"future":{"keep":true}}),
            json!({"command":"nextTab","key":"Ctrl+PageDown","version":1}),
            json!({"command":"new-chat","key":null}),
        ];
        let result = write_at(&directory, bindings.clone(), &initial.revision).unwrap();
        assert!(result.warning.is_none());
        for binding in bindings { assert!(result.bindings.contains(&binding)); }
        let restarted = read_at(&directory).unwrap();
        assert_eq!(restarted.revision, result.revision);
        assert_eq!(restarted.bindings, result.bindings);
        cleanup(&directory);
    }

    #[test]
    fn external_edit_or_another_window_rejects_stale_write_without_overwriting() {
        let directory = directory();
        let first_window = read_at(&directory).unwrap();
        let second_window = read_at(&directory).unwrap();
        let saved = write_at(&directory, vec![json!({"command":"newTask","key":"Ctrl+N"})], &first_window.revision).unwrap();
        assert!(write_at(&directory, Vec::new(), &second_window.revision).is_err());
        assert_eq!(read_at(&directory).unwrap().bindings, saved.bindings);
        let external = b"[ {\"command\":\"future\",\"key\":null,\"extra\":7} ]";
        fs::write(directory.join("keybindings.json"), external).unwrap();
        assert!(write_at(&directory, Vec::new(), &saved.revision).is_err());
        assert_eq!(fs::read(directory.join("keybindings.json")).unwrap(), external);
        cleanup(&directory);
    }

    #[test]
    fn corrupt_file_cannot_be_silently_replaced_by_empty_defaults() {
        let directory = directory();
        fs::create_dir_all(&directory).unwrap();
        for malformed in [b"{\"bindings\":[]}".as_slice(), &[255, 254], b"".as_slice(), b"[null]".as_slice(), b"[{\"futureRecord\":true}]".as_slice()] {
            fs::write(directory.join("keybindings.json"), malformed).unwrap();
            let read = read_at(&directory).unwrap();
            assert!(read.bindings.is_empty());
            assert!(read.warning.is_some());
            assert!(write_at(&directory, Vec::new(), &read.revision).is_err());
            assert_eq!(fs::read(directory.join("keybindings.json")).unwrap(), malformed);
        }
        cleanup(&directory);
    }

    #[test]
    fn revisions_track_exact_file_bytes_and_missing_state() {
        assert_ne!(content_revision(b"[]"), content_revision(b"[ ]"));
        assert_ne!(content_revision(b""), "missing");
        assert_ne!(content_revision(&[255]), content_revision(&[254]));
        let binding: KeyBinding = serde_json::from_value(json!({"command":"nextTab","key":null,"version":1,"future":true})).unwrap();
        assert_eq!(serde_json::to_value(binding).unwrap(), json!({"command":"nextTab","key":null,"version":1,"future":true}));
    }

    #[test]
    fn storage_failure_is_visible() {
        let path = directory();
        fs::write(&path, "not a directory").unwrap();
        assert!(read_at(&path).is_err());
        assert!(write_at(&path, Vec::new(), "missing").is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn number_target_defaults_and_legacy_do_not_override_current_configuration() {
        assert_eq!(number_target(&json!({"config":{}}), Value::Null).unwrap(), "tabs");
        assert_eq!(number_target(&json!({"config":{}}), json!("sidebar")).unwrap(), "sidebar");
        assert_eq!(number_target(&json!({"config":{"desktop":{"primary-number-shortcut-target":"tabs"}}}), json!("sidebar")).unwrap(), "tabs");
        assert!(number_target(&json!({"config":{"desktop":[]}}), Value::Null).is_err());
        assert!(number_target(&json!({"config":{"desktop":{"primary-number-shortcut-target":"unknown"}}}), Value::Null).is_err());
    }

    #[test]
    fn number_target_writes_only_explicit_versioned_user_layer() {
        let snapshot = json!({"layers":[
            {"name":{"type":"project","file":"project/config.toml"},"version":"project"},
            {"name":{"type":"user","file":"home/config.toml"},"version":"user-v1"}]});
        let params = number_target_write_params(&snapshot, "sidebar").unwrap();
        assert_eq!(params["filePath"], "home/config.toml");
        assert_eq!(params["expectedVersion"], "user-v1");
        assert_eq!(params["edits"], json!([{"keyPath":"desktop.primary-number-shortcut-target","value":"sidebar","mergeStrategy":"replace"}]));
        assert_eq!(params["reloadUserConfig"], true);
        assert!(number_target_write_params(&snapshot, "recent").is_err());
        assert!(number_target_write_params(&json!({"layers":[]}), "tabs").is_err());
        assert!(number_target_write_params(&json!({"layers":[{"name":{"type":"user","file":"home/config.toml"}}]}), "tabs").is_err());
    }
}
