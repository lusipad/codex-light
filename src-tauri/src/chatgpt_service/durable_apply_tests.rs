mod durable_apply_tests {
    use super::*;

    const MESSAGE_ID: &str = "0843a3ba-7ae9-4e70-9c42-6054258ae17a";

    fn request(operation: Value) -> DurableThreadRequest {
        serde_json::from_value(json!({"requestId":"apply-fixture","expectedIdentity":identity(),"operation":operation})).unwrap()
    }

    fn add() -> Value {
        json!({"kind":"start_repository_apply","threadId":"thread-A","clientUserMessageId":MESSAGE_ID,
            "added":["org/new"],"removed":["org/old"]})
    }

    #[tokio::test]
    async fn durable_apply_correlates_the_repository_message_receipt() {
        let service = ChatgptService::default();
        let result = service
            .durable_thread_with(
                request(add()),
                cloud_profile(),
                share_rpc,
                |config, wire, _| {
                    assert_eq!(config.identity, identity());
                    assert_eq!(wire.method, "turn/start");
                    assert_eq!(wire.params["threadId"], "thread-A");
                    assert_eq!(wire.params["clientUserMessageId"], MESSAGE_ID);
                    assert_eq!(wire.params["cwd"], "/workspace");
                    assert_eq!(wire.params["turnTrigger"], "environment_onboarding");
                    for key in ["model", "effort", "serviceTier", "collaborationMode"] {
                        assert_eq!(wire.params.get(key), Some(&Value::Null));
                    }
                    assert_eq!(wire.params.as_object().unwrap().len(), 9);
                    let input = wire.params["input"].as_array().unwrap();
                    assert_eq!(input.len(), 1);
                    assert_eq!(input[0]["type"], "text");
                    assert_eq!(input[0]["text_elements"], json!([]));
                    let text = input[0]["text"].as_str().unwrap();
                    assert!(text.contains("Added: [\"org/new\"]. Removed: [\"org/old\"]."));
                    assert!(text.contains("no uncommitted or unpushed work"));
                    std::future::ready(Ok(
                        json!({"turn":{"id":"turn-A","private":"not projected"}}),
                    ))
                },
            )
            .await
            .unwrap();
        assert_eq!(result.host_id, "durable");
        assert_eq!(result.body, json!({"turn":{"id":"turn-A"}}));
    }

    #[tokio::test]
    async fn durable_apply_never_replays_ambiguous_delivery() {
        for response in [
            Err(crate::durable::Error::Closed),
            Err(crate::durable::Error::Timeout),
            Ok(json!({"threadId":"thread-B","turn":{"id":"turn-A"}})),
            Ok(json!({"turn":{}})),
            Ok(json!({"turn":{"id":"turn-A","clientUserMessageId":"another-message"}})),
        ] {
            let service = ChatgptService::default();
            let sends = AtomicUsize::new(0);
            let error = service
                .durable_thread_with(request(add()), cloud_profile(), share_rpc, |_, _, _| {
                    sends.fetch_add(1, Ordering::SeqCst);
                    std::future::ready(response)
                })
                .await
                .unwrap_err();
            assert_eq!(error.code, "cloud_repository_apply_unconfirmed");
            assert_eq!(sends.load(Ordering::SeqCst), 1);
        }
    }

    #[tokio::test]
    async fn durable_apply_rejects_invalid_changes_and_early_cancellation() {
        let service = ChatgptService::default();
        let mut invalid = add();
        invalid["added"] = json!([]);
        invalid["removed"] = json!([]);
        let error = service
            .durable_thread_with(
                request(invalid),
                cloud_profile(),
                share_rpc,
                |_, _, _| -> std::future::Ready<Result<Value, crate::durable::Error>> {
                    panic!("Invalid changes must not hand off")
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "invalid_request");

        let service = ChatgptService::default();
        service.cancel("apply-fixture");
        let error = service
            .durable_thread_with(request(add()), cloud_profile(), share_rpc, |_, _, _| {
                panic!("Cancelled apply operation must not hand off");
                #[allow(unreachable_code)]
                std::future::ready(Ok(Value::Null))
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "cancelled");
    }

    #[tokio::test]
    async fn durable_setup_projects_only_active_model_preferences() {
        let result = ChatgptService::default().durable_thread_with(
            request(json!({"kind":"setup_preferences"})), cloud_profile(), share_rpc, |_, wire, _| {
                assert_eq!(wire.method, "config/read");
                assert_eq!(wire.params, json!({"cwd":null,"includeLayers":false}));
                std::future::ready(Ok(json!({"config":{
                    "profile":"active","model":"root","service_tier":"priority","model_reasoning_effort":"high",
                    "profiles":{"active":{"model":"selected","service_tier":"flex","model_reasoning_effort":null,"unrelated":"hidden"}},
                    "unrelated":"hidden"
                }})))
            },
        ).await.unwrap();
        assert_eq!(
            result.body,
            json!({"config":{"model":"selected","service_tier":"flex","model_reasoning_effort":"high"}})
        );
    }

    #[tokio::test]
    async fn durable_setup_sends_two_fixed_text_items_and_never_replays_a_missing_receipt() {
        for (skill, private_draft, prompt) in [
            (
                Some("service:setup"),
                true,
                "使用 $service:setup 来设置此云环境",
            ),
            (
                None,
                true,
                "使用 $cloud-environment-onboarding:setup 来设置此云环境",
            ),
            (
                None,
                false,
                "先问我想运行什么，并和我讨论必要的细节。等我回复后，再开始设置这个云环境。",
            ),
        ] {
            let service = ChatgptService::default();
            let sends = AtomicUsize::new(0);
            let setup = json!({"kind":"start_environment_setup","threadId":"thread-A","clientUserMessageId":MESSAGE_ID,
                "cwd":"/workspace","model":"model-A","effort":"medium","serviceTier":"priority",
                "repositories":[{"name":"org/repo","ref":"feature/branch"}],"privateDraft":private_draft,"skill":skill});
            let error = service.durable_thread_with(request(setup), cloud_profile(), share_rpc, |_, wire, _| {
                sends.fetch_add(1, Ordering::SeqCst);
                assert_eq!(wire.method,"turn/start");
                assert_eq!(wire.params,json!({
                    "threadId":"thread-A","clientUserMessageId":MESSAGE_ID,"cwd":"/workspace","turnTrigger":"environment_onboarding",
                    "model":"model-A","effort":"medium","serviceTier":"priority","collaborationMode":null,
                    "input":[{"type":"text","text":"{\"repositories\":[{\"name\":\"org/repo\",\"ref\":\"feature/branch\"}]}\n\n## My request:","text_elements":[]},
                        {"type":"text","text":prompt,"text_elements":[]}]
                }));
                std::future::ready(Err(crate::durable::Error::Closed))
            }).await.unwrap_err();
            assert_eq!(error.code, "cloud_setup_turn_unconfirmed");
            assert_eq!(sends.load(Ordering::SeqCst), 1);
        }
    }

    #[tokio::test]
    async fn durable_setup_correlates_receipt_and_blocks_arbitrary_prompt() {
        let setup = json!({"kind":"start_environment_setup","threadId":"thread-A","clientUserMessageId":MESSAGE_ID,
            "cwd":"/workspace","repositories":[],"privateDraft":false});
        let mut invalid = setup.clone();
        invalid["input"] = json!([{"type":"text","text":"arbitrary"}]);
        assert!(serde_json::from_value::<DurableThreadRequest>(json!({
            "requestId":"invalid","expectedIdentity":identity(),"operation":invalid
        }))
        .is_err());
        let response = ChatgptService::default().durable_thread_with(request(setup), cloud_profile(), share_rpc, |_, _, _| {
            std::future::ready(Ok(json!({"turn":{"id":"turn-A","clientUserMessageId":MESSAGE_ID},"threadId":"thread-A"})))
        }).await.unwrap();
        assert_eq!(response.body, json!({"turn":{"id":"turn-A"}}));
    }
}
