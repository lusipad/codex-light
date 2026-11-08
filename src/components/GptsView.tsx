import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bot, Ellipsis, Link, MessageCircle, Search, Star, X } from "lucide-react";
import { tauriListen } from "../bridge";
import { copyTextToClipboard } from "../clipboard";
import { serviceErrorMessage, type GptAssetRef } from "../chatgptService";
import { readGptsAccess, readGptsDiscovery, readGptsSearch, readGptsCategory, readGptsDetail, readGptsAbout, readGptsAvatar,
  type GptsAccess, type GptsDiscoveryResult, type GptsSectionResult } from "../gptsClient";
import { appendGptPage, gptPublicLink, gptRestriction, type GptResource, type GptSection, type GptAboutBlock } from "../gptsData";
import { LibraryStickyHeader } from "./LibraryStickyHeader";
import "./GptsView.css";

const description = "发现集说明、额外知识和任意技能组合于一体的自定义版 ChatGPT";
const restrictions = {
  interactions_disabled: "暂时不可用",
  fedramp_incompatible: "在此工作空间的合规模式下不可用",
  openai_gpt_workspace_disabled: "已被工作空间管理员关闭",
  workspace_disabled: "已被工作空间管理员关闭",
};
const currentQuery = () => new URL(window.location.href).searchParams.get("search") ?? "";

function GptAvatar({ asset, access, scope }: { asset: GptAssetRef | null; access: GptsAccess; scope: AbortSignal }) {
  const [src, setSrc] = useState<{ asset: GptAssetRef; access: GptsAccess; value: string } | null>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const revoke = () => { controller.abort(); image.current?.removeAttribute("src"); setSrc(null); };
    setSrc(null); scope.addEventListener("abort", revoke, { once: true });
    if (scope.aborted) revoke();
    else if (asset) void readGptsAvatar(asset, access, controller.signal).then(value => {
      if (!controller.signal.aborted && !scope.aborted) setSrc({ asset, access, value });
    }).catch(() => { if (!controller.signal.aborted) setSrc(null); });
    return () => { controller.abort(); scope.removeEventListener("abort", revoke); image.current?.removeAttribute("src"); };
  }, [asset, access, scope]);
  return <span className="gpt-avatar">{src && src.asset === asset && src.access === access && !scope.aborted
    ? <img ref={image} src={src.value} alt="" draggable={false} onError={() => { image.current?.removeAttribute("src"); setSrc(null); }} />
    : <Bot aria-hidden="true" size={22} />}</span>;
}

