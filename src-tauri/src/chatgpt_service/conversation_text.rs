//! Fixed ordinary text-only ChatGPT requests. No arbitrary URL, tools, uploads,
//! challenge solver or completion replay is exposed here.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationTextRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub requirements_key: String,
    pub body: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationStopRequest {
    pub request_id: String,
    pub expected_identity: ServiceIdentity,
    pub profile: ServiceProfile,
    pub conversation_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTextFrame {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub sequence: u64,
    pub event: String,
    pub data: String,
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTextResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub status: &'static str,
    pub event_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ServiceError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationStopResponse {
    pub request_id: String,
    pub identity: ServiceIdentity,
    pub status: &'static str,
}

fn opaque(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control))
}

fn only(value: &Value, fields: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| fields.contains(&key.as_str())))
}

fn invalid_body() -> ServiceError {
    failure(
        "invalid_request",
        "Only ordinary text-only Chat requests are supported",
    )
}

fn validate_text_body(body: &Value) -> ServiceResult<()> {
    if !only(
        body,
        &[
            "action",
            "model",
            "parent_message_id",
            "conversation_id",
            "timezone",
            "timezone_offset_min",
            "history_and_training_disabled",
            "is_do_not_remember",
            "consumer_lockdown_mode_disabled",
            "requested_default_model",
            "one_off_model_override",
            "service_tier",
            "system_hints",
            "thinking_effort",
            "conversation_origin",
            "gizmo_id",
            "conversation_mode",
            "messages",
            "supported_encodings",
        ],
    ) || body["action"] != "next"
        || !opaque(&body["model"])
        || !opaque(&body["timezone"])
        || !body["timezone_offset_min"]
            .as_i64()
            .is_some_and(|offset| (-1440..=1440).contains(&offset))
        || body["supported_encodings"] != json!(["v1"])
        || !opaque(&body["parent_message_id"])
    {
        return Err(invalid_body());
    }
    match body.get("conversation_id") {
        Some(id)
            if !opaque(id)
                || id
                    .as_str()
                    .is_some_and(|id| id.starts_with("local-chatgpt:"))
                || body["parent_message_id"] == "client-created-root" =>
        {
            return Err(invalid_body())
        }
        None if body["parent_message_id"] != "client-created-root" => return Err(invalid_body()),
        _ => {}
    }
    for key in [
        "model",
        "requested_default_model",
        "service_tier",
        "thinking_effort",
        "conversation_origin",
        "gizmo_id",
    ] {
        if body.get(key).is_some_and(|value| !opaque(value)) {
            return Err(invalid_body());
        }
    }
    for key in ["is_do_not_remember", "consumer_lockdown_mode_disabled"] {
        if body.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(invalid_body());
        }
    }
    if body
        .get("history_and_training_disabled")
        .is_some_and(|value| value != &Value::Bool(true))
        || body
            .get("one_off_model_override")
            .is_some_and(|value| value != &Value::Bool(true))
        || body.get("requested_default_model").is_some()
            != (body.get("one_off_model_override") == Some(&Value::Bool(true)))
        || body
            .get("requested_default_model")
            .is_some_and(|value| value == &body["model"])
        || body.get("system_hints").is_some_and(|value| {
            !value
                .as_array()
                .is_some_and(|values| values.iter().all(Value::is_string))
        })
    {
        return Err(invalid_body());
    }
    match (body.get("gizmo_id"), body.get("conversation_mode")) {
        (None, None) => {}
        (Some(id), Some(mode))
            if only(mode, &["kind", "gizmo_id"])
                && mode["kind"] == "gizmo_interaction"
                && mode.get("gizmo_id") == Some(id) => {}
        _ => return Err(invalid_body()),
    }
    let messages = body["messages"].as_array().ok_or_else(invalid_body)?;
    // This consumer dispatches one ordinary new user turn, never a history/tool
    // replay. The complete source message-list branches remain separate work.
    if messages.len() != 1 {
        return Err(invalid_body());
    }
    let message = &messages[0];
    if !only(
        message,
        &[
            "author",
            "channel",
            "content",
            "create_time",
            "end_turn",
            "id",
            "metadata",
            "recipient",
            "status",
            "update_time",
            "weight",
        ],
    ) || !opaque(&message["id"])
        || message["author"] != json!({"metadata":{},"name":null,"role":"user"})
        || message.get("channel") != Some(&Value::Null)
        || message.get("end_turn") != Some(&Value::Null)
        || message.get("update_time") != Some(&Value::Null)
        || message["recipient"] != "all"
        || message["status"] != "finished_successfully"
        || message["weight"] != 1
        || !message["create_time"]
            .as_f64()
            .is_some_and(|time| time.is_finite() && time >= 0.0)
        || message["metadata"]
            != json!({"automation_creation_attribution":{"origin":"conversation","flow_id":message["id"]}})
        || !only(&message["content"], &["content_type", "parts"])
        || message["content"]["content_type"] != "text"
    {
        return Err(invalid_body());
    }
    let parts = message["content"]["parts"]
        .as_array()
        .ok_or_else(invalid_body)?;
    if parts.len() != 1
        || !parts[0]
            .as_str()
            .is_some_and(|text| !text.trim().is_empty())
    {
        return Err(invalid_body());
    }
    // A local IPC resource bound, not an asserted official context limit.
    if serde_json::to_vec(body).map_err(|_| invalid_body())?.len() > 2 * 1024 * 1024 {
        return Err(invalid_body());
    }
    Ok(())
}

