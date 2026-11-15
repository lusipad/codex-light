import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { tauriInvoke } from "../bridge";
import { baseNameFsPath } from "../fsClient";
import { cwdInWorktree, loadWorktreeConversations, type WorktreeConversation } from "../worktreeRemoval";
import "./WorktreeSettings.css";

interface InventoryRecord {
  path: string;
  repoPath: string;
}

interface Inventory {
  records: InventoryRecord[];
  errors: { path: string; message: string }[];
}

export function WorktreeInventory({ workspaceRoots, onOpenThread }: {
  workspaceRoots?: string[];
  onOpenThread: (threadId: string) => void;
}) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [conversations, setConversations] = useState<WorktreeConversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const pending = useRef<AbortController | null>(null);

  const refresh = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setConversations([]);
    try {
      const result = await tauriInvoke<Inventory>("worktree_policy_inventory");
      if (controller.signal.aborted) return;
      setInventory(result);
      if (!result.records.length) {
        setConversations([]);
        return;
      }
      try {
        const threads = await loadWorktreeConversations(controller.signal);
        if (!controller.signal.aborted) setConversations(threads);
      } catch (error) {
        if (controller.signal.aborted) return;
        setConversations([]);
        setError(`无法读取关联聊天：${String(error)}`);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(`无法加载工作树：${String(error)}`);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    void refresh();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);

  const groups = new Map<string, { rows: { path: string; chats: WorktreeConversation[]; recency: number }[]; recency: number }>();
  for (const record of inventory?.records ?? []) {
    if (workspaceRoots?.some(root => cwdInWorktree(root, record.path))) continue;
    const chats = conversations.filter(chat => cwdInWorktree(chat.cwd, record.path));
    const recency = chats.reduce((latest, chat) => Math.max(latest, chat.recency), 0);
    const group = groups.get(record.repoPath) ?? { rows: [], recency: 0 };
    group.rows.push({ path: record.path, chats, recency });
    group.recency = Math.max(group.recency, recency);
    groups.set(record.repoPath, group);
  }
  const sortedGroups = [...groups].sort(([aPath, a], [bPath, b]) => b.recency - a.recency || aPath.localeCompare(bPath));

  return <section className="worktree-inventory card-section settings-scroll-container" aria-labelledby="worktree-inventory-title" aria-busy={busy}>
    <div className="worktree-inventory-header">
      <h3 id="worktree-inventory-title">托管的工作树</h3>
      <button type="button" className="secondary-btn-sm" aria-label="刷新" title="刷新" disabled={busy} onClick={() => void refresh()}>
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </div>
    {busy && !inventory && <p role="status">正在获取工作树详细信息…</p>}
    {error && <p role="alert">{error}</p>}
    {!!inventory?.errors.length && <details className="worktree-inventory-warnings">
      <summary>部分工作树无法读取（{inventory.errors.length}）</summary>
      <ul>{inventory.errors.map(({ path, message }, index) => <li key={index}>{path} · {message}</li>)}</ul>
    </details>}
    {!busy && !error && !inventory?.errors.length && !groups.size && <p>尚无工作树</p>}
    {sortedGroups.map(([repoPath, group]) => <details className="worktree-inventory-group" key={repoPath} open>
      <summary>
        <strong title={repoPath}>{baseNameFsPath(repoPath) || "未知代码仓库"}</strong>
        <span>{group.rows.length} 个工作树</span><ChevronDown size={14} aria-hidden="true" />
      </summary>
      <ul>{group.rows.sort((a, b) => b.recency - a.recency || a.path.localeCompare(b.path)).map(row => {
        const [primary, ...otherChats] = row.chats;
        return <li key={row.path} className="worktree-inventory-row">
          <div className="worktree-inventory-chat">
            {primary ? <button type="button" className="worktree-chat-link" title="打开聊天"
              onClick={() => onOpenThread(primary.id)}>{primary.title || "无标题对话"}</button> : <span>{baseNameFsPath(row.path)}</span>}
            {primary?.isPinned && <small>已置顶</small>}
            {!!otherChats.length && <details>
              <summary>另有 {otherChats.length} 个聊天</summary>
              <ul>{otherChats.map(chat => <li key={chat.id}>
                <button type="button" className="worktree-chat-link" onClick={() => onOpenThread(chat.id)}>{chat.title || "无标题对话"}</button>
                {chat.isPinned && <small>已置顶</small>}
              </li>)}</ul>
            </details>}
          </div>
          <code dir="ltr" title={row.path}>{row.path}</code>
          {row.chats.some(chat => chat.isPinned) && <small>关联的聊天已置顶，因此无法删除此工作树。</small>}
        </li>;
      })}</ul>
    </details>)}
  </section>;
}
