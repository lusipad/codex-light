import React, { useEffect, useRef } from "react";
import { useShareThreadSession } from "../shareThreadSession";
import { CloseIcon, GlobeIcon } from "./Icons";
import "./ShareThreadDialog.css";

export function ShareThreadDialog({ threadId, title, onClose }: {
  threadId: string; title?: string; onClose: () => void;
}) {
  const session = useShareThreadSession(threadId, onClose);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const creating = session.phase === "creating";
  const busy = session.phase === "loading" || creating;
  const editable = session.phase === "prepared";
  const failed = ["error", "unknown", "unavailable"].includes(session.phase);
  const actionDisabled = busy || session.phase === "unavailable" || session.phase === "unknown" ||
    (!failed && ((session.phase !== "prepared" && session.phase !== "ready") ||
      session.query.trim().length > 0 || (session.audience.access === "invited" && !session.selected.length)));
  const preview = session.snapshot?.turns.map(turn => ({
    items: turn.items.filter(item => item.type === "userMessage" ||
      item.type === "agentMessage" && item.phase !== "commentary" ||
      item.type === "imageView" || item.type === "imageGeneration"),
  })).filter(turn => turn.items.length).slice(0, 4);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.focus();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const dismiss = () => { if (!creating && !submitting.current && !composing.current) onClose(); };
  const displayText = (text: string) => text.replace(/!\[[^\]]*\]\(codex:shared-(?:asset\/[^)]+|image-unavailable)\)/g, "[图像]");

  return (
    <dialog ref={dialogRef} tabIndex={-1} className="share-thread-dialog" aria-label={title?.trim() ? `分享 ${title.trim()}` : "分享聊天"}
      aria-describedby="share-thread-notice" aria-busy={busy}
      onCancel={event => { event.preventDefault(); dismiss(); }}
      onMouseDown={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        event.stopPropagation();
        if ((composing.current || event.nativeEvent.isComposing || event.keyCode === 229) &&
          (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
      }}
    >
      {!creating && <button type="button" className="share-thread-close" aria-label="关闭对话框" onClick={dismiss}><CloseIcon size={14} /></button>}
      <form onSubmit={event => {
        event.preventDefault(); event.stopPropagation();
        if (actionDisabled || composing.current || submitting.current) return;
        if (session.phase === "error") { session.retry(); return; }
        submitting.current = true;
        void session.publishOrCopy().catch(() => undefined).finally(() => { submitting.current = false; });
      }}>
        <header>
          <h2>{title?.trim() ? `分享 ${title.trim()}` : "分享聊天"}</h2>
          <p id="share-thread-notice">分享后，你的姓名以及你添加的新消息不会显示在共享聊天中。{" "}
            <a href="https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq#what-information-about-me-is-included-in-the-shared-link-i-generate"
              target="_blank" rel="noopener noreferrer">了解更多</a>
          </p>
        </header>
        <div className="share-thread-body">
          {failed ? <div className="share-thread-blocked" role="alert">
            {session.error || (session.phase === "unknown" ? "发布结果尚未确认，请勿重复发布。" :
              session.phase === "unavailable" ? "此会话暂时无法分享。" : "无法准备此聊天以供分享")}
          </div> : <>
            <div className="share-thread-preview" role="img" aria-label="共享聊天开头部分的预览">
              {!preview ? <div className="share-thread-preview-loading" role="status">正在加载预览…</div> :
                <div className="share-thread-preview-content" aria-hidden="true" inert>
                  {preview.map((turn, turnIndex) => <div key={turnIndex}>
                    {turn.items.map((item, index) => item.type === "userMessage" ?
                      <div className="share-thread-preview-user" key={index}>{item.content.map((part, partIndex) =>
                        part.type === "text" ? <span key={partIndex}>{displayText(part.text)}</span> :
                          <span className="share-thread-preview-image" key={partIndex}>图像</span>)}</div> :
                      item.type === "agentMessage" ? <div className="share-thread-preview-agent" key={index}>{displayText(item.text)}</div> :
                        <div className="share-thread-preview-image" key={index}>图像</div>)}
                  </div>)}
                </div>}
            </div>
            {session.account?.kind === "workspace" ? <>
              <div className="share-thread-recipient-search">
                <label className="sr-only" htmlFor="share-thread-recipient-query">通过电子邮箱添加成员或添加群组</label>
                <div className="share-thread-selected">{session.selected.map(recipient =>
                  <span key={recipient.id}>{recipient.label}
                    <button type="button" disabled={!editable} aria-label={`移除 ${recipient.label}`}
                      onClick={() => session.removeRecipient(recipient.id)}>×</button>
                  </span>)}</div>
                <input id="share-thread-recipient-query" placeholder="添加成员或群组" value={session.query} disabled={!editable}
                  onChange={event => session.setQuery(event.target.value)} autoComplete="off" />
                {session.searching && <p role="status">正在搜索…</p>}
                {session.searchError && <p role="alert">{session.searchError}</p>}
                {session.query.trim() && !session.searching && !session.searchError && <div className="share-thread-results">
                  {!session.results.length && <p>没有匹配的工作空间成员或群组</p>}
                  {(["group", "user"] as const).map(kind => {
                    const results = session.results.filter(recipient => recipient.principal.principal_type === kind);
                    return results.length ? <div key={kind}><h3>{kind === "group" ? "群组" : "成员"}</h3>
                      {results.map(recipient => <button type="button" key={recipient.id} disabled={!editable}
                        onClick={() => session.addRecipient(recipient)}>
                        <span>{recipient.label}</span>
                        {recipient.secondaryLabel && <small>{recipient.secondaryLabel}</small>}
                        {kind === "group" && recipient.memberCount != null && <small>{recipient.memberCount} 位成员</small>}
                      </button>)}</div> : null;
                  })}
                </div>}
              </div>
              <section className="share-thread-access" aria-label="谁有访问权限">
                <h3>谁有访问权限</h3>
                <label className="share-thread-audience"><span aria-hidden="true" className="share-thread-audience-icon"><GlobeIcon size={18} /></span>
                  <select aria-label="链接访问权限" disabled={!editable} value={session.audience.access}
                    onChange={event => session.setAccess(event.target.value as "workspace" | "invited")}>
                    <option value="workspace">{session.account.name ? `${session.account.name} 中的所有人` : "此工作空间中的所有人"}</option>
                    <option value="invited">仅限受邀成员和群组</option>
                  </select>
                </label>
                <div className="share-thread-owner"><span>你</span><span>所有者</span></div>
              </section>
            </> : <p className="share-thread-public">任何知道此链接的人都可以查看此聊天</p>}
            {session.error && <p className="share-thread-error" role="alert">{session.error}</p>}
            {session.copyFailed && session.shareUrl && <label className="share-thread-copy-url">分享链接
              <input aria-label="分享链接" readOnly value={session.shareUrl} onFocus={event => event.currentTarget.select()} />
            </label>}
          </>}
        </div>
        <footer><button ref={actionRef} type="submit" disabled={actionDisabled} className="share-thread-action">
          {busy && <span className="share-thread-spinner" aria-hidden="true" />}
          {session.phase === "error" ? "重试" : "复制链接"}
        </button></footer>
      </form>
    </dialog>
  );
}
