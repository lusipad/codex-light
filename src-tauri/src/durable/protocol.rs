use super::{Error, Result};
use base64::Engine;
use serde_json::{json, Value};

const BUNDLE_ID: &str = "com.codex.native.tauri";

pub(super) enum Packet { ServerRequest, Notification, Response }

pub(super) fn initialize() -> Value {
    json!({
        "id":"__codex_initialize__",
        "method":"initialize",
        "params":{
            "clientInfo":{"name":"codex-tauri-native","title":"Codex Light","version":env!("CARGO_PKG_VERSION")},
            "capabilities":serde_json::from_str::<Value>(include_str!("capabilities.json")).expect("bundled initialize capabilities")
        }
    })
}

pub(super) fn response_id(message: &Value) -> Result<String> {
    match message.get("id") {
        Some(Value::String(id)) => Ok(id.clone()),
        Some(Value::Number(id)) if id.is_i64() || id.is_u64() => Ok(id.to_string()),
        _ => Err(Error::Protocol),
    }
}

pub(super) fn classify(message: &Value) -> Result<Packet> {
    if !message.is_object() { return Err(Error::Protocol); }
    if let Some(method) = message.get("method") {
        if !method.as_str().is_some_and(|method| !method.is_empty()) || message.get("result").is_some() || message.get("error").is_some() {
            return Err(Error::Protocol);
        }
        if message.get("id").is_some() { response_id(message)?; Ok(Packet::ServerRequest) } else { Ok(Packet::Notification) }
    } else {
        response_id(message)?;
        if message.get("result").is_some() == message.get("error").is_some() { return Err(Error::Protocol); }
        Ok(Packet::Response)
    }
}

pub(super) fn result(message: &Value) -> Result<Value> {
    if let Some(error) = message.get("error") {
        return Err(Error::Remote(error.get("code").and_then(Value::as_i64).ok_or(Error::Protocol)?));
    }
    message.get("result").cloned().ok_or(Error::Protocol)
}

fn unavailable_attestation(bundle: &str) -> String {
    let mut bytes = vec![0xa2, 0x6a];
    bytes.extend_from_slice(b"error_code");
    bytes.extend_from_slice(&[1, 0x69]);
    bytes.extend_from_slice(b"bundle_id");
    if bundle.len() < 24 { bytes.push(0x60 + bundle.len() as u8); }
    else { bytes.extend_from_slice(&[0x78, bundle.len() as u8]); }
    bytes.extend_from_slice(bundle.as_bytes());
    format!("v1.{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

pub(super) fn server_response(message: &Value) -> Result<Value> {
    response_id(message)?;
    if message["method"] == "attestation/generate" {
        Ok(json!({"id":message["id"],"result":{"token":unavailable_attestation(BUNDLE_ID)}}))
    } else {
        Ok(json!({"id":message["id"],"error":{"code":-32601,"message":"This cloud host request is not supported"}}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_unavailable_attestation_uses_the_fixed_source_cbor_shape() {
        let encoded = unavailable_attestation("fixture-bundle");
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded.strip_prefix("v1.").unwrap()).unwrap();
        let expected = [vec![0xa2, 0x6a], b"error_code".to_vec(), vec![1, 0x69], b"bundle_id".to_vec(), vec![0x6e], b"fixture-bundle".to_vec()].concat();
        assert_eq!(decoded, expected);
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], BUNDLE_ID);
        let response = server_response(&json!({"id":17,"method":"attestation/generate"})).unwrap();
        assert_eq!(response["id"], 17);
        assert!(response["result"]["token"].as_str().unwrap().starts_with("v1."));
        assert!(response.get("error").is_none());
    }

    #[test]
    fn initialize_and_server_requests_do_not_claim_successful_tool_execution() {
        let request = initialize();
        assert_eq!(request["id"], "__codex_initialize__");
        assert_eq!(request["params"]["capabilities"]["requestAttestation"], true);
        assert!(request.get("jsonrpc").is_none());
        let response = server_response(&json!({"id":"tool","method":"item/tool/call"})).unwrap();
        assert!(response.get("result").is_none());
        assert_eq!(response["error"]["code"], -32601);
    }

    #[test]
    fn malformed_envelopes_cannot_become_notifications_or_successful_replies() {
        for message in [json!(null), json!([]), json!({"id":1}), json!({"id":null,"result":{}}),
            json!({"id":1,"result":{},"error":{}}), json!({"method":"","params":{}}), json!({"method":"tool","result":{}})] {
            assert!(classify(&message).is_err(), "{message}");
        }
        assert_eq!(response_id(&json!({"id":42})).unwrap(), "42");
        assert_eq!(result(&json!({"id":1,"error":{"code":-32001,"message":"private diagnostic"}})), Err(Error::Remote(-32001)));
    }
}
