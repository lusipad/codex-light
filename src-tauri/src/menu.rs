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
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event emitted when an application menu item is activated.
pub const NATIVE_MENU_EVENT: &str = "native-menu";
const BOTTOM_PANEL_LAUNCHER_MENU_PREFIX: &str = "toggle-bottom-panel-launcher:";
/// Event emitted for tray icon/menu interactions.
pub const NATIVE_TRAY_EVENT: &str = "native-tray";
/// Stable id of the system tray icon (useful for `app.tray_by_id`).
pub const TRAY_ICON_ID: &str = "codex-tray";

const SHORTCUT_MENU_ITEMS: [(&str, &str, &str); 11] = [
    ("new-chat", "new-chat", "CmdOrCtrl+N"),
    ("open-settings", "settings", "CmdOrCtrl+,"),
    ("toggle-sidebar", "toggle-sidebar", "CmdOrCtrl+Shift+S"),
    ("toggle-terminal", "toggle-terminal", "Control+`"),
    ("toggle-bottom-panel", "toggle-bottom-panel", "CmdOrCtrl+J"),
    ("toggle-changes", "toggle-changes", "CmdOrCtrl+Alt+B"),
    ("command-palette", "command-palette", "CmdOrCtrl+K"),
    ("file-search", "file-search", "CmdOrCtrl+P"),
    ("zoom-in", "zoom-in", "CmdOrCtrl+="),
    ("zoom-out", "zoom-out", "CmdOrCtrl+-"),
    ("zoom-reset", "zoom-reset", "CmdOrCtrl+0"),
];

type ShortcutMap = BTreeMap<String, Option<String>>;

pub struct ShortcutMenuState(Mutex<ShortcutMenuSnapshot>);

#[derive(Clone)]
struct ShortcutMenuSnapshot {
    applied: ShortcutMap,
    latest: ShortcutMap,
    windows: BTreeMap<String, (u64, ShortcutMap)>,
    capturing: BTreeSet<String>,
    sequence: u64,
}

impl Default for ShortcutMenuSnapshot {
    fn default() -> Self {
        let defaults: ShortcutMap = SHORTCUT_MENU_ITEMS.iter()
            .map(|(command, _, accelerator)| ((*command).to_string(), Some((*accelerator).to_string())))
            .collect();
        Self { applied: defaults.clone(), latest: defaults, windows: BTreeMap::new(), capturing: BTreeSet::new(), sequence: 0 }
    }
}

impl ShortcutMenuSnapshot {
    fn sync_window(&mut self, window: &str, accelerators: ShortcutMap, capturing: bool) {
        self.sequence += 1;
        self.latest = accelerators.clone();
        self.windows.insert(window.to_string(), (self.sequence, accelerators));
        if capturing { self.capturing.insert(window.to_string()); }
        else { self.capturing.remove(window); }
    }

    fn remove_window(&mut self, window: &str) {
        self.capturing.remove(window);
        self.windows.remove(window);
        if let Some((_, accelerators)) = self.windows.values().max_by_key(|(sequence, _)| *sequence) {
            self.latest = accelerators.clone();
        }
    }

    fn effective(&self) -> ShortcutMap {
        if self.capturing.is_empty() { self.latest.clone() }
        else { SHORTCUT_MENU_ITEMS.iter().map(|(command, _, _)| ((*command).to_string(), None)).collect() }
    }
}

impl Default for ShortcutMenuState {
    fn default() -> Self {
        Self(Mutex::new(ShortcutMenuSnapshot::default()))
    }
}

// Tauri 2.12 silently converts parse errors to None and does not export muda's
// parser. Validate the physical-key vocabulary we accept before calling it.
fn validate_accelerator(value: &str) -> Result<(), String> {
    let tokens: Vec<_> = value.split('+').collect();
    let (key, modifiers) = tokens
        .split_last()
        .ok_or_else(|| "empty accelerator".to_string())?;
    for modifier in modifiers {
        if !matches!(
            modifier.to_ascii_uppercase().as_str(),
            "CTRL" | "CONTROL" | "SHIFT" | "ALT" | "OPTION" | "CMD" | "COMMAND"
                | "SUPER" | "CMDORCTRL" | "COMMANDORCONTROL"
                | "COMMANDORCTRL" | "CMDORCONTROL"
        ) {
            return Err(format!("unsupported accelerator modifier: {modifier}"));
        }
    }
    let key = key.to_ascii_uppercase();
    let single = key.len() == 1
        && (key.as_bytes()[0].is_ascii_alphanumeric()
            || "`\\[],=-.;/'".contains(key.as_str()));
    let numbered = |prefix: &str, min, max| {
        key.strip_prefix(prefix)
            .and_then(|number| number.parse::<u8>().ok())
            .is_some_and(|number| {
                (min..=max).contains(&number) && key == format!("{prefix}{number}")
            })
    };
    let valid = single
        || (key.len() == 4 && key.starts_with("KEY") && key.as_bytes()[3].is_ascii_uppercase())
        || numbered("DIGIT", 0, 9)
        || numbered("NUMPAD", 0, 9)
        || numbered("F", 1, 24)
        || matches!(
            key.as_str(),
            "BACKQUOTE" | "BACKSLASH" | "BRACKETLEFT" | "BRACKETRIGHT" | "COMMA"
                | "EQUAL" | "MINUS" | "PERIOD" | "QUOTE" | "SEMICOLON" | "SLASH"
                | "BACKSPACE" | "CAPSLOCK" | "ENTER" | "SPACE" | "TAB" | "DELETE"
                | "END" | "HOME" | "INSERT" | "PAGEDOWN" | "PAGEUP" | "PRINTSCREEN"
                | "SCROLLLOCK" | "ARROWDOWN" | "ARROWLEFT" | "ARROWRIGHT" | "ARROWUP"
                | "DOWN" | "LEFT" | "RIGHT" | "UP" | "NUMLOCK" | "NUMPADADD"
                | "NUMPADDECIMAL" | "NUMPADDIVIDE" | "NUMPADENTER" | "NUMPADEQUAL"
                | "NUMPADMULTIPLY" | "NUMPADSUBTRACT" | "ESCAPE" | "ESC"
                | "AUDIOVOLUMEDOWN" | "AUDIOVOLUMEUP" | "AUDIOVOLUMEMUTE"
        );
    if valid {
        Ok(())
    } else {
        Err(format!("unsupported accelerator key: {key}"))
    }
}

