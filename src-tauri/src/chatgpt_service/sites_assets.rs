//! Response-derived Sites screenshots; independent of the Images capability.
use super::*;
const MAX_ASSETS: usize=4096;
const MAX_SNAPSHOT_ASSETS: usize=1024;

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct SiteAssetRef { asset_key:String, source_request_id:String, id:String }
#[derive(Clone)]
struct Entry { reference:SiteAssetRef, identity:ServiceIdentity, url:tauri::Url, authenticated:bool }
#[derive(Default)]
pub(super) struct SitesRegistry { entries:VecDeque<Entry>, latest:HashMap<String,(u64,Option<String>)>, floor:u64 }
fn unavailable()->ServiceError { failure("asset_unavailable","Sites screenshot reference expired; refresh the Sites list") }

fn public_url(source:&str, origin:&str)->ServiceResult<tauri::Url> {
    if source.len()>16384 || source.chars().any(char::is_control) || source.contains('\\') { return Err(failure("invalid_response","Invalid Sites screenshot URL")); }
    // hMi rewrites /api/codex to /wham before the fixed API client's base resolution.
    let rewritten=if source=="/api/codex" || source.starts_with("/api/codex/") {format!("/wham{}",&source[10..])} else {source.to_owned()};
    let mut url=if rewritten.starts_with('/') && !rewritten.starts_with("//") {
        tauri::Url::parse(&format!("{origin}/backend-api{}",rewritten))
    } else {tauri::Url::parse(&rewritten)}.map_err(|_|failure("invalid_response","Invalid Sites screenshot URL"))?;
    url.set_fragment(None);
    validate_share_target(&ShareUploadTarget{upload_url:url.to_string(),headers:BTreeMap::new(),etag:"site-screenshot".into(),file_id:"site-screenshot".into()})?;
    Ok(url)
}
fn protected_url(url:&tauri::Url)->bool {
    let host=url.host_str().unwrap_or_default();
    url.scheme()=="https" && url.port().is_none() && host!="status.openai.com"
        && (host=="openai.com" || host.ends_with(".openai.com") || host=="chatgpt.com" || host.ends_with(".chatgpt.com") && !host.starts_with("ab."))
        && ["/wham","/api/wham","/backend-api/wham","/backend-api/estuary/content"].iter().any(|prefix|url.path().trim_end_matches('/')==*prefix || url.path().strip_prefix(*prefix).is_some_and(|rest|rest.starts_with('/')))
}

