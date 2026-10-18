import React, { useEffect, useState } from "react";
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

interface WorktreesViewProps {
  activeWorkspaceRoot: string;
  onStartChatInWorktree: (worktreePath: string) => void;
}

export const WorktreesView: React.FC<WorktreesViewProps> = ({
  activeWorkspaceRoot,
  onStartChatInWorktree,
}) => {
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [startingMode, setStartingMode] = useState<"branch" | "working-tree">(
    "working-tree"
  );
  const [selectedBranch, setSelectedBranch] = useState<string>("HEAD");
  const [creating, setCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await tauriInvoke<GitWorktreeInfo[]>("git_worktrees_list", {
        cwd: activeWorkspaceRoot,
      });
      setWorktrees(list);
      const br = await tauriInvoke<string[]>("git_branches", {
        cwd: activeWorkspaceRoot,
      }).catch(() => []);
      setBranches(br);
      if (br.length > 0 && selectedBranch === "HEAD") {
        setSelectedBranch(br[0]);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  useEffect(() => {
    refresh();
  }, [activeWorkspaceRoot]);

  const handleCreateWorktree = async () => {
    setCreating(true);
    setError(null);
    try {
      await tauriInvoke<GitWorktreeInfo>("git_worktree_create", {
        sourceCwd: activeWorkspaceRoot,
        startingMode,
        branchName: startingMode === "branch" ? selectedBranch : null,
        ownerThreadId: null,
      });
      await refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteWorktree = async (wt: GitWorktreeInfo) => {
    if (!confirm(`确定要移除 Worktree "${wt.path}" 吗？`)) return;
    try {
      await tauriInvoke("git_worktree_delete", {
        worktreePath: wt.path,
        gitDir: wt.gitDir,
      });
      await refresh();
    } catch (err: any) {
      alert(`删除失败: ${err?.message || String(err)}`);
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>Git Worktrees 隔离工作区管理</h2>
          <p className="subtitle">
            在独立目录 (`~/.codex/worktrees`) 中并行运行多个 Agent 任务，互不污染主工作区。
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={refresh}>
          <RefreshCw size={14} /> 刷新列表
        </button>
      </div>

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
              disabled={creating}
            >
              <Plus size={15} />
              <span>{creating ? "正在创建 Worktree..." : "创建隔离 Worktree"}</span>
            </button>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>

      {/* Worktrees Table */}
      <div className="card-section">
        <h3>已存在的 Worktrees ({worktrees.length})</h3>
        {worktrees.length === 0 ? (
          <div className="empty-hint">暂无 Worktree</div>
        ) : (
          <div className="item-cards-list">
            {worktrees.map((wt) => {
              const isMainRepo =
                wt.path.toLowerCase() === activeWorkspaceRoot.toLowerCase();
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
                        <span>绑定会话: {wt.ownerThreadId.slice(0, 12)}...</span>
                      )}
                    </div>
                  </div>
                  <div className="item-card-actions">
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
