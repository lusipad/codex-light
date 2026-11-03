use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
const TEMPLATE: &str = "version = 1\nname = \"Default Environment\"\n\n[setup]\nscript = \"\"\n";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Lifecycle {
    script: String,
    darwin: Option<Script>,
    linux: Option<Script>,
    win32: Option<Script>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Script { script: String }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Action {
    name: String,
    command: String,
    icon: Option<String>,
    platform: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
pub struct Environment {
    #[serde(default = "default_version")]
    version: u64,
    name: String,
    setup: Lifecycle,
    cleanup: Option<Lifecycle>,
    #[serde(default)]
    actions: Vec<Action>,
}
fn default_version() -> u64 { 1 }

fn parse(raw: &str) -> Result<Environment, String> {
    let env: Environment = toml::from_str(raw).map_err(|e| format!("环境结构无效：{e}"))?;
    if env.version == 0 || env.name.trim().is_empty() {
        return Err("环境版本必须大于零，名称不能为空。".into());
    }
    for action in &env.actions {
        if action.name.trim().is_empty() || action.command.trim().is_empty()
            || action.platform.as_ref().is_some_and(|p| !["win32", "linux", "darwin"].contains(&p.as_str()))
            || action.icon.as_ref().is_some_and(|p| !["tool", "run", "debug", "test"].contains(&p.as_str())) {
            return Err("动作名称、命令、平台或图标无效。".into());
        }
    }
    Ok(env)
}

fn directory(cwd: &str) -> Result<PathBuf, String> {
    if cwd.trim().is_empty() { return Err("请先选择工作区。".into()); }
    let root = fs::canonicalize(cwd).map_err(|e| e.to_string())?;
    if !root.is_dir() { return Err("工作区不是目录。".into()); }
    let mut dir = root.clone();
    for name in [".codex", "environments"] {
        dir = dir.join(name);
        if dir.exists() {
            let resolved = fs::canonicalize(&dir).map_err(|e| e.to_string())?;
            if !resolved.starts_with(&root) || !resolved.is_dir() {
                return Err("环境目录必须位于当前工作区内。".into());
            }
        }
    }
    Ok(dir)
}
fn config_path(cwd: &str, file_name: &str) -> Result<PathBuf, String> {
    if !file_name.ends_with(".toml") || file_name.contains(['/', '\\', ':']) || file_name.starts_with('.') {
        return Err("请选择环境目录内的 TOML 文件。".into());
    }
    let path = directory(cwd)?.join(file_name);
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("环境文件不能是符号链接。".into());
    }
    Ok(path)
}
fn contents(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn read(cwd: &str, file_name: Option<&str>) -> Result<serde_json::Value, String> {
    let dir = directory(cwd)?;
    let mut files = Vec::new();
    match fs::read_dir(&dir) {
        Ok(entries) => for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".toml") && entry.file_type().map_err(|e| e.to_string())?.is_file() {
                files.push(name);
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(e) => return Err(e.to_string()),
    }
    files.sort_by_key(|name| (name != "environment.toml", name.clone()));
    let selected = file_name.unwrap_or_else(|| files.first().map(String::as_str).unwrap_or("environment.toml"));
    let path = config_path(cwd, selected)?;
    let raw = contents(&path)?;
    let text = raw.as_deref().unwrap_or(TEMPLATE);
    let parsed = parse(text);
    Ok(serde_json::json!({
        "path": crate::state::normalize_fs_path(&path.to_string_lossy()),
        "fileName": selected, "files": files, "exists": raw.is_some(),
        "content": text, "expectedContent": raw,
        "environment": parsed.as_ref().ok(), "schemaError": parsed.err(),
    }))
}

pub fn save(cwd: &str, file_name: &str, raw: &str, expected: Option<&str>) -> Result<serde_json::Value, String> {
    parse(raw)?;
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = config_path(cwd, file_name)?;
    let before = contents(&path)?;
    if before.as_deref() != Some(raw) {
        if before.as_deref() != expected { return Err("环境文件已被其他程序修改，请重新读取；草稿已保留。".into()); }
        fs::create_dir_all(path.parent().ok_or("环境路径无效")?).map_err(|e| e.to_string())?;
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
            file.write_all(raw.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
            drop(file);
            if contents(&path)? != before { return Err("环境文件在保存期间发生变化，请重新读取。".into()); }
            fs::rename(&temporary, &path).map_err(|e| e.to_string())
        })();
        if result.is_err() { let _ = fs::remove_file(&temporary); }
        result?;
    }
    if contents(&path)?.as_deref() != Some(raw) { return Err("环境已写入，但读回不一致，请重新读取。".into()); }
    read(cwd, Some(file_name))
}

pub fn action(cwd: &str, file_name: &str, expected: &str, index: usize) -> Result<String, String> {
    let path = config_path(cwd, file_name)?;
    let raw = contents(&path)?.ok_or("请先保存环境配置。")?;
    if raw != expected { return Err("环境文件已变化，请重新读取后再运行。".into()); }
    let env = parse(&raw)?;
    let action = env.actions.get(index).ok_or("环境动作不存在。")?;
    let platform = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };
    if action.platform.as_deref().is_some_and(|p| p != platform) {
        return Err("此动作不适用于当前平台。".into());
    }
    Ok(action.command.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn environment_roundtrip_conflict_schema_and_action() {
        let root = std::env::temp_dir().join(format!("codex-environment-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let cwd = root.to_str().unwrap();
        let initial = read(cwd, None).unwrap();
        assert_eq!(initial["exists"], false);
        assert!(!root.join(".codex").exists());
        let raw = format!("{TEMPLATE}\n[[actions]]\nname = \"Test\"\ncommand = \"echo parity\"\nicon = \"test\"\n");
        let saved = save(cwd, "environment.toml", &raw, None).unwrap();
        assert_eq!(saved["content"], raw);
        assert_eq!(action(cwd, "environment.toml", &raw, 0).unwrap(), "echo parity");
        assert!(action(cwd, "environment.toml", "stale", 0).is_err());
        assert!(save(cwd, "environment.toml", TEMPLATE, None).is_err());
        assert!(save(cwd, "environment.toml", "name = 'old'\nsetup_script = ''", Some(&raw)).is_err());
        assert_eq!(fs::read_to_string(root.join(".codex/environments/environment.toml")).unwrap(), raw);
        save(cwd, "default.toml", TEMPLATE, None).unwrap();
        assert_eq!(read(cwd, None).unwrap()["files"].as_array().unwrap().len(), 2);
        assert_eq!(read(cwd, None).unwrap()["fileName"], "environment.toml");
        assert!(read(cwd, Some("../escape.toml")).is_err());
        save(cwd, "environment.toml", TEMPLATE, Some(&raw)).unwrap();
        assert!(action(cwd, "environment.toml", TEMPLATE, 0).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn environment_invalid_existing_file_and_platform_are_not_executed_or_rewritten() {
        let root = std::env::temp_dir().join(format!("codex-environment-{}", uuid::Uuid::new_v4()));
        let dir = root.join(".codex/environments");
        fs::create_dir_all(&dir).unwrap();
        let cwd = root.to_str().unwrap();
        let old = "name = 'legacy'\nsetup_script = ''\n";
        fs::write(dir.join("default.toml"), old).unwrap();
        let readback = read(cwd, None).unwrap();
        assert_eq!(readback["content"], old);
        assert!(readback["schemaError"].is_string());
        assert!(readback["environment"].is_null());
        assert!(action(cwd, "default.toml", old, 0).is_err());
        assert_eq!(fs::read_to_string(dir.join("default.toml")).unwrap(), old);
        let other_platform = if cfg!(windows) { "linux" } else { "win32" };
        let raw = format!("{TEMPLATE}\n[[actions]]\nname = 'Other platform'\ncommand = 'echo never'\nplatform = '{other_platform}'\n");
        save(cwd, "environment.toml", &raw, None).unwrap();
        assert!(action(cwd, "environment.toml", &raw, 0).is_err());
        fs::write(dir.join("environment.toml"), TEMPLATE).unwrap();
        assert!(save(cwd, "environment.toml", &raw, Some(&raw)).is_err());
        assert_eq!(fs::read_to_string(dir.join("environment.toml")).unwrap(), TEMPLATE);
        assert!(read(cwd, Some("C:escape.toml")).is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
