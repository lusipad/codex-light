import React from "react";
import { TurnItem } from "../types";
import { SparklesIcon } from "./Icons";
import "./ToolCallCards.css";

interface ToolCallCardsProps {
  items: TurnItem[];
  onOpenThread?: (threadId: string) => void;
}

function stringifyOutput(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyOutput(entry)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (record.output != null) return stringifyOutput(record.output);
    if (record.content != null) return stringifyOutput(record.content);
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function statusLabel(status: unknown, success?: boolean | null): string {
  if (success === false) return "失败";
  const value = String(status || "completed");
  const labels: Record<string, string> = {
    inProgress: "调用中",
    completed: "完成",
    failed: "失败",
    interrupted: "已中断",
    running: "运行中",
    errored: "失败",
    pendingInit: "初始化中",
    shutdown: "已关闭",
    notFound: "未找到",
    started: "已启动",
    interacted: "已交互",
  };
  return labels[value] ?? value;
}

function ThreadLink({ id, onOpenThread }: { id: string; onOpenThread?: (id: string) => void }) {
  if (!onOpenThread) return <span className="tool-call-thread-id">{id}</span>;
  return (
    <button type="button" className="tool-call-thread-link" onClick={() => onOpenThread(id)} title={`打开子代理会话 ${id}`}>
      {id.slice(0, 8)}…
    </button>
  );
}

function OutputDetails({ label, value }: { label: string; value: unknown }) {
  const text = stringifyOutput(value);
  if (!text) return null;
  return (
    <details className="tool-call-details">
      <summary>{label}</summary>
      <pre className="tool-call-output" tabIndex={0}>{text}</pre>
    </details>
  );
}

function ToolOutputContent({ item }: { item: TurnItem }) {
  const contentItems = Array.isArray(item.contentItems) ? item.contentItems : [];
  return (
    <>
      {contentItems.map((content: any, index: number) => {
        if (content?.type === "inputImage" && content.imageUrl) {
          return <img key={index} className="tool-call-image" src={content.imageUrl} alt="工具输出图片" loading="lazy" />;
        }
        if (content?.type === "inputAudio" && content.audioUrl) {
          return <a key={index} href={content.audioUrl} target="_blank" rel="noreferrer">打开音频输出</a>;
        }
        return <OutputDetails key={index} label="输出" value={content} />;
      })}
    </>
  );
}

export const ToolCallCards: React.FC<ToolCallCardsProps> = ({ items, onOpenThread }) => {
  return (
    <>
      {items.map((item, index) => {
        const status = statusLabel(item.status, item.success);
        const statusClass = item.status === "failed" || item.success === false
          ? "failed"
          : item.status === "inProgress" || item.status === "running"
            ? "active"
            : "completed";

        if (item.type === "collabAgentToolCall") {
          const receiverIds = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [];
          const states = item.agentsStates && typeof item.agentsStates === "object"
            ? Object.entries(item.agentsStates)
            : [];
          return (
            <article key={item.id || index} className="tool-call-card">
              <div className="tool-call-header">
                <SparklesIcon size={13} />
                <strong>{item.tool || "子代理协作"}</strong>
                <span className={`tool-call-status ${statusClass}`}>{status}</span>
              </div>
              <div className="tool-call-meta">子代理协作{item.model ? ` · ${item.model}` : ""}</div>
              {item.prompt && <OutputDetails label="任务提示" value={item.prompt} />}
              {receiverIds.length > 0 && (
                <div className="tool-call-thread-links">
                  {receiverIds.map((id: string) => <ThreadLink key={id} id={id} onOpenThread={onOpenThread} />)}
                </div>
              )}
              {states.length > 0 && (
                <div className="tool-call-agent-states">
                  {states.map(([id, state]: [string, any]) => (
                    <div key={id} className="tool-call-agent-state">
                      <span>{statusLabel(state?.status)}</span>
                      <ThreadLink id={id} onOpenThread={onOpenThread} />
                      {state?.message && <span>{state.message}</span>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        }

        if (item.type === "subAgentActivity") {
          return (
            <article key={item.id || index} className="tool-call-card">
              <div className="tool-call-header">
                <SparklesIcon size={13} />
                <strong>子代理活动 · {item.kind || "更新"}</strong>
                <span className={`tool-call-status ${statusClass}`}>{status}</span>
              </div>
              <div className="tool-call-meta">{item.agentPath || "子代理"}</div>
              {item.agentThreadId && <ThreadLink id={item.agentThreadId} onOpenThread={onOpenThread} />}
            </article>
          );
        }

        const title = item.tool || item.name || (item.type === "functionCallOutput" ? "函数输出" : "动态工具");
        return (
          <article key={item.id || index} className="tool-call-card">
            <div className="tool-call-header">
              <SparklesIcon size={13} />
              <strong>{item.namespace ? `${item.namespace} · ${title}` : title}</strong>
              <span className={`tool-call-status ${statusClass}`}>{status}</span>
            </div>
            <div className="tool-call-meta">
              {item.type === "functionCallOutput" ? "函数调用输出" : "动态工具调用"}
              {item.durationMs != null ? ` · ${item.durationMs}ms` : ""}
            </div>
            {item.arguments != null && <OutputDetails label="参数" value={item.arguments} />}
            {item.type === "functionCallOutput"
              ? <OutputDetails label="输出" value={item.output} />
              : <ToolOutputContent item={item} />}
            {item.error && <pre className="tool-call-error" tabIndex={0}>{stringifyOutput(item.error)}</pre>}
          </article>
        );
      })}
    </>
  );
};
