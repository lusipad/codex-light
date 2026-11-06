//! Fixed cloud archive mutations. HTTP acceptance is not independent readback.
use super::*;

#[derive(Clone,Copy,Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum ArchiveUnarchiveSource {CloudTask,ChatgptConversation}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ArchiveUnarchiveRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub source:ArchiveUnarchiveSource,
    pub target_id:String,
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ArchiveUnarchiveResponse {
    pub request_id:String,
    pub identity:ServiceIdentity,
    pub status:&'static str,
}

fn unarchive_route(source:ArchiveUnarchiveSource,id:&str) -> ServiceResult<(HttpMethod,String,Vec<u8>)> {
    if id.trim().is_empty() || id.len()>2048 || matches!(id,"."|"..") || id.chars().any(char::is_control) {
        return Err(failure("invalid_request","Invalid archive target identifier"));
    }
    // Encode exactly one opaque path segment, including %, slash, dot, query and fragment.
    let id=id.bytes().map(|byte|if byte.is_ascii_alphanumeric() || b"-_~".contains(&byte) {
        (byte as char).to_string()
    }else{format!("%{byte:02X}")}).collect::<String>();
    Ok(match source {
        ArchiveUnarchiveSource::CloudTask=>(HttpMethod::Post,format!("/backend-api/wham/tasks/{id}/recover"),Vec::new()),
        ArchiveUnarchiveSource::ChatgptConversation=>(HttpMethod::Patch,format!("/backend-api/conversation/{id}"),br#"{"is_archived":false}"#.to_vec()),
    })
}

fn unarchive_auth(auth:&Value) -> ServiceResult<()> {
    match auth.get("authMethod") {
        Some(Value::String(method)) if method=="chatgpt"=>Ok(()),
        Some(Value::Null)|Some(Value::String(_))=>Err(failure("not_logged_in","ChatGPT authentication required to unarchive")),
        _=>Err(failure("auth_unavailable","ChatGPT authentication status unavailable")),
    }
}

fn unarchive_outcome(error:ServiceError,sent:bool) -> ServiceError {
    if !sent || error.status.is_some_and(|status|(400..500).contains(&status) && status!=408) {return error;}
    ServiceError {code:"archive_write_unknown",message:"Unarchive outcome is unknown; refresh the original account before retrying",status:error.status}
}

impl ChatgptService {
    pub async fn archive_unarchive<F,Fut>(&self,request:ArchiveUnarchiveRequest,call:F) -> ServiceResult<ArchiveUnarchiveResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.archive_unarchive_with(request,call,&CurlTransport).await
    }

    async fn archive_unarchive_with<F,Fut,T>(&self,request:ArchiveUnarchiveRequest,call:F,transport:&T) -> ServiceResult<ArchiveUnarchiveResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let (method,route,body)=unarchive_route(request.source,&request.target_id)?;
        let registration=self.register(&request.request_id)?;
        let identity=&request.expected_identity;
        self.check_share_current(identity,&registration)?;
        let sent=AtomicBool::new(false);
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Unarchive request cancelled")),
            result=async {
                let mut session=self.session.lock().await;
                self.check_share_current(identity,&registration)?;
                let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await
                    .map_err(|_|failure("auth_unavailable","ChatGPT authentication status unavailable"))?;
                unarchive_auth(&auth)?;
                self.check_share_current(identity,&registration)?;
                self.prepare(&mut session,identity.generation,&call,false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity,&registration)?;
                    let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await
                        .map_err(|_|failure("auth_unavailable","ChatGPT authentication status unavailable"))?;
                    unarchive_auth(&auth)?;
                    self.check_share_current(identity,&registration)?;
                    let credentials=session.credentials.as_ref().unwrap();
                    if &credentials.identity!=identity {return Err(failure("account_changed","Unarchive authenticated identity changed"));}
                    let integrity=session.integrity.clone();
                    let mut outgoing=build_http_request(&route,credentials,integrity.as_deref(),&request.profile)?;
                    outgoing.method=method;outgoing.body=body.clone();
                    if method==HttpMethod::Patch {outgoing.headers.insert("Content-Type".into(),"application/json".into());}
                    share_network_allowed(&call,&outgoing.url).await?;
                    self.check_share_current(identity,&registration)?;
                    sent.store(true,Ordering::SeqCst);
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
                    self.check_share_current(identity,&registration)?;
                    apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {
                        return Err(ServiceError {code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});
                    }
                    // Both proven mutations permit one principal-bound authentication replay.
                    if response.status==401 && attempt==0 {self.prepare(&mut session,identity.generation,&call,true).await?;continue;}
                    if (200..300).contains(&response.status) {
                        // hn/i2i consume no mutation response fields, including an empty 204.
                        return Ok(ArchiveUnarchiveResponse {request_id:request.request_id.clone(),identity:identity.clone(),status:"accepted"});
                    }
                    return Err(decode_response(response,registration.id.clone(),identity.clone()).err()
                        .unwrap_or_else(||failure("archive_write_unknown","Unarchive response was not accepted")));
                }
                unreachable!()
            }=>result,
        };
        let current=self.check_share_current(identity,&registration);
        let result=current.and(result);
        result.map_err(|error|unarchive_outcome(error,sent.load(Ordering::SeqCst)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn identity()->ServiceIdentity {
        ServiceIdentity {account_id:"unarchive-account".into(),user_id:"unarchive-user".into(),generation:0}
    }
    fn request(source:ArchiveUnarchiveSource)->ArchiveUnarchiveRequest {
        ArchiveUnarchiveRequest {request_id:"unarchive-fixture".into(),expected_identity:identity(),source,target_id:"same-id".into(),profile:ServiceProfile {
            language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into(),
        }}
    }
    fn auth(account:&str)->Value {
        let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":account,"user_id":"unarchive-user","chatgpt_account_is_fedramp":false}});
        let token=format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
        json!({"authMethod":"chatgpt","authToken":token})
    }
    fn rpc(method:&'static str,_:Value)->std::future::Ready<Result<Value,String>> {
        std::future::ready(match method {
            "getAuthStatus"=>Ok(auth("unarchive-account")),
            "account/read"=>Ok(json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com",
                "chatgptAccountId":"unarchive-account","accountRoutingOverride":"NO_CONSTRAINT"}})),
            "configRequirements/read"=>Ok(json!({"requirements":null})),_=>Err("unexpected fixture RPC".into()),
        })
    }
    fn sources()->[ArchiveUnarchiveSource;2] {[ArchiveUnarchiveSource::CloudTask,ArchiveUnarchiveSource::ChatgptConversation]}

    struct FixtureTransport {
        replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>,pause_at:usize,entered:AtomicBool,
    }
    impl FixtureTransport {
        fn new(statuses:&[u16])->Self {
            Self {replies:Mutex::new(statuses.iter().map(|status|Ok(HttpResponse {status:*status,headers:BTreeMap::new(),body:Vec::new()})).collect()),
                sent:Mutex::new(Vec::new()),pause_at:usize::MAX,entered:AtomicBool::new(false)}
        }
    }
    impl Transport for FixtureTransport {
        fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> {
            Box::pin(async move {
                let index={let mut sent=self.sent.lock().unwrap();sent.push(request);sent.len()-1};
                if index==self.pause_at {
                    self.entered.store(true,Ordering::SeqCst);
                    tokio::select! {_=cancelled(&cancel)=>return Err(failure("cancelled","fixture cancelled")),_=tokio::time::sleep(Duration::from_millis(150))=>{}}
                }
                self.replies.lock().unwrap().pop_front().expect("unexpected write/replay/readback")
            })
        }
    }

    #[tokio::test]
    async fn archive_unarchive_fixed_source_methods_body_and_opaque_target_encoding() {
        for source in sources() {
            let transport=FixtureTransport::new(&[204]);let mut request=request(source);request.target_id="../opaque /中?x#%".into();
            let result=ChatgptService::default().archive_unarchive_with(request,rpc,&transport).await.unwrap();
            assert_eq!(result.status,"accepted");assert_eq!(result.identity,identity());
            let public=serde_json::to_value(result).unwrap();assert_eq!(public.as_object().unwrap().len(),3);
            assert!(public.get("body").is_none());assert!(!serde_json::to_string(&public).unwrap().contains(auth("unarchive-account")["authToken"].as_str().unwrap()));
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);
            let encoded="%2E%2E%2Fopaque%20%2F%E4%B8%AD%3Fx%23%25";
            let expected=match source {ArchiveUnarchiveSource::CloudTask=>format!("https://chatgpt.com/backend-api/wham/tasks/{encoded}/recover"),
                ArchiveUnarchiveSource::ChatgptConversation=>format!("https://chatgpt.com/backend-api/conversation/{encoded}")};
            assert_eq!(sent[0].url,expected);assert_eq!(sent[0].headers["ChatGPT-Account-Id"],"unarchive-account");
            assert_eq!(sent[0].headers["OAI-Language"],"zh-CN");assert_eq!(sent[0].headers["oai-did"],"fixture-device");
            match source {
                ArchiveUnarchiveSource::CloudTask=>{assert_eq!(sent[0].method,HttpMethod::Post);assert!(sent[0].body.is_empty());assert!(!sent[0].headers.contains_key("Content-Type"));},
                ArchiveUnarchiveSource::ChatgptConversation=>{assert_eq!(sent[0].method,HttpMethod::Patch);assert_eq!(serde_json::from_slice::<Value>(&sent[0].body).unwrap(),json!({"is_archived":false}));assert_eq!(sent[0].headers["Content-Type"],"application/json");},
            }
        }
    }

    #[tokio::test]
    async fn archive_unarchive_invalid_source_extra_fields_and_ids_cannot_authenticate_or_send() {
        for id in ["".into(),"   ".into(),".".into(),"..".into(),"line\nbreak".into(),"x".repeat(2049),"中".repeat(683)] {
            let transport=FixtureTransport::new(&[]);let mut request=request(ArchiveUnarchiveSource::CloudTask);request.target_id=id;
            let calls=AtomicUsize::new(0);let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_unarchive_with(request,call,&transport).await.err().unwrap().code,"invalid_request");
            assert_eq!(calls.load(Ordering::SeqCst),0);assert!(transport.sent.lock().unwrap().is_empty());
        }
        assert!(unarchive_route(ArchiveUnarchiveSource::CloudTask,&"x".repeat(2048)).is_ok());
        assert!(unarchive_route(ArchiveUnarchiveSource::CloudTask,&"中".repeat(682)).is_ok());
        let profile=json!({"language":"x","deviceId":"x","userAgent":"x","userAgentClientHints":"x","platformClientHint":"x"});
        let base=json!({"requestId":"x","expectedIdentity":identity(),"profile":profile,"source":"cloud-task","targetId":"id"});
        for source in [json!("local"),json!("chatgpt"),json!(17),Value::Null] {
            let mut value=base.clone();value["source"]=source;assert!(serde_json::from_value::<ArchiveUnarchiveRequest>(value).is_err());
        }
        for key in ["url","method","body","includeWorkCloud","accountId"] {
            let mut value=base.clone();value[key]=json!(true);assert!(serde_json::from_value::<ArchiveUnarchiveRequest>(value).is_err());
        }
    }

    #[tokio::test]
    async fn archive_unarchive_accepts_any_2xx_body_without_fake_readback_or_extra_get() {
        for source in sources() {for status in [200,201,204,299] {for body in [Vec::new(),b"non-json accepted".to_vec(),br#"{"private":"do-not-return"}"#.to_vec()] {
            let transport=FixtureTransport::new(&[]);transport.replies.lock().unwrap().push_back(Ok(HttpResponse {status,headers:BTreeMap::new(),body}));
            let result=ChatgptService::default().archive_unarchive_with(request(source),rpc,&transport).await.unwrap();
            assert_eq!(result.status,"accepted");assert!(!serde_json::to_string(&result).unwrap().contains("do-not-return"));
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);assert_ne!(sent[0].method,HttpMethod::Get);
        }}}
    }

    #[tokio::test]
    async fn archive_unarchive_only_explicit_401_replays_once_with_identical_method_target_and_body() {
        for source in sources() {
            let transport=FixtureTransport::new(&[401,204]);let refreshes=AtomicUsize::new(0);
            let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_unarchive_with(request(source),call,&transport).await.unwrap().status,"accepted");
            assert_eq!(refreshes.load(Ordering::SeqCst),1);
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);assert_eq!(sent[0].method,sent[1].method);assert_eq!(sent[0].body,sent[1].body);assert_eq!(sent[0].url,sent[1].url);drop(sent);
            let transport=FixtureTransport::new(&[401,401]);
            let error=ChatgptService::default().archive_unarchive_with(request(source),rpc,&transport).await.err().unwrap();
            assert_eq!(error.code,"unauthorized");assert_eq!(error.status,Some(401));assert_eq!(transport.sent.lock().unwrap().len(),2);
        }
    }

    #[tokio::test]
    async fn archive_unarchive_ip_and_definite_http_refusals_do_not_become_success_or_replay() {
        for source in sources() {
            for (status,code) in [(403,"forbidden"),(404,"not_found"),(429,"rate_limited"),(408,"archive_write_unknown"),(500,"archive_write_unknown"),(503,"archive_write_unknown")] {
                let transport=FixtureTransport::new(&[status]);
                let error=ChatgptService::default().archive_unarchive_with(request(source),rpc,&transport).await.err().unwrap();
                assert_eq!(error.code,code);assert_eq!(error.status,Some(status));assert_eq!(transport.sent.lock().unwrap().len(),1);
            }
            for code in ["ip_not_authorized","validate_whitelist_failed","workspace_ip_not_authorized"] {
                let transport=FixtureTransport::new(&[]);transport.replies.lock().unwrap().push_back(Ok(HttpResponse {status:401,headers:BTreeMap::new(),body:serde_json::to_vec(&json!({"error":{"code":code}})).unwrap()}));
                let refreshes=AtomicUsize::new(0);let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc(m,p)};
                assert_eq!(ChatgptService::default().archive_unarchive_with(request(source),call,&transport).await.err().unwrap().code,"ip_not_authorized");
                assert_eq!(refreshes.load(Ordering::SeqCst),0);assert_eq!(transport.sent.lock().unwrap().len(),1);
            }
        }
    }

    #[tokio::test]
    async fn archive_unarchive_auth_policy_and_identity_before_send_leave_zero_writes() {
        for method in ["apiKey","chatgptAuthTokens","bedrock"] {
            let transport=FixtureTransport::new(&[]);let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(json!({"authMethod":method})))}else{rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_unarchive_with(request(ArchiveUnarchiveSource::CloudTask),call,&transport).await.err().unwrap().code,"not_logged_in");
            assert!(transport.sent.lock().unwrap().is_empty());
        }
        let transport=FixtureTransport::new(&[]);
        let denied=|m,p|if m=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{rpc(m,p)};
        assert_eq!(ChatgptService::default().archive_unarchive_with(request(ArchiveUnarchiveSource::CloudTask),denied,&transport).await.err().unwrap().code,"network_restricted");
        let mut wrong=request(ArchiveUnarchiveSource::ChatgptConversation);wrong.expected_identity.user_id="other-user".into();
        assert_eq!(ChatgptService::default().archive_unarchive_with(wrong,rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.sent.lock().unwrap().is_empty());
        let service=ChatgptService::default();service.cancel("unarchive-fixture");
        assert_eq!(service.archive_unarchive_with(request(ArchiveUnarchiveSource::CloudTask),rpc,&transport).await.err().unwrap().code,"cancelled");
        let service=ChatgptService::default();let guard=service.session.lock().await;let calls=AtomicUsize::new(0);
        let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc(m,p)};
        let write=service.archive_unarchive_with(request(ArchiveUnarchiveSource::CloudTask),call,&transport);
        let cancel=async{tokio::task::yield_now().await;service.cancel("unarchive-fixture");};
        assert_eq!(tokio::join!(write,cancel).0.err().unwrap().code,"cancelled");drop(guard);
        assert_eq!(calls.load(Ordering::SeqCst),0);assert!(transport.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn archive_unarchive_sent_network_timeout_cancel_and_generation_changes_are_unknown() {
        for source in sources() {
            for code in ["network_error","timeout"] {
                let transport=FixtureTransport::new(&[]);transport.replies.lock().unwrap().push_back(Err(failure(code,"fixture send failed")));
                assert_eq!(ChatgptService::default().archive_unarchive_with(request(source),rpc,&transport).await.err().unwrap().code,"archive_write_unknown");
                assert_eq!(transport.sent.lock().unwrap().len(),1);
            }
            for invalidate in [false,true] {
                let service=ChatgptService::default();let mut transport=FixtureTransport::new(&[204]);transport.pause_at=0;
                let write=service.archive_unarchive_with(request(source),rpc,&transport);
                let change=async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate{service.invalidate();service.invalidate();}else{service.cancel("unarchive-fixture");}};
                assert_eq!(tokio::join!(write,change).0.err().unwrap().code,"archive_write_unknown");assert_eq!(transport.sent.lock().unwrap().len(),1);
                assert!(service.active.lock().unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn archive_unarchive_refresh_changed_principal_never_replays_and_late_completion_is_not_success() {
        for source in sources() {
            let transport=FixtureTransport::new(&[401]);
            let call=|m,p:Value|if m=="getAuthStatus"&&p["refreshToken"]==true{std::future::ready(Ok(auth("other-account")))}else{rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_unarchive_with(request(source),call,&transport).await.err().unwrap().code,"archive_write_unknown");
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        struct CompletionChange<'a>{service:&'a ChatgptService,invalidate:bool}
        impl Transport for CompletionChange<'_> {
            fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
                if self.invalidate{self.service.invalidate();}else{self.service.cancel("unarchive-fixture");}
                Ok(HttpResponse{status:204,headers:BTreeMap::new(),body:Vec::new()})
            })}
        }
        for source in sources(){for invalidate in [false,true]{
            let service=ChatgptService::default();let transport=CompletionChange{service:&service,invalidate};
            assert_eq!(service.archive_unarchive_with(request(source),rpc,&transport).await.err().unwrap().code,"archive_write_unknown");
        }}
    }
}
