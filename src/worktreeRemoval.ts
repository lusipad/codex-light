import { callAppServer, tauriInvoke } from "./bridge";
import type { GitWorktreeInfo, ThreadSummary } from "./types";

export interface WorktreeConversation {
  id: string;
  cwd: string | null;
  isPinned: boolean;
}

export interface WorktreeRemovalResult {
  worktreePath: string;
  snapshotRef: string | null;
  warnings: string[];
}

function normalizePath(value: string): string {
  const path = value.replace(/\\/g, "/").toLowerCase();
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${path.startsWith("//") ? "//" : path.startsWith("/") ? "/" : ""}${parts.join("/")}`;
}

export function cwdInWorktree(cwd: string | null | undefined, worktree: string): boolean {
  if (!cwd) return false;
  const root = normalizePath(worktree);
  const path = normalizePath(cwd);
  return root.length > 0 && (path === root || path.startsWith(`${root}/`));
}

async function readThreadPages(archived: boolean): Promise<ThreadSummary[]> {
  const rows = new Map<string, ThreadSummary>();
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: any = await callAppServer("thread/list", {
      archived, cursor, limit: 100, modelProviders: null, sortKey: "updated_at",
      sourceKinds: null, useStateDbOnly: true,
    });
    if (!Array.isArray(page?.data)) throw new Error("会话服务未返回有效列表");
    for (const thread of page.data) {
      if (typeof thread?.id !== "string" || !thread.id) throw new Error("会话列表含无效身份");
      if (thread.ephemeral !== true && thread.threadSource !== "ambient_suggestions") rows.set(thread.id, thread);
    }
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (typeof cursor !== "string" || visited.has(cursor)) throw new Error("会话列表游标无效或重复");
      visited.add(cursor);
    }
  } while (cursor !== null);
  return [...rows.values()];
}

export async function loadWorktreeConversations(): Promise<WorktreeConversation[]> {
  const [threads, metadata] = await Promise.all([
    readThreadPages(false),
    tauriInvoke<{ pinnedThreadIds: string[] }>("threads_meta_get"),
  ]);
  if (!Array.isArray(metadata?.pinnedThreadIds) ||
      metadata.pinnedThreadIds.some(id => typeof id !== "string" || !id)) {
    throw new Error("无法确认置顶会话，暂不能移除工作树");
  }
  const pinned = new Set(metadata.pinnedThreadIds);
  const rows = new Map(threads.map(thread => [thread.id, thread]));
  // Pinned chats can be absent from the paginated visible conversation list.
  for (const id of pinned) {
    const result = await callAppServer<any>("thread/read", { threadId: id, includeTurns: false });
    if (result?.thread?.id !== id) throw new Error("置顶会话读取结果不匹配");
    rows.set(id, result.thread);
  }
  return [...rows.values()].map(thread => ({
    id: thread.id, cwd: typeof thread.cwd === "string" ? thread.cwd : null,
    isPinned: pinned.has(thread.id),
  }));
}

const pendingRemovals = new Map<string, Promise<WorktreeRemovalResult>>();

export function removeWorktreeWithConversations(wt: GitWorktreeInfo): Promise<WorktreeRemovalResult> {
  const key = normalizePath(wt.path);
  const pending = pendingRemovals.get(key);
  if (pending) return pending;
  const operation = removeWorktree(wt).finally(() => pendingRemovals.delete(key));
  pendingRemovals.set(key, operation);
  return operation;
}

async function removeWorktree(wt: GitWorktreeInfo): Promise<WorktreeRemovalResult> {
  const archived: string[] = [];
  try {
    const target = await tauriInvoke<string>("git_worktree_delete_prepare", {
      worktreePath: wt.path, gitDir: wt.gitDir,
    });
    if (typeof target !== "string" || !target) throw new Error("未取得有效工作树身份");
    const related = (await loadWorktreeConversations()).filter(thread => cwdInWorktree(thread.cwd, target));
    if (related.some(thread => thread.isPinned)) throw new Error("请先取消置顶此工作树中的会话");
    for (const thread of related) {
      // Direct thread/archive does not invoke the desktop worktree cleanup wrapper.
      await callAppServer("thread/archive", { threadId: thread.id });
      archived.push(thread.id);
    }
    if (archived.length) {
      const verified = new Set((await readThreadPages(true)).map(thread => thread.id));
      if (archived.some(id => !verified.has(id))) throw new Error("关联会话归档尚未通过服务回读确认");
    }
    const result = await tauriInvoke<WorktreeRemovalResult>("git_worktree_delete", {
      worktreePath: target, gitDir: wt.gitDir,
    });
    if (typeof result?.worktreePath !== "string" || !Array.isArray(result.warnings) ||
        result.warnings.some(warning => typeof warning !== "string") ||
        (result.snapshotRef !== null && typeof result.snapshotRef !== "string")) {
      throw new Error("删除命令未返回可确认的结果，请刷新核对");
    }
    return result;
  } catch (error) {
    throw new Error(`${String(error)}${archived.length ? `；已有 ${archived.length} 个关联会话接受了归档，请刷新核对，删除结果尚未确认` : ""}`);
  }
}
