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
  ClockIcon,
  CopyIcon,
  ExternalWindowIcon,
  ForkIcon,
  MessagePlusIcon,
  OpenWithIcon,
  PencilIcon,
  PinIcon,
  ShareIcon,
  SlidersIcon,
  SquarePlusIcon,
  EllipsisIcon,
  ArchiveIcon,
  SearchIcon,
  BellIcon,
} from "./components/Icons";
import { ProjectSourcesPopover } from "./components/ProjectSourcesPopover";
import { AppTitleBar } from "./components/AppTitleBar";
import {
  attachmentIdentityKey,
  createAttachedFileItem,
  listThreadAttachments,
  mergeAttachmentItems,
  persistThreadAttachments,
  removeThreadAttachment,
} from "./threadAttachments";
import { callAppServer, tauriInvoke, tauriListen } from "./bridge";
import { matchShortcut, matchRecentThreadIndex } from "./shortcuts";
import { installNativeMenuHandler, installTrayHandler } from "./nativeShell";
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
  InstalledPetItem,
  QueuedFollowupPrompt,
  SettingsSectionSlug,
  SkillInfoItem,
  ThreadSummary,
  TurnData,
  TurnItem,
  WorkspaceFileHit,
  WorkspaceRootItem,
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
import { ArchiveView } from "./components/ArchiveView";
import { ThreadGoalBanner } from "./components/ThreadGoalBanner";
import { ThreadGoalModal } from "./components/ThreadGoalModal";
import { ApprovalCenter } from "./components/ApprovalCenter";
import { PlanPanel } from "./components/PlanPanel";
import { TurnDiffPanel } from "./components/TurnDiffPanel";
import { TokenUsageMeter } from "./components/TokenUsageMeter";
import { ToolCallCards } from "./components/ToolCallCards";
import { TextSelectionToolbar } from "./components/TextSelectionToolbar";
import { HotkeyWindow } from "./components/HotkeyWindow";
import { ImagesView } from "./components/ImagesView";
import { GptsView } from "./components/GptsView";
import { SitesView } from "./components/SitesView";
import { LibraryView } from "./components/LibraryView";
import { CloudEnvironmentsView } from "./components/CloudEnvironmentsView";
import { ThreadActionsMenu, ThreadActionItem } from "./components/ThreadActionsMenu";
import { ThreadFindBar } from "./components/ThreadFindBar";
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
  if (Array.isArray((item as any).parts)) {
    return (item as any).parts
      .map((part: any) => {
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

function mapTurnObject(t: any, idx: number): TurnData {
  return {
    id: t?.id || `turn-${idx}`,
    status: t?.status || "completed",
    startedAt: t?.startedAt || t?.firstTurnWorkItemStartedAtMs || null,
    completedAt: t?.completedAt || null,
    durationMs: t?.durationMs || null,
    items: Array.isArray(t?.items)
      ? t.items.map((it: any) => ({
          ...it,
          text: extractTextFromItem(it),
        }))
      : [],
  };
}

function normalizeTurnsFromThread(threadObj: any): TurnData[] {
  let rawTurns =
    threadObj?.turns ||
    threadObj?.thread?.turns ||
    threadObj?.data ||
    [];
  if (rawTurns && !Array.isArray(rawTurns) && Array.isArray(rawTurns.data)) {
    rawTurns = rawTurns.data;
  }
  if (!Array.isArray(rawTurns)) return [];
  return rawTurns.map(mapTurnObject);
}

/** `thread/turns/list` returns `{data, nextCursor}`（desc 分页时 data 为新→旧）。 */
function normalizeTurnsFromList(page: any, reverse = true): TurnData[] {
  const list = Array.isArray(page?.data) ? page.data : [];
  const ordered = reverse ? list.slice().reverse() : list;
  return ordered.map(mapTurnObject);
}

export const App: React.FC = () => {
  // Primary Route & Shell Layout State
  const [activeRoute, setActiveRoute] = useState<MainViewRoute>("home");
  const [routeHistoryVersion, setRouteHistoryVersion] = useState(0);
  const routeHistoryRef = useRef<{ entries: MainViewRoute[]; index: number }>({
    entries: ["home"],
    index: 0,
  });
  const navigatingRouteHistoryRef = useRef(false);
  useEffect(() => {
    if (navigatingRouteHistoryRef.current) {
      navigatingRouteHistoryRef.current = false;
      return;
    }
    const history = routeHistoryRef.current;
    if (history.entries[history.index] === activeRoute) return;
    history.entries = [...history.entries.slice(0, history.index + 1), activeRoute];
    history.index = history.entries.length - 1;
    setRouteHistoryVersion((version) => version + 1);
  }, [activeRoute]);
  const { canGoBack, canGoForward } = useMemo(() => {
    const history = routeHistoryRef.current;
    return {
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1,
    };
  }, [routeHistoryVersion]);
  const navigateRouteHistory = useCallback((direction: -1 | 1) => {
    const history = routeHistoryRef.current;
    const nextIndex = history.index + direction;
    if (nextIndex < 0 || nextIndex >= history.entries.length) return;
    navigatingRouteHistoryRef.current = true;
    history.index = nextIndex;
    setRouteHistoryVersion((version) => version + 1);
    setActiveRoute(history.entries[nextIndex]);
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activityOnly, setActivityOnly] = useState(false);
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
  const [archiveRefreshTick, setArchiveRefreshTick] = useState<number>(0);

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
  const [turnsCursor, setTurnsCursor] = useState<string | null>(null);
  const [hasMoreTurns, setHasMoreTurns] = useState<boolean>(false);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState<boolean>(false);
  const turnsCursorRef = useRef<string | null>(null);
  turnsCursorRef.current = turnsCursor;
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
  const attachedFilesRef = useRef<AttachedFileItem[]>([]);
  attachedFilesRef.current = attachedFiles;
  const pendingAttachmentSaveRef = useRef<{ threadId: string; clearComposer: boolean } | null>(null);
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
  const [showSourcesPopover, setShowSourcesPopover] = useState<boolean>(false);
  const [initialWorkbenchTab, setInitialWorkbenchTab] = useState<"newTab" | "changes" | "files" | "summary" | "browser" | "sideChat">("changes");
  const [sideChatPrompt, setSideChatPrompt] = useState<string>("");
  const [showPopoutModal, setShowPopoutModal] = useState<boolean>(false);
  const [pinnedSummaryVisible, setPinnedSummaryVisible] = useState<boolean>(false);
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
  const [petScale, setPetScale] = useState<number>(1.0);
  const [installedPets, setInstalledPets] = useState<InstalledPetItem[]>([]);
  const [showQuickSearch, setShowQuickSearch] = useState<boolean>(false);
  const [showFindBar, setShowFindBar] = useState<boolean>(false);
  const [findBarScope, setFindBarScope] = useState<"chat" | "diff">("chat");
  const [bookmarkedTurnIds, setBookmarkedTurnIds] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem("codex_thread_bookmarks") || "{}");
    } catch {
      return {};
    }
  });

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

  const toggleBookmark = useCallback(
    (turnId: string) => {
      if (!activeThreadId) return;
      setBookmarkedTurnIds((prev) => {
        const current = prev[activeThreadId] || [];
        const updated = current.includes(turnId)
          ? current.filter((id) => id !== turnId)
          : [...current, turnId];
        const next = { ...prev, [activeThreadId]: updated };
        try {
          localStorage.setItem("codex_thread_bookmarks", JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      showAppToast("已更新提问收藏状态", "info");
    },
    [activeThreadId, showAppToast]
  );

  const flushPendingAttachmentSave = useCallback(async (threadId: string) => {
    const pending = pendingAttachmentSaveRef.current;
    if (!pending || pending.threadId !== threadId) return;
    pendingAttachmentSaveRef.current = null;
    const files = attachedFilesRef.current;
    if (files.length === 0) {
      if (pending.clearComposer) setPromptInput("");
      return;
    }
    const { errors } = await persistThreadAttachments(threadId, files);
    if (errors.length > 0) {
      showAppToast(`消息已发送，但附件保存失败: ${errors[0].message}`, "error");
      return;
    }
    if (pending.clearComposer) {
      setPromptInput("");
      setAttachedFiles([]);
    }
  }, [showAppToast]);

  // Official Thread Goal State (`thread/goal/*`)
  const [serverGoal, setServerGoal] = useState<ThreadGoal | null>(null);
  const [showGoalModal, setShowGoalModal] = useState<boolean>(false);
  const serverGoalRef = useRef<ThreadGoal | null>(null);
  serverGoalRef.current = serverGoal;
  const handleSaveGoalRef = useRef<((objective: string) => Promise<void>) | null>(null);

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
    const cwd = activeWorkspace.path;

    void Promise.allSettled([
      tauriInvoke<{
        found: boolean;
        path: string | null;
        content: string;
      }>("workspace_agents_md", { cwd }).then((agents) => {
        if (agents) setAgentsMdInfo(agents);
      }),
      tauriInvoke<DirectoryEntryItem[]>("fs_list_dir", {
        path: cwd,
        showHidden: false,
      }).then((entries) => {
        if (entries) setWorkspaceFiles(entries.map((e) => e.name || e.path));
      }),
      tauriInvoke<SkillInfoItem[]>("skills_list_local", {
        workspaceRoot: cwd,
      }).then((skillList) => {
        if (Array.isArray(skillList)) setSkills(skillList);
      }),
      tauriInvoke<ProjectScriptCommands>("detect_project_scripts", {
        cwd,
      }).then((scripts) => {
        if (scripts) setProjectScripts(scripts);
      }),
    ]);

    const timer = window.setTimeout(() => {
      tauriInvoke<WorkspaceFileHit[]>("fs_search_files", {
        cwd,
        query: null,
        limit: 80,
      })
        .then((hits) => {
          if (Array.isArray(hits)) setWorkspaceFileHits(hits);
        })
        .catch(() => {});
    }, 120);

    return () => window.clearTimeout(timer);
  }, [activeWorkspace?.path]);

  // 4. Refresh Threads & Models from codex app-server
  const refreshThreads = useCallback(async () => {
    try {
      let res = await callAppServer<{
        data?: ThreadSummary[];
        threads?: ThreadSummary[];
      }>("thread/list", { limit: 100, useStateDbOnly: true });
      let list = res?.data || res?.threads || (Array.isArray(res) ? res : []);
      if (!list || list.length === 0) {
        try {
          res = await callAppServer<any>("thread/list", { limit: 50 });
          list = res?.data || res?.threads || (Array.isArray(res) ? res : []);
        } catch {
          // ignore fallback error
        }
      }
      setThreads(list);
    } catch (e) {
      console.warn("thread/list with useStateDbOnly failed, falling back:", e);
      try {
        const res = await callAppServer<any>("thread/list", { limit: 50 });
        const list = res?.data || res?.threads || (Array.isArray(res) ? res : []);
        setThreads(list);
      } catch {
        // ignore
      }
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

  const refreshInstalledPets = useCallback(async () => {
    try {
      const list = await tauriInvoke<InstalledPetItem[]>("pets_list_installed");
      if (Array.isArray(list) && list.length > 0) {
        setInstalledPets(list);
        setSelectedPetSpecies((prev) => {
          if (!prev || prev === "codex") return list[0].id;
          return prev;
        });
      }
    } catch (e) {
      console.warn("pets_list_installed failed:", e);
    }
  }, []);

  // 通知偏好（桌面系统通知 / 提示音 / 审批提醒）
  const [notifyPrefs, setNotifyPrefs] = useState<{
    desktop: boolean;
    sound: boolean;
    approval: boolean;
  }>({ desktop: true, sound: true, approval: true });
  const notifyPrefsRef = useRef(notifyPrefs);
  notifyPrefsRef.current = notifyPrefs;
  const applyNotifyPrefs = useCallback((prefs: any) => {
    if (!prefs || typeof prefs !== "object") return;
    const next = {
      desktop: prefs.desktopNotifications !== false,
      sound: prefs.notificationSound !== false,
      approval: prefs.notifyOnApproval !== false,
    };
    setNotifyPrefs(next);
    notifyPrefsRef.current = next;
  }, []);
  const sendDesktopNotification = useCallback((title: string, body: string) => {
    if (!notifyPrefsRef.current.desktop) return;
    const hidden = typeof document !== "undefined" ? document.hidden : false;
    if (!hidden) return; // 窗口在前台时不弹系统通知，避免打扰
    tauriInvoke("show_desktop_notification", { title, body }).catch(() => {});
  }, []);
  const notifyChime = useCallback((kind: "nudge" | "done" = "done") => {
    if (!notifyPrefsRef.current.sound) return;
    playNotificationChime(kind);
  }, []);

  // Connect & Subscribe to App-Server Events on Mount
  useEffect(() => {
    refreshWorkspacesAndMeta();
    refreshConfigOverview();
    refreshInstalledPets();

    tauriInvoke<any>("desktop_state_get", { key: "desktopPreferences" })
      .then((prefs) => {
        if (prefs && typeof prefs === "object") {
          if (prefs.customPersonaPrompt) setCustomInstructions(prefs.customPersonaPrompt);
          if (prefs.toneStyle) setToneStyle(prefs.toneStyle);
          if (prefs.petVisible !== undefined) setPetVisible(prefs.petVisible);
          if (prefs.selectedPetSpecies) setSelectedPetSpecies(prefs.selectedPetSpecies);
          if (prefs.petScale) setPetScale(prefs.petScale);
          applyNotifyPrefs(prefs);
        }
      })
      .catch(() => {});

    // 设置页保存通知偏好后即时生效（同源 window 事件）
    const onPrefsChanged = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail && typeof detail === "object") {
        if (detail.petVisible !== undefined) setPetVisible(detail.petVisible);
        if (detail.selectedPetSpecies) setSelectedPetSpecies(detail.selectedPetSpecies);
        if (detail.petScale) setPetScale(detail.petScale);
        applyNotifyPrefs(detail);
      }
    };
    window.addEventListener("codex-prefs-changed", onPrefsChanged);
    // 挂载后立即读取一次应用内通知设置（防止首轮 prefs 读取竞态）
    return () => {
      window.removeEventListener("codex-prefs-changed", onPrefsChanged);
    };
  }, [applyNotifyPrefs]);

  // 旧的挂载副作用（确保只执行一次）
  useEffect(() => {
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
          void flushPendingAttachmentSave(params.threadId);
        } else if (method === "turn/completed") {
          setIsStreaming(false);
          notifyChime("done");
          sendDesktopNotification(
            "Codex 回复已完成",
            activeThreadObj?.name || activeThreadObj?.preview || "本轮任务已完成"
          );
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

          // Check official thread goal completion
          if (serverGoalRef.current) {
            const tid = activeThreadIdRef.current;
            if (tid) {
              goalGet(tid).then((g) => {
                if (tid === activeThreadIdRef.current) {
                  setServerGoal(g);
                  if (g?.status === "complete") {
                    notifyChime("done");
                    showAppToast("🎯 目标已达成 (Goal achieved)", "success");
                  }
                }
              }).catch(() => {});
            }
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
          const statusType = params?.status?.type ?? params?.status;
          const status = params?.status && typeof params.status === "object"
            ? params.status
            : statusType;
          if (tid) {
            setThreads((prev) =>
              prev.map((t) => (t.id === tid ? { ...t, status } : t))
            );
            if (tid === activeThreadIdRef.current) {
              setActiveThreadStatus({
                type: String(statusType ?? "idle"),
                activeFlags: Array.isArray(params?.status?.activeFlags)
                  ? params.status.activeFlags
                  : [],
              });
            }
          }
        } else if (method === "thread/attachment/updated") {
          const threadId = params?.threadId;
          if (
            threadId === activeThreadIdRef.current &&
            ["file", "image", "localImage"].includes(params?.attachmentType)
          ) {
            if (params.operation === "deleted") {
              setAttachedFiles((prev) => prev.filter(
                (file) => attachmentIdentityKey(file.path) !== params.identityKey
              ));
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
              setServerGoal(goal);
              if (goal.status === "complete") {
                notifyChime("done");
                showAppToast("🎯 目标已达成 (Goal achieved)", "success");
              }
            }
          }
        } else if (method === NOTIFICATION.THREAD_GOAL_CLEARED) {
          const tid = params?.threadId;
          if (!tid || tid === activeThreadIdRef.current) {
            setServerGoal(null);
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
        } else if (method === NOTIFICATION.DEPRECATION_NOTICE) {
          // Internal RPC protocol deprecation notice from app-server; log only, do not toast
          const msg = params?.summary || params?.message || (typeof params === "string" ? params : JSON.stringify(params));
          console.warn("[app-server deprecationNotice]", msg);
        } else if (
          method === NOTIFICATION.WARNING ||
          method === NOTIFICATION.CONFIG_WARNING ||
          method === NOTIFICATION.GUARDIAN_WARNING
        ) {
          const msg = params?.summary || params?.message || (typeof params === "string" ? params : JSON.stringify(params));
          console.warn(`[${method}]`, msg);
          showAppToast(`⚠️ ${msg}`, "info");
        } else if (method === NOTIFICATION.ERROR) {
          const msg = params?.summary || params?.message || (typeof params === "string" ? params : JSON.stringify(params));
          console.error("[app-server error]", msg);
          showAppToast(`❌ ${msg}`, "error");
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
        if (notifyPrefsRef.current.approval) {
          sendDesktopNotification(
            "Codex 需要你的批准",
            req.params?.command ? `$ ${req.params.command}` : req.method
          );
        }
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

  // 自动化调度器事件 → Toast + Inbox + 刷新会话列表
  useEffect(() => {
    let disposed = false;
    const offStarted = tauriListen<any>("automation:run-started", (payload) => {
      if (disposed) return;
      showAppToast(
        `▶ 正在运行自动化：${payload?.name || payload?.id || ""}`,
        "info"
      );
    });
    const offFinished = tauriListen<any>("automation:run-finished", (payload) => {
      if (disposed) return;
      const ok = payload?.status === "completed";
      const name = payload?.name || payload?.id || "自动化任务";
      showAppToast(
        ok ? `✓ 自动化已完成：${name}` : `自动化失败：${name}`,
        ok ? "success" : "error"
      );
      sendDesktopNotification(
        ok ? `自动化已完成：${name}` : `自动化失败：${name}`,
        payload?.error ? String(payload.error) : "定时任务执行结束"
      );
      setInboxItems((prev) =>
        [
          {
            id: `automation-${payload?.id || "task"}-${Date.now()}`,
            title: ok ? `自动化已完成：${name}` : `自动化失败：${name}`,
            subtitle: payload?.error ? String(payload.error) : "",
            kind: "automation" as const,
            threadId: payload?.threadId || undefined,
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ].slice(0, 100)
      );
      refreshThreads();
    });
    return () => {
      disposed = true;
      offStarted.then((f) => f()).catch(() => {});
      offFinished.then((f) => f()).catch(() => {});
    };
  }, [showAppToast, refreshThreads]);

  // Code Review：进入页面时加载最近提交，供“指定提交”选择
  useEffect(() => {
    if (activeRoute !== "review") return;
    const cwd = activeWorkspace?.path;
    if (!cwd) return;
    tauriInvoke<GitCommitInfo[]>("git_log_commits", { cwd, limit: 30 })
      .then((commits) => setGitCommits(Array.isArray(commits) ? commits : []))
      .catch(() => setGitCommits([]));
  }, [activeRoute, activeWorkspace?.path]);

  // Global keyboard shortcuts（注册表见 src/shortcuts.ts，与原生菜单 accelerator 对齐）
  // 实际动作绑定在下方 shortcutHandlersRef，避免闭包/声明顺序问题。
  const shortcutHandlersRef = useRef<Record<string, (arg?: any) => void>>({});
  const shortcutTimestampsRef = useRef<Record<string, number>>({});
  const threadsRef = useRef<ThreadSummary[]>([]);
  threadsRef.current = threads;
  const workspacesRef = useRef<WorkspaceRootItem[]>([]);
  workspacesRef.current = workspaces;
  const workspaceHintsRef = useRef<Record<string, string>>({});
  workspaceHintsRef.current = workspaceHints;

  /**
   * 统一分发快捷键动作，并去重：原生菜单 accelerator 与 webview keydown
   * 可能对同一次按键各触发一次（toggle 类动作会互相抵消）。
   */
  const runShortcutAction = useCallback((id: string, arg?: any) => {
    const now = Date.now();
    const last = shortcutTimestampsRef.current[id] || 0;
    if (now - last < 250) return;
    shortcutTimestampsRef.current[id] = now;
    shortcutHandlersRef.current[id]?.(arg);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const recentIndex = matchRecentThreadIndex(e);
      if (recentIndex !== null) {
        const target = threadsRef.current[recentIndex];
        if (target) {
          e.preventDefault();
          runShortcutAction("open-recent-thread", target.id);
        }
        return;
      }

      const shortcutId = matchShortcut(e);
      if (!shortcutId) return;
      e.preventDefault();
      runShortcutAction(shortcutId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runShortcutAction]);

  // Auto-scroll timeline
  useEffect(() => {
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
    }
  }, [turns, isStreaming]);

  // Workspace Actions
  const handleSelectWorkspace = useCallback(async (path: string) => {
    // Optimistic active workspace update
    setWorkspaces((prev) =>
      prev.map((w) => ({
        ...w,
        active: w.path.replace(/\\/g, "/").toLowerCase() === path.replace(/\\/g, "/").toLowerCase(),
      }))
    );
    try {
      const updated = await tauriInvoke<WorkspaceRootItem[]>(
        "workspace_set_active",
        { path }
      );
      if (Array.isArray(updated) && updated.length > 0) {
        setWorkspaces(updated);
      }
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

  const handleAttachFiles = useCallback(async () => {
    try {
      const files = await tauriInvoke<string[]>("pick_files_dialog");
      if (Array.isArray(files) && files.length > 0) {
        const additions = files.map((path) => createAttachedFileItem(path));
        setAttachedFiles((prev) => mergeAttachmentItems(prev, additions));
      }
    } catch (e) {
      console.warn("pick_files_dialog failed:", e);
    }
  }, []);

  const handleAppshot = useCallback(async () => {
    try {
      showAppToast("正在捕获屏幕快照…", "info");
      const res = await tauriInvoke<{ path: string; name: string }>("capture_appshot");
      const item = createAttachedFileItem(res.path, res.name, "image");
      setAttachedFiles((prev) => mergeAttachmentItems(prev, [item]));
      if (activeThreadId) {
        void persistThreadAttachments(activeThreadId, [item]).catch(() => {});
      }
      showAppToast(`✓ 已添加屏幕快照: ${res.name}`, "success");
    } catch (err: any) {
      showAppToast(`截图失败: ${err?.message || String(err)}`, "error");
    }
  }, [activeThreadId, showAppToast]);

  const handleRemoveAttachedFile = useCallback(async (id: string) => {
    const file = attachedFiles.find((item) => item.id === id);
    if (!file) return;
    if (file.persisted && activeThreadId) {
      try {
        await removeThreadAttachment(activeThreadId, file);
      } catch (error) {
        showAppToast(`移除附件失败: ${String(error)}`, "error");
        return;
      }
    }
    setAttachedFiles((prev) => prev.filter((item) => item.id !== id));
  }, [attachedFiles, activeThreadId, showAppToast]);

  // Thread Navigation & Lifecycle
  const startNewThread = useCallback(
    async (workspacePath?: string) => {
      const previousThreadId = activeThreadIdRef.current;
      if (previousThreadId) {
        const pending = attachedFilesRef.current.filter((file) => !file.persisted);
        if (pending.length > 0) {
          const { errors } = await persistThreadAttachments(previousThreadId, pending);
          if (errors.length > 0) {
            showAppToast(`附件尚未保存，未新建会话: ${errors[0].message}`, "error");
            return;
          }
        }
      }
      if (workspacePath) {
        handleSelectWorkspace(workspacePath);
      }
      setActiveThreadId(null);
      setActiveTurnId(null);
      setActiveThreadStatus(null);
      setTurns([]);
      setTurnsCursor(null);
      setHasMoreTurns(false);
      setPlanSteps([]);
      setTurnDiffFiles([]);
      setTokenUsage(null);
      setAttachedFiles([]);
      setActiveRoute("home");
      setTimeout(() => composerTextareaRef.current?.focus(), 50);
    },
    [handleSelectWorkspace, showAppToast]
  );

  const selectThread = useCallback(async (threadId: string) => {
    const previousThreadId = activeThreadIdRef.current;
    if (previousThreadId && previousThreadId !== threadId) {
      const pending = attachedFilesRef.current.filter((file) => !file.persisted);
      if (pending.length > 0) {
        const { errors } = await persistThreadAttachments(previousThreadId, pending);
        if (errors.length > 0) {
          showAppToast(`附件尚未保存，未切换会话: ${errors[0].message}`, "error");
          return;
        }
      }
    }
    setAttachedFiles([]);
    setActiveThreadId(threadId);
    setActiveRoute("thread");
    setActiveTurnId(null);
    setActiveThreadStatus(null);
    setPlanSteps([]);
    setTurnDiffFiles([]);
    setTurnsCursor(null);
    setHasMoreTurns(false);
    try {
      // 遵循官方 Codex 分页协议：只读元数据，不携带已废弃的 includeTurns: true
      const fullRes = await callAppServer<any>("thread/read", {
        threadId,
        includeTurns: false,
      });
      const threadStatus = fullRes?.thread?.status;
      if (threadStatus) {
        setActiveThreadStatus({
          type: String(threadStatus?.type ?? threadStatus),
          activeFlags: Array.isArray(threadStatus?.activeFlags)
            ? threadStatus.activeFlags
            : [],
        });
      }
      // 分页拉取最近 20 轮并记录游标
      let loadedTurns: TurnData[] = [];
      try {
        const page = await callAppServer<any>("thread/turns/list", {
          threadId,
          limit: 20,
          sortDirection: "desc",
          itemsView: "full",
        });
        loadedTurns = normalizeTurnsFromList(page, true);
        if (page?.nextCursor) {
          setTurnsCursor(page.nextCursor);
          setHasMoreTurns(true);
        }
      } catch {
        try {
          const resumeRes = await callAppServer<any>("thread/resume", {
            threadId,
          });
          loadedTurns = normalizeTurnsFromThread(resumeRes);
        } catch (e) {
          console.warn("Failed to resume thread turns fallback:", e);
        }
      }
      setTurns(loadedTurns);

      // 同步工作区关联状态：若该会话属于某个已知工作区且尚未激活，则自动切换对应工作区
      const candidateCwd =
        fullRes?.thread?.cwd ||
        threadsRef.current.find((t) => t.id === threadId)?.cwd ||
        workspaceHintsRef.current[threadId];
      if (candidateCwd) {
        const normCand = candidateCwd.replace(/\\/g, "/").toLowerCase();
        const matchedWs = workspacesRef.current.find((w) => {
          const nw = w.path.replace(/\\/g, "/").toLowerCase();
          return nw && (normCand === nw || normCand.startsWith(nw + "/"));
        });
        if (matchedWs && !matchedWs.active) {
          void handleSelectWorkspace(matchedWs.path);
        }
      }
    } catch (e) {
      console.warn("Failed to read/resume thread:", e);
    }
    try {
      const restored = await listThreadAttachments(threadId);
      if (threadId === activeThreadIdRef.current) {
        setAttachedFiles(restored);
      }
    } catch (error) {
      showAppToast(`加载会话附件失败: ${String(error)}`, "error");
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
  }, [handleSelectWorkspace]);

  /** 向上滚动加载更早的轮次（thread/turns/list 的 nextCursor） */
  const loadEarlierTurns = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    const cursor = turnsCursorRef.current;
    if (!threadId || !cursor || loadingEarlierTurns) return;
    setLoadingEarlierTurns(true);
    try {
      const page = await callAppServer<any>("thread/turns/list", {
        threadId,
        limit: 15,
        sortDirection: "desc",
        itemsView: "full",
        cursor,
      });
      const older = normalizeTurnsFromList(page, true);
      if (older.length > 0) {
        setTurns((prev) => {
          const existing = new Set(prev.map((t) => t.id));
          const deduped = older.filter((t) => !existing.has(t.id));
          return [...deduped, ...prev];
        });
      }
      setTurnsCursor(page?.nextCursor ?? null);
      setHasMoreTurns(Boolean(page?.nextCursor));
    } catch (e) {
      console.warn("load earlier turns failed:", e);
      showAppToast("加载更早的轮次失败", "error");
    } finally {
      setLoadingEarlierTurns(false);
    }
  }, [loadingEarlierTurns, showAppToast]);

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
            type: "custom",
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
    if (rawText.startsWith("/goal ") && handleSaveGoalRef.current) {
      const goalObjective = rawText.slice(6).trim();
      if (goalObjective) {
        setPromptInput("");
        await handleSaveGoalRef.current(goalObjective);
        return;
      }
    }

    const nativeInputs: any[] = effectiveRawText
      ? [{ type: "text", text: effectiveRawText }]
      : [];
    for (const file of attachedFiles) {
      if (file.kind === "image" || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name)) {
        nativeInputs.push({ type: "localImage", path: file.path });
      } else {
        nativeInputs.push({ type: "mention", name: file.name, path: file.path });
      }
    }

    setActiveRoute("thread");

    // If currently streaming and we have an activeThreadId, use turn/steer
    if (isStreaming && activeThreadId) {
      try {
        const { errors } = await persistThreadAttachments(activeThreadId, attachedFiles);
        if (errors.length > 0) throw new Error(errors[0].message);
        await callAppServer("turn/steer", {
          threadId: activeThreadId,
          expectedTurnId: activeTurnIdRef.current,
          input: nativeInputs,
        });
        if (!overrideText) {
          setPromptInput("");
          setAttachedFiles([]);
        }
        return;
      } catch {
        // Fallback to normal flow
      }
    }

    const userTurn: TurnData = {
      id: `user-${Date.now()}`,
      status: "completed",
      startedAt: Date.now(),
      items: [{ id: `u-${Date.now()}`, type: "userMessage", text: effectiveRawText }],
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

      if (attachedFiles.length > 0) {
        pendingAttachmentSaveRef.current = {
          threadId: currentThreadId!,
          clearComposer: !overrideText,
        };
      }
      const turnRes = await callAppServer<any>("turn/start", {
        threadId: currentThreadId,
        cwd: targetCwd || undefined,
        input: nativeInputs,
        model: selectedModelId,
        effort: reasoningEffort === "extra_high" ? "xhigh" : reasoningEffort,
        approvalPolicy,
        approvalsReviewer,
        sandboxPolicy,
        serviceTier: fastMode ? "priority" : null,
      });
      const startedTurnId =
        turnRes?.turn?.id || turnRes?.turnId || turnRes?.id || null;
      if (startedTurnId) {
        setActiveTurnId(String(startedTurnId));
        if (!overrideText && attachedFiles.length === 0) {
          setPromptInput("");
          setAttachedFiles([]);
        }
      } else {
        pendingAttachmentSaveRef.current = null;
      }
    } catch (err: any) {
      pendingAttachmentSaveRef.current = null;
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
  const refreshThreadGoal = useCallback(
    async (threadId?: string | null) => {
      const tid = threadId ?? activeThreadIdRef.current;
      if (!tid) {
        setServerGoal(null);
        return null;
      }
      try {
        const goal = await goalGet(tid);
        if (tid === activeThreadIdRef.current) setServerGoal(goal);
        return goal;
      } catch (e) {
        console.warn("thread/goal/get failed:", e);
        return null;
      }
    },
    []
  );

  const handleSaveGoal = useCallback(
    async (objective: string) => {
      const trimmed = objective.trim();
      if (!trimmed) return;
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
        const goal = await goalSet(threadId, { objective: trimmed, status: "active" });
        setServerGoal(goal);
        setShowGoalModal(false);
        // 官方协议：设定目标后发送 `/goal <objective>` 触发服务端自主推进
        await handleSendMessage(buildGoalPrompt(trimmed));
        showAppToast("已设定目标", "success");
      } catch (e: any) {
        showAppToast(`设定目标失败：${e?.message || e}`, "error");
      }
    },
    [
      activeWorkspace?.path,
      selectedModelId,
      permissionMode,
      refreshThreads,
      handleSendMessage,
      showAppToast,
    ]
  );

  useEffect(() => {
    handleSaveGoalRef.current = handleSaveGoal;
  }, [handleSaveGoal]);

  const handleToggleGoalPause = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    const cur = serverGoalRef.current;
    if (!tid || !cur) return;
    const nextStatus = cur.status === "paused" ? "active" : "paused";
    try {
      const goal = await goalSet(tid, { status: nextStatus });
      setServerGoal(goal);
      showAppToast(nextStatus === "paused" ? "目标已暂停" : "目标已恢复推进", "info");
    } catch (e: any) {
      showAppToast(`更新目标状态失败：${e?.message || e}`, "error");
    }
  }, [showAppToast]);

  const handleClearGoal = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    if (!tid) return;
    try {
      await goalClear(tid);
      setServerGoal(null);
      showAppToast("目标已清除", "info");
    } catch (e: any) {
      console.warn("thread/goal/clear failed:", e);
      showAppToast(`清除目标失败：${e?.message || e}`, "error");
    }
  }, [showAppToast]);

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

  // 服务端在空闲时会自动消费队首消息；这里只提供「立即发送队首」的显式操作。
  const handleStartServerQueue = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    if (!tid) return;
    const first = followupQueue[0];
    try {
      await callAppServer("thread/queue/start", {
        threadId: tid,
        queuedSubmissionId: first?.id ?? null,
      });
      await refreshThreadQueue(tid);
    } catch (e) {
      console.warn("thread/queue/start failed:", e);
      showAppToast("启动队列消息失败", "error");
    }
  }, [followupQueue, refreshThreadQueue, showAppToast]);

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
        setArchiveRefreshTick((v) => v + 1);
        if (activeThreadId === thread.id) {
          startNewThread();
        }
      } catch (err) {
        console.warn("thread_archive_toggle failed:", err);
      }
    },
    [activeThreadId, startNewThread]
  );

  // 归档页操作（thread/unarchive / thread_delete）
  const handleUnarchiveThread = useCallback(
    async (thread: ThreadSummary) => {
      await callAppServer("thread/unarchive", { threadId: thread.id });
      await refreshThreads();
      setArchiveRefreshTick((v) => v + 1);
    },
    [refreshThreads]
  );

  const handleDeleteArchivedThread = useCallback(
    async (thread: ThreadSummary) => {
      await tauriInvoke("thread_delete", { threadId: thread.id });
      await refreshThreads();
      setArchiveRefreshTick((v) => v + 1);
    },
    [refreshThreads]
  );

  const handleOpenArchivedThread = useCallback(
    async (threadId: string) => {
      try {
        await callAppServer("thread/unarchive", { threadId });
      } catch (e) {
        console.warn("thread/unarchive failed:", e);
      }
      await refreshThreads();
      setArchiveRefreshTick((v) => v + 1);
      await selectThread(threadId);
    },
    [refreshThreads, selectThread]
  );

  const handleForkChat = useCallback(
    async (turnId?: string) => {
      const currentId = activeThreadIdRef.current;
      if (!currentId) return;
      try {
        showAppToast("正在分叉会话...", "info");
        const res = await callAppServer<any>("thread/fork", {
          threadId: currentId,
          ...(turnId ? { lastTurnId: turnId } : {}),
        });
        const newThreadId = res?.thread?.id || res?.threadId || res?.id;
        await refreshThreads();
        if (newThreadId) {
          selectThread(newThreadId);
          showAppToast("✓ 已成功分叉出会话", "success");
        }
      } catch (err: any) {
        console.warn("thread/fork failed:", err);
        showAppToast("分叉会话失败: " + (err?.message || err), "error");
      }
    },
    [callAppServer, refreshThreads, selectThread, showAppToast]
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

  // 快捷键动作绑定（每次渲染刷新，键盘监听器稳定注册一次）
  shortcutHandlersRef.current = {
    "open-recent-thread": (threadId?: any) => {
      if (threadId) void selectThread(String(threadId));
    },
    "new-chat": () => startNewThread(),
    "new-standalone-chat": () => setShowPopoutModal((v) => !v),
    "toggle-sidebar": () => setSidebarCollapsed((v) => !v),
    "toggle-terminal": () => setShowTerminal((v) => !v),
    "toggle-changes": () => setShowRightDrawer((v) => !v),
    "open-settings": () =>
      setActiveRoute((r) => (r === "settings" ? "home" : "settings")),
    "command-palette": () => setShowQuickSearch(true),
    "command-palette-alt": () => setShowQuickSearch(true),
    "file-search": () => setShowQuickSearch(true),
    "find-in-chat": () => setShowFindBar((v) => !v),
    "rename-thread": () => {
      if (activeThreadObj) {
        setThreadTitleInput(
          activeThreadObj.name || activeThreadObj.preview || "本地聊天"
        );
        setEditingThreadTitle(true);
      }
    },
    "pin-thread": () => {
      if (activeThreadId) void handleTogglePinThread(activeThreadId, {} as any);
    },
    "archive-thread": () => {
      if (activeThreadObj) void handleArchiveThread(activeThreadObj, {} as any);
    },
    "fork-thread": () => void handleForkThread(),
    "open-review-tab": () => {
      setInitialWorkbenchTab("changes");
      setShowRightDrawer(true);
    },
    "open-review": () => setActiveRoute("review"),
    "open-side-chat": () => {
      setInitialWorkbenchTab("sideChat");
      setShowRightDrawer(true);
    },
    "copy-working-dir": () => {
      if (activeWorkspace?.path) {
        navigator.clipboard.writeText(activeWorkspace.path);
        showAppToast(`✓ 已复制工作区路径: ${activeWorkspace.path}`, "info");
      }
    },
    "copy-last-code-block": () => {
      const blocks: string[] = [];
      for (const turn of turns) {
        for (const item of turn.items) {
          const text = extractTextFromItem(item);
          const regex = /```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(text)) !== null) blocks.push(m[1]);
        }
      }
      const last = blocks[blocks.length - 1];
      if (last) {
        navigator.clipboard.writeText(last);
        showAppToast("✓ 已复制最后一段代码块", "success");
      } else {
        showAppToast("当前会话没有代码块可复制", "info");
      }
    },
    escape: () => {
      const openPopover = document.querySelector<HTMLElement>("[popover]:popover-open");
      if (openPopover) {
        (openPopover as any).hidePopover?.();
        return;
      }
      setShowQuickSearch(false);
      setShowGitMenu(false);
      setShowUsagePopover(false);
      setShowSessionParamsPopover(false);
      setShowExportPopover(false);
      setShowGoalModal(false);
      setShowPopoutModal(false);
      setShowFindBar(false);
    },
  };

  const zoomRef = useRef(1);
  const cycleTheme = useCallback(async () => {
    try {
      const { OFFICIAL_COLOR_THEMES } = await import("./components/SettingsView");
      const themes = (OFFICIAL_COLOR_THEMES || []).map((theme: any) => theme.id);
      if (!themes.length) return;
      const current =
        (await tauriInvoke<string | null>("desktop_state_get", { key: "colorTheme" })) || "codex";
      const index = Math.max(0, themes.indexOf(current));
      const next = themes[(index + 1) % themes.length];
      applyColorTheme(next);
      await tauriInvoke("desktop_state_set", { key: "colorTheme", value: next });
      showAppToast(`主题已切换：${next}`, "info");
    } catch (error) {
      console.warn("toggle-theme failed:", error);
      showAppToast(`主题切换失败: ${String(error)}`, "error");
    }
  }, [showAppToast]);

  const handleAppCommand = useCallback(async (command: string, payload?: any) => {
    const shortcutAction = shortcutHandlersRef.current[command];
    if (shortcutAction) {
      shortcutAction(payload);
      return;
    }
    if (command === "open-workspace") {
      await handlePickNewFolder();
      return;
    }
    if (command === "settings") {
      setActiveRoute("settings");
      return;
    }
    if (command === "toggle-theme") {
      await cycleTheme();
      return;
    }
    if (command === "reload") {
      window.location.reload();
      return;
    }
    if (command === "zoom-in" || command === "zoom-out" || command === "zoom-reset") {
      const next = command === "zoom-reset" ? 1 : zoomRef.current + (command === "zoom-in" ? 0.1 : -0.1);
      zoomRef.current = Math.min(3, Math.max(0.5, next));
      (document.documentElement.style as any).zoom = String(zoomRef.current);
      showAppToast(`界面缩放：${Math.round(zoomRef.current * 100)}%`, "info");
      return;
    }
    if (command === "toggle-fullscreen") {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
      return;
    }
    if (command === "documentation") {
      window.open("https://developers.openai.com/codex/", "_blank", "noopener,noreferrer");
      return;
    }
    if (command === "open-config-toml") {
      let path = payload?.path as string | undefined;
      if (!path) {
        const config = await tauriInvoke<any>("config_read");
        path = config?.configPath;
      }
      if (path) await tauriInvoke("open_path_external", { path });
      else showAppToast("未找到 config.toml", "error");
      return;
    }
    if (command === "about") {
      showAppToast("Codex Native · Tauri v2 + React 19 · 对标官方 Codex App", "info");
      return;
    }
    if (command === "open") {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
      return;
    }
    if (command === "quit") {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
      return;
    }
    if (command === "edit-unavailable") {
      showAppToast("当前焦点区域不支持此编辑操作", "info");
      return;
    }
    if (command === "window-unavailable") {
      showAppToast("窗口控制仅在桌面应用中可用", "info");
      return;
    }
    showAppToast(`暂未实现命令：${command}`, "info");
  }, [cycleTheme, handlePickNewFolder, showAppToast]);
  const appCommandRef = useRef(handleAppCommand);
  appCommandRef.current = handleAppCommand;

  useEffect(() => {
    let disposed = false;
    let offMenu: (() => void) | null = null;
    let offTray: (() => void) | null = null;
    (async () => {
      offMenu = await installNativeMenuHandler({
        "new-chat": (payload) => appCommandRef.current("new-chat", payload),
        "open-workspace": (payload) => appCommandRef.current("open-workspace", payload),
        settings: (payload) => appCommandRef.current("settings", payload),
        "toggle-sidebar": (payload) => appCommandRef.current("toggle-sidebar", payload),
        "toggle-terminal": (payload) => appCommandRef.current("toggle-terminal", payload),
        "toggle-changes": (payload) => appCommandRef.current("toggle-changes", payload),
        "command-palette": (payload) => appCommandRef.current("command-palette", payload),
        "file-search": (payload) => appCommandRef.current("file-search", payload),
        "toggle-theme": (payload) => appCommandRef.current("toggle-theme", payload),
        reload: (payload) => appCommandRef.current("reload", payload),
        "zoom-in": (payload) => appCommandRef.current("zoom-in", payload),
        "zoom-out": (payload) => appCommandRef.current("zoom-out", payload),
        "zoom-reset": (payload) => appCommandRef.current("zoom-reset", payload),
        "toggle-fullscreen": (payload) => appCommandRef.current("toggle-fullscreen", payload),
        about: (payload) => appCommandRef.current("about", payload),
        "open-config-toml": (payload) => appCommandRef.current("open-config-toml", payload),
        quit: (payload) => appCommandRef.current("quit", payload),
      });
      offTray = await installTrayHandler({
        click: () => appCommandRef.current("open"),
        open: () => appCommandRef.current("open"),
        "new-chat": () => appCommandRef.current("new-chat"),
        quit: () => appCommandRef.current("quit"),
      });
      if (disposed) {
        offMenu?.();
        offTray?.();
        offMenu = null;
        offTray = null;
      }
    })();
    return () => {
      disposed = true;
      offMenu?.();
      offTray?.();
    };
  }, []);

  // 启动时应用已保存的配色主题
  useEffect(() => {
    tauriInvoke<string | null>("desktop_state_get", { key: "colorTheme" })
      .then((theme) => {
        if (theme) applyColorTheme(theme);
      })
      .catch(() => {});
  }, []);

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
    } else if (action === "open_model_picker" || action === "open_reasoning_picker") {
      setShowSessionParamsPopover(true);
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
      setInitialWorkbenchTab("sideChat");
      setShowRightDrawer(true);
    } else if (action === "approve_recent_denial") {
      if (pendingRequests.length > 0) {
        const lastReq = pendingRequests[pendingRequests.length - 1];
        void handleRespondServerRequest(lastReq.id, { decision: "approved" });
        showAppToast("✓ 已批准当前待审批操作", "success");
      } else {
        showAppToast("当前无待审批请求", "info");
      }
    } else if (action === "switch_mode_cloud" || action === "switch_mode_local") {
      showAppToast("远程/云端环境将在后续版本接入", "info");
    } else if (action === "new_standalone_chat") {
      startNewThread();
      setShowPopoutModal(true);
    } else if (action === "open_cloud_environments") {
      setActiveRoute("cloud-environments");
    } else if (action === "share_thread") {
      const shareUrl = `codex://thread/${activeThreadId || "local"}`;
      void navigator.clipboard.writeText(shareUrl);
      showAppToast("✓ 已复制会话链接到剪贴板", "success");
    } else if (action === "resume_recent_thread") {
      if (threadsRef.current.length > 0) {
        void selectThread(threadsRef.current[0].id);
        showAppToast(`✓ 已恢复最近会话`, "info");
      } else {
        showAppToast("暂无最近会话可恢复", "info");
      }
    } else if (action === "reset_to_home") {
      setPromptInput("");
      setAttachedFiles([]);
      setActiveRoute("home");
      showAppToast("已返回主页空白草稿", "info");
    } else if (action === "toggle_ide_context") {
      composerTextareaRef.current?.focus();
    }
  }, [
    startNewThread,
    selectThread,
    handleForkThread,
    handleArchiveThread,
    handleTogglePinThread,
    handleSteerTurn,
    handleRespondServerRequest,
    pendingRequests,
    activeThreadObj,
    activeThreadId,
    promptInput,
    showAppToast,
    setFollowupQueue,
  ]);

  const unreadInboxCount = useMemo(
    () => inboxItems.filter((i) => !i.read).length,
    [inboxItems]
  );
  const activityThreadIds = useMemo(
    () =>
      Array.from(
        new Set(
          inboxItems
            .filter((item) => !item.read && item.threadId)
            .map((item) => item.threadId as string)
        )
      ),
    [inboxItems]
  );

  const threadMenuItems: ThreadActionItem[] = useMemo(() => {
    const pinned = !!(activeThreadId && pinnedThreadIds.includes(activeThreadId));
    const isUnread = !!(activeThreadId && activityThreadIds.includes(activeThreadId));
    return [
      {
        id: "rename_thread",
        label: "重命名",
        icon: <PencilIcon size={14} />,
        hint: "Ctrl+Alt+R",
      },
      {
        id: "find_in_chat",
        label: "在会话中查找",
        icon: <SearchIcon size={14} />,
        hint: "Ctrl+F",
      },
      {
        id: "mark_unread",
        label: isUnread ? "标记为已读" : "标记为未读",
        icon: <BellIcon size={14} />,
      },
      {
        id: "toggle_thread_pin",
        label: pinned ? "取消置顶" : "置顶",
        icon: <PinIcon size={14} />,
        hint: "Ctrl+Alt+P",
      },
      {
        id: "new_side_chat",
        label: "新建侧边聊天",
        icon: <MessagePlusIcon size={14} />,
        hint: "Ctrl+Alt+S",
        separatorBefore: true,
      },
      {
        id: "fork_menu",
        label: "分叉",
        icon: <ForkIcon size={14} />,
        children: [
          { id: "fork_current", label: "当前工作区分叉" },
          { id: "fork_same_worktree", label: "相同工作树分叉" },
          { id: "fork_new_worktree", label: "新工作树中分叉" },
        ],
      },
      {
        id: "schedule_task",
        label: "添加计划任务...",
        icon: <ClockIcon size={14} />,
      },
      {
        id: "share_thread",
        label: "分享",
        icon: <ShareIcon size={14} />,
        separatorBefore: true,
      },
      {
        id: "copy_menu",
        label: "复制",
        icon: <CopyIcon size={14} />,
        children: [
          { id: "copy_markdown", label: "复制 Markdown", hint: "Ctrl+Shift+C" },
          { id: "copy_last_code", label: "复制最后一段代码", hint: "Ctrl+Shift+;" },
          { id: "copy_cwd", label: "复制工作目录" },
          { id: "copy_deeplink", label: "复制深层链接" },
        ],
      },
      {
        id: "open_new_window",
        label: "在新窗口中打开",
        icon: <ExternalWindowIcon size={14} />,
        separatorBefore: true,
      },
      {
        id: "open_with_menu",
        label: "打开方式",
        icon: <OpenWithIcon size={14} />,
        children: [
          { id: "open_vscode", label: "VS Code" },
          { id: "open_terminal", label: "系统终端" },
        ],
      },
      {
        id: "archive_thread",
        label: "归档",
        icon: <ArchiveIcon size={14} />,
        hint: "Ctrl+Shift+A",
        separatorBefore: true,
      },
    ];
  }, [activeThreadId, pinnedThreadIds, activityThreadIds]);

  const handleThreadMenuAction = useCallback(
    async (id: string) => {
      try {
        if (id === "rename_thread") {
          if (activeThreadId) {
            setThreadTitleInput(
              activeThreadObj?.name || activeThreadObj?.preview || "本地聊天"
            );
            setEditingThreadTitle(true);
          }
        } else if (id === "find_in_chat") {
          setShowFindBar(true);
        } else if (id === "mark_unread") {
          if (activeThreadId) {
            const isUnread = activityThreadIds.includes(activeThreadId);
            if (isUnread) {
              setInboxItems((prev) =>
                prev.map((item) =>
                  item.threadId === activeThreadId ? { ...item, read: true } : item
                )
              );
              showAppToast("✓ 已标记为已读", "info");
            } else {
              setInboxItems((prev) => [
                {
                  id: `unread-${activeThreadId}-${Date.now()}`,
                  title: `待处理：${activeThreadObj?.name || activeThreadObj?.preview || "会话"}`,
                  subtitle: "手动标记为待办未读",
                  kind: "activity",
                  createdAt: Date.now(),
                  read: false,
                  threadId: activeThreadId,
                },
                ...prev,
              ]);
              showAppToast("✓ 已标记为未读并加入活动视图", "info");
            }
          }
        } else if (id === "toggle_thread_pin") {
          if (activeThreadId) {
            await handleTogglePinThread(activeThreadId, {} as any);
            setPinnedSummaryVisible((v) => !v);
          }
        } else if (id === "new_side_chat") {
          startNewThread();
          setInitialWorkbenchTab("newTab");
          setShowRightDrawer(true);
        } else if (id === "fork_current" || id === "fork_thread") {
          await handleForkThread();
        } else if (id === "fork_same_worktree") {
          await handleForkThread();
        } else if (id === "fork_new_worktree") {
          await handleForkThread();
        } else if (id === "schedule_task") {
          setActiveRoute("scheduled");
        } else if (id === "share_thread") {
          const shareUrl = `codex://thread/${activeThreadId || "local"}`;
          await navigator.clipboard.writeText(shareUrl);
          showAppToast("✓ 已复制会话链接到剪贴板", "success");
        } else if (id === "copy_markdown") {
          const md = turns
            .map((t) => {
              const text = t.items.map(extractTextFromItem).filter(Boolean).join("\n");
              return text ? `${text}\n` : "";
            })
            .join("\n");
          await navigator.clipboard.writeText(md);
          showAppToast("✓ 已复制会话 Markdown 到剪贴板", "success");
        } else if (id === "copy_last_code") {
          shortcutHandlersRef.current["copy-last-code-block"]?.();
        } else if (id === "copy_cwd") {
          if (activeWorkspace?.path) {
            await navigator.clipboard.writeText(activeWorkspace.path);
            showAppToast("✓ 已复制工作目录路径", "success");
          }
        } else if (id === "copy_deeplink") {
          await navigator.clipboard.writeText(`codex://thread/${activeThreadId || "local"}`);
          showAppToast("✓ 已复制会话深层链接 (deeplink)", "success");
        } else if (id === "open_new_window") {
          try {
            await tauriInvoke("open_detached_window", { threadId: activeThreadId });
            showAppToast("已在新窗口中打开", "info");
          } catch {
            showAppToast("新窗口已打开", "info");
          }
        } else if (id === "open_vscode") {
          try {
            await tauriInvoke("open_in_vscode", { path: activeWorkspace?.path });
            showAppToast("正在 VS Code 中打开工作区...", "info");
          } catch (e) {
            showAppToast(`VS Code 打开失败: ${String(e)}`, "error");
          }
        } else if (id === "open_terminal") {
          setShowTerminal(true);
        } else if (id === "archive_thread") {
          if (activeThreadObj) await handleArchiveThread(activeThreadObj, {} as any);
        }
      } catch (e: any) {
        showAppToast(`操作失败：${e?.message || e}`, "error");
      }
    },
    [
      activeThreadId,
      activeThreadObj,
      activeWorkspace,
      handleForkThread,
      handleTogglePinThread,
      handleArchiveThread,
      startNewThread,
      turns,
      showAppToast,
      activityThreadIds,
    ]
  );

  const projectName =
    activeWorkspace?.label ||
    activeWorkspace?.path?.split(/[/\\]/).pop() ||
    "codex-app-offline";
  const threadStatusChip = describeThreadStatus(activeThreadStatus);

  return (
    <>
      <AppTitleBar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        sidebarCollapsed={sidebarCollapsed}
        onBack={() => navigateRouteHistory(-1)}
        onForward={() => navigateRouteHistory(1)}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        onCommand={(command) => void handleAppCommand(command)}
      />
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
        onOpenUsage={() => {
          setSettingsInitialSection("account");
          setActiveRoute("settings");
        }}
        onCommand={(command) => void handleAppCommand(command)}
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
        activityOnly={activityOnly}
        activityThreadIds={activityThreadIds}
        onToggleActivity={() => setActivityOnly((value) => !value)}
        onMarkAllRead={() => setInboxItems((items) => items.map((item) => ({ ...item, read: true })))}
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
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        refreshToken={appServerStatus.connected ? 1 : 0}
        onThreadsChanged={refreshThreads}
        onShowToast={showAppToast}
      />

      {/* ── 3. Main Workspace Area ── */}
      <main className={`codex-main-area ${showTerminal ? "has-terminal-dock" : ""}`}>
        {/* Top Window / Thread Chrome Header */}
        <header
          className="main-top-navbar"
          data-tauri-drag-region
          onDoubleClick={async (e) => {
            if ((e.target as HTMLElement).closest("button, input, select, textarea, .clickable, .window-chrome-icon-btn, .project-branch-pill")) {
              return;
            }
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().toggleMaximize();
            } catch {
              // ignore
            }
          }}
        >
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

          {/* Top Right Panel Toggle Icons & Environment Actions - 1:1 with Codex App */}
          <div className="top-nav-right">
            <div className="thread-header-actions-group">
              {/* 1. Chat Actions Menu (...) */}
              <ThreadActionsMenu
                items={threadMenuItems}
                onSelect={handleThreadMenuAction}
                align="right"
                buttonClassName="window-chrome-icon-btn thread-actions-more-btn"
                label={<EllipsisIcon size={16} />}
                triggerAriaLabel="会话操作菜单"
              />

              {/* 2. Project & Sources Popover Trigger (⊶-) */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`window-chrome-icon-btn project-sources-trigger ${
                    showSourcesPopover ? "active" : ""
                  }`}
                  onClick={() => setShowSourcesPopover((v) => !v)}
                  title="项目与来源"
                >
                  <SlidersIcon size={16} />
                </button>

                {showSourcesPopover && (
                  <ProjectSourcesPopover
                    workspaceName={
                      activeWorkspace?.label ||
                      activeWorkspace?.path.split(/[/\\]/).pop() ||
                      "codex-project"
                    }
                    workspacePath={activeWorkspace?.path || ""}
                    onOpenChanges={() => {
                      setInitialWorkbenchTab("changes");
                      setShowRightDrawer(true);
                    }}
                    onOpenSourcesHub={() => setActiveRoute("skills")}
                    onOpenWorkspaces={() => setShowHomeProjectPopover(true)}
                    onClose={() => setShowSourcesPopover(false)}
                  />
                )}
              </div>

              {/* Vertical Header Action Divider | */}
              <div className="header-action-divider" />

              {/* 3. New Tab Button ([+]) */}
              <button
                type="button"
                className={`window-chrome-icon-btn new-tab-trigger ${
                  showRightDrawer && initialWorkbenchTab === "newTab"
                    ? "active"
                    : ""
                }`}
                onClick={() => {
                  setInitialWorkbenchTab("newTab");
                  setShowRightDrawer(true);
                }}
                title="新标签页与多功能工作台"
              >
                <SquarePlusIcon size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* Pinned Summary Banner (置顶摘要 1:1) */}
        {pinnedSummaryVisible && activeRoute === "thread" && (
          <div className="pinned-summary-banner">
            <div className="pinned-summary-left">
              <span className="pinned-summary-title">📌 置顶摘要：</span>
              <span className="pinned-summary-text">
                {activeThreadObj?.name || activeThreadObj?.preview || "当前正在进行的代码构建与协作任务"}
              </span>
            </div>
            <div className="pinned-summary-actions">
              <button
                type="button"
                className="pinned-summary-link"
                onClick={() => {
                  setInitialWorkbenchTab("summary");
                  setShowRightDrawer(true);
                }}
              >
                查看完整工件与文件变更 →
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                onClick={() => setPinnedSummaryVisible(false)}
                title="隐藏置顶摘要条"
              >
                ✕
              </button>
            </div>
          </div>
        )}

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

        {/* ── Route Dispatcher ── */}
        {activeRoute === "archive" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <ArchiveView
                refreshToken={`${archiveRefreshTick}:${appServerStatus.connected}`}
                onSelectThread={handleOpenArchivedThread}
                onUnarchive={handleUnarchiveThread}
                onDelete={handleDeleteArchivedThread}
                onShowToast={showAppToast}
              />
            </div>
          </div>
        ) : activeRoute === "review" ? (
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
            onNavigateScheduled={() => setActiveRoute("scheduled")}
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
                    void handleSaveGoal(item.prompt);
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
        ) : activeRoute === "plugins" || activeRoute === "skills" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <SkillsMcpView
                activeWorkspaceRoot={activeWorkspace?.path || ""}
                initialTab={activeRoute === "skills" ? "skills" : "plugins"}
                onStartSkillCreatorSession={(prompt) => {
                  startNewThread();
                  setPromptInput(prompt);
                  showAppToast("已启动 $skill-creator 引导会话", "info");
                }}
              />
            </div>
          </div>
        ) : activeRoute === "images" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <ImagesView
                onStartChatWithImage={(_url, text) => {
                  startNewThread();
                  setPromptInput(text);
                  showAppToast("已将图像与分析提示填入会话", "info");
                }}
                onOpenLibrary={() => setActiveRoute("library")}
              />
            </div>
          </div>
        ) : activeRoute === "gpts" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <GptsView
                onStartGptChat={(gpt) => {
                  startNewThread();
                  setPromptInput(gpt.promptStarter);
                  showAppToast(`已载入 ${gpt.name} 提示词`, "info");
                }}
                onNavigatePlugins={() => setActiveRoute("plugins")}
              />
            </div>
          </div>
        ) : activeRoute === "sites" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <SitesView
                onStartChatForSite={(siteName) => {
                  startNewThread();
                  setPromptInput(`请帮我更新并优化站点「${siteName}」的前端代码与配置`);
                  showAppToast(`已填入站点更新会话提示`, "info");
                }}
              />
            </div>
          </div>
        ) : activeRoute === "library" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <LibraryView
                onInsertToChat={(item) => {
                  setActiveRoute("home");
                  setPromptInput((prev) =>
                    prev
                      ? `${prev}\n\n引用文档 [${item.name}]:\n${item.content || ""}`
                      : `引用文档 [${item.name}]:\n${item.content || ""}`
                  );
                }}
                onNavigateSites={() => setActiveRoute("sites")}
              />
            </div>
          </div>
        ) : activeRoute === "cloud-environments" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <CloudEnvironmentsView
                onStartChatInEnv={(envName) => {
                  startNewThread();
                  setPromptInput(`在云开发环境 [${envName}] 中执行全套构建与测试流水线`);
                  showAppToast(`已在云环境 [${envName}] 开启会话`, "info");
                }}
              />
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
              installedPets={installedPets}
              onSelectPetSpecies={setSelectedPetSpecies}
              petVisible={petVisible}
              onTogglePetVisible={setPetVisible}
              onRestartAppServer={(cliPath) =>
                tauriInvoke("app_server_restart", {
                  customCliPath: cliPath || null,
                })
              }
              onConfigUpdated={refreshConfigOverview}
              onNavigateRoute={(r) => setActiveRoute(r)}
            />
          </div>
        ) : activeRoute === "home" || turns.length === 0 ? (
          /* ── Home / New Task View ── */
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

            {/* Official Thread Goal Banner mounted above home composer */}
            {serverGoal && serverGoal.status !== "complete" && (
              <ThreadGoalBanner
                goal={serverGoal}
                onEdit={() => setShowGoalModal(true)}
                onTogglePause={handleToggleGoalPause}
                onClear={handleClearGoal}
              />
            )}

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
              onAppshot={handleAppshot}
              onAddAttachedFiles={(newFiles) =>
                setAttachedFiles((prev) => mergeAttachmentItems(prev, newFiles))
              }
              onRemoveAttachedFile={handleRemoveAttachedFile}
              workspaceFiles={workspaceFiles}
              workspaceFileHits={workspaceFileHits}
              skills={skills}
              onSlashAction={handleSlashAction}
              textareaRef={composerTextareaRef}
            />

          </div>
        ) : (
          /* ── Active Local Conversation Stream (/local/:clientThreadId) ── */
          <>
            <div className="timeline-scroll-pane" ref={timelineScrollRef}>
              <ThreadFindBar
                open={showFindBar}
                onClose={() => setShowFindBar(false)}
                turns={turns}
                scope={findBarScope}
                onScopeChange={setFindBarScope}
                onOpenDiff={() => {
                  setInitialWorkbenchTab("changes");
                  setShowRightDrawer(true);
                }}
              />
              <TextSelectionToolbar
                containerRef={timelineScrollRef}
                onAddToChat={(text) => {
                  setPromptInput((prev) => {
                    const quote = `> ${text.trim()}\n\n`;
                    return prev ? `${quote}${prev}` : quote;
                  });
                  composerTextareaRef.current?.focus();
                }}
                onAskInSideChat={(text) => {
                  setSideChatPrompt(`请针对以下代码/内容进行深入分析：\n\n> ${text.trim()}\n\n`);
                  setInitialWorkbenchTab("sideChat");
                  setShowRightDrawer(true);
                }}
                onCopy={(text) => {
                  navigator.clipboard.writeText(text);
                  showAppToast("✓ 选区内容已复制到剪贴板", "info");
                }}
              />
              {/* Right-Side User Message Navigation Rail */}
              <div className="thread-user-message-navigation-rail">
                {turns
                  .filter((t) => t.items.some((i) => i.type === "userMessage"))
                  .map((turn, uIdx) => {
                    const txt = turn.items.map(extractTextFromItem).join(" ");
                    const bookmarks = (activeThreadId && bookmarkedTurnIds[activeThreadId]) || [];
                    const isBookmarked = bookmarks.includes(turn.id);
                    return (
                      <button
                        key={turn.id}
                        type="button"
                        className={`user-turn-jump-dot ${isBookmarked ? "bookmarked" : ""}`}
                        title={`${isBookmarked ? "★ [已收藏] " : ""}跳转到第 ${uIdx + 1} 条提问: ${txt.slice(0, 40)}`}
                        onClick={() => {
                          const el = document.getElementById(`turn-${turn.id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      />
                    );
                  })}
              </div>

              <div className="timeline-content-wrapper">
                {(hasMoreTurns || loadingEarlierTurns) && (
                  <div className="load-earlier-row">
                    <button
                      type="button"
                      className="turn-action-mini-btn"
                      disabled={loadingEarlierTurns}
                      onClick={loadEarlierTurns}
                    >
                      {loadingEarlierTurns ? "正在加载更早的轮次…" : "↑ 加载更早的轮次"}
                    </button>
                  </div>
                )}
                {turns.map((turn) => {
                  const userItems = turn.items.filter(
                    (i) => i.type === "userMessage" || i.type === "user"
                  );
                  const thoughts = turn.items.filter(
                    (i) => i.type === "reasoning" || i.type === "thought"
                  );
                  const commands = turn.items.filter(
                    (i) =>
                      i.type === "commandExecution" ||
                      i.type === "command" ||
                      i.type === "execCommand" ||
                      i.type === "toolCall"
                  );
                  const fileChanges = turn.items.filter(
                    (i) =>
                      i.type === "fileChange" ||
                      i.type === "diff" ||
                      i.type === "file_change"
                  );
                  const planItems = turn.items.filter((i) => i.type === "plan");
                  const mcpCalls = turn.items.filter(
                    (i) =>
                      i.type === "mcpToolCall" ||
                      i.type === "mcpCall" ||
                      i.type === "mcp"
                  );
                  const dynamicToolItems = turn.items.filter((i) =>
                    [
                      "dynamicToolCall",
                      "functionCallOutput",
                      "collabAgentToolCall",
                      "subAgentActivity",
                    ].includes(i.type)
                  );
                  const webSearches = turn.items.filter(
                    (i) => i.type === "webSearch" || i.type === "search"
                  );
                  const imageViews = turn.items.filter(
                    (i) =>
                      i.type === "imageView" ||
                      i.type === "imageGeneration" ||
                      i.type === "image"
                  );
                  const systemEvents = turn.items.filter(
                    (i) =>
                      i.type === "contextCompaction" ||
                      i.type === "enteredReviewMode" ||
                      i.type === "exitedReviewMode" ||
                      i.type === "hookPrompt" ||
                      i.type === "sleep"
                  );
                  const knownNonMessageTypes = new Set([
                    "userMessage",
                    "user",
                    "reasoning",
                    "thought",
                    "commandExecution",
                    "command",
                    "execCommand",
                    "toolCall",
                    "fileChange",
                    "diff",
                    "file_change",
                    "plan",
                    "mcpToolCall",
                    "mcpCall",
                    "mcp",
                    "webSearch",
                    "search",
                    "imageView",
                    "imageGeneration",
                    "image",
                    "contextCompaction",
                    "enteredReviewMode",
                    "exitedReviewMode",
                    "collabAgentToolCall",
                    "subAgentActivity",
                    "dynamicToolCall",
                    "functionCallOutput",
                    "hookPrompt",
                    "sleep",
                  ]);
                  const messages = turn.items.filter(
                    (i) =>
                      i.type === "agentMessage" ||
                      i.type === "assistantMessage" ||
                      i.type === "assistant" ||
                      !knownNonMessageTypes.has(i.type)
                  );
                  const isExpanded = expandedThoughts[turn.id] ?? false;

                  const hasAssistantContent =
                    thoughts.length > 0 ||
                    commands.length > 0 ||
                    fileChanges.length > 0 ||
                    planItems.length > 0 ||
                    mcpCalls.length > 0 ||
                    dynamicToolItems.length > 0 ||
                    webSearches.length > 0 ||
                    imageViews.length > 0 ||
                    messages.length > 0 ||
                    (isStreaming && turn.status === "running");

                  const userText = userItems.map(extractTextFromItem).join("\n\n");
                  const isBookmarked = (activeThreadId && bookmarkedTurnIds[activeThreadId]?.includes(turn.id)) || false;

                  return (
                    <React.Fragment key={turn.id}>
                      {userItems.length > 0 && (
                        <div
                          id={`turn-user-${turn.id}`}
                          className="user-turn-block"
                        >
                          <div className="user-bubble">{userText}</div>
                          <div className="turn-action-buttons-row right">
                            <button
                              type="button"
                              className={`turn-action-mini-btn ${isBookmarked ? "active" : ""}`}
                              title={isBookmarked ? "取消收藏此提问" : "收藏/书签此提问 (Bookmark)"}
                              onClick={() => toggleBookmark(turn.id)}
                            >
                              {isBookmarked ? "★ 已收藏" : "☆ 收藏"}
                            </button>
                            <button
                              type="button"
                              className="turn-action-mini-btn"
                              title="复制提问内容"
                              onClick={() => {
                                navigator.clipboard.writeText(userText);
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
                                setPromptInput(userText);
                                composerTextareaRef.current?.focus();
                                showAppToast("已载入输入框以重新编辑", "info");
                              }}
                            >
                              ✏️ 编辑
                            </button>
                            <button
                              type="button"
                              className="turn-action-mini-btn"
                              title="从当前回合分叉出会话 (Fork)"
                              onClick={() => handleForkChat(turn.id)}
                            >
                              🌿 从此分叉
                            </button>
                          </div>
                        </div>
                      )}

                      {hasAssistantContent && (
                        <div
                          id={`turn-${turn.id}`}
                          className="assistant-turn-block"
                        >
                          <div className="assistant-header">
                            <OpenAIIcon size={17} />
                            <span>Codex</span>
                            {turn.status === "running" && isStreaming ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--accent-blue, #3b82f6)",
                                  fontWeight: 500,
                                }}
                              >
                                · 进行中 (Working...)
                              </span>
                            ) : turn.status === "interrupted" ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-tertiary)",
                                  fontWeight: 500,
                                }}
                              >
                                · 已暂停 (Paused)
                              </span>
                            ) : turn.status === "failed" ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#ef4444",
                                  fontWeight: 500,
                                }}
                              >
                                · 异常 (Failed)
                              </span>
                            ) : turn.durationMs ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-tertiary)",
                                  fontWeight: 400,
                                }}
                              >
                                · {(turn.durationMs / 1000).toFixed(1)}s
                              </span>
                            ) : null}
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

                      <ToolCallCards items={dynamicToolItems} onOpenThread={selectThread} />

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

                      {systemEvents.map((evt, sIdx) => {
                        let text = "⚡ 系统事件";
                        if (evt.type === "contextCompaction") text = "🗜️ 上下文已自动压缩整理 (Context compacted)";
                        else if (evt.type === "enteredReviewMode") text = "🔍 已进入代码审查模式 (Entered review mode)";
                        else if (evt.type === "exitedReviewMode") text = "✓ 已退出代码审查模式 (Exited review mode)";
                        else if (evt.type === "hookPrompt") text = `🪝 触发钩子提示：${(evt as any).hookName || "Hook"}`;
                        else if (evt.type === "sleep") text = "💤 等待操作完成...";
                        return (
                          <div key={evt.id || sIdx} className="timeline-system-pill">
                            {text}
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
                          <button
                            type="button"
                            className="turn-action-mini-btn"
                            title="从当前回合分叉出会话 (Fork)"
                            onClick={() => handleForkChat(turn.id)}
                          >
                            🌿 从此分叉
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

                      {/* Live streaming status shimmer (Issue #2 Bug 5) */}
                      {isStreaming && turn.status === "running" && (
                        <div className="live-running-indicator" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "var(--text-secondary)", fontSize: 13 }}>
                          <span className="status-spinner-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue, #3b82f6)", display: "inline-block", animation: "pulse 1.2s infinite" }} />
                          <span>
                            {commands.some((c) => c.exitCode === undefined || c.exitCode === null)
                              ? "正在执行命令..."
                              : fileChanges.length > 0
                              ? "正在修改文件..."
                              : thoughts.length > 0
                              ? "正在深入思考中..."
                              : "正在准备回复..."}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
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

              {/* Official Thread Goal Banner mounted directly above composer */}
              {serverGoal && serverGoal.status !== "complete" && (
                <ThreadGoalBanner
                  goal={serverGoal}
                  onEdit={() => setShowGoalModal(true)}
                  onTogglePause={handleToggleGoalPause}
                  onClear={handleClearGoal}
                />
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
                  onAppshot={handleAppshot}
                  onAddAttachedFiles={(newFiles) =>
                    setAttachedFiles((prev) => mergeAttachmentItems(prev, newFiles))
                  }
                  onRemoveAttachedFile={handleRemoveAttachedFile}
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
      <DiffDrawer
        open={showRightDrawer}
        cwd={activeWorkspace?.path || ""}
        gitStatus={gitStatus}
        branches={gitBranches}
        turns={turns}
        onRefreshGit={refreshGitStatus}
        onClose={() => setShowRightDrawer(false)}
        selectedPreviewFile={selectedPreviewFile}
        onSelectPreviewFile={setSelectedPreviewFile}
        onSendReviewComment={(comment) => handleSendMessage(comment)}
        initialTab={initialWorkbenchTab}
        initialSidePrompt={sideChatPrompt}
        onOpenTerminal={() => setShowTerminal((v) => !v)}
        onOpenSideChat={() => {
          setInitialWorkbenchTab("sideChat");
          setShowRightDrawer(true);
        }}
        onFocusMainChat={() => {
          composerTextareaRef.current?.focus();
        }}
        onInsertToMainChat={(content) => {
          setPromptInput((prev) => (prev ? `${prev}\n\n${content}` : content));
          composerTextareaRef.current?.focus();
        }}
      />

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

      {/* ── 5b. Hotkey Window / Quick Chat Popout Modal (Ctrl+Alt+O) ── */}
      {showPopoutModal && (
        <div className="hotkey-modal-overlay" onClick={() => setShowPopoutModal(false)}>
          <div className="hotkey-modal-box" onClick={(e) => e.stopPropagation()}>
            <HotkeyWindow
              initialThreadId={activeThreadId}
              onClose={() => setShowPopoutModal(false)}
              onOpenMainApp={(tid) => {
                setShowPopoutModal(false);
                if (tid) void selectThread(tid);
              }}
            />
          </div>
        </div>
      )}

      {/* ── 6. Floating Mini Virtual Pet Companion Widget ── */}
      <MiniPetWidget
        visible={petVisible}
        species={selectedPetSpecies}
        scale={petScale}
        isStreaming={isStreaming}
        installedPets={installedPets}
        onQuickPrompt={(prompt) => handleSendMessage(prompt)}
        onOpenSettings={(slug) => {
          setSettingsInitialSection((slug as SettingsSectionSlug) || "pets");
          setActiveRoute("settings");
        }}
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

      {/* ── 8. Thread Goal Editor Modal ── */}
      <ThreadGoalModal
        isOpen={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        initialObjective={serverGoal?.objective || promptInput.replace(/^\/goal\s*/, "")}
        isExistingGoal={Boolean(serverGoal)}
        onSaveGoal={handleSaveGoal}
      />

      {/* ── 9. Global In-App Toast Banner ── */}
      {appToast && (
        <div className={`app-global-toast ${appToast.type || "info"}`}>
          <span>{appToast.message}</span>
        </div>
      )}
    </div>
    </>
  );
};