fn requirements_headers(body: &Value) -> ServiceResult<BTreeMap<String, String>> {
    if !body.is_object() {
        return Err(failure(
            "invalid_requirements",
            "Requirements response is not an object",
        ));
    }
    for key in ["proofofwork", "turnstile"] {
        if let Some(challenge) = body.get(key).filter(|value| !value.is_null()) {
            if !challenge.is_object()
                || challenge
                    .get("required")
                    .is_some_and(|value| !value.is_boolean())
            {
                return Err(failure(
                    "invalid_requirements",
                    "Invalid requirements challenge",
                ));
            }
            if challenge.get("required") == Some(&Value::Bool(true)) {
                return Err(failure(
                    "requirements_challenge_unsupported",
                    "This request requires an unsupported environment-bound challenge",
                ));
            }
        }
    }
    for (key, header) in [
        ("token", "OpenAI-Sentinel-Chat-Requirements-Token"),
        (
            "prepare_token",
            "OpenAI-Sentinel-Chat-Requirements-Prepare-Token",
        ),
    ] {
        let Some(value) = body.get(key).filter(|value| !value.is_null()) else {
            continue;
        };
        let token = value
            .as_str()
            .ok_or_else(|| failure("invalid_requirements", "Invalid requirements token"))?;
        if token.is_empty() {
            continue;
        }
        if token.len() > 32768 || token.chars().any(char::is_control) {
            return Err(failure(
                "invalid_requirements",
                "Invalid requirements token",
            ));
        }
        return Ok(BTreeMap::from([(header.into(), token.into())]));
    }
    // CP16's ordinary authenticated branch has no mandatory token assertion.
    // Missing/empty values produce no header, never a fabricated credential.
    Ok(BTreeMap::new())
}

fn validate_requirements_key(key: &str) -> ServiceResult<()> {
    let encoded = key
        .strip_prefix("gAAAAAC")
        .filter(|_| key.len() <= 65536)
        .ok_or_else(|| {
            failure(
                "invalid_request",
                "Actual browser requirements key is required",
            )
        })?;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| failure("invalid_request", "Invalid browser requirements key"))?;
    let value: Value = serde_json::from_slice(&raw)
        .map_err(|_| failure("invalid_request", "Invalid browser requirements key"))?;
    if !value.as_array().is_some_and(|values| values.len() == 25) {
        return Err(failure(
            "invalid_request",
            "Invalid browser requirements environment",
        ));
    }
    Ok(())
}

type FrameSink<'a> = dyn FnMut(stream_transport::StreamFrame) -> ServiceResult<stream_transport::StreamControl>
    + Send
    + 'a;
type TextStreamFuture<'a> =
    Pin<Box<dyn Future<Output = ServiceResult<stream_transport::StreamSummary>> + Send + 'a>>;
trait TextStream: Sync {
    fn stream<'a>(
        &'a self,
        request: HttpRequest,
        cancel: Arc<AtomicBool>,
        sink: &'a mut FrameSink<'_>,
    ) -> TextStreamFuture<'a>;
}
struct NativeTextStream;
impl TextStream for NativeTextStream {
    fn stream<'a>(
        &'a self,
        request: HttpRequest,
        cancel: Arc<AtomicBool>,
        sink: &'a mut FrameSink<'_>,
    ) -> TextStreamFuture<'a> {
        Box::pin(async move {
            stream_transport::stream_request(request, cancel, &mut |frame| sink(frame)).await
        })
    }
}

