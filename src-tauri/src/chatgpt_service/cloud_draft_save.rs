use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudDraftSaveRequest {
    request_id: String,
    expected_identity: ServiceIdentity,
    config_id: String,
    draft_id: String,
    base_version_id: String,
    expected_revision: u64,
    install_script: Option<String>,
    start_skill: Option<String>,
    network_policy: Option<DraftNetworkPolicy>,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum DraftNetworkPolicy {
    Disabled,
    Unrestricted,
    Restricted {
        #[serde(default)]
        presets: Vec<DraftNetworkPreset>,
        egress_rules: Vec<DraftEgressRule>,
    },
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum DraftNetworkPreset {
    PackageManagers,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct DraftEgressRule {
    host: String,
}

fn valid_egress_host(host: &str) -> bool {
    if host == "*" {
        return true;
    }
    let name = host.strip_prefix("*.").unwrap_or(host);
    let valid_char = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    if host.len() > 253
        || !name.split('.').all(|label| {
            label.len() <= 63
                && label.bytes().next().is_some_and(valid_char)
                && label.bytes().last().is_some_and(valid_char)
                && label.bytes().all(|byte| valid_char(byte) || byte == b'-')
        })
    {
        return false;
    }
    let last = name.rsplit('.').next().unwrap_or_default();
    let numeric = last.bytes().all(|byte| byte.is_ascii_digit())
        || last
            .strip_prefix("0x")
            .is_some_and(|hex| !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()));
    !numeric || (name == host && name.parse::<std::net::Ipv4Addr>().is_ok())
}

impl DraftNetworkPolicy {
    fn valid(&self) -> bool {
        if let Self::Restricted {
            presets,
            egress_rules,
        } = self
        {
            let mut hosts = std::collections::HashSet::new();
            return presets.len() <= 1
                && egress_rules
                    .iter()
                    .all(|rule| valid_egress_host(&rule.host) && hosts.insert(&rule.host));
        }
        true
    }

    fn matches(&self, body: &Value) -> bool {
        let Ok(other) = serde_json::from_value::<Self>(body.clone()) else {
            return false;
        };
        match (self, &other) {
            (
                Self::Restricted {
                    presets,
                    egress_rules,
                },
                Self::Restricted {
                    presets: actual_presets,
                    egress_rules: actual_rules,
                },
            ) => {
                let hosts: std::collections::HashSet<_> =
                    egress_rules.iter().map(|rule| &rule.host).collect();
                let actual_hosts = actual_rules.iter().map(|rule| &rule.host).collect();
                presets == actual_presets && hosts == actual_hosts
            }
            _ => self == &other,
        }
    }
}

impl CloudDraftSaveRequest {
    fn payload(&self) -> ServiceResult<Value> {
        if self.base_version_id.trim().is_empty()
            || self.base_version_id.len() > 512
            || self.base_version_id.chars().any(char::is_control)
            || self.expected_revision > 9_007_199_254_740_991
            || (self.install_script.is_none()
                && self.start_skill.is_none()
                && self.network_policy.is_none())
            || self
                .network_policy
                .as_ref()
                .is_some_and(|policy| !policy.valid())
            || self
                .install_script
                .as_ref()
                .is_some_and(|text| text.len() > 256 * 1024 || text.contains('\0'))
            || self
                .start_skill
                .as_ref()
                .is_some_and(|text| text.len() > 2048 || text.chars().any(char::is_control))
        {
            return Err(failure("invalid_request", "Invalid cloud draft changes"));
        }
        let mut body = json!({"base_version_id":self.base_version_id,"expected_revision":self.expected_revision});
        if let Some(value) = &self.install_script {
            body["install_script"] = json!(value);
        }
        if let Some(value) = &self.start_skill {
            body["start_skill"] = json!(value);
        }
        if let Some(value) = &self.network_policy {
            body["network_policy"] = json!(value);
        }
        Ok(body)
    }

    fn draft<'a>(&self, value: &'a Value) -> Option<&'a Value> {
        let draft = value.get("draft")?;
        (value["id"].as_str() == Some(&self.config_id)
            && draft["id"].as_str() == Some(&self.draft_id))
        .then_some(draft)
    }

    fn confirmed(&self, value: &Value) -> bool {
        let Some(draft) = self.draft(value) else {
            return false;
        };
        draft["base_version_id"].as_str() == Some(&self.base_version_id)
            && draft["revision"]
                .as_u64()
                .is_some_and(|revision| revision > self.expected_revision)
            && self
                .network_policy
                .as_ref()
                .is_none_or(|policy| policy.matches(&draft["network_policy"]))
            && [
                ("install_script", &self.install_script),
                ("start_skill", &self.start_skill),
            ]
            .iter()
            .all(|(key, requested)| {
                requested.as_ref().is_none_or(|text| {
                    draft[*key].as_str() == Some(text) || (text.is_empty() && draft[*key].is_null())
                })
            })
    }
}

