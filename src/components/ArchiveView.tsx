import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { callAppServer } from "../bridge";
import { ThreadSummary } from "../types";
import "./ArchiveView.css";

export interface ArchiveViewProps {
  refreshToken?: number | string | null;
  onSelectThread: (threadId: string) => void;
  onUnarchive: (thread: ThreadSummary) => Promise<void> | void;
  onDelete: (thread: ThreadSummary) => Promise<void> | void;
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

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  refreshToken,
  onSelectThread,
  onUnarchive,
  onDelete,
  onShowToast,
}) => {
  const [threads, setThreads] = useState<ArchivedThread[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoredThread, setRestoredThread] = useState<ArchivedThread | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const mutationPendingRef = useRef(false);

  const load = useCallback(async (afterMutation = false) => {
    if (mutationPendingRef.current && !afterMutation) return;
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
          archived: true, limit: 100, sortKey: "updated_at", sortDirection: "desc", cursor,
        });
        if (!isCurrent()) return;
        if (!Array.isArray(res?.data)) throw new Error("归档列表响应无效");
        list.push(...res.data);
        cursor = res.nextCursor ?? null;
        if (cursor !== null && cursors.has(cursor)) throw new Error("归档列表返回重复分页游标");
        if (cursor !== null) cursors.add(cursor);
      } while (cursor !== null);
      setThreads(list);
    } catch (e: any) {
      if (!isCurrent()) return;
      setError(String(e?.message || e));
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
    async (thread: ArchivedThread, action: "restore" | "delete") => {
      if (mutationPendingRef.current) return;
      mutationPendingRef.current = true;
      ++requestSeqRef.current;
      setLoading(false);
      setBusyId(thread.id);
      try {
        if (action === "restore") await onUnarchive(thread);
        else await onDelete(thread);
        if (!mountedRef.current) return;
        setThreads((current) => current.filter((item) => item.id !== thread.id));
        if (action === "restore") setRestoredThread(thread);
        else if (restoredThread?.id === thread.id) setRestoredThread(null);
        onShowToast?.(action === "restore" ? "聊天已取消归档" : "已删除归档聊天", "success");
        await load(true);
      } catch (e: any) {
        if (mountedRef.current) onShowToast?.(`${action === "restore" ? "恢复" : "删除"}失败：${e?.message || e}`, "error");
      } finally {
        mutationPendingRef.current = false;
        if (mountedRef.current) setBusyId(null);
      }
    },
    [onUnarchive, onDelete, onShowToast, load, restoredThread]
  );

  const handleUnarchive = useCallback(
    async (thread: ArchivedThread) => { await mutate(thread, "restore"); },
    [mutate]
  );

  const handleDelete = useCallback(
    async (thread: ArchivedThread) => {
      if (mutationPendingRef.current) return;
      const label = thread.name || thread.preview || thread.id;
      if (!window.confirm(`确定要彻底删除归档会话「${label}」吗？此操作无法撤销。`)) {
        return;
      }
      await mutate(thread, "delete");
    },
    [mutate]
  );

  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const visible = useMemo(() => threads.filter((thread) =>
    !query || (thread.name || thread.preview || thread.id).toLocaleLowerCase().includes(query)
  ), [threads, query]);

  return (
    <div className="archive-view">
      <header className="archive-header">
        <div>
          <h2 className="archive-title">已归档会话</h2>
          <p className="archive-subtitle">
            归档的会话不会出现在侧边栏；可随时恢复或在需要时彻底删除。
          </p>
        </div>
        <div className="archive-header-actions">
          <input
            className="archive-search"
            type="text"
            placeholder="搜索归档会话标题…"
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
          <div className="archive-empty-icon">🗄️</div>
          <div className="archive-empty-title">{query ? "没有匹配的归档会话" : "暂无归档会话"}</div>
          <div className="archive-empty-desc">
            在侧边栏会话的「⋯」菜单中选择「归档会话」后，会出现在这里。
          </div>
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
                  disabled={busyId !== null}
                  onClick={() => void handleDelete(thread)}
                  title="永久删除"
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
    </div>
  );
};
