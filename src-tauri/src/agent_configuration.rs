use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use toml_edit::{DocumentMut, Item, Table};

#[derive(Default)]
pub struct AgentConfigurationState(pub tokio::sync::Mutex<()>);

fn managed(name: &Value) -> bool {
    matches!(
        name["type"].as_str(),
        Some(
            "mdm"
                | "sessionFlags"
                | "legacyManagedConfigTomlFromFile"
                | "legacyManagedConfigTomlFromMdm"
                | "enterpriseManaged"
        )
    )
}

fn file_path(name: &Value) -> Option<String> {
    match name["type"].as_str()? {
        "project" => Some(
            Path::new(name["dotCodexFolder"].as_str()?)
                .join("config.toml")
                .to_string_lossy()
                .into(),
        ),
        "user" | "system" | "legacyManagedConfigTomlFromFile" => {
            name["file"].as_str().map(str::to_owned)
        }
        _ => None,
    }
}

pub(crate) fn reject_links(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("配置路径必须是没有相对路径段的绝对路径。".into());
    }
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        if !matches!(part, Component::Normal(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                #[cfg(windows)]
                let linked = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0
                };
                #[cfg(not(windows))]
                let linked = metadata.file_type().is_symlink();
                if linked {
                    return Err("配置路径不能经过符号链接或目录联接。".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(format!("无法检查配置路径：{error}")),
        }
    }
    Ok(())
}

fn contents(path: &Path) -> Result<Option<String>, String> {
    reject_links(path)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取项目配置：{error}")),
    }
}

fn scopes(snapshot: &Value) -> Result<Vec<Value>, String> {
    let layers = snapshot["layers"]
        .as_array()
        .ok_or("缺少配置来源，无法安全编辑。")?;
    let mut projects = vec![];
    let mut user = None;
    let mut admin = None;
    for (index, layer) in layers.iter().enumerate() {
        let name = &layer["name"];
        let (id, kind, label, cwd) = match name["type"].as_str() {
            Some("project") => {
                let folder = name["dotCodexFolder"]
                    .as_str()
                    .ok_or("项目配置目录无效。")?;
                let root = Path::new(folder).parent().ok_or("项目配置目录无效。")?;
                (
                    format!("project:{folder}"),
                    "project",
                    root.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| root.to_string_lossy().into_owned()),
                    Some(root.to_string_lossy().into_owned()),
                )
            }
            Some("user") => ("user".into(), "user", "用户配置".into(), None),
            _ if managed(name) => (
                format!("managed:{index}"),
                "managed",
                "管理员配置".into(),
                None,
            ),
            _ => continue,
        };
        let path = file_path(name);
        let (text, path_error) = if kind == "project" {
            match path
                .as_deref()
                .ok_or_else(|| "项目配置路径无效。".to_owned())
                .and_then(|path| contents(Path::new(path)))
            {
                Ok(text) => (text, None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let entry = json!({"id":id,"kind":kind,"label":label,"filePath":path,"version":layer["version"],
            "config":layer.get("config").filter(|config| config.is_object()).cloned().unwrap_or_else(|| json!({})),
            "disabledReason":layer.get("disabledReason").filter(|reason| !reason.is_null()).cloned().or_else(|| path_error.map(Value::String)),
            "cwd":cwd,"contents":text});
        match kind {
            "project" => projects.push(entry),
            "user" => user = Some(entry),
            _ => {
                if admin.is_none() || name["type"] != "enterpriseManaged" {
                    admin = Some(entry);
                }
            }
        }
    }
    if let Some(user) = user {
        projects.push(user);
    }
    if let Some(admin) = admin {
        projects.push(admin);
    }
    Ok(projects)
}

async fn read(
    app: &AppHandle,
    state: &crate::AppState,
    cwd: Option<&str>,
) -> Result<Value, String> {
    let snapshot = state
        .app_server
        .call(
            app,
            "config/read",
            Some(json!({"includeLayers":true,"cwd":cwd})),
        )
        .await?;
    let requirements = state
        .app_server
        .call(app, "configRequirements/read", Some(json!({})))
        .await?;
    let scopes = scopes(&snapshot)?;
    let version = state.app_server.get_status().await.app_server_version;
    Ok(
        json!({"snapshot":snapshot,"requirements":requirements.get("requirements").cloned().unwrap_or(Value::Null),"serverVersion":version,"scopes":scopes}),
    )
}

fn key_value<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    key.split('.')
        .try_fold(value, |current, segment| current.get(segment))
}

fn supports_indexed(version: Option<&str>) -> bool {
    let Some(version) = version else {
        return false;
    };
    if version == "0.0.0" {
        return true;
    }
    let mut build_parts = version.split('+');
    let version = build_parts.next().unwrap_or(version);
    if let Some(build) = build_parts.next() {
        if build_parts.next().is_some()
            || !build.split('.').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
        {
            return false;
        }
    }
    let (core, suffix) = version
        .split_once('-')
        .map(|(core, suffix)| (core, Some(suffix)))
        .unwrap_or((version, None));
    if !core.split('.').all(|part| {
        !part.is_empty()
            && (part == "0" || !part.starts_with('0'))
            && part.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return false;
    }
    if suffix.is_some_and(|suffix| {
        !suffix.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && !(part.len() > 1
                    && part.starts_with('0')
                    && part.bytes().all(|byte| byte.is_ascii_digit()))
        })
    }) {
        return false;
    }
    let values = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>();
    let Ok(values) = values else {
        return false;
    };
    if values.len() != 3 {
        return false;
    }
    if values.as_slice() != [0, 142, 0] {
        return values.as_slice() > [0, 142, 0].as_slice();
    }
    match suffix {
        None => true,
        Some(suffix) => {
            let parts = suffix.split('.').collect::<Vec<_>>();
            if parts.first() != Some(&"alpha") {
                return parts.first().is_some_and(|part| *part > "alpha");
            }
            parts
                .get(1)
                .is_some_and(|part| part.parse::<u64>().map(|value| value >= 6).unwrap_or(true))
        }
    }
}

