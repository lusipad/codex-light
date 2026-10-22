import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OpenAIIcon,
  BranchIcon,
  DiffIcon,
  TerminalIcon,
  BrainIcon,
  ShieldIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  WorktreeIcon,
  CodexHeroIcon,
  BottomPanelIcon,
  RightPanelIcon,
  PlayIcon,
} from "./components/Icons";
import { callAppServer, tauriInvoke, tauriListen } from "./bridge";
import {
  AppServerStatus,
  AttachedFileItem,
  CodexConfigOverview,
  DirectoryEntryItem,
  GitStatusInfo,
  InboxNotificationItem,
  MainViewRoute,
  ModelInfo,
  PendingServerRequest,
  PetSpeciesId,
  QueuedFollowupPrompt,
  SettingsSectionSlug,
  SkillInfoItem,
  ThreadSummary,
  TurnData,
  TurnItem,
  WorkspaceFileHit,
  WorkspaceRootItem,
  ActiveGoalSession,
  GoalStepItem,
  ShellExecResult,
  ProjectScriptCommands,
} from "./types";
import { MarkdownView } from "./components/MarkdownView";
import { DiffDrawer } from "./components/DiffDrawer";
import { TerminalDock } from "./components/TerminalDock";
import { WorktreesView } from "./components/WorktreesView";
import { AutomationsView } from "./components/AutomationsView";
import { SkillsMcpView } from "./components/SkillsMcpView";
import { SettingsView, applyColorTheme } from "./components/SettingsView";
import { WorkspacePopover } from "./components/WorkspacePopover";
import { AgentsMdModal } from "./components/AgentsMdModal";
import { NavigationRail } from "./components/NavigationRail";
import { CodexSidebar } from "./components/CodexSidebar";
import { ComposerBox } from "./components/ComposerBox";
import { ProjectsIndexView } from "./components/ProjectsIndexView";
import { InboxView } from "./components/InboxView";
import { MiniPetWidget } from "./components/MiniPetWidget";
import { QuickSearchModal } from "./components/QuickSearchModal";
import { GoalSetupModal, GoalSetupConfig } from "./components/GoalSetupModal";
import { GoalProgressBanner } from "./components/GoalProgressBanner";

