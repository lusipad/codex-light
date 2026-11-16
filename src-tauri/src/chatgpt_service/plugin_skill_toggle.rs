//! Service skill toggles use fresh scope and authoritative inventory readback.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginSkillToggleRequest {
    pub request_id:String,pub expected_identity:ServiceIdentity,pub profile:ServiceProfile,
    pub plugin_id:String,pub skill_name:String,pub enabled:bool,
}

fn toggle_invalid()->ServiceError {failure("invalid_response","Service skill state is incomplete")}
fn toggle_state(rows:&[Value],request:&PluginSkillToggleRequest)->ServiceResult<Value> {
    let installed=rows.iter().find(|row|row["id"].as_str()==Some(request.plugin_id.as_str())).filter(|row|row.get("enabled").is_some());
    let disabled=match installed.and_then(|row|row.get("disabled_skill_names")) {
        None=>None,
        Some(value)=>{
            let values=value.as_array().ok_or_else(toggle_invalid)?;
            if !values.iter().all(Value::is_string) {return Err(toggle_invalid());}Some(values)
        },
    };
    Ok(json!({"pluginId":request.plugin_id,"skillName":request.skill_name,"installed":installed.is_some(),"disabledListKnown":disabled.is_some(),
        "checked":disabled.map(|names|!names.iter().any(|name|name.as_str()==Some(request.skill_name.as_str())))}))
}
fn toggle_app_ids(plugin:&Value)->ServiceResult<Vec<String>> {
    let release=plugin.get("release").and_then(Value::as_object).ok_or_else(toggle_invalid)?;
    let ids=|value:Option<&Value>|->ServiceResult<Vec<String>> {
        match value {None|Some(Value::Null)=>Ok(vec![]),Some(value)=>value.as_array().ok_or_else(toggle_invalid)?.iter().map(|id| {
            let id=id.as_str().ok_or_else(toggle_invalid)?;encode_segment(id)?;Ok(plugin_app_link_permissions::link_permission_normalize(id))
        }).collect()}
    };
    let mut apps=ids(release.get("app_ids"))?;
    if let Some(templates)=release.get("app_templates").filter(|value|!value.is_null()) {
        for template in templates.as_array().ok_or_else(toggle_invalid)? {
            let template=template.as_object().ok_or_else(toggle_invalid)?;apps.extend(ids(template.get("materialized_app_ids"))?);
        }
    }
    let mut seen=std::collections::HashSet::new();apps.retain(|id|seen.insert(id.clone()));Ok(apps)
}

