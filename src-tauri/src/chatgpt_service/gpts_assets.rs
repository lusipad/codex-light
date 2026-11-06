//! Response-derived GPT profile pictures; independent of the Images capability.
use super::*;
const MAX_ASSETS: usize=4096;
const MAX_SNAPSHOT_ASSETS: usize=1024;

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct GptAssetRef { asset_key:String, source_request_id:String, id:String }
#[derive(Clone)]
struct Entry { reference:GptAssetRef, identity:ServiceIdentity, url:tauri::Url, authenticated:bool }
#[derive(Default)]
pub(super) struct GptsRegistry { entries:VecDeque<Entry>, latest:HashMap<String,(u64,Option<String>)>, floor:u64 }
fn unavailable()->ServiceError { failure("asset_unavailable","GPT avatar reference expired; refresh the GPT list") }

fn public_url(source:&str, origin:&str)->ServiceResult<tauri::Url> {
    if source.len()>16384 || source.chars().any(char::is_control) || source.contains('\\') { return Err(failure("invalid_response","Invalid GPT avatar URL")); }
    let mut url=if source.starts_with('/') && !source.starts_with("//") {tauri::Url::parse(&format!("{origin}{source}"))} else {tauri::Url::parse(source)}
        .map_err(|_|failure("invalid_response","Invalid GPT avatar URL"))?;
    url.set_fragment(None);
    validate_share_target(&ShareUploadTarget{upload_url:url.to_string(),headers:BTreeMap::new(),etag:"gpt-avatar".into(),file_id:"gpt-avatar".into()})?;
    Ok(url)
}
fn protected_url(url:&tauri::Url)->bool {
    let host=url.host_str().unwrap_or_default();
    url.scheme()=="https" && url.port().is_none() && (host=="chatgpt.com" || host.ends_with(".chatgpt.com") && !host.starts_with("ab."))
        && ["/backend-api/estuary/content","/backend-api/estuary/public_content/enc"].iter().any(|prefix|url.path()==*prefix || url.path().strip_prefix(*prefix).is_some_and(|rest|rest.starts_with('/')))
}

