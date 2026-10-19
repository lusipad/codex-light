import React, { useEffect, useRef } from "react";
import {
  SparklesIcon,
  LaptopIcon,
  FileCodeIcon,
  SkillIcon,
} from "./Icons";
import { SkillInfoItem, WorkspaceFileHit } from "../types";

export interface AutocompleteItem {
  id: string;
  type: "slash" | "file" | "computer" | "skill";
  title: string;
  subtitle?: string;
  insertText: string;
  action?: string;
}

export interface ComposerAutocompleteProps {
  mode: "slash" | "mention";
  query: string;
  files: string[];
  fileHits?: WorkspaceFileHit[];
  skills?: SkillInfoItem[];
  onSelect: (item: AutocompleteItem) => void;
  onClose: () => void;
  selectedIndex: number;
}

const SLASH_COMMANDS: AutocompleteItem[] = [
  {
    id: "goal",
    type: "slash",
    title: "/goal",
    subtitle: "🎯 开启自主目标模式，多轮自动推进执行与测试验证直至目标达成",
    insertText: "",
    action: "open_goal_dialog",
  },
  {
    id: "review",
    type: "slash",
    title: "/review",
    subtitle: "审阅当前 Git 工作区或分支代码改动",
    insertText: "/review 请审阅当前 Git 工作区中所有未提交的代码变动，总结修改点并指出潜在缺陷或重构建议。",
  },
  {
    id: "plan",
    type: "slash",
    title: "/plan",
    subtitle: "开启计划模式，先制定分步实施方案再执行",
    insertText: "/plan 请针对以下需求先制定详尽的分步实施计划，待我确认后再执行：",
    action: "toggle_plan",
  },
  {
    id: "fast",
    type: "slash",
    title: "/fast",
    subtitle: "切换 Fast 2x 极速推理档位",
    insertText: "",
    action: "toggle_fast",
  },
  {
    id: "init",
    type: "slash",
    title: "/init",
    subtitle: "分析项目架构并生成 AGENTS.md 规范",
    insertText: "/init 分析当前项目结构、依赖关系与技术栈，为项目初始化并完善 AGENTS.md 指南。",
  },
  {
    id: "compact",
    type: "slash",
    title: "/compact",
    subtitle: "压缩当前长会话上下文，释放模型窗口",
    insertText: "/compact 请总结当前会话的核心决策与未决事项，压缩上下文历史。",
  },
  {
    id: "worktree",
    type: "slash",
    title: "/worktree",
    subtitle: "切换到独立 Git Worktree 隔离环境运行",
    insertText: "",
    action: "toggle_worktree",
  },
  {
    id: "test",
    type: "slash",
    title: "/test",
    subtitle: "扫描近期改动模块并编写完备单元测试",
    insertText: "/test 请为当前改动的核心模块编写自动化单元测试，并运行验证。",
  },
  {
    id: "terminal",
    type: "slash",
    title: "/terminal",
    subtitle: "打开底部内置交互式终端面板",
    insertText: "",
    action: "open_terminal",
  },
  {
    id: "diff",
    type: "slash",
    title: "/diff",
    subtitle: "打开右侧代码变更审阅工作台",
    insertText: "",
    action: "open_diff",
  },
];

export const ComposerAutocomplete: React.FC<ComposerAutocompleteProps> = ({
  mode,
  query,
  files,
  fileHits = [],
  skills = [],
  onSelect,
  onClose,
  selectedIndex,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const items: AutocompleteItem[] = React.useMemo(() => {
    if (mode === "slash") {
      const q = query.toLowerCase().replace(/^\//, "");
      return SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(q) ||
          cmd.subtitle?.toLowerCase().includes(q)
      );
    } else {
      const q = query.toLowerCase().replace(/^@/, "");
      const out: AutocompleteItem[] = [];

      // 1. Official "@电脑 Control Windows apps" entry at top (matches 2-mention-menu.png)
      if (
        !q ||
        "电脑".includes(q) ||
        "computer".includes(q) ||
        "windows".includes(q)
      ) {
        out.push({
          id: "__computer_use__",
          type: "computer",
          title: "电脑",
          subtitle: "Control Windows apps",
          insertText: "@电脑 ",
        });
      }

      // 2. Workspace files from recursive search hits (or fallback top-level files)
      if (fileHits.length > 0) {
        const matchedHits = fileHits
          .filter(
            (h) =>
              !q ||
              h.name.toLowerCase().includes(q) ||
              h.relPath.toLowerCase().includes(q)
          )
          .slice(0, 14);
        for (const h of matchedHits) {
          out.push({
            id: `file:${h.relPath}`,
            type: "file",
            title: h.name,
            subtitle: h.relDir || "",
            insertText: `@${h.relPath} `,
          });
        }
      } else {
        const matchedFiles = files
          .filter((f) => !q || f.toLowerCase().includes(q))
          .slice(0, 12);
        for (const f of matchedFiles) {
          const parts = f.replace(/\\/g, "/").split("/");
          const name = parts.pop() || f;
          const dir = parts.join("/");
          out.push({
            id: `file:${f}`,
            type: "file",
            title: name,
            subtitle: dir,
            insertText: `@${f} `,
          });
        }
      }

      // 3. Installed Skills
      const matchedSkills = skills
        .filter(
          (s) =>
            s.installed &&
            (!q ||
              s.id.toLowerCase().includes(q) ||
              s.name.toLowerCase().includes(q))
        )
        .slice(0, 5);
      for (const s of matchedSkills) {
        out.push({
          id: `skill:${s.id}`,
          type: "skill",
          title: `$${s.id}`,
          subtitle: s.description,
          insertText: `$${s.id} `,
        });
      }

      return out;
    }
  }, [mode, query, files, fileHits, skills]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  if (items.length === 0) return null;

  const safeIndex = Math.min(Math.max(0, selectedIndex), items.length - 1);

  return (
    <div className="composer-autocomplete-overlay" ref={containerRef}>
      {items.map((item, idx) => {
        const isSelected = idx === safeIndex;
        return (
          <div
            key={item.id}
            className={`autocomplete-row ${isSelected ? "active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
          >
            <span className="autocomplete-row-icon">
              {item.type === "computer" ? (
                <LaptopIcon size={14} />
              ) : item.type === "slash" ? (
                <SparklesIcon size={14} />
              ) : item.type === "skill" ? (
                <SkillIcon size={14} />
              ) : (
                <FileCodeIcon size={14} />
              )}
            </span>
            <span className="autocomplete-title">{item.title}</span>
            {item.subtitle && (
              <span className="autocomplete-desc">{item.subtitle}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
