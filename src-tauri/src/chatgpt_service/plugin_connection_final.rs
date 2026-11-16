//! CODEX installation's bounded final read. No OAuth or installation writes.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginConnectionFinalRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub requires_app_setup:Option<bool>,
    pub requested_connector_id:Option<String>,
}

struct FinalFailure {error:ServiceError,retry:bool,github_missing:bool}
impl From<ServiceError> for FinalFailure {
    fn from(error:ServiceError)->Self {
        // Only the native transport's explicit network classification maps to FetchError.network.
        let retry=error.code=="network_error" && error.status.is_none();
        Self {error,retry,github_missing:false}
    }
}
type FinalResult<T>=Result<T,FinalFailure>;

fn canonical(id:&str)->String {id.strip_prefix("asdk_app_").map(|id|format!("connector_{id}")).unwrap_or_else(||id.into())}
fn final_invalid()->ServiceError {failure("invalid_response","Connection verification response is incomplete or belongs to another app")}

fn http_retryable(response:&HttpResponse)->bool {
    if response.status!=408 && !(500..600).contains(&response.status) {return false;}
    if response.headers.get("cf-mitigated").is_some_and(|value|value=="challenge") {return true;}
    let body:Value=serde_json::from_slice(&response.body).unwrap_or(Value::Null);
    let explicit=body.get("retryable").and_then(Value::as_bool)
        .or_else(||body.get("detail").and_then(Value::as_object).and_then(|detail|detail.get("retryable")).and_then(Value::as_bool));
    explicit!=Some(false)
}

fn github_missing_link(body:&[u8])->bool {
    let Ok(body)=serde_json::from_slice::<Value>(body) else{return false;};
    let Some(detail)=body.get("detail").and_then(Value::as_object) else{return false;};
    if !detail.get("message").is_some_and(Value::is_string) {return false;}
    // LH8k union's second branch strips code/error_code before the third branch.
    if let Some(kind)=detail.get("type").and_then(Value::as_str) {
        if detail.get("field").is_none_or(Value::is_string) {return kind=="missing_github_connector_link";}
    }
    if ["type","code","error_code"].iter().any(|key|detail.get(*key).is_some_and(|value|!value.is_string())) {return false;}
    ["type","code","error_code"].iter().find_map(|key|detail.get(*key).and_then(Value::as_str))==Some("missing_github_connector_link")
}

fn connection_metadata<'a>(id:&str,body:&'a Value)->ServiceResult<&'a serde_json::Map<String,Value>> {
    let metadata=body.as_object().ok_or_else(final_invalid)?;
    let actual=metadata.get("id").and_then(Value::as_str).ok_or_else(final_invalid)?;
    if canonical(actual)!=canonical(id) || !metadata.get("name").is_some_and(Value::is_string) {return Err(final_invalid());}
    for key in ["description","status","template_id","service"] {
        if metadata.get(key).is_some_and(|value|!value.is_null() && !value.is_string()) {return Err(final_invalid());}
    }
    Ok(metadata)
}

fn connection_needs_auth(id:&str,body:&Value)->ServiceResult<bool> {
    let wrapper=body.as_object().ok_or_else(final_invalid)?;
    let Some(link)=wrapper.get("link").filter(|value|!value.is_null()) else{return Ok(true);};
    let link=link.as_object().ok_or_else(final_invalid)?;
    // The fixed-path producer may omit connector_id; validate ownership when present.
    if let Some(actual)=link.get("connector_id") {
        let actual=actual.as_str().ok_or_else(final_invalid)?;
        if canonical(actual)!=canonical(id) {return Err(final_invalid());}
    }
    match link.get("auth_status") {
        None|Some(Value::Null)=>Ok(false),Some(status)=>Ok(status.as_str()!=Some("ACTIVE")),
    }
}

impl ChatgptService {
    pub async fn plugin_connection_final_read<F,Fut>(&self,request:PluginConnectionFinalRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_connection_final_with(request,call,&CurlTransport).await
    }

