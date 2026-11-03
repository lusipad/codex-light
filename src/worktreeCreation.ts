import { tauriInvoke, tauriListen } from "./bridge";
import type { GitWorktreeInfo } from "./types";

export interface WorktreeCreationOptions {
  sourceCwd: string;
  startingMode: string;
  branchName: string | null;
  ownerThreadId: string | null;
}

export interface WorktreeCreationProgress {
  operationId: string;
  phase: "upstream-refresh" | "creating";
  kind?: string;
  text?: string;
}

export async function createEnvironmentWorktree(options: WorktreeCreationOptions, signal: AbortSignal, refresh?: {
  signal?: AbortSignal;
  onProgress?: (progress: WorktreeCreationProgress) => void;
}): Promise<GitWorktreeInfo> {
  const check = () => { if (signal.aborted) throw Error("工作树创建已取消；已创建的目录会保留，请检查工作树列表。"); };
  check();
  const operationId = crypto.randomUUID();
  const cancel = () => { void tauriInvoke("git_worktree_create_cancel", { operationId }).catch(() => {}); };
  const skip = () => { void tauriInvoke("git_worktree_refresh_skip", { operationId }).catch(() => {}); };
  let unlisten: (() => void) | undefined;
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (refresh?.onProgress) {
      unlisten = await tauriListen<WorktreeCreationProgress>("worktree:create-progress", progress => {
        if (!signal.aborted && progress.operationId === operationId) refresh.onProgress?.(progress);
      });
      check();
    }
    refresh?.signal?.addEventListener("abort", skip, { once: true });
    if (refresh?.signal?.aborted) {
      await tauriInvoke("git_worktree_refresh_skip", { operationId });
      check();
    }
    const result = await tauriInvoke<GitWorktreeInfo>("git_worktree_create", { ...options, operationId });
    check();
    if (!result?.path) throw Error("工作树创建未返回真实目录。");
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
    refresh?.signal?.removeEventListener("abort", skip);
    unlisten?.();
  }
}
