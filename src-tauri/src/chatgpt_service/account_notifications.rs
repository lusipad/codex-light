//! Personal ChatGPT notification settings. No URL or credentials cross IPC.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountNotificationsRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountNotificationsWriteRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub category: String,
    pub channel: String,
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountNotificationsResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub body: Value,
}

fn notification_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}

/// Validate only the consumed schema and retain server order and labels.
/// Unknown server fields are discarded, rather than exposed through IPC.
fn notification_settings(body: &Value) -> ServiceResult<Vec<Value>> {
    let rows = body.get("settings").and_then(Value::as_array)
        .ok_or_else(|| failure("invalid_response", "Invalid notification settings"))?;
    let mut categories = std::collections::HashSet::new();
    rows.iter().map(|row| {
        let category = row.get("category").and_then(Value::as_str)
            .filter(|value| notification_identifier(value))
            .ok_or_else(|| failure("invalid_response", "Invalid notification category"))?;
        if !categories.insert(category) { return Err(failure("invalid_response", "Duplicate notification category")); }
        let name = row.get("name").and_then(Value::as_str)
            .ok_or_else(|| failure("invalid_response", "Invalid notification name"))?;
        let description = row.get("description").and_then(Value::as_str)
            .ok_or_else(|| failure("invalid_response", "Invalid notification description"))?;
        let options = row.get("options").and_then(Value::as_array)
            .ok_or_else(|| failure("invalid_response", "Invalid notification options"))?;
        let mut channels = std::collections::HashSet::new();
        let options = options.iter().map(|option| {
            let channel = option.get("channel").and_then(Value::as_str)
                .filter(|value| notification_identifier(value))
                .ok_or_else(|| failure("invalid_response", "Invalid notification channel"))?;
            if !channels.insert(channel) { return Err(failure("invalid_response", "Duplicate notification channel")); }
            let name = option.get("name").and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_response", "Invalid notification option name"))?;
            let enabled = option.get("enabled").and_then(Value::as_bool)
                .ok_or_else(|| failure("invalid_response", "Invalid notification option value"))?;
            Ok(json!({"channel":channel,"name":name,"enabled":enabled}))
        }).collect::<ServiceResult<Vec<_>>>()?;
        Ok(json!({"category":category,"name":name,"description":description,"options":options}))
    }).collect()
}

fn notification_value(settings: &[Value], category: &str, channel: &str) -> Option<bool> {
    settings.iter().find(|row| row["category"] == category)?["options"].as_array()?
        .iter().find(|option| option["channel"] == channel)?["enabled"].as_bool()
}

fn notification_contacts(body: &Value, identity: &ServiceIdentity) -> ServiceResult<Value> {
    validate_profile_read(&ServiceOperation::AccountMe, body, identity)?;
    let available = |key| match body.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::String(value)) => Ok(!value.is_empty()),
        _ => Err(failure("invalid_response", "Invalid notification contact eligibility")),
    };
    Ok(json!({"email":available("email")?,"sms":available("phone_number")?}))
}

