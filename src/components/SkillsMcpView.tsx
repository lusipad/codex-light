import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  AppWindow,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
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
  Store,
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
import {
  SkillInfoItem,
} from "../types";
import "./PluginsMarket.css";
import { PluginPreparationPanel } from "./PluginPreparationPanel";
import { RecommendedSkillsPanel } from "./RecommendedSkillsPanel";
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
  pluginVersion,
  readPlugin,
  setSkillEnabled as writeSkillEnabled,
  uninstallPlugin,
  upgradeMarketplace,
} from "../plugins";

interface SkillsMcpViewProps {
  activeWorkspaceRoot: string;
  initialTab?: SubTab;
  initialPluginMode?: "installed" | "browse";
  manageOnly?: boolean;
  connectionIdentity?: string;
  onConfigUpdated?: () => void | Promise<void>;
  onRestartAppServer?: () => void | Promise<unknown>;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
  onBrowseDirectory?: (tab: "plugins" | "skills") => void;
  onStartSkillCreatorSession?: (prompt: string) => void;
}

type SubTab = "plugins" | "skills" | "mcp" | "apps" | "marketplaces";

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
        name: remote.interface?.displayName?.trim() || remote.name,
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

function pluginSourceDetail(plugin: PluginSummary): string {
  const source = plugin.source;
  if (!source) return "";
  if (source.type === "local") return source.path;
  if (source.type === "git") return source.url;
  if (source.type === "npm") return source.package;
  return "远程市场（无本地路径）";
}

