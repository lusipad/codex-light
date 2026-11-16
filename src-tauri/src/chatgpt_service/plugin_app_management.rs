//! Fresh standalone app name/description eligibility, without write operations.
use super::*;

fn management_invalid()->ServiceError {failure("invalid_response","Standalone app management metadata is incomplete")}
struct ManagementMetadata {
    public:Value,
    owners:Vec<(String,String)>,
    custom_mcp:bool,
    disabled_by_admin:bool,
}

fn management_metadata(value:Value,app_id:&str)->ServiceResult<ManagementMetadata> {
    let source=value.as_object().ok_or_else(management_invalid)?;
    let id=source.get("id").and_then(Value::as_str).ok_or_else(management_invalid)?;
    if plugin_app_link_permissions::link_permission_normalize(id)!=plugin_app_link_permissions::link_permission_normalize(app_id) {return Err(management_invalid());}
    let name=source.get("name").and_then(Value::as_str).ok_or_else(management_invalid)?;
    let kind=source.get("connector_type").and_then(Value::as_str).ok_or_else(management_invalid)?;
    let status=source.get("status").and_then(Value::as_str).ok_or_else(management_invalid)?;
    let mut public=serde_json::Map::new();public.insert("id".into(),json!(id));public.insert("name".into(),json!(name));
    if let Some(description)=source.get("description") {
        if !description.is_null() && !description.is_string() {return Err(management_invalid());}
        public.insert("description".into(),description.clone());
    }
    let mut owners=Vec::new();
    for owner in source.get("owners").and_then(Value::as_array).ok_or_else(management_invalid)? {
        let kind=owner.get("type").and_then(Value::as_str).ok_or_else(management_invalid)?;
        let id=owner.get("id").and_then(Value::as_str).ok_or_else(management_invalid)?;
        owners.push((kind.to_owned(),id.to_owned()));
    }
    let development=match source.get("app_metadata") {
        None|Some(Value::Null)=>false,
        Some(metadata)=>match metadata.as_object().ok_or_else(management_invalid)?.get("review") {
            None|Some(Value::Null)=>false,
            Some(review)=>match review.as_object().ok_or_else(management_invalid)?.get("status") {
                None|Some(Value::Null)=>false,
                Some(status)=>status.as_str().ok_or_else(management_invalid)?=="DEVELOPMENT",
            },
        },
    };
    Ok(ManagementMetadata{public:Value::Object(public),owners,custom_mcp:kind=="MCP" && (status=="ONLY_ME" || development),disabled_by_admin:status=="DISABLED_BY_ADMIN"})
}

fn management_permissions(metadata:&ManagementMetadata,accounts:&Value,identity:&ServiceIdentity)->ServiceResult<(bool,bool)> {
    // P21–23 validate normalized wham arrays and choose the first ordered row.
    plugin_permissions::permission_personal(accounts,identity)?;
    let selected=accounts["account_ordering"].as_array().and_then(|values|values.first()).and_then(Value::as_str).ok_or_else(management_invalid)?;
    let account=accounts["accounts"].as_array().and_then(|values|values.iter().find(|row|row["id"].as_str()==Some(selected))).ok_or_else(management_invalid)?;
    let structure=account["structure"].as_str().ok_or_else(management_invalid)?;
    let membership=account["account_user_id"].as_str().ok_or_else(management_invalid)?;
    let current=selected==identity.account_id;
    let workspace=structure=="workspace" && current;
    // MC02 el has no extra structure condition. WORKSPACE ownership separately
    // requires workspace; description's current-admin branch does not.
    let admin=current && matches!(account["account_user_role"].as_str(),Some("account-admin"|"account-owner"));
    let owner_id=if structure=="personal" {identity.user_id.as_str()}else{membership};
    let owner=current && metadata.owners.iter().any(|(kind,id)|kind=="USER" && id==owner_id || workspace && admin && kind=="WORKSPACE" && id==&identity.account_id);
    Ok((metadata.custom_mcp && owner,metadata.custom_mcp && !metadata.disabled_by_admin && (owner || admin)))
}

