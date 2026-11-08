import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderIcon,
  PlusIcon,
  SearchIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  NewChatComposeIcon,
  RefreshIcon,
  ArrowRightIcon,
} from "./Icons";
import { ThreadSummary, WorkspaceRootItem } from "../types";
import { tauriInvoke, tauriListen } from "../bridge";
import {
  Project,
  ProjectPatch,
  createProject,
  deleteProject,
  listProjects,
  moveProject,
  updateProject,
} from "../projects";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { ProjectEditDialog, ProjectRemoveDialog } from "./ProjectEditDialog";
import { RenameThreadDialog } from "./RenameThreadDialog";
import { copyTextToClipboard } from "../clipboard";
import "./ProjectsIndexView.css";

export interface ProjectsIndexViewProps {
  workspaces: WorkspaceRootItem[];
  activeWorkspace: WorkspaceRootItem | null;
  threads: ThreadSummary[];
  currentThreadId?: string | null;
  workspaceHints: Record<string, string>;
  onSelectWorkspace: (path: string) => void;
  onStartNewChatInProject: (path: string, project?: Project) => void;
  onSelectThread: (threadId: string) => void;
  onPickNewFolder: () => void;
  onRemoveWorkspace: (path: string, e: React.MouseEvent) => void;
  onRevealPath?: (path: string) => void;
  onDeleteThread?: (thread: ThreadSummary, e: React.MouseEvent) => void;
  onRenameThread?: (threadId: string, newName: string) => void;
  pinnedThreadIds?: string[];
  onTogglePinThread?: (threadId: string) => void;

  /* ── 以下均为可选新增 props（向后兼容，不传时行为不变） ── */
  /** app-server 连接 / 父级数据刷新时递增此值，可触发重新拉取项目列表。 */
  refreshToken?: number | string | null;
  /** 项目增删改后通知父级刷新 threads / workspaces（可选）。 */
  onProjectsChanged?: () => void;
  /** 线程的项目归属变化（thread/project/updated）后通知父级刷新 threads（可选）。 */
  onThreadsChanged?: () => void;
  /** 轻量提示出口（可选；App 可直接传 showAppToast）。 */
  onShowToast?: (
    message: string,
    type?: "info" | "success" | "error"
  ) => void;
}

type ProjectLoadState = "loading" | "ready" | "unavailable";
type ProjectSortColumn = "name" | "modified";
const projectNameCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function timestampMilliseconds(value?: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return value > 1e12 ? value : value * 1000;
}

function effectiveProjectUpdated(project: Project, threads: ThreadSummary[]): number {
  return Math.max(timestampMilliseconds(project.updatedAt),
    ...threads.map(thread => timestampMilliseconds(thread.updatedAt || thread.createdAt)));
}

const PROJECT_CHAT_PAGE_SIZE = 10;

function visibleProjectChats(threads: ThreadSummary[], limit: number, currentThreadId?: string | null): ThreadSummary[] {
  const visible = threads.slice(0, limit);
  const current = threads.find((thread, index) => index >= limit && thread.id === currentThreadId);
  if (current) visible.push(current);
  return threads.length - visible.length <= 1 ? threads : visible;
}

function ProjectChatList({ label, threads, currentThreadId, expanded, onExpand, renderThread }: {
  label: string;
  threads: ThreadSummary[];
  currentThreadId?: string | null;
  expanded: boolean;
  onExpand: () => void;
  renderThread: (thread: ThreadSummary) => React.ReactNode;
}) {
  const [expandedLimit, setExpandedLimit] = useState(2 * PROJECT_CHAT_PAGE_SIZE);
  const limit = expanded ? expandedLimit : PROJECT_CHAT_PAGE_SIZE;
  const visible = visibleProjectChats(threads, limit, currentThreadId);

  return <div className="project-expanded-threads" role="group" tabIndex={-1} aria-label={label}>
    {visible.length === 0 ? <div className="project-expanded-empty">暂无聊天</div> : visible.map(renderThread)}
    {visible.length < threads.length && <button type="button" className="sidebar-project-show-more"
      onClick={event => {
        const nextLimit = limit + PROJECT_CHAT_PAGE_SIZE;
        if (visibleProjectChats(threads, nextLimit, currentThreadId).length === threads.length
          && document.activeElement === event.currentTarget) {
          event.currentTarget.closest<HTMLElement>(".project-expanded-threads")?.focus({ preventScroll: true });
        }
        if (expanded) setExpandedLimit(nextLimit);
        else onExpand();
      }}>展开显示</button>}
  </div>;
}

