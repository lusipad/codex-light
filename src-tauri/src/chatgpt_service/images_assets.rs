//! Response-derived Images resources. This registry is a Tauri adaptation, not an official API.
use super::*;

const MAX_ASSETS: usize = 4096;
const MAX_SNAPSHOT_ASSETS: usize = 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesAssetRef {
    asset_key: String,
    source_request_id: String,
    role: &'static str,
    id: String,
    group_id: Option<String>,
    variant: u8,
}

#[derive(Clone)]
struct AssetEntry {
    reference: ImagesAssetRef,
    identity: ServiceIdentity,
    source: AssetSource,
}

#[derive(Clone)]
struct AssetSource {
    url: tauri::Url,
    authenticated: bool,
    json_refresh: bool,
}

#[derive(Default)]
pub(super) struct ImagesRegistry {
    entries: VecDeque<AssetEntry>,
    // The sequence is assigned at request start. Denials are not swallowed by UI first-id dedup.
    recent: HashMap<String, (u64, bool)>,
    floor: u64,
}

fn unavailable() -> ServiceError {
    failure("asset_unavailable", "Image reference expired or was withdrawn; refresh the image list")
}

impl ChatgptService {
    pub(super) fn register_images_assets(&self, request: &ServiceRequest, body: &Value, origin: &str, snapshot: u64) -> ServiceResult<Vec<ImagesAssetRef>> {
        self.check_share_identity(&request.expected_identity)?;
        let mut registry = self.images_assets.lock().map_err(|_| unavailable())?;
        self.check_share_identity(&request.expected_identity)?;
        if snapshot <= registry.floor { return Ok(Vec::new()); }
        let recent = matches!(request.operation, ServiceOperation::ImagesRecent);
        let mut blocked = std::collections::HashSet::new();
        let items = body.get("items").and_then(Value::as_array);
        if recent {
            if let Some(items) = items {
                for item in items {
                    let Some(id) = item.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 2048) else { continue };
                    let denied = item.get("output_blocked").and_then(Value::as_bool)==Some(true)
                        || item.get("is_archived").and_then(Value::as_bool)==Some(true);
                    if denied { blocked.insert(id.to_owned()); }
                    let state = registry.recent.entry(id.to_owned()).or_insert((0, false));
                    // Within one snapshot a denial wins regardless of item order.
                    if snapshot > state.0 { *state = (snapshot, denied); }
                    else if snapshot == state.0 && denied { state.1 = true; }
                }
                let denied: std::collections::HashSet<_> = registry.recent.iter().filter(|(_, (_, deny))| *deny).map(|(id, _)| id.clone()).collect();
                registry.entries.retain(|entry| entry.reference.role != "recent" || !denied.contains(&entry.reference.id));
            }
            if registry.recent.len() > MAX_ASSETS {
                // Fail closed at a visible adaptation limit, without reviving older in-flight responses.
                registry.entries.clear(); registry.recent.clear(); registry.floor = snapshot;
                return Err(failure("asset_limit", "Too many image references; refresh the image list"));
            }
        }
        let mut entries = Vec::new();
        let mut add = |item: &Value, role: &'static str, group_id: Option<String>| {
            let Some(id) = item.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 2048) else { return };
            if role == "recent" && (blocked.contains(id) || registry.recent.get(id).is_some_and(|(seq, denied)| *seq > snapshot || *denied)) { return; }
            let source = if role == "recent" {
                match item.pointer("/encodings/thumbnail/path") {
                    Some(Value::Null) | None => item.get("url").and_then(Value::as_str),
                    Some(value) => value.as_str(),
                }
            } else { catalog_source(item) };
            let Some(source) = source.filter(|source| !source.trim().is_empty()) else { return };
            let Ok(source) = asset_source(source, origin, role == "recent") else { return };
            entries.push(AssetEntry { reference: ImagesAssetRef { asset_key:uuid::Uuid::new_v4().to_string(),
                source_request_id:request.request_id.clone(), role, id:id.to_owned(), group_id, variant:0 },
                identity:request.expected_identity.clone(), source });
        };
        match request.operation {
            ServiceOperation::ImagesInit => if let Some(groups)=body.get("groups").and_then(Value::as_array) {
                for group in groups { if let Some(items)=group.get("items").and_then(Value::as_array) {
                    for item in items { add(item, "init_group", group.get("id").and_then(Value::as_str).map(str::to_owned)); }
                }}
            },
            ServiceOperation::ImagesStyles => for (key, role) in [("styles", "styles"), ("image_suggestions", "image_suggestions")] {
                if let Some(items)=body.get(key).and_then(Value::as_array) { for item in items { add(item, role, None); } }
            },
            ServiceOperation::ImagesRecent => if let Some(items)=items { for item in items { add(item, "recent", None); } },
            _ => return Err(failure("invalid_request", "Images metadata required")),
        }
        if entries.len() > MAX_SNAPSHOT_ASSETS {
            return Err(failure("asset_limit", "Image metadata exceeds the supported reference limit"));
        }
        // Keep refresh recoverable. A retired key fails explicitly, including downloads in flight.
        while registry.entries.len() + entries.len() > MAX_ASSETS { registry.entries.pop_front(); }
        let references=entries.iter().map(|entry| entry.reference.clone()).collect();
        registry.entries.extend(entries);
        Ok(references)
    }

    fn image_asset(&self, params: &Value, identity: &ServiceIdentity) -> ServiceResult<AssetEntry> {
        let params=params.as_object().ok_or_else(||failure("invalid_request", "Image reference parameters required"))?;
        if params.len()!=2 || !params.contains_key("asset_key") || !params.contains_key("source_request_id") {
            return Err(failure("invalid_request", "Image reference accepts only asset_key and source_request_id"));
        }
        let string=|key| params.get(key).and_then(Value::as_str).filter(|s|!s.is_empty() && s.len()<=512 && !s.chars().any(char::is_control));
        let key=string("asset_key").ok_or_else(||failure("invalid_request", "Image key required"))?;
        let source=string("source_request_id").ok_or_else(||failure("invalid_request", "Source response required"))?;
        self.check_share_identity(identity)?;
        let registry=self.images_assets.lock().map_err(|_|unavailable())?;
        registry.entries.iter().find(|entry|entry.reference.asset_key==key && entry.reference.source_request_id==source && entry.identity==*identity)
            .cloned().ok_or_else(unavailable)
    }

    fn check_image_asset(&self, entry: &AssetEntry, request: &ServiceRequest, registration: &Registration<'_>) -> ServiceResult<()> {
        self.check_share_current(&request.expected_identity, registration)?;
        let registry=self.images_assets.lock().map_err(|_|unavailable())?;
        if !registry.entries.iter().any(|current| current.reference.asset_key==entry.reference.asset_key && current.identity==request.expected_identity) {
            return Err(unavailable());
        }
        Ok(())
    }

    pub(super) async fn images_asset_with<F, Fut, T>(&self, request: ServiceRequest, call: F, transport: &T) -> ServiceResult<ServiceResponse>
    where F: Fn(&'static str, Value)->Fut, Fut: Future<Output=Result<Value,String>>, T: Transport {
        // Validate the opaque selector before any credential or network operation.
        let entry=self.image_asset(&request.params, &request.expected_identity)?;
        let registration=self.register(&request.request_id)?;
        self.check_image_asset(&entry, &request, &registration)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled", "Service request cancelled")),
            result=async {
                let (credentials, integrity)={
                    let mut session=self.session.lock().await;
                    self.prepare(&mut session, request.expected_identity.generation, &call, false).await?;
                    self.check_image_asset(&entry, &request, &registration)?;
                    (session.credentials.as_ref().unwrap().clone(), session.integrity.clone())
                };
                if credentials.identity!=request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                let origin=tauri::Url::parse(&credentials.origin).map_err(|_|unavailable())?;
                let mut source=entry.source.clone();
                let mut authenticated=source.authenticated;
                for step in 0..=5 {
                    self.check_image_asset(&entry, &request, &registration)?;
                    share_network_allowed(&call, source.url.as_str()).await?;
                    self.check_image_asset(&entry, &request, &registration)?;
                    if source.url.origin()!=origin.origin() { authenticated=false; }
                    let outgoing=if authenticated && source.url.path().starts_with("/backend-api/") {
                        let route=format!("{}{}",source.url.path(),source.url.query().map(|q|format!("?{q}")).unwrap_or_default());
                        build_http_request(&route, &credentials, integrity.as_deref(), &request.profile)?
                    } else { HttpRequest { url:source.url.to_string(), headers:BTreeMap::new(), method:HttpMethod::Get, body:Vec::new() } };
                    let response=send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await?;
                    self.check_image_asset(&entry, &request, &registration)?;
                    share_network_allowed(&call, source.url.as_str()).await?;
                    self.check_image_asset(&entry, &request, &registration)?;
                    if response.body.len() as u64 > MAX_RESPONSE { return Err(failure("invalid_response", "Image response is too large")); }
                    if matches!(response.status,301|302|303|307|308) {
                        if step==5 {return Err(failure("invalid_response", "Too many image redirects"));}
                        let location=response.headers.get("location").ok_or_else(||failure("invalid_response", "Image redirect target missing"))?;
                        let next=source.url.join(location).map_err(|_|failure("invalid_response", "Invalid image redirect"))?;
                        source=AssetSource { url:public_url(next.as_str(), &credentials.origin)?, authenticated:false, json_refresh:false };
                        continue;
                    }
                    if !(200..300).contains(&response.status) {
                        return Err(ServiceError { code:match response.status {401=>"unauthorized",403=>"forbidden",404=>"not_found",429=>"rate_limited",_=>"service_error"}, message:"Image download failed", status:Some(response.status) });
                    }
                    if source.json_refresh {
                        if step==5 {return Err(failure("invalid_response", "Too many image resource refreshes"));}
                        let body:Value=serde_json::from_slice(&response.body).map_err(|_|failure("invalid_response", "Invalid image URL response"))?;
                        let target=body.get("content_url").or_else(||body.get("download_url")).or_else(||body.get("thumbnail_url"))
                            .and_then(Value::as_str).filter(|url|!url.trim().is_empty()).ok_or_else(||failure("invalid_response", "Image URL missing"))?;
                        source=asset_source(target, &credentials.origin, true)?;
                        // A JSON resolution to a public URL also permanently drops credentials.
                        authenticated &= source.authenticated;
                        continue;
                    }
                    let mime=library_image_mime(&response.body).ok_or_else(||failure("invalid_response", "Response is not a supported image"))?;
                    if response.headers.get("content-type").is_some_and(|header|header.split(';').next().unwrap_or("").trim()!=mime) {
                        return Err(failure("invalid_response", "Image MIME does not match its bytes"));
                    }
                    self.check_image_asset(&entry, &request, &registration)?;
                    return Ok(json!({"dataUrl":format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(response.body))}));
                }
                unreachable!()
            }=>result,
        };
        self.check_image_asset(&entry, &request, &registration)?;
        result.map(|body|ServiceResponse {request_id:request.request_id, identity:request.expected_identity, status:200, body, headers:BTreeMap::new(), assets:None, gpt_assets:None})
    }
}

