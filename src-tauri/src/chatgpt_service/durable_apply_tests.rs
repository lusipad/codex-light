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
}