fn validate_value(
    key: &str,
    value: &Value,
    requirements: &Value,
    version: Option<&str>,
) -> Result<(), String> {
    let options: &[&str] = match key {
        "approval_policy" => &["on-request", "never"],
        "sandbox_mode" => &["read-only", "workspace-write", "danger-full-access"],
        "web_search" => &["disabled", "cached", "indexed", "live"],
        "model_verbosity" => &["low", "medium", "high"],
        "model_reasoning_summary" => &["auto", "concise", "detailed", "none"],
        "sandbox_workspace_write.network_access" if value.is_boolean() => return Ok(()),
        _ => return Err("不支持的配置键或值，未修改配置。".into()),
    };
    if value.is_null()
        && matches!(
            key,
            "model_verbosity" | "web_search" | "model_reasoning_summary"
        )
    {
        return Ok(());
    }
    let text = value
        .as_str()
        .filter(|text| options.contains(text))
        .ok_or("不支持的配置值，未修改配置。")?;
    let allowed_key = match key {
        "approval_policy" => Some("allowedApprovalPolicies"),
        "sandbox_mode" => Some("allowedSandboxModes"),
        "web_search" => Some("allowedWebSearchModes"),
        _ => None,
    };
    if let Some(allowed_key) = allowed_key {
        if let Some(allowed) = requirements
            .get(allowed_key)
            .filter(|value| !value.is_null())
        {
            let allowed = allowed.as_array().ok_or("配置限制格式未知，未修改配置。")?;
            if !(key == "web_search" && text == "disabled")
                && !allowed.iter().any(|value| value.as_str() == Some(text))
            {
                return Err("此选项受管理员策略限制，未修改配置。".into());
            }
        }
    }
    if key == "web_search" && text == "indexed" && !supports_indexed(version) {
        return Err("当前服务版本未确认支持索引网页搜索。".into());
    }
    Ok(())
}

fn selected_scope<'a>(data: &'a Value, id: &str) -> Result<&'a Value, String> {
    data["scopes"]
        .as_array()
        .and_then(|scopes| scopes.iter().find(|scope| scope["id"] == id))
        .ok_or_else(|| "配置范围已变化，请刷新后重试。".into())
}

