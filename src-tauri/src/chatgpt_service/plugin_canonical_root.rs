//! Root details distinguish unresolved canonical membership from service errors.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PluginCanonicalRootRequest {
    pub request_id:String,
    pub expected_identity:ServiceIdentity,
    pub profile:ServiceProfile,
    pub plugin_id:String,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity()->ServiceIdentity {ServiceIdentity{account_id:"root-account".into(),user_id:"root-user".into(),generation:0}}
    fn request()->PluginCanonicalRootRequest {PluginCanonicalRootRequest{request_id:"canonical-root-fixture".into(),expected_identity:identity(),plugin_id:"plugin-real".into(),profile:ServiceProfile{
        language:"zh-CN".into(),device_id:"fixture-device".into(),user_agent:"Mozilla/5.0 Chrome/140.0.0.0".into(),user_agent_client_hints:"\"Chromium\";v=\"140\"".into(),platform_client_hint:"\"Windows\"".into()}}}
    fn token()->String {let claims=json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":"root-account","user_id":"root-user","chatgpt_account_is_fedramp":false}});format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))}
    async fn rpc(method:&'static str,_:Value)->Result<Value,String>{Ok(match method{
        "getAuthStatus"=>json!({"authMethod":"chatgpt","authToken":token()}),"account/read"=>json!({"account":{"type":"chatgpt","planType":"future-plan"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"root-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
        "configRequirements/read"=>json!({"requirements":null}),_=>panic!("unexpected RPC {method}"),})}
    fn plugin()->Value {json!({"id":"plugin-real","name":"raw-name","secret":"never-return","release":{"display_name":"Display name","version":"1.2.3","app_ids":["asdk_app_real"],"requires_local_executor":true,
        "interface":{"short_description":" Raw short description ","logo_url":"https://example.test/light.png","logo_url_dark":"https://example.test/dark.png","secret":"never-return"}}})}
    fn page(plugins:Vec<Value>,next:Option<&str>)->Value {json!({"plugins":plugins,"pagination":{"next_page_token":next}})}
    fn content()->Value {json!({"apps":[{"id":"connector_real","name":"Hosted name","description":"Hosted description","icon_url":"https://example.test/app-light.png","icon_dark_url":"https://example.test/app-dark.png","secret":"never-return"}]})}
    fn replies()->Vec<(u16,Value)> {vec![(200,plugin()),(200,page(vec![plugin()],None)),(200,json!({"plugin_id":"plugin-real"})),(200,content())]}
    struct Fixture{replies:Mutex<VecDeque<ServiceResult<HttpResponse>>>,sent:Mutex<Vec<HttpRequest>>}
    impl Fixture{fn new(values:Vec<(u16,Value)>)->Self{Self{replies:Mutex::new(values.into_iter().map(|(status,body)|Ok(HttpResponse{status,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})).collect()),sent:Mutex::new(vec![])}}}
    impl Transport for Fixture{fn send(&self,request:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.sent.lock().unwrap().push(request);self.replies.lock().unwrap().pop_front().expect("unexpected HTTP request")})}}
    #[tokio::test]
    async fn canonical_root_preserves_requires_local_root_header_and_real_hosted_content(){
        let transport=Fixture::new(replies());let result=ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.unwrap();
        assert_eq!(result.body["kind"],"canonical");assert_eq!(result.body["appId"],"asdk_app_real");assert_eq!(result.body["nativeEligibility"],"unverified");
        assert_eq!(result.body["pluginHeader"],json!({"id":"plugin-real","name":"Display name","version":"1.2.3","shortDescription":" Raw short description ","logoUrl":"https://example.test/light.png","logoUrlDark":"https://example.test/dark.png"}));
        assert_eq!(result.body["hostedApp"],json!({"name":"Hosted name","description":"Hosted description","logoUrl":"https://example.test/app-light.png","logoUrlDark":"https://example.test/app-dark.png"}));assert!(result.body["hostedError"].is_null());
        let serialized=serde_json::to_string(&result).unwrap();assert!(!serialized.contains("never-return")&&!serialized.contains(&token()));
        let sent=transport.sent.lock().unwrap();assert_eq!(sent.len(),4);assert_eq!(sent[0].url,"https://chatgpt.com/backend-api/ps/plugins/plugin-real");assert!(sent[1].url.ends_with("/ps/plugins/installed?limit=1000&includeExtensions=true"));assert!(sent[2].url.ends_with("/ps/plugins/canonical-app/asdk_app_real"));
        assert_eq!(sent[3].method,HttpMethod::Post);assert!(sent[3].url.ends_with("/ps/apps/batch"));assert_eq!(sent[3].headers["OAI-Product-Sku"],"CONNECTOR_SETTING");assert_eq!(serde_json::from_slice::<Value>(&sent[3].body).unwrap(),json!({"app_ids":["asdk_app_real"],"include_tools":false}));
        assert!(sent.iter().all(|item|!item.url.contains("/aip/connectors/")));
    }
    #[test]
    fn canonical_root_header_uses_nullish_fallback_and_preserves_raw_empty_strings(){
        let mut source=plugin();source["release"]["display_name"]=json!("");source["release"]["interface"]["short_description"]=json!("");source["release"]["version"]=Value::Null;
        let header=canonical_root_header(&source).unwrap();assert_eq!(header["name"],"");assert_eq!(header["shortDescription"],"");assert!(header["version"].is_null());
        source["release"]["display_name"]=Value::Null;source["release"]["interface"]=Value::Null;
        let header=canonical_root_header(&source).unwrap();assert_eq!(header["name"],"raw-name");assert!(header["shortDescription"].is_null()&&header["logoUrl"].is_null());
        source["release"]["display_name"]=json!(false);assert!(canonical_root_header(&source).is_err());
    }
    #[tokio::test]
    async fn canonical_root_no_unique_candidate_is_generic_without_reverse_or_hosted_guess(){
        for case in ["empty","multiple","empty-template","materialized-template","canonical-mismatch"] {
            let mut source=plugin();match case{
                "empty"=>source["release"]["app_ids"]=json!([]),"multiple"=>source["release"]["app_ids"]=json!(["connector_real","connector_other"]),
                "empty-template"=>source["release"]["app_templates"]=json!([{}]),"materialized-template"=>source["release"]["app_templates"]=json!([{"materialized_app_ids":["connector_real"]}]),
                "canonical-mismatch"=>source["canonical_app_id"]=json!("connector_other"),_=>unreachable!(),}
            let transport=Fixture::new(vec![(200,source.clone()),(200,page(vec![source],None))]);let result=ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["kind"],"generic","{case}");assert!(result.body["appId"].is_null()&&result.body["hostedApp"].is_null());assert_eq!(transport.sent.lock().unwrap().len(),2);
        }
    }
    #[tokio::test]
    async fn canonical_root_reverse_null_wrong_plugin_or_service_error_keeps_generic(){
        for (status,association) in [(200,json!({"plugin_id":null})),(200,json!({"plugin_id":"other"})),(503,json!({})),(200,json!({}))] {
            let transport=Fixture::new(vec![(200,plugin()),(200,page(vec![plugin()],None)),(status,association)]);
            let result=ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["kind"],"generic");assert!(result.body["hostedError"].is_null());assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
    }
    #[tokio::test]
    async fn canonical_root_main_detail_and_complete_inventory_failures_are_not_generic(){
        for values in [vec![(503,json!({}))],vec![(200,plugin()),(503,json!({}))],vec![(200,plugin()),(200,json!({"plugins":[plugin()]}))]] {
            let transport=Fixture::new(values);assert!(ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.is_err());
        }
        let mut wrong=plugin();wrong["id"]=json!("other");let transport=Fixture::new(vec![(200,wrong)]);
        assert_eq!(ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.err().unwrap().code,"invalid_response");assert_eq!(transport.sent.lock().unwrap().len(),1);
    }
    #[tokio::test]
    async fn canonical_root_inventory_order_uses_real_enabled_presence_time_and_no_bundled_hide_alias(){
        for own_latest in [true,false] {
            let mut own=plugin();own["canonical_app_id"]=json!("connector_real");own["enabled"]=json!(false);own["installed_at"]=json!(if own_latest {"2026-11-16T00:00:00Z"}else{"2026-11-14T00:00:00Z"});
            let other=json!({"id":"other-plugin","name":"plan","enabled":true,"installed_at":"2026-11-15T00:00:00Z","canonical_app_id":"connector_real"});
            let mut values=vec![(200,plugin()),(200,page(vec![other],Some("page2"))),(200,page(vec![own],None))];
            if own_latest {values.extend([(200,json!({"plugin_id":"plugin-real"})),(200,content())]);}
            let transport=Fixture::new(values);let result=ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.unwrap();
            assert_eq!(result.body["kind"],if own_latest {"canonical"}else{"generic"});assert!(transport.sent.lock().unwrap()[2].url.contains("pageToken=page2"));
        }
    }
    #[test]
    fn canonical_inventory_sort_is_stable_and_uninstalled_times_are_ignored(){
        let ordered=plugin_app_link_permissions::canonical_service_inventory(vec![json!({"id":"zero-first"}),json!({"id":"not-installed","installed_at":"2099-01-01T00:00:00Z"}),
            json!({"id":"invalid-date","enabled":false,"installed_at":"not-a-date"}),json!({"id":"newer","enabled":false,"installed_at":"2026-11-16T00:00:00Z"}),json!({"id":"zero-last","enabled":true,"installed_at":null})]).unwrap();
        assert_eq!(ordered.iter().map(|row|row["id"].as_str().unwrap()).collect::<Vec<_>>(),vec!["newer","zero-first","not-installed","zero-last","invalid-date"]);
    }
    #[tokio::test]
    async fn canonical_root_hosted_failure_is_independent_and_explicit_canonical_skips_reverse(){
        for body in [json!({"apps":[]}),json!({"apps":false})] {
            let mut source=plugin();source["canonical_app_id"]=json!("connector_real");let transport=Fixture::new(vec![(200,source.clone()),(200,page(vec![source],None)),(200,body)]);
            let result=ChatgptService::default().plugin_canonical_root_with(request(),rpc,&transport).await.unwrap();assert_eq!(result.body["kind"],"canonical");assert!(result.body["hostedApp"].is_null());assert!(result.body["hostedError"]["code"].is_string());assert_eq!(transport.sent.lock().unwrap().len(),3);
        }
    }
    #[tokio::test]
    async fn canonical_root_generation_change_never_becomes_generic_or_hosted_warning(){
        struct Invalidate<'a>{service:&'a ChatgptService,fixture:Fixture,at:usize}
        impl Transport for Invalidate<'_>{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{
            let at=self.fixture.sent.lock().unwrap().len();let result=self.fixture.send(request,cancel).await;if at==self.at {self.service.invalidate();}result
        })}}
        for at in [0,2,3] {let service=ChatgptService::default();let transport=Invalidate{service:&service,fixture:Fixture::new(replies()),at};
            assert_eq!(service.plugin_canonical_root_with(request(),rpc,&transport).await.err().unwrap().code,"account_changed");assert_eq!(transport.fixture.sent.lock().unwrap().len(),at+1);}
    }
    #[tokio::test]
    async fn canonical_root_cancellation_during_reverse_does_not_fallback(){
        struct Wait{fixture:Fixture,entered:AtomicBool}
        impl Transport for Wait{fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{
            if request.url.contains("canonical-app") {self.entered.store(true,Ordering::SeqCst);cancelled(&cancel).await;Err(failure("cancelled","fixture cancellation"))}else{self.fixture.send(request,cancel).await}
        })}}
        let service=ChatgptService::default();let transport=Wait{fixture:Fixture::new(vec![(200,plugin()),(200,page(vec![plugin()],None))]),entered:AtomicBool::new(false)};
        let(result,())=tokio::join!(service.plugin_canonical_root_with(request(),rpc,&transport),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}assert!(service.cancel("canonical-root-fixture"));});
        assert_eq!(result.err().unwrap().code,"cancelled");assert_eq!(transport.fixture.sent.lock().unwrap().len(),2);
    }
}