fn validate_shortcut_map(accelerators: &BTreeMap<String, Option<String>>) -> Result<(), String> {
    for (command, accelerator) in accelerators {
        if !SHORTCUT_MENU_ITEMS.iter().any(|(id, _, _)| command == id) {
            return Err(format!("unknown native shortcut command: {command}"));
        }
        if let Some(value) = accelerator {
            validate_accelerator(value).map_err(|error| format!("{command}: {error}"))?;
        }
    }
    for (command, _, _) in SHORTCUT_MENU_ITEMS {
        if !accelerators.contains_key(command) {
            return Err(format!("missing native shortcut command: {command}"));
        }
    }
    Ok(())
}

fn find_menu_item<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
) -> tauri::Result<Option<MenuItem<R>>> {
    for item in items {
        match item {
            MenuItemKind::MenuItem(item) if item.id().as_ref() == id => return Ok(Some(item)),
            MenuItemKind::Submenu(submenu) => {
                if let Some(item) = find_menu_item(submenu.items()?, id)? {
                    return Ok(Some(item));
                }
            }
            _ => {}
        }
    }
    Ok(None)
}

pub fn sync_shortcut_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: &ShortcutMenuState,
    accelerators: BTreeMap<String, Option<String>>,
    window: &str,
    capturing: bool,
) -> Result<(), String> {
    validate_shortcut_map(&accelerators)?;
    let mut state = state.0.lock().map_err(|error| error.to_string())?;
    let mut next = state.clone();
    next.sync_window(window, accelerators, capturing);
    let effective = next.effective();
    apply_shortcut_map(app, &state.applied, &effective)?;
    next.applied = effective;
    *state = next;
    Ok(())
}

pub fn remove_shortcut_window<R: Runtime>(app: &AppHandle<R>, window: &str) -> Result<(), String> {
    let state = app.state::<ShortcutMenuState>();
    let mut state = state.0.lock().map_err(|error| error.to_string())?;
    state.remove_window(window);
    let effective = state.effective();
    // Ownership is released even if a disappearing application menu cannot be updated.
    apply_shortcut_map(app, &state.applied, &effective)?;
    state.applied = effective;
    Ok(())
}

fn apply_shortcut_map<R: Runtime>(
    app: &AppHandle<R>,
    previous: &ShortcutMap,
    accelerators: &ShortcutMap,
) -> Result<(), String> {
    if previous == accelerators { return Ok(()); }
    let menu = app.menu().ok_or("application menu is unavailable")?;
    let mut prepared = Vec::new();
    for (command, menu_id, _) in SHORTCUT_MENU_ITEMS {
        let item = find_menu_item(menu.items().map_err(|error| error.to_string())?, menu_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("native menu item is missing: {menu_id}"))?;
        prepared.push((command, item));
    }
    for (index, (command, item)) in prepared.iter().enumerate() {
        if let Err(error) = item.set_accelerator(accelerators[*command].as_deref()) {
            let mut rollback_errors = Vec::new();
            for (rollback_command, rollback_item) in prepared[..=index].iter().rev() {
                if let Err(rollback_error) =
                    rollback_item.set_accelerator(previous[*rollback_command].as_deref())
                {
                    rollback_errors.push(format!("{rollback_command}: {rollback_error}"));
                }
            }
            return Err(format!(
                "native shortcut update failed for {command}: {error}; rollback: {}",
                if rollback_errors.is_empty() {
                    "complete".to_string()
                } else {
                    rollback_errors.join("; ")
                }
            ));
        }
    }
    Ok(())
}

