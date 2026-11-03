use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
const TEMPLATE: &str = "version = 1\nname = \"Default Environment\"\n\n[setup]\nscript = \"\"\n";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Lifecycle {
    pub script: String,
    pub darwin: Option<Script>,
    pub linux: Option<Script>,
    pub win32: Option<Script>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Script { pub script: String }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Action {
    pub name: String,
    pub command: String,
    pub icon: Option<String>,
    pub platform: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Environment {
    #[serde(default = "default_version")]
    pub version: u64,
    pub name: String,
    pub setup: Lifecycle,
    pub cleanup: Option<Lifecycle>,
    #[serde(default)]
    pub actions: Vec<Action>,
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
    write_contents(&path, raw, expected)?;
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSnapshot {
    pub path: String,
    pub file_name: String,
    pub files: Vec<String>,
    pub exists: bool,
    pub content: String,
    pub expected_content: Option<String>,
    pub environment: Option<Environment>,
    pub schema_error: Option<String>,
    pub cwd: String,
    pub workspace_root: String,
    pub inherited: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentList {
    pub environments: Vec<EnvironmentSnapshot>,
    pub next_file_name: String,
    pub default_path: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSelection { pub config_path: Option<String>, pub explicit: bool }
pub const SELECTIONS_KEY: &str = "local-env-selections-by-workspace";

fn same_path(left: &str, right: &str) -> bool {
    if cfg!(windows) { left.eq_ignore_ascii_case(right) } else { left == right }
}
fn normalized(path: &Path) -> String {
    let value = crate::state::normalize_fs_path(&path.to_string_lossy());
    if cfg!(windows) { value.replace('/', "\\") } else { value }
}
fn workspace(cwd: &str) -> Result<PathBuf, String> {
    if cwd.trim().is_empty() { return Err("请先选择工作区。".into()); }
    let path = fs::canonicalize(cwd).map_err(|error| error.to_string())?;
    if !path.is_dir() { return Err("工作区不是目录。".into()); }
    Ok(path)
}
fn git_boundary(root: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(root.join(".git")) else { return false; };
    if metadata.file_type().is_symlink() { return true; }
    if !metadata.is_file() && !metadata.is_dir() { return false; }
    let mut command = std::process::Command::new("git");
    command.arg("-C").arg(root).args(["rev-parse", "--resolve-git-dir", ".git"]);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command.output().map(|result| result.status.success()).unwrap_or(true)
}
fn discovery_roots(cwd: &str) -> Result<Vec<PathBuf>, String> {
    let mut current = workspace(cwd)?;
    let mut roots = Vec::new();
    for _ in 0..50 {
        roots.push(current.clone());
        if git_boundary(&current) { break; }
        let Some(parent) = current.parent() else { break; };
        current = parent.to_path_buf();
    }
    Ok(roots)
}
fn names(root: &Path) -> Result<Vec<String>, String> {
    let dir = directory(&normalized(root))?;
    let entries = match fs::read_dir(dir) { Ok(entries) => entries, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()), Err(error) => return Err(error.to_string()) };
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".toml") { result.push(name); }
    }
    result.sort_by_key(|name| (name != "environment.toml", name.clone()));
    Ok(result)
}
fn parse_discovered(raw: &str) -> Result<Environment, String> {
    let mut value: toml::Value = toml::from_str(raw).map_err(|error| format!("环境结构无效：{error}"))?;
    if let Some(actions) = value.get_mut("actions").and_then(toml::Value::as_array_mut) {
        actions.retain(|action| ["name", "command"].iter().all(|key| action.get(key).and_then(toml::Value::as_str).is_some_and(|text| !text.trim().is_empty())));
        for action in actions {
            if action.get("icon").is_some_and(|icon| !icon.as_str().is_some_and(|value| ["tool", "run", "debug", "test"].contains(&value))) {
                if let Some(table) = action.as_table_mut() { table.remove("icon"); }
            }
        }
    }
    let mut environment = parse(&toml::to_string(&value).map_err(|error| error.to_string())?)?;
    environment.name = environment.name.trim().into();
    fn trim_lifecycle(lifecycle: &mut Lifecycle) {
        lifecycle.script = lifecycle.script.trim().into();
        for script in [&mut lifecycle.darwin, &mut lifecycle.linux, &mut lifecycle.win32].into_iter().flatten() { script.script = script.script.trim().into(); }
    }
    trim_lifecycle(&mut environment.setup);
    if let Some(cleanup) = &mut environment.cleanup { trim_lifecycle(cleanup); }
    for action in &mut environment.actions { action.name = action.name.trim().into(); }
    Ok(environment)
}
fn snapshot(root: &Path, definition: &Path, file: &str, files: Vec<String>) -> EnvironmentSnapshot {
    let path = definition.join(".codex/environments").join(file);
    let read = config_path(&normalized(definition), file).and_then(|path| contents(&path));
    let (raw, error) = match read { Ok(raw) => (raw, None), Err(error) => (None, Some(error)) };
    let content = if error.is_some() { String::new() } else { raw.clone().unwrap_or_else(|| TEMPLATE.into()) };
    let parsed = if let Some(error) = error { Err(error) } else { parse_discovered(&content) };
    EnvironmentSnapshot { path: normalized(&path), file_name: file.into(), files, exists: raw.is_some() || fs::symlink_metadata(&path).is_ok(), content,
        expected_content: raw, environment: parsed.as_ref().ok().cloned(), schema_error: parsed.err(), cwd: normalized(definition), workspace_root: normalized(root), inherited: root != definition }
}
fn next_name(root: &Path) -> Result<String, String> {
    let directory = directory(&normalized(root))?;
    for index in 1u64.. {
        let name = if index == 1 { "environment.toml".into() } else { format!("environment-{index}.toml") };
        match fs::symlink_metadata(directory.join(&name)) { Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(name), Err(error) => return Err(error.to_string()), Ok(_) => {} }
    }
    unreachable!()
}
pub fn list(cwd: &str) -> Result<EnvironmentList, String> {
    let roots = discovery_roots(cwd)?;
    let mut discovered = Vec::new();
    for (distance, definition) in roots.iter().enumerate() {
        let files = names(definition)?;
        for file in &files { discovered.push((distance, snapshot(&roots[0], definition, file, files.clone()))); }
    }
    discovered.sort_by(|left, right| (left.1.file_name != "environment.toml", left.0, &left.1.path).cmp(&(right.1.file_name != "environment.toml", right.0, &right.1.path)));
    let environments: Vec<_> = discovered.into_iter().map(|(_, value)| value).collect();
    let default = environments.iter().find(|environment| environment.file_name == "environment.toml" && environment.schema_error.is_none())
        .or_else(|| environments.iter().find(|environment| environment.schema_error.is_none())).or_else(|| environments.first()).map(|environment| environment.path.clone());
    Ok(EnvironmentList { environments, next_file_name: next_name(&roots[0])?, default_path: default })
}
fn locate(cwd: &str, requested: &str) -> Result<(PathBuf, PathBuf, String), String> {
    if !Path::new(requested).is_absolute() { return Err("环境配置必须使用完整路径。".into()); }
    let file = Path::new(requested).file_name().and_then(|file| file.to_str()).ok_or("环境文件名无效。")?.to_owned();
    let roots = discovery_roots(cwd)?;
    let requested = normalized(Path::new(requested));
    for definition in &roots {
        if let Ok(candidate) = config_path(&normalized(definition), &file) {
            if same_path(&normalized(&candidate), &requested) { return Ok((roots[0].clone(), definition.clone(), file)); }
        }
    }
    Err("环境文件必须位于工作区或仓库边界内祖先的环境目录，且不能是符号链接。".into())
}
pub fn read_config(cwd: &str, path: &str) -> Result<EnvironmentSnapshot, String> {
    let (root, definition, file) = locate(cwd, path)?;
    Ok(snapshot(&root, &definition, &file, names(&definition)?))
}
fn serialize_environment(mut environment: Environment) -> Result<String, String> {
    if environment.version == 0 || environment.name.trim().is_empty() { return Err("环境版本必须大于零，名称不能为空。".into()); }
    environment.name = environment.name.trim().into();
    let mut actions = Vec::new();
    for mut action in environment.actions {
        action.name = action.name.trim().into();
        if action.name.is_empty() && action.command.trim().is_empty() { continue; }
        if action.name.is_empty() || action.command.trim().is_empty() { return Err("动作名称和命令必须完整填写。".into()); }
        if action.icon.as_ref().is_some_and(|icon| !["tool", "run", "debug", "test"].contains(&icon.as_str())) || action.platform.as_ref().is_some_and(|platform| !["win32", "linux", "darwin"].contains(&platform.as_str())) { return Err("动作平台或图标无效。".into()); }
        actions.push(action);
    }
    let quote = |text: &str| serde_json::to_string(text).expect("string serialization");
    let mut lines = vec!["# THIS IS AUTOGENERATED. DO NOT EDIT MANUALLY".into(), format!("version = {}", environment.version), format!("name = {}", quote(&environment.name))];
    for (name, lifecycle) in [("setup", Some(environment.setup)), ("cleanup", environment.cleanup)] {
        if let Some(lifecycle) = lifecycle {
            let platforms = [("darwin", lifecycle.darwin), ("linux", lifecycle.linux), ("win32", lifecycle.win32)];
            if name == "setup" || !lifecycle.script.is_empty() || platforms.iter().any(|(_, script)| script.as_ref().is_some_and(|script| !script.script.is_empty())) {
                lines.extend([String::new(), format!("[{name}]"), format!("script = {}", quote(&lifecycle.script))]);
                for (platform, script) in platforms { if let Some(script) = script.filter(|script| !script.script.is_empty()) { lines.extend([String::new(), format!("[{name}.{platform}]"), format!("script = {}", quote(&script.script))]); } }
            }
        }
    }
    for action in actions {
        lines.extend([String::new(), "[[actions]]".into(), format!("name = {}", quote(&action.name))]);
        if let Some(icon) = action.icon { lines.push(format!("icon = {}", quote(&icon))); }
        lines.push(format!("command = {}", quote(&action.command)));
        if let Some(platform) = action.platform { lines.push(format!("platform = {}", quote(&platform))); }
    }
    let raw = format!("{}\n", lines.join("\n"));
    parse(&raw)?;
    Ok(raw)
}
pub fn save_config(cwd: &str, path: Option<&str>, environment: Environment, expected: Option<&str>) -> Result<EnvironmentSnapshot, String> {
    let raw = serialize_environment(environment)?;
    let root = workspace(cwd)?;
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let (definition, file) = if let Some(path) = path { let (_, definition, file) = locate(cwd, path)?; (definition, file) } else { let file = next_name(&root)?; (root, file) };
    // Selection is a separate persisted operation: file success must not disguise selection failure.
    let target = config_path(&normalized(&definition), &file)?;
    write_contents(&target, &raw, expected)?;
    read_config(cwd, &normalized(&target))
}
fn write_contents(path: &Path, raw: &str, expected: Option<&str>) -> Result<(), String> {
    let before = contents(path)?;
    if before.as_deref() == Some(raw) { return Ok(()); }
    if before.as_deref() != expected { return Err("环境文件已被其他程序修改，请重新读取；草稿已保留。".into()); }
    fs::create_dir_all(path.parent().ok_or("环境路径无效")?).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|error| error.to_string())?;
        file.write_all(raw.as_bytes()).and_then(|_| file.sync_all()).map_err(|error| error.to_string())?; drop(file);
        if contents(path)? != before { return Err("环境文件在保存期间发生变化，请重新读取。".into()); }
        fs::rename(&temporary, path).map_err(|error| error.to_string())?;
        if contents(path)?.as_deref() != Some(raw) { return Err("环境已写入，但读回不一致，请重新读取。".into()); }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}
fn workspace_key(cwd: &str) -> Result<String, String> {
    let mut root = normalized(&workspace(cwd)?);
    if cfg!(windows) { root.make_ascii_lowercase(); }
    Ok(format!("local:{root}"))
}
fn selection_reference(cwd: &str, values: &serde_json::Value) -> Result<EnvironmentSelection, String> {
    if values.is_null() { return Ok(EnvironmentSelection { config_path: None, explicit: false }); }
    let map = values.as_object().ok_or("环境选择记录损坏，请先检查保存数据。")?;
    let key = workspace_key(cwd)?;
    let mut found = map.get(&key);
    if found.is_none() {
        for (candidate, value) in map {
            if candidate.starts_with("local:") && same_path(&crate::state::normalize_fs_path(&candidate[6..]), &key[6..]) {
                if found.is_some_and(|previous| previous != value) { return Err("同一工作区的环境选择记录冲突，请明确重新选择。".into()); }
                found = Some(value);
            }
        }
    }
    let Some(value) = found else { return Ok(EnvironmentSelection { config_path: None, explicit: false }); };
    if value.is_null() { return Ok(EnvironmentSelection { config_path: None, explicit: true }); }
    let path = value.as_str().ok_or("环境选择记录不是有效路径。")?;
    let snapshot = read_config(cwd, path)?;
    Ok(EnvironmentSelection { config_path: Some(snapshot.path), explicit: true })
}
fn selected_value(cwd: &str, values: &serde_json::Value) -> Result<EnvironmentSelection, String> {
    let selection = selection_reference(cwd, values)?;
    if let Some(path) = &selection.config_path {
        let snapshot = read_config(cwd, path)?;
        if !snapshot.exists || snapshot.schema_error.is_some() { return Err("选中的环境配置已失效，请修复文件或明确重新选择。".into()); }
    }
    Ok(selection)
}
pub fn selection_get(state: &crate::state::DesktopStateManager, cwd: &str) -> Result<EnvironmentSelection, String> {
    workspace(cwd)?;
    selected_value(cwd, &state.get_value(SELECTIONS_KEY))
}
fn selection_update(key: &str, path: Option<&str>, previous: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut map = if previous.is_null() { serde_json::Map::new() } else { previous.as_object().cloned().ok_or("环境选择记录损坏，未覆盖原记录。")? };
    map.retain(|candidate, _| !candidate.starts_with("local:") || !same_path(&crate::state::normalize_fs_path(&candidate[6..]), &key[6..]));
    map.insert(key.into(), path.map(|path| serde_json::Value::String(path.into())).unwrap_or(serde_json::Value::Null));
    Ok(serde_json::Value::Object(map))
}
pub fn select(state: &crate::state::DesktopStateManager, cwd: &str, path: Option<&str>) -> Result<EnvironmentSelection, String> {
    let key = workspace_key(cwd)?;
    let path = if let Some(path) = path {
        let snapshot = read_config(cwd, path)?;
        if !snapshot.exists || snapshot.schema_error.is_some() { return Err("只能选择已保存且结构有效的环境。".into()); }
        Some(snapshot.path)
    } else { None };
    state.update_value_persisted(SELECTIONS_KEY, |previous| selection_update(&key, path.as_deref(), previous))?;
    let result = selection_get(state, cwd)?;
    if !result.explicit || result.config_path != path { return Err("环境选择已写入，但读回不一致。".into()); }
    Ok(result)
}
pub fn action_config(cwd: &str, path: &str, expected: &str, index: usize) -> Result<String, String> {
    let snapshot = read_config(cwd, path)?;
    if !snapshot.exists || snapshot.expected_content.as_deref() != Some(expected) { return Err("环境文件已变化，请重新读取后再运行。".into()); }
    let environment = snapshot.environment.ok_or("环境结构无效，不能运行。")?;
    let action = environment.actions.get(index).ok_or("环境动作不存在。")?;
    let platform = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };
    if action.platform.as_deref().is_some_and(|candidate| candidate != platform) { return Err("此动作不适用于当前平台。".into()); }
    Ok(action.command.clone())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentRuntime {
    pub list: EnvironmentList,
    pub selection: EnvironmentSelection,
    pub selected: Option<EnvironmentSnapshot>,
    pub is_worktree: bool,
    pub platform: &'static str,
}
const WORKTREE_SELECTION: &str = "codex.localEnvironmentConfigPath";
const RECENT_ACTIONS_KEY: &str = "local-env-recent-actions-by-key";
fn current_platform() -> &'static str {
    if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" }
}
fn environment_git(cwd: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = std::process::Command::new("git");
    command.arg("-C").arg(cwd).args(args);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command.output().map_err(|error| error.to_string())
}
fn git_text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = environment_git(cwd, args)?;
    if !output.status.success() { return Err(format!("无法读取环境 Git 作用域：{}", String::from_utf8_lossy(&output.stderr).trim())); }
    String::from_utf8(output.stdout).map(|text| text.trim().to_owned()).map_err(|error| error.to_string())
}
fn git_matches(cwd: &Path, args: &[&str]) -> Result<bool, String> {
    let result = environment_git(cwd, args)?;
    match result.status.code() { Some(0) => Ok(true), Some(1) => Ok(false), _ => Err("无法核验源环境配置的 Git 身份。".into()) }
}
struct EnvironmentWorktree { root: PathBuf, git_dir: PathBuf, primary: PathBuf }
fn environment_worktree(cwd: &str) -> Result<Option<EnvironmentWorktree>, String> {
    let workspace = workspace(cwd)?;
    if !discovery_roots(cwd)?.iter().any(|root| root.join(".git").exists()) { return Ok(None); }
    let git_dir = fs::canonicalize(git_text(&workspace, &["rev-parse", "--absolute-git-dir"])?).map_err(|error| error.to_string())?;
    let common = fs::canonicalize(git_text(&workspace, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?).map_err(|error| error.to_string())?;
    if git_dir == common { return Ok(None); }
    let root = fs::canonicalize(git_text(&workspace, &["rev-parse", "--show-toplevel"])?).map_err(|error| error.to_string())?;
    let primary = common.parent().ok_or("Git 公共目录无效。")?.to_path_buf();
    Ok(Some(EnvironmentWorktree { root, git_dir, primary }))
}
fn worktree_selection(scope: &EnvironmentWorktree) -> Result<EnvironmentSelection, String> {
    let file = scope.git_dir.join("config.worktree");
    if !file.exists() { return Ok(EnvironmentSelection { config_path: None, explicit: false }); }
    if fs::symlink_metadata(&file).map_err(|error| error.to_string())?.file_type().is_symlink() { return Err("工作树选择文件不能是符号链接。".into()); }
    let file = normalized(&file);
    let result = environment_git(&scope.root, &["config", "--no-includes", "--file", &file, "--get", WORKTREE_SELECTION])?;
    if result.status.code() == Some(1) { return Ok(EnvironmentSelection { config_path: None, explicit: false }); }
    if !result.status.success() { return Err("无法读取工作树环境选择。".into()); }
    let selected = String::from_utf8(result.stdout).map_err(|error| error.to_string())?.trim().to_owned();
    if selected.is_empty() { return Err("工作树环境选择路径为空。".into()); }
    Ok(EnvironmentSelection { config_path: (selected != "__none__").then_some(selected), explicit: true })
}
fn runtime_snapshot(cwd: &str, path: &str, scope: Option<&EnvironmentWorktree>) -> Result<EnvironmentSnapshot, String> {
    if let Ok(snapshot) = read_config(cwd, path) { return Ok(snapshot); }
    let scope = scope.ok_or("选中的环境不属于当前工作区。")?;
    let requested = Path::new(path);
    if requested.components().any(|part| matches!(part, std::path::Component::ParentDir)) { return Err("环境路径不能包含上级目录。".into()); }
    let definition = requested.parent().and_then(Path::parent).and_then(Path::parent).ok_or("环境路径无效。")?;
    let definition = fs::canonicalize(definition).map_err(|error| error.to_string())?;
    let primary = fs::canonicalize(&scope.primary).map_err(|error| error.to_string())?;
    let relative = definition.strip_prefix(&primary).map_err(|_| "环境不属于工作树或源仓库。")?;
    let mut snapshot = read_config(&normalized(&definition), path)?;
    let normalized_primary = normalized(&primary);
    let config_relative = Path::new(&snapshot.path).strip_prefix(&normalized_primary).map_err(|_| "环境不属于源仓库。")?.to_string_lossy().into_owned();
    let ignored = git_matches(&primary, &["check-ignore", "--quiet", "--", &config_relative])?;
    let tracked = git_matches(&primary, &["ls-files", "--error-unmatch", "--", &config_relative])?;
    let target_ignored = git_matches(&scope.root, &["check-ignore", "--quiet", "--", &config_relative])?;
    if !ignored || tracked || target_ignored { return Err("源环境不是有效的忽略配置回退。".into()); }
    let execution = fs::canonicalize(scope.root.join(relative)).map_err(|error| error.to_string())?;
    if !execution.starts_with(&scope.root) || !execution.is_dir() { return Err("环境动作目录不属于目标工作树。".into()); }
    snapshot.cwd = normalized(&execution);
    snapshot.workspace_root = normalized(&workspace(cwd)?);
    snapshot.inherited = !same_path(&snapshot.cwd, &snapshot.workspace_root);
    Ok(snapshot)
}
pub fn runtime_read_config(cwd: &str, path: &str) -> Result<EnvironmentSnapshot, String> {
    let scope = environment_worktree(cwd)?;
    runtime_snapshot(cwd, path, scope.as_ref())
}
pub fn runtime_save_config(cwd: &str, path: Option<&str>, environment: Environment, expected: Option<&str>) -> Result<EnvironmentSnapshot, String> {
    let saved = if let Some(path) = path {
        let checked = runtime_read_config(cwd, path)?;
        let definition = Path::new(&checked.path).parent().and_then(Path::parent).and_then(Path::parent).ok_or("环境定义根无效。")?;
        save_config(&normalized(definition), Some(&checked.path), environment, expected)?
    } else { save_config(cwd, None, environment, expected)? };
    runtime_read_config(cwd, &saved.path)
}
pub fn runtime(state: &crate::state::DesktopStateManager, cwd: &str) -> Result<EnvironmentRuntime, String> {
    let mut list = list(cwd)?;
    let scope = environment_worktree(cwd)?;
    let selection = if let Some(scope) = &scope { worktree_selection(scope)? } else { selection_reference(cwd, &state.get_value(SELECTIONS_KEY))? };
    let path = if selection.explicit { selection.config_path.as_deref() } else { list.default_path.as_deref() };
    let selected = path.map(|path| runtime_snapshot(cwd, path, scope.as_ref())).transpose()?;
    if let Some(snapshot) = &selected {
        if !list.environments.iter().any(|entry| same_path(&entry.path, &snapshot.path)) { list.environments.push(snapshot.clone()); }
    }
    Ok(EnvironmentRuntime { list, selection, selected, is_worktree: scope.is_some(), platform: current_platform() })
}
pub fn runtime_select(state: &crate::state::DesktopStateManager, cwd: &str, path: Option<&str>) -> Result<EnvironmentRuntime, String> {
    if let Some(scope) = environment_worktree(cwd)? {
        let path = path.map(|path| runtime_snapshot(cwd, path, Some(&scope))).transpose()?;
        if path.as_ref().is_some_and(|snapshot| !snapshot.exists || snapshot.schema_error.is_some()) { return Err("只能选择已保存且结构有效的环境。".into()); }
        if fs::symlink_metadata(scope.git_dir.join("config.worktree")).is_ok_and(|metadata| metadata.file_type().is_symlink() || !metadata.is_file()) { return Err("工作树选择文件必须是普通文件。".into()); }
        if !git_text(&scope.root, &["config", "--get", "core.worktree"]).unwrap_or_default().is_empty() { return Err("特殊 core.worktree 配置不能安全启用独立环境设置。".into()); }
        git_text(&scope.root, &["config", "extensions.worktreeConfig", "true"])?;
        let selected = path.as_ref().map(|snapshot| snapshot.path.as_str()).unwrap_or("__none__");
        git_text(&scope.root, &["config", "--worktree", WORKTREE_SELECTION, selected])?;
        let readback = worktree_selection(&scope)?;
        if !readback.explicit || readback.config_path.as_deref() != path.as_ref().map(|snapshot| snapshot.path.as_str()) { return Err("工作树环境选择已写入，但读回不一致。".into()); }
    } else { select(state, cwd, path)?; }
    runtime(state, cwd)
}
fn recent_key(snapshot: &EnvironmentSnapshot) -> String {
    // Official RE prefers the environment definition cwd; configPath is only a fallback.
    let mut key = snapshot.cwd.clone();
    if cfg!(windows) { key.make_ascii_lowercase(); }
    key
}
fn recent_value(values: &serde_json::Value, key: &str) -> Result<Vec<String>, String> {
    if values.is_null() { return Ok(Vec::new()); }
    let map = values.as_object().ok_or("最近操作记录损坏，未覆盖原记录。")?;
    let Some(value) = map.get(key) else { return Ok(Vec::new()); };
    serde_json::from_value(value.clone()).map_err(|_| "最近操作记录不是名称列表。".into())
}
pub fn recent_actions_get(state: &crate::state::DesktopStateManager, cwd: &str, path: &str) -> Result<Vec<String>, String> {
    let scope = environment_worktree(cwd)?;
    let snapshot = runtime_snapshot(cwd, path, scope.as_ref())?;
    recent_value(&state.get_value(RECENT_ACTIONS_KEY), &recent_key(&snapshot))
}
fn selected_snapshot(state: &crate::state::DesktopStateManager, cwd: &str, path: &str, expected: &str, index: usize) -> Result<(EnvironmentSnapshot, Action), String> {
    let snapshot = runtime(state, cwd)?.selected.ok_or("当前未选择环境。")?;
    if !Path::new(path).is_absolute() || !same_path(&snapshot.path, &normalized(Path::new(path))) { return Err("环境选择已变化，请重新读取后再运行。".into()); }
    if !snapshot.exists || snapshot.schema_error.is_some() { return Err("选中的环境配置已丢失或损坏，不能运行。".into()); }
    if snapshot.expected_content.as_deref() != Some(expected) { return Err("环境文件已变化，请重新读取后再运行。".into()); }
    let environment = snapshot.environment.as_ref().ok_or("环境结构无效，不能运行。")?;
    let action = environment.actions.get(index).ok_or("环境动作不存在。")?.clone();
    if action.platform.as_deref().is_some_and(|platform| platform != current_platform()) { return Err("此动作不适用于当前平台。".into()); }
    Ok((snapshot, action))
}
pub fn selected_action(state: &crate::state::DesktopStateManager, cwd: &str, path: &str, expected: &str, index: usize) -> Result<(String, String, String), String> {
    let (snapshot, action) = selected_snapshot(state, cwd, path, expected, index)?;
    Ok((snapshot.cwd, action.command, action.name))
}
pub fn record_action(state: &crate::state::DesktopStateManager, cwd: &str, path: &str, expected: &str, index: usize) -> Result<Vec<String>, String> {
    let (snapshot, action) = selected_snapshot(state, cwd, path, expected, index)?;
    let key = recent_key(&snapshot);
    let written = state.update_value_persisted(RECENT_ACTIONS_KEY, |previous| {
        let mut names = recent_value(&previous, &key)?;
        names.retain(|name| name != &action.name);
        names.insert(0, action.name.clone());
        let mut map = if previous.is_null() { serde_json::Map::new() } else { previous.as_object().cloned().ok_or("最近操作记录损坏。")? };
        map.insert(key.clone(), serde_json::json!(names));
        Ok(serde_json::Value::Object(map))
    })?;
    let readback = recent_actions_get(state, cwd, path)?;
    if readback != recent_value(&written, &key)? { return Err("最近操作已写入，但读回不一致。".into()); }
    Ok(readback)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self { let path = std::env::temp_dir().join(format!("codex-local-env-{}", uuid::Uuid::new_v4())); fs::create_dir_all(&path).unwrap(); Self(path) }
        fn repository(&self, name: &str) -> PathBuf {
            let root = self.0.join(name); fs::create_dir_all(&root).unwrap();
            let mut command = std::process::Command::new("git"); command.args(["init", "--quiet"]).arg(&root);
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            assert!(command.status().unwrap().success()); root
        }
        fn config(&self, root: &Path, file: &str, raw: &str) -> PathBuf {
            let path = root.join(".codex/environments").join(file); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(&path, raw).unwrap(); path
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn local_environment_runtime_scopes_actions_and_recents_in_private_process() {
        const MARKER: &str = "CODEX_ENV_RUNTIME_PRIVATE_FIXTURE";
        if let Some(path) = std::env::var_os(MARKER) {
            let root = PathBuf::from(path).join("repo");
            let child = root.join("project");
            let cwd = child.to_str().unwrap();
            let state = crate::state::DesktopStateManager::new();
            let initial = runtime(&state, cwd).unwrap();
            assert!(!initial.is_worktree); assert!(!initial.selection.explicit);
            let snapshot = initial.selected.unwrap();
            assert_eq!(snapshot.cwd, normalized(&root));
            let raw = snapshot.expected_content.as_deref().unwrap();
            let (execution, command, title) = selected_action(&state, cwd, &snapshot.path, raw, 0).unwrap();
            assert_eq!(execution, normalized(&root)); assert_eq!(command, "echo first"); assert_eq!(title, "First");
            assert!(selected_action(&state, cwd, &snapshot.path, "stale", 0).is_err());
            assert!(selected_action(&state, cwd, &snapshot.path, raw, 2).is_err());
            record_action(&state, cwd, &snapshot.path, raw, 0).unwrap();
            record_action(&state, cwd, &snapshot.path, raw, 1).unwrap();
            assert_eq!(record_action(&state, cwd, &snapshot.path, raw, 0).unwrap(), ["First", "Second"]);
            let reloaded = crate::state::DesktopStateManager::new();
            assert_eq!(recent_actions_get(&reloaded, cwd, &snapshot.path).unwrap(), ["First", "Second"]);
            runtime_select(&state, cwd, None).unwrap();
            assert!(runtime(&state, cwd).unwrap().selected.is_none());
            assert!(selected_action(&state, cwd, &snapshot.path, raw, 0).is_err());
            runtime_select(&state, cwd, Some(&snapshot.path)).unwrap();
            let worktree = root.parent().unwrap().join("checkout");
            git_text(&root, &["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "."]).unwrap();
            git_text(&root, &["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"]).unwrap();
            git_text(&root, &["worktree", "add", "--quiet", "--detach", worktree.to_str().unwrap()]).unwrap();
            let work_cwd = worktree.join("project"); let work_cwd = work_cwd.to_str().unwrap();
            let work_snapshot = runtime(&state, work_cwd).unwrap().selected.unwrap();
            assert!(runtime(&state, work_cwd).unwrap().is_worktree);
            runtime_select(&state, work_cwd, None).unwrap();
            assert!(runtime(&state, work_cwd).unwrap().selected.is_none());
            assert!(runtime(&state, cwd).unwrap().selected.is_some(), "worktree selection must not change primary workspace");
            runtime_select(&state, work_cwd, Some(&work_snapshot.path)).unwrap();
            let work_selected = selected_action(&state, work_cwd, &work_snapshot.path, work_snapshot.expected_content.as_deref().unwrap(), 0).unwrap();
            assert_eq!(work_selected.0, normalized(&worktree));
            assert!(recent_actions_get(&state, work_cwd, &work_snapshot.path).unwrap().is_empty());
            fs::write(root.join(".gitignore"), ".codex/environments/fallback.toml\n").unwrap();
            let fallback = root.join(".codex/environments/fallback.toml");
            fs::write(&fallback, raw).unwrap();
            let fallback_read = runtime_read_config(work_cwd, fallback.to_str().unwrap()).unwrap();
            assert_eq!(fallback_read.cwd, normalized(&worktree));
            let mut edited = fallback_read.environment.clone().unwrap(); edited.name = "Edited source fallback".into();
            let fallback_saved = runtime_save_config(work_cwd, Some(fallback.to_str().unwrap()), edited.clone(), fallback_read.expected_content.as_deref()).unwrap();
            assert_eq!(fallback_saved.cwd, normalized(&worktree));
            assert_eq!(fallback_saved.environment.as_ref().unwrap().name, "Edited source fallback");
            assert!(!worktree.join(".codex/environments/fallback.toml").exists(), "editing source fallback must not create an unselected target copy");
            edited.name = "Conflicting edit".into();
            assert!(runtime_save_config(work_cwd, Some(fallback.to_str().unwrap()), edited, Some(raw)).is_err());
            assert_eq!(fs::read_to_string(&fallback).unwrap(), fallback_saved.content);
            let outside = root.parent().unwrap().join("outside/.codex/environments/environment.toml");
            fs::create_dir_all(outside.parent().unwrap()).unwrap(); fs::write(&outside, raw).unwrap();
            assert!(runtime_read_config(work_cwd, outside.to_str().unwrap()).is_err());
            assert!(runtime_save_config(work_cwd, Some(outside.to_str().unwrap()), parse(TEMPLATE).unwrap(), Some(raw)).is_err());
            assert_eq!(fs::read_to_string(outside).unwrap(), raw);
            runtime_select(&state, work_cwd, Some(fallback.to_str().unwrap())).unwrap();
            let fallback_raw = fallback_saved.expected_content.as_deref().unwrap();
            let fallback_action = selected_action(&state, work_cwd, fallback.to_str().unwrap(), fallback_raw, 0).unwrap();
            assert_eq!(fallback_action.0, normalized(&worktree), "source fallback runs in target definition directory");
            record_action(&state, work_cwd, fallback.to_str().unwrap(), fallback_raw, 0).unwrap();
            runtime_select(&state, work_cwd, Some(&work_snapshot.path)).unwrap();
            assert_eq!(recent_actions_get(&state, work_cwd, &work_snapshot.path).unwrap(), ["First"], "official recent key is definition cwd, shared by its configurations");
            assert!(runtime_select(&state, work_cwd, Some(&snapshot.path)).is_err(), "tracked source configuration must not bypass target copy");
            fs::write(&work_snapshot.path, "invalid = [").unwrap();
            let broken = runtime(&state, work_cwd).unwrap();
            assert!(broken.selected.unwrap().schema_error.is_some(), "invalid selection must remain visible, never fallback");
            assert!(selected_action(&state, work_cwd, &work_snapshot.path, "invalid = [", 0).is_err());
            fs::remove_file(&work_snapshot.path).unwrap();
            let missing = runtime(&state, work_cwd).unwrap();
            assert_eq!(missing.selection.config_path.as_deref(), Some(work_snapshot.path.as_str()));
            let missing = missing.selected.unwrap();
            assert_eq!(missing.path, work_snapshot.path); assert!(!missing.exists); assert!(missing.expected_content.is_none());
            assert!(selected_action(&state, work_cwd, &work_snapshot.path, &missing.content, 0).is_err());
            runtime_select(&state, work_cwd, None).unwrap();
            assert!(runtime(&state, work_cwd).unwrap().selected.is_none());
            fs::remove_file(&snapshot.path).unwrap();
            let missing = runtime(&state, cwd).unwrap();
            assert_eq!(missing.selection.config_path.as_deref(), Some(snapshot.path.as_str()));
            assert!(!missing.selected.unwrap().exists);
            assert!(selected_action(&state, cwd, &snapshot.path, raw, 0).is_err());
            assert!(selection_get(&state, cwd).is_err(), "B strict selection reader must retain its validation contract");
            return;
        }
        let fixture = Fixture::new(); let root = fixture.repository("repo");
        fs::create_dir(root.join("project")).unwrap(); fs::write(root.join("project/keep"), "fixture").unwrap();
        let other = if cfg!(windows) { "linux" } else { "win32" };
        let raw = format!("{TEMPLATE}\n[[actions]]\nname='First'\ncommand='echo first'\n[[actions]]\nname='Second'\ncommand='echo second'\n[[actions]]\nname='Other'\ncommand='echo forbidden'\nplatform='{other}'\n");
        fixture.config(&root, "environment.toml", &raw);
        let home = fixture.0.join("home"); fs::create_dir(&home).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "local_environment::tests::local_environment_runtime_scopes_actions_and_recents_in_private_process", "--nocapture"])
            .env("CODEX_HOME", &home).env(MARKER, &fixture.0);
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let result = command.output().unwrap();
        assert!(result.status.success(), "{}\n{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
    }

    #[test]
    fn local_environment_discovery_has_git_boundary_order_errors_and_precise_inheritance() {
        let fixture = Fixture::new(); fixture.config(&fixture.0, "outside.toml", TEMPLATE);
        let root = fixture.repository("repo"); let child = root.join("project"); fs::create_dir_all(&child).unwrap();
        let parent = fixture.config(&root, "environment.toml", TEMPLATE);
        let local = fixture.config(&child, "local.toml", TEMPLATE);
        fixture.config(&root, "broken.toml", "invalid = [");
        let result = list(child.to_str().unwrap()).unwrap();
        assert_eq!(result.environments.len(), 3); assert_eq!(result.default_path.as_deref(), Some(normalized(&parent).as_str()));
        assert_eq!(result.environments[0].path, normalized(&parent)); assert!(result.environments[0].inherited);
        assert_eq!(result.environments[0].cwd, normalized(&root)); assert_eq!(result.environments[0].workspace_root, normalized(&child));
        assert_eq!(result.environments[1].path, normalized(&local)); assert!(!result.environments[1].inherited);
        assert!(result.environments[2].schema_error.is_some()); assert!(result.environments[2].environment.is_none());
        assert!(read_config(child.to_str().unwrap(), fixture.0.join(".codex/environments/outside.toml").to_str().unwrap()).is_err());
        assert!(read_config(child.to_str().unwrap(), "local.toml").is_err());
        assert_eq!(read_config(child.to_str().unwrap(), parent.to_str().unwrap()).unwrap().cwd, normalized(&root));
    }

    #[test]
    fn local_environment_missing_read_does_not_write_and_discovery_stops_at_fifty() {
        let fixture = Fixture::new(); let root = fixture.repository("repo");
        let result = list(root.to_str().unwrap()).unwrap(); assert!(result.environments.is_empty()); assert!(result.default_path.is_none()); assert_eq!(result.next_file_name, "environment.toml");
        let missing = read_config(root.to_str().unwrap(), root.join(".codex/environments/environment.toml").to_str().unwrap()).unwrap();
        assert!(!missing.exists); assert!(missing.expected_content.is_none()); assert!(!root.join(".codex").exists());
        let mut deep = root.clone(); for _ in 0..51 { deep = deep.join("d"); } fs::create_dir_all(&deep).unwrap();
        assert_eq!(discovery_roots(deep.to_str().unwrap()).unwrap().len(), 50);
    }

    #[test]
    fn local_environment_structured_save_preserves_scripts_new_names_and_original_conflicts() {
        let fixture = Fixture::new(); let root = fixture.repository("repo"); fixture.config(&root, "default.toml", "do not overwrite");
        let mut environment = parse(TEMPLATE).unwrap(); environment.name = "  中文环境  ".into();
        environment.setup.script = " echo \"中文\"\r\nnext\nlast ".into(); environment.setup.win32 = Some(Script { script: String::new() });
        environment.setup.linux = Some(Script { script: "  echo linux \n ".into() }); environment.cleanup = Some(Lifecycle { script: String::new(), darwin: None, linux: None, win32: None });
        environment.actions = vec![Action { name: " ".into(), command: " \n".into(), icon: None, platform: None }, Action { name: "  Run  ".into(), command: " echo 'raw'\n next ".into(), icon: Some("run".into()), platform: None }];
        let saved = save_config(root.to_str().unwrap(), None, environment.clone(), None).unwrap();
        assert_eq!(saved.file_name, "environment.toml"); assert!(saved.content.starts_with("# THIS IS AUTOGENERATED."));
        let exact: Environment = toml::from_str(&saved.content).unwrap(); assert_eq!(exact.setup.script, environment.setup.script); assert_eq!(exact.actions[0].command, environment.actions[1].command);
        assert_eq!(exact.name, "中文环境"); assert!(exact.cleanup.is_none()); assert!(exact.setup.win32.is_none()); assert_eq!(exact.actions.len(), 1);
        assert_eq!(saved.environment.as_ref().unwrap().setup.script, environment.setup.script.trim());
        let second = save_config(root.to_str().unwrap(), None, environment.clone(), None).unwrap(); assert_eq!(second.file_name, "environment-2.toml");
        assert_eq!(list(root.to_str().unwrap()).unwrap().next_file_name, "environment-3.toml");
        assert!(save_config(root.to_str().unwrap(), Some(&saved.path), environment.clone(), Some("stale")).is_ok(), "identical target content does not require an overwrite");
        fs::write(&saved.path, "external modification").unwrap();
        assert!(save_config(root.to_str().unwrap(), Some(&saved.path), environment, Some(&saved.content)).is_err());
        assert_eq!(fs::read_to_string(&saved.path).unwrap(), "external modification"); assert_eq!(fs::read_to_string(root.join(".codex/environments/default.toml")).unwrap(), "do not overwrite");
        let mut invalid = parse(TEMPLATE).unwrap(); invalid.actions.push(Action { name: "Only a name".into(), command: String::new(), icon: None, platform: None });
        assert!(save_config(root.to_str().unwrap(), None, invalid, None).is_err()); assert!(!root.join(".codex/environments/environment-3.toml").exists());
    }

    #[test]
    fn local_environment_selection_model_preserves_none_missing_invalid_and_sibling_scopes() {
        use serde_json::{json, Value};
        let fixture = Fixture::new(); let root = fixture.repository("repo"); let cwd = root.to_str().unwrap();
        let saved = save_config(cwd, None, parse(TEMPLATE).unwrap(), None).unwrap(); let key = workspace_key(cwd).unwrap();
        assert!(!selected_value(cwd, &Value::Null).unwrap().explicit); assert!(!selected_value(cwd, &json!({})).unwrap().explicit);
        let other = json!({"remote-host:other":"retain", "local:another-workspace":null});
        let selected = selection_update(&key, Some(&saved.path), other).unwrap();
        assert_eq!(selected["remote-host:other"], "retain"); assert!(selected.get("local:another-workspace").is_some());
        let readback = selected_value(cwd, &selected).unwrap(); assert!(readback.explicit); assert_eq!(readback.config_path.as_deref(), Some(saved.path.as_str()));
        let none = selection_update(&key, None, selected.clone()).unwrap(); let readback = selected_value(cwd, &none).unwrap(); assert!(readback.explicit); assert!(readback.config_path.is_none());
        let mut invalid = selected.clone(); invalid[&key] = json!(42); assert!(selected_value(cwd, &invalid).is_err()); assert!(selection_update(&key, None, json!("corrupt")).is_err());
        fs::remove_file(&saved.path).unwrap(); assert!(selected_value(cwd, &selected).is_err()); assert!(selected_value(cwd, &none).unwrap().explicit);
    }

    #[test]
    fn local_environment_selection_persists_in_private_processes() {
        use serde_json::json;
        const MARKER: &str = "CODEX_ENV_SELECTION_PRIVATE_FIXTURE";
        const PHASE: &str = "CODEX_ENV_SELECTION_PRIVATE_PHASE";
        if let Some(fixture) = std::env::var_os(MARKER) {
            let fixture = PathBuf::from(fixture);
            assert_eq!(crate::state::codex_home_dir(), fixture.join("home"));
            let root = fixture.join("repo"); let cwd = root.to_str().unwrap();
            let path = normalized(&root.join(".codex/environments/environment.toml"));
            let state = crate::state::DesktopStateManager::new();
            match std::env::var(PHASE).unwrap().as_str() {
                "select" => {
                    assert!(!selection_get(&state, cwd).unwrap().explicit);
                    state.set_value_persisted("unrelated-setting", json!({"retain": true})).unwrap();
                    state.set_value_persisted(SELECTIONS_KEY, json!({"remote-host:other": "retain", "local:another-workspace": null})).unwrap();
                    let result = select(&state, cwd, Some(&path)).unwrap();
                    assert!(result.explicit); assert_eq!(result.config_path.as_deref(), Some(path.as_str()));
                },
                "read-selected" => {
                    let result = selection_get(&state, cwd).unwrap();
                    assert!(result.explicit); assert_eq!(result.config_path.as_deref(), Some(path.as_str()));
                },
                "select-none" => {
                    let result = select(&state, cwd, None).unwrap();
                    assert!(result.explicit); assert!(result.config_path.is_none());
                },
                "read-none" => {
                    let result = selection_get(&state, cwd).unwrap();
                    assert!(result.explicit); assert!(result.config_path.is_none());
                },
                phase => panic!("unexpected private fixture phase {phase}"),
            }
            let reloaded = crate::state::DesktopStateManager::new();
            let current = selection_get(&state, cwd).unwrap();
            let persisted = selection_get(&reloaded, cwd).unwrap();
            assert_eq!(persisted.config_path, current.config_path); assert_eq!(persisted.explicit, current.explicit);
            assert_eq!(reloaded.get_value("unrelated-setting"), json!({"retain": true}));
            let selections = reloaded.get_value(SELECTIONS_KEY);
            assert_eq!(selections["remote-host:other"], "retain"); assert!(selections.get("local:another-workspace").unwrap().is_null());
            assert!(fixture.join("home/.codex-global-state.json").is_file());
            return;
        }
        let fixture = Fixture::new(); let root = fixture.repository("repo");
        fixture.config(&root, "environment.toml", TEMPLATE);
        let home = fixture.0.join("home"); fs::create_dir(&home).unwrap();
        for phase in ["select", "read-selected", "select-none", "read-none"] {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "local_environment::tests::local_environment_selection_persists_in_private_processes", "--nocapture"])
                .env("CODEX_HOME", &home).env(MARKER, &fixture.0).env(PHASE, phase);
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            let result = command.output().unwrap();
            assert!(result.status.success(), "{phase}: {}\n{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
        }
    }

    #[test]
    fn local_environment_error_entries_are_preserved_and_action_rechecks_exact_definition() {
        let fixture = Fixture::new(); let root = fixture.repository("repo"); let cwd = root.to_str().unwrap();
        let raw = format!("{TEMPLATE}\n[[actions]]\nname = 'Missing command'\n\n[[actions]]\nname = ' Real action '\ncommand = 'echo actual'\nicon = 'future-icon'\n");
        let path = fixture.config(&root, "environment.toml", &raw);
        let result = read_config(cwd, path.to_str().unwrap()).unwrap(); assert_eq!(result.environment.as_ref().unwrap().actions.len(), 1); assert!(result.environment.as_ref().unwrap().actions[0].icon.is_none());
        assert_eq!(action_config(cwd, path.to_str().unwrap(), &raw, 0).unwrap(), "echo actual"); assert!(action_config(cwd, path.to_str().unwrap(), "stale", 0).is_err());
        fs::write(&path, "broken = [").unwrap(); let result = list(cwd).unwrap(); assert!(result.environments[0].schema_error.is_some()); assert_eq!(result.default_path.as_deref(), Some(normalized(&path).as_str()));
        assert!(action_config(cwd, path.to_str().unwrap(), "broken = [", 0).is_err()); assert_eq!(fs::read_to_string(path).unwrap(), "broken = [");
    }
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
