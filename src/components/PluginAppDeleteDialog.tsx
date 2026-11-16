import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadPluginAppManagement } from "../pluginAppManagement";
import { deletePluginApp, readPluginAppDeletionStatus, type PluginAppDeleteStatus } from "../pluginAppDeletion";
import { canonicalMcpAppId } from "../pluginManagementMcp";
import type { AppManagementSnapshot } from "./PluginAppMetadataDialog";
import { CloseIcon } from "./Icons";
import "./PluginAppDeleteDialog.css";

export interface AppDeleteIntent { metadataId: string; identity: AppManagementSnapshot["identity"]; phase: "unknown" | "confirmed" }

export function PluginAppDeleteDialog({ scope, snapshot, intent, isCurrent, onIntentChange, onReadback, onDeleted, onClose, returnFocusRef }: {
  scope: string; snapshot: AppManagementSnapshot; intent: AppDeleteIntent | null; isCurrent: () => boolean;
  onIntentChange: (intent: AppDeleteIntent | null) => void; onReadback: (snapshot: AppManagementSnapshot) => void;
  onDeleted: () => Promise<void>; onClose: () => void; returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), composing = useRef(false), flight = useRef<object | null>(null), request = useRef<AbortController | null>(null);
  const key = JSON.stringify([scope, snapshot.metadata.id, snapshot.identity]), lifetime = useRef({ key, mounted: false });
  if (lifetime.current.key !== key) lifetime.current = { key, mounted: false };
  const ticket = lifetime.current, titleId = useId(), warningId = useId();
  const [base, setBase] = useState(snapshot), [phase, setPhase] = useState<"edit" | "unknown" | "confirmed" | "preflight">(intent?.phase ?? "edit");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), pendingIntent = useRef(intent);
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
  const remember = (value: AppDeleteIntent | null) => { pendingIntent.current = value; onIntentChange(value); };
  const sameIdentity = (actual: AppManagementSnapshot) => actual.metadata.id === snapshot.metadata.id && actual.identity.accountId === snapshot.identity.accountId && actual.identity.userId === snapshot.identity.userId && actual.identity.generation === snapshot.identity.generation;
  const gone = (status: PluginAppDeleteStatus | null) => status !== null && status.metadataId === snapshot.metadata.id &&
    canonicalMcpAppId(status.appId) === canonicalMcpAppId(snapshot.appId) && status.presence === "not_found";
  const complete = async () => {
    setPhase("confirmed"); remember({ metadataId: snapshot.metadata.id, identity: snapshot.identity, phase: "confirmed" });
    try { await onDeleted(); }
    catch { if (active()) setError("当前账户已无法找到此应用，但无法刷新列表。请重新刷新。"); return; }
    if (active()) { remember(null); onClose(); }
  };
  const refreshQualification = async (signal: AbortSignal) => {
    const actual = await loadPluginAppManagement(snapshot.appId, signal);
    if (!active() || signal.aborted || !sameIdentity(actual)) throw Error("Changed scope");
    setBase(actual); onReadback(actual); setPhase("edit");
  };
  const run = async (readOnly: boolean) => {
    if (!active() || flight.current !== null || composing.current || (!readOnly && (phase !== "edit" || !base.canDelete || base.deleteDisabled))) return;
    const token = {}, controller = new AbortController(); flight.current = token; request.current = controller; setBusy(true);
    try {
      if (readOnly) {
        if (phase === "confirmed") await complete();
        else if (phase === "preflight") await refreshQualification(controller.signal);
        else {
          const status = await readPluginAppDeletionStatus(snapshot, controller.signal);
          if (!active() || controller.signal.aborted) return;
          if (gone(status)) await complete();
          else setError("删除结果尚未确认，请重新读取核验。");
        }
        return;
      }
      remember({ metadataId: snapshot.metadata.id, identity: snapshot.identity, phase: "unknown" });
      const result = await deletePluginApp(base, controller.signal);
      if (!active() || controller.signal.aborted) return;
      if (result.delivery === "rejected") { remember(null); setPhase("edit"); setError("无法更新应用。请重试"); }
      else if (result.confirmed && gone(result.readback)) await complete();
      else if (result.delivery === "not_sent") {
        remember(null); setPhase("preflight"); setError("无法更新应用。请重试");
        await refreshQualification(controller.signal);
      } else { setPhase("unknown"); setError("删除结果尚未确认，请重新读取核验。"); }
    } catch {
      if (!active() || controller.signal.aborted) return;
      if (!readOnly && pendingIntent.current) setPhase("unknown");
      setError(pendingIntent.current ? "删除结果尚未确认，请重新读取核验。" : "无法更新应用。请重试");
    } finally { if (lifetime.current === ticket && ticket.mounted && flight.current === token) { flight.current = null; request.current = null; setBusy(false); } }
  };
  return <dialog ref={dialog} className="padd-dialog" aria-labelledby={titleId} aria-describedby={warningId} aria-busy={busy}
    onCompositionStart={() => { if (active()) composing.current = true; }} onCompositionEnd={() => { if (active()) composing.current = false; }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyUp={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation(); if (!active()) return;
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === "Enter" || event.key === "Escape") event.preventDefault(); return; }
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'))
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
      <header className="padd-header"><h2 id={titleId}>删除应用</h2>
        <button type="button" className="padd-close" aria-label="关闭对话框" onClick={close}><CloseIcon /></button>
        <p id={warningId}>永久删除 {base.metadata.name} 及其连接？此操作无法撤消</p>
      </header>
      {(base.deleteRestriction || error) && <div className="padd-message" role="alert">
        {base.deleteRestriction === "tenant_catalog" && <p>删除此应用前，必须先将其从你的工作空间目录中移除</p>}
        {base.deleteRestriction === "content_unavailable" && <p>无法读取应用目录信息，请重新读取资格后重试。</p>}
        {error && <p>{error}</p>}
      </div>}
      <footer className="padd-footer"><button type="button" className="padd-ghost" disabled={busy} onClick={close}>取消</button>
        {phase !== "edit" && <button type="button" className="secondary-btn" disabled={busy} onClick={() => { void run(true); }}>{phase === "confirmed" ? "重新刷新" : phase === "preflight" ? "重新读取" : "重新核验"}</button>}
        <button type="submit" className="padd-danger" aria-busy={busy} disabled={busy || phase !== "edit" || !base.canDelete || base.deleteDisabled}>
          {busy && <span className="padd-loading" data-loading-indicator="" aria-hidden="true"><Loader2 size={12} className="pm-spin" /></span>}删除应用
        </button>
      </footer>
    </form>
  </dialog>;
}
