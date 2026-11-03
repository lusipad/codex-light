//! Fixed ChatGPT service operations. Credentials never cross the IPC boundary.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MAX_RESPONSE: u64 = 8 * 1024 * 1024;
const MAX_SHARE_SNAPSHOT: usize = 10 * 1024 * 1024;
const MAX_SHARE_ASSET: usize = 25 * 1024 * 1024;
const MAX_SHARE_ASSETS: usize = 100 * 1024 * 1024;
type ServiceResult<T> = Result<T, ServiceError>;
type TransportFuture<'a> = Pin<Box<dyn Future<Output = ServiceResult<HttpResponse>> + Send + 'a>>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceIdentity {
    pub account_id: String,
    pub user_id: String,
    pub generation: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceOperation {
    LibraryFavorites,
    LibraryNodes,
    ImagesInit,
    ImagesStyles,
    ImagesRecent,
    GptsDiscovery,
    GptsCategory,
    GptsSearch,
    GptsDetail,
    GptsAbout,
    SitesAccess,
    SitesList,
    SitesShared,
    SitesDetail,
    SitesEnvironment,
    SitesDomains,
    SitesShareAccess,
    GithubRepository,
    ShareAccounts,
    ShareUsers,
    ShareGroups,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudOperation {
    List,
    Detail,
    Draft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudServiceRequest {
    pub request_id: String,
    pub operation: CloudOperation,
    #[serde(default = "empty_params")]
    pub params: Value,
    pub expected_identity: ServiceIdentity,
}

/// Constructed by the host from its actual initialize identity; never renderer input.
pub struct CloudProfile {
    pub user_agent: String,
    pub originator: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAccess {
    pub identity: ServiceIdentity,
    pub gate_evidence: &'static str,
}

// ASB credentials are intentionally separate from ChatGPT workspace routing/cache.
struct CloudCredentials {
    token: String,
    identity: ServiceIdentity,
    fedramp: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceRequest {
    pub request_id: String,
    pub operation: ServiceOperation,
    #[serde(default = "empty_params")]
    pub params: Value,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
}

/// Observed renderer browser context, not credentials or attestation.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceProfile {
    pub language: String,
    pub device_id: String,
    pub user_agent: String,
    pub user_agent_client_hints: String,
    pub platform_client_hint: String,
}

/// Fixed account instruction operations; neither a URL nor arbitrary settings cross IPC.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInstructionsRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInstructionsWriteRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInstructionsResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareAsset {
    pub asset_id: String,
    pub mime_type: String,
    pub bytes_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharePrepareRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub host_id: String,
    pub thread_id: String,
    /// Already transformed and redacted snapshot, never the original protocol thread.
    pub snapshot: String,
    #[serde(default)]
    pub assets: Vec<ShareAsset>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareUrlSafeRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareAccessRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
}

/// Created by the host from this application's actual runtime metadata.
/// Deliberately not Deserialize: this is not accepted across renderer IPC.
pub struct ShareBootstrapContext {
    pub app_session_id: String,
    pub app_version: String,
    pub brand_name: String,
    pub build_flavor: String,
    pub system_name: String,
    pub system_version: String,
    pub window_type: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShareAccess {
    Public,
    Workspace,
    Invited,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SharePrincipal {
    pub principal_id: String,
    pub principal_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharePublishRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub preparation_id: String,
    pub host_id: String,
    pub thread_id: String,
    pub access: ShareAccess,
    #[serde(default)]
    pub principals: Vec<SharePrincipal>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePreparation {
    pub preparation_id: String,
    pub identity: ServiceIdentity,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedShare {
    pub share_id: String,
    pub share_url: String,
}

struct PreparedShare {
    identity: ServiceIdentity,
    host_id: String,
    thread_id: String,
    manifest: Value,
    state: SharePublishState,
    audience: Option<ShareAudience>,
}

#[derive(PartialEq, Eq)]
struct ShareAudience {
    access: ShareAccess,
    principals: Vec<(String, String)>,
}

enum SharePublishState {
    Prepared,
    Publishing,
    Unknown,
    Published(PublishedShare),
}

#[derive(Deserialize)]
struct ShareUploadTarget {
    upload_url: String,
    headers: BTreeMap<String, String>,
    etag: String,
    file_id: String,
}

#[derive(Deserialize)]
struct ShareAssetTarget {
    asset_id: String,
    #[serde(flatten)]
    target: ShareUploadTarget,
}

#[derive(Deserialize)]
struct ShareUploadTargets {
    snapshot: ShareUploadTarget,
    #[serde(default)]
    assets: Vec<ShareAssetTarget>,
}

fn empty_params() -> Value {
    json!({})
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceError {
    pub code: &'static str,
    pub message: &'static str,
    pub status: Option<u16>,
}

fn failure(code: &'static str, message: &'static str) -> ServiceError {
    ServiceError {
        code,
        message,
        status: None,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub status: u16,
    pub body: Value,
    // Only explicitly selected, non-credential headers are exposed.
    pub headers: BTreeMap<String, String>,
}

// Intentionally neither Debug nor Serialize.
struct Credentials {
    token: String,
    identity: ServiceIdentity,
    expires: u64,
    origin: String,
    routing_override: String,
    fedramp: bool,
}

#[derive(Default)]
struct Session {
    generation: u64,
    credentials: Option<Credentials>,
    integrity: Option<String>,
}

#[derive(Default)]
pub struct ChatgptService {
    generation: AtomicU64,
    // Serializing requests also makes token refresh single-flight. This is deliberately
    // narrower than the official concurrent/eager refresh implementation.
    session: tokio::sync::Mutex<Session>,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    // Retain a bounded set of one-shot IDs when cancel IPC beats read registration.
    cancelled_before_start: Mutex<VecDeque<String>>,
    shares: Mutex<HashMap<String, PreparedShare>>,
}

struct Registration<'a> {
    service: &'a ChatgptService,
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut requests) = self.service.active.lock() {
            if requests
                .get(&self.id)
                .is_some_and(|v| Arc::ptr_eq(v, &self.cancelled))
            {
                requests.remove(&self.id);
            }
        }
    }
}

impl ChatgptService {
    pub async fn account_instructions_read<F, Fut>(
        &self, request: AccountInstructionsRequest, call: F,
    ) -> ServiceResult<AccountInstructionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.account_instructions_with(request, None, call, &CurlTransport).await
    }

    pub async fn account_instructions_write<F, Fut>(
        &self, request: AccountInstructionsWriteRequest, call: F,
    ) -> ServiceResult<AccountInstructionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.account_instructions_with(AccountInstructionsRequest {
            request_id: request.request_id, expected_identity: request.expected_identity,
            profile: request.profile,
        }, Some(request.contents), call, &CurlTransport).await
    }

    async fn account_instructions_with<F, Fut, T>(
        &self, request: AccountInstructionsRequest, contents: Option<String>, call: F, transport: &T,
    ) -> ServiceResult<AccountInstructionsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        // The official textarea sends a string, including an empty string to clear it.
        // This is a transport bound, not a claim about the account's configured UI limit.
        let patch = contents.as_ref().map(|contents| serde_json::to_vec(&json!({"custom_instructions":contents})))
            .transpose().map_err(|_| failure("invalid_request", "Invalid account instructions"))?;
        if patch.as_ref().is_some_and(|body| body.len() > 256 * 1024) {
            return Err(failure("invalid_request", "Account instructions exceeded request limit"));
        }
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        self.check_share_current(identity, &registration)?;
        let write_confirmed = AtomicBool::new(false);
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled; a sent write may already have applied")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, &call, false).await?;
                self.check_share_current(identity, &registration)?;
                // Serialize PATCH and its GET verification under the existing session lock.
                if let Some(body) = patch {
                    // Official transport retries only an explicit 401 after one token refresh.
                    // Identity is checked again before sending the same serialized body.
                    for attempt in 0..2 {
                        let credentials = session.credentials.as_ref().unwrap();
                        if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                        let integrity = session.integrity.clone();
                        let mut outgoing = build_http_request("/backend-api/wham/settings/user", credentials, integrity.as_deref(), &request.profile)?;
                        outgoing.method = HttpMethod::Patch;
                        outgoing.body = body.clone();
                        outgoing.headers.insert("Content-Type".into(), "application/json".into());
                        share_network_allowed(&call, &outgoing.url).await?;
                        self.check_share_current(identity, &registration)?;
                        let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                            .map_err(|_| failure("instructions_write_unknown", "Account instruction write outcome is unknown; read before retrying"))?;
                        self.check_share_current(identity, &registration)?;
                        apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                        if account_instructions_ip_denied(&response) {
                            return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) });
                        }
                        if response.status == 401 && attempt == 0 {
                            self.prepare(&mut session, identity.generation, &call, true).await?;
                            self.check_share_current(identity, &registration)?;
                            continue;
                        }
                        if response.status >= 500 {
                            return Err(ServiceError { code:"instructions_write_unknown", message:"Account instruction write outcome is unknown; read before retrying", status:Some(response.status) });
                        }
                        if !(200..300).contains(&response.status) {
                            // A second 401 and all other statuses fail without further replay.
                            return Err(decode_response(response, registration.id.clone(), identity.clone()).err()
                                .unwrap_or_else(|| failure("instructions_write_unknown", "Account instruction write was not confirmed")));
                        }
                        write_confirmed.store(true, Ordering::SeqCst);
                        // No PATCH response schema is proven. Only the following GET can prove its value.
                        break;
                    }
                }
                for attempt in 0..2 {
                    let credentials = session.credentials.as_ref().unwrap();
                    if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                    let integrity = session.integrity.clone();
                    let outgoing = build_http_request("/backend-api/wham/settings/user", credentials, integrity.as_deref(), &request.profile)?;
                    share_network_allowed(&call, &outgoing.url).await?;
                    self.check_share_current(identity, &registration)?;
                    let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await?;
                    self.check_share_current(identity, &registration)?;
                    apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) {
                            return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) });
                        }
                        if response.status == 401 && attempt == 0 {
                        // Verification GET has its own bounded refresh, never re-enters PATCH.
                        self.prepare(&mut session, identity.generation, &call, true).await?;
                        continue;
                    }
                    let response = decode_response(response, registration.id.clone(), identity.clone())?;
                    let object = response.body.as_object().ok_or_else(|| failure("invalid_response", "Invalid account instruction response"))?;
                    let actual = match object.get("custom_instructions") {
                        None | Some(Value::Null) => String::new(),
                        Some(Value::String(value)) => value.clone(),
                        _ => return Err(failure("invalid_response", "Invalid account instruction value")),
                    };
                    if contents.as_ref().is_some_and(|expected| expected != &actual) {
                        return Err(failure("instructions_readback_mismatch", "Account instructions changed or were not saved; read before retrying"));
                    }
                    return Ok(AccountInstructionsResponse { request_id:request.request_id.clone(), identity:identity.clone(), contents:actual });
                }
                unreachable!()
            } => result,
        };
        self.check_share_current(identity, &registration)?;
        if write_confirmed.load(Ordering::SeqCst) {
            return result.map_err(|error| match error.code {
                "instructions_readback_mismatch" | "account_changed" | "cancelled" => error,
                _ => failure("instructions_readback_failed", "Account instructions may be saved but readback failed; read before retrying"),
            });
        }
        result
    }

    pub async fn share_access_bootstrap<F, Fut>(
        &self, request: ShareAccessRequest, context: ShareBootstrapContext, call: F,
    ) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.share_access_bootstrap_with(request, context, call, &CurlTransport).await
    }

    async fn share_access_bootstrap_with<F, Fut, T>(
        &self, request: ShareAccessRequest, context: ShareBootstrapContext, call: F, transport: &T,
    ) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        for value in [&context.app_session_id, &context.app_version, &context.brand_name,
            &context.build_flavor, &context.system_name, &context.system_version, &context.window_type] {
            if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
                return Err(failure("invalid_request", "Invalid host bootstrap context"));
            }
        }
        let registration = self.register(&request.request_id)?;
        let body = json!({
            "app_session_id":context.app_session_id, "app_version":context.app_version,
            "brand_name":context.brand_name, "build_flavor":context.build_flavor,
            "system_name":context.system_name, "system_version":context.system_version,
            "window_type":context.window_type,
            "locale":&request.profile.language, "stable_id":&request.profile.device_id,
        });
        let result = tokio::time::timeout(Duration::from_secs(10), self.authenticated_share_json(
            "/backend-api/wham/statsig/bootstrap", body,
            &request.expected_identity, &request.profile, &registration, &call, transport, None,
        )).await.unwrap_or_else(|_| Err(failure("timeout", "Share access bootstrap timed out")));
        self.check_share_current(&request.expected_identity, &registration)?;
        let body = result?;
        let payload = body.get("statsigPayload").and_then(Value::as_str)
            .filter(|payload| !payload.is_empty())
            .ok_or_else(|| failure("invalid_response", "Invalid share access bootstrap response"))?;
        // No raw companion fields or credentials cross IPC. Gate/user identity and
        // full V1/V2 semantics are checked by the dedicated consumer, never default true.
        Ok(json!({"statsigPayload":payload}))
    }

    pub async fn share_url_safe<F, Fut>(
        &self, request: ShareUrlSafeRequest, call: F,
    ) -> ServiceResult<bool>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.share_url_safe_with(request, call, &CurlTransport).await
    }

    async fn share_url_safe_with<F, Fut, T>(
        &self, request: ShareUrlSafeRequest, call: F, transport: &T,
    ) -> ServiceResult<bool>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let url = tauri::Url::parse(&request.url)
            .map_err(|_| failure("invalid_request", "Invalid share image URL"))?;
        if request.url.len() > 16384 || request.url.chars().any(char::is_control)
            || !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
            || !url.username().is_empty() || url.password().is_some() {
            return Err(failure("invalid_request", "Invalid share image URL"));
        }
        let registration = self.register(&request.request_id)?;
        let body = self.authenticated_share_json(
            "/backend-api/ecosystem/url_safe",
            json!({"resolved_pineapple_uri":null,"url":&request.url}),
            &request.expected_identity, &request.profile, &registration, &call, transport, None,
        ).await?;
        if body.get("safe") != Some(&Value::Bool(true)) {
            return Ok(false);
        }
        // The caller fetches image bytes in the browser after this check. Permission
        // for the authenticated checker endpoint does not grant the image destination.
        let policy = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = share_network_allowed(&call, &request.url) => result,
        };
        self.check_share_current(&request.expected_identity, &registration)?;
        policy?;
        Ok(true)
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Call before logout/session-switch and on account/connection changes.
    pub fn invalidate(&self) -> u64 {
        let next = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(requests) = self.active.lock() {
            for cancelled in requests.values() {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
        if let Ok(mut shares) = self.shares.lock() {
            shares.clear();
        }
        // Pending credential-bearing futures are dropped by cancellation. Cached
        // credentials are dropped synchronously whenever the session is unlocked.
        if let Ok(mut session) = self.session.try_lock() {
            *session = Session {
                generation: next,
                ..Session::default()
            };
        }
        next
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        if let Ok(requests) = self.active.lock() {
            if let Some(cancelled) = requests.get(request_id) {
                cancelled.store(true, Ordering::SeqCst);
                return true;
            }
            if request_id.is_empty() || request_id.len() > 128 {
                return false;
            }
            if let Ok(mut cancelled) = self.cancelled_before_start.lock() {
                if !cancelled.iter().any(|id| id == request_id) {
                    if cancelled.len() == 256 {
                        cancelled.pop_front();
                    }
                    cancelled.push_back(request_id.to_owned());
                }
                return true;
            }
        }
        false
    }

    fn register(&self, id: &str) -> ServiceResult<Registration<'_>> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
        {
            return Err(failure(
                "invalid_request",
                "Invalid service request identifier",
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut active = self
            .active
            .lock()
            .map_err(|_| failure("internal", "Request registry unavailable"))?;
        if active.contains_key(id) {
            return Err(failure(
                "duplicate_request",
                "Service request identifier already active",
            ));
        }
        let mut before_start = self
            .cancelled_before_start
            .lock()
            .map_err(|_| failure("internal", "Cancellation registry unavailable"))?;
        if let Some(index) = before_start.iter().position(|cancelled| cancelled == id) {
            before_start.remove(index);
            return Err(failure("cancelled", "Service request cancelled"));
        }
        active.insert(id.to_owned(), cancelled.clone());
        Ok(Registration {
            service: self,
            id: id.to_owned(),
            cancelled,
        })
    }

    /// Backend-only RPC callback: call(method, params). Never expose this callback's
    /// getAuthStatus result through the renderer's general-purpose RPC command.
    pub async fn identity<F, Fut>(
        &self,
        request_id: &str,
        call: F,
    ) -> ServiceResult<ServiceIdentity>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let registration = self.register(request_id)?;
        let generation = self.generation();
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, generation, &call, false).await?;
                Ok(session.credentials.as_ref().unwrap().identity.clone())
            } => result,
        };
        if self.generation() != generation {
            let mut session = self.session.lock().await;
            if session.generation == generation {
                *session = Session {
                    generation: self.generation(),
                    ..Session::default()
                };
            }
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        result
    }

    pub async fn read<F, Fut>(
        &self,
        request: ServiceRequest,
        call: F,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.read_with(request, call, &CurlTransport).await
    }

    pub async fn cloud_identity<F, Fut>(
        &self,
        request_id: &str,
        call: F,
    ) -> ServiceResult<ServiceIdentity>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let registration = self.register(request_id)?;
        let generation = self.generation();
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = self.cloud_credentials(generation, &call) => result,
        };
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        result.map(|credentials| credentials.identity)
    }

    pub async fn cloud_access<F, Fut>(
        &self,
        request_id: &str,
        call: F,
    ) -> ServiceResult<CloudAccess>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let registration = self.register(request_id)?;
        let generation = self.generation();
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = async {
                let before = self.cloud_credentials(generation, &call).await?;
                let account = call("account/read", json!({"refreshToken":false})).await
                    .map_err(|_| failure("auth_unavailable", "Account information unavailable"))?;
                let after = self.cloud_credentials(generation, &call).await?;
                if before.identity != after.identity {
                    return Err(failure("account_changed", "Authenticated identity changed"));
                }
                if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
                    return Err(failure("not_logged_in", "ChatGPT account information required"));
                }
                if account.pointer("/workspaceRouting/chatgptAccountId")
                    .is_some_and(|value| value.as_str() != Some(after.identity.account_id.as_str())) {
                    return Err(failure("account_changed", "Token and workspace account differ"));
                }
                // Both observed RBAC branches grant these exact personal plans.
                // All other plans still require the independently evaluated gates.
                let personal = matches!(account.pointer("/account/planType").and_then(Value::as_str),
                    Some("free" | "go" | "plus" | "prolite" | "pro" | "promax"));
                Ok(CloudAccess {
                    identity: after.identity,
                    gate_evidence: if personal { "personal-plan-branch" } else { "incomplete" },
                })
            } => result,
        };
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        result
    }

    pub async fn cloud_read<F, Fut>(
        &self,
        request: CloudServiceRequest,
        profile: CloudProfile,
        call: F,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.cloud_read_with(request, profile, call, &CurlTransport).await
    }

    async fn cloud_read_with<F, Fut, T>(
        &self,
        request: CloudServiceRequest,
        profile: CloudProfile,
        call: F,
        transport: &T,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        // Reject route/profile inputs before invoking authentication.
        let route = resolve_cloud_route(&request.operation, &request.params)?;
        validate_cloud_profile(&profile)?;
        let registration = self.register(&request.request_id)?;
        let generation = request.expected_identity.generation;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = async {
                let credentials = self.cloud_credentials(generation, &call).await?;
                if credentials.identity != request.expected_identity {
                    return Err(failure("account_changed", "Authenticated identity changed"));
                }
                let response = send_bounded(
                    transport,
                    build_cloud_http_request(&route, &credentials, &profile),
                    registration.cancelled.clone(),
                    Duration::from_secs(30),
                ).await;
                // Check identity even for an HTTP or transport failure. Never refresh or
                // replay this ASB read based on ChatGPT backend's 401 policy.
                let after = self.cloud_credentials(generation, &call).await?;
                if after.identity != request.expected_identity {
                    return Err(failure("account_changed", "Authenticated identity changed"));
                }
                decode_response(response?, request.request_id.clone(), request.expected_identity.clone())
            } => result,
        };
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        result
    }

    async fn cloud_credentials<F, Fut>(
        &self,
        generation: u64,
        call: &F,
    ) -> ServiceResult<CloudCredentials>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        let auth = call("getAuthStatus", json!({"includeToken":true,"refreshToken":false}))
            .await
            .map_err(|_| failure("auth_unavailable", "Authentication status method unavailable"))?;
        let token = match auth.get("authMethod").and_then(Value::as_str) {
            Some("chatgpt" | "chatgptAuthTokens") => auth.get("authToken").and_then(Value::as_str),
            _ => None,
        }
        .filter(|token| !token.is_empty())
        .ok_or_else(|| failure("not_logged_in", "ChatGPT login required"))?;
        let (account_id, user_id, expires, fedramp) = parse_token(token)?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        if expires <= now {
            return Err(failure("auth_expired", "ChatGPT credentials expired"));
        }
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        Ok(CloudCredentials {
            token: token.to_owned(),
            identity: ServiceIdentity { account_id, user_id, generation },
            fedramp,
        })
    }

    async fn read_with<F, Fut, T>(
        &self,
        request: ServiceRequest,
        call: F,
        transport: &T,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        // Resolve before credential acquisition: unsupported parameters cannot invoke auth.
        let route = resolve_read_route(&request.operation, &request.params, &request.expected_identity)?;
        let registration = self.register(&request.request_id)?;
        let generation = request.expected_identity.generation;
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, generation, &call, false).await?;
                for attempt in 0..2 {
                    if self.generation() != generation {
                        return Err(failure("account_changed", "Authenticated identity changed"));
                    }
                    let credentials = session.credentials.as_ref().unwrap();
                    if credentials.identity != request.expected_identity {
                        return Err(failure("account_changed", "Authenticated identity changed"));
                    }
                    let sent_integrity = session.integrity.clone();
                    let http_request = build_http_request(&route, credentials, sent_integrity.as_deref(), &request.profile)?;
                    let response = send_bounded(transport, http_request, registration.cancelled.clone(), Duration::from_secs(50)).await?;
                    if self.generation() != generation {
                        return Err(failure("account_changed", "Authenticated identity changed"));
                    }
                    apply_integrity(&mut session.integrity, sent_integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if response.status == 401 && attempt == 0 {
                        self.prepare(&mut session, generation, &call, true).await?;
                        continue;
                    }
                    return decode_response(response, request.request_id.clone(), request.expected_identity.clone());
                }
                unreachable!()
            } => result,
        };
        if self.generation() != generation {
            // Release credentials left behind when cancellation dropped an in-flight future.
            let mut session = self.session.lock().await;
            if session.generation == generation {
                *session = Session {
                    generation: self.generation(),
                    ..Session::default()
                };
            }
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        result
    }

    pub async fn share_prepare<F, Fut>(
        &self, request: SharePrepareRequest, call: F,
    ) -> ServiceResult<SharePreparation>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.share_prepare_with(request, call, &CurlTransport).await
    }

    async fn share_prepare_with<F, Fut, T>(
        &self, request: SharePrepareRequest, call: F, transport: &T,
    ) -> ServiceResult<SharePreparation>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        validate_share_context(&request.host_id, &request.thread_id)?;
        let assets = validate_share_payload(&request.snapshot, &request.assets)?;
        let registration = self.register(&request.request_id)?;
        self.check_share_identity(&request.expected_identity)?;
        if self.shares.lock().map_err(|_| failure("internal_error", "Share registry unavailable"))?.len() >= 32 {
            return Err(failure("share_limit", "Too many prepared shares"));
        }
        let asset_specs: Vec<_> = assets.iter().map(|(id, mime, bytes)|
            json!({"asset_id":id,"mime_type":mime,"size":bytes.len()})).collect();
        let mut payload = json!({"snapshot":{"size":request.snapshot.len(),"version":1}});
        if !asset_specs.is_empty() { payload["assets"] = json!(asset_specs); }
        let response = self.share_post(
            "/backend-api/wham/shared_threads/upload_urls", payload,
            &request.expected_identity, &request.profile, &registration, &call, transport,
        ).await?;
        let targets: ShareUploadTargets = serde_json::from_value(response)
            .map_err(|_| failure("invalid_response", "Invalid share upload targets"))?;
        validate_share_target(&targets.snapshot)?;
        let mut pending = match_asset_targets(&assets, targets.assets)?;
        self.share_put(&targets.snapshot, request.snapshot.as_bytes(), "application/json",
            &request.expected_identity, &registration, &call, transport).await?;
        let mut manifest = json!({"snapshot":{"etag":targets.snapshot.etag,"file_id":targets.snapshot.file_id}});
        let mut completed = BTreeMap::new();
        for attempt in 0..3 {
            let mut failed = Vec::new();
            let round: Vec<_> = assets.iter().filter_map(|asset|
                pending.remove(&asset.0).map(|target| (asset, target))).collect();
            for batch in round.chunks(4) {
                let identity = &request.expected_identity;
                let registration = &registration;
                let call = &call;
                let upload = |index: usize| async move {
                    let Some(((id, mime, bytes), target)) = batch.get(index) else { return None };
                    Some((id, mime, bytes, target,
                        self.share_put(target, bytes, mime, identity, registration, call, transport).await))
                };
                // Fixed-size joining borrows the transaction without spawning tasks
                // or imposing Send/'static requirements on app-server callbacks.
                let (a, b, c, d) = tokio::join!(upload(0), upload(1), upload(2), upload(3));
                for (id, mime, bytes, target, result) in [a, b, c, d].into_iter().flatten() {
                match result {
                    Ok(()) => { completed.insert(id.clone(),
                        json!({"asset_id":id,"etag":target.etag,"file_id":target.file_id})); }
                    Err(error) if share_upload_retryable(&error) && attempt < 2 => {
                        failed.push(json!({"asset_id":id,"mime_type":mime,"size":bytes.len()}));
                    }
                    Err(error) => return Err(error),
                }
                }
            }
            if failed.is_empty() { break; }
            let response = self.share_post(
                "/backend-api/wham/shared_threads/upload_urls", json!({"assets":failed}),
                &request.expected_identity, &request.profile, &registration, &call, transport,
            ).await?;
            #[derive(Deserialize)]
            struct AssetTargets { assets: Vec<ShareAssetTarget> }
            let targets: AssetTargets = serde_json::from_value(response)
                .map_err(|_| failure("invalid_response", "Invalid share asset targets"))?;
            let retry_assets: Vec<_> = assets.iter().filter(|(id, _, _)| !completed.contains_key(id)).cloned().collect();
            pending = match_asset_targets(&retry_assets, targets.assets)?;
        }
        self.check_share_current(&request.expected_identity, &registration)?;
        if !completed.is_empty() {
            manifest["assets"] = Value::Array(completed.into_values().collect());
        }
        let preparation_id = uuid::Uuid::new_v4().to_string();
        let mut shares = self.shares.lock().map_err(|_| failure("internal_error", "Share registry unavailable"))?;
        self.check_share_current(&request.expected_identity, &registration)?;
        if shares.len() >= 32 {
            return Err(failure("share_limit", "Too many prepared shares"));
        }
        shares.insert(preparation_id.clone(), PreparedShare {
            identity: request.expected_identity.clone(), host_id: request.host_id,
            thread_id: request.thread_id, manifest, state: SharePublishState::Prepared,
            audience: None,
        });
        Ok(SharePreparation { preparation_id, identity: request.expected_identity })
    }

    pub async fn share_publish<F, Fut>(
        &self, request: SharePublishRequest, call: F,
    ) -> ServiceResult<PublishedShare>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.share_publish_with(request, call, &CurlTransport).await
    }

    async fn share_publish_with<F, Fut, T>(
        &self, request: SharePublishRequest, call: F, transport: &T,
    ) -> ServiceResult<PublishedShare>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        validate_share_context(&request.host_id, &request.thread_id)?;
        validate_share_audience(&request.access, &request.principals)?;
        let mut audience = ShareAudience {
            access: request.access.clone(),
            principals: request.principals.iter().map(|principal|
                (principal.principal_type.clone(), principal.principal_id.clone())).collect(),
        };
        audience.principals.sort();
        let registration = self.register(&request.request_id)?;
        self.check_share_current(&request.expected_identity, &registration)?;
        let mut payload = {
            let mut shares = self.shares.lock().map_err(|_| failure("internal_error", "Share registry unavailable"))?;
            let prepared = shares.get_mut(&request.preparation_id)
                .ok_or_else(|| failure("share_missing", "Prepared share no longer available"))?;
            if prepared.identity != request.expected_identity || prepared.host_id != request.host_id || prepared.thread_id != request.thread_id {
                return Err(failure("account_changed", "Share identity or conversation changed"));
            }
            if !matches!(prepared.state, SharePublishState::Prepared)
                && prepared.audience.as_ref() != Some(&audience) {
                return Err(failure("share_audience_changed", "Share audience changed; prepare a new share"));
            }
            match &prepared.state {
                SharePublishState::Published(result) => return Ok(result.clone()),
                SharePublishState::Publishing => return Err(failure("share_busy", "Share publication already in progress")),
                SharePublishState::Unknown => return Err(failure("publish_unknown", "Share publication result unknown; automatic retry refused")),
                SharePublishState::Prepared => {}
            }
            prepared.state = SharePublishState::Publishing;
            prepared.audience = Some(audience);
            prepared.manifest.clone()
        };
        payload["access"] = json!(request.access);
        if !request.principals.is_empty() { payload["principals"] = json!(request.principals); }
        // Once transport starts, cancellation/network errors cannot prove the POST was not committed.
        let sent = AtomicBool::new(false);
        let result = self.share_post_started(
            "/backend-api/wham/shared_threads", payload, &request.expected_identity,
            &request.profile, &registration, &call, transport, Some(&sent),
        ).await.and_then(|body| parse_published_share(&body));
        if let Ok(mut shares) = self.shares.lock() {
            if let Some(prepared) = shares.get_mut(&request.preparation_id) {
                prepared.state = match &result {
                    Ok(result) => SharePublishState::Published(result.clone()),
                    Err(error) if !sent.load(Ordering::SeqCst) || error.status.is_some_and(|status|
                        (400..500).contains(&status) && !matches!(status, 408 | 409)) =>
                        SharePublishState::Prepared,
                    Err(_) => SharePublishState::Unknown,
                };
            }
        }
        result
    }

    /// Closing a dialog releases local upload metadata; it never revokes a published share.
    pub fn share_discard(&self, preparation_id: &str, expected_identity: &ServiceIdentity) -> ServiceResult<()> {
        self.check_share_identity(expected_identity)?;
        let mut shares = self.shares.lock().map_err(|_| failure("internal_error", "Share registry unavailable"))?;
        if let Some(prepared) = shares.get(preparation_id) {
            if &prepared.identity != expected_identity {
                return Err(failure("account_changed", "Share identity changed"));
            }
            if matches!(prepared.state, SharePublishState::Publishing) {
                return Err(failure("share_busy", "Share publication already in progress"));
            }
        }
        shares.remove(preparation_id);
        Ok(())
    }

    fn check_share_identity(&self, identity: &ServiceIdentity) -> ServiceResult<()> {
        if self.generation() != identity.generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        Ok(())
    }

    fn check_share_current(&self, identity: &ServiceIdentity, registration: &Registration<'_>) -> ServiceResult<()> {
        self.check_share_identity(identity)?;
        if registration.cancelled.load(Ordering::SeqCst) {
            return Err(failure("cancelled", "Service request cancelled"));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn share_post<F, Fut, T>(
        &self, route: &'static str, body: Value, identity: &ServiceIdentity,
        profile: &ServiceProfile, registration: &Registration<'_>, call: &F, transport: &T,
    ) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        self.share_post_started(route, body, identity, profile, registration, call, transport, None).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn share_post_started<F, Fut, T>(
        &self, route: &'static str, body: Value, identity: &ServiceIdentity,
        profile: &ServiceProfile, registration: &Registration<'_>, call: &F, transport: &T,
        sent: Option<&AtomicBool>,
    ) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        if !matches!(route, "/backend-api/wham/shared_threads/upload_urls" | "/backend-api/wham/shared_threads") {
            return Err(failure("invalid_request", "Unsupported share operation"));
        }
        self.authenticated_share_json(route, body, identity, profile, registration, call, transport, sent).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn authenticated_share_json<F, Fut, T>(
        &self, route: &'static str, body: Value, identity: &ServiceIdentity,
        profile: &ServiceProfile, registration: &Registration<'_>, call: &F, transport: &T,
        sent: Option<&AtomicBool>,
    ) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        self.check_share_current(identity, registration)?;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = async {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                self.check_share_current(identity, registration)?;
                let credentials = session.credentials.as_ref().unwrap();
                if &credentials.identity != identity {
                    return Err(failure("account_changed", "Authenticated identity changed"));
                }
                let integrity = session.integrity.clone();
                let mut request = build_http_request(route, credentials, integrity.as_deref(), profile)?;
                request.method = HttpMethod::Post;
                request.body = serde_json::to_vec(&body)
                    .map_err(|_| failure("invalid_request", "Invalid share request"))?;
                if request.body.len() > 256 * 1024 {
                    return Err(failure("invalid_request", "Share request exceeded size limit"));
                }
                request.headers.insert("Content-Type".into(), "application/json".into());
                share_network_allowed(call, &request.url).await?;
                self.check_share_current(identity, registration)?;
                if let Some(sent) = sent { sent.store(true, Ordering::SeqCst); }
                let response = send_bounded(transport, request, registration.cancelled.clone(), Duration::from_secs(50)).await?;
                self.check_share_current(identity, registration)?;
                apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                // A write is sent once, including 401; never inherit GET's refresh/replay loop.
                Ok(decode_response(response, registration.id.clone(), identity.clone())?.body)
            } => result,
        };
        self.check_share_current(identity, registration)?;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn share_put<F, Fut, T>(
        &self, target: &ShareUploadTarget, bytes: &[u8], mime: &str,
        identity: &ServiceIdentity, registration: &Registration<'_>, call: &F, transport: &T,
    ) -> ServiceResult<()>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        self.check_share_current(identity, registration)?;
        validate_share_target(target)?;
        tokio::select! {
            _ = cancelled(&registration.cancelled) => return Err(failure("cancelled", "Service request cancelled")),
            result = share_network_allowed(call, &target.upload_url) => result?,
        };
        self.check_share_current(identity, registration)?;
        let mut headers = target.headers.clone();
        let existing_content_type = headers.keys().find(|key| key.eq_ignore_ascii_case("content-type")).cloned();
        if mime != "application/json" {
            if let Some(key) = existing_content_type { headers.remove(&key); }
            headers.insert("Content-Type".into(), mime.into());
        } else if existing_content_type.is_none() {
            headers.insert("Content-Type".into(), mime.into());
        }
        let response = send_bounded(transport, HttpRequest {
            url: target.upload_url.clone(), headers, method: HttpMethod::Put, body: bytes.to_vec(),
        }, registration.cancelled.clone(), Duration::from_secs(50)).await?;
        self.check_share_current(identity, registration)?;
        if !(200..300).contains(&response.status) {
            return Err(ServiceError { code: "upload_failed", message: "Share upload failed", status: Some(response.status) });
        }
        // Blob PUT commonly returns no JSON body; manifest comes from upload_urls.
        Ok(())
    }

    async fn prepare<F, Fut>(
        &self,
        session: &mut Session,
        generation: u64,
        call: &F,
        refresh: bool,
    ) -> ServiceResult<()>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        if session.generation != generation {
            *session = Session {
                generation,
                ..Session::default()
            };
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if !refresh
            && session
                .credentials
                .as_ref()
                .is_some_and(|c| c.expires > now + 300)
        {
            return Ok(());
        }
        // Unlike the official eager background path, refresh near-expiry cached
        // credentials synchronously while holding the single-flight session lock.
        let refresh = refresh
            || session
                .credentials
                .as_ref()
                .is_some_and(|c| c.expires <= now + 300);
        // Never propagate RPC error text; an RPC failure can contain a raw auth payload.
        let auth = call(
            "getAuthStatus",
            json!({"includeToken":true,"refreshToken":refresh}),
        )
        .await
        .map_err(|_| {
            failure(
                "auth_unavailable",
                "Authentication status method unavailable",
            )
        })?;
        let token = match auth.get("authMethod").and_then(Value::as_str) {
            Some("chatgpt" | "chatgptAuthTokens") => auth.get("authToken").and_then(Value::as_str),
            _ => None,
        }
        .filter(|token| !token.is_empty())
        .ok_or_else(|| failure("not_logged_in", "ChatGPT login required"))?;
        let (account_id, user_id, expires, fedramp) = parse_token(token)?;
        if expires <= now {
            if !refresh {
                // Exactly one forced acquisition for an already-expired cached token.
                let auth = call(
                    "getAuthStatus",
                    json!({"includeToken":true,"refreshToken":true}),
                )
                .await
                .map_err(|_| failure("auth_unavailable", "Authentication refresh unavailable"))?;
                return self
                    .install_credentials(session, generation, &auth, call, now)
                    .await;
            }
            return Err(failure("auth_expired", "ChatGPT credentials expired"));
        }
        self.install_parsed(
            session, generation, token, account_id, user_id, expires, fedramp, call,
        )
        .await
    }

    async fn install_credentials<F, Fut>(
        &self,
        session: &mut Session,
        generation: u64,
        auth: &Value,
        call: &F,
        now: u64,
    ) -> ServiceResult<()>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        if !matches!(
            auth.get("authMethod").and_then(Value::as_str),
            Some("chatgpt" | "chatgptAuthTokens")
        ) {
            return Err(failure("not_logged_in", "ChatGPT login required"));
        }
        let token = auth
            .get("authToken")
            .and_then(Value::as_str)
            .ok_or_else(|| failure("not_logged_in", "ChatGPT login required"))?;
        let (account, user, expires, fedramp) = parse_token(token)?;
        if expires <= now {
            return Err(failure("auth_expired", "ChatGPT credentials expired"));
        }
        self.install_parsed(
            session, generation, token, account, user, expires, fedramp, call,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn install_parsed<F, Fut>(
        &self,
        session: &mut Session,
        generation: u64,
        token: &str,
        account_id: String,
        user_id: String,
        expires: u64,
        fedramp: bool,
        call: &F,
    ) -> ServiceResult<()>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let account = call("account/read", json!({"refreshToken":false}))
            .await
            .map_err(|_| failure("routing_unavailable", "Workspace routing unavailable"))?;
        if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
            return Err(failure("not_logged_in", "ChatGPT login required"));
        }
        let routing = account
            .get("workspaceRouting")
            .ok_or_else(|| failure("routing_unavailable", "Workspace routing unavailable"))?;
        if routing.get("chatgptAccountId").and_then(Value::as_str) != Some(account_id.as_str()) {
            return Err(failure(
                "account_changed",
                "Token and workspace account differ",
            ));
        }
        let origin = routing
            .get("backendOrigin")
            .and_then(Value::as_str)
            .ok_or_else(|| failure("routing_unavailable", "Workspace origin unavailable"))?;
        let origin = if origin == "NO_CONSTRAINT" {
            "https://chatgpt.com"
        } else {
            origin
        };
        validate_origin(origin)?;
        let routing_override = routing
            .get("accountRoutingOverride")
            .and_then(Value::as_str)
            .filter(|v| matches!(*v, "NO_CONSTRAINT" | "us" | "us_cr"))
            .ok_or_else(|| {
                failure(
                    "routing_unavailable",
                    "Unsupported workspace routing override",
                )
            })?;
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        let identity = ServiceIdentity {
            account_id,
            user_id,
            generation,
        };
        if session
            .credentials
            .as_ref()
            .is_some_and(|old| old.identity != identity)
        {
            session.integrity = None;
            self.invalidate();
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        session.credentials = Some(Credentials {
            token: token.to_owned(),
            identity,
            expires,
            origin: origin.to_owned(),
            routing_override: routing_override.to_owned(),
            fedramp,
        });
        Ok(())
    }
}

