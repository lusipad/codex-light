use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct PersonalInstructionsState(Mutex<()>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalInstructions {
    path: String,
    contents: String,
    has_override: bool,
}

fn read_at(home: &Path) -> Result<PersonalInstructions, String> {
    fs::create_dir_all(home).map_err(|error| error.to_string())?;
    let path = home.join("AGENTS.md");
    // Match the native reference: opening the editor creates a missing file.
    match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("无法创建 Codex 指令文件：{error}")),
    }
    let contents = fs::read_to_string(&path).map_err(|error| format!("无法读取 Codex 指令：{error}"))?;
    let has_override = match fs::read_to_string(home.join("AGENTS.override.md")) {
        Ok(contents) => !contents.trim().is_empty(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("无法读取覆盖指令：{error}")),
    };
    Ok(PersonalInstructions {
        path: crate::state::normalize_fs_path(&path.to_string_lossy()),
        contents,
        has_override,
    })
}

fn write_at(home: &Path, contents: &str, expected_contents: &str) -> Result<PersonalInstructions, String> {
    let before = read_at(home)?;
    if before.contents != expected_contents {
        return Err("指令文件已被其他程序修改，草稿已保留。请重新加载后再保存。".into());
    }
    fs::write(home.join("AGENTS.md"), contents)
        .map_err(|error| format!("无法保存 Codex 指令：{error}"))?;
    let saved = read_at(home)
        .map_err(|error| format!("指令已写入，但读回失败：{error}"))?;
    if saved.contents != contents {
        return Err("指令已写入，但读回内容不同，请重新加载核对。".into());
    }
    Ok(saved)
}

#[tauri::command]
pub fn personal_instructions_read(state: State<'_, PersonalInstructionsState>) -> Result<PersonalInstructions, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    read_at(&crate::state::codex_home_dir())
}

#[tauri::command]
pub fn personal_instructions_write(
    state: State<'_, PersonalInstructionsState>,
    contents: String,
    expected_contents: String,
) -> Result<PersonalInstructions, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    write_at(&crate::state::codex_home_dir(), &contents, &expected_contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_instructions_roundtrip_preserves_text_clear_and_override() {
        let home = std::env::temp_dir().join(format!("codex-personal-{}", uuid::Uuid::new_v4()));
        let initial = read_at(&home).unwrap();
        assert_eq!(initial.contents, "");
        assert!(!initial.has_override);
        assert!(home.join("AGENTS.md").is_file());
        let text = "  用中文回答。\r\n\r\n保留原始空白。  \n";
        let saved = write_at(&home, text, "").unwrap();
        assert_eq!(saved.contents, text);
        assert_eq!(fs::read_to_string(home.join("AGENTS.md")).unwrap(), text);
        fs::write(home.join("AGENTS.override.md"), " \r\n\t").unwrap();
        assert!(!read_at(&home).unwrap().has_override);
        fs::write(home.join("AGENTS.override.md"), "override").unwrap();
        assert!(read_at(&home).unwrap().has_override);
        assert_eq!(write_at(&home, "", text).unwrap().contents, "");
        assert_eq!(fs::read_to_string(home.join("AGENTS.override.md")).unwrap(), "override");
        fs::remove_file(home.join("AGENTS.md")).unwrap();
        fs::remove_file(home.join("AGENTS.override.md")).unwrap();
        fs::remove_dir(home).unwrap();
    }

    #[test]
    fn isolated_instructions_conflicts_and_io_failures_do_not_report_success() {
        let home = std::env::temp_dir().join(format!("codex-personal-{}", uuid::Uuid::new_v4()));
        read_at(&home).unwrap();
        fs::write(home.join("AGENTS.md"), "external").unwrap();
        assert!(write_at(&home, "draft", "").unwrap_err().contains("其他程序修改"));
        assert_eq!(fs::read_to_string(home.join("AGENTS.md")).unwrap(), "external");
        fs::create_dir(home.join("AGENTS.override.md")).unwrap();
        assert!(read_at(&home).is_err());
        assert!(write_at(&home, "draft", "external").is_err());
        assert_eq!(fs::read_to_string(home.join("AGENTS.md")).unwrap(), "external");
        fs::remove_dir(home.join("AGENTS.override.md")).unwrap();
        fs::remove_file(home.join("AGENTS.md")).unwrap();
        fs::write(&home.join("AGENTS.md"), [0xff, 0xfe]).unwrap();
        assert!(read_at(&home).is_err());
        fs::remove_file(home.join("AGENTS.md")).unwrap();
        fs::remove_dir(&home).unwrap();
        fs::write(&home, "not a directory").unwrap();
        assert!(read_at(&home).is_err());
        fs::remove_file(home).unwrap();
    }
}
