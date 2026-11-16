import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { loadPluginAppManagement, savePluginAppMetadata } from "../pluginAppManagement";
import { CloseIcon } from "./Icons";
import "./PluginAppMetadataDialog.css";

export type AppManagementSnapshot = Awaited<ReturnType<typeof loadPluginAppManagement>>;
export type AppMetadataOperation = "name" | "description";
export interface AppMetadataIntent {
  value: string;
  metadataId: string;
  identity: AppManagementSnapshot["identity"];
  phase: "unknown" | "confirmed";
}

export function PluginAppMetadataDialog({ scope, snapshot, operation, intent, isCurrent, onIntentChange, onReadback, onUpdated, onClose, returnFocusRef }: {
  scope: string; snapshot: AppManagementSnapshot; operation: AppMetadataOperation; intent: AppMetadataIntent | null;
  isCurrent: () => boolean; onIntentChange: (intent: AppMetadataIntent | null) => void; onReadback: (snapshot: AppManagementSnapshot) => void;
  onUpdated: () => Promise<void> | void; onClose: () => void; returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), composing = useRef(false), flight = useRef<object | null>(null), request = useRef<AbortController | null>(null);
  const key = JSON.stringify([scope, snapshot.metadata.id, operation, snapshot.identity]);
  const lifetime = useRef({ key, mounted: false });
  if (lifetime.current.key !== key) lifetime.current = { key, mounted: false };
  const ticket = lifetime.current;
  const [base, setBase] = useState(snapshot), [draft, setDraft] = useState(intent ? intent.value : snapshot.metadata[operation]);
  const [phase, setPhase] = useState<"edit" | "unknown" | "confirmed" | "preflight">(intent?.phase ?? "edit");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pendingIntent = useRef<AppMetadataIntent | null>(intent), titleId = useId();
  const active = () => lifetime.current === ticket && ticket.mounted && isCurrent();
  useLayoutEffect(() => {
    ticket.mounted = true; composing.current = false;
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => {
      const restore = lifetime.current === ticket && ticket.mounted && isCurrent();
      ticket.mounted = false; request.current?.abort(); flight.current = null; element?.close();
      if (!restore) return;
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      else if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [key]);
  const close = () => { if (active() && flight.current === null && !composing.current) onClose(); };
  const value = operation === "name" ? (draft ?? "").trim() : draft;
  const eligible = operation === "name" ? base.canEditName : base.canEditDescription;
  const dirty = value !== base.metadata[operation] && (operation !== "name" || typeof value === "string" && value.length > 0);
  const sameTarget = (actual: AppManagementSnapshot) => actual.metadata.id === snapshot.metadata.id &&
    actual.identity.accountId === snapshot.identity.accountId && actual.identity.userId === snapshot.identity.userId && actual.identity.generation === snapshot.identity.generation;
  const remember = (next: AppMetadataIntent | null) => { pendingIntent.current = next; onIntentChange(next); };
  const complete = async () => {
    setPhase("confirmed");
    if (pendingIntent.current) remember({ ...pendingIntent.current, phase: "confirmed" });
    try { await onUpdated(); }
    catch { if (active()) setError("更改已确认，但无法刷新应用。请重新刷新。"); return; }
    if (active()) { remember(null); onClose(); }
  };
  const readQualification = async (signal: AbortSignal) => {
    const actual = await loadPluginAppManagement(snapshot.appId, signal);
    if (!active() || signal.aborted || !sameTarget(actual)) throw Error("Changed scope");
    setBase(actual); onReadback(actual); setPhase("edit");
  };
  const run = async (readOnly: boolean) => {
    if (!active() || flight.current !== null || composing.current || (!readOnly && (phase !== "edit" || !eligible || !dirty))) return;
    const token = {}, controller = new AbortController(); flight.current = token; request.current = controller; setBusy(true);
    try {
      if (readOnly) {
        if (phase === "confirmed") await complete();
        else if (phase === "preflight") await readQualification(controller.signal);
        else {
          const actual = await loadPluginAppManagement(snapshot.appId, controller.signal);
          if (!active() || controller.signal.aborted) return;
          if (!sameTarget(actual) || actual.metadata[operation] !== pendingIntent.current?.value) { setError("更改结果尚未确认，请重新读取核验。"); return; }
          onReadback(actual); await complete();
        }
        return;
      }
      if (typeof value !== "string") return;
      remember({ value, metadataId: snapshot.metadata.id, identity: snapshot.identity, phase: "unknown" });
      const result = await savePluginAppMetadata(base, operation, value, controller.signal);
      if (!active() || controller.signal.aborted) return;
      if (result.delivery === "rejected") { remember(null); setPhase("edit"); setError("无法更新应用。请重试"); }
      else if (result.confirmed) { if (result.snapshot) onReadback(result.snapshot); await complete(); }
      else if (result.delivery === "not_sent") {
        remember(null); setPhase("preflight"); setError("无法更新应用。请重试");
        await readQualification(controller.signal);
      } else { setPhase("unknown"); setError("更改结果尚未确认，请重新读取核验。"); }
    } catch {
      if (!active() || controller.signal.aborted) return;
      if (!readOnly && pendingIntent.current) setPhase("unknown");
      setError(pendingIntent.current ? "更改结果尚未确认，请重新读取核验。" : "无法更新应用。请重试");
    } finally { if (lifetime.current === ticket && ticket.mounted && flight.current === token) { flight.current = null; request.current = null; setBusy(false); } }
  };
  const locked = busy || phase !== "edit";
  return <dialog ref={dialog} className="pamd-dialog" aria-labelledby={titleId} aria-busy={busy}
    onCompositionStart={() => { if (active()) composing.current = true; }} onCompositionEnd={() => { if (active()) composing.current = false; }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyUp={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation(); if (!active()) return;
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === "Enter" || event.key === "Escape") event.preventDefault(); return; }
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), focused = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && (focused === first || !event.currentTarget.contains(focused))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (focused === last || !event.currentTarget.contains(focused))) { event.preventDefault(); first.focus(); }
      }
    }} onClick={event => {
      event.stopPropagation(); if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void run(false); }}>
      <header className="pamd-header"><h2 id={titleId}>{operation === "name" ? "编辑应用名称" : "编辑应用描述"}</h2>
        {!busy && <button type="button" className="pamd-close" aria-label="关闭" onClick={close}><CloseIcon /></button>}
      </header>
      <div className="pamd-fields"><label><span>{operation === "name" ? "应用名称" : "应用描述"}</span>
        {operation === "name" ? <input autoFocus name="app-name" value={draft ?? ""} disabled={locked} onChange={event => { if (active() && flight.current === null && phase === "edit") setDraft(event.target.value); }} />
          : <textarea autoFocus name="app-description" placeholder="描述此应用的功能" value={draft ?? ""} disabled={locked} onChange={event => { if (active() && flight.current === null && phase === "edit") setDraft(event.target.value); }} />}
      </label>{error && <span role="alert" className="pamd-error">{error}</span>}</div>
      <footer className="pamd-footer"><button type="button" className="secondary-btn" disabled={busy} onClick={close}>取消</button>
        {phase !== "edit" && <button type="button" className="secondary-btn" disabled={busy} onClick={() => { void run(true); }}>{phase === "confirmed" ? "重新刷新" : phase === "preflight" ? "重新读取" : "重新核验"}</button>}
        <button type="submit" className="primary-btn" disabled={locked || !eligible || !dirty}>保存</button>
      </footer>
    </form>
  </dialog>;
}
