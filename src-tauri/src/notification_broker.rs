use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewWindow};

const MAX_EVENT_IDS: usize = 1000;
const MAX_ID_BYTES: usize = 2048;

#[derive(Default)]
struct BrokerState {
    views: HashMap<String, Option<String>>,
    delivered: HashSet<String>,
    order: VecDeque<String>,
}

#[derive(Default)]
pub struct NotificationBroker(Mutex<BrokerState>);

struct WindowSnapshot {
    label: String,
    visible: bool,
    minimized: bool,
    focused: bool,
}

fn window_snapshot(
    label: String,
    read: impl FnOnce() -> Result<(bool, bool, bool), String>,
    still_exists: impl FnOnce() -> bool,
) -> Result<Option<WindowSnapshot>, String> {
    match read() {
        Ok((visible, minimized, focused)) => Ok(Some(WindowSnapshot {
            label,
            visible,
            minimized,
            focused,
        })),
        Err(_) if !still_exists() => Ok(None),
        Err(error) => Err(error),
    }
}

#[derive(Clone, Copy)]
enum Category {
    Turn,
    Permission,
    Question,
    Dot,
}

impl Category {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "turn" => Ok(Self::Turn),
            "permission" => Ok(Self::Permission),
            "question" => Ok(Self::Question),
            "dot" => Ok(Self::Dot),
            _ => Err("不支持的通知类别".into()),
        }
    }
}

struct Preferences {
    turn_mode: String,
    permissions: bool,
    questions: bool,
    dot: bool,
    sound: Value,
}

impl Preferences {
    fn read(get: impl Fn(&str) -> Value) -> Self {
        let turn = get("notifications-turn-mode");
        Self {
            turn_mode: match turn.as_str() {
                Some("off" | "unfocused" | "always") => turn.as_str().unwrap().into(),
                _ => "unfocused".into(),
            },
            permissions: get("notifications-permissions-enabled")
                .as_bool()
                .unwrap_or(true),
            questions: get("notifications-questions-enabled")
                .as_bool()
                .unwrap_or(true),
            dot: get("notifications-dot-enabled").as_bool().unwrap_or(true),
            sound: normalize_sound(get("notifications-sound")),
        }
    }

    fn should_notify(&self, category: Category, focused: bool, visible: bool) -> bool {
        match category {
            Category::Turn => self.turn_mode != "off" && (self.turn_mode == "always" || !focused),
            Category::Permission => self.permissions && !(focused && visible),
            Category::Question => self.questions && !(focused && visible),
            Category::Dot => self.dot && !focused,
        }
    }
}

fn normalize_sound(value: Value) -> Value {
    if matches!(
        value.as_str(),
        Some("default" | "classic" | "none" | "Basso" | "Glass" | "Ping" | "Pop" | "Purr" | "Tink")
    ) {
        return value;
    }
    if let Some(custom) = value.as_object() {
        let valid_name = custom
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| !name.trim().is_empty());
        let valid_file = custom
            .get("fileName")
            .and_then(Value::as_str)
            .and_then(|name| name.strip_prefix("codex-custom-"))
            .and_then(|name| name.rsplit_once('.'))
            .is_some_and(|(hash, extension)| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    && matches!(extension, "wav" | "aiff" | "caf")
            });
        if valid_name && valid_file {
            return value;
        }
    }
    json!("default")
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES {
        return Err("通知和会话 ID 必须非空且不超过 2048 字节".into());
    }
    Ok(())
}

impl NotificationBroker {
    fn update_view(&self, label: &str, thread_id: Option<String>) -> Result<(), String> {
        if let Some(id) = &thread_id {
            validate_id(id)?;
        }
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .views
            .insert(label.into(), thread_id);
        Ok(())
    }

    pub fn remove_window(&self, label: &str) {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .views
            .remove(label);
    }

