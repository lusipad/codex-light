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
  APPROVAL_POLICY_OPTIONS,
  APPROVALS_REVIEWER_OPTIONS,
  GRANULAR_APPROVAL_POLICY,
  MODEL_VERBOSITY_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  SANDBOX_MODE_OPTIONS,
  VALID_CONFIG_KEYS,
  WEB_SEARCH_MODE_OPTIONS,
  accountRateLimitsRead,
  accountRead,
  accountUsageRead,
  configRead,
  configRequirementsRead,
  experimentalFeatureListAll,
  experimentalFeatureSetEnablement,
  getConfigValue,
  mcpServerReload,
  setConfigKeys,
  type AccountRateLimitsResult,
  type AccountReadResult,
  type AccountUsageResult,
  type ConfigEdit,
  type ExperimentalFeature,
  type ExperimentalFeatureStage,
} from "../config";
import {
  listHooks,
  subscribeHookEvents,
  type HookInfo,
  type HookLiveEvent,
  type HooksListResult,
} from "../hooksClient";
import { SHORTCUTS } from "../shortcuts";
import {
  AppServerStatus,
  CodexConfigOverview,
  ModelInfo,
  ModelProviderConfig,
  McpServerConfigItem,
  MainViewRoute,
  PetSpeciesId,
  InstalledPetItem,
  PET_SPECIES_LIST,
  SettingsSectionSlug,
  StorageStatsOverview,
} from "../types";
import {
  listInstalledPlugins,
  pluginDisplayName,
  pluginDescription,
  pluginVersion,
  type PluginSummary,
} from "../plugins";

export interface ThemePalette {
  id: string;
  name: string;
  bgPrimary: string;
  bgSecondary: string;
  accent: string;
  textPrimary: string;
}

/* Group labels/order for the real keyboard shortcut registry (src/shortcuts.ts). */
const SHORTCUT_GROUP_LABELS: Record<string, string> = {
  global: "全局",
  thread: "会话",
  composer: "输入框",
  panels: "面板与视图",
};
const SHORTCUT_GROUP_ORDER: string[] = ["global", "thread", "composer", "panels"];

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

const REASONING_EFFORT_LABELS: Record<string, string> = {
  low: "low (快速轻度推理)",
  medium: "medium (标准平衡推理)",
  high: "high (深度严密思考)",
  xhigh: "xhigh (极高深度推理)",
  max: "max (最大推理预算)",
  ultra: "ultra (极限推理)",
};

const APPROVAL_POLICY_LABELS: Record<string, string> = {
  untrusted: "untrusted (旧版严格模式；app-server 0.159 已弃用，保存时改写为 granular 严格档)",
  "on-request": "on-request (按需：遇到高风险操作时请求批准)",
  granular: "granular (细粒度：分别控制沙盒/规则/MCP 询问)",
  never: "never (从不询问，完全静默执行)",
};

const APPROVALS_REVIEWER_LABELS: Record<string, string> = {
  user: "user (由我本人审批，默认)",
  auto_review: "auto_review (由审查子智能体自动风险评估)",
  guardian_subagent: "guardian_subagent (旧版兼容值，加载时归一化为 auto_review)",
};

const SANDBOX_MODE_LABELS: Record<string, string> = {
  "read-only": "read-only (全只读沙盒)",
  "workspace-write": "workspace-write (仅限工作区读写)",
  "danger-full-access": "danger-full-access (全磁盘完全访问，谨慎)",
};

const MODEL_VERBOSITY_LABELS: Record<string, string> = {
  low: "low (简洁：仅核心代码与结论)",
  medium: "medium (标准：完整解释与变更)",
  high: "high (详细：更长的说明与推理摘要)",
};

const WEB_SEARCH_MODE_LABELS: Record<string, string> = {
  disabled: "disabled (禁用联网搜索)",
  cached: "cached (优先使用缓存索引，隐私友好)",
  indexed: "indexed (使用索引搜索，不直接抓取实时页面)",
  live: "live (实时联网抓取最新内容)",
};

const EXPERIMENTAL_STAGE_LABELS: Record<ExperimentalFeatureStage, string> = {
  beta: "Beta 公测",
  underDevelopment: "开发中",
  stable: "稳定",
  deprecated: "已弃用",
  removed: "已移除",
};

const EXPERIMENTAL_STAGE_ORDER: ExperimentalFeatureStage[] = [
  "beta",
  "underDevelopment",
  "stable",
  "deprecated",
  "removed",
];

const HOOK_EVENT_LABELS: Record<string, string> = {
  preToolUse: "preToolUse · 工具执行前",
  permissionRequest: "permissionRequest · 审批请求",
  postToolUse: "postToolUse · 工具执行后",
  preCompact: "preCompact · 压缩前",
  postCompact: "postCompact · 压缩后",
  sessionStart: "sessionStart · 会话开始",
  sessionEnd: "sessionEnd · 会话结束",
  userPromptSubmit: "userPromptSubmit · 提交提示词",
  subagentStart: "subagentStart · 子智能体开始",
  subagentStop: "subagentStop · 子智能体结束",
  stop: "stop · 回合结束",
  interrupt: "interrupt · 中断",
};

const HOOK_HANDLER_LABELS: Record<string, string> = {
  command: "command",
  mcpTool: "mcpTool",
  prompt: "prompt",
  agent: "agent",
};

const HOOK_RUN_STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  blocked: "已阻止",
  stopped: "已停止",
};

const HOOK_SOURCE_LABELS: Record<string, string> = {
  system: "系统",
  user: "用户 ~/.codex",
  project: "项目 .codex",
  mdm: "MDM 托管",
  sessionFlags: "会话参数",
  plugin: "插件",
  cloudRequirements: "云端要求",
  cloudManagedConfig: "云端托管",
  legacyManagedConfigFile: "旧版托管文件",
  legacyManagedConfigMdm: "旧版托管 MDM",
  unknown: "未知",
};

const HOOK_TRUST_LABELS: Record<string, string> = {
  managed: "托管",
  untrusted: "未信任",
  trusted: "已信任",
  modified: "已修改",
};

/** Merge a hook live notification into the recent-run list (max 20, started→completed in place). */
function mergeHookRunRecords(
  previous: HookLiveEvent[],
  event: HookLiveEvent
): HookLiveEvent[] {
  const next = [...previous];
  let index = event.hookId
    ? next.findIndex((run) => run.hookId === event.hookId)
    : -1;
  if (index < 0 && event.kind === "completed") {
    // Some runs report a different id on completion: bind to the running placeholder.
    index = next.findIndex(
      (run) =>
        (run.status === "running" || run.kind === "started") &&
        run.eventName === event.eventName &&
        run.sourcePath === event.sourcePath
    );
  }
  if (index >= 0) {
    next[index] = { ...next[index], ...event };
    return next;
  }
  return [event, ...next].slice(0, 20);
}

