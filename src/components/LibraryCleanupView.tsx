import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, File, Folder, Grid2X2, List } from "lucide-react";
import { tauriListen } from "../bridge";
import { readLibraryAccess, readLibraryImage, readLibraryPage, type LibraryAccess, type LibraryTab } from "../libraryClient";
import { mergeLibraryPages, nextLibraryCursor, sortLibraryItems, type LibraryItem, type LibraryPage, type LibrarySort } from "../libraryData";
import { formatStorageBytes } from "../storageUsage";
import "./LibraryCleanupView.css";

interface Snapshot {
  key: string;
  access: LibraryAccess | null;
  pages: LibraryPage[];
  cursors: (string | null)[];
  cursor: string | null;
  loading: boolean;
  fetching: boolean;
  error: string;
  pageError: string;
}

function imageKey(item: LibraryItem, access: LibraryAccess) {
  return JSON.stringify([access.identity, item.node.id, item.node.file_id, item.node.gizmo_id, item.currentVersion, item.node.updated_at,
    item.node.thumbnail_url, item.node.thumbnail_preview_url]);
}

export function libraryImageRatio(width: unknown, height: unknown): number {
  return typeof width === "number" && Number.isFinite(width) && width > 0
    && typeof height === "number" && Number.isFinite(height) && height > 0 ? Math.max(.5, width / height) : 1;
}

function LibraryArtwork({ item, access, row = false }: { item: LibraryItem; access: LibraryAccess; row?: boolean }) {
  const binding = imageKey(item, access);
  const latest = useRef(binding); latest.current = binding;
  const element = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ binding: string; src: string; loaded: boolean; ratio: number } | null>(null);
  const [failed, setFailed] = useState("");
  const candidate = item.node.library_file_category === "image" || typeof item.node.thumbnail_url === "string"
    || typeof item.node.mime_type === "string" && item.node.mime_type.startsWith("image/");
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setImage(null); setFailed("");
    const read = () => { void readLibraryImage(item, access, controller.signal).then(src => {
      if (alive && !controller.signal.aborted && latest.current === binding)
        setImage({ binding, src, loaded: false, ratio: libraryImageRatio(item.node.width, item.node.height) });
    }).catch(() => { if (alive && latest.current === binding) setFailed(binding); }); };
    let observer: IntersectionObserver | null = null;
    if (candidate) {
      if (typeof IntersectionObserver === "undefined") read();
      else if (element.current) {
        let requested = false;
        observer = new IntersectionObserver(entries => {
          if (!requested && alive && entries.some(entry => entry.isIntersecting)) {
            requested = true; observer?.disconnect(); read();
          }
        });
        observer.observe(element.current);
      }
    }
    return () => { alive = false; observer?.disconnect(); controller.abort(); };
  }, [binding, candidate]);
  const current = image?.binding === binding && failed !== binding ? image : null;
  const ratio = current?.ratio ?? libraryImageRatio(item.node.width, item.node.height);
  const Icon = item.node.kind === "directory" ? Folder : File;
  return <span ref={element} className={`library-cleanup-artwork${row ? " is-row" : ""}${current ? " has-image" : ""}`}
    style={row ? undefined : { aspectRatio: current ? ratio : 1 }}>
    {(!current || !current.loaded) && <Icon aria-hidden="true" />}
    {current && <img alt="" draggable={false} loading="lazy" src={current.src}
      className={`${!row && item.node.library_file_category === "image" && ratio > 1 ? "contain" : "cover"}${current.loaded ? " loaded" : ""}`}
      onError={() => { if (latest.current === binding) setFailed(binding); }}
      onLoad={event => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (latest.current === binding) setImage(value => value?.binding === binding
          ? { ...value, loaded: true, ratio: libraryImageRatio(naturalWidth, naturalHeight) } : value);
      }} />}
  </span>;
}

export function placeLibraryMasonry(ids: string[], heights: number[], columns: number, gap: number,
  previous: { columns: number; ids: string[]; assignments: Map<string, number> }) {
  const prefix = ids.slice(0, Math.min(ids.length, previous.ids.length)).every((id, i) => id === previous.ids[i]);
  const totals = Array(columns).fill(0) as number[];
  const assignments = new Map<string, number>();
  const positions = ids.map((id, index) => {
    const column = (previous.columns === columns && prefix ? previous.assignments.get(id) : undefined)
      ?? totals.indexOf(Math.min(...totals));
    const top = totals[column];
    assignments.set(id, column); totals[column] += heights[index] + gap;
    return { column, top };
  });
  return { positions, height: Math.max(0, ...totals) - (ids.length ? gap : 0), assignments };
}

