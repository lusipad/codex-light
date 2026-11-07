mod durable_models_tests {
    use super::*;

    fn request(id: &str) -> DurableModelsRequest {
        DurableModelsRequest { request_id: id.into(), expected_identity: identity(), cursor: None }
    }
    async fn rpc(method: &'static str, params: Value) -> Result<Value, String> {
        match method {
            "getAuthStatus" => { assert_eq!(params, json!({"includeToken":true,"refreshToken":false})); Ok(auth(&fixture_token())) }
            "configRequirements/read" => { assert_eq!(params, json!({})); Ok(json!({"requirements":null})) }
            _ => panic!("Unexpected local RPC"),
        }
    }
    fn notify() -> crate::durable::Notify { Arc::new(|_| {}) }
    fn models() -> Value { json!({"data":[{"id":"remote-model","model":"remote-model","capability":"preserved"}],"nextCursor":null}) }

    #[tokio::test]
    async fn durable_models_authenticates_and_checks_policy_around_the_native_host() {
        let service = ChatgptService::default();
        let called = AtomicUsize::new(0);
        let rpc_calls = AtomicUsize::new(0);
        let counted_rpc = |method, params| { rpc_calls.fetch_add(1, Ordering::SeqCst); rpc(method, params) };
        let mut request = request("models"); request.cursor = Some("opaque-cursor".into());
        let response = service.durable_models_with(request, cloud_profile(), counted_rpc, notify(), |config, cursor, cancel, _| {
            called.fetch_add(1, Ordering::SeqCst);
            assert_eq!(config.token, fixture_token());
            assert_eq!(config.identity, identity());
            assert_eq!(cursor.as_deref(), Some("opaque-cursor"));
            assert!(!cancel.load(Ordering::SeqCst));
            std::future::ready(Ok(models()))
        }).await.unwrap();
        assert_eq!(called.load(Ordering::SeqCst), 1);
        assert_eq!(rpc_calls.load(Ordering::SeqCst), 4);
        assert_eq!(response.host_id, "durable");
        assert_eq!(response.body["data"][0]["capability"], "preserved");
        assert!(!serde_json::to_string(&response).unwrap().contains(&fixture_token()));
    }

    #[tokio::test]
    async fn durable_models_invalid_inputs_or_early_cancel_never_dial() {
        for cursor in ["", "bad\r\ncursor"] {
            let service = ChatgptService::default();
            let mut request = request("invalid-cursor"); request.cursor = Some(cursor.into());
            let never = |_, _| async { panic!("Invalid input must not read authentication"); #[allow(unreachable_code)] Ok(Value::Null) };
            let error = service.durable_models_with(request, cloud_profile(), never, notify(), |_, _, _, _| {
                panic!("Invalid input must not open the cloud host"); #[allow(unreachable_code)] std::future::ready(Ok(models()))
            }).await.err().unwrap();
            assert_eq!(error.code, "invalid_request");
        }
        let service = ChatgptService::default(); service.cancel("pre-cancelled");
        assert_eq!(service.durable_models_with(request("pre-cancelled"), cloud_profile(), rpc, notify(), |_, _, _, _| {
            panic!("Cancelled request must not dial"); #[allow(unreachable_code)] std::future::ready(Ok(models()))
        }).await.err().unwrap().code, "cancelled");
        for field in ["url", "token", "method", "params"] {
            let mut raw = json!({"requestId":"id","expectedIdentity":identity()});
            raw[field] = json!("caller-controlled");
            assert!(serde_json::from_value::<DurableModelsRequest>(raw).is_err());
        }
    }

    #[tokio::test]
    async fn durable_models_policy_denial_blocks_dial_or_discards_completed_data() {
        for late in [false, true] {
            let service = ChatgptService::default();
            let checks = AtomicUsize::new(0);
            let reads = AtomicUsize::new(0);
            let policy = |method, params| {
                let deny = method == "configRequirements/read" && (!late || checks.fetch_add(1, Ordering::SeqCst) > 0);
                async move { if deny { Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})) } else { rpc(method, params).await } }
            };
            let error = service.durable_models_with(request("policy"), cloud_profile(), policy, notify(), |_, _, _, _| {
                reads.fetch_add(1, Ordering::SeqCst); std::future::ready(Ok(models()))
            }).await.err().unwrap();
            assert_eq!(error.code, "network_restricted");
            assert_eq!(reads.load(Ordering::SeqCst), usize::from(late));
        }
    }

    #[tokio::test]
    async fn durable_models_late_identity_change_cannot_publish_a_page() {
        let service = ChatgptService::default();
        let calls = AtomicUsize::new(0);
        let changed = |method, params| {
            let second = method == "getAuthStatus" && calls.fetch_add(1, Ordering::SeqCst) > 0;
            async move { if second { Ok(auth(&token("other", "other", 4102444800))) } else { rpc(method, params).await } }
        };
        assert_eq!(service.durable_models_with(request("changed"), cloud_profile(), changed, notify(), |_, _, _, _| std::future::ready(Ok(models())))
            .await.err().unwrap().code, "account_changed");
    }

    #[tokio::test]
    async fn durable_models_retired_request_cannot_close_a_new_generation_slot() {
        let service = ChatgptService::default();
        let old_stop = service.durable.test_session(identity());
        let new_stop = Mutex::new(None);
        let error = service.durable_models_with(request("retired"), cloud_profile(), rpc, notify(), |_, _, _, _| {
            let generation = service.invalidate();
            let mut current = identity(); current.generation = generation;
            *new_stop.lock().unwrap() = Some(service.durable.test_session(current));
            std::future::ready(Ok(models()))
        }).await.err().unwrap();
        assert_eq!(error.code, "account_changed");
        assert!(old_stop.load(Ordering::SeqCst));
        let current_stop = new_stop.lock().unwrap().take().unwrap();
        assert!(!current_stop.load(Ordering::SeqCst));
        service.durable.invalidate();
        assert!(current_stop.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn durable_models_expired_or_logged_out_credentials_retire_the_matching_slot() {
        for late in [false, true] {
            for expired in [false, true] {
                let service = ChatgptService::default();
                // A slot fixture tests retirement independently of network transport.
                let stopped = service.durable.test_session(identity());
                let calls = AtomicUsize::new(0);
                let authentication = |method, params| {
                    let reject = method == "getAuthStatus" && (!late || calls.fetch_add(1, Ordering::SeqCst) > 0);
                    async move {
                        if reject {
                            Ok(if expired { auth(&token("account", "user", 1)) } else { json!({"authMethod":null}) })
                        } else { rpc(method, params).await }
                    }
                };
                let error = service.durable_models_with(request("expired"), cloud_profile(), authentication, notify(), |_, _, _, _| std::future::ready(Ok(models())))
                    .await.err().unwrap();
                assert_eq!(error.code, if expired { "auth_expired" } else { "not_logged_in" });
                assert!(stopped.load(Ordering::SeqCst));
            }
        }
    }

    #[tokio::test]
    async fn durable_models_cancellation_drops_the_host_wait_without_a_second_read() {
        for invalidation in [false, true] {
            let service = ChatgptService::default();
            let entered = tokio::sync::Notify::new();
            let dropped = AtomicBool::new(false);
            let read = |_, _, _, _| async {
                let _drop = MarkDrop(&dropped);
                entered.notify_one();
                std::future::pending::<Result<Value, crate::durable::Error>>().await
            };
            let operation = service.durable_models_with(request("pending"), cloud_profile(), rpc, notify(), read);
            let cancel = async { entered.notified().await; if invalidation { service.invalidate(); } else { service.cancel("pending"); } };
            let (result, _) = tokio::join!(operation, cancel);
            assert_eq!(result.err().unwrap().code, if invalidation { "account_changed" } else { "cancelled" });
            assert!(dropped.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn durable_models_malformed_pages_and_rpc_errors_do_not_become_catalog_success() {
        for body in [json!(null), json!({"data":null}), json!({"data":[{"id":""}]}), json!({"data":[],"nextCursor":42})] {
            assert_eq!(ChatgptService::default().durable_models_with(request("malformed"), cloud_profile(), rpc, notify(), |_, _, _, _| std::future::ready(Ok(body)))
                .await.err().unwrap().code, "invalid_response");
        }
        assert_eq!(ChatgptService::default().durable_models_with(request("overloaded"), cloud_profile(), rpc, notify(), |_, _, _, _| std::future::ready(Err(crate::durable::Error::Remote(-32001))))
            .await.err().unwrap().code, "cloud_overloaded");
    }
}
