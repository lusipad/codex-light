use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const EVENT: &str = "native-deep-link";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingLink {
    pub generation: u64,
    #[serde(flatten)]
    target: LinkTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum LinkTarget {
    Thread { thread_id: String },
    CloudEnvironmentCreate,
}

fn parse_target(value: &str) -> Option<LinkTarget> {
    if let Some((scheme, rest)) = value.split_once("://") {
        if scheme.eq_ignore_ascii_case("codex") {
            if let Some((host, path)) = rest.split_once('/') {
                if host.eq_ignore_ascii_case("cloud-environments") && path == "new" {
                    return Some(LinkTarget::CloudEnvironmentCreate);
                }
            }
        }
    }
    parse_thread_url(value).map(|thread_id| LinkTarget::Thread { thread_id })
}

/// The bare local thread URLs produced by this app. Other official routes need separate contracts.
pub fn parse_thread_url(value: &str) -> Option<String> {
    if value.len() > 4096 || value.trim() != value || value.chars().any(char::is_control) {
        return None;
    }
    let (scheme, rest) = value.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("codex") {
        return None;
    }
    let (_, path) = rest.split_once('/')?;
    // Check the raw path too: URL parsing alone normalizes dot segments.
    let id = path.strip_suffix('/').unwrap_or(path);
    let bytes = id.as_bytes();
    if bytes.len() != 36 || !bytes.iter().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) { *byte == b'-' } else { byte.is_ascii_hexdigit() }
    }) {
        return None;
    }
    let url = tauri::Url::parse(value).ok()?;
    if url.scheme() != "codex" || !url.host_str()?.eq_ignore_ascii_case("threads") ||
        !url.username().is_empty() || url.password().is_some() || url.port().is_some() ||
        url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    Some(id.to_ascii_lowercase())
}

#[derive(Default)]
struct Queue {
    generation: u64,
    pending: Option<PendingLink>,
}

#[derive(Default)]
pub struct DeepLinkState(Mutex<Queue>);

impl DeepLinkState {
    pub fn enqueue(&self, value: &str) -> bool {
        let Some(target) = parse_target(value) else { return false };
        let mut queue = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if queue.pending.as_ref().is_some_and(|pending| pending.target == target) {
            return false;
        }
        queue.generation += 1;
        queue.pending = Some(PendingLink { generation: queue.generation, target });
        true
    }

    fn peek(&self, label: &str) -> Result<Option<PendingLink>, String> {
        if label != "main" { return Err("深链接仅由主窗口接收。".into()); }
        Ok(self.0.lock().unwrap_or_else(|error| error.into_inner()).pending.clone())
    }