impl ChatgptService {
    pub async fn plugin_skill_toggle<F,Fut>(&self,request:PluginSkillToggleRequest,call:F)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {self.plugin_skill_toggle_with(request,call,&CurlTransport).await}
    async fn plugin_skill_toggle_with<F,Fut,T>(&self,request:PluginSkillToggleRequest,call:F,transport:&T)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(&request.request_id)?;
        let before=self.plugin_skill_toggle_preflight(&request,&registration,&call,transport).await;
        self.check_share_current(&request.expected_identity,&registration)?;
        let before=match before {
            Ok(state)=>state,
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error)=>return Ok(ProfileMutationResponse{request_id:request.request_id,identity:request.expected_identity,
                body:json!({"delivery":"not_sent","warningCode":error.code}),readback:Value::Null,verification:"pending"}),
        };
        if before["checked"].as_bool()==Some(request.enabled) {
            return Ok(ProfileMutationResponse{request_id:request.request_id,identity:request.expected_identity,
                body:json!({"delivery":"not_sent","warningCode":null}),readback:before,verification:"confirmed"});
        }
        let route=format!("/backend-api/ps/plugins/{}/skills/{}/{}",encode_segment(&request.plugin_id)?,encode_segment(&request.skill_name)?,if request.enabled{"enable"}else{"disable"});
        let write=self.remote_plugin_http(&route,HttpMethod::Post,false,&request.expected_identity,&request.profile,&registration,&call,transport).await;
        self.check_share_current(&request.expected_identity,&registration)?;
        let (delivery,mut warning)=match write {
            Ok(_)=>("accepted",None),
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error) if error.status.is_some_and(|status|(400..500).contains(&status) && status!=408)=>("rejected",Some(error.code)),
            // A server rejection differs from uncertain delivery. Both may
            // refresh state, but neither is proof that the request was not sent.
            Err(error)=>("unknown",Some(error.code)),
        };
        let read=self.remote_plugin_pages(&request.expected_identity,&request.profile,true,&registration,&call,transport).await
            .and_then(|rows|toggle_state(&rows,&request));
        self.check_share_current(&request.expected_identity,&registration)?;
        let readback=match read {
            Ok(state)=>state,
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(_)=>{warning.get_or_insert("plugin_skill_readback_unavailable");Value::Null},
        };
        let confirmed=delivery!="rejected" && readback["installed"]==true && readback["disabledListKnown"]==true && readback["checked"].as_bool()==Some(request.enabled);
        Ok(ProfileMutationResponse{request_id:request.request_id,identity:request.expected_identity,
            body:json!({"delivery":delivery,"warningCode":warning}),readback,verification:if confirmed{"confirmed"}else{"pending"}})
    }

    async fn plugin_skill_toggle_preflight<F,Fut,T>(&self,request:&PluginSkillToggleRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let plugin_id=encode_segment(&request.plugin_id)?;encode_segment(&request.skill_name)?;
        let plugin=self.remote_plugin_http(&format!("/backend-api/ps/plugins/{plugin_id}"),HttpMethod::Get,false,&request.expected_identity,&request.profile,registration,call,transport).await?;
        validate_remote_plugin_row(&plugin)?;
        if plugin["id"].as_str()!=Some(request.plugin_id.as_str()) {return Err(toggle_invalid());}
        let skills=plugin["release"]["skills"].as_array().ok_or_else(||failure("plugin_skill_not_in_plugin","Skill is absent from the current plugin release"))?;
        let mut matches=0;
        for skill in skills {
            let name=skill.get("name").and_then(Value::as_str).filter(|name|!name.is_empty()).ok_or_else(toggle_invalid)?;
            if name==request.skill_name {matches+=1;}
        }
        if matches==0 {return Err(failure("plugin_skill_not_in_plugin","Skill is absent from the current plugin release"));}
        if matches!=1 {return Err(toggle_invalid());}
        let inventory=self.remote_plugin_pages(&request.expected_identity,&request.profile,true,registration,call,transport).await?;
        let state=toggle_state(&inventory,request)?;
        if state["installed"]!=true {return Err(failure("plugin_not_installed","Service plugin is not installed"));}
        if plugin["status"]=="DISABLED_BY_ADMIN" {return Err(failure("forbidden","Plugin is disabled by the administrator"));}
        if request.enabled && state["checked"]!=true {
            let apps=toggle_app_ids(&plugin)?;
            if !apps.is_empty() {
                let accessible=self.review_gitlab_http("/backend-api/aip/connectors/links/list_accessible",true,&request.expected_identity,&request.profile,registration,call,transport).await?;
                let mut usable=false;
                for app in apps {
                    let links=plugin_app_details::app_details_links(&app,accessible.clone())?;
                    for link in links.as_array().ok_or_else(toggle_invalid)? {
                        if link["visibility"]=="HIDDEN" || link["id"].as_str().is_some_and(|id|id.starts_with("implicit_link::")) || link["auth_status"]!="REAUTH_REQUIRED" {usable=true;}
                    }
                }
                if !usable {return Err(failure("plugin_skill_connection_required","An app connection is required before enabling this skill"));}
            }
        }
        self.check_share_current(&request.expected_identity,registration)?;Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PLUGIN:&str="raw/plugin?%中";const SKILL:&str="raw/skill?#%中";
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"toggle-account".into(),user_id:"toggle-user".into(),generation:0}}
    fn request(enabled:bool)->PluginSkillToggleRequest {PluginSkillToggleRequest{request_id:"skill-toggle-fixture".into(),expected_identity:identity(),plugin_id:PLUGIN.into(),skill_name:SKILL.into(),enabled,profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()}}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"toggle-account","user_id":"toggle-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"business"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"toggle-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn plugin()->Value {json!({"id":PLUGIN,"name":"Public plugin","status":"ENABLED","scope":"WORKSPACE","creator_account_user_id":"other-user","secret":"never-return",
        "release":{"app_ids":[],"skills":[{"name":SKILL,"description":"Public skill"}]}})}
    fn installed(checked:bool)->Value {let mut row=plugin();row["enabled"]=json!(false);row["installation_policy"]=json!("INSTALLED_BY_DEFAULT");row["disabled_skill_names"]=if checked {json!([])}else{json!([SKILL])};row}
    fn page(row:Option<Value>)->Value {json!({"plugins":row.into_iter().collect::<Vec<_>>(),"pagination":{"next_page_token":null}})}
    fn replies(before:bool,after:bool)->Vec<(u16,Value)> {vec![(200,plugin()),(200,page(Some(installed(before)))),(204,Value::Null),(200,page(Some(installed(after))))]}
    fn link(app:&str,id:&str,auth:&str)->Value {json!({"id":id,"connector_id":app,"auth_status":auth,"owners":[]})}
    struct Fixture {replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture {fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,body)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:if status==204 {vec![]}else{serde_json::to_vec(&body).unwrap()}})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture {fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    fn write_count(transport:&Fixture)->usize {transport.sent.lock().unwrap().iter().filter(|request|request.url.ends_with("/enable")||request.url.ends_with("/disable")).count()}
    #[tokio::test]
    async fn skill_toggle_fixed_post_and_readback_do_not_impose_personal_owner_or_plugin_enabled_gates(){
        for enabled in [true,false] {let transport=Fixture::new(replies(!enabled,enabled));let result=ChatgptService::default().plugin_skill_toggle_with(request(enabled),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"confirmed");assert_eq!(result.body,json!({"delivery":"accepted","warningCode":null}));assert_eq!(result.readback,json!({"pluginId":PLUGIN,"skillName":SKILL,"installed":true,"disabledListKnown":true,"checked":enabled}));
            let serialized=serde_json::to_string(&result).unwrap();assert!(!serialized.contains("never-return")&&!serialized.contains(&token()));let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),4);
            assert_eq!(sent[0].headers["OAI-Product-Sku"],"CODEX");assert_eq!(sent[0].headers["X-Codex-Surface"],"other");
            let post=&sent[2];assert_eq!(post.method,HttpMethod::Post);assert!(post.body.is_empty());assert!(!post.headers.contains_key("Content-Type"));assert_eq!(post.headers["OAI-Product-Sku"],"CONNECTOR_SETTING");assert_eq!(post.headers["X-Codex-Surface"],"other");
            assert_eq!(post.url,format!("https://chatgpt.com/backend-api/ps/plugins/raw%2Fplugin%3F%25%E4%B8%AD/skills/raw%2Fskill%3F%23%25%E4%B8%AD/{}",if enabled{"enable"}else{"disable"}));
        }
    }
    #[tokio::test]
    async fn skill_toggle_known_same_value_is_not_sent_but_missing_disabled_list_cannot_confirm(){
        let transport=Fixture::new(vec![(200,plugin()),(200,page(Some(installed(true))))]);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.verification,"confirmed");assert_eq!(write_count(&transport),0);
        let mut values=replies(false,true);values[1].1["plugins"][0].as_object_mut().unwrap().remove("disabled_skill_names");values[3].1["plugins"][0].as_object_mut().unwrap().remove("disabled_skill_names");
        let transport=Fixture::new(values);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"accepted");assert_eq!(result.verification,"pending");assert_eq!(result.readback["disabledListKnown"],false);assert!(result.readback["checked"].is_null());assert_eq!(write_count(&transport),1);
    }
    #[tokio::test]
    async fn skill_toggle_preflight_read_failure_is_known_not_sent_not_delivery_unknown(){
        for values in [vec![(503,json!({"error":{"message":"never-return"}}))],vec![(200,plugin()),(503,json!({}))]] {
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert!(result.body["warningCode"].is_string());assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(write_count(&transport),0);assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        }
    }
    #[tokio::test]
    async fn skill_toggle_fresh_skill_install_and_admin_failures_never_post(){
        for case in ["wrong-id","skill-missing","skill-duplicate","not-installed","no-enabled","admin","bad-disabled"] {
            let mut values=vec![(200,plugin()),(200,page(Some(installed(false))))];match case{
                "wrong-id"=>{values[0].1["id"]=json!("other-plugin");values.truncate(1);},"skill-missing"=>{values[0].1["release"]["skills"]=json!([]);values.truncate(1);},
                "skill-duplicate"=>{let duplicate=values[0].1["release"]["skills"][0].clone();values[0].1["release"]["skills"].as_array_mut().unwrap().push(duplicate);values.truncate(1);},
                "not-installed"=>values[1].1=page(None),"no-enabled"=>{values[1].1["plugins"][0].as_object_mut().unwrap().remove("enabled");},
                "admin"=>values[0].1["status"]=json!("DISABLED_BY_ADMIN"),"bad-disabled"=>values[1].1["plugins"][0]["disabled_skill_names"]=json!(false),_=>unreachable!(),}
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent","{case}");assert!(result.body["warningCode"].is_string());assert_eq!(write_count(&transport),0);
        }
    }
    #[tokio::test]
    async fn skill_toggle_enable_accepts_normal_system_or_any_usable_app_without_all_links_connected(){
        for case in ["normal","hidden","implicit","second-usable"] {
            let mut values=replies(false,true);values[0].1["release"]["app_ids"]=json!(["asdk_app_a","connector_a","connector_b"]);
            let links=match case {"normal"=>vec![link("connector_a","a","ACTIVE")],"hidden"=>{let mut hidden=link("connector_a","hidden","REAUTH_REQUIRED");hidden["visibility"]=json!("HIDDEN");vec![hidden]},
                "implicit"=>vec![link("connector_a","implicit_link::a","REAUTH_REQUIRED")],_=>vec![link("connector_a","a","REAUTH_REQUIRED"),link("connector_b","b","ACTIVE")]};
            values.insert(2,(200,json!({"links":links})));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.verification,"confirmed","{case}");assert_eq!(write_count(&transport),1);assert_eq!(transport.sent.lock().unwrap().len(),5);
        }
    }
    #[tokio::test]
    async fn skill_toggle_needs_connection_and_unknown_links_reject_enable_without_mutation(){
        for links in [json!({"links":[]}),json!({"links":[link("connector_a","a","REAUTH_REQUIRED")]}),json!({"links":[link("connector_foreign","a","ACTIVE")]})] {
            let mut values=vec![(200,plugin()),(200,page(Some(installed(false)))),(200,links)];values[0].1["release"]["app_ids"]=json!(["connector_a"]);let transport=Fixture::new(values);
            let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.body["warningCode"],"plugin_skill_connection_required");assert_eq!(write_count(&transport),0);assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
        let mut values=vec![(200,plugin()),(200,page(Some(installed(false)))),(503,json!({}))];values[0].1["release"]["app_ids"]=json!(["connector_a"]);let transport=Fixture::new(values);
        assert_eq!(ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap().body["delivery"],"not_sent");assert_eq!(write_count(&transport),0);
    }
    #[tokio::test]
    async fn skill_toggle_disable_skips_links_and_unmaterialized_template_does_not_invent_app_gate(){
        let mut values=replies(true,false);values[0].1["release"]["app_ids"]=json!(["connector_a"]);let transport=Fixture::new(values);
        assert_eq!(ChatgptService::default().plugin_skill_toggle_with(request(false),rpc,&transport).await.unwrap().verification,"confirmed");assert_eq!(transport.sent.lock().unwrap().len(),4);
        let mut values=replies(false,true);values[0].1["release"]["app_templates"]=json!([{"can_setup":true}]);let transport=Fixture::new(values);
        assert_eq!(ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap().verification,"confirmed");assert_eq!(transport.sent.lock().unwrap().len(),4);
    }
    #[tokio::test]
    async fn skill_toggle_accepted_or_unknown_is_verified_only_by_complete_fresh_inventory(){
        for (status,after,expected) in [(204,true,"confirmed"),(503,true,"confirmed"),(408,false,"pending")] {
            let mut values=replies(false,after);values[2]=(status,Value::Null);let transport=Fixture::new(values);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();
            assert_eq!(result.verification,expected);assert_eq!(result.body["delivery"],if status==204 {"accepted"}else{"unknown"});assert_eq!(write_count(&transport),1);assert_eq!(transport.sent.lock().unwrap().len(),4);
        }
        let mut values=replies(false,true);values[3]=(503,json!({}));let transport=Fixture::new(values);let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(result.body["delivery"],"accepted");assert_eq!(write_count(&transport),1);
    }
    #[tokio::test]
    async fn skill_toggle_explicit_post_rejections_remain_rejected_after_readback(){
        for (status,after) in [(403,false),(404,false),(429,false),(400,true)] {
            let mut values=replies(false,after);values[2]=(status,json!({}));let transport=Fixture::new(values);
            let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();
            assert_eq!(result.body["delivery"],"rejected","HTTP {status} is a known server rejection, not uncertain delivery");
            assert!(result.body["warningCode"].is_string());assert_eq!(result.verification,"pending");assert_eq!(result.readback["checked"],after);
            assert_eq!(write_count(&transport),1);assert_eq!(transport.sent.lock().unwrap().len(),4);
        }
    }
    #[tokio::test]
    async fn skill_toggle_unknown_transport_recovers_only_with_inventory_and_never_reposts(){
        let transport=Fixture::new(replies(false,true));transport.replies.lock().unwrap()[2]=Err(failure("network_error","never-return"));let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"confirmed");assert_eq!(write_count(&transport),1);assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
    }
    #[tokio::test]
    async fn skill_toggle_generation_change_after_post_does_not_return_success_or_read_old_scope(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{let writing=request.url.ends_with("/enable");let result=self.fixture.send(request,cancel).await;if writing {self.service.invalidate();self.service.invalidate();}result})}}
        let service=ChatgptService::default();let transport=Invalidate{service:&service,fixture:Fixture::new(replies(false,true))};assert_eq!(service.plugin_skill_toggle_with(request(true),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(write_count(&transport.fixture),1);assert_eq!(transport.fixture.sent.lock().unwrap().len(),3);
    }
    #[tokio::test]
    async fn skill_toggle_invalid_path_is_not_sent_and_stale_account_is_guard_error(){
        let transport=Fixture::new(vec![]);let mut invalid=request(true);invalid.skill_name="..".into();let result=ChatgptService::default().plugin_skill_toggle_with(invalid,rpc,&transport).await.unwrap();
        assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.body["warningCode"],"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());
        let transport=Fixture::new(vec![]);let mut stale=request(true);stale.expected_identity.account_id="other-account".into();
        assert_eq!(ChatgptService::default().plugin_skill_toggle_with(stale,rpc,&transport).await.err().unwrap().code,"account_changed");assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn skill_toggle_post_401_refreshes_once_but_ip_denial_does_not_repost(){
        let mut values=replies(false,true);values[2]=(401,json!({}));values.insert(3,(204,Value::Null));let transport=Fixture::new(values);
        let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.verification,"confirmed");assert_eq!(result.body["delivery"],"accepted");assert_eq!(write_count(&transport),2);
        let mut values=replies(false,false);values[2]=(401,json!({"error":{"code":"workspace_ip_not_authorized"}}));let transport=Fixture::new(values);
        let result=ChatgptService::default().plugin_skill_toggle_with(request(true),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"rejected");assert_eq!(result.body["warningCode"],"ip_not_authorized");assert_eq!(result.verification,"pending");assert_eq!(write_count(&transport),1);
    }
    #[tokio::test]
    async fn skill_toggle_cancel_after_post_starts_never_publishes_ack_or_reads_old_scope(){
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{
            if request.url.ends_with("/enable"){self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))}else{self.fixture.send(request,cancel).await}
        })}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(vec![(200,plugin()),(200,page(Some(installed(false))))]),entered:AtomicBool::new(false)};
        let(result,())=tokio::time::timeout(Duration::from_secs(5),async{tokio::join!(service.plugin_skill_toggle_with(request(true),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("skill-toggle-fixture"));})}).await.expect("toggle must enter and cancel its mutation transport");
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),2);assert!(service.active.lock().unwrap().is_empty());
    }
}
