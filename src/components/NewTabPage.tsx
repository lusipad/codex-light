import React from "react";
import {
  DiffIcon,
  FolderIcon,
  GlobeIcon,
  MessagePlusIcon,
  TerminalIcon,
} from "./Icons";
import { shortcutById } from "../shortcuts";
import { BrowserToolbar } from "./BrowserToolbar";
import "./NewTabPage.css";

export interface NewTabRecentItem {
  id: string;
  title: string;
  url: string;
}

export interface NewTabPageProps {
  onOpenChanges: () => void;
  onOpenTerminal: () => void;
  onOpenFiles: () => void;
  onOpenSideChat?: () => void;
  onNavigateUrl: (url: string) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
  recentTabs?: NewTabRecentItem[];
  onSelectRecent?: (id: string) => void;
}

export const NewTabPage: React.FC<NewTabPageProps> = ({
  onOpenChanges,
  onOpenTerminal,
  onOpenFiles,
  onOpenSideChat,
  onNavigateUrl,
  onClose,
  onNotify,
  recentTabs = [],
  onSelectRecent,
}) => {
  const tools = [
    {
      title: "变更",
      icon: <DiffIcon size={16} />,
      onClick: onOpenChanges,
      shortcut: shortcutById("open-review-tab")?.keys,
      disabledReason: "",
    },
    {
      title: "终端",
      icon: <TerminalIcon size={16} />,
      onClick: onOpenTerminal,
      shortcut: shortcutById("toggle-terminal")?.keys,
      disabledReason: "",
    },
    {
      title: "文件",
      icon: <FolderIcon size={16} />,
      onClick: onOpenFiles,
      shortcut: shortcutById("file-search")?.keys,
      disabledReason: "",
    },
    {
      title: "侧边聊天",
      icon: <MessagePlusIcon size={16} />,
      onClick: onOpenSideChat,
      shortcut: onOpenSideChat ? shortcutById("open-side-chat")?.keys : undefined,
      disabledReason: onOpenSideChat ? "" : "独立侧边聊天将在后续阶段提供",
    },
  ];

  return (
    <div className="new-tab-page-container">
      <BrowserToolbar
        canGoBack={false}
        canGoForward={false}
        onBack={() => {}}
        onForward={() => {}}
        onNavigate={onNavigateUrl}
        onClose={onClose}
        onNotify={onNotify}
      />

      <div className="new-tab-body">
        <section className="new-tab-section" aria-labelledby="new-tab-tools-heading">
          <h2 id="new-tab-tools-heading" className="new-tab-section-heading">工具</h2>
          <div className="tools-card-grid">
            {tools.map((tool) => (
              <button
                key={tool.title}
                type="button"
                className="tool-card clickable"
                onClick={tool.onClick}
                disabled={!tool.onClick}
                title={tool.disabledReason || tool.title}
                aria-label={tool.disabledReason ? `${tool.title}：${tool.disabledReason}` : tool.title}
              >
                <span className="tool-card-left">
                  <span className="tool-card-icon" aria-hidden="true">{tool.icon}</span>
                  <span className="tool-card-title">{tool.title}</span>
                </span>
                {tool.shortcut && (
                  <span className="tool-card-right">
                    <kbd className="key-shortcut-badge">{tool.shortcut}</kbd>
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        {recentTabs.length > 0 && (
          <section className="new-tab-section" aria-labelledby="new-tab-recent-heading">
            <h2 id="new-tab-recent-heading" className="new-tab-section-heading">最近</h2>
            <div className="tools-card-grid">
              {recentTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="tool-card clickable"
                  onClick={() => onSelectRecent?.(tab.id)}
                  title={tab.url}
                >
                  <span className="tool-card-left">
                    <span className="tool-card-icon" aria-hidden="true"><GlobeIcon size={16} /></span>
                    <span className="tool-card-title">{tab.title}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