fn parse_token(token: &str) -> ServiceResult<(String, String, u64, bool)> {
    if token.len() > 65536
        || token
            .bytes()
            .any(|b| b.is_ascii_control() || b == b' ' || b == b'"' || b == b'\\')
    {
        return Err(failure("invalid_auth", "Invalid ChatGPT credential"));
    }
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(failure("invalid_auth", "Invalid ChatGPT credential"));
    }
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| failure("invalid_auth", "Invalid ChatGPT credential"))?;
    let claims: Value = serde_json::from_slice(&decoded)
        .map_err(|_| failure("invalid_auth", "Invalid ChatGPT credential"))?;
    let auth = &claims["https://api.openai.com/auth"];
    let account = auth
        .get("chatgpt_account_id")
        .or_else(|| auth.get("account_id"))
        .and_then(Value::as_str);
    let user = auth
        .get("user_id")
        .or_else(|| auth.get("chatgpt_user_id"))
        .and_then(Value::as_str);
    let valid_id =
        |id: &str| !id.is_empty() && id.len() <= 512 && !id.chars().any(char::is_control);
    let account = account
        .filter(|id| valid_id(id))
        .ok_or_else(|| failure("invalid_auth", "ChatGPT account claim missing"))?;
    let user = user
        .filter(|id| valid_id(id))
        .ok_or_else(|| failure("invalid_auth", "ChatGPT user claim missing"))?;
    let expires = claims
        .get("exp")
        .and_then(Value::as_u64)
        .filter(|exp| *exp > 0)
        .ok_or_else(|| failure("invalid_auth", "ChatGPT expiry claim missing"))?;
    let fedramp = match auth.get("chatgpt_account_is_fedramp") {
        None => false,
        Some(Value::Bool(value)) => *value,
        _ => return Err(failure("invalid_auth", "Invalid FedRAMP account claim")),
    };
    Ok((account.to_owned(), user.to_owned(), expires, fedramp))
}

