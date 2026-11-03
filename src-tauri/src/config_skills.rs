use crate::state::{codex_home_dir, normalize_fs_path};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use toml_edit::{DocumentMut, Item, Table};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub env_key: Option<String>,
    pub wire_api: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfigItem {
    pub id: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfigOverview {
    pub config_path: String,
    pub raw_toml: String,
    pub model: Option<String>,
    pub model_provider: Option<String>,
    pub model_reasoning_effort: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox_mode: Option<String>,
    pub model_catalog_json: Option<String>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub context_window: Option<u32>,
    pub web_search_mode: Option<String>,
    pub allow_network: Option<bool>,
    pub max_parallel_tools: Option<u32>,
    pub subagent_concurrency: Option<u32>,
    pub output_verbosity: Option<String>,
    pub instructions: Option<String>,
    pub providers: Vec<ModelProviderConfig>,
    pub mcp_servers: Vec<McpServerConfigItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfigUpdatePayload {
    pub model: Option<String>,
    pub model_provider: Option<String>,
    pub model_reasoning_effort: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox_mode: Option<String>,
    pub model_catalog_json: Option<String>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub context_window: Option<u32>,
    pub web_search_mode: Option<String>,
    pub allow_network: Option<bool>,
    pub max_parallel_tools: Option<u32>,
    pub subagent_concurrency: Option<u32>,
    pub output_verbosity: Option<String>,
    pub instructions: Option<String>,
    pub providers: Option<Vec<ModelProviderConfig>>,
    pub mcp_servers: Option<Vec<McpServerConfigItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfoItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub dir_path: String,
    pub installed: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub prompt: String,
    pub status: String,
    pub rrule: String,
    pub cwds: Vec<String>,
    pub execution_environment: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub target_thread_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

pub fn config_toml_path() -> PathBuf {
    codex_home_dir().join("config.toml")
}

/// Ensures `model_catalog_json` (and any other root scalar keys) appear BEFORE any `[table]` header.
fn ensure_root_keys_before_tables(toml_text: &str) -> String {
    let mut root_lines = Vec::new();
    let mut table_lines = Vec::new();
    let mut in_table = false;

    for line in toml_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_table = true;
        }
        if !in_table {
            root_lines.push(line);
        } else if trimmed.starts_with("model_catalog_json") && trimmed.contains('=') {
            // Rescue misplaced model_catalog_json back to root
            root_lines.push(line);
        } else {
            table_lines.push(line);
        }
    }

    let mut out = root_lines.join("\n");
    if !table_lines.is_empty() {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&table_lines.join("\n"));
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

pub fn read_config_overview() -> Result<CodexConfigOverview, String> {
    let path = config_toml_path();
    let raw_toml = if path.is_file() {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let doc = raw_toml
        .parse::<DocumentMut>()
        .unwrap_or_else(|_| DocumentMut::new());

    let get_str = |key: &str| -> Option<String> {
        doc.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };

    let get_f64 = |key: &str| -> Option<f64> {
        doc.get(key)
            .and_then(|v| v.as_float().or_else(|| v.as_integer().map(|i| i as f64)))
    };

    let get_u32 = |key: &str| -> Option<u32> {
        doc.get(key)
            .and_then(|v| v.as_integer())
            .map(|i| i as u32)
    };

    let get_bool = |key: &str| -> Option<bool> {
        doc.get(key).and_then(|v| v.as_bool())
    };

    let mut providers = Vec::new();
    if let Some(prov_table) = doc.get("model_providers").and_then(|i| i.as_table_like()) {
        for (id, item) in prov_table.iter() {
            if let Some(t) = item.as_table_like() {
                let name = t
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(id)
                    .to_string();
                let base_url = t
                    .get("base_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let env_key = t
                    .get("env_key")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let wire_api = t
                    .get("wire_api")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                providers.push(ModelProviderConfig {
                    id: id.to_string(),
                    name,
                    base_url,
                    env_key,
                    wire_api,
                });
            }
        }
    }

    let mut mcp_servers = Vec::new();
    if let Some(mcp_table) = doc.get("mcp_servers").and_then(|i| i.as_table_like()) {
        for (id, item) in mcp_table.iter() {
            if id == "codex_app" {
                continue;
            }
            if let Some(t) = item.as_table_like() {
                let command = t
                    .get("command")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let url = t
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let args = t
                    .get("args")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut env = HashMap::new();
                if let Some(env_t) = t.get("env").and_then(|v| v.as_table_like()) {
                    for (ek, ev) in env_t.iter() {
                        if let Some(evs) = ev.as_str() {
                            env.insert(ek.to_string(), evs.to_string());
                        }
                    }
                }
                let enabled = t.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                mcp_servers.push(McpServerConfigItem {
                    id: id.to_string(),
                    command,
                    args,
                    url,
                    env,
                    enabled,
                });
            }
        }
    }

    Ok(CodexConfigOverview {
        config_path: path.to_string_lossy().to_string(),
        raw_toml,
        model: get_str("model"),
        model_provider: get_str("model_provider"),
        model_reasoning_effort: get_str("model_reasoning_effort"),
        approval_policy: get_str("approval_policy"),
        sandbox_mode: get_str("sandbox_mode"),
        model_catalog_json: get_str("model_catalog_json"),
        temperature: get_f64("temperature"),
        top_p: get_f64("top_p"),
        max_output_tokens: get_u32("max_output_tokens"),
        context_window: get_u32("context_window"),
        web_search_mode: get_str("web_search_mode"),
        allow_network: get_bool("allow_network"),
        max_parallel_tools: get_u32("max_parallel_tools"),
        subagent_concurrency: get_u32("subagent_concurrency"),
        output_verbosity: get_str("output_verbosity"),
        instructions: get_str("instructions"),
        providers,
        mcp_servers,
    })
}

pub fn save_raw_config_toml(raw_toml: &str) -> Result<CodexConfigOverview, String> {
    // Validate TOML syntax before writing
    raw_toml
        .parse::<DocumentMut>()
        .map_err(|e| format!("Invalid TOML syntax: {}", e))?;
    let normalized = ensure_root_keys_before_tables(raw_toml);
    let path = config_toml_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, normalized).map_err(|e| e.to_string())?;
    read_config_overview()
}

pub fn update_structured_config(payload: CodexConfigUpdatePayload) -> Result<CodexConfigOverview, String> {
    let path = config_toml_path();
    let existing = if path.is_file() {
        fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };
    let mut doc = existing
        .parse::<DocumentMut>()
        .map_err(|e| format!("Existing config.toml is invalid: {}", e))?;

    let set_or_remove_str = |doc: &mut DocumentMut, key: &str, val: Option<String>| {
        match val {
            Some(s) if !s.trim().is_empty() => {
                doc[key] = toml_edit::value(s.trim());
            }
            Some(_) => {
                doc.remove(key);
            }
            None => {}
        }
    };

    let set_or_remove_f64 = |doc: &mut DocumentMut, key: &str, val: Option<f64>| {
        match val {
            Some(v) => {
                doc[key] = toml_edit::value(v);
            }
            None => {}
        }
    };

    let set_or_remove_u32 = |doc: &mut DocumentMut, key: &str, val: Option<u32>| {
        match val {
            Some(v) => {
                doc[key] = toml_edit::value(v as i64);
            }
            None => {}
        }
    };

    let set_or_remove_bool = |doc: &mut DocumentMut, key: &str, val: Option<bool>| {
        match val {
            Some(v) => {
                doc[key] = toml_edit::value(v);
            }
            None => {}
        }
    };

    set_or_remove_str(&mut doc, "model", payload.model);
    set_or_remove_str(&mut doc, "model_provider", payload.model_provider);
    set_or_remove_str(
        &mut doc,
        "model_reasoning_effort",
        payload.model_reasoning_effort,
    );
    set_or_remove_str(&mut doc, "approval_policy", payload.approval_policy);
    set_or_remove_str(&mut doc, "sandbox_mode", payload.sandbox_mode);
    set_or_remove_str(&mut doc, "model_catalog_json", payload.model_catalog_json);
    set_or_remove_f64(&mut doc, "temperature", payload.temperature);
    set_or_remove_f64(&mut doc, "top_p", payload.top_p);
    set_or_remove_u32(&mut doc, "max_output_tokens", payload.max_output_tokens);
    set_or_remove_u32(&mut doc, "context_window", payload.context_window);
    set_or_remove_str(&mut doc, "web_search_mode", payload.web_search_mode);
    set_or_remove_bool(&mut doc, "allow_network", payload.allow_network);
    set_or_remove_u32(&mut doc, "max_parallel_tools", payload.max_parallel_tools);
    set_or_remove_u32(&mut doc, "subagent_concurrency", payload.subagent_concurrency);
    set_or_remove_str(&mut doc, "output_verbosity", payload.output_verbosity);
    set_or_remove_str(&mut doc, "instructions", payload.instructions);

    if let Some(providers) = payload.providers {
        let mut prov_root = doc
            .get("model_providers")
            .and_then(|i| i.as_table())
            .cloned()
            .unwrap_or_else(Table::new);
        prov_root.set_implicit(true);
        // Replace managed entries while keeping formatting clean
        prov_root.clear();
        for p in providers {
            if p.id.trim().is_empty() {
                continue;
            }
            let mut t = Table::new();
            t["name"] = toml_edit::value(if p.name.trim().is_empty() {
                p.id.trim()
            } else {
                p.name.trim()
            });
            t["base_url"] = toml_edit::value(p.base_url.trim());
            if let Some(ek) = p.env_key.filter(|s| !s.trim().is_empty()) {
                t["env_key"] = toml_edit::value(ek.trim());
            }
            if let Some(wa) = p.wire_api.filter(|s| !s.trim().is_empty()) {
                t["wire_api"] = toml_edit::value(wa.trim());
            } else {
                t["wire_api"] = toml_edit::value("responses");
            }
            prov_root.insert(p.id.trim(), Item::Table(t));
        }
        if prov_root.is_empty() {
            doc.remove("model_providers");
        } else {
            doc["model_providers"] = Item::Table(prov_root);
        }
    }

    if let Some(mcp_servers) = payload.mcp_servers {
        let mut mcp_root = Table::new();
        mcp_root.set_implicit(true);
        for srv in mcp_servers {
            if srv.id.trim().is_empty() {
                continue;
            }
            let mut t = Table::new();
            if let Some(cmd) = srv.command.filter(|s| !s.trim().is_empty()) {
                t["command"] = toml_edit::value(cmd.trim());
            }
            if !srv.args.is_empty() {
                let mut arr = toml_edit::Array::new();
                for a in &srv.args {
                    arr.push(a.as_str());
                }
                t["args"] = toml_edit::value(arr);
            }
            if let Some(u) = srv.url.filter(|s| !s.trim().is_empty()) {
                t["url"] = toml_edit::value(u.trim());
            }
            if !srv.env.is_empty() {
                let mut env_t = Table::new();
                for (k, v) in &srv.env {
                    env_t[k.as_str()] = toml_edit::value(v.as_str());
                }
                t["env"] = Item::Table(env_t);
            }
            if !srv.enabled {
                t["enabled"] = toml_edit::value(false);
            }
            mcp_root.insert(srv.id.trim(), Item::Table(t));
        }
        if mcp_root.is_empty() {
            doc.remove("mcp_servers");
        } else {
            doc["mcp_servers"] = Item::Table(mcp_root);
        }
    }

    let final_toml = ensure_root_keys_before_tables(&doc.to_string());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, final_toml).map_err(|e| e.to_string())?;
    read_config_overview()
}

pub(crate) fn parse_skill_dir(skill_dir: &Path, installed: bool) -> Option<SkillInfoItem> {
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }
    let content = fs::read_to_string(&skill_md).ok()?;
    let id = skill_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skill")
        .to_string();
    let mut name = id.clone();
    let mut description = String::new();
    for line in content.lines() {
        let t = line.trim();
        if let Some(h) = t.strip_prefix("# ") {
            if name == id {
                name = h.trim().to_string();
            }
        } else if let Some(d) = t.strip_prefix("description:") {
            description = d.trim().trim_matches('"').trim_matches('\'').to_string();
        } else if description.is_empty()
            && !t.is_empty()
            && !t.starts_with("---")
            && !t.starts_with('#')
            && !t.starts_with("name:")
        {
            description = t.chars().take(220).collect();
        }
    }
    if description.is_empty() {
        description = name.clone();
    }
    Some(SkillInfoItem {
        id,
        name,
        description,
        path: normalize_fs_path(&skill_md.to_string_lossy()),
        dir_path: normalize_fs_path(&skill_dir.to_string_lossy()),
        installed,
        content,
    })
}

pub fn list_local_and_recommended_skills(workspace_root: Option<String>) -> Vec<SkillInfoItem> {
    let mut out = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    let installed_root = codex_home_dir().join("skills");
    if let Ok(entries) = fs::read_dir(&installed_root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(skill) = parse_skill_dir(&entry.path(), true) {
                    seen_ids.insert(skill.id.clone());
                    out.push(skill);
                }
            }
        }
    }

    // Also check recommended/seed skills in workspace or CODEX_SKILL_SOURCE_DIR
    let mut seed_dirs = Vec::new();
    if let Ok(env_seed) = std::env::var("CODEX_SKILL_SOURCE_DIR") {
        if !env_seed.trim().is_empty() {
            seed_dirs.push(PathBuf::from(env_seed.trim()));
        }
    }
    if let Some(ws) = workspace_root {
        let ws_path = PathBuf::from(&ws);
        seed_dirs.push(ws_path.join("vendor_imports").join("skills"));
        seed_dirs.push(ws_path.join("_internal").join("seed").join("skills"));
    }

    for seed_root in seed_dirs {
        if let Ok(entries) = fs::read_dir(&seed_root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(skill) = parse_skill_dir(&entry.path(), false) {
                        if !seen_ids.contains(&skill.id) {
                            seen_ids.insert(skill.id.clone());
                            out.push(skill);
                        }
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| match (a.installed, b.installed) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    out
}

pub fn save_or_install_skill(
    id: &str,
    content: &str,
    source_dir: Option<String>,
) -> Result<SkillInfoItem, String> {
    save_or_install_skill_at_root(
        &codex_home_dir().join("skills"),
        id,
        content,
        source_dir.as_deref(),
    )
}

fn validated_skill_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid skill ID".to_string());
    }
    Ok(id)
}