fn unconfirmed() -> ServiceError {
    failure(
        "cloud_draft_save_unconfirmed",
        "Cloud draft save could not be confirmed; read the draft before retrying",
    )
}

impl ChatgptService {
    pub(crate) async fn cloud_save_draft<F, Fut>(
        &self,
        request: CloudDraftSaveRequest,
        profile: CloudProfile,
        call: F,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.cloud_save_draft_with(request, profile, call, &CurlTransport)
            .await
    }

    pub(super) async fn cloud_save_draft_with<F, Fut, T>(
        &self,
        request: CloudDraftSaveRequest,
        profile: CloudProfile,
        call: F,
        transport: &T,
    ) -> ServiceResult<ServiceResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        T: Transport,
    {
        let route = resolve_cloud_route(
            &CloudOperation::Draft,
            &json!({"id":request.config_id,"draftId":request.draft_id}),
        )?;
        let payload = request.payload()?;
        validate_cloud_profile(&profile)?;
        let registration = self.register(&request.request_id)?;
        let generation = request.expected_identity.generation;
        let sent = AtomicBool::new(false);
        let result = tokio::select! {
            _ = cancelled(&registration.cancelled) => Err(if sent.load(Ordering::SeqCst) { unconfirmed() } else { failure("cancelled", "Service request cancelled") }),
            result = async {
                let credentials = self.cloud_credentials(generation, &call).await?;
                if credentials.identity != request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                let mut patch = build_cloud_http_request(&route, &credentials, &profile);
                patch.method = HttpMethod::Patch;
                patch.body = serde_json::to_vec(&payload).map_err(|_| failure("invalid_request", "Invalid cloud draft changes"))?;
                share_network_allowed(&call, &patch.url).await?;
                if registration.cancelled.load(Ordering::SeqCst) || self.generation() != generation {
                    return Err(failure("cancelled", "Service request cancelled"));
                }
                sent.store(true, Ordering::SeqCst);
                let response = send_bounded(transport, patch, registration.cancelled.clone(), Duration::from_secs(30)).await.map_err(|_| unconfirmed())?;
                let after = self.cloud_credentials(generation, &call).await.map_err(|_| unconfirmed())?;
                if after.identity != request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                if response.status >= 500 || response.status == 408 { return Err(unconfirmed()); }
                let accepted = (200..300).contains(&response.status);
                let ack = decode_response(response, request.request_id.clone(), request.expected_identity.clone())
                    .map_err(|error| if accepted { unconfirmed() } else { error })?;
                if request.draft(&ack.body).is_none() { return Err(unconfirmed()); }
                let read = build_cloud_http_request(&route, &after, &profile);
                share_network_allowed(&call, &read.url).await.map_err(|_| unconfirmed())?;
                let response = send_bounded(transport, read, registration.cancelled.clone(), Duration::from_secs(30)).await.map_err(|_| unconfirmed())?;
                let current = self.cloud_credentials(generation, &call).await.map_err(|_| unconfirmed())?;
                if current.identity != request.expected_identity { return Err(failure("account_changed", "Authenticated identity changed")); }
                let confirmed = decode_response(response, request.request_id.clone(), request.expected_identity.clone()).map_err(|_| unconfirmed())?;
                if !request.confirmed(&confirmed.body) { return Err(unconfirmed()); }
                Ok(confirmed)
            } => result,
        };
        if self.generation() != generation {
            return Err(failure("account_changed", "Authenticated identity changed"));
        }
        if sent.load(Ordering::SeqCst) && registration.cancelled.load(Ordering::SeqCst) {
            return Err(unconfirmed());
        }
        result
    }
}
