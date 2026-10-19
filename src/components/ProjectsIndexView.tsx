import React, { useMemo, useState } from "react";
import {
  FolderIcon,
  PlusIcon,
  SearchIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CloseIcon,
  NewChatComposeIcon,
} from "./Icons";
import { ThreadSummary, WorkspaceRootItem } from "../types";

export interface ProjectsIndexViewProps {
  workspaces: WorkspaceRootItem[];
  activeWorkspace: WorkspaceRootItem | null;
  threads: ThreadSummary[];
  workspaceHints: Record<string, string>;
  onSelectWorkspace: (path: string) => void;
  onStartNewChatInProject: (path: string) => void;
  onSelectThread: (threadId: string) => void;
  onPickNewFolder: () => void;
  onRemoveWorkspace: (path: string, e: React.MouseEvent) => void;
}

function normPath(p?: string | null): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export const ProjectsIndexView: React.FC<ProjectsIndexViewProps> = ({
  workspaces,
  activeWorkspace,
  threads,
  workspaceHints,
  onSelectWorkspace,
  onStartNewChatInProject,
  onSelectThread,
  onPickNewFolder,
  onRemoveWorkspace,
}) => {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.toLowerCase();
    return workspaces.filter(
      (ws) =>
        ws.label.toLowerCase().includes(q) || ws.path.toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  const threadsByProject = useMemo(() => {
    const map: Record<string, ThreadSummary[]> = {};
    for (const ws of workspaces) {
      map[normPath(ws.path)] = [];
    }
    for (const t of threads) {
      const nCwd = normPath(t.cwd || workspaceHints[t.id]);
      if (!nCwd) continue;
      for (const ws of workspaces) {
        const nWs = normPath(ws.path);
        if (nWs && (nCwd === nWs || nCwd.startsWith(nWs + "/"))) {
          map[nWs].push(t);
          break;
        }
      }
    }
    return map;
  }, [workspaces, threads, workspaceHints]);

  return (
    <div className="full-route-view">
      <div className="full-route-container">
        <div className="full-route-header">
          <div>
            <h1 className="full-route-title">项目</h1>
            <p className="full-route-subtitle">
              创建项目以整理聊天，并授予 Codex 访问你电脑上本地文件夹的权限。
            </p>
          </div>
          <button
            type="button"
            className="primary-pill-action-btn"
            onClick={onPickNewFolder}
          >
            <PlusIcon size={15} />
            <span>新建项目</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="route-search-bar">
          <SearchIcon size={15} />
          <input
            type="text"
            placeholder="搜索项目名称或路径..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Projects Table */}
        <div className="projects-index-table">
          <div className="projects-table-head">
            <span>名称</span>
            <span>本地路径</span>
            <span>聊天数</span>
            <span style={{ textAlign: "right" }}>项目操作</span>
          </div>

          {filteredWorkspaces.length === 0 ? (
            <div className="route-empty-state">
              <FolderIcon size={32} />
              <h3>没有项目</h3>
              <p>点击右上角“新建项目”添加本地代码仓库文件夹。</p>
            </div>
          ) : (
            filteredWorkspaces.map((ws) => {
              const key = normPath(ws.path);
              const isExp = expanded[key] ?? normPath(activeWorkspace?.path) === key;
              const projThreads = threadsByProject[key] || [];
              const isCurrent = normPath(activeWorkspace?.path) === key;

              return (
                <div key={ws.path} className="projects-table-group">
                  <div
                    className={`projects-table-row ${isCurrent ? "active" : ""}`}
                    onClick={() => {
                      setExpanded((prev) => ({ ...prev, [key]: !isExp }));
                      onSelectWorkspace(ws.path);
                    }}
                  >
                    <div className="project-col-name">
                      {isExp ? (
                        <ChevronDownIcon size={14} />
                      ) : (
                        <ChevronRightIcon size={14} />
                      )}
                      <FolderIcon size={16} />
                      <span className="project-name-strong">{ws.label}</span>
                      {ws.hasAgentsMd && (
                        <span className="popover-badge recommended">AGENTS.md</span>
                      )}
                    </div>

                    <div className="project-col-path" title={ws.path}>
                      {ws.path}
                    </div>

                    <div className="project-col-count">
                      {projThreads.length} 个聊天
                    </div>

                    <div
                      className="project-col-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="secondary-pill-action-btn"
                        onClick={() => onStartNewChatInProject(ws.path)}
                        title="在项目中开始新的本地聊天"
                      >
                        <NewChatComposeIcon size={13} />
                        <span>新建聊天</span>
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          type="button"
                          className="icon-danger-btn"
                          onClick={(e) => onRemoveWorkspace(ws.path, e)}
                          title="移除项目"
                        >
                          <CloseIcon size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExp && (
                    <div className="project-expanded-threads">
                      {projThreads.length === 0 ? (
                        <div className="project-expanded-empty">暂无聊天</div>
                      ) : (
                        projThreads.map((t) => (
                          <div
                            key={t.id}
                            className="project-expanded-thread-item"
                            onClick={() => onSelectThread(t.id)}
                          >
                            <span>💬 {t.name || t.preview || "未命名聊天"}</span>
                            <span className="thread-open-link">打开聊天 →</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