impl ChatgptService {
    // Fresh JWT and workspace routing are read for each stage. No session lock is
    // retained while awaiting HTTP, stream bytes or the renderer Channel.
    async fn conversation_request<F, Fut>(
        &self,
        route: &'static str,
        identity: &ServiceIdentity,
        profile: &ServiceProfile,
        registration: &Registration<'_>,
        call: &F,
    ) -> ServiceResult<HttpRequest>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
    {
        // Only authentication/routing RPCs are raced here. HTTP process cleanup
        // belongs to its transport and must remain awaited by the caller.
        tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(failure("cancelled", "Chat request cancelled before dispatch")),
            result = async {
        self.check_share_current(identity, registration)?;
        let auth = call(
            "getAuthStatus",
            json!({"includeToken":true,"refreshToken":false}),
        )
        .await
        .map_err(|_| {
            failure(
                "auth_unavailable",
                "ChatGPT authentication status unavailable",
            )
        })?;
        self.check_share_current(identity, registration)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut session = self.session.lock().await;
        self.check_share_current(identity, registration)?;
        if session.generation != identity.generation {
            *session = Session {
                generation: identity.generation,
                ..Session::default()
            };
        }
        self.install_credentials(&mut session, identity.generation, &auth, call, now)
            .await?;
        self.check_share_current(identity, registration)?;
        let credentials = session
            .credentials
            .as_ref()
            .ok_or_else(|| failure("auth_unavailable", "ChatGPT credentials unavailable"))?;
        if &credentials.identity != identity {
            return Err(failure(
                "account_changed",
                "ChatGPT request identity changed",
            ));
        }
        let mut outgoing = build_http_request(route, credentials, None, profile)?;
        drop(session);
        outgoing.method = HttpMethod::Post;
        outgoing
            .headers
            .insert("originator".into(), "Codex Desktop".into());
        outgoing
            .headers
            .insert("Content-Type".into(), "application/json".into());
        // These markers are host controls, never already-processed HTTP headers.
        outgoing.headers.retain(|key, _| {
            !matches!(
                key.to_ascii_lowercase().as_str(),
                "x-openai-attach-auth"
                    | "x-openai-attach-desktop-surface"
                    | "x-openai-attach-devicecheck-token"
                    | "x-openai-expected-account-id"
            )
        });
        share_network_allowed(call, &outgoing.url).await?;
        self.check_share_current(identity, registration)?;
        Ok(outgoing)
            } => result,
        }
    }

    pub async fn conversation_text<F, Fut, H>(
        &self,
        request: ConversationTextRequest,
        call: F,
        mut on_frame: H,
    ) -> ServiceResult<ConversationTextResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
        H: FnMut(ConversationTextFrame) -> ServiceResult<()> + Send,
    {
        self.conversation_text_with(
            request,
            call,
            &CurlTransport,
            &NativeTextStream,
            &mut on_frame,
        )
        .await
    }

    async fn conversation_text_with<F, Fut, T, S, H>(
        &self,
        request: ConversationTextRequest,
        call: F,
        transport: &T,
        stream: &S,
        on_frame: &mut H,
    ) -> ServiceResult<ConversationTextResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
        T: Transport + Sync,
        S: TextStream,
        H: FnMut(ConversationTextFrame) -> ServiceResult<()> + Send,
    {
        validate_text_body(&request.body)?;
        validate_requirements_key(&request.requirements_key)?;
        validate_browser_profile(&request.profile)?;
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        self.check_share_current(identity, &registration)?;
        let mut sequence = 0;
        // Await the stream's own cancellation path so curl is killed/reaped and
        // its private upload file is released before this request resolves.
        let result = async {
                let mut prepare = self.conversation_request("/backend-api/sentinel/chat-requirements/prepare", identity, &request.profile, &registration, &call).await?;
                prepare.body = serde_json::to_vec(&json!({"p":request.requirements_key})).map_err(|_| invalid_body())?;
                let prepared = send_bounded(transport, prepare, registration.cancelled.clone(), Duration::from_secs(50)).await?;
                self.check_share_current(identity, &registration)?;
                let prepared = decode_response(prepared, request.request_id.clone(), identity.clone())?;
                let requirements = requirements_headers(&prepared.body)?;
                let mut outgoing = self.conversation_request("/backend-api/f/conversation", identity, &request.profile, &registration, &call).await?;
                outgoing.headers.extend(requirements);
                outgoing.headers.insert("Accept".into(), "text/event-stream".into());
                outgoing.headers.insert("oai-genui-client-actions".into(), "open_entity_detail,run_plugin_tool,launch_ecosystem_widget".into());
                if let Some(project) = request.body.get("gizmo_id").and_then(Value::as_str) {
                    outgoing.headers.insert("chatgpt-project-id".into(), project.into());
                }
                // CW17 stream_unprepared with no prefetch result keeps the absent
                // client_prepare_state absent. No fake 'none', conduit or prepare ACK.
                outgoing.body = serde_json::to_vec(&request.body).map_err(|_| invalid_body())?;
                self.check_share_current(identity, &registration)?;
                let mut done = false;
                let mut deliver = |frame: stream_transport::StreamFrame| {
                    self.check_share_current(identity, &registration)?;
                    let next = sequence + 1;
                    let is_done = frame.data.trim() == "[DONE]";
                    on_frame(ConversationTextFrame { request_id:request.request_id.clone(), identity:identity.clone(), sequence: next,
                        event:frame.event, data:frame.data, id:frame.id })?;
                    sequence = next;
                    done = is_done;
                    Ok(if is_done { stream_transport::StreamControl::Stop } else { stream_transport::StreamControl::Continue })
                };
                let summary = stream.stream(outgoing, registration.cancelled.clone(), &mut deliver).await?;
                self.check_share_current(identity, &registration)?;
                if !(200..300).contains(&summary.status) {
                    return Err(decode_response(HttpResponse {status:summary.status,headers:summary.headers,body:summary.body}, request.request_id.clone(), identity.clone())
                        .err().unwrap_or_else(|| failure("invalid_response", "Chat stream was not accepted")));
                }
                // WvOS parses a final valid JSON data buffer at EOF. A pending
                // raw [DONE] is not JSON and cannot certify a normal terminal.
                if let Some(frame) = summary.pending_frame.filter(|frame| serde_json::from_str::<Value>(&frame.data).is_ok()) {
                    deliver(frame)?;
                }
                drop(deliver);
                if !done { return Err(failure("conversation_stream_incomplete", "Chat stream ended without DONE; delivery and partial response remain unconfirmed")); }
                // Recheck fresh principal/routing/network before returning a summary;
                // the already-delivered stream remains owned by its original identity.
                self.conversation_request("/backend-api/f/conversation", identity, &request.profile, &registration, &call).await?;
                Ok(ConversationTextResponse { request_id:request.request_id.clone(), identity:identity.clone(), status:"transport-complete", event_count:sequence, error:None })
        }.await;
        match result {
            Err(error) if sequence > 0 => Ok(ConversationTextResponse {
                request_id: request.request_id.clone(),
                identity: identity.clone(),
                status: "transport-error",
                event_count: sequence,
                error: Some(error),
            }),
            result => result,
        }
    }

    pub async fn conversation_stop<F, Fut>(
        &self,
        request: ConversationStopRequest,
        call: F,
    ) -> ServiceResult<ConversationStopResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
    {
        self.conversation_stop_with(request, call, &CurlTransport)
            .await
    }

    async fn conversation_stop_with<F, Fut, T>(
        &self,
        request: ConversationStopRequest,
        call: F,
        transport: &T,
    ) -> ServiceResult<ConversationStopResponse>
    where
        F: Fn(&'static str, Value) -> Fut + Sync,
        Fut: Future<Output = Result<Value, String>> + Send,
        T: Transport + Sync,
    {
        if !opaque(&json!(request.conversation_id))
            || request.conversation_id.starts_with("local-chatgpt:")
        {
            return Err(failure(
                "invalid_request",
                "An actual server conversation is required to stop",
            ));
        }
        let registration = self.register(&request.request_id)?;
        let identity = &request.expected_identity;
        let sent = AtomicBool::new(false);
        let result = async {
            let mut outgoing = self
                .conversation_request(
                    "/backend-api/stop_conversation",
                    identity,
                    &request.profile,
                    &registration,
                    &call,
                )
                .await?;
            outgoing.body = serde_json::to_vec(
                &json!({"conversation_id":request.conversation_id,"exclude_async_types":[]}),
            )
            .map_err(|_| invalid_body())?;
            sent.store(true, Ordering::SeqCst);
            let response = send_bounded(
                transport,
                outgoing,
                registration.cancelled.clone(),
                Duration::from_secs(50),
            )
            .await?;
            self.check_share_current(identity, &registration)?;
            if !(200..300).contains(&response.status) {
                return Err(decode_response(
                    response,
                    request.request_id.clone(),
                    identity.clone(),
                )
                .err()
                .unwrap_or_else(|| failure("invalid_response", "Stop was not accepted")));
            }
            self.conversation_request(
                "/backend-api/stop_conversation",
                identity,
                &request.profile,
                &registration,
                &call,
            )
            .await?;
            Ok(ConversationStopResponse {
                request_id: request.request_id.clone(),
                identity: identity.clone(),
                status: "accepted",
            })
        }
        .await;
        result.map_err(|error| {
            if sent.load(Ordering::SeqCst)
                && !error
                    .status
                    .is_some_and(|status| (400..500).contains(&status) && status != 408)
            {
                ServiceError {
                    code: "conversation_stop_unknown",
                    message:
                        "Server stop is unconfirmed; local cancellation does not prove it stopped",
                    status: error.status,
                }
            } else {
                error
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn identity() -> ServiceIdentity {
        ServiceIdentity {
            account_id: "text-account".into(),
            user_id: "text-user".into(),
            generation: 0,
        }
    }
    fn profile() -> ServiceProfile {
        ServiceProfile {
            language: "zh-CN".into(),
            device_id: "fixture-device".into(),
            user_agent: "Mozilla/5.0 Chrome/140.0.0.0".into(),
            user_agent_client_hints: "\"Chromium\";v=\"140\"".into(),
            platform_client_hint: "\"Windows\"".into(),
        }
    }
    fn request() -> ConversationTextRequest {
        ConversationTextRequest {
            request_id: "text-fixture".into(),
            expected_identity: identity(),
            profile: profile(),
            requirements_key: format!(
                "gAAAAAC{}",
                base64::engine::general_purpose::STANDARD
                    .encode(serde_json::to_vec(&vec![0; 25]).unwrap())
            ),
            body: body(),
        }
    }
    fn auth(account: &str) -> Value {
        let claims = json!({"exp":4102444800u64,"https://api.openai.com/auth":{"chatgpt_account_id":account,"user_id":"text-user","chatgpt_account_is_fedramp":false}});
        json!({"authMethod":"chatgpt","authToken":format!("fixture.{}.signature",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()))})
    }
    fn rpc(method: &'static str, _: Value) -> std::future::Ready<Result<Value, String>> {
        std::future::ready(match method {
            "getAuthStatus" => Ok(auth("text-account")),
            "account/read" => Ok(
                json!({"account":{"type":"chatgpt"},"workspaceRouting":{"backendOrigin":"https://chatgpt.com",
                "chatgptAccountId":"text-account","accountRoutingOverride":"NO_CONSTRAINT"}}),
            ),
            "configRequirements/read" => Ok(json!({"requirements":null})),
            _ => Err("unexpected fixture RPC".into()),
        })
    }
    struct FixtureHttp {
        requests: Mutex<Vec<HttpRequest>>,
        replies: Mutex<VecDeque<HttpResponse>>,
    }
    impl FixtureHttp {
        fn new(body: Value) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: Mutex::new(VecDeque::from([HttpResponse {
                    status: 200,
                    headers: BTreeMap::new(),
                    body: serde_json::to_vec(&body).unwrap(),
                }])),
            }
        }
        fn status(status: u16) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: Mutex::new(VecDeque::from([HttpResponse {
                    status,
                    headers: BTreeMap::new(),
                    body: Vec::new(),
                }])),
            }
        }
    }
    impl Transport for FixtureHttp {
        fn send(&self, request: HttpRequest, _: Arc<AtomicBool>) -> TransportFuture<'_> {
            self.requests.lock().unwrap().push(request);
            Box::pin(std::future::ready(Ok(self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("must not replay HTTP"))))
        }
    }
    struct FixtureStream<'a> {
        service: &'a ChatgptService,
        requests: Mutex<Vec<HttpRequest>>,
        frames: Vec<&'static str>,
        status: u16,
        invalidate_at: Option<usize>,
        cancel_at: Option<usize>,
        pending_data: Option<&'static str>,
    }
    impl<'a> FixtureStream<'a> {
        fn new(service: &'a ChatgptService, frames: Vec<&'static str>) -> Self {
            Self {
                service,
                requests: Mutex::new(Vec::new()),
                frames,
                status: 200,
                invalidate_at: None,
                cancel_at: None,
                pending_data: None,
            }
        }
    }
    impl TextStream for FixtureStream<'_> {
        fn stream<'a>(
            &'a self,
            request: HttpRequest,
            cancel: Arc<AtomicBool>,
            sink: &'a mut FrameSink<'_>,
        ) -> TextStreamFuture<'a> {
            Box::pin(async move {
                assert!(
                    self.service.session.try_lock().is_ok(),
                    "session authentication lock must not cover stream/callback lifetime"
                );
                self.requests.lock().unwrap().push(request);
                let mut event_count = 0;
                if (200..300).contains(&self.status) {
                    for (index, data) in self.frames.iter().enumerate() {
                        if self.invalidate_at == Some(index) {
                            self.service.invalidate();
                        }
                        if self.cancel_at == Some(index) {
                            cancel.store(true, Ordering::SeqCst);
                        }
                        let control = sink(stream_transport::StreamFrame {
                            event: "message".into(),
                            data: (*data).into(),
                            id: format!("event-{index}"),
                        })?;
                        event_count += 1;
                        if matches!(control, stream_transport::StreamControl::Stop) {
                            break;
                        }
                    }
                }
                Ok(stream_transport::StreamSummary {
                    status: self.status,
                    headers: BTreeMap::new(),
                    body: Vec::new(),
                    event_count,
                    pending_frame: self.pending_data.map(|data| stream_transport::StreamFrame {
                        event: "message".into(),
                        data: data.into(),
                        id: "pending-event".into(),
                    }),
                })
            })
        }
    }

    fn body() -> Value {
        json!({"action":"next","model":"actual-chat-model","parent_message_id":"client-created-root",
            "timezone":"Asia/Shanghai","timezone_offset_min":-480,"supported_encodings":["v1"],
            "messages":[{"author":{"metadata":{},"name":null,"role":"user"},"channel":null,
                "content":{"content_type":"text","parts":["真实文字"]},"create_time":1790000000.125,
                "end_turn":null,"id":"e2e05ac9-bf38-4802-8077-9d8642d4a5cd",
                "metadata":{"automation_creation_attribution":{"origin":"conversation","flow_id":"e2e05ac9-bf38-4802-8077-9d8642d4a5cd"}},
                "recipient":"all","status":"finished_successfully","update_time":null,"weight":1}]})
    }

    #[test]
    fn conversation_text_preserves_real_plain_message_and_conditional_fields() {
        let original = body();
        validate_text_body(&original).unwrap();
        assert_eq!(original["messages"][0]["create_time"], 1790000000.125);
        assert!(original.get("conversation_id").is_none());
        let mut followup = original.clone();
        followup["conversation_id"] = json!("server-conversation");
        followup["parent_message_id"] = json!("actual-parent");
        followup["thinking_effort"] = json!("extended");
        followup["gizmo_id"] = json!("g-p-actual");
        followup["conversation_mode"] = json!({"kind":"gizmo_interaction","gizmo_id":"g-p-actual"});
        validate_text_body(&followup).unwrap();
    }

    #[test]
    fn conversation_text_rejects_tool_upload_extra_body_and_invented_ancestry() {
        for (key, value) in [
            ("tools", json!([])),
            ("client_prepare_state", json!("success")),
            ("headers", json!({})),
            ("url", json!("https://example.com")),
            ("app_attest_challenge", json!("fake")),
        ] {
            let mut invalid = body();
            invalid[key] = value;
            assert!(validate_text_body(&invalid).is_err(), "{key}");
        }
        for change in 0..6 {
            let mut invalid = body();
            match change {
                0 => invalid["messages"][0]["author"]["role"] = json!("tool"),
                1 => {
                    invalid["messages"][0]["content"] =
                        json!({"content_type":"multimodal_text","parts":[]})
                }
                2 => invalid["messages"][0]["metadata"]["attachments"] = json!([]),
                3 => invalid["conversation_id"] = json!("server-id"),
                4 => {
                    invalid["messages"][0]["metadata"]["automation_creation_attribution"]
                        ["flow_id"] = json!("foreign-message")
                }
                _ => invalid["messages"][0]["content"]["parts"] = json!([" "]),
            };
            assert!(validate_text_body(&invalid).is_err(), "case {change}");
        }
    }

    #[test]
    fn conversation_text_requirements_actual_token_precedence_and_required_challenges() {
        let headers = requirements_headers(
            &json!({"token":"actual-token","prepare_token":"actual-prepare",
            "proofofwork":{"required":false},"turnstile":{"required":false}}),
        )
        .unwrap();
        assert_eq!(
            headers["OpenAI-Sentinel-Chat-Requirements-Token"],
            "actual-token"
        );
        assert_eq!(headers.len(), 1);
        let headers = requirements_headers(&json!({"prepare_token":"actual-prepare"})).unwrap();
        assert_eq!(
            headers["OpenAI-Sentinel-Chat-Requirements-Prepare-Token"],
            "actual-prepare"
        );
        assert!(requirements_headers(&json!({})).unwrap().is_empty());
        assert!(
            requirements_headers(&json!({"token":"","prepare_token":""}))
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            requirements_headers(&json!({"token":"","prepare_token":"actual-prepare"})).unwrap()
                ["OpenAI-Sentinel-Chat-Requirements-Prepare-Token"],
            "actual-prepare"
        );
        for response in [
            json!(null),
            json!([]),
            json!({"token":42}),
            json!({"token":"bad\r\nheader"}),
            json!({"token":"token","proofofwork":{"required":true,"seed":"actual","difficulty":"actual"}}),
            json!({"token":"token","turnstile":{"required":true,"dx":"actual"}}),
        ] {
            assert!(requirements_headers(&response).is_err());
        }
    }

    #[tokio::test]
    async fn conversation_text_real_stages_headers_partial_frames_and_raw_done() {
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({"token":"actual-requirements-token"}));
        let stream = FixtureStream::new(
            &service,
            vec!["{\"actual\":\"片段\"}", "[DONE]", "must-not-deliver"],
        );
        let original = request();
        let expected = original.body.clone();
        let expected_key = original.requirements_key.clone();
        let mut frames = Vec::new();
        let response = service
            .conversation_text_with(original, rpc, &http, &stream, &mut |frame| {
                frames.push(frame);
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(response.status, "transport-complete");
        assert_eq!(response.event_count, 2);
        assert_eq!(frames.len(), 2);
        assert_eq!(
            frames
                .iter()
                .map(|frame| frame.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(frames[0].identity, identity());
        assert_eq!(frames[0].request_id, "text-fixture");
        assert_eq!(frames[0].data, "{\"actual\":\"片段\"}");
        assert_eq!(frames[1].data, "[DONE]");
        let requests = http.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].url,
            "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({"p":expected_key})
        );
        let requests = stream.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].url,
            "https://chatgpt.com/backend-api/f/conversation"
        );
        assert_eq!(requests[0].method, HttpMethod::Post);
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            expected
        );
        assert_eq!(
            requests[0].headers["OpenAI-Sentinel-Chat-Requirements-Token"],
            "actual-requirements-token"
        );
        assert_eq!(requests[0].headers["originator"], "Codex Desktop");
        assert_eq!(requests[0].headers["ChatGPT-Account-Id"], "text-account");
        assert_eq!(requests[0].headers["Accept"], "text/event-stream");
        for key in requests[0].headers.keys() {
            assert!(!key.to_ascii_lowercase().starts_with("x-openai-attach-"));
            assert_ne!(key.to_ascii_lowercase(), "x-openai-expected-account-id");
        }
        assert!(!requests[0].headers.contains_key("x-conduit-token"));
        let public = serde_json::to_string(&frames).unwrap();
        assert!(!public.contains("actual-requirements-token"));
        assert!(!public.contains("Bearer"));
    }

    #[tokio::test]
    async fn conversation_text_required_challenges_invalid_keys_and_extra_fields_never_complete() {
        for challenge in [
            json!({"proofofwork":{"required":true,"seed":"actual","difficulty":"actual"},"token":"token"}),
            json!({"turnstile":{"required":true,"dx":"actual"},"prepare_token":"prepare"}),
            json!({"token":42}),
            json!([]),
        ] {
            let service = ChatgptService::default();
            let http = FixtureHttp::new(challenge);
            let stream = FixtureStream::new(&service, vec![]);
            assert!(service
                .conversation_text_with(request(), rpc, &http, &stream, &mut |_| panic!(
                    "no frame before completion dispatch"
                ))
                .await
                .is_err());
            assert!(stream.requests.lock().unwrap().is_empty());
            assert_eq!(http.requests.lock().unwrap().len(), 1);
        }
        for scenario in ["key", "body"] {
            let service = ChatgptService::default();
            let http = FixtureHttp::new(json!({"token":"token"}));
            let stream = FixtureStream::new(&service, vec![]);
            let mut invalid = request();
            if scenario == "key" {
                invalid.requirements_key = "Bearer-is-not-requirements".into();
            } else {
                invalid.body["tools"] = json!([]);
            }
            assert!(service
                .conversation_text_with(invalid, rpc, &http, &stream, &mut |_| panic!(
                    "invalid request frame"
                ))
                .await
                .is_err());
            assert!(http.requests.lock().unwrap().is_empty());
            assert!(stream.requests.lock().unwrap().is_empty());
        }
        let mut dto = json!({"requestId":"x","expectedIdentity":identity(),"profile":{"language":"zh-CN","deviceId":"fixture-device",
            "userAgent":"Mozilla/5.0 Chrome/140.0.0.0","userAgentClientHints":"\"Chromium\";v=\"140\"","platformClientHint":"\"Windows\""},"requirementsKey":"key","body":body()});
        assert!(
            serde_json::from_value::<ConversationTextRequest>(dto.clone()).is_ok(),
            "extra-field rejection starts with a valid DTO"
        );
        dto["url"] = json!("https://example.com");
        assert!(serde_json::from_value::<ConversationTextRequest>(dto).is_err());
    }

    #[tokio::test]
    async fn conversation_text_absent_requirement_tokens_follow_source_without_invented_headers() {
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({}));
        let stream = FixtureStream::new(&service, vec!["[DONE]"]);
        let result = service
            .conversation_text_with(request(), rpc, &http, &stream, &mut |_| Ok(()))
            .await
            .unwrap();
        assert_eq!(result.event_count, 1);
        assert!(stream.requests.lock().unwrap()[0]
            .headers
            .keys()
            .all(|key| !key.starts_with("OpenAI-Sentinel-")));
    }

    #[tokio::test]
    async fn conversation_text_cancellation_awaits_stream_cleanup_before_returning() {
        struct CleanupStream {
            finished: AtomicBool,
        }
        impl TextStream for CleanupStream {
            fn stream<'a>(
                &'a self,
                _: HttpRequest,
                cancel: Arc<AtomicBool>,
                _: &'a mut FrameSink<'_>,
            ) -> TextStreamFuture<'a> {
                Box::pin(async move {
                    cancel.store(true, Ordering::SeqCst);
                    // Model the independent transport's asynchronous kill/wait.
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    self.finished.store(true, Ordering::SeqCst);
                    Err(failure("cancelled", "fixture transport reaped"))
                })
            }
        }
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({"token":"token"}));
        let stream = CleanupStream {
            finished: AtomicBool::new(false),
        };
        assert_eq!(
            service
                .conversation_text_with(request(), rpc, &http, &stream, &mut |_| Ok(()))
                .await
                .err()
                .unwrap()
                .code,
            "cancelled"
        );
        assert!(
            stream.finished.load(Ordering::SeqCst),
            "business cancellation must not drop the transport before its cleanup completes"
        );
    }

    #[tokio::test]
    async fn conversation_text_terminal_error_envelope_counts_only_delivered_partial() {
        for callback_failure in [false, true] {
            let service = ChatgptService::default();
            let http = FixtureHttp::new(json!({"token":"token"}));
            let stream = FixtureStream::new(
                &service,
                if callback_failure {
                    vec!["partial", "failed-delivery"]
                } else {
                    vec!["partial"]
                },
            );
            let mut delivered = 0;
            let response = service
                .conversation_text_with(request(), rpc, &http, &stream, &mut |_| {
                    if callback_failure && delivered == 1 {
                        return Err(failure("channel_closed", "fixture consumer closed"));
                    }
                    delivered += 1;
                    Ok(())
                })
                .await
                .unwrap();
            let response = serde_json::to_value(response).unwrap();
            assert_eq!(response["status"], "transport-error");
            assert_eq!(response["eventCount"], 1);
            assert_eq!(delivered, 1);
            assert_eq!(
                response["error"]["code"],
                if callback_failure {
                    "channel_closed"
                } else {
                    "conversation_stream_incomplete"
                }
            );
        }
    }

    #[tokio::test]
    async fn conversation_text_terminal_done_matches_source_trim_and_force_login_is_not_first_attempt_gate(
    ) {
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({"token":"actual-token","force_login":true}));
        let stream = FixtureStream::new(&service, vec![" \t[DONE]\n", "must-not-deliver"]);
        let mut frames = Vec::new();
        let response = service
            .conversation_text_with(request(), rpc, &http, &stream, &mut |frame| {
                frames.push(frame.data);
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(response.status, "transport-complete");
        assert_eq!(response.event_count, 1);
        assert_eq!(frames, vec![" \t[DONE]\n"]);
    }

    #[tokio::test]
    async fn conversation_text_terminal_pending_json_is_delivered_but_never_fabricates_done() {
        for pending in ["{\"partial\":\"尾部\"}", "{\"partial\":", "[DONE]"] {
            let service = ChatgptService::default();
            let http = FixtureHttp::new(json!({"token":"token"}));
            let mut stream = FixtureStream::new(&service, vec![]);
            stream.pending_data = Some(pending);
            let mut frames = Vec::new();
            let result = service
                .conversation_text_with(request(), rpc, &http, &stream, &mut |frame| {
                    frames.push(frame);
                    Ok(())
                })
                .await;
            if pending.starts_with("{\"partial\":\"") {
                let response = result.unwrap();
                assert_eq!(response.status, "transport-error");
                assert_eq!(response.event_count, 1);
                assert_eq!(
                    response.error.unwrap().code,
                    "conversation_stream_incomplete"
                );
                assert_eq!(frames[0].sequence, 1);
                assert_eq!(frames[0].data, pending);
            } else {
                assert_eq!(result.err().unwrap().code, "conversation_stream_incomplete");
                assert!(frames.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn conversation_text_eof_rejected_http_and_callback_failure_do_not_retry_or_succeed() {
        for status in [200, 401, 403, 500] {
            let service = ChatgptService::default();
            let http = FixtureHttp::new(json!({"prepare_token":"prepare"}));
            let mut stream = FixtureStream::new(&service, vec!["partial"]);
            stream.status = status;
            let mut delivered = Vec::new();
            let result = service
                .conversation_text_with(request(), rpc, &http, &stream, &mut |frame| {
                    delivered.push(frame.data);
                    Ok(())
                })
                .await;
            if status == 200 {
                let response = result.unwrap();
                assert_eq!(response.status, "transport-error");
                assert_eq!(response.event_count, 1);
                let error = response.error.unwrap();
                assert_eq!(error.code, "conversation_stream_incomplete");
                assert_eq!(delivered, vec!["partial"]);
            } else {
                let error = result.err().unwrap();
                assert_eq!(error.status, Some(status));
                assert!(delivered.is_empty());
            }
            assert_eq!(stream.requests.lock().unwrap().len(), 1);
            assert_eq!(http.requests.lock().unwrap().len(), 1);
        }
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({"token":"token"}));
        let stream = FixtureStream::new(&service, vec!["partial", "[DONE]"]);
        let error = service
            .conversation_text_with(request(), rpc, &http, &stream, &mut |_| {
                Err(failure("channel_closed", "Original consumer closed"))
            })
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "channel_closed");
        assert_eq!(stream.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn conversation_text_owner_cancellation_and_network_fences_preserve_prior_partial() {
        for retirement in ["owner", "cancel"] {
            let service = ChatgptService::default();
            let http = FixtureHttp::new(json!({"token":"token"}));
            let mut stream = FixtureStream::new(&service, vec!["partial", "late", "[DONE]"]);
            if retirement == "owner" {
                stream.invalidate_at = Some(1);
            } else {
                stream.cancel_at = Some(1);
            }
            let mut frames = Vec::new();
            let response = service
                .conversation_text_with(request(), rpc, &http, &stream, &mut |frame| {
                    frames.push(frame.data);
                    Ok(())
                })
                .await
                .unwrap();
            assert_eq!(response.status, "transport-error");
            assert_eq!(response.event_count, 1);
            assert_eq!(
                response.error.unwrap().code,
                if retirement == "owner" {
                    "account_changed"
                } else {
                    "cancelled"
                }
            );
            assert_eq!(frames, vec!["partial"]);
            assert_eq!(stream.requests.lock().unwrap().len(), 1);
        }
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({"token":"token"}));
        let stream = FixtureStream::new(&service, vec![]);
        let policy = |method, params| {
            if method == "configRequirements/read" {
                std::future::ready(Ok(
                    json!({"requirements":{"application":{"network":{"enabled":true,"domains":{}}}}}),
                ))
            } else {
                rpc(method, params)
            }
        };
        assert_eq!(
            service
                .conversation_text_with(request(), policy, &http, &stream, &mut |_| Ok(()))
                .await
                .err()
                .unwrap()
                .code,
            "network_restricted"
        );
        assert!(http.requests.lock().unwrap().is_empty());
        assert!(stream.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn conversation_text_refreshes_principal_before_completion_even_with_cached_session() {
        let service = ChatgptService::default();
        let http = FixtureHttp::new(json!({"token":"token"}));
        let stream = FixtureStream::new(&service, vec![]);
        let reads = AtomicUsize::new(0);
        let call = |method, params| {
            if method == "getAuthStatus" && reads.fetch_add(1, Ordering::SeqCst) > 0 {
                std::future::ready(Ok(auth("foreign-account")))
            } else {
                rpc(method, params)
            }
        };
        assert!(service
            .conversation_text_with(request(), call, &http, &stream, &mut |_| Ok(()))
            .await
            .is_err());
        assert_eq!(http.requests.lock().unwrap().len(), 1);
        assert!(stream.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn conversation_text_stop_exact_server_route_ack_and_unknown_are_distinct() {
        for status in [200, 204, 401, 500] {
            let service = ChatgptService::default();
            let http = FixtureHttp::status(status);
            let stop = ConversationStopRequest {
                request_id: "stop-fixture".into(),
                expected_identity: identity(),
                profile: profile(),
                conversation_id: "server-id".into(),
            };
            let result = service.conversation_stop_with(stop, rpc, &http).await;
            if status < 300 {
                assert_eq!(result.unwrap().status, "accepted");
            } else {
                let error = result.err().unwrap();
                assert_eq!(error.status, Some(status));
                if status == 500 {
                    assert_eq!(error.code, "conversation_stop_unknown");
                }
            }
            let requests = http.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(
                requests[0].url,
                "https://chatgpt.com/backend-api/stop_conversation"
            );
            assert_eq!(
                serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
                json!({"conversation_id":"server-id","exclude_async_types":[]})
            );
        }
        let service = ChatgptService::default();
        let http = FixtureHttp::status(204);
        let stop = ConversationStopRequest {
            request_id: "stop-local".into(),
            expected_identity: identity(),
            profile: profile(),
            conversation_id: "local-chatgpt:draft".into(),
        };
        assert_eq!(
            service
                .conversation_stop_with(stop, rpc, &http)
                .await
                .err()
                .unwrap()
                .code,
            "invalid_request"
        );
        assert!(http.requests.lock().unwrap().is_empty());
    }
}
