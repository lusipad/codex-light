//! Fixed ordinary Chat conversations list. Project cursor lists, pins and
//! dynamic message-history pages are separate source producers.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationListRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub offset: u64,
    pub include_project_conversations: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub status: u16,
    pub body: Value,
}
fn list_route(request: &ConversationListRequest) -> ServiceResult<String> {
    if request.offset > 9_007_199_254_740_991 {
        return Err(failure(
            "invalid_request",
            "Conversation list offset must be a safe integer",
        ));
    }
    // H13 includes expand's false default. H14's !flag && undefined yields
    // omitted when false and literal false when true, never hide_snorlax=true.
    let project = if request.include_project_conversations {
        "&hide_snorlax=false"
    } else {
        ""
    };
    Ok(format!("/backend-api/conversations?exclude_conversation_origin=tpp&expand=false{project}&is_archived=false&is_starred=false&limit=20&order=updated&offset={}",request.offset))
}
impl ChatgptService {
    pub async fn conversation_list_read<F, Fut>(
        &self,
        request: ConversationListRequest,
        call: F,
    ) -> ServiceResult<ConversationListResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
    {
        self.conversation_list_with(request, call, &CurlTransport)
            .await
    }
    async fn conversation_list_with<F, Fut, T>(
        &self,
        request: ConversationListRequest,
        call: F,
        transport: &T,
    ) -> ServiceResult<ConversationListResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
        T: Transport + Sync,
    {
        let route = list_route(&request)?;
        validate_browser_profile(&request.profile)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        let mut outgoing = self
            .conversation_request(&route, identity, &request.profile, &registration, &call)
            .await?;
        outgoing.method = HttpMethod::Get;
        outgoing.headers.retain(|key, _| {
            !matches!(
                key.to_ascii_lowercase().as_str(),
                "content-type" | "x-oai-mcp-form-version"
            )
        });
        self.check_share_current(identity, &registration)?;
        // No archive or Work gate applies. The Chat consumer's availability is
        // a separate source contract; this typed reader cannot override it.
        let response = send_bounded(
            transport,
            outgoing,
            registration.cancelled.clone(),
            Duration::from_secs(50),
        )
        .await?;
        self.check_share_current(identity, &registration)?;
        if response.body.len() as u64 > MAX_RESPONSE {
            return Err(failure(
                "response_too_large",
                "Conversation list exceeded local response limit",
            ));
        }
        self.conversation_request(&route, identity, &request.profile, &registration, &call)
            .await?;
        self.check_share_current(identity, &registration)?;
        if account_instructions_ip_denied(&response) {
            return Err(ServiceError {
                code: "ip_not_authorized",
                message: "Current IP address is not authorized for this workspace",
                status: Some(response.status),
            });
        }
        // No automatic replay is implemented here; source retry policy remains
        // distinct. Preserve 401/403/404/429/5xx instead of returning empty pages.
        let decoded = decode_response(response, request.request_id.clone(), identity.clone())?;
        if !decoded.body.is_object() {
            return Err(failure(
                "invalid_response",
                "Conversation list must be a JSON object",
            ));
        }
        Ok(ConversationListResponse {
            request_id: request.request_id,
            identity: identity.clone(),
            status: decoded.status,
            body: decoded.body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> ServiceIdentity {
        ServiceIdentity {
            account_id: "list-account".into(),
            user_id: "list-user".into(),
            generation: 0,
        }
    }
    fn request() -> ConversationListRequest {
        ConversationListRequest {
            request_id: "list-read".into(),
            expected_identity: identity(),
            profile: ServiceProfile {
                language: "zh-CN".into(),
                device_id: "fixture".into(),
                user_agent: "Mozilla/5.0 Chrome/140.0.0.0".into(),
                user_agent_client_hints: "\"Chromium\";v=\"140\"".into(),
                platform_client_hint: "\"Windows\"".into(),
            },
            offset: 0,
            include_project_conversations: false,
        }
    }
    fn auth() -> Value {
        let claims = json!({"exp":4_102_444_800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"list-account","user_id":"list-user"}});
        json!({"authMethod":"chatgpt","authToken":format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))})
    }
    fn rpc(method: &'static str, _: Value) -> std::future::Ready<Result<Value, String>> {
        std::future::ready(match method {
            "getAuthStatus" => Ok(auth()),
            "account/read" => Ok(
                json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"list-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
            ),
            "configRequirements/read" => Ok(json!({"requirements":null})),
            _ => panic!("unexpected history RPC"),
        })
    }
    struct Fixture {
        sent: Mutex<Vec<HttpRequest>>,
        response: Mutex<Option<HttpResponse>>,
    }
    impl Fixture {
        fn new(status: u16, body: Value) -> Self {
            Self {
                sent: Mutex::new(Vec::new()),
                response: Mutex::new(Some(HttpResponse {
                    status,
                    headers: BTreeMap::new(),
                    body: serde_json::to_vec(&body).unwrap(),
                })),
            }
        }
    }
    impl Transport for Fixture {
        fn send(&self, request: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
            self.sent.lock().unwrap().push(request);
            Box::pin(std::future::ready(Ok(self
                .response
                .lock()
                .unwrap()
                .take()
                .expect("history must not replay"))))
        }
    }
    #[tokio::test]
    async fn conversation_list_fixed_ordinary_get_preserves_real_page_metadata() {
        let service = ChatgptService::default();
        let raw = json!({"items":[{"id":"server-id","title":"真实列表"}],"offset":0,"limit":20,"total":41,"other_source_metadata":true});
        let transport = Fixture::new(200, raw.clone());
        let response = service
            .conversation_list_with(request(), rpc, &transport)
            .await
            .unwrap();
        assert_eq!(response.body, raw);
        assert_eq!(response.identity, identity());
        let sent = transport.sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].method, HttpMethod::Get);
        assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/conversations?exclude_conversation_origin=tpp&expand=false&is_archived=false&is_starred=false&limit=20&order=updated&offset=0");
        assert_eq!(sent[0].headers["originator"], "Codex Desktop");
        assert!(!sent[0]
            .headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("Content-Type")
                || key.eq_ignore_ascii_case("x-oai-mcp-form-version")));
        assert!(sent[0].body.is_empty());
    }
    #[tokio::test]
    async fn conversation_list_project_flag_sends_false_only_and_preserves_offset_totals() {
        for include in [false, true] {
            let service = ChatgptService::default();
            let mut req = request();
            req.include_project_conversations = include;
            req.offset = 40;
            let raw = json!({"items":[],"offset":40,"limit":20,"total":101,"source_extra":true});
            let transport = Fixture::new(200, raw.clone());
            let response = service
                .conversation_list_with(req, rpc, &transport)
                .await
                .unwrap();
            assert_eq!(response.body, raw);
            let sent = transport.sent.lock().unwrap();
            let url = &sent[0].url;
            assert_eq!(url.contains("hide_snorlax=false"), include);
            assert!(!url.contains("hide_snorlax=true"));
            assert!(url.ends_with("&offset=40"));
            assert!(!sent[0].headers.contains_key("chatgpt-project-id"));
            assert!(!sent[0].headers.contains_key("chatgpt-conv-owner-id"));
            assert_eq!(sent[0].headers["ChatGPT-Account-Id"], "list-account");
            assert_eq!(sent[0].headers["OAI-Language"], "zh-CN");
            assert_eq!(sent[0].headers["x-openai-web-frontend"], "codex_webview");
            assert_eq!(sent[0].headers["x-openai-codex-window-type"], "electron");
        }
    }
    #[tokio::test]
    async fn conversation_list_offset_and_unknown_parameters_fail_before_auth_or_http() {
        let service = ChatgptService::default();
        let mut req = request();
        req.offset = 9_007_199_254_740_992;
        let transport = Fixture::new(200, json!({}));
        assert_eq!(
            service
                .conversation_list_with(
                    req,
                    |_, _| async { panic!("unsafe offset reached auth") },
                    &transport
                )
                .await
                .unwrap_err()
                .code,
            "invalid_request"
        );
        assert!(transport.sent.lock().unwrap().is_empty());
        let dto = json!({"requestId":"list","expectedIdentity":identity(),"profile":{"language":"zh-CN","deviceId":"fixture","userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"offset":0,"includeProjectConversations":false});
        assert!(serde_json::from_value::<ConversationListRequest>(dto.clone()).is_ok());
        for key in [
            "url",
            "headers",
            "limit",
            "order",
            "isArchived",
            "conversationOrigin",
            "expand",
            "hideSnorlax",
            "cursor",
        ] {
            let mut value = dto.clone();
            value[key] = json!("override");
            assert!(serde_json::from_value::<ConversationListRequest>(value).is_err());
        }
        for offset in [json!(-1), json!(0.5), json!("0")] {
            let mut value = dto.clone();
            value["offset"] = offset;
            assert!(serde_json::from_value::<ConversationListRequest>(value).is_err());
        }
    }
    #[tokio::test]
    async fn conversation_list_http_json_and_size_errors_do_not_become_empty_success_or_replay() {
        for status in [401, 403, 404, 423, 429, 500] {
            let service = ChatgptService::default();
            let transport = Fixture::new(status, json!({"private":"do-not-leak"}));
            let error = service
                .conversation_list_with(request(), rpc, &transport)
                .await
                .unwrap_err();
            assert_eq!(error.status, Some(status));
            assert_eq!(transport.sent.lock().unwrap().len(), 1);
            assert!(!serde_json::to_string(&error)
                .unwrap()
                .contains("do-not-leak"));
        }
        for body in [
            b"not-json".to_vec(),
            b"null".to_vec(),
            b"[]".to_vec(),
            vec![b' '; MAX_RESPONSE as usize + 1],
        ] {
            let service = ChatgptService::default();
            let transport = Fixture::new(200, json!({}));
            let large = body.len() as u64 > MAX_RESPONSE;
            transport.response.lock().unwrap().as_mut().unwrap().body = body;
            assert_eq!(
                service
                    .conversation_list_with(request(), rpc, &transport)
                    .await
                    .unwrap_err()
                    .code,
                if large {
                    "response_too_large"
                } else {
                    "invalid_response"
                }
            );
        }
        let service = ChatgptService::default();
        let transport = Fixture::new(401, json!({"error":{"type":"ip_not_authorized"}}));
        assert_eq!(
            service
                .conversation_list_with(request(), rpc, &transport)
                .await
                .unwrap_err()
                .code,
            "ip_not_authorized"
        );
        assert_eq!(transport.sent.lock().unwrap().len(), 1);
    }
    struct Delayed {
        entered: AtomicBool,
        release: AtomicBool,
    }
    impl Transport for Delayed {
        fn send(&self, request: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move {
                assert_eq!(request.method, HttpMethod::Get);
                self.entered.store(true, Ordering::SeqCst);
                while !self.release.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                Ok(HttpResponse {
                    status: 200,
                    headers: BTreeMap::new(),
                    body: b"{\"items\":[],\"offset\":0,\"limit\":20,\"total\":0}".to_vec(),
                })
            })
        }
    }
    #[tokio::test]
    async fn conversation_list_cancel_and_generation_aba_discard_late_pages() {
        for cancel in [false, true] {
            let service = ChatgptService::default();
            let transport = Delayed {
                entered: AtomicBool::new(false),
                release: AtomicBool::new(false),
            };
            let read = service.conversation_list_with(request(), rpc, &transport);
            let retire = async {
                while !transport.entered.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                if cancel {
                    service.cancel("list-read");
                } else {
                    service.invalidate();
                    service.invalidate();
                }
                transport.release.store(true, Ordering::SeqCst);
            };
            let (result, _) = tokio::join!(read, retire);
            assert_eq!(
                result.unwrap_err().code,
                if cancel {
                    "cancelled"
                } else {
                    "account_changed"
                }
            );
        }
        let service = ChatgptService::default();
        service.cancel("list-read");
        let transport = Fixture::new(200, json!({}));
        assert_eq!(
            service
                .conversation_list_with(
                    request(),
                    |_, _| async { panic!("precancel reached RPC") },
                    &transport
                )
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn conversation_list_checks_fresh_principal_routing_and_network_before_and_after_get() {
        for mode in [
            "auth-before",
            "auth-after",
            "routing-before",
            "routing-after",
            "network-before",
            "network-after",
        ] {
            let service = ChatgptService::default();
            let transport = Fixture::new(200, json!({"items":[],"offset":0,"limit":20,"total":0}));
            let call = |method, params| {
                let after = !transport.sent.lock().unwrap().is_empty();
                let reject = mode.ends_with("before") || after;
                if reject && method == "getAuthStatus" && mode.starts_with("auth") {
                    std::future::ready(Ok(json!({"authMethod":"apiKey"})))
                } else if reject && method == "account/read" && mode.starts_with("routing") {
                    std::future::ready(Ok(
                        json!({"account":{"type":"chatgpt"},"workspaceRouting":{"chatgptAccountId":"foreign"}}),
                    ))
                } else if reject
                    && method == "configRequirements/read"
                    && mode.starts_with("network")
                {
                    std::future::ready(Ok(
                        json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}),
                    ))
                } else {
                    rpc(method, params)
                }
            };
            assert!(service
                .conversation_list_with(request(), call, &transport)
                .await
                .is_err());
            assert_eq!(
                transport.sent.lock().unwrap().len(),
                usize::from(mode.ends_with("after"))
            );
        }
    }
}
