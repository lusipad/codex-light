use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

#[derive(Default)]
struct WindowWatches {
    closed: AtomicBool,
    ids: AsyncMutex<HashSet<String>>,
}

#[derive(Clone, Default)]
pub struct ThreadWindowState(Arc<Mutex<HashMap<String, Arc<WindowWatches>>>>);

impl ThreadWindowState {
    pub fn register(&self, label: &str) -> Result<(), String> {
        let mut windows = self.0.lock().map_err(|error| error.to_string())?;
        if windows.contains_key(label) {
            return Err("会话窗口已登记".into());
        }
        windows.insert(label.into(), Arc::new(WindowWatches::default()));
        Ok(())
    }

    pub async fn call_watch<F, Fut>(
        &self,
        label: &str,
        method: &str,
        params: Option<Value>,
        call: F,
    ) -> Result<Value, String>
    where
        F: FnOnce(Option<Value>) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        if !matches!(method, "fs/watch" | "fs/unwatch") {
            return Err("不支持的会话窗口文件监听请求".into());
        }
        let watch_id = params
            .as_ref()
            .and_then(|params| params.get("watchId"))
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("文件监听 ID 不能为空")?
            .to_owned();
        let window = self
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .get(label)
            .cloned()
            .ok_or("会话窗口已关闭或未登记")?;
        // Serialize requests with close cleanup so unwatch cannot precede an in-flight watch.
        let mut ids = window.ids.lock().await;
        if window.closed.load(Ordering::SeqCst) {
            return Err("会话窗口已关闭".into());
        }
        if method == "fs/watch" {
            // Even a failed/timed-out RPC may have installed the server-side watch.
            ids.insert(watch_id.clone());
        } else if !ids.contains(&watch_id) {
            return Err("文件监听不属于此会话窗口".into());
        }
        let result = call(params).await;
        if method == "fs/unwatch" && result.is_ok() {
            ids.remove(&watch_id);
        }
        result
    }

    pub fn close_window(&self, label: &str) -> impl Future<Output = Vec<String>> + Send + 'static {
        // Mark closed synchronously, before the Destroyed handler schedules async cleanup.
        let window = self
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(label);
        if let Some(window) = &window {
            window.closed.store(true, Ordering::SeqCst);
        }
        async move {
            match window {
                Some(window) => window.ids.lock().await.drain().collect(),
                None => Vec::new(),
            }
        }
    }
}

fn cleanup_window_watches(app: &tauri::AppHandle, label: &str) {
    let Some(windows) = app.try_state::<ThreadWindowState>() else {
        return;
    };
    let pending = windows.close_window(label);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let ids = pending.await;
        let Some(state) = app.try_state::<crate::AppState>() else {
            return;
        };
        for watch_id in ids {
            if !state.app_server.get_status().await.connected {
                break;
            }
            if let Err(error) = state
                .app_server
                .release_file_watch(&watch_id)
                .await
            {
                eprintln!("[thread-window] 无法取消文件监听：{error}");
            }
        }
    });
}

fn validate_thread_id(thread_id: &str) -> Result<(), String> {
    if thread_id.is_empty()
        || thread_id.len() > 256
        || !thread_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("会话 ID 必须为 1 至 256 个 ASCII 字母、数字、下划线或连字符".into());
    }
    Ok(())
}

fn window_target(thread_id: &str) -> Result<(String, String), String> {
    validate_thread_id(thread_id)?;
    let label = format!("thread-{}", Uuid::new_v4());
    // The validated alphabet contains only URL-unreserved characters.
    let url = format!("index.html?threadWindow={label}&threadId={thread_id}");
    Ok((label, url))
}

trait WindowActions {
    fn show(&self) -> Result<(), String>;
    fn unminimize(&self) -> Result<(), String>;
    fn focus(&self) -> Result<(), String>;
}

impl WindowActions for WebviewWindow {
    fn show(&self) -> Result<(), String> {
        WebviewWindow::show(self).map_err(|error| error.to_string())
    }

    fn unminimize(&self) -> Result<(), String> {
        WebviewWindow::unminimize(self).map_err(|error| error.to_string())
    }

    fn focus(&self) -> Result<(), String> {
        self.set_focus().map_err(|error| error.to_string())
    }
}