const SETTINGS_NAV_GROUPS: Array<{
  groupTitle: string;
  items: Array<{ slug: SettingsSectionSlug; label: string; keywords: string }>;
}> = [
  {
    groupTitle: "个人 (Personal)",
    items: [
      { slug: "general-settings", label: "常规设置", keywords: "general editor notification sleep" },
      { slug: "account", label: "账号与额度", keywords: "account plan usage rate limit quota credits 账号 额度 用量 计划" },
      { slug: "import", label: "导入配置", keywords: "import cursor vscode windsurf claude" },
      { slug: "appearance", label: "外观与主题", keywords: "appearance theme font color" },
      { slug: "archived-chats", label: "已归档聊天", keywords: "archived chats history restore" },
      { slug: "voice", label: "语音输入", keywords: "voice dictation microphone" },
      { slug: "storage", label: "存储空间", keywords: "storage disk cache worktree" },
      { slug: "agent", label: "智能体与模型参数", keywords: "agent model provider reasoning approval sandbox verbosity web_search instructions 模型 推理 审批 沙盒 指令" },
      { slug: "personalization", label: "个性化指令", keywords: "personalization tone instructions" },
      { slug: "pets", label: "虚拟宠物伴侣", keywords: "pets companion mini widget" },
      { slug: "keyboard-shortcuts", label: "键盘快捷键", keywords: "shortcuts keybindings hotkeys" },
      { slug: "notifications", label: "通知与免打扰", keywords: "notifications desktop toast sound do not disturb 通知 免打扰" },
    ],
  },
  {
    groupTitle: "集成 (Integrations)",
    items: [
      { slug: "plugins-settings", label: "插件设置 (Plugins)", keywords: "plugins marketplace auto update 插件 技能" },
    ],
  },
  {
    groupTitle: "编码 (Coding)",
    items: [
      { slug: "experimental", label: "实验特性", keywords: "experimental features flags beta stage 实验 特性 开关" },
      { slug: "hooks-settings", label: "生命周期挂钩 (Hooks)", keywords: "hooks hooks.json preToolUse postToolUse stop 运行 实时 生命周期 挂钩" },
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

/** Settings sections that currently only persist local preferences (no executor yet). */
const LOCAL_ONLY_SETTINGS_SECTIONS: SettingsSectionSlug[] = [
  "git-settings",
  "worktrees",
  "voice",
  "plugins-settings",
  "pets",
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
  installedPets?: InstalledPetItem[];
  onSelectPetSpecies?: (species: PetSpeciesId) => void;
  petVisible?: boolean;
  onTogglePetVisible?: (visible: boolean) => void;
  onRestartAppServer: (customCliPath?: string) => void;
  onConfigUpdated: () => void;
  onNavigateRoute?: (route: MainViewRoute) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  appServerStatus,
  models,
  activeWorkspaceRoot = "",
  initialSection = "general-settings",
  selectedPetSpecies = "codex",
  installedPets = [],
  onSelectPetSpecies,
  petVisible = false,
  onTogglePetVisible,
  onRestartAppServer,
  onConfigUpdated,
  onNavigateRoute,
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

  // Real, protocol-backed runtime settings (only valid config.toml keys)
  const [webSearchMode, setWebSearchMode] = useState<string>("cached");
  const [modelVerbosity, setModelVerbosity] = useState<string>("medium");
  const [approvalsReviewer, setApprovalsReviewer] = useState<string>("user");
  const [protocolConfig, setProtocolConfig] = useState<Record<string, unknown> | null>(null);
  const [protocolConfigAvailable, setProtocolConfigAvailable] = useState<boolean>(false);
  const [managedRequirements, setManagedRequirements] = useState<Record<string, unknown> | null>(null);
  const [providersSnapshot, setProvidersSnapshot] = useState<string>("[]");
  const [mcpServersSnapshot, setMcpServersSnapshot] = useState<string>("[]");

  // Experimental features (experimentalFeature/*)
  const [experimentalFeatures, setExperimentalFeatures] = useState<ExperimentalFeature[]>([]);
  const [experimentalLoading, setExperimentalLoading] = useState<boolean>(false);
  const [experimentalError, setExperimentalError] = useState<string | null>(null);
  const [experimentalSearch, setExperimentalSearch] = useState<string>("");
  const [experimentalStage, setExperimentalStage] = useState<"all" | ExperimentalFeatureStage>("all");
  const [experimentalSaving, setExperimentalSaving] = useState<Record<string, boolean>>({});

  // Account & quota (account/*) — read only
  const [accountInfo, setAccountInfo] = useState<AccountReadResult | null>(null);
  const [accountRateLimits, setAccountRateLimits] = useState<AccountRateLimitsResult | null>(null);
  const [accountUsage, setAccountUsage] = useState<AccountUsageResult | null>(null);
  const [accountLoading, setAccountLoading] = useState<boolean>(false);
  const [accountError, setAccountError] = useState<string | null>(null);

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

  // Plugins Settings State (Real protocol & directory backed)
  const [pluginMarketplaceUrl, setPluginMarketplaceUrl] = useState<string>("https://plugins.codex.sh/registry");
  const [pluginAutoUpdate, setPluginAutoUpdate] = useState<boolean>(true);
  const [pluginAllowUntrusted, setPluginAllowUntrusted] = useState<boolean>(false);
  const [pluginDevMode, setPluginDevMode] = useState<boolean>(false);
  const [pluginSandbox, setPluginSandbox] = useState<string>("workspace");
  const [realPlugins, setRealPlugins] = useState<PluginSummary[]>([]);
  const [loadingRealPlugins, setLoadingRealPlugins] = useState<boolean>(false);

  // Pet Visibility & Size (1:1 with official pets.txt)
  const [petVisibility, setPetVisibility] = useState<"always-visible" | "on-demand">("always-visible");
  const [petScale, setPetScale] = useState<number>(1.0);

  // Hooks Settings (生命周期挂钩) — real data via hooks/list + live hook/* notifications
  const [hooksEnabled, setHooksEnabled] = useState<boolean>(true);
  const [desktopNotifications, setDesktopNotifications] = useState<boolean>(true);
  const [notificationSound, setNotificationSound] = useState<boolean>(true);
  const [notifyOnApproval, setNotifyOnApproval] = useState<boolean>(true);
  const [hooksListResult, setHooksListResult] = useState<HooksListResult | null>(null);
  const [hooksLoading, setHooksLoading] = useState<boolean>(false);
  const [hooksError, setHooksError] = useState<string | null>(null);
  const [hookRuns, setHookRuns] = useState<HookLiveEvent[]>([]);

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
        setRawToml(cfg.rawToml);
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
        setProvidersSnapshot(JSON.stringify(cfg.providers || []));
        setMcpServersSnapshot(JSON.stringify(cfg.mcpServers || []));
      } catch (legacyErr) {
        if (!loadedViaProtocol) throw legacyErr;
        console.warn("Tauri config_read 不可用:", legacyErr);
      }

      tauriInvoke<any>("desktop_state_get", { key: "desktopPreferences" })
        .then((prefs) => {
          if (prefs && typeof prefs === "object") {
            if (prefs.uiFontSize) {
              setUiFontSize(prefs.uiFontSize);
              document.documentElement.style.fontSize = `${prefs.uiFontSize}px`;
            }
            if (prefs.petVisibility) setPetVisibility(prefs.petVisibility);
            if (prefs.petScale) setPetScale(prefs.petScale);
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
            if (prefs.hooksEnabled !== undefined) setHooksEnabled(prefs.hooksEnabled);
            if (prefs.desktopNotifications !== undefined) setDesktopNotifications(prefs.desktopNotifications);
            if (prefs.notificationSound !== undefined) setNotificationSound(prefs.notificationSound);
            if (prefs.notifyOnApproval !== undefined) setNotifyOnApproval(prefs.notifyOnApproval);
          }
        })
        .catch(() => {});

      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const loadManagedRequirements = async () => {
    try {
      const result = await configRequirementsRead();
      setManagedRequirements(result.requirements ?? null);
    } catch (err) {
      console.warn("configRequirements/read 不可用:", err);
      setManagedRequirements(null);
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

  const loadExperimentalFeatures = async () => {
    setExperimentalLoading(true);
    setExperimentalError(null);
    try {
      const features = await experimentalFeatureListAll();
      setExperimentalFeatures(features);
    } catch (err) {
      setExperimentalError(
        `无法读取实验特性列表（app-server 可能未连接）: ${toErrorMessage(err)}`
      );
    } finally {
      setExperimentalLoading(false);
    }
  };

  const loadAccountData = async () => {
    setAccountLoading(true);
    setAccountError(null);
    const failures: string[] = [];
    try {
      setAccountInfo(await accountRead());
    } catch (err) {
      setAccountInfo(null);
      failures.push(`account/read: ${toErrorMessage(err)}`);
    }
    try {
      setAccountRateLimits(await accountRateLimitsRead());
    } catch (err) {
      setAccountRateLimits(null);
      failures.push(`account/rateLimits/read: ${toErrorMessage(err)}`);
    }
    try {
      setAccountUsage(await accountUsageRead());
    } catch (err) {
      setAccountUsage(null);
      failures.push(`account/usage/read: ${toErrorMessage(err)}`);
    }
    if (failures.length > 0) setAccountError(failures.join(" · "));
    setAccountLoading(false);
  };

  const loadHooks = async () => {
    setHooksLoading(true);
    setHooksError(null);
    try {
      const result = await listHooks(
        activeWorkspaceRoot ? [activeWorkspaceRoot] : []
      );
      setHooksListResult(result);
    } catch (err) {
      setHooksListResult(null);
      setHooksError(
        `无法读取 Hooks（hooks/list，app-server 可能未连接）: ${toErrorMessage(err)}`
      );
    } finally {
      setHooksLoading(false);
    }
  };

  const revealHooksConfigLocation = async () => {
    const configPath = config?.configPath;
    if (!configPath) {
      setErrorBanner("尚未获取到 ~/.codex 配置路径，请先刷新配置后重试。");
      return;
    }
    const separator = configPath.includes("\\") ? "\\" : "/";
    const configDir = configPath.replace(/[\\/][^\\/]+$/, "");
    const hooksJsonPath = `${configDir}${separator}hooks.json`;
    try {
      await tauriInvoke("reveal_path_in_explorer", { path: hooksJsonPath });
      flashSaved("✓ 已在文件管理器中定位 ~/.codex/hooks.json");
    } catch {
      try {
        await tauriInvoke("reveal_path_in_explorer", { path: configPath });
        flashSaved("✓ 已在文件管理器中定位 config.toml（[hooks] 定义位置）");
      } catch (err) {
        setErrorBanner(`打开配置位置失败: ${toErrorMessage(err)}`);
      }
    }
  };

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    subscribeHookEvents((event) => {
      if (disposed) return;
      setHookRuns((previous) => mergeHookRunRecords(previous, event));
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unsubscribe = fn;
        }
      })
      .catch((err) => {
        console.warn("订阅 hook 运行事件失败（实时运行记录不可用）:", err);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (activeSection === "plugins-settings") {
      setLoadingRealPlugins(true);
      const cwds = activeWorkspaceRoot ? [activeWorkspaceRoot] : [];
      listInstalledPlugins(cwds)
        .then((res) => {
          const all = (res?.marketplaces ?? []).flatMap((m) => m.plugins ?? []);
          setRealPlugins(all);
        })
        .catch(() => {
          setRealPlugins([]);
        })
        .finally(() => setLoadingRealPlugins(false));
    }
  }, [activeSection, activeWorkspaceRoot]);

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
    } else if (activeSection === "agent") {
      void loadManagedRequirements();
    } else if (activeSection === "experimental") {
      void loadExperimentalFeatures();
    } else if (activeSection === "account") {
      void loadAccountData();
    } else if (activeSection === "hooks-settings") {
      void loadHooks();
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
        uiFontSize,
        petVisibility,
        petScale,
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
        hooksEnabled,
        desktopNotifications,
        notificationSound,
        notifyOnApproval,
      },
    })
      .then(() => {
        // 通知 App 立即应用新的通知偏好（无需重启）
        try {
          window.dispatchEvent(
            new CustomEvent("codex-prefs-changed", {
              detail: {
                desktopNotifications,
                notificationSound,
                notifyOnApproval,
                petScale,
                petVisibility,
                selectedPetSpecies,
                petVisible,
              },
            })
          );
        } catch {
          // ignore
        }
      })
      .catch(() => {});
  };

  const handleToggleExperimentalFeature = async (feature: ExperimentalFeature) => {
    const nextEnabled = !feature.enabled;
    setExperimentalSaving((prev) => ({ ...prev, [feature.name]: true }));
    setExperimentalFeatures((prev) =>
      prev.map((item) =>
        item.name === feature.name ? { ...item, enabled: nextEnabled } : item
      )
    );
    try {
      const result = await experimentalFeatureSetEnablement({
        [feature.name]: nextEnabled,
      });
      const serverValue = result.enablement[feature.name];
      if (typeof serverValue === "boolean" && serverValue !== nextEnabled) {
        setExperimentalFeatures((prev) =>
          prev.map((item) =>
            item.name === feature.name ? { ...item, enabled: serverValue } : item
          )
        );
      }
      flashSaved(
        `✓ 已${nextEnabled ? "启用" : "停用"}实验特性: ${
          feature.displayName || feature.name
        }`
      );
    } catch (err) {
      setExperimentalFeatures((prev) =>
        prev.map((item) =>
          item.name === feature.name ? { ...item, enabled: feature.enabled } : item
        )
      );
      setErrorBanner(`切换实验特性失败: ${toErrorMessage(err)}`);
    } finally {
      setExperimentalSaving((prev) => {
        const next = { ...prev };
        delete next[feature.name];
        return next;
      });
    }
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

    // Providers / MCP lists are still persisted through the legacy TOML writer,
    // and only when they actually changed (avoids rewriting unrelated tables).
    const providersDirty = JSON.stringify(providers) !== providersSnapshot;
    const mcpDirty = JSON.stringify(mcpServers) !== mcpServersSnapshot;

    try {
      if (!protocolWritten || providersDirty || mcpDirty) {
        const payload: Record<string, unknown> = {};
        if (providersDirty) payload.providers = providers;
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
        setRawToml(updated.rawToml);
        setProviders(updated.providers || []);
        setMcpServers(updated.mcpServers || []);
        setProvidersSnapshot(JSON.stringify(updated.providers || []));
        setMcpServersSnapshot(JSON.stringify(updated.mcpServers || []));
      } else {
        // Everything was already persisted by config/batchWrite — refresh raw TOML view.
        const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
        setConfig(cfg);
        setRawToml(cfg.rawToml);
        setProviders(cfg.providers || providers);
        setMcpServers(cfg.mcpServers || mcpServers);
        setProvidersSnapshot(JSON.stringify(cfg.providers || providers));
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

  const handleTestMcpServer = async (srv: McpServerConfigItem) => {
    setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "测试中..." }));
    try {
      if (srv.url) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          await fetch(srv.url, { method: "HEAD", signal: controller.signal, mode: "no-cors" });
          clearTimeout(timer);
          setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "✓ 远程端点可连通" }));
        } catch (fetchErr: any) {
          setMcpTestStatus((prev) => ({
            ...prev,
            [srv.id]: `❌ 连接失败: ${fetchErr?.name === "AbortError" ? "超时 (4s)" : "网络不可达"}`,
          }));
        }
      } else {
        const testCmd = `${srv.command || "npx"} --help`;
        const res = await tauriInvoke<any>("exec_shell_command", {
          cwd: activeWorkspaceRoot || ".",
          command: testCmd,
        });
        if (res?.exitCode === 0 || res?.success) {
          setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "✓ 正常在线 (Exit 0)" }));
        } else {
          setMcpTestStatus((prev) => ({ ...prev, [srv.id]: `❌ 退出码 ${res?.exitCode ?? -1}` }));
        }
      }
    } catch {
      setMcpTestStatus((prev) => ({ ...prev, [srv.id]: "❌ 运行失败" }));
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
      setRawToml(updated.rawToml);
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
      setRawToml(updated.rawToml);
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
      setRawToml(updated.rawToml);
      setMcpServersSnapshot(JSON.stringify(updated.mcpServers || nextServers));
      void mcpServerReload().catch(() => {});
      flashSaved(`✓ 已移除 MCP 服务器: ${srv.id}`);
      onConfigUpdated();
    } catch (e: any) {
      setErrorBanner(`移除 MCP 失败: ${String(e)}`);
    }
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
      setMcpServers(updated.mcpServers || []);
      setMcpServersSnapshot(JSON.stringify(updated.mcpServers || []));
      // Raw TOML edits may contain [mcp_servers.*]; ask app-server to reload them.
      void mcpServerReload().catch(() => {});
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

  const experimentalEnabledCount = useMemo(
    () => experimentalFeatures.filter((feature) => feature.enabled).length,
    [experimentalFeatures]
  );

  const experimentalDefaultEnabledCount = useMemo(
    () => experimentalFeatures.filter((feature) => feature.defaultEnabled).length,
    [experimentalFeatures]
  );

  const filteredExperimentalFeatures = useMemo(() => {
    const query = experimentalSearch.trim().toLowerCase();
    return experimentalFeatures.filter((feature) => {
      if (experimentalStage !== "all" && feature.stage !== experimentalStage) {
        return false;
      }
      if (!query) return true;
      return [
        feature.name,
        feature.displayName || "",
        feature.description || "",
        feature.announcement || "",
      ].some((text) => text.toLowerCase().includes(query));
    });
  }, [experimentalFeatures, experimentalSearch, experimentalStage]);

  const groupedExperimentalFeatures = useMemo(
    () =>
      EXPERIMENTAL_STAGE_ORDER.map((stage) => ({
        stage,
        items: filteredExperimentalFeatures.filter(
          (feature) => feature.stage === stage
        ),
      })).filter((group) => group.items.length > 0),
    [filteredExperimentalFeatures]
  );

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

  const hookGroups = hooksListResult?.groups ?? [];
  const hookTotalCount = hooksListResult?.hooks.length ?? 0;
  const hookEnabledCount =
    hooksListResult?.hooks.filter((hook) => hook.enabled).length ?? 0;

  const resolveHookName = (event: HookLiveEvent): string => {
    const matched: HookInfo | undefined = event.hookId
      ? hooksListResult?.hooks.find((hook) => hook.id === event.hookId)
      : undefined;
    if (matched?.name) return matched.name;
    if (event.hookName) return event.hookName;
    if (event.statusMessage && event.statusMessage.trim()) {
      return event.statusMessage.trim();
    }
    if (event.eventName) {
      return `${HOOK_EVENT_LABELS[event.eventName] || event.eventName} hook`;
    }
    return "hook";
  };

  const formatClockTime = (epochMs: number | null | undefined): string => {
    if (!epochMs) return "—";
    try {
      return new Date(epochMs).toLocaleTimeString();
    } catch {
      return "—";
    }
  };

  const formatDurationMs = (ms: number | null | undefined): string => {
    if (ms == null || !Number.isFinite(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 10000) return `${(ms / 1000).toFixed(1)} s`;
    return `${Math.round(ms / 1000)} s`;
  };

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
                    onMouseUp={saveDesktopPreferences}
                  />
                </div>
              </div>
            </div>

            {renderBottomBar()}
          </div>
        )}

        {/* SECTION: AGENT & MODEL PARAMETERS (config/* protocol backed) */}
        {activeSection === "agent" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>配置生效方式 (app-server config 协议)</h3>
              <p className="card-subtitle-desc">
                {protocolConfigAvailable
                  ? `✅ 已通过 app-server config/read 读取真实生效配置（${
                      protocolConfig ? Object.keys(protocolConfig).length : 0
                    } 个配置键，含项目层覆盖）。保存时写入 ~/.codex/config.toml，并通过 reloadUserConfig: true 热更新已加载线程。`
                  : "⚠️ app-server config/read 不可用，当前回退到 Tauri 本地 config.toml 读取。保存会回退到本地 TOML 写入（web_search / model_verbosity / approvals_reviewer 需要连接 app-server 后才能写入）。"}
              </p>
              {managedRequirements !== null && (
                <div
                  className="tag-badge"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    marginTop: 8,
                    color: "#f59e0b",
                  }}
                >
                  🛡️ 检测到托管配置约束（requirements.toml / MDM），部分键可能被覆盖或锁定。
                </div>
              )}
            </div>

            {/* Real (protocol-backed) presets — only touch valid config keys */}
            <div className="card-section">
              <h3>真实可写预设 (Valid Config Presets)</h3>
              <p className="card-subtitle-desc">
                预设只调整 codex 真实识别的键（model_reasoning_effort / model_verbosity / web_search），点击后仍需点击右上角「保存更改」写入并热更新。
              </p>
              <div className="preset-cards-grid">
                <div
                  className="preset-template-card"
                  onClick={() => {
                    setReasoningEffort("high");
                    setModelVerbosity("low");
                    setWebSearchMode("cached");
                    flashSaved("已载入：严谨编码预设 (reasoning=high, verbosity=low)");
                  }}
                >
                  <div className="preset-template-title">
                    <span style={{ fontSize: 20 }}>🎯</span>
                    <strong>严谨编码模式 (Deterministic Code)</strong>
                  </div>
                  <p className="preset-template-desc">
                    model_reasoning_effort=high · model_verbosity=low · web_search=cached。高推理、低废话，适合底层算法、重构与测试驱动开发。
                  </p>
                </div>

                <div
                  className="preset-template-card"
                  onClick={() => {
                    setReasoningEffort("medium");
                    setModelVerbosity("medium");
                    setWebSearchMode("cached");
                    flashSaved("已载入：平衡开发预设 (reasoning=medium, verbosity=medium)");
                  }}
                >
                  <div className="preset-template-title">
                    <span style={{ fontSize: 20 }}>⚖️</span>
                    <strong>平衡开发模式 (Balanced - 推荐)</strong>
                  </div>
                  <p className="preset-template-desc">
                    model_reasoning_effort=medium · model_verbosity=medium · web_search=cached。兼顾严谨性与上下文发散，适合日常功能开发。
                  </p>
                </div>

                <div
                  className="preset-template-card"
                  onClick={() => {
                    setReasoningEffort("max");
                    setModelVerbosity("high");
                    setWebSearchMode("live");
                    flashSaved("已载入：架构探索预设 (reasoning=max, web_search=live)");
                  }}
                >
                  <div className="preset-template-title">
                    <span style={{ fontSize: 20 }}>💡</span>
                    <strong>架构探索模式 (Deep Explore)</strong>
                  </div>
                  <p className="preset-template-desc">
                    model_reasoning_effort=max · model_verbosity=high · web_search=live。最大推理预算 + 实时检索，适合方案选型与跨文件架构分析。
                  </p>
                </div>
              </div>
            </div>

            {/* Real generation controls (valid config.toml keys only) */}
            <div className="card-section">
              <h3>生成与输出控制 (Generation & Output)</h3>
              <div className="form-grid-row">
                <div className="form-field">
                  <label>联网搜索模式 (`web_search`)</label>
                  <select
                    value={webSearchMode}
                    onChange={(e) => setWebSearchMode(e.target.value)}
                  >
                    {WEB_SEARCH_MODE_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {WEB_SEARCH_MODE_LABELS[mode] || mode}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    合法枚举：disabled / cached / indexed / live。旧键 web_search_mode 不是 codex 配置键，已从 UI 移除。
                  </span>
                </div>

                <div className="form-field">
                  <label>输出详实度 (`model_verbosity`)</label>
                  <select
                    value={modelVerbosity}
                    onChange={(e) => setModelVerbosity(e.target.value)}
                  >
                    {MODEL_VERBOSITY_OPTIONS.map((verbosity) => (
                      <option key={verbosity} value={verbosity}>
                        {MODEL_VERBOSITY_LABELS[verbosity]}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    Verbosity 枚举，仅对 GPT-5 系列 Responses API 生效。旧键 output_verbosity 已移除。
                  </span>
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
                    placeholder="gpt-6.1-sol"
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {(models.length > 0
                      ? models
                          .map((m) => m.model || m.id)
                          .filter((m): m is string => Boolean(m))
                          .slice(0, 10)
                      : []
                    ).map((m) => (
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
                  {models.length === 0 && (
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                      模型候选来自 app-server model/list（当前不可用，可手动输入模型 ID）。
                    </span>
                  )}
                </div>

                <div className="form-field">
                  <label>默认模型提供商 (`model_provider`)</label>
                  <select
                    value={modelProvider}
                    onChange={(e) => setModelProvider(e.target.value)}
                  >
                    <option value="">(未设置，使用内置默认提供商)</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                    {modelProvider &&
                      !providers.some((p) => p.id === modelProvider) && (
                        <option value={modelProvider}>
                          {modelProvider} (当前配置值)
                        </option>
                      )}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    自定义提供商在「提供商与模型目录」分区维护，保存后写入 [model_providers.*]。
                  </span>
                </div>

                <div className="form-field">
                  <label>默认推理强度 (`model_reasoning_effort`)</label>
                  <select
                    value={reasoningEffort}
                    onChange={(e) => setReasoningEffort(e.target.value)}
                  >
                    {REASONING_EFFORT_OPTIONS.map((effort) => (
                      <option key={effort} value={effort}>
                        {REASONING_EFFORT_LABELS[effort] || effort}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    合法枚举来自 model/list 的 supportedReasoningEfforts（low / medium / high / xhigh / max / ultra）。
                  </span>
                </div>

                <div className="form-field">
                  <label>命令审批策略 (`approval_policy`)</label>
                  <select
                    value={approvalPolicy}
                    onChange={(e) => setApprovalPolicy(e.target.value)}
                  >
                    {APPROVAL_POLICY_OPTIONS.map((policy) => (
                      <option key={policy} value={policy}>
                        {APPROVAL_POLICY_LABELS[policy] || policy}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    合法值：on-request / never / granular(对象) / untrusted（0.159 已弃用，保存时自动改写为 granular 严格档；旧值 on-failure 会被归一化为 on-request）。
                  </span>
                </div>

                <div className="form-field">
                  <label>审批请求审查方 (`approvals_reviewer`)</label>
                  <select
                    value={approvalsReviewer}
                    onChange={(e) => setApprovalsReviewer(e.target.value)}
                  >
                    {APPROVALS_REVIEWER_OPTIONS.filter(
                      (reviewer) => reviewer !== "guardian_subagent"
                    ).map((reviewer) => (
                      <option key={reviewer} value={reviewer}>
                        {APPROVALS_REVIEWER_LABELS[reviewer] || reviewer}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    决定审批请求路由给用户还是自动审查子智能体。
                  </span>
                </div>

                <div className="form-field">
                  <label>沙盒隔离模式 (`sandbox_mode`)</label>
                  <select
                    value={sandboxMode}
                    onChange={(e) => setSandboxMode(e.target.value)}
                  >
                    {SANDBOX_MODE_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {SANDBOX_MODE_LABELS[mode] || mode}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    合法枚举：read-only / workspace-write / danger-full-access。
                  </span>
                </div>
              </div>
            </div>

            {/* Global instructions (config.toml root key) */}
            <div className="card-section">
              <h3>全局自定义指令 (`instructions`)</h3>
              <p className="card-subtitle-desc">
                写入 config.toml 的 instructions 根级键，每个新会话自动注入 System Prompt（与「个性化指令」分区共用同一状态；清空后保存会移除该键）。
              </p>
              <textarea
                className="code-editor-textarea"
                style={{ minHeight: 140 }}
                value={customPersonaPrompt}
                onChange={(e) => setCustomPersonaPrompt(e.target.value)}
                placeholder={"例如：\n1. 始终使用专业准确的中文回答。\n2. 优先编写可维护、带测试的高质量代码。\n3. 改动前先思考边界异常与既有架构。"}
              />
            </div>

            <div className="settings-section-bottom-bar">
              <button type="button" className="primary-btn" onClick={handleSaveVisual}>
                <Save size={14} /> 保存模型与运行时配置
              </button>
              <button type="button" className="secondary-btn" onClick={loadConfig}>
                <RefreshCw size={14} /> 放弃未保存修改
              </button>
            </div>
          </div>
        )}

        {/* SECTION: PETS (Mini & Pets) */}
        {activeSection === "pets" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <h3>Mini & Pets</h3>
                  <p className="card-subtitle-desc">
                    Mini manages threads and surfaces what needs attention
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => onTogglePetVisible?.(!petVisible)}
                >
                  {petVisible ? "Hide mini" : "Show mini"}
                </button>
              </div>
            </div>

            <div className="card-section">
              <h3>Visibility</h3>
              <p className="card-subtitle-desc">
                Choose whether your Mini stays on your desktop or appears on demand
              </p>
              <div style={{ marginTop: 12, maxWidth: 380 }}>
                <select
                  value={petVisibility}
                  onChange={(e) => {
                    const next = e.target.value as "always-visible" | "on-demand";
                    setPetVisibility(next);
                    saveDesktopPreferences();
                  }}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6 }}
                >
                  <option value="always-visible">Always visible · Keep your Mini on your desktop</option>
                  <option value="on-demand">On demand · Show from the menu. Hide when you click away</option>
                </select>
              </div>
            </div>

            <div className="card-section">
              <h3>Pick a pet</h3>
              <p className="card-subtitle-desc">
                Choose a companion for your desktop and quick access
              </p>

              {installedPets.length > 0 && (
                <>
                  <h4 style={{ margin: "14px 0 8px", fontSize: 13, color: "var(--text-secondary)" }}>
                    Custom pets (`~/.codex/pets`)
                  </h4>
                  <div className="preset-cards-grid" style={{ marginBottom: 16 }}>
                    {installedPets.map((pet) => (
                      <div
                        key={pet.id}
                        className={`preset-template-card ${
                          selectedPetSpecies === pet.id ? "active" : ""
                        }`}
                        onClick={() => {
                          onSelectPetSpecies?.(pet.id);
                          onTogglePetVisible?.(true);
                          flashSaved(`已选择本地宠物: ${pet.displayName}`);
                        }}
                      >
                        <div className="preset-template-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {pet.spritesheetDataUrl ? (
                            <img
                              src={pet.spritesheetDataUrl}
                              alt={pet.displayName}
                              style={{ width: 28, height: 28, objectFit: "cover", objectPosition: "0 0", borderRadius: 4 }}
                            />
                          ) : (
                            <span style={{ fontSize: 20 }}>🐾</span>
                          )}
                          <strong>{pet.displayName}</strong>
                        </div>
                        <p className="preset-template-desc">{pet.description || "自定义本地宠物精灵图"}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h4 style={{ margin: "12px 0 8px", fontSize: 13, color: "var(--text-secondary)" }}>
                Built-in companions
              </h4>
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
                      flashSaved(`已选择伴侣: ${pet.name}`);
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

            <div className="card-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3>Pet size</h3>
                  <p className="card-subtitle-desc">Adjust the size of your pet</p>
                </div>
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => {
                    setPetScale(1.0);
                    saveDesktopPreferences();
                  }}
                >
                  Reset
                </button>
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14 }}>
                <input
                  type="range"
                  min="0.6"
                  max="1.8"
                  step="0.1"
                  value={petScale}
                  onChange={(e) => {
                    setPetScale(Number(e.target.value));
                  }}
                  onMouseUp={saveDesktopPreferences}
                  style={{ width: 220 }}
                />
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                  {Math.round(petScale * 100)}%
                </span>
              </div>
            </div>

            <div className="card-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3>Custom pets</h3>
                  <p className="card-subtitle-desc" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    ~/.codex/pets
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={async () => {
                    try {
                      await tauriInvoke("open_path_in_shell", { path: "~/.codex/pets" });
                    } catch {
                      await tauriInvoke("storage_stats_get").then((s: any) => {
                        if (s?.codexHome) {
                          tauriInvoke("reveal_path_in_explorer", { path: `${s.codexHome}\\pets` }).catch(() => {});
                        }
                      }).catch(() => {});
                    }
                  }}
                >
                  Open folder
                </button>
              </div>
            </div>

            {renderBottomBar()}
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
                        <button
                          type="button"
                          className="icon-danger-btn"
                          title="彻底删除此会话记录"
                          style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6 }}
                          onClick={async () => {
                            const ok = window.confirm(`确定要彻底删除已归档会话 "${t.name || t.preview || t.id}" 吗？此操作无法撤销。`);
                            if (!ok) return;
                            try {
                              await tauriInvoke("thread_delete", { threadId: t.id });
                              setArchivedThreads((prev: any[]) => prev.filter((item: any) => item.id !== t.id));
                              flashSaved("已彻底删除会话记录");
                            } catch (e: any) {
                              setErrorBanner("删除失败: " + String(e));
                            }
                          }}
                        >
                          🗑️ 彻底删除
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

        {/* SECTION: NOTIFICATIONS */}
        {activeSection === "notifications" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>通知与免打扰</h3>
              <p className="card-subtitle-desc">
                控制 Codex 在后台时如何提醒你。桌面通知使用系统原生通知（Windows Toast / macOS / Linux），仅在窗口不在前台时弹出；提示音在应用内播放。
              </p>
              <div className="item-cards-list">
                <div className="item-card">
                  <div className="item-card-main">
                    <strong>桌面系统通知</strong>
                    <span className="card-subtitle-desc">
                      任务完成、自动化结束、需要审批时弹出系统通知
                    </span>
                  </div>
                  <div className="item-card-actions">
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={desktopNotifications}
                        onChange={(e) => setDesktopNotifications(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>
                <div className="item-card">
                  <div className="item-card-main">
                    <strong>完成提示音</strong>
                    <span className="card-subtitle-desc">
                      一轮回复或目标完成时播放提示音
                    </span>
                  </div>
                  <div className="item-card-actions">
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={notificationSound}
                        onChange={(e) => setNotificationSound(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>
                <div className="item-card">
                  <div className="item-card-main">
                    <strong>审批提醒</strong>
                    <span className="card-subtitle-desc">
                      Codex 请求批准命令/文件变更时额外发送桌面通知
                    </span>
                  </div>
                  <div className="item-card-actions">
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={notifyOnApproval}
                        onChange={(e) => setNotifyOnApproval(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={async () => {
                    try {
                      await tauriInvoke("show_desktop_notification", {
                        title: "Codex Native",
                        body: "这是一条测试通知：系统通知已可用。",
                      });
                      flashSaved("✓ 已发送测试通知");
                    } catch (err) {
                      setErrorBanner(`通知发送失败: ${toErrorMessage(err)}`);
                    }
                  }}
                >
                  发送测试通知
                </button>
                <span className="card-subtitle-desc">
                  若系统未显示通知，请检查 Windows「通知和操作」中是否允许本应用。
                </span>
              </div>
            </div>

            {renderBottomBar()}
          </div>
        )}

        {/* SECTION: KEYBOARD SHORTCUTS */}
        {activeSection === "keyboard-shortcuts" && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>全局键盘快捷键一览</h3>
              <p className="card-subtitle-desc">
                以下快捷键来自全局快捷键注册表（`src/shortcuts.ts`），与 App 实际注册的快捷键一一对应，共{" "}
                {SHORTCUTS.length} 项。
              </p>
              {SHORTCUT_GROUP_ORDER.map((group) => {
                const groupItems = SHORTCUTS.filter(
                  (shortcut) => shortcut.group === group
                );
                if (groupItems.length === 0) return null;
                return (
                  <div key={group}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginBottom: 8,
                      }}
                    >
                      {SHORTCUT_GROUP_LABELS[group] || group} ({groupItems.length})
                    </div>
                    <div className="item-cards-list">
                      {groupItems.map((shortcut) => (
                        <div key={shortcut.id} className="item-card">
                          <div className="item-card-main">
                            <strong>{shortcut.label}</strong>
                          </div>
                          <div className="item-card-actions">
                            <span className="tag-badge accent">{shortcut.keys}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {renderBottomBar()}
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

            {renderBottomBar()}
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0 }}>已安装扩展插件 ({realPlugins.length})</h3>
                  <p className="card-subtitle-desc" style={{ margin: "4px 0 0 0" }}>
                    通过本地或远程 Registry 安装的真实插件与技能
                  </p>
                </div>
                <button
                  type="button"
                  className="primary-btn compact"
                  onClick={() => onNavigateRoute?.("skills")}
                >
                  浏览插件市场 (Browse directory)
                </button>
              </div>

              {loadingRealPlugins ? (
                <div className="empty-diff-state compact">
                  <span>正在扫描已安装插件... (Loading plugins...)</span>
                </div>
              ) : realPlugins.length === 0 ? (
                <div className="empty-diff-state" style={{ padding: "24px 16px" }}>
                  <p style={{ margin: "0 0 10px 0", color: "var(--text-secondary)", fontSize: 13 }}>
                    暂无已安装的插件扩展。
                  </p>
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => onNavigateRoute?.("skills")}
                  >
                    前往插件市场安装
                  </button>
                </div>
              ) : (
                <div className="item-cards-list">
                  {realPlugins.map((plugin) => (
                    <div key={plugin.id} className="item-card">
                      <div className="item-card-main">
                        <div className="item-card-title-row">
                          <strong>{pluginDisplayName(plugin)}</strong>
                          <span className="tag-badge">{pluginVersion(plugin)}</span>
                          <span className={`tag-badge ${plugin.enabled !== false ? "accent" : ""}`}>
                            {plugin.enabled !== false ? "已启用" : "已停用"}
                          </span>
                        </div>
                        <div className="item-card-meta">
                          <span>{pluginDescription(plugin) || "无描述"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {renderBottomBar()}
          </div>
        )}




        {/* ── SECTION 15: HOOKS SETTINGS (生命周期挂钩 · hooks/list + 实时运行) ── */}
        {activeSection === "hooks-settings" && (
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
                  <h3>生命周期挂钩 (Lifecycle Hooks)</h3>
                  <p className="card-subtitle-desc">
                    Hooks 由 codex app-server 从 `~/.codex/hooks.json`、`~/.codex/config.toml`
                    的 `[hooks]` 表、项目 `.codex/` 层或托管配置加载。本分区通过协议
                    `hooks/list` 只读展示真实配置，并在下方实时展示 hook/started ·
                    hook/completed 运行状态。
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void loadHooks()}
                  disabled={hooksLoading}
                >
                  <RefreshCw size={14} /> {hooksLoading ? "读取中..." : "刷新 Hooks"}
                </button>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <span className="tag-badge accent">共 {hookTotalCount} 个 Hook</span>
                <span className="tag-badge">已启用 {hookEnabledCount}</span>
                <span className="tag-badge">分组 {hookGroups.length}</span>
                <span className="tag-badge">运行记录 {hookRuns.length}/20</span>
              </div>
              {hooksError && (
                <div className="error-banner" style={{ marginTop: 10 }}>
                  {hooksError}
                  <button
                    type="button"
                    className="secondary-btn-sm"
                    style={{ marginLeft: 10 }}
                    onClick={() => void loadHooks()}
                  >
                    重试
                  </button>
                </div>
              )}
            </div>

            <div className="card-section">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h3>已配置的 Hooks（按工作目录分组）</h3>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void revealHooksConfigLocation()}
                >
                  <FileCode size={14} /> 打开配置位置 (~/.codex/hooks.json)
                </button>
              </div>

              {hooksLoading && hookGroups.length === 0 ? (
                <div className="empty-hint" style={{ marginTop: 12 }}>
                  正在从 app-server 读取 hooks/list...
                </div>
              ) : hookTotalCount === 0 ? (
                <div className="empty-hint" style={{ marginTop: 12 }}>
                  <div>
                    {hooksError
                      ? "无法从 app-server 读取 Hooks 配置，请确认 App-Server 已连接后点击「重新读取」。"
                      : "当前工作区没有配置 Hooks（可在 ~/.codex/hooks.json 或 config.toml 的 [hooks] 中配置）。"}
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => void revealHooksConfigLocation()}
                    >
                      <FileCode size={14} /> 打开配置位置
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => void loadHooks()}
                    >
                      <RefreshCw size={14} /> 重新读取
                    </button>
                  </div>
                  {(hooksListResult?.warnings.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10, textAlign: "left" }}>
                      {hooksListResult?.warnings.map((warning, index) => (
                        <div
                          key={`hook-warning-${warning.cwd}-${index}`}
                          className="tag-badge"
                          style={{
                            display: "block",
                            color: "#f59e0b",
                            marginTop: 6,
                            whiteSpace: "normal",
                            fontFamily: "inherit",
                            lineHeight: 1.5,
                          }}
                        >
                          ⚠️ [{warning.cwd}] {warning.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    marginTop: 12,
                  }}
                >
                  {hookGroups.map((group) => (
                    <div key={group.cwd || "(default-cwd)"}>
                      <div className="item-card-meta" style={{ marginBottom: 8 }}>
                        <strong className="mono-text">
                          {group.cwd || "(app-server 默认 cwd)"}
                        </strong>
                        <span>{group.hooks.length} 个 Hook</span>
                      </div>
                      {group.warnings.map((warning, index) => (
                        <div
                          key={`group-warning-${index}`}
                          className="tag-badge"
                          style={{
                            display: "block",
                            color: "#f59e0b",
                            marginBottom: 6,
                            whiteSpace: "normal",
                            fontFamily: "inherit",
                            lineHeight: 1.5,
                          }}
                        >
                          ⚠️ {warning}
                        </div>
                      ))}
                      {group.errors.map((error, index) => (
                        <div
                          key={`group-error-${index}`}
                          className="tag-badge"
                          style={{
                            display: "block",
                            color: "#ef4444",
                            marginBottom: 6,
                            whiteSpace: "normal",
                            fontFamily: "inherit",
                            lineHeight: 1.5,
                          }}
                        >
                          ❌ {error.message}
                          {error.path ? ` (${error.path})` : ""}
                        </div>
                      ))}
                      {group.hooks.length === 0 ? (
                        <div className="empty-hint">该目录下没有解析出的 Hook。</div>
                      ) : (
                        <div className="item-cards-list">
                          {group.hooks.map((hook) => (
                            <div
                              key={hook.id}
                              className="item-card"
                              style={{ opacity: hook.enabled ? 1 : 0.6 }}
                            >
                              <div className="item-card-main">
                                <div className="item-card-title-row">
                                  <strong>{hook.name}</strong>
                                  <span className="tag-badge accent">
                                    {HOOK_EVENT_LABELS[hook.event] || hook.event || "unknown event"}
                                  </span>
                                  {hook.handlerType && (
                                    <span className="tag-badge">
                                      {HOOK_HANDLER_LABELS[hook.handlerType] || hook.handlerType}
                                    </span>
                                  )}
                                  <span
                                    className={`tag-badge ${
                                      hook.enabled ? "accent" : ""
                                    }`}
                                  >
                                    {hook.enabled ? "已启用" : "已停用"}
                                  </span>
                                  {hook.source && (
                                    <span className="tag-badge">
                                      {HOOK_SOURCE_LABELS[hook.source] || hook.source}
                                    </span>
                                  )}
                                  {hook.trustStatus &&
                                    hook.trustStatus !== "trusted" &&
                                    hook.trustStatus !== "managed" && (
                                      <span
                                        className="tag-badge"
                                        style={{ color: "#f59e0b" }}
                                      >
                                        {HOOK_TRUST_LABELS[hook.trustStatus] ||
                                          hook.trustStatus}
                                      </span>
                                    )}
                                  {hook.isManaged && (
                                    <span className="tag-badge">托管</span>
                                  )}
                                </div>
                                {hook.command && (
                                  <div className="item-card-meta">
                                    <span
                                      className="mono-text"
                                      style={{ wordBreak: "break-all" }}
                                    >
                                      {hook.command}
                                    </span>
                                  </div>
                                )}
                                <div className="item-card-meta">
                                  <span>
                                    matcher: {hook.matcher ? hook.matcher : "全部"}
                                  </span>
                                  {typeof hook.timeoutSec === "number" && (
                                    <span>超时: {hook.timeoutSec}s</span>
                                  )}
                                  {hook.async && <span>async</span>}
                                  {hook.pluginId && (
                                    <span>plugin: {hook.pluginId}</span>
                                  )}
                                  {hook.statusMessage && (
                                    <span>{hook.statusMessage}</span>
                                  )}
                                </div>
                                {hook.sourcePath && (
                                  <div className="item-card-meta">
                                    <span>
                                      来源: <code>{hook.sourcePath}</code>
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                  <h3>实时运行状态 (hook/started · hook/completed)</h3>
                  <p className="card-subtitle-desc">
                    通过 app-server 通知实时记录最近 20 次 Hook 运行；运行中的记录会在
                    hook/completed 到达时原地更新为最终状态与耗时。
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setHookRuns([])}
                  disabled={hookRuns.length === 0}
                >
                  <Trash2 size={14} /> 清空记录
                </button>
              </div>
              {hookRuns.length === 0 ? (
                <div className="empty-hint" style={{ marginTop: 12 }}>
                  暂无 Hook 运行记录：Hooks 会在智能体会话生命周期事件（如 sessionStart /
                  preToolUse / postToolUse / stop）触发时运行。
                </div>
              ) : (
                <div className="item-cards-list" style={{ marginTop: 12 }}>
                  {hookRuns.map((run, index) => {
                    const running =
                      run.status === "running" || run.kind === "started";
                    const statusColor =
                      run.status === "failed" || run.status === "blocked"
                        ? "#ef4444"
                        : run.status === "stopped"
                          ? "#f59e0b"
                          : running
                            ? "#3b82f6"
                            : "#10b981";
                    return (
                      <div
                        key={`${run.hookId || run.eventName || "run"}-${
                          run.receivedAt
                        }-${index}`}
                        className="item-card"
                      >
                        <div className="item-card-main">
                          <div className="item-card-title-row">
                            <strong>{resolveHookName(run)}</strong>
                            <span className="tag-badge accent">
                              {HOOK_EVENT_LABELS[run.eventName || ""] ||
                                run.eventName ||
                                "event"}
                            </span>
                            <span
                              className="tag-badge"
                              style={{ color: statusColor }}
                            >
                              {running
                                ? "⏳ 运行中"
                                : HOOK_RUN_STATUS_LABELS[run.status || ""] ||
                                  run.status ||
                                  "已完成"}
                            </span>
                            {run.handlerType && (
                              <span className="tag-badge">
                                {HOOK_HANDLER_LABELS[run.handlerType] ||
                                  run.handlerType}
                              </span>
                            )}
                            {run.source && (
                              <span className="tag-badge">
                                {HOOK_SOURCE_LABELS[run.source] || run.source}
                              </span>
                            )}
                            <span className="tag-badge">
                              {formatClockTime(run.receivedAt)}
                            </span>
                            <span className="tag-badge">
                              耗时: {formatDurationMs(run.durationMs)}
                            </span>
                          </div>
                          {(run.statusMessage ||
                            (run.entries && run.entries.length > 0)) && (
                            <div className="item-card-meta">
                              {run.statusMessage && (
                                <span>{run.statusMessage}</span>
                              )}
                              {(run.entries || []).slice(0, 3).map((entry, entryIndex) => (
                                <span
                                  key={`entry-${entryIndex}`}
                                  style={{
                                    color:
                                      entry.kind === "error"
                                        ? "#ef4444"
                                        : undefined,
                                  }}
                                >
                                  [{entry.kind}]{" "}
                                  {entry.text.length > 180
                                    ? `${entry.text.slice(0, 180)}…`
                                    : entry.text}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card-section">
              <h3>Hook 执行开关（本地桌面偏好）</h3>
              <p className="card-subtitle-desc">
                Hooks 的实际启用由 codex config 的 `[features].hooks` 与 hooks.json
                定义控制（默认启用）。此开关仅保存桌面端本地偏好，不会写入 codex 配置。
              </p>
              <div className="settings-toggle-row">
                <div className="settings-toggle-label">
                  <span className="settings-toggle-title">
                    启用生命周期挂钩提醒（本地偏好）
                  </span>
                  <span className="settings-toggle-desc">
                    保留原有开关状态；实际 Hooks 执行仍以 app-server 配置为准
                  </span>
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

            {renderBottomBar()}
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

            {renderBottomBar()}
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

            {renderBottomBar()}
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

            {renderBottomBar()}
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
                        const res = await tauriInvoke<any>("import_external_tool_config", {
                          kind: "cursor",
                          cwd: activeWorkspaceRoot,
                        });
                        if (res?.found && res.content) {
                          setCustomPersonaPrompt((prev) => {
                            const merged = `${prev}\n\n[Cursor Rules (${res.path})]\n${res.content}`.trim();
                            tauriInvoke("desktop_state_set", {
                              key: "desktopPreferences",
                              value: { customPersonaPrompt: merged },
                            }).catch(() => {});
                            return merged;
                          });
                          flashSaved(`✓ 已从 ${res.path} 成功读取并合并 .cursorrules 规范！`);
                        } else {
                          flashSaved(`未在当前工作区检测到 .cursorrules 文件 (${res?.path || ".cursorrules"})`);
                        }
                      } catch (e: any) {
                        setErrorBanner(`读取 Cursor 规范失败: ${String(e)}`);
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
                    onClick={async () => {
                      try {
                        const res = await tauriInvoke<any>("import_external_tool_config", {
                          kind: "claude",
                          cwd: activeWorkspaceRoot,
                        });
                        if (res?.found && Array.isArray(res.mcpServers) && res.mcpServers.length > 0) {
                          const merged = [...mcpServers];
                          for (const s of res.mcpServers) {
                            if (!merged.some((x) => x.id === s.id)) {
                              merged.push(s);
                            }
                          }
                          setMcpServers(merged);
                          const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
                            payload: { mcpServers: merged },
                          });
                          setConfig(updated);
                          setRawToml(updated.rawToml);
                          setMcpServersSnapshot(JSON.stringify(updated.mcpServers || merged));
                          void mcpServerReload().catch(() => {});
                          flashSaved(`✓ 已从 ${res.path} 成功导入 ${res.count} 个 Claude MCP 服务器并持久化保存！`);
                          onConfigUpdated();
                        } else {
                          flashSaved(`未在系统中检测到 Claude Desktop 配置文件 (${res?.path || "claude_desktop_config.json"})`);
                        }
                      } catch (e: any) {
                        setErrorBanner(`导入 Claude MCP 失败: ${String(e)}`);
                      }
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
                    onClick={async () => {
                      try {
                        const res = await tauriInvoke<any>("import_external_tool_config", {
                          kind: "vscode",
                          cwd: activeWorkspaceRoot,
                        });
                        if (res?.found) {
                          flashSaved(`✓ 已检测到 VS Code 键位配置文件 (${res.path})，共 ${res.count} 项用户自定义绑定`);
                        } else {
                          flashSaved(`未在系统中找到 VS Code 快捷键配置文件 (${res?.path || "keybindings.json"})`);
                        }
                      } catch (e: any) {
                        setErrorBanner(`导入 VS Code 快捷键失败: ${String(e)}`);
                      }
                    }}
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
                    onClick={async () => {
                      try {
                        const res = await tauriInvoke<any>("import_external_tool_config", {
                          kind: "windsurf",
                          cwd: activeWorkspaceRoot,
                        });
                        if (res?.found && res.content) {
                          setCustomPersonaPrompt((prev) => {
                            const merged = `${prev}\n\n[Windsurf Rules (${res.path})]\n${res.content}`.trim();
                            tauriInvoke("desktop_state_set", {
                              key: "desktopPreferences",
                              value: { customPersonaPrompt: merged },
                            }).catch(() => {});
                            return merged;
                          });
                          flashSaved(`✓ 已从 ${res.path} 成功读取并合并 Windsurf 规则！`);
                        } else {
                          flashSaved(`未在当前工作区检测到 Windsurf 规则文件 (${res?.path || ".windsurfrules"})`);
                        }
                      } catch (e: any) {
                        setErrorBanner(`导入 Windsurf 规则失败: ${String(e)}`);
                      }
                    }}
                  >
                    导入 Windsurf 规则
                  </button>
                </div>
              </div>
            </div>

            {renderBottomBar()}
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

            {renderBottomBar()}
          </div>
        )}

        {/* ── SECTION 21: EXPERIMENTAL FEATURES (实验特性) ── */}
        {activeSection === "experimental" && (
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
                  <h3>实验特性开关 (Experimental Features)</h3>
                  <p className="card-subtitle-desc">
                    数据来自 app-server `experimentalFeature/list`（本机 152 项）。开关通过
                    `experimentalFeature/enablement/set` 即时切换进程级运行时启用状态；部分特性需要重载线程或重启 app-server 后才完全生效。
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void loadExperimentalFeatures()}
                  disabled={experimentalLoading}
                >
                  <RefreshCw size={14} /> {experimentalLoading ? "读取中..." : "刷新列表"}
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <span className="tag-badge accent">共 {experimentalFeatures.length} 项</span>
                <span className="tag-badge">已启用 {experimentalEnabledCount}</span>
                <span className="tag-badge">默认启用 {experimentalDefaultEnabledCount}</span>
                <span className="tag-badge">筛选结果 {filteredExperimentalFeatures.length}</span>
              </div>
              {experimentalError && (
                <div className="error-banner" style={{ marginTop: 10 }}>
                  {experimentalError}
                </div>
              )}
            </div>

            <div className="card-section">
              <div className="settings-search-box" style={{ maxWidth: 460 }}>
                <Search size={13} />
                <input
                  type="text"
                  placeholder="搜索实验特性名称 / 稳定名 / 描述..."
                  value={experimentalSearch}
                  onChange={(e) => setExperimentalSearch(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button
                  type="button"
                  className={`tag-filter-pill ${
                    experimentalStage === "all" ? "active" : ""
                  }`}
                  onClick={() => setExperimentalStage("all")}
                >
                  全部 ({experimentalFeatures.length})
                </button>
                {EXPERIMENTAL_STAGE_ORDER.map((stage) => {
                  const count = experimentalFeatures.filter(
                    (feature) => feature.stage === stage
                  ).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={stage}
                      type="button"
                      className={`tag-filter-pill ${
                        experimentalStage === stage ? "active" : ""
                      }`}
                      onClick={() => setExperimentalStage(stage)}
                    >
                      {EXPERIMENTAL_STAGE_LABELS[stage]} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {experimentalLoading && experimentalFeatures.length === 0 ? (
              <div className="empty-hint">正在从 app-server 读取实验特性列表...</div>
            ) : groupedExperimentalFeatures.length === 0 ? (
              <div className="empty-hint">
                {experimentalError
                  ? "无法读取实验特性列表，请确认 App-Server 已连接后刷新。"
                  : "没有匹配的实验特性。"}
              </div>
            ) : (
              groupedExperimentalFeatures.map((group) => (
                <div className="card-section" key={group.stage}>
                  <h3>
                    {EXPERIMENTAL_STAGE_LABELS[group.stage]} ({group.items.length})
                  </h3>
                  <div className="item-cards-list">
                    {group.items.map((feature) => {
                      const isSaving = experimentalSaving[feature.name] === true;
                      return (
                        <div key={feature.name} className="item-card">
                          <div className="item-card-main">
                            <div className="item-card-title-row">
                              <strong>{feature.displayName || feature.name}</strong>
                              <span className="tag-badge">{feature.name}</span>
                              <span
                                className={`tag-badge ${
                                  feature.stage === "beta" ? "accent" : ""
                                }`}
                              >
                                {EXPERIMENTAL_STAGE_LABELS[feature.stage]}
                              </span>
                              {feature.defaultEnabled && (
                                <span className="tag-badge">默认启用</span>
                              )}
                              {feature.enabled && (
                                <span className="tag-badge accent">已启用</span>
                              )}
                            </div>
                            {feature.description && (
                              <div className="item-card-meta">
                                <span>{feature.description}</span>
                              </div>
                            )}
                            {feature.announcement && (
                              <div className="item-card-meta">
                                <span>📣 {feature.announcement}</span>
                              </div>
                            )}
                          </div>
                          <div className="item-card-actions">
                            <label
                              className="switch-control"
                              title={
                                isSaving
                                  ? "切换中..."
                                  : "切换该实验特性的运行时启用状态"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={feature.enabled}
                                disabled={isSaving}
                                onChange={() =>
                                  void handleToggleExperimentalFeature(feature)
                                }
                              />
                              <span className="switch-slider" />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

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
                            fontSize: 12.5,
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
                            fontSize: 11,
                            color: "var(--text-tertiary)",
                            marginBottom: 4,
                          }}
                        >
                          {stat.label}
                        </div>
                        <div
                          style={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {stat.value}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--text-tertiary)",
                            marginTop: 2,
                          }}
                        >
                          {stat.hint}
                        </div>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ marginTop: 18, fontSize: 13 }}>
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
                              fontSize: 9,
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
      </div>
    </div>
  );
};
