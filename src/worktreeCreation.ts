import { tauriInvoke } from "./bridge";
import type { GitWorktreeInfo } from "./types";

export interface WorktreeCreationOptions {
  sourceCwd: string;
  startingMode: string;
  branchName: string | null;
  ownerThreadId: string | null;
}

export async function createEnvironmentWorktree(options: WorktreeCreationOptions, signal: AbortSignal): Promise<GitWorktreeInfo> {
  const check = () => { if (signal.aborted) throw Error("工作树创建已取消；已创建的目录会保留，请检查工作树列表。"); };
  check();
  const operationId = crypto.randomUUID();
  const cancel = () => { void tauriInvoke("git_worktree_create_cancel", { operationId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await tauriInvoke<GitWorktreeInfo>("git_worktree_create", { ...options, operationId });
    check();
    if (!result?.path) throw Error("工作树创建未返回真实目录。");
    return result;
  } finally { signal.removeEventListener("abort", cancel); }
}
