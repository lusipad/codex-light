//! Hosted app sync reads and user-only disable requests. No synthetic progress.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginAppSyncRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub plugin_id:String,
    pub app_id:Option<String>,
    pub selected_link_id:Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"sync-account".into(),user_id:"sync-user".into(),generation:0}}
    fn request()->PluginAppSyncRequest {PluginAppSyncRequest{request_id:"sync-fixture".into(),expected_identity:identity(),
        profile:ServiceProfile{language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()},
        plugin_id:"plugin-real".into(),app_id:Some("asdk_app_real".into()),selected_link_id:Some("link-a".into())}}
    fn disable()->PluginAppSyncDisableRequest {let r=request();PluginAppSyncDisableRequest{request_id:r.request_id,expected_identity:r.expected_identity,profile:r.profile,plugin_id:r.plugin_id,app_id:r.app_id.unwrap(),selected_link_id:r.selected_link_id,connection_instance_id:"connection-a".into(),backing_link_id:Some("link-a".into())}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"sync-account","user_id":"sync-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"sync-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn accounts()->Value {json!({"accounts":[{"id":"sync-account","account_user_id":"membership","account_user_role":"standard-user","structure":"personal","plan_type":"future-plan","is_zdr":false,"is_openai_internal":false}],"account_ordering":["sync-account"]})}
    fn plugin()->Value {json!({"id":"plugin-real","name":"Plugin","status":"DISABLED_BY_ADMIN","release":{"app_ids":["asdk_app_real"]}})}
    fn metadata()->Value {json!({"id":"asdk_app_real","name":"App","enable_multi_links":true})}
    fn link(id:&str)->Value {json!({"id":id,"connector_id":"connector_real","name":"Account","owners":[{"type":"USER","id":"not-current-user"}],"auth_status":"ACTIVE"})}
    fn status(link:Option<&str>,connection:&str)->Value {json!({"user_connection_details":{"auth_status":"user_connected","connector_id":"connector_real","backing_link_id":link,"connection_instance_id":connection,
        "connection_type":"future","knowledge_connector_type":"future","activation_status":"activated","last_full_sync_completed_at":"2026-11-16T02:00:00Z","last_delta_sync_completed_at":1730000000,"secret":"never-return"},"secret":"never-return"})}
    fn read_replies()->Vec<(u16,Value)> {vec![(200,accounts()),(200,plugin()),(200,metadata()),(200,json!({"links":[link("link-a"),link("link-b")]})),
        (200,json!({"connection_statuses":[status(Some("link-a"),"connection-a"),status(Some("link-b"),"connection-b")]}))]}
    fn write_replies()->Vec<(u16,Value)> {let mut values=read_replies();values.push((204,Value::Null));values}
    struct Fixture {replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture {fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,value)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:if status==204 {vec![]}else{serde_json::to_vec(&value).unwrap()}})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture {fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    #[tokio::test]
    async fn sync_read_uses_selected_account_status_and_original_generic_headers(){
        let transport=Fixture::new(read_replies());let result=ChatgptService::default().plugin_app_sync_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["appId"],"asdk_app_real");assert_eq!(result.body["account"],json!({"id":"sync-account","structure":"personal"}));
        assert_eq!(result.body["statuses"].as_array().unwrap().len(),1);assert_eq!(result.body["statuses"][0]["user_connection_details"]["connection_instance_id"],"connection-a");
        let serialized=serde_json::to_string(&result).unwrap();assert!(!serialized.contains("never-return")&&!serialized.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),5);let get=&sent[4];assert_eq!(get.url,"https://chatgpt.com/backend-api/ca/v2/user/connection_status");assert_eq!(get.method,HttpMethod::Get);assert!(get.body.is_empty());
        assert!(!get.headers.contains_key("OAI-Product-Sku")&&!get.headers.contains_key("X-Codex-Surface"));assert!(get.headers.contains_key("Authorization"));
    }
    #[tokio::test]
    async fn sync_multi_selection_and_single_default_do_not_leak_other_links(){
        for (multi,selected,expected) in [(true,"link-b","connection-b"),(false,"link-b","connection-a"),(true,"missing","connection-a")] {
            let mut replies=read_replies();replies[2].1["enable_multi_links"]=json!(multi);let mut request=request();request.selected_link_id=Some(selected.into());
            let transport=Fixture::new(replies);assert_eq!(ChatgptService::default().plugin_app_sync_with(request,rpc,&transport).await.unwrap().body["statuses"][0]["user_connection_details"]["connection_instance_id"],expected);
        }
        let mut replies=read_replies();replies[3].1["links"][0]["auth_status"]=json!("REAUTH_REQUIRED");let mut request=request();request.selected_link_id=None;
        let transport=Fixture::new(replies);assert_eq!(ChatgptService::default().plugin_app_sync_with(request,rpc,&transport).await.unwrap().body["statuses"][0]["user_connection_details"]["connection_instance_id"],"connection-b");
    }
    #[test]
    fn sync_admin_mapping_and_dwd_follow_the_four_exact_ids(){
        for (admin,app) in [("connector_1ee51bd730c272434e1b17c46f8a2397","connector_69c18c28f1188191bf5b8445c4ab0a2e"),("connector_bef400199679ee9f67f080058d5c9e89","connector_4aaab2856305417b993eca9a216aaf6e"),("connector_5ae2fd76f08447718080f11bc2faac6c","connector_1e4f6a44acf14e3ca1d96672f8c945bc"),("connector_601cc22bb3b740599c7274cf7e8084e8","connector_246af0940da3457da0e751171dc1ce60")] {
            let mut row=status(None,"admin");row["user_connection_details"]["auth_status"]=json!("admin_connected");row["user_connection_details"]["connector_id"]=json!(admin);
            assert!(sync_matches(app,None,false,&row));assert!(!sync_matches("connector_unrelated",None,true,&row));
            row["user_connection_details"]["auth_status"]=json!("future");row["user_connection_details"]["knowledge_connector_type"]=json!("google_drive_dwd");
            row["user_connection_details"]["activation_status"]=json!("partially_activated");assert!(sync_matches(app,None,false,&row));
            row["user_connection_details"]["auth_status"]=json!("admin_managed_disconnected");assert!(!sync_matches(app,None,true,&row));
            row["user_connection_details"]["auth_status"]=json!("future");row["user_connection_details"]["activation_status"]=json!("activating");assert!(!sync_matches(app,None,true,&row));
        }
    }
    #[test]
    fn sync_legacy_fallback_is_limited_to_exact_provider_and_no_backing(){
        let gmail="connector_2128aebfecb84f64a069897515042a44";let outlook="connector_4aaab2856305417b993eca9a216aaf6e";
        let mut row=status(None,"legacy");row["user_connection_details"]["connection_type"]=json!("gmail_sync_connector");
        assert!(sync_matches(gmail,None,true,&row));assert!(!sync_matches(gmail,None,false,&row));assert!(!sync_matches(outlook,None,true,&row));
        row["user_connection_details"]["backing_link_id"]=json!("other-link");assert!(!sync_matches(gmail,None,true,&row));
        row["user_connection_details"]["backing_link_id"]=Value::Null;row["user_connection_details"]["connector_id"]=Value::Null;
        row["user_connection_details"]["auth_status"]=json!("admin_connected");row["user_connection_details"]["connection_type"]=json!("outlook_admin_sync_connector");
        assert!(sync_matches(outlook,None,true,&row));assert!(!sync_matches(outlook,None,false,&row));
        row["user_connection_details"]["connector_id"]=json!("connector_other");assert!(!sync_matches(outlook,None,true,&row));
    }
    #[tokio::test]
    async fn sync_disable_routes_by_real_selected_account_not_owner_or_multi(){
        for structure in ["personal","workspace"] {
            let mut replies=write_replies();replies[0].1["accounts"][0]["structure"]=json!(structure);replies[2].1["enable_multi_links"]=json!(false);
            let transport=Fixture::new(replies);let result=ChatgptService::default().plugin_app_sync_disable_with(disable(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["delivery"],"accepted");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),6);let post=&sent[5];assert_eq!(post.method,HttpMethod::Post);
            assert_eq!(post.url,if structure=="personal" {"https://chatgpt.com/backend-api/ca/v2/user/delete_synced"}else{"https://chatgpt.com/backend-api/ca/v2/user/disconnect"});
            assert_eq!(serde_json::from_slice::<Value>(&post.body).unwrap(),if structure=="personal" {json!({"link_id":"link-a"})}else{json!({"connection_id":"connection-a"})});
            assert!(!post.headers.contains_key("OAI-Product-Sku")&&!post.headers.contains_key("X-Codex-Surface"));
        }
    }
    #[tokio::test]
    async fn sync_selected_wham_mismatch_can_read_but_cannot_write(){
        let mut replies=read_replies();replies[0].1["accounts"][0]["id"]=json!("another-account");replies[0].1["account_ordering"]=json!(["another-account"]);
        let transport=Fixture::new(replies.clone());let result=ChatgptService::default().plugin_app_sync_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["account"]["id"],"another-account");
        let transport=Fixture::new(replies);assert_eq!(ChatgptService::default().plugin_app_sync_disable_with(disable(),rpc,&transport).await.err().unwrap().code,"forbidden");assert_eq!(transport.sent.lock().unwrap().len(),5);
    }
    #[tokio::test]
    async fn sync_disable_rejects_admin_wrong_pair_duplicate_or_unselected_target(){
        for case in ["admin","wrongpair","duplicate","other-selected","hidden"] {
            let mut replies=read_replies();let mut request=disable();match case {
                "admin"=>replies[4].1["connection_statuses"][0]["user_connection_details"]["auth_status"]=json!("admin_connected"),
                "wrongpair"=>request.backing_link_id=Some("link-b".into()),
                "duplicate"=>{let duplicate=replies[4].1["connection_statuses"][0].clone();replies[4].1["connection_statuses"].as_array_mut().unwrap().push(duplicate);},
                "other-selected"=>request.selected_link_id=Some("link-b".into()),"hidden"=>replies[3].1["links"][0]["visibility"]=json!("HIDDEN"),_=>unreachable!(),
            }
            let transport=Fixture::new(replies);assert!(ChatgptService::default().plugin_app_sync_disable_with(request,rpc,&transport).await.is_err(),"{case}");assert_eq!(transport.sent.lock().unwrap().len(),5);
        }
    }
    #[tokio::test]
    async fn sync_personal_backing_allows_empty_connection_but_workspace_does_not(){
        for structure in ["personal","workspace"] {
            let mut replies=write_replies();replies[0].1["accounts"][0]["structure"]=json!(structure);replies[4].1["connection_statuses"][0]["user_connection_details"]["connection_instance_id"]=json!("");
            if structure!="personal" {replies.truncate(5);}let transport=Fixture::new(replies);let mut request=disable();request.connection_instance_id="".into();
            let result=ChatgptService::default().plugin_app_sync_disable_with(request,rpc,&transport).await;
            if structure=="personal" {assert_eq!(result.unwrap().body["delivery"],"accepted");}else{assert_eq!(result.err().unwrap().code,"forbidden");}
        }
    }
    #[tokio::test]
    async fn sync_personal_legacy_without_backing_uses_connection_disconnect(){
        let app="connector_2128aebfecb84f64a069897515042a44";let mut replies=write_replies();replies[1].1["release"]["app_ids"]=json!([app]);replies[2].1["id"]=json!(app);replies[3].1["links"]=json!([]);
        let mut legacy=status(None,"legacy-connection");legacy["user_connection_details"]["connection_type"]=json!("gmail_sync_connector");replies[4].1["connection_statuses"]=json!([legacy]);
        let mut request=disable();request.app_id=app.into();request.selected_link_id=None;request.connection_instance_id="legacy-connection".into();request.backing_link_id=None;
        let transport=Fixture::new(replies);assert_eq!(ChatgptService::default().plugin_app_sync_disable_with(request,rpc,&transport).await.unwrap().body["delivery"],"accepted");
        let sent=transport.sent.lock().unwrap();assert!(sent[5].url.ends_with("/ca/v2/user/disconnect"));assert_eq!(serde_json::from_slice::<Value>(&sent[5].body).unwrap(),json!({"connection_id":"legacy-connection"}));
    }
    #[tokio::test]
    async fn sync_malformed_status_or_unknown_links_are_not_empty_success(){
        for field in ["auth_status","connection_instance_id","connector_id","backing_link_id"] {
            let mut replies=read_replies();replies[4].1["connection_statuses"][0]["user_connection_details"].as_object_mut().unwrap().remove(field);
            let transport=Fixture::new(replies);assert_eq!(ChatgptService::default().plugin_app_sync_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
        for bad in [Value::Null,json!({}),json!({"connection_statuses":false}),json!({"connection_statuses":[{}]})] {
            let mut replies=read_replies();replies[4].1=bad;let transport=Fixture::new(replies);assert!(ChatgptService::default().plugin_app_sync_with(request(),rpc,&transport).await.is_err());
        }
        let mut replies=read_replies();replies[3]=(503,json!({}));replies.truncate(4);let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_sync_with(request(),rpc,&transport).await.err().unwrap().code,"plugin_sync_links_unavailable");assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn sync_unknown_delivery_stays_pending_and_never_replays_post(){
        for status in [408,503] {let mut replies=write_replies();replies[5]=(status,json!({}));let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_app_sync_disable_with(disable(),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(transport.sent.lock().unwrap().len(),6);}
        let transport=Fixture::new(write_replies());transport.replies.lock().unwrap()[5]=Err(failure("network_error","fixture timeout"));
        assert_eq!(ChatgptService::default().plugin_app_sync_disable_with(disable(),rpc,&transport).await.unwrap().body["delivery"],"unknown");assert_eq!(transport.sent.lock().unwrap().len(),6);
    }
    #[tokio::test]
    async fn sync_explicit_401_refreshes_once_while_ip_or_forbidden_stops(){
        let mut replies=write_replies();replies[5]=(401,json!({}));replies.push((204,Value::Null));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_sync_disable_with(disable(),rpc,&transport).await.unwrap().body["delivery"],"accepted");assert_eq!(transport.sent.lock().unwrap().len(),7);
        for (status,body,code) in [(403,json!({}),"forbidden"),(401,json!({"error":{"code":"workspace_ip_not_authorized"}}),"ip_not_authorized")] {
            let mut replies=write_replies();replies[5]=(status,body);let transport=Fixture::new(replies);
            assert_eq!(ChatgptService::default().plugin_app_sync_disable_with(disable(),rpc,&transport).await.err().unwrap().code,code);assert_eq!(transport.sent.lock().unwrap().len(),6);
        }
    }
    #[tokio::test]
    async fn sync_identity_change_or_cancel_during_post_does_not_ack(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {let post=request.url.ends_with("/delete_synced");let result=self.fixture.send(request,cancel).await;if post {self.service.invalidate();}result})}}
        let service=ChatgptService::default();let transport=Invalidate{service:&service,fixture:Fixture::new(write_replies())};
        assert_eq!(service.plugin_app_sync_disable_with(disable(),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),6);
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move {
            if request.url.ends_with("/delete_synced") {self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))}else{self.fixture.send(request,cancel).await}
        })}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(write_replies()),entered:AtomicBool::new(false)};
        let(result,())=tokio::join!(service.plugin_app_sync_disable_with(disable(),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("sync-fixture"));});
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),5);
    }
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginAppSyncDisableRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub plugin_id:String,
    pub app_id:String,
    pub selected_link_id:Option<String>,
    pub connection_instance_id:String,
    pub backing_link_id:Option<String>,
}