function normPath(p?: string | null): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function formatRelativeTime(unixSeconds?: number | null): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "未知";
  }
  // 兼容秒 / 毫秒时间戳
  const ms = timestampMilliseconds(unixSeconds);
  const diff = Date.now() - ms;
  if (diff < 0) return new Date(ms).toLocaleDateString();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`;
  return new Date(ms).toLocaleDateString();
}

export const ProjectsIndexView: React.FC<ProjectsIndexViewProps> = ({
  workspaces,
  activeWorkspace,
  threads,
  currentThreadId,
  workspaceHints,
  onSelectWorkspace,
  onStartNewChatInProject,
  onSelectThread,
  onPickNewFolder,
  onRemoveWorkspace,
  onRevealPath,
  onDeleteThread,
  onRenameThread,
  pinnedThreadIds,
  onTogglePinThread,
  refreshToken,
  onProjectsChanged,
  onThreadsChanged,
  onShowToast,
}) => {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [expandedChatPages, setExpandedChatPages] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ column: ProjectSortColumn; direction: "ascending" | "descending" }>({
    column: "modified", direction: "descending",
  });
  const handleSort = (column: ProjectSortColumn) => {
    setSort(previous => ({
      column,
      direction: previous.column === column
        ? previous.direction === "ascending" ? "descending" : "ascending"
        : column === "name" ? "ascending" : "descending",
    }));
  };

  /* ── 真实项目实体（project/*） ── */
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadState, setLoadState] = useState<ProjectLoadState>("loading");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const projectLoadRequestRef = useRef(0);
  const createPendingRef = useRef(false);

  /* ── 新建项目表单 ── */
  const [creating, setCreating] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  const [renamingThread, setRenamingThread] = useState<ThreadSummary | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRoots, setDraftRoots] = useState<string[]>([]);
  const [draftManualRoot, setDraftManualRoot] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ── 回退 workspace 视图状态（协议不可用时使用） ── */
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});

  const notify = useCallback(
    (message: string, type: "info" | "success" | "error" = "info") => {
      if (onShowToast) onShowToast(message, type);
      else if (type === "error") console.warn(message);
    },
    [onShowToast]
  );

  const loadProjects = useCallback(async (): Promise<Project[] | null> => {
    const request = ++projectLoadRequestRef.current;
    try {
      const list = await listProjects();
      if (request !== projectLoadRequestRef.current) return null;
      setProjects(list);
      setLoadState("ready");
      return list;
    } catch (e) {
      if (request !== projectLoadRequestRef.current) return null;
      // 协议不可用 / app-server 未连接：回退到原有 workspace 视图（不得白屏）
      console.warn("project/list failed, falling back to workspace view:", e);
      setProjects([]);
      setLoadState("unavailable");
      return null;
    }
  }, []);

  // 挂载时 & refreshToken 变化时加载项目
  useEffect(() => {
    void loadProjects();
    return () => { ++projectLoadRequestRef.current; };
  }, [loadProjects, refreshToken]);

  // app-server 连接成功后重试（首次挂载时可能尚未连接）
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    tauriListen<{ connected?: boolean } | null>(
      "app-server:status",
      (status) => {
        if (!disposed && status && status.connected) {
          void loadProjects();
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
  }, [loadProjects]);

  // 监听 project/changed、thread/project/updated，实时同步项目列表与会话归属
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    tauriListen<any>("app-server:notification", (payload) => {
      if (disposed) return;
      const method = payload?.method;
      if (method === "project/changed" || method === "project/list") {
        void loadProjects();
        onProjectsChanged?.();
      } else if (method === "thread/project/updated") {
        onThreadsChanged?.();
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [loadProjects, onProjectsChanged, onThreadsChanged]);

  /* ── 搜索过滤（项目 / workspace 两套视图共用输入） ── */
  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.toLowerCase();
    return workspaces.filter(
      (ws) =>
        ws.label.toLowerCase().includes(q) || ws.path.toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  /* ── 按 projectId 统计会话 ── */
  const threadsByProjectId = useMemo(() => {
    const map: Record<string, ThreadSummary[]> = {};
    for (const thread of threads) {
      const projectId = thread.projectId;
      if (!projectId) continue;
      if (!map[projectId]) map[projectId] = [];
      map[projectId].push(thread);
    }
    return map;
  }, [threads]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.map(project => {
      const projectThreads = threadsByProjectId[project.id] || [];
      const matchingThreads = q ? projectThreads.filter(thread =>
        (thread.name || thread.preview || "").toLowerCase().includes(q)) : [];
      return { project, projectThreads, matchingThreads, effectiveUpdated: effectiveProjectUpdated(project, projectThreads) };
    }).filter(({ project, matchingThreads }) => !q || matchingThreads.length > 0 ||
      [project.name, ...project.roots.map(root => root.path)].join(" ").toLowerCase().includes(q))
      .sort((a, b) => {
        const nameOrder = projectNameCollator.compare(a.project.name, b.project.name) || a.project.id.localeCompare(b.project.id);
        const order = sort.column === "name" ? nameOrder : a.effectiveUpdated - b.effectiveUpdated || nameOrder;
        return sort.direction === "ascending" ? order : -order;
      });
  }, [projects, search, sort, threadsByProjectId]);

  /* ── 回退视图：按 cwd 归组到 workspace（原有逻辑） ── */
  const threadsByWorkspacePath = useMemo(() => {
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

  /* ── 新建项目操作 ── */
  const resetCreateForm = () => {
    setCreating(false);
    setDraftName("");
    setDraftRoots([]);
    setDraftManualRoot("");
    setFormError(null);
    setFormBusy(false);
  };

  const handleOpenCreateForm = () => {
    setCreating(true);
    setFormError(null);
  };

  const addDraftRoot = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setDraftRoots((prev) => {
      const key = normPath(trimmed);
      if (prev.some((item) => normPath(item) === key)) return prev;
      return [...prev, trimmed];
    });
    setFormError(null);
  };

  const handlePickRootFolder = async () => {
    try {
      const picked = await tauriInvoke<string | null>("pick_folder_dialog");
      if (picked) addDraftRoot(picked);
    } catch (e: any) {
      setFormError(`选择文件夹失败：${e?.message || e}`);
    }
  };

  const handleAddManualRoot = () => {
    const value = draftManualRoot.trim();
    if (!value) return;
    addDraftRoot(value);
    setDraftManualRoot("");
  };

  const handleRemoveDraftRoot = (path: string) => {
    setDraftRoots((prev) => prev.filter((item) => item !== path));
  };

  const handleCreateProject = async () => {
    if (createPendingRef.current) return;
    const name = draftName.trim();
    if (!name) {
      setFormError("请输入项目名称");
      return;
    }
    if (draftRoots.length === 0) {
      setFormError("请至少添加一个项目根目录");
      return;
    }
    createPendingRef.current = true;
    setFormBusy(true);
    setFormError(null);
    try {
      const created = await createProject(name, draftRoots);
      resetCreateForm();
      await loadProjects();
      onProjectsChanged?.();
      notify(
        created?.name ? `已创建项目「${created.name}」` : "已创建项目",
        "success"
      );
    } catch (e: any) {
      setFormError(`创建项目失败：${e?.message || e}`);
      setFormBusy(false);
    } finally {
      createPendingRef.current = false;
    }
  };

  /* ── 项目行操作 ── */
  const handleToggleProject = (project: Project) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [project.id]: !prev[project.id],
    }));
    // 若项目根目录已注册为 workspace，同步左侧选中状态
    const root = project.roots[0]?.path;
    if (!root) return;
    const matched = workspaces.find((ws) => normPath(ws.path) === normPath(root));
    if (matched) onSelectWorkspace(matched.path);
  };

  const handleStartChatInProject = (project: Project) => {
    const root = project.roots[0]?.path;
    if (!root) {
      notify("该项目没有根目录，无法新建聊天", "error");
      return;
    }
    onStartNewChatInProject(root, project);
  };

  const saveProject = async (project: Project, patch: ProjectPatch) => {
    const updated = await updateProject(project.id, patch);
    if (updated.id !== project.id) throw Error("服务返回了其他项目");
    ++projectLoadRequestRef.current;
    setProjects(previous => previous.map(item => item.id === project.id ? updated : item));
    onProjectsChanged?.();
  };

  const removeProject = async (project: Project) => {
    await deleteProject(project.id);
    ++projectLoadRequestRef.current;
    setProjects(previous => previous.filter(item => item.id !== project.id));
    setRemovingProject(null);
    setEditingProject(previous => previous?.id === project.id ? null : previous);
    onProjectsChanged?.();
    onThreadsChanged?.();
    notify(`已移除项目「${project.name}」`, "success");
  };

  const copyProjectThreadValue = async (value: string, label: string) => {
    const copied = await copyTextToClipboard(value);
    notify(copied ? `已复制${label}` : `无法复制${label}`, copied ? "success" : "error");
  };

  const handleMoveProject = async (project: Project, direction: "up" | "down") => {
    const index = projects.findIndex((item) => item.id === project.id);
    if (index < 0) return;
    let beforeProjectId: string | null;
    if (direction === "up") {
      if (index === 0) return;
      beforeProjectId = projects[index - 1].id;
    } else {
      if (index >= projects.length - 1) return;
      beforeProjectId = projects[index + 2]?.id ?? null;
    }
    setActionBusyId(project.id);
    try {
      await moveProject(project.id, beforeProjectId);
      await loadProjects();
      onProjectsChanged?.();
    } catch (e: any) {
      notify(`移动项目失败：${e?.message || e}`, "error");
    } finally {
      setActionBusyId(null);
    }
  };

  /* ── 回退视图渲染（原有 workspace 视图，保持原行为） ── */
  const renderWorkspaceFallback = () => (
    <>
      <div
        className="project-col-actions"
        style={{
          justifyContent: "flex-start",
          padding: "8px 16px",
          background: "rgba(245, 158, 11, 0.08)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "calc(12.5px * var(--font-ui-scale, 1))",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span>项目协议不可用，已回退到本地工作区视图。</span>
        <button
          type="button"
          className="secondary-pill-action-btn"
          onClick={() => {
            setLoadState("loading");
            void loadProjects();
          }}
        >
          <RefreshIcon size={12} />
          <span>重试</span>
        </button>
      </div>

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
            const isExp = expandedWorkspaces[key] ?? normPath(activeWorkspace?.path) === key;
            const projThreads = threadsByWorkspacePath[key] || [];
            const isCurrent = normPath(activeWorkspace?.path) === key;

            return (
              <div key={ws.path} className="projects-table-group">
                <div
                  className={`projects-table-row ${isCurrent ? "active" : ""}`}
                  onClick={() => {
                    setExpandedWorkspaces((prev) => ({ ...prev, [key]: !isExp }));
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
                    {onRevealPath && (
                      <button
                        type="button"
                        className="secondary-pill-action-btn"
                        onClick={() => onRevealPath(ws.path)}
                        title="在系统文件管理器中打开此文件夹"
                      >
                        📂 <span>打开目录</span>
                      </button>
                    )}
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
                          <div
                            className="project-thread-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onRenameThread && (
                              <button
                                type="button"
                                className="thread-icon-btn"
                                title="重命名聊天"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = prompt(
                                    "请输入新聊天标题:",
                                    t.name || t.preview || ""
                                  );
                                  if (next && next.trim()) {
                                    onRenameThread(t.id, next.trim());
                                  }
                                }}
                              >
                                ✏️
                              </button>
                            )}
                            {onDeleteThread && (
                              <button
                                type="button"
                                className="thread-icon-btn danger"
                                title="彻底删除此聊天"
                                onClick={(e) => onDeleteThread(t, e)}
                              >
                                🗑️
                              </button>
                            )}
                            <span
                              className="thread-open-link"
                              onClick={() => onSelectThread(t.id)}
                            >
                              打开聊天 →
                            </span>
                          </div>
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
    </>
  );

  const renderProjectRows = () => {
    if (loadState === "loading") {
      return (
        <div className="route-empty-state">
          <FolderIcon size={32} />
          <h3>正在加载项目…</h3>
        </div>
      );
    }

    if (filteredProjects.length === 0) {
      return (
        <div className="route-empty-state">
          <FolderIcon size={32} />
          <h3>{projects.length === 0 ? "没有项目" : "没有匹配的项目"}</h3>
          <p>
            {projects.length === 0
              ? "点击右上角“新建项目”，选择本地文件夹创建第一个项目。"
              : "尝试更换搜索关键词。"}
          </p>
        </div>
      );
    }

    return filteredProjects.map(({ project, projectThreads, matchingThreads, effectiveUpdated }) => {
      const searchExpanded = matchingThreads.length > 0;
      const isExpanded = searchExpanded || !!expandedProjects[project.id];
      const visibleThreads = searchExpanded ? matchingThreads : isExpanded ? [...projectThreads].sort((a, b) =>
        timestampMilliseconds(b.updatedAt || b.createdAt) - timestampMilliseconds(a.updatedAt || a.createdAt)) : [];
      const roots = project.roots;
      const isBusy = actionBusyId === project.id;
      const index = projects.findIndex((item) => item.id === project.id);

      return (
        <div className="projects-table-group" key={project.id}>
          <div
            className={`projects-table-row ${isExpanded ? "active" : ""}`}
            onClick={searchExpanded ? undefined : event => { if (event.detail <= 1) handleToggleProject(project); }}
            onDoubleClick={(event) => {
              if (event.target instanceof Element && event.target.closest("button,a,input,select,textarea")) return;
              handleStartChatInProject(project);
            }}
            title={`${project.name} (双击直接启动聊天)`}
          >
            <div className="project-col-name" title={roots.map((root) => root.path).join("\n")}>
              {!searchExpanded && <button type="button" className="thread-icon-btn" aria-label="展开/折叠项目"
                aria-expanded={isExpanded} onClick={event => { event.stopPropagation(); handleToggleProject(project); }}>
              {isExpanded ? (
                <ChevronDownIcon size={14} />
              ) : (
                <ChevronRightIcon size={14} />
              )}
              </button>}
              <FolderIcon size={16} />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  gap: 1,
                }}
              >
                <span
                  className="project-name-strong"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {project.name}
                </span>
              </div>
            </div>

            <div className="project-col-updated">{formatRelativeTime(effectiveUpdated)}</div>

            <div
              className="project-col-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="thread-icon-btn"
                title="在该项目中新建聊天"
                disabled={isBusy}
                onClick={() => handleStartChatInProject(project)}
              >
                <NewChatComposeIcon size={13} />
              </button>
              <ThreadActionsMenu triggerAriaLabel="项目操作" items={[
                ...(onRevealPath && roots.length > 0 ? [{ id: "reveal", label: "打开目录", disabled: isBusy }] : []),
                { id: "edit", label: "编辑项目", disabled: isBusy },
                { id: "up", label: "上移项目", disabled: isBusy || index <= 0 },
                { id: "down", label: "下移项目", disabled: isBusy || index < 0 || index >= projects.length - 1 },
                { id: "remove", label: "移除项目", danger: true, disabled: isBusy },
              ]} onSelect={action => {
                if (isBusy) return;
                if (action === "reveal") onRevealPath?.(roots[0].path);
                else if (action === "edit") setEditingProject(project);
                else if (action === "up" || action === "down") void handleMoveProject(project, action);
                else if (action === "remove") setRemovingProject(project);
              }} />
            </div>
          </div>

          {isExpanded && (
            <ProjectChatList label={`${project.name} 中最近的聊天`} threads={visibleThreads}
              currentThreadId={currentThreadId} expanded={!!expandedChatPages[project.id]}
              onExpand={() => setExpandedChatPages(previous => ({ ...previous, [project.id]: true }))}
              renderThread={t => {
                const status = typeof t.status === "string" ? t.status : t.status?.type;
                const indicator = status === "active" ? "运行中" : t.readState?.firstUnread != null ? "未读" : "";
                const updated = t.updatedAt || t.createdAt;
                return (
                  <div
                    key={t.id}
                    className="project-expanded-thread-item"
                    onClick={event => { if (event.detail <= 1) onSelectThread(t.id); }}
                  >
                    <button type="button" className="project-expanded-thread-title" onClick={event => {
                      event.stopPropagation();
                      onSelectThread(t.id);
                    }}><span className="project-thread-indicator" role={indicator ? "img" : undefined}
                        aria-label={indicator || undefined} aria-hidden={!indicator}
                        data-status={status === "active" ? "active" : indicator ? "unread" : undefined} />
                      <span>{t.name || t.preview || "未命名聊天"}</span>
                    </button>
                    <span className="project-col-updated">{updated ? formatRelativeTime(updated) : null}</span>
                    <div
                      className="project-thread-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ThreadActionsMenu triggerAriaLabel="聊天操作" items={[
                        ...(onTogglePinThread && pinnedThreadIds ? [{
                          id: "pin", label: pinnedThreadIds.includes(t.id) ? "取消置顶聊天" : "置顶聊天",
                        }] : []),
                        ...(onRenameThread ? [{ id: "rename", label: "重命名聊天" }] : []),
                        { id: "copy-link", label: "复制深层链接" },
                        ...(t.cwd ? [{ id: "copy-cwd", label: "复制工作目录" }] : []),
                      ]} onSelect={action => {
                        if (action === "pin") onTogglePinThread?.(t.id);
                        else if (action === "rename") setRenamingThread(t);
                        else if (action === "copy-link") void copyProjectThreadValue(`codex://threads/${encodeURIComponent(t.id)}`, "深层链接");
                        else if (action === "copy-cwd" && t.cwd) void copyProjectThreadValue(t.cwd, "工作目录");
                      }} />
                      <button type="button" className="thread-icon-btn" aria-label="打开聊天"
                        onClick={() => onSelectThread(t.id)}><ArrowRightIcon size={14} /></button>
                    </div>
                  </div>
                );
              }} />
          )}
        </div>
      );
    });
  };

  const isFallback = loadState === "unavailable";

  return (
    <div className="full-route-view">
      <div className="full-route-container">
        <div className="full-route-header">
          <div>
            <h1 className="full-route-title">项目</h1>
            {projects.length === 0 && <p className="full-route-subtitle">
              创建项目以整理聊天，并授予 Codex 访问你电脑上本地文件夹的权限。
            </p>}
          </div>
          <button
            type="button"
            className="primary-pill-action-btn"
            onClick={isFallback ? onPickNewFolder : handleOpenCreateForm}
            disabled={!isFallback && (creating || formBusy)}
          >
            <PlusIcon size={15} />
            <span>{projects.length === 0 ? "新建项目" : "创建"}</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="route-search-bar">
          <SearchIcon size={15} />
          <input
            type="text"
            placeholder="搜索项目"
            aria-label="搜索项目"
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* 新建项目（真实 project/create） */}
        {!isFallback && creating && (
          <div className="card-section" style={{ marginBottom: 16 }}>
            <h3>新建项目</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>项目名称</label>
                <input
                  type="text"
                  value={draftName}
                  placeholder="例如 my-project"
                  autoFocus
                  disabled={formBusy}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229 || createPendingRef.current) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateProject();
                    }
                    if (e.key === "Escape") resetCreateForm();
                  }}
                />
              </div>
              <div className="form-field">
                <label>根目录（首个为主目录）</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="secondary-pill-action-btn"
                    style={{ flexShrink: 0 }}
                    disabled={formBusy}
                    onClick={() => void handlePickRootFolder()}
                  >
                    <FolderIcon size={13} />
                    <span>选择文件夹</span>
                  </button>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={draftManualRoot}
                    placeholder="或手动输入绝对路径后回车"
                    disabled={formBusy}
                    onChange={(e) => setDraftManualRoot(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229 || createPendingRef.current) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddManualRoot();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="secondary-pill-action-btn"
                    style={{ flexShrink: 0 }}
                    disabled={formBusy || !draftManualRoot.trim()}
                    onClick={handleAddManualRoot}
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>

            {draftRoots.length === 0 ? (
              <p className="card-subtitle-desc">
                尚未添加根目录。项目至少需要一个本地文件夹（可多次选择以追加多个根目录）。
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {draftRoots.map((root, index) => (
                  <div
                    key={root}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: "7px 10px",
                      fontSize: "calc(12.5px * var(--font-ui-scale, 1))",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={root}
                    >
                      {index === 0 ? "★ " : ""}
                      {root}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {index > 0 && (
                        <button
                          type="button"
                          className="secondary-pill-action-btn"
                          style={{ padding: "2px 8px", fontSize: "calc(11px * var(--font-ui-scale, 1))" }}
                          disabled={formBusy}
                          onClick={() => {
                            setDraftRoots((prev) => [root, ...prev.filter((r) => r !== root)]);
                          }}
                          title="将此目录设为主目录"
                        >
                          设为主目录
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-danger-btn"
                        title="移除根目录"
                        disabled={formBusy}
                        onClick={() => handleRemoveDraftRoot(root)}
                      >
                        <CloseIcon size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {formError && (
              <p style={{ color: "#fca5a5", fontSize: "calc(12.5px * var(--font-ui-scale, 1))", margin: 0 }}>
                {formError}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="secondary-pill-action-btn"
                disabled={formBusy}
                onClick={resetCreateForm}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-pill-action-btn"
                disabled={formBusy}
                onClick={() => void handleCreateProject()}
              >
                {formBusy ? "创建中…" : "创建项目"}
              </button>
            </div>
          </div>
        )}

        {editingProject && <ProjectEditDialog key={`edit:${editingProject.id}`} project={editingProject}
          onSave={patch => saveProject(editingProject, patch)}
          onRemove={() => setRemovingProject(editingProject)}
          onClose={() => setEditingProject(null)} />}
        {removingProject && <ProjectRemoveDialog key={`remove:${removingProject.id}`} name={removingProject.name} fallbackRef={searchRef}
          onRemove={() => removeProject(removingProject)} onClose={() => setRemovingProject(null)} />}
        {renamingThread && <RenameThreadDialog key={`thread:${renamingThread.id}`} initialValue={renamingThread.name || renamingThread.preview || ""}
          onClose={() => setRenamingThread(null)} onSave={value => {
            const name = value.trim();
            if (name && name !== renamingThread.name) onRenameThread?.(renamingThread.id, name);
          }} />}

        {/* 列表：真实项目实体；协议失败时回退 workspace 视图 */}
        {isFallback ? renderWorkspaceFallback() : (
          <div className="projects-index-table projects-official-table">
            <div className="projects-table-head">
              <button type="button" className={`project-sort-button ${sort.column === "name" ? "is-active" : ""}`} onClick={() => handleSort("name")}>
                名称
                {sort.column === "name" && <span aria-hidden="true" className={`project-sort-direction ${sort.direction === "descending" ? "descending" : ""}`}><ChevronUpIcon size={12} /></span>}
              </button>
              <button type="button" className={`project-sort-button project-col-updated ${sort.column === "modified" ? "is-active" : ""}`} onClick={() => handleSort("modified")}>
                已更新
                {sort.column === "modified" && <span aria-hidden="true" className={`project-sort-direction ${sort.direction === "descending" ? "descending" : ""}`}><ChevronUpIcon size={12} /></span>}
              </button>
              <span />
            </div>
            {renderProjectRows()}
          </div>
        )}
      </div>
    </div>
  );
};
