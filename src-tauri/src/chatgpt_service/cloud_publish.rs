use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudPublishRequest {
    request_id: String,
    expected_identity: ServiceIdentity,
    config_id: String,
    draft_id: String,
    environment_id: String,
    operation: PublishOperation,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum PublishOperation {
    Begin {
        expected_revision: u64,
        idempotency_key: String,
    },
    Read {
        operation_id: String,
    },
    Complete {
        operation_id: String,
        thread_id: String,
    },
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_~-".contains(&byte))
}

fn unconfirmed() -> ServiceError {
    failure(
        "cloud_publish_unconfirmed",
        "Cloud publication could not be confirmed; reconcile the operation before retrying",
    )
}

fn operation_body(
    value: &Value,
    operation_id: Option<&str>,
    environment_id: &str,
) -> ServiceResult<Value> {
    let invalid = || failure("invalid_response", "Invalid cloud publication operation");
    let id = value["id"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or_else(invalid)?;
    let state = value["state"]
        .as_str()
        .filter(|state| matches!(*state, "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"))
        .ok_or_else(invalid)?;
    const KIND: &str = "APPROVE_ENVIRONMENT_CONFIG_DRAFT";
    if operation_id.is_some_and(|expected| id != expected)
        || value["environment_id"].as_str() != Some(environment_id)
        || value["kind"].as_str() != Some(KIND)
    {
        return Err(invalid());
    }
    let mut body = json!({"id":id,"kind":KIND,"environment_id":environment_id,"state":state});
    if let Some(code) = value
        .pointer("/failure/code")
        .and_then(Value::as_str)
        .filter(|code| valid_id(code))
    {
        body["failure"] = json!({"code":code});
    }
    Ok(body)
}

impl ChatgptService {
    pub(crate) async fn cloud_publish<F, Fut>(
        &self,
        request: CloudPublishRequest,
        profile: CloudProfile,
        call: F,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.cloud_publish_with(request, profile, call, &CurlTransport)
            .await
    }

    pub(super) async fn cloud_publish_with<F, Fut, T>(
        &self,
        request: CloudPublishRequest,
        profile: CloudProfile,
        call: F,
        transport: &T,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        let draft = resolve_cloud_route(
            &CloudOperation::Draft,
            &json!({"id":request.config_id,"draftId":request.draft_id}),
        )?;
        let invalid = || failure("invalid_request", "Invalid cloud publication request");
        if !valid_id(&request.environment_id) {
            return Err(invalid());
        }
        let (route, payload, operation_id) = match &request.operation {
            PublishOperation::Begin {
                expected_revision,
                idempotency_key,
            } => {
                if *expected_revision > 9_007_199_254_740_991
                    || !uuid::Uuid::parse_str(idempotency_key).is_ok_and(|id| {
                        id.get_version_num() == 4 && id.to_string() == *idempotency_key
                    })
                {
                    return Err(invalid());
                }
                (
                    format!("{draft}/approve/begin"),
                    Some(json!({
                        "expected_revision":expected_revision,"idempotency_key":idempotency_key,
                    })),
                    None,
                )
            }
            PublishOperation::Read { operation_id }
            | PublishOperation::Complete { operation_id, .. } => {
                if !valid_id(operation_id)
                    || matches!(&request.operation, PublishOperation::Complete { thread_id, .. } if !valid_id(thread_id))
                {
                    return Err(invalid());
                }
                (
                    format!("/v1/environment-operations/{operation_id}"),
                    None,
                    Some(operation_id.as_str()),
                )
            }
        };
        validate_cloud_profile(&profile)?;
        let registration = self.register(&request.request_id)?;
        let generation = request.expected_identity.generation;
        let sent = AtomicBool::new(false);
        let exchange = |route: String, payload: Option<Value>| {
            let (request, profile, call, registration, sent) =
                (&request, &profile, &call, &registration, &sent);
            async move {
                let write = payload.is_some();
                let credentials = self.cloud_credentials(generation, call).await?;
                if credentials.identity != request.expected_identity {
                    return Err(failure("account_changed", "Authenticated identity changed"));
                }
                let mut outgoing = build_cloud_http_request(&route, &credentials, profile);
                if let Some(body) = payload {
                    outgoing.method = HttpMethod::Post;
                    outgoing.body = serde_json::to_vec(&body).map_err(|_| invalid())?;
                }
                share_network_allowed(call, &outgoing.url).await?;
                self.check_share_current(&request.expected_identity, registration)?;
                if write {
                    sent.store(true, Ordering::SeqCst);
                }
                let response = send_bounded(
                    transport,
                    outgoing,
                    registration.cancelled.clone(),
                    Duration::from_secs(30),
                )
                .await;
                let after = self
                    .cloud_credentials(generation, call)
                    .await
                    .map_err(|error| {
                        if write && error.code != "account_changed" {
                            unconfirmed()
                        } else {
                            error
                        }
                    })?;
                if after.identity != request.expected_identity {
                    return Err(failure("account_changed", "Authenticated identity changed"));
                }
                let response =
                    response.map_err(|error| if write { unconfirmed() } else { error })?;
                if write && (response.status == 408 || response.status >= 500) {
                    return Err(unconfirmed());
                }
                let accepted = (200..300).contains(&response.status);
                decode_response(
                    response,
                    request.request_id.clone(),
                    request.expected_identity.clone(),
                )
                .map_err(|error| {
                    if write && accepted {
                        unconfirmed()
                    } else {
                        error
                    }
                })
            }
        };
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Service request cancelled")),
            result = async {
                let begin = payload.is_some();
                let mut response = exchange(route, payload).await?;
                response.body = operation_body(&response.body, operation_id, &request.environment_id)
                    .map_err(|error| if begin { unconfirmed() } else { error })?;
                if let PublishOperation::Complete { operation_id, thread_id } = &request.operation {
                    if response.body["state"] != "SUCCEEDED" {
                        return Err(failure("cloud_publish_not_ready", "Cloud publication operation has not succeeded"));
                    }
                    response = exchange(format!("{draft}/approve/complete"), Some(json!({
                        "operation_id":operation_id,"thread_id":thread_id,
                    }))).await?;
                    if response.body["id"].as_str() != Some(&request.config_id)
                        || response.body.pointer("/draft/id").and_then(Value::as_str) != Some(&request.draft_id)
                    {
                        return Err(unconfirmed());
                    }
                    let version_id = response.body["version_id"].as_str().filter(|id| valid_id(id))
                        .ok_or_else(unconfirmed)?;
                    response.body = json!({
                        "id":request.config_id,"draft":{"id":request.draft_id},"version_id":version_id,
                    });
                }
                Ok(response)
            } => result,
        };
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        if registration.cancelled.load(Ordering::SeqCst) {
            return Err(if sent.load(Ordering::SeqCst) {
                unconfirmed()
            } else {
                failure("cancelled", "Service request cancelled")
            });
        }
        result
    }
}
