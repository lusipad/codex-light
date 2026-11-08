use super::{
    failure, ChatgptService, CloudProfile, DurableModelsResponse, ServiceIdentity, ServiceResult,
};
use crate::durable::{ConnectionConfig, Error as DurableError, Notify, Request};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

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
    StartSavedEnvironment {
        environment_config_id: String,
        model: Option<String>,
        effort: Option<String>,
        service_tier: Option<String>,
    },
    Read {
        thread_id: String,
    },
    List {
        cursor: Option<String>,
    },
    Resume {
        params: Value,
        timeout_seconds: Option<u16>,
    },
    Title {
        thread_id: String,
        name: String,
    },
    Archive {
        thread_id: String,
        archived: bool,
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
    StartRepositoryApply {
        thread_id: String,
        client_user_message_id: uuid::Uuid,
        service_tier: Option<String>,
        added: Vec<String>,
        removed: Vec<String>,
    },
    StartEnvironmentSetup {
        thread_id: String,
        client_user_message_id: uuid::Uuid,
        cwd: String,
        service_tier: Option<String>,
        model: Option<String>,
        effort: Option<String>,
        repositories: Vec<SetupRepository>,
        skill: Option<String>,
        private_draft: bool,
    },
    StartEnvironmentReply {
        thread_id: String,
        client_user_message_id: uuid::Uuid,
        cwd: String,
        text: String,
        service_tier: Option<String>,
        model: Option<String>,
        effort: Option<String>,
    },
    Preferences,
    SetupPreferences,
    Requirements,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SetupRepository {
    name: String,
    #[serde(rename = "ref")]
    reference: String,
}

fn opaque(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 2048 && !value.chars().any(char::is_control)
}

fn saved_environment_id(value: &str) -> bool {
    let segment = |value: &str| {
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    };
    let (prefix, config) = value
        .split_once('~')
        .map_or((None, value), |(prefix, config)| (Some(prefix), config));
    value.len() <= 512
        && prefix.is_none_or(segment)
        && config.strip_prefix("asenvcfg_").is_some_and(segment)
}

fn repository_apply_text(added: &[String], removed: &[String]) -> ServiceResult<String> {
    if added.len() > 16
        || removed.len() > 16
        || (added.is_empty() && removed.is_empty())
        || !added.iter().chain(removed).all(|name| opaque(name))
    {
        return Err(failure(
            "invalid_request",
            "Invalid cloud repository changes",
        ));
    }
    Ok(format!(
        "I saved repository changes for this environment. Added: {}. Removed: {}. Apply the latest saved repository configuration to this workspace: clone newly added repositories that are still selected, and remove checkouts for repositories that are still removed only if they have no uncommitted or unpushed work. Preserve local work and report anything you could not apply. Do not change the saved repository selection.",
        json!(added), json!(removed)
    ))
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
            Self::StartSavedEnvironment {
                environment_config_id,
                model,
                effort,
                service_tier,
            } if saved_environment_id(&environment_config_id)
                && [model.as_deref(), effort.as_deref(), service_tier.as_deref()]
                    .into_iter()
                    .flatten()
                    .all(opaque) =>
            {
                let mut config = json!({"features.mcp_app_ui":true});
                if let Some(effort) = effort {
                    config["model_reasoning_effort"] = json!(effort);
                }
                (
                    "thread/start",
                    json!({
                        "environments":[{"environmentConfigId":environment_config_id}],
                        "deferredEnvironment":true,"pluginsMcp":{"productSku":"codex"},
                        "ephemeral":false,"model":model,"serviceTier":service_tier,"config":config,
                    }),
                    30,
                )
            }
            Self::Read { thread_id } if opaque(&thread_id) => (
                "thread/read",
                json!({"threadId":thread_id,"includeTurns":false}),
                30,
            ),
            Self::List { cursor } if cursor.as_deref().is_none_or(opaque) => (
                "thread/list",
                json!({"cursor":cursor,"limit":100,"archived":false,"useStateDbOnly":true,"sortKey":"updated_at"}),
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
            Self::Archive { thread_id, archived } if opaque(&thread_id) => (
                if archived { "thread/archive" } else { "thread/unarchive" },
                json!({"threadId":thread_id}),
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
            Self::SetupPreferences => {
                ("config/read", json!({"cwd":null,"includeLayers":false}), 30)
            }
            Self::Requirements => ("configRequirements/read", Value::Null, 30),
            Self::StartEnvironmentReply {
                thread_id,
                client_user_message_id,
                cwd,
                text,
                service_tier,
                model,
                effort,
            } if opaque(&thread_id)
                && !client_user_message_id.is_nil()
                && cwd.starts_with('/')
                && opaque(&cwd)
                && !text.trim().is_empty()
                && !text.contains('\0')
                && text.encode_utf16().count() <= 32768
                && [service_tier.as_deref(), model.as_deref(), effort.as_deref()]
                    .into_iter()
                    .flatten()
                    .all(opaque) =>
            {
                (
                    "turn/start",
                    json!({
                        "threadId":thread_id,"clientUserMessageId":client_user_message_id.to_string(),
                        "cwd":cwd,"turnTrigger":"composer","model":model,"effort":effort,
                        "serviceTier":service_tier,"collaborationMode":null,
                        "input":[{"type":"text","text":text,"text_elements":[]}]
                    }),
                    30,
                )
            }
            Self::StartRepositoryApply {
                thread_id,
                client_user_message_id,
                service_tier,
                added,
                removed,
            } if opaque(&thread_id)
                && !client_user_message_id.is_nil()
                && service_tier.as_deref().is_none_or(opaque) =>
            {
                (
                    "turn/start",
                    json!({
                        "threadId":thread_id,
                        "clientUserMessageId":client_user_message_id.to_string(),
                        "cwd":"/workspace","turnTrigger":"environment_onboarding",
                        "model":null,"effort":null,"serviceTier":service_tier,"collaborationMode":null,
                        "input":[{"type":"text","text":repository_apply_text(&added,&removed)?,"text_elements":[]}]
                    }),
                    30,
                )
            }
            Self::StartEnvironmentSetup {
                thread_id,
                client_user_message_id,
                cwd,
                service_tier,
                model,
                effort,
                repositories,
                skill,
                private_draft,
            } if opaque(&thread_id)
                && !client_user_message_id.is_nil()
                && cwd.starts_with('/')
                && opaque(&cwd)
                && [
                    service_tier.as_deref(),
                    model.as_deref(),
                    effort.as_deref(),
                    skill.as_deref(),
                ]
                .into_iter()
                .flatten()
                .all(opaque)
                && skill
                    .as_deref()
                    .is_none_or(|skill| !skill.chars().any(char::is_whitespace))
                && repositories.len() <= 100
                && repositories
                    .iter()
                    .all(|repo| opaque(&repo.name) && opaque(&repo.reference)) =>
            {
                let context = format!("{}\n\n## My request:", json!({"repositories":repositories}));
                if context.len() > 256 * 1024 {
                    return Err(failure(
                        "invalid_request",
                        "Environment setup input exceeds transport limit",
                    ));
                }
                let skill = skill
                    .as_deref()
                    .or(private_draft.then_some("cloud-environment-onboarding:setup"));
                let prompt = match skill {
                    Some(skill) => format!("使用 ${skill} 来设置此云环境"),
                    None => {
                        "先问我想运行什么，并和我讨论必要的细节。等我回复后，再开始设置这个云环境。"
                            .into()
                    }
                };
                (
                    "turn/start",
                    json!({
                        "threadId":thread_id,"clientUserMessageId":client_user_message_id.to_string(),
                        "cwd":cwd,"turnTrigger":"environment_onboarding","model":model,"effort":effort,
                        "serviceTier":service_tier,"collaborationMode":null,
                        "input":[{"type":"text","text":context,"text_elements":[]},{"type":"text","text":prompt,"text_elements":[]}]
                    }),
                    30,
                )
            }
            _ => return Err(failure("invalid_request", "Invalid cloud thread operation")),
        };
        Ok(Request {
            method,
            params,
            timeout: Duration::from_secs(seconds),
        })
    }
}

fn apply_unconfirmed() -> super::ServiceError {
    failure(
        "cloud_repository_apply_unconfirmed",
        "Cloud repository message delivery is unconfirmed",
    )
}

fn thread_start_unconfirmed() -> super::ServiceError {
    failure(
        "cloud_thread_start_unconfirmed",
        "Cloud thread creation is unconfirmed",
    )
}

fn checked_saved_thread(body: Value, config_id: &str) -> ServiceResult<Value> {
    let thread = &body["thread"];
    let id = thread["id"]
        .as_str()
        .filter(|id| opaque(id))
        .ok_or_else(thread_start_unconfirmed)?;
    let matches = |entry: &Value| {
        entry
            .get("environmentConfigId")
            .is_none_or(|value| value.is_null() || value.as_str() == Some(config_id))
    };
    if !matches(&body)
        || !matches(thread)
        || !thread["environments"].is_null()
            && !thread["environments"].as_array().is_some_and(|entries| {
                entries
                    .iter()
                    .all(|entry| entry.is_object() && matches(entry))
            })
    {
        return Err(thread_start_unconfirmed());
    }
    Ok(json!({"thread":{"id":id}}))
}

fn checked_start_response(
    thread_id: Option<&str>,
    message_id: Option<&str>,
    body: Value,
    unconfirmed: impl Fn() -> super::ServiceError,
) -> ServiceResult<Value> {
    let turn = &body["turn"];
    let id = turn["id"]
        .as_str()
        .filter(|id| opaque(id))
        .ok_or_else(&unconfirmed)?;
    if [
        (&body, "threadId", thread_id),
        (turn, "threadId", thread_id),
        (&body, "clientUserMessageId", message_id),
        (turn, "clientUserMessageId", message_id),
    ]
    .into_iter()
    .any(|(value, key, expected)| {
        value
            .get(key)
            .is_some_and(|field| !field.is_null() && field.as_str() != expected)
    }) {
        return Err(unconfirmed());
    }
    Ok(json!({"turn":{"id":id}}))
}

fn setup_preferences(body: Value) -> ServiceResult<Value> {
    let config = &body["config"];
    if !config.is_object() {
        return Err(failure(
            "invalid_response",
            "Invalid cloud setup preferences",
        ));
    }
    let active = config["profile"]
        .as_str()
        .and_then(|name| config["profiles"].get(name));
    let text = |key: &str| {
        active
            .and_then(|profile| profile.get(key))
            .filter(|value| !value.is_null())
            .unwrap_or(&config[key])
            .as_str()
            .filter(|value| opaque(value))
    };
    Ok(json!({"config":{
        "model":text("model"),"model_reasoning_effort":text("model_reasoning_effort"),"service_tier":text("service_tier")
    }}))
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
        "thread/archive" | "thread/unarchive"
            if body.as_object().is_some_and(|fields| fields.is_empty()) =>
        {
            Ok(body)
        }
        "thread/read" | "thread/resume"
            if thread_id.is_some() && body["thread"]["id"].as_str() == thread_id =>
        {
            Ok(body)
        }
        "thread/list"
            if body["data"].as_array().is_some_and(|items| {
                items.len() <= 100
                    && items
                        .iter()
                        .all(|entry| entry["id"].as_str().is_some_and(opaque))
            }) && (body["nextCursor"].is_null()
                || body["nextCursor"].as_str().is_some_and(opaque)) =>
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
        self.durable_thread_with(request, profile, call, |config, wire, cancel| {
            self.durable.request(config, wire, cancel, notify)
        })
        .await
    }

    pub(super) async fn durable_thread_with<F, Fut, Run, RunFuture>(
        &self,
        request: DurableThreadRequest,
        profile: CloudProfile,
        call: F,
        run: Run,
    ) -> ServiceResult<DurableModelsResponse>
    where
        F: Fn(&'static str, Value) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
        Run: FnOnce(ConnectionConfig, Request, Arc<AtomicBool>) -> RunFuture,
        RunFuture: Future<Output = Result<Value, DurableError>>,
    {
        let setup_write = matches!(&request.operation, Operation::StartEnvironmentSetup { .. });
        let reply_write = matches!(&request.operation, Operation::StartEnvironmentReply { .. });
        let setup_config = matches!(&request.operation, Operation::SetupPreferences);
        let wire = request.operation.wire()?;
        let method = wire.method;
        let thread_id = wire.params["threadId"].as_str().map(str::to_owned);
        let turn_id = wire.params["turnId"].as_str().map(str::to_owned);
        let message_id = wire.params["clientUserMessageId"]
            .as_str()
            .map(str::to_owned);
        let turn_write = method == "turn/start";
        let saved_config_id = wire
            .params
            .pointer("/environments/0/environmentConfigId")
            .and_then(Value::as_str)
            .filter(|_| method == "thread/start")
            .map(str::to_owned);
        let unconfirmed = || {
            if saved_config_id.is_some() {
                thread_start_unconfirmed()
            } else if reply_write {
                failure(
                    "cloud_setup_reply_unconfirmed",
                    "Cloud environment reply delivery is unconfirmed",
                )
            } else if setup_write {
                failure(
                    "cloud_setup_turn_unconfirmed",
                    "Cloud environment setup turn delivery is unconfirmed",
                )
            } else {
                apply_unconfirmed()
            }
        };
        let handed_off = AtomicBool::new(false);
        let mut response = self
            .durable_call_with(
                request.request_id,
                request.expected_identity,
                profile,
                call,
                |config, cancel| {
                    handed_off.store(true, Ordering::SeqCst);
                    run(config, wire, cancel)
                },
            )
            .await
            .map_err(|error| {
                if (turn_write || saved_config_id.is_some())
                    && handed_off.load(Ordering::SeqCst)
                    && error.code != "account_changed"
                {
                    unconfirmed()
                } else {
                    error
                }
            })?;
        response.body = if let Some(config_id) = saved_config_id.as_deref() {
            checked_saved_thread(response.body, config_id)?
        } else if turn_write {
            checked_start_response(
                thread_id.as_deref(),
                message_id.as_deref(),
                response.body,
                unconfirmed,
            )?
        } else if setup_config {
            setup_preferences(response.body)?
        } else {
            checked_response(
                method,
                thread_id.as_deref(),
                turn_id.as_deref(),
                response.body,
            )?
        };
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_archive_toggles_only_the_durable_thread_id() {
        for (archived, method) in [(true, "thread/archive"), (false, "thread/unarchive")] {
            let operation: Operation = serde_json::from_value(json!({
                "kind":"archive","threadId":"cloud-thread","archived":archived
            })).unwrap();
            let request = operation.wire().unwrap();
            assert_eq!(request.method, method);
            assert_eq!(request.params, json!({"threadId":"cloud-thread"}));
            assert!(checked_response(method, Some("cloud-thread"), None, json!({})).is_ok());
            assert!(checked_response(method, Some("cloud-thread"), None, Value::Null).is_err());
            assert!(checked_response(method, Some("cloud-thread"), None, json!({"error":true})).is_err());
        }
        assert!(serde_json::from_value::<Operation>(json!({
            "kind":"archive","threadId":"cloud-thread","archived":true,"cwd":"C:/local"
        })).is_err());
        assert!(Operation::Archive { thread_id: " ".to_owned(), archived: true }.wire().is_err());
    }

    #[test]
    fn cloud_catalog_keeps_read_only_wire_and_cursor() {
        for cursor in [Value::Null, json!("page-token")] {
            let operation: Operation =
                serde_json::from_value(json!({"kind":"list","cursor":cursor})).unwrap();
            let request = operation.wire().unwrap();
            assert_eq!(request.method, "thread/list");
            assert_eq!(
                request.params,
                json!({"cursor":cursor,"limit":100,"archived":false,"useStateDbOnly":true,"sortKey":"updated_at"})
            );
        }
        assert!(serde_json::from_value::<Operation>(
            json!({"kind":"list","cursor":null,"cwd":"C:/project"})
        )
        .is_err());
        let invalid: Operation =
            serde_json::from_value(json!({"kind":"list","cursor":"\n"})).unwrap();
        assert!(invalid.wire().is_err());
    }

    #[test]
    fn cloud_catalog_validates_page_and_preserves_environment_metadata() {
        let page = json!({"data":[{"id":"thread-1","environments":[
            {"environmentConfigId":"asenvcfg_sample","environmentId":"environment-1"}
        ]}],"nextCursor":"next"});
        assert_eq!(
            checked_response("thread/list", None, None, page.clone()).unwrap(),
            page
        );
        for invalid in [
            json!({"data":[{"id":""}]}),
            json!({"data":{},"nextCursor":null}),
            json!({"data":[],"nextCursor":123}),
            json!({"data":vec![json!({"id":"valid"}); 101]}),
        ] {
            assert!(checked_response("thread/list", None, None, invalid).is_err());
        }
    }

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
