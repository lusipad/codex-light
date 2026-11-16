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

mod account_notifications;
pub use account_notifications::{AccountNotificationsRequest, AccountNotificationsResponse, AccountNotificationsWriteRequest};
mod plugin_permissions;
pub use plugin_permissions::{PluginPermissionsRequest, PluginPermissionsResponse, PluginPermissionsWriteRequest};
mod plugin_app_details;
pub use plugin_app_details::{PluginAppDetailsRequest, PluginAppEntryRequest};
mod plugin_canonical_root;
pub use plugin_canonical_root::PluginCanonicalRootRequest;
mod plugin_app_accounts;
pub use plugin_app_accounts::PluginAppRenameRequest;
mod plugin_app_disconnect;
pub use plugin_app_disconnect::PluginAppDisconnectRequest;
mod plugin_app_link_permissions;
pub use plugin_app_link_permissions::{PluginAppLinkPermissionsRequest, PluginAppLinkPermissionWriteRequest};
mod plugin_app_sync;
pub use plugin_app_sync::{PluginAppSyncRequest, PluginAppSyncDisableRequest};
mod plugin_github_sync;
pub use plugin_github_sync::{PluginGithubSyncRequest, PluginGithubSyncSearchRequest, PluginGithubSyncWriteRequest};
mod archive_conversations;
pub use archive_conversations::{ArchiveConversationsRequest, ArchiveConversationsResponse};
mod archive_unarchive;
pub use archive_unarchive::{ArchiveUnarchiveRequest, ArchiveUnarchiveResponse};
mod archive_delete;
pub use archive_delete::{ArchiveDeleteRequest, ArchiveDeleteResponse};
mod images_assets;
mod gpts_assets;
mod sites_assets;
mod sites_settings;
mod cloud_drafts;
mod cloud_draft_save;
mod cloud_publish;
mod cloud_repositories;
pub use cloud_draft_save::CloudDraftSaveRequest;
pub use cloud_publish::CloudPublishRequest;
pub use cloud_drafts::{CloudConfigRequest, CloudConfigResponse, CloudDraftRequest, CloudDraftResponse};
mod durable_models;
pub use durable_models::{DurableModelsRequest, DurableModelsResponse};
mod durable_thread;
pub use durable_thread::DurableThreadRequest;
pub use sites_settings::{SitesSettingsRequest, SitesSettingsResponse};
pub use sites_assets::{SiteAssetRef, SitesPinRequest, SitesPinResponse};
pub use gpts_assets::GptAssetRef;
pub use images_assets::ImagesAssetRef;

const MAX_RESPONSE: u64 = 8 * 1024 * 1024;
const MAX_LIBRARY_FILE: u64 = 40 * 1024 * 1024;
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
    LibraryDirectoryPath,
    LibraryImages,
    LibrarySuggested,
    LibrarySettings,
    LibraryImage,
    LibraryFile,
    LibraryFileContent,
    StorageUsage,
    ImagesInit,
    ImagesStyles,
    ImagesRecent,
    ImagesWorkspaceSettings,
    ImagesAsset,
    GptsAvatar,
    GptsWorkspaceSettings,
    CloudWorkspaceSettings,
    GptsDiscovery,
    GptsCategory,
    GptsSearch,
    GptsDetail,
    GptsAbout,
    SitesEntryAccess,
    SitesPinned,
    SitesPin,
    SitesAsset,
    SitesAccess,
    SitesList,
    SitesShared,
    SitesDetail,
    SitesEnvironment,
    SitesDomains,
    SitesShareAccess,
    SitesPreferredLiveUrl,
    SitesWorkspaceSettings,
    SitesUsers,
    SitesGroups,
    SitesTeams,
    GithubRepository,
    GithubConnections,
    CloudGithubDefault,
    CloudGithubEnterprise,
    CloudGithubLinks,
    CloudGithubInstallations,
    CloudGithubRepositories,
    ShareAccounts,
    ShareUsers,
    ShareGroups,
    WhamUsage,
    ArchiveCloudTasks,
    AccountMe,
    ProfileIdentity,
    ProfilePage,
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

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileMutationOperation { AccountName, UsernameCheck, Username, Profile }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileMutationRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub operation: ProfileMutationOperation,
    pub params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMutationResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub body: Value,
    pub readback: Value,
    pub verification: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePluginInventoryRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub include_extensions: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePluginHomeRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginHomeResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub sections: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePluginDetailRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub plugin_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginDetailResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub plugin: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePluginCategoryRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub category_slug: String,
    pub search_term: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginCategoryResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub plugins: Vec<Value>,
    pub next_page_token: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemotePluginDirectoryKind { Workspace, Personal, Created, Shared }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePluginDirectoryListRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub kind: RemotePluginDirectoryKind,
    pub limit: u16,
    pub cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginDirectoryListResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub plugins: Vec<Value>,
    pub next_page_token: Option<String>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemotePluginMutationOperation { Enable, Disable, Uninstall }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePluginMutationRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub plugin_id: String,
    pub operation: RemotePluginMutationOperation,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginInventoryResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub plugins: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginMutationResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub plugin_id: String,
    pub operation: RemotePluginMutationOperation,
    pub body: Value,
    pub plugins: Option<Vec<Value>>,
    pub verification: &'static str,
    pub delivery: &'static str,
    pub warning_code: Option<&'static str>,
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

#[derive(Clone)]
struct PinnedReview {
    identity: ServiceIdentity,
    preferences: Value,
    body: Value,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<Vec<ImagesAssetRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpt_assets: Option<Vec<GptAssetRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_assets: Option<Vec<SiteAssetRef>>,
}

// Intentionally neither Debug nor Serialize.
#[derive(Clone)]
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
    pinned_reviews: Mutex<VecDeque<(String, PinnedReview)>>,
    images_assets: Mutex<images_assets::ImagesRegistry>,
    images_snapshot: AtomicU64,
    gpts_assets: Mutex<gpts_assets::GptsRegistry>,
    sites_assets: Mutex<sites_assets::SitesRegistry>,
    site_pin_active: Mutex<std::collections::HashSet<String>>,
    site_settings_active: Mutex<std::collections::HashSet<(String,String,u64,String,&'static str)>>,
    cloud_drafts: Mutex<cloud_drafts::CloudDraftRegistry>,
    durable: crate::durable::Manager,
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
    pub async fn remote_plugin_directory_list<F, Fut>(&self, request: RemotePluginDirectoryListRequest, call: F) -> ServiceResult<RemotePluginDirectoryListResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.remote_plugin_directory_list_with(request, call, &CurlTransport).await
    }

    async fn remote_plugin_directory_list_with<F, Fut, T>(&self, request: RemotePluginDirectoryListRequest, call: F, transport: &T) -> ServiceResult<RemotePluginDirectoryListResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        if !matches!(request.limit, 9 | 50) ||
            (request.limit == 9 && request.cursor.is_some()) ||
            (matches!(request.kind, RemotePluginDirectoryKind::Workspace | RemotePluginDirectoryKind::Shared) && request.limit != 50) ||
            request.cursor.as_ref().is_some_and(|value| value.len() > 16 * 1024 || value.chars().any(char::is_control)) {
            return Err(failure("invalid_request", "Remote plugin directory request is invalid"));
        }
        let (path, scope) = match request.kind {
            RemotePluginDirectoryKind::Workspace => ("list", Some("WORKSPACE")),
            RemotePluginDirectoryKind::Personal => ("list", Some("USER")),
            RemotePluginDirectoryKind::Created => ("workspace/created", None),
            RemotePluginDirectoryKind::Shared => ("workspace/shared", None),
        };
        let mut url = tauri::Url::parse(&format!("https://chatgpt.com/backend-api/ps/plugins/{path}")).unwrap();
        if let Some(scope) = scope { url.query_pairs_mut().append_pair("scope", scope); }
        url.query_pairs_mut().append_pair("limit", &request.limit.to_string());
        if let Some(cursor) = &request.cursor { url.query_pairs_mut().append_pair("pageToken", cursor); }
        let route = format!("{}?{}", url.path(), url.query().unwrap());
        let registration = self.register(&request.request_id)?;
        let body = self.remote_plugin_http(&route, HttpMethod::Get, true, &request.expected_identity,
            &request.profile, &registration, &call, transport).await?;
        let plugins = body.get("plugins").and_then(Value::as_array)
            .ok_or_else(|| failure("invalid_response", "Remote plugin directory plugins are missing or invalid"))?;
        for row in plugins {
            validate_remote_plugin_row(row)?;
            if !row.get("release").is_some_and(Value::is_object) || !row["release"].get("interface").is_some_and(Value::is_object) {
                return Err(failure("invalid_response", "Remote plugin directory release is missing or invalid"));
            }
        }
        let pagination = body.get("pagination").and_then(Value::as_object)
            .ok_or_else(|| failure("invalid_response", "Remote plugin directory pagination is missing or invalid"))?;
        let next_page_token = match pagination.get("next_page_token") {
            None | Some(Value::Null) => None,
            Some(Value::String(token)) if token.len() <= 16 * 1024 && !token.chars().any(char::is_control) => Some(token.clone()),
            _ => return Err(failure("invalid_response", "Remote plugin directory pagination cursor is invalid")),
        };
        self.check_share_current(&request.expected_identity, &registration)?;
        Ok(RemotePluginDirectoryListResponse { request_id:request.request_id, identity:request.expected_identity, plugins:plugins.clone(), next_page_token })
    }

    pub async fn remote_plugin_category<F, Fut>(&self, request: RemotePluginCategoryRequest, call: F) -> ServiceResult<RemotePluginCategoryResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.remote_plugin_category_with(request, call, &CurlTransport).await
    }

    async fn remote_plugin_category_with<F, Fut, T>(&self, request: RemotePluginCategoryRequest, call: F, transport: &T) -> ServiceResult<RemotePluginCategoryResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let slug = encode_segment(&request.category_slug)?;
        if request.cursor.as_ref().is_some_and(|value| value.len() > 16 * 1024 || value.chars().any(char::is_control)) {
            return Err(failure("invalid_request", "Remote plugin category cursor is invalid"));
        }
        let mut url = tauri::Url::parse(&format!("https://chatgpt.com/backend-api/ps/plugin-categories/{slug}/plugins")).unwrap();
        url.query_pairs_mut().append_pair("scope", "GLOBAL");
        if let Some(term) = request.search_term.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            url.query_pairs_mut().append_pair("q", term);
        }
        url.query_pairs_mut().append_pair("limit", "50");
        if let Some(cursor) = &request.cursor { url.query_pairs_mut().append_pair("pageToken", cursor); }
        let route = format!("{}?{}", url.path(), url.query().unwrap());
        let registration = self.register(&request.request_id)?;
        let body = self.remote_plugin_http(&route, HttpMethod::Get, true, &request.expected_identity,
            &request.profile, &registration, &call, transport).await?;
        let plugins = body.get("plugins").and_then(Value::as_array)
            .ok_or_else(|| failure("invalid_response", "Remote plugin category plugins are missing or invalid"))?;
        for row in plugins { validate_remote_plugin_listing(row)?; }
        let pagination = match body.get("pagination") {
            None | Some(Value::Null) => None,
            Some(Value::Object(page)) => Some(page),
            _ => return Err(failure("invalid_response", "Remote plugin category pagination is invalid")),
        };
        let next_page_token = match pagination.and_then(|page| page.get("next_page_token")) {
            None | Some(Value::Null) => None,
            Some(Value::String(token)) if token.len() <= 16 * 1024 && !token.chars().any(char::is_control) => Some(token.clone()),
            _ => return Err(failure("invalid_response", "Remote plugin category pagination cursor is invalid")),
        };
        self.check_share_current(&request.expected_identity, &registration)?;
        Ok(RemotePluginCategoryResponse { request_id: request.request_id, identity: request.expected_identity, plugins: plugins.clone(), next_page_token })
    }

    pub async fn remote_plugin_detail<F, Fut>(&self, request: RemotePluginDetailRequest, call: F) -> ServiceResult<RemotePluginDetailResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.remote_plugin_detail_with(request, call, &CurlTransport).await
    }

    async fn remote_plugin_detail_with<F, Fut, T>(&self, request: RemotePluginDetailRequest, call: F, transport: &T) -> ServiceResult<RemotePluginDetailResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let encoded_id = encode_segment(&request.plugin_id)?;
        let registration = self.register(&request.request_id)?;
        let route = format!("/backend-api/ps/plugins/{encoded_id}");
        let plugin = self.remote_plugin_http(&route, HttpMethod::Get, false, &request.expected_identity,
            &request.profile, &registration, &call, transport).await?;
        validate_remote_plugin_row(&plugin)?;
        if plugin["id"].as_str() != Some(request.plugin_id.as_str()) {
            return Err(failure("invalid_response", "Remote plugin detail identity does not match the request"));
        }
        self.check_share_current(&request.expected_identity, &registration)?;
        Ok(RemotePluginDetailResponse { request_id: request.request_id, identity: request.expected_identity, plugin })
    }

    pub async fn remote_plugin_home<F, Fut>(&self, request: RemotePluginHomeRequest, call: F) -> ServiceResult<RemotePluginHomeResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.remote_plugin_home_with(request, call, &CurlTransport).await
    }

    async fn remote_plugin_home_with<F, Fut, T>(&self, request: RemotePluginHomeRequest, call: F, transport: &T) -> ServiceResult<RemotePluginHomeResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let registration = self.register(&request.request_id)?;
        let body = self.remote_plugin_http("/backend-api/ps/plugins/home", HttpMethod::Get, true, &request.expected_identity,
            &request.profile, &registration, &call, transport).await?;
        let sections = validate_remote_plugin_home(&body)?;
        self.check_share_current(&request.expected_identity, &registration)?;
        Ok(RemotePluginHomeResponse { request_id: request.request_id, identity: request.expected_identity, sections })
    }

    pub async fn remote_plugin_inventory<F, Fut>(&self, request: RemotePluginInventoryRequest, call: F) -> ServiceResult<RemotePluginInventoryResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.remote_plugin_inventory_with(request, call, &CurlTransport).await
    }

    async fn remote_plugin_inventory_with<F, Fut, T>(&self, request: RemotePluginInventoryRequest, call: F, transport: &T) -> ServiceResult<RemotePluginInventoryResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let registration = self.register(&request.request_id)?;
        let plugins = self.remote_plugin_pages(&request.expected_identity, &request.profile, request.include_extensions.unwrap_or(true), &registration, &call, transport).await?;
        self.check_share_current(&request.expected_identity, &registration)?;
        Ok(RemotePluginInventoryResponse { request_id: request.request_id, identity: request.expected_identity, plugins })
    }

    pub async fn remote_plugin_mutation<F, Fut>(&self, request: RemotePluginMutationRequest, call: F) -> ServiceResult<RemotePluginMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.remote_plugin_mutation_with(request, call, &CurlTransport).await
    }

    async fn remote_plugin_mutation_with<F, Fut, T>(&self, request: RemotePluginMutationRequest, call: F, transport: &T) -> ServiceResult<RemotePluginMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let encoded_id = encode_segment(&request.plugin_id)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        let before = self.remote_plugin_pages(identity, &request.profile, true, &registration, &call, transport).await?;
        let target = before.iter().find(|row| row["id"].as_str() == Some(request.plugin_id.as_str()))
            .ok_or_else(|| failure("not_found", "Remote plugin is not in the installed inventory"))?;
        validate_remote_plugin_mutation(target, request.operation)?;
        self.check_share_current(identity, &registration)?;
        let action = match request.operation { RemotePluginMutationOperation::Enable => "enable", RemotePluginMutationOperation::Disable => "disable", RemotePluginMutationOperation::Uninstall => "uninstall" };
        let route = format!("/backend-api/ps/plugins/{encoded_id}/{action}");
        let written = self.remote_plugin_http(&route, HttpMethod::Post, false, identity, &request.profile, &registration, &call, transport).await;
        self.check_share_current(identity, &registration)?;
        let (body, delivery, mut warning_code) = match written {
            Ok(body) => (body, "accepted", None),
            Err(error) if error.code == "plugin_write_unknown" => (Value::Null, "unknown", Some(error.code)),
            Err(error) => return Err(error),
        };
        let read = self.remote_plugin_pages(identity, &request.profile, true, &registration, &call, transport).await;
        self.check_share_current(identity, &registration)?;
        let plugins = match read {
            Ok(plugins) => Some(plugins),
            Err(error) if matches!(error.code, "account_changed" | "cancelled") => return Err(error),
            Err(_) => { warning_code = Some("plugin_readback_unavailable"); None },
        };
        let confirmed = plugins.as_ref().is_some_and(|rows| {
            let saved = rows.iter().find(|row| row["id"].as_str() == Some(request.plugin_id.as_str()));
            match request.operation {
                RemotePluginMutationOperation::Enable => saved.is_some_and(|row| row["enabled"] == true),
                RemotePluginMutationOperation::Disable => saved.is_some_and(|row| row["enabled"] == false),
                RemotePluginMutationOperation::Uninstall => saved.is_none(),
            }
        });
        Ok(RemotePluginMutationResponse { request_id: request.request_id, identity: identity.clone(), plugin_id: request.plugin_id, operation: request.operation, body, plugins,
            verification: if confirmed { "confirmed" } else { "pending" }, delivery, warning_code })
    }

    async fn remote_plugin_pages<F, Fut, T>(&self, identity: &ServiceIdentity, profile: &ServiceProfile, include_extensions: bool,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Vec<Value>>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let mut plugins = Vec::new();
        let mut cursors = std::collections::HashSet::new();
        let mut ids = std::collections::HashSet::new();
        let mut cursor: Option<String> = None;
        let mut total = 0usize;
        loop {
            self.check_share_current(identity, registration)?;
            let mut url = tauri::Url::parse("https://chatgpt.com/backend-api/ps/plugins/installed").unwrap();
            url.query_pairs_mut().append_pair("limit", "1000").append_pair("includeExtensions", if include_extensions { "true" } else { "false" });
            if let Some(token) = &cursor { url.query_pairs_mut().append_pair("pageToken", token); }
            let route = format!("{}?{}", url.path(), url.query().unwrap());
            let body = self.remote_plugin_http(&route, HttpMethod::Get, false, identity, profile, registration, call, transport).await?;
            total = total.saturating_add(serde_json::to_vec(&body).map_err(|_| failure("invalid_response", "Invalid plugin inventory"))?.len());
            if total as u64 > MAX_RESPONSE { return Err(failure("response_too_large", "Remote plugin inventory exceeded transport limit")); }
            let rows = body.get("plugins").and_then(Value::as_array).ok_or_else(|| failure("invalid_response", "Remote plugin inventory is incomplete"))?;
            for row in rows {
                validate_remote_plugin_row(row)?;
                if !ids.insert(row["id"].as_str().unwrap().to_owned()) { return Err(failure("invalid_response", "Remote plugin inventory contains duplicate identifiers")); }
                plugins.push(row.clone());
            }
            let page = body.get("pagination").and_then(Value::as_object).ok_or_else(|| failure("invalid_response", "Remote plugin pagination is missing"))?;
            let next = page.get("next_page_token").ok_or_else(|| failure("invalid_response", "Remote plugin pagination is incomplete"))?;
            match next {
                Value::Null => break,
                Value::String(token) if token.is_empty() => break,
                Value::String(token) => {
                    if token.len() > 16 * 1024 || token.chars().any(char::is_control) || !cursors.insert(token.clone()) {
                        return Err(failure("invalid_response", "Remote plugin pagination cursor is invalid or repeated"));
                    }
                    cursor = Some(token.clone());
                },
                _ => return Err(failure("invalid_response", "Remote plugin pagination is invalid")),
            }
        }
        self.check_share_current(identity, registration)?;
        Ok(plugins)
    }

    #[allow(clippy::too_many_arguments)]
    async fn remote_plugin_http<F, Fut, T>(&self, route: &str, method: HttpMethod, plugin_directory: bool, identity: &ServiceIdentity, profile: &ServiceProfile,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        self.check_share_current(identity, registration)?;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Remote plugin request cancelled; a sent mutation may already have applied")),
            result = async {
                let mut session = self.session.lock().await;
                self.check_share_current(identity, registration)?;
                self.prepare(&mut session, identity.generation, call, false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity, registration)?;
                    let credentials = session.credentials.as_ref().unwrap();
                    if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                    let integrity = session.integrity.clone();
                    let mut outgoing = build_http_request(route, credentials, integrity.as_deref(), profile)?;
                    outgoing.method = method;
                    outgoing.headers.insert("OAI-Product-Sku".into(), if method == HttpMethod::Post || plugin_directory { "CONNECTOR_SETTING" } else { "CODEX" }.into());
                    outgoing.headers.insert("X-Codex-Surface".into(), if plugin_directory { "plugin_directory" } else { "other" }.into());
                    share_network_allowed(call, &outgoing.url).await?;
                    self.check_share_current(identity, registration)?;
                    let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                        .map_err(|error| if method == HttpMethod::Post { failure("plugin_write_unknown", "Remote plugin mutation outcome is unknown; read before retrying") } else { error })?;
                    self.check_share_current(identity, registration)?;
                    apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) { return Err(ServiceError { code: "ip_not_authorized", message: "Current IP address is not authorized for this workspace", status: Some(401) }); }
                    if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
                    if method == HttpMethod::Post {
                        if response.status >= 500 || response.status == 408 { return Err(failure("plugin_write_unknown", "Remote plugin mutation outcome is unknown; read before retrying")); }
                        if (200..300).contains(&response.status) {
                            if response.status == 204 || response.body.is_empty() { return Ok(Value::Null); }
                            return serde_json::from_slice(&response.body).map_err(|_| failure("plugin_write_unknown", "Remote plugin mutation returned invalid JSON; read before retrying"));
                        }
                    }
                    return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
                }
                unreachable!()
            } => result,
        };
        self.check_share_current(identity, registration)?;
        result
    }

    pub async fn profile_mutation<F, Fut>(&self, request: ProfileMutationRequest, call: F) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.profile_mutation_with(request, call, &CurlTransport).await
    }

    async fn profile_mutation_with<F, Fut, T>(&self, request: ProfileMutationRequest, call: F, transport: &T) -> ServiceResult<ProfileMutationResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let mut params = profile_mutation_params(request.operation, &request.params)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        self.check_share_current(identity, &registration)?;
        let (route, method, read_route) = match request.operation {
            ProfileMutationOperation::AccountName => ("/backend-api/accounts/users/name", HttpMethod::Patch, "/backend-api/me"),
            ProfileMutationOperation::UsernameCheck => ("/backend-api/wham/profiles/username/check", HttpMethod::Post, "/backend-api/profiles/me"),
            ProfileMutationOperation::Username => ("/backend-api/wham/profiles/me", HttpMethod::Patch, "/backend-api/profiles/me"),
            ProfileMutationOperation::Profile => ("/backend-api/profiles/me", HttpMethod::Patch, "/backend-api/profiles/me/page"),
        };
        let before = self.profile_http(read_route, HttpMethod::Get, None, &request, &registration, &call, transport).await?;
        match request.operation {
            ProfileMutationOperation::AccountName => {
                validate_profile_read(&ServiceOperation::AccountMe, &before, identity)?;
                if before.get("name") == params.get("name") { return Err(failure("invalid_request", "Account name is unchanged")); }
            }
            ProfileMutationOperation::Username | ProfileMutationOperation::UsernameCheck => {
                validate_profile_read(&ServiceOperation::ProfileIdentity, &before, identity)?;
                if !before["profile_details"].is_object() || !before["viewer_access"].is_object() { return Err(failure("invalid_response", "Profile permissions are unavailable")); }
                if !profile_username_editable(&before) { return Err(failure("forbidden", "Username editing is not available for this profile")); }
            }
            ProfileMutationOperation::Profile => {
                validate_profile_read(&ServiceOperation::ProfilePage, &before, identity)?;
                if before.get("can_edit") != Some(&Value::Bool(true)) || !before["profile_details"].is_object() {
                    return Err(failure("forbidden", "Public profile editing is not available"));
                }
                params.as_object_mut().unwrap().retain(|key, value| before["profile_details"].get(key) != Some(value));
                if params.as_object().unwrap().is_empty() { return Err(failure("invalid_request", "Public profile is unchanged")); }
            }
        }
        self.check_share_current(identity, &registration)?;
        let body = self.profile_http(route, method, Some(&params), &request, &registration, &call, transport).await?;
        if matches!(request.operation, ProfileMutationOperation::UsernameCheck) {
            if !body.get("available").is_some_and(Value::is_boolean) { return Err(failure("invalid_response", "Invalid username availability response")); }
            return Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(), body, readback:Value::Null, verification:"not_applicable" });
        }
        let read = self.profile_http(read_route, HttpMethod::Get, None, &request, &registration, &call, transport).await;
        self.check_share_current(identity, &registration)?;
        let readback = match read {
            Ok(readback) => readback,
            Err(error) if matches!(error.code, "account_changed" | "cancelled") => return Err(error),
            Err(_) => Value::Null,
        };
        let confirmed = match request.operation {
            ProfileMutationOperation::AccountName => validate_profile_read(&ServiceOperation::AccountMe, &readback, identity).is_ok() && readback.get("name") == params.get("name"),
            ProfileMutationOperation::Username => {
                let saved = body.pointer("/profile/username").and_then(Value::as_str);
                validate_profile_read(&ServiceOperation::ProfileIdentity, &readback, identity).is_ok() &&
                    saved.is_some_and(|saved| saved.split('~').next() == params.get("username").and_then(Value::as_str)) &&
                    readback.pointer("/profile_details/username").and_then(Value::as_str) == saved
            },
            ProfileMutationOperation::Profile => validate_profile_read(&ServiceOperation::ProfilePage, &readback, identity).is_ok() && params.as_object().unwrap().iter().all(|(key, expected)| readback["profile_details"].get(key) == Some(expected)),
            ProfileMutationOperation::UsernameCheck => false,
        };
        if matches!(request.operation, ProfileMutationOperation::AccountName) && !readback.is_null() {
            // A mismatched /me user is an identity error, not delayed profile synchronization.
            if readback.get("id").and_then(Value::as_str) != Some(identity.user_id.as_str()) {
                return Err(failure("account_changed", "Account profile does not match the authenticated user"));
            }
        }
        Ok(ProfileMutationResponse { request_id:request.request_id, identity:identity.clone(), body, readback, verification:if confirmed {"confirmed"} else {"pending"} })
    }

    #[allow(clippy::too_many_arguments)]
    async fn profile_http<F, Fut, T>(&self, route: &'static str, method: HttpMethod, body: Option<&Value>, request: &ProfileMutationRequest,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let identity = &request.expected_identity;
        self.check_share_current(identity, registration)?;
        let encoded = body.map(serde_json::to_vec).transpose().map_err(|_| failure("invalid_request", "Invalid profile request"))?.unwrap_or_default();
        if encoded.len() > 256 * 1024 { return Err(failure("invalid_request", "Profile request exceeded transport limit")); }
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled; a sent profile write may already have applied")),
            result = async {
                let mut session = self.session.lock().await;
                self.check_share_current(identity, registration)?;
                self.prepare(&mut session, identity.generation, call, false).await?;
                for attempt in 0..2 {
                    self.check_share_current(identity, registration)?;
                    let credentials = session.credentials.as_ref().unwrap();
                    if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                    let integrity = session.integrity.clone();
                    let mut outgoing = build_http_request(route, credentials, integrity.as_deref(), &request.profile)?;
                    outgoing.method = method; outgoing.body = encoded.clone();
                    if body.is_some() { outgoing.headers.insert("Content-Type".into(), "application/json".into()); }
                    share_network_allowed(call, &outgoing.url).await?;
                    self.check_share_current(identity, registration)?;
                    let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await
                        .map_err(|error| if method == HttpMethod::Patch { failure("profile_write_unknown", "Profile write outcome is unknown; read before retrying") } else { error })?;
                    self.check_share_current(identity, registration)?;
                    apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if account_instructions_ip_denied(&response) { return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) }); }
                    if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
                    if method == HttpMethod::Patch && response.status >= 500 { return Err(failure("profile_write_unknown", "Profile write outcome is unknown; read before retrying")); }
                    if method == HttpMethod::Patch && (200..300).contains(&response.status) {
                        // Only the follow-up GET establishes persistence; an empty write response is not a failure.
                        return Ok(serde_json::from_slice(&response.body).unwrap_or(Value::Null));
                    }
                    if method == HttpMethod::Patch {
                        if let Some(error) = profile_moderation_error(&response) { return Err(error); }
                    }
                    return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
                }
                unreachable!()
            } => result,
        };
        self.check_share_current(identity, registration)?;
        result
    }

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
        self.durable.invalidate();
        if let Ok(requests) = self.active.lock() {
            for cancelled in requests.values() {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
        if let Ok(mut shares) = self.shares.lock() {
            shares.clear();
        }
        if let Ok(mut reviews) = self.pinned_reviews.lock() { reviews.clear(); }
        if let Ok(mut assets) = self.images_assets.lock() { *assets = images_assets::ImagesRegistry::default(); }
        if let Ok(mut assets) = self.sites_assets.lock() { *assets = sites_assets::SitesRegistry::default(); }
        if let Ok(mut assets) = self.gpts_assets.lock() { *assets = gpts_assets::GptsRegistry::default(); }
        if let Ok(mut drafts) = self.cloud_drafts.lock() { drafts.invalidate(); }
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

    pub async fn review_pull_request<F,Fut>(&self, request_id:&str, identity:&ServiceIdentity, profile:&ServiceProfile, pull_request:&Value, connection:&Value, call:F)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.review_pull_request_with(request_id,identity,profile,pull_request,connection,call,&CurlTransport).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn review_pull_request_with<F,Fut,T>(&self,request_id:&str,identity:&ServiceIdentity,profile:&ServiceProfile,pull_request:&Value,connection:&Value,call:F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let registration=self.register(request_id)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Pull request read cancelled")),
            result=async {
                let mut account_request=json!({"hostname":pull_request["hostname"]});
                if !connection.is_null(){account_request["connection"]=connection.clone();}
                let current=self.review_github_http("account",&account_request,identity,profile,&registration,&call,transport).await?;
                let account=review_github_account(&current,pull_request,connection)?;
                let mut pr=pull_request.clone();pr.as_object_mut().ok_or_else(||failure("invalid_request","Invalid pull request identity"))?.remove("url");
                let payload=json!({"account":account,"pullRequest":pr});
                let metadata=match self.review_github_http("gh-pr-metadata-v2",&payload,identity,profile,&registration,&call,transport).await {
                    Err(error) if error.status==Some(405) || (error.status==Some(404) && error.code!="github_resource_not_found")=>
                        self.review_github_http("gh-pr-metadata",&payload,identity,profile,&registration,&call,transport).await?,
                    result=>result?,
                };
                let summaries=self.review_github_http("summaries",&json!({"account":account,"pullRequests":[pr]}),identity,profile,&registration,&call,transport).await?;
                let summary=summaries.as_array().filter(|items|items.len()==1).and_then(|items|items.first()).ok_or_else(||failure("invalid_response","Pull request summary is incomplete"))?;
                let description=self.review_github_http("gh-pr-body",&payload,identity,profile,&registration,&call,transport).await?;
                let diff=self.review_github_http("gh-pr-diff",&payload,identity,profile,&registration,&call,transport).await?;
                validate_review_read(&metadata,summary,&description,&diff)?;
                Ok(json!({"pullRequest":pull_request,"account":account,"metadata":metadata,"summary":summary,"description":description["body"],"diff":{"headRevision":diff["headRevision"],"unifiedDiff":diff["unifiedDiff"]}}))
            }=>result,
        };
        self.check_share_current(identity,&registration)?;
        result
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn review_comparison<F,Fut>(&self,request_id:&str,identity:&ServiceIdentity,profile:&ServiceProfile,pull_request:&Value,connection:&Value,preferences:&Value,snapshot_id:Option<&str>,commit_sha:Option<&str>,file:Option<(Option<String>,Option<String>)>,call:F)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>> {
        self.review_comparison_with(request_id,identity,profile,pull_request,connection,preferences,snapshot_id,commit_sha,file,call,&CurlTransport).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn review_comparison_with<F,Fut,T>(&self,request_id:&str,identity:&ServiceIdentity,profile:&ServiceProfile,pull_request:&Value,connection:&Value,preferences:&Value,snapshot_id:Option<&str>,commit_sha:Option<&str>,file:Option<(Option<String>,Option<String>)>,call:F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        if file.is_some() && snapshot_id.is_none() { return Err(failure("invalid_request","A pinned comparison is required")); }
        if let Some((base,head))=&file { validate_revision_paths(base.as_deref(),head.as_deref())?; }
        let registration=self.register(request_id)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Pinned comparison read cancelled")),
            result=async {
                let cached=if let Some(id)=snapshot_id {
                    let reviews=self.pinned_reviews.lock().map_err(|_|failure("internal_error","Comparison registry unavailable"))?;
                    let pinned=&reviews.iter().find(|(key,_)|key==id).ok_or_else(||failure("snapshot_unavailable","Pinned comparison expired; refresh it"))?.1;
                    if pinned.identity!=*identity || pinned.preferences!=*preferences || pinned.body["pullRequest"]!=*pull_request {
                        return Err(failure("snapshot_unavailable","Pinned comparison does not match the current account, instance or pull request"));
                    }
                    Some(pinned.body.clone())
                }else{None};
                let mut account_request=json!({"hostname":pull_request["hostname"]});
                if !connection.is_null(){account_request["connection"]=connection.clone();}
                let current=self.review_github_http("account",&account_request,identity,profile,&registration,&call,transport).await?;
                let account=review_github_account(&current,pull_request,connection)?;
                let mut pr=pull_request.clone();pr.as_object_mut().ok_or_else(||failure("invalid_request","Invalid pull request identity"))?.remove("url");
                let payload=json!({"account":account,"pullRequest":pr});
                let mut body=if let Some(body)=cached {
                    if body["account"]!=account { return Err(failure("github_account_unavailable","Pinned comparison belongs to a different GitHub account")); }
                    body
                }else{
                    let (metadata,snapshot)=tokio::try_join!(
                        self.review_github_http("gh-pr-metadata",&payload,identity,profile,&registration,&call,transport),
                        self.review_github_http("gh-pr-review-snapshot",&payload,identity,profile,&registration,&call,transport),
                    )?;
                    let snapshot=validate_revision_snapshot(&metadata,&snapshot)?;
                    json!({"pullRequest":pull_request,"account":account,"metadata":metadata,"snapshot":snapshot})
                };
                let comparison=revision_comparison(&body["snapshot"],commit_sha)?;
                let mut payload=payload;payload["comparison"]=comparison.clone();
                if let Some((base,head))=file {
                    payload["basePath"]=json!(base);payload["headPath"]=json!(head);
                    let response=self.review_github_http("gh-pr-revision-file",&payload,identity,profile,&registration,&call,transport).await?;
                    validate_revision_file(&response,base.as_deref(),head.as_deref())?;
                    body.as_object_mut().unwrap().remove("diff");
                    body["file"]=response;
                }else{
                    let response=self.review_github_http("gh-pr-revision-diff",&payload,identity,profile,&registration,&call,transport).await?;
                    if response["status"]!="success" || !response["unifiedDiff"].is_string() {return Err(failure("invalid_response","Revision diff is unavailable or incomplete"));}
                    if response["headRevision"]!=comparison["headRevision"] {return Err(failure("github_head_changed","Revision diff does not match the pinned comparison"));}
                    body["diff"]=json!({"headRevision":response["headRevision"],"unifiedDiff":response["unifiedDiff"]});
                }
                body["comparison"]=comparison;
                self.check_share_current(identity,&registration)?;
                let id=snapshot_id.map(str::to_owned).unwrap_or_else(||uuid::Uuid::new_v4().to_string());
                body["snapshotId"]=json!(id);
                if snapshot_id.is_none() {
                    let mut reviews=self.pinned_reviews.lock().map_err(|_|failure("internal_error","Comparison registry unavailable"))?;
                    self.check_share_current(identity,&registration)?;
                    if reviews.len()>=32 {reviews.pop_front();}
                    reviews.push_back((id,PinnedReview{identity:identity.clone(),preferences:preferences.clone(),body:body.clone()}));
                }
                Ok(body)
            }=>result,
        };
        self.check_share_current(identity,&registration)?;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn review_github_http<F,Fut,T>(&self,operation:&str,body:&Value,identity:&ServiceIdentity,profile:&ServiceProfile,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        if !["account","gh-pr-metadata-v2","gh-pr-metadata","summaries","gh-pr-body","gh-pr-diff","gh-pr-review-snapshot","gh-pr-revision-diff","gh-pr-revision-file"].contains(&operation) {
            return Err(failure("invalid_request","Unsupported pull request operation"));
        }
        let mut session=self.session.lock().await;
        self.check_share_current(identity,registration)?;
        self.prepare(&mut session,identity.generation,call,false).await?;
        for attempt in 0..2 {
            self.check_share_current(identity,registration)?;
            let credentials=session.credentials.as_ref().unwrap();
            if &credentials.identity!=identity {return Err(failure("account_changed","Authenticated identity changed"));}
            let integrity=session.integrity.clone();
            let mut outgoing=build_http_request(&format!("/backend-api/wham/github/operations/{operation}"),credentials,integrity.as_deref(),profile)?;
            outgoing.method=HttpMethod::Post;
            outgoing.headers.insert("Content-Type".into(),"application/json".into());
            outgoing.headers.insert("X-Codex-Expected-User-Id".into(),identity.user_id.clone());
            outgoing.headers.insert("X-Codex-Expected-Account-Id".into(),identity.account_id.clone());
            outgoing.body=serde_json::to_vec(body).map_err(|_|failure("invalid_request","Invalid pull request payload"))?;
            // Independent snapshot and metadata reads must not hold the session
            // mutex across their network requests.
            drop(session);
            share_network_allowed(call,&outgoing.url).await?;
            self.check_share_current(identity,registration)?;
            let timeout=match operation {"gh-pr-diff"|"gh-pr-review-snapshot"|"gh-pr-revision-diff"=>60,"gh-pr-revision-file"=>30,_=>15};
            let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(timeout)).await?;
            self.check_share_current(identity,registration)?;
            session=self.session.lock().await;
            self.check_share_current(identity,registration)?;
            apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response){return Err(ServiceError{code:"ip_not_authorized",message:"Current IP address is not authorized for this workspace",status:Some(401)});}
            if response.status==401 && attempt==0 {self.prepare(&mut session,identity.generation,call,true).await?;continue;}
            if !(200..300).contains(&response.status) {
                let error:Value=serde_json::from_slice(&response.body).unwrap_or(Value::Null);
                match review_error_code(&error) {
                    Some("github_resource_not_found")=>return Err(ServiceError{code:"github_resource_not_found",message:"Pull request is unavailable to the selected account; check repository access and SSO",status:Some(response.status)}),
                    Some("github_reauthentication_required")=>return Err(ServiceError{code:"github_reauthentication_required",message:"Selected GitHub connection requires authentication",status:Some(response.status)}),
                    _=>{},
                }
            }
            return Ok(decode_response(response,registration.id.clone(),identity.clone())?.body);
        }
        unreachable!()
    }

    pub async fn review_gitlab_instances<F, Fut>(&self, request_id: &str, identity: &ServiceIdentity, profile: &ServiceProfile, call: F) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.review_gitlab_instances_with(request_id, identity, profile, call, &CurlTransport).await
    }

    async fn review_gitlab_instances_with<F, Fut, T>(&self, request_id: &str, identity: &ServiceIdentity, profile: &ServiceProfile, call: F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        let registration = self.register(request_id)?;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "GitLab instance read cancelled")),
            result = async {
                let (templates, accessible) = tokio::try_join!(
                    self.review_gitlab_http("/backend-api/ps/connectors/by-template?template_id=templated_apps_GitLab", false, identity, profile, &registration, &call, transport),
                    self.review_gitlab_http("/backend-api/aip/connectors/links/list_accessible", true, identity, profile, &registration, &call, transport),
                )?;
                let candidates = templates["connectors"].as_array().ok_or_else(|| failure("invalid_response", "GitLab connector inventory is incomplete"))?;
                let links = accessible["links"].as_array().ok_or_else(|| failure("invalid_response", "GitLab authorizations are incomplete"))?;
                let mut instances = Vec::new();
                for candidate in candidates {
                    if !crate::review_provider::gitlab_candidate_allowed(candidate, links) { continue; }
                    let id = candidate["id"].as_str().unwrap();
                    let route = format!("/backend-api/aip/connectors/{}?include_actions=false", encode_segment(id)?);
                    let detail = match self.review_gitlab_http(&route, false, identity, profile, &registration, &call, transport).await {
                        Ok(detail) => detail,
                        Err(error) if matches!(error.status, Some(403 | 404)) => continue,
                        Err(error) => return Err(error),
                    };
                    if let Some(instance) = crate::review_provider::gitlab_instance(&detail, id) { instances.push(instance); }
                }
                Ok(json!(instances))
            } => result,
        };
        self.check_share_current(identity, &registration)?;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn review_gitlab_http<F, Fut, T>(&self, route: &str, accessible: bool, identity: &ServiceIdentity, profile: &ServiceProfile,
        registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>, T: Transport {
        for attempt in 0..2 {
            self.check_share_current(identity, registration)?;
            // Release the session lock before transport so the two official inventory reads can overlap.
            let (mut outgoing, integrity) = {
                let mut session = self.session.lock().await;
                self.prepare(&mut session, identity.generation, call, false).await?;
                let credentials = session.credentials.as_ref().unwrap();
                if &credentials.identity != identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                (build_http_request(route, credentials, session.integrity.as_deref(), profile)?, session.integrity.clone())
            };
            outgoing.headers.insert("OAI-Product-Sku".into(), "CODEX".into());
            outgoing.headers.insert("X-Codex-Surface".into(), "other".into());
            if accessible {
                outgoing.method = HttpMethod::Post;
                outgoing.headers.insert("Content-Type".into(), "application/json".into());
                outgoing.body = br#"{"principals":[],"link_refresh_strategy":"BLOCKING"}"#.to_vec();
            }
            share_network_allowed(call, &outgoing.url).await?;
            self.check_share_current(identity, registration)?;
            let response = send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(50)).await?;
            self.check_share_current(identity, registration)?;
            let mut session = self.session.lock().await;
            self.check_share_current(identity, registration)?;
            apply_integrity(&mut session.integrity, integrity.as_deref(), response.headers.get("x-oai-is-update"));
            if account_instructions_ip_denied(&response) { return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) }); }
            if response.status == 401 && attempt == 0 { self.prepare(&mut session, identity.generation, call, true).await?; continue; }
            return Ok(decode_response(response, registration.id.clone(), identity.clone())?.body);
        }
        unreachable!()
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
        if matches!(request.operation, ServiceOperation::SitesAsset) { return self.sites_asset_with(request, call, transport).await; }
        if matches!(request.operation, ServiceOperation::GptsAvatar) {
            return self.gpts_avatar_with(request, call, transport).await;
        }
        if matches!(request.operation, ServiceOperation::ImagesAsset) {
            return self.images_asset_with(request, call, transport).await;
        }
        if matches!(request.operation, ServiceOperation::LibraryFile | ServiceOperation::LibraryFileContent) {
            return self.library_file_with(request, call, transport).await;
        }
        // Resolve before credential acquisition: unsupported parameters cannot invoke auth.
        let route = resolve_read_route(&request.operation, &request.params, &request.expected_identity)?;
        let archive_tasks = matches!(request.operation, ServiceOperation::ArchiveCloudTasks);
        let gpts_read = matches!(request.operation, ServiceOperation::GptsDiscovery | ServiceOperation::GptsCategory | ServiceOperation::GptsSearch | ServiceOperation::GptsDetail | ServiceOperation::GptsAbout | ServiceOperation::GptsWorkspaceSettings);
        let sites_read = matches!(request.operation, ServiceOperation::SitesEntryAccess | ServiceOperation::SitesPinned | ServiceOperation::SitesPin | ServiceOperation::SitesAccess | ServiceOperation::SitesList | ServiceOperation::SitesShared | ServiceOperation::SitesDetail | ServiceOperation::SitesEnvironment | ServiceOperation::SitesDomains | ServiceOperation::SitesShareAccess | ServiceOperation::SitesPreferredLiveUrl | ServiceOperation::SitesWorkspaceSettings | ServiceOperation::SitesUsers | ServiceOperation::SitesGroups | ServiceOperation::SitesTeams);
        let cloud_read = matches!(request.operation, ServiceOperation::CloudWorkspaceSettings);
        let repository_read = cloud_repositories::repository_read(&request.operation);
        let images_read = matches!(request.operation, ServiceOperation::ImagesInit | ServiceOperation::ImagesStyles | ServiceOperation::ImagesRecent | ServiceOperation::ImagesWorkspaceSettings);
        // Order snapshots before the session lock, not when a possibly late response arrives.
        let images_snapshot = self.images_snapshot.fetch_add(1, Ordering::SeqCst) + 1;
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
                    let mut http_request = build_http_request(&route, credentials, sent_integrity.as_deref(), &request.profile)?;
                    if matches!(request.operation, ServiceOperation::LibraryImages | ServiceOperation::LibrarySuggested) {
                        http_request.method = HttpMethod::Post;
                        http_request.headers.insert("Content-Type".into(), "application/json".into());
                        let body=if matches!(request.operation,ServiceOperation::LibrarySuggested) {library_suggested_body(&request.params)?} else {library_images_body(&request.params)?};
                        http_request.body = serde_json::to_vec(&body)
                            .map_err(|_| failure("invalid_request", "Invalid library query"))?;
                    }
                    let usage = matches!(request.operation, ServiceOperation::WhamUsage);
                    let profile_read = matches!(request.operation, ServiceOperation::AccountMe | ServiceOperation::ProfileIdentity | ServiceOperation::ProfilePage);
                    let review_connections = matches!(request.operation, ServiceOperation::GithubConnections);
                    if review_connections {
                        http_request.headers.insert("X-Codex-Expected-User-Id".into(), request.expected_identity.user_id.clone());
                        http_request.headers.insert("X-Codex-Expected-Account-Id".into(), request.expected_identity.account_id.clone());
                    }
                    if repository_read {
                        http_request.headers.insert("OAI-Product-Sku".into(), "CODEX".into());
                        if matches!(request.operation, ServiceOperation::CloudGithubDefault | ServiceOperation::CloudGithubEnterprise | ServiceOperation::CloudGithubLinks) {
                            http_request.headers.insert("X-Codex-Surface".into(), "other".into());
                        }
                        if matches!(request.operation, ServiceOperation::CloudGithubLinks) {
                            http_request.method = HttpMethod::Post;
                            http_request.headers.insert("Content-Type".into(), "application/json".into());
                            http_request.body = br#"{"principals":[],"link_refresh_strategy":"NONE"}"#.to_vec();
                        }
                    }
                    if sites_read || cloud_read || repository_read || gpts_read || images_read || archive_tasks || profile_read || review_connections || matches!(request.operation, ServiceOperation::StorageUsage | ServiceOperation::LibraryNodes | ServiceOperation::LibraryDirectoryPath | ServiceOperation::LibraryFavorites | ServiceOperation::LibraryImages | ServiceOperation::LibrarySuggested | ServiceOperation::LibrarySettings | ServiceOperation::LibraryImage | ServiceOperation::ShareAccounts) {
                        share_network_allowed(&call, &http_request.url).await?;
                        self.check_share_current(&request.expected_identity, &registration)?;
                    }
                    if usage {
                        // Fixed official Vyr/Qbr brand, not our executable's product name.
                        http_request.headers.insert("OAI-App-Brand".into(), "chatgpt".into());
                        http_request.headers.insert("x-openai-codex-pricing-chooser".into(), "1".into());
                        share_network_allowed(&call, &http_request.url).await?;
                        self.check_share_current(&request.expected_identity, &registration)?;
                    }
                    let images_destination = (sites_read || images_read || gpts_read || cloud_read || repository_read).then(|| http_request.url.clone());
                    let response = send_bounded(transport, http_request, registration.cancelled.clone(), Duration::from_secs(if usage { 10 } else if review_connections || matches!(request.operation, ServiceOperation::SitesUsers | ServiceOperation::SitesGroups) { 15 } else { 50 })).await?;
                    if self.generation() != generation {
                        return Err(failure("account_changed", "Authenticated identity changed"));
                    }
                    if let Some(destination) = images_destination {
                        self.check_share_current(&request.expected_identity, &registration)?;
                        share_network_allowed(&call, &destination).await?;
                    }
                    if sites_read || cloud_read || gpts_read || images_read || archive_tasks || matches!(request.operation, ServiceOperation::LibraryDirectoryPath | ServiceOperation::LibrarySuggested) { self.check_share_current(&request.expected_identity, &registration)?; }
                    apply_integrity(&mut session.integrity, sent_integrity.as_deref(), response.headers.get("x-oai-is-update"));
                    if archive_tasks && account_instructions_ip_denied(&response) {
                        // A workspace IP refusal is not NDn's unavailable/unsupported source.
                        return Err(ServiceError { code:"ip_not_authorized", message:"Current IP address is not authorized for this workspace", status:Some(401) });
                    }
                    if response.status == 401 && attempt == 0 && !((usage || profile_read || review_connections || repository_read) && account_instructions_ip_denied(&response)) {
                        self.prepare(&mut session, generation, &call, true).await?;
                        continue;
                    }
                    if ((usage || archive_tasks) && matches!(response.status, 401 | 403 | 404)) ||
                        (matches!(request.operation, ServiceOperation::CloudGithubDefault) && matches!(response.status, 403 | 404)) ||
                        (matches!(request.operation, ServiceOperation::ProfileIdentity | ServiceOperation::ProfilePage) && matches!(response.status, 403 | 404)) {
                        return Ok(ServiceResponse { request_id:request.request_id.clone(), identity:request.expected_identity.clone(),
                            status:response.status, body:Value::Null, headers:BTreeMap::new(), assets:None, gpt_assets:None,site_assets:None });
                    }
                    let mut decoded = decode_response(response, request.request_id.clone(), request.expected_identity.clone())?;
                    if repository_read {
                        decoded.body = cloud_repositories::repository_body(&request.operation, &decoded.body)?;
                    }
                    if matches!(request.operation, ServiceOperation::SitesList | ServiceOperation::SitesShared | ServiceOperation::SitesPinned | ServiceOperation::SitesDetail) { decoded.site_assets = Some(self.register_sites_assets(&request, &decoded.body, &session.credentials.as_ref().unwrap().origin, images_snapshot)?); }
                    if matches!(request.operation, ServiceOperation::GptsDiscovery | ServiceOperation::GptsCategory | ServiceOperation::GptsSearch | ServiceOperation::GptsDetail) {
                        decoded.gpt_assets = Some(self.register_gpts_assets(&request, &decoded.body, &session.credentials.as_ref().unwrap().origin, images_snapshot)?);
                    }
                    if matches!(request.operation, ServiceOperation::ImagesInit | ServiceOperation::ImagesStyles | ServiceOperation::ImagesRecent) {
                        decoded.assets = Some(self.register_images_assets(&request, &decoded.body,
                            &session.credentials.as_ref().unwrap().origin, images_snapshot)?);
                    }
                    if matches!(request.operation, ServiceOperation::LibraryImage) {
                        if decoded.body.get("status").and_then(Value::as_str).is_some_and(|s|matches!(s,"retry"|"processing"|"pending")) {
                            return Err(failure("processing","Library image download is not ready"));
                        }
                        let target = decoded.body.get("content_url").or_else(|| decoded.body.get("download_url"))
                            .and_then(Value::as_str).ok_or_else(|| failure(if decoded.body.get("status").and_then(Value::as_str).is_some_and(|s| matches!(s,"processing"|"pending")) {"processing"} else {"invalid_response"}, "Library image download is not ready"))?;
                        let credentials=session.credentials.as_ref().unwrap().clone();
                        let integrity=session.integrity.clone();
                        drop(session);
                        decoded.body = self.library_image_bytes(target, &credentials, integrity.as_deref(), &request, &registration, &call, transport).await?;
                        return Ok(decoded);
                    }
                    if profile_read { validate_profile_read(&request.operation, &decoded.body, &request.expected_identity)?; }
                    if usage && wham_usage_identity(&decoded.body, &request.expected_identity)? {
                        // The official personal-account payload may use an empty account_id.
                        // Verify real membership; a renderer-supplied personal flag is not evidence.
                        let credentials = session.credentials.as_ref().unwrap();
                        if credentials.identity != request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                        let integrity = session.integrity.clone();
                        let account_request = build_http_request("/backend-api/wham/accounts/check", credentials, integrity.as_deref(), &request.profile)?;
                        share_network_allowed(&call, &account_request.url).await?;
                        self.check_share_current(&request.expected_identity, &registration)?;
                        let account_response = send_bounded(transport, account_request, registration.cancelled.clone(), Duration::from_secs(50)).await?;
                        self.check_share_current(&request.expected_identity, &registration)?;
                        apply_integrity(&mut session.integrity, integrity.as_deref(), account_response.headers.get("x-oai-is-update"));
                        if account_response.status == 401 && attempt == 0 && !account_instructions_ip_denied(&account_response) {
                            self.prepare(&mut session, generation, &call, true).await?;
                            continue;
                        }
                        let accounts = decode_response(account_response, request.request_id.clone(), request.expected_identity.clone())?;
                        if !wham_usage_personal_account(&accounts.body, &request.expected_identity) {
                            return Err(failure("account_changed", "Usage response does not match the selected account"));
                        }
                    }
                    return Ok(decoded);
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
        if sites_read || cloud_read || repository_read || gpts_read || images_read || archive_tasks || matches!(request.operation, ServiceOperation::LibraryDirectoryPath | ServiceOperation::LibrarySuggested) { self.check_share_current(&request.expected_identity, &registration)?; }
        result
    }

    async fn library_file_with<F, Fut, T>(&self, request: ServiceRequest, call: F, transport: &T) -> ServiceResult<ServiceResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output=Result<Value,String>>, T: Transport {
        let content=matches!(request.operation,ServiceOperation::LibraryFileContent);
        let (id,route)=library_file_route(&request.params,content)?;
        let download=request.params["download"]==true;
        let registration=self.register(&request.request_id)?;
        self.check_share_current(&request.expected_identity,&registration)?;
        let result=tokio::select! {
            _=cancelled(&registration.cancelled)=>Err(failure("cancelled","Service request cancelled")),
            result=async {
                let body=if content {
                    let deadline=tokio::time::Instant::now()+Duration::from_secs(15);
                    let retry_download=!download && route.starts_with("/backend-api/files/download/");
                    let mut delay=500u64;
                    let mut attempt=0;
                    let body=loop {
                        let body=self.library_file_json(&route,None,&request,&registration,&call,transport).await?;
                        if body["status"]!="retry" || !retry_download {break body;}
                        let remaining=deadline.saturating_duration_since(tokio::time::Instant::now());
                        if attempt==9 || remaining.is_zero(){return Err(failure("processing","Library file is not ready"));}
                        tokio::time::sleep(Duration::from_millis(delay).min(remaining)).await;
                        self.check_share_current(&request.expected_identity,&registration)?;
                        delay=library_file_retry_delay(delay);attempt+=1;
                    };
                    if body.get("status").and_then(Value::as_str).is_some_and(|status|matches!(status,"retry"|"processing"|"pending")) {return Err(failure("processing","Library file is not ready"));}
                    if body["status"]=="error" {return Err(failure("service_error","Library file download failed"));}
                    let target=if download {body.get("download_url")} else {body.get("content_url").or_else(||body.get("download_url"))};
                    let target=target.and_then(Value::as_str)
                        .filter(|url|!url.trim().is_empty()).ok_or_else(||failure("invalid_response","Library file URL is missing"))?;
                    let origin={let session=self.session.lock().await;self.check_share_current(&request.expected_identity,&registration)?;session.credentials.as_ref().unwrap().origin.clone()};
                    self.library_file_bytes(target,&origin,&request,&registration,&call,transport).await?
                } else {
                    let direct_node=id.starts_with("libfile_fde1_") || id.starts_with("libfile_fde2_") || id.starts_with("libfile_fde3_");
                    let node_route=format!("{route}/node");
                    if direct_node {
                        validate_library_file(self.library_file_json(&node_route,None,&request,&registration,&call,transport).await?,&id,true)?
                    } else {
                        match self.library_file_json(&route,None,&request,&registration,&call,transport).await {
                            Ok(body)=>validate_library_file(body,&id,false)?,
                            Err(error) if matches!(error.status,Some(403|404))=>{
                                let mut node=None;
                                let fallback_error=match self.library_file_json(&node_route,None,&request,&registration,&call,transport).await {
                                    Ok(body)=>{
                                        let mut body=validate_library_file(body,&id,false)?;
                                        if body["access_kind"]=="owned" && body["library_file_category"]=="image" && body["library_artifact_type"].is_null() {
                                            node=Some(body.clone());
                                            match self.library_file_json(&format!("{route}/versions?limit=1"),None,&request,&registration,&call,transport).await {
                                                Ok(versions)=>{if let Some(kind)=versions.pointer("/items/0/library_artifact_type"){body["library_artifact_type"]=kind.clone();}return Ok(body);},
                                                Err(error) if matches!(error.status,Some(403|404))=>error,
                                                Err(error)=>return Err(error),
                                            }
                                        } else {return validate_library_file(body,&id,true);}
                                    },
                                    Err(error) if matches!(error.status,Some(403|404))=>error,
                                    Err(error)=>return Err(error),
                                };
                                let mut cursor=Value::Null;let mut seen=std::collections::HashSet::new();
                                loop {
                                    let page=self.library_file_json("/backend-api/files/library",Some(json!({"cursor":cursor,"limit":100,"include_hidden_files":true,"include_saved_entities":true})),&request,&registration,&call,transport).await?;
                                    let items=page["items"].as_array().ok_or_else(||failure("invalid_response","Library file list is invalid"))?;
                                    if let Some(found)=items.iter().find(|item|item["id"].as_str()==Some(&id)){break validate_library_file(found.clone(),&id,false)?;}
                                    cursor=page.get("cursor").cloned().unwrap_or(Value::Null);
                                    if cursor.is_null(){break validate_library_file(node.ok_or(fallback_error)?,&id,true)?;}
                                    let next=cursor.as_str().filter(|s|!s.is_empty() && s.len()<=2048 && !s.chars().any(char::is_control)).ok_or_else(||failure("invalid_response","Invalid library cursor"))?;
                                    if !seen.insert(next.to_owned()){break validate_library_file(node.ok_or(fallback_error)?,&id,true)?;}
                                }
                            },
                            Err(error)=>return Err(error),
                        }
                    }
                };
                Ok(body)
            }=>result,
        };
        self.check_share_current(&request.expected_identity,&registration)?;
        result.map(|body|ServiceResponse{request_id:request.request_id,identity:request.expected_identity,status:200,
            body:if content {body} else {json!({"requestedFileId":id,"file":body})},headers:BTreeMap::new(),assets:None,gpt_assets:None,site_assets:None})
    }

    #[allow(clippy::too_many_arguments)]
    async fn library_file_json<F,Fut,T>(&self,route:&str,body:Option<Value>,request:&ServiceRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        self.check_share_current(&request.expected_identity,registration)?;
        let mut session=self.session.lock().await;
        self.prepare(&mut session,request.expected_identity.generation,call,false).await?;
        for attempt in 0..2 {
            self.check_share_current(&request.expected_identity,registration)?;
            let credentials=session.credentials.as_ref().unwrap();
            if credentials.identity!=request.expected_identity{return Err(failure("account_changed","Authenticated identity changed"));}
            let integrity=session.integrity.clone();let mut outgoing=build_http_request(route,credentials,integrity.as_deref(),&request.profile)?;
            if let Some(body)=&body {outgoing.method=HttpMethod::Post;outgoing.body=serde_json::to_vec(body).map_err(|_|failure("invalid_request","Invalid library request"))?;outgoing.headers.insert("Content-Type".into(),"application/json".into());}
            share_network_allowed(call,&outgoing.url).await?;self.check_share_current(&request.expected_identity,registration)?;
            let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
            self.check_share_current(&request.expected_identity,registration)?;
            apply_integrity(&mut session.integrity,integrity.as_deref(),response.headers.get("x-oai-is-update"));
            if response.status==401 && attempt==0 && !account_instructions_ip_denied(&response){self.prepare(&mut session,request.expected_identity.generation,call,true).await?;continue;}
            return Ok(decode_response(response,registration.id.clone(),request.expected_identity.clone())?.body);
        }
        unreachable!()
    }

    #[allow(clippy::too_many_arguments)]
    async fn library_file_bytes<F,Fut,T>(&self,target:&str,service_origin:&str,request:&ServiceRequest,registration:&Registration<'_>,call:&F,transport:&T)->ServiceResult<Value>
    where F:Fn(&'static str,Value)->Fut,Fut:Future<Output=Result<Value,String>>,T:Transport {
        let mut url=library_file_url(target,service_origin)?;
        let origin=tauri::Url::parse(service_origin).map_err(|_|failure("invalid_response","Invalid service origin"))?;
        if url.origin()==origin.origin() && !url.query_pairs().any(|(key,_)|key=="page_id" || key=="file_id") {
            if let Some(rest)=url.path().strip_prefix("/backend-api/files/library/files/") {
                if let Some((id,action))=rest.rsplit_once('/') {
                    let endpoint=match action {"content_redirect"=>Some("content_url"),"download_redirect"=>Some("download_url"),"thumbnail_redirect"=>Some("thumbnail_url"),_=>None};
                    if let Some(endpoint)=endpoint {
                        if id.is_empty() || id.contains('/') {return Err(failure("invalid_response","Invalid library redirect identifier"));}
                        let resolved=self.library_file_json(&format!("/backend-api/files/library/files/{id}/{endpoint}"),None,request,registration,call,transport).await?;
                        let target=resolved.get("content_url").or_else(||resolved.get("download_url")).or_else(||resolved.get("thumbnail_url")).and_then(Value::as_str)
                            .ok_or_else(||failure("invalid_response","Library file URL is missing"))?;
                        url=library_file_url(target,service_origin)?;
                    }
                }
            }
        }
        for redirect in 0..=5 {
            self.check_share_current(&request.expected_identity,registration)?;
            share_network_allowed(call,url.as_str()).await?;self.check_share_current(&request.expected_identity,registration)?;
            let origin=tauri::Url::parse(service_origin).map_err(|_|failure("invalid_response","Invalid service origin"))?;
            let authenticated=url.origin()==origin.origin() && url.path().starts_with("/backend-api/");
            let mut auth_attempt=0;
            let response=loop {
                let (outgoing,sent_integrity)=if authenticated {
                    let mut session=self.session.lock().await;
                    self.prepare(&mut session,request.expected_identity.generation,call,false).await?;
                    self.check_share_current(&request.expected_identity,registration)?;
                    let credentials=session.credentials.as_ref().unwrap();
                    if credentials.identity!=request.expected_identity || credentials.origin!=service_origin {return Err(failure("account_changed","Authenticated identity or routing changed"));}
                    let integrity=session.integrity.clone();
                    (build_http_request(&format!("{}{}",url.path(),url.query().map(|q|format!("?{q}")).unwrap_or_default()),credentials,integrity.as_deref(),&request.profile)?,integrity)
                } else {(HttpRequest{url:url.to_string(),headers:BTreeMap::new(),method:HttpMethod::Get,body:Vec::new()},None)};
                let response=tokio::time::timeout(Duration::from_secs(50),transport.send_library_file(outgoing,registration.cancelled.clone())).await.unwrap_or_else(|_|Err(failure("timeout","Library file read timed out")))?;
                self.check_share_current(&request.expected_identity,registration)?;
                if authenticated {
                    let mut session=self.session.lock().await;
                    self.check_share_current(&request.expected_identity,registration)?;
                    apply_integrity(&mut session.integrity,sent_integrity.as_deref(),response.headers.get("x-oai-is-update"));
                    if response.status==401 && auth_attempt==0 && !account_instructions_ip_denied(&response) {
                        self.prepare(&mut session,request.expected_identity.generation,call,true).await?;
                        auth_attempt+=1;continue;
                    }
                }
                break response;
            };
            if matches!(response.status,301|302|303|307|308){
                if redirect==5{return Err(failure("invalid_response","Too many library file redirects"));}
                let target=response.headers.get("location").ok_or_else(||failure("invalid_response","Missing library redirect"))?;
                url=library_file_url(url.join(target).map_err(|_|failure("invalid_response","Invalid library redirect"))?.as_str(),service_origin)?;continue;
            }
            if !(200..300).contains(&response.status){return Err(ServiceError{code:match response.status{401=>"unauthorized",403=>"forbidden",404=>"not_found",429=>"rate_limited",_=>"service_error"},message:"Library file read failed",status:Some(response.status)});}
            if response.body.len() as u64>MAX_LIBRARY_FILE{return Err(failure("response_too_large","Library file exceeds 40 MiB"));}
            let mime=response.headers.get("content-type").filter(|mime|mime.len()<=256 && !mime.chars().any(char::is_control)).cloned().unwrap_or_else(||"application/octet-stream".into());
            return Ok(json!({"bytesBase64":base64::engine::general_purpose::STANDARD.encode(response.body),"mimeType":mime}));
        }
        unreachable!()
    }

    #[allow(clippy::too_many_arguments)]
    async fn library_image_bytes<F, Fut, T>(&self, target: &str, credentials: &Credentials, integrity: Option<&str>, request: &ServiceRequest, registration: &Registration<'_>, call: &F, transport: &T) -> ServiceResult<Value>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output=Result<Value,String>>, T: Transport {
        let mut url=library_image_url(target,&credentials.origin)?;
        for redirect in 0..=5 {
            self.check_share_current(&request.expected_identity,registration)?;
            share_network_allowed(call,url.as_str()).await?;
            self.check_share_current(&request.expected_identity,registration)?;
            let origin=tauri::Url::parse(&credentials.origin).map_err(|_| failure("invalid_response","Invalid service origin"))?;
            let outgoing=if url.origin()==origin.origin() && url.path().starts_with("/backend-api/") {
                let route=format!("{}{}",url.path(),url.query().map(|q|format!("?{q}")).unwrap_or_default());
                build_http_request(&route,credentials,integrity,&request.profile)?
            } else { HttpRequest {url:url.to_string(),headers:BTreeMap::new(),method:HttpMethod::Get,body:Vec::new()} };
            let response=send_bounded(transport,outgoing,registration.cancelled.clone(),Duration::from_secs(50)).await?;
            self.check_share_current(&request.expected_identity,registration)?;
            if matches!(response.status,301|302|303|307|308) {
                if redirect==5 { return Err(failure("invalid_response","Too many library image redirects")); }
                let location=response.headers.get("location").ok_or_else(|| failure("invalid_response","Missing image redirect target"))?;
                let next=url.join(location).map_err(|_| failure("invalid_response","Invalid image redirect target"))?.to_string();
                url=library_image_url(&next,&credentials.origin)?;
                continue;
            }
            if !(200..300).contains(&response.status) {
                return Err(ServiceError {code:match response.status {401=>"unauthorized",403=>"forbidden",404=>"not_found",429=>"rate_limited",_=>"service_error"},message:"Library image download failed".into(),status:Some(response.status)});
            }
            if response.body.len() as u64>MAX_RESPONSE { return Err(failure("invalid_response","Library image is too large")); }
            let mime=library_image_mime(&response.body).ok_or_else(|| failure("invalid_response","Library response is not a supported image"))?;
            return Ok(json!({"dataUrl":format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(response.body))}));
        }
        unreachable!()
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
    if matches!(operation, ServiceOperation::ImagesWorkspaceSettings | ServiceOperation::GptsWorkspaceSettings | ServiceOperation::CloudWorkspaceSettings | ServiceOperation::SitesWorkspaceSettings) {
        if !params.as_object().is_some_and(|params| params.is_empty()) {
            return Err(failure("invalid_request", "Workspace settings does not accept parameters"));
        }
        return Ok(format!("/backend-api/accounts/{}/settings", encode_segment(&identity.account_id)?));
    }
    if matches!(operation, ServiceOperation::SitesTeams) {
        let params=params.as_object().filter(|params|params.len()==1 && params.contains_key("offset"))
            .ok_or_else(||failure("invalid_request","Sites teams accepts only offset"))?;
        let offset=params["offset"].as_u64().filter(|offset|*offset<=9_007_199_254_740_991)
            .ok_or_else(||failure("invalid_request","Invalid Sites teams offset"))?;
        return Ok(format!("/backend-api/accounts/{}/teams?offset={offset}&limit=100",encode_segment(&identity.account_id)?));
    }
    if !matches!(operation, ServiceOperation::ShareAccounts | ServiceOperation::ShareUsers | ServiceOperation::ShareGroups | ServiceOperation::SitesUsers | ServiceOperation::SitesGroups) {
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
    let sites_search=matches!(operation,ServiceOperation::SitesUsers|ServiceOperation::SitesGroups);
    let query = params["query"].as_str()
        .map(|query|if sites_search{sites_settings::javascript_trim(query)}else{query.trim()})
        .filter(|query| !query.is_empty() && (sites_search || query.len() <= 512) && !query.chars().any(char::is_control))
        .ok_or_else(|| failure("invalid_request", "Invalid share recipient query"))?;
    let account = encode_segment(&identity.account_id)?;
    let users = matches!(operation, ServiceOperation::ShareUsers | ServiceOperation::SitesUsers);
    let kind = if users { "users" } else { "groups" };
    let mut url = tauri::Url::parse(&format!("https://chatgpt.com/backend-api/accounts/{account}/{kind}"))
        .map_err(|_| failure("invalid_request", "Invalid share search route"))?;
    url.query_pairs_mut().append_pair("limit", "10").append_pair("offset", "0").append_pair("query", query);
    if users {
        url.query_pairs_mut().append_pair("include_profile_photos", "false");
    } else {
        url.query_pairs_mut().append_pair("include_member_counts", if matches!(operation,ServiceOperation::SitesGroups){"true"}else{"false"}).append_pair("include_total", "false");
    }
    Ok(format!("{}?{}", url.path(), url.query().unwrap()))
}

fn resolve_route(operation: &ServiceOperation, params: &Value) -> ServiceResult<String> {
    if matches!(operation, ServiceOperation::ArchiveCloudTasks) { return archive_cloud_tasks_route(params); }
    if matches!(operation, ServiceOperation::LibraryDirectoryPath) { return library_directory_path_route(params); }
    if matches!(operation, ServiceOperation::LibraryImage) { return library_image_route(params); }
    if matches!(operation, ServiceOperation::LibraryImages | ServiceOperation::LibrarySuggested) {
        if matches!(operation, ServiceOperation::LibrarySuggested) {library_suggested_body(params)?;} else {library_images_body(params)?;}
        return Ok("/backend-api/files/library".into());
    }
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
                "entry_surface",
                "cursor",
                "q",
                "categories",
                "source",
                "include_hidden_files",
                "include_files",
                "include_saved_entities",
                "include_provider_roots",
                "include_pages",
                "defer_page_sharing_badges",
                "defer_sharing_badges",
                "enable_page_type_filters",
                "include_sites",
                "include_folder_counts",
                "include_onedrive",
                "hydrate_folder_thumbnails",
            ],
        ),
        ServiceOperation::StorageUsage => ("/backend-api/files/library/storage/usage".into(), &[]),
        ServiceOperation::LibrarySettings => ("/backend-api/settings/user".into(), &[]),
        ServiceOperation::LibraryImages | ServiceOperation::LibrarySuggested => unreachable!(),
        ServiceOperation::LibraryImage | ServiceOperation::LibraryFile | ServiceOperation::LibraryFileContent => unreachable!(),
        ServiceOperation::LibraryDirectoryPath => unreachable!(),
        ServiceOperation::WhamUsage => ("/backend-api/wham/usage".into(), &[]),
        ServiceOperation::ArchiveCloudTasks => unreachable!(),
        ServiceOperation::AccountMe => ("/backend-api/me".into(), &[]),
        ServiceOperation::ProfileIdentity => ("/backend-api/profiles/me".into(), &[]),
        ServiceOperation::ProfilePage => ("/backend-api/profiles/me/page".into(), &[]),
        ServiceOperation::ImagesInit => ("/backend-api/images/init".into(), &[]),
        ServiceOperation::GptsAvatar => return Err(failure("invalid_request", "Registered GPT avatar reference required")),
        ServiceOperation::ImagesAsset => return Err(failure("invalid_request", "Registered image reference required")),
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
        ServiceOperation::SitesAsset => return Err(failure("invalid_request", "Registered Sites screenshot required")),
        ServiceOperation::SitesEntryAccess => ("/backend-api/codex/sites/access".into(), &[]),
        ServiceOperation::SitesPinned => ("/backend-api/websites/pinned".into(), &["limit", "query", "after"]),
        ServiceOperation::SitesAccess => ("/backend-api/websites/access".into(), &[]),
        ServiceOperation::ImagesWorkspaceSettings | ServiceOperation::GptsWorkspaceSettings | ServiceOperation::CloudWorkspaceSettings | ServiceOperation::SitesWorkspaceSettings | ServiceOperation::SitesUsers | ServiceOperation::SitesGroups | ServiceOperation::SitesTeams | ServiceOperation::ShareAccounts | ServiceOperation::ShareUsers | ServiceOperation::ShareGroups => {
            return Err(failure("invalid_request", "Identity-bound share route required"));
        }
        ServiceOperation::GithubRepository => {
            let id = params.get("id").and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_request", "Repository identifier required"))?;
            (format!("/backend-api/wham/github/repositories/{}", encode_segment(id)?), &["id"])
        }
        ServiceOperation::GithubConnections => ("/backend-api/wham/github/connections".into(), &[]),
        ServiceOperation::CloudGithubDefault | ServiceOperation::CloudGithubEnterprise | ServiceOperation::CloudGithubLinks
        | ServiceOperation::CloudGithubInstallations | ServiceOperation::CloudGithubRepositories => {
            return cloud_repositories::repository_route(operation, &Value::Object(params.clone()));
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
        | ServiceOperation::SitesPin
        | ServiceOperation::SitesShareAccess
        | ServiceOperation::SitesPreferredLiveUrl => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| failure("invalid_request", "Site identifier required"))?;
            let suffix = match operation {
                ServiceOperation::SitesPin => "/pin",
                ServiceOperation::SitesEnvironment => "/environment",
                ServiceOperation::SitesDomains => "/custom_domains",
                ServiceOperation::SitesShareAccess => "/share_access",
                ServiceOperation::SitesPreferredLiveUrl => "/preferred_live_url",
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
            || key == "defer_page_sharing_badges"
            || key == "defer_sharing_badges"
            || key == "enable_page_type_filters"
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

fn library_directory_path_route(params: &Value) -> ServiceResult<String> {
    let params = params.as_object().ok_or_else(|| failure("invalid_request", "Library directory path parameters must be an object"))?;
    if params.keys().any(|key| key != "directory_id") {
        return Err(failure("invalid_request", "Library directory path accepts only directory_id"));
    }
    let directory = match params.get("directory_id") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) if !id.trim().is_empty() && id.len() <= 2048 && !id.chars().any(char::is_control) => Some(id.as_str()),
        _ => return Err(failure("invalid_request", "Invalid library directory identifier")),
    };
    let path = "/backend-api/files/library/directories/path";
    let Some(directory) = directory else { return Ok(path.into()); };
    let mut url = tauri::Url::parse(&format!("https://chatgpt.com{path}"))
        .map_err(|_| failure("invalid_request", "Invalid library directory path route"))?;
    url.query_pairs_mut().append_pair("directory_id", directory);
    Ok(format!("{}?{}", url.path(), url.query().unwrap()))
}

fn archive_cloud_tasks_route(params: &Value) -> ServiceResult<String> {
    let params = params.as_object().ok_or_else(|| failure("invalid_request", "Archive task parameters must be an object"))?;
    if params.keys().any(|key| key != "cursor") {
        return Err(failure("invalid_request", "Archive tasks accept only cursor"));
    }
    let cursor = match params.get("cursor") {
        None | Some(Value::Null) => None,
        Some(Value::String(cursor)) if cursor.len() <= 2048 && !cursor.chars().any(char::is_control) => Some(cursor.as_str()),
        _ => return Err(failure("invalid_request", "Invalid archive task cursor")),
    };
    let mut url = tauri::Url::parse("https://chatgpt.com/backend-api/wham/tasks/list")
        .map_err(|_| failure("invalid_request", "Invalid archive task route"))?;
    url.query_pairs_mut().append_pair("limit", "20").append_pair("task_filter", "archived");
    if let Some(cursor) = cursor { url.query_pairs_mut().append_pair("cursor", cursor); }
    Ok(format!("{}?{}", url.path(), url.query().unwrap()))
}

fn library_suggested_body(params:&Value)->ServiceResult<Value> {
    let params=params.as_object().ok_or_else(||failure("invalid_request","Library parameters must be an object"))?;
    let mut body=json!({"cursor":null,"limit":50,"categories":[],"source":null,"include_hidden_files":false,
        "include_saved_entities":true,"include_sites":false,"trashed_only":false,"ranking":"suggested","providers":[]});
    for (key,value) in params {
        let valid=match key.as_str() {
            "cursor"=>value.is_null() || value.as_str().is_some_and(|cursor|!cursor.trim().is_empty() && cursor.len()<=2048 && !cursor.chars().any(char::is_control)),
            "source"=>value.is_null() || matches!(value.as_str(),Some("uploaded"|"generated")),
            "categories"=>value.as_array().is_some_and(|categories|categories.len()<=20 && categories.iter().all(|category|matches!(category.as_str(),Some("images"|"documents"|"spreadsheets"|"presentations"|"pdfs")))),
            _=>false,
        };
        if !valid{return Err(failure("invalid_request","Unsupported library suggested parameter"));}
        body[key]=value.clone();
    }
    Ok(body)
}

fn library_images_body(params: &Value) -> ServiceResult<Value> {
    let params = params.as_object()
        .ok_or_else(|| failure("invalid_request", "Library parameters must be an object"))?;
    let mut body = json!({"cursor":null,"limit":50,"categories":["image"],"source":null,
        "include_hidden_files":false,"include_saved_entities":true,"include_sites":false,"trashed_only":false});
    for (key, value) in params {
        match key.as_str() {
            "cursor" | "source" if value.is_null() || value.as_str().is_some_and(|s| !s.trim().is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control)) => {
                body[key] = value.clone();
            }
            "exclude_saved_responses" if value.is_boolean() => { body[key] = value.clone(); }
            _ => return Err(failure("invalid_request", "Unsupported library query parameter")),
        }
    }
    Ok(body)
}

fn library_file_route(params:&Value,content:bool)->ServiceResult<(String,String)> {
    let params=params.as_object().ok_or_else(||failure("invalid_request","Library file identifiers required"))?;
    let download=params.get("download")==Some(&Value::Bool(true));
    for (key,value) in params {
        if content && key=="download" && download {continue;}
        if !(key=="library_file_id" || content && matches!(key.as_str(),"file_id"|"gizmo_id")) || value.as_str().is_none_or(|id|id.trim().is_empty() || encode_segment(id).is_err()) {
            return Err(failure("invalid_request","Invalid library file identifier"));
        }
    }
    let id=params.get("library_file_id").and_then(Value::as_str).ok_or_else(||failure("invalid_request","Library file identifier required"))?;
    if !native_library_id(id) {
        return Err(failure("invalid_request","Only native Library file identifiers are supported"));
    }
    let mut route=format!("/backend-api/files/library/files/{}",encode_segment(id)?);
    if content {
        let target=if id.strip_prefix("libfile_fde").and_then(|rest|rest.split_once('_')).is_some_and(|(version,_)|!version.is_empty() && version.bytes().all(|b|b.is_ascii_digit())) {id} else {params.get("file_id").and_then(Value::as_str).unwrap_or(id)};
        if native_library_id(target) {
            let endpoint=if download {"download_url"} else {"content_url"};
            route=format!("/backend-api/files/library/files/{}/{endpoint}",encode_segment(target)?);
        } else {
            route=format!("/backend-api/files/download/{}",encode_segment(&target.replace('#',"*"))?.replace("%2A","*"));
            if !download {route.push_str("?inline=true");}
            if let Some(gizmo)=params.get("gizmo_id").and_then(Value::as_str) {
                let separator=if download {'?'} else {'&'};
                route.push_str(&format!("{separator}gizmo_id={}",encode_segment(gizmo)?));
            }
        }
    }
    Ok((id.into(),route))
}

fn library_file_retry_delay(delay:u64)->u64 { delay.saturating_mul(8).div_ceil(5).min(4000) }

fn native_library_id(id:&str)->bool {
    (id.starts_with("libfile_") || id.starts_with("libfile-")) && id.len()>8 && id.bytes().all(|b|b.is_ascii_alphanumeric() || b"_-".contains(&b))
}

fn fde_library_id(id:&str)->bool {
    ["libfile_fde1_","libfile_fde2_","libfile_fde3_"].iter().any(|prefix|id.starts_with(prefix))
}

fn validate_library_file(mut body:Value,id:&str,canonical:bool)->ServiceResult<Value> {
    if !body.is_object() || body["id"].as_str()!=Some(id) {return Err(failure("invalid_response","Library file metadata does not match the requested file"));}
    if canonical {
        if let Some(value)=body.get("canonical_file_id").filter(|value|!value.is_null()) {
            let target=value.as_str().filter(|target|native_library_id(target) && fde_library_id(target));
            if body["kind"]!="file" || body["access_kind"]!="shared" || fde_library_id(id) || target.is_none() {
                return Err(failure("invalid_response","Shared Library file metadata does not match the request"));
            }
            body["id"]=json!(target.unwrap());
        }
    }
    Ok(body)
}

fn library_image_route(params: &Value) -> ServiceResult<String> {
    let params=params.as_object().ok_or_else(||failure("invalid_request","Library image identifiers required"))?;
    for (key,value) in params {
        if !matches!(key.as_str(),"library_file_id"|"file_id"|"gizmo_id") || value.as_str().is_none_or(|s|s.trim().is_empty() || encode_segment(s).is_err()) {
            return Err(failure("invalid_request","Invalid library image identifier"));
        }
    }
    if let Some(id)=params.get("library_file_id").and_then(Value::as_str) {
        if let Some(rest)=id.strip_prefix("libfile_fde") {
            if rest.split_once('_').is_some_and(|(n,_)|!n.is_empty() && n.bytes().all(|b|b.is_ascii_digit())) {
                return Ok(format!("/backend-api/files/library/files/{}/content_url",encode_segment(id)?));
            }
        }
    }
    let id=params.get("file_id").and_then(Value::as_str).ok_or_else(||failure("invalid_request","File identifier required"))?;
    let mut route=format!("/backend-api/files/download/{}?inline=true",encode_segment(&id.replace('#',"*"))?.replace("%2A","*"));
    if let Some(id)=params.get("gizmo_id").and_then(Value::as_str) { route.push_str(&format!("&gizmo_id={}",encode_segment(id)?)); }
    Ok(route)
}

fn library_file_url(target:&str,origin:&str)->ServiceResult<tauri::Url> {
    if target.contains('\\') || target.len()>16384 || target.chars().any(char::is_control) {return Err(failure("invalid_response","Invalid library file target"));}
    let mut url=library_image_url(target.trim(),origin)?;
    let service=tauri::Url::parse(origin).map_err(|_|failure("invalid_response","Invalid service origin"))?;
    if url.origin()==service.origin() {
        let path=url.path().to_owned();
        let mapped=if let Some(path)=path.strip_prefix("/__codex-api/") {Some(format!("/backend-api/{path}"))}
            else if matches!(path.as_str(),"/estuary/content"|"/estuary/content/") || path.strip_prefix("/estuary/public_content/enc/").is_some_and(|id|!id.is_empty() && !id.contains('/')) {Some(format!("/backend-api{path}"))}
            else {path.strip_prefix("/library/files/").filter(|path|path.ends_with("/thumbnail") && path.split('/').count()==2).map(|path|format!("/api/library/files/{path}"))};
        if let Some(path)=mapped {url.set_path(&path);}
    }
    library_image_url(url.as_str(),origin)
}

fn library_image_url(target: &str, origin: &str) -> ServiceResult<tauri::Url> {
    if target.len()>16384 || target.chars().any(char::is_control) { return Err(failure("invalid_response","Invalid image target")); }
    let mut url=if target.starts_with('/') && !target.starts_with("//") {
        tauri::Url::parse(&format!("{origin}{target}"))
    } else { tauri::Url::parse(target) }.map_err(|_|failure("invalid_response","Invalid image target"))?;
    let host=tauri::Url::parse(origin).map_err(|_|failure("invalid_response","Invalid service origin"))?;
    if url.origin()==host.origin() {
        let path=url.path().to_owned();
        if let Some(rest)=path.strip_prefix("/api/library/files/") {
            if let Some((id,action))=rest.rsplit_once('/') {
                let mapped=match action {"content"=>"content_redirect","download"=>"download_redirect","thumbnail"=>"thumbnail_redirect","project-content"=>"project_content",_=>return Err(failure("invalid_response","Unsupported image route"))};
                url.set_path(&format!("/backend-api/files/library/files/{id}/{mapped}"));
            }
        } else if path.starts_with("/files/") { url.set_path(&format!("/backend-api{path}")); }
    }
    validate_share_target(&ShareUploadTarget {upload_url:url.to_string(),headers:BTreeMap::new(),etag:"image-read".into(),file_id:"image-read".into()})?;
    Ok(url)
}

fn library_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {Some("image/png")}
    else if bytes.starts_with(&[0xff,0xd8,0xff]) {Some("image/jpeg")}
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {Some("image/gif")}
    else if bytes.len()>=12 && &bytes[..4]==b"RIFF" && &bytes[8..12]==b"WEBP" {Some("image/webp")}
    else if bytes.len()>=16 && &bytes[4..8]==b"ftyp" && bytes[8..].chunks_exact(4).take(8).any(|brand|brand==b"avif" || brand==b"avis") {Some("image/avif")}
    else {None}
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
enum HttpMethod { Get, Post, Put, Patch, Delete }

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

fn validate_browser_profile(profile:&ServiceProfile)->ServiceResult<()> {
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
    Ok(())
}

fn build_http_request(
    route: &str,
    credentials: &Credentials,
    integrity: Option<&str>,
    profile: &ServiceProfile,
) -> ServiceResult<HttpRequest> {
    validate_origin(&credentials.origin)?;
    validate_browser_profile(profile)?;
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

// NPn/PPn consume only the proven HTTP root `detail` envelope. Never expose its message.
fn profile_moderation_error(response: &HttpResponse) -> Option<ServiceError> {
    if (200..300).contains(&response.status) { return None; }
    let body: Value = serde_json::from_slice(&response.body).ok()?;
    let detail = body.get("detail")?.as_object()?;
    if !detail.get("message")?.is_string() { return None; }
    let kind = detail.get("type").and_then(Value::as_str).or_else(|| detail.get("error_code").and_then(Value::as_str));
    if kind != Some("profile_update_moderation_failed") { return None; }
    let (code, message) = match detail.get("field").and_then(Value::as_str)? {
        "display_name" => ("profile_name_rejected", "Profile display name did not pass moderation"),
        "description" => ("profile_bio_rejected", "Profile description did not pass moderation"),
        "profile_asset_pointer" => ("profile_photo_rejected", "Profile photo did not pass moderation"),
        _ => return None,
    };
    Some(ServiceError { code, message, status:Some(response.status) })
}

fn validate_remote_plugin_home(body: &Value) -> ServiceResult<Vec<Value>> {
    let sections = body.get("sections").and_then(Value::as_array)
        .ok_or_else(|| failure("invalid_response", "Remote plugin home sections are missing or invalid"))?;
    for section in sections {
        let object = section.as_object().ok_or_else(|| failure("invalid_response", "Invalid remote plugin home section"))?;
        for key in ["id", "title", "url_slug"] {
            if object.get(key).is_some_and(|value| !value.is_null() && !value.is_string()) {
                return Err(failure("invalid_response", "Remote plugin home section field is invalid"));
            }
        }
        if !["id", "url_slug"].iter().any(|key| object.get(*key).and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty())) {
            return Err(failure("invalid_response", "Remote plugin home section identity is missing"));
        }
        let plugins = object.get("plugins").and_then(Value::as_array)
            .ok_or_else(|| failure("invalid_response", "Remote plugin home section plugins are invalid"))?;
        for row in plugins { validate_remote_plugin_listing(row)?; }
    }
    Ok(sections.clone())
}

fn validate_remote_plugin_listing(row: &Value) -> ServiceResult<()> {
    let row = row.as_object().ok_or_else(|| failure("invalid_response", "Invalid remote plugin home listing"))?;
    for key in ["id", "display_name"] {
        if !row.get(key).and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty()) {
            return Err(failure("invalid_response", "Remote plugin home listing identity is missing"));
        }
    }
    for key in ["short_description", "icon_url", "icon_url_dark", "installation_policy", "status", "disabled_reason"] {
        if row.get(key).is_some_and(|value| !value.is_null() && !value.is_string()) {
            return Err(failure("invalid_response", "Remote plugin home listing field is invalid"));
        }
    }
    for key in ["requires_local_executor", "is_template"] {
        if row.get(key).is_some_and(|value| !value.is_null() && !value.is_boolean()) {
            return Err(failure("invalid_response", "Remote plugin home listing flag is invalid"));
        }
    }
    if row.get("keywords").is_some_and(|value| !value.is_null() && !value.as_array().is_some_and(|values| values.iter().all(Value::is_string))) {
        return Err(failure("invalid_response", "Remote plugin home listing keywords are invalid"));
    }
    Ok(())
}

fn validate_remote_plugin_row(row: &Value) -> ServiceResult<()> {
    let object = row.as_object().ok_or_else(|| failure("invalid_response", "Invalid remote plugin row"))?;
    for key in ["id", "name"] {
        if !object.get(key).and_then(Value::as_str).is_some_and(|value| !value.is_empty()) {
            return Err(failure("invalid_response", "Remote plugin row is missing its identity"));
        }
    }
    if object.get("enabled").is_some_and(|value| !value.is_boolean()) {
        return Err(failure("invalid_response", "Remote plugin enabled flag is invalid"));
    }
    for key in ["status", "installation_policy", "authentication_policy"] {
        if object.get(key).is_some_and(|value| !value.is_null() && !value.is_string()) {
            return Err(failure("invalid_response", "Remote plugin policy field is invalid"));
        }
    }
    if object.get("release").is_some_and(|value| !value.is_null() && !value.is_object()) ||
        object.get("eligible_plan_types").is_some_and(|value| !value.is_null() && !value.is_array()) {
        return Err(failure("invalid_response", "Remote plugin metadata structure is invalid"));
    }
    Ok(())
}

fn validate_remote_plugin_mutation(row: &Value, operation: RemotePluginMutationOperation) -> ServiceResult<()> {
    validate_remote_plugin_row(row)?;
    if !row.get("enabled").is_some_and(Value::is_boolean) {
        return Err(failure("forbidden", "Remote plugin is not installed"));
    }
    if let Some(policy) = row.get("installation_policy").filter(|value| !value.is_null()) {
        if !matches!(policy.as_str(), Some("AVAILABLE" | "NOT_AVAILABLE" | "INSTALLED_BY_DEFAULT")) {
            return Err(failure("forbidden", "Remote plugin installation policy is unsupported"));
        }
    }
    if let Some(policy) = row.get("authentication_policy").filter(|value| !value.is_null()) {
        if !matches!(policy.as_str(), Some("ON_INSTALL" | "ON_USE")) {
            return Err(failure("forbidden", "Remote plugin authentication policy is unsupported"));
        }
    }
    if matches!(operation, RemotePluginMutationOperation::Uninstall) {
        if row["installation_policy"] == "INSTALLED_BY_DEFAULT" {
            return Err(failure("forbidden", "Default-installed remote plugins cannot be uninstalled"));
        }
    } else if row["status"] == "DISABLED_BY_ADMIN" {
        return Err(failure("forbidden", "Remote plugin is disabled by the administrator"));
    }
    Ok(())
}

fn profile_mutation_params(operation: ProfileMutationOperation, params: &Value) -> ServiceResult<Value> {
    let object = params.as_object().ok_or_else(|| failure("invalid_request", "Profile parameters must be an object"))?;
    if serde_json::to_vec(params).map_err(|_| failure("invalid_request", "Invalid profile request"))?.len() > 256 * 1024 {
        return Err(failure("invalid_request", "Profile request exceeded transport limit"));
    }
    let keys: &[&str] = match operation { ProfileMutationOperation::AccountName => &["name"],
        ProfileMutationOperation::Username | ProfileMutationOperation::UsernameCheck => &["username"], ProfileMutationOperation::Profile => &["display_name","description"] };
    if object.is_empty() || object.keys().any(|key| !keys.contains(&key.as_str())) || object.values().any(|value| !value.is_string()) {
        return Err(failure("invalid_request", "Unsupported profile parameters"));
    }
    let mut normalized = object.clone();
    match operation {
        ProfileMutationOperation::AccountName => {
            if object["name"].as_str().unwrap().trim().is_empty() { return Err(failure("invalid_request", "Account name must not be blank")); }
        }
        ProfileMutationOperation::Username | ProfileMutationOperation::UsernameCheck => {
            let input = object["username"].as_str().unwrap().trim();
            let username = input.strip_prefix('@').unwrap_or(input).trim();
            if !(3..=20).contains(&username.len()) || !username.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)) ||
                username.as_bytes().first().is_some_and(|byte| b"._-".contains(byte)) || username.as_bytes().last().is_some_and(|byte| b"._-".contains(byte)) {
                return Err(failure("invalid_request", "Username format is not supported"));
            }
            normalized.insert("username".into(), json!(username));
        }
        ProfileMutationOperation::Profile => {
            for (key, value) in &mut normalized {
                let raw = value.as_str().unwrap();
                let text = if key == "description" { raw.replace("\r\n", " ").replace(['\r','\n','\u{2028}','\u{2029}'], " ").trim().to_owned() } else { raw.trim().to_owned() };
                if (key == "display_name" && text.is_empty()) || text.encode_utf16().count() > if key == "display_name" {64} else {140} {
                    return Err(failure("invalid_request", "Public profile text exceeds the supported format"));
                }
                *value = json!(text);
            }
        }
    }
    Ok(Value::Object(normalized))
}

fn profile_username_editable(body: &Value) -> bool {
    body["profile_details"].is_object() && body["viewer_access"].is_object() &&
        body.pointer("/viewer_access/can_edit_username") != Some(&Value::Bool(false)) &&
        body.pointer("/viewer_access/can_edit_username").is_none_or(|value| value.is_null() || value.is_boolean())
}

fn validate_profile_read(operation: &ServiceOperation, body: &Value, identity: &ServiceIdentity) -> ServiceResult<()> {
    let object = body.as_object().ok_or_else(|| failure("invalid_response", "Invalid account profile response"))?;
    if matches!(operation, ServiceOperation::AccountMe) {
        if object.get("id").and_then(Value::as_str) != Some(identity.user_id.as_str()) {
            return Err(failure("account_changed", "Account profile does not match the authenticated user"));
        }
        for key in ["name", "first_name", "email", "email_domain_type", "phone_number", "picture"] {
            if object.get(key).is_some_and(|value| !value.is_null() && !value.is_string()) {
                return Err(failure("invalid_response", "Invalid account profile field"));
            }
        }
    } else {
        for key in ["profile_details", "viewer_access", "page"] {
            if object.get(key).is_some_and(|value| !value.is_null() && !value.is_object()) {
                return Err(failure("invalid_response", "Invalid public profile field"));
            }
        }
        for key in ["is_self", "can_edit", "can_edit_username"] {
            if object.get(key).is_some_and(|value| !value.is_null() && !value.is_boolean()) {
                return Err(failure("invalid_response", "Invalid public profile permission"));
            }
        }
        if let Some(viewer) = object.get("viewer_access").and_then(Value::as_object) {
            for key in ["can_edit", "can_edit_username"] {
                if viewer.get(key).is_some_and(|value| !value.is_null() && !value.is_boolean()) {
                    return Err(failure("invalid_response", "Invalid public profile permission"));
                }
            }
        }
        if let Some(details) = object.get("profile_details").and_then(Value::as_object) {
            for key in ["display_name", "username", "description", "profile_picture_url", "profile_url"] {
                if details.get(key).is_some_and(|value| !value.is_null() && !value.is_string()) {
                    return Err(failure("invalid_response", "Invalid public profile details"));
                }
            }
        }
    }
    Ok(())
}

/// Returns true only for the official empty-account personal payload requiring membership evidence.
fn wham_usage_identity(body: &Value, identity: &ServiceIdentity) -> ServiceResult<bool> {
    if !body.is_object() { return Err(failure("invalid_response", "Invalid usage response")); }
    if body.get("user_id").and_then(Value::as_str) != Some(identity.user_id.as_str()) {
        return Err(failure("account_changed", "Usage response does not match the authenticated user"));
    }
    match body.get("account_id").and_then(Value::as_str) {
        Some(account) if account == identity.account_id => Ok(false),
        Some("") => Ok(true),
        _ => Err(failure("account_changed", "Usage response does not match the selected account")),
    }
}

fn wham_usage_personal_account(body: &Value, identity: &ServiceIdentity) -> bool {
    let Some(entry) = body.get("accounts").and_then(Value::as_object).and_then(|accounts| accounts.get(&identity.account_id)) else { return false; };
    let Some(account) = entry.get("account").and_then(Value::as_object) else { return false; };
    account.get("account_id").and_then(Value::as_str) == Some(identity.account_id.as_str()) &&
        account.get("structure").and_then(Value::as_str) == Some("personal") &&
        account.get("is_deactivated") != Some(&Value::Bool(true)) &&
        entry.get("can_access_with_session") != Some(&Value::Bool(false))
}

// early-bootstrap-339 hT: a workspace IP refusal is not an expired-token response.
fn account_instructions_ip_denied(response: &HttpResponse) -> bool {
    if response.status != 401 { return false; }
    let Ok(body) = serde_json::from_slice::<Value>(&response.body) else { return false; };
    body.pointer("/error/type").and_then(Value::as_str) == Some("ip_not_authorized") ||
        matches!(body.pointer("/error/code").and_then(Value::as_str),
            Some("ip_not_authorized" | "validate_whitelist_failed" | "workspace_ip_not_authorized"))
}

fn revision_sha(value:&Value)->bool {
    value.as_str().is_some_and(|sha|sha.len()==40 && sha.bytes().all(|byte|byte.is_ascii_hexdigit()))
}

fn validate_revision_snapshot(metadata:&Value,response:&Value)->ServiceResult<Value> {
    let snapshot=&response["snapshot"];
    if metadata["status"]!="success" || response["status"]!="success"
        || !revision_sha(&metadata["headRevision"]) || !["baseRevision","headRevision","mergeBaseRevision"].iter().all(|key|revision_sha(&snapshot[key])) {
        return Err(failure("invalid_response","Pinned snapshot is unavailable or incomplete"));
    }
    if metadata["headRevision"]!=snapshot["headRevision"] {return Err(failure("github_head_changed","Pull request changed while pinning; refresh it"));}
    let mut result=json!({"baseRevision":snapshot["baseRevision"],"headRevision":snapshot["headRevision"],"mergeBaseRevision":snapshot["mergeBaseRevision"]});
    if let Some(commits)=snapshot.get("commits") {
        let commits=commits.as_array().ok_or_else(||failure("invalid_response","Invalid snapshot commits"))?;
        let mut seen=std::collections::HashSet::new();
        if commits.iter().any(|commit|!revision_sha(&commit["sha"]) || !commit.get("parentSha").is_some_and(|parent|parent.is_null() || revision_sha(parent))
            || !commit["title"].is_string() || !seen.insert(commit["sha"].as_str().unwrap().to_lowercase())) {
            return Err(failure("invalid_response","Invalid snapshot commits"));
        }
        result["commits"]=json!(commits);
    }
    Ok(result)
}

fn revision_comparison(snapshot:&Value,commit_sha:Option<&str>)->ServiceResult<Value> {
    if let Some(sha)=commit_sha {
        let commit=snapshot["commits"].as_array().and_then(|commits|commits.iter().find(|commit|commit["sha"].as_str()==Some(sha)))
            .filter(|commit|!commit["parentSha"].is_null()).ok_or_else(||failure("invalid_request","Selected commit is unavailable in the pinned snapshot"))?;
        Ok(json!({"baseRevision":commit["parentSha"],"headRevision":commit["sha"]}))
    }else{Ok(json!({"baseRevision":snapshot["mergeBaseRevision"],"headRevision":snapshot["headRevision"]}))}
}

fn validate_revision_paths(base:Option<&str>,head:Option<&str>)->ServiceResult<()> {
    let valid=|path:&str| !path.is_empty() && !path.contains(['\\',':']) && !path.chars().any(char::is_control)
        && path.split('/').all(|segment|!segment.is_empty() && segment!="." && segment!="..");
    if (base.is_none() && head.is_none()) || base.is_some_and(|path|!valid(path)) || head.is_some_and(|path|!valid(path)) {
        return Err(failure("invalid_request","Expected normalized repository-relative revision paths"));
    }
    Ok(())
}

fn validate_revision_file(response:&Value,base:Option<&str>,head:Option<&str>)->ServiceResult<()> {
    if response["status"]=="unavailable" {return Ok(());}
    if response["status"]!="success" || !["baseContent","headContent"].iter().all(|key|response[key].as_str().is_some_and(|text|text.len()<=1_048_576 && !text.contains('\0')))
        || (base.is_none() && response["baseContent"]!="") || (head.is_none() && response["headContent"]!="") {
        return Err(failure("invalid_response","Revision file is unavailable or incomplete"));
    }
    Ok(())
}

fn review_error_code(error:&Value)->Option<&str> {
    // Fixed official Pct/aX priority; an unknown earlier code also wins.
    [&error["extra"],error,&error["error"],&error["detail"],&error["detail"]["error"],&error["error"]["error"]]
        .into_iter().find_map(|node| ["error_code","file_parse_error_code","code"].into_iter()
            .find_map(|key|node[key].as_str().filter(|code|!code.is_empty())))
}

fn review_github_account(current:&Value,pull_request:&Value,connection:&Value)->ServiceResult<Value> {
    let account=&current["currentUser"]["account"];
    let hostname=account["hostname"].as_str().map(|value|value.trim().trim_end_matches('.').to_lowercase());
    let login=account["login"].as_str().filter(|value| !value.is_empty() && value.trim()==*value && !value.chars().any(char::is_control));
    let returned_connection=&account["connection"];
    let valid_connection=returned_connection.is_null() || ["connectorId","accountLinkId"].iter().all(|key|
        returned_connection[key].as_str().is_some_and(|value|!value.trim().is_empty() && !value.chars().any(char::is_control)));
    if current["currentUser"]["status"]!="success" || hostname.as_deref()!=pull_request["hostname"].as_str() || login.is_none()
        || !valid_connection || (!connection.is_null() && (returned_connection["connectorId"]!=connection["connectorId"] || returned_connection["accountLinkId"]!=connection["accountLinkId"])) {
        return Err(failure("github_account_unavailable","GitHub account is unavailable or does not match the selected connection"));
    }
    let mut result=json!({"hostId":"local","hostname":hostname.unwrap(),"login":login.unwrap().to_lowercase()});
    if !returned_connection.is_null(){result["connection"]=json!({"connectorId":returned_connection["connectorId"],"accountLinkId":returned_connection["accountLinkId"]});}
    Ok(result)
}

fn validate_review_read(metadata:&Value,summary:&Value,description:&Value,diff:&Value)->ServiceResult<()> {
    let nonempty=|value:&Value|value.as_str().is_some_and(|value|!value.trim().is_empty());
    let nullable_string=|key:&str| summary.get(key).is_some_and(|value|value.is_null() || value.is_string());
    if metadata["status"]!="success" || !nonempty(&metadata["headRevision"])
        || !nonempty(&metadata["createdAt"]) || !metadata.get("authorLogin").is_some_and(|value|value.is_null() || value.is_string())
        || !["additions","deletions","changedFiles"].iter().all(|key|metadata.get(key).is_some_and(|value|value.is_null()
            || value.as_f64().is_some_and(|number|number>=0.0 && number<=9_007_199_254_740_991.0 && number.fract()==0.0)))
        || description["status"]!="success" || !description["body"].is_string()
        || diff["status"]!="success" || !nonempty(&diff["headRevision"]) || !diff["unifiedDiff"].is_string()
        || summary["status"]!="success" || !nonempty(&summary["headRevision"]) || !["open","closed","merged"].contains(&summary["state"].as_str().unwrap_or(""))
        || summary.get("isDraft").is_some_and(|value|!value.is_boolean())
        || !["title","url","baseBranch","headBranch"].iter().all(|key|nullable_string(key)) {
        return Err(failure("invalid_response","Pull request read response is incomplete or unavailable"));
    }
    if metadata["headRevision"]!=diff["headRevision"] || metadata["headRevision"]!=summary["headRevision"] {
        return Err(failure("github_head_changed","Pull request changed while reading; reload the comparison"));
    }
    Ok(())
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
        assets: None,
        gpt_assets: None,
        site_assets: None,
    })
}

trait Transport {
    fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_>;
    fn send_library_file(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> { self.send(request, cancel) }
    fn send_cloud_draft(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> { self.send(request, cancel) }
}

struct CurlTransport;
impl Transport for CurlTransport {
    fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
        Box::pin(curl_request(request, cancel))
    }
    fn send_library_file(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
        Box::pin(curl_request_limit(request, cancel, MAX_LIBRARY_FILE))
    }
    fn send_cloud_draft(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
        Box::pin(curl_request_timed(request, cancel, MAX_RESPONSE, 600))
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
        HttpMethod::Delete if !request.body.is_empty() =>
            return Err(failure("invalid_request", "DELETE cannot carry an upload body")),
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

fn curl_method(method:HttpMethod) -> &'static str {
    match method {HttpMethod::Get=>"GET",HttpMethod::Post=>"POST",HttpMethod::Put=>"PUT",HttpMethod::Patch=>"PATCH",HttpMethod::Delete=>"DELETE"}
}

fn curl_upload_body(request:&HttpRequest,config:&mut String) -> ServiceResult<Option<UploadBodyFile>> {
    if matches!(request.method,HttpMethod::Get|HttpMethod::Delete) {return Ok(None);}
    let file=UploadBodyFile::create(&request.body)?;
    let path=file.0.to_str().ok_or_else(||failure("transport_error","Upload body path unavailable"))?;
    config.push_str(&format!("data-binary = {}\n",curl_quote(&format!("@{path}"))?));
    Ok(Some(file))
}

async fn curl_request(
    request: HttpRequest,
    cancel: Arc<AtomicBool>,
) -> ServiceResult<HttpResponse> {
    curl_request_limit(request, cancel, MAX_RESPONSE).await
}

async fn curl_request_limit(request: HttpRequest, cancel: Arc<AtomicBool>, limit: u64) -> ServiceResult<HttpResponse> {
    curl_request_timed(request, cancel, limit, 45).await
}

async fn curl_request_timed(request: HttpRequest, cancel: Arc<AtomicBool>, limit: u64, timeout_seconds: u64) -> ServiceResult<HttpResponse> {
    if cancel.load(Ordering::SeqCst) {
        return Err(failure("cancelled", "Service request cancelled"));
    }
    let mut config = curl_config(&request)?;
    // curl's stdin belongs to its private config (including credential headers).
    // A host-created, create_new file carries bytes without shell/config interpretation;
    // RAII removes it on success, cancellation, timeout and failures.
    let _body_file = curl_upload_body(&request,&mut config)?;
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
            curl_method(request.method),
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-redirs",
            "0",
            "--connect-timeout",
            "15",
            "--max-time",
            &timeout_seconds.to_string(),
            "--max-filesize",
            &limit.to_string(),
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
            .take(limit + 65536 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| failure("network_error", "HTTP transport read failed"))?;
        if bytes.len() as u64 > limit + 65536 {
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
        let response = parse_http(&bytes)?;
        if response.body.len() as u64 > limit { return Err(failure("response_too_large", "ChatGPT service response exceeded size limit")); }
        Ok(response)
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
    include!("chatgpt_service/cloud_drafts_tests.rs");
    include!("chatgpt_service/cloud_draft_save_tests.rs");
    include!("chatgpt_service/cloud_publish_tests.rs");
    include!("chatgpt_service/durable_models_tests.rs");
    include!("chatgpt_service/durable_apply_tests.rs");
    include!("chatgpt_service/durable_cloud_start_tests.rs");

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
        let policies = AtomicUsize::new(0);
        let transport = FakeTransport::new(&[401, 200]);
        let rpc = |method, params: Value| {
            if method == "configRequirements/read" { policies.fetch_add(1, Ordering::SeqCst); }
            else { calls.fetch_add(1, Ordering::SeqCst); }
            if params["refreshToken"] == true {
                refreshes.fetch_add(1, Ordering::SeqCst);
            }
            async move {
                Ok(if method == "configRequirements/read" {
                    json!({"requirements":null})
                } else if method == "getAuthStatus" {
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
        assert_eq!(policies.load(Ordering::SeqCst), 4);
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
                    Ok(if method == "configRequirements/read" {
                        json!({"requirements":null})
                    } else if method == "getAuthStatus" {
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
                Ok(if method == "configRequirements/read" {
                    json!({"requirements":null})
                } else if method == "getAuthStatus" {
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
            if method == "configRequirements/read" {
                Ok(json!({"requirements":null}))
            } else if method == "getAuthStatus" {
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

    fn profile_request(operation: ProfileMutationOperation, params: Value) -> ProfileMutationRequest {
        ProfileMutationRequest { request_id:"profile-fixture".into(), expected_identity:identity(), profile:request("unused").profile, operation, params }
    }

    fn remote_plugin_request(operation: RemotePluginMutationOperation) -> RemotePluginMutationRequest {
        RemotePluginMutationRequest { request_id: "remote-plugin-fixture".into(), expected_identity: identity(), profile: request("unused").profile,
            plugin_id: "raw/id?中".into(), operation }
    }

    fn remote_inventory_request() -> RemotePluginInventoryRequest {
        RemotePluginInventoryRequest { request_id: "remote-inventory-fixture".into(), expected_identity: identity(), profile: request("unused").profile, include_extensions: None }
    }

    fn remote_home_request() -> RemotePluginHomeRequest {
        RemotePluginHomeRequest { request_id: "remote-home-fixture".into(), expected_identity: identity(), profile: request("unused").profile }
    }

    fn remote_home_body() -> Value {
        json!({"sections":[{"id":"featured","title":"推荐","url_slug":"featured","plugins":[{
            "id":"flat-plugin","display_name":"扁平目录","short_description":"简介","icon_url":"https://example.test/logo.png",
            "icon_url_dark":null,"keywords":["tools"],"requires_local_executor":true,"is_template":false,
            "installation_policy":"FUTURE_POLICY","status":"ENABLED","disabled_reason":null,"unknown":{"preserve":true}
        }]}]})
    }

    fn remote_detail_request() -> RemotePluginDetailRequest {
        RemotePluginDetailRequest { request_id:"remote-detail-fixture".into(), expected_identity:identity(),
            profile:request("unused").profile, plugin_id:"raw/id?中%2F".into() }
    }

    fn remote_detail_body() -> Value {
        json!({"id":"raw/id?中%2F","name":"real-name","status":"ENABLED","installation_policy":"FUTURE_POLICY",
            "release":{"version":"1.2.3","display_name":"真实详情","interface":{"long_description":"正文"},
                "skills":[{"name":"skill-name","description":"说明"}]},"unknown":{"preserve":true}})
    }

    fn remote_category_request() -> RemotePluginCategoryRequest {
        RemotePluginCategoryRequest { request_id:"remote-category-fixture".into(), expected_identity:identity(),
            profile:request("unused").profile, category_slug:"tools/中%2F".into(),
            search_term:Some("  q&中?#  ".into()), cursor:Some("opaque&?#/中%2F".into()) }
    }

    fn remote_category_body() -> Value {
        json!({"plugins":remote_home_body()["sections"][0]["plugins"],"pagination":{"next_page_token":"next&中"}})
    }

    fn remote_directory_request(kind: &str, limit: u16) -> RemotePluginDirectoryListRequest {
        RemotePluginDirectoryListRequest { request_id:"remote-directory-fixture".into(), expected_identity:identity(),
            profile:request("unused").profile,kind:serde_json::from_value(json!(kind)).unwrap(),limit,cursor:Some("opaque&?#/中%2F".into()) }
    }

    fn remote_directory_body() -> Value {
        json!({"plugins":[remote_detail_body()],"pagination":{"limit":50,"next_page_token":"next&中"}})
    }

    #[tokio::test]
    async fn remote_plugin_directory_routes_limits_headers_and_full_rows_are_preserved() {
        for (kind,limit,path) in [("workspace",50,"list?scope=WORKSPACE&limit=50"),
            ("personal",9,"list?scope=USER&limit=9"),("personal",50,"list?scope=USER&limit=50"),
            ("created",9,"workspace/created?limit=9"),("created",50,"workspace/created?limit=50"),
            ("shared",50,"workspace/shared?limit=50")] {
            let service=ChatgptService::default(); let body=remote_directory_body();
            let transport=instructions_transport(&[200], &[body.clone()]);
            let mut req=remote_directory_request(kind,limit); if limit==9 {req.cursor=None;}
            let result=service.remote_plugin_directory_list_with(req,share_rpc,&transport).await.unwrap();
            assert_eq!(result.plugins,body["plugins"].as_array().unwrap().clone());
            assert_eq!(result.next_page_token.as_deref(),Some("next&中"));
            assert_eq!(result.identity,identity()); assert_eq!(result.request_id,"remote-directory-fixture");
            let calls=transport.requests.lock().unwrap(); assert_eq!(calls.len(),1); let call=&calls[0];
            let suffix=if limit==9 {""} else {"&pageToken=opaque%26%3F%23%2F%E4%B8%AD%252F"};
            assert_eq!(call.url,format!("https://chatgpt.com/backend-api/ps/plugins/{path}{suffix}"));
            assert_eq!(call.method,HttpMethod::Get); assert!(call.body.is_empty());
            assert_eq!(call.headers["OAI-Product-Sku"],"CONNECTOR_SETTING");
            assert_eq!(call.headers["X-Codex-Surface"],"plugin_directory");
            assert_eq!(call.headers["ChatGPT-Account-Id"],"account-fixture");
        }
    }

    #[tokio::test]
    async fn remote_plugin_directory_empty_page_requires_real_pagination() {
        for pagination in [json!({}),json!({"next_page_token":null})] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200], &[json!({"plugins":[],"pagination":pagination})]);
            let mut req=remote_directory_request("personal",9); req.cursor=None;
            let result=service.remote_plugin_directory_list_with(req,share_rpc,&transport).await.unwrap();
            assert!(result.plugins.is_empty()); assert!(result.next_page_token.is_none());
            assert_eq!(transport.requests.lock().unwrap()[0].url,"https://chatgpt.com/backend-api/ps/plugins/list?scope=USER&limit=9");
        }
    }

    #[tokio::test]
    async fn remote_plugin_directory_rejects_malformed_rows_pages_and_requests() {
        for body in [json!({}),json!({"plugins":null,"pagination":{}}),json!({"plugins":[],"pagination":null}),
            json!({"plugins":[]}),json!({"plugins":[],"pagination":{"next_page_token":3}}),
            json!({"plugins":[],"pagination":{"next_page_token":"bad\ncursor"}}),
            json!({"plugins":[],"pagination":{"next_page_token":"x".repeat(16*1024+1)}}),
            json!({"plugins":[{"id":"flat","display_name":"Flat"}],"pagination":{}}),
            json!({"plugins":[{"id":"full","name":"Full","release":[]}],"pagination":{}}),
            json!({"plugins":[{"id":"full","name":"Full"}],"pagination":{}}),
            json!({"plugins":[{"id":"full","name":"Full","release":{"interface":null}}],"pagination":{}})] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[body]);
            assert_eq!(service.remote_plugin_directory_list_with(remote_directory_request("workspace",50),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
        for (kind,limit) in [("workspace",9),("shared",9),("personal",10),("created",0),("personal",9),("created",9)] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_directory_body()]);
            assert_eq!(service.remote_plugin_directory_list_with(remote_directory_request(kind,limit),share_rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        assert!(serde_json::from_value::<RemotePluginDirectoryKind>(json!("arbitrary")).is_err());
        for cursor in ["invalid\ncursor".to_string(),"x".repeat(16*1024+1)] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_directory_body()]);
            let mut req=remote_directory_request("workspace",50); req.cursor=Some(cursor);
            assert_eq!(service.remote_plugin_directory_list_with(req,share_rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        for status in [403,404,503] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[status], &[json!({})]);
            let error=service.remote_plugin_directory_list_with(remote_directory_request("workspace",50),share_rpc,&transport).await.err().unwrap();
            assert_eq!(error.status,Some(status));
            assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
    }

    #[tokio::test]
    async fn remote_plugin_directory_cancel_or_changed_identity_cannot_return_late_page() {
        for invalidate in [false,true] {
            let service=ChatgptService::default(); let mut transport=instructions_transport(&[200], &[remote_directory_body()]);
            transport.delay_ms=30; transport.reserve_response_on_send=true;
            let read=service.remote_plugin_directory_list_with(remote_directory_request("workspace",50),share_rpc,&transport);
            let change=async {
                while transport.requests.lock().unwrap().is_empty() {tokio::task::yield_now().await;}
                if invalidate {service.invalidate();} else {service.cancel("remote-directory-fixture");}
            };
            assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate {"account_changed"}else{"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),1); assert!(service.active.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_directory_body()]);
        let mut req=remote_directory_request("workspace",50); req.expected_identity.account_id="other-account".into();
        assert_eq!(service.remote_plugin_directory_list_with(req,share_rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn remote_plugin_category_encodes_slug_query_cursor_and_preserves_flat_page() {
        let service=ChatgptService::default(); let body=remote_category_body();
        let transport=instructions_transport(&[200], &[body.clone()]);
        let result=service.remote_plugin_category_with(remote_category_request(),share_rpc,&transport).await.unwrap();
        assert_eq!(result.plugins,body["plugins"].as_array().unwrap().clone()); assert_eq!(result.next_page_token.as_deref(),Some("next&中"));
        assert_eq!(result.request_id,"remote-category-fixture"); assert_eq!(result.identity,identity());
        let calls=transport.requests.lock().unwrap(); assert_eq!(calls.len(),1);
        let call=&calls[0];
        assert_eq!(call.url,"https://chatgpt.com/backend-api/ps/plugin-categories/tools%2F%E4%B8%AD%252F/plugins?scope=GLOBAL&q=q%26%E4%B8%AD%3F%23&limit=50&pageToken=opaque%26%3F%23%2F%E4%B8%AD%252F");
        assert_eq!(call.method,HttpMethod::Get); assert!(call.body.is_empty());
        assert_eq!(call.headers["OAI-Product-Sku"],"CONNECTOR_SETTING"); assert_eq!(call.headers["X-Codex-Surface"],"plugin_directory");
        assert_eq!(call.headers["ChatGPT-Account-Id"],"account-fixture");
    }

    #[tokio::test]
    async fn remote_plugin_category_empty_and_optional_pagination_are_real_success() {
        for body in [json!({"plugins":[]}),json!({"plugins":[],"pagination":null}),json!({"plugins":[],"pagination":{}}),
            json!({"plugins":[],"pagination":{"next_page_token":null}})] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[body]);
            let mut req=remote_category_request(); req.category_slug="plain".into(); req.search_term=Some("   ".into()); req.cursor=None;
            let result=service.remote_plugin_category_with(req,share_rpc,&transport).await.unwrap();
            assert!(result.plugins.is_empty()); assert!(result.next_page_token.is_none());
            assert_eq!(transport.requests.lock().unwrap()[0].url,"https://chatgpt.com/backend-api/ps/plugin-categories/plain/plugins?scope=GLOBAL&limit=50");
        }
    }

    #[tokio::test]
    async fn remote_plugin_category_rejects_malformed_pages_and_request_identifiers() {
        for body in [json!({}),json!({"plugins":null}),json!({"plugins":{}}),json!({"plugins":[{"id":"x","name":"inventory"}]}),
            json!({"plugins":[],"pagination":[]}),json!({"plugins":[],"pagination":{"next_page_token":3}})] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[body]);
            assert_eq!(service.remote_plugin_category_with(remote_category_request(),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
        for id in ["",".","..","invalid\nslug"] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_category_body()]);
            let mut req=remote_category_request(); req.category_slug=id.into();
            assert_eq!(service.remote_plugin_category_with(req,share_rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        for status in [403,404,503] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[status], &[json!({})]);
            assert!(service.remote_plugin_category_with(remote_category_request(),share_rpc,&transport).await.is_err());
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_category_body()]);
        let mut req=remote_category_request(); req.cursor=Some("invalid\ncursor".into());
        assert_eq!(service.remote_plugin_category_with(req,share_rpc,&transport).await.err().unwrap().code,"invalid_request");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn remote_plugin_category_cancel_or_changed_identity_cannot_return_late_page() {
        for invalidate in [false,true] {
            let service=ChatgptService::default(); let mut transport=instructions_transport(&[200], &[remote_category_body()]);
            transport.delay_ms=30; transport.reserve_response_on_send=true;
            let read=service.remote_plugin_category_with(remote_category_request(),share_rpc,&transport);
            let change=async {
                while transport.requests.lock().unwrap().is_empty() {tokio::task::yield_now().await;}
                if invalidate {service.invalidate();} else {service.cancel("remote-category-fixture");}
            };
            let result=tokio::join!(read,change).0;
            assert_eq!(result.err().unwrap().code,if invalidate {"account_changed"}else{"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),1); assert!(service.active.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_category_body()]);
        let mut req=remote_category_request(); req.expected_identity.account_id="other-account".into();
        assert_eq!(service.remote_plugin_category_with(req,share_rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn remote_plugin_detail_reads_raw_id_as_one_segment_and_preserves_full_body() {
        let service=ChatgptService::default(); let body=remote_detail_body();
        let transport=instructions_transport(&[200], &[body.clone()]);
        let result=service.remote_plugin_detail_with(remote_detail_request(),share_rpc,&transport).await.unwrap();
        assert_eq!(result.plugin,body); assert_eq!(result.request_id,"remote-detail-fixture"); assert_eq!(result.identity,identity());
        let calls=transport.requests.lock().unwrap(); assert_eq!(calls.len(),1);
        let call=&calls[0]; assert_eq!(call.url,"https://chatgpt.com/backend-api/ps/plugins/raw%2Fid%3F%E4%B8%AD%252F");
        assert_eq!(call.method,HttpMethod::Get); assert!(call.body.is_empty());
        assert_eq!(call.headers["OAI-Product-Sku"],"CODEX"); assert_eq!(call.headers["X-Codex-Surface"],"other");
        assert_eq!(call.headers["ChatGPT-Account-Id"],"account-fixture");
    }

    #[tokio::test]
    async fn remote_plugin_detail_reserved_home_id_keeps_detail_headers() {
        let service=ChatgptService::default(); let mut body=remote_detail_body(); body["id"]=json!("home");
        let transport=instructions_transport(&[200], &[body]); let mut req=remote_detail_request(); req.plugin_id="home".into();
        service.remote_plugin_detail_with(req,share_rpc,&transport).await.unwrap();
        let calls=transport.requests.lock().unwrap(); assert_eq!(calls.len(),1);
        assert_eq!(calls[0].headers["OAI-Product-Sku"],"CODEX");
        assert_eq!(calls[0].headers["X-Codex-Surface"],"other");
    }

    #[tokio::test]
    async fn remote_plugin_detail_rejects_wrong_identity_wrapped_listing_and_malformed_metadata() {
        for body in [json!({}),json!({"plugin":remote_detail_body()}),json!({"id":"raw/id?中%2F","display_name":"listing"}),
            json!({"id":"different","name":"real-name"}),json!({"id":"raw/id?中%2F","name":"real-name","release":[]}),
            json!({"id":"raw/id?中%2F","name":"real-name","enabled":null})] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[body]);
            assert_eq!(service.remote_plugin_detail_with(remote_detail_request(),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
        for id in ["",".","..","invalid\nheader"] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_detail_body()]);
            let mut req=remote_detail_request(); req.plugin_id=id.into();
            assert_eq!(service.remote_plugin_detail_with(req,share_rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        for status in [403,404,503] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[status], &[json!({})]);
            assert!(service.remote_plugin_detail_with(remote_detail_request(),share_rpc,&transport).await.is_err());
        }
    }

    #[tokio::test]
    async fn remote_plugin_detail_cancel_or_changed_identity_cannot_return_late_metadata() {
        for invalidate in [false,true] {
            let service=ChatgptService::default(); let mut transport=instructions_transport(&[200], &[remote_detail_body()]);
            transport.delay_ms=30; transport.reserve_response_on_send=true;
            let read=service.remote_plugin_detail_with(remote_detail_request(),share_rpc,&transport);
            let change=async {
                while transport.requests.lock().unwrap().is_empty() {tokio::task::yield_now().await;}
                if invalidate {service.invalidate();} else {service.cancel("remote-detail-fixture");}
            };
            let result=tokio::join!(read,change).0;
            assert_eq!(result.err().unwrap().code,if invalidate {"account_changed"}else{"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),1); assert!(service.active.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_detail_body()]);
        let mut req=remote_detail_request(); req.expected_identity.account_id="other-account".into();
        assert_eq!(service.remote_plugin_detail_with(req,share_rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn remote_plugin_home_preserves_flat_sections_without_inventory_name_or_release() {
        let service=ChatgptService::default(); let body=remote_home_body();
        let transport=instructions_transport(&[200], &[body.clone()]);
        let result=service.remote_plugin_home_with(remote_home_request(),share_rpc,&transport).await.unwrap();
        assert_eq!(result.sections,body["sections"].as_array().unwrap().clone());
        assert_eq!(result.request_id,"remote-home-fixture"); assert_eq!(result.identity,identity());
        let calls=transport.requests.lock().unwrap(); assert_eq!(calls.len(),1);
        let call=&calls[0]; assert_eq!(call.url,"https://chatgpt.com/backend-api/ps/plugins/home");
        assert_eq!(call.method,HttpMethod::Get); assert!(call.body.is_empty());
        assert_eq!(call.headers["OAI-Product-Sku"],"CONNECTOR_SETTING");
        assert_eq!(call.headers["X-Codex-Surface"],"plugin_directory");
        assert_eq!(call.headers["ChatGPT-Account-Id"],"account-fixture");
        assert_eq!(call.headers["OAI-Language"],"zh-CN");
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[json!({"sections":[]})]);
        assert!(service.remote_plugin_home_with(remote_home_request(),share_rpc,&transport).await.unwrap().sections.is_empty());
        for section in [json!({"id":"section-only","title":null,"plugins":[{"id":"minimal","display_name":"Minimal"}]}),
            json!({"id":null,"url_slug":"slug-only","plugins":[]})] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[json!({"sections":[section.clone()]})]);
            let result=service.remote_plugin_home_with(remote_home_request(),share_rpc,&transport).await.unwrap();
            assert_eq!(result.sections,vec![section]);
            assert!(result.sections[0]["plugins"].as_array().unwrap().iter().all(|row| row.get("installation_policy").is_none()));
        }
    }

    #[tokio::test]
    async fn remote_plugin_home_rejects_malformed_sections_and_flat_fields() {
        let mut bodies=vec![json!({}),json!({"sections":null}),json!({"sections":{}}),json!({"sections":[null]}),
            json!({"sections":[{"title":"No identity","plugins":[]}]})];
        for (field,value) in [("title",json!(1)),("plugins",Value::Null),("url_slug",json!(false))] {
            let mut body=remote_home_body(); body["sections"][0][field]=value; bodies.push(body);
        }
        for (field,value) in [("id",json!("")),("display_name",json!(false)),("short_description",json!({})),
            ("icon_url",json!(2)),("keywords",json!([1])),("requires_local_executor",json!("true")),
            ("is_template",json!(1)),("installation_policy",json!({})),("status",json!([])),("disabled_reason",json!(3))] {
            let mut body=remote_home_body(); body["sections"][0]["plugins"][0][field]=value; bodies.push(body);
        }
        for body in bodies {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[body]);
            assert_eq!(service.remote_plugin_home_with(remote_home_request(),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
        for status in [401,403,503] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[status,status], &[json!({}),json!({})]);
            assert!(service.remote_plugin_home_with(remote_home_request(),share_rpc,&transport).await.is_err());
        }
    }

    #[tokio::test]
    async fn remote_plugin_home_cancel_or_changed_identity_cannot_return_late_sections() {
        for invalidate in [false,true] {
            let service=ChatgptService::default(); let mut transport=instructions_transport(&[200], &[remote_home_body()]);
            transport.delay_ms=30; transport.reserve_response_on_send=true;
            let read=service.remote_plugin_home_with(remote_home_request(),share_rpc,&transport);
            let change=async {
                while transport.requests.lock().unwrap().is_empty() {tokio::task::yield_now().await;}
                if invalidate {service.invalidate();} else {service.cancel("remote-home-fixture");}
            };
            let result=tokio::join!(read,change).0;
            assert_eq!(result.err().unwrap().code,if invalidate {"account_changed"}else{"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),1); assert!(service.active.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[remote_home_body()]);
        let mut req=remote_home_request(); req.expected_identity.account_id="other-account".into();
        assert_eq!(service.remote_plugin_home_with(req,share_rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    fn remote_plugin(enabled: bool) -> Value {
        json!({"id":"raw/id?中","name":"fixture-name","enabled":enabled,"status":"ENABLED","installation_policy":"AVAILABLE","authentication_policy":"ON_USE","unknown":{"preserve":true}})
    }

    fn remote_page(plugins: Vec<Value>, token: Option<&str>) -> Value {
        json!({"plugins":plugins,"pagination":{"next_page_token":token}})
    }

    #[tokio::test]
    async fn remote_plugin_inventory_is_complete_encoded_and_has_fixed_read_headers() {
        let service = ChatgptService::default();
        let first = remote_plugin(true);
        let second = json!({"id":"second-id","name":"same display name","enabled":false});
        let transport = instructions_transport(&[200,200], &[remote_page(vec![first.clone()],Some("opaque&?#/中")), remote_page(vec![second.clone()],None)]);
        let result = service.remote_plugin_inventory_with(remote_inventory_request(), share_rpc, &transport).await.unwrap();
        assert_eq!(result.plugins,vec![first,second]);
        let calls = transport.requests.lock().unwrap(); assert_eq!(calls.len(),2);
        assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/ps/plugins/installed?limit=1000&includeExtensions=true");
        assert_eq!(calls[1].url,"https://chatgpt.com/backend-api/ps/plugins/installed?limit=1000&includeExtensions=true&pageToken=opaque%26%3F%23%2F%E4%B8%AD");
        for call in calls.iter() {
            assert_eq!(call.method,HttpMethod::Get); assert!(call.body.is_empty());
            assert_eq!(call.headers["OAI-Product-Sku"],"CODEX"); assert_eq!(call.headers["X-Codex-Surface"],"other");
            assert_eq!(call.headers["ChatGPT-Account-Id"],"account-fixture");
        }
    }

    #[tokio::test]
    async fn remote_plugin_inventory_rejects_bad_shapes_repeated_pages_and_partial_results() {
        for body in [json!({}),json!({"plugins":[]}),json!({"plugins":[],"pagination":{"next_page_token":12}}),
            remote_page(vec![json!({"id":"id","name":"name","enabled":null})],None),
            remote_page(vec![json!({"id":"id","enabled":true})],None),
            remote_page(vec![remote_plugin(true),remote_plugin(false)],None)] {
            let service=ChatgptService::default(); let transport=instructions_transport(&[200],&[body]);
            assert_eq!(service.remote_plugin_inventory_with(remote_inventory_request(),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,200],&[remote_page(vec![],Some("repeat")),remote_page(vec![],Some("repeat"))]);
        assert_eq!(service.remote_plugin_inventory_with(remote_inventory_request(),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        assert_eq!(transport.requests.lock().unwrap().len(),2);
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,503],&[remote_page(vec![remote_plugin(true)],Some("second")),json!({})]);
        assert!(service.remote_plugin_inventory_with(remote_inventory_request(),share_rpc,&transport).await.is_err());
        let service=ChatgptService::default(); let transport=FakeTransport::new(&[200]);
        transport.responses.lock().unwrap()[0].body.clear();
        assert_eq!(service.remote_plugin_inventory_with(remote_inventory_request(),share_rpc,&transport).await.err().unwrap().code,"invalid_response","GET never inherits mutation empty-body tolerance");
    }

    #[tokio::test]
    async fn remote_plugin_mutations_use_raw_identity_no_body_and_distinct_sku_with_empty_success() {
        for (operation, suffix, after) in [
            (RemotePluginMutationOperation::Enable,"enable",vec![remote_plugin(true)]),
            (RemotePluginMutationOperation::Disable,"disable",vec![remote_plugin(false)]),
            (RemotePluginMutationOperation::Uninstall,"uninstall",vec![]),
        ] {
            for status in [200,204] {
                let service=ChatgptService::default();
                let transport=instructions_transport(&[200,status,200],&[remote_page(vec![remote_plugin(false)],None),Value::Null,remote_page(after.clone(),None)]);
                transport.responses.lock().unwrap()[1].body.clear();
                let result=service.remote_plugin_mutation_with(remote_plugin_request(operation),share_rpc,&transport).await.unwrap();
                assert_eq!(result.verification,"confirmed"); assert_eq!(result.delivery,"accepted"); assert!(result.body.is_null());
                let calls=transport.requests.lock().unwrap(); assert_eq!(calls.len(),3);
                assert_eq!(calls[1].url,format!("https://chatgpt.com/backend-api/ps/plugins/raw%2Fid%3F%E4%B8%AD/{suffix}"));
                assert_eq!(calls[1].method,HttpMethod::Post); assert!(calls[1].body.is_empty()); assert!(!calls[1].headers.contains_key("Content-Type"));
                assert_eq!(calls[1].headers["OAI-Product-Sku"],"CONNECTOR_SETTING"); assert_eq!(calls[1].headers["X-Codex-Surface"],"other");
                assert_eq!(calls[2].headers["OAI-Product-Sku"],"CODEX");
            }
        }
    }

    #[tokio::test]
    async fn remote_plugin_mutation_policy_uses_real_inventory_and_does_not_infer_ownership() {
        for (operation, patch, allowed) in [
            (RemotePluginMutationOperation::Enable,json!({"status":"DISABLED_BY_ADMIN"}),false),
            (RemotePluginMutationOperation::Uninstall,json!({"installation_policy":"INSTALLED_BY_DEFAULT"}),false),
            (RemotePluginMutationOperation::Enable,json!({"installation_policy":"INSTALLED_BY_DEFAULT"}),true),
            (RemotePluginMutationOperation::Disable,json!({"creator_account_user_id":"different-user","scope":"workspace"}),true),
            (RemotePluginMutationOperation::Enable,json!({"installation_policy":"FUTURE_POLICY"}),false),
            (RemotePluginMutationOperation::Enable,json!({"authentication_policy":"FUTURE_AUTH"}),false),
        ] {
            let service=ChatgptService::default(); let mut row=remote_plugin(false);
            row.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());
            let after=match operation {RemotePluginMutationOperation::Disable=>remote_plugin(false),_=>remote_plugin(true)};
            let transport=instructions_transport(&[200,200,200],&[remote_page(vec![row],None),json!({"any":"json"}),remote_page(vec![after],None)]);
            let result=service.remote_plugin_mutation_with(remote_plugin_request(operation),share_rpc,&transport).await;
            if allowed {assert_eq!(result.unwrap().verification,"confirmed");} else {assert_eq!(result.err().unwrap().code,"forbidden");}
            assert_eq!(transport.requests.lock().unwrap().len(),if allowed {3}else{1});
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200],&[remote_page(vec![],None)]);
        assert_eq!(service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),share_rpc,&transport).await.err().unwrap().code,"not_found");
    }

    #[tokio::test]
    async fn remote_plugin_unknown_write_and_readback_failures_never_replay_post() {
        for (status, malformed) in [(200,true),(503,false)] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,status,200],&[remote_page(vec![remote_plugin(false)],None),json!({}),remote_page(vec![remote_plugin(true)],None)]);
            if malformed {transport.responses.lock().unwrap()[1].body=b"not JSON".to_vec();}
            let result=service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),share_rpc,&transport).await.unwrap();
            assert_eq!(result.delivery,"unknown"); assert_eq!(result.verification,"confirmed","authoritative full readback confirms state independently of unknown delivery");
            assert_eq!(transport.requests.lock().unwrap().iter().filter(|call|call.method==HttpMethod::Post).count(),1);
        }
        for (status, after) in [(200,remote_page(vec![remote_plugin(false)],None)),(503,json!({})),(200,json!({"plugins":[]}))] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,200,status],&[remote_page(vec![remote_plugin(false)],None),Value::Null,after]);
            let result=service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),share_rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"pending"); assert_eq!(result.delivery,"accepted");
            assert_eq!(transport.requests.lock().unwrap().iter().filter(|call|call.method==HttpMethod::Post).count(),1);
        }
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,200,200,503],&[remote_page(vec![remote_plugin(false)],None),Value::Null,remote_page(vec![],Some("not-complete")),json!({})]);
        assert_eq!(service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Uninstall),share_rpc,&transport).await.unwrap().verification,"pending","missing later inventory page cannot prove uninstall");
    }

    #[tokio::test]
    async fn remote_plugin_401_refresh_is_once_and_ip_or_definite_refusals_do_not_retry() {
        for (status, ip) in [(401,false),(401,true),(403,false),(429,false)] {
            let service=ChatgptService::default(); let refreshes=std::sync::atomic::AtomicUsize::new(0);
            let rpc=|method,params:Value| {
                if method=="getAuthStatus" && params.get("refreshToken")==Some(&Value::Bool(true)) {refreshes.fetch_add(1,Ordering::SeqCst);}
                share_rpc(method,params)
            };
            let transport=instructions_transport(&[200,status,200,200],&[remote_page(vec![remote_plugin(false)],None),if ip {json!({"error":{"type":"ip_not_authorized"}})}else{json!({})},Value::Null,remote_page(vec![remote_plugin(true)],None)]);
            let result=service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),rpc,&transport).await;
            if status==401 && !ip {
                assert_eq!(result.unwrap().verification,"confirmed"); assert_eq!(refreshes.load(Ordering::SeqCst),1);
                assert_eq!(transport.requests.lock().unwrap().iter().filter(|call|call.method==HttpMethod::Post).count(),2);
            } else {
                assert!(result.is_err()); assert_eq!(refreshes.load(Ordering::SeqCst),0); assert_eq!(transport.requests.lock().unwrap().len(),2);
            }
        }
    }

    #[tokio::test]
    async fn remote_plugin_network_delivery_is_unknown_and_recovery_only_reads() {
        struct FailedPluginPost(FakeTransport);
        impl Transport for FailedPluginPost {
            fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
                if request.method == HttpMethod::Post {
                    self.0.requests.lock().unwrap().push(request);
                    Box::pin(async { Err(failure("network", "Controlled network interruption")) })
                } else { self.0.send(request, cancel) }
            }
        }
        for (after, verification) in [(true,"confirmed"),(false,"pending")] {
            let service=ChatgptService::default();
            let transport=FailedPluginPost(instructions_transport(&[200,200],&[remote_page(vec![remote_plugin(false)],None),remote_page(vec![remote_plugin(after)],None)]));
            let result=service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),share_rpc,&transport).await.unwrap();
            assert_eq!(result.delivery,"unknown"); assert_eq!(result.verification,verification);
            let calls=transport.0.requests.lock().unwrap(); assert_eq!(calls.len(),3);
            assert_eq!(calls.iter().filter(|call|call.method==HttpMethod::Post).count(),1);
        }
    }

    #[tokio::test]
    async fn remote_plugin_second_401_or_changed_refreshed_identity_cannot_replay_again() {
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,401,401],&[remote_page(vec![remote_plugin(false)],None),Value::Null,Value::Null]);
        assert_eq!(service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),share_rpc,&transport).await.err().unwrap().code,"unauthorized");
        assert_eq!(transport.requests.lock().unwrap().len(),3);
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,401],&[remote_page(vec![remote_plugin(false)],None),Value::Null]);
        let refreshed=AtomicBool::new(false);
        let rpc=|method,params:Value| {
            if params["refreshToken"]==true {refreshed.store(true,Ordering::SeqCst);}
            if refreshed.load(Ordering::SeqCst) {
                if method=="getAuthStatus" {return std::future::ready(Ok(auth(&token("another-account","user-fixture",u64::MAX/2))));}
                if method=="account/read" {return std::future::ready(Ok(json!({"account":{"type":"chatgpt"},"workspaceRouting":{
                    "backendOrigin":"https://chatgpt.com","chatgptAccountId":"another-account","accountRoutingOverride":"NO_CONSTRAINT"}})));}
            }
            share_rpc(method,params)
        };
        assert_eq!(service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),rpc,&transport).await.err().unwrap().code,"account_changed");
        assert_eq!(transport.requests.lock().unwrap().len(),2,"new-account token must never replay the old-account POST");
    }

    #[tokio::test]
    async fn remote_plugin_generation_and_cancel_after_send_prevent_followup_and_late_success() {
        for invalidate in [false,true] {
            let service=ChatgptService::default();
            let mut transport=instructions_transport(&[200,200],&[remote_page(vec![remote_plugin(false)],None),Value::Null]);
            transport.delay_ms=30; transport.reserve_response_on_send=true;
            let mutation=service.remote_plugin_mutation_with(remote_plugin_request(RemotePluginMutationOperation::Enable),share_rpc,&transport);
            let change=async {
                while transport.requests.lock().unwrap().len()<2 {tokio::task::yield_now().await;}
                if invalidate {service.invalidate();} else {service.cancel("remote-plugin-fixture");}
            };
            let result=tokio::join!(mutation,change).0;
            assert_eq!(result.err().unwrap().code,if invalidate {"account_changed"}else{"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),2); assert!(service.active.lock().unwrap().is_empty());
        }
    }

    fn profile_identity_body() -> Value {
        json!({"profile_details":{"username":"old-name","display_name":"Public","description":"old bio"},"viewer_access":{"can_edit_username":true}})
    }

    #[tokio::test]
    async fn profile_reads_are_fixed_and_account_me_id_cannot_cross_users() {
        for (operation, path, body) in [
            (ServiceOperation::AccountMe,"/backend-api/me",json!({"id":"user-fixture","name":null,"email":"fixture@example.test"})),
            (ServiceOperation::ProfileIdentity,"/backend-api/profiles/me",profile_identity_body()),
            (ServiceOperation::ProfilePage,"/backend-api/profiles/me/page",json!({"can_edit":true,"profile_details":{"display_name":"Different public name"}})),
        ] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[200], &[body.clone()]);
            let mut req = request("profile-read"); req.operation=operation;
            assert_eq!(service.read_with(req, share_rpc, &transport).await.unwrap().body, body);
            assert_eq!(transport.requests.lock().unwrap()[0].url, format!("https://chatgpt.com{path}"));
        }
        for operation in [ServiceOperation::ProfileIdentity,ServiceOperation::ProfilePage] {
            for status in [403,404] {
                let service = ChatgptService::default(); let transport=FakeTransport::new(&[status]);
                let mut req=request("profile-restricted"); req.operation=operation.clone();
                let result=service.read_with(req,share_rpc,&transport).await.unwrap();
                assert!(result.body.is_null()); assert_eq!(result.status,status);
            }
        }
        let service=ChatgptService::default(); let transport=instructions_transport(&[200], &[json!({"id":"another-user","name":"private fixture"})]);
        let mut req=request("profile-wrong-user"); req.operation=ServiceOperation::AccountMe;
        assert_eq!(service.read_with(req,share_rpc,&transport).await.err().unwrap().code,"account_changed");
    }

    #[tokio::test]
    async fn profile_name_preserves_original_string_and_readback_delay_is_pending() {
        for (read_status, readback, verification) in [
            (200,json!({"id":"user-fixture","name":" New 名称 "}),"confirmed"),
            (200,json!({"id":"user-fixture","name":"Old"}),"pending"),
            (503,json!({}),"pending"),
        ] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,200,read_status],&[json!({"id":"user-fixture","name":"Old"}),json!({"ok":true}),readback]);
            let result=service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":" New 名称 "})),share_rpc,&transport).await.unwrap();
            assert_eq!(result.verification,verification);
            let requests=transport.requests.lock().unwrap(); assert_eq!(requests.len(),3);
            assert_eq!(requests[1].method,HttpMethod::Patch);
            assert_eq!(requests[1].url,"https://chatgpt.com/backend-api/accounts/users/name");
            assert_eq!(serde_json::from_slice::<Value>(&requests[1].body).unwrap(),json!({"name":" New 名称 "}));
        }
    }

    #[tokio::test]
    async fn profile_username_check_and_write_use_shared_format_and_precise_permissions() {
        for params in [json!({"username":"ab"}),json!({"username":"Upper"}),json!({"username":".bad"}),json!({"username":"bad-"}),json!({"username":"@@name"}),json!({"username":"abc","url":"injected"})] {
            assert!(profile_mutation_params(ProfileMutationOperation::Username, &params).is_err());
        }
        assert_eq!(profile_mutation_params(ProfileMutationOperation::Username,&json!({"username":" @name.data "})).unwrap(),json!({"username":"name.data"}));
        for permission in [Some(json!(true)),None,Some(Value::Null),Some(json!(false)),Some(json!("true"))] {
            let mut before=profile_identity_body();
            if let Some(permission)=permission.clone() {before["viewer_access"]["can_edit_username"]=permission;} else {before["viewer_access"].as_object_mut().unwrap().remove("can_edit_username");}
            let allowed=permission.is_none() || permission==Some(Value::Null) || permission==Some(json!(true));
            let service=ChatgptService::default(); let transport=instructions_transport(&[200,200],&[before,json!({"available":false})]);
            let result=service.profile_mutation_with(profile_request(ProfileMutationOperation::UsernameCheck,json!({"username":" @new-name "})),share_rpc,&transport).await;
            if allowed {
                let result=result.unwrap();assert_eq!(result.verification,"not_applicable");assert_eq!(result.body["available"],false);
                let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),2);assert_eq!(requests[1].method,HttpMethod::Post);
                assert_eq!(requests[1].url,"https://chatgpt.com/backend-api/wham/profiles/username/check");
                assert_eq!(serde_json::from_slice::<Value>(&requests[1].body).unwrap(),json!({"username":"new-name"}));
            } else {assert_eq!(result.err().unwrap().code,if permission==Some(json!(false)) {"forbidden"} else {"invalid_response"});assert_eq!(transport.requests.lock().unwrap().len(),1);}
        }
        let service=ChatgptService::default(); let mut after=profile_identity_body();after["profile_details"]["username"]=json!("new-name~actual-service-suffix");
        let transport=instructions_transport(&[200,200,200],&[profile_identity_body(),json!({"profile":{"username":"new-name~actual-service-suffix"}}),after]);
        let result=service.profile_mutation_with(profile_request(ProfileMutationOperation::Username,json!({"username":"new-name"})),share_rpc,&transport).await.unwrap();
        assert_eq!(result.verification,"confirmed");assert_eq!(transport.requests.lock().unwrap()[1].url,"https://chatgpt.com/backend-api/wham/profiles/me");
    }

    #[tokio::test]
    async fn profile_text_sends_only_changed_fields_and_own_page_can_edit_is_authoritative() {
        for is_self in [None,Some(false),Some(true)] {
            let mut page=json!({"can_edit":true,"profile_details":{"display_name":"Public","description":"old bio"}});
            if let Some(is_self)=is_self {page["is_self"]=json!(is_self);}
            let mut after=page.clone();after["profile_details"]["description"]=json!("new bio");
            let service=ChatgptService::default();let transport=instructions_transport(&[200,200,200],&[page,json!({"description":"new bio"}),after]);
            let result=service.profile_mutation_with(profile_request(ProfileMutationOperation::Profile,json!({"display_name":" Public ","description":" new\r\nbio "})),share_rpc,&transport).await.unwrap();
            assert_eq!(result.verification,"confirmed");
            let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),3);
            assert_eq!(requests[1].url,"https://chatgpt.com/backend-api/profiles/me");
            assert_eq!(serde_json::from_slice::<Value>(&requests[1].body).unwrap(),json!({"description":"new bio"}));
        }
        for page in [json!({}),json!({"can_edit":false,"profile_details":{}}),json!({"profile_details":{}})] {
            let service=ChatgptService::default();let transport=instructions_transport(&[200],&[page]);
            assert_eq!(service.profile_mutation_with(profile_request(ProfileMutationOperation::Profile,json!({"description":"fixture"})),share_rpc,&transport).await.err().unwrap().code,"forbidden");
            assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
        assert!(profile_mutation_params(ProfileMutationOperation::Profile,&json!({"profile_asset_pointer":"fake"})).is_err());
        assert!(profile_mutation_params(ProfileMutationOperation::Profile,&json!({"display_name":" "})).is_err());
        assert!(profile_mutation_params(ProfileMutationOperation::Profile,&json!({"description":"a".repeat(141)})).is_err());
    }

    #[tokio::test]
    async fn profile_write_refreshes_only_explicit_401_and_pending_verification_never_rewrites() {
        let before=json!({"id":"user-fixture","name":"Old"});let after=json!({"id":"user-fixture","name":"New"});
        let service=ChatgptService::default();let transport=instructions_transport(&[200,401,200,200],&[before.clone(),json!({}),json!({}),after]);
        assert_eq!(service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":"New"})),share_rpc,&transport).await.unwrap().verification,"confirmed");
        let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),4);assert_eq!(requests[1].body,requests[2].body);drop(requests);
        let service=ChatgptService::default();let transport=instructions_transport(&[200,401],&[before.clone(),json!({"error":{"code":"workspace_ip_not_authorized"}})]);
        assert_eq!(service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":"New"})),share_rpc,&transport).await.err().unwrap().code,"ip_not_authorized");
        assert_eq!(transport.requests.lock().unwrap().len(),2);
        let service=ChatgptService::default();let transport=instructions_transport(&[200,500],&[before,json!({})]);
        assert_eq!(service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":"New"})),share_rpc,&transport).await.err().unwrap().code,"profile_write_unknown");
        assert_eq!(transport.requests.lock().unwrap().len(),2);
    }

    #[tokio::test]
    async fn profile_write_network_unknown_and_known_rejections_are_not_replayed() {
        struct FailAfterRead { requests: Mutex<Vec<HttpRequest>> }
        impl Transport for FailAfterRead {
            fn send(&self, request: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
                let first = self.requests.lock().unwrap().is_empty();
                self.requests.lock().unwrap().push(request);
                Box::pin(async move {
                    if first { Ok(HttpResponse {status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&json!({"id":"user-fixture","name":"Old"})).unwrap()}) }
                    else { Err(failure("transport_error","controlled fixture network failure")) }
                })
            }
        }
        let service=ChatgptService::default();let transport=FailAfterRead { requests:Mutex::new(vec![]) };
        assert_eq!(service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":"New"})),share_rpc,&transport).await.err().unwrap().code,"profile_write_unknown");
        assert_eq!(transport.requests.lock().unwrap().len(),2);
        for status in [400,403,404,409,422] {
            let service=ChatgptService::default();let transport=instructions_transport(&[200,status],&[json!({"id":"user-fixture","name":"Old"}),json!({"private":"must not leak"})]);
            let error=service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":"New"})),share_rpc,&transport).await.err().unwrap();
            assert_eq!(error.status,Some(status));assert!(!serde_json::to_string(&error).unwrap().contains("must not leak"));
            assert_eq!(transport.requests.lock().unwrap().len(),2);
        }
    }

    #[tokio::test]
    async fn profile_moderation_maps_only_proven_detail_fields_and_never_replays_rejections() {
        for (field, expected) in [("display_name","profile_name_rejected"),("description","profile_bio_rejected"),("profile_asset_pointer","profile_photo_rejected")] {
            for discriminator in ["type","error_code"] {
                let mut detail=json!({"field":field,"message":"private fixture must never cross IPC"});
                detail[discriminator]=json!("profile_update_moderation_failed");
                let service=ChatgptService::default();
                let transport=instructions_transport(&[200,422],&[json!({"can_edit":true,"profile_details":{"display_name":"Old"}}),json!({"detail":detail})]);
                let error=service.profile_mutation_with(profile_request(ProfileMutationOperation::Profile,json!({"display_name":"New"})),share_rpc,&transport).await.err().unwrap();
                assert_eq!(error.code,expected);assert_eq!(error.status,Some(422));
                assert!(!serde_json::to_string(&error).unwrap().contains("private fixture"));
                assert_eq!(transport.requests.lock().unwrap().len(),2);
            }
        }
        for body in [
            json!({"error":{"type":"profile_update_moderation_failed","field":"display_name","message":"private fixture"}}),
            json!({"type":"profile_update_moderation_failed","field":"display_name","message":"private fixture"}),
            json!({"detail":{"type":"profile_update_moderation_failed","field":"unknown","message":"private fixture"}}),
            json!({"detail":{"type":"profile_update_moderation_failed","field":"display_name"}}),
            json!({"detail":{"type":"another_error","error_code":"profile_update_moderation_failed","field":"display_name","message":"private fixture"}}),
        ] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,400],&[json!({"can_edit":true,"profile_details":{"display_name":"Old"}}),body]);
            let error=service.profile_mutation_with(profile_request(ProfileMutationOperation::Profile,json!({"display_name":"New"})),share_rpc,&transport).await.err().unwrap();
            assert_eq!(error.code,"service_error");assert_eq!(error.status,Some(400));
            assert!(!serde_json::to_string(&error).unwrap().contains("private fixture"));
            assert_eq!(transport.requests.lock().unwrap().len(),2);
        }
    }

    #[tokio::test]
    async fn profile_mutation_generation_and_cancellation_prevent_followup_reads_and_stale_results() {
        for invalidate in [false,true] {
            let service=ChatgptService::default();let mut transport=instructions_transport(&[200,200,200],&[json!({"id":"user-fixture","name":"Old"}),json!({}),json!({"id":"user-fixture","name":"New"})]);transport.delay_ms=20;
            let write=service.profile_mutation_with(profile_request(ProfileMutationOperation::AccountName,json!({"name":"New"})),share_rpc,&transport);
            let change=async {while transport.requests.lock().unwrap().len()<2 {tokio::task::yield_now().await;}if invalidate {service.invalidate();}else{service.cancel("profile-fixture");}};
            let result=tokio::join!(write,change).0;
            assert_eq!(result.err().unwrap().code,if invalidate {"account_changed"}else{"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),2);
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    fn usage_request(id: &str) -> ServiceRequest {
        let mut request = request(id);
        request.operation = ServiceOperation::WhamUsage;
        request
    }

    fn usage_body() -> Value {
        json!({"user_id":"user-fixture","account_id":"account-fixture","plan_type":"pro",
            "rate_limit":{"primary_window":{"used_percent":null,"reset_at":1800000000}},
            "credits":{"balance":"0","unit":"credits"},"extra":null})
    }

    #[test]
    fn pinned_snapshot_validation_and_path_boundaries() {
        let a="a".repeat(40);let b="b".repeat(40);let c="c".repeat(40);
        let metadata=json!({"status":"success","headRevision":b});
        let good=json!({"status":"success","snapshot":{"baseRevision":a,"headRevision":b,"mergeBaseRevision":c}});
        let parsed=validate_revision_snapshot(&metadata,&good).unwrap();assert!(parsed.get("commits").is_none());
        assert_eq!(revision_comparison(&parsed,None).unwrap()["baseRevision"],c);
        assert!(revision_comparison(&parsed,Some(&a)).is_err());
        let mut changed=good.clone();changed["snapshot"]["headRevision"]=json!(a);
        assert_eq!(validate_revision_snapshot(&metadata,&changed).unwrap_err().code,"github_head_changed");
        for key in ["baseRevision","headRevision","mergeBaseRevision"] {let mut bad=good.clone();bad["snapshot"][key]=json!("branch");assert!(validate_revision_snapshot(&metadata,&bad).is_err());}
        for commits in [json!(null),json!({}),json!([{"sha":a,"parentSha":null}]),json!([{"sha":a,"parentSha":null,"title":"root"},{"sha":a,"parentSha":null,"title":"duplicate"}])] {
            let mut bad=good.clone();bad["snapshot"]["commits"]=commits;assert!(validate_revision_snapshot(&metadata,&bad).is_err());
        }
        let mut root=parsed.clone();root["commits"]=json!([{"sha":a,"parentSha":null,"title":"root"}]);assert!(revision_comparison(&root,Some(&a)).is_err());
        for path in ["","/absolute","../escape","a/../b","a/./b","a//b","a/","C:/file","a\\b","/dev/null","a\0b"] {assert!(validate_revision_paths(Some(path),None).is_err(),"{path}");}
        assert!(validate_revision_paths(Some("src/你好.rs"),None).is_ok());assert!(validate_revision_paths(None,None).is_err());
        assert!(validate_revision_file(&json!({"status":"success","baseContent":"","headContent":"new"}),None,Some("new.rs")).is_ok());
        for body in [json!({"status":"error"}),json!({"status":"success","baseContent":"wrong","headContent":"new"}),json!({"status":"success","baseContent":"","headContent":"nul\0"})] {assert!(validate_revision_file(&body,None,Some("new.rs")).is_err());}
    }

    struct RevisionTransport { requests:Mutex<Vec<HttpRequest>>, concurrent:tokio::sync::Barrier }
    impl Transport for RevisionTransport {
        fn send(&self,request:HttpRequest,_cancel:Arc<AtomicBool>)->TransportFuture<'_> {
            Box::pin(async move {
                let operation=request.url.rsplit('/').next().unwrap().to_owned();
                let payload:Value=serde_json::from_slice(&request.body).unwrap();
                self.requests.lock().unwrap().push(request);
                let a="a".repeat(40);let b="b".repeat(40);let c="c".repeat(40);let d="d".repeat(40);
                let body=match operation.as_str() {
                    "account"=>json!({"currentUser":{"status":"success","account":{"hostname":"github.com","login":"Viewer"}}}),
                    "gh-pr-metadata"=>{self.concurrent.wait().await;let mut metadata=remote_review_metadata();metadata["headRevision"]=json!(b);metadata},
                    "gh-pr-review-snapshot"=>{self.concurrent.wait().await;json!({"status":"success","snapshot":{"baseRevision":a,"headRevision":b,"mergeBaseRevision":c,"commits":[{"sha":b,"parentSha":d,"title":"Current commit"},{"sha":d,"parentSha":null,"title":"Root commit"}]}})},
                    "gh-pr-revision-diff"=>json!({"status":"success","headRevision":payload["comparison"]["headRevision"],"unifiedDiff":"diff --git a/new.rs b/new.rs\nnew file mode 100644\n--- /dev/null\n+++ b/new.rs\n@@ -0,0 +1 @@\n+new\n"}),
                    "gh-pr-revision-file"=>json!({"status":"success","baseContent":"","headContent":"new\n"}),
                    _=>panic!("Unexpected revision operation {operation}"),
                };
                Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&body).unwrap()})
            })
        }
    }

    #[tokio::test]
    async fn pinned_comparison_keeps_exact_snapshot_and_uses_host_account_and_commit_membership() {
        let service=ChatgptService::default();let profile=request("unused").profile;let identity=identity();
        let pr=crate::review_provider::parse_pull_request_url("https://github.com/o/r/pull/1").unwrap();
        let transport=RevisionTransport{requests:Mutex::new(Vec::new()),concurrent:tokio::sync::Barrier::new(2)};let preferences=json!({"githubConnection":null});
        let read=tokio::time::timeout(Duration::from_secs(5),service.review_comparison_with("pin",&identity,&profile,&pr,&Value::Null,&preferences,None,None,None,share_rpc,&transport)).await.unwrap().unwrap();
        let id=read["snapshotId"].as_str().unwrap();let head="b".repeat(40);
        assert_eq!(read["comparison"],json!({"baseRevision":"c".repeat(40),"headRevision":head}));
        let selected=service.review_comparison_with("commit",&identity,&profile,&pr,&Value::Null,&preferences,Some(id),Some(&head),None,share_rpc,&transport).await.unwrap();
        assert_eq!(selected["comparison"],json!({"baseRevision":"d".repeat(40),"headRevision":head}));
        let file=service.review_comparison_with("file",&identity,&profile,&pr,&Value::Null,&preferences,Some(id),None,Some((None,Some("new.rs".into()))),share_rpc,&transport).await.unwrap();
        assert_eq!(file["file"]["headContent"],"new\n");assert!(file.get("diff").is_none());
        if let Some(directory)=std::env::var_os("CODEX_PINNED_REVIEW_FIXTURE_DIRECTORY") {
            let directory=std::path::PathBuf::from(directory);std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("comparison-readback.json"),serde_json::to_vec_pretty(&read).unwrap()).unwrap();
            std::fs::write(directory.join("file-readback.json"),serde_json::to_vec_pretty(&file).unwrap()).unwrap();
        }
        let requests=transport.requests.lock().unwrap();
        assert_eq!(requests.iter().filter(|r|r.url.ends_with("/gh-pr-review-snapshot")).count(),1);
        assert_eq!(requests.iter().filter(|r|r.url.ends_with("/gh-pr-metadata")).count(),1);
        for outgoing in requests.iter() {assert_eq!(outgoing.method,HttpMethod::Post);assert_eq!(outgoing.headers["X-Codex-Expected-User-Id"],identity.user_id);}
        let body:Value=serde_json::from_slice(&requests.last().unwrap().body).unwrap();
        assert_eq!(body["basePath"],Value::Null);assert_eq!(body["headPath"],"new.rs");assert_eq!(body["account"],read["account"]);assert_eq!(body["comparison"],read["comparison"]);
        drop(requests);
        for sha in ["e".repeat(40),"d".repeat(40)] {assert_eq!(service.review_comparison_with("bad-commit",&identity,&profile,&pr,&Value::Null,&preferences,Some(id),Some(&sha),None,share_rpc,&transport).await.unwrap_err().code,"invalid_request");}
        assert_eq!(service.review_comparison_with("bad-prefs",&identity,&profile,&pr,&Value::Null,&json!({}),Some(id),None,None,share_rpc,&transport).await.unwrap_err().code,"snapshot_unavailable");
        let mut other=pr.clone();other["number"]=json!(2);assert!(service.review_comparison_with("bad-pr",&identity,&profile,&other,&Value::Null,&preferences,Some(id),None,None,share_rpc,&transport).await.is_err());
        service.invalidate();assert!(service.pinned_reviews.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn pinned_comparison_rejects_changed_or_incomplete_service_results_without_caching() {
        let profile=request("unused").profile;let identity=identity();let a="a".repeat(40);let b="b".repeat(40);let c="c".repeat(40);
        let pr=crate::review_provider::parse_pull_request_url("https://github.com/o/r/pull/1").unwrap();
        let account=json!({"currentUser":{"status":"success","account":{"hostname":"github.com","login":"viewer"}}});
        let metadata=json!({"status":"success","headRevision":b});
        let snapshot=json!({"status":"success","snapshot":{"baseRevision":a,"headRevision":b,"mergeBaseRevision":c}});
        for scenario in 0..4 {
            let service=ChatgptService::default();let mut metadata=metadata.clone();let mut snapshot=snapshot.clone();
            let mut diff=json!({"status":"success","headRevision":b,"unifiedDiff":""});
            match scenario {
                0=>metadata["headRevision"]=json!(a),
                1=>snapshot["snapshot"].as_object_mut().unwrap().remove("mergeBaseRevision").map(|_|()).unwrap(),
                2=>diff["headRevision"]=json!(a),
                _=>diff=json!({"status":"error","error":"No diff"}),
            }
            let mut transport=instructions_transport(&[200,200,200,200],&[account.clone(),metadata,snapshot,diff]);transport.reserve_response_on_send=true;
            let error=service.review_comparison_with("bad-pin",&identity,&profile,&pr,&Value::Null,&json!({}),None,None,None,share_rpc,&transport).await.unwrap_err();
            assert_eq!(error.code,if scenario==0 || scenario==2 {"github_head_changed"}else{"invalid_response"});
            assert!(service.pinned_reviews.lock().unwrap().is_empty());
        }
        for invalidate in [false,true] {
            let service=ChatgptService::default();let mut transport=instructions_transport(&[200,200,200],&[account.clone(),metadata.clone(),snapshot.clone()]);
            transport.delay_ms=100;transport.reserve_response_on_send=true;
            let reading=service.review_comparison_with("cancel-pin",&identity,&profile,&pr,&Value::Null,&Value::Null,None,None,None,share_rpc,&transport);
            let interrupt=async {while transport.requests.lock().unwrap().len()<3 {tokio::task::yield_now().await;}if invalidate{service.invalidate();}else{service.cancel("cancel-pin");}};
            let(result,())=tokio::join!(reading,interrupt);assert_eq!(result.unwrap_err().code,if invalidate{"account_changed"}else{"cancelled"});assert!(service.pinned_reviews.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn remote_review_fixed_account_transport_and_metadata_fallback() {
        for fallback in [None,Some(404),Some(405)] {
            let service=ChatgptService::default();
            let account=json!({"currentUser":{"status":"success","account":{"hostname":"GITHUB.COM","login":"Viewer","connection":{"connectorId":"default-connector","accountLinkId":"default-authorization"}}}});
            let metadata=remote_review_metadata();
            let summary=json!([{"status":"success","title":"PR","url":"https://github.com/o/r/pull/1","baseBranch":"main","headBranch":"feature","state":"open","headRevision":"head","canMerge":false,"checks":[],"checksComplete":true,"ciStatus":"none","hasOpenPr":true,"hasPendingChecks":false,"headRepository":null,"isDraft":false,"mergeBlocker":null}]);
            let mut statuses=vec![200];let mut bodies=vec![account];
            if let Some(status)=fallback {statuses.push(status);bodies.push(json!({"error_code":"route_not_found"}));}
            statuses.extend([200,200,200,200]);bodies.extend([metadata,summary,json!({"status":"success","body":"description"}),json!({"status":"success","headRevision":"head","unifiedDiff":""})]);
            let transport=instructions_transport(&statuses,&bodies);
            let pr=crate::review_provider::parse_pull_request_url("https://github.com/O/R/pull/1").unwrap();
            let result=service.review_pull_request_with("remote-review",&identity(),&request("unused").profile,&pr,&Value::Null,share_rpc,&transport).await.unwrap();
            if fallback.is_none() {
                if let Some(path)=std::env::var_os("CODEX_REVIEW_READ_FIXTURE_OUTPUT") {
                    std::fs::write(path,serde_json::to_vec_pretty(&result).unwrap()).unwrap();
                }
            }
            assert_eq!(result["account"],json!({"hostId":"local","hostname":"github.com","login":"viewer","connection":{"connectorId":"default-connector","accountLinkId":"default-authorization"}}));
            assert_eq!(result["description"],"description");assert_eq!(result["diff"]["unifiedDiff"],"");
            let requests=transport.requests.lock().unwrap();
            assert_eq!(requests.len(),if fallback.is_some(){6}else{5});
            for outgoing in requests.iter(){
                assert_eq!(outgoing.method,HttpMethod::Post);assert_eq!(outgoing.headers["Content-Type"],"application/json");
                assert_eq!(outgoing.headers["X-Codex-Expected-User-Id"],"user-fixture");assert_eq!(outgoing.headers["X-Codex-Expected-Account-Id"],"account-fixture");
                assert!(outgoing.url.starts_with("https://chatgpt.com/backend-api/wham/github/operations/"));
            }
            assert_eq!(requests[0].url,"https://chatgpt.com/backend-api/wham/github/operations/account");
            assert_eq!(serde_json::from_slice::<Value>(&requests[0].body).unwrap(),json!({"hostname":"github.com"}));
            let summary_call=requests.iter().find(|outgoing|outgoing.url.ends_with("/summaries")).unwrap();
            assert_eq!(serde_json::from_slice::<Value>(&summary_call.body).unwrap(),json!({"account":{"hostId":"local","hostname":"github.com","login":"viewer","connection":{"connectorId":"default-connector","accountLinkId":"default-authorization"}},"pullRequests":[{"hostname":"github.com","owner":"o","repository":"r","number":1}]}));
            for outgoing in requests.iter().skip(1) {
                assert_eq!(serde_json::from_slice::<Value>(&outgoing.body).unwrap()["account"]["connection"],result["account"]["connection"]);
            }
            if fallback.is_some(){assert!(requests[2].url.ends_with("/gh-pr-metadata"));}
        }
    }

    #[tokio::test]
    async fn remote_review_enterprise_account_mismatch_and_policy_prevent_pr_reads() {
        let service=ChatgptService::default();let profile=request("unused").profile;
        let pr=crate::review_provider::parse_pull_request_url("https://github.example.test/o/r/pull/1").unwrap();
        let connection=json!({"connectorId":"enterprise","accountLinkId":"authorization"});
        let transport=instructions_transport(&[200],&[json!({"currentUser":{"status":"success","account":{"hostname":"github.example.test","login":"viewer","connection":{"connectorId":"enterprise","accountLinkId":"forged"}}}})]);
        assert_eq!(service.review_pull_request_with("remote-enterprise",&identity(),&profile,&pr,&connection,share_rpc,&transport).await.unwrap_err().code,"github_account_unavailable");
        let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),1);
        assert_eq!(serde_json::from_slice::<Value>(&requests[0].body).unwrap(),json!({"hostname":"github.example.test","connection":connection}));drop(requests);
        let transport=instructions_transport(&[],&[]);
        let denied=|method,params| if method=="configRequirements/read" {std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
        assert_eq!(service.review_pull_request_with("remote-policy",&identity(),&profile,&pr,&connection,denied,&transport).await.unwrap_err().code,"network_restricted");
        service.cancel("remote-pre-cancel");
        assert_eq!(service.review_pull_request_with("remote-pre-cancel",&identity(),&profile,&pr,&connection,share_rpc,&transport).await.unwrap_err().code,"cancelled");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn remote_review_resource_and_reauthentication_errors_do_not_fallback_or_cache_account() {
        for (status,body,code) in [
            (404,json!({"error_code":"github_resource_not_found"}),"github_resource_not_found"),
            (404,json!({"detail":{"code":"github_resource_not_found"}}),"github_resource_not_found"),
            (404,json!({"error":{"code":"github_resource_not_found"}}),"github_resource_not_found"),
            (403,json!({"detail":{"error":{"code":"github_reauthentication_required"}}}),"github_reauthentication_required"),
            (403,json!({"extra":{"code":"github_reauthentication_required"},"error_code":"github_resource_not_found"}),"github_reauthentication_required"),
            (403,json!({"error_code":"other"}),"other"),
        ] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,status],&[json!({"currentUser":{"status":"success","account":{"hostname":"github.com","login":"viewer"}}}),body]);
            let pr=crate::review_provider::parse_pull_request_url("https://github.com/o/r/pull/1").unwrap();
            let error=service.review_pull_request_with("remote-error",&identity(),&request("unused").profile,&pr,&Value::Null,share_rpc,&transport).await.unwrap_err();
            assert_eq!(error.status,Some(status));if code!="other"{assert_eq!(error.code,code);}
            assert_eq!(transport.requests.lock().unwrap().len(),2);
            // A failed read does not seed any reusable GitHub account result.
            let denied=instructions_transport(&[200],&[json!({"currentUser":{"status":"error"}})]);
            assert_eq!(service.review_pull_request_with("remote-retry",&identity(),&request("unused").profile,&pr,&Value::Null,share_rpc,&denied).await.unwrap_err().code,"github_account_unavailable");
            assert_eq!(denied.requests.lock().unwrap().len(),1);
        }
    }

    #[test]
    fn remote_review_default_account_preserves_real_response_connection() {
        let connection=json!({"connectorId":"default-connector","accountLinkId":"default-authorization"});
        let current=json!({"currentUser":{"status":"success","account":{"hostname":"github.com","login":"Viewer","connection":connection}}});
        let account=review_github_account(&current,&json!({"hostname":"github.com"}),&Value::Null).unwrap();
        assert_eq!(account["connection"],connection);
        for invalid in [json!({"connectorId":"default-connector"}),json!({"connectorId":"","accountLinkId":"link"}),json!("not-a-connection")] {
            let mut bad=current.clone();bad["currentUser"]["account"]["connection"]=invalid;
            assert!(review_github_account(&bad,&json!({"hostname":"github.com"}),&Value::Null).is_err());
        }
        assert!(review_github_account(&current,&json!({"hostname":"github.com"}),&json!({"connectorId":"explicit","accountLinkId":"other"})).is_err());
    }

    #[test]
    fn remote_review_error_code_matches_fixed_envelope_priority() {
        for error in [json!({"detail":{"code":"github_resource_not_found"}}),json!({"error":{"code":"github_resource_not_found"}}),json!({"detail":{"error":{"file_parse_error_code":"github_resource_not_found"}}})] {
            assert_eq!(review_error_code(&error),Some("github_resource_not_found"));
        }
        let conflict=json!({"extra":{"code":"github_reauthentication_required"},"error_code":"github_resource_not_found","error":{"code":"other"}});
        assert_eq!(review_error_code(&conflict),Some("github_reauthentication_required"));
        assert_eq!(review_error_code(&json!({"extra":{"error_code":"","file_parse_error_code":"x","code":"y"},"code":"z"})),Some("x"));
        assert_eq!(review_error_code(&json!({"extra":{"code":"unknown"},"error_code":"github_resource_not_found"})),Some("unknown"));
        assert_eq!(review_error_code(&json!({"error_code":"root","error":{"error_code":"error"},"detail":{"code":"detail"}})),Some("root"));
        assert_eq!(review_error_code(&json!({"error":{"error_code":"error"},"detail":{"code":"detail"}})),Some("error"));
        assert_eq!(review_error_code(&json!({"detail":{"code":"detail","error":{"code":"nested"}},"error":{"error":{"code":"last"}}})),Some("detail"));
        assert_eq!(review_error_code(&json!({"other":{"error_code":"github_resource_not_found"}})),None);
    }

    fn remote_review_metadata()->Value {
        json!({"status":"success","headRevision":"head","createdAt":"2026-11-04T00:00:00Z","authorLogin":null,"authorAvatarUrl":null,
            "additions":0,"deletions":0,"changedFiles":0,"reactions":[],"viewerCanReact":false,"isAuthor":null,"isAutoMergeEnabled":false,"allowedMergeMethods":["merge","squash"]})
    }

    #[test]
    fn remote_review_rejects_missing_consumed_metadata_and_summary_revision() {
        let metadata=json!({"status":"success","headRevision":"head"});
        let summary=json!({"status":"success","title":null,"url":null,"baseBranch":null,"headBranch":null,"state":"open"});
        let description=json!({"status":"success","body":""});let diff=json!({"status":"success","headRevision":"head","unifiedDiff":""});
        assert!(validate_review_read(&metadata,&summary,&description,&diff).is_err());
    }

    #[test]
    fn remote_review_validates_accounts_shapes_and_matching_revisions() {
        let pr=json!({"hostname":"github.example.test"});let connection=json!({"connectorId":"c","accountLinkId":"l"});
        let good=json!({"currentUser":{"status":"success","account":{"hostname":"github.example.test","login":"Viewer","connection":connection}}});
        assert!(review_github_account(&good,&pr,&connection).is_ok());
        for patch in [json!({"hostname":"other.test"}),json!({"login":""}),json!({"connection":{"connectorId":"c","accountLinkId":"forged"}})] {
            let mut bad=good.clone();bad["currentUser"]["account"].as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());assert!(review_github_account(&bad,&pr,&connection).is_err());
        }
        let metadata=remote_review_metadata();let summary=json!({"status":"success","title":null,"url":null,"baseBranch":null,"headBranch":null,"state":"merged","headRevision":"head"});
        let description=json!({"status":"success","body":""});let diff=json!({"status":"success","headRevision":"head","unifiedDiff":""});
        assert!(validate_review_read(&metadata,&summary,&description,&diff).is_ok());
        let mut changed=diff.clone();changed["headRevision"]=json!("new");assert_eq!(validate_review_read(&metadata,&summary,&description,&changed).unwrap_err().code,"github_head_changed");
        let mut changed=summary.clone();changed["headRevision"]=json!("new");assert_eq!(validate_review_read(&metadata,&changed,&description,&diff).unwrap_err().code,"github_head_changed");
        for field in ["createdAt","authorLogin","additions","deletions","changedFiles"] {
            let mut bad=metadata.clone();bad.as_object_mut().unwrap().remove(field);assert!(validate_review_read(&bad,&summary,&description,&diff).is_err(),"{field}");
        }
        for value in [json!(-1),json!(0.5),json!(9_007_199_254_740_992u64),json!("1")] {
            let mut bad=metadata.clone();bad["additions"]=value;assert!(validate_review_read(&bad,&summary,&description,&diff).is_err());
        }
        for patch in [json!({"status":"unavailable"}),json!({"unifiedDiff":null}),json!({"headRevision":""})] {
            let mut bad=diff.clone();bad.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());assert!(validate_review_read(&metadata,&summary,&description,&bad).is_err());
        }
    }

    #[tokio::test]
    async fn remote_review_cancel_and_account_change_drop_inflight_scope() {
        for invalidate in [false,true] {
            let service=ChatgptService::default();let mut transport=instructions_transport(&[200],&[json!({})]);transport.delay_ms=1000;
            let identity=identity();let profile=request("unused").profile;let pr=crate::review_provider::parse_pull_request_url("https://github.com/o/r/pull/1").unwrap();
            let reading=service.review_pull_request_with("remote-inflight",&identity,&profile,&pr,&Value::Null,share_rpc,&transport);
            let interrupt=async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate{service.invalidate();}else{service.cancel("remote-inflight");}};
            let(result,())=tokio::join!(reading,interrupt);assert_eq!(result.unwrap_err().code,if invalidate{"account_changed"}else{"cancelled"});assert!(transport.dropped.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn review_gitlab_fixed_read_contract_filters_authorization_and_detail_permissions() {
        let service=ChatgptService::default();
        let candidate=|id| json!({"id":id,"template_id":"templated_apps_GitLab"});
        let link=|id| json!({"connector_id":id,"id":format!("link-{id}")});
        let mut transport=instructions_transport(&[200,200,403,200],&[
            json!({"connectors":[candidate("denied"),candidate("available"),candidate("unauthorized")]}),
            json!({"links":[link("denied"),link("available")]}),json!({}),
            json!({"id":"available","service":"gitlab","template_id":"templated_apps_GitLab","base_url":"https://gitlab.example.test/api/v4","name":"Work"}),
        ]);
        transport.reserve_response_on_send=true;
        let result=service.review_gitlab_instances_with("gitlab-read",&identity(),&request("unused").profile,share_rpc,&transport).await.unwrap();
        assert_eq!(result,json!([{"connectorId":"available","hostname":"gitlab.example.test","name":"Work"}]));
        let requests=transport.requests.lock().unwrap();
        assert_eq!(requests.len(),4);
        assert_eq!(requests[0].url,"https://chatgpt.com/backend-api/ps/connectors/by-template?template_id=templated_apps_GitLab");
        assert_eq!(requests[0].method,HttpMethod::Get);
        assert_eq!(requests[1].url,"https://chatgpt.com/backend-api/aip/connectors/links/list_accessible");
        assert_eq!(requests[1].method,HttpMethod::Post);
        assert_eq!(requests[1].headers.get("Content-Type").map(String::as_str),Some("application/json"));
        assert_eq!(serde_json::from_slice::<Value>(&requests[1].body).unwrap(),json!({"principals":[],"link_refresh_strategy":"BLOCKING"}));
        assert_eq!(requests[3].url,"https://chatgpt.com/backend-api/aip/connectors/available?include_actions=false");
        for outgoing in requests.iter() {
            assert_eq!(outgoing.headers["OAI-Product-Sku"],"CODEX");
            assert_eq!(outgoing.headers["X-Codex-Surface"],"other");
            assert_eq!(outgoing.headers["ChatGPT-Account-Id"],"account-fixture");
        }
    }

    #[tokio::test]
    async fn review_gitlab_failure_cancellation_identity_and_policy_do_not_become_empty_success() {
        let profile=request("unused").profile;
        let service=ChatgptService::default();
        service.cancel("gitlab-cancel");
        let transport=instructions_transport(&[],&[]);
        assert_eq!(service.review_gitlab_instances_with("gitlab-cancel",&identity(),&profile,share_rpc,&transport).await.unwrap_err().code,"cancelled");
        let mut stale=identity();stale.generation+=1;
        assert_eq!(service.review_gitlab_instances_with("gitlab-stale",&stale,&profile,share_rpc,&transport).await.unwrap_err().code,"account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
        for (status,body) in [(500,json!({})),(200,json!({"not_connectors":[]}))] {
            let mut transport=instructions_transport(&[status,200],&[body,json!({"links":[]})]);transport.reserve_response_on_send=true;
            assert!(service.review_gitlab_instances_with("gitlab-failure",&identity(),&profile,share_rpc,&transport).await.is_err());
        }
        let mut transport=instructions_transport(&[200,200,500],&[
            json!({"connectors":[{"id":"enterprise","template_id":"templated_apps_GitLab"}]}),
            json!({"links":[{"id":"link","connector_id":"enterprise"}]}),json!({})]);transport.reserve_response_on_send=true;
        assert_eq!(service.review_gitlab_instances_with("gitlab-detail-failure",&identity(),&profile,share_rpc,&transport).await.unwrap_err().status,Some(500));
        let transport=instructions_transport(&[],&[]);
        let denied=|method, params| if method=="configRequirements/read" { std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}))) } else { share_rpc(method,params) };
        assert!(service.review_gitlab_instances_with("gitlab-policy",&identity(),&profile,denied,&transport).await.is_err());
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn review_gitlab_inflight_identity_change_and_cancel_drop_reads() {
        for account_change in [false,true] {
            let service=ChatgptService::default();
            let mut transport=instructions_transport(&[200,200],&[json!({"connectors":[]}),json!({"links":[]})]);
            transport.delay_ms=1000;transport.reserve_response_on_send=true;
            let identity=identity();let profile=request("unused").profile;
            let reading=service.review_gitlab_instances_with("gitlab-inflight",&identity,&profile,share_rpc,&transport);
            let interrupt=async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if account_change { service.invalidate(); } else { service.cancel("gitlab-inflight"); }
            };
            let (result,())=tokio::join!(reading,interrupt);
            assert_eq!(result.unwrap_err().code,if account_change { "account_changed" } else { "cancelled" });
            assert!(transport.dropped.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn review_connections_use_fixed_identity_headers_and_reject_route_overrides() {
        let service = ChatgptService::default();
        let body = json!([{"hostname":"github.example.test","name":"Work","connection":{"connectorId":"c","accountLinkId":"l"}}]);
        let transport = instructions_transport(&[200], &[body.clone()]);
        let mut request = request("review-connections");
        request.operation = ServiceOperation::GithubConnections;
        let result = service.read_with(request, share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, body);
        assert!(!serde_json::to_string(&result).unwrap().contains(&fixture_token()));
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, HttpMethod::Get);
        assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/wham/github/connections");
        assert_eq!(requests[0].headers["X-Codex-Expected-User-Id"], "user-fixture");
        assert_eq!(requests[0].headers["X-Codex-Expected-Account-Id"], "account-fixture");
        assert!(resolve_route(&ServiceOperation::GithubConnections, &json!({"url":"https://other.invalid"})).is_err());
        assert!(resolve_route(&ServiceOperation::GithubConnections, &json!({"accountId":"other"})).is_err());
    }

    #[test]
    fn cloud_repository_discovery_maps_official_list_and_search_scopes() {
        let operation = ServiceOperation::CloudGithubRepositories;
        let installation = json!({"id":"37","accountLogin":"example-org","accountType":"Organization"});
        for (query, scope, expected) in [
            ("", Value::Null, "/backend-api/wham/github/list-repositories?connector_id=connector&link_id=link&page=2&per_page=20"),
            ("", installation.clone(), "/backend-api/wham/github/repositories/v2/37?connector_id=connector&link_id=link&page=2&per_page=20"),
            (" repo & 中 ", Value::Null, "/backend-api/wham/github/repositories/search/all-installations?connector_id=connector&link_id=link&page=2&limit=20&query=repo+%26+%E4%B8%AD"),
            ("repo", installation, "/backend-api/wham/github/repositories/search?connector_id=connector&link_id=link&page=2&per_page=20&query=repo&account_login=example-org&account_type=Organization"),
        ] {
            let args = json!({"connectorId":"connector","linkId":"link","page":2,"query":query,"installation":scope});
            assert_eq!(resolve_route(&operation, &args).unwrap(), expected);
        }
        let args = json!({"connectorId":"connector"});
        assert_eq!(resolve_route(&ServiceOperation::CloudGithubInstallations, &args).unwrap(),
            "/backend-api/wham/github/installations/v2?connector_id=connector");
        for args in [
            json!({"connectorId":"connector","page":0,"query":""}),
            json!({"connectorId":"connector","page":1,"query":"","url":"https://other.invalid"}),
            json!({"connectorId":"connector","page":1,"query":"","installation":{"id":"../secret","accountLogin":"a","accountType":"User"}}),
            json!({"connectorId":"connector","page":1,"query":"x\r\ny"}),
        ] {
            assert_eq!(resolve_route(&operation, &args).unwrap_err().code, "invalid_request");
        }
    }

    #[tokio::test]
    async fn cloud_repository_discovery_reads_links_without_refresh_and_binds_identity() {
        let service = ChatgptService::default();
        let body = json!({"links":[
            {"id":"connected","connector_id":"connector","owner_profile":{"nickname":" Alex ","email":"private@example.invalid"},"credential":"fixture-private-value"},
            {"id":"reauth","connector_id":"connector","auth_status":"REAUTH_REQUIRED"},
            {"id":"hidden","connector_id":"connector","visibility":"HIDDEN"},
            {"id":"implicit_link::connector","connector_id":"connector"}
        ]});
        let transport = instructions_transport(&[200], &[body]);
        let mut input = request("cloud-github-links");
        input.operation = ServiceOperation::CloudGithubLinks;
        let result = service.read_with(input, share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, json!({"links":[
            {"id":"connected","connector_id":"connector","available":true,"nickname":"Alex"},
            {"id":"reauth","connector_id":"connector","available":false,"nickname":null}
        ]}));
        assert!(!serde_json::to_string(&result).unwrap().contains(&fixture_token()));
        {
            let calls = transport.requests.lock().unwrap();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].url, "https://chatgpt.com/backend-api/aip/connectors/links/list_accessible");
            assert_eq!(calls[0].method, HttpMethod::Post);
            assert_eq!(calls[0].headers["OAI-Product-Sku"], "CODEX");
            assert_eq!(calls[0].headers["X-Codex-Surface"], "other");
            assert_eq!(calls[0].headers["ChatGPT-Account-Id"], "account-fixture");
            assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(), json!({"principals":[],"link_refresh_strategy":"NONE"}));
        }
        let mut rejected = request("cloud-github-links-other");
        rejected.operation = ServiceOperation::CloudGithubLinks;
        rejected.expected_identity.account_id = "other".into();
        assert_eq!(service.read_with(rejected, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cloud_repository_discovery_reads_repository_pages_and_omits_foreign_fields() {
        let service = ChatgptService::default();
        let raw = json!({"repositories":[{"id":"github-42","name":"canonical-name","repository_full_name":"example/one","default_branch":"release","unrelated":"omitted"},
            {"id":"github-51","repository_full_name":"example/two"},
            {"id":"github-52","repository_full_name":"example/three","name":"invalid\nname"}]});
        let transport = instructions_transport(&[200], &[raw]);
        let mut input = request("cloud-github-page");
        input.operation = ServiceOperation::CloudGithubRepositories;
        input.params = json!({"connectorId":"connector","linkId":"link","page":1,"query":""});
        let result = service.read_with(input, share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, json!({"repositories":[
            {"id":"github-42","name":"canonical-name","repository_full_name":"example/one","default_branch":"release"},
            {"id":"github-51","name":null,"repository_full_name":"example/two","default_branch":null},
            {"id":"github-52","name":null,"repository_full_name":"example/three","default_branch":null}
        ]}));
        let calls = transport.requests.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].method, HttpMethod::Get);
        assert!(calls[0].url.ends_with("/backend-api/wham/github/list-repositories?connector_id=connector&link_id=link&page=1&per_page=20"));
    }

    #[tokio::test]
    async fn review_connections_phase_reuses_cancellation_and_rejections_are_not_retried() {
        let service = ChatgptService::default();
        let registration = service.register("review-phase").unwrap();
        drop(registration);
        assert!(service.cancel("review-phase"));
        let transport = instructions_transport(&[200], &[json!([])]);
        let mut cancelled_request = request("review-phase");
        cancelled_request.operation = ServiceOperation::GithubConnections;
        assert_eq!(service.read_with(cancelled_request, share_rpc, &transport).await.err().unwrap().code, "cancelled");
        assert!(transport.requests.lock().unwrap().is_empty());
        let mut forbidden_request = request("review-forbidden");
        forbidden_request.operation = ServiceOperation::GithubConnections;
        let transport = instructions_transport(&[403], &[json!({})]);
        assert!(service.read_with(forbidden_request, share_rpc, &transport).await.is_err());
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn wham_usage_reads_fixed_brand_headers_and_preserves_missing_values() {
        let service = ChatgptService::default();
        let body = usage_body();
        let transport = instructions_transport(&[200], &[body.clone()]);
        let result = service.read_with(usage_request("usage-read"), share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, body);
        assert!(result.body["rate_limit"]["primary_window"]["used_percent"].is_null());
        assert!(result.body["rate_limit"].get("secondary_window").is_none());
        assert_eq!(result.body["credits"]["balance"], "0");
        let public = serde_json::to_string(&result).unwrap();
        assert!(!public.contains(&fixture_token()));
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, HttpMethod::Get);
        assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/wham/usage");
        assert_eq!(requests[0].headers["OAI-App-Brand"], "chatgpt");
        assert_eq!(requests[0].headers["x-openai-codex-pricing-chooser"], "1");
        assert_eq!(requests[0].headers["ChatGPT-Account-Id"], "account-fixture");
        assert!(requests[0].body.is_empty());
        assert!(resolve_route(&ServiceOperation::WhamUsage, &json!({"url":"https://example.test"})).is_err());
    }

    #[tokio::test]
    async fn wham_usage_unavailable_status_is_null_not_zero_and_get_refresh_is_bounded() {
        for status in [401,403,404] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(if status == 401 { &[401,401] } else { std::slice::from_ref(&status) });
            let result = service.read_with(usage_request("usage-unavailable"), share_rpc, &transport).await.unwrap();
            assert!(result.body.is_null());
            assert_eq!(result.status, status);
            assert_eq!(transport.requests.lock().unwrap().len(), if status == 401 {2} else {1});
        }
        for (status, code) in [(429,"rate_limited"), (500,"service_error")] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[status]);
            assert_eq!(service.read_with(usage_request("usage-failure"), share_rpc, &transport).await.err().unwrap().code, code);
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        }
        let service = ChatgptService::default();
        let transport = instructions_transport(&[401,200], &[json!({}),usage_body()]);
        assert_eq!(service.read_with(usage_request("usage-refreshed"), share_rpc, &transport).await.unwrap().body, usage_body());
        assert_eq!(transport.requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn wham_usage_rejects_other_users_accounts_and_unknown_identity_before_exposing_data() {
        for body in [
            json!({"user_id":"another-user","account_id":"account-fixture"}),
            json!({"user_id":"user-fixture","account_id":"another-account"}),
            json!({"user_id":"user-fixture"}), json!({}), json!([]),
        ] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[200], &[body]);
            assert!(service.read_with(usage_request("usage-mismatch"), share_rpc, &transport).await.is_err());
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        }
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let mut request = usage_request("usage-other-account");
        request.expected_identity.account_id = "another-account".into();
        assert_eq!(service.read_with(request, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    fn raw_personal_usage_accounts() -> Value {
        json!({"account_ordering":["account-fixture"],"accounts":{"account-fixture":{
            "account":{"account_id":"account-fixture","structure":"personal","plan_type":"plus","is_deactivated":false},
            "can_access_with_session":true,"features":[]}}})
    }

    #[tokio::test]
    async fn wham_usage_empty_account_requires_current_personal_membership_not_a_plan_guess() {
        for structure in ["personal", "workspace", "unknown"] {
            let service = ChatgptService::default();
            let mut body = usage_body(); body["account_id"] = json!("");
            let mut accounts = raw_personal_usage_accounts();
            accounts["accounts"]["account-fixture"]["account"]["structure"] = json!(structure);
            let transport = instructions_transport(&[200,200], &[body.clone(),accounts]);
            let result = service.read_with(usage_request("usage-personal"), share_rpc, &transport).await;
            if structure == "personal" { assert_eq!(result.unwrap().body, body); }
            else { assert_eq!(result.err().unwrap().code, "account_changed"); }
            let requests = transport.requests.lock().unwrap();
            assert_eq!(requests.len(), 2);
            assert_eq!(requests[1].url, "https://chatgpt.com/backend-api/wham/accounts/check");
        }
    }

    #[test]
    fn wham_usage_personal_membership_uses_raw_account_map_and_outer_session_access() {
        let raw=raw_personal_usage_accounts();
        assert!(wham_usage_personal_account(&raw,&identity()),"the real accounts/check object map must authorize the matching active personal account");
        let mut denied=Vec::new();
        let mut workspace=raw.clone();workspace["accounts"]["account-fixture"]["account"]["structure"]=json!("workspace");denied.push(workspace);
        let mut deactivated=raw.clone();deactivated["accounts"]["account-fixture"]["account"]["is_deactivated"]=json!(true);denied.push(deactivated);
        let mut session_denied=raw.clone();session_denied["accounts"]["account-fixture"]["can_access_with_session"]=json!(false);denied.push(session_denied);
        let mut wrong_key=raw.clone();let entry=wrong_key["accounts"].as_object_mut().unwrap().remove("account-fixture").unwrap();wrong_key["accounts"]["another-key"]=entry;denied.push(wrong_key);
        let mut wrong_nested_id=raw.clone();wrong_nested_id["accounts"]["account-fixture"]["account"]["account_id"]=json!("another-account");denied.push(wrong_nested_id);
        denied.push(json!({"account_ordering":["account-fixture"],"accounts":[{"id":"account-fixture","structure":"personal"}]}));
        for raw in denied {assert!(!wham_usage_personal_account(&raw,&identity()),"must not infer personal membership from {raw}");}
    }

    #[tokio::test]
    async fn wham_usage_network_policy_cancel_and_account_changes_do_not_release_stale_data() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let denied = |method, params| {
            if method == "configRequirements/read" { std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}))) }
            else { share_rpc(method, params) }
        };
        assert_eq!(service.read_with(usage_request("usage-network-denied"), denied, &transport).await.err().unwrap().code, "network_restricted");
        assert!(transport.requests.lock().unwrap().is_empty());
        for invalidate in [false,true] {
            let service = ChatgptService::default();
            let mut transport = instructions_transport(&[200], &[usage_body()]); transport.delay_ms=100;
            let read = service.read_with(usage_request("usage-pending"), share_rpc, &transport);
            let change = async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("usage-pending"); }
            };
            let result = tokio::join!(read,change).0;
            assert_eq!(result.err().unwrap().code, if invalidate {"account_changed"} else {"cancelled"});
            assert_eq!(transport.requests.lock().unwrap().len(),1);
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    fn instructions_request(id: &str) -> AccountInstructionsRequest {
        AccountInstructionsRequest { request_id:id.into(), expected_identity:identity(), profile:request("unused").profile }
    }

    fn storage_request(id: &str) -> ServiceRequest {
        let mut request = request(id);
        request.operation = ServiceOperation::StorageUsage;
        request
    }

    fn library_request(id: &str, operation: ServiceOperation) -> ServiceRequest {
        let mut request = request(id);
        request.operation = operation;
        request
    }

    #[tokio::test]
    async fn library_file_metadata_uses_only_permission_fallback_and_preserves_fields() {
        let id="libfile_fixture";
        let node=json!({"id":id,"kind":"file","name":"notes.txt","mime_type":"text/plain","extra":{"original":true}});
        for statuses in [&[200][..], &[404,200][..], &[403,404,200][..]] {
            let service=ChatgptService::default();
            let bodies=if statuses.len()==1 {vec![node.clone()]} else if statuses.len()==2 {vec![Value::Null,node.clone()]} else {vec![Value::Null,Value::Null,json!({"items":[node.clone()],"cursor":null})]};
            let transport=instructions_transport(statuses,&bodies);
            let mut req=library_request("metadata",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":id});
            assert_eq!(service.read_with(req,share_rpc,&transport).await.unwrap().body,json!({"requestedFileId":id,"file":node}));
            assert_eq!(transport.requests.lock().unwrap().len(),statuses.len());
        }
        for status in [401,429,500] {
            let service=ChatgptService::default();let transport=instructions_transport(&[status,status],&[Value::Null,Value::Null]);
            let mut req=library_request("metadata-error",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":id});
            assert!(service.read_with(req,share_rpc,&transport).await.is_err());
            assert!(transport.requests.lock().unwrap().iter().all(|r|r.url.ends_with("/libfile_fixture")));
        }
    }

    #[tokio::test]
    async fn library_file_content_returns_real_text_and_strips_credentials_on_redirect() {
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,302,200],&[json!({"content_url":"/api/library/files/libfile_fde1_fixture/content?page_id=fixture"}),Value::Null,Value::Null]);
        let bytes="中文\nactual text".as_bytes().to_vec();
        {let mut responses=transport.responses.lock().unwrap();responses[1].headers.insert("location".into(),"https://files.example.test/signed".into());responses[2].body=bytes.clone();responses[2].headers.insert("content-type".into(),"text/plain; charset=utf-8".into());}
        let mut req=library_request("file-content",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_fde1_fixture"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.unwrap().body,json!({"bytesBase64":base64::engine::general_purpose::STANDARD.encode(bytes),"mimeType":"text/plain; charset=utf-8"}));
        let requests=transport.requests.lock().unwrap();assert!(requests[2].headers.is_empty());assert!(requests[1].headers.contains_key("Authorization"));
    }

    #[tokio::test]
    async fn library_file_content_explicit_download_uses_attachment_route_and_original_bytes() {
        for (params,endpoint) in [
            (json!({"library_file_id":"libfile_fde1_fixture","file_id":"file-old","download":true}),"/files/library/files/libfile_fde1_fixture/download_url"),
            (json!({"library_file_id":"libfile_old","file_id":"file-old#part","gizmo_id":"gizmo","download":true}),"/files/download/file-old*part?gizmo_id=gizmo"),
        ] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,200],&[json!({
                "content_url":"https://files.example.test/preview","download_url":"https://files.example.test/original"
            }),Value::Null]);
            transport.responses.lock().unwrap()[1].body=vec![0,255,10];
            let mut req=library_request("file-download",ServiceOperation::LibraryFileContent);
            req.params=params;
            assert_eq!(service.read_with(req,share_rpc,&transport).await.unwrap().body["bytesBase64"],"AP8K");
            let requests=transport.requests.lock().unwrap();
            assert!(requests[0].url.ends_with(endpoint));
            assert_eq!(requests[1].url,"https://files.example.test/original");
            assert!(requests[1].headers.is_empty());
        }
        for value in [json!(false),json!("true"),json!(null)] {
            assert!(library_file_route(&json!({"library_file_id":"libfile_fde1_fixture","download":value}),true).is_err());
        }
        assert!(library_file_route(&json!({"library_file_id":"libfile_fde1_fixture","download":true}),false).is_err());
    }

    #[tokio::test]
    async fn library_file_metadata_canonical_versions_and_repeated_cursor_are_checked() {
        let shared=json!({"id":"libfile_alias","kind":"file","access_kind":"shared","canonical_file_id":"libfile_fde2_canonical","name":"Shared note"});
        let result=validate_library_file(shared.clone(),"libfile_alias",true).unwrap();assert_eq!(result["id"],"libfile_fde2_canonical");assert_eq!(result["name"],"Shared note");
        for patch in [json!({"id":"other"}),json!({"kind":"directory"}),json!({"access_kind":"owned"}),json!({"canonical_file_id":"file-id"}),json!({"canonical_file_id":"libfile_fde9_wrong"})] {
            let mut bad=shared.clone();for (key,value) in patch.as_object().unwrap(){bad[key]=value.clone();}
            assert!(validate_library_file(bad,"libfile_alias",true).is_err());
        }
        assert!(validate_library_file(json!({"id":"libfile_fde1_original","kind":"file","access_kind":"shared","canonical_file_id":"libfile_fde2_target"}),"libfile_fde1_original",true).is_err());
        let service=ChatgptService::default();
        let node=json!({"id":"libfile_image","kind":"file","access_kind":"owned","library_file_category":"image","name":"Image"});
        let transport=instructions_transport(&[404,200,200],&[Value::Null,node.clone(),json!({"items":[{"library_artifact_type":"image_gen"}]})]);
        let mut req=library_request("file-version",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":"libfile_image"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.unwrap().body["file"]["library_artifact_type"],"image_gen");
        assert!(transport.requests.lock().unwrap()[2].url.ends_with("/versions?limit=1"));
        let service=ChatgptService::default();
        let transport=instructions_transport(&[404,404,200,200],&[Value::Null,Value::Null,json!({"items":[],"cursor":"again"}),json!({"items":[],"cursor":"again"})]);
        let mut req=library_request("file-loop",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":"libfile_missing"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.err().unwrap().status,Some(404));
        assert_eq!(transport.requests.lock().unwrap().len(),4);
        let service=ChatgptService::default();let transport=instructions_transport(&[200],&[shared]);
        let mut req=library_request("file-canonical",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":"libfile_alias"});
        // The direct metadata endpoint preserves its response; canonical conversion belongs to /node.
        assert_eq!(service.read_with(req,share_rpc,&transport).await.unwrap().body["file"]["id"],"libfile_alias");
        let service=ChatgptService::default();let transport=instructions_transport(&[403,200],&[Value::Null,json!({"id":"libfile_alias","kind":"file","access_kind":"shared","canonical_file_id":"libfile_fde2_canonical","custom":"kept"})]);
        let mut req=library_request("file-canonical-node",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":"libfile_alias"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.unwrap().body,json!({"requestedFileId":"libfile_alias","file":{"id":"libfile_fde2_canonical","kind":"file","access_kind":"shared","canonical_file_id":"libfile_fde2_canonical","custom":"kept"}}));
        let service=ChatgptService::default();let transport=instructions_transport(&[200],&[json!({"id":"libfile_wrong"})]);
        let mut req=library_request("file-mismatch",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":"libfile_fde1_requested"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.err().unwrap().code,"invalid_response");assert_eq!(transport.requests.lock().unwrap().len(),1);
    }

    #[tokio::test]
    async fn library_file_content_retries_native_download_and_resolves_attach_redirect() {
        assert_eq!([500,800,1280,2048,3277,4000].map(library_file_retry_delay),[800,1280,2048,3277,4000,4000]);
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,200,200],&[json!({"status":"retry"}),json!({"status":"success","download_url":"https://files.example.test/signed"}),Value::Null]);
        transport.responses.lock().unwrap()[2].body=b"actual".to_vec();
        let mut req=library_request("file-retry",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native","file_id":"file-a#b","gizmo_id":"gizmo"});
        let start=tokio::time::Instant::now();assert!(service.read_with(req,share_rpc,&transport).await.is_ok());assert!(start.elapsed()>=Duration::from_millis(500));
        let requests=transport.requests.lock().unwrap();assert!(requests[0].url.ends_with("/files/download/file-a*b?inline=true&gizmo_id=gizmo"));assert_eq!(requests[0].url,requests[1].url);drop(requests);
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,200,200],&[json!({"content_url":"/api/library/files/libfile_native/content"}),json!({"content_url":"https://files.example.test/signed"}),Value::Null]);
        transport.responses.lock().unwrap()[2].body=b"resolved".to_vec();
        let mut req=library_request("file-resolve",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native"});
        assert!(service.read_with(req,share_rpc,&transport).await.is_ok());
        let requests=transport.requests.lock().unwrap();assert_eq!(requests[0].url,requests[1].url);assert!(requests[2].headers.is_empty());
    }

    #[tokio::test]
    async fn library_file_content_size_identity_cancellation_and_network_boundaries() {
        for size in [MAX_RESPONSE+1,MAX_LIBRARY_FILE,MAX_LIBRARY_FILE+1] {
            let service=ChatgptService::default();let transport=instructions_transport(&[200,200],&[json!({"content_url":"https://files.example.test/signed"}),Value::Null]);
            transport.responses.lock().unwrap()[1].body=vec![b'a';size as usize];
            let mut req=library_request("file-size",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native"});
            let result=service.read_with(req,share_rpc,&transport).await;
            if size>MAX_LIBRARY_FILE {assert_eq!(result.err().unwrap().code,"response_too_large");} else {assert!(result.is_ok());}
        }
        assert_eq!(MAX_RESPONSE,8*1024*1024);
        for change_identity in [false,true] {
            let service=ChatgptService::default();let mut transport=instructions_transport(&[200],&[json!({"status":"retry"})]);transport.delay_ms=50;
            let mut req=library_request("file-cancel",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native","file_id":"file-native"});
            let read=service.read_with(req,share_rpc,&transport);
            let cancel=async {while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}tokio::time::sleep(Duration::from_millis(100)).await;if change_identity {service.invalidate();}else{service.cancel("file-cancel");}};
            assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,if change_identity{"account_changed"}else{"cancelled"});assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
        for change_identity in [false,true] {
            let service=ChatgptService::default();let mut transport=instructions_transport(&[200,200],&[json!({"content_url":"https://files.example.test/signed"}),Value::Null]);transport.delay_ms=50;
            transport.responses.lock().unwrap()[1].body=b"late bytes".to_vec();
            let mut req=library_request("file-byte-cancel",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native"});
            let read=service.read_with(req,share_rpc,&transport);
            let cancel=async {loop{let count=transport.requests.lock().unwrap().len();if count>=2{break;}tokio::task::yield_now().await;}if change_identity{service.invalidate();}else{service.cancel("file-byte-cancel");}};
            assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,if change_identity{"account_changed"}else{"cancelled"});assert_eq!(transport.requests.lock().unwrap().len(),2);
        }
        for params in [json!({"url":"https://evil.test"}),json!({"library_file_id":"mounted_provider"}),json!({"library_file_id":"libfile_native","headers":{}})] {
            assert!(library_file_route(&params,true).is_err());
        }
        let service=ChatgptService::default();let transport=FakeTransport::new(&[]);
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
        let mut req=library_request("file-network",ServiceOperation::LibraryFile);req.params=json!({"library_file_id":"libfile_native"});
        assert_eq!(service.read_with(req,denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn library_file_content_uses_refreshed_credentials_after_attach_resolution() {
        struct RefreshTransport {inner:FakeTransport,expected_token:String}
        impl Transport for RefreshTransport {
            fn send(&self,request:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> {
                if request.url=="https://chatgpt.com/backend-api/estuary/content?id=native" &&
                    (request.headers.get("Authorization")!=Some(&format!("Bearer {}",self.expected_token)) || request.headers.get("X-OAI-IS").map(String::as_str)!=Some("ois1.fresh.header.value")) {
                    self.inner.requests.lock().unwrap().push(request);
                    return Box::pin(async {Ok(HttpResponse{status:401,headers:BTreeMap::new(),body:Vec::new()})});
                }
                self.inner.send(request,cancel)
            }
        }
        let service=ChatgptService::default();
        let fresh_token=token("account-fixture","user-fixture",4102444801);
        let inner=instructions_transport(&[200,401,200,302,200],&[
            json!({"content_url":"/api/library/files/libfile_native/content"}),Value::Null,
            json!({"content_url":"/estuary/content?id=native"}),Value::Null,Value::Null]);
        {let mut responses=inner.responses.lock().unwrap();responses[0].headers.insert("x-oai-is-update".into(),"ois1.old.header.value".into());responses[2].headers.insert("x-oai-is-update".into(),"ois1.fresh.header.value".into());responses[3].headers.insert("location".into(),"https://files.example.test/signed".into());responses[4].body=b"fresh content".to_vec();}
        let transport=RefreshTransport{inner,expected_token:fresh_token.clone()};
        let refreshed=AtomicBool::new(false);
        let rpc=|method,params:Value| {
            if method=="getAuthStatus" {
                let refresh=params["refreshToken"]==true;
                if refresh {refreshed.store(true,Ordering::SeqCst);}
                let selected=if refresh{fresh_token.clone()}else{fixture_token()};
                std::future::ready(Ok(auth(&selected)))
            } else {share_rpc(method,params)}
        };
        let mut req=library_request("file-refresh",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native"});
        let result=service.read_with(req,rpc,&transport).await.unwrap();
        assert_eq!(result.body["bytesBase64"],base64::engine::general_purpose::STANDARD.encode(b"fresh content"));assert!(refreshed.load(Ordering::SeqCst));
        let requests=transport.inner.requests.lock().unwrap();assert_eq!(requests.len(),5);
        assert_eq!(requests[3].headers["Authorization"],format!("Bearer {fresh_token}"));assert_eq!(requests[3].headers["X-OAI-IS"],"ois1.fresh.header.value");assert!(requests[4].headers.is_empty());
    }

    #[tokio::test]
    async fn library_file_content_refreshes_same_origin_bytes_once_without_authenticating_signed_hosts() {
        for statuses in [&[200,401,200][..],&[200,401,401][..]] {
            let service=ChatgptService::default();let transport=instructions_transport(statuses,&[json!({"content_url":"/estuary/content?id=native"}),Value::Null,Value::Null]);
            transport.responses.lock().unwrap()[2].body=b"fresh bytes".to_vec();
            let refreshed=AtomicBool::new(false);let fresh=token("account-fixture","user-fixture",4102444801);
            let rpc=|method,params:Value|if method=="getAuthStatus"{let refresh=params["refreshToken"]==true;if refresh{refreshed.store(true,Ordering::SeqCst);}let selected=if refresh{fresh.clone()}else{fixture_token()};std::future::ready(Ok(auth(&selected)))}else{share_rpc(method,params)};
            let mut req=library_request("bytes-refresh",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native"});
            let result=service.read_with(req,rpc,&transport).await;
            if statuses[2]==200{assert!(result.is_ok());}else{assert_eq!(result.err().unwrap().code,"unauthorized");}
            assert!(refreshed.load(Ordering::SeqCst));let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),3);assert_eq!(requests[1].headers["Authorization"],format!("Bearer {}",fixture_token()));assert_eq!(requests[2].headers["Authorization"],format!("Bearer {fresh}"));
        }
        let service=ChatgptService::default();let transport=instructions_transport(&[200,401],&[json!({"content_url":"https://files.example.test/signed"}),Value::Null]);
        let mut req=library_request("signed-no-auth-refresh",ServiceOperation::LibraryFileContent);req.params=json!({"library_file_id":"libfile_native"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.err().unwrap().code,"unauthorized");let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),2);assert!(requests[1].headers.is_empty());
    }

    #[test]
    fn library_file_urls_and_underlying_file_precedence_match_official_native_routes() {
        for (target,path) in [("/estuary/content?id=fixture","/backend-api/estuary/content?id=fixture"),
            ("/estuary/public_content/enc/fixture","/backend-api/estuary/public_content/enc/fixture"),
            ("/__codex-api/files/library/content_download?id=fixture","/backend-api/files/library/content_download?id=fixture"),
            ("/library/files/libfile_fixture/thumbnail","/backend-api/files/library/files/libfile_fixture/thumbnail_redirect")] {
            let url=library_file_url(target,"https://chatgpt.com").unwrap();assert_eq!(url.as_str(),format!("https://chatgpt.com{path}"));
        }
        assert!(library_file_route(&json!({"library_file_id":"libfile_fde12_a","file_id":"file-ignored"}),true).unwrap().1.ends_with("/libfile_fde12_a/content_url"));
        assert!(library_file_route(&json!({"library_file_id":"libfile_fdebad_a","file_id":"file-real"}),true).unwrap().1.ends_with("/files/download/file-real?inline=true"));
        for target in ["http://files.example.test/a","https://127.0.0.1/a","//evil.test/a","https://user@files.example.test/a","https://files.example.test/a#fragment"]{assert!(library_file_url(target,"https://chatgpt.com").is_err());}
    }

    #[tokio::test]
    async fn library_image_download_redirects_without_leaking_credentials_and_exports_bytes() {
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,302,200],&[json!({"content_url":"/api/library/files/libfile_fde1_fixture/content"}),Value::Null,Value::Null]);
        let png=base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=").unwrap();
        {
            let mut responses=transport.responses.lock().unwrap();
            responses[1].headers.insert("location".into(),"https://images.example.test/signed?token=fixture".into());
            responses[2].body=png.clone();
        }
        let mut req=library_request("library-image",ServiceOperation::LibraryImage);
        req.params=json!({"library_file_id":"libfile_fde1_fixture"});
        let result=service.read_with(req,share_rpc,&transport).await.unwrap();
        assert_eq!(result.body,json!({"dataUrl":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(&png))}));
        let public=serde_json::to_string_pretty(&result).unwrap();
        assert!(!public.contains(&fixture_token())); assert!(!public.contains("signed?"));
        if let Ok(path)=std::env::var("CODEX_LIBRARY_IMAGE_FIXTURE") {std::fs::write(path,public).unwrap();}
        let calls=transport.requests.lock().unwrap();
        assert_eq!(calls.len(),3);
        assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/files/library/files/libfile_fde1_fixture/content_url");
        assert_eq!(calls[1].url,"https://chatgpt.com/backend-api/files/library/files/libfile_fde1_fixture/content_redirect");
        assert_eq!(calls[1].headers["Authorization"],format!("Bearer {}",fixture_token()));
        assert!(calls[2].headers.is_empty());
        assert!(calls.iter().all(|r|r.method==HttpMethod::Get && r.body.is_empty()));
        assert_eq!(library_image_route(&json!({"file_id":"file-a#b","gizmo_id":"gizmo-fixture"})).unwrap(),"/backend-api/files/download/file-a*b?inline=true&gizmo_id=gizmo-fixture");
        assert_eq!(library_image_url("/files/library/files/a/thumbnail_redirect","https://chatgpt.com").unwrap().as_str(),"https://chatgpt.com/backend-api/files/library/files/a/thumbnail_redirect");
        for (action,mapped) in [("download","download_redirect"),("thumbnail","thumbnail_redirect"),("project-content","project_content")] {
            assert_eq!(library_image_url(&format!("/api/library/files/a/{action}"),"https://chatgpt.com").unwrap().as_str(),format!("https://chatgpt.com/backend-api/files/library/files/a/{mapped}"));
        }
    }

    #[tokio::test]
    async fn library_image_rejects_unsafe_targets_html_processing_and_unknown_parameters() {
        for target in ["http://images.example.test/a","https://127.0.0.1/a","https://user@images.example.test/a","https://host.local/a","//evil.test/a","https://images.example.test/a#fragment"] {
            assert!(library_image_url(target,"https://chatgpt.com").is_err(),"{target}");
        }
        for params in [json!({"url":"https://example.test/a"}),json!({"file_id":""}),json!({"file_id":null}),json!({"library_file_id":"wrong"}),json!({"file_id":"a","headers":{}})] {
            assert!(library_image_route(&params).is_err());
        }
        for (response,bytes,code) in [(json!({"download_url":"https://images.example.test/a"}),b"<html>login</html>".to_vec(),"invalid_response"),
            (json!({"download_url":"https://images.example.test/a"}),b"<svg></svg>".to_vec(),"invalid_response"),
            (json!({"status":"processing"}),Vec::new(),"processing"),
            (json!({"status":"retry"}),Vec::new(),"processing"),
            (json!({"download_url":"http://unsafe.example.test/a"}),Vec::new(),"invalid_response")] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,200],&[response,Value::Null]);
            transport.responses.lock().unwrap()[1].body=bytes;
            let mut req=library_request("image-error",ServiceOperation::LibraryImage); req.params=json!({"file_id":"file-fixture"});
            assert_eq!(service.read_with(req,share_rpc,&transport).await.err().unwrap().code,code);
        }
        for (bytes,mime) in [(b"GIF89a".as_slice(),"image/gif"),(&[0xff,0xd8,0xff],"image/jpeg"),(b"RIFF0000WEBP","image/webp"),(b"0000ftypavif0000","image/avif")] {
            assert_eq!(library_image_mime(bytes),Some(mime));
        }
    }

    #[tokio::test]
    async fn library_image_pending_cdn_does_not_block_nodes_or_storage_reads() {
        struct PendingImage {
            metadata: FakeTransport,
            entered: tokio::sync::Notify,
            release: tokio::sync::Notify,
        }
        impl Transport for PendingImage {
            fn send(&self, request: HttpRequest, cancel: Arc<AtomicBool>) -> TransportFuture<'_> {
                Box::pin(async move {
                    if request.url.starts_with("https://images.example.test/") {
                        self.entered.notify_one();
                        self.release.notified().await;
                        Ok(HttpResponse {status:200,headers:BTreeMap::new(),body:b"GIF89afixture".to_vec()})
                    } else {self.metadata.send(request,cancel).await}
                })
            }
        }
        for operation in [ServiceOperation::LibraryNodes,ServiceOperation::StorageUsage] {
            let service=ChatgptService::default();
            let image_transport=PendingImage {
                metadata:instructions_transport(&[200],&[json!({"download_url":"https://images.example.test/pending"})]),
                entered:tokio::sync::Notify::new(),release:tokio::sync::Notify::new(),
            };
            let second_transport=FakeTransport::new(&[200]);
            let mut request=library_request("image-concurrent",ServiceOperation::LibraryImage);
            request.params=json!({"file_id":"file-fixture"});
            let image=service.read_with(request,share_rpc,&image_transport);
            let second=async {
                image_transport.entered.notified().await;
                let result=tokio::time::timeout(Duration::from_millis(250),service.read_with(
                    library_request("library-concurrent",operation),share_rpc,&second_transport)).await;
                image_transport.release.notify_one();
                result
            };
            let (image_result,second_result)=tokio::join!(image,second);
            assert!(image_result.is_ok());
            assert!(second_result.is_ok(),"A pending CDN image must not hold the service session lock");
            assert!(second_result.unwrap().is_ok());
            assert_eq!(second_transport.requests.lock().unwrap().len(),1);
        }
    }

    #[tokio::test]
    async fn library_image_redirect_limit_and_download_errors_do_not_return_data() {
        for status in [403,404,429] {
            let service=ChatgptService::default();
            let transport=instructions_transport(&[200,status],&[json!({"download_url":"https://images.example.test/a"}),Value::Null]);
            let mut req=library_request("image-status",ServiceOperation::LibraryImage); req.params=json!({"file_id":"file-fixture"});
            let error=service.read_with(req,share_rpc,&transport).await.err().unwrap();
            assert_eq!(error.status,Some(status));
            assert_eq!(transport.requests.lock().unwrap().len(),2);
        }
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200,302,302,302,302,302,302],&[json!({"download_url":"https://images.example.test/a"})]);
        for response in transport.responses.lock().unwrap().iter_mut().skip(1) {response.headers.insert("location".into(),"/loop".into());}
        let mut req=library_request("image-loop",ServiceOperation::LibraryImage); req.params=json!({"file_id":"file-fixture"});
        assert_eq!(service.read_with(req,share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        let calls=transport.requests.lock().unwrap();
        assert_eq!(calls.len(),7);
        assert!(calls.iter().skip(1).all(|r|r.url.starts_with("https://images.example.test/") && r.headers.is_empty()));
    }

    #[tokio::test]
    async fn library_image_checks_network_for_each_target_and_drops_late_downloads() {
        let service=ChatgptService::default();
        let transport=instructions_transport(&[200],&[json!({"download_url":"https://images.example.test/a"})]);
        let network_reads=AtomicUsize::new(0);
        let policy=|method,params| {
            if method=="configRequirements/read" && network_reads.fetch_add(1,Ordering::SeqCst)>0 {
                std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))
            } else {share_rpc(method,params)}
        };
        let mut req=library_request("image-policy",ServiceOperation::LibraryImage); req.params=json!({"file_id":"file-fixture"});
        assert_eq!(service.read_with(req,policy,&transport).await.err().unwrap().code,"network_restricted");
        assert_eq!(transport.requests.lock().unwrap().len(),1);
        for invalidate in [false,true] {
            let service=ChatgptService::default();
            let mut transport=instructions_transport(&[200,200],&[json!({"download_url":"https://images.example.test/a"}),Value::Null]);
            transport.delay_ms=50;
            let mut req=library_request("image-pending",ServiceOperation::LibraryImage); req.params=json!({"file_id":"file-fixture"});
            let read=service.read_with(req,share_rpc,&transport);
            let change=async {
                while transport.requests.lock().unwrap().len()<2 {tokio::task::yield_now().await;}
                if invalidate {service.invalidate();} else {service.cancel("image-pending");}
            };
            assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate {"account_changed"} else {"cancelled"});
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn library_read_settings_uses_fixed_settings_route_and_preserves_country_flag() {
        for flag in [json!(true),json!(false)] {
            let service=ChatgptService::default();
            let body=json!({"flags":{"file_library_enabled_for_registration_country":flag}});
            let transport=instructions_transport(&[200],&[body.clone()]);
            let result=service.read_with(library_request("library-settings",ServiceOperation::LibrarySettings),share_rpc,&transport).await.unwrap();
            assert_eq!(result.body,body);
            assert_eq!(result.identity,identity());
            if flag == json!(true) {
                if let Ok(path)=std::env::var("CODEX_LIBRARY_SETTINGS_FIXTURE") {
                    std::fs::write(path,serde_json::to_string_pretty(&result).unwrap()).unwrap();
                }
            }
            let calls=transport.requests.lock().unwrap();
            assert_eq!(calls.len(),1);
            assert_eq!(calls[0].method,HttpMethod::Get);
            assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/settings/user");
            assert!(calls[0].body.is_empty());
        }
        let service=ChatgptService::default();
        let transport=FakeTransport::new(&[]);
        let mut req=library_request("library-settings-injected",ServiceOperation::LibrarySettings);
        req.params=json!({"url":"/backend-api/wham/settings/user"});
        let calls=AtomicUsize::new(0);
        let rpc=|_,_| { calls.fetch_add(1,Ordering::SeqCst); std::future::ready(Err("must not authenticate".into())) };
        assert_eq!(service.read_with(req,rpc,&transport).await.err().unwrap().code,"invalid_request");
        assert_eq!(calls.load(Ordering::SeqCst),0);
    }

    #[tokio::test]
    async fn library_directory_path_fixed_get_preserves_identity_and_opaque_ids() {
        let parsed: ServiceOperation = serde_json::from_value(json!("library_directory_path")).unwrap();
        let body = json!({"items":[{"id":"root","name":"资料库","is_root":true},
            {"id":"目录 /?%#","name":"当前目录"}]});
        for params in [json!({}), json!({"directory_id":null}), json!({"directory_id":"目录 /?%#"})] {
            let service = ChatgptService::default();
            let transport = instructions_transport(&[200], &[body.clone()]);
            let mut req = library_request("directory-path", parsed.clone());
            req.params = params.clone();
            let result = service.read_with(req, share_rpc, &transport).await.unwrap();
            assert_eq!(result.body, body);
            assert_eq!(result.identity, identity());
            let calls = transport.requests.lock().unwrap();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].method, HttpMethod::Get);
            assert!(calls[0].body.is_empty());
            assert_eq!(calls[0].headers["Authorization"], format!("Bearer {}", fixture_token()));
            assert_eq!(calls[0].headers["ChatGPT-Account-Id"], "account-fixture");
            assert_eq!(calls[0].headers["oai-did"], "fixture-device");
            let url = tauri::Url::parse(&calls[0].url).unwrap();
            assert_eq!(url.origin().ascii_serialization(), "https://chatgpt.com");
            assert_eq!(url.path(), "/backend-api/files/library/directories/path");
            if let Some(id) = params["directory_id"].as_str() {
                assert_eq!(url.query_pairs().map(|(key,value)| (key.into_owned(),value.into_owned())).collect::<Vec<_>>(),
                    vec![("directory_id".to_owned(), id.to_owned())]);
            } else {
                assert_eq!(url.query(), None);
            }
        }
    }

    #[tokio::test]
    async fn library_directory_path_rejects_invalid_parameters_before_auth_or_http() {
        for params in [json!([]), json!(null), json!({"directory_id":true}), json!({"directory_id":5}),
            json!({"directory_id":{}}), json!({"directory_id":[]}), json!({"directory_id":""}),
            json!({"directory_id":" "}), json!({"directory_id":"folder\n"}),
            json!({"directory_id":"x".repeat(2049)}), json!({"directory_id":"文件".repeat(342)}),
            json!({"directory_id":"ok","url":"https://other.test"}), json!({"cursor":"next"}),
            json!({"parent_directory_id":"other"}), json!({"method":"DELETE"})] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[]);
            let mut req = library_request("directory-invalid", ServiceOperation::LibraryDirectoryPath);
            req.params = params;
            let calls = AtomicUsize::new(0);
            let rpc = |_,_| { calls.fetch_add(1, Ordering::SeqCst); std::future::ready(Err("must not authenticate".into())) };
            assert_eq!(service.read_with(req, rpc, &transport).await.err().unwrap().code, "invalid_request");
            assert_eq!(calls.load(Ordering::SeqCst), 0);
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        assert!(resolve_route(&ServiceOperation::LibraryDirectoryPath, &json!({"directory_id":"x".repeat(2048)})).is_ok());
    }

    #[tokio::test]
    async fn library_directory_path_rejects_cancelled_or_other_identity_before_transport() {
        for other_account in [false, true] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[]);
            let mut req = library_request("directory-rejected", ServiceOperation::LibraryDirectoryPath);
            req.params = json!({"directory_id":"folder"});
            if other_account { req.expected_identity.account_id = "other-account".into(); }
            else { service.cancel("directory-rejected"); }
            assert_eq!(service.read_with(req, share_rpc, &transport).await.err().unwrap().code,
                if other_account { "account_changed" } else { "cancelled" });
            assert!(transport.requests.lock().unwrap().is_empty());
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn library_directory_path_completion_cancel_and_identity_drop_ready_body() {
        struct CompletionChange<'a> { service:&'a ChatgptService, invalidate:bool }
        impl Transport for CompletionChange<'_> {
            fn send(&self, _:HttpRequest, _:Arc<AtomicBool>) -> TransportFuture<'_> {
                Box::pin(async move {
                    if self.invalidate { self.service.invalidate(); } else { self.service.cancel("directory-completion"); }
                    Ok(HttpResponse { status:200, headers:BTreeMap::new(), body:br#"{"items":[{"id":"private","name":"private"}]}"#.to_vec() })
                })
            }
        }
        for invalidate in [false,true] {
            let service = ChatgptService::default();
            let transport = CompletionChange { service:&service, invalidate };
            assert_eq!(service.read_with(library_request("directory-completion", ServiceOperation::LibraryDirectoryPath), share_rpc, &transport).await.err().unwrap().code,
                if invalidate { "account_changed" } else { "cancelled" });
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    fn suggested_request(id:&str,params:Value)->ServiceRequest {
        let mut request=library_request(id,serde_json::from_value(json!("library_suggested")).unwrap());request.params=params;request
    }

    #[tokio::test]
    async fn library_suggested_fixed_post_preserves_real_file_records_and_cursor() {
        let body=json!({"items":[{"id":"libfile_real","file_name":"Real note.md","directory_id":null,"current_version_number":3,"last_used_at":"2026-11-06"}],"cursor":"next"});
        for params in [json!({}),json!({"cursor":"next","categories":["images","documents","spreadsheets","presentations","pdfs"],"source":"uploaded"}),json!({"cursor":null,"source":"generated","categories":[]})] {
            let service=ChatgptService::default();let transport=instructions_transport(&[200],&[body.clone()]);
            let result=service.read_with(suggested_request("suggested",params.clone()),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);assert_eq!(result.identity,identity());
            let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].method,HttpMethod::Post);assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/files/library");assert_eq!(calls[0].headers["ChatGPT-Account-Id"],"account-fixture");assert_eq!(calls[0].headers["Authorization"],format!("Bearer {}",fixture_token()));
            assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),json!({"cursor":params.get("cursor").cloned().unwrap_or(Value::Null),"limit":50,"categories":params.get("categories").cloned().unwrap_or(json!([])),"source":params.get("source").cloned().unwrap_or(Value::Null),"include_hidden_files":false,"include_saved_entities":true,"include_sites":false,"trashed_only":false,"ranking":"suggested","providers":[]}));
        }
    }

    #[tokio::test]
    async fn library_suggested_rejects_unproven_inputs_before_credentials() {
        for params in [json!(null),json!([]),json!({"url":"https://evil.test"}),json!({"method":"POST"}),json!({"body":{}}),json!({"headers":{}}),json!({"ranking":"suggested"}),json!({"limit":50}),json!({"q":"search"}),json!({"providers":[]}),json!({"include_hidden_files":false}),json!({"include_sites":true}),json!({"trashed_only":false}),json!({"cursor":""}),json!({"cursor":"a\nb"}),json!({"cursor":false}),json!({"cursor":"a".repeat(2049)}),json!({"source":"all"}),json!({"source":" "}),json!({"source":false}),json!({"categories":null}),json!({"categories":"images"}),json!({"categories":["image"]}),json!({"categories":["pages"]}),json!({"categories":[1]})] {
            let service=ChatgptService::default();let transport=FakeTransport::new(&[]);let auth_calls=AtomicUsize::new(0);
            let rpc=|_,_|{auth_calls.fetch_add(1,Ordering::SeqCst);std::future::ready(Err("must not authenticate".into()))};
            assert_eq!(service.read_with(suggested_request("suggested-invalid",params),rpc,&transport).await.err().unwrap().code,"invalid_request");assert_eq!(auth_calls.load(Ordering::SeqCst),0);assert!(transport.requests.lock().unwrap().is_empty());assert!(service.active.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn library_suggested_errors_network_identity_and_single_refresh_stay_scoped() {
        for (status,code) in [(403,"forbidden"),(404,"not_found"),(429,"rate_limited"),(500,"service_error")] {
            let service=ChatgptService::default();let transport=FakeTransport::new(&[status]);assert_eq!(service.read_with(suggested_request("suggested-http",json!({})),share_rpc,&transport).await.err().unwrap().code,code);assert_eq!(transport.requests.lock().unwrap().len(),1);assert!(service.active.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default();let transport=FakeTransport::new(&[]);
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
        assert_eq!(service.read_with(suggested_request("suggested-network",json!({})),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
        for changed in [false,true] {
            let service=ChatgptService::default();let transport=instructions_transport(if changed{&[401]}else{&[401,200]},&[Value::Null,json!({"items":[],"cursor":null})]);
            let rpc=|method,params:Value|if method=="getAuthStatus"&&params["refreshToken"]==true{std::future::ready(Ok(auth(&token("account-fixture",if changed{"other-user"}else{"user-fixture"},4102444801))))}else{share_rpc(method,params)};
            let result=service.read_with(suggested_request("suggested-refresh",json!({"cursor":"page2","source":"generated"})),rpc,&transport).await;
            if changed{assert_eq!(result.err().unwrap().code,"account_changed");}else{assert_eq!(result.unwrap().body,json!({"items":[],"cursor":null}));}
            let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),if changed{1}else{2});if !changed{assert_eq!(calls[0].body,calls[1].body);assert_ne!(calls[0].headers["Authorization"],calls[1].headers["Authorization"]);}
            assert!(service.active.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default();let transport=FakeTransport::new(&[401,401]);assert_eq!(service.read_with(suggested_request("suggested-twice",json!({})),share_rpc,&transport).await.err().unwrap().code,"unauthorized");assert_eq!(transport.requests.lock().unwrap().len(),2);
    }

    #[tokio::test]
    async fn library_suggested_cancel_and_late_completion_do_not_publish_a_body() {
        for invalidate in [false,true] {
            let service=ChatgptService::default();let mut transport=FakeTransport::new(&[200]);transport.delay_ms=1000;
            let read=service.read_with(suggested_request("suggested-pending",json!({})),share_rpc,&transport);
            let cancel=async {while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}if invalidate{service.invalidate();}else{service.cancel("suggested-pending");}};
            assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,if invalidate{"account_changed"}else{"cancelled"});assert!(transport.dropped.load(Ordering::SeqCst));assert!(service.active.lock().unwrap().is_empty());
        }
        struct CancelOnComplete;
        impl Transport for CancelOnComplete {
            fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{cancel.store(true,Ordering::SeqCst);Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"items":[],"cursor":null}"#.to_vec()})})}
        }
        let service=ChatgptService::default();assert_eq!(service.read_with(suggested_request("suggested-late",json!({})),share_rpc,&CancelOnComplete).await.err().unwrap().code,"cancelled");assert!(service.active.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn library_read_fixed_methods_body_and_identity_bound_fixture() {
        let body = json!({"items":[{"id":"file-fixture","file_name":"图像.png","file_size_bytes":1024,
            "directory_id":null,"current_version_number":2}],"cursor":"next-fixture"});
        let transport = instructions_transport(&[200], &[body.clone()]);
        let service = ChatgptService::default();
        let mut req = library_request("library-fixture", ServiceOperation::LibraryImages);
        req.params = json!({"cursor":"cursor-fixture","source":"generated","exclude_saved_responses":false});
        let result = service.read_with(req, share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, body);
        assert_eq!(result.identity, identity());
        let public = serde_json::to_string_pretty(&result).unwrap();
        assert!(!public.contains(&fixture_token()));
        if let Ok(path) = std::env::var("CODEX_LIBRARY_FIXTURE") { std::fs::write(path, public).unwrap(); }
        let calls = transport.requests.lock().unwrap();
        assert_eq!(calls.len(),1);
        assert_eq!(calls[0].method,HttpMethod::Post);
        assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/files/library");
        assert_eq!(calls[0].headers["Content-Type"],"application/json");
        assert_eq!(calls[0].headers["Authorization"],format!("Bearer {}",fixture_token()));
        assert_eq!(calls[0].headers["ChatGPT-Account-Id"],"account-fixture");
        assert_eq!(calls[0].headers["oai-did"],"fixture-device");
        assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),json!({
            "cursor":"cursor-fixture","source":"generated","exclude_saved_responses":false,
            "limit":50,"categories":["image"],"include_hidden_files":false,
            "include_saved_entities":true,"include_sites":false,"trashed_only":false}));
        assert_eq!(library_images_body(&json!({})).unwrap(),json!({"cursor":null,"source":null,
            "limit":50,"categories":["image"],"include_hidden_files":false,
            "include_saved_entities":true,"include_sites":false,"trashed_only":false}));
        drop(calls);
        for (operation,path) in [(ServiceOperation::LibraryNodes,"nodes"),(ServiceOperation::LibraryFavorites,"favorites")] {
            let transport=FakeTransport::new(&[200]);
            service.read_with(library_request("library-get",operation),share_rpc,&transport).await.unwrap();
            let calls=transport.requests.lock().unwrap();
            assert_eq!(calls[0].method,HttpMethod::Get);
            assert_eq!(calls[0].url,format!("https://chatgpt.com/backend-api/files/library/{path}"));
            assert!(calls[0].body.is_empty());
        }
        assert_eq!(resolve_route(&ServiceOperation::LibraryNodes,&json!({"entry_surface":"library",
            "defer_sharing_badges":true,"defer_page_sharing_badges":false,"enable_page_type_filters":true,
            "include_provider_roots":false})).unwrap(),
            "/backend-api/files/library/nodes?defer_page_sharing_badges=false&defer_sharing_badges=true&enable_page_type_filters=true&entry_surface=library&include_provider_roots=false");
    }

    #[tokio::test]
    async fn library_read_rejects_untrusted_queries_before_auth() {
        for params in [json!({"url":"https://other.test"}),json!({"method":"DELETE"}),json!({"body":{}}),
            json!({"limit":51}),json!({"categories":["file"]}),json!({"cursor":""}),json!({"cursor":"\n"}),
            json!({"cursor":false}),json!({"source":" "}),json!({"exclude_saved_responses":null}),json!([])] {
            let service=ChatgptService::default();
            let transport=FakeTransport::new(&[]);
            let mut req=library_request("library-invalid",ServiceOperation::LibraryImages); req.params=params;
            let calls=AtomicUsize::new(0);
            let rpc=|_,_| { calls.fetch_add(1,Ordering::SeqCst); std::future::ready(Err("must not authenticate".into())) };
            assert_eq!(service.read_with(req,rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert_eq!(calls.load(Ordering::SeqCst),0);
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        assert!(library_images_body(&json!({"cursor":"x".repeat(2049)})).is_err());
        for params in [json!({"defer_sharing_badges":"true"}),json!({"enable_page_type_filters":1}),json!({"includeProviderRoots":true})] {
            assert!(resolve_route(&ServiceOperation::LibraryNodes,&params).is_err());
        }
    }

    #[tokio::test]
    async fn library_read_http_failures_and_network_policy_stay_errors() {
        for operation in [ServiceOperation::LibraryNodes,ServiceOperation::LibraryDirectoryPath,ServiceOperation::LibraryFavorites,ServiceOperation::LibraryImages,ServiceOperation::LibrarySettings,ServiceOperation::ShareAccounts] {
            for (status,code) in [(401,"unauthorized"),(403,"forbidden"),(404,"not_found"),(429,"rate_limited")] {
                let service=ChatgptService::default();
                let transport=FakeTransport::new(if status==401 { &[401,401] } else { std::slice::from_ref(&status) });
                assert_eq!(service.read_with(library_request("library-http",operation.clone()),share_rpc,&transport).await.err().unwrap().code,code);
                assert_eq!(transport.requests.lock().unwrap().len(),if status==401 {2} else {1});
            }
            let service=ChatgptService::default();
            let transport=FakeTransport::new(&[]);
            let denied=|method,params| {
                if method=="configRequirements/read" { std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}))) }
                else { share_rpc(method,params) }
            };
            assert_eq!(service.read_with(library_request("library-denied",operation),denied,&transport).await.err().unwrap().code,"network_restricted");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn library_read_cancel_and_generation_drop_pending_transport() {
        for operation in [ServiceOperation::LibraryNodes,ServiceOperation::LibraryDirectoryPath,ServiceOperation::LibraryFavorites,ServiceOperation::LibraryImages,ServiceOperation::LibrarySettings,ServiceOperation::ShareAccounts] {
            for invalidate in [false,true] {
                let service=ChatgptService::default();
                let mut transport=FakeTransport::new(&[200]); transport.delay_ms=2000;
                let read=service.read_with(library_request("library-pending",operation.clone()),share_rpc,&transport);
                let change=async {
                    while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                    if invalidate { service.invalidate(); } else { service.cancel("library-pending"); }
                };
                assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate {"account_changed"} else {"cancelled"});
                assert!(transport.dropped.load(Ordering::SeqCst));
                assert!(service.active.lock().unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn images_assets_roles_are_unambiguous_in_real_metadata_envelope() {
        let service=ChatgptService::default();
        let transport=FakeTransport::new(&[200]);
        transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({
            "styles":[{"id":"same","image_url":"https://images.example.test/style"}],
            "image_suggestions":[{"id":"same","image_url":"https://images.example.test/suggestion"}]
        })).unwrap();
        let mut req=request("images-roles");req.operation=ServiceOperation::ImagesStyles;
        let response=service.read_with(req,share_rpc,&transport).await.unwrap();
        let envelope=serde_json::to_value(response).unwrap();
        let assets=envelope["assets"].as_array().expect("real Images metadata must expose opaque assets");
        assert_eq!(assets.len(),2);
        assert_eq!(assets[0]["role"],"styles");assert_eq!(assets[1]["role"],"image_suggestions");
        assert_ne!(assets[0]["assetKey"],assets[1]["assetKey"]);
        for asset in assets {
            let download=FakeTransport::new(&[200]);
            download.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();
            let mut req=request(&format!("asset-{}",asset["role"].as_str().unwrap()));
            req.operation=serde_json::from_value(json!("images_asset")).expect("registered image operation");
            req.params=json!({"asset_key":asset["assetKey"],"source_request_id":asset["sourceRequestId"]});
            assert!(service.read_with(req,share_rpc,&download).await.unwrap().body["dataUrl"].as_str().unwrap().starts_with("data:image/png;base64,"));
            let requests=download.requests.lock().unwrap();
            assert!(requests[0].headers.is_empty());
            assert!(requests[0].url.ends_with(if asset["role"]=="styles" {"/style"} else {"/suggestion"}));
        }
    }

    #[tokio::test]
    async fn images_assets_inflight_download_cannot_survive_a_new_denial() {
        let service=ChatgptService::default();
        let metadata=FakeTransport::new(&[200]);
        metadata.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({"items":[{"id":"image-a","url":"https://images.example.test/a"}]})).unwrap();
        let mut req=request("images-allowed");req.operation=ServiceOperation::ImagesRecent;
        let envelope=serde_json::to_value(service.read_with(req,share_rpc,&metadata).await.unwrap()).unwrap();
        let asset=&envelope["assets"][0];assert!(asset.is_object(),"metadata must register real image");
        let mut req=request("images-downloading");req.operation=serde_json::from_value(json!("images_asset")).unwrap();
        req.params=json!({"asset_key":asset["assetKey"],"source_request_id":asset["sourceRequestId"]});
        struct DelayedImage {entered:AtomicBool,release:tokio::sync::Notify}
        impl Transport for DelayedImage {
            fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> {Box::pin(async move {
                self.entered.store(true,Ordering::SeqCst);self.release.notified().await;
                Ok(HttpResponse {status:200,headers:BTreeMap::new(),body:b"\x89PNG\r\n\x1a\nfixture".to_vec()})
            })}
        }
        let download=DelayedImage {entered:AtomicBool::new(false),release:tokio::sync::Notify::new()};
        let read=service.read_with(req,share_rpc,&download);
        let deny=async {
            while !download.entered.load(Ordering::SeqCst) {tokio::task::yield_now().await;}
            let denied=FakeTransport::new(&[200]);denied.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({"items":[{"id":"image-a","output_blocked":true}]})).unwrap();
            let mut req=request("images-denied");req.operation=ServiceOperation::ImagesRecent;
            service.read_with(req,share_rpc,&denied).await.unwrap();
            download.release.notify_one();
        };
        let (result,())=tokio::join!(read,deny);
        assert_eq!(result.err().expect("denied bytes must never cross IPC").code,"asset_unavailable");
    }

    async fn images_asset_fixture(service: &ChatgptService, id: &str, operation: ServiceOperation, body: Value) -> Value {
        let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();
        let mut req=request(id);req.operation=operation;
        serde_json::to_value(service.read_with(req,share_rpc,&transport).await.unwrap()).unwrap()
    }

    fn images_asset_request(id: &str, asset: &Value) -> ServiceRequest {
        let mut req=request(id);req.operation=ServiceOperation::ImagesAsset;
        req.params=json!({"asset_key":asset["assetKey"],"source_request_id":asset["sourceRequestId"]});req
    }

    #[tokio::test]
    async fn images_assets_original_pointer_resolves_only_on_open_and_is_revoked_with_history() {
        let service=ChatgptService::default();
        let recent=images_asset_fixture(&service,"image-original",ServiceOperation::ImagesRecent,json!({"items":[{
            "id":"image-a","asset_pointer":"sediment://file-a#part","conversation_id":"conversation-1",
            "url":"https://images.example.test/fallback","encodings":{"thumbnail":{"path":"https://images.example.test/thumb"}}
        }]})).await;
        let assets=recent["assets"].as_array().unwrap();
        assert_eq!(assets.len(),2);
        assert_eq!(assets[0]["role"],"recent");
        assert_eq!(assets[1]["role"],"recent_preview");
        let transport=instructions_transport(&[200,200,200],&[json!({"status":"retry"}),json!({
            "download_url":"https://images.example.test/original","content_url":"https://images.example.test/other"
        }),Value::Null]);
        transport.responses.lock().unwrap()[2].body=b"\x89PNG\r\n\x1a\noriginal".to_vec();
        let response=service.read_with(images_asset_request("open-image-original",&assets[1]),share_rpc,&transport).await.unwrap();
        assert_eq!(response.body["dataUrl"],format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\noriginal")));
        {
            let requests=transport.requests.lock().unwrap();
            assert!(requests[0].url.ends_with("/files/download/file-a*part?download_intent=false&inline=true&conversation_id=conversation-1"));
            assert!(requests[0].headers.contains_key("Authorization"));
            assert_eq!(requests[1].url,requests[0].url);
            assert!(requests[1].headers.contains_key("Authorization"));
            assert_eq!(requests[2].url,"https://images.example.test/original");
            assert!(requests[2].headers.is_empty());
        }
        let pending=instructions_transport(&[200],&[json!({"status":"retry"})]);
        let read=service.read_with(images_asset_request("cancel-pending-original",&assets[1]),share_rpc,&pending);
        let cancel=async {
            tokio::time::timeout(Duration::from_secs(5),async {
                while pending.requests.lock().unwrap().is_empty() { tokio::task::yield_now().await; }
            }).await.expect("original resolver did not start");
            service.cancel("cancel-pending-original");
        };
        assert_eq!(tokio::join!(read,cancel).0.err().unwrap().code,"cancelled");
        assert_eq!(pending.requests.lock().unwrap().len(),1);
        images_asset_fixture(&service,"image-original-denied",ServiceOperation::ImagesRecent,json!({"items":[{"id":"image-a","is_archived":true}]})).await;
        let forbidden=FakeTransport::new(&[]);
        for asset in assets {
            let error=service.read_with(images_asset_request("open-image-revoked",asset),share_rpc,&forbidden).await.err().unwrap();
            assert_eq!(error.code,"asset_unavailable");
        }
        assert!(forbidden.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn images_assets_catalog_same_origin_has_no_credentials_and_recent_nullish_path_is_strict() {
        let service=ChatgptService::default();
        let metadata=images_asset_fixture(&service,"catalog-no-auth",ServiceOperation::ImagesInit,json!({"groups":[{"id":"g","items":[
            {"id":"same-origin","image_url":"https://chatgpt.com/backend-api/catalog.png"},
            {"id":"variant","image_url":"","image_variant_urls":["","https://images.example.test/variant"]}
        ]}]})).await;
        assert_eq!(metadata["assets"].as_array().unwrap().len(),2);
        let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nimage".to_vec();
        service.read_with(images_asset_request("catalog-bytes",&metadata["assets"][0]),share_rpc,&transport).await.unwrap();
        assert!(transport.requests.lock().unwrap()[0].headers.is_empty());
        let recent=images_asset_fixture(&service,"nullish",ServiceOperation::ImagesRecent,json!({"items":[
            {"id":"empty","url":"https://images.example.test/fallback","encodings":{"thumbnail":{"path":""}}},
            {"id":"null","url":"https://images.example.test/fallback","encodings":{"thumbnail":{"path":null}}},
            {"id":"blocked","url":"https://images.example.test/blocked","output_blocked":true},
            {"id":"archived","url":"https://images.example.test/archived","is_archived":true}
        ]})).await;
        assert_eq!(recent["assets"].as_array().unwrap().len(),2);
        assert_eq!(recent["assets"][0]["id"],"empty");assert_eq!(recent["assets"][0]["role"],"recent_preview");
        assert_eq!(recent["assets"][1]["id"],"null");assert_eq!(recent["assets"][1]["role"],"recent");
    }

    #[tokio::test]
    async fn images_assets_json_refresh_and_redirect_never_revive_credentials_after_external_hop() {
        for action in ["thumbnail","content","download"] {
            let service=ChatgptService::default();
            let metadata=images_asset_fixture(&service,"json-source",ServiceOperation::ImagesRecent,json!({"items":[{"id":"a","url":format!("/api/library/files/plain-id/{action}")}]})).await;
            let transport=FakeTransport::new(&[200,302,302,200]);
            {let mut responses=transport.responses.lock().unwrap();
                responses[0].body=serde_json::to_vec(&json!({(format!("{action}_url")):"https://chatgpt.com/backend-api/estuary/content?id=img"})).unwrap();
                responses[1].headers.insert("location".into(),"https://images.example.test/external".into());
                responses[2].headers.insert("location".into(),"https://chatgpt.com/backend-api/estuary/content?id=back".into());
                responses[3].body=b"\x89PNG\r\n\x1a\nimage".to_vec();
            }
            service.read_with(images_asset_request("json-bytes",&metadata["assets"][0]),share_rpc,&transport).await.unwrap();
            let requests=transport.requests.lock().unwrap();assert_eq!(requests.len(),4);
            assert!(requests[0].url.contains(&format!("/{action}_url")));
            assert!(requests[0].headers.contains_key("Authorization"));assert!(requests[1].headers.contains_key("Authorization"));
            assert!(requests[2].headers.is_empty());assert!(requests[3].headers.is_empty());
            assert!(requests.iter().all(|request|!request.headers.contains_key("X-OpenAI-Attach-Auth")));
        }
        let service=ChatgptService::default();
        let metadata=images_asset_fixture(&service,"direct-302",ServiceOperation::ImagesRecent,json!({"items":[{"id":"a","url":"/__codex-api/estuary/public_content/enc/image"}]})).await;
        let transport=FakeTransport::new(&[302,200]);transport.responses.lock().unwrap()[0].headers.insert("location".into(),"https://images.example.test/image".into());
        transport.responses.lock().unwrap()[1].body=b"\x89PNG\r\n\x1a\nimage".to_vec();
        service.read_with(images_asset_request("direct-302-bytes",&metadata["assets"][0]),share_rpc,&transport).await.unwrap();
        assert!(transport.requests.lock().unwrap()[1].headers.is_empty());
    }

    #[tokio::test]
    async fn images_assets_reject_bad_selectors_before_auth_and_invalid_payloads_after_download() {
        let service=ChatgptService::default();
        for params in [json!({"url":"https://images.example.test/a"}),json!({"asset_key":"fake","source_request_id":"source","headers":{}}),json!({"asset_key":"fake","source_request_id":"source"})] {
            let mut req=request("bad-image-key");req.operation=ServiceOperation::ImagesAsset;req.params=params;
            let rpc=|_,_| -> std::future::Ready<Result<Value,String>> {panic!("invalid image selector must not invoke credentials")};
            assert!(service.read_with(req,rpc,&FakeTransport::new(&[])).await.is_err());
        }
        let metadata=images_asset_fixture(&service,"bad-image-payload",ServiceOperation::ImagesInit,json!({"groups":[{"items":[{"id":"a","image_url":"https://images.example.test/a"}]}]})).await;
        for (bytes,content_type) in [(b"<html>not an image</html>".to_vec(),None),(b"\x89PNG\r\n\x1a\nimage".to_vec(),Some("text/html")),(vec![0;MAX_RESPONSE as usize+1],None)] {
            let transport=FakeTransport::new(&[200]);{let mut responses=transport.responses.lock().unwrap();responses[0].body=bytes;
                if let Some(mime)=content_type {responses[0].headers.insert("content-type".into(),mime.into());}}
            assert_eq!(service.read_with(images_asset_request("bad-image-bytes",&metadata["assets"][0]),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
    }

    #[tokio::test]
    async fn images_assets_old_keys_stay_revoked_after_denial_and_late_metadata_cannot_restore_them() {
        for denial in ["output_blocked","is_archived"] {
            let service=ChatgptService::default();
            let allowed=json!({"items":[{"id":"a","url":"https://images.example.test/a"}]});
            let mut req=request("old-snapshot");req.operation=ServiceOperation::ImagesRecent;
            let old=service.register_images_assets(&req,&allowed,"https://chatgpt.com",1).unwrap();assert_eq!(old.len(),1);
            let denied=json!({"items":[{"id":"a",(denial):true}]});
            service.register_images_assets(&req,&denied,"https://chatgpt.com",3).unwrap();
            assert!(service.register_images_assets(&req,&allowed,"https://chatgpt.com",2).unwrap().is_empty());
            let transport=FakeTransport::new(&[]);
            let asset=serde_json::to_value(&old[0]).unwrap();
            assert_eq!(service.read_with(images_asset_request("revoked-key",&asset),share_rpc,&transport).await.err().unwrap().code,"asset_unavailable");
            assert!(transport.requests.lock().unwrap().is_empty());
            assert_eq!(service.register_images_assets(&req,&allowed,"https://chatgpt.com",4).unwrap().len(),1);
            assert!(service.read_with(images_asset_request("still-revoked-key",&asset),share_rpc,&transport).await.is_err());
        }
    }

    #[tokio::test]
    async fn images_assets_identity_cancel_policy_redirect_and_capacity_are_bounded() {
        let service=ChatgptService::default();
        let metadata=images_asset_fixture(&service,"bounded-images",ServiceOperation::ImagesRecent,json!({"items":[{"id":"a","url":"https://images.example.test/a"}]})).await;
        let asset=&metadata["assets"][0];
        service.cancel("pre-cancel-image");
        assert_eq!(service.read_with(images_asset_request("pre-cancel-image",asset),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"cancelled");
        let denied=|method,params| if method=="configRequirements/read" {std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))} else {share_rpc(method,params)};
        assert_eq!(service.read_with(images_asset_request("network-denied-image",asset),denied,&FakeTransport::new(&[])).await.err().unwrap().code,"network_restricted");
        let transport=FakeTransport::new(&[302,302,302,302,302,302]);
        for response in transport.responses.lock().unwrap().iter_mut(){response.headers.insert("location".into(),"https://images.example.test/loop".into());}
        assert_eq!(service.read_with(images_asset_request("redirect-limit-image",asset),share_rpc,&transport).await.err().unwrap().code,"invalid_response");assert_eq!(transport.requests.lock().unwrap().len(),6);
        let mut req=request("capacity-image");req.operation=ServiceOperation::ImagesRecent;
        let too_many=json!({"items":(0..1025).map(|i|json!({"id":format!("image-{i}"),"url":"https://images.example.test/a"})).collect::<Vec<_>>()});
        assert_eq!(service.register_images_assets(&req,&too_many,"https://chatgpt.com",100).err().unwrap().code,"asset_limit");
        service.invalidate();
        assert!(service.read_with(images_asset_request("stale-identity-image",asset),share_rpc,&FakeTransport::new(&[])).await.is_err());
    }

    #[tokio::test]
    async fn images_assets_capacity_refresh_recovers_and_evicted_keys_are_unavailable() {
        let service=ChatgptService::default();
        let body=json!({"groups":[{"id":"g","items":(0..1024).map(|i|json!({"id":format!("image-{i}"),"image_url":"https://images.example.test/a"})).collect::<Vec<_>>()}]});
        let first=images_asset_fixture(&service,"capacity-first",ServiceOperation::ImagesInit,body.clone()).await;
        for id in ["capacity-second","capacity-third","capacity-fourth"] {
            images_asset_fixture(&service,id,ServiceOperation::ImagesInit,body.clone()).await;
        }
        let latest=images_asset_fixture(&service,"capacity-refresh",ServiceOperation::ImagesInit,body).await;
        assert_eq!(latest["assets"].as_array().unwrap().len(),1024,"a normal refresh must recover within the registry bound");
        let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nimage".to_vec();
        service.read_with(images_asset_request("capacity-new-bytes",&latest["assets"][0]),share_rpc,&transport).await.unwrap();
        assert_eq!(service.read_with(images_asset_request("capacity-old-bytes",&first["assets"][0]),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"asset_unavailable");
    }

    fn images_read_operations() -> [ServiceOperation; 4] {
        [ServiceOperation::ImagesInit, ServiceOperation::ImagesStyles, ServiceOperation::ImagesRecent,
            serde_json::from_value(json!("images_workspace_settings")).expect("fixed Images workspace operation")]
    }

    #[tokio::test]
    async fn images_read_workspace_route_is_identity_derived_and_rejects_renderer_parameters_before_auth() {
        let operation: ServiceOperation = serde_json::from_value(json!("images_workspace_settings")).unwrap();
        let mut selected = identity(); selected.account_id = "workspace/id?中".into();
        assert_eq!(resolve_read_route(&operation, &json!({}), &selected).unwrap(),
            "/backend-api/accounts/workspace%2Fid%3F%E4%B8%AD/settings");
        for account_id in ["", ".", "..", "a\nb"] {
            selected.account_id = account_id.into();
            assert!(resolve_read_route(&operation, &json!({}), &selected).is_err());
        }
        assert!(resolve_route(&operation, &json!({})).is_err());
        for params in [json!(null), json!([]), json!({"account_id":"other"}), json!({"accountId":"other"}),
            json!({"url":"https://other.test"}), json!({"headers":{}}), json!({"method":"POST"})] {
            let service = ChatgptService::default(); let transport = FakeTransport::new(&[]);
            let calls = AtomicUsize::new(0);
            let rpc = |_,_| { calls.fetch_add(1, Ordering::SeqCst); std::future::ready(Err("must not authenticate".into())) };
            let mut req = request("images-settings-invalid"); req.operation = operation.clone(); req.params = params;
            assert_eq!(service.read_with(req, rpc, &transport).await.err().unwrap().code, "invalid_request");
            assert_eq!(calls.load(Ordering::SeqCst), 0); assert!(transport.requests.lock().unwrap().is_empty());
        }
        let service = ChatgptService::default();
        let body = json!({"permissions":["chatgpt.workspace.feature.image-gen.access"]});
        let transport = instructions_transport(&[200], &[body.clone()]);
        let mut req = request("images-settings"); req.operation = operation;
        let result = service.read_with(req, share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, body); assert_eq!(result.identity, identity());
        let calls = transport.requests.lock().unwrap(); assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].method, HttpMethod::Get); assert!(calls[0].body.is_empty());
        assert_eq!(calls[0].url, "https://chatgpt.com/backend-api/accounts/account-fixture/settings");
        assert_eq!(calls[0].headers["ChatGPT-Account-Id"], "account-fixture");
    }

    #[tokio::test]
    async fn images_read_network_denial_prevents_all_metadata_transports() {
        // Keep the existing three reads ahead of the new operation: this catches their current policy gap independently.
        for operation in [ServiceOperation::ImagesInit, ServiceOperation::ImagesStyles, ServiceOperation::ImagesRecent] {
            let service = ChatgptService::default(); let transport = FakeTransport::new(&[200]);
            let denied = |method,params| if method == "configRequirements/read" {
                std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))
            } else { share_rpc(method,params) };
            let mut req = request("images-network-denied"); req.operation = operation;
            let result = service.read_with(req, denied, &transport).await;
            assert!(result.is_err(), "Images metadata was delivered despite network denial; policy RPC was skipped and {} HTTP request(s) escaped", transport.requests.lock().unwrap().len());
            assert_eq!(result.err().unwrap().code, "network_restricted");
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        let service = ChatgptService::default(); let transport = FakeTransport::new(&[200]);
        let denied = |method,params| if method == "configRequirements/read" {
            std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))
        } else { share_rpc(method,params) };
        let mut req = request("images-settings-denied"); req.operation = images_read_operations()[3].clone();
        assert_eq!(service.read_with(req, denied, &transport).await.err().unwrap().code, "network_restricted");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn images_read_completion_cancellation_does_not_release_a_ready_body() {
        struct CancelOnComplete;
        impl Transport for CancelOnComplete {
            fn send(&self, _:HttpRequest, cancel:Arc<AtomicBool>) -> TransportFuture<'_> {
                Box::pin(async move { cancel.store(true, Ordering::SeqCst);
                    Ok(HttpResponse {status:200, headers:BTreeMap::new(), body:br#"{"items":[{"id":"private"}]}"#.to_vec()}) })
            }
        }
        // Existing reads must reject ready-but-cancelled responses too.
        for operation in [ServiceOperation::ImagesInit, ServiceOperation::ImagesStyles, ServiceOperation::ImagesRecent] {
            let service = ChatgptService::default(); let mut req = request("images-complete"); req.operation = operation;
            let result = service.read_with(req, share_rpc, &CancelOnComplete).await;
            assert!(result.is_err(), "Images metadata was delivered after the transport marked its registration cancelled");
            assert_eq!(result.err().unwrap().code, "cancelled");
            assert!(service.active.lock().unwrap().is_empty());
        }
        let service = ChatgptService::default(); let mut req = request("images-settings-complete");
        req.operation = images_read_operations()[3].clone();
        assert_eq!(service.read_with(req, share_rpc, &CancelOnComplete).await.err().unwrap().code, "cancelled");
    }

    #[tokio::test]
    async fn images_read_policy_change_during_transport_does_not_release_a_body() {
        for operation in images_read_operations() {
            let service = ChatgptService::default(); let transport = FakeTransport::new(&[200]);
            let policy_calls = AtomicUsize::new(0);
            let rpc = |method,params| if method == "configRequirements/read" {
                let completed = policy_calls.fetch_add(1, Ordering::SeqCst) > 0;
                std::future::ready(Ok(if completed { json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}) }
                    else { json!({"requirements":null}) }))
            } else { share_rpc(method,params) };
            let mut req = request("images-policy-change"); req.operation = operation;
            let result = service.read_with(req, rpc, &transport).await;
            assert!(result.is_err(), "Images metadata was delivered without rechecking policy at completion; observed {} policy RPC(s)", policy_calls.load(Ordering::SeqCst));
            assert_eq!(result.err().unwrap().code, "network_restricted");
            assert_eq!(transport.requests.lock().unwrap().len(), 1); assert_eq!(policy_calls.load(Ordering::SeqCst), 2);
            assert!(service.active.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn images_read_recent_first_and_next_page_use_the_host_parameter_contract() {
        assert_eq!(resolve_route(&ServiceOperation::ImagesRecent, &json!({"limit":25})).unwrap(),
            "/backend-api/my/recent/image_gen?limit=25");
        assert_eq!(resolve_route(&ServiceOperation::ImagesRecent, &json!({"limit":20,"after":"next"})).unwrap(),
            "/backend-api/my/recent/image_gen?after=next&limit=20");
        assert!(resolve_route(&ServiceOperation::ImagesRecent, &json!({"limit":25,"after":null})).is_err());
    }

    #[tokio::test]
    async fn images_read_ready_body_and_auth_refresh_remain_identity_bound() {
        struct InvalidateOnComplete<'a>(&'a ChatgptService);
        impl Transport for InvalidateOnComplete<'_> {
            fn send(&self, _:HttpRequest, _:Arc<AtomicBool>) -> TransportFuture<'_> {
                Box::pin(async move { self.0.invalidate();
                    Ok(HttpResponse {status:200, headers:BTreeMap::new(), body:br#"{"items":[{"id":"private"}]}"#.to_vec()}) })
            }
        }
        for operation in images_read_operations() {
            let service = ChatgptService::default(); let mut req = request("images-ready-identity"); req.operation = operation.clone();
            assert_eq!(service.read_with(req, share_rpc, &InvalidateOnComplete(&service)).await.err().unwrap().code, "account_changed");
            assert!(service.active.lock().unwrap().is_empty());
            for changed in [false,true] {
                let service = ChatgptService::default(); let transport = FakeTransport::new(if changed {&[401]} else {&[401,200]});
                let rpc = |method,params:Value| if method == "getAuthStatus" && params["refreshToken"] == true {
                    std::future::ready(Ok(auth(&token("account-fixture", if changed {"other-user"} else {"user-fixture"}, 4102444801))))
                } else { share_rpc(method,params) };
                let mut req = request("images-refresh"); req.operation = operation.clone();
                let result = service.read_with(req, rpc, &transport).await;
                if changed { assert_eq!(result.err().unwrap().code, "account_changed"); } else { assert!(result.is_ok()); }
                let calls = transport.requests.lock().unwrap(); assert_eq!(calls.len(), if changed {1} else {2});
                if !changed { assert_eq!(calls[0].url, calls[1].url); assert_ne!(calls[0].headers["Authorization"], calls[1].headers["Authorization"]); }
                assert!(service.active.lock().unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn images_read_pending_cancellation_or_identity_change_drops_transport() {
        for operation in images_read_operations() {
            for invalidate in [false,true] {
                let service = ChatgptService::default(); let mut transport = FakeTransport::new(&[200]); transport.delay_ms = 1000;
                let mut req = request("images-pending"); req.operation = operation.clone();
                let read = service.read_with(req, share_rpc, &transport);
                let change = async { while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                    if invalidate { service.invalidate(); } else { service.cancel("images-pending"); } };
                assert_eq!(tokio::join!(read,change).0.err().unwrap().code, if invalidate {"account_changed"} else {"cancelled"});
                assert!(transport.dropped.load(Ordering::SeqCst)); assert!(service.active.lock().unwrap().is_empty());
            }
        }
    }

    fn archive_tasks_request(id: &str, params: Value) -> ServiceRequest {
        let mut request = request(id);
        request.operation = ServiceOperation::ArchiveCloudTasks;
        request.params = params;
        request
    }

    #[tokio::test]
    async fn archive_cloud_tasks_rejects_parameters_before_auth_or_http() {
        let invalid = [json!([]), json!(null), json!({"cursor":true}), json!({"cursor":42}),
            json!({"cursor":["opaque"]}), json!({"cursor":"bad\nvalue"}), json!({"cursor":"x".repeat(2049)}),
            json!({"limit":20}), json!({"task_filter":"all"}), json!({"includeWorkCloud":true}),
            json!({"url":"https://example.test"}), json!({"method":"POST"})];
        for params in invalid {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(&[]);
            let calls = AtomicUsize::new(0);
            let rpc = |method,params| { calls.fetch_add(1,Ordering::SeqCst); share_rpc(method,params) };
            assert_eq!(service.read_with(archive_tasks_request("archive-invalid",params),rpc,&transport).await.err().unwrap().code,"invalid_request");
            assert_eq!(calls.load(Ordering::SeqCst),0);
            assert!(transport.requests.lock().unwrap().is_empty());
        }
        assert!(serde_json::from_value::<ServiceOperation>(json!("archive_cloud_tasks")).is_ok());
        assert!(serde_json::from_value::<ServiceOperation>(json!("archive_chatgpt_conversations")).is_err());
    }

    #[tokio::test]
    async fn archive_cloud_tasks_fixed_get_encodes_opaque_cursor_and_preserves_service_identity() {
        for cursor in [None,Some(""),Some("opaque &?#/中+=%"),Some(" ")] {
            let service = ChatgptService::default();
            let params = cursor.map(|cursor|json!({"cursor":cursor})).unwrap_or_else(||json!({"cursor":null}));
            let body = json!({"items":[{"id":"cloud-task-fixture","title":"真实shape fixture"}],"cursor":"next opaque"});
            let transport = instructions_transport(&[200],&[body.clone()]);
            let policy_calls = AtomicUsize::new(0);
            let rpc = |method,params| {
                if method == "configRequirements/read" {
                    policy_calls.fetch_add(1,Ordering::SeqCst);
                    std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{"chatgpt.com":"allow"}}}}})))
                } else { share_rpc(method,params) }
            };
            let result = service.read_with(archive_tasks_request("archive-fixed",params),rpc,&transport).await.unwrap();
            assert_eq!(result.body,body); assert_eq!(result.status,200); assert_eq!(result.identity,identity());
            assert!(!serde_json::to_string(&result).unwrap().contains(&fixture_token()));
            assert_eq!(policy_calls.load(Ordering::SeqCst),1);
            let sent = transport.requests.lock().unwrap();
            assert_eq!(sent.len(),1); assert_eq!(sent[0].method,HttpMethod::Get); assert!(sent[0].body.is_empty());
            let url = tauri::Url::parse(&sent[0].url).unwrap();
            assert_eq!(url.origin().ascii_serialization(),"https://chatgpt.com");
            assert_eq!(url.path(),"/backend-api/wham/tasks/list");
            let pairs = url.query_pairs().map(|(key,value)|(key.into_owned(),value.into_owned())).collect::<Vec<_>>();
            let mut expected = vec![("limit".to_owned(),"20".to_owned()),("task_filter".to_owned(),"archived".to_owned())];
            if let Some(cursor) = cursor { expected.push(("cursor".to_owned(),cursor.to_owned())); }
            assert_eq!(pairs,expected);
            assert_eq!(sent[0].headers["ChatGPT-Account-Id"],"account-fixture");
            assert_eq!(sent[0].headers["oai-did"],"fixture-device");
            assert_eq!(sent[0].headers["OAI-Language"],"zh-CN");
            assert!(sent[0].headers["Authorization"] == format!("Bearer {}",fixture_token()));
        }
        assert_eq!(resolve_route(&ServiceOperation::ArchiveCloudTasks,&json!({})).unwrap(),
            "/backend-api/wham/tasks/list?limit=20&task_filter=archived");
    }

    #[tokio::test]
    async fn archive_cloud_tasks_terminal_http_empty_is_scoped_and_keeps_status_after_refresh() {
        for status in [401,403,404] {
            let service = ChatgptService::default();
            let responses = if status == 401 { vec![401,401] } else { vec![status] };
            let transport = FakeTransport::new(&responses);
            let refreshes = AtomicUsize::new(0);
            let rpc = |method,params:Value| {
                if method == "getAuthStatus" && params["refreshToken"] == true { refreshes.fetch_add(1,Ordering::SeqCst); }
                share_rpc(method,params)
            };
            let result = service.read_with(archive_tasks_request("archive-empty",json!({})),rpc,&transport).await.unwrap();
            assert_eq!(result.status,status); assert!(result.body.is_null()); assert!(result.headers.is_empty());
            assert_eq!(refreshes.load(Ordering::SeqCst),usize::from(status==401));
            assert_eq!(transport.requests.lock().unwrap().len(),responses.len());
            let legacy = FakeTransport::new(&responses);
            let error = ChatgptService::default().read_with(request("legacy-http"),share_rpc,&legacy).await.err().unwrap();
            assert_eq!(error.code,match status {401=>"unauthorized",403=>"forbidden",_=>"not_found"});
        }
        let transport = instructions_transport(&[401,200],&[Value::Null,json!({"items":[],"cursor":null})]);
        let result = ChatgptService::default().read_with(archive_tasks_request("archive-refreshed",json!({})),share_rpc,&transport).await.unwrap();
        assert_eq!(result.status,200); assert!(result.body["items"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn archive_cloud_tasks_policy_ip_rate_service_and_json_errors_never_become_empty() {
        for code in ["ip_not_authorized","validate_whitelist_failed","workspace_ip_not_authorized"] {
            let transport = instructions_transport(&[401],&[json!({"error":{"code":code}})]);
            let refreshes = AtomicUsize::new(0);
            let rpc = |method,params:Value| {
                if method == "getAuthStatus" && params["refreshToken"] == true { refreshes.fetch_add(1,Ordering::SeqCst); }
                share_rpc(method,params)
            };
            let error = ChatgptService::default().read_with(archive_tasks_request("archive-ip",json!({})),rpc,&transport).await.err().unwrap();
            assert_eq!(error.code,"ip_not_authorized"); assert_eq!(refreshes.load(Ordering::SeqCst),0);
            assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
        for (status,code) in [(429,"rate_limited"),(500,"service_error")] {
            let transport = FakeTransport::new(&[status]);
            assert_eq!(ChatgptService::default().read_with(archive_tasks_request("archive-http-fail",json!({})),share_rpc,&transport).await.err().unwrap().code,code);
        }
        let transport = FakeTransport::new(&[200]); transport.responses.lock().unwrap()[0].body=b"not json".to_vec();
        assert_eq!(ChatgptService::default().read_with(archive_tasks_request("archive-json",json!({})),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        let transport = FakeTransport::new(&[]);
        let denied = |method,params| {
            if method=="configRequirements/read" { std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}))) }
            else { share_rpc(method,params) }
        };
        assert_eq!(ChatgptService::default().read_with(archive_tasks_request("archive-policy",json!({})),denied,&transport).await.err().unwrap().code,"network_restricted");
        assert!(transport.requests.lock().unwrap().is_empty());
        let unavailable = |method,params| {
            if method=="configRequirements/read" { std::future::ready(Err("fixture policy unavailable".into())) }
            else { share_rpc(method,params) }
        };
        assert_eq!(ChatgptService::default().read_with(archive_tasks_request("archive-policy-error",json!({})),unavailable,&transport).await.err().unwrap().code,"network_policy_unavailable");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn archive_cloud_tasks_cancel_and_identity_changes_drop_pending_or_queued_results() {
        for invalidate in [false,true] {
            let service = ChatgptService::default();
            let mut transport = FakeTransport::new(&[403]); transport.delay_ms=2000;
            let read = service.read_with(archive_tasks_request("archive-pending",json!({})),share_rpc,&transport);
            let change = async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); service.invalidate(); } else { service.cancel("archive-pending"); }
            };
            assert_eq!(tokio::join!(read,change).0.err().unwrap().code,if invalidate {"account_changed"} else {"cancelled"});
            assert!(transport.dropped.load(Ordering::SeqCst));
            assert!(service.active.lock().unwrap().is_empty());
        }
        let service = ChatgptService::default(); service.cancel("archive-pre-cancel");
        let transport = FakeTransport::new(&[]);
        assert_eq!(service.read_with(archive_tasks_request("archive-pre-cancel",json!({})),share_rpc,&transport).await.err().unwrap().code,"cancelled");
        assert!(transport.requests.lock().unwrap().is_empty());
        let service = ChatgptService::default();
        let guard = service.session.lock().await;
        let calls = AtomicUsize::new(0);
        let rpc = |method,params| { calls.fetch_add(1,Ordering::SeqCst); share_rpc(method,params) };
        let queued = service.read_with(archive_tasks_request("archive-queued",json!({})),rpc,&transport);
        let cancel = async { tokio::task::yield_now().await; service.cancel("archive-queued"); };
        assert_eq!(tokio::join!(queued,cancel).0.err().unwrap().code,"cancelled");
        assert_eq!(calls.load(Ordering::SeqCst),0); drop(guard);
        let mut wrong = archive_tasks_request("archive-mismatch",json!({})); wrong.expected_identity.user_id="other-user".into();
        assert_eq!(ChatgptService::default().read_with(wrong,share_rpc,&transport).await.err().unwrap().code,"account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn archive_cloud_tasks_cancellation_at_transport_completion_cannot_return_http_empty() {
        struct CompletionChange<'a> { service:&'a ChatgptService, invalidate:bool }
        impl Transport for CompletionChange<'_> {
            fn send(&self, _:HttpRequest, _:Arc<AtomicBool>) -> TransportFuture<'_> {
                Box::pin(async move {
                    if self.invalidate { self.service.invalidate(); } else { self.service.cancel("archive-completion"); }
                    Ok(HttpResponse { status:403,headers:BTreeMap::new(),body:b"{}".to_vec() })
                })
            }
        }
        for invalidate in [false,true] {
            let service=ChatgptService::default();
            let transport=CompletionChange {service:&service,invalidate};
            assert_eq!(service.read_with(archive_tasks_request("archive-completion",json!({})),share_rpc,&transport).await.err().unwrap().code,
                if invalidate {"account_changed"} else {"cancelled"});
        }
    }

    #[tokio::test]
    async fn storage_usage_is_fixed_get_with_authenticated_headers_and_real_body() {
        let service = ChatgptService::default();
        let body = json!({"used_bytes":943718400,"allowed_bytes":1048576000,"remaining_bytes":104857600,
            "is_over_limit":false,"limit_tier":"plus","plan_type":"plus"});
        let transport = instructions_transport(&[200], &[body.clone()]);
        let result = service.read_with(storage_request("storage-fixture"), share_rpc, &transport).await.unwrap();
        assert_eq!(result.body, body);
        assert_eq!(result.identity, identity());
        let public = serde_json::to_string_pretty(&result).unwrap();
        assert!(!public.contains(&fixture_token()));
        if let Ok(path) = std::env::var("CODEX_STORAGE_USAGE_FIXTURE") {
            std::fs::write(path, public).unwrap();
        }
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, HttpMethod::Get);
        assert_eq!(requests[0].url, "https://chatgpt.com/backend-api/files/library/storage/usage");
        assert!(requests[0].body.is_empty());
        assert_eq!(requests[0].headers["Authorization"], format!("Bearer {}", fixture_token()));
        assert_eq!(requests[0].headers["ChatGPT-Account-Id"], "account-fixture");
        assert_eq!(requests[0].headers["oai-did"], "fixture-device");
        assert_eq!(requests[0].headers["OAI-Language"], "zh-CN");
        for params in [json!({"url":"https://other.test"}), json!({"accountId":"other"}),
            json!({"headers":{}}), json!({"cursor":"unknown"})] {
            assert!(resolve_route(&ServiceOperation::StorageUsage, &params).is_err());
        }
    }

    #[tokio::test]
    async fn storage_usage_http_errors_never_become_success_or_zero_usage() {
        for (status, code) in [(401,"unauthorized"),(403,"forbidden"),(404,"not_found"),(429,"rate_limited"),(500,"service_error")] {
            let service = ChatgptService::default();
            let transport = FakeTransport::new(if status == 401 { &[401,401] } else { std::slice::from_ref(&status) });
            let error = service.read_with(storage_request("storage-failed"), share_rpc, &transport).await.err().unwrap();
            assert_eq!(error.code, code);
            assert_eq!(transport.requests.lock().unwrap().len(), if status == 401 {2} else {1});
        }
    }

    #[tokio::test]
    async fn storage_usage_network_policy_and_identity_prevent_cross_account_reads() {
        let service = ChatgptService::default();
        let transport = FakeTransport::new(&[]);
        let denied = |method, params| {
            if method == "configRequirements/read" { std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}))) }
            else { share_rpc(method, params) }
        };
        assert_eq!(service.read_with(storage_request("storage-denied"), denied, &transport).await.err().unwrap().code, "network_restricted");
        let mut wrong = storage_request("storage-wrong");
        wrong.expected_identity.account_id = "other-account".into();
        assert_eq!(service.read_with(wrong, share_rpc, &transport).await.err().unwrap().code, "account_changed");
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn storage_usage_cancellation_and_generation_drop_pending_http() {
        for invalidate in [false,true] {
            let service = ChatgptService::default();
            let mut transport = FakeTransport::new(&[200]);
            transport.delay_ms = 2000;
            let read = service.read_with(storage_request("storage-pending"), share_rpc, &transport);
            let change = async {
                while !transport.entered.load(Ordering::SeqCst) { tokio::task::yield_now().await; }
                if invalidate { service.invalidate(); } else { service.cancel("storage-pending"); }
            };
            let result = tokio::join!(read,change).0;
            assert_eq!(result.err().unwrap().code, if invalidate {"account_changed"} else {"cancelled"});
            assert!(transport.dropped.load(Ordering::SeqCst));
            assert!(service.active.lock().unwrap().is_empty());
        }
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

#[cfg(test)]
mod gpts20e_regression {
    use super::*;


    #[tokio::test]
    async fn gpts_avatar_metadata_requires_explicit_refs_and_fixed_bytes_operation() {
        let service=ChatgptService::default();
        let mut req=request("gpts-metadata"); req.operation=ServiceOperation::GptsDiscovery;
        let transport=FakeTransport::new(&[200]);
        transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({"cuts":[{"list":{"items":[{"resource":{"gizmo":{"id":"g-one","display":{"profile_picture_url":"https://images.example.test/avatar.png"}}}}]}}]})).unwrap();
        let value=serde_json::to_value(service.read_with(req,share_rpc,&transport).await.unwrap()).unwrap();
        assert!(value["gptAssets"].is_array(), "GPT metadata must explicitly grant avatar references");
        assert_eq!(value["gptAssets"][0]["id"],"g-one");
        let mut bytes=request("gpts-avatar"); bytes.operation=serde_json::from_value(json!("gpts_avatar")).expect("fixed avatar operation");
        bytes.params=json!({"asset_key":value["gptAssets"][0]["assetKey"],"source_request_id":"gpts-metadata"});
        let transport=FakeTransport::new(&[200]); transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();
        let body=service.read_with(bytes,share_rpc,&transport).await.unwrap().body;
        assert!(body["dataUrl"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert!(transport.requests.lock().unwrap()[0].headers.is_empty());
    }

    #[tokio::test]
    async fn gpts_metadata_network_policy_prevents_transport() {
        for operation in [ServiceOperation::GptsDiscovery,ServiceOperation::GptsCategory,ServiceOperation::GptsSearch,ServiceOperation::GptsDetail,ServiceOperation::GptsAbout,ServiceOperation::GptsWorkspaceSettings] {
            let service=ChatgptService::default(); let mut req=request("gpts-policy");req.operation=operation;
            req.params=match req.operation {ServiceOperation::GptsCategory=>json!({"id":"cut"}),ServiceOperation::GptsSearch=>json!({"q":"test"}),ServiceOperation::GptsDetail|ServiceOperation::GptsAbout=>json!({"id":"g-one"}),_=>json!({})};
            let transport=FakeTransport::new(&[200]);
            let denied=|method,params| if method=="configRequirements/read" {std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))} else {share_rpc(method,params)};
            let result=service.read_with(req,denied,&transport).await;
            assert!(result.is_err()); assert!(transport.requests.lock().unwrap().is_empty(),"policy before transport");
        }
    }
    fn metadata_request(id:&str,operation:ServiceOperation)->ServiceRequest {
        let mut req=request(id); req.params=match operation {ServiceOperation::GptsCategory=>json!({"id":"cut"}),ServiceOperation::GptsSearch=>json!({"q":"test"}),ServiceOperation::GptsDetail|ServiceOperation::GptsAbout=>json!({"id":"g-one"}),_=>json!({})};req.operation=operation;req
    }
    fn gpts_operations()->Vec<ServiceOperation> {vec![ServiceOperation::GptsDiscovery,ServiceOperation::GptsCategory,ServiceOperation::GptsSearch,ServiceOperation::GptsDetail,ServiceOperation::GptsAbout,ServiceOperation::GptsWorkspaceSettings]}
    fn avatar_body(url:Option<&str>)->Value {json!({"gizmo":{"id":"g-one","display":{"profile_picture_url":url}},"tools":[]})}
    async fn avatar_fixture(service:&ChatgptService,id:&str,url:&str)->Value {
        let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&avatar_body(Some(url))).unwrap();
        serde_json::to_value(service.read_with(metadata_request(id,ServiceOperation::GptsDetail),share_rpc,&transport).await.unwrap()).unwrap()["gptAssets"][0].clone()
    }
    fn avatar_request(id:&str,asset:&Value)->ServiceRequest {let mut req=request(id);req.operation=ServiceOperation::GptsAvatar;req.params=json!({"asset_key":asset["assetKey"],"source_request_id":asset["sourceRequestId"]});req}

    #[tokio::test]
    async fn gpts_metadata_ready_cancel_and_completion_policy_never_deliver_body() {
        struct CancelOnComplete;
        impl Transport for CancelOnComplete {fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> {Box::pin(async move {cancel.store(true,Ordering::SeqCst);Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{}"#.to_vec()})})}}
        for operation in gpts_operations() {
            let service=ChatgptService::default();let result=service.read_with(metadata_request("gpts-ready-cancel",operation.clone()),share_rpc,&CancelOnComplete).await;
            assert_eq!(result.err().unwrap().code,"cancelled");assert!(service.active.lock().unwrap().is_empty());
            let service=ChatgptService::default();let calls=AtomicUsize::new(0);let transport=FakeTransport::new(&[200]);
            let rpc=|method,params| if method=="configRequirements/read" {let completed=calls.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed {json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})} else {json!({"requirements":null})}))} else {share_rpc(method,params)};
            assert_eq!(service.read_with(metadata_request("gpts-complete-policy",operation),rpc,&transport).await.err().unwrap().code,"network_restricted");
            assert_eq!(transport.requests.lock().unwrap().len(),1);assert_eq!(calls.load(Ordering::SeqCst),2);
        }
    }
    #[tokio::test]
    async fn gpts_metadata_shapes_and_empty_refs_are_explicit_and_about_is_separate() {
        let gizmo=json!({"id":"g-one","display":{"profile_picture_url":"https://images.example.test/avatar"}});
        let wrapped=json!({"resource":{"gizmo":gizmo}});
        for (operation,body) in [
            (ServiceOperation::GptsDiscovery,json!({"cuts":[{"list":{"items":[wrapped.clone()]}}]})),
            (ServiceOperation::GptsCategory,json!({"list":{"items":[wrapped.clone()]}})),
            (ServiceOperation::GptsSearch,json!({"items":[{"gizmo":gizmo}]})),
            (ServiceOperation::GptsDetail,json!({"gizmo":gizmo,"tools":[]})),
            // Keep the previously accepted wrapper as an explicit compatibility input.
            (ServiceOperation::GptsDetail,wrapped),
        ] {
            let service=ChatgptService::default();let transport=FakeTransport::new(&[200,200]);
            transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();
            let first=serde_json::to_value(service.read_with(metadata_request("shape",operation.clone()),share_rpc,&transport).await.unwrap()).unwrap();
            assert_eq!(first["gptAssets"].as_array().unwrap().len(),1);assert_eq!(first["gptAssets"][0]["id"],"g-one");
            { let requests=transport.requests.lock().unwrap();
                assert!(!requests[0].headers.contains_key("X-OpenAI-Attach-Auth"), "the official desktop adapter consumes this internal marker before HTTP");
                assert!(requests[0].headers.contains_key("Authorization"));
                assert_eq!(requests[0].headers["ChatGPT-Account-Id"], "account-fixture");
            }
            let empty=serde_json::to_value(service.read_with(metadata_request("empty",operation),share_rpc,&transport).await.unwrap()).unwrap();assert_eq!(empty["gptAssets"],json!([]));
        }
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);
        transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&avatar_body(Some("https://images.example.test/about"))).unwrap();
        let about=serde_json::to_value(service.read_with(metadata_request("about",ServiceOperation::GptsAbout),share_rpc,&transport).await.unwrap()).unwrap();assert!(about.get("gptAssets").is_none());
    }
    #[tokio::test]
    async fn cloud_workspace_settings_identity_route_and_policy_are_fixed() {
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);
        let result=service.read_with(metadata_request("cloud-settings",ServiceOperation::CloudWorkspaceSettings),share_rpc,&transport).await.unwrap();
        assert_eq!(result.identity,identity());
        assert_eq!(transport.requests.lock().unwrap()[0].url,"https://chatgpt.com/backend-api/accounts/account-fixture/settings");
        assert!(matches!(transport.requests.lock().unwrap()[0].method,HttpMethod::Get));
        for params in [Value::Null,json!([]),json!({"account_id":"other"}),json!({"url":"https://evil.test"}),json!({"permissions":[]})] {
            let mut req=metadata_request("invalid-cloud-settings",ServiceOperation::CloudWorkspaceSettings);req.params=params;
            assert_eq!(service.read_with(req,|_,_|std::future::ready(Err("auth must not run".into())),&FakeTransport::new(&[])).await.err().unwrap().code,"invalid_request");
        }
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);
        let denied=|method,params|if method=="configRequirements/read" {std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
        assert!(service.read_with(metadata_request("cloud-settings-denied",ServiceOperation::CloudWorkspaceSettings),denied,&transport).await.is_err());
        assert!(transport.requests.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn gpts_workspace_settings_identity_path_and_parameters_are_fixed() {
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);
        service.read_with(metadata_request("settings",ServiceOperation::GptsWorkspaceSettings),share_rpc,&transport).await.unwrap();
        assert_eq!(transport.requests.lock().unwrap()[0].url,"https://chatgpt.com/backend-api/accounts/account-fixture/settings");
        for params in [Value::Null,json!([]),json!({"account_id":"other"}),json!({"url":"https://evil.test"})] {
            let mut req=metadata_request("invalid-settings",ServiceOperation::GptsWorkspaceSettings);req.params=params;
            assert_eq!(service.read_with(req,|_,_|std::future::ready(Err("auth must not run".into())),&FakeTransport::new(&[])).await.err().unwrap().code,"invalid_request");
        }
    }
    #[tokio::test]
    async fn gpts_avatar_authenticated_subdomain_and_external_redirect_drop_headers_permanently() {
        let service=ChatgptService::default();let asset=avatar_fixture(&service,"protected","https://cdn.chatgpt.com/backend-api/estuary/content?id=a").await;
        let transport=FakeTransport::new(&[302,302,200]);
        {let mut responses=transport.responses.lock().unwrap();responses[0].headers.insert("location".into(),"https://images.example.test/a".into());responses[1].headers.insert("location".into(),"https://chatgpt.com/backend-api/estuary/content?id=b".into());responses[2].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();}
        service.read_with(avatar_request("redirect",&asset),share_rpc,&transport).await.unwrap();
        let requests=transport.requests.lock().unwrap();assert!(requests[0].url.starts_with("https://cdn.chatgpt.com/"));assert!(requests[0].headers.contains_key("Authorization"));assert!(requests[0].headers.contains_key("ChatGPT-Account-Id"));
        assert!(requests[1].headers.is_empty());assert!(requests[2].headers.is_empty());
    }
    #[tokio::test]
    async fn gpts_avatar_rejects_unregistered_cross_role_source_and_bad_payloads() {
        let service=ChatgptService::default();
        for params in [json!({"url":"https://chatgpt.com"}),json!({"asset_key":"unknown","source_request_id":"unknown"}),json!({"asset_key":"unknown","source_request_id":"unknown","headers":{}})] {
            let mut req=request("bad-avatar");req.operation=ServiceOperation::GptsAvatar;req.params=params;
            assert!(service.read_with(req,|_,_|std::future::ready(Err("auth must not run".into())),&FakeTransport::new(&[])).await.is_err());
        }
        let asset=avatar_fixture(&service,"payload","https://images.example.test/a").await;
        let mut wrong_source=avatar_request("wrong-source",&asset);wrong_source.params["source_request_id"]=json!("other");assert_eq!(service.read_with(wrong_source,share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"asset_unavailable");
        let mut images_req=request("images-role");images_req.operation=ServiceOperation::ImagesInit;
        let image=service.register_images_assets(&images_req,&json!({"groups":[{"items":[{"id":"g-one","image_url":"https://images.example.test/a"}]}]}),"https://chatgpt.com",1).unwrap();
        assert_eq!(service.read_with(avatar_request("images-key",&serde_json::to_value(&image[0]).unwrap()),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"asset_unavailable");
        for (mime,bytes) in [("image/png",b"<svg/>".to_vec()),("text/html",b"\x89PNG\r\n\x1a\nfixture".to_vec()),("image/png",vec![0;MAX_RESPONSE as usize+1])] {
            let transport=FakeTransport::new(&[200]);{let mut responses=transport.responses.lock().unwrap();responses[0].body=bytes;responses[0].headers.insert("content-type".into(),mime.into());}
            assert_eq!(service.read_with(avatar_request("invalid-bytes",&asset),share_rpc,&transport).await.err().unwrap().code,"invalid_response");
        }
    }
    #[tokio::test]
    async fn gpts_avatar_policy_cancel_identity_and_redirect_limits_hold() {
        let service=ChatgptService::default();let asset=avatar_fixture(&service,"bounded","https://images.example.test/a").await;
        service.cancel("pre-cancel-avatar");assert_eq!(service.read_with(avatar_request("pre-cancel-avatar",&asset),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"cancelled");
        let denied=|method,params|if method=="configRequirements/read" {std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))} else {share_rpc(method,params)};
        assert_eq!(service.read_with(avatar_request("policy-avatar",&asset),denied,&FakeTransport::new(&[])).await.err().unwrap().code,"network_restricted");
        let transport=FakeTransport::new(&[302,302,302,302,302,302]);for response in transport.responses.lock().unwrap().iter_mut(){response.headers.insert("location".into(),"https://images.example.test/a".into());}
        assert_eq!(service.read_with(avatar_request("loop-avatar",&asset),share_rpc,&transport).await.err().unwrap().code,"invalid_response");assert_eq!(transport.requests.lock().unwrap().len(),6);
        service.invalidate();assert!(service.read_with(avatar_request("old-generation",&asset),share_rpc,&FakeTransport::new(&[])).await.is_err());
    }
    #[tokio::test]
    async fn gpts_avatar_new_metadata_withdraws_old_keys_and_late_response_cannot_restore() {
        let service=ChatgptService::default();let req=metadata_request("registration",ServiceOperation::GptsDetail);
        let old=service.register_gpts_assets(&req,&avatar_body(Some("https://images.example.test/a")),"https://chatgpt.com",1).unwrap();
        service.register_gpts_assets(&req,&avatar_body(None),"https://chatgpt.com",3).unwrap();
        assert!(service.register_gpts_assets(&req,&avatar_body(Some("https://images.example.test/a")),"https://chatgpt.com",2).unwrap().is_empty());
        assert_eq!(service.read_with(avatar_request("revoked",&serde_json::to_value(&old[0]).unwrap()),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"asset_unavailable");
        assert_eq!(service.register_gpts_assets(&req,&avatar_body(Some("https://images.example.test/new")),"https://chatgpt.com",4).unwrap().len(),1);
    }
    #[tokio::test]
    async fn gpts_avatar_inflight_download_is_revoked_by_new_metadata() {
        let service=Arc::new(ChatgptService::default());let asset=avatar_fixture(&service,"inflight","https://images.example.test/a").await;
        let transport=Arc::new(FakeTransport{delay_ms:100,..FakeTransport::new(&[200])});transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();
        let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move {service.read_with(avatar_request("downloading",&asset),share_rpc,transport.as_ref()).await})};
        while !transport.entered.load(Ordering::SeqCst) {tokio::task::yield_now().await;}
        service.register_gpts_assets(&metadata_request("withdraw",ServiceOperation::GptsDetail),&avatar_body(None),"https://chatgpt.com",100).unwrap();
        assert_eq!(task.await.unwrap().err().unwrap().code,"asset_unavailable");
    }
    #[tokio::test]
    async fn gpts_avatar_fifo_capacity_refresh_recovers_without_reviving_evicted_keys() {
        let service=ChatgptService::default();let mut first=None;let mut latest=None;
        for seq in 1..=5 {let req=metadata_request(&format!("capacity-{seq}"),ServiceOperation::GptsCategory);let body=json!({"list":{"items":(0..1024).map(|id|json!({"resource":{"gizmo":{"id":format!("g-{id}"),"display":{"profile_picture_url":"https://images.example.test/a"}}}})).collect::<Vec<_>>()}});
            let refs=service.register_gpts_assets(&req,&body,"https://chatgpt.com",seq).unwrap();assert_eq!(refs.len(),1024);if seq==1 {first=Some(serde_json::to_value(&refs[0]).unwrap());}latest=Some(serde_json::to_value(&refs[0]).unwrap());}
        assert_eq!(service.read_with(avatar_request("evicted",&first.unwrap()),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"asset_unavailable");
        let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();service.read_with(avatar_request("latest",&latest.unwrap()),share_rpc,&transport).await.unwrap();
    }

    #[tokio::test]
    async fn gpts_metadata_generation_change_and_http_errors_are_not_success() {
        struct InvalidateOnComplete<'a>(&'a ChatgptService);
        impl Transport for InvalidateOnComplete<'_> {fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_> {Box::pin(async move {self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{}"#.to_vec()})})}}
        for operation in gpts_operations() {
            let service=ChatgptService::default();assert_eq!(service.read_with(metadata_request("changed",operation.clone()),share_rpc,&InvalidateOnComplete(&service)).await.err().unwrap().code,"account_changed");
            for (status,code) in [(403,"forbidden"),(404,"not_found"),(429,"rate_limited")] {let service=ChatgptService::default();assert_eq!(service.read_with(metadata_request("http-error",operation.clone()),share_rpc,&FakeTransport::new(&[status])).await.err().unwrap().code,code);}
        }
    }
    #[tokio::test]
    async fn gpts_avatar_completion_policy_cancellation_and_snapshot_limit_are_visible() {
        let service=ChatgptService::default();let asset=avatar_fixture(&service,"completion","https://images.example.test/a").await;
        let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();
        let calls=AtomicUsize::new(0);let rpc=|method,params| if method=="configRequirements/read" {let completed=calls.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed {json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})} else {json!({"requirements":null})}))} else {share_rpc(method,params)};
        assert_eq!(service.read_with(avatar_request("completion-policy",&asset),rpc,&transport).await.err().unwrap().code,"network_restricted");assert_eq!(calls.load(Ordering::SeqCst),2);
        struct CancelOnComplete;
        impl Transport for CancelOnComplete {fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_> {Box::pin(async move {cancel.store(true,Ordering::SeqCst);Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:b"\x89PNG\r\n\x1a\nfixture".to_vec()})})}}
        assert_eq!(service.read_with(avatar_request("completion-cancel",&asset),share_rpc,&CancelOnComplete).await.err().unwrap().code,"cancelled");
        let req=metadata_request("snapshot-limit",ServiceOperation::GptsCategory);let body=json!({"list":{"items":(0..1025).map(|id|json!({"resource":{"gizmo":{"id":format!("g-{id}"),"display":{"profile_picture_url":"https://images.example.test/a"}}}})).collect::<Vec<_>>()}});
        assert_eq!(service.register_gpts_assets(&req,&body,"https://chatgpt.com",100).err().unwrap().code,"asset_limit");
        assert_eq!(service.register_gpts_assets(&metadata_request("recover",ServiceOperation::GptsDetail),&avatar_body(Some("https://images.example.test/new")),"https://chatgpt.com",101).unwrap().len(),1);
    }

}

#[cfg(test)]
mod sites21e_regression {
    use super::*;
    fn metadata(id:&str)->ServiceRequest {let mut req=request(id);req.operation=ServiceOperation::SitesDetail;req.params=json!({"id":"site-one"});req}
    fn body(url:Option<&str>)->Value {json!({"id":"site-one","screenshot_url":url})}
    async fn asset(service:&ChatgptService,id:&str,url:&str)->Value {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body(Some(url))).unwrap();serde_json::to_value(service.read_with(metadata(id),share_rpc,&transport).await.unwrap()).unwrap()["siteAssets"][0].clone()}
    fn asset_req(id:&str,asset:&Value)->ServiceRequest {let mut req=request(id);req.operation=ServiceOperation::SitesAsset;req.params=json!({"asset_key":asset["assetKey"],"source_request_id":asset["sourceRequestId"]});req}
    fn pin(id:&str,pinned:bool)->SitesPinRequest {SitesPinRequest{request_id:id.into(),id:"site-one".into(),pinned,expected_identity:identity(),profile:request("unused").profile}}
    #[tokio::test]
    async fn sites_metadata_grants_are_explicit_and_all_reads_obey_policy() {
        for operation in [ServiceOperation::SitesEntryAccess,ServiceOperation::SitesAccess,ServiceOperation::SitesList,ServiceOperation::SitesShared,ServiceOperation::SitesPinned,ServiceOperation::SitesDetail,ServiceOperation::SitesPin] {
            let service=ChatgptService::default();let mut req=metadata("policy");req.operation=operation;
            req.params=if matches!(req.operation,ServiceOperation::SitesDetail|ServiceOperation::SitesPin){json!({"id":"site-one"})}else{json!({})};
            let denied=|method,params|if method=="configRequirements/read" {std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
            let transport=FakeTransport::new(&[200]);assert!(service.read_with(req,denied,&transport).await.is_err());assert!(transport.requests.lock().unwrap().is_empty());
        }
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);let result=serde_json::to_value(service.read_with(metadata("empty"),share_rpc,&transport).await.unwrap()).unwrap();assert_eq!(result["siteAssets"],json!([]));
    }
    #[tokio::test]
    async fn sites_screenshot_withdrawal_late_metadata_and_cross_role_never_restore_grants() {
        let service=ChatgptService::default();let old=service.register_sites_assets(&metadata("old"),&body(Some("https://images.example.test/a")),"https://chatgpt.com",1).unwrap();
        service.register_sites_assets(&metadata("new"),&body(None),"https://chatgpt.com",3).unwrap();
        assert!(service.register_sites_assets(&metadata("late"),&body(Some("https://images.example.test/a")),"https://chatgpt.com",2).unwrap().is_empty());
        assert_eq!(service.read_with(asset_req("revoked",&serde_json::to_value(&old[0]).unwrap()),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"asset_unavailable");
        let current=asset(&service,"current","https://images.example.test/a").await;
        let mut wrong=asset_req("wrong-role",&current);wrong.operation=ServiceOperation::GptsAvatar;
        assert!(service.read_with(wrong,share_rpc,&FakeTransport::new(&[])).await.is_err());
        service.invalidate();assert!(service.read_with(asset_req("identity",&current),share_rpc,&FakeTransport::new(&[])).await.is_err());
    }
    #[tokio::test]
    async fn sites_screenshot_inflight_revocation_and_invalid_payloads_are_rejected() {
        let service=Arc::new(ChatgptService::default());let grant=asset(&service,"inflight","https://images.example.test/a").await;
        let transport=Arc::new(FakeTransport{delay_ms:100,..FakeTransport::new(&[200])});transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();
        let task={let service=service.clone();let transport=transport.clone();let grant=grant.clone();tokio::spawn(async move{service.read_with(asset_req("downloading",&grant),share_rpc,transport.as_ref()).await})};
        while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}
        service.register_sites_assets(&metadata("withdraw"),&body(None),"https://chatgpt.com",100).unwrap();
        assert_eq!(task.await.unwrap().err().unwrap().code,"asset_unavailable");
        let service=ChatgptService::default();let grant=asset(&service,"payload","https://images.example.test/new").await;
        for bytes in [b"<svg/>".to_vec(),vec![0;MAX_RESPONSE as usize+1]] {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=bytes;assert_eq!(service.read_with(asset_req("invalid",&grant),share_rpc,&transport).await.err().unwrap().code,"invalid_response");}
    }
    #[tokio::test]
    async fn sites_pin_uses_exact_empty_post_delete_and_does_not_retry_unknown_outcomes() {
        for pinned in [true,false] {let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({"project_id":"site-one","is_pinned":pinned})).unwrap();
            let result=service.site_pin_with(pin("pin",pinned),share_rpc,&transport).await.unwrap();assert_eq!(result.body["is_pinned"],pinned);
            let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].method,if pinned{HttpMethod::Post}else{HttpMethod::Delete});assert!(calls[0].body.is_empty());assert!(!calls[0].headers.contains_key("Content-Type"));assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/websites/site-one/pin");
        }
        for status in [401,403,500] {let service=ChatgptService::default();let transport=FakeTransport::new(&[status,200]);assert!(service.site_pin_with(pin("failure",true),share_rpc,&transport).await.is_err());assert_eq!(transport.requests.lock().unwrap().len(),1);}
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);assert_eq!(service.site_pin_with(pin("unknown",true),share_rpc,&transport).await.err().unwrap().code,"site_pin_unknown");
    }
    #[tokio::test]
    async fn sites_pin_policy_and_invalid_ids_never_write_and_pending_is_single_flight() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..FakeTransport::new(&[200])});transport.responses.lock().unwrap()[0].body=br#"{"project_id":"site-one","is_pinned":true}"#.to_vec();
        let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.site_pin_with(pin("pending",true),share_rpc,transport.as_ref()).await})};while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}
        assert_eq!(service.site_pin_with(pin("duplicate",false),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"busy");task.await.unwrap().unwrap();
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
        let transport=FakeTransport::new(&[]);assert_eq!(service.site_pin_with(pin("denied",true),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
        let mut invalid=pin("invalid",true);invalid.id="..".into();assert!(service.site_pin_with(invalid,|_,_|std::future::ready(Err("auth must not run".into())),&transport).await.is_err());
    }
    #[tokio::test]
    async fn sites_screenshot_relative_rewrite_and_external_redirect_strip_auth_permanently() {
        let service=ChatgptService::default();let grant=asset(&service,"relative","/api/codex/sites/site-one/screenshot").await;
        let transport=FakeTransport::new(&[302,302,200]);{let mut responses=transport.responses.lock().unwrap();responses[0].headers.insert("location".into(),"https://images.example.test/a".into());responses[1].headers.insert("location".into(),"https://chatgpt.com/backend-api/wham/sites/a".into());responses[2].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();}
        service.read_with(asset_req("redirect",&grant),share_rpc,&transport).await.unwrap();let calls=transport.requests.lock().unwrap();assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/wham/sites/site-one/screenshot");assert!(calls[0].headers.contains_key("Authorization"));assert!(calls[0].headers.contains_key("ChatGPT-Account-Id"));assert!(calls[1].headers.is_empty());assert!(calls[2].headers.is_empty());drop(calls);
        let grant=asset(&service,"anonymous","https://chatgpt.com/backend-api/estuary/public_content/enc/a").await;let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();service.read_with(asset_req("no-marker",&grant),share_rpc,&transport).await.unwrap();assert!(transport.requests.lock().unwrap()[0].headers.is_empty());
    }
    #[tokio::test]
    async fn sites_metadata_and_screenshot_completion_policy_cancellation_and_bad_refs_hold() {
        struct CancelOnComplete;
        impl Transport for CancelOnComplete {fn send(&self,_:HttpRequest,cancel:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{cancel.store(true,Ordering::SeqCst);Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{}"#.to_vec()})})}}
        let service=ChatgptService::default();assert_eq!(service.read_with(metadata("cancel-complete"),share_rpc,&CancelOnComplete).await.err().unwrap().code,"cancelled");
        let grant=asset(&service,"policy-grant","https://images.example.test/a").await;let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"\x89PNG\r\n\x1a\nfixture".to_vec();
        let calls=AtomicUsize::new(0);let rpc=|method,params|if method=="configRequirements/read"{let completed=calls.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed{json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})}else{json!({"requirements":null})}))}else{share_rpc(method,params)};
        assert_eq!(service.read_with(asset_req("complete-policy",&grant),rpc,&transport).await.err().unwrap().code,"network_restricted");
        for params in [json!({"url":"https://chatgpt.com"}),json!({"asset_key":grant["assetKey"],"source_request_id":"wrong"}),json!({"asset_key":grant["assetKey"],"source_request_id":grant["sourceRequestId"],"headers":{}})] {let mut req=asset_req("invalid-ref",&grant);req.params=params;assert!(service.read_with(req,|_,_|std::future::ready(Err("must not auth".into())),&FakeTransport::new(&[])).await.is_err());}
    }
    #[tokio::test]
    async fn sites_pin_cancelled_after_send_is_unknown_without_automatic_retry() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..FakeTransport::new(&[200])});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.site_pin_with(pin("cancel-write",true),share_rpc,transport.as_ref()).await})};while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}service.cancel("cancel-write");assert_eq!(task.await.unwrap().err().unwrap().code,"site_pin_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);
        service.cancel("before-write");let transport=FakeTransport::new(&[]);assert_eq!(service.site_pin_with(pin("before-write",true),share_rpc,&transport).await.err().unwrap().code,"cancelled");assert!(transport.requests.lock().unwrap().is_empty());
    }
    #[test]
    fn sites_fixed_entry_pinned_and_pin_routes_exist() {
        for (name,params,expected) in [
            ("sites_entry_access",json!({}),"/backend-api/codex/sites/access"),
            ("sites_pinned",json!({"limit":20}),"/backend-api/websites/pinned?limit=20"),
            ("sites_pin",json!({"id":"site-one"}),"/backend-api/websites/site-one/pin"),
        ] {
            let operation:ServiceOperation=serde_json::from_value(json!(name)).expect("fixed Sites operation");
            assert_eq!(resolve_route(&operation,&params).unwrap(),expected);
        }
    }
}

#[cfg(test)]
mod sites21f_regression {
    use super::*;
    fn wire(id:&str,mutation:Value)->Value {
        json!({"requestId":id,"expectedIdentity":identity(),"profile":{
            "language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0",
            "userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"id":"site/a?b#c%","mutation":mutation})
    }
    fn write(id:&str,mutation:Value)->SitesSettingsRequest {serde_json::from_value(wire(id,mutation)).unwrap()}
    fn environment()->Value {json!({"operation":"environment","remove":["OLD"],"set_values":[{"is_secret":true,"key":"secret-key","type":"envvar","value":"fixture-secret-value"}]})}
    fn snapshot()->Value {json!({"entries":[{"is_secret":true,"key":"secret-key","type":"envvar","value":null}],"project_id":"site/a?b#c%","revision":1.5,"updated_at":null,"requires_secrets":true})}
    fn response(body:Value)->FakeTransport {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();transport}
    #[tokio::test]
    async fn sites_title_and_environment_use_fixed_post_exact_source_body_and_raw_response() {
        for (mutation,body,suffix,expected) in [
            (json!({"operation":"title","title":"  新标题  "}),json!({"title":"服务端标题","updated_at":"2026-11-07T00:00:00Z","extra":"preserved"}),"metadata",json!({"title":"新标题"})),
            (environment(),snapshot(),"environment",json!({"remove":["OLD"],"set_values":[{"is_secret":true,"key":"secret-key","type":"envvar","value":"fixture-secret-value"}]})),
        ] {
            let service=ChatgptService::default();let transport=response(body.clone());let result=service.sites_settings_with(write("write",mutation),share_rpc,&transport).await.unwrap();
            assert_eq!(result.body,body);assert_eq!(result.identity,identity());
            let sent=transport.requests.lock().unwrap();assert_eq!(sent.len(),1);assert_eq!(sent[0].method,HttpMethod::Post);assert_eq!(sent[0].url,format!("https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/{suffix}"));assert_eq!(sent[0].headers["Content-Type"],"application/json");assert!(sent[0].headers.contains_key("Authorization"));assert!(sent[0].headers.contains_key("ChatGPT-Account-Id"));assert_eq!(serde_json::from_slice::<Value>(&sent[0].body).unwrap(),expected);
        }
    }
    #[tokio::test]
    async fn sites_settings_invalid_fields_fail_before_auth_and_do_not_expose_values() {
        for mutation in [json!({"operation":"title","title":" \t "}),json!({"operation":"environment","remove":[],"set_values":[{"is_secret":false,"key":"  ","type":"envvar","value":"fixture-private"}]}),json!({"operation":"environment","remove":[],"set_values":[{"is_secret":false,"key":"A","type":"envvar","value":"1"},{"is_secret":true,"key":"A","type":"envvar","value":"fixture-private"}]}),json!({"operation":"environment","remove":[],"set_values":[{"is_secret":true,"key":"A","type":"url","value":"fixture-private"}]}),json!({"operation":"title","title":"x".repeat(256*1024+1)})] {
            let service=ChatgptService::default();let transport=FakeTransport::new(&[]);let error=service.sites_settings_with(write("invalid",mutation),|_,_|std::future::ready(Err("auth must not run".into())),&transport).await.err().unwrap();assert_eq!(error.code,"invalid_request");assert!(!error.message.contains("fixture-private"));assert!(transport.requests.lock().unwrap().is_empty());
        }
        let mut request=write("bad-id",json!({"operation":"title","title":"valid"}));request.id="..".into();assert_eq!(ChatgptService::default().sites_settings_with(request,|_,_|std::future::ready(Err("must not auth".into())),&FakeTransport::new(&[])).await.err().unwrap().code,"invalid_request");
        let mut invalid_profile=write("invalid-profile",json!({"operation":"title","title":"valid"}));invalid_profile.profile.device_id="fixture\r\nInjected: private".into();
        assert_eq!(ChatgptService::default().sites_settings_with(invalid_profile,|_,_|std::future::ready(Err("auth must not run".into())),&FakeTransport::new(&[])).await.err().unwrap().code,"invalid_request");
        assert!(serde_json::from_value::<SitesSettingsRequest>(wire("unknown-field",json!({"operation":"title","title":"valid","slug":"unproven"}))).is_err());
    }
    #[tokio::test]
    async fn sites_settings_preserve_raw_keys_empty_literal_values_and_title_ui_only_limit() {
        let service=ChatgptService::default();let transport=response(snapshot());let mutation=json!({"operation":"environment","remove":[],"set_values":[{"is_secret":false,"key":"A","type":"envvar","value":""},{"is_secret":false,"key":"a","type":"envvar","value":"<REDACTED>"},{"is_secret":true,"key":" A ","type":"envvar","value":"new"}]});service.sites_settings_with(write("raw-values",mutation),share_rpc,&transport).await.unwrap();
        let sent=transport.requests.lock().unwrap();let body:Value=serde_json::from_slice(&sent[0].body).unwrap();assert_eq!(body["set_values"][0]["value"],"");assert_eq!(body["set_values"][1]["value"],"<REDACTED>");assert_eq!(body["set_values"][2]["key"]," A ");drop(sent);
        let title="a".repeat(101);let transport=response(json!({"title":title,"updated_at":"now"}));service.sites_settings_with(write("long-title",json!({"operation":"title","title":title})),share_rpc,&transport).await.unwrap();
    }
    #[tokio::test]
    async fn sites_settings_bad_success_is_unknown_and_never_retried() {
        for (mutation,body) in [
            (json!({"operation":"title","title":"new"}),json!({"title":"new"})),
            (environment(),json!({"project_id":"other","entries":[],"revision":1,"updated_at":null})),
            (environment(),json!({"project_id":"site/a?b#c%","entries":[],"updated_at":null})),
            (environment(),json!({"project_id":"site/a?b#c%","entries":[{"key":"A","is_secret":true,"type":"envvar"}],"revision":1,"updated_at":null})),
        ] {let service=ChatgptService::default();let transport=response(body);assert_eq!(service.sites_settings_with(write("bad-success",mutation),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);}
        let service=ChatgptService::default();let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=b"not JSON".to_vec();assert_eq!(service.sites_settings_with(write("bad-json",environment()),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");
    }
    #[tokio::test]
    async fn sites_settings_known_4xx_errors_are_static_and_do_not_retry_or_leak_remote_body() {
        for (status,code) in [(400,"environment_requires_secrets"),(422,"invalid_secret_name"),(403,"regional_environment_unavailable")] {
            let service=ChatgptService::default();let transport=FakeTransport::new(&[status,200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({"detail":{"type":code,"key":"private-key","value":"fixture-private"}})).unwrap();let error=service.sites_settings_with(write("known-error",environment()),share_rpc,&transport).await.err().unwrap();assert_eq!(error.code,code);assert_eq!(error.status,Some(status));assert!(!error.message.contains("fixture-private"));assert!(!error.message.contains("private-key"));assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
        for status in [401,403,409,429,500] {let service=ChatgptService::default();let transport=FakeTransport::new(&[status,200]);let error=service.sites_settings_with(write("http-error",environment()),share_rpc,&transport).await.err().unwrap();if status==500{assert_eq!(error.code,"sites_settings_unknown");}assert_eq!(transport.requests.lock().unwrap().len(),1);}
    }
    #[tokio::test]
    async fn sites_settings_policy_and_pre_cancel_stop_writes_and_sent_cancel_is_unknown() {
        let service=ChatgptService::default();service.cancel("pre-cancel");let transport=FakeTransport::new(&[]);assert_eq!(service.sites_settings_with(write("pre-cancel",environment()),share_rpc,&transport).await.err().unwrap().code,"cancelled");assert!(transport.requests.lock().unwrap().is_empty());
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};
        assert_eq!(service.sites_settings_with(write("policy",environment()),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(snapshot())});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("sent-cancel",environment()),share_rpc,transport.as_ref()).await})};while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}service.cancel("sent-cancel");assert_eq!(task.await.unwrap().err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);
    }
    #[tokio::test]
    async fn sites_settings_single_flight_is_scoped_to_site_and_field() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(snapshot())});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("first",environment()),share_rpc,transport.as_ref()).await})};while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}
        let duplicate=service.sites_settings_with(write("duplicate",environment()),share_rpc,&FakeTransport::new(&[])).await.err().unwrap();assert_eq!(duplicate.code,"busy");
        let other=response(json!({"title":"other","updated_at":"now"}));service.sites_settings_with(write("other-field",json!({"operation":"title","title":"other"})),share_rpc,&other).await.unwrap();task.await.unwrap().unwrap();assert_eq!(other.requests.lock().unwrap().len(),1);assert!(service.site_settings_active.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn sites_settings_identity_and_completion_checks_prevent_success_after_write() {
        struct Invalidate<'a>(&'a ChatgptService);
        impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"title":"new","updated_at":"now"}"#.to_vec()})})}}
        let service=ChatgptService::default();assert_eq!(service.sites_settings_with(write("identity",json!({"operation":"title","title":"new"})),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
        let service=ChatgptService::default();let calls=AtomicUsize::new(0);let rpc=|method,params|if method=="configRequirements/read"{let completed=calls.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed{json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})}else{json!({"requirements":null})}))}else{share_rpc(method,params)};
        let transport=response(snapshot());assert_eq!(service.sites_settings_with(write("completion-policy",environment()),rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);
    }
}

#[cfg(test)]
mod sites21g_regression {
    use super::*;
    fn write(id:&str,operation:&str,slug:&str)->SitesSettingsRequest {
        serde_json::from_value(json!({"requestId":id,"expectedIdentity":identity(),"profile":{
            "language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0",
            "userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"id":"site/a?b#c%","mutation":{"operation":operation,"slug":slug}})).expect("fixed Sites slug operation must deserialize")
    }
    fn response(body:Value)->FakeTransport {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();transport}
    fn ack(status:&str)->Value {json!({"slug_change":{"requested_slug":"new-slug","status":status}})}
    #[test]
    fn sites_slug_operations_are_explicit_typed_variants() {
        for operation in ["slug_availability","slug"] {let _=write("supported",operation,"valid-slug");}
    }
    #[tokio::test]
    async fn sites_slug_post_routes_bodies_and_response_contracts_are_distinct() {
        for (operation,suffix,body) in [("slug_availability","slug/availability",json!({"slug":"new-slug","available":true,"extra":"preserved"})),("slug","metadata",ack("pending")),("slug","metadata",ack("complete"))] {
            let service=ChatgptService::default();let transport=response(body.clone());let result=service.sites_settings_with(write("fixed",operation,"  NeW-SlUg  "),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);assert_eq!(result.identity,identity());
            let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].url,format!("https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/{suffix}"));assert_eq!(calls[0].method,HttpMethod::Post);assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),json!({"slug":"new-slug"}));assert_eq!(calls[0].headers["Content-Type"],"application/json");
        }
    }
    #[tokio::test]
    async fn sites_invalid_slugs_fail_before_auth_without_invented_length_limit() {
        for operation in ["slug_availability","slug"] {for slug in ["","  ","1abc","-abc","abc-","abc--def","a_b","a.b","中文","a\nsecond","a/b","\u{0085}abc"] {
            let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().sites_settings_with(write("invalid",operation,slug),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");assert!(transport.requests.lock().unwrap().is_empty());
        }}
        let transport=response(json!({"slug":"bom-slug","available":true}));ChatgptService::default().sites_settings_with(write("bom","slug_availability","\u{feff} BoM-Slug \u{feff}"),share_rpc,&transport).await.unwrap();
        let slug="a".repeat(101);let transport=response(json!({"slug":slug,"available":false}));ChatgptService::default().sites_settings_with(write("long","slug_availability",&slug),share_rpc,&transport).await.unwrap();
    }
    #[tokio::test]
    async fn sites_slug_availability_rejects_stale_or_malformed_ack_as_read_error() {
        for body in [json!({"slug":"other","available":true}),json!({"slug":"new-slug","available":"true"}),json!({"available":true}),json!({"slug":"new-slug","status":"available"})] {
            let transport=response(body);assert_eq!(ChatgptService::default().sites_settings_with(write("bad-check","slug_availability","new-slug"),share_rpc,&transport).await.err().unwrap().code,"invalid_response");assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
        let transport=response(json!({"slug":"new-slug","available":false}));assert_eq!(ChatgptService::default().sites_settings_with(write("unavailable","slug_availability","new-slug"),share_rpc,&transport).await.unwrap().body["available"],false);
    }
    #[tokio::test]
    async fn sites_slug_mutation_requires_matching_pending_or_complete_without_title_or_id() {
        for body in [json!({}),json!({"slug_change":null}),json!({"slug_change":{"requested_slug":"other","status":"complete"}}),json!({"slug_change":{"requested_slug":"new-slug","status":"done"}}),json!({"slug_change":{"requested_slug":"new-slug"}})] {
            let transport=response(body);assert_eq!(ChatgptService::default().sites_settings_with(write("bad-write","slug","new-slug"),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);
        }
        for operation in ["slug_availability","slug"] {let transport=FakeTransport::new(&[500,200]);let error=ChatgptService::default().sites_settings_with(write("server-error",operation,"new-slug"),share_rpc,&transport).await.err().unwrap();assert_eq!(error.code,if operation=="slug"{"sites_settings_unknown"}else{"service_error"});assert_eq!(transport.requests.lock().unwrap().len(),1);}
    }
    #[tokio::test]
    async fn sites_slug_cancel_and_identity_never_deliver_old_success() {
        for operation in ["slug_availability","slug"] {let service=Arc::new(ChatgptService::default());let body=if operation=="slug"{ack("pending")}else{json!({"slug":"new-slug","available":true})};let transport=Arc::new(FakeTransport{delay_ms:100,..response(body)});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("cancel",operation,"new-slug"),share_rpc,transport.as_ref()).await})};tokio::time::timeout(Duration::from_secs(5),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.expect("Sites slug request did not reach transport");service.cancel("cancel");assert_eq!(task.await.unwrap().err().unwrap().code,if operation=="slug"{"sites_settings_unknown"}else{"cancelled"});assert_eq!(transport.requests.lock().unwrap().len(),1);}
        struct Invalidate<'a>(&'a ChatgptService);impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&ack("complete")).unwrap()})})}}
        let service=ChatgptService::default();assert_eq!(service.sites_settings_with(write("old-account","slug","new-slug"),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
    #[tokio::test]
    async fn sites_slug_single_flight_separates_availability_from_mutation_and_rejects_duplicate() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(ack("pending"))});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("pending","slug","new-slug"),share_rpc,transport.as_ref()).await})};tokio::time::timeout(Duration::from_secs(5),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.expect("Sites slug request did not reach transport");
        assert_eq!(service.sites_settings_with(write("duplicate","slug","other"),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"busy");
        let check=response(json!({"slug":"new-slug","available":true}));service.sites_settings_with(write("independent-check","slug_availability","new-slug"),share_rpc,&check).await.unwrap();task.await.unwrap().unwrap();assert_eq!(check.requests.lock().unwrap().len(),1);assert!(service.site_settings_active.lock().unwrap().is_empty());
    }
}

#[cfg(test)]
mod sites21h_regression {
    use super::*;
    fn write(id:&str,mutation:Value)->SitesSettingsRequest {
        serde_json::from_value(json!({"requestId":id,"expectedIdentity":identity(),"profile":{
            "language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0",
            "userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"id":"site/a?b#c%","mutation":mutation})).expect("fixed Sites domain operation must deserialize")
    }
    fn mutation(operation:&str)->Value {if operation=="domain_add"{json!({"operation":operation,"hostname":"\u{feff}  MiXeD.Example.test  \u{feff}"})}else{json!({"operation":operation,"domain_id":"domain/a?b#c%"})}}
    fn domain()->Value {json!({"apex_proxy_ipv4_targets":["192.0.2.1"],"cname_target":"target.example.test","created_at":"created","hostname":"MiXeD.Example.test","id":"domain/a?b#c%","last_error":null,"project_id":"site/a?b#c%","provider_status":null,"ssl_status":null,"status":"pending","updated_at":"updated","validation_records":[{}, {"name":null,"record_type":"TXT","value":"proof"}],"worker_name":"worker","extra":"preserved"})}
    fn response(body:Value)->FakeTransport {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();transport}
    async fn entered(transport:&FakeTransport){tokio::time::timeout(Duration::from_secs(5),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.expect("Sites domain request did not reach transport");}
    #[test]
    fn sites_domain_operations_are_explicit_typed_variants() {for operation in ["domain_add","domain_refresh","domain_remove"] {let _=write("typed",mutation(operation));}}
    #[tokio::test]
    async fn sites_domain_fixed_methods_paths_empty_bodies_and_complete_ack() {
        for (operation,method,suffix) in [("domain_add",HttpMethod::Post,"custom_domains"),("domain_refresh",HttpMethod::Post,"custom_domains/domain%2Fa%3Fb%23c%25/refresh"),("domain_remove",HttpMethod::Delete,"custom_domains/domain%2Fa%3Fb%23c%25")] {
            let service=ChatgptService::default();let transport=response(domain());let result=service.sites_settings_with(write("fixed",mutation(operation)),share_rpc,&transport).await.unwrap();assert_eq!(result.body,domain());assert_eq!(result.identity,identity());let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].method,method);assert_eq!(calls[0].url,format!("https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/{suffix}"));assert!(calls[0].headers.contains_key("Authorization"));
            if operation=="domain_add" {assert_eq!(calls[0].headers["Content-Type"],"application/json");assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),json!({"hostname":"MiXeD.Example.test"}));}else{assert!(calls[0].body.is_empty());assert!(!calls[0].headers.contains_key("Content-Type"));}
        }
    }
    #[tokio::test]
    async fn sites_domain_invalid_input_is_rejected_before_auth_without_hostname_regex() {
        for value in [json!({"operation":"domain_add","hostname":" \u{feff} "}),json!({"operation":"domain_refresh","domain_id":".."}),json!({"operation":"domain_remove","domain_id":""})] {let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().sites_settings_with(write("invalid",value),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");assert!(transport.requests.lock().unwrap().is_empty());}
        let transport=response(domain());ChatgptService::default().sites_settings_with(write("server-validates",json!({"operation":"domain_add","hostname":"  https://MiXeD.Example/path  "})),share_rpc,&transport).await.unwrap();assert_eq!(serde_json::from_slice::<Value>(&transport.requests.lock().unwrap()[0].body).unwrap(),json!({"hostname":"https://MiXeD.Example/path"}));
    }
    #[tokio::test]
    async fn sites_domain_response_requires_complete_schema_and_bound_project_and_domain() {
        for operation in ["domain_add","domain_refresh","domain_remove"] {
            let mut wrong_project=domain();wrong_project["project_id"]=json!("other");let mut invalid_status=domain();invalid_status["status"]=json!("verified");
            for body in [json!({"success":true}),Value::Null,wrong_project,invalid_status] {let transport=response(body);assert_eq!(ChatgptService::default().sites_settings_with(write("bad-ack",mutation(operation)),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);}
            let transport=FakeTransport::new(&[204]);transport.responses.lock().unwrap()[0].body.clear();assert_eq!(ChatgptService::default().sites_settings_with(write("no-content",mutation(operation)),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");
        }
        for operation in ["domain_refresh","domain_remove"] {let mut wrong=domain();wrong["id"]=json!("other-domain");let transport=response(wrong);assert_eq!(ChatgptService::default().sites_settings_with(write("wrong-domain",mutation(operation)),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");}
        for key in ["apex_proxy_ipv4_targets","cname_target","created_at","hostname","id","last_error","project_id","provider_status","ssl_status","status","updated_at","validation_records","worker_name"] {let mut incomplete=domain();incomplete.as_object_mut().unwrap().remove(key);let transport=response(incomplete);assert_eq!(ChatgptService::default().sites_settings_with(write("incomplete",mutation("domain_add")),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");}
    }
    #[tokio::test]
    async fn sites_domain_publish_error_is_exact_and_other_failures_never_replay() {
        for (kind,message,expected) in [("invalid_project","Publish the Site before adding a custom domain","site_domain_publish_required"),("invalid_project","Publish the Site before adding a custom domain!","service_error"),("other","Publish the Site before adding a custom domain","service_error")] {let transport=FakeTransport::new(&[400,200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&json!({"detail":{"type":kind,"message":message,"private":"fixture-sensitive"}})).unwrap();let error=ChatgptService::default().sites_settings_with(write("failure",mutation("domain_add")),share_rpc,&transport).await.err().unwrap();assert_eq!(error.code,expected);assert_eq!(error.status,Some(400));assert!(!error.message.contains("fixture-sensitive"));assert_eq!(transport.requests.lock().unwrap().len(),1);}
        for operation in ["domain_add","domain_refresh","domain_remove"] {for status in [401,403,409,429,500] {let transport=FakeTransport::new(&[status,200]);let error=ChatgptService::default().sites_settings_with(write("http",mutation(operation)),share_rpc,&transport).await.err().unwrap();if status==500{assert_eq!(error.code,"sites_settings_unknown");}else{assert_eq!(error.status,Some(status));}assert_eq!(transport.requests.lock().unwrap().len(),1);}}
    }
    #[tokio::test]
    async fn sites_domain_actions_share_site_lock_but_not_title_field() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(domain())});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("pending",mutation("domain_add")),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;
        for operation in ["domain_add","domain_refresh","domain_remove"] {assert_eq!(service.sites_settings_with(write("duplicate",mutation(operation)),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"busy");}
        let title=response(json!({"title":"independent","updated_at":"now"}));service.sites_settings_with(write("title",json!({"operation":"title","title":"independent"})),share_rpc,&title).await.unwrap();task.await.unwrap().unwrap();assert_eq!(title.requests.lock().unwrap().len(),1);assert!(service.site_settings_active.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn sites_domain_cancel_identity_and_policy_do_not_deliver_old_success() {
        for operation in ["domain_add","domain_refresh","domain_remove"] {let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(domain())});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("cancel",mutation(operation)),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;service.cancel("cancel");assert_eq!(task.await.unwrap().err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);}
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().sites_settings_with(write("denied",mutation("domain_add")),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
        struct Invalidate<'a>(&'a ChatgptService);impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:serde_json::to_vec(&domain()).unwrap()})})}}
        let service=ChatgptService::default();assert_eq!(service.sites_settings_with(write("old-account",mutation("domain_remove")),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
}

#[cfg(test)]
mod sites21i_regression {
    use super::*;
    fn write(id:&str,mode:&str)->SitesSettingsRequest {serde_json::from_value(json!({"requestId":id,"expectedIdentity":identity(),"profile":{
        "language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"id":"site/a?b#c%","mutation":{"operation":"share_access","access_mode":mode}})).expect("fixed Sites sharing mutation must deserialize")}
    fn preferred(id:&str)->ServiceRequest {let mut req=request(id);req.operation=serde_json::from_value(json!("sites_preferred_live_url")).expect("fixed Sites preferred live URL operation");req.params=json!({"id":"site/a?b#c%"});req}
    fn response(body:Value)->FakeTransport {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();transport}
    async fn entered(transport:&FakeTransport){tokio::time::timeout(Duration::from_secs(5),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.expect("Sites sharing request did not reach transport");}
    #[test]
    fn sites_sharing_operations_are_explicit_typed_entries() {let _=write("typed","custom");let _=preferred("typed-read");}
    #[tokio::test]
    async fn sites_share_access_uses_fixed_patch_exact_mode_and_null_or_pending_accepted_ack() {
        for mode in ["custom","workspace_all","public"] {for body in [Value::Null,json!({"status":"pending","extra":"preserved"}),json!({"status":"accepted"})] {
            let service=ChatgptService::default();let transport=response(body.clone());let result=service.sites_settings_with(write("share",mode),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);assert_eq!(result.identity,identity());let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/share_access");assert_eq!(calls[0].method,HttpMethod::Patch);assert_eq!(calls[0].headers["Content-Type"],"application/json");assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),json!({"access_mode":mode}));assert!(calls[0].headers.contains_key("Authorization"));
        }}
    }
    #[tokio::test]
    async fn sites_share_access_rejects_admins_only_and_unknown_modes_before_auth() {
        for mode in ["admins_only",""," Public ","workspace","owner_only"] {let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().sites_settings_with(write("invalid",mode),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");assert!(transport.requests.lock().unwrap().is_empty());}
    }
    #[tokio::test]
    async fn sites_share_access_empty_or_invalid_success_is_unknown_and_never_retried() {
        for body in [json!({}),json!({"success":true}),json!({"status":"complete"}),json!({"status":null}),json!(false)] {let transport=response(body);assert_eq!(ChatgptService::default().sites_settings_with(write("invalid-ack","public"),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);}
        let transport=FakeTransport::new(&[204]);transport.responses.lock().unwrap()[0].body.clear();assert_eq!(ChatgptService::default().sites_settings_with(write("no-content","public"),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");
        for status in [401,403,409,429,500] {let transport=FakeTransport::new(&[status,200]);let error=ChatgptService::default().sites_settings_with(write("rejected","public"),share_rpc,&transport).await.err().unwrap();if status==500{assert_eq!(error.code,"sites_settings_unknown");}else{assert_eq!(error.status,Some(status));}assert_eq!(transport.requests.lock().unwrap().len(),1);}
    }
    #[tokio::test]
    async fn sites_preferred_live_url_is_fixed_get_preserves_real_body_and_rejects_extra_parameters() {
        for body in [json!({"live_url":null}),json!({"live_url":"https://real.example.test/site","extra":"preserved"})] {let transport=response(body.clone());let result=ChatgptService::default().read_with(preferred("preferred"),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);let calls=transport.requests.lock().unwrap();assert_eq!(calls[0].method,HttpMethod::Get);assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/preferred_live_url");assert!(calls[0].body.is_empty());}
        for params in [json!({"id":".."}),json!({"id":"site","url":"https://other.invalid"}),json!({"id":"site","method":"PATCH"}),json!({"id":"site","account_id":"other"})] {let mut req=preferred("bad-params");req.params=params;assert_eq!(ChatgptService::default().read_with(req,|_,_|std::future::ready(Err("must not auth".into())),&FakeTransport::new(&[])).await.err().unwrap().code,"invalid_request");}
    }
    #[tokio::test]
    async fn sites_preferred_live_url_policy_before_and_after_transport_and_cancel_are_enforced() {
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().read_with(preferred("denied"),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
        let calls=AtomicUsize::new(0);let rpc=|method,params|if method=="configRequirements/read"{let completed=calls.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed{json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})}else{json!({"requirements":null})}))}else{share_rpc(method,params)};let transport=response(json!({"live_url":null}));assert_eq!(ChatgptService::default().read_with(preferred("completion-policy"),rpc,&transport).await.err().unwrap().code,"network_restricted");assert_eq!(transport.requests.lock().unwrap().len(),1);
        let service=ChatgptService::default();service.cancel("pre-cancel");let transport=FakeTransport::new(&[]);assert_eq!(service.read_with(preferred("pre-cancel"),share_rpc,&transport).await.err().unwrap().code,"cancelled");assert!(transport.requests.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn sites_share_access_is_single_flight_but_title_remains_independent() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(json!({"status":"accepted"}))});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("pending","public"),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;
        assert_eq!(service.sites_settings_with(write("duplicate","custom"),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"busy");
        let mut title=write("title","custom");title.mutation=serde_json::from_value(json!({"operation":"title","title":"independent"})).unwrap();let title_transport=response(json!({"title":"independent","updated_at":"now"}));service.sites_settings_with(title,share_rpc,&title_transport).await.unwrap();task.await.unwrap().unwrap();assert_eq!(title_transport.requests.lock().unwrap().len(),1);assert!(service.site_settings_active.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn sites_share_access_cancel_and_old_account_cannot_deliver_success() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(json!({"status":"accepted"}))});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("cancel","public"),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;service.cancel("cancel");assert_eq!(task.await.unwrap().err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);
        struct Invalidate<'a>(&'a ChatgptService);impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"status":"accepted"}"#.to_vec()})})}}
        let service=ChatgptService::default();assert_eq!(service.sites_settings_with(write("old-account","public"),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
        let service=ChatgptService::default();assert_eq!(service.read_with(preferred("old-preferred"),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
}

#[cfg(test)]
mod sites21j_regression {
    use super::*;
    fn wire(id:&str,mutation:Value)->Value {json!({"requestId":id,"expectedIdentity":identity(),"profile":{
        "language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"id":"site/a?b#c%","mutation":mutation})}
    fn write(id:&str,mutation:Value)->SitesSettingsRequest {serde_json::from_value(wire(id,mutation)).expect("fixed existing Sites participant mutation must deserialize")}
    fn member(kind:&str,role:Value)->Value {json!({"operation":"share_recipient","recipient":"member/raw?id#%","recipient_type":kind,"role":role})}
    fn email()->Value {json!({"operation":"share_email_remove","email":"  MiXeD+tag@Example.test  "})}
    fn settings(id:&str)->ServiceRequest {let mut req=request(id);req.operation=serde_json::from_value(json!("sites_workspace_settings")).expect("fixed Sites workspace settings operation");req.params=json!({});req}
    fn response(body:Value)->FakeTransport {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();transport}
    async fn entered(transport:&FakeTransport){tokio::time::timeout(Duration::from_secs(5),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.expect("Sites participant request did not reach transport");}
    #[test]
    fn sites_existing_participant_and_workspace_settings_operations_are_typed() {let _=write("typed-member",member("user",json!("viewer")));let _=write("typed-email",email());let _=settings("typed-settings");}
    #[tokio::test]
    async fn sites_existing_participant_actions_use_exact_patch_body_and_preserve_original_email() {
        for (mutation,expected) in [(member("user",json!("viewer")),json!({"recipient":"member/raw?id#%","recipient_type":"user","role":"viewer"})),(member("user",json!("editor")),json!({"recipient":"member/raw?id#%","recipient_type":"user","role":"editor"})),(member("user",Value::Null),json!({"recipient":"member/raw?id#%","recipient_type":"user","role":null})),(member("group",Value::Null),json!({"recipient":"member/raw?id#%","recipient_type":"group","role":null})),(email(),json!({"email":"  MiXeD+tag@Example.test  ","role":null}))] {
            let service=ChatgptService::default();let transport=response(json!({"status":"pending","role_id":"role-site-editor","extra":"preserved"}));let result=service.sites_settings_with(write("exact",mutation),share_rpc,&transport).await.unwrap();assert_eq!(result.body["role_id"],"role-site-editor");let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].method,HttpMethod::Patch);assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/share_access");assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),expected);assert_eq!(calls[0].headers["Content-Type"],"application/json");
        }
    }
    #[tokio::test]
    async fn sites_participant_role_shape_and_invalid_targets_fail_before_auth_without_invitation_variant() {
        for mutation in [json!({"operation":"share_recipient","recipient":"member","recipient_type":"user","role":"owner"}),json!({"operation":"share_recipient","recipient":"member","recipient_type":"team","role":null}),json!({"operation":"share_recipient","recipient":"member","recipient_type":"user"}),json!({"operation":"share_email_remove","email":"real@example.test","role":"viewer"})] {assert!(serde_json::from_value::<SitesSettingsRequest>(wire("invalid-shape",mutation)).is_err());}
        for mutation in [member("group",json!("editor")),json!({"operation":"share_recipient","recipient":"","recipient_type":"user","role":null}),json!({"operation":"share_email_remove","email":" \t "})] {let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().sites_settings_with(write("invalid",mutation),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");assert!(transport.requests.lock().unwrap().is_empty());}
    }
    #[tokio::test]
    async fn sites_participant_ack_keeps_json_null_pending_accepted_and_rejects_empty_or_other_status() {
        for mutation in [member("user",Value::Null),email()] {
            for body in [Value::Null,json!({"status":"pending"}),json!({"status":"accepted","role_id":null})] {let transport=response(body.clone());assert_eq!(ChatgptService::default().sites_settings_with(write("ack",mutation.clone()),share_rpc,&transport).await.unwrap().body,body);}
            for body in [json!({"status":"complete"}),json!({"success":true}),json!(false)] {let transport=response(body);assert_eq!(ChatgptService::default().sites_settings_with(write("unknown",mutation.clone()),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);}
            let transport=FakeTransport::new(&[204]);transport.responses.lock().unwrap()[0].body.clear();assert_eq!(ChatgptService::default().sites_settings_with(write("empty",mutation),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");
        }
    }
    #[tokio::test]
    async fn sites_participant_http_rejections_and_unknown_never_replay_mutations() {
        for mutation in [member("user",json!("editor")),email()] {for status in [401,403,409,429,500] {let transport=FakeTransport::new(&[status,200]);let error=ChatgptService::default().sites_settings_with(write("http",mutation.clone()),share_rpc,&transport).await.err().unwrap();if status==500{assert_eq!(error.code,"sites_settings_unknown");}else{assert_eq!(error.status,Some(status));}assert_eq!(transport.requests.lock().unwrap().len(),1);}}
    }
    #[tokio::test]
    async fn sites_participant_actions_and_access_mode_share_the_same_site_lock() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(json!({"status":"accepted"}))});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("pending",member("user",Value::Null)),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;
        for mutation in [member("user",json!("viewer")),email(),json!({"operation":"share_access","access_mode":"public"})] {assert_eq!(service.sites_settings_with(write("duplicate",mutation),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"busy");}
        task.await.unwrap().unwrap();assert!(service.site_settings_active.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn sites_participant_cancelled_or_old_account_writes_never_deliver_success() {
        for mutation in [member("user",json!("editor")),email()] {let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(json!({"status":"accepted"}))});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(write("cancel",mutation),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;service.cancel("cancel");assert_eq!(task.await.unwrap().err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);}
        struct Invalidate<'a>(&'a ChatgptService);impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"status":"accepted"}"#.to_vec()})})}}
        let service=ChatgptService::default();assert_eq!(service.sites_settings_with(write("old-account",email()),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
    #[tokio::test]
    async fn sites_workspace_settings_route_is_identity_bound_and_rejects_all_parameters() {
        let transport=response(json!({"permissions":["chatgpt.workspace.feature.sites.invite_external.access"]}));let result=ChatgptService::default().read_with(settings("settings"),share_rpc,&transport).await.unwrap();assert_eq!(result.identity,identity());let calls=transport.requests.lock().unwrap();assert_eq!(calls[0].method,HttpMethod::Get);assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/accounts/account-fixture/settings");assert!(calls[0].body.is_empty());drop(calls);
        for params in [Value::Null,json!([]),json!({"account_id":"other"}),json!({"id":"other"}),json!({"url":"https://elsewhere.test"}),json!({"permissions":[]})] {let mut req=settings("invalid-settings");req.params=params;assert_eq!(ChatgptService::default().read_with(req,|_,_|std::future::ready(Err("must not auth".into())),&FakeTransport::new(&[])).await.err().unwrap().code,"invalid_request");}
    }
    #[tokio::test]
    async fn sites_workspace_settings_network_completion_cancel_and_identity_are_guarded() {
        let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().read_with(settings("denied"),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
        let calls=AtomicUsize::new(0);let rpc=|method,params|if method=="configRequirements/read"{let completed=calls.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed{json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})}else{json!({"requirements":null})}))}else{share_rpc(method,params)};let transport=response(json!({"permissions":[]}));assert_eq!(ChatgptService::default().read_with(settings("complete-policy"),rpc,&transport).await.err().unwrap().code,"network_restricted");assert_eq!(transport.requests.lock().unwrap().len(),1);
        let service=ChatgptService::default();service.cancel("cancel-settings");assert_eq!(service.read_with(settings("cancel-settings"),share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"cancelled");
        struct Invalidate<'a>(&'a ChatgptService);impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"permissions":[]}"#.to_vec()})})}}
        let service=ChatgptService::default();assert_eq!(service.read_with(settings("old-settings"),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
    }
}

#[cfg(test)]
mod sites21k_regression {
    use super::*;
    fn invite(id:&str,email:&str)->SitesSettingsRequest {serde_json::from_value(json!({"requestId":id,"expectedIdentity":identity(),"profile":{
        "language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"id":"site/a?b#c%","mutation":{"operation":"share_email_invite","email":email}})).expect("fixed Sites email invitation must deserialize")}
    fn directory(id:&str,operation:&str,params:Value)->ServiceRequest {let mut req=request(id);req.operation=serde_json::from_value(json!(operation)).expect("fixed Sites directory operation");req.params=params;req}
    fn response(body:Value)->FakeTransport {let transport=FakeTransport::new(&[200]);transport.responses.lock().unwrap()[0].body=serde_json::to_vec(&body).unwrap();transport}
    async fn entered(transport:&FakeTransport){tokio::time::timeout(Duration::from_secs(5),async{while !transport.entered.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.expect("Sites invitation request did not reach transport");}
    #[test]
    fn sites_invitation_and_directories_are_explicit_fixed_typed_entries() {let _=invite("typed","target@example.test");let _=directory("users","sites_users",json!({"query":"real"}));let _=directory("groups","sites_groups",json!({"query":"real"}));let _=directory("teams","sites_teams",json!({"offset":0}));}
    #[tokio::test]
    async fn sites_email_invite_uses_only_fixed_viewer_patch_and_original_ack() {
        for body in [Value::Null,json!({"status":"pending","role_id":"role-site-viewer"}),json!({"status":"accepted","extra":"preserved"})] {let transport=response(body.clone());let result=ChatgptService::default().sites_settings_with(invite("invite","target+tag@example.test"),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);let calls=transport.requests.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].method,HttpMethod::Patch);assert_eq!(calls[0].url,"https://chatgpt.com/backend-api/websites/site%2Fa%3Fb%23c%25/share_access");assert_eq!(serde_json::from_slice::<Value>(&calls[0].body).unwrap(),json!({"email":"target+tag@example.test","role":"viewer"}));}
    }
    #[tokio::test]
    async fn sites_email_invite_cannot_accept_a_caller_role_or_bypass_empty_input_checks() {
        for email in [""," \u{feff} ","private\nInjected: value"] {let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().sites_settings_with(invite("invalid",email),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");assert!(transport.requests.lock().unwrap().is_empty());}
        // Unknown fields are rejected by the variant; no caller may upgrade the invitation.
        let mut value=json!({"requestId":"bad-role","expectedIdentity":identity(),"profile":{},"id":"site","mutation":{"operation":"share_email_invite","email":"target@example.test","role":"editor"}});
        value["profile"]=json!({"language":"zh-CN","deviceId":"fixture-device","userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""});assert!(serde_json::from_value::<SitesSettingsRequest>(value).is_err());
    }
    #[tokio::test]
    async fn sites_users_use_identity_bound_fixed_query_without_changing_generic_share_users() {
        let body=json!({"items":[],"extra":"preserved"});let transport=response(body.clone());assert_eq!(ChatgptService::default().read_with(directory("sites-users","sites_users",json!({"query":" \u{feff}真实用户 \u{feff}"})),share_rpc,&transport).await.unwrap().body,body);
        let calls=transport.requests.lock().unwrap();let url=tauri::Url::parse(&calls[0].url).unwrap();assert_eq!(url.path(),"/backend-api/accounts/account-fixture/users");assert_eq!(calls[0].method,HttpMethod::Get);assert!(calls[0].body.is_empty());let query:BTreeMap<_,_>=url.query_pairs().into_owned().collect();assert_eq!(query,BTreeMap::from([("limit".into(),"10".into()),("offset".into(),"0".into()),("query".into(),"真实用户".into()),("include_profile_photos".into(),"false".into())]));
        let route=resolve_read_route(&ServiceOperation::ShareUsers,&json!({"query":"user"}),&identity()).unwrap();assert!(route.contains("include_profile_photos=false"));
    }
    #[tokio::test]
    async fn sites_groups_include_member_counts_without_changing_generic_share_groups() {
        let body=json!({"items":[],"extra":"preserved"});let transport=response(body.clone());let result=ChatgptService::default().read_with(directory("sites-groups","sites_groups",json!({"query":" \u{feff}真实组 &x=2\u{feff} "})),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);
        let calls=transport.requests.lock().unwrap();let url=tauri::Url::parse(&calls[0].url).unwrap();assert_eq!(url.path(),"/backend-api/accounts/account-fixture/groups");let query:BTreeMap<_,_>=url.query_pairs().into_owned().collect();assert_eq!(query,BTreeMap::from([("limit".into(),"10".into()),("offset".into(),"0".into()),("query".into(),"真实组 &x=2".into()),("include_member_counts".into(),"true".into()),("include_total".into(),"false".into())]));drop(calls);
        let route=resolve_read_route(&ServiceOperation::ShareGroups,&json!({"query":"group"}),&identity()).unwrap();assert!(route.contains("include_member_counts=false"));assert!(!route.contains("include_member_counts=true"));
    }
    #[tokio::test]
    async fn sites_teams_use_fixed_identity_limit_and_numeric_offsets_preserving_source_body() {
        for offset in [0,100,200] {let body=json!({"items":[],"has_more":offset<200,"extra":"preserved"});let transport=response(body.clone());let result=ChatgptService::default().read_with(directory("teams","sites_teams",json!({"offset":offset})),share_rpc,&transport).await.unwrap();assert_eq!(result.body,body);let calls=transport.requests.lock().unwrap();assert_eq!(calls[0].method,HttpMethod::Get);assert!(calls[0].body.is_empty());let url=tauri::Url::parse(&calls[0].url).unwrap();assert_eq!(url.path(),"/backend-api/accounts/account-fixture/teams");let query:BTreeMap<_,_>=url.query_pairs().into_owned().collect();assert_eq!(query,BTreeMap::from([("limit".into(),"100".into()),("offset".into(),offset.to_string())]));}
    }
    #[tokio::test]
    async fn sites_directory_bad_query_or_pagination_cannot_authenticate_or_override_identity() {
        for (operation,params) in [("sites_users",json!({"query":" "})),("sites_users",json!({"query":"x","include_profile_photos":true})),("sites_users",json!({"query":"x","account_id":"other"})),("sites_groups",json!({"query":" "})),("sites_groups",json!({"query":"x","include_member_counts":false})),("sites_groups",json!({"query":"x","account_id":"other"})),("sites_teams",json!({"offset":-1})),("sites_teams",json!({"offset":1.5})),("sites_teams",json!({"offset":"100"})),("sites_teams",json!({"offset":9007199254740992u64})),("sites_teams",json!({"offset":0,"limit":1000})),("sites_teams",json!({"offset":0,"url":"https://elsewhere.test"}))] {let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().read_with(directory("invalid-directory",operation,params),|_,_|std::future::ready(Err("must not auth".into())),&transport).await.err().unwrap().code,"invalid_request");assert!(transport.requests.lock().unwrap().is_empty());}
    }
    #[tokio::test]
    async fn sites_directories_enforce_network_before_after_and_identity_on_completion() {
        for (operation,params) in [("sites_users",json!({"query":"user"})),("sites_groups",json!({"query":"group"})),("sites_teams",json!({"offset":0}))] {let denied=|method,params|if method=="configRequirements/read"{std::future::ready(Ok(json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})))}else{share_rpc(method,params)};let transport=FakeTransport::new(&[]);assert_eq!(ChatgptService::default().read_with(directory("denied",operation,params.clone()),denied,&transport).await.err().unwrap().code,"network_restricted");assert!(transport.requests.lock().unwrap().is_empty());
            let checks=AtomicUsize::new(0);let rpc=|method,params|if method=="configRequirements/read"{let completed=checks.fetch_add(1,Ordering::SeqCst)>0;std::future::ready(Ok(if completed{json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}})}else{json!({"requirements":null})}))}else{share_rpc(method,params)};let transport=response(json!({"items":[],"has_more":false}));assert_eq!(ChatgptService::default().read_with(directory("complete-policy",operation,params.clone()),rpc,&transport).await.err().unwrap().code,"network_restricted");assert_eq!(transport.requests.lock().unwrap().len(),1);
            struct Invalidate<'a>(&'a ChatgptService);impl Transport for Invalidate<'_>{fn send(&self,_:HttpRequest,_:Arc<AtomicBool>)->TransportFuture<'_>{Box::pin(async move{self.0.invalidate();Ok(HttpResponse{status:200,headers:BTreeMap::new(),body:br#"{"items":[],"has_more":false}"#.to_vec()})})}}let service=ChatgptService::default();assert_eq!(service.read_with(directory("old-identity",operation,params),share_rpc,&Invalidate(&service)).await.err().unwrap().code,"account_changed");
        }
    }
    #[tokio::test]
    async fn sites_email_invitation_shares_all_site_access_write_locks_and_never_replays_unknown() {
        let service=Arc::new(ChatgptService::default());let transport=Arc::new(FakeTransport{delay_ms:100,..response(json!({"status":"accepted"}))});let task={let service=service.clone();let transport=transport.clone();tokio::spawn(async move{service.sites_settings_with(invite("pending","target@example.test"),share_rpc,transport.as_ref()).await})};entered(transport.as_ref()).await;
        let mut mode=invite("mode","target@example.test");mode.mutation=serde_json::from_value(json!({"operation":"share_access","access_mode":"custom"})).unwrap();assert_eq!(service.sites_settings_with(mode,share_rpc,&FakeTransport::new(&[])).await.err().unwrap().code,"busy");service.cancel("pending");assert_eq!(task.await.unwrap().err().unwrap().code,"sites_settings_unknown");assert_eq!(transport.requests.lock().unwrap().len(),1);
        for status in [401,403,429,500] {let transport=FakeTransport::new(&[status,200]);assert!(ChatgptService::default().sites_settings_with(invite("http","target@example.test"),share_rpc,&transport).await.is_err());assert_eq!(transport.requests.lock().unwrap().len(),1);}
        let transport=FakeTransport::new(&[204]);transport.responses.lock().unwrap()[0].body.clear();assert_eq!(ChatgptService::default().sites_settings_with(invite("no-content","target@example.test"),share_rpc,&transport).await.err().unwrap().code,"sites_settings_unknown");
    }
}

}
