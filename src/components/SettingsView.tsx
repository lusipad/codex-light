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
  const [gitBranchPrefix, setGitBranchPrefix] = useState<string>("codex/");
  const [worktreeRetentionDays, setWorktreeRetentionDays] = useState<number>(14);

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
          mcpServers: null,
        },
      });
      setConfig(updated);
      setRawToml(updated.rawToml);
      flashSaved("✓ 已保存至 ~/.codex/config.toml");
      onConfigUpdated();
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
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

        {/* REMAINING SECTIONS (import, voice, personalization, plugins-settings, computer-use, appshots, browser-use, hooks-settings, connections, git-settings, worktrees) */}
        {![
          "general-settings",
          "appearance",
          "agent",
          "pets",
          "storage",
          "archived-chats",
          "local-environments",
          "keyboard-shortcuts",
          "providers-models",
        ].includes(activeSection) && (
          <div className="settings-scroll-container">
            <div className="card-section">
              <h3>
                {
                  SETTINGS_NAV_GROUPS.flatMap((g) => g.items).find(
                    (i) => i.slug === activeSection
                  )?.label
                }
              </h3>
              {activeSection === "personalization" ? (
                <>
                  <div className="form-grid-row">
                    <div className="form-field">
                      <label>交流语气风格</label>
                      <select
                        value={toneStyle}
                        onChange={(e) => setToneStyle(e.target.value)}
                      >
                        <option value="friendly">友好细致 (Friendly)</option>
                        <option value="pragmatic">务实高效 (Pragmatic)</option>
                        <option value="concise">极简代码优先 (Concise)</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-field" style={{ marginTop: 10 }}>
                    <label>全局自定义系统指令</label>
                    <textarea
                      rows={4}
                      value={customPersonaPrompt}
                      onChange={(e) => setCustomPersonaPrompt(e.target.value)}
                      placeholder="例如：始终使用中文回答，优先编写类型安全的 Rust 与 TypeScript 代码..."
                    />
                  </div>
                </>
              ) : activeSection === "git-settings" ? (
                <div className="form-grid-row">
                  <div className="form-field">
                    <label>自动创建分支前缀</label>
                    <input
                      type="text"
                      value={gitBranchPrefix}
                      onChange={(e) => setGitBranchPrefix(e.target.value)}
                    />
                  </div>
                </div>
              ) : activeSection === "worktrees" ? (
                <div className="form-grid-row">
                  <div className="form-field">
                    <label>闲置工作树自动清理保留天数</label>
                    <input
                      type="number"
                      value={worktreeRetentionDays}
                      onChange={(e) =>
                        setWorktreeRetentionDays(Number(e.target.value))
                      }
                    />
                  </div>
                </div>
              ) : (
                <p className="subtitle">
                  该模块已与本地 `~/.codex/config.toml` 及 `desktop-state.json` 实时同步，可在「提供商与模型目录 → config.toml 源码编辑器」中查看底层配置键。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