    async fn plugin_connection_final_with<F,Fut,T>(&self,request:PluginConnectionFinalRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        if let Some(id)=&request.requested_connector_id {encode_segment(id)?;}
        let registration=self.register(&request.request_id)?;
        self.check_share_current(&request.expected_identity,&registration)?;
        let outcome=async {
            let Some(id)=request.requested_connector_id.as_deref().filter(|_|request.requires_app_setup==Some(true)) else{return Ok(json!({"kind":"ready"}));};
            let path=format!("/backend-api/aip/connectors/{}",encode_segment(id)?);
            let metadata=self.connection_final_http(&path,true,&request,&registration,&call,transport);
            let link=async {
                let link_path=format!("{path}/link");
                match self.connection_final_http(&link_path,true,&request,&registration,&call,transport).await {
                    Err(error) if error.retry=>{
                        self.check_share_current(&request.expected_identity,&registration).map_err(FinalFailure::from)?;
                        tokio::select! {
                            _=cancelled(&registration.cancelled)=>return Err(FinalFailure::from(failure("cancelled","Connection verification cancelled"))),
                            _=tokio::time::sleep(Duration::from_millis(250))=>{},
                        }
                        self.check_share_current(&request.expected_identity,&registration).map_err(FinalFailure::from)?;
                        self.connection_final_http(&link_path,true,&request,&registration,&call,transport).await
                    },other=>other,
                }
            };
            let (metadata,link)=tokio::try_join!(metadata,link)?;
            let metadata=connection_metadata(id,&metadata).map_err(FinalFailure::from)?;
            if metadata.get("status").and_then(Value::as_str)==Some("DISABLED_BY_ADMIN") {return Ok(json!({"kind":"unavailable"}));}
            let needs_auth=||json!({"kind":"needsAuth","app":{"id":id,"name":metadata["name"],"description":metadata.get("description").unwrap_or(&Value::Null),"category":null,"installUrl":null}});
            if connection_needs_auth(id,&link).map_err(FinalFailure::from)? {return Ok(needs_auth());}
            if id=="connector_76869538009648d5b282a4bb21c3d157" || metadata.get("template_id").and_then(Value::as_str)==Some("templated_apps_GitHubEnterprise") || metadata.get("service").and_then(Value::as_str)==Some("github") {
                let mut url=tauri::Url::parse("https://chatgpt.com/backend-api/wham/github/list-repositories").unwrap();
                url.query_pairs_mut().append_pair("connector_id",id).append_pair("page","1").append_pair("per_page","1");
                let route=format!("{}?{}",url.path(),url.query().unwrap());
                if let Err(error)=self.connection_final_http(&route,false,&request,&registration,&call,transport).await {
                    if error.github_missing {return Ok(needs_auth());}return Err(error);
                }
            }
            Ok(json!({"kind":"ready"}))
        };
        let result:FinalResult<Value>=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(FinalFailure::from(failure("cancelled","Connection verification cancelled"))),
            result=outcome=>result,
        };
        self.check_share_current(&request.expected_identity,&registration)?;
        let result=match result {Ok(value)=>value,Err(error) if matches!(error.error.code,"account_changed"|"cancelled")=>return Err(error.error),Err(_)=>json!({"kind":"unavailable"})};
        Ok(PluginPermissionsResponse {request_id:request.request_id,identity:request.expected_identity,body:json!({"requestedConnectorId":request.requested_connector_id,"result":result})})
    }

    async fn connection_final_http<F,Fut,T>(&self,route:&str,setup:bool,request:&PluginConnectionFinalRequest,registration:&Registration<'_>,call:&F,transport:&T)->FinalResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        for attempt in 0..2 {
            let (outgoing,integrity)={
                let mut session=self.session.lock().await;
                self.check_share_current(&request.expected_identity,registration)?;
                self.prepare(&mut session,request.expected_identity.generation,call,false).await?;
                let credentials=session.credentials.as_ref().unwrap();
                if credentials.identity!=request.expected_identity {return Err(failure("account_changed","Connection verification identity changed").into());}
                let mut outgoing=build_http_request(route,credentials,session.integrity.as_deref(),&request.profile)?;
                outgoing.headers.insert("originator".into(),"Codex Desktop".into());
                if setup {outgoing.headers.insert("OAI-Product-Sku".into(),"CODEX".into());outgoing.headers.insert("X-Codex-Surface".into(),"connector_setup".into());}
                (outgoing,session.integrity.clone())
            };
            share_network_allowed(call,&outgoing.url).await?;
            self.check_share_current(&request.expected_identity,registration)?;
            let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
            self.check_share_current(&request.expected_identity,registration)?;
            let mut session=self.session.lock().await;
            self.check_share_current(&request.expected_identity,registration)?;
            apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response) {return Err(ServiceError {code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)}.into());}
            if response.status==401 && attempt==0 {self.prepare(&mut session,request.expected_identity.generation,call,true).await?;continue;}
            let retry=http_retryable(&response);
            let missing=response.headers.get("cf-mitigated").is_none_or(|value|value!="challenge") && github_missing_link(&response.body);
            return decode_response(response,registration.id.clone(),request.expected_identity.clone()).map(|response|response.body)
                .map_err(|error|FinalFailure {error,retry,github_missing:missing});
        }
        unreachable!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    const ID:&str="asdk_app_final";
    fn identity()->ServiceIdentity {ServiceIdentity {account_id:"final-account".into(),user_id:"final-user".into(),generation:0}}
    fn request()->PluginConnectionFinalRequest {PluginConnectionFinalRequest {request_id:"final-fixture".into(),expected_identity:identity(),requires_app_setup:Some(true),requested_connector_id:Some(ID.into()),profile:ServiceProfile {
        language:"zh-CN".into(),device_id:"final-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"Chromium".into(),platform_client_hint:"Windows".into(),
    }}}
    fn rpc(method:&'static str,_:Value)->std::future::Ready<Result<Value,String>> {
        std::future::ready(Ok(match method {
            "getAuthStatus"=>{
                let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"final-account","user_id":"final-user"}});
                json!({"authMethod":"chatgpt","authToken":format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))})
            },
            "account/read"=>json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"final-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
            "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected fixture RPC"),
        }))
    }
    fn metadata()->Value {json!({"id":"connector_final","name":"Final app","description":"真实描述","private_extra":"never-return"})}
    fn link(status:Value)->Value {json!({"link":{"connector_id":"connector_final","auth_status":status,"auth_type":"API_KEY","private_token":"never-return"}})}
    fn response(status:u16,body:Value)->ServiceResult<HttpResponse> {Ok(HttpResponse {status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})}
    struct Fixture {metadata:Mutex<VecDeque<ServiceResult<HttpResponse>>>,link:Mutex<VecDeque<ServiceResult<HttpResponse>>>,github:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>,link_failed:AtomicBool}
    impl Fixture {
        fn new(metadata:Value,link:Value)->Self {Self {metadata:Mutex::new(VecDeque::from([response(200,metadata)])),link:Mutex::new(VecDeque::from([response(200,link)])),github:Mutex::new(VecDeque::from([response(200,json!({}))])),sent:Mutex::new(Vec::new()),link_failed:AtomicBool::new(false)}}
        fn link_attempts(&self)->usize {self.sent.lock().unwrap().iter().filter(|request|request.url.ends_with("/link")).count()}
    }
    impl Transport for Fixture {
        fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> {Box::pin(async move {
            let is_link=request.url.ends_with("/link");let github=request.url.contains("/wham/github/");self.sent.lock().unwrap().push(request);
            let result=if is_link {self.link.lock().unwrap().pop_front()}else if github {self.github.lock().unwrap().pop_front()}else{self.metadata.lock().unwrap().pop_front()}.expect("unexpected final verification request");
            if is_link && match &result {Err(_)=>true,Ok(response)=>response.status>=400} {self.link_failed.store(true,Ordering::SeqCst);}
            result
        })}
    }
    fn kind(result:&PluginPermissionsResponse)->&str {result.body["result"]["kind"].as_str().unwrap()}

    #[tokio::test]
    async fn plugin_connection_final_without_original_setup_or_target_is_ready_with_zero_http_and_auth() {
        for (setup,id) in [(None,Some(ID.into())),(Some(false),Some(ID.into())),(Some(true),None)] {
            let fixture=Fixture::new(metadata(),link(Value::Null));let mut request=request();request.requires_app_setup=setup;request.requested_connector_id=id;
            let calls=AtomicUsize::new(0);let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc(m,p)};
            assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request,call,&fixture).await.unwrap()),"ready");
            assert_eq!(calls.load(Ordering::SeqCst),0);assert!(fixture.sent.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn plugin_connection_final_fixed_codex_setup_preserves_raw_target_and_null_auth_is_ready() {
        for status in [Value::Null,json!("ACTIVE")] {
            let fixture=Fixture::new(metadata(),link(status));let result=ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap();
            assert_eq!(kind(&result),"ready");assert_eq!(result.body["requestedConnectorId"],ID);assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
            let sent=fixture.sent.lock().unwrap();assert_eq!(sent.len(),2);
            for request in &*sent {assert_eq!(request.method,HttpMethod::Get);assert!(request.body.is_empty());assert_eq!(request.headers["OAI-Product-Sku"],"CODEX");assert_eq!(request.headers["X-Codex-Surface"],"connector_setup");assert_eq!(request.headers["ChatGPT-Account-Id"],"final-account");assert_eq!(request.headers["originator"],"Codex Desktop");}
            assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_final");assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_final/link");
        }
        let fixture=Fixture::new(metadata(),json!({"link":{"connector_id":"connector_final"}}));
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"ready");
    }

    #[tokio::test]
    async fn plugin_connection_final_fixed_path_link_without_connector_id_uses_auth_status() {
        for value in [json!({"link":{"auth_status":null}}),json!({"link":{}})] {
            let fixture=Fixture::new(metadata(),value);
            assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"ready");
        }
        for value in [json!({"link":{"connector_id":null}}),json!({"link":{"connector_id":17}}),json!({"link":{"connector_id":"foreign"}})] {
            let fixture=Fixture::new(metadata(),value);
            assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");
        }
    }

    #[tokio::test]
    async fn plugin_connection_final_metadata_and_link_have_real_parallel_http_without_session_lock() {
        struct Parallel {barrier:tokio::sync::Barrier,entered:AtomicUsize}
        impl Transport for Parallel {fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
            self.entered.fetch_add(1,Ordering::SeqCst);self.barrier.wait().await;
            response(200,if request.url.ends_with("/link"){link(Value::Null)}else{metadata()})
        })}}
        let fixture=Parallel {barrier:tokio::sync::Barrier::new(2),entered:AtomicUsize::new(0)};
        let result=tokio::time::timeout(Duration::from_secs(2),ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture)).await.expect("metadata/link HTTP was serialized").unwrap();
        assert_eq!(kind(&result),"ready");assert_eq!(fixture.entered.load(Ordering::SeqCst),2);
    }

    #[tokio::test]
    async fn plugin_connection_final_missing_reauth_admin_and_wrong_app_are_not_ready() {
        for value in [json!({}),json!({"link":null}),link(json!("REAUTH_REQUIRED")),link(json!("EXPIRED")),link(json!(17))] {
            let fixture=Fixture::new(metadata(),value);let result=ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap();
            assert_eq!(kind(&result),"needsAuth");assert_eq!(result.body["result"]["app"],json!({"id":ID,"name":"Final app","description":"真实描述","category":null,"installUrl":null}));
        }
        let mut admin=metadata();admin["status"]=json!("DISABLED_BY_ADMIN");let fixture=Fixture::new(admin,link(Value::Null));
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");
        for (metadata,link) in [(json!({"id":"other","name":"Other"}),link(Value::Null)),(metadata(),json!({"link":{"connector_id":"other","auth_status":"ACTIVE"}})),(metadata(),json!({"link":[]}))] {
            let fixture=Fixture::new(metadata,link);assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");
        }
    }

    #[test]
    fn plugin_connection_final_github_detail_union_and_retryable_producer_keep_original_priority() {
        for body in [json!({"detail":{"type":"missing_github_connector_link","message":"x","code":17}}),
            json!({"detail":{"code":"missing_github_connector_link","message":"x"}}),json!({"detail":{"error_code":"missing_github_connector_link","message":"x"}}),
            json!({"detail":{"type":"missing_github_connector_link","message":"x","field":17}})] {assert!(github_missing_link(&serde_json::to_vec(&body).unwrap()));}
        for body in [json!({"error_code":"missing_github_connector_link"}),json!({"detail":"missing_github_connector_link"}),json!({"detail":{"code":"missing_github_connector_link"}}),
            json!({"detail":{"type":"other","code":"missing_github_connector_link","message":"x"}}),json!({"detail":{"type":null,"code":"missing_github_connector_link","message":"x"}}),
            json!({"detail":{"type":"missing_github_connector_link","message":null}})] {assert!(!github_missing_link(&serde_json::to_vec(&body).unwrap()));}
        assert!(!github_missing_link(b"not JSON"));
        for (body,expected) in [(json!({}),true),(json!({"retryable":false}),false),(json!({"detail":{"retryable":false}}),false),
            (json!({"retryable":false,"detail":{"retryable":true}}),false),(json!({"retryable":true,"detail":{"retryable":false}}),true),
            (json!({"retryable":"invalid","detail":{"retryable":false}}),false)] {assert_eq!(http_retryable(&response(500,body).unwrap()),expected);}
    }

    #[tokio::test]
    async fn plugin_connection_final_all_exact_github_branches_use_repository_get_and_raw_detail_only() {
        for branch in ["id","template","service"] {
            let mut input=request();let mut meta=metadata();
            match branch {"id"=>{input.requested_connector_id=Some("connector_76869538009648d5b282a4bb21c3d157".into());meta["id"]=json!(input.requested_connector_id);},"template"=>meta["template_id"]=json!("templated_apps_GitHubEnterprise"),_=>meta["service"]=json!("github")}
            let id=input.requested_connector_id.clone().unwrap();let linked=json!({"link":{"connector_id":id,"auth_status":"ACTIVE"}});
            let fixture=Fixture::new(meta.clone(),linked.clone());let result=ChatgptService::default().plugin_connection_final_with(input,rpc,&fixture).await.unwrap();assert_eq!(kind(&result),"ready");
            let sent=fixture.sent.lock().unwrap();assert_eq!(sent.len(),3);let github=&sent[2];assert!(!github.headers.contains_key("X-Codex-Surface"));assert!(!github.headers.contains_key("OAI-Product-Sku"));assert_eq!(github.headers["originator"],"Codex Desktop");
            let url=tauri::Url::parse(&github.url).unwrap();assert_eq!(url.path(),"/backend-api/wham/github/list-repositories");assert_eq!(url.query_pairs().collect::<BTreeMap<_,_>>()["connector_id"],id);drop(sent);
            for (body,expected) in [(json!({"detail":{"code":"missing_github_connector_link","message":"x"}}),"needsAuth"),(json!({"code":"missing_github_connector_link"}),"unavailable"),(json!({}),"unavailable")] {
                let fixture=Fixture::new(meta.clone(),linked.clone());*fixture.github.lock().unwrap()=VecDeque::from([response(404,body)]);
                let mut request=request();request.requested_connector_id=Some(id.clone());assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request,rpc,&fixture).await.unwrap()),expected);
            }
        }
        let mut meta=metadata();meta["name"]=json!("GitHub");let fixture=Fixture::new(meta,link(Value::Null));
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"ready");assert_eq!(fixture.sent.lock().unwrap().len(),2);
    }

    #[tokio::test]
    async fn plugin_connection_final_only_link_retries_once_for_network_408_5xx_and_respects_false() {
        for failure in [Err(failure("network_error","fixture network")),response(408,json!({})),response(503,json!({}))] {
            let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.link.lock().unwrap()=VecDeque::from([failure,response(200,link(Value::Null))]);
            let started=std::time::Instant::now();assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"ready");
            assert!(started.elapsed()>=Duration::from_millis(250));assert_eq!(fixture.link_attempts(),2);
        }
        for failure in [response(403,json!({})),response(404,json!({})),response(500,json!({"retryable":false})),Err(failure("transport_error","local failure")),Err(failure("timeout","native deadline"))] {
            let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.link.lock().unwrap()=VecDeque::from([failure]);
            assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");assert_eq!(fixture.link_attempts(),1);
        }
        let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.link.lock().unwrap()=VecDeque::from([response(503,json!({})),response(503,json!({}))]);
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");assert_eq!(fixture.link_attempts(),2);
        let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.metadata.lock().unwrap()=VecDeque::from([response(503,json!({}))]);
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");assert_eq!(fixture.sent.lock().unwrap().iter().filter(|request|!request.url.ends_with("/link")).count(),1);
    }

    #[tokio::test]
    async fn plugin_connection_final_policy_revocation_during_retry_and_401_or_github_failure_are_not_extra_retried() {
        let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.link.lock().unwrap()=VecDeque::from([response(503,json!({}))]);
        let policies=AtomicUsize::new(0);let call=|m,p|if m=="configRequirements/read" {
            let denied=json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}});
            std::future::ready(Ok(if policies.fetch_add(1,Ordering::SeqCst)>=2 {denied}else{json!({"requirements":null})}))
        }else{rpc(m,p)};
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),call,&fixture).await.unwrap()),"unavailable");
        assert_eq!(policies.load(Ordering::SeqCst),3);assert_eq!(fixture.link_attempts(),1);
        let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.link.lock().unwrap()=VecDeque::from([response(401,json!({})),response(401,json!({}))]);
        let refreshes=AtomicUsize::new(0);let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc(m,p)};
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),call,&fixture).await.unwrap()),"unavailable");
        assert_eq!(refreshes.load(Ordering::SeqCst),1);assert_eq!(fixture.link_attempts(),2);
        let mut meta=metadata();meta["service"]=json!("github");let fixture=Fixture::new(meta,link(Value::Null));*fixture.github.lock().unwrap()=VecDeque::from([response(503,json!({}))]);
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),rpc,&fixture).await.unwrap()),"unavailable");
        assert_eq!(fixture.sent.lock().unwrap().iter().filter(|request|request.url.contains("/wham/github/")).count(),1);
    }

    #[tokio::test]
    async fn plugin_connection_final_cancel_aba_policy_and_invalid_dto_cannot_publish_late_ready() {
        for invalidate in [false,true] {
            let service=ChatgptService::default();let fixture=Fixture::new(metadata(),link(Value::Null));*fixture.link.lock().unwrap()=VecDeque::from([response(503,json!({}))]);
            let read=service.plugin_connection_final_with(request(),rpc,&fixture);let change=async {while !fixture.link_failed.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate {service.invalidate();service.invalidate();}else{service.cancel("final-fixture");}};
            assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate{"account_changed"}else{"cancelled"});assert_eq!(fixture.link_attempts(),1);
        }
        let fixture=Fixture::new(metadata(),link(Value::Null));let denied=|m,p|if m=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{rpc(m,p)};
        assert_eq!(kind(&ChatgptService::default().plugin_connection_final_with(request(),denied,&fixture).await.unwrap()),"unavailable");assert!(fixture.sent.lock().unwrap().is_empty());
        let service=ChatgptService::default();service.cancel("final-fixture");assert_eq!(service.plugin_connection_final_with(request(),rpc,&fixture).await.err().unwrap().code,"cancelled");
        let mut wrong=request();wrong.expected_identity.user_id="other-user".into();assert_eq!(ChatgptService::default().plugin_connection_final_with(wrong,rpc,&fixture).await.err().unwrap().code,"account_changed");assert!(fixture.sent.lock().unwrap().is_empty());
        let profile=json!({"language":"x","deviceId":"x","userAgent":"x","userAgentClientHints":"x","platformClientHint":"x"});
        for key in ["url","headers","productSku","productContext","method"] {let mut value=json!({"requestId":"x","expectedIdentity":identity(),"profile":profile,"requiresAppSetup":true,"requestedConnectorId":ID});value[key]=json!(true);assert!(serde_json::from_value::<PluginConnectionFinalRequest>(value).is_err());}
    }
}
