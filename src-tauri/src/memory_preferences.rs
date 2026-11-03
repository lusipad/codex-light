use crate::agent_configuration::{directory_identity, reject_links};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const MEMORY_KEYS: [&str; 6] = [
    "features.memories",
    "memories.generate_memories",
    "memories.use_memories",
    "memories.disable_on_external_context",
    "memories.no_memories_if_mcp_or_web_search",
    "features.chronicle",
];

#[derive(Default)]
pub struct MemoryPreferencesState(tokio::sync::Mutex<()>);

fn value<'a>(source: &'a Value, key: &str) -> &'a Value {
    key.split('.').fold(source, |source, part| &source[part])
}

fn user(snapshot: &Value) -> Result<&Value, String> {
    snapshot["layers"]
        .as_array()
        .and_then(|layers| layers.iter().find(|layer| layer["name"]["type"] == "user"))
        .ok_or_else(|| "缺少真实用户配置层，无法读取记忆设置。".into())
}

fn host_id(file: &str) -> Result<String, String> {
    let path = Path::new(file);
    if !path.is_absolute() {
        return Err("执行主机配置路径无效。".into());
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
        {
            return Err("当前记忆设置仅支持本机 Windows 执行主机。".into());
        }
    }
    reject_links(path)?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    directory_identity(path.parent().ok_or("用户配置目录无效。")?)?.hash(&mut hash);
    Ok(format!("local:{:016x}", hash.finish()))
}

fn managed(snapshot: &Value, key: &str) -> bool {
    let mut path = key;
    loop {
        let origin = &snapshot["origins"][path]["name"]["type"];
        if matches!(
            origin.as_str(),
            Some(
                "mdm"
                    | "sessionFlags"
                    | "legacyManagedConfigTomlFromFile"
                    | "legacyManagedConfigTomlFromMdm"
                    | "enterpriseManaged"
            )
        ) {
            return true;
        }
        match path.rsplit_once('.') {
            Some((parent, _)) => path = parent,
            None => return false,
        }
    }
}

fn locked(snapshot: &Value, requirements: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let current = value(&snapshot["config"], key);
        if !current.is_null() && !current.is_boolean() {
            return Some("当前记忆配置格式未知，请在配置文件中核对。".into());
        }
        if managed(snapshot, key) {
            return Some("该设置由管理员策略管理。".into());
        }
        let mut parent = *key;
        while let Some((prefix, _)) = parent.rsplit_once('.') {
            let container = value(&snapshot["config"], prefix);
            if !container.is_null() && !container.is_object() {
                return Some("当前记忆配置格式未知，请在配置文件中核对。".into());
            }
            parent = prefix;
        }
        if let Some(feature) = key.strip_prefix("features.") {
            let required = &requirements["featureRequirements"][feature];
            if !required.is_null() {
                return Some("该功能由管理员策略固定。".into());
            }
        }
    }
    None
}

