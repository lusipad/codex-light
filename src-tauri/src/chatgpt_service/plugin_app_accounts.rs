//! Service-linked account nickname writes. Acknowledgements never replace readback.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAppRenameRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub plugin_id: String,
    pub app_id: String,
    pub link_id: String,
    pub name: String,
}

fn rename_name(name: &str) -> ServiceResult<&str> {
    let name = rename_trim(name);
    if name.is_empty() || name.chars().count() > 64 {
        return Err(failure("invalid_request", "Account nickname must contain 1 to 64 characters"));
    }
    Ok(name)
}

fn rename_trim(name: &str) -> &str {
    // JavaScript String.trim whitespace (not Rust's broader Unicode White_Space).
    name.trim_matches(|ch| matches!(ch, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
}

fn rename_target<'a>(body: &'a Value, link_id: &str) -> ServiceResult<&'a Value> {
    if body["connector"]["enable_multi_links"] != true {
        return Err(failure("forbidden", "Account renaming requires multiple account support"));
    }
    let links = body["links"].as_array().ok_or_else(|| failure("invalid_response", "Linked accounts unavailable"))?;
    let mut matches = links.iter().filter(|link| link["id"].as_str() == Some(link_id));
    let link = matches.next().ok_or_else(|| failure("not_found", "Linked account is unavailable"))?;
    if matches.next().is_some() { return Err(failure("invalid_response", "Linked account identity is ambiguous")); }
    if link_id.starts_with("implicit_link::") || link["visibility"] == "HIDDEN" {
        return Err(failure("forbidden", "Linked account cannot be renamed"));
    }
    Ok(link)
}

