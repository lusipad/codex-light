import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { callAppServer } from "../bridge";
import { ArchiveDeleteResult, ThreadSummary } from "../types";
import "./RenameThreadDialog.css";
import "./ArchiveView.css";

export interface ArchiveViewProps {
  refreshToken?: number | string | null;
  onSelectThread: (threadId: string) => void;
  onUnarchive: (thread: ThreadSummary) => Promise<void> | void;
  onDelete: (thread: ThreadSummary) => Promise<ArchiveDeleteResult>;
  onDeleteAll: () => Promise<ArchiveDeleteResult>;
  onShowToast?: (message: string, type?: "info" | "success" | "error") => void;
}

interface ArchivedThread extends ThreadSummary {
  cwd?: string | null;
  updatedAt?: number;
  createdAt?: number;
}

function formatRelative(seconds?: number): string {
  if (!seconds) return "—";
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ms).toLocaleDateString();
}

function ArchiveDeleteDialog({ all, onDecision, fallbackRef }: {
  all: boolean;
  onDecision: (confirmed: boolean) => void;
  fallbackRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const decidedRef = useRef(false);
  const confirmedRef = useRef(false);
  const composingRef = useRef(false);
  const decide = (confirmed: boolean) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    confirmedRef.current = confirmed;
    onDecision(confirmed);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (!confirmedRef.current && previous?.isConnected && !previous.matches(":disabled, [inert]")) previous.focus({ preventScroll: true });
      else fallbackRef.current?.focus({ preventScroll: true });
    };
  }, [fallbackRef]);
  return <dialog ref={dialogRef} className="rename-thread-dialog archive-delete-dialog"
    aria-labelledby="archive-delete-title" aria-describedby="archive-delete-description"
    onCancel={event => { event.preventDefault(); if (!composingRef.current) decide(false); }}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)
        && (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
    }}>
    <form onSubmit={event => { event.preventDefault(); if (!composingRef.current) decide(true); }}>
      <header>
        <h2 id="archive-delete-title">{all ? "删除所有已归档本地聊天？" : "删除已归档的聊天？"}</h2>
        <p id="archive-delete-description">{all ? "这将永久删除所有本地已归档聊天记录" : "这将永久删除已归档的聊天"}</p>
      </header>
      <footer>
        <button ref={cancelRef} type="button" onClick={() => decide(false)}>取消</button>
        <button type="submit" className="archive-delete-confirm">删除</button>
      </footer>
    </form>
  </dialog>;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  refreshToken,
  onSelectThread,
  onUnarchive,
  onDelete,
  onDeleteAll,
  onShowToast,
}) => {
  const [threads, setThreads] = useState<ArchivedThread[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoredThread, setRestoredThread] = useState<ArchivedThread | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedThread | "all" | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const mutationPendingRef = useRef(false);

  const load = useCallback(async (afterMutation = false, deletionExecuted = false) => {
    if (mutationPendingRef.current && !afterMutation) return false;
    const seq = ++requestSeqRef.current;
    const isCurrent = () => mountedRef.current && seq === requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list: ArchivedThread[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const res: { data: ArchivedThread[]; nextCursor?: string | null } = await callAppServer("thread/list", {
          archived: true, limit: 100, sortKey: "updated_at", sortDirection: "desc", cursor, useStateDbOnly: true,
        });
        if (!isCurrent()) return;
        if (!Array.isArray(res?.data)) throw new Error("归档列表响应无效");
        list.push(...res.data);
        cursor = res.nextCursor ?? null;
        if (cursor !== null && cursors.has(cursor)) throw new Error("归档列表返回重复分页游标");
        if (cursor !== null) cursors.add(cursor);
      } while (cursor !== null);
      setThreads(list);
      return true;
    } catch (e: any) {
      if (!isCurrent()) return;
      setError(`${deletionExecuted ? "删除已执行，刷新失败：" : ""}${e?.message || e}`);
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; ++requestSeqRef.current; };
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const mutate = useCallback(
    async (thread: ArchivedThread | null, action: "restore" | "delete") => {
      if (mutationPendingRef.current) return;
      mutationPendingRef.current = true;
      ++requestSeqRef.current;
      setLoading(false);
      setBusyId(thread?.id ?? "all");
      try {
        if (action === "restore" && thread) {
          await onUnarchive(thread);
          if (!mountedRef.current) return;
          setThreads(current => current.filter(item => item.id !== thread.id));
          setRestoredThread(thread);
          onShowToast?.("聊天已取消归档", "success");
          await load(true);
        } else {
          const result = thread ? await onDelete(thread) : await onDeleteAll();
          if (!mountedRef.current) return;
          const deleted = new Set(result.deletedThreadIds);
          setThreads(current => current.filter(item => !deleted.has(item.id)));
          if (restoredThread && deleted.has(restoredThread.id)) setRestoredThread(null);
          if (result.error) onShowToast?.(`${deleted.size ? `已永久删除 ${deleted.size} 个归档聊天；` : ""}删除失败：${result.error}`, "error");
          else onShowToast?.(deleted.size ? `已永久删除 ${deleted.size} 个归档聊天` : "没有删除聊天，归档状态可能已更改", deleted.size ? "success" : "info");
          const refreshed = await load(true, deleted.size > 0);
          if (mountedRef.current && !refreshed && deleted.size > 0) onShowToast?.("删除已执行，刷新失败，请重试刷新列表", "error");
        }
      } catch (e: any) {
        if (mountedRef.current) {
          onShowToast?.(`${action === "restore" ? "恢复失败" : "删除结果未确认"}：${e?.message || e}`, "error");
          if (action === "delete") await load(true);
        }
      } finally {
        mutationPendingRef.current = false;
        if (mountedRef.current) setBusyId(null);
      }
    },
    [onUnarchive, onDelete, onDeleteAll, onShowToast, load, restoredThread]
  );

  const handleUnarchive = useCallback(
    async (thread: ArchivedThread) => { await mutate(thread, "restore"); },
    [mutate]
  );

  const handleDelete = useCallback(
    (thread: ArchivedThread) => {
      if (mutationPendingRef.current || loading) return;
      setDeleteTarget(thread);
    },
    [loading]
  );

  const handleDeleteDecision = useCallback(async (confirmed: boolean) => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!confirmed || !target || mutationPendingRef.current || loading) return;
    if (target === "all" && (error || threads.length === 0)) return;
    await mutate(target === "all" ? null : target, "delete");
  }, [deleteTarget, loading, error, threads.length, mutate]);

  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const visible = useMemo(() => threads.filter((thread) =>
    !query || (thread.name || thread.preview || thread.id).toLocaleLowerCase().includes(query)
  ), [threads, query]);

  return (
    <div className="archive-view" ref={viewRef} tabIndex={-1}>
      <header className="archive-header">
        <div>
          <h2 className="archive-title">归档</h2>
          <p className="archive-subtitle">
            归档的会话不会出现在侧边栏；可随时恢复或在需要时彻底删除。
          </p>
        </div>
        <div className="archive-header-actions">
          {!loading && !error && threads.length > 0 && (
            <button type="button" className="archive-action danger" disabled={busyId !== null}
              onClick={() => { if (!mutationPendingRef.current) setDeleteTarget("all"); }}>全部删除</button>
          )}
          <input
            className="archive-search"
            type="text"
            aria-label="搜索已归档的聊天"
            placeholder="搜索已归档的聊天"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="archive-refresh"
            onClick={() => void load()}
            disabled={loading || busyId !== null}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      {restoredThread && (
        <div className="archive-footer" role="status">
          聊天已取消归档
          <button type="button" className="archive-action" onClick={() => onSelectThread(restoredThread.id)}>查看</button>
        </div>
      )}

      {error && (
        <div className="archive-error">
          <span>无法读取归档会话：{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {!error && !loading && visible.length === 0 && (
        <div className="archive-empty">
          <div className="archive-empty-title">{query ? "未找到匹配的归档聊天" : "暂无已归档的聊天"}</div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="archive-list">
          {visible.map((thread) => (
            <div key={thread.id} className="archive-row">
              <div className="archive-row-main">
                <span className="archive-row-title">
                  {thread.name || thread.preview || thread.id}
                </span>
                <span className="archive-row-meta">
                  <span className="mono">{formatRelative(thread.updatedAt || thread.createdAt)}</span>
                  {thread.cwd && (
                    <span className="mono archive-row-cwd" title={thread.cwd}>
                      {thread.cwd}
                    </span>
                  )}
                </span>
              </div>
              <div className="archive-row-actions">
                <button
                  type="button"
                  className="archive-action danger"
                  disabled={loading || busyId !== null}
                  onClick={() => void handleDelete(thread)}
                  title="永久删除"
                  aria-label="删除已归档的聊天"
                >
                  <Trash2 size={13} />
                </button>
                <button
                  type="button"
                  className="archive-action"
                  disabled={busyId !== null}
                  onClick={() => void handleUnarchive(thread)}
                >
                  取消归档
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="archive-footer">
        共 {visible.length} 个归档会话{loading ? "（加载中…）" : ""}
      </footer>
      {deleteTarget && <ArchiveDeleteDialog all={deleteTarget === "all"} onDecision={handleDeleteDecision} fallbackRef={viewRef} />}
    </div>
  );
};
