import React from "react";
import {
  SidebarLeftIcon,
  OpenAIIcon,
  FolderIcon,
  BellIcon,
  AutomationIcon,
  SkillIcon,
  WorktreeIcon,
  SettingsIcon,
  SparklesIcon,
  FileCodeIcon,
  ArchiveIcon,
} from "./Icons";
import { MainViewRoute } from "../types";

export interface NavigationRailProps {
  activeRoute: MainViewRoute;
  sidebarCollapsed: boolean;
  unreadInboxCount: number;
  appServerConnected: boolean;
  petVisible?: boolean;
  onTogglePet?: () => void;
  onToggleSidebar: () => void;
  onNavigate: (route: MainViewRoute) => void;
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
  activeRoute,
  sidebarCollapsed,
  unreadInboxCount,
  appServerConnected,
  petVisible = false,
  onTogglePet,
  onToggleSidebar,
  onNavigate,
}) => {
  return (
    <nav className="codex-nav-rail" aria-label="主导航栏">
      <div className="nav-rail-top">
        <button
          type="button"
          className={`nav-rail-btn ${sidebarCollapsed ? "" : "rail-toggle-open"}`}
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "展开侧边栏 (Ctrl+B)" : "折叠侧边栏 (Ctrl+B)"}
        >
          <SidebarLeftIcon size={16} />
        </button>

        <div className="nav-rail-divider" />

        <button
          type="button"
          className={`nav-rail-btn ${
            activeRoute === "home" || activeRoute === "thread" ? "active" : ""
          }`}
          onClick={() => onNavigate("home")}
          title="聊天与新任务 (Home)"
        >
          <OpenAIIcon size={16} />
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "projects" ? "active" : ""}`}
          onClick={() => onNavigate("projects")}
          title="项目中心 (Projects)"
        >
          <FolderIcon size={16} />
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "inbox" ? "active" : ""}`}
          onClick={() => onNavigate("inbox")}
          title="收件箱与动态通知 (Inbox)"
          style={{ position: "relative" }}
        >
          <BellIcon size={16} />
          {unreadInboxCount > 0 && <span className="nav-rail-badge-dot" />}
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "scheduled" ? "active" : ""}`}
          onClick={() => onNavigate("scheduled")}
          title="计划任务与长期目标 (Scheduled & /goal)"
        >
          <AutomationIcon size={16} />
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "plugins" ? "active" : ""}`}
          onClick={() => onNavigate("plugins")}
          title="插件、技能与 MCP 市场 (Plugins & Skills)"
        >
          <SkillIcon size={16} />
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "worktrees" ? "active" : ""}`}
          onClick={() => onNavigate("worktrees")}
          title="托管工作树 (Worktrees)"
        >
          <WorktreeIcon size={16} />
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "review" ? "active" : ""}`}
          onClick={() => onNavigate("review")}
          title="代码审查 (Code Review)"
        >
          <FileCodeIcon size={16} />
        </button>

        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "archive" ? "active" : ""}`}
          onClick={() => onNavigate("archive")}
          title="已归档会话 (Archive)"
        >
          <ArchiveIcon size={16} />
        </button>
      </div>

      <div className="nav-rail-bottom">
        {onTogglePet && (
          <button
            type="button"
            className={`nav-rail-btn ${petVisible ? "active" : ""}`}
            onClick={onTogglePet}
            title="召唤 / 隐藏桌面虚拟宠物伴侣 (Mini Pet)"
          >
            <SparklesIcon size={15} />
          </button>
        )}
        <span
          className={`nav-rail-status-dot ${
            appServerConnected ? "online" : "offline"
          }`}
          title={
            appServerConnected
              ? "codex app-server 已连接"
              : "codex app-server 未连接"
          }
        />
        <button
          type="button"
          className={`nav-rail-btn ${activeRoute === "settings" ? "active" : ""}`}
          onClick={() => onNavigate("settings")}
          title="设置中心 (Settings)"
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    </nav>
  );
};
