//! Read-only app metadata and accessible accounts. No actions or credentials cross IPC.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAppDetailsRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub plugin_id: String,
    pub app_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAppEntryRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub app_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginUsageLinksRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub app_ids: Vec<String>,
}

fn canonical_app_id(id: &str) -> String {
    id.strip_prefix("asdk_app_").map(|suffix| format!("connector_{suffix}")).unwrap_or_else(|| id.to_owned())
}

fn app_details_invalid() -> ServiceError { failure("invalid_response", "Plugin app details are incomplete") }

fn plugin_owns_app(plugin: &Value, app_id: &str) -> ServiceResult<bool> {
    let Some(release) = plugin.get("release").filter(|value| !value.is_null()) else { return Ok(false) };
    let release = release.as_object().ok_or_else(app_details_invalid)?;
    let matches_ids = |value: Option<&Value>| -> ServiceResult<bool> {
        let Some(value) = value.filter(|value| !value.is_null()) else { return Ok(false) };
        let ids = value.as_array().ok_or_else(app_details_invalid)?;
        let mut found = false;
        for value in ids {
            let id = value.as_str().filter(|id| !id.is_empty()).ok_or_else(app_details_invalid)?;
            found |= canonical_app_id(id) == app_id;
        }
        Ok(found)
    };
    let mut found = matches_ids(release.get("app_ids"))?;
    if let Some(templates) = release.get("app_templates").filter(|value| !value.is_null()) {
        for template in templates.as_array().ok_or_else(app_details_invalid)? {
            let template = template.as_object().ok_or_else(app_details_invalid)?;
            found |= matches_ids(template.get("materialized_app_ids"))?;
        }
    }
    Ok(found)
}

fn copy_optional_string(source: &serde_json::Map<String, Value>, target: &mut serde_json::Map<String, Value>, key: &str) -> ServiceResult<()> {
    if let Some(value) = source.get(key) {
        if !value.is_null() && !value.is_string() { return Err(app_details_invalid()); }
        target.insert(key.into(), value.clone());
    }
    Ok(())
}

fn app_details_body(plugin_id: &str, app_id: &str, metadata: Value, accessible: Value) -> ServiceResult<Value> {
    let connector = app_details_connector(app_id, metadata)?;
    let links = app_details_links(app_id, accessible)?;
    Ok(json!({"pluginId":plugin_id,"appId":app_id,"connector":connector,"links":links,"linksError":null}))
}

fn app_details_connector(app_id: &str, metadata: Value) -> ServiceResult<Value> {
    // The official GET returns the connector itself, not a {connector: ...} wrapper.
    let source = metadata.as_object().ok_or_else(app_details_invalid)?;
    let id = source.get("id").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
    if canonical_app_id(id) != canonical_app_id(app_id) { return Err(app_details_invalid()); }
    let mut connector = serde_json::Map::new();
    connector.insert("id".into(), json!(id));
    let name = source.get("name").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
    connector.insert("name".into(), json!(name));
    for key in ["description", "status", "logo_url", "logo_url_dark"] { copy_optional_string(source, &mut connector, key)?; }
    if let Some(value) = source.get("enable_multi_links") {
        if !value.is_null() && !value.is_boolean() { return Err(app_details_invalid()); }
        connector.insert("enable_multi_links".into(), value.clone());
    }
    if let Some(value) = source.get("supported_auth") {
        if value.is_null() { connector.insert("supported_auth".into(), Value::Null); }
        else {
            let mut auth = Vec::new();
            for item in value.as_array().ok_or_else(app_details_invalid)? {
                let kind = item.get("type").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
                auth.push(json!({"type":kind}));
            }
            connector.insert("supported_auth".into(), json!(auth));
        }
    }
    if let Some(value) = source.get("sync_metadata") {
        if value.is_null() { connector.insert("sync_metadata".into(), Value::Null); }
        else {
            let source = value.as_object().ok_or_else(app_details_invalid)?;
            let mut selected = serde_json::Map::new();
            if let Some(value) = source.get("user_allowed_to_sync") {
                if !value.is_null() && !value.is_boolean() { return Err(app_details_invalid()); }
                selected.insert("user_allowed_to_sync".into(), value.clone());
            }
            connector.insert("sync_metadata".into(), Value::Object(selected));
        }
    }
    if let Some(value) = source.get("labels") {
        if value.is_null() { connector.insert("labels".into(), Value::Null); }
        else {
            let labels = value.as_object().ok_or_else(app_details_invalid)?;
            let mut selected = serde_json::Map::new();
            copy_optional_string(labels, &mut selected, "apps_privacy_control_available")?;
            connector.insert("labels".into(), Value::Object(selected));
        }
    }
    Ok(Value::Object(connector))
}

pub(super) fn standalone_app(app_id: &str, content: Value) -> ServiceResult<Value> {
    let rows = content.get("apps").and_then(Value::as_array).ok_or_else(app_details_invalid)?;
    let mut selected = None;
    for row in rows {
        let id = row.get("id").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
        if canonical_app_id(id) != canonical_app_id(app_id) { continue; }
        // BQbE.w builds a Map keyed by canonical ID: later rows replace earlier ones.
        selected = Some(row);
    }
    let row = selected.ok_or_else(|| failure("not_found", "Requested app content is unavailable"))?;
    let name = row.get("name").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
    let optional = |key| -> ServiceResult<Option<&str>> {
        match row.get(key) { None | Some(Value::Null) => Ok(None), Some(value) => value.as_str().map(Some).ok_or_else(app_details_invalid) }
    };
    let light = optional("icon_url")?;
    let dark = optional("icon_dark_url")?;
    Ok(json!({"id":app_id,"name":name,"description":optional("description")?.filter(|value| !value.is_empty()),
        "logoUrl":light.or(dark),"logoUrlDark":dark.or(light)}))
}

