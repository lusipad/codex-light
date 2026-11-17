use super::*;

pub(super) fn route(params: &Value) -> ServiceResult<String> {
    if !params.as_object().is_some_and(|params| params.is_empty()) {
        return Err(failure("invalid_request", "Work models does not accept parameters"));
    }
    Ok("/backend-api/models?iim=false&include_icons=false&is_gizmo=false&merged=true".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_models_route_is_fixed_and_rejects_renderer_overrides() {
        assert_eq!(route(&json!({})).unwrap(), "/backend-api/models?iim=false&include_icons=false&is_gizmo=false&merged=true");
        for params in [Value::Null, json!([]), json!({"merged":false}), json!({"url":"https://example.test"}), json!({"accountId":"other"})] {
            assert!(route(&params).is_err());
        }
    }
}

#[cfg(test)]
mod service_tests {
    use super::*;

    fn request(id: &str) -> ServiceRequest {
        ServiceRequest { request_id: id.into(), operation: ServiceOperation::WorkModels, params: json!({}),
            expected_identity: ServiceIdentity { account_id:"work-account".into(), user_id:"work-user".into(), generation:0 },
            profile: ServiceProfile { language:"zh-CN".into(), device_id:"fixture-device".into(),
                user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(), user_agent_client_hints:"\"Chromium\";v=\"140\"".into(), platform_client_hint:"\"Windows\"".into() } }
    }
    fn rpc(method: &'static str, _: Value) -> std::future::Ready<Result<Value, String>> {
        std::future::ready(match method {
            "getAuthStatus" => { let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"work-account","user_id":"work-user","chatgpt_account_is_fedramp":false}});
                let token=format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
                Ok(json!({"authMethod":"chatgpt","authToken":token})) },
            "account/read" => Ok(json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"work-account","accountRoutingOverride":"NO_CONSTRAINT"}})),
            "configRequirements/read" => Ok(json!({"requirements":null})),
            _ => Err("Unexpected model fixture RPC".into()),
        })
    }
    struct Recorded<'a> { requests: Mutex<Vec<HttpRequest>>, retire: Option<&'a ChatgptService>, cancel_id: Option<&'a str> }
    impl Transport for Recorded<'_> {
        fn send(&self, request: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move { self.requests.lock().unwrap().push(request);
                if let Some(service)=self.retire { if let Some(id)=self.cancel_id { service.cancel(id); } else { service.invalidate(); } }
                Ok(HttpResponse { status:200, headers:BTreeMap::new(), body:br#"{"models":[],"default_model_slug":null}"#.to_vec() }) })
        }
    }
    #[tokio::test]
    async fn work_models_uses_fixed_get_and_rejects_overrides_before_auth() {
        let service=ChatgptService::default(); let transport=Recorded { requests:Mutex::new(vec![]),retire:None,cancel_id:None };
        let result=service.read_with(request("work-models"),rpc,&transport).await.unwrap();
        assert_eq!(result.identity,request("unused").expected_identity);
        { let sent=transport.requests.lock().unwrap(); assert_eq!(sent.len(),1);
            assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/models?iim=false&include_icons=false&is_gizmo=false&merged=true");
            assert!(matches!(sent[0].method,HttpMethod::Get)); assert_eq!(sent[0].headers["ChatGPT-Account-Id"],"work-account"); }
        for params in [Value::Null,json!([]),json!({"merged":false}),json!({"url":"https://example.test"})] {
            let mut req=request("invalid-work-models");req.params=params;
            let error=service.read_with(req,|_,_|std::future::ready(Err("Auth must not run".into())),&transport).await.err().unwrap();
            assert_eq!(error.code,"invalid_request");
        }
        assert_eq!(transport.requests.lock().unwrap().len(),1);
    }
    #[tokio::test]
    async fn work_models_obeys_network_restrictions_and_drops_retired_results() {
        let service=ChatgptService::default(); let transport=Recorded { requests:Mutex::new(vec![]),retire:None,cancel_id:None };
        let denied=|method,params|if method=="configRequirements/read" { std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}))) } else { rpc(method,params) };
        assert!(service.read_with(request("work-models-denied"),denied,&transport).await.is_err());
        assert!(transport.requests.lock().unwrap().is_empty());
        for cancelled in [false,true] {
            let service=ChatgptService::default();let id="retire-work-models";
            let transport=Recorded { requests:Mutex::new(vec![]),retire:Some(&service),cancel_id:cancelled.then_some(id) };
            assert!(service.read_with(request(id),rpc,&transport).await.is_err());
        }
    }
}
