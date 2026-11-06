//! Typed, explicit Sites settings writes. No caller-selected URL, verb or headers.
use super::*;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteEnvironmentValue { pub is_secret:bool, pub key:String, pub r#type:String, pub value:String }
#[derive(Clone, Deserialize)]
#[serde(tag="operation",rename_all="snake_case",deny_unknown_fields)]
pub enum SitesSettingsMutation {
    Title {title:String},
    Environment {remove:Vec<String>,set_values:Vec<SiteEnvironmentValue>},
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SitesSettingsRequest {
    pub request_id:String, pub expected_identity:ServiceIdentity, pub profile:ServiceProfile,
    pub id:String, pub mutation:SitesSettingsMutation,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SitesSettingsResponse { pub request_id:String, pub identity:ServiceIdentity, pub body:Value }

fn unknown()->ServiceError {failure("sites_settings_unknown","Site settings write outcome is unknown; read the settings before retrying")}
fn request_body(mutation:&SitesSettingsMutation)->ServiceResult<(&'static str,&'static str,Value)> {
    let result=match mutation {
        SitesSettingsMutation::Title{title}=>{
            let title=title.trim();
            if title.is_empty() {return Err(failure("invalid_request","Site title must not be empty"));}
            ("title","metadata",json!({"title":title}))
        },
        SitesSettingsMutation::Environment{remove,set_values}=>{
            let mut keys=std::collections::HashSet::new();
            if remove.iter().any(|key|key.trim().is_empty()) || set_values.iter().any(|entry|entry.key.trim().is_empty() || entry.r#type!="envvar" || !keys.insert(&entry.key)) {
                return Err(failure("invalid_request","Invalid site environment keys or entry type"));
            }
            ("environment","environment",json!({"remove":remove,"set_values":set_values.iter().map(|entry|json!({"is_secret":entry.is_secret,"key":entry.key,"type":"envvar","value":entry.value})).collect::<Vec<_>>()}))
        },
    };
    // This is the existing host JSON transport bound, not a field limit from the official UI.
    if serde_json::to_vec(&result.2).map_err(|_|failure("invalid_request","Invalid site settings body"))?.len()>256*1024 {
        return Err(failure("invalid_request","Site settings request exceeds the host transport limit"));
    }
    Ok(result)
}
fn validate_body(mutation:&SitesSettingsMutation,id:&str,body:&Value)->ServiceResult<()> {
    let valid=match mutation {
        SitesSettingsMutation::Title{..}=>body.get("title").is_some_and(Value::is_string) && body.get("updated_at").is_some_and(Value::is_string),
        SitesSettingsMutation::Environment{..}=>body.get("project_id").and_then(Value::as_str)==Some(id)
            && body.get("revision").and_then(Value::as_f64).is_some()
            && body.get("updated_at").is_some_and(|value|value.is_string()||value.is_null())
            && body.get("requires_secrets").is_none_or(Value::is_boolean)
            && body.get("entries").and_then(Value::as_array).is_some_and(|entries|entries.iter().all(|entry|
                entry.get("key").is_some_and(Value::is_string) && entry.get("is_secret").is_some_and(Value::is_boolean)
                && entry.get("type").and_then(Value::as_str)==Some("envvar")
                && entry.get("value").is_some_and(|value|value.is_string()||value.is_null()))),
    };
    if valid {Ok(())}else{Err(unknown())}
}
fn known_environment_error(response:&HttpResponse)->Option<ServiceError> {
    if !(400..500).contains(&response.status) {return None;}
    let body:Value=serde_json::from_slice(&response.body).ok()?;
    let code=match body.pointer("/detail/type").and_then(Value::as_str)? {
        "environment_requires_secrets"=>"environment_requires_secrets",
        "invalid_secret_name"=>"invalid_secret_name",
        "regional_environment_unavailable"=>"regional_environment_unavailable",
        _=>return None,
    };
    Some(ServiceError{code,message:"Site environment could not be saved; review its regional requirements",status:Some(response.status)})
}
struct SettingsGuard<'a>{service:&'a ChatgptService,key:(String,String,u64,String,&'static str)}
impl Drop for SettingsGuard<'_>{fn drop(&mut self){if let Ok(mut active)=self.service.site_settings_active.lock(){active.remove(&self.key);}}}
impl ChatgptService {
    pub async fn sites_settings<F,Fut>(&self,request:SitesSettingsRequest,call:F)->ServiceResult<SitesSettingsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.sites_settings_with(request,call,&CurlTransport).await
    }
    pub(super) async fn sites_settings_with<F,Fut,T>(&self,request:SitesSettingsRequest,call:F,transport:&T)->ServiceResult<SitesSettingsResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        validate_browser_profile(&request.profile)?;
        let encoded_id=encode_segment(&request.id)?;
        let (field,suffix,body)=request_body(&request.mutation)?;
        let route=format!("/backend-api/websites/{encoded_id}/{suffix}");
        self.check_share_identity(&request.expected_identity)?;
        let key=(request.expected_identity.account_id.clone(),request.expected_identity.user_id.clone(),request.expected_identity.generation,request.id.clone(),field);
        {let mut active=self.site_settings_active.lock().map_err(|_|failure("busy","Site settings are busy"))?;if !active.insert(key.clone()){return Err(failure("busy","This site field already has a pending write; read before retrying"));}}
        let _guard=SettingsGuard{service:self,key};
        let registration=self.register(&request.request_id)?;
        let sent=AtomicBool::new(false);
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(if sent.load(Ordering::SeqCst){unknown()}else{failure("cancelled","Service request cancelled")}),
            result=async {
                let mut session=self.session.lock().await;
                self.prepare(&mut session,request.expected_identity.generation,&call,false).await?;
                self.check_share_current(&request.expected_identity,&registration)?;
                let credentials=session.credentials.as_ref().unwrap();
                if credentials.identity!=request.expected_identity {return Err(failure("account_changed","Authenticated identity changed"));}
                let integrity=session.integrity.clone();
                let mut outgoing=build_http_request(&route,credentials,integrity.as_deref(),&request.profile)?;
                outgoing.method=HttpMethod::Post;
                outgoing.headers.insert("Content-Type".into(),"application/json".into());
                outgoing.body=serde_json::to_vec(&body).map_err(|_|failure("invalid_request","Invalid site settings body"))?;
                let destination=outgoing.url.clone();
                share_network_allowed(&call,&destination).await?;
                self.check_share_current(&request.expected_identity,&registration)?;
                sent.store(true,Ordering::SeqCst);
                let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await.map_err(|_|unknown())?;
                self.check_share_current(&request.expected_identity,&registration)?;
                share_network_allowed(&call,&destination).await?;
                self.check_share_current(&request.expected_identity,&registration)?;
                apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                if response.status>=500 {return Err(unknown());}
                if matches!(request.mutation,SitesSettingsMutation::Environment{..}) {if let Some(error)=known_environment_error(&response){return Err(error);}}
                let success=(200..300).contains(&response.status);
                let decoded=decode_response(response,request.request_id.clone(),request.expected_identity.clone()).map_err(|error|if success{unknown()}else{error})?;
                validate_body(&request.mutation,&request.id,&decoded.body)?;
                Ok(SitesSettingsResponse{request_id:request.request_id.clone(),identity:request.expected_identity.clone(),body:decoded.body})
            }=>result,
        };
        self.check_share_identity(&request.expected_identity)?;
        result.map_err(|error|if sent.load(Ordering::SeqCst) && matches!(error.code,"cancelled"|"network_restricted"){unknown()}else{error})
    }
}
