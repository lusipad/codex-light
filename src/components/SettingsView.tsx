import { CloudPreferencesSettings } from "./CloudPreferencesSettings";
import { PetsSettings } from "./PetsSettings";
import type { PetPreferencesState } from "../petPreferences";
import { ComputerUseSettings, AppshotsSettings, BrowserUseSettings } from "./ControlCapabilitySettings";
import { VoiceSettings } from "./VoiceSettings";
import { ExperimentalFeatures } from "./ExperimentalFeatures";
import { ArchiveView, type ArchiveViewProps } from "./ArchiveView";
import { StorageSettings } from "./StorageSettings";
import { ImportSettings } from "./ImportSettings";
import type { ExternalImportsState } from "../externalImport";
import { CodeReviewSettings } from "./CodeReviewSettings";
import type { CodeReviewPreferencesState } from "../reviewPreferences";
import { WorktreeSettings } from "./WorktreeSettings";
import { LocalEnvironmentSettings } from "./LocalEnvironmentSettings";
import { GitSettings } from "./GitSettings";
import type { GitPreferencesState } from "../gitPreferences";
import { HooksSettings } from "./HooksSettings";
import { SkillsMcpView } from "./SkillsMcpView";
import { readMcpServerStatus, describeMcpStatus } from "../mcpStatus";
import { ProfileSettings } from "./ProfileSettings";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { AgentSettings } from "./AgentSettings";
import { NotificationSettings } from "./NotificationSettings";
import type { NotificationState } from "../notificationPreferences";
import { AppearanceSettings } from "./AppearanceSettings";
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";
import type { KeyboardPreferencesState } from "../keyboardPreferences";
import type { AppearanceState } from "../appearancePreferences";
import { GeneralOpenPreferences } from "./GeneralOpenPreferences";
import type { ComposerEnterBehavior } from "../composerPreferences";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileCode,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { isTauriRuntime, tauriInvoke, tauriListen } from "../bridge";
import { loadAccountSnapshot } from "../accountSnapshot";
import {
  GRANULAR_APPROVAL_POLICY,
  VALID_CONFIG_KEYS,
  configRead,
  getConfigValue,
  mcpServerReload,
  setConfigKeys,
  type AccountRateLimitsResult,
  type AccountReadResult,
  type AccountUsageResult,
  type ConfigEdit,
} from "../config";
import {
  AppServerStatus,
  CodexConfigOverview,
  ModelInfo,
  ModelProviderConfig,
  McpServerConfigItem,
  MainViewRoute,
  SettingsSectionSlug,
} from "../types";

export interface ThemePalette {
  id: string;
  name: string;
  bgPrimary: string;
  bgSecondary: string;
  accent: string;
  textPrimary: string;
}

export const OFFICIAL_COLOR_THEMES: ThemePalette[] = [
  { id: "codex", name: "Codex Official", bgPrimary: "#0d0d0d", bgSecondary: "#141414", accent: "#3b82f6", textPrimary: "#f3f4f6" },
  { id: "catppuccin", name: "Catppuccin Mocha", bgPrimary: "#1e1e2e", bgSecondary: "#181825", accent: "#cba6f7", textPrimary: "#cdd6f4" },
  { id: "dracula", name: "Dracula", bgPrimary: "#282a36", bgSecondary: "#21222c", accent: "#bd93f9", textPrimary: "#f8f8f2" },
  { id: "github", name: "GitHub Dark", bgPrimary: "#0d1117", bgSecondary: "#161b22", accent: "#58a6ff", textPrimary: "#e6edf3" },
  { id: "gruvbox", name: "Gruvbox Dark", bgPrimary: "#1d2021", bgSecondary: "#282828", accent: "#fe8019", textPrimary: "#ebdbb2" },
  { id: "linear", name: "Linear Dark", bgPrimary: "#0f1015", bgSecondary: "#16181d", accent: "#5e6ad2", textPrimary: "#f2f3f5" },
  { id: "monokai", name: "Monokai Pro", bgPrimary: "#2d2a2e", bgSecondary: "#221f22", accent: "#ffd866", textPrimary: "#fcfcfa" },
  { id: "night-owl", name: "Night Owl", bgPrimary: "#011627", bgSecondary: "#0b253a", accent: "#82aaff", textPrimary: "#d6deeb" },
  { id: "nord", name: "Nord", bgPrimary: "#2e3440", bgSecondary: "#242933", accent: "#88c0d0", textPrimary: "#eceff4" },
  { id: "one", name: "One Dark Pro", bgPrimary: "#282c34", bgSecondary: "#21252b", accent: "#61afef", textPrimary: "#abb2bf" },
  { id: "rose-pine", name: "Rosé Pine", bgPrimary: "#191724", bgSecondary: "#1f1d2e", accent: "#ebbcba", textPrimary: "#e0def4" },
  { id: "solarized", name: "Solarized Dark", bgPrimary: "#002b36", bgSecondary: "#073642", accent: "#268bd2", textPrimary: "#93a1a1" },
  { id: "tokyo-night", name: "Tokyo Night", bgPrimary: "#1a1b26", bgSecondary: "#16161e", accent: "#7aa2f7", textPrimary: "#c0caf5" },
  { id: "vercel", name: "Vercel Geist", bgPrimary: "#000000", bgSecondary: "#0a0a0a", accent: "#0070f3", textPrimary: "#ededed" },
  { id: "vscode-plus", name: "VS Code Dark+", bgPrimary: "#1e1e1e", bgSecondary: "#252526", accent: "#007acc", textPrimary: "#d4d4d4" },
  { id: "everforest", name: "Everforest", bgPrimary: "#272e33", bgSecondary: "#1e2326", accent: "#a7c080", textPrimary: "#d3c6aa" },
  { id: "kanagawa", name: "Kanagawa Wave", bgPrimary: "#1f1f28", bgSecondary: "#16161d", accent: "#7e9cd8", textPrimary: "#dcd7ba" },
  { id: "poimandres", name: "Poimandres", bgPrimary: "#1b1e28", bgSecondary: "#171922", accent: "#5de4c7", textPrimary: "#e4f0fb" },
  { id: "laserwave", name: "LaserWave", bgPrimary: "#27212e", bgSecondary: "#1e1924", accent: "#eb64b9", textPrimary: "#ffffff" },
  { id: "matrix", name: "Matrix Cyber", bgPrimary: "#050a05", bgSecondary: "#0a140a", accent: "#00ff66", textPrimary: "#d0ffd6" },
  { id: "absinthe", name: "Absinthe", bgPrimary: "#111614", bgSecondary: "#171f1c", accent: "#34d399", textPrimary: "#ecfdf5" },
  { id: "contrast", name: "High Contrast", bgPrimary: "#000000", bgSecondary: "#090909", accent: "#38bdf8", textPrimary: "#ffffff" },
  { id: "frontier", name: "Frontier", bgPrimary: "#141218", bgSecondary: "#1c1922", accent: "#f59e0b", textPrimary: "#f5f3ff" },
  { id: "material", name: "Material Ocean", bgPrimary: "#0f111a", bgSecondary: "#090b10", accent: "#84ffff", textPrimary: "#a6accd" },
  { id: "notion", name: "Notion Warm Dark", bgPrimary: "#191919", bgSecondary: "#202020", accent: "#2eaadc", textPrimary: "#ebebeb" },
];

export { PET_SPECIES_LIST } from "../types";

export const MCP_PRESETS = [
  {
    id: "filesystem",
    name: "本地文件系统 (Filesystem)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\Repos"],
    env: {} as Record<string, string>,
    desc: "安全访问指定的本地磁盘目录与项目文件",
  },
  {
    id: "github",
    name: "GitHub 官方集成 (GitHub MCP)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_your_token_here" },
    desc: "搜索仓库、提 PR、审查代码与查阅 Issue",
  },
  {
    id: "memory",
    name: "长期知识图谱记忆 (Memory)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: {} as Record<string, string>,
    desc: "基于实体与关系的跨会话长期持久化知识图谱",
  },
  {
    id: "fetch",
    name: "网页数据提取 (Fetch MCP)",
    command: "uvx",
    args: ["mcp-server-fetch"],
    env: {} as Record<string, string>,
    desc: "高效提取网页 HTML、Markdown 与 API 数据",
  },
  {
    id: "postgres",
    name: "PostgreSQL 数据库",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    env: {} as Record<string, string>,
    desc: "直接内省表结构并执行只读查询与数据分析",
  },
  {
    id: "sqlite",
    name: "SQLite 数据库",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "data.db"],
    env: {} as Record<string, string>,
    desc: "本地嵌入式 SQLite 数据库读写探查",
  },
];







