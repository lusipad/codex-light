mod cloud_draft_tests {
    use super::*;

    fn request(id: &str) -> CloudDraftRequest {
        CloudDraftRequest {
            request_id: id.into(),
            config_id: "config_fixture".into(),
            expected_identity: identity(),
        }
    }
    async fn rpc(method: &'static str, params: Value) -> Result<Value, String> {
        if method == "configRequirements/read" {
            assert_eq!(params, json!({}));
            return Ok(json!({"requirements":null}));
        }
        assert_eq!(method, "getAuthStatus");
        assert_eq!(params, json!({"includeToken":true,"refreshToken":false}));
        Ok(auth(&fixture_token()))
    }
    fn response(body: Value) -> FakeTransport {
        let transport = FakeTransport::new(&[200]);
        transport.responses.lock().unwrap()[0].body = serde_json::to_vec(&body).unwrap();
        transport
    }
    fn receipt() -> Value {
        json!({"draft_id":"draft_fixture","environment_id":"environment_fixture","thread_id":"thread_fixture"})
    }

    struct DraftTransport(FakeTransport);
    impl Transport for DraftTransport {
        fn send(&self, _: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
            panic!("Draft creation must use its long-running transport path")
        }
        fn send_cloud_draft(
            &self,
            request: HttpRequest,
            cancel: Arc<AtomicBool>,
        ) -> TransportFuture<'_> {
            self.0.send(request, cancel)
        }
    }

    #[tokio::test]
    async fn cloud_draft_fixed_post_has_no_body_and_returns_only_service_ids() {
        let service = ChatgptService::default();
        let transport = DraftTransport(response(receipt()));
        let result = service
            .cloud_create_draft_with(request("draft-first"), cloud_profile(), rpc, &transport)
            .await
            .unwrap();
        assert_eq!(result.receipt.draft_id, "draft_fixture");
        assert_eq!(result.receipt.environment_id, "environment_fixture");
        assert_eq!(result.receipt.thread_id.as_deref(), Some("thread_fixture"));
        assert_eq!(result.identity, identity());
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains(&fixture_token()));
        let requests = transport.0.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, HttpMethod::Post);
        assert!(requests[0].body.is_empty());
        assert_eq!(
            requests[0].url,
            "https://codex-cloud-backend.chatgpt.com/v1/environment-configs/config_fixture/drafts"
        );
        assert_eq!(
            requests[0].headers["Authorization"],
            format!("Bearer {}", fixture_token())
        );
        assert_eq!(
            requests[0].headers["ChatGPT-Account-Id"],
            identity().account_id
        );
        assert_eq!(requests[0].headers["X-OpenAI-Product-Sku"], "codex");
    }

    #[tokio::test]
    async fn cloud_draft_nullable_thread_is_preserved_without_inventing_a_conversation() {
        let service = ChatgptService::default();
        let transport = response(
            json!({"draft_id":"draft","environment_id":"environment","thread_id":null,"unconsumed":"omitted"}),
        );
        let result = service
            .cloud_create_draft_with(request("no-thread"), cloud_profile(), rpc, &transport)
            .await
            .unwrap();
        assert!(result.receipt.thread_id.is_none());
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("unconsumed"));
        assert_eq!(
            service
                .cloud_create_draft_with(
                    request("no-thread-retry"),
                    cloud_profile(),
                    rpc,
                    &transport
                )
                .await
                .err()
                .unwrap()
                .code,
            "cloud_draft_pending"
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cloud_draft_malformed_success_stays_unconfirmed_without_second_post() {
        for body in [
            json!({}),
            json!({"draft_id":"draft","environment_id":"env"}),
            json!({"draft_id":"","environment_id":"env","thread_id":null}),
            json!({"draft_id":"draft/other","environment_id":"env","thread_id":null}),
            json!({"draft_id":"draft","environment_id":"env","thread_id":""}),
        ] {
            let service = ChatgptService::default();
            let transport = response(body);
            assert_eq!(
                service
                    .cloud_create_draft_with(request("malformed"), cloud_profile(), rpc, &transport)
                    .await
                    .err()
                    .unwrap()
                    .code,
                "cloud_draft_unconfirmed"
            );
            assert_eq!(
                service
                    .cloud_create_draft_with(request("repeat"), cloud_profile(), rpc, &transport)
                    .await
                    .err()
                    .unwrap()
                    .code,
                "cloud_draft_pending"
            );
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn cloud_draft_invalid_routing_or_cancel_before_start_never_authenticates() {
        for id in ["", "../other", "other/path", "id?draft=other"] {
            let transport = FakeTransport::new(&[]);
            let mut invalid = request("invalid");
            invalid.config_id = id.into();
            let never = |_, _| async {
                panic!("invalid request must not read credentials");
                #[allow(unreachable_code)]
                Ok(Value::Null)
            };
            assert_eq!(
                ChatgptService::default()
                    .cloud_create_draft_with(invalid, cloud_profile(), never, &transport)
                    .await
                    .err()
                    .unwrap()
                    .code,
                "invalid_request"
            );
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        let service = ChatgptService::default();
        service.cancel("cancel-before");
        let transport = FakeTransport::new(&[]);
        assert_eq!(
            service
                .cloud_create_draft_with(request("cancel-before"), cloud_profile(), rpc, &transport)
                .await
                .err()
                .unwrap()
                .code,
            "cancelled"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
        assert!(serde_json::from_value::<CloudDraftRequest>(json!({"requestId":"id","configId":"config","expectedIdentity":identity(),"body":{"start_thread":true}})).is_err());
    }

    #[tokio::test]
    async fn cloud_draft_http_errors_do_not_replay_and_server_failures_block_a_new_attempt() {
        for status in [401, 403, 404, 409, 429, 408, 500, 503] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[status]);
            let error = service
                .cloud_create_draft_with(request("status"), cloud_profile(), rpc, &transport)
                .await
                .err()
                .unwrap();
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            if status == 408 || status >= 500 {
                assert_eq!(error.code, "cloud_draft_unconfirmed");
                assert_eq!(
                    service
                        .cloud_create_draft_with(request("retry"), cloud_profile(), rpc, &transport)
                        .await
                        .err()
                        .unwrap()
                        .code,
                    "cloud_draft_pending"
                );
            } else {
                assert_eq!(error.status, Some(status));
            }
        }
    }

    #[tokio::test]
    async fn cloud_draft_concurrent_cancel_and_discarded_future_cannot_create_twice() {
        for abort_task in [false, true] {
            let service = Arc::new(ChatgptService::default());
            let transport = Arc::new(FakeTransport {
                delay_ms: 1_000,
                ..response(receipt())
            });
            let task = {
                let service = service.clone();
                let transport = transport.clone();
                tokio::spawn(async move {
                    service
                        .cloud_create_draft_with(
                            request("running"),
                            cloud_profile(),
                            rpc,
                            transport.as_ref(),
                        )
                        .await
                })
            };
            while !transport.entered.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
            assert_eq!(
                service
                    .cloud_create_draft_with(
                        request("double"),
                        cloud_profile(),
                        rpc,
                        transport.as_ref()
                    )
                    .await
                    .err()
                    .unwrap()
                    .code,
                "cloud_draft_pending"
            );
            if abort_task {
                task.abort();
                assert!(task.await.unwrap_err().is_cancelled());
            } else {
                service.cancel("running");
                assert_eq!(
                    task.await.unwrap().err().unwrap().code,
                    "cloud_draft_unconfirmed"
                );
            }
            assert_eq!(
                service
                    .cloud_create_draft_with(
                        request("retry"),
                        cloud_profile(),
                        rpc,
                        transport.as_ref()
                    )
                    .await
                    .err()
                    .unwrap()
                    .code,
                "cloud_draft_pending"
            );
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            assert!(transport.dropped.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn cloud_draft_identity_is_checked_before_and_after_post() {
        let service = ChatgptService::default();
        let transport = response(receipt());
        let calls = AtomicUsize::new(0);
        let changed = |method, params| {
            let number = if method == "getAuthStatus" {
                calls.fetch_add(1, Ordering::SeqCst)
            } else {
                0
            };
            async move {
                if method == "configRequirements/read" {
                    rpc(method, params).await
                } else {
                    Ok(auth(&if number == 0 {
                        fixture_token()
                    } else {
                        token("other", "other", 4102444800)
                    }))
                }
            }
        };
        assert_eq!(
            service
                .cloud_create_draft_with(
                    request("identity-late"),
                    cloud_profile(),
                    changed,
                    &transport
                )
                .await
                .err()
                .unwrap()
                .code,
            "account_changed"
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let other = |method, params| async move {
            if method == "configRequirements/read" {
                rpc(method, params).await
            } else {
                Ok(auth(&token("other", "other", 4102444800)))
            }
        };
        assert_eq!(
            service
                .cloud_create_draft_with(
                    request("identity-early"),
                    cloud_profile(),
                    other,
                    &transport
                )
                .await
                .err()
                .unwrap()
                .code,
            "account_changed"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cloud_draft_application_network_policy_gates_dispatch_and_completion() {
        for late in [false, true] {
            let service = ChatgptService::default();
            let transport = response(receipt());
            let checks = AtomicUsize::new(0);
            let policy = |method, params| {
                let deny = method == "configRequirements/read"
                    && (!late || checks.fetch_add(1, Ordering::SeqCst) > 0);
                async move {
                    if deny {
                        Ok(
                            json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}),
                        )
                    } else {
                        rpc(method, params).await
                    }
                }
            };
            let error = service
                .cloud_create_draft_with(request("policy"), cloud_profile(), policy, &transport)
                .await
                .err()
                .unwrap();
            assert_eq!(
                error.code,
                if late {
                    "cloud_draft_unconfirmed"
                } else {
                    "network_restricted"
                }
            );
            assert_eq!(transport.requests.lock().unwrap().len(), usize::from(late));
            if late {
                assert_eq!(
                    service
                        .cloud_create_draft_with(
                            request("retry-policy"),
                            cloud_profile(),
                            rpc,
                            &transport
                        )
                        .await
                        .err()
                        .unwrap()
                        .code,
                    "cloud_draft_pending"
                );
            }
        }
    }

    #[tokio::test]
    async fn cloud_draft_invalidation_preserves_dispatched_unknown_across_same_account_reconnect() {
        let service = Arc::new(ChatgptService::default());
        let transport = Arc::new(FakeTransport {
            delay_ms: 1_000,
            ..response(receipt())
        });
        let task = {
            let service = service.clone();
            let transport = transport.clone();
            tokio::spawn(async move {
                service
                    .cloud_create_draft_with(
                        request("invalidated"),
                        cloud_profile(),
                        rpc,
                        transport.as_ref(),
                    )
                    .await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while !transport.entered.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        service.invalidate();
        assert_eq!(task.await.unwrap().err().unwrap().code, "account_changed");
        let mut retry = request("new-generation");
        retry.expected_identity.generation = 1;
        assert_eq!(
            service
                .cloud_create_draft_with(retry, cloud_profile(), rpc, transport.as_ref())
                .await
                .err()
                .unwrap()
                .code,
            "cloud_draft_pending"
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }
}
