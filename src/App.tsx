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
  SparklesIcon,
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
  GitCommitInfo,
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
import { CodeReviewView, ReviewRequest } from "./components/CodeReviewView";
import { GoalSetupModal, GoalSetupConfig } from "./components/GoalSetupModal";
import { GoalProgressBanner } from "./components/GoalProgressBanner";
import { ApprovalCenter } from "./components/ApprovalCenter";
import { PlanPanel } from "./components/PlanPanel";
import { TurnDiffPanel } from "./components/TurnDiffPanel";
import { TokenUsageMeter } from "./components/TokenUsageMeter";
import { ThreadActionsMenu, ThreadActionItem } from "./components/ThreadActionsMenu";
import {
  TokenUsageSnapshot,
  mergeTokenUsage,
  mergeRateLimits,
  NOTIFICATION,
} from "./protocol";
import {
  ThreadGoal,
  goalGet,
  goalSet,
  goalClear,
  buildGoalPrompt,
  goalStatusLabel,
} from "./threadGoal";

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

/** Reasoning items carry `summary[]` + `content[]` (and streamed text). */
function extractReasoningText(item: TurnItem): string {
  const parts: string[] = [];
  const push = (v: any) => {
    if (typeof v === "string" && v.trim()) parts.push(v);
    else if (v && typeof v.text === "string" && v.text.trim()) parts.push(v.text);
  };
  if (Array.isArray(item.summary)) item.summary.forEach(push);
  if (typeof item.text === "string" && item.text.trim()) parts.push(item.text);
  if (Array.isArray(item.content)) item.content.forEach(push);
  if (Array.isArray(item.reasoningText)) item.reasoningText.forEach(push);
  else if (typeof item.reasoningText === "string" && item.reasoningText.trim()) {
    parts.push(item.reasoningText);
  }
  if (!parts.length) return extractTextFromItem(item);
  return Array.from(new Set(parts)).join("\n");
}

/** Count added/removed lines in a unified diff snippet. */
function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of (diff || "").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/**
 * Split a turn-level unified diff (`turn/diff/updated`) into per-file entries.
 */
export function parseUnifiedDiffFiles(
  diff: string
): Array<{ path: string; kind: string; diff: string; additions: number; deletions: number }> {
  if (!diff || !diff.trim()) return [];
  const chunks: string[] = [];
  const lines = diff.split("\n");
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current.length) chunks.push(current.join("\n"));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current.join("\n"));
  if (!chunks.length) chunks.push(diff);

  return chunks.map((chunk) => {
    const firstLine = chunk.split("\n")[0] || "";
    let path = "";
    const m = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) path = m[2];
    if (!path) {
      const plus = chunk.match(/^\+\+\+ b\/(.+)$/m);
      if (plus) path = plus[1];
    }
    if (!path) {
      const newFile = chunk.match(/^\+\+\+ \/dev\/null$/m);
      const oldFile = chunk.match(/^--- a\/(.+)$/m);
      if (newFile && oldFile) path = `(deleted) ${oldFile[1]}`;
    }
    if (!path) path = "(unknown file)";
    let kind = "update";
    if (/^new file mode/m.test(chunk)) kind = "add";
    else if (/^deleted file mode/m.test(chunk)) kind = "delete";
    else if (/^rename from/m.test(chunk)) kind = "rename";
    const { additions, deletions } = countDiffLines(chunk);
    return { path, kind, diff: chunk, additions, deletions };
  });
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

