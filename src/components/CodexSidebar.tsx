import React, { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  BellIcon,
  SearchIcon,
  NewChatComposeIcon,
  FolderIcon,
  PlusIcon,
  FilterIcon,
  PinIcon,
  ArchiveIcon,
  CloseIcon,
  SettingsIcon,
  AutomationIcon,
  SkillIcon,
  FileCodeIcon,
} from "./Icons";
import {
  MainViewRoute,
  ThreadSummary,
  WorkspaceRootItem,
} from "../types";

export interface CodexSidebarProps {
  collapsed: boolean;
  activeRoute: MainViewRoute;
  workspaces: WorkspaceRootItem[];
  activeWorkspace: WorkspaceRootItem | null;
  threads: ThreadSummary[];
  pinnedThreadIds: string[];
  workspaceHints: Record<string, string>;
  activeThreadId: string | null;
  unreadInboxCount: number;
  hasAgentsMd: boolean;
  onNavigate: (route: MainViewRoute) => void;
  onStartNewChat: (workspacePath?: string) => void;
  onSelectWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string, e: React.MouseEvent) => void;
  onPickNewFolder: () => void;
  onSelectThread: (threadId: string) => void;
  onTogglePinThread: (threadId: string, e: React.MouseEvent) => void;
  onArchiveThread: (thread: ThreadSummary, e: React.MouseEvent) => void;
  onDeleteThread?: (thread: ThreadSummary, e: React.MouseEvent) => void;
  onRenameThread: (threadId: string, newName: string) => void;
  onRevealPath?: (path: string, e: React.MouseEvent) => void;
  onOpenAgentsMd: () => void;
  onOpenQuickSearch?: () => void;
}

