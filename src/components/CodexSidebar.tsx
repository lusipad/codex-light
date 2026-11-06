import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
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
  EllipsisIcon,
  CheckIcon,
} from "./Icons";
import {
  MainViewRoute,
  ThreadSummary,
  WorkspaceRootItem,
  SidebarProjectMembership,
  SidebarLocalProject,
  ThreadReadState,
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
import { ThreadActionsMenu, ThreadActionItem } from "./ThreadActionsMenu";
import { RenameThreadDialog } from "./RenameThreadDialog";
import { SidebarThreadHoverCard } from "./SidebarThreadHoverCard";
import { applySidebarOrder, mergeSidebarOrder, moveVisibleSidebarThread, prependSidebarThread, sidebarDropTarget } from "../sidebarOrder";
import { buildSidebarProjectGroups, sidebarThreadProjects } from "../sidebarProjects";

export interface CodexSidebarProps {
  collapsed: boolean;
  activeRoute: MainViewRoute;
  workspaces: WorkspaceRootItem[];
  activeWorkspace: WorkspaceRootItem | null;
  threads: ThreadSummary[];
  pinnedThreadIds: string[];
  workspaceHints: Record<string, string>;
  projectMembership?: SidebarProjectMembership;
  activeThreadId: string | null;
  activityAttentionCount: number;
  activityOnly: boolean;
  activityThreadIds: string[];
  activityVisibleCount?: number;
  onLoadMoreActivity?: () => void;
  onToggleActivity: () => void;
  onMarkAllRead: () => void;
  hasAgentsMd: boolean;
  onNavigate: (route: MainViewRoute) => void;
  onStartNewChat: (workspacePath?: string, project?: SidebarLocalProject) => void;
  onRemoveWorkspace: (path: string, e?: React.MouseEvent) => void;
  onPickNewFolder: () => void;
  onSelectThread: (threadId: string) => void;
  onTogglePinThread: (threadId: string, e: React.MouseEvent) => void;
  onArchiveThread: (thread: ThreadSummary, e: React.MouseEvent) => void;
  onDeleteThread?: (thread: ThreadSummary, e: React.MouseEvent) => void;
  onRenameThread: (threadId: string, newName: string) => void;
  onSetThreadReadState?: (threadId: string, expectedRevision: string, unread: boolean) => void;
  onMoveThreadToProject?: (threadId: string, targetProjectId: string | null) => void | Promise<void>;
  onRevealPath?: (path: string, e?: React.MouseEvent) => void;
  onOpenAgentsMd: () => void;
  onOpenQuickSearch?: () => void;
  onToggleCollapse?: () => void;

  /* ── 以下均为可选新增 props（向后兼容，不传时行为不变） ── */
  /** app-server 连接 / 父级数据刷新时递增此值，可触发侧栏重新拉取分区。 */
  refreshToken?: number | string | null;
  createdThread?: Pick<ThreadSummary, "id" | "cwd" | "projectId"> | null;
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
  readState?: ThreadReadState | null;
}

interface ThreadOrderContext {
  key: string;
  allIds: string[];
  visibleIds: string[];
}

function normPath(p?: string | null): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

const EMPTY_SECTION_NAMES = new Set(["pinned", "置顶"]);
const EMPTY_PROJECT_MEMBERSHIP: SidebarProjectMembership = {
  threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {},
};

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
  projectMembership = EMPTY_PROJECT_MEMBERSHIP,
  activeThreadId,
  activityAttentionCount,
  activityOnly,
  activityThreadIds,
  activityVisibleCount = 10,
  onLoadMoreActivity,
  onToggleActivity,
  onMarkAllRead,
  onNavigate,
  onStartNewChat,
  onRemoveWorkspace,
  onPickNewFolder,
  onSelectThread,
  onTogglePinThread,
  onArchiveThread,
  onDeleteThread,
  onRenameThread,
  onSetThreadReadState,
  onMoveThreadToProject,
  onRevealPath,
  onOpenQuickSearch,
  refreshToken,
  createdThread,
  onThreadsChanged,
  onShowToast,
}) => {
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("codex_sidebar_project_expansion_v1") || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
    } catch {
      return {};
    }
  });
  const [projectThreadLimits, setProjectThreadLimits] = useState<Record<string, number>>({});
  const projectGroups = useMemo(
    () => buildSidebarProjectGroups(workspaces, projectMembership),
    [workspaces, projectMembership],
  );
  useEffect(() => {
    localStorage.setItem("codex_sidebar_project_expansion_v1", JSON.stringify(expandedProjects));
  }, [expandedProjects]);
  const [organizeMode, setOrganizeMode] = useState<"project" | "list">(() => {
    return (localStorage.getItem("codex_sidebar_organize_mode") as "project" | "list") || "project";
  });
  const [chatSortMode, setChatSortMode] = useState<"updated_at" | "manual">(() => {
    return localStorage.getItem("codex_sidebar_sort_mode") === "manual" ? "manual" : "updated_at";
  });
  const [manualOrders, setManualOrders] = useState<Record<string, string[]>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("codex_sidebar_manual_orders_v1") || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string")));
    } catch {
      return {};
    }
  });
  const draggedThreadRef = useRef<{ id: string; group: string; pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; moved: boolean } | null>(null);
  const [dragVisual, setDragVisual] = useState<{
    id: string; group: string; label: string; left: number; top: number; width: number; height: number;
    drop: { beforeId: string | null } | null;
  } | null>(null);
  const suppressRowClickRef = useRef(false);
  const seenCreatedThreadRef = useRef<string | null>(null);
  const cancelThreadDrag = useCallback(() => {
    if (draggedThreadRef.current?.moved) suppressRowClickRef.current = true;
    draggedThreadRef.current = null;
    setDragVisual(null);
  }, []);
  useEffect(() => {
    localStorage.setItem("codex_sidebar_sort_mode", chatSortMode);
    cancelThreadDrag();
  }, [chatSortMode, cancelThreadDrag]);
  useEffect(() => {
    const dragged = draggedThreadRef.current;
    if (dragged && (collapsed || activityOnly || !threads.some((thread) => thread.id === dragged.id))) cancelThreadDrag();
  }, [collapsed, activityOnly, threads, cancelThreadDrag]);
  useEffect(() => {
    localStorage.setItem("codex_sidebar_manual_orders_v1", JSON.stringify(manualOrders));
  }, [manualOrders]);
  useEffect(() => {
    if (chatSortMode !== "manual") return;
    const cancelDrag = cancelThreadDrag;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") cancelDrag();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelDrag();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("resize", cancelDrag);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("resize", cancelDrag);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      draggedThreadRef.current = null;
    };
  }, [chatSortMode, cancelThreadDrag]);
  const [showProjectsInRecents, setShowProjectsInRecents] = useState(() => {
    const saved = localStorage.getItem("codex_sidebar_show_projects_in_recents");
    if (saved === "true" || saved === "false") return saved === "true";
    const legacy = localStorage.getItem("codex_sidebar_filter_scope");
    return legacy !== "projectless" && legacy !== "current";
  });
  useEffect(() => {
    localStorage.setItem("codex_sidebar_show_projects_in_recents", String(showProjectsInRecents));
  }, [showProjectsInRecents]);
  const [renamingThread, setRenamingThread] = useState<ThreadSummary | null>(null);

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
  const [sectionCreatorThreadId, setSectionCreatorThreadId] = useState<string | null>(null);
  const sectionCreateInFlightRef = useRef(false);
  const sectionCreateDialogRef = useRef<HTMLDialogElement>(null);
  const sectionCreatorReturnFocusRef = useRef<HTMLElement | null>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renamingSectionName, setRenamingSectionName] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sectionRenameBlurGuardRef = useRef(false);
  useEffect(() => {
    if (sectionCreatorThreadId) {
      const dialog = sectionCreateDialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
      return () => {
        if (dialog?.open) dialog.close();
      };
    }
    const returnFocus = sectionCreatorReturnFocusRef.current;
    sectionCreatorReturnFocusRef.current = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }, [sectionCreatorThreadId]);

  /* ── 会话「移动到分区」菜单 ── */
  const [threadMenu, setThreadMenu] = useState<ThreadMenuState | null>(null);
  const [threadMenuMoveOpen, setThreadMenuMoveOpen] = useState(false);
  const [threadMenuSubmenuType, setThreadMenuSubmenuType] = useState<"sections" | "projects">("sections");
  const threadMenuSubmenuTypeRef = useRef<"sections" | "projects">("sections");
  threadMenuSubmenuTypeRef.current = threadMenuSubmenuType;
  const threadMenuMoveOpenRef = useRef(false);
  threadMenuMoveOpenRef.current = threadMenuMoveOpen;
  const [hoverCard, setHoverCard] = useState<{ threadId: string; anchor: HTMLElement } | null>(null);
  const closeHoverCard = useCallback(() => setHoverCard(null), []);
  const threadMenuRef = useRef<HTMLDivElement>(null);
  const threadMenuSectionTriggerRef = useRef<HTMLButtonElement>(null);
  const threadMenuProjectTriggerRef = useRef<HTMLButtonElement>(null);
  const threadMenuSectionSubmenuRef = useRef<HTMLDivElement>(null);
  const threadMenuSectionFocusRef = useRef(false);
  const [threadMenuSectionSubmenuPosition, setThreadMenuSectionSubmenuPosition] = useState<{ left: number; top: number } | null>(null);
  const threadMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const closeThreadMenu = useCallback((restoreFocus = false) => {
    setThreadMenu(null);
    setThreadMenuMoveOpen(false);
    setThreadMenuSubmenuType("sections");
    setThreadMenuSectionSubmenuPosition(null);
    threadMenuSectionFocusRef.current = false;
    const previous = threadMenuReturnFocusRef.current;
    threadMenuReturnFocusRef.current = null;
    if (restoreFocus && previous?.isConnected) previous.focus();
  }, []);

  const updateThreadMenuSectionSubmenuPosition = useCallback(() => {
    const trigger = threadMenuSubmenuType === "projects"
      ? threadMenuProjectTriggerRef.current
      : threadMenuSectionTriggerRef.current;
    const submenu = threadMenuSectionSubmenuRef.current;
    if (!trigger || !submenu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const left = triggerRect.right + gap + submenuRect.width <= window.innerWidth - margin
      ? triggerRect.right + gap
      : triggerRect.left - gap - submenuRect.width;
    const next = {
      left: Math.max(margin, Math.min(left, window.innerWidth - submenuRect.width - margin)),
      top: Math.max(margin, Math.min(triggerRect.top - 4, window.innerHeight - submenuRect.height - margin)),
    };
    setThreadMenuSectionSubmenuPosition((previous) =>
      previous?.left === next.left && previous.top === next.top ? previous : next
    );
  }, [threadMenuSubmenuType]);

  useLayoutEffect(() => {
    if (!threadMenu || !threadMenuMoveOpen) return;
    updateThreadMenuSectionSubmenuPosition();
    if (threadMenuSectionFocusRef.current) {
      threadMenuSectionFocusRef.current = false;
      threadMenuSectionSubmenuRef.current
        ?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')
        ?.focus();
    }
  }, [threadMenu, threadMenuMoveOpen, updateThreadMenuSectionSubmenuPosition]);

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

  // 会话菜单：关闭时区分键盘返回与外部移焦，内部滚动不关闭自身。
  useEffect(() => {
    if (!threadMenu) return;
    threadMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    const close = () => closeThreadMenu(false);
    const onMouseDown = (e: MouseEvent) => {
      if (!threadMenuRef.current?.contains(e.target as Node) &&
        !threadMenuSectionSubmenuRef.current?.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
      if (!threadMenuRef.current?.contains(e.target as Node) &&
        !threadMenuSectionSubmenuRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (threadMenuMoveOpenRef.current) {
        setThreadMenuMoveOpen(false);
        setThreadMenuSectionSubmenuPosition(null);
        (threadMenuSubmenuTypeRef.current === "projects"
          ? threadMenuProjectTriggerRef.current
          : threadMenuSectionTriggerRef.current)?.focus();
      } else {
        closeThreadMenu(true);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [threadMenu, closeThreadMenu]);

  useEffect(() => {
    if (threadMenu && (collapsed || !threads.some((thread) => thread.id === threadMenu.threadId))) {
      closeThreadMenu(false);
    }
  }, [collapsed, threads, threadMenu, closeThreadMenu]);

  useEffect(() => {
    if (hoverCard && (collapsed || !hoverCard.anchor.isConnected ||
      !threads.some((thread) => thread.id === hoverCard.threadId) || dragVisual || renamingThread)) {
      closeHoverCard();
    }
  }, [collapsed, threads, hoverCard, dragVisual, renamingThread, closeHoverCard]);

  const activityThreads = useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    return [...new Set(activityThreadIds)].flatMap((id) => {
      const thread = byId.get(id);
      return thread ? [thread] : [];
    });
  }, [threads, activityThreadIds]);

  const filteredThreads = useMemo(() => {
    const visible = activityOnly ? activityThreads.slice(0, activityVisibleCount) : threads;
    if (!searchQuery.trim()) return visible;
    const query = searchQuery.toLowerCase();
    return visible.filter((thread) =>
      (thread.name || thread.preview || thread.id).toLowerCase().includes(query)
    );
  }, [threads, searchQuery, activityOnly, activityThreads, activityVisibleCount]);

  const getThreadProjects = useCallback(
    (thread: ThreadSummary) => sidebarThreadProjects(thread, projectGroups, projectMembership, workspaceHints),
    [projectGroups, projectMembership, workspaceHints],
  );

  useEffect(() => {
    if (!createdThread || seenCreatedThreadRef.current === createdThread.id) return;
    seenCreatedThreadRef.current = createdThread.id;
    if (chatSortMode !== "manual") return;
    const projects = getThreadProjects(createdThread);
    setManualOrders((previous) => {
      const next: Record<string, string[]> = { ...previous, recent: prependSidebarThread(previous.recent, createdThread.id) };
      for (const project of projects) {
        const key = `project:${project.key}`;
        next[key] = prependSidebarThread(previous[key], createdThread.id);
      }
      return next;
    });
  }, [createdThread, chatSortMode, getThreadProjects]);

  // 全局排序后的会话列表
  const sortedFilteredThreads = useMemo(() => {
    if (activityOnly) return filteredThreads;
    const list = [...filteredThreads];
    return list.sort((a, b) => {
      const bTime = b.recencyAt ?? b.updatedAt ?? b.createdAt ?? 0;
      const aTime = a.recencyAt ?? a.updatedAt ?? a.createdAt ?? 0;
      return bTime - aTime;
    });
  }, [filteredThreads, activityOnly, chatSortMode]);

  const pinnedThreads = useMemo(
    () => {
      const byId = new Map(filteredThreads.map((thread) => [thread.id, thread]));
      return pinnedThreadIds.flatMap((id) => {
        const thread = byId.get(id);
        return thread ? [thread] : [];
      });
    },
    [filteredThreads, pinnedThreadIds]
  );

  // Map threads to project entities; legacy folders remain fallback groups.
  const threadsByProject = useMemo(() => {
    const map: Record<string, ThreadSummary[]> = {};
    for (const project of projectGroups) {
      map[project.key] = [];
    }
    for (const t of sortedFilteredThreads) {
      if (pinnedThreadIds.includes(t.id)) continue;
      for (const project of getThreadProjects(t)) {
        map[project.key]?.push(t);
      }
    }
    return map;
  }, [sortedFilteredThreads, projectGroups, getThreadProjects, pinnedThreadIds]);

  // 主聊天/活动会话列表 (对标官方 smn / TasksSection 逻辑)
  const mainChatThreads = useMemo(() => {
    if (activityOnly) {
      return sortedFilteredThreads;
    }

    const unpinned = sortedFilteredThreads.filter((t) => !pinnedThreadIds.includes(t.id));

    // 合并列表始终包含全部未置顶聊天；项目包含偏好仅控制分组模式的最近区域。
    if (organizeMode === "list" || showProjectsInRecents) {
      return unpinned;
    }
    return unpinned.filter((thread) => getThreadProjects(thread).length === 0);
  }, [
    sortedFilteredThreads,
    pinnedThreadIds,
    activityOnly,
    organizeMode,
    showProjectsInRecents,
    getThreadProjects,
  ]);

  /** 会话当前所属分区（本地乐观覆盖优先于 props 的 section 字段）。 */
  const sectionIdOfThread = useCallback(
    (thread: ThreadSummary): string | null => {
      if (Object.prototype.hasOwnProperty.call(sectionOverrides, thread.id)) {
        return sectionOverrides[thread.id] ?? null;
      }
      return typeof thread.section === "string" ? thread.section : thread.section?.id ?? null;
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

  useEffect(() => {
    if (activityOnly || chatSortMode !== "manual") return;
    setManualOrders((previous) => {
      let next = previous;
      const remember = (key: string, ids: string[], newItemsFirst: boolean) => {
        const old = previous[key] || [];
        const merged = mergeSidebarOrder(old, ids, newItemsFirst);
        if (old.length === merged.length && old.every((id, index) => id === merged[index])) return;
        if (next === previous) next = { ...previous };
        next[key] = merged;
      };
      for (const project of projectGroups) {
        remember(`project:${project.key}`, (threadsByProject[project.key] || []).map((thread) => thread.id), false);
      }
      remember("recent", mainChatThreads.map((thread) => thread.id), true);
      return next;
    });
  }, [activityOnly, chatSortMode, threadsByProject, mainChatThreads, projectGroups]);

  const orderedMainThreads = !activityOnly && chatSortMode === "manual"
    ? applySidebarOrder(mainChatThreads, manualOrders.recent, true)
    : mainChatThreads;
  const recentOrderContext: ThreadOrderContext = {
    key: "recent",
    allIds: orderedMainThreads.map((thread) => thread.id),
    visibleIds: orderedMainThreads.map((thread) => thread.id),
  };

  const selectManualSort = () => {
    setManualOrders((previous) => {
      const next = { ...previous };
      for (const project of projectGroups.slice(0, 5)) {
        const key = `project:${project.key}`;
        if (!next[key]) next[key] = (threadsByProject[project.key] || []).slice(0, projectThreadLimits[project.key] ?? 5).map((thread) => thread.id);
      }
      if (!next.recent) next.recent = mainChatThreads.map((thread) => thread.id);
      return next;
    });
    setChatSortMode("manual");
  };

  const projectOrganizeItems: ThreadActionItem[] = [
    { id: "organize-project", label: "分项目显示", type: "radio", checked: organizeMode === "project", icon: <FolderIcon size={13} /> },
    { id: "organize-list", label: "合并显示", type: "radio", checked: organizeMode === "list" },
  ];
  const selectOrganizeMode = (id: string) => {
    const mode = id === "organize-project" ? "project" : "list";
    setOrganizeMode(mode);
    localStorage.setItem("codex_sidebar_organize_mode", mode);
  };
  const organizeItems: ThreadActionItem[] = [
    {
      id: "organize-sidebar", label: "整理侧边栏",
      children: projectOrganizeItems,
    },
    {
      id: "sort-sidebar", label: "聊天排序方式",
      children: [
        { id: "sort-updated_at", label: "最近更新", type: "radio", checked: chatSortMode === "updated_at" },
        { id: "sort-manual", label: "手动排序", type: "radio", checked: chatSortMode === "manual" },
      ],
    },
  ];
  if (organizeMode === "project") {
    organizeItems.push(
      { id: "recents-show", label: "显示", type: "label", separatorBefore: true },
      { id: "recents-show-projects", label: "项目", type: "checkbox", checked: showProjectsInRecents },
    );
  }
  if (sectionsAvailable) {
    organizeItems.push({ id: "new-section", label: "新建分区", icon: <PlusIcon size={12} />, separatorBefore: true, disabled: sectionBusy });
  }

  if (collapsed) return null;

  const isProjectExpanded = (projectKey: string) => {
    return expandedProjects[projectKey] !== false;
  };

  const toggleProjectExpand = (projectKey: string) => {
    const key = projectKey;
    setExpandedProjects((prev) => ({ ...prev, [key]: prev[key] === false }));
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

  const handleCreateSectionForThread = async (threadId: string) => {
    if (sectionCreateInFlightRef.current) return false;
    sectionCreateInFlightRef.current = true;
    setSectionBusy(true);
    let created: ThreadSection;
    try {
      created = await createSection(newSectionName.trim() || "新建分区");
      setSections((prev) =>
        prev.some((section) => section.id === created.id) ? prev : [...prev, created]
      );
    } catch (e: any) {
      notify(`创建分区失败：${e?.message || e}`, "error");
      setSectionBusy(false);
      sectionCreateInFlightRef.current = false;
      return false;
    }

    try {
      await moveThreadToSection(threadId, created.id);
      setSectionOverrides((prev) => ({ ...prev, [threadId]: created.id }));
      onThreadsChanged?.();
      notify(`已移动到分区「${created.name}」`, "info");
    } catch (e: any) {
      onThreadsChanged?.();
      notify(`已创建分区「${created.name}」，但移动聊天失败：${e?.message || e}`, "error");
    } finally {
      setSectionBusy(false);
      sectionCreateInFlightRef.current = false;
    }
    return true;
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
    closeThreadMenu(true);
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
    trigger: HTMLElement
  ) => {
    closeHoverCard();
    threadMenuReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : trigger;
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
    setThreadMenu({ threadId: thread.id, x: left, y: top, readState: thread.readState });
    setThreadMenuMoveOpen(false);
    setThreadMenuSectionSubmenuPosition(null);
  };

  const renderThreadMenu = () => {
    if (!threadMenu) return null;
    const thread = threads.find((t) => t.id === threadMenu.threadId);
    if (!thread) return null;
    const currentSectionId = sectionIdOfThread(thread);
    const hasSections = sections.length > 0;

    return (
      <>
      <div
        ref={threadMenuRef}
        className="composer-popover-menu sidebar-thread-menu"
        role="menu"
        aria-label="会话操作"
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
        onKeyDown={(e) => {
          if (e.nativeEvent?.isComposing) return;
          if (e.key === "Tab") { closeThreadMenu(false); return; }
          if ((e.target as HTMLElement).closest?.("[data-thread-section-submenu]")) return;
          if (e.key === "ArrowRight" &&
            (e.target as HTMLElement).closest?.("[data-thread-section-trigger]")) {
            e.preventDefault();
            e.stopPropagation();
            threadMenuSectionFocusRef.current = true;
            setThreadMenuMoveOpen(true);
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button[role^="menuitem"]:not(:disabled)'));
          if (!items.length) return;
          e.preventDefault();
          e.stopPropagation();
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
            : index < 0 ? e.key === "ArrowDown" ? 0 : items.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
          if (!items[next]?.closest("[data-thread-section-trigger]")) {
            setThreadMenuMoveOpen(false);
            setThreadMenuSectionSubmenuPosition(null);
          }
        }}
      >
        {threadMenu.readState && onSetThreadReadState && (
          <button
            type="button"
            role="menuitem"
            className="popover-menu-item"
            onPointerEnter={() => {
              setThreadMenuMoveOpen(false);
              setThreadMenuSectionSubmenuPosition(null);
            }}
            onClick={() => {
              closeThreadMenu(true);
              onSetThreadReadState(thread.id, threadMenu.readState!.revision, threadMenu.readState!.firstUnread == null);
            }}
          >
            <span className="popover-item-title">{threadMenu.readState.firstUnread ? "标记为已读" : "标记为未读"}</span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="popover-menu-item"
          onPointerEnter={() => {
            setThreadMenuMoveOpen(false);
            setThreadMenuSectionSubmenuPosition(null);
          }}
          onClick={() => {
            closeThreadMenu(true);
            setRenamingThread(thread);
          }}
        >
          <span className="popover-item-title">重命名</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="popover-menu-item"
          onPointerEnter={() => {
            setThreadMenuMoveOpen(false);
            setThreadMenuSectionSubmenuPosition(null);
          }}
          onClick={(e) => {
            closeThreadMenu(true);
            onTogglePinThread(thread.id, e);
          }}
        >
          <span className="popover-item-title">{pinnedThreadIds.includes(thread.id) ? "取消置顶" : "置顶"}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          data-thread-section-trigger
          ref={threadMenuSectionTriggerRef}
          aria-expanded={threadMenuMoveOpen}
          aria-haspopup="menu"
          className="popover-menu-item"
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            threadMenuSectionFocusRef.current = false;
            setThreadMenuSubmenuType("sections");
            setThreadMenuSectionSubmenuPosition(null);
            setThreadMenuMoveOpen(true);
          }}
          onClick={() => {
            threadMenuSectionFocusRef.current = true;
            setThreadMenuSectionSubmenuPosition(null);
            setThreadMenuSubmenuType("sections");
            setThreadMenuMoveOpen(true);
          }}
        >
          <span className="popover-item-title">移至分区</span>
          <ChevronRightIcon size={12} />
        </button>
        {onMoveThreadToProject && sidebarThreadProjects(
          thread,
          projectGroups,
          projectMembership,
          workspaceHints,
        ).some((group) => Boolean(group.entity?.serverProjectId)) && (
          <button
            type="button"
            role="menuitem"
            data-thread-section-trigger
            ref={threadMenuProjectTriggerRef}
            aria-expanded={threadMenuMoveOpen && threadMenuSubmenuType === "projects"}
            aria-haspopup="menu"
            className="popover-menu-item"
            onPointerEnter={(event) => {
              if (event.pointerType === "touch") return;
              threadMenuSectionFocusRef.current = false;
              setThreadMenuSubmenuType("projects");
              setThreadMenuSectionSubmenuPosition(null);
              setThreadMenuMoveOpen(true);
            }}
            onClick={() => {
              threadMenuSectionFocusRef.current = true;
              setThreadMenuSubmenuType("projects");
              setThreadMenuSectionSubmenuPosition(null);
              setThreadMenuMoveOpen(true);
            }}
          >
            <span className="popover-item-title">移至项目</span>
            <ChevronRightIcon size={12} />
          </button>
        )}
        <div className="popover-divider" />
        <button
          type="button"
          role="menuitem"
          className="popover-menu-item"
          onPointerEnter={() => {
            setThreadMenuMoveOpen(false);
            setThreadMenuSectionSubmenuPosition(null);
          }}
          onClick={(e) => {
            closeThreadMenu(true);
            onArchiveThread(thread, e);
          }}
        >
          <span className="popover-item-title">归档</span>
        </button>
        {onDeleteThread && (
          <button
            type="button"
            role="menuitem"
            className="popover-menu-item danger"
            onPointerEnter={() => {
              setThreadMenuMoveOpen(false);
              setThreadMenuSectionSubmenuPosition(null);
            }}
            onClick={(e) => {
              closeThreadMenu(true);
              onDeleteThread(thread, e);
            }}
          >
            <span className="popover-item-title" style={{ color: "var(--accent-red)" }}>
              永久删除
            </span>
          </button>
        )}
      </div>
      {threadMenuMoveOpen && createPortal(
        <div
          ref={threadMenuSectionSubmenuRef}
          data-thread-section-submenu
          className="composer-popover-menu sidebar-thread-menu sidebar-thread-menu-submenu"
          role="menu"
          aria-label={threadMenuSubmenuType === "projects" ? "项目" : "分区"}
          style={{
            position: "fixed",
            left: threadMenuSectionSubmenuPosition?.left ?? threadMenu.x + 220,
            top: threadMenuSectionSubmenuPosition?.top ?? threadMenu.y + 80,
            zIndex: 401,
            minWidth: 208,
            maxHeight: Math.max(80, window.innerHeight - 16),
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.nativeEvent?.isComposing) return;
            if (e.key === "Escape" || e.key === "ArrowLeft") {
              e.preventDefault();
              e.stopPropagation();
              setThreadMenuMoveOpen(false);
              setThreadMenuSectionSubmenuPosition(null);
              (threadMenuSubmenuType === "projects"
                ? threadMenuProjectTriggerRef.current
                : threadMenuSectionTriggerRef.current)?.focus();
              return;
            }
            if (e.key === "Tab") { closeThreadMenu(false); return; }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'));
            if (!items.length) return;
            e.preventDefault();
            e.stopPropagation();
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
              : index < 0 ? e.key === "ArrowDown" ? 0 : items.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}
        >
            {threadMenuSubmenuType === "sections" && hasSections && (
              <>
                {sections.map((section) => (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={section.id === currentSectionId}
                    key={section.id}
                    className="popover-menu-item"
                    onClick={() =>
                      void handleMoveThreadToSection(thread.id, section.id === currentSectionId ? null : section.id)
                    }
                  >
                    <span className="sidebar-thread-menu-check" aria-hidden="true">
                      {section.id === currentSectionId && <CheckIcon size={14} />}
                    </span>
                    <span className="popover-item-title">{section.name}</span>
                  </button>
                ))}
                <div className="popover-divider" />
              </>
            )}
            {threadMenuSubmenuType === "sections" && sectionsAvailable && (
              <button
                type="button"
                role="menuitem"
                className="popover-menu-item"
                disabled={sectionBusy}
                onClick={() => {
                  sectionCreatorReturnFocusRef.current = threadMenuReturnFocusRef.current;
                  closeThreadMenu(true);
                  setNewSectionName("");
                  setSectionCreatorThreadId(thread.id);
                }}
              >
                <span className="popover-item-title">新建分区…</span>
              </button>
            )}
            {threadMenuSubmenuType === "projects" && onMoveThreadToProject && (
              <>
                {(projectMembership.localProjects || [])
                  .filter((project) => Boolean(project.serverProjectId))
                  .map((project) => (
                    <button
                      type="button"
                      role="menuitem"
                      className="popover-menu-item"
                      key={project.id}
                      onClick={() => {
                        closeThreadMenu(true);
                        void onMoveThreadToProject(thread.id, project.serverProjectId!);
                      }}
                    >
                      <span className="popover-item-title">{project.name}</span>
                    </button>
                  ))}
                <div className="popover-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="popover-menu-item"
                  onClick={() => {
                    closeThreadMenu(true);
                    void onMoveThreadToProject(thread.id, null);
                  }}
                >
                  <span className="popover-item-title">聊天</span>
                </button>
              </>
            )}
        </div>,
        document.body,
      )}
      </>
    );
  };

  const renderThreadRow = (t: ThreadSummary, indented = false, orderContext?: ThreadOrderContext) => {
    const isActive = activeRoute === "thread" && activeThreadId === t.id;
    const isPinned = pinnedThreadIds.includes(t.id);
    const canReorder = chatSortMode === "manual" && !!orderContext && !renamingThread;
    const drop = dragVisual?.group === orderContext?.key ? dragVisual?.drop : null;
    const dropPlacement = drop?.beforeId === t.id ? "before"
      : drop && drop.beforeId === null && orderContext?.visibleIds.at(-1) === t.id ? "after" : undefined;

    return (
      <div
        key={t.id}
        className={`sidebar-thread-row ${isActive ? "active" : ""} ${
          indented ? "indented" : ""
        }`}
        tabIndex={0}
        role="button"
        aria-label={t.name || t.preview || "新聊天"}
        aria-current={isActive ? "page" : undefined}
        aria-describedby={hoverCard?.threadId === t.id ? "sidebar-thread-hover-card" : undefined}
        draggable={false}
        data-reorderable={canReorder || undefined}
        data-order-group={canReorder ? orderContext?.key : undefined}
        data-thread-id={t.id}
        data-dragging={dragVisual?.id === t.id && dragVisual.group === orderContext?.key || undefined}
        data-drop-placement={dropPlacement}
        onPointerDown={(event) => {
          suppressRowClickRef.current = false;
          if (!canReorder || !orderContext || !event.isPrimary || event.button !== 0 ||
            (event.target as Element).closest?.("button, input, [contenteditable=true]")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          draggedThreadRef.current = {
            id: t.id, group: orderContext.key, pointerId: event.pointerId,
            x: event.clientX, y: event.clientY, moved: false,
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch" && !threadMenu && !renamingThread && !dragVisual) {
            setHoverCard({ threadId: t.id, anchor: event.currentTarget });
          }
        }}
        onFocus={(event) => {
          if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible") &&
            !threadMenu && !renamingThread && !dragVisual) {
            setHoverCard({ threadId: t.id, anchor: event.currentTarget });
          }
        }}
        onPointerMove={(event) => {
          const dragged = draggedThreadRef.current;
          if (!dragged || dragged.pointerId !== event.pointerId) return;
          if (Math.hypot(event.clientX - dragged.x, event.clientY - dragged.y) > 6) dragged.moved = true;
          if (!dragged.moved || !canReorder || !orderContext) return;
          event.preventDefault();
          const target = document.elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>(".sidebar-thread-row[data-order-group]");
          let drop = null;
          if (target?.dataset.orderGroup === dragged.group) {
            const rect = target.getBoundingClientRect();
            drop = sidebarDropTarget(orderContext.visibleIds, dragged.id, target.dataset.threadId || "", event.clientY >= rect.top + rect.height / 2);
          }
          setDragVisual({
            id: dragged.id, group: dragged.group, label: t.name || t.preview || "新聊天",
            left: dragged.left + event.clientX - dragged.x, top: dragged.top + event.clientY - dragged.y,
            width: dragged.width, height: dragged.height, drop,
          });
        }}
        onPointerCancel={cancelThreadDrag}
        onLostPointerCapture={cancelThreadDrag}
        onPointerUp={(event) => {
          const dragged = draggedThreadRef.current;
          cancelThreadDrag();
          if (!dragged || !dragged.moved || dragged.pointerId !== event.pointerId) return;
          suppressRowClickRef.current = true;
          const target = document.elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>(".sidebar-thread-row[data-order-group]");
          if (!canReorder || !orderContext || dragged.group !== orderContext.key ||
            target?.dataset.orderGroup !== orderContext.key ||
            !orderContext.visibleIds.includes(dragged.id)) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = target.getBoundingClientRect();
          const after = event.clientY >= rect.top + rect.height / 2;
          setManualOrders((previous) => ({
            ...previous,
            [orderContext.key]: moveVisibleSidebarThread(
              previous[orderContext.key] || [], orderContext.allIds, orderContext.visibleIds,
              dragged.id, target.dataset.threadId || "", after, orderContext.key === "recent",
            ),
          }));
        }}
        onClick={() => {
          if (suppressRowClickRef.current) { suppressRowClickRef.current = false; return; }
          onSelectThread(t.id);
        }}
        onKeyDownCapture={(e) => {
          if (draggedThreadRef.current?.moved) { e.preventDefault(); e.stopPropagation(); return; }
          if (!canReorder || !orderContext || e.defaultPrevented || !e.altKey ||
            e.ctrlKey || e.metaKey || e.shiftKey ||
            (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.target !== e.currentTarget) return;
          const direction = e.key === "ArrowUp" ? -1 : 1;
          const index = orderContext.visibleIds.indexOf(t.id);
          const target = orderContext.visibleIds[index + direction];
          if (index < 0 || !target) return;
          setManualOrders((previous) => ({
            ...previous,
            [orderContext.key]: moveVisibleSidebarThread(
              previous[orderContext.key] || [], orderContext.allIds, orderContext.visibleIds,
              t.id, target, direction > 0, orderContext.key === "recent",
            ),
          }));
        }}
        onKeyDown={(e) => {
          if (draggedThreadRef.current?.moved || e.defaultPrevented || e.nativeEvent?.isComposing) return;
          if (e.target === e.currentTarget && !e.altKey && !e.ctrlKey && !e.metaKey &&
            (e.key === "ContextMenu" || e.key === "F10" && e.shiftKey)) {
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openThreadMenu(t, rect.left, rect.bottom, e.currentTarget);
            return;
          }
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onSelectThread(t.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openThreadMenu(t, e.clientX, e.clientY, e.currentTarget);
        }}
      >
        <div className="sidebar-thread-left">
            <span
              className="sidebar-thread-title"
              onDoubleClick={(e) => {
                if (!e.defaultPrevented && isActive) setRenamingThread(t);
              }}
            >
              {(t as any).isStreaming || t.status === "running" ? (
                <span className="sidebar-thread-status-spinner" title="正在运行..." />
              ) : t.readState?.firstUnread ? (
                <span className="sidebar-thread-unread-dot" title="未读消息" />
              ) : null}
              {t.name || t.preview || "新聊天"}
            </span>
        </div>
        <div className="sidebar-thread-actions">
          <button
            type="button"
            className="thread-icon-btn"
            title={isPinned ? "取消置顶" : "置顶聊天"}
            onClick={(e) => onTogglePinThread(t.id, e)}
          >
            <PinIcon size={12} />
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
            title="更多操作"
            aria-haspopup="menu"
            aria-expanded={threadMenu?.threadId === t.id}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              openThreadMenu(t, rect.right, rect.bottom, e.currentTarget);
            }}
          >
            <EllipsisIcon size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className={`codex-sidebar ${collapsed ? "collapsed" : ""}`} aria-hidden={collapsed} data-dragging={!!dragVisual || undefined}>
      {/* ── 1. Codex-only header: static mode label on Left, Bell + Search on Right ── */}
      <div className="sidebar-top-bar">
        <div className="codex-brand-static-label" aria-label="Codex">
          <span className="codex-brand-text">Codex</span>
        </div>

        <div className="sidebar-top-icons">
          <button
            type="button"
            className={`sidebar-top-icon-btn ${activityOnly ? "active" : ""}`}
            onClick={onToggleActivity}
            onContextMenu={(e) => {
              e.preventDefault();
              onNavigate("inbox");
            }}
            aria-pressed={activityOnly}
            title="查看活动"
          >
            <BellIcon size={15} />
            {activityAttentionCount > 0 && <span className="sidebar-bell-dot" />}
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

      </div>

      {activityOnly && (
        <div className="sidebar-activity-banner">
          <strong>活动</strong>
          <div>
            <button type="button" onClick={() => onNavigate("inbox")} title="查看收件箱">收件箱</button>
            <button type="button" onClick={onMarkAllRead}>全部已读</button>
            <button type="button" onClick={onToggleActivity}>关闭</button>
          </div>
        </div>
      )}

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

      </div>

      {/* ── 3. Tree: 置顶 / 自定义分区 / 项目 / 最近 ── */}
      <div className="sidebar-threads-scroll">
        {/* Section A: 置顶 (Pinned) —— 仅在有置顶项时显示 */}
        {!activityOnly && pinnedThreads.length > 0 && (
          <>
            <div className="sidebar-section-header-row">
              <span className="sidebar-section-label">置顶</span>
            </div>
            <div className="sidebar-section-list">
              {pinnedThreads.map((t) => renderThreadRow(t, false))}
            </div>
          </>
        )}

        {/* Section A2: 自定义分区 (threadSection/*) —— 协议不可用时整块隐藏 */}
        {!activityOnly && sectionsAvailable && (showSectionCreator || sections.some((section) =>
          !isBuiltinEmptySection(section, (threadsBySection[section.id] || []).length)
        )) && (
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
                                fontSize: "calc(11px * var(--font-ui-scale, 1))",
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
        {!activityOnly && <>
        <div className="sidebar-section-header-row" style={{ marginTop: 10 }}>
          <span
            className="sidebar-section-label clickable"
            onClick={() => onNavigate("projects")}
            title="点击打开项目中心"
          >
            项目
          </span>
          <div className="sidebar-section-tools">
            <ThreadActionsMenu
              items={projectOrganizeItems}
              triggerAriaLabel="项目侧边栏选项"
              buttonClassName="sidebar-mini-tool-btn"
              label={<EllipsisIcon size={12} />}
              align="left"
              onSelect={selectOrganizeMode}
            />
            <button
              type="button"
              className="sidebar-mini-tool-btn"
              onClick={onPickNewFolder}
              title="添加本地项目文件夹"
            >
              <PlusIcon size={13} />
            </button>
          </div>
        </div>

        {/* Section B: 项目 (Projects) —— 组织模式为 project 时展示 */}
        {organizeMode === "project" && (
          <div className="sidebar-projects-tree">
            {projectGroups.map((project) => {
              const isSelectedProject = projectMembership.selectedProjectId != null
                ? projectMembership.selectedProjectId === project.id
                : project.entity
                  ? project.rootPaths.some((path) => normPath(activeWorkspace?.path) === normPath(path))
                  : normPath(activeWorkspace?.path) === normPath(project.path);
              const expanded = isProjectExpanded(project.key);
              const projectKey = project.key;
              const orderKey = `project:${projectKey}`;
              const projectThreads = chatSortMode === "manual"
                ? applySidebarOrder(threadsByProject[projectKey] || [], manualOrders[orderKey])
                : threadsByProject[projectKey] || [];
              const threadLimit = projectThreadLimits[projectKey] ?? 5;
              let visibleThreads = projectThreads.slice(0, threadLimit);
              const selectedThread = activeRoute === "thread"
                ? projectThreads.slice(threadLimit).find((thread) => thread.id === activeThreadId)
                : undefined;
              if (selectedThread) visibleThreads.push(selectedThread);
              if (projectThreads.length - visibleThreads.length === 1) visibleThreads = projectThreads;
              const orderContext: ThreadOrderContext = {
                key: orderKey,
                allIds: projectThreads.map((thread) => thread.id),
                visibleIds: visibleThreads.map((thread) => thread.id),
              };
              const projectName = project.label || project.path.split(/[/\\]/).pop();
              const projectActions: ThreadActionItem[] = [
                { id: "manage", label: "项目设置与来源", icon: <FilterIcon size={13} /> },
              ];
              if (onRevealPath) {
                projectActions.unshift({ id: "reveal", label: "在文件资源管理器中打开", icon: <FolderIcon size={13} /> });
              }
              if (!project.entity && workspaces.length > 1) {
                projectActions.push({ id: "remove", label: "移除项目", icon: <CloseIcon size={12} />, danger: true, separatorBefore: true });
              }

              return (
                <div key={project.id} className="sidebar-project-group">
                  <div
                    className={`sidebar-project-row ${isSelectedProject ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={projectName}
                    aria-expanded={expanded}
                    onClick={() => toggleProjectExpand(project.key)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        toggleProjectExpand(project.key);
                      }
                    }}
                    title={project.path || project.rootPaths.join("\n")}
                  >
                    <div className="sidebar-project-left">
                      <span
                        className="project-folder-icon"
                        aria-hidden="true"
                      >
                        <FolderIcon size={14} />
                      </span>
                      <span className="sidebar-project-name">{projectName}</span>
                    </div>

                    <div className="sidebar-project-actions" onClick={(e) => e.stopPropagation()}>
                      <ThreadActionsMenu
                        items={projectActions}
                        align="right"
                        buttonClassName="thread-icon-btn"
                        label={<EllipsisIcon size={12} />}
                        triggerAriaLabel={`${projectName} 的项目操作`}
                        onSelect={(id) => {
                          if (id === "reveal" && project.path) onRevealPath?.(project.path);
                          if (id === "manage") onNavigate("projects");
                          if (id === "remove" && !project.entity) onRemoveWorkspace(project.path);
                        }}
                      />
                      <button
                        type="button"
                        className="thread-icon-btn"
                        title={`在 ${projectName} 中开启新聊天`}
                        disabled={!project.path}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartNewChat(project.path, project.entity);
                        }}
                      >
                        <PlusIcon size={12} />
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="sidebar-project-children">
                      {projectThreads.length === 0 ? (
                        <div className="sidebar-project-empty">暂无聊天</div>
                      ) : (
                        visibleThreads.map((t) => renderThreadRow(t, true, orderContext))
                      )}
                      {visibleThreads.length < projectThreads.length && (
                        <button
                          type="button"
                          className="sidebar-project-show-more"
                          onClick={() => setProjectThreadLimits((previous) => ({
                            ...previous,
                            [projectKey]: (previous[projectKey] ?? 5) + 10,
                          }))}
                        >
                          展开显示
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>}

        {/* Section C: 聊天列表 (Chats / Activity) —— 对标官方 TasksSection */}
        <div className="sidebar-section-header-row" style={{ marginTop: 12 }}>
          <span className="sidebar-section-label">
            {activityOnly
              ? "活动"
              : organizeMode === "list"
              ? "聊天"
              : "最近"}
          </span>
          {!activityOnly && <div className="sidebar-section-tools">
            <ThreadActionsMenu
              items={organizeItems}
              triggerAriaLabel="聊天侧边栏选项"
              buttonClassName="sidebar-mini-tool-btn"
              label={<FilterIcon size={12} />}
              align="left"
              onSelect={(id) => {
                if (id === "organize-project" || id === "organize-list") {
                  selectOrganizeMode(id);
                } else if (id === "sort-manual") {
                  selectManualSort();
                } else if (id === "sort-updated_at") {
                  setChatSortMode("updated_at");
                } else if (id === "recents-show-projects") {
                  setShowProjectsInRecents((previous) => !previous);
                } else if (id === "new-section") {
                  setShowSectionCreator(true);
                  setNewSectionName("");
                  setRenamingSectionId(null);
                }
              }}
            />
          </div>}
        </div>

        <div className="sidebar-section-list">
          {mainChatThreads.length === 0 ? (
            <div className="sidebar-project-empty" style={{ paddingLeft: 12 }}>
              {activityOnly
                ? "暂无需要关注的事项"
                : "暂无聊天"}
            </div>
          ) : (
            orderedMainThreads.map((t) => renderThreadRow(t, false, activityOnly ? undefined : recentOrderContext))
          )}
          {activityOnly && activityThreads.length > activityVisibleCount && onLoadMoreActivity && (
            <button type="button" className="sidebar-project-show-more" onClick={onLoadMoreActivity}>
              展开显示
            </button>
          )}
        </div>
      </div>

      {/* ── 5. 会话「移动到分区」浮动菜单 ── */}
      {renderThreadMenu()}
      {hoverCard && !threadMenu && !renamingThread && !dragVisual && (() => {
        const thread = filteredThreads.find((thread) => thread.id === hoverCard.threadId);
        if (!thread) return null;
        const projectLabel = getThreadProjects(thread)[0]?.label ||
          thread.cwd?.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || "聊天";
        return createPortal(
          <SidebarThreadHoverCard
            key={thread.id}
            thread={thread}
            anchor={hoverCard.anchor}
            projectLabel={projectLabel}
            onClose={closeHoverCard}
            onRename={(value) => onRenameThread(thread.id, value)}
          />,
          document.body,
        );
      })()}
      {renamingThread && createPortal(
        <RenameThreadDialog
          key={renamingThread.id}
          initialValue={renamingThread.name ?? ""}
          onClose={() => setRenamingThread(null)}
          onSave={(value) => onRenameThread(renamingThread.id, value)}
        />,
        document.body,
      )}
      {sectionCreatorThreadId && createPortal(
        <dialog
          ref={sectionCreateDialogRef}
          className="rename-thread-dialog"
          aria-label="新建分区"
          aria-describedby="new-section-description"
          onCancel={(event) => {
            event.preventDefault();
            if (!sectionBusy) {
              setSectionCreatorThreadId(null);
              setNewSectionName("");
            }
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if ((event.nativeEvent.isComposing || event.keyCode === 229) &&
              (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
          }}
        >
          <form onSubmit={async (event) => {
            event.preventDefault();
            if (sectionBusy || sectionCreateInFlightRef.current) return;
            if (await handleCreateSectionForThread(sectionCreatorThreadId)) {
              setSectionCreatorThreadId(null);
              setNewSectionName("");
            }
          }}>
            <header>
              <h2>新建分区</h2>
              <p id="new-section-description">随心整理聊天和项目</p>
            </header>
            <input
              aria-label="分区名称"
              placeholder="分区名称"
              value={newSectionName}
              autoFocus
              disabled={sectionBusy}
              onChange={(event) => setNewSectionName(event.target.value)}
            />
            <footer>
              <button
                type="button"
                disabled={sectionBusy}
                onClick={() => {
                  setSectionCreatorThreadId(null);
                  setNewSectionName("");
                }}
              >
                取消
              </button>
              <button type="submit" className="rename-thread-save" disabled={sectionBusy}>
                创建分区
              </button>
            </footer>
          </form>
        </dialog>,
        document.body,
      )}
      {dragVisual && createPortal(
        <div
          className="sidebar-thread-drag-preview"
          aria-hidden="true"
          style={{ left: dragVisual.left, top: dragVisual.top, width: dragVisual.width, height: dragVisual.height }}
        >
          <span className="sidebar-thread-drag-icon"><MessageCircle size={16} /></span>
          <span className="sidebar-thread-drag-label">{dragVisual.label}</span>
        </div>,
        document.body,
      )}
    </aside>
  );
};