const SETTINGS_NAV_GROUPS: Array<{
  groupTitle: string;
  items: Array<{ slug: SettingsSectionSlug; label: string; keywords: string }>;
}> = [
  {
    groupTitle: "个人 (Personal)",
    items: [
      { slug: "general-settings", label: "常规设置", keywords: "general editor notification sleep" },
      { slug: "profile", label: "个人资料", keywords: "profile avatar username bio 个人 资料" },
      { slug: "account", label: "账号与额度", keywords: "account plan usage rate limit quota credits 账号 额度 用量 计划" },
      { slug: "appearance", label: "外观与主题", keywords: "appearance theme font color" },
      { slug: "notifications", label: "通知与免打扰", keywords: "notifications desktop toast sound do not disturb 通知 免打扰 提示音" },
      { slug: "personalization", label: "个性化指令", keywords: "personalization tone instructions" },
      { slug: "keyboard-shortcuts", label: "键盘快捷键", keywords: "shortcuts keybindings hotkeys" },
      { slug: "pets", label: "虚拟宠物伴侣", keywords: "pets companion mini widget 宠物" },
      { slug: "voice", label: "语音输入", keywords: "voice dictation microphone 语音 听写" },
      { slug: "archived-chats", label: "已归档聊天", keywords: "archived chats history restore 归档" },
      { slug: "storage", label: "存储空间", keywords: "storage disk cache worktree 存储 磁盘" },
      { slug: "import", label: "导入配置", keywords: "import cursor vscode windsurf claude 导入" },
    ],
  },
  {
    groupTitle: "编码 (Coding)",
    items: [
      { slug: "agent", label: "配置", keywords: "agent model provider reasoning approval sandbox verbosity web_search instructions 模型 推理 审批 沙盒 指令" },
      { slug: "code-review", label: "代码审查 (Review)", keywords: "code review pr mr diff severity 审查 评审" },
      { slug: "git-settings", label: "Git 偏好", keywords: "git branch prefix force lease pr" },
      { slug: "worktrees", label: "工作树策略", keywords: "worktrees cleanup retention 隔离 工作树" },
      { slug: "local-environments", label: "本地环境 (.codex)", keywords: "local environments default.toml run test 环境" },
      { slug: "hooks-settings", label: "生命周期挂钩 (Hooks)", keywords: "hooks hooks.json preToolUse postToolUse stop 运行 实时 生命周期 挂钩" },
    ],
  },
  {
    groupTitle: "系统与自动化 (Automation)",
    items: [
      { slug: "appshots", label: "应用快照 (Appshots)", keywords: "appshots screenshot window capture 快照 截屏" },
      { slug: "computer-use", label: "电脑操控 (Computer Use)", keywords: "computer use automation desktop any app 操控" },
      { slug: "browser-use", label: "浏览器操控 (Browser Use)", keywords: "browser use cdp webmcp automation 浏览器" },
      { slug: "plugins-settings", label: "插件设置 (Plugins)", keywords: "plugins marketplace auto update 插件 技能" },
      { slug: "connections", label: "MCP 连接", keywords: "connections mcp servers" },
    ],
  },
  {
    groupTitle: "云端与离线 (Cloud & Offline Pro)",
    items: [
      { slug: "cloud-settings", label: "Codex 云端偏好", keywords: "cloud preferences environments diff branch 云端" },
    ],
  },
];

/** Settings sections that currently only persist local preferences (no executor yet). */
const LOCAL_ONLY_SETTINGS_SECTIONS: SettingsSectionSlug[] = [
  "worktrees",
  "code-review",
];

export function applyColorTheme(themeId: string) {
  const palette =
    OFFICIAL_COLOR_THEMES.find((t) => t.id === themeId) ||
    OFFICIAL_COLOR_THEMES[0];
  const root = document.documentElement;
  if (themeId === "codex") {
    for (const key of ["--palette-bg-primary", "--palette-bg-secondary", "--palette-accent-blue", "--palette-text-primary"]) root.style.removeProperty(key);
    return;
  }
  root.style.setProperty("--palette-bg-primary", palette.bgPrimary);
  root.style.setProperty("--palette-bg-secondary", palette.bgSecondary);
  root.style.setProperty("--palette-accent-blue", palette.accent);
  root.style.setProperty("--palette-text-primary", palette.textPrimary);
}

