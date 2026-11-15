import { callAppServer, tauriInvoke } from "./bridge";
import type { GitWorktreeInfo, ThreadSummary } from "./types";

export interface WorktreeConversation {
  id: string;
  cwd: string | null;
  isPinned: boolean;
  title: string;
  recency: number;
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

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消工作树移除；删除结果尚未确认，请刷新核对");
}

async function readThreadPages(archived: boolean, signal?: AbortSignal): Promise<ThreadSummary[]> {
  const rows = new Map<string, ThreadSummary>();
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    checkCancellation(signal);
    const page: any = await callAppServer("thread/list", {
      archived, cursor, limit: 100, modelProviders: null, sortKey: "updated_at",
      sourceKinds: null, useStateDbOnly: true,
    });
    checkCancellation(signal);
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

export async function loadWorktreeConversations(signal?: AbortSignal): Promise<WorktreeConversation[]> {
  checkCancellation(signal);
  const [threads, metadata] = await Promise.all([
    readThreadPages(false, signal),
    tauriInvoke<{ pinnedThreadIds: string[] }>("threads_meta_get"),
  ]);
  checkCancellation(signal);
  if (!Array.isArray(metadata?.pinnedThreadIds) ||
      metadata.pinnedThreadIds.some(id => typeof id !== "string" || !id)) {
    throw new Error("无法确认置顶会话，暂不能移除工作树");
  }
  const pinned = new Set(metadata.pinnedThreadIds);
  const rows = new Map(threads.map(thread => [thread.id, thread]));
  // Pinned chats can be absent from the paginated visible conversation list.
  for (const id of pinned) {
    checkCancellation(signal);
    const result = await callAppServer<any>("thread/read", { threadId: id, includeTurns: false });
    checkCancellation(signal);
    if (result?.thread?.id !== id) throw new Error("置顶会话读取结果不匹配");
    rows.set(id, result.thread);
  }
  return [...rows.values()].map(thread => ({
    id: thread.id, cwd: typeof thread.cwd === "string" ? thread.cwd : null,
    isPinned: pinned.has(thread.id),
    title: (typeof thread.name === "string" ? thread.name.trim() : "") ||
      (typeof thread.preview === "string" ? thread.preview.trim() : ""),
    recency: Number.isFinite(thread.recencyAt) ? thread.recencyAt! : Number.isFinite(thread.updatedAt) ? thread.updatedAt! : 0,
  }));
}

const pendingRemovals = new Map<string, { promise: Promise<WorktreeRemovalResult>; controller: AbortController; listeners: (() => void)[] }>();

export function removeWorktreeWithConversations(wt: GitWorktreeInfo, signal?: AbortSignal): Promise<WorktreeRemovalResult> {
  if (signal?.aborted) return Promise.reject(new Error("已取消工作树移除，未开始删除"));
  const key = normalizePath(wt.path);
  let pending = pendingRemovals.get(key);
  if (!pending) {
    const controller = new AbortController(), listeners: (() => void)[] = [];
    const promise = removeWorktree(wt, controller.signal).finally(() => { listeners.forEach(remove => remove()); pendingRemovals.delete(key); });
    pending = { promise, controller, listeners }; pendingRemovals.set(key, pending);
  }
  if (signal) {
    const controller = pending.controller, abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    pending.listeners.push(() => signal.removeEventListener("abort", abort));
  }
  return pending.promise;
}

async function removeWorktree(wt: GitWorktreeInfo, signal: AbortSignal): Promise<WorktreeRemovalResult> {
  const archived: string[] = [];
  const operationId = crypto.randomUUID();
  let deleting = false, cancellation: Promise<void> | null = null, cancellationError = "";
  const cancel = () => {
    if (deleting && !cancellation) cancellation = tauriInvoke("git_worktree_delete_cancel", { operationId }).then(() => {}, error => { cancellationError = `；取消请求未确认：${String(error)}`; });
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    checkCancellation(signal);
    const target = await tauriInvoke<string>("git_worktree_delete_prepare", {
      worktreePath: wt.path, gitDir: wt.gitDir,
    });
    checkCancellation(signal);
    if (typeof target !== "string" || !target) throw new Error("未取得有效工作树身份");
    const related = (await loadWorktreeConversations(signal)).filter(thread => cwdInWorktree(thread.cwd, target));
    checkCancellation(signal);
    if (related.some(thread => thread.isPinned)) throw new Error("请先取消置顶此工作树中的会话");
    for (const thread of related) {
      checkCancellation(signal);
      // Direct thread/archive does not invoke the desktop worktree cleanup wrapper.
      await callAppServer("thread/archive", { threadId: thread.id });
      archived.push(thread.id);
      checkCancellation(signal);
    }
    if (archived.length) {
      const verified = new Set((await readThreadPages(true, signal)).map(thread => thread.id));
      if (archived.some(id => !verified.has(id))) throw new Error("关联会话归档尚未通过服务回读确认");
    }
    checkCancellation(signal);
    deleting = true;
    const result = await tauriInvoke<WorktreeRemovalResult>("git_worktree_delete", {
      worktreePath: target, gitDir: wt.gitDir, operationId,
    });
    await cancellation;
    checkCancellation(signal);
    if (typeof result?.worktreePath !== "string" || !Array.isArray(result.warnings) ||
        result.warnings.some(warning => typeof warning !== "string") ||
        (result.snapshotRef !== null && typeof result.snapshotRef !== "string")) {
      throw new Error("删除命令未返回可确认的结果，请刷新核对");
    }
    return result;
  } catch (error) {
    await cancellation;
    throw new Error(`${String(error)}${cancellationError}${archived.length ? `；已有 ${archived.length} 个关联会话接受了归档，请刷新核对，删除结果尚未确认` : ""}`);
  } finally { signal.removeEventListener("abort", cancel); }
}
