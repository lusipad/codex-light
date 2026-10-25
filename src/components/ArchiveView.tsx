import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const requestSeqRef = useRef(0);

  const load = useCallback(async (searchTerm?: string) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await callAppServer<{ data?: ArchivedThread[] }>("thread/list", {
        archived: true,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        ...(searchTerm ? { searchTerm } : {}),
      });
      if (seq !== requestSeqRef.current) return;
      const list = res?.data || (res as any)?.threads || (Array.isArray(res) ? res : []);
      setThreads(Array.isArray(list) ? list : []);
    } catch (e: any) {
      if (seq !== requestSeqRef.current) return;
      setError(String(e?.message || e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  // 服务器端按标题搜索（thread/list.searchTerm），300ms 防抖
  useEffect(() => {
    const handle = setTimeout(() => {
      void load(search.trim() || undefined);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleUnarchive = useCallback(
    async (thread: ArchivedThread) => {
      setBusyId(thread.id);
      try {
        await onUnarchive(thread);
        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
        onShowToast?.("✓ 已恢复会话", "success");
      } catch (e: any) {
        onShowToast?.(`恢复失败：${e?.message || e}`, "error");
      } finally {
        setBusyId(null);
      }
    },
    [onUnarchive, onShowToast]
  );

  const handleDelete = useCallback(
    async (thread: ArchivedThread) => {
      const label = thread.name || thread.preview || thread.id;
      if (!window.confirm(`确定要彻底删除归档会话「${label}」吗？此操作无法撤销。`)) {
        return;
      }
      setBusyId(thread.id);
      try {
        await onDelete(thread);
        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
        onShowToast?.("✓ 已彻底删除会话", "success");
      } catch (e: any) {
        onShowToast?.(`删除失败：${e?.message || e}`, "error");
      } finally {
        setBusyId(null);
      }
    },
    [onDelete, onShowToast]
  );

  const visible = useMemo(() => threads, [threads]);

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
            onClick={() => void load(search.trim() || undefined)}
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

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
          <div className="archive-empty-title">暂无归档会话</div>
          <div className="archive-empty-desc">
            在侧边栏会话的「⋯」菜单中选择「归档会话」后，会出现在这里。
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="archive-list">
          {visible.map((thread) => (
            <div key={thread.id} className="archive-row">
              <button
                type="button"
                className="archive-row-main"
                onClick={() => onSelectThread(thread.id)}
                title="打开会话（会自动恢复）"
              >
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
              </button>
              <div className="archive-row-actions">
                <button
                  type="button"
                  className="archive-action danger"
                  disabled={busyId === thread.id}
                  onClick={() => void handleDelete(thread)}
                  title="永久删除"
                >
                  <Trash2 size={13} />
                </button>
                <button
                  type="button"
                  className="archive-action"
                  disabled={busyId === thread.id}
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
