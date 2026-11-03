use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct QuickChatState(Mutex<()>);

trait WindowActions {
    fn visible(&self) -> Result<bool, String>;
    fn show(&self) -> Result<(), String>;
    fn unminimize(&self) -> Result<(), String>;
    fn focus(&self) -> Result<(), String>;
    fn hide(&self) -> Result<(), String>;
}

impl WindowActions for WebviewWindow {
    fn visible(&self) -> Result<bool, String> {
        self.is_visible().map_err(|e| e.to_string())
    }
    fn show(&self) -> Result<(), String> {
        WebviewWindow::show(self).map_err(|e| e.to_string())
    }
    fn unminimize(&self) -> Result<(), String> {
        WebviewWindow::unminimize(self).map_err(|e| e.to_string())
    }
    fn focus(&self) -> Result<(), String> {
        self.set_focus().map_err(|e| e.to_string())
    }
    fn hide(&self) -> Result<(), String> {
        WebviewWindow::hide(self).map_err(|e| e.to_string())
    }
}

fn reveal(window: &impl WindowActions) -> Result<(), String> {
    window.show()?;
    window.unminimize()?;
    window.focus()
}

fn toggle_existing(window: &impl WindowActions) -> Result<(), String> {
    if window.visible()? {
        window.hide()
    } else {
        reveal(window)
    }
}

fn continue_thread_id(thread_id: Option<String>) -> Result<Option<String>, String> {
    match thread_id {
        Some(id) if id.trim().is_empty() => Err("Quick Chat 会话 ID 不能为空".into()),
        value => Ok(value),
    }
}

// WebviewWindowBuilder::new documents a Windows deadlock in synchronous commands.
#[tauri::command]
pub async fn quick_chat_toggle(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<QuickChatState>();
    let _guard = state.0.lock().await;
    if let Some(window) = app.get_webview_window("quick-chat") {
        return toggle_existing(&window);
    }
    let window = WebviewWindowBuilder::new(
        &app,
        "quick-chat",
        WebviewUrl::App("index.html?utility=quick-chat".into()),
    )
    .title("Quick Chat")
    .inner_size(470.0, 640.0)
    .min_inner_size(400.0, 400.0)
    .resizable(true)
    .decorations(false)
    .skip_taskbar(true)
    .minimizable(false)
    .maximizable(false)
    .fullscreen(false)
    .always_on_top(false)
    .visible(false)
    .build()
    .map_err(|e| format!("无法创建 Quick Chat 窗口：{e}"))?;
    let retained = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = retained.hide() {
                eprintln!("[quick-chat] 无法隐藏窗口：{error}");
            }
        }
    });
    reveal(&window)
}

#[tauri::command]
pub async fn quick_chat_hide(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<QuickChatState>();
    let _guard = state.0.lock().await;
    match app.get_webview_window("quick-chat") {
        Some(window) => window.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn quick_chat_continue(
    app: tauri::AppHandle,
    thread_id: Option<String>,
) -> Result<(), String> {
    let thread_id = continue_thread_id(thread_id)?;
    let state = app.state::<QuickChatState>();
    let _guard = state.0.lock().await;
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    if let Some(thread_id) = thread_id {
        app.emit_to(
            "main",
            "quick-chat:continue",
            serde_json::json!({ "threadId": thread_id }),
        )
        .map_err(|e| format!("无法向主窗口传递会话：{e}"))?;
    }
    reveal(&main)?;
    match app.get_webview_window("quick-chat") {
        Some(window) => window.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Window {
        visible: bool,
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
        fn visible(&self) -> Result<bool, String> {
            self.call("visible")?;
            Ok(self.visible)
        }
        fn show(&self) -> Result<(), String> {
            self.call("show")
        }
        fn unminimize(&self) -> Result<(), String> {
            self.call("unminimize")
        }
        fn focus(&self) -> Result<(), String> {
            self.call("focus")
        }
        fn hide(&self) -> Result<(), String> {
            self.call("hide")
        }
    }

    #[test]
    fn quick_chat_retains_visible_window_and_restores_hidden_window() {
        let window = Window {
            visible: true,
            fail: None,
            calls: RefCell::default(),
        };
        toggle_existing(&window).unwrap();
        assert_eq!(*window.calls.borrow(), ["visible", "hide"]);
        let window = Window {
            visible: false,
            ..window
        };
        window.calls.borrow_mut().clear();
        toggle_existing(&window).unwrap();
        assert_eq!(
            *window.calls.borrow(),
            ["visible", "show", "unminimize", "focus"]
        );
    }

    #[test]
    fn quick_chat_window_failures_stop_following_actions() {
        for (fail, expected) in [
            ("visible", vec!["visible"]),
            ("show", vec!["visible", "show"]),
            ("unminimize", vec!["visible", "show", "unminimize"]),
            ("focus", vec!["visible", "show", "unminimize", "focus"]),
        ] {
            let window = Window {
                visible: false,
                fail: Some(fail),
                calls: RefCell::default(),
            };
            assert_eq!(toggle_existing(&window), Err(fail.into()));
            assert_eq!(*window.calls.borrow(), expected);
        }
    }

    #[test]
    fn quick_chat_continue_rejects_empty_ids_and_preserves_real_id() {
        assert_eq!(continue_thread_id(None).unwrap(), None);
        assert!(continue_thread_id(Some(" \t\n".into())).is_err());
        assert_eq!(
            continue_thread_id(Some("thread-123".into())).unwrap(),
            Some("thread-123".into())
        );
    }
}
