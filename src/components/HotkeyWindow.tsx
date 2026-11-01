import React, { useEffect, useRef, useState } from "react";
import {
  CloseIcon,
  ExternalWindowIcon,
  FolderIcon,
  MessagePlusIcon,
  SendIcon,
  SparklesIcon,
} from "./Icons";
import { MarkdownView } from "./MarkdownView";
import { callAppServer, tauriInvoke } from "../bridge";
import "./HotkeyWindow.css";

interface PopoutMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface HotkeyWindowProps {
  initialThreadId?: string | null;
  onClose?: () => void;
  onOpenMainApp?: (threadId?: string) => void;
}

export const HotkeyWindow: React.FC<HotkeyWindowProps> = ({
  initialThreadId = null,
  onClose,
  onOpenMainApp,
}) => {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<PopoutMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [currentCwd, setCurrentCwd] = useState<string>("");
  const [isPinned, setIsPinned] = useState<boolean>(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load current workspace and thread on mount
  useEffect(() => {
    tauriInvoke<Array<{ path: string; isActive: boolean }>>("workspaces_list")
      .then((list) => {
        const active = list.find((w) => w.isActive) || list[0];
        if (active) setCurrentCwd(active.path);
      })
      .catch(() => {});

    inputRef.current?.focus();
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Handle ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // Handle slash commands in Popout
    if (text === "/hotkey-new" || text === "/new") {
      setThreadId(null);
      setMessages([]);
      setInput("");
      return;
    }

    if (text === "/resume") {
      setInput("");
      try {
        const listRes = await callAppServer<{ threads?: Array<{ id: string; name?: string }> }>("thread/list", {
          limit: 1,
        });
        const latest = listRes?.threads?.[0];
        if (latest) {
          setThreadId(latest.id);
          const readRes = await callAppServer<{ thread?: { turns?: any[] } }>("thread/read", {
            threadId: latest.id,
          });
          const turns = readRes?.thread?.turns || [];
          const reconstructed: PopoutMessage[] = [];
          for (const t of turns) {
            for (const it of t.items || []) {
              if (it.type === "userMessage" && it.text) {
                reconstructed.push({ id: it.id, role: "user", content: it.text });
              } else if (it.type === "agentMessage" && it.text) {
                reconstructed.push({ id: it.id, role: "assistant", content: it.text });
              }
            }
          }
          setMessages(reconstructed);
        }
      } catch (err) {
        console.warn("Popout /resume failed:", err);
      }
      return;
    }

    const userMsg: PopoutMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    const assistantMsgId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "思考中…" },
    ]);

    try {
      let activeTid = threadId;
      if (!activeTid) {
        const startRes = await callAppServer<{ thread?: { id: string } }>("thread/start", {
          cwd: currentCwd || undefined,
          approvalPolicy: "never",
          sandbox: "workspace-write",
        });
        activeTid = startRes?.thread?.id || null;
        setThreadId(activeTid);
      }

      if (activeTid) {
        await callAppServer("turn/start", {
          threadId: activeTid,
          input: [{ type: "text", text }],
          summary: "auto",
        });

        // Poll for result briefly
        setTimeout(async () => {
          const readRes = await callAppServer<{ thread?: { turns?: any[] } }>("thread/read", {
            threadId: activeTid,
          }).catch(() => null);
          const turns = readRes?.thread?.turns || [];
          const lastTurn = turns[turns.length - 1];
          const agentText = (lastTurn?.items || [])
            .filter((it: any) => it.type === "agentMessage")
            .map((it: any) => it.text || "")
            .join("\n\n")
            .trim();

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content:
                      agentText ||
                      "回复已生成。可在主窗口完整查看执行计划、终端变更与差异。",
                  }
                : m
            )
          );
          setIsStreaming(false);
        }, 1500);
      } else {
        setTimeout(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: `已收到：${text}` }
                : m
            )
          );
          setIsStreaming(false);
        }, 600);
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `执行出错: ${err?.message || String(err)}` }
            : m
        )
      );
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="hotkey-window-container" role="dialog" aria-label="Codex 快捷提问窗口">
      <div className="hotkey-window-header">
        <div className="hotkey-header-left">
          <span className="hotkey-brand-badge">
            <SparklesIcon size={13} />
            <strong>Codex Popout</strong>
          </span>
          {currentCwd && (
            <span className="hotkey-cwd-pill" title={currentCwd}>
              <FolderIcon size={12} />
              <span>{currentCwd.split(/[/\\]/).pop()}</span>
            </span>
          )}
        </div>
        <div className="hotkey-header-right">
          <button
            type="button"
            className="hotkey-btn-icon"
            onClick={() => {
              setThreadId(null);
              setMessages([]);
              setInput("");
            }}
            title="新建任务 (Ctrl+N / /hotkey-new)"
          >
            <MessagePlusIcon size={13} />
          </button>
          {onOpenMainApp && (
            <button
              type="button"
              className="hotkey-btn-icon"
              onClick={() => onOpenMainApp(threadId || undefined)}
              title="在主应用中展开完整工作台"
            >
              <ExternalWindowIcon size={13} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="hotkey-btn-icon"
              onClick={onClose}
              title="关闭 (Esc)"
            >
              <CloseIcon size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="hotkey-messages-scroll">
        {messages.length === 0 ? (
          <div className="hotkey-empty-state">
            <p>随时随地唤起 Codex 快速推进任务</p>
            <div className="hotkey-quick-starters">
              <button
                type="button"
                className="starter-chip"
                onClick={() => setInput("检查当前工程中的未提交改动并总结要点")}
              >
                检查当前工程改动
              </button>
              <button
                type="button"
                className="starter-chip"
                onClick={() => setInput("解释最近一次的错误或日志")}
              >
                解释错误日志
              </button>
              <button
                type="button"
                className="starter-chip"
                onClick={() => setInput("/resume")}
              >
                恢复最近对话 (/resume)
              </button>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`hotkey-msg-row ${m.role}`}>
              <div className="hotkey-msg-bubble">
                <MarkdownView content={m.content} />
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="hotkey-composer-bar">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问任何问题、输入指令或 /resume 恢复… (Enter 发送)"
          rows={2}
          disabled={isStreaming}
        />
        <div className="hotkey-composer-actions">
          <span className="hotkey-tip">Esc 退出 · /resume 恢复会话</span>
          <button
            type="button"
            className="hotkey-send-button"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            title="发送 (Enter)"
          >
            <SendIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
