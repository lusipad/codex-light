import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage } from "../chatgptService";
import { readBoundCloudDraft } from "../cloudDraftBindings";
import { readCloudDraftHistory } from "../cloudDraftHistory";
import { prepareCloudDraftContext, restoreCloudDraftSession, type CloudDraftSession } from "../cloudDraftSession";
import type { CloudDetail } from "../cloudEnvironmentService";
import { extractTextFromItem } from "../threadText";
import type { TurnItem } from "../types";
import { renderCloudEnvironmentFields } from "./CloudEnvironmentsView";
import { MarkdownView } from "./MarkdownView";
import { UserMessageBubble } from "./UserMessageBubble";
import "./CloudDraftView.css";

type History = Awaited<ReturnType<typeof readCloudDraftHistory>>;
const historyLimits = { turnLimit: 5, itemLimit: 100 };

export function CloudDraftView({ session, persisted, onBack }: { session: CloudDraftSession; persisted: boolean; onBack: () => void }) {
  const [scope, setScope] = useState<AbortSignal | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelAttempt, setPanelAttempt] = useState(0);
  const [detail, setDetail] = useState<CloudDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    let stop: (() => void) | undefined;
    void tauriListen("chatgpt-service:invalidated", () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      olderRequest.current?.abort();
      setScope(null); setHistory(null); setDetail(null);
      setScopeError("账号已更改，请返回环境列表。");
    }).then(unlisten => {
      if (lifetime.signal.aborted) unlisten();
      else { stop = unlisten; setScope(lifetime.signal); }
    }, cause => { if (!lifetime.signal.aborted) setScopeError(serviceErrorMessage(cause)); });
    return () => { lifetime.abort(); olderRequest.current?.abort(); stop?.(); };
  }, [session]);

  useEffect(() => {
    if (!scope || scope.aborted) return;
    const request = new AbortController();
    const cancel = () => request.abort();
    scope.addEventListener("abort", cancel, { once: true });
    setRestoreError(null); setHistory(null); setOlderError(null);
    void restoreCloudDraftSession(session, prepareCloudDraftContext, historyLimits, request.signal).then(result => {
      if (!request.signal.aborted) setHistory(result.history);
    }, cause => { if (!request.signal.aborted) setRestoreError(serviceErrorMessage(cause)); });
    return () => { cancel(); scope.removeEventListener("abort", cancel); };
  }, [scope, session, restoreAttempt]);

  useEffect(() => {
    if (!scope || scope.aborted || !panelOpen) return;
    const request = new AbortController();
    const cancel = () => request.abort();
    scope.addEventListener("abort", cancel, { once: true });
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (request.signal.aborted || busy) return;
      clearTimeout(timer);
      busy = true;
      try {
        const current = await readBoundCloudDraft(session.binding, session.identity, request.signal);
        if (request.signal.aborted) return;
        setDetail(current); setDetailError(null);
        timer = setTimeout(refresh, 5000);
      } catch (cause) {
        if (!request.signal.aborted) { setDetail(null); setDetailError(serviceErrorMessage(cause)); }
      } finally { busy = false; }
    };
    setDetailError(null);
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancel(); clearTimeout(timer);
      scope.removeEventListener("abort", cancel);
      window.removeEventListener("focus", refresh);
    };
  }, [scope, session, panelOpen, panelAttempt]);

  useEffect(() => { if (panelOpen) panelHeading.current?.focus(); else panelButton.current?.focus(); }, [panelOpen]);

  const loadEarlier = async () => {
    if (!scope || scope.aborted || !history?.olderCursor || olderRequest.current) return;
    const request = new AbortController();
    olderRequest.current = request;
    setOlderBusy(true); setOlderError(null);
    try {
      const page = await readCloudDraftHistory(session.threadId, session.identity, request.signal, { ...historyLimits, cursor: history.olderCursor });
      if (request.signal.aborted) return;
      const currentIds = new Set(history.turns.map(entry => entry.turn.id));
      setHistory({ turns: [...page.turns.filter(entry => !currentIds.has(entry.turn.id)), ...history.turns], olderCursor: page.olderCursor });
    } catch (cause) { if (!request.signal.aborted) setOlderError(serviceErrorMessage(cause)); }
    finally {
      if (olderRequest.current === request) olderRequest.current = null;
      if (!request.signal.aborted) setOlderBusy(false);
    }
  };

  return <div className="cloud-draft-view" data-chat-host="durable">
    <section className="cloud-draft-chat" aria-label="云端会话">
      <header className="cloud-draft-heading">
        <button type="button" className="back-to-app-pill" onClick={onBack}>← 返回环境</button>
        <h1>编辑 {session.binding.name}</h1>
        <button type="button" className="back-to-app-pill" ref={panelButton} aria-expanded={panelOpen} aria-controls="cloud-draft-environment" onClick={() => setPanelOpen(value => !value)}>环境</button>
      </header>
      <div className="timeline-scroll-pane cloud-draft-timeline">
        <div className="timeline-content-wrapper">
          {!persisted && <p role="status">草稿关联未保存，当前窗口仍可继续。</p>}
          {scopeError ? <p role="alert">{scopeError}</p> : restoreError ? <div role="alert">{restoreError} <button type="button" onClick={() => setRestoreAttempt(value => value + 1)}>重试恢复</button></div> : !history ? <p role="status">正在恢复云端会话…</p> : <>
            {history.olderCursor && <button type="button" className="turn-action-mini-btn" disabled={olderBusy} onClick={() => void loadEarlier()}>加载更早的轮次</button>}
            {olderError && <p role="alert">{olderError}</p>}
            {!history.turns.length && <p role="status">暂无历史消息</p>}
            {history.turns.map(({ turn }) => <div className="cloud-draft-turn" key={turn.id}>{turn.items.map(raw => {
              const item = raw as unknown as TurnItem;
              const text = extractTextFromItem(item);
              return text && (item.type === "userMessage" || item.type === "user"
                ? <div className="user-turn-block" key={item.id}><UserMessageBubble text={text} remoteContent="no-remote-images" /></div>
                : <div className="assistant-turn-block" key={item.id}><MarkdownView content={text} remoteContent="no-remote-images" /></div>);
            })}</div>)}
          </>}
        </div>
      </div>
    </section>
    {panelOpen && <aside id="cloud-draft-environment" className="cloud-draft-environment" aria-labelledby="cloud-draft-environment-heading" onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); setPanelOpen(false); }
    }}>
      <header className="cloud-draft-heading"><h2 id="cloud-draft-environment-heading" tabIndex={-1} ref={panelHeading}>环境</h2><button type="button" className="window-chrome-icon-btn" aria-label="关闭环境侧栏" onClick={() => setPanelOpen(false)}><X size={16} aria-hidden="true" /></button></header>
      <div className="cloud-draft-fields">
        {scopeError ? <p role="alert">{scopeError}</p> : detailError ? <div role="alert">{detailError} <button type="button" onClick={() => setPanelAttempt(value => value + 1)}>重试</button></div> : detail ? renderCloudEnvironmentFields({ detail, repository: id => <span>{session.binding.repositoryNamesById[id] ?? "未知代码仓库"}</span> }) : <p role="status">正在载入环境…</p>}
      </div>
    </aside>}
  </div>;
}
