import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Command,
  FileText,
  Folder,
  MessageSquare,
  Play,
  Search,
  Settings,
  X,
} from "lucide-react";
import { MainViewRoute, SettingsSectionSlug, SkillInfoItem, ThreadSummary, WorkspaceFileHit } from "../types";

export interface QuickSearchModalProps {
  open: boolean;
  threads: ThreadSummary[];
  workspaceFileHits: WorkspaceFileHit[];
  skills: SkillInfoItem[];
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
  onSelectFile: (filePath: string) => void;
  onSelectSkill: (skillId: string) => void;
  onNavigateSettings: (slug: SettingsSectionSlug) => void;
  onNavigateRoute: (route: MainViewRoute) => void;
  onStartNewChat: () => void;
  onTriggerCommand: (cmd: string) => void;
}

interface SearchResultItem {
  id: string;
  category: "action" | "thread" | "file" | "skill" | "setting";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  open,
  threads,
  workspaceFileHits,
  skills,
  onClose,
  onSelectThread,
  onSelectFile,
  onSelectSkill,
  onNavigateSettings,
  onNavigateRoute,
  onStartNewChat,
  onTriggerCommand,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const results: SearchResultItem[] = [];

    // Quick Actions
    const defaultActions: SearchResultItem[] = [
      {
        id: "act-new-chat",
        category: "action",
        title: "新建聊天会话",
        subtitle: "创建新的空白对话流 (Ctrl+N)",
        icon: <MessageSquare size={14} />,
        onSelect: () => {
          onStartNewChat();
          onClose();
        },
      },
      {
        id: "act-run-dev",
        category: "action",
        title: "运行本地启动服务 (npm run dev)",
        subtitle: "在集成终端中执行开发服务器",
        icon: <Play size={14} />,
        onSelect: () => {
          onTriggerCommand("npm run dev");
          onClose();
        },
      },
      {
        id: "act-run-test",
        category: "action",
        title: "运行单元测试 (npm test)",
        subtitle: "在集成终端中运行测试套件",
        icon: <Command size={14} />,
        onSelect: () => {
          onTriggerCommand("npm test");
          onClose();
        },
      },
      {
        id: "act-projects",
        category: "action",
        title: "打开项目中心",
        subtitle: "管理已注册的本地工作区目录",
        icon: <Folder size={14} />,
        onSelect: () => {
          onNavigateRoute("projects");
          onClose();
        },
      },
      {
        id: "act-settings",
        category: "action",
        title: "打开设置中心",
        subtitle: "常规、外观、模型与提供商设置 (Ctrl+,)",
        icon: <Settings size={14} />,
        onSelect: () => {
          onNavigateRoute("settings");
          onClose();
        },
      },
    ];

    results.push(
      ...defaultActions.filter(
        (a) =>
          !q ||
          a.title.toLowerCase().includes(q) ||
          a.subtitle?.toLowerCase().includes(q)
      )
    );

