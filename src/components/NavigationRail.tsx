import React, { useId, useRef, useState } from "react";
import {
  HomeIcon,
  FolderIcon,
  BellIcon,
  AutomationIcon,
  SkillIcon,
  WorktreeIcon,
  SettingsIcon,
  SparklesIcon,
  FileCodeIcon,
  ArchiveIcon,
  EllipsisIcon,
  ClockIcon,
  GlobeIcon,
} from "./Icons";
import { MainViewRoute } from "../types";
import "./NavigationRail.css";

export interface NavigationRailProps {
  activeRoute: MainViewRoute;
  sidebarCollapsed: boolean;
  unreadInboxCount: number;
  appServerConnected: boolean;
  petVisible?: boolean;
  onTogglePet?: () => void;
  onToggleSidebar: () => void;
  onNavigate: (route: MainViewRoute) => void;
  onOpenUsage: () => void;
  onCommand: (command: string) => void;
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
  activeRoute,
  unreadInboxCount,
  appServerConnected,
  petVisible = false,
  onTogglePet,
  onNavigate,
  onOpenUsage,
  onCommand,
}) => {
  const instanceId = useId().replace(/:/g, "");
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  }>({ left: 0 });

  const positionMenu = (event: React.MouseEvent<HTMLButtonElement>, profile: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition(
      profile
        ? { left: rect.right + 8, bottom: window.innerHeight - rect.top + 4 }
        : { left: rect.right + 8, top: rect.top }
    );
  };

  const closePopover = (element: HTMLElement) => {
    (element.closest("[popover]") as HTMLElement | null)?.hidePopover?.();
  };

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
    );
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowDown"
          ? (current + 1 + buttons.length) % buttons.length
          : (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const handleToggle = (event: React.SyntheticEvent<HTMLElement>, key: string) => {
    const nativeEvent = event.nativeEvent as ToggleEvent;
    const popover = event.currentTarget;
    if (nativeEvent.newState === "open") {
      requestAnimationFrame(() => {
        popover.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      });
    } else {
      triggerRefs.current[key]?.focus({ preventScroll: true });
    }
  };

  const routeButton = (
    route: MainViewRoute,
    title: string,
    icon: React.ReactNode,
    active = activeRoute === route
  ) => (
    <button
      type="button"
      className={`nav-rail-btn ${active ? "active" : ""}`}
      onClick={() => onNavigate(route)}
      aria-label={title}
      aria-pressed={active}
      title={title}
    >
      {icon}
    </button>
  );

  return (
    <nav className="codex-nav-rail" aria-label="应用导航">
      <div className="nav-rail-top">
        {routeButton("home", "首页", <HomeIcon size={18} />, activeRoute === "home" || activeRoute === "thread")}
        {routeButton("scheduled", "定时任务", <AutomationIcon size={18} />)}
        {routeButton("plugins", "插件", <SkillIcon size={18} />)}
        <button
          ref={(node) => { triggerRefs.current.more = node; }}
          type="button"
          className="nav-rail-btn"
          aria-label="探索"
          title="探索"
          onClick={(event) => positionMenu(event, false)}
          {...({ popovertarget: `${instanceId}-more` } as any)}
        >
          <EllipsisIcon size={18} />
        </button>
        {routeButton("review", "代码审查", <FileCodeIcon size={18} />)}
      </div>

      <div className="nav-rail-bottom">
        <button
          ref={(node) => { triggerRefs.current.profile = node; }}
          type="button"
          className="nav-rail-profile-button"
          aria-label="打开个人资料菜单"
          title={`打开个人资料菜单 · app-server ${appServerConnected ? "已连接" : "未连接"}`}
          onClick={(event) => positionMenu(event, true)}
          {...({ popovertarget: `${instanceId}-profile` } as any)}
        >
          <span className="nav-rail-avatar" aria-hidden="true">C</span>
          <span className={`nav-rail-profile-status ${appServerConnected ? "online" : "offline"}`} aria-hidden="true" />
        </button>
      </div>

      <div
        id={`${instanceId}-more`}
        className="nav-rail-popover"
        role="menu"
        aria-label="更多功能"
        style={menuPosition}
        onKeyDown={handleMenuKeys}
        onToggle={(event) => handleToggle(event, "more")}
        {...({ popover: "auto" } as any)}
      >
        {[
          { route: "projects" as const, label: "项目", icon: <FolderIcon size={16} /> },
          { route: "worktrees" as const, label: "Worktrees", icon: <WorktreeIcon size={16} /> },
          { route: "inbox" as const, label: "收件箱", icon: <BellIcon size={16} />, badge: unreadInboxCount },
          { route: "archive" as const, label: "已归档的聊天", icon: <ArchiveIcon size={16} /> },
        ].map((item) => (
          <button
            key={item.route}
            type="button"
            role="menuitem"
            className="nav-rail-menu-item"
            onClick={(event) => {
              closePopover(event.currentTarget);
              onNavigate(item.route);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {!!item.badge && <span className="nav-rail-menu-badge">{item.badge}</span>}
          </button>
        ))}
      </div>

      <div
        id={`${instanceId}-profile`}
        className="nav-rail-popover nav-rail-profile-popover"
        role="menu"
        aria-label="个人资料菜单"
        style={menuPosition}
        onKeyDown={handleMenuKeys}
        onToggle={(event) => handleToggle(event, "profile")}
        {...({ popover: "auto" } as any)}
      >
        <div className="nav-rail-profile-summary">
          <span className="nav-rail-avatar large" aria-hidden="true">C</span>
          <div>
            <strong>Codex Native</strong>
            <span>{appServerConnected ? "app-server 已连接" : "app-server 未连接"}</span>
          </div>
        </div>
        <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={(event) => { closePopover(event.currentTarget); onOpenUsage(); }}>
          <ClockIcon size={16} />
          <span>剩余用量</span>
        </button>
        {onTogglePet && (
          <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={(event) => { closePopover(event.currentTarget); onTogglePet(); }}>
            <SparklesIcon size={16} />
            <span>{petVisible ? "隐藏 Mini" : "显示 Mini"}</span>
          </button>
        )}
        <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={(event) => { closePopover(event.currentTarget); onNavigate("settings"); }}>
          <SettingsIcon size={16} />
          <span>设置</span>
          <kbd>Ctrl+,</kbd>
        </button>
        <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={(event) => { closePopover(event.currentTarget); onCommand("documentation"); }}>
          <GlobeIcon size={16} />
          <span>帮助与文档</span>
        </button>
      </div>
    </nav>
  );
};
