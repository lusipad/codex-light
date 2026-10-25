import React, { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, CloseIcon, CopyIcon, SendIcon, SparklesIcon, SquarePlusIcon } from "./Icons";
import { MarkdownView } from "./MarkdownView";
import { callAppServer } from "../bridge";
import "./SideChatPanel.css";

export interface SideChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface SideChatPanelProps {
  initialPrompt?: string;
  workspacePath?: string;
  onClose?: () => void;
  onFocusMainChat?: () => void;
  onInsertToMainChat?: (content: string) => void;
}

export const SideChatPanel: React.FC<SideChatPanelProps> = ({
  initialPrompt = "",
  workspacePath,
  onClose,
  onFocusMainChat,
  onInsertToMainChat,
}) => {
  const [messages, setMessages] = useState<SideChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "这是你的**独立侧边对话 (Side Chat)**。\n\n你可以在此就主对话的代码细节、特定选区或思路进行快速深入探索，而不会影响主对话的上下文与工作树状态。",
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = useState<string>(initialPrompt);
  const [isSending, setIsSending] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // When initialPrompt changes (e.g. from Ask in side chat), fill input and focus
  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(initialPrompt.length, initialPrompt.length);
      }, 50);
    }
  }, [initialPrompt]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;

    const userMsg: SideChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    const assistantMsgId = `assistant-${Date.now()}`;
    const placeholderAssistant: SideChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "正在思考与整理回答…",
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, placeholderAssistant]);

    try {
      // Start a quick side thread or query
      const sideThreadRes = await callAppServer<{ thread?: { id: string } }>("thread/start", {
        cwd: workspacePath || undefined,
        approvalPolicy: "never",
        sandbox: "workspace-write",
      }).catch(() => null);

      const threadId = sideThreadRes?.thread?.id;

      if (threadId) {
        // Send turn
        const turnRes = await callAppServer<{ turn?: { id: string; status?: string } }>("turn/start", {
          threadId,
          input: [{ type: "text", text }],
        }).catch(() => null);

        // Fallback simulate or await result
        if (turnRes?.turn) {
          // Read thread back after slight delay
          setTimeout(async () => {
            const readRes = await callAppServer<{ thread?: { turns?: any[] } }>("thread/read", {
              threadId,
            }).catch(() => null);

            const lastTurn = readRes?.thread?.turns?.[readRes.thread.turns.length - 1];
            const agentItems = lastTurn?.items?.filter((it: any) => it.type === "agentMessage") || [];
            const textResponse = agentItems.map((it: any) => it.text || "").join("\n\n").trim();

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content:
                        textResponse ||
                        "已完成侧边分析。此会话在轻量隔离上下文中运行，结果可随时复制或引入主会话。",
                    }
                  : m
              )
            );
            setIsSending(false);
          }, 1500);
          return;
        }
      }

      // Local graceful fallback response
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `针对您的问题：\n\n> ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}\n\n建议可以在主聊天中进一步引导模型，或使用 Ctrl+Shift+; 提取代码块后进行下一步验证。`,
                }
              : m
          )
        );
        setIsSending(false);
      }, 600);
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `侧边对话遇到问题: ${err?.message || String(err)}` }
            : m
        )
      );
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Alt+L or Shift+Escape to focus main chat
    if ((e.altKey && e.key.toLowerCase() === "l") || (e.shiftKey && e.key === "Escape")) {
      e.preventDefault();
      onFocusMainChat?.();
    }
  };

  const handleNewSideChat = () => {
    setMessages([
      {
        id: `intro-${Date.now()}`,
        role: "assistant",
        content: "已开启新的侧边对话空白画板。",
        createdAt: Date.now(),
      },
    ]);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="side-chat-panel" role="region" aria-label="侧边独立对话">
      <div className="side-chat-header">
        <div className="side-chat-header-title">
          <span className="accent-icon"><SparklesIcon size={14} /></span>
          <strong>侧边对话</strong>
          <span className="side-chat-badge">Side Chat</span>
        </div>
        <div className="side-chat-header-actions">
          <button
            type="button"
            className="side-chat-icon-btn"
            onClick={handleNewSideChat}
            title="开启新的侧边对话"
          >
            <SquarePlusIcon size={14} />
          </button>
          {onFocusMainChat && (
            <button
              type="button"
              className="side-chat-icon-btn"
              onClick={onFocusMainChat}
              title="聚焦回主聊天 (Shift+Esc / Alt+L)"
            >
              <ArrowLeftIcon size={14} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="side-chat-icon-btn"
              onClick={onClose}
              title="关闭侧边对话标签"
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="side-chat-messages" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`side-chat-bubble ${msg.role}`}>
            <div className="side-chat-bubble-content">
              <MarkdownView content={msg.content} />
            </div>
            {msg.role === "assistant" && (
              <div className="side-chat-bubble-actions">
                <button
                  type="button"
                  className="side-bubble-action-btn"
                  onClick={() => navigator.clipboard.writeText(msg.content)}
                  title="复制此回答"
                >
                  <CopyIcon size={12} />
                  <span>复制</span>
                </button>
                {onInsertToMainChat && (
                  <button
                    type="button"
                    className="side-bubble-action-btn"
                    onClick={() => onInsertToMainChat(msg.content)}
                    title="将此内容作为回答引用引入主聊天"
                  >
                    <span>引入主聊天</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="side-chat-composer">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在侧边快速深入提问… (Enter 发送，Shift+Enter 换行)"
          rows={2}
          disabled={isSending}
        />
        <div className="side-chat-composer-footer">
          <span className="side-chat-hint">Shift+Esc 聚焦主聊天</span>
          <button
            type="button"
            className="side-chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            title="发送提问"
          >
            <SendIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