impl ChatgptService {
    pub(super) fn register_gpts_assets(&self,request:&ServiceRequest,body:&Value,origin:&str,snapshot:u64)->ServiceResult<Vec<GptAssetRef>> {
        self.check_share_identity(&request.expected_identity)?;
        let mut registry=self.gpts_assets.lock().map_err(|_|unavailable())?;
        self.check_share_identity(&request.expected_identity)?;
        if snapshot<=registry.floor {return Ok(Vec::new());}
        let mut gizmos=Vec::new();
        match request.operation {
            ServiceOperation::GptsDiscovery=>if let Some(cuts)=body.get("cuts").and_then(Value::as_array) {for cut in cuts {if let Some(items)=cut.pointer("/list/items").and_then(Value::as_array) {for item in items {if let Some(gizmo)=item.pointer("/resource/gizmo") {gizmos.push(gizmo);}}}}},
            ServiceOperation::GptsCategory=>if let Some(items)=body.pointer("/list/items").and_then(Value::as_array) {for item in items {if let Some(gizmo)=item.pointer("/resource/gizmo") {gizmos.push(gizmo);}}},
            ServiceOperation::GptsSearch=>if let Some(items)=body.get("items").and_then(Value::as_array) {for item in items {if let Some(gizmo)=item.get("gizmo") {gizmos.push(gizmo);}}},
            ServiceOperation::GptsDetail=>if let Some(gizmo)=body.get("gizmo").or_else(||body.pointer("/resource/gizmo")) {gizmos.push(gizmo);},
            _=>return Err(failure("invalid_request","GPT metadata required")),
        }
        let mut entries=Vec::new();
        let mut seen=std::collections::HashSet::new();
        for gizmo in gizmos {
            let Some(id)=gizmo.get("id").and_then(Value::as_str).filter(|id|!id.is_empty()&&id.len()<=2048&&!id.chars().any(char::is_control)) else {continue};
            if !seen.insert(id) {continue;}
            let source=if gizmo.get("gizmo_type").and_then(Value::as_str)==Some("snorlax") {None} else {gizmo.pointer("/display/profile_picture_url").and_then(Value::as_str).filter(|s|!s.trim().is_empty())};
            let parsed=source.and_then(|source|public_url(source,origin).ok());
            let normalized=parsed.as_ref().map(|url|url.to_string());
            if registry.latest.get(id).is_some_and(|(seq,_)|*seq>snapshot) {continue;}
            // A URL withdrawal/change revokes previous keys, including already downloading bytes.
            if registry.latest.get(id).is_some_and(|(_,url)|*url!=normalized) {registry.entries.retain(|entry|entry.reference.id!=id);}
            registry.latest.insert(id.to_owned(),(snapshot,normalized));
            let Some(url)=parsed else {continue};
            let authenticated=source.is_some_and(|s|tauri::Url::parse(s).is_ok())&&protected_url(&url);
            entries.push(Entry{reference:GptAssetRef{asset_key:uuid::Uuid::new_v4().to_string(),source_request_id:request.request_id.clone(),id:id.to_owned()},identity:request.expected_identity.clone(),url,authenticated});
        }
        if registry.latest.len()>MAX_ASSETS {registry.entries.clear();registry.latest.clear();registry.floor=snapshot;return Err(failure("asset_limit","Too many GPT avatar references; refresh the GPT list"));}
        if entries.len()>MAX_SNAPSHOT_ASSETS {return Err(failure("asset_limit","GPT metadata exceeds the avatar reference limit"));}
        while registry.entries.len()+entries.len()>MAX_ASSETS {registry.entries.pop_front();}
        let refs=entries.iter().map(|entry|entry.reference.clone()).collect();registry.entries.extend(entries);Ok(refs)
    }
    fn gpt_asset(&self,params:&Value,identity:&ServiceIdentity)->ServiceResult<Entry> {
        let params=params.as_object().ok_or_else(||failure("invalid_request","GPT avatar reference required"))?;
        if params.len()!=2 || !params.contains_key("asset_key") || !params.contains_key("source_request_id") {return Err(failure("invalid_request","GPT avatar accepts only asset_key and source_request_id"));}
        let string=|key|params.get(key).and_then(Value::as_str).filter(|s|!s.is_empty()&&s.len()<=512&&!s.chars().any(char::is_control));
        let key=string("asset_key").ok_or_else(||failure("invalid_request","GPT avatar key required"))?;
        let source=string("source_request_id").ok_or_else(||failure("invalid_request","GPT avatar source required"))?;
        self.check_share_identity(identity)?;
        self.gpts_assets.lock().map_err(|_|unavailable())?.entries.iter().find(|entry|entry.reference.asset_key==key&&entry.reference.source_request_id==source&&entry.identity==*identity).cloned().ok_or_else(unavailable)
    }
    fn check_gpt_asset(&self,entry:&Entry,request:&ServiceRequest,registration:&Registration<'_>)->ServiceResult<()> {
        self.check_share_current(&request.expected_identity,registration)?;
        if !self.gpts_assets.lock().map_err(|_|unavailable())?.entries.iter().any(|current|current.reference.asset_key==entry.reference.asset_key&&current.identity==request.expected_identity) {return Err(unavailable());} Ok(())
    }
    pub(super) async fn gpts_avatar_with<F,Fut,T>(&self,request:ServiceRequest,call:F,transport:&T)->ServiceResult<ServiceResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let entry=self.gpt_asset(&request.params,&request.expected_identity)?;
        let registration=self.register(&request.request_id)?;
        self.check_gpt_asset(&entry,&request,&registration)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Service request cancelled")),
            result=async {
                let (credentials,integrity)={let mut session=self.session.lock().await;self.prepare(&mut session,request.expected_identity.generation,&call,false).await?;self.check_gpt_asset(&entry,&request,&registration)?;(session.credentials.as_ref().unwrap().clone(),session.integrity.clone())};
                if credentials.identity!=request.expected_identity {return Err(failure("account_changed","Authenticated identity changed"));}
                let mut url=entry.url.clone();let mut authenticated=entry.authenticated;
                for step in 0..=5 {
                    self.check_gpt_asset(&entry,&request,&registration)?;share_network_allowed(&call,url.as_str()).await?;self.check_gpt_asset(&entry,&request,&registration)?;
                    authenticated &= protected_url(&url);
                    let outgoing=if authenticated {let route=format!("{}{}",url.path(),url.query().map(|q|format!("?{q}")).unwrap_or_default());let mut outgoing=build_http_request(&route,&credentials,integrity.as_deref(),&request.profile)?;outgoing.url=url.to_string();outgoing} else {HttpRequest{url:url.to_string(),headers:BTreeMap::new(),method:HttpMethod::Get,body:Vec::new()}};
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
                    self.check_gpt_asset(&entry,&request,&registration)?;share_network_allowed(&call,url.as_str()).await?;self.check_gpt_asset(&entry,&request,&registration)?;
                    if response.body.len() as u64>MAX_RESPONSE {return Err(failure("invalid_response","GPT avatar response is too large"));}
                    if matches!(response.status,301|302|303|307|308) {if step==5 {return Err(failure("invalid_response","Too many GPT avatar redirects"));}let location=response.headers.get("location").ok_or_else(||failure("invalid_response","GPT avatar redirect missing"))?;let next=url.join(location).map_err(|_|failure("invalid_response","Invalid GPT avatar redirect"))?;url=public_url(next.as_str(),&credentials.origin)?;authenticated &= protected_url(&url);continue;}
                    if !(200..300).contains(&response.status) {return Err(ServiceError{code:match response.status {401=>"unauthorized",403=>"forbidden",404=>"not_found",429=>"rate_limited",_=>"service_error"},message:"GPT avatar download failed",status:Some(response.status)});}
                    let mime=library_image_mime(&response.body).ok_or_else(||failure("invalid_response","GPT avatar is not a supported image"))?;
                    if response.headers.get("content-type").is_some_and(|header|header.split(';').next().unwrap_or("").trim()!=mime) {return Err(failure("invalid_response","GPT avatar MIME does not match its bytes"));}
                    self.check_gpt_asset(&entry,&request,&registration)?;
                    return Ok(json!({"dataUrl":format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(response.body))}));
                } unreachable!()
            }=>result,
        };
        self.check_gpt_asset(&entry,&request,&registration)?;
        result.map(|body|ServiceResponse{request_id:request.request_id,identity:request.expected_identity,status:200,body,headers:BTreeMap::new(),assets:None,gpt_assets:None})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpts_avatar_protected_url_matches_fresh_yia() {
        for host in ["chatgpt.com","cdn.chatgpt.com","abfoo.chatgpt.com"] {for path in ["/backend-api/estuary/content","/backend-api/estuary/content/id","/backend-api/estuary/public_content/enc","/backend-api/estuary/public_content/enc/id"] {assert!(protected_url(&tauri::Url::parse(&format!("https://{host}{path}")).unwrap()));}}
        for source in ["http://chatgpt.com/backend-api/estuary/content","https://ab.chatgpt.com/backend-api/estuary/content","https://ab.foo.chatgpt.com/backend-api/estuary/content","https://chatgpt.com.evil.test/backend-api/estuary/content","https://chatgpt-staging.com/backend-api/estuary/content","https://chatgpt.com/backend-api/estuary/content-other","https://chatgpt.com/not-protected"] {assert!(!protected_url(&tauri::Url::parse(source).unwrap()),"{source}");}
        for source in ["http://images.example.test/a","https://127.0.0.1/a","https://user:secret@images.example.test/a","https://images.local/a","https://images.example.test:444/a","//images.example.test/a","data:image/png;base64,a"] {assert!(public_url(source,"https://chatgpt.com").is_err(),"{source}");}
    }
}
