use crate::chatgpt_service::{ServiceError, ServiceIdentity, ServiceOperation, ServiceRequest, ShareAccessRequest};
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
        "gitlabConnectorId" if body["capabilities"]["gitlab"] == true => {
            if !value.is_null() && !body["gitlabInstances"].as_array().is_some_and(|instances|
                instances.iter().any(|entry| entry["connectorId"] == value)) {
                return Err("所选 GitLab 连接已不可用，请重新读取。".into());
            }
        },
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

pub(crate) const GITLAB_TEMPLATE: &str = "templated_apps_GitLab";
const DEFAULT_GITLAB: &str = "connector_0c9786b2f41f41558056126bdb46c9bd";

pub(crate) fn gitlab_candidate_allowed(candidate: &Value, links: &[Value]) -> bool {
    let Some(id) = candidate["id"].as_str().filter(|id| !id.is_empty()) else { return false };
    let link = links.iter().find(|link| link["connector_id"] == id);
    candidate["template_id"] == GITLAB_TEMPLATE && candidate["status"] != "DISABLED_BY_ADMIN"
        && link.is_some_and(|link| link["id"].as_str().is_some_and(|id| !id.is_empty())
            && link["auth_status"] != "REAUTH_REQUIRED" && link["unavailable_reason"].is_null()
            && link["connector_status"] != "DISABLED_BY_ADMIN")
}

pub(crate) fn gitlab_instance(detail: &Value, expected_id: &str) -> Option<Value> {
    if detail["id"] != expected_id || (!detail["name"].is_null() && !detail["name"].is_string()) { return None; }
    let default = expected_id == DEFAULT_GITLAB;
    if (detail["service"] != "gitlab" && (default || detail["service"] != format!("{GITLAB_TEMPLATE}:{expected_id}")))
        || detail["status"] == "DISABLED_BY_ADMIN" || detail["labels"]["admin_only_connector"] == "true"
        || (!default && detail["template_id"] != GITLAB_TEMPLATE) { return None; }
    let raw = detail["base_url"].as_str()?;
    let url = tauri::Url::parse(raw).ok()?;
    let hostname = url.host_str()?;
    let canonical = format!("https://{hostname}/api/v4");
    if url.scheme() != "https" || url.port().is_some() || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || (raw != canonical && raw != format!("{canonical}/")) { return None; }
    let labels: Vec<_> = hostname.split('.').collect();
    if hostname.len() > 253 || labels.len() < 2 || labels.iter().any(|label| {
        label.is_empty() || label.len() > 63 || !label.as_bytes()[0].is_ascii_alphanumeric()
            || !label.as_bytes()[label.len()-1].is_ascii_alphanumeric()
            || !label.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    }) || labels.iter().all(|label| label.bytes().all(|byte| byte.is_ascii_digit())) || hostname.ends_with(".localhost")
        || (default && hostname != "gitlab.com") || (!default && (hostname == "gitlab.com" || hostname.ends_with(".gitlab.com"))) { return None; }
    Some(json!({"connectorId":expected_id,"hostname":hostname,"name":detail["name"]}))
}

fn provider_service_error(error: ServiceError) -> String {
    format!("{}: {}",error.code,error.message)
}

