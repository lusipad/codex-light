import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CloseIcon } from "./Icons";
import { pluginAppSyncBadge, pluginAppSyncUpdatedAt, pluginAppSyncCanDisable, type PluginAppSyncStatus } from "../pluginAppSync";
import { usePluginAppSync } from "../pluginAppSyncState";
import "./PluginManagementDetail.css";
import "./AddPluginMarketplaceDialog.css";
import "./PluginAppSyncPage.css";

const statusKey = (status: PluginAppSyncStatus) => {
  const value = status.user_connection_details;
  return JSON.stringify([value.auth_status, value.connector_id, value.backing_link_id, value.connection_instance_id, value.connection_type, value.knowledge_connector_type]);
};
export function PluginAppSyncPage({ connectionIdentity, pluginId, appId, selectedLinkId, onRoot, onPlugin, onUnavailable, onUpdated }: {
  connectionIdentity: string; pluginId: string; appId: string | null; selectedLinkId: string | null;
  onRoot: () => void; onPlugin: () => void; onUnavailable: () => void;
  onUpdated?: () => void;
}) {
  const { state, reload, disable } = usePluginAppSync(connectionIdentity, pluginId, appId, selectedLinkId);
  const snapshot = state.snapshot, identity = snapshot?.identity;
  const scope = JSON.stringify([connectionIdentity, pluginId, appId, selectedLinkId, snapshot?.appId ?? null, identity?.accountId, identity?.userId, identity?.generation]);
  const generationRef = useRef({ scope }), mounted = useRef(false), sequence = useRef(0), flight = useRef<object | null>(null);
  if (generationRef.current.scope !== scope) generationRef.current = { scope };
  const generation = generationRef.current;
  const [confirmation, setConfirmation] = useState<{ generation: typeof generation; key: string; token: number } | null>(null);
  const [ack, setAck] = useState(false), [localPending, setLocalPending] = useState(false), [localError, setLocalError] = useState<string | null>(null);
  const selection = confirmation?.generation === generation ? confirmation : null;
  const current = useRef({ state, selection }); current.current = { state, selection };
  const active = () => mounted.current && generationRef.current === generation;
  const modalActive = () => active() && selection !== null && current.current.selection?.token === selection.token;
  const dialog = useRef<HTMLDialogElement>(null), checkbox = useRef<HTMLInputElement>(null), composing = useRef(false), id = useId();
  const busy = state.pending || localPending, busyNow = () => current.current.state.pending || flight.current !== null;
  const actual = selection ? snapshot?.statuses.find(status => statusKey(status) === selection.key) : undefined;
  const eligible = actual && snapshot && pluginAppSyncCanDisable(actual, snapshot.account, snapshot.identity.accountId);
  useLayoutEffect(() => {
    mounted.current = true; flight.current = null; composing.current = false; setConfirmation(null); setAck(false); setLocalPending(false); setLocalError(null);
    return () => { mounted.current = false; flight.current = null; };
  }, [generation]);
  useEffect(() => { const before = document.title; document.title = "同步"; return () => { document.title = before; }; }, []);
  useEffect(() => { if (state.unavailable && active()) onUnavailable(); }, [generation, state.unavailable]);
  useLayoutEffect(() => {
    if (!selection) return;
    const previous = document.activeElement as HTMLElement | null, element = dialog.current;
    element?.showModal(); checkbox.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [selection?.token, generation]);
  const close = () => {
    if (!modalActive() || busyNow() || composing.current) return;
    current.current.selection = null; setConfirmation(null); setAck(false); setLocalError(null);
  };
  const open = (status: PluginAppSyncStatus) => {
    const latest = current.current.state, data = latest.snapshot;
    if (!active() || latest.loading || latest.blocked || latest.uncertain || busyNow() || current.current.selection || !data) return;
    const key = statusKey(status), matches = data.statuses.filter(item => statusKey(item) === key);
    if (matches.length !== 1 || !pluginAppSyncCanDisable(matches[0], data.account, data.identity.accountId)) return;
    const next = { generation, key, token: ++sequence.current };
    current.current.selection = next; setAck(false); setLocalError(null); setConfirmation(next);
  };
  const run = async (reading: boolean) => {
    const latest = current.current.state, data = latest.snapshot;
    if (!active() || busyNow() || latest.loading || !reading && (!modalActive() || !ack || composing.current || latest.blocked || latest.uncertain || !data)) return;
    const matches = selection && data ? data.statuses.filter(item => statusKey(item) === selection.key) : [];
    if (!reading && (matches.length !== 1 || !pluginAppSyncCanDisable(matches[0], data!.account, data!.identity.accountId))) return;
    const request = {}; flight.current = request; setLocalPending(true); setLocalError(null);
    try {
      if (reading) await reload();
      else if (await disable(matches[0]) && modalActive()) { current.current.selection = null; setConfirmation(null); setAck(false); onUpdated?.(); }
    } catch { if (active()) setLocalError(reading ? "无法加载插件设置" : "无法禁用同步。请重试"); }
    finally { if (active() && flight.current === request) { flight.current = null; setLocalPending(false); } }
  };
  const error = localError || state.error;
  const recovery = state.uncertain ? "同步操作结果尚未确认，请重新读取后核对。" : error;
  return <article key={scope} className="pmd-detail pas-page" aria-busy={state.loading || busy}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航"><button type="button" disabled={busy} onClick={() => { if (active() && !busyNow()) onRoot(); }}>插件设置</button>
      {snapshot && <><span aria-hidden="true">/</span><button type="button" disabled={busy} onClick={() => { if (active() && !busyNow()) onPlugin(); }}>{snapshot.details.pluginName}</button></>}
      <span aria-hidden="true">/</span><span aria-current="page">同步</span></nav>
    <header className="pmd-header"><div className="pmd-heading"><h1>同步</h1></div></header>
    {state.loading && !snapshot && <p role="status">正在加载…</p>}
    {snapshot && !state.loading && !state.error && <p className="pmd-description">同步的内容可用于回答问题和查找信息</p>}
    {snapshot && <section className="pas-statuses" aria-label="同步状态">{snapshot.statuses.length === 0 ? <div className="pas-status-row">未同步</div> : snapshot.statuses.map((status, index) => {
      const details = status.user_connection_details, badge = pluginAppSyncBadge(details.activation_status), updated = pluginAppSyncUpdatedAt(status);
      const date = updated == null ? null : new Date(updated), formatted = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(document.documentElement?.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date) : null;
      return <div className="pas-status-row" key={`${statusKey(status)}:${index}`}><div className="pas-status-copy"><span className={`pas-badge pas-badge-${badge.variant}`}>{badge.label}</span>
        {formatted && <span className="pas-updated">最后更新于 <time dateTime={date!.toISOString()}>{formatted}</time></span>}</div>
        {details.auth_status === "user_connected" ? <button type="button" className="pas-disable" disabled={state.loading || busy || state.blocked || !pluginAppSyncCanDisable(status, snapshot.account, snapshot.identity.accountId)} onClick={() => open(status)}>禁用同步</button>
          : <span className="pas-admin">由管理员管理</span>}</div>;
    })}</section>}
    {recovery && !selection && <div role="alert"><p>{state.uncertain ? recovery : "无法加载插件设置"}</p><button type="button" className="secondary-btn-sm" disabled={state.loading || busy} onClick={() => { void run(true); }}>{state.uncertain ? "重新读取" : "重试"}</button></div>}
    {selection && <dialog key={`${scope}:${selection.token}`} ref={dialog} className="apm-dialog pas-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCompositionStart={() => { if (modalActive()) composing.current = true; }} onCompositionEnd={() => { if (modalActive()) composing.current = false; }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      } }} onKeyUp={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation(); if (!modalActive()) return;
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (["Enter", "Escape", " "].includes(event.key)) event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')).filter(element => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1), focused = event.currentTarget.ownerDocument.activeElement;
          if (!first) event.preventDefault();
          else if (event.shiftKey && (focused === first || !event.currentTarget.contains(focused))) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (focused === last || !event.currentTarget.contains(focused))) { event.preventDefault(); first.focus(); }
        }
      }}>
      <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void run(false); }}>
        <header className="apm-header"><h2 id={`${id}-title`}>禁用同步</h2><button type="button" className="apm-close" aria-label="关闭" onClick={close}><CloseIcon /></button>
          <p id={`${id}-description`}>停止同步此账户并移除其已同步内容？其他已关联账户不会受到影响</p></header>
        <div className="apm-fields"><label className="pas-ack"><input ref={checkbox} autoFocus type="checkbox" checked={ack} disabled={busy} onChange={event => { if (modalActive() && !busyNow()) setAck(event.target.checked); }} />我了解同步的内容将被移除</label>
          {recovery && <div role="alert"><p>{state.uncertain ? recovery : "无法禁用同步。请重试"}</p>{state.uncertain && <button type="button" className="secondary-btn-sm" disabled={state.loading || busy} onClick={() => { if (modalActive()) void run(true); }}>重新读取</button>}</div>}</div>
        <footer className="apm-footer"><button type="button" className="secondary-btn" disabled={busy} onClick={close}>取消</button>
          <button type="submit" className="pas-danger" disabled={!ack || busy || state.loading || state.blocked || state.uncertain || !eligible} aria-busy={busy}>{busy && <Loader2 size={14} className="pm-spin" aria-hidden="true" />}禁用同步</button></footer>
      </form>
    </dialog>}
  </article>;
}
