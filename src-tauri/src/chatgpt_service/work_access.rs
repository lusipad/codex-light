//! A narrow local account-info projection. No token, raw claims, HTTP or profile
//! crosses this boundary; Work plan comes from the fresh authenticated JWT.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkAccountInfoRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAccountInfoResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub auth_method: String,
    pub plan: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkHomePreferencesResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub preferences: Value,
}

impl ChatgptService {
    pub async fn work_account_info<F, Fut>(
        &self,
        request: WorkAccountInfoRequest,
        call: F,
    ) -> ServiceResult<WorkAccountInfoResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.with_work_account_info(request, call, Ok).await
    }

    pub async fn work_home_preferences<F, Fut>(
        &self,
        request: WorkAccountInfoRequest,
        state: &crate::state::DesktopStateManager,
        call: F,
    ) -> ServiceResult<WorkHomePreferencesResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.with_work_account_info(request, call, |account| {
            let preferences = state.work_home_preferences(&account.identity)
                .map_err(|_| failure("invalid_work_preferences", "Work preferences could not be confirmed"))?;
            Ok(WorkHomePreferencesResponse {request_id:account.request_id, identity:account.identity, preferences})
        }).await
    }

    async fn with_work_account_info<F, Fut, T>(
        &self, request: WorkAccountInfoRequest, call: F,
        read: impl FnOnce(WorkAccountInfoResponse) -> ServiceResult<T>,
    ) -> ServiceResult<T>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        let registration = self.register(&request.request_id)?;
        self.check_share_current(&request.expected_identity, &registration)?;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Work account information read cancelled")),
            result = async {
                // Do not prepare/reuse credential cache here: the plan may have
                // changed while a still-valid cached credential has the old JWT.
                let auth = call("getAuthStatus", json!({"includeToken":true,"refreshToken":false})).await
                    .map_err(|_| failure("auth_unavailable", "Authentication status method unavailable"))?;
                self.check_share_current(&request.expected_identity, &registration)?;
                verified_info(&auth, &request.expected_identity)?;
                let account = call("account/read", json!({"refreshToken":false})).await
                    .map_err(|_| failure("routing_unavailable", "Workspace routing unavailable"))?;
                self.check_share_current(&request.expected_identity, &registration)?;
                if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
                    return Err(failure("not_logged_in", "ChatGPT account information required"));
                }
                let routing = account.get("workspaceRouting").and_then(Value::as_object)
                    .ok_or_else(|| failure("routing_unavailable", "Workspace routing unavailable"))?;
                let routed_account = routing.get("chatgptAccountId").and_then(Value::as_str)
                    .ok_or_else(|| failure("routing_unavailable", "Workspace routing unavailable"))?;
                if routed_account != request.expected_identity.account_id {
                    return Err(failure("account_changed", "Token and workspace account differ"));
                }
                // Recheck the principal after the routing await; return this
                // last fresh claim projection rather than mixing cached plans.
                let auth = call("getAuthStatus", json!({"includeToken":true,"refreshToken":false})).await
                    .map_err(|_| failure("auth_unavailable", "Authentication status method unavailable"))?;
                self.check_share_current(&request.expected_identity, &registration)?;
                let (auth_method, plan) = verified_info(&auth, &request.expected_identity)?;
                Ok(WorkAccountInfoResponse {request_id:request.request_id,
                    identity:request.expected_identity.clone(),auth_method,plan})
            } => result,
        };
        self.check_share_current(&request.expected_identity, &registration)?;
        let value = read(result?)?;
        self.check_share_current(&request.expected_identity, &registration)?;
        Ok(value)
    }
}

