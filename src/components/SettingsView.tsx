import { CloudPreferencesSettings } from "./CloudPreferencesSettings";
import { CloudEnvironmentsView, type OpenCloudDraft } from "./CloudEnvironmentsView";
import { PetsSettings } from "./PetsSettings";
import type { PetPreferencesState } from "../petPreferences";
import { ComputerUseSettings, AppshotsSettings, BrowserUseSettings } from "./ControlCapabilitySettings";
import { VoiceSettings } from "./VoiceSettings";
import { ExperimentalFeatures } from "./ExperimentalFeatures";
import { ArchiveView, type ArchiveViewProps } from "./ArchiveView";
import { useArchivedCloudTasks } from "../archiveCloudTasks";
import { useArchivedDurableChats } from "../archiveDurableChats";
import { useArchivedConversations } from "../archiveConversations";
import { StorageSettings } from "./StorageSettings";
import { ImportSettings } from "./ImportSettings";
import type { ExternalImportsState } from "../externalImport";
import { CodeReviewSettings } from "./CodeReviewSettings";
import type { CodeReviewPreferencesState } from "../reviewPreferences";
import { WorktreeSettings } from "./WorktreeSettings";
import { WorktreeInventory } from "./WorktreeInventory";
import { LocalEnvironmentSettings } from "./LocalEnvironmentSettings";
import type { EnvironmentActionRunRequest } from "../environmentActions";
import { GitSettings } from "./GitSettings";
import type { GitPreferencesState } from "../gitPreferences";
import { HooksSettings } from "./HooksSettings";
import type { PluginDetail } from "../plugins";
import { SkillsMcpView, type PluginDirectoryNavigation } from "./SkillsMcpView";
import { parsePluginManagementLocation } from "../pluginManagementLocation";
import { McpSettings } from "./McpSettings";
import { ProfileSettings } from "./ProfileSettings";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { AgentSettings } from "./AgentSettings";
import { NotificationSettings } from "./NotificationSettings";
import { AccountNotificationSettings } from "./AccountNotificationSettings";
import type { NotificationState } from "../notificationPreferences";
import { AppearanceSettings } from "./AppearanceSettings";
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";
import type { KeyboardPreferencesState } from "../keyboardPreferences";
import type { AppearanceState } from "../appearancePreferences";
import { GeneralOpenPreferences, type BottomPanelLauncherPreference } from "./GeneralOpenPreferences";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./SettingsView.css";
import type { ComposerEnterBehavior, FollowUpMode } from "../composerPreferences";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Settings, Bell, Download, User, Palette, Archive, Mic, HardDrive, SlidersHorizontal,
  Sparkles, Cat, Keyboard, ChartNoAxesCombined, Plug, Monitor, Camera, Globe, Webhook, Cable,
  Cloud, ScanSearch, GitBranch, Terminal, FolderGit2 } from "lucide-react";
import { isTauriRuntime, tauriInvoke } from "../bridge";
import { AccountSettings } from "./AccountSettings";
import { UsageSettings } from "./UsageSettings";
import {
  AppServerStatus,
  ModelInfo,
  MainViewRoute,
  SettingsSectionSlug,
} from "../types";