/// Small helper so the menu tables below stay readable.
fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    let accelerator = SHORTCUT_MENU_ITEMS
        .iter()
        .find(|(_, menu_id, _)| *menu_id == id)
        .map(|(_, _, value)| *value)
        .or(accelerator);
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
            &item(app, "toggle-terminal", "Open Terminal", Some("Control+`"))?,
            &item(app, "toggle-bottom-panel", "Toggle Bottom Panel", Some("CmdOrCtrl+J"))?,
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
    if let Some(label) = id.strip_prefix(BOTTOM_PANEL_LAUNCHER_MENU_PREFIX) {
        let _ = app.emit_to(label, NATIVE_MENU_EVENT, json!({ "id": "toggle-bottom-panel-launcher" }));
        return;
    }
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
            emit_focused_menu(
                app,
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
                if let Some(window) = focused_menu_window(app) {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                }
            }
            emit_focused_menu(app, json!({ "id": "toggle-devtools" }));
        }
        // Known application menu ids -> forward to the webview.
        "new-chat"
        | "open-workspace"
        | "settings"
        | "quit"
        | "toggle-sidebar"
        | "toggle-terminal"
        | "toggle-bottom-panel"
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
            emit_focused_menu(app, json!({ "id": id }));
        }
        // Predefined items (undo/copy/separators/…) have no frontend action.
        _ => {}
    }
}

#[tauri::command]
pub async fn bottom_panel_launcher_menu(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    checked: bool,
) -> Result<(), String> {
    let id = format!("{BOTTOM_PANEL_LAUNCHER_MENU_PREFIX}{}", window.label());
    let label = if checked { "✓ 底部面板" } else { "底部面板" };
    let item = MenuItem::with_id(&window, id, label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(&window, &[&item]).map_err(|error| error.to_string())?;
    window.popup_menu_at(&menu, tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

fn focused_menu_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|window| {
            (window.label() == "main" || window.label().starts_with("thread-"))
                && window.is_focused().unwrap_or(false)
        })
        .or_else(|| app.get_webview_window("main"))
}

fn emit_focused_menu<R: Runtime>(app: &AppHandle<R>, payload: serde_json::Value) {
    if let Some(window) = focused_menu_window(app) {
        let _ = app.emit_to(window.label(), NATIVE_MENU_EVENT, payload);
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

#[cfg(test)]
mod shortcut_tests {
    use super::*;

    fn defaults() -> BTreeMap<String, Option<String>> {
        ShortcutMenuState::default().0.into_inner().unwrap().applied
    }

    #[test]
    fn another_window_sync_or_release_cannot_restore_during_capture() {
        let mut state = ShortcutMenuSnapshot::default();
        state.sync_window("a", defaults(), true);
        assert!(state.effective().values().all(Option::is_none));
        let mut latest = defaults();
        latest.insert("new-chat".into(), Some("Ctrl+Alt+N".into()));
        state.sync_window("b", latest.clone(), false);
        assert!(state.effective().values().all(Option::is_none));
        state.sync_window("b", latest.clone(), false);
        assert!(state.effective().values().all(Option::is_none));
        state.remove_window("b");
        assert!(state.effective().values().all(Option::is_none));
        state.sync_window("a", latest.clone(), false);
        assert_eq!(state.effective(), latest);
    }

    #[test]
    fn capture_owners_release_independently_and_destroyed_windows_do_not_leak() {
        let mut state = ShortcutMenuSnapshot::default();
        state.sync_window("a", defaults(), true);
        let mut latest = defaults();
        latest.insert("new-chat".into(), Some("Ctrl+Alt+N".into()));
        state.sync_window("b", latest.clone(), true);
        state.sync_window("a", defaults(), false);
        assert!(state.effective().values().all(Option::is_none));
        state.sync_window("b", latest.clone(), true);
        state.remove_window("a");
        assert!(state.effective().values().all(Option::is_none));
        state.remove_window("b");
        assert_eq!(state.effective(), latest);
        assert!(state.capturing.is_empty());
        assert!(state.windows.is_empty());
    }

    #[test]
    fn complete_mapping_and_explicit_removal_are_validated() {
        let mut bindings = defaults();
        validate_shortcut_map(&bindings).unwrap();
        bindings.insert("new-chat".into(), None);
        validate_shortcut_map(&bindings).unwrap();
        bindings.remove("open-settings");
        assert!(validate_shortcut_map(&bindings).unwrap_err().contains("open-settings"));
        bindings = defaults();
        bindings.insert("settings".into(), None);
        assert!(validate_shortcut_map(&bindings).unwrap_err().contains("unknown"));
        assert_eq!(SHORTCUT_MENU_ITEMS[1].1, "settings");
    }

    #[test]
    fn invalid_values_are_rejected_before_native_updates() {
        for invalid in ["", "Ctrl+", "Ctrl++", "Ctrl+K Ctrl+Q", "Bogus+A", "Ctrl+F25", "Ctrl+F01", "Ctrl+Digit01", "Meta+A"] {
            assert!(validate_accelerator(invalid).is_err(), "{invalid}");
        }
        for valid in ["Ctrl+Shift+KeyA", "CmdOrCtrl+,", "Ctrl+Equal", "Alt+F24", "Ctrl+Space", "Ctrl+BracketLeft"] {
            validate_accelerator(valid).unwrap();
        }
    }
}