pub(super) fn app_details_links(app_id: &str, accessible: Value) -> ServiceResult<Value> {
    let rows = accessible.get("links").and_then(Value::as_array).ok_or_else(app_details_invalid)?;
    let mut links = Vec::new();
    for value in rows {
        let row = value.as_object().ok_or_else(app_details_invalid)?;
        let connector_id = row.get("connector_id").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
        if canonical_app_id(connector_id) != app_id { continue; }
        let id = row.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).ok_or_else(app_details_invalid)?;
        let mut link = serde_json::Map::new();
        link.insert("id".into(), json!(id));
        link.insert("connector_id".into(), json!(connector_id));
        for key in ["auth_status", "auth_type", "auth_strategy_id", "visibility", "name", "connector_name"] { copy_optional_string(row, &mut link, key)?; }
        if let Some(value) = row.get("apps_privacy_control") {
            if !value.is_null() && !value.as_str().is_some_and(|value| matches!(value, "always_ask" | "ask_before_writes" | "review_important_actions" | "full_access")) {
                return Err(app_details_invalid());
            }
            link.insert("apps_privacy_control".into(), value.clone());
        }
        let owners = row.get("owners").and_then(Value::as_array).ok_or_else(app_details_invalid)?;
        let mut selected_owners = Vec::new();
        for owner in owners {
            let kind = owner.get("type").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
            let id = owner.get("id").and_then(Value::as_str).ok_or_else(app_details_invalid)?;
            selected_owners.push(json!({"type":kind,"id":id}));
        }
        link.insert("owners".into(), json!(selected_owners));
        if let Some(value) = row.get("owner_profile").filter(|value| !value.is_null()) {
            let profile = value.as_object().ok_or_else(app_details_invalid)?;
            let mut selected = serde_json::Map::new();
            for key in ["id", "picture", "email", "name", "nickname"] { copy_optional_string(profile, &mut selected, key)?; }
            link.insert("owner_profile".into(), Value::Object(selected));
        }
        // Keep visibility and implicit IDs intact: selection/editability belong to
        // the separately tested consumer and must not be inferred from nicknames.
        links.push(Value::Object(link));
    }
    Ok(json!(links))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    fn identity() -> ServiceIdentity { ServiceIdentity { account_id:"app-account".into(), user_id:"app-user".into(), generation:0 } }
    fn request() -> PluginAppDetailsRequest { PluginAppDetailsRequest {
        request_id:"app-details-fixture".into(), expected_identity:identity(), plugin_id:"plugin-real".into(), app_id:"asdk_app_real".into(),
        profile:ServiceProfile { language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into() },
    } }
    fn token() -> String {
        let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"app-account","user_id":"app-user","chatgpt_account_is_fedramp":false}});
        format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))
    }
    async fn rpc(method: &'static str, _:Value) -> Result<Value,String> { Ok(match method {
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),
        "account/read"=>json!({"account":{"type":"chatgpt","planType":"plus"},"workspaceRouting":{
            "backendOrigin":"https://chatgpt.com","chatgptAccountId":"app-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}), _=>panic!("unexpected RPC {method}"),
    }) }
    fn plugin() -> Value { json!({"id":"plugin-real","name":"Raw plugin name","release":{"display_name":"Displayed plugin name","app_ids":["asdk_app_real"]}}) }
    fn metadata() -> Value { json!({"id":"connector_real","name":"Real app","description":"Description","status":"ACTIVE","enable_multi_links":true,
        "labels":{"apps_privacy_control_available":"false","private":"never-return"},"actions":[{"secret":"never-return"}],"token":"never-return"}) }
    fn link(id:&str, connector:&str, owner:&str) -> Value { json!({"id":id,"connector_id":connector,"auth_status":"ACTIVE","auth_type":"OAUTH",
        "name":" Custom account label ","connector_name":" Provider name ",
        "owners":[{"type":"USER","id":owner,"secret":"never-return"}],"apps_privacy_control":null,"owner_profile":{"nickname":"Actual nickname","name":" Profile name ","email":"owner@example.test","picture":"https://example.test/picture","secret":"never-return"},"token":"never-return"}) }
    struct TestTransport { replies:Mutex<VecDeque<(u16,Value)>>, sent:Mutex<Vec<HttpRequest>> }
    impl TestTransport { fn new(replies:Vec<(u16,Value)>) -> Self { Self {replies:Mutex::new(replies.into()),sent:Mutex::new(Vec::new())} } }
    impl Transport for TestTransport {
        fn send(&self,request:HttpRequest,_:Arc<AtomicBool>) -> TransportFuture<'_> { Box::pin(async move {
            self.sent.lock().unwrap().push(request);
            let (status,body)=self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request");
            Ok(HttpResponse{status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})
        }) }
    }
    #[test]
    fn app_details_membership_is_exact_and_materialized_only() {
        assert!(plugin_owns_app(&json!({"release":{"app_ids":["asdk_app_real"]}}),"connector_real").unwrap());
        assert!(plugin_owns_app(&json!({"release":{"app_templates":[{"materialized_app_ids":["connector_real"]}]}}),"connector_real").unwrap());
        for value in [json!({}),json!({"release":{"app_ids":["connector_real_suffix"]}}),json!({"release":{"app_templates":[{"id":"connector_real","reason":null,"instances":null}]}})] {
            assert!(!plugin_owns_app(&value,"connector_real").unwrap());
        }
        for value in [json!({"release":{"app_ids":[null]}}),json!({"release":{"app_templates":[false]}})] { assert!(plugin_owns_app(&value,"connector_real").is_err()); }
    }
    #[tokio::test]
    async fn app_details_reads_uninstalled_service_plugin_bare_metadata_and_fixed_links() {
        // Detail has no enabled/installed field; real materialized membership is sufficient.
        let transport=TestTransport::new(vec![(200,plugin()),(200,metadata()),(200,json!({"links":[link("own","asdk_app_real","app-user"),link("other","connector_other","foreign")]}))]);
        let result=ChatgptService::default().plugin_app_details_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["appId"],"connector_real");assert_eq!(result.body["links"].as_array().unwrap().len(),1);
        assert_eq!(result.body["pluginName"],"Displayed plugin name");
        assert_eq!(result.body["links"][0]["owner_profile"]["nickname"],"Actual nickname");
        assert_eq!(result.body["links"][0]["name"]," Custom account label ");
        assert_eq!(result.body["links"][0]["connector_name"]," Provider name ");
        assert_eq!(result.body["links"][0]["owner_profile"]["name"]," Profile name ");
        let text=serde_json::to_string(&result).unwrap();assert!(!text.contains("never-return")&&!text.contains("foreign")&&!text.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),3);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/ps/plugins/plugin-real");
        assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_real?include_actions=true");
        assert_eq!(sent[1].method,HttpMethod::Get);assert_eq!(sent[1].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[1].headers["X-Codex-Surface"],"settings");
        assert_eq!(sent[2].method,HttpMethod::Post);assert!(sent[2].url.ends_with("/aip/connectors/links/list_accessible"));
        assert_eq!(sent[2].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[2].headers["X-Codex-Surface"],"other");
        assert_eq!(serde_json::from_slice::<Value>(&sent[2].body).unwrap(),json!({"principals":[],"link_refresh_strategy":"BLOCKING"}));
    }
    #[tokio::test]
    async fn app_details_rejects_unowned_or_unreadable_plugin_without_app_reads() {
        for requested in ["connector_wrong","https://attacker.test/app"] {
            let transport=TestTransport::new(vec![(200,plugin())]);let mut request=request();request.app_id=requested.into();
            assert_eq!(ChatgptService::default().plugin_app_details_with(request,rpc,&transport).await.err().unwrap().code,"app_not_in_plugin");
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let transport=TestTransport::new(vec![(503,json!({}))]);
        assert!(ChatgptService::default().plugin_app_details_with(request(),rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),1);
        let denied=TestTransport::new(vec![(403,json!({}))]);
        assert_eq!(ChatgptService::default().plugin_app_details_with(request(),rpc,&denied).await.err().unwrap().code,"forbidden","real HTTP denial is not a membership redirect");
        let mut wrong=plugin();wrong["id"]=json!("different-plugin");let transport=TestTransport::new(vec![(200,wrong)]);
        assert_eq!(ChatgptService::default().plugin_app_details_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");
        assert_eq!(transport.sent.lock().unwrap().len(),1);
    }
    #[test]
    fn app_details_preserves_nonowner_hidden_and_implicit_without_editable_inference() {
        let mut hidden=link("hidden","connector_real","other-user");hidden["visibility"]=json!("HIDDEN");hidden["auth_status"]=json!("REAUTH_REQUIRED");
        let body=app_details_body("plugin-real","connector_real",metadata(),json!({"links":[hidden,link("implicit_link::real","connector_real","app-user")]})).unwrap();
        assert_eq!(body["links"][0]["owners"][0]["id"],"other-user");assert_eq!(body["links"][0]["visibility"],"HIDDEN");
        assert_eq!(body["links"][0]["auth_status"],"REAUTH_REQUIRED");assert!(body["links"][0].get("editable").is_none());
        assert_eq!(body["links"][1]["id"],"implicit_link::real");assert!(body["links"][1]["apps_privacy_control"].is_null());
    }
    #[test]
    fn app_details_malformed_or_wrapped_data_is_not_empty_success() {
        for (metadata,links) in [(json!({"connector":metadata()}),json!({"links":[]})),(metadata(),json!({})),
            (metadata(),json!({"links":[{"id":"bad","connector_id":"connector_real","owners":false}]})),
            (json!({"id":"connector_other"}),json!({"links":[]}))] {
            assert_eq!(app_details_body("plugin-real","connector_real",metadata,links).err().unwrap().code,"invalid_response");
        }
    }
    #[test]
    fn app_details_connector_logo_fields_preserve_nullish_values_without_unknown_fields() {
        let mut source=metadata();source["logo_url"]=json!("https://example.test/light.png");source["logo_url_dark"]=Value::Null;source["private_logo_token"]=json!("never-return");
        let result=app_details_connector("connector_real",source.clone()).unwrap();
        assert_eq!(result["logo_url"],source["logo_url"]);assert!(result["logo_url_dark"].is_null());assert!(result.get("private_logo_token").is_none());
        source["logo_url_dark"]=json!(false);assert!(app_details_connector("connector_real",source).is_err());
    }
    #[test]
    fn app_details_connector_keeps_raw_identity_and_supported_auth_projection() {
        let links=app_details_links("connector_real",json!({"links":[link("raw","asdk_app_real","user")]})).unwrap();
        assert_eq!(links[0]["connector_id"],"asdk_app_real","provider helpers compare raw IDs, not canonical aliases");
        let mut source=metadata();source["id"]=json!("asdk_app_real");
        source["supported_auth"]=json!([{"type":"OAUTH","secret":"never-return"},{"type":"UNKNOWN"}]);
        let result=app_details_connector("connector_real",source.clone()).unwrap();
        assert_eq!(result["id"],"asdk_app_real");assert_eq!(result["supported_auth"],json!([{"type":"OAUTH"},{"type":"UNKNOWN"}]));
        assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        for value in [Value::Null,json!([])] {
            source["supported_auth"]=value.clone();assert_eq!(app_details_connector("connector_real",source.clone()).unwrap()["supported_auth"],value);
        }
        source.as_object_mut().unwrap().remove("supported_auth");assert!(app_details_connector("connector_real",source.clone()).unwrap().get("supported_auth").is_none());
        for value in [json!(false),json!([{}]),json!([{"type":null}])] {
            source["supported_auth"]=value;assert!(app_details_connector("connector_real",source.clone()).is_err());
        }
    }
    #[test]
    fn app_details_sync_metadata_is_optional_strict_boolean_whitelist() {
        let mut source=metadata();
        assert!(app_details_connector("connector_real",source.clone()).unwrap().get("sync_metadata").is_none());
        source["sync_metadata"]=Value::Null;assert!(app_details_connector("connector_real",source.clone()).unwrap()["sync_metadata"].is_null());
        for allowed in [Value::Null,json!(false),json!(true)] {
            source["sync_metadata"]=json!({"user_allowed_to_sync":allowed,"secret":"never-return"});
            let result=app_details_connector("connector_real",source.clone()).unwrap();assert_eq!(result["sync_metadata"],json!({"user_allowed_to_sync":allowed}));
        }
        for value in [json!(false),json!({"user_allowed_to_sync":"true"}),json!({"user_allowed_to_sync":1})] {
            source["sync_metadata"]=value;assert!(app_details_connector("connector_real",source.clone()).is_err());
        }
    }
    #[tokio::test]
    async fn app_details_paths_are_single_encoded_segments() {
        let transport=TestTransport::new(vec![(200,json!({"id":"plugin-real","name":"Plugin","release":{"app_ids":["connector_x/y?z#%"]}})),
            (200,json!({"id":"connector_x/y?z#%","name":"App"})),(200,json!({"links":[]}))]);
        let mut request=request();request.app_id="connector_x/y?z#%".into();
        ChatgptService::default().plugin_app_details_with(request,rpc,&transport).await.unwrap();
        assert!(transport.sent.lock().unwrap()[1].url.ends_with("/aip/connectors/connector_x%2Fy%3Fz%23%25?include_actions=true"));
    }
    #[tokio::test]
    async fn app_details_refreshes_metadata_401_and_does_not_mask_links_failure() {
        let transport=TestTransport::new(vec![(200,plugin()),(401,json!({})),(200,metadata()),(200,json!({"links":[]}))]);
        let result=ChatgptService::default().plugin_app_details_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["links"],json!([]));
        { let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),4);assert_eq!(sent[1].url,sent[2].url); }
        for (status,links) in [(503,json!({"secret":"never-return"})),(200,json!({"links":false}))] {
            let transport=TestTransport::new(vec![(200,plugin()),(200,metadata()),(status,links)]);
            let result=ChatgptService::default().plugin_app_details_with(request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["connector"]["name"],"Real app");assert!(result.body["links"].is_null());
            assert!(result.body["linksError"]["code"].is_string());assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
            assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
    }
    #[tokio::test]
    async fn app_details_identity_change_during_transport_stops_followup() {
        struct Invalidate<'a>(&'a ChatgptService);
        impl Transport for Invalidate<'_> { fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&plugin()).unwrap()})
        }) } }
        let service=ChatgptService::default();
        assert_eq!(service.plugin_app_details_with(request(),rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
    #[tokio::test]
    async fn app_details_cancellation_interrupts_transport() {
        struct Wait { entered:AtomicBool }
        impl Transport for Wait { fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancelled"))
        }) } }
        let service=ChatgptService::default();let transport=Wait{entered:AtomicBool::new(false)};
        let (result,())=tokio::join!(service.plugin_app_details_with(request(),rpc,&transport),async {
            while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
            assert!(service.cancel("app-details-fixture"));
        });
        assert_eq!(result.err().unwrap().code,"cancelled");
    }
    fn entry_request() -> PluginAppEntryRequest {
        let source=request();PluginAppEntryRequest { request_id:source.request_id, expected_identity:source.expected_identity,
            profile:source.profile,app_id:source.app_id }
    }
    fn usage_links_request(ids:Vec<&str>)->PluginUsageLinksRequest {
        let source=entry_request();PluginUsageLinksRequest{request_id:source.request_id,expected_identity:source.expected_identity,profile:source.profile,app_ids:ids.into_iter().map(str::to_owned).collect()}
    }
    #[tokio::test]
    async fn usage_metadata_is_one_independent_connector_get_with_raw_id_and_public_logos(){
        let mut source=metadata();source["id"]=json!("asdk_app_real");source["logo_url"]=json!("https://example.test/light.png");source["logo_url_dark"]=Value::Null;
        let transport=TestTransport::new(vec![(200,source)]);let result=ChatgptService::default().plugin_usage_metadata_with(entry_request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["appId"],"asdk_app_real");assert_eq!(result.body["connector"]["id"],"asdk_app_real");assert_eq!(result.body["connector"]["logo_url"],"https://example.test/light.png");
        assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_real?include_actions=true");assert_eq!(sent[0].method,HttpMethod::Get);assert!(sent[0].body.is_empty());
        assert_eq!(sent[0].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[0].headers["X-Codex-Surface"],"settings");
    }
    #[tokio::test]
    async fn usage_links_are_one_accessible_post_for_normalized_unique_apps_without_secret_fields(){
        let mut hidden=link("hidden","connector_real","other-user");hidden["visibility"]=json!("HIDDEN");
        let transport=TestTransport::new(vec![(200,json!({"links":[link("real","asdk_app_real","app-user"),hidden,link("implicit_link::real","connector_real","app-user"),link("second","connector_second","app-user"),link("foreign","connector_foreign","other-user")]}))]);
        let result=ChatgptService::default().plugin_usage_links_with(usage_links_request(vec!["asdk_app_real","connector_real","connector_second"]),rpc,&transport).await.unwrap();
        assert_eq!(result.body["appIds"],json!(["asdk_app_real","connector_real","connector_second"]));let links=result.body["links"].as_array().unwrap();assert_eq!(links.len(),4);
        assert_eq!(links.iter().map(|link|link["id"].as_str().unwrap()).collect::<Vec<_>>(),vec!["real","hidden","implicit_link::real","second"]);
        assert_eq!(links[0]["connector_id"],"asdk_app_real","canonical matching must preserve the service's original connector ID");let text=serde_json::to_string(&result).unwrap();assert!(!text.contains("never-return")&&!text.contains("foreign")&&!text.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);assert_eq!(sent[0].method,HttpMethod::Post);assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/aip/connectors/links/list_accessible");
        assert_eq!(sent[0].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[0].headers["X-Codex-Surface"],"other");assert_eq!(serde_json::from_slice::<Value>(&sent[0].body).unwrap(),json!({"principals":[],"link_refresh_strategy":"BLOCKING"}));
    }
    #[tokio::test]
    async fn usage_empty_apps_skip_http_and_invalid_ids_fail_before_authentication(){
        let transport=TestTransport::new(vec![]);let result=ChatgptService::default().plugin_usage_links_with(usage_links_request(vec![]),rpc,&transport).await.unwrap();
        assert_eq!(result.body,json!({"appIds":[],"links":[]}));assert!(transport.sent.lock().unwrap().is_empty());
        for bad in ["","..","app\ninvalid"] {
            let transport=TestTransport::new(vec![]);assert_eq!(ChatgptService::default().plugin_usage_links_with(usage_links_request(vec!["connector_real",bad]),rpc,&transport).await.err().unwrap().code,"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());
        }
        let transport=TestTransport::new(vec![]);let mut stale=usage_links_request(vec![]);stale.expected_identity.generation=1;
        assert_eq!(ChatgptService::default().plugin_usage_links_with(stale,rpc,&transport).await.err().unwrap().code,"account_changed");
    }
    #[tokio::test]
    async fn usage_metadata_and_links_errors_are_independent_not_fake_empty_plugin_success(){
        for (status,body) in [(503,json!({})),(200,json!({"connector":metadata()})),(200,json!({"id":"connector_other","name":"Other app"}))] {
            let transport=TestTransport::new(vec![(status,body)]);assert!(ChatgptService::default().plugin_usage_metadata_with(entry_request(),rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        for (status,body) in [(503,json!({})),(200,json!({})),(200,json!({"links":false})),(200,json!({"links":[{"id":"bad","connector_id":"connector_real","owners":false}]}))] {
            let transport=TestTransport::new(vec![(status,body)]);assert!(ChatgptService::default().plugin_usage_links_with(usage_links_request(vec!["connector_real"]),rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }
    #[tokio::test]
    async fn usage_reads_refresh_explicit_401_once_and_ip_denial_never_retries(){
        let transport=TestTransport::new(vec![(401,json!({})),(200,metadata())]);assert!(ChatgptService::default().plugin_usage_metadata_with(entry_request(),rpc,&transport).await.is_ok());
        {let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);assert_eq!(sent[0].url,sent[1].url);assert_eq!(sent[1].headers["X-Codex-Surface"],"settings");}
        let transport=TestTransport::new(vec![(401,json!({})),(200,json!({"links":[]}))]);assert!(ChatgptService::default().plugin_usage_links_with(usage_links_request(vec!["connector_real"]),rpc,&transport).await.is_ok());assert_eq!(transport.sent.lock().unwrap().len(),2);
        let transport=TestTransport::new(vec![(401,json!({"error":{"code":"workspace_ip_not_authorized"}}))]);
        assert_eq!(ChatgptService::default().plugin_usage_links_with(usage_links_request(vec!["connector_real"]),rpc,&transport).await.err().unwrap().code,"ip_not_authorized");assert_eq!(transport.sent.lock().unwrap().len(),1);
    }
    #[tokio::test]
    async fn usage_identity_changes_stop_metadata_and_accessible_results(){
        struct Invalidate<'a>{service:&'a ChatgptService,body:Value}
        impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.service.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&self.body).unwrap()})})}}
        for metadata_read in [true,false] {
            let service=ChatgptService::default();let transport=Invalidate{service:&service,body:if metadata_read {metadata()}else{json!({"links":[]})}};
            let result=if metadata_read {service.plugin_usage_metadata_with(entry_request(),rpc,&transport).await}else{service.plugin_usage_links_with(usage_links_request(vec!["connector_real"]),rpc,&transport).await};
            assert_eq!(result.err().unwrap().code,"account_changed");
        }
    }
    #[tokio::test]
    async fn usage_cancel_interrupts_each_independent_read(){
        struct Wait{entered:AtomicBool}
        impl Transport for Wait{fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))})}}
        for metadata_read in [true,false] {
            let service=ChatgptService::default();let transport=Wait{entered:AtomicBool::new(false)};
            let read=async {if metadata_read {service.plugin_usage_metadata_with(entry_request(),rpc,&transport).await}else{service.plugin_usage_links_with(usage_links_request(vec!["connector_real"]),rpc,&transport).await}};
            let cancel=async {while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("app-details-fixture"));};
            assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,"cancelled");
        }
    }
    #[tokio::test]
    async fn app_resolve_accepts_only_real_string_or_explicit_null() {
        for value in [json!("plugin-real"),Value::Null] {
            let transport=TestTransport::new(vec![(200,json!({"plugin_id":value,"secret":"never-return"}))]);
            let result=ChatgptService::default().plugin_app_resolve_with(entry_request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body,json!({"appId":"asdk_app_real","pluginId":value}));
            assert_eq!(result.identity,identity());assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);assert_eq!(sent[0].method,HttpMethod::Get);
            assert_eq!(sent[0].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[0].headers["X-Codex-Surface"],"other");
        }
    }
    #[tokio::test]
    async fn app_resolve_missing_or_malformed_association_is_not_null() {
        for body in [Value::Null,json!("plugin-real"),json!([]),json!({}),json!({"pluginId":"plugin-real"}),
            json!({"plugin_id":false}),json!({"plugin_id":""}),json!({"plugin_id":" \t "}),json!({"plugin_id":{}}),json!({"plugin_id":".."})] {
            let transport=TestTransport::new(vec![(200,body)]);
            assert_eq!(ChatgptService::default().plugin_app_resolve_with(entry_request(),rpc,&transport).await.err().unwrap().code,"invalid_response");
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }
    #[tokio::test]
    async fn app_resolve_uses_raw_id_as_one_encoded_segment() {
        let mut request=entry_request();request.app_id="asdk_app_a/b?c#%中文".into();
        let expected=request.app_id.clone();let transport=TestTransport::new(vec![(200,json!({"plugin_id":null}))]);
        let result=ChatgptService::default().plugin_app_resolve_with(request,rpc,&transport).await.unwrap();
        assert_eq!(result.body["appId"],expected);
        assert_eq!(transport.sent.lock().unwrap()[0].url,
            "https://chatgpt.com/backend-api/ps/plugins/canonical-app/asdk_app_a%2Fb%3Fc%23%25%E4%B8%AD%E6%96%87");
    }
    #[tokio::test]
    async fn app_resolve_http_errors_never_become_no_association() {
        for status in [404,403,503] {
            let transport=TestTransport::new(vec![(status,json!({"plugin_id":null}))]);
            assert!(ChatgptService::default().plugin_app_resolve_with(entry_request(),rpc,&transport).await.is_err());
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }
    #[tokio::test]
    async fn app_resolve_generation_change_rejects_late_association() {
        struct Invalidate<'a>(&'a ChatgptService);
        impl Transport for Invalidate<'_> { fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"plugin_id":null}"#.to_vec()})
        }) } }
        let service=ChatgptService::default();
        assert_eq!(service.plugin_app_resolve_with(entry_request(),rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
    #[tokio::test]
    async fn app_resolve_cancellation_rejects_pending_association() {
        struct Wait { entered:AtomicBool }
        impl Transport for Wait { fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancelled"))
        }) } }
        let service=ChatgptService::default();let transport=Wait{entered:AtomicBool::new(false)};
        let (result,())=tokio::join!(service.plugin_app_resolve_with(entry_request(),rpc,&transport),async {
            while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
            assert!(service.cancel("app-details-fixture"));
        });
        assert_eq!(result.err().unwrap().code,"cancelled");
    }
    fn content() -> Value { json!({"apps":[{"id":"connector_real","name":"Hosted app","description":"Hosted description",
        "icon_url":null,"icon_dark_url":"https://example.test/dark.png","token":"never-return","tools":[{"secret":"never-return"}]},
        {"id":"connector_other","name":"Foreign app","token":"never-return"}]}) }
    #[tokio::test]
    async fn standalone_content_uses_verified_headers_raw_id_and_safe_projection() {
        let transport=TestTransport::new(vec![(200,content()),(200,metadata())]);
        let result=ChatgptService::default().plugin_app_standalone_with(entry_request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["app"]["id"],"asdk_app_real");assert_eq!(result.body["app"]["name"],"Hosted app");
        assert_eq!(result.body["app"]["logoUrl"],"https://example.test/dark.png");
        assert_eq!(result.body["app"]["logoUrlDark"],"https://example.test/dark.png");
        assert!(result.body["metadataError"].is_null());
        let text=serde_json::to_string(&result).unwrap();assert!(!text.contains("Foreign app")&&!text.contains("never-return")&&!text.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);assert_eq!(sent[0].method,HttpMethod::Post);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/ps/apps/batch");
        assert_eq!(sent[0].headers["OAI-Product-Sku"],"CONNECTOR_SETTING");assert_eq!(sent[0].headers["X-OpenAI-Locale"],"zh-CN");
        assert_eq!(sent[0].headers["ChatGPT-Account-Id"],"app-account");assert!(!sent[0].headers.contains_key("X-Codex-Surface"));
        assert_eq!(serde_json::from_slice::<Value>(&sent[0].body).unwrap(),json!({"app_ids":["asdk_app_real"],"include_tools":false}));
        assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_real?include_actions=true");
        assert_eq!(sent[1].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[1].headers["X-Codex-Surface"],"settings");
    }
    #[test]
    fn standalone_content_normalizes_icons_empty_description_and_uses_last_canonical_row() {
        for (light,dark,expected_light,expected_dark) in [(Value::Null,Value::Null,Value::Null,Value::Null),
            (json!("light"),Value::Null,json!("light"),json!("light")),(Value::Null,json!("dark"),json!("dark"),json!("dark")),
            (json!("light"),json!("dark"),json!("light"),json!("dark"))] {
            let app=standalone_app("asdk_app_real",json!({"apps":[{"id":"connector_real","name":"App","description":"","icon_url":light,"icon_dark_url":dark}]})).unwrap();
            assert!(app["description"].is_null());assert_eq!(app["logoUrl"],expected_light);assert_eq!(app["logoUrlDark"],expected_dark);
        }
        let duplicate=standalone_app("asdk_app_real",json!({"apps":[{"id":"connector_real","name":"One"},{"id":"asdk_app_real","name":"Two"}]})).unwrap();
        assert_eq!(duplicate["name"],"Two","BQbE.w Map retains the last normalized ID");
        let replaced=standalone_app("asdk_app_real",json!({"apps":[{"id":"connector_real","name":false},{"id":"asdk_app_real","name":"Current"}]})).unwrap();
        assert_eq!(replaced["name"],"Current","metadata from a replaced row is not projected");
    }
    #[tokio::test]
    async fn standalone_content_missing_malformed_and_http_errors_do_not_read_metadata() {
        for (status,body) in [(200,json!({"apps":[]})),(200,json!({"apps":[{"id":"connector_other","name":"Other"}]})),
            (200,json!({"apps":[{"id":"connector_real","name":false}]})),(200,json!({"apps":false})),(404,json!({})),(503,json!({}))] {
            let transport=TestTransport::new(vec![(status,body)]);
            assert!(ChatgptService::default().plugin_app_standalone_with(entry_request(),rpc,&transport).await.is_err());
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }
    #[tokio::test]
    async fn standalone_metadata_failure_preserves_hosted_header() {
        for (status,metadata) in [(503,json!({"secret":"never-return"})),(200,json!({"connector":metadata()}))] {
            let transport=TestTransport::new(vec![(200,content()),(status,metadata)]);
            let result=ChatgptService::default().plugin_app_standalone_with(entry_request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["app"]["name"],"Hosted app");assert!(result.body["connector"].is_null());
            assert!(result.body["metadataError"]["code"].is_string());assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        }
    }
    #[tokio::test]
    async fn standalone_content_requires_exact_chatgpt_auth_method_before_network() {
        for method in ["chatgptAuthTokens","apikey",""] {
            let transport=TestTransport::new(vec![]);
            let result=ChatgptService::default().plugin_app_standalone_with(entry_request(),|_,_|std::future::ready(Ok(json!({"authMethod":method,"authToken":"never-return"}))),&transport).await;
            assert_eq!(result.err().unwrap().code,"not_logged_in");assert!(transport.sent.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn standalone_identity_changes_during_content_or_metadata_are_top_level_errors() {
        struct Invalidate<'a> { service:&'a ChatgptService,at:usize,sent:AtomicUsize }
        impl Transport for Invalidate<'_> { fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            let index=self.sent.fetch_add(1,Ordering::SeqCst);if index==self.at { self.service.invalidate(); }
            Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&if index==0 {content()} else {metadata()}).unwrap()})
        }) } }
        for at in [0,1] {
            let service=ChatgptService::default();let transport=Invalidate{service:&service,at,sent:AtomicUsize::new(0)};
            assert_eq!(service.plugin_app_standalone_with(entry_request(),rpc,&transport).await.err().unwrap().code,"account_changed");
            assert_eq!(transport.sent.load(Ordering::SeqCst),at+1);
        }
    }
    #[tokio::test]
    async fn standalone_content_cancellation_is_not_a_metadata_error() {
        struct Wait { entered:AtomicBool }
        impl Transport for Wait { fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancelled"))
        }) } }
        let service=ChatgptService::default();let transport=Wait{entered:AtomicBool::new(false)};
        let (result,())=tokio::join!(service.plugin_app_standalone_with(entry_request(),rpc,&transport),async {
            while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
            assert!(service.cancel("app-details-fixture"));
        });
        assert_eq!(result.err().unwrap().code,"cancelled");
    }
}

