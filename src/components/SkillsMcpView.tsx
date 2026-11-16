import React, { useEffect, useRef, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import {
  AlertCircle,
  AlertTriangle,
  AppWindow,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Info,
  Loader2,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Save,
  ShoppingBag,
  Sparkles,
  Trash2,
  WifiOff,
} from "lucide-react";
import { callAppServer, tauriInvoke, tauriListen } from "../bridge";
import { readFileText } from "../fsClient";
import { experimentalFeatureListAll } from "../config";
import { readMcpSettings } from "../mcpSettings";
import { McpSettings } from "./McpSettings";
import { managementTabs, managementFallback, useMarketplaceRemoval } from "../pluginManagementState";
import { readConfiguredMarketplaces, setPluginEnabled, verifyPluginEnabled, type ConfiguredMarketplace } from "../pluginManagement";
import { loadRemotePlugins, manageRemotePlugin, verifyRemotePlugin, mergePluginInventories, type RemotePluginSnapshot } from "../remotePlugins";
import { loadPluginDirectorySource, loadPluginDirectoryCategory, readLocalDirectoryListing, type PluginDirectorySource } from "../pluginDirectoryClient";
import { directoryPluginInstallation, pluginDetailMatchesReference, type PluginDirectoryListing } from "../pluginDirectory";
import { usePluginDirectorySearch } from "../pluginDirectorySearch";
import { parsePluginDirectoryLocation, pluginDirectoryBrowseUrl, pluginDirectoryDetailUrl, pluginDirectoryTabUrl, pluginDirectoryCategoryUrl } from "../pluginDirectoryLocation";
import { groupPluginDirectoryLocal, type PluginDirectoryLocalGroups } from "../pluginDirectoryLocalGroups";
import type { ServiceIdentity } from "../chatgptService";
import {
  SkillInfoItem,
} from "../types";
import "./PluginsMarket.css";
import { PluginPreparationPanel } from "./PluginPreparationPanel";
import { RecommendedSkillsPanel } from "./RecommendedSkillsPanel";
import { recommendedSkillDisplayName, readRecommendedSkills, type RecommendedSkill } from "../recommendedSkills";
import { filterManagedSkills } from "../pluginManagementSkills";
import { parsePluginManagementLocation, pluginManagementDetailUrl, pluginManagementRootUrl } from "../pluginManagementLocation";
import { SkillPreviewDialog } from "./SkillPreviewDialog";
import { PluginDirectoryDetail } from "./PluginDirectoryDetail";
import { PluginDirectoryIncluded } from "./PluginDirectoryIncluded";
import { PluginLogo } from "./PluginLogo";
import { PluginInstalledStrip } from "./PluginInstalledStrip";
import { PluginDirectoryOriginsView, type PluginDirectoryTab } from "./PluginDirectoryOriginsView";
import { PluginManagementToolbar } from "./PluginManagementToolbar";
import { PluginManagementDetail } from "./PluginManagementDetail";
import { PluginManagementActions } from "./PluginManagementActions";
import { AddPluginMarketplaceDialog, type AddPluginMarketplaceInput } from "./AddPluginMarketplaceDialog";
import {
  AppInfo,
  InstalledApp,
  MarketplaceUpgradeResponse,
  PluginDetail,
  PluginErrorKind,
  PluginInstalledResponse,
  PluginListResponse,
  PluginInstallResponse,
  PluginProtocolError,
  PluginMarketplaceEntry,
  PluginSummary,
  SkillMetadata,
  addMarketplace,
  classifyAppServerError,
  countMarketplacePlugins,
  errorDetail,
  errorSummary,
  flattenSkills,
  installPlugin,
  listApps,
  listInstalledApps,
  listInstalledPlugins,
  listMarketplacePlugins,
  listSkills,
  marketplaceDisplayName,
  marketplaceSourceLabel,
  pluginCategory,
  pluginDescription,
  pluginDeveloper,
  pluginDisplayName,
  pluginRefFor,
  pluginSourceLabel,
  readPlugin,
  setSkillEnabled as writeSkillEnabled,
  uninstallPlugin,
  upgradeMarketplace,
} from "../plugins";

export interface PluginDirectoryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

interface SkillsMcpViewProps {
  activeWorkspaceRoot: string;
  initialTab?: SubTab;
  initialPluginMode?: "installed" | "browse";
  manageOnly?: boolean;
  connectionIdentity?: string;
  onConfigUpdated?: () => void | Promise<void>;
  onRestartAppServer?: () => void | Promise<unknown>;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
  onNotify?: (message: string, type?: "success" | "error") => void;
  onBrowseDirectory?: (tab: "plugins" | "skills", marketplaceName?: string) => void;
  onManagePlugins?: () => void;
  onNavigationChange?: (navigation: PluginDirectoryNavigation | null) => void;
  onStartSkillCreatorSession?: (prompt: string) => void;
  onOpenSkillFile?: (path: string) => boolean | Promise<boolean>;
  onTrySkill?: (skill: { name: string; path: string; defaultPrompt?: string | null }) => boolean | Promise<boolean>;
  onTryPlugin?: (plugin: PluginSummary, prompt: string) => boolean | Promise<boolean>;
  onOpenPluginDirectoryDetail?: (detail: PluginDetail) => void;
  onOpenPluginSettings?: (section: "connections" | "hooks-settings") => void;
}

type SubTab = "plugins" | "skills" | "mcp" | "apps" | "marketplaces";
type RemoteOperation = "enable" | "disable" | "uninstall";
interface RemoteIntent {
  plugin: PluginSummary; operation: RemoteOperation; identity: ServiceIdentity;
  pending: boolean; busy: boolean; error: string | null; refreshError: string | null;
}
const remoteIntents = new Map<string, RemoteIntent>();
const uninstallUncertainties = new Map<string, Set<string>>();
const remoteIntentListeners = new Set<(intent: RemoteIntent) => void>();
const saveRemoteIntent = (key: string, intent: RemoteIntent) => { remoteIntents.set(key, intent); remoteIntentListeners.forEach(listener => listener(intent)); };
const remoteId = (plugin: PluginSummary) => plugin.remotePluginId ?? (plugin.shareContext && typeof plugin.shareContext === "object" && "remotePluginId" in plugin.shareContext && typeof plugin.shareContext.remotePluginId === "string" ? plugin.shareContext.remotePluginId : null);
const remoteIntentKey = (identity: ServiceIdentity, plugin: PluginSummary) => JSON.stringify([identity.accountId, identity.userId, remoteId(plugin)]);
const isServicePlugin = (plugin: PluginSummary) => !!plugin.remoteServicePlugin;
const pluginActionKey = (plugin: PluginSummary) => isServicePlugin(plugin) ? `remote:${remoteId(plugin) ?? plugin.id}` : plugin.id;

interface ViewError {
  kind: PluginErrorKind;
  message: string;
}

interface SkillRow {
  key: string;
  name: string;
  description: string;
  scope: string;
  enabled?: boolean;
  pluginId?: string | null;
  local: SkillInfoItem | null;
  remote: SkillMetadata | null;
}

function toViewError(err: unknown): ViewError {
  return { kind: classifyAppServerError(err), message: errorDetail(err) };
}

function normalizePathKey(path: string | null | undefined): string {
  return (path ?? "").replace(/\//g, "\\").toLowerCase();
}

function buildSkillRows(
  localSkills: SkillInfoItem[],
  remoteSkills: SkillMetadata[] | null
): SkillRow[] {
  const rows: SkillRow[] = [];
  const usedLocalPaths = new Set<string>();

  if (remoteSkills && remoteSkills.length > 0) {
    const localByPath = new Map<string, SkillInfoItem>();
    for (const local of localSkills) {
      localByPath.set(normalizePathKey(local.path), local);
    }
    for (const remote of remoteSkills) {
      const match = remote.pluginId ? null : localByPath.get(normalizePathKey(remote.path)) ?? null;
      if (match) usedLocalPaths.add(match.path);
      rows.push({
        key: remote.path || remote.name,
        name: remote.interface?.displayName?.trim() || recommendedSkillDisplayName(remote.name),
        description: remote.description,
        scope: remote.scope,
        enabled: remote.enabled,
        pluginId: remote.pluginId ?? null,
        local: match,
        remote,
      });
    }
  }

  for (const local of localSkills) {
    if (usedLocalPaths.has(local.path)) continue;
    rows.push({
      key: local.path,
      name: local.name,
      description: local.description,
      scope: local.installed ? "local" : "seed",
      enabled: undefined,
      pluginId: null,
      local,
      remote: null,
    });
  }

  return rows;
}

function skillScopeLabel(scope: string): string {
  switch (scope) {
    case "user":
      return "用户";
    case "repo":
      return "仓库";
    case "system":
      return "系统";
    case "admin":
      return "管理员";
    case "local":
      return "本地";
    case "seed":
      return "离线种子";
    default:
      return scope;
  }
}

function pluginKey(
  plugin: PluginSummary,
  marketplace: PluginMarketplaceEntry
): string {
  return `${marketplace.name}::${pluginActionKey(plugin)}`;
}

export const SkillsMcpView: React.FC<SkillsMcpViewProps> = ({
  activeWorkspaceRoot,
  initialTab,
  initialPluginMode = "installed",
  manageOnly = false,
  connectionIdentity = "local",
  onConfigUpdated,
  onRestartAppServer,
  onNavigationGuardChange,
  onBrowseDirectory,
  onNotify,
  onManagePlugins,
  onNavigationChange,
  onStartSkillCreatorSession,
  onOpenSkillFile,
  onTrySkill,
  onTryPlugin,
  onOpenPluginSettings,
  onOpenPluginDirectoryDetail,
}) => {
  const [subTab, setSubTab] = useState<SubTab>(() => manageOnly && window.location && parsePluginManagementLocation(window.location.href)?.requestedTab === "mcps" ? "mcp" : initialTab || "plugins");

  useEffect(() => {
    if (initialTab) {
      setSubTab(initialTab);
    }
  }, [initialTab]);
  const [searchQuery, setSearchQuery] = useState(() => !manageOnly && window.location ? parsePluginDirectoryLocation(window.location.href)?.search ?? "" : "");
  const unsupportedDirectoryHost = () => manageOnly
    ? ((window.location && parsePluginManagementLocation(window.location.href)?.hostId) ?? "local") !== "local"
    : !!(window.location && parsePluginDirectoryLocation(window.location.href)?.hostId?.trim() &&
      parsePluginDirectoryLocation(window.location.href)?.hostId !== "local");
  const [directoryHostUnsupported, setDirectoryHostUnsupported] = useState(unsupportedDirectoryHost);
  const managementHostId = manageOnly && window.location ? parsePluginManagementLocation(window.location.href)?.hostId ?? "local" : "local";
  const [directoryCategory, setDirectoryCategory] = useState<string | null>(() => !manageOnly && window.location ? parsePluginDirectoryLocation(window.location.href)?.category ?? null : null);
  const readDirectoryTab = (): PluginDirectoryTab => {
    const tab = window.location && parsePluginDirectoryLocation(window.location.href)?.directoryTab;
    return tab === "workspace" || tab === "personal" || tab === "teams" ? tab : "openai";
  };
  const [directoryTab, setDirectoryTab] = useState<PluginDirectoryTab>(readDirectoryTab);
  const [directoryRefreshRevision, setDirectoryRefreshRevision] = useState(0);
  const [localDirectoryRevision, setLocalDirectoryRevision] = useState(0);
  const [localDirectoryGroups, setLocalDirectoryGroups] = useState<PluginDirectoryLocalGroups | null>(null);
  const [localDirectoryLoading, setLocalDirectoryLoading] = useState(false);
  const [localDirectoryError, setLocalDirectoryError] = useState<string | null>(null);
  const [directorySource, setDirectorySource] = useState<PluginDirectorySource | null>(null);
  const directoryRead = useRef<AbortController | null>(null);
  const [categoryRows, setCategoryRows] = useState<PluginDirectoryListing[]>([]);
  const [categoryCursor, setCategoryCursor] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const categoryRead = useRef<AbortController | null>(null);
  const categoryPaging = useRef(false);
  const categoryConsumed = useRef(new Set<string>());
  const [directoryResolving, setDirectoryResolving] = useState<Set<string>>(new Set());
  const directoryResolveLocks = useRef(new Set<string>());
  const directoryActive = useRef(false); directoryActive.current = !manageOnly && subTab === "plugins";
  const directorySearch = usePluginDirectorySearch({ query: searchQuery, cwds: activeWorkspaceRoot ? [activeWorkspaceRoot] : undefined,
    identity: connectionIdentity ?? "", enabled: !manageOnly && subTab === "plugins" && !directoryCategory && !directoryHostUnsupported });
  const directoryHistory = useRef({ session: `${Date.now()}:${Math.random()}`, index: 0, maximum: 0 });
  const historyMarker = manageOnly ? "pluginManagementNavigation" : "pluginDirectoryNavigation";
  const [directoryHistoryPosition, setDirectoryHistoryPosition] = useState({ index: 0, maximum: 0 });
  const updateDirectoryUrl = (url: string, replace = false) => {
    if (!window.history) return;
    const navigation = directoryHistory.current;
    if (!replace) { navigation.index++; navigation.maximum = navigation.index; }
    const state = { ...window.history.state, [historyMarker]: { session: navigation.session, index: navigation.index } };
    if (replace) window.history.replaceState(state, "", url); else window.history.pushState(state, "", url);
    setDirectoryHistoryPosition({ index: navigation.index, maximum: navigation.maximum });
  };
  useEffect(() => {
    if (!window.history || !window.location) return;
    const navigation = directoryHistory.current;
    window.history.replaceState({ ...window.history.state, [historyMarker]: { session: navigation.session, index: 0 } }, "", window.location.href);
    const sync = () => {
      const marker = window.history.state?.[historyMarker];
      if (marker?.session !== navigation.session) return;
      navigation.index = marker.index;
      setDirectoryHistoryPosition({ index: navigation.index, maximum: navigation.maximum });
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [manageOnly]);
  useEffect(() => {
    if (!manageOnly && subTab !== "plugins") { onNavigationChange?.(null); return; }
    onNavigationChange?.({ canGoBack: directoryHistoryPosition.index > 0,
      canGoForward: directoryHistoryPosition.index < directoryHistoryPosition.maximum,
      goBack: () => window.history?.back(), goForward: () => window.history?.forward() });
    return () => onNavigationChange?.(null);
  }, [manageOnly, subTab, directoryHistoryPosition.index, directoryHistoryPosition.maximum, onNavigationChange]);
  const directoryBase = () => window.location && parsePluginDirectoryLocation(window.location.href) ? window.location.href : "/plugins";
  const managementBase = () => window.location && parsePluginManagementLocation(window.location.href) ? window.location.href : "/settings/plugins-settings";
  const closeManagedDetail = (replace = false) => {
    ++detailRequestRef.current; detailContextRef.current = null;
    setDetailKey(null); setDetail(null); setDetailError(null); setDetailLoading(false);
    updateDirectoryUrl(pluginManagementRootUrl(managementBase(), replace ? {} : { hostId: null }), replace);
  };
  const [skillSearchIndex, setSkillSearchIndex] = useState(0);
  const [recommendedSearch, setRecommendedSearch] = useState<{ query: string; count: number | null }>({ query: "", count: null });
  const pageRef = useRef<HTMLDivElement>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<SkillInfoItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfoItem | null>(null);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [readOnlyRemoteSkill, setReadOnlyRemoteSkill] =
    useState<SkillMetadata | null>(null);
  const [newSkillId, setNewSkillId] = useState<string>("");
  const [skillContent, setSkillContent] = useState<string>("");
  const [skillContentError, setSkillContentError] = useState<string | null>(null);
  const [skillContentLoading, setSkillContentLoading] = useState(false);
  const [localSkillsError, setLocalSkillsError] = useState<string | null>(null);
  const skillSelectionRequestRef = useRef(0);
  const skillSelectionRef = useRef<SkillRow | null>(null);
  const skillEditorRevisionRef = useRef(0);
  const remoteSkillsRequestRef = useRef(0);
  const localSkillsRequestRef = useRef(0);
  const skillWritePendingRef = useRef(false);
  const [skillWriteBusy, setSkillWriteBusy] = useState(false);
  const [recommendedInstalledKeys, setRecommendedInstalledKeys] = useState<string[]>([]);
  const [managementRecommended, setManagementRecommended] = useState<RecommendedSkill[] | null>(null);
  const [managementRecommendedError, setManagementRecommendedError] = useState<string | null>(null);
  const managementRecommendedRequest = useRef(0);
  const [skillPreview, setSkillPreview] = useState<{ row: SkillRow; identity: string } | null>(null);
  const skillPreviewSequence = useRef(0);

  const [mcpCount, setMcpCount] = useState(0);
  const [configuredMarkets, setConfiguredMarkets] = useState<ConfiguredMarketplace[]>([]);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [managementLoading, setManagementLoading] = useState(true);
  const [showNonMcpTabs, setShowNonMcpTabs] = useState(true);
  const managementRequest = useRef(0), appsRequest = useRef(0);
  const [pluginUpdates, setPluginUpdates] = useState<Record<string, { pending: boolean; enabled: boolean; configFilePath: string | null; error: string | null; refreshError: string | null }>>({});
  const mcpNavigationGuard = useRef<((action: () => void) => boolean) | null>(null);
  const removalDialog = useRef<HTMLDialogElement>(null);
  const removalTrigger = useRef<HTMLButtonElement | null>(null);

  // Toast
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Plugins tab
  const [installedData, setInstalledData] =
    useState<PluginInstalledResponse | null>(null);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [installedError, setInstalledError] = useState<ViewError | null>(null);
  const [servicePlugins, setServicePlugins] = useState<RemotePluginSnapshot | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false), [serviceError, setServiceError] = useState<string | null>(null);
  const [remoteOperations, setRemoteOperations] = useState<Record<string, RemoteIntent>>({});
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null);
  const serviceRequest = useRef(0), serviceRead = useRef<AbortController | null>(null);
  const remoteWrites = useRef(new Set<AbortController>());
  const [pluginMode, setPluginMode] = useState<"installed" | "browse">(
    manageOnly ? "installed" : initialPluginMode
  );
  const [browseData, setBrowseData] = useState<PluginListResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<ViewError | null>(null);
  const [browseVisibleCount, setBrowseVisibleCount] = useState(50);
  const browseLoadedRef = useRef(false);
  const browseLoadingRef = useRef(false);
  const installedLoadingRef = useRef(false);
  const remoteSkillsLoadingRef = useRef(false);
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(new Set());
  const pluginActionRef = useRef(new Set<string>());
  const pluginContextRef = useRef(0);
  const pluginMountedRef = useRef(true);
  const [pluginPreparations, setPluginPreparations] = useState<Record<string, { name: string; result: PluginInstallResponse; attempt: number }>>({});
  const preparationAttemptRef = useRef(0);
  const [unconfirmedInstalls, setUnconfirmedInstalls] = useState<Set<string>>(new Set());
  const installScope = JSON.stringify([connectionIdentity, activeWorkspaceRoot, manageOnly ? managementHostId : null]);
  const installUncertaintyRef = useRef(new Map<string, Set<string>>());
  const uninstallUncertaintyRef = useRef(uninstallUncertainties);
  const [unconfirmedUninstalls, setUnconfirmedUninstalls] = useState<Set<string>>(new Set());
  const installedRequestRef = useRef(0);
  const browseRequestRef = useRef(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ViewError | null>(null);
  const detailRequestRef = useRef(0);
  const directoryDetailRetry = useRef<(() => void) | null>(null);
  const detailContextRef = useRef<{
    plugin: PluginSummary;
    marketplace: PluginMarketplaceEntry;
  } | null>(null);

  // Marketplaces tab
  const [marketplaceBusy, setMarketplaceBusy] = useState<string | null>(null);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [mcpCreateRequest, setMcpCreateRequest] = useState(0);
  const [marketplaceActionError, setMarketplaceActionError] = useState<
    string | null
  >(null);
  const [upgradeReport, setUpgradeReport] =
    useState<MarketplaceUpgradeResponse | null>(null);

  // Apps tab
  const [appsData, setAppsData] = useState<AppInfo[] | null>(null);
  const [appsInstalled, setAppsInstalled] = useState<InstalledApp[] | null>(null);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<ViewError | null>(null);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const appsLoadedRef = useRef(false);
  const appsLoadingRef = useRef(false);

  // Skills tab (app-server source)
  const [remoteSkills, setRemoteSkills] = useState<SkillMetadata[] | null>(null);
  const [remoteSkillsLoading, setRemoteSkillsLoading] = useState(false);
  const [remoteSkillsError, setRemoteSkillsError] = useState<ViewError | null>(
    null
  );
  const [skillToggleBusy, setSkillToggleBusy] = useState<string | null>(null);

  const notify = (msg: string, kind: "success" | "error" = "success") => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ kind, text: msg });
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      kind === "error" ? 5200 : 3200
    );
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const workspaceCwds = (): string[] | undefined =>
    activeWorkspaceRoot ? [activeWorkspaceRoot] : undefined;
  const isPluginContextCurrent = (context: number) =>
    pluginMountedRef.current && context === pluginContextRef.current && !unsupportedDirectoryHost();
  const updateInstallUncertainty = (scope: string, id: string, pending: boolean, context: number) => {
    const ids = new Set(installUncertaintyRef.current.get(scope));
    if (pending) ids.add(id); else ids.delete(id);
    installUncertaintyRef.current.set(scope, ids);
    if (isPluginContextCurrent(context)) setUnconfirmedInstalls(ids);
  };

  useEffect(() => {
    pluginMountedRef.current = true;
    ++pluginContextRef.current;
    ++installedRequestRef.current;
    ++browseRequestRef.current;
    ++detailRequestRef.current;
    installedLoadingRef.current = false;
    browseLoadingRef.current = false;
    browseLoadedRef.current = false;
    detailContextRef.current = null;
    setInstalledData(null);
    setInstalledError(null);
    setInstalledLoading(false);
    setToast(null); if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    serviceRead.current?.abort(); remoteWrites.current.forEach(controller => controller.abort());
    serviceRequest.current++; setServicePlugins(null); setServiceLoading(false); setServiceError(null); setRemoteOperations({}); setRuntimeWarning(null);
    setMarketplaceBusy(null); setShowAddMarketplace(false); setMarketplaceActionError(null); setUpgradeReport(null);
    setConfiguredMarkets([]); setManagementError(null); setManagementLoading(true); setPluginUpdates({});
    appsLoadedRef.current = false; appsLoadingRef.current = false;
    setAppsData(null); setAppsInstalled(null); setAppsLoaded(false); setAppsLoading(false); setAppsError(null);
    directoryRead.current?.abort(); categoryRead.current?.abort(); setDirectorySource(null);
    directoryResolveLocks.current.clear(); setDirectoryResolving(new Set());
    setBrowseData(null);
    setBrowseError(null);
    setBrowseLoading(false);
    setDetailKey(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setPluginPreparations({});
    setUnconfirmedInstalls(new Set(installUncertaintyRef.current.get(installScope)));
    setUnconfirmedUninstalls(new Set(uninstallUncertaintyRef.current.get(installScope)));
    ++skillSelectionRequestRef.current;
    ++remoteSkillsRequestRef.current;
    ++localSkillsRequestRef.current;
    ++skillEditorRevisionRef.current;
    skillSelectionRef.current = null;
    remoteSkillsLoadingRef.current = false;
    setSkills([]);
    setRecommendedInstalledKeys([]);
    setManagementRecommended(null); setManagementRecommendedError(null); ++managementRecommendedRequest.current;
    setRemoteSkills(null);
    setRemoteSkillsError(null);
    setRemoteSkillsLoading(false);
    setLocalSkillsError(null);
    setSelectedSkill(null);
    setSelectedSkillKey(null);
    setCreatingSkill(false);
    setReadOnlyRemoteSkill(null);
    setNewSkillId("");
    setSkillContent("");
    setSkillContentError(null);
    setSkillContentLoading(false);
    setSkillPreview(null);
    return () => {
      serviceRead.current?.abort(); directoryRead.current?.abort(); categoryRead.current?.abort(); remoteWrites.current.forEach(controller => controller.abort());
      pluginMountedRef.current = false;
      ++pluginContextRef.current;
    };
  }, [activeWorkspaceRoot, connectionIdentity, managementHostId]);

  // ───────────────────────────────────────────────────────────────────────────
  // Data loaders
  // ───────────────────────────────────────────────────────────────────────────

  const loadInstalledPlugins = async (options: { silent?: boolean; confirmInstallResult?: boolean } = {}) => {
    if (!pluginMountedRef.current || unsupportedDirectoryHost()) return;
    if (!options.silent && installedLoadingRef.current) return;
    const context = pluginContextRef.current;
    const request = ++installedRequestRef.current;
    const isCurrent = () => isPluginContextCurrent(context) && request === installedRequestRef.current;
    installedLoadingRef.current = true;
    if (!options.silent) setInstalledLoading(true);
    setInstalledError(null);
    try {
      const res = await listInstalledPlugins(workspaceCwds());
      if (isCurrent()) {
        setInstalledData(res);
        if (options.confirmInstallResult && !res.marketplaceLoadErrors?.length) {
          const pending = new Set([...installUncertaintyRef.current.get(installScope) ?? []].filter(id => pluginActionRef.current.has(id)));
          installUncertaintyRef.current.set(installScope, pending);
          setUnconfirmedInstalls(pending);
        }
        return res;
      }
    } catch (err) {
      if (isCurrent()) setInstalledError(toViewError(err));
    } finally {
      if (isCurrent()) {
        installedLoadingRef.current = false;
        setInstalledLoading(false);
      }
    }
  };

  // The server controls catalog availability; render a bounded set of cards.
  const loadServicePlugins = async () => {
    if (unsupportedDirectoryHost()) return;
    const context = pluginContextRef.current, request = ++serviceRequest.current;
    serviceRead.current?.abort();
    const controller = new AbortController(); serviceRead.current = controller;
    setServiceLoading(true); setServiceError(null);
    try {
      const next = await loadRemotePlugins(controller.signal);
      if (!isPluginContextCurrent(context) || request !== serviceRequest.current) return;
      setServiceError(next.error);
      if (!next.error || next.unsupported || next.identity && (servicePlugins?.identity?.accountId !== next.identity.accountId || servicePlugins?.identity?.userId !== next.identity.userId)) setServicePlugins(next);
      if (next.identity) setRemoteOperations(Object.fromEntries([...remoteIntents].filter(([, value]) => value.identity.accountId === next.identity!.accountId && value.identity.userId === next.identity!.userId)));
    } catch (error) {
      if (isPluginContextCurrent(context) && request === serviceRequest.current) setServiceError(String(error));
    } finally {
      if (isPluginContextCurrent(context) && request === serviceRequest.current) setServiceLoading(false);
    }
  };
  useEffect(() => {
    const sync = (intent: RemoteIntent) => {
      const identity = servicePlugins?.identity;
      if (!identity || identity.accountId !== intent.identity.accountId || identity.userId !== intent.identity.userId) return;
      setRemoteOperations(Object.fromEntries([...remoteIntents].filter(([, value]) => value.identity.accountId === identity.accountId && value.identity.userId === identity.userId)));
      if (!intent.busy && !intent.pending) void loadServicePlugins();
    };
    remoteIntentListeners.add(sync);
    return () => { remoteIntentListeners.delete(sync); };
  }, [servicePlugins?.identity?.accountId, servicePlugins?.identity?.userId, connectionIdentity, activeWorkspaceRoot]);
  const loadBrowsePlugins = async (force = false) => {
    if (!pluginMountedRef.current || unsupportedDirectoryHost()) return;
    if (browseLoadedRef.current && !force) return;
    if (browseLoadingRef.current && !force) return;
    const context = pluginContextRef.current;
    const request = ++browseRequestRef.current;
    const isCurrent = () => isPluginContextCurrent(context) && request === browseRequestRef.current;
    browseLoadingRef.current = true;
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      directoryRead.current?.abort();
      const controller = new AbortController(); directoryRead.current = controller;
      const source = manageOnly ? { kind: "unresolved" as const } : await loadPluginDirectorySource(controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      setDirectorySource(source);
      if (source.kind === "remote" || source.kind === "requires-chatgpt") {
        setBrowseData(null);
      } else {
        // Unresolved legacy hosts retain their server directory without labeling it public.
        const res = await listMarketplacePlugins(workspaceCwds(), force, source.kind === "local" ? ["local"] : undefined);
        if (!isCurrent() || controller.signal.aborted) return;
        setBrowseData(res);
      }
      setBrowseVisibleCount(50);
      browseLoadedRef.current = true;
    } catch (err) {
      if (isCurrent()) setBrowseError(toViewError(err));
    } finally {
      if (isCurrent()) {
        browseLoadingRef.current = false;
        setBrowseLoading(false);
      }
    }
  };

  const [searchFallback, setSearchFallback] = useState<PluginListResponse | null>(null);
  useEffect(() => {
    setLocalDirectoryGroups(null); setLocalDirectoryError(null);
    if (manageOnly || subTab !== "plugins" || directoryHostUnsupported || searchQuery.trim()) { setLocalDirectoryLoading(false); return; }
    let live = true;
    const context = pluginContextRef.current;
    setLocalDirectoryLoading(true);
    void Promise.all([homeDir(), listMarketplacePlugins(workspaceCwds(), false, ["local"])]).then(([home, result]) => {
      if (!live || !isPluginContextCurrent(context)) return;
      if (result.marketplaceLoadErrors?.length) throw new Error(result.marketplaceLoadErrors.map(error => error.message).join("\n"));
      setLocalDirectoryGroups(groupPluginDirectoryLocal(result.marketplaces, home));
    }).catch(error => { if (live && isPluginContextCurrent(context)) setLocalDirectoryError(errorSummary(error)); })
      .finally(() => { if (live && isPluginContextCurrent(context)) setLocalDirectoryLoading(false); });
    return () => { live = false; };
  }, [manageOnly, subTab, directoryHostUnsupported, activeWorkspaceRoot, connectionIdentity, directorySource, localDirectoryRevision, !!searchQuery.trim()]);
  const [searchFallbackError, setSearchFallbackError] = useState<string | null>(null);
  useEffect(() => {
    setSearchFallback(null); setSearchFallbackError(null);
    if (!directorySearch.unsupported || !searchQuery.trim() || manageOnly) return;
    let live = true;
    const context = pluginContextRef.current;
    void listMarketplacePlugins(workspaceCwds(), false, ["local"]).then(result => {
      if (live && isPluginContextCurrent(context)) setSearchFallback(result);
    }).catch(error => { if (live && isPluginContextCurrent(context)) setSearchFallbackError(errorSummary(error)); });
    return () => { live = false; };
  }, [directorySearch.unsupported, searchQuery, activeWorkspaceRoot, connectionIdentity, manageOnly]);

  const loadRemoteSkills = async (forceReload = false) => {
    if (!pluginMountedRef.current || unsupportedDirectoryHost()) return;
    if (remoteSkillsLoadingRef.current && !forceReload) return;
    const context = pluginContextRef.current;
    const request = ++remoteSkillsRequestRef.current;
    const isCurrent = () => isPluginContextCurrent(context) && request === remoteSkillsRequestRef.current;
    remoteSkillsLoadingRef.current = true;
    setRemoteSkillsLoading(true);
    setRemoteSkillsError(null);
    try {
      const res = await listSkills(workspaceCwds(), forceReload);
      if (isCurrent()) setRemoteSkills(flattenSkills(res).skills);
      return null;
    } catch (err) {
      if (isCurrent()) {
        setRemoteSkillsError(toViewError(err));
        return errorSummary(err);
      }
    } finally {
      if (isCurrent()) {
        remoteSkillsLoadingRef.current = false;
        setRemoteSkillsLoading(false);
      }
    }
  };

  const loadApps = async (force = false) => {
    if (unsupportedDirectoryHost()) return;
    if (appsLoadingRef.current && !force) return;
    const context = pluginContextRef.current;
    const request = ++appsRequest.current;
    const isCurrent = () => isPluginContextCurrent(context) && appsRequest.current === request;
    appsLoadingRef.current = true;
    setAppsLoading(true);
    setAppsError(null);
    try {
      const res = await listApps({ forceRefetch: force });
      if (!isCurrent()) return;
      setAppsData(res.data);
      setAppsInstalled(null);
      appsLoadedRef.current = true;
      setAppsLoaded(true);
    } catch (err) {
      if (!isCurrent()) return;
      setAppsError(toViewError(err));
      // Graceful fallback: local committed connector runtime snapshot.
      try {
        const installed = await listInstalledApps();
        if (!isCurrent()) return;
        setAppsInstalled(installed);
      } catch {
        if (!isCurrent()) return;
        setAppsInstalled(null);
      }
      appsLoadedRef.current = true;
      setAppsLoaded(true);
    } finally {
      if (isCurrent()) { appsLoadingRef.current = false; setAppsLoading(false); }
    }
  };
  useEffect(() => {
    if (!manageOnly && detail?.apps.length) void loadApps();
  }, [detail?.summary.id, activeWorkspaceRoot, connectionIdentity, manageOnly]);

  const loadManagement = async () => {
    if (unsupportedDirectoryHost()) return;
    const context = pluginContextRef.current, request = ++managementRequest.current;
    setManagementLoading(true); setManagementError(null);
    const results = await Promise.allSettled([
      readConfiguredMarketplaces(workspaceCwds()),
      readMcpSettings(activeWorkspaceRoot || undefined), experimentalFeatureListAll(),
    ]);
    if (!isPluginContextCurrent(context) || request !== managementRequest.current) return;
    const [markets, mcp, features] = results;
    if (markets.status === "fulfilled") setConfiguredMarkets(markets.value);
    if (mcp.status === "fulfilled") setMcpCount(mcp.value.entries.length);
    if (features.status === "fulfilled") setShowNonMcpTabs(features.value.find(item => item.name === "plugins")?.enabled ?? true);
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) setManagementError(failures.map(result => String((result as PromiseRejectedResult).reason)).join("；"));
    setManagementLoading(false);
    return failures.length === 0;
  };

  const loadManagementRecommended = async () => {
    if (!manageOnly || unsupportedDirectoryHost()) return;
    const context = pluginContextRef.current, request = ++managementRecommendedRequest.current;
    setManagementRecommended(null); setManagementRecommendedError(null);
    try {
      const result = await readRecommendedSkills(false);
      if (!isPluginContextCurrent(context) || request !== managementRecommendedRequest.current) return;
      if (result.error) throw new Error(result.error);
      setManagementRecommended(result.skills);
    } catch (error) {
      if (isPluginContextCurrent(context) && request === managementRecommendedRequest.current) setManagementRecommendedError(errorSummary(error));
    }
  };

  const loadLocalSkills = async () => {
    if (unsupportedDirectoryHost()) return;
    const context = pluginContextRef.current;
    const request = ++localSkillsRequestRef.current;
    try {
      const localSkills = await tauriInvoke<SkillInfoItem[]>(
        "skills_list_local",
        { workspaceRoot: activeWorkspaceRoot }
      );
      if (isPluginContextCurrent(context) && request === localSkillsRequestRef.current) {
        setSkills(localSkills);
        setLocalSkillsError(null);
      }
      return null;
    } catch (error) {
      if (isPluginContextCurrent(context) && request === localSkillsRequestRef.current) {
        setLocalSkillsError(errorSummary(error));
        return errorSummary(error);
      }
    }
  };

  const refreshRecommendedSkills = async () => {
    const context = pluginContextRef.current;
    const errors = await Promise.all([loadLocalSkills(), loadRemoteSkills(true)]);
    if (isPluginContextCurrent(context) && errors.some(Boolean)) throw new Error(errors.filter(Boolean).join("；"));
  };

  const refreshAll = async (options: { confirmInstallResult?: boolean } = {}) => {
    if (unsupportedDirectoryHost()) return;
    if (!manageOnly && subTab === "plugins") setDirectoryRefreshRevision(value => value + 1);
    if (!manageOnly && subTab === "plugins" && searchQuery.trim() && !directoryCategory) directorySearch.retry();
    const context = pluginContextRef.current;
    const serviceLoad = loadServicePlugins();
    const installedLoad = loadInstalledPlugins({ confirmInstallResult: options.confirmInstallResult !== false });
    await loadLocalSkills();
    if (!isPluginContextCurrent(context)) return;
    await Promise.allSettled([installedLoad, serviceLoad, loadRemoteSkills(), loadManagement(), loadManagementRecommended(),
      !manageOnly && subTab === "plugins" ? loadBrowsePlugins(true) : Promise.resolve()]);
    if (manageOnly || subTab === "apps") {
      await loadApps(true);
    }
  };

  useEffect(() => {
    refreshAll({ confirmInstallResult: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceRoot, connectionIdentity, directoryHostUnsupported]);
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined;
    const refresh = () => {
      if (disposed || unsupportedDirectoryHost()) return;
      void Promise.allSettled([loadInstalledPlugins({ silent: true }), loadServicePlugins(), loadManagement(), loadRemoteSkills(true), loadApps(true)]);
      if (!manageOnly) {
        void loadBrowsePlugins(true);
        const context = detailContextRef.current;
        if (context) void handleToggleDetail(context.plugin, context.marketplace, { reload: true });
      }
    };
    window.addEventListener("focus", refresh);
    void tauriListen("plugin-management-changed", refresh).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; window.removeEventListener("focus", refresh); unlisten?.(); onNavigationGuardChange?.(null); };
  }, [activeWorkspaceRoot, connectionIdentity, manageOnly]);

  useEffect(() => {
    if (unsupportedDirectoryHost()) return;
    if (subTab === "apps" && !appsLoadedRef.current) {
      loadApps();
    }
    if (subTab === "plugins" && (!manageOnly || pluginMode === "browse")) {
      loadBrowsePlugins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, pluginMode, activeWorkspaceRoot, manageOnly]);

  useEffect(() => {
    setBrowseVisibleCount(50);
  }, [searchQuery]);

  // ───────────────────────────────────────────────────────────────────────────
  // Plugin actions
  // ───────────────────────────────────────────────────────────────────────────

  const handleToggleDetail = async (
    plugin: PluginSummary,
    marketplace: PluginMarketplaceEntry,
    options: { reload?: boolean } = {}
  ) => {
    if (unsupportedDirectoryHost()) return;
    const key = pluginKey(plugin, marketplace);
    if (detailKey === key && !options.reload) {
      ++detailRequestRef.current;
      detailContextRef.current = null;
      setDetailKey(null);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    const context = pluginContextRef.current;
    const requestId = ++detailRequestRef.current;
    detailContextRef.current = { plugin, marketplace };
    if (!manageOnly && !options.reload) updateDirectoryUrl(pluginDirectoryDetailUrl(directoryBase(), { pluginId: plugin.id,
      pluginName: marketplace.path ? plugin.name : plugin.remotePluginId ?? plugin.name,
      marketplacePath: marketplace.path, remoteMarketplaceName: marketplace.path ? null : marketplace.name }));
    if (manageOnly && !options.reload) updateDirectoryUrl(pluginManagementDetailUrl(managementBase(), {
      pluginId: plugin.id, hostId: "local", sourceType: plugin.source?.type ?? "local", remotePluginId: remoteId(plugin),
      pluginName: marketplace.path ? plugin.name : remoteId(plugin) ?? plugin.name,
      marketplacePath: marketplace.path, remoteMarketplaceName: marketplace.path ? null : marketplace.name,
    }));
    setDetailKey(key);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const reference = pluginRefFor(plugin, marketplace);
      const res = await readPlugin(reference);
      if (!isPluginContextCurrent(context) || detailRequestRef.current !== requestId) return;
      if (!directoryPluginInstallation(plugin.id, { marketplaces: [{ name: res.marketplaceName, plugins: [res.summary] }] }).plugin) {
        throw new Error("插件详情身份与目录不一致，请重新读取。");
      }
      if (!pluginDetailMatchesReference(res, reference)) throw new Error("插件详情来源与请求不一致，请重新读取。");
      detailContextRef.current = { plugin: res.summary, marketplace: {
        name: res.marketplaceName, path: res.marketplacePath, plugins: [res.summary],
      } };
      setDetail(res);
    } catch (err) {
      if (!isPluginContextCurrent(context) || detailRequestRef.current !== requestId) return;
      setDetailError(toViewError(err));
    } finally {
      if (isPluginContextCurrent(context) && detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const resolveDirectoryListing = async (id: string, install: boolean, navigate = true) => {
    if (unsupportedDirectoryHost() || install && directoryResolveLocks.current.has(id)) return;
    if (install) { directoryResolveLocks.current.add(id); setDirectoryResolving(new Set(directoryResolveLocks.current)); }
    const context = pluginContextRef.current;
    const request = install ? null : ++detailRequestRef.current;
    if (!install) {
      if (navigate) updateDirectoryUrl(pluginDirectoryDetailUrl(directoryBase(), { pluginId: id, pluginName: id, remoteMarketplaceName: "chatgpt-workspace" }));
      detailContextRef.current = null;
      directoryDetailRetry.current = () => void resolveDirectoryListing(id, false, false);
      setDetailKey(id); setDetail(null); setDetailLoading(true); setDetailError(null);
    }
    try {
      const result = await readLocalDirectoryListing(id);
      if (!isPluginContextCurrent(context) || unsupportedDirectoryHost() || !directoryActive.current || request !== null && request !== detailRequestRef.current) return;
      const marketplace = { name: result.marketplaceName, path: result.marketplacePath, plugins: [result.summary] };
      if (install) await handleInstallPlugin(result.summary, marketplace);
      else { detailContextRef.current = { plugin: result.summary, marketplace }; setDetail(result); }
    } catch (error) {
      if (isPluginContextCurrent(context) && (request === null || request === detailRequestRef.current)) {
        if (install) notify(`读取插件失败：${errorSummary(error)}`, "error"); else setDetailError(toViewError(error));
      }
    } finally {
      if (isPluginContextCurrent(context) && install) directoryResolveLocks.current.delete(id);
      if (isPluginContextCurrent(context)) { if (install) setDirectoryResolving(new Set(directoryResolveLocks.current)); if (request === detailRequestRef.current) setDetailLoading(false); }
    }
  };

  const loadCategory = async (cursor: string | null = null) => {
    if (directoryCategory === "plugins-created-by-you" || directoryCategory === "plugins-shared-with-you" || directoryCategory?.startsWith("plugins-marketplace-")) return;
    if (unsupportedDirectoryHost() || directorySource?.kind !== "remote" || !directoryCategory || categoryPaging.current || cursor && categoryConsumed.current.has(cursor)) return;
    const controller = categoryRead.current ?? new AbortController(); categoryRead.current = controller;
    const context = pluginContextRef.current;
    categoryPaging.current = true; setCategoryLoading(true); setCategoryError(null);
    try {
      const result = await loadPluginDirectoryCategory(directorySource.identity, directoryCategory, searchQuery.trim(), cursor, controller.signal);
      if (!isPluginContextCurrent(context) || controller.signal.aborted || categoryRead.current !== controller) return;
      if (cursor) categoryConsumed.current.add(cursor);
      setCategoryRows(previous => { const rows = cursor ? [...previous, ...result.plugins] : result.plugins; return [...new Map(rows.map(row => [row.id, row])).values()]; });
      setCategoryCursor(result.nextCursor && !categoryConsumed.current.has(result.nextCursor) ? result.nextCursor : null);
    } catch (error) { if (isPluginContextCurrent(context) && !controller.signal.aborted) setCategoryError(errorSummary(error)); }
    finally { if (categoryRead.current === controller && !controller.signal.aborted && isPluginContextCurrent(context)) { categoryPaging.current = false; setCategoryLoading(false); } }
  };
  useEffect(() => {
    categoryRead.current?.abort(); categoryRead.current = new AbortController(); categoryPaging.current = false; categoryConsumed.current = new Set();
    setCategoryRows([]); setCategoryCursor(null); setCategoryError(null); setCategoryLoading(false);
    if (directoryCategory && directorySource?.kind === "remote") {
      const timer = window.setTimeout(() => void loadCategory(), 200);
      return () => { window.clearTimeout(timer); categoryRead.current?.abort(); };
    }
  }, [directoryCategory, searchQuery, directorySource, activeWorkspaceRoot, connectionIdentity]);

  useEffect(() => {
    if (manageOnly) return;
    const restore = () => {
      const route = window.location ? parsePluginDirectoryLocation(window.location.href) : null;
      if (!route) return;
      setSearchQuery(route.search); setDirectoryCategory(route.category); setDirectoryTab(readDirectoryTab());
      const unsupportedHost = !!route.hostId?.trim() && route.hostId !== "local";
      setDirectoryHostUnsupported(unsupportedHost);
      ++detailRequestRef.current; detailContextRef.current = null; setDetailKey(null); setDetail(null); setDetailError(null); setDetailLoading(false);
      if (unsupportedHost) return;
      if (route.pluginId) {
        if (route.pluginName && (route.marketplacePath || route.remoteMarketplaceName)) {
          const context = pluginContextRef.current, request = ++detailRequestRef.current;
          directoryDetailRetry.current = restore;
          setDetailKey(route.pluginId); setDetailLoading(true);
          const reference = route.marketplacePath ? { pluginName: route.pluginName, marketplacePath: route.marketplacePath }
            : { pluginName: route.pluginName, remoteMarketplaceName: route.remoteMarketplaceName! };
          void readPlugin(reference).then(result => {
            if (!isPluginContextCurrent(context) || request !== detailRequestRef.current) return;
            if (!directoryPluginInstallation(route.pluginId!, { marketplaces: [{ name: result.marketplaceName, plugins: [result.summary] }] }).plugin) {
              throw new Error("插件详情身份与目录不一致，请重新读取。");
            }
            if (!pluginDetailMatchesReference(result, reference)) throw new Error("插件详情来源与请求不一致，请重新读取。");
            setDetail(result); detailContextRef.current = { plugin: result.summary, marketplace: { name: result.marketplaceName, path: result.marketplacePath, plugins: [result.summary] } };
          }).catch(error => { if (isPluginContextCurrent(context) && request === detailRequestRef.current) setDetailError(toViewError(error)); })
            .finally(() => { if (isPluginContextCurrent(context) && request === detailRequestRef.current) setDetailLoading(false); });
        } else void resolveDirectoryListing(route.pluginId, false, false);
      }
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [manageOnly, activeWorkspaceRoot, connectionIdentity]);

  useEffect(() => {
    if (!manageOnly) return;
    const restore = () => {
      const route = window.location ? parsePluginManagementLocation(window.location.href) : null;
      if (!route) return;
      setDirectoryHostUnsupported(unsupportedDirectoryHost());
      const request = ++detailRequestRef.current, context = pluginContextRef.current;
      detailContextRef.current = null; setDetail(null); setDetailError(null); setDetailLoading(false);
      if (route.kind === "root") { setDetailKey(null); if (route.requestedTab === "mcps") setSubTab("mcp"); return; }
      setDetailKey(route.pluginId ?? "management-subpage"); setSubTab("plugins");
      directoryDetailRetry.current = restore;
      if (route.hostId && route.hostId !== "local") { setDetailError(toViewError(new Error("当前管理入口尚不支持此主机。"))); return; }
      if (route.kind !== "plugin" || route.section !== "detail" || route.skillName || route.appId) {
        setDetailError(toViewError(new Error("此插件管理子页面尚未接入。"))); return;
      }
      const id = route.pluginId!;
      setDetailLoading(true);
      void (async () => {
        if ((route.marketplacePath || route.remoteMarketplaceName) && !route.pluginName?.trim()) throw new Error("无法确认插件来源名称，请从管理列表重新打开。");
        const reference = route.marketplacePath ? { pluginName: route.pluginName!, marketplacePath: route.marketplacePath }
          : route.remoteMarketplaceName ? { pluginName: route.pluginName!, remoteMarketplaceName: route.remoteMarketplaceName } : null;
        const result = reference
          ? await readPlugin(reference)
          : route.hostId ? (() => { throw new Error("无法确认插件来源，请从管理列表重新打开。"); })() : await readLocalDirectoryListing(id);
        if (!isPluginContextCurrent(context) || request !== detailRequestRef.current) return;
        if (!directoryPluginInstallation(id, { marketplaces: [{ name: result.marketplaceName, plugins: [result.summary] }] }).plugin) {
          throw new Error("插件详情身份与管理入口不一致，请重新读取。");
        }
        if (reference && !pluginDetailMatchesReference(result, reference)) throw new Error("插件详情来源与管理入口不一致，请重新读取。");
        detailContextRef.current = { plugin: result.summary, marketplace: { name: result.marketplaceName,
          path: result.marketplacePath, plugins: [result.summary] } };
        setDetail(result);
      })().catch(error => { if (isPluginContextCurrent(context) && request === detailRequestRef.current) setDetailError(toViewError(error)); })
        .finally(() => { if (isPluginContextCurrent(context) && request === detailRequestRef.current) setDetailLoading(false); });
    };
    restore(); window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("popstate", restore); ++detailRequestRef.current; };
  }, [manageOnly, activeWorkspaceRoot, connectionIdentity, managementHostId]);

  const handleInstallPlugin = async (
    plugin: PluginSummary,
    marketplace: PluginMarketplaceEntry
  ) => {
    if (unsupportedDirectoryHost() || pluginActionRef.current.has(plugin.id)) return;
    if (installUncertaintyRef.current.get(installScope)?.has(plugin.id) || plugin.installed ||
        installedData?.marketplaces.some(market => market.plugins.some(item => item.id === plugin.id && item.installed))) return;
    if (plugin.availability === "DISABLED_BY_ADMIN" || plugin.installPolicy === "NOT_AVAILABLE") return;
    pluginActionRef.current.add(plugin.id);
    setBusyPluginIds(new Set(pluginActionRef.current));
    const context = pluginContextRef.current;
    updateInstallUncertainty(installScope, plugin.id, true, context);
    try {
      const res = await installPlugin(pluginRefFor(plugin, marketplace));
      if (!isPluginContextCurrent(context)) return;
      const name = pluginDisplayName(plugin);
      if (res.appsNeedingAuth.length > 0) {
        const attempt = ++preparationAttemptRef.current;
        setPluginPreparations(current => ({
          ...current, [plugin.id]: { name, result: res, attempt },
        }));
      }
      resetBrowseCache();
      const [inventory] = await Promise.all([
        loadInstalledPlugins({ silent: true }),
        pluginMode === "browse" ? loadBrowsePlugins(true) : Promise.resolve(),
      ]);
      if (!isPluginContextCurrent(context)) return;
      const confirmed = inventory && !inventory.marketplaceLoadErrors?.length && inventory.marketplaces.some(market =>
        market.plugins.some(item => item.id === plugin.id && item.installed));
      if (confirmed) {
        updateInstallUncertainty(installScope, plugin.id, false, context);
        notify(`✓ 已安装 ${name}${res.appsNeedingAuth.length ? `；${res.appsNeedingAuth.map(app => app.name).join("、")} 需要授权` : ""}`);
      } else {
        notify(`已安装 ${name}，但安装列表刷新未确认结果；请刷新安装状态后再重试`, "error");
      }
      const skillRefreshError = await loadRemoteSkills(true);
      if (isPluginContextCurrent(context) && confirmed &&
          (!res.appsNeedingAuth.length || res.authPolicy === "ON_USE") && !skillRefreshError) {
        return inventory!.marketplaces.flatMap(market => market.plugins).find(item => item.id === plugin.id && item.installed);
      }
    } catch (err) {
      if (isPluginContextCurrent(context)) {
        const uncertain = err instanceof PluginProtocolError;
        if (uncertain) {
          notify(`安装结果无法确认：${errorSummary(err)}；正在重新读取安装状态`, "error");
          const inventory = await loadInstalledPlugins({ silent: true });
          if (inventory && !inventory.marketplaceLoadErrors?.length && inventory.marketplaces.some(market => market.plugins.some(item => item.id === plugin.id && item.installed))) {
            updateInstallUncertainty(installScope, plugin.id, false, context);
          }
        } else {
          updateInstallUncertainty(installScope, plugin.id, false, context);
          notify(`安装失败：${errorSummary(err)}`, "error");
        }
      }
    } finally {
      pluginActionRef.current.delete(plugin.id);
      if (pluginMountedRef.current) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };

  const updateUninstallUncertainty = (scope: string, id: string, pending: boolean, context: number) => {
    const ids = new Set(uninstallUncertaintyRef.current.get(scope));
    if (pending) ids.add(id); else ids.delete(id);
    uninstallUncertaintyRef.current.set(scope, ids);
    if (isPluginContextCurrent(context)) setUnconfirmedUninstalls(ids);
  };
  const verifyUninstalledPlugin = async (plugin: PluginSummary, request = detailRequestRef.current, allowManualRetry = false) => {
    const context = pluginContextRef.current;
    const inventory = await loadInstalledPlugins({ silent: true });
    if (!isPluginContextCurrent(context)) return false;
    if (!inventory || inventory.marketplaceLoadErrors?.length) {
      notify("卸载结果尚未确认；请核验状态，不会重复提交卸载。", "error"); return false;
    }
    if (inventory.marketplaces.some(market => market.plugins.some(item => item.id === plugin.id && item.installed))) {
      if (allowManualRetry) {
        updateUninstallUncertainty(installScope, plugin.id, false, context);
        notify("插件仍处于已安装状态，可以重新选择卸载。", "error");
      } else notify("卸载结果尚未确认；请核验状态，不会重复提交卸载。", "error");
      return false;
    }
    updateUninstallUncertainty(installScope, plugin.id, false, context);
    notify(`已卸载 ${pluginDisplayName(plugin)}`);
    if (manageOnly && request === detailRequestRef.current && detailContextRef.current?.plugin.id === plugin.id) closeManagedDetail(true);
    return true;
  };
  const handleUninstallPlugin = async (
    plugin: PluginSummary
  ) => {
    if (unsupportedDirectoryHost()) return;
    if (isServicePlugin(plugin)) { await handleRemotePlugin(plugin, "uninstall"); return; }
    if (pluginActionRef.current.has(plugin.id) || uninstallUncertaintyRef.current.get(installScope)?.has(plugin.id) || pluginUpdates[plugin.id]?.pending || plugin.source?.type === "remote" && plugin.installPolicy === "INSTALLED_BY_DEFAULT") return;
    pluginActionRef.current.add(plugin.id);
    setBusyPluginIds(new Set(pluginActionRef.current));
    const context = pluginContextRef.current, detailRequest = detailRequestRef.current;
    updateUninstallUncertainty(installScope, plugin.id, true, context);
    try {
      await uninstallPlugin(plugin.id);
      if (!isPluginContextCurrent(context)) return;
      setPluginPreparations(current => {
        const next = { ...current };
        delete next[plugin.id];
        return next;
      });
      resetBrowseCache();
      await Promise.all([
        verifyUninstalledPlugin(plugin, detailRequest),
        pluginMode === "browse" ? loadBrowsePlugins(true) : Promise.resolve(),
      ]);
      if (!isPluginContextCurrent(context)) return;
      await loadRemoteSkills(true);
    } catch (err) {
      if (isPluginContextCurrent(context)) {
        if (err instanceof PluginProtocolError) { notify(`卸载结果无法确认：${errorSummary(err)}`, "error"); await verifyUninstalledPlugin(plugin, detailRequest); }
        else { updateUninstallUncertainty(installScope, plugin.id, false, context); notify(`卸载失败：${errorSummary(err)}`, "error"); }
      }
    } finally {
      pluginActionRef.current.delete(plugin.id);
      if (pluginMountedRef.current) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };

  const handleTogglePlugin = async (plugin: PluginSummary) => {
    if (unsupportedDirectoryHost()) return;
    if (isServicePlugin(plugin)) return handleRemotePlugin(plugin, plugin.enabled ? "disable" : "enable");
    if (pluginActionRef.current.has(plugin.id) || pluginUpdates[plugin.id]?.pending || plugin.availability === "DISABLED_BY_ADMIN") return;
    const context = pluginContextRef.current, enabled = !plugin.enabled;
    pluginActionRef.current.add(plugin.id); setBusyPluginIds(new Set(pluginActionRef.current));
    try {
      const result = await setPluginEnabled(plugin, enabled, { cwd: activeWorkspaceRoot || undefined, hostId: "local", isCurrent: () => isPluginContextCurrent(context) });
      if (!isPluginContextCurrent(context) || result.stale) return;
      setPluginUpdates(current => ({ ...current, [plugin.id]: { pending: result.verification === "pending", enabled, configFilePath: result.configFilePath, error: result.error, refreshError: result.refreshError } }));
      if (result.verification === "confirmed") {
        notify(`${pluginDisplayName(plugin)} 插件已${enabled ? "启用" : "禁用"}`);
        const [, skillRefreshError] = await Promise.all([loadInstalledPlugins({ silent: true }), loadRemoteSkills(true)]);
        if (isPluginContextCurrent(context) && !result.refreshError && !skillRefreshError) return result.plugin;
      }
    } catch (error) {
      if (isPluginContextCurrent(context)) setPluginUpdates(current => ({ ...current, [plugin.id]: { pending: false, enabled, configFilePath: null, error: String(error), refreshError: null } }));
    } finally {
      pluginActionRef.current.delete(plugin.id);
      if (isPluginContextCurrent(context)) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };
  const verifyPluginUpdate = async (plugin: PluginSummary) => {
    if (pluginActionRef.current.has(plugin.id)) return;
    const context = pluginContextRef.current;
    const update = pluginUpdates[plugin.id];
    if (!update) return;
    pluginActionRef.current.add(plugin.id); setBusyPluginIds(new Set(pluginActionRef.current));
    try {
      const result = await verifyPluginEnabled(plugin, update.enabled, { cwd: activeWorkspaceRoot || undefined, hostId: "local", expectedFilePath: update.configFilePath ?? undefined, isCurrent: () => isPluginContextCurrent(context) });
      if (!isPluginContextCurrent(context) || result.stale) return;
      setPluginUpdates(current => ({ ...current, [plugin.id]: { ...update, pending: result.verification !== "confirmed", error: result.error, refreshError: result.refreshError } }));
      await Promise.all([loadInstalledPlugins({ silent: true }), loadRemoteSkills()]);
    } catch (error) {
      if (isPluginContextCurrent(context)) setPluginUpdates(current => ({ ...current, [plugin.id]: { ...current[plugin.id], error: String(error) } }));
    } finally {
      pluginActionRef.current.delete(plugin.id);
      if (isPluginContextCurrent(context)) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };

  const remoteStatus = (plugin: PluginSummary) => servicePlugins?.identity ? remoteOperations[remoteIntentKey(servicePlugins.identity, plugin)] : undefined;
  const remoteAvailable = (plugin: PluginSummary) => Boolean(!serviceError && !serviceLoading && servicePlugins?.identity && !servicePlugins.unsupported && remoteId(plugin) && servicePlugins.marketplace?.plugins.some(row => remoteId(row) === remoteId(plugin) && row.installed && row.remotePolicyKnown === true));
  const refreshRemoteRuntime = async () => {
    const context = pluginContextRef.current;
    const results = await Promise.allSettled([listSkills(workspaceCwds(), true), listApps({ forceRefetch: true }), readMcpSettings(activeWorkspaceRoot || undefined), listInstalledPlugins(workspaceCwds())]);
    if (!isPluginContextCurrent(context)) return;
    const [skillsResult, appsResult, mcpResult, installedResult] = results;
    if (skillsResult.status === "fulfilled") setRemoteSkills(flattenSkills(skillsResult.value).skills);
    if (appsResult.status === "fulfilled") setAppsData(appsResult.value.data);
    if (mcpResult.status === "fulfilled") setMcpCount(mcpResult.value.entries.length);
    if (installedResult.status === "fulfilled") setInstalledData(installedResult.value);
    const errors = results.filter(result => result.status === "rejected").map(result => String((result as PromiseRejectedResult).reason));
    if (skillsResult.status === "fulfilled" && skillsResult.value.data.some(entry => entry.errors.length)) errors.push("技能目录包含加载错误");
    setRuntimeWarning(errors.length ? `插件变更已确认，但运行时刷新失败：${errors.join("；")}` : null);
    return errors.length === 0;
  };
  const handleRemotePlugin = async (plugin: PluginSummary, operation: RemoteOperation, verifyOnly = false) => {
    const identity = servicePlugins?.identity;
    if (!identity || !remoteId(plugin)) return;
    const key = remoteIntentKey(identity, plugin), actionKey = pluginActionKey(plugin), saved = remoteIntents.get(key);
    if (saved?.busy || pluginActionRef.current.has(actionKey)) return;
    if (!verifyOnly && (!remoteAvailable(plugin) || saved?.pending || plugin.availability === "DISABLED_BY_ADMIN" && operation !== "uninstall" || operation === "uninstall" && plugin.installed && plugin.installPolicy === "INSTALLED_BY_DEFAULT")) return;
    if (!verifyOnly && operation === "uninstall" && !confirm(`确定要卸载插件「${pluginDisplayName(plugin)}」吗？`)) return;
    const context = pluginContextRef.current, controller = new AbortController();
    const intent: RemoteIntent = { plugin: verifyOnly && saved ? saved.plugin : plugin, operation: saved?.pending ? saved.operation : operation, identity, pending: true, busy: true, error: null, refreshError: null };
    saveRemoteIntent(key, intent); setRemoteOperations(current => ({ ...current, [key]: intent }));
    pluginActionRef.current.add(actionKey); setBusyPluginIds(new Set(pluginActionRef.current)); remoteWrites.current.add(controller);
    try {
      const result = await (verifyOnly ? verifyRemotePlugin : manageRemotePlugin)(intent.plugin, intent.operation, identity, controller.signal);
      const next = { ...intent, pending: result.verification === "pending" || result.verification === "unknown", busy: false, error: result.error };
      saveRemoteIntent(key, next);
      if (!isPluginContextCurrent(context) || controller.signal.aborted) return;
      setRemoteOperations(current => ({ ...current, [key]: next }));
      if (result.snapshot && result.snapshot.identity?.accountId === identity.accountId && result.snapshot.identity.userId === identity.userId && result.snapshot.identity.generation === identity.generation) {
        serviceRequest.current++; serviceRead.current?.abort(); setServiceLoading(false); setServicePlugins(result.snapshot); setServiceError(result.snapshot.error);
      }
      if (result.verification === "confirmed") {
        notify(intent.operation === "uninstall" ? `已卸载 ${pluginDisplayName(plugin)}` : `${pluginDisplayName(plugin)} 插件已${intent.operation === "enable" ? "启用" : "禁用"}`);
        try {
          const refreshed = await refreshRemoteRuntime();
          const snapshot = result.snapshot;
          if (refreshed && isPluginContextCurrent(context) && !controller.signal.aborted &&
              snapshot?.identity?.accountId === identity.accountId && snapshot.identity.userId === identity.userId && snapshot.identity.generation === identity.generation) {
            return snapshot.marketplace?.plugins.find(item => remoteId(item) === remoteId(plugin) && item.installed &&
              item.enabled === (intent.operation === "enable"));
          }
        }
        catch (error) { if (isPluginContextCurrent(context)) setRuntimeWarning(`插件变更已确认，但运行时刷新失败：${String(error)}`); }
      }
    } catch (error) {
      const next = { ...intent, busy: false, pending: true, error: `结果尚未确认：${String(error)}` }; saveRemoteIntent(key, next);
      if (isPluginContextCurrent(context) && !controller.signal.aborted) setRemoteOperations(current => ({ ...current, [key]: next }));
    } finally {
      remoteWrites.current.delete(controller); pluginActionRef.current.delete(actionKey);
      if (pluginMountedRef.current) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Marketplace actions
  // ───────────────────────────────────────────────────────────────────────────

  const resetBrowseCache = () => {
    ++browseRequestRef.current;
    browseLoadedRef.current = false;
    browseLoadingRef.current = false;
    setBrowseLoading(false);
    setBrowseData(null);
  };

  const handleAddMarketplace = async (input: AddPluginMarketplaceInput) => {
    const context = pluginContextRef.current;
    if (!isPluginContextCurrent(context)) throw new Error("当前主机不支持添加插件市场");
    setMarketplaceBusy("add");
    setMarketplaceActionError(null);
    setUpgradeReport(null);
    try {
      const result = await addMarketplace(input.source, {
        refName: input.refName ?? undefined,
        sparsePaths: input.sparsePaths ?? undefined,
      });
      if (!isPluginContextCurrent(context)) return;
      (onNotify ?? notify)(result.alreadyAdded ? `${result.marketplaceName} 已添加` : `已添加 ${result.marketplaceName} 市场`, "success");
      resetBrowseCache();
      const [inventory, management] = await Promise.all([
        loadInstalledPlugins({ silent: true }), loadManagement(),
      ]);
      if (!isPluginContextCurrent(context)) return;
      if (!inventory || inventory.marketplaceLoadErrors?.length || management !== true) {
        (onNotify ?? notify)(`${result.marketplaceName} 市场已配置，但刷新插件列表失败`, "error");
      }
      onBrowseDirectory?.("plugins", result.marketplaceName);
    } finally {
      if (isPluginContextCurrent(context)) setMarketplaceBusy(null);
    }
  };

  const removal = useMarketplaceRemoval(JSON.stringify([activeWorkspaceRoot, connectionIdentity, manageOnly ? managementHostId : null]), workspaceCwds(), async () => {
    resetBrowseCache();
    await Promise.all([loadInstalledPlugins({ silent: true }), loadManagement(), loadRemoteSkills(true)]);
  });
  useEffect(() => {
    if (removal.target) removalDialog.current?.showModal(); else removalDialog.current?.close();
  }, [removal.target]);
  const closeRemoval = () => {
    removal.close();
    requestAnimationFrame(() => removalTrigger.current?.focus());
  };
  const handleRemoveMarketplace = (marketplace: PluginMarketplaceEntry) => { void removal.open(marketplace); };

  const handleUpgradeMarketplaces = async (marketplaceName?: string) => {
    const eligible = configuredMarkets.filter(item => item.canUpgrade && (!marketplaceName || item.marketplace.name === marketplaceName));
    if (!eligible.length || marketplaceBusy !== null) return;
    setMarketplaceBusy(marketplaceName ?? "upgrade");
    setUpgradeReport(null);
    try {
      const results: MarketplaceUpgradeResponse[] = [];
      for (const item of eligible) results.push(await upgradeMarketplace(item.marketplace.name));
      const res = { selectedMarketplaces: results.flatMap(result => result.selectedMarketplaces), upgradedRoots: results.flatMap(result => result.upgradedRoots), errors: results.flatMap(result => result.errors) };
      setUpgradeReport(res);
      if (res.errors.length > 0) {
        notify(
          `市场升级完成：${res.selectedMarketplaces.length} 个成功，${res.errors.length} 个失败`,
          "error"
        );
      } else {
        notify(`✓ 已升级 ${res.selectedMarketplaces.length} 个市场`);
      }
      resetBrowseCache();
      await Promise.all([loadInstalledPlugins({ silent: true }), loadManagement()]);
    } catch (err) {
      notify(`市场升级失败：${errorSummary(err)}`, "error");
    } finally {
      setMarketplaceBusy(null);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Skills actions (existing local editing kept intact + app-server toggles)
  // ───────────────────────────────────────────────────────────────────────────

  const handleSaveSkill = async () => {
    if (skillWritePendingRef.current) return;
    if (!newSkillId.trim() || !skillContent.trim()) return;
    if (readOnlyRemoteSkill) {
      notify("该技能由插件提供，仅支持启用/禁用", "error");
      return;
    }
    skillWritePendingRef.current = true;
    setSkillWriteBusy(true);
    const context = pluginContextRef.current;
    const revision = skillEditorRevisionRef.current;
    try {
      const saved = await tauriInvoke<SkillInfoItem>("skill_save_or_install", {
        id: newSkillId.trim(),
        content: skillContent,
        sourceDir: null,
      });
      if (!isPluginContextCurrent(context)) return;
      await loadRemoteSkills(true);
      if (!isPluginContextCurrent(context)) return;
      await refreshAll();
      if (!isPluginContextCurrent(context)) return;
      if (revision === skillEditorRevisionRef.current) {
        setSelectedSkill(saved);
        setSelectedSkillKey(saved.path);
        setCreatingSkill(false);
        setReadOnlyRemoteSkill(null);
      }
      notify(`✓ 已保存技能 ${saved.id}`);
    } catch (err: any) {
      if (isPluginContextCurrent(context)) notify(`保存技能失败: ${err?.message || String(err)}`, "error");
    } finally {
      skillWritePendingRef.current = false;
      if (pluginMountedRef.current) setSkillWriteBusy(false);
    }
  };

  const handleInstallSeedSkill = async (skill: SkillInfoItem) => {
    if (skillWritePendingRef.current) return;
    skillWritePendingRef.current = true;
    setSkillWriteBusy(true);
    const context = pluginContextRef.current;
    try {
      await tauriInvoke<SkillInfoItem>("skill_save_or_install", {
        id: skill.id,
        content: skill.content,
        sourceDir: skill.dirPath,
      });
      if (!isPluginContextCurrent(context)) return;
      await loadRemoteSkills(true);
      if (!isPluginContextCurrent(context)) return;
      await refreshAll();
      if (isPluginContextCurrent(context)) notify(`✓ 已安装技能 ${skill.name}`);
    } catch (err: any) {
      if (isPluginContextCurrent(context)) notify(`安装技能失败: ${err?.message || String(err)}`, "error");
    } finally {
      skillWritePendingRef.current = false;
      if (pluginMountedRef.current) setSkillWriteBusy(false);
    }
  };

  const handleDeleteSkill = async (skill: SkillInfoItem, onRemoved?: () => void) => {
    if (skillWritePendingRef.current) return;
    if (!confirm(`确定要卸载技能 ${skill.name} 吗？`)) return;
    skillWritePendingRef.current = true;
    setSkillWriteBusy(true);
    const context = pluginContextRef.current;
    const revision = skillEditorRevisionRef.current;
    try {
      await tauriInvoke("skill_delete", { id: skill.id });
      if (!isPluginContextCurrent(context)) return;
      onRemoved?.();
      if (revision === skillEditorRevisionRef.current && selectedSkill?.path === skill.path) {
        ++skillSelectionRequestRef.current;
        skillSelectionRef.current = null;
        setSelectedSkill(null);
        setSelectedSkillKey(null);
        setReadOnlyRemoteSkill(null);
        setNewSkillId("");
        setSkillContent("");
        setSkillContentError(null);
        setSkillContentLoading(false);
      }
      await refreshAll();
      if (isPluginContextCurrent(context)) notify(`已卸载技能 ${skill.name}`);
    } catch (err: any) {
      if (isPluginContextCurrent(context)) notify(`卸载技能失败: ${err?.message || String(err)}`, "error");
    } finally {
      skillWritePendingRef.current = false;
      if (pluginMountedRef.current) setSkillWriteBusy(false);
    }
  };

  const handleToggleSkill = async (row: SkillRow) => {
    if (skillWritePendingRef.current) return;
    if (row.enabled === undefined || !row.remote) return;
    skillWritePendingRef.current = true;
    setSkillWriteBusy(true);
    setSkillToggleBusy(row.key);
    const context = pluginContextRef.current;
    try {
      await writeSkillEnabled({
        enabled: !row.enabled,
        path: row.remote.path || undefined,
        name: row.remote.name,
      });
      if (!isPluginContextCurrent(context)) return;
      notify(`✓ 已${row.enabled ? "禁用" : "启用"}技能 ${row.name}`);
      await loadRemoteSkills(true);
    } catch (err) {
      if (isPluginContextCurrent(context)) notify(`切换技能状态失败：${errorSummary(err)}`, "error");
    } finally {
      skillWritePendingRef.current = false;
      if (pluginMountedRef.current) {
        setSkillWriteBusy(false);
        setSkillToggleBusy(null);
      }
    }
  };

  const handleSelectSkillRow = async (row: SkillRow) => {
    setCreatingSkill(false);
    const request = ++skillSelectionRequestRef.current;
    ++skillEditorRevisionRef.current;
    const context = pluginContextRef.current;
    const isCurrent = () => isPluginContextCurrent(context) && request === skillSelectionRequestRef.current;
    skillSelectionRef.current = row;
    setSelectedSkillKey(row.key);
    setSkillContentError(null);
    setSkillContentLoading(false);
    if (row.local) {
      setSelectedSkill(row.local);
      setReadOnlyRemoteSkill(null);
      setNewSkillId(row.local.id);
      setSkillContent(row.local.content);
    } else {
      setSelectedSkill(null);
      setReadOnlyRemoteSkill(row.remote);
      setNewSkillId(
        row.remote?.name.includes(":")
          ? row.remote.name.split(":").pop() || row.remote.name
          : row.remote?.name || row.name
      );
      setSkillContent("");
      setSkillContentLoading(true);
      let readError: unknown = new Error("此技能没有可读取的内容路径");
      if (row.remote?.path) {
        try {
          const content = await readFileText(row.remote.path);
          if (!isCurrent()) return;
          setSkillContent(content);
          setSkillContentLoading(false);
          return;
        } catch (error) { readError = error; }
      }
      if (!isCurrent()) return;
      if (row.remote?.pluginId) {
        try {
          const parts = row.remote.pluginId.split("@");
          const skillRes = await callAppServer<any>("plugin/skill/read", {
            remotePluginId: parts[0],
            remoteMarketplaceName: parts[1] || "",
            skillName: row.remote.name,
          });
          if (!isCurrent()) return;
          if (typeof skillRes?.contents === "string") {
            setSkillContent(skillRes.contents);
            setSkillContentLoading(false);
            return;
          }
          readError = new Error("服务未返回技能内容");
        } catch (error) { readError = error; }
      }
      if (!isCurrent()) return;
      setSkillContentError(errorSummary(readError));
      setSkillContentLoading(false);
    }
  };

  const handleStartNewSkill = () => {
    setCreatingSkill(true);
    ++skillSelectionRequestRef.current;
    ++skillEditorRevisionRef.current;
    skillSelectionRef.current = null;
    setSkillContentError(null);
    setSkillContentLoading(false);
    setSelectedSkill(null);
    setSelectedSkillKey(null);
    setReadOnlyRemoteSkill(null);
    setNewSkillId("my-custom-skill");
    setSkillContent(
      "---\nname: my-custom-skill\ndescription: 自定义技能描述\n---\n\n# My Custom Skill\n\n在这里编写技能指令...\n"
    );
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Derived data
  // ───────────────────────────────────────────────────────────────────────────

  const search = searchQuery.trim().toLowerCase();
  const matchesSearch = (text: string): boolean =>
    !search || text.toLowerCase().includes(search);

  const pluginMatchesSearch = (plugin: PluginSummary): boolean =>
    matchesSearch(
      [
        pluginDisplayName(plugin),
        plugin.name,
        pluginDescription(plugin),
        pluginDeveloper(plugin),
        pluginCategory(plugin),
        (plugin.keywords ?? []).join(" "),
      ].join(" ")
    );

  const installedMarketplaces = installedData?.marketplaces ?? [];
  const mergedInstalledData = mergePluginInventories(installedData, servicePlugins);
  const mergedMarketplaces = mergedInstalledData.marketplaces;
  const manageableMarkets = configuredMarkets.map(item => item.marketplace);
  const marketplaceLoadErrors = installedData?.marketplaceLoadErrors ?? [];
  const installedCount = mergedMarketplaces.reduce(
    (sum, marketplace) => sum + (marketplace.plugins?.length ?? 0),
    0
  );
  const installedGroups = mergedMarketplaces
    .map((marketplace) => ({
      marketplace,
      plugins: (marketplace.plugins ?? []).filter(pluginMatchesSearch),
    }))
    .filter((group) => group.plugins.length > 0);

  const browseGroups = (browseData?.marketplaces ?? [])
    .map((marketplace) => ({
      marketplace,
      plugins: (marketplace.plugins ?? [])
        .filter(pluginMatchesSearch),
    }))
    .filter((group) => group.plugins.length > 0);
  const browseCount = (browseData?.marketplaces ?? []).reduce(
    (sum, marketplace) =>
      sum + (marketplace.plugins ?? []).length,
    0
  );
  let remainingBrowseCards = browseVisibleCount;
  const visibleBrowseGroups = browseGroups.map((group) => {
    const plugins = group.plugins.slice(0, remainingBrowseCards);
    remainingBrowseCards = Math.max(0, remainingBrowseCards - plugins.length);
    return { ...group, plugins };
  }).filter((group) => group.plugins.length > 0);
  const matchingBrowseCount = browseGroups.reduce((sum, group) => sum + group.plugins.length, 0);

  const managedSkills = manageOnly ? filterManagedSkills(remoteSkills ?? [], managementRecommended) : null;
  const managedSkillPaths = new Set(managedSkills?.map(skill => normalizePathKey(skill.path)));
  const skillRows = buildSkillRows(manageOnly ? skills.filter(skill => skill.installed && managedSkillPaths.has(normalizePathKey(skill.path))) : skills, manageOnly ? managedSkills : remoteSkills);
  const previewRow = skillPreview ? skillRows.find(row => row.key === skillPreview.row.key) ?? skillPreview.row : null;
  const openSkillRow = (row: SkillRow) => {
    if (manageOnly || row.scope === "seed") { void handleSelectSkillRow(row); return; }
    setToast(null);
    setSkillPreview({ row, identity: JSON.stringify([activeWorkspaceRoot, connectionIdentity, row.key, ++skillPreviewSequence.current]) });
  };
  const filteredSkillRows = skillRows.filter(
    (row) => matchesSearch(row.name) || matchesSearch(row.description)
  );
  const visibleSkillRows = filteredSkillRows.filter(row => manageOnly || !recommendedInstalledKeys.includes(row.key));
  const searchingSkills = !manageOnly && subTab === "skills" && search.length > 0;
  const recommendedSearchCount = recommendedSearch.query === search ? recommendedSearch.count : null;
  const skillResultCount = visibleSkillRows.length + (recommendedSearchCount ?? 0);
  const activeSkillSearchIndex = Math.min(skillSearchIndex, skillResultCount - 1);
  const handleSkillSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchingSkills || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    const results = pageRef.current?.querySelectorAll<HTMLElement>("[data-skill-search-result]");
    if (!results?.length) return;
    const current = Math.min(skillSearchIndex, results.length - 1);
    event.preventDefault();
    if (event.key === "Enter") {
      results[current].click();
      return;
    }
    const next = Math.max(0, Math.min(current + (event.key === "ArrowDown" ? 1 : -1), results.length - 1));
    setSkillSearchIndex(next);
    results[next].scrollIntoView({ block: "nearest" });
  };
  const renderSkillRow = (row: SkillRow, searchActive?: boolean) => (
    <div
      key={row.key}
      className={`skill-list-row ${
        selectedSkillKey === row.key ? "active" : ""
      }`}
      role="button"
      tabIndex={0}
      data-skill-search-result={searchActive === undefined ? undefined : String(searchActive)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSkillRow(row);
        }
      }}
      onClick={() => openSkillRow(row)}
    >
      <div className="skill-row-top">
        <strong>{row.name}</strong>
        <div className="pm-skill-row-right">
          {row.pluginId && <span className="tag-badge">插件</span>}
          <span className="tag-badge">
            {skillScopeLabel(row.scope)}
          </span>
          {!manageOnly && row.enabled !== undefined && <CheckCircle2 size={16} aria-label={row.enabled ? "技能已启用" : "技能已禁用"} className={row.enabled ? "pm-skill-check" : "pm-skill-check disabled"} />}
          {manageOnly && row.enabled !== undefined && (
            <button
              type="button"
              className={`pm-skill-toggle ${row.enabled ? "on" : ""}`}
              title={
                row.enabled
                  ? "禁用技能"
                  : "启用技能"
              }
              role="switch"
              aria-checked={row.enabled}
              aria-label={row.enabled ? "禁用技能" : "启用技能"}
              disabled={skillWriteBusy || skillToggleBusy === row.key}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleSkill(row);
              }}
            />
          )}
        </div>
      </div>
      <p className="skill-row-desc">{row.description}</p>
    </div>
  );
  const tabCounts: Record<SubTab, number> = { plugins: installedCount, apps: appsData ? appsData.filter(app => app.isAccessible === true).length : (appsInstalled?.filter(app => app.callable).length ?? 0),
    mcp: mcpCount, skills: skillRows.length, marketplaces: manageableMarkets.length };
  const tabLabels: Record<SubTab, string> = { plugins: "插件", apps: "应用", mcp: "MCP", skills: "技能", marketplaces: "市场" };
  const visibleManagementTabs = managementTabs(tabCounts, showNonMcpTabs);
  const selectTab = (tab: SubTab, afterSelect?: () => void) => {
    const action = () => {
      setSubTab(tab);
      if (manageOnly && tab !== "mcp" && window.location && parsePluginManagementLocation(window.location.href)?.requestedTab === "mcps") {
        const url = new URL(window.location.href); url.searchParams.delete("tab");
        window.history?.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
      afterSelect?.();
    };
    if (subTab === "mcp" && mcpNavigationGuard.current && !mcpNavigationGuard.current(action)) return;
    action();
  };
  useEffect(() => {
    if (!manageOnly) return;
    const loading = managementLoading || !!managementError || (subTab === "plugins" ? installedLoading || serviceLoading || !installedData && !servicePlugins || !!installedError || !!serviceError : subTab === "apps" ? appsLoading || !appsLoaded || !!appsError : subTab === "skills" ? remoteSkillsLoading || remoteSkills === null || !!remoteSkillsError : false);
    const next = managementFallback(subTab, tabCounts, loading, showNonMcpTabs);
    if (next !== subTab) selectTab(next);
  }, [manageOnly, subTab, installedCount, tabCounts.apps, tabCounts.skills, tabCounts.marketplaces, mcpCount, showNonMcpTabs, managementLoading, managementError, installedLoading, installedError, serviceLoading, serviceError, appsLoading, appsLoaded, appsError, remoteSkillsLoading, remoteSkillsError]);

  // ───────────────────────────────────────────────────────────────────────────
  // Reusable renderers
  // ───────────────────────────────────────────────────────────────────────────

  const renderLoadError = (
    err: ViewError,
    label: string,
    onRetry: () => void
  ) => {
    const authGate = err.kind === "forbidden" || err.kind === "auth";
    const offline = err.kind === "not-connected" || err.kind === "network";
    return (
      <div
        className={`pm-state-panel ${
          authGate || offline ? "pm-state-warn" : "pm-state-error"
        }`}
      >
        <div className="pm-state-icon">
          {authGate ? (
            <Lock size={16} />
          ) : offline ? (
            <WifiOff size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
        </div>
        <div className="pm-state-body">
          <span className="pm-state-title">{label}加载失败</span>
          <p className="pm-state-desc">
            {authGate
              ? "当前账号或网络拒绝了请求。请确认已连接 ChatGPT 账号并可在网络访问 app-server。"
              : offline
                ? "无法连接 Codex app-server，请确认应用已启动后重试。"
                : "请求 app-server 时发生错误，可展开技术详情排查。"}
          </p>
          <details className="pm-error-detail">
            <summary>技术详情</summary>
            <pre>{err.message}</pre>
          </details>
          <div className="pm-state-actions">
            <button type="button" className="secondary-btn-sm" onClick={onRetry}>
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLoadingRow = (label: string) => (
    <div className="pm-loading-row">
      <Loader2 size={14} className="pm-spin" /> {label}
    </div>
  );

  const renderPluginDetail = (directory = false) => {
    if (detailLoading) return renderLoadingRow(manageOnly ? "正在加载插件设置…" : "正在读取插件详情…");
    if (detailError) {
      if (directory) return <div className="pm-state-body" role="alert"><h2>无法加载插件</h2><p>{errorSummary(detailError.message)}</p></div>;
      return (
        <div className="pm-state-body" role="alert">
          <h2>无法加载插件设置</h2>
          <span className="pm-state-desc">
            读取详情失败：{errorSummary(detailError.message)}
          </span>
          <div className="pm-state-actions">
            <button
              type="button"
              className="secondary-btn-sm"
              onClick={() => {
                const context = detailContextRef.current;
                if (context) {
                  handleToggleDetail(context.plugin, context.marketplace, {
                    reload: true,
                  });
                } else directoryDetailRetry.current?.();
              }}
            >
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        </div>
      );
    }
    if (!detail) return <div className="pm-state-body"><h2>未找到插件</h2>{directory && <p>无法从插件市场详情页加载此插件。</p>}</div>;
    return null;
  };

  const renderPluginCard = (
    plugin: PluginSummary,
    marketplace: PluginMarketplaceEntry,
    options: { browse?: boolean }
  ) => {
    const key = pluginKey(plugin, marketplace);
    const busy = busyPluginIds.has(pluginActionKey(plugin));
    const serviceOperation = remoteStatus(plugin);
    const installed = plugin.installed ||
      installedData?.marketplaces.some(market => market.plugins.some(item => item.id === plugin.id && item.installed));
    const installBlocked =
      plugin.availability === "DISABLED_BY_ADMIN" ||
      plugin.installPolicy === "NOT_AVAILABLE" ||
      installed || unconfirmedInstalls.has(plugin.id);
    if (!manageOnly) {
      const open = () => { void handleToggleDetail(plugin, marketplace); };
      return <div key={key} className="pm-catalog-card" role="button" tabIndex={0}
        aria-label={pluginDisplayName(plugin)} onClick={open} onKeyDown={event => {
          if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        }}>
        <PluginLogo plugin={plugin} className="pm-catalog-logo" />
        <div className="pm-catalog-copy"><strong>{pluginDisplayName(plugin)}</strong>
          <p title={pluginDescription(plugin)}>{pluginDescription(plugin)}</p></div>
        {installed ? <button type="button" className="pm-catalog-action" aria-label={`管理 ${pluginDisplayName(plugin)}`}
          onClick={event => { event.stopPropagation(); onManagePlugins ? onManagePlugins() : open(); }}><CheckCircle2 size={18} /></button>
          : <button type="button" className="pm-catalog-action" aria-label={`安装 ${pluginDisplayName(plugin)}`}
            disabled={busy || installBlocked} onClick={event => { event.stopPropagation(); void handleInstallPlugin(plugin, marketplace); }}>
            {busy ? <Loader2 size={18} className="pm-spin" /> : <Download size={18} />}</button>}
      </div>;
    }
    return <div className="pm-managed-plugin-row" key={key}>
  <button type="button" className="pm-managed-plugin-open" aria-label={`查看 ${pluginDisplayName(plugin)} 详情`}
    onClick={() => void handleToggleDetail(plugin, marketplace)}>
    <PluginLogo plugin={plugin} className="pm-managed-plugin-logo" />
    <span className="pm-managed-plugin-copy"><strong>{pluginDisplayName(plugin)}</strong>
      <span className="pm-managed-plugin-description" title={pluginDescription(plugin)}>{pluginDescription(plugin)}</span>
    </span>
  </button>
  <div className="pm-managed-plugin-action">
    {installed ? <button type="button" className={`pm-skill-toggle ${plugin.enabled ? "on" : ""}`}
      role="switch" aria-checked={plugin.enabled} aria-label={`${pluginDisplayName(plugin)} 启用`}
      disabled={busy || !!pluginUpdates[plugin.id]?.pending || plugin.availability === "DISABLED_BY_ADMIN" ||
        isServicePlugin(plugin) && (!remoteAvailable(plugin) || !!serviceOperation?.pending || !!serviceOperation?.busy)}
      title={isServicePlugin(plugin) && !remoteAvailable(plugin) ? "尚未取得当前账号的完整插件状态" : plugin.availability === "DISABLED_BY_ADMIN" ? "管理员已禁用" : undefined}
      onClick={event => { event.stopPropagation(); void handleTogglePlugin(plugin); }} />
      : <button type="button" className="secondary-btn-sm" disabled={busy || installBlocked}
        aria-label={`安装 ${pluginDisplayName(plugin)}`} onClick={() => void handleInstallPlugin(plugin, marketplace)}>
        {busy ? <Loader2 size={14} className="pm-spin" /> : <Download size={14} />}
      </button>}
  </div>
  <button type="button" className="pm-managed-plugin-chevron" aria-label={`打开 ${pluginDisplayName(plugin)} 详情`}
    onClick={() => void handleToggleDetail(plugin, marketplace)}><ChevronRight size={16} /></button>
  {isServicePlugin(plugin) && plugin.remotePolicyKnown === false && <p className="pm-managed-plugin-status" role="alert">无法识别此插件的服务策略，暂不能变更。</p>}
  {isServicePlugin(plugin) && serviceOperation && <div className="pm-managed-plugin-status" role="status">
    {serviceOperation.pending && <p>远程操作结果待核验</p>}
    {serviceOperation.error && <p role="alert">{serviceOperation.error}</p>}
    {serviceOperation.pending && <button type="button" className="secondary-btn-sm" disabled={busy || serviceOperation.busy || serviceLoading}
      onClick={() => handleRemotePlugin(plugin, serviceOperation.operation, true)}>核验远程操作结果</button>}
  </div>}
  {pluginUpdates[plugin.id] && <div className="pm-managed-plugin-status" role="status">
    {pluginUpdates[plugin.id].pending && <p>启禁结果待核验；核验只读取状态，不重复提交。</p>}
    {pluginUpdates[plugin.id].error && <p role="alert">{pluginUpdates[plugin.id].error}</p>}
    {pluginUpdates[plugin.id].refreshError && <p role="alert">{pluginUpdates[plugin.id].refreshError}</p>}
    {(pluginUpdates[plugin.id].pending || pluginUpdates[plugin.id].refreshError) && <button type="button" disabled={busy}
      onClick={() => verifyPluginUpdate(plugin)}>重新核验并刷新技能</button>}
  </div>}
</div>;
  };

  const renderMarketplaceGroups = (
    groups: { marketplace: PluginMarketplaceEntry; plugins: PluginSummary[] }[],
    options: { browse?: boolean } = {}
  ) => manageOnly ? <div className="pm-managed-plugin-list">
    {groups.flatMap(({ marketplace, plugins }) => plugins.map(plugin => renderPluginCard(plugin, marketplace, options)))}
  </div> : (
    <div className="pm-stack">
      {groups.map(({ marketplace, plugins }) => (
        <section className="pm-market-group" key={marketplace.name}>
          <header className="pm-market-header">
            <Package size={14} className="accent-icon" />
            <strong>{marketplaceDisplayName(marketplace)}</strong>
            <span className="tag-badge">{marketplace.name}</span>
            <span className="tag-badge">{marketplaceSourceLabel(marketplace)}</span>
            <span
              className="pm-mp-path pm-mono"
              title={marketplace.path || "远程目录"}
            >
              {marketplace.path || "远程目录（无本地路径）"}
            </span>
            <span className="pm-count-badge">
              {plugins.length}/{marketplace.plugins?.length ?? 0}
            </span>
          </header>
          <div className="item-cards-list">
            {plugins.map((plugin) => renderPluginCard(plugin, marketplace, options))}
          </div>
        </section>
      ))}
    </div>
  );

  const renderAppsError = () => {
    if (!appsError) return null;
    const authGate =
      appsError.kind === "forbidden" || appsError.kind === "auth";
    const offline =
      appsError.kind === "not-connected" || appsError.kind === "network";
    const title = authGate
      ? "无法读取应用目录（需要 ChatGPT 账号连接）"
      : offline
        ? "无法连接应用服务"
        : "读取应用目录失败";
    const description = authGate
      ? "app/list 请求被拒绝（403 Forbidden / 未授权）。应用连接器目录需要已登录的 ChatGPT 账号与可用的网络访问；下方为本地已安装连接器快照，可继续查看。"
      : offline
        ? "无法连接 Codex app-server，请确认应用已启动后重试。"
        : "请求 app-server 时发生错误，可展开技术详情排查。";
    return (
      <div className={`pm-state-panel ${authGate || offline ? "pm-state-warn" : "pm-state-error"}`}>
        <div className="pm-state-icon">
          {authGate ? (
            <Lock size={16} />
          ) : offline ? (
            <WifiOff size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
        </div>
        <div className="pm-state-body">
          <span className="pm-state-title">{title}</span>
          <p className="pm-state-desc">{description}</p>
          <details className="pm-error-detail">
            <summary>技术详情</summary>
            <pre>{appsError.message}</pre>
          </details>
          <div className="pm-state-actions">
            <button
              type="button"
              className="primary-btn-sm"
              onClick={() => loadApps(true)}
              disabled={appsLoading}
            >
              {appsLoading ? (
                <Loader2 size={13} className="pm-spin" />
              ) : (
                <RefreshCw size={13} />
              )}{" "}
              重试 app/list
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDirectoryListing = (listing: PluginDirectoryListing) => {
    const state = directoryPluginInstallation(listing.id, installedData === null ? null : mergedInstalledData, browseData);
    const busy = directoryResolving.has(listing.id) || busyPluginIds.has(listing.id);
    const open = () => void resolveDirectoryListing(listing.id, false);
    return <div key={listing.id} className="pm-catalog-card" role="button" tabIndex={0} aria-label={listing.displayName}
      onClick={open} onKeyDown={event => {
        if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
      }}>
      <PluginLogo plugin={{ id: listing.id, interface: { logoUrl: listing.iconUrl, logoUrlDark: listing.iconUrlDark } }} className="pm-catalog-logo" />
      <div className="pm-catalog-copy"><strong>{listing.displayName}</strong><p title={listing.description ?? ""}>{listing.description}</p></div>
      {state.installed === undefined ? <span role="status" aria-label="正在读取安装状态"><Loader2 size={18} className="pm-spin" /></span>
        : state.installed ? <button type="button" className="pm-catalog-action" aria-label={`管理 ${listing.displayName}`}
          onClick={event => { event.stopPropagation(); onManagePlugins ? onManagePlugins() : open(); }}><CheckCircle2 size={18} /></button>
        : <button type="button" className="pm-catalog-action" aria-label={`安装 ${listing.displayName}`}
          disabled={busy || listing.installationPolicy === "NOT_AVAILABLE" || !!listing.disabledReason || unconfirmedInstalls.has(listing.id)}
          onClick={event => { event.stopPropagation(); void resolveDirectoryListing(listing.id, true); }}>
          {busy ? <Loader2 size={18} className="pm-spin" /> : <Download size={18} />}</button>}
    </div>;
  };
  const searchRows = directorySearch.result?.data ?? [];
  const fallbackSearchRows = directorySearch.unsupported && searchFallback && installedData ?
    [...new Map([...installedData.marketplaces, ...searchFallback.marketplaces].flatMap(marketplace => marketplace.plugins
      .filter(pluginMatchesSearch).map(plugin => [pluginKey(plugin, marketplace), { plugin, marketplace }] as const))).values()] : [];

  const isBrowseBusy = browseLoading && browseData === null;
  const isInstalledBusy = installedLoading && installedData === null;
  const catalogSections = new Map<string, { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }[]>();
  for (const group of visibleBrowseGroups) for (const plugin of group.plugins) {
    const category = pluginCategory(plugin) || "插件";
    const entries = catalogSections.get(category) ?? [];
    entries.push({ plugin, marketplace: group.marketplace });
    catalogSections.set(category, entries);
  }
  const directoryInstalled = mergedMarketplaces.flatMap(marketplace => marketplace.plugins
    .filter(plugin => plugin.installed).map(plugin => ({ plugin, marketplace })));
  const directoryDetailPlugin = detail?.summary ?? detailContextRef.current?.plugin;
  const directoryDetailInstalled = directoryDetailPlugin && (directoryDetailPlugin.installed ||
    directoryInstalled.some(({ plugin }) => plugin.id === directoryDetailPlugin.id));
  const activateDirectoryPrompt = async (text: string): Promise<boolean> => {
    if (!detail || detailLoading || detailError || !onTryPlugin || unsupportedDirectoryHost()) return false;
    const context = pluginContextRef.current, request = detailRequestRef.current;
    const isCurrent = () => isPluginContextCurrent(context) && request === detailRequestRef.current;
    if (!detail.summary.interface?.defaultPrompt?.some(prompt => prompt.trim() === text)) return false;
    let plugin = directoryInstalled.find(item => item.plugin.id === detail.summary.id)?.plugin ?? detail.summary;
    if (plugin.availability === "DISABLED_BY_ADMIN" || plugin.installPolicy === "NOT_AVAILABLE" ||
        installUncertaintyRef.current.get(installScope)?.has(plugin.id)) return false;
    if (!plugin.installed) {
      const marketplace = detailContextRef.current?.marketplace;
      if (!marketplace) return false;
      const installed = await handleInstallPlugin(plugin, marketplace);
      if (!isCurrent()) return false;
      if (!installed) throw new Error("安装或应用连接尚未确认，请先完成连接准备并刷新状态。");
      plugin = installed;
    }
    const preparation = pluginPreparations[plugin.id]?.result;
    if (preparation?.authPolicy === "ON_INSTALL" && preparation.appsNeedingAuth.length) {
      throw new Error("应用授权尚未确认，请先完成连接准备。");
    }
    if (!plugin.enabled) {
      const enabled = await handleTogglePlugin(plugin);
      if (!isCurrent()) return false;
      if (!enabled?.enabled) throw new Error("插件启用尚未确认，请刷新状态后重试。");
      plugin = enabled;
    }
    return isCurrent() ? onTryPlugin(plugin, text) : false;
  };

  const renderIncludedPluginContents = (presentation: "directory" | "settings") => detail ? <PluginDirectoryIncluded presentation={presentation} detail={detail} installedSkills={remoteSkills}
            connectionIdentity={connectionIdentity} workspaceRoot={activeWorkspaceRoot}
            skillBusy={skillWriteBusy || !!skillToggleBusy}
            onOpenMcpSettings={onOpenPluginSettings ? () => onOpenPluginSettings("connections") : undefined}
            onOpenHooksSettings={onOpenPluginSettings ? () => onOpenPluginSettings("hooks-settings") : undefined}
            onOpenSkillFile={onOpenSkillFile}
            onTrySkill={onTrySkill ? skill => onTrySkill({ name: skill.name, path: skill.path, defaultPrompt: skill.interface?.defaultPrompt }) : undefined}
            onToggleSkill={skill => { void handleToggleSkill({ key: skill.path, name: skill.name,
              description: skill.description, scope: skill.scope, enabled: skill.enabled,
              pluginId: skill.pluginId, local: null, remote: skill }); }}
            loadSkillContents={async (skill, installed) => {
              const path = installed?.path || skill.path;
              if (path) return readFileText(path);
              const id = remoteId(detail.summary);
              if (!id || !detail.marketplaceName) throw new Error("此技能没有可确认的读取来源");
              const result = await callAppServer<{ contents: string }>("plugin/skill/read", {
                remotePluginId: id, remoteMarketplaceName: detail.marketplaceName, skillName: skill.name,
              });
              if (typeof result.contents !== "string") throw new Error("服务未返回技能内容");
              return result.contents;
            }} /> : null;

  const managementDetailPlugin = detail ? directoryPluginInstallation(remoteId(detail.summary) ?? detail.summary.id, mergedInstalledData).plugin : null;
  const managementVerificationPlugin = managementDetailPlugin ?? detailContextRef.current?.plugin;

  if (manageOnly && directoryHostUnsupported) return <div className="pm-state-body" role="alert">当前管理入口尚不支持此主机。</div>;

  return (
    <div ref={pageRef} className={`panel-page pm-extensions-page ${manageOnly ? "pm-management-page" : "pm-directory-page"}`}>
      {manageOnly && detailKey !== null && <section className="pm-managed-detail" aria-label="插件管理详情">
        {detail && !detailLoading && !detailError ? <PluginManagementDetail
          key={JSON.stringify([installScope, detail.marketplaceName, detail.marketplacePath, detail.summary.id])}
          identity={JSON.stringify([installScope, detail.marketplaceName, detail.marketplacePath, detail.summary.id])}
          detail={detail} onBack={() => closeManagedDetail()}
          onViewDetails={onOpenPluginDirectoryDetail && window.location && parsePluginManagementLocation(window.location.href)?.hostId === "local" &&
            (detail.marketplacePath || detail.summary.remotePluginId) ? () => onOpenPluginDirectoryDetail(detail) : undefined}
          actions={<>
          {managementDetailPlugin?.installed && <button type="button" className="secondary-btn-sm"
            disabled={busyPluginIds.has(pluginActionKey(managementDetailPlugin)) || unconfirmedUninstalls.has(managementDetailPlugin.id) ||
              managementDetailPlugin.installPolicy === "INSTALLED_BY_DEFAULT" && (managementDetailPlugin.source.type === "remote" || isServicePlugin(managementDetailPlugin)) ||
              isServicePlugin(managementDetailPlugin) && (!remoteAvailable(managementDetailPlugin) || !!remoteStatus(managementDetailPlugin)?.pending || !!remoteStatus(managementDetailPlugin)?.busy)}
            title={managementDetailPlugin.installPolicy === "INSTALLED_BY_DEFAULT" && (managementDetailPlugin.source.type === "remote" || isServicePlugin(managementDetailPlugin)) ? "由管理员安装" : undefined}
            onClick={() => void handleUninstallPlugin(managementDetailPlugin)}>卸载</button>}
          {managementVerificationPlugin && unconfirmedUninstalls.has(managementVerificationPlugin.id) && <button type="button" className="secondary-btn-sm"
            disabled={busyPluginIds.has(managementVerificationPlugin.id)} onClick={() => void verifyUninstalledPlugin(managementVerificationPlugin, detailRequestRef.current, true)}>核验卸载结果</button>}
          </>}>
          {renderIncludedPluginContents("settings")}
        </PluginManagementDetail> : <>
          <button type="button" className="pm-catalog-back" onClick={() => closeManagedDetail()}>插件设置</button>
          {renderPluginDetail()}
        </>}
      </section>}
      {(!manageOnly && (subTab !== "plugins" || detailKey === null) || manageOnly && detailKey === null) && <div className="panel-page-header">
        <div>
          <h2>{manageOnly ? "插件" : subTab === "skills" ? "技能" : "插件"}</h2>
          <p className="subtitle">
            {manageOnly ? "管理插件、技能和 MCP" : subTab === "skills" ? "通过任务专用技能扩展 Codex" : "连接插件，让 Codex 在你的各类工具中协同工作"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!manageOnly && <input
            ref={directorySearchRef}
            id={!manageOnly && subTab === "plugins" ? "plugins-store-page-search" : undefined}
            autoFocus={!manageOnly && subTab === "plugins"}
            type="text"
            className="hub-search-input"
            aria-label={manageOnly ? "搜索插件、技能或 MCP" : subTab === "skills" ? "搜索技能" : "搜索插件"}
            placeholder={manageOnly ? "搜索插件、技能或 MCP..." : subTab === "skills" ? "搜索技能" : "搜索插件"}
            value={searchQuery}
            onChange={(e) => {
              if (!manageOnly && subTab === "plugins") updateDirectoryUrl(pluginDirectoryBrowseUrl(directoryBase(), { search: e.target.value }), !!searchQuery);
              setSearchQuery(e.target.value); setSkillSearchIndex(0);
            }}
            onKeyDown={handleSkillSearchKey}
          />}
          {!manageOnly && subTab === "plugins" && onManagePlugins && (
            <button type="button" className="secondary-btn" onClick={onManagePlugins}>管理</button>
          )}
          {manageOnly && onBrowseDirectory && (
            <button type="button" className="secondary-btn" onClick={() => onBrowseDirectory("plugins")}>
              浏览目录
            </button>
          )}
          {manageOnly && <PluginManagementActions
            onAddMarketplace={showNonMcpTabs ? () => setShowAddMarketplace(true) : undefined}
            onAddMcp={() => selectTab("mcp", () => setMcpCreateRequest(value => value + 1))} />}
          {!manageOnly && <button type="button" className="secondary-btn" onClick={() => refreshAll()}>
            <RefreshCw size={14} /> 刷新
          </button>}
        </div>
      </div>}

      <AddPluginMarketplaceDialog open={showAddMarketplace} onOpenChange={setShowAddMarketplace}
        onAdd={handleAddMarketplace} contextKey={installScope} />

      <dialog ref={removalDialog} className="pm-removal-dialog" aria-labelledby="pm-remove-market-title"
        onCancel={event => { event.preventDefault(); closeRemoval(); }}>
        <h3 id="pm-remove-market-title">移除市场{removal.target ? `「${marketplaceDisplayName(removal.target)}」` : ""}</h3>
        {!removal.plan && removal.busy && <p role="status">正在完整读取该市场的已安装插件…</p>}
        {removal.plan && <>
          <p>先卸载该市场的全部已安装插件，再移除市场。关闭不会撤销已完成的卸载。</p>
          <p role="status">已卸载 {removal.plan.completedIds.length} / {removal.plan.plugins.length}</p>
          <ul>{removal.plan.plugins.map(plugin => <li key={plugin.id}>{pluginDisplayName(plugin)}{removal.plan?.completedIds.includes(plugin.id) ? "：已卸载" : ""}</li>)}</ul>
          {(removal.plan.pendingPluginId || removal.plan.removePending) && <p>上次操作结果待核验；重试会先读取实际结果。</p>}
          {removal.plan.removed && <p role="status">市场已移除</p>}
        </>}
        {removal.error && <p role="alert">{removal.error}</p>}
        <div className="pm-form-actions">
          {removal.plan && !removal.plan.removed && <button type="button" className="danger-btn-sm" disabled={removal.busy} onClick={() => removal.confirm()}>
            {removal.busy ? "正在移除…" : removal.error ? "重试剩余操作" : "卸载插件并移除市场"}</button>}
          {!removal.plan && removal.target && removal.error && <button type="button" disabled={removal.busy} onClick={() => removal.open(removal.target!)}>重新读取插件</button>}
          <button type="button" className="secondary-btn-sm" onClick={closeRemoval}>关闭</button>
        </div>
      </dialog>

      {toast && (
        <div
          className={`workbench-toast-banner ${
            toast.kind === "error" ? "pm-toast-error" : ""
          }`}
        >
          {toast.text}
        </div>
      )}
      {runtimeWarning && <div role="alert" className="pm-result-panel pm-result-warn">{runtimeWarning} <button type="button" className="secondary-btn-sm" onClick={refreshRemoteRuntime}>重新刷新运行时</button></div>}
      {subTab === "plugins" && Object.entries(pluginPreparations).map(([id, preparation]) =>
        !busyPluginIds.has(id) && <PluginPreparationPanel
          key={`${activeWorkspaceRoot}:${id}:${preparation.attempt}`}
          name={preparation.name}
          result={preparation.result}
          onRefresh={async () => {
            const context = pluginContextRef.current;
            await loadInstalledPlugins({ silent: true, confirmInstallResult: true });
            if (!isPluginContextCurrent(context)) return;
            resetBrowseCache();
            if (pluginMode === "browse") await loadBrowsePlugins(true);
            if (isPluginContextCurrent(context)) await loadRemoteSkills(true);
          }}
        />
      )}
      {subTab === "plugins" && unconfirmedInstalls.size > 0 && <p role="alert">
        部分插件的安装结果尚未确认，请刷新安装状态后再重试。
        {manageOnly && <button type="button" onClick={() => refreshAll()}>刷新安装状态</button>}
      </p>}

      {manageOnly ? detailKey === null && <PluginManagementToolbar
        tabs={visibleManagementTabs.map(id => ({ id, label: tabLabels[id], count: tabCounts[id] }))}
        selected={subTab} onSelect={selectTab} query={searchQuery}
        onQueryChange={value => { setSearchQuery(value); setSkillSearchIndex(0); }} />
      : (subTab !== "plugins" || detailKey === null) && <div className="sub-tabs" role="tablist" aria-label="管理扩展程序" style={{ marginBottom: 16 }}>
        {(["plugins", "skills"] as SubTab[]).map(tab =>
          <button key={tab} type="button" role="tab" aria-selected={subTab === tab}
            className={`sub-tab ${subTab === tab ? "active" : ""}`} onClick={() => selectTab(tab)}>
            <span>{tabLabels[tab]} ({tabCounts[tab]})</span>
          </button>)}
      </div>}
      {managementError && <p role="alert">管理信息读取失败：{managementError} <button type="button" onClick={loadManagement}>重试</button></p>}
      {manageOnly && managementRecommendedError && <p role="alert">推荐技能目录读取失败：{managementRecommendedError} <button type="button" onClick={loadManagementRecommended}>重试</button></p>}

      {/* TAB 1: PLUGINS */}
      {subTab === "plugins" && !manageOnly && (directoryHostUnsupported ? <p role="alert">当前入口尚不支持该主机。</p> : detailKey !== null ? <section className="pm-catalog-detail">
        <button type="button" className="pm-catalog-back" onClick={() => {
          updateDirectoryUrl(pluginDirectoryBrowseUrl(directoryBase()));
          ++detailRequestRef.current;
          detailContextRef.current = null;
          setDetailKey(null); setDetail(null); setDetailError(null); setDetailLoading(false);
          requestAnimationFrame(() => directorySearchRef.current?.focus());
        }}><ChevronLeft size={16} />插件</button>
        {detail && !detailLoading && !detailError ? <PluginDirectoryDetail
          key={JSON.stringify([activeWorkspaceRoot, connectionIdentity, detailKey])}
          detail={detail}
          apps={appsData ?? undefined}
          onActivatePrompt={onTryPlugin ? activateDirectoryPrompt : undefined}
          promptDisabledReason={detail.summary.availability === "DISABLED_BY_ADMIN" ? "管理员已禁用此插件" :
            detail.summary.installPolicy === "NOT_AVAILABLE" ? "此插件当前不可用" :
              busyPluginIds.has(pluginActionKey(detail.summary)) || unconfirmedInstalls.has(detail.summary.id) ? "请先确认插件状态" : undefined}
          actions={directoryDetailPlugin && (directoryDetailInstalled
            ? <button type="button" className="secondary-btn" onClick={onManagePlugins} disabled={!onManagePlugins}>管理</button>
            : <button type="button" className="primary-btn" disabled={!detail || detailLoading || !!detailError ||
                busyPluginIds.has(pluginActionKey(directoryDetailPlugin)) || unconfirmedInstalls.has(directoryDetailPlugin.id) ||
                directoryDetailPlugin.installPolicy === "NOT_AVAILABLE" || directoryDetailPlugin.availability === "DISABLED_BY_ADMIN"}
              onClick={() => { const context = detailContextRef.current; if (context) void handleInstallPlugin(directoryDetailPlugin, context.marketplace); }}>安装</button>)}
          included={renderIncludedPluginContents("directory")}
        /> : renderPluginDetail(true)}
      </section> : <div className="pm-catalog">
        {!searchQuery.trim() && !directoryCategory && <PluginInstalledStrip
          key={JSON.stringify([activeWorkspaceRoot, connectionIdentity])}
          items={directoryInstalled.map(({ plugin, marketplace }) => ({ key: pluginKey(plugin, marketplace), plugin,
            href: pluginDirectoryDetailUrl(directoryBase(), { pluginId: plugin.id,
              pluginName: marketplace.path ? plugin.name : plugin.remotePluginId ?? plugin.name,
              marketplacePath: marketplace.path, remoteMarketplaceName: marketplace.path ? null : marketplace.name }) }))}
          loading={installedLoading && installedData === null}
          error={installedError ? errorSummary(installedError.message) : null}
          onManage={onManagePlugins}
          onOpen={(item, event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const actual = directoryInstalled.find(({ plugin, marketplace }) => pluginKey(plugin, marketplace) === item.key);
            if (!actual) return;
            event.preventDefault();
            void handleToggleDetail(actual.plugin, actual.marketplace);
          }} />}
        <PluginDirectoryOriginsView tab={directoryTab}
          enabled={!searchQuery.trim() && !directoryHostUnsupported}
          contextKey={JSON.stringify([activeWorkspaceRoot, connectionIdentity, directoryRefreshRevision])}
          category={directoryCategory}
          onTabChange={tab => { setDirectoryTab(tab); updateDirectoryUrl(pluginDirectoryTabUrl(directoryBase(), tab)); }}
          onCategory={category => { setDirectoryCategory(category); updateDirectoryUrl(pluginDirectoryCategoryUrl(directoryBase(), category)); }}
          renderListing={renderDirectoryListing}
          localLoading={localDirectoryLoading}
          localError={localDirectoryError}
          onRetryLocal={() => setLocalDirectoryRevision(value => value + 1)}
          localGroups={[
            ...(localDirectoryGroups?.created.length ? [{ id: "plugins-created-by-you", title: "由你创建",
              count: localDirectoryGroups.created.length,
              content: localDirectoryGroups.created.map(({ plugin, marketplace }) => renderPluginCard(plugin, marketplace, { browse: true })),
              summaryContent: localDirectoryGroups.created.slice(0, 6).map(({ plugin, marketplace }) => renderPluginCard(plugin, marketplace, { browse: true })),
            }] : []),
            ...(localDirectoryGroups?.marketplaces.map(group => ({ id: group.id, title: group.title, count: group.items.length,
              content: group.items.map(({ plugin, marketplace }) => renderPluginCard(plugin, marketplace, { browse: true })),
              summaryContent: group.items.slice(0, 6).map(({ plugin, marketplace }) => renderPluginCard(plugin, marketplace, { browse: true })),
            })) ?? []),
          ]}>
        {isBrowseBusy && renderLoadingRow("正在加载插件目录…")}
        {browseError && renderLoadError(browseError, "插件目录", () => loadBrowsePlugins(true))}
        {(searchQuery.trim() || directoryCategory) && installedError && renderLoadError(installedError, "已安装插件", () => loadInstalledPlugins({ confirmInstallResult: true }))}
        {!searchQuery.trim() && !directoryCategory && directorySource?.kind === "requires-chatgpt" && <p role="status">插件目录需要登录 ChatGPT。</p>}
        {directoryCategory && directorySource?.kind === "remote" ? <section className="pm-catalog-section">
          <button type="button" className="pm-catalog-back" onClick={() => { setDirectoryCategory(null); updateDirectoryUrl(pluginDirectoryCategoryUrl(directoryBase(), null)); }}>全部插件</button>
          <h3>{directorySource.sections.find(section => section.slug === directoryCategory)?.title ?? directoryCategory}</h3>
          <div className="pm-catalog-grid">{categoryRows.map(renderDirectoryListing)}</div>
          {categoryLoading && renderLoadingRow("正在加载插件…")}
          {categoryError && <p role="alert">{categoryError} <button type="button" onClick={() => void loadCategory(categoryRows.length ? categoryCursor : null)}>重试</button></p>}
          {!categoryLoading && !categoryError && categoryRows.length === 0 && <p className="empty-hint">未找到插件</p>}
          {categoryCursor && <button type="button" className="secondary-btn" disabled={categoryLoading} onClick={() => void loadCategory(categoryCursor)}>显示更多</button>}
        </section> : searchQuery.trim() ? <section className="pm-catalog-section">
          {directorySearch.loading && renderLoadingRow("正在搜索插件…")}
          {directorySearch.error && !directorySearch.unsupported && <p role="alert">{directorySearch.error} <button type="button" onClick={directorySearch.retry}>重试</button></p>}
          {directorySearch.unsupported && !searchFallback && !searchFallbackError && renderLoadingRow("正在读取本地插件…")}
          {searchFallbackError && <p role="alert">{searchFallbackError} <button type="button" onClick={directorySearch.retry}>重试</button></p>}
          <div className="pm-catalog-grid">{directorySearch.unsupported ? fallbackSearchRows.map(({ plugin, marketplace }) => renderPluginCard(plugin, marketplace, { browse: true }))
            : searchRows.map(row => renderPluginCard(row.plugin, { name: row.marketplaceName, path: row.marketplacePath, plugins: [row.plugin] }, { browse: true }))}</div>
          {!directorySearch.loading && !directorySearch.error && searchRows.length === 0 && <p className="empty-hint">未找到插件</p>}
          {directorySearch.unsupported && searchFallback && installedData && !fallbackSearchRows.length && <p className="empty-hint">未找到插件</p>}
          {directorySearch.pageError && <p role="alert">{directorySearch.pageError} <button type="button" onClick={directorySearch.nextCursor ? directorySearch.loadMore : directorySearch.retry}>重试</button></p>}
          {directorySearch.nextCursor && <button type="button" className="secondary-btn" disabled={directorySearch.paging} onClick={directorySearch.loadMore}>显示更多</button>}
        </section> : directorySource?.kind === "remote" ? directorySource.sections.map((section, index) => <section key={section.id ?? section.slug ?? index} className="pm-catalog-section">
          <header><h3>{section.title}</h3>{section.slug && <button type="button" className="pm-catalog-action" onClick={() => {
            setDirectoryCategory(section.slug); updateDirectoryUrl(pluginDirectoryCategoryUrl(directoryBase(), section.slug));
          }}>查看更多</button>}</header><div className="pm-catalog-grid">{section.plugins.slice(0, 6).map(renderDirectoryListing)}</div>
        </section>) : <>
          {browseData && !browseError && matchingBrowseCount === 0 && <p className="empty-hint">没有可用的插件</p>}
          {[...catalogSections].map(([category, entries]) => <section key={category} className="pm-catalog-section">
            <h3>{category}</h3><div className="pm-catalog-grid">{entries.map(({ plugin, marketplace }) => renderPluginCard(plugin, marketplace, { browse: true }))}</div>
          </section>)}
          {browseVisibleCount < matchingBrowseCount && <button type="button" className="secondary-btn" onClick={() => setBrowseVisibleCount(count => count + 50)}>显示更多</button>}
        </>}

        </PluginDirectoryOriginsView>
      </div>)}
      {subTab === "plugins" && manageOnly && detailKey === null && (
        <div className="pm-stack">


          {marketplaceLoadErrors.length > 0 && (
            <div className="pm-result-panel pm-result-warn">
              <div className="pm-result-title">
                <AlertTriangle size={14} /> 部分市场加载失败（
                {marketplaceLoadErrors.length}）
              </div>
              <ul>
                {marketplaceLoadErrors.map((loadError, index) => (
                  <li key={`${loadError.marketplacePath}-${index}`}>
                    <code className="pm-mono">{loadError.marketplacePath}</code>：
                    {loadError.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pluginMode === "installed" && (
            <>
              {serviceLoading && renderLoadingRow("正在读取账号插件…")}
              {serviceError && <div role="alert">账号插件读取失败：{serviceError} <button type="button" className="secondary-btn-sm" onClick={loadServicePlugins}>重试账号插件</button></div>}
              {servicePlugins?.unsupported && <p>当前账号环境未提供远程插件服务。</p>}
              {isInstalledBusy && renderLoadingRow("正在读取本机插件…")}
              {!installedLoading && !installedError && !installedData &&
                renderLoadingRow("准备读取已安装插件…")}
              {!isInstalledBusy && installedError &&
                renderLoadError(installedError, "本机插件", () => loadInstalledPlugins({ confirmInstallResult: true }))}
              {(installedData || servicePlugins?.marketplace) && (
                installedCount === 0 ? (!installedError && !serviceError && !installedLoading && !serviceLoading && (
                  <div className="empty-hint">
                    未发现已安装插件。切换到「浏览市场」查看本地市场中的可安装插件。
                  </div>
                )) : installedGroups.length === 0 ? (
                  <div className="empty-hint">
                    没有匹配「{searchQuery}」的已安装插件。
                  </div>
                ) : (
                  renderMarketplaceGroups(installedGroups)
                )
              )}
            </>
          )}

          {pluginMode === "browse" && (
            <>
              {isBrowseBusy && renderLoadingRow("正在加载插件目录…")}
              {!browseLoading && !browseError && !browseData &&
                renderLoadingRow("准备加载插件目录…")}
              {!isBrowseBusy && browseError &&
                renderLoadError(browseError, "市场目录", () => loadBrowsePlugins(true))}
              {!isBrowseBusy && !browseError && browseData && (
                browseCount === 0 ? (
                  <div className="empty-hint">
                    当前目录中没有可安装的插件。
                  </div>
                ) : browseGroups.length === 0 ? (
                  <div className="empty-hint">
                    没有匹配「{searchQuery}」的可安装插件。
                  </div>
                ) : (
                  <>
                    <p className="pm-hint">
                      共 {matchingBrowseCount} 个匹配插件，已显示 {Math.min(browseVisibleCount, matchingBrowseCount)} 个。
                    </p>
                    {renderMarketplaceGroups(visibleBrowseGroups, { browse: true })}
                    {browseVisibleCount < matchingBrowseCount && (
                      <button type="button" className="secondary-btn" onClick={() => setBrowseVisibleCount((count) => count + 50)}>
                        显示更多
                      </button>
                    )}
                  </>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: SKILLS (skills/list + skills/config/write, local fallback) */}
      {subTab === "skills" && <section className={searchingSkills ? "pm-skill-search-results" : "pm-skill-content"}
        aria-labelledby={searchingSkills && skillResultCount > 0 ? "pm-skill-results-title" : undefined}>
      {searchingSkills && skillResultCount > 0 && (
        <h3 id="pm-skill-results-title">技能 <span>{skillResultCount}</span></h3>
      )}
      {(!searchingSkills || visibleSkillRows.length > 0 || localSkillsError || remoteSkillsError || selectedSkillKey !== null || creatingSkill) && (
        <div className={`split-panel-layout pm-skills-layout ${!manageOnly && selectedSkillKey === null && !creatingSkill ? "pm-skills-overview" : ""}`}>
          <div className="split-left-list">
            {!searchingSkills && <div className="list-toolbar">
              <span>
                {skillRows.some(row => row.scope === "seed") ? "技能与本地模版" : "已安装"} ({skillRows.length})
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {remoteSkillsLoading && (
                  <Loader2 size={13} className="pm-spin" />
                )}
                <button
                  type="button"
                  className="mini-btn"
                  onClick={handleStartNewSkill}
                  title="新建本地自定义技能"
                >
                  <Plus size={12} /> 本地模版
                </button>
                {onStartSkillCreatorSession && (
                  <button
                    type="button"
                    className="mini-btn"
                    style={{
                      background: "rgba(16, 163, 127, 0.15)",
                      color: "#10a37f",
                      border: "1px solid rgba(16, 163, 127, 0.3)",
                    }}
                    onClick={() => onStartSkillCreatorSession("$skill-creator ")}
                    title="在会话中通过 $skill-creator 引导创建新技能"
                  >
                    <Sparkles size={12} /> $skill-creator 引导创建
                  </button>
                )}
              </div>
            </div>}
            {remoteSkillsError && (
              <div className="pm-hint" style={{ padding: "4px 2px" }}>
                <AlertCircle size={12} /> skills/list 不可用，已回退本地技能读取：
                {errorSummary(remoteSkillsError.message)}
              </div>
            )}
            {localSkillsError && (
              <div className="error-banner" role="alert">
                本地技能读取失败：{localSkillsError}
                <button type="button" className="secondary-btn-sm" onClick={() => refreshAll()}>重试</button>
              </div>
            )}
            <div className="scrollable-items pm-installed-skills-grid">
              {visibleSkillRows.map((row, index) => renderSkillRow(row, searchingSkills ? index === activeSkillSearchIndex : undefined))}
              {!searchingSkills && filteredSkillRows.length === 0 && (
                <div className="empty-hint">没有匹配的技能。</div>
              )}
            </div>
          </div>

          {(manageOnly || selectedSkillKey !== null || creatingSkill) && <div className="split-right-editor">
            <div className="editor-header-bar">
              <div className="form-field-inline">
                <label>技能 ID (`$skill`):</label>
                <input
                  type="text"
                  value={newSkillId}
                  onChange={(e) => {
                    ++skillEditorRevisionRef.current;
                    setNewSkillId(e.target.value);
                  }}
                  placeholder="skill-folder-name"
                  readOnly={readOnlyRemoteSkill !== null || selectedSkill?.installed === true}
                />
              </div>
              <div className="editor-actions">
                {(selectedSkill?.path || readOnlyRemoteSkill?.path) && (
                  <button
                    type="button"
                    className="secondary-btn-sm"
                    title="在系统文件管理器中打开技能目录"
                    onClick={() => {
                      const p = selectedSkill?.path || readOnlyRemoteSkill?.path;
                      if (p) tauriInvoke("reveal_path_in_explorer", { path: p });
                    }}
                  >
                    <FolderOpen size={13} /> 打开目录
                  </button>
                )}
                {selectedSkill && !selectedSkill.installed && (
                  <button
                    type="button"
                    className="primary-btn-sm"
                    disabled={skillWriteBusy}
                    onClick={() => handleInstallSeedSkill(selectedSkill)}
                  >
                    <Download size={13} /> 一键安装到 ~/.codex/skills
                  </button>
                )}
                <button
                  type="button"
                  className="primary-btn-sm"
                  onClick={handleSaveSkill}
                  disabled={
                    readOnlyRemoteSkill !== null ||
                    skillWriteBusy ||
                    !newSkillId.trim() ||
                    !skillContent.trim()
                  }
                >
                  <Save size={13} /> 保存 SKILL.md
                </button>
                {selectedSkill?.installed && (
                  <button
                    type="button"
                    className="danger-btn-sm"
                    disabled={skillWriteBusy}
                    onClick={() => handleDeleteSkill(selectedSkill)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
            {readOnlyRemoteSkill && (
              <div className="pm-skill-readonly-note">
                <Info size={13} /> 该技能由
                {readOnlyRemoteSkill.pluginId
                  ? `插件 ${readOnlyRemoteSkill.pluginId}`
                  : `${skillScopeLabel(readOnlyRemoteSkill.scope)} 作用域`}
                提供，仅支持启用/禁用；选择本地技能后可编辑内容。
              </div>
            )}
            {skillContentLoading && <div role="status">正在读取技能内容…</div>}
            {skillContentError && (
              <div className="error-banner" role="alert">
                技能内容读取失败：{skillContentError}
                <button type="button" className="secondary-btn-sm" onClick={() => {
                  if (skillSelectionRef.current) handleSelectSkillRow(skillSelectionRef.current);
                }}>重试</button>
              </div>
            )}
            <textarea
              className="code-editor-textarea"
              value={skillContent}
              onChange={(e) => {
                ++skillEditorRevisionRef.current;
                setSkillContent(e.target.value);
              }}
              readOnly={readOnlyRemoteSkill !== null}
              placeholder={
                readOnlyRemoteSkill
                  ? "该技能由 app-server 提供，内容不可在此编辑。"
                  : "编写 SKILL.md 内容..."
              }
            />
          </div>}
        </div>
      )}

      {!manageOnly && subTab === "skills" && skillPreview && previewRow && <SkillPreviewDialog
        key={skillPreview.identity} identity={skillPreview.identity}
        name={previewRow.name} rawName={previewRow.remote?.name ?? previewRow.local?.name ?? previewRow.name}
        description={previewRow.remote?.interface?.shortDescription?.trim() || previewRow.remote?.shortDescription?.trim() || previewRow.description}
        path={previewRow.remote?.path || previewRow.local?.path || ""}
        enabled={previewRow.enabled} busy={skillWriteBusy} localHost={true}
        canRetry={!!(previewRow.remote?.path || previewRow.local?.path)}
        actionFeedback={toast}
        loadContents={async () => {
          const path = previewRow.remote?.path || previewRow.local?.path;
          if (path) return readFileText(path);
          // Plugin IDs alone do not supply the official remote read identity.
          throw new Error("此技能没有可读取的内容路径");
        }}
        onClose={() => setSkillPreview(current => current === skillPreview ? null : current)}
        onToggle={previewRow.remote && previewRow.enabled !== undefined ? () => { void handleToggleSkill(previewRow); } : undefined}
        onOpen={onOpenSkillFile ? () => onOpenSkillFile(previewRow.remote?.path || previewRow.local?.path || "") : undefined}
        onTry={onTrySkill ? () => onTrySkill({
          name: previewRow.remote?.name ?? previewRow.local?.name ?? previewRow.name,
          path: previewRow.remote?.path || previewRow.local?.path || "",
          defaultPrompt: previewRow.remote?.interface?.defaultPrompt,
        }) : undefined}
        onUninstall={previewRow.scope !== "admin" && previewRow.local?.installed ? () => {
          void handleDeleteSkill(previewRow.local!, () => setSkillPreview(current => current === skillPreview ? null : current));
        } : undefined}
      />}

      {subTab === "skills" && !manageOnly && <RecommendedSkillsPanel key={JSON.stringify([activeWorkspaceRoot, connectionIdentity])}
        workspaceRoot={activeWorkspaceRoot} onInstalled={refreshRecommendedSkills} writeBusy={skillWriteBusy}
        searchQuery={searchQuery} onInstalledCardKeysChange={setRecommendedInstalledKeys}
        activeSearchResultIndex={activeSkillSearchIndex - visibleSkillRows.length}
        onSearchResultCountChange={setRecommendedSearch}
        installedSkills={skillRows.filter(row => row.remote !== null).map(row => ({
          key: row.key, name: row.remote?.name ?? row.local?.name ?? row.name,
          path: row.remote?.path || row.local?.path || "", displayName: row.remote?.interface?.displayName?.trim() || undefined, scope: row.scope,
        }))}
        renderInstalledSkill={(key, searchActive) => { const row = skillRows.find(item => item.key === key); return row ? renderSkillRow(row, searchActive) : null; }}
        beginInstall={() => {
          if (skillWritePendingRef.current) return false;
          skillWritePendingRef.current = true;
          setSkillWriteBusy(true);
          return true;
        }}
        finishInstall={() => {
          skillWritePendingRef.current = false;
          if (pluginMountedRef.current) setSkillWriteBusy(false);
        }} />}
      {searchingSkills && skillResultCount === 0 && recommendedSearchCount === 0 && !localSkillsError && !remoteSkillsError && (
        remoteSkillsLoading || remoteSkills === null ? <p role="status">正在加载技能…</p> : <p>找不到技能</p>
      )}
      </section>}

      {/* TAB 3: MCP SERVERS (unchanged behavior) */}
      {(manageOnly || subTab === "mcp") && <div hidden={subTab !== "mcp" || manageOnly && detailKey !== null}><McpSettings cwd={activeWorkspaceRoot || undefined} connectionIdentity={connectionIdentity}
        embedded={manageOnly} externalQuery={manageOnly ? searchQuery : undefined} createRequest={manageOnly ? mcpCreateRequest : undefined}
        onConfigUpdated={async () => { await onConfigUpdated?.(); await loadManagement(); }}
        onRestartAppServer={onRestartAppServer ?? (async () => { throw new Error("当前入口尚未连接应用服务重启操作"); })}
        onNavigationGuardChange={guard => { mcpNavigationGuard.current = guard; onNavigationGuardChange?.(guard); }} /></div>}

      {/* TAB 4: APP CONNECTORS (app/list + app/installed fallback) */}
      {subTab === "apps" && (
        <div className="pm-stack">
          <div className="pm-toolbar">
            <div>
              <h3 style={{ margin: 0 }}>
                应用连接器
                {appsData ? ` (${appsData.length})` : ""}
              </h3>
            </div>
            <div className="pm-toolbar-right">
              <button
                type="button"
                className="secondary-btn-sm"
                onClick={() => loadApps(true)}
                disabled={appsLoading}
              >
                {appsLoading ? (
                  <Loader2 size={13} className="pm-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}{" "}
                刷新
              </button>
            </div>
          </div>

          {appsLoading && renderLoadingRow("正在读取应用连接器（app/list）…")}
          {!appsLoading && !appsLoaded && renderLoadingRow("准备加载应用目录…")}
          {!appsLoading && appsLoaded && appsError && renderAppsError()}

          {!appsLoading && appsData && (
            appsData.length === 0 ? (
              <div className="empty-hint">应用目录为空（app/list 返回 0 项）。</div>
            ) : (
              <div className="pm-apps-grid">
                {(manageOnly ? appsData.filter(app => app.isAccessible === true) : appsData).map((app) => (
                  <div className="pm-app-card" key={app.id}>
                    <div className="pm-app-icon">
                      <AppWindow size={16} />
                    </div>
                    <div className="pm-app-main">
                      <div className="item-card-title-row">
                        <strong>{app.name}</strong>
                        {app.isEnabled === false ? (
                          <span className="tag-badge pm-badge-off">已禁用</span>
                        ) : (
                          <span className="tag-badge accent">可用</span>
                        )}
                        {app.isAccessible === false && (
                          <span className="tag-badge pm-badge-off">不可访问</span>
                        )}
                        {app.branding?.category && (
                          <span className="tag-badge">
                            {app.branding.category}
                          </span>
                        )}
                      </div>
                      <p className="pm-app-desc">
                        {app.description || "暂无描述"}
                      </p>
                      {(app.branding?.developer ||
                        (app.pluginDisplayNames?.length ?? 0) > 0) && (
                        <div className="item-card-meta">
                          {app.branding?.developer && (
                            <span>{app.branding.developer}</span>
                          )}
                          {(app.pluginDisplayNames?.length ?? 0) > 0 && (
                            <span>
                              关联插件：
                              {app.pluginDisplayNames!.join("、")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {!appsLoading && appsInstalled && appsInstalled.length > 0 && (
            <div className="pm-stack">
              <p className="pm-hint">
                <Info size={12} /> 以下为本地已安装连接器快照（app/installed，无需网络）：
                {appsInstalled.length} 项
              </p>
              <div className="pm-apps-grid">
                {(manageOnly ? appsInstalled.filter(app => app.callable) : appsInstalled).map((app) => (
                  <div className="pm-app-card" key={app.id}>
                    <div className="pm-app-icon">
                      <AppWindow size={16} />
                    </div>
                    <div className="pm-app-main">
                      <div className="item-card-title-row">
                        <strong>{app.runtimeName || app.id}</strong>
                        {app.enabled ? (
                          <span className="tag-badge accent">已启用</span>
                        ) : (
                          <span className="tag-badge pm-badge-off">已禁用</span>
                        )}
                        {app.callable && <span className="tag-badge">可调用</span>}
                      </div>
                      <div className="item-card-meta">
                        <span className="pm-mono">{app.id}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MARKETPLACES (marketplace/add · remove · upgrade) */}
      {subTab === "marketplaces" && (
        <div className="pm-stack">
          <div className="pm-toolbar">
            <div>
              <h3 style={{ margin: 0 }}>
                已配置的插件市场 ({manageableMarkets.length})
              </h3>
            </div>
            <div className="pm-toolbar-right">
              <button
                type="button"
                className="secondary-btn-sm"
                onClick={() => {
                  setShowAddMarketplace((visible) => !visible);
                  setMarketplaceActionError(null);
                }}
              >
                <Plus size={13} /> 添加市场
              </button>
              <button
                type="button"
                className="primary-btn-sm"
                onClick={() => handleUpgradeMarketplaces()}
                disabled={marketplaceBusy !== null || !configuredMarkets.some(item => item.canUpgrade)}
              >
                {marketplaceBusy === "upgrade" ? (
                  <Loader2 size={13} className="pm-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}{" "}
                全部升级
              </button>
            </div>
          </div>


          {marketplaceLoadErrors.length > 0 && (
            <div className="pm-result-panel pm-result-warn">
              <div className="pm-result-title">
                <AlertTriangle size={14} /> 部分市场加载失败（
                {marketplaceLoadErrors.length}）
              </div>
              <ul>
                {marketplaceLoadErrors.map((loadError, index) => (
                  <li key={`${loadError.marketplacePath}-${index}`}>
                    <code className="pm-mono">{loadError.marketplacePath}</code>：
                    {loadError.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {upgradeReport && (
            <div
              className={`pm-result-panel ${
                upgradeReport.errors.length > 0 ? "pm-result-warn" : ""
              }`}
            >
              <div className="pm-result-title">
                {upgradeReport.errors.length > 0 ? (
                  <AlertTriangle size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}{" "}
                升级结果：{upgradeReport.selectedMarketplaces.length} 个市场，
                {upgradeReport.upgradedRoots.length} 个目录已更新
              </div>
              {upgradeReport.errors.length > 0 && (
                <ul>
                  {upgradeReport.errors.map((upgradeError) => (
                    <li key={upgradeError.marketplaceName}>
                      <code>{upgradeError.marketplaceName}</code>：
                      {upgradeError.message}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="secondary-btn-sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setUpgradeReport(null)}
              >
                关闭
              </button>
            </div>
          )}

          {isInstalledBusy && renderLoadingRow("正在读取市场列表（plugin/installed）…")}
          {!isInstalledBusy && installedError &&
            renderLoadError(installedError, "插件市场", () => loadInstalledPlugins())}
          {!isInstalledBusy && !installedError && (
            manageableMarkets.length === 0 ? (
              <div className="empty-hint">
                尚未配置任何插件市场。可使用「添加市场」通过 marketplace/add 添加 Git
                仓库或本地市场目录。
              </div>
            ) : (
              <div className="pm-stack">
                {manageableMarkets.map((marketplace) => {
                  const counts = countMarketplacePlugins(marketplace);
                  const busy =
                    marketplaceBusy === marketplace.name ||
                    marketplaceBusy === "upgrade";
                  return (
                    <div className="pm-market-card" key={marketplace.name}>
                      <div className="pm-market-card-main">
                        <div className="pm-market-card-title">
                          <ShoppingBag size={14} className="accent-icon" />
                          <strong>{marketplaceDisplayName(marketplace)}</strong>
                          <span className="tag-badge">{marketplace.name}</span>
                          <span className="tag-badge">
                            {marketplaceSourceLabel(marketplace)}
                          </span>
                        </div>
                        <div className="pm-market-card-meta">
                          <span
                            className="pm-mono"
                            title={marketplace.path || "远程目录"}
                          >
                            {marketplace.path || "远程目录（无本地路径）"}
                          </span>
                          <span>
                            插件 {counts.total} · 已安装 {counts.installed} · 已启用{" "}
                            {counts.enabled}
                          </span>
                        </div>
                      </div>
                      <div className="pm-market-card-actions">
                        <button
                          type="button"
                          className="secondary-btn-sm"
                          disabled={busy || !configuredMarkets.find(item => item.marketplace.name === marketplace.name)?.canUpgrade}
                          onClick={() => handleUpgradeMarketplaces(marketplace.name)}
                        >
                          {marketplaceBusy === marketplace.name ? (
                            <Loader2 size={13} className="pm-spin" />
                          ) : (
                            <RefreshCw size={13} />
                          )}{" "}
                          升级
                        </button>
                        <button
                          type="button"
                          className="secondary-btn-sm"
                          disabled={busy || removal.busy || !!configuredMarkets.find(item => item.marketplace.name === marketplace.name)?.readOnlyReason}
                          title={configuredMarkets.find(item => item.marketplace.name === marketplace.name)?.readOnlyReason || undefined}
                          onClick={event => { removalTrigger.current = event.currentTarget; handleRemoveMarketplace(marketplace); }}
                        >
                          <Trash2 size={13} /> 移除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