fn snapshot_data(
    snapshot: &Value,
    requirements: &Value,
    feature: Option<Value>,
    status: Value,
    status_error: Option<String>,
) -> Result<Value, String> {
    let layer = user(snapshot)?;
    let file = layer["name"]["file"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("用户配置文件无效。")?;
    let host = host_id(file)?;
    let mut feature = feature;
    if let Some(entry) = feature.as_mut() {
        let enabled = entry["enabled"].as_bool().ok_or("记忆功能目录响应无效。")?;
        entry["catalogEnabled"] = json!(enabled);
    }
    let disabled = if feature.is_none() {
        Some("当前执行主机未提供 Codex 记忆功能。".to_owned())
    } else if layer["name"].get("profile").is_some_and(|p| !p.is_null()) {
        Some("当前配置范围不支持在此处编辑。".to_owned())
    } else if let Some(reason) = layer["disabledReason"].as_str() {
        Some(reason.to_owned())
    } else if layer["version"].as_str().is_none_or(|s| s.is_empty()) {
        Some("用户配置版本不可用。".to_owned())
    } else {
        None
    };
    let enabled_lock = locked(
        snapshot,
        requirements,
        &[
            "features.memories",
            "memories.generate_memories",
            "memories.use_memories",
        ],
    );
    let external_lock = locked(
        snapshot,
        requirements,
        &[
            "memories.disable_on_external_context",
            "memories.no_memories_if_mcp_or_web_search",
        ],
    );
    let user_values = MEMORY_KEYS
        .into_iter()
        .map(|key| (key.to_owned(), value(&layer["config"], key).clone()))
        .collect::<Map<_, _>>();
    Ok(
        json!({"hostId":host,"hostName":std::env::var("COMPUTERNAME").unwrap_or_else(|_| "此设备".into()),
        "userFile":file,"version":layer["version"],"feature":feature,"config":snapshot["config"],
        "userValues":user_values,
        "origins":snapshot["origins"],"requirements":requirements,"status":status,"statusError":status_error,
        "chronicle":{"available":false},"disabledReason":disabled,
        "locks":{"enabled":enabled_lock,"externalContext":external_lock,"reset":null}}),
    )
}

async fn read_with<F, Fut>(call: &mut F) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let snapshot = call("config/read", json!({"includeLayers":true,"cwd":null})).await?;
    if !snapshot["config"].is_object() || !snapshot["origins"].is_object() {
        return Err("记忆配置响应无效。".into());
    }
    let requirements = call("configRequirements/read", json!({})).await?;
    let requirements = requirements
        .get("requirements")
        .cloned()
        .ok_or("缺少配置要求响应。")?;
    if !requirements.is_null() && !requirements.is_object() {
        return Err("配置要求格式无效。".into());
    }
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    let mut feature = None;
    loop {
        let page = call(
            "experimentalFeature/list",
            json!({"limit":100,"cursor":cursor}),
        )
        .await?;
        for entry in page["data"].as_array().ok_or("功能目录响应无效。")? {
            if entry["name"] == "memories" {
                if feature.is_some() {
                    return Err("功能目录包含重复记忆条目。".into());
                }
                feature = Some(entry.clone());
            }
        }
        cursor = page.get("nextCursor").cloned().unwrap_or(Value::Null);
        if cursor.is_null() {
            break;
        }
        let token = cursor
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("功能目录游标无效。")?;
        if !seen.insert(token.to_owned()) {
            return Err("功能目录分页未前进。".into());
        }
    }
    let (status, status_error) = if feature.is_some() {
        match call("memory/status", json!({})).await {
            Ok(status)
                if status["v2Ready"].is_boolean() && status["v2ConsolidatedThreads"].is_u64() =>
            {
                (status, None)
            }
            Ok(_) => (Value::Null, Some("记忆状态响应无效。".into())),
            Err(error) => (Value::Null, Some(error)),
        }
    } else {
        (Value::Null, None)
    };
    snapshot_data(&snapshot, &requirements, feature, status, status_error)
}

fn check_context(
    snapshot: &Value,
    expected_host: &str,
    expected_version: Option<&str>,
) -> Result<(), String> {
    if expected_host.is_empty() || snapshot["hostId"].as_str() != Some(expected_host) {
        return Err("执行主机已变化，请重新读取记忆设置。".into());
    }
    if let Some(expected) = expected_version {
        if expected.is_empty() || snapshot["version"].as_str() != Some(expected) {
            return Err("记忆配置已被其他窗口修改，请重新读取。".into());
        }
    }
    if let Some(reason) = snapshot["disabledReason"].as_str() {
        return Err(reason.to_owned());
    }
    Ok(())
}

fn groups(
    operation: &str,
    enabled: bool,
) -> Result<Vec<(&'static str, Vec<(&'static str, Value)>)>, String> {
    match operation {
        "enabled" => {
            let mut groups = vec![
                ("feature", vec![("features.memories", json!(enabled))]),
                (
                    "configuration",
                    vec![
                        ("memories.generate_memories", json!(enabled)),
                        ("memories.use_memories", json!(enabled)),
                    ],
                ),
            ];
            if !enabled {
                groups.push(("chronicle", vec![("features.chronicle", json!(false))]));
            }
            Ok(groups)
        }
        "external-context" => Ok(vec![(
            "configuration",
            vec![
                ("memories.disable_on_external_context", json!(!enabled)),
                ("memories.no_memories_if_mcp_or_web_search", Value::Null),
            ],
        )]),
        _ => Err("不支持的记忆设置操作。".into()),
    }
}