impl ChatgptService {
    pub async fn plugin_usage_metadata_read<F, Fut>(&self, request: PluginAppEntryRequest, call: F) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_usage_metadata_with(request, call, &CurlTransport).await
    }

    async fn plugin_usage_metadata_with<F, Fut, T>(&self, request: PluginAppEntryRequest, call: F, transport: &T) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let encoded=encode_segment(&request.app_id)?;
        let registration=self.register(&request.request_id)?;
        let metadata=self.plugin_app_metadata_http(&format!("/backend-api/aip/connectors/{encoded}?include_actions=true"),
            &request.expected_identity,&request.profile,&registration,&call,transport).await?;
        let connector=app_details_connector(&request.app_id,metadata)?;
        self.check_share_current(&request.expected_identity,&registration)?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:request.expected_identity,body:json!({"appId":request.app_id,"connector":connector})})
    }

    pub async fn plugin_usage_links_read<F, Fut>(&self, request: PluginUsageLinksRequest, call: F) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_usage_links_with(request, call, &CurlTransport).await
    }

    async fn plugin_usage_links_with<F, Fut, T>(&self, request: PluginUsageLinksRequest, call: F, transport: &T) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let mut seen=std::collections::HashSet::new();let mut apps=Vec::new();
        for id in &request.app_ids {encode_segment(id)?;let id=canonical_app_id(id);if seen.insert(id.clone()){apps.push(id);}}
        let registration=self.register(&request.request_id)?;
        self.check_share_current(&request.expected_identity,&registration)?;
        let mut links=Vec::new();
        if !apps.is_empty() {
            let accessible=self.review_gitlab_http("/backend-api/aip/connectors/links/list_accessible",true,
                &request.expected_identity,&request.profile,&registration,&call,transport).await?;
            for id in apps {links.extend(app_details_links(&id,accessible.clone())?.as_array().ok_or_else(app_details_invalid)?.iter().cloned());}
        }
        self.check_share_current(&request.expected_identity,&registration)?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:request.expected_identity,body:json!({"appIds":request.app_ids,"links":links})})
    }

    pub async fn plugin_app_standalone_read<F, Fut>(&self, request: PluginAppEntryRequest, call: F) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_app_standalone_with(request, call, &CurlTransport).await
    }

    async fn plugin_app_standalone_with<F, Fut, T>(&self, request: PluginAppEntryRequest, call: F, transport: &T) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let encoded = encode_segment(&request.app_id)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        self.check_share_current(identity, &registration)?;
        let auth = tokio::select! {
            _ = cancelled(&registration.cancelled) => return Err(failure("cancelled", "App content request cancelled")),
            result = call("getAuthStatus", json!({})) => result.map_err(|_| failure("not_logged_in", "App content authentication unavailable"))?,
        };
        self.check_share_current(identity, &registration)?;
        if auth.get("authMethod").and_then(Value::as_str) != Some("chatgpt") {
            return Err(failure("not_logged_in", "App content requires a ChatGPT session"));
        }
        let content = self.plugin_app_content_http(&request, &registration, &call, transport).await?;
        let app = standalone_app(&request.app_id, content)?;
        let metadata = self.plugin_app_metadata_http(&format!("/backend-api/aip/connectors/{encoded}?include_actions=true"),
            identity, &request.profile, &registration, &call, transport).await.and_then(|value| app_details_connector(&request.app_id, value));
        let (connector, error) = match metadata {
            Ok(value) => (value, Value::Null),
            Err(error) if matches!(error.code,"account_changed"|"cancelled") => return Err(error),
            Err(error) => (Value::Null, json!({"code":error.code,"message":"App metadata unavailable"})),
        };
        self.check_share_current(identity, &registration)?;
        Ok(PluginPermissionsResponse { request_id:request.request_id, identity:identity.clone(),
            body:json!({"appId":request.app_id,"app":app,"connector":connector,"metadataError":error}) })
    }

    pub(super) async fn plugin_app_content_http<F, Fut, T>(&self, request: &PluginAppEntryRequest, registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let identity = &request.expected_identity;
        for attempt in 0..2 {
            self.check_share_current(identity, registration)?;
            let (mut outgoing, integrity) = {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                let credentials = session.credentials.as_ref().unwrap();
                if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                (build_http_request("/backend-api/ps/apps/batch", credentials, session.integrity.as_deref(), &request.profile)?, session.integrity.clone())
            };
            outgoing.method = HttpMethod::Post;
            outgoing.headers.insert("OAI-Product-Sku".into(), "CONNECTOR_SETTING".into());
            outgoing.headers.insert("X-OpenAI-Locale".into(), request.profile.language.clone());
            outgoing.headers.insert("Content-Type".into(), "application/json".into());
            outgoing.body = serde_json::to_vec(&json!({"app_ids":[request.app_id],"include_tools":false})).unwrap();
            share_network_allowed(call, &outgoing.url).await?;
            self.check_share_current(identity, registration)?;
            let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await?;
            self.check_share_current(identity, registration)?;
            let mut session = self.session.lock().await;
            self.check_share_current(identity, registration)?;
            apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response) { return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) }); }
            if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
            return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
        }
        unreachable!()
    }

    pub async fn plugin_app_resolve<F, Fut>(&self, request: PluginAppEntryRequest, call: F) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_app_resolve_with(request, call, &CurlTransport).await
    }

    async fn plugin_app_resolve_with<F, Fut, T>(&self, request: PluginAppEntryRequest, call: F, transport: &T) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        // The query cache canonicalizes identity, but the actual reference URI
        // substitutes the original appId. Keep those two operations distinct.
        let encoded = encode_segment(&request.app_id)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        let route = format!("/backend-api/ps/plugins/canonical-app/{encoded}");
        let association = self.remote_plugin_http(&route, HttpMethod::Get, false,
            identity, &request.profile, &registration, &call, transport).await?;
        let value = association.as_object().and_then(|object| object.get("plugin_id"))
            .ok_or_else(|| failure("invalid_response", "Plugin app association is incomplete"))?;
        if !value.is_null() && !value.as_str().is_some_and(|id| !id.trim().is_empty() && encode_segment(id).is_ok()) {
            return Err(failure("invalid_response", "Plugin app association identity is invalid"));
        }
        self.check_share_current(identity, &registration)?;
        Ok(PluginPermissionsResponse { request_id:request.request_id, identity:identity.clone(),
            body:json!({"appId":request.app_id,"pluginId":value}) })
    }

    pub async fn plugin_app_details_read<F, Fut>(&self, request: PluginAppDetailsRequest, call: F) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_app_details_with(request, call, &CurlTransport).await
    }

    async fn plugin_app_details_with<F, Fut, T>(&self, request: PluginAppDetailsRequest, call: F, transport: &T) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let registration = self.register(&request.request_id)?;
        let body = self.plugin_app_snapshot(&request, &registration, &call, transport).await?;
        Ok(PluginPermissionsResponse { request_id:request.request_id, identity:request.expected_identity, body })
    }

    pub(super) async fn plugin_app_snapshot<F, Fut, T>(&self, request: &PluginAppDetailsRequest, registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let plugin_encoded = encode_segment(&request.plugin_id)?;
        let app_id = canonical_app_id(&request.app_id);
        // nP passes route N unchanged through tB.appId/eC to L.zE. Only
        // membership and response identity comparisons use canonical aliases.
        let encoded = encode_segment(&request.app_id)?;
        let identity = &request.expected_identity;
        let plugin = self.remote_plugin_http(&format!("/backend-api/ps/plugins/{plugin_encoded}"), HttpMethod::Get, false,
            identity, &request.profile, &registration, &call, transport).await?;
        validate_remote_plugin_row(&plugin)?;
        if plugin["id"].as_str() != Some(request.plugin_id.as_str()) { return Err(app_details_invalid()); }
        if !plugin_owns_app(&plugin, &app_id)? {
            self.check_share_current(identity, &registration)?;
            return Err(failure("app_not_in_plugin", "App does not belong to the service plugin"));
        }
        let route = format!("/backend-api/aip/connectors/{encoded}?include_actions=true");
        let metadata = self.plugin_app_metadata_http(&route, identity, &request.profile, &registration, &call, transport).await?;
        // Metadata is the whole-page prerequisite; linked accounts have an
        // independent retry boundary and must not erase the available header.
        let mut body = app_details_body(&request.plugin_id, &app_id, metadata, json!({"links":[]}))?;
        let plugin_name = plugin["release"]["display_name"].as_str().or_else(|| plugin["name"].as_str()).ok_or_else(app_details_invalid)?;
        body["pluginName"] = json!(plugin_name);
        if let Some(status) = plugin.get("status") { body["pluginStatus"] = status.clone(); }
        let accessible = self.review_gitlab_http("/backend-api/aip/connectors/links/list_accessible", true,
            identity, &request.profile, &registration, &call, transport).await.and_then(|value| app_details_links(&app_id, value));
        match accessible {
            Ok(links) => body["links"] = links,
            Err(error) if matches!(error.code,"account_changed"|"cancelled") => return Err(error),
            Err(error) => {
                body["links"] = Value::Null;
                body["linksError"] = json!({"code":error.code,"message":"Plugin linked accounts unavailable"});
            },
        }
        self.check_share_current(identity, &registration)?;
        Ok(body)
    }

    pub(super) async fn plugin_app_metadata_http<F, Fut, T>(&self, route: &str, identity: &ServiceIdentity, profile: &ServiceProfile,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        for attempt in 0..2 {
            self.check_share_current(identity, registration)?;
            let (mut outgoing, integrity) = {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                let credentials = session.credentials.as_ref().unwrap();
                if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                (build_http_request(route, credentials, session.integrity.as_deref(), profile)?, session.integrity.clone())
            };
            outgoing.headers.insert("OAI-Product-Sku".into(), "CODEX".into());
            outgoing.headers.insert("X-Codex-Surface".into(), "settings".into());
            share_network_allowed(call, &outgoing.url).await?;
            self.check_share_current(identity, registration)?;
            let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await?;
            self.check_share_current(identity, registration)?;
            let mut session = self.session.lock().await;
            self.check_share_current(identity, registration)?;
            apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response) { return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) }); }
            if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
            return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
        }
        unreachable!()
    }
}
