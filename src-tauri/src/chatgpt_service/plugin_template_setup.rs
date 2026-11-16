//! Fresh CODEX eligibility for local templates. Never creates connectors or starts OAuth.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginTemplateSetupRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    /// Already resolved tQpF.Bk service target; preserve it verbatim, including any @.
    pub plugin_id:String,
}

fn setup_template_ids(body:&Value,plugin_id:&str)->ServiceResult<Vec<String>> {
    let invalid=||failure("invalid_response","Plugin template eligibility is incomplete or belongs to another plugin");
    if body.get("id").and_then(Value::as_str)!=Some(plugin_id) {return Err(invalid());}
    let templates=body.get("release").and_then(Value::as_object).and_then(|release|release.get("app_templates"))
        .and_then(Value::as_array).ok_or_else(invalid)?;
    let mut ids=Vec::<String>::new();
    for template in templates {
        let template=template.as_object().ok_or_else(invalid)?;
        if template.get("can_setup")!=Some(&Value::Bool(true)) {continue;}
        let id=template.get("template_id").and_then(Value::as_str).filter(|id|!id.is_empty()).ok_or_else(invalid)?;
        if !ids.iter().any(|current|current.as_str()==id) {ids.push(id.to_owned());}
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    const ID:&str="raw/id?中%2F";
    fn identity()->ServiceIdentity {ServiceIdentity {account_id:"template-account".into(),user_id:"template-user".into(),generation:0}}
    fn request()->PluginTemplateSetupRequest {PluginTemplateSetupRequest {request_id:"template-fixture".into(),expected_identity:identity(),plugin_id:ID.into(),profile:ServiceProfile {
        language:"zh-CN".into(),device_id:"template-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"Chromium".into(),platform_client_hint:"Windows".into(),
    }}}
    fn rpc(method:&'static str,_:Value)->std::future::Ready<Result<Value,String>> {
        std::future::ready(Ok(match method {
            "getAuthStatus"=>{let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"template-account","user_id":"template-user"}});
                json!({"authMethod":"chatgpt","authToken":format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))})},
            "account/read"=>json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"template-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
            "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected fixture RPC"),
        }))
    }
    fn body()->Value {json!({"id":ID,"secret":"never-return","release":{"version":"fresh-service-version","app_templates":[
        {"template_id":"first","can_setup":true,"client_secret":"never-return"},{"template_id":"false","can_setup":false},
        {"template_id":"null","can_setup":null},{"template_id":"missing"},{"template_id":"string","can_setup":"true"},
        {"template_id":"first","can_setup":true},{"template_id":"second","can_setup":true}]}})}
    struct Fixture {replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>,pause:bool,entered:AtomicBool}
    impl Fixture {
        fn new(values:Vec<(u16,Value)>)->Self {Self {replies:Mutex::new(values.into_iter().map(|(status,body)|Ok(HttpResponse {status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})).collect()),
            sent:Mutex::new(Vec::new()),pause:false,entered:AtomicBool::new(false)}}
    }
    impl Transport for Fixture {fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
        self.sent.lock().unwrap().push(request);self.entered.store(true,Ordering::SeqCst);
        if self.pause {tokio::select! {_=cancelled(&cancel)=>return Err(failure("cancelled","fixture cancelled")),_=tokio::time::sleep(Duration::from_millis(200))=>{}}}
        self.replies.lock().unwrap().pop_front().expect("unexpected template read retry/write")
    })}}

    #[tokio::test]
    async fn plugin_template_setup_reads_fixed_raw_id_fresh_codex_other_and_returns_only_strict_true_ids() {
        let fixture=Fixture::new(vec![(200,body()),(200,json!({"id":ID,"release":{"app_templates":[]}}))]);let service=ChatgptService::default();
        let result=service.plugin_template_setup_with(request(),rpc,&fixture).await.unwrap();
        assert_eq!(result.identity,identity());assert_eq!(result.body,json!({"pluginId":ID,"setupEligibleAppTemplateIds":["first","second"]}));
        assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        let result=service.plugin_template_setup_with(request(),rpc,&fixture).await.unwrap();assert_eq!(result.body["setupEligibleAppTemplateIds"],json!([]));
        let sent=fixture.sent.lock().unwrap();assert_eq!(sent.len(),2);
        for request in &*sent {assert_eq!(request.method,HttpMethod::Get);assert_eq!(request.url,"https://chatgpt.com/backend-api/ps/plugins/raw%2Fid%3F%E4%B8%AD%252F");
            assert!(request.body.is_empty());assert_eq!(request.headers["OAI-Product-Sku"],"CODEX");assert_eq!(request.headers["X-Codex-Surface"],"other");assert_eq!(request.headers["originator"],"Codex Desktop");assert_eq!(request.headers["ChatGPT-Account-Id"],"template-account");}
    }

    #[tokio::test]
    async fn plugin_template_setup_missing_or_bad_consumed_fields_are_error_not_empty_eligibility() {
        for value in [Value::Null,json!({"id":ID}),json!({"id":ID,"release":null}),json!({"id":ID,"release":{}}),
            json!({"id":ID,"release":{"app_templates":null}}),json!({"id":ID,"release":{"app_templates":{}}}),
            json!({"id":ID,"release":{"app_templates":[null]}}),json!({"id":ID,"release":{"app_templates":[{"can_setup":true}]}}),
            json!({"id":ID,"release":{"app_templates":[{"can_setup":true,"template_id":17}]}}),json!({"id":"other","release":{"app_templates":[]}}),json!({"plugin":body()})] {
            let fixture=Fixture::new(vec![(200,value)]);assert_eq!(ChatgptService::default().plugin_template_setup_with(request(),rpc,&fixture).await.err().unwrap().code,"invalid_response");
            assert_eq!(fixture.sent.lock().unwrap().len(),1);
        }
        let value=json!({"id":ID,"status":"DISABLED_BY_ADMIN","release":{"version":"different","app_templates":[{"can_setup":false},{"can_setup":null},{}]}});
        let fixture=Fixture::new(vec![(200,value)]);assert_eq!(ChatgptService::default().plugin_template_setup_with(request(),rpc,&fixture).await.unwrap().body["setupEligibleAppTemplateIds"],json!([]));
    }

    #[tokio::test]
    async fn plugin_template_setup_has_no_extra_version_or_personal_gate_and_no_renderer_path_overrides() {
        let mut value=body();value["status"]=json!("DISABLED_BY_ADMIN");value["release"]["version"]=json!("not-the-cli-version");
        let fixture=Fixture::new(vec![(200,value)]);assert_eq!(ChatgptService::default().plugin_template_setup_with(request(),rpc,&fixture).await.unwrap().body["setupEligibleAppTemplateIds"],json!(["first","second"]));
        for id in ["".into(),".".into(),"..".into(),"bad\nid".into(),"x".repeat(513)] {
            let fixture=Fixture::new(vec![]);let mut input=request();input.plugin_id=id;let calls=AtomicUsize::new(0);let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc(m,p)};
            assert_eq!(ChatgptService::default().plugin_template_setup_with(input,call,&fixture).await.err().unwrap().code,"invalid_request");assert_eq!(calls.load(Ordering::SeqCst),0);assert!(fixture.sent.lock().unwrap().is_empty());
        }
        let profile=json!({"language":"x","deviceId":"x","userAgent":"x","userAgentClientHints":"x","platformClientHint":"x"});
        for key in ["url","headers","version","canSetup","productSku","templateId"] {let mut value=json!({"requestId":"x","expectedIdentity":identity(),"profile":profile,"pluginId":ID});value[key]=json!(true);assert!(serde_json::from_value::<PluginTemplateSetupRequest>(value).is_err());}
        let mut input=request();input.plugin_id="notion@openai-curated-remote".into();
        let fixture=Fixture::new(vec![(200,json!({"id":input.plugin_id,"release":{"app_templates":[]}}))]);
        assert!(ChatgptService::default().plugin_template_setup_with(input,rpc,&fixture).await.is_ok());
        assert_eq!(fixture.sent.lock().unwrap()[0].url,"https://chatgpt.com/backend-api/ps/plugins/notion%40openai-curated-remote");
    }

    #[tokio::test]
    async fn plugin_template_setup_errors_do_not_turn_empty_or_retry_except_bounded_shared_401() {
        for (statuses,code) in [(vec![401,401],"unauthorized"),(vec![403],"forbidden"),(vec![404],"not_found"),(vec![429],"rate_limited"),(vec![500],"service_error")] {
            let fixture=Fixture::new(statuses.iter().map(|status|(*status,json!({}))).collect());let error=ChatgptService::default().plugin_template_setup_with(request(),rpc,&fixture).await.err().unwrap();
            assert_eq!(error.code,code);assert_eq!(error.status,statuses.last().copied());assert_eq!(fixture.sent.lock().unwrap().len(),statuses.len());
        }
        let fixture=Fixture::new(vec![(401,json!({})),(200,body())]);let refreshes=AtomicUsize::new(0);let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc(m,p)};
        assert!(ChatgptService::default().plugin_template_setup_with(request(),call,&fixture).await.is_ok());assert_eq!(refreshes.load(Ordering::SeqCst),1);
        let fixture=Fixture::new(vec![(401,json!({"error":{"type":"ip_not_authorized"}}))]);assert_eq!(ChatgptService::default().plugin_template_setup_with(request(),rpc,&fixture).await.err().unwrap().code,"ip_not_authorized");assert_eq!(fixture.sent.lock().unwrap().len(),1);
        let fixture=Fixture::new(vec![]);fixture.replies.lock().unwrap().push_back(Err(failure("network_error","fixture failed")));
        assert_eq!(ChatgptService::default().plugin_template_setup_with(request(),rpc,&fixture).await.err().unwrap().code,"network_error");assert_eq!(fixture.sent.lock().unwrap().len(),1);
    }

    #[tokio::test]
    async fn plugin_template_setup_cancel_account_aba_and_network_policy_block_stale_results() {
        for invalidate in [false,true] {
            let service=ChatgptService::default();let mut fixture=Fixture::new(vec![(200,body())]);fixture.pause=true;
            let read=service.plugin_template_setup_with(request(),rpc,&fixture);let change=async {while !fixture.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate{service.invalidate();service.invalidate();}else{service.cancel("template-fixture");}};
            assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate{"account_changed"}else{"cancelled"});assert!(service.active.lock().unwrap().is_empty());
        }
        let fixture=Fixture::new(vec![]);let denied=|m,p|if m=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{rpc(m,p)};
        assert_eq!(ChatgptService::default().plugin_template_setup_with(request(),denied,&fixture).await.err().unwrap().code,"network_restricted");assert!(fixture.sent.lock().unwrap().is_empty());
        let mut wrong=request();wrong.expected_identity.user_id="other-user".into();assert_eq!(ChatgptService::default().plugin_template_setup_with(wrong,rpc,&fixture).await.err().unwrap().code,"account_changed");assert!(fixture.sent.lock().unwrap().is_empty());
        let service=ChatgptService::default();service.cancel("template-fixture");assert_eq!(service.plugin_template_setup_with(request(),rpc,&fixture).await.err().unwrap().code,"cancelled");
        let service=ChatgptService::default();let guard=service.session.lock().await;let calls=AtomicUsize::new(0);
        let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc(m,p)};
        let read=service.plugin_template_setup_with(request(),call,&fixture);let cancel=async{tokio::task::yield_now().await;service.cancel("template-fixture");};
        assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,"cancelled");drop(guard);assert_eq!(calls.load(Ordering::SeqCst),0);
    }
}