async fn write_with<F, Fut>(
    call: &mut F,
    expected_host: &str,
    expected_version: &str,
    operation: &str,
    enabled: bool,
) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let initial = read_with(call).await?;
    check_context(&initial, expected_host, Some(expected_version))?;
    let control = if operation == "enabled" {
        "enabled"
    } else {
        "externalContext"
    };
    if let Some(reason) = initial["locks"][control].as_str() {
        return Err(reason.to_owned());
    }
    if operation == "external-context" && initial["feature"]["enabled"] != true {
        return Err("请先启用 Codex 记忆功能。".into());
    }
    let mut current = initial.clone();
    let mut errors = Vec::new();
    for (name, edits) in groups(operation, enabled)? {
        check_context(&current, expected_host, None)?;
        // Rebase only our own preceding writes; an external change to a future target is a conflict.
        if edits
            .iter()
            .any(|(key, _)| value(&current["config"], key) != value(&initial["config"], key))
        {
            errors.push(format!("{name}：设置已在其他位置更改，未覆盖。"));
            continue;
        }
        let source = json!({"config":current["config"],"origins":current["origins"]});
        let keys = edits.iter().map(|(key, _)| *key).collect::<Vec<_>>();
        if let Some(reason) = locked(&source, &current["requirements"], &keys) {
            errors.push(format!("{name}：{reason}"));
            continue;
        }
        let params = json!({"filePath":current["userFile"],"expectedVersion":current["version"],"reloadUserConfig":true,
            "edits":edits.iter().map(|(key,value)|json!({"keyPath":key,"value":value,"mergeStrategy":"replace"})).collect::<Vec<_>>()});
        let result = call("config/batchWrite", params).await;
        match &result {
            Ok(result) if matches!(result["status"].as_str(), Some("ok" | "okOverridden")) => {}
            Ok(_) => errors.push(format!("{name}：服务未确认写入。")),
            Err(error) => errors.push(format!("{name}：{error}")),
        }
        // Never replay a failed/unknown mutation. Always show the actual state if it can be read.
        current = read_with(call)
            .await
            .map_err(|error| format!("记忆设置写入结果需核对，读回失败：{error}"))?;
        check_context(&current, expected_host, None)?;
        if result.is_ok()
            && edits.iter().any(|(key, desired)| {
                value(&current["config"], key) != desired
                    || current["userValues"][*key] != *desired
                    || (*key == "features.memories" && current["feature"]["enabled"] != *desired)
            })
        {
            errors.push(format!(
                "{name}：写入后用户层或有效值不同，请重新读取核对。"
            ));
        }
    }
    current["mutation"] = json!({"complete":errors.is_empty(),"errors":errors});
    Ok(current)
}

async fn reset_with<F, Fut>(call: &mut F, expected_host: &str) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let before = read_with(call).await?;
    check_context(&before, expected_host, None)?;
    let result = call("memory/reset", Value::Null).await?;
    if !result.is_object() {
        return Err("服务未确认记忆删除结果，请重新读取核对，未自动重试。".into());
    }
    let after = read_with(call)
        .await
        .map_err(|error| format!("服务已确认删除记忆，但读取后续状态失败：{error}"))?;
    check_context(&after, expected_host, None)?;
    Ok(json!({"snapshot":after,"reset":true,"chronicleCleared":false}))
}

fn changed(app: &AppHandle, window: &WebviewWindow, host_id: &str) {
    for label in app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() != window.label())
    {
        let _ = app.emit_to(
            label.as_str(),
            "memory-preferences-changed",
            json!({"hostId":host_id}),
        );
    }
}

#[tauri::command]
pub async fn memory_preferences_read(
    app: AppHandle,
    host: State<'_, crate::AppState>,
    state: State<'_, MemoryPreferencesState>,
) -> Result<Value, String> {
    let _guard = state.0.lock().await;
    read_with(&mut |method, params| host.app_server.call(&app, method, Some(params))).await
}

