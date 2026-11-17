use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

const DESKTOP_PROJECT_ROOTS_KEY: &str = "electron-saved-workspace-roots";
const DESKTOP_WORKSPACE_LABELS_KEY: &str = "electron-workspace-root-labels";
const ACTIVE_WORKSPACE_ROOTS_KEY: &str = "active-workspace-roots";
const PINNED_THREAD_IDS_KEY: &str = "pinned-thread-ids";
const PINNED_PROJECT_IDS_KEY: &str = "pinned-project-ids";
const ARCHIVED_THREADS_KEY: &str = "archivedThreads";
const THREAD_WORKSPACE_HINTS_KEY: &str = "thread-workspace-root-hints";
const PERSISTED_ATOM_STATE_KEY: &str = "electron-persisted-atom-state";
const LOCAL_PROJECTS_ATOM_KEY: &str = "local-projects";
const PROJECT_ORDER_ATOM_KEY: &str = "project-order";
const SELECTED_PROJECT_ATOM_KEY: &str = "selected-project";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivePinPlacement {
    pub before_thread_id: Option<String>,
}

fn workspace_server_project_id(
    state: &Map<String, Value>,
    identity: &str,
    legacy_id: &str,
) -> Option<String> {
    state
        .get("app-server-project-id-by-legacy-project-id-by-host")?
        .get(identity)?
        .get(legacy_id)?
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

fn is_project_assignment(value: &Value) -> bool {
    matches!(
        value.get("projectKind").and_then(Value::as_str),
        Some("local" | "remote")
    ) && value.get("projectId").and_then(Value::as_str).is_some()
}

fn read_sidebar_project_membership(state: &Map<String, Value>) -> Value {
    let assignments: Map<String, Value> = state
        .get("thread-project-assignments")
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter(|(_, value)| is_project_assignment(value))
                .map(|(id, value)| (id.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();
    let projectless: Vec<String> = state
        .get("projectless-thread-ids")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let mut workspace_assignments = Map::new();
    let mut local_projects = Vec::new();
    let mut selected_project_id = Value::Null;
    if let Some(atoms) = state
        .get(PERSISTED_ATOM_STATE_KEY)
        .and_then(Value::as_object)
    {
        for (key, value) in atoms {
            let Some(id) = key
                .strip_prefix("thread-workspace-state-v1:")
                .filter(|id| !id.is_empty())
            else {
                continue;
            };
            let assignment = value
                .get("projectMembership")
                .filter(|value| !value.is_null())
                .or_else(|| value.get("project"));
            if let Some(assignment) =
                assignment.filter(|value| value.is_null() || is_project_assignment(value))
            {
                workspace_assignments.insert(id.to_owned(), assignment.clone());
            }
        }

        let project_identity = format!("local:{}", codex_home_dir().to_string_lossy());
        let mut parsed_projects: Vec<(String, Value)> = Vec::new();
        if let Some(projects) = atoms
            .get(LOCAL_PROJECTS_ATOM_KEY)
            .and_then(Value::as_object)
        {
            for (map_id, value) in projects {
                let Some(project) = value.as_object() else {
                    continue;
                };
                let Some(id) = project
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|id| !id.is_empty() && *id == map_id)
                else {
                    continue;
                };
                let name = project
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty());
                let created_at = project.get("createdAt").filter(|value| value.is_number());
                let Some(name) = name else { continue };
                let Some(created_at) = created_at else {
                    continue;
                };
                let Some(root_paths) = project.get("rootPaths").and_then(Value::as_array) else {
                    continue;
                };
                let roots: Vec<String> = root_paths
                    .iter()
                    .filter_map(Value::as_str)
                    .map(normalize_fs_path)
                    .filter(|path| !path.is_empty())
                    .collect();
                if id.is_empty() || roots.is_empty() || roots.len() != root_paths.len() {
                    continue;
                }
                let mut item = Map::new();
                item.insert("id".to_string(), Value::String(id.to_string()));
                item.insert("name".to_string(), Value::String(name.to_string()));
                item.insert("rootPaths".to_string(), json!(roots));
                item.insert("createdAt".to_string(), created_at.clone());
                if let Some(server_id) = workspace_server_project_id(state, &project_identity, id) {
                    item.insert("serverProjectId".to_string(), Value::String(server_id));
                }
                parsed_projects.push((id.to_string(), Value::Object(item)));
            }
        }

        let project_ids: std::collections::HashSet<String> =
            parsed_projects.iter().map(|(id, _)| id.clone()).collect();
        let mut ordered_ids = std::collections::HashSet::new();
        if let Some(order) = atoms.get(PROJECT_ORDER_ATOM_KEY).and_then(Value::as_array) {
            for id in order.iter().filter_map(Value::as_str) {
                if let Some(value) = parsed_projects
                    .iter()
                    .find(|(project_id, _)| project_id == id)
                    .map(|(_, value)| value)
                {
                    if ordered_ids.insert(id.to_string()) {
                        local_projects.push(value.clone());
                    }
                }
            }
        }
        local_projects.extend(
            parsed_projects
                .into_iter()
                .filter(|(id, _)| !ordered_ids.contains(id))
                .map(|(_, value)| value),
        );

        selected_project_id = atoms
            .get(SELECTED_PROJECT_ATOM_KEY)
            .and_then(|value| {
                value
                    .as_object()
                    .filter(|project| project.get("type").and_then(Value::as_str) == Some("local"))
                    .and_then(|project| project.get("projectId"))
                    .and_then(Value::as_str)
                    .filter(|id| project_ids.contains(*id))
                    .map(|id| Value::String(id.to_string()))
            })
            .unwrap_or(Value::Null);
    }
    json!({
        "threadProjectAssignments": assignments,
        "projectlessThreadIds": projectless,
        "workspaceProjectAssignments": workspace_assignments,
        "localProjects": local_projects,
        "selectedProjectId": selected_project_id,
    })
}

fn persist_state_map(state: &Map<String, Value>, state_path: &Path) -> Result<(), String> {
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = state_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(&Value::Object(state.clone()))
        .map_err(|error| error.to_string())?;
    match fs::write(&temporary, bytes).and_then(|_| fs::rename(&temporary, state_path)) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error.to_string())
        }
    }
}

