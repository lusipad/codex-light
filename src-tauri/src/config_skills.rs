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

fn parse_skill_dir(skill_dir: &Path, installed: bool) -> Option<SkillInfoItem> {
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
    let clean_id: String = id
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if clean_id.is_empty() {
        return Err("Invalid skill ID".to_string());
    }
    let target_dir = codex_home_dir().join("skills").join(&clean_id);
    if let Some(src) = source_dir.filter(|s| !s.trim().is_empty()) {
        let src_path = Path::new(&src);
        if src_path.is_dir() {
            copy_dir_recursive(src_path, &target_dir)?;
        }
    } else {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        fs::write(target_dir.join("SKILL.md"), content).map_err(|e| e.to_string())?;
    }
    parse_skill_dir(&target_dir, true).ok_or_else(|| "Failed to read saved skill".to_string())
}

pub fn delete_installed_skill(id: &str) -> Result<(), String> {
    let target_dir = codex_home_dir().join("skills").join(id.trim());
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

#[cfg(test)]
mod tests {
    use super::*;

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
}