const STARTER_PROMPTS = [
  {
    title: "审阅未提交代码 (/review)",
    desc: "审查当前 Git 工作区中所有修改，指出潜在缺陷与重构建议",
    prompt: "/review 请审阅当前 Git 工作区中所有未提交的代码变动，总结修改点并指出潜在缺陷或重构建议。",
  },
  {
    title: "架构与模块流向梳理",
    desc: "分析当前项目的整体架构、核心入口与模块依赖",
    prompt: "请通读当前项目的目录结构与核心代码，梳理出整体架构设计、核心模块职责与数据流向。",
  },
  {
    title: "制定功能实施计划 (/plan)",
    desc: "先进行技术方案权衡与分步拆解，确认后再改动代码",
    prompt: "/plan 请先分析当前代码库并制定详细的分步实施方案，列出涉及的文件与验证步骤。",
  },
  {
    title: "补充自动化单元测试 (/test)",
    desc: "扫描近期核心模块改动，编写并运行完备测试用例",
    prompt: "/test 请为当前项目中关键的业务逻辑编写自动化单元测试，并运行测试验证通过。",
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

function extractChecklistFromText(text: string): GoalStepItem[] {
  if (!text) return [];
  const lines = text.split("\n");
  const items: GoalStepItem[] = [];
  let idx = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    const matchCompleted = trimmed.match(/^-\s*\[[xX]\]\s*(.+)$/);
    if (matchCompleted) {
      items.push({
        id: `step-${idx++}`,
        title: matchCompleted[1].trim(),
        status: "completed",
      });
      continue;
    }
    const matchPending = trimmed.match(/^-\s*\[\s*\]\s*(.+)$/);
    if (matchPending) {
      items.push({
        id: `step-${idx++}`,
        title: matchPending[1].trim(),
        status: "pending",
      });
    }
  }
  return items;
}

function playNotificationChime(kind: "nudge" | "done" = "done") {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const now = ctx.currentTime;
    if (kind === "done") {
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch {
    // audio context blocked or unsupported
  }
}

function normalizeTurnsFromThread(threadObj: any): TurnData[] {
  const rawTurns =
    threadObj?.turns ||
    threadObj?.thread?.turns ||
    threadObj?.data ||
    [];
  if (!Array.isArray(rawTurns)) return [];
  return rawTurns.map((t: any, idx: number) => ({
    id: t.id || `turn-${idx}`,
    status: t.status || "completed",
    startedAt: t.startedAt || t.firstTurnWorkItemStartedAtMs || null,
    completedAt: t.completedAt || null,
    durationMs: t.durationMs || null,
    items: Array.isArray(t.items) ? t.items : [],
  }));
}

export const App: React.FC = () => {
  // Primary Route & Shell Layout State
  const [activeRoute, setActiveRoute] = useState<MainViewRoute>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(false);
  const [showTerminal, setShowTerminal] = useState<boolean>(false);
  const [pendingTermCommand, setPendingTermCommand] = useState<{
    id: number;
    command: string;
  } | null>(null);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<string | null>(null);

  // App-Server & Config State
  const [appServerStatus, setAppServerStatus] = useState<AppServerStatus>({
    connected: false,
    connecting: true,
    binaryPath: "codex",
    appServerVersion: null,
    userAgent: null,
    lastError: null,
  });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [, setConfigOverview] = useState<CodexConfigOverview | null>(null);

  // Workspaces & Git State
  const [workspaces, setWorkspaces] = useState<WorkspaceRootItem[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [gitBranches, setGitBranches] = useState<string[]>([]);

  // Threads, Pinned, Hints & Conversation State
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const [workspaceHints, setWorkspaceHints] = useState<Record<string, string>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnData[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [pendingRequests, setPendingRequests] = useState<PendingServerRequest[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxNotificationItem[]>([]);

  // Composer State
  const [promptInput, setPromptInput] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("gpt-6.1-sol");
  const [reasoningEffort, setReasoningEffort] = useState<string>("low");
  const [permissionMode, setPermissionMode] = useState<"ask" | "auto" | "full">("ask");
  const [useWorktree, setUseWorktree] = useState<boolean>(false);
  const [fastMode, setFastMode] = useState<boolean>(false);
  const [planMode, setPlanMode] = useState<boolean>(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  // Project Picker Popover on Home Title & AGENTS.md Modal
  const [showHomeProjectPopover, setShowHomeProjectPopover] = useState<boolean>(false);
  const [agentsMdInfo, setAgentsMdInfo] = useState<{
    found: boolean;
    path: string | null;
    content: string;
  }>({
    found: false,
    path: null,
    content: "",
  });
  const [showAgentsMdModal, setShowAgentsMdModal] = useState<boolean>(false);

  // Workspace Files & Skills for @ Mention Autocomplete
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceFileHits, setWorkspaceFileHits] = useState<WorkspaceFileHit[]>([]);
  const [skills, setSkills] = useState<SkillInfoItem[]>([]);

  // Phase 2, 4, 5: Follow-up Queue, Interactive AskUserInput, Pet Widget & Toolbar
  const [followupQueue, setFollowupQueue] = useState<QueuedFollowupPrompt[]>([]);
  const [userInputAnswers, setUserInputAnswers] = useState<Record<string, string>>({});
  const [showGitMenu, setShowGitMenu] = useState<boolean>(false);
  const [showUsagePopover, setShowUsagePopover] = useState<boolean>(false);
  const [showSessionParamsPopover, setShowSessionParamsPopover] = useState<boolean>(false);
  const [showExportPopover, setShowExportPopover] = useState<boolean>(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionSlug>("general-settings");

  // Project Script Commands Detection
  const [projectScripts, setProjectScripts] = useState<ProjectScriptCommands>({
    runCommand: "npm run dev",
    testCommand: "npm test",
    buildCommand: "npm run build",
    projectType: "node",
  });
  const [customInstructions, setCustomInstructions] = useState<string>("");
  const [toneStyle, setToneStyle] = useState<string>("pragmatic");

  // In-session Hyperparameters
  const [sessionTemperature, setSessionTemperature] = useState<number>(0.2);
  const [sessionTopP, setSessionTopP] = useState<number>(1.0);
  const [sessionMaxTokens, setSessionMaxTokens] = useState<number>(8192);
  const [sessionWebSearch, setSessionWebSearch] = useState<"disabled" | "cached" | "live">("cached");
  const [sessionAllowNetwork, setSessionAllowNetwork] = useState<boolean>(true);
  const [sessionVerbosity, setSessionVerbosity] = useState<"low" | "medium" | "high">("medium");

  const [petVisible, setPetVisible] = useState<boolean>(false);
  const [selectedPetSpecies, setSelectedPetSpecies] = useState<PetSpeciesId>("codex");
  const [showQuickSearch, setShowQuickSearch] = useState<boolean>(false);

  // Global Toast & Header inline rename
  const [appToast, setAppToast] = useState<{
    id: number;
    message: string;
    type?: "info" | "success" | "error";
  } | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState(false);
  const [threadTitleInput, setThreadTitleInput] = useState("");

  const showAppToast = useCallback(
    (message: string, type: "info" | "success" | "error" = "info") => {
      const id = Date.now();
      setAppToast({ id, message, type });
      setTimeout(() => {
        setAppToast((prev) => (prev?.id === id ? null : prev));
      }, 3200);
    },
    []
  );

  // Autonomous Goal Runner Engine State
  const [activeGoal, setActiveGoal] = useState<ActiveGoalSession | null>(null);
  const [showGoalModal, setShowGoalModal] = useState<boolean>(false);
  const [goalCountdown, setGoalCountdown] = useState<number | null>(null);
  const activeGoalRef = useRef<ActiveGoalSession | null>(null);
  activeGoalRef.current = activeGoal;
  const countdownTimerRef = useRef<any>(null);
  const handleGoalTurnFinishedRef = useRef<((g: ActiveGoalSession) => Promise<void>) | null>(null);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  const activeWorkspace = useMemo(() => {
    return workspaces.find((w) => w.active) || workspaces[0] || null;
  }, [workspaces]);

  // 1. Load Workspaces & Thread Metadata from Rust DesktopStateManager
  const refreshWorkspacesAndMeta = useCallback(async () => {
    try {
      const wsList = await tauriInvoke<WorkspaceRootItem[]>("workspace_list");
      if (wsList && wsList.length > 0) {
        setWorkspaces(wsList);
      }
    } catch (e) {
      console.warn("workspace_list failed:", e);
    }

    try {
      const meta = await tauriInvoke<{
        pinnedThreadIds: string[];
        archivedThreads: any[];
        workspaceHints: Record<string, string>;
      }>("threads_meta_get");
      if (meta) {
        setPinnedThreadIds(meta.pinnedThreadIds || []);
        setWorkspaceHints(meta.workspaceHints || {});
      }
    } catch (e) {
      console.warn("threads_meta_get failed:", e);
    }
  }, []);

  // 2. Refresh Git Status & Branches for activeWorkspace
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

    try {
      const branches = await tauriInvoke<string[]>("git_branches", {
        cwd: activeWorkspace.path,
      });
      if (Array.isArray(branches)) {
        setGitBranches(branches);
      }
    } catch {
      setGitBranches([]);
    }
  }, [activeWorkspace?.path]);

  // 3. Refresh Workspace Files, AGENTS.md & Installed Skills
  const refreshWorkspaceContext = useCallback(async () => {
    if (!activeWorkspace?.path) return;

    try {
      const agents = await tauriInvoke<{
        found: boolean;
        path: string | null;
        content: string;
      }>("workspace_agents_md", { cwd: activeWorkspace.path });
      if (agents) setAgentsMdInfo(agents);
    } catch {
      // ignore
    }

    try {
      const entries = await tauriInvoke<DirectoryEntryItem[]>("fs_list_dir", {
        path: activeWorkspace.path,
        showHidden: false,
      });
      if (entries) {
        setWorkspaceFiles(entries.map((e) => e.name || e.path));
      }
    } catch {
      // ignore
    }

    try {
      const hits = await tauriInvoke<WorkspaceFileHit[]>("fs_search_files", {
        cwd: activeWorkspace.path,
        query: null,
        limit: 80,
      });
      if (Array.isArray(hits)) {
        setWorkspaceFileHits(hits);
      }
    } catch {
      // ignore
    }

    try {
      const skillList = await tauriInvoke<SkillInfoItem[]>("skills_list_local", {
        workspaceRoot: activeWorkspace.path,
      });
      if (Array.isArray(skillList)) {
        setSkills(skillList);
      }
    } catch {
      // ignore
    }

    try {
      const scripts = await tauriInvoke<ProjectScriptCommands>("detect_project_scripts", {
        cwd: activeWorkspace.path,
      });
      if (scripts) setProjectScripts(scripts);
    } catch {
      // ignore
    }
  }, [activeWorkspace?.path]);

  // 4. Refresh Threads & Models from codex app-server
  const refreshThreads = useCallback(async () => {
    try {
      const res = await callAppServer<{
        data?: ThreadSummary[];
        threads?: ThreadSummary[];
      }>("thread/list", { limit: 60 });
      const list = res?.data || res?.threads || (Array.isArray(res) ? res : []);
      setThreads(list);
    } catch (e) {
      console.warn("thread/list failed:", e);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const res = await callAppServer<{
        data?: ModelInfo[];
        models?: ModelInfo[];
      }>("model/list", {});
      const list = res?.data || res?.models || (Array.isArray(res) ? res : []);
      if (list.length > 0) {
        setModels(list);
      }
    } catch (e) {
      console.warn("model/list failed:", e);
    }
  }, []);

  const refreshConfigOverview = useCallback(async () => {
    try {
      const overview = await tauriInvoke<CodexConfigOverview>("config_read");
      if (overview) {
        setConfigOverview(overview);
        if (overview.model) setSelectedModelId(overview.model);
        if (overview.modelReasoningEffort) {
          setReasoningEffort(overview.modelReasoningEffort);
        }
        if (overview.temperature !== undefined && overview.temperature !== null) {
          setSessionTemperature(overview.temperature);
        }
        if (overview.topP !== undefined && overview.topP !== null) {
          setSessionTopP(overview.topP);
        }
        if (overview.maxOutputTokens !== undefined && overview.maxOutputTokens !== null) {
          setSessionMaxTokens(overview.maxOutputTokens);
        }
        if (overview.webSearchMode) {
          setSessionWebSearch(overview.webSearchMode as any);
        }
        if (overview.allowNetwork !== undefined && overview.allowNetwork !== null) {
          setSessionAllowNetwork(overview.allowNetwork);
        }
        if (overview.outputVerbosity) {
          setSessionVerbosity(overview.outputVerbosity as any);
        }
        if (overview.instructions) {
          setCustomInstructions(overview.instructions);
        }
      }
    } catch (e) {
      console.warn("config_read failed:", e);
    }
  }, []);

  // Connect & Subscribe to App-Server Events on Mount
  useEffect(() => {
    refreshWorkspacesAndMeta();
    refreshConfigOverview();

    tauriInvoke<any>("desktop_state_get", { key: "desktopPreferences" })
      .then((prefs) => {
        if (prefs && typeof prefs === "object") {
          if (prefs.customPersonaPrompt) setCustomInstructions(prefs.customPersonaPrompt);
          if (prefs.toneStyle) setToneStyle(prefs.toneStyle);
          if (prefs.petVisible !== undefined) setPetVisible(prefs.petVisible);
          if (prefs.selectedPetSpecies) setSelectedPetSpecies(prefs.selectedPetSpecies);
        }
      })
      .catch(() => {});

    // Ensure app-server is connected
    tauriInvoke<AppServerStatus>("app_server_connect")
      .then((st) => {
        setAppServerStatus(st);
        if (st.connected) {
          refreshModels();
          refreshThreads();
        }
      })
      .catch((err) => {
        setAppServerStatus((prev) => ({
          ...prev,
          connecting: false,
          connected: false,
          lastError: String(err),
        }));
      });

    const unlistenStatus = tauriListen<AppServerStatus>(
      "app-server:status",
      (status) => {
        setAppServerStatus(status);
        if (status.connected) {
          refreshModels();
          refreshThreads();
        }
      }
    );

    const unlistenNotification = tauriListen<any>(
      "app-server:notification",
      (payload) => {
        const { method, params } = payload || {};
        if (!method) return;

        if (method === "turn/started") {
          setIsStreaming(true);
          const turnId = params?.turn?.id || params?.turnId || `turn-${Date.now()}`;
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
          playNotificationChime("done");
          const turnId = params?.turn?.id || params?.turnId;
          const duration = params?.turn?.durationMs || params?.turnDurationMs;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId || (!turnId && t.status === "running")
                ? {
                    ...t,
                    status: "completed",
                    completedAt: Date.now(),
                    durationMs: duration,
                  }
                : t
            )
          );
          refreshGitStatus();
          refreshThreads();

          // Autonomous Goal turn completion check
          const currentGoal = activeGoalRef.current;
          if (currentGoal && currentGoal.status === "running") {
            setTimeout(() => {
              handleGoalTurnFinishedRef.current?.(currentGoal);
            }, 150);
          }
        } else if (
          method === "item/agentMessage/delta" ||
          method === "codex/event/agent_message_delta"
        ) {
          const textDelta = params?.delta || params?.text || "";
          if (!textDelta) return;
          setTurns((prev) => {
            const list = [...prev];
            let lastTurn = list[list.length - 1];
            if (!lastTurn) {
              lastTurn = {
                id: `turn-${Date.now()}`,
                status: "running",
                startedAt: Date.now(),
                items: [],
              };
              list.push(lastTurn);
            }
            const items = [...lastTurn.items];
            const lastMsg = items.filter((i) => i.type === "agentMessage").pop();
            if (!lastMsg) {
              items.push({
                id: params?.itemId || `msg-${Date.now()}`,
                type: "agentMessage",
                text: textDelta,
              });
            } else {
              lastMsg.text = (lastMsg.text || "") + textDelta;
            }
            lastTurn.items = items;

            // Live checklist step detection for active goal
            const curGoal = activeGoalRef.current;
            if (curGoal && curGoal.status === "running") {
              const liveSteps = extractChecklistFromText(lastMsg?.text || "");
              if (liveSteps.length > 0) {
                setActiveGoal((prev) => (prev ? { ...prev, steps: liveSteps } : null));
              }
            }

            return list;
          });
        } else if (
          method === "item/reasoning/delta" ||
          method === "item/reasoning/summaryTextDelta"
        ) {
          const thoughtDelta = params?.delta || params?.text || "";
          if (!thoughtDelta) return;
          setTurns((prev) => {
            const list = [...prev];
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const lastThought = items.filter((i) => i.type === "reasoning").pop();
            if (!lastThought) {
              items.push({
                id: params?.itemId || `thought-${Date.now()}`,
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
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const existingIdx = items.findIndex(
              (it) =>
                (itemId && it.id === itemId) || it.type === "commandExecution"
            );
            if (existingIdx >= 0) {
              items[existingIdx] = {
                ...items[existingIdx],
                output: (items[existingIdx].output || "") + outDelta,
              };
            } else {
              items.push({
                id: itemId || `cmd-${Date.now()}`,
                type: "commandExecution",
                command: params?.command || "command",
                output: outDelta,
              });
            }
            lastTurn.items = items;
            return list;
          });
        } else if (method === "item/started" || method === "item/completed") {
          const item = params?.item;
          if (!item) return;
          setTurns((prev) => {
            const list = [...prev];
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const idx = items.findIndex((x) => x.id && x.id === item.id);
            if (idx >= 0) {
              items[idx] = { ...items[idx], ...item };
            } else {
              items.push(item);
            }
            lastTurn.items = items;
            return list;
          });
        }
      }
    );

    const unlistenServerReq = tauriListen<PendingServerRequest>(
      "app-server:server-request",
      (req) => {
        setPendingRequests((prev) => [...prev, req]);
        setInboxItems((prev) => [
          {
            id: `req-${req.id}-${Date.now()}`,
            title: "需要批准安全操作",
            subtitle: req.params?.command
              ? `$ ${req.params.command}`
              : req.method,
            kind: "approval",
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ]);
      }
    );

    return () => {
      unlistenStatus.then((f) => f());
      unlistenNotification.then((f) => f());
      unlistenServerReq.then((f) => f());
    };
  }, [
    refreshWorkspacesAndMeta,
    refreshConfigOverview,
    refreshModels,
    refreshThreads,
    refreshGitStatus,
  ]);

  useEffect(() => {
    refreshGitStatus();
    refreshWorkspaceContext();
  }, [refreshGitStatus, refreshWorkspaceContext]);

  // Global keyboard shortcuts (Ctrl+N new chat, Ctrl+B toggle sidebar, Ctrl+J toggle terminal)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setActiveThreadId(null);
        setTurns([]);
        setActiveRoute("home");
        setTimeout(() => composerTextareaRef.current?.focus(), 50);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setShowTerminal((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setActiveRoute((r) => (r === "settings" ? "home" : "settings"));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowQuickSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Auto-scroll timeline
  useEffect(() => {
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
    }
  }, [turns, isStreaming]);

  // Workspace Actions
  const handleSelectWorkspace = useCallback(async (path: string) => {
    try {
      const updated = await tauriInvoke<WorkspaceRootItem[]>(
        "workspace_set_active",
        { path }
      );
      setWorkspaces(updated);
    } catch (e) {
      console.warn("workspace_set_active failed:", e);
    }
  }, []);

  const handleRemoveWorkspace = useCallback(
    async (path: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const updated = await tauriInvoke<WorkspaceRootItem[]>(
          "workspace_remove",
          { path }
        );
        setWorkspaces(updated);
      } catch (err) {
        console.warn("workspace_remove failed:", err);
      }
    },
    []
  );

  const handlePickNewFolder = useCallback(async () => {
    try {
      const picked = await tauriInvoke<string | null>("pick_folder_dialog");
      if (picked) {
        const label =
          picked.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || picked;
        const updated = await tauriInvoke<WorkspaceRootItem[]>("workspace_add", {
          path: picked,
          label,
          setActive: true,
        });
        setWorkspaces(updated);
      }
    } catch (e) {
      console.warn("pick_folder_dialog failed:", e);
    }
  }, []);

  // Git Branch Actions from Composer
  const handleSwitchBranch = useCallback(
    async (branch: string) => {
      if (!activeWorkspace?.path) return;
      try {
        const status = await tauriInvoke<GitStatusInfo>("git_branch_checkout", {
          cwd: activeWorkspace.path,
          branch,
        });
        setGitStatus(status);
      } catch (e) {
        console.warn("git_branch_checkout failed:", e);
      }
    },
    [activeWorkspace?.path]
  );

  const handleCreateBranch = useCallback(
    async (branch: string) => {
      if (!activeWorkspace?.path) return;
      try {
        const status = await tauriInvoke<GitStatusInfo>("git_branch_create", {
          cwd: activeWorkspace.path,
          branch,
          checkout: true,
        });
        setGitStatus(status);
        refreshGitStatus();
      } catch (e) {
        console.warn("git_branch_create failed:", e);
      }
    },
    [activeWorkspace?.path, refreshGitStatus]
  );

  // Attach files
  const handleAttachFiles = useCallback(async () => {
    try {
      const files = await tauriInvoke<string[]>("pick_files_dialog");
      if (Array.isArray(files) && files.length > 0) {
        const additions: AttachedFileItem[] = files.map((p) => ({
          id: `${p}-${Date.now()}`,
          name: p.split(/[/\\]/).pop() || p,
          path: p,
          kind: /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(p) ? "image" : "file",
        }));
        setAttachedFiles((prev) => [...prev, ...additions]);
      }
    } catch (e) {
      console.warn("pick_files_dialog failed:", e);
    }
  }, []);

  // Thread Navigation & Lifecycle
  const startNewThread = useCallback(
    (workspacePath?: string) => {
      if (workspacePath) {
        handleSelectWorkspace(workspacePath);
      }
      setActiveThreadId(null);
      setTurns([]);
      setActiveRoute("home");
      setTimeout(() => composerTextareaRef.current?.focus(), 50);
    },
    [handleSelectWorkspace]
  );

  const selectThread = useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    setActiveRoute("thread");
    try {
      const res = await callAppServer<any>("thread/read", {
        threadId,
        includeTurns: true,
      });
      const loadedTurns = normalizeTurnsFromThread(res);
      if (loadedTurns.length > 0) {
        setTurns(loadedTurns);
      } else {
        const resumeRes = await callAppServer<any>("thread/resume", {
          threadId,
        });
        setTurns(normalizeTurnsFromThread(resumeRes));
      }
    } catch (e) {
      console.warn("Failed to read/resume thread:", e);
    }
  }, []);

  // Send or Steer Message
  const handleSendMessage = useCallback(async (overrideText?: string) => {
    const rawText = (typeof overrideText === "string" ? overrideText : promptInput).trim();
    if (!rawText && attachedFiles.length === 0) return;

    // Direct /goal command detection
    if (rawText === "/goal") {
      setShowGoalModal(true);
      setPromptInput("");
      return;
    }

    let effectiveRawText = rawText;
    if (rawText.startsWith("/goal ")) {
      const goalObj = rawText.slice(6).trim();
      if (goalObj) {
        const newGoal: ActiveGoalSession = {
          id: `goal-${Date.now()}`,
          threadId: activeThreadId || "",
          objective: goalObj,
          status: "running",
          currentTurn: 1,
          maxTurns: 10,
          autoVerifyCommand: "npm test",
          verificationStatus: "idle",
          steps: [],
          autoContinue: true,
          countdownRemaining: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setActiveGoal(newGoal);

        effectiveRawText = `[🎯 /goal 自主目标模式启动]
目标：${goalObj}
最大自主轮次：10 轮
验证命令：npm test

执行指引：
1. 请先在回复开头梳理任务分解清单，以 Markdown 任务列表格式（- [ ] 步骤说明）列出所有需完成的关键步骤。
2. 逐一自主推进并实施这些步骤，每完成一步请将其标记为 - [x]。
3. 检查代码改动并确保实现正确。
4. 当全部目标步骤完成且验证无误时，请在最终回复末尾明确输出 [GOAL_COMPLETED]。`;
      }
    }

    const attachmentContext =
      attachedFiles.length > 0
        ? attachedFiles.map((f) => `[附加文件: ${f.path}]`).join("\n") + "\n"
        : "";
    const planPrefix = planMode
      ? "[Plan Mode: 请先分析并输出分步实施计划，不要直接修改文件]\n"
      : "";
    const text = `${planPrefix}${attachmentContext}${effectiveRawText}`.trim();

    if (!overrideText) {
      setPromptInput("");
      setAttachedFiles([]);
    }
    setActiveRoute("thread");

    // If currently streaming and we have an activeThreadId, use turn/steer
    if (isStreaming && activeThreadId) {
      try {
        await callAppServer("turn/steer", {
          threadId: activeThreadId,
          input: [{ type: "text", text }],
        });
        return;
      } catch {
        // Fallback to normal flow
      }
    }

    const userTurn: TurnData = {
      id: `user-${Date.now()}`,
      status: "completed",
      startedAt: Date.now(),
      items: [{ id: `u-${Date.now()}`, type: "userMessage", text: effectiveRawText || text }],
    };
    setTurns((prev) => [...prev, userTurn]);
    setIsStreaming(true);

    try {
      let targetCwd = activeWorkspace?.path || "";
      if (useWorktree && targetCwd) {
        try {
          const wt = await tauriInvoke<{ path: string }>("git_worktree_create", {
            sourceCwd: targetCwd,
            startingMode: "HEAD",
            branchName: null,
            ownerThreadId: activeThreadId,
          });
          if (wt?.path) targetCwd = wt.path;
        } catch (wtErr) {
          console.warn("Worktree creation skipped:", wtErr);
        }
      }

      const sandboxMode =
        permissionMode === "full"
          ? "danger-full-access"
          : "workspace-write";
      const approvalPolicy =
        permissionMode === "ask"
          ? "on-request"
          : permissionMode === "full"
          ? "never"
          : "on-failure";

      let currentThreadId = activeThreadId;
      if (!currentThreadId) {
        const startRes = await callAppServer<any>("thread/start", {
          cwd: targetCwd || undefined,
          model: selectedModelId,
          approvalPolicy,
          sandbox: sandboxMode,
        });
        currentThreadId =
          startRes?.threadId ||
          startRes?.thread?.id ||
          startRes?.conversationId ||
          `thread-${Date.now()}`;
        setActiveThreadId(currentThreadId);
        if (currentThreadId && targetCwd) {
          setWorkspaceHints((prev) => ({ ...prev, [currentThreadId!]: targetCwd }));
        }
        refreshThreads();
      }

      await callAppServer("turn/start", {
        threadId: currentThreadId,
        input: [{ type: "text", text }],
        model: selectedModelId,
        effort: reasoningEffort === "extra_high" ? "xhigh" : reasoningEffort,
        temperature: sessionTemperature,
        topP: sessionTopP,
        maxTokens: sessionMaxTokens,
        webSearch: sessionWebSearch,
        allowNetwork: sessionAllowNetwork,
        outputVerbosity: sessionVerbosity,
        approvalPolicy,
        serviceTier: fastMode ? "priority" : undefined,
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
  }, [
    promptInput,
    attachedFiles,
    planMode,
    isStreaming,
    activeThreadId,
    activeWorkspace?.path,
    useWorktree,
    permissionMode,
    selectedModelId,
    reasoningEffort,
    sessionTemperature,
    sessionTopP,
    sessionMaxTokens,
    sessionWebSearch,
    sessionAllowNetwork,
    sessionVerbosity,
    fastMode,
    refreshThreads,
  ]);

  // Autonomous Goal Engine Methods
  const runGoalVerification = useCallback(
    async (goalToVerify?: ActiveGoalSession) => {
      const g = goalToVerify || activeGoalRef.current;
      if (!g || !g.autoVerifyCommand) return true;
      const cwd = activeWorkspace?.path || "";
      if (!cwd) return true;

      setActiveGoal((prev) =>
        prev ? { ...prev, verificationStatus: "running" } : null
      );

      try {
        const res = await tauriInvoke<ShellExecResult>("exec_shell_command", {
          cwd,
          command: g.autoVerifyCommand,
        });

        const passed = res.exitCode === 0 && res.success;
        const fullOutput = `[Exit Code ${res.exitCode}]\n--- STDOUT ---\n${res.stdout || "(空)"}\n--- STDERR ---\n${res.stderr || "(空)"}`;

        setActiveGoal((prev) =>
          prev
            ? {
                ...prev,
                verificationStatus: passed ? "passed" : "failed",
                verificationOutput: fullOutput,
              }
            : null
        );

        return passed;
      } catch (err: any) {
        setActiveGoal((prev) =>
          prev
            ? {
                ...prev,
                verificationStatus: "failed",
                verificationOutput: `执行验证命令失败: ${err?.message || err}`,
              }
            : null
        );
        return false;
      }
    },
    [activeWorkspace?.path]
  );

  const triggerNextGoalTurn = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setGoalCountdown(null);

    const g = activeGoalRef.current;
    if (!g || g.status !== "running") return;

    const nextTurnNum = g.currentTurn + 1;
    setActiveGoal((prev) => (prev ? { ...prev, currentTurn: nextTurnNum } : null));

    const uncompletedSteps = g.steps.filter((s) => s.status !== "completed");
    const stepsReminder =
      uncompletedSteps.length > 0
        ? `\n剩余待办清单：\n${uncompletedSteps.map((s) => `- [ ] ${s.title}`).join("\n")}`
        : "";
    const verifyReminder =
      g.verificationStatus === "failed"
        ? `\n⚠️ 上一轮运行验证命令 (${g.autoVerifyCommand}) 未通过，请仔细查看报错并修复。`
        : "";

    const nextPrompt = `[Goal 自主推进 轮次 ${nextTurnNum}/${g.maxTurns}]
当前总目标：${g.objective}
${verifyReminder}
${stepsReminder}
请继续分析并执行改动。每完成一项请将其标记为 - [x]。所有步骤全部完成且验证通过后，请在回复末尾输出 [GOAL_COMPLETED]。`;

    handleSendMessage(nextPrompt);
  }, [handleSendMessage]);

  const handleGoalTurnFinished = useCallback(
    async (currentGoal: ActiveGoalSession) => {
      // Find latest assistant text
      const lastAssistantTurn = [...turns]
        .reverse()
        .find((t) => t.items.some((i) => i.type === "agentMessage"));
      const lastText = lastAssistantTurn
        ? lastAssistantTurn.items.map(extractTextFromItem).join("\n")
        : "";

      // Parse checklist steps from the latest assistant message
      const parsedSteps = extractChecklistFromText(lastText);
      if (parsedSteps.length > 0) {
        setActiveGoal((prev) => (prev ? { ...prev, steps: parsedSteps } : null));
      }

      const hasGoalCompletedToken = lastText.includes("[GOAL_COMPLETED]");
      const allStepsDone =
        parsedSteps.length > 0 && parsedSteps.every((s) => s.status === "completed");

      // Run verification if configured
      let verifyPassed = true;
      if (currentGoal.autoVerifyCommand) {
        verifyPassed = await runGoalVerification(currentGoal);
      }

      if ((hasGoalCompletedToken || allStepsDone) && verifyPassed) {
        setActiveGoal((prev) => (prev ? { ...prev, status: "completed" } : null));
        playNotificationChime("done");
        setInboxItems((prev) => [
          {
            id: `goal-done-${Date.now()}`,
            title: "🎯 目标已成功达成！",
            subtitle: currentGoal.objective,
            kind: "goal",
            threadId: activeThreadId || undefined,
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ]);
      } else if (currentGoal.currentTurn >= currentGoal.maxTurns) {
        setActiveGoal((prev) => (prev ? { ...prev, status: "paused" } : null));
        setInboxItems((prev) => [
          {
            id: `goal-max-${Date.now()}`,
            title: "🎯 目标已达最大轮次限制 (已暂停)",
            subtitle: `已执行 ${currentGoal.maxTurns} 轮: ${currentGoal.objective}`,
            kind: "goal",
            threadId: activeThreadId || undefined,
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ]);
      } else if (currentGoal.autoContinue) {
        let count = 3;
        setGoalCountdown(count);
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
          count -= 1;
          if (count <= 0) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
            setGoalCountdown(null);
            triggerNextGoalTurn();
          } else {
            setGoalCountdown(count);
          }
        }, 1000);
      }
    },
    [turns, runGoalVerification, activeThreadId, triggerNextGoalTurn]
  );

  useEffect(() => {
    handleGoalTurnFinishedRef.current = handleGoalTurnFinished;
  }, [handleGoalTurnFinished]);

  const handleLaunchGoal = useCallback(
    async (config: GoalSetupConfig) => {
      const newGoal: ActiveGoalSession = {
        id: `goal-${Date.now()}`,
        threadId: activeThreadId || "",
        objective: config.objective,
        status: "running",
        currentTurn: 1,
        maxTurns: config.maxTurns,
        autoVerifyCommand: config.autoVerifyCommand,
        verificationStatus: "idle",
        steps: [],
        autoContinue: config.autoContinue,
        countdownRemaining: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setActiveGoal(newGoal);

      if (config.useWorktree) {
        setUseWorktree(true);
      }

      const formattedPrompt = `[🎯 /goal 自主目标模式启动]
目标：${config.objective}
最大自主轮次：${config.maxTurns} 轮
${config.autoVerifyCommand ? `验证命令：${config.autoVerifyCommand}` : "验证机制：模型自主分析与标记"}

执行指引：
1. 请先在回复开头梳理任务分解清单，以 Markdown 任务列表格式（- [ ] 步骤说明）列出所有需完成的关键步骤。
2. 自主推进并实施这些步骤，每完成一步请将其标记为 - [x]。
3. 检查代码改动并确保实现正确。
4. 当全部目标步骤完成且验证无误时，请在最终回复末尾明确输出 [GOAL_COMPLETED]。`;

      await handleSendMessage(formattedPrompt);
    },
    [activeThreadId, handleSendMessage]
  );

  const handleInterruptTurn = useCallback(async () => {
    if (!activeThreadId) {
      setIsStreaming(false);
      return;
    }
    try {
      await callAppServer("turn/interrupt", { threadId: activeThreadId });
    } catch {
      // ignore
    } finally {
      setIsStreaming(false);
    }
  }, [activeThreadId]);

  const handleSteerTurn = useCallback(
    async (text: string) => {
      if (!activeThreadId || !text.trim()) return;
      try {
        await callAppServer("turn/steer", {
          threadId: activeThreadId,
          text: text.trim(),
        });
        setTurns((prev) => [
          ...prev,
          {
            id: `steer-${Date.now()}`,
            items: [
              {
                id: `st-${Date.now()}`,
                type: "userMessage",
                text: `[立即引导 Steer]: ${text.trim()}`,
              },
            ],
          },
        ]);
      } catch (e) {
        console.warn("turn/steer failed, falling back to queue:", e);
        setFollowupQueue((prev) => [
          ...prev,
          {
            id: `q-${Date.now()}`,
            text: text.trim(),
            mode: "queue",
            createdAt: Date.now(),
          },
        ]);
      }
    },
    [activeThreadId]
  );

  const handleRespondUserInput = useCallback(
    async (requestId: any, responseValue: any) => {
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      try {
        await tauriInvoke("app_server_respond", {
          id: requestId,
          result: responseValue,
          error: null,
        });
      } catch (e) {
        console.error("Failed to respond to requestUserInput:", e);
      }
    },
    []
  );

  const handleApprovalDecision = useCallback(
    async (
      requestId: any,
      decision: "accept" | "acceptForSession" | "decline"
    ) => {
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

  // Auto-drain next queued follow-up when turn finishes
  useEffect(() => {
    if (!isStreaming && followupQueue.length > 0 && activeThreadId) {
      const next = followupQueue[0];
      setFollowupQueue((prev) => prev.slice(1));
      handleSendMessage(next.text);
    }
  }, [isStreaming, followupQueue, activeThreadId]);

  // Thread Pin, Rename, Archive
  const handleTogglePinThread = useCallback(
    async (threadId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const nextPinned = !pinnedThreadIds.includes(threadId);
      try {
        const updated = await tauriInvoke<string[]>("thread_toggle_pin", {
          threadId,
          pinned: nextPinned,
        });
        setPinnedThreadIds(updated);
      } catch (err) {
        console.warn("thread_toggle_pin failed:", err);
      }
    },
    [pinnedThreadIds]
  );

  const handleRenameThread = useCallback(
    async (threadId: string, newName: string) => {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, name: newName } : t))
      );
      try {
        await callAppServer("thread/name/set", { threadId, name: newName });
      } catch {
        // ignore if unsupported
      }
    },
    []
  );

  const handleArchiveThread = useCallback(
    async (thread: ThreadSummary, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await tauriInvoke("thread_archive_toggle", {
          thread,
          archive: true,
        });
        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
        if (activeThreadId === thread.id) {
          startNewThread();
        }
      } catch (err) {
        console.warn("thread_archive_toggle failed:", err);
      }
    },
    [activeThreadId, startNewThread]
  );

  const handleDeleteThread = useCallback(
    async (thread: ThreadSummary, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmDelete = window.confirm(
        `确定要彻底删除聊天 "${thread.name || thread.preview || thread.id}" 吗？此操作无法撤销。`
      );
      if (!confirmDelete) return;
      try {
        await tauriInvoke("thread_delete", {
          threadId: thread.id,
        });
        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
        setPinnedThreadIds((prev) => prev.filter((id) => id !== thread.id));
        showAppToast("✓ 聊天已彻底删除", "success");
        if (activeThreadId === thread.id) {
          startNewThread();
        }
      } catch (err) {
        console.warn("thread_delete failed:", err);
        showAppToast("删除失败: " + String(err), "error");
      }
    },
    [activeThreadId, startNewThread, showAppToast]
  );

  const handleRevealPath = useCallback(
    async (path: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      try {
        await tauriInvoke("reveal_path_in_explorer", { path });
        showAppToast("✓ 已在系统文件管理器中打开文件夹", "info");
      } catch (err) {
        showAppToast(`打开文件夹失败: ${String(err)}`, "error");
      }
    },
    [showAppToast]
  );

  const activeThreadObj = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const handleExportMarkdown = useCallback(() => {
    if (turns.length === 0) {
      showAppToast("当前会话暂无消息内容可导出", "info");
      return;
    }
    const threadTitle = activeThreadObj?.name || activeThreadObj?.preview || "Codex-Conversation";
    let md = `# ${threadTitle}\n\n`;
    md += `- **会话 ID**: \`${activeThreadId || "local"}\`\n`;
    md += `- **模型**: \`${selectedModelId}\`\n`;
    md += `- **导出时间**: ${new Date().toLocaleString()}\n`;
    if (activeWorkspace?.path) {
      md += `- **工作区**: \`${activeWorkspace.path}\`\n`;
    }
    md += `\n---\n\n`;

    turns.forEach((turn, idx) => {
      turn.items.forEach((item) => {
        if (item.type === "userMessage") {
          md += `### 👤 用户 (Turn ${idx + 1})\n\n${item.text || ""}\n\n`;
        } else if (item.type === "agentMessage") {
          md += `### 🤖 Codex (Turn ${idx + 1})\n\n${item.text || ""}\n\n`;
        } else if (item.type === "thought") {
          md += `<details><summary>💭 思考过程</summary>\n\n${item.text || ""}\n\n</details>\n\n`;
        } else if (item.type === "command") {
          const cmdStr = Array.isArray(item.command) ? item.command.join(" ") : item.command || "";
          md += `> 💻 **执行命令**: \`${cmdStr}\`\n`;
          if (item.stdout || item.aggregatedOutput) {
            md += `\`\`\`bash\n${item.stdout || item.aggregatedOutput}\n\`\`\`\n\n`;
          }
        } else if (item.type === "fileChange") {
          md += `> 📝 **修改文件**: \`${item.cwd || ""}\`\n\n`;
        }
      });
    });

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${threadTitle.replace(/[/\\?%*:|"<>]/g, "_")}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportPopover(false);
    showAppToast("✓ 对话已成功导出为 Markdown 文件", "success");
  }, [turns, activeThreadObj, activeThreadId, selectedModelId, activeWorkspace, showAppToast]);

  const handleExportJson = useCallback(() => {
    if (turns.length === 0) {
      showAppToast("当前会话暂无消息内容可导出", "info");
      return;
    }
    const threadTitle = activeThreadObj?.name || activeThreadObj?.preview || "Codex-Conversation";
    const data = {
      threadId: activeThreadId,
      title: threadTitle,
      model: selectedModelId,
      reasoningEffort,
      workspace: activeWorkspace?.path,
      exportedAt: new Date().toISOString(),
      turns,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${threadTitle.replace(/[/\\?%*:|"<>]/g, "_")}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportPopover(false);
    showAppToast("✓ 对话已成功导出为 JSON 文件", "success");
  }, [turns, activeThreadObj, activeThreadId, selectedModelId, reasoningEffort, activeWorkspace, showAppToast]);

  const handleCopyAllConversation = useCallback(() => {
    if (turns.length === 0) {
      showAppToast("当前会话暂无消息内容", "info");
      return;
    }
    let fullText = "";
    turns.forEach((turn) => {
      turn.items.forEach((item) => {
        if (item.type === "userMessage") {
          fullText += `[用户]:\n${item.text || ""}\n\n`;
        } else if (item.type === "agentMessage") {
          fullText += `[Codex]:\n${item.text || ""}\n\n`;
        } else if (item.type === "command") {
          const cmdStr = Array.isArray(item.command) ? item.command.join(" ") : item.command || "";
          fullText += `[执行命令]: ${cmdStr}\n\n`;
        }
      });
    });
    navigator.clipboard.writeText(fullText.trim()).then(() => {
      setShowExportPopover(false);
      showAppToast("✓ 已复制全部对话内容到剪贴板", "success");
    }).catch((err) => {
      showAppToast("复制失败: " + String(err), "error");
    });
  }, [turns, showAppToast]);

  const handleClearCurrentThread = useCallback(() => {
    if (turns.length === 0) return;
    const ok = window.confirm("确定要清空当前会话的消息内容并重置为新对话吗？");
    if (!ok) return;
    setShowExportPopover(false);
    startNewThread();
    showAppToast("✓ 已重置并开启全新会话", "info");
  }, [turns.length, startNewThread, showAppToast]);

  const handleSlashAction = useCallback((action: string) => {
    if (action === "open_goal_dialog") {
      setShowGoalModal(true);
    } else if (action === "toggle_plan") {
      setPlanMode((v) => !v);
    } else if (action === "toggle_fast") {
      setFastMode((v) => !v);
    } else if (action === "toggle_worktree") {
      setUseWorktree((v) => !v);
    } else if (action === "open_terminal") {
      setShowTerminal(true);
    } else if (action === "open_diff") {
      setShowRightDrawer(true);
    }
  }, []);

  const unreadInboxCount = useMemo(
    () => inboxItems.filter((i) => !i.read).length,
    [inboxItems]
  );

  const projectName =
    activeWorkspace?.label ||
    activeWorkspace?.path?.split(/[/\\]/).pop() ||
    "codex-app-offline";

  return (
    <div className="codex-app-layout">
      {/* ── 1. Far-Left Vertical Icon Navigation Rail ── */}
      <NavigationRail
        activeRoute={activeRoute}
        sidebarCollapsed={sidebarCollapsed}
        unreadInboxCount={unreadInboxCount}
        appServerConnected={appServerStatus.connected}
        petVisible={petVisible}
        onTogglePet={() => setPetVisible((v) => !v)}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onNavigate={(route) => setActiveRoute(route)}
      />

      {/* ── 2. Official Three-Section Codex Sidebar ── */}
      <CodexSidebar
        collapsed={sidebarCollapsed}
        activeRoute={activeRoute}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        threads={threads}
        pinnedThreadIds={pinnedThreadIds}
        workspaceHints={workspaceHints}
        activeThreadId={activeThreadId}
        unreadInboxCount={unreadInboxCount}
        hasAgentsMd={agentsMdInfo.found}
        onNavigate={(route) => setActiveRoute(route)}
        onStartNewChat={startNewThread}
        onSelectWorkspace={handleSelectWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onPickNewFolder={handlePickNewFolder}
        onSelectThread={selectThread}
        onTogglePinThread={handleTogglePinThread}
        onArchiveThread={handleArchiveThread}
        onDeleteThread={handleDeleteThread}
        onRenameThread={handleRenameThread}
        onRevealPath={handleRevealPath}
        onOpenAgentsMd={() => setShowAgentsMdModal(true)}
        onOpenQuickSearch={() => setShowQuickSearch(true)}
      />

      {/* ── 3. Main Workspace Area ── */}
      <main className="codex-main-area">
        {/* Top Window / Thread Chrome Header */}
        <header className="main-top-navbar">
          <div className="top-nav-left">
            {activeRoute === "thread" && turns.length > 0 ? (
              <>
                {editingThreadTitle ? (
                  <input
                    className="thread-header-rename-input"
                    value={threadTitleInput}
                    onChange={(e) => setThreadTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && threadTitleInput.trim() && activeThreadId) {
                        handleRenameThread(activeThreadId, threadTitleInput.trim());
                        setEditingThreadTitle(false);
                      }
                      if (e.key === "Escape") setEditingThreadTitle(false);
                    }}
                    onBlur={() => {
                      if (threadTitleInput.trim() && activeThreadId) {
                        handleRenameThread(activeThreadId, threadTitleInput.trim());
                      }
                      setEditingThreadTitle(false);
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="thread-header-title clickable"
                    onClick={() => {
                      setThreadTitleInput(
                        activeThreadObj?.name ||
                          activeThreadObj?.preview ||
                          "本地聊天"
                      );
                      setEditingThreadTitle(true);
                    }}
                    title="点击重命名当前会话"
                  >
                    {activeThreadObj?.name ||
                      activeThreadObj?.preview ||
                      "本地聊天"}
                    <span className="thread-title-edit-hint"> ✏️</span>
                  </span>
                )}
                <div
                  className="project-branch-pill clickable"
                  onClick={() => setShowGitMenu((v) => !v)}
                  title="点击展开 Git 快捷操作菜单"
                  style={{ position: "relative" }}
                >
                  <BranchIcon size={13} />
                  <span>{gitStatus?.branch || "main"} ⌄</span>

                  {showGitMenu && (
                    <div
                      className="git-actions-menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="git-menu-item"
                        onClick={() => {
                          setShowRightDrawer(true);
                          setShowGitMenu(false);
                        }}
                      >
                        <span>📝 查看变更与提交 (Commit)</span>
                      </button>
                      <button
                        type="button"
                        className="git-menu-item"
                        onClick={async () => {
                          try {
                            await tauriInvoke("git_push_changes", {
                              cwd: activeWorkspace?.path,
                              forceWithLease: false,
                            });
                            refreshGitStatus();
                            showAppToast("✓ 已成功推送到远程分支", "success");
                          } catch (e) {
                            showAppToast(`推送失败: ${String(e)}`, "error");
                          }
                          setShowGitMenu(false);
                        }}
                      >
                        <span>推送更改 (git push ↑)</span>
                      </button>
                      <button
                        type="button"
                        className="git-menu-item"
                        onClick={() => {
                          const bName = prompt("请输入新分支名称:");
                          if (bName?.trim()) {
                            handleCreateBranch(bName.trim());
                          }
                          setShowGitMenu(false);
                        }}
                      >
                        <span>🌿 创建并检出新分支</span>
                      </button>
                    </div>
                  )}
                </div>

                {useWorktree && (
                  <div
                    className="project-branch-pill"
                    style={{
                      color: "var(--accent-blue)",
                      background: "rgba(58,131,247,0.12)",
                    }}
                  >
                    <WorktreeIcon size={13} />
                    <span>工作树隔离</span>
                  </div>
                )}
              </>
            ) : activeRoute !== "home" && activeRoute !== "thread" ? (
              <button
                type="button"
                className="back-to-app-pill"
                onClick={() =>
                  setActiveRoute(turns.length > 0 ? "thread" : "home")
                }
              >
                ← 返回聊天
              </button>
            ) : null}
          </div>

          {/* Top Right Panel Toggle Icons & Environment Actions */}
          <div className="top-nav-right">
            {activeRoute === "thread" && turns.length > 0 && (
              <>
                <button
                  type="button"
                  className="window-chrome-icon-btn with-label"
                  onClick={() => {
                    setShowTerminal(true);
                    setPendingTermCommand({
                      id: Date.now(),
                      command: projectScripts.runCommand,
                    });
                  }}
                  title={`在终端运行启动服务 (${projectScripts.runCommand})`}
                >
                  <PlayIcon size={11} />
                  <span>运行</span>
                </button>

                <button
                  type="button"
                  className="window-chrome-icon-btn with-label"
                  onClick={() => {
                    setShowTerminal(true);
                    setPendingTermCommand({
                      id: Date.now(),
                      command: projectScripts.testCommand,
                    });
                  }}
                  title={`在终端运行单元测试套件 (${projectScripts.testCommand})`}
                >
                  <span>🧪 测试</span>
                </button>

                <button
                  type="button"
                  className="window-chrome-icon-btn with-label"
                  onClick={() => {
                    setShowTerminal(true);
                    setPendingTermCommand({
                      id: Date.now(),
                      command: projectScripts.buildCommand,
                    });
                  }}
                  title={`在终端运行构建编译 (${projectScripts.buildCommand})`}
                >
                  <span>🔨 构建</span>
                </button>

                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="window-chrome-icon-btn with-label"
                    onClick={() => setShowUsagePopover((v) => !v)}
                    title="查看当前会话上下文用量统计"
                  >
                    <span>📊 用量</span>
                  </button>

                  {showUsagePopover && (
                    <div
                      className="usage-popover-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="usage-popover-header">
                        <strong>会话用量与上下文</strong>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setShowUsagePopover(false)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="usage-stat-row">
                        <span>模型:</span>
                        <code>{selectedModelId}</code>
                      </div>
                      <div className="usage-stat-row">
                        <span>推理级别:</span>
                        <span>{reasoningEffort}</span>
                      </div>
                      <div className="usage-stat-row">
                        <span>对话轮次:</span>
                        <span>{turns.length} 轮 (Turns)</span>
                      </div>
                      <div className="usage-stat-row">
                        <span>沙盒环境:</span>
                        <span>{useWorktree ? "Worktree 隔离" : "工作区读写"}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="window-chrome-icon-btn with-label"
                    onClick={() => {
                      setShowSessionParamsPopover((v) => !v);
                      setShowUsagePopover(false);
                    }}
                    title="即时微调当前会话超参数 (Temperature, Tokens, WebSearch)"
                  >
                    <span>⚙️ 参数</span>
                  </button>

                  {showSessionParamsPopover && (
                    <div
                      className="session-params-popover-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="session-params-popover-header">
                        <strong>当前会话超参数调优</strong>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setShowSessionParamsPopover(false)}
                        >
                          ✕
                        </button>
                      </div>

                      <div className="session-param-control">
                        <div className="session-param-control-label">
                          <span>采样温度 (Temperature)</span>
                          <span className="mono-badge">{sessionTemperature.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.05"
                          value={sessionTemperature}
                          onChange={(e) => setSessionTemperature(parseFloat(e.target.value))}
                        />
                      </div>

                      <div className="session-param-control">
                        <div className="session-param-control-label">
                          <span>核采样 (Top-P)</span>
                          <span className="mono-badge">{sessionTopP.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="1.0"
                          step="0.01"
                          value={sessionTopP}
                          onChange={(e) => setSessionTopP(parseFloat(e.target.value))}
                        />
                      </div>

                      <div className="session-param-control">
                        <div className="session-param-control-label">
                          <span>单轮最大输出 Tokens</span>
                          <span className="mono-badge">{sessionMaxTokens}</span>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[4096, 8192, 16384, 32768].map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`tag-filter-pill ${sessionMaxTokens === t ? "active" : ""}`}
                              onClick={() => setSessionMaxTokens(t)}
                              style={{ padding: "2px 8px", fontSize: 11 }}
                            >
                              {t >= 1024 ? `${t / 1024}k` : t}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="session-param-control">
                        <div className="session-param-control-label">
                          <span>联网搜索模式</span>
                        </div>
                        <select
                          value={sessionWebSearch}
                          onChange={(e) => setSessionWebSearch(e.target.value as any)}
                          style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6 }}
                        >
                          <option value="cached">cached (本地缓存/优先隐私)</option>
                          <option value="live">live (实时动态联网搜索)</option>
                          <option value="disabled">disabled (离线断网)</option>
                        </select>
                      </div>

                      <div className="session-param-control">
                        <label className="checkbox-inline" style={{ fontSize: 11.5 }}>
                          <input
                            type="checkbox"
                            checked={sessionAllowNetwork}
                            onChange={(e) => setSessionAllowNetwork(e.target.checked)}
                          />
                          <span>允许命令与工具访问外部网络</span>
                        </label>
                      </div>

                      <div className="session-params-footer">
                        <button
                          type="button"
                          className="session-params-footer-link"
                          onClick={() => {
                            setShowSessionParamsPopover(false);
                            setSettingsInitialSection("agent");
                            setActiveRoute("settings");
                          }}
                        >
                          前往完整设置中心配置默认超参数 →
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="window-chrome-icon-btn with-label"
                    onClick={() => {
                      setShowExportPopover((v) => !v);
                      setShowUsagePopover(false);
                      setShowSessionParamsPopover(false);
                    }}
                    title="会话导出与快捷操作 (Markdown, JSON, 复制, 重置)"
                  >
                    <span>📤 导出</span>
                  </button>

                  {showExportPopover && (
                    <div
                      className="usage-popover-card"
                      style={{ minWidth: 230, right: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="usage-popover-header">
                        <strong>会话导出与操作</strong>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setShowExportPopover(false)}
                        >
                          ✕
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        <button
                          type="button"
                          className="git-menu-item"
                          onClick={handleExportMarkdown}
                          style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6 }}
                        >
                          <span>📄 导出为 Markdown (.md)</span>
                        </button>
                        <button
                          type="button"
                          className="git-menu-item"
                          onClick={handleExportJson}
                          style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6 }}
                        >
                          <span>🗂️ 导出为 JSON (.json)</span>
                        </button>
                        <button
                          type="button"
                          className="git-menu-item"
                          onClick={handleCopyAllConversation}
                          style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6 }}
                        >
                          <span>📋 复制全部对话内容</span>
                        </button>
                        <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)", margin: "4px 0" }} />
                        <button
                          type="button"
                          className="git-menu-item"
                          onClick={handleClearCurrentThread}
                          style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6, color: "#ef4444" }}
                        >
                          <span>🧹 清空并重置当前对话</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              className={`window-chrome-icon-btn ${showTerminal ? "active" : ""}`}
              onClick={() => setShowTerminal((v) => !v)}
              title="切换底部终端面板 (Ctrl+J)"
            >
              <BottomPanelIcon size={16} />
            </button>

            <button
              type="button"
              className={`window-chrome-icon-btn ${
                showRightDrawer ? "active" : ""
              }`}
              onClick={() => setShowRightDrawer((v) => !v)}
              title="切换右侧工作台与变更面板"
            >
              <RightPanelIcon size={16} />
              {(gitStatus?.filesChanged || 0) > 0 && (
                <span className="diff-stats-badge">
                  <span className="diff-plus">+{gitStatus?.additions || 0}</span>{" "}
                  <span className="diff-minus">-{gitStatus?.deletions || 0}</span>
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Persistent Autonomous Goal Banner */}
        {activeGoal && (activeRoute === "thread" || activeRoute === "home") && (
          <GoalProgressBanner
            goal={activeGoal}
            isStreaming={isStreaming}
            countdown={goalCountdown}
            onPause={() => {
              if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
              }
              setGoalCountdown(null);
              setActiveGoal((prev) => (prev ? { ...prev, status: "paused" } : null));
            }}
            onResume={() => {
              setActiveGoal((prev) => (prev ? { ...prev, status: "running" } : null));
              triggerNextGoalTurn();
            }}
            onAbort={() => {
              if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
              }
              setGoalCountdown(null);
              setActiveGoal((prev) => (prev ? { ...prev, status: "aborted" } : null));
            }}
            onTriggerNextNow={triggerNextGoalTurn}
            onRunVerification={() => runGoalVerification()}
            onToggleStep={(stepId) => {
              setActiveGoal((prev) => {
                if (!prev) return null;
                return {
                  ...prev,
                  steps: prev.steps.map((s) =>
                    s.id === stepId
                      ? {
                          ...s,
                          status: s.status === "completed" ? "pending" : "completed",
                        }
                      : s
                  ),
                };
              });
            }}
            onAddStep={(title) => {
              setActiveGoal((prev) => {
                if (!prev) return null;
                return {
                  ...prev,
                  steps: [
                    ...prev.steps,
                    { id: `step-${Date.now()}`, title, status: "pending" },
                  ],
                };
              });
            }}
          />
        )}

        {/* ── Route Dispatcher ── */}
        {activeRoute === "projects" ? (
          <ProjectsIndexView
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            threads={threads}
            workspaceHints={workspaceHints}
            onSelectWorkspace={handleSelectWorkspace}
            onStartNewChatInProject={(path) => startNewThread(path)}
            onSelectThread={selectThread}
            onPickNewFolder={handlePickNewFolder}
            onRemoveWorkspace={handleRemoveWorkspace}
            onRevealPath={handleRevealPath}
            onDeleteThread={handleDeleteThread}
            onRenameThread={handleRenameThread}
          />
        ) : activeRoute === "inbox" ? (
          <InboxView
            items={inboxItems}
            onMarkAllRead={() =>
              setInboxItems((prev) => prev.map((i) => ({ ...i, read: true })))
            }
            onClearAll={() => {
              if (window.confirm("确定要清空收件箱中的全部通知吗？")) {
                setInboxItems([]);
              }
            }}
            onDeleteItem={(id, e) => {
              e.stopPropagation();
              setInboxItems((prev) => prev.filter((i) => i.id !== id));
            }}
            onToggleRead={(id, e) => {
              e.stopPropagation();
              setInboxItems((prev) =>
                prev.map((i) => (i.id === id ? { ...i, read: !i.read } : i))
              );
            }}
            onSelectNotification={(item) => {
              setInboxItems((prev) =>
                prev.map((i) => (i.id === item.id ? { ...i, read: true } : i))
              );
              if (item.threadId) {
                selectThread(item.threadId);
              } else {
                setActiveRoute("thread");
              }
            }}
          />
        ) : activeRoute === "scheduled" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <AutomationsView
                activeWorkspaceRoot={activeWorkspace?.path || ""}
                models={models}
                onRunAutomationNow={(item) => {
                  if (item.kind === "goal") {
                    handleLaunchGoal({
                      objective: item.prompt,
                      maxTurns: 15,
                      autoVerifyCommand: projectScripts.testCommand || "npm test",
                      autoContinue: true,
                      useWorktree: item.executionEnvironment === "worktree",
                    });
                  } else {
                    const targetCwd = item.cwds[0] || activeWorkspace?.path;
                    startNewThread(targetCwd);
                    setTimeout(() => {
                      handleSendMessage(`[执行计划任务: ${item.name}]\n${item.prompt}`);
                    }, 120);
                  }
                }}
              />
            </div>
          </div>
        ) : activeRoute === "plugins" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <SkillsMcpView activeWorkspaceRoot={activeWorkspace?.path || ""} />
            </div>
          </div>
        ) : activeRoute === "worktrees" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <WorktreesView
                activeWorkspaceRoot={activeWorkspace?.path || ""}
                onStartChatInWorktree={(wtPath) => {
                  setUseWorktree(true);
                  startNewThread(wtPath);
                  showAppToast(`✓ 已在 Worktree 目录启动隔离会话: ${wtPath}`, "info");
                }}
                onOpenTerminalInWorktree={(wtPath) => {
                  setShowTerminal(true);
                  setPendingTermCommand({
                    id: Date.now(),
                    command: `cd "${wtPath}"`,
                  });
                }}
              />
            </div>
          </div>
        ) : activeRoute === "settings" ? (
          <div className="settings-full-route-view">
            <SettingsView
              appServerStatus={appServerStatus}
              models={models}
              initialSection={settingsInitialSection}
              activeWorkspaceRoot={activeWorkspace?.path || ""}
              selectedPetSpecies={selectedPetSpecies}
              onSelectPetSpecies={setSelectedPetSpecies}
              petVisible={petVisible}
              onTogglePetVisible={setPetVisible}
              onRestartAppServer={(cliPath) =>
                tauriInvoke("app_server_restart", {
                  customCliPath: cliPath || null,
                })
              }
              onConfigUpdated={refreshConfigOverview}
            />
          </div>
        ) : activeRoute === "home" || turns.length === 0 ? (
          /* ── Official 26.1013 Home / New Task View (Matches ref-1-home.png 1:1) ── */
          <div className="home-hero-container">
            <div className="home-hero-logo-wrap">
              <CodexHeroIcon size={50} />
            </div>

            <div style={{ position: "relative" }}>
              <h1 className="home-greeting-title">
                你想让我们在{" "}
                <button
                  type="button"
                  className="home-project-inline-btn"
                  onClick={() => setShowHomeProjectPopover((v) => !v)}
                  title="点击切换本地项目文件夹"
                >
                  {projectName}
                </button>{" "}
                中构建什么？
              </h1>

              {showHomeProjectPopover && (
                <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 260 }}>
                  <WorkspacePopover
                    workspaces={workspaces}
                    activeWorkspacePath={activeWorkspace?.path || ""}
                    hasAgentsMd={agentsMdInfo.found}
                    onSelectWorkspace={handleSelectWorkspace}
                    onRemoveWorkspace={handleRemoveWorkspace}
                    onPickNewFolder={handlePickNewFolder}
                    onOpenAgentsMd={() => setShowAgentsMdModal(true)}
                    onClose={() => setShowHomeProjectPopover(false)}
                  />
                </div>
              )}
            </div>

            {/* Official Two-Tier Composer Box */}
            <ComposerBox
              variant="home"
              promptInput={promptInput}
              onPromptInputChange={setPromptInput}
              onSendMessage={handleSendMessage}
              onInterruptTurn={handleInterruptTurn}
              isStreaming={isStreaming}
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onPickNewFolder={handlePickNewFolder}
              gitStatus={gitStatus}
              gitBranches={gitBranches}
              onSwitchBranch={handleSwitchBranch}
              onCreateBranch={handleCreateBranch}
              useWorktree={useWorktree}
              onSetUseWorktree={setUseWorktree}
              permissionMode={permissionMode}
              onSelectPermissionMode={setPermissionMode}
              models={models}
              selectedModelId={selectedModelId}
              onSelectModelId={setSelectedModelId}
              reasoningEffort={reasoningEffort}
              onSelectReasoningEffort={setReasoningEffort}
              fastMode={fastMode}
              onToggleFastMode={() => setFastMode((v) => !v)}
              planMode={planMode}
              onTogglePlanMode={() => setPlanMode((v) => !v)}
              attachedFiles={attachedFiles}
              onAttachFiles={handleAttachFiles}
              onAddAttachedFiles={(newFiles) =>
                setAttachedFiles((prev) => [...prev, ...newFiles])
              }
              onRemoveAttachedFile={(id) =>
                setAttachedFiles((prev) => prev.filter((f) => f.id !== id))
              }
              workspaceFiles={workspaceFiles}
              workspaceFileHits={workspaceFileHits}
              skills={skills}
              onSlashAction={handleSlashAction}
              textareaRef={composerTextareaRef}
            />

            {/* Ambient Starter Task Suggestions */}
            <div className="home-suggestions-grid">
              {STARTER_PROMPTS.map((item, idx) => (
                <div
                  key={idx}
                  className="suggestion-card"
                  onClick={() => {
                    setPromptInput(item.prompt);
                    composerTextareaRef.current?.focus();
                  }}
                >
                  <span className="suggestion-card-title">{item.title}</span>
                  <span className="suggestion-card-desc">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ── Active Local Conversation Stream (/local/:clientThreadId) ── */
          <>
            <div className="timeline-scroll-pane" ref={timelineScrollRef}>
              {/* Right-Side User Message Navigation Rail */}
              <div className="thread-user-message-navigation-rail">
                {turns
                  .filter((t) => t.items.some((i) => i.type === "userMessage"))
                  .map((turn, uIdx) => {
                    const txt = turn.items.map(extractTextFromItem).join(" ");
                    return (
                      <button
                        key={turn.id}
                        type="button"
                        className="user-turn-jump-dot"
                        title={`跳转到第 ${uIdx + 1} 条提问: ${txt.slice(0, 40)}`}
                        onClick={() => {
                          const el = document.getElementById(`turn-${turn.id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      />
                    );
                  })}
              </div>

              <div className="timeline-content-wrapper">
                {turns.map((turn) => {
                  const isUser = turn.items.some((i) => i.type === "userMessage");
                  if (isUser) {
                    const text = turn.items.map(extractTextFromItem).join("\n");
                    return (
                      <div
                        key={turn.id}
                        id={`turn-${turn.id}`}
                        className="user-turn-block"
                      >
                        <div className="user-bubble">{text}</div>
                        <div className="turn-action-buttons-row right">
                          <button
                            type="button"
                            className="turn-action-mini-btn"
                            title="复制提问内容"
                            onClick={() => {
                              navigator.clipboard.writeText(text);
                              showAppToast("✓ 已复制提问内容", "success");
                            }}
                          >
                            📋 复制
                          </button>
                          <button
                            type="button"
                            className="turn-action-mini-btn"
                            title="重新填入输入框编辑"
                            onClick={() => {
                              setPromptInput(text);
                              composerTextareaRef.current?.focus();
                              showAppToast("已载入输入框以重新编辑", "info");
                            }}
                          >
                            ✏️ 编辑
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const thoughts = turn.items.filter(
                    (i) => i.type === "reasoning"
                  );
                  const commands = turn.items.filter(
                    (i) => i.type === "commandExecution"
                  );
                  const fileChanges = turn.items.filter(
                    (i) => i.type === "fileChange"
                  );
                  const messages = turn.items.filter(
                    (i) => i.type === "agentMessage"
                  );
                  const isExpanded = expandedThoughts[turn.id] ?? false;

                  return (
                    <div
                      key={turn.id}
                      id={`turn-${turn.id}`}
                      className="assistant-turn-block"
                    >
                      <div className="assistant-header">
                        <OpenAIIcon size={17} />
                        <span>Codex</span>
                        {turn.durationMs && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-tertiary)",
                              fontWeight: 400,
                            }}
                          >
                            · {(turn.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>

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
                            <span>
                              {isStreaming && turn.status === "running"
                                ? "正在思考..."
                                : `已思考 ${
                                    thoughts.length > 1
                                      ? `(${thoughts.length} 段)`
                                      : ""
                                  }`}
                            </span>
                            {isExpanded ? (
                              <ChevronDownIcon size={12} />
                            ) : (
                              <ChevronRightIcon size={12} />
                            )}
                          </div>
                          {isExpanded && (
                            <div className="thought-body">
                              {thoughts.map(extractTextFromItem).join("\n")}
                            </div>
                          )}
                        </div>
                      )}

                      {commands.map((cmd, cIdx) => {
                        const outText =
                          cmd.output ||
                          cmd.aggregatedOutput ||
                          cmd.stdout ||
                          cmd.stderr ||
                          "";
                        return (
                          <div key={cmd.id || cIdx} className="command-exec-card">
                            <div className="command-exec-header">
                              <div className="command-exec-title">
                                <TerminalIcon size={13} />
                                <span>
                                  ${" "}
                                  {Array.isArray(cmd.command)
                                    ? cmd.command.join(" ")
                                    : cmd.command || "command"}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  color:
                                    cmd.exitCode === 0 ? "#22c55e" : "#eab308",
                                }}
                              >
                                {cmd.exitCode !== undefined &&
                                cmd.exitCode !== null
                                  ? `exit ${cmd.exitCode}`
                                  : "运行中..."}
                              </span>
                            </div>
                            {outText && (
                              <div className="command-exec-body">{outText}</div>
                            )}
                          </div>
                        );
                      })}

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
                            <span className="diff-plus">
                              +{fc.insertions || 0}
                            </span>{" "}
                            <span className="diff-minus">
                              -{fc.deletions || 0}
                            </span>
                          </span>
                        </div>
                      ))}

                      {messages.map((msg, mIdx) => (
                        <MarkdownView
                          key={msg.id || mIdx}
                          content={extractTextFromItem(msg)}
                        />
                      ))}

                      {messages.length > 0 && !isStreaming && (
                        <div className="turn-action-buttons-row left">
                          <button
                            type="button"
                            className="turn-action-mini-btn"
                            title="复制全部回答 Markdown"
                            onClick={() => {
                              const ans = messages
                                .map(extractTextFromItem)
                                .join("\n\n");
                              navigator.clipboard.writeText(ans);
                              showAppToast("✓ 已复制回答 Markdown 内容", "success");
                            }}
                          >
                            📋 复制回答
                          </button>
                          <button
                            type="button"
                            className="turn-action-mini-btn"
                            title="重新审视并生成回答"
                            onClick={() => {
                              handleSendMessage(
                                "请重新思考当前任务并重新生成一份更完善的解答。"
                              );
                            }}
                          >
                            🔄 重新生成
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Pending Server Requests (Both Approvals & Interactive AskUserInput) */}
                {pendingRequests.map((req) => {
                  const isUserInput =
                    req.method === "item/tool/requestUserInput" ||
                    req.method === "tool/requestUserInput" ||
                    req.method === "ask_user" ||
                    Boolean(req.params?.question || req.params?.questions);

                  if (isUserInput) {
                    const questionText =
                      req.params?.question ||
                      (Array.isArray(req.params?.questions)
                        ? req.params.questions[0]?.question
                        : "Codex 需要您的选择或输入以继续：");
                    const options = Array.isArray(req.params?.options)
                      ? req.params.options
                      : Array.isArray(req.params?.questions?.[0]?.options)
                        ? req.params.questions[0].options
                        : [];

                    return (
                      <div key={req.id} className="approval-card question-card">
                        <div className="approval-header">
                          <OpenAIIcon size={18} />
                          <strong>Codex 提问询问</strong>
                        </div>
                        <div className="question-text">{questionText}</div>
                        {options.length > 0 && (
                          <div className="question-options-list">
                            {options.map((opt: any, oIdx: number) => {
                              const optVal =
                                typeof opt === "string" ? opt : opt?.label || opt?.text || "";
                              return (
                                <button
                                  key={oIdx}
                                  type="button"
                                  className="question-opt-btn"
                                  onClick={() =>
                                    handleRespondUserInput(req.id, {
                                      answers: [optVal],
                                      selected: optVal,
                                    })
                                  }
                                >
                                  {optVal}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div className="question-input-row">
                          <input
                            type="text"
                            placeholder="输入自定义答复并发送..."
                            value={userInputAnswers[String(req.id)] || ""}
                            onChange={(e) =>
                              setUserInputAnswers((prev) => ({
                                ...prev,
                                [String(req.id)]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const ans =
                                  userInputAnswers[String(req.id)]?.trim() || "";
                                if (ans) {
                                  handleRespondUserInput(req.id, {
                                    answers: [ans],
                                    selected: ans,
                                  });
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="primary-btn compact"
                            onClick={() => {
                              const ans =
                                userInputAnswers[String(req.id)]?.trim() || "";
                              handleRespondUserInput(req.id, {
                                answers: [ans],
                                selected: ans,
                              });
                            }}
                          >
                            发送答复
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={req.id} className="approval-card">
                      <div className="approval-header">
                        <ShieldIcon size={18} />
                        <span>需要批准操作 ({req.method})</span>
                      </div>
                      <div className="approval-details">
                        {req.params?.command
                          ? `$ ${req.params.command}`
                          : JSON.stringify(req.params, null, 2)}
                      </div>
                      <div className="approval-btn-group">
                        <button
                          type="button"
                          className="btn-approve"
                          onClick={() => handleApprovalDecision(req.id, "accept")}
                        >
                          允许一次
                        </button>
                        <button
                          type="button"
                          className="btn-session"
                          onClick={() =>
                            handleApprovalDecision(req.id, "acceptForSession")
                          }
                        >
                          本会话始终允许
                        </button>
                        <button
                          type="button"
                          className="btn-decline"
                          onClick={() => handleApprovalDecision(req.id, "decline")}
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Floating Follow-up Composer */}
            <div className="floating-composer-dock">
              {/* Follow-up Prompt Queue ("下一步 Up next") */}
              {followupQueue.length > 0 && (
                <div className="floating-up-next-bar">
                  <div className="up-next-left">
                    <span className="up-next-badge">下一步 Up next</span>
                    <span className="up-next-text" title={followupQueue[0].text}>
                      {followupQueue[0].text}
                    </span>
                    {followupQueue.length > 1 && (
                      <span className="badge-pill">
                        +{followupQueue.length - 1} 项排队中
                      </span>
                    )}
                  </div>
                  <div className="up-next-actions">
                    <button
                      type="button"
                      className="mini-link-btn"
                      onClick={() => handleSteerTurn(followupQueue[0].text)}
                    >
                      立即引导 (Steer)
                    </button>
                    <button
                      type="button"
                      className="mini-link-btn danger"
                      onClick={() => setFollowupQueue((prev) => prev.slice(1))}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              <div className="floating-composer-inner">
                <ComposerBox
                  variant="thread"
                  promptInput={promptInput}
                  onPromptInputChange={setPromptInput}
                  onSendMessage={handleSendMessage}
                  onInterruptTurn={handleInterruptTurn}
                  isStreaming={isStreaming}
                  workspaces={workspaces}
                  activeWorkspace={activeWorkspace}
                  onSelectWorkspace={handleSelectWorkspace}
                  onPickNewFolder={handlePickNewFolder}
                  gitStatus={gitStatus}
                  gitBranches={gitBranches}
                  onSwitchBranch={handleSwitchBranch}
                  onCreateBranch={handleCreateBranch}
                  useWorktree={useWorktree}
                  onSetUseWorktree={setUseWorktree}
                  permissionMode={permissionMode}
                  onSelectPermissionMode={setPermissionMode}
                  models={models}
                  selectedModelId={selectedModelId}
                  onSelectModelId={setSelectedModelId}
                  reasoningEffort={reasoningEffort}
                  onSelectReasoningEffort={setReasoningEffort}
                  fastMode={fastMode}
                  onToggleFastMode={() => setFastMode((v) => !v)}
                  planMode={planMode}
                  onTogglePlanMode={() => setPlanMode((v) => !v)}
                  attachedFiles={attachedFiles}
                  onAttachFiles={handleAttachFiles}
                  onAddAttachedFiles={(newFiles) =>
                    setAttachedFiles((prev) => [...prev, ...newFiles])
                  }
                  onRemoveAttachedFile={(id) =>
                    setAttachedFiles((prev) => prev.filter((f) => f.id !== id))
                  }
                  workspaceFiles={workspaceFiles}
                  workspaceFileHits={workspaceFileHits}
                  skills={skills}
                  onSlashAction={handleSlashAction}
                  textareaRef={composerTextareaRef}
                />
              </div>
            </div>
          </>
        )}

        {/* Bottom Interactive PTY Terminal Dock */}
        {showTerminal && (
          <TerminalDock
            cwd={activeWorkspace?.path || ""}
            onClose={() => setShowTerminal(false)}
            pendingCommand={pendingTermCommand}
          />
        )}
      </main>

      {/* ── 4. Right-Hand Diff & File Review Workbench ── */}
      {showRightDrawer && (
        <DiffDrawer
          cwd={activeWorkspace?.path || ""}
          gitStatus={gitStatus}
          turns={turns}
          onRefreshGit={refreshGitStatus}
          onClose={() => setShowRightDrawer(false)}
          selectedPreviewFile={selectedPreviewFile}
          onSelectPreviewFile={setSelectedPreviewFile}
          onSendReviewComment={(comment) => handleSendMessage(comment)}
        />
      )}

      {/* ── 5. AGENTS.md Modal ── */}
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

      {/* ── 6. Floating Mini Virtual Pet Companion Widget ── */}
      <MiniPetWidget
        visible={petVisible}
        species={selectedPetSpecies}
        isStreaming={isStreaming}
        onChangeSpecies={setSelectedPetSpecies}
        onQuickPrompt={(prompt) => handleSendMessage(prompt)}
        onClose={() => setPetVisible(false)}
      />

      {/* ── 7. Global Ctrl+K Quick Search & Command Palette Modal ── */}
      <QuickSearchModal
        open={showQuickSearch}
        threads={threads}
        workspaceFileHits={workspaceFileHits}
        skills={skills}
        projectScripts={projectScripts}
        onClose={() => setShowQuickSearch(false)}
        onSelectThread={selectThread}
        onSelectFile={(filePath) => {
          setSelectedPreviewFile(filePath);
          setShowRightDrawer(true);
        }}
        onSelectSkill={(skillId) => {
          setPromptInput((prev) => `${prev} $${skillId} `);
          composerTextareaRef.current?.focus();
        }}
        onNavigateSettings={(slug) => {
          setSettingsInitialSection(slug);
          setActiveRoute("settings");
        }}
        onNavigateRoute={(route) => {
          setActiveRoute(route);
        }}
        onStartNewChat={startNewThread}
        onTriggerCommand={(cmd) => {
          setShowTerminal(true);
          setPendingTermCommand({ id: Date.now(), command: cmd });
        }}
      />

      {/* ── 8. Autonomous Goal Setup Modal ── */}
      <GoalSetupModal
        isOpen={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        initialObjective={promptInput.replace(/^\/goal\s*/, "")}
        workspacePath={activeWorkspace?.path}
        projectScripts={projectScripts}
        onLaunchGoal={handleLaunchGoal}
      />

      {/* ── 9. Global In-App Toast Banner ── */}
      {appToast && (
        <div className={`app-global-toast ${appToast.type || "info"}`}>
          <span>{appToast.message}</span>
        </div>
      )}
    </div>
  );
};
