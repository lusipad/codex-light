use crate::chatgpt_service::{ServiceIdentity, ServiceOperation, ServiceRequest, ShareAccessRequest};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub(crate) fn validated_preference(field: &str, value: &Value) -> Result<(&'static str, Value), String> {
    let result = match field {
        "gitHostingProvider" if value.as_str().is_some_and(|value| ["github", "gitlab"].contains(&value)) =>
            ("code-review-git-hosting-provider", value.clone()),
        "githubConnection" if value.is_null() => ("code-review-github-connection", Value::Null),
        "githubConnection" if value.as_object().is_some_and(|object| object.len() == 3 &&
            ["hostname", "connectorId", "accountLinkId"].iter().all(|field| object.get(*field).and_then(Value::as_str).is_some_and(|text| !text.is_empty()))) =>
            ("code-review-github-connection", value.clone()),
        "gitlabConnectorId" if value.is_null() => ("code-review-gitlab-connector-id", Value::Null),
        "gitlabConnectorId" if value.as_str().is_some_and(|text| !text.trim().is_empty()) =>
            ("code-review-gitlab-connector-id", json!(value.as_str().unwrap().trim())),
        _ => return Err("代码审查提供商设置值无效。".into()),
    };
    Ok(result)
}

fn authorize_preference(body: &Value, field: &str, value: &Value) -> Result<Value, String> {
    let (_, value) = validated_preference(field, value)?;
    match field {
        "gitHostingProvider" if value == "github" => {},
        "gitHostingProvider" if body["capabilities"]["gitlab"] == true => {},
        "githubConnection" if body["capabilities"]["githubInstances"] == true => {
            if !value.is_null() && !body["githubConnections"].as_array().is_some_and(|connections| connections.iter().any(|entry|
                entry["hostname"] == value["hostname"] && entry["connection"]["connectorId"] == value["connectorId"]
                    && entry["connection"]["accountLinkId"] == value["accountLinkId"])) {
                return Err("所选 GitHub 连接已不可用，请重新读取。".into());
            }
        },
        "gitlabConnectorId" if body["capabilities"]["gitlab"] == true && value.is_null() => {},
        "gitlabConnectorId" if !value.is_null() => return Err("暂时无法确认此 GitLab 连接的授权。".into()),
        _ => return Err("当前账号不支持此代码审查提供商设置，请重新读取。".into()),
    }
    Ok(value)
}

fn lookup<'a>(values: &'a Value, name: &str) -> Option<&'a Value> {
    let hash = name.encode_utf16().fold(0u32, |hash, unit| hash.wrapping_mul(31).wrapping_add(unit as u32));
    values.get(name).or_else(|| values.get(hash.to_string()))
}

pub(crate) fn decode_capabilities(bootstrap: &Value, identity: &ServiceIdentity) -> Result<Value, String> {
    let payload: Value = serde_json::from_str(bootstrap["statsigPayload"].as_str().ok_or("代码审查权限响应无效。")?)
        .map_err(|_| "代码审查权限响应无效。")?;
    if payload["user"]["userID"].as_str() != Some(&identity.user_id)
        || payload["user"]["customIDs"]["account_id"].as_str() != Some(&identity.account_id)
        || !payload["feature_gates"].is_object()
        || payload["has_updates"] != true
        || payload["is_delta"] == true || payload["isDelta"] == true
        || !payload["live_overlay"].is_null() {
        return Err("代码审查权限数据不完整或与当前账号不符。".into());
    }
    let compact = match payload.get("response_format") {
        None => false,
        Some(Value::String(value)) if value == "init-v1" => false,
        Some(Value::String(value)) if value == "init-v2" => true,
        _ => return Err("代码审查权限格式暂不支持。".into()),
    };
    let gate = |name| lookup(&payload["feature_gates"], name)
        .and_then(|entry| entry.get(if compact { "v" } else { "value" })).and_then(Value::as_bool);
    let layer = lookup(&payload["layer_configs"], "2115119119");
    let layer_value = if compact {
        layer.and_then(|entry| match &entry["v"] {
            Value::Number(index) => index.as_u64().and_then(|index| usize::try_from(index).ok()).and_then(|index| payload["values"].get(index)),
            Value::String(index) => payload["values"].get(index),
            _ => None,
        })
    } else { layer.and_then(|entry| entry.get("value")) };
    Ok(json!({
        "githubInstances":gate("223049465"),
        "gitlab":layer_value.and_then(|value| value.get("enabled")).and_then(Value::as_bool),
        "reviewTabDefault":gate("2247892263"),
    }))
}

