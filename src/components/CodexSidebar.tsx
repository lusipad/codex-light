import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  EllipsisIcon,
} from "./Icons";
import {
  MainViewRoute,
  ThreadSummary,
  WorkspaceRootItem,
} from "../types";
import { tauriListen } from "../bridge";
import {
  ThreadSection,
  createSection,
  deleteSection,
  listSections,
  moveThreadToSection,
  updateSection,
} from "../threadSections";

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

  /* ── 以下均为可选新增 props（向后兼容，不传时行为不变） ── */
  /** app-server 连接 / 父级数据刷新时递增此值，可触发侧栏重新拉取分区。 */
  refreshToken?: number | string | null;
  /** 分区移动/删除等操作完成后通知父级刷新 threads（可选）。 */
  onThreadsChanged?: () => void;
  /** 轻量提示出口（可选；App 可直接传 showAppToast）。 */
  onShowToast?: (
    message: string,
    type?: "info" | "success" | "error"
  ) => void;
}

interface ThreadMenuState {
  threadId: string;
  x: number;
  y: number;
}

function normPath(p?: string | null): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

const EMPTY_SECTION_NAMES = new Set(["pinned", "置顶"]);

function isBuiltinEmptySection(section: ThreadSection, count: number): boolean {
  // 官方内置的 "Pinned" 分区与侧栏「置顶」区重复；为空时不渲染，
  // 非空时照常渲染，避免丢失服务端已有分组数据。
  return count === 0 && EMPTY_SECTION_NAMES.has(section.name.trim().toLowerCase());
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
  refreshToken,
  onThreadsChanged,
  onShowToast,
}) => {
  const [showBrandMenu, setShowBrandMenu] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [recentFilterMode, setRecentFilterMode] = useState<"all" | "standalone">("all");
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renamingText, setRenamingText] = useState("");

  /* ── 自定义分区（threadSection/*） ── */
  const [sections, setSections] = useState<ThreadSection[]>([]);
  const [sectionsAvailable, setSectionsAvailable] = useState(false);
  /** 本地乐观覆盖：threadId → sectionId（null 表示移出分区） */
  const [sectionOverrides, setSectionOverrides] = useState<
    Record<string, string | null>
  >({});
  const [sectionBusy, setSectionBusy] = useState(false);
  const [showSectionCreator, setShowSectionCreator] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renamingSectionName, setRenamingSectionName] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sectionRenameBlurGuardRef = useRef(false);

  /* ── 会话「移动到分区」菜单 ── */
  const [threadMenu, setThreadMenu] = useState<ThreadMenuState | null>(null);
  const [threadMenuMoveOpen, setThreadMenuMoveOpen] = useState(false);

  const notify = useCallback(
    (message: string, type: "info" | "success" | "error" = "info") => {
      if (onShowToast) {
        onShowToast(message, type);
      } else if (type === "error") {
        console.warn(message);
      }
    },
    [onShowToast]
  );

  const loadSections = useCallback(async () => {
    try {
      const list = await listSections();
      setSections(list);
      setSectionsAvailable(true);
      // 清理指向已删除分区的本地覆盖
      setSectionOverrides((prev) => {
        const ids = new Set(list.map((s) => s.id));
        let changed = false;
        const next: Record<string, string | null> = { ...prev };
        for (const threadId of Object.keys(next)) {
          const sectionId = next[threadId];
          if (sectionId && !ids.has(sectionId)) {
            next[threadId] = null;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (e) {
      // 协议不可用 / app-server 未连接：静默隐藏自定义分区区，不影响原有列表
      console.warn("threadSection/list failed, custom sections hidden:", e);
      setSections([]);
      setSectionsAvailable(false);
    }
  }, []);

  // 挂载时 & refreshToken 变化时重新拉取分区
  useEffect(() => {
    void loadSections();
  }, [loadSections, refreshToken]);

  // app-server 连接成功后重试（首次挂载时可能尚未连接）
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    tauriListen<{ connected?: boolean } | null>(
      "app-server:status",
      (status) => {
        if (!disposed && status && status.connected) {
          void loadSections();
        }
      }
    )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [loadSections]);

  // 「移动到分区」菜单：点击外部 / Esc / 滚动时关闭
  useEffect(() => {
    if (!threadMenu) return;
    const close = () => {
      setThreadMenu(null);
      setThreadMenuMoveOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [threadMenu]);

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

  /** 会话当前所属分区（本地乐观覆盖优先于 props 的 section 字段）。 */
  const sectionIdOfThread = useCallback(
    (thread: ThreadSummary): string | null => {
      if (Object.prototype.hasOwnProperty.call(sectionOverrides, thread.id)) {
        return sectionOverrides[thread.id] ?? null;
      }
      return thread.section ?? null;
    },
    [sectionOverrides]
  );

  const threadsBySection = useMemo(() => {
    const map: Record<string, ThreadSummary[]> = {};
    for (const section of sections) map[section.id] = [];
    for (const thread of filteredThreads) {
      const sectionId = sectionIdOfThread(thread);
      if (sectionId && map[sectionId]) map[sectionId].push(thread);
    }
    return map;
  }, [filteredThreads, sections, sectionIdOfThread]);

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

  /* ── 自定义分区操作 ── */

  const cancelSectionCreator = () => {
    setShowSectionCreator(false);
    setNewSectionName("");
  };

  const handleCreateSection = async () => {
    const name = newSectionName.trim();
    if (!name || sectionBusy) return;
    setSectionBusy(true);
    try {
      const created = await createSection(name);
      setSections((prev) =>
        prev.some((section) => section.id === created.id) ? prev : [...prev, created]
      );
      setShowSectionCreator(false);
      setNewSectionName("");
      notify(`已创建分区「${created.name}」`, "info");
    } catch (e: any) {
      notify(`创建分区失败：${e?.message || e}`, "error");
    } finally {
      setSectionBusy(false);
    }
  };

  const startRenameSection = (section: ThreadSection, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRenamingSectionId(section.id);
    setRenamingSectionName(section.name);
  };

  const cancelRenameSection = () => {
    setRenamingSectionId(null);
    setRenamingSectionName("");
  };

  const commitRenameSection = async (section: ThreadSection) => {
    const name = renamingSectionName.trim();
    setRenamingSectionId(null);
    setRenamingSectionName("");
    if (!name || name === section.name) return;
    try {
      const updated = await updateSection(section.id, name);
      setSections((prev) =>
        prev.map((item) =>
          item.id === section.id ? { ...item, name: updated.name || name } : item
        )
      );
      notify(`已重命名分区「${updated.name || name}」`, "info");
    } catch (e: any) {
      notify(`重命名分区失败：${e?.message || e}`, "error");
    }
  };

  const handleDeleteSection = async (section: ThreadSection) => {
    if (sectionBusy) return;
    const affected = threads.filter((t) => sectionIdOfThread(t) === section.id);
    const confirmed = window.confirm(
      `删除分区「${section.name}」？\n其中的 ${affected.length} 个聊天将移出该分区（不会删除聊天）。`
    );
    if (!confirmed) return;

    setSectionBusy(true);
    let moveFailures = 0;
    for (const thread of affected) {
      try {
        await moveThreadToSection(thread.id, null);
      } catch {
        moveFailures += 1;
      }
    }
    // 即使个别移动失败，也先在本地把线程归回未分组
    setSectionOverrides((prev) => {
      const next: Record<string, string | null> = { ...prev };
      for (const thread of affected) next[thread.id] = null;
      for (const threadId of Object.keys(next)) {
        if (next[threadId] === section.id) next[threadId] = null;
      }
      return next;
    });

    try {
      await deleteSection(section.id);
      setSections((prev) => prev.filter((item) => item.id !== section.id));
      onThreadsChanged?.();
      if (moveFailures > 0) {
        notify(
          `已删除分区「${section.name}」，但有 ${moveFailures} 个聊天未能确认移出`,
          "info"
        );
      } else {
        notify(`已删除分区「${section.name}」`, "info");
      }
    } catch (e: any) {
      notify(`删除分区失败：${e?.message || e}`, "error");
      // 以服务端为准重新同步
      await loadSections();
    } finally {
      setSectionBusy(false);
    }
  };

  const handleMoveThreadToSection = async (
    threadId: string,
    sectionId: string | null
  ) => {
    setThreadMenu(null);
    setThreadMenuMoveOpen(false);
    try {
      await moveThreadToSection(threadId, sectionId);
      setSectionOverrides((prev) => ({ ...prev, [threadId]: sectionId }));
      onThreadsChanged?.();
      const targetName = sectionId
        ? sections.find((section) => section.id === sectionId)?.name
        : null;
      notify(
        targetName ? `已移动到分区「${targetName}」` : "已移出分区",
        "info"
      );
    } catch (e: any) {
      notify(`移动聊天到分区失败：${e?.message || e}`, "error");
    }
  };

  const openThreadMenu = (
    thread: ThreadSummary,
    x: number,
    y: number,
    e?: React.MouseEvent
  ) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const menuWidth = 216;
    const menuHeight = 320;
    const left = Math.max(
      8,
      Math.min(x, Math.max(8, window.innerWidth - menuWidth - 8))
    );
    const top = Math.max(
      8,
      Math.min(y, Math.max(8, window.innerHeight - menuHeight))
    );
    setThreadMenu({ threadId: thread.id, x: left, y: top });
    setThreadMenuMoveOpen(false);
  };

  const openThreadMenuFromButton = (
    thread: ThreadSummary,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openThreadMenu(thread, rect.left, rect.bottom + 4, e);
  };

  const renderThreadMenu = () => {
    if (!threadMenu) return null;
    const thread = threads.find((t) => t.id === threadMenu.threadId);
    if (!thread) return null;
    const currentSectionId = sectionIdOfThread(thread);
    const hasSections = sections.length > 0;

    return (
      <div
        className="composer-popover-menu"
        style={{
          position: "fixed",
          left: threadMenu.x,
          top: threadMenu.y,
          zIndex: 400,
          minWidth: 208,
          maxHeight: 340,
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popover-section-label">会话操作</div>
        <div
          className="popover-menu-item"
          onClick={() => setThreadMenuMoveOpen((open) => !open)}
        >
          <span className="popover-item-title">
            {threadMenuMoveOpen ? "移动到分区 ▾" : "移动到分区 ▸"}
          </span>
          {currentSectionId && (
            <span className="popover-badge">
              {sections.find((section) => section.id === currentSectionId)?.name ||
                "已分区"}
            </span>
          )}
        </div>

        {threadMenuMoveOpen && (
          <div style={{ paddingLeft: 4 }}>
            {hasSections ? (
              sections.map((section) => (
                <div
                  key={section.id}
                  className={`popover-menu-item ${
                    section.id === currentSectionId ? "selected" : ""
                  }`}
                  onClick={() =>
                    void handleMoveThreadToSection(thread.id, section.id)
                  }
                >
                  <span className="popover-item-title">📁 {section.name}</span>
                  {section.id === currentSectionId && (
                    <span className="popover-badge recommended">当前</span>
                  )}
                </div>
              ))
            ) : (
              <div
                className="popover-menu-item"
                style={{ cursor: "default", opacity: 0.65 }}
              >
                <span className="popover-item-desc">还没有分区，请先新建分区</span>
              </div>
            )}
            <div className="popover-divider" />
            <div
              className="popover-menu-item"
              onClick={() => void handleMoveThreadToSection(thread.id, null)}
            >
              <span className="popover-item-title">↩️ 移出分区</span>
            </div>
          </div>
        )}

        <div className="popover-divider" />
        <div
          className="popover-menu-item"
          onClick={() => {
            setThreadMenu(null);
            setThreadMenuMoveOpen(false);
            onSelectThread(thread.id);
          }}
        >
          <span className="popover-item-title">💬 打开聊天</span>
        </div>
        <div
          className="popover-menu-item"
          onClick={() => {
            setThreadMenu(null);
            setThreadMenuMoveOpen(false);
            setRenamingThreadId(thread.id);
            setRenamingText(thread.name || thread.preview || "未命名聊天");
          }}
        >
          <span className="popover-item-title">✏️ 重命名聊天</span>
        </div>
      </div>
    );
  };

  const renderThreadRow = (t: ThreadSummary, indented = false) => {
    const isActive = activeRoute === "thread" && activeThreadId === t.id;
    const isPinned = pinnedThreadIds.includes(t.id);
    const currentSectionId = sectionIdOfThread(t);
    return (
      <div
        key={t.id}
        className={`sidebar-thread-row ${isActive ? "active" : ""} ${
          indented ? "indented" : ""
        }`}
        onClick={() => onSelectThread(t.id)}
        onContextMenu={(e) => {
          if (!sectionsAvailable) return;
          e.preventDefault();
          e.stopPropagation();
          openThreadMenu(t, e.clientX, e.clientY);
        }}
        title={
          currentSectionId
            ? `分区：${
                sections.find((section) => section.id === currentSectionId)?.name ||
                "自定义"
              }`
            : undefined
        }
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
          {sectionsAvailable && (
            <button
              type="button"
              className="thread-icon-btn"
              title="移动到分区"
              onClick={(e) => openThreadMenuFromButton(t, e)}
            >
              <EllipsisIcon size={12} />
            </button>
          )}
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

        <button
          type="button"
          className={`sidebar-sub-nav-row ${
            activeRoute === "archive" ? "active" : ""
          }`}
          onClick={() => onNavigate("archive")}
        >
          <ArchiveIcon size={14} />
          <span>已归档会话</span>
        </button>
      </div>

      {/* ── 3. Tree: 置顶 / 自定义分区 / 项目 / 最近 ── */}
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

        {/* Section A2: 自定义分区 (threadSection/*) —— 协议不可用时整块隐藏 */}
        {sectionsAvailable && (
          <>
            <div className="sidebar-section-header-row" style={{ marginTop: 10 }}>
              <span className="sidebar-section-label">自定义分区</span>
              <div className="sidebar-section-tools">
                <button
                  type="button"
                  className="sidebar-mini-tool-btn"
                  title="新建分区"
                  disabled={sectionBusy}
                  onClick={() => {
                    setShowSectionCreator(true);
                    setNewSectionName("");
                    setRenamingSectionId(null);
                  }}
                >
                  <PlusIcon size={13} />
                </button>
              </div>
            </div>

            {showSectionCreator && (
              <div
                className="sidebar-project-row"
                style={{ cursor: "default", gap: 6 }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  className="sidebar-thread-rename-input"
                  placeholder="分区名称"
                  value={newSectionName}
                  autoFocus
                  disabled={sectionBusy}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateSection();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelSectionCreator();
                    }
                  }}
                />
                <button
                  type="button"
                  className="sidebar-mini-tool-btn"
                  title="创建分区"
                  disabled={sectionBusy || !newSectionName.trim()}
                  onClick={() => void handleCreateSection()}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className="sidebar-mini-tool-btn"
                  title="取消"
                  disabled={sectionBusy}
                  onClick={cancelSectionCreator}
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            )}

            <div className="sidebar-projects-tree">
              {sections.map((section) => {
                const sectionThreads = threadsBySection[section.id] || [];
                const count = sectionThreads.length;
                if (isBuiltinEmptySection(section, count)) return null;
                const isCollapsed = !!collapsedSections[section.id];
                const isRenaming = renamingSectionId === section.id;
                return (
                  <div className="sidebar-project-group" key={section.id}>
                    <div
                      className="sidebar-project-row"
                      title={section.name}
                      onClick={() => {
                        if (isRenaming) return;
                        setCollapsedSections((prev) => ({
                          ...prev,
                          [section.id]: !isCollapsed,
                        }));
                      }}
                    >
                      <div className="sidebar-project-left">
                        <span className="project-folder-icon">
                          {isCollapsed ? (
                            <ChevronRightIcon size={13} />
                          ) : (
                            <ChevronDownIcon size={13} />
                          )}
                        </span>
                        {isRenaming ? (
                          <input
                            type="text"
                            className="sidebar-thread-rename-input"
                            value={renamingSectionName}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenamingSectionName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                sectionRenameBlurGuardRef.current = true;
                                void commitRenameSection(section);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRenameSection();
                              }
                            }}
                            onBlur={() => {
                              if (sectionRenameBlurGuardRef.current) {
                                sectionRenameBlurGuardRef.current = false;
                                return;
                              }
                              void commitRenameSection(section);
                            }}
                          />
                        ) : (
                          <>
                            <span className="sidebar-project-name">
                              {section.name}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-tertiary)",
                                flexShrink: 0,
                              }}
                            >
                              {count}
                            </span>
                          </>
                        )}
                      </div>

                      <div
                        className="sidebar-project-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="thread-icon-btn"
                          title="新建分区"
                          disabled={sectionBusy}
                          onClick={() => {
                            setShowSectionCreator(true);
                            setNewSectionName("");
                            setRenamingSectionId(null);
                          }}
                        >
                          <PlusIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className="thread-icon-btn"
                          title="重命名分区"
                          onClick={(e) => startRenameSection(section, e)}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="thread-icon-btn danger"
                          title="删除分区（聊天会移出分区）"
                          disabled={sectionBusy}
                          onClick={() => void handleDeleteSection(section)}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="sidebar-project-children">
                        {count === 0 ? (
                          <div className="sidebar-project-empty">暂无聊天</div>
                        ) : (
                          sectionThreads.map((t) => renderThreadRow(t, true))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
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

      {/* ── 5. 会话「移动到分区」浮动菜单 ── */}
      {renderThreadMenu()}
    </aside>
  );
};
