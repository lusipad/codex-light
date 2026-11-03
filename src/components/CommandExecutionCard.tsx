import React, { useId, useState } from "react";
import type { TurnItem } from "../types";
import { CheckIcon, ChevronDownIcon, TerminalIcon } from "./Icons";

export const CommandExecutionCard: React.FC<{ item: TurnItem; turnStatus?: string }> = ({ item, turnStatus }) => {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const interrupted = item.status === "interrupted" ||
    (item.status === "inProgress" && turnStatus === "interrupted");
  const running = !interrupted && (item.status === "inProgress" || item.status === "running");
  const command = Array.isArray(item.command) ? item.command.join(" ") : item.command || "command";
  const output = item.aggregatedOutput ?? item.output ?? "";
  const summary = interrupted ? "已停止命令" : running ? "正在运行命令" : "已运行命令";
  const result = interrupted ? "已停止" : item.exitCode === 0 ? "成功" : `退出码 ${item.exitCode ?? "未知"}`;

  return (
    <div id={item.id ? `command-${item.id}` : undefined} className="command-exec-card" data-execution-status={interrupted ? "interrupted" : item.status}>
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
        {!expanded && <span className="command-exec-title" title={command}>{command}</span>}
        <ChevronDownIcon size={12} className={expanded ? "expanded" : ""} />
      </button>
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
