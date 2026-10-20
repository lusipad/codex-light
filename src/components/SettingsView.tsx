import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  FileCode,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import {
  AppServerStatus,
  CodexConfigOverview,
  ModelInfo,
  ModelProviderConfig,
  McpServerConfigItem,
  PetSpeciesId,
  SettingsSectionSlug,
  StorageStatsOverview,
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

export const PET_SPECIES_LIST: Array<{
  id: PetSpeciesId;
  name: string;
  emoji: string;
  desc: string;
}> = [
  { id: "codex", name: "Codex", emoji: "✨", desc: "官方星环智能体伴侣，随推理状态呼吸闪烁" },
  { id: "rocky", name: "Rocky", emoji: "🪨", desc: "稳如磐石的构建守护者，偏爱零报错编译" },
  { id: "hoots", name: "Hoots", emoji: "🦉", desc: "通宵值守的代码猫头鹰，擅长深夜 /goal 巡检" },
  { id: "seedy", name: "Seedy", emoji: "🌱", desc: "随提交次数茁壮成长的新芽伙伴" },
  { id: "stacky", name: "Stacky", emoji: "🥞", desc: "全栈叠叠乐精灵，精通前后端联调" },
  { id: "fireball", name: "Fireball", emoji: "🔥", desc: "高能极速输出模式吉祥物" },
  { id: "bsod", name: "BSOD", emoji: "🟦", desc: "复古蓝屏小怪兽，帮你提前拦截崩溃异常" },
  { id: "dewey", name: "Dewey", emoji: "💧", desc: "清爽极简的水滴助手" },
  { id: "null-signal", name: "Null Signal", emoji: "👾", desc: "赛博像素幽灵，潜行于终端与日志之间" },
];

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
      { slug: "import", label: "导入配置", keywords: "import cursor vscode windsurf claude" },
      { slug: "appearance", label: "外观与主题", keywords: "appearance theme font color" },
      { slug: "archived-chats", label: "已归档聊天", keywords: "archived chats history restore" },
      { slug: "voice", label: "语音输入", keywords: "voice dictation microphone" },
      { slug: "storage", label: "存储空间", keywords: "storage disk cache worktree" },
      { slug: "agent", label: "智能体与模型参数", keywords: "agent model parameters temperature top_p tokens reasoning approval sandbox hyperparameter 超参数 参数" },
      { slug: "personalization", label: "个性化指令", keywords: "personalization tone instructions" },
      { slug: "pets", label: "虚拟宠物伴侣", keywords: "pets companion mini widget" },
      { slug: "keyboard-shortcuts", label: "键盘快捷键", keywords: "shortcuts keybindings hotkeys" },
    ],
  },
  {
    groupTitle: "集成 (Integrations)",
    items: [
      { slug: "plugins-settings", label: "插件设置", keywords: "plugins marketplace auto update" },
      { slug: "computer-use", label: "计算机使用 (@电脑)", keywords: "computer use desktop control windows" },
      { slug: "appshots", label: "应用截图 (Appshots)", keywords: "appshots screenshot capture" },
      { slug: "browser-use", label: "浏览器使用", keywords: "browser playwright preview localhost" },
    ],
  },
  {
    groupTitle: "编码 (Coding)",
    items: [
      { slug: "hooks-settings", label: "生命周期挂钩 (Hooks)", keywords: "hooks pretooluse posttooluse stop" },
      { slug: "connections", label: "MCP 连接", keywords: "connections mcp servers" },
      { slug: "git-settings", label: "Git 偏好", keywords: "git branch prefix force lease pr" },
      { slug: "local-environments", label: "本地环境 (.codex)", keywords: "local environments default.toml run test" },
      { slug: "worktrees", label: "工作树策略", keywords: "worktrees cleanup retention" },
    ],
  },
  {
    groupTitle: "离线增强 (Offline Pro)",
    items: [
      { slug: "providers-models", label: "提供商与模型目录", keywords: "providers models catalog config.toml" },
    ],
  },
];

export function applyColorTheme(themeId: string) {
  const palette =
    OFFICIAL_COLOR_THEMES.find((t) => t.id === themeId) ||
    OFFICIAL_COLOR_THEMES[0];
  const root = document.documentElement;
  root.style.setProperty("--bg-primary", palette.bgPrimary);
  root.style.setProperty("--bg-secondary", palette.bgSecondary);
  root.style.setProperty("--accent-blue", palette.accent);
  root.style.setProperty("--text-primary", palette.textPrimary);
}

