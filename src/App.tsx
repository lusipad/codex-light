import { usePetPreferences } from "./petPreferences";
import { mergeHookRoots } from "./hooksSettingsModel";
import { createEnvironmentWorktree, type WorktreeCreationOptions } from "./worktreeCreation";
import { installWorktreeCleanup } from "./worktreeCleanup";
import { beginActivitySession, excludeActivityThreads, mergeActivitySession, threadNeedsAttention, type ActivitySession } from "./threadActivity";
import { useExternalImports } from "./externalImport";
import { useCodeReviewPreferences } from "./reviewPreferences";
import { buildQuickReviewPrompt, parseReviewFindings, type ModelReviewComment } from "./reviewFindings";
import { createReviewResults, type ReviewRun } from "./reviewResults";
import { useGitPreferences } from "./gitPreferences";
import { useWorkspaceOpenTargets } from "./workspaceOpenTargets";
import { loadModelCatalog } from "./modelCatalog";
import { useModelSelection } from "./modelSelection";
import { executionThreadConfig, readThreadExecutionPolicy, resolveConfiguredExecutionPolicy, resolvePresetExecutionPolicy, type ExecutionPolicy } from "./executionPolicy";
import { configRead } from "./config";
import { createNotificationDispatcher, notificationRequestCategory, shouldNotifyTurn, useNotificationPreferences, type NotificationEvent } from "./notificationPreferences";
import { useAppearancePreferences } from "./appearancePreferences";
import { notificationApprovalActions, notificationApprovalResponse } from "./notificationActions";
import { GeneratedImageCard } from "./components/GeneratedImageCard";
import { McpCallCard } from "./components/McpCallCard";
import { extractTextFromItem } from "./threadText";
import { pendingRequestKey, requestThreadId, requestsForThread, type RequestResponseState } from "./approvalRequests";
import { copyTextToClipboard } from "./clipboard";
import { buildSkillTrialPrompt } from "./skillTrialPrompt";
import { ShareThreadDialog } from "./components/ShareThreadDialog";
import { readShareAccess } from "./shareAccess";
import { installDeepLinkReceiver } from "./deepLinks";
import { normalizeComposerEnterBehavior, type ComposerEnterBehavior } from "./composerPreferences";
import { CommandExecutionCard } from "./components/CommandExecutionCard";
import { mergeTimelineItem, ThreadHistoryBuffer, isCurrentThreadRequest } from "./threadTimeline";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Bookmark } from "lucide-react";
import {
  OpenAIIcon,
  CodexHomeIcon,
  BranchIcon,
  TerminalIcon,
  BrainIcon,
  ShieldIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  WorktreeIcon,
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
  FolderIcon,
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
import { callAppServer, tauriInvoke, tauriListen, isTauriRuntime } from "./bridge";
import { baseNameFsPath } from "./fsClient";
import { FileChangeCard } from "./components/FileChangeCard";
import type { AccountReadResult } from "./config";
import { createShortcutMatcher, shortcutEventAllowed, SHORTCUTS, effectiveBindings } from "./shortcuts";
import { useKeyboardPreferences } from "./keyboardPreferences";
import { installNativeMenuHandler, installTrayHandler } from "./nativeShell";
import { playNotificationChime } from "./sound";
import { getPickerModels, modelRequestName, type ModelConfiguration } from "./modelCapabilities";
import {
  AppServerStatus,
  ArchiveDeleteResult,
  AttachedFileItem,
  CodexConfigOverview,
  DirectoryEntryItem,
  GitStatusInfo,
  InboxNotificationItem,
  MainViewRoute,
  ModelInfo,
  PendingServerRequest,
  QueuedFollowupPrompt,
  SettingsSectionSlug,
  SkillInfoItem,
  ThreadSummary,
  TurnData,
  TurnItem,
  WorkspaceFileHit,
  WorkspaceRootItem,
  SidebarProjectMembership,
  SidebarLocalProject,
  ShellExecResult,
  ProjectScriptCommands,
  GitCommitInfo,
} from "./types";
import { MarkdownView } from "./components/MarkdownView";
import { UserMessageBubble } from "./components/UserMessageBubble";
import { DiffDrawer } from "./components/DiffDrawer";
import { TerminalDock } from "./components/TerminalDock";
import { EnvironmentActions } from "./components/EnvironmentActions";
import type { EnvironmentActionRunRequest } from "./environmentActions";
import { WorktreesView } from "./components/WorktreesView";
import { AutomationsView } from "./components/AutomationsView";
import { SkillsMcpView } from "./components/SkillsMcpView";
import { SettingsView } from "./components/SettingsView";
import { WorkspacePopover } from "./components/WorkspacePopover";
import { AgentsMdModal } from "./components/AgentsMdModal";
import { NavigationRail } from "./components/NavigationRail";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { CodexSidebar } from "./components/CodexSidebar";
import { ComposerBox } from "./components/ComposerBox";
import { ProjectsIndexView } from "./components/ProjectsIndexView";
import { InboxView } from "./components/InboxView";
import { MiniPetWidget } from "./components/MiniPetWidget";
import { fileDedupeKey, fileSearchRoot, QuickSearchModal } from "./components/QuickSearchModal";
import type { RecentFile } from "./components/QuickSearchModal";
import { restoreInboxHistory } from "./inboxState";
import { CodeReviewView, ReviewRequest } from "./components/CodeReviewView";
import { RemoteReviewView } from "./components/RemoteReviewView";
import { parseRemotePullRequestUrl } from "./remoteReview";
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
import { parseSitesLocation, type SitesNavigation } from "./sitesNavigation";
import { LibraryFileRoute, LibraryView, type LibraryNavigation } from "./components/LibraryView";
import { libraryLocationUrl, parseLibraryFileLocation, parseLibraryLocation } from "./libraryBrowse";
import { LibraryCleanupView } from "./components/LibraryCleanupView";
import { CloudEnvironmentsView } from "./components/CloudEnvironmentsView";
import { CloudDraftView } from "./components/CloudDraftView";
import { CloudNewChatView } from "./components/CloudNewChatView";
import { useHomeCloudComposer } from "./useHomeCloudComposer";
import type { PublishedCloudTarget } from "./cloudPublishedChat";
import type { CloudDraftSession } from "./cloudDraftSession";
import { applyCloudRecentAction, readCloudRecentChats, sameCloudRecentIdentity, type CloudRecentAction, type CloudRecentChat } from "./cloudRecentChats";
import { serviceErrorMessage, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { ThreadActionsMenu, ThreadActionItem } from "./components/ThreadActionsMenu";
import { ThreadFindBar } from "./components/ThreadFindBar";
import {
  TokenUsageSnapshot,
  mergeTokenUsage,
  mergeRateLimits,
  NOTIFICATION,
  isThreadReadState,
} from "./protocol";
import {
  ThreadGoal,
  goalGet,
  goalSet,
  goalClear,
  buildGoalPrompt,
  goalStatusLabel,
} from "./threadGoal";
import { buildSidebarProjectGroups, sidebarThreadProjects, resolveNewThreadProject, threadStartProjectParams } from "./sidebarProjects";
import { listProjects, type Project } from "./projects";

type ProjectArchiveUndo = { thread: ThreadSummary; pinPlacement: { beforeThreadId: string | null } | null };

/** Reasoning items carry `summary[]` + `content[]` (and streamed text). */
function selectedFileSearchText(): string | undefined {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active instanceof HTMLInputElement && active.type === "password") return;

  let text = "";
  if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      active.selectionStart !== null && active.selectionEnd !== null) {
    text = active.value.slice(active.selectionStart, active.selectionEnd);
  } else {
    const selection = document.getSelection();
    if (selection && active?.contains(selection.anchorNode) && active.contains(selection.focusNode)) {
      text = selection.toString();
    }
  }
  const query = text.trim();
  return query && query.length <= 256 && !/[\r\n\0]/.test(query) ? query : undefined;
}

function extractReasoningText(item: TurnItem): string {
  if (!item) return "";
  if (Array.isArray(item.summary) && item.summary.length > 0) {
    const sum = item.summary
      .map((v: any) => (typeof v === "string" ? v : v?.text || ""))
      .filter((v: string) => Boolean(v && v.trim()))
      .join("\n");
    if (sum.trim()) return sum;
  }
  const parts: string[] = [];
  const push = (v: any) => {
    if (typeof v === "string" && v.trim()) parts.push(v);
    else if (v && typeof v.text === "string" && v.text.trim()) parts.push(v.text);
  };
  if (typeof item.text === "string" && item.text.trim()) parts.push(item.text);
  if (Array.isArray(item.content)) item.content.forEach(push);
  if (Array.isArray(item.reasoningText)) item.reasoningText.forEach(push);
  else if (typeof item.reasoningText === "string" && item.reasoningText.trim()) {
    parts.push(item.reasoningText);
  }
  if (!parts.length) {
    const fallback = extractTextFromItem(item);
    return fallback ? fallback.trim() : "";
  }
  return Array.from(new Set(parts)).join("\n");
}

/** Count added/removed lines in a unified diff snippet. */
/** Format duration into official Hermes workflow duration style (e.g. "9m 31s", "12s", "1h 5m"). */
function formatHermesDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) {
    return remSec > 0 ? `${m}m ${remSec}s` : `${m}m`;
  }
  return `${remSec}s`;
}

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