fn verified_info(
    auth: &Value,
    expected: &ServiceIdentity,
) -> ServiceResult<(String, Option<String>)> {
    let method = auth
        .get("authMethod")
        .and_then(Value::as_str)
        .filter(|method| matches!(*method, "chatgpt" | "chatgptAuthTokens"))
        .ok_or_else(|| failure("not_logged_in", "ChatGPT login required"))?;
    let token = auth
        .get("authToken")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| failure("not_logged_in", "ChatGPT login required"))?;
    let (account_id, user_id, expires, _) = parse_token(token)?;
    if account_id != expected.account_id || user_id != expected.user_id {
        return Err(failure("account_changed", "Authenticated identity changed"));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if expires <= now {
        return Err(failure("auth_expired", "ChatGPT credentials expired"));
    }
    // parse_token already validates the bounded token/payload. Preserve the
    // official raw string/null projection without aliases, trimming or enums.
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(token.split('.').nth(1).unwrap_or(""))
        .map_err(|_| failure("invalid_auth", "Invalid ChatGPT credential"))?;
    let claims: Value = serde_json::from_slice(&decoded)
        .map_err(|_| failure("invalid_auth", "Invalid ChatGPT credential"))?;
    // WS08 uses this exact raw claim for C.accountId. The shared credential
    // parser's legacy account_id fallback must not become Work access evidence.
    let raw_account = claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| failure("invalid_auth", "Raw ChatGPT account claim required"))?;
    if raw_account != expected.account_id {
        return Err(failure("account_changed", "Authenticated identity changed"));
    }
    let plan = claims
        .pointer("/https:~1~1api.openai.com~1auth/chatgpt_plan_type")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok((method.to_owned(), plan))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> ServiceIdentity {
        ServiceIdentity {
            account_id: "work-account".into(),
            user_id: "work-user".into(),
            generation: 0,
        }
    }
    fn request(id: &str) -> WorkAccountInfoRequest {
        WorkAccountInfoRequest {
            request_id: id.into(),
            expected_identity: identity(),
        }
    }
    fn auth(plan: Option<Value>) -> Value {
        let mut claims = json!({"exp":4_000_000_000u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"work-account","user_id":"work-user","private_secret":"must-not-cross"}});
        if let Some(plan) = plan {
            claims["https://api.openai.com/auth"]["chatgpt_plan_type"] = plan;
        }
        let token = format!(
            "e30.{}.private-signature",
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&claims).unwrap())
        );
        json!({"authMethod":"chatgpt","authToken":token,"private":"must-not-cross"})
    }
    fn account() -> Value {
        json!({"account":{"type":"chatgpt","planType":"free"},"workspaceRouting":{"chatgptAccountId":"work-account"},"private":"must-not-cross"})
    }

    #[test]
    fn work_account_info_requires_raw_chatgpt_account_claim_not_legacy_alias() {
        for raw_account in [
            None,
            Some(Value::Null),
            Some(json!(17)),
            Some(json!("foreign-account")),
        ] {
            let mut claims = json!({"exp":4_000_000_000u64,"https://api.openai.com/auth":{
                "account_id":"work-account","user_id":"work-user","chatgpt_plan_type":"plus"}});
            if let Some(value) = raw_account {
                claims["https://api.openai.com/auth"]["chatgpt_account_id"] = value;
            }
            let token = format!(
                "e30.{}.s",
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .encode(serde_json::to_vec(&claims).unwrap())
            );
            let input = json!({"authMethod":"chatgpt","authToken":token});
            assert!(verified_info(&input, &identity()).is_err(), "Work must not promote an absent/invalid/mismatched raw account claim via the legacy account_id alias");
        }
        // These are different documented axes: service principal user_id is
        // not required to equal the ChatGPT profile/member chatgpt_user_id.
        let claims = json!({"exp":4_000_000_000u64,"https://api.openai.com/auth":{
            "chatgpt_account_id":"work-account","user_id":"work-user",
            "chatgpt_user_id":"different-profile-member","chatgpt_plan_type":" Raw Future "}});
        let token = format!(
            "e30.{}.s",
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&claims).unwrap())
        );
        assert_eq!(
            verified_info(
                &json!({"authMethod":"chatgpt","authToken":token}),
                &identity()
            )
            .unwrap()
            .1
            .as_deref(),
            Some(" Raw Future ")
        );
    }
    struct Rpc {
        responses: Mutex<VecDeque<Result<Value, String>>>,
        calls: Mutex<Vec<(&'static str, Value)>>,
    }
    impl Rpc {
        fn new(responses: Vec<Value>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().map(Ok).collect()),
                calls: Mutex::new(Vec::new()),
            }
        }
        async fn call(&self, method: &'static str, params: Value) -> Result<Value, String> {
            assert!(
                matches!(method, "getAuthStatus" | "account/read"),
                "unexpected RPC/HTTP path"
            );
            self.calls.lock().unwrap().push((method, params));
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected extra RPC")
        }
        fn assert_calls(&self) {
            for (method, params) in self.calls.lock().unwrap().iter() {
                assert_eq!(
                    params,
                    &if *method == "getAuthStatus" {
                        json!({"includeToken":true,"refreshToken":false})
                    } else {
                        json!({"refreshToken":false})
                    }
                );
            }
        }
    }

    #[tokio::test]
    async fn work_home_preferences_returns_only_the_authenticated_owner_view() {
        let service=ChatgptService::default();let owner=crate::appshots_preferences::owner_key(&identity()).unwrap();
        let state=crate::state::DesktopStateManager::fixture_for_appshots_preferences(json!({
            owner:{"home-composer-mode-v1":"work"},
            "electron-persisted-atom-state":{"work-run-location-v1":"cloud","unrelated-secret":"private"}
        }).as_object().unwrap().clone());
        let before=state.get_value("electron-persisted-atom-state");
        let fresh=auth(Some(json!("plus")));let rpc=Rpc::new(vec![fresh.clone(),account(),fresh]);
        let result=service.work_home_preferences(request("owner-view"),&state,|method,params|rpc.call(method,params)).await.unwrap();
        assert_eq!(result.request_id,"owner-view");assert_eq!(result.identity,identity());
        assert_eq!(result.preferences["atoms"]["home-composer-mode-v1"],"work");
        assert_eq!(result.preferences["unboundAtoms"],json!(["work-run-location-v1"]));
        let serialized=serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("private")&&!serialized.contains("authToken")&&!serialized.contains("cloud"));
        assert_eq!(state.get_value("electron-persisted-atom-state"),before);
        rpc.assert_calls();assert_eq!(rpc.calls.lock().unwrap().len(),3);
    }

    #[tokio::test]
    async fn work_home_snapshot_callback_stays_inside_authentication_and_retirement_fences() {
        let service=ChatgptService::default();let read=AtomicBool::new(false);
        let rpc=Rpc::new(vec![json!({"authMethod":"apikey"})]);
        assert!(service.with_work_account_info(request("no-auth-state"),|method,params|rpc.call(method,params),|_|{
            read.store(true,Ordering::SeqCst);Ok(Value::Null)
        }).await.is_err());
        assert!(!read.load(Ordering::SeqCst),"state is not read before fresh authentication succeeds");
        for cancel in [false,true] {
            let service=ChatgptService::default();let fresh=auth(None);let rpc=Rpc::new(vec![fresh.clone(),account(),fresh]);
            let result=service.with_work_account_info(request("retire-state"),|method,params|rpc.call(method,params),|_|{
                if cancel {service.cancel("retire-state");} else {service.invalidate();}
                Ok(json!({"must-not-return":true}))
            }).await;
            assert!(result.is_err(),"retirement during the atomic state read cannot release its response");
        }
    }

    #[tokio::test]
    async fn work_account_info_reads_jwt_plan_without_rpc_plan_alias_or_secret_leak() {
        let service = ChatgptService::default();
        for (index, value) in [
            Some(json!("plus")),
            Some(json!("UNRELEASED Plan")),
            Some(json!("")),
            None,
            Some(Value::Null),
            Some(json!(17)),
            Some(json!({"plan":"pro"})),
        ]
        .into_iter()
        .enumerate()
        {
            let fresh_auth = auth(value.clone());
            let rpc = Rpc::new(vec![fresh_auth.clone(), account(), fresh_auth]);
            let result = service
                .work_account_info(request(&format!("jwt-{index}")), |method, params| {
                    rpc.call(method, params)
                })
                .await
                .unwrap();
            assert_eq!(
                result.plan,
                value.and_then(|value| value.as_str().map(str::to_owned))
            );
            let projected = serde_json::to_value(result).unwrap();
            assert_eq!(projected.as_object().unwrap().len(), 4);
            let text = projected.to_string();
            assert!(
                !text.contains("private")
                    && !text.contains("authToken")
                    && !text.contains("must-not-cross")
            );
            rpc.assert_calls();
            assert_eq!(rpc.calls.lock().unwrap().len(), 3);
        }
    }

    #[tokio::test]
    async fn work_account_info_re_reads_updated_plan_and_accepts_auth_tokens_mode() {
        let service = ChatgptService::default();
        let cached_auth = auth(Some(json!("old-cached-plan")));
        service.session.lock().await.credentials = Some(Credentials {
            token: cached_auth["authToken"].as_str().unwrap().into(),
            identity: identity(),
            expires: 4_000_000_000,
            origin: "https://chatgpt.com".into(),
            routing_override: "NO_CONSTRAINT".into(),
            fedramp: false,
        });
        for (id, plan) in [("old", "plus"), ("new", "organization-future")] {
            let mut fresh_auth = auth(Some(json!(plan)));
            fresh_auth["authMethod"] = json!("chatgptAuthTokens");
            let rpc = Rpc::new(vec![fresh_auth.clone(), account(), fresh_auth]);
            let result = service
                .work_account_info(request(id), |method, params| rpc.call(method, params))
                .await
                .unwrap();
            assert_eq!(result.plan.as_deref(), Some(plan));
            assert_eq!(result.auth_method, "chatgptAuthTokens");
            rpc.assert_calls();
        }
        let rpc = Rpc::new(vec![
            auth(Some(json!("plus"))),
            account(),
            auth(Some(json!("updated-during-read"))),
        ]);
        assert_eq!(
            service
                .work_account_info(request("mid-read-update"), |method, params| rpc
                    .call(method, params))
                .await
                .unwrap()
                .plan
                .as_deref(),
            Some("updated-during-read")
        );
    }

    #[tokio::test]
    async fn work_account_info_rejects_identity_routing_and_unsupported_auth() {
        for scenario in ["identity", "routing", "auth", "late-identity"] {
            let service = ChatgptService::default();
            let good = auth(Some(json!("plus")));
            let mut routing = account();
            let mut expected = request(scenario);
            let mut first = good.clone();
            let mut last = good.clone();
            match scenario {
                "identity" => expected.expected_identity.user_id = "foreign-user".into(),
                "routing" => {
                    routing["workspaceRouting"]["chatgptAccountId"] = json!("foreign-account")
                }
                "auth" => first["authMethod"] = json!("apikey"),
                _ => {
                    last = {
                        let payload = json!({"exp":4_000_000_000u64,"https://api.openai.com/auth":{"chatgpt_account_id":"work-account","user_id":"late-foreign"}});
                        json!({"authMethod":"chatgpt","authToken":format!("e30.{}.s",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap()))})
                    }
                }
            }
            let rpc = Rpc::new(vec![first, routing, last]);
            let error = service
                .work_account_info(expected, |method, params| rpc.call(method, params))
                .await
                .unwrap_err();
            assert_eq!(
                error.code,
                if scenario == "auth" {
                    "not_logged_in"
                } else {
                    "account_changed"
                }
            );
        }
    }

    #[tokio::test]
    async fn work_account_info_cancel_and_generation_fence_every_local_rpc_stage() {
        for stage in ["first-auth", "routing", "last-auth"] {
            for invalidate in [false, true] {
                let service = Arc::new(ChatgptService::default());
                let started = Arc::new(tokio::sync::Notify::new());
                let running = service.clone();
                let signal = started.clone();
                let task = tokio::spawn(async move {
                    let calls = std::sync::atomic::AtomicUsize::new(0);
                    running
                        .work_account_info(request("blocked"), |method, _| {
                            let index = calls.fetch_add(1, Ordering::SeqCst);
                            let signal = signal.clone();
                            async move {
                                if index
                                    == match stage {
                                        "first-auth" => 0,
                                        "routing" => 1,
                                        _ => 2,
                                    }
                                {
                                    signal.notify_one();
                                    return std::future::pending().await;
                                }
                                Ok(if method == "getAuthStatus" {
                                    auth(Some(json!("plus")))
                                } else {
                                    account()
                                })
                            }
                        })
                        .await
                });
                started.notified().await;
                if invalidate {
                    service.invalidate();
                } else {
                    service.cancel("blocked");
                }
                let error = tokio::time::timeout(Duration::from_secs(2), task)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap_err();
                assert_eq!(
                    error.code,
                    if invalidate {
                        "account_changed"
                    } else {
                        "cancelled"
                    }
                );
            }
        }
    }

    #[tokio::test]
    async fn work_account_info_errors_are_whitelisted_and_cancel_before_start_has_no_rpc() {
        let service = ChatgptService::default();
        service.cancel("pre-cancel");
        let error = service
            .work_account_info(request("pre-cancel"), |_, _| async {
                panic!("cancelled request called RPC")
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "cancelled");
        let error = service
            .work_account_info(request("rpc-error"), |_, _| async {
                Err("private-token-error-payload".into())
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "auth_unavailable");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("private-token"));
        let expired_payload = json!({"exp":1,"https://api.openai.com/auth":{"chatgpt_account_id":"work-account","user_id":"work-user"}});
        let expired = json!({"authMethod":"chatgpt","authToken":format!("e30.{}.s",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&expired_payload).unwrap()))});
        let rpc = Rpc::new(vec![expired]);
        assert_eq!(
            service
                .work_account_info(request("expired"), |method, params| rpc
                    .call(method, params))
                .await
                .unwrap_err()
                .code,
            "auth_expired"
        );
        rpc.assert_calls();
        let rpc = Rpc::new(vec![auth(Some(json!("plus")))]);
        rpc.responses
            .lock()
            .unwrap()
            .push_back(Err("routing-private-token-error".into()));
        let error = service
            .work_account_info(request("routing-error"), |method, params| {
                rpc.call(method, params)
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "routing_unavailable");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("routing-private"));
        let mut stale = request("stale-generation");
        stale.expected_identity.generation = 1;
        let error = service
            .work_account_info(stale, |_, _| async {
                panic!("stale generation called RPC")
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "account_changed");
    }
}