fn sync_invalid()->ServiceError {failure("invalid_response","Plugin sync data is incomplete")}

fn sync_account(body:&Value,identity:&ServiceIdentity)->ServiceResult<Value> {
    // Reuse the normalized wham schema/first ordering validator, not its
    // permission-specific personal predicate as a sync authorization gate.
    plugin_permissions::permission_personal(body,identity)?;
    let selected=body["account_ordering"].as_array().and_then(|values|values.first()).and_then(Value::as_str);
    let account=body["accounts"].as_array().and_then(|values|values.iter().find(|row|row["id"].as_str()==selected));
    Ok(account.map(|account|json!({"id":account["id"],"structure":account["structure"]})).unwrap_or(Value::Null))
}

fn sync_statuses(body:Value)->ServiceResult<Vec<Value>> {
    let rows=body.get("connection_statuses").and_then(Value::as_array).ok_or_else(sync_invalid)?;
    let mut statuses=Vec::new();
    for row in rows {
        let source=row.get("user_connection_details").and_then(Value::as_object).ok_or_else(sync_invalid)?;
        let mut details=serde_json::Map::new();
        for key in ["auth_status","connection_instance_id"] {
            let value=source.get(key).filter(|value|value.is_string()).ok_or_else(sync_invalid)?;
            details.insert(key.into(),value.clone());
        }
        for key in ["connector_id","backing_link_id"] {
            let value=source.get(key).filter(|value|value.is_null() || value.is_string()).ok_or_else(sync_invalid)?;
            details.insert(key.into(),value.clone());
        }
        for key in ["connection_type","knowledge_connector_type","activation_status"] {
            if let Some(value)=source.get(key) {
                if !value.is_null() && !value.is_string() {return Err(sync_invalid());}
                details.insert(key.into(),value.clone());
            }
        }
        for key in ["last_full_sync_completed_at","last_delta_sync_completed_at"] {
            if let Some(value)=source.get(key) {
                if !value.is_null() && !value.is_string() && !value.is_number() {return Err(sync_invalid());}
                details.insert(key.into(),value.clone());
            }
        }
        statuses.push(json!({"user_connection_details":details}));
    }
    Ok(statuses)
}

