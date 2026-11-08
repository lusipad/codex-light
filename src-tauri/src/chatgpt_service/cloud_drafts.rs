use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudDraftRequest {
    pub request_id: String,
    pub config_id: String,
    pub expected_identity: ServiceIdentity,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct CloudDraftReceipt {
    pub draft_id: String,
    pub environment_id: String,
    pub thread_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCreationResponse<R> {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub receipt: R,
}

pub type CloudDraftResponse = CloudCreationResponse<CloudDraftReceipt>;
pub type CloudConfigResponse = CloudCreationResponse<CloudConfigReceipt>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudConfigRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    name: String,
    repositories: Vec<ConfigRepository>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"), deny_unknown_fields)]
struct ConfigRepository {
    repository_id: String,
    #[serde(rename = "ref")]
    reference: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CloudConfigReceipt {
    #[serde(rename(deserialize = "id"))]
    config_id: String,
    name: String,
    version_id: String,
    environment_id: Option<String>,
    thread_id: Option<String>,
    #[serde(skip_deserializing)]
    draft_id: Option<String>,
    onboarding_skill: Option<String>,
}

type DraftKey = (String, String, Option<String>);

#[derive(Default)]
pub(super) struct CloudDraftRegistry {
    attempts: HashMap<DraftKey, Arc<AtomicBool>>,
}

impl CloudDraftRegistry {
    pub(super) fn invalidate(&mut self) {
        self.attempts.retain(|_, sent| sent.load(Ordering::SeqCst));
    }
}

struct Attempt<'a> {
    service: &'a ChatgptService,
    key: DraftKey,
    sent: Arc<AtomicBool>,
    definite: bool,
}

impl Drop for Attempt<'_> {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.service.cloud_drafts.lock() {
            if registry
                .attempts
                .get(&self.key)
                .is_some_and(|sent| Arc::ptr_eq(sent, &self.sent))
                && (self.definite || !self.sent.load(Ordering::SeqCst))
            {
                registry.attempts.remove(&self.key);
            }
        }
    }
}

struct Creation {
    config_id: Option<String>,
    payload: Vec<u8>,
}