fn save_or_install_skill_at_root(
    skills_root: &Path,
    id: &str,
    content: &str,
    source_dir: Option<&str>,
) -> Result<SkillInfoItem, String> {
    let id = validated_skill_id(id)?;
    let target_dir = skills_root.join(id);
    if let Some(src) = source_dir {
        let src_path = Path::new(&src);
        if src.trim().is_empty() || !src_path.is_dir() || !src_path.join("SKILL.md").is_file() {
            return Err("Skill source must be a directory containing SKILL.md".to_string());
        }
        copy_dir_recursive(src_path, &target_dir)?;
    } else {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        fs::write(target_dir.join("SKILL.md"), content).map_err(|e| e.to_string())?;
    }
    parse_skill_dir(&target_dir, true).ok_or_else(|| "Failed to read saved skill".to_string())
}

pub fn delete_installed_skill(id: &str) -> Result<(), String> {
    delete_installed_skill_at_root(&codex_home_dir().join("skills"), id)
}

fn delete_installed_skill_at_root(skills_root: &Path, id: &str) -> Result<(), String> {
    let id = id.trim();
    // Existing skill directories can contain dots or non-ASCII names.
    // Deletion must preserve their exact basename without accepting a path.
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.ends_with('.')
        || id.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("Invalid skill ID".to_string());
    }
    let target_dir = skills_root.join(id);
    if target_dir.is_dir() {
        fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), dest_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Ported from web-gateway/gateway/src/ipc/codex/automations.ts