function LibraryMasonry({ items, access }: { items: LibraryItem[]; access: LibraryAccess }) {
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef({ columns: 0, ids: [] as string[], assignments: new Map<string, number>() });
  const ids = JSON.stringify(items.map(item => item.node.id));
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const entries = Array.from(element.querySelectorAll<HTMLElement>(":scope > [data-masonry-item]"));
    let frame: number | undefined;
    const layout = () => {
      if (!element.clientWidth) return;
      const style = getComputedStyle(element);
      const columns = Math.max(1, Number(style.getPropertyValue("--masonry-columns")) || 1);
      const gap = parseFloat(style.rowGap) || 0;
      const keys = entries.map(entry => entry.dataset.masonryItem!);
      const result = placeLibraryMasonry(keys, entries.map(entry => entry.offsetHeight), columns, gap, previous.current);
      entries.forEach((entry, index) => {
        entry.style.gridColumn = String(result.positions[index].column + 1);
        entry.style.gridRow = "1"; entry.style.transform = `translateY(${result.positions[index].top}px)`;
      });
      element.style.height = `${result.height}px`;
      previous.current = { columns, ids: keys, assignments: result.assignments };
    };
    layout();
    const resize = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(element); entries.forEach(entry => observer?.observe(entry));
    return () => { observer?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [ids]);
  return <div className="library-cleanup-masonry-container"><div ref={container} className="library-cleanup-masonry">
    {items.map(item => <div key={item.node.id} data-masonry-item={item.node.id} className="library-cleanup-card" aria-label={item.node.name}>
      <LibraryArtwork item={item} access={access} />
    </div>)}
  </div></div>;
}