impl ChatgptService {
    pub async fn account_notifications_read<F, Fut>(&self, request: AccountNotificationsRequest, call: F) -> ServiceResult<AccountNotificationsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.account_notifications_with(request, None, call, &CurlTransport).await
            .map(|response| AccountNotificationsResponse { request_id:response.request_id, identity:response.identity, body:response.readback })
    }

    pub async fn account_notifications_write<F, Fut>(&self, request: AccountNotificationsWriteRequest, call: F) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.account_notifications_with(AccountNotificationsRequest {
            request_id:request.request_id, expected_identity:request.expected_identity, profile:request.profile,
        }, Some((request.category, request.channel, request.enabled)), call, &CurlTransport).await
    }

    async fn account_notifications_with<F, Fut, T>(&self, request: AccountNotificationsRequest,
        update: Option<(String, String, bool)>, call: F, transport: &T) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        if update.as_ref().is_some_and(|(category,channel,_)| !notification_identifier(category) || !notification_identifier(channel)) {
            return Err(failure("invalid_request", "Invalid notification update"));
        }
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        self.check_share_current(identity, &registration)?;
        let accepted = AtomicBool::new(false);
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Notification request cancelled; a sent write may already have applied")),
            result = async {
                // Keep eligibility, current fields, PATCH and verification in one existing session.
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, &call, false).await?;
                self.check_share_current(identity, &registration)?;
                let account = call("account/read", json!({"refreshToken":false})).await
                    .map_err(|_| failure("notifications_account_unavailable", "Account information unavailable"))?;
                self.check_share_current(identity, &registration)?;
                let current = session.credentials.as_ref().unwrap();
                if &current.identity != identity || account.pointer("/workspaceRouting/chatgptAccountId").and_then(Value::as_str) != Some(identity.account_id.as_str()) {
                    return Err(failure("account_changed", "Authenticated account changed"));
                }
                if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
                    return Err(failure("not_logged_in", "ChatGPT login required"));
                }
                // Desktop host installs supportedSurface:true; no renderer gate override is accepted.
                let plan = account.pointer("/account/planType").and_then(Value::as_str)
                    .ok_or_else(|| failure("notifications_account_unavailable", "Account plan unavailable"))?;
                let allowed = if !notification_plan(plan) { false } else {
                    let inventory = self.notification_http("/backend-api/wham/accounts/check", HttpMethod::Get, None,
                        &request, &registration, &mut session, &call, transport).await
                        .map_err(notification_account_error)?;
                    notification_personal_account(&inventory, identity)?
                };
                if !allowed {
                    if update.is_some() { return Err(failure("forbidden", "Personal notification settings unavailable")); }
                    return Ok(ProfileMutationResponse { request_id:request.request_id.clone(), identity:identity.clone(), body:Value::Null,
                        readback:json!({"access":"denied","settings":[],"contacts":null,"contactsError":false}), verification:"not_applicable" });
                }
                let settings = self.notification_http("/backend-api/notifications/settings", HttpMethod::Get, None,
                    &request, &registration, &mut session, &call, transport).await?;
                let settings = notification_settings(&settings)?;
                let mut contacts = Value::Null;
                let mut contacts_error = false;
                if settings.iter().any(|row| row["category"] == "teen_safety") {
                    let read = self.notification_http("/backend-api/me", HttpMethod::Get, None,
                        &request, &registration, &mut session, &call, transport).await
                        .and_then(|body| notification_contacts(&body, identity));
                    match read {
                        Ok(value) => contacts = value,
                        Err(error) if matches!(error.code,"account_changed"|"cancelled") => return Err(error),
                        Err(_) => contacts_error = true,
                    }
                }
                let page = |settings| json!({"access":"allowed","settings":settings,"contacts":contacts,"contactsError":contacts_error});
                let Some((category, channel, enabled)) = &update else {
                    return Ok(ProfileMutationResponse { request_id:request.request_id.clone(), identity:identity.clone(), body:Value::Null,
                        readback:page(settings), verification:"not_applicable" });
                };
                if notification_value(&settings, category, channel).is_none() {
                    return Err(failure("invalid_request", "Notification field is not available"));
                }
                if category == "teen_safety" && (contacts_error || contacts.is_null() ||
                    (channel == "email" && contacts["email"] != true) || (channel == "sms" && contacts["sms"] != true)) {
                    return Err(failure("notifications_contacts_unavailable", "Notification contact channel is unavailable"));
                }
                let mut channels = serde_json::Map::new(); channels.insert(channel.clone(), json!(enabled));
                let mut categories = serde_json::Map::new(); categories.insert(category.clone(), Value::Object(channels));
                let patch = json!({"updates":categories});
                let body = self.notification_http("/backend-api/notifications/settings", HttpMethod::Patch, Some(&patch),
                    &request, &registration, &mut session, &call, transport).await?;
                accepted.store(true, Ordering::SeqCst);
                let readback = self.notification_http("/backend-api/notifications/settings", HttpMethod::Get, None,
                    &request, &registration, &mut session, &call, transport).await?;
                let readback = notification_settings(&readback)?;
                let confirmed = notification_value(&readback, category, channel) == Some(*enabled);
                // Return only validated settings; persistence is established by GET, never PATCH alone.
                let body = notification_settings(&body).ok().map(|settings| json!({"settings":settings})).unwrap_or(Value::Null);
                Ok(ProfileMutationResponse { request_id:request.request_id.clone(), identity:identity.clone(), body,
                    readback:page(readback), verification:if confirmed {"confirmed"} else {"pending"} })
            } => result,
        };
        self.check_share_current(identity, &registration)?;
        if accepted.load(Ordering::SeqCst) {
            result.map_err(|error| if matches!(error.code,"account_changed"|"cancelled") { error }
                else { failure("notifications_readback_failed", "Notification write may be saved but readback failed; read before retrying") })
        } else { result }
    }

    #[allow(clippy::too_many_arguments)]
    async fn notification_http<F, Fut, T>(&self, route: &'static str, method: HttpMethod, body: Option<&Value>,
        request: &AccountNotificationsRequest, registration: &Registration<'_>, session: &mut Session, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let identity = &request.expected_identity;
        let encoded = body.map(serde_json::to_vec).transpose().map_err(|_| failure("invalid_request", "Invalid notification update"))?.unwrap_or_default();
        for attempt in 0..2 {
            self.check_share_current(identity, registration)?;
            let credentials = session.credentials.as_ref().unwrap();
            if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
            let integrity = session.integrity.clone();
            let mut outgoing = build_http_request(route, credentials, integrity.as_deref(), &request.profile)?;
            outgoing.method = method; outgoing.body = encoded.clone();
            if body.is_some() { outgoing.headers.insert("Content-Type".into(), "application/json".into()); }
            share_network_allowed(call, &outgoing.url).await?;
            self.check_share_current(identity, registration)?;
            let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                .map_err(|error| if method == HttpMethod::Patch { failure("notifications_write_unknown", "Notification write outcome unknown; read before retrying") } else { error })?;
            self.check_share_current(identity, registration)?;
            apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response) {
                return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) });
            }
            if response.status == 401 && attempt == 0 { self.prepare(session, identity.generation, call, true).await?; continue; }
            if method == HttpMethod::Patch && response.status >= 500 {
                return Err(failure("notifications_write_unknown", "Notification write outcome unknown; read before retrying"));
            }
            if method == HttpMethod::Patch && (200..300).contains(&response.status) {
                return Ok(serde_json::from_slice(&response.body).unwrap_or(Value::Null));
            }
            return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
        }
        unreachable!()
    }
}