    fn claim(
        &self,
        event_id: &str,
        category: &str,
        thread_id: Option<&str>,
        preferences: &Preferences,
        windows: &[WindowSnapshot],
    ) -> Result<Option<Value>, String> {
        validate_id(event_id)?;
        if let Some(id) = thread_id {
            validate_id(id)?;
        }
        let category = Category::parse(category)?;
        let mut state = self.0.lock().map_err(|error| error.to_string())?;
        if !state.delivered.insert(event_id.into()) {
            return Ok(None);
        }
        state.order.push_back(event_id.into());
        if state.order.len() > MAX_EVENT_IDS {
            if let Some(oldest) = state.order.pop_front() {
                state.delivered.remove(&oldest);
            }
        }
        // Suppressed events remain claimed so another window cannot replay them later.
        let mut focused = false;
        let mut visible = false;
        for window in windows {
            if window.visible && !window.minimized && window.focused {
                focused = true;
                visible |= thread_id.is_some_and(|id| {
                    state.views.get(&window.label).and_then(Option::as_deref) == Some(id)
                });
            }
        }
        Ok(preferences
            .should_notify(category, focused, visible)
            .then(|| json!({ "sound": preferences.sound })))
    }
}

#[tauri::command]
pub fn notification_view_update(
    app: tauri::AppHandle,
    state: State<'_, NotificationBroker>,
    window: WebviewWindow,
    thread_id: Option<String>,
) -> Result<(), String> {
    if app.get_webview_window(window.label()).is_none() {
        return Err("通知窗口已关闭".into());
    }
    state.update_view(window.label(), thread_id)
}