fn validate_origin(origin: &str) -> ServiceResult<()> {
    if !matches!(origin, "https://chatgpt.com" | "https://gov.chatgpt.com") {
        return Err(failure(
            "routing_unavailable",
            "Unsupported workspace origin",
        ));
    }
    Ok(())
}

fn encode_segment(segment: &str) -> ServiceResult<String> {
    if segment.is_empty()
        || segment.len() > 512
        || matches!(segment, "." | "..")
        || segment.chars().any(char::is_control)
    {
        return Err(failure(
            "invalid_request",
            "Invalid service resource identifier",
        ));
    }
    // Encode slash, percent, question mark and hash as well as non-ASCII bytes.
    Ok(segment
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect())
}

fn resolve_read_route(operation: &ServiceOperation, params: &Value, identity: &ServiceIdentity) -> ServiceResult<String> {
    if !matches!(operation, ServiceOperation::ShareAccounts | ServiceOperation::ShareUsers | ServiceOperation::ShareGroups) {
        return resolve_route(operation, params);
    }
    let params = params.as_object()
        .ok_or_else(|| failure("invalid_request", "Share search parameters must be an object"))?;
    if matches!(operation, ServiceOperation::ShareAccounts) {
        if !params.is_empty() {
            return Err(failure("invalid_request", "Share accounts does not accept parameters"));
        }
        return Ok("/backend-api/wham/accounts/check".into());
    }
    if params.len() != 1 || !params.contains_key("query") {
        return Err(failure("invalid_request", "Share search accepts only query"));
    }
    let query = params["query"].as_str()
        .map(str::trim)
        .filter(|query| !query.is_empty() && query.len() <= 512 && !query.chars().any(char::is_control))
        .ok_or_else(|| failure("invalid_request", "Invalid share recipient query"))?;
    let account = encode_segment(&identity.account_id)?;
    let users = matches!(operation, ServiceOperation::ShareUsers);
    let kind = if users { "users" } else { "groups" };
    let mut url = tauri::Url::parse(&format!("https://chatgpt.com/backend-api/accounts/{account}/{kind}"))
        .map_err(|_| failure("invalid_request", "Invalid share search route"))?;
    url.query_pairs_mut().append_pair("limit", "10").append_pair("offset", "0").append_pair("query", query);
    if users {
        url.query_pairs_mut().append_pair("include_profile_photos", "false");
    } else {
        url.query_pairs_mut().append_pair("include_member_counts", "false").append_pair("include_total", "false");
    }
    Ok(format!("{}?{}", url.path(), url.query().unwrap()))
}

fn resolve_route(operation: &ServiceOperation, params: &Value) -> ServiceResult<String> {
    let params = params
        .as_object()
        .ok_or_else(|| failure("invalid_request", "Service parameters must be an object"))?;
    let (path, allowed): (String, &[&str]) = match operation {
        ServiceOperation::LibraryFavorites => (
            "/backend-api/files/library/favorites".into(),
            &["cursor", "limit"],
        ),
        ServiceOperation::LibraryNodes => (
            "/backend-api/files/library/nodes".into(),
            &[
                "parent_directory_id",
                "cursor",
                "q",
                "categories",
                "source",
                "include_hidden_files",
                "include_files",
                "include_saved_entities",
                "include_provider_roots",
                "include_pages",
                "include_sites",
                "include_folder_counts",
                "include_onedrive",
                "hydrate_folder_thumbnails",
            ],
        ),
        ServiceOperation::ImagesInit => ("/backend-api/images/init".into(), &[]),
        ServiceOperation::ImagesStyles => (
            "/backend-api/images/styles".into(),
            &["include_image_suggestions"],
        ),
        ServiceOperation::ImagesRecent => (
            "/backend-api/my/recent/image_gen".into(),
            &["limit", "after"],
        ),
        ServiceOperation::GptsDiscovery => ("/public-api/gizmos/discovery".into(), &["locale"]),
        ServiceOperation::GptsCategory => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_request", "Category identifier required"))?;
            (
                format!("/public-api/gizmos/discovery/{}", encode_segment(id)?),
                &["id", "cursor", "limit", "locale"],
            )
        }
        ServiceOperation::GptsSearch => (
            "/backend-api/gizmos/search".into(),
            &["q", "limit", "cursor", "workspace_only"],
        ),
        ServiceOperation::GptsDetail | ServiceOperation::GptsAbout => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_request", "GPT identifier required"))?;
            (
                format!(
                    "/backend-api/gizmos/{}{}",
                    encode_segment(id)?,
                    if matches!(operation, ServiceOperation::GptsAbout) {
                        "/about"
                    } else {
                        ""
                    }
                ),
                &["id"],
            )
        }
        ServiceOperation::SitesAccess => ("/backend-api/websites/access".into(), &[]),
        ServiceOperation::ShareAccounts | ServiceOperation::ShareUsers | ServiceOperation::ShareGroups => {
            return Err(failure("invalid_request", "Identity-bound share route required"));
        }
        ServiceOperation::GithubRepository => {
            let id = params.get("id").and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_request", "Repository identifier required"))?;
            (format!("/backend-api/wham/github/repositories/{}", encode_segment(id)?), &["id"])
        }
        ServiceOperation::SitesList => (
            "/backend-api/websites".into(),
            &["limit", "include_editable", "after"],
        ),
        ServiceOperation::SitesShared => (
            "/backend-api/websites/shared".into(),
            &["limit", "query", "after"],
        ),
        ServiceOperation::SitesDetail
        | ServiceOperation::SitesEnvironment
        | ServiceOperation::SitesDomains
        | ServiceOperation::SitesShareAccess => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_request", "Site identifier required"))?;
            let suffix = match operation {
                ServiceOperation::SitesEnvironment => "/environment",
                ServiceOperation::SitesDomains => "/custom_domains",
                ServiceOperation::SitesShareAccess => "/share_access",
                _ => "",
            };
            (
                format!("/backend-api/websites/{}{suffix}", encode_segment(id)?),
                &["id"],
            )
        }
    };
    let mut url = tauri::Url::parse(&format!("https://chatgpt.com{path}"))
        .map_err(|_| failure("invalid_request", "Invalid service route"))?;
    for (key, value) in params {
        if !allowed.contains(&key.as_str()) {
            return Err(failure("invalid_request", "Unsupported service parameter"));
        }
        if key == "id" {
            continue;
        }
        if key == "categories" {
            let values = value
                .as_array()
                .filter(|v| v.len() <= 20)
                .ok_or_else(|| failure("invalid_request", "Invalid service category values"))?;
            for value in values {
                let value = value
                    .as_str()
                    .filter(|s| s.len() <= 128 && !s.chars().any(char::is_control))
                    .ok_or_else(|| failure("invalid_request", "Invalid service category value"))?;
                // Official Jmn appends each array element under the same query key.
                url.query_pairs_mut().append_pair(key, value);
            }
            continue;
        }
        let encoded = if key == "limit" {
            value
                .as_u64()
                .filter(|v| *v > 0 && *v <= 100)
                .map(|v| v.to_string())
        } else if key.starts_with("include_")
            || key == "hydrate_folder_thumbnails"
            || key == "workspace_only"
        {
            value.as_bool().map(|v| v.to_string())
        } else {
            value
                .as_str()
                .filter(|s| s.len() <= 2048 && !s.chars().any(char::is_control))
                .map(str::to_owned)
        }
        .ok_or_else(|| failure("invalid_request", "Invalid service parameter value"))?;
        url.query_pairs_mut().append_pair(key, &encoded);
    }
    if matches!(operation, ServiceOperation::ImagesStyles)
        && !params.contains_key("include_image_suggestions")
    {
        url.query_pairs_mut()
            .append_pair("include_image_suggestions", "true");
    }
    Ok(format!(
        "{}{}",
        url.path(),
        url.query().map(|q| format!("?{q}")).unwrap_or_default()
    ))
}

fn resolve_cloud_route(operation: &CloudOperation, params: &Value) -> ServiceResult<String> {
    let params = params.as_object()
        .ok_or_else(|| failure("invalid_request", "Cloud parameters must be an object"))?;
    let allowed: &[&str] = match operation {
        CloudOperation::List => &["scope", "limit", "omitDraft", "cursor"],
        CloudOperation::Detail => &["id"],
        CloudOperation::Draft => &["id", "draftId"],
    };
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(failure("invalid_request", "Unsupported cloud parameter"));
    }
    let identifier = |key: &str| -> ServiceResult<String> {
        let value = params.get(key).and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 512
                && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"_~-".contains(&b)))
            .ok_or_else(|| failure("invalid_request", "Invalid cloud resource identifier"))?;
        encode_segment(value)
    };
    match operation {
        CloudOperation::List => {
            let scope = params.get("scope").and_then(Value::as_str)
                .filter(|scope| matches!(*scope, "user" | "workspace"))
                .ok_or_else(|| failure("invalid_request", "Invalid cloud list scope"))?;
            if params.get("limit").and_then(Value::as_u64) != Some(100)
                || params.get("omitDraft").and_then(Value::as_bool) != Some(true) {
                return Err(failure("invalid_request", "Invalid cloud list options"));
            }
            let mut url = tauri::Url::parse("https://codex-cloud-backend.chatgpt.com/v1/environment-configs")
                .map_err(|_| failure("internal", "Invalid fixed cloud route"))?;
            url.query_pairs_mut().append_pair("scope", scope)
                .append_pair("limit", "100").append_pair("omitDraft", "true");
            if let Some(cursor) = params.get("cursor") {
                let cursor = cursor.as_str()
                    .filter(|s| !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control))
                    .ok_or_else(|| failure("invalid_request", "Invalid cloud cursor"))?;
                url.query_pairs_mut().append_pair("cursor", cursor);
            }
            Ok(format!("{}?{}", url.path(), url.query().unwrap()))
        }
        CloudOperation::Detail => Ok(format!("/v1/environment-configs/{}", identifier("id")?)),
        CloudOperation::Draft => Ok(format!("/v1/environment-configs/{}/drafts/{}",
            identifier("id")?, identifier("draftId")?)),
    }
}

fn validate_cloud_profile(profile: &CloudProfile) -> ServiceResult<()> {
    if [&profile.user_agent, &profile.originator].iter().any(|value|
        value.is_empty() || value.len() > 2048 || value.chars().any(char::is_control)) {
        return Err(failure("invalid_request", "Invalid cloud host profile"));
    }
    Ok(())
}