function pluginKey(
  plugin: PluginSummary,
  marketplace: PluginMarketplaceEntry
): string {
  return `${marketplace.name}::${plugin.id}`;
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
  onStartSkillCreatorSession,
}) => {
  const [subTab, setSubTab] = useState<SubTab>(initialTab || "plugins");

  useEffect(() => {
    if (initialTab) {
      setSubTab(initialTab);
    }
  }, [initialTab]);
  const [searchQuery, setSearchQuery] = useState("");
  const [skills, setSkills] = useState<SkillInfoItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfoItem | null>(null);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
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
  const installedRequestRef = useRef(0);
  const browseRequestRef = useRef(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ViewError | null>(null);
  const detailRequestRef = useRef(0);
  const detailContextRef = useRef<{
    plugin: PluginSummary;
    marketplace: PluginMarketplaceEntry;
  } | null>(null);

  // Marketplaces tab
  const [marketplaceBusy, setMarketplaceBusy] = useState<string | null>(null);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [marketplaceRefName, setMarketplaceRefName] = useState("");
  const [marketplaceSparsePaths, setMarketplaceSparsePaths] = useState("");
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
    pluginMountedRef.current && context === pluginContextRef.current;

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
    setConfiguredMarkets([]); setManagementError(null); setManagementLoading(true); setPluginUpdates({});
    appsLoadedRef.current = false; appsLoadingRef.current = false;
    setAppsData(null); setAppsInstalled(null); setAppsLoaded(false); setAppsLoading(false); setAppsError(null);
    setBrowseData(null);
    setBrowseError(null);
    setBrowseLoading(false);
    setDetailKey(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setPluginPreparations({});
    setUnconfirmedInstalls(new Set());
    ++skillSelectionRequestRef.current;
    ++remoteSkillsRequestRef.current;
    ++localSkillsRequestRef.current;
    ++skillEditorRevisionRef.current;
    skillSelectionRef.current = null;
    remoteSkillsLoadingRef.current = false;
    setSkills([]);
    setRemoteSkills(null);
    setRemoteSkillsError(null);
    setRemoteSkillsLoading(false);
    setLocalSkillsError(null);
    setSelectedSkill(null);
    setSelectedSkillKey(null);
    setReadOnlyRemoteSkill(null);
    setNewSkillId("");
    setSkillContent("");
    setSkillContentError(null);
    setSkillContentLoading(false);
    return () => {
      pluginMountedRef.current = false;
      ++pluginContextRef.current;
    };
  }, [activeWorkspaceRoot, connectionIdentity]);

  // ───────────────────────────────────────────────────────────────────────────
  // Data loaders
  // ───────────────────────────────────────────────────────────────────────────

  const loadInstalledPlugins = async (options: { silent?: boolean; confirmInstallResult?: boolean } = {}) => {
    if (!pluginMountedRef.current) return;
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
          setUnconfirmedInstalls(new Set());
        }
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
  const loadBrowsePlugins = async (force = false) => {
    if (!pluginMountedRef.current) return;
    if (browseLoadedRef.current && !force) return;
    if (browseLoadingRef.current && !force) return;
    const context = pluginContextRef.current;
    const request = ++browseRequestRef.current;
    const isCurrent = () => isPluginContextCurrent(context) && request === browseRequestRef.current;
    browseLoadingRef.current = true;
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await listMarketplacePlugins(workspaceCwds(), force);
      if (!isCurrent()) return;
      setBrowseData(res);
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

  const loadRemoteSkills = async (forceReload = false) => {
    if (!pluginMountedRef.current) return;
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
    } catch (err) {
      if (isCurrent()) {
        setRemoteSkillsError(toViewError(err));
      }
    } finally {
      if (isCurrent()) {
        remoteSkillsLoadingRef.current = false;
        setRemoteSkillsLoading(false);
      }
    }
  };

  const loadApps = async (force = false) => {
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

  const loadManagement = async () => {
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
  };

  const refreshAll = async () => {
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
    } catch (error) {
      if (isPluginContextCurrent(context) && request === localSkillsRequestRef.current) {
        setLocalSkillsError(errorSummary(error));
      }
    }
    if (!isPluginContextCurrent(context)) return;
    await Promise.allSettled([loadInstalledPlugins({ confirmInstallResult: true }), loadRemoteSkills(), loadManagement()]);
    if (manageOnly || subTab === "apps") {
      await loadApps(true);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceRoot, connectionIdentity]);
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined;
    const refresh = () => {
      if (disposed) return;
      void Promise.allSettled([loadInstalledPlugins({ silent: true }), loadManagement(), loadRemoteSkills(true), loadApps(true)]);
    };
    window.addEventListener("focus", refresh);
    void tauriListen("plugin-management-changed", refresh).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; window.removeEventListener("focus", refresh); unlisten?.(); onNavigationGuardChange?.(null); };
  }, [activeWorkspaceRoot, connectionIdentity]);

  useEffect(() => {
    if (subTab === "apps" && !appsLoadedRef.current) {
      loadApps();
    }
    if (subTab === "plugins" && pluginMode === "browse") {
      loadBrowsePlugins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, pluginMode, activeWorkspaceRoot]);

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
    setDetailKey(key);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await readPlugin(pluginRefFor(plugin, marketplace));
      if (!isPluginContextCurrent(context) || detailRequestRef.current !== requestId) return;
      setDetail(res);
    } catch (err) {
      if (!isPluginContextCurrent(context) || detailRequestRef.current !== requestId) return;
      setDetailError(toViewError(err));
    } finally {
      if (isPluginContextCurrent(context) && detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const handleInstallPlugin = async (
    plugin: PluginSummary,
    marketplace: PluginMarketplaceEntry
  ) => {
    if (pluginActionRef.current.has(plugin.id)) return;
    if (unconfirmedInstalls.has(plugin.id) || plugin.installed ||
        installedData?.marketplaces.some(market => market.plugins.some(item => item.id === plugin.id && item.installed))) return;
    if (plugin.availability === "DISABLED_BY_ADMIN" || plugin.installPolicy === "NOT_AVAILABLE") return;
    pluginActionRef.current.add(plugin.id);
    setBusyPluginIds(new Set(pluginActionRef.current));
    const context = pluginContextRef.current;
    try {
      const res = await installPlugin(pluginRefFor(plugin, marketplace));
      if (!isPluginContextCurrent(context)) return;
      const name = pluginDisplayName(plugin);
      if (res.appsNeedingAuth.length > 0) {
        const attempt = ++preparationAttemptRef.current;
        setPluginPreparations(current => ({
          ...current, [plugin.id]: { name, result: res, attempt },
        }));
        notify(
          `✓ 已安装 ${name}；${res.appsNeedingAuth
            .map((app) => app.name)
            .join("、")} 需要授权`
        );
      } else {
        notify(`✓ 已安装 ${name}`);
      }
      resetBrowseCache();
      await Promise.all([
        loadInstalledPlugins({ silent: true }),
        pluginMode === "browse" ? loadBrowsePlugins(true) : Promise.resolve(),
      ]);
      if (!isPluginContextCurrent(context)) return;
      await loadRemoteSkills(true);
    } catch (err) {
      if (isPluginContextCurrent(context)) {
        const uncertain = err instanceof PluginProtocolError;
        if (uncertain) {
          setUnconfirmedInstalls(current => new Set(current).add(plugin.id));
          notify(`安装结果无法确认：${errorSummary(err)}；正在重新读取安装状态`, "error");
          await loadInstalledPlugins({ silent: true, confirmInstallResult: true });
        } else {
          notify(`安装失败：${errorSummary(err)}`, "error");
        }
      }
    } finally {
      pluginActionRef.current.delete(plugin.id);
      if (pluginMountedRef.current) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };

  const handleUninstallPlugin = async (
    plugin: PluginSummary
  ) => {
    if (pluginActionRef.current.has(plugin.id) || pluginUpdates[plugin.id]?.pending || plugin.source?.type === "remote") return;
    const name = pluginDisplayName(plugin);
    const warning = `确定要卸载插件「${name}」吗？`;
    if (!confirm(warning)) return;
    pluginActionRef.current.add(plugin.id);
    setBusyPluginIds(new Set(pluginActionRef.current));
    const context = pluginContextRef.current;
    try {
      await uninstallPlugin(plugin.id);
      if (!isPluginContextCurrent(context)) return;
      setPluginPreparations(current => {
        const next = { ...current };
        delete next[plugin.id];
        return next;
      });
      notify(`已卸载 ${name}`);
      resetBrowseCache();
      await Promise.all([
        loadInstalledPlugins({ silent: true }),
        pluginMode === "browse" ? loadBrowsePlugins(true) : Promise.resolve(),
      ]);
      if (!isPluginContextCurrent(context)) return;
      await loadRemoteSkills(true);
    } catch (err) {
      if (isPluginContextCurrent(context)) notify(`卸载失败：${errorSummary(err)}`, "error");
    } finally {
      pluginActionRef.current.delete(plugin.id);
      if (pluginMountedRef.current) setBusyPluginIds(new Set(pluginActionRef.current));
    }
  };

  const handleTogglePlugin = async (plugin: PluginSummary) => {
    if (pluginActionRef.current.has(plugin.id) || pluginUpdates[plugin.id]?.pending || plugin.availability === "DISABLED_BY_ADMIN") return;
    const context = pluginContextRef.current, enabled = !plugin.enabled;
    pluginActionRef.current.add(plugin.id); setBusyPluginIds(new Set(pluginActionRef.current));
    try {
      const result = await setPluginEnabled(plugin, enabled, { cwd: activeWorkspaceRoot || undefined, hostId: "local", isCurrent: () => isPluginContextCurrent(context) });
      if (!isPluginContextCurrent(context) || result.stale) return;
      setPluginUpdates(current => ({ ...current, [plugin.id]: { pending: result.verification === "pending", enabled, configFilePath: result.configFilePath, error: result.error, refreshError: result.refreshError } }));
      if (result.verification === "confirmed") {
        notify(`${pluginDisplayName(plugin)} 插件已${enabled ? "启用" : "禁用"}`);
        await Promise.all([loadInstalledPlugins({ silent: true }), loadRemoteSkills(true)]);
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

  const handleAddMarketplace = async () => {
    const source = marketplaceSource.trim();
    if (!source) {
      setMarketplaceActionError("请输入市场来源（Git URL 或本地路径）");
      return;
    }
    setMarketplaceBusy("add");
    setMarketplaceActionError(null);
    setUpgradeReport(null);
    try {
      const sparsePaths = marketplaceSparsePaths
        .split(/[,\n;]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      const res = await addMarketplace(source, {
        refName: marketplaceRefName.trim() || undefined,
        sparsePaths: sparsePaths.length > 0 ? sparsePaths : undefined,
      });
      notify(
        res.alreadyAdded
          ? `市场已存在：${res.marketplaceName}`
          : `✓ 已添加市场 ${res.marketplaceName}`
      );
      setMarketplaceSource("");
      setMarketplaceRefName("");
      setMarketplaceSparsePaths("");
      setShowAddMarketplace(false);
      resetBrowseCache();
      await Promise.all([loadInstalledPlugins({ silent: true }), loadManagement()]);
    } catch (err) {
      const summary = errorSummary(err, 400);
      notify(`添加市场失败：${summary}`, "error");
      setMarketplaceActionError(summary);
    } finally {
      setMarketplaceBusy(null);
    }
  };

  const removal = useMarketplaceRemoval(JSON.stringify([activeWorkspaceRoot, connectionIdentity]), workspaceCwds(), async () => {
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

  const handleDeleteSkill = async (skill: SkillInfoItem) => {
    if (skillWritePendingRef.current) return;
    if (!confirm(`确定要卸载技能 ${skill.name} 吗？`)) return;
    skillWritePendingRef.current = true;
    setSkillWriteBusy(true);
    const context = pluginContextRef.current;
    const revision = skillEditorRevisionRef.current;
    try {
      await tauriInvoke("skill_delete", { id: skill.id });
      if (!isPluginContextCurrent(context)) return;
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
        name: row.remote.path ? undefined : row.remote.name,
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
  const manageableMarkets = configuredMarkets.map(item => item.marketplace);
  const marketplaceLoadErrors = installedData?.marketplaceLoadErrors ?? [];
  const installedCount = installedMarketplaces.reduce(
    (sum, marketplace) => sum + (marketplace.plugins?.length ?? 0),
    0
  );
  const installedGroups = installedMarketplaces
    .map((marketplace) => ({
      marketplace,
      plugins: (marketplace.plugins ?? []).filter(pluginMatchesSearch),
    }))
    .filter((group) => group.plugins.length > 0);

  const browseGroups = (browseData?.marketplaces ?? [])
    .map((marketplace) => ({
      marketplace,
      plugins: (marketplace.plugins ?? [])
        .filter((plugin) => !plugin.installed)
        .filter(pluginMatchesSearch),
    }))
    .filter((group) => group.plugins.length > 0);
  const browseCount = (browseData?.marketplaces ?? []).reduce(
    (sum, marketplace) =>
      sum + (marketplace.plugins ?? []).filter((plugin) => !plugin.installed).length,
    0
  );
  let remainingBrowseCards = browseVisibleCount;
  const visibleBrowseGroups = browseGroups.map((group) => {
    const plugins = group.plugins.slice(0, remainingBrowseCards);
    remainingBrowseCards = Math.max(0, remainingBrowseCards - plugins.length);
    return { ...group, plugins };
  }).filter((group) => group.plugins.length > 0);
  const matchingBrowseCount = browseGroups.reduce((sum, group) => sum + group.plugins.length, 0);

  const skillRows = buildSkillRows(manageOnly ? skills.filter(skill => skill.installed) : skills, remoteSkills);
  const filteredSkillRows = skillRows.filter(
    (row) => matchesSearch(row.name) || matchesSearch(row.description)
  );
  const tabCounts: Record<SubTab, number> = { plugins: installedCount, apps: appsData ? appsData.filter(app => app.isAccessible === true).length : (appsInstalled?.filter(app => app.callable).length ?? 0),
    mcp: mcpCount, skills: skillRows.length, marketplaces: manageableMarkets.length };
  const tabLabels: Record<SubTab, string> = { plugins: "插件", apps: "应用", mcp: "MCP", skills: "技能", marketplaces: "市场" };
  const visibleManagementTabs = managementTabs(tabCounts, showNonMcpTabs);
  const selectTab = (tab: SubTab) => {
    const action = () => setSubTab(tab);
    if (subTab === "mcp" && mcpNavigationGuard.current && !mcpNavigationGuard.current(action)) return;
    action();
  };
  useEffect(() => {
    if (!manageOnly) return;
    const loading = managementLoading || !!managementError || (subTab === "plugins" ? installedLoading || !installedData || !!installedError : subTab === "apps" ? appsLoading || !appsLoaded || !!appsError : subTab === "skills" ? remoteSkillsLoading || remoteSkills === null || !!remoteSkillsError : false);
    const next = managementFallback(subTab, tabCounts, loading, showNonMcpTabs);
    if (next !== subTab) selectTab(next);
  }, [manageOnly, subTab, installedCount, tabCounts.apps, tabCounts.skills, tabCounts.marketplaces, mcpCount, showNonMcpTabs, managementLoading, managementError, installedLoading, installedError, appsLoading, appsLoaded, appsError, remoteSkillsLoading, remoteSkillsError]);

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

  const renderPluginDetail = () => {
    if (detailLoading) return renderLoadingRow("正在读取插件详情（plugin/read）…");
    if (detailError) {
      return (
        <div className="pm-state-body">
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
                }
              }}
            >
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        </div>
      );
    }
    if (!detail) return null;
    const summary = detail.summary;
    return (
      <>
        <p className="pm-detail-desc">
          {detail.description || pluginDescription(summary, 600)}
        </p>
        <div className="pm-detail-grid">
          <div className="pm-detail-item">
            <span>插件 ID</span>
            <span className="pm-mono">{summary.id}</span>
          </div>
          <div className="pm-detail-item">
            <span>所属市场</span>
            <span>{detail.marketplaceName}</span>
          </div>
          <div className="pm-detail-item">
            <span>版本</span>
            <span>{pluginVersion(summary) || "—"}</span>
          </div>
          <div className="pm-detail-item">
            <span>认证策略</span>
            <span>
              {summary.authPolicy === "ON_INSTALL" ? "安装时授权" : "使用时授权"}
            </span>
          </div>
          <div className="pm-detail-item">
            <span>来源</span>
            <span className="pm-mono">{pluginSourceDetail(summary)}</span>
          </div>
          <div className="pm-detail-item">
            <span>状态</span>
            <span>
              {summary.installed ? (summary.enabled ? "已安装 · 已启用" : "已安装 · 已禁用") : "未安装"}
            </span>
          </div>
        </div>
        {detail.skills.length > 0 && (
          <div className="pm-detail-section">
            <span className="pm-detail-label">
              技能（{detail.skills.length}）
            </span>
            <ul className="pm-detail-list">
              {detail.skills.map((skill) => (
                <li
                  key={skill.name}
                  className={skill.enabled ? "" : "pm-skill-disabled"}
                >
                  {skill.interface?.displayName?.trim() || skill.name}
                  {skill.description ? ` — ${skill.description}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {detail.apps.length > 0 && (
          <div className="pm-detail-section">
            <span className="pm-detail-label">
              应用连接器（{detail.apps.length}）
            </span>
            <ul className="pm-detail-list">
              {detail.apps.map((app) => (
                <li key={app.id}>
                  {app.name}
                  {app.category ? ` · ${app.category}` : ""}
                </li>
              ))}
            </ul>
            {summary.installed && <button type="button" className="secondary-btn-sm"
              disabled={busyPluginIds.has(summary.id)}
              onClick={() => {
                const attempt = ++preparationAttemptRef.current;
                setPluginPreparations(current => ({
                  ...current, [summary.id]: {
                    name: pluginDisplayName(summary), attempt,
                    result: { authPolicy: summary.authPolicy, appsNeedingAuth: detail.apps },
                  },
                }));
              }}>
              查看应用连接
            </button>}
          </div>
        )}
        {detail.hooks.length > 0 && (
          <div className="pm-detail-section">
            <span className="pm-detail-label">钩子（{detail.hooks.length}）</span>
            <ul className="pm-detail-list">
              {detail.hooks.map((hook) => (
                <li key={`${hook.eventName}-${hook.key}`}>
                  {hook.eventName} · {hook.key}
                </li>
              ))}
            </ul>
          </div>
        )}
        {detail.mcpServers.length > 0 && (
          <div className="pm-detail-section">
            <span className="pm-detail-label">
              MCP 服务器（{detail.mcpServers.length}）
            </span>
            <div className="pm-tag-list">
              {detail.mcpServers.map((server) => (
                <span className="tag-badge" key={server}>
                  {server}
                </span>
              ))}
            </div>
          </div>
        )}
        {(summary.keywords?.length ?? 0) > 0 && (
          <div className="pm-detail-section">
            <span className="pm-detail-label">关键词</span>
            <div className="pm-tag-list">
              {summary.keywords!.map((keyword) => (
                <span className="tag-badge" key={keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}
        {detail.shareUrl && (
          <div className="pm-detail-item">
            <span>分享链接</span>
            <span className="pm-mono">{detail.shareUrl}</span>
          </div>
        )}
      </>
    );
  };

  const renderPluginCard = (
    plugin: PluginSummary,
    marketplace: PluginMarketplaceEntry,
    options: { browse?: boolean }
  ) => {
    const key = pluginKey(plugin, marketplace);
    const isOpen = detailKey === key;
    const busy = busyPluginIds.has(plugin.id);
    const version = pluginVersion(plugin);
    const category = pluginCategory(plugin);
    const developer = pluginDeveloper(plugin);
    const installed = plugin.installed ||
      installedData?.marketplaces.some(market => market.plugins.some(item => item.id === plugin.id && item.installed));
    const installBlocked =
      plugin.availability === "DISABLED_BY_ADMIN" ||
      plugin.installPolicy === "NOT_AVAILABLE" ||
      installed || unconfirmedInstalls.has(plugin.id);
    return (
      <div className="item-card pm-plugin-card" key={key}>
        <div className="item-card-main">
          <div
            className="item-card-title-row pm-clickable"
            title="点击查看插件详情（plugin/read）"
            onClick={() => handleToggleDetail(plugin, marketplace)}
          >
            <Boxes size={15} className="accent-icon" />
            <strong>{pluginDisplayName(plugin)}</strong>
            {version && <span className="tag-badge">{version}</span>}
            {options.browse ? (
              <span className="tag-badge">{category || "插件"}</span>
            ) : plugin.enabled ? (
              <span className="tag-badge accent">已启用</span>
            ) : (
              <span className="tag-badge pm-badge-off">已禁用</span>
            )}
            {!options.browse && plugin.disabledReason && (
              <span className="tag-badge pm-badge-off">{plugin.disabledReason}</span>
            )}
            {plugin.availability === "DISABLED_BY_ADMIN" && (
              <span className="tag-badge pm-badge-off">管理员禁用</span>
            )}
          </div>
          <p className="item-card-desc">{pluginDescription(plugin)}</p>
          <div className="item-card-meta">
            {developer && <span>{developer}</span>}
            <span className="pm-mono" title={pluginSourceDetail(plugin)}>
              {pluginSourceLabel(plugin)}
            </span>
            {plugin.source?.type === "local" && (
              <button
                type="button"
                className="secondary-btn-sm"
                style={{ padding: "1px 6px", fontSize: "calc(11px * var(--font-ui-scale, 1))" }}
                title={`在系统文件管理器中打开目录: ${pluginSourceDetail(plugin)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  tauriInvoke("reveal_path_in_explorer", { path: (plugin.source as any).path });
                }}
              >
                <FolderOpen size={11} /> 目录
              </button>
            )}
            {!options.browse && <span className="pm-mono">{plugin.id}</span>}
          </div>
          {isOpen && <div className="pm-detail-panel">{renderPluginDetail()}</div>}
          {!options.browse && pluginUpdates[plugin.id] && <div role="status">
            {pluginUpdates[plugin.id].pending && <p>启禁结果待核验；核验只读取状态，不重复提交。</p>}
            {pluginUpdates[plugin.id].error && <p role="alert">{pluginUpdates[plugin.id].error}</p>}
            {pluginUpdates[plugin.id].refreshError && <p role="alert">{pluginUpdates[plugin.id].refreshError}</p>}
            {(pluginUpdates[plugin.id].pending || pluginUpdates[plugin.id].refreshError) && <button type="button" disabled={busy} onClick={() => verifyPluginUpdate(plugin)}>重新核验并刷新技能</button>}
          </div>}
        </div>
        <div className="pm-card-actions">
          <button
            type="button"
            className="secondary-btn-sm"
            onClick={() => handleToggleDetail(plugin, marketplace)}
          >
            {isOpen ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {isOpen ? "收起" : "详情"}
          </button>
          {options.browse ? (
            <button
              type="button"
              className="primary-btn-sm"
              disabled={busy || installBlocked}
              title={
                installed ? "插件已安装" : unconfirmedInstalls.has(plugin.id) ? "请先刷新确认安装状态" : installBlocked
                  ? "该插件当前不可安装（管理员禁用或市场未提供安装）"
                  : "安装插件（plugin/install）"
              }
              onClick={() => handleInstallPlugin(plugin, marketplace)}
            >
              {busy ? (
                <Loader2 size={13} className="pm-spin" />
              ) : (
                <Download size={13} />
              )}{" "}
              {busy ? "安装中…" : installed ? "已安装" : unconfirmedInstalls.has(plugin.id) ? "待确认" : "安装"}
            </button>
          ) : (<>
            <button type="button" className="secondary-btn-sm" role="switch" aria-checked={plugin.enabled}
              aria-label={`${pluginDisplayName(plugin)} 启用`} disabled={busy || !!pluginUpdates[plugin.id]?.pending || plugin.availability === "DISABLED_BY_ADMIN" || plugin.source.type === "remote"}
              title={plugin.source.type === "remote" ? "远程服务启禁尚未接通" : plugin.availability === "DISABLED_BY_ADMIN" ? "管理员已禁用" : undefined}
              onClick={() => handleTogglePlugin(plugin)}>{busy ? "更新中…" : plugin.enabled ? "禁用" : "启用"}</button>
            <button
              type="button"
              className="secondary-btn-sm"
              disabled={busy || !!pluginUpdates[plugin.id]?.pending || plugin.source.type === "remote"}
              title={plugin.source.type === "remote" ? "远程插件卸载服务尚未接通" : "卸载插件"}
              onClick={() => handleUninstallPlugin(plugin)}
            >
              {busy ? (
                <Loader2 size={13} className="pm-spin" />
              ) : (
                <Trash2 size={13} />
              )}{" "}
              {plugin.source.type === "remote" ? "远程服务未接通" : "卸载"}
            </button>
          </>)}
        </div>
      </div>
    );
  };

  const renderMarketplaceGroups = (
    groups: { marketplace: PluginMarketplaceEntry; plugins: PluginSummary[] }[],
    options: { browse?: boolean } = {}
  ) => (
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

  const isBrowseBusy = browseLoading && browseData === null;
  const isInstalledBusy = installedLoading && installedData === null;

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>{manageOnly ? "插件" : "插件、技能与 MCP"}</h2>
          <p className="subtitle">
            管理插件、技能和 MCP。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            className="hub-search-input"
            placeholder="搜索插件、技能或 MCP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {manageOnly && onBrowseDirectory && (
            <button type="button" className="secondary-btn" onClick={() => onBrowseDirectory(subTab === "skills" ? "skills" : "plugins")}>
              浏览目录
            </button>
          )}
          <button
            type="button"
            className="primary-btn"
            onClick={() => selectTab("mcp")}
          >
            <Plus size={14} /> 连接至自定义 MCP
          </button>
          <button type="button" className="secondary-btn" onClick={refreshAll}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

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
      </p>}

      <div className="sub-tabs" role="tablist" aria-label="管理扩展程序" style={{ marginBottom: 16 }}>
        {(manageOnly ? visibleManagementTabs : ["plugins", "skills", "mcp", "apps", "marketplaces"] as SubTab[]).map(tab =>
          <button key={tab} type="button" role="tab" aria-selected={subTab === tab}
            className={`sub-tab ${subTab === tab ? "active" : ""}`} onClick={() => selectTab(tab)}>
            <span>{tabLabels[tab]} ({tabCounts[tab]})</span>
          </button>)}
      </div>
      {managementError && <p role="alert">管理信息读取失败：{managementError} <button type="button" onClick={loadManagement}>重试</button></p>}

      {/* TAB 1: PLUGINS */}
      {subTab === "plugins" && (
        <div className="pm-stack">
          <div className="pm-toolbar">
            <div className="pm-segment">
              <button
                type="button"
                className={`pm-segment-btn ${pluginMode === "installed" ? "active" : ""}`}
                onClick={() => setPluginMode("installed")}
              >
                <Package size={13} /> 已安装 ({installedCount})
              </button>
              {!manageOnly && (
              <button
                type="button"
                className={`pm-segment-btn ${pluginMode === "browse" ? "active" : ""}`}
                onClick={() => setPluginMode("browse")}
              >
                <Store size={13} /> 浏览市场
              </button>
              )}
            </div>
            <div className="pm-toolbar-right">
              {(
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => pluginMode === "installed"
                    ? loadInstalledPlugins({ confirmInstallResult: true })
                    : Promise.all([
                      loadBrowsePlugins(true),
                      unconfirmedInstalls.size ? loadInstalledPlugins({ silent: true, confirmInstallResult: true }) : Promise.resolve(),
                    ])}
                  disabled={pluginMode === "installed" ? installedLoading : browseLoading}
                >
                  {(pluginMode === "installed" ? installedLoading : browseLoading) ? (
                    <Loader2 size={13} className="pm-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}{" "}
                  刷新
                </button>
              )}
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

          {pluginMode === "installed" && (
            <>
              {isInstalledBusy && renderLoadingRow("正在读取已安装插件（plugin/installed）…")}
              {!installedLoading && !installedError && !installedData &&
                renderLoadingRow("准备读取已安装插件…")}
              {!isInstalledBusy && installedError &&
                renderLoadError(installedError, "已安装插件", () => loadInstalledPlugins({ confirmInstallResult: true }))}
              {!isInstalledBusy && !installedError && installedData && (
                installedCount === 0 ? (
                  <div className="empty-hint">
                    未发现已安装插件。切换到「浏览市场」查看本地市场中的可安装插件。
                  </div>
                ) : installedGroups.length === 0 ? (
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
      {subTab === "skills" && !manageOnly && <RecommendedSkillsPanel key={activeWorkspaceRoot}
        workspaceRoot={activeWorkspaceRoot} onInstalled={refreshAll} writeBusy={skillWriteBusy}
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
      {subTab === "skills" && (
        <div className="split-panel-layout">
          <div className="split-left-list">
            <div className="list-toolbar">
              <span>
                技能 ({remoteSkills ? remoteSkills.length : skills.length})
                {remoteSkills ? " · app-server" : " · 本地回退"}
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
            </div>
            {remoteSkillsError && (
              <div className="pm-hint" style={{ padding: "4px 2px" }}>
                <AlertCircle size={12} /> skills/list 不可用，已回退本地技能读取：
                {errorSummary(remoteSkillsError.message)}
              </div>
            )}
            {localSkillsError && (
              <div className="error-banner" role="alert">
                本地技能读取失败：{localSkillsError}
                <button type="button" className="secondary-btn-sm" onClick={refreshAll}>重试</button>
              </div>
            )}
            <div className="scrollable-items">
              {filteredSkillRows.map((row) => (
                <div
                  key={row.key}
                  className={`skill-list-row ${
                    selectedSkillKey === row.key ? "active" : ""
                  }`}
                  onClick={() => handleSelectSkillRow(row)}
                >
                  <div className="skill-row-top">
                    <strong>{row.name}</strong>
                    <div className="pm-skill-row-right">
                      {row.pluginId && <span className="tag-badge">插件</span>}
                      <span className="tag-badge">
                        {skillScopeLabel(row.scope)}
                      </span>
                      {row.enabled !== undefined && (
                        <button
                          type="button"
                          className={`pm-skill-toggle ${row.enabled ? "on" : ""}`}
                          title={
                            row.enabled
                              ? "点击禁用（skills/config/write）"
                              : "点击启用（skills/config/write）"
                          }
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
              ))}
              {filteredSkillRows.length === 0 && (
                <div className="empty-hint">没有匹配的技能。</div>
              )}
            </div>
          </div>

          <div className="split-right-editor">
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
          </div>
        </div>
      )}

      {/* TAB 3: MCP SERVERS (unchanged behavior) */}
      {subTab === "mcp" && <McpSettings cwd={activeWorkspaceRoot || undefined} connectionIdentity={connectionIdentity}
        onConfigUpdated={async () => { await onConfigUpdated?.(); await loadManagement(); }}
        onRestartAppServer={onRestartAppServer ?? (async () => { throw new Error("当前入口尚未连接应用服务重启操作"); })}
        onNavigationGuardChange={guard => { mcpNavigationGuard.current = guard; onNavigationGuardChange?.(guard); }} />}

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

          {showAddMarketplace && (
            <div className="pm-form-card">
              <div className="pm-form-title">
                <FolderOpen size={14} /> 添加插件市场（marketplace/add）
              </div>
              <div className="pm-form-grid">
                <div className="pm-form-field">
                  <label>市场来源 source（Git URL 或本地路径）</label>
                  <input
                    type="text"
                    value={marketplaceSource}
                    onChange={(e) => setMarketplaceSource(e.target.value)}
                    placeholder="https://github.com/org/marketplace-repo 或 C:\path\to\marketplace"
                  />
                </div>
                <div className="pm-form-field">
                  <label>分支 / 引用 refName（可选）</label>
                  <input
                    type="text"
                    value={marketplaceRefName}
                    onChange={(e) => setMarketplaceRefName(e.target.value)}
                    placeholder="main"
                  />
                </div>
                <div className="pm-form-field">
                  <label>稀疏路径 sparsePaths（可选，逗号分隔）</label>
                  <input
                    type="text"
                    value={marketplaceSparsePaths}
                    onChange={(e) => setMarketplaceSparsePaths(e.target.value)}
                    placeholder="plugins/foo, plugins/bar"
                  />
                </div>
              </div>
              {marketplaceActionError && (
                <div className="pm-form-error">{marketplaceActionError}</div>
              )}
              <div className="pm-form-actions">
                <button
                  type="button"
                  className="primary-btn-sm"
                  onClick={handleAddMarketplace}
                  disabled={marketplaceBusy !== null || !marketplaceSource.trim()}
                >
                  {marketplaceBusy === "add" ? (
                    <Loader2 size={13} className="pm-spin" />
                  ) : (
                    <Plus size={13} />
                  )}{" "}
                  {marketplaceBusy === "add" ? "添加中…" : "添加市场"}
                </button>
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => {
                    setShowAddMarketplace(false);
                    setMarketplaceActionError(null);
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

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
