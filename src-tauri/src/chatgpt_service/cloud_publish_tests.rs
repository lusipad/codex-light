mod cloud_publish_tests {
    use super::*;

    fn request(operation: Value) -> CloudPublishRequest {
        serde_json::from_value(json!({
            "requestId":"publish-fixture", "expectedIdentity":identity(),
            "configId":"config_fixture", "draftId":"draft_fixture", "environmentId":"env_fixture",
            "operation":operation,
        }))
        .unwrap()
    }

    fn operation(state: &str) -> Value {
        json!({"id":"op_fixture","kind":"APPROVE_ENVIRONMENT_CONFIG_DRAFT",
            "environment_id":"env_fixture","state":state})
    }

    fn transport(values: &[Value]) -> FakeTransport {
        let transport = FakeTransport::new(&vec![200; values.len()]);
        for (response, body) in transport.responses.lock().unwrap().iter_mut().zip(values) {
            response.body = serde_json::to_vec(body).unwrap();
        }
        transport
    }

    fn complete() -> CloudPublishRequest {
        request(json!({"kind":"complete","operationId":"op_fixture","threadId":"thread_fixture"}))
    }

    fn begin() -> CloudPublishRequest {
        request(
            json!({"kind":"begin","expectedRevision":4,"idempotencyKey":"11111111-1111-4111-8111-111111111111"}),
        )
    }

    #[tokio::test]
    async fn cloud_publish_begin_and_read_use_only_fixed_requests() {
        let transport = transport(&[operation("PENDING"), operation("RUNNING")]);
        let service = ChatgptService::default();
        let key = "11111111-1111-4111-8111-111111111111";
        let result = service
            .cloud_publish_with(begin(), cloud_profile(), share_rpc, &transport)
            .await
            .unwrap();
        assert_eq!(result.body, operation("PENDING"));
        let read = request(json!({"kind":"read","operationId":"op_fixture"}));
        let result = service
            .cloud_publish_with(read, cloud_profile(), share_rpc, &transport)
            .await
            .unwrap();
        assert_eq!(result.body, operation("RUNNING"));
        let calls = transport.requests.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].method, HttpMethod::Post);
        assert_eq!(calls[0].url, "https://codex-cloud-backend.chatgpt.com/v1/environment-configs/config_fixture/drafts/draft_fixture/approve/begin");
        assert_eq!(
            serde_json::from_slice::<Value>(&calls[0].body).unwrap(),
            json!({"expected_revision":4,"idempotency_key":key})
        );
        assert_eq!(calls[1].method, HttpMethod::Get);
        assert_eq!(
            calls[1].url,
            "https://codex-cloud-backend.chatgpt.com/v1/environment-operations/op_fixture"
        );
        assert!(calls[1].body.is_empty());
    }

    #[tokio::test]
    async fn cloud_publish_complete_rechecks_operation_and_echoed_draft() {
        let config =
            json!({"id":"config_fixture","version_id":"v2","draft":{"id":"draft_fixture"}});
        let mut raw = config.clone();
        raw["draft"]["internal_note"] = json!("ignored");
        let wire = transport(&[operation("SUCCEEDED"), raw]);
        let response = ChatgptService::default()
            .cloud_publish_with(complete(), cloud_profile(), share_rpc, &wire)
            .await
            .unwrap();
        assert_eq!(response.body, config);
        let calls = wire.requests.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].method, HttpMethod::Get);
        assert_eq!(calls[1].method, HttpMethod::Post);
        assert!(calls[1]
            .url
            .ends_with("/config_fixture/drafts/draft_fixture/approve/complete"));
        assert_eq!(
            serde_json::from_slice::<Value>(&calls[1].body).unwrap(),
            json!({"operation_id":"op_fixture","thread_id":"thread_fixture"})
        );
        drop(calls);
        for malformed in [
            json!({"id":"config_fixture","version_id":"v2","draft":{"id":"wrong"}}),
            json!({"id":"config_fixture","draft":{"id":"draft_fixture"}}),
        ] {
            let wrong = transport(&[operation("SUCCEEDED"), malformed]);
            assert_eq!(
                ChatgptService::default()
                    .cloud_publish_with(complete(), cloud_profile(), share_rpc, &wrong)
                    .await
                    .err()
                    .unwrap()
                    .code,
                "cloud_publish_unconfirmed"
            );
        }
    }

    #[tokio::test]
    async fn cloud_publish_wrong_or_unfinished_operation_cannot_complete() {
        for (key, value, code) in [
            ("id", "wrong", "invalid_response"),
            ("environment_id", "wrong", "invalid_response"),
            ("kind", "OTHER", "invalid_response"),
            ("state", "UNKNOWN", "invalid_response"),
            ("state", "RUNNING", "cloud_publish_not_ready"),
            ("state", "FAILED", "cloud_publish_not_ready"),
        ] {
            let mut raw = operation("SUCCEEDED");
            raw[key] = json!(value);
            let transport = transport(&[raw]);
            let result = ChatgptService::default()
                .cloud_publish_with(complete(), cloud_profile(), share_rpc, &transport)
                .await;
            assert_eq!(result.err().unwrap().code, code);
            let calls = transport.requests.lock().unwrap();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].method, HttpMethod::Get);
        }
    }

    #[tokio::test]
    async fn cloud_publish_rejects_invalid_input_before_auth_and_never_retries_a_write() {
        let service = ChatgptService::default();
        let wire = FakeTransport::new(&[]);
        let invalid = request(json!({"kind":"read","operationId":"../other"}));
        let no_rpc = |_, _| std::future::ready(Err("unexpected RPC".to_string()));
        let result = service
            .cloud_publish_with(invalid, cloud_profile(), no_rpc, &wire)
            .await;
        assert_eq!(result.err().unwrap().code, "invalid_request");
        assert!(wire.requests.lock().unwrap().is_empty());
        for (status, code) in [
            (409, "conflict"),
            (408, "cloud_publish_unconfirmed"),
            (503, "cloud_publish_unconfirmed"),
        ] {
            let wire = FakeTransport::new(&[status]);
            let result = service
                .cloud_publish_with(begin(), cloud_profile(), share_rpc, &wire)
                .await;
            assert_eq!(result.err().unwrap().code, code);
            assert_eq!(wire.requests.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn cloud_publish_honors_network_policy_and_cancels_before_the_completion_post() {
        let service = ChatgptService::default();
        let wire = FakeTransport::new(&[]);
        let restricted = |method, params| {
            if method == "configRequirements/read" {
                std::future::ready(Ok(
                    json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}),
                ))
            } else {
                share_rpc(method, params)
            }
        };
        let result = service
            .cloud_publish_with(begin(), cloud_profile(), restricted, &wire)
            .await;
        assert_eq!(result.err().unwrap().code, "network_restricted");
        assert!(wire.requests.lock().unwrap().is_empty());

        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut wire = transport(&[operation("SUCCEEDED")]);
            wire.delay_ms = 10_000;
            let request = service.cloud_publish_with(complete(), cloud_profile(), share_rpc, &wire);
            let cancel = async {
                while !wire.entered.load(Ordering::SeqCst) {
                    tokio::task::yield_now().await;
                }
                if invalidate {
                    service.invalidate();
                } else {
                    assert!(service.cancel("publish-fixture"));
                }
            };
            let (result, ()) = tokio::join!(request, cancel);
            assert_eq!(
                result.err().unwrap().code,
                if invalidate {
                    "account_changed"
                } else {
                    "cancelled"
                }
            );
            let calls = wire.requests.lock().unwrap();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].method, HttpMethod::Get);
        }
    }

    #[tokio::test]
    async fn cloud_publish_cancelled_after_dispatch_is_unconfirmed_without_replay() {
        let service = ChatgptService::default();
        let mut wire = transport(&[operation("PENDING")]);
        wire.delay_ms = 10_000;
        let send = service.cloud_publish_with(begin(), cloud_profile(), share_rpc, &wire);
        let cancel = async {
            while !wire.entered.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
            assert!(service.cancel("publish-fixture"));
        };
        let (result, ()) = tokio::join!(send, cancel);
        assert_eq!(result.err().unwrap().code, "cloud_publish_unconfirmed");
        let calls = wire.requests.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].method, HttpMethod::Post);
    }
}
