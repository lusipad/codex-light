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
  Server,
  ShoppingBag,
  Store,
  Trash2,
  WifiOff,
} from "lucide-react";
import { callAppServer, tauriInvoke } from "../bridge";
import {
  CodexConfigOverview,
  McpServerConfigItem,
  SkillInfoItem,
} from "../types";
import "./PluginsMarket.css";
import {
  AppInfo,
  InstalledApp,
  MarketplaceUpgradeResponse,
  PluginDetail,
  PluginErrorKind,
  PluginInstalledResponse,
  PluginListResponse,
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
  removeMarketplace,
  setSkillEnabled as writeSkillEnabled,
  uninstallPlugin,
  upgradeMarketplace,
} from "../plugins";

interface SkillsMcpViewProps {
  activeWorkspaceRoot: string;
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
      let match = localByPath.get(normalizePathKey(remote.path)) ?? null;
      if (!match && !remote.pluginId) {
        match =
          localSkills.find(
            (local) =>
              local.id === remote.name || local.name === remote.name
          ) ?? null;
      }
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

function patchMarketplacePlugin(
  data: PluginListResponse | null,
  marketplaceName: string,
  pluginId: string,
  installed: boolean
): PluginListResponse | null {
  if (!data) return data;
  return {
    ...data,
    marketplaces: data.marketplaces.map((marketplace) =>
      marketplace.name !== marketplaceName
        ? marketplace
        : {
            ...marketplace,
            plugins: marketplace.plugins.map((plugin) =>
              plugin.id === pluginId
                ? { ...plugin, installed, enabled: installed ? plugin.enabled : false }
                : plugin
            ),
          }
    ),
  };
}

export const SkillsMcpView: React.FC<SkillsMcpViewProps> = ({
  activeWorkspaceRoot,
}) => {
  const [subTab, setSubTab] = useState<SubTab>("plugins");
  const [searchQuery, setSearchQuery] = useState("");
  const [skills, setSkills] = useState<SkillInfoItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfoItem | null>(null);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [readOnlyRemoteSkill, setReadOnlyRemoteSkill] =
    useState<SkillMetadata | null>(null);
  const [newSkillId, setNewSkillId] = useState<string>("");
  const [skillContent, setSkillContent] = useState<string>("");

  // MCP State (kept from the previous implementation)
  const [config, setConfig] = useState<CodexConfigOverview | null>(null);
  const [mcpLiveStatus, setMcpLiveStatus] = useState<any[]>([]);
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http">("stdio");
  const [mcpId, setMcpId] = useState<string>("");
  const [mcpCommand, setMcpCommand] = useState<string>("");
  const [mcpArgs, setMcpArgs] = useState<string>("");
  const [mcpUrl, setMcpUrl] = useState<string>("");
  const [mcpEnvText, setMcpEnvText] = useState<string>("");

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
    "installed"
  );
  const [browseData, setBrowseData] = useState<PluginListResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<ViewError | null>(null);
  const browseLoadedRef = useRef(false);
  const browseLoadingRef = useRef(false);
  const installedLoadingRef = useRef(false);
  const remoteSkillsLoadingRef = useRef(false);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
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

  // ───────────────────────────────────────────────────────────────────────────
  // Data loaders
  // ───────────────────────────────────────────────────────────────────────────

  const loadInstalledPlugins = async (options: { silent?: boolean } = {}) => {
    if (!options.silent && installedLoadingRef.current) return;
    installedLoadingRef.current = true;
    if (!options.silent) setInstalledLoading(true);
    setInstalledError(null);
    try {
      const res = await listInstalledPlugins(workspaceCwds());
      setInstalledData(res);
    } catch (err) {
      setInstalledError(toViewError(err));
    } finally {
      installedLoadingRef.current = false;
      if (!options.silent) setInstalledLoading(false);
    }
  };