impl ChatgptService {
    pub async fn plugin_template_setup_read<F,Fut>(&self,request:PluginTemplateSetupRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_template_setup_with(request,call,&CurlTransport).await
    }

    async fn plugin_template_setup_with<F,Fut,T>(&self,request:PluginTemplateSetupRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let route=format!("/backend-api/ps/plugins/{}",encode_segment(&request.plugin_id)?);
        let registration=self.register(&request.request_id)?;
        self.check_share_current(&request.expected_identity,&registration)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Plugin template eligibility read cancelled")),
            result=async {
                let mut session=self.session.lock().await;
                self.check_share_current(&request.expected_identity,&registration)?;
                self.prepare(&mut session,request.expected_identity.generation,&call,false).await?;
                for attempt in 0..2 {
                    self.check_share_current(&request.expected_identity,&registration)?;
                    let credentials=session.credentials.as_ref().unwrap();
                    if credentials.identity!=request.expected_identity {return Err(failure("account_changed","Plugin template eligibility account changed"));}
                    let integrity=session.integrity.clone();
                    let mut outgoing=build_http_request(&route,credentials,integrity.as_deref(),&request.profile)?;
                    outgoing.headers.insert("originator".into(),"Codex Desktop".into());
                    outgoing.headers.insert("OAI-Product-Sku".into(),"CODEX".into());
                    outgoing.headers.insert("X-Codex-Surface".into(),"other".into());
                    share_network_allowed(&call,&outgoing.url).await?;
                    self.check_share_current(&request.expected_identity,&registration)?;
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
                    self.check_share_current(&request.expected_identity,&registration)?;
                    apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {return Err(ServiceError {code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
                    if response.status==401 && attempt==0 {self.prepare(&mut session,request.expected_identity.generation,&call,true).await?;continue;}
                    let body=decode_response(response,registration.id.clone(),request.expected_identity.clone())?.body;
                    let ids=setup_template_ids(&body,&request.plugin_id)?;
                    return Ok(PluginPermissionsResponse {request_id:request.request_id.clone(),identity:request.expected_identity.clone(),
                        body:json!({"pluginId":request.plugin_id,"setupEligibleAppTemplateIds":ids})});
                }
                unreachable!()
            }=>result,
        };
        self.check_share_current(&request.expected_identity,&registration)?;
        result
    }
}
