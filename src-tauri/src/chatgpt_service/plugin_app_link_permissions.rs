//! Account-specific plugin permissions, scoped by current service membership.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginAppLinkPermissionsRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub plugin_id:String,
    pub app_id:Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginAppLinkPermissionWriteRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub plugin_id:String,
    pub app_id:String,
    pub link_id:String,
    #[serde(deserialize_with="deserialize_link_permission_value")]
    pub value:Value,
}

fn deserialize_link_permission_value<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Value,D::Error> {
    // A missing field must fail; only an explicitly supplied null resets it.
    Value::deserialize(deserializer)
}

pub(super) fn link_permission_normalize(id:&str)->String {
    id.strip_prefix("asdk_app_").map(|id|format!("connector_{id}")).unwrap_or_else(||id.to_owned())
}

fn link_permission_invalid()->ServiceError {failure("invalid_response","Plugin app permission metadata unavailable")}

fn link_permission_ids(value:Option<&Value>)->ServiceResult<Vec<&str>> {
    match value {
        None|Some(Value::Null)=>Ok(vec![]),
        Some(value)=>value.as_array().ok_or_else(link_permission_invalid)?.iter().map(|value|
            value.as_str().filter(|value|!value.is_empty()).ok_or_else(link_permission_invalid)).collect(),
    }
}

// CV1W.pS/Ok: preserve original IDs, count empty templates as null candidates,
// and consult the entire service inventory before selecting an implicit app.
fn link_permission_canonical(plugin:&Value,inventory:&[Value])->ServiceResult<Option<String>> {
    let release=match plugin.get("release") {None|Some(Value::Null)=>return Ok(None),Some(value)=>value.as_object().ok_or_else(link_permission_invalid)?};
    let templates=match release.get("app_templates") {None|Some(Value::Null)=>&[][..],Some(value)=>value.as_array().ok_or_else(link_permission_invalid)?.as_slice()};
    let mut template_ids=Vec::new();
    for template in templates {
        let template=template.as_object().ok_or_else(link_permission_invalid)?;
        template_ids.push(link_permission_ids(template.get("materialized_app_ids"))?);
    }
    let mut ids=link_permission_ids(release.get("app_ids"))?;
    for values in &template_ids {ids.extend(values.iter().copied());}
    let mut seen=std::collections::HashSet::new();
    ids.retain(|id|seen.insert(link_permission_normalize(id)));
    let empty_templates=template_ids.iter().filter(|ids|ids.is_empty()).count();
    if ids.len()+empty_templates!=1 || ids.is_empty() {return Ok(None);}
    let id=ids[0];let normalized=link_permission_normalize(id);
    let canonical=|row:&Value|->ServiceResult<Option<String>> {
        match row.get("canonical_app_id") {None|Some(Value::Null)=>Ok(None),Some(value)=>value.as_str().filter(|id|!id.is_empty()).map(link_permission_normalize).map(Some).ok_or_else(link_permission_invalid)}
    };
    if let Some(explicit)=canonical(plugin)? {return Ok((explicit==normalized).then(||id.to_owned()));}
    let attached_template=template_ids.iter().any(|ids|ids.iter().any(|id|link_permission_normalize(id)==normalized));
    if attached_template {return Ok(None);}
    for other in inventory {
        if canonical(other)?.as_deref()==Some(normalized.as_str()) {
            return Ok((other["id"]==plugin["id"]).then(||id.to_owned()));
        }
    }
    Ok(Some(id.to_owned()))
}

fn link_permission_editable(link:&Value,personal:bool,user_id:&str)->bool {
    personal && link["visibility"]!="HIDDEN" && !link["id"].as_str().unwrap_or("").starts_with("implicit_link::")
        && link["auth_status"]!="REAUTH_REQUIRED" && link["owners"].as_array().is_some_and(|owners|
            owners.iter().any(|owner|owner["type"]=="USER" && owner["id"].as_str()==Some(user_id)))
}

impl ChatgptService {
    pub async fn plugin_app_link_permissions_read<F,Fut>(&self,request:PluginAppLinkPermissionsRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_app_link_permissions_with(request,call,&CurlTransport).await
    }