const SETTINGS_NAV_GROUPS: Array<{
  groupTitle: string;
  items: Array<{ slug: SettingsSectionSlug; label: string; keywords: string }>;
}> = [
  {
    groupTitle: "个人",
    items: [
      { slug: "general-settings", label: "常规", keywords: "general editor notification sleep desktop toast sound 本地通知 轮次完成 权限 问题 Dot 提示音" },
      { slug: "notifications", label: "通知", keywords: "notifications account ChatGPT 账户通知" },
      { slug: "import", label: "导入", keywords: "import cursor vscode windsurf claude 导入" },
      { slug: "profile", label: "个人资料", keywords: "profile avatar username bio 个人 资料" },
      { slug: "appearance", label: "外观", keywords: "appearance theme font color" },
      { slug: "account", label: "账户", keywords: "account login logout email 账户 登录 退出 邮箱" },
      { slug: "archived-chats", label: "已归档的聊天", keywords: "archived chats history restore 归档" },
      { slug: "voice", label: "语音", keywords: "voice dictation microphone 语音 听写" },
      { slug: "storage", label: "存储", keywords: "storage disk cache worktree 存储 磁盘" },
      { slug: "agent", label: "配置", keywords: "agent model provider reasoning approval sandbox verbosity web_search instructions 模型 推理 审批 沙盒 指令" },
      { slug: "personalization", label: "个性化", keywords: "personalization tone instructions" },
      { slug: "pets", label: "虚拟宠物", keywords: "pets companion mini widget 宠物" },
      { slug: "keyboard-shortcuts", label: "键盘快捷键", keywords: "shortcuts keybindings hotkeys" },
      { slug: "usage", label: "使用情况和计费", keywords: "usage plan billing rate limit quota credits 用量 计划 额度 计费" },
    ],
  },
  {
    groupTitle: "集成",
    items: [
      { slug: "plugins-settings", label: "插件", keywords: "plugins marketplace auto update 插件 技能" },
      { slug: "computer-use", label: "电脑操控", keywords: "computer use automation desktop any app 操控" },
      { slug: "appshots", label: "应用快照", keywords: "appshots screenshot window capture 快照 截屏" },
      { slug: "browser-use", label: "浏览器", keywords: "browser use cdp webmcp automation 浏览器" },
    ],
  },
  {
    groupTitle: "编码",
    items: [
      { slug: "hooks-settings", label: "钩子", keywords: "hooks hooks.json preToolUse postToolUse stop 运行 实时 生命周期 挂钩" },
      { slug: "connections", label: "连接", keywords: "connections mcp servers" },
      { slug: "cloud-settings", label: "云端偏好设置", keywords: "cloud preferences environments diff branch 云端" },
      { slug: "codex-cloud", label: "Codex 云端", keywords: "cloud environments personal vault 云端 环境 保险库" },
      { slug: "code-review", label: "代码审查", keywords: "code review pr mr diff severity 审查 评审" },
      { slug: "git-settings", label: "Git", keywords: "git branch prefix force lease pr" },
      { slug: "local-environments", label: "环境", keywords: "local environments default.toml run test 环境" },
      { slug: "worktrees", label: "Worktrees", keywords: "worktrees cleanup retention 隔离 工作树" },
    ],
  },
];

// Existing icon set supplies the navigation structure; official asset contours remain unverified.
const SETTINGS_NAV_ICONS = {
  "general-settings": Settings, notifications: Bell, import: Download, profile: User, appearance: Palette,
  account: User, "archived-chats": Archive, voice: Mic, storage: HardDrive, agent: SlidersHorizontal,
  personalization: Sparkles, pets: Cat, "keyboard-shortcuts": Keyboard, usage: ChartNoAxesCombined,
  "plugins-settings": Plug, "computer-use": Monitor, appshots: Camera, "browser-use": Globe,
  "hooks-settings": Webhook, connections: Cable, "cloud-settings": Cloud, "codex-cloud": Cloud, "code-review": ScanSearch,
  "git-settings": GitBranch, "local-environments": Terminal, worktrees: FolderGit2,
};