fn validate_scope(
    data: &Value,
    scope: &Value,
    key: &str,
    value: &Value,
    expected: Option<&str>,
) -> Result<(), String> {
    if scope["kind"] == "managed"
        || scope["filePath"].as_str().is_none()
        || !scope["disabledReason"].is_null()
    {
        return Err("此配置范围不可编辑。".into());
    }
    if expected.is_none_or(str::is_empty) || scope["version"].as_str() != expected {
        return Err("配置已改变，请刷新后重试。".into());
    }
    let origins = &data["snapshot"]["origins"];
    let origin = origins.get(key).or_else(|| {
        if key == "approval_policy" {
            origins.get("approval_policy.approvalPolicy")
        } else {
            None
        }
    });
    let origin = origin.or_else(|| {
        if key == "sandbox_workspace_write.network_access" {
            origins.get("sandbox_workspace_write")
        } else {
            None
        }
    });
    if origin.is_some_and(|origin| managed(&origin["name"])) {
        return Err("此值由管理员策略管理。".into());
    }
    let current =
        key_value(&scope["config"], key).or_else(|| key_value(&data["snapshot"]["config"], key));
    if current.is_some_and(|value| {
        if value.is_null() {
            return false;
        }
        match key {
            "approval_policy" => !matches!(
                value.as_str(),
                Some("on-request" | "never" | "untrusted" | "on-failure")
            ),
            "sandbox_mode" => !matches!(
                value.as_str(),
                Some("read-only" | "workspace-write" | "danger-full-access")
            ),
            "sandbox_workspace_write.network_access" => !value.is_boolean(),
            "web_search" => !matches!(
                value.as_str(),
                Some("disabled" | "cached" | "indexed" | "live")
            ),
            "model_verbosity" => !matches!(value.as_str(), Some("low" | "medium" | "high")),
            "model_reasoning_summary" => !matches!(
                value.as_str(),
                Some("auto" | "concise" | "detailed" | "none")
            ),
            _ => true,
        }
    }) {
        return Err("当前配置为复杂策略，请直接编辑 config.toml，未覆盖原值。".into());
    }
    validate_value(
        key,
        value,
        &data["requirements"],
        data["serverVersion"].as_str(),
    )?;
    if key == "sandbox_workspace_write.network_access" {
        let mode = scope["config"]
            .get("sandbox_mode")
            .or_else(|| data["snapshot"]["config"].get("sandbox_mode"));
        if mode.and_then(Value::as_str) != Some("workspace-write") {
            return Err("仅工作空间写入模式支持修改网络访问。".into());
        }
    }
    Ok(())
}

fn patch_project(source: &str, key: &str, value: &Value) -> Result<String, String> {
    let mut document = source
        .parse::<DocumentMut>()
        .map_err(|_| "项目 config.toml 格式无效，未修改文件。")?;
    let mut replacement = if let Some(text) = value.as_str() {
        toml_edit::Value::from(text)
    } else if let Some(value) = value.as_bool() {
        toml_edit::Value::from(value)
    } else if value.is_null() {
        toml_edit::Value::from("")
    } else {
        return Err("不支持的配置值。".into());
    };
    let table = if key == "sandbox_workspace_write.network_access" {
        if document
            .get("sandbox_workspace_write")
            .is_some_and(|item| item.as_inline_table().is_some())
        {
            return Err("此项目使用内联沙盒表，请直接编辑 config.toml 以更改网络访问。".into());
        }
        if !document.contains_key("sandbox_workspace_write") {
            document["sandbox_workspace_write"] = Item::Table(Table::new());
        }
        document["sandbox_workspace_write"]
            .as_table_mut()
            .ok_or("沙盒配置不是可编辑表。")?
    } else {
        document.as_table_mut()
    };
    let leaf = key.rsplit('.').next().ok_or("配置键无效。")?;
    let mut removed_comments = String::new();
    if value.is_null() {
        if let Some(key) = table.key(leaf) {
            removed_comments.push_str(
                key.leaf_decor()
                    .prefix()
                    .and_then(|raw| raw.as_str())
                    .unwrap_or(""),
            );
        }
        if let Some(suffix) = table
            .get(leaf)
            .and_then(Item::as_value)
            .and_then(|value| value.decor().suffix())
            .and_then(|raw| raw.as_str())
        {
            if let Some(index) = suffix.find('#') {
                removed_comments.push_str(&suffix[index..]);
                removed_comments.push('\n');
            }
        }
        table.remove(leaf);
    } else {
        if let Some(existing) = table.get_mut(leaf) {
            if let Some(old) = existing.as_value() {
                *replacement.decor_mut() = old.decor().clone();
            }
            // Table::insert formats the existing key, dropping its leading comments.
            *existing = Item::Value(replacement);
        } else {
            table.insert(leaf, Item::Value(replacement));
        }
    }
    let result = format!("{removed_comments}{document}");
    result
        .parse::<DocumentMut>()
        .map_err(|_| "修改后的项目配置无效，未写入文件。")?;
    Ok(result)
}