fn canonical_root_invalid()->ServiceError {failure("invalid_response","Plugin root metadata is incomplete")}

fn canonical_root_header(plugin:&Value)->ServiceResult<Value> {
    let optional=|source:Option<&serde_json::Map<String,Value>>,key:&str|->ServiceResult<Value> {
        match source.and_then(|source|source.get(key)) {
            None|Some(Value::Null)=>Ok(Value::Null),
            Some(value) if value.is_string()=>Ok(value.clone()),
            _=>Err(canonical_root_invalid()),
        }
    };
    let release=match plugin.get("release") {None|Some(Value::Null)=>None,Some(value)=>Some(value.as_object().ok_or_else(canonical_root_invalid)?)};
    let interface=match release.and_then(|release|release.get("interface")) {None|Some(Value::Null)=>None,Some(value)=>Some(value.as_object().ok_or_else(canonical_root_invalid)?)};
    let display=optional(release,"display_name")?;
    let name=if display.is_null() {plugin.get("name").filter(|value|value.is_string()).ok_or_else(canonical_root_invalid)?.clone()}else{display};
    Ok(json!({"id":plugin["id"],"name":name,"version":optional(release,"version")?,"shortDescription":optional(interface,"short_description")?,
        "logoUrl":optional(interface,"logo_url")?,"logoUrlDark":optional(interface,"logo_url_dark")?}))
}

