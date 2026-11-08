import React, { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DiffIcon,
  FileCodeIcon,
  RefreshIcon,
} from "./Icons";
import "./TurnDiffPanel.css";

export interface TurnDiffFile {
  path: string;
  kind: string;
  diff: string;
  additions?: number;
  deletions?: number;
}

export interface TurnDiffPanelProps {
  files: TurnDiffFile[];
  loading?: boolean;
  emptyText?: string;
  onOpenFile?: (path: string) => void;
  onRefresh?: () => void;
}

type DiffLineType = "add" | "del" | "hunk" | "meta" | "ctx";
type DiffKind = "add" | "delete" | "update" | "other";

interface ParsedDiffLine {
  type: DiffLineType;
  text: string;
}

interface ParsedTurnDiffFile {
  file: TurnDiffFile;
  lines: ParsedDiffLine[];
  additions: number;
  deletions: number;
}

const KIND_LABELS: Record<DiffKind, string> = {
  add: "新增",
  delete: "删除",
  update: "更新",
  other: "变更",
};

const META_PREFIXES = [
  "diff --git ",
  "index ",
  "--- ",
  "+++ ",
  "new file mode",
  "deleted file mode",
  "similarity index",
  "rename from",
  "rename to",
  "old mode",
  "new mode",
  "\\ No newline",
];

function normalizeKind(kind: string): DiffKind {
  const value = (kind || "").trim().toLowerCase();
  if (!value) return "other";
  if (
    value === "a" ||
    value === "add" ||
    value === "added" ||
    value === "create" ||
    value === "created" ||
    value === "new" ||
    value === "untracked"
  ) {
    return "add";
  }
  if (
    value === "d" ||
    value === "delete" ||
    value === "deleted" ||
    value === "remove" ||
    value === "removed"
  ) {
    return "delete";
  }
  if (
    value === "m" ||
    value === "modify" ||
    value === "modified" ||
    value === "update" ||
    value === "updated" ||
    value === "change" ||
    value === "changed" ||
    value === "edit" ||
    value === "edited" ||
    value === "rename" ||
    value === "renamed"
  ) {
    return "update";
  }
  return "other";
}

/** Parse a unified diff snippet into styled, render-ready lines. */
export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  if (!diff || !diff.trim()) return [];
  const rawLines = diff.split("\n");
  // Trailing newline in a git patch produces one empty tail entry; drop it.
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  let inHunk = false;
  return rawLines.map((raw) => {
    if (raw.startsWith("diff --git ")) inHunk = false;
    if (raw.startsWith("@@")) { inHunk = true; return { type: "hunk", text: raw }; }
    if (raw.startsWith("\\ No newline") || (!inHunk && META_PREFIXES.some((prefix) => raw.startsWith(prefix)))) {
      return { type: "meta", text: raw };
    }
    if (raw.startsWith("+")) return { type: "add", text: raw };
    if (raw.startsWith("-")) return { type: "del", text: raw };
    return { type: "ctx", text: raw };
  });
}

function countDiffLines(lines: ParsedDiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === "add") additions += 1;
    else if (line.type === "del") deletions += 1;
  }
  return { additions, deletions };
}

export const TurnDiffPanel: React.FC<TurnDiffPanelProps> = ({
  files,
  loading = false,
  emptyText,
  onOpenFile,
  onRefresh,
}) => {
  const [collapsedIndexes, setCollapsedIndexes] = useState<number[]>([]);

  const parsedFiles = useMemo<ParsedTurnDiffFile[]>(() => {
    return (files || []).map((file) => {
      const lines = parseUnifiedDiff(typeof file.diff === "string" ? file.diff : "");
      const counts = countDiffLines(lines);
      return {
        file,
        lines,
        additions: typeof file.additions === "number" ? file.additions : counts.additions,
        deletions: typeof file.deletions === "number" ? file.deletions : counts.deletions,
      };
    });
  }, [files]);

  const toggleFile = (index: number) => {
    setCollapsedIndexes((prev) =>
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
    );
  };

  const isEmpty = parsedFiles.length === 0;
  const emptyMessage = loading ? "正在加载变更…" : emptyText || "本轮暂无文件变更";

  return (
    <section className="turn-diff-panel" aria-label="本轮变更">
      <div className="turn-diff-header">
        <span className="turn-diff-header-icon" aria-hidden="true">
          <DiffIcon size={15} />
        </span>
        <span className="turn-diff-title">本轮变更</span>
        <span
          className="turn-diff-count"
          title={isEmpty ? "本轮暂无文件变更" : `本轮共 ${parsedFiles.length} 个文件变更`}
        >
          {parsedFiles.length}
        </span>
        {loading && !isEmpty && <span className="turn-diff-loading">刷新中…</span>}
        <button
          type="button"
          className={`turn-diff-refresh${loading ? " is-loading" : ""}`}
          onClick={onRefresh}
          disabled={loading || !onRefresh}
          title={loading ? "正在刷新变更" : onRefresh ? "刷新变更" : "暂无可刷新的变更"}
          aria-label="刷新变更"
        >
          <RefreshIcon size={14} />
        </button>
      </div>

      {isEmpty ? (
        <div className={`turn-diff-empty${loading ? " is-loading" : ""}`}>{emptyMessage}</div>
      ) : (
        <div className="turn-diff-files">
          {parsedFiles.map((entry, index) => {
            const collapsed = collapsedIndexes.includes(index);
            const diffKind = normalizeKind(entry.file.kind);
            const kindLabel =
              diffKind === "other"
                ? entry.file.kind || KIND_LABELS.other
                : KIND_LABELS[diffKind];
            return (
              <div
                className={`turn-diff-file${collapsed ? " is-collapsed" : ""}`}
                key={`${index}:${entry.file.path}`}
              >
                <div className="turn-diff-file-head">
                  <button
                    type="button"
                    className="turn-diff-file-toggle"
                    aria-expanded={!collapsed}
                    onClick={() => toggleFile(index)}
                    title={collapsed ? "展开该文件 diff" : "折叠该文件 diff"}
                  >
                    {collapsed ? (
                      <ChevronRightIcon size={13} />
                    ) : (
                      <ChevronDownIcon size={13} />
                    )}
                    <span className="turn-diff-file-path" title={entry.file.path}>
                      {entry.file.path}
                    </span>
                  </button>
                  <span className={`turn-diff-kind turn-diff-kind--${diffKind}`}>
                    {kindLabel}
                  </span>
                  <span
                    className="turn-diff-stats"
                    aria-label={`新增 ${entry.additions} 行，删除 ${entry.deletions} 行`}
                  >
                    <span className="turn-diff-additions">+{entry.additions}</span>
                    <span className="turn-diff-deletions">-{entry.deletions}</span>
                  </span>
                  {onOpenFile && (
                    <button
                      type="button"
                      className="turn-diff-open-file"
                      onClick={() => onOpenFile(entry.file.path)}
                      title={`打开 ${entry.file.path}`}
                      aria-label={`打开文件 ${entry.file.path}`}
                    >
                      <FileCodeIcon size={13} />
                    </button>
                  )}
                </div>

                {!collapsed && (
                  <div className="turn-diff-code">
                    {entry.lines.length === 0 ? (
                      <div className="turn-diff-file-empty">该文件暂无 diff 内容</div>
                    ) : (
                      entry.lines.map((line, lineIndex) => (
                        <div
                          key={lineIndex}
                          className={`turn-diff-line turn-diff-line--${line.type}`}
                        >
                          {line.text.length > 0 ? line.text : "\u00A0"}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