fn reveal(window: &impl WindowActions) -> Result<(), String> {
    window.show()?;
    window.unminimize()?;
    window.focus()
}

// Async commands avoid WebviewWindowBuilder's documented Windows deadlock.
#[tauri::command]
pub async fn open_thread_window(
    app: tauri::AppHandle,
    thread_id: String,
) -> Result<String, String> {
    let (label, url) = window_target(&thread_id)?;
    app.state::<ThreadWindowState>().register(&label)?;
    app.state::<crate::AppState>().terminal.reopen_owner(&label);
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Codex Light")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .decorations(false)
        .skip_taskbar(false)
        .visible(false)
        .build()
        .map_err(|error| {
            cleanup_window_watches(&app, &label);
            format!("无法创建会话窗口：{error}")
        })?;
    let cleanup_app = app.clone();
    let cleanup_label = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            cleanup_window_watches(&cleanup_app, &cleanup_label);
        }
    });
    if let Err(error) = reveal(&window) {
        return match window.destroy() {
            Ok(()) => Err(format!("无法显示会话窗口：{error}")),
            Err(cleanup_error) => Err(format!(
                "无法显示会话窗口：{error}；无法销毁窗口：{cleanup_error}"
            )),
        };
    }
    Ok(label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    #[tokio::test]
    async fn thread_window_watch_close_waits_for_inflight_and_rejects_late_calls() {
        let state = ThreadWindowState::default();
        state.register("thread-a").unwrap();
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
        let watch = state.call_watch(
            "thread-a",
            "fs/watch",
            Some(json!({"path":"D:/test","watchId":"watch-a"})),
            |_| async {
                entered_tx.send(()).unwrap();
                finish_rx.await.unwrap();
                Ok(json!({}))
            },
        );
        let close = async {
            entered_rx.await.unwrap();
            let cleanup = state.close_window("thread-a");
            tokio::pin!(cleanup);
            tokio::select! {
                biased;
                _ = &mut cleanup => panic!("cleanup must wait for the in-flight watch"),
                _ = tokio::task::yield_now() => {}
            }
            assert!(state
                .call_watch(
                    "thread-a",
                    "fs/watch",
                    Some(json!({"watchId":"late"})),
                    |_| async { panic!("closed window must not send RPC") }
                )
                .await
                .is_err());
            finish_tx.send(()).unwrap();
            assert_eq!(cleanup.await, vec!["watch-a"]);
        };
        let (result, ()) = tokio::join!(watch, close);
        result.unwrap();
    }

    #[tokio::test]
    async fn thread_window_failed_watch_is_retained_for_close_cleanup() {
        let state = ThreadWindowState::default();
        state.register("thread-a").unwrap();
        for (id, error) in [
            ("failed", "server rejected request"),
            ("timed-out", "timeout"),
        ] {
            assert_eq!(
                state
                    .call_watch(
                        "thread-a",
                        "fs/watch",
                        Some(json!({"watchId":id})),
                        |_| async { Err(error.into()) }
                    )
                    .await,
                Err(error.into())
            );
        }
        let mut watches = state.close_window("thread-a").await;
        watches.sort();
        assert_eq!(watches, ["failed", "timed-out"]);
        assert!(state.close_window("thread-a").await.is_empty());
    }

    #[tokio::test]
    async fn thread_window_cancelled_watch_rpc_retains_id_for_cleanup() {
        let state = ThreadWindowState::default();
        state.register("thread-a").unwrap();
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(1),
            state.call_watch(
                "thread-a",
                "fs/watch",
                Some(json!({"watchId":"timed-out"})),
                |_| std::future::pending::<Result<Value, String>>(),
            ),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(state.close_window("thread-a").await, ["timed-out"]);
    }

    #[tokio::test]
    async fn thread_window_invalid_watch_never_sends_rpc() {
        let state = ThreadWindowState::default();
        state.register("thread-a").unwrap();
        assert!(state.register("thread-a").is_err());
        for (method, params) in [
            ("fs/readFile", Some(json!({"watchId":"watch-a"}))),
            ("fs/watch", None),
            ("fs/watch", Some(json!({"watchId":""}))),
            ("fs/watch", Some(json!({"watchId":7}))),
        ] {
            assert!(state
                .call_watch("thread-a", method, params, |_| async {
                    panic!("invalid watch parameters must not reach RPC")
                })
                .await
                .is_err());
        }
        assert!(state.close_window("thread-a").await.is_empty());
    }

    #[tokio::test]
    async fn thread_window_cleanup_is_isolated_and_only_successful_unwatch_releases_id() {
        let state = ThreadWindowState::default();
        for (label, id) in [("thread-a", "watch-a"), ("thread-b", "watch-b")] {
            state.register(label).unwrap();
            state
                .call_watch(label, "fs/watch", Some(json!({"watchId":id})), |_| async {
                    Ok(json!({}))
                })
                .await
                .unwrap();
        }
        assert!(state
            .call_watch(
                "thread-a",
                "fs/unwatch",
                Some(json!({"watchId":"watch-b"})),
                |_| async { panic!("another window's watch must not be removed") }
            )
            .await
            .is_err());
        assert!(state
            .call_watch(
                "thread-a",
                "fs/unwatch",
                Some(json!({"watchId":"watch-a"})),
                |_| async { Err("timeout".into()) }
            )
            .await
            .is_err());
        assert_eq!(state.close_window("thread-a").await, ["watch-a"]);
        state
            .call_watch(
                "thread-b",
                "fs/unwatch",
                Some(json!({"watchId":"watch-b"})),
                |_| async { Ok(json!({})) },
            )
            .await
            .unwrap();
        assert!(state.close_window("thread-b").await.is_empty());
    }

    #[test]
    fn thread_window_rejects_empty_oversized_and_unsafe_ids() {
        for invalid in [
            "",
            " ",
            "thread 123",
            "thread/123",
            "../thread",
            "thread?x=y",
            "thread&threadId=other",
            "thread#123",
            "thread%2F123",
            "会话",
            "thread\n123",
            "thread\0",
        ] {
            assert!(window_target(invalid).is_err(), "{invalid:?}");
        }
        assert!(window_target(&"a".repeat(257)).is_err());
        assert!(window_target(&"a".repeat(256)).is_ok());
    }

    #[test]
    fn thread_window_url_preserves_safe_non_uuid_thread_ids() {
        for id in ["thread-123", "ABC_012-xyz", "019c6e27-e55b-73d1"] {
            let (label, url) = window_target(id).unwrap();
            assert_eq!(
                url,
                format!("index.html?threadWindow={label}&threadId={id}")
            );
            assert_eq!(url.matches('&').count(), 1);
        }
    }

    #[test]
    fn thread_window_labels_are_unique_v4_uuids() {
        let (first, _) = window_target("thread-123").unwrap();
        let (second, _) = window_target("thread-123").unwrap();
        assert_ne!(first, second);
        for label in [first, second] {
            let uuid = Uuid::parse_str(label.strip_prefix("thread-").unwrap()).unwrap();
            assert_eq!(uuid.get_version_num(), 4);
        }
    }

    struct Window {
        fail: Option<&'static str>,
        calls: RefCell<Vec<&'static str>>,
    }

    impl Window {
        fn call(&self, action: &'static str) -> Result<(), String> {
            self.calls.borrow_mut().push(action);
            if self.fail == Some(action) {
                Err(action.into())
            } else {
                Ok(())
            }
        }
    }

    impl WindowActions for Window {
        fn show(&self) -> Result<(), String> {
            self.call("show")
        }

        fn unminimize(&self) -> Result<(), String> {
            self.call("unminimize")
        }

        fn focus(&self) -> Result<(), String> {
            self.call("focus")
        }
    }

    #[test]
    fn thread_window_reveal_runs_show_restore_focus_in_order() {
        let window = Window {
            fail: None,
            calls: RefCell::default(),
        };
        reveal(&window).unwrap();
        assert_eq!(*window.calls.borrow(), ["show", "unminimize", "focus"]);
    }

    #[test]
    fn thread_window_reveal_propagates_each_failure_and_stops() {
        for (fail, expected) in [
            ("show", vec!["show"]),
            ("unminimize", vec!["show", "unminimize"]),
            ("focus", vec!["show", "unminimize", "focus"]),
        ] {
            let window = Window {
                fail: Some(fail),
                calls: RefCell::default(),
            };
            assert_eq!(reveal(&window), Err(fail.into()));
            assert_eq!(*window.calls.borrow(), expected);
        }
    }
}