function mapTurnObject(t: any, idx: number): TurnData {
  return {
    id: t?.id || `turn-${idx}`,
    status: t?.status || "unknown",
    error: t?.error,
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
  useEffect(() => installWorktreeCleanup(), []);
  const isQuickChatWindow = new URLSearchParams(window.location.search).get("utility") === "quick-chat";
  const threadWindowId = new URLSearchParams(window.location.search).get("threadWindow");
  const isThreadWindow = Boolean(threadWindowId);
  const initialWindowThreadRef = useRef(isThreadWindow ? new URLSearchParams(window.location.search).get("threadId") : null);
  const [threadEventsReady, setThreadEventsReady] = useState(false);
  const promptStorageKey = isQuickChatWindow ? "codex_quick_chat_prompt_drafts_v1" : threadWindowId ? `codex_thread_window_drafts_v1:${threadWindowId}` : "codex_composer_prompt_drafts_v1";
  // Primary Route & Shell Layout State
  const [libraryFileId, setLibraryFileId] = useState(() => !isQuickChatWindow && !isThreadWindow
    ? parseLibraryFileLocation(window.location.href) : null);
  const [activeRoute, commitActiveRoute] = useState<MainViewRoute>(() => window.location.pathname === "/code-review" ? "code-review"
    : parseSitesLocation(window.location.href) ? "sites"
      : libraryFileId ? "library-file"
        : !isQuickChatWindow && !isThreadWindow && parseLibraryLocation(window.location.href) ? "library" : "home");
  const isCloudChatRoute = activeRoute === "cloud-draft" || activeRoute === "cloud-new-chat";
  const [cloudDraft, setCloudDraft] = useState<{ session: CloudDraftSession; persisted: boolean; origin: "settings" | "cloud-environments" | "home"; title?: string } | null>(null);
  const refreshCloudRecentRef = useRef<(() => void) | null>(null);
  const [publishedCloudTarget, setPublishedCloudTarget] = useState<PublishedCloudTarget | null>(null);
  const cloudDraftRef = useRef(cloudDraft);
  cloudDraftRef.current = cloudDraft;
  const [libraryCleanupTab, setLibraryCleanupTab] = useState<"all" | "images" | null>(null);
  const [libraryNavigation, setLibraryNavigation] = useState<LibraryNavigation | null>(null);
  const libraryNavigationRef = useRef<LibraryNavigation | null>(null);
  const updateLibraryNavigation = useCallback((navigation: LibraryNavigation | null) => {
    libraryNavigationRef.current = navigation;
    setLibraryNavigation(navigation);
  }, []);
  const [sitesNavigation, setSitesNavigation] = useState<SitesNavigation | null>(null);
  const sitesNavigationRef = useRef<SitesNavigation | null>(null);
  const updateSitesNavigation = useCallback((navigation: SitesNavigation | null) => {
    sitesNavigationRef.current = navigation;
    setSitesNavigation(navigation);
  }, []);
  const [remotePullRequestUrl, setRemotePullRequestUrl] = useState(() => window.location.pathname === "/code-review"
    ? new URLSearchParams(window.location.hash.slice(1)).get("pullRequest") ?? "" : "");
  const activeRouteRef = useRef(activeRoute);
  activeRouteRef.current = activeRoute;
  const personalizationNavigationGuardRef = useRef<((action: () => void) => boolean) | null>(null);
  const setPersonalizationNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    personalizationNavigationGuardRef.current = guard;
  }, []);
  const setActiveRoute = useCallback((next: React.SetStateAction<MainViewRoute>) => {
    const route = typeof next === "function" ? next(activeRouteRef.current) : next;
    if (route === activeRouteRef.current) return;
    const apply = () => { activeRouteRef.current = route; commitActiveRoute(route); };
    if (personalizationNavigationGuardRef.current?.(apply) === false) return;
    apply();
  }, []);
  const closeCloudCreate = useCallback(() => setActiveRoute("home"), [setActiveRoute]);
  const closeLibraryFile = useCallback(() => {
    if (activeRouteRef.current === "library-file" && parseLibraryFileLocation(window.location.href) === libraryFileId) {
      setLibraryCleanupTab(null);
      setActiveRoute("library");
    }
  }, [libraryFileId, setActiveRoute]);
  const openRemotePullRequest = (url: string) => {
    setRemotePullRequestUrl(parseRemotePullRequestUrl(url).url);
    setActiveRoute("code-review");
  };
  useEffect(() => {
    const restorePageRoute = () => {
      if (parseSitesLocation(window.location.href)) setActiveRoute("sites");
      else {
        const id = !isQuickChatWindow && !isThreadWindow ? parseLibraryFileLocation(window.location.href) : null;
        if (id) {
          setLibraryFileId(id);
          setActiveRoute("library-file");
        } else if (!isQuickChatWindow && !isThreadWindow && parseLibraryLocation(window.location.href)) {
          setLibraryCleanupTab(null);
          setActiveRoute("library");
        } else if (["sites", "library", "library-file"].includes(activeRouteRef.current)) setActiveRoute("home");
      }
    };
    window.addEventListener("popstate", restorePageRoute);
    return () => window.removeEventListener("popstate", restorePageRoute);
  }, [isQuickChatWindow, isThreadWindow, setActiveRoute]);
  useEffect(() => {
    if (((activeRoute !== "library" || libraryCleanupTab) && parseLibraryLocation(window.location.href))
      || (activeRoute !== "library-file" && parseLibraryFileLocation(window.location.href))) {
      window.history.replaceState(window.history.state, "", libraryLocationUrl(window.location.href, null));
    }
    const url = new URL(window.location.href);
    if (activeRoute === "sites" && !parseSitesLocation(url)) {
      url.pathname = "/sites";
      url.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } else if (activeRoute !== "sites" && parseSitesLocation(url)) {
      url.pathname = "/";
      url.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [activeRoute, libraryCleanupTab]);
  useEffect(() => {
    if (activeRoute === "code-review") {
      const hash = remotePullRequestUrl ? `#${new URLSearchParams({ pullRequest: remotePullRequestUrl })}` : "";
      window.history.replaceState(null, "", `/code-review${hash}`);
    } else if (window.location.pathname === "/code-review") window.history.replaceState(null, "", "/");
  }, [activeRoute, remotePullRequestUrl]);
  const deepLinkRouteRef = useRef({ route: activeRoute, revision: 0 });
  if (deepLinkRouteRef.current.route !== activeRoute) {
    deepLinkRouteRef.current = { route: activeRoute, revision: deepLinkRouteRef.current.revision + 1 };
  }
  const [pluginDirectoryMode, setPluginDirectoryMode] = useState<"installed" | "browse">("installed");
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
    // A direct file address is scoped to this visit and must not be replayed from shell history.
    if (activeRoute === "library-file") return;
    const history = routeHistoryRef.current;
    if (history.entries[history.index] === activeRoute) return;
    history.entries = [...history.entries.slice(0, history.index + 1), activeRoute];
    history.index = history.entries.length - 1;
    setRouteHistoryVersion((version) => version + 1);
  }, [activeRoute]);
  const { canGoBack, canGoForward } = useMemo(() => {
    if (activeRoute === "library-file") return { canGoBack: true, canGoForward: false };
    const history = routeHistoryRef.current;
    return {
      canGoBack: (activeRoute === "library" && !libraryCleanupTab && libraryNavigation?.canGoBack) || (activeRoute === "sites" && sitesNavigation?.canGoBack) || history.index > 0,
      canGoForward: (activeRoute === "library" && !libraryCleanupTab && libraryNavigation?.canGoForward) || (activeRoute === "sites" && sitesNavigation?.canGoForward) || history.index < history.entries.length - 1,
    };
  }, [routeHistoryVersion, activeRoute, libraryCleanupTab, libraryNavigation, sitesNavigation]);
  const navigateRouteHistory = useCallback((direction: -1 | 1): void => {
    if (activeRouteRef.current === "library-file") {
      if (direction < 0) closeLibraryFile();
      return;
    }
    if (activeRouteRef.current === "sites") {
      const navigation = sitesNavigationRef.current;
      if (direction < 0 ? navigation?.canGoBack : navigation?.canGoForward) {
        if (direction < 0) navigation!.back(); else navigation!.forward();
        return;
      }
    }
    if (activeRouteRef.current === "library") {
      const navigation = libraryNavigationRef.current;
      if (direction < 0 ? navigation?.canGoBack : navigation?.canGoForward) {
        if (direction < 0) navigation!.back(); else navigation!.forward();
        return;
      }
    }
    const history = routeHistoryRef.current;
    const nextIndex = history.index + direction;
    if (nextIndex < 0 || nextIndex >= history.entries.length) return;
    if (personalizationNavigationGuardRef.current?.(() => navigateRouteHistory(direction)) === false) return;
    navigatingRouteHistoryRef.current = true;
    history.index = nextIndex;
    setRouteHistoryVersion((version) => version + 1);
    setActiveRoute(history.entries[nextIndex]);
  }, [closeLibraryFile, setActiveRoute]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 960) {
      return true;
    }
    return false;
  });

  // 960px 官方响应式侧边栏折叠机制 (对应官方 app-initial:1351772 zIt: window.innerWidth <= 960)
  useEffect(() => {
    let prevWidth = window.innerWidth;
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      if (currentWidth <= 960 && prevWidth > 960) {
        setSidebarCollapsed(true);
      } else if (currentWidth > 960 && prevWidth <= 960) {
        setSidebarCollapsed(false);
      }
      prevWidth = currentWidth;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [activitySession, setActivitySession] = useState<ActivitySession | null>(null);
  const activitySessionRef = useRef<ActivitySession | null>(null);
  const activityGenerationRef = useRef(0);
  const activityScopeRef = useRef("");
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(false);
  const [showTerminal, setShowTerminal] = useState<boolean>(false);
  const [terminalTargetCwd, setTerminalTargetCwd] = useState<string | null>(null);
  const [pendingEnvironmentAction, setPendingEnvironmentAction] = useState<EnvironmentActionRunRequest | null>(null);
  const environmentActionScopeRef = useRef("");
  const environmentActionWaiter = useRef<{ id: string; sessionId: string; scope: string; resolve: () => void; reject: (error: Error) => void } | null>(null);
  const environmentActionRunner = useRef<((index: number) => boolean) | null>(null);
  const [environmentTarget, setEnvironmentTarget] = useState<{ id: string; cwd: string; configPath: string | null; edit?: boolean }>();
  const runEnvironmentAction = useCallback((request: EnvironmentActionRunRequest): Promise<void> => {
    if (environmentActionWaiter.current) return Promise.reject(Error("已有操作正在连接终端，请稍候。"));
    return new Promise((resolve, reject) => {
      environmentActionWaiter.current = { id: request.id, sessionId: request.sessionId, scope: environmentActionScopeRef.current, resolve, reject };
      setTerminalTargetCwd(request.cwd);
      setPendingEnvironmentAction(request);
      setShowTerminal(true);
    });
  }, []);
  const handleEnvironmentActionResult = useCallback((id: string, error?: string) => {
    const waiter = environmentActionWaiter.current;
    if (waiter?.id !== id) return;
    environmentActionWaiter.current = null;
    setPendingEnvironmentAction(current => current?.id === id ? null : current);
    if (waiter.scope !== environmentActionScopeRef.current) {
      void tauriInvoke("terminal_close", { sessionId: waiter.sessionId }).catch(() => {});
      waiter.reject(Error("操作上下文已变化，已取消等待中的终端操作。"));
    } else if (error) waiter.reject(Error(error)); else waiter.resolve();
  }, []);
  const terminalWasOpened = useRef(false);
  if (showTerminal) terminalWasOpened.current = true;
  const [pendingTermCommand, setPendingTermCommand] = useState<{
    id: number;
    command: string;
    cwd?: string;
  } | null>(null);
  const handleTerminalCommandHandled = useCallback((id: number) => {
    setPendingTermCommand((current) => current?.id === id ? null : current);
  }, []);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<string | null>(null);
  const [recentFilesByWorkspace, setRecentFilesByWorkspace] = useState<Record<string, RecentFile[]>>({});
  const explicitFileScopeRef = useRef<{ cwd: string; path: string; root: string } | null>(null);

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
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelCatalogRevisionRef = useRef(0);
  useEffect(() => () => { modelCatalogRevisionRef.current += 1; }, []);
  const [, setConfigOverview] = useState<CodexConfigOverview | null>(null);

  // Workspaces & Git State
  const [workspaces, setWorkspaces] = useState<WorkspaceRootItem[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([]);
  const [gitContextCwd, setGitContextCwd] = useState<string | null>(null);

  // Code Review
  const [reviewBusy, setReviewBusy] = useState(false);
  const appearanceState = useAppearancePreferences();
  const keyboardState = useKeyboardPreferences();
  const keyboardBindingsRef = useRef(keyboardState.bindings);
  keyboardBindingsRef.current = keyboardState.bindings;
  const keyboardNumberTargetRef = useRef(keyboardState.primaryNumberShortcutTarget);
  keyboardNumberTargetRef.current = keyboardState.primaryNumberShortcutTarget;
  const [composerEnterBehavior, setComposerEnterBehavior] = useState<ComposerEnterBehavior>("enter");
  const [composerEnterSaving, setComposerEnterSaving] = useState(true);
  const [composerEnterError, setComposerEnterError] = useState<string | null>(null);
  const composerEnterRevisionRef = useRef(0);
  const composerEnterPendingRef = useRef(true);
  const [reviewLastResult, setReviewLastResult] = useState<string | null>(null);
  const [reviewRuns, setReviewRuns] = useState<ReviewRun[]>([]);
  const [selectedReviewFinding, setSelectedReviewFinding] = useState<ModelReviewComment | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState(0);
  const [previewLine, setPreviewLine] = useState<number>();
  const [directoryReveal, setDirectoryReveal] = useState<{ cwd: string; root?: string; path: string } | null>(null);
  const skillFilePreviewHandlerRef = useRef<((path: string) => Promise<boolean>) | null>(null);
  const registerSkillFilePreviewHandler = useCallback((handler: ((path: string) => Promise<boolean>) | null) => {
    skillFilePreviewHandlerRef.current = handler;
  }, []);
  const handleOpenSkillFile = useCallback(async (path: string): Promise<boolean> => {
    flushSync(() => {
      setSelectedReviewFinding(null);
      setSelectedPreviewFile(null);
      setPreviewLine(undefined);
      setShowRightDrawer(true);
    });
    return await skillFilePreviewHandlerRef.current?.(path) ?? false;
  }, []);
  const openPreviewFile = useCallback((filePath: string, line?: number) => {
    setSelectedReviewFinding(null);
    setSelectedPreviewFile(filePath);
    setPreviewLine(line);
    setPreviewRequestId(current => current + 1);
    setShowRightDrawer(true);
  }, []);
  const reviewResultsRef = useRef<ReturnType<typeof createReviewResults> | null>(null);
  if (!reviewResultsRef.current) reviewResultsRef.current = createReviewResults(setReviewRuns);
  const reviewStartPendingRef = useRef(false);
  const [reviewDiffTarget, setReviewDiffTarget] = useState<{ cwd: string; baseBranch: string | null; mergeBase: string | null } | null>(null);
  const [archiveRefreshTick, setArchiveRefreshTick] = useState<number>(0);

  // Windows sandbox readiness（windowsSandbox/*）
  const [sandboxNotice, setSandboxNotice] = useState<string | null>(null);
  const [sandboxSettingUp, setSandboxSettingUp] = useState(false);

  // Threads, Pinned, Hints & Conversation State
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [sidebarCreatedThread, setSidebarCreatedThread] = useState<Pick<ThreadSummary, "id" | "cwd" | "projectId"> | null>(null);
  const pendingNewThreadProjectRef = useRef<SidebarLocalProject | null>(null);
  const pendingProjectlessRef = useRef(false);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const threadPinRevisionRef = useRef(0);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[] | null>(null);
  const projectPinRevisionRef = useRef(0);
  const projectPinPendingRef = useRef(false);
  const [workspaceHints, setWorkspaceHints] = useState<Record<string, string>>({});
  const [sidebarProjectMembership, setSidebarProjectMembership] = useState<SidebarProjectMembership>({
    threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {},
  });
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadScheduleTask, setThreadScheduleTask] = useState<{ id: string; threadId: string } | null>(null);
  const threadScheduleTrigger = useRef<HTMLButtonElement | null>(null);
  const showThreadSchedule = activeRoute === "thread" && threadScheduleTask?.threadId === activeThreadId;
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnData[]>([]);
  const [turnsCursor, setTurnsCursor] = useState<string | null>(null);
  const [hasMoreTurns, setHasMoreTurns] = useState<boolean>(false);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const threadRequestRef = useRef(0);
  const threadHistoryBufferRef = useRef(new ThreadHistoryBuffer());
  const replayThreadNotificationRef = useRef<(payload: any) => void>(() => {});
  const navigationRequestRef = useRef(0);
  const turnLifecycleRef = useRef(0);
  const finishedTurnIdsRef = useRef(new Set<string>());
  const earlierRequestRef = useRef(false);
  const followTimelineRef = useRef(true);
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const turnsCursorRef = useRef<string | null>(null);
  turnsCursorRef.current = turnsCursor;
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [pendingRequests, setPendingRequests] = useState<PendingServerRequest[]>([]);
  const pendingRequestsRef = useRef(pendingRequests);
  pendingRequestsRef.current = pendingRequests;
  const pendingRequestRevisionRef = useRef(0);
  const respondingRequestsRef = useRef(new Set<string>());
  const steerSendPendingRef = useRef(new Set<string>());
  const sendStartPendingRef = useRef(new Set<number>());
  const [requestResponses, setRequestResponses] = useState<Record<string, RequestResponseState>>({});
  const activePendingRequests = useMemo(() => requestsForThread(pendingRequests, activeThreadId), [pendingRequests, activeThreadId]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSnapshot | null>(null);
  const [planSteps, setPlanSteps] = useState<Array<{ step: string; status: string }>>([]);
  const [planExplanation, setPlanExplanation] = useState<string | null>(null);
  const [turnDiffFiles, setTurnDiffFiles] = useState<
    Array<{ path: string; kind: string; diff: string; additions: number; deletions: number }>
  >([]);
  const [accountInfo, setAccountInfo] = useState<AccountReadResult | null>(null);
  const [shareThreadId, setShareThreadId] = useState<string | null>(null);
  const [shareAvailable, setShareAvailable] = useState(false);
  const [shareAccessRevision, setShareAccessRevision] = useState(0);
  const [cloudRecent, setCloudRecent] = useState<{ account: AccountReadResult; revision: number; identity: ServiceIdentity; chats: CloudRecentChat[] } | null>(null);
  const currentCloudRecent = appServerStatus.connected && cloudRecent?.account === accountInfo &&
    cloudRecent?.revision === shareAccessRevision ? cloudRecent : undefined;
  const cloudRecentChats = currentCloudRecent?.chats;
  const cloudRecentChatsRef = useRef(cloudRecentChats);
  cloudRecentChatsRef.current = cloudRecentChats;
  const cloudRecentIdentityRef = useRef(currentCloudRecent?.identity);
  cloudRecentIdentityRef.current = currentCloudRecent?.identity;
  const cloudRecentWritesRef = useRef(new Map<string, AbortController>());
  const cancelCloudRecentWrites = useCallback(() => {
    for (const request of cloudRecentWritesRef.current.values()) request.abort();
    cloudRecentWritesRef.current.clear();
  }, []);
  useEffect(() => {
    if (!appServerStatus.connected || accountInfo?.account?.type !== "chatgpt" || isQuickChatWindow || isThreadWindow) {
      setCloudRecent(null);
      return;
    }
    let pending: AbortController | undefined;
    let identity: ServiceIdentity | undefined;
    let disposed = false;
    const refresh = () => {
      if (disposed) return;
      pending?.abort();
      const request = new AbortController();
      pending = request;
      void (async () => {
        const current = await serviceIdentity(request.signal);
        const expectedAccount = accountInfo.workspaceRouting?.chatgptAccountId;
        if (request.signal.aborted) return;
        if (identity && !sameCloudRecentIdentity(identity, current)) {
          setCloudRecent(null);
          cancelCloudRecentWrites();
        }
        if (expectedAccount && expectedAccount !== current.accountId) return;
        identity = current;
        const chats = await readCloudRecentChats(current, request.signal);
        if (!request.signal.aborted) setCloudRecent({ account: accountInfo, revision: shareAccessRevision, identity: current, chats });
      })().catch(() => {});
    };
    refreshCloudRecentRef.current = refresh;
    refresh();
    window.addEventListener("focus", refresh);
    const listener = tauriListen<{ identity: ServiceIdentity; method: string; hostId: string }>("cloud-app-server:notification", notice => {
      if (notice.hostId === "durable" && sameCloudRecentIdentity(identity, notice.identity) &&
        ["turn/completed", "thread/name/updated", "thread/archived", "thread/unarchived"].includes(notice.method)) refresh();
    });
    return () => {
      disposed = true;
      pending?.abort();
      cancelCloudRecentWrites();
      refreshCloudRecentRef.current = null;
      window.removeEventListener("focus", refresh);
      void listener.then(unlisten => unlisten()).catch(() => {});
    };
  }, [accountInfo, appServerStatus.connected, cancelCloudRecentWrites, isQuickChatWindow, isThreadWindow, shareAccessRevision]);
  useEffect(() => {
    const pending = new AbortController();
    setShareAvailable(false);
    if (appServerStatus.connected) {
      void readShareAccess(pending.signal).then(access => {
        if (!pending.signal.aborted) setShareAvailable(access.gate && access.account !== null);
      }).catch(() => {});
    }
    const listener = tauriListen("chatgpt-service:invalidated", () => {
      if (pending.signal.aborted) return;
      pending.abort(); setShareAvailable(false); setShareThreadId(null);
      setCloudDraft(null);
      setCloudRecent(null);
      cloudRecentChatsRef.current = undefined;
      cloudRecentIdentityRef.current = undefined;
      cancelCloudRecentWrites();
      setPublishedCloudTarget(null);
      if (activeRouteRef.current === "cloud-new-chat") setActiveRoute("cloud-environments");
      if (activeRouteRef.current === "cloud-draft") setActiveRoute(cloudDraftRef.current?.origin === "home" ? "home" : "cloud-environments");
      setShareAccessRevision(value => value + 1);
    });
    return () => { pending.abort(); void listener.then(unlisten => unlisten()).catch(() => {}); };
  }, [appServerStatus.connected, accountInfo, cancelCloudRecentWrites, shareAccessRevision, setActiveRoute]);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const keyboardShortcutsOpenRef = useRef(showKeyboardShortcuts);
  keyboardShortcutsOpenRef.current = showKeyboardShortcuts;
  const accountReadRequestRef = useRef(0);
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
  const homePromptRevisionRef = useRef(0);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(promptStorageKey) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
      return Object.fromEntries(Object.entries(stored).filter(([key, value]) =>
        (key === "home" || key.startsWith("thread:")) && typeof value === "string"
      )) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const promptDraftKey = activeThreadId ? `thread:${activeThreadId}` : "home";
  const promptInput = promptDrafts[promptDraftKey] ?? "";
  const setThreadPrompt = useCallback((threadId: string | null, update: React.SetStateAction<string>) => {
    const key = threadId ? `thread:${threadId}` : "home";
    if (threadId === null) homePromptRevisionRef.current++;
    setPromptDrafts((previous) => {
      const value = typeof update === "function" ? update(previous[key] ?? "") : update;
      if (value === previous[key] || (!value && !(key in previous))) return previous;
      const next = { ...previous };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);
  const setPromptInput = useCallback((update: React.SetStateAction<string>) => {
    setThreadPrompt(activeThreadId, update);
  }, [activeThreadId, setThreadPrompt]);
  const moveHomePromptToThread = useCallback((threadId: string) => {
    homePromptRevisionRef.current++;
    setPromptDrafts((previous) => {
      if (!previous.home) return previous;
      const next = { ...previous, [`thread:${threadId}`]: previous.home };
      delete next.home;
      return next;
    });
  }, []);
  const [permissionModes, setPermissionModes] = useState<Record<string, "custom" | "ask" | "auto" | "full">>({});
  const threadExecutionPoliciesRef = useRef(new Map<string, ExecutionPolicy>());
  const threadExecutionRevisionsRef = useRef(new Map<string, number>());
  const [useWorktree, setUseWorktree] = useState<boolean>(false);
  const [planMode, setPlanMode] = useState<boolean>(false);
  const planModeRef = useRef<boolean>(false);
  planModeRef.current = planMode;
  const [composerAttachmentDrafts, setComposerAttachmentDrafts] = useState<Record<string, AttachedFileItem[]>>({});
  const attachmentScopeRef = useRef("home");
  const attachedFiles = composerAttachmentDrafts[attachmentScopeRef.current] ?? [];
  const setScopedAttachedFiles = useCallback((key: string, update: React.SetStateAction<AttachedFileItem[]>) => {
    setComposerAttachmentDrafts((previous) => {
      const current = previous[key] ?? [];
      const nextFiles = typeof update === "function" ? update(current) : update;
      if (nextFiles === current) return previous;
      const next = { ...previous };
      if (nextFiles.length > 0) next[key] = nextFiles;
      else delete next[key];
      return next;
    });
  }, []);
  const setAttachedFiles = useCallback((update: React.SetStateAction<AttachedFileItem[]>) => {
    setScopedAttachedFiles(attachmentScopeRef.current, update);
  }, [setScopedAttachedFiles]);
  const moveHomeAttachmentsToThread = useCallback((threadId: string) => {
    setComposerAttachmentDrafts((previous) => {
      const home = previous.home;
      if (!home?.length) return previous;
      const key = `thread:${threadId}`;
      const next = { ...previous, [key]: mergeAttachmentItems(previous[key] ?? [], home) };
      delete next.home;
      return next;
    });
  }, []);
  const pendingAttachmentSaveRef = useRef<{ threadId: string; clearComposer: boolean; prompt: string; files: AttachedFileItem[] } | null>(null);
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
  const queueListRequestRef = useRef(0);
  const queueMutationThreadsRef = useRef(new Set<string>());
  const steeredQueueItemsRef = useRef(new Map<string, "accepted" | "unknown">());
  const [, setQueueMutationVersion] = useState(0);
  const [queueNotice, setQueueNotice] = useState("");
  const queueBusy = activeThreadId ? queueMutationThreadsRef.current.has(activeThreadId) : false;
  const [userInputAnswers, setUserInputAnswers] = useState<Record<string, string>>({});
  const [showGitMenu, setShowGitMenu] = useState<boolean>(false);
  const [showUsagePopover, setShowUsagePopover] = useState<boolean>(false);
  const [showSessionParamsPopover, setShowSessionParamsPopover] = useState<boolean>(false);
  const [showExportPopover, setShowExportPopover] = useState<boolean>(false);
  const [showSourcesPopover, setShowSourcesPopover] = useState<boolean>(false);
  const [showTokenMeterPopover, setShowTokenMeterPopover] = useState<boolean>(false);
  const [initialWorkbenchTab, setInitialWorkbenchTab] = useState<"newTab" | "changes" | "files" | "summary" | "browser" | "sideChat">("changes");
  const [workbenchShortcutRequest, setWorkbenchShortcutRequest] = useState<{ id: string; requestId: number; cwd: string; wasOpen: boolean } | null>(null);
  const workbenchShortcutSequence = useRef(0);
  const [sideChatPrompt, setSideChatPrompt] = useState<string>("");
  const [showPopoutModal, setShowPopoutModal] = useState<boolean>(() => window.location.pathname.startsWith("/hotkey-window") || window.location.hash.includes("hotkey-window"));
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
  const [projectsRefreshToken, setProjectsRefreshToken] = useState<number>(0);
  const [sidebarProjectCatalog, setSidebarProjectCatalog] = useState<Project[]>();
  useEffect(() => {
    if (!appServerStatus.connected || isThreadWindow || isQuickChatWindow) {
      setSidebarProjectCatalog(undefined);
      return;
    }
    let current = true;
    void listProjects().then(projects => {
      if (current) setSidebarProjectCatalog(projects);
    }).catch(() => {});
    return () => { current = false; };
  }, [appServerStatus.connected, appServerStatus.binaryPath, projectsRefreshToken, isThreadWindow, isQuickChatWindow]);

  // In-session Hyperparameters
  const [sessionTemperature, setSessionTemperature] = useState<number>(0.2);
  const [sessionTopP, setSessionTopP] = useState<number>(1.0);
  const [sessionMaxTokens, setSessionMaxTokens] = useState<number>(8192);
  const [sessionWebSearch, setSessionWebSearch] = useState<"disabled" | "cached" | "live">("cached");
  const [sessionAllowNetwork, setSessionAllowNetwork] = useState<boolean>(true);
  const [sessionVerbosity, setSessionVerbosity] = useState<"low" | "medium" | "high">("medium");

  const [petVisible, setPetVisible] = useState<boolean>(false);
  const petPreferencesState = usePetPreferences();
  const [showQuickSearch, setShowQuickSearch] = useState<boolean>(false);
  const [quickSearchMode, setQuickSearchMode] = useState<"root" | "files">("root");
  const [quickSearchInitialQuery, setQuickSearchInitialQuery] = useState({ value: "" });
  const lastFileSearchSeed = useRef("");
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
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const appToastSequenceRef = useRef(0);
  const [editingThreadTitle, setEditingThreadTitle] = useState(false);
  const [threadTitleInput, setThreadTitleInput] = useState("");
  const [projectMoveConfirmation, setProjectMoveConfirmation] = useState<{
    threadId: string;
    targetProjectId: string | null;
    projectName: string;
    plan: any;
  } | null>(null);
  const [projectMoveBusy, setProjectMoveBusy] = useState(false);
  const projectMoveCancelRef = useRef<HTMLButtonElement>(null);

  const showAppToast = useCallback(
    (message: string, type: "info" | "success" | "error" = "info", action?: { label: string; onClick: () => void }) => {
      const id = ++appToastSequenceRef.current;
      let used = false;
      setAppToast({ id, message, type, action: action && { label: action.label, onClick: () => {
        if (used) return;
        used = true;
        setAppToast(prev => prev?.id === id ? null : prev);
        action.onClick();
      } } });
      setTimeout(() => {
        setAppToast((prev) => (prev?.id === id ? null : prev));
      }, 3200);
    },
    []
  );

  const handleCloudRecentAction = async (chat: CloudRecentChat, action: CloudRecentAction) => {
    const { threadId, identity } = chat.session;
    const activeIdentity = () => sameCloudRecentIdentity(cloudRecentIdentityRef.current, identity);
    if (!activeIdentity() || cloudRecentWritesRef.current.has(threadId) ||
      (action.kind !== "unarchive" && !cloudRecentChatsRef.current?.includes(chat))) return;
    const request = new AbortController();
    cloudRecentWritesRef.current.set(threadId, request);
    const active = () => !request.signal.aborted && activeIdentity();
    try {
      if (!await applyCloudRecentAction(chat, action, request.signal) || !active()) return;
      if (action.kind === "rename") {
        const title = action.name.trim();
        setCloudRecent(current => current && sameCloudRecentIdentity(current.identity, identity) ? {
          ...current, chats: current.chats.map(row => row.session.threadId === threadId ? { ...row, title } : row),
        } : current);
        setCloudDraft(current => current?.session.threadId === threadId &&
          sameCloudRecentIdentity(current.session.identity, identity) ? { ...current, title } : current);
      } else if (action.kind === "archive") {
        setCloudRecent(current => current && sameCloudRecentIdentity(current.identity, identity) ? {
          ...current, chats: current.chats.filter(row => row.session.threadId !== threadId),
        } : current);
        const open = cloudDraftRef.current?.session;
        if (activeRouteRef.current === "cloud-draft" && open?.threadId === threadId && sameCloudRecentIdentity(open.identity, identity)) {
          setCloudDraft(null);
          setActiveRoute("home");
        }
        showAppToast("聊天已归档", "info", {
          label: "撤销", onClick: () => void handleCloudRecentAction(chat, { kind: "unarchive" }),
        });
      } else {
        showAppToast("聊天已取消归档");
      }
      refreshCloudRecentRef.current?.();
    } catch (error) {
      if (active()) {
        showAppToast(`云端聊天操作未确认：${serviceErrorMessage(error)}`, "error");
        refreshCloudRecentRef.current?.();
      }
    } finally {
      if (cloudRecentWritesRef.current.get(threadId) === request) cloudRecentWritesRef.current.delete(threadId);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(promptStorageKey, JSON.stringify(promptDrafts));
    } catch (error) {
      showAppToast(`草稿保存失败，当前输入仍保留：${String(error)}`, "error");
    }
  }, [promptDrafts, promptStorageKey, showAppToast]);

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
    const files = pending.files;
    if (files.length === 0) {
      if (pending.clearComposer) setThreadPrompt(threadId, value => value === pending.prompt ? "" : value);
      return;
    }
    const { errors } = await persistThreadAttachments(threadId, files);
    if (errors.length > 0) {
      showAppToast(`消息已发送，但附件保存失败: ${errors[0].message}`, "error");
      return;
    }
    if (pending.clearComposer) {
      setThreadPrompt(threadId, value => value === pending.prompt ? "" : value);
      setScopedAttachedFiles(`thread:${threadId}`, current => current.filter(file => !files.includes(file)));
    }
  }, [showAppToast, setThreadPrompt, setScopedAttachedFiles]);

  // Official Thread Goal State (`thread/goal/*`)
  const [serverGoal, setServerGoal] = useState<ThreadGoal | null>(null);
  const [showGoalModal, setShowGoalModal] = useState<boolean>(false);
  const serverGoalRef = useRef<ThreadGoal | null>(null);
  serverGoalRef.current = serverGoal;
  const handleSaveGoalRef = useRef<((objective: string) => Promise<void>) | null>(null);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  useEffect(() => {
    if (composerFocusRequest > 0) composerTextareaRef.current?.focus();
  }, [composerFocusRequest]);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  activeThreadIdRef.current = activeThreadId;
  attachmentScopeRef.current = activeThreadId ? `thread:${activeThreadId}` : "home";
  const activeTurnIdRef = useRef<string | null>(null);
  activeTurnIdRef.current = activeTurnId;
  const pendingTurnIdRef = useRef<string | null>(null);
  const workspaceWatchIdRef = useRef<string | null>(null);
  const fsRefreshTimerRef = useRef<any>(null);

  const activeWorkspace = useMemo(() => {
    return workspaces.find((w) => w.active) || workspaces[0] || null;
  }, [workspaces]);
  const modelAccountIdentity = JSON.stringify(accountInfo);
  const homeCloud = useHomeCloudComposer(activeRoute === "home" && appServerStatus.connected &&
    accountInfo?.account?.type === "chatgpt" && !isQuickChatWindow && !isThreadWindow
    ? JSON.stringify([modelAccountIdentity, shareAccessRevision, navigationRequestRef.current]) : null);
  const worktreeCreationControllersRef = useRef(new Map<AbortController, MainViewRoute>());
  const worktreeProjectScope = JSON.stringify([sidebarProjectMembership.selectedProjectId, sidebarProjectMembership.localProjects?.find(project => project.id === sidebarProjectMembership.selectedProjectId)?.rootPaths]);
  const skillTrialContextKey = JSON.stringify([modelAccountIdentity, activeWorkspace?.path, worktreeProjectScope, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent]);
  const skillTrialContextRef = useRef({ key: skillTrialContextKey });
  if (skillTrialContextRef.current.key !== skillTrialContextKey) skillTrialContextRef.current = { key: skillTrialContextKey };
  const skillTrialRequestRef = useRef(0);
  const createWorktree = useCallback(async (options: WorktreeCreationOptions) => {
    const controller = new AbortController();
    worktreeCreationControllersRef.current.set(controller, activeRouteRef.current);
    try { return await createEnvironmentWorktree(options, controller.signal); }
    finally { worktreeCreationControllersRef.current.delete(controller); }
  }, []);
  useEffect(() => () => {
    for (const controller of worktreeCreationControllersRef.current.keys()) controller.abort();
    worktreeCreationControllersRef.current.clear();
  }, [activeWorkspace?.path, activeThreadId, worktreeProjectScope, modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent]);
  useEffect(() => {
    for (const [controller, route] of worktreeCreationControllersRef.current) if (route !== activeRoute) controller.abort();
  }, [activeRoute]);
  useEffect(() => { setTerminalTargetCwd(null); }, [activeWorkspace?.path]);
  const executionIdentityRef = useRef(modelAccountIdentity);
  if (executionIdentityRef.current !== modelAccountIdentity) {
    executionIdentityRef.current = modelAccountIdentity;
    threadExecutionPoliciesRef.current.clear();
    for (const [threadId, revision] of threadExecutionRevisionsRef.current) threadExecutionRevisionsRef.current.set(threadId, revision + 1);
  }
  const permissionScope = `${modelAccountIdentity}:${activeThreadId ?? `draft:${activeWorkspace?.path ?? ""}`}`;
  const permissionMode = permissionModes[permissionScope] ?? "custom";
  const setPermissionMode = useCallback((mode: "ask" | "auto" | "full") => {
    setPermissionModes(previous => ({ ...previous, [permissionScope]: mode }));
  }, [permissionScope]);
  const captureThreadExecutionPolicy = useCallback((threadId: string, response: unknown, expectedRevision?: number) => {
    const revision = threadExecutionRevisionsRef.current.get(threadId) ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) return threadExecutionPoliciesRef.current.get(threadId);
    threadExecutionRevisionsRef.current.set(threadId, revision + 1);
    const resolved = readThreadExecutionPolicy(response);
    if (resolved) threadExecutionPoliciesRef.current.set(threadId, resolved);
    else threadExecutionPoliciesRef.current.delete(threadId);
    return resolved;
  }, []);
  const resolveExecutionContext = useCallback(async (threadId: string | null, cwd: string | undefined, workspaceRoots: string[]) => {
    const identity = executionIdentityRef.current;
    if (threadId) {
      let resolved = threadExecutionPoliciesRef.current.get(threadId);
      if (!resolved) {
        const revision = threadExecutionRevisionsRef.current.get(threadId) ?? 0;
        const response = await callAppServer<any>("thread/resume", { threadId });
        if (identity !== executionIdentityRef.current) throw new Error("账号已变化，请重新发送");
        resolved = captureThreadExecutionPolicy(threadId, response, revision);
      }
      if (!resolved) throw new Error("尚未确认当前聊天的权限，输入已保留");
      return { policy: permissionMode === "custom" ? resolved : resolvePresetExecutionPolicy(permissionMode, workspaceRoots, sessionAllowNetwork), summary: undefined as string | undefined, config: undefined as Record<string, unknown> | undefined };
    }
    const { config } = await configRead(cwd, true);
    if (identity !== executionIdentityRef.current) throw new Error("账号已变化，请重新发送");
    const summary = config.model_reasoning_summary;
    if (summary != null && !["auto", "concise", "detailed", "none"].includes(String(summary))) throw new Error("无法识别推理摘要配置");
    return { policy: permissionMode === "custom" ? resolveConfiguredExecutionPolicy(config, workspaceRoots) : resolvePresetExecutionPolicy(permissionMode, workspaceRoots, sessionAllowNetwork), summary: typeof summary === "string" ? summary : undefined, config };
  }, [permissionMode, sessionAllowNetwork, captureThreadExecutionPolicy]);
  const modelSelection = useModelSelection({
    models, modelsLoading, connected: appServerStatus.connected,
    threadId: activeThreadId, cwd: activeWorkspace?.path,
    authMethod: accountInfo?.account?.type ?? null,
    accountIdentity: modelAccountIdentity,
  });
  const {
    selectedModelId, defaultModelSelected, reasoningEffort, fastMode,
    selectModel: handleSelectComposerModel, selectEffort: setReasoningEffort,
    toggleFast: toggleFastMode, getConfiguration: getModelConfiguration,
    hydrateThread: hydrateThreadModel, trackTurn: trackModelTurn,
    beginThreadHydration: beginThreadModelHydration,
    applyThreadSettings: applyModelThreadSettings,
    onUserMessageCompleted: recordModelUserMessage,
  } = modelSelection;
  const selectedModelName = modelRequestName(models, selectedModelId);

  const workspaceReviewRuns = reviewRuns.filter(run => activeWorkspace?.path &&
    attachmentIdentityKey(run.cwd) === attachmentIdentityKey(activeWorkspace.path));
  const latestReview = workspaceReviewRuns.reduce<ReviewRun | null>((latest, run) =>
    !latest || (run.startedAt ?? 0) > (latest.startedAt ?? 0) ||
      run.startedAt === latest.startedAt && run.sequence > latest.sequence ? run : latest, null);
  const reviewFindings = useMemo(() => {
    const comments = new Map<string, ReturnType<typeof parseReviewFindings>["comments"][number]>();
    const unresolved = new Map<string, ReturnType<typeof parseReviewFindings>["unresolved"][number]>();
    for (const run of reviewRuns) {
      if (run.threadId !== (activeRoute === "review" ? latestReview?.threadId : activeThreadId) || !run.turnId ||
        !["completed", "failed", "interrupted"].includes(run.status)) continue;
      const parsed = parseReviewFindings(run.text, { threadId: run.threadId, turnId: run.turnId,
        cwd: run.cwd, workspaceRoots: run.workspaceRoots });
      for (const comment of parsed.comments) comments.set(comment.id, comment);
      for (const finding of parsed.unresolved) unresolved.set(finding.id, finding);
    }
    return { comments: [...comments.values()], unresolved: [...unresolved.values()] };
  }, [reviewRuns, activeThreadId, activeRoute, latestReview?.threadId]);
  const reviewContextRef = useRef({ cwd: activeWorkspace?.path, route: activeRoute, generation: 0 });
  if (reviewContextRef.current.cwd !== activeWorkspace?.path || reviewContextRef.current.route !== activeRoute) {
    reviewContextRef.current = { cwd: activeWorkspace?.path, route: activeRoute, generation: reviewContextRef.current.generation + 1 };
  }

  // 1. Load Workspaces & Thread Metadata from Rust DesktopStateManager
  const refreshWorkspaceGenerationRef = useRef(0);
  const refreshWorkspacesAndMeta = useCallback(async () => {
    const threadPinRevision = threadPinRevisionRef.current;
    const projectPinRevision = projectPinRevisionRef.current;
    const generation = ++refreshWorkspaceGenerationRef.current;
    let wsList: WorkspaceRootItem[] | undefined;
    try {
      wsList = await tauriInvoke<WorkspaceRootItem[]>("workspace_list");
      if (generation !== refreshWorkspaceGenerationRef.current) return;
    } catch (e) {
      if (generation !== refreshWorkspaceGenerationRef.current) return;
      console.warn("workspace_list failed:", e);
      return;
    }

    try {
      const meta = await tauriInvoke<{
        pinnedThreadIds: string[];
        pinnedProjectIds?: string[];
        archivedThreads: any[];
        workspaceHints: Record<string, string>;
        projectMembership?: SidebarProjectMembership;
      }>("threads_meta_get");
      if (generation !== refreshWorkspaceGenerationRef.current) return;
      if (meta) {
        if (threadPinRevision === threadPinRevisionRef.current) setPinnedThreadIds(meta.pinnedThreadIds || []);
        if (projectPinRevision === projectPinRevisionRef.current) setPinnedProjectIds(meta.pinnedProjectIds || []);
        setWorkspaceHints(meta.workspaceHints || {});
        setSidebarProjectMembership(meta.projectMembership ?? {
          threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {},
        });
      }
    } catch (e) {
      if (generation !== refreshWorkspaceGenerationRef.current) return;
      console.warn("threads_meta_get failed:", e);
      return;
    }
    if (wsList && wsList.length > 0) setWorkspaces(wsList);
  }, []);

  // 2. Refresh Git Status & Branches for activeWorkspace
  const gitRefreshRequestRef = useRef(0);
  const refreshGitStatus = useCallback(async () => {
    const request = ++gitRefreshRequestRef.current;
    const cwd = activeWorkspace?.path;
    setGitContextCwd((current) => current === cwd ? current : null);
    if (!cwd) {
      setGitStatus(null);
      setGitBranches([]);
      return;
    }
    const isCurrent = () => request === gitRefreshRequestRef.current && reviewContextRef.current.cwd === cwd;
    try {
      const status = await tauriInvoke<GitStatusInfo>("git_status", {
        cwd,
      });
      if (!isCurrent()) return;
      setGitStatus(status);
    } catch {
      if (!isCurrent()) return;
      setGitStatus(null);
    }

    try {
      const branches = await tauriInvoke<string[]>("git_branches", {
        cwd,
      });
      if (!isCurrent()) return;
      if (Array.isArray(branches)) {
        setGitBranches(branches);
        setGitContextCwd(cwd);
      }
    } catch {
      if (isCurrent()) {
        setGitBranches([]);
        setGitContextCwd(null);
      }
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
  const refreshThreadsGenerationRef = useRef(0);
  const refreshThreads = useCallback(async () => {
    const generation = ++refreshThreadsGenerationRef.current;
    const readPages = async (stateDbOnly: boolean): Promise<ThreadSummary[] | null> => {
      let cursor: string | null = null;
      const visited = new Set<string>();
      const items = new Map<string, ThreadSummary>();
      do {
        let response: { data?: ThreadSummary[]; threads?: ThreadSummary[]; nextCursor?: string | null; readStates?: Record<string, unknown> | null } | ThreadSummary[];
        try {
          response = await callAppServer("thread/list", {
            limit: 100,
            archived: false,
            sortKey: "updated_at",
            sortDirection: "desc",
            ...(stateDbOnly ? { useStateDbOnly: true } : {}),
            ...(cursor !== null ? { cursor } : {}),
          });
        } catch (error) {
          if (generation !== refreshThreadsGenerationRef.current) return null;
          if (stateDbOnly && cursor === null) return readPages(false);
          throw error;
        }
        if (generation !== refreshThreadsGenerationRef.current) return null;
        const page = Array.isArray(response) ? response : response.data || response.threads || [];
        for (const thread of page) {
          if (!items.has(thread.id)) {
            const receipt = Array.isArray(response) ? undefined : response.readStates?.[thread.id];
            items.set(thread.id, receipt !== undefined && isThreadReadState(receipt)
              ? { ...thread, readState: receipt } : thread);
          }
        }
        cursor = Array.isArray(response) ? null : response.nextCursor ?? null;
        if (cursor !== null) {
          if (visited.has(cursor)) throw new Error("thread/list returned a repeated cursor");
          visited.add(cursor);
        }
      } while (cursor !== null);
      if (stateDbOnly && items.size === 0) return readPages(false);
      return [...items.values()];
    };
    try {
      const list = await readPages(true);
      if (list !== null && generation === refreshThreadsGenerationRef.current) setThreads(list);
    } catch (error) {
      if (generation === refreshThreadsGenerationRef.current) console.warn("thread/list refresh failed; previous list retained:", error);
    }
  }, []);

  const readStateWritesRef = useRef(new Set<string>());
  const handleSetThreadReadState = useCallback(async (threadId: string, expectedRevision: string, unread: boolean) => {
    if (readStateWritesRef.current.has(threadId)) return;
    readStateWritesRef.current.add(threadId);
    try {
      const result = await callAppServer<any>("thread/readState/update", {
        threadId, expectedRevision, operation: { type: unread ? "unread" : "read" },
      });
      if (!isThreadReadState(result?.readState)) throw new Error("服务未返回有效会话已读状态");
      await refreshThreads();
    } catch (error) {
      showAppToast(`更新会话已读状态失败：${String(error)}`, "error");
      await refreshThreads();
    } finally {
      readStateWritesRef.current.delete(threadId);
    }
  }, [refreshThreads, showAppToast]);

  const refreshModels = useCallback(async () => {
    const revision = ++modelCatalogRevisionRef.current;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await loadModelCatalog();
      if (revision !== modelCatalogRevisionRef.current) return;
      setModels(list);
    } catch (error) {
      if (revision === modelCatalogRevisionRef.current) setModelsError(`读取模型失败：${String(error)}`);
    } finally {
      if (revision === modelCatalogRevisionRef.current) setModelsLoading(false);
    }
  }, []);

  const refreshPendingRequests = useCallback(async function refreshPendingRequests() {
    const revision = pendingRequestRevisionRef.current;
    try {
      const list = await tauriInvoke<PendingServerRequest[]>("app_server_pending_requests");
      if (revision !== pendingRequestRevisionRef.current) {
        void refreshPendingRequests();
        return;
      }
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
    const request = ++accountReadRequestRef.current;
    setRateLimits(null);
    try {
      const info = await callAppServer<AccountReadResult>("account/read", {});
      if (request !== accountReadRequestRef.current) return;
      setAccountInfo(info ?? null);
    } catch (e) {
      if (request !== accountReadRequestRef.current) return;
      setAccountInfo(null);
      console.warn("account/read failed:", e);
    }
    try {
      const limits = await callAppServer<any>("account/rateLimits/read", {});
      if (request !== accountReadRequestRef.current) return;
      setRateLimits(limits ?? null);
    } catch (e) {
      if (request !== accountReadRequestRef.current) return;
      setRateLimits(null);
      console.warn("account/rateLimits/read failed:", e);
    }
  }, []);

  const notificationState = useNotificationPreferences();
  const gitPreferencesState = useGitPreferences();
  const codeReviewPreferencesState = useCodeReviewPreferences();
  const externalImportsState = useExternalImports(async () => {
    await Promise.all([refreshConfigOverview(), refreshModels(), refreshThreads()]);
  });
  const notificationContextRef = useRef({ route: activeRoute, ready: false });
  const notificationAccountRef = useRef<string | null>(null);
  const notificationNativeActionRef = useRef<(event: any) => Promise<void>>(async () => {});
  notificationContextRef.current = { route: activeRoute, ready: notificationState.ready };
  useEffect(() => () => { notificationContextRef.current.ready = false; }, []);
  useEffect(() => {
    let disposed = false;
    notificationAccountRef.current = null;
    if (accountInfo !== null && appServerStatus.connected) {
      void tauriInvoke<{accountKey: string}>("notification_account_context").then(context => {
        if (!disposed) notificationAccountRef.current = context.accountKey;
      }).catch(error => { if (!disposed) showAppToast(`通知身份读取失败：${String(error)}`, "error"); });
    }
    const off = tauriListen("chatgpt-service:invalidated", () => { notificationAccountRef.current = null; });
    off.catch(error => { if (!disposed) showAppToast(`通知身份订阅失败：${String(error)}`, "error"); });
    return () => { disposed = true; off.then(stop => stop()).catch(() => {}); };
  }, [accountInfo, appServerStatus.connected]);
  useEffect(() => {
    void tauriInvoke("notification_view_update", {
      threadId: activeRoute === "thread" || isQuickChatWindow ? activeThreadId : null,
    }).catch(error => showAppToast(`通知窗口状态更新失败：${String(error)}`, "error"));
  }, [activeRoute, activeThreadId, isQuickChatWindow]);
  useEffect(() => {
    let disposed = false;
    const off = tauriListen<any>("desktop-notification-event", event => {
      if (disposed) return;
      if (event.kind === "failed") { showAppToast(`系统通知显示失败：${String(event.error || "未知错误")}`, "error"); return; }
      if (event.kind === "activated") void notificationNativeActionRef.current(event)
        .catch(error => showAppToast(`打开通知失败：${String(error)}`, "error"));
    });
    off.catch(error => { if (!disposed) showAppToast(`通知订阅失败：${String(error)}`, "error"); });
    return () => { disposed = true; off.then(stop => stop()).catch(() => {}); };
  }, []);
  useEffect(() => {
    const hideVisible = () => {
      if (activeRoute !== "thread" || !activeThreadId || !document.hasFocus()) return;
      void tauriInvoke("desktop_notification_hide_conversation", { hostId: "local", threadId: activeThreadId,
        messageCreatedAtOrBefore: Date.now() }).catch(error => showAppToast(`撤回已读通知失败：${String(error)}`, "error"));
    };
    hideVisible();
    window.addEventListener("focus", hideVisible);
    return () => window.removeEventListener("focus", hideVisible);
  }, [activeRoute, activeThreadId]);
  const dispatchNotification = useMemo(() => createNotificationDispatcher({
    preferences: () => notificationState.current.current,
    focused: () => document.hasFocus() && !document.hidden,
    visible: threadId => notificationContextRef.current.route === "thread" && threadId === activeThreadIdRef.current,
    nativeClaim: event => tauriInvoke("notification_claim", {
      eventId: JSON.stringify([event.accountKey, event.id]), category: event.category, threadId: event.threadId ?? null,
    }),
    send: (title, body, event) => event.threadId ? tauriInvoke("desktop_notification_show", { payload: {
      id: event.id, hostId: "local", threadId: event.threadId, title, body,
      requestId: event.requestId, requestNonce: event.requestNonce, createdAt: event.createdAt, accountKey: event.accountKey,
      actions: event.actions, persistent: event.category === "permission" || event.category === "question",
    } }) : Promise.resolve({ status: "suppressed" }),
    play: (sound, kind) => playNotificationChime(kind, sound),
    onError: error => showAppToast(`通知发送失败：${String(error)}`, "error"),
  }), []);
  const notify = useCallback((event: NotificationEvent) => {
    const accountKey = notificationAccountRef.current;
    if (!accountKey) return Promise.resolve();
    return dispatchNotification({ ...event, accountKey, createdAt: event.createdAt ?? Date.now(),
      valid: () => notificationAccountRef.current === accountKey && event.valid?.() !== false });
  }, [dispatchNotification]);
  useEffect(() => {
    let cancelled = false;
    const revision = composerEnterRevisionRef.current;
    const tauriLoad = tauriInvoke("desktop_state_get", { key: "composerEnterBehavior" }).then((value) => {
      if (!cancelled && revision === composerEnterRevisionRef.current) {
        setComposerEnterBehavior(normalizeComposerEnterBehavior(value));
      }
    }).catch((error) => {
      if (!cancelled && revision === composerEnterRevisionRef.current) setComposerEnterError(`读取发送快捷键失败：${String(error)}`);
    });
    tauriLoad.finally(() => {
      if (!cancelled && revision === composerEnterRevisionRef.current) {
        composerEnterPendingRef.current = false;
        setComposerEnterSaving(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleSetComposerEnterBehavior = useCallback(async (value: ComposerEnterBehavior) => {
    if (composerEnterPendingRef.current) return;
    const next = normalizeComposerEnterBehavior(value);
    const previous = composerEnterBehavior;
    ++composerEnterRevisionRef.current;
    composerEnterPendingRef.current = true;
    setComposerEnterSaving(true);
    setComposerEnterError(null);
    setComposerEnterBehavior(next);
    let written = false;
    try {
      await tauriInvoke("desktop_state_set", { key: "composerEnterBehavior", value: next });
      written = true;
      const saved = await tauriInvoke("desktop_state_get", { key: "composerEnterBehavior" });
      if (saved !== next) throw new Error("发送快捷键读回结果与保存值不一致");
      setComposerEnterBehavior(normalizeComposerEnterBehavior(saved));
    } catch (error) {
      if (!written) setComposerEnterBehavior(previous);
      setComposerEnterError(`${written ? "已保存，但确认失败" : "保存失败，已还原"}：${String(error)}`);
    } finally {
      composerEnterPendingRef.current = false;
      setComposerEnterSaving(false);
    }
  }, [composerEnterBehavior]);

  // Connect & Subscribe to App-Server Events on Mount
  useEffect(() => {
    refreshWorkspacesAndMeta();
    refreshConfigOverview();

    tauriInvoke<any>("desktop_state_get", { key: "desktopPreferences" })
      .then((prefs) => {
        if (prefs && typeof prefs === "object") {
          if (prefs.customPersonaPrompt) setCustomInstructions(prefs.customPersonaPrompt);
          if (prefs.toneStyle) setToneStyle(prefs.toneStyle);
        }
      })
      .catch(() => {});

  }, []);

  // 旧的挂载副作用（确保只执行一次）
  useEffect(() => {
    let disposed = false;
    let reviewReconnectRevision = 0;
    const restoreReviewResults = async () => {
      const revision = ++reviewReconnectRevision;
      const pending = reviewResultsRef.current!.getRuns().filter(run => run.status === "unknown");
      await Promise.allSettled([...new Set(pending.map(run => run.threadId))].map(async threadId => {
        try {
          const before = JSON.stringify(reviewResultsRef.current!.getRuns().filter(run => run.threadId === threadId));
          const metadata = await callAppServer<any>("thread/read", { threadId, includeTurns: false });
          const turns: TurnData[] = [];
          const cursors = new Set<string>();
          let cursor: string | undefined;
          do {
            const page = await callAppServer<any>("thread/turns/list", {
              threadId, limit: 20, sortDirection: "desc", itemsView: "full", ...(cursor ? { cursor } : {}),
            });
            turns.unshift(...normalizeTurnsFromList(page, true));
            const known = pending.filter(run => run.threadId === threadId && run.turnId);
            if (known.length && known.every(run => turns.some(turn => turn.id === run.turnId))) break;
            cursor = page?.nextCursor || undefined;
            if (cursor && cursors.has(cursor)) throw new Error("审查历史分页游标重复");
            if (cursor) cursors.add(cursor);
          } while (cursor && !disposed && revision === reviewReconnectRevision);
          if (disposed || revision !== reviewReconnectRevision || before !==
            JSON.stringify(reviewResultsRef.current!.getRuns().filter(run => run.threadId === threadId))) return;
          const cwd = metadata?.thread?.cwd || pending.find(run => run.threadId === threadId)!.cwd;
          reviewResultsRef.current!.hydrate(threadId, cwd, [cwd], turns);
        } catch (error) {
          if (!disposed && revision === reviewReconnectRevision) console.warn("审查结果历史读回失败", error);
        }
      }));
    };
    setThreadEventsReady(false);
    // Ensure app-server is connected
    tauriInvoke<AppServerStatus>("app_server_connect")
      .then((st) => {
        setAppServerStatus(st);
        if (st.connected) {
          void restoreReviewResults();
          refreshModels();
          refreshThreads();
          refreshPendingRequests();
          refreshAccount();
          setProjectsRefreshToken((prev) => prev + 1);
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
        if (!status.connected) {
          reviewReconnectRevision += 1;
          reviewResultsRef.current!.disconnected();
          accountReadRequestRef.current += 1;
          setAccountInfo(null);
          pendingRequestRevisionRef.current += 1;
          setPendingRequests([]);
          setRequestResponses({});
        }
        if (status.connected) {
          void restoreReviewResults();
          refreshModels();
          refreshThreads();
          refreshPendingRequests();
          refreshAccount();
        }
      }
    );

    const handleNotification = (payload: any, replay = false) => {
        const { method, params } = payload || {};
        if (!method) return;
        if (!replay) reviewResultsRef.current!.ingest(payload);

        const eventThreadId = params?.threadId ?? params?.thread_id;
        const eventTurnId = params?.turnId ?? params?.turn?.id ?? params?.turn_id;
        if (!replay && method === "thread/settings/updated" && typeof eventThreadId === "string" && params?.threadSettings) {
          applyModelThreadSettings(eventThreadId, params.threadSettings);
          captureThreadExecutionPolicy(eventThreadId, params);
        }
        if (!replay && method === "item/completed" && params?.item?.type === "userMessage") {
          void recordModelUserMessage(eventThreadId, eventTurnId, params.item.id).catch(error => {
            console.warn("最近模型记录未保存", error);
          });
        }
        const scopedEvent = method.startsWith("item/") || method.startsWith("turn/") ||
          method === "codex/event/agent_message_delta" ||
          method === NOTIFICATION.THREAD_COMPACTED || method === NOTIFICATION.THREAD_TOKEN_USAGE;
        if (scopedEvent && eventThreadId !== activeThreadIdRef.current && method !== "turn/completed") return;
        if (scopedEvent && eventThreadId === activeThreadIdRef.current &&
          threadHistoryBufferRef.current.capture(payload, threadRequestRef.current)) return;

        if (method === "turn/started") {
          const turnId = params?.turn?.id || params?.turnId || `turn-${Date.now()}`;
          if (finishedTurnIdsRef.current.has(turnId)) return;
          turnLifecycleRef.current += 1;
          setIsStreaming(true);
          setActiveTurnId(turnId);
          setTurns((prev) => {
            if (prev.some((t) => t.id === turnId)) return prev;
            const pendingId = typeof pendingTurnIdRef !== "undefined" ? pendingTurnIdRef?.current : null;
            const pendingIdx = prev.findIndex((t) => (pendingId && t.id === pendingId) || t.id.startsWith("pending-") || t.id.startsWith("user-"));
            if (pendingIdx >= 0) {
              const updated = [...prev];
              updated[pendingIdx] = {
                ...updated[pendingIdx],
                id: turnId,
                status: "running",
              };
              return updated;
            }
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
          if (typeof pendingTurnIdRef !== "undefined" && pendingTurnIdRef) pendingTurnIdRef.current = null;
          void flushPendingAttachmentSave(params.threadId);
        } else if (method === "turn/completed") {
          const isVisibleThread = eventThreadId === activeThreadIdRef.current;
          if (isVisibleThread) {
            if (eventTurnId) finishedTurnIdsRef.current.add(eventTurnId);
            turnLifecycleRef.current += 1;
            if (!activeTurnIdRef.current || activeTurnIdRef.current === eventTurnId) setIsStreaming(false);
          }
          if (eventThreadId && eventTurnId && shouldNotifyTurn(params)) void notify({
            id: `turn-${JSON.stringify([eventThreadId, eventTurnId])}`, category: "turn", threadId: eventThreadId,
            title: "Codex 回复已完成",
            body: threadsRef.current.find(thread => thread.id === eventThreadId)?.name || "本轮任务已完成",
            valid: () => notificationContextRef.current.ready,
          });
          const turnId = params?.turn?.id || params?.turnId;
          if (isVisibleThread && (!turnId || turnId === activeTurnIdRef.current)) {
            setActiveTurnId(null);
            setPlanSteps([]);
            setPlanExplanation(null);
          }
          const duration = params?.turn?.durationMs || params?.turnDurationMs;
          const completedItems = Array.isArray(params?.turn?.items)
            ? params.turn.items
            : null;
          if (isVisibleThread) setTurns((prev) => {
            const filtered = prev.filter((t) => !(t.id.startsWith("pending-") || t.id.startsWith("user-")) || t.id === turnId);
            return filtered.map((t) => {
              const isTarget = t.id === turnId || (!turnId && t.status === "running");
              if (!isTarget) return t;
              let items = t.items;
              if (completedItems && completedItems.length > 0) {
                const hasServerUserMsg = completedItems.some((it: any) => it.type === "userMessage" || it.type === "user");
                const localItems = hasServerUserMsg
                  ? t.items.filter((it: any) => it.type !== "userMessage" && it.type !== "user")
                  : t.items;
                const byId = new Map<string, any>();
                for (const it of localItems) if (it?.id) byId.set(it.id, it);
                for (const it of completedItems) {
                  const existing = it?.id ? byId.get(it.id) : undefined;
                  if (existing) byId.set(it.id, { ...existing, ...it });
                  else if (it?.id) byId.set(it.id, it);
                }
                const merged: any[] = [];
                const seen = new Set<string>();
                for (const it of [...localItems, ...completedItems]) {
                  if (!it?.id) continue;
                  if (seen.has(it.id)) {
                    const idx = merged.findIndex((m) => m.id === it.id);
                    if (idx >= 0) merged[idx] = { ...merged[idx], ...it };
                    continue;
                  }
                  seen.add(it.id);
                  merged.push(byId.get(it.id) ?? it);
                }
                for (const it of localItems) if (!it?.id) merged.push(it);
                items = merged;
              }
              return {
                ...t,
                status: params?.turn?.status ?? "completed",
                completedAt: Date.now(),
                durationMs: duration,
                items,
                error: params?.turn?.error ?? t.error,
              } as TurnData;
            });
          });
          refreshGitStatus();
          refreshThreads();
          if (turnId && !isThreadWindow) {
            setInboxItems((prev) => {
              const entryId = `turn-done-${turnId}`;
              if (prev.some((item) => item.id === entryId)) return prev;
              return [
                {
                  id: entryId,
                  title: "会话回复已完成",
                  subtitle: `turn ${String(turnId).slice(0, 8)}`,
                  kind: "thread_done" as const,
                  threadId: eventThreadId || undefined,
                  createdAt: Date.now(),
                  read: false,
                },
                ...prev,
              ].slice(0, 100);
            });
          }

          // Check official thread goal completion
          if (isVisibleThread && serverGoalRef.current) {
            const tid = eventThreadId;
            if (tid) {
              goalGet(tid).then((g) => {
                if (tid === activeThreadIdRef.current) {
                  setServerGoal(g);
                  if (g?.status === "complete") {
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
          setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => ({
            ...item, type: "agentMessage", text: (item.text || "") + textDelta,
          })));
        } else if (
          method === "item/reasoning/delta" ||
          method === NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA ||
          method === NOTIFICATION.ITEM_REASONING_TEXT_DELTA ||
          method === NOTIFICATION.ITEM_REASONING_SUMMARY_PART
        ) {
          const isSummary = method === NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA;
          const isText = method === NOTIFICATION.ITEM_REASONING_TEXT_DELTA;
          if (method === NOTIFICATION.ITEM_REASONING_SUMMARY_PART) return;
          if (isSummary || isText) {
            const index = isSummary ? (params?.summaryIndex ?? 0) : (params?.contentIndex ?? 0);
            const delta = params?.delta || "";
            setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => {
              const field = isSummary ? "summary" : "content";
              const parts = Array.isArray(item[field]) ? [...item[field]] : [];
              parts[index] = (parts[index] || "") + delta;
              return { ...item, type: "reasoning", [field]: parts };
            }));
          } else {
            const delta = params?.delta || params?.text || "";
            setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => ({
              ...item, type: "reasoning", text: (item.text || "") + delta,
            })));
          }
        } else if (method === NOTIFICATION.ITEM_COMMAND_OUTPUT_DELTA) {
          setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => ({
            ...item, type: "commandExecution", command: item.command || params?.command || "command",
            aggregatedOutput: (item.aggregatedOutput ?? item.output ?? "") + (params?.delta || params?.output || ""),
          })));
        } else if (method === "item/started" || method === "item/completed") {
          const item = params?.item;
          if (!item) return;
          setTurns((prev) => mergeTimelineItem(prev, eventTurnId, item.id, (existing) => {
            const merged = {
              ...existing,
              ...item,
              ...(method === "item/completed" && item.type === "commandExecution" ? { output: undefined } : {}),
              ...(method === "item/completed" && item.type === "mcpToolCall" ? { progressMessage: undefined } : {}),
            };
            if (item.type === "reasoning") {
              if (existing.summary?.length && (!item.summary || item.summary.length === 0)) {
                merged.summary = existing.summary;
              }
              if (existing.content?.length && (!item.content || item.content.length === 0)) {
                merged.content = existing.content;
              }
              if (existing.text && !item.text) {
                merged.text = existing.text;
              }
              if (existing.reasoningText && !item.reasoningText) {
                merged.reasoningText = existing.reasoningText;
              }
            }
            return merged;
          }));
        } else if (method === NOTIFICATION.ITEM_PLAN_DELTA) {
          setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => ({
            ...item, type: "plan", text: (item.text || "") + (params?.delta || ""),
          })));
        } else if (method === NOTIFICATION.TURN_PLAN_UPDATED) {
          const plan = Array.isArray(params?.plan) ? params.plan : [];
          const explanation = typeof params?.explanation === "string" ? params.explanation : null;
          setPlanExplanation(explanation);
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
          setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => ({
            ...item, type: "fileChange", status: item.status || "inProgress", changes,
          })));
        } else if (method === NOTIFICATION.ITEM_MCP_PROGRESS) {
          const message = typeof params?.message === "string" ? params.message : "";
          setTurns((prev) => mergeTimelineItem(prev, eventTurnId, params?.itemId, (item) => ({
            ...item, type: "mcpToolCall", status: item.status || "inProgress", progressMessage: message,
          })));
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
          if (tid === activeThreadIdRef.current) void refreshThreadQueue(tid);
        } else if (method === NOTIFICATION.THREAD_GOAL_UPDATED) {
          const goal = params?.goal as ThreadGoal | undefined;
          if (goal) {
            if (!goal.threadId || goal.threadId === activeThreadIdRef.current) {
              setServerGoal(goal);
              if (goal.status === "complete") {
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
          setAccountInfo(null);
          setRateLimits(null);
          void refreshAccount();
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
          if (eventThreadId && eventThreadId === activeThreadIdRef.current) {
            selectThread(eventThreadId);
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
            pendingRequestRevisionRef.current += 1;
            const keys = new Set(pendingRequestsRef.current
              .filter(r => r.id === resolvedId && requestThreadId(r) === params?.threadId)
              .map(pendingRequestKey));
            for (const request of pendingRequestsRef.current.filter(r => keys.has(pendingRequestKey(r)))) {
              void tauriInvoke("desktop_notification_hide", { id: `${notificationRequestCategory(request)}-${pendingRequestKey(request)}-${request.notificationNonce || ""}` })
                .catch(error => showAppToast(`撤回已解决通知失败：${String(error)}`, "error"));
            }
            pendingRequestsRef.current = pendingRequestsRef.current.filter(r => !keys.has(pendingRequestKey(r)));
            setRequestResponses(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !keys.has(key))));
            setPendingRequests((prev) =>
              prev.filter((r) => !(r.id === resolvedId && requestThreadId(r) === params?.threadId))
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
        } else if (method === NOTIFICATION.THREAD_READ_STATE_CHANGED) {
          if (typeof params?.threadId === "string" && params.threadId && isThreadReadState(params.readState)) {
            setThreads((prev) => prev.map((thread) => thread.id === params.threadId ? { ...thread, readState: params.readState } : thread));
            refreshThreads();
          }
        } else if (method === NOTIFICATION.THREAD_PROJECT_UPDATED) {
          const tid = params?.threadId ?? params?.thread_id;
          const pid = params?.projectId !== undefined ? params.projectId : params?.project_id;
          if (typeof tid === "string" && tid && (pid === null || typeof pid === "string")) {
            setThreads((prev) =>
              prev.map((t) => (t.id === tid ? { ...t, projectId: pid } : t))
            );
            refreshThreads();
          }
        } else if (method === NOTIFICATION.PROJECT_CHANGED) {
          setProjectsRefreshToken((prev) => prev + 1);
          refreshWorkspacesAndMeta();
          refreshThreads();
        } else if (
          method === NOTIFICATION.THREAD_ARCHIVED ||
          method === NOTIFICATION.THREAD_DELETED
        ) {
          const tid = params?.threadId ?? params?.thread_id ?? params?.thread?.id;
          if (tid) {
            refreshThreadsGenerationRef.current += 1;
            activitySessionRef.current = excludeActivityThreads(activitySessionRef.current, [tid]);
            setThreads((prev) => prev.filter((t) => t.id !== tid));
            if (activeThreadIdRef.current === tid) {
              threadRequestRef.current += 1;
              threadHistoryBufferRef.current.discard();
              finishedTurnIdsRef.current.clear();
              activeThreadIdRef.current = null;
              setActiveThreadId(null);
              setTurns([]);
              if (activeRouteRef.current === "thread") setActiveRoute("home");
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
      };
    replayThreadNotificationRef.current = payload => handleNotification(payload, true);
    const unlistenNotification = tauriListen<any>("app-server:notification", handleNotification);
    const unlistenWorkspaceWarning = tauriListen<{ threadId?: string; message: string }>(
      "thread-workspace:sync-warning",
      ({ message }) => showAppToast(message, "error"),
    );

    const unlistenServerReq = tauriListen<PendingServerRequest>(
      "app-server:server-request",
      (req) => {
        pendingRequestRevisionRef.current += 1;
        pendingRequestsRef.current = [...pendingRequestsRef.current.filter(r => pendingRequestKey(r) !== pendingRequestKey(req)), req];
        setPendingRequests(pendingRequestsRef.current);
        const category = notificationRequestCategory(req);
        const notificationBody = category === "question"
          ? (req.params?.questions?.length ? `请回答 ${req.params.questions.length} 个问题以继续。` : "请提供输入以继续。")
          : (req.params?.command ? `$ ${req.params.command}` : req.params?.reason || "需要批准才能继续。");
        if (!isThreadWindow && !isQuickChatWindow) setInboxItems((prev) => [
          {
            id: `req-${req.id}-${Date.now()}`,
            title: category === "question" ? "需要你的输入" : "需要批准安全操作",
            subtitle: notificationBody,
            kind: "approval",
            threadId: requestThreadId(req),
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ]);
        void notify({
          id: `${category}-${pendingRequestKey(req)}-${req.notificationNonce || ""}`, category, threadId: requestThreadId(req),
          requestId: pendingRequestKey(req), requestNonce: req.notificationNonce, actions: notificationApprovalActions(req),
          title: category === "question" ? "Codex 需要你的输入" : "Codex 需要你的批准",
          body: notificationBody,
          valid: () => notificationContextRef.current.ready && pendingRequestsRef.current.some(r => pendingRequestKey(r) === pendingRequestKey(req) && r.notificationNonce === req.notificationNonce),
        });
      }
    );

    const unlistenResolved = tauriListen<Pick<PendingServerRequest, "id" | "generation" | "notificationNonce">>(
      "app-server:server-request-resolved",
      (resolved) => {
        pendingRequestRevisionRef.current += 1;
        const key = pendingRequestKey(resolved);
        for (const category of ["permission", "question"]) void tauriInvoke("desktop_notification_hide", { id: `${category}-${key}-${resolved.notificationNonce || ""}` })
          .catch(error => showAppToast(`撤回已解决通知失败：${String(error)}`, "error"));
        pendingRequestsRef.current = pendingRequestsRef.current.filter(request => pendingRequestKey(request) !== key ||
          Boolean(resolved.notificationNonce && request.notificationNonce !== resolved.notificationNonce));
        setPendingRequests(pendingRequestsRef.current);
        setRequestResponses(previous => Object.fromEntries(Object.entries(previous).filter(([entry]) => entry !== key)));
      },
    );

    void Promise.all([unlistenNotification, unlistenServerReq, unlistenResolved]).then(() => {
      if (!disposed) setThreadEventsReady(true);
    }).catch(error => { if (!disposed) showAppToast(`会话事件订阅失败：${String(error)}`, "error"); });
    return () => {
      disposed = true;
      unlistenResolved.then((f) => f());
      unlistenStatus.then((f) => f());
      unlistenNotification.then((f) => f());
      unlistenWorkspaceWarning.then((f) => f());
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
    const watchId = `workspace:${threadWindowId || (isQuickChatWindow ? "quick-chat" : "main")}:${root}`;
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
  }, [activeWorkspace?.path, appServerStatus.connected, isQuickChatWindow, threadWindowId]);

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
  const [inboxHydrated, setInboxHydrated] = useState(false);
  const [inboxLoadError, setInboxLoadError] = useState<string | null>(null);
  const [inboxReloadToken, setInboxReloadToken] = useState(0);
  const inboxHydrationChangesRef = useRef({ cleared: false, allRead: false, removed: new Set<string>() });
  const inboxSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (isQuickChatWindow) return;
    if (isThreadWindow) return;
    let cancelled = false;
    setInboxLoadError(null);
    tauriInvoke<any>("desktop_state_get", { key: "inboxItems" })
      .then((saved) => {
        if (cancelled) return;
        setInboxItems((current) => restoreInboxHistory(saved, current, inboxHydrationChangesRef.current));
        setInboxHydrated(true);
      })
      .catch((error) => {
        if (!cancelled) setInboxLoadError(`读取通知失败，尚未覆盖历史记录：${String(error)}`);
      });
    return () => { cancelled = true; };
  }, [inboxReloadToken]);
  useEffect(() => {
    if (!inboxHydrated || isQuickChatWindow || isThreadWindow) return;
    const handle = setTimeout(() => {
      const save = () => tauriInvoke("desktop_state_set", {
          key: "inboxItems",
          value: inboxItems.slice(0, 100),
        }).catch((error) => {
          showAppToast(`通知保存失败：${String(error)}`, "error");
        });
      inboxSaveQueueRef.current = inboxSaveQueueRef.current.then(save, save);
    }, 500);
    return () => clearTimeout(handle);
  }, [inboxItems, inboxHydrated, showAppToast]);

  const markAllInboxRead = () => {
    if (!inboxHydrated) inboxHydrationChangesRef.current.allRead = true;
    setInboxItems((items) => items.map((item) => ({ ...item, read: true })));
  };

  // 自动化调度器事件 → Toast + Inbox + 刷新会话列表
  useEffect(() => {
    let disposed = false;
    const offStorageError = tauriListen<any>("automation:storage-error", (payload) => {
      if (!disposed && !isQuickChatWindow && !isThreadWindow) {
        showAppToast(`自动化记录保存失败：${String(payload?.error || "未知错误")}`, "error");
      }
    });
    const offStarted = tauriListen<any>("automation:run-started", (payload) => {
      if (disposed || isQuickChatWindow || isThreadWindow) return;
      showAppToast(
        `▶ 正在运行自动化：${payload?.name || payload?.id || ""}`,
        "info"
      );
    });
    const offFinished = tauriListen<any>("automation:run-finished", (payload) => {
      if (disposed) return;
      const ok = payload?.status === "completed";
      const outcomeLabel = ok ? "自动化已完成" : payload?.status === "failed" ? "自动化失败" :
        payload?.status === "interrupted" ? "自动化已中断" : "自动化结果未知";
      const name = payload?.name || payload?.id || "自动化任务";
      if (!isQuickChatWindow && !isThreadWindow) showAppToast(
        `${outcomeLabel}：${name}`,
        ok ? "success" : payload?.status === "failed" ? "error" : "info"
      );
      if (payload?.id && payload?.finishedAt) void notify({
        id: `automation-${JSON.stringify([payload.id, payload.finishedAt])}`,
        category: "turn", threadId: payload.threadId,
        title: `${outcomeLabel}：${name}`,
        body: payload?.error ? String(payload.error) : "定时任务执行结束",
        valid: () => !disposed && notificationContextRef.current.ready && shouldNotifyTurn(payload),
      });
      if (!isQuickChatWindow && !isThreadWindow) setInboxItems((prev) =>
        [
          {
            id: `automation-${payload?.id || "task"}-${Date.now()}`,
            title: `${outcomeLabel}：${name}`,
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
      offStorageError.then((f) => f()).catch(() => {});
      offFinished.then((f) => f()).catch(() => {});
    };
  }, [showAppToast, refreshThreads]);

  // Code Review：进入页面时加载最近提交，供“指定提交”选择
  useEffect(() => {
    if (activeRoute !== "review") return;
    const cwd = activeWorkspace?.path;
    if (!cwd) return;
    let cancelled = false;
    setGitCommits([]);
    tauriInvoke<GitCommitInfo[]>("git_log_commits", { cwd, limit: 30 })
      .then((commits) => { if (!cancelled) setGitCommits(Array.isArray(commits) ? commits : []); })
      .catch(() => { if (!cancelled) setGitCommits([]); });
    return () => { cancelled = true; };
  }, [activeRoute, activeWorkspace?.path]);

  // Global keyboard shortcuts（注册表见 src/shortcuts.ts，与原生菜单 accelerator 对齐）
  // 实际动作绑定在下方 shortcutHandlersRef，避免闭包/声明顺序问题。
  const shortcutHandlersRef = useRef<Partial<Record<string, (arg?: any) => unknown>>>({});
  const environmentActionScope = JSON.stringify([activeRoute, activeThreadId, activeWorkspace?.path, modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion]);
  environmentActionScopeRef.current = environmentActionScope;
  useEffect(() => {
    return () => {
      const waiter = environmentActionWaiter.current;
      if (!waiter) return;
      environmentActionWaiter.current = null;
      void tauriInvoke("terminal_close", { sessionId: waiter.sessionId }).catch(() => {});
      setPendingEnvironmentAction(current => current?.id === waiter.id ? null : current);
      waiter.reject(Error("操作上下文已变化，已取消等待中的终端操作。"));
    };
  }, [environmentActionScope]);
  const shortcutTimestampsRef = useRef<Record<string, number>>({});
  const threadsRef = useRef<ThreadSummary[]>([]);
  threadsRef.current = threads;
  const workspacesRef = useRef<WorkspaceRootItem[]>([]);
  workspacesRef.current = workspaces;
  const workspaceHintsRef = useRef<Record<string, string>>({});
  workspaceHintsRef.current = workspaceHints;
  const keyboardContextRef = useRef({ activeThreadId, activeRoute, hasWorkspace: !!activeWorkspace?.path });
  keyboardContextRef.current = { activeThreadId, activeRoute, hasWorkspace: !!activeWorkspace?.path };

  /**
   * 统一分发快捷键动作，并去重：原生菜单 accelerator 与 webview keydown
   * 可能对同一次按键各触发一次（toggle 类动作会互相抵消）。
   */
  const runShortcutAction = useCallback((id: string, arg?: any) => {
    if (["cloud-draft", "cloud-new-chat"].includes(keyboardContextRef.current.activeRoute)
      && !["zoom-in", "zoom-out", "zoom-reset", "new-chat", "new-standalone-chat", "open-settings", "toggle-sidebar", "show-keyboard-shortcuts", "open-recent-thread"].includes(id)
      && !id.startsWith("sidebar-thread-") && !id.startsWith("recent-thread-")) return false;
    const now = Date.now();
    const last = shortcutTimestampsRef.current[id];
    if (last !== undefined && now - last < 250) return true;
    const handler = shortcutHandlersRef.current[id];
    if (!handler || handler(arg) === false) return false;
    shortcutTimestampsRef.current[id] = now;
    return true;
  }, []);

  useEffect(() => {
    let focusedElement: HTMLElement | null = null;
    let localCommandsOnly = false;
    const matcher = createShortcutMatcher(() => keyboardBindingsRef.current, id => {
      if (isQuickChatWindow && !id.startsWith("composer-") && !["new-chat", "open-model-picker", "zoom-in", "zoom-out", "zoom-reset"].includes(id)) return false;
      if (id.startsWith("composer-")) return !!focusedElement?.closest(".codex-two-tier-composer");
      if (id.startsWith("approval-")) return !!focusedElement?.closest("[data-keyboard-approval]");
      if (localCommandsOnly) return false;
      if (id.startsWith("environment-action-") && (!keyboardContextRef.current.hasWorkspace || !["thread", "home"].includes(keyboardContextRef.current.activeRoute) || !environmentActionRunner.current)) return false;
      if (id === "next-tab" || id === "previous-tab" || id.startsWith("focus-tab-")) return !!document.querySelector(".diff-drawer");
      if (["rename-thread", "pin-thread", "archive-thread", "fork-thread", "copy-last-code-block", "find-in-chat", "open-thread-new-window", "mark-thread-unread", "delete-chat", "copy-conversation-markdown"].includes(id)
        && (!keyboardContextRef.current.activeThreadId || keyboardContextRef.current.activeRoute !== "thread")) return false;
      if ((id.startsWith("git-") || id === "toggle-file-tree" || id === "copy-working-dir") && !keyboardContextRef.current.hasWorkspace) return false;
      return typeof shortcutHandlersRef.current[id] === "function";
    }, () => keyboardNumberTargetRef.current);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (keyboardState.capturing.current) { matcher.reset(); return; }
      focusedElement = e.target as HTMLElement | null;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) { matcher.reset(); return; }
      localCommandsOnly = !shortcutEventAllowed(e, keyboardBindingsRef.current);
      if (localCommandsOnly && !focusedElement?.closest(".codex-two-tier-composer, [data-keyboard-approval]")) { matcher.reset(); return; }
      const result = matcher(e);
      if (result.pending) { e.preventDefault(); return; }
      const shortcutId = result.id;
      if (!shortcutId) return;
      if (e.repeat && !["zoom-in", "zoom-out", "next-thread", "previous-thread", "next-tab", "previous-tab"].includes(shortcutId)) {
        e.preventDefault();
        return;
      }
      if (runShortcutAction(shortcutId)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    const reset = () => matcher.reset();
    window.addEventListener("blur", reset);
    return () => { matcher.reset(); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("blur", reset); };
  }, [runShortcutAction, isQuickChatWindow]);

  // Auto-scroll timeline
  useEffect(() => {
    const pane = timelineScrollRef.current;
    if (!pane) return;
    if (prependScrollRef.current) {
      const previous = prependScrollRef.current;
      pane.scrollTop = previous.top + pane.scrollHeight - previous.height;
      prependScrollRef.current = null;
    } else if (followTimelineRef.current) {
      pane.scrollTop = pane.scrollHeight;
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
    if (isThreadWindow) return;
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
  }, [isThreadWindow]);

  const handleRemoveWorkspace = useCallback(
    async (path: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
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
    const scope = attachmentScopeRef.current;
    try {
      const files = await tauriInvoke<string[]>("pick_files_dialog");
      if (Array.isArray(files) && files.length > 0) {
        const additions = files.map((path) => createAttachedFileItem(path));
        setScopedAttachedFiles(scope, (prev) => mergeAttachmentItems(prev, additions));
      }
    } catch (e) {
      console.warn("pick_files_dialog failed:", e);
    }
  }, [setScopedAttachedFiles]);

  const handleAppshot = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    try {
      showAppToast("正在捕获屏幕快照…", "info");
      const res = await tauriInvoke<{ path: string; name: string }>("capture_appshot");
      const item = createAttachedFileItem(res.path, res.name, "image");
      setScopedAttachedFiles(scope, (prev) => mergeAttachmentItems(prev, [item]));
      showAppToast(`✓ 已添加屏幕快照: ${res.name}`, "success");
    } catch (err: any) {
      showAppToast(`截图失败: ${err?.message || String(err)}`, "error");
    }
  }, [setScopedAttachedFiles, showAppToast]);

  const handleRemoveAttachedFile = useCallback(async (id: string) => {
    const scope = attachmentScopeRef.current;
    const threadId = activeThreadId;
    const file = attachedFiles.find((item) => item.id === id);
    if (!file) return;
    if (file.persisted && threadId) {
      try {
        await removeThreadAttachment(threadId, file);
      } catch (error) {
        showAppToast(`移除附件失败: ${String(error)}`, "error");
        return;
      }
    }
    setScopedAttachedFiles(scope, (prev) => prev.filter((item) => item.id !== id));
  }, [attachedFiles, activeThreadId, setScopedAttachedFiles, showAppToast]);

  // Thread Navigation & Lifecycle
  // Call only from a navigation continuation after its guard accepts.
  const commitNewThreadNavigation = useCallback(
    async (workspacePath?: string, project?: SidebarLocalProject, projectless = false): Promise<number | null> => {
      if (project && (!project.serverProjectId || project.rootPaths.length === 0)) {
        showAppToast("暂时无法在此项目中新建聊天，请重试。", "error");
        return null;
      }
      for (const controller of worktreeCreationControllersRef.current.keys()) controller.abort();
      const navigation = ++navigationRequestRef.current;
      if (navigation !== navigationRequestRef.current) return null;
      if (project) {
        ++refreshWorkspaceGenerationRef.current;
        try {
          const selected = await tauriInvoke<{
            workspaces: WorkspaceRootItem[];
            projectMembership: SidebarProjectMembership;
          }>("workspace_select_project", { projectId: project.id });
          if (navigation !== navigationRequestRef.current) return null;
          ++refreshWorkspaceGenerationRef.current;
          setWorkspaces(selected.workspaces);
          setSidebarProjectMembership(selected.projectMembership);
        } catch (error) {
          if (navigation === navigationRequestRef.current) {
            showAppToast(`选择项目失败：${String(error)}`, "error");
          }
          return null;
        }
      } else if (workspacePath) {
        handleSelectWorkspace(workspacePath);
      }
      let committed = false;
      const finalCommit = (): number | null => {
        if (committed || navigation !== navigationRequestRef.current) return null;
        committed = true;
        pendingNewThreadProjectRef.current = project ?? null;
        pendingProjectlessRef.current = projectless;
        setPermissionModes(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.includes(":draft:"))));
        threadRequestRef.current += 1;
        threadHistoryBufferRef.current.discard();
        finishedTurnIdsRef.current.clear();
        activeThreadIdRef.current = null;
        attachmentScopeRef.current = "home";
        earlierRequestRef.current = false;
        setLoadingEarlierTurns(false);
        setLoadingThread(false);
        setHistoryError(null);
        setIsStreaming(false);
        setActiveThreadId(null);
        setActiveTurnId(null);
        setActiveThreadStatus(null);
        setTurns([]);
        setTurnsCursor(null);
        setHasMoreTurns(false);
        setPlanSteps([]);
        setPlanExplanation(null);
        setTurnDiffFiles([]);
        setTokenUsage(null);
        activeRouteRef.current = "home";
        commitActiveRoute("home");
        setComposerFocusRequest(request => request + 1);
        return navigation;
      };
      // Project selection crossed an await: the current form may now have unsaved changes.
      if (project && personalizationNavigationGuardRef.current?.(() => { finalCommit(); }) === false) return null;
      return finalCommit();
    },
    [handleSelectWorkspace, showAppToast]
  );

  const startNewThread = useCallback(async (workspacePath?: string, project?: SidebarLocalProject, projectless = false): Promise<void> => {
    const apply = async () => {
      await commitNewThreadNavigation(workspacePath, project, projectless);
    };
    if (personalizationNavigationGuardRef.current?.(() => { void apply(); }) === false) return;
    await apply();
  }, [commitNewThreadNavigation]);

  const handleTrySkill = useCallback(async (skill: { name: string; path: string; defaultPrompt?: string | null }): Promise<boolean> => {
    const request = ++skillTrialRequestRef.current;
    const context = skillTrialContextRef.current;
    const identity = executionIdentityRef.current;
    const revision = homePromptRevisionRef.current;
    const originNavigation = navigationRequestRef.current;
    const originRoute = deepLinkRouteRef.current;
    const prompt = buildSkillTrialPrompt(skill);
    const isCurrent = () => request === skillTrialRequestRef.current && context === skillTrialContextRef.current
      && identity === executionIdentityRef.current && revision === homePromptRevisionRef.current;
    let consumed = false;
    const apply = async (): Promise<boolean> => {
      if (consumed || !isCurrent() || originNavigation !== navigationRequestRef.current || originRoute !== deepLinkRouteRef.current) return false;
      consumed = true;
      const navigation = await commitNewThreadNavigation();
      if (navigation === null || navigation !== navigationRequestRef.current || !isCurrent()
        || activeThreadIdRef.current !== null || activeRouteRef.current !== "home") return false;
      setThreadPrompt(null, prompt);
      setComposerFocusRequest(value => value + 1);
      return true;
    };
    if (personalizationNavigationGuardRef.current?.(() => { void apply(); }) === false) return false;
    return apply();
  }, [commitNewThreadNavigation, setThreadPrompt]);

  const selectThread = useCallback(async (threadId: string): Promise<void> => {
    if (personalizationNavigationGuardRef.current?.(() => { void selectThread(threadId); }) === false) return;
    for (const controller of worktreeCreationControllersRef.current.keys()) controller.abort();
    const executionIdentity = executionIdentityRef.current;
    const modelHydration = beginThreadModelHydration(threadId);
    const reviewHistorySnapshot = reviewResultsRef.current!.getRuns().filter(run => run.threadId === threadId);
    pendingNewThreadProjectRef.current = null;
    pendingProjectlessRef.current = false;
    const navigation = ++navigationRequestRef.current;
    if (navigation !== navigationRequestRef.current) return;
    const request = ++threadRequestRef.current;
    const lifecycle = turnLifecycleRef.current;
    const isCurrent = () => executionIdentity === executionIdentityRef.current && isCurrentThreadRequest(request, threadRequestRef.current, threadId, activeThreadIdRef.current);
    activeThreadIdRef.current = threadId;
    attachmentScopeRef.current = `thread:${threadId}`;
    threadHistoryBufferRef.current.begin(request, threadId);
    finishedTurnIdsRef.current.clear();
    earlierRequestRef.current = false;
    followTimelineRef.current = true;
    prependScrollRef.current = null;
    setLoadingEarlierTurns(false);
    setLoadingThread(true);
    setHistoryError(null);
    setTurns([]);
    setIsStreaming(false);
    setTokenUsage(null);
    setServerGoal(null);
    setActiveThreadId(threadId);
    setActiveRoute("thread");
    setActiveTurnId(null);
    setActiveThreadStatus(null);
    setPlanSteps([]);
    setTurnDiffFiles([]);
    setTurnsCursor(null);
    setHasMoreTurns(false);
    let loadedHistoryForReplay: TurnData[] = [];
    try {
      // 遵循官方 Codex 分页协议：只读元数据，不携带已废弃的 includeTurns: true
      const fullRes = await callAppServer<any>("thread/read", {
        threadId,
        includeTurns: false,
      });
      if (!isCurrent()) return;
      hydrateThreadModel(threadId, fullRes, modelHydration);
      try {
        const revision = threadExecutionRevisionsRef.current.get(threadId) ?? 0;
        const settings = await callAppServer<any>("thread/resume", {
          threadId,
          ...(fullRes?.thread?.status?.type === "notLoaded" && fullRes?.thread?.ephemeral === false
            ? { codexNativeScheduleTool: true } : {}),
        });
        if (!isCurrent()) return;
        hydrateThreadModel(threadId, settings, modelHydration);
        captureThreadExecutionPolicy(threadId, settings, revision);
      } catch (error) {
        // A newly created thread has no rollout yet. Its thread/start settings remain authoritative.
        console.warn("会话速度档恢复未确认", error);
      }
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
        if (!isCurrent()) return;
        loadedTurns = normalizeTurnsFromList(page, true);
        if (page?.nextCursor) {
          setTurnsCursor(page.nextCursor);
          setHasMoreTurns(true);
        }
      } catch {
        if (!isCurrent()) return;
        const revision = threadExecutionRevisionsRef.current.get(threadId) ?? 0;
        const resumeRes = await callAppServer<any>("thread/resume", { threadId });
        if (!isCurrent()) return;
        captureThreadExecutionPolicy(threadId, resumeRes, revision);
        loadedTurns = normalizeTurnsFromThread(resumeRes);
      }
      if (!isCurrent()) return;
      loadedHistoryForReplay = loadedTurns;
      finishedTurnIdsRef.current = new Set(loadedTurns
        .filter((turn) => turn.status !== "running" && turn.status !== "inProgress")
        .map((turn) => turn.id));
      setTurns(loadedTurns);
      const running = loadedTurns.find((turn) => turn.status === "running" || turn.status === "inProgress");
      if (running && lifecycle === turnLifecycleRef.current) {
        setIsStreaming(true);
        setActiveTurnId(running.id);
      }

      // 同步工作区关联状态：若该会话属于某个已知工作区且尚未激活，则自动切换对应工作区
      const candidateCwd =
        fullRes?.thread?.cwd ||
        threadsRef.current.find((t) => t.id === threadId)?.cwd ||
        workspaceHintsRef.current[threadId];
      const currentReviews = reviewResultsRef.current!.getRuns();
      const reviewHistory = loadedTurns.filter(turn => {
        const current = currentReviews.find(run => run.threadId === threadId && run.turnId === turn.id);
        const before = reviewHistorySnapshot.find(run => run.turnId === turn.id);
        return !current || JSON.stringify(current) === JSON.stringify(before);
      });
      reviewResultsRef.current!.hydrate(threadId, candidateCwd || "", candidateCwd ? [candidateCwd] : [], reviewHistory);
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
      if (isCurrent()) setHistoryError(`加载会话失败: ${String(e)}`);
    } finally {
      if (isCurrent()) {
        const buffered = threadHistoryBufferRef.current.release(request, threadId, loadedHistoryForReplay);
        for (const event of buffered ?? []) replayThreadNotificationRef.current(event);
        setLoadingThread(false);
      }
    }
    if (!isCurrent()) return;
    try {
      const restored = await listThreadAttachments(threadId);
      if (isCurrent()) {
        setAttachedFiles((current) => mergeAttachmentItems(restored, current));
      }
    } catch (error) {
      if (isCurrent()) showAppToast(`加载会话附件失败: ${String(error)}`, "error");
    }
    // 同步服务端 thread goal（若存在）
    try {
      const goal = await goalGet(threadId);
      if (isCurrent()) {
        setServerGoal(goal);
      }
    } catch {
      // ignore goal read failures
    }
  }, [handleSelectWorkspace, hydrateThreadModel, beginThreadModelHydration, captureThreadExecutionPolicy]);

  const modelAccountIdentityRef = useRef(modelAccountIdentity);
  useEffect(() => {
    if (modelAccountIdentityRef.current === modelAccountIdentity) return;
    modelAccountIdentityRef.current = modelAccountIdentity;
    const threadId = activeThreadIdRef.current;
    if (appServerStatus.connected && threadId) void selectThread(threadId);
  }, [modelAccountIdentity, appServerStatus.connected, selectThread]);

  useEffect(() => {
    if (!appServerStatus.connected || !threadEventsReady || !initialWindowThreadRef.current) return;
    const threadId = initialWindowThreadRef.current;
    initialWindowThreadRef.current = null;
    if (navigationRequestRef.current !== 0) return;
    void selectThread(threadId);
  }, [appServerStatus.connected, threadEventsReady, selectThread]);

  useEffect(() => {
    if (isQuickChatWindow || isThreadWindow || !appServerStatus.connected || !threadEventsReady) return;
    const pending = new AbortController();
    const installed = installDeepLinkReceiver({
      signal: pending.signal,
      navigationRevision: () => `${navigationRequestRef.current}:${deepLinkRouteRef.current.revision}`,
      selectThread,
      openCloudEnvironmentCreate: () => {
        if (activeRouteRef.current === "cloud-draft" && cloudDraftRef.current?.session.setup) return;
        setActiveRoute("cloud-create");
      },
      onError: message => showAppToast(message, "error"),
    });
    return () => {
      pending.abort();
      void installed.then(unlisten => unlisten()).catch(() => {});
    };
  }, [isQuickChatWindow, isThreadWindow, appServerStatus.connected, threadEventsReady, accountInfo, selectThread, setActiveRoute, showAppToast]);

  useEffect(() => {
    if (!isThreadWindow) return;
    return () => { threadRequestRef.current += 1; navigationRequestRef.current += 1; };
  }, [isThreadWindow]);

  /** 向上滚动加载更早的轮次（thread/turns/list 的 nextCursor） */
  const loadEarlierTurns = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    const cursor = turnsCursorRef.current;
    if (!threadId || !cursor || earlierRequestRef.current) return;
    const request = threadRequestRef.current;
    const isCurrent = () => isCurrentThreadRequest(request, threadRequestRef.current, threadId, activeThreadIdRef.current);
    earlierRequestRef.current = true;
    setHistoryError(null);
    setLoadingEarlierTurns(true);
    try {
      const page = await callAppServer<any>("thread/turns/list", {
        threadId,
        limit: 15,
        sortDirection: "desc",
        itemsView: "full",
        cursor,
      });
      if (!isCurrent()) return;
      const older = normalizeTurnsFromList(page, true);
      for (const turn of older) {
        if (turn.status !== "running" && turn.status !== "inProgress") finishedTurnIdsRef.current.add(turn.id);
      }
      const pane = timelineScrollRef.current;
      if (pane && older.length > 0) prependScrollRef.current = { height: pane.scrollHeight, top: pane.scrollTop };
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
      if (isCurrent()) setHistoryError(`加载更早的轮次失败: ${String(e)}`);
    } finally {
      if (isCurrent()) {
        earlierRequestRef.current = false;
        setLoadingEarlierTurns(false);
      }
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
        if (newThreadId) setSidebarCreatedThread({ id: String(newThreadId), cwd: res?.thread?.cwd || activeWorkspace?.path, projectId: res?.thread?.projectId });
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
    async (threadId: string, enabled: boolean, configuration: ModelConfiguration = getModelConfiguration()) => {
      await callAppServer("thread/settings/update", {
        threadId,
        collaborationMode: {
          mode: enabled ? "plan" : "default",
          settings: {
            model: configuration.model,
            reasoning_effort: configuration.reasoningEffort,
            developer_instructions: null,
          },
        },
      });
    },
    [getModelConfiguration]
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

  // Quick reviews use ordinary turns; commit/custom retain the existing review RPC.
  const handleStartCodeReview = useCallback(
    async (req: ReviewRequest) => {
      if (reviewStartPendingRef.current) return;
      const cwd = activeWorkspace?.path;
      if (!cwd) {
        showAppToast("请先在左侧选择一个工作区目录", "error");
        return;
      }
      if (!appServerStatus.connected) {
        showAppToast("app-server 未连接，无法启动审查", "error");
        return;
      }
      const quickReview = req.kind === "branch" || req.kind === "uncommitted";
      const currentId = activeThreadIdRef.current;
      const currentCwd = currentId ? threadsRef.current.find((thread) => thread.id === currentId)?.cwd || workspaceHintsRef.current[currentId] : null;
      const inline = quickReview && req.delivery !== "detached" && currentId && currentCwd &&
        attachmentIdentityKey(currentCwd) === attachmentIdentityKey(cwd);
      if (inline && isStreaming) {
        showAppToast("请先停止当前任务，再启动代码审查", "error");
        return;
      }
      let context = reviewContextRef.current;
      let navigation = navigationRequestRef.current;
      const identity = executionIdentityRef.current;
      const isCurrent = () => identity === executionIdentityRef.current && context === reviewContextRef.current && navigation === navigationRequestRef.current;
      reviewStartPendingRef.current = true;
      setReviewBusy(true);
      try {
        const configuration = getModelConfiguration();
        const execution = await resolveExecutionContext(inline ? currentId : null, cwd, [cwd]);
        if (!isCurrent()) return;
        let { approvalPolicy, approvalsReviewer, sandboxPolicy, sandbox } = execution.policy;
        let prompt = "";
        let resolvedMergeBase: string | null = null;
        if (req.kind === "branch") {
          if (gitContextCwd !== cwd) throw new Error("当前项目的分支尚未加载，请稍后重试");
          if (!req.branch?.trim()) throw new Error("请选择基准分支");
          const mergeBase = await tauriInvoke<string>("git_merge_base", { cwd, baseBranch: req.branch.trim() });
          if (!isCurrent()) return;
          if (!mergeBase) throw new Error("无法解析共同祖先");
          resolvedMergeBase = mergeBase;
          prompt = `Review the code changes against the base branch '${req.branch.trim()}'. The merge base commit for this comparison is ${mergeBase}. Run \`git diff ${mergeBase}\` to inspect the changes relative to ${req.branch.trim()}. Provide concise, actionable feedback in a normal Markdown response.`;
        } else if (req.kind === "uncommitted") {
          prompt = "Review the current code changes (staged, unstaged, and untracked files) and provide concise, actionable feedback in a normal Markdown response.";
        }
        if (quickReview) prompt = buildQuickReviewPrompt(prompt, req.instructions?.trim());
        let threadId = inline ? currentId : null;
        if (!threadId) {
          const threadRes = await callAppServer<any>("thread/start", {
            cwd,
            model: configuration.model,
            approvalPolicy,
            approvalsReviewer,
            sandbox,
            config: executionThreadConfig(execution.policy, execution.config, [cwd]),
            ...(quickReview ? { threadSource: "code_review" } : {}),
          });
          threadId = threadRes?.threadId || threadRes?.thread?.id;
          if (!threadId) throw new Error("无法为审查创建会话");
          if (!isCurrent()) return;
          hydrateThreadModel(threadId, { ...threadRes, ...configuration });
          const actualPolicy = captureThreadExecutionPolicy(threadId, threadRes);
          if (!actualPolicy) throw new Error("服务未确认新聊天的权限，未启动审查");
          ({ approvalPolicy, approvalsReviewer, sandboxPolicy, sandbox } = actualPolicy);
          setSidebarCreatedThread({ id: threadId, cwd, projectId: threadRes?.thread?.projectId });
        }
        if (!isCurrent()) return;
        // Select and finish history loading before sending, so fast turn events
        // enter the existing visible-thread notification merger.
        const permissionsBeforeSelect = JSON.stringify(threadExecutionPoliciesRef.current.get(threadId));
        const selecting = selectThread(threadId);
        navigation = navigationRequestRef.current;
        await selecting;
        if (navigation !== navigationRequestRef.current || activeThreadIdRef.current !== threadId ||
          reviewContextRef.current.cwd !== cwd || reviewContextRef.current.route !== "thread") return;
        context = reviewContextRef.current;
        const currentPolicy = threadExecutionPoliciesRef.current.get(threadId);
        if (!currentPolicy) throw new Error("聊天权限尚未确认，未启动审查");
        if (permissionMode === "custom") ({ approvalPolicy, approvalsReviewer, sandboxPolicy } = currentPolicy);
        else if (JSON.stringify(currentPolicy) !== permissionsBeforeSelect) throw new Error("聊天权限已变化，请重新启动审查");
        if (quickReview) {
          const attempt = reviewResultsRef.current!.begin(threadId, cwd, [cwd]);
          try {
            const started = await callAppServer<any>("turn/start", {
              threadId, cwd, turnTrigger: "code_review",
              input: [{ type: "text", text: prompt, text_elements: [] }],
              approvalPolicy, approvalsReviewer, sandboxPolicy,
              summary: execution.summary,
              collaborationMode: null,
              model: configuration.model,
              effort: configuration.reasoningEffort,
              serviceTier: configuration.serviceTier,
            });
            const turnId = started?.turn?.id;
            if (typeof turnId !== "string" || !turnId) throw new Error("审查已提交，但服务未确认执行身份");
            reviewResultsRef.current!.bind(threadId, attempt, turnId);
          } catch (error) {
            reviewResultsRef.current!.startUnconfirmed(threadId, attempt, error);
            throw error;
          }
        } else {
          let target: any;
          if (req.kind === "commit") {
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
          }
          const reviewRes = await callAppServer<any>("review/start", {
            threadId,
            delivery: "inline",
            target,
          });
          const reviewThreadId = reviewRes?.reviewThreadId || threadId;
          if (!isCurrent()) return;
          if (reviewThreadId !== threadId) {
            const selectingReview = selectThread(reviewThreadId);
            navigation = navigationRequestRef.current;
            await selectingReview;
            if (navigation !== navigationRequestRef.current || activeThreadIdRef.current !== reviewThreadId) return;
            context = reviewContextRef.current;
          }
        }
        if (!isCurrent()) return;
        if (quickReview) {
          setReviewDiffTarget({ cwd, baseBranch: req.kind === "branch" ? req.branch!.trim() : null, mergeBase: resolvedMergeBase });
          setInitialWorkbenchTab("changes");
          setShowRightDrawer(true);
        }
        await refreshThreads();
        if (!isCurrent()) return;
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
        if (isCurrent()) showAppToast(`启动代码审查失败：${e?.message || e}`, "error");
      } finally {
        reviewStartPendingRef.current = false;
        setReviewBusy(false);
      }
    },
    [
      activeWorkspace?.path,
      appServerStatus.connected,
      getModelConfiguration,
      hydrateThreadModel,
      resolveExecutionContext,
      captureThreadExecutionPolicy,
      selectedModelName,
      gitCommits,
      gitContextCwd,
      isStreaming,
      permissionMode,
      sessionAllowNetwork,
      fastMode,
      models,
      refreshThreads,
      selectThread,
      showAppToast,
    ]
  );

  // Send or Steer Message
  const handleSendMessage = useCallback(async (overrideText?: string) => {
    if (activeRouteRef.current === "cloud-draft" || activeRouteRef.current === "cloud-new-chat") return;
    if (activeRouteRef.current === "home" && homeCloud.active) return;
    const rawText = (typeof overrideText === "string" ? overrideText : promptInput).trim();
    if (!rawText && attachedFiles.length === 0) return;
    if (sendStartPendingRef.current.has(threadRequestRef.current)) return;
    const projectless = !activeThreadIdRef.current && pendingProjectlessRef.current;
    const pendingProject = activeThreadIdRef.current || projectless ? null : resolveNewThreadProject(
      pendingNewThreadProjectRef.current, sidebarProjectMembership, activeWorkspace?.path,
    );
    if (pendingProject && (!pendingProject.serverProjectId || pendingProject.rootPaths.length === 0)) {
      showAppToast("暂时无法在此项目中新建聊天，请重试。", "error");
      return;
    }

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
      const threadId = activeThreadId;
      const turnId = activeTurnIdRef.current;
      const request = threadRequestRef.current;
      const isCurrent = () => isCurrentThreadRequest(request, threadRequestRef.current, threadId, activeThreadIdRef.current);
      if (!turnId) {
        showAppToast("当前没有可引导的轮次，输入已保留", "info");
        return;
      }
      if (steerSendPendingRef.current.has(threadId)) return;
      steerSendPendingRef.current.add(threadId);
      try {
        const { errors } = await persistThreadAttachments(threadId, attachedFiles);
        if (errors.length > 0) throw new Error(errors[0].message);
        if (!isCurrent()) return;
        if (activeTurnIdRef.current !== turnId) {
          showAppToast("当前轮次已变化，输入已保留", "info");
          return;
        }
        await callAppServer("turn/steer", {
          threadId,
          expectedTurnId: turnId,
          clientUserMessageId: crypto.randomUUID(),
          input: nativeInputs,
        });
        if (isCurrent() && !overrideText) {
          setPromptInput(current => current === promptInput ? "" : current);
          setAttachedFiles(current => current === attachedFiles ? [] : current);
        }
        return true;
      } catch (error) {
        if (isCurrent()) showAppToast(`引导结果未确认，未自动重发，输入已保留：${String(error)}`, "error");
        return;
      } finally {
        steerSendPendingRef.current.delete(threadId);
      }
    }

    let configuration;
    try { configuration = getModelConfiguration(); }
    catch (error) { showAppToast(`无法发送：${String(error)}`, "error"); return; }
    const sendRequest = threadRequestRef.current;
    const sendIdentity = executionIdentityRef.current;
    const sendNavigation = navigationRequestRef.current;
    sendStartPendingRef.current.add(sendRequest);
    const tempTurnId = `pending-${Date.now()}`;
    pendingTurnIdRef.current = tempTurnId;
    const userTurn: TurnData = {
      id: tempTurnId,
      status: "running",
      startedAt: Date.now(),
      items: [{ id: `u-${Date.now()}`, type: "userMessage", text: effectiveRawText }],
    };
    setTurns((prev) => [...prev, userTurn]);
    setIsStreaming(true);
    setActiveTurnId(tempTurnId);

    try {
      let currentThreadId = activeThreadIdRef.current;
      let targetCwd = currentThreadId || projectless ? "" : pendingProject?.rootPaths[0] || activeWorkspace?.path || "";
      if (!currentThreadId && useWorktree && targetCwd) {
        const wt = await createWorktree({
          sourceCwd: targetCwd,
          startingMode: "HEAD",
          branchName: null,
          ownerThreadId: activeThreadId,
        });
        if (!wt?.path) throw new Error("Worktree 创建未返回目录，输入已保留");
        targetCwd = wt.path;
      }
      const projectStartParams = currentThreadId ? {} : projectless ? { projectId: null, runtimeWorkspaceRoots: undefined } : threadStartProjectParams(pendingProject, targetCwd || undefined);
      const turnWorkspaceRoots = projectStartParams.runtimeWorkspaceRoots;

      if (sendRequest !== threadRequestRef.current || sendIdentity !== executionIdentityRef.current || sendNavigation !== navigationRequestRef.current) return;
      const threadCwd = currentThreadId ? threadsRef.current.find(thread => thread.id === currentThreadId)?.cwd || workspaceHintsRef.current[currentThreadId] : undefined;
      const execution = await resolveExecutionContext(currentThreadId, targetCwd || threadCwd, turnWorkspaceRoots ?? (threadCwd ? [threadCwd] : targetCwd ? [targetCwd] : []));
      if (sendRequest !== threadRequestRef.current || sendIdentity !== executionIdentityRef.current || sendNavigation !== navigationRequestRef.current) return;
      let { approvalPolicy, approvalsReviewer, sandboxPolicy, sandbox: sandboxMode } = execution.policy;

      if (!currentThreadId) {
        const startRes = await callAppServer<any>("thread/start", {
          cwd: targetCwd || undefined,
          codexNativeScheduleTool: true,
          ...projectStartParams,
          model: configuration.model,
          approvalPolicy,
          approvalsReviewer,
          sandbox: sandboxMode,
          config: executionThreadConfig(execution.policy, execution.config, turnWorkspaceRoots ?? (targetCwd ? [targetCwd] : [])),
        });
        const createdThreadId =
          startRes?.threadId ||
          startRes?.thread?.id ||
          startRes?.conversationId;
        if (typeof createdThreadId !== "string" || !createdThreadId) throw new Error("thread/start 未返回会话 ID");
        currentThreadId = createdThreadId;
        if (sendRequest !== threadRequestRef.current || sendIdentity !== executionIdentityRef.current || sendNavigation !== navigationRequestRef.current) return;
        const actualPolicy = captureThreadExecutionPolicy(createdThreadId, startRes);
        if (!actualPolicy) throw new Error("服务未确认新聊天的权限，输入已保留");
        ({ approvalPolicy, approvalsReviewer, sandboxPolicy } = actualPolicy);
        hydrateThreadModel(createdThreadId, { ...startRes, ...configuration });
        pendingNewThreadProjectRef.current = null;
        pendingProjectlessRef.current = false;
        setSidebarCreatedThread({ id: createdThreadId, cwd: targetCwd || undefined, projectId: startRes?.thread?.projectId });
        if (sendRequest === threadRequestRef.current) {
          moveHomeAttachmentsToThread(currentThreadId);
          moveHomePromptToThread(currentThreadId);
          activeThreadIdRef.current = currentThreadId;
          attachmentScopeRef.current = `thread:${currentThreadId}`;
          setActiveThreadId(currentThreadId);
        }
        if (currentThreadId && targetCwd) {
          setWorkspaceHints((prev) => ({ ...prev, [currentThreadId!]: targetCwd }));
        }
        refreshThreads();
      }

      const permissionRevision = threadExecutionRevisionsRef.current.get(currentThreadId!) ?? 0;
      const observedPermissions = JSON.stringify(threadExecutionPoliciesRef.current.get(currentThreadId!));
      // 计划模式：走真实 thread/settings/update（新会话也在首个 turn 前应用）
      if (planMode && currentThreadId) {
        await applyCollaborationMode(currentThreadId, true, configuration);
      }

      if (sendRequest !== threadRequestRef.current || sendIdentity !== executionIdentityRef.current || sendNavigation !== navigationRequestRef.current) return;
      if (permissionRevision !== (threadExecutionRevisionsRef.current.get(currentThreadId!) ?? 0) &&
        JSON.stringify(threadExecutionPoliciesRef.current.get(currentThreadId!)) !== observedPermissions) throw new Error("聊天权限已变化，输入已保留，请重新发送");
      if (attachedFiles.length > 0) {
        pendingAttachmentSaveRef.current = {
          threadId: currentThreadId!,
          clearComposer: !overrideText,
          prompt: promptInput,
          files: attachedFiles,
        };
      }
      const turnRes = await trackModelTurn(currentThreadId!, configuration, () => callAppServer<any>("turn/start", {
        threadId: currentThreadId,
        cwd: targetCwd || undefined,
        runtimeWorkspaceRoots: turnWorkspaceRoots,
        input: nativeInputs,
        model: configuration.model,
        effort: configuration.reasoningEffort,
        summary: execution.summary,
        approvalPolicy,
        approvalsReviewer,
        sandboxPolicy,
        serviceTier: configuration.serviceTier,
      }));
      if (sendRequest !== threadRequestRef.current) return;
      const startedTurnId =
        turnRes?.turn?.id || turnRes?.turnId || turnRes?.id || null;
      if (startedTurnId) {
        const turnIdStr = String(startedTurnId);
        setActiveTurnId(turnIdStr);
        setTurns((prev) => {
          if (prev.some((t) => t.id === turnIdStr)) {
            return prev.filter((t) => t.id !== tempTurnId);
          }
          const pendingIdx = prev.findIndex((t) => t.id === tempTurnId);
          if (pendingIdx >= 0) {
            const updated = [...prev];
            updated[pendingIdx] = {
              ...updated[pendingIdx],
              id: turnIdStr,
              status: "running",
            };
            return updated;
          }
          return prev;
        });
        pendingTurnIdRef.current = null;
        if (!overrideText && attachedFiles.length === 0) {
          setThreadPrompt(currentThreadId, value => value === promptInput ? "" : value);
        }
      } else {
        pendingAttachmentSaveRef.current = null;
      }
      return Boolean(startedTurnId);
    } catch (err: any) {
      console.error("Turn start failed:", err);
      if (sendRequest !== threadRequestRef.current) return;
      pendingAttachmentSaveRef.current = null;
      setIsStreaming(false);
      setTurns((prev) => prev.map((t) => t.id === tempTurnId ? { ...t, status: "failed", items: [...t.items, { id: `err-item-${Date.now()}`, type: "agentMessage", text: `⚠️ 执行出错: ${err?.message || err}` }] } : t));
    } finally {
      sendStartPendingRef.current.delete(sendRequest);
    }
  }, [
    promptInput,
    homeCloud.active,
    setPromptInput,
    setThreadPrompt,
    moveHomePromptToThread,
    moveHomeAttachmentsToThread,
    attachedFiles,
    planMode,
    isStreaming,
    activeThreadId,
    activeWorkspace?.path,
    sidebarProjectMembership,
    useWorktree,
    permissionMode,
    getModelConfiguration,
    hydrateThreadModel,
    resolveExecutionContext,
    captureThreadExecutionPolicy,
    trackModelTurn,
    selectedModelName,
    reasoningEffort,
    models,
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
      const request = threadRequestRef.current;
      const identity = executionIdentityRef.current;
      const navigation = navigationRequestRef.current;
      const isCurrent = () => request === threadRequestRef.current && identity === executionIdentityRef.current && navigation === navigationRequestRef.current;
      try {
        let threadId = activeThreadIdRef.current;
        if (!threadId) {
          const projectless = pendingProjectlessRef.current;
          const pendingProject = projectless ? null : resolveNewThreadProject(
            pendingNewThreadProjectRef.current, sidebarProjectMembership, activeWorkspace?.path,
          );
          let targetCwd = projectless ? "" : pendingProject?.rootPaths[0] || activeWorkspace?.path || "";
          const configuration = getModelConfiguration();
          if (pendingProject && (!pendingProject.serverProjectId || pendingProject.rootPaths.length === 0)) throw new Error("暂时无法在此项目中新建聊天，请重试。");
          if (useWorktree && targetCwd) {
            const worktree = await createWorktree({ sourceCwd: targetCwd, startingMode: "HEAD", branchName: null, ownerThreadId: null });
            if (!isCurrent()) return;
            if (!worktree?.path) throw new Error("Worktree 创建未返回目录，目标已保留");
            targetCwd = worktree.path;
          }
          const projectStartParams = projectless ? { projectId: null, runtimeWorkspaceRoots: undefined } : threadStartProjectParams(pendingProject, targetCwd || undefined);
          const execution = await resolveExecutionContext(null, targetCwd || undefined, projectStartParams.runtimeWorkspaceRoots ?? (targetCwd ? [targetCwd] : []));
          if (!isCurrent()) return;
          const startRes = await callAppServer<any>("thread/start", {
            cwd: targetCwd || undefined,
            ...projectStartParams,
            model: configuration.model,
            approvalPolicy: execution.policy.approvalPolicy,
            approvalsReviewer: execution.policy.approvalsReviewer,
            sandbox: execution.policy.sandbox,
            config: executionThreadConfig(execution.policy, execution.config, projectStartParams.runtimeWorkspaceRoots ?? (targetCwd ? [targetCwd] : [])),
          });
          threadId = startRes?.threadId || startRes?.thread?.id || null;
          if (!threadId) throw new Error("无法为目标创建会话");
          if (!isCurrent()) return;
          if (!captureThreadExecutionPolicy(threadId, startRes)) throw new Error("服务未确认新聊天的权限，目标已保留");
          hydrateThreadModel(threadId, { ...startRes, ...configuration });
          pendingNewThreadProjectRef.current = null;
          pendingProjectlessRef.current = false;
          moveHomePromptToThread(threadId);
          activeThreadIdRef.current = threadId;
          if (targetCwd) setWorkspaceHints(previous => ({ ...previous, [threadId!]: targetCwd }));
          setSidebarCreatedThread({ id: threadId, cwd: targetCwd || undefined, projectId: startRes?.thread?.projectId });
          setActiveThreadId(threadId);
          setActiveRoute("thread");
          refreshThreads();
        }
        const goal = await goalSet(threadId, { objective: trimmed, status: "active" });
        if (!isCurrent() || activeThreadIdRef.current !== threadId) return;
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
      sidebarProjectMembership,
      getModelConfiguration,
      hydrateThreadModel,
      resolveExecutionContext,
      captureThreadExecutionPolicy,
      useWorktree,
      selectedModelName,
      permissionMode,
      refreshThreads,
      handleSendMessage,
      moveHomePromptToThread,
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
    if (cur.status === "budgetLimited" || cur.status === "complete") return;
    const nextStatus = cur.status === "active" ? "paused" : "active";
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
    if (activeRouteRef.current === "cloud-draft" || activeRouteRef.current === "cloud-new-chat") return;
    const threadId = activeThreadIdRef.current;
    const turnId = activeTurnIdRef.current;
    const request = threadRequestRef.current;
    if (!threadId || !turnId) return;
    try {
      await callAppServer("turn/interrupt", { threadId, turnId });
    } catch (e) {
      if (isCurrentThreadRequest(request, threadRequestRef.current, threadId, activeThreadIdRef.current)) {
        showAppToast(`中断请求未确认，请检查运行状态：${String(e)}`, "error");
      }
    }
    // 不在这里强制 setIsStreaming(false)：真实状态由 turn/completed 通知驱动
  }, [showAppToast]);

  const handleSteerTurn = useCallback(
    async (text: string, queued?: QueuedFollowupPrompt) => {
      const tid = activeThreadIdRef.current;
      const turnId = activeTurnIdRef.current;
      const request = threadRequestRef.current;
      const key = `${tid}:${queued?.id}`;
      if (!tid || !turnId || (!text.trim() && !queued?.input.length) || queueMutationThreadsRef.current.has(tid) || steeredQueueItemsRef.current.has(key)) return;
      queueMutationThreadsRef.current.add(tid);
      setQueueMutationVersion(v => v + 1);
      const current = () => isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current);
      let accepted = false;
      try {
        await callAppServer("turn/steer", {
          threadId: tid,
          expectedTurnId: turnId,
          clientUserMessageId: queued?.clientUserMessageId ?? crypto.randomUUID(),
          input: queued?.input ?? [{ type: "text", text: text.trim() }],
        });
        accepted = true;
        if (queued) {
          steeredQueueItemsRef.current.set(key, "accepted");
          const result = await callAppServer<{ deleted: boolean }>("thread/queue/delete", { threadId: tid, queuedSubmissionId: queued.id });
          if (result.deleted !== true) throw new Error("队列消息未移除");
          steeredQueueItemsRef.current.delete(key);
          if (current()) {
            setFollowupQueue(prev => prev.filter(item => item.id !== queued.id));
            await refreshThreadQueue(tid);
          }
        } else if (current()) {
          setPromptInput(value => value === text ? "" : value);
        }
      } catch (e) {
        if (queued) steeredQueueItemsRef.current.set(key, accepted ? "accepted" : "unknown");
        if (current()) {
          const message = accepted ? "消息已引导到当前轮，但原队列清理失败；请重试取消清理，勿重复发送。" : `引导结果未确认，未自动重发：${String(e)}`;
          setQueueNotice(message);
          showAppToast(message, "error");
        }
      } finally {
        queueMutationThreadsRef.current.delete(tid);
        setQueueMutationVersion(v => v + 1);
      }
    },
    [showAppToast, setPromptInput]
  );

  const submitServerResponse = useCallback(
    async (requestId: any, generation: number, result: any, error: any, notificationNonce?: string) => {
      const request = pendingRequestsRef.current.find(r => r.id === requestId && r.generation === generation);
      if (!request || requestThreadId(request) !== activeThreadIdRef.current) return;
      if (notificationNonce && request.notificationNonce !== notificationNonce) return;
      const key = pendingRequestKey(request);
      if (request.responseDeliveryUnknown || respondingRequestsRef.current.has(key)) return;
      respondingRequestsRef.current.add(key);
      setRequestResponses(prev => ({ ...prev, [key]: { sending: true } }));
      try {
        await tauriInvoke("app_server_respond", {
          id: requestId,
          generation,
          result,
          error,
          ...((notificationNonce || request.method === "codex-native/schedule/requestApproval")
            ? { notificationNonce: notificationNonce || request.notificationNonce } : {}),
        });
        void tauriInvoke("desktop_notification_hide", { id: `${notificationRequestCategory(request)}-${key}-${request.notificationNonce || ""}` })
          .catch(reason => showAppToast(`撤回已解决通知失败：${String(reason)}`, "error"));
        pendingRequestRevisionRef.current += 1;
        setPendingRequests(prev => prev.filter(r => pendingRequestKey(r) !== key));
        setRequestResponses(prev => { const next = { ...prev }; delete next[key]; return next; });
      } catch (e) {
        // Only a fresh backend snapshot can confirm that retrying is safe.
        setPendingRequests(prev => prev.map(r => pendingRequestKey(r) === key ? { ...r, responseDeliveryUnknown: true } : r));
        setRequestResponses(prev => ({ ...prev, [key]: { error: `响应发送失败：${String(e)}` } }));
        await refreshPendingRequests();
      } finally {
        respondingRequestsRef.current.delete(key);
        setRequestResponses(prev => prev[key] ? { ...prev, [key]: { ...prev[key], sending: false } } : prev);
      }
    },
    [refreshPendingRequests]
  );

  const handleRespondServerRequest = useCallback(
    (requestId: any, result: any, generation: number) => submitServerResponse(requestId, generation, result, null),
    [submitServerResponse]
  );
  const handleRespondServerRequestError = useCallback(
    (requestId: any, message: string, generation: number) => submitServerResponse(requestId, generation, null, { code: -32000, message }),
    [submitServerResponse]
  );

  notificationNativeActionRef.current = async event => {
    const payload = event?.payload;
    const accountKey = notificationAccountRef.current;
    if (!accountKey || payload?.accountKey !== accountKey || payload?.hostId !== "local" || typeof payload?.threadId !== "string") return;
    if (personalizationNavigationGuardRef.current?.(() => { void notificationNativeActionRef.current(event); }) === false) return;
    const threadId = payload.threadId;
    // Only a live host-registered payload reaches this listener. Never execute a route from its text.
    const current = () => notificationAccountRef.current === accountKey;
    if (!current()) return;
    await selectThread(threadId);
    if (!current() || activeThreadIdRef.current !== threadId) return;
    if (event.action && event.action !== "open") {
      const request = pendingRequestsRef.current.find(request => pendingRequestKey(request) === payload.requestId && requestThreadId(request) === threadId);
      if (!request || !payload.requestNonce || request.notificationNonce !== payload.requestNonce || respondingRequestsRef.current.has(pendingRequestKey(request))) return;
      const result = notificationApprovalResponse(request, event.action);
      if (!result) throw Error("该通知操作已过期或不支持当前请求");
      await submitServerResponse(request.id, request.generation, result, null, payload.requestNonce);
    } else if (payload.requestId) {
      const card = document.getElementById(`approval-${payload.requestId}`);
      card?.focus();
      card?.scrollIntoView({ block: "center" });
    }
  };

  // 服务端消息队列（thread/queue/*）同步
  const refreshThreadQueue = useCallback(async (threadId?: string | null) => {
    const tid = threadId ?? activeThreadIdRef.current;
    if (!tid || tid !== activeThreadIdRef.current) return;
    const request = threadRequestRef.current;
    const listRequest = ++queueListRequestRef.current;
    try {
      const items: any[] = [];
      let cursor: string | null = null;
      do {
        const res: { data?: any[]; nextCursor?: string | null } = await callAppServer("thread/queue/list", { threadId: tid, cursor });
        if (!isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current) || listRequest !== queueListRequestRef.current) return;
        items.push(...(Array.isArray(res.data) ? res.data : []));
        cursor = res.nextCursor ?? null;
      } while (cursor);
      setFollowupQueue(
        items.filter(item => typeof item.id === "string" && typeof item.clientUserMessageId === "string").map((item) => {
          return {
            id: item.id,
            clientUserMessageId: item.clientUserMessageId,
            input: Array.isArray(item.input) ? item.input : [],
            text: (Array.isArray(item.input) ? item.input : []).filter((i: any) => typeof i.text === "string").map((i: any) => i.text).join("\n"),
            mode: "queue" as const,
            createdAt: Date.now(),
          };
        })
      );
    } catch (e) {
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current) && listRequest === queueListRequestRef.current) setQueueNotice(`读取队列失败：${String(e)}`);
    }
  }, []);

  // 服务端在空闲时会自动消费队首消息；这里只提供「立即发送队首」的显式操作。
  const handleStartServerQueue = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    const first = followupQueue[0];
    if (!tid || !first || queueMutationThreadsRef.current.has(tid) || steeredQueueItemsRef.current.has(`${tid}:${first.id}`)) return;
    if (isStreaming) {
      await handleSteerTurn(first.text, first);
      return;
    }
    const request = threadRequestRef.current;
    queueMutationThreadsRef.current.add(tid);
    setQueueMutationVersion(v => v + 1);
    try {
      const configuration = getModelConfiguration();
      const identity = executionIdentityRef.current;
      const cwd = threadsRef.current.find(thread => thread.id === tid)?.cwd || workspaceHintsRef.current[tid];
      const execution = await resolveExecutionContext(tid, cwd, cwd ? [cwd] : []);
      if (identity !== executionIdentityRef.current || !isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) return;
      await callAppServer("thread/settings/update", { threadId: tid, model: configuration.model,
        effort: configuration.reasoningEffort, serviceTier: configuration.serviceTier,
        approvalPolicy: execution.policy.approvalPolicy, approvalsReviewer: execution.policy.approvalsReviewer, sandboxPolicy: execution.policy.sandboxPolicy });
      if (identity !== executionIdentityRef.current || !isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) return;
      const revision = threadExecutionRevisionsRef.current.get(tid) ?? 0;
      const confirmed = await callAppServer<any>("thread/resume", { threadId: tid });
      if (identity !== executionIdentityRef.current || !isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) return;
      const confirmedPolicy = captureThreadExecutionPolicy(tid, confirmed, revision);
      if (!confirmedPolicy || JSON.stringify(confirmedPolicy) !== JSON.stringify(execution.policy)) throw new Error("队列权限更新未得到服务确认");
      await trackModelTurn(tid, configuration, () => callAppServer("thread/queue/start", {
        threadId: tid,
        queuedSubmissionId: first.id,
      }));
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) {
        setFollowupQueue(prev => prev.filter(item => item.id !== first.id));
        await refreshThreadQueue(tid);
      }
    } catch (e) {
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) showAppToast(`启动队列消息失败：${String(e)}`, "error");
    } finally {
      queueMutationThreadsRef.current.delete(tid);
      setQueueMutationVersion(v => v + 1);
    }
  }, [followupQueue, isStreaming, handleSteerTurn, refreshThreadQueue, showAppToast, getModelConfiguration, trackModelTurn, resolveExecutionContext, captureThreadExecutionPolicy]);

  const handleEnqueueFollowup = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    const text = promptInput;
    const files = attachedFiles;
    if (!tid || (!text.trim() && files.length === 0) || queueMutationThreadsRef.current.has(tid)) return;
    const request = threadRequestRef.current;
    queueMutationThreadsRef.current.add(tid);
    setQueueMutationVersion(v => v + 1);
    try {
      const { errors } = await persistThreadAttachments(tid, files);
      if (errors.length > 0) throw new Error(errors[0].message);
      if (!isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) return;
      const input: any[] = text.trim() ? [{ type: "text", text: text.trim() }] : [];
      for (const file of files) {
        input.push(file.kind === "image" || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name)
          ? { type: "localImage", path: file.path }
          : { type: "mention", name: file.name, path: file.path });
      }
      const result = await callAppServer<{ queuedSubmission: { id: string } }>("thread/queue/add", { threadId: tid, clientUserMessageId: crypto.randomUUID(), input });
      if (!result.queuedSubmission?.id) throw new Error("服务端未返回队列消息 ID");
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) {
        setPromptInput(value => value === text ? "" : value);
        setAttachedFiles(current => current === files ? [] : current);
        await refreshThreadQueue(tid);
      }
    } catch (e) {
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) showAppToast(`加入队列失败，草稿已保留：${String(e)}`, "error");
    } finally {
      queueMutationThreadsRef.current.delete(tid);
      setQueueMutationVersion(v => v + 1);
    }
  }, [promptInput, attachedFiles, refreshThreadQueue, showAppToast, setPromptInput]);

  const handleCancelQueuedFollowup = useCallback(async (item: QueuedFollowupPrompt) => {
    const tid = activeThreadIdRef.current;
    if (!tid || !item || queueMutationThreadsRef.current.has(tid)) return;
    const request = threadRequestRef.current;
    queueMutationThreadsRef.current.add(tid);
    setQueueMutationVersion(v => v + 1);
    try {
      const result = await callAppServer<{ deleted: boolean }>("thread/queue/delete", { threadId: tid, queuedSubmissionId: item.id });
      if (result.deleted !== true) throw new Error("服务端未确认删除");
      steeredQueueItemsRef.current.delete(`${tid}:${item.id}`);
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) {
        setQueueNotice("");
        setFollowupQueue(prev => prev.filter(row => row.id !== item.id));
        await refreshThreadQueue(tid);
      }
    } catch (e) {
      if (isCurrentThreadRequest(request, threadRequestRef.current, tid, activeThreadIdRef.current)) showAppToast(`取消队列消息失败：${String(e)}`, "error");
    } finally {
      queueMutationThreadsRef.current.delete(tid);
      setQueueMutationVersion(v => v + 1);
    }
  }, [refreshThreadQueue, showAppToast]);

  // 切换会话时载入该会话的服务端队列
  useEffect(() => {
    queueListRequestRef.current += 1;
    setFollowupQueue([]);
    setQueueNotice("");
    if (activeThreadId) void refreshThreadQueue(activeThreadId);
  }, [activeThreadId, refreshThreadQueue]);

  // Thread Pin, Rename, Archive
  const legacyProjectPinId = (projectId: string) => sidebarProjectMembership.localProjects?.find(
    project => project.serverProjectId === projectId && project.id !== projectId
  )?.id;
  const isProjectPinned = (projectId: string) => {
    const legacyId = legacyProjectPinId(projectId);
    return pinnedProjectIds?.some(id => id === projectId || id === legacyId) ?? false;
  };
  const setProjectPinned = async (projectId: string, pinned: boolean) => {
    if (projectPinPendingRef.current) return;
    projectPinPendingRef.current = true;
    try {
      const ids = await tauriInvoke<string[]>("project_set_pinned", {
        projectId, legacyProjectId: legacyProjectPinId(projectId), pinned,
      });
      ++projectPinRevisionRef.current;
      setPinnedProjectIds(ids);
    } catch {
      showAppToast("无法更新项目置顶状态。请重试。", "error");
    } finally {
      projectPinPendingRef.current = false;
    }
  };

  const pinMutationPendingRef = useRef(false);
  const archiveMutationPendingRef = useRef(false);
  const handleTogglePinThread = useCallback(
    async (threadId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (pinMutationPendingRef.current || archiveMutationPendingRef.current) return;
      pinMutationPendingRef.current = true;
      const nextPinned = !pinnedThreadIds.includes(threadId);
      try {
        const updated = await tauriInvoke<string[]>("thread_toggle_pin", {
          threadId,
          pinned: nextPinned,
        });
        ++threadPinRevisionRef.current;
        setPinnedThreadIds(updated);
      } catch (err) {
        console.warn("thread_toggle_pin failed:", err);
        showAppToast("无法更新置顶状态。请重试。", "error");
      } finally {
        pinMutationPendingRef.current = false;
      }
    },
    [pinnedThreadIds, showAppToast]
  );

  const handleRenameThread = useCallback(
    async (threadId: string, newName: string) => {
      try {
        await callAppServer("thread/name/set", { threadId, name: newName });
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, name: newName } : t))
        );
      } catch {
        showAppToast("无法保存更改。请重试", "error");
      }
    },
    [showAppToast]
  );

  const archiveLocalThread = useCallback(async (thread: ThreadSummary) => {
    const receipt = await tauriInvoke<{ pinnedThreadIds: string[]; pinPlacement: ProjectArchiveUndo["pinPlacement"]; localStateError: boolean }>(
      "thread_archive_toggle", { thread, archive: true });
    ++threadPinRevisionRef.current;
    setPinnedThreadIds(receipt.pinnedThreadIds);
    refreshThreadsGenerationRef.current += 1;
    activitySessionRef.current = excludeActivityThreads(activitySessionRef.current, [thread.id]);
    setThreads(previous => previous.filter(item => item.id !== thread.id));
    setArchiveRefreshTick(value => value + 1);
    return receipt;
  }, []);

  const undoProjectArchive = useCallback(async (archived: ProjectArchiveUndo[]) => {
    if (archiveMutationPendingRef.current || pinMutationPendingRef.current) {
      showAppToast("聊天操作正在进行，请稍后在设置中恢复。", "error");
      return;
    }
    archiveMutationPendingRef.current = true;
    try {
      let failed = 0;
      let localStateError = false;
      // Undo in reverse order so a removed pin's original next neighbour is available.
      for (const { thread, pinPlacement } of [...archived].reverse()) {
        try {
          const receipt = await tauriInvoke<{ pinnedThreadIds: string[]; localStateError: boolean }>("thread_archive_toggle", {
            thread, archive: false, restorePin: pinPlacement,
          });
          ++threadPinRevisionRef.current;
          setPinnedThreadIds(receipt.pinnedThreadIds);
          localStateError ||= receipt.localStateError;
        } catch {
          failed++;
        }
      }
      await refreshThreads();
      setArchiveRefreshTick(value => value + 1);
      const restored = archived.length - failed;
      if (failed) {
        showAppToast(`已恢复 ${restored} 个聊天，${failed} 个未确认恢复。请在设置中刷新已归档的聊天。`, "error");
      } else {
        showAppToast(localStateError ? "聊天已恢复，本地状态未能保存。" : "聊天已恢复", localStateError ? "error" : "success");
      }
    } catch {
      showAppToast("聊天恢复未确认。请在设置中刷新已归档的聊天。", "error");
    } finally {
      archiveMutationPendingRef.current = false;
    }
  }, [refreshThreads, showAppToast]);

  const handleArchiveThread = useCallback(
    async (thread: ThreadSummary, e?: React.MouseEvent, project?: { allowRunning: boolean }) => {
      e?.stopPropagation();
      if (archiveMutationPendingRef.current || pinMutationPendingRef.current) {
        if (project) throw Error("聊天操作正在进行，请稍后重试。");
        return;
      }
      archiveMutationPendingRef.current = true;
      try {
        if (project) {
          const automations = await tauriInvoke<{ targetThreadId?: string | null }[]>("automations_list");
          if (automations.some(task => task.targetThreadId === thread.id)) {
            throw Error("此聊天关联了计划任务，暂无法在项目页归档。");
          }
          const latest = threadsRef.current.find(item => item.id === thread.id);
          if (!latest || !thread.projectId || latest.projectId !== thread.projectId) {
            throw Error("聊天的项目归属已变化，请刷新后重试。");
          }
          const status = typeof latest.status === "string" ? latest.status : latest.status?.type;
          if ((status === "active" || status === "running") && !project.allowRunning) {
            throw Error("聊天正在运行，请重新打开归档操作并确认。");
          }
          thread = latest;
        }
        const receipt = await archiveLocalThread(thread);
        if (!project && activeThreadIdRef.current === thread.id) {
          startNewThread();
        }
        if (project) {
          showAppToast(receipt.localStateError ? "聊天已归档，本地状态未能保存。" : "聊天已归档",
            receipt.localStateError ? "error" : "success", { label: "撤销", onClick: () => { void undoProjectArchive([{ thread, pinPlacement: receipt.pinPlacement }]); } });
        } else if (receipt.localStateError) {
          showAppToast("聊天已归档，本地状态未能保存。", "error");
        }
      } catch (err) {
        showAppToast(`归档会话失败：${String(err)}`, "error");
        if (project) throw err;
      } finally {
        archiveMutationPendingRef.current = false;
      }
    },
    [archiveLocalThread, startNewThread, showAppToast, undoProjectArchive]
  );

  const handleArchiveProjectThreads = useCallback(async (projectId: string, projectName: string, confirmed: ThreadSummary[]) => {
    if (archiveMutationPendingRef.current || pinMutationPendingRef.current) throw Error("聊天操作正在进行，请稍后重试。");
    archiveMutationPendingRef.current = true;
    try {
      const automations = await tauriInvoke<{ targetThreadId?: string | null }[]>("automations_list");
      const scheduled = new Set(automations.map(task => task.targetThreadId));
      const archived: ProjectArchiveUndo[] = [];
      let localStateError = false;
      let retained = 0;
      const isRunning = (thread: ThreadSummary) => {
        const status = typeof thread.status === "string" ? thread.status : thread.status?.type;
        return status === "active" || status === "running";
      };
      for (const target of confirmed) {
        const latest = threadsRef.current.find(thread => thread.id === target.id);
        if (!latest || latest.projectId !== projectId || target.projectId !== projectId) continue;
        if (scheduled.has(target.id)) { retained++; continue; }
        if (isRunning(latest) && !isRunning(target)) continue;
        try {
          const receipt = await archiveLocalThread(latest);
          archived.push({ thread: latest, pinPlacement: receipt.pinPlacement });
          localStateError ||= receipt.localStateError;
        } catch {
          // A failed or uncertain write is never retried automatically.
        }
      }
      const failed = confirmed.length - archived.length;
      let message = failed
        ? `已归档 ${projectName} 中的 ${archived.length} 个聊天；${failed} 个未成功归档。`
        : `已归档 ${archived.length} 个聊天`;
      if (retained) message += `其中 ${retained} 个关联计划任务的聊天已保留。`;
      if (localStateError) message += " 本地状态未能保存。";
      showAppToast(message, failed || localStateError ? "error" : "success", archived.length ? {
        label: "撤销", onClick: () => { void undoProjectArchive(archived); },
      } : undefined);
      if (failed > retained) void refreshThreads();
    } finally {
      archiveMutationPendingRef.current = false;
    }
  }, [archiveLocalThread, refreshThreads, showAppToast, undoProjectArchive]);

  // Both archive entry points share the same service mutation boundary.
  const handleUnarchiveThread = useCallback(
    async (thread: ThreadSummary) => {
      if (archiveMutationPendingRef.current) throw new Error("归档操作正在进行，请稍后重试");
      archiveMutationPendingRef.current = true;
      try {
        await callAppServer("thread/unarchive", { threadId: thread.id });
        await refreshThreads();
        setArchiveRefreshTick((v) => v + 1);
      } finally {
        archiveMutationPendingRef.current = false;
      }
    },
    [refreshThreads]
  );

  const deleteArchivedThreads = useCallback(
    async (threadId: string | null, threadIds?: string[]): Promise<ArchiveDeleteResult> => {
      if (archiveMutationPendingRef.current) throw new Error("归档操作正在进行，请稍后重试");
      archiveMutationPendingRef.current = true;
      try {
        const result = await tauriInvoke<ArchiveDeleteResult>("thread_delete_archived", { threadId, ...(threadIds ? { threadIds } : {}) });
        if (!Array.isArray(result?.deletedThreadIds) ||
          !result.deletedThreadIds.every(id => typeof id === "string" && id.length > 0) ||
          (threadIds && result.deletedThreadIds.some(id => !threadIds.includes(id))) ||
          new Set(result.deletedThreadIds).size !== result.deletedThreadIds.length ||
          !(result.error === null || typeof result.error === "string")) {
          throw new Error("删除结果未确认，请刷新归档列表后检查");
        }
        const deleted = new Set(result.deletedThreadIds);
        if (deleted.size) refreshThreadsGenerationRef.current += 1;
        activitySessionRef.current = excludeActivityThreads(activitySessionRef.current, [...deleted]);
        setThreads(current => current.filter(thread => !deleted.has(thread.id)));
        setPinnedThreadIds(current => current.filter(id => !deleted.has(id)));
        await refreshThreads();
        setArchiveRefreshTick(v => v + 1);
        return result;
      } finally {
        archiveMutationPendingRef.current = false;
      }
    },
    [refreshThreads]
  );
  const handleDeleteArchivedThread = useCallback(
    (thread: ThreadSummary) => deleteArchivedThreads(thread.id),
    [deleteArchivedThreads]
  );
  const handleDeleteAllArchivedThreads = useCallback(
    () => deleteArchivedThreads(null),
    [deleteArchivedThreads]
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
        if (newThreadId) setSidebarCreatedThread({ id: String(newThreadId), cwd: res?.thread?.cwd || threadsRef.current.find((thread) => thread.id === currentId)?.cwd || undefined, projectId: res?.thread?.projectId });
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
        refreshThreadsGenerationRef.current += 1;
        activitySessionRef.current = excludeActivityThreads(activitySessionRef.current, [thread.id]);
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

  const workbenchWorkspaceRoots = useMemo(() => {
    const cwd = activeWorkspace?.path;
    if (!cwd) return [];
    const groups = buildSidebarProjectGroups(workspaces, sidebarProjectMembership);
    const matches = activeThreadObj
      ? sidebarThreadProjects(activeThreadObj, groups, sidebarProjectMembership, workspaceHints)
      : !activeThreadId ? groups.filter(group => group.id === resolveNewThreadProject(null, sidebarProjectMembership, cwd)?.id) : [];
    return mergeHookRoots([cwd], matches.length === 1 ? matches[0].rootPaths : []);
  }, [activeWorkspace?.path, activeThreadObj, activeThreadId, workspaces, sidebarProjectMembership, workspaceHints]);

  const rememberWorkspaceFile = useCallback((workspace: string, path: string) => {
    const explicit = explicitFileScopeRef.current;
    const matchedRoot = explicit?.cwd === workspace && fileDedupeKey(explicit.path) === fileDedupeKey(path)
      ? explicit.root : workbenchWorkspaceRoots.some(root => fileDedupeKey(root) === fileDedupeKey(workspace))
        ? fileSearchRoot(path, workbenchWorkspaceRoots) : undefined;
    if (!matchedRoot) return;
    const root = fileDedupeKey(matchedRoot);
    const key = fileDedupeKey(path);
    if (key === root) return;
    const updatedAt = Date.now();
    setRecentFilesByWorkspace(current => {
      const previous = current[root] ?? [];
      return { ...current, [root]: [{ path, updatedAt }, ...previous.filter(file => fileDedupeKey(file.path) !== key)].slice(0, 10) };
    });
    if (isTauriRuntime()) void tauriInvoke("fs_record_recent_file_access", { root: matchedRoot, path, threadId: activeThreadId ?? "", updatedAt })
      .catch(error => console.warn("最近文件记录写入失败", error));
  }, [activeThreadId, workbenchWorkspaceRoots]);
  const searchScopeProjects = sidebarProjectMembership.localProjects?.filter(project =>
    project.rootPaths.some(root => fileDedupeKey(root) === fileDedupeKey(activeWorkspace?.path ?? "")) &&
    project.rootPaths.every(root => workbenchWorkspaceRoots.some(candidate => fileDedupeKey(root) === fileDedupeKey(candidate))));

  const handleOpenQuickChat = useCallback(async () => {
    if (!isTauriRuntime()) {
      setShowPopoutModal(value => !value);
      return;
    }
    try { await tauriInvoke("quick_chat_toggle"); }
    catch (error) { showAppToast(`无法唤起独立聊天：${String(error)}`, "error"); }
  }, [showAppToast]);

  const quickChatContinueRef = useRef<(threadId: string) => void>(() => {});
  quickChatContinueRef.current = threadId => {
    if (activeThreadIdRef.current !== threadId) void selectThread(threadId);
    else setActiveRoute("thread");
    setComposerFocusRequest(request => request + 1);
  };
  useEffect(() => {
    if (isQuickChatWindow) return;
    if (isThreadWindow) return;
    let disposed = false;
    const subscription = tauriListen<{ threadId?: string }>("quick-chat:continue", payload => {
      if (!disposed && typeof payload?.threadId === "string" && payload.threadId.trim()) {
        quickChatContinueRef.current(payload.threadId);
      }
    });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, [isQuickChatWindow]);

  // 快捷键动作绑定（每次渲染刷新，键盘监听器稳定注册一次）
  const dispatchComponentShortcut = (id: string) => !window.dispatchEvent(new CustomEvent("codex:keyboard-command", { detail: { id }, cancelable: true }));
  const requestWorkbenchShortcut = (id: string) => {
    const tabNavigation = id === "next-tab" || id === "previous-tab" || id.startsWith("focus-tab-");
    if (!tabNavigation && !activeWorkspace?.path) return false;
    if (tabNavigation && !showRightDrawer) return false;
    setShowRightDrawer(true);
    if (id === "toggle-file-tree") setInitialWorkbenchTab("files");
    else if (id.startsWith("git-")) setInitialWorkbenchTab("changes");
    setWorkbenchShortcutRequest({ id, requestId: ++workbenchShortcutSequence.current, cwd: activeWorkspace?.path || "", wasOpen: showRightDrawer });
    return true;
  };
  const sidebarShortcutThreadIds = () => {
    // The official command temporarily mounts collapsed sidebar content. Keep
    // collapsed sections intact, and restore the shell before the browser paints.
    if (sidebarCollapsed) flushSync(() => setSidebarCollapsed(false));
    try {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".codex-sidebar .sidebar-thread-row[data-thread-id]"));
      const visible = rows.filter(row => row.isConnected && row.getClientRects().length > 0
        && !row.closest('[inert], [hidden], [aria-hidden="true"]') && getComputedStyle(row).visibility !== "hidden")
        .map(row => row.dataset.threadId!).filter(id => threadsRef.current.some(thread => thread.id === id));
      return [...new Set(visible)];
    } finally {
      if (sidebarCollapsed) flushSync(() => setSidebarCollapsed(true));
    }
  };
  const selectAdjacentThread = (offset: number) => {
    const ids = sidebarShortcutThreadIds();
    if (!ids.length) return false;
    const index = ids.indexOf(activeThreadId || "");
    const target = ids[index < 0 ? (offset > 0 ? 0 : ids.length - 1) : index + offset];
    if (!target) return false;
    void selectThread(target);
    return true;
  };
  shortcutHandlersRef.current = {
    ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`environment-action-${index + 1}`, () => environmentActionRunner.current?.(index) ?? false])),
    ...Object.fromEntries(SHORTCUTS.filter(shortcut => shortcut.id.startsWith("composer-") || shortcut.id.startsWith("approval-"))
      .map(shortcut => [shortcut.id, () => dispatchComponentShortcut(shortcut.id)])),
    ...Object.fromEntries(["toggle-file-tree", "git-commit", "git-create-pull-request", "git-create-draft-pull-request", "next-tab", "previous-tab",
      ...Array.from({ length: 9 }, (_, index) => `focus-tab-${index + 1}`)]
      .map(id => [id, () => requestWorkbenchShortcut(id)])),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`sidebar-thread-${index + 1}`, () => {
      const target = sidebarShortcutThreadIds()[index];
      if (!target) return false;
      void selectThread(target);
      return true;
    }])),
    "next-thread": () => selectAdjacentThread(1),
    "previous-thread": () => selectAdjacentThread(-1),
    "open-thread-new-window": () => { if (!activeThreadId) return false; void handleThreadMenuAction("open_new_window"); },
    "mark-thread-unread": () => {
      if (!activeThreadId || !isThreadReadState(activeThreadObj?.readState) || activeThreadObj.readState.firstUnread != null) return false;
      void handleSetThreadReadState(activeThreadId, activeThreadObj.readState.revision, true);
    },
    "delete-chat": () => { if (!activeThreadObj) return false; void handleDeleteThread(activeThreadObj, { stopPropagation() {} } as React.MouseEvent); },
    "copy-conversation-markdown": () => { if (!activeThreadId) return false; void handleThreadMenuAction("copy_markdown"); },
    "git-create-branch": () => {
      if (!activeWorkspace?.path || gitContextCwd !== activeWorkspace.path || !gitStatus?.branch) return false;
      const name = window.prompt("请输入新分支名称:");
      if (name?.trim()) void handleCreateBranch(name.trim());
    },
    ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`recent-thread-${index + 1}`, () => {
      const target = threadsRef.current[index];
      if (target) void selectThread(target.id);
    }])),
    "open-recent-thread": (threadId?: any) => {
      if (threadId) void selectThread(String(threadId));
    },
    "new-chat": () => startNewThread(),
    "new-standalone-chat": () => { void startNewThread(undefined, undefined, true); },
    "open-hotkey-window": () => { void handleOpenQuickChat(); },
    "open-model-picker": () => {
      const trigger = document.querySelector<HTMLButtonElement>(".model-effort-pill");
      if (trigger) {
        trigger.focus();
        if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      }
    },
    "toggle-sidebar": () => setSidebarCollapsed((v) => !v),
    "toggle-terminal": () => setShowTerminal((v) => !v),
    "toggle-bottom-panel": () => setShowTerminal((v) => !v),
    "toggle-changes": () => setShowRightDrawer((v) => !v),
    "zoom-in": () => applyZoom(zoomRef.current + 0.1),
    "zoom-out": () => applyZoom(zoomRef.current - 0.1),
    "zoom-reset": () => applyZoom(1),
    "open-settings": () =>
      setActiveRoute((r) => (r === "settings" ? "home" : "settings")),
    "show-keyboard-shortcuts": () => setShowKeyboardShortcuts((value) => !value),
    "command-palette": () => {
      setQuickSearchInitialQuery({ value: "" });
      setQuickSearchMode("root");
      setShowQuickSearch(true);
    },
    "command-palette-alt": () => {
      setQuickSearchInitialQuery({ value: "" });
      setQuickSearchMode("root");
      setShowQuickSearch(true);
    },
    "file-search": () => {
      const selection = showQuickSearch ? undefined : selectedFileSearchText();
      if (selection !== undefined) lastFileSearchSeed.current = selection;
      setQuickSearchInitialQuery({ value: lastFileSearchSeed.current });
      setQuickSearchMode("files");
      setShowQuickSearch(true);
    },
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
      if (activeThreadId) void handleTogglePinThread(activeThreadId);
    },
    "archive-thread": () => {
      if (activeThreadObj) void handleArchiveThread(activeThreadObj);
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
    "copy-working-dir": () => { if (!activeWorkspace?.path) return false; void handleThreadMenuAction("copy_cwd"); },
    "copy-last-code-block": async () => {
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
        const copied = await copyTextToClipboard(last);
        showAppToast(copied ? "✓ 已复制最后一段代码块" : "复制最后一段代码块失败", copied ? "success" : "error");
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
    setSettingsInitialSection("appearance");
    setActiveRoute("settings");
  }, []);

  const applyZoom = useCallback(async (next: number) => {
    zoomRef.current = Math.min(3, Math.max(0.5, next));
    if ("__TAURI_INTERNALS__" in window) {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoomRef.current);
    } else {
      (document.documentElement.style as any).zoom = String(zoomRef.current);
    }
    showAppToast(`界面缩放：${Math.round(zoomRef.current * 100)}%`, "info");
  }, [showAppToast]);

  const handleAppCommand = useCallback(async (command: string, payload?: any) => {
    if (keyboardState.capturing.current) return;
    const shortcutAction = shortcutHandlersRef.current[command];
    if (projectMoveConfirmation && (
      (typeof shortcutAction === "function" && !["zoom-in", "zoom-out", "zoom-reset"].includes(command)) ||
      ["open-workspace", "settings", "toggle-theme", "reload"].includes(command)
    )) return;
    if (shortcutAction) {
      if (keyboardShortcutsOpenRef.current && command !== "show-keyboard-shortcuts") return;
      runShortcutAction(command, payload);
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
      await applyZoom(next);
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
    if (command === "user-guide" || command === "changelog") {
      try {
        await tauriInvoke("open_help_link", { target: command === "user-guide" ? "guide" : "changelog" });
      } catch (error) {
        showAppToast(`无法打开帮助链接：${String(error)}`, "error");
      }
      return;
    }
    if (command === "open-config-toml") {
      let path = payload?.path as string | undefined;
      if (!path) {
        const config = await tauriInvoke<any>("config_read");
        path = config?.configPath;
      }
      if (path) {
        try { await tauriInvoke("open_path_external", { path }); }
        catch (error) { showAppToast(`无法打开 config.toml：${String(error)}`, "error"); }
      } else showAppToast("未找到 config.toml", "error");
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
  }, [applyZoom, cycleTheme, handlePickNewFolder, showAppToast, projectMoveConfirmation, runShortcutAction]);
  const appCommandRef = useRef(handleAppCommand);
  appCommandRef.current = handleAppCommand;

  useEffect(() => {
    if (isQuickChatWindow) return;
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
      if (!isThreadWindow) offTray = await installTrayHandler({
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
      model: selectedModelName,
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
  }, [turns, activeThreadObj, activeThreadId, selectedModelName, reasoningEffort, activeWorkspace, showAppToast]);

  const copyThreadText = useCallback(async (text: string, successMessage: string) => {
    const copied = await copyTextToClipboard(text);
    showAppToast(copied ? successMessage : "复制失败，请重试", copied ? "success" : "error");
    return copied;
  }, [showAppToast]);

  const handleCopyAllConversation = useCallback(async () => {
    if (turns.length === 0) {
      showAppToast("当前会话暂无消息内容", "info");
      return;
    }
    let fullText = "";
    turns.forEach((turn) => {
      turn.items.forEach((item) => {
        if (item.type === "userMessage") {
          fullText += `[用户]:\n${extractTextFromItem(item)}\n\n`;
        } else if (item.type === "agentMessage") {
          fullText += `[Codex]:\n${extractTextFromItem(item)}\n\n`;
        } else if (item.type === "command") {
          const cmdStr = Array.isArray(item.command) ? item.command.join(" ") : item.command || "";
          fullText += `[执行命令]: ${cmdStr}\n\n`;
        }
      });
    });
    if (await copyThreadText(fullText.trim(), "✓ 已复制全部对话内容到剪贴板")) {
      setShowExportPopover(false);
    }
  }, [turns, showAppToast, copyThreadText]);

  const handleClearCurrentThread = useCallback(() => {
    if (turns.length === 0) return;
    const ok = window.confirm("确定要清空当前会话的消息内容并重置为新对话吗？");
    if (!ok) return;
    setShowExportPopover(false);
    startNewThread();
    showAppToast("✓ 已重置并开启全新会话", "info");
  }, [turns.length, startNewThread, showAppToast]);

  const handleSlashAction = useCallback((action: string) => {
    if (isQuickChatWindow && ![
      "open_goal_dialog", "toggle_plan", "toggle_fast", "toggle_worktree", "new_chat",
      "steer_turn", "enqueue_followup", "approve_recent_denial",
    ].includes(action)) {
      showAppToast("此操作需要在主窗口中执行，请先回到主窗口。", "info");
      return;
    }
    if (action === "open_goal_dialog") {
      setShowGoalModal(true);
    } else if (action === "toggle_plan") {
      setPlanMode((v) => !v);
    } else if (action === "toggle_fast") {
      void toggleFastMode();
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
      if (activeThreadObj) void handleArchiveThread(activeThreadObj);
    } else if (action === "toggle_thread_pin") {
      if (activeThreadId) handleTogglePinThread(activeThreadId);
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
      void handleEnqueueFollowup();
    } else if (action === "set_followup_steer") {
      if (promptInput.trim()) void handleSteerTurn(promptInput);
    } else if (action === "open_side_chat") {
      setInitialWorkbenchTab("sideChat");
      setShowRightDrawer(true);
    } else if (action === "approve_recent_denial") {
      if (activePendingRequests.length > 0) {
        const lastReq = activePendingRequests[activePendingRequests.length - 1];
        document.getElementById(`approval-${pendingRequestKey(lastReq)}`)?.scrollIntoView({ block: "center" });
        showAppToast("请在当前会话的审批卡中确认操作", "info");
      } else {
        showAppToast("当前无待审批请求", "info");
      }
    } else if (action === "switch_mode_cloud" || action === "switch_mode_local") {
      showAppToast("远程/云端环境将在后续版本接入", "info");
    } else if (action === "new_standalone_chat") {
      void startNewThread(undefined, undefined, true);
    } else if (action === "open_cloud_environments") {
      setActiveRoute("cloud-environments");
    } else if (action === "share_thread") {
      if (shareAvailable && activeThreadId) setShareThreadId(activeThreadId);
      else showAppToast("当前账号的分享权限尚未确认或不可用。", "info");
    } else if (action === "resume_recent_thread") {
      if (threadsRef.current.length > 0) {
        void selectThread(threadsRef.current[0].id);
        showAppToast(`✓ 已恢复最近会话`, "info");
      } else {
        showAppToast("暂无最近会话可恢复", "info");
      }
    } else if (action === "reset_to_home") {
      const reset = () => {
        setPromptInput("");
        setAttachedFiles([]);
        setActiveRoute("home");
        showAppToast("已返回主页空白草稿", "info");
      };
      if (personalizationNavigationGuardRef.current?.(reset) !== false) reset();
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
    handleEnqueueFollowup,
    handleRespondServerRequest,
    isQuickChatWindow,
    activePendingRequests,
    shareAvailable,
    activeThreadObj,
    activeThreadId,
    promptInput,
    setPromptInput,
    showAppToast,
    setFollowupQueue,
  ]);

  const unreadInboxCount = useMemo(
    () => inboxItems.filter((i) => !i.read).length,
    [inboxItems]
  );
  const activityAttentionCount = useMemo(
    () => threads.filter(threadNeedsAttention).length,
    [threads]
  );
  const activityScope = JSON.stringify([modelAccountIdentity, appServerStatus.connected,
    appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent]);
  activityScopeRef.current = activityScope;
  const activitySnapshot = useMemo(() => activitySession?.scope === activityScope
    ? mergeActivitySession(activitySession, threads) : null, [activitySession, activityScope, threads]);
  activitySessionRef.current = activitySnapshot;
  const activityOnly = activitySnapshot !== null;
  useEffect(() => {
    if (activitySession !== activitySnapshot) setActivitySession(current => current === activitySession ? activitySnapshot : current);
  }, [activitySession, activitySnapshot]);
  const activityThreadIds = useMemo(() => activitySnapshot?.threadIds ?? [], [activitySnapshot]);
  const toggleActivity = useCallback(() => {
    const generation = ++activityGenerationRef.current;
    if (activitySessionRef.current) {
      activitySessionRef.current = null;
      setActivitySession(null);
      return;
    }
    const scope = activityScopeRef.current;
    const apply = () => {
      if (generation !== activityGenerationRef.current || scope !== activityScopeRef.current) return;
      const session = beginActivitySession(threadsRef.current, scope, Date.now());
      activitySessionRef.current = session;
      setActivitySession(session);
    };
    if (personalizationNavigationGuardRef.current?.(apply) !== false) apply();
  }, []);
  const loadMoreActivity = useCallback(() => {
    setActivitySession(current => current?.scope === activityScopeRef.current
      ? { ...current, visibleCount: current.visibleCount + 10 } : current);
  }, []);
  const markAllThreadsRead = useCallback(async () => {
    const session = activitySessionRef.current;
    if (!session) return;
    const generation = activityGenerationRef.current;
    const ids = new Set(session.threadIds);
    const unread = threadsRef.current.filter(thread => ids.has(thread.id) && isThreadReadState(thread.readState) && thread.readState.firstUnread != null);
    const current = (id: string) => generation === activityGenerationRef.current && session.scope === activityScopeRef.current &&
      activitySessionRef.current?.threadIds.includes(id);
    let attempted = false;
    await Promise.all(unread.map(async thread => {
      if (!current(thread.id) || readStateWritesRef.current.has(thread.id)) return;
      readStateWritesRef.current.add(thread.id);
      attempted = true;
      try {
        const latest = await callAppServer<any>("thread/read", { threadId: thread.id, includeTurns: false });
        if (!current(thread.id) || !isThreadReadState(latest?.readState) || latest.readState.firstUnread == null) return;
        const result = await callAppServer<any>("thread/readState/update", {
          threadId: thread.id, expectedRevision: latest.readState.revision, operation: { type: "read" },
        });
        if (!isThreadReadState(result?.readState)) throw new Error("服务未返回有效会话已读状态");
      } catch (error) {
        if (current(thread.id)) showAppToast(`更新会话已读状态失败：${String(error)}`, "error");
      } finally {
        readStateWritesRef.current.delete(thread.id);
      }
    }));
    if (attempted && session.scope === activityScopeRef.current) await refreshThreads();
  }, [refreshThreads, showAppToast]);

  const moveThreadToProject = useCallback(async (threadId: string, targetProjectId: string | null) => {
    if (!threadId || projectMoveBusy) return;
    const target = (sidebarProjectMembership.localProjects || [])
      .find((project) => project.serverProjectId === targetProjectId);
    const projectName = targetProjectId === null ? "聊天" : target?.name;
    if (targetProjectId !== null && !projectName) {
      showAppToast("目标项目当前不可用，请刷新后重试。", "error");
      return;
    }

    setProjectMoveBusy(true);
    try {
      const plan = await tauriInvoke<any>("thread_project_move_prepare", {
        threadId,
        targetProjectId,
      });
      if (plan.requiresConfirmation) {
        setProjectMoveConfirmation({
          threadId,
          targetProjectId,
          projectName: projectName!,
          plan,
        });
        return;
      }
      const result = await tauriInvoke<any>("thread_project_move_commit", {
        threadId,
        targetProjectId,
        plan,
        confirmMissingSources: false,
      });
      if (result.projectMembership) setSidebarProjectMembership(result.projectMembership);
      await refreshThreads();
      showAppToast(`已将会话移至「${projectName}」`, "success");
    } catch (error) {
      showAppToast(`移动会话失败：${String(error)}`, "error");
    } finally {
      setProjectMoveBusy(false);
    }
  }, [
    projectMoveBusy,
    sidebarProjectMembership.localProjects,
    refreshThreads,
    showAppToast,
  ]);

  const showWorkspaceOpenError = useCallback((message: string) => showAppToast(message, "error"), [showAppToast]);
  const workspaceOpenTargets = useWorkspaceOpenTargets({
    threadId: activeThreadId,
    cwd: activeWorkspace?.path,
    onError: showWorkspaceOpenError,
  });
  const threadMenuItems: ThreadActionItem[] = useMemo(() => {
    const pinned = !!(activeThreadId && pinnedThreadIds.includes(activeThreadId));
    const readState = activeThreadObj?.readState;
    const isUnread = isThreadReadState(readState) && readState.firstUnread != null;
    const moveTargets: ThreadActionItem[] = (sidebarProjectMembership.localProjects || [])
      .filter((project) => project.serverProjectId)
      .map((project) => ({
        id: `move_project:${project.id}`,
        label: project.name,
      }));
    moveTargets.push({ id: "move_project:__chats__", label: "聊天" });
    return [
      {
        id: "rename_thread",
        label: "重命名",
        icon: <PencilIcon size={14} />,
        hint: effectiveBindings("rename-thread", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / "),
      },
      {
        id: "move_thread_project",
        label: "移至项目",
        icon: <FolderIcon size={14} />,
        separatorBefore: true,
        disabled: projectMoveBusy || !activeThreadId,
        children: moveTargets,
      },
      {
        id: "find_in_chat",
        label: "在会话中查找",
        icon: <SearchIcon size={14} />,
        hint: effectiveBindings("find-in-chat", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / "),
      },
      ...(isThreadReadState(readState) ? [{
        id: "mark_unread",
        label: isUnread ? "标记为已读" : "标记为未读",
        icon: <BellIcon size={14} />,
      }] : []),
      {
        id: "toggle_thread_pin",
        label: pinned ? "取消置顶" : "置顶",
        icon: <PinIcon size={14} />,
        hint: effectiveBindings("pin-thread", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / "),
      },
      {
        id: "new_side_chat",
        label: "新建侧边聊天",
        icon: <MessagePlusIcon size={14} />,
        hint: effectiveBindings("open-side-chat", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / "),
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
        disabled: !shareAvailable || !activeThreadId,
        icon: <ShareIcon size={14} />,
        separatorBefore: true,
      },
      {
        id: "copy_menu",
        label: "复制",
        icon: <CopyIcon size={14} />,
        children: [
          { id: "copy_markdown", label: "复制 Markdown", hint: effectiveBindings("copy-conversation-markdown", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / ") },
          { id: "copy_last_code", label: "复制最后一段代码", hint: effectiveBindings("copy-last-code-block", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / ") },
          { id: "copy_cwd", label: "复制工作目录" },
          { id: "copy_deeplink", label: "复制深层链接" },
        ],
      },
      {
        id: "open_new_window",
        label: "在新窗口中打开",
        disabled: !activeThreadId,
        icon: <ExternalWindowIcon size={14} />,
        separatorBefore: true,
      },
      ...(workspaceOpenTargets.items ? [{
        id: "open_with_menu",
        label: "打开方式",
        icon: <OpenWithIcon size={14} />,
        children: workspaceOpenTargets.items,
      }] : []),
      {
        id: "archive_thread",
        label: "归档",
        icon: <ArchiveIcon size={14} />,
        hint: effectiveBindings("archive-thread", keyboardState.bindings, keyboardState.primaryNumberShortcutTarget).join(" / "),
        separatorBefore: true,
      },
    ];
  }, [
    activeThreadId,
    shareAvailable,
    pinnedThreadIds,
    activeThreadObj?.readState,
    sidebarProjectMembership.localProjects,
    projectMoveBusy,
    workspaceOpenTargets.items,
    keyboardState.bindings,
    keyboardState.primaryNumberShortcutTarget,
  ]);

  const handleThreadMenuAction = useCallback(
    async (id: string) => {
      try {
        if (id.startsWith("move_project:")) {
          const projectId = id.slice("move_project:".length);
          const targetProject = (sidebarProjectMembership.localProjects || [])
            .find((project) => project.id === projectId);
          if (projectId !== "__chats__" && !targetProject?.serverProjectId) {
            showAppToast("目标项目当前不可用，请刷新后重试。", "error");
            return;
          }
          const targetProjectId = projectId === "__chats__"
            ? null
            : targetProject!.serverProjectId!;
          await moveThreadToProject(activeThreadId!, targetProjectId);
        } else if (id === "rename_thread") {
          if (activeThreadId) {
            setThreadTitleInput(
              activeThreadObj?.name || activeThreadObj?.preview || "本地聊天"
            );
            setEditingThreadTitle(true);
          }
        } else if (id === "find_in_chat") {
          setShowFindBar(true);
        } else if (id === "mark_unread") {
          if (activeThreadId && isThreadReadState(activeThreadObj?.readState)) {
            await handleSetThreadReadState(activeThreadId, activeThreadObj.readState.revision,
              activeThreadObj.readState.firstUnread == null);
          }
        } else if (id === "toggle_thread_pin") {
          if (activeThreadId) {
            await handleTogglePinThread(activeThreadId);
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
          if (shareAvailable && activeThreadId) setShareThreadId(activeThreadId);
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
          if (!activeThreadId) return;
          const copied = await copyTextToClipboard(`codex://threads/${activeThreadId}`);
          showAppToast(copied ? "已复制会话深层链接" : "复制会话深层链接失败", copied ? "success" : "error");
        } else if (id === "open_new_window") {
          if (!activeThreadId) return;
          await tauriInvoke("open_thread_window", { threadId: activeThreadId });
        } else if (id.startsWith("open_target:")) {
          await workspaceOpenTargets.openTarget(id.slice("open_target:".length));
        } else if (id === "archive_thread") {
          if (activeThreadObj) await handleArchiveThread(activeThreadObj);
        }
      } catch (e: any) {
        showAppToast(`操作失败：${e?.message || e}`, "error");
      }
    },
    [
      activeThreadId,
      shareAvailable,
      activeThreadObj,
      activeWorkspace,
      handleForkThread,
      handleTogglePinThread,
      handleArchiveThread,
      startNewThread,
      turns,
      showAppToast,
      handleSetThreadReadState,
      sidebarProjectMembership.localProjects,
      moveThreadToProject,
      workspaceOpenTargets.openTarget,
    ]
  );

  const projectName =
    activeWorkspace?.label?.trim() ||
    (activeWorkspace?.path ? baseNameFsPath(activeWorkspace.path) || activeWorkspace.path : null);
  const threadStatusChip = describeThreadStatus(activeThreadStatus);
  const confirmProjectMove = async () => {
    if (!projectMoveConfirmation || projectMoveBusy) return;
    setProjectMoveBusy(true);
    try {
      const result = await tauriInvoke<any>("thread_project_move_commit", {
        threadId: projectMoveConfirmation.threadId,
        targetProjectId: projectMoveConfirmation.targetProjectId,
        plan: projectMoveConfirmation.plan,
        confirmMissingSources: true,
      });
      if (result.projectMembership) setSidebarProjectMembership(result.projectMembership);
      await refreshThreads();
      showAppToast(`已将会话移至「${projectMoveConfirmation.projectName}」`, "success");
      setProjectMoveConfirmation(null);
    } catch (error) {
      showAppToast(`移动会话失败：${String(error)}`, "error");
    } finally {
      setProjectMoveBusy(false);
    }
  };

  useEffect(() => {
    if (!projectMoveConfirmation) return;
    const previous = document.activeElement as HTMLElement | null;
    projectMoveCancelRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [projectMoveConfirmation]);

  const renderThreadComposer = () => (
    <ComposerBox
      dictationSessionKey={promptDraftKey}
      composerEnterBehavior={composerEnterBehavior}
      keyBindings={keyboardState.bindings}
      submissionDisabled={queueBusy || modelSelection.selectionPending || !!modelSelection.selectionDisabledReason || sendStartPendingRef.current.has(threadRequestRef.current)}
      variant="thread"
      promptInput={promptInput}
      onPromptInputChange={setPromptInput}
      onSendMessage={handleSendMessage}
      onInterruptTurn={handleInterruptTurn}
      onQueueMessage={handleEnqueueFollowup}
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
      modelsLoading={modelsLoading}
      modelsError={modelsError}
      onRefreshModels={refreshModels}
      selectedModelId={selectedModelId}
      defaultModelSelected={defaultModelSelected}
      onSelectModel={handleSelectComposerModel}
      reasoningEffort={reasoningEffort}
      onSelectReasoningEffort={setReasoningEffort}
      fastMode={fastMode}
      serviceTier={modelSelection.serviceTier}
      serviceTierAccess={modelSelection.serviceTierAccess}
      modelEligibilityContext={modelSelection.eligibilityContext}
      selectionPending={modelSelection.selectionPending}
      selectionError={modelSelection.selectionError}
      selectionDisabledReason={modelSelection.selectionDisabledReason}
      recentModelConfigurations={modelSelection.recentModelConfigurations}
      onSelectServiceTier={modelSelection.selectTier}
      onSelectConfiguration={modelSelection.selectConfiguration}
      onToggleFastMode={toggleFastMode}
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
  );
  const renderApprovals = () => (
    <ApprovalCenter
      requests={activePendingRequests}
      responseStates={requestResponses}
      onRefresh={refreshPendingRequests}
      onRespond={handleRespondServerRequest}
      onRespondError={handleRespondServerRequestError}
    />
  );

  if (isQuickChatWindow) {
    return <>
      <HotkeyWindow
        native
        title={activeWorkspace?.label || activeThreadObj?.name || "Codex"}
        threadId={activeThreadId}
        turns={turns}
        isStreaming={isStreaming}
        loading={loadingThread || appServerStatus.connecting}
        error={historyError || appServerStatus.lastError || null}
        notice={appToast?.message}
        composer={<>
          {queueNotice && <div role="alert">{queueNotice}</div>}
          {followupQueue.length > 0 && <div role="status">有 {followupQueue.length} 条消息排队，详情可在主窗口查看。</div>}
          {serverGoal && serverGoal.status !== "complete" && <ThreadGoalBanner
            goal={serverGoal}
            onEdit={() => setShowGoalModal(true)}
            onTogglePause={handleToggleGoalPause}
            onClear={handleClearGoal}
          />}
          {renderThreadComposer()}
        </>}
        approvals={renderApprovals()}
        onNewChat={() => { void startNewThread(); }}
        onClose={() => { void tauriInvoke("quick_chat_hide").catch(error => showAppToast(`无法隐藏独立聊天：${String(error)}`, "error")); }}
        onOpenMainApp={() => { void tauriInvoke("quick_chat_continue", { threadId: activeThreadId }).catch(error => showAppToast(`无法回到主窗口：${String(error)}`, "error")); }}
      />
      <ThreadGoalModal
        isOpen={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        initialObjective={serverGoal?.objective || promptInput.replace(/^\/goal\s*/, "")}
        isExistingGoal={Boolean(serverGoal)}
        onSaveGoal={handleSaveGoal}
      />
    </>;
  }

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
      {projectMoveConfirmation && (
        <div
          className="codex-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !projectMoveBusy) setProjectMoveConfirmation(null);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !projectMoveBusy) {
                setProjectMoveConfirmation(null);
              }
            } else if (event.key === "Tab") {
              const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (!first) {
                event.preventDefault();
              } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <section
            className="codex-modal-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="project-move-title"
            aria-describedby="project-move-description"
            style={{ width: 440, height: "auto", maxHeight: "80vh", flexDirection: "column", padding: 20 }}
          >
            <h2 id="project-move-title" style={{ margin: "0 0 10px", fontSize: "var(--text-lg)", fontWeight: 600 }}>
              将文件夹添加到 {projectMoveConfirmation.projectName}？
            </h2>
            <p id="project-move-description" style={{ margin: "0 0 10px", color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
              {projectMoveConfirmation.projectName} 中的所有聊天都将获得这些文件夹的访问权限：
            </p>
            <ul style={{ margin: "0 0 20px", paddingLeft: 20, overflowY: "auto", color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
              {(projectMoveConfirmation.plan.missingSources || []).map((path: string) => (
                <li key={path} style={{ overflowWrap: "anywhere", marginBottom: 4 }}>{path}</li>
              ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn-outline"
                ref={projectMoveCancelRef}
                disabled={projectMoveBusy}
                onClick={() => setProjectMoveConfirmation(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={projectMoveBusy}
                onClick={() => void confirmProjectMove()}
              >
                {projectMoveBusy ? "正在移动…" : "继续"}
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="codex-app-layout" data-active-thread-id={activeThreadId ?? undefined}>
      {/* ── 1. Far-Left Vertical Icon Navigation Rail ── */}
      <NavigationRail
        activeRoute={activeRoute}
        sidebarCollapsed={sidebarCollapsed}
        unreadInboxCount={unreadInboxCount}
        appServerConnected={appServerStatus.connected}
        accountInfo={accountInfo}
        petVisible={petVisible}
        onTogglePet={() => setPetVisible((v) => !v)}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onNavigate={(route) => { if (route === "library") setLibraryCleanupTab(null); setActiveRoute(route); }}
        onOpenUsage={() => {
          setSettingsInitialSection("usage");
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
        cloudRecentChats={cloudRecentChats}
        activeCloudThreadId={activeRoute === "cloud-draft" ? cloudDraft?.session.threadId : undefined}
        onCloudRecentAction={(chat, action) => void handleCloudRecentAction(chat, action)}
        onSelectCloudChat={chat => {
          const open = () => {
            if (!cloudRecentChatsRef.current?.includes(chat) || (activeRouteRef.current === "cloud-draft" &&
              cloudDraftRef.current?.session.threadId === chat.session.threadId)) return;
            setPublishedCloudTarget(null);
            setCloudDraft({ session: chat.session, title: chat.title, persisted: true, origin: "home" });
            setActiveRoute("cloud-draft");
          };
          if (personalizationNavigationGuardRef.current?.(open) !== false) open();
        }}
        pinnedThreadIds={pinnedThreadIds}
        pinnedProjectIds={pinnedProjectIds ?? undefined}
        projectCatalog={sidebarProjectCatalog}
        onSetProjectPinned={pinnedProjectIds ? setProjectPinned : undefined}
        workspaceHints={workspaceHints}
        projectMembership={sidebarProjectMembership}
        activeThreadId={activeThreadId}
        activityAttentionCount={activityAttentionCount}
        activityOnly={activityOnly}
        activityThreadIds={activityThreadIds}
        activityVisibleCount={activitySnapshot?.visibleCount ?? 10}
        onLoadMoreActivity={loadMoreActivity}
        onToggleActivity={toggleActivity}
        onMarkAllRead={markAllThreadsRead}
        hasAgentsMd={agentsMdInfo.found}
        onNavigate={(route) => { if (route === "library") setLibraryCleanupTab(null); setActiveRoute(route); }}
        onStartNewChat={startNewThread}
        onRemoveWorkspace={handleRemoveWorkspace}
        onPickNewFolder={handlePickNewFolder}
        onSelectThread={selectThread}
        onTogglePinThread={handleTogglePinThread}
        onArchiveThread={handleArchiveThread}
        onDeleteThread={handleDeleteThread}
        onRenameThread={handleRenameThread}
        onSetThreadReadState={handleSetThreadReadState}
        onMoveThreadToProject={moveThreadToProject}
        onRevealPath={handleRevealPath}
        onOpenAgentsMd={() => setShowAgentsMdModal(true)}
        onOpenQuickSearch={() => {
          setQuickSearchInitialQuery({ value: "" });
          setQuickSearchMode("root");
          setShowQuickSearch(true);
        }}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        refreshToken={projectsRefreshToken}
        createdThread={sidebarCreatedThread}
        onThreadsChanged={refreshThreads}
        onShowToast={showAppToast}
      />

      {/* ── 3. Main Workspace Area ── */}
      <main className={`codex-main-area ${showTerminal && !isCloudChatRoute ? "has-terminal-dock" : ""}`}>
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
            {activeRoute === "thread" && activeThreadId ? (
              <>
                {editingThreadTitle ? (
                  <input
                    className="thread-header-rename-input"
                    aria-label="聊天标题"
                    size={Math.max(1, threadTitleInput.length)}
                    value={threadTitleInput}
                    onChange={(e) => setThreadTitleInput(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === " ") e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.currentTarget.dataset.cancelRename = "true";
                        setEditingThreadTitle(false);
                      }
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim();
                      const original = activeThreadObj?.name || activeThreadObj?.preview || "本地聊天";
                      if (e.currentTarget.dataset.cancelRename !== "true" && name && name !== original && activeThreadId) {
                        handleRenameThread(activeThreadId, name);
                      }
                      setEditingThreadTitle(false);
                    }}
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
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
                  </button>
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
                {gitStatus?.branch && <div
                  className="project-branch-pill clickable"
                  onClick={() => setShowGitMenu((v) => !v)}
                  title="点击展开 Git 快捷操作菜单"
                  style={{ position: "relative" }}
                >
                  <BranchIcon size={13} />
                  <span>{gitStatus.branch} ⌄</span>

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
                            if (!gitPreferencesState.ready) throw Error("Git 设置尚未读取，请先打开设置重新读取。");
                            await tauriInvoke("git_push_changes", {
                              cwd: activeWorkspace?.path,
                              forceWithLease: gitPreferencesState.preferences["git-always-force-push"],
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
                </div>}

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
            ) : activeRoute !== "home" && activeRoute !== "thread" && !isCloudChatRoute ? (
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
          {!isCloudChatRoute && <div className="top-nav-right">
            <div className={`thread-header-actions-group ${activeRoute === "home" || turns.length === 0 ? "home-active" : ""}`}>
              {(activeRoute === "thread" || activeRoute === "home") && <EnvironmentActions
                cwd={(activeThreadId ? activeThreadObj?.cwd || workspaceHintsRef.current[activeThreadId] : null) || activeWorkspace?.path || ""}
                conversationId={activeThreadId || `draft:${activeWorkspace?.path || ""}`}
                connectionIdentity={JSON.stringify([modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion])}
                keyBindings={keyboardState.bindings}
                onRun={runEnvironmentAction}
                onRegisterRun={runner => { environmentActionRunner.current = runner; }}
                onOpenSettings={target => {
                  setEnvironmentTarget({ ...target, id: crypto.randomUUID() });
                  setSettingsInitialSection("local-environments");
                  setActiveRoute("settings");
                }}
              />}
              {/* Context & Token Usage Meter Indicator */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`window-chrome-icon-btn token-meter-trigger ${
                    showTokenMeterPopover ? "active" : ""
                  }`}
                  onClick={() => setShowTokenMeterPopover((v) => !v)}
                  title="上下文 Token 用量与速率限制"
                  style={{
                    padding: "0 6px",
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    borderRadius: 6,
                  }}
                >
                  <TokenUsageMeter
                    usage={tokenUsage}
                    rateLimits={rateLimits}
                    variant="compact"
                  />
                </button>

                {showTokenMeterPopover && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      right: 0,
                      zIndex: 1000,
                    }}
                  >
                    <TokenUsageMeter
                      usage={tokenUsage}
                      rateLimits={rateLimits}
                      variant="popover"
                    />
                  </div>
                )}
              </div>

              {/* 1. Chat Actions Menu (...) */}
              <ThreadActionsMenu
                items={threadMenuItems}
                onSelect={handleThreadMenuAction}
                onOpenChange={workspaceOpenTargets.onMenuOpenChange}
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
                title="新建标签页"
              >
                <SquarePlusIcon size={16} />
              </button>
            </div>
          </div>}
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
                onSelectThread={selectThread}
                onUnarchive={handleUnarchiveThread}
                onDelete={handleDeleteArchivedThread}
                onDeleteAll={handleDeleteAllArchivedThreads}
                onShowToast={showAppToast}
              />
            </div>
          </div>
        ) : activeRoute === "code-review" ? (
          <div className="full-route-view"><div className="full-route-container">
            <RemoteReviewView url={remotePullRequestUrl}
              scope={JSON.stringify([modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion])}
              onOpenUrl={openRemotePullRequest} onBack={() => setActiveRoute(turns.length > 0 ? "thread" : "home")} />
          </div></div>
        ) : activeRoute === "review" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <CodeReviewView
                key={activeWorkspace?.path || ""}
                workspacePath={activeWorkspace?.path}
                branches={gitContextCwd === activeWorkspace?.path ? gitBranches : []}
                defaultBranch={gitContextCwd === activeWorkspace?.path ? gitStatus?.defaultBranch : null}
                repositoryReady={gitContextCwd === activeWorkspace?.path}
                commits={gitCommits}
                busy={reviewBusy}
                lastResult={reviewLastResult}
                reviewResult={latestReview}
                reviewFindings={reviewFindings.comments.filter(comment => comment.threadId === latestReview?.threadId)}
                unresolvedFindings={reviewFindings.unresolved.filter(comment => comment.threadId === latestReview?.threadId)}
                onOpenReviewFinding={(finding) => {
                  setSelectedReviewFinding(finding);
                  setSelectedPreviewFile(finding.absolutePath);
                  setPreviewLine(undefined);
                  setInitialWorkbenchTab("files");
                  setShowRightDrawer(true);
                }}
                onStartReview={handleStartCodeReview}
                onOpenRemotePullRequest={openRemotePullRequest}
                onBack={() => setActiveRoute(turns.length > 0 ? "thread" : "home")}
              />
            </div>
          </div>
        ) : activeRoute === "projects" ? (
          <ProjectsIndexView
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            threads={threads}
            currentThreadId={activeThreadId}
            workspaceHints={workspaceHints}
            onSelectWorkspace={handleSelectWorkspace}
            onStartNewChatInProject={(path, project) => {
              if (!project) return startNewThread(path);
              const entity = sidebarProjectMembership.localProjects?.find(
                (item) => item.serverProjectId === project.id
              );
              if (!entity) {
                showAppToast("项目身份尚未同步，请刷新后重试。", "error");
                return;
              }
              return startNewThread(path, entity);
            }}
            onSelectThread={selectThread}
            onPickNewFolder={handlePickNewFolder}
            onRemoveWorkspace={handleRemoveWorkspace}
            onRevealPath={handleRevealPath}
            onDeleteThread={handleDeleteThread}
            onRenameThread={handleRenameThread}
            pinnedThreadIds={pinnedThreadIds}
            onTogglePinThread={handleTogglePinThread}
            onArchiveProjectThread={(thread, allowRunning) => handleArchiveThread(thread, undefined, { allowRunning })}
            onArchiveProjectThreads={handleArchiveProjectThreads}
            isProjectPinned={isProjectPinned}
            onSetProjectPinned={pinnedProjectIds ? setProjectPinned : undefined}
            refreshToken={projectsRefreshToken}
            onProjectsChanged={() => { setProjectsRefreshToken((c) => c + 1); refreshThreads(); }}
            onThreadsChanged={refreshThreads}
            onShowToast={showAppToast}
          />
        ) : activeRoute === "inbox" ? (
          <InboxView
            items={inboxItems}
            loadError={inboxLoadError}
            onRetryLoad={() => setInboxReloadToken((value) => value + 1)}
            onNavigateScheduled={() => setActiveRoute("scheduled")}
            onMarkAllRead={markAllInboxRead}
            onClearAll={() => {
              if (window.confirm("确定要清空收件箱中的全部通知吗？")) {
                if (!inboxHydrated) inboxHydrationChangesRef.current.cleared = true;
                setInboxItems([]);
              }
            }}
            onDeleteItem={(id, e) => {
              e.stopPropagation();
              if (!inboxHydrated) inboxHydrationChangesRef.current.removed.add(id);
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
          <div className="full-route-view automations-route">
            <div className="full-route-container automations-route-container">
              <AutomationsView
                activeWorkspaceRoot={activeWorkspace?.path || ""}
                models={models}
                onSelectThread={selectThread}
              />
            </div>
          </div>
        ) : activeRoute === "plugins" || activeRoute === "skills" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <SkillsMcpView
                activeWorkspaceRoot={activeWorkspace?.path || ""}
                connectionIdentity={JSON.stringify([modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent])}
                onConfigUpdated={refreshConfigOverview}
                onRestartAppServer={() => tauriInvoke("app_server_restart", { customCliPath: null })}
                onNavigationGuardChange={setPersonalizationNavigationGuard}
                initialTab={activeRoute === "skills" ? "skills" : "plugins"}
                onOpenSkillFile={handleOpenSkillFile}
                onTrySkill={handleTrySkill}
                initialPluginMode={pluginDirectoryMode}
                onManagePlugins={() => {
                  setSettingsInitialSection("plugins-settings");
                  setActiveRoute("settings");
                }}
                onStartSkillCreatorSession={(prompt) => {
                  startNewThread();
                  setThreadPrompt(null, prompt);
                  showAppToast("已启动 $skill-creator 引导会话", "info");
                }}
              />
            </div>
          </div>
        ) : activeRoute === "images" ? (
          <div className="full-route-view images-route-view">
            <div className="full-route-container images-route-container">
              <ImagesView />
            </div>
          </div>
        ) : activeRoute === "gpts" ? (
          <div className="full-route-view gpts-route-view">
            <div className="full-route-container gpts-route-container">
              <GptsView />
            </div>
          </div>
        ) : activeRoute === "sites" ? (
          <div className="full-route-view sites-route-view">
            <div className="full-route-container sites-route-container">
              <SitesView onNavigationChange={updateSitesNavigation} onSaveError={message => showAppToast(message, "error")} />
            </div>
          </div>
        ) : activeRoute === "library-file" && libraryFileId ? (
          <div className="full-route-view library-route-view">
            <div className="full-route-container library-route-container">
              <LibraryFileRoute key={libraryFileId} id={libraryFileId} onClose={closeLibraryFile} />
            </div>
          </div>
        ) : activeRoute === "library" ? (
          <div className={`full-route-view${libraryCleanupTab ? "" : " library-route-view"}`}>
            <div className={`full-route-container${libraryCleanupTab ? "" : " library-route-container"}`}>
              {libraryCleanupTab ? <LibraryCleanupView tab={libraryCleanupTab} onTabChange={setLibraryCleanupTab}
                scope={JSON.stringify([modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion])} /> : <LibraryView onNavigationChange={updateLibraryNavigation} routeUrl={!isQuickChatWindow && !isThreadWindow} />}
            </div>
          </div>
        ) : activeRoute === "cloud-new-chat" && publishedCloudTarget ? (
          <CloudNewChatView target={publishedCloudTarget} enterBehavior={composerEnterBehavior}
            onBack={() => { setPublishedCloudTarget(null); setActiveRoute("cloud-draft"); }}
            onOpen={session => {
              if (activeRouteRef.current !== "cloud-new-chat") return false;
              setCloudDraft({ session, persisted: true, origin: "cloud-environments" });
              setPublishedCloudTarget(null);
              setActiveRoute("cloud-draft");
              refreshCloudRecentRef.current?.();
              return true;
            }} />
        ) : activeRoute === "cloud-draft" && cloudDraft ? (
          <CloudDraftView key={cloudDraft.session.threadId} session={cloudDraft.session} persisted={cloudDraft.persisted} title={cloudDraft.title}
            backToHome={cloudDraft.origin === "home"}
            onNewPublishedChat={target => {
              if (activeRouteRef.current !== "cloud-draft" || cloudDraftRef.current?.session !== cloudDraft.session) return;
              setPublishedCloudTarget(target);
              setActiveRoute("cloud-new-chat");
            }} onBack={() => {
            if (cloudDraft.origin === "settings") setSettingsInitialSection("codex-cloud");
            setActiveRoute(cloudDraft.origin);
          }} />
        ) : activeRoute === "cloud-environments" || activeRoute === "cloud-draft" || activeRoute === "cloud-create" ? (
          <div className="full-route-view cloud-envs-route-view">
            <div className="full-route-container cloud-envs-route-container">
              <CloudEnvironmentsView key={activeRoute === "cloud-create" ? "create-link" : "list"}
                onCloseCreate={activeRoute === "cloud-create" ? closeCloudCreate : undefined}
                returnFocusId={cloudDraft?.origin === "cloud-environments" ? cloudDraft.session.binding.configId : undefined} onOpenDraft={(session, persisted) => {
                if (activeRoute === "cloud-create" && activeRouteRef.current !== "cloud-create") return;
                setCloudDraft({ session, persisted, origin: activeRoute === "cloud-create" ? "home" : "cloud-environments" });
                setActiveRoute("cloud-draft");
              }} />
            </div>
          </div>
        ) : activeRoute === "worktrees" ? (
          <div className="full-route-view">
            <div className="full-route-container">
              <WorktreesView
                key={activeWorkspace?.path || ""}
                activeWorkspaceRoot={activeWorkspace?.path || ""}
                onSelectThread={selectThread}
                onStartChatInWorktree={async (wtPath) => {
                  const navigation = ++navigationRequestRef.current;
                  try {
                    const updated = await tauriInvoke<WorkspaceRootItem[]>("workspace_add", {
                      path: wtPath,
                      setActive: false,
                    });
                    if (navigation !== navigationRequestRef.current) return;
                    setWorkspaces(updated);
                    setUseWorktree(false);
                    startNewThread(wtPath);
                    showAppToast(`✓ 已在 Worktree 目录打开新会话草稿: ${wtPath}`, "info");
                  } catch (error) {
                    if (navigation === navigationRequestRef.current) {
                      showAppToast(`打开 Worktree 会话失败：${String(error)}`, "error");
                    }
                  }
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
              cloudEnvironmentFocusId={cloudDraft?.origin === "settings" ? cloudDraft.session.binding.configId : undefined}
              onOpenCloudDraft={(session, persisted) => {
                setCloudDraft({ session, persisted, origin: "settings" });
                setActiveRoute("cloud-draft");
              }}
              onOpenLibraryStorage={(tab) => { setLibraryCleanupTab(tab); setActiveRoute("library"); }}
              environmentTarget={environmentTarget}
              onRunEnvironmentAction={runEnvironmentAction}
              environmentProjects={mergeHookRoots(workspaces.map(workspace => workspace.path), sidebarProjectMembership.localProjects?.flatMap(project => project.rootPaths) ?? []).map(path => ({ path, name: sidebarProjectMembership.localProjects?.find(project => project.rootPaths.includes(path))?.name || workspaces.find(workspace => workspace.path === path)?.label || baseNameFsPath(path) || path }))}
              onAddEnvironmentProject={() => void handlePickNewFolder()}
              workspaceRoots={mergeHookRoots(workspaces.map(workspace => workspace.path), sidebarProjectMembership.localProjects?.find(project => project.id === sidebarProjectMembership.selectedProjectId)?.rootPaths ?? [])}
              accountIdentity={modelAccountIdentity}
              onAccountChanged={() => void refreshAccount()}
              onNavigationGuardChange={setPersonalizationNavigationGuard}
              archiveViewProps={{
                workspaces,
                projectMembership: sidebarProjectMembership,
                workspaceHints,
                refreshToken: `${archiveRefreshTick}:${appServerStatus.connected}`,
                onSelectThread: selectThread,
                onUnarchive: handleUnarchiveThread,
                onDurableRestored: () => refreshCloudRecentRef.current?.(),
                onOpenDurableChat: chat => {
                  if (activeRouteRef.current !== "settings") return;
                  setPublishedCloudTarget(null);
                  setCloudDraft({ session: chat.session, title: chat.title, persisted: true, origin: "home" });
                  setActiveRoute("cloud-draft");
                },
                onDelete: handleDeleteArchivedThread,
                onDeleteAll: handleDeleteAllArchivedThreads,
                onDeleteProject: threadIds => deleteArchivedThreads(null, threadIds),
                onShowToast: showAppToast,
              }}
              notificationState={notificationState}
              gitPreferencesState={gitPreferencesState}
              codeReviewPreferencesState={codeReviewPreferencesState}
              externalImportsState={externalImportsState}
              onRunEnvironmentCommand={(cwd, command) => {
                if (pendingTermCommand) throw Error("终端已有待处理命令，请先查看终端。");
                setTerminalTargetCwd(cwd);
                setShowTerminal(true);
                setPendingTermCommand({ id: Date.now(), command, cwd });
              }}
              appearanceState={appearanceState}
              keyboardState={keyboardState}
              composerEnterBehavior={composerEnterBehavior}
              composerEnterSaving={composerEnterSaving}
              composerEnterError={composerEnterError}
              onSetComposerEnterBehavior={handleSetComposerEnterBehavior}
              appServerStatus={appServerStatus}
              models={getPickerModels(models)}
              initialSection={settingsInitialSection}
              activeWorkspaceRoot={activeWorkspace?.path || ""}
              petPreferencesState={petPreferencesState}
              petVisible={petVisible}
              onTogglePetVisible={setPetVisible}
              onRestartAppServer={(cliPath) =>
                tauriInvoke("app_server_restart", {
                  customCliPath: cliPath || null,
                })
              }
              onConfigUpdated={async () => { await refreshConfigOverview(); await modelSelection.refreshPreferences(); await refreshModels(); }}
              onNavigateRoute={(r) => {
                if (r === "plugins" || r === "skills") setPluginDirectoryMode("browse");
                setActiveRoute(r);
              }}
            />
          </div>
        ) : activeRoute === "home" || (!activeThreadId && turns.length === 0) ? (
          /* ── Home / New Task View ── */
          <div className="home-hero-container">
            <div className="home-hero-center">
              <div className="home-hero-logo-wrap">
                <CodexHomeIcon />
              </div>

              <div
                className="home-greeting-wrap"
                onKeyDown={(event) => {
                  if (!showHomeProjectPopover || event.key !== "Escape" ||
                    event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setShowHomeProjectPopover(false);
                  event.currentTarget.querySelector<HTMLButtonElement>(".home-project-inline-btn")?.focus();
                }}
              >
                <h1 className="home-greeting-title">
                  {!projectName ? "我们要构建什么？" : (
                    <>
                      {gitStatus?.isGitRepo ? "你想让我们在 " : "我们应该在"}
                      <button
                        type="button"
                        className="home-project-inline-btn"
                        onClick={() => setShowHomeProjectPopover((v) => !v)}
                        aria-haspopup="dialog"
                        aria-expanded={showHomeProjectPopover}
                        aria-controls={showHomeProjectPopover ? "home-project-picker" : undefined}
                        title="点击切换本地项目文件夹"
                      >
                        {projectName}
                      </button>
                      {gitStatus?.isGitRepo ? " 中构建什么？" : "中做些什么？"}
                    </>
                  )}
                </h1>

                {projectName && showHomeProjectPopover && (
                  <div id="home-project-picker" role="dialog" aria-label="选择项目" className="home-project-popover-anchor">
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
            </div>

            <div className="home-composer-dock">
              {serverGoal && serverGoal.status !== "complete" && (
                <ThreadGoalBanner
                  goal={serverGoal}
                  onEdit={() => setShowGoalModal(true)}
                  onTogglePause={handleToggleGoalPause}
                  onClear={handleClearGoal}
                />
              )}

              {!showPopoutModal && (
              <ComposerBox
                  dictationSessionKey={homeCloud.active ? "home-cloud" : promptDraftKey}
                composerEnterBehavior={composerEnterBehavior}
                keyBindings={keyboardState.bindings}
                submissionDisabled={homeCloud.active ? !homeCloud.canSend : queueBusy || modelSelection.selectionPending || !!modelSelection.selectionDisabledReason || sendStartPendingRef.current.has(threadRequestRef.current)}
              variant="home"
              homeCloud={homeCloud}
              onCreateCloudEnvironment={() => setActiveRoute("cloud-create")}
              onManageCloudEnvironments={() => { setSettingsInitialSection("codex-cloud"); setActiveRoute("settings"); }}
              promptInput={homeCloud.active ? homeCloud.entry?.text ?? homeCloud.prompt : promptInput}
              onPromptInputChange={homeCloud.active ? homeCloud.setPrompt : setPromptInput}
              onSendMessage={homeCloud.active ? () => {
                const navigation = navigationRequestRef.current;
                return homeCloud.send(session => {
                  if (activeRouteRef.current !== "home" || navigationRequestRef.current !== navigation) return false;
                  setCloudDraft({ session, persisted: true, origin: "home" });
                  setActiveRoute("cloud-draft");
                  refreshCloudRecentRef.current?.();
                  return true;
                });
              } : handleSendMessage}
              onInterruptTurn={handleInterruptTurn}
              onQueueMessage={handleEnqueueFollowup}
              isStreaming={!homeCloud.active && isStreaming}
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
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              onRefreshModels={refreshModels}
              selectedModelId={selectedModelId}
              defaultModelSelected={defaultModelSelected}
              onSelectModel={handleSelectComposerModel}
              reasoningEffort={reasoningEffort}
              onSelectReasoningEffort={setReasoningEffort}
              fastMode={fastMode}
              serviceTier={modelSelection.serviceTier}
              serviceTierAccess={modelSelection.serviceTierAccess}
              modelEligibilityContext={modelSelection.eligibilityContext}
              selectionPending={modelSelection.selectionPending}
              selectionError={modelSelection.selectionError}
              selectionDisabledReason={modelSelection.selectionDisabledReason}
              recentModelConfigurations={modelSelection.recentModelConfigurations}
              onSelectServiceTier={modelSelection.selectTier}
              onSelectConfiguration={modelSelection.selectConfiguration}
              onToggleFastMode={toggleFastMode}
              planMode={planMode}
              onTogglePlanMode={handleTogglePlanMode}
              attachedFiles={homeCloud.active ? [] : attachedFiles}
              onAttachFiles={handleAttachFiles}
              onAppshot={handleAppshot}
              onAddAttachedFiles={homeCloud.active ? undefined : (newFiles) =>
                setAttachedFiles((prev) => mergeAttachmentItems(prev, newFiles))
              }
              onRemoveAttachedFile={handleRemoveAttachedFile}
              workspaceFiles={workspaceFiles}
              workspaceFileHits={workspaceFileHits}
              skills={skills}
              onSlashAction={handleSlashAction}
              textareaRef={composerTextareaRef}
            />
              )}
            </div>
          </div>
        ) : (
          /* ── Active Local Conversation Stream (/local/:clientThreadId) ── */
          <>
            <div className="timeline-scroll-pane" ref={timelineScrollRef} onScroll={(event) => {
              const pane = event.currentTarget;
              followTimelineRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 64;
            }}>
              {loadingThread && <div role="status">正在加载会话…</div>}
              {historyError && <div role="alert">{historyError} <button type="button" onClick={() => {
                if (turnsCursorRef.current) void loadEarlierTurns();
                else if (activeThreadId) void selectThread(activeThreadId);
              }}>重试</button></div>}
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
                onCopy={(text) => copyThreadText(text, "✓ 选区内容已复制到剪贴板")}
              />
              {/* Right-Side User Message Navigation Rail */}
              {turns.filter(t => t.items.some(i => i.type === "userMessage" || i.type === "user")).length >= 4 && <div className="thread-user-message-navigation-rail">
                {turns
                  .filter((t) => t.items.some((i) => i.type === "userMessage" || i.type === "user"))
                  .map((turn, uIdx) => {
                    const txt = turn.items.filter(i => i.type === "userMessage" || i.type === "user").map(extractTextFromItem).join(" ");
                    const bookmarks = (activeThreadId && bookmarkedTurnIds[activeThreadId]) || [];
                    const isBookmarked = bookmarks.includes(turn.id);
                    return (
                      <button
                        key={turn.id}
                        type="button"
                        className={`user-turn-jump-dot ${isBookmarked ? "bookmarked" : ""}`}
                        title={`${isBookmarked ? "★ [已收藏] " : ""}跳转到第 ${uIdx + 1} 条提问: ${txt.slice(0, 40)}`}
                        aria-label={`跳转到第 ${uIdx + 1} 条提问: ${txt.slice(0, 40)}`}
                        onClick={() => {
                          const el = document.getElementById(`turn-user-${turn.id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      />
                    );
                  })}
              </div>}

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
                  const commands = turn.items.filter((item) =>
                    ["commandExecution", "command", "execCommand", "toolCall"].includes(item.type)
                  );
                  const fileChanges = turn.items.filter((item) =>
                    ["fileChange", "diff", "file_change"].includes(item.type)
                  );
                  const meaningfulThoughts = thoughts.filter(
                    (item) => extractReasoningText(item).trim().length > 0
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

                  const isCurrentlyThinking =
                    isStreaming &&
                    turn.status === "running" &&
                    thoughts.length > 0 &&
                    messages.length === 0;
                  const isExpanded = expandedThoughts[turn.id] ?? false;

                  const hasAssistantContent =
                    turn.items.some(item => item.type !== "userMessage" && item.type !== "user") ||
                    (isStreaming && turn.status === "running");

                  const effectiveUserItems = userItems.length > 1
                    ? [userItems.find((it) => !it.id?.startsWith("u-") && !it.id?.startsWith("pending-")) || userItems[0]]
                    : userItems;
                  const userText = effectiveUserItems.map(extractTextFromItem).join("\n\n");
                  const isBookmarked = (activeThreadId && bookmarkedTurnIds[activeThreadId]?.includes(turn.id)) || false;
                  const renderCommand = (cmd: TurnItem, cIdx: number) => (
                        <CommandExecutionCard key={cmd.id || cIdx} item={cmd} turnStatus={turn.status}
                          onOpenFile={filePath => { openPreviewFile(filePath); }} />
                      );
                  const renderFileChange = (fc: TurnItem, fIdx: number) => (
                    <FileChangeCard key={fc.id || fIdx} item={fc} turnStatus={turn.status}
                      cwd={fc.cwd || activeThreadObj?.cwd || activeWorkspace?.path} onOpenFile={openPreviewFile} />
                  );
                  const renderPlan = (plan: TurnItem, pIdx: number) => (
                        <div key={plan.id || pIdx} className="plan-inline-card">
                          <div className="plan-inline-header">
                            <BrainIcon size={13} />
                            <span>执行计划</span>
                          </div>
                          <pre className="plan-inline-body">
                            {extractTextFromItem(plan)}
                          </pre>
                        </div>
                      );
                  const renderMcpCall = (call: TurnItem, mcIdx: number) => (
                    <McpCallCard key={call.id || mcIdx} item={call}
                      onOpenSchedule={activeThreadId ? (id, trigger) => {
                        const open = () => {
                          threadScheduleTrigger.current = trigger;
                          setThreadScheduleTask({ id, threadId: activeThreadId });
                        };
                        if (personalizationNavigationGuardRef.current?.(open) !== false) open();
                      } : undefined} />
                  );
                  const renderWebSearch = (search: TurnItem, wsIdx: number) => {
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
                      };
                  const renderImage = (img: TurnItem, imIdx: number) => {
                        if (img.type === "imageGeneration") return <GeneratedImageCard
                          key={img.id || imIdx} item={img} turnStatus={turn.status}
                          onOpenFile={path => { openPreviewFile(path); }} />;
                        const path = img.path || img.savedPath || "";
                        return (
                          <div
                            key={img.id || imIdx}
                            className="image-item-card"
                            onClick={() => {
                              if (path) {
                                openPreviewFile(path);
                              }
                            }}
                          >
                            <span>🖼️ 查看图片</span>
                            <span className="mono ellipsis" title={path}>
                              {path.split(/[/\\]/).pop() || ""}
                            </span>
                          </div>
                        );
                      };
                  const renderSystemEvent = (evt: TurnItem, sIdx: number) => {
                        let text = "⚡ 系统事件";
                        if (evt.type === "contextCompaction") text = "🗜️ 上下文已自动压缩整理 (Context compacted)";
                        else if (evt.type === "enteredReviewMode") text = "🔍 已进入代码审查模式 (Entered review mode)";
                        else if (evt.type === "exitedReviewMode") text = "✓ 已退出代码审查模式 (Exited review mode)";
                        else if (evt.type === "hookPrompt") text = `🪝 触发钩子提示：${(evt as any).hookName || "Hook"}`;
                        else if (evt.type === "sleep") text = evt.durationMs != null ? `💤 等待操作完成 (${evt.durationMs}ms)...` : "💤 等待操作完成...";
                        return (
                          <div key={evt.id || sIdx} className="timeline-system-pill">
                            {text}
                          </div>
                        );
                      };
                  const renderMessage = (msg: TurnItem, mIdx: number) => (
                        <MarkdownView
                          key={msg.id || mIdx}
                          content={extractTextFromItem(msg)}
                          onRunCommand={(cmd) => {
                            setShowTerminal(true);
                            setPendingTermCommand({ id: Date.now(), command: cmd });
                          }}
                          onOpenFile={(filePath) => {
                            openPreviewFile(filePath);
                          }}
                        />
                      );
                  const renderThought = (item: TurnItem) => {
                    const meaningfulThoughts = extractReasoningText(item).trim() ? [item] : [];
                    const shouldShowThoughts = meaningfulThoughts.length > 0 || isCurrentlyThinking;
                    return (shouldShowThoughts && (
                        <div className="thought-activity-container">
                          <button
                            type="button"
                            className={`thought-workflow-btn ${isExpanded ? "expanded" : ""}`}
                            onClick={() =>
                              setExpandedThoughts((prev) => ({
                                ...prev,
                                [turn.id]: !isExpanded,
                              }))
                            }
                          >
                            <span className={`thought-workflow-title ${isCurrentlyThinking ? "anim-shimmer-pulse" : ""}`}>
                              {isCurrentlyThinking
                                ? "思考中"
                                : (() => {
                                    const dur = turn.durationMs
                                      ? turn.durationMs / 1000
                                      : turn.completedAt && turn.startedAt
                                      ? (turn.completedAt - turn.startedAt) / 1000
                                      : null;
                                    return dur !== null
                                      ? `用时 ${formatHermesDuration(dur)}`
                                      : "已思考一段时间";
                                  })()}
                            </span>
                            <span className={`thought-workflow-arrow ${isExpanded ? "rotated" : ""}`}>
                              <ChevronDownIcon size={14} />
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="thought-workflow-body">
                              <MarkdownView
                                content={
                                  meaningfulThoughts.length > 0
                                    ? meaningfulThoughts.map(extractReasoningText).join("\n\n")
                                    : "正在深入思考中…"
                                }
                                onOpenFile={(filePath) => {
                                  openPreviewFile(filePath);
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ));
                  };

                  return (
                    <React.Fragment key={turn.id}>
                      {userItems.length > 0 && (
                        <div
                          id={`turn-user-${turn.id}`}
                          className="user-turn-block"
                        >
                          <UserMessageBubble text={userText} onOpenFile={(filePath) => {
                            openPreviewFile(filePath);
                          }} />
                          <div className="turn-action-buttons-row right">
                            <button
                              type="button"
                              className={`turn-action-mini-btn ${isBookmarked ? "active" : ""}`}
                              title={isBookmarked ? "取消收藏此提问" : "收藏/书签此提问 (Bookmark)"}
                              onClick={() => toggleBookmark(turn.id)}
                            >
                              <Bookmark size={14} aria-hidden="true" />{isBookmarked ? "已收藏" : "收藏"}
                            </button>
                            <button
                              type="button"
                              className="turn-action-mini-btn"
                              title="复制提问内容"
                              aria-label="复制消息"
                              onClick={async () => {
                                await copyThreadText(userText, "✓ 已复制提问内容");
                              }}
                            >
                              <CopyIcon size={14} />
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
                              <PencilIcon size={14} />
                            </button>
                            <button
                              type="button"
                              className="turn-action-mini-btn"
                              title="从当前回合分叉出会话 (Fork)"
                              onClick={() => handleForkChat(turn.id)}
                            >
                              <ForkIcon size={14} />
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
                                  fontSize: "calc(11px * var(--font-ui-scale, 1))",
                                  color: "var(--accent-blue, #3b82f6)",
                                  fontWeight: 500,
                                }}
                              >
                                · 进行中 (Working...)
                              </span>
                            ) : turn.status === "interrupted" ? (
                              <span
                                style={{
                                  fontSize: "calc(11px * var(--font-ui-scale, 1))",
                                  color: "var(--text-tertiary)",
                                  fontWeight: 500,
                                }}
                              >
                                · 已暂停 (Paused)
                              </span>
                            ) : turn.status === "failed" ? (
                              <span
                                style={{
                                  fontSize: "calc(11px * var(--font-ui-scale, 1))",
                                  color: "#ef4444",
                                  fontWeight: 500,
                                }}
                              >
                                · 异常 (Failed)
                              </span>
                            ) : turn.durationMs ? (
                              <span
                                style={{
                                  fontSize: "calc(11px * var(--font-ui-scale, 1))",
                                  color: "var(--text-tertiary)",
                                  fontWeight: 400,
                                }}
                              >
                                · {(turn.durationMs / 1000).toFixed(1)}s
                              </span>
                            ) : null}
                          </div>

                      {turn.items.map((item, index) => {
                        let content: React.ReactNode;
                        switch (item.type) {
                          case "userMessage": case "user": return null;
                          case "reasoning": case "thought": content = renderThought(item); break;
                          case "commandExecution": case "command": case "execCommand": case "toolCall": content = renderCommand(item, index); break;
                          case "fileChange": case "diff": case "file_change": content = renderFileChange(item, index); break;
                          case "plan": content = renderPlan(item, index); break;
                          case "mcpToolCall": case "mcpCall": case "mcp": content = renderMcpCall(item, index); break;
                          case "dynamicToolCall": case "functionCallOutput": case "collabAgentToolCall": case "subAgentActivity": content = <ToolCallCards items={[item]} onOpenThread={selectThread} />; break;
                          case "webSearch": case "search": content = renderWebSearch(item, index); break;
                          case "imageView": case "imageGeneration": case "image": content = renderImage(item, index); break;
                          case "contextCompaction": case "enteredReviewMode": case "exitedReviewMode": case "hookPrompt": case "sleep": content = renderSystemEvent(item, index); break;
                          default: content = renderMessage(item, index);
                        }
                        return <React.Fragment key={item.id || index}>{content}</React.Fragment>;
                      })}

                      {messages.length > 0 && !(isStreaming && turn.id === activeTurnId) && (
                        <div className="turn-action-buttons-row left">
                          <button
                            type="button"
                            className="turn-action-mini-btn"
                            title="复制全部回答 Markdown"
                            onClick={async () => {
                              const ans = messages
                                .map(extractTextFromItem)
                                .join("\n\n");
                              await copyThreadText(ans, "✓ 已复制回答 Markdown 内容");
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
                        <div className="live-running-indicator" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                          <span className="status-spinner-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue, #3b82f6)", display: "inline-block", animation: "pulse 1.2s infinite" }} />
                          <span>
                            {commands.some((c) => c.exitCode === undefined || c.exitCode === null)
                              ? "正在执行命令..."
                              : fileChanges.length > 0
                              ? "正在修改文件..."
                              : meaningfulThoughts.length > 0 || (isStreaming && thoughts.length > 0)
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
                  <PlanPanel steps={planSteps} explanation={planExplanation} defaultCollapsed={false} />
                )}

                {turnDiffFiles.length > 0 && (
                  <TurnDiffPanel
                    files={turnDiffFiles}
                    onOpenFile={(filePath) => {
                      openPreviewFile(filePath);
                    }}
                    onRefresh={refreshGitStatus}
                  />
                )}

                {/* Pending Server Requests: approvals / permissions / user input / option picker */}
                {!showPopoutModal && renderApprovals()}
              </div>
            </div>

            {/* Floating Follow-up Composer */}
            <div className="floating-composer-dock">
              <div className="floating-composer-inner">
              {queueNotice && <div role="alert">{queueNotice}</div>}
              {followupQueue[0] && steeredQueueItemsRef.current.has(`${activeThreadId}:${followupQueue[0].id}`) && (
                <div role="alert">{steeredQueueItemsRef.current.get(`${activeThreadId}:${followupQueue[0].id}`) === "accepted"
                  ? "此消息已发送，原队列清理未完成。请点击取消重试清理，勿重复发送。"
                  : "此消息的引导结果未确认，已暂停重复发送。请核对运行结果，或取消原队列。"}</div>
              )}
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
                      disabled={queueBusy || steeredQueueItemsRef.current.has(`${activeThreadId}:${followupQueue[0].id}`)}
                      onClick={() => handleStartServerQueue()}
                    >
                      立即发送
                    </button>
                    <button
                      type="button"
                      className="mini-link-btn"
                      disabled={queueBusy || !isStreaming || steeredQueueItemsRef.current.has(`${activeThreadId}:${followupQueue[0].id}`)}
                      onClick={() => handleSteerTurn(followupQueue[0].text, followupQueue[0])}
                    >
                      引导到当前轮 (Steer)
                    </button>
                    <button
                      type="button"
                      className="mini-link-btn danger"
                      disabled={queueBusy}
                      onClick={() => handleCancelQueuedFollowup(followupQueue[0])}
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

                {!showPopoutModal && renderThreadComposer()}
              </div>
            </div>
          </>
        )}

        {/* Bottom Interactive PTY Terminal Dock */}
        {!isCloudChatRoute && terminalWasOpened.current && (
          <TerminalDock
            open={showTerminal}
            cwd={terminalTargetCwd ?? activeWorkspace?.path ?? ""}
            onClose={() => setShowTerminal(false)}
            pendingCommand={pendingTermCommand}
            pendingAction={environmentActionWaiter.current?.scope === environmentActionScope ? pendingEnvironmentAction : null}
            onActionResult={handleEnvironmentActionResult}
            onCommandHandled={handleTerminalCommandHandled}
          />
        )}
      </main>

      {showThreadSchedule && threadScheduleTask && <div className="automation-thread-outlet">
        <AutomationsView key={threadScheduleTask.id} activeWorkspaceRoot={activeWorkspace?.path || ""} models={models}
          onSelectThread={selectThread} onNavigationGuardChange={setPersonalizationNavigationGuard}
          threadTask={{ ...threadScheduleTask, onClose: () => {
            setThreadScheduleTask(null);
            threadScheduleTrigger.current?.focus({ preventScroll: true });
          } }} />
      </div>}
      {/* ── 4. Right-Hand Diff & File Review Workbench ── */}
      <DiffDrawer
        workspaceRoots={workbenchWorkspaceRoots}
        connectionIdentity={JSON.stringify([modelAccountIdentity, appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent])}
        open={showRightDrawer && !isCloudChatRoute && !showThreadSchedule}
        shortcutRequest={workbenchShortcutRequest ?? undefined}
        onShortcutHandled={requestId => setWorkbenchShortcutRequest(current => current?.requestId === requestId ? null : current)}
        gitPreferences={gitPreferencesState.preferences}
        gitPreferencesReady={gitPreferencesState.ready}
        recordedTurnDiff={turnDiffFiles.map(file => file.diff).join("\n\n")}
        cwd={activeWorkspace?.path || ""}
        gitStatus={gitContextCwd === activeWorkspace?.path ? gitStatus : null}
        branches={gitContextCwd === activeWorkspace?.path ? gitBranches : []}
        turns={turns}
        onRefreshGit={refreshGitStatus}
        onClose={() => setShowRightDrawer(false)}
        selectedPreviewFile={selectedPreviewFile}
        previewRequestId={previewRequestId}
        previewLine={previewLine}
        directoryReveal={directoryReveal}
        onFilePreviewHandlerChange={registerSkillFilePreviewHandler}
        onFileAccess={rememberWorkspaceFile}
        onSelectPreviewFile={setSelectedPreviewFile}
        onSendReviewComment={(comment) => handleSendMessage(comment)}
        reviewTarget={reviewDiffTarget}
        modelReviewComments={reviewFindings.comments}
        selectedReviewFinding={reviewFindings.comments.find(comment => comment.id === selectedReviewFinding?.id) ?? null}
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
      {showKeyboardShortcuts && (
        <KeyboardShortcutsDialog
          bindings={keyboardState.bindings}
          primaryNumberShortcutTarget={keyboardState.primaryNumberShortcutTarget}
          hasWorkbench={showRightDrawer}
          onClose={() => setShowKeyboardShortcuts(false)}
          hasActiveThread={activeThreadObj !== null}
          hasWorkspace={activeWorkspace?.path != null}
        />
      )}
      {showPopoutModal && (
        <div className="hotkey-modal-overlay" onClick={() => { setShowPopoutModal(false); setComposerFocusRequest((request) => request + 1); }}>
          <div className="hotkey-modal-box" onClick={(e) => e.stopPropagation()}>
            <HotkeyWindow
              threadId={activeThreadId}
              turns={turns}
              isStreaming={isStreaming}
              loading={loadingThread}
              error={historyError}
              composer={renderThreadComposer()}
              approvals={renderApprovals()}
              onNewChat={() => { void startNewThread(); }}
              onClose={() => { setShowPopoutModal(false); setComposerFocusRequest((request) => request + 1); }}
              onOpenMainApp={() => {
                setShowPopoutModal(false);
                setActiveRoute(activeThreadId ? "thread" : "home");
                setComposerFocusRequest((request) => request + 1);
              }}
            />
          </div>
        </div>
      )}

      {/* ── 6. Floating Mini Virtual Pet Companion Widget ── */}
      <MiniPetWidget
        visible={petVisible && petPreferencesState.ready}
        species={petPreferencesState.preferences.selectedAvatarId ?? "codex"}
        size={petPreferencesState.preferences.petSize}
        visibility={petPreferencesState.preferences.petVisibility}
        isStreaming={isStreaming}
        installedPets={petPreferencesState.pets}
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
        mode={quickSearchMode}
        initialQuery={quickSearchInitialQuery}
        threads={threads}
        skills={skills}
        projectScripts={projectScripts}
        workspacePath={activeWorkspace?.path}
        workspaceRoots={workbenchWorkspaceRoots}
        workspaceLabel={searchScopeProjects?.length === 1 ? searchScopeProjects[0].name : undefined}
        recentFiles={workbenchWorkspaceRoots.flatMap(root => recentFilesByWorkspace[fileDedupeKey(root)] ?? [])}
        onClose={() => setShowQuickSearch(false)}
        onSelectThread={selectThread}
        onSearchFiles={() => setQuickSearchMode("files")}
        onSelectFile={(filePath, isDirectory, chosenRoot) => {
          const cwd = activeWorkspace?.path || "";
          if (chosenRoot && !fileSearchRoot(filePath, [chosenRoot])) return;
          if (isDirectory) {
            const root = chosenRoot ?? fileSearchRoot(filePath, workbenchWorkspaceRoots);
            if (!root) return;
            setDirectoryReveal({ cwd, root, path: filePath });
            setShowRightDrawer(true);
          } else {
            explicitFileScopeRef.current = chosenRoot ? { cwd, path: filePath, root: chosenRoot } : null;
            openPreviewFile(filePath);
          }
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
        onSelectSlashCommand={(command) => {
          if (command.action) handleSlashAction(command.action);
          if (command.insertText) setPromptInput(command.insertText);
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
      {shareThreadId && <ShareThreadDialog
        key={shareThreadId}
        threadId={shareThreadId}
        title={threads.find(thread => thread.id === shareThreadId)?.name ?? undefined}
        onClose={() => setShareThreadId(null)}
      />}
      {appToast && (
        <div className={`app-global-toast ${appToast.type || "info"}`}>
          <span>{appToast.message}</span>
          {appToast.action && <button type="button" onClick={appToast.action.onClick}>{appToast.action.label}</button>}
        </div>
      )}
    </div>
    </>
  );
};
