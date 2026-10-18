import React, { useEffect, useRef } from "react";
import { TerminalIcon, DiffIcon, SparklesIcon, FolderIcon } from "./Icons";

export interface AutocompleteItem {
  id: string;
  type: "slash" | "file";
  title: string;
  desc?: string;
  insertText: string;
}

export interface ComposerAutocompleteProps {
  mode: "slash" | "mention";
  query: string;
  files: string[];
  onSelect: (item: AutocompleteItem) => void;
  onClose: () => void;
  selectedIndex: number;
}

const SLASH_COMMANDS: AutocompleteItem[] = [
  {
    id: "review",
    type: "slash",
    title: "/review",
    desc: "审阅 Git 工作区未提交代码与修改建议",
    insertText: "/review 审阅当前 Git 工作区中所有未提交的代码变动，总结修改点并指出潜在缺陷或重构建议。",
  },
  {
    id: "init",
    type: "slash",
    title: "/init",
    desc: "初始化项目架构分析并生成 AGENTS.md 规范",
    insertText: "/init 分析当前项目结构、依赖关系与技术栈，为项目初始化并完善 AGENTS.md 指南。",
  },
  {
    id: "plan",
    type: "slash",
    title: "/plan",
    desc: "制定分步实施方案与技术选型权衡",
    insertText: "/plan 请针对该需求制定详尽的分步实施计划，列出改动文件与回归测试点。",
  },
  {
    id: "compact",
    type: "slash",
    title: "/compact",
    desc: "压缩当前长会话上下文，释放模型窗口",
    insertText: "/compact 请总结当前会话的核心决策与未决事项，压缩上下文历史。",
  },
  {
    id: "test",
    type: "slash",
    title: "/test",
    desc: "扫描近期改动模块并编写完备单元测试",
    insertText: "/test 请为当前改动的核心模块编写自动化单元测试，并运行验证。",
  },
  {
    id: "terminal",
    type: "slash",
    title: "/terminal",
    desc: "打开内置终端进行本地调试",
    insertText: "打开终端",
  },
  {
    id: "diff",
    type: "slash",
    title: "/diff",
    desc: "打开代码变更审阅面板",
    insertText: "查看当前差异",
  },
];

export const ComposerAutocomplete: React.FC<ComposerAutocompleteProps> = ({
  mode,
  query,
  files,
  onSelect,
  onClose,
  selectedIndex,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const items: AutocompleteItem[] = React.useMemo(() => {
    if (mode === "slash") {
      const q = query.toLowerCase().replace(/^\//, "");
      return SLASH_COMMANDS.filter((cmd) => cmd.title.toLowerCase().includes(q) || cmd.desc?.toLowerCase().includes(q));
    } else {
      const q = query.toLowerCase().replace(/^@/, "");
      return files
        .filter((f) => f.toLowerCase().includes(q))
        .slice(0, 15)
        .map((f) => ({
          id: f,
          type: "file" as const,
          title: f.split(/[/\\]/).pop() || f,
          desc: f,
          insertText: `@${f} `,
        }));
    }
  }, [mode, query, files]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div className="composer-autocomplete-overlay" ref={containerRef}>
      {items.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <div
            key={item.id}
            className={`autocomplete-row ${isSelected ? "active" : ""}`}
            onClick={() => onSelect(item)}
          >
            {item.type === "slash" ? (
              <SparklesIcon size={14} />
            ) : (
              <FolderIcon size={14} />
            )}
            <span className="autocomplete-title">{item.title}</span>
            {item.desc && <span className="autocomplete-desc">{item.desc}</span>}
          </div>
        );
      })}
    </div>
  );
};
