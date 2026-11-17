use super::*;

// Fixed 26.1111 Uc -> M6.ensureAbsoluteUrl -> module88807.YK ->
// 64109.Xzz joins the production /backend-api base and /wham/settings/user.
pub(super) fn route(params: &Value) -> ServiceResult<String> {
    if !params.as_object().is_some_and(|params| params.is_empty()) {
        return Err(failure(
            "invalid_request",
            "Work custom instructions does not accept parameters",
        ));
    }
    Ok("/backend-api/wham/settings/user".into())
}

#[derive(Deserialize, Serialize)]
struct Instructions {
    #[serde(default)]
    custom_instructions: Option<String>,
    #[serde(default)]
    communication_guide: String,
    #[serde(default)]
    communication_guide_enabled: bool,
}

pub(super) fn body(value: Value) -> ServiceResult<Value> {
    if !value.is_object() {
        return Err(failure(
            "invalid_response",
            "Invalid Work custom instructions response",
        ));
    }
    let decoded: Instructions = serde_json::from_value(value).map_err(|_| {
        failure(
            "invalid_response",
            "Invalid Work custom instructions response",
        )
    })?;
    serde_json::to_value(decoded).map_err(|_| {
        failure(
            "invalid_response",
            "Invalid Work custom instructions response",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str) -> ServiceRequest {
        ServiceRequest {
            request_id: id.into(),
            operation: ServiceOperation::WorkCustomInstructions,
            params: json!({}),
            expected_identity: ServiceIdentity {
                account_id: "work-account".into(),
                user_id: "work-user".into(),
                generation: 0,
            },
            profile: ServiceProfile {
                language: "zh-CN".into(),
                device_id: "private-fixture".into(),
                user_agent: "Mozilla/5.0 Chrome/140.0.0.0".into(),
                user_agent_client_hints: "\"Chromium\";v=\"140\"".into(),
                platform_client_hint: "\"Windows\"".into(),
            },
        }
    }
    fn rpc(method: &'static str, _: Value) -> std::future::Ready<Result<Value, String>> {
        std::future::ready(match method {
            "getAuthStatus" => {
                let claims = json!({"exp":4_102_444_800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"work-account","user_id":"work-user"}});
                Ok(
                    json!({"authMethod":"chatgpt","authToken":format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}),
                )
            }
            "account/read" => Ok(
                json!({"account":{"type":"chatgpt"},"workspaceRouting":{"chatgptAccountId":"work-account","backendOrigin":"https://chatgpt.com","accountRoutingOverride":"NO_CONSTRAINT"}}),
            ),
            "configRequirements/read" => Ok(json!({"requirements":null})),
            _ => Err("Unexpected fixture RPC".into()),
        })
    }
    struct Recorded<'a> {
        requests: Mutex<Vec<HttpRequest>>,
        responses: Mutex<VecDeque<(u16, Vec<u8>)>>,
        retire: Option<(&'a ChatgptService, bool)>,
    }
    impl<'a> Recorded<'a> {
        fn new(responses: &[(u16, Value)]) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                responses: Mutex::new(
                    responses
                        .iter()
                        .map(|(status, body)| (*status, serde_json::to_vec(body).unwrap()))
                        .collect(),
                ),
                retire: None,
            }
        }
    }
    impl Transport for Recorded<'_> {
        fn send(&self, request: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move {
                self.requests.lock().unwrap().push(request);
                if let Some((service, cancel)) = self.retire {
                    if cancel {
                        service.cancel("retire-instructions");
                    } else {
                        service.invalidate();
                    }
                }
                let (status, body) = self
                    .responses
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("unexpected HTTP replay");
                Ok(HttpResponse {
                    status,
                    headers: BTreeMap::new(),
                    body,
                })
            })
        }
    }

    #[test]
    fn work_custom_instructions_schema_defaults_strip_unknown_and_reject_invalid_fields() {
        assert_eq!(
            body(json!({"private":"must-not-cross"})).unwrap(),
            json!({"custom_instructions":null,"communication_guide":"","communication_guide_enabled":false})
        );
        assert_eq!(body(json!({"custom_instructions":"  raw\ntext  ","communication_guide":"guide","communication_guide_enabled":true,"private":17})).unwrap(),
            json!({"custom_instructions":"  raw\ntext  ","communication_guide":"guide","communication_guide_enabled":true}));
        for invalid in [
            Value::Null,
            json!([]),
            json!({"custom_instructions":17}),
            json!({"communication_guide":null}),
            json!({"communication_guide_enabled":null}),
            json!({"communication_guide_enabled":"true"}),
        ] {
            assert_eq!(body(invalid).err().unwrap().code, "invalid_response");
        }
    }

    #[tokio::test]
    async fn work_custom_instructions_fixed_route_headers_and_empty_params_before_auth() {
        let service = ChatgptService::default();
        let transport = Recorded::new(&[(
            200,
            json!({"custom_instructions":"private user text","unrelated_secret":"must-not-cross"}),
        )]);
        let result = service
            .read_with(request("instructions"), rpc, &transport)
            .await
            .unwrap();
        assert_eq!(
            result.body,
            json!({"custom_instructions":"private user text","communication_guide":"","communication_guide_enabled":false})
        );
        assert_eq!(result.identity, request("unused").expected_identity);
        let sent = transport.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(
            sent[0].url,
            "https://chatgpt.com/backend-api/wham/settings/user"
        );
        assert!(matches!(sent[0].method, HttpMethod::Get));
        assert!(sent[0].body.is_empty());
        assert_eq!(sent[0].headers["ChatGPT-Account-Id"], "work-account");
        assert_eq!(sent[0].headers["originator"], "Codex Desktop");
        assert_eq!(sent[0].headers["X-OpenAI-Attach-Auth"], "1");
        assert!(!sent[0].headers.contains_key("x-oai-mcp-form-version"));
        drop(sent);
        for params in [
            Value::Null,
            json!([]),
            json!({"url":"https://example.test"}),
            json!({"custom_instructions":"write"}),
            json!({"gate":true}),
            json!({"accountId":"foreign"}),
        ] {
            let mut invalid = request("invalid-instructions");
            invalid.params = params;
            assert_eq!(
                service
                    .read_with(
                        invalid,
                        |_, _| std::future::ready(Err("must not auth".into())),
                        &transport
                    )
                    .await
                    .err()
                    .unwrap()
                    .code,
                "invalid_request"
            );
        }
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert!(matches!(
            serde_json::from_value::<ServiceOperation>(json!("work_custom_instructions")).unwrap(),
            ServiceOperation::WorkCustomInstructions
        ));
    }

    #[tokio::test]
    async fn work_custom_instructions_http_errors_bad_json_and_bad_schema_are_not_empty_success() {
        for status in [403, 404, 429, 500] {
            let transport = Recorded::new(&[(status, json!({"private":"not-success"}))]);
            let error = ChatgptService::default()
                .read_with(request("http-error"), rpc, &transport)
                .await
                .err()
                .unwrap();
            assert_eq!(error.status, Some(status));
            assert!(!error.message.contains("not-success"));
        }
        for raw in [
            b"not json".to_vec(),
            b"null".to_vec(),
            br#"{"communication_guide":null}"#.to_vec(),
        ] {
            let transport = Recorded {
                requests: Mutex::new(Vec::new()),
                responses: Mutex::new(VecDeque::from([(200, raw)])),
                retire: None,
            };
            assert_eq!(
                ChatgptService::default()
                    .read_with(request("bad-body"), rpc, &transport)
                    .await
                    .err()
                    .unwrap()
                    .code,
                "invalid_response"
            );
        }
    }

    #[tokio::test]
    async fn work_custom_instructions_obeys_policy_identity_and_cancel_fences() {
        let service = ChatgptService::default();
        let transport = Recorded::new(&[]);
        let denied = |method, params| {
            if method == "configRequirements/read" {
                std::future::ready(Ok(
                    json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}),
                ))
            } else {
                rpc(method, params)
            }
        };
        assert_eq!(
            service
                .read_with(request("denied"), denied, &transport)
                .await
                .err()
                .unwrap()
                .code,
            "network_restricted"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
        for cancel in [false, true] {
            let service = ChatgptService::default();
            let mut transport = Recorded::new(&[(200, json!({}))]);
            transport.retire = Some((&service, cancel));
            assert_eq!(
                service
                    .read_with(request("retire-instructions"), rpc, &transport)
                    .await
                    .err()
                    .unwrap()
                    .code,
                if cancel {
                    "cancelled"
                } else {
                    "account_changed"
                }
            );
        }
        let mut wrong = request("wrong-user");
        wrong.expected_identity.user_id = "foreign".into();
        assert_eq!(
            ChatgptService::default()
                .read_with(wrong, rpc, &transport)
                .await
                .err()
                .unwrap()
                .code,
            "account_changed"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn work_custom_instructions_refreshes_one_401_but_never_ip_denial() {
        let service = ChatgptService::default();
        let transport = Recorded::new(&[(401, json!({})), (200, json!({}))]);
        let refreshes = std::sync::atomic::AtomicUsize::new(0);
        let call = |method, params: Value| {
            if method == "getAuthStatus" && params["refreshToken"] == true {
                refreshes.fetch_add(1, Ordering::SeqCst);
            }
            rpc(method, params)
        };
        service
            .read_with(request("refresh"), call, &transport)
            .await
            .unwrap();
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(transport.requests.lock().unwrap().len(), 2);
        let service = ChatgptService::default();
        let transport = Recorded::new(&[(401, json!({"error":{"type":"ip_not_authorized"}}))]);
        assert_eq!(
            service
                .read_with(request("ip-denied"), rpc, &transport)
                .await
                .err()
                .unwrap()
                .code,
            "ip_not_authorized"
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        let service = ChatgptService::default();
        let transport = Recorded::new(&[(401, json!({})), (401, json!({}))]);
        let error = service
            .read_with(request("terminal-401"), rpc, &transport)
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "unauthorized");
        assert_eq!(error.status, Some(401));
        assert_eq!(transport.requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn work_custom_instructions_late_network_policy_rejection_drops_valid_response() {
        let service = ChatgptService::default();
        let transport = Recorded::new(&[(200, json!({"custom_instructions":"must-not-return"}))]);
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let call = |method, params| {
            if method == "configRequirements/read" {
                let late = checks.fetch_add(1, Ordering::SeqCst) > 0;
                std::future::ready(Ok(if late {
                    json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})
                } else {
                    json!({"requirements":null})
                }))
            } else {
                rpc(method, params)
            }
        };
        assert_eq!(
            service
                .read_with(request("late-policy"), call, &transport)
                .await
                .err()
                .unwrap()
                .code,
            "network_restricted"
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn work_custom_instructions_entire_read_has_bounded_timeout() {
        let service = ChatgptService::default();
        let transport = Recorded::new(&[]);
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            service.read_with(
                request("timeout"),
                |_, _| std::future::pending::<Result<Value, String>>(),
                &transport,
            ),
        )
        .await
        .unwrap();
        assert_eq!(result.err().unwrap().code, "timeout");
        assert!(transport.requests.lock().unwrap().is_empty());
    }
}
