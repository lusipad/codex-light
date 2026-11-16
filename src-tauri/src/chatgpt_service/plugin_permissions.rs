//! Fixed global plugin permissions; credentials and arbitrary settings never cross IPC.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPermissionsRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPermissionsWriteRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissionsResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub body: Value,
}

fn permission_value(body: &Value) -> ServiceResult<&str> {
    let settings = body.get("settings").and_then(Value::as_object)
        .ok_or_else(|| failure("invalid_response", "Plugin permission settings unavailable"))?;
    match settings.get("apps_privacy_control") {
        None | Some(Value::Null) => Ok("review_important_actions"),
        Some(Value::String(value)) if matches!(value.as_str(), "always_ask" | "ask_before_writes" | "review_important_actions" | "full_access") => Ok(value),
        _ => Err(failure("invalid_response", "Invalid plugin permission value")),
    }
}

fn permission_personal(body: &Value, identity: &ServiceIdentity) -> ServiceResult<bool> {
    let invalid = || failure("invalid_response", "Plugin permission account eligibility unavailable");
    // Desktop M7.readAccounts GETs /wham/accounts/check and M8 parses normalized
    // accounts[].id. CLax's raw map adapter belongs to another producer.
    let object = body.as_object().ok_or_else(invalid)?;
    let accounts = match object.get("accounts") {
        None => &[][..],
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
    };
    let ordering = match object.get("account_ordering") {
        None => &[][..],
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
    };
    let mut ordered = std::collections::HashSet::new();
    for value in ordering {
        if !ordered.insert(value.as_str().ok_or_else(invalid)?) { return Err(invalid()); }
    }
    // OAko.YL selects the first ordered normalized account before the page guard
    // checks it against the current identity. Missing optional arrays deny access.
    let selected_id = ordering.first().and_then(Value::as_str);
    let mut seen = std::collections::HashSet::new();
    let mut personal = false;
    for row in accounts {
        let account = row.as_object().ok_or_else(invalid)?;
        let string = |key| account.get(key).and_then(Value::as_str).ok_or_else(invalid);
        let id = string("id")?;
        if !seen.insert(id) { return Err(invalid()); }
        let structure = string("structure")?;
        string("account_user_id")?; string("plan_type")?;
        if !matches!(string("account_user_role")?, "account-owner" | "account-admin" | "analytics-viewer" | "standard-user")
            || !account.get("is_zdr").is_some_and(Value::is_boolean)
            || !account.get("is_openai_internal").is_some_and(Value::is_boolean) {
            return Err(invalid());
        }
        for key in ["can_access_with_session", "enable_account_switching", "is_deactivated", "is_fedramp_compliant_workspace"] {
            if account.get(key).is_some_and(|value| !value.is_boolean()) { return Err(invalid()); }
        }
        if selected_id == Some(id) && id == identity.account_id { personal = structure == "personal"; }
    }
    Ok(personal)
}

// CV1W.D5: materialized IDs qualify; an unmaterialized template qualifies only
// when both reason and instances are nullish. An empty instances array does not.
fn permission_plugin(row: &Value) -> ServiceResult<bool> {
    let invalid = || failure("invalid_response", "Plugin application eligibility unavailable");
    let release = match row.get("release") {
        None | Some(Value::Null) => return Ok(false),
        Some(value) => value.as_object().ok_or_else(invalid)?,
    };
    let ids = |value: Option<&Value>| -> ServiceResult<bool> {
        match value {
            None | Some(Value::Null) => Ok(false),
            Some(value) => {
                let values = value.as_array().ok_or_else(invalid)?;
                if values.iter().any(|value| !value.as_str().is_some_and(|value| !value.is_empty())) { return Err(invalid()); }
                Ok(!values.is_empty())
            },
        }
    };
    let mut eligible = ids(release.get("app_ids"))?;
    let templates = match release.get("app_templates") {
        None | Some(Value::Null) => return Ok(eligible),
        Some(value) => value.as_array().ok_or_else(invalid)?,
    };
    for template in templates {
        let template = template.as_object().ok_or_else(invalid)?;
        let materialized = ids(template.get("materialized_app_ids"))?;
        eligible |= materialized || (template.get("reason").is_none_or(Value::is_null) && template.get("instances").is_none_or(Value::is_null));
    }
    Ok(eligible)
}

