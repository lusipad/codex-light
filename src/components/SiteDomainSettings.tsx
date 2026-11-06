import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Clock, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { SiteDomainState } from "../siteDomainState";
import type { SitesClientAccess } from "../sitesClient";
import type { SiteDomain, SiteRecord } from "../sitesService";
import type { SiteAssetRef } from "../chatgptService";
import "./SiteDomainSettings.css";

interface Props { access: SitesClientAccess; siteId: string; domains: SiteDomain[]; scope: AbortSignal;
  onDomains: (domains: SiteDomain[]) => void; onSite: (value: { site: SiteRecord; assets: SiteAssetRef[] }) => void; onError?: (message: string) => void }
export function SiteDomainSettings({ access, siteId, domains, scope, onDomains, onSite, onError }: Props) {
  const state = useMemo(() => new SiteDomainState(access, siteId, domains, scope, onDomains, onSite, onError), [scope, siteId, access.identity.accountId, access.identity.userId, access.identity.generation]);
  state.onDomains = onDomains; state.onSite = onSite; state.onError = onError;
  const [, update] = useState(0), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLButtonElement | null>(null), wasOpen = useRef(false);
  useEffect(() => { const unsubscribe = state.subscribe(() => update(n => n + 1)); state.attach(); return () => { unsubscribe(); state.dispose(); }; }, [state]);
  useEffect(() => state.hydrate(domains), [state, domains]);
  const open = Boolean(state.selected);
  useEffect(() => { if (open) { if (!dialog.current?.open) dialog.current?.showModal(); cancel.current?.focus(); } else if (wasOpen.current) { dialog.current?.close(); trigger.current?.focus(); } wasOpen.current = open; }, [open]);
  const locked = state.busy || Boolean(state.unknown) || scope.aborted;
  return <section aria-label="自定义域名" className="site-domains">
    {state.domains.map(domain => <div key={domain.id} className="sites-setting-row"><span>自定义域名</span><div className="site-domain-controls"><div className="site-domain-details"><span className="site-domain-hostname" title={domain.hostname}>{domain.hostname}</span>
      {domain.status !== "active" && <span className={`site-domain-status ${domain.status === "failed" ? "site-domain-failed" : ""}`}>{domain.status === "pending" ? <Clock size={12} /> : <AlertCircle size={12} />}<span>{domain.status === "pending" ? "DNS 更改待处理。可能需要 24 小时才会生效。" : "DNS 设置未成功。请检查 DNS 记录。"}</span></span>}
      {domain.error && <span className="site-domain-error">上次错误：{domain.error}</span>}</div><div className="site-domain-actions">
        {domain.status !== "active" && <button type="button" aria-label={`刷新 ${domain.hostname} 状态`} aria-busy={state.refreshing === domain.id} disabled={locked} onClick={event => { event.preventDefault(); void state.refresh(domain); }}>{state.refreshing === domain.id ? <LoaderCircle size={16} /> : <RefreshCw size={16} />}</button>}
        <button type="button" aria-label={`移除 ${domain.hostname}`} disabled={locked} onClick={event => { event.preventDefault(); trigger.current = event.currentTarget; state.select(domain); }}><Trash2 size={16} /></button>
      </div></div></div>)}
    {state.error && !open && <p role="alert">{state.error}</p>}
    {state.unknown && !open && <button type="button" disabled={state.busy || scope.aborted} onClick={event => { event.preventDefault(); void state.recover(); }}>重新读取当前域名</button>}
    {state.metadataError && <p role="alert">无法读取站点最新信息 <button type="button" disabled={state.busy || scope.aborted} onClick={event => { event.preventDefault(); void state.retryMetadata(); }}>重试</button></p>}
    <dialog ref={dialog} className="site-domain-dialog" aria-labelledby="site-domain-title" aria-describedby="site-domain-description" onCancel={event => { event.preventDefault(); event.stopPropagation(); state.close(); }} onClick={event => { if (event.target !== event.currentTarget || state.busy) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) state.close(); }}>
      <form onSubmit={event => { event.preventDefault(); void state.remove(); }}><h2 id="site-domain-title">移除 {state.selected?.hostname}？</h2><p id="site-domain-description">访客将无法再使用此域名访问该站点</p>
        {!state.busy && <button type="button" className="site-domain-close" aria-label="关闭" onClick={() => state.close()}><X size={16} /></button>}
        {state.error && <p role="alert">{state.error}</p>}
        <footer><button ref={cancel} type="button" disabled={state.busy} onClick={() => state.close()}>取消</button>{state.unknown ? <button key="recover" type="button" disabled={state.busy || scope.aborted} onClick={event => { event.preventDefault(); void state.recover(); }}>重新读取当前域名</button> : <button key="remove" type="submit" className="site-domain-danger" disabled={state.busy || scope.aborted}>{state.busy ? "移除中…" : "移除"}</button>}</footer>
      </form>
    </dialog>
  </section>;
}
