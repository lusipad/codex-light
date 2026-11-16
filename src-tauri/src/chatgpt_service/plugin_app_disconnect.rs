//! Disconnect one real linked account; uncertain delivery recovers through reads.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAppDisconnectRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub plugin_id: String,
    pub app_id: String,
    pub link_id: String,
}

fn disconnect_target(body: &Value, link_id: &str) -> ServiceResult<()> {
    let links = body["links"].as_array().ok_or_else(|| failure("invalid_response", "Linked accounts unavailable"))?;
    let mut matches = links.iter().filter(|link| link["id"].as_str() == Some(link_id));
    let link = matches.next().ok_or_else(|| failure("not_found", "Linked account is unavailable"))?;
    if matches.next().is_some() { return Err(failure("invalid_response", "Linked account identity is ambiguous")); }
    if link_id.starts_with("implicit_link::") || link["visibility"] == "HIDDEN" {
        return Err(failure("forbidden", "Linked account cannot be disconnected"));
    }
    Ok(())
}

impl ChatgptService {
    pub async fn plugin_app_account_disconnect<F, Fut>(&self, request: PluginAppDisconnectRequest, call: F) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.plugin_app_account_disconnect_with(request, call, &CurlTransport).await
    }

    async fn plugin_app_account_disconnect_with<F, Fut, T>(&self, request: PluginAppDisconnectRequest, call: F, transport: &T) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let link = encode_segment(&request.link_id)?;
        encode_segment(&request.plugin_id)?;
        encode_segment(&request.app_id)?;
        let registration = self.register(&request.request_id)?;
        let details = PluginAppDetailsRequest {
            request_id:request.request_id.clone(),expected_identity:request.expected_identity,
            profile:request.profile,plugin_id:request.plugin_id,app_id:request.app_id,
        };
        let identity = &details.expected_identity;
        let before = self.plugin_app_snapshot(&details, &registration, &call, transport).await?;
        disconnect_target(&before, &request.link_id)?;
        // This is the shared linked-account path: no last-account or multi gate.
        let route = format!("/backend-api/aip/connectors/links/{link}");
        let delivery = match self.plugin_account_disconnect_http(&route, &details, &registration, &call, transport).await {
            Ok(()) => "accepted",
            Err(error) if error.code == "plugin_account_disconnect_unknown" => "unknown",
            Err(error) => return Err(error),
        };
        let after = self.plugin_app_snapshot(&details, &registration, &call, transport).await;
        self.check_share_current(identity, &registration)?;
        let (readback, warning) = match after {
            Ok(value) => (value, Value::Null),
            Err(error) if matches!(error.code,"account_changed"|"cancelled") => return Err(error),
            Err(_) => (Value::Null, json!("plugin_account_disconnect_readback_unavailable")),
        };
        // The snapshot preserves hidden and implicit rows. A UI filter must never
        // turn a still-present link into evidence that DELETE succeeded.
        let confirmed = readback["links"].as_array().is_some_and(|links|
            links.iter().all(|value| value["id"].as_str() != Some(request.link_id.as_str())));
        Ok(ProfileMutationResponse {request_id:request.request_id,identity:identity.clone(),
            body:json!({"delivery":delivery,"warningCode":warning}),readback,
            verification:if confirmed {"confirmed"} else {"pending"}})
    }

    async fn plugin_account_disconnect_http<F, Fut, T>(&self, route: &str, request: &PluginAppDetailsRequest,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<()>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let identity = &request.expected_identity;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Account disconnect cancelled; a sent delete may already have applied")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity, registration)?;
                    let credentials = session.credentials.as_ref().unwrap();
                    if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                    let integrity = session.integrity.clone();
                    let mut outgoing = build_http_request(route, credentials, integrity.as_deref(), &request.profile)?;
                    outgoing.method = HttpMethod::Delete;
                    outgoing.headers.insert("OAI-Product-Sku".into(), "CODEX".into());
                    outgoing.headers.insert("X-Codex-Surface".into(), "settings".into());
                    share_network_allowed(call, &outgoing.url).await?;
                    self.check_share_current(identity, registration)?;
                    let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                        .map_err(|_| failure("plugin_account_disconnect_unknown", "Account disconnect outcome unknown; read before retrying"))?;
                    self.check_share_current(identity, registration)?;
                    apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) { return Err(ServiceError {code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)}); }
                    if response.status == 401 && attempt == 0 {self.prepare(&mut session, identity.generation, call, true).await?;continue;}
                    if response.status >= 500 || response.status == 408 { return Err(failure("plugin_account_disconnect_unknown", "Account disconnect outcome unknown; read before retrying")); }
                    // The source consumes no response DTO; 204 has no JSON body.
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
    fn identity() -> ServiceIdentity { ServiceIdentity { account_id:"disconnect-account".into(),user_id:"disconnect-user".into(),generation:0 } }
    fn request() -> PluginAppDisconnectRequest { PluginAppDisconnectRequest {
        request_id:"disconnect-fixture".into(),expected_identity:identity(),plugin_id:"plugin-real".into(),app_id:"asdk_app_real".into(),link_id:"link/a?b#%中文".into(),
        profile:ServiceProfile { language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into() },
    } }
    fn token() -> String {
        let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"disconnect-account","user_id":"disconnect-user","chatgpt_account_is_fedramp":false}});
        format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))
    }
    async fn rpc(method:&'static str,_:Value)->Result<Value,String> { Ok(match method {
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),
        "account/read"=>json!({"account":{"type":"chatgpt","planType":"business"},"workspaceRouting":{
            "backendOrigin":"https://chatgpt.com","chatgptAccountId":"disconnect-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),
    }) }
    fn plugin()->Value {json!({"id":"plugin-real","name":"Plugin","status":"DISABLED_BY_ADMIN","release":{"app_ids":["connector_real"]}})}
    fn metadata()->Value {json!({"id":"asdk_app_real","name":"App","status":"DISABLED_BY_ADMIN","enable_multi_links":false})}
    fn link()->Value {json!({"id":"link/a?b#%中文","connector_id":"connector_real","name":"Other person's account",
        "owners":[{"type":"USER","id":"someone-else"}],"auth_status":"REAUTH_REQUIRED","auth_type":"OAUTH","secret":"never-return"})}
    fn snapshot(present:bool)->Vec<(u16,Value)> {vec![(200,plugin()),(200,metadata()),(200,json!({"links":if present {vec![link()]} else {vec![]}}))]}
    struct Fixture { replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>> }
    impl Fixture {
        fn new(replies:Vec<(u16,Value)>)->Self {Self {replies:Mutex::new(replies.into_iter().map(|(status,body)|Ok(HttpResponse {
            status,headers:BTreeMap::new(),body:if status==204 {vec![]} else {serde_json::to_vec(&body).unwrap()},
        })).collect()),sent:Mutex::new(Vec::new())}}
    }
    impl Transport for Fixture {fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> {Box::pin(async move {
        self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")
    })}}
    #[tokio::test]
    async fn disconnect_last_nonmulti_account_uses_exact_bodyless_delete_and_reads_back() {
        let mut replies=snapshot(true);replies.push((204,Value::Null));replies.extend(snapshot(false));let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"accepted");assert_eq!(result.readback["links"],json!([]));
        assert_eq!(result.readback["pluginStatus"],"DISABLED_BY_ADMIN");
        let serialized=serde_json::to_string(&result).unwrap();assert!(!serialized.contains("never-return")&&!serialized.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),7);let write=&sent[3];
        assert_eq!(write.method,HttpMethod::Delete);assert_eq!(write.url,"https://chatgpt.com/backend-api/aip/connectors/links/link%2Fa%3Fb%23%25%E4%B8%AD%E6%96%87");
        assert_eq!(write.headers["OAI-Product-Sku"],"CODEX");assert_eq!(write.headers["X-Codex-Surface"],"settings");assert!(write.body.is_empty());
        assert!(!write.headers.contains_key("Content-Type"));assert_eq!(sent.iter().filter(|item|item.method==HttpMethod::Delete).count(),1);
    }
    #[tokio::test]
    async fn disconnect_inaccessible_duplicate_or_unowned_target_never_deletes() {
        for case in ["unowned","hidden","implicit","wrong-app","absent","duplicate"] {
            let mut replies=snapshot(true);let mut request=request();
            match case {
                "unowned"=>{replies[0].1["release"]["app_ids"]=json!([]);replies.truncate(1);},
                "hidden"=>replies[2].1["links"][0]["visibility"]=json!("HIDDEN"),
                "implicit"=>{request.link_id="implicit_link::real".into();replies[2].1["links"][0]["id"]=json!(request.link_id);},
                "wrong-app"=>replies[2].1["links"][0]["connector_id"]=json!("connector_foreign"),
                "absent"=>replies[2].1["links"]=json!([]),
                "duplicate"=>{let duplicate=replies[2].1["links"][0].clone();replies[2].1["links"].as_array_mut().unwrap().push(duplicate);},
                _=>unreachable!(),
            }
            let transport=Fixture::new(replies);assert!(ChatgptService::default().plugin_app_account_disconnect_with(request,rpc,&transport).await.is_err(),"{case}");
            assert!(transport.sent.lock().unwrap().iter().all(|value|value.method!=HttpMethod::Delete));
        }
    }
    #[tokio::test]
    async fn disconnect_invalid_ids_and_scope_do_not_send() {
        for field in ["plugin","app","link","scope"] {
            let mut request=request();match field {"plugin"=>request.plugin_id="".into(),"app"=>request.app_id="..".into(),"link"=>request.link_id="".into(),_=>request.expected_identity.account_id="other-account".into()}
            let transport=Fixture::new(vec![]);assert!(ChatgptService::default().plugin_app_account_disconnect_with(request,rpc,&transport).await.is_err());assert!(transport.sent.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn disconnect_real_service_denial_does_not_modify_or_recover() {
        let mut replies=snapshot(true);replies.push((403,json!({})));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.err().unwrap().code,"forbidden");
        assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn disconnect_unknown_delivery_recovers_only_with_reads() {
        for (status,present) in [(503,false),(408,true),(500,true)] {
            let mut replies=snapshot(true);replies.push((status,json!({})));replies.extend(snapshot(present));let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,if present {"pending"} else {"confirmed"});
            assert_eq!(transport.sent.lock().unwrap().iter().filter(|item|item.method==HttpMethod::Delete).count(),1);
        }
        let mut replies=snapshot(true);replies.push((204,Value::Null));replies.extend(snapshot(false));let transport=Fixture::new(replies);
        transport.replies.lock().unwrap()[3]=Err(failure("network_error","fixture timeout"));
        let result=ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"confirmed");assert_eq!(transport.sent.lock().unwrap().len(),7);
    }
    #[tokio::test]
    async fn disconnect_failed_readback_or_hidden_target_is_not_confirmed_absence() {
        for at in [0,1,2,3] {
            let mut replies=snapshot(true);replies.push((204,Value::Null));let mut after=snapshot(true);
            if at<3 {after[at]=(503,json!({}));after.truncate(at+1);} else {after[2].1["links"][0]["visibility"]=json!("HIDDEN");}
            replies.extend(after);let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"pending");assert_eq!(result.body["delivery"],"accepted");
            if at<2 {assert!(result.readback.is_null());} else {assert!(!result.readback.is_null());}
            assert_eq!(transport.sent.lock().unwrap().iter().filter(|item|item.method==HttpMethod::Delete).count(),1);
        }
    }
    #[tokio::test]
    async fn disconnect_explicit_401_refreshes_once_and_second_denial_stops() {
        let mut replies=snapshot(true);replies.extend([(401,json!({})),(204,Value::Null)]);replies.extend(snapshot(false));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.unwrap().verification,"confirmed");
        {let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),8);assert_eq!(sent[3].url,sent[4].url);}
        let mut replies=snapshot(true);replies.extend([(401,json!({})),(401,json!({}))]);let transport=Fixture::new(replies);
        assert!(ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),5);
    }
    #[tokio::test]
    async fn disconnect_ip_denial_is_not_auth_refresh_or_unknown_delivery() {
        let mut replies=snapshot(true);replies.push((401,json!({"error":{"code":"workspace_ip_not_authorized"}})));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_account_disconnect_with(request(),rpc,&transport).await.err().unwrap().code,"ip_not_authorized");
        assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn disconnect_identity_change_after_delete_stops_all_followups() {
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
            let deleting=request.method==HttpMethod::Delete;let result=self.fixture.send(request,cancel).await;if deleting {self.service.invalidate();}result
        })}}
        let service=ChatgptService::default();let mut replies=snapshot(true);replies.push((204,Value::Null));let transport=Invalidate{service:&service,fixture:Fixture::new(replies)};
        assert_eq!(service.plugin_app_account_disconnect_with(request(),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn disconnect_cancel_during_delete_stops_without_readback() {
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
            if request.method==HttpMethod::Delete {self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))}
            else {self.fixture.send(request,cancel).await}
        })}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(snapshot(true)),entered:AtomicBool::new(false)};
        let (result,())=tokio::join!(service.plugin_app_account_disconnect_with(request(),rpc,&transport),async {
            while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("disconnect-fixture"));
        });assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),3);
    }
}