pub fn list_automations() -> Vec<AutomationItem> {
    let dir = codex_home_dir().join("automations");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let toml_path = entry.path().join("automation.toml");
        if !toml_path.is_file() {
            continue;
        }
        if let Some(item) = parse_automation_toml(&toml_path) {
            items.push(item);
        }
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    items
}

fn parse_automation_toml(path: &Path) -> Option<AutomationItem> {
    let raw = fs::read_to_string(path).ok()?;
    let val: toml::Value = toml::from_str(&raw).ok()?;
    let table = val.as_table()?;
    let fallback_id = path.parent()?.file_name()?.to_str()?.to_string();
    let id = table
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(&fallback_id)
        .to_string();
    let kind = table
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("cron")
        .to_string();
    let name = table
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&id)
        .to_string();
    let prompt = table
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let status = table
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("ACTIVE")
        .to_string();
    let rrule = table
        .get("rrule")
        .and_then(|v| v.as_str())
        .unwrap_or("FREQ=DAILY;BYHOUR=9;BYMINUTE=0")
        .to_string();
    let cwds = table
        .get("cwds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let execution_environment = table
        .get("execution_environment")
        .or_else(|| table.get("executionEnvironment"))
        .and_then(|v| v.as_str())
        .unwrap_or("worktree")
        .to_string();
    let model = table
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let reasoning_effort = table
        .get("reasoning_effort")
        .or_else(|| table.get("reasoningEffort"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let target_thread_id = table
        .get("target_thread_id")
        .or_else(|| table.get("targetThreadId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mtime_ms = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Some(AutomationItem {
        id,
        kind,
        name,
        prompt,
        status,
        rrule,
        cwds,
        execution_environment,
        model,
        reasoning_effort,
        target_thread_id,
        created_at: mtime_ms,
        updated_at: mtime_ms,
    })
}

pub fn save_automation(item: AutomationItem) -> Result<Vec<AutomationItem>, String> {
    let id = if item.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        item.id.trim().to_string()
    };
    let dir = codex_home_dir().join("automations").join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut doc = DocumentMut::new();
    doc["id"] = toml_edit::value(id.as_str());
    doc["kind"] = toml_edit::value(item.kind.as_str());
    doc["name"] = toml_edit::value(item.name.as_str());
    doc["prompt"] = toml_edit::value(item.prompt.as_str());
    doc["status"] = toml_edit::value(item.status.as_str());
    doc["rrule"] = toml_edit::value(item.rrule.as_str());
    doc["execution_environment"] = toml_edit::value(item.execution_environment.as_str());
    let mut cwds_arr = toml_edit::Array::new();
    for c in &item.cwds {
        cwds_arr.push(c.as_str());
    }
    doc["cwds"] = toml_edit::value(cwds_arr);
    if let Some(m) = item.model.filter(|s| !s.trim().is_empty()) {
        doc["model"] = toml_edit::value(m);
    }
    if let Some(e) = item.reasoning_effort.filter(|s| !s.trim().is_empty()) {
        doc["reasoning_effort"] = toml_edit::value(e);
    }
    if let Some(t) = item.target_thread_id.filter(|s| !s.trim().is_empty()) {
        doc["target_thread_id"] = toml_edit::value(t);
    }
    doc["updated_at"] = toml_edit::value(now_ms);

    fs::write(dir.join("automation.toml"), doc.to_string()).map_err(|e| e.to_string())?;
    Ok(list_automations())
}

pub fn delete_automation(id: &str) -> Result<Vec<AutomationItem>, String> {
    let dir = codex_home_dir().join("automations").join(id.trim());
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(list_automations())
}

pub fn generate_sample_models_api_catalog() -> Result<String, String> {
    let target = codex_home_dir().join("models-api.json");
    if !target.exists() {
        let catalog = json!({
            "models": [
                {
                    "slug": "gpt-5.4",
                    "display_name": "GPT-5.4",
                    "description": "Flagship coding & reasoning model",
                    "visibility": "list",
                    "default_reasoning_level": "medium",
                    "supported_reasoning_levels": ["low", "medium", "high", "xhigh"]
                },
                {
                    "slug": "gpt-6-astra",
                    "display_name": "GPT-6-Astra",
                    "description": "Most capable model for complex, demanding work",
                    "visibility": "list",
                    "default_reasoning_level": "high",
                    "supported_reasoning_levels": ["low", "medium", "high", "xhigh", "max", "ultra"]
                },
                {
                    "slug": "deepseek-reasoner",
                    "display_name": "DeepSeek R1 / Reasoner",
                    "description": "Custom provider reasoning model",
                    "visibility": "list",
                    "default_reasoning_level": "high",
                    "supported_reasoning_levels": ["low", "medium", "high"]
                },
                {
                    "slug": "claude-sonnet-4-5",
                    "display_name": "Claude Sonnet 4.5",
                    "description": "Anthropic coding model via compatible gateway",
                    "visibility": "list",
                    "default_reasoning_level": "medium",
                    "supported_reasoning_levels": ["low", "medium", "high"]
                }
            ]
        });
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(
            &target,
            serde_json::to_string_pretty(&catalog).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(normalize_fs_path(&target.to_string_lossy()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatsOverview {
    pub codex_home: String,
    pub total_bytes: u64,
    pub sessions_bytes: u64,
    pub worktrees_bytes: u64,
    pub skills_bytes: u64,
    pub automations_bytes: u64,
    pub config_bytes: u64,
    pub worktree_count: usize,
    pub skill_count: usize,
    pub automation_count: usize,
}

fn dir_size_bytes(path: &Path, max_depth: usize) -> u64 {
    if max_depth == 0 || !path.exists() {
        return 0;
    }
    if path.is_file() {
        return fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    let mut sum = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                sum += dir_size_bytes(&p, max_depth - 1);
            } else {
                sum += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    sum
}

pub fn compute_storage_stats() -> StorageStatsOverview {
    let home = codex_home_dir();
    let sessions_bytes = dir_size_bytes(&home.join("sessions"), 5)
        + dir_size_bytes(&home.join("rollouts"), 5)
        + dir_size_bytes(&home.join("log"), 3);
    let worktrees_bytes = dir_size_bytes(&home.join("worktrees"), 5);
    let skills_bytes = dir_size_bytes(&home.join("skills"), 4);
    let automations_bytes = dir_size_bytes(&home.join("automations"), 4);
    let config_bytes = dir_size_bytes(&home.join("config.toml"), 1)
        + dir_size_bytes(&home.join("desktop-state.json"), 1)
        + dir_size_bytes(&home.join("models-api.json"), 1);
    let total_bytes =
        sessions_bytes + worktrees_bytes + skills_bytes + automations_bytes + config_bytes;

    let worktree_count = crate::git::list_worktrees(None).len();
    let skill_count = list_local_and_recommended_skills(None)
        .iter()
        .filter(|s| s.installed)
        .count();
    let automation_count = list_automations().len();

    StorageStatsOverview {
        codex_home: normalize_fs_path(&home.to_string_lossy()),
        total_bytes,
        sessions_bytes,
        worktrees_bytes,
        skills_bytes,
        automations_bytes,
        config_bytes,
        worktree_count,
        skill_count,
        automation_count,
    }
}

pub fn import_external_tool_config(kind: &str, cwd: Option<&str>) -> Result<serde_json::Value, String> {
    match kind {
        "claude" => {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(appdata) = std::env::var_os("APPDATA") {
                candidates.push(PathBuf::from(appdata).join("Claude").join("claude_desktop_config.json"));
            }
            if let Some(home) = dirs::home_dir() {
                candidates.push(home.join(".config").join("Claude").join("claude_desktop_config.json"));
                candidates.push(home.join("Library").join("Application Support").join("Claude").join("claude_desktop_config.json"));
            }
            for candidate in candidates {
                if candidate.is_file() {
                    let content = fs::read_to_string(&candidate).map_err(|e| e.to_string())?;
                    let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
                    let mut imported_servers = Vec::new();
                    if let Some(servers) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
                        for (key, val) in servers {
                            let command = val.get("command").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let args = val.get("args").and_then(|v| v.as_array())
                                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                                .unwrap_or_default();
                            let env = val.get("env").and_then(|v| v.as_object())
                                .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect())
                                .unwrap_or_default();
                            imported_servers.push(McpServerConfigItem {
                                id: key.clone(),
                                command,
                                args,
                                url: val.get("url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                env,
                                enabled: true,
                            });
                        }
                    }
                    return Ok(json!({
                        "found": true,
                        "path": normalize_fs_path(&candidate.to_string_lossy()),
                        "mcpServers": imported_servers,
                        "count": imported_servers.len()
                    }));
                }
            }
            let default_path = if cfg!(target_os = "windows") {
                format!("{}\\Claude\\claude_desktop_config.json", std::env::var("APPDATA").unwrap_or_default())
            } else {
                "~/.config/Claude/claude_desktop_config.json".to_string()
            };
            Ok(json!({
                "found": false,
                "path": default_path,
                "mcpServers": [],
                "count": 0
            }))
        }
        "cursor" => {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(root) = cwd.filter(|s| !s.trim().is_empty()) {
                let p = Path::new(root);
                candidates.push(p.join(".cursorrules"));
                candidates.push(p.join(".cursor").join("rules"));
            }
            if let Some(home) = dirs::home_dir() {
                candidates.push(home.join(".cursorrules"));
            }
            for candidate in candidates {
                if candidate.is_file() {
                    let content = fs::read_to_string(&candidate).map_err(|e| e.to_string())?;
                    return Ok(json!({
                        "found": true,
                        "path": normalize_fs_path(&candidate.to_string_lossy()),
                        "content": content
                    }));
                }
            }
            Ok(json!({
                "found": false,
                "path": ".cursorrules",
                "content": ""
            }))
        }
        "windsurf" => {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(root) = cwd.filter(|s| !s.trim().is_empty()) {
                let p = Path::new(root);
                candidates.push(p.join(".windsurfrules"));
                candidates.push(p.join(".windsurf").join("rules"));
            }
            if let Some(home) = dirs::home_dir() {
                candidates.push(home.join(".codeium").join("windsurf").join("memories").join("global_rules.md"));
                candidates.push(home.join(".windsurfrules"));
            }
            for candidate in candidates {
                if candidate.is_file() {
                    let content = fs::read_to_string(&candidate).map_err(|e| e.to_string())?;
                    return Ok(json!({
                        "found": true,
                        "path": normalize_fs_path(&candidate.to_string_lossy()),
                        "content": content
                    }));
                }
            }
            Ok(json!({
                "found": false,
                "path": ".windsurfrules",
                "content": ""
            }))
        }
        "vscode" => {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(appdata) = std::env::var_os("APPDATA") {
                candidates.push(PathBuf::from(appdata).join("Code").join("User").join("keybindings.json"));
            }
            if let Some(home) = dirs::home_dir() {
                candidates.push(home.join(".config").join("Code").join("User").join("keybindings.json"));
                candidates.push(home.join("Library").join("Application Support").join("Code").join("User").join("keybindings.json"));
            }
            for candidate in candidates {
                if candidate.is_file() {
                    let content = fs::read_to_string(&candidate).map_err(|e| e.to_string())?;
                    let count = serde_json::from_str::<serde_json::Value>(&content)
                        .ok()
                        .and_then(|v| v.as_array().map(|a| a.len()))
                        .unwrap_or(0);
                    return Ok(json!({
                        "found": true,
                        "path": normalize_fs_path(&candidate.to_string_lossy()),
                        "count": count
                    }));
                }
            }
            let default_path = if cfg!(target_os = "windows") {
                format!("{}\\Code\\User\\keybindings.json", std::env::var("APPDATA").unwrap_or_default())
            } else {
                "~/.config/Code/User/keybindings.json".to_string()
            };
            Ok(json!({
                "found": false,
                "path": default_path,
                "count": 0
            }))
        }
        _ => Err(format!("Unknown import kind: {}", kind)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_writes_reject_invalid_ids_and_invalid_sources_without_changing_existing_files() {
        let test_root = std::env::temp_dir().join(format!(
            "codex-native-skill-writes-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let skills_root = test_root.join("skills");
        let outside = test_root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("SKILL.md"), "# Outside\n").unwrap();

        let saved = save_or_install_skill_at_root(&skills_root, " valid-ID_1 ", "# Original\n", None)
            .unwrap();
        assert_eq!(saved.id, "valid-ID_1");
        for id in ["", " ", "..", "../outside", "..\\outside", "a/b", "a\\b", "valid-ID_1!", "名字"] {
            assert!(save_or_install_skill_at_root(&skills_root, id, "# Changed\n", None).is_err());
        }
        for id in ["", " ", ".", "..", "../outside", "..\\outside", "a/b", "a\\b", "C:outside", "name."] {
            assert!(delete_installed_skill_at_root(&skills_root, id).is_err());
        }
        for id in ["foo.bar", "名字", "valid-ID_1!"] {
            let existing = skills_root.join(id);
            fs::create_dir_all(&existing).unwrap();
            fs::write(existing.join("SKILL.md"), "# Existing\n").unwrap();
            assert_eq!(parse_skill_dir(&existing, true).unwrap().id, id);
            delete_installed_skill_at_root(&skills_root, id).unwrap();
            assert!(!existing.exists());
            assert_eq!(fs::read_to_string(outside.join("SKILL.md")).unwrap(), "# Outside\n");
        }
        assert_eq!(fs::read_to_string(outside.join("SKILL.md")).unwrap(), "# Outside\n");
        assert_eq!(
            fs::read_to_string(skills_root.join("valid-ID_1/SKILL.md")).unwrap(),
            "# Original\n"
        );

        let empty_source = test_root.join("empty-source");
        fs::create_dir_all(&empty_source).unwrap();
        let missing_source = test_root.join("missing-source");
        for source in [
            "",
            empty_source.to_str().unwrap(),
            missing_source.to_str().unwrap(),
        ] {
            assert!(save_or_install_skill_at_root(
                &skills_root, "valid-ID_1", "# Changed\n", Some(source)
            ).is_err());
        }
        assert_eq!(
            fs::read_to_string(skills_root.join("valid-ID_1/SKILL.md")).unwrap(),
            "# Original\n"
        );
        assert!(!skills_root.join("valid-ID_1!").exists());

        let source = test_root.join("source");
        fs::create_dir_all(source.join("scripts")).unwrap();
        fs::write(source.join("SKILL.md"), "# Imported\n").unwrap();
        fs::write(source.join("scripts/run.txt"), "script fixture").unwrap();
        let installed = save_or_install_skill_at_root(
            &skills_root, "valid-ID_1", "ignored content", Some(source.to_str().unwrap())
        ).unwrap();
        assert_eq!(installed.content, "# Imported\n");
        assert_eq!(
            fs::read_to_string(skills_root.join("valid-ID_1/scripts/run.txt")).unwrap(),
            "script fixture"
        );
        delete_installed_skill_at_root(&skills_root, " valid-ID_1 ").unwrap();
        assert!(!skills_root.join("valid-ID_1").exists());
        assert_eq!(fs::read_to_string(outside.join("SKILL.md")).unwrap(), "# Outside\n");
        fs::remove_dir_all(&test_root).unwrap();
    }

    #[test]
    fn keeps_model_catalog_json_at_root_before_tables() {
        let input = "model = \"gpt-5.4\"\n\n[model_providers.crs]\nname = \"CRS\"\nmodel_catalog_json = \"C:\\\\Users\\\\test\\\\.codex\\\\models-api.json\"\n";
        let normalized = ensure_root_keys_before_tables(input);
        let first_table_idx = normalized.find("[model_providers.crs]").unwrap();
        let catalog_idx = normalized.find("model_catalog_json").unwrap();
        assert!(
            catalog_idx < first_table_idx,
            "model_catalog_json must appear before any [table]"
        );
        let parsed: DocumentMut = normalized.parse().expect("valid TOML");
        assert_eq!(
            parsed.get("model_catalog_json").and_then(|v| v.as_str()),
            Some("C:\\Users\\test\\.codex\\models-api.json")
        );
    }

    #[test]
    fn parses_and_serializes_hyperparameters_correctly() {
        let toml_sample = r#"
model = "gpt-5.4"
temperature = 0.35
top_p = 0.95
max_output_tokens = 16384
context_window = 200000
web_search_mode = "live"
allow_network = true
max_parallel_tools = 12
subagent_concurrency = 6
output_verbosity = "high"
"#;
        let doc: DocumentMut = toml_sample.parse().expect("valid TOML");
        assert_eq!(doc.get("temperature").and_then(|v| v.as_float()), Some(0.35));
        assert_eq!(doc.get("top_p").and_then(|v| v.as_float()), Some(0.95));
        assert_eq!(doc.get("max_output_tokens").and_then(|v| v.as_integer()), Some(16384));
        assert_eq!(doc.get("context_window").and_then(|v| v.as_integer()), Some(200000));
        assert_eq!(doc.get("web_search_mode").and_then(|v| v.as_str()), Some("live"));
        assert_eq!(doc.get("allow_network").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(doc.get("max_parallel_tools").and_then(|v| v.as_integer()), Some(12));
        assert_eq!(doc.get("subagent_concurrency").and_then(|v| v.as_integer()), Some(6));
        assert_eq!(doc.get("output_verbosity").and_then(|v| v.as_str()), Some("high"));
    }
}

