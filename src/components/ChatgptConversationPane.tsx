import React from "react";
import { UserMessageBubble } from "./UserMessageBubble";
import { MarkdownView } from "./MarkdownView";
import "./ChatgptConversationPane.css";

export interface ChatgptConversationMessage {
  id: string;
  raw: Record<string, unknown>;
  text: string | null;
  optimistic?: boolean;
  unsupported?: boolean;
}

export interface ChatgptConversationPaneProps {
  /** Actual ordered message identities supplied by the scoped controller. */
  messages: readonly ChatgptConversationMessage[];
  pending: boolean;
  error?: string | null;
  composer: React.ReactNode;
  title?: string;
}

/** Text-only transcript slots. Existing local renderers are reused; this does
 * not claim parity with the official GSDP message subtree or its tool actions. */
export function ChatgptConversationPane({ messages, pending, error, composer, title }: ChatgptConversationPaneProps) {
  return <section className="chatgpt-conversation-pane" aria-label={title || "ChatGPT 聊天"}>
    <div className="timeline-scroll-pane">
      <div className="timeline-content-wrapper">
        {messages.map(message => {
          const author = message.raw.author;
          const role = author && typeof author === "object" && !Array.isArray(author)
            ? (author as Record<string, unknown>).role : null;
          const supported = !message.unsupported && message.text !== null && (role === "user" || role === "assistant");
          return <div key={message.id} data-chatgpt-message-id={message.id}
            className={supported ? role === "user" ? "user-turn-block" : "assistant-turn-block" : "chatgpt-conversation-unsupported"}>
            {supported ? role === "user"
              ? <UserMessageBubble text={message.text!} remoteContent="no-remote-images" />
              : <MarkdownView content={message.text!} remoteContent="no-remote-images" />
              : <details open><summary>暂不支持此消息内容</summary><pre>{JSON.stringify(message.raw, null, 2)}</pre></details>}
          </div>;
        })}
        {pending && <div role="status" className="chatgpt-conversation-pending">正在等待回复…</div>}
        {error && <div role="alert" className="chatgpt-conversation-error">{error}</div>}
      </div>
    </div>
    <div className="chatgpt-conversation-composer">{composer}</div>
  </section>;
}
