import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { SiteSlugState, validSiteSlug } from "../siteSlugState";
import { safeSiteUrl, type SiteRecord } from "../sitesService";
import type { SitesClientAccess } from "../sitesClient";
import type { SiteAssetRef } from "../chatgptService";
import "./SiteSlugSettings.css";

interface Props { access: SitesClientAccess; site: SiteRecord; canChange: boolean; hostedDomainSuffix?: string | null; scope: AbortSignal;
  onSite: (value: { site: SiteRecord; assets: SiteAssetRef[] }) => void; onError?: (message: string) => void }
export function SiteSlugSettings({ access, site, canChange, hostedDomainSuffix, scope, onSite, onError }: Props) {
  const state = useMemo(() => new SiteSlugState(access, site, scope, onSite, onError), [scope, access.identity.accountId, access.identity.userId, access.identity.generation, site.id]);
  state.onSite = onSite; state.onError = onError;
  const [, update] = useState(0), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), wasOpen = useRef(false);
  useEffect(() => { const unsubscribe = state.subscribe(() => update(value => value + 1)); state.attach(); const visibility = () => state.setVisible(document.visibilityState !== "hidden"); visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", visibility);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", visibility); state.dispose(); }; }, [state]);
  useEffect(() => state.hydrate(site), [state, site]);
  useEffect(() => { if (state.open) { if (!dialog.current?.open) dialog.current?.showModal(); input.current?.focus(); } else if (wasOpen.current) { dialog.current?.close(); trigger.current?.focus(); } wasOpen.current = state.open; }, [state.open]);
  const close = () => state.close();
  return <div className="sites-setting-row"><div>URL<p>{safeSiteUrl(state.site.hostedUrl ?? state.site.liveUrl) ?? "未发布"}</p>{state.pending && <p role="status">正在确认站点 URL 更改…</p>}</div>{canChange && <button ref={trigger} type="button" aria-label="更改托管站点 URL" disabled={Boolean(state.pending)} onClick={() => state.show()}>更改</button>}
    <dialog ref={dialog} className="site-slug-dialog" aria-labelledby="site-slug-title" aria-describedby="site-slug-description" onCancel={event => { event.preventDefault(); if (!state.busy) close(); }} onClick={event => { if (event.target === event.currentTarget && !state.busy) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
      <h2 id="site-slug-title">更改 URL</h2><p id="site-slug-description">为你的站点输入新的网址</p>{!state.busy && <button type="button" className="site-slug-close" aria-label="关闭" onClick={close}><X size={16} /></button>}
      <form onSubmit={event => { event.preventDefault(); void state.submit(); }}><div className="site-slug-input"><input ref={input} aria-label="站点 URL 名称" autoComplete="off" spellCheck={false} value={state.raw} disabled={state.busy} onChange={event => state.change(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />{hostedDomainSuffix && <span>{hostedDomainSuffix}</span>}</div>
        {state.normalized !== state.site.slug && !state.unknown && <p role="status">{!state.normalized ? "使用小写字母、数字或单个连字符，并以字母开头" : !validSiteSlug(state.normalized) ? "以字母开头，并使用小写字母、数字或单个连字符" : state.checking ? "正在检查可用性…" : state.available?.slug === state.normalized ? state.available.value ? "URL 可用" : "此 URL 不可用" : ""}</p>}
        {state.checkError && <p role="alert">无法检查可用性 <button type="button" onClick={() => void state.check()}>重试</button></p>}{state.error && <p role="alert">{state.error}</p>}
        <footer><button type="button" disabled={state.busy} onClick={close}>取消</button>{state.unknown ? <button type="button" disabled={state.busy} onClick={event => { event.preventDefault(); void state.recover(); }}>重新读取当前状态</button> : <button type="submit" disabled={!state.canSubmit}>更改 URL</button>}</footer>
      </form>
    </dialog>
  </div>;
}
