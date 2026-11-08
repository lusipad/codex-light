use crate::automation_tool;
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    io::{self, BufRead, Read, Write},
    path::Path,
};

pub const ARGUMENT: &str = "--schedule-mcp";
const SERVER: &str = "codex_native_schedule";
const TOOL: &str = "automation_update";
const TOKEN_ENV: &str = "CODEX_NATIVE_SCHEDULE_TOKEN";
const MAX_FRAME: u64 = 128 * 1024;
const MAX_PENDING: usize = 16;

pub(crate) fn attach(params: &mut Map<String, Value>, executable: &Path, token: &str) {
    let key = format!("mcp_servers.{SERVER}");
    let config = params.entry("config").or_insert_with(|| json!({}));
    if config.is_null() {
        *config = json!({});
    }
    let Some(config) = config.as_object_mut() else { return };
    if config.contains_key(&key) || config.get("mcp_servers").is_some_and(|servers| servers.get(SERVER).is_some()) {
        return;
    }
    config.insert(key, json!({
        "command":executable, "args":[ARGUMENT], "env":{TOKEN_ENV:token},
        "enabled_tools":[TOOL], "tools":{TOOL:{"approval_mode":"approve"}}
    }));
}

pub(crate) fn is_schedule_elicitation(method: &str, params: &Value) -> bool {
    method == "mcpServer/elicitation/request" && params["serverName"] == SERVER &&
        params.pointer("/_meta/codex_native_schedule").is_some()
}

pub(crate) fn proposal(params: &Value, token: &str) -> Result<Value, String> {
    let draft = &params["_meta"]["codex_native_schedule"];
    if token.is_empty() || draft["token"] != token || params["mode"] != "form" ||
        params["threadId"] != draft["threadId"] || params["turnId"] != draft["turnId"]
    {
        return Err("Unverified scheduling request".into());
    }
    let result = json!({
        "threadId":draft["threadId"], "turnId":draft["turnId"], "callId":draft["callId"],
        "arguments":draft["arguments"], "scheduleTransport":"mcp"
    });
    automation_tool::validate(&result)?;
    Ok(result)
}

fn tool_call(params: &Value, token: &str) -> Result<Value, String> {
    let meta = &params["_meta"];
    let turn = &meta["x-codex-turn-metadata"];
    if params["name"] != TOOL || meta["threadId"] != turn["thread_id"] {
        return Err("This task requires a tool call from its own local chat turn".into());
    }
    let mut draft = json!({
        "threadId":turn["thread_id"], "turnId":turn["turn_id"], "callId":meta["callId"],
        "arguments":params["arguments"],
    });
    automation_tool::validate(&draft)?;
    draft["token"] = json!(token);
    Ok(json!({
        "mode":"form", "message":"Create the recurring task in this chat?",
        "requestedSchema":{"type":"object","properties":{"receipt":{"type":"string"}}},
        "_meta":{"codex_native_schedule":draft}
    }))
}

fn tool_result(id: &Value, error: bool, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":{"isError":error,"content":[{"type":"text","text":message}]}})
}

pub fn run_stdio() {
    let Ok(token) = std::env::var(TOKEN_ENV) else { return };
    if uuid::Uuid::parse_str(&token).is_err() {
        return;
    }
    let _ = serve(io::stdin().lock(), io::stdout().lock(), &token);
}

