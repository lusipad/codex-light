import React, { useLayoutEffect, useRef, useState } from "react";
import { CloseIcon } from "./Icons";
import "./AddPluginMarketplaceDialog.css";
import "./PluginAccountRenameDialog.css";

export function PluginAccountRenameDialog({ identity, linkId, accountIdentity, initialNickname, currentName, pending, blocked, error, onSave, onRetry, onClose }: {
  identity: string; linkId: string; accountIdentity: string; initialNickname: string; currentName: string;
  pending: boolean; blocked: boolean; error: string | null;
  onSave: (name: string) => Promise<boolean>; onRetry: () => void | Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialNickname), [validation, setValidation] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), epoch = useRef(0), flight = useRef<number | null>(null), composing = useRef(false);
  const scope = JSON.stringify([identity, linkId]), latest = useRef({ scope, pending, blocked, version: 0, mounted: false });
  const renderVersion = latest.current.version + (latest.current.scope === scope ? 0 : 1);
  latest.current = { scope, pending, blocked, version: renderVersion, mounted: latest.current.mounted };
  const active = () => latest.current.mounted && latest.current.scope === scope && latest.current.version === renderVersion;
  useLayoutEffect(() => {
    latest.current.mounted = true;
    const version = ++epoch.current, previous = document.activeElement as HTMLElement | null, element = dialog.current;
    flight.current = null; composing.current = false; setSaving(false); setDraft(initialNickname); setValidation(null);
    element?.showModal(); input.current?.focus();
    return () => { latest.current.mounted = false; if (epoch.current === version) { epoch.current++; flight.current = null; } element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [scope]);
  const valid = (version: number) => active() && epoch.current === version;
  const busy = pending || saving, trimmed = draft.trim(), changed = trimmed !== initialNickname && trimmed !== currentName.trim();
  const close = () => { if (active() && !latest.current.pending && flight.current === null && !composing.current) onClose(); };
  const run = async (retry: boolean) => {
    if (!active() || latest.current.pending || flight.current !== null || composing.current || (!retry && (latest.current.blocked || !changed))) return;
    if (!retry) {
      if (!trimmed) { setValidation("请输入账户昵称"); return; }
      if (Array.from(trimmed).length > 64) { setValidation("昵称不得超过 64 个字符"); return; }
    }
    const version = epoch.current; flight.current = version; setSaving(true); setValidation(null);
    try { if (retry) await onRetry(); else if (await onSave(trimmed) && valid(version)) onClose(); }
    catch { if (valid(version)) setValidation(retry ? "无法刷新账户，请重试" : "无法重命名账户"); }
    finally { if (valid(version) && flight.current === version) { flight.current = null; setSaving(false); } }
  };
  return <dialog ref={dialog} className="apm-dialog par-dialog" aria-labelledby="plugin-account-rename-title" aria-describedby="plugin-account-rename-identity"
    onClick={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget && event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }
    }} onKeyUp={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onCompositionStart={() => { if (active()) composing.current = true; }} onCompositionEnd={() => { if (active()) composing.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if (!active()) return;
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (["Enter", "Escape"].includes(event.key)) event.preventDefault(); return; }
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), active = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) { event.preventDefault(); first.focus(); }
      }
    }}>
    <form noValidate onSubmit={event => { event.preventDefault(); event.stopPropagation(); void run(false); }}>
      <header className="apm-header"><h2 id="plugin-account-rename-title">重命名账户</h2>
        <button type="button" className="apm-close" aria-label="关闭" onClick={close}><CloseIcon /></button>
        <p id="plugin-account-rename-identity">{accountIdentity}</p></header>
      <div className="apm-fields"><label htmlFor="plugin-account-nickname">昵称
        <input ref={input} autoFocus id="plugin-account-nickname" name="plugin-account-nickname" placeholder="添加昵称" value={draft} disabled={busy}
          aria-invalid={validation !== null} aria-describedby={validation || error ? "plugin-account-rename-error" : undefined}
          onChange={event => { if (active() && !latest.current.pending && flight.current === null) { setDraft(event.target.value); setValidation(null); } }} />
      </label>{(validation || error) && <div id="plugin-account-rename-error" role="alert" className="apm-error">{validation || error}</div>}
      {blocked && <button type="button" className="secondary-btn" disabled={busy} onClick={() => { void run(true); }}>重试</button>}</div>
      <footer className="apm-footer"><button type="button" className="secondary-btn" disabled={busy} onClick={close}>取消</button>
        <button type="submit" className="primary-btn" disabled={busy || blocked || !changed} aria-busy={busy}>保存</button></footer>
    </form>
  </dialog>;
}
