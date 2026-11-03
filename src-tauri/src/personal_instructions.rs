use crate::agent_configuration::{directory_identity, reject_links};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Default)]
pub struct PersonalInstructionsState(tokio::sync::Mutex<()>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalInstructions {
    path: String,
    contents: String,
    has_override: bool,
    host_id: String,
}

fn prepare_home(home: &Path) -> Result<PathBuf, String> {
    reject_links(home)?;
    fs::create_dir_all(home).map_err(|error| format!("无法创建指令目录：{error}"))?;
    reject_links(home)?;
    fs::canonicalize(home).map_err(|error| error.to_string())
}

fn host_identity(home: &Path) -> Result<String, String> {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    directory_identity(home)?.hash(&mut hash);
    Ok(format!("local:{:016x}", hash.finish()))
}

fn open_file(path: &Path, write: bool, create_new: bool) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.read(true).write(write).create_new(create_new);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0).custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    options.open(path)
}

fn ensure_regular(file: &File) -> Result<(), String> {
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("指令路径不是普通文件。".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("指令文件不能是链接或重解析点。".into());
        }
    }
    Ok(())
}

fn optional_text(path: &Path) -> Result<Option<String>, String> {
    reject_links(path)?;
    let mut file = match open_file(path, false, false) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    ensure_regular(&file)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|error| error.to_string())?;
    Ok(Some(contents))
}

fn read_at(home: &Path) -> Result<PersonalInstructions, String> {
    let home = prepare_home(home)?;
    let identity = directory_identity(&home)?;
    let path = home.join("AGENTS.md");
    reject_links(&path)?;
    // Opening the official local editor creates a missing AGENTS.md file.
    match open_file(&path, true, true) {
        Ok(file) => file.sync_all().map_err(|error| error.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("无法创建 Codex 指令文件：{error}")),
    }
    let contents = optional_text(&path)?.ok_or("指令文件在读取过程中已被删除。")?;
    let has_override = optional_text(&home.join("AGENTS.override.md"))
        .map_err(|error| format!("无法读取覆盖指令：{error}"))?
        .is_some_and(|contents| !contents.trim().is_empty());
    if identity != directory_identity(&home)? {
        return Err("指令目录已被替换，请重新加载。".into());
    }
    Ok(PersonalInstructions {
        path: crate::state::normalize_fs_path(&path.to_string_lossy()),
        contents,
        has_override,
        host_id: host_identity(&home)?,
    })
}

#[cfg(test)]
fn write_at(
    home: &Path,
    contents: &str,
    expected_contents: &str,
) -> Result<PersonalInstructions, String> {
    let before = read_at(home)?;
    write_observed(
        home,
        contents,
        expected_contents,
        Some(&before.path),
        Some(&before.host_id),
    )
}

fn check_context(
    current: &PersonalInstructions,
    expected_path: Option<&str>,
    expected_host: Option<&str>,
) -> Result<(), String> {
    if expected_path.is_none() && expected_host.is_none() {
        return Err("缺少已读取的执行主机身份，请重新加载指令。".into());
    }
    if expected_path.is_some_and(|path| path != current.path)
        || expected_host.is_some_and(|host| host != current.host_id)
    {
        return Err("执行主机或指令目录已改变，草稿已保留。请重新加载后再保存。".into());
    }
    Ok(())
}