impl Creation {
    fn unknown(&self) -> ServiceError {
        if self.config_id.is_some() {
            failure(
                "cloud_draft_unconfirmed",
                "Environment draft outcome is unknown; inspect cloud conversations before retrying",
            )
        } else {
            failure("cloud_config_unconfirmed", "Environment creation outcome is unknown; inspect the environment list before retrying")
        }
    }
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

impl CloudConfigRequest {
    fn payload(&self) -> ServiceResult<Vec<u8>> {
        let mut ids = std::collections::HashSet::new();
        if !valid_text(&self.name, 512)
            || self.name.encode_utf16().count() > 128
            || self.repositories.len() > 100
            || !self.repositories.iter().all(|repo| {
                valid_text(&repo.repository_id, 2048)
                    && valid_text(&repo.reference, 2048)
                    && ids.insert(&repo.repository_id)
            })
        {
            return Err(failure(
                "invalid_request",
                "Invalid cloud environment configuration",
            ));
        }
        let payload = serde_json::to_vec(&json!({
            "name": self.name,
            "repositories": self.repositories,
            "network_policy": {"type":"restricted","presets":["package_managers"],"egress_rules":[]},
            "share_settings": "private",
            "start_onboarding": false
        })).map_err(|_| failure("invalid_request", "Invalid cloud environment configuration"))?;
        if payload.len() > 256 * 1024 {
            return Err(failure(
                "invalid_request",
                "Cloud environment configuration exceeds transport limit",
            ));
        }
        Ok(payload)
    }
}

fn draft_receipt(value: Value) -> Option<(CloudDraftReceipt, bool)> {
    if !value
        .as_object()
        .is_some_and(|body| body.contains_key("thread_id"))
    {
        return None;
    }
    let result: CloudDraftReceipt = serde_json::from_value(value).ok()?;
    if result.draft_id.is_empty()
        || !result
            .draft_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_~-".contains(&byte))
        || result.environment_id.is_empty()
        || result.thread_id.as_ref().is_some_and(String::is_empty)
    {
        return None;
    }
    let definite = result.thread_id.is_some();
    Some((result, definite))
}

fn config_receipt(value: Value) -> Option<(CloudConfigReceipt, bool)> {
    if value["share_settings"] != "private"
        || !value["status"]
            .as_str()
            .is_some_and(|status| valid_text(status, 256))
        || !value["repositories"].is_array()
        || !matches!(
            value["network_policy"]["type"].as_str(),
            Some("restricted" | "disabled" | "unrestricted")
        )
    {
        return None;
    }
    let draft_id = if value["draft"].is_null() {
        None
    } else {
        Some(value["draft"]["id"].as_str()?.to_owned())
    };
    let mut result: CloudConfigReceipt = serde_json::from_value(value).ok()?;
    resolve_cloud_route(&CloudOperation::Detail, &json!({"id":result.config_id})).ok()?;
    if !valid_text(&result.name, 2048)
        || !valid_text(&result.version_id, 2048)
        || [
            &result.environment_id,
            &result.thread_id,
            &result.onboarding_skill,
        ]
        .into_iter()
        .flatten()
        .any(|value| !valid_text(value, 2048))
    {
        return None;
    }
    if let Some(id) = draft_id {
        resolve_cloud_route(
            &CloudOperation::Draft,
            &json!({"id":result.config_id,"draftId":id}),
        )
        .ok()?;
        result.draft_id = Some(id);
    }
    Some((result, true))
}

impl ChatgptService {
    pub async fn cloud_create_draft<F, Fut>(
        &self,
        request: CloudDraftRequest,
        profile: CloudProfile,
        call: F,
    ) -> ServiceResult<CloudDraftResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.cloud_create_draft_with(request, profile, call, &CurlTransport)
            .await
    }

