use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct KeyBinding {
    pub command: String,
    pub key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct KeyBindingsRead {
    pub bindings: Vec<KeyBinding>,
    pub warning: Option<String>,
}

#[derive(Default)]
pub struct KeyBindingsState(Mutex<()>);

fn read_at(directory: &Path) -> Result<KeyBindingsRead, String> {
    if directory.is_file() {
        return Err(format!("Keybindings directory is a file: {}", directory.display()));
    }
    let path = directory.join("keybindings.json");
    match fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str::<Vec<KeyBinding>>(&contents) {
            Ok(bindings) => Ok(KeyBindingsRead { bindings, warning: None }),
            Err(error) => Ok(KeyBindingsRead {
                bindings: Vec::new(),
                warning: Some(format!("Invalid keybindings.json: {error}")),
            }),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(KeyBindingsRead { bindings: Vec::new(), warning: None })
        }
        Err(error) => Err(format!("Cannot read {}: {error}", path.display())),
    }
}

fn write_at(directory: &Path, mut bindings: Vec<KeyBinding>) -> Result<KeyBindingsRead, String> {
    bindings.sort_by(|left, right| left.command.cmp(&right.command));
    let contents = serde_json::to_string_pretty(&bindings).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("Cannot create keybindings directory: {error}"))?;
    let path = directory.join("keybindings.json");
    fs::write(&path, contents).map_err(|error| format!("Cannot write {}: {error}", path.display()))?;
    let result = read_at(directory)
        .map_err(|error| format!("Keybindings saved but readback failed: {error}"))?;
    if let Some(warning) = &result.warning {
        return Err(format!("Keybindings saved but readback failed: {warning}"));
    }
    if result.bindings != bindings {
        return Err("Keybindings saved but readback did not match the written bindings".into());
    }
    Ok(result)
}

#[tauri::command]
pub fn keyboard_bindings_read(state: State<'_, KeyBindingsState>) -> Result<KeyBindingsRead, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    read_at(&crate::state::codex_home_dir())
}

#[tauri::command]
pub fn keyboard_bindings_write(
    state: State<'_, KeyBindingsState>,
    bindings: Vec<KeyBinding>,
) -> Result<KeyBindingsRead, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    write_at(&crate::state::codex_home_dir(), bindings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_roundtrip_preserves_unknown_commands_and_null_unbinding() {
        let directory = std::env::temp_dir().join(format!("codex-keybindings-{}", uuid::Uuid::new_v4()));
        assert!(read_at(&directory).unwrap().bindings.is_empty());
        let bindings = vec![
            KeyBinding { command: "z-future-command".into(), key: Some("Ctrl+K Ctrl+Q".into()) },
            KeyBinding { command: "new-chat".into(), key: None },
        ];
        let result = write_at(&directory, bindings).unwrap();
        assert_eq!(result.bindings[0].command, "new-chat");
        assert_eq!(result.bindings[0].key, None);
        assert_eq!(result.bindings[1].key.as_deref(), Some("Ctrl+K Ctrl+Q"));
        assert!(result.warning.is_none());
        assert!(serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(directory.join("keybindings.json")).unwrap()
        ).unwrap().is_array());
        fs::write(directory.join("keybindings.json"), r#"{"bindings":[]}"#).unwrap();
        let malformed = read_at(&directory).unwrap();
        assert!(malformed.bindings.is_empty());
        assert!(malformed.warning.is_some());
        // Only known test files are removed; never touch the user's CODEX_HOME.
        fs::remove_file(directory.join("keybindings.json")).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn storage_failure_is_visible() {
        let path = std::env::temp_dir().join(format!("codex-keybindings-file-{}", uuid::Uuid::new_v4()));
        fs::write(&path, "not a directory").unwrap();
        assert!(read_at(&path).is_err());
        assert!(write_at(&path, Vec::new()).is_err());
        fs::remove_file(path).unwrap();
    }
}
