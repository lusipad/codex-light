import React, { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { serviceErrorMessage } from "../chatgptService";
import type { readCloudDraftHistory } from "../cloudDraftHistory";
import type { CloudDraftSession } from "../cloudDraftSession";
import { advanceCloudEnvironmentReply, changeCloudEnvironmentReply, cloudReplyMaxLength, type CloudReplyStatus } from "../cloudEnvironmentReply";

const labels = {
  queued: "回复等待会话空闲。",
  paused: "待发送的回复已暂停。",
  unconfirmed: "回复的投递结果尚未确认。",
  accepted: "回复已发送，正在同步历史。",
};

export function CloudEnvironmentReply({ session, history, scope, revision, refreshHistory, disabled = false }: {
  session: CloudDraftSession;
  history: Awaited<ReturnType<typeof readCloudDraftHistory>>;
  scope: AbortSignal;
  revision: number;
  refreshHistory: React.RefObject<(() => void) | null>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<CloudReplyStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const changing = useRef(false);
  const previousStatus = useRef<CloudReplyStatus>(null);
  const resume = useRef(false);

  useEffect(() => {
    if (scope.aborted || busy || error || disabled) return;
    const resumePaused = resume.current;
    resume.current = false;
    void advanceCloudEnvironmentReply(session, history, scope, resumePaused).then(next => {
      if (scope.aborted) return;
      const before = previousStatus.current;
      previousStatus.current = next;
      setStatus(next);
      if (next === "accepted" && before !== "accepted") refreshHistory.current?.();
    }, cause => {
      if (!scope.aborted) setError(serviceErrorMessage(cause));
    });
  }, [session, history, scope, revision, refreshHistory, attempt, busy, error, disabled]);

  const change = async (value: string | null) => {
    if (disabled || changing.current || scope.aborted || value !== null && (!value.trim() || status !== null)) return;
    changing.current = true;
    setBusy(true); setError(null);
    try {
      await changeCloudEnvironmentReply(session, value, scope);
      if (scope.aborted) return;
      if (value !== null) { setText(""); setStatus("queued"); }
      setAttempt(number => number + 1);
    } catch (cause) {
      if (!scope.aborted) setError(serviceErrorMessage(cause));
    } finally {
      changing.current = false;
      if (!scope.aborted) setBusy(false);
    }
  };
  const retry = (resumePaused: boolean) => {
    resume.current = resumePaused;
    setError(null);
    setAttempt(number => number + 1);
  };
  const canSend = !!text.trim() && !busy && !disabled && status === null;
  return <form className="cloud-environment-reply" aria-label="设置会话回复" onSubmit={event => {
    event.preventDefault();
    if (canSend) void change(text);
  }}>
    {status && <div role="status">{labels[status]} {status === "queued" || status === "paused" ? <>
        {status === "paused" && <button type="button" disabled={busy || disabled} onClick={() => retry(true)}>继续发送</button>}
      <button type="button" disabled={busy || disabled} onClick={() => void change(null)}>取消待发送回复</button>
    </> : <button type="button" onClick={() => refreshHistory.current?.()}>核对会话</button>}</div>}
    {error && <div role="alert">{error} <button type="button" onClick={() => retry(false)}>重试核对</button></div>}
    <div className="cloud-environment-reply-box">
      <textarea className="composer-textarea" aria-label="回复设置会话" placeholder="回复设置会话…" rows={2}
        maxLength={cloudReplyMaxLength} value={text} readOnly={busy || disabled} onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          if (canSend) void change(text);
        }} />
      <button type="submit" className="back-to-app-pill" aria-label="发送回复" disabled={!canSend}><ArrowUp size={16} aria-hidden="true" /></button>
    </div>
  </form>;
}
