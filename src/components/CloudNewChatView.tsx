import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Cloud } from "lucide-react";
import { serviceErrorMessage } from "../chatgptService";
import type { CloudDraftSession } from "../cloudDraftSession";
import { cloudReplyMaxLength } from "../cloudEnvironmentReply";
import { readPublishedCloudStart, startPublishedCloudChat, type PublishedCloudTarget } from "../cloudPublishedChat";
import type { ComposerEnterBehavior } from "../composerPreferences";

export function CloudNewChatView({ target, enterBehavior, onBack, onOpen }: {
  target: PublishedCloudTarget;
  enterBehavior: ComposerEnterBehavior;
  onBack: () => void;
  onOpen: (session: CloudDraftSession) => boolean;
}) {
  const lifetime = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const [text, setText] = useState("");
  const [entry, setEntry] = useState<ReturnType<typeof readPublishedCloudStart>>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    try { setEntry(readPublishedCloudStart(target)); }
    catch (cause) { setError(serviceErrorMessage(cause)); }
    return () => controller.abort();
  }, [target]);
  const send = async () => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || sending.current || (entry ? !entry.threadId : !text.trim())) return;
    sending.current = true;
    setBusy(true); setError(null);
    try { await startPublishedCloudChat(target, text, signal, onOpen); }
    catch (cause) { if (!signal.aborted) setError(serviceErrorMessage(cause)); }
    finally {
      sending.current = false;
      if (!signal.aborted) {
        setBusy(false);
        try { setEntry(readPublishedCloudStart(target)); }
        catch (cause) { setError(serviceErrorMessage(cause)); }
      }
    }
  };
  const canSend = !busy && (entry ? !!entry.threadId : !!text.trim());
  return <div className="home-hero-container">
    <div className="home-hero-center"><h1>新云端聊天</h1></div>
    <div className="home-composer-dock">
      <form className="cloud-environment-reply" aria-label="新云端聊天" onSubmit={event => {
        event.preventDefault();
        if (canSend) void send();
      }}>
        <div className="cloud-environment-reply-box">
          <textarea autoFocus className="composer-textarea" aria-label="云端消息" placeholder="随心输入"
            rows={3} maxLength={cloudReplyMaxLength} readOnly={busy || !!entry} value={entry?.text ?? text}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.ctrlKey || event.metaKey || enterBehavior === "enter" || (enterBehavior === "cmdIfMultiline" && !text.includes("\n"))) {
                event.preventDefault();
                if (canSend) void send();
              }
            }} />
          <button type="submit" className="back-to-app-pill" aria-label={entry?.threadId ? "继续打开聊天" : "发送"} disabled={!canSend}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
        <p><Cloud size={14} aria-hidden="true" /> 云端 · {target.session.binding.name}</p>
        {busy && <p role="status">正在启动云端聊天…</p>}
        {entry && !entry.threadId && <p role="status">云端聊天的创建结果尚未确认。</p>}
        {error && <p role="alert">{error}</p>}
        <button type="button" className="back-to-app-pill" onClick={onBack}>返回环境</button>
      </form>
    </div>
  </div>;
}
