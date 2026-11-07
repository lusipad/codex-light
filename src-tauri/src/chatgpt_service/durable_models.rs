use super::*;
use crate::durable::{ConnectionConfig, Error as DurableError, Notify, Request};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DurableModelsRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableModelsResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub host_id: &'static str,
    pub body: Value,
}

fn model_page(value: Value) -> ServiceResult<Value> {
    let data = value.get("data").and_then(Value::as_array).ok_or_else(|| failure("invalid_response", "Invalid cloud model catalog"))?;
    for model in data {
        if !model.get("id").and_then(Value::as_str).is_some_and(|id| !id.trim().is_empty())
            || model.get("model").is_some_and(|name| !name.as_str().is_some_and(|name| !name.trim().is_empty())) {
            return Err(failure("invalid_response", "Invalid cloud model entry"));
        }
    }
    if value.get("nextCursor").is_some_and(|cursor| !cursor.is_null() && !cursor.as_str().is_some_and(|cursor| !cursor.is_empty())) {
        return Err(failure("invalid_response", "Invalid cloud model cursor"));
    }
    Ok(value)
}

fn transport_error(error: DurableError) -> ServiceError {
    match error {
        DurableError::Unavailable => failure("cloud_host_unavailable", "Cloud app-server transport is unavailable"),
        DurableError::Busy => failure("busy", "Cloud app-server request queue is full"),
        DurableError::Cancelled => failure("cancelled", "Cloud app-server request cancelled"),
        DurableError::Closed => failure("cloud_host_closed", "Cloud app-server connection closed"),
        DurableError::Timeout => failure("timeout", "Cloud app-server request timed out"),
        DurableError::ResumeTimeout => failure("cloud_resume_timeout", "Cloud thread resume timed out"),
        DurableError::ThreadClosing => failure("cloud_thread_closing", "Cloud thread is closing"),
        DurableError::Protocol => failure("invalid_response", "Cloud app-server returned an invalid message"),
        DurableError::Remote(-32001) => failure("cloud_overloaded", "Cloud app-server is busy"),
        DurableError::Remote(_) => failure("cloud_rpc_error", "Cloud app-server rejected the request"),
    }
}

impl ChatgptService {
    pub(crate) async fn durable_models<F, Fut>(&self, request: DurableModelsRequest, profile: CloudProfile, call: F, notify: Notify) -> ServiceResult<DurableModelsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
        self.durable_models_with(request, profile, call, notify, |config, cursor, cancel, notify| self.durable.request(config, Request::models(cursor), cancel, notify)).await
    }

    pub(super) async fn durable_models_with<F, Fut, Read, ReadFuture>(&self, request: DurableModelsRequest, profile: CloudProfile, call: F, notify: Notify, read: Read) -> ServiceResult<DurableModelsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>,
        Read: FnOnce(ConnectionConfig, Option<String>, Arc<AtomicBool>, Notify) -> ReadFuture,
        ReadFuture: Future<Output = Result<Value, DurableError>> {
        if request.cursor.as_ref().is_some_and(|cursor| cursor.is_empty() || cursor.len() > 2048 || cursor.chars().any(char::is_control)) {
            return Err(failure("invalid_request", "Invalid cloud model cursor"));
        }
        let mut response = self.durable_call_with(request.request_id, request.expected_identity, profile, call,
            |config, cancel| read(config, request.cursor, cancel, notify)).await?;
        response.body = model_page(response.body)?;
        Ok(response)
    }

    pub(super) async fn durable_call_with<F, Fut, Run, RunFuture>(&self, request_id: String, expected_identity: ServiceIdentity, profile: CloudProfile, call: F, run: Run) -> ServiceResult<DurableModelsResponse>
    where F: Fn(&'static str, Value) -> Fut, Fut: Future<Output = Result<Value, String>>,
        Run: FnOnce(ConnectionConfig, Arc<AtomicBool>) -> RunFuture,
        RunFuture: Future<Output = Result<Value, DurableError>> {
        validate_cloud_profile(&profile)?;
        let registration = self.register(&request_id)?;
        let generation = expected_identity.generation;
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Cloud app-server request cancelled")),
            result = async {
                let credentials = self.cloud_credentials(generation, &call).await?;
                if credentials.identity != expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                let destination = "https://codex-cloud-backend.chatgpt.com/";
                share_network_allowed(&call, destination).await?;
                if self.generation() != generation || registration.cancelled.load(Ordering::SeqCst) { return Err(failure("cancelled", "Cloud app-server request cancelled")); }
                let result = run(ConnectionConfig { identity: expected_identity.clone(), token: credentials.token, user_agent: profile.user_agent }, registration.cancelled.clone()).await;
                let after = self.cloud_credentials(generation, &call).await?;
                if after.identity != expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                share_network_allowed(&call, destination).await?;
                let body = result.map_err(transport_error)?;
                Ok(DurableModelsResponse { request_id, identity: expected_identity.clone(), host_id: "durable", body })
            } => result,
        };
        if self.generation() != generation { self.durable.invalidate_identity(&expected_identity); return Err(failure("account_changed", "Authenticated identity changed")); }
        if result.as_ref().err().is_some_and(|error| matches!(error.code, "account_changed" | "not_logged_in" | "auth_expired" | "network_restricted" | "network_policy_unavailable")) { self.durable.invalidate_identity(&expected_identity); }
        if registration.cancelled.load(Ordering::SeqCst) { return Err(failure("cancelled", "Cloud app-server request cancelled")); }
        result
    }
}