interface SettingsViewProps {
  onOpenCloudDraft?: OpenCloudDraft;
  cloudEnvironmentFocusId?: string;
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
  followUp: { mode: FollowUpMode; saving: boolean; error: string; onChange: (value: FollowUpMode) => void };
  contextUsage: { visible: boolean; saving: boolean; error: string; onChange: (value: boolean) => void };
  bottomPanelLauncher?: BottomPanelLauncherPreference;
  appServerStatus: AppServerStatus;
  models: ModelInfo[];
  activeWorkspaceRoot?: string;
  workspaceRoots?: string[];
  environmentProjects?: { path: string; name: string }[];
  onAddEnvironmentProject?: () => void;
  accountIdentity?: string;
  onAccountChanged?: () => void;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
  onPluginNavigationChange?: (navigation: PluginDirectoryNavigation | null) => void;
  initialSection?: SettingsSectionSlug;
  petVisible?: boolean;
  onTogglePetVisible: (visible: boolean) => void;
  onRestartAppServer: (customCliPath?: string) => void | Promise<unknown>;
  onConfigUpdated: () => void;
  onNavigateRoute?: (route: MainViewRoute) => void;
  onNotify?: (message: string, type?: "success" | "error") => void;
  onOpenPluginDirectoryDetail?: (detail: PluginDetail | string) => void;
  onOpenPluginMarketplace?: (marketplaceName: string) => void;
  onOpenLibraryStorage?: (tab: "all" | "images") => void;
  onRunEnvironmentCommand: (cwd: string, command: string) => void;
  environmentTarget?: { id: string; cwd: string; configPath: string | null; edit?: boolean };
  onRunEnvironmentAction?: (request: EnvironmentActionRunRequest) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onOpenCloudDraft,
  cloudEnvironmentFocusId,
  petPreferencesState,
  archiveViewProps,
  onRunEnvironmentCommand, environmentTarget, onRunEnvironmentAction,
  notificationState,
  gitPreferencesState,
  codeReviewPreferencesState,
  externalImportsState,
  keyboardState,
  appearanceState,
  composerEnterBehavior, composerEnterSaving, composerEnterError, onSetComposerEnterBehavior, followUp, contextUsage,
  bottomPanelLauncher,
  appServerStatus,
  activeWorkspaceRoot = "",
  workspaceRoots,
  environmentProjects,
  onAddEnvironmentProject,
  accountIdentity,
  onAccountChanged,
  onNavigationGuardChange,
  onPluginNavigationChange,
  initialSection = "general-settings",
  petVisible = false,
  onTogglePetVisible,
  onRestartAppServer,
  onConfigUpdated,
  onNavigateRoute,
  onOpenPluginMarketplace,
  onOpenPluginDirectoryDetail,
  onNotify,
  onOpenLibraryStorage,
}) => {
  const [activeSection, commitActiveSection] =
    useState<SettingsSectionSlug>(initialSection === "providers-models" ? "agent" : initialSection === "experimental" ? "general-settings" : initialSection);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  const personalizationNavigationGuardRef = useRef<((action: () => void) => boolean) | null>(null);
  const settingsGuardsRef = useRef<Record<"personalization" | "account" | "profile" | "mcp" | "plugins" | "environments", ((action: () => void) => boolean) | null>>({ personalization: null, account: null, profile: null, mcp: null, plugins: null, environments: null });
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
  const registerEnvironmentNavigationGuard = useCallback((guard: ((action: () => void) => boolean) | null) => {
    settingsGuardsRef.current.environments = guard; publishSettingsGuard();
  }, [publishSettingsGuard]);
  const setActiveSection = useCallback((section: SettingsSectionSlug) => {
    if (section === activeSectionRef.current) return;
    const apply = () => {
      if (section !== "plugins-settings" && parsePluginManagementLocation(window.location.href)) {
        const url = new URL(window.location.href); url.pathname = "/";
        for (const key of ["hostId", "tab", "pluginName", "marketplacePath", "remoteMarketplaceName", "mode", "breadcrumb"]) url.searchParams.delete(key);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
      activeSectionRef.current = section; commitActiveSection(section);
    };
    if (personalizationNavigationGuardRef.current?.(apply) === false) return;
    apply();
  }, []);
  const connectionIdentity = JSON.stringify([appServerStatus.connected, appServerStatus.binaryPath, appServerStatus.appServerVersion, appServerStatus.userAgent]);
  const archivedCloudTasks = useArchivedCloudTasks({ enabled: activeSection === "archived-chats",
    scope: JSON.stringify([connectionIdentity, accountIdentity]), connected: appServerStatus.connected });
  const archivedConversations = useArchivedConversations({ enabled: activeSection === "archived-chats",
    scope: JSON.stringify([connectionIdentity, accountIdentity]), connected: appServerStatus.connected });
  const archivedDurableChats = useArchivedDurableChats({ enabled: activeSection === "archived-chats",
    scope: JSON.stringify([connectionIdentity, accountIdentity]), connected: appServerStatus.connected });
  const [navSearch, setNavSearch] = useState("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  useEffect(() => {
    if (activeSection === "plugins-settings" && !parsePluginManagementLocation(window.location.href)) {
      window.history.replaceState(window.history.state, "", "/settings/plugins-settings");
    }
  }, [activeSection]);
  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection === "providers-models" ? "agent" : initialSection === "experimental" ? "general-settings" : initialSection);
    }
  }, [initialSection]);

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

  return (
    <div className="settings-center-shell" onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }}>
      {/* Settings navigation uses the current official grouping for existing routes. */}
      <aside className="settings-left-nav" aria-label="设置">
        <h2 className="settings-nav-title">设置</h2>
        <div className="settings-search-box">
          <Search size={13} />
          <input
            type="text"
            role="searchbox"
            ref={searchInputRef}
            autoFocus
            aria-label="搜索设置"
            placeholder="搜索"
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
          />
          {navSearch && <button type="button" aria-label="清除设置搜索" onClick={() => {
            setNavSearch("");
            searchInputRef.current?.focus();
          }}><X size={13} aria-hidden="true" /></button>}
        </div>

        <div className="settings-nav-groups" onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const current = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-settings-panel-slug]");
          if (!current) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-settings-panel-slug]"));
          const next = buttons[buttons.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1)];
          next?.focus();
          next?.click();
        }}>
          {filteredNavGroups.map((group) => (
            <div key={group.groupTitle} className="settings-nav-group">
              <div className="settings-nav-group-title">{group.groupTitle}</div>
              {group.items.map((item) => {
                const Icon = SETTINGS_NAV_ICONS[item.slug as keyof typeof SETTINGS_NAV_ICONS];
                return (
                <button
                  key={item.slug}
                  data-settings-panel-slug={item.slug}
                  type="button"
                  className={`settings-nav-item ${
                    activeSection === item.slug ? "active" : ""
                  }`}
                  aria-current={activeSection === item.slug ? "page" : undefined}
                  onClick={() => setActiveSection(item.slug)}
                >
                  {Icon && <Icon size={16} aria-hidden="true" />}<span>{item.label}</span>
                </button>
              ); })}
            </div>
          ))}
          {filteredNavGroups.length === 0 && <p className="settings-search-empty" role="status">未找到结果</p>}
        </div>
      </aside>

      {/* Right Content Pane */}
      <div className="settings-right-content">
        {activeSection !== "codex-cloud" && activeSection !== "plugins-settings" && <div className="panel-page-header">
          <div>
            <h2>
              {activeSection === "storage" ? "存储空间" : SETTINGS_NAV_GROUPS.flatMap((g) => g.items).find(
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
        </div>}

        {activeSection === "general-settings" && (
          <div className="settings-scroll-container settings-general-content">
            <section className="settings-general-group" aria-labelledby="general-preferences-heading">
              <h3 id="general-preferences-heading">常规</h3>
              <GeneralOpenPreferences bottomPanelLauncher={bottomPanelLauncher} />
            </section>
            <section className="settings-general-group" aria-labelledby="composer-preferences-heading">
              <h3 id="composer-preferences-heading">编辑器</h3>
              <div className="form-field">
                <label htmlFor="composer-enter-behavior">发送快捷键</label>
                <p className="card-subtitle-desc">选择按 Enter 时是发送提示还是插入新行</p>
                <GeneralPreferenceSelect id="composer-enter-behavior" label="发送快捷键" value={composerEnterBehavior}
                  disabled={composerEnterSaving}
                  options={[
                    { value: "enter", label: "按 Enter 键" },
                    { value: "cmdIfMultiline", label: "Ctrl + Enter 用于多行提示" },
                    { value: "cmdAlways", label: "总是使用 Ctrl + Enter" },
                  ]}
                  onChange={value => onSetComposerEnterBehavior(value as ComposerEnterBehavior)} />
                {composerEnterError && <p role="alert">{composerEnterError}</p>}
              </div>
              <div className="form-field">
                <label htmlFor="follow-up-mode">后续消息处理方式</label>
                <p className="card-subtitle-desc">在 Codex 运行时将后续消息加入队列，或引导当前运行。按 {composerEnterBehavior === "enter" ? "Ctrl + Enter" : "Ctrl + Shift + Enter"} 可对单条消息执行相反操作</p>
                <GeneralPreferenceSelect id="follow-up-mode" label="后续消息处理方式" value={followUp.mode}
                  disabled={followUp.saving}
                  options={[{ value: "queue", label: "排队" }, { value: "steer", label: "引导" }]}
                  onChange={value => followUp.onChange(value === "queue" ? "queue" : "steer")}
                  onReselect={() => { if (followUp.error) followUp.onChange(followUp.mode); }} />
                {followUp.error && <p role="alert">{followUp.error}</p>}
              </div>
              <div className="form-field">
                <label htmlFor="show-context-window-usage">显示上下文窗口使用情况</label>
                <div className="bottom-panel-launcher-setting">
                  <label className="switch-control">
                    <input id="show-context-window-usage" type="checkbox" role="switch" checked={contextUsage.visible}
                      aria-label="在编辑器中显示上下文窗口使用情况" disabled={contextUsage.saving}
                      onChange={event => contextUsage.onChange(event.target.checked)} />
                    <span className="switch-slider" aria-hidden="true" />
                  </label>
                </div>
                {contextUsage.error && <p role="alert">{contextUsage.error}</p>}
              </div>
            </section>
            <ExperimentalFeatures connected={appServerStatus.connected} />
            <NotificationSettings state={notificationState} />
          </div>
        )}

        {activeSection === "appearance" && (
          <div className="settings-scroll-container settings-appearance-content">
            <AppearanceSettings state={appearanceState} />
          </div>
        )}

        {/* Local config compatibility surface; Work preferences require their own account API. */}
        {activeSection === "agent" && (
          <AgentSettings cwd={activeWorkspaceRoot || undefined} accountIdentity={accountIdentity} onConfigUpdated={onConfigUpdated} />
        )}

        {activeSection === "pets" && <PetsSettings state={petPreferencesState} visible={petVisible} onSetVisible={onTogglePetVisible} />}

        {/* SECTION: STORAGE */}
        {activeSection === "storage" && <StorageSettings scope={JSON.stringify([connectionIdentity, accountIdentity])} onOpenLibrary={onOpenLibraryStorage} />}

        {/* SECTION: ARCHIVED CHATS */}
        {activeSection === "archived-chats" && (
          <div className="settings-scroll-container">
            <ArchiveView {...archiveViewProps} surface="settings" cloudArchive={archivedCloudTasks} conversationArchive={archivedConversations} durableArchive={archivedDurableChats} />
          </div>
        )}

        {/* SECTION: LOCAL ENVIRONMENTS */}
        {activeSection === "local-environments" && (
          <LocalEnvironmentSettings environmentTarget={environmentTarget} onRunEnvironmentAction={onRunEnvironmentAction} cwd={activeWorkspaceRoot} projects={environmentProjects} connectionIdentity={JSON.stringify([connectionIdentity, accountIdentity])} onNavigationGuardChange={registerEnvironmentNavigationGuard} onAddProject={onAddEnvironmentProject} onRunCommand={onRunEnvironmentCommand} />
        )}

        {/* SECTION: NOTIFICATIONS */}
        {activeSection === "notifications" && (
          <div className="settings-scroll-container">
            <AccountNotificationSettings scope={JSON.stringify([connectionIdentity, accountIdentity])} connected={appServerStatus.connected} onManageTasks={() => onNavigateRoute?.("scheduled")} />
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
              workspaceRoots={workspaceRoots}
              manageOnly
              connectionIdentity={JSON.stringify([connectionIdentity, accountIdentity])}
              onConfigUpdated={onConfigUpdated}
              onRestartAppServer={() => onRestartAppServer()}
              onNavigationGuardChange={registerPluginNavigationGuard}
              onNavigationChange={onPluginNavigationChange}
              onNotify={onNotify}
              onOpenPluginDirectoryDetail={onOpenPluginDirectoryDetail}
              onOpenPluginSettings={setActiveSection}
              onBrowseDirectory={(tab, marketplaceName) => marketplaceName
                ? onOpenPluginMarketplace?.(marketplaceName)
                : onNavigateRoute?.(tab === "skills" ? "skills" : "plugins")}
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
        {activeSection === "worktrees" && <>
          <WorktreeSettings />
          <WorktreeInventory key={JSON.stringify([connectionIdentity, accountIdentity])}
            workspaceRoots={workspaceRoots} onOpenThread={archiveViewProps.onSelectThread} />
        </>}

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
        {activeSection === "code-review" && <CodeReviewSettings state={codeReviewPreferencesState} providerScope={JSON.stringify([connectionIdentity, accountIdentity])} />}

        {activeSection === "computer-use" && <ComputerUseSettings onManagePlugins={() => setActiveSection("plugins-settings")} />}
        {activeSection === "appshots" && <AppshotsSettings />}
        {activeSection === "browser-use" && <BrowserUseSettings />}

        {activeSection === "cloud-settings" && <CloudPreferencesSettings />}
        {activeSection === "codex-cloud" && <div className="settings-scroll-container"><CloudEnvironmentsView embedded onOpenDraft={onOpenCloudDraft} returnFocusId={cloudEnvironmentFocusId} /></div>}

      </div>
    </div>
  );
};
