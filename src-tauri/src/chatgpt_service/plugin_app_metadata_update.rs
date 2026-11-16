//! Standalone app metadata updates use fresh eligibility and exact readback.
use super::*;

#[derive(Clone,Copy,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum PluginAppMetadataOperation {Name,Description}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginAppMetadataUpdateRequest {
    pub request_id:String,pub expected_identity:ServiceIdentity,pub profile:ServiceProfile,
    pub app_id:String,pub metadata_id:String,pub operation:PluginAppMetadataOperation,pub value:String,
}
impl ChatgptService {
    pub async fn plugin_app_metadata_update<F,Fut>(&self,request:PluginAppMetadataUpdateRequest,call:F)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_app_metadata_update_with(request,call,&CurlTransport).await}
    async fn plugin_app_metadata_update_with<F,Fut,T>(&self,request:PluginAppMetadataUpdateRequest,call:F,transport:&T)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(&request.request_id)?;
        let entry=PluginAppEntryRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity.clone(),profile:request.profile,app_id:request.app_id.clone()};
        let identity=&entry.expected_identity;
        let (field,gate,value)=match request.operation {
            PluginAppMetadataOperation::Name=>("name","canEditName",plugin_app_accounts::rename_trim(&request.value).to_owned()),
            PluginAppMetadataOperation::Description=>("description","canEditDescription",request.value),
        };
        let before=async {
            if field=="name" && value.is_empty(){return Err(failure("invalid_request","App name must not be empty"));}
            encode_segment(&request.app_id)?;encode_segment(&request.metadata_id)?;
            let snapshot=self.plugin_app_management_snapshot(&entry,&registration,&call,transport).await?;
            if snapshot["metadata"]["id"].as_str()!=Some(request.metadata_id.as_str()){return Err(failure("app_metadata_changed","App metadata identity changed; read before editing"));}
            if snapshot[gate]!=true{return Err(failure("forbidden","App metadata is no longer editable"));}
            Ok(snapshot)
        }.await;
        self.check_share_current(identity,&registration)?;
        let before=match before {
            Ok(snapshot)=>snapshot,
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error)=>return Ok(ProfileMutationResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"delivery":"not_sent","warningCode":error.code}),readback:Value::Null,verification:"pending"}),
        };
        if before["metadata"][field].as_str()==Some(value.as_str()) {
            return Ok(ProfileMutationResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"delivery":"not_sent","warningCode":null}),readback:before,verification:"confirmed"});
        }
        let route=format!("/backend-api/aip/connectors/{}/{field}",encode_segment(before["metadata"]["id"].as_str().unwrap())?);
        let body=match request.operation{PluginAppMetadataOperation::Name=>json!({"name":value}),PluginAppMetadataOperation::Description=>json!({"description":value})};
        let result=self.app_metadata_patch(&route,&body,&entry,&registration,&call,transport).await;
        self.check_share_current(identity,&registration)?;
        let (delivery,mut warning)=match result {
            Ok(())=>("accepted",None),
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error) if error.status.is_some_and(|status|(400..500).contains(&status) && status!=408)=>("rejected",Some(error.code)),
            Err(error)=>("unknown",Some(error.code)),
        };
        let readback=match self.plugin_app_management_snapshot(&entry,&registration,&call,transport).await {
            Ok(snapshot)=>snapshot,
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error)=>{warning=Some(error.code);Value::Null},
        };
        self.check_share_current(identity,&registration)?;
        // Permission changes after a write do not invalidate an observed value;
        // an explicit server rejection never becomes successful confirmation.
        let confirmed=delivery!="rejected" && readback["metadata"]["id"].as_str()==Some(request.metadata_id.as_str()) && readback["metadata"][field].as_str()==Some(value.as_str());
        Ok(ProfileMutationResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"delivery":delivery,"warningCode":warning}),readback,verification:if confirmed{"confirmed"}else{"pending"}})
    }

    async fn app_metadata_patch<F,Fut,T>(&self,route:&str,body:&Value,request:&PluginAppEntryRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<()>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let identity=&request.expected_identity;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","App metadata update cancelled; a sent write may already have applied")),
            result=async {
                let mut session=self.session.lock().await;self.prepare(&mut session,identity.generation,call,false).await?;
                self.check_share_current(identity,registration)?;let credentials=session.credentials.as_ref().unwrap();
                if &credentials.identity!=identity{return Err(failure("account_changed","Authenticated identity changed"));}
                let integrity=session.integrity.clone();let mut outgoing=build_http_request(route,credentials,integrity.as_deref(),&request.profile)?;
                outgoing.method=HttpMethod::Patch;outgoing.headers.insert("Content-Type".into(),"application/json".into());outgoing.headers.insert("OAI-Product-Sku".into(),"CODEX".into());outgoing.headers.insert("X-Codex-Surface".into(),"settings".into());
                outgoing.body=serde_json::to_vec(body).unwrap();share_network_allowed(call,&outgoing.url).await?;self.check_share_current(identity,registration)?;
                let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await.map_err(|_|failure("app_metadata_write_unknown","App metadata write outcome unknown; read before retrying"))?;
                self.check_share_current(identity,registration)?;apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                if account_instructions_ip_denied(&response){return Err(ServiceError{code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
                // No automatic PATCH replay on 401: this endpoint has no proven
                // guarantee that a failed authentication response means no write.
                if response.status>=500 || response.status==408{return Err(failure("app_metadata_write_unknown","App metadata write outcome unknown; read before retrying"));}
                if (200..300).contains(&response.status){return Ok(());}
                decode_response(response,registration.id.clone(),identity.clone())?;Ok(())
            }=>result,
        };
        self.check_share_current(identity,registration)?;result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const APP:&str="asdk_app_x/y?z#%中文";const META:&str="connector_x/y?z#%中文";
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"manage-account".into(),user_id:"manage-user".into(),generation:0}}
    fn request(operation:PluginAppMetadataOperation,value:&str)->PluginAppMetadataUpdateRequest {PluginAppMetadataUpdateRequest{request_id:"metadata-update-fixture".into(),expected_identity:identity(),app_id:APP.into(),metadata_id:META.into(),operation,value:value.into(),profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()}}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"manage-account","user_id":"manage-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"manage-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn metadata()->Value {json!({"id":META,"name":"Original","description":" Description ","connector_type":"MCP","status":"ONLY_ME","owners":[{"type":"USER","id":"manage-user","secret":"never-return"}],"token":"never-return"})}
    fn accounts()->Value {json!({"accounts":[{"id":"manage-account","account_user_id":"membership","account_user_role":"standard-user","structure":"personal","plan_type":"future-plan","is_zdr":false,"is_openai_internal":false}],"account_ordering":["manage-account"]})}
    fn snapshot(value:Value)->Vec<(u16,Value)> {vec![(200,json!({"plugin_id":null})),(200,value),(200,accounts())]}
    fn replies(operation:PluginAppMetadataOperation,value:&str)->Vec<(u16,Value)> {let mut values=snapshot(metadata());values.push((204,Value::Null));let mut after=metadata();after[match operation{PluginAppMetadataOperation::Name=>"name",PluginAppMetadataOperation::Description=>"description"}]=json!(value);values.extend(snapshot(after));values}
    struct Fixture{replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture{fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,value)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:if status==204{vec![]}else{serde_json::to_vec(&value).unwrap()}})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture{fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    fn patches(transport:&Fixture)->usize {transport.sent.lock().unwrap().iter().filter(|request|request.method==HttpMethod::Patch).count()}
    #[tokio::test]
    async fn app_metadata_update_name_encodes_fresh_metadata_id_and_reads_back(){
        let transport=Fixture::new(replies(PluginAppMetadataOperation::Name,"Renamed"));let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"\u{feff} Renamed \t"),rpc,&transport).await.unwrap();
        assert_eq!(result.body,json!({"delivery":"accepted","warningCode":null}));assert_eq!(result.verification,"confirmed");assert_eq!(result.readback["metadata"]["name"],"Renamed");assert_eq!(result.readback["appId"],APP);
        let text=serde_json::to_string(&result).unwrap();assert!(!text.contains("never-return")&&!text.contains(&token()));let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),7);
        let patch=&sent[3];assert_eq!(patch.method,HttpMethod::Patch);assert_eq!(patch.url,"https://chatgpt.com/backend-api/aip/connectors/connector_x%2Fy%3Fz%23%25%E4%B8%AD%E6%96%87/name");
        assert_eq!(patch.headers["OAI-Product-Sku"],"CODEX");assert_eq!(patch.headers["X-Codex-Surface"],"settings");assert_eq!(serde_json::from_slice::<Value>(&patch.body).unwrap(),json!({"name":"Renamed"}));
        assert!(sent[1].url.contains("/asdk_app_x%2F"));assert_eq!(sent[4].url,sent[0].url);assert_eq!(sent[5].url,sent[1].url);
    }
    #[tokio::test]
    async fn app_metadata_update_description_is_exact_and_empty_is_supported_without_nickname_limit(){
        for value in [""," \n Exact description \t "] {let transport=Fixture::new(replies(PluginAppMetadataOperation::Description,value));let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Description,value),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"confirmed");assert_eq!(result.readback["metadata"]["description"],value);let sent=transport.sent.lock().unwrap();assert!(sent[3].url.ends_with("/description"));assert_eq!(serde_json::from_slice::<Value>(&sent[3].body).unwrap(),json!({"description":value}));}
        let value="😀".repeat(65);let transport=Fixture::new(replies(PluginAppMetadataOperation::Name,&value));assert_eq!(ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,&value),rpc,&transport).await.unwrap().verification,"confirmed");
    }
    #[tokio::test]
    async fn app_metadata_update_same_value_is_confirmed_without_patch_but_null_is_not_empty_string(){
        for (operation,value) in [(PluginAppMetadataOperation::Name,"Original"),(PluginAppMetadataOperation::Description," Description ")] {let transport=Fixture::new(snapshot(metadata()));let result=ChatgptService::default().plugin_app_metadata_update_with(request(operation,value),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert!(result.body["warningCode"].is_null());assert_eq!(result.verification,"confirmed");assert_eq!(patches(&transport),0);}
        let mut values=replies(PluginAppMetadataOperation::Description,"");values[1].1["description"]=Value::Null;let transport=Fixture::new(values);assert_eq!(ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Description,""),rpc,&transport).await.unwrap().verification,"confirmed");assert_eq!(patches(&transport),1);
    }
    #[tokio::test]
    async fn app_metadata_update_invalid_name_stale_metadata_id_or_revoked_gate_never_patches(){
        let transport=Fixture::new(vec![]);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"\u{feff} \t"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.body["warningCode"],"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());
        let transport=Fixture::new(snapshot(metadata()));let mut changed=request(PluginAppMetadataOperation::Name,"New");changed.metadata_id=APP.into();let result=ChatgptService::default().plugin_app_metadata_update_with(changed,rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert!(result.body["warningCode"].is_string());assert_eq!(patches(&transport),0);
        let mut source=metadata();source["owners"][0]["id"]=json!("other-user");let transport=Fixture::new(snapshot(source));let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.body["warningCode"],"forbidden");assert_eq!(patches(&transport),0);
    }
    #[tokio::test]
    async fn app_metadata_update_uses_distinct_disabled_name_description_permissions(){
        let mut values=replies(PluginAppMetadataOperation::Name,"New");for index in [1,5]{values[index].1["status"]=json!("DISABLED_BY_ADMIN");values[index].1["app_metadata"]=json!({"review":{"status":"DEVELOPMENT"}});}let transport=Fixture::new(values);
        assert_eq!(ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap().verification,"confirmed");
        let mut source=metadata();source["status"]=json!("DISABLED_BY_ADMIN");source["app_metadata"]=json!({"review":{"status":"DEVELOPMENT"}});let transport=Fixture::new(snapshot(source));
        let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Description,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.body["warningCode"],"forbidden");assert_eq!(patches(&transport),0);
    }
    #[tokio::test]
    async fn app_metadata_update_preflight_failures_and_plugin_association_are_known_not_sent(){
        for (status,association) in [(503,json!({"message":"never-return"})),(200,json!({"plugin_id":"new-plugin"}))] {let transport=Fixture::new(vec![(status,association)]);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert!(result.body["warningCode"].is_string());assert_eq!(patches(&transport),0);assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));}
    }
    #[tokio::test]
    async fn app_metadata_update_ack_or_unknown_uses_only_fresh_snapshot_to_confirm(){
        for status in [204,302,408,503] {let mut values=replies(PluginAppMetadataOperation::Name,"New");values[3]=(status,Value::Null);let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],if status==204{"accepted"}else{"unknown"});assert_eq!(result.verification,"confirmed");assert_eq!(patches(&transport),1);}
        let transport=Fixture::new(replies(PluginAppMetadataOperation::Name,"New"));transport.replies.lock().unwrap()[3]=Err(failure("network_error","never-return"));let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"confirmed");assert_eq!(patches(&transport),1);
        let mut values=replies(PluginAppMetadataOperation::Name,"New");values[5].1["owners"][0]["id"]=json!("other-user");let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.readback["canEditName"],false);assert_eq!(result.verification,"confirmed","fresh value confirmation is independent of permissions revoked after the write");
    }
    #[tokio::test]
    async fn app_metadata_update_read_failure_old_value_or_new_association_stays_pending_without_replay(){
        for case in ["old","read-error","association","changed-id"] {let mut values=replies(PluginAppMetadataOperation::Name,"New");match case{
            "old"=>values[5].1["name"]=json!("Original"),"read-error"=>{values[5]=(503,json!({}));values.truncate(6);},"association"=>{values[4]=(200,json!({"plugin_id":"new-plugin"}));values.truncate(5);},"changed-id"=>values[5].1["id"]=json!(APP),_=>unreachable!(),}
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.verification,"pending","{case}");assert_eq!(result.body["delivery"],"accepted");assert_eq!(patches(&transport),1);}
    }
    #[tokio::test]
    async fn app_metadata_update_explicit_4xx_is_rejected_and_401_is_never_automatically_replayed(){
        for status in [400,401,403,404,429] {let mut values=replies(PluginAppMetadataOperation::Name,"New");values[3]=(status,json!({}));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"rejected");assert_eq!(result.verification,"pending");assert!(result.body["warningCode"].is_string());assert_eq!(patches(&transport),1);}
    }
    #[tokio::test]
    async fn app_metadata_update_ip_denial_is_rejected_without_replay(){
        let mut values=replies(PluginAppMetadataOperation::Name,"Original");values[3]=(401,json!({"error":{"code":"workspace_ip_not_authorized"}}));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"rejected");assert_eq!(result.body["warningCode"],"ip_not_authorized");assert_eq!(patches(&transport),1);
    }
    #[tokio::test]
    async fn app_metadata_update_account_aba_or_cancel_after_patch_never_publishes_old_state(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{let writing=request.method==HttpMethod::Patch;let result=self.fixture.send(request,cancel).await;if writing{self.service.invalidate();self.service.invalidate();}result})}}
        let service=ChatgptService::default();let transport=Invalidate{service:&service,fixture:Fixture::new(replies(PluginAppMetadataOperation::Name,"New"))};assert_eq!(service.plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),4);
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{if request.method==HttpMethod::Patch{self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancel"))}else{self.fixture.send(request,cancel).await}})}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(snapshot(metadata())),entered:AtomicBool::new(false)};
        let(result,())=tokio::time::timeout(Duration::from_secs(5),async{tokio::join!(service.plugin_app_metadata_update_with(request(PluginAppMetadataOperation::Name,"New"),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("metadata-update-fixture"));})}).await.expect("metadata patch must enter and cancel transport");
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),3);
    }
}