    fn acknowledge(&self, label: &str, generation: u64) -> Result<bool, String> {
        if label != "main" { return Err("深链接仅由主窗口接收。".into()); }
        let mut queue = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if queue.pending.as_ref().is_some_and(|pending| pending.generation == generation) {
            queue.pending = None;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub async fn receive_args(app: &AppHandle, args: &[String]) -> Result<(), String> {
    let state = app.state::<DeepLinkState>();
    for value in args { state.enqueue(value); }
    if app.get_webview_window("main").is_none() {
        let config = app.config().app.windows.iter().find(|config| config.label == "main")
            .ok_or("主窗口配置不存在。")?;
        // Run from the asynchronous receiver, not a synchronous Windows command.
        tauri::WebviewWindowBuilder::from_config(app, config).map_err(|error| error.to_string())?
            .build().map_err(|error| format!("无法恢复主窗口：{error}"))?;
    }
    crate::menu::show_main_window(app);
    if state.peek("main")?.is_some() {
        // A wakeup only. Main peeks after listening so an early event cannot lose the URL.
        // Re-delivery of the same pending URL also retries after context invalidation.
        let _ = app.emit_to("main", EVENT, ());
    }
    Ok(())
}

#[tauri::command]
pub fn deep_link_pending(window: WebviewWindow, state: State<'_, DeepLinkState>) -> Result<Option<PendingLink>, String> {
    state.peek(window.label())
}

#[tauri::command]
pub fn deep_link_acknowledge(window: WebviewWindow, state: State<'_, DeepLinkState>, generation: u64) -> Result<bool, String> {
    state.acknowledge(window.label(), generation)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "00000000-0000-0000-0000-000000000001";
    const B: &str = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    fn link(id: &str) -> String { format!("codex://threads/{id}") }

    #[test]
    fn accepts_uuid_shape_without_version_restriction_and_one_trailing_slash() {
        for id in [A, B, "12345678-1234-ABCD-EF12-123456789ABC"] {
            assert_eq!(parse_thread_url(&format!("CODEX://THREADS/{id}")), Some(id.to_ascii_lowercase()));
            assert_eq!(parse_thread_url(&format!("{}/", link(id))), Some(id.to_ascii_lowercase()));
        }
    }

    #[test]
    fn rejects_unsupported_or_normalized_routes_without_side_effects() {
        for url in [
            format!("https://threads/{A}"), format!("codex-dev://threads/{A}"),
            format!("codex://else/{A}"), format!("codex://user@threads/{A}"),
            format!("codex://threads:123/{A}"), format!("codex://threads/{A}?"),
            format!("codex://threads/{A}#"), format!("codex://threads/{A}/extra"),
            format!("codex://threads/foo/../{A}"), format!("codex://threads/{A}//"),
            format!("codex://threads/%30{}", &A[1..]), format!("codex://threads//{A}"),
            format!("codex://threads/{A}\n"), format!(" codex://threads/{A}"),
            format!("codex://threads/{}", A.replace('-', "")), "codex://threads/new".into(),
        ] { assert_eq!(parse_thread_url(&url), None, "{url:?}"); }
    }

    #[test]
    fn latest_wins_duplicate_is_idempotent_and_old_ack_cannot_consume_new_link() {
        let state = DeepLinkState::default();
        assert!(state.enqueue(&link(A)));
        let first = state.peek("main").unwrap().unwrap();
        assert!(!state.enqueue(&link(A)));
        assert_eq!(state.peek("main").unwrap().unwrap(), first);
        assert!(!state.enqueue("codex://threads/new"));
        assert!(state.enqueue(&link(B)));
        assert!(!state.acknowledge("main", first.generation).unwrap());
        let latest = state.peek("main").unwrap().unwrap();
        assert_eq!(latest.target, LinkTarget::Thread { thread_id: B.into() });
        assert_eq!(serde_json::to_value(&latest).unwrap(), serde_json::json!({
            "kind": "thread", "generation": latest.generation, "threadId": B,
        }));
        assert!(state.acknowledge("main", latest.generation).unwrap());
        assert!(state.peek("main").unwrap().is_none());
        assert!(!state.acknowledge("main", latest.generation).unwrap());
        assert!(state.enqueue(&link(B)), "a new delivery after consumption is valid");
    }

    #[test]
    fn cloud_create_requires_the_native_destination_and_uses_the_same_queue() {
        let state = DeepLinkState::default();
        assert!(state.enqueue(&link(A)));
        let thread = state.peek("main").unwrap().unwrap();
        for unsupported in [
            "https://chatgpt.com/cloud-environments/new",
            "codex://cloud-environments/new?utm_source=chatgpt.com",
            "codex://cloud-environments/new#",
            "codex://cloud-environments/new?",
            "codex://cloud-environments/new/",
            "codex://cloud-environments/other/../new",
            "codex://cloud-environments/%6eew",
            "codex://cloud-environments:42/new",
            "codex://user@cloud-environments/new",
            "codex-dev://cloud-environments/new",
        ] {
            assert!(!state.enqueue(unsupported), "{unsupported}");
            assert_eq!(state.peek("main").unwrap().unwrap(), thread);
        }
        assert!(state.enqueue("codex://cloud-environments/new"));
        assert!(!state.enqueue("CODEX://CLOUD-ENVIRONMENTS/new"));
        assert!(!state.acknowledge("main", thread.generation).unwrap());
        let create = state.peek("main").unwrap().unwrap();
        assert_eq!(serde_json::to_value(&create).unwrap(), serde_json::json!({
            "kind": "cloud_environment_create", "generation": create.generation,
        }));
        assert!(state.acknowledge("main", create.generation).unwrap());
    }

    #[test]
    fn independent_windows_cannot_peek_or_consume() {
        let state = DeepLinkState::default();
        state.enqueue(&link(A));
        for label in ["quick-chat", "thread-example", ""] {
            assert!(state.peek(label).is_err());
            assert!(state.acknowledge(label, 1).is_err());
        }
        assert!(state.peek("main").unwrap().is_some());
    }
}