fn catalog_source(item: &Value) -> Option<&str> {
    item.get("image_url").and_then(Value::as_str).filter(|s|!s.trim().is_empty())
        .or_else(||item.get("image_variant_urls").and_then(Value::as_array).and_then(|items|items.iter().filter_map(Value::as_str).find(|s|!s.trim().is_empty())))
        .or_else(||item.get("image_variants").and_then(Value::as_array).and_then(|items|items.iter().find_map(|item|item.as_str().or_else(||item.get("image_url").and_then(Value::as_str)).filter(|s|!s.trim().is_empty()))))
}

fn public_url(source: &str, origin: &str) -> ServiceResult<tauri::Url> {
    if source.len()>16384 || source.chars().any(char::is_control) {return Err(failure("invalid_response", "Invalid image URL"));}
    let mut url=if source.starts_with('/') && !source.starts_with("//") {tauri::Url::parse(&format!("{origin}{source}"))} else {tauri::Url::parse(source)}
        .map_err(|_|failure("invalid_response", "Invalid image URL"))?;
    url.set_fragment(None);
    validate_share_target(&ShareUploadTarget {upload_url:url.to_string(),headers:BTreeMap::new(),etag:"images-read".into(),file_id:"images-read".into()})?;
    Ok(url)
}

fn asset_source(source: &str, origin: &str, recent: bool) -> ServiceResult<AssetSource> {
    let mut url=public_url(source, origin)?;
    if !recent || source.contains('\\') {return Ok(AssetSource {url,authenticated:false,json_refresh:false});}
    let host=url.host_str().unwrap_or("");
    let official=host=="chatgpt.com" || host=="chatgpt-staging.com" || host.ends_with(".chatgpt-staging.com");
    if official && url.port().is_none() {
        let path=url.path().to_owned();
        let library=path.strip_prefix("/api/library/files/")
            .or_else(||path.strip_prefix("/library/files/").filter(|rest|rest.ends_with("/thumbnail")));
        if let Some((id,action))=library.and_then(|rest|rest.rsplit_once('/')) {
            if !id.is_empty() && !id.contains('/') && matches!(action,"thumbnail"|"content"|"download") {
                // External-provider thumbnail pins need their own verified resolver, not a guessed JSON request.
                if id.starts_with("external-") {return Err(unavailable());}
                let json_refresh=!url.query_pairs().any(|(key,_)|matches!(key.as_ref(),"page_id"|"file_id"));
                let suffix=if json_refresh {format!("{action}_url")} else {format!("{action}_redirect")};
                url=tauri::Url::parse(&format!("{origin}/backend-api/files/library/files/{id}/{suffix}{}",url.query().map(|q|format!("?{q}")).unwrap_or_default())).map_err(|_|unavailable())?;
                return Ok(AssetSource {url,authenticated:true,json_refresh});
            }
        }
        let Some(path)=path.strip_prefix("/backend-api").or_else(||path.strip_prefix("/__codex-api")) else {
            return Ok(AssetSource {url,authenticated:false,json_refresh:false});
        };
        if matches!(path,"/estuary/content"|"/estuary/content/"|"/files/library/content_download"|"/files/library/content_download/")
            || path.strip_prefix("/estuary/public_content/enc/").is_some_and(|id|!id.is_empty() && !id.contains('/')) {
            url=tauri::Url::parse(&format!("{origin}/backend-api{path}{}",url.query().map(|q|format!("?{q}")).unwrap_or_default())).map_err(|_|unavailable())?;
            return Ok(AssetSource {url,authenticated:true,json_refresh:false});
        }
    }
    Ok(AssetSource {url,authenticated:false,json_refresh:false})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_assets_named_source_table_matches_fresh_jj_without_restricting_public_images() {
        for host in ["chatgpt.com", "chatgpt-staging.com", "sub.chatgpt-staging.com"] {
            for action in ["thumbnail","content","download"] {
                let source=format!("https://{host}/api/library/files/plain-id/{action}");
                let recent=asset_source(&source,"https://chatgpt.com",true).unwrap();
                assert!(recent.authenticated);assert!(recent.json_refresh);
                assert_eq!(recent.url.as_str(),format!("https://chatgpt.com/backend-api/files/library/files/plain-id/{action}_url"));
                assert!(!asset_source(&source,"https://chatgpt.com",false).unwrap().authenticated);
                let short=format!("https://{host}/library/files/plain-id/{action}");
                let short_source=asset_source(&short,"https://chatgpt.com",true).unwrap();
                assert_eq!(short_source.authenticated,action=="thumbnail");
                assert_eq!(short_source.json_refresh,action=="thumbnail");
            }
        }
        for source in ["/__codex-api/estuary/content?id=a","/backend-api/estuary/public_content/enc/id","/backend-api/files/library/content_download?id=a"] {
            let recent=asset_source(source,"https://chatgpt.com",true).unwrap();assert!(recent.authenticated);assert!(!recent.json_refresh);
            assert!(!asset_source(source,"https://chatgpt.com",false).unwrap().authenticated);
        }
        for source in ["/estuary/content?id=a","/files/library/content_download?id=a","/api/library/files/plain-id/project-content",
            "/backend-api/api/library/files/plain-id/thumbnail","https://chatgpt.com\\api\\library\\files\\plain-id\\thumbnail"] {
            let recent=asset_source(source,"https://chatgpt.com",true).unwrap();assert!(!recent.authenticated);assert!(!recent.json_refresh);
        }
        for query in ["page_id=page","file_id=file"] {
            let recent=asset_source(&format!("/api/library/files/plain-id/thumbnail?{query}"),"https://chatgpt.com",true).unwrap();
            assert!(recent.authenticated);assert!(!recent.json_refresh);assert!(recent.url.path().ends_with("/thumbnail_redirect"));
        }
        assert!(asset_source("/api/library/files/external-gdrive:id/thumbnail","https://chatgpt.com",true).is_err());
        assert!(!asset_source("/api/library/files/external-gdrive:id/thumbnail","https://chatgpt.com",false).unwrap().authenticated);
        for host in ["sub.chatgpt.com", "images.example.test", "chatgpt.com.evil.test"] {
            let source=format!("https://{host}/api/library/files/plain-id/thumbnail");
            let recent=asset_source(&source,"https://chatgpt.com",true).unwrap();
            assert!(!recent.authenticated);assert!(!recent.json_refresh);
            assert_eq!(recent.url.as_str(),source,"a general public image stays anonymous, not blocked");
            assert!(!asset_source(&source,"https://chatgpt.com",false).unwrap().authenticated);
        }
    }
}