fn serve(mut reader: impl BufRead, mut writer: impl Write, token: &str) -> io::Result<()> {
    let mut buffer = Vec::new();
    let mut pending = HashMap::new();
    let mut serial = 0u64;
    loop {
        buffer.clear();
        let size = reader.by_ref().take(MAX_FRAME).read_until(b'\n', &mut buffer)?;
        if size == 0 || !buffer.ends_with(b"\n") {
            return Ok(());
        }
        let Ok(message) = serde_json::from_slice::<Value>(&buffer) else { continue };
        if message["method"] == "notifications/cancelled" {
            if let Some(key) = pending.iter().find_map(|(key, id): (&String, &Value)|
                (id == &message["params"]["requestId"]).then(|| key.clone()))
            {
                pending.remove(&key);
                serde_json::to_writer(&mut writer, &json!({
                    "jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":key}
                }))?;
                writer.write_all(b"\n")?;
                writer.flush()?;
            }
            continue;
        }
        let id = &message["id"];
        if !id.is_string() && !id.is_number() {
            continue;
        }
        let response = match message["method"].as_str() {
            Some("initialize") => json!({"jsonrpc":"2.0","id":id,"result":{
                "protocolVersion":message["params"]["protocolVersion"],"capabilities":{"tools":{}},
                "serverInfo":{"name":SERVER,"version":env!("CARGO_PKG_VERSION")}
            }}),
            Some("ping") => json!({"jsonrpc":"2.0","id":id,"result":{}}),
            Some("tools/list") => {
                let mut spec = automation_tool::spec();
                spec.as_object_mut().unwrap().remove("type");
                json!({"jsonrpc":"2.0","id":id,"result":{"tools":[spec]}})
            }
            Some("tools/call") if pending.len() < MAX_PENDING => {
                match tool_call(&message["params"], token) {
                    Ok(draft) => {
                        serial += 1;
                        let key = format!("schedule-{serial}");
                        pending.insert(key.clone(), id.clone());
                        json!({"jsonrpc":"2.0","id":key,"method":"elicitation/create","params":draft})
                    }
                    Err(error) => tool_result(id, true, &error),
                }
            }
            Some("tools/call") => tool_result(id, true, "Too many pending scheduling requests"),
            None => {
                let Some(id) = id.as_str().and_then(|key| pending.remove(key)) else { continue };
                let result = &message["result"];
                let receipt = result["content"]["receipt"].as_str().filter(|_| result["action"] == "accept");
                tool_result(&id, receipt.is_none(), receipt.unwrap_or("Scheduling was declined or could not be saved."))
            }
            _ => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
        };
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Value {
        let thread = "2ceaf823-ed8f-4a9e-b740-1431c10b24ac";
        json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{
            "name":TOOL,"_meta":{"threadId":thread,"callId":"fixture-call",
                "x-codex-turn-metadata":{"thread_id":thread,"turn_id":"fixture-turn"}},
            "arguments":{"mode":"create","kind":"heartbeat","destination":"thread","name":"Fixture",
                "prompt":"Private fixture","rrule":"FREQ=MINUTELY;INTERVAL=30","status":"PAUSED"}
        }})
    }

    #[test]
    fn injects_one_stdio_server_without_replacing_user_settings() {
        let mut params = Map::new();
        params.insert("config".into(), json!({"model_reasoning_effort":"low"}));
        attach(&mut params, Path::new("fixture.exe"), "fixture-token");
        let config = &params["config"];
        assert_eq!(config["model_reasoning_effort"], "low");
        let server = &config["mcp_servers.codex_native_schedule"];
        assert_eq!(server["env"]["CODEX_NATIVE_SCHEDULE_TOKEN"], "fixture-token");
        assert_eq!(server["tools"]["automation_update"]["approval_mode"], "approve");
        let copy = params.clone();
        attach(&mut params, Path::new("other.exe"), "other");
        assert_eq!(params, copy);
    }

    #[test]
    fn requires_a_real_turn_and_strips_token_before_display() {
        let request = request();
        let elicitation = tool_call(&request["params"], "fixture-token").unwrap();
        let mut wire = elicitation;
        wire["threadId"] = request["params"]["_meta"]["threadId"].clone();
        wire["turnId"] = json!("fixture-turn");
        wire["serverName"] = json!(SERVER);
        assert!(is_schedule_elicitation("mcpServer/elicitation/request", &wire));
        assert!(proposal(&wire, "wrong").is_err());
        let normalized = proposal(&wire, "fixture-token").unwrap();
        assert_eq!(normalized["scheduleTransport"], "mcp");
        assert_eq!(normalized["arguments"]["name"], "Fixture");
        assert!(!normalized.to_string().contains("fixture-token"));
        wire["turnId"] = json!("different");
        assert!(proposal(&wire, "fixture-token").is_err());
        let mut direct = request;
        direct["params"]["_meta"] = json!({"threadId":"fixture"});
        assert!(tool_call(&direct["params"], "fixture-token").is_err());
    }

    #[test]
    fn stdio_returns_only_the_hosts_approved_receipt() {
        let request = request();
        let accepted = json!({"id":"schedule-1","result":{"action":"accept","content":{"receipt":"fixture-id"}}});
        let input = format!("{request}\n{accepted}\n");
        let mut output = Vec::new();
        serve(input.as_bytes(), &mut output, "fixture-token").unwrap();
        let messages: Vec<Value> = String::from_utf8(output).unwrap().lines()
            .map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(messages[0]["method"], "elicitation/create");
        assert_eq!(messages[1]["id"], 8);
        assert_eq!(messages[1]["result"]["isError"], false);
        assert_eq!(messages[1]["result"]["content"][0]["text"], "fixture-id");
    }

    #[test]
    fn cancelling_a_tool_call_cancels_its_nested_confirmation() {
        let request = request();
        let cancel = json!({"method":"notifications/cancelled","params":{"requestId":8}});
        let late = json!({"id":"schedule-1","result":{"action":"accept","content":{"receipt":"late"}}});
        let input = format!("{request}\n{cancel}\n{late}\n");
        let mut output = Vec::new();
        serve(input.as_bytes(), &mut output, "fixture-token").unwrap();
        let messages: Vec<Value> = String::from_utf8(output).unwrap().lines()
            .map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["method"], "notifications/cancelled");
        assert_eq!(messages[1]["params"]["requestId"], messages[0]["id"]);
    }
}