pub(crate) fn validate_connections(value: &Value) -> Result<(), String> {
    let entries = value.as_array().ok_or("GitHub 连接响应无效。")?;
    let mut identities = std::collections::HashSet::new();
    for entry in entries {
        let nonempty = |field: &Value| field.as_str().is_some_and(|text| !text.trim().is_empty() && !text.chars().any(char::is_control));
        let hostname = entry["hostname"].as_str().filter(|_| nonempty(&entry["hostname"]))
            .ok_or("GitHub 连接缺少有效主机名。")?;
        let url = tauri::Url::parse(&format!("https://{hostname}/")).map_err(|_| "GitHub 连接主机名无效。")?;
        if !url.host_str().is_some_and(|host| host.eq_ignore_ascii_case(hostname)) || url.port().is_some() || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
            || !url.username().is_empty() || url.password().is_some() || entry.get("name").is_some_and(|name| !name.is_null() && !name.is_string())
            || !nonempty(&entry["connection"]["connectorId"]) || !nonempty(&entry["connection"]["accountLinkId"]) {
            return Err("GitHub 连接数据无效。".into());
        }
        let key = (hostname, entry["connection"]["connectorId"].as_str().unwrap(), entry["connection"]["accountLinkId"].as_str().unwrap());
        if !identities.insert(key) { return Err("GitHub 连接身份重复。".into()); }
    }
    Ok(())
}

#[tauri::command]
pub async fn code_review_provider_read(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest) -> Result<Value, String> {
    let identity = request.expected_identity.clone();
    let profile = request.profile.clone();
    let request_id = request.request_id.clone();
    let bootstrap = crate::share_thread_access(app.clone(), window, state.clone(), request).await
        .map_err(|error| error.message.to_string())?;
    let capabilities = decode_capabilities(&bootstrap, &identity)?;
    let (connections, connections_error) = if capabilities["githubInstances"] == true {
        let response = state.chatgpt_service.read(ServiceRequest {
            request_id:request_id.clone(), operation: ServiceOperation::GithubConnections,
            params:json!({}), expected_identity:identity.clone(), profile,
        }, |method, params| {
            let app = &app; let state = &state;
            async move { state.app_server.call(app, method, Some(params)).await }
        }).await;
        match response {
            Ok(response) => match validate_connections(&response.body) {
                Ok(()) => (response.body, Value::Null),
                Err(error) => (Value::Null, json!(error)),
            },
            Err(error) if ["account_changed", "cancelled", "not_logged_in", "unsupported_auth"].contains(&error.code) => return Err(error.message.to_string()),
            Err(error) => (Value::Null, json!(error.message)),
        }
    } else { (Value::Null, Value::Null) };
    if state.chatgpt_service.generation() != identity.generation { return Err("读取代码审查设置期间账号发生变化。".into()); }
    let preferences = state.desktop_state.review_provider_preferences()?;
    Ok(json!({"requestId":request_id,"identity":identity,"body":{"capabilities":capabilities,"githubConnections":connections,"githubConnectionsError":connections_error,"preferences":preferences}}))
}

