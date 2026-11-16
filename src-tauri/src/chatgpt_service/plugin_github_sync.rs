//! GitHub sync configuration bound to a fresh plugin, selected link and status.
use super::*;

const MAX_REPOSITORY_ID:u64=9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginGithubSyncRequest {
    pub request_id:String,pub expected_identity:ServiceIdentity,pub profile:ServiceProfile,
    pub plugin_id:String,pub app_id:Option<String>,pub resolved_app_id:String,
    pub selected_link_id:Option<String>,pub connection_instance_id:String,pub backing_link_id:String,
}

#[cfg(test)]
mod tests {
    use super::*;
    const APP:&str="connector_76869538009648d5b282a4bb21c3d157";
    const RAW_APP:&str="asdk_app_76869538009648d5b282a4bb21c3d157";
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"github-account".into(),user_id:"github-user".into(),generation:0}}
    fn request()->PluginGithubSyncRequest {PluginGithubSyncRequest{request_id:"github-fixture".into(),expected_identity:identity(),profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()},
        plugin_id:"plugin-real".into(),app_id:Some(RAW_APP.into()),resolved_app_id:APP.into(),selected_link_id:Some("link-a".into()),connection_instance_id:"connection/a?b#%中文".into(),backing_link_id:"link-a".into()}}
    fn search(query:&str,token:Option<&str>)->PluginGithubSyncSearchRequest {let r=request();PluginGithubSyncSearchRequest{request_id:r.request_id,expected_identity:r.expected_identity,profile:r.profile,plugin_id:r.plugin_id,app_id:r.app_id,resolved_app_id:r.resolved_app_id,selected_link_id:r.selected_link_id,connection_instance_id:r.connection_instance_id,backing_link_id:r.backing_link_id,query:query.into(),page_token:token.map(str::to_owned)}}
    fn write(repositories:Vec<PluginGithubSyncRepositoryChoice>)->PluginGithubSyncWriteRequest {let r=request();PluginGithubSyncWriteRequest{request_id:r.request_id,expected_identity:r.expected_identity,profile:r.profile,plugin_id:r.plugin_id,app_id:r.app_id,resolved_app_id:r.resolved_app_id,selected_link_id:r.selected_link_id,connection_instance_id:r.connection_instance_id,backing_link_id:r.backing_link_id,repositories}}
    fn choice(id:u64,query:Option<&str>)->PluginGithubSyncRepositoryChoice {PluginGithubSyncRepositoryChoice{id,query:query.map(str::to_owned),page_token:None}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"github-account","user_id":"github-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"github-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn snapshot()->Vec<(u16,Value)> {vec![
        (200,json!({"accounts":[{"id":"github-account","account_user_id":"membership","account_user_role":"standard-user","structure":"workspace","plan_type":"future-plan","is_zdr":false,"is_openai_internal":false}],"account_ordering":["github-account"]})),
        (200,json!({"id":"plugin-real","name":"Plugin","release":{"app_ids":[RAW_APP]}})),
        (200,json!({"id":RAW_APP,"name":"GitHub","enable_multi_links":true,"sync_metadata":{"user_allowed_to_sync":true,"secret":"never-return"}})),
        (200,json!({"links":[{"id":"link-a","connector_id":APP,"name":"Account","owners":[{"type":"USER","id":"other-user"}],"auth_status":"ACTIVE"}]})),
        (200,json!({"connection_statuses":[{"user_connection_details":{"auth_status":"admin_connected","connector_id":APP,"backing_link_id":"link-a","connection_instance_id":"connection/a?b#%中文","knowledge_connector_type":"github","activation_status":"activated"}}]})),
    ]}
    fn config()->Value {json!({"sync_enabled_objects":[{"object_type":"repository","object_id":"0001","object_name":"one","object_description":"First","secret":"never-return"}]})}
    fn read_replies()->Vec<(u16,Value)> {let mut replies=snapshot();replies.push((200,config()));replies}
    fn search_result()->Value {json!({"repos":[{"id":7,"repository_full_name":"org/seven","description":"Seven","secret":"never-return"},{"id":8,"repository_full_name":"org/eight"}],"next_token":""})}
    struct Fixture{replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture{fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,body)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:if status==204 {vec![]}else{serde_json::to_vec(&body).unwrap()}})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture{fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    #[tokio::test]
    async fn github_read_uses_real_scope_single_encoded_generic_configuration_get(){
        let transport=Fixture::new(read_replies());let result=ChatgptService::default().plugin_github_sync_read_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["appId"],RAW_APP);assert_eq!(result.body["linkId"],"link-a");assert_eq!(result.body["repositories"],json!([{"id":1,"name":"one","description":"First"}]));
        let text=serde_json::to_string(&result).unwrap();assert!(!text.contains("never-return")&&!text.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),6);let get=&sent[5];assert_eq!(get.method,HttpMethod::Get);
        assert_eq!(get.url,"https://chatgpt.com/backend-api/ca/v2/user/connection_instance/connection%2Fa%3Fb%23%25%E4%B8%AD%E6%96%87/user_configuration");
        assert!(!get.headers.contains_key("OAI-Product-Sku")&&!get.headers.contains_key("X-Codex-Surface"));
    }
    #[test]
    fn github_config_distinguishes_absent_optional_objects_from_invalid_saved_ids(){
        for body in [json!({}),json!({"sync_enabled_objects":null})] {assert!(configuration_repositories(body).unwrap().is_empty());}
        let values=configuration_repositories(json!({"sync_enabled_objects":[{"object_type":"folder","object_id":false},{"object_type":"repository","object_id":"0007"},{"object_type":"repository","object_id":7,"object_name":"ignored"}]})).unwrap();
        assert_eq!(values.len(),1);assert_eq!(values[0].id,7);assert_eq!(values[0].name,"0007");assert!(values[0].description.is_none());
        for bad in [json!({"sync_enabled_objects":false}),Value::Null,json!({"sync_enabled_objects":[{"object_type":"repository"}]}),json!({"sync_enabled_objects":[{"object_type":"repository","object_id":"oops"}]})] {assert!(configuration_repositories(bad).is_err());}
    }
    #[test]
    fn github_ids_are_exact_safe_nonnegative_integers_with_distinct_search_rules(){
        for valid in [json!(0),json!(MAX_REPOSITORY_ID),json!("0007")] {assert!(repository_id(&valid,true).is_ok());}
        for invalid in [json!(-1),json!(1.0),json!(MAX_REPOSITORY_ID+1),json!("-1"),json!(" 7"),json!("7.0"),json!("1e3"),json!(""),json!("18446744073709551616"),json!("NaN")] {assert!(repository_id(&invalid,true).is_err(),"{invalid}");}
        assert!(repository_id(&serde_json::from_str::<Value>("1e3").unwrap(),true).is_err());assert!(repository_id(&json!("7"),false).is_err());
    }
    #[tokio::test]
    async fn github_search_uses_trimmed_query_opaque_token_and_connector_setting_only(){
        let mut replies=snapshot();replies.push((200,search_result()));let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_github_sync_search_with(search("\u{feff} repo ",Some("opaque/+=")),rpc,&transport).await.unwrap();
        assert_eq!(result.body["nextToken"],"");assert_eq!(result.body["repositories"].as_array().unwrap().len(),2);
        let sent=transport.sent.lock().unwrap();let post=&sent[5];assert_eq!(post.method,HttpMethod::Post);assert!(post.url.ends_with("/aip/connectors/github/search_repos"));
        assert_eq!(post.headers["OAI-Product-Sku"],"CONNECTOR_SETTING");assert_eq!(post.headers["X-Codex-Surface"],"settings");
        assert_eq!(serde_json::from_slice::<Value>(&post.body).unwrap(),json!({"query":"repo","limit":20,"next_token":"opaque/+=","link_id":"link-a"}));
    }
    #[test]
    fn github_search_skips_missing_ids_but_rejects_unsupported_candidates_or_tokens(){
        let (repos,token)=search_repositories(json!({"repos":[{"id":null},{},{"id":0,"repository_full_name":"zero"},{"id":0,"repository_full_name":"second"}]})).unwrap();assert_eq!(repos.len(),1);assert_eq!(repos[0].id,0);assert!(token.is_none());
        for bad in [json!({"repos":[{"id":"7","repository_full_name":"seven"}]}),json!({"repos":[{"id":1}]}),json!({"repos":false}),json!({"repos":[],"next_token":1}),json!({"repos":[],"next_token":"bad\n"})] {assert!(search_repositories(bad).is_err());}
        assert!(github_token(Some("")).is_ok());assert!(github_token(Some(&"a".repeat(16*1024+1))).is_err());
    }
    #[tokio::test]
    async fn github_scope_checks_boolean_app_selected_link_and_unique_github_connection(){
        for case in ["gate","wrongapp","selected","connection","knowledge","duplicate"] {
            let mut replies=snapshot();let mut request=request();match case {
                "gate"=>replies[2].1["sync_metadata"]["user_allowed_to_sync"]=json!(false),"wrongapp"=>request.resolved_app_id="connector_other".into(),
                "selected"=>request.backing_link_id="link-b".into(),"connection"=>request.connection_instance_id="different".into(),
                "knowledge"=>replies[4].1["connection_statuses"][0]["user_connection_details"]["knowledge_connector_type"]=json!("other"),
                "duplicate"=>{let row=replies[4].1["connection_statuses"][0].clone();replies[4].1["connection_statuses"].as_array_mut().unwrap().push(row);},_=>unreachable!(),
            }
            let transport=Fixture::new(replies);assert!(ChatgptService::default().plugin_github_sync_read_with(request,rpc,&transport).await.is_err(),"{case}");assert_eq!(transport.sent.lock().unwrap().len(),5);
        }
        let mut replies=snapshot();replies[2].1["sync_metadata"]["user_allowed_to_sync"]=json!("true");replies.truncate(3);let transport=Fixture::new(replies);
        assert!(ChatgptService::default().plugin_github_sync_read_with(request(),rpc,&transport).await.is_err());
    }
    #[tokio::test]
    async fn github_write_rechecks_new_ids_with_one_search_per_query_token_group(){
        let mut replies=read_replies();replies.push((200,search_result()));replies.push((204,Value::Null));let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_github_sync_write_with(write(vec![choice(1,None),choice(7,Some(" repo ")),choice(8,Some("repo"))]),rpc,&transport).await.unwrap();
        assert_eq!(result.body["delivery"],"accepted");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),8);assert!(sent[6].url.ends_with("/search_repos"));let save=&sent[7];assert_eq!(save.method,HttpMethod::Post);assert_eq!(save.url,sent[5].url);
        assert!(!save.headers.contains_key("OAI-Product-Sku")&&!save.headers.contains_key("X-Codex-Surface"));assert_eq!(serde_json::from_slice::<Value>(&save.body).unwrap(),json!({"extension":{"type":"GithubUserApiExtension","opted_in_repository_ids":[1,7,8]}}));
    }
    #[tokio::test]
    async fn github_write_requires_current_baseline_or_proven_search_candidate(){
        let transport=Fixture::new(read_replies());assert_eq!(ChatgptService::default().plugin_github_sync_write_with(write(vec![choice(7,None)]),rpc,&transport).await.err().unwrap().code,"invalid_request");assert_eq!(transport.sent.lock().unwrap().len(),6);
        let mut replies=read_replies();replies.push((200,search_result()));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_github_sync_write_with(write(vec![choice(9,Some("repo"))]),rpc,&transport).await.err().unwrap().code,"forbidden");assert_eq!(transport.sent.lock().unwrap().len(),7);
        let mut replies=read_replies();replies[5].1["sync_enabled_objects"][0]["object_id"]=json!("bad-existing");let transport=Fixture::new(replies);
        assert!(ChatgptService::default().plugin_github_sync_write_with(write(vec![choice(1,None)]),rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),6);
    }
    #[tokio::test]
    async fn github_empty_oversize_duplicate_unsafe_or_bad_token_requests_never_send(){
        for choices in [vec![],(0..6).map(|id|choice(id,None)).collect(),vec![choice(1,None),choice(1,None)],vec![choice(MAX_REPOSITORY_ID+1,None)]] {
            let transport=Fixture::new(vec![]);assert_eq!(ChatgptService::default().plugin_github_sync_write_with(write(choices),rpc,&transport).await.err().unwrap().code,"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());
        }
        let transport=Fixture::new(vec![]);assert_eq!(ChatgptService::default().plugin_github_sync_search_with(search("",Some("bad\n")),rpc,&transport).await.err().unwrap().code,"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn github_save_unknown_delivery_never_replays_or_fabricates_readback(){
        for status in [408,503] {let mut replies=read_replies();replies.push((status,json!({})));let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_github_sync_write_with(write(vec![choice(1,None)]),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(transport.sent.lock().unwrap().len(),7);}
        let mut replies=read_replies();replies.push((204,Value::Null));let transport=Fixture::new(replies);transport.replies.lock().unwrap()[6]=Err(failure("network_error","fixture timeout"));
        assert_eq!(ChatgptService::default().plugin_github_sync_write_with(write(vec![choice(1,None)]),rpc,&transport).await.unwrap().body["delivery"],"unknown");assert_eq!(transport.sent.lock().unwrap().len(),7);
    }
    #[tokio::test]
    async fn github_search_401_refreshes_once_and_ip_denial_stops_without_unknown_write(){
        let mut replies=snapshot();replies.extend([(401,json!({})),(200,search_result())]);let transport=Fixture::new(replies);
        assert!(ChatgptService::default().plugin_github_sync_search_with(search("",None),rpc,&transport).await.is_ok());assert_eq!(transport.sent.lock().unwrap().len(),7);
        let mut replies=snapshot();replies.push((401,json!({"error":{"code":"workspace_ip_not_authorized"}})));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_github_sync_search_with(search("",None),rpc,&transport).await.err().unwrap().code,"ip_not_authorized");assert_eq!(transport.sent.lock().unwrap().len(),6);
    }
    #[tokio::test]
    async fn github_save_identity_change_and_cancel_do_not_ack(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{let saving=request.url.ends_with("/user_configuration") && request.method==HttpMethod::Post;let result=self.fixture.send(request,cancel).await;if saving {self.service.invalidate();}result})}}
        let service=ChatgptService::default();let mut replies=read_replies();replies.push((204,Value::Null));let transport=Invalidate{service:&service,fixture:Fixture::new(replies)};
        assert_eq!(service.plugin_github_sync_write_with(write(vec![choice(1,None)]),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),7);
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{if request.url.ends_with("/user_configuration") && request.method==HttpMethod::Post {self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancel"))}else{self.fixture.send(request,cancel).await}})}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(read_replies()),entered:AtomicBool::new(false)};
        let(result,())=tokio::join!(service.plugin_github_sync_write_with(write(vec![choice(1,None)]),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("github-fixture"));});
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),6);
    }
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginGithubSyncSearchRequest {
    pub request_id:String,pub expected_identity:ServiceIdentity,pub profile:ServiceProfile,
    pub plugin_id:String,pub app_id:Option<String>,pub resolved_app_id:String,
    pub selected_link_id:Option<String>,pub connection_instance_id:String,pub backing_link_id:String,
    pub query:String,pub page_token:Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginGithubSyncRepositoryChoice {pub id:u64,pub query:Option<String>,pub page_token:Option<String>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginGithubSyncWriteRequest {
    pub request_id:String,pub expected_identity:ServiceIdentity,pub profile:ServiceProfile,
    pub plugin_id:String,pub app_id:Option<String>,pub resolved_app_id:String,
    pub selected_link_id:Option<String>,pub connection_instance_id:String,pub backing_link_id:String,
    pub repositories:Vec<PluginGithubSyncRepositoryChoice>,
}

#[derive(Serialize)]
struct GithubRepository {id:u64,name:String,description:Option<String>}
struct GithubContext {common:PluginPermissionsRequest,app_id:String,link_id:String,connection_id:String}
fn github_invalid()->ServiceError {failure("invalid_response","GitHub sync data is unsupported or incomplete")}
fn github_trim(value:&str)->&str {value.trim_matches(|ch|matches!(ch,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))}
fn github_token(value:Option<&str>)->ServiceResult<()> {
    if value.is_some_and(|value|value.len()>16*1024 || value.chars().any(char::is_control)) {return Err(failure("invalid_request","Invalid GitHub repository page token"));}Ok(())
}
fn repository_id(value:&Value,allow_string:bool)->ServiceResult<u64> {
    let id=if let Some(value)=value.as_u64() {value} else if allow_string {
        let value=value.as_str().filter(|value|!value.is_empty() && value.bytes().all(|byte|byte.is_ascii_digit())).ok_or_else(github_invalid)?;
        value.parse::<u64>().map_err(|_|github_invalid())?
    } else {return Err(github_invalid());};
    if id>MAX_REPOSITORY_ID {return Err(github_invalid());}Ok(id)
}
fn repository_description(row:&Value,key:&str)->ServiceResult<Option<String>> {
    match row.get(key) {None|Some(Value::Null)=>Ok(None),Some(value)=>value.as_str().map(|value|Some(value.to_owned())).ok_or_else(github_invalid)}
}
fn configuration_repositories(body:Value)->ServiceResult<Vec<GithubRepository>> {
    let object=body.as_object().ok_or_else(github_invalid)?;
    let rows=match object.get("sync_enabled_objects") {None|Some(Value::Null)=>&[][..],Some(value)=>value.as_array().ok_or_else(github_invalid)?.as_slice()};
    let mut seen=std::collections::HashSet::new();let mut repositories=Vec::new();
    for row in rows {
        if row.get("object_type").and_then(Value::as_str)!=Some("repository") {continue;}
        let raw=row.get("object_id").ok_or_else(github_invalid)?;let id=repository_id(raw,true)?;
        if !seen.insert(id) {continue;}
        let name=match row.get("object_name") {None|Some(Value::Null)=>raw.as_str().map(str::to_owned).unwrap_or_else(||raw.to_string()),Some(value)=>value.as_str().ok_or_else(github_invalid)?.to_owned()};
        repositories.push(GithubRepository{id,name,description:repository_description(row,"object_description")?});
    }
    Ok(repositories)
}
fn search_repositories(body:Value)->ServiceResult<(Vec<GithubRepository>,Option<String>)> {
    let rows=body.get("repos").and_then(Value::as_array).ok_or_else(github_invalid)?;
    let mut repositories=Vec::new();let mut seen=std::collections::HashSet::new();
    for row in rows {
        let Some(raw)=row.get("id").filter(|value|!value.is_null()) else {continue;};
        let id=repository_id(raw,false)?;if !seen.insert(id) {continue;}
        let name=row.get("repository_full_name").and_then(Value::as_str).ok_or_else(github_invalid)?.to_owned();
        repositories.push(GithubRepository{id,name,description:repository_description(row,"description")?});
    }
    let token=match body.get("next_token") {None|Some(Value::Null)=>None,Some(value)=>Some(value.as_str().ok_or_else(github_invalid)?.to_owned())};
    github_token(token.as_deref()).map_err(|_|github_invalid())?;
    Ok((repositories,token))
}

impl ChatgptService {
    async fn github_context<F,Fut,T>(&self,request:&PluginGithubSyncRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<GithubContext>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        encode_segment(&request.plugin_id)?;encode_segment(&request.resolved_app_id)?;encode_segment(&request.connection_instance_id)?;encode_segment(&request.backing_link_id)?;
        let common=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity.clone(),profile:request.profile.clone()};
        let snapshot=self.plugin_sync_snapshot(&common,&request.plugin_id,request.app_id.as_deref(),request.selected_link_id.as_deref(),registration,call,transport).await?;
        let app_id=snapshot["appId"].as_str().ok_or_else(github_invalid)?;
        let normalize=plugin_app_link_permissions::link_permission_normalize;
        if normalize(app_id)!=normalize(&request.resolved_app_id) || normalize(app_id)!="connector_76869538009648d5b282a4bb21c3d157" || snapshot["details"]["connector"]["sync_metadata"]["user_allowed_to_sync"]!=true {
            return Err(failure("forbidden","GitHub sync configuration is unavailable for this app"));
        }
        let links=snapshot["details"]["links"].as_array().ok_or_else(github_invalid)?;
        let links:Vec<_>=links.iter().filter(|link|link["visibility"]!="HIDDEN" && !link["id"].as_str().unwrap_or("").starts_with("implicit_link::")).collect();
        let multi=snapshot["details"]["connector"]["enable_multi_links"]==true;
        let selected=if multi {request.selected_link_id.as_deref().and_then(|id|links.iter().copied().find(|link|link["id"].as_str()==Some(id)))} else {None};
        let selected=selected.or_else(||links.iter().copied().find(|link|link["auth_status"]!="REAUTH_REQUIRED")).or_else(||links.first().copied()).ok_or_else(||failure("not_found","GitHub sync linked account is unavailable"))?;
        if selected["id"].as_str()!=Some(request.backing_link_id.as_str()) {return Err(failure("not_found","GitHub sync selected account changed"));}
        if links.iter().filter(|link|link["id"]==selected["id"]).count()!=1 {return Err(github_invalid());}
        let mut statuses=snapshot["statuses"].as_array().ok_or_else(github_invalid)?.iter().filter(|status| {
            let details=&status["user_connection_details"];
            details["knowledge_connector_type"]=="github" && details["backing_link_id"].as_str()==Some(request.backing_link_id.as_str()) && details["connection_instance_id"].as_str()==Some(request.connection_instance_id.as_str())
        });
        if statuses.next().is_none() {return Err(failure("not_found","GitHub sync connection changed"));}
        if statuses.next().is_some() {return Err(github_invalid());}
        self.check_share_current(&common.expected_identity,registration)?;
        Ok(GithubContext{common,app_id:app_id.into(),link_id:request.backing_link_id.clone(),connection_id:request.connection_instance_id.clone()})
    }

    pub async fn plugin_github_sync_read<F,Fut>(&self,request:PluginGithubSyncRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_github_sync_read_with(request,call,&CurlTransport).await}
    async fn plugin_github_sync_read_with<F,Fut,T>(&self,request:PluginGithubSyncRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(&request.request_id)?;let context=self.github_context(&request,&registration,&call,transport).await?;
        let route=format!("/backend-api/ca/v2/user/connection_instance/{}/user_configuration",encode_segment(&context.connection_id)?);
        let repositories=configuration_repositories(self.plugin_sync_http(&route,None,&context.common,&registration,&call,transport).await?)?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:context.common.expected_identity,body:json!({"appId":context.app_id,"linkId":context.link_id,"connectionInstanceId":context.connection_id,"repositories":repositories})})
    }

    pub async fn plugin_github_sync_search<F,Fut>(&self,request:PluginGithubSyncSearchRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_github_sync_search_with(request,call,&CurlTransport).await}
    async fn plugin_github_sync_search_with<F,Fut,T>(&self,request:PluginGithubSyncSearchRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        github_token(request.page_token.as_deref())?;
        let scope=PluginGithubSyncRequest{request_id:request.request_id,expected_identity:request.expected_identity,profile:request.profile,plugin_id:request.plugin_id,app_id:request.app_id,resolved_app_id:request.resolved_app_id,selected_link_id:request.selected_link_id,connection_instance_id:request.connection_instance_id,backing_link_id:request.backing_link_id};
        let registration=self.register(&scope.request_id)?;let context=self.github_context(&scope,&registration,&call,transport).await?;
        let (repositories,next_token)=self.github_search_http(&context,github_trim(&request.query),request.page_token.as_deref(),&registration,&call,transport).await?;
        Ok(PluginPermissionsResponse{request_id:scope.request_id,identity:context.common.expected_identity,body:json!({"appId":context.app_id,"linkId":context.link_id,"connectionInstanceId":context.connection_id,"repositories":repositories,"nextToken":next_token})})
    }

    pub async fn plugin_github_sync_write<F,Fut>(&self,request:PluginGithubSyncWriteRequest,call:F)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_github_sync_write_with(request,call,&CurlTransport).await}
    async fn plugin_github_sync_write_with<F,Fut,T>(&self,request:PluginGithubSyncWriteRequest,call:F,transport:&T)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let mut seen=std::collections::HashSet::new();
        if request.repositories.is_empty() || request.repositories.len()>5 || request.repositories.iter().any(|repo|repo.id>MAX_REPOSITORY_ID || !seen.insert(repo.id)) {return Err(failure("invalid_request","Select 1 to 5 distinct supported repositories; empty selection requires sync disable confirmation"));}
        for repo in &request.repositories {github_token(repo.page_token.as_deref())?;}
        let scope=PluginGithubSyncRequest{request_id:request.request_id,expected_identity:request.expected_identity,profile:request.profile,plugin_id:request.plugin_id,app_id:request.app_id,resolved_app_id:request.resolved_app_id,selected_link_id:request.selected_link_id,connection_instance_id:request.connection_instance_id,backing_link_id:request.backing_link_id};
        let registration=self.register(&scope.request_id)?;let context=self.github_context(&scope,&registration,&call,transport).await?;
        let route=format!("/backend-api/ca/v2/user/connection_instance/{}/user_configuration",encode_segment(&context.connection_id)?);
        let baseline=configuration_repositories(self.plugin_sync_http(&route,None,&context.common,&registration,&call,transport).await?)?;
        let mut proofs=std::collections::HashMap::new();
        for repo in &request.repositories {
            if baseline.iter().any(|known|known.id==repo.id) {continue;}
            let query=github_trim(repo.query.as_deref().ok_or_else(||failure("invalid_request","New repository requires its actual search source"))?).to_owned();
            let key=(query,repo.page_token.clone());
            if !proofs.contains_key(&key) {
                let (repositories,_)=self.github_search_http(&context,&key.0,key.1.as_deref(),&registration,&call,transport).await?;
                proofs.insert(key.clone(),repositories);
            }
            if !proofs[&key].iter().any(|known|known.id==repo.id) {return Err(failure("forbidden","Repository is absent from the current search source"));}
        }
        let ids:Vec<_>=request.repositories.iter().map(|repo|repo.id).collect();
        let body=json!({"extension":{"type":"GithubUserApiExtension","opted_in_repository_ids":ids}});
        let delivery=match self.plugin_sync_http(&route,Some(&body),&context.common,&registration,&call,transport).await {
            Ok(_)=>"accepted",Err(error) if error.code=="plugin_sync_write_unknown"=>"unknown",Err(error)=>return Err(error),
        };
        self.check_share_current(&context.common.expected_identity,&registration)?;
        Ok(ProfileMutationResponse{request_id:scope.request_id,identity:context.common.expected_identity,body:json!({"delivery":delivery}),readback:Value::Null,verification:"pending"})
    }

    async fn github_search_http<F,Fut,T>(&self,context:&GithubContext,query:&str,token:Option<&str>,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<(Vec<GithubRepository>,Option<String>)>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let identity=&context.common.expected_identity;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","GitHub repository search cancelled")),
            result=async {
                let mut session=self.session.lock().await;self.prepare(&mut session,identity.generation,call,false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity,registration)?;let credentials=session.credentials.as_ref().unwrap();
                    if &credentials.identity!=identity {return Err(failure("account_changed","Authenticated identity changed"));}
                    let integrity=session.integrity.clone();let mut outgoing=build_http_request("/backend-api/aip/connectors/github/search_repos",credentials,integrity.as_deref(),&context.common.profile)?;
                    outgoing.method=HttpMethod::Post;outgoing.headers.insert("Content-Type".into(),"application/json".into());outgoing.headers.insert("OAI-Product-Sku".into(),"CONNECTOR_SETTING".into());outgoing.headers.insert("X-Codex-Surface".into(),"settings".into());
                    outgoing.body=serde_json::to_vec(&json!({"query":query,"limit":20,"next_token":token,"link_id":context.link_id})).unwrap();
                    share_network_allowed(call,&outgoing.url).await?;self.check_share_current(identity,registration)?;
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
                    self.check_share_current(identity,registration)?;apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {return Err(ServiceError{code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
                    if response.status==401 && attempt==0 {self.prepare(&mut session,identity.generation,call,true).await?;continue;}
                    return search_repositories(decode_response(response,registration.id.clone(),identity.clone())?.body);
                }
                unreachable!()
            }=>result,
        };
        self.check_share_current(identity,registration)?;result
    }
}
