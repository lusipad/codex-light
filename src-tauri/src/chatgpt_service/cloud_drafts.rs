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
pub struct CloudDraftResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub receipt: CloudDraftReceipt,
}

type DraftKey = (String, String, String);

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

fn unknown() -> ServiceError {
    failure(
        "cloud_draft_unconfirmed",
        "Environment draft outcome is unknown; inspect cloud conversations before retrying",
    )
}

fn receipt(value: Value) -> ServiceResult<CloudDraftReceipt> {
    if !value
        .as_object()
        .is_some_and(|body| body.contains_key("thread_id"))
    {
        return Err(unknown());
    }
    let result: CloudDraftReceipt = serde_json::from_value(value).map_err(|_| unknown())?;
    if result.draft_id.is_empty()
        || !result
            .draft_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_~-".contains(&byte))
        || result.environment_id.is_empty()
        || result.thread_id.as_ref().is_some_and(String::is_empty)
    {
        return Err(unknown());
    }
    Ok(result)
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
        let route = resolve_cloud_route(&CloudOperation::Detail, &json!({"id":request.config_id}))?;
        validate_cloud_profile(&profile)?;
        let registration = self.register(&request.request_id)?;
        let generation = request.expected_identity.generation;
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        let key = (
            request.expected_identity.account_id.clone(),
            request.expected_identity.user_id.clone(),
            request.config_id.clone(),
        );
        let sent = Arc::new(AtomicBool::new(false));
        {
            let mut registry = self
                .cloud_drafts
                .lock()
                .map_err(|_| failure("busy", "Environment draft registry unavailable"))?;
            if registry.attempts.contains_key(&key) {
                return Err(failure(
                    "cloud_draft_pending",
                    "This environment has an active or unconfirmed draft creation",
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
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(if sent.load(Ordering::SeqCst) { unknown() } else { failure("cancelled", "Service request cancelled") }),
            result = async {
                let credentials = self.cloud_credentials(generation, &call).await?;
                if credentials.identity != request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                let mut outgoing = build_cloud_http_request(&format!("{route}/drafts"), &credentials, &profile);
                outgoing.method = HttpMethod::Post;
                let destination = outgoing.url.clone();
                share_network_allowed(&call, &destination).await?;
                // The observed editing entry sends neither an options body nor start_thread.
                if registration.cancelled.load(Ordering::SeqCst) || self.generation() != generation {
                    return Err(failure("cancelled", "Service request cancelled"));
                }
                sent.store(true, Ordering::SeqCst);
                let response = tokio::time::timeout(Duration::from_secs(600), transport.send_cloud_draft(outgoing, registration.cancelled.clone()))
                    .await.map_err(|_| unknown())?.map_err(|_| unknown())?;
                let after = self.cloud_credentials(generation, &call).await?;
                if after.identity != request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                share_network_allowed(&call, &destination).await?;
                if registration.cancelled.load(Ordering::SeqCst) || self.generation() != generation { return Err(unknown()); }
                if response.status >= 500 || response.status == 408 { return Err(unknown()); }
                let success = (200..300).contains(&response.status);
                let decoded = decode_response(response, request.request_id.clone(), request.expected_identity.clone())
                    .map_err(|error| if success { unknown() } else { error })?;
                let receipt = receipt(decoded.body)?;
                Ok(CloudDraftResponse { request_id: request.request_id.clone(), identity: request.expected_identity.clone(), receipt })
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
        attempt.definite = result
            .as_ref()
            .is_ok_and(|response| response.receipt.thread_id.is_some())
            || result.as_ref().err().is_some_and(|error| {
                error
                    .status
                    .is_some_and(|status| (300..500).contains(&status) && status != 408)
            });
        result
    }
}