impl ChatgptService {
    pub async fn plugin_canonical_root_read<F,Fut>(&self,request:PluginCanonicalRootRequest,call:F)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.plugin_canonical_root_with(request,call,&CurlTransport).await
    }

    async fn plugin_canonical_root_with<F,Fut,T>(&self,request:PluginCanonicalRootRequest,call:F,transport:&T)->ServiceResult<PluginPermissionsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let encoded=encode_segment(&request.plugin_id)?;
        let registration=self.register(&request.request_id)?;
        let common=PluginPermissionsRequest{request_id:request.request_id.clone(),expected_identity:request.expected_identity,profile:request.profile};
        let identity=&common.expected_identity;
        let plugin=self.remote_plugin_http(&format!("/backend-api/ps/plugins/{encoded}"),HttpMethod::Get,false,identity,&common.profile,&registration,&call,transport).await?;
        validate_remote_plugin_row(&plugin)?;
        if plugin["id"].as_str()!=Some(request.plugin_id.as_str()) {return Err(canonical_root_invalid());}
        let header=canonical_root_header(&plugin)?;
        let inventory=plugin_app_link_permissions::canonical_service_inventory(self.remote_plugin_pages(identity,&common.profile,true,&registration,&call,transport).await?)?;
        let app_id=self.resolve_service_plugin_canonical(&plugin,&inventory,&common,&registration,&call,transport).await?;
        let mut hosted=Value::Null;let mut hosted_error=Value::Null;
        if let Some(app_id)=&app_id {
            let entry=PluginAppEntryRequest{request_id:request.request_id.clone(),expected_identity:identity.clone(),profile:common.profile.clone(),app_id:app_id.clone()};
            let content=self.plugin_app_content_http(&entry,&registration,&call,transport).await.and_then(|body|plugin_app_details::standalone_app(app_id,body));
            match content {
                Ok(content)=>hosted=json!({"name":content["name"],"description":content["description"],"logoUrl":content["logoUrl"],"logoUrlDark":content["logoUrlDark"]}),
                Err(error) if matches!(error.code,"account_changed"|"cancelled")=>return Err(error),
                Err(error)=>hosted_error=json!({"code":error.code,"message":"Hosted app content unavailable"}),
            }
        }
        self.check_share_current(identity,&registration)?;
        Ok(PluginPermissionsResponse{request_id:request.request_id,identity:identity.clone(),body:json!({"kind":if app_id.is_some(){"canonical"}else{"generic"},
            "pluginId":request.plugin_id,"appId":app_id,"pluginHeader":header,"hostedApp":hosted,"hostedError":hosted_error,"nativeEligibility":"unverified"})})
    }
}