export function LibraryCleanupView({ scope, tab, onTabChange }: {
  scope: string; tab: LibraryTab; onTabChange: (tab: LibraryTab) => void;
}) {
  const key = JSON.stringify([scope, tab]);
  const currentKey = useRef(key); currentKey.current = key;
  const epoch = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [retry, setRetry] = useState(0);
  const [preference, setPreference] = useState<{ scope: string; view: "list" | "grid"; sort: LibrarySort | null } | null>(null);
  const view = tab === "images" ? "grid" : preference?.scope === scope ? preference.view : "list";
  const sort: LibrarySort | null = preference?.scope === scope ? preference.sort : { key: "size", direction: "desc" };
  const changePreference = (change: { view?: "list" | "grid"; sort?: LibrarySort | null }) => setPreference({ scope, view, sort, ...change });
  const next = useRef<() => void>(() => {});
  const sentinel = useRef<HTMLDivElement>(null);
  const state = snapshot?.key === key ? snapshot : null;
  useEffect(() => {
    let alive = true, ready = false, invalidated = false, listeningFailed = false;
    let controller: AbortController | null = null;
    let data: Snapshot | null = null;
    const stops: (() => void)[] = [];
    const validKey = () => alive && currentKey.current === key;
    const publish = (value: Snapshot) => { data = value; if (validKey()) setSnapshot(value); };
    const load = async (append = false) => {
      if (!validKey() || !ready || invalidated || listeningFailed || (append && (!data?.cursor || data.fetching))) return;
      const ticket = ++epoch.current;
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      const valid = () => validKey() && epoch.current === ticket && !signal.aborted;
      const before = append ? data : null;
      const cursor = before?.cursor ?? null;
      const initial: Snapshot = before ? { ...before, fetching: true, pageError: "" }
        : { key, access: null, pages: [], cursors: [], cursor: null, loading: true, fetching: false, error: "", pageError: "" };
      publish(initial);
      try {
        const access = before?.access ?? await readLibraryAccess(signal);
        if (!valid()) return;
        if (!access.available) { publish({ ...initial, access, loading: false, fetching: false }); return; }
        const page = await readLibraryPage(access, tab, cursor, signal);
        if (!valid()) return;
        const cursors = [...initial.cursors, cursor];
        publish({ ...initial, access, pages: [...initial.pages, page], cursors,
          cursor: nextLibraryCursor(page, cursors), loading: false, fetching: false });
      } catch (cause) {
        if (valid()) publish({ ...initial, loading: false, fetching: false,
          error: before ? "" : String(cause), pageError: before ? String(cause) : "" });
      }
    };
    const refresh = () => { if (validKey()) { invalidated = false; void load(); } };
    const invalidate = () => {
      if (!validKey()) return;
      invalidated = true; ++epoch.current; controller?.abort();
      publish({ key, access: null, pages: [], cursors: [], cursor: null, loading: false, fetching: false,
        error: "账号状态已变化，请重新读取资料库。", pageError: "" });
    };
    next.current = () => { void load(true); };
    const register = async (name: string, handler: (payload: any) => void) => {
      const stop = await tauriListen(name, handler);
      if (alive) stops.push(stop); else stop();
    };
    void Promise.all([
      register("app-server:notification", payload => { if (payload?.method === "account/updated") refresh(); }),
      register("app-server:status", refresh), register("chatgpt-service:invalidated", invalidate),
    ]).then(() => { ready = true; if (validKey()) void load(); }).catch(cause => {
      listeningFailed = true;
      if (validKey()) publish({ key, access: null, pages: [], cursors: [], cursor: null, loading: false, fetching: false,
        error: `资料库同步失败：${String(cause)}`, pageError: "" });
    });
    return () => { alive = false; ++epoch.current; controller?.abort(); stops.forEach(stop => stop()); };
  }, [key, retry]);
  useEffect(() => {
    if (!state?.cursor || state.fetching || state.pageError || !sentinel.current) return;
    if (typeof IntersectionObserver === "undefined") { next.current(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); next.current(); }
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [key, state?.pages.length, state?.cursor, state?.fetching, state?.pageError]);
  const merged = mergeLibraryPages(state?.pages ?? []);
  const items = sort ? sortLibraryItems(merged, sort) : merged;
  const toggleSort = (column: LibrarySort["key"]) => {
    const direction = column === "name" ? "asc" : "desc";
    changePreference({ sort: sort?.key === column ? sort.direction === direction
      ? { key: column, direction: direction === "asc" ? "desc" : "asc" } : null : { key: column, direction } });
  };
  const sortHeader = (column: LibrarySort["key"], label: string) => <div role="columnheader"
    className={`library-cleanup-${column}`} aria-sort={sort?.key !== column ? "none" : sort.direction === "asc" ? "ascending" : "descending"}>
    <button type="button" onClick={() => toggleSort(column)}>{label}{sort?.key === column
      && (sort.direction === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />)}</button>
  </div>;
  return <section className="library-cleanup" aria-label="资料库" aria-busy={!state || state.loading}>
    <header className="library-cleanup-header"><h1>资料库</h1>
      <div className="library-cleanup-navigation"><nav aria-label="资料库分区">
        {(["all", "images"] as const).map(value => <button type="button" key={value} aria-current={tab === value ? "page" : undefined}
          onClick={() => { if (value !== tab) onTabChange(value); }}>{value === "all" ? "全部" : "图像"}</button>)}
      </nav>{tab !== "images" && <div className="library-cleanup-view-toggle">
        <button type="button" title="网格" aria-label="网格视图" aria-pressed={view === "grid"} onClick={() => changePreference({ view: "grid" })}><Grid2X2 /></button>
        <button type="button" title="列表" aria-label="列表视图" aria-pressed={view === "list"} onClick={() => changePreference({ view: "list" })}><List /></button>
      </div>}</div>
    </header>
    {!state || state.loading ? <div role="status" className="library-cleanup-loading">正在加载资料库</div>
      : state.error ? <div role="alert" className="library-cleanup-error">文件加载失败。<p>{state.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div>
      : state.access?.available === false ? <div role="status" className="library-cleanup-empty">当前账号暂不支持资料库。</div>
      : state.access && <>
        {items.length === 0 && !state.cursor ? <div className="library-cleanup-empty"><File aria-hidden="true" />
          <h2>{tab === "images" ? "暂无图像" : "创建新内容"}</h2>
          <p>{tab === "images" ? "使用 ChatGPT 创建图像。" : "你使用 ChatGPT 创建的内容（如图像和文档）将显示在这里"}</p>
        </div> : view === "list" ? <div role="grid" aria-label="资料库文件" className="library-cleanup-list">
          <div className="library-cleanup-row-header"><div role="row" className="library-cleanup-row">
            {sortHeader("name", "名称")}<div role="columnheader" className="library-cleanup-date">修改日期</div>{sortHeader("size", "大小")}<span className="library-cleanup-actions" />
          </div></div>
          {items.map(item => <div className="library-cleanup-row-container" key={item.node.id}><div role="row" className="library-cleanup-row">
            <div role="gridcell" className="library-cleanup-name"><LibraryArtwork item={item} access={state.access!} row /><span title={item.node.name}>{item.node.name}</span></div>
            <div role="gridcell" className="library-cleanup-date">{formatModified(item.node.updated_at ?? item.node.file_upload_time)}</div>
            <div role="gridcell" className="library-cleanup-size">{item.node.kind === "file" && typeof item.node.file_size_bytes === "number" && Number.isFinite(item.node.file_size_bytes) && item.node.file_size_bytes >= 0 ? formatStorageBytes(item.node.file_size_bytes) : "—"}</div>
            <span className="library-cleanup-actions" />
          </div></div>)}
        </div> : <LibraryMasonry items={items} access={state.access} />}
        {state.pageError && <div role="alert" className="library-cleanup-page-error">文件加载失败。<p>{state.pageError}</p><button type="button" onClick={() => next.current()}>重试</button></div>}
        {state.fetching && <div role="status" className="library-cleanup-page-loading">正在加载资料库</div>}
        {state.cursor && !state.pageError && <div ref={sentinel} className="library-cleanup-sentinel" aria-hidden="true" />}
      </>}
  </section>;
}

function formatModified(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}
