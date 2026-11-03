import React, { useEffect, useRef, useState } from "react";
import {
  FolderGit2,
  GitBranch,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import { GitWorktreeInfo } from "../types";
import { createEnvironmentWorktree, type WorktreeCreationProgress } from "../worktreeCreation";
import { cwdInWorktree, loadWorktreeConversations, removeWorktreeWithConversations, type WorktreeConversation } from "../worktreeRemoval";

interface WorktreesViewProps {
  activeWorkspaceRoot: string;
  onSelectThread?: (threadId: string) => void;
  onStartChatInWorktree: (worktreePath: string) => void;
  onOpenTerminalInWorktree?: (worktreePath: string) => void;
}

export const WorktreesView: React.FC<WorktreesViewProps> = ({
  activeWorkspaceRoot,
  onSelectThread,
  onStartChatInWorktree,
  onOpenTerminalInWorktree,
}) => {
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [startingMode, setStartingMode] = useState<"branch" | "working-tree">(
    "working-tree"
  );
  const [selectedBranch, setSelectedBranch] = useState<string>("HEAD");
  const [creating, setCreating] = useState<boolean>(false);
  const [actionBusyPath, setActionBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const actionPendingRef = useRef(false);
  const creationControllerRef = useRef<AbortController | null>(null);
  const deletionControllerRef = useRef<AbortController | null>(null);
  const contextRef = useRef({ root: activeWorkspaceRoot, revision: 0 });
  if (contextRef.current.root !== activeWorkspaceRoot) {
    contextRef.current = { root: activeWorkspaceRoot, revision: contextRef.current.revision + 1 };
  }
  const [conversations, setConversations] = useState<WorktreeConversation[] | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [creationProgress, setCreationProgress] = useState<WorktreeCreationProgress | null>(null);
  const [refreshSkipped, setRefreshSkipped] = useState(false);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const refresh = async () => {
    if (!mountedRef.current) return;
    const request = ++requestRef.current;
    const isCurrent = () => mountedRef.current && request === requestRef.current;
    setConversations(null);
    setConversationError(null);
    try {
      const list = await tauriInvoke<GitWorktreeInfo[]>("git_worktrees_list", {
        cwd: activeWorkspaceRoot,
      });
      if (!isCurrent()) return;
      setWorktrees(list);
      try {
        const related = await loadWorktreeConversations();
        if (!isCurrent()) return;
        setConversations(related);
      } catch (err) {
        if (!isCurrent()) return;
        setConversationError(`会话检查失败，暂不能移除工作树：${String(err)}`);
      }
      const br = await tauriInvoke<string[]>("git_branches", {
        cwd: activeWorkspaceRoot,
      }).catch(() => []);
      if (!isCurrent()) return;
      setBranches(br);
      setSelectedBranch((current) =>
        br.length > 0 && current === "HEAD" ? br[0] : current
      );
      setError(null);
    } catch (err: any) {
      if (isCurrent()) setError(err?.message || String(err));
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    setCreating(false);
    setCreationProgress(null); setRefreshSkipped(false);
    refresh();
    return () => {
      mountedRef.current = false;
      creationControllerRef.current?.abort();
      creationControllerRef.current = null;
      refreshControllerRef.current = null;
      deletionControllerRef.current?.abort();
      deletionControllerRef.current = null;
      ++requestRef.current;
    };
  }, [activeWorkspaceRoot]);

  const handleCreateWorktree = async () => {
    if (creationControllerRef.current || actionPendingRef.current) return;
    const controller = new AbortController(), context = contextRef.current;
    const refreshController = new AbortController();
    creationControllerRef.current = controller;
    refreshControllerRef.current = refreshController;
    setCreating(true);
    setCreationProgress(null); setRefreshSkipped(false);
    setError(null);
    try {
      await createEnvironmentWorktree({
        sourceCwd: activeWorkspaceRoot,
        startingMode,
        branchName: startingMode === "branch" ? selectedBranch : null,
        ownerThreadId: null,
      }, controller.signal, { signal: refreshController.signal, onProgress: progress => {
        if (!mountedRef.current || controller.signal.aborted || context !== contextRef.current || creationControllerRef.current !== controller) return;
        setCreationProgress(progress);
      } });
      if (controller.signal.aborted || context !== contextRef.current) return;
      await refresh();
    } catch (err: any) {
      if (mountedRef.current && context === contextRef.current) {
        await refresh();
        if (mountedRef.current && context === contextRef.current) setError(err?.message || String(err));
      }
    } finally {
      if (creationControllerRef.current === controller) creationControllerRef.current = null;
      if (refreshControllerRef.current === refreshController) refreshControllerRef.current = null;
      if (mountedRef.current && context === contextRef.current) { setCreating(false); setCreationProgress(null); setRefreshSkipped(false); }
    }
  };

  const handleDeleteWorktree = async (wt: GitWorktreeInfo) => {
    if (creationControllerRef.current || actionPendingRef.current || actionBusyPath || conversations === null) return;
    if (conversations.some(thread => thread.isPinned && cwdInWorktree(thread.cwd, wt.path))) return;
    actionPendingRef.current = true;
    const controller = new AbortController();
    deletionControllerRef.current = controller;
    const revision = contextRef.current.revision;
    const isCurrent = () => mountedRef.current && contextRef.current.revision === revision;
    setActionBusyPath(wt.path);
    try {
      const preferences = await tauriInvoke<{ hostId: string; preferences: { confirmBeforeDelete: boolean } }>("worktree_preferences_read", { hostId: "local" });
      if (!isCurrent() || controller.signal.aborted) return;
      if (preferences.hostId !== "local" || typeof preferences.preferences?.confirmBeforeDelete !== "boolean") throw Error("无法确认本地主机的工作树删除偏好，未执行删除。");
      if (preferences.preferences.confirmBeforeDelete && !confirm(`确定要移除 Worktree "${wt.path}" 吗？`)) return;
      if (!isCurrent() || controller.signal.aborted) return;
      const result = await removeWorktreeWithConversations(wt, controller.signal);
      if (!isCurrent()) return;
      await refresh();
      if (isCurrent()) notify(`已移除工作树: ${wt.path}${result.warnings.length ? `；${result.warnings.join("；")}` : ""}`);
    } catch (err: any) {
      if (isCurrent()) {
        // Archives may have partially succeeded; refresh does not roll them back.
        await refresh();
        if (isCurrent()) setError(`删除失败或结果未确认：${err?.message || String(err)}`);
      }
    } finally {
      if (deletionControllerRef.current === controller) deletionControllerRef.current = null;
      actionPendingRef.current = false;
      if (mountedRef.current) setActionBusyPath(null);
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>Git Worktrees 隔离工作区管理</h2>
          <p className="subtitle">
            在设置的工作树目录中并行运行多个 Agent 任务，互不污染主工作区。
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="secondary-btn"
            title="执行 git worktree repair 修复被移动或脱落的工作树关联"
            onClick={async () => {
              try {
                const res = await tauriInvoke<string>("git_worktree_repair", {
                  cwd: activeWorkspaceRoot,
                });
                notify(res ? `修复结果: ${res}` : "✓ 工作树关联健康，无需修复");
                await refresh();
              } catch (err: any) {
                notify(`修复出错: ${err?.message || String(err)}`);
              }
            }}
          >
            🔧 修复工作树
          </button>
          <button type="button" className="secondary-btn" onClick={refresh}>
            <RefreshCw size={14} /> 刷新列表
          </button>
        </div>
      </div>

      {toast && (
        <div className="workbench-toast-banner" style={{ borderRadius: 8, marginBottom: 12 }}>
          {toast}
        </div>
      )}

      {/* Create Worktree Card */}
      <div className="card-section">
        <h3>从当前项目创建新 Codex Worktree</h3>
        <div className="form-grid-row">
          <div className="form-field">
            <label>源项目路径</label>
            <input type="text" value={activeWorkspaceRoot} readOnly />
          </div>
          <div className="form-field">
            <label>初始状态来源</label>
            <select
              value={startingMode}
              onChange={(e) =>
                setStartingMode(e.target.value as "branch" | "working-tree")
              }
            >
              <option value="working-tree">
                当前工作区 (含未提交修改与未跟踪文件)
              </option>
              <option value="branch">指定 Git 分支或 HEAD</option>
            </select>
          </div>
          {startingMode === "branch" && (
            <div className="form-field">
              <label>选择起始分支</label>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                <option value="HEAD">HEAD (当前提交)</option>
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-field form-field-end">
            <button
              type="button"
              className="primary-btn"
              onClick={handleCreateWorktree}
              disabled={creating || !!actionBusyPath}
            >
              <Plus size={15} />
              <span>{creating ? "正在创建 Worktree..." : "创建隔离 Worktree"}</span>
            </button>
            {creating && <button type="button" className="secondary-btn" onClick={() => creationControllerRef.current?.abort()}>取消创建 / 设置</button>}
            {creating && creationProgress?.phase === "upstream-refresh" && <button type="button" className="secondary-btn"
              title="停止获取，并使用本地已有的更改创建工作树" disabled={refreshSkipped} onClick={() => {
                if (!refreshControllerRef.current || refreshControllerRef.current.signal.aborted) return;
                refreshControllerRef.current.abort(); setRefreshSkipped(true);
              }}>跳过更新</button>}
          </div>
        </div>
        {creating && creationProgress?.phase === "upstream-refresh" && <p role="status">{creationProgress.text || "正在获取最新更改"}</p>}
        {error && <div className="error-banner">{error}</div>}
      </div>

      {/* Worktrees Table */}
      <div className="card-section">
        <h3>已存在的 Worktrees ({worktrees.length})</h3>
        {conversationError && <div className="error-banner">{conversationError}</div>}
        {actionBusyPath && deletionControllerRef.current && <button type="button" className="secondary-btn" onClick={() => deletionControllerRef.current?.abort()}>取消移除 / 清理</button>}
        {worktrees.length === 0 ? (
          <div className="empty-hint">暂无 Worktree</div>
        ) : (
          <div className="item-cards-list">
            {worktrees.map((wt) => {
              const isMainRepo = wt.isPrimary !== false;
              const hasPinnedChat = conversations?.some(thread => thread.isPinned && cwdInWorktree(thread.cwd, wt.path));
              return (
                <div key={wt.path} className="item-card">
                  <div className="item-card-main">
                    <div className="item-card-title-row">
                      <FolderGit2 size={16} className="accent-icon" />
                      <strong className="mono-text">{wt.path}</strong>
                      {wt.isCodexManaged && (
                        <span className="tag-badge accent">Codex 托管</span>
                      )}
                      {isMainRepo && <span className="tag-badge">主工作区</span>}
                      {wt.hasUncommittedChanges && (
                        <span className="tag-badge warning">有未提交修改</span>
                      )}
                    </div>
                    <div className="item-card-meta">
                      <span>
                        <GitBranch size={12} /> 分支: {wt.branch || "detached"}{" "}
                        {wt.head ? `(${wt.head})` : ""}
                      </span>
                      <span>主仓库: {wt.gitDir}</span>
                      {wt.ownerThreadId && (
                        <button
                          type="button"
                          className="tag-badge"
                          style={{
                            cursor: onSelectThread ? "pointer" : "default",
                            border: "1px solid var(--border-subtle)",
                            background: "var(--bg-card)",
                            padding: "1px 6px",
                          }}
                          onClick={() => onSelectThread?.(wt.ownerThreadId!)}
                          title={`跳转到绑定会话: ${wt.ownerThreadId}`}
                        >
                          绑定会话: {wt.ownerThreadId.slice(0, 10)}… ↗
                        </button>
                      )}
                    </div>
                  </div>
        <div className="item-card-actions">
          <button
            type="button"
            className="secondary-btn-sm"
            title="在系统文件管理器中打开此 Worktree 文件夹"
            onClick={async () => {
              try {
                await tauriInvoke("reveal_path_in_explorer", { path: wt.path });
                notify("✓ 已在系统文件管理器中打开文件夹");
              } catch (err: any) {
                notify(`打开失败: ${String(err)}`);
              }
            }}
          >
            📂 目录
          </button>
          {onOpenTerminalInWorktree && (
            <button
              type="button"
              className="secondary-btn-sm"
              title="在此 Worktree 打开终端"
              onClick={() => onOpenTerminalInWorktree(wt.path)}
            >
              💻 终端
            </button>
          )}
          {!isMainRepo && wt.hasUncommittedChanges && (
            <button
              type="button"
              className="secondary-btn-sm accent-border"
              title="将此隔离 Worktree 中的改动应用合并回当前主工作区"
              disabled={actionBusyPath === wt.path}
              onClick={async () => {
                if (actionPendingRef.current || actionBusyPath) return;
                actionPendingRef.current = true;
                const revision = contextRef.current.revision;
                const isCurrent = () => mountedRef.current && contextRef.current.revision === revision;
                setActionBusyPath(wt.path);
                try {
                  const res = await tauriInvoke<string>("git_worktree_bring_changes_back", {
                    worktreePath: wt.path,
                    targetCwd: activeWorkspaceRoot,
                  });
                  if (!isCurrent()) return;
                  notify(res);
                  await refresh();
                } catch (err: any) {
                  if (isCurrent()) notify(`带回失败: ${err?.message || String(err)}`);
                } finally {
                  actionPendingRef.current = false;
                  if (mountedRef.current) setActionBusyPath(null);
                }
              }}
            >
              📥 带回主工作区
            </button>
          )}
          <button
            type="button"
            className="primary-btn-sm"
            onClick={() => onStartChatInWorktree(wt.path)}
          >
            <MessageSquarePlus size={13} /> 在此启动会话
          </button>
          {!isMainRepo && (
            <button
              type="button"
              className="danger-btn-sm"
              disabled={!!actionBusyPath || conversations === null || !!hasPinnedChat}
              title={hasPinnedChat ? "请先取消置顶此工作树中的会话" : conversations === null ? "正在确认关联会话" : "移除工作树"}
              onClick={() => handleDeleteWorktree(wt)}
            >
              <Trash2 size={13} /> 移除
            </button>
          )}
        </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
