import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { readChatgptService, serviceErrorMessage, serviceIdentity, type ServiceIdentity } from "../chatgptService";
import { filterSites, mergeSites, parseSite, parseSiteDomains, parseSiteEnvironment, parseSitesAccess, parseSitesPage, safeSiteUrl,
  type SiteDomain, type SiteEnvironment, type SiteRecord, type SitesAccess } from "../sitesService";
import "./SitesView.css";

type Tab = "owned" | "shared" | "all";
interface Session { identity: ServiceIdentity; access: SitesAccess; controller: AbortController }
interface Page { items: SiteRecord[]; cursor: string | null; loading: boolean; loaded: boolean; error: string | null; paging: boolean; pageError: string | null }
const emptyPage = (): Page => ({ items: [], cursor: null, loading: false, loaded: false, error: null, paging: false, pageError: null });
const statusText = { active: "活跃", archived: "已归档", suspended: "已暂停", deleting: "正在删除" };
export const SitesView: React.FC = () => {
  const [revision, setRevision] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owned, setOwned] = useState<Page>(emptyPage);
  const [shared, setShared] = useState<Page>(emptyPage);
  const [tab, setTab] = useState<Tab>("owned");
  const [query, setQuery] = useState("");
  const [sharedRevision, setSharedRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => localStorage.getItem("sites-view-mode") === "grid" ? "grid" : "list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SiteRecord | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<SiteEnvironment[] | null>(null);
  const [domains, setDomains] = useState<SiteDomain[] | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const source = useRef<AbortController | null>(null);
  const sharedSource = useRef<AbortController | null>(null);
  const detailSource = useRef<AbortController | null>(null);
  const paging = useRef(new Set<string>());
  const settingsPending = useRef(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const needShared = tab !== "owned";
  const sharedQuery = session?.access.workspace ? query.trim() : "";

  useEffect(() => {
    let disposed = false;
    const subscription = tauriListen("chatgpt-service:invalidated", () => {
      if (disposed) return;
      source.current?.abort(); sharedSource.current?.abort(); detailSource.current?.abort();
      setSession(null); setOwned(emptyPage()); setShared(emptyPage()); setSelectedId(null); setRevision(value => value + 1);
    });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); source.current = controller;
    setSession(null); setLoading(true); setError(null); setNotice(null); setOwned(emptyPage()); setShared(emptyPage()); setTab("owned"); setSelectedId(null); paging.current.clear();
    void (async () => {
      try {
        const identity = await serviceIdentity(controller.signal); if (controller.signal.aborted) return;
        const access = parseSitesAccess(await readChatgptService("sites_access", {}, identity, controller.signal)); if (controller.signal.aborted) return;
        setSession({ identity, access, controller }); setLoading(false);
        if (!access.enabled) return;
        setOwned({ ...emptyPage(), loading: true });
        try {
          const page = parseSitesPage(await readChatgptService("sites_list", { limit: 20, include_editable: false }, identity, controller.signal));
          if (!controller.signal.aborted) setOwned({ ...emptyPage(), ...page, items: mergeSites(page.items), loaded: true });
        } catch (cause) { if (!controller.signal.aborted) setOwned({ ...emptyPage(), error: serviceErrorMessage(cause) }); }
      } catch (cause) { if (!controller.signal.aborted) { setError(serviceErrorMessage(cause)); setLoading(false); } }
    })();
    return () => { controller.abort(); sharedSource.current?.abort(); detailSource.current?.abort(); };
  }, [revision]);
  useEffect(() => {
    if (!session?.access.enabled || !needShared || (!session.access.workspace && !session.access.editable)) return;
    const controller = new AbortController(); sharedSource.current = controller;
    paging.current.delete("shared"); setShared({ ...emptyPage(), loading: true });
    const load = async () => {
      try {
        const params = session.access.workspace ? { limit: 20, ...(sharedQuery ? { query: sharedQuery } : {}) }
          : { limit: 20, include_editable: true, after: "sites-shared-projects:" };
        const page = parseSitesPage(await readChatgptService(session.access.workspace ? "sites_shared" : "sites_list", params, session.identity, controller.signal));
        if (!controller.signal.aborted && !session.controller.signal.aborted) setShared({ ...emptyPage(), ...page, items: mergeSites(page.items), loaded: true });
      } catch (cause) {
        if (controller.signal.aborted || session.controller.signal.aborted) return;
        if (!session.access.workspace && (cause as { status?: number })?.status === 400) {
          setSession({ ...session, access: { ...session.access, editable: false } }); setTab("owned"); setNotice("当前服务不支持共享站点列表。");
        } else setShared({ ...emptyPage(), error: serviceErrorMessage(cause) });
      }
    };
    const timer = session.access.workspace && sharedQuery ? setTimeout(() => void load(), 300) : null;
    if (!timer) void load();
    return () => { if (timer) clearTimeout(timer); controller.abort(); };
  }, [session, needShared, sharedQuery, sharedRevision]);
  useEffect(() => {
    if (!selectedId) return;
    const dialog = dialogRef.current; dialog?.showModal();
    return () => { dialog?.close(); detailTrigger.current?.focus(); };
  }, [selectedId]);

  const loadMore = async (kind: "owned" | "shared") => {
    const page = kind === "owned" ? owned : shared;
    const controller = kind === "owned" ? source.current : sharedSource.current;
    const setPage = kind === "owned" ? setOwned : setShared;
    if (!session || !controller || controller.signal.aborted || !page.cursor || paging.current.has(kind)) return;
    paging.current.add(kind); setPage(value => ({ ...value, paging: true, pageError: null }));
    try {
      const operation = kind === "shared" && session.access.workspace ? "sites_shared" : "sites_list";
      const params = { limit: 20, after: page.cursor, ...(operation === "sites_shared" ? (sharedQuery ? { query: sharedQuery } : {}) : { include_editable: kind === "shared" }) };
      const next = parseSitesPage(await readChatgptService(operation, params, session.identity, controller.signal));
      if (next.cursor === page.cursor) throw Error("服务返回了重复分页游标，请刷新后重试。");
      if (!controller.signal.aborted && !session.controller.signal.aborted) setPage(value => ({ ...value, items: mergeSites(value.items, next.items), cursor: next.cursor }));
    } catch (cause) { if (!controller.signal.aborted && !session.controller.signal.aborted) setPage(value => ({ ...value, pageError: serviceErrorMessage(cause) })); }
    finally { if (!controller.signal.aborted && !session.controller.signal.aborted) { paging.current.delete(kind); setPage(value => ({ ...value, paging: false })); } }
  };
  const openDetail = async (id: string) => {
    if (!session || session.controller.signal.aborted) return;
    detailSource.current?.abort(); const controller = new AbortController(); detailSource.current = controller;
    settingsPending.current = false; setSelectedId(id); setDetail(null); setDetailError(null); setEnvironment(null); setDomains(null); setSettingsErrors({}); setSettingsLoading(false);
    try {
      const record = parseSite(await readChatgptService("sites_detail", { id }, session.identity, controller.signal));
      if (record.id !== id) throw Error("站点详情身份与请求不匹配，请重试。");
      if (!controller.signal.aborted && !session.controller.signal.aborted) setDetail(record);
    } catch (cause) { if (!controller.signal.aborted && !session.controller.signal.aborted) setDetailError(serviceErrorMessage(cause)); }
  };
  const readSettings = async () => {
    const controller = detailSource.current;
    if (!session || !selectedId || !controller || controller.signal.aborted || settingsPending.current) return;
    settingsPending.current = true; setSettingsLoading(true); setSettingsErrors({});
    await Promise.all((["environment", "domains"] as const).map(async kind => {
      try {
        const body = await readChatgptService(kind === "environment" ? "sites_environment" : "sites_domains", { id: selectedId }, session.identity, controller.signal);
        if (controller.signal.aborted || session.controller.signal.aborted) return;
        if (kind === "environment") setEnvironment(parseSiteEnvironment(body, selectedId)); else setDomains(parseSiteDomains(body, selectedId));
      } catch (cause) { if (!controller.signal.aborted && !session.controller.signal.aborted) setSettingsErrors(value => ({ ...value, [kind]: serviceErrorMessage(cause) })); }
    }));
    if (!controller.signal.aborted && !session.controller.signal.aborted) { settingsPending.current = false; setSettingsLoading(false); }
  };
  const closeDetail = () => { detailSource.current?.abort(); setSelectedId(null); };
  const sharedAvailable = Boolean(session?.access.workspace || session?.access.editable);
  const ownedItems = filterSites(owned.items, query);
  const sharedItems = session?.access.workspace ? shared.items : filterSites(shared.items, query);
  const items = tab === "owned" ? ownedItems : tab === "shared" ? sharedItems : mergeSites(ownedItems, sharedItems);
  const pages = tab === "owned" ? [owned] : tab === "shared" ? [shared] : [owned, shared];
  const ready = Boolean(session?.access.enabled && pages.every(page => page.loaded && !page.loading && !page.error));
  const selectMode = (mode: "list" | "grid") => { setViewMode(mode); localStorage.setItem("sites-view-mode", mode); };
  return <div className="sites-view-container">
    <div className="sites-view-header"><h2>Sites</h2></div>
    {loading && <p role="status">正在读取 Sites…</p>}
    {error && <section><p role="alert">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></section>}
    {!loading && session && !session.access.enabled && <p role="status">当前账号不可使用 Sites。</p>}
    {notice && <p role="status">{notice}</p>}
    {session?.access.enabled && <>
      <div className="sites-controls-bar"><div className="sites-tabs">{(["owned", "shared", "all"] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} disabled={value !== "owned" && !sharedAvailable}
        className={`sites-tab-btn ${tab === value ? "active" : ""}`} onClick={() => setTab(value)}>{value === "owned" ? "我创建的" : value === "shared" ? "共享" : "全部"}</button>)}</div>
        <div className="sites-search-wrap"><input type="search" maxLength={256} aria-label="搜索站点" placeholder="搜索站点…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="sites-layout-toggle">{(["list", "grid"] as const).map(mode => <button type="button" key={mode} aria-pressed={viewMode === mode} className="layout-btn" onClick={() => selectMode(mode)}>{mode === "list" ? "列表" : "网格"}</button>)}</div>
      </div>
      {query.trim() && tab !== "shared" && <p role="status">我创建的站点仅搜索已加载内容。</p>}
      {pages.some(page => page.loading) && <p role="status">正在加载站点…</p>}
      {pages.map((page, index) => page.error && <div key={index}><p role="alert">{page.error}</p><button type="button" onClick={() => tab === "shared" || (tab === "all" && index === 1) ? setSharedRevision(value => value + 1) : setRevision(value => value + 1)}>重试列表</button></div>)}
      {ready && !items.length && <p role="status">没有匹配的站点。</p>}
      <div className={viewMode === "grid" ? "sites-grid" : "sites-list-view"}>{items.map(site => <article className="site-card" key={site.id}>
        <button type="button" className="link-btn site-name" onClick={event => { detailTrigger.current = event.currentTarget; void openDetail(site.id); }}>{site.title}</button>
        <span>{statusText[site.status]}</span>{site.disabledBy && <span>此站点已被停用</span>}
        <p>{site.description}</p><time dateTime={site.updatedAt}>{new Date(site.updatedAt).toLocaleString()}</time>
        {!site.disabledBy && site.status === "active" && safeSiteUrl(site.liveUrl) ? <a href={safeSiteUrl(site.liveUrl)!} target="_blank" rel="noreferrer">打开在线站点</a> : <span>暂无可用在线地址</span>}
      </article>)}</div>
      {(["owned", "shared"] as const).filter(kind => tab === kind || tab === "all").map(kind => {
        const page = kind === "owned" ? owned : shared;
        return <div key={kind}>{page.pageError && <p role="alert">{page.pageError}</p>}{page.cursor && <button type="button" disabled={page.paging} onClick={() => void loadMore(kind)}>{page.paging ? "正在加载…" : page.pageError ? `重试加载${kind === "owned" ? "我的站点" : "共享站点"}` : `加载更多${kind === "owned" ? "我的站点" : "共享站点"}`}</button>}</div>;
      })}
    </>}
    {selectedId && <dialog ref={dialogRef} aria-label="站点详情" onCancel={event => { event.preventDefault(); closeDetail(); }}>
      <button type="button" onClick={closeDetail}>关闭</button>
      {detailError ? <><p role="alert">{detailError}</p><button type="button" onClick={() => void openDetail(selectedId)}>重试详情</button></> : !detail ? <p role="status">正在读取详情…</p> : <>
        <h2>{detail.title}</h2><p>{detail.description}</p><p>{statusText[detail.status]}</p>
        {!detail.disabledBy && detail.status === "active" && safeSiteUrl(detail.liveUrl) ? <a href={safeSiteUrl(detail.liveUrl)!} target="_blank" rel="noreferrer">打开在线站点</a> : <p>暂无可用在线地址</p>}
        <button type="button" disabled={settingsLoading} onClick={() => void readSettings()}>{settingsLoading ? "正在读取配置…" : "读取域名与环境变量"}</button>
        {Object.entries(settingsErrors).map(([kind, message]) => <p role="alert" key={kind}>{kind === "environment" ? "环境变量" : "域名"}：{message}</p>)}
        {environment && <section aria-label="环境变量"><h3>环境变量</h3>{!environment.length && <p>暂无环境变量。</p>}{environment.map(entry => <p key={entry.key}><code>{entry.key}</code>：{entry.secret ? "••••••" : entry.value ?? "未设置"}</p>)}</section>}
        {domains && <section aria-label="自定义域名"><h3>自定义域名</h3>{!domains.length && <p>暂无自定义域名。</p>}{domains.map(domain => <div key={domain.id}><p>{domain.hostname} · {domain.status}</p>{domain.cname && <p>CNAME：{domain.cname}</p>}{domain.ipv4.map(ip => <p key={ip}>A：{ip}</p>)}{domain.ssl && <p>SSL：{domain.ssl}</p>}{domain.error && <p role="alert">{domain.error}</p>}{domain.records.map((record, index) => <p key={index}>{record.type} {record.name} {record.value}</p>)}</div>)}</section>}
      </>}
    </dialog>}
  </div>;
};