#[tauri::command]
pub async fn code_review_provider_read(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest) -> Result<Value, String> {
    let identity = request.expected_identity.clone();
    let profile = request.profile.clone();
    let request_id = request.request_id.clone();
    let bootstrap = crate::share_thread_access(app.clone(), window, state.clone(), request).await
        .map_err(provider_service_error)?;
    let capabilities = decode_capabilities(&bootstrap, &identity)?;
    let (connections, connections_error) = if capabilities["githubInstances"] == true {
        let response = state.chatgpt_service.read(ServiceRequest {
            request_id:request_id.clone(), operation: ServiceOperation::GithubConnections,
            params:json!({}), expected_identity:identity.clone(), profile:profile.clone(),
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
    let (gitlab_instances, gitlab_error) = if capabilities["gitlab"] == true {
        match state.chatgpt_service.review_gitlab_instances(&request_id, &identity, &profile, |method, params| {
            let app = &app; let state = &state;
            async move { state.app_server.call(app, method, Some(params)).await }
        }).await {
            Ok(instances) => (instances, Value::Null),
            Err(error) if ["account_changed", "cancelled", "not_logged_in", "unsupported_auth"].contains(&error.code) => return Err(error.message.to_string()),
            Err(error) => (Value::Null, json!(error.message)),
        }
    } else { (Value::Null, Value::Null) };
    if state.chatgpt_service.generation() != identity.generation { return Err("读取代码审查设置期间账号发生变化。".into()); }
    let preferences = state.desktop_state.review_provider_preferences()?;
    Ok(json!({"requestId":request_id,"identity":identity,"body":{"capabilities":capabilities,"githubConnections":connections,"githubConnectionsError":connections_error,"gitlabInstances":gitlab_instances,"gitlabInstancesError":gitlab_error,"preferences":preferences}}))
}

#[tauri::command]
pub async fn code_review_pull_request_read(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest, url: String) -> Result<Value, String> {
    let pull_request = parse_pull_request_url(&url)?;
    let identity=request.expected_identity.clone();let profile=request.profile.clone();let request_id=request.request_id.clone();
    let snapshot=code_review_provider_read(app.clone(),window,state.clone(),request).await?;
    let preferences=snapshot["body"]["preferences"].clone();
    let connection=authorized_pull_request_connection(&snapshot["body"],&pull_request)?;
    let body=state.chatgpt_service.review_pull_request(&request_id,&identity,&profile,&pull_request,&connection,|method,params| {
        let app=&app;let state=&state;
        async move { state.app_server.call(app,method,Some(params)).await }
    }).await.map_err(provider_service_error)?;
    if state.chatgpt_service.generation()!=identity.generation || state.desktop_state.review_provider_preferences()?!=preferences {
        return Err("代码审查账号或实例设置已改变，请重新读取。".into());
    }
    Ok(json!({"requestId":request_id,"identity":identity,"body":body}))
}

pub(crate) fn parse_pull_request_url(raw: &str) -> Result<Value,String> {
    let invalid=|| "请输入有效的 HTTPS GitHub Pull Request 地址。".to_owned();
    if raw.contains('\\') || raw.chars().any(char::is_control) { return Err(invalid()); }
    let url=tauri::Url::parse(raw).map_err(|_| invalid())?;
    if url.scheme()!="https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() { return Err(invalid()); }
    let authority=raw.split_once("://").ok_or_else(invalid)?.1.split(['/', '?', '#']).next().ok_or_else(invalid)?;
    if authority.contains(':') { return Err(invalid()); }
    let raw_path=raw.split_once("://").unwrap().1.find('/').map(|index| &raw.split_once("://").unwrap().1[index..]).unwrap_or("").split(['?','#']).next().unwrap_or("");
    if raw_path!=url.path() { return Err(invalid()); }
    let parts:Vec<_>=url.path().strip_suffix('/').unwrap_or(url.path()).split('/').collect();
    if parts.len()!=5 || parts[0]!="" || parts[3]!="pull" || !parts[4].bytes().all(|byte|byte.is_ascii_digit()) { return Err(invalid()); }
    let valid_segment=|text:&str| !text.is_empty() && text!="." && text!=".." && text.bytes().all(|byte|byte.is_ascii_alphanumeric() || b"_.-".contains(&byte));
    if !valid_segment(parts[1]) || !valid_segment(parts[2]) { return Err(invalid()); }
    let number=parts[4].parse::<u64>().ok().filter(|number| *number>0 && *number<=9_007_199_254_740_991).ok_or_else(invalid)?;
    let hostname=url.host_str().ok_or_else(invalid)?.trim_end_matches('.').to_lowercase();
    let owner=parts[1].to_lowercase();let repository=parts[2].to_lowercase();
    Ok(json!({"hostname":hostname,"owner":owner,"repository":repository,"number":number,"url":format!("https://{hostname}/{owner}/{repository}/pull/{number}")}))
}

#[tauri::command]
pub async fn code_review_comparison_read(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest, url: String, snapshot_id: Option<String>, commit_sha: Option<String>) -> Result<Value,String> {
    pinned_comparison_read(app,window,state,request,url,snapshot_id,commit_sha,None).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn code_review_revision_file_read(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest, url: String, snapshot_id: String, commit_sha: Option<String>, base_path: Option<String>, head_path: Option<String>) -> Result<Value,String> {
    pinned_comparison_read(app,window,state,request,url,Some(snapshot_id),commit_sha,Some((base_path,head_path))).await
}

#[allow(clippy::too_many_arguments)]
async fn pinned_comparison_read(app: AppHandle, window: WebviewWindow, state: State<'_, crate::AppState>, request: ShareAccessRequest, url: String, snapshot_id: Option<String>, commit_sha: Option<String>, file: Option<(Option<String>,Option<String>)>) -> Result<Value,String> {
    let pull_request=parse_pull_request_url(&url)?;
    let identity=request.expected_identity.clone();let profile=request.profile.clone();let request_id=request.request_id.clone();
    let provider=code_review_provider_read(app.clone(),window,state.clone(),request).await?;
    let preferences=provider["body"]["preferences"].clone();
    let connection=authorized_pull_request_connection(&provider["body"],&pull_request)?;
    let body=state.chatgpt_service.review_comparison(&request_id,&identity,&profile,&pull_request,&connection,&preferences,snapshot_id.as_deref(),commit_sha.as_deref(),file,|method,params| {
        let app=&app;let state=&state;
        async move {state.app_server.call(app,method,Some(params)).await}
    }).await.map_err(provider_service_error)?;
    if state.chatgpt_service.generation()!=identity.generation || state.desktop_state.review_provider_preferences()?!=preferences {
        return Err("代码审查账号或实例设置已改变，请重新读取。".into());
    }
    Ok(json!({"requestId":request_id,"identity":identity,"body":body}))
}

fn authorized_pull_request_connection(body:&Value,pull_request:&Value)->Result<Value,String> {
    if body["capabilities"]["githubInstances"]!=true { return Err("当前账号尚未允许 GitHub 代码审查服务。".into()); }
    if pull_request["hostname"]=="github.com" { return Ok(Value::Null); }
    let selected=&body["preferences"]["githubConnection"];
    if selected.is_null() || selected["hostname"]!=pull_request["hostname"] { return Err("此 Pull Request 与当前选择的 GitHub 实例不符。".into()); }
    authorize_preference(body,"githubConnection",selected)?;
    Ok(json!({"connectorId":selected["connectorId"],"accountLinkId":selected["accountLinkId"]}))
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
    #[test]
    fn provider_errors_preserve_access_codes_without_reclassifying_network_failures() {
        let mut readback=Vec::new();
        for (code,message,status,expected) in [
            ("unauthorized","ChatGPT authentication rejected",Some(401),"unauthorized: ChatGPT authentication rejected"),
            ("forbidden","ChatGPT service access denied",Some(403),"forbidden: ChatGPT service access denied"),
            ("network_error","ChatGPT service connection failed",None,"network_error: ChatGPT service connection failed"),
        ] {
            let actual=provider_service_error(ServiceError{code,message,status});
            assert_eq!(actual,expected);
            readback.push(json!({"code":code,"status":status,"error":actual}));
        }
        if let Some(directory)=std::env::var_os("CODEX_PINNED_REVIEW_FIXTURE_DIRECTORY") {
            let directory=std::path::PathBuf::from(directory);std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("provider-error-readback.json"),serde_json::to_vec_pretty(&readback).unwrap()).unwrap();
        }
    }
    #[test]
    fn remote_pull_request_urls_and_enterprise_membership_are_independently_validated() {
        let pr=parse_pull_request_url("https://GitHub.com/Owner/Repo/pull/00012/?tab=files#discussion").unwrap();
        assert_eq!(pr,json!({"hostname":"github.com","owner":"owner","repository":"repo","number":12,"url":"https://github.com/owner/repo/pull/12"}));
        for url in ["http://github.com/o/r/pull/1","https://user@github.com/o/r/pull/1","https://github.com:443/o/r/pull/1","https://github.com/o/r/pull/0","https://github.com/o/r/pull/9007199254740992","https://github.com/o/r/pull/1/files","https://github.com/o/r/pull/1//","https://github.com/o/a/../r/pull/1","https://github.com/o/%2e%2e/pull/1","https://github.com/o%2fr/r/pull/1","https://github.com/o/r/pull/-1","https://github.com/o/r/pull/1\n"] {
            assert!(parse_pull_request_url(url).is_err(),"{url}");
        }
        let selected=json!({"hostname":"github.example.test","connectorId":"connector","accountLinkId":"link"});
        let mut body=json!({"capabilities":{"githubInstances":true},"preferences":{"githubConnection":selected},"githubConnections":[{"hostname":"github.example.test","connection":{"connectorId":"connector","accountLinkId":"link"}}]});
        assert_eq!(authorized_pull_request_connection(&body,&pr).unwrap(),Value::Null);
        let enterprise=parse_pull_request_url("https://github.example.test/o/r/pull/1").unwrap();
        assert_eq!(authorized_pull_request_connection(&body,&enterprise).unwrap(),json!({"connectorId":"connector","accountLinkId":"link"}));
        body["githubConnections"][0]["connection"]["accountLinkId"]=json!("other");
        assert!(authorized_pull_request_connection(&body,&enterprise).is_err());
        body["capabilities"]["githubInstances"]=Value::Null;
        assert!(authorized_pull_request_connection(&body,&pr).is_err());
    }
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
    fn gitlab_authorization_uses_first_link_and_strict_official_hostname_parser() {
        let candidate=json!({"id":"enterprise","template_id":GITLAB_TEMPLATE});
        let authorized=json!({"connector_id":"enterprise","id":"authorization"});
        assert!(gitlab_candidate_allowed(&candidate,&[authorized.clone()]));
        for patch in [json!({"id":""}),json!({"auth_status":"REAUTH_REQUIRED"}),json!({"unavailable_reason":""}),json!({"connector_status":"DISABLED_BY_ADMIN"})] {
            let mut denied=authorized.clone();denied.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());
            assert!(!gitlab_candidate_allowed(&candidate,&[denied,authorized.clone()]));
        }
        let good=json!({"id":"enterprise","service":"templated_apps_GitLab:enterprise","template_id":GITLAB_TEMPLATE,"base_url":"https://gitlab.example.test/api/v4","name":"Work"});
        assert_eq!(gitlab_instance(&good,"enterprise").unwrap()["hostname"],"gitlab.example.test");
        for raw in ["http://gitlab.example.test/api/v4","https://GITLAB.example.test/api/v4","https://gitlab.example.test:443/api/v4","https://user@gitlab.example.test/api/v4","https://gitlab.example.test/api/v4?x=1","https://gitlab.example.test/api/v4#x","https://gitlab.example.test/a/../api/v4","https://gitlab.example.test/api/%76%34","https://gitlab.com/api/v4","https://foo.gitlab.com/api/v4","https://foo.localhost/api/v4","https://127.0.0.1/api/v4","https://bad-.example/api/v4"] {
            let mut item=good.clone();item["base_url"]=json!(raw);assert!(gitlab_instance(&item,"enterprise").is_none(),"{raw}");
        }
        let mut numeric=good.clone();numeric["base_url"]=json!("https://123.example.test/api/v4/");assert!(gitlab_instance(&numeric,"enterprise").is_some());
        for patch in [json!({"service":"other"}),json!({"template_id":"other"}),json!({"status":"DISABLED_BY_ADMIN"}),json!({"labels":{"admin_only_connector":"true"}}),json!({"id":"different"}),json!({"name":{"unexpected":"object"}}),json!({"name":42})] {
            let mut item=good.clone();item.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());assert!(gitlab_instance(&item,"enterprise").is_none());
        }
        let default=json!({"id":DEFAULT_GITLAB,"service":"gitlab","base_url":"https://gitlab.com/api/v4"});
        assert!(gitlab_instance(&default,DEFAULT_GITLAB).is_some());
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
        let mut authorized=body.clone();authorized["gitlabInstances"]=json!([{"connectorId":"verified"}]);
        assert_eq!(authorize_preference(&authorized,"gitlabConnectorId",&json!(" verified ")).unwrap(),"verified");
        authorized["gitlabInstances"]=Value::Null;authorized["gitlabInstancesError"]=json!("unavailable");
        assert!(authorize_preference(&authorized,"gitlabConnectorId",&json!("verified")).is_err());
        for (field,value) in [("unknown",Value::Null),("githubConnection",json!({"hostname":"x"})),("gitHostingProvider",json!("other")),("gitlabConnectorId",json!(" "))] {
            assert!(validated_preference(field,&value).is_err());
        }
        assert_eq!(validated_preference("gitlabConnectorId",&json!(" connector ")).unwrap().1,"connector");
    }
}
