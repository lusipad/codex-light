use crate::{automations, config_skills::AutomationItem, notification_audio::sha256};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, io, path::Path};

pub(crate) const APPROVAL_METHOD: &str = "codex-native/schedule/requestApproval";
const TOOL: &str = "automation_update";
const NAMESPACE: &str = "codex_native";

pub(crate) fn spec() -> Value {
    json!({
        "type":"function", "name":TOOL,
        "description":"Request user approval to schedule a recurring follow-up in this local chat. Use only when requested by the user. Use a plain RRULE, for example FREQ=MINUTELY;INTERVAL=30.",
        "inputSchema":{
            "type":"object", "additionalProperties":false,
            "properties":{
                "mode":{"const":"create"}, "kind":{"const":"heartbeat"}, "destination":{"const":"thread"},
                "name":{"type":"string"}, "prompt":{"type":"string"}, "rrule":{"type":"string"},
                "status":{"enum":["ACTIVE","PAUSED"]}
            },
            "required":["mode","kind","destination","name","prompt","rrule"]
        }
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    mode: String,
    kind: String,
    destination: String,
    name: String,
    prompt: String,
    rrule: String,
    status: Option<String>,
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.contains('\0')
}

pub(crate) fn matches_tool(method: &str, params: &Value) -> bool {
    method == "item/tool/call" && params["tool"] == TOOL && params["namespace"] == NAMESPACE
}

fn task_from_request(params: &Value) -> Result<AutomationItem, String> {
    let text = |key| params[key].as_str().filter(|value| bounded_text(value, 256));
    let thread_id = text("threadId").ok_or("Missing scheduling thread")?;
    let turn_id = text("turnId").ok_or("Missing scheduling turn")?;
    let call_id = text("callId").ok_or("Missing scheduling call")?;
    if uuid::Uuid::parse_str(thread_id).is_err() {
        return Err("Scheduling requires a local chat UUID".into());
    }
    let args: Arguments = serde_json::from_value(params["arguments"].clone())
        .map_err(|_| "Invalid arguments for scheduling in this chat")?;
    let status = args.status.as_deref().unwrap_or("ACTIVE");
    if args.mode != "create" || args.kind != "heartbeat" || args.destination != "thread" ||
        !matches!(status, "ACTIVE" | "PAUSED") || !bounded_text(&args.name, 256) ||
        !bounded_text(&args.prompt, 32_768) || !bounded_text(&args.rrule, 1024)
    {
        return Err("This tool can only create a recurring task in this chat".into());
    }
    let key = sha256(json!([thread_id, turn_id, call_id]).to_string().as_bytes());
    let item = AutomationItem {
        id: format!("Automation_{}", &key[..32]),
        kind: args.kind,
        name: args.name.trim().into(),
        prompt: args.prompt.trim().into(),
        status: status.into(),
        rrule: args.rrule.trim().into(),
        cwds: Vec::new(),
        execution_environment: "local".into(),
        model: None,
        reasoning_effort: None,
        target_thread_id: Some(thread_id.into()),
        created_at: 0,
        updated_at: 0,
    };
    automations::validate_linked_schedule(&item)?;
    Ok(item)
}

pub(crate) fn validate(params: &Value) -> Result<(), String> {
    task_from_request(params).map(|_| ())
}

pub(crate) fn can_schedule_in_thread(thread_id: &str, response: &Value) -> bool {
    let thread = &response["thread"];
    thread["id"] == thread_id && thread["ephemeral"] == false &&
        thread["status"]["type"] == "active" &&
        thread["environments"].as_array().is_some_and(|environments| {
            !environments.is_empty() && environments.iter().all(|env| env["environmentId"] == "local")
        })
}

pub(crate) fn reply(success: bool, text: impl AsRef<str>) -> Value {
    json!({"success":success,"contentItems":[{"type":"inputText","text":text.as_ref()}]})
}

pub(crate) fn create(params: &Value) -> Result<Value, String> {
    create_at(&crate::state::codex_home_dir().join("automations"), params)
}

fn create_at(root: &Path, params: &Value) -> Result<Value, String> {
    let item = task_from_request(params)?;
    let document = crate::config_skills::automation_document(&item.id, &item).to_string();
    fs::create_dir_all(root).map_err(|err| err.to_string())?;
    let root = root.canonicalize().map_err(|err| err.to_string())?;
    let dir = root.join(&item.id);
    let staging = root.join(".schedule-staging");
    fs::create_dir_all(&staging).map_err(|err| err.to_string())?;
    if staging.canonicalize().ok().as_ref() != Some(&staging) {
        return Err("Unexpected schedule staging directory".into());
    }
    let temporary = staging.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&temporary).map_err(|err| err.to_string())?;
    let staged_file = temporary.join("automation.toml");
    let published = (|| {
        fs::write(&staged_file, &document)?;
        match fs::rename(&temporary, &dir) {
            Ok(()) => Ok(()),
            Err(_) if dir.is_dir() => Ok(()),
            Err(err) => Err(err),
        }
    })();
    let _ = fs::remove_file(&staged_file);
    let _ = fs::remove_dir(&temporary);
    published.map_err(|err: io::Error| err.to_string())?;
    if dir.canonicalize().ok().as_ref() != Some(&dir) {
        return Err("Unexpected schedule directory".into());
    }
    let destination = dir.join("automation.toml");
    if destination.canonicalize().ok().as_ref() != Some(&destination) {
        return Err("Unexpected schedule file".into());
    }
    let saved = crate::config_skills::parse_automation_toml(&destination)
        .ok_or("Could not read the saved task")?;
    if saved.id != item.id || saved.target_thread_id != item.target_thread_id ||
        saved.name != item.name || saved.prompt != item.prompt || saved.rrule != item.rrule ||
        saved.status != item.status || saved.kind != item.kind || saved.execution_environment != item.execution_environment
    {
        return Err("The same tool call already has a different saved task".into());
    }
    Ok(json!({"automationId":saved.id,"mode":"create","status":saved.status}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Value {
        json!({
            "threadId":"8f99d568-8aa2-4d40-a53f-f1e46a2e60ea","turnId":"fixture-turn","callId":"fixture-call",
            "tool":"automation_update","namespace":"codex_native",
            "arguments":{"mode":"create","kind":"heartbeat","destination":"thread","name":"私有巡检",
                "prompt":"Inspect private fixture","rrule":"FREQ=MINUTELY;INTERVAL=30","status":"PAUSED"}
        })
    }

    #[test]
    fn schedule_uses_transport_identity_and_rejects_unavailable_rules() {
        let mut params = request();
        assert!(matches_tool("item/tool/call", &params));
        assert!(!matches_tool("item/tool/requestUserInput", &params));
        let item = task_from_request(&params).unwrap();
        assert_eq!(item.target_thread_id.as_deref(), params["threadId"].as_str());
        assert_eq!(item.status, "PAUSED");
        params["arguments"]["targetThreadId"] = json!("another-chat");
        assert!(validate(&params).is_err());
        let mut params = request();
        params["arguments"]["rrule"] = json!("FREQ=DAILY;COUNT=1");
        assert!(validate(&params).is_err());
    }

    #[test]
    fn creation_is_idempotent_and_does_not_overwrite_a_saved_task() {
        let root = std::env::temp_dir().join(format!("schedule-{}", uuid::Uuid::new_v4()));
        let mut params = request();
        let initial = create_at(&root, &params).unwrap();
        let path = root.join(initial["automationId"].as_str().unwrap()).join("automation.toml");
        let original = fs::read(&path).unwrap();
        assert_eq!(create_at(&root, &params).unwrap(), initial);
        params["arguments"]["prompt"] = json!("Different prompt");
        assert!(create_at(&root, &params).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read_dir(&root).unwrap().filter_map(Result::ok)
            .filter(|entry| entry.path().join("automation.toml").is_file()).count(), 1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(root.join(initial["automationId"].as_str().unwrap())).unwrap();
        fs::remove_dir(root.join(".schedule-staging")).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn eligibility_requires_same_persistent_local_thread() {
        let mut response = json!({"thread":{"id":"fixture","ephemeral":false,"status":{"type":"active"},
            "environments":[{"environmentId":"local"}]}});
        assert!(can_schedule_in_thread("fixture", &response));
        assert!(!can_schedule_in_thread("other", &response));
        response["thread"]["status"]["type"] = json!("idle");
        assert!(!can_schedule_in_thread("fixture", &response));
        response["thread"]["status"]["type"] = json!("active");
        response["thread"]["ephemeral"] = json!(true);
        assert!(!can_schedule_in_thread("fixture", &response));
        response["thread"]["ephemeral"] = json!(false);
        response["thread"]["environments"][0]["environmentId"] = json!("ssh");
        assert!(!can_schedule_in_thread("fixture", &response));
    }
}