  /**
   * Browse listing: `plugin/list` with `marketplaceKinds: ["local"]`.
   * Fetched at most once per session (cached in state) to avoid repeating even
   * the ~139 KB local payload; never omits marketplaceKinds (that would be ~17 MB).
   */
  const loadBrowsePlugins = async (force = false) => {
    if (browseLoadedRef.current && !force) return;
    if (browseLoadingRef.current && !force) return;
    browseLoadingRef.current = true;
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await listMarketplacePlugins(workspaceCwds());
      setBrowseData(res);
      browseLoadedRef.current = true;
    } catch (err) {
      setBrowseError(toViewError(err));
    } finally {
      browseLoadingRef.current = false;
      setBrowseLoading(false);
    }
  };

  const loadRemoteSkills = async (forceReload = false) => {
    if (remoteSkillsLoadingRef.current && !forceReload) return;
    remoteSkillsLoadingRef.current = true;
    setRemoteSkillsLoading(true);
    setRemoteSkillsError(null);
    try {
      const res = await listSkills(workspaceCwds(), forceReload);
      setRemoteSkills(flattenSkills(res).skills);
    } catch (err) {
      setRemoteSkillsError(toViewError(err));
      setRemoteSkills(null);
    } finally {
      remoteSkillsLoadingRef.current = false;
      setRemoteSkillsLoading(false);
    }
  };

  const loadApps = async (force = false) => {
    if (appsLoadingRef.current && !force) return;
    appsLoadingRef.current = true;
    setAppsLoading(true);
    setAppsError(null);
    try {
      const res = await listApps({ forceRefetch: force });
      setAppsData(res.data);
      setAppsInstalled(null);
      appsLoadedRef.current = true;
      setAppsLoaded(true);
    } catch (err) {
      setAppsData(null);
      setAppsError(toViewError(err));
      // Graceful fallback: local committed connector runtime snapshot.
      try {
        const installed = await listInstalledApps();
        setAppsInstalled(installed);
      } catch {
        setAppsInstalled(null);
      }
      appsLoadedRef.current = true;
      setAppsLoaded(true);
    } finally {
      appsLoadingRef.current = false;
      setAppsLoading(false);
    }
  };

  const refreshAll = async () => {
    try {
      const localSkills = await tauriInvoke<SkillInfoItem[]>(
        "skills_list_local",
        { workspaceRoot: activeWorkspaceRoot }
      );
      setSkills(localSkills);
      if (localSkills.length > 0 && !selectedSkill) {
        setSelectedSkill(localSkills[0]);
        setSelectedSkillKey(localSkills[0].path);
        setNewSkillId(localSkills[0].id);
        setSkillContent(localSkills[0].content);
      }
    } catch {}

    try {
      const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
      setConfig(cfg);
    } catch {}

    try {
      const statusRes = await callAppServer<any>("mcpServerStatus/list", {});
      const list = Array.isArray(statusRes?.data)
        ? statusRes.data
        : Array.isArray(statusRes?.servers)
          ? statusRes.servers
          : Array.isArray(statusRes)
            ? statusRes
            : [];
      setMcpLiveStatus(list);
    } catch {
      setMcpLiveStatus([]);
    }

    await Promise.allSettled([loadInstalledPlugins(), loadRemoteSkills()]);
    if (subTab === "apps" && appsLoadedRef.current) {
      await loadApps(true);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceRoot]);

  useEffect(() => {
    if (subTab === "apps" && !appsLoadedRef.current) {
      loadApps();
    }
    if (subTab === "plugins" && pluginMode === "browse") {
      loadBrowsePlugins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, pluginMode]);

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
      setDetailKey(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    const requestId = ++detailRequestRef.current;
    detailContextRef.current = { plugin, marketplace };
    setDetailKey(key);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await readPlugin(pluginRefFor(plugin, marketplace));
      if (detailRequestRef.current !== requestId) return;
      setDetail(res);
    } catch (err) {
      if (detailRequestRef.current !== requestId) return;
      setDetailError(toViewError(err));
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const handleInstallPlugin = async (
    plugin: PluginSummary,
    marketplace: PluginMarketplaceEntry
  ) => {
    setBusyPluginId(plugin.id);
    try {
      const res = await installPlugin(pluginRefFor(plugin, marketplace));
      const name = pluginDisplayName(plugin);
      if (res.appsNeedingAuth.length > 0) {
        notify(
          `✓ 已安装 ${name}；${res.appsNeedingAuth
            .map((app) => app.name)
            .join("、")} 需要授权`
        );
      } else {
        notify(`✓ 已安装 ${name}`);
      }
      setBrowseData((prev) =>
        patchMarketplacePlugin(prev, marketplace.name, plugin.id, true)
      );
      await loadInstalledPlugins({ silent: true });
      await loadRemoteSkills(true);
    } catch (err) {
      notify(`安装失败：${errorSummary(err)}`, "error");
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleUninstallPlugin = async (
    plugin: PluginSummary,
    marketplace?: PluginMarketplaceEntry
  ) => {
    const name = pluginDisplayName(plugin);
    const warning =
      plugin.installPolicy === "INSTALLED_BY_DEFAULT"
        ? `「${name}」是默认安装的内置插件，卸载可能影响内置功能。确定继续吗？`
        : `确定要卸载插件「${name}」吗？`;
    if (!confirm(warning)) return;
    setBusyPluginId(plugin.id);
    try {
      await uninstallPlugin(plugin.id);
      notify(`已卸载 ${name}`);
      if (marketplace) {
        setBrowseData((prev) =>
          patchMarketplacePlugin(prev, marketplace.name, plugin.id, false)
        );
      }
      await loadInstalledPlugins({ silent: true });
      await loadRemoteSkills(true);
    } catch (err) {
      notify(`卸载失败：${errorSummary(err)}`, "error");
    } finally {
      setBusyPluginId(null);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Marketplace actions
  // ───────────────────────────────────────────────────────────────────────────

  const resetBrowseCache = () => {
    browseLoadedRef.current = false;
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
      await loadInstalledPlugins({ silent: true });
    } catch (err) {
      const summary = errorSummary(err, 400);
      notify(`添加市场失败：${summary}`, "error");
      setMarketplaceActionError(summary);
    } finally {
      setMarketplaceBusy(null);
    }
  };

  const handleRemoveMarketplace = async (
    marketplace: PluginMarketplaceEntry
  ) => {
    const name = marketplaceDisplayName(marketplace);
    if (
      !confirm(
        `确定要移除市场「${name}」吗？该市场中的插件将不再可用（marketplace/remove）。`
      )
    ) {
      return;
    }
    setMarketplaceBusy(marketplace.name);
    try {
      await removeMarketplace(marketplace.name);
      notify(`已移除市场 ${name}`);
      resetBrowseCache();
      await loadInstalledPlugins({ silent: true });
    } catch (err) {
      notify(`移除市场失败：${errorSummary(err)}`, "error");
    } finally {
      setMarketplaceBusy(null);
    }
  };

  const handleUpgradeMarketplaces = async (marketplaceName?: string) => {
    setMarketplaceBusy(marketplaceName ?? "upgrade");
    setUpgradeReport(null);
    try {
      const res = await upgradeMarketplace(marketplaceName);
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
      await loadInstalledPlugins({ silent: true });
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
    if (!newSkillId.trim() || !skillContent.trim()) return;
    if (readOnlyRemoteSkill) {
      notify("该技能由插件提供，仅支持启用/禁用", "error");
      return;
    }
    try {
      const saved = await tauriInvoke<SkillInfoItem>("skill_save_or_install", {
        id: newSkillId.trim(),
        content: skillContent,
        sourceDir: null,
      });
      await loadRemoteSkills(true);
      await refreshAll();
      setSelectedSkill(saved);
      setSelectedSkillKey(saved.path);
      setReadOnlyRemoteSkill(null);
      notify(`✓ 已保存技能 ${saved.id}`);
    } catch (err: any) {
      notify(`保存技能失败: ${err?.message || String(err)}`, "error");
    }
  };

  const handleInstallSeedSkill = async (skill: SkillInfoItem) => {
    try {
      await tauriInvoke<SkillInfoItem>("skill_save_or_install", {
        id: skill.id,
        content: skill.content,
        sourceDir: skill.dirPath,
      });
      await loadRemoteSkills(true);
      await refreshAll();
      notify(`✓ 已安装技能 ${skill.name}`);
    } catch (err: any) {
      notify(`安装技能失败: ${err?.message || String(err)}`, "error");
    }
  };

  const handleDeleteSkill = async (skill: SkillInfoItem) => {
    if (!confirm(`确定要卸载技能 ${skill.name} 吗？`)) return;
    try {
      await tauriInvoke("skill_delete", { id: skill.id });
      setSelectedSkill(null);
      setSelectedSkillKey(null);
      setReadOnlyRemoteSkill(null);
      await refreshAll();
      notify(`已卸载技能 ${skill.name}`);
    } catch (err: any) {
      notify(`卸载技能失败: ${err?.message || String(err)}`, "error");
    }
  };

  const handleToggleSkill = async (row: SkillRow) => {
    if (row.enabled === undefined || !row.remote) return;
    setSkillToggleBusy(row.key);
    try {
      await writeSkillEnabled({
        enabled: !row.enabled,
        path: row.remote.path || undefined,
        name: row.remote.path ? undefined : row.remote.name,
      });
      notify(`✓ 已${row.enabled ? "禁用" : "启用"}技能 ${row.name}`);
      await loadRemoteSkills(true);
    } catch (err) {
      notify(`切换技能状态失败：${errorSummary(err)}`, "error");
    } finally {
      setSkillToggleBusy(null);
    }
  };

  const handleSelectSkillRow = (row: SkillRow) => {
    setSelectedSkillKey(row.key);
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
    }
  };

  const handleStartNewSkill = () => {
    setSelectedSkill(null);
    setSelectedSkillKey(null);
    setReadOnlyRemoteSkill(null);
    setNewSkillId("my-custom-skill");
    setSkillContent(
      "---\nname: my-custom-skill\ndescription: 自定义技能描述\n---\n\n# My Custom Skill\n\n在这里编写技能指令...\n"
    );
  };

  // ───────────────────────────────────────────────────────────────────────────
  // MCP actions (kept unchanged in behavior)
  // ───────────────────────────────────────────────────────────────────────────

  const handleAddMcpServer = async () => {
    if (!config || !mcpId.trim()) return;
    const envMap: Record<string, string> = {};
    mcpEnvText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf("=");
        if (idx > 0) {
          envMap[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });

    const nextItem: McpServerConfigItem = {
      id: mcpId.trim(),
      command: mcpTransport === "stdio" ? mcpCommand.trim() || "npx" : null,
      args:
        mcpTransport === "stdio"
          ? mcpArgs
              .split(/\s+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      url: mcpTransport === "http" ? mcpUrl.trim() || null : null,
      env: envMap,
      enabled: true,
    };
    const nextServers = [
      ...config.mcpServers.filter((s) => s.id !== nextItem.id),
      nextItem,
    ];
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: {
          mcpServers: nextServers,
        },
      });
      setConfig(updated);
      setMcpId("");
      setMcpCommand("");
      setMcpArgs("");
      setMcpUrl("");
      setMcpEnvText("");
      notify(`✓ 已连接 MCP 服务器: ${nextItem.id}`);
    } catch (err: any) {
      notify(`连接 MCP 失败: ${err?.message || String(err)}`, "error");
    }
  };

  const handleToggleMcpServer = async (srv: McpServerConfigItem) => {
    if (!config) return;
    const nextServers = config.mcpServers.map((s) =>
      s.id === srv.id ? { ...s, enabled: !s.enabled } : s
    );
    const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
      payload: { mcpServers: nextServers },
    });
    setConfig(updated);
  };

  const handleRemoveMcpServer = async (id: string) => {
    if (!config) return;
    const nextServers = config.mcpServers.filter((s) => s.id !== id);
    const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
      payload: {
        mcpServers: nextServers,
      },
    });
    setConfig(updated);
    notify(`已移除 MCP 服务器 ${id}`);
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

  const skillRows = buildSkillRows(skills, remoteSkills);
  const filteredSkillRows = skillRows.filter(
    (row) => matchesSearch(row.name) || matchesSearch(row.description)
  );

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
    const busy = busyPluginId === plugin.id;
    const version = pluginVersion(plugin);
    const category = pluginCategory(plugin);
    const developer = pluginDeveloper(plugin);
    const installBlocked =
      plugin.availability === "DISABLED_BY_ADMIN" ||
      plugin.installPolicy === "NOT_AVAILABLE";
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
            {!options.browse && <span className="pm-mono">{plugin.id}</span>}
          </div>
          {isOpen && <div className="pm-detail-panel">{renderPluginDetail()}</div>}
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
                installBlocked
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
              {busy ? "安装中…" : "安装"}
            </button>
          ) : (
            <button
              type="button"
              className="secondary-btn-sm"
              disabled={busy}
              title="卸载插件（plugin/uninstall）"
              onClick={() => handleUninstallPlugin(plugin, marketplace)}
            >
              {busy ? (
                <Loader2 size={13} className="pm-spin" />
              ) : (
                <Trash2 size={13} />
              )}{" "}
              卸载
            </button>
          )}
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
          <h2>插件、技能与 MCP 中心 (`/plugins`)</h2>
          <p className="subtitle">
            管理 Codex 插件与市场、`~/.codex/skills` 技能库、`config.toml` 自定义 MCP
            服务器；插件 / 市场 / 应用数据来自 app-server 真实协议（plugin/*、marketplace/*、app/*、skills/*）。
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
          <button
            type="button"
            className="primary-btn"
            onClick={() => setSubTab("mcp")}
          >
            <Plus size={14} /> 连接至自定义 MCP
          </button>
          <button type="button" className="secondary-btn" onClick={refreshAll}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={`workbench-toast-banner ${
            toast.kind === "error" ? "pm-toast-error" : ""
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* 5-Tab Bar */}
      <div className="sub-tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`sub-tab ${subTab === "plugins" ? "active" : ""}`}
          onClick={() => setSubTab("plugins")}
        >
          <Boxes size={15} />
          <span>插件 ({installedCount})</span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "skills" ? "active" : ""}`}
          onClick={() => setSubTab("skills")}
        >
          <BookOpen size={15} />
          <span>
            技能 ({remoteSkills ? remoteSkills.length : skills.length})
          </span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "mcp" ? "active" : ""}`}
          onClick={() => setSubTab("mcp")}
        >
          <Server size={15} />
          <span>MCP 服务器 ({config?.mcpServers?.length || 0})</span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "apps" ? "active" : ""}`}
          onClick={() => setSubTab("apps")}
        >
          <AppWindow size={15} />
          <span>
            应用连接器 (
            {appsData
              ? appsData.length
              : appsInstalled
                ? appsInstalled.length
                : "—"}
            )
          </span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "marketplaces" ? "active" : ""}`}
          onClick={() => setSubTab("marketplaces")}
        >
          <ShoppingBag size={15} />
          <span>市场 ({installedMarketplaces.length})</span>
        </button>
      </div>

      {/* TAB 1: PLUGINS (plugin/installed + plugin/list[local] browse) */}
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
              <button
                type="button"
                className={`pm-segment-btn ${pluginMode === "browse" ? "active" : ""}`}
                onClick={() => setPluginMode("browse")}
              >
                <Store size={13} /> 浏览市场
              </button>
            </div>
            <div className="pm-toolbar-right">
              <span className="pm-hint">
                {pluginMode === "installed"
                  ? "数据来源：plugin/installed"
                  : "数据来源：plugin/list · marketplaceKinds:[\"local\"]（仅本地市场，约 139KB；不会请求 17MB 远程目录）"}
              </span>
              {pluginMode === "installed" && (
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => loadInstalledPlugins()}
                  disabled={installedLoading}
                >
                  {installedLoading ? (
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
                renderLoadError(installedError, "已安装插件", () => loadInstalledPlugins())}
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
              {isBrowseBusy && renderLoadingRow("正在加载本地市场目录（plugin/list · 仅一次）…")}
              {!browseLoading && !browseError && !browseData &&
                renderLoadingRow("准备加载本地市场目录…")}
              {!isBrowseBusy && browseError &&
                renderLoadError(browseError, "市场目录", () => loadBrowsePlugins(true))}
              {!isBrowseBusy && !browseError && browseData && (
                browseCount === 0 ? (
                  <div className="empty-hint">
                    本地市场目录中没有可安装的插件。
                  </div>
                ) : browseGroups.length === 0 ? (
                  <div className="empty-hint">
                    没有匹配「{searchQuery}」的可安装插件。
                  </div>
                ) : (
                  <>
                    <p className="pm-hint">
                      <Info size={12} /> 仅列出未安装的本地市场插件（共 {browseCount}{" "}
                      个）。安装将调用 plugin/install；成功后自动刷新已安装列表。
                    </p>
                    {renderMarketplaceGroups(browseGroups, { browse: true })}
                  </>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: SKILLS (skills/list + skills/config/write, local fallback) */}
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
                >
                  <Plus size={12} /> 新建技能
                </button>
              </div>
            </div>
            {remoteSkillsError && (
              <div className="pm-hint" style={{ padding: "4px 2px" }}>
                <AlertCircle size={12} /> skills/list 不可用，已回退本地技能读取：
                {errorSummary(remoteSkillsError.message)}
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
                          disabled={skillToggleBusy === row.key}
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
                  onChange={(e) => setNewSkillId(e.target.value)}
                  placeholder="skill-folder-name"
                  readOnly={readOnlyRemoteSkill !== null}
                />
              </div>
              <div className="editor-actions">
                {selectedSkill && !selectedSkill.installed && (
                  <button
                    type="button"
                    className="primary-btn-sm"
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
            <textarea
              className="code-editor-textarea"
              value={skillContent}
              onChange={(e) => setSkillContent(e.target.value)}
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
      {subTab === "mcp" && (
        <div className="mcp-management-body">
          <div className="card-section">
            <h3>连接至自定义 MCP 服务器 (`[mcp_servers.*]`)</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>Server ID (唯一标识符)</label>
                <input
                  type="text"
                  placeholder="例如：filesystem 或 playwright"
                  value={mcpId}
                  onChange={(e) => setMcpId(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>传输协议类型</label>
                <select
                  value={mcpTransport}
                  onChange={(e) =>
                    setMcpTransport(e.target.value as "stdio" | "http")
                  }
                >
                  <option value="stdio">STDIO (本地命令行进程)</option>
                  <option value="http">Streamable HTTP / SSE 远程端点</option>
                </select>
              </div>
              {mcpTransport === "stdio" ? (
                <>
                  <div className="form-field">
                    <label>可执行命令 (Command)</label>
                    <input
                      type="text"
                      placeholder="例如：npx 或 uvx"
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>启动参数 Args (空格分隔)</label>
                    <input
                      type="text"
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="form-field">
                  <label>HTTP / SSE 服务器 URL</label>
                  <input
                    type="text"
                    placeholder="https://example.com/mcp"
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="form-field" style={{ marginTop: 10 }}>
              <label>环境变量 Env (可选，每行一个 KEY=VALUE)</label>
              <textarea
                rows={2}
                placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx"
                value={mcpEnvText}
                onChange={(e) => setMcpEnvText(e.target.value)}
              />
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handleAddMcpServer}
                disabled={!mcpId.trim()}
              >
                <Plus size={14} /> 保存并连接 MCP Server
              </button>
            </div>
          </div>

          <div className="card-section">
            <h3>已配置的 MCP 服务器 ({config?.mcpServers?.length || 0})</h3>
            {(config?.mcpServers || []).length === 0 ? (
              <div className="empty-hint">
                暂未在 `config.toml` 中配置外部 MCP Server，可在上方填写或前往「市场」一键安装。
              </div>
            ) : (
              <div className="item-cards-list">
                {(config?.mcpServers || []).map((srv) => (
                  <div key={srv.id} className="item-card">
                    <div className="item-card-main">
                      <div className="item-card-title-row">
                        <Server size={15} className="accent-icon" />
                        <strong>{srv.id}</strong>
                        <span className="tag-badge accent">
                          {srv.url ? "Streamable HTTP" : "STDIO"}
                        </span>
                        <span className="tag-badge">
                          {srv.enabled ? "已启用" : "已禁用"}
                        </span>
                      </div>
                      <div className="item-card-meta">
                        {srv.command && (
                          <span className="mono-text">
                            {srv.command} {srv.args.join(" ")}
                          </span>
                        )}
                        {srv.url && <span className="mono-text">{srv.url}</span>}
                      </div>
                    </div>
                    <div className="item-card-actions">
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        onClick={() => handleToggleMcpServer(srv)}
                      >
                        {srv.enabled ? "禁用" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="danger-btn-sm"
                        onClick={() => handleRemoveMcpServer(srv.id)}
                      >
                        <Trash2 size={13} /> 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {mcpLiveStatus.length > 0 && (
            <div className="card-section">
              <h3>App-Server 实时 MCP 运行状态</h3>
              <pre className="code-block-pre">
                <code>{JSON.stringify(mcpLiveStatus, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: APP CONNECTORS (app/list + app/installed fallback) */}
      {subTab === "apps" && (
        <div className="pm-stack">
          <div className="pm-toolbar">
            <div>
              <h3 style={{ margin: 0 }}>
                应用连接器
                {appsData ? ` (${appsData.length})` : ""}
              </h3>
              <p className="pm-hint">
                数据来源：app/list（应用目录）；请求失败时自动回退
                app/installed 本地连接器快照。
              </p>
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
                {appsData.map((app) => (
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
                {appsInstalled.map((app) => (
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
                已配置的插件市场 ({installedMarketplaces.length})
              </h3>
              <p className="pm-hint">
                数据来源：plugin/installed；市场操作使用 marketplace/add ·
                marketplace/remove · marketplace/upgrade。
              </p>
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
                disabled={marketplaceBusy !== null}
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
            installedMarketplaces.length === 0 ? (
              <div className="empty-hint">
                尚未配置任何插件市场。可使用「添加市场」通过 marketplace/add 添加 Git
                仓库或本地市场目录。
              </div>
            ) : (
              <div className="pm-stack">
                {installedMarketplaces.map((marketplace) => {
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
                          disabled={busy}
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
                          disabled={busy}
                          onClick={() => handleRemoveMarketplace(marketplace)}
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
