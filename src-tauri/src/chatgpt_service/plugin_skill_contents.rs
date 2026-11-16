//! Read-only hosted skill contents; download links and credentials stay private.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginSkillContentsRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub plugin_id:String,
    pub skill_name:String,
}

fn skill_contents_projection(body:Value)->ServiceResult<Value> {
    let invalid=||failure("invalid_response","Hosted skill contents are incomplete");
    let source=body.as_object().ok_or_else(invalid)?;
    let mut selected=serde_json::Map::new();
    for key in ["name","description","skill_md_contents"] {
        if let Some(value)=source.get(key) {
            if !value.is_null() && !value.is_string() {return Err(invalid());}
            selected.insert(key.into(),value.clone());
        }
    }
    if let Some(value)=source.get("interface") {
        let value=if value.is_null(){Value::Null}else{
            let source=value.as_object().ok_or_else(invalid)?;let mut interface=serde_json::Map::new();
            if let Some(value)=source.get("display_name") {
                if !value.is_null() && !value.is_string() {return Err(invalid());}
                interface.insert("display_name".into(),value.clone());
            }
            Value::Object(interface)
        };
        selected.insert("interface".into(),value);
    }
    Ok(Value::Object(selected))
}

impl ChatgptService {
    pub async fn plugin_skill_contents_read<F,Fut>(&self,request:PluginSkillContentsRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_skill_contents_with(request,call,&CurlTransport).await
    }
    async fn plugin_skill_contents_with<F,Fut,T>(&self,request:PluginSkillContentsRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let plugin=encode_segment(&request.plugin_id)?;let skill=encode_segment(&request.skill_name)?;
        let registration=self.register(&request.request_id)?;
        // SK14/15 JzMC.cH: settings, chatgpt product context, no download URLs.
        let route=format!("/backend-api/ps/plugins/{plugin}/skills/{skill}?includeDownloadUrls=false");
        let response=self.remote_plugin_http_context(&route,HttpMethod::Get,RemotePluginHttpContext::SkillContents,&request.expected_identity,
            &request.profile,&registration,&call,transport).await?;
        let contents=skill_contents_projection(response)?;
        self.check_share_current(&request.expected_identity,&registration)?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:request.expected_identity,body:json!({"pluginId":request.plugin_id,"skillName":request.skill_name,"contents":contents})})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"skill-account".into(),user_id:"skill-user".into(),generation:0}}
    fn request()->PluginSkillContentsRequest {PluginSkillContentsRequest{request_id:"skill-contents-fixture".into(),expected_identity:identity(),plugin_id:"raw/id?中%2F".into(),skill_name:"skill/name?#%中文".into(),profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()}}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"skill-account","user_id":"skill-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"skill-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn contents()->Value {json!({"name":"Stored name","description":"Stored description","interface":{"display_name":"Displayed name","secret":"never-return"},"skill_md_contents":"# Title\n\nActual body\n",
        "download_url":"https://example.test/never-return","credential":"never-return","path":"never-return"})}
    struct Fixture {replies:Mutex<VecDeque<(u16,Value)>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture {fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture {fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);let(status,body)=self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request");Ok(HttpResponse{status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})})}}
    #[tokio::test]
    async fn skill_contents_fixed_get_encodes_each_original_segment_once_and_projects_public_fields(){
        let transport=Fixture::new(vec![(200,contents())]);let result=ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.request_id,"skill-contents-fixture");assert_eq!(result.identity,identity());assert_eq!(result.body["pluginId"],"raw/id?中%2F");assert_eq!(result.body["skillName"],"skill/name?#%中文");
        assert_eq!(result.body["contents"],json!({"name":"Stored name","description":"Stored description","interface":{"display_name":"Displayed name"},"skill_md_contents":"# Title\n\nActual body\n"}));
        let serialized=serde_json::to_string(&result).unwrap();assert!(!serialized.contains("never-return")&&!serialized.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),1);assert_eq!(sent[0].method,HttpMethod::Get);assert!(sent[0].body.is_empty());
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/ps/plugins/raw%2Fid%3F%E4%B8%AD%252F/skills/skill%2Fname%3F%23%25%E4%B8%AD%E6%96%87?includeDownloadUrls=false");
        assert_eq!(sent[0].headers["OAI-Product-Sku"],"PROMPT_TEXT_AREA");assert_eq!(sent[0].headers["X-Codex-Surface"],"settings");
    }
    #[tokio::test]
    async fn skill_contents_preserves_missing_null_and_empty_without_permission_guess(){
        for source in [json!({}),json!({"name":null,"description":null,"interface":null,"skill_md_contents":null}),json!({"name":"","description":"","interface":{"display_name":""},"skill_md_contents":""})] {
            let transport=Fixture::new(vec![(200,source.clone())]);let result=ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["contents"],source);
        }
    }
    #[tokio::test]
    async fn skill_contents_malformed_response_is_not_empty_markdown_success(){
        for body in [Value::Null,json!([]),json!("text"),json!({"name":false}),json!({"description":[]}),json!({"interface":false}),json!({"interface":{"display_name":{}}}),json!({"skill_md_contents":false})] {
            let transport=Fixture::new(vec![(200,body)]);assert_eq!(ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }
    #[tokio::test]
    async fn skill_contents_403_404_and_server_failures_never_fallback_or_return_contents(){
        for (status,code) in [(403,"forbidden"),(404,"not_found"),(503,"service_unavailable")] {
            let transport=Fixture::new(vec![(status,json!({}))]);let error=ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.err().unwrap();
            if status!=503 {assert_eq!(error.code,code);}assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
    }
    #[tokio::test]
    async fn skill_contents_invalid_paths_and_stale_account_do_not_send(){
        for invalid in ["","..","bad\nname"] {
            for skill in [false,true] {let transport=Fixture::new(vec![]);let mut request=request();if skill{request.skill_name=invalid.into();}else{request.plugin_id=invalid.into();}
                assert_eq!(ChatgptService::default().plugin_skill_contents_with(request,rpc,&transport).await.err().unwrap().code,"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());}
        }
        let transport=Fixture::new(vec![]);let mut request=request();request.expected_identity.account_id="other-account".into();
        assert_eq!(ChatgptService::default().plugin_skill_contents_with(request,rpc,&transport).await.err().unwrap().code,"account_changed");assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn skill_contents_auth_401_refreshes_once_and_ip_denial_stops(){
        let transport=Fixture::new(vec![(401,json!({})),(200,contents())]);assert!(ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.is_ok());
        {let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);assert_eq!(sent[0].url,sent[1].url);assert_eq!(sent[1].headers["OAI-Product-Sku"],"PROMPT_TEXT_AREA");}
        let transport=Fixture::new(vec![(401,json!({})),(401,json!({}))]);assert!(ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),2);
        let transport=Fixture::new(vec![(401,json!({"error":{"code":"workspace_ip_not_authorized"}}))]);assert_eq!(ChatgptService::default().plugin_skill_contents_with(request(),rpc,&transport).await.err().unwrap().code,"ip_not_authorized");assert_eq!(transport.sent.lock().unwrap().len(),1);
    }
    #[tokio::test]
    async fn skill_contents_generation_aba_drops_old_body_and_new_generation_can_read(){
        struct Invalidate<'a>(&'a ChatgptService);
        impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&contents()).unwrap()})})}}
        let service=ChatgptService::default();assert_eq!(service.plugin_skill_contents_with(request(),rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
        let mut next=request();next.expected_identity.generation=service.generation();let transport=Fixture::new(vec![(200,contents())]);
        assert!(service.plugin_skill_contents_with(next,rpc,&transport).await.is_ok());
    }
    #[tokio::test]
    async fn skill_contents_cancel_interrupts_transport_and_releases_registration(){
        struct Wait{entered:AtomicBool}
        impl Transport for Wait{fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancelled"))})}}
        let service=ChatgptService::default();let transport=Wait{entered:AtomicBool::new(false)};
        let(result,())=tokio::time::timeout(Duration::from_secs(5),async{tokio::join!(service.plugin_skill_contents_with(request(),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("skill-contents-fixture"));})}).await.expect("contents reader must enter and cancel transport");
        assert_eq!(result.err().unwrap().code,"cancelled");assert!(service.active.lock().unwrap().is_empty());
    }
}
