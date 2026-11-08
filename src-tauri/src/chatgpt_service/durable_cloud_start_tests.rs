mod durable_cloud_start_tests {
    use super::*;

    fn request(config: &str) -> Value {
        json!({"requestId":"cloud-start-fixture","expectedIdentity":identity(),"operation":{
            "kind":"start_saved_environment","environmentConfigId":config,
            "model":"fixture-model","effort":"high","serviceTier":"priority"
        }})
    }

    #[tokio::test]
    async fn durable_cloud_start_projects_the_official_environment_wire_and_ack() {
        let config_id = "scope~asenvcfg_saved_1";
        let response = ChatgptService::default().durable_thread_with(
            serde_json::from_value(request(config_id)).unwrap(), cloud_profile(), share_rpc,
            |config, wire, _| {
                assert_eq!(config.identity, identity());
                assert_eq!(wire.method, "thread/start");
                assert_eq!(wire.timeout, Duration::from_secs(30));
                assert_eq!(wire.params, json!({
                    "environments":[{"environmentConfigId":config_id}],"deferredEnvironment":true,
                    "pluginsMcp":{"productSku":"codex"},"ephemeral":false,
                    "model":"fixture-model","serviceTier":"priority",
                    "config":{"features.mcp_app_ui":true,"model_reasoning_effort":"high"},
                }));
                std::future::ready(Ok(json!({"thread":{"id":"thread-confirmed","environments":[
                    {"environmentConfigId":config_id,"environmentId":"env-real"}
                ],"private":"discard"}})))
            },
        ).await.unwrap();
        assert_eq!(response.host_id, "durable");
        assert_eq!(response.body, json!({"thread":{"id":"thread-confirmed"}}));
    }

    #[tokio::test]
    async fn durable_cloud_start_rejects_bad_input_and_identity_before_dispatch() {
        for id in [
            "",
            "managed",
            "../asenvcfg_other",
            "asenvcfg_",
            "~asenvcfg_other",
            "a~b~asenvcfg_other",
        ] {
            let result = ChatgptService::default()
                .durable_thread_with(
                    serde_json::from_value(request(id)).unwrap(),
                    cloud_profile(),
                    share_rpc,
                    |_, _, _| -> std::future::Ready<Result<Value, crate::durable::Error>> {
                        panic!("invalid start dispatched")
                    },
                )
                .await;
            assert_eq!(result.err().unwrap().code, "invalid_request");
        }
        let mut raw = request("asenvcfg_fixture");
        raw["expectedIdentity"]["userId"] = json!("other");
        let result = ChatgptService::default()
            .durable_thread_with(
                serde_json::from_value(raw).unwrap(),
                cloud_profile(),
                share_rpc,
                |_, _, _| -> std::future::Ready<Result<Value, crate::durable::Error>> {
                    panic!("identity mismatch dispatched")
                },
            )
            .await;
        assert_eq!(result.err().unwrap().code, "account_changed");
        for field in [
            "cwd",
            "runtimeWorkspaceRoots",
            "prompt",
            "onboardingConfigId",
        ] {
            let mut raw = request("asenvcfg_fixture");
            raw["operation"][field] = json!("untrusted");
            assert!(
                serde_json::from_value::<DurableThreadRequest>(raw).is_err(),
                "{field}"
            );
        }
    }

    #[tokio::test]
    async fn durable_cloud_start_never_replays_when_the_result_is_ambiguous() {
        for outcome in [
            Err(crate::durable::Error::Closed),
            Err(crate::durable::Error::Timeout),
            Ok(json!({"thread":{}})),
            Ok(json!({"thread":{"id":"thread","environmentConfigId":"asenvcfg_other"}})),
            Ok(
                json!({"thread":{"id":"thread","environments":[{"environmentConfigId":"asenvcfg_other"}]}}),
            ),
        ] {
            let sends = AtomicUsize::new(0);
            let result = ChatgptService::default()
                .durable_thread_with(
                    serde_json::from_value(request("asenvcfg_fixture")).unwrap(),
                    cloud_profile(),
                    share_rpc,
                    |_, _, _| {
                        sends.fetch_add(1, Ordering::SeqCst);
                        std::future::ready(outcome)
                    },
                )
                .await;
            assert_eq!(result.err().unwrap().code, "cloud_thread_start_unconfirmed");
            assert_eq!(sends.load(Ordering::SeqCst), 1);
        }
    }

    #[tokio::test]
    async fn durable_cloud_start_drops_ack_on_account_change_or_cancellation() {
        for invalidate in [true, false] {
            let service = ChatgptService::default();
            let sends = AtomicUsize::new(0);
            let result = service
                .durable_thread_with(
                    serde_json::from_value(request("asenvcfg_fixture")).unwrap(),
                    cloud_profile(),
                    share_rpc,
                    |_, _, _| {
                        sends.fetch_add(1, Ordering::SeqCst);
                        if invalidate {
                            service.invalidate();
                        } else {
                            assert!(service.cancel("cloud-start-fixture"));
                        }
                        std::future::ready(Ok(json!({"thread":{"id":"late-thread"}})))
                    },
                )
                .await;
            assert_eq!(
                result.err().unwrap().code,
                if invalidate {
                    "account_changed"
                } else {
                    "cloud_thread_start_unconfirmed"
                }
            );
            assert_eq!(sends.load(Ordering::SeqCst), 1);
        }
    }
}
