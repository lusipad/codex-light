import React, { useEffect, useRef } from "react";
import {
  SparklesIcon,
  LaptopIcon,
  FileCodeIcon,
  SkillIcon,
} from "./Icons";
import { SkillInfoItem, WorkspaceFileHit } from "../types";
import { findSlashCommands, type SlashCommand } from "../slashCommands";

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

/**
 * 斜杠命令下拉项统一来自 `../slashCommands` 注册表（官方 §5.3 清单）。
 * 映射规则保持与旧硬编码数组完全一致：
 * - `title`      = 命令字面量（如 "/review"）
 * - `subtitle`   = 注册表 description
 * - `insertText` = 注册表 insertText（action 类命令缺省为 ""）
 * - `action`     = 注册表 action（如 open_goal_dialog / toggle_plan 等保持不变）
 */
function toSlashAutocompleteItem(cmd: SlashCommand): AutocompleteItem {
  return {
    id: cmd.id,
    type: "slash",
    title: cmd.command,
    subtitle: cmd.description,
    insertText: cmd.insertText ?? "",
    action: cmd.action,
  };
}

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
      return findSlashCommands(query).map(toSlashAutocompleteItem);
    } else {
      const q = query.toLowerCase().replace(/^@/, "");
      const out: AutocompleteItem[] = [];

      // 1. Workspace files from recursive search hits (or fallback top-level files)
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
