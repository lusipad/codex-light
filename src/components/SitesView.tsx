import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ellipsis, ExternalLink, Globe, Grid2X2, List, Pin, Plus, Search, X } from "lucide-react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage, type SiteAssetRef } from "../chatgptService";
import { readSitesAccess, readSitesPage, readSiteDetail, readSiteSettings, readSiteDomainSettings, readSiteScreenshot, readSitePin, setSitePinned,
  type SitesClientAccess, type SitesClientPage, type SitesListKind } from "../sitesClient";
import { filterSites, mergeSites, safeSiteUrl, siteRole, type SiteRecord } from "../sitesService";
import { parseSitesLocation, sitesLocationUrl, type SitesLocation, type SitesNavigation } from "../sitesNavigation";
import { LibraryStickyHeader } from "./LibraryStickyHeader";
import { ThreadActionsMenu, type ThreadActionItem } from "./ThreadActionsMenu";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { SiteDomainSettings } from "./SiteDomainSettings";
import { waitForSiteSettingsWrites, trackRequest } from "../siteSettingsState";
import type { SiteSharingPolicy } from "../siteSharingData";
import "./SitesView.css";

type Page = SitesClientPage & { loaded: boolean; loading: boolean; paging: boolean; error: string | null; pageError: string | null; query: string };
const emptyPage = (): Page => ({ items: [], cursor: null, assets: [], loaded: false, loading: false, paging: false, error: null, pageError: null, query: "" });
const emptyPages = (): Record<SitesListKind, Page> => ({ owned: emptyPage(), shared: emptyPage(), pinned: emptyPage() });
const rootLocation: SitesLocation = { view: "owned", siteId: null, search: "" };
export function siteSharingText(site: SiteRecord): string {
  const value = site.sharing;
  if (value.accessMode === "public") return "所有人";
  if (value.accessMode === "workspace") return "你的工作区";
  if (value.countsAvailable === false) return "受限";
  if (["admins_only", "custom"].includes(value.accessMode) && value.userCount === 0 && value.groupCount === 0) return "仅自己可见";
  if (value.userCount > 0 && value.groupCount > 0) return "人员和群组";
  if (value.groupCount > 0) return `${value.groupCount} 个群组`;
  return `${value.userCount} 人`;
}
export function siteUpdatedText(updatedAt: string, now = Date.now()): string {
  const date = new Date(updatedAt), minutes = Math.max(1, Math.floor((now - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} 小时前`;
  const today = new Date(now); today.setHours(0, 0, 0, 0); const day = new Date(date); day.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today.getTime() - day.getTime()) / 86400000)) === 1 ? "昨天" : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
export function SiteScreenshot({ site, assets, access, scope }: { site: SiteRecord; assets: SiteAssetRef[]; access: SitesClientAccess; scope: AbortSignal }) {
  const asset = assets.find(value => value.id === site.id);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const key = JSON.stringify([access.identity, asset?.assetKey, asset?.sourceRequestId, site.screenshotUrl]);
  useEffect(() => {
    const controller = new AbortController(); const abort = () => { controller.abort(); setImage(null); };
    scope.addEventListener("abort", abort, { once: true }); setImage(null);
    if (asset && site.screenshotUrl && !scope.aborted) void readSiteScreenshot(asset, access, controller.signal).then(url => {
      if (!controller.signal.aborted && !scope.aborted) setImage({ key, url });
    }).catch(() => { if (!controller.signal.aborted) setImage(null); });
    return () => { controller.abort(); scope.removeEventListener("abort", abort); };
  }, [key, scope]);
  return <div className="sites-screenshot">{image?.key === key && !scope.aborted ? <img src={image.url} alt="" loading="lazy" onError={() => setImage(null)} /> : <Globe size={22} aria-hidden="true" />}</div>;
}
interface SitesViewProps { collectionNavigation?: boolean; onNavigationChange?: (navigation: SitesNavigation | null) => void; onSaveError?: (message: string) => void }
export const SitesView: React.FC<SitesViewProps> = ({ collectionNavigation = false, onNavigationChange, onSaveError }) => {
  const [revision, setRevision] = useState(0), [access, setAccess] = useState<SitesClientAccess | null>(null);
  const accessRef = useRef<SitesClientAccess | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [location, setLocation] = useState<SitesLocation>(() => parseSitesLocation(window.location.href, collectionNavigation) ?? rootLocation);
  const locationRef = useRef(location); locationRef.current = location;
  const navIndex = useRef(0), navLength = useRef(1), [historyVersion, setHistoryVersion] = useState(0);
  const [pages, setPages] = useState(emptyPages); const pagesRef = useRef(pages); pagesRef.current = pages;
  const [listRevision, setListRevision] = useState(0);
  const sources = useRef<Partial<Record<SitesListKind, AbortController>>>({});
  const cursors = useRef<Record<SitesListKind, string[]>>({ owned: [], shared: [], pinned: [] });
  const paging = useRef(new Set<SitesListKind>());
  const source = useRef<AbortController | null>(null), detailSource = useRef<AbortController | null>(null);
  const settingsWriteScope = useRef<AbortController | null>(null);
  const [detail, setDetail] = useState<{ site: SiteRecord; assets: SiteAssetRef[] } | null>(null), [detailError, setDetailError] = useState<string | null>(null), [detailRevision, setDetailRevision] = useState(0);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof readSiteSettings>> | null>(null), [settingsLoading, setSettingsLoading] = useState(false);
  const settingsPending = useRef(false);
  const [domainsLoading, setDomainsLoading] = useState(false), domainsPending = useRef(false), domainRequest = useRef(0);
  const sharingRequest = useRef(0);
  const [pins, setPins] = useState<Record<string, { value: boolean | null; pending: boolean; unconfirmed: boolean; error: string | null }>>({});
  const pinBusy = useRef(new Set<string>()), unconfirmedPins = useRef(new Set<string>());
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => localStorage.getItem("sites-view-mode") === "grid" ? "grid" : "list");
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLDivElement>(null), detailHeading = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLElement>()), restoreFocus = useRef<string | null>(null);
  const sharedAvailable = Boolean(access?.workspace || access?.editable);
  const kinds: SitesListKind[] = location.view === "all" ? ["owned", "shared"] : [location.view];
  const serverQuery = location.view === "pinned" || ["shared", "all"].includes(location.view) && access?.workspace ? location.search.trim() : "";
  const navigate = useCallback((next: SitesLocation, replace = false) => {
    const index = replace ? navIndex.current : navIndex.current + 1;
    if (!replace) navLength.current = index + 1;
    navIndex.current = index;
    window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, sitesIndex: index }, "", sitesLocationUrl(window.location.href, next, collectionNavigation));
    locationRef.current = next; setLocation(next); setHistoryVersion(value => value + 1);
  }, [collectionNavigation]);
  const back = useCallback(() => window.history.back(), []), forward = useCallback(() => window.history.forward(), []);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, sitesIndex: 0 }, "", sitesLocationUrl(window.location.href, locationRef.current, collectionNavigation));
    const pop = (event: PopStateEvent) => {
      const next = parseSitesLocation(window.location.href, collectionNavigation); if (!next) return;
      navIndex.current = Number.isInteger(event.state?.sitesIndex) ? event.state.sitesIndex : 0;
      locationRef.current = next; setLocation(next); setHistoryVersion(value => value + 1);
    };
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, [collectionNavigation]);
  useEffect(() => { onNavigationChange?.({ canGoBack: navIndex.current > 0, canGoForward: navIndex.current + 1 < navLength.current, back, forward }); }, [historyVersion, back, forward, onNavigationChange]);
  useEffect(() => () => onNavigationChange?.(null), [onNavigationChange]);
  const abortLists = () => Object.values(sources.current).forEach(controller => controller?.abort());
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined;
    const controller = new AbortController(); source.current = controller;
    const writes = new AbortController(); settingsWriteScope.current = writes;
    accessRef.current = null; abortLists(); detailSource.current?.abort(); setAccess(null); setPages(emptyPages()); setDetail(null); setSettings(null); setError(null); setLoading(true); setNotice(null); setPins({});
    pinBusy.current.clear(); unconfirmedPins.current.clear(); cursors.current = { owned: [], shared: [], pinned: [] }; paging.current.clear();
    void (async () => {
      try {
        const stop = await tauriListen("chatgpt-service:invalidated", () => {
          writes.abort(); if (disposed) return; controller.abort(); abortLists(); detailSource.current?.abort(); accessRef.current = null;
          setAccess(null); setPages(emptyPages()); setDetail(null); setSettings(null); setPins({}); setRevision(value => value + 1);
        });
        if (disposed) { stop(); return; } unlisten = stop;
        const current = await readSitesAccess(controller.signal); if (controller.signal.aborted) return;
        accessRef.current = current; setAccess(current); setLoading(false);
        const selected = locationRef.current;
        if ((!current.pinned && selected.view === "pinned") || (!(current.workspace || current.editable) && ["shared", "all"].includes(selected.view))) navigate({ ...selected, view: "owned", search: "" }, true);
      } catch (cause) { if (!controller.signal.aborted) { setError(serviceErrorMessage(cause)); setLoading(false); } }
    })();
    return () => { disposed = true; accessRef.current = null; controller.abort(); abortLists(); detailSource.current?.abort(); void waitForSiteSettingsWrites(writes.signal).then(() => unlisten?.()); };
  }, [revision]);
  useEffect(() => {
    if (!access?.enabled) return;
    const active: SitesListKind[] = location.view === "all" ? ["owned", "shared"] : [location.view];
    const controllers: AbortController[] = [], timers: ReturnType<typeof setTimeout>[] = [];
    for (const kind of active) {
      if (kind === "shared" && !sharedAvailable || kind === "pinned" && !access.pinned) continue;
      const search = kind === "pinned" || kind === "shared" && access.workspace ? serverQuery : "", previous = pagesRef.current[kind];
      if (previous.loaded && previous.query === search && !previous.error) {
        const controller = new AbortController(); sources.current[kind] = controller; controllers.push(controller);
        paging.current.delete(kind);
        if (previous.paging) setPages(value => ({ ...value, [kind]: { ...value[kind], paging: false } }));
        continue;
      }
      sources.current[kind]?.abort(); const controller = new AbortController(); sources.current[kind] = controller; controllers.push(controller);
      paging.current.delete(kind); cursors.current[kind] = [];
      setPages(value => ({ ...value, [kind]: { ...emptyPage(), loading: true, query: search } }));
      const read = async () => {
        try {
          const page = await readSitesPage(access, kind, search, null, controller.signal);
          if (controller.signal.aborted || source.current?.signal.aborted || accessRef.current !== access) return;
          cursors.current[kind] = page.cursor ? [page.cursor] : [];
          setPages(value => ({ ...value, [kind]: { ...emptyPage(), ...page, loaded: true, query: search } }));
        } catch (cause) {
          if (controller.signal.aborted || accessRef.current !== access) return;
          if ((cause as { code?: string })?.code === "shared_fallback_unavailable") {
            const next = { ...access, editable: false }; accessRef.current = next; setAccess(next); setNotice(serviceErrorMessage(cause)); navigate({ ...locationRef.current, view: "owned", search: "" }, true);
          } else setPages(value => ({ ...value, [kind]: { ...emptyPage(), query: search, error: serviceErrorMessage(cause) } }));
        }
      };
      if (search && (kind === "pinned" || kind === "shared" && access.workspace)) timers.push(setTimeout(() => void read(), 300)); else void read();
    }
    return () => { timers.forEach(clearTimeout); controllers.forEach(controller => controller.abort()); };
  }, [access, location.view, serverQuery, sharedAvailable, listRevision]);
  const loadMore = async (kind: SitesListKind) => {
    const current = accessRef.current, controller = sources.current[kind], page = pagesRef.current[kind];
    if (!current?.enabled || !controller || controller.signal.aborted || !page.cursor || paging.current.has(kind)) return;
    paging.current.add(kind); setPages(value => ({ ...value, [kind]: { ...value[kind], paging: true, pageError: null } }));
    try {
      const next = await readSitesPage(current, kind, page.query, page.cursor, controller.signal, cursors.current[kind]);
      if (controller.signal.aborted || source.current?.signal.aborted || accessRef.current !== current) return;
      if (next.cursor) cursors.current[kind].push(next.cursor);
      setPages(value => ({ ...value, [kind]: { ...value[kind], items: mergeSites(value[kind].items, next.items), cursor: next.cursor,
        assets: [...value[kind].assets.filter(ref => !next.items.some(site => site.id === ref.id)), ...next.assets] } }));
    } catch (cause) { if (!controller.signal.aborted && accessRef.current === current) setPages(value => ({ ...value, [kind]: { ...value[kind], pageError: serviceErrorMessage(cause) } })); }
    finally { if (!controller.signal.aborted && accessRef.current === current) { paging.current.delete(kind); setPages(value => ({ ...value, [kind]: { ...value[kind], paging: false } })); } }
  };
  const visiblePages = kinds.map(kind => pages[kind]);
  const items = mergeSites(...kinds.map(kind => kind === "shared" && access?.workspace || kind === "pinned" ? pages[kind].items : filterSites(pages[kind].items, location.search)));
  const ready = Boolean(access?.enabled && visiblePages.every(page => page.loaded && !page.loading && !page.error));
  const moreKinds = kinds.filter(kind => pages[kind].cursor);
  const more = () => moreKinds.forEach(kind => { if (!pagesRef.current[kind].pageError) void loadMore(kind); });
  useEffect(() => {
    const marker = sentinel.current; if (!marker || !ready || location.siteId || !moreKinds.length) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) more(); }, { root: scroll.current, rootMargin: "240px" });
    observer.observe(marker); return () => observer.disconnect();
  }, [ready, location.siteId, location.view, items.length, moreKinds.map(kind => pages[kind].cursor).join(":"), visiblePages.some(page => page.paging)]);
  const retryList = (kind: SitesListKind) => { sources.current[kind]?.abort(); setPages(value => ({ ...value, [kind]: emptyPage() })); setListRevision(value => value + 1); };
  const readSettings = async (current: SitesClientAccess, id: string, controller: AbortController) => {
    if (settingsPending.current || domainsPending.current) return; settingsPending.current = true; setSettingsLoading(true);
    const domainVersion = domainRequest.current;
    try { const value = await readSiteSettings(current, id, controller.signal); if (!controller.signal.aborted && accessRef.current === current) setSettings(previous => {
      if (!previous || domainRequest.current === domainVersion) return value;
      const errors = { ...value.errors }; for (const key of ["capabilities", "domains"]) { if (typeof previous.errors[key] === "string") errors[key] = previous.errors[key]; else delete errors[key]; }
      return { ...value, capabilities: previous.capabilities, domains: previous.domains, errors };
    }); }
    finally { if (!controller.signal.aborted && accessRef.current === current) { settingsPending.current = false; setSettingsLoading(false); } }
  };
  const retryDomains = async () => {
    const current = accessRef.current, id = locationRef.current.siteId, controller = detailSource.current;
    if (!current || !id || !controller || controller.signal.aborted || domainsPending.current || settingsPending.current) return;
    const request = ++domainRequest.current; domainsPending.current = true; setDomainsLoading(true);
    try {
      const result = await readSiteDomainSettings(current, id, controller.signal);
      if (controller.signal.aborted || accessRef.current !== current || locationRef.current.siteId !== id || domainRequest.current !== request) return;
      setSettings(previous => {
        if (!previous) return previous;
        const errors = { ...previous.errors }; delete errors.capabilities; delete errors.domains;
        return { ...previous, capabilities: result.capabilities, domains: result.domains, errors: { ...errors, ...result.errors } };
      });
    } catch (cause) {
      if (!controller.signal.aborted && accessRef.current === current && locationRef.current.siteId === id && domainRequest.current === request)
        setSettings(previous => {
          if (!previous) return previous;
          const errors = { ...previous.errors }; delete errors.domains;
          return { ...previous, capabilities: null, domains: null, errors: { ...errors, capabilities: serviceErrorMessage(cause) } };
        });
    } finally {
      if (!controller.signal.aborted && accessRef.current === current && locationRef.current.siteId === id && domainRequest.current === request) { domainsPending.current = false; setDomainsLoading(false); }
    }
  };
  useEffect(() => {
    const id = location.siteId;
    detailSource.current?.abort(); setDetail(null); setDetailError(null); setSettings(null); settingsPending.current = false; setSettingsLoading(false);
    domainRequest.current++; domainsPending.current = false; setDomainsLoading(false);
    if (!id || !access?.enabled) return;
    const controller = new AbortController(); detailSource.current = controller;
    void (async () => {
      try {
        const result = await readSiteDetail(access, id, controller.signal);
        if (controller.signal.aborted || accessRef.current !== access) return;
        setDetail(result);
        setPages(value => Object.fromEntries(Object.entries(value).map(([kind, page]) => [kind, { ...page, items: page.items.map(site => site.id === id ? result.site : site), assets: [...page.assets.filter(ref => ref.id !== id), ...result.assets] }])) as Record<SitesListKind, Page>);
        await readSettings(access, id, controller);
      } catch (cause) { if (!controller.signal.aborted && accessRef.current === access) setDetailError(serviceErrorMessage(cause)); }
    })();
    return () => controller.abort();
  }, [access, location.siteId, detailRevision]);
  useLayoutEffect(() => {
    if (location.siteId) detailHeading.current?.focus();
    else if (restoreFocus.current) { rows.current.get(restoreFocus.current)?.querySelector<HTMLButtonElement>(".sites-row-menu-button")?.focus(); restoreFocus.current = null; }
  }, [location.siteId]);
  const closeSettings = () => { detailSource.current?.abort(); restoreFocus.current = location.siteId; navigate({ ...location, siteId: null }); };
  const updatePin = async (site: SiteRecord, readOnly = false) => {
    const current = accessRef.current, controller = source.current;
    if (!current?.pinned || !controller || controller.signal.aborted || pinBusy.current.has(site.id) || !readOnly && unconfirmedPins.current.has(site.id)) return;
    pinBusy.current.add(site.id); setPins(value => ({ ...value, [site.id]: { value: value[site.id]?.value ?? site.isPinned, pending: true, unconfirmed: unconfirmedPins.current.has(site.id), error: null } }));
    try {
      const known = pins[site.id]?.value ?? site.isPinned;
      const value = readOnly || known === null ? await readSitePin(current, site.id, controller.signal) : await setSitePinned(current, site.id, !known, controller.signal);
      if (controller.signal.aborted || accessRef.current !== current) return;
      unconfirmedPins.current.delete(site.id); setPins(previous => ({ ...previous, [site.id]: { value, pending: false, unconfirmed: false, error: null } }));
      setPages(previous => ({ ...previous, pinned: { ...emptyPage() }, owned: { ...previous.owned, items: previous.owned.items.map(item => item.id === site.id ? { ...item, isPinned: value } : item) }, shared: { ...previous.shared, items: previous.shared.items.map(item => item.id === site.id ? { ...item, isPinned: value } : item) } }));
      setListRevision(value => value + 1);
    } catch (cause) {
      if (controller.signal.aborted || accessRef.current !== current) return;
      const unknown = (cause as { code?: string })?.code === "site_pin_unconfirmed";
      if (unknown) unconfirmedPins.current.add(site.id);
      setPins(previous => ({ ...previous, [site.id]: { value: previous[site.id]?.value ?? site.isPinned, pending: false, unconfirmed: unknown, error: serviceErrorMessage(cause) } }));
    } finally { if (accessRef.current === current) pinBusy.current.delete(site.id); }
  };
  const selectTab = (view: SitesLocation["view"]) => navigate({ view, siteId: null, search: "" });
  const updateQuery = (search: string) => {
    const next = { ...location, search }; if (collectionNavigation) navigate(next, true); else { locationRef.current = next; setLocation(next); }
  };
  const selectMode = (mode: "list" | "grid") => { setViewMode(mode); try { localStorage.setItem("sites-view-mode", mode); setPreferenceError(null); } catch { setPreferenceError("无法保存网站布局偏好。"); } };
  const screenshot = (site: SiteRecord, assets: SiteAssetRef[]) => access && source.current ? <SiteScreenshot site={site} assets={assets} access={access} scope={source.current.signal} /> : null;
  const applySettingsSite = (result: { site: SiteRecord; assets: SiteAssetRef[] }) => {
    if (accessRef.current !== access || source.current?.signal.aborted) return;
    setDetail(previous => previous?.site.id === result.site.id && Date.parse(result.site.updatedAt) >= Date.parse(previous.site.updatedAt) ? result : previous);
    setPages(previous => Object.fromEntries(Object.entries(previous).map(([kind, page]) => {
      const current = page.items.find(site => site.id === result.site.id);
      if (!current || Date.parse(result.site.updatedAt) < Date.parse(current.updatedAt)) return [kind, page];
      return [kind, { ...page, items: page.items.map(site => site.id === result.site.id ? result.site : site), assets: [...page.assets.filter(ref => ref.id !== result.site.id), ...result.assets] }];
    })) as Record<SitesListKind, Page>);
  };
  const refreshSharingSite = async (policy: SiteSharingPolicy | null) => {
    const request = ++sharingRequest.current;
    if (!policy) return;
    const scope = settingsWriteScope.current, id = detail?.site.id;
    const current = () => accessRef.current === access && scope === settingsWriteScope.current && !scope?.signal.aborted && locationRef.current.siteId === id && sharingRequest.current === request;
    if (!access || !scope || !id || !current()) return;
    await trackRequest(scope.signal, (async () => {
      try { const result = await readSiteDetail(access, id, scope.signal); if (current() && result.site.sharing.accessMode === policy.accessMode) applySettingsSite(result); }
      catch { if (current()) onSaveError?.("无法读取站点最新信息"); }
    })());
  };
  const domainControl = (domainsLoading || settings?.errors.capabilities || settings?.capabilities?.customDomainsEnabled) && <div className="site-domains-settings">{(!settings?.domains?.length || domainsLoading || settings?.errors.domains) && <span>自定义域名</span>}{(settingsLoading || domainsLoading) && <p role="status">正在读取自定义域名…</p>}
    {settings?.errors.capabilities && <p role="alert">无法读取设置能力：{settings.errors.capabilities}</p>}{settings?.errors.domains && <p role="alert">无法读取自定义域名：{settings.errors.domains}</p>}
    {access && detail && settingsWriteScope.current && settings?.capabilities?.customDomainsEnabled && settings.domains && <SiteDomainSettings access={access} siteId={detail.site.id} domains={settings.domains} scope={settingsWriteScope.current.signal} onError={onSaveError} onSite={applySettingsSite} onDomains={domains => {
      if (accessRef.current !== access || source.current?.signal.aborted || locationRef.current.siteId !== detail.site.id) return;
      domainRequest.current++; domainsPending.current = false; setDomainsLoading(false);
      setSettings(previous => { if (!previous) return previous; const errors = { ...previous.errors }; delete errors.domains; return { ...previous, domains, errors }; });
    }} />}
    {(settings?.errors.capabilities || settings?.errors.domains) && <button type="button" aria-label="重试自定义域名" disabled={domainsLoading || settingsLoading} onClick={() => void retryDomains()}>重试</button>}
  </div>;
  const searchField = <div className="sites-header-actions library-header-actions"><label className="sites-search library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索站点" placeholder="搜索站点" value={location.search} maxLength={location.view === "pinned" || ["shared", "all"].includes(location.view) && access?.workspace ? 200 : undefined} onChange={event => updateQuery(event.target.value)} />{location.search && <button type="button" aria-label="清除搜索" onClick={() => updateQuery("")}><X size={14} /></button>}</label><button type="button" className="sites-create-button" disabled title="Sites 的 Work 会话尚未接入"><Plus size={16} />创建新站点</button></div>;
  const tabs = <div className="sites-navigation"><nav aria-label="站点视图">{([["owned", collectionNavigation ? "你的网站" : "你拥有的"], ...(access?.pinned ? [["pinned", "已置顶"]] : []), ...(sharedAvailable ? [["shared", "与你共享"], ...(collectionNavigation ? [["all", "全部"]] : [])] : [])] as [SitesLocation["view"], string][]).map(([view, label]) => <button type="button" key={view} aria-current={location.view === view ? "page" : undefined} onClick={() => selectTab(view)}>{label}</button>)}</nav><div className="sites-view-mode" role="group" aria-label="网站布局">{(["list", "grid"] as const).map(mode => <button type="button" key={mode} aria-label={mode === "list" ? "列表视图" : "网格视图"} title={mode === "list" ? "列表" : "网格"} aria-pressed={viewMode === mode} onClick={() => selectMode(mode)}>{mode === "list" ? <List size={16} /> : <Grid2X2 size={16} />}</button>)}</div></div>;
  return <div className="sites-page"><div className="sites-scroll" ref={scroll}>
    {location.siteId ? <div className="sites-settings-workface"><header className="sites-settings-toolbar"><button type="button" onClick={closeSettings}>← 网站</button></header><div className="sites-settings-content">
      <div className="sites-detail-identity">{detail && screenshot(detail.site, detail.assets)}<h1 ref={detailHeading} tabIndex={-1}>{detail?.site.title ?? "站点"}</h1></div>
      <nav className="sites-detail-tabs" aria-label="站点详情"><button type="button" aria-current="page">设置</button><button type="button" disabled title="数据库工作面尚未接入">数据库</button><button type="button" disabled title="站点日程尚未接入">已安排</button></nav>
      {detailError && <div className="sites-state"><p role="alert">{detailError}</p><button type="button" onClick={() => setDetailRevision(value => value + 1)}>重试</button></div>}
      {!detail && !detailError && <p className="sites-state" role="status">正在加载网站</p>}
      {detail && <div className="sites-settings-groups">{access && settingsWriteScope.current && <SiteSettingsForm access={access} site={detail.site} snapshot={settings?.environmentSnapshot ?? null} scope={settingsWriteScope.current.signal} environmentError={settings?.errors.environment} loading={settingsLoading} sharingText={siteSharingText(detail.site)} domainSettings={domainControl} onSharingChange={refreshSharingSite} canChangeSlug={access.slugChangeAllowed && settings?.capabilities?.slugChangeEnabled === true && detail.site.status === "active" && (detail.site.role === null || detail.site.role === "owner")} onError={onSaveError} onSite={applySettingsSite} />}
        {settings?.errors.environment && <button type="button" disabled={settingsLoading || domainsLoading} onClick={() => { if (access && location.siteId && detailSource.current) void readSettings(access, location.siteId, detailSource.current).catch(() => {}); }}>重试</button>}
        <section><h2>危险操作区</h2><div className="sites-setting-row"><div>删除站点<p>永久删除此站点</p></div><button type="button" disabled title="站点删除尚未接入">删除站点</button></div></section>
      </div>}
    </div></div> : <>
      <LibraryStickyHeader title="站点" description="将你的想法变成真实网站" newLayout scrollContainerRef={scroll} bodyRef={body} actions={searchField} navigation={tabs} />
      <div className="sites-content" ref={body}>
        {loading && <p className="sites-state" role="status">正在加载网站</p>}
        {error && <div className="sites-state"><h2>无法加载站点</h2><p role="alert">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></div>}
        {!loading && access && !access.enabled && <p className="sites-state" role="status">当前账号不可使用站点。</p>}
        {notice && <p className="sites-state" role="status">{notice}</p>}{preferenceError && <p role="alert">{preferenceError}</p>}
        {access?.enabled && <>
          {visiblePages.some(page => page.loading) && <p className="sites-state" role="status">正在加载网站</p>}
          {kinds.map(kind => pages[kind].error && <section className="sites-state" key={kind}><h2>无法加载站点</h2><p role="alert">{pages[kind].error}</p><button type="button" onClick={() => retryList(kind)}>重试</button></section>)}
          {ready && !items.length && <div className="sites-state" role="status"><h2>{location.view === "pinned" && !location.search.trim() ? "尚未置顶任何站点" : "暂无站点"}</h2><p>{location.view === "pinned" ? "在网站菜单中选择“置顶”，即可在此处找到" : "使用数据库和登录功能构建网站和应用——试试“构建团队仪表板”或“创建活动报名页面”"}</p></div>}
          <div className={`sites-results sites-results-${viewMode}`}>
            {viewMode === "list" && items.length > 0 && <div className="sites-columns"><span>站点</span>{location.view !== "owned" && <span className="sites-owner">所有者</span>}<span className="sites-sharing">共享对象</span><span /></div>}
            {items.map(site => {
              const context = location.view === "owned" || location.view === "all" && pages.owned.items.some(item => item.id === site.id) ? "owned" : location.view === "pinned" ? "pinned" : "shared";
              const role = siteRole(site, context), editable = role === "owner" || role === "editor", disabled = site.status === "suspended" || site.disabledBy !== null;
              const live = !disabled && site.status === "active" ? safeSiteUrl(site.liveUrl) : null;
              const isPinned = pins[site.id]?.value ?? site.isPinned;
              const assets = kinds.map(kind => pages[kind]).find(page => page.items.includes(site))?.assets ?? [];
              const actions: ThreadActionItem[] = [
                ...(access.pinned ? [{ id: "pin", label: isPinned ? "取消置顶" : "置顶", disabled: pins[site.id]?.pending || pins[site.id]?.unconfirmed || isPinned === null }] : []),
                { id: "publish", label: "发布", disabled: true, hint: "Sites 发布会话尚未接入" },
                { id: "edit", label: "编辑", disabled: true, hint: "Sites 编辑会话尚未接入" },
                { id: "settings", label: "设置" },
              ];
              return <article className="sites-result" key={site.id} ref={node => { if (node) rows.current.set(site.id, node); else rows.current.delete(site.id); }} data-appgen-row>
                {!editable && live ? <a className="sites-primary-action" href={live} target="_blank" rel="noreferrer" aria-label={`在新标签页中打开 ${site.title}`} /> : <button className="sites-primary-action" type="button" disabled title={disabled ? "已被管理员禁用" : "Sites 编辑会话尚未接入"} aria-label={`编辑 ${site.title}`} />}
                <div className="sites-result-preview">{screenshot(site, assets)}</div><div className="sites-result-information"><div className="sites-result-name"><span>{site.title}</span>{isPinned && <Pin size={12} aria-label="已置顶" />}{disabled && <span className="sites-disabled">已禁用</span>}</div><div className="sites-result-meta">{site.status === "active" && site.liveUrl === null && <span>未发布 · </span>}<time dateTime={site.updatedAt}>{siteUpdatedText(site.updatedAt)}</time></div></div>
                {location.view !== "owned" && <div className="sites-owner">{role === "owner" ? "你" : site.owner?.name ?? site.owner?.email ?? "所有者不可用"}</div>}
                <div className="sites-sharing">{siteSharingText(site)}</div>
                <div className="sites-result-actions">{live && <a href={live} target="_blank" rel="noreferrer" aria-label={`在新标签页中打开 ${site.title}`} title="打开网站"><ExternalLink size={16} /></a>}
                  <ThreadActionsMenu items={actions} triggerAriaLabel={`${site.title} 的更多操作`} label={<Ellipsis size={16} />} buttonClassName="sites-row-menu-button" onOpenChange={open => { if (open && access.pinned && isPinned === null && !pinBusy.current.has(site.id)) void updatePin(site, true); }} onSelect={id => { if (id === "settings") navigate({ ...location, siteId: site.id }); else if (id === "pin") void updatePin(site); }} />
                </div>
                {pins[site.id]?.error && <div className="sites-pin-error" role="alert">无法更新置顶项。请重试。<button type="button" disabled={pins[site.id]?.pending} onClick={() => void updatePin(site, true)}>重新读取置顶状态</button></div>}
              </article>;
            })}
          </div>
          {moreKinds.map(kind => pages[kind].pageError && <div className="sites-page-error" key={kind}><p role="alert">无法加载更多网站：{pages[kind].pageError}</p><button type="button" disabled={pages[kind].paging} onClick={() => void loadMore(kind)}>重试</button></div>)}
          <div ref={sentinel} className="sites-pagination" aria-hidden="true" />
          {visiblePages.some(page => page.paging) && <p role="status">正在加载更多网站</p>}
        </>}
      </div>
    </>}
  </div></div>;
};