#[tauri::command]
pub async fn memory_preferences_write(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, crate::AppState>,
    state: State<'_, MemoryPreferencesState>,
    expected_host_id: String,
    expected_version: String,
    operation: String,
    value: bool,
) -> Result<Value, String> {
    let _guard = state.0.lock().await;
    let result = write_with(
        &mut |method, params| host.app_server.call(&app, method, Some(params)),
        &expected_host_id,
        &expected_version,
        &operation,
        value,
    )
    .await;
    // Even an uncertain write may have persisted. Other windows re-read, never assume success.
    changed(&app, &window, &expected_host_id);
    result
}

#[tauri::command]
pub async fn memory_preferences_reset(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, crate::AppState>,
    state: State<'_, MemoryPreferencesState>,
    expected_host_id: String,
) -> Result<Value, String> {
    let _guard = state.0.lock().await;
    let result = reset_with(
        &mut |method, params| host.app_server.call(&app, method, Some(params)),
        &expected_host_id,
    )
    .await;
    changed(&app, &window, &expected_host_id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    struct Mock {
        home: std::path::PathBuf,
        config: Value,
        requirements: Value,
        origins: Value,
        version: usize,
        fail_key: Option<&'static str>,
        lose_reply: bool,
        change_future_target: bool,
        loop_cursor: bool,
        status_error: bool,
        catalog_enabled: bool,
        freeze_catalog: bool,
        calls: Vec<(&'static str, Value)>,
    }
    impl Mock {
        fn new() -> Self {
            let home =
                std::env::temp_dir().join(format!("codex-memory-unit-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&home).unwrap();
            Self {
                home,
                config: json!({}),
                requirements: Value::Null,
                origins: json!({}),
                version: 0,
                fail_key: None,
                lose_reply: false,
                change_future_target: false,
                loop_cursor: false,
                status_error: false,
                catalog_enabled: false,
                freeze_catalog: false,
                calls: vec![],
            }
        }
        fn host(&self) -> String {
            host_id(self.home.join("config.toml").to_str().unwrap()).unwrap()
        }
        fn rpc(&mut self, method: &'static str, params: Value) -> Result<Value, String> {
            self.calls.push((method, params.clone()));
            match method {
                "config/read" => Ok(
                    json!({"config":self.config,"origins":self.origins,"layers":[{"name":{"type":"user","file":self.home.join("config.toml").to_str().unwrap()},"version":format!("v{}",self.version),"config":self.config}]}),
                ),
                "configRequirements/read" => Ok(json!({"requirements":self.requirements})),
                "experimentalFeature/list" if params["cursor"].is_null() => {
                    Ok(json!({"data":[{"name":"other","enabled":false}],"nextCursor":"second"}))
                }
                "experimentalFeature/list" => Ok(
                    json!({"data":[{"name":"memories","enabled":self.catalog_enabled,"defaultEnabled":false,"stage":"stable"}],"nextCursor":if self.loop_cursor {json!("second")} else {Value::Null}}),
                ),
                "memory/status" if self.status_error => Err("status unavailable".into()),
                "memory/status" => Ok(json!({"v2Ready":true,"v2ConsolidatedThreads":0})),
                "memory/reset" => {
                    assert!(params.is_null());
                    if self.lose_reply {
                        Err("reset outcome unknown".into())
                    } else {
                        Ok(json!({}))
                    }
                }
                "config/batchWrite" => {
                    assert_eq!(
                        params["filePath"].as_str(),
                        self.home.join("config.toml").to_str()
                    );
                    if params["expectedVersion"] != format!("v{}", self.version) {
                        return Err("stale config version".into());
                    }
                    let edits = params["edits"].as_array().unwrap();
                    if edits
                        .iter()
                        .any(|edit| self.fail_key == edit["keyPath"].as_str())
                    {
                        return Err("controlled write failure".into());
                    }
                    for edit in edits {
                        if edit["keyPath"] == "features.memories" && !self.freeze_catalog {
                            self.catalog_enabled = edit["value"].as_bool().unwrap();
                        }
                        let (parent, key) =
                            edit["keyPath"].as_str().unwrap().split_once('.').unwrap();
                        if self.config[parent].is_null() {
                            self.config[parent] = json!({});
                        }
                        if edit["value"].is_null() {
                            self.config[parent].as_object_mut().unwrap().remove(key);
                        } else {
                            self.config[parent][key] = edit["value"].clone();
                        }
                    }
                    self.version += 1;
                    if self.change_future_target {
                        self.config["memories"] = json!({"generate_memories":false});
                        self.change_future_target = false;
                    }
                    if self.lose_reply {
                        Err("write outcome unknown".into())
                    } else {
                        Ok(json!({"status":"ok"}))
                    }
                }
                _ => panic!("unexpected method {method}"),
            }
        }
    }
    impl Drop for Mock {
        fn drop(&mut self) {
            std::fs::remove_dir(&self.home).unwrap();
        }
    }
    fn rpc(
        mock: &Rc<RefCell<Mock>>,
    ) -> impl FnMut(&'static str, Value) -> std::future::Ready<Result<Value, String>> + '_ {
        move |method, params| std::future::ready(mock.borrow_mut().rpc(method, params))
    }

    #[tokio::test]
    async fn memory_preferences_read_pages_catalog_and_keeps_ready_separate_from_enabled() {
        let mock = Rc::new(RefCell::new(Mock::new()));
        let result = read_with(&mut rpc(&mock)).await.unwrap();
        assert_eq!(result["feature"]["enabled"], false);
        assert_eq!(result["status"]["v2Ready"], true);
        assert_eq!(result["status"]["v2ConsolidatedThreads"], 0);
        mock.borrow_mut().status_error = true;
        let result = read_with(&mut rpc(&mock)).await.unwrap();
        assert!(result["status"].is_null());
        assert_eq!(result["statusError"], "status unavailable");
        mock.borrow_mut().loop_cursor = true;
        assert!(read_with(&mut rpc(&mock)).await.is_err());
    }

    #[tokio::test]
    async fn memory_preferences_configured_true_cannot_override_disabled_runtime_catalog() {
        let mut fixture = Mock::new();
        fixture.config = json!({"features":{"memories":true}});
        let mock = Rc::new(RefCell::new(fixture));
        let host = mock.borrow().host();
        let result = read_with(&mut rpc(&mock)).await.unwrap();
        assert_eq!(result["config"]["features"]["memories"], true);
        assert_eq!(
            result["feature"]["enabled"], false,
            "a configured value does not prove runtime enablement"
        );
        assert!(
            write_with(&mut rpc(&mock), &host, "v0", "external-context", true)
                .await
                .is_err()
        );
        assert!(!mock
            .borrow()
            .calls
            .iter()
            .any(|(method, _)| *method == "config/batchWrite"));
        mock.borrow_mut().freeze_catalog = true;
        let result = write_with(&mut rpc(&mock), &host, "v0", "enabled", true)
            .await
            .unwrap();
        assert_eq!(result["feature"]["enabled"], false);
        assert_eq!(
            result["mutation"]["complete"], false,
            "a persisted flag without runtime confirmation is not a successful enablement"
        );
    }

    #[tokio::test]
    async fn memory_preferences_cas_exact_groups_and_legacy_deletion() {
        let mock = Rc::new(RefCell::new(Mock::new()));
        let host = mock.borrow().host();
        let on = write_with(&mut rpc(&mock), &host, "v0", "enabled", true)
            .await
            .unwrap();
        assert_eq!(on["mutation"]["complete"], true);
        assert_eq!(on["feature"]["enabled"], true);
        assert_eq!(
            on["config"]["memories"],
            json!({"generate_memories":true,"use_memories":true})
        );
        mock.borrow_mut().config["memories"]["no_memories_if_mcp_or_web_search"] = json!(true);
        let result = write_with(&mut rpc(&mock), &host, "v2", "external-context", true)
            .await
            .unwrap();
        assert_eq!(
            result["config"]["memories"]["disable_on_external_context"],
            false
        );
        assert!(result["config"]["memories"]
            .get("no_memories_if_mcp_or_web_search")
            .is_none());
        assert!(write_with(&mut rpc(&mock), &host, "v0", "enabled", false)
            .await
            .is_err());
        assert!(
            write_with(&mut rpc(&mock), "wrong-host", "v3", "enabled", false)
                .await
                .is_err()
        );
        assert_eq!(
            mock.borrow()
                .calls
                .iter()
                .filter(|(m, _)| *m == "config/batchWrite")
                .count(),
            3
        );
    }

    #[tokio::test]
    async fn memory_preferences_partial_disable_returns_actual_values_and_chronicle_error() {
        let mut fixture = Mock::new();
        fixture.config = json!({"features":{"memories":true,"chronicle":true},"memories":{"generate_memories":true,"use_memories":true}});
        fixture.fail_key = Some("features.chronicle");
        let mock = Rc::new(RefCell::new(fixture));
        let host = mock.borrow().host();
        let result = write_with(&mut rpc(&mock), &host, "v0", "enabled", false)
            .await
            .unwrap();
        assert_eq!(result["feature"]["enabled"], false);
        assert_eq!(result["config"]["memories"]["generate_memories"], false);
        assert_eq!(result["config"]["features"]["chronicle"], true);
        assert_eq!(result["mutation"]["complete"], false);
        assert!(result["mutation"]["errors"][0]
            .as_str()
            .unwrap()
            .contains("chronicle"));
        assert_eq!(
            mock.borrow()
                .calls
                .iter()
                .filter(|(m, _)| *m == "config/batchWrite")
                .count(),
            3
        );
    }

    #[tokio::test]
    async fn memory_preferences_managed_fields_and_external_future_edits_are_not_overwritten() {
        let mut fixture = Mock::new();
        fixture.requirements = json!({"featureRequirements":{"memories":false}});
        let mock = Rc::new(RefCell::new(fixture));
        let host = mock.borrow().host();
        assert!(write_with(&mut rpc(&mock), &host, "v0", "enabled", true)
            .await
            .is_err());
        assert!(!mock
            .borrow()
            .calls
            .iter()
            .any(|(m, _)| *m == "config/batchWrite"));
        mock.borrow_mut().requirements = Value::Null;
        mock.borrow_mut().change_future_target = true;
        let result = write_with(&mut rpc(&mock), &host, "v0", "enabled", true)
            .await
            .unwrap();
        assert_eq!(result["mutation"]["complete"], false);
        assert_eq!(result["config"]["memories"]["generate_memories"], false);
        assert_eq!(
            mock.borrow()
                .calls
                .iter()
                .filter(|(m, _)| *m == "config/batchWrite")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn memory_preferences_unknown_outcomes_are_never_replayed() {
        let mut fixture = Mock::new();
        fixture.lose_reply = true;
        let mock = Rc::new(RefCell::new(fixture));
        let host = mock.borrow().host();
        let result = write_with(&mut rpc(&mock), &host, "v0", "enabled", true)
            .await
            .unwrap();
        assert_eq!(result["mutation"]["complete"], false);
        assert_eq!(result["config"]["memories"]["use_memories"], true);
        let calls = mock
            .borrow()
            .calls
            .iter()
            .filter(|(m, _)| *m == "config/batchWrite")
            .count();
        assert_eq!(calls, 2);
        assert!(reset_with(&mut rpc(&mock), &host).await.is_err());
        assert_eq!(
            mock.borrow()
                .calls
                .iter()
                .filter(|(m, _)| *m == "memory/reset")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn memory_preferences_reset_checks_host_and_does_not_claim_chronicle_cleanup() {
        let mock = Rc::new(RefCell::new(Mock::new()));
        let host = mock.borrow().host();
        assert!(reset_with(&mut rpc(&mock), "stale-host").await.is_err());
        assert!(!mock
            .borrow()
            .calls
            .iter()
            .any(|(m, _)| *m == "memory/reset"));
        let result = reset_with(&mut rpc(&mock), &host).await.unwrap();
        assert_eq!(result["reset"], true);
        assert_eq!(result["chronicleCleared"], false);
        assert_eq!(result["snapshot"]["feature"]["enabled"], false);
        assert_eq!(
            mock.borrow()
                .calls
                .iter()
                .filter(|(m, _)| *m == "memory/reset")
                .count(),
            1
        );
    }
}