/** Map app-server ThreadStatus -> header chip text. */
function describeThreadStatus(status: { type: string; activeFlags?: string[] } | null): {
  label: string;
  tone: string;
} {
  if (!status) return { label: "", tone: "" };
  const flags = status.activeFlags || [];
  if (status.type === "active") {
    if (flags.includes("waitingOnApproval")) return { label: "等待批准", tone: "warn" };
    if (flags.includes("waitingOnUserInput")) return { label: "等待输入", tone: "warn" };
    return { label: "运行中", tone: "active" };
  }
  if (status.type === "systemError") return { label: "出错", tone: "error" };
  if (status.type === "idle") return { label: "空闲", tone: "idle" };
  return { label: "", tone: "" };
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
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([]);

  // Code Review (review/start)
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewLastResult, setReviewLastResult] = useState<string | null>(null);

  // Windows sandbox readiness（windowsSandbox/*）
  const [sandboxNotice, setSandboxNotice] = useState<string | null>(null);
  const [sandboxSettingUp, setSandboxSettingUp] = useState(false);

  // Threads, Pinned, Hints & Conversation State
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const [workspaceHints, setWorkspaceHints] = useState<Record<string, string>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnData[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [pendingRequests, setPendingRequests] = useState<PendingServerRequest[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSnapshot | null>(null);
  const [planSteps, setPlanSteps] = useState<Array<{ step: string; status: string }>>([]);
  const [turnDiffFiles, setTurnDiffFiles] = useState<
    Array<{ path: string; kind: string; diff: string; additions: number; deletions: number }>
  >([]);
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [rateLimits, setRateLimits] = useState<any>(null);
  const [activeThreadStatus, setActiveThreadStatus] = useState<{
    type: string;
    activeFlags?: string[];
  } | null>(null);
  const [autoReview, setAutoReview] = useState<{
    active: boolean;
    decision?: string | null;
  } | null>(null);
  const [inboxItems, setInboxItems] = useState<InboxNotificationItem[]>([]);

  // Composer State
  const [promptInput, setPromptInput] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("gpt-6.1-sol");
  const [reasoningEffort, setReasoningEffort] = useState<string>("low");
  const [permissionMode, setPermissionMode] = useState<"ask" | "auto" | "full">("ask");
  const [useWorktree, setUseWorktree] = useState<boolean>(false);
  const [fastMode, setFastMode] = useState<boolean>(false);
  const [planMode, setPlanMode] = useState<boolean>(false);
  const planModeRef = useRef<boolean>(false);
  planModeRef.current = planMode;
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
  const [serverGoal, setServerGoal] = useState<ThreadGoal | null>(null);
  const activeGoalRef = useRef<ActiveGoalSession | null>(null);
  activeGoalRef.current = activeGoal;
  const serverGoalRef = useRef<ThreadGoal | null>(null);
  serverGoalRef.current = serverGoal;
  const countdownTimerRef = useRef<any>(null);
  const handleGoalTurnFinishedRef = useRef<((g: ActiveGoalSession) => Promise<void>) | null>(null);
  const handleLaunchGoalRef = useRef<((config: GoalSetupConfig) => Promise<void>) | null>(null);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  activeThreadIdRef.current = activeThreadId;
  const activeTurnIdRef = useRef<string | null>(null);
  activeTurnIdRef.current = activeTurnId;
  const workspaceWatchIdRef = useRef<string | null>(null);
  const fsRefreshTimerRef = useRef<any>(null);

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

  const refreshPendingRequests = useCallback(async () => {
    try {
      const list = await tauriInvoke<PendingServerRequest[]>("app_server_pending_requests");
      if (Array.isArray(list)) setPendingRequests(list);
    } catch (e) {
      console.warn("app_server_pending_requests failed:", e);
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

  const refreshAccount = useCallback(async () => {
    try {
      const info = await callAppServer<any>("account/read", {});
      setAccountInfo(info?.account ? info : (info ?? null));
    } catch (e) {
      console.warn("account/read failed:", e);
    }
    try {
      const limits = await callAppServer<any>("account/rateLimits/read", {});
      setRateLimits(limits ?? null);
    } catch (e) {
      console.warn("account/rateLimits/read failed:", e);
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
          refreshPendingRequests();
          refreshAccount();
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
          refreshPendingRequests();
          refreshAccount();
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
          setActiveTurnId(turnId);
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
          if (!turnId || turnId === activeTurnIdRef.current) {
            setActiveTurnId(null);
            setPlanSteps([]);
          }
          const duration = params?.turn?.durationMs || params?.turnDurationMs;
          const completedItems = Array.isArray(params?.turn?.items)
            ? params.turn.items
            : null;
          setTurns((prev) =>
            prev.map((t) => {
              const isTarget = t.id === turnId || (!turnId && t.status === "running");
              if (!isTarget) return t;
              let items = t.items;
              if (completedItems && completedItems.length > 0) {
                // 合并已完成 turn 的权威 items（本地流式累积可能缺 item）
                const byId = new Map<string, any>();
                for (const it of t.items) if (it?.id) byId.set(it.id, it);
                for (const it of completedItems) {
                  const existing = it?.id ? byId.get(it.id) : undefined;
                  if (existing) byId.set(it.id, { ...existing, ...it });
                  else if (it?.id) byId.set(it.id, it);
                  else items = [...items, it];
                }
                const merged: any[] = [];
                const seen = new Set<string>();
                for (const it of [...t.items, ...completedItems]) {
                  if (!it?.id) continue;
                  if (seen.has(it.id)) {
                    const idx = merged.findIndex((m) => m.id === it.id);
                    if (idx >= 0) merged[idx] = { ...merged[idx], ...it };
                    continue;
                  }
                  seen.add(it.id);
                  merged.push(byId.get(it.id) ?? it);
                }
                // 保留本地暂未带 id 的条目
                for (const it of t.items) if (!it?.id) merged.push(it);
                items = merged;
              }
              return {
                ...t,
                status: "completed",
                completedAt: Date.now(),
                durationMs: duration,
                items,
                error: params?.turn?.error ?? t.error,
              } as TurnData;
            })
          );
          refreshGitStatus();
          refreshThreads();
          if (turnId) {
            setInboxItems((prev) => {
              const entryId = `turn-done-${turnId}`;
              if (prev.some((item) => item.id === entryId)) return prev;
              return [
                {
                  id: entryId,
                  title: "会话回复已完成",
                  subtitle: `turn ${String(turnId).slice(0, 8)}`,
                  kind: "thread_done" as const,
                  threadId: activeThreadIdRef.current || undefined,
                  createdAt: Date.now(),
                  read: false,
                },
                ...prev,
              ].slice(0, 100);
            });
          }

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
          method === NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA ||
          method === NOTIFICATION.ITEM_REASONING_TEXT_DELTA
        ) {
          const thoughtDelta = params?.delta || params?.text || "";
          const isRawText = method === NOTIFICATION.ITEM_REASONING_TEXT_DELTA;
          if (!thoughtDelta) return;
          setTurns((prev) => {
            const list = [...prev];
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const itemId = params?.itemId;
            let thoughtIdx = -1;
            if (itemId) thoughtIdx = items.findIndex((i) => i.id === itemId);
            if (thoughtIdx < 0) {
              thoughtIdx = items.map((i) => i.type).lastIndexOf("reasoning");
            }
            if (thoughtIdx < 0) {
              items.push({
                id: itemId || `thought-${Date.now()}`,
                type: "reasoning",
                text: isRawText ? "" : thoughtDelta,
                reasoningText: isRawText ? thoughtDelta : "",
              } as any);
            } else {
              const existing: any = { ...items[thoughtIdx] };
              if (isRawText) {
                existing.reasoningText = (existing.reasoningText || "") + thoughtDelta;
              } else {
                existing.text = (existing.text || "") + thoughtDelta;
              }
              items[thoughtIdx] = existing;
            }
            lastTurn.items = items;
            return list;
          });
        } else if (method === NOTIFICATION.ITEM_REASONING_SUMMARY_PART) {
          setTurns((prev) => {
            const list = [...prev];
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const idx = items.map((i) => i.type).lastIndexOf("reasoning");
            if (idx >= 0) {
              const existing: any = { ...items[idx] };
              existing.text = (existing.text || "") + "\n\n";
              items[idx] = existing;
              lastTurn.items = items;
            }
            return list;
          });
        } else if (method === NOTIFICATION.ITEM_COMMAND_OUTPUT_DELTA) {
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
        } else if (method === NOTIFICATION.ITEM_PLAN_DELTA) {
          const delta = params?.delta || "";
          if (!delta) return;
          setTurns((prev) => {
            const list = [...prev];
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const itemId = params?.itemId;
            let idx = itemId ? items.findIndex((i) => i.id === itemId) : -1;
            if (idx < 0) idx = items.map((i) => i.type).lastIndexOf("plan");
            if (idx < 0) {
              items.push({ id: itemId || `plan-${Date.now()}`, type: "plan", text: delta } as any);
            } else {
              items[idx] = { ...items[idx], text: (items[idx].text || "") + delta } as any;
            }
            lastTurn.items = items;
            return list;
          });
        } else if (method === NOTIFICATION.TURN_PLAN_UPDATED) {
          const plan = Array.isArray(params?.plan) ? params.plan : [];
          setPlanSteps(
            plan
              .map((p: any) => ({
                step: String(p?.step ?? p?.title ?? ""),
                status: String(p?.status ?? "pending"),
              }))
              .filter((p: any) => p.step)
          );
        } else if (method === NOTIFICATION.TURN_DIFF_UPDATED) {
          const diff = typeof params?.diff === "string" ? params.diff : "";
          setTurnDiffFiles(parseUnifiedDiffFiles(diff));
        } else if (method === NOTIFICATION.ITEM_FILE_CHANGE_PATCH) {
          const changes = Array.isArray(params?.changes) ? params.changes : [];
          if (!changes.length) return;
          setTurns((prev) => {
            const list = [...prev];
            const lastTurn = list[list.length - 1];
            if (!lastTurn) return prev;
            const items = [...lastTurn.items];
            const itemId = params?.itemId;
            let idx = itemId ? items.findIndex((i) => i.id === itemId) : -1;
            if (idx < 0) idx = items.map((i) => i.type).lastIndexOf("fileChange");
            if (idx < 0) {
              items.push({
                id: itemId || `filechange-${Date.now()}`,
                type: "fileChange",
                status: "inProgress",
                changes,
              } as any);
            } else {
              items[idx] = { ...items[idx], changes } as any;
            }
            lastTurn.items = items;
            return list;
          });
        } else if (method === NOTIFICATION.THREAD_STATUS_CHANGED) {
          const tid = params?.threadId;
          const status = params?.status?.type ?? params?.status;
          if (tid) {
            setThreads((prev) =>
              prev.map((t) => (t.id === tid ? { ...t, status } : t))
            );
            if (tid === activeThreadIdRef.current) {
              setActiveThreadStatus({
                type: String(status ?? "idle"),
                activeFlags: Array.isArray(params?.status?.activeFlags)
                  ? params.status.activeFlags
                  : [],
              });
            }
          }
        } else if (method === NOTIFICATION.WINDOWS_SANDBOX_SETUP_COMPLETED) {
          callAppServer<any>("windowsSandbox/readiness", {})
            .then((res) => {
              if (res?.status === "ready") {
                setSandboxNotice(null);
                showAppToast("✓ Windows 沙箱已就绪", "success");
              }
            })
            .catch(() => {});
        } else if (method === NOTIFICATION.THREAD_QUEUE_CHANGED) {
          const tid = params?.threadId;
          if (!tid || tid === activeThreadIdRef.current) {
            refreshThreadQueue(tid ?? undefined);
          }
        } else if (method === NOTIFICATION.THREAD_GOAL_UPDATED) {
          const goal = params?.goal as ThreadGoal | undefined;
          if (goal) {
            if (!goal.threadId || goal.threadId === activeThreadIdRef.current) {
              syncGoalFromServer(goal);
              if (goal.status === "complete") {
                playNotificationChime("done");
              }
            }
          }
        } else if (method === NOTIFICATION.THREAD_GOAL_CLEARED) {
          const tid = params?.threadId;
          if (!tid || tid === activeThreadIdRef.current) {
            syncGoalFromServer(null);
          }
        } else if (method === NOTIFICATION.ACCOUNT_RATE_LIMITS) {
          setRateLimits((prev: any) => mergeRateLimits(prev, params));
        } else if (method === NOTIFICATION.ACCOUNT_UPDATED) {
          setAccountInfo((prev: any) => ({ ...(prev || {}), ...(params || {}) }));
        } else if (method === NOTIFICATION.ITEM_AUTO_REVIEW_STARTED) {
          setAutoReview({ active: true, decision: null });
        } else if (method === NOTIFICATION.ITEM_AUTO_REVIEW_COMPLETED) {
          const decision =
            params?.decision?.type ??
            params?.decision ??
            params?.result?.decision ??
            null;
          setAutoReview({ active: false, decision: decision ? String(decision) : null });
          setTimeout(() => setAutoReview(null), 8000);
        } else if (method === NOTIFICATION.THREAD_REVERTED) {
          if (activeThreadIdRef.current) {
            selectThread(activeThreadIdRef.current);
          }
        } else if (
          method === NOTIFICATION.THREAD_COMPACTED
        ) {
          setTurns((prev) => [
            ...prev,
            {
              id: `compaction-${Date.now()}`,
              status: "completed",
              startedAt: Date.now(),
              items: [
                {
                  id: `compaction-item-${Date.now()}`,
                  type: "agentMessage",
                  text: "🗜️ 上下文已压缩（Context compacted）",
                },
              ],
            },
          ]);
        } else if (method === NOTIFICATION.FS_CHANGED) {
          const watchId = params?.watchId;
          if (watchId && workspaceWatchIdRef.current === watchId) {
            if (fsRefreshTimerRef.current) clearTimeout(fsRefreshTimerRef.current);
            fsRefreshTimerRef.current = setTimeout(() => {
              refreshGitStatus();
              refreshWorkspaceContext();
            }, 400);
          }
        } else if (method === NOTIFICATION.SKILLS_CHANGED) {
          refreshWorkspaceContext();
        } else if (method === NOTIFICATION.SERVER_REQUEST_RESOLVED) {
          const resolvedId = params?.requestId ?? params?.id ?? params?.request_id;
          if (resolvedId !== undefined && resolvedId !== null) {
            setPendingRequests((prev) =>
              prev.filter((r) => String(r.id) !== String(resolvedId))
            );
          }
        } else if (method === NOTIFICATION.THREAD_TOKEN_USAGE) {
          setTokenUsage((prev) => mergeTokenUsage(prev, params));
        } else if (method === NOTIFICATION.THREAD_NAME_UPDATED) {
          const tid = params?.threadId ?? params?.thread_id;
          const name = params?.name ?? params?.threadName ?? null;
          if (tid) {
            setThreads((prev) =>
              prev.map((t) => (t.id === tid ? { ...t, name } : t))
            );
          }
        } else if (
          method === NOTIFICATION.THREAD_ARCHIVED ||
          method === NOTIFICATION.THREAD_DELETED
        ) {
          const tid = params?.threadId ?? params?.thread_id ?? params?.thread?.id;
          if (tid) {
            setThreads((prev) => prev.filter((t) => t.id !== tid));
            if (activeThreadIdRef.current === tid) {
              setActiveThreadId(null);
              setTurns([]);
              setActiveRoute("home");
            }
          }
        } else if (method === NOTIFICATION.THREAD_UNARCHIVED) {
          refreshThreads();
        } else if (
          method === NOTIFICATION.WARNING ||
          method === NOTIFICATION.CONFIG_WARNING ||
          method === NOTIFICATION.DEPRECATION_NOTICE ||
          method === NOTIFICATION.GUARDIAN_WARNING
        ) {
          console.warn(`[${method}]`, params?.message ?? params);
        } else if (method === NOTIFICATION.ERROR) {
          console.error("[app-server error]", params?.message ?? params);
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
    refreshPendingRequests,
    refreshAccount,
    refreshWorkspaceContext,
  ]);

  useEffect(() => {
    refreshGitStatus();
    refreshWorkspaceContext();
  }, [refreshGitStatus, refreshWorkspaceContext]);

  // 工作区文件系统实时监听：fs/watch + fs/changed → 防抖刷新文件树/Git 状态
  useEffect(() => {
    const root = activeWorkspace?.path;
    if (!root || !appServerStatus.connected) return;
    const watchId = `workspace:${root}`;
    workspaceWatchIdRef.current = watchId;
    callAppServer("fs/watch", { path: root, watchId }).catch((e) =>
      console.warn("fs/watch failed:", e)
    );
    return () => {
      callAppServer("fs/unwatch", { watchId }).catch(() => {});
      if (workspaceWatchIdRef.current === watchId) {
        workspaceWatchIdRef.current = null;
      }
    };
  }, [activeWorkspace?.path, appServerStatus.connected]);

  // Windows 沙箱就绪检测（windowsSandbox/readiness）
  useEffect(() => {
    if (!appServerStatus.connected) return;
    let cancelled = false;
    callAppServer<any>("windowsSandbox/readiness", {})
      .then((res) => {
        if (cancelled) return;
        const status = res?.status;
        if (status && status !== "ready" && status !== "notRequired") {
          setSandboxNotice(String(status));
        } else {
          setSandboxNotice(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appServerStatus.connected]);

  // Inbox 持久化（desktop_state）+ 变更回写
  const inboxHydratedRef = useRef(false);
  useEffect(() => {
    tauriInvoke<any>("desktop_state_get", { key: "inboxItems" })
      .then((saved) => {
        if (Array.isArray(saved) && saved.length > 0) {
          setInboxItems(saved);
        }
      })
      .catch(() => {})
      .finally(() => {
        inboxHydratedRef.current = true;
      });
  }, []);
  useEffect(() => {
    if (!inboxHydratedRef.current) return;
    const handle = setTimeout(() => {
      tauriInvoke("desktop_state_set", {
        key: "inboxItems",
        value: inboxItems.slice(0, 100),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(handle);
  }, [inboxItems]);

  // Code Review：进入页面时加载最近提交，供“指定提交”选择
  useEffect(() => {
    if (activeRoute !== "review") return;
    const cwd = activeWorkspace?.path;
    if (!cwd) return;
    tauriInvoke<GitCommitInfo[]>("git_log_commits", { cwd, limit: 30 })
      .then((commits) => setGitCommits(Array.isArray(commits) ? commits : []))
      .catch(() => setGitCommits([]));
  }, [activeRoute, activeWorkspace?.path]);

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
      setActiveTurnId(null);
      setActiveThreadStatus(null);
      setTurns([]);
      setPlanSteps([]);
      setTurnDiffFiles([]);
      setTokenUsage(null);
      setActiveRoute("home");
      setTimeout(() => composerTextareaRef.current?.focus(), 50);
    },
    [handleSelectWorkspace]
  );

  const selectThread = useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    setActiveRoute("thread");
    setActiveTurnId(null);
    setActiveThreadStatus(null);
    setPlanSteps([]);
    setTurnDiffFiles([]);
    try {
      const res = await callAppServer<any>("thread/read", {
        threadId,
        includeTurns: true,
      });
      const threadStatus = res?.thread?.status;
      if (threadStatus) {
        setActiveThreadStatus({
          type: String(threadStatus?.type ?? threadStatus),
          activeFlags: Array.isArray(threadStatus?.activeFlags)
            ? threadStatus.activeFlags
            : [],
        });
      }
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
    // 同步服务端 thread goal（若存在）
    try {
      const goal = await goalGet(threadId);
      if (threadId === activeThreadIdRef.current) {
        setServerGoal(goal);
      }
    } catch {
      // ignore goal read failures
    }
  }, []);

  // Fork / Revert / Compact — official thread lifecycle via app-server
  const handleForkThread = useCallback(
    async (fromTurnId?: string) => {
      if (!activeThreadId) {
        showAppToast("请先打开一个会话再派生", "info");
        return;
      }
      try {
        const res = await callAppServer<any>("thread/fork", {
          threadId: activeThreadId,
          cwd: activeWorkspace?.path || undefined,
          lastTurnId: fromTurnId || activeTurnId || undefined,
        });
        const newThreadId = res?.threadId || res?.thread?.id;
        await refreshThreads();
        if (newThreadId) {
          await selectThread(String(newThreadId));
          showAppToast("✓ 已从当前会话派生新会话", "success");
        }
      } catch (e: any) {
        showAppToast(`派生会话失败：${e?.message || e}`, "error");
      }
    },
    [activeThreadId, activeTurnId, activeWorkspace?.path, refreshThreads, selectThread, showAppToast]
  );

  const handleRevertToTurn = useCallback(
    async (beforeTurnId: string) => {
      if (!activeThreadId) return;
      try {
        await callAppServer("thread/revert", {
          threadId: activeThreadId,
          beforeTurnId,
        });
        await selectThread(activeThreadId);
        refreshGitStatus();
        showAppToast("✓ 已回滚到该轮次之前", "success");
      } catch (e: any) {
        showAppToast(`回滚失败：${e?.message || e}`, "error");
      }
    },
    [activeThreadId, selectThread, refreshGitStatus, showAppToast]
  );

  const handleCompactThread = useCallback(async () => {
    if (!activeThreadId) return;
    try {
      await callAppServer("thread/compact/start", { threadId: activeThreadId });
      showAppToast("已开始压缩上下文，稍后自动完成", "info");
    } catch (e: any) {
      showAppToast(`压缩上下文失败：${e?.message || e}`, "error");
    }
  }, [activeThreadId, showAppToast]);

  /** 官方 Plan 模式：thread/settings/update 的 collaborationMode（plan/default） */
  const applyCollaborationMode = useCallback(
    async (threadId: string, enabled: boolean) => {
      await callAppServer("thread/settings/update", {
        threadId,
        collaborationMode: {
          mode: enabled ? "plan" : "default",
          settings: {
            model: selectedModelId,
            reasoning_effort: reasoningEffort || null,
            developer_instructions: null,
          },
        },
      });
    },
    [selectedModelId, reasoningEffort]
  );

  const handleTogglePlanMode = useCallback(
    async () => {
      const next = !planModeRef.current;
      setPlanMode(next);
      if (!activeThreadId) {
        showAppToast(
          next ? "计划模式已开启（将在新会话中生效）" : "计划模式已关闭",
          "info"
        );
        return;
      }
      try {
        await applyCollaborationMode(activeThreadId, next);
        showAppToast(
          next ? "✓ 已切换到计划模式 (Plan)" : "✓ 已切换到默认模式 (Default)",
          "success"
        );
      } catch (e: any) {
        showAppToast(`切换计划模式失败：${e?.message || e}`, "error");
      }
    },
    [activeThreadId, applyCollaborationMode, showAppToast]
  );

  // Code Review：`review/start` 内联审查（官方 Code Review 能力）
  const handleStartCodeReview = useCallback(
    async (req: ReviewRequest) => {
      const cwd = activeWorkspace?.path;
      if (!cwd) {
        showAppToast("请先在左侧选择一个工作区目录", "error");
        return;
      }
      if (!appServerStatus.connected) {
        showAppToast("app-server 未连接，无法启动审查", "error");
        return;
      }
      setReviewBusy(true);
      try {
        const threadRes = await callAppServer<any>("thread/start", {
          cwd,
          model: selectedModelId,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        });
        const threadId = threadRes?.threadId || threadRes?.thread?.id;
        if (!threadId) throw new Error("无法为审查创建会话");

        let target: any;
        if (req.kind === "branch") {
          target = { type: "baseBranch", branch: req.branch };
        } else if (req.kind === "commit") {
          const commit = gitCommits.find((c) => c.hash === req.sha);
          target = {
            type: "commit",
            sha: req.sha,
            title: commit?.subject ?? null,
          };
        } else if (req.kind === "custom") {
          target = {
            type: "instructions",
            instructions: req.instructions || "请审查当前工作区的改动",
          };
        } else {
          target = { type: "uncommittedChanges" };
        }

        const reviewRes = await callAppServer<any>("review/start", {
          threadId,
          delivery: "inline",
          target,
        });
        const reviewThreadId = reviewRes?.reviewThreadId || threadId;
        await refreshThreads();
        await selectThread(reviewThreadId);
        const label =
          req.kind === "uncommitted"
            ? "未提交改动"
            : req.kind === "branch"
            ? `对比分支 ${req.branch}`
            : req.kind === "commit"
            ? `提交 ${req.sha?.slice(0, 8)}`
            : "自定义指令";
        setReviewLastResult(`已启动审查：${label}`);
        showAppToast(`✓ 代码审查已启动（${label}）`, "success");
      } catch (e: any) {
        showAppToast(`启动代码审查失败：${e?.message || e}`, "error");
      } finally {
        setReviewBusy(false);
      }
    },
    [
      activeWorkspace?.path,
      appServerStatus.connected,
      selectedModelId,
      gitCommits,
      refreshThreads,
      selectThread,
      showAppToast,
    ]
  );

  // Send or Steer Message
  const handleSendMessage = useCallback(async (overrideText?: string) => {
    const rawText = (typeof overrideText === "string" ? overrideText : promptInput).trim();
    if (!rawText && attachedFiles.length === 0) return;

    // Direct /goal command detection (官方 goal 走 thread/goal/* 协议)
    if (rawText === "/goal") {
      setShowGoalModal(true);
      setPromptInput("");
      return;
    }

    const effectiveRawText = rawText;
    if (rawText.startsWith("/goal ") && handleLaunchGoalRef.current) {
      const goalObjective = rawText.slice(6).trim();
      if (goalObjective) {
        setPromptInput("");
        await handleLaunchGoalRef.current({
          objective: goalObjective,
          maxTurns: 0,
          autoVerifyCommand: "",
          autoContinue: true,
          useWorktree: false,
        });
        return;
      }
    }

    const attachmentContext =
      attachedFiles.length > 0
        ? attachedFiles.map((f) => `[附加文件: ${f.path}]`).join("\n") + "\n"
        : "";
    const text = `${attachmentContext}${effectiveRawText}`.trim();

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
          expectedTurnId: activeTurnIdRef.current,
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
      // AskForApproval: untrusted | on-request | granular | never
      const approvalPolicy =
        permissionMode === "full" ? "never" : "on-request";
      // ApprovalsReviewer: user | auto_review | guardian_subagent
      const approvalsReviewer =
        permissionMode === "auto" ? "auto_review" : "user";
      const sandboxPolicy =
        permissionMode === "full"
          ? { type: "dangerFullAccess" }
          : { type: "workspaceWrite", networkAccess: sessionAllowNetwork };

      let currentThreadId = activeThreadId;
      if (!currentThreadId) {
        const startRes = await callAppServer<any>("thread/start", {
          cwd: targetCwd || undefined,
          model: selectedModelId,
          approvalPolicy,
          approvalsReviewer,
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

      // 计划模式：走真实 thread/settings/update（新会话也在首个 turn 前应用）
      if (planMode && currentThreadId) {
        try {
          await applyCollaborationMode(currentThreadId, true);
        } catch (planErr) {
          console.warn("apply plan collaboration mode failed:", planErr);
        }
      }

      const turnRes = await callAppServer<any>("turn/start", {
        threadId: currentThreadId,
        cwd: targetCwd || undefined,
        input: [{ type: "text", text }],
        model: selectedModelId,
        effort: reasoningEffort === "extra_high" ? "xhigh" : reasoningEffort,
        approvalPolicy,
        approvalsReviewer,
        sandboxPolicy,
        serviceTier: fastMode ? "priority" : null,
      });
      const startedTurnId =
        turnRes?.turn?.id || turnRes?.turnId || turnRes?.id || null;
      if (startedTurnId) setActiveTurnId(String(startedTurnId));
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

  // ── Thread Goal（官方 thread/goal/*，服务端驱动自主推进）──
  const syncGoalFromServer = useCallback((goal: ThreadGoal | null) => {
    setServerGoal(goal);
    setActiveGoal((prev) => {
      if (!goal) return null;
      const statusMap: Record<string, ActiveGoalSession["status"]> = {
        active: "running",
        paused: "paused",
        complete: "completed",
      };
      const viewStatus = statusMap[goal.status] ?? "paused";
      return {
        id: `goal-${goal.threadId}`,
        threadId: goal.threadId,
        objective: goal.objective,
        status: viewStatus,
        currentTurn: prev?.currentTurn ?? 1,
        maxTurns: 0,
        autoVerifyCommand: prev?.autoVerifyCommand ?? "",
        verificationStatus: prev?.verificationStatus ?? "idle",
        verificationOutput: prev?.verificationOutput,
        steps: prev?.steps ?? [],
        autoContinue: true,
        countdownRemaining: null,
        createdAt: goal.createdAt * 1000,
        updatedAt: goal.updatedAt * 1000,
      };
    });
  }, []);

  const refreshThreadGoal = useCallback(
    async (threadId?: string | null) => {
      const tid = threadId ?? activeThreadIdRef.current;
      if (!tid) {
        syncGoalFromServer(null);
        return null;
      }
      try {
        const goal = await goalGet(tid);
        if (tid === activeThreadIdRef.current) syncGoalFromServer(goal);
        return goal;
      } catch (e) {
        console.warn("thread/goal/get failed:", e);
        return null;
      }
    },
    [syncGoalFromServer]
  );

  // 本地验证命令（服务端 goal 协议不含 verify 字段，保留为可选本地工具）
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

  /** 继续推进：官方约定发送 `/goal <objective>` 作为续跑提示 */
  const triggerNextGoalTurn = useCallback(() => {
    const objective =
      serverGoalRef.current?.objective || activeGoalRef.current?.objective || "";
    if (!objective.trim()) return;
    void handleSendMessage(buildGoalPrompt(objective));
  }, [handleSendMessage]);

  const handleGoalTurnFinished = useCallback(
    async (currentGoal: ActiveGoalSession) => {
      // 服务端负责自主续跑；客户端只同步展示（步骤解析 + 服务端状态回读）
      const lastAssistantTurn = [...turns]
        .reverse()
        .find((t) => t.items.some((i) => i.type === "agentMessage"));
      const lastText = lastAssistantTurn
        ? lastAssistantTurn.items.map(extractTextFromItem).join("\n")
        : "";
      const parsedSteps = extractChecklistFromText(lastText);
      if (parsedSteps.length > 0) {
        setActiveGoal((prev) => (prev ? { ...prev, steps: parsedSteps } : null));
      }

      const refreshed = await refreshThreadGoal();
      if (refreshed?.status === "complete") {
        playNotificationChime("done");
        setInboxItems((prev) => [
          {
            id: `goal-done-${Date.now()}`,
            title: "🎯 目标已完成",
            subtitle: refreshed.objective || currentGoal.objective,
            kind: "goal",
            threadId: activeThreadId || undefined,
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ]);
        setServerGoal(null);
      }
    },
    [turns, refreshThreadGoal, activeThreadId]
  );

  useEffect(() => {
    handleGoalTurnFinishedRef.current = handleGoalTurnFinished;
  }, [handleGoalTurnFinished]);

  const handleLaunchGoal = useCallback(
    async (config: GoalSetupConfig) => {
      const objective = config.objective.trim();
      if (!objective) return;
      if (config.useWorktree) setUseWorktree(true);
      try {
        let threadId = activeThreadIdRef.current;
        if (!threadId) {
          const startRes = await callAppServer<any>("thread/start", {
            cwd: activeWorkspace?.path || undefined,
            model: selectedModelId,
            approvalPolicy: permissionMode === "full" ? "never" : "on-request",
            approvalsReviewer: permissionMode === "auto" ? "auto_review" : "user",
            sandbox:
              permissionMode === "full" ? "danger-full-access" : "workspace-write",
          });
          threadId = startRes?.threadId || startRes?.thread?.id || null;
          if (!threadId) throw new Error("无法为目标创建会话");
          setActiveThreadId(threadId);
          setActiveRoute("thread");
          refreshThreads();
        }
        const goal = await goalSet(threadId, { objective, status: "active" });
        syncGoalFromServer(goal ?? (await goalGet(threadId)));
        setShowGoalModal(false);
        await handleSendMessage(buildGoalPrompt(objective));
        showAppToast("🎯 已启动服务端自主目标", "success");
      } catch (e: any) {
        showAppToast(`启动目标失败：${e?.message || e}`, "error");
      }
    },
    [
      activeWorkspace?.path,
      selectedModelId,
      permissionMode,
      refreshThreads,
      syncGoalFromServer,
      handleSendMessage,
      showAppToast,
    ]
  );

  useEffect(() => {
    handleLaunchGoalRef.current = handleLaunchGoal;
  }, [handleLaunchGoal]);

  const handleGoalPause = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    if (!tid) return;
    try {
      const goal = await goalSet(tid, { status: "paused" });
      syncGoalFromServer(goal);
      showAppToast("目标已暂停", "info");
    } catch (e: any) {
      showAppToast(`暂停目标失败：${e?.message || e}`, "error");
    }
  }, [syncGoalFromServer, showAppToast]);

  const handleGoalResume = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    if (!tid) return;
    try {
      const goal = await goalSet(tid, { status: "active" });
      syncGoalFromServer(goal);
      const objective = goal?.objective || activeGoalRef.current?.objective || "";
      if (objective) await handleSendMessage(buildGoalPrompt(objective));
      showAppToast("目标已恢复", "success");
    } catch (e: any) {
      showAppToast(`恢复目标失败：${e?.message || e}`, "error");
    }
  }, [syncGoalFromServer, handleSendMessage, showAppToast]);

  const handleGoalAbort = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    try {
      if (tid) await goalClear(tid);
    } catch (e) {
      console.warn("thread/goal/clear failed:", e);
    }
    syncGoalFromServer(null);
    setServerGoal(null);
    setGoalCountdown(null);
    showAppToast("目标已清除", "info");
  }, [syncGoalFromServer, showAppToast]);

  const handleSetupWindowsSandbox = useCallback(async () => {
    setSandboxSettingUp(true);
    try {
      await callAppServer("windowsSandbox/setupStart", {});
      showAppToast("已开始安装 Windows 沙箱，完成后会自动提示", "info");
    } catch (e: any) {
      showAppToast(`启动沙箱安装失败：${e?.message || e}`, "error");
    } finally {
      setSandboxSettingUp(false);
    }
  }, [showAppToast]);

  const handleInterruptTurn = useCallback(async () => {
    if (!activeThreadId) {
      setIsStreaming(false);
      return;
    }
    try {
      const turnId = activeTurnIdRef.current;
      if (turnId) {
        await callAppServer("turn/interrupt", {
          threadId: activeThreadId,
          turnId,
        });
      }
    } catch (e) {
      console.warn("turn/interrupt failed:", e);
    }
    // 不在这里强制 setIsStreaming(false)：真实状态由 turn/completed 通知驱动
  }, [activeThreadId]);

  const handleSteerTurn = useCallback(
    async (text: string) => {
      if (!activeThreadId || !text.trim()) return;
      try {
        await callAppServer("turn/steer", {
          threadId: activeThreadId,
          expectedTurnId: activeTurnIdRef.current,
          input: [{ type: "text", text: text.trim() }],
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
        console.warn("turn/steer failed, falling back to server queue:", e);
        try {
          await callAppServer("thread/queue/add", {
            threadId: activeThreadId,
            clientUserMessageId: `ctn-${Date.now()}`,
            input: [{ type: "text", text: text.trim() }],
          });
          await refreshThreadQueue(activeThreadId);
        } catch (queueErr) {
          console.warn("thread/queue/add failed, keep local queue:", queueErr);
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
      }
    },
    [activeThreadId]
  );

  const handleRespondServerRequest = useCallback(
    async (requestId: any, result: any) => {
      setPendingRequests((prev) =>
        prev.filter((r) => String(r.id) !== String(requestId))
      );
      try {
        await tauriInvoke("app_server_respond", {
          id: requestId,
          result,
          error: null,
        });
      } catch (e) {
        console.error("Failed to respond to server request:", e);
      }
    },
    []
  );

  const handleRespondServerRequestError = useCallback(
    async (requestId: any, message: string) => {
      setPendingRequests((prev) =>
        prev.filter((r) => String(r.id) !== String(requestId))
      );
      try {
        await tauriInvoke("app_server_respond", {
          id: requestId,
          result: null,
          error: { code: -32000, message },
        });
      } catch (e) {
        console.error("Failed to reject server request:", e);
      }
    },
    []
  );

  // 服务端消息队列（thread/queue/*）同步
  const refreshThreadQueue = useCallback(async (threadId?: string | null) => {
    const tid = threadId ?? activeThreadIdRef.current;
    if (!tid) {
      setFollowupQueue([]);
      return;
    }
    try {
      const res = await callAppServer<{ data?: any[] }>("thread/queue/list", {
        threadId: tid,
      });
      const items = Array.isArray(res?.data) ? res.data : [];
      setFollowupQueue(
        items.map((item) => {
          const textPart = Array.isArray(item?.input)
            ? item.input.find((i: any) => typeof i?.text === "string")
            : null;
          return {
            id: String(item?.id ?? item?.clientUserMessageId ?? `q-${Math.random()}`),
            text: String(textPart?.text ?? ""),
            mode: "queue" as const,
            createdAt: Date.now(),
          };
        })
      );
    } catch (e) {
      console.warn("thread/queue/list failed:", e);
    }
  }, []);

  const handleStartServerQueue = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    if (!tid) return;
    try {
      await callAppServer("thread/queue/start", { threadId: tid });
    } catch (e) {
      console.warn("thread/queue/start failed:", e);
    }
  }, []);

  // turn 结束后由服务端启动队列中的下一条消息
  const queueAutoStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isStreaming && followupQueue.length > 0 && activeThreadId) {
      const key = `${activeThreadId}:${followupQueue.map((q) => q.id).join(",")}`;
      if (queueAutoStartRef.current === key) return;
      queueAutoStartRef.current = key;
      void handleStartServerQueue();
    }
  }, [isStreaming, followupQueue, activeThreadId, handleStartServerQueue]);

  // 切换会话时载入该会话的服务端队列
  useEffect(() => {
    if (activeThreadId) void refreshThreadQueue(activeThreadId);
    else setFollowupQueue([]);
  }, [activeThreadId, refreshThreadQueue]);

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
    } else if (action === "new_chat") {
      startNewThread();
    } else if (action === "fork_thread") {
      handleForkThread();
    } else if (action === "rename_thread") {
      setThreadTitleInput(
        activeThreadObj?.name || activeThreadObj?.preview || "本地聊天"
      );
      setEditingThreadTitle(true);
    } else if (action === "archive_thread") {
      if (activeThreadObj) handleArchiveThread(activeThreadObj, {} as any);
    } else if (action === "toggle_thread_pin") {
      if (activeThreadId) handleTogglePinThread(activeThreadId, {} as any);
    } else if (action === "toggle_pet") {
      setPetVisible((v) => !v);
    } else if (action === "open_usage_settings" || action === "show_status") {
      setShowUsagePopover(true);
    } else if (action === "open_model_picker") {
      setShowSessionParamsPopover(false);
      composerTextareaRef.current?.focus();
    } else if (action === "open_mcp_status") {
      setActiveRoute("plugins");
    } else if (action === "open_project_picker") {
      setActiveRoute("projects");
    } else if (action === "open_memories") {
      setActiveRoute("projects");
    } else if (action === "open_feedback") {
      showAppToast("反馈入口：可在设置 → 常规中查看应用信息", "info");
    } else if (action === "set_followup_queue") {
      setFollowupQueue((prev) => [
        ...prev,
        { id: `q-${Date.now()}`, text: promptInput, mode: "queue", createdAt: Date.now() },
      ]);
      setPromptInput("");
    } else if (action === "set_followup_steer") {
      if (promptInput.trim()) {
        handleSteerTurn(promptInput);
        setPromptInput("");
      }
    } else if (action === "open_side_chat") {
      showAppToast("Side chat 将在后续版本接入", "info");
    } else if (action === "switch_mode_cloud" || action === "switch_mode_local") {
      showAppToast("远程/云端环境将在后续版本接入", "info");
    } else if (action === "open_reasoning_picker" || action === "toggle_ide_context") {
      composerTextareaRef.current?.focus();
    }
  }, [
    startNewThread,
    handleForkThread,
    handleArchiveThread,
    handleTogglePinThread,
    handleSteerTurn,
    activeThreadObj,
    activeThreadId,
    promptInput,
    showAppToast,
    setFollowupQueue,
  ]);

  const threadMenuItems: ThreadActionItem[] = useMemo(() => {
    const pinned = !!(activeThreadId && pinnedThreadIds.includes(activeThreadId));
    return [
      { id: "fork_thread", label: "派生新会话 (Fork)", hint: "保留上下文" },
      {
        id: "fork_from_here",
        label: "从当前轮次派生",
        disabled: !activeTurnId,
      },
      { id: "compact_thread", label: "压缩上下文 (Compact)" },
      { id: "revert_last", label: "回滚最后一个轮次", danger: true },
      { id: "copy_markdown", label: "复制会话 Markdown", separatorBefore: true },
      { id: "export_json", label: "导出会话 JSON" },
      { id: "rename_thread", label: "重命名会话" },
      { id: "toggle_thread_pin", label: pinned ? "取消置顶" : "置顶会话" },
      { id: "new_chat", label: "新建会话" },
      { id: "archive_thread", label: "归档会话", separatorBefore: true },
      { id: "delete_thread", label: "删除会话", danger: true },
    ];
  }, [activeThreadId, activeTurnId, pinnedThreadIds]);

  const handleThreadMenuAction = useCallback(
    async (id: string) => {
      try {
        if (id === "fork_thread") await handleForkThread();
        else if (id === "fork_from_here") await handleForkThread(activeTurnId || undefined);
        else if (id === "compact_thread") await handleCompactThread();
        else if (id === "revert_last") {
          const lastServerTurn = [...turns]
            .reverse()
            .find((t) => /^[0-9a-f]{8}-/i.test(t.id));
          if (lastServerTurn) await handleRevertToTurn(lastServerTurn.id);
        } else if (id === "copy_markdown") {
          const md = turns
            .map((t) => {
              const text = t.items.map(extractTextFromItem).filter(Boolean).join("\n");
              return text ? `${text}\n` : "";
            })
            .join("\n");
          await navigator.clipboard.writeText(md);
          showAppToast("✓ 已复制会话 Markdown", "success");
        } else if (id === "export_json") {
          const blob = new Blob([JSON.stringify(turns, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `codex-thread-${activeThreadId || "local"}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } else if (id === "rename_thread") {
          if (activeThreadId) {
            setThreadTitleInput(
              activeThreadObj?.name || activeThreadObj?.preview || "本地聊天"
            );
            setEditingThreadTitle(true);
          }
        } else if (id === "toggle_thread_pin") {
          if (activeThreadId) await handleTogglePinThread(activeThreadId, {} as any);
        } else if (id === "new_chat") {
          startNewThread();
        } else if (id === "archive_thread") {
          if (activeThreadObj) await handleArchiveThread(activeThreadObj, {} as any);
        } else if (id === "delete_thread") {
          if (activeThreadObj) await handleDeleteThread(activeThreadObj, {} as any);
        }
      } catch (e: any) {
        showAppToast(`操作失败：${e?.message || e}`, "error");
      }
    },
    [
      handleForkThread,
      handleCompactThread,
      handleRevertToTurn,
      handleTogglePinThread,
      handleArchiveThread,
      handleDeleteThread,
      startNewThread,
      activeTurnId,
      activeThreadId,
      activeThreadObj,
      turns,
      showAppToast,
    ]
  );

  const unreadInboxCount = useMemo(
    () => inboxItems.filter((i) => !i.read).length,
    [inboxItems]
  );

  const projectName =
    activeWorkspace?.label ||
    activeWorkspace?.path?.split(/[/\\]/).pop() ||
    "codex-app-offline";
  const threadStatusChip = describeThreadStatus(activeThreadStatus);

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
        refreshToken={appServerStatus.connected ? 1 : 0}
        onThreadsChanged={refreshThreads}
        onShowToast={showAppToast}
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
                <ThreadActionsMenu
                  items={threadMenuItems}
                  onSelect={handleThreadMenuAction}
                  align="right"
                  buttonClassName="window-chrome-icon-btn"
                />
                {threadStatusChip.label && (
                  <span
                    className={`thread-status-chip tone-${threadStatusChip.tone}`}
                    title={`当前会话状态：${threadStatusChip.label}`}
                  >
                    <span className="thread-status-dot" />
                    {threadStatusChip.label}
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
                    title="查看当前会话上下文用量与额度"
                  >
                    <TokenUsageMeter variant="compact" usage={tokenUsage} />
                    <span>用量</span>
                  </button>

                  {showUsagePopover && (
                    <div
                      className="usage-popover-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="usage-popover-header">
                        <strong>用量与额度</strong>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setShowUsagePopover(false)}
                        >
                          ✕
                        </button>
                      </div>
                      {accountInfo?.email || accountInfo?.account?.email ? (
                        <div className="usage-stat-row">
                          <span>账号:</span>
                          <span className="ellipsis" title={accountInfo?.email || accountInfo?.account?.email}>
                            {accountInfo?.email || accountInfo?.account?.email}
                          </span>
                        </div>
                      ) : null}
                      {(accountInfo?.planType || accountInfo?.account?.planType) && (
                        <div className="usage-stat-row">
                          <span>套餐:</span>
                          <span>{accountInfo?.planType || accountInfo?.account?.planType}</span>
                        </div>
                      )}
                      <div className="usage-stat-row">
                        <span>模型:</span>
                        <code>{selectedModelId}</code>
                      </div>
                      <div className="usage-stat-row">
                        <span>推理级别:</span>
                        <span>{reasoningEffort}</span>
                      </div>
                      <TokenUsageMeter
                        variant="popover"
                        usage={tokenUsage}
                        rateLimits={rateLimits}
                      />
                      <div className="usage-stat-row">
                        <span>本轮 turn:</span>
                        <span>{turns.length} 轮（本地记录）</span>
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
                    title="查看会话运行参数（采样参数由服务端决定，不可逐会话覆盖）"
                  >
                    <span>⚙️ 参数</span>
                  </button>

                  {showSessionParamsPopover && (
                    <div
                      className="session-params-popover-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="session-params-popover-header">
                        <strong>会话运行参数</strong>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setShowSessionParamsPopover(false)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="session-params-notice">
                        ⚠️ 模型、推理档位、权限策略会随每次 turn 发送到 Codex 服务端；
                        采样参数（temperature / top_p / max_tokens 等）由服务端模型决定，
                        app-server 协议不接受逐会话覆盖，以下调节不会生效。
                      </div>
                      <div className="usage-stat-row">
                        <span>模型:</span>
                        <code>{selectedModelId}</code>
                      </div>
                      <div className="usage-stat-row">
                        <span>推理档位:</span>
                        <span>{reasoningEffort}</span>
                      </div>
                      <div className="usage-stat-row">
                        <span>速度档位:</span>
                        <span>{fastMode ? "Fast (priority)" : "Standard"}</span>
                      </div>
                      <div className="usage-stat-row">
                        <span>权限策略:</span>
                        <span>
                          {permissionMode === "full"
                            ? "never / danger-full-access"
                            : permissionMode === "auto"
                            ? "on-request / auto_review"
                            : "on-request / user"}
                        </span>
                      </div>
                      <div className="usage-stat-row">
                        <span>沙盒:</span>
                        <span>{useWorktree ? "Worktree 隔离" : "工作区可写"}</span>
                      </div>
                      <div className="usage-stat-row">
                        <span>计划模式:</span>
                        <span>{planMode ? "开启" : "关闭"}</span>
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
                          前往完整设置中心配置默认参数 →
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

        {/* Windows 沙箱就绪提示 */}
        {sandboxNotice && (
          <div className="sandbox-notice-banner">
            <span className="sandbox-notice-text">
              ⚠️ Windows 沙箱未就绪（{sandboxNotice}）：Codex 命令将在降级模式下执行。
            </span>
            <button
              type="button"
              className="btn-approve"
              disabled={sandboxSettingUp}
              onClick={handleSetupWindowsSandbox}
            >
              {sandboxSettingUp ? "正在启动…" : "安装沙箱"}
            </button>
            <button
              type="button"
              className="mini-link-btn"
              onClick={() => setSandboxNotice(null)}
            >
              忽略
            </button>
          </div>
        )}

        {/* Persistent Autonomous Goal Banner */}
        {activeGoal && (activeRoute === "thread" || activeRoute === "home") && (
          <GoalProgressBanner
            goal={activeGoal}
            isStreaming={isStreaming}
            countdown={goalCountdown}
            onPause={handleGoalPause}
            onResume={handleGoalResume}
            onAbort={handleGoalAbort}
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
        {activeRoute === "review" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <CodeReviewView
                workspacePath={activeWorkspace?.path}
                branches={gitBranches}
                defaultBranch={gitStatus?.defaultBranch || "main"}
                commits={gitCommits}
                busy={reviewBusy}
                lastResult={reviewLastResult}
                onStartReview={handleStartCodeReview}
                onBack={() => setActiveRoute(turns.length > 0 ? "thread" : "home")}
              />
            </div>
          </div>
        ) : activeRoute === "projects" ? (
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
            refreshToken={appServerStatus.connected ? 1 : 0}
            onProjectsChanged={refreshThreads}
            onThreadsChanged={refreshThreads}
            onShowToast={showAppToast}
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
              onTogglePlanMode={handleTogglePlanMode}
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
                  const planItems = turn.items.filter((i) => i.type === "plan");
                  const mcpCalls = turn.items.filter((i) => i.type === "mcpToolCall");
                  const webSearches = turn.items.filter((i) => i.type === "webSearch");
                  const imageViews = turn.items.filter(
                    (i) => i.type === "imageView" || i.type === "imageGeneration"
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
                              {thoughts.map(extractReasoningText).join("\n\n")}
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

                      {fileChanges.map((fc, fIdx) => {
                        const changes: any[] = Array.isArray(fc.changes)
                          ? fc.changes
                          : [];
                        let additions = 0;
                        let deletions = 0;
                        for (const change of changes) {
                          const counted = countDiffLines(String(change?.diff || ""));
                          additions += counted.additions;
                          deletions += counted.deletions;
                        }
                        const primaryPath = changes[0]?.path || fc.path || "";
                        const summaryText =
                          changes.length > 1
                            ? `${changes[0]?.path || "文件"} 等 ${changes.length} 个文件`
                            : primaryPath || "Modified file";
                        const kind = changes[0]?.kind;
                        return (
                          <div
                            key={fc.id || fIdx}
                            className="file-change-card"
                            onClick={() => {
                              if (primaryPath) {
                                setSelectedPreviewFile(primaryPath);
                                setShowRightDrawer(true);
                              }
                            }}
                          >
                            <div className="file-change-left">
                              <DiffIcon size={15} />
                              <span title={changes.map((c: any) => c?.path).filter(Boolean).join("\n")}>
                                {summaryText}
                              </span>
                              {kind && (
                                <span className={`file-change-kind kind-${kind}`}>
                                  {kind}
                                </span>
                              )}
                            </div>
                            <span className="diff-stats-badge">
                              <span className="diff-plus">+{additions}</span>{" "}
                              <span className="diff-minus">-{deletions}</span>
                            </span>
                          </div>
                        );
                      })}

                      {planItems.map((plan, pIdx) => (
                        <div key={plan.id || pIdx} className="plan-inline-card">
                          <div className="plan-inline-header">
                            <BrainIcon size={13} />
                            <span>执行计划</span>
                          </div>
                          <pre className="plan-inline-body">
                            {extractTextFromItem(plan)}
                          </pre>
                        </div>
                      ))}

                      {mcpCalls.map((call, mcIdx) => {
                        const status = String(call.status || "completed");
                        const resultText =
                          typeof call.result === "string"
                            ? call.result
                            : call.result != null
                            ? JSON.stringify(call.result, null, 2)
                            : "";
                        return (
                          <div key={call.id || mcIdx} className="mcp-call-card">
                            <div className="mcp-call-header">
                              <SparklesIcon size={13} />
                              <span className="mcp-call-tool">
                                {call.server ? `${call.server} · ` : ""}
                                {call.tool || "MCP 工具"}
                              </span>
                              <span className={`mcp-call-status status-${status}`}>
                                {status === "inProgress"
                                  ? "调用中…"
                                  : status === "failed"
                                  ? "失败"
                                  : status === "completed"
                                  ? "完成"
                                  : status}
                              </span>
                            </div>
                            {resultText && (
                              <pre className="mcp-call-result">{resultText}</pre>
                            )}
                            {call.error && (
                              <div className="mcp-call-error">{String(call.error)}</div>
                            )}
                          </div>
                        );
                      })}

                      {webSearches.map((search, wsIdx) => {
                        const results: any[] = Array.isArray(search.results)
                          ? search.results
                          : [];
                        return (
                          <div key={search.id || wsIdx} className="web-search-card">
                            <div className="web-search-header">
                              <span>🔎 联网搜索</span>
                              <span className="web-search-query">
                                {search.query || ""}
                              </span>
                            </div>
                            {results.slice(0, 5).map((r: any, rIdx: number) => (
                              <div key={rIdx} className="web-search-result">
                                {r?.title || r?.url || "结果"}
                              </div>
                            ))}
                          </div>
                        );
                      })}

                      {imageViews.map((img, imIdx) => {
                        const path = img.path || img.savedPath || "";
                        return (
                          <div
                            key={img.id || imIdx}
                            className="image-item-card"
                            onClick={() => {
                              if (path) {
                                setSelectedPreviewFile(path);
                                setShowRightDrawer(true);
                              }
                            }}
                          >
                            <span>🖼️ {img.type === "imageView" ? "查看图片" : "生成图片"}</span>
                            <span className="mono ellipsis" title={path}>
                              {path.split(/[/\\]/).pop() || ""}
                            </span>
                          </div>
                        );
                      })}

                      {messages.map((msg, mIdx) => (
                        <MarkdownView
                          key={msg.id || mIdx}
                          content={extractTextFromItem(msg)}
                          onRunCommand={(cmd) => {
                            setShowTerminal(true);
                            setPendingTermCommand({ id: Date.now(), command: cmd });
                          }}
                          onOpenFile={(filePath) => {
                            setSelectedPreviewFile(filePath);
                            setShowRightDrawer(true);
                          }}
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
                          {/^[0-9a-f]{8}-/i.test(turn.id) && (
                            <button
                              type="button"
                              className="turn-action-mini-btn"
                              title="回滚到本轮之前（丢弃本轮及其之后的改动）"
                              onClick={() => handleRevertToTurn(turn.id)}
                            >
                              ⏪ 回滚到此
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {autoReview && (
                  <div
                    className={`auto-review-banner ${
                      autoReview.active ? "active" : "done"
                    }`}
                  >
                    <span className="auto-review-dot" />
                    {autoReview.active
                      ? "自动审批审查中：Auto-review 正在评估本次操作…"
                      : `自动审批已完成${autoReview.decision ? `（${autoReview.decision}）` : ""}`}
                  </div>
                )}

                {planSteps.length > 0 && (
                  <PlanPanel steps={planSteps} defaultCollapsed={false} />
                )}

                {turnDiffFiles.length > 0 && (
                  <TurnDiffPanel
                    files={turnDiffFiles}
                    onOpenFile={(filePath) => {
                      setSelectedPreviewFile(filePath);
                      setShowRightDrawer(true);
                    }}
                    onRefresh={refreshGitStatus}
                  />
                )}

                {/* Pending Server Requests: approvals / permissions / user input / option picker */}
                <ApprovalCenter
                  requests={pendingRequests}
                  onRespond={handleRespondServerRequest}
                  onRespondError={handleRespondServerRequestError}
                />
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
                      onClick={() => handleStartServerQueue()}
                    >
                      立即发送
                    </button>
                    <button
                      type="button"
                      className="mini-link-btn"
                      onClick={() => handleSteerTurn(followupQueue[0].text)}
                    >
                      引导到当前轮 (Steer)
                    </button>
                    <button
                      type="button"
                      className="mini-link-btn danger"
                      onClick={() => {
                        const item = followupQueue[0];
                        if (activeThreadId && item) {
                          callAppServer("thread/queue/delete", {
                            threadId: activeThreadId,
                            queuedSubmissionId: item.id,
                          })
                            .then(() => refreshThreadQueue(activeThreadId))
                            .catch(() => setFollowupQueue((prev) => prev.slice(1)));
                        } else {
                          setFollowupQueue((prev) => prev.slice(1));
                        }
                      }}
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
                  onTogglePlanMode={handleTogglePlanMode}
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
        workspacePath={activeWorkspace?.path}
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
