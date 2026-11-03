import React, { useEffect, useRef } from "react";
import { CloseIcon, ExternalWindowIcon, MessagePlusIcon, SparklesIcon } from "./Icons";
import { MarkdownView } from "./MarkdownView";
import { extractTextFromItem } from "../threadText";
import type { TurnData } from "../types";
import "./HotkeyWindow.css";

export interface HotkeyWindowProps {
  threadId: string | null;
  turns: TurnData[];
  isStreaming: boolean;
  loading: boolean;
  error: string | null;
  native?: boolean;
  notice?: string;
  composer: React.ReactNode;
  approvals: React.ReactNode;
  onNewChat: () => void;
  onClose: () => void;
  onOpenMainApp: () => void;
}

export const HotkeyWindow: React.FC<HotkeyWindowProps> = ({
  threadId, turns, isStreaming, loading, error, native = false, notice, composer, approvals, onNewChat, onClose, onOpenMainApp,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: "nearest" }); }, [turns, isStreaming]);

  return (
    <div ref={dialogRef} className={`hotkey-window-container${native ? " native" : ""}`} role="dialog" aria-modal="true" aria-label="Codex 快捷提问窗口"
      data-thread-id={threadId ?? undefined} onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          event.preventDefault(); event.stopPropagation(); onClose();
        }
        if (event.key === "Tab") {
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ) ?? []).filter(control => control.getClientRects().length > 0);
          const first = controls[0], last = controls[controls.length - 1];
          if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
            event.preventDefault(); (event.shiftKey ? last : first).focus();
          }
        }
      }}>
      <div className="hotkey-window-header" data-tauri-drag-region={native ? true : undefined}>
        <span className="hotkey-brand-badge"><SparklesIcon size={13} /><strong>Codex</strong></span>
        <div className="hotkey-header-right">
          <button type="button" className="hotkey-btn-icon" onClick={onNewChat} title="新建聊天" aria-label="新建聊天"><MessagePlusIcon size={13} /></button>
          <button type="button" className="hotkey-btn-icon" onClick={onOpenMainApp} title="在主窗口继续" aria-label="在主窗口继续"><ExternalWindowIcon size={13} /></button>
          <button type="button" className="hotkey-btn-icon" onClick={onClose} title="关闭 (Esc)" aria-label="关闭"><CloseIcon size={13} /></button>
        </div>
      </div>
      <div className="hotkey-messages-scroll">
        <p className="hotkey-tip">{native ? "独立聊天；隐藏后继续运行，未发送草稿和附件保留在此窗口。" : "应用内快捷面板，使用主会话的草稿、模型和权限。"}</p>
        {notice && <div role="alert">{notice}</div>}
        {loading && <div role="status">正在加载会话…</div>}
        {error && <div role="alert">{error} <button type="button" onClick={onOpenMainApp}>在主窗口重试</button></div>}
        {!loading && turns.length === 0 && <div className="hotkey-empty-state">开始新的聊天</div>}
        {turns.map(turn => <div key={turn.id} data-turn-id={turn.id}>
          {turn.items.filter(item => ["user", "userMessage", "agentMessage", "assistant"].includes(item.type)).map((item, index) => (
            <div key={item.id ?? index} className={`hotkey-msg-row ${item.type === "user" || item.type === "userMessage" ? "user" : "assistant"}`}>
              <div className="hotkey-msg-bubble"><MarkdownView content={extractTextFromItem(item)} /></div>
            </div>
          ))}
          {turn.status === "failed" && <div role="alert">执行失败：{turn.error?.message ?? "请在主窗口查看详情"}</div>}
        </div>)}
        {isStreaming && <div role="status">正在运行…</div>}
        {approvals}
        <div ref={messagesEndRef} />
      </div>
      <div className="hotkey-composer-bar">{composer}</div>
    </div>
  );
};