fn sync_selected<'a>(details:&'a Value,selected:Option<&str>)->ServiceResult<(Option<&'a Value>,bool)> {
    let links=details["links"].as_array().ok_or_else(||failure("plugin_sync_links_unavailable","Linked accounts unavailable for sync"))?;
    let links:Vec<_>=links.iter().filter(|link|link["visibility"]!="HIDDEN" && !link["id"].as_str().unwrap_or("").starts_with("implicit_link::")).collect();
    let multi=details["connector"]["enable_multi_links"]==true;
    let selected=if multi {selected.and_then(|id|links.iter().copied().find(|link|link["id"].as_str()==Some(id)))} else {None};
    Ok((selected.or_else(||links.iter().copied().find(|link|link["auth_status"]!="REAUTH_REQUIRED")).or_else(||links.first().copied()),!multi || links.len()<=1))
}

fn sync_admin_app(details:&Value)->Option<String> {
    if details["auth_status"]!="admin_connected" && !(details["knowledge_connector_type"]=="google_drive_dwd"
        && details["auth_status"]!="admin_managed_disconnected" && matches!(details["activation_status"].as_str(),Some("activated"|"partially_activated"))) {return None;}
    let id=plugin_app_link_permissions::link_permission_normalize(details["connector_id"].as_str()?);
    Some(match id.as_str() {
        "connector_1ee51bd730c272434e1b17c46f8a2397"=>"connector_69c18c28f1188191bf5b8445c4ab0a2e".into(),
        "connector_bef400199679ee9f67f080058d5c9e89"=>"connector_4aaab2856305417b993eca9a216aaf6e".into(),
        "connector_5ae2fd76f08447718080f11bc2faac6c"=>"connector_1e4f6a44acf14e3ca1d96672f8c945bc".into(),
        "connector_601cc22bb3b740599c7274cf7e8084e8"=>"connector_246af0940da3457da0e751171dc1ce60".into(),
        _=>id,
    })
}

