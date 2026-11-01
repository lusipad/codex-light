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
  ImageIcon,
  CloudIcon,
  BookOpenIcon,
  GptIcon,
  ChevronRightIcon,
} from "./Icons";
import { MainViewRoute } from "../types";
import type { AccountReadResult } from "../config";
import "./NavigationRail.css";

export interface NavigationRailProps {
  activeRoute: MainViewRoute;
  sidebarCollapsed: boolean;
  unreadInboxCount: number;
  appServerConnected: boolean;
  accountInfo?: AccountReadResult | null;
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
  accountInfo,
  petVisible = false,
  onTogglePet,
  onNavigate,
  onOpenUsage,
  onCommand,
}) => {
  const instanceId = useId().replace(/:/g, "");
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const keyboardOpenRef = useRef(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPosition, setHelpPosition] = useState({ left: 0, bottom: 8 });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  }>({ left: 0 });
  const account = appServerConnected ? accountInfo?.account : null;
  const identity = account?.type === "chatgpt"
    ? account.email?.trim() || "个人资料"
    : account?.type === "apiKey"
      ? "已通过 API 密钥登录"
      : account?.type === "amazonBedrock"
        ? "已使用 Amazon Bedrock 登录"
        : null;
  const avatar = account?.type === "chatgpt" && account.email?.trim()
    ? account.email.trim()[0].toUpperCase()
    : <SettingsIcon size={16} />;

  const positionMenu = (event: React.SyntheticEvent<HTMLButtonElement>, profile: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition(
      profile
        ? { left: rect.right + 8, bottom: window.innerHeight - rect.top + 4 }
        : { left: rect.right + 8, top: rect.top }
    );
  };

  const handleTriggerKeys = (event: React.KeyboardEvent<HTMLButtonElement>, profile: boolean) => {
    if (["Enter", " "].includes(event.key)) keyboardOpenRef.current = true;
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    keyboardOpenRef.current = true;
    positionMenu(event, profile);
    const target = event.currentTarget.getAttribute("popovertarget");
    const popover = target ? document.getElementById(target) : null;
    if (popover?.matches(":popover-open")) {
      popover.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } else {
      popover?.showPopover();
    }
  };

  const closePopover = (element: HTMLElement) => {
    (element.closest("[popover]") as HTMLElement | null)?.hidePopover?.();
  };

  const openHelp = (trigger: HTMLButtonElement, keyboard: boolean) => {
    const popover = helpRef.current;
    if (!popover) return;
    popover.showPopover();
    const rect = trigger.getBoundingClientRect();
    const menu = popover.getBoundingClientRect();
    const left = rect.right + 4 + menu.width <= window.innerWidth - 8
      ? rect.right + 4 : rect.left - menu.width - 4;
    setHelpPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - menu.width - 8)),
      bottom: Math.max(8, Math.min(window.innerHeight - rect.bottom, window.innerHeight - menu.height - 8)),
    });
    setHelpOpen(true);
    if (keyboard) popover.querySelector<HTMLButtonElement>("button")?.focus();
  };

  const closeHelp = (returnFocus: boolean) => {
    helpRef.current?.hidePopover();
    setHelpOpen(false);
    if (returnFocus) helpTriggerRef.current?.focus();
  };

  const selectHelp = (command: string) => {
    closeHelp(false);
    document.getElementById(`${instanceId}-profile`)?.hidePopover();
    // Preserve a visible return target before opening a modal or leaving the app.
    triggerRefs.current.profile?.focus({ preventScroll: true });
    onCommand(command);
  };

  const handleHelpKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeHelp(true);
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      closeHelp(false);
      document.getElementById(`${instanceId}-profile`)?.hidePopover();
      return;
    }
    event.stopPropagation();
    handleMenuKeys(event);
  };

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight" && helpTriggerRef.current && document.activeElement === helpTriggerRef.current) {
      event.preventDefault();
      openHelp(helpTriggerRef.current, true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.hidePopover();
      triggerRefs.current[event.currentTarget.id === `${instanceId}-profile` ? "profile" : "more"]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") {
      event.currentTarget.hidePopover();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")
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
          : current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const handleToggle = (event: React.SyntheticEvent<HTMLElement>, key: string) => {
    const nativeEvent = event.nativeEvent as ToggleEvent;
    const popover = event.currentTarget;
    if (nativeEvent.newState === "open") {
      setOpenMenu(key);
      if (keyboardOpenRef.current) {
        requestAnimationFrame(() => {
          if (popover.matches(":popover-open") && (document.activeElement === triggerRefs.current[key] || popover.contains(document.activeElement))) {
            popover.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
          }
        });
      }
    } else {
      setOpenMenu((current) => current === key ? null : current);
      if (key === "profile") closeHelp(false);
    }
    keyboardOpenRef.current = false;
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
          aria-haspopup="menu"
          aria-expanded={openMenu === "more"}
          title="探索"
          onClick={(event) => positionMenu(event, false)}
          onPointerDown={() => { keyboardOpenRef.current = false; }}
          onKeyDown={(event) => handleTriggerKeys(event, false)}
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
          aria-haspopup="menu"
          aria-expanded={openMenu === "profile"}
          title="打开个人资料菜单"
          onClick={(event) => positionMenu(event, true)}
          onPointerDown={() => { keyboardOpenRef.current = false; }}
          onKeyDown={(event) => handleTriggerKeys(event, true)}
          {...({ popovertarget: `${instanceId}-profile` } as any)}
        >
          <span className="nav-rail-avatar" aria-hidden="true">{avatar}</span>
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
          { route: "sites" as const, label: "Sites 托管", icon: <GlobeIcon size={16} /> },
          { route: "library" as const, label: "资料库与 Space", icon: <BookOpenIcon size={16} /> },
          { route: "images" as const, label: "图像中心", icon: <ImageIcon size={16} /> },
          { route: "gpts" as const, label: "GPTs 探索与迁移", icon: <GptIcon size={16} /> },
          { route: "cloud-environments" as const, label: "云开发环境", icon: <CloudIcon size={16} /> },
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
        onMouseMove={(event) => {
          const button = (event.target as HTMLElement).closest("button");
          if (helpOpen && button && button !== helpTriggerRef.current && button.parentElement === event.currentTarget) closeHelp(false);
        }}
        {...({ popover: "auto" } as any)}
      >
        {identity && <div className="nav-rail-profile-summary">
          <span className="nav-rail-avatar large" aria-hidden="true">{avatar}</span>
          <div>
            <strong>{identity}</strong>
          </div>
        </div>}
        {account?.type === "chatgpt" && <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={(event) => { closePopover(event.currentTarget); onOpenUsage(); }}>
          <ClockIcon size={16} />
          <span>使用情况</span>
        </button>}
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
        <div role="separator" className="nav-rail-menu-separator" />
        <button
          ref={helpTriggerRef}
          type="button"
          role="menuitem"
          className="nav-rail-menu-item"
          aria-haspopup="menu"
          aria-expanded={helpOpen}
          aria-controls={`${instanceId}-help`}
          onMouseEnter={(event) => openHelp(event.currentTarget, false)}
          onClick={(event) => openHelp(event.currentTarget, event.detail === 0)}
        >
          <GlobeIcon size={16} />
          <span>帮助</span>
          <ChevronRightIcon size={13} />
        </button>
        <div
          ref={helpRef}
          id={`${instanceId}-help`}
          className="nav-rail-popover nav-rail-help-popover"
          role="menu"
          aria-label="帮助"
          style={helpPosition}
          onKeyDown={handleHelpKeys}
          onToggle={(event) => {
            event.stopPropagation();
            setHelpOpen((event.nativeEvent as ToggleEvent).newState === "open");
          }}
          {...({ popover: "auto" } as any)}
        >
          <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={() => selectHelp("changelog")}>
            <SparklesIcon size={16} /><span>新功能</span>
          </button>
          <div role="separator" className="nav-rail-menu-separator" />
          <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={() => selectHelp("show-keyboard-shortcuts")}>
            <span>键盘快捷键</span><kbd>Ctrl+/</kbd>
          </button>
          <button type="button" role="menuitem" className="nav-rail-menu-item" onClick={() => selectHelp("user-guide")}>
            <BookOpenIcon size={16} /><span>用户指南</span>
          </button>
        </div>
      </div>
    </nav>
  );
};