impl ChatgptService {
    pub(super) fn register_sites_assets(&self,request:&ServiceRequest,body:&Value,origin:&str,snapshot:u64)->ServiceResult<Vec<SiteAssetRef>> {
        self.check_share_identity(&request.expected_identity)?;
        let mut registry=self.sites_assets.lock().map_err(|_|unavailable())?;
        self.check_share_identity(&request.expected_identity)?;
        if snapshot<=registry.floor {return Ok(Vec::new());}
        let mut sites=Vec::new();
        match request.operation {
            ServiceOperation::SitesList | ServiceOperation::SitesShared | ServiceOperation::SitesPinned => if let Some(items)=body.get("items").and_then(Value::as_array) { sites.extend(items.iter()); },
            ServiceOperation::SitesDetail => sites.push(body),
            _=>return Err(failure("invalid_request","Sites metadata required")),
        }
        let mut entries=Vec::new();
        let mut seen=std::collections::HashSet::new();
        for site in sites {
            let Some(id)=site.get("id").and_then(Value::as_str).filter(|id|!id.is_empty()&&id.len()<=2048&&!id.chars().any(char::is_control)) else {continue};
            if !seen.insert(id) {continue;}
            let source=site.get("screenshot_url").and_then(Value::as_str).filter(|s|!s.trim().is_empty());
            let parsed=source.and_then(|source|public_url(source,origin).ok());
            let normalized=parsed.as_ref().map(|url|url.to_string());
            if registry.latest.get(id).is_some_and(|(seq,_)|*seq>snapshot) {continue;}
            // A URL withdrawal/change revokes previous keys, including already downloading bytes.
            if registry.latest.get(id).is_some_and(|(_,url)|*url!=normalized) {registry.entries.retain(|entry|entry.reference.id!=id);}
            registry.latest.insert(id.to_owned(),(snapshot,normalized));
            let Some(url)=parsed else {continue};
            let authenticated=protected_url(&url);
            entries.push(Entry{reference:SiteAssetRef{asset_key:uuid::Uuid::new_v4().to_string(),source_request_id:request.request_id.clone(),id:id.to_owned()},identity:request.expected_identity.clone(),url,authenticated});
        }
        if registry.latest.len()>MAX_ASSETS {registry.entries.clear();registry.latest.clear();registry.floor=snapshot;return Err(failure("asset_limit","Too many Sites screenshot references; refresh the Sites list"));}
        if entries.len()>MAX_SNAPSHOT_ASSETS {return Err(failure("asset_limit","Sites metadata exceeds the screenshot reference limit"));}
        while registry.entries.len()+entries.len()>MAX_ASSETS {registry.entries.pop_front();}
        let refs=entries.iter().map(|entry|entry.reference.clone()).collect();registry.entries.extend(entries);Ok(refs)
    }
    fn site_asset(&self,params:&Value,identity:&ServiceIdentity)->ServiceResult<Entry> {
        let params=params.as_object().ok_or_else(||failure("invalid_request","Sites screenshot reference required"))?;
        if params.len()!=2 || !params.contains_key("asset_key") || !params.contains_key("source_request_id") {return Err(failure("invalid_request","Sites screenshot accepts only asset_key and source_request_id"));}
        let string=|key|params.get(key).and_then(Value::as_str).filter(|s|!s.is_empty()&&s.len()<=512&&!s.chars().any(char::is_control));
        let key=string("asset_key").ok_or_else(||failure("invalid_request","Sites screenshot key required"))?;
        let source=string("source_request_id").ok_or_else(||failure("invalid_request","Sites screenshot source required"))?;
        self.check_share_identity(identity)?;
        self.sites_assets.lock().map_err(|_|unavailable())?.entries.iter().find(|entry|entry.reference.asset_key==key&&entry.reference.source_request_id==source&&entry.identity==*identity).cloned().ok_or_else(unavailable)
    }
    fn check_site_asset(&self,entry:&Entry,request:&ServiceRequest,registration:&Registration<'_>)->ServiceResult<()> {
        self.check_share_current(&request.expected_identity,registration)?;
        if !self.sites_assets.lock().map_err(|_|unavailable())?.entries.iter().any(|current|current.reference.asset_key==entry.reference.asset_key&&current.identity==request.expected_identity) {return Err(unavailable());} Ok(())
    }
    pub(super) async fn sites_asset_with<F,Fut,T>(&self,request:ServiceRequest,call:F,transport:&T)->ServiceResult<ServiceResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let entry=self.site_asset(&request.params,&request.expected_identity)?;
        let registration=self.register(&request.request_id)?;
        self.check_site_asset(&entry,&request,&registration)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Service request cancelled")),
            result=async {
                let (credentials,integrity)={let mut session=self.session.lock().await;self.prepare(&mut session,request.expected_identity.generation,&call,false).await?;self.check_site_asset(&entry,&request,&registration)?;(session.credentials.as_ref().unwrap().clone(),session.integrity.clone())};
                if credentials.identity!=request.expected_identity {return Err(failure("account_changed","Authenticated identity changed"));}
                let mut url=entry.url.clone();let mut authenticated=entry.authenticated;
                for step in 0..=5 {
                    self.check_site_asset(&entry,&request,&registration)?;share_network_allowed(&call,url.as_str()).await?;self.check_site_asset(&entry,&request,&registration)?;
                    authenticated &= protected_url(&url);
                    let outgoing=if authenticated {let route=format!("{}{}",url.path(),url.query().map(|q|format!("?{q}")).unwrap_or_default());let mut outgoing=build_http_request(&route,&credentials,integrity.as_deref(),&request.profile)?;outgoing.url=url.to_string();outgoing} else {HttpRequest{url:url.to_string(),headers:BTreeMap::new(),method:HttpMethod::Get,body:Vec::new()}};
                    let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
                    self.check_site_asset(&entry,&request,&registration)?;share_network_allowed(&call,url.as_str()).await?;self.check_site_asset(&entry,&request,&registration)?;
                    if response.body.len() as u64>MAX_RESPONSE {return Err(failure("invalid_response","Sites screenshot response is too large"));}
                    if matches!(response.status,301|302|303|307|308) {if step==5 {return Err(failure("invalid_response","Too many Sites screenshot redirects"));}let location=response.headers.get("location").ok_or_else(||failure("invalid_response","Sites screenshot redirect missing"))?;let next=url.join(location).map_err(|_|failure("invalid_response","Invalid Sites screenshot redirect"))?;url=public_url(next.as_str(),&credentials.origin)?;authenticated &= protected_url(&url);continue;}
                    if !(200..300).contains(&response.status) {return Err(ServiceError{code:match response.status {401=>"unauthorized",403=>"forbidden",404=>"not_found",429=>"rate_limited",_=>"service_error"},message:"Sites screenshot download failed",status:Some(response.status)});}
                    let mime=library_image_mime(&response.body).ok_or_else(||failure("invalid_response","Sites screenshot is not a supported image"))?;
                    if response.headers.get("content-type").is_some_and(|header|header.split(';').next().unwrap_or("").trim()!=mime) {return Err(failure("invalid_response","Sites screenshot MIME does not match its bytes"));}
                    self.check_site_asset(&entry,&request,&registration)?;
                    return Ok(json!({"dataUrl":format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(response.body))}));
                } unreachable!()
            }=>result,
        };
        self.check_site_asset(&entry,&request,&registration)?;
        result.map(|body|ServiceResponse{request_id:request.request_id,identity:request.expected_identity,status:200,body,headers:BTreeMap::new(),assets:None,gpt_assets:None,site_assets:None})
    }
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SitesPinRequest { pub request_id:String, pub expected_identity:ServiceIdentity, pub profile:ServiceProfile, pub id:String, pub pinned:bool }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SitesPinResponse { pub request_id:String, pub identity:ServiceIdentity, pub body:Value }
struct PinGuard<'a> { service:&'a ChatgptService, key:String }
impl Drop for PinGuard<'_> {fn drop(&mut self) {if let Ok(mut active)=self.service.site_pin_active.lock(){active.remove(&self.key);}}}
impl ChatgptService {
    pub async fn site_pin<F,Fut>(&self,request:SitesPinRequest,call:F)->ServiceResult<SitesPinResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.site_pin_with(request,call,&CurlTransport).await
    }
    pub(super) async fn site_pin_with<F,Fut,T>(&self,request:SitesPinRequest,call:F,transport:&T)->ServiceResult<SitesPinResponse>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let route=resolve_route(&ServiceOperation::SitesPin,&json!({"id":request.id}))?;
        self.check_share_identity(&request.expected_identity)?;
        let key=format!("{}:{}:{}:{}",request.expected_identity.account_id,request.expected_identity.user_id,request.expected_identity.generation,request.id);
        {let mut active=self.site_pin_active.lock().map_err(|_|failure("busy","Site pin is busy"))?;if !active.insert(key.clone()){return Err(failure("busy","Site pin mutation already pending; read before retrying"));}}
        let _guard=PinGuard{service:self,key};
        let registration=self.register(&request.request_id)?;
        let sent=AtomicBool::new(false);
        let unknown=||failure("site_pin_unknown","Site pin outcome is unknown; read the pin status before retrying");
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
                outgoing.method=if request.pinned {HttpMethod::Post}else{HttpMethod::Delete};
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
                let success=(200..300).contains(&response.status);
                let decoded=decode_response(response,request.request_id.clone(),request.expected_identity.clone()).map_err(|error|if success{unknown()}else{error})?;
                if decoded.body.get("project_id").and_then(Value::as_str)!=Some(request.id.as_str()) || decoded.body.get("is_pinned").and_then(Value::as_bool).is_none() {return Err(unknown());}
                Ok(SitesPinResponse{request_id:request.request_id.clone(),identity:request.expected_identity.clone(),body:decoded.body})
            }=>result,
        };
        self.check_share_identity(&request.expected_identity)?;
        result
    }
}
