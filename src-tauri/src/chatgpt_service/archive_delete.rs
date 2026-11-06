//! Fixed cloud archive deletion; HTTP acceptance is not independent readback.
use super::*;

#[derive(Clone,Copy,Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum ArchiveDeleteSource {CloudTask,ChatgptConversation}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ArchiveDeleteRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub source:ArchiveDeleteSource,
    pub target_id:String,
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ArchiveDeleteResponse {
    pub request_id:String,
    pub identity:ServiceIdentity,
    pub status:&'static str,
}

fn delete_route(source:ArchiveDeleteSource,id:&str) -> ServiceResult<String> {
    if id.trim().is_empty() || id.len()>2048 || matches!(id,"."|"..") || id.chars().any(char::is_control) {
        return Err(failure("invalid_request","Invalid archive deletion target identifier"));
    }
    let id=id.bytes().map(|byte|if byte.is_ascii_alphanumeric() || b"-_~".contains(&byte) {
        (byte as char).to_string()
    }else{format!("%{byte:02X}")}).collect::<String>();
    Ok(match source {
        ArchiveDeleteSource::CloudTask=>format!("/backend-api/wham/tasks/{id}"),
        ArchiveDeleteSource::ChatgptConversation=>format!("/backend-api/conversation/id/{id}"),
    })
}

fn delete_auth(auth:&Value) -> ServiceResult<()> {
    match auth.get("authMethod") {
        Some(Value::String(method)) if method=="chatgpt"=>Ok(()),
        Some(Value::Null)|Some(Value::String(_))=>Err(failure("not_logged_in","ChatGPT authentication required to delete archived chats")),
        _=>Err(failure("auth_unavailable","ChatGPT authentication status unavailable")),
    }
}

fn delete_outcome(error:ServiceError,sent:bool) -> ServiceError {
    if !sent || error.status.is_some_and(|status|(400..500).contains(&status) && status!=408) {return error;}
    ServiceError {code:"archive_write_unknown",message:"Deletion outcome is unknown; refresh the original account before retrying",status:error.status}
}

