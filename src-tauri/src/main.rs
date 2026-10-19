// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("Codex Crash: {}\n", info);
        let log_path = dirs::home_dir()
            .map(|h| h.join(".codex").join("crash.log"))
            .unwrap_or_else(|| std::path::PathBuf::from("codex-crash.log"));
        let _ = std::fs::write(&log_path, &msg);
        let _ = rfd::MessageDialog::new()
            .set_title("Codex Crash")
            .set_description(&msg)
            .set_level(rfd::MessageLevel::Error)
            .show();
    }));

    codex_tauri_lib::run()
}