impl ChatgptService {
    pub async fn plugin_app_management_read<F,Fut>(&self,request:PluginAppEntryRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_app_management_with(request,call,&CurlTransport).await}
    async fn plugin_app_management_with<F,Fut,T>(&self,request:PluginAppEntryRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(&request.request_id)?;
        let body=self.plugin_app_management_snapshot(&request,&registration,&call,transport).await?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:request.expected_identity,body})
    }

    pub(super) async fn plugin_app_management_snapshot<F,Fut,T>(&self,request:&PluginAppEntryRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let encoded=encode_segment(&request.app_id)?;
        let identity=&request.expected_identity;
        let association=self.remote_plugin_http(&format!("/backend-api/ps/plugins/canonical-app/{encoded}"),HttpMethod::Get,false,
            identity,&request.profile,&registration,&call,transport).await?;
        let association=association.as_object().and_then(|body|body.get("plugin_id")).ok_or_else(management_invalid)?;
        if !association.is_null() {
            if !association.as_str().is_some_and(|id|!id.trim().is_empty() && encode_segment(id).is_ok()) {return Err(management_invalid());}
            self.check_share_current(identity,&registration)?;
            return Err(failure("app_managed_by_plugin","App is now managed by a service plugin"));
        }
        let metadata=self.plugin_app_metadata_http(&format!("/backend-api/aip/connectors/{encoded}?include_actions=true"),
            identity,&request.profile,&registration,&call,transport).await?;
        let metadata=management_metadata(metadata,&request.app_id)?;
        let account_request=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:identity.clone(),profile:request.profile.clone()};
        let accounts=self.permission_http("/backend-api/wham/accounts/check",HttpMethod::Get,&account_request,&registration,&call,transport).await?;
        let (can_name,can_description)=management_permissions(&metadata,&accounts,identity)?;
        self.check_share_current(identity,&registration)?;
        Ok(json!({"appId":request.app_id,"metadata":metadata.public,"canEditName":can_name,"canEditDescription":can_description}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const APP:&str="asdk_app_x/y?z#%中文";
    const META:&str="connector_x/y?z#%中文";
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"manage-account".into(),user_id:"manage-user".into(),generation:0}}
    fn request()->PluginAppEntryRequest {PluginAppEntryRequest{request_id:"app-management-fixture".into(),expected_identity:identity(),app_id:APP.into(),profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()}}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"manage-account","user_id":"manage-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"manage-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn accounts()->Value {json!({"accounts":[{"id":"manage-account","account_user_id":"workspace-membership","account_user_role":"standard-user","structure":"personal","plan_type":"future-plan","is_zdr":false,"is_openai_internal":false,"email":"never-return"}],"account_ordering":["manage-account"]})}
    fn metadata()->Value {json!({"id":META,"name":"Actual app","description":" Actual description ","connector_type":"MCP","status":"ONLY_ME","owners":[{"type":"USER","id":"manage-user","secret":"never-return"}],"secret":"never-return","token":"never-return"})}
    fn replies()->Vec<(u16,Value)> {vec![(200,json!({"plugin_id":null})),(200,metadata()),(200,accounts())]}
    struct Fixture{replies:Mutex<VecDeque<(u16,Value)>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture{fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture{fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);let(status,body)=self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request");Ok(HttpResponse{status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})})}}
    #[tokio::test]
    async fn app_management_personal_owner_uses_original_get_id_and_returns_only_public_fields(){
        let transport=Fixture::new(replies());let result=ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body,json!({"appId":APP,"metadata":{"id":META,"name":"Actual app","description":" Actual description "},"canEditName":true,"canEditDescription":true}));
        let text=serde_json::to_string(&result).unwrap();assert!(!text.contains("never-return")&&!text.contains("workspace-membership")&&!text.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),3);assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/ps/plugins/canonical-app/asdk_app_x%2Fy%3Fz%23%25%E4%B8%AD%E6%96%87");
        assert_eq!(sent[0].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[0].headers["X-Codex-Surface"],"other");
        assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/aip/connectors/asdk_app_x%2Fy%3Fz%23%25%E4%B8%AD%E6%96%87?include_actions=true");assert_eq!(sent[1].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[1].headers["X-Codex-Surface"],"settings");
        assert!(sent[2].url.ends_with("/wham/accounts/check"));assert!(sent.iter().all(|request|request.method==HttpMethod::Get && request.body.is_empty()));
    }
    #[tokio::test]
    async fn app_management_description_preserves_missing_null_and_empty(){
        for description in [None,Some(Value::Null),Some(json!(""))] {let mut values=replies();match &description{None=>{values[1].1.as_object_mut().unwrap().remove("description");},Some(value)=>values[1].1["description"]=value.clone()};
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["metadata"].get("description"),description.as_ref());}
    }
    #[tokio::test]
    async fn app_management_user_owner_uses_personal_user_or_workspace_membership_identity(){
        for (structure,owner,name,description) in [("personal","manage-user",true,true),("personal","workspace-membership",false,false),("workspace","workspace-membership",true,true),("workspace","manage-user",false,false)] {
            let mut values=replies();values[2].1["accounts"][0]["structure"]=json!(structure);values[1].1["owners"][0]["id"]=json!(owner);let transport=Fixture::new(values);
            let result=ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["canEditName"],name);assert_eq!(result.body["canEditDescription"],description);
        }
    }
    #[tokio::test]
    async fn app_management_workspace_owner_requires_current_admin_but_description_has_its_own_admin_branch(){
        for (structure,role,owner,name,description) in [("workspace","account-admin","manage-account",true,true),("workspace","account-owner","manage-account",true,true),("workspace","standard-user","manage-account",false,false),
            ("workspace","account-admin","other-workspace",false,true),("personal","account-owner","manage-account",false,true)] {
            let mut values=replies();values[2].1["accounts"][0]["structure"]=json!(structure);values[2].1["accounts"][0]["account_user_role"]=json!(role);values[1].1["owners"]=json!([{"type":"WORKSPACE","id":owner}]);
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["canEditName"],name,"{structure}/{role}/{owner}");assert_eq!(result.body["canEditDescription"],description);
        }
    }
    #[tokio::test]
    async fn app_management_review_development_and_disabled_name_description_gates_are_not_uniform(){
        for (kind,status,review,name,description) in [("MCP","ACTIVE",Some("DEVELOPMENT"),true,true),("MCP","DISABLED_BY_ADMIN",Some("DEVELOPMENT"),true,false),("MCP","ACTIVE",None,false,false),("SERVICE","ONLY_ME",Some("DEVELOPMENT"),false,false)] {
            let mut values=replies();values[1].1["connector_type"]=json!(kind);values[1].1["status"]=json!(status);if let Some(review)=review{values[1].1["app_metadata"]=json!({"review":{"status":review,"secret":"never-return"}});}
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["canEditName"],name);assert_eq!(result.body["canEditDescription"],description);assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        }
    }
    #[tokio::test]
    async fn app_management_selected_account_mismatch_denies_both_without_using_any_other_row(){
        let mut values=replies();values[2].1["accounts"][0]["id"]=json!("other-account");values[2].1["account_ordering"]=json!(["other-account"]);let transport=Fixture::new(values);
        let result=ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["canEditName"],false);assert_eq!(result.body["canEditDescription"],false);
    }
    #[tokio::test]
    async fn app_management_requires_explicit_null_association_and_matching_connector(){
        for (association,code) in [(json!({"plugin_id":"actual-plugin"}),"app_managed_by_plugin"),(json!({}),"invalid_response"),(json!({"plugin_id":false}),"invalid_response")] {
            let transport=Fixture::new(vec![(200,association)]);assert_eq!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,code);assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let mut values=replies();values[1].1["id"]=json!("connector_other");values.truncate(2);let transport=Fixture::new(values);assert_eq!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");
    }
    #[tokio::test]
    async fn app_management_unknown_owner_type_or_bad_account_shape_is_not_successful_no_privilege(){
        for field in ["owners","connector_type","status"] {let mut values=replies();values[1].1.as_object_mut().unwrap().remove(field);values.truncate(2);let transport=Fixture::new(values);assert_eq!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");}
        for field in ["type","id"] {let mut values=replies();values[1].1["owners"][0].as_object_mut().unwrap().remove(field);values.truncate(2);let transport=Fixture::new(values);assert_eq!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");}
        for accounts in [json!({"accounts":{},"account_ordering":["manage-account"]}),json!({"accounts":[{"id":"manage-account"}],"account_ordering":["manage-account"]})] {
            let mut values=replies();values[2].1=accounts;let transport=Fixture::new(values);assert_eq!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
    }
    #[tokio::test]
    async fn app_management_reads_refresh_401_once_and_stop_on_ip_denial(){
        for stage in 0..3 {let mut values=replies();values.insert(stage,(401,json!({})));let transport=Fixture::new(values);assert!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.is_ok());assert_eq!(transport.sent.lock().unwrap().len(),4);}
        let transport=Fixture::new(vec![(401,json!({"error":{"code":"workspace_ip_not_authorized"}}))]);assert_eq!(ChatgptService::default().plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,"ip_not_authorized");assert_eq!(transport.sent.lock().unwrap().len(),1);
    }
    #[tokio::test]
    async fn app_management_generation_aba_after_metadata_never_returns_old_eligibility(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{let metadata=request.url.contains("/aip/connectors/");let result=self.fixture.send(request,cancel).await;if metadata{self.service.invalidate();self.service.invalidate();}result})}}
        let service=ChatgptService::default();let transport=Invalidate{service:&service,fixture:Fixture::new(replies())};assert_eq!(service.plugin_app_management_with(request(),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),2);
    }
    #[tokio::test]
    async fn app_management_cancel_interrupts_read_and_does_not_return_default_permissions(){
        struct Wait{entered:AtomicBool}
        impl Transport for Wait{fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancel"))})}}
        let service=ChatgptService::default();let transport=Wait{entered:AtomicBool::new(false)};
        let(result,())=tokio::time::timeout(Duration::from_secs(5),async{tokio::join!(service.plugin_app_management_with(request(),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("app-management-fixture"));})}).await.expect("management read must enter and cancel transport");
        assert_eq!(result.err().unwrap().code,"cancelled");assert!(service.active.lock().unwrap().is_empty());
    }
}