#[derive(PartialEq, Debug, Hash)]
pub(crate) struct DirectoryIdentity {
    canonical: PathBuf,
    created: Option<std::time::SystemTime>,
    #[cfg(windows)]
    file_id: (u32, u32, u32),
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

pub(crate) fn directory_identity(path: &Path) -> Result<DirectoryIdentity, String> {
    reject_links(path)?;
    let metadata = fs::metadata(path).map_err(|error| format!("无法检查项目配置目录：{error}"))?;
    if !metadata.is_dir() {
        return Err("项目配置父路径不是目录。".into());
    }
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    #[cfg(windows)]
    let file_id = {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        #[link(name = "kernel32")]
        extern "system" {
            fn GetFileInformationByHandle(handle: *mut std::ffi::c_void, info: *mut u32) -> i32;
        }
        let directory = OpenOptions::new()
            .read(true)
            .share_mode(7)
            .custom_flags(0x02200000)
            .open(path)
            .map_err(|error| error.to_string())?;
        // BY_HANDLE_FILE_INFORMATION is thirteen consecutive DWORDs.
        let mut information = [0_u32; 13];
        if unsafe {
            GetFileInformationByHandle(directory.as_raw_handle(), information.as_mut_ptr())
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        (information[7], information[11], information[12])
    };
    Ok(DirectoryIdentity {
        canonical: fs::canonicalize(path).map_err(|error| error.to_string())?,
        created: metadata.created().ok(),
        #[cfg(windows)]
        file_id,
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
    })
}

fn write_project(
    path: &Path,
    expected: Option<&str>,
    key: &str,
    value: &Value,
) -> Result<(), String> {
    reject_links(path)?;
    let parent = path.parent().ok_or("项目配置目录无效。")?;
    let identity = directory_identity(parent)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if expected.is_none() {
        options.create_new(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Keep external writers/deleters out while comparing and updating this exact file.
        options.share_mode(0).custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("项目配置已变化或正被占用，请刷新后重试：{error}"))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("项目配置不是普通文件。".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("项目配置已被替换为链接。".into());
        }
    }
    let mut source = String::new();
    file.read_to_string(&mut source)
        .map_err(|error| format!("无法读取项目配置：{error}"))?;
    if expected.is_some_and(|expected| source != expected)
        || expected.is_none() && !source.is_empty()
    {
        return Err("项目配置原文已改变，请刷新后重试。".into());
    }
    let output = match patch_project(&source, key, value) {
        Ok(output) => output,
        Err(error) => {
            drop(file);
            if expected.is_none() {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
    };
    reject_links(path)?;
    if identity != directory_identity(parent)? {
        return Err("项目配置目录已被替换，未修改文件。".into());
    }
    if output == source {
        return Ok(());
    }
    let replace = |file: &mut fs::File, text: &str| -> std::io::Result<()> {
        file.seek(SeekFrom::Start(0))?;
        file.write_all(text.as_bytes())?;
        file.set_len(text.len() as u64)?;
        file.sync_all()
    };
    if let Err(error) = replace(&mut file, &output) {
        let restored = replace(&mut file, &source).is_ok();
        return Err(format!(
            "项目配置写入失败：{error}；原文恢复{}。",
            if restored {
                "成功"
            } else {
                "失败，请检查文件"
            }
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut verified = String::new();
    file.read_to_string(&mut verified)
        .map_err(|error| error.to_string())?;
    if verified != output {
        return Err("项目配置写入后的文件与预期不符。".into());
    }
    drop(file);
    reject_links(path)?;
    if identity != directory_identity(parent)?
        || fs::read_to_string(path).ok().as_deref() != Some(output.as_str())
    {
        return Err("项目配置写入后路径已变化，请重新读取。".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_configuration_read(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    configuration: State<'_, AgentConfigurationState>,
    cwd: Option<String>,
) -> Result<Value, String> {
    let _guard = configuration.0.lock().await;
    read(&app, &state, cwd.as_deref()).await
}

#[tauri::command]
pub async fn agent_configuration_write(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
    configuration: State<'_, AgentConfigurationState>,
    cwd: Option<String>,
    scope_id: String,
    key_path: String,
    value: Value,
    expected_version: Option<String>,
    expected_contents: Option<String>,
) -> Result<Value, String> {
    let _guard = configuration.0.lock().await;
    let before = read(&app, &state, cwd.as_deref()).await?;
    let scope = selected_scope(&before, &scope_id)?;
    validate_scope(
        &before,
        scope,
        &key_path,
        &value,
        expected_version.as_deref(),
    )?;
    let path = scope["filePath"].as_str().ok_or("配置文件不可用。")?;
    reject_links(Path::new(path))?;
    if scope["kind"] == "project" {
        if scope["contents"].as_str() != expected_contents.as_deref() {
            return Err("项目配置原文已改变，请刷新后重试。".into());
        }
        write_project(
            Path::new(path),
            expected_contents.as_deref(),
            &key_path,
            &value,
        )?;
    } else {
        let response = state.app_server.call(&app, "config/value/write", Some(json!({"keyPath":key_path,"value":value,
            "mergeStrategy":if value.is_null() {"replace"} else {"upsert"},"filePath":path,"expectedVersion":expected_version,"reloadUserConfig":true}))).await?;
        if ![Some("ok"), Some("okOverridden")].contains(&response["status"].as_str()) {
            return Err("服务未确认配置写入。".into());
        }
    }
    for label in app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() != window.label())
    {
        let _ = app.emit_to(
            label.as_str(),
            "agent-configuration-changed",
            json!({"changed":true}),
        );
    }
    let after = read(&app, &state, cwd.as_deref())
        .await
        .map_err(|error| format!("配置已保存，但重新读取失败：{error}"))?;
    let stored = key_value(&selected_scope(&after, &scope_id)?["config"], &key_path);
    if if value.is_null() {
        stored.is_some_and(|stored| !stored.is_null())
    } else {
        stored != Some(&value)
    } {
        return Err("配置已保存，但目标配置层读回不符，请刷新检查。".into());
    }
    Ok(after)
}

#[tauri::command]
pub async fn agent_configuration_open(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    configuration: State<'_, AgentConfigurationState>,
    cwd: Option<String>,
    scope_id: String,
) -> Result<(), String> {
    let _guard = configuration.0.lock().await;
    let data = read(&app, &state, cwd.as_deref()).await?;
    let scope = selected_scope(&data, &scope_id)?;
    let path = scope["filePath"]
        .as_str()
        .ok_or("此配置来源没有可打开的文件。")?;
    reject_links(Path::new(path))?;
    crate::desktop_open::open_external(&state.desktop_state, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        json!({"snapshot":{"config":{"sandbox_mode":"workspace-write"},"origins":{}},"requirements":{},"serverVersion":"0.166.0-alpha.5.1","scopes":[]})
    }

    #[test]
    fn agent_configuration_restricts_keys_values_and_managed_origins() {
        let data = fixture();
        let scope = json!({"kind":"user","filePath":"C:/isolated/config.toml","version":"v1","config":{},"disabledReason":null});
        for (key, value) in [
            ("model", json!("m")),
            ("approval_policy", json!("untrusted")),
            ("model_verbosity", json!({"level":"low"})),
            ("sandbox_workspace_write.network_access", json!("true")),
        ] {
            assert!(validate_scope(&data, &scope, key, &value, Some("v1")).is_err());
        }
        assert!(validate_scope(
            &data,
            &scope,
            "approval_policy",
            &json!("on-request"),
            Some("v0")
        )
        .is_err());
        let mut data = data;
        data["snapshot"]["origins"]["approval_policy"] = json!({"name":{"type":"mdm"}});
        assert!(validate_scope(
            &data,
            &scope,
            "approval_policy",
            &json!("never"),
            Some("v1")
        )
        .is_err());
        let mut complex = scope.clone();
        complex["config"]["approval_policy"] = json!({"granular":{}});
        assert!(validate_scope(
            &fixture(),
            &complex,
            "approval_policy",
            &json!("never"),
            Some("v1")
        )
        .is_err());
    }

    #[test]
    fn agent_configuration_requires_allowed_options_and_supported_indexed() {
        let requirements = json!({"allowedApprovalPolicies":["on-request"],"allowedSandboxModes":["read-only"],"allowedWebSearchModes":["cached"]});
        assert!(validate_value("approval_policy", &json!("never"), &requirements, None).is_err());
        assert!(validate_value(
            "sandbox_mode",
            &json!("danger-full-access"),
            &requirements,
            None
        )
        .is_err());
        assert!(validate_value("web_search", &json!("disabled"), &requirements, None).is_ok());
        for version in [
            None,
            Some("unknown"),
            Some("0.141.0"),
            Some("0.142.0-alpha.5"),
        ] {
            assert!(!supports_indexed(version));
        }
        for version in [
            "0.0.0",
            "0.142.0-alpha.6",
            "0.142.0-beta.1",
            "0.142.0",
            "0.166.0-alpha.5.1",
        ] {
            assert!(supports_indexed(Some(version)));
        }
    }

    #[test]
    fn agent_configuration_project_patch_preserves_comments_multiline_and_other_keys() {
        let source = "# heading\nmodel_verbosity = \"low\" # note\nunknown = '''multiline\nunchanged'''\n\n[sandbox_workspace_write]\n# network\nnetwork_access = false # keep\n";
        let output = patch_project(source, "model_verbosity", &json!("high")).unwrap();
        assert!(output.contains("model_verbosity = \"high\" # note"));
        assert!(output.contains("unknown = '''multiline\nunchanged'''"));
        let output = patch_project(
            &output,
            "sandbox_workspace_write.network_access",
            &json!(true),
        )
        .unwrap();
        assert!(output.contains("# network\nnetwork_access = true # keep"));
        let quoted =
            "[sandbox_workspace_write]\n# keep quoted key\n\"network_access\" = false # retained\n";
        let quoted = patch_project(
            quoted,
            "sandbox_workspace_write.network_access",
            &json!(true),
        )
        .unwrap();
        assert!(quoted.contains("# keep quoted key\n\"network_access\" = true # retained"));
        let output = patch_project(&output, "model_verbosity", &Value::Null).unwrap();
        assert!(!output.contains("model_verbosity"));
        assert!(output.contains("# heading"));
        assert!(patch_project("[broken", "model_verbosity", &json!("high")).is_err());
        assert!(patch_project(
            "sandbox_workspace_write = { network_access = false }",
            "sandbox_workspace_write.network_access",
            &json!(true)
        )
        .is_err());
    }

    #[test]
    fn agent_configuration_project_file_roundtrip_cas_and_failure_preserve_source() {
        let root =
            std::env::temp_dir().join(format!("codex-agent-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("config.toml");
        let source = "# isolated\nmodel_verbosity = \"low\" # retained\n";
        fs::write(&file, source).unwrap();
        write_project(&file, Some(source), "model_verbosity", &json!("high")).unwrap();
        let saved = fs::read_to_string(&file).unwrap();
        assert!(saved.contains("\"high\" # retained"));
        assert!(write_project(&file, Some(source), "model_verbosity", &json!("low")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), saved);
        fs::write(&file, "bad = [").unwrap();
        assert!(write_project(&file, Some("bad = ["), "model_verbosity", &json!("low")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "bad = [");
        fs::remove_file(&file).unwrap();
        write_project(&file, None, "model_verbosity", &json!("medium")).unwrap();
        assert!(fs::read_to_string(&file).unwrap().contains("\"medium\""));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn agent_configuration_concurrent_project_writes_do_not_silently_overwrite() {
        let root =
            std::env::temp_dir().join(format!("codex-agent-concurrent-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("config.toml");
        let source = "model_verbosity = \"low\"\n";
        fs::write(&file, source).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads = ["medium", "high"]
            .into_iter()
            .map(|level| {
                let file = file.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    write_project(&file, Some(source), "model_verbosity", &json!(level))
                })
            })
            .collect::<Vec<_>>();
        let succeeded = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(Result::is_ok)
            .count();
        assert_eq!(succeeded, 1);
        let result = fs::read_to_string(&file).unwrap();
        assert!(result.contains("\"medium\"") || result.contains("\"high\""));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn agent_configuration_detects_directory_replacement_and_rejects_relative_paths() {
        let root = std::env::temp_dir().join(format!("codex-agent-path-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let original = root.join("project");
        let replacement = root.join("replacement");
        fs::create_dir(&original).unwrap();
        fs::create_dir(&replacement).unwrap();
        let identity = directory_identity(&original).unwrap();
        let preserved = root.join("old-project");
        fs::rename(&original, &preserved).unwrap();
        fs::rename(&replacement, &original).unwrap();
        assert_ne!(identity, directory_identity(&original).unwrap());
        assert!(reject_links(Path::new("relative/config.toml")).is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
