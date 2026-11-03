import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { readChatgptService, serviceErrorMessage, serviceIdentity, type ServiceIdentity } from "../chatgptService";
import "./GptsView.css";

interface Gpt { id: string; name: string; description: string; author?: string }
interface Section { id: string; title: string; items: Gpt[]; cursor: string | null }
function gptResource(value: any): Gpt | null {
  const gpt = value?.resource?.gizmo;
  if (!gpt || typeof gpt.id !== "string" || !gpt.id) throw Error("GPT 服务返回了无法识别的资源。");
  if (gpt.gizmo_type === "snorlax") return null;
  return { id: gpt.id, name: gpt.display?.name || gpt.id, description: gpt.display?.description || "", author: gpt.author?.display_name || gpt.author?.name };
}
export function parseGptSection(value: any): Section {
  if (typeof value?.info?.id !== "string" || !Array.isArray(value?.list?.items) ||
    (value.list.cursor != null && typeof value.list.cursor !== "string")) throw Error("GPT 目录响应格式无法识别。");
  const items = value.list.items.map(gptResource).filter((item: Gpt | null): item is Gpt => item !== null);
  return { id: value.info.id, title: value.info.title || value.info.id, items, cursor: value.list.cursor || null };
}
export function parseGptDiscovery(value: any): Section[] {
  if (!Array.isArray(value?.cuts)) throw Error("GPT 目录响应格式无法识别。");
  return value.cuts.map(parseGptSection).filter((section: Section) => section.items.length || section.cursor);
}
export function parseGptSearch(value: any): Section {
  if (!Array.isArray(value?.items) || (value.cursor != null && typeof value.cursor !== "string"))
    throw Error("GPT 搜索响应格式无法识别。");
  return { id: "search", title: "搜索结果", items: value.items.map((resource: any) => gptResource({ resource })).filter((item: Gpt | null): item is Gpt => item !== null), cursor: value.cursor || null };
}
export function appendGptPage(section: Section, page: Section): Section {
  if (section.id !== page.id) throw Error("GPT 分类在读取期间发生变化，请刷新。");
  const items = new Map(section.items.map(item => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return { ...section, items: [...items.values()], cursor: page.cursor };
}

export const GptsView: React.FC = () => {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Section | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const searchRequest = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<Record<string, string>>({});
  const [paging, setPaging] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Gpt | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const identity = useRef<ServiceIdentity | null>(null);
  const source = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const pageRequests = useRef(new Set<string>());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let disposed = false;
    const subscription = tauriListen("chatgpt-service:invalidated", () => {
      if (disposed) return;
      source.current?.abort(); searchRequest.current?.abort(); detailRequest.current?.abort(); identity.current = null; setSearch(null);
      setSections([]); setSelectedId(null); setRevision(value => value + 1);
    });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, []);

  useEffect(() => {
    const controller = new AbortController(); source.current = controller;
    identity.current = null; pageRequests.current.clear(); setPaging([]); setPageError({});
    setSections([]); setLoading(true); setError(null); setSelectedId(null);
    void (async () => {
      try {
        const current = await serviceIdentity(controller.signal);
        const result = await readChatgptService("gpts_discovery", {}, current, controller.signal);
        if (controller.signal.aborted) return;
        const parsed = parseGptDiscovery(result);
        identity.current = current; setSections(parsed);
      } catch (cause) { if (!controller.signal.aborted) setError(serviceErrorMessage(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); searchRequest.current?.abort(); detailRequest.current?.abort(); };
  }, [revision]);

  useEffect(() => {
    const current = identity.current;
    setSearch(null); setSearchError(null); setSearchLoading(false);
    if (!query.trim() || loading || !current) return;
    const controller = new AbortController(); searchRequest.current = controller;
    setSearchLoading(true); pageRequests.current.delete("search");
    setPaging(value => value.filter(id => id !== "search"));
    setPageError(value => ({ ...value, search: "" }));
    const timer = setTimeout(() => {
      void readChatgptService("gpts_search", { q: query.trim(), limit: 20 }, current, controller.signal).then(result => {
        if (!controller.signal.aborted) setSearch(parseGptSearch(result));
      }).catch(cause => { if (!controller.signal.aborted) setSearchError(serviceErrorMessage(cause)); })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, loading, searchRevision]);

  useEffect(() => {
    if (!selectedId) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); detailTrigger.current?.focus(); };
  }, [selectedId]);

  const loadMore = async (section: Section) => {
    const isSearch = section.id === "search";
    const current = identity.current, controller = isSearch ? searchRequest.current : source.current;
    if (!current || !controller || controller.signal.aborted || !section.cursor || pageRequests.current.has(section.id)) return;
    pageRequests.current.add(section.id); setPaging(value => [...value, section.id]);
    setPageError(value => ({ ...value, [section.id]: "" }));
    try {
      let page = isSearch
        ? parseGptSearch(await readChatgptService("gpts_search", { q: query.trim(), cursor: section.cursor, limit: 20 }, current, controller.signal))
        : parseGptSection(await readChatgptService("gpts_category", { id: section.id, cursor: section.cursor, limit: 20 }, current, controller.signal));
      if (!isSearch && !page.items.length && page.cursor) page = parseGptSection(await readChatgptService("gpts_category", { id: section.id, cursor: page.cursor, limit: 20 }, current, controller.signal));
      if (page.cursor && page.cursor === section.cursor) throw Error("GPT 服务返回了重复分页游标，请重试。");
      if (page.id !== section.id) throw Error("GPT 分类在读取期间发生变化，请刷新。");
      if (!controller.signal.aborted && identity.current === current) {
        if (isSearch) setSearch(value => value ? appendGptPage(value, page) : value);
        else setSections(value => value.map(item => item.id === section.id ? appendGptPage(item, page) : item));
      }
    } catch (cause) {
      if (!controller.signal.aborted) setPageError(value => ({ ...value, [section.id]: serviceErrorMessage(cause) }));
    } finally {
      if (!controller.signal.aborted) { pageRequests.current.delete(section.id); setPaging(value => value.filter(id => id !== section.id)); }
    }
  };
  const openDetail = async (id: string) => {
    const current = identity.current;
    if (!current) return;
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setSelectedId(id); setDetail(null); setDetailError(null);
    try {
      const result = await readChatgptService("gpts_detail", { id }, current, controller.signal);
      if (controller.signal.aborted) return;
      const parsed = gptResource(result);
      if (!parsed) throw Error("此资源不是可显示的 GPT。");
      setDetail(parsed);
    } catch (cause) { if (!controller.signal.aborted) setDetailError(serviceErrorMessage(cause)); }
  };
  const closeDetail = () => { detailRequest.current?.abort(); setSelectedId(null); };
  return (
    <div className="gpts-view-container">
      <div className="gpts-header-row"><div><h2>GPTs</h2></div></div>
      <input className="gpts-search-input" type="search" aria-label="搜索 GPT" placeholder="搜索 GPT" maxLength={256} value={query} onChange={event => setQuery(event.target.value)} />
      {searchLoading && <p role="status">正在搜索 GPT…</p>}
      {searchError && <section><p role="alert">{searchError}</p><button type="button" onClick={() => setSearchRevision(value => value + 1)}>重试搜索</button></section>}
      {query.trim() && search && !search.items.length && !search.cursor && <p role="status">未找到 GPT。请尝试其他搜索。</p>}
      {loading && <p role="status">正在读取 GPTs…</p>}
      {error && <section aria-label="GPTs 服务状态"><p role="alert">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></section>}
      {!query.trim() && !loading && !error && !sections.length && <p role="status">暂无可显示的 GPTs。</p>}
      {(query.trim() ? search ? [search] : [] : sections).map(section => <section key={section.id} aria-label={section.title}>
        <h3>{section.title}</h3>
        <div className="gpts-grid">{section.items.map(gpt => <button type="button" className="gpt-card" key={gpt.id}
          onClick={event => { detailTrigger.current = event.currentTarget; void openDetail(gpt.id); }}>
          <span className="gpt-card-body"><strong>{gpt.name}</strong><span className="gpt-desc">{gpt.description}</span>{gpt.author && <span className="gpt-author">{gpt.author}</span>}</span>
        </button>)}</div>
        {pageError[section.id] && <p role="alert">{pageError[section.id]}</p>}
        {section.cursor && <button type="button" disabled={paging.includes(section.id)} onClick={() => void loadMore(section)}>{paging.includes(section.id) ? "正在加载…" : pageError[section.id] ? "重试加载" : "加载更多"}</button>}
      </section>)}
      {selectedId && <dialog ref={dialogRef} aria-label="GPT 详情" onCancel={event => { event.preventDefault(); closeDetail(); }}>
        <button type="button" onClick={closeDetail}>关闭</button>
        {detailError ? <><p role="alert">{detailError}</p><button type="button" onClick={() => void openDetail(selectedId)}>重试</button></>
          : detail ? <><h3>{detail.name}</h3><p>{detail.description}</p>{detail.author && <p>{detail.author}</p>}<p role="status">GPT 对话服务尚未接通。</p></> : <p role="status">正在读取详情…</p>}
      </dialog>}
    </div>
  );
};
