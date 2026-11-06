//! Identity-bound, read-only archive eligibility and conversation pagination.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveConversationsRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub offset: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveConversationsAccess {
    pub status: &'static str,
    pub include_work_cloud: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveConversationsResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub access: ArchiveConversationsAccess,
    pub body: Value,
}

fn access_unknown() -> ServiceError {
    failure("archive_access_unknown", "Archive access inputs are incomplete; retry before loading conversations")
}

fn supported_plan(plan: &str) -> bool {
    matches!(plan,"free"|"go"|"plus"|"pro"|"promax"|"prolite"|"free_workspace"|"team"|
        "self_serve_business_prolite"|"sci"|"rosalind_academic"|"business"|"enterprise_cbp_trial"|
        "enterprise_cbp_view_only"|"finserv"|"law"|"ent26"|"education"|"edu_plus"|"edu_pro"|
        "quorum"|"enterprise"|"hc"|"hc_consumption"|"deprecated_enterprise"|"edu"|"deprecated_edu"|"k12")
}

/// The token was already authenticated and parsed by prepare; vv uses this raw claim,
/// independently from Odt's inventory plan. Do not alias, trim or normalize it.
fn token_plan(token: &str) -> ServiceResult<Option<String>> {
    let payload=token.split('.').nth(1).ok_or_else(access_unknown)?;
    let decoded=base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).map_err(|_|access_unknown())?;
    let claims:Value=serde_json::from_slice(&decoded).map_err(|_|access_unknown())?;
    Ok(claims.pointer("/https:~1~1api.openai.com~1auth/chatgpt_plan_type").and_then(Value::as_str).map(str::to_owned))
}

fn check_plan_scope(session: &Session, expected: Option<&Option<String>>) -> ServiceResult<()> {
    if let Some(expected)=expected {
        let current=token_plan(&session.credentials.as_ref().ok_or_else(access_unknown)?.token)?;
        if &current!=expected {return Err(failure("archive_scope_changed","Archive token plan changed; restart pagination from the first page"));}
    }
    Ok(())
}

/// Raw /accounts/check/v4-2023-04-27 consumed by host Gy, before renderer normalization.
/// None means an explicitly absent/inaccessible selected membership, not unreadable data.
fn inventory_plan<'a>(body: &'a Value, identity: &ServiceIdentity) -> ServiceResult<Option<&'a str>> {
    let accounts = body.get("accounts").and_then(Value::as_object).ok_or_else(access_unknown)?;
    let ordering = body.get("account_ordering").and_then(Value::as_array).ok_or_else(access_unknown)?;
    for key in ordering {
        let key = key.as_str().ok_or_else(access_unknown)?;
        let entry = match accounts.get(key) {
            None | Some(Value::Null) => continue,
            Some(Value::Object(entry)) => entry,
            _ => return Err(access_unknown()),
        };
        let account = entry.get("account").and_then(Value::as_object).ok_or_else(access_unknown)?;
        if account.get("account_id").and_then(Value::as_str) != Some(identity.account_id.as_str()) {continue;}
        if entry.get("can_access_with_session") == Some(&Value::Bool(false)) {continue;}
        // Gy skips a truthy is_deactivated; omitted/null/false are usable.
        let deactivated = match account.get("is_deactivated") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(value)) => *value,
            Some(Value::Number(value)) => value.as_f64().is_some_and(|value|value != 0.0),
            Some(Value::String(value)) => !value.is_empty(),
            _ => true,
        };
        if deactivated {continue;}
        return account.get("plan_type").and_then(Value::as_str).filter(|value|!value.is_empty())
            .map(Some).ok_or_else(access_unknown);
    }
    Ok(None)
}

fn full_snapshot_gate(bootstrap: &Value, identity: &ServiceIdentity, key: &str) -> ServiceResult<bool> {
    let payload: Value = serde_json::from_str(bootstrap.get("statsigPayload").and_then(Value::as_str).ok_or_else(access_unknown)?)
        .map_err(|_| access_unknown())?;
    if !payload.is_object() || payload.pointer("/user/userID").and_then(Value::as_str) != Some(identity.user_id.as_str()) ||
        payload.pointer("/user/customIDs/account_id").and_then(Value::as_str) != Some(identity.account_id.as_str()) ||
        payload.get("has_updates") != Some(&Value::Bool(true)) ||
        payload.get("live_overlay").is_some_and(|value| !value.is_null()) {
        return Err(access_unknown());
    }
    for field in ["is_delta","isDelta"] {
        if payload.get(field).is_some_and(|value| !value.is_null() && value != &Value::Bool(false)) { return Err(access_unknown()); }
    }
    let compact = match payload.get("response_format") {
        None => false,
        Some(Value::String(value)) if value == "init-v1" => false,
        Some(Value::String(value)) if value == "init-v2" => true,
        _ => return Err(access_unknown()),
    };
    let gates = payload.get("feature_gates").and_then(Value::as_object).ok_or_else(access_unknown)?;
    let hash = key.encode_utf16().fold(0u32,|hash,code| hash.wrapping_mul(31).wrapping_add(u32::from(code))).to_string();
    let entry = gates.get(key).filter(|value| !value.is_null()).or_else(||gates.get(&hash)).ok_or_else(access_unknown)?;
    entry.get(if compact {"v"} else {"value"}).and_then(Value::as_bool).ok_or_else(access_unknown)
}

fn workspace_branches(settings: &Value) -> ServiceResult<(Option<bool>,Option<bool>)> {
    if !settings.is_object() {return Err(access_unknown());}
    // Missing or malformed unselected fields do not affect xv's selected branch.
    let cloud = settings.get("admin_work_mode_enabled").and_then(Value::as_bool);
    let local = settings.pointer("/beta_settings/wham_local_access").and_then(Value::as_bool);
    Ok((cloud,local))
}

fn strict_chatgpt_auth(auth: &Value) -> ServiceResult<bool> {
    match auth.get("authMethod") {
        Some(Value::Null) => Ok(false),
        Some(Value::String(method)) => Ok(method == "chatgpt"),
        _ => Err(access_unknown()),
    }
}