function GptAbout({ blocks }: { blocks: GptAboutBlock[] }) {
  return blocks.length ? <div className="gpt-about-blocks">{blocks.map((block, index) => <div key={index}>
    {block.type === "generic_title_subtitle" ? <><strong>{block.title}</strong><span>{block.subtitle}</span></>
      : block.type === "rating" ? <><strong><Star size={16} aria-hidden="true" />{block.avg}</strong><span>{block.count}</span></>
        : block.categoryRanking == null ? <><strong>{block.category}</strong><span>类别</span></>
          : <><strong>#{block.categoryRanking}</strong><span>位于 {block.categoryLocale ? `${block.categoryLocale} 的 ` : ""}{block.category} 类别中</span></>}
  </div>)}</div> : null;
}

interface DetailState { id: string; resource: GptResource | null; assets: GptAssetRef[] }
function GptDetail({ state, access, scope, onClose, onResource }: { state: DetailState; access: GptsAccess; scope: AbortSignal; onClose: () => void; onResource?: (resource: GptResource, assets: GptAssetRef[]) => void }) {
  const [resource, setResource] = useState(state.resource);
  const [assets, setAssets] = useState(state.assets);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState<GptAboutBlock[]>([]);
  const [aboutError, setAboutError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0), [aboutRevision, setAboutRevision] = useState(0);
  const dialog = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null);
  const actions = useRef<HTMLDivElement>(null), actionTrigger = useRef<HTMLButtonElement>(null), copyItem = useRef<HTMLButtonElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copyResult, setCopyResult] = useState<{ link: string; ok: boolean } | null>(null);
  const publicLink = resource ? gptPublicLink(resource) : null;
  useEffect(() => {
    if (!actionsOpen || !publicLink) return;
    copyItem.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !actions.current?.contains(event.target)) setActionsOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [actionsOpen, publicLink]);
  useEffect(() => {
    if (state.resource && !access.refreshDetails && !revision) return;
    const controller = new AbortController();
    const abort = () => controller.abort(); scope.addEventListener("abort", abort, { once: true });
    setError(null);
    if (!scope.aborted) void readGptsDetail(access, state.id, controller.signal).then(value => {
      if (!controller.signal.aborted && !scope.aborted) { setResource(value.resource); setAssets(value.assets); onResource?.(value.resource, value.assets); }
    }).catch(cause => { if (!controller.signal.aborted && !scope.aborted) setError(serviceErrorMessage(cause)); });
    return () => { controller.abort(); scope.removeEventListener("abort", abort); };
  }, [state, access, scope, revision, onResource]);
  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort(); scope.addEventListener("abort", abort, { once: true });
    setAbout([]); setAboutError(null);
    if (!scope.aborted) void readGptsAbout(access, state.id, controller.signal).then(value => {
      if (!controller.signal.aborted && !scope.aborted) setAbout(value);
    }).catch(cause => { if (!controller.signal.aborted && !scope.aborted) setAboutError(serviceErrorMessage(cause)); });
    return () => { controller.abort(); scope.removeEventListener("abort", abort); };
  }, [state.id, access, scope, aboutRevision]);
  useEffect(() => {
    close.current?.focus();
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (copyItem.current) { setActionsOpen(false); actionTrigger.current?.focus(); }
        else onClose();
      }
      if (event.key === "Tab") {
        if (copyItem.current) {
          event.preventDefault();
          setActionsOpen(false);
          (event.shiftKey ? actionTrigger : close).current?.focus();
          return;
        }
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? [])];
        const first = controls[0], last = controls.at(-1);
        if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); document.body.style.overflow = previousOverflow; };
  }, [onClose]);
  const restricted = resource && gptRestriction(resource.tags, access);
  return createPortal(<div className="gpt-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="gpt-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="gpt-detail-title" aria-describedby="gpt-detail-description">
      <div className="gpt-detail-controls">
        {publicLink && <div ref={actions} className="gpt-detail-actions">
          <button ref={actionTrigger} type="button" aria-label="GPT 操作" aria-haspopup="menu" aria-expanded={actionsOpen}
            onClick={() => setActionsOpen(value => !value)}
            onKeyDown={event => {
              if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault(); setActionsOpen(true); copyItem.current?.focus();
              }
            }}><Ellipsis size={20} /></button>
          {actionsOpen && <div className="gpt-detail-action-menu" role="menu" aria-label="GPT 操作">
            <button ref={copyItem} type="button" role="menuitem" onClick={async () => {
              setActionsOpen(false); actionTrigger.current?.focus();
              if (scope.aborted) return;
              const ok = await copyTextToClipboard(publicLink);
              if (scope.aborted || !actionTrigger.current) return;
              setCopyResult({ link: publicLink, ok });
              if (document.activeElement === document.body) actionTrigger.current.focus();
            }}><Link size={16} />{copyResult?.link === publicLink && copyResult.ok ? "链接已复制" : "复制链接"}</button>
          </div>}
        </div>}
        <button ref={close} type="button" onClick={onClose} aria-label="关闭 GPT 详情"><X size={20} /></button>
      </div>
      <div className="gpt-detail-scroll">
        {!resource ? <div className="gpts-state"><h2 id="gpt-detail-title">{error ? "无法加载此 GPT" : "正在加载 GPT 详情"}</h2><p id="gpt-detail-description">{error || "正在加载有关此 GPT 的信息"}</p>{error && <button onClick={() => setRevision(value => value + 1)}>重试</button>}</div>
          : <><GptAvatar asset={assets.find(item => item.id === resource.id) ?? null} access={access} scope={scope} />
            <h2 id="gpt-detail-title">{resource.name}</h2>{resource.author && <p className="gpt-detail-author">作者：{resource.author}</p>}
            <p id="gpt-detail-description" className="gpt-detail-description">{resource.description}</p>
            {publicLink && copyResult?.link === publicLink &&
              <p className={copyResult.ok ? "gpts-sr-only" : "gpts-inline-error"} role="status">
                {copyResult.ok ? "链接已复制" : "无法复制链接，请重试。"}
              </p>}
            {error && <div className="gpts-inline-error"><p role="alert">{error}</p><button onClick={() => setRevision(value => value + 1)}>重试详情</button></div>}
            <GptAbout blocks={about} />
            {aboutError && <div className="gpts-inline-error"><p role="alert">{aboutError}</p><button onClick={() => setAboutRevision(value => value + 1)}>重试附加信息</button></div>}
            {resource.tools.length > 0 && <section className="gpt-detail-tools" aria-label="功能"><h3>功能</h3>{resource.tools.map(tool => <div key={tool.type}><strong>{tool.title}</strong>{tool.description && <p>{tool.description}</p>}</div>)}</section>}
            {restricted && <p className="gpt-restriction" role="status"><AlertTriangle size={16} />{restrictions[restricted]}</p>}
          </>}
      </div>
      <div className="gpt-detail-footer"><button type="button" disabled>开始聊天</button><p>GPT 对话服务尚未接入。</p></div>
    </div>
  </div>, document.body);
}

