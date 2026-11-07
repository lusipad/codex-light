mod cloud_draft_save_tests {
    use super::*;

    fn request() -> CloudDraftSaveRequest {
        serde_json::from_value(json!({
            "requestId":"save-fixture", "expectedIdentity":identity(), "configId":"config_fixture",
            "draftId":"draft_fixture", "baseVersionId":"version-A", "expectedRevision":4,
            "installScript":"npm ci\n", "startSkill":""
        }))
        .unwrap()
    }

    fn readback(revision: u32, script: &str) -> Value {
        json!({"id":"config_fixture","draft":{"id":"draft_fixture","base_version_id":"version-A",
            "revision":revision,"install_script":script,"start_skill":null}})
    }

    fn network_request(policy: Value) -> CloudDraftSaveRequest {
        serde_json::from_value(json!({
            "requestId":"save-fixture", "expectedIdentity":identity(), "configId":"config_fixture",
            "draftId":"draft_fixture", "baseVersionId":"version-A", "expectedRevision":4,
            "networkPolicy":policy
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn cloud_draft_save_confirms_fixed_patch_and_readback() {
        let transport = FakeTransport::new(&[200, 200]);
        for response in transport.responses.lock().unwrap().iter_mut() {
            response.body = serde_json::to_vec(&readback(5, "npm ci\n")).unwrap();
        }
        let result = ChatgptService::default()
            .cloud_save_draft_with(request(), cloud_profile(), share_rpc, &transport)
            .await
            .unwrap();
        assert_eq!(result.body, readback(5, "npm ci\n"));
        let calls = transport.requests.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].method, HttpMethod::Patch);
        assert_eq!(calls[1].method, HttpMethod::Get);
        assert_eq!(calls[0].url, "https://codex-cloud-backend.chatgpt.com/v1/environment-configs/config_fixture/drafts/draft_fixture");
        assert_eq!(calls[0].url, calls[1].url);
        assert_eq!(
            serde_json::from_slice::<Value>(&calls[0].body).unwrap(),
            json!({
                "base_version_id":"version-A", "expected_revision":4, "install_script":"npm ci\n", "start_skill":""
            })
        );
        assert!(calls[1].body.is_empty());
    }

    #[tokio::test]
    async fn cloud_draft_save_conflict_and_ambiguous_status_never_replay_patch() {
        for (status, code) in [
            (409, "conflict"),
            (408, "cloud_draft_save_unconfirmed"),
            (503, "cloud_draft_save_unconfirmed"),
        ] {
            let transport = FakeTransport::new(&[status]);
            let result = ChatgptService::default()
                .cloud_save_draft_with(request(), cloud_profile(), share_rpc, &transport)
                .await;
            assert_eq!(result.err().unwrap().code, code);
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn cloud_draft_save_rejects_wrong_readback_value_and_unadvanced_revision() {
        for invalid in [readback(4, "npm ci\n"), readback(5, "other script")] {
            let transport = FakeTransport::new(&[200, 200]);
            transport.responses.lock().unwrap()[0].body =
                serde_json::to_vec(&readback(5, "npm ci\n")).unwrap();
            transport.responses.lock().unwrap()[1].body = serde_json::to_vec(&invalid).unwrap();
            let result = ChatgptService::default()
                .cloud_save_draft_with(request(), cloud_profile(), share_rpc, &transport)
                .await;
            assert_eq!(result.err().unwrap().code, "cloud_draft_save_unconfirmed");
            assert_eq!(transport.requests.lock().unwrap().len(), 2);
        }
    }

    #[tokio::test]
    async fn cloud_draft_save_sends_network_only_and_confirms_policy() {
        let policy = json!({"type":"restricted","presets":["package_managers"],
            "egress_rules":[{"host":"*.example.com"},{"host":"192.0.2.1"}]});
        let mut response = readback(5, "existing script");
        response["draft"]["network_policy"] = json!({"type":"restricted","presets":["package_managers"],
            "egress_rules":[{"host":"192.0.2.1"},{"host":"*.example.com"}]});
        for mismatched in [false, true] {
            let transport = FakeTransport::new(&[200, 200]);
            {
                let mut responses = transport.responses.lock().unwrap();
                responses[0].body = serde_json::to_vec(&response).unwrap();
                let mut read = response.clone();
                if mismatched {
                    read["draft"]["network_policy"]["presets"] = json!([]);
                }
                responses[1].body = serde_json::to_vec(&read).unwrap();
            }
            let result = ChatgptService::default()
                .cloud_save_draft_with(
                    network_request(policy.clone()),
                    cloud_profile(),
                    share_rpc,
                    &transport,
                )
                .await;
            if mismatched {
                assert_eq!(result.err().unwrap().code, "cloud_draft_save_unconfirmed");
            } else {
                assert_eq!(result.unwrap().body, response);
            }
            let calls = transport.requests.lock().unwrap();
            assert_eq!(calls.len(), 2);
            assert_eq!(
                serde_json::from_slice::<Value>(&calls[0].body).unwrap(),
                json!({"base_version_id":"version-A","expected_revision":4,"network_policy":policy})
            );
            assert_eq!(calls[1].method, HttpMethod::Get);
        }
    }

    #[tokio::test]
    async fn cloud_draft_save_rejects_invalid_policy_before_transport() {
        for hosts in [
            vec!["https://example.com"],
            vec!["example.com:443"],
            vec!["127.1"],
            vec!["192.0.2.001"],
            vec!["*.192.0.2.1"],
            vec!["same.example", "same.example"],
        ] {
            let rules: Vec<_> = hosts.into_iter().map(|host| json!({"host":host})).collect();
            let request = network_request(json!({"type":"restricted","egress_rules":rules}));
            let transport = FakeTransport::new(&[]);
            let result = ChatgptService::default()
                .cloud_save_draft_with(request, cloud_profile(), share_rpc, &transport)
                .await;
            assert_eq!(result.err().unwrap().code, "invalid_request");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
    }
}
