import React, { useId, useState } from "react";
import type { TurnItem } from "../types";
import { CheckIcon, ChevronDownIcon, TerminalIcon } from "./Icons";
import "./CommandExecutionCard.css";

export const CommandExecutionCard: React.FC<{ item: TurnItem; turnStatus?: string; onOpenFile?: (path: string) => void }> = ({ item, turnStatus, onOpenFile }) => {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const interrupted = item.status === "interrupted" ||
    (item.status === "inProgress" && turnStatus === "interrupted");
  const running = !interrupted && (item.status === "inProgress" || item.status === "running");
  const command = Array.isArray(item.command) ? item.command.join(" ") : item.command || "command";
  const output = item.aggregatedOutput ?? item.output ?? "";
  let summary = interrupted ? "已停止命令" : running ? "正在运行命令" : "已运行命令";
  let detail = command;
  const action = Array.isArray(item.commandActions) && item.commandActions.length === 1
    ? item.commandActions[0] : null;
  if (!interrupted && item.status !== "declined" && action) {
    if (action.type === "read" && !running && action.name) {
      summary = "已读取";
      detail = action.name;
    } else if (action.type === "search") {
      if (action.query && action.path) {
        summary = running ? "正在" : "已在";
        detail = `${action.path} 中搜索“${action.query}”`;
      } else if (action.query) {
        summary = running ? "正在搜索" : "已对";
        detail = running ? `“${action.query}”` : `“${action.query}”进行搜索`;
      } else {
        summary = running ? "正在搜索" : "已搜索";
        detail = "文件";
      }
    } else if (action.type === "listFiles") {
      summary = running ? "正在列出" : action.path ? "已列出" : "已列出的";
      detail = action.path ? `${action.path} 中的文件` : "文件";
    }
  }
  const result = interrupted ? "已停止" : item.exitCode === 0 ? "成功" : `退出码 ${item.exitCode ?? "未知"}`;
  const activity = !interrupted && item.status !== "declined" && action &&
    (action.type === "search" || action.type === "listFiles" || (action.type === "read" && !running && !!action.name));
  const filePath = activity && action?.type === "read" && action.path?.trim() ? action.path : null;

  return (
    <div id={item.id ? `command-${item.id}` : undefined} className={`command-exec-card${activity ? " command-activity-row" : ""}`} data-execution-status={interrupted ? "interrupted" : item.status}>
      {activity ? <div className="command-activity-header">
        <span className="command-activity-label">
          <span className="command-exec-summary">{summary}</span>{" "}
          {filePath && onOpenFile ? <button type="button" className="command-activity-file command-exec-title" title={filePath}
            data-agent-activity-file-link onClick={() => onOpenFile(filePath)}>{detail}</button>
            : <span className="command-exec-title" title={detail}>{detail}</span>}
        </span>
        <button type="button" className="command-activity-disclosure" aria-label={expanded ? "收起命令详情" : "展开命令详情"}
          aria-expanded={expanded} aria-controls={bodyId} data-command-expand onClick={() => setExpanded(value => !value)}>
          <ChevronDownIcon size={12} className={expanded ? "expanded" : ""} />
        </button>
      </div> :
      <button
        type="button"
        className="command-exec-header"
        aria-expanded={expanded}
        aria-controls={bodyId}
        data-command-expand
        onClick={() => setExpanded(value => !value)}
      >
        <TerminalIcon size={13} />
        <span className="command-exec-summary">{summary}</span>
        {!expanded && <span className="command-exec-title" title={command}>{detail}</span>}
        <ChevronDownIcon size={12} className={expanded ? "expanded" : ""} />
      </button>
      }
      {expanded && (
        <div id={bodyId} className="command-exec-details">
          <pre className="command-exec-command">{command}</pre>
          {output && <pre className="command-exec-body" tabIndex={0} aria-label="命令输出">{output}</pre>}
          {!running && <div className="command-exec-footer">
            {!interrupted && item.exitCode === 0 && <span aria-hidden="true"><CheckIcon size={12} /></span>}
            {result}
          </div>}
        </div>
      )}
    </div>
  );
};
