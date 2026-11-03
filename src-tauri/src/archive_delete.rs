use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::future::Future;
use tokio::sync::Mutex;

static ARCHIVE_DELETE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivedDeleteResult {
    pub deleted_thread_ids: Vec<String>,
    pub error: Option<String>,
}

pub(crate) async fn delete_archived<Call, Rpc, Remove>(
    thread_id: Option<&str>,
    call: Call,
    remove_record: Remove,
) -> Result<ArchivedDeleteResult, String>
where
    Call: FnMut(&'static str, Value) -> Rpc,
    Rpc: Future<Output = Result<Value, String>>,
    Remove: FnMut(&str),
{
    delete_archived_locked(&ARCHIVE_DELETE_LOCK, thread_id, call, remove_record).await
}

async fn delete_archived_locked<Call, Rpc, Remove>(
    lock: &Mutex<()>,
    thread_id: Option<&str>,
    mut call: Call,
    mut remove_record: Remove,
) -> Result<ArchivedDeleteResult, String>
where
    Call: FnMut(&'static str, Value) -> Rpc,
    Rpc: Future<Output = Result<Value, String>>,
    Remove: FnMut(&str),
{
    if thread_id.is_some_and(|id| id.trim().is_empty()) {
        return Err("Archived thread id must not be empty".into());
    }
    let _guard = lock
        .try_lock()
        .map_err(|_| "Archived deletion is busy".to_string())?;
    let mut archived_ids = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_cursors = HashSet::new();
    let mut cursor: Option<String> = None;
    loop {
        let page = call(
            "thread/list",
            json!({
                "archived": true,
                "cursor": cursor,
                "limit": 200,
                "useStateDbOnly": true,
            }),
        )
        .await?;
        let data = page
            .get("data")
            .and_then(Value::as_array)
            .ok_or("Invalid archived thread list data")?;
        for item in data {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .ok_or("Invalid archived thread id")?;
            if seen_ids.insert(id.to_owned()) {
                archived_ids.push(id.to_owned());
            }
        }
        cursor = match page.get("nextCursor") {
            Some(Value::Null) => None,
            Some(Value::String(next)) if !next.trim().is_empty() => {
                if !seen_cursors.insert(next.clone()) {
                    return Err("Repeated archived thread list cursor".into());
                }
                Some(next.clone())
            }
            _ => return Err("Invalid archived thread list cursor".into()),
        };
        if cursor.is_none() {
            break;
        }
    }
    let mut result = ArchivedDeleteResult {
        deleted_thread_ids: Vec::new(),
        error: None,
    };
    for id in archived_ids {
        if thread_id.is_some_and(|target| target != id) {
            continue;
        }
        if let Err(error) = call("thread/delete", json!({"threadId": id})).await {
            result.error = Some(error);
            break;
        }
        remove_record(&id);
        result.deleted_thread_ids.push(id);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    async fn run(
        target: Option<&str>,
        responses: Vec<Result<Value, String>>,
    ) -> (
        Result<ArchivedDeleteResult, String>,
        Vec<(String, Value)>,
        Vec<String>,
    ) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let removed = Arc::new(Mutex::new(Vec::new()));
        let mut responses = responses.into_iter();
        let result = delete_archived_locked(
            &tokio::sync::Mutex::new(()),
            target,
            |method, params| {
                calls.lock().unwrap().push((method.to_owned(), params));
                std::future::ready(responses.next().expect("unexpected RPC"))
            },
            |id| removed.lock().unwrap().push(id.to_owned()),
        )
        .await;
        let calls = calls.lock().unwrap().clone();
        let removed = removed.lock().unwrap().clone();
        (result, calls, removed)
    }

    #[tokio::test]
    async fn archive_delete_collects_fresh_pages_before_deleting_unique_ids() {
        let first = (0..200)
            .map(|n| json!({"id":format!("a{n}")}))
            .collect::<Vec<_>>();
        let mut responses = vec![
            Ok(json!({"data":first,"nextCursor":"next"})),
            Ok(json!({"data":[{"id":"a0"},{"id":"fresh"}],"nextCursor":null})),
        ];
        responses.extend((0..201).map(|_| Ok(json!({}))));
        let (result, calls, removed) = run(None, responses).await;
        let result = result.unwrap();
        assert_eq!(result.deleted_thread_ids.len(), 201);
        assert_eq!(result.error, None);
        assert_eq!(removed, result.deleted_thread_ids);
        assert_eq!(
            calls[0],
            (
                "thread/list".into(),
                json!({"archived":true,"cursor":null,"limit":200,"useStateDbOnly":true})
            )
        );
        assert_eq!(calls[1].1["cursor"], "next");
        assert!(calls[2..]
            .iter()
            .all(|(method, _)| method == "thread/delete"));
        assert_eq!(calls.last().unwrap().1["threadId"], "fresh");
    }

    #[tokio::test]
    async fn archive_delete_stale_single_does_not_delete_or_remove_record() {
        let (result, calls, removed) = run(
            Some("restored"),
            vec![Ok(json!({"data":[{"id":"archived"}],"nextCursor":null}))],
        )
        .await;
        assert!(result.unwrap().deleted_thread_ids.is_empty());
        assert_eq!(calls.len(), 1);
        assert!(removed.is_empty());
    }

    #[tokio::test]
    async fn archive_delete_single_only_deletes_requested_archived_id() {
        let (result, calls, removed) = run(
            Some("b"),
            vec![
                Ok(json!({"data":[{"id":"a"},{"id":"b"}],"nextCursor":null})),
                Ok(json!({})),
            ],
        )
        .await;
        assert_eq!(result.unwrap().deleted_thread_ids, vec!["b"]);
        assert_eq!(calls[1], ("thread/delete".into(), json!({"threadId":"b"})));
        assert_eq!(removed, vec!["b"]);
    }

    #[tokio::test]
    async fn archive_delete_partial_failure_preserves_successes_and_stops() {
        for error in [
            "permission denied",
            "unsupported method thread/delete",
            "connection closed",
        ] {
            let (result, calls, removed) = run(
                None,
                vec![
                    Ok(json!({"data":[{"id":"a"},{"id":"b"},{"id":"c"}],"nextCursor":null})),
                    Ok(json!({})),
                    Err(error.into()),
                ],
            )
            .await;
            let result = result.unwrap();
            assert_eq!(result.deleted_thread_ids, vec!["a"]);
            assert_eq!(result.error.as_deref(), Some(error));
            assert_eq!(removed, vec!["a"]);
            assert_eq!(calls.len(), 3);
            assert_eq!(calls[2].1, json!({"threadId":"b"}));
        }
    }

    #[tokio::test]
    async fn archive_delete_bad_enumeration_never_starts_deleting() {
        for bad in [
            json!({}),
            json!({"data":null,"nextCursor":null}),
            json!({"data":[{"id":""}],"nextCursor":null}),
            json!({"data":[{"id":42}],"nextCursor":null}),
            json!({"data":[],"nextCursor":7}),
            json!({"data":[],"nextCursor":""}),
            json!({"data":[]}),
        ] {
            let (result, calls, removed) = run(
                None,
                vec![
                    Ok(json!({"data":[{"id":"a"}],"nextCursor":"next"})),
                    Ok(bad),
                ],
            )
            .await;
            assert!(result.is_err());
            assert!(calls.iter().all(|(method, _)| method == "thread/list"));
            assert!(removed.is_empty());
        }
        let (result, calls, removed) = run(
            None,
            vec![
                Ok(json!({"data":[{"id":"a"}],"nextCursor":"loop"})),
                Ok(json!({"data":[{"id":"b"}],"nextCursor":"loop"})),
            ],
        )
        .await;
        assert!(result.unwrap_err().contains("cursor"));
        assert_eq!(calls.len(), 2);
        assert!(removed.is_empty());
        let (result, calls, removed) = run(None, vec![Err("permission denied".into())]).await;
        assert_eq!(result.unwrap_err(), "permission denied");
        assert_eq!(calls.len(), 1);
        assert!(removed.is_empty());
    }

    #[tokio::test]
    async fn archive_delete_invalid_target_and_shared_lock_reject_without_rpc() {
        let (result, calls, removed) = run(Some("  "), vec![]).await;
        assert!(result.is_err());
        assert!(calls.is_empty() && removed.is_empty());
        let lock = tokio::sync::Mutex::new(());
        let guard = lock.lock().await;
        for target in [None, Some("a")] {
            let result = delete_archived_locked(
                &lock,
                target,
                |_, _| std::future::ready(Err("must not call".into())),
                |_| panic!("must not clear"),
            )
            .await;
            assert!(result.unwrap_err().contains("busy"));
        }
        drop(guard);
        assert!(delete_archived_locked(
            &lock,
            None,
            |_, _| std::future::ready(Ok(json!({"data":[],"nextCursor":null}))),
            |_| panic!("empty set")
        )
        .await
        .is_ok());
    }

    #[test]
    fn archive_delete_response_uses_camel_case_and_normal_delete_is_unchanged() {
        let value = serde_json::to_value(ArchivedDeleteResult {
            deleted_thread_ids: vec!["a".into()],
            error: None,
        })
        .unwrap();
        assert_eq!(value, json!({"deletedThreadIds":["a"],"error":null}));
        let lib = include_str!("lib.rs");
        let ordinary = lib
            .split("async fn thread_delete(")
            .nth(1)
            .unwrap()
            .split("#[tauri::command]")
            .next()
            .unwrap();
        assert!(ordinary.contains("\"thread/delete\""));
        assert!(ordinary.contains("remove_thread_record(&thread_id)"));
        assert!(!ordinary.contains("archive_delete"));
    }
}