fn write_observed(
    home: &Path,
    contents: &str,
    expected_contents: &str,
    expected_path: Option<&str>,
    expected_host: Option<&str>,
) -> Result<PersonalInstructions, String> {
    // Reject a stale host before read_at is allowed to create a missing AGENTS.md.
    reject_links(home)?;
    let canonical =
        fs::canonicalize(home).map_err(|error| format!("执行主机目录不可用：{error}"))?;
    let observed = PersonalInstructions {
        path: crate::state::normalize_fs_path(&canonical.join("AGENTS.md").to_string_lossy()),
        contents: String::new(),
        has_override: false,
        host_id: host_identity(&canonical)?,
    };
    check_context(&observed, expected_path, expected_host)?;
    let before = read_at(home)?;
    check_context(&before, expected_path, expected_host)?;
    let identity = directory_identity(home)?;
    let path = home.join("AGENTS.md");
    reject_links(&path)?;
    let mut file = open_file(&path, true, false)
        .map_err(|error| format!("指令文件已变化或正被占用：{error}"))?;
    ensure_regular(&file)?;
    let mut original = String::new();
    file.read_to_string(&mut original)
        .map_err(|error| error.to_string())?;
    if original != expected_contents {
        return Err("指令文件已被其他程序修改，草稿已保留。请重新加载后再保存。".into());
    }
    reject_links(&path)?;
    if identity != directory_identity(home)? {
        return Err("指令目录在保存前已被替换。".into());
    }
    // Validate the override before changing the body, including failures after the initial read.
    optional_text(&home.join("AGENTS.override.md"))
        .map_err(|error| format!("无法读取覆盖指令：{error}"))?;
    let replace = |file: &mut File, text: &str| -> std::io::Result<()> {
        file.seek(SeekFrom::Start(0))?;
        file.write_all(text.as_bytes())?;
        file.set_len(text.len() as u64)?;
        file.sync_all()
    };
    if let Err(error) = replace(&mut file, contents) {
        let restored = replace(&mut file, &original).is_ok();
        return Err(format!(
            "无法保存 Codex 指令：{error}；原文恢复{}。",
            if restored {
                "成功"
            } else {
                "失败，请检查文件"
            }
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut actual = String::new();
    file.read_to_string(&mut actual)
        .map_err(|error| error.to_string())?;
    if actual != contents {
        return Err("指令已写入，但句柄读回不同。".into());
    }
    drop(file);
    if identity != directory_identity(home)? {
        return Err("指令已写入，但目录已被替换，请重新读取。".into());
    }
    let saved = read_at(home).map_err(|error| format!("指令已写入，但读回失败：{error}"))?;
    if saved.contents != contents || saved.host_id != before.host_id {
        return Err("指令已写入，但读回内容不同，请重新加载核对。".into());
    }
    Ok(saved)
}

fn execution_home(snapshot: &Value) -> Result<PathBuf, String> {
    let file = snapshot["layers"]
        .as_array()
        .and_then(|layers| {
            layers
                .iter()
                .rev()
                .find(|layer| layer["name"]["type"] == "user")
        })
        .and_then(|layer| layer["name"]["file"].as_str())
        .ok_or("服务未返回真实用户配置层，无法确定执行主机。")?;
    let path = Path::new(file);
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
            || !path.is_absolute()
        {
            return Err(
                "当前执行主机不是受支持的本机 Windows 路径；未读写 WSL 或远程指令。".into(),
            );
        }
    }
    #[cfg(not(windows))]
    return Err("当前指令编辑器仅支持本机 Windows 执行主机。".into());
    #[allow(unreachable_code)]
    {
        reject_links(path)?;
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "服务用户配置目录无效。".into())
    }
}

async fn current_home(app: &AppHandle, state: &crate::AppState) -> Result<PathBuf, String> {
    let snapshot = state
        .app_server
        .call(
            app,
            "config/read",
            Some(json!({"includeLayers":true,"cwd":null})),
        )
        .await?;
    execution_home(&snapshot)
}

#[tauri::command]
pub async fn personal_instructions_read(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    instructions: State<'_, PersonalInstructionsState>,
) -> Result<PersonalInstructions, String> {
    let _guard = instructions.0.lock().await;
    read_at(&current_home(&app, &state).await?)
}

#[tauri::command]
pub async fn personal_instructions_write(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
    instructions: State<'_, PersonalInstructionsState>,
    contents: String,
    expected_contents: String,
    expected_path: Option<String>,
    expected_host_id: Option<String>,
) -> Result<PersonalInstructions, String> {
    let _guard = instructions.0.lock().await;
    let home = current_home(&app, &state).await?;
    let saved = write_observed(
        &home,
        &contents,
        &expected_contents,
        expected_path.as_deref(),
        expected_host_id.as_deref(),
    )?;
    for label in app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() != window.label())
    {
        let _ = app.emit_to(
            label.as_str(),
            "personal-instructions-changed",
            json!({"hostId":saved.host_id,"path":saved.path}),
        );
    }
    Ok(saved)
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
        assert_eq!(
            fs::read_to_string(home.join("AGENTS.override.md")).unwrap(),
            "override"
        );
        fs::remove_file(home.join("AGENTS.md")).unwrap();
        fs::remove_file(home.join("AGENTS.override.md")).unwrap();
        fs::remove_dir(home).unwrap();
    }

    #[test]
    fn isolated_instructions_conflicts_and_io_failures_do_not_report_success() {
        let home = std::env::temp_dir().join(format!("codex-personal-{}", uuid::Uuid::new_v4()));
        read_at(&home).unwrap();
        fs::write(home.join("AGENTS.md"), "external").unwrap();
        assert!(write_at(&home, "draft", "")
            .unwrap_err()
            .contains("其他程序修改"));
        assert_eq!(
            fs::read_to_string(home.join("AGENTS.md")).unwrap(),
            "external"
        );
        fs::create_dir(home.join("AGENTS.override.md")).unwrap();
        assert!(read_at(&home).is_err());
        assert!(write_at(&home, "draft", "external").is_err());
        assert_eq!(
            fs::read_to_string(home.join("AGENTS.md")).unwrap(),
            "external"
        );
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

    #[test]
    fn personal_instructions_reject_stale_home_before_creating_missing_file() {
        let root =
            std::env::temp_dir().join(format!("codex-personal-context-{}", uuid::Uuid::new_v4()));
        let home = root.join("execution");
        fs::create_dir_all(&home).unwrap();
        let first = read_at(&home).unwrap();
        fs::write(home.join("AGENTS.md"), "original").unwrap();
        assert!(write_observed(&home, "wrong", "original", None, None).is_err());
        assert!(write_observed(
            &home,
            "wrong",
            "original",
            Some("C:/another/AGENTS.md"),
            Some(&first.host_id)
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(home.join("AGENTS.md")).unwrap(),
            "original"
        );
        let old = root.join("preserved");
        fs::rename(&home, &old).unwrap();
        fs::create_dir(&home).unwrap();
        assert!(
            write_observed(&home, "stale", "", Some(&first.path), Some(&first.host_id)).is_err()
        );
        assert!(!home.join("AGENTS.md").exists());
        assert_eq!(
            fs::read_to_string(old.join("AGENTS.md")).unwrap(),
            "original"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn personal_instructions_observed_context_preserves_raw_text_and_detects_external_edits() {
        let home =
            std::env::temp_dir().join(format!("codex-personal-observed-{}", uuid::Uuid::new_v4()));
        let initial = read_at(&home).unwrap();
        let text = "\u{feff}中文\r\n  keep indentation \r\n\n";
        let saved =
            write_observed(&home, text, "", Some(&initial.path), Some(&initial.host_id)).unwrap();
        assert_eq!(saved.host_id, initial.host_id);
        assert_eq!(fs::read(home.join("AGENTS.md")).unwrap(), text.as_bytes());
        fs::write(home.join("AGENTS.md"), "external").unwrap();
        assert!(write_observed(
            &home,
            "draft",
            text,
            Some(&saved.path),
            Some(&saved.host_id)
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(home.join("AGENTS.md")).unwrap(),
            "external"
        );
        fs::write(home.join("AGENTS.override.md"), [0xff, 0xfe]).unwrap();
        assert!(write_observed(
            &home,
            "draft",
            "external",
            Some(&saved.path),
            Some(&saved.host_id)
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(home.join("AGENTS.md")).unwrap(),
            "external"
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn personal_instructions_concurrent_writers_only_commit_one_observed_revision() {
        let home = std::env::temp_dir().join(format!(
            "codex-personal-concurrent-{}",
            uuid::Uuid::new_v4()
        ));
        let initial = read_at(&home).unwrap();
        let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
        let state = std::sync::Arc::new(PersonalInstructionsState::default());
        let jobs = ["first", "second"]
            .into_iter()
            .map(|text| {
                let home = home.clone();
                let gate = gate.clone();
                let path = initial.path.clone();
                let host = initial.host_id.clone();
                let state = state.clone();
                std::thread::spawn(move || {
                    gate.wait();
                    let _guard = state.0.blocking_lock();
                    write_observed(&home, text, "", Some(&path), Some(&host))
                })
            })
            .collect::<Vec<_>>();
        let results = jobs
            .into_iter()
            .map(|job| job.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(["first", "second"]
            .contains(&fs::read_to_string(home.join("AGENTS.md")).unwrap().as_str()));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn personal_instructions_execution_home_has_no_process_home_fallback() {
        assert!(execution_home(&json!({"config":{},"layers":[]})).is_err());
        assert!(execution_home(
            &json!({"layers":[{"name":{"type":"project","dotCodexFolder":"C:/project/.codex"}}]})
        )
        .is_err());
        for file in [
            "/home/user/.codex/config.toml",
            "relative/config.toml",
            "//wsl.localhost/Ubuntu/home/user/.codex/config.toml",
        ] {
            assert!(
                execution_home(&json!({"layers":[{"name":{"type":"user","file":file}}]})).is_err()
            );
        }
        #[cfg(windows)]
        {
            let home = std::env::temp_dir()
                .join(format!("codex-personal-discovery-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&home).unwrap();
            let file = home.join("config.toml");
            let snapshot = json!({"layers":[{"name":{"type":"user","file":file}}]});
            assert_eq!(execution_home(&snapshot).unwrap(), home);
            assert!(!home.join("AGENTS.md").exists());
            fs::remove_dir(home).unwrap();
        }
    }
}