    // Threads
    threads
      .filter((t) => {
        if (!q) return false;
        return (
          t.name?.toLowerCase().includes(q) ||
          t.preview?.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 5)
      .forEach((t) => {
        results.push({
          id: `th-${t.id}`,
          category: "thread",
          title: t.name || t.preview || t.id,
          subtitle: `历史会话 · ${t.cwd || ""}`,
          icon: <MessageSquare size={14} />,
          onSelect: () => {
            onSelectThread(t.id);
            onClose();
          },
        });
      });

    // Workspace Files
    workspaceFileHits
      .filter((f) => {
        if (!q) return false;
        return (
          f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q)
        );
      })
      .slice(0, 6)
      .forEach((f) => {
        results.push({
          id: `file-${f.absPath}`,
          category: "file",
          title: f.name,
          subtitle: f.relPath,
          icon: <FileText size={14} />,
          onSelect: () => {
            onSelectFile(f.absPath);
            onClose();
          },
        });
      });

    // Skills
    skills
      .filter((s) => {
        if (!q) return false;
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 4)
      .forEach((s) => {
        results.push({
          id: `sk-${s.id}`,
          category: "skill",
          title: `$${s.id} (${s.name})`,
          subtitle: s.description,
          icon: <BookOpen size={14} />,
          onSelect: () => {
            onSelectSkill(s.id);
            onClose();
          },
        });
      });

    // Settings sections
    const settingsSections: Array<{
      slug: SettingsSectionSlug;
      title: string;
      subtitle: string;
      keywords: string;
    }> = [
      {
        slug: "agent",
        title: "智能体与模型参数设置 (Agent & Hyperparameters)",
        subtitle: "调节 Temperature, Top-P, Tokens 上限, WebSearch 与沙盒",
        keywords: "参数 超参数 agent model temperature top_p tokens reasoning approval sandbox",
      },
      {
        slug: "providers-models",
        title: "提供商与模型目录 (Providers & Models)",
        subtitle: "配置自定义 API Base URL, Key 与 Wire API",
        keywords: "模型 提供商 provider model catalog toml base_url",
      },
      {
        slug: "appearance",
        title: "外观与色彩主题 (Appearance & Themes)",
        subtitle: "切换 25+ 官方色彩主题与界面字号",
        keywords: "外观 主题 theme appearance font color",
      },
      {
        slug: "local-environments",
        title: "本地运行环境配置 (.codex/environments)",
        subtitle: "编辑测试与构建环境 default.toml",
        keywords: "环境 local environment default.toml",
      },
      {
        slug: "keyboard-shortcuts",
        title: "键盘快捷键一览 (Keyboard Shortcuts)",
        subtitle: "查看与设置 Ctrl+N, Ctrl+B, Ctrl+J, Ctrl+K 等快捷键",
        keywords: "快捷键 shortcuts hotkeys keybindings",
      },
    ];

    settingsSections
      .filter((s) => {
        if (!q) return false;
        return (
          s.title.toLowerCase().includes(q) ||
          s.subtitle.toLowerCase().includes(q) ||
          s.keywords.toLowerCase().includes(q)
        );
      })
      .forEach((s) => {
        results.push({
          id: `set-${s.slug}`,
          category: "setting",
          title: s.title,
          subtitle: s.subtitle,
          icon: <Settings size={14} />,
          onSelect: () => {
            onNavigateSettings(s.slug);
            onClose();
          },
        });
      });

    return results;
  }, [
    query,
    threads,
    workspaceFileHits,
    skills,
    onStartNewChat,
    onTriggerCommand,
    onNavigateRoute,
    onSelectThread,
    onSelectFile,
    onSelectSkill,
    onClose,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(
        (idx) => (idx - 1 + items.length) % Math.max(1, items.length)
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="quick-search-backdrop" onClick={onClose}>
      <div
        className="quick-search-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-search-input-wrap">
          <Search size={16} className="quick-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-search-input"
            placeholder="搜索会话、文件、技能、设置或执行快捷命令..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="quick-search-results">
          {items.length === 0 ? (
            <div className="empty-hint-small" style={{ padding: "20px 0" }}>
              未找到匹配项
            </div>
          ) : (
            items.map((item, index) => (
              <div
                key={item.id}
                className={`quick-search-row ${
                  index === selectedIndex ? "active" : ""
                }`}
                onClick={item.onSelect}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="quick-search-row-icon">{item.icon}</div>
                <div className="quick-search-row-content">
                  <span className="quick-search-row-title">{item.title}</span>
                  {item.subtitle && (
                    <span className="quick-search-row-subtitle">
                      {item.subtitle}
                    </span>
                  )}
                </div>
                <span className="tag-badge" style={{ fontSize: 10.5 }}>
                  {item.category}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="quick-search-footer">
          <span>↑↓ 导航</span>
          <span>↵ 确认</span>
          <span>Esc 退出</span>
        </div>
      </div>
    </div>
  );
};
