import React, { useMemo, useState } from "react";
import { baseNameFsPath, joinFsPath } from "../fsClient";
import type { TurnItem } from "../types";
import { ChevronDownIcon, ChevronRightIcon, DiffIcon } from "./Icons";
import { parseUnifiedDiff } from "./TurnDiffPanel";

const MAX_PREVIEW_CHARS = 1_048_576;
const MAX_PREVIEW_ROWS = 5000;
const LABELS = {
  add: ["正在创建", "已创建", "已停止创建"],
  delete: ["正在删除", "已删除", "已停止删除"],
  update: ["正在编辑", "已编辑", "已停止编辑"],
} as const;

type Change = { path: string; kind?: { type?: string; move_path?: string } | string; diff?: string };

function PatchFile({ change, status, turnStatus, cwd, onOpenFile }: {
  change: Change; status?: string; turnStatus?: string; cwd?: string; onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const kind = typeof change.kind === "string" ? change.kind : change.kind?.type;
  const labels = kind === "add" ? LABELS.add : kind === "delete" ? LABELS.delete : LABELS.update;
  const stopped = status === "inProgress" && turnStatus === "interrupted";
  const label = status === "failed" || status === "declined" ? "已拒绝"
    : stopped ? labels[2] : status === "inProgress" ? labels[0] : status === "completed" ? labels[1] : "文件变更";
  const diff = typeof change.diff === "string" ? change.diff : "";
  const tooLarge = diff.length > MAX_PREVIEW_CHARS;
  const lines = useMemo(() => {
    if (tooLarge || !diff) return [];
    if (kind !== "add" && kind !== "delete") return parseUnifiedDiff(diff);
    const sign = kind === "add" ? "+" : "-";
    return diff.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n")
      .map(text => ({ type: kind === "add" ? "add" : "del", text: sign + text }));
  }, [diff, kind, tooLarge]);
  const additions = lines.filter(line => line.type === "add").length;
  const deletions = lines.filter(line => line.type === "del").length;
  const movePath = typeof change.kind === "object" ? change.kind?.move_path : undefined;
  const path = status === "completed" && movePath ? movePath : change.path;
  const name = baseNameFsPath(path) || path;
  const absolute = /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path) ? path : cwd ? joinFsPath(cwd, path) : null;

  return <section className="file-change-card">
    <div className="file-change-summary">
      <DiffIcon size={15} />
      <span>{label}</span>
      {absolute ? <button type="button" className="file-change-name" title={path} onClick={() => onOpenFile(absolute)}>{name}</button>
        : <span className="file-change-name" title={path}>{name}</span>}
      {(additions > 0 || deletions > 0) && <span className="diff-stats-badge">
        {additions > 0 && <span className="diff-plus">+{additions}</span>}{" "}
        {deletions > 0 && <span className="diff-minus">−{deletions}</span>}
      </span>}
      <button type="button" className="file-change-toggle" aria-label={`切换 ${name} 的差异视图`} aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}</button>
    </div>
    {expanded && <div className="turn-diff-code">
      {tooLarge || lines.length > MAX_PREVIEW_ROWS ? <div className="turn-diff-file-empty">差异内容过多，无法预览</div>
        : lines.length ? lines.map((line, index) => <div key={index} className={`turn-diff-line turn-diff-line--${line.type}`}>{line.text || "\u00a0"}</div>)
        : <div className="turn-diff-file-empty">{kind === "delete" ? "内容已删除" : "无更改"}</div>}
    </div>}
  </section>;
}

export function FileChangeCard({ item, cwd, turnStatus, onOpenFile }: {
  item: TurnItem; cwd?: string; turnStatus?: string; onOpenFile: (path: string) => void;
}) {
  const changes: Change[] = Array.isArray(item.changes) && item.changes.length ? item.changes
    : typeof item.path === "string" ? [{ path: item.path, kind: item.kind, diff: item.diff }] : [];
  return <>{changes.filter(change => typeof change?.path === "string" && change.path.trim()).map((change, index) =>
    <PatchFile key={`${change.path}:${index}`} change={change} status={item.status} turnStatus={turnStatus} cwd={cwd} onOpenFile={onOpenFile} />)}</>;
}