#[tauri::command]
pub async fn notification_claim(
    app: tauri::AppHandle,
    state: State<'_, NotificationBroker>,
    event_id: String,
    category: String,
    thread_id: Option<String>,
) -> Result<Option<Value>, String> {
    let host = app.state::<crate::AppState>();
    let effective = crate::notification_preferences::read_effective(&app, &host).await?;
    let preferences = Preferences::read(|key| effective.get(key).cloned().unwrap_or(Value::Null));
    let windows = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| {
            window_snapshot(
                label.clone(),
                || {
                    Ok((
                        window.is_visible().map_err(|error| error.to_string())?,
                        window.is_minimized().map_err(|error| error.to_string())?,
                        window.is_focused().map_err(|error| error.to_string())?,
                    ))
                },
                || app.get_webview_window(&label).is_some(),
            )
        })
        .collect::<Result<Vec<_>, String>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    state.claim(
        &event_id,
        &category,
        thread_id.as_deref(),
        &preferences,
        &windows,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn preferences(values: Value) -> Preferences {
        Preferences::read(|key| values.get(key).cloned().unwrap_or(Value::Null))
    }

    #[test]
    fn notification_broker_closed_during_snapshot_does_not_block_remaining_window() {
        let closed =
            window_snapshot("closed".into(), || Err("destroyed".into()), || false).unwrap();
        assert!(closed.is_none());
        assert!(window_snapshot("live".into(), || Err("query failed".into()), || true).is_err());
        let remaining = window_snapshot("remaining".into(), || Ok((true, false, false)), || true)
            .unwrap()
            .unwrap();
        assert!(NotificationBroker::default()
            .claim("new", "turn", None, &preferences(json!({})), &[remaining])
            .unwrap()
            .is_some());
    }

    fn focused(label: &str) -> WindowSnapshot {
        WindowSnapshot {
            label: label.into(),
            visible: true,
            minimized: false,
            focused: true,
        }
    }

    #[test]
    fn notification_broker_concurrent_windows_have_one_winner() {
        let broker = Arc::new(NotificationBroker::default());
        let barrier = Arc::new(Barrier::new(12));
        let handles: Vec<_> = (0..12)
            .map(|_| {
                let broker = broker.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    broker
                        .claim("shared", "turn", None, &preferences(json!({})), &[])
                        .unwrap()
                        .is_some()
                })
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|handle| usize::from(handle.join().unwrap()))
                .sum::<usize>(),
            1
        );
    }

    #[test]
    fn notification_broker_only_focused_matching_thread_suppresses_requests() {
        for category in ["permission", "question"] {
            let broker = NotificationBroker::default();
            broker.update_view("main", Some("same".into())).unwrap();
            broker
                .update_view("other", Some("different".into()))
                .unwrap();
            let prefs = preferences(json!({}));
            assert!(broker
                .claim("same", category, Some("same"), &prefs, &[focused("main")])
                .unwrap()
                .is_none());
            assert!(broker
                .claim("other", category, Some("same"), &prefs, &[focused("other")])
                .unwrap()
                .is_some());
            assert!(broker
                .claim(
                    "quick",
                    category,
                    Some("same"),
                    &prefs,
                    &[focused("quick-chat")]
                )
                .unwrap()
                .is_some());
            assert!(broker
                .claim("none", category, None, &prefs, &[focused("main")])
                .unwrap()
                .is_some());
        }
    }

    #[test]
    fn notification_broker_quick_chat_and_actual_visibility_control_app_focus() {
        let broker = NotificationBroker::default();
        let prefs = preferences(json!({}));
        assert!(broker
            .claim("quick", "turn", None, &prefs, &[focused("quick-chat")])
            .unwrap()
            .is_none());
        let mut hidden = focused("main");
        hidden.visible = false;
        assert!(broker
            .claim("hidden", "turn", None, &prefs, &[hidden])
            .unwrap()
            .is_some());
        let mut minimized = focused("main");
        minimized.minimized = true;
        assert!(broker
            .claim("minimized", "turn", None, &prefs, &[minimized])
            .unwrap()
            .is_some());
        let mut unfocused = focused("main");
        unfocused.focused = false;
        assert!(broker
            .claim("unfocused", "turn", None, &prefs, &[unfocused])
            .unwrap()
            .is_some());
    }

    #[test]
    fn notification_broker_modes_and_category_switches_are_independent() {
        for mode in ["off", "unfocused", "always"] {
            for focus in [false, true] {
                let windows = if focus {
                    vec![focused("quick-chat")]
                } else {
                    vec![]
                };
                let prefs = preferences(json!({"notifications-turn-mode": mode}));
                let broker = NotificationBroker::default();
                assert_eq!(
                    broker
                        .claim("turn", "turn", None, &prefs, &windows)
                        .unwrap()
                        .is_some(),
                    mode == "always" || (mode == "unfocused" && !focus)
                );
                assert!(broker
                    .claim("permission", "permission", None, &prefs, &windows)
                    .unwrap()
                    .is_some());
                assert!(broker
                    .claim("question", "question", None, &prefs, &windows)
                    .unwrap()
                    .is_some());
            }
        }
        for (key, category, other) in [
            (
                "notifications-permissions-enabled",
                "permission",
                "question",
            ),
            ("notifications-questions-enabled", "question", "permission"),
            ("notifications-dot-enabled", "dot", "turn"),
        ] {
            let prefs = preferences(json!({key: false}));
            let broker = NotificationBroker::default();
            assert!(broker
                .claim("disabled", category, None, &prefs, &[])
                .unwrap()
                .is_none());
            assert!(broker
                .claim("other", other, None, &prefs, &[])
                .unwrap()
                .is_some());
        }
        assert!(NotificationBroker::default()
            .claim(
                "dot",
                "dot",
                None,
                &preferences(json!({})),
                &[focused("main")]
            )
            .unwrap()
            .is_none());
    }

    #[test]
    fn notification_broker_removing_window_preserves_dedup_and_other_views() {
        let broker = NotificationBroker::default();
        let prefs = preferences(json!({}));
        broker.update_view("closed", Some("a".into())).unwrap();
        broker.update_view("remaining", Some("b".into())).unwrap();
        assert!(broker
            .claim("seen", "turn", None, &prefs, &[])
            .unwrap()
            .is_some());
        broker.remove_window("closed");
        assert!(broker
            .claim("seen", "turn", None, &prefs, &[])
            .unwrap()
            .is_none());
        assert!(broker
            .claim(
                "new",
                "permission",
                Some("b"),
                &prefs,
                &[focused("remaining")]
            )
            .unwrap()
            .is_none());
        assert!(broker
            .claim(
                "next",
                "permission",
                Some("a"),
                &prefs,
                &[focused("remaining")]
            )
            .unwrap()
            .is_some());
        assert!(!broker.0.lock().unwrap().views.contains_key("closed"));
    }

    #[test]
    fn notification_broker_suppressed_events_are_not_replayed_and_history_is_bounded() {
        let broker = NotificationBroker::default();
        let prefs = preferences(json!({}));
        assert!(broker
            .claim("suppressed", "turn", None, &prefs, &[focused("main")])
            .unwrap()
            .is_none());
        assert!(broker
            .claim("suppressed", "turn", None, &prefs, &[])
            .unwrap()
            .is_none());
        for index in 0..MAX_EVENT_IDS {
            broker
                .claim(&format!("event-{index}"), "turn", None, &prefs, &[])
                .unwrap();
        }
        {
            let state = broker.0.lock().unwrap();
            assert_eq!(state.order.len(), MAX_EVENT_IDS);
            assert_eq!(state.delivered.len(), MAX_EVENT_IDS);
            assert!(!state.delivered.contains("suppressed"));
        }
        assert!(broker
            .claim("event-0", "turn", None, &prefs, &[])
            .unwrap()
            .is_none());
        assert!(broker
            .claim("suppressed", "turn", None, &prefs, &[])
            .unwrap()
            .is_some());
    }

    #[test]
    fn notification_broker_invalid_inputs_do_not_claim_events() {
        let broker = NotificationBroker::default();
        let prefs = preferences(json!({}));
        for id in ["", " ", &"x".repeat(MAX_ID_BYTES + 1)] {
            assert!(broker.claim(id, "turn", None, &prefs, &[]).is_err());
            assert!(broker.update_view("main", Some(id.into())).is_err());
        }
        assert!(broker.claim("valid", "unknown", None, &prefs, &[]).is_err());
        assert!(broker
            .claim("valid", "turn", Some(""), &prefs, &[])
            .is_err());
        assert!(broker
            .claim("valid", "turn", None, &prefs, &[])
            .unwrap()
            .is_some());
        assert!(broker
            .claim(&"x".repeat(MAX_ID_BYTES), "turn", None, &prefs, &[])
            .is_ok());
    }

    #[test]
    fn notification_broker_preferences_and_sound_match_normalization() {
        let defaults = preferences(json!({}));
        assert_eq!(defaults.turn_mode, "unfocused");
        assert!(defaults.permissions && defaults.questions && defaults.dot);
        assert_eq!(defaults.sound, json!("default"));
        let invalid = preferences(
            json!({"notifications-turn-mode":"never", "notifications-permissions-enabled":0,
            "notifications-questions-enabled":null, "notifications-dot-enabled":"false", "notifications-sound":false}),
        );
        assert_eq!(invalid.turn_mode, "unfocused");
        assert!(invalid.permissions && invalid.questions && invalid.dot);
        assert_eq!(invalid.sound, json!("default"));
        for sound in [
            "default", "classic", "none", "Basso", "Glass", "Ping", "Pop", "Purr", "Tink",
        ] {
            let prefs = preferences(json!({"notifications-sound": sound}));
            assert_eq!(
                NotificationBroker::default()
                    .claim("event", "turn", None, &prefs, &[])
                    .unwrap(),
                Some(json!({"sound":sound}))
            );
        }
        for extension in ["wav", "aiff", "caf"] {
            let sound = json!({"name":" Imported ", "fileName":format!("codex-custom-{}.{}", "a".repeat(64), extension)});
            assert_eq!(normalize_sound(sound.clone()), sound);
        }
        for sound in [
            json!("ping"),
            json!({"name":"", "fileName":format!("codex-custom-{}.wav", "a".repeat(64))}),
            json!({"name":"test", "fileName":format!("codex-custom-{}.wav", "A".repeat(64))}),
            json!({"name":"test", "fileName":format!("codex-custom-{}.mp3", "a".repeat(64))}),
            json!({"name":"test", "fileName":"../test.wav"}),
        ] {
            assert_eq!(normalize_sound(sound), json!("default"));
        }
    }
}