export const GptsView: React.FC = () => {
  const [query, setQuery] = useState(currentQuery);
  const [revision, setRevision] = useState(0), [searchRevision, setSearchRevision] = useState(0);
  const [access, setAccess] = useState<GptsAccess | null>(null);
  const [discovery, setDiscovery] = useState<GptsDiscoveryResult | null>(null);
  const [search, setSearch] = useState<GptsSectionResult | null>(null);
  const [loading, setLoading] = useState(true), [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null), [searchError, setSearchError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<Record<string, string>>({});
  const [paging, setPaging] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const scroll = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const source = useRef<AbortController | null>(null), searchRequest = useRef<AbortController | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null), restoreFocus = useRef(false);
  const pageRequests = useRef(new Set<string>()), seenCursors = useRef(new Map<string, Set<string>>());
  const categoryNodes = useRef(new Map<string, HTMLElement>());
  const closeDetail = useCallback(() => { restoreFocus.current = true; setDetail(null); }, []);
  const updateResource = useCallback((resource: GptResource, assets: GptAssetRef[]) => {
    const replaceAssets = (previous: GptAssetRef[]) => [...assets.filter(asset => asset.id === resource.id), ...previous.filter(asset => asset.id !== resource.id)];
    const replaceSection = (section: GptSection) => ({ ...section, items: section.items.map(item => item.id === resource.id ? resource : item) });
    setDiscovery(value => value ? { ...value, sections: value.sections.map(replaceSection), assets: replaceAssets(value.assets) } : value);
    setSearch(value => value ? { ...replaceSection(value), assets: replaceAssets(value.assets) } : value);
  }, []);
  useLayoutEffect(() => {
    if (!detail && restoreFocus.current) { restoreFocus.current = false; if (detailTrigger.current?.isConnected) detailTrigger.current.focus(); }
  }, [detail]);
  useEffect(() => {
    const onPopState = () => setQuery(currentQuery()); window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const updateQuery = (value: string) => {
    setQuery(value); const url = new URL(window.location.href);
    if (value) url.searchParams.set("search", value); else url.searchParams.delete("search");
    window.history.replaceState(window.history.state, "", url);
  };
  useEffect(() => {
    const controller = new AbortController(); source.current = controller;
    let unlisten: (() => void) | undefined;
    setAccess(null); setDiscovery(null); setSearch(null); setDetail(null); setError(null); setLoading(true);
    setPaging([]); setPageError({}); pageRequests.current.clear(); seenCursors.current.clear();
    void (async () => {
      try {
        const unsubscribe = await tauriListen("chatgpt-service:invalidated", () => {
          if (controller.signal.aborted) return;
          controller.abort(); searchRequest.current?.abort(); setAccess(null); setDiscovery(null); setSearch(null); setDetail(null);
          setRevision(value => value + 1);
        });
        if (controller.signal.aborted) { unsubscribe(); return; } unlisten = unsubscribe;
        const current = await readGptsAccess(controller.signal);
        if (controller.signal.aborted) return; setAccess(current);
        if (!current.available || current.seatAccess) return;
        const result = await readGptsDiscovery(current, controller.signal);
        if (!controller.signal.aborted) setDiscovery(result);
      } catch (cause) { if (!controller.signal.aborted) setError(serviceErrorMessage(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); searchRequest.current?.abort(); unlisten?.(); };
  }, [revision]);
  useEffect(() => {
    searchRequest.current?.abort(); setSearch(null); setSearchError(null); setSearchLoading(false);
    pageRequests.current.delete("search"); seenCursors.current.delete("search");
    setPaging(value => value.filter(id => id !== "search")); setPageError(value => ({ ...value, search: "" }));
    if (!query.trim() || !access?.available || access.seatAccess || source.current?.signal.aborted) return;
    const controller = new AbortController(); searchRequest.current = controller; setSearchLoading(true);
    const timer = setTimeout(() => {
      void readGptsSearch(access, query.trim(), null, controller.signal).then(result => { if (!controller.signal.aborted) setSearch(result); })
        .catch(cause => { if (!controller.signal.aborted) setSearchError(serviceErrorMessage(cause)); })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, access, searchRevision]);

  const loadMore = async (section: GptSection) => {
    const isSearch = section.id === "search", controller = isSearch ? searchRequest.current : source.current;
    if (!access || !controller || controller.signal.aborted || !section.cursor || pageRequests.current.has(section.id)) return;
    pageRequests.current.add(section.id); setPaging(value => [...value, section.id]); setPageError(value => ({ ...value, [section.id]: "" }));
    try {
      const page = isSearch ? await readGptsSearch(access, query.trim(), section.cursor, controller.signal)
        : await readGptsCategory(access, section, section.locale ?? discovery?.locale ?? null, controller.signal);
      const seen = seenCursors.current.get(section.id) ?? new Set<string>();
      if (page.cursor && (page.cursor === section.cursor || seen.has(page.cursor))) throw Error("GPT 服务返回了重复分页游标，请刷新。");
      if (controller.signal.aborted) return;
      seen.add(section.cursor); seenCursors.current.set(section.id, seen);
      if (isSearch) setSearch(value => value ? { ...appendGptPage(value, page), assets: [...page.assets, ...value.assets.filter(asset => !page.items.some(item => item.id === asset.id))] } : value);
      else setDiscovery(value => value ? { ...value, sections: value.sections.map(item => item.id === section.id ? appendGptPage(item, page) : item), assets: [...page.assets, ...value.assets.filter(asset => !page.items.some(item => item.id === asset.id))] } : value);
    } catch (cause) { if (!controller.signal.aborted) setPageError(value => ({ ...value, [section.id]: serviceErrorMessage(cause) })); }
    finally { if (!controller.signal.aborted) { pageRequests.current.delete(section.id); setPaging(value => value.filter(id => id !== section.id)); } }
  };
  const visibleSections = query.trim() ? search ? [search] : [] : discovery?.sections ?? [];
  const categories = (discovery?.sections ?? []).filter((section, index, sections) => section.displayGroup != null && sections.findIndex(item => item.displayGroup === section.displayGroup) === index);
  const assets = query.trim() ? search?.assets ?? [] : discovery?.assets ?? [];
  const searchField = <div className="gpts-search-wrap"><Search size={18} aria-hidden="true" /><input type="search" aria-label="搜索 GPT" placeholder="搜索 GPT" value={query} maxLength={256} onChange={event => updateQuery(event.target.value)} />{query && <button aria-label="清除搜索" onClick={() => updateQuery("")}><X size={16} /></button>}</div>;
  const newLayout = access?.newLayout === true;
  return <div className={`gpts-view-container${newLayout ? " gpts-layout-wide" : ""}`} inert={detail != null}>
    <div className="gpts-scroll" ref={scroll}>
      {newLayout && <LibraryStickyHeader title="GPT" description={description} newLayout scrollContainerRef={scroll} bodyRef={body} actions={searchField} />}
      <div className="gpts-page-content" ref={body}>
        {!newLayout && <header className="gpts-page-header"><h1>GPT</h1><p>{description}</p>{searchField}</header>}
        <div className="gpts-catalog">
          {error && <div className="gpts-state"><h2>无法加载 GPT</h2><p role="alert">{error}</p><button onClick={() => setRevision(value => value + 1)}>重试</button></div>}
          {!error && loading && !query.trim() && <p className="gpts-state" role="status">正在加载 GPT…</p>}
          {!loading && !error && access && (!access.available || access.seatAccess) && <p className="gpts-state" role="status">{access.seatAccess ? "当前工作空间尚未授予 ChatGPT 访问权限。" : "当前账号暂不支持 GPT。"}</p>}
          {!query.trim() && categories.length > 0 && <nav className="gpts-categories" aria-label="GPT 类别">{categories.map(category => <button key={category.id} aria-current={(selectedCategory ?? categories[0]?.id) === category.id ? "true" : undefined} onClick={() => {
            setSelectedCategory(category.id); categoryNodes.current.get(category.id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
          }}>{category.displayGroup}</button>)}</nav>}
          {!query.trim() && discovery?.workspaceFiltered && <p className="gpts-workspace-notice">你工作空间的 GPT 设置限制了此处显示的 GPT</p>}
          {query.trim() && searchLoading && <p className="gpts-state" role="status">正在搜索 GPT…</p>}
          {query.trim() && searchError && <div className="gpts-state"><h2>无法加载 GPT</h2><p role="alert">{searchError}</p><button onClick={() => setSearchRevision(value => value + 1)}>重试</button></div>}
          {query.trim() && search && !search.items.length && !search.cursor && <div className="gpts-state" role="status"><h2>未找到 GPT</h2><p>换个搜索词试试</p></div>}
          {!query.trim() && !loading && !error && discovery && !discovery.sections.length && <p className="gpts-state" role="status">暂无可用的 GPT</p>}
          {visibleSections.map(section => <section key={section.id} className="gpts-section" ref={node => { if (node) categoryNodes.current.set(section.id, node); else categoryNodes.current.delete(section.id); }} aria-labelledby={`gpt-section-${section.id}`}>
            <h2 id={`gpt-section-${section.id}`} className={section.id === "search" ? "gpts-sr-only" : undefined}>{section.id === "search" ? "GPT 搜索结果" : section.title}</h2>
            {section.description && <p className="gpts-section-description">{section.description}</p>}
            <div className="gpts-grid">{section.items.map((gpt, index) => {
              const restricted = access && gptRestriction(gpt.tags, access);
              const content = <>{section.displayType !== "featured" && section.id !== "search" && <span className="gpt-rank">{index + 1}</span>}{access && source.current && <GptAvatar asset={assets.find(item => item.id === gpt.id) ?? null} access={access} scope={(section.id === "search" ? searchRequest.current : source.current)?.signal ?? source.current.signal} />}<span className="gpt-card-body"><span className="gpt-card-title"><strong>{gpt.name}</strong>{restricted && <span className="gpt-restriction-badge">受限</span>}</span><span className="gpt-desc">{gpt.description}</span><span className="gpt-card-meta">{gpt.author && <span>作者：{gpt.author}</span>}{gpt.author && gpt.usage && <span aria-hidden="true">·</span>}{gpt.usage && <span className="gpt-usage"><MessageCircle size={12} aria-hidden="true" />{gpt.usage}</span>}</span>{restricted && <span className="gpt-restriction"><AlertTriangle size={14} aria-hidden="true" />{restrictions[restricted]}</span>}</span></>;
              return restricted ? <div className="gpt-card gpt-card-restricted" tabIndex={-1} key={gpt.id}>{content}</div>
                : <button className="gpt-card" type="button" key={gpt.id} onClick={event => { detailTrigger.current = event.currentTarget; setDetail({ id: gpt.id, resource: gpt, assets }); }}>{content}</button>;
            })}</div>
            {pageError[section.id] && <p className="gpts-page-error" role="alert">{pageError[section.id]}</p>}
            {section.cursor && <div className="gpts-more"><button disabled={paging.includes(section.id)} onClick={() => void loadMore(section)}>{paging.includes(section.id) ? "正在加载…" : pageError[section.id] ? "重试" : "查看更多"}</button></div>}
          </section>)}
        </div>
      </div>
    </div>
    {detail && access && source.current && <GptDetail key={detail.id} state={detail} access={access} scope={source.current.signal} onClose={closeDetail} onResource={updateResource} />}
  </div>;
};
