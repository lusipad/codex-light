use serde::Deserialize;
use serde_json::{json, Value};

pub(crate) struct PreparedTurn {
    pub params: Value,
    pub commit: Option<WorkspaceCommit>,
}

pub(crate) struct WorkspaceCommit {
    pub revision: String,
    pub snapshot: Value,
    pub writable_roots: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    cwd: String,
    project_sources: Vec<String>,
    runtime_workspace_roots: Vec<String>,
}

// These are execution paths, so do not resolve them against the desktop process cwd.
fn path_family(path: &str) -> Option<bool> {
    let bytes = path.as_bytes();
    if (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\'))
        || path.starts_with("\\\\")
        || path.starts_with("//")
    {
        Some(true)
    } else if path.starts_with('/') {
        Some(false)
    } else {
        None
    }
}

fn path_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let normalized = normalized
        .strip_prefix("//?/UNC/")
        .map(|unc| format!("//{unc}"))
        .or_else(|| normalized.strip_prefix("//?/").map(str::to_owned))
        .unwrap_or(normalized)
        .trim_end_matches('/')
        .to_owned();
    if path_family(path) == Some(true) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn unique_paths(paths: impl IntoIterator<Item = String>, family: Option<bool>) -> Vec<String> {
    let mut result = Vec::<String>::new();
    for path in paths {
        if family.is_some()
            && path_family(&path) == family
            && !result
                .iter()
                .any(|existing| path_key(existing) == path_key(&path))
        {
            result.push(path);
        }
    }
    result
}

fn string_paths(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn absolute_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.strip_prefix("//?/").unwrap_or(&normalized);
    if path_family(path).is_none() {
        return false;
    }
    if let Some(unc) = normalized.strip_prefix("//") {
        let mut components = unc.split('/').filter(|part| !part.is_empty());
        components.next().is_some() && components.next().is_some()
    } else if let Some(unc) = normalized.strip_prefix("UNC/") {
        let mut components = unc.split('/').filter(|part| !part.is_empty());
        components.next().is_some() && components.next().is_some()
    } else {
        path_family(normalized).is_some()
    }
}

fn path_contains(parent: &str, child: &str) -> bool {
    if !absolute_path(parent) || !absolute_path(child) || path_family(parent) != path_family(child)
    {
        return false;
    }
    let parent = path_key(parent);
    let child = path_key(child);
    child == parent
        || child
            .strip_prefix(&parent)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

pub(crate) fn missing_project_sources(source: &[String], target: &[String]) -> Vec<String> {
    source
        .iter()
        .filter(|source| !target.iter().any(|target| path_contains(target, source)))
        .cloned()
        .collect()
}

pub(crate) fn project_target(
    sources: &[String],
    worktree: Option<(&str, &str)>,
) -> Result<Value, String> {
    let first = sources
        .first()
        .ok_or("目标项目没有文件夹，无法移动会话。")?;
    let family = path_family(first);
    if sources
        .iter()
        .any(|source| !absolute_path(source) || path_family(source) != family)
    {
        return Err("目标项目包含无效或不兼容的绝对路径，无法移动会话。".to_string());
    }
    let mut runtime_roots = sources.to_vec();
    let cwd = if let Some((source_root, worktree_root)) = worktree {
        if !absolute_path(source_root)
            || !absolute_path(worktree_root)
            || path_family(source_root) != family
            || path_family(worktree_root) != family
        {
            return Err("无法确认 worktree 的绝对路径，无法移动会话。".to_string());
        }
        let slot = sources
            .iter()
            .enumerate()
            .filter(|(_, source)| path_contains(source, source_root))
            .max_by_key(|(_, source)| path_key(source).len())
            .map(|(index, _)| index)
            .unwrap_or(0);
        runtime_roots[slot] = worktree_root.to_string();
        worktree_root
    } else {
        first
    };
    Ok(json!({"cwd":cwd,"projectSources":sources,"runtimeWorkspaceRoots":runtime_roots}))
}

pub(crate) fn stage_project_move(
    previous: &Value,
    project: &Value,
    fallback: &Value,
    target: &Value,
    revision: &str,
) -> Value {
    let applied = if project.is_null() || previous["applied"].is_null() {
        if project.is_null() {
            previous["applied"].clone()
        } else {
            fallback.clone()
        }
    } else if serde_json::from_value::<WorkspaceSnapshot>(previous["applied"].clone()).is_ok() {
        previous["applied"].clone()
    } else {
        fallback.clone()
    };
    json!({
        "revision":revision,
        "project":project,
        "applied":applied,
        "pending":if project.is_null() { &Value::Null } else { target }
    })
}

pub(crate) fn rollback_project_move(
    current: &Value,
    failed_revision: &str,
    previous: &Value,
) -> Value {
    if current["revision"].as_str() != Some(failed_revision) {
        return current.clone();
    }
    if !previous.is_null()
        && !current["applied"].is_null()
        && current["applied"] != previous["applied"]
    {
        let mut restored = previous.clone();
        restored["applied"] = current["applied"].clone();
        restored["pending"] =
            if previous["pending"].is_null() || previous["pending"] == current["applied"] {
                Value::Null
            } else {
                previous["pending"].clone()
            };
        restored
    } else {
        previous.clone()
    }
}

pub(crate) fn prepare_runtime_turn(
    state: &Value,
    retained: &Value,
    mut params: Value,
    current: &Value,
    resumed: bool,
) -> Result<PreparedTurn, String> {
    let environments = if params["environments"].is_null() {
        &current["thread"]["environments"]
    } else {
        &params["environments"]
    };
    let environments = environments
        .as_array()
        .ok_or("无法确认会话当前的执行环境，工作区状态已保留，本次没有发送。")?;
    if environments
        .first()
        .is_some_and(|environment| environment["environmentId"] != "local")
    {
        return Ok(PreparedTurn {
            params,
            commit: None,
        });
    }
    let explicit_cwd = params["cwd"]
        .as_str()
        .or_else(|| params["environments"][0]["cwd"].as_str())
        .map(str::to_owned);
    let environment = environments.first().cloned().unwrap_or(Value::Null);
    if !environments.is_empty() {
        params["environments"] = json!(environments);
    }
    if params["sandboxPolicy"].is_null()
        && params["permissions"].is_null()
        && current["activePermissionProfile"].is_null()
        && !current["sandbox"].is_null()
    {
        params["sandboxPolicy"] = current["sandbox"].clone();
    }
    let mut effective_retained = retained.clone();
    if resumed && explicit_cwd.is_none() && !state["applied"].is_null() {
        // Resume without overrides first: an unloaded thread may have a sticky
        // remote environment. Only a confirmed local host can restore applied.
        let old_paths = string_paths(&environment["runtimeWorkspaceRoots"])
            .into_iter()
            .chain(current["thread"]["cwd"].as_str().map(str::to_owned))
            .collect();
        effective_retained = json!(apply_snapshot(
            &mut params,
            &state["applied"],
            old_paths,
            retained
        )?);
    } else {
        let cwd = explicit_cwd
            .as_deref()
            .or_else(|| current["thread"]["cwd"].as_str())
            .or_else(|| state["applied"]["cwd"].as_str());
        let roots = if !params["runtimeWorkspaceRoots"].is_null() {
            params["runtimeWorkspaceRoots"].clone()
        } else if !params["environments"][0]["runtimeWorkspaceRoots"].is_null() {
            params["environments"][0]["runtimeWorkspaceRoots"].clone()
        } else {
            current["runtimeWorkspaceRoots"].clone()
        };
        if let Some(cwd) = cwd.map(str::to_owned) {
            if params["environments"]
                .as_array()
                .is_some_and(|items| !items.is_empty())
            {
                params["environments"][0]["cwd"] = json!(cwd);
                if !roots.is_null() {
                    params["environments"][0]["runtimeWorkspaceRoots"] = roots.clone();
                }
                params["cwd"] = Value::Null;
                params["runtimeWorkspaceRoots"] = Value::Null;
            } else {
                params["cwd"] = json!(cwd);
                if !roots.is_null() {
                    params["runtimeWorkspaceRoots"] = roots.clone();
                }
            }
            if params["sandboxPolicy"]["type"] == "workspaceWrite" {
                let roots = unique_paths(
                    [
                        string_paths(&params["sandboxPolicy"]["writableRoots"]),
                        string_paths(retained),
                        string_paths(&roots),
                    ]
                    .concat(),
                    path_family(&cwd),
                );
                params["sandboxPolicy"]["writableRoots"] = json!(roots);
            }
        }
    }
    prepare_turn(state, &effective_retained, params)
}

pub(crate) fn prepare_turn(
    state: &Value,
    retained: &Value,
    mut params: Value,
) -> Result<PreparedTurn, String> {
    let pending = &state["pending"];
    let environment = params["environments"]
        .as_array()
        .and_then(|items| items.first());
    let non_local_environment = environment.is_some_and(|item| item["environmentId"] != "local");
    if pending.is_null()
        || state["project"]["projectKind"] != "local"
        || state["project"]
            .get("projectOrigin")
            .is_some_and(|origin| !origin.is_null())
        || non_local_environment
    {
        return Ok(PreparedTurn {
            params,
            commit: None,
        });
    }
    let invalid = || "会话的待迁移工作区无效，请先检查项目目录；本次没有发送。".to_string();
    let revision = state["revision"]
        .as_str()
        .filter(|revision| !revision.is_empty())
        .ok_or_else(invalid)?;
    let old_paths = if state["applied"].is_null() {
        string_paths(&params["environments"][0]["runtimeWorkspaceRoots"])
            .into_iter()
            .chain(params["environments"][0]["cwd"].as_str().map(str::to_owned))
            .chain(string_paths(&params["runtimeWorkspaceRoots"]))
            .chain(params["cwd"].as_str().map(str::to_owned))
            .collect()
    } else {
        let applied: WorkspaceSnapshot =
            serde_json::from_value(state["applied"].clone()).map_err(|_| invalid())?;
        [applied.runtime_workspace_roots, applied.project_sources].concat()
    };
    let writable_roots = apply_snapshot(&mut params, pending, old_paths, retained)?;
    Ok(PreparedTurn {
        params,
        commit: Some(WorkspaceCommit {
            revision: revision.to_owned(),
            snapshot: pending.clone(),
            writable_roots,
        }),
    })
}

fn apply_snapshot(
    params: &mut Value,
    snapshot: &Value,
    old_paths: Vec<String>,
    retained: &Value,
) -> Result<Vec<String>, String> {
    let invalid = || "会话的工作区快照无效，请先检查项目目录；本次没有发送。".to_string();
    let target: WorkspaceSnapshot =
        serde_json::from_value(snapshot.clone()).map_err(|_| invalid())?;
    let family = path_family(&target.cwd);
    if family.is_none()
        || target.runtime_workspace_roots.is_empty()
        || target
            .runtime_workspace_roots
            .iter()
            .chain(&target.project_sources)
            .any(|root| path_family(root) != family)
    {
        return Err(invalid());
    }
    let old_keys: Vec<String> = old_paths.iter().map(|path| path_key(path)).collect();
    let policy = &params["sandboxPolicy"];
    // A missing sandbox is an inherited permission selection we cannot reconstruct
    // here. Explicit profiles remain authoritative and receive only runtime roots.
    if policy.is_null() && params["permissions"].is_null() {
        return Err("待迁移会话缺少明确的权限设置，本次没有发送。".to_string());
    }
    let retained_paths = unique_paths(string_paths(retained), family);
    let baseline = if policy["type"] == "workspaceWrite" {
        [string_paths(&policy["writableRoots"]), retained_paths].concat()
    } else {
        retained_paths
    };
    let writable_roots = unique_paths(
        baseline
            .into_iter()
            .filter(|path| !old_keys.contains(&path_key(path)))
            .chain(target.runtime_workspace_roots.iter().cloned()),
        family,
    );
    if params["sandboxPolicy"]["type"] == "workspaceWrite" {
        params["sandboxPolicy"]["writableRoots"] = json!(writable_roots);
    }
    if params["environments"]
        .as_array()
        .is_some_and(|items| !items.is_empty())
    {
        params["environments"][0]["cwd"] = json!(target.cwd);
        params["environments"][0]["runtimeWorkspaceRoots"] = json!(target.runtime_workspace_roots);
        params["cwd"] = Value::Null;
        params["runtimeWorkspaceRoots"] = Value::Null;
    } else {
        params["cwd"] = json!(target.cwd);
        params["runtimeWorkspaceRoots"] = json!(target.runtime_workspace_roots);
    }
    Ok(writable_roots)
}

pub(crate) fn apply_accepted(state: &mut Value, commit: &WorkspaceCommit) {
    if let Some(state) = state.as_object_mut() {
        state.insert("applied".to_string(), commit.snapshot.clone());
        if state.get("revision").and_then(Value::as_str) == Some(&commit.revision) {
            state.insert("pending".to_string(), Value::Null);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_move_missing_sources_preserve_strings_and_ancestor_boundaries() {
        let sources = [
            "D:\\项目\\Src",
            "d:/foobar",
            "/Work/文档",
            "/work/file",
            "relative",
        ]
        .map(str::to_owned);
        let targets = ["d:/项目/", "D:/foo", "/Work", "/"].map(str::to_owned);
        assert_eq!(
            missing_project_sources(&sources, &targets),
            vec!["d:/foobar", "relative"]
        );
        assert_eq!(
            missing_project_sources(&sources[2..4], &["/work".into()]),
            vec!["/Work/文档"]
        );
        assert_eq!(
            missing_project_sources(&["D:/foo".into()], &["D:/foobar".into()]),
            vec!["D:/foo"]
        );
        assert_eq!(
            missing_project_sources(&["D:/foobar".into()], &["D:/".into()]),
            Vec::<String>::new()
        );
        assert_eq!(
            missing_project_sources(&["D:\\Ä\\文档".into()], &["d:/ä/文档/".into()]),
            Vec::<String>::new()
        );
        assert_eq!(
            missing_project_sources(
                &["\\\\Server\\Share\\目录".into()],
                &["//server/share".into()]
            ),
            Vec::<String>::new()
        );
        assert_eq!(
            missing_project_sources(
                &["//?/UNC/Server/Share/目录".into()],
                &["//server/share".into()]
            ),
            Vec::<String>::new()
        );
        assert_eq!(
            missing_project_sources(
                &["D:/foo".into()],
                &["relative".into(), "//".into(), "D:".into()]
            ),
            vec!["D:/foo"]
        );
    }

    #[test]
    fn project_move_target_preserves_canonical_sources_and_maps_deepest_worktree_root() {
        let sources = ["D:/repo", "D:/repo/sub", "D:/other"].map(str::to_owned);
        assert_eq!(
            project_target(&sources, None).unwrap(),
            json!({
                "cwd":"D:/repo","projectSources":sources,"runtimeWorkspaceRoots":sources
            })
        );
        assert_eq!(
            project_target(&sources, Some(("d:\\REPO\\sub\\nested", "D:/trees/sub"))).unwrap(),
            json!({
                "cwd":"D:/trees/sub","projectSources":sources,
                "runtimeWorkspaceRoots":["D:/repo","D:/trees/sub","D:/other"]
            })
        );
        assert_eq!(
            project_target(&sources, Some(("D:/unmatched", "D:/tree"))).unwrap()
                ["runtimeWorkspaceRoots"],
            json!(["D:/tree", "D:/repo/sub", "D:/other"])
        );
        for sources in [
            vec![],
            vec!["relative".into()],
            vec!["//".into()],
            vec!["D:relative".into()],
            vec!["D:/repo".into(), "/other".into()],
        ] {
            assert!(project_target(&sources, None).is_err());
        }
        let unicode = vec!["/项目/根".into(), "/项目/根/嵌套".into(), "/另外".into()];
        assert_eq!(
            project_target(&unicode, Some(("/项目/根/嵌套/文件", "/树/嵌套"))).unwrap(),
            json!({"cwd":"/树/嵌套","projectSources":unicode,"runtimeWorkspaceRoots":["/项目/根","/树/嵌套","/另外"]})
        );
        assert!(project_target(&sources, Some(("relative", "D:/tree"))).is_err());
        assert!(project_target(&sources, Some(("D:/repo", "/tree"))).is_err());
    }

    #[test]
    fn project_move_stage_chats_keeps_applied_and_clears_membership_override() {
        let previous = json!({
            "revision":"old","project":{"projectId":"old"},"applied":{"cwd":"D:/old"},
            "pending":{"cwd":"D:/pending"},"projectMembership":{"projectId":"override"},
            "projectMembershipRevision":"membership-old"
        });
        assert_eq!(
            stage_project_move(
                &previous,
                &Value::Null,
                &json!({"cwd":"D:/fallback"}),
                &Value::Null,
                "new"
            ),
            json!({"revision":"new","project":null,"applied":{"cwd":"D:/old"},"pending":null})
        );
        let target = json!({"cwd":"D:/new"});
        assert_eq!(
            stage_project_move(
                &Value::Null,
                &json!({"projectId":"new"}),
                &json!({"cwd":"D:/fallback"}),
                &target,
                "new"
            ),
            json!({"revision":"new","project":{"projectId":"new"},"applied":{"cwd":"D:/fallback"},"pending":target})
        );
        assert_eq!(
            stage_project_move(&Value::Null, &Value::Null, &Value::Null, &target, "chats"),
            json!({"revision":"chats","project":null,"applied":null,"pending":null})
        );
        let fallback = json!({
            "cwd":"D:/old","projectSources":["D:/old"],
            "runtimeWorkspaceRoots":["D:/old"]
        });
        assert_eq!(
            stage_project_move(
                &previous,
                &json!({"projectKind":"local","projectId":"new"}),
                &fallback,
                &target,
                "new"
            )["applied"],
            fallback,
            "an incomplete legacy applied snapshot must use the live fallback"
        );
    }

    #[test]
    fn project_move_rollback_respects_revision_and_concurrent_applied() {
        let applied = json!({"cwd":"D:/accepted"});
        let previous = json!({"revision":"old","project":{"projectId":"old"},"applied":{"cwd":"D:/old"},"pending":{"cwd":"D:/pending"}});
        let current = json!({"revision":"failed","project":{"projectId":"new"},"applied":{"cwd":"D:/old"},"pending":{"cwd":"D:/new"}});
        assert_eq!(
            rollback_project_move(&current, "failed", &previous),
            previous
        );
        assert_eq!(
            rollback_project_move(&current, "different", &previous),
            current
        );
        assert_eq!(
            rollback_project_move(&Value::Null, "failed", &previous),
            Value::Null
        );
        assert_eq!(
            rollback_project_move(&current, "failed", &Value::Null),
            Value::Null
        );
        let mut changed = current.clone();
        changed["applied"] = applied.clone();
        let mut expected = previous.clone();
        expected["applied"] = applied.clone();
        assert_eq!(
            rollback_project_move(&changed, "failed", &previous),
            expected
        );
        for pending in [Value::Null, applied] {
            let mut previous = previous.clone();
            previous["pending"] = pending;
            expected["pending"] = Value::Null;
            assert_eq!(
                rollback_project_move(&changed, "failed", &previous),
                expected
            );
        }
        changed["applied"] = Value::Null;
        assert_eq!(
            rollback_project_move(&changed, "failed", &previous),
            previous
        );
    }

    fn snapshot(cwd: &str, roots: &[&str]) -> Value {
        json!({"cwd":cwd,"projectSources":[cwd],"runtimeWorkspaceRoots":roots})
    }

    fn state() -> Value {
        json!({
            "revision":"move-1","project":{"projectKind":"local","projectId":"p2"},
            "applied":snapshot("D:/old", &["D:/old", "D:/old-second"]),
            "pending":{
                "cwd":"D:/worktree","projectSources":["D:/project","D:/project-second"],
                "runtimeWorkspaceRoots":["D:/worktree","D:/project-second"]
            }
        })
    }

    fn local_context() -> Value {
        json!({"thread":{"cwd":"D:/live","status":{"type":"idle"},"environments":[
            {"environmentId":"local","cwd":"D:/cached","runtimeWorkspaceRoots":["D:/live","D:/second"]},
            {"environmentId":"secondary","cwd":"/keep"}
        ]},"sandbox":{"type":"readOnly","networkAccess":false}})
    }

    #[test]
    fn loaded_workspace_prefers_live_cwd_over_cached_environment_and_applied() {
        let mut state = state();
        state["pending"] = Value::Null;
        let prepared = prepare_runtime_turn(&state, &json!(["D:/retained"]),
            json!({"sandboxPolicy":{"type":"workspaceWrite","networkAccess":true,"writableRoots":["D:/extra"]}}),
            &local_context(), false).unwrap();
        assert_eq!(prepared.params["environments"][0]["cwd"], "D:/live");
        assert_eq!(prepared.params["environments"][1]["cwd"], "/keep");
        assert_eq!(prepared.params["cwd"], Value::Null);
        assert_eq!(
            prepared.params["sandboxPolicy"]["writableRoots"],
            json!(["D:/extra", "D:/retained", "D:/live", "D:/second"])
        );
        assert_eq!(prepared.params["sandboxPolicy"]["networkAccess"], true);
        assert!(prepared.commit.is_none());
    }

    #[test]
    fn cold_workspace_restores_applied_then_pending_without_old_root_leaks() {
        let mut context = local_context();
        context["thread"]["environments"][0]["runtimeWorkspaceRoots"] = json!(["D:/live"]);
        let prepared = prepare_runtime_turn(&state(), &json!(["D:/live","D:/retained"]),
            json!({"sandboxPolicy":{"type":"workspaceWrite","writableRoots":["D:/live","D:/extra"]}}),
            &context, true).unwrap();
        assert_eq!(prepared.params["environments"][0]["cwd"], "D:/worktree");
        assert_eq!(
            prepared.params["sandboxPolicy"]["writableRoots"],
            json!([
                "D:/extra",
                "D:/retained",
                "D:/worktree",
                "D:/project-second"
            ])
        );
        assert_eq!(prepared.commit.unwrap().snapshot, state()["pending"]);
    }

    #[test]
    fn first_workspace_transition_removes_source_roots_from_local_environment() {
        let mut workspace = state();
        workspace["applied"] = Value::Null;
        let prepared = prepare_runtime_turn(
            &workspace,
            &json!(["D:/live", "D:/second", "D:/extra"]),
            json!({"sandboxPolicy":{"type":"workspaceWrite"}}),
            &local_context(),
            false,
        )
        .unwrap();
        assert_eq!(
            prepared.params["sandboxPolicy"]["writableRoots"],
            json!(["D:/extra", "D:/worktree", "D:/project-second"])
        );
    }

    #[test]
    fn explicit_workspace_intent_overrides_cold_applied_but_not_pending() {
        let mut workspace = state();
        workspace["pending"] = Value::Null;
        for intent in [
            json!({"cwd":"D:/explicit","runtimeWorkspaceRoots":["D:/explicit","D:/extra"]}),
            json!({"environments":[{"environmentId":"local","cwd":"D:/explicit","runtimeWorkspaceRoots":["D:/explicit","D:/extra"]}]}),
        ] {
            let prepared = prepare_runtime_turn(
                &workspace,
                &json!([]),
                intent.clone(),
                &local_context(),
                true,
            )
            .unwrap();
            assert_eq!(prepared.params["environments"][0]["cwd"], "D:/explicit");
            assert_eq!(
                prepared.params["environments"][0]["runtimeWorkspaceRoots"],
                json!(["D:/explicit", "D:/extra"])
            );
            assert_eq!(prepared.params["sandboxPolicy"]["type"], "readOnly");
            assert!(prepared.commit.is_none());
            workspace["pending"] = state()["pending"].clone();
            let prepared =
                prepare_runtime_turn(&workspace, &json!([]), intent, &local_context(), true)
                    .unwrap();
            assert_eq!(prepared.params["environments"][0]["cwd"], "D:/worktree");
            workspace["pending"] = Value::Null;
        }
    }

    #[test]
    fn cold_remote_does_not_receive_applied_pending_or_local_permission_overrides() {
        let context = json!({"thread":{"cwd":"/remote","environments":[{"environmentId":"remote","cwd":"/remote"}]},
            "sandbox":{"type":"readOnly"}});
        let params = json!({"threadId":"t","input":[]});
        let prepared = prepare_runtime_turn(
            &state(),
            &json!(["D:/retained"]),
            params.clone(),
            &context,
            true,
        )
        .unwrap();
        assert_eq!(prepared.params, params);
        assert!(prepared.commit.is_none());
    }

    #[test]
    fn projectless_applied_restores_without_membership_or_permission_type_changes() {
        let state = json!({"project":null,"applied":snapshot("D:/old",&["D:/old"]),"pending":null});
        for policy in [
            json!({"type":"readOnly"}),
            json!({"type":"dangerFullAccess"}),
        ] {
            let prepared = prepare_runtime_turn(
                &state,
                &json!([]),
                json!({"sandboxPolicy":policy}),
                &local_context(),
                true,
            )
            .unwrap();
            assert_eq!(prepared.params["environments"][0]["cwd"], "D:/old");
            assert_eq!(prepared.params["sandboxPolicy"], policy);
            assert!(prepared.commit.is_none());
        }
        let prepared = prepare_runtime_turn(
            &state,
            &json!([]),
            json!({"permissions":"custom-profile"}),
            &local_context(),
            true,
        )
        .unwrap();
        assert_eq!(prepared.params["permissions"], "custom-profile");
        assert!(prepared.params.get("sandboxPolicy").is_none());
    }

    #[test]
    fn pending_workspace_replaces_only_old_workspace_roots() {
        let params = json!({
            "threadId":"t","cwd":"D:/unrelated","input":[],
            "sandboxPolicy":{"type":"workspaceWrite","networkAccess":false,
                "excludeTmpdirEnvVar":true,"writableRoots":["d:\\OLD\\", "D:/extra"]}
        });
        let prepared =
            prepare_turn(&state(), &json!(["D:/old-second", "D:/retained"]), params).unwrap();
        assert_eq!(prepared.params["cwd"], "D:/worktree");
        assert_eq!(
            prepared.params["runtimeWorkspaceRoots"],
            json!(["D:/worktree", "D:/project-second"])
        );
        let policy = &prepared.params["sandboxPolicy"];
        assert_eq!(
            policy["writableRoots"],
            json!([
                "D:/extra",
                "D:/retained",
                "D:/worktree",
                "D:/project-second"
            ])
        );
        assert_eq!(policy["networkAccess"], false);
        assert_eq!(policy["excludeTmpdirEnvVar"], true);
        assert_eq!(prepared.commit.unwrap().snapshot, state()["pending"]);
    }

    #[test]
    fn explicit_non_write_policies_and_profiles_are_preserved() {
        for policy in [
            json!({"type":"readOnly"}),
            json!({"type":"dangerFullAccess"}),
        ] {
            let prepared = prepare_turn(
                &state(),
                &json!([]),
                json!({"threadId":"t","sandboxPolicy":policy}),
            )
            .unwrap();
            assert_eq!(prepared.params["sandboxPolicy"], policy);
        }
        let prepared = prepare_turn(
            &state(),
            &json!([]),
            json!({"threadId":"t","permissions":"custom-profile"}),
        )
        .unwrap();
        assert_eq!(prepared.params["permissions"], "custom-profile");
        assert!(prepared.params.get("sandboxPolicy").is_none());
        assert_eq!(
            prepared.params["runtimeWorkspaceRoots"],
            state()["pending"]["runtimeWorkspaceRoots"]
        );
    }

    #[test]
    fn remote_environments_and_unsupported_sources_do_not_consume_local_pending() {
        let params = json!({"threadId":"t","environments":[{"environmentId":"remote","cwd":"/remote","runtimeWorkspaceRoots":["/remote"]}]});
        let prepared = prepare_turn(&state(), &json!([]), params.clone()).unwrap();
        assert_eq!(prepared.params, params);
        assert!(prepared.commit.is_none());
        for project in [
            json!({"projectKind":"remote","projectId":"p","hostId":"host"}),
            json!({"projectKind":"local","projectId":"p","projectOrigin":"chatgpt"}),
        ] {
            let mut state = state();
            state["project"] = project;
            let params = json!({"threadId":"t","cwd":"D:/original"});
            let prepared = prepare_turn(&state, &json!([]), params.clone()).unwrap();
            assert_eq!(prepared.params, params);
            assert!(prepared.commit.is_none());
        }
    }

    #[test]
    fn local_environment_receives_workspace_without_duplicate_top_level_values() {
        let params = json!({"threadId":"t","environments":[
            {"environmentId":"local","cwd":"D:/old","keep":true},
            {"environmentId":"other","cwd":"/other"}
        ],"sandboxPolicy":{"type":"workspaceWrite"}});
        let prepared = prepare_turn(&state(), &json!([]), params).unwrap();
        assert_eq!(prepared.params["environments"][0]["cwd"], "D:/worktree");
        assert_eq!(prepared.params["environments"][0]["keep"], true);
        assert_eq!(prepared.params["environments"][1]["cwd"], "/other");
        assert_eq!(prepared.params["cwd"], Value::Null);
        assert_eq!(prepared.params["runtimeWorkspaceRoots"], Value::Null);
    }

    #[test]
    fn projectless_and_absent_pending_are_unchanged() {
        for state in [
            Value::Null,
            json!({"project":null,"applied":snapshot("D:/old", &["D:/old"]),"pending":null}),
            json!({"project":{"projectKind":"local","projectId":"p"},"pending":null}),
        ] {
            let params = json!({"threadId":"t","cwd":"D:/explicit","input":[]});
            let prepared = prepare_turn(&state, &json!([]), params.clone()).unwrap();
            assert_eq!(prepared.params, params);
            assert!(prepared.commit.is_none());
        }
    }

    #[test]
    fn invalid_pending_cannot_fall_back_to_active_workspace() {
        for invalid in [
            json!({"cwd":"~","projectSources":[],"runtimeWorkspaceRoots":[]}),
            snapshot("relative", &["relative"]),
            snapshot("D:/work", &["/unix"]),
            json!({"cwd":"D:/work","projectSources":["D:/work"],"runtimeWorkspaceRoots":[]}),
        ] {
            let mut state = state();
            state["pending"] = invalid;
            assert!(prepare_turn(
                &state,
                &json!([]),
                json!({"threadId":"t","cwd":"D:/active"})
            )
            .is_err());
        }
        let mut invalid = state();
        invalid["revision"] = Value::Null;
        assert!(prepare_turn(&invalid, &json!([]), json!({"threadId":"t"})).is_err());
    }

    #[test]
    fn accepted_snapshot_keeps_new_revision_and_membership_fields() {
        let prepared = prepare_turn(
            &state(),
            &json!([]),
            json!({"threadId":"t","sandboxPolicy":{"type":"workspaceWrite"}}),
        )
        .unwrap();
        let commit = prepared.commit.unwrap();
        let mut same = state();
        apply_accepted(&mut same, &commit);
        assert_eq!(same["pending"], Value::Null);
        assert_eq!(same["applied"], commit.snapshot);
        let mut newer = state();
        newer["revision"] = json!("move-2");
        newer["pending"] = snapshot("D:/newer", &["D:/newer"]);
        newer["projectMembership"] = json!({"projectKind":"local","projectId":"new-membership"});
        let pending = newer["pending"].clone();
        apply_accepted(&mut newer, &commit);
        assert_eq!(newer["applied"], commit.snapshot);
        assert_eq!(newer["pending"], pending);
        assert_eq!(newer["projectMembership"]["projectId"], "new-membership");
        let mut removed = Value::Null;
        apply_accepted(&mut removed, &commit);
        assert_eq!(removed, Value::Null);
    }
}
