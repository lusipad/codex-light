//! Fixed full-detail Chat history only. The dynamic paged-history producer is
//! separate and is not implemented by this read-only command.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationHistoryRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub conversation_id: String,
    pub temporary: bool,
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationHistoryResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub status: u16,
    pub body: Value,
}

fn history_route(request: &ConversationHistoryRequest) -> ServiceResult<String> {
    // H06's server-ID alphabet; 2048 bytes is our local resource safeguard.
    let id = &request.conversation_id;
    if id.is_empty()
        || id.len() > 2048
        || id.starts_with("local-chatgpt")
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(failure(
            "invalid_request",
            "A valid server conversation ID is required",
        ));
    }
    if request
        .project_id
        .as_ref()
        .is_some_and(|id| id.len() > 2048 || id.chars().any(char::is_control))
    {
        return Err(failure(
            "invalid_request",
            "Invalid history project context",
        ));
    }
    Ok(format!(
        "/backend-api/conversation/{}{}",
        encode_segment(id)?,
        if request.temporary {
            "?history_off=true"
        } else {
            ""
        }
    ))
}

impl ChatgptService {
    pub async fn conversation_history_read<F, Fut>(
        &self,
        request: ConversationHistoryRequest,
        call: F,
    ) -> ServiceResult<ConversationHistoryResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
    {
        self.conversation_history_with(request, call, &CurlTransport)
            .await
    }
    async fn conversation_history_with<F, Fut, T>(
        &self,
        request: ConversationHistoryRequest,
        call: F,
        transport: &T,
    ) -> ServiceResult<ConversationHistoryResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
        T: Transport + Sync,
    {
        let route = history_route(&request)?;
        validate_browser_profile(&request.profile)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        self.check_share_current(identity, &registration)?;
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
        if let Some(project) = request
            .project_id
            .as_ref()
            .filter(|id| id.starts_with("g-p-"))
        {
            outgoing
                .headers
                .insert("chatgpt-project-id".into(), project.clone());
        }
        self.check_share_current(identity, &registration)?;
        // Source has a broader except-rate-limit retry policy. This first fixed
        // detail reader deliberately preserves HTTP errors without auto replay.
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
                "Conversation history exceeded local response limit",
            ));
        }
        // Revalidate the fresh principal/routing and network policy, without a
        // second HTTP request. The session mutex never covers the history GET.
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
        let decoded = decode_response(response, request.request_id.clone(), identity.clone())?;
        if !decoded.body.is_object() {
            return Err(failure(
                "invalid_response",
                "Conversation history must be a JSON object",
            ));
        }
        // Full-detail schema is decoded by the consumer. Do not invent a
        // required/nonnullable ID field, but reject an explicit foreign ID.
        if let Some(returned) = decoded.body.get("conversation_id").and_then(Value::as_str) {
            if returned != request.conversation_id {
                return Err(failure(
                    "conversation_mismatch",
                    "Conversation history ID did not match the request",
                ));
            }
        }
        Ok(ConversationHistoryResponse {
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
            account_id: "history-account".into(),
            user_id: "history-user".into(),
            generation: 0,
        }
    }
    fn request() -> ConversationHistoryRequest {
        ConversationHistoryRequest {
            request_id: "history-read".into(),
            expected_identity: identity(),
            profile: ServiceProfile {
                language: "zh-CN".into(),
                device_id: "fixture".into(),
                user_agent: "Mozilla/5.0 Chrome/140.0.0.0".into(),
                user_agent_client_hints: "\"Chromium\";v=\"140\"".into(),
                platform_client_hint: "\"Windows\"".into(),
            },
            conversation_id: "server-history_1".into(),
            temporary: true,
            project_id: Some("g-p-project".into()),
        }
    }
    fn auth() -> Value {
        let claims = json!({"exp":4_102_444_800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"history-account","user_id":"history-user"}});
        json!({"authMethod":"chatgpt","authToken":format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))})
    }
    fn rpc(method: &'static str, _: Value) -> std::future::Ready<Result<Value, String>> {
        std::future::ready(match method {
            "getAuthStatus" => Ok(auth()),
            "account/read" => Ok(
                json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"history-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
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
    async fn conversation_history_fixed_get_reads_complete_graph_without_post_or_invented_pages() {
        let service = ChatgptService::default();
        let raw = json!({"conversation_id":"server-history_1","mapping":{"node":{"message":{"id":"message","content":{"parts":["真实历史"]}}}},"current_node":"node","unknown_source_field":{"keep":true}});
        let transport = Fixture::new(200, raw.clone());
        let response = service
            .conversation_history_with(request(), rpc, &transport)
            .await
            .unwrap();
        assert_eq!(response.body, raw);
        assert_eq!(response.identity, identity());
        let sent = transport.sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].method, HttpMethod::Get);
        assert_eq!(
            sent[0].url,
            "https://chatgpt.com/backend-api/conversation/server-history_1?history_off=true"
        );
        assert_eq!(sent[0].headers["originator"], "Codex Desktop");
        assert_eq!(sent[0].headers["chatgpt-project-id"], "g-p-project");
        assert!(!sent[0].headers.contains_key("Content-Type"));
        assert!(!sent[0]
            .headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("x-oai-mcp-form-version")
                || key.eq_ignore_ascii_case("X-OpenAI-Attach-Auth")));
        assert_eq!(sent[0].headers["ChatGPT-Account-Id"], "history-account");
        assert_eq!(sent[0].headers["OAI-Language"], "zh-CN");
        assert_eq!(sent[0].headers["x-openai-web-frontend"], "codex_webview");
        assert_eq!(sent[0].headers["x-openai-codex-window-type"], "electron");
        assert!(sent[0].body.is_empty());
    }
    #[tokio::test]
    async fn conversation_history_regular_and_custom_gpt_have_no_project_or_temporary_headers() {
        for project in [
            None,
            Some("g-custom-gpt"),
            Some("/g/custom"),
            Some("not-a-project"),
        ] {
            let service = ChatgptService::default();
            let mut req = request();
            req.temporary = false;
            req.project_id = project.map(str::to_owned);
            let transport = Fixture::new(200, json!({"mapping":{},"current_node":null}));
            service
                .conversation_history_with(req, rpc, &transport)
                .await
                .unwrap();
            let sent = transport.sent.lock().unwrap();
            assert_eq!(sent.len(), 1);
            assert_eq!(
                sent[0].url,
                "https://chatgpt.com/backend-api/conversation/server-history_1"
            );
            assert!(!sent[0].headers.contains_key("chatgpt-project-id"));
            assert!(!sent[0].headers.contains_key("chatgpt-conv-owner-id"));
        }
    }

    #[tokio::test]
    async fn conversation_history_invalid_inputs_are_rejected_before_any_auth_or_http() {
        for id in [
            "",
            "local-chatgpt:client",
            "local-chatgpt-client",
            "a/b",
            "a?x=1",
            "..",
            "a\r\nb",
            "历史",
        ] {
            let service = ChatgptService::default();
            let transport = Fixture::new(200, json!({}));
            let mut req = request();
            req.conversation_id = id.into();
            let result = service
                .conversation_history_with(
                    req,
                    |_, _| async { panic!("invalid input reached auth") },
                    &transport,
                )
                .await;
            assert_eq!(result.unwrap_err().code, "invalid_request");
            assert!(transport.sent.lock().unwrap().is_empty());
        }
        let service = ChatgptService::default();
        let transport = Fixture::new(200, json!({}));
        let mut req = request();
        req.project_id = Some("g-p-bad\nheader".into());
        assert_eq!(
            service
                .conversation_history_with(
                    req,
                    |_, _| async { panic!("bad header reached auth") },
                    &transport
                )
                .await
                .unwrap_err()
                .code,
            "invalid_request"
        );
        let dto = json!({"requestId":"history","expectedIdentity":identity(),"profile":{"language":"zh-CN","deviceId":"fixture","userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"conversationId":"server-id","temporary":false});
        assert!(serde_json::from_value::<ConversationHistoryRequest>(dto.clone()).is_ok());
        for key in ["url", "headers", "method", "ownerId", "offset"] {
            let mut bad = dto.clone();
            bad[key] = json!("override");
            assert!(serde_json::from_value::<ConversationHistoryRequest>(bad).is_err());
        }
    }

    #[tokio::test]
    async fn conversation_history_http_errors_and_bad_json_are_errors_not_empty_graphs_or_retries()
    {
        for status in [401, 403, 404, 423, 429, 500] {
            let service = ChatgptService::default();
            let transport = Fixture::new(
                status,
                json!({"error":{"message":"private-service-detail"}}),
            );
            let error = service
                .conversation_history_with(request(), rpc, &transport)
                .await
                .unwrap_err();
            assert_eq!(error.status, Some(status));
            assert!(!serde_json::to_string(&error)
                .unwrap()
                .contains("private-service-detail"));
            assert_eq!(
                transport.sent.lock().unwrap().len(),
                1,
                "no hidden HTTP replay"
            );
        }
        for body in [b"not-json".to_vec(), b"[]".to_vec(), b"null".to_vec()] {
            let service = ChatgptService::default();
            let transport = Fixture::new(200, json!({}));
            transport.response.lock().unwrap().as_mut().unwrap().body = body;
            assert_eq!(
                service
                    .conversation_history_with(request(), rpc, &transport)
                    .await
                    .unwrap_err()
                    .code,
                "invalid_response"
            );
        }
        for id in [json!("other-server")] {
            let service = ChatgptService::default();
            let transport = Fixture::new(200, json!({"conversation_id":id,"mapping":{}}));
            assert_eq!(
                service
                    .conversation_history_with(request(), rpc, &transport)
                    .await
                    .unwrap_err()
                    .code,
                "conversation_mismatch"
            );
        }
        let service = ChatgptService::default();
        let transport = Fixture::new(200, json!({}));
        transport.response.lock().unwrap().as_mut().unwrap().body =
            vec![b' '; MAX_RESPONSE as usize + 1];
        assert_eq!(
            service
                .conversation_history_with(request(), rpc, &transport)
                .await
                .unwrap_err()
                .code,
            "response_too_large"
        );
    }

    struct PausedFixture {
        entered: AtomicBool,
        release: AtomicBool,
    }
    impl Transport for PausedFixture {
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
                    body: b"{\"mapping\":{}}".to_vec(),
                })
            })
        }
    }
    #[tokio::test]
    async fn conversation_history_cancel_and_generation_aba_discard_late_read() {
        for cancelled in [false, true] {
            let service = ChatgptService::default();
            let transport = PausedFixture {
                entered: AtomicBool::new(false),
                release: AtomicBool::new(false),
            };
            let read = service.conversation_history_with(request(), rpc, &transport);
            let retire = async {
                while !transport.entered.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                if cancelled {
                    service.cancel("history-read");
                } else {
                    service.invalidate();
                    service.invalidate();
                }
                transport.release.store(true, Ordering::SeqCst);
            };
            let (result, _) = tokio::join!(read, retire);
            assert_eq!(
                result.unwrap_err().code,
                if cancelled {
                    "cancelled"
                } else {
                    "account_changed"
                }
            );
        }
        let service = ChatgptService::default();
        service.cancel("history-read");
        let transport = Fixture::new(200, json!({}));
        assert_eq!(
            service
                .conversation_history_with(
                    request(),
                    |_, _| async { panic!("precancel reached auth") },
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
    async fn conversation_history_fresh_identity_and_network_are_checked_before_and_after_http() {
        for mode in [
            "auth-before",
            "network-before",
            "auth-after",
            "network-after",
        ] {
            let service = ChatgptService::default();
            let transport = Fixture::new(200, json!({"mapping":{}}));
            let call = |method, params| {
                let after = !transport.sent.lock().unwrap().is_empty();
                if method == "getAuthStatus"
                    && (mode == "auth-before" || (mode == "auth-after" && after))
                {
                    let mut auth = auth();
                    auth["authToken"] = json!("invalid.private-token-do-not-leak");
                    std::future::ready(Ok(auth))
                } else if method == "configRequirements/read"
                    && (mode == "network-before" || (mode == "network-after" && after))
                {
                    std::future::ready(Ok(
                        json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}),
                    ))
                } else {
                    rpc(method, params)
                }
            };
            let error = service
                .conversation_history_with(request(), call, &transport)
                .await
                .unwrap_err();
            assert_eq!(
                transport.sent.lock().unwrap().len(),
                usize::from(mode.ends_with("after"))
            );
            assert!(!serde_json::to_string(&error)
                .unwrap()
                .contains("private-token"));
            if mode.starts_with("network") {
                assert_eq!(error.code, "network_restricted");
            }
        }
        let service = ChatgptService::default();
        let transport = Fixture::new(200, json!({}));
        let mut req = request();
        req.expected_identity.user_id = "foreign".into();
        assert_eq!(
            service
                .conversation_history_with(req, rpc, &transport)
                .await
                .unwrap_err()
                .code,
            "account_changed"
        );
        assert!(transport.sent.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn conversation_history_ip_refusal_is_not_empty_history_or_an_automatic_refresh() {
        let service = ChatgptService::default();
        let transport = Fixture::new(401, json!({"error":{"code":"ip_not_authorized"}}));
        let calls = Mutex::new(Vec::new());
        let call = |method, params: Value| {
            calls.lock().unwrap().push((method, params.clone()));
            rpc(method, params)
        };
        let error = service
            .conversation_history_with(request(), call, &transport)
            .await
            .unwrap_err();
        assert_eq!(error.code, "ip_not_authorized");
        assert_eq!(error.status, Some(401));
        assert_eq!(transport.sent.lock().unwrap().len(), 1);
        let calls = calls.lock().unwrap();
        assert_eq!(
            calls
                .iter()
                .filter(|(method, _)| *method == "getAuthStatus")
                .count(),
            2,
            "fresh principal verified before and after read"
        );
        assert!(calls
            .iter()
            .all(|(method, params)| *method != "getAuthStatus"
                || *params == json!({"includeToken":true,"refreshToken":false})));
    }
}