function normPath(p?: string | null): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export const CodexSidebar: React.FC<CodexSidebarProps> = ({
  collapsed,
  activeRoute,
  workspaces,
  activeWorkspace,
  threads,
  pinnedThreadIds,
  workspaceHints,
  activeThreadId,
  unreadInboxCount,
  hasAgentsMd,
  onNavigate,
  onStartNewChat,
  onSelectWorkspace,
  onRemoveWorkspace,
  onPickNewFolder,
  onSelectThread,
  onTogglePinThread,
  onArchiveThread,
  onDeleteThread,
  onRenameThread,
  onRevealPath,
  onOpenAgentsMd,
  onOpenQuickSearch,
}) => {
  const [showBrandMenu, setShowBrandMenu] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [recentFilterMode, setRecentFilterMode] = useState<"all" | "standalone">("all");
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renamingText, setRenamingText] = useState("");

  if (collapsed) return null;

  const isProjectExpanded = (wsPath: string) => {
    const key = normPath(wsPath);
    if (key in expandedProjects) return expandedProjects[key];
    return normPath(activeWorkspace?.path) === key;
  };

  const toggleProjectExpand = (wsPath: string) => {
    const key = normPath(wsPath);
    const current = isProjectExpanded(wsPath);
    setExpandedProjects((prev) => ({ ...prev, [key]: !current }));
    onSelectWorkspace(wsPath);
  };

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter((t) =>
      (t.name || t.preview || t.id).toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  const pinnedThreads = useMemo(
    () => filteredThreads.filter((t) => pinnedThreadIds.includes(t.id)),
    [filteredThreads, pinnedThreadIds]
  );

  // Map threads to workspaces
  const threadsByProject = useMemo(() => {
    const map: Record<string, ThreadSummary[]> = {};
    for (const ws of workspaces) {
      map[normPath(ws.path)] = [];
    }
    for (const t of filteredThreads) {
      const hintCwd = t.cwd || workspaceHints[t.id] || "";
      const nCwd = normPath(hintCwd);
      if (!nCwd) continue;
      // Match exact or child directory of a workspace root
      for (const ws of workspaces) {
        const nWs = normPath(ws.path);
        if (nWs && (nCwd === nWs || nCwd.startsWith(nWs + "/"))) {
          map[nWs].push(t);
          break;
        }
      }
    }
    return map;
  }, [filteredThreads, workspaces, workspaceHints]);

  const recentThreads = useMemo(() => {
    const unpinned = filteredThreads.filter((t) => !pinnedThreadIds.includes(t.id));
    if (recentFilterMode === "all") return unpinned;
    // Only threads not belonging to any registered workspace
    return unpinned.filter((t) => {
      const hintCwd = normPath(t.cwd || workspaceHints[t.id]);
      if (!hintCwd) return true;
      return !workspaces.some((ws) => {
        const nWs = normPath(ws.path);
        return nWs && (hintCwd === nWs || hintCwd.startsWith(nWs + "/"));
      });
    });
  }, [filteredThreads, pinnedThreadIds, recentFilterMode, workspaces, workspaceHints]);

  const startRename = (t: ThreadSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingThreadId(t.id);
    setRenamingText(t.name || t.preview || "未命名聊天");
  };

  const commitRename = (threadId: string) => {
    if (renamingText.trim()) {
      onRenameThread(threadId, renamingText.trim());
    }
    setRenamingThreadId(null);
  };

  const renderThreadRow = (t: ThreadSummary, indented = false) => {
    const isActive = activeRoute === "thread" && activeThreadId === t.id;
    const isPinned = pinnedThreadIds.includes(t.id);
    return (
      <div
        key={t.id}
        className={`sidebar-thread-row ${isActive ? "active" : ""} ${
          indented ? "indented" : ""
        }`}
        onClick={() => onSelectThread(t.id)}
      >
        <div className="sidebar-thread-left">
          {renamingThreadId === t.id ? (
            <input
              className="sidebar-thread-rename-input"
              value={renamingText}
              onChange={(e) => setRenamingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(t.id);
                if (e.key === "Escape") setRenamingThreadId(null);
              }}
              onBlur={() => commitRename(t.id)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="sidebar-thread-title">
              {t.name || t.preview || "新聊天"}
            </span>
          )}
        </div>
        <div className="sidebar-thread-actions">
          <button
            type="button"
            className="thread-icon-btn"
            title="重命名"
            onClick={(e) => startRename(t, e)}
          >
            ✏️
          </button>
          <button
            type="button"
            className="thread-icon-btn"
            title="归档聊天"
            onClick={(e) => onArchiveThread(t, e)}
          >
            <ArchiveIcon size={12} />
          </button>
          <button
            type="button"
            className="thread-icon-btn"
            title={isPinned ? "取消置顶" : "置顶聊天"}
            onClick={(e) => onTogglePinThread(t.id, e)}
          >
            <PinIcon size={12} />
          </button>
          {onDeleteThread && (
            <button
              type="button"
              className="thread-icon-btn danger"
              title="彻底删除聊天"
              onClick={(e) => onDeleteThread(t, e)}
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="codex-sidebar">
      {/* ── 1. Official Top Header: "Codex ⌄" on Left, Bell + Search on Right ── */}
      <div className="sidebar-top-bar" style={{ position: "relative" }}>
        <button
          type="button"
          className="codex-brand-dropdown-btn"
          onClick={() => setShowBrandMenu((v) => !v)}
        >
          <span className="codex-brand-text">Codex</span>
          <ChevronDownIcon size={13} />
        </button>

        <div className="sidebar-top-icons">
          <button
            type="button"
            className={`sidebar-top-icon-btn ${activeRoute === "inbox" ? "active" : ""}`}
            onClick={() => onNavigate("inbox")}
            title="收件箱与通知 (Inbox)"
          >
            <BellIcon size={15} />
            {unreadInboxCount > 0 && <span className="sidebar-bell-dot" />}
          </button>
          <button
            type="button"
            className={`sidebar-top-icon-btn ${showSearchInput ? "active" : ""}`}
            onClick={() => {
              if (onOpenQuickSearch) {
                onOpenQuickSearch();
              } else {
                setShowSearchInput((v) => !v);
              }
            }}
            title="搜索聊天与文件 (Ctrl+K)"
          >
            <SearchIcon size={15} />
          </button>
        </div>

        {showBrandMenu && (
          <div
            className="composer-popover-menu top-left"
            style={{ top: 44, left: 12, minWidth: 210 }}
          >
            <div
              className="popover-menu-item"
              onClick={() => {
                setShowBrandMenu(false);
                onStartNewChat();
              }}
            >
              <span className="popover-item-title">📝 新聊天 (Ctrl+N)</span>
            </div>
            <div
              className="popover-menu-item"
              onClick={() => {
                setShowBrandMenu(false);
                onNavigate("projects");
              }}
            >
              <span className="popover-item-title">📁 项目中心 (/projects)</span>
            </div>
            <div
              className="popover-menu-item"
              onClick={() => {
                setShowBrandMenu(false);
                onNavigate("scheduled");
              }}
            >
              <span className="popover-item-title">⏱️ 计划任务 (/scheduled)</span>
            </div>
            <div
              className="popover-menu-item"
              onClick={() => {
                setShowBrandMenu(false);
                onNavigate("plugins");
              }}
            >
              <span className="popover-item-title">🧩 插件与技能 (/plugins)</span>
            </div>
            {hasAgentsMd && (
              <div
                className="popover-menu-item"
                onClick={() => {
                  setShowBrandMenu(false);
                  onOpenAgentsMd();
                }}
              >
                <span className="popover-item-title">📜 查看项目 AGENTS.md</span>
              </div>
            )}
            <div className="popover-divider" />
            <div
              className="popover-menu-item"
              onClick={() => {
                setShowBrandMenu(false);
                onNavigate("settings");
              }}
            >
              <span className="popover-item-title">⚙️ 打开设置中心</span>
            </div>
          </div>
        )}
      </div>

      {/* Optional inline search input */}
      {showSearchInput && (
        <div style={{ padding: "2px 12px 6px" }}>
          <input
            type="text"
            className="popover-search-input"
            style={{ marginBottom: 0 }}
            placeholder="搜索聊天或任务..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* ── 2. Action Row: "📝 新聊天" (Matches ref-1-home.png) ── */}
      <div className="sidebar-primary-actions">
        <button
          type="button"
          className={`sidebar-new-chat-row ${
            activeRoute === "home" && !activeThreadId ? "active" : ""
          }`}
          onClick={() => onStartNewChat()}
        >
          <NewChatComposeIcon size={15} />
          <span>新聊天</span>
        </button>

        <button
          type="button"
          className={`sidebar-sub-nav-row ${
            activeRoute === "scheduled" ? "active" : ""
          }`}
          onClick={() => onNavigate("scheduled")}
        >
          <AutomationIcon size={14} />
          <span>计划任务</span>
        </button>

        <button
          type="button"
          className={`sidebar-sub-nav-row ${
            activeRoute === "plugins" ? "active" : ""
          }`}
          onClick={() => onNavigate("plugins")}
        >
          <SkillIcon size={14} />
          <span>插件与技能</span>
        </button>

        <button
          type="button"
          className={`sidebar-sub-nav-row ${
            activeRoute === "review" ? "active" : ""
          }`}
          onClick={() => onNavigate("review")}
        >
          <FileCodeIcon size={14} />
          <span>代码审查</span>
        </button>
      </div>

      {/* ── 3. Three-Section Tree: 置顶 / 项目 / 最近 (Matches ref-1-home.png) ── */}
      <div className="sidebar-threads-scroll">
        {/* Section A: 置顶 (Pinned) */}
        <div className="sidebar-section-header-row">
          <span className="sidebar-section-label">置顶</span>
        </div>
        {pinnedThreads.length > 0 && (
          <div className="sidebar-section-list">
            {pinnedThreads.map((t) => renderThreadRow(t, false))}
          </div>
        )}

        {/* Section B: 项目 (Projects Tree) */}
        <div className="sidebar-section-header-row" style={{ marginTop: 10 }}>
          <span
            className="sidebar-section-label clickable"
            onClick={() => onNavigate("projects")}
            title="点击打开项目中心"
          >
            项目
          </span>
          <div className="sidebar-section-tools">
            <button
              type="button"
              className="sidebar-mini-tool-btn"
              onClick={onPickNewFolder}
              title="添加本地项目文件夹"
            >
              <PlusIcon size={13} />
            </button>
            <button
              type="button"
              className="sidebar-mini-tool-btn"
              onClick={() => onNavigate("projects")}
              title="管理所有项目"
            >
              <FilterIcon size={12} />
            </button>
          </div>
        </div>

        <div className="sidebar-projects-tree">
          {workspaces.map((ws) => {
            const isSelectedWs = normPath(activeWorkspace?.path) === normPath(ws.path);
            const expanded = isProjectExpanded(ws.path);
            const projectThreads = threadsByProject[normPath(ws.path)] || [];

            return (
              <div key={ws.path} className="sidebar-project-group">
                <div
                  className={`sidebar-project-row ${isSelectedWs ? "selected" : ""}`}
                  onClick={() => toggleProjectExpand(ws.path)}
                  title={ws.path}
                >
                  <div className="sidebar-project-left">
                    <span className="project-folder-icon">
                      {expanded ? (
                        <FolderIcon size={14} />
                      ) : (
                        <ChevronRightIcon size={13} />
                      )}
                    </span>
                    <span className="sidebar-project-name">
                      {ws.label || ws.path.split(/[/\\]/).pop()}
                    </span>
                  </div>

                  <div className="sidebar-project-actions">
                    {onRevealPath && (
                      <button
                        type="button"
                        className="thread-icon-btn"
                        title="在系统文件管理器中打开文件夹"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRevealPath(ws.path, e);
                        }}
                      >
                        📂
                      </button>
                    )}
                    <button
                      type="button"
                      className="thread-icon-btn"
                      title="在此项目中新建聊天"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectWorkspace(ws.path);
                        onStartNewChat(ws.path);
                      }}
                    >
                      <PlusIcon size={12} />
                    </button>
                    {workspaces.length > 1 && (
                      <button
                        type="button"
                        className="thread-icon-btn"
                        title="移除项目"
                        onClick={(e) => onRemoveWorkspace(ws.path, e)}
                      >
                        <CloseIcon size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="sidebar-project-children">
                    {projectThreads.length === 0 ? (
                      <div className="sidebar-project-empty">暂无聊天</div>
                    ) : (
                      projectThreads.map((t) => renderThreadRow(t, true))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Section C: 最近 (Recent) */}
        <div className="sidebar-section-header-row" style={{ marginTop: 12 }}>
          <span className="sidebar-section-label">最近</span>
          <div className="sidebar-section-tools">
            <button
              type="button"
              className="sidebar-mini-tool-btn"
              onClick={() =>
                setRecentFilterMode((m) => (m === "all" ? "standalone" : "all"))
              }
              title={
                recentFilterMode === "all"
                  ? "当前显示: 全部最近聊天 (点击仅显示无项目聊天)"
                  : "当前显示: 独立无项目聊天 (点击显示全部)"
              }
            >
              <FilterIcon size={12} />
            </button>
          </div>
        </div>

        <div className="sidebar-section-list">
          {recentThreads.length === 0 ? (
            <div className="sidebar-project-empty" style={{ paddingLeft: 12 }}>
              暂无聊天
            </div>
          ) : (
            recentThreads.map((t) => renderThreadRow(t, false))
          )}
        </div>
      </div>

      {/* ── 4. Bottom Settings Row (Matches ref-1-home.png) ── */}
      <div className="sidebar-bottom-bar">
        <button
          type="button"
          className={`sidebar-settings-footer-btn ${
            activeRoute === "settings" ? "active" : ""
          }`}
          onClick={() => onNavigate("settings")}
        >
          <SettingsIcon size={15} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
};
