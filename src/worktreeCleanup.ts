import { isTauriRuntime, tauriInvoke, tauriListen } from "./bridge";
import { planWorktreeCleanup, type WorktreeCleanupInput } from "./worktreePolicy";

interface Preparation {
  token: string;
  input: WorktreeCleanupInput;
  warnings: string[];
}
interface CleanupReport {
  deleted: { worktreePath: string }[];
  retained: string[];
  errors: string[];
}

/** The timer resumes persisted work; only native lifecycle events enqueue cleanup. */
export function installWorktreeCleanup(): () => void {
  if (!isTauriRuntime()) return () => {};
  let disposed = false;
  let running = false;
  let requested = false;
  let activeToken: string | null = null;
  let unlisten: (() => void) | undefined;
  const cancel = (token: string) => tauriInvoke("worktree_cleanup_cancel", { token })
    .catch(error => console.warn("工作树清理取消未确认", error));
  const kick = async () => {
    if (disposed) return;
    requested = true;
    if (running) return;
    running = true;
    try {
      while (requested && !disposed) {
        requested = false;
        const preparation = await tauriInvoke<Preparation | null>("worktree_cleanup_prepare");
        if (!preparation) continue;
        activeToken = preparation.token;
        if (disposed) { await cancel(preparation.token); break; }
        if (preparation.warnings.length) console.warn("工作树清理保护记录", preparation.warnings);
        const { candidates } = planWorktreeCleanup(preparation.input);
        const result = await tauriInvoke<CleanupReport>("worktree_cleanup_execute", {
          token: preparation.token, candidatePaths: candidates.map(record => record.path),
        });
        activeToken = null;
        if (result.errors.length) console.warn("工作树自动清理未全部完成", result.errors);
        // Drain a revision merged during execution; native retry deadlines remain authoritative.
        requested = true;
      }
    } catch (error) {
      console.warn("工作树自动清理未完成", error);
      if (activeToken) await cancel(activeToken);
    } finally {
      activeToken = null;
      running = false;
    }
  };
  void tauriListen("worktree:cleanup-requested", () => { void kick(); }).then(off => {
    if (disposed) { off(); return; }
    unlisten = off;
    void kick();
  }).catch(error => console.warn("工作树清理事件订阅失败", error));
  const timer = setInterval(() => { void kick(); }, 30_000);
  return () => {
    disposed = true;
    clearInterval(timer);
    unlisten?.();
    if (activeToken) void cancel(activeToken);
  };
}