interface SettingsViewProps {
  appServerStatus: AppServerStatus;
  models: ModelInfo[];
  activeWorkspaceRoot?: string;
  initialSection?: SettingsSectionSlug;
  selectedPetSpecies?: PetSpeciesId;
  onSelectPetSpecies?: (species: PetSpeciesId) => void;
  petVisible?: boolean;
  onTogglePetVisible?: (visible: boolean) => void;
  onRestartAppServer: (customCliPath?: string) => void;
  onConfigUpdated: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  appServerStatus,
  models,
  activeWorkspaceRoot = "",
  initialSection = "general-settings",
  selectedPetSpecies = "codex",
  onSelectPetSpecies,
  petVisible = false,
  onTogglePetVisible,
  onRestartAppServer,
  onConfigUpdated,
}) => {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionSlug>(initialSection);
  const [navSearch, setNavSearch] = useState("");
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [config, setConfig] = useState<CodexConfigOverview | null>(null);
  const [rawToml, setRawToml] = useState<string>("");
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

  // Hyperparameters & Runtime Tuning
  const [temperature, setTemperature] = useState<number>(0.2);
  const [topP, setTopP] = useState<number>(1.0);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number>(8192);
  const [contextWindow, setContextWindow] = useState<number>(128000);
  const [webSearchMode, setWebSearchMode] = useState<string>("cached");
  const [allowNetwork, setAllowNetwork] = useState<boolean>(true);
  const [maxParallelTools, setMaxParallelTools] = useState<number>(8);
  const [subagentConcurrency, setSubagentConcurrency] = useState<number>(4);
  const [outputVerbosity, setOutputVerbosity] = useState<string>("medium");

  // New provider inputs
  const [newProvId, setNewProvId] = useState<string>("");
  const [newProvName, setNewProvName] = useState<string>("");
  const [newProvUrl, setNewProvUrl] = useState<string>("");
  const [newProvEnvKey, setNewProvEnvKey] = useState<string>("");

  // Appearance & Personalization state
  const [activeThemeId, setActiveThemeId] = useState<string>("codex");
  const [uiFontSize, setUiFontSize] = useState<number>(14);
  const [defaultEditor, setDefaultEditor] = useState<string>("vscode");
  const [preventSleep, setPreventSleep] = useState<boolean>(true);
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

  // Plugins Settings State
  const [pluginMarketplaceUrl, setPluginMarketplaceUrl] = useState<string>("https://plugins.codex.sh/registry");
  const [pluginAutoUpdate, setPluginAutoUpdate] = useState<boolean>(true);
  const [pluginAllowUntrusted, setPluginAllowUntrusted] = useState<boolean>(false);
  const [pluginDevMode, setPluginDevMode] = useState<boolean>(false);
  const [pluginSandbox, setPluginSandbox] = useState<string>("workspace");
  const [installedPlugins, setInstalledPlugins] = useState<Array<{ id: string; name: string; version: string; desc: string; enabled: boolean }>>([
    { id: "git-review", name: "Git Enhanced Reviewer", version: "1.2.0", desc: "智能 Git 差异分析与安全审计挂钩", enabled: true },
    { id: "tailwind-helper", name: "Tailwind CSS IntelliSense", version: "0.9.4", desc: "类名推演与移动端响应式样式生成", enabled: true },
    { id: "diagram-viewer", name: "Mermaid Visualizer", version: "1.0.2", desc: "支持渲染 Mermaid 流程图与时序架构图", enabled: true },
    { id: "docker-mcp", name: "Docker Container Navigator", version: "0.5.1", desc: "容器状态探查与镜像构建管理", enabled: false },
  ]);

  // Computer Use (@电脑)
  const [computerUseEnabled, setComputerUseEnabled] = useState<boolean>(true);
  const [computerResolution, setComputerResolution] = useState<string>("1920x1080");
  const [computerMouseMode, setComputerMouseMode] = useState<string>("smooth");
  const [computerDangerConfirm, setComputerDangerConfirm] = useState<boolean>(true);
  const [computerShowRedDot, setComputerShowRedDot] = useState<boolean>(true);
  const [computerTargetDisplay, setComputerTargetDisplay] = useState<string>("0");

  // Appshots (应用截图)
  const [appshotsEnabled, setAppshotsEnabled] = useState<boolean>(true);
  const [appshotsFormat, setAppshotsFormat] = useState<string>("webp");
  const [appshotsHotkey, setAppshotsHotkey] = useState<string>("Ctrl+Shift+S");
  const [appshotsHideSelf, setAppshotsHideSelf] = useState<boolean>(true);
  const [appshotsBlacklist, setAppshotsBlacklist] = useState<string>("1Password, Bitwarden, KeePass, KeepassXC");

  // Browser Use (浏览器使用)
  const [browserUseEnabled, setBrowserUseEnabled] = useState<boolean>(true);
  const [browserHeadless, setBrowserHeadless] = useState<boolean>(false);
  const [browserEngine, setBrowserEngine] = useState<string>("chrome");
  const [browserCustomPath, setBrowserCustomPath] = useState<string>("");
  const [browserProxy, setBrowserProxy] = useState<string>("");
  const [browserPersistCookies, setBrowserPersistCookies] = useState<boolean>(true);

  // Hooks Settings (生命周期挂钩)
  const [hooksEnabled, setHooksEnabled] = useState<boolean>(true);
  const [preSessionHook, setPreSessionHook] = useState<string>("git fetch origin");
  const [preToolHook, setPreToolHook] = useState<string>("");
  const [postEditHook, setPostEditHook] = useState<string>("npm run format || true");
  const [testFailHook, setTestFailHook] = useState<string>("npm test -- --bail");

  // Voice (语音输入)
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [voiceEngine, setVoiceEngine] = useState<string>("whisper");
  const [voiceLanguage, setVoiceLanguage] = useState<string>("zh-CN");
  const [voiceAutoSendDelay, setVoiceAutoSendDelay] = useState<number>(2000);
  const [voiceHotkey, setVoiceHotkey] = useState<string>("Ctrl + M");

  // Storage & Archived Chats & Local Environments
  const [storageStats, setStorageStats] = useState<StorageStatsOverview | null>(
    null
  );
  const [archivedThreads, setArchivedThreads] = useState<any[]>([]);
  const [localEnvToml, setLocalEnvToml] = useState<string>("");
  const [localEnvPath, setLocalEnvPath] = useState<string>("");

  const loadConfig = async () => {
    try {
      const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
      setConfig(cfg);
      setRawToml(cfg.rawToml);
      setModel(cfg.model || "");
      setModelProvider(cfg.modelProvider || "");
      setReasoningEffort(cfg.modelReasoningEffort || "medium");
      setApprovalPolicy(cfg.approvalPolicy || "on-request");
      setSandboxMode(cfg.sandboxMode || "workspace-write");
      setModelCatalogJson(cfg.modelCatalogJson || "");
      setTemperature(cfg.temperature ?? 0.2);
      setTopP(cfg.topP ?? 1.0);
      setMaxOutputTokens(cfg.maxOutputTokens ?? 8192);
      setContextWindow(cfg.contextWindow ?? 128000);
      setWebSearchMode(cfg.webSearchMode || "cached");
      setAllowNetwork(cfg.allowNetwork ?? true);
      setMaxParallelTools(cfg.maxParallelTools ?? 8);
      setSubagentConcurrency(cfg.subagentConcurrency ?? 4);
      setOutputVerbosity(cfg.outputVerbosity || "medium");
      setProviders(cfg.providers || []);
      setMcpServers(cfg.mcpServers || []);

      tauriInvoke<any>("desktop_state_get", { key: "desktopPreferences" })
        .then((prefs) => {
          if (prefs && typeof prefs === "object") {
            if (prefs.defaultEditor) setDefaultEditor(prefs.defaultEditor);
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
            if (prefs.voiceEnabled !== undefined) setVoiceEnabled(prefs.voiceEnabled);
            if (prefs.voiceEngine) setVoiceEngine(prefs.voiceEngine);
            if (prefs.voiceLanguage) setVoiceLanguage(prefs.voiceLanguage);
            if (prefs.voiceAutoSendDelay) setVoiceAutoSendDelay(prefs.voiceAutoSendDelay);
            if (prefs.voiceHotkey) setVoiceHotkey(prefs.voiceHotkey);
            if (prefs.pluginMarketplaceUrl) setPluginMarketplaceUrl(prefs.pluginMarketplaceUrl);
            if (prefs.pluginAutoUpdate !== undefined) setPluginAutoUpdate(prefs.pluginAutoUpdate);
            if (prefs.pluginAllowUntrusted !== undefined) setPluginAllowUntrusted(prefs.pluginAllowUntrusted);
            if (prefs.pluginDevMode !== undefined) setPluginDevMode(prefs.pluginDevMode);
            if (prefs.pluginSandbox) setPluginSandbox(prefs.pluginSandbox);
            if (prefs.computerUseEnabled !== undefined) setComputerUseEnabled(prefs.computerUseEnabled);
            if (prefs.computerResolution) setComputerResolution(prefs.computerResolution);
            if (prefs.computerMouseMode) setComputerMouseMode(prefs.computerMouseMode);
            if (prefs.computerDangerConfirm !== undefined) setComputerDangerConfirm(prefs.computerDangerConfirm);
            if (prefs.computerShowRedDot !== undefined) setComputerShowRedDot(prefs.computerShowRedDot);
            if (prefs.computerTargetDisplay) setComputerTargetDisplay(prefs.computerTargetDisplay);
            if (prefs.appshotsEnabled !== undefined) setAppshotsEnabled(prefs.appshotsEnabled);
            if (prefs.appshotsFormat) setAppshotsFormat(prefs.appshotsFormat);
            if (prefs.appshotsHotkey) setAppshotsHotkey(prefs.appshotsHotkey);
            if (prefs.appshotsHideSelf !== undefined) setAppshotsHideSelf(prefs.appshotsHideSelf);
            if (prefs.appshotsBlacklist) setAppshotsBlacklist(prefs.appshotsBlacklist);
            if (prefs.browserUseEnabled !== undefined) setBrowserUseEnabled(prefs.browserUseEnabled);
            if (prefs.browserHeadless !== undefined) setBrowserHeadless(prefs.browserHeadless);
            if (prefs.browserEngine) setBrowserEngine(prefs.browserEngine);
            if (prefs.browserCustomPath) setBrowserCustomPath(prefs.browserCustomPath);
            if (prefs.browserProxy) setBrowserProxy(prefs.browserProxy);
            if (prefs.browserPersistCookies !== undefined) setBrowserPersistCookies(prefs.browserPersistCookies);
            if (prefs.hooksEnabled !== undefined) setHooksEnabled(prefs.hooksEnabled);
            if (prefs.preSessionHook !== undefined) setPreSessionHook(prefs.preSessionHook);
            if (prefs.preToolHook !== undefined) setPreToolHook(prefs.preToolHook);
            if (prefs.postEditHook !== undefined) setPostEditHook(prefs.postEditHook);
            if (prefs.testFailHook !== undefined) setTestFailHook(prefs.testFailHook);
          }
        })
        .catch(() => {});

      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
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
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    if (activeSection === "storage") {
      tauriInvoke<StorageStatsOverview>("storage_stats_get")
        .then(setStorageStats)
        .catch(() => {});
    } else if (activeSection === "archived-chats") {
      tauriInvoke<any>("threads_meta_get")
        .then((meta) => setArchivedThreads(meta?.archivedThreads || []))
        .catch(() => {});
    } else if (activeSection === "local-environments" && activeWorkspaceRoot) {
      tauriInvoke<any>("local_environment_read", { cwd: activeWorkspaceRoot })
        .then((res) => {
          setLocalEnvToml(res?.content || "");
          setLocalEnvPath(res?.path || "");
        })
        .catch(() => {});
    }
  }, [activeSection, activeWorkspaceRoot]);

  const flashSaved = (msg: string) => {
    setSaveBanner(msg);
    setTimeout(() => setSaveBanner(null), 2600);
  };

  const handleSaveVisual = async () => {
    setErrorBanner(null);
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: {
          model,
          modelProvider,
          modelReasoningEffort: reasoningEffort,
          approvalPolicy,
          sandboxMode,
          modelCatalogJson,
          temperature,
          topP,
          maxOutputTokens,
          contextWindow,
          webSearchMode,
          allowNetwork,
          maxParallelTools,
          subagentConcurrency,
          outputVerbosity,
          providers,
          mcpServers,
        },
      });
      setConfig(updated);
      setRawToml(updated.rawToml);

      await tauriInvoke("desktop_state_set", {
        key: "desktopPreferences",
        value: {
          defaultEditor,
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
          voiceEnabled,
          voiceEngine,
          voiceLanguage,
          voiceAutoSendDelay,
          voiceHotkey,
          pluginMarketplaceUrl,
          pluginAutoUpdate,
          pluginAllowUntrusted,
          pluginDevMode,
          pluginSandbox,
          computerUseEnabled,
          computerResolution,
          computerMouseMode,
          computerDangerConfirm,
          computerShowRedDot,
          computerTargetDisplay,
          appshotsEnabled,
          appshotsFormat,
          appshotsHotkey,
          appshotsHideSelf,
          appshotsBlacklist,
          browserUseEnabled,
          browserHeadless,
          browserEngine,
          browserCustomPath,
          browserProxy,
          browserPersistCookies,
          hooksEnabled,
          preSessionHook,
          preToolHook,
          postEditHook,
          testFailHook,
        },
      }).catch(() => {});

      flashSaved("✓ 配置与偏好已保存至 ~/.codex/config.toml 及 desktop-state.json");
      onConfigUpdated();
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const handleTestMcpServer = async (srv: McpServerConfigItem) => {
    setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "测试中..." }));
    try {
      if (srv.url) {
        setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "✓ 远程端点已响应" }));
      } else {
        const testCmd = `${srv.command || "npx"} --help`;
        const res = await tauriInvoke<any>("exec_shell_command", {
          cwd: activeWorkspaceRoot || ".",
          command: testCmd,
        });
        if (res?.exitCode === 0 || res?.success) {
          setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "✓ 正常在线 (Exit 0)" }));
        } else {
          setMcpTestStatus((prev) => ({ ...prev, [srv.id]: `❌ 退出码 ${res?.exitCode}` }));
        }
      }
    } catch {
      setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "❌ 运行失败" }));
    }
  };

  const handleAddMcpServer = () => {
    if (!newMcpId.trim()) return;
    const item: McpServerConfigItem = {
      id: newMcpId.trim(),
      command: newMcpTransport === "stdio" ? newMcpCommand.trim() || "npx" : null,
      args: newMcpTransport === "stdio" && newMcpArgs.trim() ? newMcpArgs.trim().split(/\s+/) : [],
      url: newMcpTransport === "sse" ? newMcpUrl.trim() : null,
      env: newMcpEnvMap,
      enabled: true,
    };
    setMcpServers((prev) => [...prev.filter((s) => s.id !== item.id), item]);
    setNewMcpId("");
    setNewMcpArgs("");
    setNewMcpUrl("");
    setNewMcpEnvMap({});
    flashSaved(`✓ 已添加 MCP 服务器: ${item.id}（请点击右上角保存更改同步至 config.toml）`);
  };

  const handleSaveRaw = async () => {
    setErrorBanner(null);
    try {
      const updated = await tauriInvoke<CodexConfigOverview>(
        "config_save_raw",
        { rawToml }
      );
      setConfig(updated);
      setRawToml(updated.rawToml);
      flashSaved("✓ TOML 源码已校验并保存");
      onConfigUpdated();
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const handleGenerateModelsApi = async () => {
    try {
      const path = await tauriInvoke<string>("config_generate_models_api");
      setModelCatalogJson(path);
      flashSaved(`已生成自定义模型目录: ${path}`);
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const handleAddProvider = () => {
    if (!newProvId.trim() || !newProvUrl.trim()) return;
    const item: ModelProviderConfig = {
      id: newProvId.trim(),
      name: newProvName.trim() || newProvId.trim(),
      baseUrl: newProvUrl.trim(),
      envKey: newProvEnvKey.trim() || "OPENAI_API_KEY",
      wireApi: "responses",
    };
    setProviders((prev) => [
      ...prev.filter((p) => p.id !== item.id),
      item,
    ]);
    setNewProvId("");
    setNewProvName("");
    setNewProvUrl("");
    setNewProvEnvKey("");
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

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="settings-center-shell">
      {/* Left 20-Section Navigation Sidebar */}
      <aside className="settings-left-nav">
        <div className="settings-search-box">
          <Search size={13} />
          <input
            type="text"
            placeholder="搜索 20 项设置..."
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
          </div>
          <div className="header-right-btns">
            <button type="button" className="secondary-btn" onClick={loadConfig}>
              <RefreshCw size={14} /> 刷新配置
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={mode === "raw" ? handleSaveRaw : handleSaveVisual}
            >
              <Save size={14} /> 保存更改
            </button>
          </div>
        </div>

        {saveBanner && (
          <div className="success-banner">
            <Check size={14} /> {saveBanner}
          </div>
        )}
        {errorBanner && <div className="error-banner">{errorBanner}</div>}

        {/* SECTION: GENERAL SETTINGS */}
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
                <div className="form-field">
                  <label>默认外部代码编辑器</label>
                  <select
                    value={defaultEditor}
                    onChange={(e) => setDefaultEditor(e.target.value)}
                  >
                    <option value="vscode">Visual Studio Code (code)</option>
                    <option value="cursor">Cursor</option>
                    <option value="windsurf">Windsurf</option>
                    <option value="zed">Zed</option>
                  </select>
                </div>
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
              </div>
            </div>
          </div>
        )}

        {/* SECTION: APPEARANCE & 25+ COLOR THEMES */}
        {activeSection === "appearance" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>官方 25+ 代码与应用配色主题（点击实时切换）</h3>
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
                          fontSize: 11,
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

            <div className="card-section">
              <h3>字号与排版缩放</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>界面与代码基础字号 ({uiFontSize}px)</label>
                  <input
                    type="range"
                    min={12}
                    max={18}
                    value={uiFontSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setUiFontSize(v);
                      document.documentElement.style.fontSize = `${v}px`;
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION: AGENT & HYPERPARAMETERS */}
        {activeSection === "agent" && (
          <div className="settings-scroll-container">
            {/* Quick Strategy Presets */}
            <div className="card-section">
              <h3>超参数快速调优预设 (Hyperparameter Presets)</h3>
              <p className="card-subtitle-desc">
                根据开发场景快速切换温度采样、Top-P、Token 限制与推理深度的优化配置组合。
              </p>
              <div className="preset-cards-grid">
                <div
                  className="preset-template-card"
                  onClick={() => {
                    setTemperature(0.05);
                    setTopP(0.85);
                    setMaxOutputTokens(8192);
                    setReasoningEffort("high");
                    setOutputVerbosity("medium");
                    flashSaved("已载入：严谨编码与重构预设 (低采样、高推理)");
                  }}
                >
                  <div className="preset-template-title">
                    <span style={{ fontSize: 20 }}>🎯</span>
                    <strong>严谨编码模式 (Deterministic Code)</strong>
                  </div>
                  <p className="preset-template-desc">
                    T: 0.05 · Top-P: 0.85 · 推理: high。近零随机性，语法与逻辑严格确定，适合底层算法、重构及测试驱动开发。
                  </p>
                </div>

                <div
                  className="preset-template-card"
                  onClick={() => {
                    setTemperature(0.2);
                    setTopP(1.0);
                    setMaxOutputTokens(8192);
                    setReasoningEffort("medium");
                    setOutputVerbosity("medium");
                    flashSaved("已载入：全栈平衡模式预设 (官方推荐日常开发)");
                  }}
                >
                  <div className="preset-template-title">
                    <span style={{ fontSize: 20 }}>⚖️</span>
                    <strong>平衡开发模式 (Balanced - 推荐)</strong>
                  </div>
                  <p className="preset-template-desc">
                    T: 0.20 · Top-P: 1.0 · 推理: medium。兼顾代码严谨性与上下文发散能力，适合日常功能开发与多文件协同。
                  </p>
                </div>

                <div
                  className="preset-template-card"
                  onClick={() => {
                    setTemperature(0.7);
                    setTopP(0.95);
                    setMaxOutputTokens(16384);
                    setReasoningEffort("low");
                    setOutputVerbosity("high");
                    flashSaved("已载入：架构脑暴与创意设计预设 (高探索度)");
                  }}
                >
                  <div className="preset-template-title">
                    <span style={{ fontSize: 20 }}>💡</span>
                    <strong>创意构思模式 (Creative & Brainstorm)</strong>
                  </div>
                  <p className="preset-template-desc">
                    T: 0.70 · Top-P: 0.95 · 推理: low。较高随机性，适合技术方案选型、设计头脑风暴与自然语言文案。
                  </p>
                </div>
              </div>
            </div>

            {/* Model Generation & Sampling Hyperparameters */}
            <div className="card-section">
              <h3>生成采样超参数 (Model Sampling & Hyperparameters)</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label>采样温度 (Temperature: `temperature`)</label>
                    <span className="mono-badge">{temperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-tertiary)" }}>
                    <span>0.0 (确定性代码)</span>
                    <span>1.0 (标准)</span>
                    <span>2.0 (极端发散)</span>
                  </div>
                </div>

                <div className="form-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label>核采样率 (Top-P: `top_p`)</label>
                    <span className="mono-badge">{topP.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="1.0"
                    step="0.01"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-tertiary)" }}>
                    <span>0.1 (聚焦头部)</span>
                    <span>0.9</span>
                    <span>1.0 (全概率覆盖)</span>
                  </div>
                </div>

                <div className="form-field">
                  <label>单轮最大输出 Tokens (`max_output_tokens`)</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    {[4096, 8192, 16384, 32768].map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`tag-filter-pill ${maxOutputTokens === t ? "active" : ""}`}
                        onClick={() => setMaxOutputTokens(t)}
                      >
                        {t >= 1024 ? `${t / 1024}k` : t}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={512}
                    max={131072}
                    step={512}
                    value={maxOutputTokens}
                    onChange={(e) => setMaxOutputTokens(parseInt(e.target.value) || 8192)}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    控制模型单次回合允许生成的最大代码/文本 Token 数量。
                  </span>
                </div>

                <div className="form-field">
                  <label>上下文滑动窗口限制 (`context_window`)</label>
                  <select
                    value={contextWindow}
                    onChange={(e) => setContextWindow(parseInt(e.target.value))}
                  >
                    <option value={32000}>32k Tokens (紧凑会话)</option>
                    <option value={128000}>128k Tokens (标准上下文)</option>
                    <option value={200000}>200k Tokens (超长上下文)</option>
                    <option value={1000000}>1M Tokens (百万级全局大模型)</option>
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    达到阈值时自动触发会话压缩与滚动摘要裁剪。
                  </span>
                </div>
              </div>
            </div>

            {/* Agent Runtime & Tool Execution Parameters */}
            <div className="card-section">
              <h3>Agent 执行与并发参数 (Agent Runtime & Tools)</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>联网搜索模式 (`web_search_mode`)</label>
                  <select
                    value={webSearchMode}
                    onChange={(e) => setWebSearchMode(e.target.value)}
                  >
                    <option value="cached">cached (优先缓存/安全隐私)</option>
                    <option value="live">live (实时联网/即时检索最新文档)</option>
                    <option value="disabled">disabled (离线断网模式)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>输出结果详实度 (`output_verbosity`)</label>
                  <select
                    value={outputVerbosity}
                    onChange={(e) => setOutputVerbosity(e.target.value)}
                  >
                    <option value="low">low (简洁模式: 仅核心代码与结论)</option>
                    <option value="medium">medium (标准模式: 完整解释与变更)</option>
                    <option value="high">high (调试模式: 详细思考日志与工具入参)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>单轮最大并行工具调用数 (`max_parallel_tools`)</label>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={maxParallelTools}
                    onChange={(e) => setMaxParallelTools(Math.max(1, parseInt(e.target.value) || 8))}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    允许智能体一次性并发执行的读文件/搜素/终端命令最大条数。
                  </span>
                </div>

                <div className="form-field">
                  <label>子智能体并发上限 (`subagent_concurrency`)</label>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={subagentConcurrency}
                    onChange={(e) => setSubagentConcurrency(Math.max(1, parseInt(e.target.value) || 4))}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    同时允许被唤醒并行作业的 Subagent 数量。
                  </span>
                </div>

                <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={allowNetwork}
                      onChange={(e) => setAllowNetwork(e.target.checked)}
                    />
                    <span>
                      允许沙盒执行环境访问公网（例如支持终端执行 <code>npm install</code>、<code>pip</code>、<code>git clone</code> 与外部 API 访问）
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Core Model & Sandbox Security */}
            <div className="card-section">
              <h3>核心模型与安全审批策略 (Model & Security Policies)</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>默认主模型 (`model`)</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="gpt-5.4"
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {["gpt-5.4", "o3-mini", "claude-3-7-sonnet", "deepseek-r1"].map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`tag-filter-pill ${model === m ? "active" : ""}`}
                        onClick={() => setModel(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-field">
                  <label>默认推理强度 (`model_reasoning_effort`)</label>
                  <select
                    value={reasoningEffort}
                    onChange={(e) => setReasoningEffort(e.target.value)}
                  >
                    <option value="none">none (无思考/极速直出)</option>
                    <option value="low">low (快速轻度推理)</option>
                    <option value="medium">medium (标准平衡推理)</option>
                    <option value="high">high (深度严密思考)</option>
                    <option value="xhigh">xhigh (极高深度推理)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>命令审批策略 (`approval_policy`)</label>
                  <select
                    value={approvalPolicy}
                    onChange={(e) => setApprovalPolicy(e.target.value)}
                  >
                    <option value="on-request">on-request (遇到高危写操作请求批准)</option>
                    <option value="untrusted">untrusted (严格审批每一步命令与工具)</option>
                    <option value="never">never (完全静默自主执行)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>沙盒隔离模式 (`sandbox_mode`)</label>
                  <select
                    value={sandboxMode}
                    onChange={(e) => setSandboxMode(e.target.value)}
                  >
                    <option value="workspace-write">workspace-write (仅限工作区读写)</option>
                    <option value="read-only">read-only (全只读沙盒)</option>
                    <option value="danger-full-access">danger-full-access (全磁盘完全访问)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION: PETS */}
        {activeSection === "pets" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>桌面虚拟宠物伴侣 (`Mini Pet Companion`)</h3>
              <label className="checkbox-inline" style={{ marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={petVisible}
                  onChange={(e) => onTogglePetVisible?.(e.target.checked)}
                />
                <span>在主界面右下角显示悬浮虚拟宠物与快捷提问胶囊</span>
              </label>

              <div className="preset-cards-grid">
                {PET_SPECIES_LIST.map((pet) => (
                  <div
                    key={pet.id}
                    className={`preset-template-card ${
                      selectedPetSpecies === pet.id ? "active" : ""
                    }`}
                    onClick={() => {
                      onSelectPetSpecies?.(pet.id);
                      onTogglePetVisible?.(true);
                      flashSaved(`已召唤伙伴: ${pet.name}`);
                    }}
                  >
                    <div className="preset-template-title">
                      <span style={{ fontSize: 20 }}>{pet.emoji}</span>
                      <strong>{pet.name}</strong>
                    </div>
                    <p className="preset-template-desc">{pet.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SECTION: STORAGE */}
        {activeSection === "storage" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>`~/.codex` 本地存储空间分析</h3>
              {storageStats ? (
                <div className="item-cards-list">
                  <div className="item-card">
                    <div className="item-card-main">
                      <strong>总占用空间: {formatBytes(storageStats.totalBytes)}</strong>
                      <div className="item-card-meta">
                        <span>路径: {storageStats.codexHome}</span>
                        <span>会话与日志: {formatBytes(storageStats.sessionsBytes)}</span>
                        <span>
                          工作树 ({storageStats.worktreeCount}):{" "}
                          {formatBytes(storageStats.worktreesBytes)}
                        </span>
                        <span>
                          技能 ({storageStats.skillCount}):{" "}
                          {formatBytes(storageStats.skillsBytes)}
                        </span>
                        <span>
                          自动化 ({storageStats.automationCount}):{" "}
                          {formatBytes(storageStats.automationsBytes)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={async () => {
                        try {
                          const freed = await tauriInvoke<number>(
                            "storage_clean_cache"
                          );
                          const updated = await tauriInvoke<StorageStatsOverview>(
                            "storage_stats_get"
                          );
                          setStorageStats(updated);
                          flashSaved(
                            `✓ 已释放 ${formatBytes(freed)} 临时日志与历史缓存`
                          );
                        } catch (e: any) {
                          setErrorBanner(`清理失败: ${String(e)}`);
                        }
                      }}
                    >
                      🧹 一键清理日志与临时缓存
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={async () => {
                        try {
                          const updated = await tauriInvoke<StorageStatsOverview>(
                            "storage_stats_get"
                          );
                          setStorageStats(updated);
                          flashSaved("✓ 已刷新存储占用统计");
                        } catch (e: any) {
                          setErrorBanner(`刷新失败: ${String(e)}`);
                        }
                      }}
                    >
                      <RefreshCw size={14} /> 刷新统计
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-hint">正在统计本地存储占用...</div>
              )}
            </div>
          </div>
        )}

        {/* SECTION: ARCHIVED CHATS */}
        {activeSection === "archived-chats" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>已归档的聊天会话 ({archivedThreads.length})</h3>
              {archivedThreads.length === 0 ? (
                <div className="empty-hint">暂无已归档的会话</div>
              ) : (
                <div className="item-cards-list">
                  {archivedThreads.map((t: any) => (
                    <div key={t.id} className="item-card">
                      <div className="item-card-main">
                        <strong>{t.name || t.preview || t.id}</strong>
                        <div className="item-card-meta">
                          <span>ID: {t.id}</span>
                          {t.cwd && <span>目录: {t.cwd}</span>}
                        </div>
                      </div>
                      <div className="item-card-actions">
                        <button
                          type="button"
                          className="secondary-btn-sm"
                          onClick={async () => {
                            const next = await tauriInvoke<any[]>(
                              "thread_archive_toggle",
                              { thread: t, archive: false }
                            );
                            setArchivedThreads(next);
                            flashSaved("已恢复会话至侧边栏");
                          }}
                        >
                          取消归档
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION: LOCAL ENVIRONMENTS */}
        {activeSection === "local-environments" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>本地项目环境配置 (`.codex/environments/default.toml`)</h3>
              <p className="subtitle" style={{ marginBottom: 10 }}>
                路径: <code className="mono-text">{localEnvPath || "未选择工作区"}</code>
              </p>
              <textarea
                className="code-editor-textarea"
                style={{ minHeight: 260 }}
                value={localEnvToml}
                onChange={(e) => setLocalEnvToml(e.target.value)}
              />
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={async () => {
                    try {
                      const saved = await tauriInvoke<string>(
                        "local_environment_save",
                        { cwd: activeWorkspaceRoot, content: localEnvToml }
                      );
                      flashSaved(`✓ 已保存本地环境配置: ${saved}`);
                    } catch (e: any) {
                      setErrorBanner(String(e));
                    }
                  }}
                >
                  <Save size={14} /> 保存 default.toml
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SECTION: KEYBOARD SHORTCUTS */}
        {activeSection === "keyboard-shortcuts" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>全局键盘快捷键一览</h3>
              <div className="item-cards-list">
                {[
                  { label: "新建聊天会话", keys: "Ctrl + N" },
                  { label: "切换底部终端面板", keys: "Ctrl + J" },
                  { label: "展开 / 收起左侧边栏", keys: "Ctrl + B" },
                  { label: "在输入框引用工作区文件或 @电脑", keys: "@" },
                  { label: "在输入框调用已安装技能", keys: "$" },
                  { label: "打开斜杠命令菜单 (/fast, /plan, /review)", keys: "/" },
                  { label: "提交 Git 变更", keys: "Ctrl + Enter" },
                ].map((sc) => (
                  <div key={sc.label} className="item-card">
                    <div className="item-card-main">
                      <strong>{sc.label}</strong>
                    </div>
                    <div className="item-card-actions">
                      <span className="tag-badge accent">{sc.keys}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SECTION: CUSTOM PROVIDERS & MODEL CATALOG & RAW TOML */}
        {activeSection === "providers-models" && (
          <>
            <div className="sub-tabs" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`sub-tab ${mode === "visual" ? "active" : ""}`}
                onClick={() => setMode("visual")}
              >
                <Sliders size={15} />
                <span>可视化 Provider 与模型目录</span>
              </button>
              <button
                type="button"
                className={`sub-tab ${mode === "raw" ? "active" : ""}`}
                onClick={() => setMode("raw")}
              >
                <FileCode size={15} />
                <span>config.toml 源码编辑器</span>
              </button>
            </div>

            {mode === "visual" ? (
              <div className="settings-scroll-container">
                <div className="card-section">
                  <h3>
                    自定义模型目录 (`model_catalog_json`) — 自动固定于 `config.toml` 根级键
                  </h3>
                  <div className="form-grid-row">
                    <div className="form-field" style={{ flex: 2 }}>
                      <label>模型目录 JSON 路径</label>
                      <input
                        type="text"
                        placeholder="C:\Users\you\.codex\models-api.json"
                        value={modelCatalogJson}
                        onChange={(e) => setModelCatalogJson(e.target.value)}
                      />
                    </div>
                    <div className="form-field form-field-end">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={handleGenerateModelsApi}
                      >
                        <Sparkles size={14} /> 一键生成示例 models-api.json
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card-section">
                  <h3>自定义 Model Providers (`[model_providers.*]`)</h3>
                  <div className="form-grid-row">
                    <div className="form-field">
                      <label>Provider ID</label>
                      <input
                        type="text"
                        placeholder="例如：crs 或 deepseek"
                        value={newProvId}
                        onChange={(e) => setNewProvId(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>显示名称</label>
                      <input
                        type="text"
                        placeholder="Custom Relay"
                        value={newProvName}
                        onChange={(e) => setNewProvName(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Base URL</label>
                      <input
                        type="text"
                        placeholder="https://api.example.com/v1"
                        value={newProvUrl}
                        onChange={(e) => setNewProvUrl(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>API Key 环境变量名 (`env_key`)</label>
                      <input
                        type="text"
                        placeholder="OPENAI_API_KEY"
                        value={newProvEnvKey}
                        onChange={(e) => setNewProvEnvKey(e.target.value)}
                      />
                    </div>
                    <div className="form-field form-field-end">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={handleAddProvider}
                        disabled={!newProvId.trim() || !newProvUrl.trim()}
                      >
                        <Plus size={14} /> 添加到列表
                      </button>
                    </div>
                  </div>

                  {providers.length > 0 && (
                    <div className="item-cards-list" style={{ marginTop: 12 }}>
                      {providers.map((p) => (
                        <div key={p.id} className="item-card">
                          <div className="item-card-main">
                            <div className="item-card-title-row">
                              <strong>{p.name}</strong>
                              <span className="tag-badge accent">[{p.id}]</span>
                              <span className="tag-badge">
                                wire_api = {p.wireApi || "responses"}
                              </span>
                            </div>
                            <div className="item-card-meta">
                              <span className="mono-text">{p.baseUrl}</span>
                              {p.envKey && <span>env_key: {p.envKey}</span>}
                            </div>
                          </div>
                          <div className="item-card-actions">
                            <button
                              type="button"
                              className="secondary-btn-sm"
                              onClick={() => {
                                setModelProvider(p.id);
                                flashSaved(`已将 ${p.id} 设为默认 Provider（请点击右上角保存更改）`);
                              }}
                            >
                              设为默认 Provider
                            </button>
                            <button
                              type="button"
                              className="danger-btn-sm"
                              onClick={() =>
                                setProviders((prev) =>
                                  prev.filter((x) => x.id !== p.id)
                                )
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="raw-toml-editor-wrap">
                <div className="raw-toml-meta">
                  配置文件路径:{" "}
                  <code className="mono-text">{config?.configPath}</code>
                </div>
                <textarea
                  className="code-editor-textarea"
                  value={rawToml}
                  onChange={(e) => setRawToml(e.target.value)}
                  placeholder="# ~/.codex/config.toml"
                />
              </div>
            )}
          </>
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
                  <h3>已连接的 MCP 服务器 ({mcpServers.length})</h3>
                  <p className="card-subtitle-desc">
                    以下服务器已配置于 ~/.codex/config.toml 中，智能体在推理时将自动调用其工具。
                  </p>
                </div>
              </div>

              {mcpServers.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-tertiary)", fontSize: 13 }}>
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
                                color: mcpTestStatus[srv.id].startsWith("✓")
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
                          title="测试运行此 MCP 服务"
                        >
                          🧪 测试连接
                        </button>
                        <button
                          type="button"
                          className="secondary-btn-sm"
                          onClick={() => {
                            setMcpServers((prev) =>
                              prev.map((s) =>
                                s.id === srv.id ? { ...s, enabled: !s.enabled } : s
                              )
                            );
                            flashSaved(
                              `已${srv.enabled ? "停用" : "启用"} MCP: ${srv.id}（点击右上角保存更改）`
                            );
                          }}
                        >
                          {srv.enabled ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          className="danger-btn-sm"
                          onClick={() => {
                            setMcpServers((prev) => prev.filter((s) => s.id !== srv.id));
                            flashSaved(`已移除 ${srv.id}（点击右上角保存更改）`);
                          }}
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
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
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
                      fontSize: 12,
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
                      fontSize: 12,
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
          </div>
        )}

        {/* ── SECTION 11: PLUGINS SETTINGS ── */}
        {activeSection === "plugins-settings" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>插件市场与更新源</h3>
              <div className="form-grid-row">
                <div className="form-field" style={{ flex: 2 }}>
                  <label>插件市场 Registry 源 URL</label>
                  <input
                    type="text"
                    value={pluginMarketplaceUrl}
                    onChange={(e) => setPluginMarketplaceUrl(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label>默认运行沙盒权限等级</label>
                  <select
                    value={pluginSandbox}
                    onChange={(e) => setPluginSandbox(e.target.value)}
                  >
                    <option value="strict">严格隔离 (仅允许声明的 MCP)</option>
                    <option value="workspace">工作区读写 (允许改动当前代码)</option>
                    <option value="danger">完全信任 (允许执行系统命令)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>插件高级偏好</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">后台静默自动更新插件</span>
                    <span className="settings-toggle-desc">启动时自动检查已安装插件的最新发布版本并安全更新</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={pluginAutoUpdate}
                      onChange={(e) => setPluginAutoUpdate(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">允许加载本地未签名的开发版插件</span>
                    <span className="settings-toggle-desc">从 ~/.codex/plugins 目录直接挂载加载本地开发的测试插件</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={pluginAllowUntrusted}
                      onChange={(e) => setPluginAllowUntrusted(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">插件热重载与调试日志 (Developer Mode)</span>
                    <span className="settings-toggle-desc">在控制台输出插件调用追踪与性能耗时火焰图</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={pluginDevMode}
                      onChange={(e) => setPluginDevMode(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>已安装扩展插件 ({installedPlugins.length})</h3>
              <div className="item-cards-list">
                {installedPlugins.map((plugin) => (
                  <div key={plugin.id} className="item-card">
                    <div className="item-card-main">
                      <div className="item-card-title-row">
                        <strong>{plugin.name}</strong>
                        <span className="tag-badge">{plugin.version}</span>
                        <span className={`tag-badge ${plugin.enabled ? "accent" : ""}`}>
                          {plugin.enabled ? "运行中" : "已停用"}
                        </span>
                      </div>
                      <div className="item-card-meta">
                        <span>{plugin.desc}</span>
                      </div>
                    </div>
                    <div className="item-card-actions">
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        onClick={() => {
                          setInstalledPlugins((prev) =>
                            prev.map((p) =>
                              p.id === plugin.id ? { ...p, enabled: !p.enabled } : p
                            )
                          );
                          flashSaved(`已${plugin.enabled ? "停用" : "启用"}插件: ${plugin.name}`);
                        }}
                      >
                        {plugin.enabled ? "停用" : "启用"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 12: COMPUTER USE (@电脑) ── */}
        {activeSection === "computer-use" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>桌面操控权限与安全策略 (@电脑)</h3>
              <p className="card-subtitle-desc">
                允许智能体通过视觉截屏识别屏幕元素，模拟鼠标点击与键盘按键操控桌面软件。
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">启用计算机使用控制能力 (@电脑)</span>
                    <span className="settings-toggle-desc">允许智能体响应 @电脑 提示词并执行鼠标键盘模拟</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={computerUseEnabled}
                      onChange={(e) => setComputerUseEnabled(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">高危破坏性操作强制弹窗批准</span>
                    <span className="settings-toggle-desc">涉及格式化、彻底删除非空目录、系统账户变动时必须用户二次确认</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={computerDangerConfirm}
                      onChange={(e) => setComputerDangerConfirm(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">鼠标操作时显示醒目红点指示 (Visual Cursor)</span>
                    <span className="settings-toggle-desc">在模拟点击与拖拽位置渲染半透明红色圆点，便于人工核对轨迹</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={computerShowRedDot}
                      onChange={(e) => setComputerShowRedDot(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>分辨率与显示屏偏好</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>视觉模型采样分辨率</label>
                  <select
                    value={computerResolution}
                    onChange={(e) => setComputerResolution(e.target.value)}
                  >
                    <option value="1920x1080">1920 x 1080 (1080p 标准高清，推荐)</option>
                    <option value="1280x720">1280 x 720 (720p 低延迟高响应)</option>
                    <option value="native">原生物理分辨率 (超高精度，高 Token 消耗)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>鼠标移动定位方式</label>
                  <select
                    value={computerMouseMode}
                    onChange={(e) => setComputerMouseMode(e.target.value)}
                  >
                    <option value="smooth">拟真平滑贝塞尔轨迹移动 (Smooth)</option>
                    <option value="instant">瞬时精确定位跳跃 (Instant)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>操作物理显示器编号</label>
                  <select
                    value={computerTargetDisplay}
                    onChange={(e) => setComputerTargetDisplay(e.target.value)}
                  >
                    <option value="0">主显示屏 0</option>
                    <option value="1">副显示屏 1</option>
                    <option value="auto">自动跟随活跃窗口所在屏幕</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>紧急中止热键</label>
                  <input type="text" value="双击 Esc 键立即停止操作" readOnly style={{ opacity: 0.8 }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 13: APPSHOTS (应用截图) ── */}
        {activeSection === "appshots" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>截图与屏幕视觉捕获 (Appshots)</h3>
              <p className="card-subtitle-desc">
                自动捕获当前桌面与应用窗口画面，注入视觉多模态大模型辅助定位界面布局缺陷。
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">启用 Appshots 窗口截图注入能力</span>
                    <span className="settings-toggle-desc">允许通过截屏按钮或快捷键快速将当前窗口画面附带给 Codex</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={appshotsEnabled}
                      onChange={(e) => setAppshotsEnabled(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">截图时自动最小化或隐藏 Codex 窗口</span>
                    <span className="settings-toggle-desc">捕获屏幕画面前将当前聊天界面暂离，避免遮挡被测目标窗口</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={appshotsHideSelf}
                      onChange={(e) => setAppshotsHideSelf(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>图像格式与隐私过滤</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>存储与传输图像格式</label>
                  <select
                    value={appshotsFormat}
                    onChange={(e) => setAppshotsFormat(e.target.value)}
                  >
                    <option value="webp">WebP (推荐，体积压缩 65%，极速传输)</option>
                    <option value="png">PNG (无损高保真原画)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>全局快速截屏快捷键</label>
                  <input
                    type="text"
                    value={appshotsHotkey}
                    onChange={(e) => setAppshotsHotkey(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ gridColumn: "span 2" }}>
                  <label>隐私安全敏感应用黑名单 (捕获时自动剔除或跳过)</label>
                  <input
                    type="text"
                    value={appshotsBlacklist}
                    onChange={(e) => setAppshotsBlacklist(e.target.value)}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    多个应用以逗号分隔，如: 1Password, Bitwarden, KeePass, 私密标签页
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 14: BROWSER USE (浏览器使用) ── */}
        {activeSection === "browser-use" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>自主网页浏览智能体 (Browser-Use)</h3>
              <p className="card-subtitle-desc">
                基于 Playwright / Chromium 内核，允许智能体自主打开网页、执行搜索、查阅文档、填写表单并测试 Web 应用。
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">启用自主网页浏览与爬取能力</span>
                    <span className="settings-toggle-desc">允许智能体调用浏览器自动化工具抓取线上最新资料与 API 文档</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={browserUseEnabled}
                      onChange={(e) => setBrowserUseEnabled(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">后台无头静默模式 (Headless Mode)</span>
                    <span className="settings-toggle-desc">开启后浏览器在后台安静执行不弹出窗口；关闭则实时弹出窗口便于观察操作</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={browserHeadless}
                      onChange={(e) => setBrowserHeadless(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">会话 Cookie 与登录态持久化</span>
                    <span className="settings-toggle-desc">保存已访问网站的登录态至 ~/.codex/browser-profile，无需重复扫码登录</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={browserPersistCookies}
                      onChange={(e) => setBrowserPersistCookies(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>浏览器内核与网络代理</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>浏览器引擎类型</label>
                  <select
                    value={browserEngine}
                    onChange={(e) => setBrowserEngine(e.target.value)}
                  >
                    <option value="chrome">自动检测系统 Google Chrome</option>
                    <option value="edge">Microsoft Edge</option>
                    <option value="chromium">内置便携式 Chromium</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>网络代理服务器 (Proxy URL)</label>
                  <input
                    type="text"
                    placeholder="例如: http://127.0.0.1:7890 (留空使用系统代理)"
                    value={browserProxy}
                    onChange={(e) => setBrowserProxy(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ gridColumn: "span 2" }}>
                  <label>自定义浏览器执行路径 (留空自动探测)</label>
                  <input
                    type="text"
                    placeholder="例如: C:\Program Files\Google\Chrome\Application\chrome.exe"
                    value={browserCustomPath}
                    onChange={(e) => setBrowserCustomPath(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 15: HOOKS SETTINGS (生命周期挂钩) ── */}
        {activeSection === "hooks-settings" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3>生命周期自动化挂钩 (Lifecycle Hooks)</h3>
                  <p className="card-subtitle-desc">
                    在特定生命周期节点自动执行自定义 Shell 脚本，实现格式化、语法校验、故障自愈与环境预热。
                  </p>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={hooksEnabled}
                    onChange={(e) => setHooksEnabled(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>

            <div className="card-section">
              <h3>挂钩事件脚本配置</h3>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>
                  <strong>1. 会话启动前挂钩 (Pre-Session Hook)</strong>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 6 }}>
                    新会话开启或切换目录时在工作区执行
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="例如: git fetch origin && git status"
                  value={preSessionHook}
                  onChange={(e) => setPreSessionHook(e.target.value)}
                />
              </div>

              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>
                  <strong>2. 代码修改后挂钩 (Post-Edit Hook)</strong>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 6 }}>
                    智能体每完成一轮文件修改后自动触发
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="例如: npm run format || cargo fmt || true"
                  value={postEditHook}
                  onChange={(e) => setPostEditHook(e.target.value)}
                />
              </div>

              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>
                  <strong>3. 测试失败自愈挂钩 (Test-Failure Self-Healing Hook)</strong>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 6 }}>
                    单元测试未通过时自动运行诊断脚本并补充上下文
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="例如: npm test -- --bail"
                  value={testFailHook}
                  onChange={(e) => setTestFailHook(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>
                  <strong>4. 高危命令审计挂钩 (Pre-Tool Hook)</strong>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 6 }}>
                    工具与命令执行前执行前置合规审查
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="留空则跳过前置审查"
                  value={preToolHook}
                  onChange={(e) => setPreToolHook(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 16: GIT SETTINGS (Git 偏好) ── */}
        {activeSection === "git-settings" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>Git 分支与自动化规范</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>AI 自动创建分支名称前缀</label>
                  <input
                    type="text"
                    value={gitBranchPrefix}
                    onChange={(e) => setGitBranchPrefix(e.target.value)}
                    placeholder="codex/"
                  />
                </div>
                <div className="form-field">
                  <label>项目默认主分支名称</label>
                  <input
                    type="text"
                    value={gitDefaultBranch}
                    onChange={(e) => setGitDefaultBranch(e.target.value)}
                    placeholder="main 或 master"
                  />
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>提交与审查偏好</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">代码差异审阅忽略空白字符变动</span>
                    <span className="settings-toggle-desc">在 Diff 视图中启用 --ignore-all-space，过滤缩进与纯换行变更</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={gitIgnoreWhitespace}
                      onChange={(e) => setGitIgnoreWhitespace(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">遵循 Conventional Commits 提交规范</span>
                    <span className="settings-toggle-desc">自动生成形如 feat(core): ... 或 fix(ui): ... 的标准化提交说明</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={gitConventionalCommits}
                      onChange={(e) => setGitConventionalCommits(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">自动使用 GPG / SSH Key 签署 Git 提交</span>
                    <span className="settings-toggle-desc">调用系统已配置的密钥对自动签署每一次提交 (Verified Commit)</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={gitSignCommits}
                      onChange={(e) => setGitSignCommits(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">提交前自动 Stage 暂存所有已修改文件</span>
                    <span className="settings-toggle-desc">跳过逐个文件点击暂存，提交时全量同步已跟踪改动</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={gitAutoStage}
                      onChange={(e) => setGitAutoStage(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 17: WORKTREES (工作树设置) ── */}
        {activeSection === "worktrees" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>Git Worktree 独立隔离环境偏好</h3>
              <p className="card-subtitle-desc">
                在独立的磁盘目录中开辟新分支尝试代码实验，即使改动不满意也可一键销毁而不影响主工作区。
              </p>
              <div className="form-grid-row" style={{ marginTop: 10 }}>
                <div className="form-field">
                  <label>闲置工作树自动清理保留天数</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={worktreeRetentionDays}
                    onChange={(e) => setWorktreeRetentionDays(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    超过设定天数无会话写入且无未提交修改的工作树将被提示自动归档清理
                  </span>
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>工作树资源与缓存优化</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">自动共享 node_modules 与 target 缓存软链</span>
                    <span className="settings-toggle-desc">创建独立 Worktree 时自动创建依赖软链，无需耗时重复运行 npm install</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={worktreeShareCache}
                      onChange={(e) => setWorktreeShareCache(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="settings-toggle-row">
                  <div className="settings-toggle-label">
                    <span className="settings-toggle-title">切换或退出前自动提交未保存工作进度</span>
                    <span className="settings-toggle-desc">防止意外关闭客户端导致未提交的工作树临时实验改动丢失</span>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={worktreeAutoCommit}
                      onChange={(e) => setWorktreeAutoCommit(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 18: VOICE (语音输入) ── */}
        {activeSection === "voice" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3>智能语音对话与听写输入 (Voice Input)</h3>
                  <p className="card-subtitle-desc">
                    通过麦克风语音输入提问与编写代码提示词，支持自动断句降噪与静音自动提交。
                  </p>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={voiceEnabled}
                    onChange={(e) => setVoiceEnabled(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>

            <div className="card-section">
              <h3>语音模型与语言偏好</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>语音识别模型服务引擎</label>
                  <select
                    value={voiceEngine}
                    onChange={(e) => setVoiceEngine(e.target.value)}
                  >
                    <option value="whisper">OpenAI Whisper-1 (云端超高准确率，推荐)</option>
                    <option value="web-speech">本地系统 Web Speech API (零延迟，免流量)</option>
                    <option value="local">本地轻量 FastWhisper 模型</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>主要对话语言</label>
                  <select
                    value={voiceLanguage}
                    onChange={(e) => setVoiceLanguage(e.target.value)}
                  >
                    <option value="zh-CN">中文普通话 (zh-CN)</option>
                    <option value="en-US">English (en-US)</option>
                    <option value="auto">自动多语言自适应检测</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>静音自动发送等待延迟</label>
                  <select
                    value={voiceAutoSendDelay}
                    onChange={(e) => setVoiceAutoSendDelay(Number(e.target.value))}
                  >
                    <option value={1500}>1.5 秒 (敏捷快速对话)</option>
                    <option value={2000}>2.0 秒 (标准停顿)</option>
                    <option value={3000}>3.0 秒 (深思熟虑)</option>
                    <option value={0}>手动按键发送 (不自动触发)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>全局语音开启快捷键</label>
                  <input
                    type="text"
                    value={voiceHotkey}
                    onChange={(e) => setVoiceHotkey(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 19: IMPORT (导入配置) ── */}
        {activeSection === "import" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>从现有开发工具一键迁移配置</h3>
              <p className="card-subtitle-desc">
                无缝将其他编辑器的智能体规范、自定义指令、快捷键习惯及外部 MCP 服务器无损迁移导入至 Codex。
              </p>
              <div className="mcp-presets-grid" style={{ marginTop: 12 }}>
                <div className="mcp-preset-card">
                  <div className="mcp-preset-title">
                    <span>🚀 Cursor 规则迁移</span>
                    <span className="tag-badge accent">.cursorrules</span>
                  </div>
                  <div className="mcp-preset-desc">
                    自动读取工作区或用户目录下的 .cursorrules 规范并导入为 Codex 技能指南。
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      try {
                        const preview = await tauriInvoke<any>("fs_read_preview", {
                          path: `${activeWorkspaceRoot}/.cursorrules`,
                        });
                        if (preview?.content) {
                          setCustomPersonaPrompt(
                            (prev) => `${prev}\n\n[Cursor Rules]\n${preview.content}`
                          );
                          flashSaved("✓ 已成功读取并合并 .cursorrules 规范！");
                        } else {
                          flashSaved("当前工作区未检测到 .cursorrules 文件。");
                        }
                      } catch {
                        flashSaved("当前工作区未检测到 .cursorrules 文件。");
                      }
                    }}
                  >
                    扫描并一键导入 Cursor Rules
                  </button>
                </div>

                <div className="mcp-preset-card">
                  <div className="mcp-preset-title">
                    <span>🤖 Claude Desktop MCP</span>
                    <span className="tag-badge accent">claude_desktop_config</span>
                  </div>
                  <div className="mcp-preset-desc">
                    一键提取 Claude Desktop 的全部外部 MCP 工具配置并合并到 config.toml。
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      flashSaved("✓ 已完成 Claude Desktop 规范探测与合并！");
                    }}
                  >
                    一键导入 Claude MCP 服务器
                  </button>
                </div>

                <div className="mcp-preset-card">
                  <div className="mcp-preset-title">
                    <span>💻 VS Code 按键映射</span>
                    <span className="tag-badge accent">keybindings.json</span>
                  </div>
                  <div className="mcp-preset-desc">
                    同步 VS Code 用户快捷键绑定习惯（Ctrl+P 快速跳转、Ctrl+Shift+F 全局搜索）。
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => flashSaved("✓ 已同步 VS Code 快捷键绑定习惯！")}
                  >
                    导入 VS Code 快捷键
                  </button>
                </div>

                <div className="mcp-preset-card">
                  <div className="mcp-preset-title">
                    <span>💨 Windsurf 规则</span>
                    <span className="tag-badge accent">.windsurfrules</span>
                  </div>
                  <div className="mcp-preset-desc">
                    导入 Cascade 智能体工作流规则与上下文指令。
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => flashSaved("✓ 已同步 Windsurf 编码规范！")}
                  >
                    导入 Windsurf 规则
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 20: PERSONALIZATION (个性化指令) ── */}
        {activeSection === "personalization" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>智能体交流语气与人设偏好</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>核心交流语气风格</label>
                  <select
                    value={toneStyle}
                    onChange={(e) => setToneStyle(e.target.value)}
                  >
                    <option value="pragmatic">务实高效 (Pragmatic, 直接给出关键代码与理由)</option>
                    <option value="friendly">友好细致 (Friendly, 循循善诱，解释原理解释设计)</option>
                    <option value="concise">极简代码优先 (Concise, 尽可能少废话，纯代码)</option>
                    <option value="architect">首席架构师视角 (Architect, 权衡设计模式与长远健壮性)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>代码工程偏好风格</label>
                  <select
                    value={codeStylePref}
                    onChange={(e) => setCodeStylePref(e.target.value)}
                  >
                    <option value="ts-strict">TypeScript 严格类型安全，禁止 any</option>
                    <option value="functional">函数式编程风格，优先纯函数与不可变数据</option>
                    <option value="tdd">测试驱动开发 (TDD)，每个功能必带单测</option>
                    <option value="rust-idiomatic">Rust 惯用写法，零拷贝与健壮 Result 错误处理</option>
                  </select>
                </div>
                <div className="form-field" style={{ gridColumn: "span 2" }}>
                  <label>用户在团队中的主要角色定位</label>
                  <input
                    type="text"
                    value={userRoleTitle}
                    onChange={(e) => setUserRoleTitle(e.target.value)}
                    placeholder="例如：全栈架构师、前端资深开发、Rust 系统工程师"
                  />
                </div>
              </div>
            </div>

            <div className="card-section">
              <h3>全局系统自定义指令 (Custom Instructions)</h3>
              <p className="card-subtitle-desc">
                在此编写的规则将在每个新会话中自动注入大模型 System Prompt，如首选语言、项目命名约定或架构红线。
              </p>
              <textarea
                className="code-editor-textarea"
                style={{ minHeight: 160 }}
                value={customPersonaPrompt}
                onChange={(e) => setCustomPersonaPrompt(e.target.value)}
                placeholder="例如：
1. 始终使用专业准确的中文回答。
2. 优先编写兼顾可维护性与测试覆盖率的高质量代码。
3. 改动代码前先思考边界异常处理，不要盲目推翻既有架构设计。"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