fn sync_matches(app_id:&str,selected:Option<&Value>,legacy:bool,status:&Value)->bool {
    let app=plugin_app_link_permissions::link_permission_normalize(app_id);
    let details=&status["user_connection_details"];
    if details["auth_status"]=="user_connected" {
        return if let Some(backing)=details["backing_link_id"].as_str() {
            selected.is_some_and(|link|link["id"].as_str()==Some(backing) && link["connector_id"].as_str().is_some_and(|id|plugin_app_link_permissions::link_permission_normalize(id)==app))
        } else {legacy && app=="connector_2128aebfecb84f64a069897515042a44" && details["connection_type"]=="gmail_sync_connector"};
    }
    if let Some(mapped)=sync_admin_app(details) {return mapped==app;}
    details["auth_status"]=="admin_connected" && legacy && app=="connector_4aaab2856305417b993eca9a216aaf6e"
        && details["connection_type"]=="outlook_admin_sync_connector" && details["backing_link_id"].is_null()
}

impl ChatgptService {
    pub async fn plugin_app_sync_read<F,Fut>(&self,request:PluginAppSyncRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_app_sync_with(request,call,&CurlTransport).await
    }

    async fn plugin_app_sync_with<F,Fut,T>(&self,request:PluginAppSyncRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        encode_segment(&request.plugin_id)?;if let Some(id)=&request.app_id {encode_segment(id)?;}
        let registration=self.register(&request.request_id)?;
        let common=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity,profile:request.profile};
        let body=self.plugin_sync_snapshot(&common,&request.plugin_id,request.app_id.as_deref(),request.selected_link_id.as_deref(),&registration,&call,transport).await?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:common.expected_identity,body})
    }

    #[allow(clippy::too_many_arguments)]
    async fn plugin_sync_snapshot<F,Fut,T>(&self,common:&PluginPermissionsRequest,plugin_id:&str,app_id:Option<&str>,selected:Option<&str>,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let accounts=self.permission_http("/backend-api/wham/accounts/check",HttpMethod::Get,common,registration,call,transport).await?;
        let account=sync_account(&accounts,&common.expected_identity)?;
        let app_id=self.resolve_service_plugin_app(plugin_id,app_id,common,registration,call,transport).await?;
        let request=PluginAppDetailsRequest{request_id:common.request_id.clone(),expected_identity:common.expected_identity.clone(),profile:common.profile.clone(),plugin_id:plugin_id.into(),app_id:app_id.clone()};
        let details=self.plugin_app_snapshot(&request,registration,call,transport).await?;
        let (selected,legacy)=sync_selected(&details,selected)?;
        let response=self.plugin_sync_http("/backend-api/ca/v2/user/connection_status",None,common,registration,call,transport).await?;
        let statuses:Vec<_>=sync_statuses(response)?.into_iter().filter(|status|sync_matches(&app_id,selected,legacy,status)).collect();
        self.check_share_current(&common.expected_identity,registration)?;
        Ok(json!({"appId":app_id,"details":details,"account":account,"statuses":statuses}))
    }

    pub async fn plugin_app_sync_disable<F,Fut>(&self,request:PluginAppSyncDisableRequest,call:F)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_app_sync_disable_with(request,call,&CurlTransport).await
    }

    async fn plugin_app_sync_disable_with<F,Fut,T>(&self,request:PluginAppSyncDisableRequest,call:F,transport:&T)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        encode_segment(&request.plugin_id)?;encode_segment(&request.app_id)?;
        let registration=self.register(&request.request_id)?;
        let common=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity,profile:request.profile};
        let before=self.plugin_sync_snapshot(&common,&request.plugin_id,Some(&request.app_id),request.selected_link_id.as_deref(),&registration,&call,transport).await?;
        if before["account"]["id"].as_str()!=Some(common.expected_identity.account_id.as_str()) {return Err(failure("forbidden","Current account cannot disable this sync"));}
        let mut targets=before["statuses"].as_array().ok_or_else(sync_invalid)?.iter().filter(|status| {
            let details=&status["user_connection_details"];
            details["connection_instance_id"].as_str()==Some(request.connection_instance_id.as_str()) && details["backing_link_id"].as_str()==request.backing_link_id.as_deref()
        });
        let target=targets.next().ok_or_else(||failure("not_found","Selected sync connection is unavailable"))?;
        if targets.next().is_some() {return Err(sync_invalid());}
        let target=&target["user_connection_details"];
        if target["auth_status"]!="user_connected" {return Err(failure("forbidden","Administrator-managed sync cannot be disabled here"));}
        let personal=before["account"]["structure"]=="personal";
        let (route,body)=if personal && request.backing_link_id.is_some() {
            ("/backend-api/ca/v2/user/delete_synced",json!({"link_id":request.backing_link_id}))
        } else {
            if request.connection_instance_id.is_empty() {return Err(failure("forbidden","Sync connection identity unavailable"));}
            ("/backend-api/ca/v2/user/disconnect",json!({"connection_id":request.connection_instance_id}))
        };
        let delivery=match self.plugin_sync_http(route,Some(&body),&common,&registration,&call,transport).await {
            Ok(_)=>"accepted",Err(error) if error.code=="plugin_sync_write_unknown"=>"unknown",Err(error)=>return Err(error),
        };
        self.check_share_current(&common.expected_identity,&registration)?;
        Ok(ProfileMutationResponse{request_id:request.request_id,identity:common.expected_identity,body:json!({"delivery":delivery}),readback:Value::Null,verification:"pending"})
    }

    async fn plugin_sync_http<F,Fut,T>(&self,route:&str,body:Option<&Value>,request:&PluginPermissionsRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let identity=&request.expected_identity;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Sync request cancelled; a sent write may already have applied")),
            result=async {
                let mut session=self.session.lock().await;self.prepare(&mut session,identity.generation,call,false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity,registration)?;let credentials=session.credentials.as_ref().unwrap();
                    if &credentials.identity!=identity {return Err(failure("account_changed","Authenticated identity changed"));}
                    let integrity=session.integrity.clone();let mut outgoing=build_http_request(route,credentials,integrity.as_deref(),&request.profile)?;
                    if let Some(body)=body {outgoing.method=HttpMethod::Post;outgoing.headers.insert("Content-Type".into(),"application/json".into());outgoing.body=serde_json::to_vec(body).unwrap();}
                    share_network_allowed(call,&outgoing.url).await?;self.check_share_current(identity,registration)?;
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await
                        .map_err(|error|if body.is_some() {failure("plugin_sync_write_unknown","Sync disable outcome unknown; read before retrying")} else {error})?;
                    self.check_share_current(identity,registration)?;apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {return Err(ServiceError{code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
                    if response.status==401 && attempt==0 {self.prepare(&mut session,identity.generation,call,true).await?;continue;}
                    if body.is_some() {
                        if response.status>=500 || response.status==408 {return Err(failure("plugin_sync_write_unknown","Sync disable outcome unknown; read before retrying"));}
                        if (200..300).contains(&response.status) {return Ok(Value::Null);}
                    }
                    return Ok(decode_response(response,registration.id.clone(),identity.clone())?.body);
                }
                unreachable!()
            }=>result,
        };
        self.check_share_current(identity,registration)?;result
    }
}
