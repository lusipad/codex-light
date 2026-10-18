import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OpenAIIcon,
  PlusIcon,
  FolderIcon,
  BranchIcon,
  DiffIcon,
  TerminalIcon,
  BrainIcon,
  ShieldIcon,
  CloseIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SettingsIcon,
  SendIcon,
  StopIcon,
  PinIcon,
  ArchiveIcon,
  WorktreeIcon,
  AutomationIcon,
  SkillIcon,
} from "./components/Icons";
import { callAppServer, tauriInvoke, tauriListen } from "./bridge";
import {
  AppServerStatus,
  AutomationItem,
  CodexConfigOverview,
  DirectoryEntryItem,
  GitStatusInfo,
  ModelInfo,
  PendingServerRequest,
  ThreadSummary,
  TurnData,
  TurnItem,
  WorkspaceRootItem,
} from "./types";
import { MarkdownView } from "./components/MarkdownView";
import { DiffDrawer } from "./components/DiffDrawer";
import { TerminalDock } from "./components/TerminalDock";
import { WorktreesView } from "./components/WorktreesView";
import { AutomationsView } from "./components/AutomationsView";
import { SkillsMcpView } from "./components/SkillsMcpView";
import { SettingsView } from "./components/SettingsView";
import { ComposerControlPills } from "./components/ComposerControlPills";
import { WorkspacePopover } from "./components/WorkspacePopover";
import { ComposerAutocomplete, AutocompleteItem } from "./components/ComposerAutocomplete";
import { AgentsMdModal } from "./components/AgentsMdModal";

const STARTER_PROMPTS = [
  {
    title: "审阅未提交代码",
    desc: "审查当前 Git 工作区中所有修改，检查潜在问题与优化点",
    prompt: "/review 审阅当前 Git 工作区中所有未提交的代码变动，总结修改点并指出潜在缺陷或重构建议。",
  },
  {
    title: "架构与代码结构分析",
    desc: "分析当前工作区的整体架构、模块依赖与核心入口",
    prompt: "请通读当前工作区的目录结构与配置文件，为我梳理出整个项目的架构设计、核心模块与数据流向。",
  },
  {
    title: "创建隔离 Worktree 并开发",
    desc: "为下一项任务创建全新 Git Worktree，避免污染当前分支",
    prompt: "/worktree 创建一个隔离的 Detached Worktree 开始下一个重构任务。",
  },
  {
    title: "生成单元测试与校验",
    desc: "扫描近期改动模块，编写完备的自动化测试用例",
    prompt: "请为当前项目中关键的业务逻辑与适配层编写完备的自动化单元测试用例，并运行测试验证结果。",
  },
];