#[tauri::command]
pub async fn code_review_provider_update(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest, field: String, value: Value, expected_value: Value) -> Result<Value, String> {
    validated_preference(&field, &value)?;
    let generation = request.expected_identity.generation;
    let label = window.label().to_owned();
    let mut snapshot = code_review_provider_read(app.clone(), window, state.clone(), request).await?;
    let value = authorize_preference(&snapshot["body"], &field, &value)?;
    if state.chatgpt_service.generation() != generation { return Err("保存代码审查设置期间账号发生变化。".into()); }
    let preferences = state.desktop_state.update_review_provider_preference(&field, &value, &expected_value)?;
    snapshot["body"]["preferences"] = preferences;
    for target in app.webview_windows().keys().filter(|target| target.as_str() != label) {
        let _ = app.emit_to(target.as_str(), "code-review-provider-preferences-changed", ());
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> ServiceIdentity { ServiceIdentity { account_id:"account".into(), user_id:"user".into(), generation:1 } }
    fn bootstrap(mut payload: Value) -> Value {
        payload["has_updates"] = json!(true);
        payload["user"] = json!({"userID":"user","customIDs":{"account_id":"account"}});
        json!({"statsigPayload":payload.to_string()})
    }
    #[test]
    fn full_identity_bound_v1_and_v2_gates_and_layers() {
        let v1 = bootstrap(json!({"feature_gates":{"223049465":{"value":true},"2247892263":{"value":false}},"layer_configs":{"2115119119":{"value":{"enabled":true}}}}));
        assert_eq!(decode_capabilities(&v1,&identity()).unwrap(),json!({"githubInstances":true,"gitlab":true,"reviewTabDefault":false}));
        // Golden names computed by the fixed official SDK's isolated _DJB2 function.
        let v2 = bootstrap(json!({"response_format":"init-v2","feature_gates":{"504780497":{"v":false},"2243148289":{"v":true}},"layer_configs":{"1134546883":{"v":0}},"values":[{"enabled":false}]}));
        assert_eq!(decode_capabilities(&v2,&identity()).unwrap(),json!({"githubInstances":false,"gitlab":false,"reviewTabDefault":true}));
        let unknown = bootstrap(json!({"feature_gates":{}}));
        assert_eq!(decode_capabilities(&unknown,&identity()).unwrap(),json!({"githubInstances":null,"gitlab":null,"reviewTabDefault":null}));
        for patch in [json!({"has_updates":false}),json!({"is_delta":true}),json!({"isDelta":true}),json!({"live_overlay":{}}),json!({"response_format":"future"}),json!({"user":{"userID":"other"}})] {
            let mut payload:Value=serde_json::from_str(v1["statsigPayload"].as_str().unwrap()).unwrap();
            payload.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());
            assert!(decode_capabilities(&json!({"statsigPayload":payload.to_string()}),&identity()).is_err());
        }
    }
    #[test]
    fn connection_identity_validation_rejects_partial_duplicate_and_unsafe_hosts() {
        let good=json!({"hostname":"github.example.test","name":"Work","connection":{"connectorId":"connector","accountLinkId":"link"}});
        assert!(validate_connections(&json!([])).is_ok());
        assert!(validate_connections(&json!([good.clone()])).is_ok());
        assert!(validate_connections(&json!([good.clone(),good.clone()])).is_err());
        for hostname in ["user@github.example.test","github.example.test/path","github.example.test?x=1","github.example.test:444"," "] {
            let mut item=good.clone();item["hostname"]=json!(hostname);assert!(validate_connections(&json!([item])).is_err());
        }
        assert!(validate_connections(&json!([{"hostname":"github.example.test","name":"Work","connection":{"connectorId":"connector"}}])).is_err());
    }
    #[test]
    fn writes_require_fresh_capabilities_and_exact_connection_membership() {
        let selected = json!({"hostname":"github.example.test","connectorId":"connector","accountLinkId":"link"});
        let body = json!({"capabilities":{"githubInstances":true,"gitlab":true},"githubConnections":[{"hostname":"github.example.test","connection":{"connectorId":"connector","accountLinkId":"link"}}]});
        assert_eq!(authorize_preference(&body,"githubConnection",&selected).unwrap(),selected);
        assert_eq!(authorize_preference(&body,"gitHostingProvider",&json!("gitlab")).unwrap(),"gitlab");
        assert!(authorize_preference(&body,"gitlabConnectorId",&Value::Null).is_ok());
        let mut other=selected.clone();other["accountLinkId"]=json!("other");
        assert!(authorize_preference(&body,"githubConnection",&other).is_err());
        for capabilities in [json!({"githubInstances":false,"gitlab":false}),json!({"githubInstances":null,"gitlab":null})] {
            let denied=json!({"capabilities":capabilities,"githubConnections":[]});
            assert!(authorize_preference(&denied,"githubConnection",&selected).is_err());
            assert!(authorize_preference(&denied,"githubConnection",&Value::Null).is_err());
            assert!(authorize_preference(&denied,"gitHostingProvider",&json!("gitlab")).is_err());
            assert!(authorize_preference(&denied,"gitHostingProvider",&json!("github")).is_ok());
        }
        assert!(authorize_preference(&body,"gitlabConnectorId",&json!("unverified-connector")).is_err());
        for (field,value) in [("unknown",Value::Null),("githubConnection",json!({"hostname":"x"})),("gitHostingProvider",json!("other")),("gitlabConnectorId",json!(" "))] {
            assert!(validated_preference(field,&value).is_err());
        }
        assert_eq!(validated_preference("gitlabConnectorId",&json!(" connector ")).unwrap().1,"connector");
    }
}
