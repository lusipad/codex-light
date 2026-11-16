//! Standalone app deletion and read-only presence recovery.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginAppDeleteRequest {
    pub request_id:String,pub expected_identity:ServiceIdentity,pub profile:ServiceProfile,
    pub app_id:String,pub metadata_id:String,
}
impl ChatgptService {
    pub async fn plugin_app_delete<F,Fut>(&self,request:PluginAppDeleteRequest,call:F)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_app_delete_with(request,call,&CurlTransport).await}
    async fn plugin_app_delete_with<F,Fut,T>(&self,request:PluginAppDeleteRequest,call:F,transport:&T)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(&request.request_id)?;
        let entry=PluginAppEntryRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity.clone(),profile:request.profile,app_id:request.app_id.clone()};
        let identity=&entry.expected_identity;
        let before=async {
            encode_segment(&request.app_id)?;encode_segment(&request.metadata_id)?;
            let snapshot=self.plugin_app_management_snapshot(&entry,&registration,&call,transport).await?;
            if snapshot["metadata"]["id"].as_str()!=Some(request.metadata_id.as_str()){return Err(failure("app_metadata_changed","App metadata identity changed; read before deleting"));}
            if snapshot["canDelete"]!=true || snapshot["deleteDisabled"]!=false{return Err(failure("forbidden","App is no longer deletable"));}
            Ok(snapshot)
        }.await;
        self.check_share_current(identity,&registration)?;
        let before=match before {
            Ok(snapshot)=>snapshot,
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error)=>return Ok(ProfileMutationResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"delivery":"not_sent","warningCode":error.code}),readback:Value::Null,verification:"pending"}),
        };
        let route=format!("/backend-api/aip/connectors/{}",encode_segment(before["metadata"]["id"].as_str().unwrap())?);
        let result=self.app_delete_http(&route,&entry,&registration,&call,transport).await;
        self.check_share_current(identity,&registration)?;
        let (delivery,mut warning)=match result {
            Ok(())=>("accepted",None),
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error) if error.status.is_some_and(|status|(400..500).contains(&status) && status!=408)=>("rejected",Some(error.code)),
            Err(error)=>("unknown",Some(error.code)),
        };
        let readback=match self.app_delete_presence(&entry,&request.metadata_id,&registration,&call,transport).await {
            Ok(snapshot)=>snapshot,
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error)=>{warning=Some(error.code);Value::Null},
        };
        self.check_share_current(identity,&registration)?;
        let confirmed=delivery!="rejected" && readback["presence"].as_str()==Some("not_found");
        Ok(ProfileMutationResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"delivery":delivery,"warningCode":warning}),readback,verification:if confirmed{"confirmed"}else{"pending"}})
    }
    pub async fn plugin_app_delete_status_read<F,Fut>(&self,request:PluginAppDeleteRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_app_delete_status_with(request,call,&CurlTransport).await}
    async fn plugin_app_delete_status_with<F,Fut,T>(&self,request:PluginAppDeleteRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(&request.request_id)?;
        let entry=PluginAppEntryRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity.clone(),profile:request.profile,app_id:request.app_id};
        let body=self.app_delete_presence(&entry,&request.metadata_id,&registration,&call,transport).await?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:request.expected_identity,body})
    }
    async fn app_delete_presence<F,Fut,T>(&self,request:&PluginAppEntryRequest,metadata_id:&str,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let encoded=encode_segment(&request.app_id)?;encode_segment(metadata_id)?;
        if plugin_app_link_permissions::link_permission_normalize(&request.app_id)!=plugin_app_link_permissions::link_permission_normalize(metadata_id) {
            return Err(failure("invalid_request","App and metadata identities must refer to the same app"));
        }
        let result=self.plugin_app_metadata_http(&format!("/backend-api/aip/connectors/{encoded}?include_actions=true"),&request.expected_identity,&request.profile,registration,call,transport).await;
        self.check_share_current(&request.expected_identity,registration)?;
        let presence=match result {
            Ok(metadata)=>{
                if metadata.get("id").and_then(Value::as_str)!=Some(metadata_id) || plugin_app_link_permissions::link_permission_normalize(metadata_id)!=plugin_app_link_permissions::link_permission_normalize(&request.app_id) {
                    return Err(failure("app_metadata_changed","App metadata identity changed; read before deleting"));
                }
                "present"
            },
            Err(error) if error.status==Some(404)=>"not_found",
            Err(error)=>return Err(error),
        };
        Ok(json!({"appId":request.app_id,"metadataId":metadata_id,"presence":presence}))
    }
    async fn app_delete_http<F,Fut,T>(&self,route:&str,request:&PluginAppEntryRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<()>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let identity=&request.expected_identity;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","App deletion cancelled; a sent write may already have applied")),
            result=async {
                let mut session=self.session.lock().await;self.prepare(&mut session,identity.generation,call,false).await?;
                self.check_share_current(identity,registration)?;let credentials=session.credentials.as_ref().unwrap();
                if &credentials.identity!=identity{return Err(failure("account_changed","Authenticated identity changed"));}
                let integrity=session.integrity.clone();let mut outgoing=build_http_request(route,credentials,integrity.as_deref(),&request.profile)?;
                outgoing.method=HttpMethod::Delete;outgoing.headers.insert("OAI-Product-Sku".into(),"CODEX".into());outgoing.headers.insert("X-Codex-Surface".into(),"settings".into());
                share_network_allowed(call,&outgoing.url).await?;self.check_share_current(identity,registration)?;
                let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await.map_err(|_|failure("app_delete_unknown","App deletion outcome unknown; read before retrying"))?;
                self.check_share_current(identity,registration)?;apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                if account_instructions_ip_denied(&response){return Err(ServiceError{code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
                // Never replay DELETE, including on an explicit 401.
                if response.status>=500 || response.status==408{return Err(failure("app_delete_unknown","App deletion outcome unknown; read before retrying"));}
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
    fn request()->PluginAppDeleteRequest {PluginAppDeleteRequest{request_id:"app-delete-fixture".into(),expected_identity:identity(),app_id:APP.into(),metadata_id:META.into(),profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()}}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"manage-account","user_id":"manage-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"manage-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn metadata()->Value {json!({"id":META,"name":"Original","connector_type":"MCP","status":"ONLY_ME","owners":[{"type":"USER","id":"manage-user","secret":"never-return"}],"token":"never-return"})}
    fn accounts()->Value {json!({"accounts":[{"id":"manage-account","account_user_id":"membership","account_user_role":"standard-user","structure":"personal","plan_type":"future-plan","is_zdr":false,"is_openai_internal":false}],"account_ordering":["manage-account"]})}
    fn replies()->Vec<(u16,Value)> {vec![(200,json!({"plugin_id":null})),(200,metadata()),(200,accounts()),(204,Value::Null),(404,json!({}))]}
    struct Fixture{replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture{fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,value)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:if status==204{vec![]}else{serde_json::to_vec(&value).unwrap()}})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture{fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    #[tokio::test]
    async fn app_delete_encodes_fresh_metadata_id_and_confirms_only_explicit_not_found(){
        let transport=Fixture::new(replies());let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body,json!({"delivery":"accepted","warningCode":null}));assert_eq!(result.verification,"confirmed");assert_eq!(result.readback,json!({"appId":APP,"metadataId":META,"presence":"not_found"}));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),5);let write=&sent[3];assert_eq!(write.method,HttpMethod::Delete);
        assert_eq!(write.url,"https://chatgpt.com/backend-api/aip/connectors/connector_x%2Fy%3Fz%23%25%E4%B8%AD%E6%96%87");assert!(write.body.is_empty());assert_eq!(write.headers["OAI-Product-Sku"],"CODEX");assert_eq!(write.headers["X-Codex-Surface"],"settings");
        assert_eq!(sent[4].method,HttpMethod::Get);assert_eq!(sent[4].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_x%2Fy%3Fz%23%25%E4%B8%AD%E6%96%87?include_actions=true");assert!(!result.readback.to_string().contains("never-return"));
    }
    fn deletes(transport:&Fixture)->usize {transport.sent.lock().unwrap().iter().filter(|request|request.method==HttpMethod::Delete).count()}
    #[tokio::test]
    async fn app_delete_preflight_is_not_sent_for_wrong_identity_nonowner_and_missing_metadata(){
        for change in 0..4 {let mut values=replies();match change {
            0=>values[1].1["id"]=json!("connector_other"),
            1=>values[1].1["owners"]=json!([]),
            2=>values[1]=(404,json!({})),
            _=>values[0].1=json!({"plugin_id":"now-managed"}),
        };let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(deletes(&transport),0);}
        let mut req=request();req.metadata_id="connector_changed".into();let transport=Fixture::new(replies());let result=ChatgptService::default().plugin_app_delete_with(req,rpc,&transport).await.unwrap();assert_eq!(result.body["warningCode"],"app_metadata_changed");assert_eq!(deletes(&transport),0);
    }
    #[tokio::test]
    async fn app_delete_unknown_delivery_never_replays_and_reads_only_once(){
        for status in [302,408,503] {for absent in [false,true] {let mut values=replies();values[3]=(status,json!({}));values[4]=if absent{(404,json!({}))}else{(200,metadata())};let transport=Fixture::new(values);
            let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,if absent{"confirmed"}else{"pending"});assert_eq!(deletes(&transport),1);assert_eq!(transport.sent.lock().unwrap().len(),5);
        }}
        let transport=Fixture::new(replies());transport.replies.lock().unwrap()[3]=Err(failure("network_error","fixture transport error"));let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"confirmed");assert_eq!(deletes(&transport),1);
    }
    #[tokio::test]
    async fn app_delete_explicit_rejection_never_becomes_confirmed_or_replays_401(){
        for status in [400,401,403,404,429] {let mut values=replies();values[3]=(status,json!({}));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"rejected","{status}");assert_eq!(result.verification,"pending");assert_eq!(result.readback["presence"],"not_found");assert_eq!(deletes(&transport),1);assert_eq!(transport.sent.lock().unwrap().len(),5);}
    }
    #[tokio::test]
    async fn app_delete_status_does_not_infer_absence_from_error_or_other_metadata(){
        for (status,body) in [(403,json!({})),(503,json!({})),(200,json!({})),(200,json!({"id":"connector_other"}))] {let transport=Fixture::new(vec![(status,body)]);assert!(ChatgptService::default().plugin_app_delete_status_with(request(),rpc,&transport).await.is_err());assert_eq!(deletes(&transport),0);}
        for absent in [false,true] {let transport=Fixture::new(vec![if absent{(404,json!({}))}else{(200,metadata())}]);let result=ChatgptService::default().plugin_app_delete_status_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body,json!({"appId":APP,"metadataId":META,"presence":if absent{"not_found"}else{"present"}}));assert_eq!(transport.sent.lock().unwrap().len(),1);}
        let transport=Fixture::new(vec![(401,json!({})),(200,metadata())]);assert!(ChatgptService::default().plugin_app_delete_status_with(request(),rpc,&transport).await.is_ok());assert_eq!(transport.sent.lock().unwrap().len(),2);
    }
    #[tokio::test]
    async fn app_delete_status_rejects_foreign_metadata_before_http(){
        let mut req=request();req.metadata_id="connector_foreign".into();let transport=Fixture::new(vec![]);
        let error=ChatgptService::default().plugin_app_delete_status_with(req,rpc,&transport).await.err().unwrap();
        assert_eq!(error.code,"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn app_delete_readback_failure_stays_pending_without_retrying_write(){
        for status in [403,503] {let mut values=replies();values[4]=(status,json!({}));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"accepted");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(deletes(&transport),1);}
    }
    #[tokio::test]
    async fn app_delete_workspace_tenant_content_blocks_write_and_ip_rejection_is_not_replayed(){
        let mut values=replies();values[1].1["owners"][0]["id"]=json!("membership");values[2].1["accounts"][0]["structure"]=json!("workspace");
        values.insert(3,(200,json!({"apps":[{"id":META,"name":"Hosted","distribution_channel":"TENANT_CATALOG"}]})));
        let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(deletes(&transport),0);assert_eq!(transport.sent.lock().unwrap().len(),4);
        let mut values=replies();values[3]=(401,json!({"error":{"code":"workspace_ip_not_authorized"}}));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_delete_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"rejected");assert_eq!(result.body["warningCode"],"ip_not_authorized");assert_eq!(deletes(&transport),1);
    }
    #[tokio::test]
    async fn app_delete_identity_and_cancellation_after_write_never_return_old_absence(){
        struct Interrupt<'a>{service:&'a ChatgptService,fixture:Fixture,cancel:bool}
        impl Transport for Interrupt<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{let write=request.method==HttpMethod::Delete;let result=self.fixture.send(request,cancel).await;if write{if self.cancel{self.service.cancel("app-delete-fixture");}else{self.service.invalidate();self.service.invalidate();}}result})}}
        for cancel in [false,true] {let service=ChatgptService::default();let transport=Interrupt{service:&service,fixture:Fixture::new(replies()),cancel};let error=service.plugin_app_delete_with(request(),rpc,&transport).await.err().unwrap();assert_eq!(error.code,if cancel{"cancelled"}else{"account_changed"});assert_eq!(deletes(&transport.fixture),1);assert_eq!(transport.fixture.sent.lock().unwrap().len(),4);}
    }
}
