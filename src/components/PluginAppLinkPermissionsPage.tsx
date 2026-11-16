import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { pluginAppPermissionAccounts, pluginAppLinkPermissionOptions, type PluginAppPermissionAccount } from "../pluginAppLinkPermissions";
import { usePluginAppLinkPermissions } from "../pluginAppLinkPermissionsState";
import type { PluginPermission } from "../pluginPermissions";
import { tauriInvoke } from "../bridge";
import "./PluginManagementDetail.css";
import "./PluginPermissionsSettings.css";
import "./PluginAppLinkPermissionsPage.css";

const helpUrl = "https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt#:~:text=App%20permission%20settings%20determine";
const compact = (value: PluginPermission) => ({ always_ask: "始终询问", ask_before_writes: "只读", review_important_actions: "允许低风险操作", full_access: "全部允许" })[value];
function picture(value: string | null) {
  if (!value || /[\x00-\x20]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function accountCopy(account: PluginAppPermissionAccount) {
  const image = picture(account.avatarUrl);
  return <><span className="palp-avatar" aria-hidden="true"><span>{Array.from(account.identity)[0] ?? ""}</span>
    {image && <img key={image} src={image} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}</span>
    <span className="palp-account-copy"><span>{account.identity}</span>{account.nickname && <span className="palp-nickname">{account.nickname}</span>}</span></>;
}
export function PluginAppLinkPermissionsPage({ connectionIdentity, pluginId, appId, selectedLinkId, onSelectLink, onRoot, onPlugin, onUnavailable }: {
  connectionIdentity: string; pluginId: string; appId: string | null; selectedLinkId: string | null;
  onSelectLink: (id: string | null) => boolean; onRoot: () => void; onPlugin: () => void; onUnavailable: (kind: "plugin" | "detail") => void;
}) {
  const { state, reload, change, retryFailed, clearErrors } = usePluginAppLinkPermissions(connectionIdentity, pluginId, appId);
  const [mode, setMode] = useState<boolean | null>(null), [localPending, setLocalPending] = useState(false), [linkError, setLinkError] = useState<string | null>(null);
  const scope = JSON.stringify([connectionIdentity, pluginId, appId, state?.snapshot?.appId ?? null]), token = useRef({ scope }), flight = useRef<object | null>(null), mounted = useRef(false);
  if (token.current.scope !== scope) token.current = { scope };
  const generation = token.current, latest = useRef({ state, selectedLinkId }); latest.current = { state, selectedLinkId };
  const viewToken = useRef({ generation, selectedLinkId, mode });
  if (viewToken.current.generation !== generation || viewToken.current.selectedLinkId !== selectedLinkId || viewToken.current.mode !== mode) viewToken.current = { generation, selectedLinkId, mode };
  const view = viewToken.current, active = () => mounted.current && token.current === generation && viewToken.current === view;
  const busyNow = () => latest.current.state?.pending || latest.current.state?.loading || flight.current !== null;
  const id = useId(), snapshot = state?.snapshot, accounts = snapshot ? pluginAppPermissionAccounts(snapshot) : [], defaultValue = snapshot?.defaultValue;
  const targets = selectedLinkId === null ? accounts : accounts.filter(account => account.linkId === selectedLinkId), selected = accounts.find(account => account.linkId === selectedLinkId);
  const effective = (account: PluginAppPermissionAccount) => account.permission ?? defaultValue;
  const uniform = accounts.length > 0 && accounts.every(account => effective(account) === effective(accounts[0]));
  const list = selectedLinkId === null && !(mode ?? uniform), editable = targets.length > 0 && targets.every(account => account.editable);
  const value = targets.length > 0 && targets.every(account => effective(account) === effective(targets[0])) ? effective(targets[0]) : null;
  const busy = Boolean(state?.pending || state?.loading || localPending), canWrite = editable && !busy && !state?.blocked && defaultValue != null;
  useLayoutEffect(() => { mounted.current = true; flight.current = null; setMode(null); setLocalPending(false); setLinkError(null); return () => { mounted.current = false; flight.current = null; }; }, [generation]);
  useEffect(() => { const before = document.title; document.title = "权限"; return () => { document.title = before; }; }, []);
  useEffect(() => { if (state?.unavailable && active()) onUnavailable(state.unavailable); }, [state?.unavailable, generation]);
  const run = async (operation: () => Promise<unknown>, writing = false) => {
    if (!active() || busyNow() || writing && latest.current.state?.blocked) return;
    const request = {}; flight.current = request; setLocalPending(true);
    try { await operation(); } finally { if (mounted.current && token.current === generation && flight.current === request) { flight.current = null; setLocalPending(false); } }
  };
  const select = (linkId: string | null) => {
    if (!active() || busyNow() || linkId !== null && !accounts.some(account => account.linkId === linkId && account.editable)) return;
    if (!onSelectLink(linkId)) return; clearErrors(); if (linkId === null) setMode(false);
  };
  const write = (next: PluginPermission | null) => {
    if (!active() || !canWrite || busyNow() || !targets.some(account => account.permission !== next)) return;
    if (selectedLinkId === null && accounts.length > 1) setMode(true);
    void run(() => change(targets.map(account => account.linkId), next), true);
  };
  const error = state?.failedLinkIds.length ? `无法保存 ${state.failedLinkIds.length} 个账户的权限` : state?.error || state?.refreshError || snapshot?.defaultError;
  const unknown = Boolean(state?.pendingLinkIds.length);
  return <article key={scope} className="pmd-detail pm-permissions-page palp-page" aria-busy={busy} onKeyDown={event => {
    if ((event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) && ["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航"><button type="button" disabled={busy} onClick={() => { if (active() && !busyNow()) onRoot(); }}>插件设置</button>
      {snapshot && <><span aria-hidden="true">/</span><button type="button" disabled={busy} onClick={() => { if (active() && !busyNow()) onPlugin(); }}>{snapshot.details.pluginName}</button></>}
      <span aria-hidden="true">/</span><span aria-current="page">权限</span></nav>
    <header className="pmd-header"><div className="pmd-heading"><h1>权限</h1></div></header>
    {(!state || state.loading && !snapshot) && <p role="status">正在加载…</p>}
    {snapshot?.access === "allowed" && defaultValue != null && <>
      {selectedLinkId !== null && <button type="button" className="palp-back" disabled={busy} onClick={() => select(null)}><ArrowLeft size={16} aria-hidden="true" />返回已关联账户</button>}
      {selectedLinkId === null && accounts.length > 1 && <div className="palp-mode"><span>应用于所有账户</span><button type="button" role="switch" aria-label="应用于所有账户" aria-checked={mode ?? uniform}
        disabled={busy} onClick={() => { if (!active() || busyNow()) return; setMode(!(mode ?? uniform)); clearErrors(); }}><span /></button></div>}
      {list ? <section className="palp-accounts"><h2>已连接的账户</h2>{accounts.map(account => <button key={account.linkId} type="button" className="palp-account" disabled={busy || !account.editable}
        onClick={() => select(account.linkId)}>{accountCopy(account)}<span className="palp-compact">{compact(effective(account)!)}</span><ChevronRight size={16} aria-hidden="true" /></button>)}</section>
        : <>
          {selected && <div className="palp-account palp-selected">{accountCopy(selected)}</div>}
          {!editable && <p role="alert">无法更改一个或多个账户的权限。请选择可用账户，或在应用设置中重新连接相应账户</p>}
          <section className="palp-permissions"><header><div><h2>权限</h2><p>选择 ChatGPT 在哪些情况下需要你的批准才能使用工具</p></div>
            {targets.some(account => account.permission != null) && <button type="button" className="secondary-btn-sm" disabled={!canWrite} onClick={() => write(null)}>重置为默认设置</button>}</header>
            <fieldset aria-label="权限" disabled={!canWrite}>{pluginAppLinkPermissionOptions.map(option => <label key={option.value} className="palp-option">
              <input type="radio" name={`${id}-permission`} value={option.value} checked={value === option.value}
                aria-label={`${option.label}${defaultValue === option.value ? "，默认" : ""}${option.value === "full_access" ? "，风险较高" : ""}`}
                readOnly onClick={() => write(option.value)} />
              <span className="palp-option-copy"><span className="palp-option-label">{option.label}{defaultValue === option.value && <span className="palp-badge">默认</span>}{option.value === "full_access" && <span className="palp-badge">风险较高</span>}</span>
                <span className="palp-option-description">{option.description}</span></span></label>)}</fieldset>
            {value == null && editable && <p>这些账户的权限不同。请选择一项权限，将其应用于当前所有已连接的账户</p>}
            <footer><a href={helpUrl} onClick={event => {
              event.preventDefault(); if (!active()) return; setLinkError(null);
              void tauriInvoke("review_link_open", { url: helpUrl }).catch(() => { if (active()) setLinkError("无法打开链接。请重试。"); });
            }}>了解更多关于插件权限的信息</a></footer>
          </section>
        </>}
    </>}
    {(unknown || error || snapshot && defaultValue == null && !state?.loading) && <div role="alert">
      {state?.failedLinkIds.length ? <p>{error}</p> : !unknown && <p>无法加载插件设置</p>}
      {unknown && <p>账户权限保存结果尚未确认，请重新读取后核对。</p>}
      <button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => { void run(() => !unknown && state?.failedLinkIds.length && !state.blocked ? retryFailed() : reload()); }}>{unknown ? "重新读取" : "重试"}</button></div>}
    {linkError && <p role="alert">{linkError}</p>}
  </article>;
}
