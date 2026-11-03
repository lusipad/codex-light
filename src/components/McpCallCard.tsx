import React, { useEffect, useRef, useState } from "react";
import type { TurnItem } from "../types";
import { CloseIcon, SparklesIcon } from "./Icons";
import "./McpCallCard.css";

export const McpCallCard: React.FC<{ item: TurnItem }> = ({ item }) => {
  const [rawOpen, setRawOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const server = item.server ?? item.serverName ?? "";
  const tool = item.tool ?? item.toolName ?? "MCP 工具";
  const result = item.result;
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const normalizedBlocks = blocks.map((block: any) => {
    if (block?.type === "resource" && block.resource) return { type: "embedded_resource", resource: block.resource };
    if (["text", "image", "audio", "resource_link", "embedded_resource"].includes(block?.type)) return block;
    return { type: "unknown", raw: block };
  });
  const structured = result?.structuredContent;
  const appEnvelope = server === "codex_apps" && structured && typeof structured === "object" &&
    Array.isArray(structured.content) && typeof structured.isError === "boolean" &&
    "meta" in structured && "structuredContent" in structured ? structured : null;
  const appStructured = appEnvelope?.structuredContent ?? structured;
  const appError = server === "codex_apps" && (appEnvelope?.isError === true ||
    (typeof appStructured?.error === "string" && typeof appStructured?.error_code === "string" &&
      appStructured?.error_data?.type === "mcp_tool_execution_error" &&
      appStructured?.error_data?.result?.isError === true));
  const failed = Boolean(item.error) || item.status === "failed" || appError;
  const running = item.status === "inProgress";
  const errorText = item.error
    ? typeof item.error === "object" ? item.error.message ?? JSON.stringify(item.error, null, 2) : String(item.error)
    : failed ? blocks.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n") ||
      JSON.stringify(structured ?? result?.content ?? result) : "";
  const normalizedResult = item.error
    ? { type: "error", kind: "protocol", error: errorText, rawError: item.error, raw: result ?? undefined }
    : result == null ? null : item.status === "failed"
    ? { type: "error", kind: "tool", error: errorText, raw: result }
    : { type: "success", content: normalizedBlocks, structuredContent: structured, raw: result };
  const raw = rawOpen ? JSON.stringify({
    callId: item.id,
    invocation: { server, tool, arguments: item.arguments },
    durationMs: item.durationMs,
    result: normalizedResult,
  }, null, 2) : "";
  const hasContent = typeof result === "string" ? result.length > 0 : blocks.length > 0 || structured != null;

  useEffect(() => {
    if (!rawOpen) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
    };
  }, [rawOpen]);

  return <div className="mcp-call-card">
    <div className="mcp-call-header">
      <SparklesIcon size={13} />
      <span className="mcp-call-tool">{server ? `${server} · ` : ""}{tool}</span>
      <span className={`mcp-call-status status-${failed ? "failed" : item.status || "completed"}`}>
        {failed ? "失败" : running ? "调用中…" : item.status === "completed" || !item.status ? "完成" : item.status}
      </span>
      <button ref={triggerRef} type="button" className="mcp-raw-trigger"
        title="显示原始工具调用输出" aria-label="显示原始工具调用输出"
        onClick={() => setRawOpen(true)}>{"{}"}</button>
    </div>
    {running && item.progressMessage && <div className="mcp-call-progress">{item.progressMessage}</div>}
    {failed ? errorText && <div className="mcp-call-error">{errorText}</div> : <>
      {typeof result === "string" && result && <pre className="mcp-call-result">{result}</pre>}
      {blocks.map((block: any, index: number) => {
        if (block?.type === "text") return <section key={index} className="mcp-text-block">
          <div>纯文本</div><pre className="mcp-call-result">{block.text}</pre>
        </section>;
        if (block?.type === "image") return <img key={index} className="mcp-result-image"
          src={`data:${block.mimeType};base64,${block.data}`} alt="工具返回的图片" />;
        if (block?.type === "audio") return <audio key={index} controls preload="metadata"
          src={`data:${block.mimeType};base64,${block.data}`} />;
        if (block?.type === "resource_link") return <div key={index}>已读取 {block.title ?? block.name ?? block.uri}</div>;
        if ((block?.type === "resource" || block?.type === "embedded_resource") && block.resource) return <section key={index}>
          <div>URI {block.resource.uri}</div>
          {block.resource.mimeType && <div>MIME type {block.resource.mimeType}</div>}
          <pre className="mcp-call-result">{block.resource.text ?? block.resource.blob ?? ""}</pre>
        </section>;
        return <pre key={index} className="mcp-call-result">{JSON.stringify(block, null, 2)}</pre>;
      })}
      {structured != null && <pre className="mcp-call-result">{JSON.stringify(structured, null, 2)}</pre>}
      {!running && !hasContent && <p className="mcp-no-result">工具未返回任何内容</p>}
    </>}
    {rawOpen && <dialog ref={dialogRef} className="mcp-raw-dialog" aria-label={`原始 ${server}.${tool} 工具调用输出`}
      onCancel={(event) => { event.preventDefault(); setRawOpen(false); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); setRawOpen(false); }
        if (event.key === "Tab") {
          const controls = event.currentTarget.querySelectorAll<HTMLElement>("button, [tabindex='0']");
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setRawOpen(false);
      }}>
      <header><h2>原始 {server}.{tool} 工具调用输出</h2>
        <button type="button" aria-label="关闭原始工具调用输出" onClick={() => setRawOpen(false)}><CloseIcon size={18} /></button>
      </header>
      <pre tabIndex={0} aria-label="原始工具调用 JSON">{raw}</pre>
    </dialog>}
  </div>;
};