fn build_cloud_http_request(
    route: &str,
    credentials: &CloudCredentials,
    profile: &CloudProfile,
) -> HttpRequest {
    let mut headers = BTreeMap::from([
        ("Content-Type".into(), "application/json".into()),
        ("X-OpenAI-Product-Sku".into(), "codex".into()),
        ("Authorization".into(), format!("Bearer {}", credentials.token)),
        ("ChatGPT-Account-Id".into(), credentials.identity.account_id.clone()),
        ("User-Agent".into(), profile.user_agent.clone()),
        ("originator".into(), profile.originator.clone()),
    ]);
    if credentials.fedramp {
        headers.insert("X-OpenAI-Fedramp".into(), "true".into());
    }
    HttpRequest {
        url: format!("https://codex-cloud-backend.chatgpt.com{route}"),
        headers,
        method: HttpMethod::Get,
        body: Vec::new(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HttpMethod { Get, Post, Put, Patch }

struct HttpRequest {
    url: String,
    headers: BTreeMap<String, String>,
    method: HttpMethod,
    body: Vec<u8>,
}
struct HttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn build_http_request(
    route: &str,
    credentials: &Credentials,
    integrity: Option<&str>,
    profile: &ServiceProfile,
) -> ServiceResult<HttpRequest> {
    validate_origin(&credentials.origin)?;
    for value in [
        &profile.language,
        &profile.device_id,
        &profile.user_agent,
        &profile.user_agent_client_hints,
        &profile.platform_client_hint,
    ] {
        if value.is_empty() || value.len() > 2048 || value.chars().any(char::is_control) {
            return Err(failure(
                "invalid_request",
                "Invalid service browser profile",
            ));
        }
    }
    if !profile.user_agent.contains("Chrome/") && !profile.user_agent.contains("Chromium/") {
        return Err(failure(
            "invalid_request",
            "Chromium browser profile required",
        ));
    }
    let mut headers = BTreeMap::from([
        (
            "Authorization".to_owned(),
            format!("Bearer {}", credentials.token),
        ),
        (
            "ChatGPT-Account-Id".to_owned(),
            credentials.identity.account_id.clone(),
        ),
        ("Accept".to_owned(), "application/json".to_owned()),
        ("OAI-Language".to_owned(), profile.language.clone()),
        ("oai-did".to_owned(), profile.device_id.clone()),
        ("User-Agent".to_owned(), profile.user_agent.clone()),
        (
            "sec-ch-ua".to_owned(),
            profile.user_agent_client_hints.clone(),
        ),
        ("sec-ch-ua-mobile".to_owned(), "?0".to_owned()),
        (
            "sec-ch-ua-platform".to_owned(),
            profile.platform_client_hint.clone(),
        ),
        ("originator".to_owned(), "Codex Browser".to_owned()),
        (
            "x-openai-web-frontend".to_owned(),
            "codex_webview".to_owned(),
        ),
        ("x-oai-mcp-form-version".to_owned(), "2".to_owned()),
        // LFn uses this surface label even in its chatgpt-browser profile branch;
        // it is not an assertion of DeviceCheck/attestation support.
        (
            "x-openai-codex-window-type".to_owned(),
            "electron".to_owned(),
        ),
    ]);
    if credentials.fedramp {
        headers.insert("X-OpenAI-Fedramp".into(), "true".into());
    }
    if credentials.routing_override != "NO_CONSTRAINT" {
        headers.insert(
            "X-OpenAI-Account-Routing-Override".into(),
            credentials.routing_override.clone(),
        );
    }
    if let Some(value) = integrity.filter(|v| valid_integrity(v)) {
        headers.insert("X-OAI-IS".into(), value.to_owned());
    }
    Ok(HttpRequest {
        url: format!("{}{route}", credentials.origin),
        headers,
        method: HttpMethod::Get,
        body: Vec::new(),
    })
}

fn validate_share_context(host_id: &str, thread_id: &str) -> ServiceResult<()> {
    if host_id != "local" {
        return Err(failure("unsupported_host", "Share uploads currently support only the local host"));
    }
    for id in [host_id, thread_id] {
        if id.is_empty() || id.len() > 512 || id.chars().any(char::is_control) {
            return Err(failure("invalid_request", "Invalid share conversation"));
        }
    }
    Ok(())
}

fn share_asset_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.as_bytes()[0].is_ascii_alphanumeric()
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

type ShareAssetBytes = (String, String, Vec<u8>);

fn validate_share_payload(snapshot: &str, assets: &[ShareAsset]) -> ServiceResult<Vec<ShareAssetBytes>> {
    if snapshot.is_empty() || snapshot.len() > MAX_SHARE_SNAPSHOT || assets.len() > 64 {
        return Err(failure("invalid_request", "Share payload exceeded size limit"));
    }
    let parsed: Value = serde_json::from_str(snapshot)
        .map_err(|_| failure("invalid_request", "Invalid shared snapshot"))?;
    if !valid_shared_snapshot(&parsed) {
        return Err(failure("invalid_request", "Invalid shared snapshot"));
    }
    let mut result = Vec::new();
    let mut total = 0usize;
    for asset in assets {
        if !share_asset_id(&asset.asset_id) || result.iter().any(|(id, _, _)| id == &asset.asset_id)
            || !matches!(asset.mime_type.as_str(), "image/png" | "image/jpeg" | "image/jpg" | "image/webp" | "image/gif" | "image/avif" | "application/octet-stream")
            || asset.bytes_base64.len() > (MAX_SHARE_ASSET + 2) / 3 * 4 {
            return Err(failure("invalid_request", "Invalid shared asset"));
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(&asset.bytes_base64)
            .map_err(|_| failure("invalid_request", "Invalid shared asset encoding"))?;
        total += bytes.len();
        if bytes.is_empty() || bytes.len() > MAX_SHARE_ASSET || total > MAX_SHARE_ASSETS {
            return Err(failure("invalid_request", "Share assets exceeded size limit"));
        }
        result.push((asset.asset_id.clone(), asset.mime_type.clone(), bytes));
    }
    validate_snapshot_asset_references(&parsed, &result)?;
    Ok(result)
}

fn validate_snapshot_asset_references(snapshot: &Value, assets: &[ShareAssetBytes]) -> ServiceResult<()> {
    let uploaded: std::collections::HashSet<_> = assets.iter().map(|(id, _, _)| id.as_str()).collect();
    if snapshot.get("assets").and_then(Value::as_object)
        .is_some_and(|dimensions| dimensions.keys().any(|id| !uploaded.contains(id.as_str()))) {
        return Err(failure("invalid_request", "Snapshot image dimensions reference a missing upload"));
    }
    // Inspect only structured image fields. Text may legitimately discuss a literal
    // asset URI; Markdown resolution belongs to the snapshot converter's parser.
    for turn in snapshot["turns"].as_array().unwrap() {
        for item in turn["items"].as_array().unwrap() {
            let mut urls = Vec::new();
            match item["type"].as_str() {
                Some("imageView") => urls.push(&item["url"]),
                Some("imageGeneration") => urls.push(&item["result"]),
                Some("userMessage") => {
                    for part in item["content"].as_array().unwrap() {
                        if part["type"] == "image" { urls.push(&part["url"]); }
                    }
                }
                _ => {}
            }
            for url in urls {
                if let Some(id) = url.as_str().and_then(|url| url.strip_prefix("codex:shared-asset/")) {
                    if !uploaded.contains(id) {
                        return Err(failure("invalid_request", "Snapshot image references a missing upload"));
                    }
                }
            }
        }
    }
    Ok(())
}

fn only_keys(value: &Value, allowed: &[&str]) -> bool {
    value.as_object().is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}

fn shared_asset_url(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|url|
        url == "codex:shared-image-unavailable" ||
        url.strip_prefix("codex:shared-asset/").is_some_and(share_asset_id))
}

fn valid_shared_snapshot(snapshot: &Value) -> bool {
    if !only_keys(snapshot, &["version", "title", "assets", "turns"]) || snapshot.get("version") != Some(&json!(1))
        || snapshot.get("title").is_some_and(|title| !title.is_string()) { return false }
    if let Some(assets) = snapshot.get("assets") {
        let Some(assets) = assets.as_object() else { return false };
        if assets.iter().any(|(id, dimensions)| !share_asset_id(id)
            || !only_keys(dimensions, &["width", "height"])
            || !["width", "height"].iter().all(|key| dimensions.get(key).and_then(Value::as_u64).is_some_and(|value| value > 0))) {
            return false;
        }
    }
    let Some(turns) = snapshot.get("turns").and_then(Value::as_array) else { return false };
    turns.iter().all(|turn| {
        only_keys(turn, &["items", "durationMs"])
            && turn.get("durationMs").is_none_or(|duration| duration.as_f64().is_some_and(|value| value.is_finite() && value >= 0.0))
            && turn.get("items").and_then(Value::as_array).is_some_and(|items| items.iter().all(|item| {
                match item.get("type").and_then(Value::as_str) {
                    Some("userMessage") => only_keys(item, &["type", "content"]) &&
                        item.get("content").and_then(Value::as_array).is_some_and(|content| content.iter().all(|part| {
                            match part.get("type").and_then(Value::as_str) {
                                Some("text") => only_keys(part, &["type", "text"]) && part.get("text").is_some_and(Value::is_string),
                                Some("image") => only_keys(part, &["type", "url"]) && shared_asset_url(part.get("url")),
                                _ => false,
                            }
                        })),
                    Some("agentMessage") => only_keys(item, &["type", "text", "phase"])
                        && item.get("text").is_some_and(Value::is_string)
                        && item.get("phase").is_none_or(|phase| matches!(phase.as_str(), Some("commentary" | "final_answer"))),
                    Some("reasoning") => only_keys(item, &["type", "summary"]) && item.get("summary").is_some_and(Value::is_string),
                    Some("imageView") => only_keys(item, &["type", "url"]) && shared_asset_url(item.get("url")),
                    Some("imageGeneration") => only_keys(item, &["type", "status", "result"])
                        && item.get("status").and_then(Value::as_str) == Some("completed") && shared_asset_url(item.get("result")),
                    Some("fileChange") => only_keys(item, &["type", "status", "changes"])
                        && item.get("status").and_then(Value::as_str) == Some("completed")
                        && item.get("changes").and_then(Value::as_array).is_some_and(|changes| changes.iter().all(|change|
                            only_keys(change, &["path", "diff"]) && change.get("diff").is_some_and(Value::is_string)
                                && change.get("path").is_none_or(Value::is_string))),
                    _ => false,
                }
            }))
    })
}

fn validate_share_target(target: &ShareUploadTarget) -> ServiceResult<()> {
    // These values are accepted only from the authenticated, fixed upload_urls operation.
    // This is a conservative transport boundary, not a claimed official domain allowlist.
    let url = tauri::Url::parse(&target.upload_url)
        .map_err(|_| failure("invalid_response", "Invalid share upload target"))?;
    let host = url.host_str().unwrap_or_default();
    if target.upload_url.len() > 16384 || target.upload_url.chars().any(char::is_control)
        || url.scheme() != "https" || !url.username().is_empty()
        || url.password().is_some() || url.fragment().is_some() || url.port().is_some_and(|port| port != 443)
        || host.parse::<std::net::IpAddr>().is_ok() || !host.contains('.')
        || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with('.')
        || !host.bytes().all(|byte| byte.is_ascii_alphanumeric() || b".-".contains(&byte))
        || target.etag.is_empty() || target.etag.len() > 4096 || target.file_id.is_empty() || target.file_id.len() > 4096
        || target.headers.len() > 64 {
        return Err(failure("invalid_response", "Invalid share upload target"));
    }
    let mut names = std::collections::HashSet::new();
    for (name, value) in &target.headers {
        let lower = name.to_ascii_lowercase();
        if !names.insert(lower.clone()) || name.is_empty() || name.len() > 128 || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
            || value.len() > 16384 || value.chars().any(char::is_control)
            || matches!(lower.as_str(), "authorization" | "proxy-authorization" | "cookie" | "cookie2" | "host" | "connection" | "transfer-encoding" | "content-length")
            || lower.starts_with("oai-") || lower.starts_with("x-oai-") || lower.starts_with("chatgpt-") || lower.starts_with("x-openai-") {
            return Err(failure("invalid_response", "Unsafe share upload headers"));
        }
    }
    Ok(())
}

fn match_asset_targets(
    assets: &[ShareAssetBytes], targets: Vec<ShareAssetTarget>,
) -> ServiceResult<HashMap<String, ShareUploadTarget>> {
    let mut result = HashMap::new();
    for target in targets {
        validate_share_target(&target.target)?;
        if !assets.iter().any(|(id, _, _)| id == &target.asset_id)
            || result.insert(target.asset_id, target.target).is_some() {
            return Err(failure("invalid_response", "Share asset target mismatch"));
        }
    }
    if result.len() != assets.len() {
        return Err(failure("invalid_response", "Share asset target mismatch"));
    }
    Ok(result)
}

fn share_upload_retryable(error: &ServiceError) -> bool {
    match error.status {
        Some(status) => !(400..500).contains(&status) || matches!(status, 403 | 408 | 410 | 429),
        None => matches!(error.code, "network_error" | "timeout" | "transport_error"),
    }
}

fn validate_share_audience(access: &ShareAccess, principals: &[SharePrincipal]) -> ServiceResult<()> {
    if principals.len() > 256 || matches!(access, ShareAccess::Invited) != !principals.is_empty() {
        return Err(failure("invalid_request", "Invalid share audience"));
    }
    let mut ids = std::collections::HashSet::new();
    for principal in principals {
        if !matches!(principal.principal_type.as_str(), "user" | "group")
            || principal.principal_id.is_empty() || principal.principal_id.len() > 512
            || principal.principal_id.chars().any(char::is_control)
            || !ids.insert((&principal.principal_type, &principal.principal_id)) {
            return Err(failure("invalid_request", "Invalid share principal"));
        }
    }
    Ok(())
}

async fn share_network_allowed<F, Fut>(call: &F, url: &str) -> ServiceResult<()>
where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
    let response = call("configRequirements/read", json!({})).await
        .map_err(|_| failure("network_policy_unavailable", "Application network policy unavailable"))?;
    let requirements = response.get("requirements")
        .ok_or_else(|| failure("network_policy_unavailable", "Application network policy unavailable"))?;
    if !requirements.is_null() && !requirements.is_object() {
        return Err(failure("network_policy_unavailable", "Invalid application network policy"));
    }
    let Some(network) = requirements.pointer("/application/network") else { return Ok(()) };
    if network.is_null() { return Ok(()) }
    let enabled = network.get("enabled").and_then(Value::as_bool)
        .ok_or_else(|| failure("network_policy_unavailable", "Invalid application network policy"))?;
    if !enabled { return Ok(()) }
    let domains = network.get("domains").and_then(Value::as_object)
        .ok_or_else(|| failure("network_policy_unavailable", "Invalid application network domains"))?;
    let url = tauri::Url::parse(url)
        .map_err(|_| failure("invalid_request", "Invalid application network destination"))?;
    let host = url.host_str().unwrap_or_default().strip_suffix('.').unwrap_or(url.host_str().unwrap_or_default());
    if url.scheme() != "https" || domains.get(host).and_then(Value::as_str) != Some("allow") {
        return Err(failure("network_restricted", "Application network destination denied"));
    }
    Ok(())
}

fn parse_published_share(body: &Value) -> ServiceResult<PublishedShare> {
    let id = body.get("share_id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 512 && !id.chars().any(char::is_control))
        .ok_or_else(|| failure("invalid_response", "Invalid share publication response"))?;
    let raw_url = body.get("share_url").and_then(Value::as_str)
        .ok_or_else(|| failure("invalid_response", "Invalid share publication response"))?;
    let url = tauri::Url::parse(raw_url).map_err(|_| failure("invalid_response", "Invalid shared URL"))?;
    if raw_url.len() > 16384 || raw_url.chars().any(char::is_control) || url.scheme() != "https" || !url.username().is_empty()
        || url.password().is_some() || url.host_str().is_none() {
        return Err(failure("invalid_response", "Invalid shared URL"));
    }
    Ok(PublishedShare { share_id: id.into(), share_url: raw_url.into() })
}

fn valid_integrity(value: &str) -> bool {
    if value.len() > 2048 {
        return false;
    }
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 4
        && parts[0] == "ois1"
        && parts[1..].iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        })
}

fn apply_integrity(
    current: &mut Option<String>,
    sent: Option<&str>,
    update: Option<&String>,
) -> bool {
    if current.as_deref() != sent {
        return false;
    }
    if let Some(update) = update.filter(|v| valid_integrity(v)) {
        *current = Some(update.clone());
        return true;
    }
    false
}

// early-bootstrap-339 hT: a workspace IP refusal is not an expired-token response.
fn account_instructions_ip_denied(response: &HttpResponse) -> bool {
    if response.status != 401 { return false; }
    let Ok(body) = serde_json::from_slice::<Value>(&response.body) else { return false; };
    body.pointer("/error/type").and_then(Value::as_str) == Some("ip_not_authorized") ||
        matches!(body.pointer("/error/code").and_then(Value::as_str),
            Some("ip_not_authorized" | "validate_whitelist_failed" | "workspace_ip_not_authorized"))
}

fn decode_response(
    response: HttpResponse,
    request_id: String,
    identity: ServiceIdentity,
) -> ServiceResult<ServiceResponse> {
    if !(200..300).contains(&response.status) {
        let (code, message) = match response.status {
            401 => ("unauthorized", "ChatGPT authentication rejected"),
            403 => ("forbidden", "ChatGPT service access denied"),
            404 => ("not_found", "ChatGPT service resource not found"),
            409 => ("conflict", "ChatGPT service identity or resource conflict"),
            429 => ("rate_limited", "ChatGPT service rate limit reached"),
            300..=399 => ("redirect_rejected", "ChatGPT service redirect refused"),
            _ => ("service_error", "ChatGPT service request failed"),
        };
        return Err(ServiceError {
            code,
            message,
            status: Some(response.status),
        });
    }
    let body = serde_json::from_slice(&response.body).map_err(|_| ServiceError {
        code: "invalid_response",
        message: "ChatGPT service returned invalid JSON",
        status: Some(response.status),
    })?;
    let headers = response
        .headers
        .into_iter()
        .filter(|(key, _)| {
            matches!(
                key.as_str(),
                "x-request-id" | "x-openai-request-id" | "retry-after" | "content-type"
            )
        })
        .collect();
    Ok(ServiceResponse {
        request_id,
        identity,
        status: response.status,
        body,
        headers,
    })
}

trait Transport {
    fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_>;
}

struct CurlTransport;
impl Transport for CurlTransport {
    fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
        Box::pin(curl_request(request, cancel))
    }
}

async fn send_bounded<T: Transport>(
    transport: &T,
    request: HttpRequest,
    cancel: Arc<AtomicBool>,
    timeout: Duration,
) -> ServiceResult<HttpResponse> {
    tokio::time::timeout(timeout, transport.send(request, cancel))
        .await
        .unwrap_or_else(|_| Err(failure("timeout", "ChatGPT service request timed out")))
}

async fn cancelled(cancel: &AtomicBool) {
    loop {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn curl_quote(value: &str) -> ServiceResult<String> {
    // Config syntax needs escaping even for backend-sourced claim values.
    if value.chars().any(char::is_control) {
        return Err(failure("invalid_request", "Invalid HTTP header value"));
    }
    Ok(format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"")))
}

fn curl_config(request: &HttpRequest) -> ServiceResult<String> {
    match request.method {
        HttpMethod::Get if !request.body.is_empty() =>
            return Err(failure("invalid_request", "GET cannot carry an upload body")),
        HttpMethod::Post | HttpMethod::Patch if request.body.len() > 256 * 1024 =>
            return Err(failure("invalid_request", "Share request exceeded size limit")),
        HttpMethod::Put if request.body.len() > MAX_SHARE_ASSET =>
            return Err(failure("invalid_request", "Share upload exceeded size limit")),
        _ => {}
    }
    let mut config = format!("url = {}\n", curl_quote(&request.url)?);
    for (key, value) in &request.headers {
        config.push_str(&format!(
            "header = {}\n",
            curl_quote(&format!("{key}: {value}"))?
        ));
    }
    Ok(config)
}

struct UploadBodyFile(std::path::PathBuf);

impl UploadBodyFile {
    fn create(bytes: &[u8]) -> ServiceResult<Self> {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("codex-share-{}.body", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path)
            .map_err(|_| failure("transport_error", "Upload body storage unavailable"))?;
        let guard = Self(path);
        let written = file.write_all(bytes);
        // Close before RAII cleanup also on a write failure (Windows cannot unlink an open file).
        drop(file);
        written.map_err(|_| failure("transport_error", "Upload body storage failed"))?;
        Ok(guard)
    }
}

