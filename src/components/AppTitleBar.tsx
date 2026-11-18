import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  SidebarLeftIcon,
} from "./Icons";
import "./AppTitleBar.css";

export interface AppTitleBarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  sidebarCollapsed: boolean;
  onBack: () => void;
  onForward: () => void;
  onToggleSidebar?: () => void;
  onCommand: (command: string) => void;
}

type MenuEntry =
  | { type: "separator" }
  | { type: "item"; id: string; label: string; shortcut?: string; danger?: boolean };

const MENU_SECTIONS: Array<{ id: string; label: string; entries: MenuEntry[] }> = [
  {
    id: "file",
    label: "文件",
    entries: [
      { type: "item", id: "new-chat", label: "新聊天", shortcut: "Ctrl+N" },
      { type: "item", id: "new-standalone-chat", label: "新建无项目聊天", shortcut: "Ctrl+Alt+O" },
      { type: "item", id: "open-hotkey-window", label: "快捷聊天窗口（开发入口）" },
      { type: "item", id: "open-workspace", label: "打开文件夹…", shortcut: "Ctrl+O" },
      { type: "separator" },
      { type: "item", id: "settings", label: "设置…", shortcut: "Ctrl+," },
      { type: "separator" },
      { type: "item", id: "quit", label: "退出", shortcut: "Ctrl+Q", danger: true },
    ],
  },
  {
    id: "edit",
    label: "编辑",
    entries: [
      { type: "item", id: "edit-undo", label: "撤销", shortcut: "Ctrl+Z" },
      { type: "item", id: "edit-redo", label: "重做", shortcut: "Ctrl+Y" },
      { type: "separator" },
      { type: "item", id: "edit-cut", label: "剪切", shortcut: "Ctrl+X" },
      { type: "item", id: "edit-copy", label: "复制", shortcut: "Ctrl+C" },
      { type: "item", id: "edit-paste", label: "粘贴", shortcut: "Ctrl+V" },
      { type: "item", id: "edit-delete", label: "删除" },
      { type: "item", id: "edit-select-all", label: "全选", shortcut: "Ctrl+A" },
    ],
  },
  {
    id: "view",
    label: "视图",
    entries: [
      { type: "item", id: "toggle-sidebar", label: "切换侧边栏", shortcut: "Ctrl+B" },
      { type: "item", id: "toggle-terminal", label: "打开终端", shortcut: "Ctrl+`" },
      { type: "item", id: "toggle-bottom-panel", label: "显示/隐藏底部面板", shortcut: "Ctrl+J" },
      { type: "item", id: "toggle-changes", label: "切换变更面板", shortcut: "Ctrl+Alt+B" },
      { type: "separator" },
      { type: "item", id: "command-palette", label: "命令面板", shortcut: "Ctrl+K" },
      { type: "item", id: "file-search", label: "搜索文件", shortcut: "Ctrl+P" },
      { type: "separator" },
      { type: "item", id: "reload", label: "重新加载", shortcut: "Ctrl+R" },
      { type: "item", id: "zoom-in", label: "放大", shortcut: "Ctrl++" },
      { type: "item", id: "zoom-out", label: "缩小", shortcut: "Ctrl+-" },
      { type: "item", id: "zoom-reset", label: "实际大小", shortcut: "Ctrl+0" },
      { type: "item", id: "toggle-fullscreen", label: "全屏", shortcut: "F11" },
    ],
  },
  {
    id: "help",
    label: "帮助",
    entries: [
      { type: "item", id: "documentation", label: "文档" },
      { type: "item", id: "open-config-toml", label: "打开 config.toml" },
      { type: "item", id: "about", label: "关于 Codex Light" },
    ],
  },
];

function MinimizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 7h10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function MaximizeIcon({ maximized }: { maximized: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {maximized ? (
        <path d="M4.5 4.5V2.5h7v7h-2m-7-5h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      ) : (
        <rect x="2.5" y="2.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      )}
    </svg>
  );
}

export const AppTitleBar: React.FC<AppTitleBarProps> = ({
  canGoBack,
  canGoForward,
  sidebarCollapsed,
  onBack,
  onForward,
  onToggleSidebar,
  onCommand,
}) => {
  const instanceId = useId().replace(/:/g, "");
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let revision = 0;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      if (disposed) return;
      const appWindow = getCurrentWindow();
      const refresh = async () => {
        const currentRevision = ++revision;
        const next = await appWindow.isMaximized();
        if (!disposed && currentRevision === revision) setMaximized(next);
      };
      const stop = await appWindow.onResized(() => {
        void refresh().catch(console.error);
      });
      if (disposed) { stop(); return; }
      unlisten = stop;
      await refresh();
    }).catch(console.error);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const runCommand = (command: string, popover: HTMLElement) => {
    (popover as any).hidePopover?.();
    if (command.startsWith("edit-")) {
      const action = command.slice("edit-".length).replace("select-all", "selectAll");
      let completed = false;
      try {
        completed = document.execCommand(action);
      } catch {
        completed = false;
      }
      if (!completed) onCommand("edit-unavailable");
      return;
    }
    onCommand(command);
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

  const runWindowCommand = async (command: "minimize" | "maximize" | "close") => {
    if (!("__TAURI_INTERNALS__" in window)) {
      onCommand("window-unavailable");
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (command === "minimize") await appWindow.minimize();
    else if (command === "maximize") await appWindow.toggleMaximize();
    else await appWindow.close();
  };

  return (
    <header
      className="app-titlebar"
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, [popover]")) return;
        void runWindowCommand("maximize");
      }}
    >
      <div className="app-titlebar-nav">
        <button type="button" className="app-titlebar-icon" onClick={onBack} disabled={!canGoBack} aria-label="返回" title="返回">
          <ArrowLeftIcon size={16} />
        </button>
        <button type="button" className="app-titlebar-icon" onClick={onForward} disabled={!canGoForward} aria-label="前进" title="前进">
          <ArrowRightIcon size={16} />
        </button>
        {onToggleSidebar && <button
          type="button"
          className="app-titlebar-icon"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "展开侧边栏" : "隐藏侧边栏"}
          title={sidebarCollapsed ? "展开侧边栏 (Ctrl+B)" : "隐藏侧边栏 (Ctrl+B)"}
        >
          <SidebarLeftIcon size={16} />
        </button>}
      </div>

      <nav className="app-titlebar-menus" aria-label="应用程序菜单">
        {MENU_SECTIONS.map((section) => {
          const popoverId = `${instanceId}-${section.id}`;
          return (
            <React.Fragment key={section.id}>
              <button
                ref={(node) => { triggerRefs.current[section.id] = node; }}
                type="button"
                className="app-titlebar-menu-trigger"
                aria-label={section.label}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenuPosition({ top: rect.bottom + 4, left: rect.left });
                }}
                {...({ popovertarget: popoverId } as any)}
              >
                {section.label}
              </button>
              <div
                id={popoverId}
                className="app-titlebar-popover"
                role="menu"
                aria-label={section.label}
                style={{ top: menuPosition.top, left: menuPosition.left }}
                onKeyDown={handleMenuKeys}
                onToggle={(event: any) => {
                  const popover = event.currentTarget as HTMLElement;
                  if (event.newState === "open") {
                    requestAnimationFrame(() => {
                      popover.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
                    });
                  } else {
                    triggerRefs.current[section.id]?.focus({ preventScroll: true });
                  }
                }}
                {...({ popover: "auto" } as any)}
              >
                {section.entries.map((entry, index) => {
                  if (entry.type === "separator") {
                    return <div key={`${section.id}-separator-${index}`} className="app-titlebar-menu-separator" role="separator" />;
                  }
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitem"
                      disabled={entry.id === "toggle-sidebar" && !onToggleSidebar}
                      className={`app-titlebar-menu-item ${entry.danger ? "danger" : ""}`}
                      onClick={(event) => {
                        const popover = event.currentTarget.closest("[popover]") as HTMLElement;
                        runCommand(entry.id, popover);
                      }}
                    >
                      <span>{entry.label}</span>
                      {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                    </button>
                  );
                })}
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      <div className="app-titlebar-drag-space" data-tauri-drag-region />

      <div className="app-window-controls">
        <button type="button" className="app-window-control" onClick={() => void runWindowCommand("minimize")} aria-label="最小化" title="最小化">
          <MinimizeIcon />
        </button>
        <button type="button" className="app-window-control" onClick={() => void runWindowCommand("maximize")} aria-label={maximized ? "还原" : "最大化"} title={maximized ? "还原" : "最大化"}>
          <MaximizeIcon maximized={maximized} />
        </button>
        <button type="button" className="app-window-control close" onClick={() => void runWindowCommand("close")} aria-label="关闭" title="关闭">
          <CloseIcon size={14} />
        </button>
      </div>
    </header>
  );
};