fn chatgpt_account(account: &Value) -> ServiceResult<bool> {
    match account.get("account") {
        Some(Value::Null) => Ok(false),
        Some(Value::Object(value)) => value.get("type").and_then(Value::as_str)
            .map(|kind|kind == "chatgpt").ok_or_else(access_unknown),
        _ => Err(access_unknown()),
    }
}

fn archive_page(body: &Value) -> ServiceResult<Value> {
    let invalid = || failure("invalid_response","Invalid archive conversation page");
    let page = body.as_object().ok_or_else(invalid)?;
    let empty_items = Vec::new();
    let items = match page.get("items") {
        None | Some(Value::Null) => &empty_items,
        Some(Value::Array(items)) => items,
        _ => return Err(invalid()),
    };
    let items = items.iter().filter_map(|item| {
        item.get("id").and_then(Value::as_str)?;
        let mut projected = serde_json::Map::new();
        for key in ["id","title","create_time","update_time","gizmo_id"] {
            if let Some(value) = item.get(key) {projected.insert(key.into(),value.clone());}
        }
        Some(Value::Object(projected))
    }).collect::<Vec<_>>();
    Ok(json!({"items":items,"offset":page.get("offset").ok_or_else(invalid)?,
        "limit":page.get("limit").ok_or_else(invalid)?,"total":page.get("total").ok_or_else(invalid)?}))
}

fn conversations_route(offset: u64, include_work_cloud: bool) -> ServiceResult<String> {
    if offset > 9_007_199_254_740_991 { return Err(failure("invalid_request","Archive offset exceeds the safe integer limit")); }
    let mut url = tauri::Url::parse("https://chatgpt.com/backend-api/conversations")
        .map_err(|_|failure("invalid_request","Invalid archive conversation route"))?;
    url.query_pairs_mut().append_pair("is_archived","true").append_pair("hide_snorlax","false")
        .append_pair("order","updated").append_pair("limit","20").append_pair("offset",&offset.to_string());
    if !include_work_cloud { url.query_pairs_mut().append_pair("exclude_conversation_origin","tpp"); }
    Ok(format!("{}?{}",url.path(),url.query().unwrap()))
}