function extractTextFromItem(item: TurnItem): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(item.summary)) {
    return item.summary
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export const App: React.FC = () => {
  // Navigation & layout state
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(false);
  const [showTerminal, setShowTerminal] = useState<boolean>(false);
  const [modalTab, setModalTab] = useState<"settings" | "worktrees" | "automations" | "skills" | null>(null);
  const [pendingTermCommand, setPendingTermCommand] = useState<{ id: number; command: string } | null>(null);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // App-Server & Config state
  const [appServerStatus, setAppServerStatus] = useState<AppServerStatus>({
    connected: false,
    connecting: true,
    binaryPath: "codex",
    appServerVersion: null,
    userAgent: null,
    lastError: null,
  });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configOverview, setConfigOverview] = useState<CodexConfigOverview | null>(null);

  // Workspaces & Git state
  const [workspaces, setWorkspaces] = useState<WorkspaceRootItem[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);

  // Threads & Conversation state
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnData[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [pendingRequests, setPendingRequests] = useState<PendingServerRequest[]>([]);

  // Composer Input state
  const [promptInput, setPromptInput] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("gpt-5.4");
  const [reasoningEffort, setReasoningEffort] = useState<string>("medium");
  const [permissionMode, setPermissionMode] = useState<"ask" | "auto" | "full">("auto");
  const [useWorktree, setUseWorktree] = useState<boolean>(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  // Workspace Popover & AGENTS.md state
  const [showWorkspacePopover, setShowWorkspacePopover] = useState<boolean>(false);
  const [agentsMdInfo, setAgentsMdInfo] = useState<{ found: boolean; path: string | null; content: string }>({
    found: false,
    path: null,
    content: "",
  });
  const [showAgentsMdModal, setShowAgentsMdModal] = useState<boolean>(false);

  // Thread rename state
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renamingText, setRenamingText] = useState<string>("");

  // Autocomplete state
  const [autocompleteMode, setAutocompleteMode] = useState<"slash" | "mention" | null>(null);
  const [autocompleteQuery, setAutocompleteQuery] = useState<string>("");
  const [autocompleteIndex, setAutocompleteIndex] = useState<number>(0);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  // Active workspace
  const activeWorkspace = useMemo(() => {
    return workspaces.find((w) => w.active) || workspaces[0] || null;
  }, [workspaces]);

  // Load Initial State
  const refreshGlobalState = useCallback(async () => {
    try {
      const state = await tauriInvoke<{
        workspaceRoots: WorkspaceRootItem[];
        pinnedThreadIds: string[];
        recentThreadIds: string[];
        lastUsedModelId?: string;
      }>("load_global_state");
      if (state) {
        setWorkspaces(state.workspaceRoots || []);
        setPinnedThreadIds(state.pinnedThreadIds || []);
        if (state.lastUsedModelId) setSelectedModelId(state.lastUsedModelId);
      }
    } catch (e) {
      console.warn("Failed to load global state:", e);
    }
  }, []);

  const refreshGitStatus = useCallback(async () => {
    if (!activeWorkspace?.path) return;
    try {
      const status = await tauriInvoke<GitStatusInfo>("git_status", {
        cwd: activeWorkspace.path,
      });
      setGitStatus(status);
    } catch {
      setGitStatus(null);
    }
  }, [activeWorkspace?.path]);

  const refreshWorkspaceMeta = useCallback(async () => {
    if (!activeWorkspace?.path) return;
    try {
      const agents = await tauriInvoke<{ found: boolean; path: string | null; content: string }>(
        "workspace_agents_md",
        { cwd: activeWorkspace.path }
      );
      if (agents) setAgentsMdInfo(agents);
    } catch (e) {
      console.warn("Failed to check AGENTS.md:", e);
    }

    try {
      const entries = await tauriInvoke<DirectoryEntryItem[]>("fs_list_dir", {
        path: activeWorkspace.path,
        showHidden: false,
      });
      if (entries) {
        setWorkspaceFiles(entries.map((e) => e.name || e.path));
      }
    } catch (e) {
      console.warn("Failed to list workspace files:", e);
    }
  }, [activeWorkspace?.path]);

  useEffect(() => {
    refreshWorkspaceMeta();
  }, [refreshWorkspaceMeta]);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await callAppServer<{
        data?: ThreadSummary[];
        threads?: ThreadSummary[];
      }>("thread/list", { limit: 50 });
      const list = res.data || res.threads || [];
      setThreads(list);
    } catch (e) {
      console.warn("Failed to list threads:", e);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const res = await callAppServer<{
        data?: ModelInfo[];
        models?: ModelInfo[];
      }>("model/list", {});
      const list = res.data || res.models || [];
      if (list.length > 0) {
        setModels(list);
        if (!list.some((m) => m.id === selectedModelId)) {
          setSelectedModelId(list[0].id);
        }
      }
    } catch (e) {
      console.warn("Failed to list models:", e);
    }
  }, [selectedModelId]);

  const refreshConfigOverview = useCallback(async () => {
    try {
      const overview = await tauriInvoke<CodexConfigOverview>("get_config_overview");
      setConfigOverview(overview);
    } catch (e) {
      console.warn("Failed to get config overview:", e);
    }
  }, []);

  // Listen to App-Server events
  useEffect(() => {
    refreshGlobalState();
    refreshConfigOverview();

    const unlistenStatus = tauriListen<AppServerStatus>("app-server-status", (status) => {
      setAppServerStatus(status);
      if (status.connected) {
        refreshModels();
        refreshThreads();
      }
    });

    const unlistenDelta = tauriListen<any>("app-server-notification", (payload) => {
      const { method, params } = payload || {};
      if (!method) return;

      if (method === "turn/started") {
        setIsStreaming(true);
        const turnId = params?.turnId || `turn-${Date.now()}`;
        setTurns((prev) => {
          if (prev.some((t) => t.id === turnId)) return prev;
          return [
            ...prev,
            {
              id: turnId,
              status: "running",
              startedAt: Date.now(),
              items: [],
            },
          ];
        });
      } else if (method === "turn/completed") {
        setIsStreaming(false);
        const turnId = params?.turnId;
        const duration = params?.turnDurationMs;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId || (!turnId && t.status === "running")
              ? { ...t, status: "completed", completedAt: Date.now(), durationMs: duration }
              : t
          )
        );
      } else if (method === "item/agentMessage/delta") {
        const textDelta = params?.delta || params?.text || "";
        const turnId = params?.turnId;
        setTurns((prev) => {
          const list = [...prev];
          let lastTurn = turnId ? list.find((t) => t.id === turnId) : list[list.length - 1];
          if (!lastTurn) return prev;
          const items = [...lastTurn.items];
          let lastMsg = items.filter((i) => i.type === "agentMessage").pop();
          if (!lastMsg) {
            items.push({
              id: `msg-${Date.now()}`,
              type: "agentMessage",
              text: textDelta,
            });
          } else {
            lastMsg.text = (lastMsg.text || "") + textDelta;
          }
          lastTurn.items = items;
          return list;
        });
      } else if (method === "item/reasoning/delta") {
        const thoughtDelta = params?.delta || params?.text || "";
        setTurns((prev) => {
          const list = [...prev];
          let lastTurn = list[list.length - 1];
          if (!lastTurn) return prev;
          const items = [...lastTurn.items];
          let lastThought = items.filter((i) => i.type === "reasoning").pop();
          if (!lastThought) {
            items.push({
              id: `thought-${Date.now()}`,
              type: "reasoning",
              text: thoughtDelta,
            });
          } else {
            lastThought.text = (lastThought.text || "") + thoughtDelta;
          }
          lastTurn.items = items;
          return list;
        });
      } else if (method === "item/commandExecution/outputDelta") {
        const outDelta = params?.delta || params?.output || "";
        const itemId = params?.itemId;
        setTurns((prev) => {
          const list = [...prev];
          let lastTurn = list[list.length - 1];
          if (!lastTurn) return prev;
          const items = lastTurn.items.map((it) => {
            if (it.id === itemId || it.type === "commandExecution") {
              return { ...it, output: (it.output || "") + outDelta };
            }
            return it;
          });
          lastTurn.items = items;
          return list;
        });
      }
    });

    const unlistenServerReq = tauriListen<PendingServerRequest>("app-server-request", (req) => {
      setPendingRequests((prev) => [...prev, req]);
    });

    return () => {
      unlistenStatus.then((f) => f());
      unlistenDelta.then((f) => f());
      unlistenServerReq.then((f) => f());
    };
  }, [refreshGlobalState, refreshConfigOverview, refreshModels, refreshThreads]);

  useEffect(() => {
    refreshGitStatus();
  }, [refreshGitStatus]);

  // Auto-scroll timeline to bottom
  useEffect(() => {
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
    }
  }, [turns, isStreaming]);

  // Handle Thread Creation or Selection
  const startNewThread = useCallback(() => {
    setActiveThreadId(null);
    setTurns([]);
    if (composerTextareaRef.current) composerTextareaRef.current.focus();
  }, []);

  const selectThread = useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    try {
      const res = await callAppServer<{ turns?: TurnData[]; data?: TurnData[] }>(
        "thread/get",
        { threadId }
      );
      setTurns(res.turns || res.data || []);
    } catch (e) {
      console.warn("Failed to get thread turns:", e);
    }
  }, []);

  // Send Prompt to Codex
  const handleSendMessage = useCallback(async () => {
    const text = promptInput.trim();
    if (!text || isStreaming) return;

    setPromptInput("");

    // Create user message turn
    const userTurn: TurnData = {
      id: `user-${Date.now()}`,
      status: "completed",
      startedAt: Date.now(),
      items: [{ id: `u-${Date.now()}`, type: "userMessage", text }],
    };
    setTurns((prev) => [...prev, userTurn]);
    setIsStreaming(true);

    try {
      let currentThreadId = activeThreadId;
      if (!currentThreadId) {
        const createRes = await callAppServer<{ threadId?: string; id?: string }>(
          "thread/create",
          {
            cwd: activeWorkspace?.path,
            model: selectedModelId,
          }
        );
        currentThreadId = createRes.threadId || createRes.id || `thread-${Date.now()}`;
        setActiveThreadId(currentThreadId);
        refreshThreads();
      }

      await callAppServer("turn/start", {
        threadId: currentThreadId,
        input: [{ type: "text", text }],
        model: selectedModelId,
        reasoningEffort,
        permissionMode,
      });
    } catch (err: any) {
      console.error("Turn start failed:", err);
      setIsStreaming(false);
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          status: "failed",
          startedAt: Date.now(),
          items: [
            {
              id: `err-item-${Date.now()}`,
              type: "agentMessage",
              text: `⚠️ 执行出错: ${err?.message || err}`,
            },
          ],
        },
      ]);
    }
  }, [promptInput, isStreaming, activeThreadId, activeWorkspace?.path, selectedModelId, reasoningEffort, permissionMode, refreshThreads]);

  // Approval decision
  const handleApprovalDecision = useCallback(
    async (requestId: any, decision: "accept" | "acceptForSession" | "decline") => {
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      try {
        await tauriInvoke("app_server_respond", {
          id: requestId,
          result: { decision },
          error: null,
        });
      } catch (e) {
        console.error("Failed to respond to server request:", e);
      }
    },
    []
  );

  // Pin / Unpin thread
  const togglePinThread = useCallback(
    async (threadId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const isPinned = pinnedThreadIds.includes(threadId);
      const next = isPinned ? pinnedThreadIds.filter((id) => id !== threadId) : [threadId, ...pinnedThreadIds];
      setPinnedThreadIds(next);
      try {
        await tauriInvoke("save_global_state", {
          state: {
            workspaceRoots: workspaces,
            pinnedThreadIds: next,
            recentThreadIds: threads.map((t) => t.id),
            lastUsedModelId: selectedModelId,
          },
        });
      } catch (err) {
        console.warn("Failed to save pinned threads:", err);
      }
    },
    [pinnedThreadIds, workspaces, threads, selectedModelId]
  );

  // Workspace management
  const handleSelectWorkspace = useCallback(async (path: string) => {
    try {
      const updated = await tauriInvoke<WorkspaceRootItem[]>("workspace_set_active", { path });
      setWorkspaces(updated);
    } catch (e) {
      console.warn("Failed to set active workspace:", e);
    }
  }, []);

  const handleRemoveWorkspace = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await tauriInvoke<WorkspaceRootItem[]>("workspace_remove", { path });
      setWorkspaces(updated);
    } catch (e) {
      console.warn("Failed to remove workspace:", e);
    }
  }, []);

  const handlePickNewFolder = useCallback(async () => {
    try {
      const picked = await tauriInvoke<string | null>("pick_folder_dialog");
      if (picked) {
        const label = picked.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || picked;
        const updated = await tauriInvoke<WorkspaceRootItem[]>("workspace_add", {
          path: picked,
          label,
          setActive: true,
        });
        setWorkspaces(updated);
      }
    } catch (e) {
      console.warn("Failed to pick folder:", e);
    }
  }, []);

  // Thread rename & archive
  const handleStartRename = useCallback((threadId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingThreadId(threadId);
    setRenamingText(currentName);
  }, []);

  const handleCommitRename = useCallback(async (threadId: string) => {
    const nextName = renamingText.trim();
    if (!nextName) {
      setRenamingThreadId(null);
      return;
    }
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, name: nextName } : t)));
    setRenamingThreadId(null);
    try {
      await callAppServer("thread/name", { threadId, name: nextName });
    } catch {
      // Ignore if thread/name is unsupported by older app-server
    }
  }, [renamingText]);

  const handleArchiveThread = useCallback(async (thread: ThreadSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await tauriInvoke("thread_archive_toggle", { thread, archive: true });
      setThreads((prev) => prev.filter((t) => t.id !== thread.id));
      if (activeThreadId === thread.id) {
        startNewThread();
      }
    } catch (err) {
      console.warn("Failed to archive thread:", err);
    }
  }, [activeThreadId, startNewThread]);

  // Autocomplete handlers
  const handleComposerInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPromptInput(val);
    if (val.startsWith("/")) {
      setAutocompleteMode("slash");
      setAutocompleteQuery(val);
      setAutocompleteIndex(0);
    } else {
      const match = val.match(/@([a-zA-Z0-9_\-./]*)$/);
      if (match) {
        setAutocompleteMode("mention");
        setAutocompleteQuery(match[1]);
        setAutocompleteIndex(0);
      } else {
        setAutocompleteMode(null);
      }
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocompleteMode) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((i) => i + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocompleteMode(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleAutocompleteSelect = useCallback((item: AutocompleteItem) => {
    if (item.type === "slash") {
      setPromptInput(item.insertText);
    } else {
      setPromptInput((prev) => prev.replace(/@[a-zA-Z0-9_\-./]*$/, item.insertText));
    }
    setAutocompleteMode(null);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.focus();
    }
  }, []);

  // Filtered threads list
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    return threads.filter((t) => (t.name || t.preview || t.id).toLowerCase().includes(searchQuery.toLowerCase()));
  }, [threads, searchQuery]);

  const pinnedThreads = useMemo(() => {
    return filteredThreads.filter((t) => pinnedThreadIds.includes(t.id));
  }, [filteredThreads, pinnedThreadIds]);

  const unpinnedThreads = useMemo(() => {
    return filteredThreads.filter((t) => !pinnedThreadIds.includes(t.id));
  }, [filteredThreads, pinnedThreadIds]);

  return (
    <div className="codex-app-layout">
      {/* ── 1. Left Sidebar ── */}
      <aside className="codex-sidebar">
        {/* Workspace selector at top */}
        <div className="sidebar-top-bar" style={{ position: "relative" }}>
          <button
            className="workspace-badge-btn"
            title={activeWorkspace?.path || "选择工作区"}
            onClick={() => setShowWorkspacePopover((v) => !v)}
          >
            <FolderIcon size={16} />
            <span className="workspace-title-text">{activeWorkspace?.label || "codex-app-offline"}</span>
            <ChevronDownIcon size={13} />
          </button>

          {showWorkspacePopover && (
            <WorkspacePopover
              workspaces={workspaces}
              activeWorkspacePath={activeWorkspace?.path || ""}
              hasAgentsMd={agentsMdInfo.found}
              onSelectWorkspace={handleSelectWorkspace}
              onRemoveWorkspace={handleRemoveWorkspace}
              onPickNewFolder={handlePickNewFolder}
              onOpenAgentsMd={() => setShowAgentsMdModal(true)}
              onClose={() => setShowWorkspacePopover(false)}
            />
          )}
        </div>

        {/* New Task Button (OpenAI signature pill) */}
        <button className="new-task-pill-btn" onClick={startNewThread}>
          <div className="new-task-left">
            <PlusIcon size={16} />
            <span>新建任务</span>
          </div>
          <span className="kbd-badge">Ctrl+N</span>
        </button>

        {/* Threads List */}
        <div className="sidebar-threads-scroll">
          {pinnedThreads.length > 0 && (
            <>
              <div className="sidebar-section-title">
                <span>置顶会话</span>
                <PinIcon size={12} />
              </div>
              {pinnedThreads.map((t) => (
                <div
                  key={t.id}
                  className={`sidebar-thread-row ${activeThreadId === t.id ? "active" : ""}`}
                  onClick={() => selectThread(t.id)}
                >
                  <div className="sidebar-thread-left">
                    {renamingThreadId === t.id ? (
                      <input
                        className="sidebar-thread-rename-input"
                        value={renamingText}
                        onChange={(e) => setRenamingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCommitRename(t.id);
                          if (e.key === "Escape") setRenamingThreadId(null);
                        }}
                        onBlur={() => handleCommitRename(t.id)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="sidebar-thread-title">{t.name || t.preview || "未命名任务"}</span>
                    )}
                  </div>
                  <div className="sidebar-thread-actions">
                    <button
                      className="thread-icon-btn"
                      title="重命名"
                      onClick={(e) => handleStartRename(t.id, t.name || t.preview || "未命名任务", e)}
                    >
                      ✏️
                    </button>
                    <button
                      className="thread-icon-btn"
                      title="归档任务"
                      onClick={(e) => handleArchiveThread(t, e)}
                    >
                      <ArchiveIcon size={13} />
                    </button>
                    <button
                      className="thread-icon-btn"
                      title="取消置顶"
                      onClick={(e) => togglePinThread(t.id, e)}
                    >
                      <PinIcon size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="sidebar-section-title" style={{ marginTop: pinnedThreads.length > 0 ? 10 : 0 }}>
            <span>近期任务</span>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{unpinnedThreads.length}</span>
          </div>

          {unpinnedThreads.length === 0 ? (
            <div style={{ padding: "16px 12px", color: "var(--text-tertiary)", fontSize: 12.5, textAlign: "center" }}>
              暂无历史任务
            </div>
          ) : (
            unpinnedThreads.map((t) => (
              <div
                key={t.id}
                className={`sidebar-thread-row ${activeThreadId === t.id ? "active" : ""}`}
                onClick={() => selectThread(t.id)}
              >
                <div className="sidebar-thread-left">
                  {renamingThreadId === t.id ? (
                    <input
                      className="sidebar-thread-rename-input"
                      value={renamingText}
                      onChange={(e) => setRenamingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCommitRename(t.id);
                        if (e.key === "Escape") setRenamingThreadId(null);
                      }}
                      onBlur={() => handleCommitRename(t.id)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="sidebar-thread-title">{t.name || t.preview || "未命名任务"}</span>
                  )}
                </div>
                <div className="sidebar-thread-actions">
                  <button
                    className="thread-icon-btn"
                    title="重命名"
                    onClick={(e) => handleStartRename(t.id, t.name || t.preview || "未命名任务", e)}
                  >
                    ✏️
                  </button>
                  <button
                    className="thread-icon-btn"
                    title="归档任务"
                    onClick={(e) => handleArchiveThread(t, e)}
                  >
                    <ArchiveIcon size={13} />
                  </button>
                  <button
                    className="thread-icon-btn"
                    title="置顶"
                    onClick={(e) => togglePinThread(t.id, e)}
                  >
                    <PinIcon size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer Navigation */}
        <div className="sidebar-bottom-bar">
          <button className="sidebar-nav-btn" onClick={() => setModalTab("worktrees")}>
            <WorktreeIcon size={16} />
            <span>Git Worktrees 隔离环境</span>
          </button>
          <button className="sidebar-nav-btn" onClick={() => setModalTab("automations")}>
            <AutomationIcon size={16} />
            <span>Automations 计划任务</span>
          </button>
          <button className="sidebar-nav-btn" onClick={() => setModalTab("skills")}>
            <SkillIcon size={16} />
            <span>Skills & MCP 扩展中心</span>
          </button>
          <button className="sidebar-nav-btn" onClick={() => setModalTab("settings")}>
            <SettingsIcon size={16} />
            <span>设置 & 离线模型目录</span>
          </button>
        </div>
      </aside>

      {/* ── 2. Center Main Canvas ── */}
      <main className="codex-main-area">
        {/* Top Header Navbar */}
        <header className="main-top-navbar">
          <div className="top-nav-left">
            <div className="project-branch-pill">
              <BranchIcon size={14} />
              <span>{gitStatus?.branch || "main"}</span>
            </div>
            {useWorktree && (
              <div className="project-branch-pill" style={{ color: "var(--accent-blue)", background: "rgba(58,131,247,0.12)" }}>
                <WorktreeIcon size={14} />
                <span>Detached Worktree 模式</span>
              </div>
            )}
          </div>

          <div className="top-nav-right">
            {/* Diff pill */}
            <button
              className={`nav-icon-pill-btn ${showRightDrawer ? "active" : ""}`}
              onClick={() => setShowRightDrawer((v) => !v)}
              title="代码变更审阅"
            >
              <DiffIcon size={15} />
              <span>Diff</span>
              {(gitStatus?.filesChanged || 0) > 0 && (
                <span className="diff-stats-badge">
                  <span className="diff-plus">+{gitStatus?.additions || 0}</span>{" "}
                  <span className="diff-minus">-{gitStatus?.deletions || 0}</span>
                </span>
              )}
            </button>

            {/* Terminal pill */}
            <button
              className={`nav-icon-pill-btn ${showTerminal ? "active" : ""}`}
              onClick={() => setShowTerminal((v) => !v)}
              title="内置交互式终端"
            >
              <TerminalIcon size={15} />
              <span>终端</span>
            </button>
          </div>
        </header>

        {/* Content View: Hero/Home or Active Stream */}
        {turns.length === 0 ? (
          /* ── 2A. Authentic Centered Hero Home Screen ── */
          <div className="home-hero-container">
            <div className="home-hero-logo-wrap">
              <OpenAIIcon size={42} />
            </div>
            <h1 className="home-greeting-title">今天要构建什么？</h1>

            {/* Centered Large Hero Composer */}
            <div className="home-composer-box" style={{ position: "relative" }}>
              {autocompleteMode && (
                <ComposerAutocomplete
                  mode={autocompleteMode}
                  query={autocompleteQuery}
                  files={workspaceFiles}
                  selectedIndex={autocompleteIndex}
                  onSelect={handleAutocompleteSelect}
                  onClose={() => setAutocompleteMode(null)}
                />
              )}

              <textarea
                ref={composerTextareaRef}
                className="composer-textarea"
                rows={3}
                placeholder="让 Codex 编写代码、分析问题或直接运行命令... (输入 @ 引用文件，/ 快捷指令)"
                value={promptInput}
                onChange={handleComposerInputChange}
                onKeyDown={handleComposerKeyDown}
              />

              {/* Bottom control pills */}
              <div className="composer-bottom-bar">
                <ComposerControlPills
                  models={models}
                  selectedModelId={selectedModelId}
                  onSelectModelId={setSelectedModelId}
                  reasoningEffort={reasoningEffort}
                  onSelectReasoningEffort={setReasoningEffort}
                  permissionMode={permissionMode}
                  onSelectPermissionMode={setPermissionMode}
                  useWorktree={useWorktree}
                  onToggleWorktree={() => setUseWorktree((v) => !v)}
                />

                {isStreaming ? (
                  <button className="stop-action-btn" title="停止生成">
                    <StopIcon size={14} />
                  </button>
                ) : (
                  <button
                    className="send-action-btn"
                    disabled={!promptInput.trim()}
                    onClick={handleSendMessage}
                    title="发送任务"
                  >
                    <SendIcon size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Quick Starter Suggestions */}
            <div className="home-suggestions-grid">
              {STARTER_PROMPTS.map((item, idx) => (
                <div
                  key={idx}
                  className="suggestion-card"
                  onClick={() => {
                    setPromptInput(item.prompt);
                    if (composerTextareaRef.current) composerTextareaRef.current.focus();
                  }}
                >
                  <span className="suggestion-card-title">{item.title}</span>
                  <span className="suggestion-card-desc">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ── 2B. Active Conversation Timeline Stream ── */
          <>
            <div className="timeline-scroll-pane" ref={timelineScrollRef}>
              <div className="timeline-content-wrapper">
                {turns.map((turn) => {
                  const isUser = turn.items.some((i) => i.type === "userMessage");
                  if (isUser) {
                    const text = turn.items.map(extractTextFromItem).join("\n");
                    return (
                      <div key={turn.id} className="user-turn-block">
                        <div className="user-bubble">{text}</div>
                      </div>
                    );
                  }

                  // Assistant Turn
                  const thoughts = turn.items.filter((i) => i.type === "reasoning");
                  const commands = turn.items.filter((i) => i.type === "commandExecution");
                  const fileChanges = turn.items.filter((i) => i.type === "fileChange");
                  const messages = turn.items.filter((i) => i.type === "agentMessage");
                  const isExpanded = expandedThoughts[turn.id] ?? false;

                  return (
                    <div key={turn.id} className="assistant-turn-block">
                      <div className="assistant-header">
                        <OpenAIIcon size={18} />
                        <span>Codex</span>
                        {turn.durationMs && (
                          <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 400 }}>
                            · {(turn.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>

                      {/* Collapsible Thoughts Accordion */}
                      {thoughts.length > 0 && (
                        <div className="thought-accordion">
                          <div
                            className="thought-header"
                            onClick={() =>
                              setExpandedThoughts((prev) => ({
                                ...prev,
                                [turn.id]: !isExpanded,
                              }))
                            }
                          >
                            <BrainIcon size={14} />
                            <span>{isStreaming ? "正在思考..." : `已思考 ${thoughts.length > 1 ? `(${thoughts.length} 段)` : ""}`}</span>
                            {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                          </div>
                          {isExpanded && (
                            <div className="thought-body">{thoughts.map(extractTextFromItem).join("\n")}</div>
                          )}
                        </div>
                      )}

                      {/* Commands execution cards */}
                      {commands.map((cmd, cIdx) => (
                        <div key={cmd.id || cIdx} className="command-exec-card">
                          <div className="command-exec-header">
                            <div className="command-exec-title">
                              <TerminalIcon size={13} />
                              <span>$ {Array.isArray(cmd.command) ? cmd.command.join(" ") : cmd.command || "command"}</span>
                            </div>
                            <span style={{ fontSize: 11, color: cmd.exitCode === 0 ? "#22c55e" : "#eab308" }}>
                              {cmd.exitCode !== undefined && cmd.exitCode !== null ? `exit ${cmd.exitCode}` : "运行中..."}
                            </span>
                          </div>
                          {cmd.output && <div className="command-exec-body">{cmd.output}</div>}
                        </div>
                      ))}

                      {/* File Changes cards */}
                      {fileChanges.map((fc, fIdx) => (
                        <div
                          key={fc.id || fIdx}
                          className="file-change-card"
                          onClick={() => {
                            if (fc.path) setSelectedPreviewFile(fc.path);
                            setShowRightDrawer(true);
                          }}
                        >
                          <div className="file-change-left">
                            <DiffIcon size={15} />
                            <span>{fc.path || "Modified file"}</span>
                          </div>
                          <span className="diff-stats-badge">
                            <span className="diff-plus">+{fc.insertions || 0}</span>{" "}
                            <span className="diff-minus">-{fc.deletions || 0}</span>
                          </span>
                        </div>
                      ))}

                      {/* Assistant Markdown Text */}
                      {messages.map((msg, mIdx) => (
                        <MarkdownView key={msg.id || mIdx} content={extractTextFromItem(msg)} />
                      ))}
                    </div>
                  );
                })}

                {/* Inline Pending Approvals */}
                {pendingRequests.map((req) => (
                  <div key={req.id} className="approval-card">
                    <div className="approval-header">
                      <ShieldIcon size={18} />
                      <span>需要确认安全操作</span>
                    </div>
                    <div className="approval-details">
                      {req.params?.command ? `$ ${req.params.command}` : JSON.stringify(req.params)}
                    </div>
                    <div className="approval-btn-group">
                      <button className="btn-approve" onClick={() => handleApprovalDecision(req.id, "accept")}>
                        允许执行一次
                      </button>
                      <button className="btn-session" onClick={() => handleApprovalDecision(req.id, "acceptForSession")}>
                        本会话始终允许
                      </button>
                      <button className="btn-decline" onClick={() => handleApprovalDecision(req.id, "decline")}>
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating Composer at bottom */}
            <div className="floating-composer-dock">
              <div className="floating-composer-inner">
                <div className="home-composer-box" style={{ position: "relative" }}>
                  {autocompleteMode && (
                    <ComposerAutocomplete
                      mode={autocompleteMode}
                      query={autocompleteQuery}
                      files={workspaceFiles}
                      selectedIndex={autocompleteIndex}
                      onSelect={handleAutocompleteSelect}
                      onClose={() => setAutocompleteMode(null)}
                    />
                  )}

                  <textarea
                    ref={composerTextareaRef}
                    className="composer-textarea"
                    rows={2}
                    placeholder="输入后续指示或追问... (输入 @ 引用文件，/ 快捷指令)"
                    value={promptInput}
                    onChange={handleComposerInputChange}
                    onKeyDown={handleComposerKeyDown}
                  />

                  <div className="composer-bottom-bar">
                    <ComposerControlPills
                      models={models}
                      selectedModelId={selectedModelId}
                      onSelectModelId={setSelectedModelId}
                      reasoningEffort={reasoningEffort}
                      onSelectReasoningEffort={setReasoningEffort}
                      permissionMode={permissionMode}
                      onSelectPermissionMode={setPermissionMode}
                      useWorktree={useWorktree}
                      onToggleWorktree={() => setUseWorktree((v) => !v)}
                    />

                    {isStreaming ? (
                      <button className="stop-action-btn" title="停止生成">
                        <StopIcon size={14} />
                      </button>
                    ) : (
                      <button
                        className="send-action-btn"
                        disabled={!promptInput.trim()}
                        onClick={handleSendMessage}
                        title="发送任务"
                      >
                        <SendIcon size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Bottom Interactive Terminal Dock */}
        {showTerminal && (
          <TerminalDock
            cwd={activeWorkspace?.path || ""}
            onClose={() => setShowTerminal(false)}
            pendingCommand={pendingTermCommand}
          />
        )}
      </main>

      {/* ── 3. Right-Hand Diff / File Drawer ── */}
      {showRightDrawer && (
        <DiffDrawer
          cwd={activeWorkspace?.path || ""}
          gitStatus={gitStatus}
          onRefreshGit={refreshGitStatus}
          onClose={() => setShowRightDrawer(false)}
          selectedPreviewFile={selectedPreviewFile}
          onSelectPreviewFile={setSelectedPreviewFile}
        />
      )}

      {/* ── 4. Unified Settings & Subsystem Modal ── */}
      {modalTab && (
        <div className="codex-modal-overlay" onClick={() => setModalTab(null)}>
          <div className="codex-modal-dialog" onClick={(e) => e.stopPropagation()}>
            {/* Modal Left Navigation */}
            <div className="modal-sidebar-nav">
              <button
                className={`modal-nav-item ${modalTab === "settings" ? "active" : ""}`}
                onClick={() => setModalTab("settings")}
              >
                <SettingsIcon size={16} />
                <span>常规与模型设置</span>
              </button>
              <button
                className={`modal-nav-item ${modalTab === "skills" ? "active" : ""}`}
                onClick={() => setModalTab("skills")}
              >
                <SkillIcon size={16} />
                <span>Skills & MCP 插件</span>
              </button>
              <button
                className={`modal-nav-item ${modalTab === "worktrees" ? "active" : ""}`}
                onClick={() => setModalTab("worktrees")}
              >
                <WorktreeIcon size={16} />
                <span>Git Worktrees 隔离环境</span>
              </button>
              <button
                className={`modal-nav-item ${modalTab === "automations" ? "active" : ""}`}
                onClick={() => setModalTab("automations")}
              >
                <AutomationIcon size={16} />
                <span>Automations 计划任务</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="modal-content-area">
              <button className="modal-close-btn" onClick={() => setModalTab(null)}>
                <CloseIcon size={18} />
              </button>

              {modalTab === "settings" && (
                <SettingsView
                  appServerStatus={appServerStatus}
                  models={models}
                  onRestartAppServer={(cliPath) =>
                    tauriInvoke("app_server_start", { customCliPath: cliPath || null })
                  }
                  onConfigUpdated={refreshConfigOverview}
                />
              )}
              {modalTab === "skills" && (
                <SkillsMcpView activeWorkspaceRoot={activeWorkspace?.path || ""} />
              )}
              {modalTab === "worktrees" && (
                <WorktreesView
                  activeWorkspaceRoot={activeWorkspace?.path || ""}
                  onStartChatInWorktree={(wtPath) => {
                    setUseWorktree(true);
                    setModalTab(null);
                  }}
                />
              )}
              {modalTab === "automations" && (
                <AutomationsView
                  activeWorkspaceRoot={activeWorkspace?.path || ""}
                  models={models}
                  onRunAutomationNow={(item) => {
                    setModalTab(null);
                    setPromptInput(`[执行自动化任务: ${item.name}]\n${item.prompt}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 5. AGENTS.md Inspector & Editor Modal ── */}
      {showAgentsMdModal && (
        <AgentsMdModal
          cwd={activeWorkspace?.path || ""}
          initialContent={agentsMdInfo.content}
          onClose={() => setShowAgentsMdModal(false)}
          onSaved={(newContent) => {
            setAgentsMdInfo((prev) => ({ ...prev, content: newContent }));
          }}
        />
      )}
    </div>
  );
};