fn project_id_matches(value: &Value, expected: Option<&str>) -> bool {
    match expected {
        Some(expected) => value.as_str() == Some(expected),
        None => value.is_null(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootItem {
    pub id: String,
    pub path: String,
    pub label: String,
    pub active: bool,
    pub has_agents_md: bool,
    pub server_project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntryItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewResult {
    pub path: String,
    pub is_binary: bool,
    pub is_image: bool,
    pub content: Option<String>,
    pub base64_data_url: Option<String>,
    pub size_bytes: u64,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileHit {
    pub name: String,
    pub rel_path: String,
    pub rel_dir: String,
    pub abs_path: String,
    pub is_directory: bool,
}

pub fn codex_home_dir() -> PathBuf {
    if let Ok(env_home) = std::env::var("CODEX_HOME") {
        if !env_home.trim().is_empty() {
            return PathBuf::from(env_home.trim());
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

pub fn desktop_global_state_path() -> PathBuf {
    codex_home_dir().join(".codex-global-state.json")
}

pub fn normalize_fs_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let expanded = if trimmed == "~" || trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            home.join(&trimmed[2..]).to_string_lossy().to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    let p = PathBuf::from(&expanded);
    let resolved = fs::canonicalize(&p).unwrap_or(p);
    let s = resolved.to_string_lossy().to_string();
    // Strip Windows extended-length prefix \\?\
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        s
    }
}

fn select_local_project_in_state(
    state: &mut Map<String, Value>,
    project_id: &str,
) -> Result<(), String> {
    let requested_id = project_id.trim();
    if requested_id.is_empty() {
        return Err("Project id is required".to_string());
    }

    let membership = read_sidebar_project_membership(state);
    let project = membership["localProjects"]
        .as_array()
        .and_then(|projects| {
            projects
                .iter()
                .find(|project| project["id"].as_str() == Some(requested_id))
        })
        .ok_or_else(|| format!("Unknown local project: {requested_id}"))?;
    let first_root = project["rootPaths"][0].as_str().unwrap().to_string();
    state
        .get_mut(PERSISTED_ATOM_STATE_KEY)
        .and_then(Value::as_object_mut)
        .unwrap()
        .insert(
            SELECTED_PROJECT_ATOM_KEY.to_string(),
            json!({ "type": "local", "projectId": requested_id }),
        );
    let mut saved_roots: Vec<String> = state
        .get(DESKTOP_PROJECT_ROOTS_KEY)
        .and_then(Value::as_array)
        .map(|roots| {
            roots
                .iter()
                .filter_map(Value::as_str)
                .map(normalize_fs_path)
                .filter(|path| !path.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if !saved_roots
        .iter()
        .any(|path| path.eq_ignore_ascii_case(&first_root))
    {
        saved_roots.insert(0, first_root.clone());
    }
    state.insert(DESKTOP_PROJECT_ROOTS_KEY.to_string(), json!(saved_roots));
    state.insert(
        ACTIVE_WORKSPACE_ROOTS_KEY.to_string(),
        json!([first_root.clone()]),
    );
    Ok(())
}

#[derive(Clone)]
pub struct DesktopStateManager {
    state_map: Arc<Mutex<Map<String, Value>>>,
    workspace_turn_owners: Arc<Mutex<HashMap<String, String>>>,
}

#[cfg(test)]
mod created_project_registration_tests {
    use super::*;

    struct Fixture { manager: DesktopStateManager, directory: PathBuf, path: PathBuf, roots: Vec<String> }
    impl Fixture {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!("codex-register-project-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(directory.join("first")).unwrap(); fs::create_dir_all(directory.join("second")).unwrap();
            let roots = ["first", "second"].map(|name| normalize_fs_path(&directory.join(name).to_string_lossy())).to_vec();
            let initial = json!({"unrelated":{"keep":true},"app-server-project-id-by-legacy-project-id-by-host":{
                "local:other-home":{"existing":"other-server"}},"electron-persisted-atom-state":{
                "unrelated-atom":{"value":"keep"},"local-projects":{"existing":{"id":"existing","name":"Existing",
                    "rootPaths":[roots[0]],"createdAt":1,"appearance":{"icon":"keep"}}},"project-order":["existing"]}});
            Self { manager: DesktopStateManager {state_map:Arc::new(Mutex::new(initial.as_object().unwrap().clone())),
                workspace_turn_owners:Arc::new(Mutex::new(HashMap::new()))}, path:directory.join("state.json"), directory, roots }
        }
        fn project(&self) -> Value {
            json!({"project":{"id":"new-server","name":"新建多根项目","roots":self.roots.iter().map(|path|json!({"path":path})).collect::<Vec<_>>(),"createdAt":21}})
        }
    }
    impl Drop for Fixture {fn drop(&mut self) {let _ = fs::remove_dir_all(&self.directory);}}

    #[tokio::test]
    async fn created_project_registration_reads_real_project_and_persists_one_complete_selection() {
        let fixture = Fixture::new(); let project = fixture.project(); let initial = fixture.manager.state_map.lock().unwrap().clone();
        let calls = std::sync::Mutex::new(Vec::new());
        let result = fixture.manager.register_created_project_at_path("new-server", &fixture.path, |method, params| {
            calls.lock().unwrap().push((method, params)); std::future::ready(Ok(project.clone()))
        }).await.unwrap();
        assert_eq!(*calls.lock().unwrap(),vec![("project/read".into(),json!({"projectId":"new-server"}))]);
        assert_eq!(result["projectMembership"]["selectedProjectId"],"server:new-server");
        let registered = result["projectMembership"]["localProjects"].as_array().unwrap().iter().find(|item|item["id"]=="server:new-server").unwrap();
        assert_eq!(registered["serverProjectId"],"new-server"); assert_eq!(registered["name"],"新建多根项目"); assert_eq!(registered["rootPaths"],json!(fixture.roots));
        let saved: Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
        assert_eq!(saved["unrelated"],initial["unrelated"]);
        assert_eq!(saved[PERSISTED_ATOM_STATE_KEY]["unrelated-atom"],initial[PERSISTED_ATOM_STATE_KEY]["unrelated-atom"]);
        assert_eq!(saved[PERSISTED_ATOM_STATE_KEY][LOCAL_PROJECTS_ATOM_KEY]["existing"],initial[PERSISTED_ATOM_STATE_KEY][LOCAL_PROJECTS_ATOM_KEY]["existing"]);
        let scope = format!("local:{}",codex_home_dir().to_string_lossy());
        assert_eq!(saved["app-server-project-id-by-legacy-project-id-by-host"][&scope]["server:new-server"],"new-server");
        assert_eq!(saved["app-server-project-id-by-legacy-project-id-by-host"]["local:other-home"],initial["app-server-project-id-by-legacy-project-id-by-host"]["local:other-home"]);
        assert_eq!(saved[ACTIVE_WORKSPACE_ROOTS_KEY],json!([fixture.roots[0]]));
        assert_eq!(saved.as_object().unwrap(),&*fixture.manager.state_map.lock().unwrap());
    }

    #[tokio::test]
    async fn created_project_registration_reuses_server_identity_without_duplicate_or_metadata_loss() {
        let fixture = Fixture::new(); let scope = format!("local:{}",codex_home_dir().to_string_lossy());
        {
            let mut state = fixture.manager.state_map.lock().unwrap();
            state.get_mut("app-server-project-id-by-legacy-project-id-by-host").unwrap()[&scope] = json!({"existing":"new-server"});
        }
        let project = fixture.project();
        for _ in 0..2 {
            let result = fixture.manager.register_created_project_at_path("new-server", &fixture.path, |_,_|std::future::ready(Ok(project.clone()))).await.unwrap();
            assert_eq!(result["projectMembership"]["selectedProjectId"],"existing");
            assert_eq!(result["projectMembership"]["localProjects"].as_array().unwrap().len(),1);
        }
        let saved: Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
        assert_eq!(saved[PERSISTED_ATOM_STATE_KEY][LOCAL_PROJECTS_ATOM_KEY]["existing"]["appearance"],json!({"icon":"keep"}));
        assert_eq!(saved[PERSISTED_ATOM_STATE_KEY][PROJECT_ORDER_ATOM_KEY],json!(["existing"]));
    }

    #[tokio::test]
    async fn created_project_registration_rejects_bad_live_fields_and_directories_without_state_changes() {
        let fixture = Fixture::new(); let initial = fixture.manager.state_map.lock().unwrap().clone();
        let mut invalid = Vec::new();
        for (field,value) in [("id",json!("other-server")),("name",json!("  ")),("name",json!(7)),("roots",json!([])),
            ("roots",json!([{"path":"relative/path"}])),("roots",json!([{"path":fixture.directory.join("missing").to_string_lossy()}])),("roots",json!([{"path":7}]))] {
            let mut project = fixture.project(); project["project"][field] = value; invalid.push(project);
        }
        fs::write(fixture.directory.join("file"),b"not a directory").unwrap();
        let mut file = fixture.project(); file["project"]["roots"] = json!([{"path":fixture.directory.join("file").to_string_lossy()}]); invalid.push(file);
        invalid.extend([Value::Null,json!({}),json!({"project":null})]);
        for project in invalid {
            assert!(fixture.manager.register_created_project_at_path("new-server", &fixture.path, |_,_|std::future::ready(Ok(project.clone()))).await.is_err());
            assert_eq!(*fixture.manager.state_map.lock().unwrap(),initial); assert!(!fixture.path.exists());
        }
    }

    #[tokio::test]
    async fn created_project_registration_persist_failure_and_mapping_conflicts_leave_memory_unchanged() {
        let fixture = Fixture::new(); let project = fixture.project(); let initial = fixture.manager.state_map.lock().unwrap().clone();
        let blocked = fixture.directory.join("blocked"); fs::create_dir(&blocked).unwrap();
        assert!(fixture.manager.register_created_project_at_path("new-server", &blocked, |_,_|std::future::ready(Ok(project.clone()))).await.is_err());
        assert_eq!(*fixture.manager.state_map.lock().unwrap(),initial);
        let scope = format!("local:{}",codex_home_dir().to_string_lossy());
        {
            let mut state = fixture.manager.state_map.lock().unwrap();
            state.get_mut("app-server-project-id-by-legacy-project-id-by-host").unwrap()[&scope] = json!({"server:new-server":"different-server"});
        }
        let conflicting = fixture.manager.state_map.lock().unwrap().clone();
        assert!(fixture.manager.register_created_project_at_path("new-server", &fixture.path, |_,_|std::future::ready(Ok(project.clone()))).await.is_err());
        assert_eq!(*fixture.manager.state_map.lock().unwrap(),conflicting); assert!(!fixture.path.exists());
    }

    #[tokio::test]
    async fn created_project_registration_repeated_new_identity_and_concurrent_unrelated_changes_are_preserved() {
        let fixture = Fixture::new(); let project = fixture.project();
        fixture.manager.register_created_project_at_path("new-server", &fixture.path, |_,_| {
            fixture.manager.state_map.lock().unwrap().insert("changed-during-read".into(),json!("keep-latest"));
            std::future::ready(Ok(project.clone()))
        }).await.unwrap();
        let first: Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
        fixture.manager.register_created_project_at_path("new-server", &fixture.path, |_,_|std::future::ready(Ok(project.clone()))).await.unwrap();
        let second: Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
        assert_eq!(second,first); assert_eq!(second["changed-during-read"],"keep-latest");
        assert_eq!(second[PERSISTED_ATOM_STATE_KEY][LOCAL_PROJECTS_ATOM_KEY].as_object().unwrap().len(),2);
        assert_eq!(second[PERSISTED_ATOM_STATE_KEY][PROJECT_ORDER_ATOM_KEY],json!(["server:new-server","existing"]));
    }

    #[tokio::test]
    async fn created_project_registration_rejects_unmapped_entity_or_corrupt_storage_without_overwrite() {
        for kind in ["entity-conflict","duplicate-mapping","bad-atoms","bad-projects","bad-mappings"] {
            let fixture = Fixture::new(); let project = fixture.project(); let scope = format!("local:{}",codex_home_dir().to_string_lossy());
            {
                let mut state = fixture.manager.state_map.lock().unwrap();
                match kind {
                    "entity-conflict" => state.get_mut(PERSISTED_ATOM_STATE_KEY).unwrap()[LOCAL_PROJECTS_ATOM_KEY]["server:new-server"] = json!({"id":"server:new-server","name":"Unmapped occupant"}),
                    "duplicate-mapping" => state.get_mut("app-server-project-id-by-legacy-project-id-by-host").unwrap()[&scope] = json!({"first":"new-server","second":"new-server"}),
                    "bad-atoms" => {state.insert(PERSISTED_ATOM_STATE_KEY.into(),json!([]));},
                    "bad-projects" => state.get_mut(PERSISTED_ATOM_STATE_KEY).unwrap()[LOCAL_PROJECTS_ATOM_KEY] = json!([]),
                    _ => {state.insert("app-server-project-id-by-legacy-project-id-by-host".into(),json!([]));},
                }
            }
            let before = fixture.manager.state_map.lock().unwrap().clone();
            assert!(fixture.manager.register_created_project_at_path("new-server", &fixture.path, |_,_|std::future::ready(Ok(project.clone()))).await.is_err());
            assert_eq!(*fixture.manager.state_map.lock().unwrap(),before); assert!(!fixture.path.exists());
        }
        let fixture = Fixture::new(); let calls = std::sync::atomic::AtomicUsize::new(0);
        for id in ["","  ","bad\nid"," leading"] {
            assert!(fixture.manager.register_created_project_at_path(id, &fixture.path, |_,_| {
                calls.fetch_add(1,std::sync::atomic::Ordering::SeqCst); std::future::ready(Ok(fixture.project()))
            }).await.is_err());
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst),0); assert!(!fixture.path.exists());
    }
}

#[cfg(test)]
mod workspace_transition_tests {
    use super::*;

    #[test]
    fn pet_preferences_preserve_atomic_patches_and_reject_invalid_storage() {
        let (manager, directory) = fixture();
        let path = directory.join("pets.json");
        assert_eq!(manager.pet_preferences().unwrap(), json!({"selectedAvatarId":null,"petSize":112,"petVisibility":"always-visible"}));
        manager.update_pet_preferences_at_path(json!({"selectedAvatarId":"custom-one"}), &path).unwrap();
        std::thread::scope(|scope| {
            scope.spawn(|| manager.update_pet_preferences_at_path(json!({"petSize":224}), &path).unwrap());
            scope.spawn(|| manager.update_pet_preferences_at_path(json!({"petVisibility":"on-demand"}), &path).unwrap());
        });
        let expected = json!({"selectedAvatarId":"custom-one","petSize":224,"petVisibility":"on-demand"});
        assert_eq!(manager.pet_preferences().unwrap(), expected);
        let bytes = fs::read(&path).unwrap();
        let disk: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(disk["unrelated"], "keep");
        assert_eq!(disk[PERSISTED_ATOM_STATE_KEY]["selected-avatar-id"], "custom-one");
        assert_eq!(disk[PERSISTED_ATOM_STATE_KEY]["avatar-overlay-mascot-width-px"], 224);
        assert_eq!(disk[PERSISTED_ATOM_STATE_KEY]["pet-visibility"], "on-demand");
        assert_eq!(disk[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:t"]["revision"], "r1");
        for invalid in [json!({"unknown":true}),json!({"petSize":79}),json!({"petSize":225}),json!({"petSize":112.5}),json!({"petSize":"112"}),json!({"selectedAvatarId":" "}),json!({"selectedAvatarId":false}),json!({"petVisibility":"hidden"}),json!([])] {
            assert!(manager.update_pet_preferences_at_path(invalid, &path).is_err());
            assert_eq!(manager.pet_preferences().unwrap(), expected);
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        assert!(manager.update_pet_preferences_at_path(json!({"petSize":80}), &directory).is_err());
        assert_eq!(manager.pet_preferences().unwrap(), expected);
        manager.update_pet_preferences_at_path(json!({"selectedAvatarId":null,"petSize":80}), &path).unwrap();
        assert_eq!(manager.pet_preferences().unwrap()["selectedAvatarId"], Value::Null);
        manager.state_map.lock().unwrap().insert(PERSISTED_ATOM_STATE_KEY.into(), json!({"pet-visibility":false}));
        assert!(manager.pet_preferences().is_err());
        fs::remove_file(path).unwrap(); fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn review_preferences_roundtrip_merges_atoms_rejects_invalid_writes_and_preserves_on_failure() {
        let (manager, directory) = fixture();
        let path = directory.join("review.json");
        assert_eq!(manager.review_preferences().unwrap()["githubLinkTarget"], "github");
        assert_eq!(manager.review_preferences().unwrap()["configuredGithubLinkTarget"], Value::Null);
        manager.update_review_preferences_at_path(json!({"localReviewInstructions":"关注并发"}), &path).unwrap();
        let readback = manager.update_review_preferences_at_path(json!({"githubLinkTarget":"github"}), &path).unwrap();
        assert_eq!(readback["configuredGithubLinkTarget"], "github");
        assert_eq!(readback["localReviewInstructions"], "关注并发");
        let bytes = fs::read(&path).unwrap();
        let disk: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(disk["unrelated"], "keep");
        assert_eq!(disk[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:t"]["revision"], "r1");
        for invalid in [json!({"githubLinkTarget":"external-browser"}), json!({"githubLinkTarget":"in-app-browser"}), json!({"githubLinkTarget":true}), json!({"unknown":"value"})] {
            assert!(manager.update_review_preferences_at_path(invalid, &path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert_eq!(manager.review_preferences().unwrap(), readback);
        }
        assert!(manager.update_review_preferences_at_path(json!({"localReviewInstructions":"failed"}), &directory).is_err());
        assert_eq!(manager.review_preferences().unwrap(), readback);
        std::thread::scope(|scope| {
            scope.spawn(|| manager.update_review_preferences_at_path(json!({"localReviewInstructions":"parallel"}), &path).unwrap());
            scope.spawn(|| manager.update_review_preferences_at_path(json!({"githubLinkTarget":"code-review-tab"}), &path).unwrap());
        });
        let merged = manager.review_preferences().unwrap();
        assert_eq!(merged["localReviewInstructions"], "parallel");
        assert_eq!(merged["githubLinkTarget"], "code-review-tab");
        manager.update_review_preferences_at_path(json!({"localReviewInstructions":""}), &path).unwrap();
        assert_eq!(manager.review_preferences().unwrap()["localReviewInstructions"], "");
        manager.state_map.lock().unwrap().get_mut(PERSISTED_ATOM_STATE_KEY).unwrap().as_object_mut().unwrap()
            .insert("code-review-github-link-target".into(), json!("legacy-target"));
        let preserved = manager.update_review_preferences_at_path(json!({"localReviewInstructions":"  原样\n"}), &path).unwrap();
        assert_eq!(preserved["githubLinkTarget"], "legacy-target");
        assert_eq!(preserved["configuredGithubLinkTarget"], "legacy-target");
        let reopened: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(DesktopStateManager::read_review_preferences(reopened.as_object().unwrap()).unwrap(), preserved);
        assert_eq!(preserved["localReviewInstructions"], "  原样\n");
        fs::remove_file(path).unwrap(); fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn review_provider_preferences_persist_only_selected_atom_and_preserve_failed_writes() {
        let (manager, directory) = fixture(); let path=directory.join("providers.json");
        assert_eq!(manager.review_provider_preferences().unwrap(),json!({"gitHostingProvider":"github","githubConnection":null,"gitlabConnectorId":null}));
        manager.update_review_provider_preference_at_path("gitHostingProvider",&json!("gitlab"),&json!("github"),&path).unwrap();
        let connection=json!({"hostname":"github.example.test","connectorId":"connector","accountLinkId":"link"});
        let readback=manager.update_review_provider_preference_at_path("githubConnection",&connection,&Value::Null,&path).unwrap();
        assert_eq!(readback["gitHostingProvider"],"gitlab");assert_eq!(readback["githubConnection"],connection);
        let bytes=fs::read(&path).unwrap();let disk:Value=serde_json::from_slice(&bytes).unwrap();
        assert_eq!(disk["unrelated"],"keep");
        assert_eq!(disk[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:t"]["revision"],"r1");
        assert_eq!(DesktopStateManager::read_review_provider_preferences(disk.as_object().unwrap()).unwrap(),readback);
        for (field,value) in [("unknown",Value::Null),("gitHostingProvider",json!("other")),("githubConnection",json!({"hostname":"x"})),("gitlabConnectorId",json!(" "))] {
            assert!(manager.update_review_provider_preference_at_path(field,&value,&Value::Null,&path).is_err());
            assert_eq!(fs::read(&path).unwrap(),bytes);assert_eq!(manager.review_provider_preferences().unwrap(),readback);
        }
        assert!(manager.update_review_provider_preference_at_path("githubConnection",&Value::Null,&connection,&directory).is_err());
        assert_eq!(manager.review_provider_preferences().unwrap(),readback);
        assert!(manager.update_review_provider_preference_at_path("gitHostingProvider",&json!("github"),&json!("github"),&path).is_err());
        assert_eq!(fs::read(&path).unwrap(),bytes,"stale field expectation must not overwrite another window");
        let normalized=manager.update_review_provider_preference_at_path("gitlabConnectorId",&json!(" connector "),&Value::Null,&path).unwrap();
        assert_eq!(normalized["gitlabConnectorId"],"connector");
        manager.state_map.lock().unwrap().get_mut(PERSISTED_ATOM_STATE_KEY).unwrap().as_object_mut().unwrap().insert("code-review-git-hosting-provider".into(),json!("legacy-provider"));
        assert_eq!(manager.review_provider_preferences().unwrap()["gitHostingProvider"],"legacy-provider");
        assert_eq!(manager.update_review_provider_preference_at_path("githubConnection",&Value::Null,&connection,&path).unwrap()["gitHostingProvider"],"legacy-provider");
        fs::remove_file(path).unwrap();fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn worktree_root_persistence_validates_before_write_and_preserves_state_on_failure() {
        let (manager, directory) = fixture();
        let path = directory.join("state.json");
        let key = crate::git::WORKTREE_ROOT_KEY;
        let root = directory.join("trees").to_string_lossy().to_string();
        manager.set_value_persisted_at_path(key, json!(format!(" {} ", root)), &path).unwrap();
        assert_eq!(manager.get_value(key), json!(root));
        let bytes = fs::read(&path).unwrap();
        let saved: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(saved[key], json!(root));
        assert_eq!(saved["unrelated"], "keep");
        for invalid in [json!("relative"), json!(42), Value::Null] {
            assert!(manager.set_value_persisted_at_path(key, invalid, &path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert_eq!(manager.get_value(key), json!(root));
        }
        assert!(manager.set_value_persisted_at_path(key, json!(""), &directory).is_err());
        assert_eq!(manager.get_value(key), json!(root));
        manager.set_value_persisted_at_path(key, json!(""), &path).unwrap();
        assert_eq!(manager.get_value(key), json!(""));
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn inbox_persistence_roundtrip_preserves_other_keys_and_reports_disk_failure() {
        let (manager, directory) = fixture();
        let path = directory.join("inbox-state.json");
        manager.set_value_persisted_at_path("inboxItems", json!([{"id":"first"}]), &path).unwrap();
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk["inboxItems"], json!([{"id":"first"}]));
        assert_eq!(disk["unrelated"], "keep");

        let blocked_path = directory.join("blocked");
        fs::create_dir(&blocked_path).unwrap();
        assert!(manager.set_value_persisted_at_path("inboxItems", json!([{"id":"failed"}]), &blocked_path).is_err());
        assert_eq!(manager.get_value("inboxItems"), json!([{"id":"first"}]));
        let unchanged: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(unchanged["inboxItems"], json!([{"id":"first"}]));

        manager.set_value_persisted_at_path("inboxItems", json!([]), &path).unwrap();
        let cleared: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(cleared["inboxItems"], json!([]));
        assert_eq!(manager.get_value("inboxItems"), json!([]));
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&blocked_path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn thread_pin_persistence_preserves_other_chats_and_rejects_failed_write() {
        let (manager, directory) = fixture();
        let path = directory.join("pin-state.json");
        assert_eq!(manager.toggle_thread_pinned_at_path("first", true, &path).unwrap(), ["first"]);
        assert_eq!(manager.toggle_thread_pinned_at_path("second", true, &path).unwrap(), ["second", "first"]);
        assert!(manager.toggle_thread_pinned_at_path("first", false, &directory).is_err());
        assert_eq!(manager.list_pinned_threads(), ["second", "first"]);
        let persisted: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted[PINNED_THREAD_IDS_KEY], json!(["second", "first"]));
        assert_eq!(persisted["unrelated"], "keep");

        assert_eq!(manager.toggle_thread_pinned_at_path("first", false, &path).unwrap(), ["second"]);
        let persisted: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted[PINNED_THREAD_IDS_KEY], json!(["second"]));
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn project_pins_append_preserve_thread_pins_and_remove_both_project_ids() {
        let (manager, directory) = fixture();
        let path = directory.join("project-pin-state.json");
        manager.toggle_thread_pinned_at_path("chat", true, &path).unwrap();
        assert_eq!(manager.set_project_pinned_at_path("first", None, true, &path).unwrap(), ["first"]);
        assert_eq!(manager.set_project_pinned_at_path("second", Some("legacy-second"), true, &path).unwrap(), ["first", "legacy-second"]);
        assert_eq!(manager.set_project_pinned_at_path("second", Some("legacy-second"), true, &path).unwrap(), ["first", "legacy-second"]);
        assert!(manager.set_project_pinned_at_path("first", None, false, &directory).is_err());
        assert_eq!(manager.list_pinned_projects(), ["first", "legacy-second"]);
        manager.set_value_persisted_at_path(PINNED_PROJECT_IDS_KEY, json!(["first", "second", "legacy-second"]), &path).unwrap();
        assert_eq!(manager.set_project_pinned_at_path("second", Some("legacy-second"), false, &path).unwrap(), ["first"]);
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk[PINNED_THREAD_IDS_KEY], json!(["chat"]));
        assert_eq!(disk[PINNED_PROJECT_IDS_KEY], json!(["first"]));
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn archive_restores_original_pin_position_after_concurrent_unrelated_pin() {
        let (manager, directory) = fixture();
        let path = directory.join("archive-state.json");
        manager.set_value_persisted_at_path(PINNED_THREAD_IDS_KEY, json!(["first", "target", "last"]), &path).unwrap();
        let target = json!({"id":"target", "projectId":"project"});
        let archived = manager.finish_thread_archive_at_path(target.clone(), true, None, &path);
        assert_eq!(archived["pinnedThreadIds"], json!(["first", "last"]));
        assert_eq!(archived["pinPlacement"], json!({"beforeThreadId":"last"}));
        assert_eq!(manager.list_archived_threads(), vec![target.clone()]);
        manager.toggle_thread_pinned_at_path("new", true, &path).unwrap();
        let restored = manager.finish_thread_archive_at_path(target.clone(), false,
            Some(ArchivePinPlacement { before_thread_id: Some("last".into()) }), &path);
        assert_eq!(restored["pinnedThreadIds"], json!(["new", "first", "target", "last"]));
        assert!(manager.list_archived_threads().is_empty());
        let failed = manager.finish_thread_archive_at_path(target, true, None, &directory);
        assert_eq!(failed["localStateError"], true);
        assert!(failed["pinPlacement"].is_null());
        assert_eq!(manager.list_pinned_threads(), ["new", "first", "target", "last"]);
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk[PINNED_THREAD_IDS_KEY], json!(["new", "first", "target", "last"]));
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    fn fixture() -> (DesktopStateManager, PathBuf) {
        let map = json!({
            "unrelated":"keep",
            "electron-persisted-atom-state":{
                "thread-workspace-state-v1:t":{
                    "revision":"r1","project":{"projectKind":"local","projectId":"p"},
                    "applied":{"cwd":"D:/old","projectSources":["D:/old"],"runtimeWorkspaceRoots":["D:/old"]},
                    "pending":{"cwd":"D:/new","projectSources":["D:/new"],"runtimeWorkspaceRoots":["D:/new"]}
                }
            },
            "thread-writable-roots":{"t":["D:/old","D:/extra"],"other":["D:/other"]}
        });
        let manager = DesktopStateManager {
            state_map: Arc::new(Mutex::new(map.as_object().unwrap().clone())),
            workspace_turn_owners: Arc::new(Mutex::new(HashMap::new())),
        };
        let directory = std::env::temp_dir().join(format!(
            "codex-workspace-transition-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        (manager, directory)
    }

    fn params() -> Value {
        json!({"threadId":"t","cwd":"D:/active","environments":[],"sandboxPolicy":{"type":"workspaceWrite","networkAccess":false}})
    }

    #[tokio::test]
    async fn workspace_recovery_resumes_cold_thread_before_turn_and_uses_applied() {
        let (manager, directory) = fixture();
        manager
            .state_map
            .lock()
            .unwrap()
            .get_mut(PERSISTED_ATOM_STATE_KEY)
            .unwrap()["thread-workspace-state-v1:t"]["pending"] = Value::Null;
        let mut methods = Vec::new();
        manager.call_turn_with_workspace_at_path(
            json!({"threadId":"t","sandboxPolicy":{"type":"workspaceWrite","networkAccess":false}}),
            &directory.join("state.json"),
            |method, request| {
                methods.push(method.clone());
                let result = match method.as_str() {
                    "thread/read" => json!({"thread":{"status":{"type":"notLoaded"},"environments":null}}),
                    "thread/resume" => {
                        assert_eq!(request, json!({"threadId":"t"}), "unknown host must not receive local overrides");
                        json!({"thread":{"status":{"type":"idle"},"cwd":"D:/stale",
                            "environments":[{"environmentId":"local","cwd":"D:/stale","runtimeWorkspaceRoots":["D:/stale"]}]}})
                    },
                    "turn/start" => {
                        assert_eq!(request["environments"][0]["cwd"], "D:/old");
                        assert_eq!(request["environments"][0]["runtimeWorkspaceRoots"], json!(["D:/old"]));
                        assert_eq!(request["cwd"], Value::Null);
                        assert!(!request["sandboxPolicy"]["writableRoots"].as_array().unwrap().contains(&json!("D:/stale")));
                        json!({"turn":{"id":"accepted"}})
                    },
                    _ => panic!("unexpected method"),
                };
                std::future::ready(Ok(result))
            },
        ).await.unwrap();
        assert_eq!(methods, ["thread/read", "thread/resume", "turn/start"]);
        assert!(
            !directory.join("state.json").exists(),
            "plain recovery must not commit a transition"
        );
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_recovery_resume_failure_or_unknown_environment_never_dispatches() {
        for response in [
            Err("resume unavailable".to_string()),
            Ok(json!({"thread":{"status":{"type":"notLoaded"},"environments":[]}})),
            Ok(json!({"thread":{"status":{"type":"idle"},"environments":null}})),
        ] {
            let (manager, directory) = fixture();
            let before = manager.state_map.lock().unwrap().clone();
            let mut methods = Vec::new();
            let result = manager.call_turn_with_workspace_at_path(params(), &directory.join("state.json"), |method, _| {
                methods.push(method.clone());
                std::future::ready(if method == "thread/read" {
                    Ok(json!({"thread":{"status":{"type":"notLoaded"},"environments":null}}))
                } else {
                    assert_eq!(method, "thread/resume");
                    response.clone()
                })
            }).await;
            assert!(result.is_err());
            assert_eq!(methods, ["thread/read", "thread/resume"]);
            assert_eq!(*manager.state_map.lock().unwrap(), before);
            assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
            assert!(!directory.join("state.json").exists());
            fs::remove_dir(&directory).unwrap();
        }
    }

    #[tokio::test]
    async fn workspace_recovery_cold_remote_preserves_request_and_local_pending() {
        let (manager, directory) = fixture();
        let before = manager.state_map.lock().unwrap().clone();
        let original = json!({"threadId":"t","input":[]});
        let mut methods = Vec::new();
        manager
            .call_turn_with_workspace_at_path(
                original.clone(),
                &directory.join("state.json"),
                |method, request| {
                    methods.push(method.clone());
                    let result = match method.as_str() {
                        "thread/read" => {
                            json!({"thread":{"status":{"type":"notLoaded"},"environments":null}})
                        }
                        "thread/resume" => {
                            assert_eq!(request, json!({"threadId":"t"}));
                            json!({"thread":{"status":{"type":"idle"},"cwd":"/remote",
                        "environments":[{"environmentId":"remote","cwd":"/remote"}]},
                        "sandbox":{"type":"readOnly"}})
                        }
                        "turn/start" => {
                            assert_eq!(request, original);
                            json!({"turn":{"id":"remote-accepted"}})
                        }
                        _ => panic!("unexpected method"),
                    };
                    std::future::ready(Ok(result))
                },
            )
            .await
            .unwrap();
        assert_eq!(methods, ["thread/read", "thread/resume", "turn/start"]);
        assert_eq!(*manager.state_map.lock().unwrap(), before);
        assert!(!directory.join("state.json").exists());
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_recovery_superseded_resume_never_dispatches_old_turn() {
        let (manager, directory) = fixture();
        let file = directory.join("state.json");
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let old_manager = manager.clone();
        let old_file = file.clone();
        let old = tokio::spawn(async move {
            let mut channels = Some((ready_tx, release_rx));
            old_manager.call_turn_with_workspace_at_path(params(), &old_file, |method, _| {
                let channels = if method == "thread/resume" { channels.take() } else { None };
                async move {
                    if method == "thread/read" {
                        return Ok(json!({"thread":{"status":{"type":"notLoaded"},"environments":null}}));
                    }
                    assert_eq!(method, "thread/resume", "superseded recovery must never dispatch");
                    let (ready_tx, release_rx) = channels.unwrap();
                    ready_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Ok(json!({"thread":{"status":{"type":"idle"},"environments":[]}}))
                }
            }).await
        });
        ready_rx.await.unwrap();
        manager
            .call_turn_with_workspace_at_path(params(), &file, |method, _| async move {
                if method == "thread/read" {
                    return Ok(json!({"thread":{"status":{"type":"idle"},"environments":[]}}));
                }
                assert_eq!(method, "turn/start", "loaded thread must not resume");
                Ok(json!({"turn":{"id":"latest"}}))
            })
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        assert!(old.await.unwrap().is_err());
        assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_accepts_before_commit_and_survives_reload() {
        let (manager, directory) = fixture();
        let file = directory.join("state.json");
        let (result, warning) = manager
            .call_turn_with_workspace_at_path(params(), &file, |method, request| {
                if method == "thread/read" {
                    return std::future::ready(Ok(json!({"thread":{"environments":[]}})));
                }
                assert_eq!(method, "turn/start");
                assert_eq!(request["cwd"], "D:/new");
                assert_eq!(
                    request["sandboxPolicy"]["writableRoots"],
                    json!(["D:/extra", "D:/new"])
                );
                assert!(
                    !file.exists(),
                    "nothing is committed before the RPC accepts"
                );
                std::future::ready(Ok(json!({"turn":{"id":"accepted","status":"inProgress"}})))
            })
            .await
            .unwrap();
        assert!(warning.is_none());
        assert_eq!(
            result["turn"]["status"], "inProgress",
            "do not wait for turn completion"
        );
        let reloaded: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        let state = &reloaded[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:t"];
        assert_eq!(state["pending"], Value::Null);
        assert_eq!(state["applied"]["cwd"], "D:/new");
        assert_eq!(
            reloaded["thread-writable-roots"]["other"],
            json!(["D:/other"])
        );
        assert_eq!(reloaded["unrelated"], "keep");
        assert_eq!(
            *manager.state_map.lock().unwrap(),
            *reloaded.as_object().unwrap()
        );
        assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_rejection_and_unknown_acceptance_preserve_pending() {
        let (manager, directory) = fixture();
        let before = manager.state_map.lock().unwrap().clone();
        let file = directory.join("state.json");
        for message in ["rejected", "timeout: outcome unknown", "cancelled"] {
            let error = manager
                .call_turn_with_workspace_at_path(params(), &file, |method, _| async move {
                    if method == "thread/read" {
                        return Ok(json!({"thread":{"environments":[]}}));
                    }
                    Err(message.to_owned())
                })
                .await
                .unwrap_err();
            assert_eq!(error, message);
            assert_eq!(*manager.state_map.lock().unwrap(), before);
            assert!(!file.exists());
        }
        let (result, warning) = manager
            .call_turn_with_workspace_at_path(params(), &file, |method, _| async move {
                if method == "thread/read" {
                    return Ok(json!({"thread":{"environments":[]}}));
                }
                Ok(json!({"unexpected":"no acceptance ID"}))
            })
            .await
            .unwrap();
        assert_eq!(result["unexpected"], "no acceptance ID");
        assert!(warning.is_some());
        assert_eq!(*manager.state_map.lock().unwrap(), before);
        assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_save_failure_returns_accepted_turn_without_publishing_state() {
        let (manager, directory) = fixture();
        let before = manager.state_map.lock().unwrap().clone();
        // Replacing a directory as a file fails on both Windows and Unix.
        let (result, warning) = manager
            .call_turn_with_workspace_at_path(params(), &directory, |method, _| async move {
                if method == "thread/read" {
                    return Ok(json!({"thread":{"environments":[]}}));
                }
                Ok(json!({"turn":{"id":"already-accepted"}}))
            })
            .await
            .unwrap();
        assert_eq!(result["turn"]["id"], "already-accepted");
        assert!(warning.unwrap().contains("请勿重复发送"));
        assert_eq!(*manager.state_map.lock().unwrap(), before);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_new_revision_retains_pending_but_records_accepted_workspace() {
        let (manager, directory) = fixture();
        let file = directory.join("state.json");
        manager
            .call_turn_with_workspace_at_path(params(), &file, |method, _| {
                if method == "thread/read" {
                    return std::future::ready(Ok(json!({"thread":{"environments":[]}})));
                }
                let mut map = manager.state_map.lock().unwrap();
                let current = &mut map.get_mut(PERSISTED_ATOM_STATE_KEY).unwrap()
                    ["thread-workspace-state-v1:t"];
                current["revision"] = json!("r2");
                current["pending"]["cwd"] = json!("D:/next");
                current["pending"]["runtimeWorkspaceRoots"] = json!(["D:/next"]);
                current["projectMembership"] = json!({"projectKind":"local","projectId":"p-next"});
                std::future::ready(Ok(json!({"turn":{"id":"accepted-r1"}})))
            })
            .await
            .unwrap();
        let reloaded: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        let current = &reloaded[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:t"];
        assert_eq!(current["applied"]["cwd"], "D:/new");
        assert_eq!(current["pending"]["cwd"], "D:/next");
        assert_eq!(current["revision"], "r2");
        assert_eq!(current["projectMembership"]["projectId"], "p-next");
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_late_old_response_cannot_overwrite_newer_accepted_turn() {
        let (manager, directory) = fixture();
        let file = directory.join("state.json");
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let old_manager = manager.clone();
        let old_file = file.clone();
        let old = tokio::spawn(async move {
            let mut channels = Some((ready_tx, release_rx));
            old_manager
                .call_turn_with_workspace_at_path(params(), &old_file, |method, _| {
                    let channels = if method == "turn/start" {
                        channels.take()
                    } else {
                        None
                    };
                    async move {
                        let Some((ready_tx, release_rx)) = channels else {
                            return Ok(json!({"thread":{"environments":[]}}));
                        };
                        ready_tx.send(()).unwrap();
                        release_rx.await.unwrap();
                        Ok(json!({"turn":{"id":"old-accepted"}}))
                    }
                })
                .await
        });
        ready_rx.await.unwrap();
        {
            let mut map = manager.state_map.lock().unwrap();
            let current =
                &mut map.get_mut(PERSISTED_ATOM_STATE_KEY).unwrap()["thread-workspace-state-v1:t"];
            current["revision"] = json!("r2");
            current["pending"]["cwd"] = json!("D:/latest");
            current["pending"]["runtimeWorkspaceRoots"] = json!(["D:/latest"]);
        }
        manager
            .call_turn_with_workspace_at_path(params(), &file, |method, _| async move {
                if method == "thread/read" {
                    return Ok(json!({"thread":{"environments":[]}}));
                }
                Ok(json!({"turn":{"id":"new-accepted"}}))
            })
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        assert_eq!(old.await.unwrap().unwrap().0["turn"]["id"], "old-accepted");
        let reloaded: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        let current = &reloaded[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:t"];
        assert_eq!(current["applied"]["cwd"], "D:/latest");
        assert_eq!(current["pending"], Value::Null);
        assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_omitted_environments_respect_sticky_remote_selection() {
        let (manager, directory) = fixture();
        let file = directory.join("state.json");
        let before = manager.state_map.lock().unwrap().clone();
        let mut original = params();
        original.as_object_mut().unwrap().remove("environments");
        let mut methods = Vec::new();
        manager
            .call_turn_with_workspace_at_path(original.clone(), &file, |method, request| {
                methods.push(method.clone());
                let result = if method == "thread/read" {
                    assert_eq!(request, json!({"threadId":"t","includeTurns":false}));
                    json!({"thread":{"environments":[{"environmentId":"remote","cwd":"/remote"}]}})
                } else {
                    assert_eq!(
                        request, original,
                        "do not reset sticky environments or inject local cwd"
                    );
                    json!({"turn":{"id":"remote-accepted"}})
                };
                std::future::ready(Ok(result))
            })
            .await
            .unwrap();
        assert_eq!(methods, ["thread/read", "turn/start"]);
        assert_eq!(*manager.state_map.lock().unwrap(), before);
        assert!(
            !file.exists(),
            "local pending is not committed by a remote turn"
        );
        fs::remove_dir(&directory).unwrap();
    }

    #[tokio::test]
    async fn workspace_transition_unknown_effective_environment_blocks_before_dispatch() {
        for read_result in [
            Ok(json!({"thread":{"environments":null}})),
            Ok(json!({"thread":{}})),
            Err("thread/read unavailable".to_owned()),
        ] {
            let (manager, directory) = fixture();
            let before = manager.state_map.lock().unwrap().clone();
            let mut original = params();
            original.as_object_mut().unwrap().remove("environments");
            let mut methods = Vec::new();
            let result = manager
                .call_turn_with_workspace_at_path(
                    original,
                    &directory.join("state.json"),
                    |method, _| {
                        methods.push(method);
                        std::future::ready(read_result.clone())
                    },
                )
                .await;
            assert!(result.is_err());
            let expected = if read_result.is_ok() {
                vec!["thread/read", "thread/resume"]
            } else {
                vec!["thread/read"]
            };
            assert_eq!(
                methods, expected,
                "unknown environment must never dispatch the turn"
            );
            assert_eq!(*manager.state_map.lock().unwrap(), before);
            assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
            fs::remove_dir(&directory).unwrap();
        }
    }

    #[tokio::test]
    async fn workspace_transition_resolved_local_selection_is_used_in_target_request() {
        for environments in [
            json!([]),
            json!([{"environmentId":"local","cwd":"D:/old","keep":true}]),
        ] {
            let (manager, directory) = fixture();
            let file = directory.join("state.json");
            let mut original = params();
            original.as_object_mut().unwrap().remove("environments");
            manager
                .call_turn_with_workspace_at_path(original, &file, |method, request| {
                    let result = if method == "thread/read" {
                        json!({"thread":{"environments":environments}})
                    } else {
                        if environments.as_array().unwrap().is_empty() {
                            assert_eq!(request["cwd"], "D:/new");
                            assert!(
                                request.get("environments").is_none(),
                                "do not change sticky selection"
                            );
                        } else {
                            assert_eq!(request["cwd"], Value::Null);
                            assert_eq!(request["environments"][0]["cwd"], "D:/new");
                            assert_eq!(request["environments"][0]["keep"], true);
                        }
                        json!({"turn":{"id":"local-accepted"}})
                    };
                    std::future::ready(Ok(result))
                })
                .await
                .unwrap();
            assert_eq!(
                manager.get_value(PERSISTED_ATOM_STATE_KEY)["thread-workspace-state-v1:t"]
                    ["pending"],
                Value::Null
            );
            fs::remove_file(&file).unwrap();
            fs::remove_dir(&directory).unwrap();
        }
    }

    #[tokio::test]
    async fn workspace_transition_superseded_environment_read_does_not_dispatch_old_turn() {
        let (manager, directory) = fixture();
        let file = directory.join("state.json");
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let old_manager = manager.clone();
        let old_file = file.clone();
        let old = tokio::spawn(async move {
            let mut original = params();
            original.as_object_mut().unwrap().remove("environments");
            let mut channels = Some((ready_tx, release_rx));
            old_manager
                .call_turn_with_workspace_at_path(original, &old_file, |method, _| {
                    assert_eq!(
                        method, "thread/read",
                        "a superseded preflight must not start a stale turn"
                    );
                    let (ready_tx, release_rx) = channels.take().unwrap();
                    async move {
                        ready_tx.send(()).unwrap();
                        release_rx.await.unwrap();
                        Ok(json!({"thread":{"environments":[]}}))
                    }
                })
                .await
        });
        ready_rx.await.unwrap();
        manager
            .call_turn_with_workspace_at_path(params(), &file, |method, _| async move {
                if method == "thread/read" {
                    return Ok(json!({"thread":{"environments":[]}}));
                }
                Ok(json!({"turn":{"id":"new-accepted"}}))
            })
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        assert!(old.await.unwrap().is_err());
        assert_eq!(
            manager.get_value(PERSISTED_ATOM_STATE_KEY)["thread-workspace-state-v1:t"]["applied"]
                ["cwd"],
            "D:/new"
        );
        assert!(manager.workspace_turn_owners.lock().unwrap().is_empty());
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
}

impl DesktopStateManager {
    pub fn new() -> Self {
        let mut initial = Map::new();
        let state_path = desktop_global_state_path();
        if let Ok(raw) = fs::read_to_string(&state_path) {
            if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) {
                initial = obj;
            }
        }
        Self {
            state_map: Arc::new(Mutex::new(initial)),
            workspace_turn_owners: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn save_locked(map: &Map<String, Value>) {
        let state_path = desktop_global_state_path();
        if let Some(parent) = state_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(serialized) = serde_json::to_string_pretty(&Value::Object(map.clone())) {
            let _ = fs::write(&state_path, serialized);
        }
    }

    pub(crate) async fn call_turn_with_workspace<F, R>(
        &self,
        params: Value,
        send: F,
    ) -> Result<(Value, Option<String>), String>
    where
        F: FnMut(String, Value) -> R,
        R: std::future::Future<Output = Result<Value, String>>,
    {
        self.call_turn_with_workspace_at_path(params, &desktop_global_state_path(), send)
            .await
    }

    async fn call_turn_with_workspace_at_path<F, R>(
        &self,
        params: Value,
        state_path: &Path,
        mut send: F,
    ) -> Result<(Value, Option<String>), String>
    where
        F: FnMut(String, Value) -> R,
        R: std::future::Future<Output = Result<Value, String>>,
    {
        let thread_id = params["threadId"].as_str().unwrap_or_default().to_owned();
        if self.state_map.lock().unwrap()
            .get("thread-project-move-recovery")
            .and_then(Value::as_object)
            .is_some_and(|recovery| recovery.contains_key(&thread_id))
        {
            return Err("会话项目移动结果尚待确认，请先恢复项目状态；本次没有发送。".into());
        }
        let key = format!("thread-workspace-state-v1:{thread_id}");
        let token = uuid::Uuid::new_v4().to_string();
        let (workspace, retained) = {
            let mut owners = self.workspace_turn_owners.lock().unwrap();
            if owners.get(&thread_id).is_some_and(|owner| owner.starts_with("move:")) {
                return Err("会话正在移动到其他项目，请稍后重试；本次没有发送。".into());
            }
            let guard = self.state_map.lock().unwrap();
            let atoms = guard.get(PERSISTED_ATOM_STATE_KEY).unwrap_or(&Value::Null);
            let retained = &guard.get("thread-writable-roots").unwrap_or(&Value::Null)[&thread_id];
            owners.insert(thread_id.clone(), token.clone());
            (atoms[&key].clone(), retained.clone())
        };
        let sent = async {
            let mut current = send(
                "thread/read".into(),
                json!({"threadId":thread_id,"includeTurns":false}),
            )
            .await?;
            if self.workspace_turn_owners.lock().unwrap().get(&thread_id) != Some(&token) {
                return Err("本次尚未发送的请求已被更新的发送操作替代。".into());
            }
            let resumed = current["thread"]["status"]["type"] == "notLoaded"
                || current["thread"]["environments"].is_null();
            if resumed {
                current = send("thread/resume".into(), json!({"threadId":thread_id})).await?;
            }
            if self.workspace_turn_owners.lock().unwrap().get(&thread_id) != Some(&token) {
                return Err("本次尚未发送的请求已被更新的发送操作替代。".into());
            }
            if current["thread"]["status"]["type"] == "notLoaded"
                || !current["thread"]["environments"].is_array()
            {
                return Err("会话执行环境尚未恢复，输入和工作区状态已保留，本次没有发送。".into());
            }
            let prepared = crate::thread_workspace::prepare_runtime_turn(
                &workspace, &retained, params, &current, resumed,
            )?;
            if self.workspace_turn_owners.lock().unwrap().get(&thread_id) != Some(&token) {
                return Err("本次尚未发送的请求已被更新的发送操作替代。".into());
            }
            let result = send("turn/start".into(), prepared.params).await?;
            Ok::<_, String>((result, prepared.commit))
        }
        .await;
        // Ownership is checked even when this request has no pending workspace:
        // a newer remote/plain send must also supersede an older local send.
        let mut owners = self.workspace_turn_owners.lock().unwrap();
        let current = owners.get(&thread_id) == Some(&token);
        if current {
            owners.remove(&thread_id);
        }
        let (result, commit) = sent?;
        if !current || commit.is_none() {
            return Ok((result, None));
        }
        if result["turn"]["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .is_none()
        {
            return Ok((
                result,
                Some("服务未返回已接受轮次的 ID，待迁移工作区已保留，请勿自动重发。".into()),
            ));
        }
        let commit = commit.unwrap();
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        let Some(workspace) = next
            .get_mut(PERSISTED_ATOM_STATE_KEY)
            .and_then(Value::as_object_mut)
            .and_then(|atoms| atoms.get_mut(&key))
            .filter(|state| state.is_object())
        else {
            return Ok((result, None));
        };
        crate::thread_workspace::apply_accepted(workspace, &commit);
        let retained = next
            .entry("thread-writable-roots")
            .or_insert_with(|| json!({}));
        if !retained.is_object() {
            return Ok((
                result,
                Some("轮次已开始，但保留目录状态无效，工作区迁移尚未保存。".into()),
            ));
        }
        retained[&thread_id] = json!(commit.writable_roots);
        // Write a sibling file and replace only after the complete state is on disk.
        // A failed save must neither clear pending in memory nor report send failure.
        let persist = || -> Result<(), String> {
            if let Some(parent) = state_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let temporary = state_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
            let bytes = serde_json::to_vec_pretty(&next).map_err(|error| error.to_string())?;
            let saved =
                fs::write(&temporary, bytes).and_then(|_| fs::rename(&temporary, state_path));
            if saved.is_err() {
                let _ = fs::remove_file(&temporary);
            }
            saved.map_err(|error| error.to_string())
        };
        if let Err(error) = persist() {
            return Ok((
                result,
                Some(format!(
                    "轮次已开始，但工作区迁移保存失败；待迁移状态已保留，请勿重复发送：{error}"
                )),
            ));
        }
        *guard = next;
        Ok((result, None))
    }

    pub fn get_value(&self, key: &str) -> Value {
        let guard = self.state_map.lock().unwrap();
        guard.get(key).cloned().unwrap_or(Value::Null)
    }

    pub(crate) fn get_optional_value(&self, key: &str) -> Option<Value> {
        self.state_map.lock().unwrap().get(key).cloned()
    }

    #[cfg(test)]
    pub(crate) fn fixture_for_appshots_preferences(values: Map<String, Value>) -> Self {
        Self {
            state_map: Arc::new(Mutex::new(values)),
            workspace_turn_owners: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    pub(crate) fn update_appshots_fixture<F>(&self, key: &str, update: F, path: &Path) -> Result<Value, String>
    where F: FnOnce(Value) -> Result<Value, String> {
        self.update_value_persisted_at_path(key, update, path)
    }

    pub fn sidebar_project_membership(&self) -> Value {
        read_sidebar_project_membership(&self.state_map.lock().unwrap())
    }

    pub(crate) async fn register_created_project<F, R>(&self, project_id: &str, read: F) -> Result<Value, String>
    where F: FnMut(String, Value) -> R, R: std::future::Future<Output = Result<Value, String>> {
        self.register_created_project_at_path(project_id, &desktop_global_state_path(), read).await
    }

    async fn register_created_project_at_path<F, R>(&self, project_id: &str, state_path: &Path, mut read: F) -> Result<Value, String>
    where F: FnMut(String, Value) -> R, R: std::future::Future<Output = Result<Value, String>> {
        if project_id.trim().is_empty() || project_id.trim() != project_id || project_id.len() > 2048 || project_id.chars().any(char::is_control) {
            return Err("新建项目 ID 无效，未修改本地项目。".into());
        }
        let identity = format!("local:{}", codex_home_dir().to_string_lossy());
        let response = read("project/read".into(), json!({"projectId":project_id})).await?;
        let project = response.get("project").and_then(Value::as_object).ok_or("服务未返回新建项目。")?;
        if project.get("id").and_then(Value::as_str) != Some(project_id) {return Err("服务返回的项目身份不一致。".into());}
        let name = project.get("name").and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty() && !name.chars().any(char::is_control)).ok_or("服务返回的项目名称无效。")?;
        let roots = project.get("roots").and_then(Value::as_array).ok_or("服务未返回项目源目录。")?
            .iter().map(|root| root.get("path").and_then(Value::as_str).map(str::to_owned))
            .collect::<Option<Vec<String>>>().ok_or("服务返回的项目源目录无效。")?;
        crate::thread_workspace::project_target(&roots, None)?;
        let mut normalized = Vec::<String>::new();
        for root in &roots {
            if root.trim() != root || root.chars().any(char::is_control) || !Path::new(root).is_absolute() || !Path::new(root).is_dir() {
                return Err("项目源目录必须是当前主机已存在的绝对目录。".into());
            }
            let path = normalize_fs_path(root);
            if normalized.iter().any(|existing| existing.eq_ignore_ascii_case(&path)) {return Err("项目源目录重复，未修改本地项目。".into());}
            normalized.push(path);
        }
        if identity != format!("local:{}", codex_home_dir().to_string_lossy()) {return Err("项目注册期间 CODEX_HOME 已变化，请重试。".into());}
        let object = |value: Option<&Value>, label: &str| -> Result<Map<String, Value>, String> {
            match value {None | Some(Value::Null) => Ok(Map::new()), Some(Value::Object(value)) => Ok(value.clone()), _ => Err(format!("{label}存储格式无效，未修改项目。"))}
        };
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        let mapping_key = "app-server-project-id-by-legacy-project-id-by-host";
        let mut mappings = object(next.get(mapping_key), "项目身份映射")?;
        let mut host_mappings = object(mappings.get(&identity), "当前主机项目身份映射")?;
        let existing_ids = host_mappings.iter().filter(|(_, value)| value.as_str() == Some(project_id)).map(|(id, _)| id.clone()).collect::<Vec<_>>();
        if existing_ids.len() > 1 {return Err("同一服务项目存在多个本地身份，无法安全选择。".into());}
        let legacy_id = existing_ids.first().cloned().unwrap_or_else(||format!("server:{project_id}"));
        if legacy_id.trim().is_empty() || legacy_id.trim() != legacy_id || legacy_id.chars().any(char::is_control) {
            return Err("已有项目身份无效，未修改本地项目。".into());
        }
        if host_mappings.get(&legacy_id).is_some_and(|value| value.as_str() != Some(project_id)) {
            return Err("新建项目的本地身份已被其他服务项目占用。".into());
        }
        let mut atoms = object(next.get(PERSISTED_ATOM_STATE_KEY), "项目原子状态")?;
        let mut projects = object(atoms.get(LOCAL_PROJECTS_ATOM_KEY), "本地项目")?;
        let mut registered = match projects.get(&legacy_id) {
            None => Map::new(),
            Some(Value::Object(existing)) if !existing_ids.is_empty() && existing.get("id").and_then(Value::as_str) == Some(legacy_id.as_str()) => existing.clone(),
            _ => return Err("本地项目身份冲突，未覆盖已有项目。".into()),
        };
        let created_at = registered.get("createdAt").filter(|value| value.is_number()).cloned()
            .or_else(||project.get("createdAt").filter(|value| value.is_number()).cloned())
            .unwrap_or_else(||json!(std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64));
        registered.insert("id".into(), json!(legacy_id)); registered.insert("name".into(), json!(name));
        registered.insert("rootPaths".into(), json!(normalized)); registered.insert("createdAt".into(), created_at);
        projects.insert(legacy_id.clone(), Value::Object(registered));
        let mut order = match atoms.get(PROJECT_ORDER_ATOM_KEY) {
            None | Some(Value::Null) => Vec::new(), Some(Value::Array(order)) => order.clone(), _ => return Err("项目顺序存储格式无效。".into()),
        };
        if !order.iter().any(|value| value.as_str() == Some(legacy_id.as_str())) {order.insert(0, json!(legacy_id));}
        atoms.insert(LOCAL_PROJECTS_ATOM_KEY.into(), Value::Object(projects));
        atoms.insert(PROJECT_ORDER_ATOM_KEY.into(), json!(order));
        atoms.insert(SELECTED_PROJECT_ATOM_KEY.into(), json!({"type":"local","projectId":legacy_id}));
        host_mappings.insert(legacy_id, json!(project_id)); mappings.insert(identity, Value::Object(host_mappings));
        next.insert(mapping_key.into(), Value::Object(mappings)); next.insert(PERSISTED_ATOM_STATE_KEY.into(), Value::Object(atoms));
        let mut saved_roots = match next.get(DESKTOP_PROJECT_ROOTS_KEY) {
            None | Some(Value::Null) => Vec::new(), Some(Value::Array(roots)) => roots.clone(), _ => return Err("工作区目录存储格式无效。".into()),
        };
        if !saved_roots.iter().any(|value| value.as_str().is_some_and(|path| normalize_fs_path(path).eq_ignore_ascii_case(&normalized[0]))) {
            saved_roots.insert(0, json!(normalized[0]));
        }
        next.insert(DESKTOP_PROJECT_ROOTS_KEY.into(), json!(saved_roots));
        next.insert(ACTIVE_WORKSPACE_ROOTS_KEY.into(), json!([normalized[0]]));
        let result = json!({"workspaces":Self::workspace_roots_in_state(&next),"projectMembership":read_sidebar_project_membership(&next)});
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(result)
    }

    /// Builds the read-only portion of a project move.
    ///
    /// This deliberately does not write local atoms or call app-server.  A
    /// caller must use the returned plan to obtain confirmation and then
    /// perform a fresh live `thread/read`/`project/read` before implementing a
    /// commit transaction.  Keeping this boundary explicit prevents a stale
    /// UI plan from changing membership or workspace state.
    #[cfg(test)]
    fn prepare_thread_project_move(
        &self,
        thread_id: &str,
        target_project_id: Option<&str>,
    ) -> Result<Value, String> {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return Err("缺少会话 ID，无法准备项目移动。".to_string());
        }
        let guard = self.state_map.lock().unwrap();
        prepare_thread_project_move_in_state(&guard, thread_id, target_project_id)
    }

    pub(crate) async fn prepare_thread_project_move_with_rpc<F, R>(
        &self, thread_id: &str, target_project_id: Option<&str>, mut read: F,
    ) -> Result<Value, String>
    where
        F: FnMut(String, Value) -> R,
        R: std::future::Future<Output = Result<Value, String>>,
    {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return Err("缺少会话 ID，无法准备项目移动。".to_string());
        }
        let original = self.state_map.lock().unwrap().clone();
        let current = read("thread/read".to_string(), json!({
            "threadId": thread_id, "includeTurns": false,
        })).await?;
        let mut thread = current["thread"].clone();
        if thread["id"].as_str() != Some(thread_id) {
            return Err("服务返回的会话身份不匹配，无法准备项目移动。".to_string());
        }
        if thread["status"]["type"].as_str() == Some("notLoaded") {
            let resumed = read("thread/resume".to_string(), json!({"threadId":thread_id})).await?;
            thread = resumed["thread"].clone();
            if thread["id"].as_str() != Some(thread_id) {
                return Err("恢复后的会话身份不匹配，无法准备项目移动。".to_string());
            }
        }
        if thread["status"]["type"].as_str() != Some("idle") {
            return Err("会话尚未恢复或正在执行，无法准备项目移动。".to_string());
        }
        let environments = thread["environments"].as_array()
            .ok_or("无法确认会话的执行环境，不能准备项目移动。")?;
        if environments.iter().any(|environment| environment["environmentId"] != "local") {
            return Err("当前会话包含远程执行环境，不能使用本地项目移动。".to_string());
        }
        let assignment = match thread.get("projectId") {
            Some(Value::Null) => None,
            Some(Value::String(id)) if !id.is_empty() => Some(json!({
                "projectKind": "local", "projectId": id,
            })),
            _ => return Err("服务未返回明确的项目归属，无法准备项目移动。".to_string()),
        };
        let mut plan = prepare_thread_project_move_for_assignment(
            &original, thread_id, target_project_id, assignment,
        )?;
        let mut validated = Vec::<String>::new();
        for field in ["sourceProject", "targetProject"] {
            let project = &plan[field];
            let Some(server_id) = project["serverProjectId"].as_str().map(str::to_owned) else { continue };
            if validated.contains(&server_id) { continue; }
            let response = read("project/read".to_string(), json!({"projectId":server_id})).await?;
            let live = &response["project"];
            let roots = live["roots"].as_array()
                .ok_or("服务未返回项目文件夹，无法准备项目移动。")?
                .iter().map(|root| root["path"].as_str().map(str::to_owned))
                .collect::<Option<Vec<String>>>()
                .ok_or("服务返回了无效的项目文件夹。")?;
            if live["id"].as_str() != Some(&server_id)
                || json!(roots) != project["rootPaths"] {
                return Err("项目身份或文件夹与本地实体不一致，请刷新项目后重试。".to_string());
            }
            // Validate all source paths as well as the target before claiming
            // that the live project sources can be used by a later commit.
            crate::thread_workspace::project_target(&roots, None)?;
            validated.push(server_id);
        }
        let cwd = thread["cwd"].as_str().filter(|cwd| !cwd.is_empty())
            .ok_or("会话缺少工作目录，无法准备项目移动。")?;
        let source_roots: Vec<String> = plan["sourceProject"]["rootPaths"].as_array()
            .map(|roots| roots.iter().filter_map(Value::as_str).map(str::to_owned).collect())
            .unwrap_or_default();
        let mut runtime_roots = environments.first()
            .and_then(|environment| environment.get("runtimeWorkspaceRoots"))
            .filter(|roots| roots.is_array())
            .or_else(|| current.get("runtimeWorkspaceRoots").filter(|roots| roots.is_array()))
            .cloned();
        if runtime_roots.is_none() {
            let root = if source_roots.len() == 1
                && crate::thread_workspace::missing_project_sources(&[cwd.to_owned()], &source_roots).is_empty() {
                source_roots[0].clone()
            } else { cwd.to_owned() };
            runtime_roots = Some(json!([root]));
        }
        plan["appliedFallback"] = json!({
            "cwd":cwd,"projectSources":source_roots,"runtimeWorkspaceRoots":runtime_roots,
        });
        if let Some(target_root) = plan["targetProject"]["rootPaths"][0].as_str() {
            let managed_roots = crate::git::managed_worktree_roots(
                original.get(crate::git::WORKTREE_ROOT_KEY).unwrap_or(&Value::Null),
            )?;
            let worktree = crate::git::resolve_thread_project_worktree_at_roots(thread_id, cwd, target_root, &managed_roots);
            let roots: Vec<String> = plan["targetProject"]["rootPaths"].as_array().unwrap()
                .iter().filter_map(Value::as_str).map(str::to_owned).collect();
            plan["workspaceTarget"] = crate::thread_workspace::project_target(
                &roots, worktree.as_ref().map(|(source, root)| (source.as_str(), root.as_str())),
            )?;
        }
        if *self.state_map.lock().unwrap() != original {
            return Err("项目或工作区状态在读取期间已变化，请重新准备移动计划。".to_string());
        }
        plan["liveValidated"] = json!(true);
        plan["requiredLiveValidation"] = json!(["commit-revalidation"]);
        Ok(plan)
    }

    pub(crate) async fn commit_thread_project_move_with_rpc<F, R>(
        &self,
        thread_id: &str,
        target_project_id: Option<&str>,
        confirmed_plan: &Value,
        confirm_missing_sources: bool,
        state_path: &Path,
        mut call: F,
    ) -> Result<Value, String>
    where
        F: FnMut(String, Value) -> R,
        R: std::future::Future<Output = Result<Value, String>>,
    {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return Err("缺少会话 ID，无法移动项目。".into());
        }
        let token = format!("move:{}", uuid::Uuid::new_v4());
        {
            let mut owners = self.workspace_turn_owners.lock().unwrap();
            if owners.contains_key(thread_id) {
                return Err("会话正在执行其他操作，请稍后重试。".into());
            }
            owners.insert(thread_id.to_owned(), token.clone());
        }

        let result = self.commit_thread_project_move_owned(
            thread_id,
            target_project_id,
            confirmed_plan,
            confirm_missing_sources,
            state_path,
            &mut call,
        ).await;
        let mut owners = self.workspace_turn_owners.lock().unwrap();
        if owners.get(thread_id) == Some(&token) {
            owners.remove(thread_id);
        }
        result
    }

    pub(crate) async fn reconcile_thread_project_move_with_rpc<F, R>(
        &self,
        thread_id: &str,
        state_path: &Path,
        mut read: F,
    ) -> Result<Value, String>
    where
        F: FnMut(String, Value) -> R,
        R: std::future::Future<Output = Result<Value, String>>,
    {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return Err("缺少会话 ID，无法恢复项目移动。".into());
        }
        let token = format!("move:{}", uuid::Uuid::new_v4());
        {
            let mut owners = self.workspace_turn_owners.lock().unwrap();
            if owners.contains_key(thread_id) {
                return Err("会话正在执行其他操作，请稍后重试。".into());
            }
            owners.insert(thread_id.to_owned(), token.clone());
        }
        let result = async {
            let recovery = self.state_map.lock().unwrap()
                .get("thread-project-move-recovery")
                .and_then(Value::as_object)
                .and_then(|records| records.get(thread_id))
                .cloned()
                .ok_or("此会话没有待恢复的项目移动。")?;
            let response = read("thread/read".into(), json!({
                "threadId":thread_id,"includeTurns":false,
            })).await?;
            if response["thread"]["id"].as_str() != Some(thread_id) {
                return Err("服务返回的会话身份不匹配，恢复状态保持不变。".into());
            }
            let actual = response["thread"].get("projectId");
            if actual.and_then(Value::as_str) == recovery["targetProjectId"].as_str()
                && (recovery["targetProjectId"].is_string() || actual.is_some_and(Value::is_null))
            {
                self.finish_project_move(thread_id, state_path)?;
                Ok(json!({"recovered":true,"membership":"target"}))
            } else if project_id_matches(
                actual.unwrap_or(&Value::Null),
                recovery["sourceProjectId"].as_str(),
            ) && (recovery["sourceProjectId"].is_string() || actual.is_some_and(Value::is_null))
            {
                self.rollback_project_move(thread_id, state_path)?;
                Ok(json!({"recovered":true,"membership":"source"}))
            } else {
                Err("服务端归属与源/目标均不匹配，恢复记录保留且发送仍被阻止。".into())
            }
        }.await;
        let mut owners = self.workspace_turn_owners.lock().unwrap();
        if owners.get(thread_id) == Some(&token) {
            owners.remove(thread_id);
        }
        result
    }

    async fn commit_thread_project_move_owned<F, R>(
        &self,
        thread_id: &str,
        target_project_id: Option<&str>,
        confirmed_plan: &Value,
        confirm_missing_sources: bool,
        state_path: &Path,
        call: &mut F,
    ) -> Result<Value, String>
    where
        F: FnMut(String, Value) -> R,
        R: std::future::Future<Output = Result<Value, String>>,
    {
        if confirmed_plan["liveValidated"] != true {
            return Err("移动计划未通过服务端验证，请重新检查。".into());
        }
        let fresh = {
            let mut read = |method: String, params: Value| call(method, params);
            self.prepare_thread_project_move_with_rpc(
                thread_id, target_project_id, &mut read,
            ).await?
        };
        for field in [
            "sourceServerProjectId",
            "targetServerProjectId",
            "sourceProject",
            "targetProject",
            "missingSources",
            "workspaceTarget",
            "appliedFallback",
            "workspaceState",
        ] {
            if confirmed_plan[field] != fresh[field] {
                return Err("移动计划已变化，请重新检查并确认后重试。".into());
            }
        }
        let missing = fresh["missingSources"].as_array().cloned().unwrap_or_default();
        if !missing.is_empty() && !confirm_missing_sources {
            return Err("目标项目需要新增文件夹访问权限，尚未获得确认。".into());
        }

        let target_id = fresh["targetServerProjectId"].as_str().map(str::to_owned);
        if let (Some(target_id), Some(target)) = (target_id.as_deref(), fresh["targetProject"].as_object()) {
            if !missing.is_empty() {
                let mut roots: Vec<String> = target["rootPaths"].as_array()
                    .into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect();
                roots.extend(missing.iter().filter_map(Value::as_str).map(str::to_owned));
                let response = call("project/update".into(), json!({
                    "projectId": target_id,
                    "roots": roots.iter().map(|path| json!({"path":path})).collect::<Vec<_>>(),
                })).await;
                let updated = call("project/read".into(), json!({"projectId":target_id})).await?;
                let readback_roots: Vec<String> = updated["project"]["roots"].as_array()
                    .into_iter().flatten().filter_map(|root| root["path"].as_str().map(str::to_owned)).collect();
                if updated["project"]["id"].as_str() != Some(target_id)
                    || readback_roots != roots {
                    return Err(match response {
                        Ok(_) => "目标项目文件夹写入后读回不一致，尚未移动会话。".into(),
                        Err(error) => format!("无法确认目标项目文件夹更新：{error}"),
                    });
                }
            }
        }

        let key = format!("thread-workspace-state-v1:{thread_id}");
        let revision = uuid::Uuid::new_v4().to_string();
        let assignment = target_id.as_ref().map(|id| json!({"projectKind":"local","projectId":id}));
        {
            let mut guard = self.state_map.lock().unwrap();
            let mut staged = guard.clone();
            let atoms = staged.entry(PERSISTED_ATOM_STATE_KEY).or_insert_with(|| json!({}));
            if !atoms.is_object() {
                return Err("本地工作区状态无效，项目未移动。".into());
            }
            let previous = atoms.get(&key).cloned().unwrap_or(Value::Null);
            atoms[&key] = crate::thread_workspace::stage_project_move(
                &previous,
                assignment.as_ref().unwrap_or(&Value::Null),
                &fresh["appliedFallback"],
                &fresh["workspaceTarget"],
                &revision,
            );
            let recovery = staged.entry("thread-project-move-recovery").or_insert_with(|| json!({}));
            if !recovery.is_object() {
                return Err("项目移动恢复状态无效，项目未移动。".into());
            }
            recovery[thread_id] = json!({
                "revision":revision,
                "previousWorkspace":previous,
                "sourceProjectId":fresh["sourceServerProjectId"],
                "targetProjectId":fresh["targetServerProjectId"],
                "assignment":assignment,
            });
            persist_state_map(&staged, state_path)?;
            *guard = staged;
        }

        let update_result = call("thread/metadata/update".into(), json!({
            "threadId":thread_id,
            "projectId":target_id.as_deref().unwrap_or(""),
        })).await;
        let readback = call("thread/read".into(), json!({"threadId":thread_id,"includeTurns":false})).await;
        match readback {
            Ok(value) if value["thread"]["id"].as_str() == Some(thread_id)
                && value["thread"]["projectId"].as_str() == target_id.as_deref() =>
            {
                self.finish_project_move(thread_id, state_path)?;
                Ok(json!({"moved":true,"projectMembership":self.sidebar_project_membership()}))
            }
            Ok(value) if project_id_matches(&value["thread"]["projectId"], fresh["sourceServerProjectId"].as_str()) => {
                self.rollback_project_move(thread_id, state_path)?;
                Err(update_result.err().unwrap_or_else(|| "服务端未保存项目归属，移动已撤销。".into()))
            }
            Ok(_) | Err(_) => {
                self.persist_project_move_error(thread_id, state_path, update_result.err())?;
                Err("无法确认服务端项目归属，移动状态已保留并阻止发送；请重试恢复。".into())
            }
        }
    }

    fn finish_project_move(&self, thread_id: &str, state_path: &Path) -> Result<(), String> {
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        let recovery = next.get("thread-project-move-recovery")
            .and_then(Value::as_object).and_then(|items| items.get(thread_id))
            .cloned().ok_or("缺少项目移动恢复记录。")?;
        let assignment = recovery["assignment"].clone();
        let workspace = next.get_mut(PERSISTED_ATOM_STATE_KEY)
            .and_then(Value::as_object_mut)
            .and_then(|atoms| atoms.get_mut(&format!("thread-workspace-state-v1:{thread_id}")))
            .ok_or("项目移动工作区状态已丢失。")?;
        workspace["projectMembership"] = assignment.clone();
        workspace["projectMembershipRevision"] = json!(recovery["revision"]);
        let global = next.entry("thread-project-assignments").or_insert_with(|| json!({}));
        if !global.is_object() {
            return Err("会话项目归属状态无效。".into());
        }
        if let Some(assignment) = assignment.as_object() {
            global[thread_id] = Value::Object(assignment.clone());
            if let Some(projectless) = next.get_mut("projectless-thread-ids").and_then(Value::as_array_mut) {
                projectless.retain(|id| id.as_str() != Some(thread_id));
            }
        } else {
            global.as_object_mut().unwrap().remove(thread_id);
            let projectless = next.entry("projectless-thread-ids").or_insert_with(|| json!([]));
            if !projectless.is_array() { return Err("聊天归属状态无效。".into()); }
            if !projectless.as_array().unwrap().iter().any(|id| id.as_str() == Some(thread_id)) {
                projectless.as_array_mut().unwrap().push(json!(thread_id));
            }
        }
        next.get_mut("thread-project-move-recovery").and_then(Value::as_object_mut).unwrap().remove(thread_id);
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(())
    }

    fn rollback_project_move(&self, thread_id: &str, state_path: &Path) -> Result<(), String> {
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        let recovery = next.get("thread-project-move-recovery")
            .and_then(Value::as_object).and_then(|items| items.get(thread_id))
            .cloned().ok_or("缺少项目移动恢复记录。")?;
        let key = format!("thread-workspace-state-v1:{thread_id}");
        if let Some(workspace) = next.get_mut(PERSISTED_ATOM_STATE_KEY)
            .and_then(Value::as_object_mut).and_then(|atoms| atoms.get_mut(&key)) {
            *workspace = crate::thread_workspace::rollback_project_move(
                workspace, recovery["revision"].as_str().unwrap_or_default(), &recovery["previousWorkspace"],
            );
            if workspace.is_null() {
                next.get_mut(PERSISTED_ATOM_STATE_KEY).and_then(Value::as_object_mut).unwrap().remove(&key);
            }
        }
        next.get_mut("thread-project-move-recovery").and_then(Value::as_object_mut).unwrap().remove(thread_id);
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(())
    }

    fn persist_project_move_error(
        &self, thread_id: &str, state_path: &Path, error: Option<String>,
    ) -> Result<(), String> {
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        if let Some(record) = next.get_mut("thread-project-move-recovery")
            .and_then(Value::as_object_mut).and_then(|items| items.get_mut(thread_id)) {
            record["lastError"] = json!(error);
        }
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(())
    }

    pub fn pet_preferences(&self) -> Result<Value, String> {
        Self::read_pet_preferences(&self.state_map.lock().unwrap())
    }

    fn read_pet_preferences(state: &Map<String, Value>) -> Result<Value, String> {
        let atoms = state.get(PERSISTED_ATOM_STATE_KEY).filter(|value| !value.is_null());
        if atoms.is_some_and(|value| !value.is_object()) { return Err("偏好存储格式无效。".into()); }
        let selected = atoms.and_then(|value| value.get("selected-avatar-id")).cloned().unwrap_or(Value::Null);
        let size = atoms.and_then(|value| value.get("avatar-overlay-mascot-width-px")).cloned().unwrap_or(json!(112));
        let visibility = atoms.and_then(|value| value.get("pet-visibility")).cloned().unwrap_or(json!("always-visible"));
        if !(selected.is_null() || selected.as_str().is_some_and(|value| !value.trim().is_empty()))
            || !size.as_u64().is_some_and(|value| (80..=224).contains(&value))
            || !visibility.as_str().is_some_and(|value| matches!(value, "always-visible" | "on-demand")) {
            return Err("宠物偏好格式无效。".into());
        }
        Ok(json!({"selectedAvatarId":selected,"petSize":size,"petVisibility":visibility}))
    }

    pub fn update_pet_preferences(&self, patch: Value) -> Result<Value, String> {
        self.update_pet_preferences_at_path(patch, &desktop_global_state_path())
    }

    fn update_pet_preferences_at_path(&self, patch: Value, state_path: &Path) -> Result<Value, String> {
        let patch = patch.as_object().ok_or("宠物偏好更新必须为对象。")?;
        let mut entries = Vec::new();
        for (field, value) in patch {
            let key = match field.as_str() {
                "selectedAvatarId" if value.is_null() || value.as_str().is_some_and(|value| !value.trim().is_empty()) => "selected-avatar-id",
                "petSize" if value.as_u64().is_some_and(|value| (80..=224).contains(&value)) => "avatar-overlay-mascot-width-px",
                "petVisibility" if value.as_str().is_some_and(|value| matches!(value, "always-visible" | "on-demand")) => "pet-visibility",
                _ => return Err(format!("不支持的宠物偏好或值：{}", field)),
            };
            entries.push((key, value.clone()));
        }
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        let atoms = next.entry(PERSISTED_ATOM_STATE_KEY).or_insert_with(|| json!({}));
        if atoms.is_null() { *atoms = json!({}); }
        let atoms = atoms.as_object_mut().ok_or("偏好存储格式无效。")?;
        for (key, value) in entries { atoms.insert(key.into(), value); }
        let readback = Self::read_pet_preferences(&next)?;
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(readback)
    }

    pub fn review_preferences(&self) -> Result<Value, String> {
        Self::read_review_preferences(&self.state_map.lock().unwrap())
    }

    pub(crate) fn review_provider_preferences(&self) -> Result<Value, String> {
        Self::read_review_provider_preferences(&self.state_map.lock().unwrap())
    }

    fn read_review_provider_preferences(state: &Map<String, Value>) -> Result<Value, String> {
        let atoms = state.get(PERSISTED_ATOM_STATE_KEY).filter(|value| !value.is_null());
        if atoms.is_some_and(|value| !value.is_object()) { return Err("偏好存储格式无效。".into()); }
        let provider = atoms.and_then(|atoms| atoms.get("code-review-git-hosting-provider")).cloned().unwrap_or(json!("github"));
        if !provider.is_string() { return Err("代码审查提供商格式无效。".into()); }
        let connection = atoms.and_then(|atoms| atoms.get("code-review-github-connection")).cloned().unwrap_or(Value::Null);
        let gitlab = atoms.and_then(|atoms| atoms.get("code-review-gitlab-connector-id")).cloned().unwrap_or(Value::Null);
        let (_, connection) = crate::review_provider::validated_preference("githubConnection", &connection)?;
        let (_, gitlab) = crate::review_provider::validated_preference("gitlabConnectorId", &gitlab)?;
        Ok(json!({"gitHostingProvider":provider,"githubConnection":connection,"gitlabConnectorId":gitlab}))
    }

    pub(crate) fn update_review_provider_preference(&self, field: &str, value: &Value, expected: &Value) -> Result<Value, String> {
        self.update_review_provider_preference_at_path(field, value, expected, &desktop_global_state_path())
    }

    fn update_review_provider_preference_at_path(&self, field: &str, value: &Value, expected: &Value, path: &Path) -> Result<Value, String> {
        let (key, value) = crate::review_provider::validated_preference(field, value)?;
        let mut guard = self.state_map.lock().unwrap();
        if Self::read_review_provider_preferences(&guard)?[field] != *expected { return Err("提供商设置已在其他窗口更改，请重新读取。".into()); }
        let mut next = guard.clone();
        let atoms = next.entry(PERSISTED_ATOM_STATE_KEY).or_insert_with(|| json!({}));
        if atoms.is_null() { *atoms = json!({}); }
        atoms.as_object_mut().ok_or("偏好存储格式无效。")?.insert(key.into(), value);
        let readback = Self::read_review_provider_preferences(&next)?;
        persist_state_map(&next, path)?;
        *guard = next;
        Ok(readback)
    }

    fn read_review_preferences(state: &Map<String, Value>) -> Result<Value, String> {
        let atoms = state.get(PERSISTED_ATOM_STATE_KEY).filter(|value| !value.is_null());
        if atoms.is_some_and(|value| !value.is_object()) { return Err("偏好存储格式无效。".to_string()); }
        let read = |key: &str, default: &str| -> Result<String, String> {
            match atoms.and_then(|value| value.get(key)) {
                None => Ok(default.to_string()),
                Some(Value::String(value)) => Ok(value.clone()),
                _ => Err(format!("审查偏好格式无效：{}", key)),
            }
        };
        Ok(json!({
            "githubLinkTarget": read("code-review-github-link-target", "github")?,
            "configuredGithubLinkTarget": atoms.and_then(|value| value.get("code-review-github-link-target")).cloned().unwrap_or(Value::Null),
            "localReviewInstructions": read("code-review-local-instructions", "")?,
        }))
    }

    pub fn update_review_preferences(&self, patch: Value) -> Result<Value, String> {
        self.update_review_preferences_at_path(patch, &desktop_global_state_path())
    }

    fn update_review_preferences_at_path(&self, patch: Value, state_path: &Path) -> Result<Value, String> {
        let patch = patch.as_object().ok_or("审查偏好更新必须为对象。")?;
        let mut entries = Vec::new();
        for (field, value) in patch {
            let value = value.as_str().ok_or("审查偏好必须为字符串。")?;
            let key = match field.as_str() {
                "githubLinkTarget" if matches!(value, "code-review-tab" | "github") => "code-review-github-link-target",
                "localReviewInstructions" => "code-review-local-instructions",
                _ => return Err(format!("不支持的审查偏好：{}", field)),
            };
            entries.push((key, Value::String(value.to_string())));
        }
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        let atoms = next.entry(PERSISTED_ATOM_STATE_KEY).or_insert_with(|| json!({}));
        if atoms.is_null() { *atoms = json!({}); }
        let atoms = atoms.as_object_mut().ok_or("偏好存储格式无效。")?;
        for (key, value) in entries { atoms.insert(key.to_string(), value); }
        let readback = Self::read_review_preferences(&next)?;
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(readback)
    }

    pub fn set_value(&self, key: &str, value: Value) {
        let mut guard = self.state_map.lock().unwrap();
        guard.insert(key.to_string(), value);
        Self::save_locked(&guard);
    }

    pub fn set_value_persisted(&self, key: &str, value: Value) -> Result<(), String> {
        self.set_value_persisted_at_path(key, value, &desktop_global_state_path())
    }

    pub fn update_value_persisted<F>(&self, key: &str, update: F) -> Result<Value, String>
    where F: FnOnce(Value) -> Result<Value, String> {
        self.update_value_persisted_at_path(key, update, &desktop_global_state_path())
    }

    fn update_value_persisted_at_path<F>(&self, key: &str, update: F, state_path: &Path) -> Result<Value, String>
    where F: FnOnce(Value) -> Result<Value, String> {
        let mut guard = self.state_map.lock().unwrap();
        let value = update(guard.get(key).cloned().unwrap_or(Value::Null))?;
        let mut next = guard.clone();
        next.insert(key.to_string(), value.clone());
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(value)
    }

    fn set_value_persisted_at_path(
        &self, key: &str, value: Value, state_path: &Path,
    ) -> Result<(), String> {
        let value = if key == crate::git::WORKTREE_ROOT_KEY {
            Value::String(crate::git::validate_worktree_root(value.as_str().ok_or("工作树目录配置不是字符串。")?)?)
        } else { value };
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        next.insert(key.to_string(), value);
        persist_state_map(&next, state_path)?;
        *guard = next;
        Ok(())
    }

    pub fn list_workspace_roots(&self) -> Vec<WorkspaceRootItem> {
        let guard = self.state_map.lock().unwrap();
        Self::workspace_roots_in_state(&guard)
    }

    fn workspace_roots_in_state(guard: &Map<String, Value>) -> Vec<WorkspaceRootItem> {
        let mut roots: Vec<String> = guard
            .get(DESKTOP_PROJECT_ROOTS_KEY)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str())
                    .map(normalize_fs_path)
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        if roots.is_empty() {
            if let Ok(cwd) = std::env::current_dir() {
                roots.push(normalize_fs_path(&cwd.to_string_lossy()));
            }
        }

        let labels: HashMap<String, String> = guard
            .get(DESKTOP_WORKSPACE_LABELS_KEY)
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (normalize_fs_path(k), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        let active_roots: Vec<String> = guard
            .get(ACTIVE_WORKSPACE_ROOTS_KEY)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(normalize_fs_path)
                    .collect()
            })
            .unwrap_or_default();

        let primary_active = active_roots
            .first()
            .cloned()
            .or_else(|| roots.first().cloned())
            .unwrap_or_default();
        let project_identity = format!("local:{}", codex_home_dir().to_string_lossy());

        roots
            .into_iter()
            .map(|path| {
                let default_label = Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&path)
                    .to_string();
                let label = labels.get(&path).cloned().unwrap_or(default_label);
                let active = path.eq_ignore_ascii_case(&primary_active);
                let has_agents_md = find_agents_md(&path).is_some();
                WorkspaceRootItem {
                    id: path.clone(),
                    server_project_id: workspace_server_project_id(
                        &guard,
                        &project_identity,
                        &path,
                    ),
                    path,
                    label,
                    active,
                    has_agents_md,
                }
            })
            .collect()
    }

    pub fn active_workspace_root(&self) -> String {
        let items = self.list_workspace_roots();
        items
            .iter()
            .find(|i| i.active)
            .or_else(|| items.first())
            .map(|i| i.path.clone())
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .map(|p| normalize_fs_path(&p.to_string_lossy()))
                    .unwrap_or_else(|_| ".".to_string())
            })
    }

    pub fn add_workspace_root(
        &self,
        raw_path: &str,
        label: Option<String>,
        set_active: bool,
    ) -> Result<Vec<WorkspaceRootItem>, String> {
        let normalized = normalize_fs_path(raw_path);
        if normalized.is_empty() || !Path::new(&normalized).exists() {
            return Err(format!("Path does not exist: {}", raw_path));
        }
        {
            let mut guard = self.state_map.lock().unwrap();
            let mut current: Vec<String> = guard
                .get(DESKTOP_PROJECT_ROOTS_KEY)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .map(normalize_fs_path)
                        .collect()
                })
                .unwrap_or_default();
            current.retain(|p| !p.eq_ignore_ascii_case(&normalized));
            current.insert(0, normalized.clone());
            guard.insert(DESKTOP_PROJECT_ROOTS_KEY.to_string(), json!(current));

            if let Some(lbl) = label.filter(|s| !s.trim().is_empty()) {
                let mut labels_obj = guard
                    .get(DESKTOP_WORKSPACE_LABELS_KEY)
                    .and_then(|v| v.as_object())
                    .cloned()
                    .unwrap_or_default();
                labels_obj.insert(normalized.clone(), Value::String(lbl.trim().to_string()));
                guard.insert(
                    DESKTOP_WORKSPACE_LABELS_KEY.to_string(),
                    Value::Object(labels_obj),
                );
            }

            if set_active {
                guard.insert(ACTIVE_WORKSPACE_ROOTS_KEY.to_string(), json!([normalized]));
            }
            Self::save_locked(&guard);
        }
        Ok(self.list_workspace_roots())
    }

    pub fn remove_workspace_root(&self, raw_path: &str) -> Vec<WorkspaceRootItem> {
        let normalized = normalize_fs_path(raw_path);
        {
            let mut guard = self.state_map.lock().unwrap();
            let mut current: Vec<String> = guard
                .get(DESKTOP_PROJECT_ROOTS_KEY)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .map(normalize_fs_path)
                        .filter(|p| !p.eq_ignore_ascii_case(&normalized))
                        .collect()
                })
                .unwrap_or_default();
            guard.insert(DESKTOP_PROJECT_ROOTS_KEY.to_string(), json!(current));

            let active: Vec<String> = guard
                .get(ACTIVE_WORKSPACE_ROOTS_KEY)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .map(normalize_fs_path)
                        .filter(|p| !p.eq_ignore_ascii_case(&normalized))
                        .collect()
                })
                .unwrap_or_default();
            let next_active = if active.is_empty() {
                current.drain(..1).collect::<Vec<_>>()
            } else {
                active
            };
            guard.insert(ACTIVE_WORKSPACE_ROOTS_KEY.to_string(), json!(next_active));
            Self::save_locked(&guard);
        }
        self.list_workspace_roots()
    }

    pub fn set_active_workspace_root(&self, raw_path: &str) -> Vec<WorkspaceRootItem> {
        let normalized = normalize_fs_path(raw_path);
        if !normalized.is_empty() {
            let mut guard = self.state_map.lock().unwrap();
            guard.insert(ACTIVE_WORKSPACE_ROOTS_KEY.to_string(), json!([normalized]));
            Self::save_locked(&guard);
        }
        self.list_workspace_roots()
    }

    pub fn select_local_project(&self, project_id: &str) -> Result<Vec<WorkspaceRootItem>, String> {
        self.select_local_project_at_path(project_id, &desktop_global_state_path())?;
        Ok(self.list_workspace_roots())
    }

    fn select_local_project_at_path(
        &self,
        project_id: &str,
        state_path: &Path,
    ) -> Result<(), String> {
        let mut guard = self.state_map.lock().unwrap();
        let mut next = guard.clone();
        select_local_project_in_state(&mut next, project_id)?;
        if let Some(parent) = state_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let serialized = serde_json::to_string_pretty(&next).map_err(|error| error.to_string())?;
        fs::write(state_path, serialized).map_err(|error| error.to_string())?;
        *guard = next;
        Ok(())
    }

    pub fn list_pinned_threads(&self) -> Vec<String> {
        let guard = self.state_map.lock().unwrap();
        guard
            .get(PINNED_THREAD_IDS_KEY)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn list_pinned_projects(&self) -> Vec<String> {
        self.get_value(PINNED_PROJECT_IDS_KEY).as_array().into_iter().flatten()
            .filter_map(Value::as_str).map(str::to_owned).collect()
    }

    pub fn set_project_pinned(&self, project_id: &str, legacy_project_id: Option<&str>, pinned: bool) -> Result<Vec<String>, String> {
        self.set_project_pinned_at_path(project_id, legacy_project_id, pinned, &desktop_global_state_path())
    }

    fn set_project_pinned_at_path(&self, project_id: &str, legacy_project_id: Option<&str>, pinned: bool, state_path: &Path) -> Result<Vec<String>, String> {
        if project_id.trim().is_empty() {
            return Err("Project id is required".into());
        }
        let updated = self.update_value_persisted_at_path(PINNED_PROJECT_IDS_KEY, |value| {
            let mut ids: Vec<&str> = value.as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let matches = |id: &str| id == project_id || Some(id) == legacy_project_id;
            if pinned {
                if !ids.iter().any(|id| matches(id)) {
                    ids.push(legacy_project_id.unwrap_or(project_id));
                }
            } else {
                ids.retain(|id| !matches(id));
            }
            Ok(json!(ids))
        }, state_path)?;
        serde_json::from_value(updated).map_err(|error| error.to_string())
    }

    pub fn toggle_thread_pinned(&self, thread_id: &str, pinned: bool) -> Result<Vec<String>, String> {
        self.toggle_thread_pinned_at_path(thread_id, pinned, &desktop_global_state_path())
    }

    fn toggle_thread_pinned_at_path(&self, thread_id: &str, pinned: bool, state_path: &Path) -> Result<Vec<String>, String> {
        let updated = self.update_value_persisted_at_path(PINNED_THREAD_IDS_KEY, |value| {
            let mut ids: Vec<&str> = value.as_array().into_iter().flatten()
                .filter_map(Value::as_str)
                .filter(|id| *id != thread_id)
                .collect();
            if pinned {
                ids.insert(0, thread_id);
            }
            Ok(json!(ids))
        }, state_path)?;
        serde_json::from_value(updated).map_err(|error| error.to_string())
    }

    pub fn list_archived_threads(&self) -> Vec<Value> {
        let guard = self.state_map.lock().unwrap();
        guard
            .get(ARCHIVED_THREADS_KEY)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    }

    pub(crate) fn finish_thread_archive(&self, thread: Value, archive: bool, restore_pin: Option<ArchivePinPlacement>) -> Value {
        self.finish_thread_archive_at_path(thread, archive, restore_pin, &desktop_global_state_path())
    }

    fn finish_thread_archive_at_path(&self, thread: Value, archive: bool, restore_pin: Option<ArchivePinPlacement>, path: &Path) -> Value {
        let id = thread["id"].as_str().unwrap_or_default().to_owned();
        let mut state = self.state_map.lock().unwrap();
        let mut next = state.clone();
        let mut archived = next.get(ARCHIVED_THREADS_KEY).and_then(Value::as_array).cloned().unwrap_or_default();
        archived.retain(|item| item["id"].as_str() != Some(&id));
        if archive { archived.insert(0, thread); }
        next.insert(ARCHIVED_THREADS_KEY.into(), json!(archived));
        let original_pins = next.get(PINNED_THREAD_IDS_KEY).and_then(Value::as_array).cloned().unwrap_or_default();
        let mut pins = original_pins.clone();
        let mut placement = Value::Null;
        if archive {
            if let Some(index) = pins.iter().position(|pin| pin.as_str() == Some(&id)) {
                placement = json!({"beforeThreadId": pins.iter().skip(index + 1)
                    .filter_map(Value::as_str).find(|pin| *pin != id)});
                pins.retain(|pin| pin.as_str() != Some(&id));
            }
        } else if let Some(restore) = restore_pin {
            if !pins.iter().any(|pin| pin.as_str() == Some(&id)) {
                let index = restore.before_thread_id.as_deref()
                    .and_then(|before| pins.iter().position(|pin| pin.as_str() == Some(before)))
                    .unwrap_or(pins.len());
                pins.insert(index, json!(id));
            }
        }
        if pins != original_pins { next.insert(PINNED_THREAD_IDS_KEY.into(), json!(pins)); }
        match persist_state_map(&next, path) {
            Ok(()) => {
                *state = next;
                json!({"pinnedThreadIds": pins, "pinPlacement": placement, "localStateError": false})
            }
            Err(_) => {
                // The service already confirmed the archive change. Keep the local
                // cache in step, but do not report a pin change that did not persist.
                state.insert(ARCHIVED_THREADS_KEY.into(), json!(archived));
                json!({"pinnedThreadIds": original_pins, "pinPlacement": null, "localStateError": true})
            }
        }
    }

    pub(crate) fn update_archived_thread(&self, thread: Value, archive: bool) -> Vec<Value> {
        self.update_archived_thread_with(thread, archive, Self::save_locked)
    }

    fn update_archived_thread_with(
        &self,
        thread: Value,
        archive: bool,
        persist: impl FnOnce(&Map<String, Value>),
    ) -> Vec<Value> {
        let mut guard = self.state_map.lock().unwrap();
        let mut archived = guard.get(ARCHIVED_THREADS_KEY).and_then(Value::as_array).cloned().unwrap_or_default();
        let id = thread.get("id").and_then(Value::as_str);
        archived.retain(|item| item.get("id").and_then(Value::as_str) != id);
        if archive { archived.insert(0, thread); }
        guard.insert(ARCHIVED_THREADS_KEY.into(), json!(archived));
        persist(&guard);
        archived
    }

    pub fn set_archived_threads(&self, threads: Vec<Value>) {
        self.set_value(ARCHIVED_THREADS_KEY, Value::Array(threads));
    }

    pub fn record_thread_workspace(&self, thread_id: &str, cwd: &str) {
        if thread_id.trim().is_empty() || cwd.trim().is_empty() {
            return;
        }
        let mut guard = self.state_map.lock().unwrap();
        let mut hints = guard
            .get(THREAD_WORKSPACE_HINTS_KEY)
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        hints.insert(thread_id.to_string(), Value::String(normalize_fs_path(cwd)));
        guard.insert(THREAD_WORKSPACE_HINTS_KEY.to_string(), Value::Object(hints));
        Self::save_locked(&guard);
    }

    pub fn remove_thread_record(&self, thread_id: &str) {
        if thread_id.trim().is_empty() {
            return;
        }
        let mut pinned = self.list_pinned_threads();
        pinned.retain(|id| id != thread_id);
        self.set_value(PINNED_THREAD_IDS_KEY, json!(pinned));

        self.update_archived_thread(json!({"id":thread_id}), false);

        let mut guard = self.state_map.lock().unwrap();
        if let Some(hints) = guard
            .get_mut(THREAD_WORKSPACE_HINTS_KEY)
            .and_then(|v| v.as_object_mut())
        {
            hints.remove(thread_id);
        }
        Self::save_locked(&guard);
    }

    pub fn get_thread_workspace_hints(&self) -> HashMap<String, String> {
        let guard = self.state_map.lock().unwrap();
        guard
            .get(THREAD_WORKSPACE_HINTS_KEY)
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
fn project_assignment_for_thread(state: &Map<String, Value>, thread_id: &str) -> Option<Value> {
    let workspace = state
        .get(PERSISTED_ATOM_STATE_KEY)
        .and_then(Value::as_object)
        .and_then(|atoms| atoms.get(&format!("thread-workspace-state-v1:{thread_id}")));
    if let Some(assignment) = workspace.and_then(|workspace| {
        workspace.get("projectMembership").filter(|value| !value.is_null())
            .or_else(|| workspace.get("project"))
    }) {
        if assignment.is_null() || is_project_assignment(assignment) {
            return (!assignment.is_null()).then(|| assignment.clone());
        }
    }
    state
        .get("thread-project-assignments")
        .and_then(Value::as_object)
        .and_then(|entries| entries.get(thread_id))
        .filter(|value| is_project_assignment(value))
        .cloned()
}

fn local_project_for_server_id(state: &Map<String, Value>, server_id: &str) -> Option<Value> {
    read_sidebar_project_membership(state)["localProjects"]
        .as_array()
        .and_then(|projects| {
            projects.iter().find(|project| {
                project["serverProjectId"].as_str() == Some(server_id)
            })
        })
        .cloned()
}

fn local_project_for_legacy_id(state: &Map<String, Value>, legacy_id: &str) -> Option<Value> {
    read_sidebar_project_membership(state)["localProjects"]
        .as_array()
        .and_then(|projects| {
            projects.iter().find(|project| project["id"].as_str() == Some(legacy_id))
        })
        .cloned()
}

#[cfg(test)]
fn prepare_thread_project_move_in_state(
    state: &Map<String, Value>,
    thread_id: &str,
    target_project_id: Option<&str>,
) -> Result<Value, String> {
    let current_assignment = project_assignment_for_thread(state, thread_id);
    prepare_thread_project_move_for_assignment(state, thread_id, target_project_id, current_assignment)
}

fn prepare_thread_project_move_for_assignment(
    state: &Map<String, Value>,
    thread_id: &str,
    target_project_id: Option<&str>,
    current_assignment: Option<Value>,
) -> Result<Value, String> {
    if current_assignment
        .as_ref()
        .is_some_and(|assignment| assignment["projectKind"] != "local")
    {
        return Err("远程项目会话不能使用本地项目移动。".to_string());
    }

    let source_project = current_assignment
        .as_ref()
        .and_then(|assignment| assignment["projectId"].as_str())
        .and_then(|server_id| local_project_for_server_id(state, server_id));
    if current_assignment.is_some() && source_project.is_none() {
        return Err("当前会话的项目身份未映射到本机项目，无法移动。".to_string());
    }

    if target_project_id.is_some_and(|id| id.trim().is_empty()) {
        return Err("目标项目 ID 不能为空；移到聊天时必须使用空目标。".to_string());
    }
    let target_project = match target_project_id.map(str::trim) {
        Some(legacy_id) => {
            let project = local_project_for_server_id(state, legacy_id)
                .or_else(|| local_project_for_legacy_id(state, legacy_id))
                .ok_or_else(|| "目标不是当前 CODEX_HOME 映射的本地项目。".to_string())?;
            if project["serverProjectId"].as_str().is_none() {
                return Err("目标本地项目尚未映射到 app-server 身份。".to_string());
            }
            Some(project)
        }
        None => None,
    };

    let source_server_id = source_project
        .as_ref()
        .and_then(|project| project["serverProjectId"].as_str());
    let target_server_id = target_project
        .as_ref()
        .and_then(|project| project["serverProjectId"].as_str());
    let same_membership = source_server_id.is_some() && source_server_id == target_server_id;
    let source_roots: Vec<String> = source_project
        .as_ref()
        .and_then(|project| project["rootPaths"].as_array())
        .map(|roots| roots.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();
    let target_roots: Vec<String> = target_project
        .as_ref()
        .and_then(|project| project["rootPaths"].as_array())
        .map(|roots| roots.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();

    let workspace_target = if target_roots.is_empty() {
        Value::Null
    } else {
        crate::thread_workspace::project_target(&target_roots, None)?
    };
    let missing_sources = if target_project.is_some() {
        crate::thread_workspace::missing_project_sources(&source_roots, &target_roots)
    } else {
        Vec::new()
    };
    let workspace_state = state
        .get(PERSISTED_ATOM_STATE_KEY)
        .and_then(Value::as_object)
        .and_then(|atoms| atoms.get(&format!("thread-workspace-state-v1:{thread_id}")))
        .cloned()
        .unwrap_or(Value::Null);

    Ok(json!({
        "threadId": thread_id,
        "sourceProject": source_project,
        "targetProject": target_project,
        "sourceServerProjectId": source_server_id,
        "targetServerProjectId": target_server_id,
        "membershipProjectId": target_server_id.unwrap_or(""),
        "sameMembership": same_membership,
        "missingSources": missing_sources,
        "requiresConfirmation": !missing_sources.is_empty(),
        "workspaceTarget": workspace_target,
        "workspaceState": workspace_state,
        "liveValidated": false,
        "requiredLiveValidation": ["thread/read", "project/read", "local-environment", "idle-status", "worktree-resolution"],
        "writesPerformed": false,
        "commitAvailable": false,
    }))
}

pub fn find_agents_md(root_dir: &str) -> Option<(String, String)> {
    let candidates = ["AGENTS.md", "CLAUDE.md", "agents.md", "claude.md"];
    let base = Path::new(root_dir);
    for name in candidates {
        let candidate = base.join(name);
        if candidate.is_file() {
            if let Ok(content) = fs::read_to_string(&candidate) {
                if !content.trim().is_empty() {
                    return Some((
                        candidate.to_string_lossy().to_string(),
                        content.trim().to_string(),
                    ));
                }
            }
        }
    }
    None
}

pub fn list_directory_entries(
    dir_path: &str,
    show_hidden: bool,
) -> Result<Vec<DirectoryEntryItem>, String> {
    let normalized = normalize_fs_path(dir_path);
    let path = Path::new(&normalized);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path));
    }
    let mut items = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !show_hidden && name.starts_with('.') && name != ".env" && name != ".gitignore" {
            continue;
        }
        if name == "node_modules" || name == "target" || name == ".git" {
            if !show_hidden {
                continue;
            }
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        items.push(DirectoryEntryItem {
            name,
            path: normalize_fs_path(&entry.path().to_string_lossy()),
            is_directory: meta.is_dir(),
            size: meta.len(),
            mtime_ms,
        });
    }
    items.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

pub fn read_file_preview(file_path: &str, max_bytes: usize) -> Result<FilePreviewResult, String> {
    let normalized = normalize_fs_path(file_path);
    let path = Path::new(&normalized);
    if !path.is_file() {
        return Err(format!("Not a file: {}", file_path));
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let size_bytes = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let image_mime = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    };

    if let Some(mime) = image_mime {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(FilePreviewResult {
            path: normalized,
            is_binary: true,
            is_image: true,
            content: None,
            base64_data_url: Some(format!("data:{};base64,{}", mime, b64)),
            size_bytes,
            mtime_ms,
        });
    }

    let raw_bytes = fs::read(path).map_err(|e| e.to_string())?;
    let slice = if raw_bytes.len() > max_bytes {
        &raw_bytes[..max_bytes]
    } else {
        &raw_bytes[..]
    };

    // Heuristic binary check: null byte in first 8KB
    let check_len = slice.len().min(8192);
    if slice[..check_len].contains(&0) {
        return Ok(FilePreviewResult {
            path: normalized,
            is_binary: true,
            is_image: false,
            content: None,
            base64_data_url: None,
            size_bytes,
            mtime_ms,
        });
    }

    let mut text = String::from_utf8_lossy(slice).to_string();
    if raw_bytes.len() > max_bytes {
        text.push_str(&format!(
            "\n\n... [Truncated: showing {} KB of {} KB]",
            max_bytes / 1024,
            raw_bytes.len() / 1024
        ));
    }

    Ok(FilePreviewResult {
        path: normalized,
        is_binary: false,
        is_image: false,
        content: Some(text),
        base64_data_url: None,
        size_bytes,
        mtime_ms,
    })
}

pub fn search_workspace_files(
    root_dir: &str,
    query: Option<&str>,
    limit: usize,
) -> Vec<WorkspaceFileHit> {
    let normalized_root = normalize_fs_path(root_dir);
    let root_path = Path::new(&normalized_root);
    if !root_path.is_dir() {
        return Vec::new();
    }
    let q = query.unwrap_or("").trim().to_lowercase();
    let max_items = limit.clamp(1, 200);
    let mut results = Vec::new();
    let mut queue = std::collections::VecDeque::new();
    queue.push_back((root_path.to_path_buf(), 0usize));

    let ignored_dirs = [
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        ".turbo",
        "__pycache__",
        ".venv",
        "venv",
    ];

    let mut visited_dirs = 0usize;
    while let Some((curr_dir, depth)) = queue.pop_front() {
        if depth > 4 || visited_dirs > 250 {
            break;
        }
        visited_dirs += 1;
        let Ok(entries) = fs::read_dir(&curr_dir) else {
            continue;
        };
        let mut dir_entries: Vec<_> = entries.flatten().collect();
        dir_entries.sort_by_key(|e| e.file_name());

        for entry in dir_entries {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".env" && name != ".gitignore" {
                continue;
            }
            let entry_path = entry.path();
            let is_dir = entry_path.is_dir();
            if is_dir && ignored_dirs.contains(&name.as_str()) {
                continue;
            }
            let rel_path = entry_path
                .strip_prefix(root_path)
                .unwrap_or(&entry_path)
                .to_string_lossy()
                .replace('\\', "/");
            let rel_dir = entry_path
                .parent()
                .and_then(|p| p.strip_prefix(root_path).ok())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();

            let matches = if q.is_empty() {
                true
            } else {
                name.to_lowercase().contains(&q) || rel_path.to_lowercase().contains(&q)
            };

            if matches && !is_dir {
                results.push(WorkspaceFileHit {
                    name: name.clone(),
                    rel_path: rel_path.clone(),
                    rel_dir,
                    abs_path: normalize_fs_path(&entry_path.to_string_lossy()),
                    is_directory: false,
                });
                if results.len() >= max_items {
                    return results;
                }
            }

            if is_dir && depth < 4 {
                queue.push_back((entry_path, depth + 1));
            }
        }
    }

    results
}

#[cfg(test)]
mod workspace_identity_tests {
    use super::*;

    #[test]
    fn workspace_identity_uses_only_explicit_current_home_and_host_mapping() {
        let value = json!({
            "app-server-project-id-by-legacy-project-id-by-host": {
                "local:D:/home": {"legacy-A": "server-A", "legacy-B": "server-B"},
                "local:D:/other": {"legacy-A": "other-home"},
                "remote:D:/home": {"legacy-A": "remote-project"}
            }
        });
        let state = value.as_object().unwrap();
        assert_eq!(
            workspace_server_project_id(state, "local:D:/home", "legacy-A"),
            Some("server-A".into())
        );
        assert_eq!(
            workspace_server_project_id(state, "local:D:/home", "legacy-B"),
            Some("server-B".into())
        );
        assert_eq!(
            workspace_server_project_id(state, "local:D:/missing", "legacy-A"),
            None
        );
        assert_eq!(
            workspace_server_project_id(state, "local:D:/home", "legacy-C"),
            None
        );
        assert_eq!(
            workspace_server_project_id(state, "local:d:/home", "legacy-A"),
            None
        );
    }

    #[test]
    fn workspace_identity_missing_invalid_and_empty_values_are_unmapped() {
        for mapping in [
            Value::Null,
            json!([]),
            json!({}),
            json!({"local:D:/home": null}),
            json!({"local:D:/home": {"legacy": 7}}),
            json!({"local:D:/home": {"legacy": ""}}),
        ] {
            let state = json!({"app-server-project-id-by-legacy-project-id-by-host": mapping});
            assert_eq!(
                workspace_server_project_id(state.as_object().unwrap(), "local:D:/home", "legacy"),
                None
            );
        }
        assert_eq!(
            workspace_server_project_id(&Map::new(), "local:D:/home", "legacy"),
            None
        );
    }

    #[test]
    fn workspace_membership_reads_nested_atoms_and_membership_before_legacy_project() {
        let local = json!({"projectKind": "local", "projectId": "A"});
        let remote = json!({"projectKind": "remote", "projectId": "B", "hostId": "other"});
        let state = json!({
            "thread-project-assignments": {"global": local, "remote": remote, "bad": 7},
            "projectless-thread-ids": ["none", 7],
            "thread-workspace-state-v1:decoy": {"project": null},
            "electron-persisted-atom-state": {
                "unrelated": {"project": null},
                "thread-workspace-state-v1:override": {"project": local, "projectMembership": remote, "applied": {"cwd": "private-runtime-path"}},
                "thread-workspace-state-v1:fallback": {"project": local, "projectMembership": null},
                "thread-workspace-state-v1:none": {"project": null},
                "thread-workspace-state-v1:bad": {"project": "corrupt"},
                "thread-workspace-state-v1:missing": {},
                "thread-workspace-state-v1:": {"project": null}
            }
        });
        let actual = read_sidebar_project_membership(state.as_object().unwrap());
        assert_eq!(
            actual["threadProjectAssignments"],
            json!({"global": local, "remote": remote})
        );
        assert_eq!(actual["projectlessThreadIds"], json!(["none"]));
        assert_eq!(
            actual["workspaceProjectAssignments"],
            json!({"override": remote, "fallback": local, "none": null})
        );
        assert_eq!(actual["localProjects"], json!([]));
        assert_eq!(actual["selectedProjectId"], Value::Null);
    }

    #[test]
    fn workspace_membership_reads_ordered_entities_roots_and_current_home_server_identity() {
        let home_identity = format!("local:{}", codex_home_dir().to_string_lossy());
        let state = json!({
            "app-server-project-id-by-legacy-project-id-by-host": {
                (home_identity): { "multi": "server-multi", "same-root": "server-same" },
                "local:D:/another-home": { "multi": "wrong-home-id" }
            },
            "electron-persisted-atom-state": {
                "local-projects": {
                    "multi": { "id": "multi", "name": "Multi root", "rootPaths": ["D:/shared", "D:/second"], "createdAt": 10, "updatedAt": 11 },
                    "same-root": { "id": "same-root", "name": "Same root", "rootPaths": ["D:/shared"], "createdAt": 12, "updatedAt": 13 },
                    "bad": { "id": "bad", "name": "Bad root", "rootPaths": ["D:/bad", 4], "createdAt": 14 },
                    "missing-time": { "id": "missing-time", "name": "Missing time", "rootPaths": ["D:/missing"] }
                },
                "project-order": ["same-root", "missing", "multi"],
                "selected-project": { "type": "local", "projectId": "multi" }
            }
        });
        let actual = read_sidebar_project_membership(state.as_object().unwrap());
        assert_eq!(actual["selectedProjectId"], "multi");
        assert_eq!(
            actual["localProjects"],
            json!([
                { "id": "same-root", "name": "Same root", "rootPaths": ["D:/shared"], "createdAt": 12, "serverProjectId": "server-same" },
                { "id": "multi", "name": "Multi root", "rootPaths": ["D:/shared", "D:/second"], "createdAt": 10, "serverProjectId": "server-multi" }
            ])
        );
        assert_eq!(
            actual["localProjects"][0]["id"],
            actual["localProjects"][0]["id"]
        );
        assert_ne!(
            actual["localProjects"][0]["id"], actual["localProjects"][1]["id"],
            "same-root entities must retain separate identities"
        );
        assert_eq!(
            actual["localProjects"][1]["rootPaths"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn workspace_membership_ignores_bad_entity_cache_and_invalid_selected_project() {
        let state = json!({
            "electron-persisted-atom-state": {
                "local-projects": {
                    "wrong-id": { "id": "other-id", "name": "Mismatch", "rootPaths": ["D:/bad"], "createdAt": 1 },
                    "empty": { "id": "empty", "name": "Empty", "rootPaths": [], "createdAt": 1 },
                    "blank-name": { "id": "blank-name", "name": "   ", "rootPaths": ["D:/bad"], "createdAt": 1 }
                },
                "project-order": ["wrong-id", "empty", "blank-name"],
                "selected-project": { "type": "remote", "projectId": "remote-project" }
            }
        });
        let actual = read_sidebar_project_membership(state.as_object().unwrap());
        assert_eq!(actual["localProjects"], json!([]));
        assert_eq!(actual["selectedProjectId"], Value::Null);
    }

    #[test]
    fn workspace_membership_missing_or_invalid_caches_do_not_create_projectless_markers() {
        for state in [
            json!({}),
            json!({"thread-project-assignments": [], "projectless-thread-ids": {}, "electron-persisted-atom-state": []}),
        ] {
            assert_eq!(
                read_sidebar_project_membership(state.as_object().unwrap()),
                json!({
                    "threadProjectAssignments": {}, "projectlessThreadIds": [], "workspaceProjectAssignments": {},
                    "localProjects": [], "selectedProjectId": null
                })
            );
        }
    }

    #[test]
    fn selecting_local_project_writes_nested_atom_and_first_active_root_without_touching_assignments(
    ) {
        let mut state = json!({
            "thread-project-assignments": {
                "thread-1": {"projectKind": "local", "projectId": "server-p1"}
            },
            "projectless-thread-ids": ["thread-2"],
            "active-workspace-roots": ["D:/old"],
            "electron-persisted-atom-state": {
                "local-projects": {
                    "p1": {"id": "p1", "name": "One", "rootPaths": ["D:/one", "D:/one-extra"], "createdAt": 1},
                    "p2": {"id": "p2", "name": "Two", "rootPaths": ["D:/two"], "createdAt": 2}
                },
                "selected-project": {"type": "local", "projectId": "p2"},
                "thread-workspace-state-v1:thread-1": {
                    "projectMembership": {"projectKind": "local", "projectId": "server-p1"}
                }
            }
        });
        let map = state.as_object_mut().unwrap();
        select_local_project_in_state(map, "p1").unwrap();
        assert_eq!(
            map["electron-persisted-atom-state"]["selected-project"],
            json!({
                "type": "local", "projectId": "p1"
            })
        );
        assert_eq!(map["active-workspace-roots"], json!(["D:/one"]));
        assert_eq!(map["electron-saved-workspace-roots"][0], "D:/one");
        assert_eq!(
            map["thread-project-assignments"]["thread-1"]["projectId"],
            "server-p1"
        );
        assert_eq!(map["projectless-thread-ids"], json!(["thread-2"]));
        assert_eq!(
            read_sidebar_project_membership(map)["selectedProjectId"],
            "p1"
        );
    }

    #[test]
    fn selecting_unknown_or_invalid_local_project_is_atomic() {
        let original = json!({
            "active-workspace-roots": ["D:/old"],
            "electron-persisted-atom-state": {
                "local-projects": {
                    "bad": {"id": "other", "name": "Bad", "rootPaths": ["D:/bad"], "createdAt": 1},
                    "empty": {"id": "empty", "name": "Empty", "rootPaths": [], "createdAt": 2},
                    "mixed": {"id": "mixed", "name": "Mixed", "rootPaths": ["D:/valid", 7], "createdAt": 3}
                },
                "selected-project": {"type": "local", "projectId": "old"}
            }
        });
        for requested in ["", "missing", "bad", "empty", "mixed"] {
            let mut state = original.clone();
            let error = select_local_project_in_state(state.as_object_mut().unwrap(), requested)
                .unwrap_err();
            assert!(!error.is_empty());
            assert_eq!(
                state, original,
                "failed selection must not partially mutate state"
            );
        }
    }

    #[test]
    fn selecting_local_project_persists_before_publishing_and_keeps_memory_on_io_failure() {
        let original = json!({
            "electron-persisted-atom-state": {
                "local-projects": {
                    "p1": {"id": "p1", "name": "One", "rootPaths": ["D:/one", "D:/two"], "createdAt": 1}
                },
                "selected-project": {"type": "local", "projectId": "old"}
            }
        });
        let manager = DesktopStateManager {
            state_map: Arc::new(Mutex::new(original.as_object().unwrap().clone())),
            workspace_turn_owners: Arc::new(Mutex::new(HashMap::new())),
        };
        let test_dir =
            std::env::temp_dir().join(format!("codex-project-selection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap();
        // A directory cannot be opened as a file, on both Windows and Unix.
        assert!(manager
            .select_local_project_at_path("p1", &test_dir)
            .is_err());
        assert_eq!(
            *manager.state_map.lock().unwrap(),
            *original.as_object().unwrap()
        );

        let state_path = test_dir.join("nested").join("state.json");
        manager
            .select_local_project_at_path("p1", &state_path)
            .unwrap();
        let saved: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
        assert_eq!(
            saved["electron-persisted-atom-state"]["selected-project"]["projectId"],
            "p1"
        );
        assert_eq!(saved["active-workspace-roots"], json!(["D:/one"]));
        assert_eq!(
            saved.as_object().unwrap(),
            &*manager.state_map.lock().unwrap()
        );
        assert_eq!(
            read_sidebar_project_membership(saved.as_object().unwrap())["selectedProjectId"],
            "p1"
        );
        fs::remove_file(&state_path).unwrap();
        fs::remove_dir(state_path.parent().unwrap()).unwrap();
        fs::remove_dir(&test_dir).unwrap();
    }
}

#[cfg(test)]
mod project_move_prepare_tests {
    use super::*;

    fn manager() -> DesktopStateManager {
        let identity = format!("local:{}", codex_home_dir().to_string_lossy());
        let state = json!({
            "app-server-project-id-by-legacy-project-id-by-host": {
                (identity): {"source":"server-source","target":"server-target"}
            },
            "thread-project-assignments": {
                "thread":{"projectKind":"local","projectId":"server-source"}
            },
            "electron-persisted-atom-state": {
                "local-projects": {
                    "source":{"id":"source","name":"Source","rootPaths":["D:/source","D:/extra"],"createdAt":1},
                    "target":{"id":"target","name":"Target","rootPaths":["D:/target"],"createdAt":2},
                    "unmapped":{"id":"unmapped","name":"Unmapped","rootPaths":["D:/unmapped"],"createdAt":3}
                },
                "thread-workspace-state-v1:thread":{
                    "revision":"r1","project":{"projectKind":"local","projectId":"server-source"},
                    "applied":{"cwd":"D:/source"},"pending":null
                }
            }
        });
        DesktopStateManager {
            state_map: Arc::new(Mutex::new(state.as_object().unwrap().clone())),
            workspace_turn_owners: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn live(method: &str, params: &Value) -> Value {
        match method {
            "thread/read" => json!({"thread":{
                "id":"thread","projectId":"server-source","cwd":"D:/source",
                "status":{"type":"idle"},"environments":[{"environmentId":"local"}]
            }}),
            "project/read" => {
                let id = params["projectId"].as_str().unwrap();
                let roots = if id == "server-source" { vec!["D:/source","D:/extra"] } else { vec!["D:/target"] };
                json!({"project":{"id":id,"roots":roots.into_iter().map(|path| json!({"path":path})).collect::<Vec<_>>()}})
            },
            _ => panic!("read-only prepare attempted {method}"),
        }
    }

    #[test]
    fn project_move_prepare_is_read_only_and_rejects_unknown_or_blank_targets() {
        let manager = manager();
        let before = manager.state_map.lock().unwrap().clone();
        let plan = manager.prepare_thread_project_move("thread", Some("target")).unwrap();
        assert_eq!(plan["missingSources"], json!(["D:/source","D:/extra"]));
        assert_eq!(plan["workspaceTarget"]["runtimeWorkspaceRoots"], json!(["D:/target"]));
        assert_eq!(plan["writesPerformed"], false);
        assert_eq!(plan["commitAvailable"], false);
        for target in ["unknown", "unmapped", "", "  "] {
            assert!(manager.prepare_thread_project_move("thread", Some(target)).is_err());
        }
        assert_eq!(*manager.state_map.lock().unwrap(), before);
    }

    #[test]
    fn project_move_prepare_accepts_only_explicitly_mapped_server_ids_or_legacy_ids() {
        let manager = manager();
        let server_id_plan = manager
            .prepare_thread_project_move("thread", Some("server-target"))
            .unwrap();
        let legacy_id_plan = manager
            .prepare_thread_project_move("thread", Some("target"))
            .unwrap();

        assert_eq!(server_id_plan["targetServerProjectId"], "server-target");
        assert_eq!(legacy_id_plan["targetServerProjectId"], "server-target");
        for target in ["unknown-server-project", "unmapped"] {
            assert!(manager.prepare_thread_project_move("thread", Some(target)).is_err());
        }
    }

    #[test]
    fn project_move_prepare_chats_preserves_workspace_and_membership_override_precedes_legacy() {
        let manager = manager();
        let plan = manager.prepare_thread_project_move("thread", None).unwrap();
        assert!(plan["workspaceTarget"].is_null());
        assert_eq!(plan["membershipProjectId"], "");
        assert_eq!(plan["workspaceState"]["applied"]["cwd"], "D:/source");
        manager.state_map.lock().unwrap().get_mut(PERSISTED_ATOM_STATE_KEY).unwrap()
            ["thread-workspace-state-v1:thread"]["projectMembership"] =
                json!({"projectKind":"remote","projectId":"remote","hostId":"host"});
        assert!(manager.prepare_thread_project_move("thread", Some("target")).is_err());
    }

    #[tokio::test]
    async fn project_move_live_prepare_reads_membership_and_both_projects_without_writing() {
        let manager = manager();
        let before = manager.state_map.lock().unwrap().clone();
        let mut requests = Vec::new();
        let plan = manager.prepare_thread_project_move_with_rpc("thread", Some("target"), |method, params| {
            requests.push((method.clone(), params.clone()));
            std::future::ready(Ok(live(&method, &params)))
        }).await.unwrap();
        assert_eq!(requests.iter().map(|(method, _)| method.as_str()).collect::<Vec<_>>(),
            ["thread/read","project/read","project/read"]);
        assert_eq!(plan["liveValidated"], true);
        assert_eq!(plan["commitAvailable"], false);
        assert_eq!(*manager.state_map.lock().unwrap(), before);
    }

    #[tokio::test]
    async fn project_move_prepare_resumes_unloaded_idle_thread_without_starting_a_turn() {
        let manager = manager();
        let before = manager.state_map.lock().unwrap().clone();
        let mut requests = Vec::new();
        let plan = manager.prepare_thread_project_move_with_rpc("thread", Some("target"), |method, params| {
            requests.push((method.clone(), params.clone()));
            let response = match method.as_str() {
                "thread/read" => json!({"thread":{
                    "id":"thread","projectId":"server-source","cwd":"D:/source",
                    "status":{"type":"notLoaded"},"environments":null
                }}),
                "thread/resume" => json!({"thread":live_thread(Some("server-source"))["thread"]}),
                "project/read" => {
                    let id = params["projectId"].as_str().unwrap();
                    if id == "server-source" {
                        project_read(id, &["D:/source","D:/extra"])
                    } else {
                        project_read(id, &["D:/target"])
                    }
                }
                _ => panic!("unexpected prepare request {method}"),
            };
            std::future::ready(Ok(response))
        }).await.unwrap();
        assert_eq!(requests.iter().map(|(method, _)| method.as_str()).collect::<Vec<_>>(),
            ["thread/read","thread/resume","project/read","project/read"]);
        assert_eq!(requests[1].1, json!({"threadId":"thread"}));
        assert_eq!(plan["liveValidated"], true);
        assert_eq!(plan["writesPerformed"], false);
        assert_eq!(*manager.state_map.lock().unwrap(), before);
    }

    #[tokio::test]
    async fn project_move_live_prepare_rejects_unknown_running_remote_and_stale_roots() {
        for invalid in [
            json!({"id":"other","projectId":"server-source","status":{"type":"idle"},"environments":[]}),
            json!({"id":"thread","projectId":"server-source","status":{"type":"active"},"environments":[]}),
            json!({"id":"thread","projectId":"server-source","status":{"type":"idle"},"environments":null}),
            json!({"id":"thread","projectId":"server-source","status":{"type":"idle"},"environments":[{"environmentId":"remote"}]}),
            json!({"id":"thread","projectId":"unknown","status":{"type":"idle"},"environments":[]}),
            json!({"id":"thread","status":{"type":"idle"},"environments":[]}),
        ] {
            let manager = manager();
            let before = manager.state_map.lock().unwrap().clone();
            assert!(manager.prepare_thread_project_move_with_rpc("thread", Some("target"), |method, _| {
                assert_eq!(method, "thread/read");
                std::future::ready(Ok(json!({"thread":invalid})))
            }).await.is_err());
            assert_eq!(*manager.state_map.lock().unwrap(), before);
        }
        let manager = manager();
        assert!(manager.prepare_thread_project_move_with_rpc("thread", Some("target"), |method, params| {
            let response = if method == "project/read" {
                json!({"project":{"id":params["projectId"],"roots":[{"path":"D:/changed"}]}})
            } else { live(&method, &params) };
            std::future::ready(Ok(response))
        }).await.is_err());
    }

    #[tokio::test]
    async fn project_move_live_prepare_detects_state_changes_during_reads() {
        let manager = manager();
        assert!(manager.prepare_thread_project_move_with_rpc("thread", Some("target"), |method, params| {
            if method == "project/read" {
                manager.state_map.lock().unwrap().get_mut(PERSISTED_ATOM_STATE_KEY).unwrap()
                    ["thread-workspace-state-v1:thread"]["revision"] = json!("changed");
            }
            std::future::ready(Ok(live(&method, &params)))
        }).await.is_err());
    }

    fn project_read(id: &str, roots: &[&str]) -> Value {
        json!({"project":{
            "id":id,
            "roots":roots.iter().map(|path| json!({"path":path})).collect::<Vec<_>>()
        }})
    }

    fn live_thread(project_id: Option<&str>) -> Value {
        json!({"thread":{
            "id":"thread","projectId":project_id,"cwd":"D:/source",
            "status":{"type":"idle"},"environments":[
                {"environmentId":"local","runtimeWorkspaceRoots":["D:/source","D:/extra"]}
            ]
        }})
    }

    fn test_state_path() -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!("codex-project-move-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        (directory.clone(), directory.join("state.json"))
    }

    fn cleanup_test_state(directory: &Path, state_path: &Path) {
        if state_path.exists() { fs::remove_file(state_path).unwrap(); }
        fs::remove_dir(directory).unwrap();
    }

    async fn get_target_plan(manager: &DesktopStateManager) -> Value {
        manager.prepare_thread_project_move_with_rpc("thread", Some("target"), |method, params| {
            let response = match method.as_str() {
                "thread/read" => live_thread(Some("server-source")),
                "project/read" if params["projectId"] == "server-source" => project_read("server-source", &["D:/source","D:/extra"]),
                "project/read" => project_read("server-target", &["D:/target"]),
                _ => panic!("unexpected prepare request {method}"),
            };
            std::future::ready(Ok(response))
        }).await.unwrap()
    }

    #[tokio::test]
    async fn project_move_commit_expands_roots_stages_then_reads_back_membership() {
        let manager = manager();
        let plan = get_target_plan(&manager).await;
        let (directory, state_path) = test_state_path();
        let mut methods = Vec::new();
        let mut roots_expanded = false;
        manager.commit_thread_project_move_with_rpc(
            "thread", Some("target"), &plan, true, &state_path,
            |method, params| {
                methods.push(method.clone());
                let response = match method.as_str() {
                    "thread/read" => {
                        if methods.iter().filter(|method| method.as_str() == "thread/read").count() > 1 {
                            live_thread(Some("server-target"))
                        } else { live_thread(Some("server-source")) }
                    }
                    "project/read" if params["projectId"] == "server-source" => project_read("server-source", &["D:/source","D:/extra"]),
                    "project/read" if roots_expanded => project_read("server-target", &["D:/target","D:/source","D:/extra"]),
                    "project/read" => project_read("server-target", &["D:/target"]),
                    "project/update" => {
                        roots_expanded = true;
                        assert_eq!(params["roots"], json!([
                            {"path":"D:/target"},{"path":"D:/source"},{"path":"D:/extra"}
                        ]));
                        json!({})
                    }
                    "thread/metadata/update" => {
                        assert_eq!(params["threadId"], "thread");
                        assert_eq!(params["projectId"], "server-target");
                        json!({})
                    }
                    _ => panic!("unexpected commit request {method}"),
                };
                std::future::ready(Ok(response))
            },
        ).await.unwrap();
        assert!(roots_expanded);
        assert_eq!(methods.iter().filter(|method| method.as_str() == "project/update").count(), 1);
        assert_eq!(methods.iter().filter(|method| method.as_str() == "thread/metadata/update").count(), 1);
        let state: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
        let workspace = &state[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:thread"];
        assert_eq!(workspace["project"]["projectId"], "server-target");
        assert_eq!(workspace["projectMembership"]["projectId"], "server-target");
        assert_eq!(workspace["pending"]["cwd"], "D:/target");
        assert!(state["thread-project-move-recovery"]["thread"].is_null());
        assert_eq!(state["thread-project-assignments"]["thread"]["projectId"], "server-target");
        cleanup_test_state(&directory, &state_path);
    }

    #[tokio::test]
    async fn project_move_commit_to_chats_clears_membership_and_pending_but_keeps_applied() {
        let manager = manager();
        {
            let mut state = manager.state_map.lock().unwrap();
            state[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:thread"] = json!({
                "revision":"old",
                "project":{"projectKind":"local","projectId":"server-source"},
                "applied":{
                    "cwd":"D:/source","projectSources":["D:/source","D:/extra"],
                    "runtimeWorkspaceRoots":["D:/source","D:/extra"]
                },
                "pending":{
                    "cwd":"D:/pending","projectSources":["D:/pending"],
                    "runtimeWorkspaceRoots":["D:/pending"]
                }
            });
        }
        let plan = manager.prepare_thread_project_move_with_rpc(
            "thread", None, |method, params| {
                let response = match method.as_str() {
                    "thread/read" => live_thread(Some("server-source")),
                    "project/read" if params["projectId"] == "server-source" =>
                        project_read("server-source", &["D:/source","D:/extra"]),
                    _ => panic!("unexpected Chats prepare request {method}"),
                };
                std::future::ready(Ok(response))
            },
        ).await.unwrap();
        let (directory, state_path) = test_state_path();
        let mut requests = Vec::new();
        manager.commit_thread_project_move_with_rpc(
            "thread", None, &plan, false, &state_path,
            |method, params| {
                requests.push((method.clone(), params.clone()));
                let response = match method.as_str() {
                    "thread/read" if requests.len() == 1 => live_thread(Some("server-source")),
                    "thread/read" => live_thread(None),
                    "project/read" if params["projectId"] == "server-source" =>
                        project_read("server-source", &["D:/source","D:/extra"]),
                    "thread/metadata/update" => {
                        assert_eq!(params["projectId"], "");
                        json!({})
                    }
                    _ => panic!("unexpected Chats commit request {method}"),
                };
                std::future::ready(Ok(response))
            },
        ).await.unwrap();
        assert_eq!(
            requests.iter().map(|(method, _)| method.as_str()).collect::<Vec<_>>(),
            ["thread/read", "project/read", "thread/metadata/update", "thread/read"]
        );
        let saved: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
        let workspace = &saved[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:thread"];
        assert_eq!(workspace["project"], Value::Null);
        assert_eq!(workspace["pending"], Value::Null);
        assert_eq!(workspace["applied"]["cwd"], "D:/source");
        assert_eq!(saved["thread-project-assignments"]["thread"], Value::Null);
        assert!(saved["projectless-thread-ids"].as_array().unwrap().contains(&json!("thread")));
        assert_eq!(manager.sidebar_project_membership()["projectlessThreadIds"], json!(["thread"]));
        cleanup_test_state(&directory, &state_path);
    }

    #[tokio::test]
    async fn project_move_owner_blocks_a_concurrent_turn_for_the_same_thread() {
        let manager = manager();
        let plan = get_target_plan(&manager).await;
        let (directory, state_path) = test_state_path();
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let moving = {
            let manager = manager.clone();
            let moving_state_path = state_path.clone();
            tokio::spawn(async move {
                let mut entered_tx = Some(entered_tx);
                let mut release_rx = Some(release_rx);
                manager.commit_thread_project_move_with_rpc(
                    "thread", Some("target"), &plan, true, &moving_state_path,
                    |method, _| {
                        let entered = entered_tx.take();
                        let release = release_rx.take();
                        async move {
                            if let Some(entered) = entered {
                                let _ = entered.send(());
                                let _ = release.unwrap().await;
                            }
                            Err(format!("stop after {method}"))
                        }
                    },
                ).await
            })
        };
        entered_rx.await.unwrap();
        let turn = manager.call_turn_with_workspace_at_path(
            json!({"threadId":"thread"}),
            &directory.join("other.json"),
            |_, _| std::future::ready(Ok(Value::Null)),
        ).await.unwrap_err();
        assert!(turn.contains("正在移动"), "{turn}");
        release_tx.send(()).unwrap();
        let move_error = moving.await.unwrap().unwrap_err();
        assert!(move_error.contains("stop after thread/read"), "{move_error}");
        cleanup_test_state(&directory, &state_path);
    }

    #[tokio::test]
    async fn project_move_commit_requires_permission_confirmation_before_any_write() {
        let manager = manager();
        let plan = get_target_plan(&manager).await;
        let before = manager.state_map.lock().unwrap().clone();
        let (directory, state_path) = test_state_path();
        let mut methods = Vec::new();
        let error = manager.commit_thread_project_move_with_rpc(
            "thread", Some("target"), &plan, false, &state_path,
            |method, params| {
                methods.push(method.clone());
                let response = match method.as_str() {
                    "thread/read" => live_thread(Some("server-source")),
                    "project/read" if params["projectId"] == "server-source" => project_read("server-source", &["D:/source","D:/extra"]),
                    "project/read" => project_read("server-target", &["D:/target"]),
                    _ => panic!("confirmation failure must not write ({method})"),
                };
                std::future::ready(Ok(response))
            },
        ).await.unwrap_err();
        assert!(error.contains("尚未获得确认"));
        assert!(!methods.iter().any(|method| method.ends_with("/update")));
        assert!(!state_path.exists());
        assert_eq!(*manager.state_map.lock().unwrap(), before);
        cleanup_test_state(&directory, &state_path);
    }

    #[tokio::test]
    async fn project_move_commit_rolls_back_when_membership_remains_at_source() {
        let manager = manager();
        let plan = get_target_plan(&manager).await;
        let (directory, state_path) = test_state_path();
        let mut roots_expanded = false;
        let result = manager.commit_thread_project_move_with_rpc(
            "thread", Some("target"), &plan, true, &state_path,
            |method, params| {
                let response = match method.as_str() {
                    "thread/read" => live_thread(Some("server-source")),
                    "project/read" if params["projectId"] == "server-source" => project_read("server-source", &["D:/source","D:/extra"]),
                    "project/read" if roots_expanded => project_read("server-target", &["D:/target","D:/source","D:/extra"]),
                    "project/read" => project_read("server-target", &["D:/target"]),
                    "project/update" => { roots_expanded = true; json!({}) }
                    "thread/metadata/update" => json!({"error":"rejected"}),
                    _ => panic!("unexpected commit request {method}"),
                };
                if method == "thread/metadata/update" {
                    std::future::ready(Err("membership rejected".into()))
                } else {
                    std::future::ready(Ok(response))
                }
            },
        ).await.unwrap_err();
        assert_eq!(result, "membership rejected");
        assert!(roots_expanded, "official order retains already accepted target roots");
        let persisted: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
        assert_eq!(persisted[PERSISTED_ATOM_STATE_KEY]["thread-workspace-state-v1:thread"]["project"]["projectId"], "server-source");
        assert!(persisted["thread-project-move-recovery"]["thread"].is_null());
        assert_eq!(persisted["thread-project-assignments"]["thread"]["projectId"], "server-source");
        cleanup_test_state(&directory, &state_path);
    }

    #[tokio::test]
    async fn project_move_commit_preserves_recovery_record_and_blocks_sends_when_readback_is_unknown() {
        let manager = manager();
        let plan = get_target_plan(&manager).await;
        let (directory, state_path) = test_state_path();
        let mut thread_reads = 0;
        let mut roots_expanded = false;
        let error = manager.commit_thread_project_move_with_rpc(
            "thread", Some("target"), &plan, true, &state_path,
            |method, params| {
                let result = match method.as_str() {
                    "thread/read" if params["threadId"] == "thread" => {
                        // The first thread/read is preflight; the second is ambiguous commit readback.
                        thread_reads += 1;
                        if thread_reads == 1 { Ok(live_thread(Some("server-source"))) }
                        else { Err("readback unavailable".into()) }
                    }
                    "project/read" if params["projectId"] == "server-source" => Ok(project_read("server-source", &["D:/source","D:/extra"])),
                    "project/read" if roots_expanded => Ok(project_read("server-target", &["D:/target","D:/source","D:/extra"])),
                    "project/read" => Ok(project_read("server-target", &["D:/target"])),
                    "project/update" => { roots_expanded = true; Err("response lost after write".into()) }
                    "thread/metadata/update" => Err("response lost".into()),
                    _ => panic!("unexpected request {method}"),
                };
                std::future::ready(result)
            },
        ).await.unwrap_err();
        assert!(error.contains("阻止发送"));
        assert!(manager.state_map.lock().unwrap()["thread-project-move-recovery"]["thread"].is_object());
        assert!(fs::read_to_string(&state_path).unwrap().contains("thread-project-move-recovery"));
        let reconciled = manager.reconcile_thread_project_move_with_rpc(
            "thread", &state_path, |method, _| {
                assert_eq!(method, "thread/read");
                std::future::ready(Ok(live_thread(Some("server-target"))))
            },
        ).await.unwrap();
        assert_eq!(reconciled["membership"], "target");
        assert!(manager.state_map.lock().unwrap()["thread-project-move-recovery"]["thread"].is_null());
        let turn = manager.call_turn_with_workspace_at_path(
            json!({"threadId":"thread"}),
            &directory.join("other.json"),
            |method, _| {
                assert_eq!(method, "thread/read", "reconciliation should unblock send preflight");
                std::future::ready(Ok(live_thread(Some("server-target"))))
            },
        ).await.unwrap_err();
        assert!(turn.contains("权限设置"), "{turn}");
        cleanup_test_state(&directory, &state_path);
    }
}

#[cfg(test)]
mod thread_archive_atomic_tests {
    use super::*;

    #[test]
    fn concurrent_archive_updates_hold_the_state_lock_through_persistence() {
        let manager = DesktopStateManager {
            state_map: Arc::new(Mutex::new(json!({"unrelated":"keep"}).as_object().unwrap().clone())),
            workspace_turn_owners: Arc::new(Mutex::new(HashMap::new())),
        };
        let directory = std::env::temp_dir().join(format!("codex-archive-atomic-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("state.json");
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let workers: Vec<_> = ["first", "second"].into_iter().map(|id| {
                let manager = &manager;
                let path = &path;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    manager.update_archived_thread_with(json!({"id":id}), true, |map| {
                        assert!(manager.state_map.try_lock().is_err(), "archive read/merge/persist must hold the same state lock");
                        fs::write(path, serde_json::to_vec(map).unwrap()).unwrap();
                    });
                })
            }).collect();
            for worker in workers { worker.join().unwrap(); }
        });
        let mut ids: Vec<_> = manager.list_archived_threads().iter().map(|item| item["id"].as_str().unwrap().to_owned()).collect();
        ids.sort();
        assert_eq!(ids, vec!["first", "second"]);
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk["unrelated"], "keep");
        assert_eq!(disk[ARCHIVED_THREADS_KEY], json!(manager.list_archived_threads()));
        std::thread::scope(|scope| {
            let remove = scope.spawn(|| manager.update_archived_thread_with(json!({"id":"first"}), false,
                |map| fs::write(&path, serde_json::to_vec(map).unwrap()).unwrap()));
            let add = scope.spawn(|| manager.update_archived_thread_with(json!({"id":"third"}), true,
                |map| fs::write(&path, serde_json::to_vec(map).unwrap()).unwrap()));
            remove.join().unwrap(); add.join().unwrap();
        });
        let mut ids: Vec<_> = manager.list_archived_threads().iter().map(|item| item["id"].as_str().unwrap().to_owned()).collect();
        ids.sort();
        assert_eq!(ids, vec!["second", "third"]);
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk[ARCHIVED_THREADS_KEY], json!(manager.list_archived_threads()));
        fs::remove_file(path).unwrap(); fs::remove_dir(directory).unwrap();
    }
}