impl ChatgptService {
    pub async fn archive_conversations_read<F,Fut>(&self,request:ArchiveConversationsRequest,context:ShareBootstrapContext,call:F) -> ServiceResult<ArchiveConversationsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.archive_conversations_with(request,context,call,&CurlTransport).await
    }

    async fn archive_conversations_with<F,Fut,T>(&self,request:ArchiveConversationsRequest,context:ShareBootstrapContext,call:F,transport:&T) -> ServiceResult<ArchiveConversationsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        // Validate every renderer-controlled pagination field before authentication.
        conversations_route(request.offset,false)?;
        for value in [&context.app_session_id,&context.app_version,&context.brand_name,&context.build_flavor,
            &context.system_name,&context.system_version,&context.window_type] {
            if value.is_empty() || value.len()>512 || value.chars().any(char::is_control) {
                return Err(failure("desktop_context_unavailable","Host bootstrap context unavailable"));
            }
        }
        let registration=self.register(&request.request_id)?;
        let identity=&request.expected_identity;
        self.check_share_current(identity,&registration)?;
        let denied=||ArchiveConversationsResponse {request_id:request.request_id.clone(),identity:identity.clone(),
            access:ArchiveConversationsAccess {status:"denied",include_work_cloud:None},body:Value::Null};
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Archive conversation read cancelled")),
            result=async {
                let mut session=self.session.lock().await;
                self.check_share_current(identity,&registration)?;
                // Odt is strict chatgpt, although other existing service operations also support chatgptAuthTokens.
                let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await
                    .map_err(|_|access_unknown())?;
                self.check_share_current(identity,&registration)?;
                if !strict_chatgpt_auth(&auth)? {return Ok(denied());}
                let account=call("account/read",json!({"refreshToken":false})).await.map_err(|_|access_unknown())?;
                self.check_share_current(identity,&registration)?;
                if !chatgpt_account(&account)? {return Ok(denied());}
                if account.pointer("/workspaceRouting/chatgptAccountId").and_then(Value::as_str)!=Some(identity.account_id.as_str()) {
                    return Err(failure("account_changed","Archive selected account changed"));
                }
                self.prepare(&mut session,identity.generation,&call,false).await?;
                let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await.map_err(|_|access_unknown())?;
                self.check_share_current(identity,&registration)?;
                if !strict_chatgpt_auth(&auth)? {return Err(access_unknown());}
                let inventory=self.archive_http("/backend-api/accounts/check/v4-2023-04-27",None,&request,&registration,&mut session,None,&call,transport).await?;
                let Some(plan)=inventory_plan(&inventory,identity)? else {return Ok(denied());};
                if !supported_plan(plan) {return Ok(denied());}
                let token_plan=token_plan(&session.credentials.as_ref().ok_or_else(access_unknown)?.token)?;
                let bootstrap_body=json!({"app_session_id":context.app_session_id,"app_version":context.app_version,
                    "brand_name":context.brand_name,"build_flavor":context.build_flavor,"system_name":context.system_name,
                    "system_version":context.system_version,"window_type":context.window_type,
                    "locale":request.profile.language,"stable_id":request.profile.device_id});
                let include_work_cloud=match token_plan.as_deref() {
                    None|Some("free"|"go")=>false,
                    Some("plus"|"prolite"|"pro"|"promax")=>{
                        let bootstrap=self.archive_http("/backend-api/wham/statsig/bootstrap",Some(&bootstrap_body),&request,&registration,&mut session,Some(&token_plan),&call,transport).await?;
                        full_snapshot_gate(&bootstrap,identity,"1625797156")?
                    },
                    _=>{
                        let path=format!("/backend-api/accounts/{}/settings",encode_segment(&identity.account_id)?);
                        let settings=self.archive_http(&path,None,&request,&registration,&mut session,Some(&token_plan),&call,transport).await?;
                        let (cloud,local)=workspace_branches(&settings)?;
                        if cloud.is_some() && cloud==local {cloud.unwrap()} else {
                            let bootstrap=self.archive_http("/backend-api/wham/statsig/bootstrap",Some(&bootstrap_body),&request,&registration,&mut session,Some(&token_plan),&call,transport).await?;
                            (if full_snapshot_gate(&bootstrap,identity,"1463309241")? {cloud} else {local}).ok_or_else(access_unknown)?
                        }
                    },
                };
                let route=conversations_route(request.offset,include_work_cloud)?;
                let body=self.archive_http(&route,None,&request,&registration,&mut session,Some(&token_plan),&call,transport).await?;
                let body=archive_page(&body)?;
                Ok(ArchiveConversationsResponse {request_id:request.request_id.clone(),identity:identity.clone(),
                    access:ArchiveConversationsAccess {status:"allowed",include_work_cloud:Some(include_work_cloud)},body})
            }=>result,
        };
        self.check_share_current(identity,&registration)?;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn archive_http<F,Fut,T>(&self,route:&str,bootstrap:Option<&Value>,request:&ArchiveConversationsRequest,
        registration:&Registration<'_>,session:&mut Session,expected_plan:Option<&Option<String>>,call:&F,transport:&T) -> ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let identity=&request.expected_identity;
        let encoded=bootstrap.map(serde_json::to_vec).transpose().map_err(|_|access_unknown())?.unwrap_or_default();
        for attempt in 0..2 {
            self.check_share_current(identity,registration)?;
            check_plan_scope(session,expected_plan)?;
            let credentials=session.credentials.as_ref().unwrap();
            if &credentials.identity!=identity {return Err(failure("account_changed","Archive authenticated identity changed"));}
            let integrity=session.integrity.clone();
            let mut outgoing=build_http_request(route,credentials,integrity.as_deref(),&request.profile)?;
            if bootstrap.is_some() {
                outgoing.method=HttpMethod::Post;outgoing.body=encoded.clone();
                outgoing.headers.insert("Content-Type".into(),"application/json".into());
            }
            share_network_allowed(call,&outgoing.url).await?;
            self.check_share_current(identity,registration)?;
            check_plan_scope(session,expected_plan)?;
            let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(if bootstrap.is_some(){10}else{50})).await?;
            self.check_share_current(identity,registration)?;
            check_plan_scope(session,expected_plan)?;
            apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response) {
                return Err(ServiceError {code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});
            }
            // The only POST is the proven read-only Statsig bootstrap, never an archive mutation.
            if response.status==401 && attempt==0 {
                self.prepare(session,identity.generation,call,true).await?;
                check_plan_scope(session,expected_plan)?;
                let auth=call("getAuthStatus",json!({"includeToken":false,"refreshToken":false})).await.map_err(|_|access_unknown())?;
                self.check_share_current(identity,registration)?;
                if !strict_chatgpt_auth(&auth)? {return Err(access_unknown());}
                continue;
            }
            return Ok(decode_response(response,registration.id.clone(),identity.clone())?.body);
        }
        unreachable!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn identity() -> ServiceIdentity {
        ServiceIdentity {account_id:"archive-account".into(),user_id:"archive-user".into(),generation:0}
    }
    fn request(id:&str) -> ArchiveConversationsRequest {
        ArchiveConversationsRequest {request_id:id.into(),expected_identity:identity(),offset:0,profile:ServiceProfile {
            language:"zh-CN".into(),device_id:"archive-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into(),
        }}
    }
    fn context() -> ShareBootstrapContext {
        ShareBootstrapContext {app_session_id:"fixture-session".into(),app_version:"0.1.0".into(),brand_name:"Fixture Native".into(),
            build_flavor:"test".into(),system_name:"windows".into(),system_version:"fixture-version".into(),window_type:"main".into()}
    }
    fn account(plan:&str) -> Value {
        json!({"account":{"type":"chatgpt","planType":plan},"workspaceRouting":{"backendOrigin":"https://chatgpt.com",
            "chatgptAccountId":"archive-account","accountRoutingOverride":"NO_CONSTRAINT"}})
    }
    fn auth_with_plan(plan:Option<Value>) -> Value {
        let mut claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"archive-account","user_id":"archive-user","chatgpt_account_is_fedramp":false}});
        if let Some(plan)=plan {claims["https://api.openai.com/auth"]["chatgpt_plan_type"]=plan;}
        let token=format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
        json!({"authMethod":"chatgpt","authToken":token})
    }
    fn auth(plan:&str) -> Value {auth_with_plan(Some(json!(plan)))}
    fn rpc(plan:&str,method:&'static str,_:Value) -> std::future::Ready<Result<Value,String>> {
        std::future::ready(match method {
            "getAuthStatus"=>Ok(auth(plan)),"account/read"=>Ok(account(plan)),"configRequirements/read"=>Ok(json!({"requirements":null})),
            _=>Err("unexpected fixture RPC".into()),
        })
    }
    fn inventory(plan:&str) -> Value {
        json!({"account_ordering":["archive-account"],"accounts":{"archive-account":{"account":{
            "account_id":"archive-account","account_user_id":"membership-id","account_user_role":"owner","structure":"workspace",
            "plan_type":plan,"is_zdr":false},"can_access_with_session":true}}})
    }
    fn settings(cloud:bool,local:bool) -> Value {
        json!({"admin_work_mode_enabled":cloud,"beta_settings":{"wham_local_access":local},"private_extra":"never-return"})
    }
    fn page() -> Value {json!({"items":[{"id":"conversation-fixture","title":"真实分页shape"}],"offset":0,"limit":20,"total":1})}
    fn snapshot(key:&str,value:bool,compact:bool,hashed:bool) -> Value {
        let key=if hashed {key.encode_utf16().fold(0u32,|n,c|n.wrapping_mul(31).wrapping_add(u32::from(c))).to_string()}else{key.into()};
        let mut gates=serde_json::Map::new();gates.insert(key,if compact{json!({"v":value})}else{json!({"value":value})});
        let payload=json!({"user":{"userID":"archive-user","customIDs":{"account_id":"archive-account","workspace_id":"archive-account"}},
            "has_updates":true,"response_format":if compact{"init-v2"}else{"init-v1"},"feature_gates":gates});
        json!({"statsigPayload":serde_json::to_string(&payload).unwrap(),"private_companion":"never-return"})
    }
    fn mutate_snapshot(snapshot:Value,change:impl FnOnce(&mut Value)) -> Value {
        let mut payload:Value=serde_json::from_str(snapshot["statsigPayload"].as_str().unwrap()).unwrap();change(&mut payload);
        json!({"statsigPayload":serde_json::to_string(&payload).unwrap()})
    }
    struct FixtureTransport {
        replies:Mutex<VecDeque<HttpResponse>>,sent:Mutex<Vec<HttpRequest>>,pause_at:usize,entered:AtomicBool,
    }
    impl FixtureTransport {
        fn new(replies:Vec<(u16,Value)>) -> Self {
            Self {replies:Mutex::new(replies.into_iter().map(|(status,body)|HttpResponse {status,body:serde_json::to_vec(&body).unwrap(),headers:BTreeMap::new()}).collect()),
                sent:Mutex::new(Vec::new()),pause_at:usize::MAX,entered:AtomicBool::new(false)}
        }
    }
    impl Transport for FixtureTransport {
        fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move {
                let index={let mut sent=self.sent.lock().unwrap();sent.push(request);sent.len()-1};
                if index==self.pause_at {
                    self.entered.store(true,Ordering::SeqCst);
                    tokio::select! {_=cancelled(&cancel)=>return Err(failure("cancelled","fixture cancelled")),_=tokio::time::sleep(Duration::from_millis(150))=>{}}
                }
                Ok(self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request"))
            })
        }
    }

    #[test]
    fn archive_conversations_full_gate_snapshot_checks_numeric_hash_v1_v2_and_identity() {
        for key in ["1625797156","1463309241"] {for value in [false,true] {for compact in [false,true] {for hashed in [false,true] {
            assert_eq!(full_snapshot_gate(&snapshot(key,value,compact,hashed),&identity(),key).unwrap(),value);
        }}}}
        for field in ["is_delta","isDelta"] {
            let bad=mutate_snapshot(snapshot("1625797156",true,false,false),|value|value[field]=json!(true));
            assert_eq!(full_snapshot_gate(&bad,&identity(),"1625797156").err().unwrap().code,"archive_access_unknown");
        }
        let base=snapshot("1625797156",true,false,false);
        let corruptions:Vec<Box<dyn Fn(&mut Value)>>=vec![
            Box::new(|p|p["user"]["userID"]=json!("other-user")),Box::new(|p|p["user"]["customIDs"]["account_id"]=json!("other-account")),
            Box::new(|p|p["has_updates"]=json!(false)),
            Box::new(|p|p["live_overlay"]=json!({})),Box::new(|p|p["response_format"]=json!("unknown")),
            Box::new(|p|p["feature_gates"]=json!({})),Box::new(|p|p["feature_gates"]["1625797156"]["value"]=json!(1)),
        ];
        for change in corruptions {
            assert_eq!(full_snapshot_gate(&mutate_snapshot(base.clone(),change),&identity(),"1625797156").err().unwrap().code,"archive_access_unknown");
        }
        for aliases in [json!({"workspace_id":"other-workspace","chatgpt_account_id":null}),json!({"workspace_id":null,"chatgpt_account_id":"other-alias"})] {
            let extra_ids=mutate_snapshot(base.clone(),|p| {
                p["user"]["customIDs"].as_object_mut().unwrap().extend(aliases.as_object().unwrap().clone());
            });
            assert!(full_snapshot_gate(&extra_ids,&identity(),"1625797156").unwrap());
        }
        let missing_format=mutate_snapshot(base,|p|{p.as_object_mut().unwrap().remove("response_format");});
        assert!(full_snapshot_gate(&missing_format,&identity(),"1625797156").unwrap());
        assert!(full_snapshot_gate(&json!({"statsigPayload":"not-json"}),&identity(),"1625797156").is_err());
    }

    #[tokio::test]
    async fn archive_conversations_free_go_uses_raw_inventory_and_fixed_excluded_pagination() {
        for plan in ["free","go"] {for offset in [0,20,9_007_199_254_740_991] {
            let service=ChatgptService::default();let transport=FixtureTransport::new(vec![(200,inventory(plan)),(200,page())]);
            let mut request=request("free");request.offset=offset;
            let result=service.archive_conversations_with(request,context(),|m,p|rpc(plan,m,p),&transport).await.unwrap();
            assert_eq!(result.access.status,"allowed");assert_eq!(result.access.include_work_cloud,Some(false));assert_eq!(result.body,page());
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);
            assert!(sent.iter().all(|request|request.method==HttpMethod::Get));
            assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27");
            let url=tauri::Url::parse(&sent[1].url).unwrap();assert_eq!(url.path(),"/backend-api/conversations");
            let pairs=url.query_pairs().collect::<BTreeMap<_,_>>();
            assert_eq!(pairs.len(),6);assert_eq!(pairs["is_archived"],"true");assert_eq!(pairs["hide_snorlax"],"false");
            assert_eq!(pairs["order"],"updated");assert_eq!(pairs["limit"],"20");assert_eq!(pairs["offset"],offset.to_string());
            assert_eq!(pairs["exclude_conversation_origin"],"tpp");assert_eq!(sent[1].headers["ChatGPT-Account-Id"],"archive-account");
            assert_eq!(sent[1].headers["oai-did"],"archive-device");assert_eq!(sent[1].headers["OAI-Language"],"zh-CN");
            assert!(!serde_json::to_string(&result).unwrap().contains(auth(plan)["authToken"].as_str().unwrap()));
        }}
    }

    #[tokio::test]
    async fn archive_conversations_paid_plans_use_only_162_gate_and_trusted_bootstrap_context() {
        for plan in ["plus","prolite","pro","promax"] {for value in [false,true] {for compact in [false,true] {
            let transport=FixtureTransport::new(vec![(200,inventory(plan)),(200,snapshot("1625797156",value,compact,true)),(200,page())]);
            let result=ChatgptService::default().archive_conversations_with(request("paid"),context(),|m,p|rpc(plan,m,p),&transport).await.unwrap();
            assert_eq!(result.access.include_work_cloud,Some(value));
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),3);assert_eq!(sent[1].method,HttpMethod::Post);
            assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/wham/statsig/bootstrap");
            let body:Value=serde_json::from_slice(&sent[1].body).unwrap();
            assert_eq!(body["brand_name"],"Fixture Native");assert_eq!(body["app_session_id"],"fixture-session");
            assert_eq!(body["system_version"],"fixture-version");assert_eq!(body["window_type"],"main");
            assert_eq!(body["locale"],"zh-CN");assert_eq!(body["stable_id"],"archive-device");
            assert_eq!(sent[2].url.contains("exclude_conversation_origin=tpp"),!value);
            assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        }}}
    }

    #[tokio::test]
    async fn archive_conversations_organization_uses_required_workspace_branch_or_equal_optimization() {
        for plan in ["team","business","enterprise","education","free_workspace"] {for cloud in [false,true] {for local in [false,true] {for gate in [false,true] {
            let mut replies=vec![(200,inventory(plan)),(200,settings(cloud,local))];
            if cloud!=local {replies.push((200,snapshot("1463309241",gate,true,false)));}replies.push((200,page()));
            let transport=FixtureTransport::new(replies);
            let result=ChatgptService::default().archive_conversations_with(request("organization"),context(),|m,p|rpc(plan,m,p),&transport).await.unwrap();
            let expected=if gate {cloud}else{local};assert_eq!(result.access.include_work_cloud,Some(expected));
            let sent=transport.sent.lock().unwrap();assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/accounts/archive-account/settings");
            assert_eq!(sent.len(),if cloud==local {3}else{4});
            assert_eq!(sent.iter().filter(|request|request.method==HttpMethod::Post).count(),usize::from(cloud!=local));
            assert_eq!(sent.last().unwrap().url.contains("exclude_conversation_origin=tpp"),!expected);
            assert!(!serde_json::to_string(&result).unwrap().contains("never-return"));
        }}}}
        for bad in [json!({}),json!({"admin_work_mode_enabled":null}),json!({"admin_work_mode_enabled":"true","beta_settings":{"wham_local_access":true}})] {
            let transport=FixtureTransport::new(vec![(200,inventory("team")),(200,bad),(200,snapshot("1463309241",true,false,false))]);
            assert_eq!(ChatgptService::default().archive_conversations_with(request("bad-workspace"),context(),|m,p|rpc("team",m,p),&transport).await.err().unwrap().code,"archive_access_unknown");
            assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
    }

    #[tokio::test]
    async fn archive_conversations_only_selected_workspace_branch_must_be_known() {
        for value in [false,true] {
            for (gate,raw) in [
                (true,json!({"admin_work_mode_enabled":value})),
                (true,json!({"admin_work_mode_enabled":value,"beta_settings":{"wham_local_access":"bad-unselected"}})),
                (false,json!({"beta_settings":{"wham_local_access":value}})),
                (false,json!({"admin_work_mode_enabled":"bad-unselected","beta_settings":{"wham_local_access":value}})),
            ] {
                let transport=FixtureTransport::new(vec![(200,inventory("team")),(200,raw),(200,snapshot("1463309241",gate,false,true)),(200,page())]);
                let result=ChatgptService::default().archive_conversations_with(request("selected-branch"),context(),|m,p|rpc("team",m,p),&transport).await.unwrap();
                assert_eq!(result.access.include_work_cloud,Some(value));assert_eq!(transport.sent.lock().unwrap().len(),4);
            }
        }
        for (gate,raw) in [(true,json!({"beta_settings":{"wham_local_access":true}})),
            (false,json!({"admin_work_mode_enabled":true}))] {
            let transport=FixtureTransport::new(vec![(200,inventory("team")),(200,raw),(200,snapshot("1463309241",gate,true,false))]);
            assert_eq!(ChatgptService::default().archive_conversations_with(request("selected-missing"),context(),|m,p|rpc("team",m,p),&transport).await.err().unwrap().code,"archive_access_unknown");
            assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
    }

    #[tokio::test]
    async fn archive_conversations_missing_auth_and_account_metadata_are_errors_not_denials() {
        for bad in [json!({}),json!({"authMethod":true}),json!({"authMethod":17}),json!([])] {
            assert_eq!(strict_chatgpt_auth(&bad).err().unwrap().code,"archive_access_unknown");
            let transport=FixtureTransport::new(vec![]);
            let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(bad.clone()))}else{rpc("free",m,p)};
            assert_eq!(ChatgptService::default().archive_conversations_with(request("bad-auth"),context(),call,&transport).await.err().unwrap().code,"archive_access_unknown");
            assert!(transport.sent.lock().unwrap().is_empty());
        }
        for bad in [json!({}),json!({"account":[]}),json!({"account":{}}),json!({"account":{"type":null}}),json!({"account":{"type":true}})] {
            assert_eq!(chatgpt_account(&bad).err().unwrap().code,"archive_access_unknown");
            let transport=FixtureTransport::new(vec![]);
            let call=|m,p|if m=="account/read"{std::future::ready(Ok(bad.clone()))}else{rpc("free",m,p)};
            assert_eq!(ChatgptService::default().archive_conversations_with(request("bad-account"),context(),call,&transport).await.err().unwrap().code,"archive_access_unknown");
            assert!(transport.sent.lock().unwrap().is_empty());
        }
        assert!(!strict_chatgpt_auth(&json!({"authMethod":null})).unwrap());
        assert!(!chatgpt_account(&json!({"account":null})).unwrap());
        let transport=FixtureTransport::new(vec![]);
        let call=|m,p|if m=="account/read"{std::future::ready(Ok(json!({"account":null})))}else{rpc("free",m,p)};
        assert_eq!(ChatgptService::default().archive_conversations_with(request("logged-out-account"),context(),call,&transport).await.unwrap().access.status,"denied");
        assert!(transport.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn archive_conversations_returns_only_needed_page_fields_and_string_id_items() {
        let body=json!({"items":[{"id":"kept","title":"保留标题","create_time":1,"update_time":2,"gizmo_id":"g",
            "private_extra":"secret-item","is_archived":true},{"id":17,"title":"non-string"},{"title":"missing-id"}],
            "offset":0,"limit":20,"total":3,"private_extra":"secret-envelope","access_token":"secret-token"});
        let expected=json!({"items":[{"id":"kept","title":"保留标题","create_time":1,"update_time":2,"gizmo_id":"g"}],"offset":0,"limit":20,"total":3});
        assert_eq!(archive_page(&body).unwrap(),expected);
        let transport=FixtureTransport::new(vec![(200,inventory("free")),(200,body)]);
        let result=ChatgptService::default().archive_conversations_with(request("projected-page"),context(),|m,p|rpc("free",m,p),&transport).await.unwrap();
        assert_eq!(result.body,expected);assert!(!serde_json::to_string(&result).unwrap().contains("secret-"));
        for body in [Value::Null,json!({"items":[]}),json!({"items":{},"offset":0,"limit":20,"total":0})] {
            assert_eq!(archive_page(&body).err().unwrap().code,"invalid_response");
        }
    }

    #[tokio::test]
    async fn archive_conversations_missing_or_null_items_preserves_pagination_metadata() {
        for body in [json!({"offset":20,"limit":20,"total":81}),json!({"items":null,"offset":20,"limit":20,"total":81})] {
            let expected=json!({"items":[],"offset":20,"limit":20,"total":81});
            assert_eq!(archive_page(&body).unwrap(),expected);
            let transport=FixtureTransport::new(vec![(200,inventory("free")),(200,body)]);
            let mut read=request("nullable-items");read.offset=20;
            let result=ChatgptService::default().archive_conversations_with(read,context(),|m,p|rpc("free",m,p),&transport).await.unwrap();
            assert_eq!(result.body,expected);
            assert!(result.body["offset"].as_u64().unwrap()+result.body["limit"].as_u64().unwrap()<result.body["total"].as_u64().unwrap());
        }
        for items in [json!({}),json!(false),json!("invalid"),json!(20)] {
            assert_eq!(archive_page(&json!({"items":items,"offset":20,"limit":20,"total":81})).err().unwrap().code,"invalid_response");
        }
    }

    #[tokio::test]
    async fn archive_conversations_denials_and_invalid_inputs_do_not_start_conversation_or_auth_http() {
        for method in ["apiKey","chatgptAuthTokens","bedrock"] {
            let transport=FixtureTransport::new(vec![]);
            let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(json!({"authMethod":method})))}else{rpc("free",m,p)};
            let result=ChatgptService::default().archive_conversations_with(request("denied-auth"),context(),call,&transport).await.unwrap();
            assert_eq!(result.access.status,"denied");assert_eq!(result.access.include_work_cloud,None);assert!(result.body.is_null());
            assert!(transport.sent.lock().unwrap().is_empty());
        }
        for raw in [inventory("unsupported-plan"),json!({"accounts":{},"account_ordering":[]})] {
            let plan=if raw["account_ordering"].as_array().unwrap().is_empty(){"free"}else{"unsupported-plan"};
            let transport=FixtureTransport::new(vec![(200,raw)]);
            let result=ChatgptService::default().archive_conversations_with(request("denied-plan"),context(),|m,p|rpc(plan,m,p),&transport).await.unwrap();
            assert_eq!(result.access.status,"denied");assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let transport=FixtureTransport::new(vec![]);let calls=AtomicUsize::new(0);let mut invalid=request("offset");invalid.offset=9_007_199_254_740_992;
        let call=|m,p|{calls.fetch_add(1,Ordering::SeqCst);rpc("free",m,p)};
        assert_eq!(ChatgptService::default().archive_conversations_with(invalid,context(),call,&transport).await.err().unwrap().code,"invalid_request");
        assert_eq!(calls.load(Ordering::SeqCst),0);assert!(transport.sent.lock().unwrap().is_empty());
        let profile=json!({"language":"x","deviceId":"x","userAgent":"x","userAgentClientHints":"x","platformClientHint":"x"});
        for extra in ["includeWorkCloud","url","gate","accountId"] {
            let mut value=json!({"requestId":"x","expectedIdentity":identity(),"profile":profile,"offset":0});value[extra]=json!(true);
            assert!(serde_json::from_value::<ArchiveConversationsRequest>(value).is_err());
        }
        for offset in [json!(-1),json!(1.5)] {
            assert!(serde_json::from_value::<ArchiveConversationsRequest>(json!({"requestId":"x","expectedIdentity":identity(),"profile":profile,"offset":offset})).is_err());
        }
    }

    #[tokio::test]
    async fn archive_conversations_incomplete_membership_plan_or_gate_is_error_not_denial() {
        let mut missing_plan=inventory("plus");missing_plan["accounts"]["archive-account"]["account"].as_object_mut().unwrap().remove("plan_type");
        let mut bad_plan=inventory("free");bad_plan["accounts"]["archive-account"]["account"]["plan_type"]=json!(false);
        for raw in [json!({"accounts":[]}),json!({}),missing_plan,bad_plan,json!({"accounts":{},"account_ordering":[17]})] {
            let transport=FixtureTransport::new(vec![(200,raw)]);
            assert_eq!(ChatgptService::default().archive_conversations_with(request("bad-membership"),context(),|m,p|rpc("free",m,p),&transport).await.err().unwrap().code,"archive_access_unknown");
            assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let transport=FixtureTransport::new(vec![(200,inventory("plus")),(200,snapshot("1463309241",true,false,false))]);
        assert_eq!(ChatgptService::default().archive_conversations_with(request("missing-gate"),context(),|m,p|rpc("plus",m,p),&transport).await.err().unwrap().code,"archive_access_unknown");
        assert_eq!(transport.sent.lock().unwrap().len(),2);
        let mut aliased=inventory("free");
        let entry=aliased["accounts"].as_object_mut().unwrap().remove("archive-account").unwrap();
        aliased["accounts"]["ordering-key"]=entry;aliased["account_ordering"]=json!(["ordering-key"]);
        assert_eq!(inventory_plan(&aliased,&identity()).unwrap(),Some("free"));
    }

    #[tokio::test]
    async fn archive_conversations_host_gy_uses_first_eligible_inventory_plan_without_unconsumed_metadata() {
        let raw=json!({"account_ordering":["null-entry","missing-entry","other","session-denied","deactivated","selected-key","later"],"accounts":{
            "null-entry":null,"other":{"account":{"account_id":"other-account"}},
            "session-denied":{"account":{"account_id":"archive-account"},"can_access_with_session":false},
            "deactivated":{"account":{"account_id":"archive-account","is_deactivated":true}},
            "selected-key":{"account":{"account_id":"archive-account","plan_type":"free"}},
            "later":{"account":{"account_id":"archive-account","plan_type":"plus"}}
        }});
        assert_eq!(inventory_plan(&raw,&identity()).unwrap(),Some("free"));
        let transport=FixtureTransport::new(vec![(200,raw),(200,page())]);
        // RPC plan is not an Odt input or vv's token plan.
        let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(auth("free")))}else{rpc("plus",m,p)};
        let result=ChatgptService::default().archive_conversations_with(request("gy-minimal"),context(),call,&transport).await.unwrap();
        assert_eq!(result.access.status,"allowed");assert_eq!(result.access.include_work_cloud,Some(false));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),2);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27");
        assert_eq!(sent[0].headers["ChatGPT-Account-Id"],"archive-account");
        assert!(sent[1].url.contains("exclude_conversation_origin=tpp"));drop(sent);
        let raw=json!({"account_ordering":["selected-key"],"accounts":{"selected-key":{"account":{"account_id":"archive-account","plan_type":"plus"}}}});
        let transport=FixtureTransport::new(vec![(200,raw),(200,snapshot("1625797156",true,false,false)),(200,page())]);
        let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(auth("plus")))}else{rpc("free",m,p)};
        let result=ChatgptService::default().archive_conversations_with(request("gy-paid"),context(),call,&transport).await.unwrap();
        assert_eq!(result.access.include_work_cloud,Some(true));assert_eq!(transport.sent.lock().unwrap().len(),3);
        let mut repeated=inventory("free");repeated["account_ordering"]=json!(["archive-account","archive-account"]);
        assert_eq!(inventory_plan(&repeated,&identity()).unwrap(),Some("free"));
    }

    #[tokio::test]
    async fn archive_conversations_token_plan_inventory_and_rpc_plan_are_independent() {
        let cases=[(None,0),(Some(Value::Null),0),(Some(json!(true)),0),(Some(json!(17)),0),
            (Some(json!("free")),0),(Some(json!("go")),0),(Some(json!("plus")),1),(Some(json!("prolite")),1),
            (Some(json!("pro")),1),(Some(json!("promax")),1),(Some(json!("team")),2),(Some(json!("unknown-token-plan")),2),
            (Some(json!("PLUS")),2),(Some(json!("")),2),(Some(json!(" pro ")),2)];
        for (claim,branch) in cases {for inventory_plan in ["free","plus","team"] {for rpc_plan in ["free","plus","unrelated-rpc-plan"] {
            let mut replies=vec![(200,inventory(inventory_plan))];
            if branch==1 {replies.push((200,snapshot("1625797156",true,false,false)));}
            if branch==2 {replies.push((200,settings(true,true)));}
            replies.push((200,page()));
            let transport=FixtureTransport::new(replies);
            let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(auth_with_plan(claim.clone())))}else{rpc(rpc_plan,m,p)};
            let result=ChatgptService::default().archive_conversations_with(request("three-plans"),context(),call,&transport).await.unwrap();
            assert_eq!(result.access.status,"allowed");assert_eq!(result.access.include_work_cloud,Some(branch!=0));
            let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),if branch==0{2}else{3});
            assert_eq!(sent.last().unwrap().url.contains("exclude_conversation_origin=tpp"),branch==0);
            assert_eq!(sent.iter().filter(|request|request.method==HttpMethod::Post).count(),usize::from(branch==1));
        }}}
        let transport=FixtureTransport::new(vec![(200,inventory("unsupported-odt-plan"))]);
        let call=|m,p|if m=="getAuthStatus"{std::future::ready(Ok(auth("plus")))}else{rpc("free",m,p)};
        assert_eq!(ChatgptService::default().archive_conversations_with(request("odt-still-required"),context(),call,&transport).await.unwrap().access.status,"denied");
        assert_eq!(transport.sent.lock().unwrap().len(),1);
        for claim in [None,Some(Value::Null),Some(json!(false)),Some(json!({"planType":"plus"}))] {
            let auth=auth_with_plan(claim);assert_eq!(token_plan(auth["authToken"].as_str().unwrap()).unwrap(),None);
        }
        let auth=auth_with_plan(None);
        let payload=auth["authToken"].as_str().unwrap().split('.').nth(1).unwrap();
        let mut claims:Value=serde_json::from_slice(&base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        claims["https://api.openai.com/auth"]["plan_type"]=json!("plus");
        claims["https://api.openai.com/auth"]["planType"]=json!("plus");
        let alias_token=format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
        assert_eq!(token_plan(&alias_token).unwrap(),None);
    }

    #[tokio::test]
    async fn archive_conversations_refresh_changed_token_plan_cannot_replay_or_return_mixed_scope() {
        for initial in [None,Some("free"),Some("plus"),Some("team")] {
            let initial=initial.map(|value|json!(value));
            let base=if initial==Some(json!("plus")){"plus"}else if initial==Some(json!("team")){"team"}else{"free"};
            // Force a refresh at each stage after the token-plan scope was captured.
            let prefix=match base {"plus"=>vec![(200,snapshot("1625797156",true,false,false))],"team"=>vec![(200,settings(true,false)),(200,snapshot("1463309241",true,false,false))],_=>vec![]};
            for stage in 0..=prefix.len() {
                let mut replies=vec![(200,inventory("free"))];replies.extend(prefix.iter().take(stage).cloned());replies.push((401,Value::Null));
                let transport=FixtureTransport::new(replies);
                let call=|m,p:Value|if m=="getAuthStatus" {
                    std::future::ready(Ok(auth_with_plan(if p["refreshToken"]==true{Some(json!("different-token-plan"))}else{initial.clone()})))
                }else{rpc("free",m,p)};
                let error=ChatgptService::default().archive_conversations_with(request("scope-refresh"),context(),call,&transport).await.err().unwrap();
                assert_eq!(error.code,"archive_scope_changed");assert_eq!(transport.sent.lock().unwrap().len(),stage+2);
            }
        }
        // An inventory 401 occurs before capture, so the refreshed plan is the new page's scope.
        let transport=FixtureTransport::new(vec![(401,Value::Null),(200,inventory("free")),(200,snapshot("1625797156",true,false,false)),(200,page())]);
        let refreshed=AtomicBool::new(false);
        let call=|m,p:Value|if m=="getAuthStatus" {
            if p["refreshToken"]==true{refreshed.store(true,Ordering::SeqCst);}
            std::future::ready(Ok(auth(if refreshed.load(Ordering::SeqCst){"plus"}else{"free"})))
        }else{rpc("free",m,p)};
        assert_eq!(ChatgptService::default().archive_conversations_with(request("pre-scope-refresh"),context(),call,&transport).await.unwrap().access.include_work_cloud,Some(true));
        assert_eq!(transport.sent.lock().unwrap().len(),4);
    }

    #[tokio::test]
    async fn archive_conversations_http_policy_ip_errors_are_not_task_empty_and_401_refresh_is_bounded() {
        for status in [401,403,404,429,500] {
            let mut replies=vec![(200,inventory("free")),(status,Value::Null)];if status==401{replies.push((401,Value::Null));}
            let transport=FixtureTransport::new(replies);let refreshes=AtomicUsize::new(0);
            let call=|m,p:Value|{if m=="getAuthStatus"&&p["refreshToken"]==true{refreshes.fetch_add(1,Ordering::SeqCst);}rpc("free",m,p)};
            let error=ChatgptService::default().archive_conversations_with(request("http-error"),context(),call,&transport).await.err().unwrap();
            assert_eq!(error.code,match status{401=>"unauthorized",403=>"forbidden",404=>"not_found",429=>"rate_limited",_=>"service_error"});
            assert_eq!(refreshes.load(Ordering::SeqCst),usize::from(status==401));
        }
        let transport=FixtureTransport::new(vec![(200,inventory("free")),(401,json!({"error":{"type":"ip_not_authorized"}}))]);
        assert_eq!(ChatgptService::default().archive_conversations_with(request("ip-error"),context(),|m,p|rpc("free",m,p),&transport).await.err().unwrap().code,"ip_not_authorized");
        assert_eq!(transport.sent.lock().unwrap().len(),2);
        let transport=FixtureTransport::new(vec![]);
        let denied=|m,p|if m=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{rpc("free",m,p)};
        assert_eq!(ChatgptService::default().archive_conversations_with(request("network-denied"),context(),denied,&transport).await.err().unwrap().code,"network_restricted");
        assert!(transport.sent.lock().unwrap().is_empty());
        let transport=FixtureTransport::new(vec![(200,inventory("free")),(200,page())]);transport.replies.lock().unwrap()[1].body=b"broken-json".to_vec();
        assert_eq!(ChatgptService::default().archive_conversations_with(request("json-error"),context(),|m,p|rpc("free",m,p),&transport).await.err().unwrap().code,"invalid_response");
        let transport=FixtureTransport::new(vec![(200,inventory("plus")),(401,Value::Null),(200,snapshot("1625797156",true,true,true)),(200,page())]);
        assert_eq!(ChatgptService::default().archive_conversations_with(request("bootstrap-refresh"),context(),|m,p|rpc("plus",m,p),&transport).await.unwrap().access.include_work_cloud,Some(true));
        assert_eq!(transport.sent.lock().unwrap().iter().filter(|request|request.method==HttpMethod::Post).count(),2);
    }

    #[tokio::test]
    async fn archive_conversations_cancel_and_generation_aba_drop_each_inflight_stage() {
        for plan in ["free","plus","team"] {
            let replies=match plan {
                "free"=>vec![(200,inventory(plan)),(200,page())],
                "plus"=>vec![(200,inventory(plan)),(200,snapshot("1625797156",true,false,false)),(200,page())],
                _=>vec![(200,inventory(plan)),(200,settings(true,false)),(200,snapshot("1463309241",true,false,false)),(200,page())],
            };
            for stage in 0..replies.len(){for invalidate in [false,true] {
                let service=ChatgptService::default();let mut transport=FixtureTransport::new(replies.clone());transport.pause_at=stage;
                let read=service.archive_conversations_with(request("pending"),context(),|m,p|rpc(plan,m,p),&transport);
                let change=async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate{service.invalidate();service.invalidate();}else{service.cancel("pending");}};
                assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate{"account_changed"}else{"cancelled"});
                assert_eq!(transport.sent.lock().unwrap().len(),stage+1);assert!(service.active.lock().unwrap().is_empty());
            }}
        }
        let service=ChatgptService::default();service.cancel("before-register");let transport=FixtureTransport::new(vec![]);
        assert_eq!(service.archive_conversations_with(request("before-register"),context(),|m,p|rpc("free",m,p),&transport).await.err().unwrap().code,"cancelled");
        let service=ChatgptService::default();let guard=service.session.lock().await;
        let read=service.archive_conversations_with(request("queued"),context(),|m,p|rpc("free",m,p),&transport);
        let cancel=async{tokio::task::yield_now().await;service.cancel("queued");};
        assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,"cancelled");drop(guard);
        assert!(transport.sent.lock().unwrap().is_empty());
        let mut changed=request("changed-user");changed.expected_identity.user_id="other-user".into();
        assert_eq!(ChatgptService::default().archive_conversations_with(changed,context(),|m,p|rpc("free",m,p),&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.sent.lock().unwrap().is_empty());
    }
}