impl ChatgptService {
    pub async fn plugin_permissions_read<F, Fut>(&self, request: PluginPermissionsRequest, call: F) -> ServiceResult<PluginPermissionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        let result = self.plugin_permissions_with(request, None, call, &CurlTransport).await?;
        Ok(PluginPermissionsResponse { request_id:result.request_id, identity:result.identity, body:result.readback })
    }

    pub async fn plugin_permissions_write<F, Fut>(&self, request: PluginPermissionsWriteRequest, call: F) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_permissions_with(PluginPermissionsRequest {
            request_id:request.request_id, expected_identity:request.expected_identity, profile:request.profile,
        }, Some(request.value), call, &CurlTransport).await
    }

    async fn plugin_permissions_with<F, Fut, T>(&self, request: PluginPermissionsRequest, update: Option<String>, call: F, transport: &T) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        if update.as_deref().is_some_and(|value| !matches!(value, "always_ask" | "ask_before_writes" | "review_important_actions")) {
            return Err(failure("invalid_request", "Global plugin permission choice is unavailable"));
        }
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        let accounts = self.permission_http("/backend-api/wham/accounts/check", HttpMethod::Get, &request, &registration, &call, transport).await?;
        let personal = permission_personal(&accounts, identity)?;
        let eligible = if personal {
            let plugins = self.remote_plugin_pages(identity, &request.profile, true, &registration, &call, transport).await?;
            let mut eligible = false;
            for plugin in &plugins { eligible |= permission_plugin(plugin)?; }
            eligible
        } else { false };
        self.check_share_current(identity, &registration)?;
        if !eligible {
            if update.is_some() { return Err(failure("forbidden", "Global plugin permissions unavailable")); }
            return Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(), body:Value::Null,
                readback:json!({"access":"denied","value":null}), verification:"not_applicable" });
        }
        let settings = self.permission_http("/backend-api/settings/user", HttpMethod::Get, &request, &registration, &call, transport).await?;
        let value = permission_value(&settings)?;
        let page = |value: &str| json!({"access":"allowed","value":value});
        let Some(update) = update else {
            return Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(), body:Value::Null,
                readback:page(value), verification:"not_applicable" });
        };
        if update == value {
            return Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(), body:json!({"delivery":"not_sent"}),
                readback:page(value), verification:"confirmed" });
        }
        // Only one fixed field in the query. No JSON body, renderer URL or arbitrary feature.
        let route = format!("/backend-api/settings/account_user_setting?feature=apps_privacy_control&value={update}");
        let delivery = match self.permission_http(&route, HttpMethod::Patch, &request, &registration, &call, transport).await {
            Ok(_) => "accepted",
            Err(error) if error.code == "plugin_permissions_write_unknown" => "unknown",
            Err(error) => return Err(error),
        };
        // ACK and uncertain delivery both recover with GET only; never replay PATCH.
        let readback = self.permission_http("/backend-api/settings/user", HttpMethod::Get, &request, &registration, &call, transport).await
            .and_then(|body| permission_value(&body).map(page));
        self.check_share_current(identity, &registration)?;
        let (readback, warning) = match readback {
            Ok(page) => (page, Value::Null),
            Err(error) if matches!(error.code,"account_changed"|"cancelled") => return Err(error),
            Err(_) => (Value::Null, json!("plugin_permissions_readback_unavailable")),
        };
        let confirmed = readback.get("value").and_then(Value::as_str) == Some(update.as_str());
        Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(), body:json!({"delivery":delivery,"warningCode":warning}),
            readback, verification:if confirmed {"confirmed"} else {"pending"} })
    }

    #[allow(clippy::too_many_arguments)]
    async fn permission_http<F, Fut, T>(&self, route: &str, method: HttpMethod, request: &PluginPermissionsRequest,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let identity = &request.expected_identity;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Plugin permission request cancelled; a sent write may already have applied")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity, registration)?;
                    let credentials = session.credentials.as_ref().unwrap();
                    if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                    let integrity = session.integrity.clone();
                    let mut outgoing = build_http_request(route, credentials, integrity.as_deref(), &request.profile)?;
                    outgoing.method = method;
                    outgoing.headers.insert("X-Codex-Surface".into(), "settings".into());
                    share_network_allowed(call, &outgoing.url).await?;
                    self.check_share_current(identity, registration)?;
                    let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                        .map_err(|error| if method == HttpMethod::Patch { failure("plugin_permissions_write_unknown", "Plugin permission write outcome unknown; read before retrying") } else { error })?;
                    self.check_share_current(identity, registration)?;
                    apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) { return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) }); }
                    if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
                    if method == HttpMethod::Patch {
                        if response.status >= 500 || response.status == 408 { return Err(failure("plugin_permissions_write_unknown", "Plugin permission write outcome unknown; read before retrying")); }
                        // The reference consumes no mutation response; persistence comes from GET.
                        if (200..300).contains(&response.status) { return Ok(Value::Null); }
                    }
                    return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
                }
                unreachable!()
            } => result,
        };
        self.check_share_current(identity, registration)?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> ServiceIdentity { ServiceIdentity { account_id:"permissions-account".into(), user_id:"permissions-user".into(), generation:0 } }
    fn request() -> PluginPermissionsRequest {
        PluginPermissionsRequest { request_id:"permissions-fixture".into(), expected_identity:identity(), profile:ServiceProfile {
            language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into(),
        } }
    }
    fn token() -> String {
        let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"permissions-account","user_id":"permissions-user","chatgpt_account_is_fedramp":false}});
        format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))
    }
    async fn rpc(method: &'static str, _: Value) -> Result<Value,String> {
        Ok(match method {
            "getAuthStatus" => json!({"authMethod":"chatgpt","authToken":token()}),
            "account/read" => json!({"account":{"type":"chatgpt","planType":"future-personal-plan"},"workspaceRouting":{
                "backendOrigin":"https://chatgpt.com","chatgptAccountId":"permissions-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
            "configRequirements/read" => json!({"requirements":null}),
            _ => panic!("unexpected RPC {method}"),
        })
    }
    fn accounts(structure: &str) -> Value {
        json!({"accounts":[{"id":"permissions-account","account_user_id":"membership-not-user-id",
            "account_user_role":"account-owner","structure":structure,"plan_type":"future-personal-plan",
            "is_zdr":false,"is_openai_internal":false}],"account_ordering":["permissions-account"]})
    }
    fn plugins() -> Value {
        json!({"plugins":[{"id":"plugin","name":"Plugin","release":{"app_ids":["connector-real"]}}],"pagination":{"next_page_token":null}})
    }
    fn settings(value: Value) -> Value { json!({"settings":{"apps_privacy_control":value,"private":"never-return"}}) }
    struct TestTransport { replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>,pause_at:usize,entered:AtomicBool }
    impl TestTransport {
        fn new(replies:Vec<(u16,Value)>) -> Self {
            Self {replies:Mutex::new(replies.into_iter().map(|(status,body)|Ok(HttpResponse {
                status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap(),
            })).collect()),sent:Mutex::new(Vec::new()),pause_at:usize::MAX,entered:AtomicBool::new(false)}
        }
    }
    impl Transport for TestTransport {
        fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> {
            Box::pin(async move {
                let index={let mut sent=self.sent.lock().unwrap();sent.push(request);sent.len()-1};
                if index==self.pause_at {
                    self.entered.store(true,Ordering::SeqCst);
                    tokio::select! {
                        _=cancelled(&cancel)=>return Err(failure("cancelled","fixture cancelled")),
                        _=tokio::time::sleep(Duration::from_millis(150))=>{},
                    }
                }
                self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")
            })
        }
    }
    #[test]
    fn plugin_permissions_value_defaults_and_four_read_values_are_strict() {
        for value in [Value::Null,json!("always_ask"),json!("ask_before_writes"),json!("review_important_actions"),json!("full_access")] {
            assert!(permission_value(&settings(value)).is_ok());
        }
        assert_eq!(permission_value(&json!({"settings":{}})).unwrap(),"review_important_actions");
        for body in [json!({}),json!({"settings":[]}),settings(json!("future")),settings(json!(false))] { assert!(permission_value(&body).is_err()); }
    }
    #[test]
    fn plugin_permissions_d5_distinguishes_nullish_instances_and_real_materialization() {
        for release in [json!({"app_ids":["real"]}),json!({"app_templates":[{}]}),json!({"app_templates":[{"reason":null,"instances":null}]}),
            json!({"app_templates":[{"reason":"blocked","instances":[],"materialized_app_ids":["real"]}]})] {
            assert!(permission_plugin(&json!({"release":release})).unwrap());
        }
        for release in [json!({}),json!({"app_ids":[]}),json!({"app_templates":[{"instances":[]}]}),json!({"app_templates":[{"reason":"blocked"}]})] {
            assert!(!permission_plugin(&json!({"release":release})).unwrap());
        }
        for release in [json!({"app_ids":[null]}),json!({"app_ids":{}}),json!({"app_templates":[false]}),json!({"app_templates":[{"materialized_app_ids":[""]}]})] {
            assert!(permission_plugin(&json!({"release":release})).is_err());
        }
    }
    #[test]
    fn plugin_permissions_account_membership_uses_normalized_wham_array_identity() {
        assert!(permission_personal(&accounts("personal"),&identity()).unwrap());
        assert!(!permission_personal(&accounts("workspace"),&identity()).unwrap());
        let mut other=accounts("personal");other["accounts"][0]["id"]=json!("other-account");
        assert!(!permission_personal(&other,&identity()).unwrap());
        let mut ordering=accounts("personal");ordering["account_ordering"]=json!(["default"]);
        assert!(!permission_personal(&ordering,&identity()).unwrap(),"ordering must select a real normalized account.id");
        let mut no_ordering=accounts("personal");no_ordering.as_object_mut().unwrap().remove("account_ordering");
        assert!(!permission_personal(&no_ordering,&identity()).unwrap(),"valid missing ordering yields no selected account");
        assert!(!permission_personal(&json!({"accounts":[]}),&identity()).unwrap());
        let mut duplicate=accounts("personal");let row=duplicate["accounts"][0].clone();duplicate["accounts"].as_array_mut().unwrap().push(row);
        assert!(permission_personal(&duplicate,&identity()).is_err());
        let mut later=accounts("personal");let mut other=later["accounts"][0].clone();other["id"]=json!("other-account");
        later["accounts"].as_array_mut().unwrap().insert(0,other);later["account_ordering"]=json!(["other-account","permissions-account"]);
        assert!(!permission_personal(&later,&identity()).unwrap(),"a later current account cannot replace the first selected account");
        let mut duplicate_order=accounts("personal");duplicate_order["account_ordering"]=json!(["permissions-account","permissions-account"]);
        assert!(permission_personal(&duplicate_order,&identity()).is_err());
        let mut missing=accounts("personal");missing["accounts"][0].as_object_mut().unwrap().remove("id");
        assert!(permission_personal(&missing,&identity()).is_err());
        for (field,value) in [("account_user_role",json!("owner")),("is_zdr",json!(null)),("can_access_with_session",json!("true"))] {
            let mut malformed=accounts("personal");malformed["accounts"][0][field]=value;
            assert!(permission_personal(&malformed,&identity()).is_err());
        }
        assert!(!permission_personal(&json!({}),&identity()).unwrap(),"optional accounts omitted is a successful no-account response");
        for malformed in [json!(null),json!({"accounts":null}),json!({"accounts":[],"account_ordering":[false]}),json!({"accounts":[false]}),json!({"accounts":[{"id":"permissions-account","structure":"personal"}]}),
            json!({"account_ordering":["default"],"accounts":{"default":{"account":{"account_id":"permissions-account","structure":"personal"}}}})] {
            assert!(permission_personal(&malformed,&identity()).is_err());
        }
    }
    #[tokio::test]
    async fn plugin_permissions_read_uses_complete_inventory_without_plan_guessing() {
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("full_access")))]);
        let result=ChatgptService::default().plugin_permissions_with(request(),None,rpc,&transport).await.unwrap();
        assert_eq!(result.readback,json!({"access":"allowed","value":"full_access"}));
        let serialized=serde_json::to_string(&result).unwrap();assert!(!serialized.contains("never-return")&&!serialized.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),3);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/wham/accounts/check");
        assert!(sent[1].url.ends_with("/backend-api/ps/plugins/installed?limit=1000&includeExtensions=true"));
        assert_eq!(sent[2].url,"https://chatgpt.com/backend-api/settings/user");
    }
    #[tokio::test]
    async fn plugin_permissions_pagination_must_finish_before_eligibility_or_write() {
        let mut page=plugins();page["pagination"]["next_page_token"]=json!("next");
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,page),(503,json!({}))]);
        assert!(ChatgptService::default().plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport).await.is_err());
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),3);assert!(sent.iter().all(|request|request.method==HttpMethod::Get));
    }
    #[tokio::test]
    async fn plugin_permissions_denied_read_and_write_never_read_or_patch_settings() {
        for update in [None,Some("always_ask".into())] {
            let transport=TestTransport::new(vec![(200,accounts("workspace"))]);
            let result=ChatgptService::default().plugin_permissions_with(request(),update.clone(),rpc,&transport).await;
            if update.is_some(){assert_eq!(result.err().unwrap().code,"forbidden");}
            else{assert_eq!(result.unwrap().readback,json!({"access":"denied","value":null}));}
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,json!({"plugins":[],"pagination":{"next_page_token":null}}))]);
        assert_eq!(ChatgptService::default().plugin_permissions_with(request(),None,rpc,&transport).await.unwrap().readback["access"],"denied");
        assert_eq!(transport.sent.lock().unwrap().len(),2);
    }
    #[tokio::test]
    async fn plugin_permissions_invalid_global_choices_reject_before_authentication() {
        for value in ["full_access","future","","always_ask&feature=other"] {
            let transport=TestTransport::new(vec![]);
            assert_eq!(ChatgptService::default().plugin_permissions_with(request(),Some(value.into()),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.sent.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn plugin_permissions_patch_is_query_only_and_verified_by_real_get() {
        for value in ["always_ask","ask_before_writes","review_important_actions"] {
            let before=if value=="always_ask"{"ask_before_writes"}else{"always_ask"};
            let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!(before))),(204,Value::Null),(200,settings(json!(value)))]);
            let result=ChatgptService::default().plugin_permissions_with(request(),Some(value.into()),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"accepted");
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),5);assert_eq!(sent[3].method,HttpMethod::Patch);
            assert_eq!(sent[3].url,format!("https://chatgpt.com/backend-api/settings/account_user_setting?feature=apps_privacy_control&value={value}"));
            assert!(sent[3].body.is_empty());assert_eq!(sent[3].headers["ChatGPT-Account-Id"],"permissions-account");assert_eq!(sent[4].method,HttpMethod::Get);
        }
    }
    #[tokio::test]
    async fn plugin_permissions_same_value_avoids_patch_and_preserves_read_confirmation() {
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(Value::Null))]);
        let result=ChatgptService::default().plugin_permissions_with(request(),Some("review_important_actions".into()),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"not_sent");assert_eq!(transport.sent.lock().unwrap().len(),3);
    }
    #[tokio::test]
    async fn plugin_permissions_ack_unknown_and_failed_readback_never_replay_patch() {
        for (status,after,expected) in [(200,(200,settings(json!("ask_before_writes"))),"pending"),(503,(200,settings(json!("always_ask"))),"confirmed"),
            (408,(200,settings(json!("ask_before_writes"))),"pending"),(200,(503,json!({})),"pending")] {
            let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("ask_before_writes"))),(status,Value::Null),after]);
            let result=ChatgptService::default().plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,expected);assert_eq!(result.body["delivery"],if status==200{"accepted"}else{"unknown"});
            assert_eq!(transport.sent.lock().unwrap().iter().filter(|request|request.method==HttpMethod::Patch).count(),1);
        }
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("ask_before_writes"))),(200,Value::Null),(200,settings(json!("always_ask")))]);
        transport.replies.lock().unwrap()[3]=Err(failure("network_error","fixture delivery unknown"));
        let result=ChatgptService::default().plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"unknown");assert_eq!(transport.sent.lock().unwrap().len(),5);
    }
    #[tokio::test]
    async fn plugin_permissions_definite_refusal_does_not_attempt_readback_or_repeat() {
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("ask_before_writes"))),(403,json!({}))]);
        assert!(ChatgptService::default().plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport).await.is_err());
        assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn plugin_permissions_generation_change_drops_late_write_and_prevents_followup() {
        let service=ChatgptService::default();let mut transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("ask_before_writes"))),(200,Value::Null)]);transport.pause_at=3;
        let write=service.plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport);
        let invalidate=async {while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}service.invalidate();};
        let (result,())=tokio::join!(write,invalidate);assert!(matches!(result.err().unwrap().code,"account_changed"|"cancelled"));assert_eq!(transport.sent.lock().unwrap().len(),4);
    }

    #[tokio::test]
    async fn plugin_permissions_401_refreshes_once_but_ip_refusal_does_not() {
        for (status,body,count) in [(401,json!({}),6),(401,json!({"error":{"type":"ip_not_authorized"}}),4)] {
            let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("ask_before_writes"))),
                (status,body),(204,Value::Null),(200,settings(json!("always_ask")))]);
            let result=ChatgptService::default().plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport).await;
            if count==6 {assert_eq!(result.unwrap().verification,"confirmed");}
            else {assert_eq!(result.err().unwrap().code,"ip_not_authorized");}
            assert_eq!(transport.sent.lock().unwrap().len(),count);
        }
        let transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),(200,settings(json!("ask_before_writes"))),
            (401,json!({})),(401,json!({}))]);
        assert!(ChatgptService::default().plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport).await.is_err());
        assert_eq!(transport.sent.lock().unwrap().len(),5);
    }

    #[tokio::test]
    async fn plugin_permissions_cancel_after_send_never_follows_with_readback() {
        let service=ChatgptService::default();let mut transport=TestTransport::new(vec![(200,accounts("personal")),(200,plugins()),
            (200,settings(json!("ask_before_writes"))),(200,Value::Null)]);transport.pause_at=3;
        let write=service.plugin_permissions_with(request(),Some("always_ask".into()),rpc,&transport);
        let cancel=async {while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("permissions-fixture"));};
        let (result,())=tokio::join!(write,cancel);assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
}