interface SettingsViewProps {
  petPreferencesState: PetPreferencesState;
  archiveViewProps: ArchiveViewProps;
  notificationState: NotificationState;
  gitPreferencesState: GitPreferencesState;
  codeReviewPreferencesState: CodeReviewPreferencesState;
  externalImportsState: ExternalImportsState;
  keyboardState: KeyboardPreferencesState;
  appearanceState: AppearanceState;
  composerEnterBehavior: ComposerEnterBehavior;
  composerEnterSaving: boolean;
  composerEnterError: string | null;
  onSetComposerEnterBehavior: (value: ComposerEnterBehavior) => void;
  appServerStatus: AppServerStatus;
  models: ModelInfo[];
  activeWorkspaceRoot?: string;
  accountIdentity?: string;
  initialSection?: SettingsSectionSlug;
  petVisible?: boolean;
  onTogglePetVisible: (visible: boolean) => void;
  onRestartAppServer: (customCliPath?: string) => void;
  onConfigUpdated: () => void;
  onNavigateRoute?: (route: MainViewRoute) => void;
  onRunEnvironmentCommand: (cwd: string, command: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  petPreferencesState,
  archiveViewProps,
  onRunEnvironmentCommand,
  notificationState,
  gitPreferencesState,
  codeReviewPreferencesState,
  externalImportsState,
  keyboardState,
  appearanceState,
  composerEnterBehavior, composerEnterSaving, composerEnterError, onSetComposerEnterBehavior,
  appServerStatus,
  models,
  activeWorkspaceRoot = "",
  accountIdentity,
  initialSection = "general-settings",
  petVisible = false,
  onTogglePetVisible,
  onRestartAppServer,
  onConfigUpdated,
  onNavigateRoute,
}) => {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionSlug>(initialSection === "providers-models" ? "agent" : initialSection === "experimental" ? "general-settings" : initialSection);
  const [navSearch, setNavSearch] = useState("");
  const [config, setConfig] = useState<CodexConfigOverview | null>(null);
  const [customCliPath, setCustomCliPath] = useState<string>("");
  const [saveBanner, setSaveBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Structured fields
  const [model, setModel] = useState<string>("");
  const [modelProvider, setModelProvider] = useState<string>("");
  const [reasoningEffort, setReasoningEffort] = useState<string>("medium");
  const [approvalPolicy, setApprovalPolicy] = useState<string>("on-request");
  const [sandboxMode, setSandboxMode] = useState<string>("workspace-write");
  const [modelCatalogJson, setModelCatalogJson] = useState<string>("");
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);

  // Real, protocol-backed runtime settings (only valid config.toml keys)
  const [webSearchMode, setWebSearchMode] = useState<string>("cached");
  const [modelVerbosity, setModelVerbosity] = useState<string>("medium");
  const [approvalsReviewer, setApprovalsReviewer] = useState<string>("user");
  const [protocolConfig, setProtocolConfig] = useState<Record<string, unknown> | null>(null);
  const [protocolConfigAvailable, setProtocolConfigAvailable] = useState<boolean>(false);
  const [mcpServersSnapshot, setMcpServersSnapshot] = useState<string>("[]");

  // Account & quota (account/*) — read only
  const [accountInfo, setAccountInfo] = useState<AccountReadResult | null>(null);
  const [accountRateLimits, setAccountRateLimits] = useState<AccountRateLimitsResult | null>(null);
  const [accountUsage, setAccountUsage] = useState<AccountUsageResult | null>(null);
  const [accountLoading, setAccountLoading] = useState<boolean>(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const accountRequest = useRef(0);

  // Appearance & Personalization state
  const [activeThemeId, setActiveThemeId] = useState<string>("codex");
  const [preventSleep, setPreventSleep] = useState<boolean>(false);
  const [toneStyle, setToneStyle] = useState<string>("pragmatic");
  const [customPersonaPrompt, setCustomPersonaPrompt] = useState<string>("");
  const [codeStylePref, setCodeStylePref] = useState<string>("ts-strict");
  const [userRoleTitle, setUserRoleTitle] = useState<string>("全栈软件架构师");
  const [gitBranchPrefix, setGitBranchPrefix] = useState<string>("codex/");
  const [gitDefaultBranch, setGitDefaultBranch] = useState<string>("main");
  const [gitSignCommits, setGitSignCommits] = useState<boolean>(false);
  const [gitIgnoreWhitespace, setGitIgnoreWhitespace] = useState<boolean>(true);
  const [gitConventionalCommits, setGitConventionalCommits] = useState<boolean>(true);
  const [gitAutoStage, setGitAutoStage] = useState<boolean>(false);
  const [worktreeRetentionDays, setWorktreeRetentionDays] = useState<number>(14);
  const [worktreeShareCache, setWorktreeShareCache] = useState<boolean>(true);
  const [worktreeAutoCommit, setWorktreeAutoCommit] = useState<boolean>(true);

  // MCP Connections State
  const [mcpServers, setMcpServers] = useState<McpServerConfigItem[]>([]);
  const [newMcpId, setNewMcpId] = useState<string>("");
  const [newMcpTransport, setNewMcpTransport] = useState<"stdio" | "sse">("stdio");
  const [newMcpCommand, setNewMcpCommand] = useState<string>("npx");
  const [newMcpArgs, setNewMcpArgs] = useState<string>("");
  const [newMcpUrl, setNewMcpUrl] = useState<string>("");
  const [newMcpEnvKey, setNewMcpEnvKey] = useState<string>("");
  const [newMcpEnvVal, setNewMcpEnvVal] = useState<string>("");
  const [newMcpEnvMap, setNewMcpEnvMap] = useState<Record<string, string>>({});
  const [mcpTestStatus, setMcpTestStatus] = useState<Record<string, string>>({});
  const mcpTestRequests = useRef(new Set<string>());
  const mcpStatusGeneration = useRef(0);

  // Plugins Settings State (Real protocol & directory backed)
  const [pluginMarketplaceUrl, setPluginMarketplaceUrl] = useState<string>("https://plugins.codex.sh/registry");
  const [pluginAutoUpdate, setPluginAutoUpdate] = useState<boolean>(true);
  const [pluginAllowUntrusted, setPluginAllowUntrusted] = useState<boolean>(false);
  const [pluginDevMode, setPluginDevMode] = useState<boolean>(false);
  const [pluginSandbox, setPluginSandbox] = useState<string>("workspace");

  // Preserve the retired local preference when other sections save desktopPreferences.
  const [hooksEnabled, setHooksEnabled] = useState(true);

  // Pet Visibility & Size (1:1 with official pets.txt)



  // Notifications policy & sound theme

  // Profile (个人资料)
  const [profileDisplayName, setProfileDisplayName] = useState<string>("Developer");
  const [profileUsername, setProfileUsername] = useState<string>("codex_user");
  const [profileBio, setProfileBio] = useState<string>("Full-stack software engineer & AI pair programmer");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string>("");

  // Code Review (代码审查偏好)
  const [codeReviewTrigger, setCodeReviewTrigger] = useState<"on-pr-open" | "on-push" | "manual">("on-pr-open");
  const [codeReviewAutoReview, setCodeReviewAutoReview] = useState<boolean>(true);
  const [codeReviewExhaustive, setCodeReviewExhaustive] = useState<boolean>(false);
  const [codeReviewBlockingSeverity, setCodeReviewBlockingSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const [codeReviewPathOverrides, setCodeReviewPathOverrides] = useState<string>("*.lock, package-lock.json, dist/**, build/**");





  const toErrorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  const applyProtocolConfig = (raw: Record<string, unknown>) => {
    const readString = (key: string): string => {
      const value = getConfigValue(raw, key);
      return typeof value === "string" ? value : "";
    };
    const approvalPolicyValue = getConfigValue(raw, "approval_policy");
    setApprovalPolicy(
      typeof approvalPolicyValue === "string"
        ? approvalPolicyValue
        : approvalPolicyValue &&
            typeof approvalPolicyValue === "object" &&
            "granular" in (approvalPolicyValue as Record<string, unknown>)
          ? "granular"
          : "on-request"
    );
    setModel(readString("model"));
    setModelProvider(readString("model_provider"));
    setReasoningEffort(readString("model_reasoning_effort") || "medium");
    setApprovalsReviewer(readString("approvals_reviewer") || "user");
    setSandboxMode(readString("sandbox_mode") || "workspace-write");
    setWebSearchMode(readString("web_search") || "cached");
    setModelVerbosity(readString("model_verbosity") || "medium");
    setModelCatalogJson(readString("model_catalog_json"));
    const instructionsValue = readString("instructions");
    if (instructionsValue) setCustomPersonaPrompt(instructionsValue);
  };

  const loadConfig = async () => {
    try {
      // Primary path: app-server `config/read` (real effective config incl. project layers).
      let loadedViaProtocol = false;
      try {
        const protocolResult = await configRead(activeWorkspaceRoot || undefined);
        const rawConfig = protocolResult.config;
        if (rawConfig && Object.keys(rawConfig).length > 0) {
          setProtocolConfig(rawConfig);
          applyProtocolConfig(rawConfig);
          loadedViaProtocol = true;
        }
      } catch (protocolErr) {
        console.warn(
          "config/read app-server 不可用，回退到 Tauri config_read:",
          protocolErr
        );
      }
      setProtocolConfigAvailable(loadedViaProtocol);

      // Legacy Tauri read stays the source of configPath / raw TOML / providers / MCP lists.
      try {
        const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
        setConfig(cfg);
        if (!loadedViaProtocol) {
          setModel(cfg.model || "");
          setModelProvider(cfg.modelProvider || "");
          setReasoningEffort(cfg.modelReasoningEffort || "medium");
          setApprovalPolicy(cfg.approvalPolicy || "on-request");
          setSandboxMode(cfg.sandboxMode || "workspace-write");
          setModelCatalogJson(cfg.modelCatalogJson || "");
          setWebSearchMode(cfg.webSearchMode || "cached");
          if (cfg.instructions) setCustomPersonaPrompt(cfg.instructions);
        }
        setProviders(cfg.providers || []);
        setMcpServers(cfg.mcpServers || []);
        setMcpServersSnapshot(JSON.stringify(cfg.mcpServers || []));
      } catch (legacyErr) {
        if (!loadedViaProtocol) throw legacyErr;
        console.warn("Tauri config_read 不可用:", legacyErr);
      }

      tauriInvoke<any>("desktop_state_get", { key: "desktopPreferences" })
        .then((prefs) => {
          if (prefs && typeof prefs === "object") {
            if (prefs.hooksEnabled !== undefined) setHooksEnabled(prefs.hooksEnabled);
            if (prefs.preventSleep !== undefined) setPreventSleep(prefs.preventSleep);
            if (prefs.toneStyle) setToneStyle(prefs.toneStyle);
            if (prefs.customPersonaPrompt !== undefined) setCustomPersonaPrompt(prefs.customPersonaPrompt);
            if (prefs.codeStylePref) setCodeStylePref(prefs.codeStylePref);
            if (prefs.userRoleTitle) setUserRoleTitle(prefs.userRoleTitle);
            if (prefs.gitBranchPrefix) setGitBranchPrefix(prefs.gitBranchPrefix);
            if (prefs.gitDefaultBranch) setGitDefaultBranch(prefs.gitDefaultBranch);
            if (prefs.gitSignCommits !== undefined) setGitSignCommits(prefs.gitSignCommits);
            if (prefs.gitIgnoreWhitespace !== undefined) setGitIgnoreWhitespace(prefs.gitIgnoreWhitespace);
            if (prefs.gitConventionalCommits !== undefined) setGitConventionalCommits(prefs.gitConventionalCommits);
            if (prefs.gitAutoStage !== undefined) setGitAutoStage(prefs.gitAutoStage);
            if (prefs.worktreeRetentionDays) setWorktreeRetentionDays(prefs.worktreeRetentionDays);
            if (prefs.worktreeShareCache !== undefined) setWorktreeShareCache(prefs.worktreeShareCache);
            if (prefs.worktreeAutoCommit !== undefined) setWorktreeAutoCommit(prefs.worktreeAutoCommit);
            if (prefs.pluginMarketplaceUrl) setPluginMarketplaceUrl(prefs.pluginMarketplaceUrl);
            if (prefs.pluginAutoUpdate !== undefined) setPluginAutoUpdate(prefs.pluginAutoUpdate);
            if (prefs.pluginAllowUntrusted !== undefined) setPluginAllowUntrusted(prefs.pluginAllowUntrusted);
            if (prefs.pluginDevMode !== undefined) setPluginDevMode(prefs.pluginDevMode);
            if (prefs.pluginSandbox) setPluginSandbox(prefs.pluginSandbox);
            if (prefs.profileDisplayName) setProfileDisplayName(prefs.profileDisplayName);
            if (prefs.profileUsername) setProfileUsername(prefs.profileUsername);
            if (prefs.profileBio !== undefined) setProfileBio(prefs.profileBio);
            if (prefs.profileAvatarUrl !== undefined) setProfileAvatarUrl(prefs.profileAvatarUrl);
            if (prefs.codeReviewTrigger) setCodeReviewTrigger(prefs.codeReviewTrigger);
            if (prefs.codeReviewAutoReview !== undefined) setCodeReviewAutoReview(prefs.codeReviewAutoReview);
            if (prefs.codeReviewExhaustive !== undefined) setCodeReviewExhaustive(prefs.codeReviewExhaustive);
            if (prefs.codeReviewBlockingSeverity) setCodeReviewBlockingSeverity(prefs.codeReviewBlockingSeverity);
            if (prefs.codeReviewPathOverrides !== undefined) setCodeReviewPathOverrides(prefs.codeReviewPathOverrides);
          }
        })
        .catch(() => {});

      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  /** Keep the protocol snapshot in sync after a write (used for clear-key detection). */
  const refreshProtocolConfigSnapshot = async () => {
    try {
      const result = await configRead(activeWorkspaceRoot || undefined);
      if (result.config && Object.keys(result.config).length > 0) {
        setProtocolConfig(result.config);
        setProtocolConfigAvailable(true);
      }
    } catch (err) {
      console.warn("config/read 刷新协议快照失败:", err);
    }
  };

  const loadAccountData = async () => {
    const version = ++accountRequest.current;
    setAccountLoading(true);
    setAccountError(null);
    setAccountInfo(null); setAccountRateLimits(null); setAccountUsage(null);
    try {
      const result = await loadAccountSnapshot();
      if (version !== accountRequest.current) return;
      setAccountInfo(result.info); setAccountRateLimits(result.rateLimits); setAccountUsage(result.usage);
      setAccountError(result.error);
    } catch (error) {
      if (version === accountRequest.current) setAccountError(`无法读取账号数据：${toErrorMessage(error)}`);
    } finally {
      if (version === accountRequest.current) setAccountLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection !== "account") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tauriListen<any>("app-server:notification", event => {
      if (!disposed && event.method === "account/updated") void loadAccountData();
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(error => {
      if (!disposed) setAccountError(`账号更新监听失败：${toErrorMessage(error)}`);
    });
    return () => { disposed = true; accountRequest.current += 1; unlisten?.(); };
  }, [activeSection]);

  useEffect(() => {
    loadConfig();
    tauriInvoke<string | null>("desktop_state_get", { key: "colorTheme" })
      .then((t) => {
        if (t && typeof t === "string") {
          setActiveThemeId(t);
          applyColorTheme(t);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection === "providers-models" ? "agent" : initialSection === "experimental" ? "general-settings" : initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    if (activeSection === "account") {
      void loadAccountData();

    }
  }, [activeSection, activeWorkspaceRoot]);

  const flashSaved = (msg: string) => {
    setSaveBanner(msg);
    setTimeout(() => setSaveBanner(null), 2600);
  };

  const buildValidConfigEdits = (): ConfigEdit[] => {
    const edits: ConfigEdit[] = [];
    const push = (keyPath: string, value: unknown) => {
      edits.push({ keyPath, value, mergeStrategy: "replace" });
    };
    const loadedProvider = getConfigValue(protocolConfig, "model_provider");
    const loadedCatalogJson = getConfigValue(protocolConfig, "model_catalog_json");
    if (model.trim()) push(VALID_CONFIG_KEYS.model, model.trim());
    if (modelProvider.trim()) {
      push(VALID_CONFIG_KEYS.modelProvider, modelProvider.trim());
    } else if (typeof loadedProvider === "string" && loadedProvider.trim()) {
      // User selected "(未设置)" — remove the key from config.toml.
      push(VALID_CONFIG_KEYS.modelProvider, null);
    }
    if (reasoningEffort.trim()) push(VALID_CONFIG_KEYS.reasoningEffort, reasoningEffort);
    if (approvalPolicy === "granular" || approvalPolicy === "untrusted") {
      // granular is the supported object form; `untrusted` was dropped from config
      // validation in app-server 0.159, so it is mapped onto the strict granular profile.
      push(VALID_CONFIG_KEYS.approvalPolicy, GRANULAR_APPROVAL_POLICY);
    } else if (approvalPolicy.trim()) {
      push(VALID_CONFIG_KEYS.approvalPolicy, approvalPolicy);
    }
    if (approvalsReviewer.trim()) {
      push(VALID_CONFIG_KEYS.approvalsReviewer, approvalsReviewer);
    }
    if (sandboxMode.trim()) push(VALID_CONFIG_KEYS.sandboxMode, sandboxMode);
    if (webSearchMode.trim()) push(VALID_CONFIG_KEYS.webSearch, webSearchMode);
    if (modelVerbosity.trim()) {
      push(VALID_CONFIG_KEYS.modelVerbosity, modelVerbosity);
    }
    if (modelCatalogJson.trim()) {
      push(VALID_CONFIG_KEYS.modelCatalogJson, modelCatalogJson.trim());
    } else if (
      typeof loadedCatalogJson === "string" &&
      loadedCatalogJson.trim()
    ) {
      push(VALID_CONFIG_KEYS.modelCatalogJson, null);
    }
    // Clearing the instructions textarea removes the key (null = remove in config protocol).
    push(VALID_CONFIG_KEYS.instructions, customPersonaPrompt.trim() || null);
    return edits;
  };

  const saveDesktopPreferences = async () => {
    await tauriInvoke("desktop_state_set", {
      key: "desktopPreferences",
      value: {
        preventSleep,
        toneStyle,
        customPersonaPrompt,
        codeStylePref,
        userRoleTitle,
        gitBranchPrefix,
        gitDefaultBranch,
        gitSignCommits,
        gitIgnoreWhitespace,
        gitConventionalCommits,
        gitAutoStage,
        worktreeRetentionDays,
        worktreeShareCache,
        worktreeAutoCommit,
        pluginMarketplaceUrl,
        pluginAutoUpdate,
        pluginAllowUntrusted,
        pluginDevMode,
        pluginSandbox,
        hooksEnabled,
        profileDisplayName,
        profileUsername,
        profileBio,
        profileAvatarUrl,
        codeReviewTrigger,
        codeReviewAutoReview,
        codeReviewExhaustive,
        codeReviewBlockingSeverity,
        codeReviewPathOverrides,
      },
    })
      .catch(() => {});
  };

  const handleSaveVisual = async () => {
    setErrorBanner(null);
    if (!config && !protocolConfig) {
      setErrorBanner("配置尚未加载完成，请稍后重试保存。");
      return;
    }
    // Only valid config.toml keys are submitted (invalid hyperparameters were removed).
    const edits = buildValidConfigEdits();
    let protocolWritten = false;
    let protocolWarning: string | null = null;

    // Primary path: app-server config/batchWrite + reloadUserConfig: true.
    try {
      const writeResult = await setConfigKeys(edits);
      protocolWritten = true;
      if (writeResult?.status === "okOverridden") {
        protocolWarning =
          writeResult.overriddenMetadata?.message || "部分配置键被托管策略覆盖";
      }
    } catch (protocolErr) {
      console.warn(
        "config/batchWrite 失败，回退到 Tauri config_update:",
        protocolErr
      );
    }

    // MCP lists are still persisted through the legacy TOML writer,
    // and only when they actually changed (avoids rewriting unrelated tables).
    const mcpDirty = JSON.stringify(mcpServers) !== mcpServersSnapshot;

    try {
      if (!protocolWritten || mcpDirty) {
        const payload: Record<string, unknown> = {};
        if (mcpDirty) payload.mcpServers = mcpServers;
        if (!protocolWritten) {
          // Legacy fallback supports only these valid scalar keys.
          payload.model = model.trim() || undefined;
          payload.modelProvider = modelProvider.trim() || undefined;
          payload.modelReasoningEffort = reasoningEffort || undefined;
          payload.approvalPolicy =
            approvalPolicy === "granular" || approvalPolicy === "untrusted"
              ? "on-request"
              : approvalPolicy || undefined;
          payload.sandboxMode = sandboxMode || undefined;
          payload.modelCatalogJson = modelCatalogJson.trim() || undefined;
          payload.instructions = customPersonaPrompt.trim() || undefined;
        }
        const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
          payload,
        });
        setConfig(updated);
        setProviders(updated.providers || []);
        setMcpServers(updated.mcpServers || []);
        setMcpServersSnapshot(JSON.stringify(updated.mcpServers || []));
      } else {
        // Everything was already persisted by config/batchWrite — refresh raw TOML view.
        const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
        setConfig(cfg);
        setProviders(cfg.providers || providers);
        setMcpServers(cfg.mcpServers || mcpServers);
        setMcpServersSnapshot(JSON.stringify(cfg.mcpServers || mcpServers));
      }

      await saveDesktopPreferences();
      flashSaved(
        protocolWritten
          ? "✓ 已通过 app-server config/batchWrite 保存（reloadUserConfig: true 热更新）"
          : "✓ 已通过 Tauri 命令保存（app-server 未连接，回退模式）"
      );
      onConfigUpdated();
      if (protocolWritten) void refreshProtocolConfigSnapshot();
      if (protocolWarning) setErrorBanner(`⚠️ ${protocolWarning}`);
    } catch (err) {
      if (protocolWritten) {
        setErrorBanner(
          `配置键已写入，但同步 Providers / MCP 列表失败: ${toErrorMessage(err)}`
        );
        await saveDesktopPreferences();
        onConfigUpdated();
      } else {
        setErrorBanner(toErrorMessage(err));
      }
    }
  };

  useEffect(() => {
    setMcpTestStatus({});
    return () => { mcpStatusGeneration.current += 1; mcpTestRequests.current.clear(); };
  }, [activeSection, activeWorkspaceRoot]);

  const handleTestMcpServer = async (srv: McpServerConfigItem) => {
    if (mcpTestRequests.current.has(srv.id)) return;
    mcpTestRequests.current.add(srv.id);
    const version = mcpStatusGeneration.current;
    setMcpTestStatus(previous => ({ ...previous, [srv.id]: "正在读取状态…" }));
    try {
      const status = await readMcpServerStatus(srv.id);
      if (version !== mcpStatusGeneration.current) return;
      setMcpTestStatus(previous => ({ ...previous, [srv.id]: describeMcpStatus(status) }));
    } catch (error) {
      if (version === mcpStatusGeneration.current) {
        setMcpTestStatus(previous => ({ ...previous, [srv.id]: `状态读取失败：${toErrorMessage(error)}` }));
      }
    } finally {
      if (version === mcpStatusGeneration.current) mcpTestRequests.current.delete(srv.id);
    }
  };

  const handleAddMcpServer = async () => {
    if (!newMcpId.trim()) return;
    const item: McpServerConfigItem = {
      id: newMcpId.trim(),
      command: newMcpTransport === "stdio" ? newMcpCommand.trim() || "npx" : null,
      args:
        newMcpTransport === "stdio" && newMcpArgs.trim()
          ? newMcpArgs.trim().split(/\s+/)
          : [],
      url: newMcpTransport === "sse" ? newMcpUrl.trim() : null,
      env: newMcpEnvMap,
      enabled: true,
    };
    const nextServers = [...mcpServers.filter((s) => s.id !== item.id), item];
    setMcpServers(nextServers);
    setNewMcpId("");
    setNewMcpArgs("");
    setNewMcpUrl("");
    setNewMcpEnvMap({});
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: { mcpServers: nextServers },
      });
      setConfig(updated);
      setMcpServersSnapshot(JSON.stringify(updated.mcpServers || nextServers));
      // app-server must re-read the MCP definitions written to config.toml.
      void mcpServerReload().catch(() => {});
      flashSaved(`✓ 已添加并保存 MCP 服务器: ${item.id}`);
      onConfigUpdated();
    } catch (e: any) {
      setErrorBanner(`保存 MCP 失败: ${String(e)}`);
    }
  };

  const handleToggleMcpServer = async (srv: McpServerConfigItem) => {
    const nextServers = mcpServers.map((s) =>
      s.id === srv.id ? { ...s, enabled: !s.enabled } : s
    );
    setMcpServers(nextServers);
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: { mcpServers: nextServers },
      });
      setConfig(updated);
      setMcpServersSnapshot(JSON.stringify(updated.mcpServers || nextServers));
      void mcpServerReload().catch(() => {});
      flashSaved(`✓ 已${!srv.enabled ? "启用" : "停用"} MCP: ${srv.id}`);
      onConfigUpdated();
    } catch (e: any) {
      setErrorBanner(`更新 MCP 状态失败: ${String(e)}`);
    }
  };

  const handleDeleteMcpServer = async (srv: McpServerConfigItem) => {
    const nextServers = mcpServers.filter((s) => s.id !== srv.id);
    setMcpServers(nextServers);
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: { mcpServers: nextServers },
      });
      setConfig(updated);
      setMcpServersSnapshot(JSON.stringify(updated.mcpServers || nextServers));
      void mcpServerReload().catch(() => {});
      flashSaved(`✓ 已移除 MCP 服务器: ${srv.id}`);
      onConfigUpdated();
    } catch (e: any) {
      setErrorBanner(`移除 MCP 失败: ${String(e)}`);
    }
  };

  const filteredNavGroups = useMemo(() => {
    const q = navSearch.trim().toLowerCase();
    if (!q) return SETTINGS_NAV_GROUPS;
    return SETTINGS_NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.keywords.toLowerCase().includes(q)
      ),
    })).filter((g) => g.items.length > 0);
  }, [navSearch]);

  const formatTokenCount = (tokens: number | null | undefined): string => {
    if (tokens === null || tokens === undefined || Number.isNaN(Number(tokens))) {
      return "—";
    }
    const value = Number(tokens);
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
  };

  const formatUnixSeconds = (seconds: number | null | undefined): string => {
    if (!seconds) return "—";
    try {
      return new Date(seconds * 1000).toLocaleString();
    } catch {
      return "—";
    }
  };

  const formatWindowDuration = (mins: number | null | undefined): string => {
    if (!mins) return "额度窗口";
    if (mins === 300) return "5 小时窗口";
    if (mins === 10080) return "7 天窗口";
    if (mins % 1440 === 0) return `${mins / 1440} 天窗口`;
    if (mins % 60 === 0) return `${mins / 60} 小时窗口`;
    return `${mins} 分钟窗口`;
  };

  const formatDurationSeconds = (seconds: number | null | undefined): string => {
    if (!seconds) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
    return `${Math.max(1, minutes)} 分钟`;
  };

  const usageLast14Days = useMemo(() => {
    const buckets = accountUsage?.dailyUsageBuckets || [];
    const byDate = new Map<string, number>();
    for (const bucket of buckets) {
      if (bucket?.startDate) byDate.set(bucket.startDate, bucket.tokens || 0);
    }
    const days: Array<{ date: string; label: string; tokens: number }> = [];
    const today = new Date();
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - offset
      );
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(day.getDate()).padStart(2, "0")}`;
      days.push({
        date: iso,
        label: `${String(day.getMonth() + 1).padStart(2, "0")}-${String(
          day.getDate()
        ).padStart(2, "0")}`,
        tokens: byDate.get(iso) ?? 0,
      });
    }
    return days;
  }, [accountUsage]);

  const accountRateSnapshot = useMemo(() => {
    if (accountRateLimits?.rateLimits) return accountRateLimits.rateLimits;
    const byId = accountRateLimits?.rateLimitsByLimitId;
    if (byId) {
      const first = Object.values(byId)[0];
      if (first) return first;
    }
    return null;
  }, [accountRateLimits]);

  const accountDailyMaxTokens = useMemo(
    () => Math.max(1, ...usageLast14Days.map((day) => day.tokens)),
    [usageLast14Days]
  );

  const chatgptAccount =
    accountInfo?.account && accountInfo.account.type === "chatgpt"
      ? accountInfo.account
      : null;

  const renderBottomBar = () => (
    <div className="settings-section-bottom-bar">
      <button type="button" className="primary-btn" onClick={handleSaveVisual}>
        <Save size={14} /> 保存当前配置
      </button>
      <button type="button" className="secondary-btn" onClick={loadConfig}>
        <RefreshCw size={14} /> 放弃未保存修改
      </button>
    </div>
  );

  return (
    <div className="settings-center-shell">
      {/* Left 20-Section Navigation Sidebar */}
      <aside className="settings-left-nav">
        <div className="settings-search-box">
          <Search size={13} />
          <input
            type="text"
            placeholder="搜索设置项..."
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
          />
        </div>

        <div className="settings-nav-groups">
          {filteredNavGroups.map((group) => (
            <div key={group.groupTitle} className="settings-nav-group">
              <div className="settings-nav-group-title">{group.groupTitle}</div>
              {group.items.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`settings-nav-item ${
                    activeSection === item.slug ? "active" : ""
                  }`}
                  onClick={() => setActiveSection(item.slug)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Right Content Pane */}
      <div className="settings-right-content">
        <div className="panel-page-header">
          <div>
            <h2>
              {SETTINGS_NAV_GROUPS.flatMap((g) => g.items).find(
                (i) => i.slug === activeSection
              )?.label || "设置"}
            </h2>
            {activeSection === "agent" && <p className="card-subtitle-desc">
              配置新聊天的权限、网页访问和智能体回复{" "}
              <a href="https://developers.openai.com/codex/config-basic" target="_blank" rel="noreferrer"
                onClick={event => {
                  if (isTauriRuntime()) {
                    event.preventDefault();
                    void tauriInvoke("open_help_link", { target: "configuration" }).catch(error => setErrorBanner(`无法打开文档：${String(error)}`));
                  }
                }}>了解更多</a>
            </p>}
            {activeSection === "agent" && errorBanner && <p role="alert" className="error-banner">{errorBanner}</p>}
          </div>
          {activeSection !== "cloud-settings" && activeSection !== "pets" && activeSection !== "computer-use" && activeSection !== "appshots" && activeSection !== "browser-use" && activeSection !== "voice" && activeSection !== "archived-chats" && activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && <div className="header-right-btns">
            <button type="button" className="secondary-btn" onClick={loadConfig}>
              <RefreshCw size={14} /> 刷新配置
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handleSaveVisual}
            >
              <Save size={14} /> 保存更改
            </button>
          </div>}
        </div>

        {activeSection !== "cloud-settings" && activeSection !== "pets" && activeSection !== "computer-use" && activeSection !== "appshots" && activeSection !== "browser-use" && activeSection !== "voice" && activeSection !== "archived-chats" && activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && saveBanner && (
          <div className="success-banner">
            <Check size={14} /> {saveBanner}
          </div>
        )}
        {activeSection !== "cloud-settings" && activeSection !== "pets" && activeSection !== "computer-use" && activeSection !== "appshots" && activeSection !== "browser-use" && activeSection !== "voice" && activeSection !== "archived-chats" && activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && errorBanner && <div className="error-banner">{errorBanner}</div>}

        {/* SECTION: GENERAL SETTINGS */}
        {LOCAL_ONLY_SETTINGS_SECTIONS.includes(activeSection) && (
          <div className="settings-local-only-banner">
            <strong>本地偏好分区：</strong>
            此分区的设置会保存在本机，但对应能力尚未接入实际执行器（官方实现依赖内置插件或云端服务）。
            真实生效的配置请以 <code>config.toml</code> 及对应功能页面为准。
          </div>
        )}

        {activeSection === "general-settings" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>Codex App-Server 运行时连接</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>连接状态</label>
                  <div className="status-pill-inline">
                    <span
                      className={`status-dot ${
                        appServerStatus.connected ? "online" : "offline"
                      }`}
                    />
                    <span>
                      {appServerStatus.connected
                        ? `已连接 (${appServerStatus.userAgent || "stdio"})`
                        : appServerStatus.connecting
                          ? "连接中..."
                          : `未连接: ${appServerStatus.lastError || ""}`}
                    </span>
                  </div>
                </div>
                <div className="form-field">
                  <label>自定义 Codex CLI 可执行文件路径</label>
                  <input
                    type="text"
                    placeholder={appServerStatus.binaryPath || "codex"}
                    value={customCliPath}
                    onChange={(e) => setCustomCliPath(e.target.value)}
                  />
                </div>
                <div className="form-field form-field-end">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => onRestartAppServer(customCliPath || undefined)}
                  >
                    <RefreshCw size={14} /> 重启 App-Server
                  </button>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>桌面端常规偏好</h3>
              <div className="form-grid-row">
                <GeneralOpenPreferences />
                <div className="form-field">
                  <label htmlFor="composer-enter-behavior">发送快捷键</label>
                  <p className="card-subtitle-desc">选择按 Enter 时是发送提示还是插入新行</p>
                  <select id="composer-enter-behavior" value={composerEnterBehavior}
                    disabled={composerEnterSaving}
                    onChange={(e) => onSetComposerEnterBehavior(e.target.value as ComposerEnterBehavior)}>
                    <option value="enter">按 Enter 键</option>
                    <option value="cmdIfMultiline">Ctrl + Enter 用于多行提示</option>
                    <option value="cmdAlways">总是使用 Ctrl + Enter</option>
                  </select>
                  {composerEnterError && <p role="alert">{composerEnterError}</p>}
                </div>
                {!navigator.userAgent.includes("Windows") && (
                <div className="form-field">
                  <label>后台任务防休眠策略</label>
                  <label className="checkbox-inline" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={preventSleep}
                      onChange={(e) => setPreventSleep(e.target.checked)}
                    />
                    <span>运行长耗时任务或 /goal 期间阻止系统进入睡眠</span>
                  </label>
                </div>
                )}
              </div>
            </div>

            <div className="card-section" style={{ borderColor: "rgba(239, 68, 68, 0.25)" }}>
              <h3 style={{ color: "#ef4444" }}>⚠️ 恢复出厂设置与清理状态</h3>
              <p className="card-subtitle-desc">
                重置桌面端偏好设置（编辑器偏好、个性化指令、代理设置），不影响本地仓库代码与 Git 记录。
              </p>
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="danger-btn-sm"
                  onClick={async () => {
                    if (
                      !confirm(
                        "确定要将桌面端偏好设置恢复为默认值吗？"
                      )
                    )
                      return;
                    await tauriInvoke("desktop_state_set", {
                      key: "desktopPreferences",
                      value: {},
                    });
                    await tauriInvoke("desktop_state_set", {
                      key: "colorTheme",
                      value: "codex",
                    });
                    applyColorTheme("codex");
                    loadConfig();
                    flashSaved("✓ 已恢复桌面端默认偏好设置");
                  }}
                >
                  恢复出厂默认偏好
                </button>
              </div>
            </div>

            <ExperimentalFeatures connected={appServerStatus.connected} />

            <div className="settings-section-bottom-bar">
              <button type="button" className="primary-btn" onClick={handleSaveVisual}>
                <Save size={14} /> 保存当前配置
              </button>
              <button type="button" className="secondary-btn" onClick={loadConfig}>
                <RefreshCw size={14} /> 放弃未保存修改
              </button>
            </div>
          </div>
        )}

        {/* SECTION: APPEARANCE & 25+ COLOR THEMES */}
        {activeSection === "appearance" && (
          <div className="settings-scroll-container">
            <AppearanceSettings state={appearanceState} />
            <div className="card-section">
              <h3>配色</h3>
              <div className="theme-swatches-grid">
                {OFFICIAL_COLOR_THEMES.map((theme) => (
                  <div
                    key={theme.id}
                    className={`theme-swatch-card ${
                      activeThemeId === theme.id ? "active" : ""
                    }`}
                    onClick={() => {
                      setActiveThemeId(theme.id);
                      applyColorTheme(theme.id);
                      tauriInvoke("desktop_state_set", {
                        key: "colorTheme",
                        value: theme.id,
                      }).catch(() => {});
                      flashSaved(`已切换至主题: ${theme.name}`);
                    }}
                  >
                    <div
                      className="theme-swatch-preview"
                      style={{
                        background: theme.bgPrimary,
                        borderColor: theme.accent,
                      }}
                    >
                      <span
                        className="theme-swatch-dot"
                        style={{ background: theme.accent }}
                      />
                      <span
                        style={{
                          color: theme.textPrimary,
                          fontSize: "calc(11px * var(--font-ui-scale, 1))",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        fn main()
                      </span>
                    </div>
                    <span className="theme-swatch-name">{theme.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {renderBottomBar()}
          </div>
        )}

        {/* Local config compatibility surface; Work preferences require their own account API. */}
        {activeSection === "agent" && (
          <AgentSettings cwd={activeWorkspaceRoot || undefined} accountIdentity={accountIdentity} onConfigUpdated={onConfigUpdated} />
        )}

        {activeSection === "pets" && <PetsSettings state={petPreferencesState} visible={petVisible} onSetVisible={onTogglePetVisible} />}

        {/* SECTION: STORAGE */}
        {activeSection === "storage" && <StorageSettings />}

        {/* SECTION: ARCHIVED CHATS */}
        {activeSection === "archived-chats" && (
          <div className="settings-scroll-container">
            <ArchiveView {...archiveViewProps} />
          </div>
        )}

        {/* SECTION: LOCAL ENVIRONMENTS */}
        {activeSection === "local-environments" && (
          <LocalEnvironmentSettings key={activeWorkspaceRoot} cwd={activeWorkspaceRoot} onRunCommand={onRunEnvironmentCommand} />
        )}

        {/* SECTION: NOTIFICATIONS */}
        {activeSection === "notifications" && (
          <div className="settings-scroll-container">
            <NotificationSettings state={notificationState} />
          </div>
        )}

        {/* SECTION: KEYBOARD SHORTCUTS */}
        {activeSection === "keyboard-shortcuts" && (
          <div className="settings-scroll-container">
            <KeyboardShortcutsSettings state={keyboardState} />
          </div>
        )}

        {/* ── SECTION 10: MCP CONNECTIONS ── */}
        {activeSection === "connections" && (
          <div className="settings-scroll-container">
            {/* Quick MCP Presets */}
            <div className="card-section">
              <h3>常用 MCP 服务器快速预设 (一键填入)</h3>
              <p className="card-subtitle-desc">
                基于 Model Context Protocol 标准协议扩展外部工具、资源与数据源。点击预设可自动填入下方配置表单。
              </p>
              <div className="mcp-presets-grid">
                {MCP_PRESETS.map((preset) => (
                  <div
                    key={preset.id}
                    className="mcp-preset-card"
                    onClick={() => {
                      setNewMcpId(preset.id);
                      setNewMcpTransport("stdio");
                      setNewMcpCommand(preset.command);
                      setNewMcpArgs(preset.args.join(" "));
                      setNewMcpUrl("");
                      setNewMcpEnvMap(preset.env || {});
                      flashSaved(`已填入预设: ${preset.name}`);
                    }}
                  >
                    <div className="mcp-preset-title">
                      <span>{preset.name}</span>
                      <span className="tag-badge accent">{preset.id}</span>
                    </div>
                    <div className="mcp-preset-desc">{preset.desc}</div>
                    <div className="mcp-preset-cmd">
                      $ {preset.command} {preset.args.join(" ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Configured MCP Servers List */}
            <div className="card-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3>已配置的 MCP 服务器 ({mcpServers.length})</h3>
                  <p className="card-subtitle-desc">
                    以下是配置记录，是否可用请读取实际运行状态。
                  </p>
                </div>
              </div>

              {mcpServers.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
                  暂未添加外部 MCP 服务器，可从上方选择预设或在下方手动添加。
                </div>
              ) : (
                <div className="item-cards-list" style={{ marginTop: 10 }}>
                  {mcpServers.map((srv) => (
                    <div key={srv.id} className="item-card">
                      <div className="item-card-main">
                        <div className="item-card-title-row">
                          <strong>{srv.id}</strong>
                          <span className={`tag-badge ${srv.enabled ? "accent" : ""}`}>
                            {srv.enabled ? "已启用" : "已停用"}
                          </span>
                          {srv.url ? (
                            <span className="tag-badge">SSE / HTTP</span>
                          ) : (
                            <span className="tag-badge">stdio</span>
                          )}
                          {mcpTestStatus[srv.id] && (
                            <span
                              className="tag-badge"
                              style={{
                                color: mcpTestStatus[srv.id].startsWith("已连接")
                                  ? "#10b981"
                                  : "#ef4444",
                              }}
                            >
                              {mcpTestStatus[srv.id]}
                            </span>
                          )}
                        </div>
                        <div className="item-card-meta">
                          {srv.url ? (
                            <span className="mono-text">{srv.url}</span>
                          ) : (
                            <span className="mono-text">
                              {srv.command} {srv.args.join(" ")}
                            </span>
                          )}
                          {Object.keys(srv.env).length > 0 && (
                            <span>{Object.keys(srv.env).length} 个环境变量</span>
                          )}
                        </div>
                      </div>
                      <div className="item-card-actions">
                        <button
                          type="button"
                          className="secondary-btn-sm"
                          onClick={() => handleTestMcpServer(srv)}
                          disabled={mcpTestStatus[srv.id] === "正在读取状态…"}
                          title="读取实际 MCP 运行状态"
                        >
                          读取状态
                        </button>
                        <button
                          type="button"
                          className="secondary-btn-sm"
                          onClick={() => handleToggleMcpServer(srv)}
                        >
                          {srv.enabled ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          className="danger-btn-sm"
                          onClick={() => handleDeleteMcpServer(srv)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Custom MCP Server Form */}
            <div className="card-section">
              <h3>添加自定义 MCP 服务器</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>服务器唯一标识 (ID)</label>
                  <input
                    type="text"
                    placeholder="例如: sqlite 或 brave-search"
                    value={newMcpId}
                    onChange={(e) => setNewMcpId(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label>连接协议模式 (Transport)</label>
                  <select
                    value={newMcpTransport}
                    onChange={(e) => setNewMcpTransport(e.target.value as any)}
                  >
                    <option value="stdio">stdio (本地命令执行)</option>
                    <option value="sse">sse / http (远程服务 URL)</option>
                  </select>
                </div>

                {newMcpTransport === "stdio" ? (
                  <>
                    <div className="form-field">
                      <label>可执行程序 (Command)</label>
                      <input
                        type="text"
                        placeholder="npx / uvx / node / python"
                        value={newMcpCommand}
                        onChange={(e) => setNewMcpCommand(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>命令行参数 (Args, 空格分隔)</label>
                      <input
                        type="text"
                        placeholder="-y @modelcontextprotocol/server-xxx"
                        value={newMcpArgs}
                        onChange={(e) => setNewMcpArgs(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="form-field" style={{ gridColumn: "span 2" }}>
                    <label>远程服务 URL (SSE Endpoint)</label>
                    <input
                      type="text"
                      placeholder="http://localhost:8000/sse"
                      value={newMcpUrl}
                      onChange={(e) => setNewMcpUrl(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Environment Variables for this MCP */}
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--text-secondary)" }}>
                  环境变量配置 (Environment Variables)
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input
                    type="text"
                    placeholder="变量名 (如 API_KEY)"
                    style={{
                      flex: 1,
                      height: 32,
                      padding: "0 10px",
                      fontSize: "var(--text-xs)",
                      borderRadius: 6,
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                    value={newMcpEnvKey}
                    onChange={(e) => setNewMcpEnvKey(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="变量值"
                    style={{
                      flex: 1.5,
                      height: 32,
                      padding: "0 10px",
                      fontSize: "var(--text-xs)",
                      borderRadius: 6,
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                    value={newMcpEnvVal}
                    onChange={(e) => setNewMcpEnvVal(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ padding: "0 12px", height: 32 }}
                    onClick={() => {
                      if (newMcpEnvKey.trim()) {
                        setNewMcpEnvMap((prev) => ({
                          ...prev,
                          [newMcpEnvKey.trim()]: newMcpEnvVal,
                        }));
                        setNewMcpEnvKey("");
                        setNewMcpEnvVal("");
                      }
                    }}
                  >
                    添加变量
                  </button>
                </div>
                {Object.keys(newMcpEnvMap).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {Object.entries(newMcpEnvMap).map(([k, v]) => (
                      <span
                        key={k}
                        className="tag-badge"
                        style={{
                          padding: "3px 8px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <code>{k}={v.slice(0, 8)}...</code>
                        <span
                          style={{ cursor: "pointer", color: "#ef4444" }}
                          onClick={() => {
                            setNewMcpEnvMap((prev) => {
                              const copy = { ...prev };
                              delete copy[k];
                              return copy;
                            });
                          }}
                        >
                          ✕
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleAddMcpServer}
                  disabled={
                    !newMcpId.trim() ||
                    (newMcpTransport === "stdio" && !newMcpCommand.trim()) ||
                    (newMcpTransport === "sse" && !newMcpUrl.trim())
                  }
                >
                  <Plus size={14} /> 保存并添加到 MCP 列表
                </button>
              </div>
            </div>

            {renderBottomBar()}
          </div>
        )}

        {/* ── SECTION 11: PLUGINS SETTINGS ── */}
        {activeSection === "plugins-settings" && (
          <div className="settings-scroll-container">
            <SkillsMcpView
              key={activeWorkspaceRoot}
              activeWorkspaceRoot={activeWorkspaceRoot}
              manageOnly
              onBrowseDirectory={(tab) => onNavigateRoute?.(tab === "skills" ? "skills" : "plugins")}
            />
          </div>
        )}

        {/* ── SECTION 15: HOOKS SETTINGS (生命周期挂钩 · hooks/list + 实时运行) ── */}
        {activeSection === "hooks-settings" && (
          <HooksSettings key={activeWorkspaceRoot} activeWorkspaceRoot={activeWorkspaceRoot} />
        )}

        {/* ── SECTION 16: GIT SETTINGS (Git 偏好) ── */}
        {activeSection === "git-settings" && <GitSettings state={gitPreferencesState} />}

        {/* ── SECTION 17: WORKTREES (工作树设置) ── */}
        {activeSection === "worktrees" && <WorktreeSettings />}

        {/* ── SECTION 18: VOICE (语音输入) ── */}
        {activeSection === "voice" && <VoiceSettings />}

        {/* ── SECTION 19: IMPORT (导入配置) ── */}
        {activeSection === "import" && <ImportSettings state={externalImportsState} cwd={activeWorkspaceRoot} />}

        {/* Keep instruction drafts across settings section navigation. */}
        <PersonalizationSettings active={activeSection === "personalization"} />

        {/* ── SECTION 22: ACCOUNT & QUOTA (账号与额度) ── */}
        {activeSection === "account" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div>
                  <h3>账号信息 (`account/read`)</h3>
                  <p className="card-subtitle-desc">
                    只读视图：登录 / 登出请使用 Codex CLI 或官方客户端。数据来自 app-server
                    的 account/read、account/rateLimits/read 与 account/usage/read。
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void loadAccountData()}
                  disabled={accountLoading}
                >
                  <RefreshCw size={14} /> {accountLoading ? "读取中..." : "刷新账号数据"}
                </button>
              </div>

              {accountError && (
                <div className="error-banner" style={{ marginTop: 10 }}>
                  {accountError}
                </div>
              )}

              {chatgptAccount ? (
                <div className="item-cards-list" style={{ marginTop: 12 }}>
                  <div className="item-card">
                    <div className="item-card-main">
                      <div className="item-card-title-row">
                        <strong>{chatgptAccount.email || "(邮箱未提供)"}</strong>
                        <span className="tag-badge accent">ChatGPT</span>
                        <span className="tag-badge">plan: {chatgptAccount.planType}</span>
                      </div>
                      <div className="item-card-meta">
                        <span>账号类型: chatgpt</span>
                        <span>
                          需要 OpenAI 登录:{" "}
                          {accountInfo?.requiresOpenaiAuth ? "是" : "否"}
                        </span>
                        {accountInfo?.workspaceRouting?.chatgptAccountId && (
                          <span>
                            Account ID: {accountInfo.workspaceRouting.chatgptAccountId}
                          </span>
                        )}
                        {accountInfo?.workspaceRouting?.backendOrigin && (
                          <span>
                            Backend: {accountInfo.workspaceRouting.backendOrigin}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-hint" style={{ marginTop: 12 }}>
                  {accountLoading
                    ? "正在读取账号信息..."
                    : accountInfo?.account
                      ? `当前为 ${
                          accountInfo.account.type === "apiKey"
                            ? "API Key"
                            : "Amazon Bedrock"
                        } 登录方式，无 ChatGPT 账号 / 额度信息。`
                      : "未登录或账号信息不可用。"}
                </div>
              )}
            </div>

            <div className="card-section">
              <h3>额度限额 (`account/rateLimits/read`)</h3>
              {accountRateSnapshot ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 10 }}>
                  {([
                    { key: "primary", label: "主额度窗口", window: accountRateSnapshot.primary },
                    { key: "secondary", label: "次额度窗口", window: accountRateSnapshot.secondary },
                  ] as const).map(({ key, label, window }) => {
                    if (!window) return null;
                    const percent = Math.max(
                      0,
                      Math.min(100, window.usedPercent ?? 0)
                    );
                    const barColor =
                      percent >= 90
                        ? "#ef4444"
                        : percent >= 70
                          ? "#f59e0b"
                          : "#3b82f6";
                    return (
                      <div key={key}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            fontSize: "calc(12.5px * var(--font-ui-scale, 1))",
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ color: "var(--text-secondary)" }}>
                            {label} · {formatWindowDuration(window.windowDurationMins)} ·
                            重置时间: {formatUnixSeconds(window.resetsAt)}
                          </span>
                          <span className="mono-badge">{percent}% 已用</span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 999,
                            background: "rgba(255, 255, 255, 0.08)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${percent}%`,
                              background: barColor,
                              borderRadius: 999,
                              transition: "width 0.2s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span className="tag-badge">
                      plan:{" "}
                      {accountRateSnapshot.planType ||
                        chatgptAccount?.planType ||
                        "—"}
                    </span>
                    {accountRateSnapshot.credits && (
                      <span className="tag-badge">
                        {accountRateSnapshot.credits.unlimited
                          ? "额度: 无限"
                          : accountRateSnapshot.credits.hasCredits
                            ? `额度余额: ${accountRateSnapshot.credits.balance ?? "—"}`
                            : "额度余额: 无"}
                      </span>
                    )}
                    {typeof accountRateLimits?.rateLimitResetCredits
                      ?.availableCount === "number" && (
                      <span className="tag-badge">
                        可用额度重置次数:{" "}
                        {accountRateLimits.rateLimitResetCredits.availableCount}
                      </span>
                    )}
                    {accountRateLimits?.ordinaryUsageAllowed === false && (
                      <span className="tag-badge" style={{ color: "#ef4444" }}>
                        ⚠️ 普通用量当前不可用
                      </span>
                    )}
                    {accountRateSnapshot.spendControlReached && (
                      <span className="tag-badge" style={{ color: "#f59e0b" }}>
                        ⚠️ 已触达花费控制
                      </span>
                    )}
                    {accountRateSnapshot.rateLimitReachedType && (
                      <span className="tag-badge" style={{ color: "#f59e0b" }}>
                        受限类型: {accountRateSnapshot.rateLimitReachedType}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty-hint" style={{ marginTop: 12 }}>
                  {accountLoading
                    ? "正在读取额度数据..."
                    : "暂无额度数据（未登录或后端未返回）。"}
                </div>
              )}
            </div>

            <div className="card-section">
              <h3>Token 用量统计 (`account/usage/read`)</h3>
              {accountUsage ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    {[
                      {
                        label: "累计 Tokens",
                        value: formatTokenCount(accountUsage.summary?.lifetimeTokens),
                        hint: "lifetimeTokens",
                      },
                      {
                        label: "单日峰值 Tokens",
                        value: formatTokenCount(accountUsage.summary?.peakDailyTokens),
                        hint: "peakDailyTokens",
                      },
                      {
                        label: "当前连续天数",
                        value:
                          accountUsage.summary?.currentStreakDays != null
                            ? `${accountUsage.summary.currentStreakDays} 天`
                            : "—",
                        hint: "currentStreakDays",
                      },
                      {
                        label: "最长连续天数",
                        value:
                          accountUsage.summary?.longestStreakDays != null
                            ? `${accountUsage.summary.longestStreakDays} 天`
                            : "—",
                        hint: "longestStreakDays",
                      },
                      {
                        label: "最长单轮耗时",
                        value: formatDurationSeconds(
                          accountUsage.summary?.longestRunningTurnSec
                        ),
                        hint: "longestRunningTurnSec",
                      },
                    ].map((stat) => (
                      <div
                        key={stat.hint}
                        style={{
                          padding: "10px 12px",
                          background: "var(--bg-input)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: "calc(11px * var(--font-ui-scale, 1))",
                            color: "var(--text-tertiary)",
                            marginBottom: 4,
                          }}
                        >
                          {stat.label}
                        </div>
                        <div
                          style={{
                            fontSize: "var(--text-heading-sm)",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {stat.value}
                        </div>
                        <div
                          style={{
                            fontSize: "calc(10px * var(--font-ui-scale, 1))",
                            color: "var(--text-tertiary)",
                            marginTop: 2,
                          }}
                        >
                          {stat.hint}
                        </div>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ marginTop: 18, fontSize: "var(--text-sm)" }}>
                    最近 14 天每日 Token 用量
                  </h4>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: 6,
                      height: 120,
                      marginTop: 10,
                      padding: "0 2px",
                    }}
                  >
                    {usageLast14Days.map((day) => {
                      const heightPercent =
                        day.tokens > 0
                          ? Math.max(
                              4,
                              Math.round((day.tokens / accountDailyMaxTokens) * 100)
                            )
                          : 2;
                      return (
                        <div
                          key={day.date}
                          title={`${day.date}: ${formatTokenCount(day.tokens)} tokens`}
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 4,
                            height: "100%",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: `${heightPercent}%`,
                              minHeight: 3,
                              borderRadius: "4px 4px 0 0",
                              background:
                                day.tokens > 0
                                  ? "var(--accent-blue)"
                                  : "rgba(255, 255, 255, 0.08)",
                            }}
                          />
                          <span
                            style={{
                              fontSize: "calc(9px * var(--font-ui-scale, 1))",
                              color: "var(--text-tertiary)",
                              writingMode: "vertical-rl",
                              transform: "rotate(180deg)",
                              lineHeight: 1,
                            }}
                          >
                            {day.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="card-subtitle-desc" style={{ marginTop: 12 }}>
                    数据由 app-server 按账号聚合；dailyUsageBuckets 只包含实际有用量的日期，缺失日期按 0 处理。
                  </p>
                </>
              ) : (
                <div className="empty-hint" style={{ marginTop: 12 }}>
                  {accountLoading
                    ? "正在读取用量数据..."
                    : "暂无用量数据（未登录或后端未返回）。"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Profile writes require the authenticated account service. */}
        {activeSection === "profile" && <ProfileSettings />}

        {/* ── SECTION: CODE REVIEW (代码审查) ── */}
        {activeSection === "code-review" && <CodeReviewSettings state={codeReviewPreferencesState} />}

        {activeSection === "computer-use" && <ComputerUseSettings onManagePlugins={() => setActiveSection("plugins-settings")} />}
        {activeSection === "appshots" && <AppshotsSettings />}
        {activeSection === "browser-use" && <BrowserUseSettings />}

        {activeSection === "cloud-settings" && <CloudPreferencesSettings />}

      </div>
    </div>
  );
};
