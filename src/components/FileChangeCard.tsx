import React, { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { copyTextToClipboard } from "../clipboard";
import { baseNameFsPath, joinFsPath } from "../fsClient";
import type { PendingServerRequest, TurnItem } from "../types";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, DiffIcon } from "./Icons";
import { parseUnifiedDiff } from "./TurnDiffPanel";

const MAX_PREVIEW_CHARS = 1_048_576;
const MAX_PREVIEW_ROWS = 5000;
const LABELS = {
  add: ["正在创建", "已创建", "已停止创建", "文件已创建"],
  delete: ["正在删除", "已删除", "已停止删除", "文件已删除"],
  update: ["正在编辑", "已编辑", "已停止编辑", "已编辑的文件"],
} as const;

type Change = { path: string; kind?: { type?: string; move_path?: string } | string; diff?: string };

function patchOpenLine(lines: ReturnType<typeof parseUnifiedDiff>): number {
  let oldStart = 1, newStart = 1, firstDeletion: number | undefined;
  for (const line of lines) {
    if (line.type === "hunk") {
      const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line.text);
      oldStart = Number(header?.[1]) || 1;
      newStart = Number(header?.[2]) || 1;
    } else if (line.type === "add") return newStart;
    else if (line.type === "del") firstDeletion ??= oldStart;
  }
  return firstDeletion ?? 1;
}

function PatchFile({ change, status, turnStatus, cwd, pending, autoReviewDenial, onOpenFile }: {
  change: Change; status?: string; turnStatus?: string; cwd?: string; pending: boolean; onOpenFile: (path: string, line?: number) => void;
  autoReviewDenial?: TurnItem;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const kind = typeof change.kind === "string" ? change.kind : change.kind?.type;
  const labels = kind === "add" ? LABELS.add : kind === "delete" ? LABELS.delete : LABELS.update;
  const stopped = status === "inProgress" && turnStatus === "interrupted";
  const label = status === "failed" || status === "declined" ? "已拒绝"
    : stopped ? labels[2] : status === "inProgress" ? labels[0] : status === "completed" ? labels[1] : "文件变更";
  const diff = typeof change.diff === "string" ? change.diff : "";
  const tooLarge = diff.length > MAX_PREVIEW_CHARS;
  const lines = useMemo<ReturnType<typeof parseUnifiedDiff>>(() => {
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
  const previewable = !tooLarge && lines.length > 0 && lines.length <= MAX_PREVIEW_ROWS;
  const showFileHeader = expanded && previewable;
  const fileName = absolute ? <button type="button" className="file-change-name" title={path} onClick={() => onOpenFile(absolute, tooLarge ? undefined : patchOpenLine(lines))}>{name}</button>
    : <span className="file-change-name" title={path}>{name}</span>;
  const stats = (additions > 0 || deletions > 0) && <span className="diff-stats-badge">
    {additions > 0 && <span className="diff-plus">+{additions}</span>}{" "}
    {deletions > 0 && <span className="diff-minus">−{deletions}</span>}
  </span>;

  async function copyPatch() {
    const oldPath = change.path;
    const newPath = movePath ?? oldPath;
    const gitHeader = `diff --git a/${oldPath} b/${newPath}\n`;
    let patch: string;
    if (kind === "add" || kind === "delete") {
      const header = kind === "add"
        ? `new file mode 100644\n--- /dev/null\n+++ b/${newPath}\n@@ -0,0 +1,${additions} @@\n`
        : `deleted file mode 100644\n--- a/${oldPath}\n+++ /dev/null\n@@ -1,${deletions} +0,0 @@\n`;
      patch = gitHeader + header + lines.map(line => line.text).join("\n") + "\n";
    } else {
      const body = diff.trimStart();
      const fileHeader = /^---\s/m.test(body) ? "" : `--- a/${oldPath}\n+++ b/${newPath}\n`;
      patch = /^diff --git /m.test(body) ? body : gitHeader + fileHeader + body;
    }
    setCopyStatus(await copyTextToClipboard(patch) ? "已复制" : "无法复制差异");
  }

  return <section className={pending ? "file-change-card file-change-card--pending" : "file-change-card"}>
    <div className="file-change-summary">
      {autoReviewDenial ? <TriangleAlert size={15} aria-hidden="true" className="file-change-warning" /> : <DiffIcon size={15} />}
      {autoReviewDenial ? <span>自动审核拒绝了文件更改：</span>
        : !pending && <span>{showFileHeader && status === "completed" ? labels[3] : label}</span>}
      {(!showFileHeader || pending || autoReviewDenial) && <>{fileName}{stats}</>}
      <button type="button" className="file-change-toggle" aria-label={`切换 ${name} 的差异视图`} aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value); setCopyStatus(""); }}>{expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}</button>
    </div>
    {expanded && autoReviewDenial?.rationale && <div className="file-change-review-reason">{autoReviewDenial.rationale}</div>}
    {showFileHeader && <div className="file-change-diff-header">
      {fileName}{stats}
      <span className="file-change-copy-status" role="status">{copyStatus}</span>
      <button type="button" className="file-change-copy" aria-label="复制差异" title="复制差异" onClick={copyPatch}><CopyIcon size={13} /></button>
    </div>}
    {expanded && <div className="turn-diff-code">
      {tooLarge || lines.length > MAX_PREVIEW_ROWS ? <div className="turn-diff-file-empty">差异内容过多，无法预览</div>
        : lines.length ? lines.map((line, index) => <div key={index} className={`turn-diff-line turn-diff-line--${line.type}`}>{line.text || "\u00a0"}</div>)
        : <div className="turn-diff-file-empty">{kind === "delete" ? "内容已删除" : "无更改"}</div>}
    </div>}
  </section>;
}

export function FileChangeCard({ item, cwd, turnStatus, approval, autoReviewDenial, onOpenFile }: {
  item: TurnItem; cwd?: string; turnStatus?: string; approval?: PendingServerRequest; onOpenFile: (path: string, line?: number) => void;
  autoReviewDenial?: TurnItem;
}) {
  const changes: Change[] = Array.isArray(item.changes) && item.changes.length ? item.changes
    : typeof item.path === "string" ? [{ path: item.path, kind: item.kind, diff: item.diff }] : [];
  const grantRoot = approval?.params?.grantRoot;
  const root = typeof grantRoot === "string" && grantRoot ? grantRoot : cwd;
  return <>{changes.filter(change => typeof change?.path === "string" && change.path.trim()).map((change, index) =>
    <PatchFile key={`${change.path}:${index}`} change={change} status={item.status} turnStatus={turnStatus}
      cwd={root} pending={approval !== undefined && !autoReviewDenial} autoReviewDenial={autoReviewDenial} onOpenFile={onOpenFile} />)}</>;
}