fn notification_account_error(error: ServiceError) -> ServiceError {
    if matches!(error.code,"account_changed"|"cancelled"|"not_logged_in") { error }
    else { failure("notifications_account_unavailable", "Account information unavailable") }
}

// Odt/Adt in the fixed reference. Other similarly named package plans are not allowed.
fn notification_plan(plan: &str) -> bool {
    matches!(plan, "free"|"go"|"plus"|"pro"|"promax"|"prolite"|"free_workspace"|"team"|
        "self_serve_business_prolite"|"sci"|"rosalind_academic"|"business"|"enterprise_cbp_trial"|
        "enterprise_cbp_view_only"|"finserv"|"law"|"ent26"|"education"|"edu_plus"|"edu_pro"|
        "quorum"|"enterprise"|"hc"|"hc_consumption"|"deprecated_enterprise"|"edu"|"deprecated_edu"|"k12")
}

fn notification_personal_account(body: &Value, identity: &ServiceIdentity) -> ServiceResult<bool> {
    let invalid = || failure("notifications_account_unavailable", "Account membership unavailable");
    // /wham/accounts/check raw inventory, before official h_t normalization.
    let accounts = body.get("accounts").and_then(Value::as_object).ok_or_else(invalid)?;
    let ordering = body.get("account_ordering").and_then(Value::as_array).ok_or_else(invalid)?;
    let mut ids = std::collections::HashSet::new();
    let mut selected = None;
    for key in ordering {
        let key = key.as_str().filter(|key| !key.is_empty()).ok_or_else(invalid)?;
        if !ids.insert(key) { return Err(invalid()); }
        let entry = accounts.get(key).ok_or_else(invalid)?;
        let account = entry.get("account").and_then(Value::as_object).ok_or_else(invalid)?;
        let string = |field| account.get(field).and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or_else(invalid);
        let account_id = string("account_id")?;
        string("account_user_id")?; string("account_user_role")?;
        let structure = string("structure")?;
        let plan = string("plan_type")?;
        if !account.get("is_zdr").is_some_and(Value::is_boolean) { return Err(invalid()); }
        if entry.get("can_access_with_session").is_some_and(|value| !value.is_null() && !value.is_boolean()) ||
            account.get("is_deactivated").is_some_and(|value| !value.is_null() && !value.is_boolean()) {
            return Err(invalid());
        }
        if key == identity.account_id || account_id == identity.account_id {
            if key != identity.account_id || account_id != identity.account_id || selected.is_some() { return Err(invalid()); }
            selected = Some(structure == "personal" && notification_plan(plan) &&
                account.get("is_deactivated") != Some(&Value::Bool(true)) && entry.get("can_access_with_session") != Some(&Value::Bool(false)));
        }
    }
    Ok(selected.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn identity() -> ServiceIdentity {
        ServiceIdentity { account_id:"notification-account".into(), user_id:"notification-user".into(), generation:0 }
    }

    fn request(id: &str) -> AccountNotificationsRequest {
        AccountNotificationsRequest { request_id:id.into(), expected_identity:identity(), profile:ServiceProfile {
            language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into(),
        } }
    }

    fn account(plan: &str) -> Value {
        json!({"account":{"type":"chatgpt","planType":plan},"workspaceRouting":{
            "backendOrigin":"https://chatgpt.com","chatgptAccountId":"notification-account","accountRoutingOverride":"NO_CONSTRAINT"}})
    }

    fn token() -> String {
        let claims = json!({"exp":4102444800u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"notification-account","user_id":"notification-user","chatgpt_account_is_fedramp":false}});
        format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))
    }

    async fn rpc(method: &'static str, _: Value) -> Result<Value, String> {
        Ok(match method {
            "getAuthStatus" => json!({"authMethod":"chatgpt","authToken":token()}),
            "account/read" => account("plus"),
            "configRequirements/read" => json!({"requirements":null}),
            _ => panic!("unexpected RPC {method}"),
        })
    }

    fn inventory() -> Value {
        json!({"account_ordering":["notification-account"],"accounts":{"notification-account":{
            "account":{"account_id":"notification-account","account_user_id":"membership-not-user-id","account_user_role":"owner",
                "structure":"personal","plan_type":"plus","is_zdr":false},"can_access_with_session":true}}})
    }

    fn settings(enabled: bool) -> Value {
        json!({"settings":[{"category":"dynamic_category","name":"动态服务名称","description":"服务端描述",
            "options":[{"channel":"new_channel","name":"渠道名","enabled":enabled},{"channel":"email","name":"邮件","enabled":false}],"ignored_secret":"not-public"}]})
    }

    fn teen() -> Value {
        json!({"settings":[{"category":"teen_safety","name":"家庭","description":"联系人",
            "options":[{"channel":"email","name":"邮件","enabled":false},{"channel":"sms","name":"短信","enabled":false},{"channel":"future","name":"其他","enabled":false}]}]})
    }

    struct TestTransport {
        replies: Mutex<VecDeque<ServiceResult<HttpResponse>>>,
        sent: Mutex<Vec<HttpRequest>>,
        pause_at: usize,
        entered: AtomicBool,
    }

    impl TestTransport {
        fn new(replies: Vec<(u16, Value)>) -> Self {
            Self { replies:Mutex::new(replies.into_iter().map(|(status,body)| Ok(HttpResponse {
                status,body:serde_json::to_vec(&body).unwrap(),headers:BTreeMap::new(),
            })).collect()),sent:Mutex::new(Vec::new()),pause_at:usize::MAX,entered:AtomicBool::new(false) }
        }
    }

    impl Transport for TestTransport {
        fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move {
                let index = { let mut sent = self.sent.lock().unwrap(); sent.push(request); sent.len()-1 };
                if index == self.pause_at {
                    self.entered.store(true, Ordering::SeqCst);
                    tokio::select! {
                        _ = cancelled(&cancel) => return Err(failure("cancelled", "test cancelled")),
                        _ = tokio::time::sleep(Duration::from_millis(150)) => {},
                    }
                }
                self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")
            })
        }
    }

    #[tokio::test]
    async fn account_notifications_reads_dynamic_rows_without_private_contacts_or_metadata() {
        let transport = TestTransport::new(vec![(200,inventory()),(200,settings(false))]);
        let result = ChatgptService::default().account_notifications_with(request("read"),None,rpc,&transport).await.unwrap();
        assert_eq!(result.readback["access"],"allowed");
        assert_eq!(result.readback["settings"][0]["name"],"动态服务名称");
        assert_eq!(result.readback["settings"][0]["options"][0]["channel"],"new_channel");
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("not-public") && !serialized.contains(&token()));
        let sent = transport.sent.lock().unwrap();
        assert_eq!(sent.len(),2);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/wham/accounts/check");
        assert_eq!(sent[1].url,"https://chatgpt.com/backend-api/notifications/settings");
        assert!(sent.iter().all(|request| request.method == HttpMethod::Get && request.headers["ChatGPT-Account-Id"] == "notification-account"));
    }

    #[tokio::test]
    async fn account_notifications_patch_is_single_dynamic_field_then_real_get() {
        let transport = TestTransport::new(vec![(200,inventory()),(200,settings(false)),(200,settings(true)),(200,settings(true))]);
        let result = ChatgptService::default().account_notifications_with(request("write"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");
        assert_eq!(result.readback["settings"][0]["options"][0]["enabled"],true);
        let sent = transport.sent.lock().unwrap();
        assert_eq!(sent.len(),4);
        assert_eq!(sent[2].method,HttpMethod::Patch);
        assert_eq!(serde_json::from_slice::<Value>(&sent[2].body).unwrap(),json!({"updates":{"dynamic_category":{"new_channel":true}}}));
        assert_eq!(sent[3].method,HttpMethod::Get);
        assert!(sent[3].body.is_empty());
    }

    #[tokio::test]
    async fn account_notifications_plan_and_raw_personal_membership_are_authoritative() {
        for plan in ["unknown","self_serve_business_usage_based","enterprise_cbp_usage_based","enterprise_cbp_automation"] {
            let transport = TestTransport::new(vec![]);
            let custom = |method,params| { let plan=plan.to_owned(); async move {
                if method == "account/read" { Ok(account(&plan)) } else { rpc(method,params).await }
            }};
            let result = ChatgptService::default().account_notifications_with(request("plan"),None,custom,&transport).await.unwrap();
            assert_eq!(result.readback["access"],"denied"); assert!(transport.sent.lock().unwrap().is_empty());
        }
        for (field,value) in [("structure",json!("workspace")),("is_deactivated",json!(true)),("plan_type",json!("unsupported"))] {
            let mut raw=inventory(); raw["accounts"]["notification-account"]["account"][field]=value;
            let transport=TestTransport::new(vec![(200,raw)]);
            let error=ChatgptService::default().account_notifications_with(request("denied"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.err().unwrap();
            assert_eq!(error.code,"forbidden"); assert_eq!(transport.sent.lock().unwrap().len(),1);
        }
        let mut denied=inventory(); denied["accounts"]["notification-account"]["can_access_with_session"]=json!(false);
        assert!(!notification_personal_account(&denied,&identity()).unwrap());
        for raw in [json!({"accounts":[]}),json!({"account_ordering":["notification-account","notification-account"],"accounts":inventory()["accounts"]}),
            json!({"account_ordering":["notification-account"],"accounts":{"notification-account":{"account":{"structure":"personal"}}}})] {
            assert_eq!(notification_personal_account(&raw,&identity()).err().unwrap().code,"notifications_account_unavailable");
        }
    }

    #[tokio::test]
    async fn account_notifications_reject_unknown_fields_duplicates_and_malformed_rows_before_patch() {
        for (category,channel) in [("absent","email"),("dynamic_category","missing")] {
            let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false))]);
            assert_eq!(ChatgptService::default().account_notifications_with(request("unknown"),Some((category.into(),channel.into(),true)),rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.sent.lock().unwrap().iter().all(|request|request.method==HttpMethod::Get));
        }
        let mut duplicate=settings(false); duplicate["settings"].as_array_mut().unwrap().push(settings(true)["settings"][0].clone());
        let mut duplicate_channel=settings(false); duplicate_channel["settings"][0]["options"].as_array_mut().unwrap().push(settings(false)["settings"][0]["options"][0].clone());
        let mut nonbool=settings(false); nonbool["settings"][0]["options"][0]["enabled"]=json!("true");
        for body in [Value::Null,json!({}),duplicate,duplicate_channel,nonbool] {
            assert_eq!(notification_settings(&body).err().unwrap().code,"invalid_response");
        }
        assert!(notification_settings(&json!({"settings":[]})).unwrap().is_empty());
        assert!(notification_settings(&json!({"settings":[{"category":"empty","name":"","description":"","options":[]}]})).unwrap()[0]["options"].as_array().unwrap().is_empty());
        assert!(serde_json::from_value::<AccountNotificationsWriteRequest>(json!({"requestId":"x","expectedIdentity":identity(),"profile":{
            "language":"x","deviceId":"x","userAgent":"x","userAgentClientHints":"x","platformClientHint":"x"},
            "category":"tasks","channel":"push","enabled":true,"url":"https://attacker.test"})).is_err());
    }

    #[tokio::test]
    async fn account_notifications_contacts_are_private_and_rechecked_before_teen_writes() {
        for (email,phone) in [(None,None),(Some("private@example.test"),None),(None,Some("+123456789")),(Some("private@example.test"),Some("+123456789"))] {
            let contact=json!({"id":"notification-user","email":email,"phone_number":phone});
            let transport=TestTransport::new(vec![(200,inventory()),(200,teen()),(200,contact.clone())]);
            let result=ChatgptService::default().account_notifications_with(request("contacts"),None,rpc,&transport).await.unwrap();
            assert_eq!(result.readback["contacts"],json!({"email":email.is_some(),"sms":phone.is_some()}));
            let text=serde_json::to_string(&result).unwrap(); assert!(!text.contains("private@example.test") && !text.contains("+123456789"));
            for (channel,available) in [("email",email.is_some()),("sms",phone.is_some()),("future",true)] {
                let mut replies=vec![(200,inventory()),(200,teen()),(200,contact.clone())];
                if available { replies.extend([(204,Value::Null),(200,teen())]); }
                let transport=TestTransport::new(replies);
                let result=ChatgptService::default().account_notifications_with(request("contact-write"),Some(("teen_safety".into(),channel.into(),true)),rpc,&transport).await;
                if available { assert_eq!(result.unwrap().verification,"pending"); }
                else { assert_eq!(result.err().unwrap().code,"notifications_contacts_unavailable"); }
                assert_eq!(transport.sent.lock().unwrap().iter().filter(|request|request.method==HttpMethod::Patch).count(),usize::from(available));
            }
        }
        let transport=TestTransport::new(vec![(200,inventory()),(200,teen()),(500,Value::Null)]);
        let result=ChatgptService::default().account_notifications_with(request("contact-error"),None,rpc,&transport).await.unwrap();
        assert_eq!(result.readback["contactsError"],true);
        assert_eq!(result.readback["settings"].as_array().unwrap().len(),1);
        let transport=TestTransport::new(vec![(200,inventory()),(200,teen()),(500,Value::Null)]);
        assert_eq!(ChatgptService::default().account_notifications_with(request("contact-error-write"),Some(("teen_safety".into(),"future".into(),true)),rpc,&transport).await.err().unwrap().code,"notifications_contacts_unavailable");
        assert_eq!(transport.sent.lock().unwrap().len(),3);
        let transport=TestTransport::new(vec![(200,inventory()),(200,teen()),(200,json!({"id":"other-user","email":"private@example.test"}))]);
        assert_eq!(ChatgptService::default().account_notifications_with(request("contact-user"),None,rpc,&transport).await.err().unwrap().code,"account_changed");
    }

    #[tokio::test]
    async fn account_notifications_write_failures_are_not_success_or_blind_replay() {
        for (status,expected) in [(403,"forbidden"),(429,"rate_limited"),(500,"notifications_write_unknown")] {
            let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false)),(status,Value::Null)]);
            let error=ChatgptService::default().account_notifications_with(request("write-error"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.err().unwrap();
            assert_eq!(error.code,expected); assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
        let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false)),(200,settings(true)),(500,Value::Null)]);
        assert_eq!(ChatgptService::default().account_notifications_with(request("readback-error"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.err().unwrap().code,"notifications_readback_failed");
        let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false))]);
        transport.replies.lock().unwrap().push_back(Err(failure("network_error","fixture failed")));
        assert_eq!(ChatgptService::default().account_notifications_with(request("network-error"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.err().unwrap().code,"notifications_write_unknown");
        assert_eq!(transport.sent.lock().unwrap().len(),3);
    }

    #[tokio::test]
    async fn account_notifications_only_explicit_401_refreshes_once_without_rechecking_writes() {
        let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false)),(401,Value::Null),(200,settings(true)),(200,settings(true))]);
        let refreshes=AtomicUsize::new(0);
        let call=|method,params:Value| { if method=="getAuthStatus" && params["refreshToken"]==true { refreshes.fetch_add(1,Ordering::SeqCst); } rpc(method,params) };
        let result=ChatgptService::default().account_notifications_with(request("refresh"),Some(("dynamic_category".into(),"new_channel".into(),true)),call,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed"); assert_eq!(refreshes.load(Ordering::SeqCst),1);
        let sent=transport.sent.lock().unwrap(); assert_eq!(sent[2].body,sent[3].body); drop(sent);
        for body in [Value::Null,json!({"error":{"type":"ip_not_authorized"}})] {
            let ip=!body.is_null();
            let mut replies=vec![(200,inventory()),(200,settings(false)),(401,body)];
            if !ip { replies.push((401,Value::Null)); }
            let transport=TestTransport::new(replies);
            let error=ChatgptService::default().account_notifications_with(request("no-repeat"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.err().unwrap();
            assert_eq!(error.code,if ip {"ip_not_authorized"} else {"unauthorized"});
            assert_eq!(transport.sent.lock().unwrap().len(),if ip {3} else {4});
        }
    }

    #[tokio::test]
    async fn account_notifications_refresh_identity_change_cannot_replay_and_readback_refresh_never_rewrites() {
        let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false)),(401,Value::Null)]);
        let changed=|method,params:Value| async move {
            if method=="getAuthStatus" && params["refreshToken"]==true {
                let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"other-account","user_id":"notification-user"}});
                let token=format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
                Ok(json!({"authMethod":"chatgpt","authToken":token}))
            } else { rpc(method,params).await }
        };
        assert_eq!(ChatgptService::default().account_notifications_with(request("refresh-changed"),Some(("dynamic_category".into(),"new_channel".into(),true)),changed,&transport).await.err().unwrap().code,"account_changed");
        assert_eq!(transport.sent.lock().unwrap().len(),3);
        let transport=TestTransport::new(vec![(200,inventory()),(200,settings(false)),(204,Value::Null),(401,Value::Null),(200,settings(true))]);
        let result=ChatgptService::default().account_notifications_with(request("readback-refresh"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");
        assert_eq!(transport.sent.lock().unwrap().iter().filter(|request|request.method==HttpMethod::Patch).count(),1);
        let transport=TestTransport::new(vec![]);
        let apikey=|method,params| async move {
            if method=="getAuthStatus" { Ok(json!({"authMethod":"apiKey","authToken":"private-not-chatgpt"})) }
            else { rpc(method,params).await }
        };
        assert_eq!(ChatgptService::default().account_notifications_with(request("api-key"),None,apikey,&transport).await.err().unwrap().code,"not_logged_in");
        assert!(transport.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn account_notifications_cancel_generation_aba_and_policy_drop_late_reads_and_writes() {
        for pause_at in [0,2] { for invalidate in [false,true] {
            let service=ChatgptService::default();
            let mut transport=TestTransport::new(vec![(200,inventory()),(200,settings(false)),(200,settings(true)),(200,settings(true))]);
            transport.pause_at=pause_at;
            let operation=service.account_notifications_with(request("cancel"),Some(("dynamic_category".into(),"new_channel".into(),true)),rpc,&transport);
            let change=async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); service.invalidate(); } else { service.cancel("cancel"); }
            };
            let (result,_)=tokio::join!(operation,change);
            assert_eq!(result.err().unwrap().code,if invalidate {"account_changed"} else {"cancelled"});
            assert_eq!(transport.sent.lock().unwrap().len(),pause_at+1);
            assert!(service.active.lock().unwrap().is_empty());
        }}
        let service=ChatgptService::default(); service.cancel("pre-cancel");
        let transport=TestTransport::new(vec![]);
        assert_eq!(service.account_notifications_with(request("pre-cancel"),None,rpc,&transport).await.err().unwrap().code,"cancelled");
        let denied=|method,params| async move {
            if method=="configRequirements/read" { Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})) }
            else { rpc(method,params).await }
        };
        let transport=TestTransport::new(vec![]);
        assert_eq!(ChatgptService::default().account_notifications_with(request("policy"),None,denied,&transport).await.err().unwrap().code,"notifications_account_unavailable");
        assert!(transport.sent.lock().unwrap().is_empty());
    }
}
