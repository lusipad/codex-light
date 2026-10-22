//! Native application menu + system tray.
//!
//! Everything is created in Rust (no JS menu API needed). Actionable native
//! events are forwarded to the webview through two Tauri events:
//!
//! * [`NATIVE_MENU_EVENT`] (`"native-menu"`) – payload `{ "id": "<kebab-case-id>" }`
//!   (some items add a `payload` object, e.g. `open-config-toml` carries the path).
//! * [`NATIVE_TRAY_EVENT`] (`"native-tray"`) – payload `{ "id": "open" | "new-chat" | "quit" | "click" }`.
//!
//! The TypeScript bridge that subscribes to those events lives in
//! `src/nativeShell.ts`.
//!
//! Menu ids are kebab-case and stable; they are the contract with the frontend:
//!
//! ```text
//! File:  new-chat, open-workspace, settings, quit
//! Edit:  (PredefinedMenuItem: undo/redo/cut/copy/paste/select-all – native)
//! View:  toggle-sidebar, toggle-terminal, toggle-changes, command-palette,
//!        file-search, toggle-theme, reload, toggle-devtools,
//!        zoom-in, zoom-out, zoom-reset, toggle-fullscreen
//! Window:(PredefinedMenuItem: minimize/close)
//! Help:  about, open-config-toml
//! Tray:  tray-open, tray-new-chat, tray-quit (tray-only ids, not sent as native-menu)
//! ```

use serde_json::json;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event emitted when an application menu item is activated.
pub const NATIVE_MENU_EVENT: &str = "native-menu";
/// Event emitted for tray icon/menu interactions.
pub const NATIVE_TRAY_EVENT: &str = "native-tray";
/// Stable id of the system tray icon (useful for `app.tray_by_id`).
pub const TRAY_ICON_ID: &str = "codex-tray";

/// Small helper so the menu tables below stay readable.
fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, accelerator)
}

/// Builds the application menu (File / Edit / View / Window / Help).
///
/// Edit and Window use [`PredefinedMenuItem`] so the OS performs the native
/// undo/redo/cut/copy/paste/select-all/minimize/close behaviour.
pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(app, "new-chat", "New Chat", Some("CmdOrCtrl+N"))?,
            &item(app, "open-workspace", "Open Workspace…", Some("CmdOrCtrl+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "quit", "Quit", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item(app, "toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?,
            &item(app, "toggle-terminal", "Toggle Terminal", Some("CmdOrCtrl+J"))?,
            &item(
                app,
                "toggle-changes",
                "Toggle Changes Panel",
                Some("CmdOrCtrl+Alt+B"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &item(
                app,
                "command-palette",
                "Command Palette…",
                Some("CmdOrCtrl+K"),
            )?,
            &item(app, "file-search", "File Search…", Some("CmdOrCtrl+P"))?,
            &item(app, "toggle-theme", "Toggle Theme", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "reload", "Reload", Some("CmdOrCtrl+R"))?,
            &item(
                app,
                "toggle-devtools",
                "Toggle Developer Tools",
                Some("F12"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item(app, "zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item(app, "zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &item(
                app,
                "toggle-fullscreen",
                "Toggle Full Screen",
                Some("F11"),
            )?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &item(app, "about", "About Codex Native", None)?,
            &item(app, "open-config-toml", "Open config.toml", None)?,
        ],
    )?;

    Menu::with_items(app, &[&file, &edit, &view, &window, &help])
}

/// Builds the system tray icon + context menu.
///
/// Tray menu actions:
/// * `tray-open`      → show/focus the main window (+ `native-tray {id:"open"}`)
/// * `tray-new-chat`  → show/focus the main window (+ `native-tray {id:"new-chat"}`)
/// * `tray-quit`      → quit the app (+ best-effort `native-tray {id:"quit"}`)
///
/// A left click on the icon itself shows the window and emits
/// `native-tray {id:"click"}`; the context menu opens on right click
/// (`show_menu_on_left_click(false)`).
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let tray_menu = Menu::with_items(
        app,
        &[
            &item(app, "tray-open", "Open Codex", None)?,
            &item(app, "tray-new-chat", "New Chat", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "tray-quit", "Quit Codex", None)?,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .tooltip("Codex Native")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_main_window(app);
                let _ = app.emit(NATIVE_TRAY_EVENT, json!({ "id": "click" }));
            }
        });

    if let Some(icon) = resolve_tray_icon(app) {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Resolves the tray icon: prefer the icon tauri-build embedded for the app,
/// fall back to the bundled `src-tauri/icons/icon.png` (32x32 PNG).
fn resolve_tray_icon<R: Runtime>(app: &AppHandle<R>) -> Option<Image<'static>> {
    app.default_window_icon()
        .cloned()
        .map(|icon| icon.to_owned())
        .or_else(|| Image::from_bytes(include_bytes!("../icons/icon.png")).ok())
}

/// Central dispatcher for every native menu event (app menu + tray menu).
///
/// Tray-related ids are handled natively here; every other known app-menu id is
/// forwarded to the frontend as `native-menu { id }`.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "tray-open" => {
            show_main_window(app);
            let _ = app.emit(NATIVE_TRAY_EVENT, json!({ "id": "open" }));
        }
        "tray-new-chat" => {
            show_main_window(app);
            let _ = app.emit(NATIVE_TRAY_EVENT, json!({ "id": "new-chat" }));
        }
        "tray-quit" => {
            let _ = app.emit(NATIVE_TRAY_EVENT, json!({ "id": "quit" }));
            app.exit(0);
        }
        "open-config-toml" => {
            // The frontend calls `invoke("open_path_external", { path })` with
            // the resolved config path (also works before any App wiring).
            let path = crate::state::codex_home_dir().join("config.toml");
            let _ = app.emit(
                NATIVE_MENU_EVENT,
                json!({
                    "id": "open-config-toml",
                    "payload": { "path": path.to_string_lossy() },
                }),
            );
        }
        "toggle-devtools" => {
            // Works out of the box in debug builds; release builds need the
            // optional `devtools` cargo feature (otherwise this is a no-op and
            // the event is still forwarded to the webview).
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                }
            }
            let _ = app.emit(NATIVE_MENU_EVENT, json!({ "id": "toggle-devtools" }));
        }
        // Known application menu ids -> forward to the webview.
        "new-chat"
        | "open-workspace"
        | "settings"
        | "quit"
        | "toggle-sidebar"
        | "toggle-terminal"
        | "toggle-changes"
        | "command-palette"
        | "file-search"
        | "toggle-theme"
        | "reload"
        | "zoom-in"
        | "zoom-out"
        | "zoom-reset"
        | "toggle-fullscreen"
        | "about" => {
            let _ = app.emit(NATIVE_MENU_EVENT, json!({ "id": id }));
        }
        // Predefined items (undo/copy/separators/…) have no frontend action.
        _ => {}
    }
}

/// Shows, unminimizes and focuses the main window.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