impl ChatgptService {
    pub async fn plugin_app_account_rename<F, Fut>(&self, request: PluginAppRenameRequest, call: F) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_app_account_rename_with(request, call, &CurlTransport).await
    }

    async fn plugin_app_account_rename_with<F, Fut, T>(&self, request: PluginAppRenameRequest, call: F, transport: &T) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let name = rename_name(&request.name)?.to_owned();
        let link = encode_segment(&request.link_id)?;
        // Validate all path identities before authentication or network activity.
        encode_segment(&request.plugin_id)?;
        encode_segment(&request.app_id)?;
        let registration = self.register(&request.request_id)?;
        let details = PluginAppDetailsRequest {
            request_id:request.request_id.clone(), expected_identity:request.expected_identity.clone(),
            profile:request.profile, plugin_id:request.plugin_id, app_id:request.app_id,
        };
        let identity = &details.expected_identity;
        let before = self.plugin_app_snapshot(&details, &registration, &call, transport).await?;
        let current = rename_target(&before, &request.link_id)?;
        if current.get("name").and_then(Value::as_str).is_some_and(|value| rename_trim(value) == name) {
            return Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(),
                body:json!({"delivery":"not_sent","warningCode":null}), readback:before, verification:"confirmed" });
        }
        let route = format!("/backend-api/ps/v2/links/{link}");
        let delivery = match self.plugin_account_rename_http(&route, &name, &details, &registration, &call, transport).await {
            Ok(()) => "accepted",
            Err(error) if error.code == "plugin_account_rename_unknown" => "unknown",
            Err(error) => return Err(error),
        };
        // Both acknowledged and uncertain writes recover only through reads.
        let after = self.plugin_app_snapshot(&details, &registration, &call, transport).await;
        self.check_share_current(identity, &registration)?;
        let (readback, warning) = match after {
            Ok(value) => (value, Value::Null),
            Err(error) if matches!(error.code,"account_changed"|"cancelled") => return Err(error),
            Err(_) => (Value::Null, json!("plugin_account_rename_readback_unavailable")),
        };
        let confirmed = readback["links"].as_array().is_some_and(|links| {
            let mut matches = links.iter().filter(|value| value["id"].as_str() == Some(request.link_id.as_str()));
            matches.next().is_some_and(|value| value["name"].as_str() == Some(name.as_str())) && matches.next().is_none()
        });
        Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(),
            body:json!({"delivery":delivery,"warningCode":warning}), readback,
            verification:if confirmed {"confirmed"} else {"pending"} })
    }

    #[allow(clippy::too_many_arguments)]
    async fn plugin_account_rename_http<F, Fut, T>(&self, route: &str, name: &str, request: &PluginAppDetailsRequest,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<()>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let identity = &request.expected_identity;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Account rename cancelled; a sent write may already have applied")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity, registration)?;
                    let credentials = session.credentials.as_ref().unwrap();
                    if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                    let integrity = session.integrity.clone();
                    let mut outgoing = build_http_request(route, credentials, integrity.as_deref(), &request.profile)?;
                    outgoing.method = HttpMethod::Patch;
                    outgoing.headers.insert("OAI-Product-Sku".into(), "CODEX".into());
                    outgoing.headers.insert("X-Codex-Surface".into(), "settings".into());
                    outgoing.headers.insert("Content-Type".into(), "application/json".into());
                    outgoing.body = serde_json::to_vec(&json!({"name":name})).unwrap();
                    share_network_allowed(call, &outgoing.url).await?;
                    self.check_share_current(identity, registration)?;
                    let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                        .map_err(|_| failure("plugin_account_rename_unknown", "Account rename outcome unknown; read before retrying"))?;
                    self.check_share_current(identity, registration)?;
                    apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) { return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) }); }
                    if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
                    if response.status >= 500 || response.status == 408 { return Err(failure("plugin_account_rename_unknown", "Account rename outcome unknown; read before retrying")); }
                    if (200..300).contains(&response.status) { return Ok(()); }
                    decode_response(response, registration.id.clone(), identity.clone())?;
                    return Ok(());
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
    fn identity() -> ServiceIdentity { ServiceIdentity { account_id:"rename-account".into(),user_id:"rename-user".into(),generation:0 } }
    fn request(name: &str) -> PluginAppRenameRequest { PluginAppRenameRequest {
        request_id:"rename-fixture".into(),expected_identity:identity(),plugin_id:"plugin-real".into(),app_id:"asdk_app_real".into(),link_id:"link/a?b#%中文".into(),name:name.into(),
        profile:ServiceProfile { language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into() },
    } }
    fn token() -> String {
        let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"rename-account","user_id":"rename-user","chatgpt_account_is_fedramp":false}});
        format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))
    }
    async fn rpc(method:&'static str,_:Value)->Result<Value,String> { Ok(match method {
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),
        "account/read"=>json!({"account":{"type":"chatgpt","planType":"business"},"workspaceRouting":{
            "backendOrigin":"https://chatgpt.com","chatgptAccountId":"rename-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),
    }) }
    fn plugin() -> Value { json!({"id":"plugin-real","name":"Plugin","status":"DISABLED_BY_ADMIN","release":{"app_ids":["connector_real"]}}) }
    fn metadata() -> Value { json!({"id":"asdk_app_real","name":"App","status":"DISABLED_BY_ADMIN","enable_multi_links":true,
        "supported_auth":[{"type":"OAUTH","private":"never-return"},{"type":"FUTURE"}]}) }
    fn links(name:&str)->Value { json!({"links":[{"id":"link/a?b#%中文","connector_id":"connector_real","name":name,
        "owners":[{"type":"USER","id":"someone-else"}],"auth_status":"REAUTH_REQUIRED","auth_type":"OAUTH",
        "owner_profile":{"name":"Other person","id":"provider-id","private":"never-return"},"secret":"never-return"}]}) }
    fn snapshot(name:&str)->Vec<(u16,Value)> { vec![(200,plugin()),(200,metadata()),(200,links(name))] }
    struct Fixture { replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>> }
    impl Fixture {
        fn new(replies:Vec<(u16,Value)>)->Self { Self {replies:Mutex::new(replies.into_iter().map(|(status,body)| Ok(HttpResponse {
            status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap(),
        })).collect()),sent:Mutex::new(Vec::new())} }
    }
    impl Transport for Fixture { fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
        self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")
    }) } }
    #[test]
    fn rename_implicit_prefix_uses_the_official_delimiter() {
        let body=json!({"connector":{"enable_multi_links":true},"links":[{"id":"implicit_linked-real"}]});
        assert!(rename_target(&body,"implicit_linked-real").is_ok(),"a similar prefix is not a system link");
        let system=json!({"connector":{"enable_multi_links":true},"links":[{"id":"implicit_link::real"}]});
        assert!(rename_target(&system,"implicit_link::real").is_err());
    }

    #[test]
    fn rename_unicode_limits_match_javascript_code_points_and_trim() {
        assert_eq!(rename_name("\u{feff} 新昵称 \u{a0}").unwrap(),"新昵称");
        assert_eq!(rename_name("\u{85}").unwrap(),"\u{85}");
        assert!(rename_name(&"😀".repeat(64)).is_ok());assert!(rename_name(&"😀".repeat(65)).is_err());
        for name in [""," \t\r\n","\u{feff}"] { assert!(rename_name(name).is_err()); }
    }
    #[tokio::test]
    async fn rename_invalid_names_do_not_authenticate_or_send() {
        for name in ["".into()," \t ".into(),"😀".repeat(65)] {
            let transport=Fixture::new(vec![]);
            assert_eq!(ChatgptService::default().plugin_app_account_rename_with(request(&name),|_,_|async { panic!("invalid value must not authenticate") },&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.sent.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn rename_uses_fixed_endpoint_trimmed_body_and_authoritative_projection() {
        let mut replies=snapshot("Old");replies.push((204,Value::Null));replies.extend(snapshot("新😀"));
        let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_app_account_rename_with(request(" 新😀 "),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"accepted");
        assert_eq!(result.readback["connector"]["id"],"asdk_app_real");assert_eq!(result.readback["pluginStatus"],"DISABLED_BY_ADMIN");
        assert_eq!(result.readback["connector"]["supported_auth"],json!([{"type":"OAUTH"},{"type":"FUTURE"}]));
        assert_eq!(result.readback["links"][0]["owner_profile"]["id"],"provider-id");
        let result=serde_json::to_string(&result).unwrap();assert!(!result.contains("never-return")&&!result.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),7);
        let write=&sent[3];assert_eq!(write.method,HttpMethod::Patch);
        assert_eq!(write.url,"https://chatgpt.com/backend-api/ps/v2/links/link%2Fa%3Fb%23%25%E4%B8%AD%E6%96%87");
        assert_eq!(write.headers["OAI-Product-Sku"],"CODEX");assert_eq!(write.headers["X-Codex-Surface"],"settings");
        assert_eq!(write.headers["Content-Type"],"application/json");assert_eq!(serde_json::from_slice::<Value>(&write.body).unwrap(),json!({"name":"新😀"}));
        assert_eq!(sent.iter().filter(|value|value.method==HttpMethod::Patch).count(),1);
    }
    #[tokio::test]
    async fn rename_same_name_does_not_write_or_refetch() {
        let transport=Fixture::new(snapshot(" Same "));
        let result=ChatgptService::default().plugin_app_account_rename_with(request("Same"),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"not_sent");assert_eq!(transport.sent.lock().unwrap().len(),3);
    }
    #[tokio::test]
    async fn rename_rejects_unowned_hidden_implicit_wrong_app_or_nonmulti_before_patch() {
        for case in ["unowned","hidden","implicit","wrong-app","nonmulti","duplicate"] {
            let mut replies=snapshot("Old");let mut request=request("New");
            match case {
                "unowned"=>{replies[0].1["release"]["app_ids"]=json!([]);replies.truncate(1);},
                "hidden"=>replies[2].1["links"][0]["visibility"]=json!("HIDDEN"),
                "implicit"=>{request.link_id="implicit_link::real".into();replies[2].1["links"][0]["id"]=json!(request.link_id);},
                "wrong-app"=>replies[2].1["links"][0]["connector_id"]=json!("connector_foreign"),
                "nonmulti"=>replies[1].1["enable_multi_links"]=json!(false),
                "duplicate"=>{let duplicate=replies[2].1["links"][0].clone();replies[2].1["links"].as_array_mut().unwrap().push(duplicate);},
                _=>unreachable!(),
            }
            let transport=Fixture::new(replies);assert!(ChatgptService::default().plugin_app_account_rename_with(request,rpc,&transport).await.is_err(),"{case}");
            assert!(transport.sent.lock().unwrap().iter().all(|value|value.method!=HttpMethod::Patch));
        }
    }
    #[tokio::test]
    async fn rename_unknown_delivery_only_reads_and_can_confirm() {
        for status in [503,408] {
            let mut replies=snapshot("Old");replies.push((status,json!({"private":"never-return"})));replies.extend(snapshot("New"));
            let transport=Fixture::new(replies);let result=ChatgptService::default().plugin_app_account_rename_with(request("New"),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"unknown");assert_eq!(transport.sent.lock().unwrap().len(),7);
        }
        let mut replies=snapshot("Old");replies.push((200,Value::Null));replies.extend(snapshot("New"));
        let transport=Fixture::new(replies);transport.replies.lock().unwrap()[3]=Err(failure("network_error","fixture timeout"));
        let result=ChatgptService::default().plugin_app_account_rename_with(request("New"),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"unknown");assert_eq!(transport.sent.lock().unwrap().len(),7);
    }
    #[tokio::test]
    async fn rename_readback_failure_or_mismatch_is_pending_not_replayed() {
        for at in [0,1,2,3] {
            let mut replies=snapshot("Old");replies.push((204,Value::Null));let mut after=snapshot("Old");
            if at<3 { after[at]=(503,json!({}));after.truncate(at+1); }
            replies.extend(after);let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_app_account_rename_with(request("New"),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"pending");assert_eq!(result.body["delivery"],"accepted");
            if at<2 { assert!(result.readback.is_null()); } else { assert!(!result.readback.is_null()); }
            assert_eq!(transport.sent.lock().unwrap().iter().filter(|value|value.method==HttpMethod::Patch).count(),1);
        }
    }
    #[tokio::test]
    async fn rename_admin_state_does_not_invent_a_gate_and_real_denial_is_preserved() {
        let mut replies=snapshot("Old");replies.push((403,json!({})));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_account_rename_with(request("New"),rpc,&transport).await.err().unwrap().code,"forbidden");
        assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn rename_explicit_401_refreshes_once_but_second_denial_does_not_replay() {
        let mut replies=snapshot("Old");replies.extend([(401,json!({})),(204,Value::Null)]);replies.extend(snapshot("New"));
        let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_app_account_rename_with(request("New"),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");
        {let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),8);assert_eq!(sent[3].url,sent[4].url);assert_eq!(sent[3].body,sent[4].body);}
        let mut replies=snapshot("Old");replies.extend([(401,json!({})),(401,json!({}))]);let transport=Fixture::new(replies);
        assert!(ChatgptService::default().plugin_app_account_rename_with(request("New"),rpc,&transport).await.is_err());
        assert_eq!(transport.sent.lock().unwrap().len(),5);
    }
    #[tokio::test]
    async fn rename_scope_mismatch_prevents_network() {
        let transport=Fixture::new(vec![]);let mut request=request("New");request.expected_identity.account_id="other-account".into();
        assert_eq!(ChatgptService::default().plugin_app_account_rename_with(request,rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn rename_generation_change_stops_readback_after_sent_write() {
        struct Invalidate<'a> { service:&'a ChatgptService,fixture:Fixture }
        impl Transport for Invalidate<'_> { fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            let writing=request.method==HttpMethod::Patch;let result=self.fixture.send(request,cancel).await;
            if writing {self.service.invalidate();}result
        }) } }
        let service=ChatgptService::default();let mut replies=snapshot("Old");replies.push((204,Value::Null));
        let transport=Invalidate{service:&service,fixture:Fixture::new(replies)};
        assert_eq!(service.plugin_app_account_rename_with(request("New"),rpc,&transport).await.err().unwrap().code,"account_changed");
        assert_eq!(transport.fixture.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn rename_cancel_during_write_stops_without_followup() {
        struct Wait { fixture:Fixture,entered:AtomicBool }
        impl Transport for Wait { fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> { Box::pin(async move {
            if request.method==HttpMethod::Patch {
                self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))
            } else {self.fixture.send(request,cancel).await}
        }) } }
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(snapshot("Old")),entered:AtomicBool::new(false)};
        let (result,())=tokio::join!(service.plugin_app_account_rename_with(request("New"),rpc,&transport),async {
            while !transport.entered.load(Ordering::SeqCst) {tokio::task::yield_now().await;}assert!(service.cancel("rename-fixture"));
        });
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),3);
    }
}