    pub(super) async fn cloud_create_draft_with<F, Fut, T>(
        &self,
        request: CloudDraftRequest,
        profile: CloudProfile,
        call: F,
        transport: &T,
    ) -> ServiceResult<CloudDraftResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        let creation = Creation {
            config_id: Some(request.config_id),
            payload: Vec::new(),
        };
        self.cloud_create_with(
            request.request_id,
            request.expected_identity,
            creation,
            profile,
            call,
            transport,
            draft_receipt,
        )
        .await
    }

    pub async fn cloud_create_config<F, Fut>(
        &self,
        request: CloudConfigRequest,
        profile: CloudProfile,
        call: F,
    ) -> ServiceResult<CloudConfigResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.cloud_create_config_with(request, profile, call, &CurlTransport)
            .await
    }

    pub(super) async fn cloud_create_config_with<F, Fut, T>(
        &self,
        request: CloudConfigRequest,
        profile: CloudProfile,
        call: F,
        transport: &T,
    ) -> ServiceResult<CloudConfigResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        let creation = Creation {
            config_id: None,
            payload: request.payload()?,
        };
        self.cloud_create_with(
            request.request_id,
            request.expected_identity,
            creation,
            profile,
            call,
            transport,
            config_receipt,
        )
        .await
    }

    async fn cloud_create_with<F, Fut, T, R>(
        &self,
        request_id: String,
        expected_identity: ServiceIdentity,
        creation: Creation,
        profile: CloudProfile,
        call: F,
        transport: &T,
        project: impl FnOnce(Value) -> Option<(R, bool)>,
    ) -> ServiceResult<CloudCreationResponse<R>>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        let is_draft = creation.config_id.is_some();
        let route = match &creation.config_id {
            Some(config_id) => format!(
                "{}/drafts",
                resolve_cloud_route(&CloudOperation::Detail, &json!({"id":config_id}))?
            ),
            None => "/v1/environment-configs".into(),
        };
        validate_cloud_profile(&profile)?;
        let registration = self.register(&request_id)?;
        let generation = expected_identity.generation;
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        let key = (
            expected_identity.account_id.clone(),
            expected_identity.user_id.clone(),
            creation.config_id.clone(),
        );
        let sent = Arc::new(AtomicBool::new(false));
        {
            let mut registry = self
                .cloud_drafts
                .lock()
                .map_err(|_| failure("busy", "Environment draft registry unavailable"))?;
            if registry.attempts.contains_key(&key) {
                return Err(failure(
                    if is_draft {
                        "cloud_draft_pending"
                    } else {
                        "cloud_config_pending"
                    },
                    if is_draft {
                        "This environment has an active or unconfirmed draft creation"
                    } else {
                        "This account has an active or unconfirmed environment creation"
                    },
                ));
            }
            if registry.attempts.len() >= 256 {
                return Err(failure(
                    "busy",
                    "Too many unresolved environment draft operations",
                ));
            }
            registry.attempts.insert(key.clone(), sent.clone());
        }
        let mut attempt = Attempt {
            service: self,
            key,
            sent: sent.clone(),
            definite: false,
        };
        let unknown = || creation.unknown();
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(if sent.load(Ordering::SeqCst) { unknown() } else { failure("cancelled", "Service request cancelled") }),
            result = async {
                let credentials = self.cloud_credentials(generation, &call).await?;
                if credentials.identity != expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                let mut outgoing = build_cloud_http_request(&route, &credentials, &profile);
                outgoing.method = HttpMethod::Post;
                outgoing.body = creation.payload.clone();
                let destination = outgoing.url.clone();
                share_network_allowed(&call, &destination).await?;
                // The observed editing entry sends neither an options body nor start_thread.
                if registration.cancelled.load(Ordering::SeqCst) || self.generation() != generation {
                    return Err(failure("cancelled", "Service request cancelled"));
                }
                sent.store(true, Ordering::SeqCst);
                let response = if is_draft {
                    tokio::time::timeout(Duration::from_secs(600), transport.send_cloud_draft(outgoing, registration.cancelled.clone()))
                        .await.map_err(|_| unknown())?.map_err(|_| unknown())?
                } else {
                    send_bounded(transport, outgoing, registration.cancelled.clone(), Duration::from_secs(30))
                        .await.map_err(|_| unknown())?
                };
                let after = self.cloud_credentials(generation, &call).await?;
                if after.identity != expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                share_network_allowed(&call, &destination).await?;
                if registration.cancelled.load(Ordering::SeqCst) || self.generation() != generation { return Err(unknown()); }
                if response.status >= 500 || response.status == 408 { return Err(unknown()); }
                let success = (200..300).contains(&response.status);
                let decoded = decode_response(response, request_id.clone(), expected_identity.clone())
                    .map_err(|error| if success { unknown() } else { error })?;
                project(decoded.body).ok_or_else(unknown)
            } => result,
        };
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        let result = if sent.load(Ordering::SeqCst)
            && (registration.cancelled.load(Ordering::SeqCst)
                || result.as_ref().err().is_some_and(|error| {
                    matches!(
                        error.code,
                        "network_restricted"
                            | "network_policy_unavailable"
                            | "auth_unavailable"
                            | "auth_expired"
                            | "not_logged_in"
                    )
                })) {
            Err(unknown())
        } else {
            result
        };
        attempt.definite = result.as_ref().is_ok_and(|(_, definite)| *definite)
            || result.as_ref().err().is_some_and(|error| {
                error
                    .status
                    .is_some_and(|status| (300..500).contains(&status) && status != 408)
            });
        let (receipt, _) = result?;
        Ok(CloudCreationResponse {
            request_id,
            identity: expected_identity,
            receipt,
        })
    }
}
