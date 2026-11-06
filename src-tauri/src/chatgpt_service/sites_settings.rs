//! Typed, explicit Sites settings writes. No caller-selected URL, verb or headers.
use super::*;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteEnvironmentValue { pub is_secret:bool, pub key:String, pub r#type:String, pub value:String }
#[derive(Clone, Deserialize)]
#[serde(tag="operation",rename_all="snake_case",deny_unknown_fields)]
pub enum SitesSettingsMutation {
    Title {title:String},
    SlugAvailability {slug:String},
    Slug {slug:String},
    DomainAdd {hostname:String},
    DomainRefresh {domain_id:String},
    DomainRemove {domain_id:String},
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
fn javascript_trim(raw:&str)->&str {
    // Match JavaScript String.trim: BOM is whitespace, NEL is not.
    raw.trim_matches(|c:char|matches!(c,'\u{0009}'|'\u{000a}'|'\u{000b}'|'\u{000c}'|'\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))
}
fn normalized_slug(raw:&str)->ServiceResult<String> {
    let slug=javascript_trim(raw).to_ascii_lowercase();
    // Equivalent to the source /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/ without a new dependency.
    if !slug.as_bytes().first().is_some_and(u8::is_ascii_lowercase) || slug.ends_with('-') || slug.contains("--")
        || slug.bytes().any(|byte|!byte.is_ascii_lowercase() && !byte.is_ascii_digit() && byte!=b'-') {
        return Err(failure("invalid_request","Invalid site URL slug"));
    }
    Ok(slug)
}
fn mutates_settings(mutation:&SitesSettingsMutation)->bool { !matches!(mutation,SitesSettingsMutation::SlugAvailability{..}) }
fn request_body(mutation:&SitesSettingsMutation)->ServiceResult<(&'static str,&'static str,Value)> {
    let result=match mutation {
        SitesSettingsMutation::DomainAdd{hostname}=>{
            let hostname=javascript_trim(hostname);
            if hostname.is_empty(){return Err(failure("invalid_request","Site custom domain hostname must not be empty"));}
            ("domains","custom_domains",json!({"hostname":hostname}))
        },
        SitesSettingsMutation::DomainRefresh{..}|SitesSettingsMutation::DomainRemove{..}=>("domains","custom_domains",Value::Null),
        SitesSettingsMutation::SlugAvailability{slug}=>("slug_availability","slug/availability",json!({"slug":normalized_slug(slug)?})),
        SitesSettingsMutation::Slug{slug}=>("slug","metadata",json!({"slug":normalized_slug(slug)?})),
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
fn valid_custom_domain(body:&Value,project_id:&str,domain_id:Option<&str>)->bool {
    body.get("project_id").and_then(Value::as_str)==Some(project_id)
        && domain_id.is_none_or(|id|body.get("id").and_then(Value::as_str)==Some(id))
        && ["id","hostname","created_at","updated_at","worker_name"].iter().all(|key|body.get(*key).is_some_and(Value::is_string))
        && ["cname_target","last_error","provider_status","ssl_status"].iter().all(|key|body.get(*key).is_some_and(|value|value.is_string()||value.is_null()))
        && body.get("status").and_then(Value::as_str).is_some_and(|status|matches!(status,"pending"|"active"|"failed"))
        && body.get("apex_proxy_ipv4_targets").and_then(Value::as_array).is_some_and(|targets|targets.iter().all(Value::is_string))
        && body.get("validation_records").and_then(Value::as_array).is_some_and(|records|records.iter().all(|record|record.is_object()
            && ["name","record_type","value"].iter().all(|key|record.get(*key).is_none_or(|value|value.is_null()||value.is_string()))))
}
fn validate_body(mutation:&SitesSettingsMutation,id:&str,body:&Value)->ServiceResult<()> {
    let valid=match mutation {
        SitesSettingsMutation::DomainAdd{..}=>valid_custom_domain(body,id,None),
        SitesSettingsMutation::DomainRefresh{domain_id}|SitesSettingsMutation::DomainRemove{domain_id}=>valid_custom_domain(body,id,Some(domain_id)),
        SitesSettingsMutation::SlugAvailability{slug}=>body.get("slug").and_then(Value::as_str)==normalized_slug(slug).ok().as_deref() && body.get("available").is_some_and(Value::is_boolean),
        SitesSettingsMutation::Slug{slug}=>body.pointer("/slug_change/requested_slug").and_then(Value::as_str)==normalized_slug(slug).ok().as_deref()
            && body.pointer("/slug_change/status").and_then(Value::as_str).is_some_and(|status|matches!(status,"pending"|"complete")),
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
    if valid {Ok(())}else if mutates_settings(mutation){Err(unknown())}else{Err(failure("invalid_response","Site URL availability response did not match the request"))}
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
fn known_domain_add_error(response:&HttpResponse)->Option<ServiceError> {
    if !(400..500).contains(&response.status){return None;}
    let body:Value=serde_json::from_slice(&response.body).ok()?;
    if body.pointer("/detail/type").and_then(Value::as_str)==Some("invalid_project")
        && body.pointer("/detail/message").and_then(Value::as_str)==Some("Publish the Site before adding a custom domain") {
        Some(ServiceError{code:"site_domain_publish_required",message:"Publish the Site before adding a custom domain",status:Some(response.status)})
    }else{None}
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
        let suffix=match &request.mutation {
            SitesSettingsMutation::DomainRefresh{domain_id}=>format!("custom_domains/{}/refresh",encode_segment(domain_id)?),
            SitesSettingsMutation::DomainRemove{domain_id}=>format!("custom_domains/{}",encode_segment(domain_id)?),
            _=>suffix.to_owned(),
        };
        let route=format!("/backend-api/websites/{encoded_id}/{suffix}");
        self.check_share_identity(&request.expected_identity)?;
        let key=(request.expected_identity.account_id.clone(),request.expected_identity.user_id.clone(),request.expected_identity.generation,request.id.clone(),field);
        {let mut active=self.site_settings_active.lock().map_err(|_|failure("busy","Site settings are busy"))?;if !active.insert(key.clone()){return Err(failure("busy","This site field already has a pending write; read before retrying"));}}
        let _guard=SettingsGuard{service:self,key};
        let registration=self.register(&request.request_id)?;
        let mutating=mutates_settings(&request.mutation);
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
                outgoing.method=if matches!(request.mutation,SitesSettingsMutation::DomainRemove{..}){HttpMethod::Delete}else{HttpMethod::Post};
                if !matches!(request.mutation,SitesSettingsMutation::DomainRefresh{..}|SitesSettingsMutation::DomainRemove{..}) {
                    outgoing.headers.insert("Content-Type".into(),"application/json".into());
                    outgoing.body=serde_json::to_vec(&body).map_err(|_|failure("invalid_request","Invalid site settings body"))?;
                }
                let destination=outgoing.url.clone();
                share_network_allowed(&call,&destination).await?;
                self.check_share_current(&request.expected_identity,&registration)?;
                sent.store(mutating,Ordering::SeqCst);
                let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await.map_err(|error|if mutating{unknown()}else{error})?;
                self.check_share_current(&request.expected_identity,&registration)?;
                share_network_allowed(&call,&destination).await?;
                self.check_share_current(&request.expected_identity,&registration)?;
                apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
                if mutating && response.status>=500 {return Err(unknown());}
                if matches!(request.mutation,SitesSettingsMutation::DomainAdd{..}){if let Some(error)=known_domain_add_error(&response){return Err(error);}}
                if matches!(request.mutation,SitesSettingsMutation::Environment{..}) {if let Some(error)=known_environment_error(&response){return Err(error);}}
                let success=(200..300).contains(&response.status);
                let decoded=decode_response(response,request.request_id.clone(),request.expected_identity.clone()).map_err(|error|if success && mutating{unknown()}else{error})?;
                validate_body(&request.mutation,&request.id,&decoded.body)?;
                Ok(SitesSettingsResponse{request_id:request.request_id.clone(),identity:request.expected_identity.clone(),body:decoded.body})
            }=>result,
        };
        self.check_share_identity(&request.expected_identity)?;
        result.map_err(|error|if sent.load(Ordering::SeqCst) && matches!(error.code,"cancelled"|"network_restricted"){unknown()}else{error})
    }
}
