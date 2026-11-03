use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::future::Future;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct PluginOperationState {
    active: Arc<Mutex<BTreeSet<String>>>,
}

pub(crate) struct OperationGuard {
    active: Arc<Mutex<BTreeSet<String>>>,
    ids: BTreeSet<String>,
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            for id in &self.ids { active.remove(id); }
        }
    }
}

impl PluginOperationState {
    pub(crate) fn acquire_remote(&self, raw_id: &str) -> Result<OperationGuard, String> {
        self.acquire(BTreeSet::from([format!("remote:{raw_id}")]))
    }

    fn acquire(&self, ids: BTreeSet<String>) -> Result<OperationGuard, String> {
        let mut active = self.active.lock().map_err(|_| "插件操作锁不可用")?;
        if ids.iter().any(|id| active.contains(id)) {
            return Err("该插件正在执行另一项操作，请等待完成后重新读取状态".to_string());
        }
        active.extend(ids.iter().cloned());
        Ok(OperationGuard { active: self.active.clone(), ids })
    }

    pub async fn call<F, Fut>(&self, method: &str, params: Option<Value>, mut call: F) -> Result<Value, String>
    where F: FnMut(String, Option<Value>) -> Fut, Fut: Future<Output = Result<Value, String>> {
        let mut ids = config_plugin_ids(method, params.as_ref());
        if method == "plugin/install" {
            let source = params.as_ref().ok_or("插件安装参数缺失")?;
            let mut selector = json!({});
            for key in ["pluginName", "marketplacePath", "remoteMarketplaceName"] {
                if let Some(value) = source.get(key) { selector[key] = value.clone(); }
            }
            let detail = call("plugin/read".to_string(), Some(selector)).await?;
            let id = detail.get("plugin").and_then(|plugin| plugin.get("summary"))
                .and_then(|summary| summary.get("id")).and_then(Value::as_str)
                .filter(|id| !id.is_empty()).ok_or("无法确认插件身份，请重新读取插件详情")?;
            ids.insert(id.to_string());
        } else if method == "plugin/uninstall" {
            let id = params.as_ref().and_then(|params| params.get("pluginId"))
                .and_then(Value::as_str).filter(|id| !id.is_empty()).ok_or("插件卸载参数缺失")?;
            ids.insert(id.to_string());
        }
        let _guard = self.acquire(ids)?;
        call(method.to_string(), params).await
    }
}

pub fn is_plugin_mutation(method: &str, params: Option<&Value>) -> bool {
    matches!(method, "plugin/install" | "plugin/uninstall") || !config_plugin_ids(method, params).is_empty()
}

fn config_plugin_ids(method: &str, params: Option<&Value>) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let Some(params) = params else { return ids; };
    let entries: Vec<&Value> = match method {
        "config/value/write" => vec![params],
        "config/batchWrite" => params.get("edits").and_then(Value::as_array)
            .map(|edits| edits.iter().collect()).unwrap_or_default(),
        _ => return ids,
    };
    for entry in entries {
        let Some(path) = entry.get("keyPath").and_then(Value::as_str) else { continue; };
        let Ok(doc) = format!("{path} = true").parse::<toml_edit::DocumentMut>() else { continue; };
        let Some(plugins) = doc.get("plugins").and_then(toml_edit::Item::as_table_like) else { continue; };
        for (id, config) in plugins.iter() {
            if config.as_table_like().is_some_and(|fields| fields.contains_key("enabled")) {
                ids.insert(id.to_string());
            }
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> BTreeSet<String> { values.iter().map(|id| id.to_string()).collect() }

    #[test]
    fn shared_ids_conflict_without_blocking_other_plugins_or_leaving_partial_locks() {
        let state = PluginOperationState::default();
        let first = state.acquire(ids(&["alpha@market"])).unwrap();
        assert!(state.acquire(ids(&["beta@market", "alpha@market"])).is_err());
        let other = state.acquire(ids(&["beta@market"])).unwrap();
        drop(first);
        assert!(state.acquire(ids(&["alpha@market"])).is_ok());
        drop(other);
        assert!(state.active.lock().unwrap().is_empty());
    }

    #[test]
    fn remote_raw_identity_serializes_enable_disable_and_uninstall_across_windows() {
        let state = PluginOperationState::default();
        let first = state.acquire_remote("raw-one").unwrap();
        assert!(state.acquire_remote("raw-one").is_err());
        let independent = state.acquire_remote("raw-two").unwrap();
        drop(first);
        assert!(state.acquire_remote("raw-one").is_ok());
        drop(independent);
        assert!(state.active.lock().unwrap().is_empty());
    }

    #[test]
    fn quoted_plugin_ids_and_batch_edits_are_parsed_without_matching_unrelated_values() {
        let literal = "name.with.\"quotes\\path@market";
        let path = format!("plugins.{}.enabled", serde_json::to_string(literal).unwrap());
        assert_eq!(config_plugin_ids("config/batchWrite", Some(&json!({"edits":[
            {"keyPath":path,"value":false},{"keyPath":"model","value":"plugins.fake.enabled"}
        ]}))), ids(&[literal]));
        assert!(is_plugin_mutation("config/value/write", Some(&json!({"keyPath":"plugins.\"alpha@market\".enabled","value":null}))));
        assert!(!is_plugin_mutation("config/value/write", Some(&json!({"keyPath":"plugins_extra.foo.enabled"}))));
        assert!(!is_plugin_mutation("config/read", Some(&json!({"keyPath":"plugins.foo.enabled"}))));
    }

    #[tokio::test]
    async fn install_uses_resolved_identity_and_preserves_write_params_and_releases_on_error() {
        let state = PluginOperationState::default();
        let params = json!({"pluginName":"alpha","marketplacePath":"C:/fixture/market.json","installAttemptId":"attempt"});
        let active = state.active.clone();
        let expected = params.clone();
        let result = state.call("plugin/install", Some(params), move |method, params| {
            if method == "plugin/read" {
                assert_eq!(params, Some(json!({"pluginName":"alpha","marketplacePath":"C:/fixture/market.json"})));
                assert!(active.lock().unwrap().is_empty());
            } else {
                assert_eq!(method, "plugin/install");
                assert_eq!(params, Some(expected.clone()));
                assert!(active.lock().unwrap().contains("actual@market"));
            }
            async move {
                if method == "plugin/read" { Ok(json!({"plugin":{"summary":{"id":"actual@market"}}})) }
                else { Err("fixture write failure".to_string()) }
            }
        }).await;
        assert!(result.is_err());
        assert!(state.active.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cancelled_inflight_task_releases_its_plugin_lock() {
        let state = Arc::new(PluginOperationState::default());
        let ready = Arc::new(tokio::sync::Notify::new());
        let task_state = state.clone();
        let task_ready = ready.clone();
        let task = tokio::spawn(async move {
            task_state.call("plugin/uninstall", Some(json!({"pluginId":"alpha@market"})), move |_, _| {
                task_ready.notify_one();
                std::future::pending::<Result<Value, String>>()
            }).await
        });
        ready.notified().await;
        assert!(state.acquire(ids(&["alpha@market"])).is_err());
        task.abort(); let _ = task.await;
        assert!(state.acquire(ids(&["alpha@market"])).is_ok());
    }
}
