import React, { useId, useLayoutEffect, useRef, useState } from "react";
import type { ServiceIdentity } from "../chatgptService";
import { usePluginSkillContents } from "../pluginSkillContents";
import { BookOpenIcon, CloseIcon } from "./Icons";
import { MarkdownView } from "./MarkdownView";
import "./PluginSkillContentsDialog.css";

interface PluginSkillContentsDialogProps {
  scope: string;
  pluginId: string;
  skill: { name: string; description?: string | null; interface?: { displayName?: string | null; shortDescription?: string | null } | null };
  identity: ServiceIdentity;
  isCurrent: () => boolean;
  onClose: () => void;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export function PluginSkillContentsDialog({ scope, pluginId, skill, identity, isCurrent, onClose, headerActions, footer, returnFocusRef }: PluginSkillContentsDialogProps) {
  const contents = usePluginSkillContents(scope, pluginId, skill.name, identity);
  const dialog = useRef<HTMLDialogElement>(null), composing = useRef(false), flight = useRef<object | null>(null);
  const key = JSON.stringify([scope, pluginId, skill.name, identity.accountId, identity.userId, identity.generation]);
  const lifetime = useRef({ key, skill, mounted: false });
  if (lifetime.current.key !== key || lifetime.current.skill !== skill) lifetime.current = { key, skill, mounted: false };
  const ticket = lifetime.current;
  const [retrying, setRetrying] = useState<object | null>(null);
  const titleId = useId(), descriptionId = useId();
  const active = () => lifetime.current === ticket && ticket.mounted && isCurrent();
  useLayoutEffect(() => {
    ticket.mounted = true; composing.current = false; flight.current = null; setRetrying(null);
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => {
      const restoreFocus = lifetime.current === ticket && ticket.mounted && isCurrent();
      ticket.mounted = false; flight.current = null; element?.close();
      if (!restoreFocus) return;
      const target = returnFocusRef?.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [key, skill]);
  const close = () => { if (active() && !composing.current) onClose(); };
  const retry = async () => {
    if (!active() || composing.current || contents.loading || flight.current !== null) return;
    const token = {}; flight.current = token; setRetrying(ticket);
    try { await contents.retry(); }
    catch { /* The reader owns its visible error state. */ }
    finally { if (active() && flight.current === token) { flight.current = null; setRetrying(null); } }
  };
  const guardAction = (event: React.SyntheticEvent) => {
    if (!active()) { event.preventDefault(); event.stopPropagation(); }
  };
  const data = contents.data;
  const title = data?.interface?.display_name ?? skill.interface?.displayName ?? skill.name;
  const description = data?.description ?? skill.interface?.shortDescription ?? skill.description;
  const markdown = data === null ? undefined : data.skill_md_contents ?? null;
  return <dialog ref={dialog} className="pscd-dialog" aria-labelledby={titleId}
    aria-describedby={typeof description === "string" ? descriptionId : undefined} aria-busy={contents.loading}
    onCompositionStart={() => { if (active()) composing.current = true; }}
    onCompositionEnd={() => { if (active()) composing.current = false; }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onKeyUp={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (!active()) return;
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), focused = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && (focused === first || !event.currentTarget.contains(focused))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (focused === last || !event.currentTarget.contains(focused))) { event.preventDefault(); first.focus(); }
      }
    }} onClick={event => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <div className="pscd-layout">
      {typeof description === "string" && <span id={descriptionId} className="sr-only">{description}</span>}
      <header className="pscd-header">
        {/* The shared source fallback is reused; the official generated skill glyph remains unverified. */}
        <span className="pscd-icon" aria-hidden="true"><BookOpenIcon size={24} /></span>
        <h2 id={titleId}>{title}</h2>
        {headerActions && <div className="pscd-header-actions" onClickCapture={guardAction} onKeyDownCapture={guardAction}>{headerActions}</div>}
        <button type="button" className="pscd-close" aria-label="关闭" onClick={close}><CloseIcon /></button>
      </header>
      <div className="pscd-scroll">
        <dl className="pscd-metadata">
          <div><dt>名称</dt><dd>{data?.name ?? skill.name}</dd></div>
          <div><dt>描述</dt><dd>{description}</dd></div>
        </dl>
        <div className="pscd-body">
          {markdown === undefined && !contents.error && <div className="pscd-loading" role="status" aria-label="正在加载…"><span /><span /><span /></div>}
          {markdown === null && !contents.error && <div role="status">目前无法查看技能说明。你可能需要拥有插件编辑者、工作空间所有者或管理员权限才能查看。</div>}
          {typeof markdown === "string" && <MarkdownView content={markdown} remoteContent={true} />}
        </div>
      </div>
      {(contents.error || footer) && <footer className="pscd-footer">
        {contents.error && <><span role="alert">无法加载此技能</span>
          <button type="button" className="secondary-btn-sm" disabled={contents.loading || retrying === ticket} onClick={() => { void retry(); }}>重试</button></>}
        {footer && <div onClickCapture={guardAction} onKeyDownCapture={guardAction}>{footer}</div>}
      </footer>}
    </div>
  </dialog>;
}