impl ChatgptService {
    pub async fn archive_delete<F,Fut>(&self,request:ArchiveDeleteRequest,call:F) -> ServiceResult<ArchiveDeleteResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.archive_delete_with(request,call,&CurlTransport).await
    }

    async fn archive_delete_with<F,Fut,T>(&self,request:ArchiveDeleteRequest,call:F,transport:&T) -> ServiceResult<ArchiveDeleteResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let route=delete_route(request.source,&request.target_id)?;
        let registration=self.register(&request.request_id)?;
        let identity=&request.expected_identity;
        self.check_share_current(identity,&registration)?;
        let sent=AtomicBool::new(false);
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Archive deletion cancelled")),
            result=async {
                let mut session=self.session.lock().await;
                self.check_share_current(identity,&registration)?;
                let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await
                    .map_err(|_|failure("auth_unavailable","ChatGPT authentication status unavailable"))?;
                delete_auth(&auth)?;
                self.check_share_current(identity,&registration)?;
                self.prepare(&mut session,identity.generation,&call,false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity,&registration)?;
                    let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await
                        .map_err(|_|failure("auth_unavailable","ChatGPT authentication status unavailable"))?;
                    delete_auth(&auth)?;
                    self.check_share_current(identity,&registration)?;
                    let credentials=session.credentials.as_ref().unwrap();
                    if &credentials.identity!=identity {return Err(failure("account_changed","Archive deletion authenticated identity changed"));}
                    let integrity=session.integrity.clone();
                    let mut outgoing=build_http_request(&route,credentials,integrity.as_deref(),&request.profile)?;
                    outgoing.method=HttpMethod::Delete;
                    share_network_allowed(&call,&outgoing.url).await?;
                    self.check_share_current(identity,&registration)?;
                    sent.store(true,Ordering::SeqCst);
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
                    self.check_share_current(identity,&registration)?;
                    apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {
                        return Err(ServiceError {code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});
                    }
                    if response.status==401 && attempt==0 {self.prepare(&mut session,identity.generation,&call,true).await?;continue;}
                    let absent=response.status==404 && match request.source {
                        ArchiveDeleteSource::CloudTask=>true,
                        ArchiveDeleteSource::ChatgptConversation=>serde_json::from_slice::<Value>(&response.body).ok()
                            .is_some_and(|body|review_error_code(&body)==Some("conversation_deleted")),
                    };
                    if (200..300).contains(&response.status) || absent {
                        return Ok(ArchiveDeleteResponse {request_id:request.request_id.clone(),identity:identity.clone(),status:if absent{"already-absent"}else{"accepted"}});
                    }
                    return Err(decode_response(response,registration.id.clone(),identity.clone()).err()
                        .unwrap_or_else(||failure("archive_write_unknown","Archive deletion response was not accepted")));
                }
                unreachable!()
            }=>result,
        };
        let current=self.check_share_current(identity,&registration);
        current.and(result).map_err(|error|delete_outcome(error,sent.load(Ordering::SeqCst)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn identity()->ServiceIdentity {ServiceIdentity {account_id:"delete-account".into(),user_id:"delete-user".into(),generation:0}}
    fn request(source:ArchiveDeleteSource)->ArchiveDeleteRequest {
        ArchiveDeleteRequest {request_id:"delete-fixture".into(),expected_identity:identity(),source,target_id:"same-id".into(),profile:ServiceProfile {
            language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into(),
        }}
    }
    fn auth(account:&str)->Value {
        let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":account,"user_id":"delete-user","chatgpt_account_is_fedramp":false}});
        let token=format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
        json!({"authMethod":"chatgpt","authToken":token})
    }
    fn rpc(method:&'static str,_:Value)->std::future::Ready<Result<Value,String>> {
        std::future::ready(match method {
            "getAuthStatus"=>Ok(auth("delete-account")),"configRequirements/read"=>Ok(json!({"requirements":null})),
            "account/read"=>Ok(json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com",
                "chatgptAccountId":"delete-account","accountRoutingOverride":"NO_CONSTRAINT"}})),_=>Err("unexpected fixture RPC".into()),
        })
    }
    fn sources()->[ArchiveDeleteSource;2] {[ArchiveDeleteSource::CloudTask,ArchiveDeleteSource::ChatgptConversation]}
    struct FixtureTransport {replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>,pause_at:usize,entered:AtomicBool}
    impl FixtureTransport {
        fn new(statuses:&[u16])->Self {
            Self {replies:Mutex::new(statuses.iter().map(|status|Ok(HttpResponse {status:*status,headers:BTreeMap::new(),body:Vec::new()})).collect()),
                sent:Mutex::new(Vec::new()),pause_at:usize::MAX,entered:AtomicBool::new(false)}
        }
        fn body(&self,body:Value) {self.replies.lock().unwrap().front_mut().unwrap().as_mut().unwrap().body=serde_json::to_vec(&body).unwrap();}
    }
    impl Transport for FixtureTransport {
        fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
            let index={let mut sent=self.sent.lock().unwrap();sent.push(request);sent.len()-1};
            if index==self.pause_at {self.entered.store(true,Ordering::SeqCst);tokio::select! {
                _=cancelled(&cancel)=>return Err(failure("cancelled","fixture cancelled")),_=tokio::time::sleep(Duration::from_millis(150))=>{}
            }}
            self.replies.lock().unwrap().pop_front().expect("unexpected delete/replay/readback")
        })}
    }

    #[tokio::test]
    async fn archive_delete_fixed_sources_use_delete_without_body_or_fake_readback() {
        for source in sources() {
            let transport=FixtureTransport::new(&[204]);let mut read=request(source);read.target_id="../opaque /中?x#%".into();
            let result=ChatgptService::default().archive_delete_with(read,rpc,&transport).await.unwrap();
            assert_eq!(result.status,"accepted");assert_eq!(result.identity,identity());
            let public=serde_json::to_value(result).unwrap();assert_eq!(public.as_object().unwrap().len(),3);assert!(public.get("body").is_none());
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);assert_eq!(sent[0].method,HttpMethod::Delete);assert!(sent[0].body.is_empty());
            let id="%2E%2E%2Fopaque%20%2F%E4%B8%AD%3Fx%23%25";
            assert_eq!(sent[0].url,match source {ArchiveDeleteSource::CloudTask=>format!("https://chatgpt.com/backend-api/wham/tasks/{id}"),
                ArchiveDeleteSource::ChatgptConversation=>format!("https://chatgpt.com/backend-api/conversation/id/{id}")});
            assert_eq!(sent[0].headers["ChatGPT-Account-Id"],"delete-account");assert_eq!(sent[0].headers["oai-did"],"fixture-device");
            assert_eq!(sent[0].headers["OAI-Language"],"zh-CN");assert!(!sent[0].headers.contains_key("Content-Type"));
        }
    }

    #[test]
    fn archive_delete_curl_delete_has_real_method_argument_and_no_upload_file_or_data_binary() {
        for method in [HttpMethod::Get,HttpMethod::Delete,HttpMethod::Post,HttpMethod::Patch,HttpMethod::Put] {
            let outgoing=HttpRequest {url:"https://example.test/fixed".into(),headers:BTreeMap::new(),method,body:Vec::new()};
            let mut config=curl_config(&outgoing).unwrap();let file=curl_upload_body(&outgoing,&mut config).unwrap();
            assert_eq!(curl_method(method),match method {HttpMethod::Get=>"GET",HttpMethod::Delete=>"DELETE",HttpMethod::Post=>"POST",HttpMethod::Patch=>"PATCH",HttpMethod::Put=>"PUT"});
            if matches!(method,HttpMethod::Get|HttpMethod::Delete) {assert!(file.is_none());assert!(!config.contains("data-binary"));}
            else {let path=file.as_ref().unwrap().0.clone();assert!(path.exists());assert!(config.contains("data-binary"));drop(file);assert!(!path.exists());}
        }
        let invalid=HttpRequest {url:"https://example.test/fixed".into(),headers:BTreeMap::new(),method:HttpMethod::Delete,body:b"{}".to_vec()};
        assert_eq!(curl_config(&invalid).err().unwrap().code,"invalid_request");
    }

    #[tokio::test]
    async fn archive_delete_source_specific_404_and_official_error_code_priority() {
        for body in [Value::Null,json!({"code":"unrelated"}),json!({"error":{"code":"conversation_deleted"}})] {
            let transport=FixtureTransport::new(&[404]);transport.body(body);
            assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::CloudTask),rpc,&transport).await.unwrap().status,"already-absent");
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let transport=FixtureTransport::new(&[404]);transport.replies.lock().unwrap().front_mut().unwrap().as_mut().unwrap().body=b"not-json".to_vec();
        assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::CloudTask),rpc,&transport).await.unwrap().status,"already-absent");
        for body in [json!({"error_code":"conversation_deleted"}),json!({"error":{"code":"conversation_deleted"}}),
            json!({"detail":{"error":{"file_parse_error_code":"conversation_deleted"}}}),json!({"extra":{"code":"conversation_deleted"},"code":"other"})] {
            let transport=FixtureTransport::new(&[404]);transport.body(body);
            assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::ChatgptConversation),rpc,&transport).await.unwrap().status,"already-absent");
        }
        for body in [Value::Null,json!({"message":"conversation_deleted"}),json!({"code":"other","error":{"code":"conversation_deleted"}}),
            json!({"extra":{"code":"other"},"code":"conversation_deleted"}),json!({"error_code":"other","code":"conversation_deleted"})] {
            let transport=FixtureTransport::new(&[404]);transport.body(body);
            assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::ChatgptConversation),rpc,&transport).await.err().unwrap().code,"not_found");
        }
        let transport=FixtureTransport::new(&[403]);transport.body(json!({"code":"conversation_deleted"}));
        assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::ChatgptConversation),rpc,&transport).await.err().unwrap().code,"forbidden");
    }

    #[tokio::test]
    async fn archive_delete_invalid_source_extra_fields_and_ids_cannot_authenticate() {
        for id in ["".into()," \t".into(),".".into(),"..".into(),"bad\nvalue".into(),"x".repeat(2049),"中".repeat(683)] {
            let mut input=request(ArchiveDeleteSource::CloudTask);input.target_id=id;let transport=FixtureTransport::new(&[]);let calls=AtomicUsize::new(0);
            let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_delete_with(input,call,&transport).await.err().unwrap().code,"invalid_request");
            assert_eq!(calls.load(Ordering::SeqCst),0);assert!(transport.sent.lock().unwrap().is_empty());
        }
        assert!(delete_route(ArchiveDeleteSource::CloudTask,&"x".repeat(2048)).is_ok());
        assert!(delete_route(ArchiveDeleteSource::CloudTask,&"中".repeat(682)).is_ok());
        let profile=json!({"language":"x","deviceId":"x","userAgent":"x","userAgentClientHints":"x","platformClientHint":"x"});
        let base=json!({"requestId":"x","expectedIdentity":identity(),"profile":profile,"source":"cloud-task","targetId":"id"});
        for source in [json!("local"),json!("unknown"),json!(17),Value::Null] {let mut value=base.clone();value["source"]=source;assert!(serde_json::from_value::<ArchiveDeleteRequest>(value).is_err());}
        for key in ["url","method","body","accountId","includeWorkCloud"] {let mut value=base.clone();value[key]=json!(true);assert!(serde_json::from_value::<ArchiveDeleteRequest>(value).is_err());}
    }

    #[tokio::test]
    async fn archive_delete_accepts_2xx_any_body_and_one_same_principal_401_replay() {
        for source in sources() {
            for status in [200,204,299] {
                let transport=FixtureTransport::new(&[status]);transport.replies.lock().unwrap().front_mut().unwrap().as_mut().unwrap().body=b"not-json private-success".to_vec();
                let result=ChatgptService::default().archive_delete_with(request(source),rpc,&transport).await.unwrap();
                assert_eq!(result.status,"accepted");assert!(!serde_json::to_string(&result).unwrap().contains("private-success"));assert_eq!(transport.sent.lock().unwrap().len(),1);
            }
            let transport=FixtureTransport::new(&[401,204]);let refreshes=AtomicUsize::new(0);
            let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_delete_with(request(source),call,&transport).await.unwrap().status,"accepted");assert_eq!(refreshes.load(Ordering::SeqCst),1);
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);assert_eq!(sent[0].url,sent[1].url);assert_eq!(sent[0].method,HttpMethod::Delete);assert_eq!(sent[1].method,HttpMethod::Delete);assert!(sent.iter().all(|request|request.body.is_empty()));
        }
    }

    #[tokio::test]
    async fn archive_delete_definite_errors_ip_and_uncertain_http_are_not_success_or_network_replay() {
        for source in sources() {
            for (statuses,code) in [(vec![401,401],"unauthorized"),(vec![403],"forbidden"),(vec![429],"rate_limited"),(vec![408],"archive_write_unknown"),(vec![500],"archive_write_unknown")] {
                let transport=FixtureTransport::new(&statuses);let error=ChatgptService::default().archive_delete_with(request(source),rpc,&transport).await.err().unwrap();
                assert_eq!(error.code,code);assert_eq!(error.status,statuses.last().copied());assert_eq!(transport.sent.lock().unwrap().len(),statuses.len());
            }
            for code in ["ip_not_authorized","validate_whitelist_failed","workspace_ip_not_authorized"] {
                let transport=FixtureTransport::new(&[401]);transport.body(json!({"error":{"code":code}}));let refreshes=AtomicUsize::new(0);
                let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc(m,p)};
                assert_eq!(ChatgptService::default().archive_delete_with(request(source),call,&transport).await.err().unwrap().code,"ip_not_authorized");
                assert_eq!(refreshes.load(Ordering::SeqCst),0);assert_eq!(transport.sent.lock().unwrap().len(),1);
            }
            for code in ["network_error","timeout"] {
                let transport=FixtureTransport::new(&[]);transport.replies.lock().unwrap().push_back(Err(failure(code,"fixture failure")));
                assert_eq!(ChatgptService::default().archive_delete_with(request(source),rpc,&transport).await.err().unwrap().code,"archive_write_unknown");assert_eq!(transport.sent.lock().unwrap().len(),1);
            }
        }
    }

    #[tokio::test]
    async fn archive_delete_pre_send_auth_policy_cancel_and_identity_leave_zero_deletes() {
        let transport=FixtureTransport::new(&[]);
        for method in ["apiKey","chatgptAuthTokens","bedrock"] {
            let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(json!({"authMethod":method})))}else{rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::CloudTask),call,&transport).await.err().unwrap().code,"not_logged_in");
        }
        let denied=|m,p|if m=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{rpc(m,p)};
        assert_eq!(ChatgptService::default().archive_delete_with(request(ArchiveDeleteSource::CloudTask),denied,&transport).await.err().unwrap().code,"network_restricted");
        let mut wrong=request(ArchiveDeleteSource::CloudTask);wrong.expected_identity.user_id="other-user".into();
        assert_eq!(ChatgptService::default().archive_delete_with(wrong,rpc,&transport).await.err().unwrap().code,"account_changed");
        let service=ChatgptService::default();service.cancel("delete-fixture");assert_eq!(service.archive_delete_with(request(ArchiveDeleteSource::CloudTask),rpc,&transport).await.err().unwrap().code,"cancelled");
        let service=ChatgptService::default();let guard=service.session.lock().await;
        let operation=service.archive_delete_with(request(ArchiveDeleteSource::CloudTask),rpc,&transport);let cancel=async{tokio::task::yield_now().await;service.cancel("delete-fixture");};
        assert_eq!(tokio::join!(operation,cancel).0.err().unwrap().code,"cancelled");drop(guard);assert!(transport.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn archive_delete_sent_cancel_aba_and_refresh_principal_changes_are_unknown() {
        for source in sources() {
            for invalidate in [false,true] {
                let service=ChatgptService::default();let mut transport=FixtureTransport::new(&[204]);transport.pause_at=0;
                let operation=service.archive_delete_with(request(source),rpc,&transport);
                let change=async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate{service.invalidate();service.invalidate();}else{service.cancel("delete-fixture");}};
                assert_eq!(tokio::join!(operation,change).0.err().unwrap().code,"archive_write_unknown");assert_eq!(transport.sent.lock().unwrap().len(),1);assert!(service.active.lock().unwrap().is_empty());
            }
            let transport=FixtureTransport::new(&[401]);let call=|m,p:Value|if m=="getAuthStatus"&&p["refreshToken"]==true{std::future::ready(Ok(auth("other-account")))}else{rpc(m,p)};
            assert_eq!(ChatgptService::default().archive_delete_with(request(source),call,&transport).await.err().unwrap().code,"archive_write_unknown");assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }

    #[tokio::test]
    async fn archive_delete_late_accepted_or_absent_response_cannot_succeed_after_scope_change() {
        struct CompletionChange<'a>{service:&'a ChatgptService,invalidate:bool,status:u16}
        impl Transport for CompletionChange<'_>{
            fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
                if self.invalidate{self.service.invalidate();}else{self.service.cancel("delete-fixture");}
                Ok(HttpResponse {status:self.status,headers:BTreeMap::new(),body:br#"{"code":"conversation_deleted"}"#.to_vec()})
            })}
        }
        for source in sources(){for invalidate in [false,true]{for status in [204,404]{
            let service=ChatgptService::default();let transport=CompletionChange{service:&service,invalidate,status};
            assert_eq!(service.archive_delete_with(request(source),rpc,&transport).await.err().unwrap().code,"archive_write_unknown");
        }}}
    }
}