    async fn plugin_app_link_permissions_with<F,Fut,T>(&self,request:PluginAppLinkPermissionsRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        encode_segment(&request.plugin_id)?;
        if let Some(app_id)=&request.app_id {encode_segment(app_id)?;}
        let registration=self.register(&request.request_id)?;
        let common=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity,profile:request.profile};
        let identity=&common.expected_identity;
        let accounts=self.permission_http("/backend-api/wham/accounts/check",HttpMethod::Get,&common,&registration,&call,transport).await?;
        let personal=plugin_permissions::permission_personal(&accounts,identity)?;
        let app_id=self.resolve_service_plugin_app(&request.plugin_id,request.app_id.as_deref(),&common,&registration,&call,transport).await?;
        let details=PluginAppDetailsRequest{request_id:request.request_id.clone(),expected_identity:identity.clone(),profile:common.profile.clone(),plugin_id:request.plugin_id,app_id:app_id.clone()};
        let details=self.plugin_app_snapshot(&details,&registration,&call,transport).await?;
        let access=match details["links"].as_array() {
            None=>"unavailable",
            Some(links) if details["connector"]["labels"]["apps_privacy_control_available"]!="false" && links.iter().any(|link|link_permission_editable(link,personal,&identity.user_id))=>"allowed",
            Some(_)=>"denied",
        };
        let default=self.permission_http("/backend-api/settings/user",HttpMethod::Get,&common,&registration,&call,transport).await
            .and_then(|body|plugin_permissions::permission_value(&body).map(str::to_owned));
        let (default_value,default_error)=match default {
            Ok(value)=>(json!(value),Value::Null),
            Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
            Err(error)=>(Value::Null,json!({"code":error.code,"message":"Plugin default permissions unavailable"})),
        };
        self.check_share_current(identity,&registration)?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"appId":app_id,"details":details,"personal":personal,"access":access,"defaultValue":default_value,"defaultError":default_error})})
    }

    pub(super) async fn resolve_service_plugin_app<F,Fut,T>(&self,plugin_id:&str,app_id:Option<&str>,common:&PluginPermissionsRequest,
        registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<String>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let encoded=encode_segment(plugin_id)?;
        let identity=&common.expected_identity;
        let app_id=if let Some(app_id)=app_id {encode_segment(app_id)?;Some(app_id.to_owned())} else {
            let plugin=self.remote_plugin_http(&format!("/backend-api/ps/plugins/{encoded}"),HttpMethod::Get,false,identity,&common.profile,&registration,&call,transport).await?;
            validate_remote_plugin_row(&plugin)?;
            if plugin["id"].as_str()!=Some(plugin_id) {return Err(link_permission_invalid());}
            if plugin["release"].get("requires_local_executor").is_some_and(|value|!value.is_null() && !value.is_boolean()) {return Err(link_permission_invalid());}
            if plugin["release"]["requires_local_executor"]==true {return Err(failure("unsupported_host","Implicit local-executor app permissions require verified host support"));}
            let inventory=self.remote_plugin_pages(identity,&common.profile,true,&registration,&call,transport).await?;
            let candidate=link_permission_canonical(&plugin,&inventory)?;
            if let Some(candidate)=candidate {
                if plugin.get("canonical_app_id").is_none_or(Value::is_null) {
                    let encoded=encode_segment(&candidate)?;
                    let association=self.remote_plugin_http(&format!("/backend-api/ps/plugins/canonical-app/{encoded}"),HttpMethod::Get,false,identity,&common.profile,&registration,&call,transport).await;
                    match association {
                        Ok(value) if value["plugin_id"].as_str()==Some(plugin_id)=>Some(candidate),
                        Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
                        _=>None,
                    }
                } else {Some(candidate)}
            } else {None}
        };
        let Some(app_id)=app_id else {
            self.check_share_current(identity,&registration)?;
            return Err(failure("app_not_in_plugin","Plugin has no resolved canonical app"));
        };
        self.check_share_current(identity,&registration)?;
        Ok(app_id)
    }

    pub async fn plugin_app_link_permission_write<F,Fut>(&self,request:PluginAppLinkPermissionWriteRequest,call:F)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_app_link_permission_write_with(request,call,&CurlTransport).await
    }

    async fn plugin_app_link_permission_write_with<F,Fut,T>(&self,request:PluginAppLinkPermissionWriteRequest,call:F,transport:&T)->ServiceResult<ProfileMutationResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        if !request.value.is_null() && !request.value.as_str().is_some_and(|value|matches!(value,"always_ask"|"ask_before_writes"|"review_important_actions"|"full_access")) {
            return Err(failure("invalid_request","Invalid linked account permission value"));
        }
        encode_segment(&request.plugin_id)?;encode_segment(&request.app_id)?;
        let encoded=encode_segment(&request.link_id)?;
        let registration=self.register(&request.request_id)?;
        let common=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity,profile:request.profile};
        let identity=&common.expected_identity;
        let accounts=self.permission_http("/backend-api/wham/accounts/check",HttpMethod::Get,&common,&registration,&call,transport).await?;
        let personal=plugin_permissions::permission_personal(&accounts,identity)?;
        let details=PluginAppDetailsRequest{request_id:request.request_id.clone(),expected_identity:identity.clone(),profile:common.profile.clone(),plugin_id:request.plugin_id,app_id:request.app_id};
        let details=self.plugin_app_snapshot(&details,&registration,&call,transport).await?;
        if details["connector"]["labels"]["apps_privacy_control_available"]=="false" {return Err(failure("forbidden","App-specific permissions are unavailable"));}
        let links=details["links"].as_array().ok_or_else(link_permission_invalid)?;
        let mut targets=links.iter().filter(|link|link["id"].as_str()==Some(request.link_id.as_str()));
        let target=targets.next().ok_or_else(||failure("not_found","Linked account is unavailable"))?;
        if targets.next().is_some() {return Err(link_permission_invalid());}
        if !link_permission_editable(target,personal,&identity.user_id) {return Err(failure("forbidden","Linked account permissions are not editable"));}
        let delivery=if target.get("apps_privacy_control").unwrap_or(&Value::Null)==&request.value {"not_sent"} else {
            let route=format!("/backend-api/aip/connectors/links/{encoded}");
            match self.link_permission_patch(&route,&request.value,&common,&registration,&call,transport).await {
                Ok(())=>"accepted",Err(error) if error.code=="plugin_link_permission_unknown"=>"unknown",Err(error)=>return Err(error),
            }
        };
        self.check_share_current(identity,&registration)?;
        // The client awaits its batch then performs one fresh authoritative read.
        Ok(ProfileMutationResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"delivery":delivery}),readback:Value::Null,verification:"pending"})
    }

    async fn link_permission_patch<F,Fut,T>(&self,route:&str,value:&Value,request:&PluginPermissionsRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<()>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let identity=&request.expected_identity;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Link permission request cancelled; a sent write may already have applied")),
            result=async {
                let mut session=self.session.lock().await;
                self.prepare(&mut session,identity.generation,call,false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity,registration)?;
                    let credentials=session.credentials.as_ref().unwrap();
                    if &credentials.identity!=identity {return Err(failure("account_changed","Authenticated identity changed"));}
                    let integrity=session.integrity.clone();
                    let mut outgoing=build_http_request(route,credentials,integrity.as_deref(),&request.profile)?;
                    outgoing.method=HttpMethod::Patch;
                    outgoing.headers.insert("OAI-Product-Sku".into(),"CODEX".into());outgoing.headers.insert("X-Codex-Surface".into(),"settings".into());outgoing.headers.insert("Content-Type".into(),"application/json".into());
                    outgoing.body=serde_json::to_vec(&json!({"apps_privacy_control":value})).unwrap();
                    share_network_allowed(call,&outgoing.url).await?;self.check_share_current(identity,registration)?;
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await.map_err(|_|failure("plugin_link_permission_unknown","Link permission outcome unknown; read before retrying"))?;
                    self.check_share_current(identity,registration)?;
                    apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {return Err(ServiceError{code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
                    if response.status==401 && attempt==0 {self.prepare(&mut session,identity.generation,call,true).await?;continue;}
                    if response.status>=500 || response.status==408 {return Err(failure("plugin_link_permission_unknown","Link permission outcome unknown; read before retrying"));}
                    if (200..300).contains(&response.status) {return Ok(());}
                    decode_response(response,registration.id.clone(),identity.clone())?;return Ok(());
                }
                unreachable!()
            }=>result,
        };
        self.check_share_current(identity,registration)?;result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"link-account".into(),user_id:"link-user".into(),generation:0}}
    fn request()->PluginAppLinkPermissionsRequest {PluginAppLinkPermissionsRequest{request_id:"link-permissions-fixture".into(),expected_identity:identity(),
        profile:ServiceProfile{language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()},
        plugin_id:"plugin-real".into(),app_id:Some("asdk_app_real".into())}}
    fn write(value:Value)->PluginAppLinkPermissionWriteRequest {let r=request();PluginAppLinkPermissionWriteRequest{request_id:r.request_id,expected_identity:r.expected_identity,
        profile:r.profile,plugin_id:r.plugin_id,app_id:r.app_id.unwrap(),link_id:"link/a?b#%中文".into(),value}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"link-account","user_id":"link-user","chatgpt_account_is_fedramp":false}});
        format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"link-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn accounts()->Value {json!({"accounts":[{"id":"link-account","account_user_id":"membership","account_user_role":"account-owner","structure":"personal","plan_type":"future-plan","is_zdr":false,"is_openai_internal":false}],"account_ordering":["link-account"]})}
    fn plugin()->Value {json!({"id":"plugin-real","name":"Plugin","status":"DISABLED_BY_ADMIN","release":{"app_ids":["asdk_app_real"]}})}
    fn metadata()->Value {json!({"id":"asdk_app_real","name":"App","status":"DISABLED_BY_ADMIN","enable_multi_links":false})}
    fn link()->Value {json!({"id":"link/a?b#%中文","connector_id":"connector_real","name":"User account","owners":[{"type":"USER","id":"link-user"}],"auth_status":"ACTIVE","apps_privacy_control":null,"secret":"never-return"})}
    fn snapshot()->Vec<(u16,Value)>{vec![(200,plugin()),(200,metadata()),(200,json!({"links":[link()]}))]}
    fn read_replies()->Vec<(u16,Value)>{let mut values=vec![(200,accounts())];values.extend(snapshot());values.push((200,json!({"settings":{"apps_privacy_control":null}})));values}
    fn write_replies()->Vec<(u16,Value)>{let mut values=vec![(200,accounts())];values.extend(snapshot());values.push((204,Value::Null));values}
    struct Fixture{replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture{fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,value)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:if status==204{vec![]}else{serde_json::to_vec(&value).unwrap()}})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture{fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    #[tokio::test]
    async fn link_permissions_reads_personal_membership_and_null_default_without_secrets(){
        let transport=Fixture::new(read_replies());let result=ChatgptService::default().plugin_app_link_permissions_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["appId"],"asdk_app_real");assert_eq!(result.body["access"],"allowed");assert_eq!(result.body["personal"],true);
        assert_eq!(result.body["defaultValue"],"review_important_actions");assert!(result.body["defaultError"].is_null());
        assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));assert_eq!(transport.sent.lock().unwrap().len(),5);
    }
    #[tokio::test]
    async fn link_permissions_default_read_failure_preserves_details_without_fabricated_default(){
        let mut replies=read_replies();replies[4]=(503,json!({}));let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_app_link_permissions_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["details"]["connector"]["name"],"App");assert!(result.body["defaultValue"].is_null());assert!(result.body["defaultError"]["code"].is_string());
    }
    #[tokio::test]
    async fn link_permissions_links_failure_is_unavailable_not_denied(){
        let mut replies=read_replies();replies[3]=(503,json!({}));let transport=Fixture::new(replies);
        let result=ChatgptService::default().plugin_app_link_permissions_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["access"],"unavailable");assert!(result.body["details"]["links"].is_null());
    }
    #[tokio::test]
    async fn link_permissions_owner_personal_reauth_and_label_rules_are_fresh(){
        for case in ["workspace","wrong-first-account","nonowner","reauth","hidden","implicit","label"]{
            let mut replies=read_replies();match case{
                "workspace"=>replies[0].1["accounts"][0]["structure"]=json!("workspace"),"wrong-first-account"=>replies[0].1["account_ordering"]=json!(["elsewhere","link-account"]),
                "nonowner"=>replies[3].1["links"][0]["owners"][0]["id"]=json!("other-user"),"reauth"=>replies[3].1["links"][0]["auth_status"]=json!("REAUTH_REQUIRED"),
                "hidden"=>replies[3].1["links"][0]["visibility"]=json!("HIDDEN"),"implicit"=>replies[3].1["links"][0]["id"]=json!("implicit_link::real"),
                "label"=>replies[2].1["labels"]=json!({"apps_privacy_control_available":"false"}),_=>unreachable!(),}
            let transport=Fixture::new(replies);let result=ChatgptService::default().plugin_app_link_permissions_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["access"],"denied","{case}");
        }
    }
    #[tokio::test]
    async fn link_permission_four_values_and_explicit_null_use_exact_patch_ack_only(){
        for value in [json!("always_ask"),json!("ask_before_writes"),json!("review_important_actions"),json!("full_access"),Value::Null]{
            let mut replies=write_replies();if value.is_null(){replies[3].1["links"][0]["apps_privacy_control"]=json!("full_access");}
            let transport=Fixture::new(replies);let result=ChatgptService::default().plugin_app_link_permission_write_with(write(value.clone()),rpc,&transport).await.unwrap();
            assert_eq!(result.body["delivery"],"accepted");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),5);let patch=&sent[4];assert_eq!(patch.method,HttpMethod::Patch);
            assert_eq!(patch.url,"https://chatgpt.com/backend-api/aip/connectors/links/link%2Fa%3Fb%23%25%E4%B8%AD%E6%96%87");assert_eq!(patch.headers["OAI-Product-Sku"],"CODEX");assert_eq!(patch.headers["X-Codex-Surface"],"settings");
            assert_eq!(serde_json::from_slice::<Value>(&patch.body).unwrap(),json!({"apps_privacy_control":value}));
        }
    }
    #[tokio::test]
    async fn link_permission_same_raw_is_noop_but_inherited_effective_still_writes(){
        for value in [Value::Null,json!("full_access")]{let mut replies=write_replies();replies[3].1["links"][0]["apps_privacy_control"]=value.clone();replies.truncate(4);let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_app_link_permission_write_with(write(value),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"not_sent");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(transport.sent.lock().unwrap().len(),4);}
        let transport=Fixture::new(write_replies());assert_eq!(ChatgptService::default().plugin_app_link_permission_write_with(write(json!("review_important_actions")),rpc,&transport).await.unwrap().body["delivery"],"accepted");
    }
    #[tokio::test]
    async fn link_permission_invalid_values_do_not_authenticate_or_send(){
        for value in [json!(false),json!("future"),json!({}),json!([])]{let transport=Fixture::new(vec![]);
            assert_eq!(ChatgptService::default().plugin_app_link_permission_write_with(write(value),rpc,&transport).await.err().unwrap().code,"invalid_request");assert!(transport.sent.lock().unwrap().is_empty());}
    }
    #[tokio::test]
    async fn link_permission_uneditable_wrong_app_or_duplicate_target_never_writes(){
        for case in ["nonowner","hidden","reauth","wrongapp","duplicate","label"]{let mut replies=write_replies();replies.truncate(4);match case{
            "nonowner"=>replies[3].1["links"][0]["owners"][0]["id"]=json!("other-user"),"hidden"=>replies[3].1["links"][0]["visibility"]=json!("HIDDEN"),
            "reauth"=>replies[3].1["links"][0]["auth_status"]=json!("REAUTH_REQUIRED"),"wrongapp"=>replies[3].1["links"][0]["connector_id"]=json!("connector_other"),
            "duplicate"=>{let duplicate=replies[3].1["links"][0].clone();replies[3].1["links"].as_array_mut().unwrap().push(duplicate);},"label"=>replies[2].1["labels"]=json!({"apps_privacy_control_available":"false"}),_=>unreachable!(),}
            let transport=Fixture::new(replies);assert!(ChatgptService::default().plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport).await.is_err(),"{case}");assert!(transport.sent.lock().unwrap().iter().all(|item|item.method!=HttpMethod::Patch));}
    }
    #[tokio::test]
    async fn link_permission_unknown_delivery_has_no_automatic_patch_or_read_replay(){
        for status in [408,503]{let mut replies=write_replies();replies[4]=(status,json!({}));let transport=Fixture::new(replies);
            let result=ChatgptService::default().plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport).await.unwrap();assert_eq!(result.body["delivery"],"unknown");assert_eq!(result.verification,"pending");assert!(result.readback.is_null());assert_eq!(transport.sent.lock().unwrap().len(),5);}
        let transport=Fixture::new(write_replies());transport.replies.lock().unwrap()[4]=Err(failure("network_error","fixture timeout"));assert_eq!(ChatgptService::default().plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport).await.unwrap().body["delivery"],"unknown");assert_eq!(transport.sent.lock().unwrap().len(),5);
    }
    #[test]
    fn link_permission_canonical_matches_candidates_templates_and_inventory_order(){
        let base=plugin();assert_eq!(link_permission_canonical(&base,&[]).unwrap(),Some("asdk_app_real".into()));
        let mut duplicate=base.clone();duplicate["release"]["app_ids"]=json!(["asdk_app_real","connector_real"]);assert_eq!(link_permission_canonical(&duplicate,&[]).unwrap(),Some("asdk_app_real".into()));
        for case in ["empty","multiple","empty-template","materialized-template","wrong-canonical"]{
            let mut row=base.clone();match case{
                "empty"=>row["release"]["app_ids"]=json!([]),"multiple"=>row["release"]["app_ids"]=json!(["asdk_app_real","connector_other"]),
                "empty-template"=>row["release"]["app_templates"]=json!([{}]),"materialized-template"=>row["release"]["app_templates"]=json!([{"materialized_app_ids":["connector_real"]}]),
                "wrong-canonical"=>row["canonical_app_id"]=json!("connector_other"),_=>unreachable!(),}
            assert!(link_permission_canonical(&row,&[]).unwrap().is_none(),"{case}");
        }
        let mut templated=base.clone();templated["release"]["app_templates"]=json!([{"materialized_app_ids":["connector_real"]}]);templated["canonical_app_id"]=json!("connector_real");
        assert_eq!(link_permission_canonical(&templated,&[]).unwrap(),Some("asdk_app_real".into()));
        let other=json!({"id":"other-plugin","canonical_app_id":"connector_real"});let owner=json!({"id":"plugin-real","canonical_app_id":"connector_real"});
        assert!(link_permission_canonical(&base,&[other.clone(),owner.clone()]).unwrap().is_none());
        assert_eq!(link_permission_canonical(&base,&[owner,other]).unwrap(),Some("asdk_app_real".into()));
    }
    #[tokio::test]
    async fn link_permissions_implicit_requires_complete_inventory_and_reverse_association(){
        for association in [json!({"plugin_id":"plugin-real"}),json!({"plugin_id":"other-plugin"}),json!({"plugin_id":null})]{
            let mut replies=vec![(200,accounts()),(200,plugin()),(200,json!({"plugins":[],"pagination":{"next_page_token":"page-2"}})),
                (200,json!({"plugins":[plugin()],"pagination":{"next_page_token":null}})),(200,association.clone())];
            if association["plugin_id"]=="plugin-real"{replies.extend(snapshot());replies.push((200,json!({"settings":{}})));}
            let transport=Fixture::new(replies);let mut request=request();request.app_id=None;
            let result=ChatgptService::default().plugin_app_link_permissions_with(request,rpc,&transport).await;
            if association["plugin_id"]=="plugin-real" {assert_eq!(result.unwrap().body["access"],"allowed");}
            else {assert_eq!(result.err().unwrap().code,"app_not_in_plugin");}
            let sent=transport.sent.lock().unwrap();assert!(sent[3].url.contains("pageToken=page-2"));assert_eq!(sent[4].url,"https://chatgpt.com/backend-api/ps/plugins/canonical-app/asdk_app_real");
        }
    }
    #[test]
    fn link_permission_write_requires_value_but_allows_explicit_null_reset(){
        let request=write(Value::Null);
        let mut body=json!({"requestId":request.request_id,"expectedIdentity":request.expected_identity,"profile":{
            "language":request.profile.language,"deviceId":request.profile.device_id,"userAgent":request.profile.user_agent,
            "userAgentClientHints":request.profile.user_agent_client_hints,"platformClientHint":request.profile.platform_client_hint},
            "pluginId":request.plugin_id,"appId":request.app_id,"linkId":request.link_id,"value":null});
        assert!(serde_json::from_value::<PluginAppLinkPermissionWriteRequest>(body.clone()).unwrap().value.is_null());
        body.as_object_mut().unwrap().remove("value");
        assert!(serde_json::from_value::<PluginAppLinkPermissionWriteRequest>(body).is_err(),"missing value must never become a reset");
    }
    #[tokio::test]
    async fn link_permissions_without_implicit_candidate_returns_membership_redirect_error(){
        let mut plugin=plugin();plugin["release"]["app_ids"]=json!([]);
        let transport=Fixture::new(vec![(200,accounts()),(200,plugin.clone()),(200,json!({"plugins":[plugin],"pagination":{"next_page_token":null}}))]);
        let mut request=request();request.app_id=None;
        assert_eq!(ChatgptService::default().plugin_app_link_permissions_with(request,rpc,&transport).await.err().unwrap().code,"app_not_in_plugin");
        assert_eq!(transport.sent.lock().unwrap().len(),3);
    }
    #[tokio::test]
    async fn link_permissions_explicit_canonical_skips_reverse_and_local_host_is_not_guessed(){
        let mut explicit=plugin();explicit["canonical_app_id"]=json!("connector_real");
        let mut replies=vec![(200,accounts()),(200,explicit.clone()),(200,json!({"plugins":[explicit],"pagination":{"next_page_token":null}}))];replies.extend(snapshot());replies.push((200,json!({"settings":{}})));
        let mut implicit=request();implicit.app_id=None;let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_link_permissions_with(implicit,rpc,&transport).await.unwrap().body["access"],"allowed");
        assert!(transport.sent.lock().unwrap().iter().all(|item|!item.url.contains("canonical-app")));
        let mut local=plugin();local["release"]["requires_local_executor"]=json!(true);let transport=Fixture::new(vec![(200,accounts()),(200,local)]);let mut implicit=request();implicit.app_id=None;
        assert_eq!(ChatgptService::default().plugin_app_link_permissions_with(implicit,rpc,&transport).await.err().unwrap().code,"unsupported_host");assert_eq!(transport.sent.lock().unwrap().len(),2);
    }
    #[tokio::test]
    async fn link_permissions_local_executor_flag_uses_release_not_unrelated_root_field(){
        for root in [json!(true),json!("wrong-root-type")] {
            let mut source=plugin();source["requires_local_executor"]=root;source["release"]["requires_local_executor"]=json!(false);source["canonical_app_id"]=json!("connector_real");
            let mut replies=vec![(200,accounts()),(200,source.clone()),(200,json!({"plugins":[source],"pagination":{"next_page_token":null}}))];
            replies.extend(snapshot());replies.push((200,json!({"settings":{}})));let transport=Fixture::new(replies);let mut implicit=request();implicit.app_id=None;
            assert_eq!(ChatgptService::default().plugin_app_link_permissions_with(implicit,rpc,&transport).await.unwrap().body["access"],"allowed");
        }
    }
    #[tokio::test]
    async fn link_permissions_malformed_inventory_and_stale_identity_never_resolve_by_guess(){
        let transport=Fixture::new(vec![(200,accounts()),(200,plugin()),(200,json!({"plugins":[plugin()]}))]);let mut implicit=request();implicit.app_id=None;
        assert!(ChatgptService::default().plugin_app_link_permissions_with(implicit,rpc,&transport).await.is_err());assert_eq!(transport.sent.lock().unwrap().len(),3);
        let transport=Fixture::new(vec![]);let mut stale=write(json!("full_access"));stale.expected_identity.account_id="other-account".into();
        assert_eq!(ChatgptService::default().plugin_app_link_permission_write_with(stale,rpc,&transport).await.err().unwrap().code,"account_changed");assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn link_permission_401_refreshes_once_but_ip_and_forbidden_do_not_retry(){
        let mut replies=write_replies();replies[4]=(401,json!({}));replies.push((204,Value::Null));let transport=Fixture::new(replies);
        assert_eq!(ChatgptService::default().plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport).await.unwrap().body["delivery"],"accepted");
        assert_eq!(transport.sent.lock().unwrap().len(),6);
        for (status,body,code) in [(403,json!({}),"forbidden"),(401,json!({"error":{"code":"workspace_ip_not_authorized"}}),"ip_not_authorized")]{
            let mut replies=write_replies();replies[4]=(status,body);let transport=Fixture::new(replies);
            assert_eq!(ChatgptService::default().plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport).await.err().unwrap().code,code);assert_eq!(transport.sent.lock().unwrap().len(),5);
        }
    }
    #[tokio::test]
    async fn link_permission_identity_change_and_cancellation_do_not_return_ack(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{
            let patch=request.method==HttpMethod::Patch;let result=self.fixture.send(request,cancel).await;if patch{self.service.invalidate();}result
        })}}
        let service=ChatgptService::default();let transport=Invalidate{service:&service,fixture:Fixture::new(write_replies())};
        assert_eq!(service.plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),5);
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{
            if request.method==HttpMethod::Patch{self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))}else{self.fixture.send(request,cancel).await}
        })}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(write_replies()),entered:AtomicBool::new(false)};
        let(result,())=tokio::join!(service.plugin_app_link_permission_write_with(write(json!("full_access")),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("link-permissions-fixture"));});
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),4);
    }
}