impl Drop for UploadBodyFile {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

async fn curl_request(
    request: HttpRequest,
    cancel: Arc<AtomicBool>,
) -> ServiceResult<HttpResponse> {
    if cancel.load(Ordering::SeqCst) {
        return Err(failure("cancelled", "Service request cancelled"));
    }
    let mut config = curl_config(&request)?;
    // curl's stdin belongs to its private config (including credential headers).
    // A host-created, create_new file carries bytes without shell/config interpretation;
    // RAII removes it on success, cancellation, timeout and failures.
    let _body_file = if request.method != HttpMethod::Get {
        let file = UploadBodyFile::create(&request.body)?;
        let path = file.0.to_str().ok_or_else(|| failure("transport_error", "Upload body path unavailable"))?;
        config.push_str(&format!("data-binary = {}\n", curl_quote(&format!("@{path}"))?));
        Some(file)
    } else { None };
    // Use the system executable, not a PATH-controlled curl shim. -q must be first.
    #[cfg(windows)]
    let executable = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
    )
    .join("System32/curl.exe");
    #[cfg(not(windows))]
    let executable = std::path::PathBuf::from("/usr/bin/curl");
    let mut command = tokio::process::Command::new(executable);
    command
        .args([
            "-q",
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--request",
            match request.method { HttpMethod::Get => "GET", HttpMethod::Post => "POST", HttpMethod::Put => "PUT", HttpMethod::Patch => "PATCH" },
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-redirs",
            "0",
            "--connect-timeout",
            "15",
            "--max-time",
            "45",
            "--max-filesize",
            "8388608",
            "--include",
            "--suppress-connect-headers",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .env_remove("SSLKEYLOGFILE")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|_| failure("transport_unavailable", "System HTTP transport unavailable"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| failure("transport_error", "HTTP transport input unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("transport_error", "HTTP transport output unavailable"))?;
    let transfer = async {
        stdin
            .write_all(config.as_bytes())
            .await
            .map_err(|_| failure("transport_error", "HTTP transport input failed"))?;
        drop(stdin);
        let mut bytes = Vec::new();
        stdout
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| failure("network_error", "HTTP transport read failed"))?;
        if bytes.len() as u64 > MAX_RESPONSE {
            return Err(failure(
                "response_too_large",
                "ChatGPT service response exceeded size limit",
            ));
        }
        let status = child
            .wait()
            .await
            .map_err(|_| failure("network_error", "HTTP transport failed"))?;
        if !status.success() {
            return Err(failure(
                "network_error",
                "ChatGPT service network request failed",
            ));
        }
        parse_http(&bytes)
    };
    tokio::select! {
        _ = cancelled(&cancel) => Err(failure("cancelled", "Service request cancelled")),
        result = transfer => result,
    }
    // child is killed on drop on cancellation, timeout or output-limit failure.
}

fn parse_http(bytes: &[u8]) -> ServiceResult<HttpResponse> {
    let mut remaining = bytes;
    loop {
        let end = remaining
            .windows(4)
            .position(|v| v == b"\r\n\r\n")
            .ok_or_else(|| failure("invalid_response", "Invalid HTTP response headers"))?;
        if end > 65536 {
            return Err(failure(
                "invalid_response",
                "HTTP response headers too large",
            ));
        }
        let header = std::str::from_utf8(&remaining[..end])
            .map_err(|_| failure("invalid_response", "Invalid HTTP response headers"))?;
        let mut lines = header.split("\r\n");
        let first = lines.next().unwrap_or_default();
        if !first.starts_with("HTTP/") {
            return Err(failure("invalid_response", "Invalid HTTP status line"));
        }
        let status = first
            .split_whitespace()
            .nth(1)
            .and_then(|v| v.parse::<u16>().ok())
            .filter(|v| (100..600).contains(v))
            .ok_or_else(|| failure("invalid_response", "Invalid HTTP status"))?;
        remaining = &remaining[end + 4..];
        if (100..200).contains(&status) {
            continue;
        }
        let mut headers = BTreeMap::new();
        for line in lines {
            let (key, value) = line
                .split_once(':')
                .ok_or_else(|| failure("invalid_response", "Invalid HTTP response header"))?;
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
        return Ok(HttpResponse {
            status,
            headers,
            body: remaining.to_vec(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::AtomicUsize;

    fn identity() -> ServiceIdentity {
        ServiceIdentity {
            account_id: "account-fixture".into(),
            user_id: "user-fixture".into(),
            generation: 0,
        }
    }

    fn token(account: &str, user: &str, expires: u64) -> String {
        let claims = json!({"exp":expires,"https://api.openai.com/auth":{
            "chatgpt_account_id":account,"user_id":user,"chatgpt_account_is_fedramp":false
        }});
        format!(
            "fixture.{}.signature",
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&claims).unwrap())
        )
    }

    fn fixture_token() -> String {
        token("account-fixture", "user-fixture", 4102444800)
    }

    fn auth(token: &str) -> Value {
        json!({"authMethod":"chatgpt","authToken":token})
    }

    fn account() -> Value {
        json!({"account":{"type":"chatgpt"},"workspaceRouting":{
            "backendOrigin":"https://chatgpt.com","chatgptAccountId":"account-fixture","accountRoutingOverride":"NO_CONSTRAINT"
        }})
    }

    fn request(id: &str) -> ServiceRequest {
        ServiceRequest {
            request_id: id.into(),
            operation: ServiceOperation::ImagesInit,
            params: json!({}),
            expected_identity: identity(),
            profile: ServiceProfile {
                language: "zh-CN".into(),
                device_id: "fixture-device".into(),
                user_agent: "Mozilla/5.0 Chrome/140.0.0.0".into(),
                user_agent_client_hints: "\"Chromium\";v=\"140\"".into(),
                platform_client_hint: "\"Windows\"".into(),
            },
        }
    }

    struct FakeTransport {
        responses: Mutex<VecDeque<HttpResponse>>,
        requests: Mutex<Vec<HttpRequest>>,
        delay_ms: u64,
        entered: AtomicBool,
        dropped: AtomicBool,
        reserve_response_on_send: bool,
    }

    impl FakeTransport {
        fn new(statuses: &[u16]) -> Self {
            Self {
                responses: Mutex::new(
                    statuses
                        .iter()
                        .map(|status| HttpResponse {
                            status: *status,
                            headers: BTreeMap::new(),
                            body: br#"{"items":[]}"#.to_vec(),
                        })
                        .collect(),
                ),
                requests: Mutex::new(Vec::new()),
                delay_ms: 0,
                entered: AtomicBool::new(false),
                dropped: AtomicBool::new(false),
                reserve_response_on_send: false,
            }
        }
    }

    struct MarkDrop<'a>(&'a AtomicBool);
    impl Drop for MarkDrop<'_> {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    impl Transport for FakeTransport {
        fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move {
                self.requests.lock().unwrap().push(request);
                let reserved = if self.reserve_response_on_send {
                    Some(self.responses.lock().unwrap().pop_front().unwrap())
                } else { None };
                self.entered.store(true, Ordering::SeqCst);
                let _drop = MarkDrop(&self.dropped);
                tokio::select! {
                    _ = cancelled(&cancel) => Err(failure("cancelled", "Service request cancelled")),
                    _ = tokio::time::sleep(Duration::from_millis(self.delay_ms)) => {
                        Ok(reserved.unwrap_or_else(|| self.responses.lock().unwrap().pop_front().unwrap()))
                    }
                }
            })
        }
    }

    fn cloud_request(id: &str) -> CloudServiceRequest {
        CloudServiceRequest {
            request_id: id.into(),
            operation: CloudOperation::List,
            params: json!({"scope":"user","limit":100,"omitDraft":true}),
            expected_identity: identity(),
        }
    }

    fn cloud_profile() -> CloudProfile {
        CloudProfile { user_agent: "codex/0.165.0 (Windows 10.0) codex-tauri-native/0.1.0".into(),
            originator: "codex-tauri-native".into() }
    }

    #[test]
    fn cloud_routes_reject_unproven_fields_and_encode_cursor() {
        assert_eq!(resolve_cloud_route(&CloudOperation::List,
            &json!({"scope":"workspace","limit":100,"omitDraft":true,"cursor":"x&scope=user?#/中"})).unwrap(),
            "/v1/environment-configs?scope=workspace&limit=100&omitDraft=true&cursor=x%26scope%3Duser%3F%23%2F%E4%B8%AD");
        assert_eq!(resolve_cloud_route(&CloudOperation::Draft, &json!({"id":"a_B~-1","draftId":"draft_2"})).unwrap(),
            "/v1/environment-configs/a_B~-1/drafts/draft_2");
        for params in [
            json!({}), json!({"scope":"all","limit":100,"omitDraft":true}),
            json!({"scope":"user","limit":20,"omitDraft":true}),
            json!({"scope":"user","limit":100,"omitDraft":false}),
            json!({"scope":"user","limit":100,"omitDraft":true,"url":"https://other.invalid"}),
            json!({"scope":"user","limit":100,"omitDraft":true,"cursor":null}),
            json!({"scope":"user","limit":100,"omitDraft":true,"cursor":"a\r\nb"}),
        ] {
            assert_eq!(resolve_cloud_route(&CloudOperation::List, &params).unwrap_err().code, "invalid_request");
        }
        for id in ["", ".", "..", "a/b", "a.b", "a%2Fb", "中", "a?x", "a\nb"] {
            assert!(resolve_cloud_route(&CloudOperation::Detail, &json!({"id":id})).is_err());
            assert!(resolve_cloud_route(&CloudOperation::Draft, &json!({"id":"ok","draftId":id})).is_err());
        }
        assert!(serde_json::from_value::<CloudServiceRequest>(json!({
            "requestId":"x","operation":"list","params":{},"expectedIdentity":identity(),
            "profile":{"userAgent":"fake"}
        })).is_err());
        for operation in ["delete", "create", "fetch", "approve"] {
            assert!(serde_json::from_value::<CloudOperation>(json!(operation)).is_err());
        }
        assert_eq!(resolve_route(&ServiceOperation::GithubRepository, &json!({"id":"repo/a?b"})).unwrap(),
            "/backend-api/wham/github/repositories/repo%2Fa%3Fb");
        assert!(resolve_route(&ServiceOperation::GithubRepository, &json!({"id":"a","url":"x"})).is_err());
    }

    #[tokio::test]
    async fn cloud_reads_without_workspace_routing_and_with_host_only_headers() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[200]);
        let calls = AtomicUsize::new(0);
        let rpc = |method, params: Value| {
            assert_eq!(method, "getAuthStatus");
            assert_eq!(params, json!({"includeToken":true,"refreshToken":false}));
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(auth(&fixture_token())) }
        };
        assert_eq!(service.cloud_identity("identity", &rpc).await.unwrap(), identity());
        let response = service.cloud_read_with(cloud_request("read"), cloud_profile(), &rpc, &transport).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert!(!serde_json::to_string(&response).unwrap().contains(&fixture_token()));
        assert!(service.session.lock().await.credentials.is_none());
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests[0].url,
            "https://codex-cloud-backend.chatgpt.com/v1/environment-configs?scope=user&limit=100&omitDraft=true");
        let headers = &requests[0].headers;
        assert_eq!(headers.len(), 6);
        assert_eq!(headers["Content-Type"], "application/json");
        assert_eq!(headers["X-OpenAI-Product-Sku"], "codex");
        assert_eq!(headers["originator"], "codex-tauri-native");
        assert_eq!(headers["User-Agent"], cloud_profile().user_agent);
        assert_eq!(headers["ChatGPT-Account-Id"], "account-fixture");
        assert_eq!(headers["Authorization"], format!("Bearer {}", fixture_token()));
        assert!(!headers.contains_key("sec-ch-ua"));
        assert!(!headers.contains_key("X-OpenAI-Account-Routing-Override"));
        assert!(!headers.contains_key("X-OAI-IS"));
    }

    #[tokio::test]
    async fn cloud_access_grants_only_exact_personal_plans_with_stable_identity() {
        for (plan, expected) in [
            (json!("free"), "personal-plan-branch"),
            (json!("go"), "personal-plan-branch"),
            (json!("plus"), "personal-plan-branch"),
            (json!("prolite"), "personal-plan-branch"),
            (json!("pro"), "personal-plan-branch"),
            (json!("promax"), "personal-plan-branch"),
            (json!("team"), "incomplete"),
            (json!("business"), "incomplete"),
            (json!("enterprise"), "incomplete"),
            (json!("education"), "incomplete"),
            (json!("unknown"), "incomplete"),
            (json!("Plus"), "incomplete"),
            (json!("new-plan"), "incomplete"),
            (Value::Null, "incomplete"),
        ] {
            let service = ChatgptService::default();
            let calls = Mutex::new(Vec::new());
            let rpc = |method, params: Value| {
                calls.lock().unwrap().push(method);
                let plan = plan.clone();
                async move {
                    assert_eq!(params["refreshToken"], false);
                    Ok(if method == "getAuthStatus" {
                        auth(&fixture_token())
                    } else {
                        assert_eq!(method, "account/read");
                        json!({"account":{"type":"chatgpt","planType":plan}})
                    })
                }
            };
            let access = service.cloud_access("access", rpc).await.unwrap();
            assert_eq!(access.identity, identity());
            assert_eq!(access.gate_evidence, expected);
            assert_eq!(*calls.lock().unwrap(), vec!["getAuthStatus", "account/read", "getAuthStatus"]);
            let serialized = serde_json::to_value(&access).unwrap();
            assert_eq!(serialized["gateEvidence"], expected);
            assert!(!serialized.to_string().contains(&fixture_token()));
        }
    }

    #[tokio::test]
    async fn cloud_access_account_errors_and_switches_never_grant_access() {
        for (response, switch_token, expected) in [
            (Ok(json!({"account":{"type":"apikey","planType":"plus"}})), false, "not_logged_in"),
            (Ok(json!({"account":null})), false, "not_logged_in"),
            (Err("private-account-payload".to_owned()), false, "auth_unavailable"),
            (Ok(json!({"account":{"type":"chatgpt","planType":"pro"},
                "workspaceRouting":{"chatgptAccountId":"other-account"}})), false, "account_changed"),
            (Ok(json!({"account":{"type":"chatgpt","planType":"plus"}})), true, "account_changed"),
        ] {
            let service = ChatgptService::default();
            let auth_calls = AtomicUsize::new(0);
            let rpc = |method, _: Value| {
                let result = if method == "getAuthStatus" {
                    let index = auth_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(auth(&if switch_token && index > 0 {
                        token("other-account", "other-user", 4102444800)
                    } else { fixture_token() }))
                } else { response.clone() };
                async move { result }
            };
            let error = service.cloud_access("access", rpc).await.err().unwrap();
            assert_eq!(error.code, expected);
            assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        }
        let service = ChatgptService::default();
        let rpc = |method, _: Value| async move {
            Ok(if method == "getAuthStatus" { auth(&fixture_token()) } else {
                json!({"account":{"type":"chatgpt","planType":"pro"},
                    "workspaceRouting":{"chatgptAccountId":"account-fixture"}})
            })
        };
        assert_eq!(service.cloud_access("matching-routing", rpc).await.unwrap().gate_evidence, "personal-plan-branch");
    }

    #[tokio::test]
    async fn cloud_access_cancel_or_invalidation_discards_pending_account_read() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let entered = AtomicBool::new(false);
            let dropped = AtomicBool::new(false);
            let rpc = |method, _: Value| {
                let entered = &entered;
                let dropped = &dropped;
                async move {
                    if method == "account/read" {
                        let _drop = MarkDrop(dropped);
                        entered.store(true, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        Ok(json!({"account":{"type":"chatgpt","planType":"plus"}}))
                    } else { Ok(auth(&fixture_token())) }
                }
            };
            let access = service.cloud_access("access", rpc);
            let cancel_access = async {
                while !entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("access"); }
            };
            let (result, _) = tokio::join!(access, cancel_access);
            assert_eq!(result.err().unwrap().code, if invalidate { "account_changed" } else { "cancelled" });
            assert!(dropped.load(Ordering::SeqCst));
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn cloud_http_errors_never_refresh_replay_or_expose_payloads() {
        for (status, code) in [(401,"unauthorized"), (403,"forbidden"), (429,"rate_limited")] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[status]);
            let calls = AtomicUsize::new(0);
            let rpc = |method, params: Value| {
                assert_eq!(method, "getAuthStatus");
                assert_eq!(params["refreshToken"], false);
                calls.fetch_add(1, Ordering::SeqCst);
                async { Ok(auth(&fixture_token())) }
            };
            let error = service.cloud_read_with(cloud_request("read"), cloud_profile(), rpc, &transport).await.err().unwrap();
            assert_eq!(error.code, code);
            assert_eq!(error.status, Some(status));
            assert_eq!(calls.load(Ordering::SeqCst), 2);
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            assert!(!serde_json::to_string(&error).unwrap().contains(&fixture_token()));
        }
    }

    #[tokio::test]
    async fn cloud_authentication_failures_never_send_or_leak_credentials() {
        for (payload, code) in [
            (Ok(json!({"authMethod":"apikey","authToken":"private-api-key"})), "not_logged_in"),
            (Ok(json!({"authMethod":null,"authToken":null})), "not_logged_in"),
            (Ok(auth("private-malformed-token")), "invalid_auth"),
            (Ok(auth(&token("account-fixture", "user-fixture", 1))), "auth_expired"),
            (Err("private-auth-payload".to_owned()), "auth_unavailable"),
        ] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[]);
            let calls = AtomicUsize::new(0);
            let rpc = |_, params: Value| {
                assert_eq!(params["refreshToken"], false);
                calls.fetch_add(1, Ordering::SeqCst);
                let payload = payload.clone();
                async move { payload }
            };
            let error = service.cloud_read_with(cloud_request("read"), cloud_profile(), rpc, &transport).await.err().unwrap();
            assert_eq!(error.code, code);
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert!(transport.requests.lock().unwrap().is_empty());
            assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        }
    }

    #[test]
    fn cloud_fedramp_changes_only_header_and_rejects_host_profile_injection() {
        let credentials = CloudCredentials {
            token: fixture_token(), identity: identity(), fedramp: true,
        };
        let request = build_cloud_http_request("/v1/environment-configs/a", &credentials, &cloud_profile());
        assert_eq!(request.url, "https://codex-cloud-backend.chatgpt.com/v1/environment-configs/a");
        assert_eq!(request.headers["X-OpenAI-Fedramp"], "true");
        assert!(!request.headers.contains_key("X-OAI-IS"));
        for (user_agent, originator) in [("", "host"), ("host", ""), ("ua\r\nX-A: b", "host"), ("host", "host\nx")] {
            assert!(validate_cloud_profile(&CloudProfile {
                user_agent: user_agent.into(), originator: originator.into(),
            }).is_err());
        }
    }

    #[tokio::test]
    async fn cloud_account_change_before_and_after_http_discards_results() {
        for change_at in [0, 1] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[200]);
            let calls = AtomicUsize::new(0);
            let rpc = |_, _: Value| {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                async move { Ok(auth(&if index >= change_at {
                    token("other-account", "other-user", 4102444800)
                } else { fixture_token() })) }
            };
            let error = service.cloud_read_with(cloud_request("read"), cloud_profile(), rpc, &transport).await.err().unwrap();
            assert_eq!(error.code, "account_changed");
            assert_eq!(transport.requests.lock().unwrap().len(), change_at);
        }
    }

    #[tokio::test]
    async fn cloud_invalid_inputs_and_cancelled_requests_cannot_authenticate() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let calls = AtomicUsize::new(0);
        let rpc = |_, _: Value| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(Value::Null) }
        };
        let mut request = cloud_request("invalid");
        request.params["headers"] = json!({"Authorization":"fixture"});
        assert_eq!(service.cloud_read_with(request, cloud_profile(), &rpc, &transport).await.err().unwrap().code, "invalid_request");
        assert!(service.cancel("early"));
        assert_eq!(service.cloud_read_with(cloud_request("early"), cloud_profile(), &rpc, &transport).await.err().unwrap().code, "cancelled");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cloud_cancellation_and_generation_drop_pending_http() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut transport = FakeTransport::new(&[200]);
            transport.delay_ms = 2000;
            let rpc = |_, _: Value| async { Ok(auth(&fixture_token())) };
            let read = service.cloud_read_with(cloud_request("pending"), cloud_profile(), rpc, &transport);
            let cancel_read = async {
                while !transport.entered.load(Ordering::SeqCst) {
                    tokio::task::yield_now().await;
                }
                if invalidate { service.invalidate(); } else { service.cancel("pending"); }
            };
            let (result, _) = tokio::join!(read, cancel_read);
            assert_eq!(result.err().unwrap().code, if invalidate { "account_changed" } else { "cancelled" });
            assert!(transport.dropped.load(Ordering::SeqCst));
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn service_routes_are_fixed_and_segments_and_query_are_encoded() {
        assert_eq!(
            resolve_route(&ServiceOperation::ImagesInit, &json!({})).unwrap(),
            "/backend-api/images/init"
        );
        assert_eq!(
            resolve_route(&ServiceOperation::GptsDiscovery, &json!({})).unwrap(),
            "/public-api/gizmos/discovery"
        );
        let route = resolve_route(
            &ServiceOperation::GptsCategory,
            &json!({"id":"a/b?c#d%","q":"bad"}),
        );
        assert_eq!(route.unwrap_err().code, "invalid_request");
        assert_eq!(
            resolve_route(
                &ServiceOperation::GptsCategory,
                &json!({"id":"a/b?c#d%","cursor":"x&limit=900"})
            )
            .unwrap(),
            "/public-api/gizmos/discovery/a%2Fb%3Fc%23d%25?cursor=x%26limit%3D900"
        );
        assert!(resolve_route(&ServiceOperation::GptsDetail, &json!({"id":".."})).is_err());
        assert!(resolve_route(
            &ServiceOperation::ImagesInit,
            &json!({"url":"https://elsewhere.invalid"})
        )
        .is_err());
        assert!(resolve_route(&ServiceOperation::ImagesRecent, &json!({"limit":101})).is_err());
        assert!(resolve_route(
            &ServiceOperation::ImagesStyles,
            &json!({"include_image_suggestions":"true"})
        )
        .is_err());
        assert_eq!(
            resolve_route(&ServiceOperation::ImagesStyles, &json!({})).unwrap(),
            "/backend-api/images/styles?include_image_suggestions=true"
        );
        assert_eq!(
            resolve_route(
                &ServiceOperation::LibraryNodes,
                &json!({"categories":["image","document"]})
            )
            .unwrap(),
            "/backend-api/files/library/nodes?categories=image&categories=document"
        );
        assert!(validate_origin("https://chatgpt.com.evil.invalid").is_err());
        assert!(validate_origin("http://chatgpt.com").is_err());
        assert!(validate_origin("https://chatgpt.com/path").is_err());
        assert!(validate_origin("https://user:pass@chatgpt.com").is_err());
    }

    #[test]
    fn service_sites_read_routes_preserve_official_paths_and_pagination() {
        assert_eq!(
            resolve_route(&ServiceOperation::SitesAccess, &json!({})).unwrap(),
            "/backend-api/websites/access"
        );
        assert_eq!(
            resolve_route(
                &ServiceOperation::SitesList,
                &json!({"limit":20,"include_editable":false})
            )
            .unwrap(),
            "/backend-api/websites?include_editable=false&limit=20"
        );
        assert_eq!(
            resolve_route(
                &ServiceOperation::SitesList,
                &json!({"limit":20,"include_editable":true,"after":"sites-shared-projects:"})
            )
            .unwrap(),
            "/backend-api/websites?after=sites-shared-projects%3A&include_editable=true&limit=20"
        );
        assert_eq!(
            resolve_route(
                &ServiceOperation::SitesShared,
                &json!({"limit":20,"query":"中文 & after=evil","after":"cursor?x#y"})
            )
            .unwrap(),
            "/backend-api/websites/shared?after=cursor%3Fx%23y&limit=20&query=%E4%B8%AD%E6%96%87+%26+after%3Devil"
        );
        assert_eq!(
            resolve_route(&ServiceOperation::SitesShared, &json!({"limit":20})).unwrap(),
            "/backend-api/websites/shared?limit=20"
        );
        for (operation, suffix) in [
            (ServiceOperation::SitesDetail, ""),
            (ServiceOperation::SitesEnvironment, "/environment"),
            (ServiceOperation::SitesDomains, "/custom_domains"),
            (ServiceOperation::SitesShareAccess, "/share_access"),
        ] {
            assert_eq!(
                resolve_route(&operation, &json!({"id":"site/a?b#c%"})).unwrap(),
                format!("/backend-api/websites/site%2Fa%3Fb%23c%25{suffix}")
            );
        }
    }

    #[test]
    fn service_sites_reject_unproven_parameters_and_path_injection() {
        for params in [
            json!({"url":"https://other.invalid"}),
            json!({"method":"DELETE"}),
            json!({"headers":{"Authorization":"fixture"}}),
            json!({"include_editable":"true"}),
            json!({"limit":0}),
            json!({"limit":101}),
            json!({"after":null}),
            json!({"after":"cursor\r\nX-Injected: true"}),
            json!({"query":"not-an-owned-server-search"}),
        ] {
            assert_eq!(
                resolve_route(&ServiceOperation::SitesList, &params)
                    .unwrap_err()
                    .code,
                "invalid_request"
            );
        }
        assert!(resolve_route(
            &ServiceOperation::SitesShared,
            &json!({"include_editable":true})
        )
        .is_err());
        assert!(resolve_route(&ServiceOperation::SitesAccess, &json!({"limit":20})).is_err());
        for operation in [
            ServiceOperation::SitesDetail,
            ServiceOperation::SitesEnvironment,
            ServiceOperation::SitesDomains,
            ServiceOperation::SitesShareAccess,
        ] {
            for params in [
                json!({}),
                json!({"id":""}),
                json!({"id":".."}),
                json!({"id":"."}),
                json!({"id":"site\nid"}),
                json!({"id":123}),
                json!({"id":"site","hostname":"fake.invalid"}),
                json!({"id":"site","remove":["SECRET"]}),
                json!({"id":"site","access_mode":"public"}),
            ] {
                assert!(resolve_route(&operation, &params).is_err());
            }
        }
        for name in [
            "sites_create",
            "sites_delete",
            "sites_publish",
            "sites_update_environment",
            "sites_update_share_access",
            "http_fetch",
        ] {
            assert!(serde_json::from_value::<ServiceOperation>(json!(name)).is_err());
        }
        for name in [
            "sites_access",
            "sites_list",
            "sites_shared",
            "sites_detail",
            "sites_environment",
            "sites_domains",
            "sites_share_access",
        ] {
            assert!(serde_json::from_value::<ServiceOperation>(json!(name)).is_ok());
        }
    }

    #[test]
    fn service_integrity_accepts_only_exact_format_and_compare_and_set() {
        let first = "ois1.a.b.c".to_owned();
        let second = "ois1.d.e.f".to_owned();
        let mut state = None;
        assert!(apply_integrity(&mut state, None, Some(&first)));
        assert!(!apply_integrity(&mut state, None, Some(&second)));
        assert_eq!(state.as_deref(), Some(first.as_str()));
        assert!(apply_integrity(&mut state, Some(&first), Some(&second)));
        for value in [
            "ois1.a.b",
            "ois1.a.b.c.d",
            "ois1.a..c",
            " ois1.a.b.c",
            "ois1.a.b.c\n",
            "1",
            "ois1.a.b.é",
        ] {
            assert!(!valid_integrity(value), "{value:?}");
        }
        assert!(!valid_integrity(&format!("ois1.{}.b.c", "a".repeat(2048))));
    }

    #[test]
    fn service_auth_claims_and_header_config_reject_injection() {
        let malformed = format!("fixture.{}.signature", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            br#"{"exp":4102444800,"https://api.openai.com/auth":{"chatgpt_account_id":"a","user_id":"u","chatgpt_account_is_fedramp":"true"}}"#
        ));
        assert!(parse_token(&malformed).is_err());
        assert!(parse_token("fixture.invalid.signature").is_err());
        assert!(parse_token("abc\r\nAuthorization: xyz").is_err());
        let request = HttpRequest {
            url: "https://chatgpt.com/backend-api/images/init".into(),
            headers: BTreeMap::from([("Authorization".into(), "Bearer fixture".into())]),
            method: HttpMethod::Get,
            body: Vec::new(),
        };
        let config = curl_config(&request).unwrap();
        assert!(config.contains("header = \"Authorization: Bearer fixture\"\n"));
        let injected = HttpRequest {
            url: request.url,
            headers: BTreeMap::from([(
                "Authorization".into(),
                "a\nurl = \"https://evil.invalid\"".into(),
            )]),
            method: HttpMethod::Get,
            body: Vec::new(),
        };
        assert!(curl_config(&injected).is_err());
    }

    #[test]
    fn service_response_parser_separates_failure_and_exposes_only_allowed_headers() {
        let response = parse_http(b"HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: secret\r\nAuthorization: secret\r\nX-Request-Id: fixture-id\r\n\r\n{\"items\":[]}").unwrap();
        let decoded = decode_response(response, "fixture".into(), identity()).unwrap();
        assert_eq!(decoded.body, json!({"items":[]}));
        assert_eq!(decoded.headers.len(), 2);
        assert!(!serde_json::to_string(&decoded).unwrap().contains("secret"));
        for (status, code) in [
            (401, "unauthorized"),
            (403, "forbidden"),
            (404, "not_found"),
            (429, "rate_limited"),
            (302, "redirect_rejected"),
            (500, "service_error"),
        ] {
            let error = decode_response(
                HttpResponse {
                    status,
                    headers: BTreeMap::new(),
                    body: b"private upstream message".to_vec(),
                },
                "fixture".into(),
                identity(),
            )
            .err()
            .unwrap();
            assert_eq!(error.code, code);
            assert_eq!(error.status, Some(status));
            assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        }
        assert_eq!(
            decode_response(
                HttpResponse {
                    status: 200,
                    headers: BTreeMap::new(),
                    body: b"not-json".to_vec()
                },
                "x".into(),
                identity()
            )
            .err()
            .unwrap()
            .code,
            "invalid_response"
        );
    }

    #[tokio::test]
    async fn service_401_refreshes_once_without_exposing_credentials() {
        let service = ChatgptService::default();
        let refreshes = AtomicUsize::new(0);
        let calls = AtomicUsize::new(0);
        let transport = FakeTransport::new(&[401, 200]);
        let rpc = |method, params: Value| {
            calls.fetch_add(1, Ordering::SeqCst);
            if params["refreshToken"] == true {
                refreshes.fetch_add(1, Ordering::SeqCst);
            }
            async move {
                Ok(if method == "getAuthStatus" {
                    auth(&fixture_token())
                } else {
                    account()
                })
            }
        };
        let response = service
            .read_with(request("fixture"), rpc, &transport)
            .await
            .unwrap();
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        assert_eq!(transport.requests.lock().unwrap().len(), 2);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests[0].headers["ChatGPT-Account-Id"], "account-fixture");
        assert_eq!(
            requests[0].headers["Authorization"],
            format!("Bearer {}", fixture_token())
        );
        assert!(!requests[0].headers.contains_key("X-OAI-IS"));
        assert!(!requests[0].headers.contains_key("X-OpenAI-Attach-Auth"));
        assert!(!requests[0]
            .headers
            .contains_key("X-OpenAI-Attach-Integrity-State"));
        assert!(!serde_json::to_string(&response)
            .unwrap()
            .contains(&fixture_token()));
    }

    #[tokio::test]
    async fn service_second_401_and_other_failures_do_not_loop() {
        for statuses in [&[401, 401][..], &[403][..], &[429][..]] {
            let service = ChatgptService::default();
            let refreshes = AtomicUsize::new(0);
            let transport = FakeTransport::new(statuses);
            let rpc = |method, params: Value| {
                if params["refreshToken"] == true {
                    refreshes.fetch_add(1, Ordering::SeqCst);
                }
                async move {
                    Ok(if method == "getAuthStatus" {
                        auth(&fixture_token())
                    } else {
                        account()
                    })
                }
            };
            let error = service
                .read_with(request("fixture"), rpc, &transport)
                .await
                .err()
                .unwrap();
            assert_eq!(error.status, statuses.last().copied());
            assert_eq!(transport.requests.lock().unwrap().len(), statuses.len());
            assert_eq!(
                refreshes.load(Ordering::SeqCst),
                usize::from(statuses.len() == 2)
            );
        }
    }

    #[tokio::test]
    async fn service_mismatch_logged_out_and_rpc_errors_never_send_http() {
        for scenario in ["logged_out", "api_key", "rpc_error", "routing", "user"] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[]);
            let rpc = |method, _: Value| async move {
                match (scenario, method) {
                    ("rpc_error", _) => Err("private auth payload fixture".into()),
                    ("logged_out", "getAuthStatus") => {
                        Ok(json!({"authMethod":null,"authToken":null}))
                    }
                    ("api_key", "getAuthStatus") => {
                        Ok(json!({"authMethod":"apikey","authToken":"private"}))
                    }
                    ("user", "getAuthStatus") => {
                        Ok(auth(&token("account-fixture", "other-user", 4102444800)))
                    }
                    (_, "getAuthStatus") => Ok(auth(&fixture_token())),
                    ("routing", _) => Ok(
                        json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com","chatgptAccountId":"another","accountRoutingOverride":"NO_CONSTRAINT"}}),
                    ),
                    _ => Ok(account()),
                }
            };
            let error = service
                .read_with(request("fixture"), rpc, &transport)
                .await
                .err()
                .unwrap();
            assert!(!serde_json::to_string(&error).unwrap().contains("private"));
            assert_eq!(transport.requests.lock().unwrap().len(), 0);
        }
    }

    #[tokio::test]
    async fn service_cancel_and_account_generation_discard_late_http_and_release_registry() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut transport = FakeTransport::new(&[200]);
            transport.delay_ms = 2000;
            let rpc = |method, _: Value| async move {
                Ok(if method == "getAuthStatus" {
                    auth(&fixture_token())
                } else {
                    account()
                })
            };
            let run = service.read_with(request("fixture"), rpc, &transport);
            let cancel = async {
                while !transport.entered.load(Ordering::SeqCst) {
                    tokio::task::yield_now().await;
                }
                if invalidate {
                    service.invalidate();
                } else {
                    assert!(service.cancel("fixture"));
                }
            };
            let (result, _) = tokio::join!(run, cancel);
            assert_eq!(
                result.err().unwrap().code,
                if invalidate {
                    "account_changed"
                } else {
                    "cancelled"
                }
            );
            assert!(transport.dropped.load(Ordering::SeqCst));
            assert!(service.active.lock().unwrap().is_empty());
            if invalidate {
                assert!(service.session.lock().await.credentials.is_none());
            }
        }
    }

    #[tokio::test]
    async fn service_cancel_while_queued_cannot_start_http_or_auth() {
        let service = ChatgptService::default();
        let guard = service.session.lock().await;
        let transport = FakeTransport::new(&[]);
        let calls = AtomicUsize::new(0);
        let rpc = |_, _: Value| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(Value::Null) }
        };
        let run = service.read_with(request("queued"), rpc, &transport);
        let cancel = async {
            while !service.active.lock().unwrap().contains_key("queued") {
                tokio::task::yield_now().await;
            }
            assert!(service.cancel("queued"));
        };
        let (result, _) = tokio::join!(run, cancel);
        assert_eq!(result.err().unwrap().code, "cancelled");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        drop(guard);
    }

    #[tokio::test]
    async fn service_identity_returns_only_public_identity_and_refresh_serializes() {
        let service = ChatgptService::default();
        let calls = AtomicUsize::new(0);
        let rpc = |method, _: Value| {
            calls.fetch_add(1, Ordering::SeqCst);
            async move {
                Ok(if method == "getAuthStatus" {
                    auth(&fixture_token())
                } else {
                    account()
                })
            }
        };
        let (one, two) = tokio::join!(service.identity("one", &rpc), service.identity("two", &rpc));
        assert_eq!(one.unwrap(), identity());
        assert_eq!(two.unwrap(), identity());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(!serde_json::to_string(&identity())
            .unwrap()
            .contains("token"));
    }

    #[tokio::test]
    async fn service_http_timeout_drops_transport_and_does_not_decode_success() {
        let mut transport = FakeTransport::new(&[200]);
        transport.delay_ms = 2000;
        let error = send_bounded(
            &transport,
            HttpRequest {
                url: "https://chatgpt.com/backend-api/images/init".into(),
                headers: BTreeMap::new(),
                method: HttpMethod::Get,
                body: Vec::new(),
            },
            Arc::new(AtomicBool::new(false)),
            Duration::from_millis(1),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.code, "timeout");
        assert!(transport.dropped.load(Ordering::SeqCst));
        assert_eq!(transport.responses.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn service_cancel_before_registration_cannot_start_auth_or_http() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let calls = AtomicUsize::new(0);
        let rpc = |_, _: Value| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(Value::Null) }
        };
        assert!(service.cancel("early"));
        let result = service.read_with(request("early"), rpc, &transport).await;
        assert_eq!(result.err().unwrap().code, "cancelled");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn service_routing_origin_and_override_preserve_public_api_and_valid_integrity() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[200]);
        let rpc = |method, _: Value| async move {
            if method == "getAuthStatus" {
                Ok(auth(&fixture_token()))
            } else {
                Ok(json!({"account":{"type":"chatgpt"},"workspaceRouting":{
                    "backendOrigin":"https://gov.chatgpt.com","chatgptAccountId":"account-fixture","accountRoutingOverride":"us"
                }}))
            }
        };
        let mut req = request("fixture");
        req.operation = ServiceOperation::GptsDiscovery;
        service.read_with(req, rpc, &transport).await.unwrap();
        let requests = transport.requests.lock().unwrap();
        assert_eq!(
            requests[0].url,
            "https://gov.chatgpt.com/public-api/gizmos/discovery"
        );
        assert_eq!(
            requests[0].headers["X-OpenAI-Account-Routing-Override"],
            "us"
        );
        assert_eq!(requests[0].headers["originator"], "Codex Browser");
        assert_eq!(requests[0].headers["OAI-Language"], "zh-CN");
        assert!(!requests[0].headers.contains_key("X-OpenAI-Fedramp"));
        assert!(!requests[0]
            .headers
            .contains_key("X-OpenAI-Attach-Desktop-Surface"));
    }

    fn share_request(id: &str) -> SharePrepareRequest {
        SharePrepareRequest {
            request_id: id.into(), expected_identity: identity(), profile: request("unused").profile,
            host_id: "local".into(), thread_id: "thread-fixture".into(),
            snapshot: r#"{"version":1,"title":"共享","turns":[{"items":[{"type":"userMessage","content":[{"type":"text","text":"hello"}]}]}]}"#.into(),
            assets: Vec::new(),
        }
    }

    fn publish_request(id: &str, preparation_id: &str) -> SharePublishRequest {
        SharePublishRequest {
            request_id: id.into(), expected_identity: identity(), profile: request("unused").profile,
            host_id: "local".into(), thread_id: "thread-fixture".into(),
            preparation_id: preparation_id.into(), access: ShareAccess::Public, principals: Vec::new(),
        }
    }

    fn share_rpc(method: &'static str, _: Value) -> std::future::Ready<Result<Value, String>> {
        std::future::ready(match method {
            "getAuthStatus" => Ok(auth(&fixture_token())),
            "account/read" => Ok(account()),
            "configRequirements/read" => Ok(json!({"requirements":null})),
            _ => Err("unexpected fixture RPC".into()),
        })
    }

    fn instructions_request(id: &str) -> AccountInstructionsRequest {
        AccountInstructionsRequest { request_id:id.into(), expected_identity:identity(), profile:request("unused").profile }
    }

    fn instructions_transport(statuses: &[u16], bodies: &[Value]) -> FakeTransport {
        let transport = FakeTransport::new(statuses);
        for (response, body) in transport.responses.lock().unwrap().iter_mut().zip(bodies) {
            response.body = serde_json::to_vec(body).unwrap();
        }
        transport
    }

    #[tokio::test]
    async fn account_instructions_fixed_read_and_null_empty_values_do_not_expose_other_settings() {
        for (body, expected) in [
            (json!({"custom_instructions":"真实 fixture 指令\nnext","unrelated":"private fixture"}), "真实 fixture 指令\nnext"),
            (json!({"custom_instructions":null}), ""),
            (json!({"unrelated":true}), ""),
        ] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[200], &[body]);
            let result = service.account_instructions_with(instructions_request("instructions-read"), None, share_rpc, &transport).await.unwrap();
            assert_eq!(result.contents, expected);
            assert_eq!(result.identity, identity());
            let public = serde_json::to_string(&result).unwrap();
            assert!(!public.contains("private fixture"));
            assert!(!public.contains(&fixture_token()));
            let requests = transport.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(requests[0].method, HttpMethod::Get);
            assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/wham/settings/user");
            assert_eq!(requests[0].headers["ChatGPT-Account-Id"], "account-fixture");
        }
        for body in [json!([]), json!({"custom_instructions":17}), json!({"custom_instructions":{}})] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[200], &[body]);
            assert_eq!(service.account_instructions_with(instructions_request("instructions-bad-read"), None, share_rpc, &transport).await.err().unwrap().code, "invalid_response");
        }
    }

    #[tokio::test]
    async fn account_instructions_patch_is_one_field_once_then_identity_bound_readback() {
        for contents in ["", "中文 fixture instructions\nkeep trailing newline\n"] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[204, 200], &[Value::Null, json!({"custom_instructions":contents,"ignored":true})]);
            transport.responses.lock().unwrap()[0].body.clear();
            let result = service.account_instructions_with(instructions_request("instructions-write"), Some(contents.into()), share_rpc, &transport).await.unwrap();
            assert_eq!(result.contents, contents);
            let requests = transport.requests.lock().unwrap();
            assert_eq!(requests.len(), 2);
            assert_eq!(requests[0].method, HttpMethod::Patch);
            assert_eq!(requests[1].method, HttpMethod::Get);
            assert_eq!(requests[0].url, requests[1].url);
            assert_eq!(requests[0].headers["Content-Type"], "application/json");
            assert_eq!(serde_json::from_slice::<Value>(&requests[0].body).unwrap(), json!({"custom_instructions":contents}));
            assert_eq!(requests[1].headers["ChatGPT-Account-Id"], "account-fixture");
        }
        assert!(serde_json::from_value::<AccountInstructionsWriteRequest>(json!({
            "requestId":"unknown-key","expectedIdentity":identity(),"profile":{
                "language":"zh-CN","deviceId":"fixture","userAgent":"Chrome/140.0.0.0","userAgentClientHints":"fixture","platformClientHint":"fixture"},
            "contents":"fixture","url":"https://example.test/","communication_guide":"injected"
        })).is_err());
    }

    #[tokio::test]
    async fn account_instructions_patch_refreshes_explicit_401_once_but_other_failures_never_replay() {
        for (status, code) in [(401,"unauthorized"), (403,"forbidden"), (409,"conflict"), (429,"rate_limited"), (500,"instructions_write_unknown")] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(if status == 401 { &[401,401] } else { std::slice::from_ref(&status) });
            let refreshes = AtomicUsize::new(0);
            let rpc = |method, params: Value| {
                if params["refreshToken"] == true { refreshes.fetch_add(1, Ordering::SeqCst); }
                share_rpc(method, params)
            };
            let error = service.account_instructions_with(instructions_request("instructions-error"), Some("fixture".into()), rpc, &transport).await.err().unwrap();
            assert_eq!(error.code, code);
            assert_eq!(transport.requests.lock().unwrap().len(), if status == 401 {2} else {1});
            assert_eq!(refreshes.load(Ordering::SeqCst), if status == 401 {1} else {0});
        }
        let service = ChatgptService::default();
        let transport = instructions_transport(&[200,401,200], &[json!({}),json!({}),json!({"custom_instructions":"confirmed"})]);
        let refreshes = AtomicUsize::new(0);
        let rpc = |method, params: Value| {
            if params["refreshToken"] == true { refreshes.fetch_add(1, Ordering::SeqCst); }
            share_rpc(method, params)
        };
        let result = service.account_instructions_with(instructions_request("instructions-read-refresh"), Some("confirmed".into()), rpc, &transport).await.unwrap();
        assert_eq!(result.contents, "confirmed");
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.iter().filter(|request| request.method == HttpMethod::Patch).count(), 1);
        assert_eq!(requests.iter().filter(|request| request.method == HttpMethod::Get).count(), 2);
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn account_instructions_patch_401_same_identity_replays_same_body_but_changed_identity_cannot() {
        let service = ChatgptService::default();
        let transport = instructions_transport(&[401,200,200], &[json!({}),json!({}),json!({"custom_instructions":"fixture"})]);
        let refreshes = AtomicUsize::new(0);
        let rpc = |method, params: Value| {
            if params["refreshToken"] == true { refreshes.fetch_add(1, Ordering::SeqCst); }
            share_rpc(method, params)
        };
        let result = service.account_instructions_with(instructions_request("instructions-patch-refresh"), Some("fixture".into()), rpc, &transport).await.unwrap();
        assert_eq!(result.contents, "fixture");
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].method, HttpMethod::Patch);
        assert_eq!(requests[1].method, HttpMethod::Patch);
        assert_eq!(requests[0].url, requests[1].url);
        assert_eq!(requests[0].body, requests[1].body);
        drop(requests);

        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[401]);
        let refreshed = AtomicBool::new(false);
        let rpc = |method, params: Value| {
            if params["refreshToken"] == true { refreshed.store(true, Ordering::SeqCst); }
            let changed = refreshed.load(Ordering::SeqCst);
            if changed && method == "getAuthStatus" {
                return std::future::ready(Ok(auth(&token("another-account", "user-fixture", u64::MAX / 2))));
            }
            if changed && method == "account/read" {
                return std::future::ready(Ok(json!({"account":{"type":"chatgpt"},"workspaceRouting":{
                    "backendOrigin":"https://chatgpt.com","chatgptAccountId":"another-account","accountRoutingOverride":"NO_CONSTRAINT"
                }})));
            }
            share_rpc(method, params)
        };
        let error = service.account_instructions_with(instructions_request("instructions-patch-account-changed"), Some("fixture".into()), rpc, &transport).await.err().unwrap();
        assert_eq!(error.code, "account_changed");
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn account_instructions_workspace_ip_refusal_never_refreshes_or_replays() {
        for error in [
            json!({"type":"ip_not_authorized"}),
            json!({"code":"ip_not_authorized"}),
            json!({"code":"validate_whitelist_failed"}),
            json!({"code":"workspace_ip_not_authorized"}),
        ] {
            for contents in [None, Some("fixture".to_owned())] {
                let service = ChatgptService::default();
                let transport = instructions_transport(&[401], &[json!({"error":error})]);
                let refreshes = AtomicUsize::new(0);
                let rpc = |method, params: Value| {
                    if params["refreshToken"] == true { refreshes.fetch_add(1, Ordering::SeqCst); }
                    share_rpc(method, params)
                };
                let result = service.account_instructions_with(instructions_request("instructions-ip-denied"), contents, rpc, &transport).await;
                assert_eq!(result.err().unwrap().code, "ip_not_authorized");
                assert_eq!(refreshes.load(Ordering::SeqCst), 0);
                assert_eq!(transport.requests.lock().unwrap().len(), 1);
            }
        }
    }

    #[tokio::test]
    async fn account_instructions_unconfirmed_readback_is_not_success_or_automatic_rewrite() {
        for (status, body, code) in [
            (200, json!({"custom_instructions":"another window"}), "instructions_readback_mismatch"),
            (200, json!({"custom_instructions":17}), "instructions_readback_failed"),
            (403, json!({}), "instructions_readback_failed"),
        ] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[200,status], &[json!({}),body]);
            let error = service.account_instructions_with(instructions_request("instructions-mismatch"), Some("requested".into()), share_rpc, &transport).await.err().unwrap();
            assert_eq!(error.code, code);
            assert_eq!(transport.requests.lock().unwrap().len(), 2);
        }
        struct FailedTransport(AtomicUsize);
        impl Transport for FailedTransport {
            fn send(&self, _: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Err(failure("transport_error", "fixture transport failure")) })
            }
        }
        let service = ChatgptService::default();
        let transport = FailedTransport(AtomicUsize::new(0));
        assert_eq!(service.account_instructions_with(instructions_request("instructions-network"), Some("fixture".into()), share_rpc, &transport).await.err().unwrap().code, "instructions_write_unknown");
        assert_eq!(transport.0.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn account_instructions_invalid_identity_oversize_and_pre_cancel_cannot_send() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let rpc_calls = AtomicUsize::new(0);
        let rpc = |method, params| { rpc_calls.fetch_add(1, Ordering::SeqCst); share_rpc(method, params) };
        let mut wrong = instructions_request("instructions-wrong");
        wrong.expected_identity.generation += 1;
        assert_eq!(service.account_instructions_with(wrong, None, &rpc, &transport).await.err().unwrap().code, "account_changed");
        assert_eq!(service.account_instructions_with(instructions_request("instructions-large"), Some("x".repeat(256*1024)), &rpc, &transport).await.err().unwrap().code, "invalid_request");
        service.cancel("instructions-cancelled");
        assert_eq!(service.account_instructions_with(instructions_request("instructions-cancelled"), Some("fixture".into()), &rpc, &transport).await.err().unwrap().code, "cancelled");
        assert_eq!(rpc_calls.load(Ordering::SeqCst), 0);
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn account_instructions_pending_cancel_and_account_switch_discard_late_results() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut transport = instructions_transport(&[200,200], &[json!({}),json!({"custom_instructions":"fixture"})]);
            transport.delay_ms = 100;
            let result = {
                let read = service.account_instructions_with(instructions_request("instructions-pending"), Some("fixture".into()), share_rpc, &transport);
                let change = async {
                    while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                    if invalidate { service.invalidate(); } else { service.cancel("instructions-pending"); }
                };
                tokio::join!(read, change).0
            };
            assert_eq!(result.err().unwrap().code, if invalidate { "account_changed" } else { "cancelled" });
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    fn bootstrap_request(id: &str) -> ShareAccessRequest {
        ShareAccessRequest { request_id:id.into(), expected_identity:identity(), profile:request("unused").profile }
    }

    fn bootstrap_context() -> ShareBootstrapContext {
        ShareBootstrapContext {
            app_session_id:"host-session-fixture".into(), app_version:"0.1.0-fixture".into(),
            brand_name:"CodexNative fixture".into(), build_flavor:"development".into(),
            system_name:"Windows".into(), system_version:"10.0-fixture".into(),
            window_type:"tauri".into(),
        }
    }

    #[tokio::test]
    async fn share_bootstrap_uses_only_host_context_and_fixed_single_post() {
        let service = ChatgptService::default();
        let payload = r#"{"user":{"userID":"user-fixture","customIDs":{"account_id":"account-fixture"}}}"#;
        let transport = share_transport(vec![(200, json!({"statsigPayload":payload,"extra_private_field":"not exposed"}))]);
        let result = service.share_access_bootstrap_with(bootstrap_request("bootstrap"), bootstrap_context(), share_rpc, &transport).await.unwrap();
        assert_eq!(result, json!({"statsigPayload":payload}));
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, HttpMethod::Post);
        assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/wham/statsig/bootstrap");
        assert_eq!(serde_json::from_slice::<Value>(&requests[0].body).unwrap(), json!({
            "app_session_id":"host-session-fixture","app_version":"0.1.0-fixture",
            "brand_name":"CodexNative fixture","build_flavor":"development",
            "system_name":"Windows","system_version":"10.0-fixture","window_type":"tauri",
            "locale":"zh-CN","stable_id":"fixture-device",
        }));
        assert!(requests[0].headers.contains_key("Authorization"));
        assert!(serde_json::from_value::<ShareAccessRequest>(json!({
            "requestId":"renderer-context","expectedIdentity":identity(),
            "profile":{"language":"zh-CN","deviceId":"fixture","userAgent":"Chrome/140",
                "userAgentClientHints":"Chromium","platformClientHint":"Windows"},
            "context":{"brand_name":"OpenAI"}
        })).is_err());
    }

    #[tokio::test]
    async fn share_bootstrap_identity_cancel_context_and_response_validation_fail_closed() {
        let service = ChatgptService::default();
        let transport = share_transport(vec![(401, json!({"secret":"not exposed"})), (200, json!({"statsigPayload":false}))]);
        let mut wrong = bootstrap_request("wrong-bootstrap");
        wrong.expected_identity.account_id = "other".into();
        assert_eq!(service.share_access_bootstrap_with(wrong, bootstrap_context(), share_rpc, &transport).await.err().unwrap().code, "account_changed");
        service.cancel("cancel-bootstrap");
        assert_eq!(service.share_access_bootstrap_with(bootstrap_request("cancel-bootstrap"), bootstrap_context(), share_rpc, &transport).await.err().unwrap().code, "cancelled");
        let mut context = bootstrap_context();
        context.brand_name = "invalid\ncontext".into();
        assert_eq!(service.share_access_bootstrap_with(bootstrap_request("bad-context"), context, share_rpc, &transport).await.err().unwrap().code, "invalid_request");
        assert!(transport.requests.lock().unwrap().is_empty());
        let error = service.share_access_bootstrap_with(bootstrap_request("unauthorized-bootstrap"), bootstrap_context(), share_rpc, &transport).await.err().unwrap();
        assert_eq!(error.code, "unauthorized");
        assert!(!serde_json::to_string(&error).unwrap().contains("not exposed"));
        assert_eq!(transport.requests.lock().unwrap().len(), 1); // no GET-style 401 replay.
        assert_eq!(service.share_access_bootstrap_with(bootstrap_request("bad-response"), bootstrap_context(), share_rpc, &transport).await.err().unwrap().code, "invalid_response");
    }

    #[tokio::test]
    async fn share_bootstrap_late_response_is_discarded_after_cancel_or_identity_change() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut transport = share_transport(vec![(200, json!({"statsigPayload":"late payload"}))]);
            transport.delay_ms = 2000;
            let bootstrap = service.share_access_bootstrap_with(bootstrap_request("pending-bootstrap"), bootstrap_context(), share_rpc, &transport);
            let interrupt = async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("pending-bootstrap"); }
            };
            let (result, _) = tokio::join!(bootstrap, interrupt);
            assert_eq!(result.err().unwrap().code, if invalidate { "account_changed" } else { "cancelled" });
            assert_eq!(transport.responses.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn share_recipient_reads_use_fixed_identity_bound_routes_and_get_transport() {
        for (operation, params, path) in [
            (ServiceOperation::ShareAccounts, json!({}), "/backend-api/wham/accounts/check"),
            (ServiceOperation::ShareUsers, json!({"query":"  user+中@example.test  "}),
                "/backend-api/accounts/account-fixture/users?limit=10&offset=0&query=user%2B%E4%B8%AD%40example.test&include_profile_photos=false"),
            (ServiceOperation::ShareGroups, json!({"query":"  group &?#  "}),
                "/backend-api/accounts/account-fixture/groups?limit=10&offset=0&query=group+%26%3F%23&include_member_counts=false&include_total=false"),
        ] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[200]);
            let mut request = request("share-read");
            request.operation = operation;
            request.params = params;
            service.read_with(request, share_rpc, &transport).await.unwrap();
            let requests = transport.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(requests[0].method, HttpMethod::Get);
            assert_eq!(requests[0].url, format!("https://chatgpt.com{path}"));
            assert!(requests[0].body.is_empty());
        }
        let mut account = identity();
        account.account_id = "bound/account?x".into();
        assert_eq!(resolve_read_route(&ServiceOperation::ShareUsers, &json!({"query":"x"}), &account).unwrap(),
            "/backend-api/accounts/bound%2Faccount%3Fx/users?limit=10&offset=0&query=x&include_profile_photos=false");
    }

    #[tokio::test]
    async fn share_recipient_invalid_parameters_cannot_authenticate_or_override_account() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let calls = AtomicUsize::new(0);
        let rpc = |_, _: Value| {
            calls.fetch_add(1, Ordering::SeqCst);
            std::future::ready(Err("must not authenticate".into()))
        };
        for operation in [ServiceOperation::ShareUsers, ServiceOperation::ShareGroups] {
            for params in [
                json!({}), json!({"query":""}), json!({"query":" \t "}), json!({"query":null}),
                json!({"query":"x\nhidden"}), json!({"query":"a".repeat(513)}),
                json!({"query":"x","accountId":"other"}), json!({"query":"x","account_id":"other"}),
                json!({"query":"x","limit":20}), json!({"query":"x","offset":10}),
                json!({"query":"x","url":"https://other.example"}), json!([]),
            ] {
                let mut request = request("invalid-share-read");
                request.operation = operation.clone();
                request.params = params;
                assert_eq!(service.read_with(request, rpc, &transport).await.err().unwrap().code, "invalid_request");
            }
        }
        for params in [json!({"query":"x"}), json!({"accountId":"other"}), json!(null)] {
            let mut request = request("invalid-share-accounts");
            request.operation = ServiceOperation::ShareAccounts;
            request.params = params;
            assert_eq!(service.read_with(request, rpc, &transport).await.err().unwrap().code, "invalid_request");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn share_recipient_reads_reject_cancelled_and_other_account_requests() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let mut req = request("cancelled-recipient");
        req.operation = ServiceOperation::ShareUsers;
        req.params = json!({"query":"user"});
        service.cancel("cancelled-recipient");
        assert_eq!(service.read_with(req, share_rpc, &transport).await.err().unwrap().code, "cancelled");
        let mut req = request("other-recipient");
        req.operation = ServiceOperation::ShareGroups;
        req.params = json!({"query":"group"});
        req.expected_identity.account_id = "other-account".into();
        assert_eq!(service.read_with(req, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    fn url_safe_request(id: &str) -> ShareUrlSafeRequest {
        ShareUrlSafeRequest {
            request_id:id.into(), expected_identity:identity(), profile:request("unused").profile,
            url:"https://images.example/private?a=fixture".into(),
        }
    }

    #[tokio::test]
    async fn share_url_safety_is_fixed_authenticated_and_only_strict_true_passes() {
        for body in [json!({"safe":true}), json!({"safe":false}), json!({"safe":"true"}), json!({"safe":1}), json!({})] {
            let service = ChatgptService::default();
            let transport = share_transport(vec![(200, body.clone())]);
            let result = service.share_url_safe_with(url_safe_request("safe"), share_rpc, &transport).await.unwrap();
            assert_eq!(result, body.get("safe") == Some(&json!(true)));
            let requests = transport.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(requests[0].method, HttpMethod::Post);
            assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/ecosystem/url_safe");
            assert_eq!(serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
                json!({"resolved_pineapple_uri":null,"url":"https://images.example/private?a=fixture"}));
            assert!(requests[0].headers.contains_key("Authorization"));
        }
    }

    #[tokio::test]
    async fn share_url_safety_respects_policy_cancellation_and_identity() {
        let service = ChatgptService::default();
        let transport = share_transport(vec![]);
        let denied = |method, params| {
            if method == "configRequirements/read" {
                std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))
            } else { share_rpc(method, params) }
        };
        assert_eq!(service.share_url_safe_with(url_safe_request("denied"), denied, &transport).await.err().unwrap().code, "network_restricted");
        service.cancel("cancelled");
        assert_eq!(service.share_url_safe_with(url_safe_request("cancelled"), share_rpc, &transport).await.err().unwrap().code, "cancelled");
        let mut invalid = url_safe_request("invalid");
        invalid.url = "file:///secret".into();
        assert_eq!(service.share_url_safe_with(invalid, share_rpc, &transport).await.err().unwrap().code, "invalid_request");
        let mut wrong = url_safe_request("wrong");
        wrong.expected_identity.account_id = "other".into();
        assert_eq!(service.share_url_safe_with(wrong, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn share_url_safety_discards_late_response_after_cancel_or_identity_change() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut transport = share_transport(vec![(200, json!({"safe":true,"token":"never expose"}))]);
            transport.delay_ms = 2000;
            let check = service.share_url_safe_with(url_safe_request("pending"), share_rpc, &transport);
            let interrupt = async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("pending"); }
            };
            let (result, _) = tokio::join!(check, interrupt);
            let error = result.err().unwrap();
            assert_eq!(error.code, if invalidate { "account_changed" } else { "cancelled" });
            assert!(!serde_json::to_string(&error).unwrap().contains("never expose"));
            assert_eq!(transport.responses.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn share_url_safety_also_enforces_the_image_destination_network_policy() {
        for (image_allowed, http, expected) in [
            (false, false, false), (true, false, true), (true, true, false),
        ] {
            let service = ChatgptService::default();
            let transport = share_transport(vec![(200, json!({"safe":true}))]);
            let rpc = |method, params| {
                if method == "configRequirements/read" {
                    let mut domains = json!({"chatgpt.com":"allow"});
                    if image_allowed { domains["images.example"] = json!("allow"); }
                    std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":domains}}}})))
                } else { share_rpc(method, params) }
            };
            let mut request = url_safe_request("destination");
            if http { request.url = "http://images.example/image.png".into(); }
            let result = service.share_url_safe_with(request, rpc, &transport).await;
            if expected { assert!(result.unwrap()); }
            else { assert_eq!(result.err().unwrap().code, "network_restricted"); }
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        }
        // An unrestricted organization retains the official http+safe branch.
        let service = ChatgptService::default();
        let transport = share_transport(vec![(200, json!({"safe":true}))]);
        let mut request = url_safe_request("unrestricted-http");
        request.url = "http://images.example/image.png".into();
        assert!(service.share_url_safe_with(request, share_rpc, &transport).await.unwrap());
    }

    #[tokio::test]
    async fn share_url_safety_destination_policy_wait_is_cancelled_or_identity_invalidated() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let transport = share_transport(vec![(200, json!({"safe":true}))]);
            let policies = AtomicUsize::new(0);
            let entered = AtomicBool::new(false);
            let rpc = |method, params| {
                let policies = &policies;
                let entered = &entered;
                async move {
                    if method == "configRequirements/read" && policies.fetch_add(1, Ordering::SeqCst) == 1 {
                        entered.store(true, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                    share_rpc(method, params).await
                }
            };
            let check = service.share_url_safe_with(url_safe_request("policy-pending"), rpc, &transport);
            let interrupt = async {
                while !entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("policy-pending"); }
            };
            let (result, _) = tokio::join!(check, interrupt);
            assert_eq!(result.err().unwrap().code, if invalidate { "account_changed" } else { "cancelled" });
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        }
    }

    struct ConcurrentShareTransport {
        requests: Mutex<Vec<String>>,
        active: AtomicUsize,
        maximum: AtomicUsize,
        fail_once: AtomicBool,
    }

    impl Transport for ConcurrentShareTransport {
        fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
            Box::pin(async move {
                self.requests.lock().unwrap().push(request.url.clone());
                if request.method == HttpMethod::Post {
                    let body: Value = serde_json::from_slice(&request.body).unwrap();
                    let assets: Vec<_> = body["assets"].as_array().unwrap().iter().map(|asset| {
                        let mut value = target(asset["asset_id"].as_str().unwrap());
                        value["asset_id"] = asset["asset_id"].clone();
                        value
                    }).collect();
                    let mut response = json!({"assets":assets});
                    if body.get("snapshot").is_some() { response["snapshot"] = target("snapshot"); }
                    return Ok(HttpResponse { status:200, headers:BTreeMap::new(), body:serde_json::to_vec(&response).unwrap() });
                }
                let count = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.maximum.fetch_max(count, Ordering::SeqCst);
                struct Active<'a>(&'a AtomicUsize);
                impl Drop for Active<'_> { fn drop(&mut self) { self.0.fetch_sub(1, Ordering::SeqCst); } }
                let _active = Active(&self.active);
                tokio::select! {
                    _ = cancelled(&cancel) => Err(failure("cancelled", "Service request cancelled")),
                    _ = tokio::time::sleep(Duration::from_millis(30)) => Ok(HttpResponse {
                        status: if request.url.contains("/asset-2?") && self.fail_once.swap(false, Ordering::SeqCst) { 503 } else { 204 },
                        headers:BTreeMap::new(), body:Vec::new(),
                    }),
                }
            })
        }
    }

    #[tokio::test]
    async fn share_asset_uploads_use_at_most_four_concurrent_requests_and_retry_only_failures() {
        let service = ChatgptService::default();
        let transport = ConcurrentShareTransport {
            requests:Mutex::new(Vec::new()), active:AtomicUsize::new(0), maximum:AtomicUsize::new(0), fail_once:AtomicBool::new(true),
        };
        let mut request = share_request("concurrent");
        request.assets = (1..=9).map(|index| ShareAsset {
            asset_id:format!("asset-{index}"), mime_type:"image/png".into(), bytes_base64:"AA==".into(),
        }).collect();
        service.share_prepare_with(request, share_rpc, &transport).await.unwrap();
        assert_eq!(transport.maximum.load(Ordering::SeqCst), 4);
        assert_eq!(transport.active.load(Ordering::SeqCst), 0);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.iter().filter(|url| url.contains("/asset-2?")).count(), 2);
        for id in [1, 3, 4, 5, 6, 7, 8, 9] {
            assert_eq!(requests.iter().filter(|url| url.contains(&format!("/asset-{id}?"))).count(), 1);
        }
    }

    #[tokio::test]
    async fn share_concurrent_assets_cancel_together_without_starting_the_next_batch() {
        let service = ChatgptService::default();
        let transport = ConcurrentShareTransport {
            requests:Mutex::new(Vec::new()), active:AtomicUsize::new(0), maximum:AtomicUsize::new(0), fail_once:AtomicBool::new(false),
        };
        let mut request = share_request("cancel-batch");
        request.assets = (1..=9).map(|index| ShareAsset {
            asset_id:format!("asset-{index}"), mime_type:"image/png".into(), bytes_base64:"AA==".into(),
        }).collect();
        let prepare = service.share_prepare_with(request, share_rpc, &transport);
        let interrupt = async {
            while transport.active.load(Ordering::SeqCst) < 4 { tokio::task::yield_now().await; }
            service.cancel("cancel-batch");
        };
        let (result, _) = tokio::join!(prepare, interrupt);
        assert_eq!(result.err().unwrap().code, "cancelled");
        assert_eq!(transport.active.load(Ordering::SeqCst), 0);
        assert_eq!(transport.maximum.load(Ordering::SeqCst), 4);
        assert_eq!(transport.requests.lock().unwrap().len(), 6); // POST, snapshot PUT, first four assets.
        assert!(service.shares.lock().unwrap().is_empty());
    }

    fn target(id: &str) -> Value {
        json!({"upload_url":format!("https://fixture-upload.example/{id}?sig=fixture"),
            "headers":{"x-storage-fixture":"signed"},"etag":format!("etag-{id}"),"file_id":format!("file-{id}")})
    }

    fn share_transport(responses: Vec<(u16, Value)>) -> FakeTransport {
        let transport = FakeTransport::new(&[]);
        *transport.responses.lock().unwrap() = responses.into_iter().map(|(status, body)| HttpResponse {
            status, headers: BTreeMap::new(),
            body: if body.is_null() { Vec::new() } else { serde_json::to_vec(&body).unwrap() },
        }).collect();
        transport
    }

    #[tokio::test]
    async fn share_preparation_and_publication_use_fixed_routes_opaque_manifest_and_empty_put() {
        let service = ChatgptService::default();
        let transport = share_transport(vec![
            (200, json!({"snapshot":target("snapshot")})), (204, Value::Null),
            (200, json!({"share_id":"server-id","share_url":"https://chatgpt.com/share/server-id"})),
        ]);
        let req = share_request("prepare");
        let snapshot = req.snapshot.clone();
        let preparation = service.share_prepare_with(req, share_rpc, &transport).await.unwrap();
        let serialized = serde_json::to_string(&preparation).unwrap();
        assert!(!serialized.contains("upload_url"));
        assert!(!serialized.contains("etag"));
        let published = service.share_publish_with(publish_request("publish", &preparation.preparation_id), share_rpc, &transport).await.unwrap();
        assert_eq!(published.share_url, "https://chatgpt.com/share/server-id");
        // Copy failure can re-read an already published result without a second POST.
        assert_eq!(service.share_publish_with(publish_request("copy-retry", &preparation.preparation_id), share_rpc, &transport).await.unwrap().share_id, "server-id");
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].method, HttpMethod::Post);
        assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/wham/shared_threads/upload_urls");
        assert_eq!(serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({"snapshot":{"size":snapshot.len(),"version":1}}));
        assert!(requests[0].headers.contains_key("Authorization"));
        assert_eq!(requests[1].method, HttpMethod::Put);
        assert_eq!(requests[1].body, snapshot.as_bytes());
        assert_eq!(requests[1].headers.len(), 2);
        assert_eq!(requests[1].headers["Content-Type"], "application/json");
        for name in requests[1].headers.keys() {
            assert!(!matches!(name.to_ascii_lowercase().as_str(), "authorization" | "chatgpt-account-id" | "x-oai-is" | "cookie"));
        }
        assert_eq!(requests[2].method, HttpMethod::Post);
        assert_eq!(requests[2].url, "https://chatgpt.com/backend-api/wham/shared_threads");
        assert_eq!(serde_json::from_slice::<Value>(&requests[2].body).unwrap(),
            json!({"snapshot":{"etag":"etag-snapshot","file_id":"file-snapshot"},"access":"public"}));
    }

    #[tokio::test]
    async fn share_failed_assets_only_are_retargeted_and_snapshot_is_not_reuploaded() {
        let service = ChatgptService::default();
        let mut first = target("one");
        first["asset_id"] = json!("asset-1");
        let mut second = target("two");
        second["asset_id"] = json!("asset-2");
        let mut retry = target("one-retry");
        retry["asset_id"] = json!("asset-1");
        let mut transport = share_transport(vec![
            (200, json!({"snapshot":target("snapshot"),"assets":[first,second]})),
            (204, Value::Null), (403, Value::Null), (201, Value::Null),
            (200, json!({"assets":[retry]})), (204, Value::Null),
        ]);
        transport.reserve_response_on_send = true;
        let mut req = share_request("assets");
        req.assets = vec![
            ShareAsset { asset_id:"asset-1".into(), mime_type:"image/png".into(), bytes_base64:"AAE=".into() },
            ShareAsset { asset_id:"asset-2".into(), mime_type:"image/jpeg".into(), bytes_base64:"AgM=".into() },
        ];
        let prepared = service.share_prepare_with(req, share_rpc, &transport).await.unwrap();
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 6);
        assert_eq!(requests[2].body, vec![0, 1]);
        assert_eq!(requests[3].body, vec![2, 3]);
        assert_eq!(requests[2].headers["Content-Type"], "image/png");
        assert_eq!(serde_json::from_slice::<Value>(&requests[4].body).unwrap(),
            json!({"assets":[{"asset_id":"asset-1","mime_type":"image/png","size":2}]}));
        let shares = service.shares.lock().unwrap();
        let manifest = &shares[&prepared.preparation_id].manifest;
        assert_eq!(manifest["assets"][0]["file_id"], "file-one-retry");
        assert_eq!(manifest["assets"][1]["file_id"], "file-two");
    }

    #[tokio::test]
    async fn share_write_401_is_not_replayed_and_invalid_assets_cannot_authenticate() {
        let service = ChatgptService::default();
        let transport = share_transport(vec![(401, json!({"secret":"never expose"}))]);
        let calls = AtomicUsize::new(0);
        let rpc = |method, params| {
            if method == "getAuthStatus" { calls.fetch_add(1, Ordering::SeqCst); }
            share_rpc(method, params)
        };
        let error = service.share_prepare_with(share_request("unauthorized"), rpc, &transport).await.err().unwrap();
        assert_eq!(error.code, "unauthorized");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert!(!serde_json::to_string(&error).unwrap().contains("secret"));
        let mut req = share_request("bad-asset");
        req.assets.push(ShareAsset { asset_id:"asset-1".into(), mime_type:"text/javascript".into(), bytes_base64:"AA==".into() });
        assert_eq!(service.share_prepare_with(req, rpc, &transport).await.err().unwrap().code, "invalid_request");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn share_unknown_publish_result_cannot_be_replayed_and_known_rejection_can_retry() {
        for (status, expected_code) in [(500, "service_error"), (200, "invalid_response"), (403, "forbidden"), (408, "service_error"), (409, "conflict")] {
            let service = ChatgptService::default();
            let transport = share_transport(vec![
                (200, json!({"snapshot":target("snapshot")})), (204, Value::Null),
                (status, json!({"not":"a published share"})),
                (200, json!({"share_id":"recovered","share_url":"https://chatgpt.com/share/recovered"})),
            ]);
            let prepared = service.share_prepare_with(share_request("prepare"), share_rpc, &transport).await.unwrap();
            assert_eq!(service.share_publish_with(publish_request("first", &prepared.preparation_id), share_rpc, &transport).await.err().unwrap().code, expected_code);
            let retry = service.share_publish_with(publish_request("second", &prepared.preparation_id), share_rpc, &transport).await;
            if status == 403 {
                assert_eq!(retry.unwrap().share_id, "recovered");
                assert_eq!(transport.requests.lock().unwrap().len(), 4);
            } else {
                assert_eq!(retry.err().unwrap().code, "publish_unknown");
                assert_eq!(transport.requests.lock().unwrap().len(), 3);
            }
        }
    }

    #[tokio::test]
    async fn share_cached_or_uncertain_publication_never_accepts_a_different_audience() {
        for status in [200, 500] {
            let service = ChatgptService::default();
            let transport = share_transport(vec![
                (200, json!({"snapshot":target("snapshot")})), (204, Value::Null),
                (status, json!({"share_id":"public-link","share_url":"https://chatgpt.com/share/public-link"})),
            ]);
            let prepared = service.share_prepare_with(share_request("prepare"), share_rpc, &transport).await.unwrap();
            let first = service.share_publish_with(publish_request("public", &prepared.preparation_id), share_rpc, &transport).await;
            assert_eq!(first.is_ok(), status == 200);
            let mut changed = publish_request("invited", &prepared.preparation_id);
            changed.access = ShareAccess::Invited;
            changed.principals = vec![SharePrincipal { principal_id:"workspace-user".into(), principal_type:"user".into() }];
            assert_eq!(service.share_publish_with(changed, share_rpc, &transport).await.err().unwrap().code, "share_audience_changed");
            assert_eq!(transport.requests.lock().unwrap().len(), 3);
        }
    }

    #[tokio::test]
    async fn share_inflight_audience_is_bound_and_principal_order_is_normalized() {
        let service = ChatgptService::default();
        let mut transport = share_transport(vec![
            (200, json!({"snapshot":target("snapshot")})), (204, Value::Null),
            (200, json!({"share_id":"invited","share_url":"https://chatgpt.com/share/invited"})),
        ]);
        let prepared = service.share_prepare_with(share_request("prepare"), share_rpc, &transport).await.unwrap();
        transport.delay_ms = 40;
        transport.entered.store(false, Ordering::SeqCst);
        let mut invited = publish_request("invited", &prepared.preparation_id);
        invited.access = ShareAccess::Invited;
        invited.principals = vec![
            SharePrincipal { principal_id:"user-a".into(), principal_type:"user".into() },
            SharePrincipal { principal_id:"group-b".into(), principal_type:"group".into() },
        ];
        let mut reordered = publish_request("reordered", &prepared.preparation_id);
        reordered.access = ShareAccess::Invited;
        reordered.principals = invited.principals.iter().rev().cloned().collect();
        let publish = service.share_publish_with(invited, share_rpc, &transport);
        let during = async {
            while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
            assert_eq!(service.share_publish_with(publish_request("changed", &prepared.preparation_id), share_rpc, &transport)
                .await.err().unwrap().code, "share_audience_changed");
        };
        let (result, _) = tokio::join!(publish, during);
        assert_eq!(result.unwrap().share_id, "invited");
        assert_eq!(service.share_publish_with(reordered, share_rpc, &transport).await.unwrap().share_id, "invited");
        assert_eq!(transport.requests.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn share_explicit_asset_references_must_have_upload_bytes_before_authentication() {
        let cases = [
            (json!({"version":1,"assets":{"asset-1":{"width":1,"height":1}},"turns":[]}), false),
            (json!({"version":1,"turns":[{"items":[{"type":"imageView","url":"codex:shared-asset/asset-1"}]}]}), false),
            (json!({"version":1,"turns":[{"items":[{"type":"imageGeneration","status":"completed","result":"codex:shared-asset/asset-1"}]}]}), false),
            (json!({"version":1,"turns":[{"items":[{"type":"userMessage","content":[{"type":"image","url":"codex:shared-asset/asset-1"}]}]}]}), false),
            (json!({"version":1,"turns":[{"items":[{"type":"imageView","url":"codex:shared-image-unavailable"}]}]}), true),
            (json!({"version":1,"turns":[{"items":[{"type":"agentMessage","text":"literal codex:shared-asset/asset-1"}]}]}), true),
        ];
        for (snapshot, valid) in cases {
            let service = ChatgptService::default();
            let transport = share_transport(vec![(401, json!({}))]);
            let auth_calls = AtomicUsize::new(0);
            let rpc = |method, params| {
                if method == "getAuthStatus" { auth_calls.fetch_add(1, Ordering::SeqCst); }
                share_rpc(method, params)
            };
            let mut request = share_request("assets");
            request.snapshot = snapshot.to_string();
            let result = service.share_prepare_with(request, rpc, &transport).await;
            assert_eq!(result.err().unwrap().code, if valid { "unauthorized" } else { "invalid_request" });
            assert_eq!(auth_calls.load(Ordering::SeqCst), usize::from(valid));
            assert_eq!(transport.requests.lock().unwrap().len(), usize::from(valid));
        }
        let mut request = share_request("valid");
        request.snapshot = json!({"version":1,"assets":{"asset-1":{"width":2,"height":3}},
            "turns":[{"items":[{"type":"imageView","url":"codex:shared-asset/asset-1"}]}]}).to_string();
        request.assets.push(ShareAsset { asset_id:"asset-1".into(), mime_type:"image/png".into(), bytes_base64:"AA==".into() });
        assert!(validate_share_payload(&request.snapshot, &request.assets).is_ok());
    }

    #[tokio::test]
    async fn share_identity_context_cancel_and_invalidation_reject_before_publish() {
        let service = ChatgptService::default();
        let transport = share_transport(vec![
            (200, json!({"snapshot":target("snapshot")})), (204, Value::Null),
        ]);
        let prepared = service.share_prepare_with(share_request("prepare"), share_rpc, &transport).await.unwrap();
        let mut wrong_thread = publish_request("wrong-thread", &prepared.preparation_id);
        wrong_thread.thread_id = "another".into();
        assert_eq!(service.share_publish_with(wrong_thread, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        let mut wrong_account = publish_request("wrong-account", &prepared.preparation_id);
        wrong_account.expected_identity.account_id = "other".into();
        assert_eq!(service.share_publish_with(wrong_account, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        service.cancel("cancel-publish");
        assert_eq!(service.share_publish_with(publish_request("cancel-publish", &prepared.preparation_id), share_rpc, &transport).await.err().unwrap().code, "cancelled");
        service.invalidate();
        assert!(service.shares.lock().unwrap().is_empty());
        assert_eq!(service.share_publish_with(publish_request("invalidated", &prepared.preparation_id), share_rpc, &transport).await.err().unwrap().code, "account_changed");
        assert_eq!(transport.requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn share_target_mismatch_and_unsafe_headers_fail_before_any_put() {
        for response in [
            json!({"snapshot":target("snapshot"),"assets":[{"asset_id":"extra","upload_url":"https://fixture-upload.example/a","headers":{},"etag":"e","file_id":"f"}]}),
            json!({"snapshot":{"upload_url":"https://fixture-upload.example/a","headers":{"aUtHoRiZaTiOn":"Bearer secret"},"etag":"e","file_id":"f"}}),
            json!({"snapshot":{"upload_url":"https://fixture-upload.example/a","headers":{"x-test":"a\r\nb"},"etag":"e","file_id":"f"}}),
            json!({"snapshot":{"upload_url":"http://fixture-upload.example/a","headers":{},"etag":"e","file_id":"f"}}),
        ] {
            let service = ChatgptService::default();
            let transport = share_transport(vec![(200, response)]);
            assert_eq!(service.share_prepare_with(share_request("invalid"), share_rpc, &transport).await.err().unwrap().code, "invalid_response");
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            assert!(service.shares.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn share_application_network_policy_applies_to_post_and_uploaded_targets() {
        let denied = |method, params| {
            if method == "configRequirements/read" {
                std::future::ready(Ok(json!({"requirements":{"application":{"network":{
                    "enabled":true,"domains":{"chatgpt.com":"allow","example":"allow"}}}}})))
            } else { share_rpc(method, params) }
        };
        let service = ChatgptService::default();
        let transport = share_transport(vec![(200, json!({"snapshot":target("snapshot")}))]);
        assert_eq!(service.share_prepare_with(share_request("restricted"), denied, &transport).await.err().unwrap().code, "network_restricted");
        assert_eq!(transport.requests.lock().unwrap().len(), 1); // subdomain is not implicitly allowed.
        let unavailable = |method, params| {
            if method == "configRequirements/read" { std::future::ready(Err("private policy detail".into())) }
            else { share_rpc(method, params) }
        };
        assert_eq!(service.share_prepare_with(share_request("unknown-policy"), unavailable, &transport).await.err().unwrap().code, "network_policy_unavailable");
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn share_publish_cancellation_after_send_is_unknown_and_invalidation_clears_session() {
        for invalidate in [false, true] {
            let service = ChatgptService::default();
            let mut transport = share_transport(vec![
                (200, json!({"snapshot":target("snapshot")})), (204, Value::Null),
                (200, json!({"share_id":"late","share_url":"https://chatgpt.com/share/late"})),
            ]);
            let prepared = service.share_prepare_with(share_request("prepare"), share_rpc, &transport).await.unwrap();
            transport.delay_ms = 2000;
            transport.entered.store(false, Ordering::SeqCst);
            let publish = service.share_publish_with(publish_request("in-flight", &prepared.preparation_id), share_rpc, &transport);
            let interrupt = async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("in-flight"); }
            };
            let (result, _) = tokio::join!(publish, interrupt);
            assert_eq!(result.err().unwrap().code, if invalidate { "account_changed" } else { "cancelled" });
            assert_eq!(transport.requests.lock().unwrap().len(), 3);
            assert_eq!(transport.responses.lock().unwrap().len(), 1); // no late successful result consumed.
            if invalidate {
                assert!(service.shares.lock().unwrap().is_empty());
            } else {
                let retry = service.share_publish_with(publish_request("retry", &prepared.preparation_id), share_rpc, &transport).await;
                assert_eq!(retry.err().unwrap().code, "publish_unknown");
                assert_eq!(transport.requests.lock().unwrap().len(), 3);
            }
        }
    }

    #[tokio::test]
    async fn share_cancelled_preparation_never_installs_late_targets_or_manifest() {
        let service = ChatgptService::default();
        let mut transport = share_transport(vec![(200, json!({"snapshot":target("late")}))]);
        transport.delay_ms = 2000;
        let preparation = service.share_prepare_with(share_request("prepare"), share_rpc, &transport);
        let interrupt = async {
            while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
            service.cancel("prepare");
        };
        let (result, _) = tokio::join!(preparation, interrupt);
        assert_eq!(result.err().unwrap().code, "cancelled");
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert_eq!(transport.responses.lock().unwrap().len(), 1);
        assert!(service.shares.lock().unwrap().is_empty());
    }

    #[test]
    fn share_snapshot_schema_and_asset_target_mapping_are_strict_consumption_checks() {
        let snapshot: Value = serde_json::from_str(&share_request("x").snapshot).unwrap();
        assert!(valid_shared_snapshot(&snapshot));
        for invalid in [
            json!({"version":1,"turns":[],"threadId":"must not upload"}),
            json!({"version":1,"turns":[{"items":[{"type":"agentMessage","text":"ok","cwd":"secret"}]}]}),
            json!({"version":1,"turns":[{"items":[{"type":"imageView","url":"file:///private.png"}]}]}),
            json!({"version":1,"turns":[{"items":[{"type":"reasoning","summary":"x"}],"durationMs":-1}]}),
        ] { assert!(!valid_shared_snapshot(&invalid), "{invalid}"); }
        let assets = vec![("asset-1".into(), "image/png".into(), vec![1])];
        assert!(match_asset_targets(&assets, vec![]).is_err());
        let mut duplicate = target("one");
        duplicate["asset_id"] = json!("asset-1");
        let values = serde_json::from_value::<Vec<ShareAssetTarget>>(json!([duplicate.clone(),duplicate])).unwrap();
        assert!(match_asset_targets(&assets, values).is_err());
        assert!(validate_share_audience(&ShareAccess::Invited, &[]).is_err());
        assert!(validate_share_audience(&ShareAccess::Public, &[SharePrincipal { principal_id:"user".into(), principal_type:"user".into() }]).is_err());
        assert!(parse_published_share(&json!({"share_id":"x","share_url":"javascript:alert(1)"})).is_err());
    }

    #[test]
    fn share_upload_body_file_preserves_binary_and_is_removed_on_drop() {
        let bytes = [0, 255, b'\n', b'\"', b'\\'];
        let file = UploadBodyFile::create(&bytes).unwrap();
        let path = file.0.clone();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        drop(file);
        assert!(!path.exists());
        let get_with_body = HttpRequest { url:"https://chatgpt.com".into(), headers:BTreeMap::new(), method:HttpMethod::Get, body:vec![1] };
        assert_eq!(curl_config(&get_with_body).err().unwrap().code, "invalid_request");
    }
}
