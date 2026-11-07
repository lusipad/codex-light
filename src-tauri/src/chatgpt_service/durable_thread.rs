use super::{
    failure, ChatgptService, CloudProfile, DurableModelsResponse, ServiceIdentity, ServiceResult,
};
use crate::durable::{Notify, Request};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{future::Future, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DurableThreadRequest {
    request_id: String,
    expected_identity: ServiceIdentity,
    operation: Operation,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Operation {
    Read {
        thread_id: String,
    },
    Resume {
        params: Value,
        timeout_seconds: Option<u16>,
    },
    Title {
        thread_id: String,
        name: String,
    },
    Turns {
        thread_id: String,
        cursor: Option<String>,
        limit: u8,
    },
    Items {
        thread_id: String,
        turn_id: String,
        cursor: Option<String>,
        limit: u8,
    },
    Preferences,
    Requirements,
}

fn opaque(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 2048 && !value.chars().any(char::is_control)
}

fn valid_resume_config(config: &Value) -> bool {
    fn feature(key: &str) -> bool {
        !key.is_empty()
            && ![
                "guardian_approval",
                "guardianv2",
                "request_permissions_tool",
            ]
            .iter()
            .any(|blocked| {
                key == *blocked
                    || key
                        .strip_prefix(*blocked)
                        .is_some_and(|suffix| suffix.starts_with('.'))
            })
    }
    config.as_object().is_some_and(|entries| {
        entries.iter().all(|(key, value)| match key.as_str() {
            "personality" | "model_reasoning_effort" => value.is_null() || value.is_string(),
            "tools.experimental_request_user_input.enabled" => value == &Value::Bool(false),
            "features" => value.as_object().is_some_and(|features| {
                features
                    .iter()
                    .all(|(key, value)| feature(key) && value.is_boolean())
            }),
            key => key.strip_prefix("features.").is_some_and(feature) && value.is_boolean(),
        })
    })
}

impl Operation {
    fn wire(self) -> ServiceResult<Request> {
        let (method, params, seconds) = match self {
            Self::Read { thread_id } if opaque(&thread_id) => (
                "thread/read",
                json!({"threadId":thread_id,"includeTurns":false}),
                30,
            ),
            Self::Resume {
                params,
                timeout_seconds,
            } if valid_resume(&params)
                && matches!(timeout_seconds, None | Some(120 | 240 | 480)) =>
            {
                (
                    "thread/resume",
                    params,
                    u64::from(timeout_seconds.unwrap_or(120)),
                )
            }
            Self::Title { thread_id, name } if opaque(&thread_id) && opaque(&name) => (
                "thread/name/set",
                json!({"threadId":thread_id,"name":name}),
                30,
            ),
            Self::Turns {
                thread_id,
                cursor,
                limit,
            } if opaque(&thread_id)
                && cursor.as_deref().is_none_or(opaque)
                && (1..=5).contains(&limit) =>
            {
                (
                    "thread/turns/list",
                    json!({"threadId":thread_id,"cursor":cursor,"limit":limit,"itemsView":"notLoaded","sortDirection":"desc"}),
                    30,
                )
            }
            Self::Items {
                thread_id,
                turn_id,
                cursor,
                limit,
            } if opaque(&thread_id)
                && opaque(&turn_id)
                && cursor.as_deref().is_none_or(opaque)
                && (1..=100).contains(&limit) =>
            {
                (
                    "thread/items/list",
                    json!({"threadId":thread_id,"turnId":turn_id,"cursor":cursor,"limit":limit,"sortDirection":"desc"}),
                    30,
                )
            }
            Self::Preferences => ("config/read", json!({"cwd":null,"includeLayers":true}), 30),
            Self::Requirements => ("configRequirements/read", Value::Null, 30),
            _ => return Err(failure("invalid_request", "Invalid cloud thread operation")),
        };
        Ok(Request {
            method,
            params,
            timeout: Duration::from_secs(seconds),
        })
    }
}

fn valid_resume(params: &Value) -> bool {
    params["threadId"].as_str().is_some_and(opaque)
        && params.get("model").is_some_and(Value::is_null)
        && params.get("history").is_some_and(Value::is_null)
        && params["excludeTurns"] == true
        && params.as_object().is_some_and(|fields| {
            fields.iter().all(|(key, value)| match key.as_str() {
                "threadId" | "history" | "model" | "excludeTurns" => true,
                "cwd" => {
                    value.is_null()
                        || value
                            .as_str()
                            .is_some_and(|path| path.starts_with('/') && opaque(path))
                }
                "path" => value.is_null() || value.as_str().is_some_and(opaque),
                "modelProvider" | "serviceTier" | "personality" => {
                    value.is_null() || value.as_str().is_some_and(opaque)
                }
                "baseInstructions" | "developerInstructions" => {
                    value.as_str().is_some_and(|text| text.len() <= 256 * 1024)
                }
                "config" => valid_resume_config(value),
                _ => false,
            })
        })
}

fn checked_response(
    method: &str,
    thread_id: Option<&str>,
    turn_id: Option<&str>,
    body: Value,
) -> ServiceResult<Value> {
    match method {
        "thread/name/set" if body.is_object() => Ok(body),
        "thread/read" | "thread/resume"
            if thread_id.is_some() && body["thread"]["id"].as_str() == thread_id =>
        {
            Ok(body)
        }
        "thread/turns/list" | "thread/items/list"
            if body["data"].as_array().is_some_and(|items| {
                items.iter().all(|entry| {
                    if let Some(item) = entry.get("item") {
                        return method == "thread/items/list"
                            && turn_id.is_some()
                            && entry["turnId"].as_str() == turn_id
                            && item["id"].as_str().is_some_and(opaque);
                    }
                    entry["id"].as_str().is_some_and(opaque)
                })
            }) && ["nextCursor", "backwardsCursor"].iter().all(|key| {
                body.get(key)
                    .is_none_or(|value| value.is_null() || value.as_str().is_some_and(opaque))
            }) =>
        {
            Ok(body)
        }
        "config/read" if body["config"].is_object() => Ok(json!({"config": {
            "personality": body["config"]["personality"].as_str(),
            "model_personality": body["config"]["model_personality"].as_str(),
        }})),
        "configRequirements/read"
            if body
                .get("requirements")
                .is_some_and(|value| value.is_null() || value.is_object()) =>
        {
            Ok(json!({
                "requirements": if body["requirements"].is_null() { Value::Null } else { json!({"featureRequirements": {
                    "fast_mode": body["requirements"]["featureRequirements"]["fast_mode"].as_bool(),
                    "ultrafast_mode": body["requirements"]["featureRequirements"]["ultrafast_mode"].as_bool(),
                }}) },
                "supportsIndependentSpeedModes": body["supportsIndependentSpeedModes"].as_bool(),
            }))
        }
        _ => Err(failure("invalid_response", "Invalid cloud thread response")),
    }
}

impl ChatgptService {
    pub(crate) async fn durable_thread<F, Fut>(
        &self,
        request: DurableThreadRequest,
        profile: CloudProfile,
        call: F,
        notify: Notify,
    ) -> ServiceResult<DurableModelsResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let wire = request.operation.wire()?;
        let method = wire.method;
        let thread_id = wire.params["threadId"].as_str().map(str::to_owned);
        let turn_id = wire.params["turnId"].as_str().map(str::to_owned);
        let mut response = self
            .durable_call_with(
                request.request_id,
                request.expected_identity,
                profile,
                call,
                |config, cancel| self.durable.request(config, wire, cancel, notify),
            )
            .await?;
        response.body = checked_response(
            method,
            thread_id.as_deref(),
            turn_id.as_deref(),
            response.body,
        )?;
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durable_thread_requests_match_fixed_wire_and_preserve_null_tier() {
        let turns = Operation::Turns {
            thread_id: "thread-A".into(),
            cursor: None,
            limit: 5,
        }
        .wire()
        .unwrap();
        assert_eq!(turns.method, "thread/turns/list");
        assert_eq!(
            turns.params,
            json!({"threadId":"thread-A","cursor":null,"limit":5,"itemsView":"notLoaded","sortDirection":"desc"})
        );
        let items = Operation::Items {
            thread_id: "thread-A".into(),
            turn_id: "turn-A".into(),
            cursor: None,
            limit: 98,
        }
        .wire()
        .unwrap();
        assert_eq!(items.method, "thread/items/list");
        assert_eq!(
            items.params,
            json!({"threadId":"thread-A","turnId":"turn-A","cursor":null,"limit":98,"sortDirection":"desc"})
        );
        let resume = json!({"threadId":"thread-A","history":null,"model":null,"serviceTier":null,"excludeTurns":true,"cwd":"/workspace/server"});
        assert_eq!(
            Operation::Resume {
                params: resume.clone(),
                timeout_seconds: Some(480),
            }
            .wire()
            .unwrap()
            .params,
            resume
        );
        assert_eq!(
            Operation::Preferences.wire().unwrap().params,
            json!({"cwd":null,"includeLayers":true})
        );
        assert!(Operation::Requirements.wire().unwrap().params.is_null());
    }

    #[test]
    fn durable_thread_rejects_unknown_operations_local_overrides_and_wrong_thread() {
        assert!(serde_json::from_value::<Operation>(json!({"kind":"turn/start"})).is_err());
        assert!(serde_json::from_value::<Operation>(
            json!({"kind":"read","threadId":"thread-A","includeTurns":true})
        )
        .is_err());
        for (key, value) in [
            ("cwd", json!("D:/local")),
            ("sandbox", json!("danger-full-access")),
            ("config", json!({"features":{"guardianv2":true}})),
        ] {
            let mut resume =
                json!({"threadId":"thread-A","history":null,"model":null,"excludeTurns":true});
            resume[key] = value;
            assert!(Operation::Resume {
                params: resume,
                timeout_seconds: None
            }
            .wire()
            .is_err());
        }
        assert!(checked_response(
            "thread/resume",
            Some("thread-A"),
            None,
            json!({"thread":{"id":"thread-B"}})
        )
        .is_err());
        let wrapped = json!({"data":[{"turnId":"turn-A","item":{"id":"item-A"}},{"id":"item-B"}],"nextCursor":null});
        assert!(checked_response(
            "thread/items/list",
            Some("thread-A"),
            Some("turn-A"),
            wrapped.clone()
        )
        .is_ok());
        assert!(checked_response(
            "thread/items/list",
            Some("thread-A"),
            Some("turn-B"),
            wrapped
        )
        .is_err());
        let settings = checked_response(
            "config/read",
            None,
            None,
            json!({"config":{"personality":"friendly","token":"private"},"layers":[{}]}),
        )
        .unwrap();
        assert_eq!(
            settings,
            json!({"config":{"personality":"friendly","model_personality":null}})
        );
    }
}
