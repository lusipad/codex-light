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
import { McpSettings } from "./McpSettings";
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileCode,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { isTauriRuntime, tauriInvoke, tauriListen } from "../bridge";
import { AccountSettings } from "./AccountSettings";
import { UsageSettings } from "./UsageSettings";
import {
  GRANULAR_APPROVAL_POLICY,
  VALID_CONFIG_KEYS,
  configRead,
  getConfigValue,
  setConfigKeys,
  type ConfigEdit,
} from "../config";
import {
  AppServerStatus,
  CodexConfigOverview,
  ModelInfo,
  ModelProviderConfig,
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

const SETTINGS_NAV_GROUPS: Array<{
  groupTitle: string;
  items: Array<{ slug: SettingsSectionSlug; label: string; keywords: string }>;
}> = [
  {
    groupTitle: "个人 (Personal)",
    items: [
      { slug: "general-settings", label: "常规设置", keywords: "general editor notification sleep" },
      { slug: "profile", label: "个人资料", keywords: "profile avatar username bio 个人 资料" },
      { slug: "account", label: "账户", keywords: "account login logout email 账户 登录 退出 邮箱" },
      { slug: "usage", label: "使用情况和计费", keywords: "usage plan billing rate limit quota credits 用量 计划 额度 计费" },
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
  workspaceRoots?: string[];
  accountIdentity?: string;
  onAccountChanged?: () => void;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
  initialSection?: SettingsSectionSlug;
  petVisible?: boolean;
  onTogglePetVisible: (visible: boolean) => void;
  onRestartAppServer: (customCliPath?: string) => void | Promise<unknown>;
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
  workspaceRoots,
  accountIdentity,
  onAccountChanged,
  onNavigationGuardChange,
  initialSection = "general-settings",
  petVisible = false,
  onTogglePetVisible,
  onRestartAppServer,
  onConfigUpdated,
  onNavigateRoute,
}) => {
  const [activeSection, commitActiveSection] =
    useState<SettingsSectionSlug>(initialSection === "providers-models" ? "agent" : initialSection === "experimental" ? "general-settings" : initialSection);
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  const personalizationNavigationGuardRef = useRef<((action: () => void) => boolean) | null>(null);
  const settingsGuardsRef = useRef<Record<"personalization" | "account" | "profile" | "mcp" | "plugins", ((action: () => void) => boolean) | null>>({ personalization: null, account: null, profile: null, mcp: null, plugins: null });
  const publishSettingsGuard = useCallback(() => {
    const guards = Object.values(settingsGuardsRef.current).filter((guard): guard is (action: () => void) => boolean => guard !== null);
    const combined = guards.length === 1 ? guards[0] : guards.length ? (action: () => void) => guards.every(guard => guard(action)) : null;
    personalizationNavigationGuardRef.current = combined;
    onNavigationGuardChange?.(combined);
  }, [onNavigationGuardChange]);
  const registerPersonalizationNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    settingsGuardsRef.current.personalization = guard; publishSettingsGuard();
  }, [publishSettingsGuard]);
  const registerAccountNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    settingsGuardsRef.current.account = guard; publishSettingsGuard();
  }, [publishSettingsGuard]);
  const registerProfileNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    settingsGuardsRef.current.profile = guard; publishSettingsGuard();
  }, [publishSettingsGuard]);
  const registerMcpNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    settingsGuardsRef.current.mcp = guard; publishSettingsGuard();
  }, [publishSettingsGuard]);
  const registerPluginNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    settingsGuardsRef.current.plugins = guard; publishSettingsGuard();
  }, [publishSettingsGuard]);
  const setActiveSection = useCallback((section: SettingsSectionSlug) => {
    if (section === activeSectionRef.current) return;
    const apply = () => { activeSectionRef.current = section; commitActiveSection(section); };
    if (personalizationNavigationGuardRef.current?.(apply) === false) return;
    apply();
  }, []);
  const connectionIdentity = JSON.stringify([appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent]);
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

    try {
      if (!protocolWritten) {
        const payload: Record<string, unknown> = {};
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
        const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
          payload,
        });
        setConfig(updated);
        setProviders(updated.providers || []);
      } else {
        // Everything was already persisted by config/batchWrite — refresh raw TOML view.
        const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
        setConfig(cfg);
        setProviders(cfg.providers || providers);
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
          `配置键已写入，但同步 Providers 列表失败: ${toErrorMessage(err)}`
        );
        await saveDesktopPreferences();
        onConfigUpdated();
      } else {
        setErrorBanner(toErrorMessage(err));
      }
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
          {activeSection !== "cloud-settings" && activeSection !== "pets" && activeSection !== "computer-use" && activeSection !== "appshots" && activeSection !== "browser-use" && activeSection !== "voice" && activeSection !== "archived-chats" && activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "usage" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "connections" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && <div className="header-right-btns">
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

        {activeSection !== "cloud-settings" && activeSection !== "pets" && activeSection !== "computer-use" && activeSection !== "appshots" && activeSection !== "browser-use" && activeSection !== "voice" && activeSection !== "archived-chats" && activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "usage" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "connections" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && saveBanner && (
          <div className="success-banner">
            <Check size={14} /> {saveBanner}
          </div>
        )}
        {activeSection !== "cloud-settings" && activeSection !== "pets" && activeSection !== "computer-use" && activeSection !== "appshots" && activeSection !== "browser-use" && activeSection !== "voice" && activeSection !== "archived-chats" && activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "usage" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "connections" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && errorBanner && <div className="error-banner">{errorBanner}</div>}

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

        {/* MCP settings use scoped protocol writes, independent from scalar settings. */}
        {activeSection === "connections" && <div className="settings-scroll-container">
          <McpSettings cwd={activeWorkspaceRoot || undefined} connectionIdentity={connectionIdentity}
            onConfigUpdated={onConfigUpdated} onRestartAppServer={() => onRestartAppServer()}
            onNavigationGuardChange={registerMcpNavigationGuard} />
        </div>}

        {/* ── SECTION 11: PLUGINS SETTINGS ── */}
        {activeSection === "plugins-settings" && (
          <div className="settings-scroll-container">
            <SkillsMcpView
              key={activeWorkspaceRoot}
              activeWorkspaceRoot={activeWorkspaceRoot}
              manageOnly
              connectionIdentity={JSON.stringify([connectionIdentity, accountIdentity])}
              onConfigUpdated={onConfigUpdated}
              onRestartAppServer={() => onRestartAppServer()}
              onNavigationGuardChange={registerPluginNavigationGuard}
              onBrowseDirectory={(tab) => onNavigateRoute?.(tab === "skills" ? "skills" : "plugins")}
            />
          </div>
        )}

        {/* ── SECTION 15: HOOKS SETTINGS (生命周期挂钩 · hooks/list + 实时运行) ── */}
        {activeSection === "hooks-settings" && (
          <HooksSettings key={activeWorkspaceRoot} activeWorkspaceRoot={activeWorkspaceRoot} workspaceRoots={workspaceRoots} connectionIdentity={JSON.stringify([connectionIdentity, accountIdentity])} />
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
        <PersonalizationSettings active={activeSection === "personalization"} accountIdentity={accountIdentity}
          connectionIdentity={`${appServerStatus.connected}:${appServerStatus.binaryPath}:${appServerStatus.appServerVersion ?? ""}:${appServerStatus.userAgent ?? ""}`}
          onNavigationGuardChange={registerPersonalizationNavigationGuard} />

        {activeSection === "account" && <AccountSettings active accountIdentity={accountIdentity}
          connectionIdentity={connectionIdentity} onAccountChanged={onAccountChanged} onNavigationGuardChange={registerAccountNavigationGuard} />}
        {activeSection === "usage" && <UsageSettings accountIdentity={accountIdentity} connectionIdentity={connectionIdentity} />}
        {/* Profile writes require the authenticated account service. */}
        {activeSection === "profile" && <ProfileSettings accountIdentity={accountIdentity} connectionIdentity={connectionIdentity} onNavigationGuardChange={registerProfileNavigationGuard} />}

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
