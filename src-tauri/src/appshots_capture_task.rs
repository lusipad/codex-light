//! The runtime owns one worker task until its result or cancellation has been
//! awaited. A dropped/aborted future is not evidence that its child was reaped.
use crate::{
    appshots_entry::Scope,
    appshots_host::{self, CaptureTarget, HostCapture, HostError},
};
use std::{path::PathBuf, time::Duration};
use tokio::sync::oneshot;
use uuid::Uuid;

#[must_use = "capture tasks must be finished or cancelled and awaited"]
pub(crate) struct CaptureTask {
    id: Uuid,
    origin: String,
    scope: Scope,
    cancel: Option<oneshot::Sender<()>>,
    task: tauri::async_runtime::JoinHandle<Result<HostCapture, HostError>>,
}

impl CaptureTask {
    pub fn start(
        id: Uuid,
        origin: String,
        scope: Scope,
        target: CaptureTarget,
        root: PathBuf,
        timeout: Duration,
    ) -> Self {
        Self::spawn(id, origin, scope, move |cancel| async move {
            appshots_host::capture_target(target, &root, timeout, cancel).await
        })
    }

    pub(crate) fn spawn<F, R>(id: Uuid, origin: String, scope: Scope, capture: F) -> Self
    where
        F: FnOnce(oneshot::Receiver<()>) -> R,
        R: std::future::Future<Output = Result<HostCapture, HostError>> + Send + 'static,
    {
        let (cancel, receiver) = oneshot::channel();
        Self {
            id,
            origin,
            scope,
            cancel: Some(cancel),
            task: tauri::async_runtime::spawn(capture(receiver)),
        }
    }

    pub fn is_finished(&self) -> bool {
        self.task.inner().is_finished()
    }

    pub async fn cancel(mut self) -> Result<(), HostError> {
        if let Some(cancel) = self.cancel.take() {
            let _ = cancel.send(());
        }
        match self.task.await.map_err(|_| HostError::Transport)? {
            // Normal capture failures have already run the host's kill/wait and
            // cleanup epilogue. Preserve only outcomes that cannot prove that.
            Err(
                error @ (HostError::ReapFailed | HostError::CleanupFailed | HostError::Transport),
            ) => Err(error),
            _ => Ok(()),
        }
    }

    pub async fn finish(
        self,
        id: Uuid,
        origin: &str,
        scope: &Scope,
    ) -> Result<HostCapture, HostError> {
        if self.id != id || self.origin != origin || &self.scope != scope {
            self.cancel().await?;
            return Err(HostError::Cancelled);
        }
        // Keep the sender alive through the await. Receiver closure itself is
        // cancellation, so destructuring/dropping it first would cancel success.
        let Self { task, cancel, .. } = self;
        let result = task.await.map_err(|_| HostError::Transport)?;
        drop(cancel);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appshots_worker::{TextSource, TextStatus, WorkerCapture};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    fn scope() -> Scope {
        Scope {
            account: "account:user".into(),
            composer: "thread-A".into(),
        }
    }
    fn capture() -> HostCapture {
        HostCapture {
            request_id: "real-worker-result".into(),
            png: vec![1, 2, 3],
            capture: WorkerCapture {
                width: 1,
                height: 1,
                text: Some("AX".into()),
                text_status: TextStatus::Partial,
                text_source: TextSource::TextPattern,
            },
        }
    }

    #[tokio::test]
    async fn finish_keeps_cancel_sender_alive_and_returns_actual_result() {
        let id = Uuid::new_v4();
        let task = CaptureTask::spawn(id, "main".into(), scope(), |mut cancelled| async move {
            tokio::task::yield_now().await;
            assert!(matches!(
                cancelled.try_recv(),
                Err(oneshot::error::TryRecvError::Empty)
            ));
            Ok(capture())
        });
        let result = task.finish(id, "main", &scope()).await.unwrap();
        assert_eq!(result.png, vec![1, 2, 3]);
        assert_eq!(result.capture.text.as_deref(), Some("AX"));
    }

    #[tokio::test]
    async fn cancellation_waits_for_worker_cleanup() {
        let cleaned = Arc::new(AtomicBool::new(false));
        let flag = cleaned.clone();
        let task = CaptureTask::spawn(
            Uuid::new_v4(),
            "main".into(),
            scope(),
            |cancelled| async move {
                let _ = cancelled.await;
                tokio::task::yield_now().await;
                flag.store(true, Ordering::SeqCst);
                Err(HostError::Cancelled)
            },
        );
        task.cancel().await.unwrap();
        assert!(cleaned.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn stale_identity_or_composer_cancels_instead_of_delivering() {
        let id = Uuid::new_v4();
        for (requested_id, origin, requested_scope) in [
            (Uuid::new_v4(), "main", scope()),
            (id, "other-window", scope()),
            (
                id,
                "main",
                Scope {
                    account: "other-account".into(),
                    ..scope()
                },
            ),
            (
                id,
                "main",
                Scope {
                    composer: "thread-B".into(),
                    ..scope()
                },
            ),
        ] {
            let cleaned = Arc::new(AtomicBool::new(false));
            let flag = cleaned.clone();
            let task = CaptureTask::spawn(id, "main".into(), scope(), |cancelled| async move {
                let _ = cancelled.await;
                flag.store(true, Ordering::SeqCst);
                Ok(capture()) // A success racing cancellation must also be discarded.
            });
            assert_eq!(
                task.finish(requested_id, origin, &requested_scope)
                    .await
                    .unwrap_err(),
                HostError::Cancelled
            );
            assert!(cleaned.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn cleanup_failure_remains_visible_on_cancel() {
        let task = CaptureTask::spawn(
            Uuid::new_v4(),
            "main".into(),
            scope(),
            |cancelled| async move {
                let _ = cancelled.await;
                Err(HostError::CleanupFailed)
            },
        );
        assert_eq!(task.cancel().await, Err(HostError::CleanupFailed));
    }

    #[tokio::test]
    async fn completed_capture_failure_does_not_claim_that_cleanup_failed() {
        let task = CaptureTask::spawn(
            Uuid::new_v4(),
            "main".into(),
            scope(),
            |cancelled| async move {
                let _ = cancelled.await;
                Err(HostError::TimedOut)
            },
        );
        task.cancel().await.unwrap();
    }
}
