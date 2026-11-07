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
}
