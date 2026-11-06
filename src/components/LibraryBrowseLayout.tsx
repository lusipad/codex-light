import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { File, FileImage, Folder, SlidersHorizontal, Check } from "lucide-react";
import { createPortal } from "react-dom";
import { readLibraryImage, type LibraryAccess } from "../libraryClient";
import { libraryBrowseCategories, libraryBrowseDate, type LibraryBrowseCategory, type LibraryBrowseMode, type LibraryBrowseScope, type LibraryBrowseSort, type LibraryBrowseSource } from "../libraryBrowse";
import type { LibraryItem, LibraryNode } from "../libraryData";
import { formatStorageBytes } from "../storageUsage";
import "./LibraryBrowseLayout.css";

const sources: Record<LibraryBrowseSource, string> = { uploaded: "已上传", generated: "生成的文件" };
const image = (item: LibraryItem) => item.node.kind === "file" && item.node.library_file_category === "image";
const dateText = (item: LibraryItem, suggested: boolean) => {
  const value = libraryBrowseDate(item, suggested);
  return Number.isFinite(value) ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(value) : "—";
};

export const LibraryBrowseFilters: React.FC<{ scope: LibraryBrowseScope; showCategories: boolean; onChange: (categories: LibraryBrowseCategory[], sources: LibraryBrowseSource[]) => void }> = ({ scope, showCategories, onChange }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const count = (showCategories ? scope.categories.length : 0) + scope.sources.length;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current?.getBoundingClientRect(); if (!box) return;
      const height = Math.min(menu.current?.offsetHeight ?? 320, 400), below = window.innerHeight - box.bottom - 12;
      const upward = below < height && box.top > below;
      setPosition({ left: Math.max(8, Math.min(box.right - 240, window.innerWidth - 248)),
        top: upward ? Math.max(8, box.top - height - 4) : box.bottom + 4,
        maxHeight: Math.max(40, upward ? box.top - 12 : below) });
    };
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    place(); menu.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const choices = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ?? []);
    const index = choices.indexOf(event.target as HTMLButtonElement);
    choices[event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
  };
  return <div className="library-browse-filter-control">
    <button type="button" ref={trigger} className="library-browse-icon-button" title="筛选" aria-haspopup="menu" aria-expanded={open}
      aria-label={count ? `打开筛选器，${count} 个筛选器已开启` : "打开筛选器"} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (!event.nativeEvent.isComposing && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <SlidersHorizontal size={16} aria-hidden="true" />{count > 0 && <span aria-hidden="true">{count}</span>}
    </button>
    {open && createPortal(<div ref={menu} role="menu" aria-label="筛选" className="library-browse-filter-menu" style={position} onKeyDown={keyDown}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) setOpen(false); }}>
      {showCategories && <><div className="library-browse-filter-heading">文件类型</div>{(Object.keys(libraryBrowseCategories) as LibraryBrowseCategory[]).map(category => <button key={category} type="button" role="menuitemcheckbox"
        aria-checked={scope.categories.includes(category)} onClick={event => { event.preventDefault(); onChange(scope.categories.includes(category) ? scope.categories.filter(value => value !== category) : [...scope.categories, category], scope.sources); }}>
        <span>{libraryBrowseCategories[category]}</span>{scope.categories.includes(category) && <Check size={16} aria-hidden="true" />}
      </button>)}</>}
      <div className="library-browse-filter-heading">来源</div>{(Object.keys(sources) as LibraryBrowseSource[]).map(source => <button key={source} type="button" role="menuitemcheckbox"
        aria-checked={scope.sources.includes(source)} onClick={event => { event.preventDefault(); onChange(scope.categories, scope.sources.includes(source) ? scope.sources.filter(value => value !== source) : [...scope.sources, source]); }}>
        <span>{sources[source]}</span>{scope.sources.includes(source) && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>, document.body)}
  </div>;
};

const LibraryImageArtwork: React.FC<{ item: LibraryItem; access: LibraryAccess }> = ({ item, access }) => {
  const [state, setState] = useState<{ key: string; url?: string; loaded?: boolean; error?: boolean; aspect?: number } | null>(null);
  const artwork = useRef<HTMLSpanElement>(null);
  const request = useRef<AbortController | null>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible || !artwork.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(artwork.current); return () => observer.disconnect();
  }, [visible]);
  const version = item.currentVersion ?? item.node.current_version_number ?? 0;
  // Tn's card asset uses updated_at; the metadata-prefetch m uses
  // file_upload_time. Track both observed inputs without inventing precedence.
  // The shared asset p ignores modified timestamps when a version is present.
  const key = JSON.stringify([access.identity, item.node.id, item.node.file_id, item.node.gizmo_id,
    version, version ? null : item.node.updated_at ?? null, version ? null : item.node.file_upload_time ?? null]);
  const currentKey = useRef(key); currentKey.current = key;
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController(); request.current = controller; setState({ key });
    void readLibraryImage(item, access, controller.signal).then(url => {
      if (!controller.signal.aborted) setState({ key, url });
    }, () => { if (!controller.signal.aborted) setState({ key, error: true }); });
    return () => controller.abort();
  }, [key, visible]);
  const current = state?.key === key ? state : null;
  const width = item.node.width, height = item.node.height;
  const ratio = typeof width === "number" && typeof height === "number" && width > 0 && height > 0 ? Math.max(.5, width / height) : 1;
  return <span ref={artwork} className="library-browse-image" style={{ aspectRatio: current?.aspect ?? ratio }} aria-busy={!current?.loaded && !current?.error}>
    {current?.url && !current.error && <img src={current.url} alt="" loading="lazy" draggable={false} style={{ opacity: current.loaded ? 1 : 0 }}
      onLoad={event => {
        if (request.current?.signal.aborted || currentKey.current !== key || event.currentTarget.src !== current.url) return;
        const { naturalWidth, naturalHeight } = event.currentTarget;
        setState(previous => previous?.key === key && previous.url === current.url ? { ...previous, loaded: true,
          aspect: naturalWidth > 0 && naturalHeight > 0 ? Math.max(.5, naturalWidth / naturalHeight) : 1 } : previous);
      }}
      onError={() => { if (!request.current?.signal.aborted && currentKey.current === key) setState(previous => previous?.key === key && previous.url === current.url ? { ...previous, error: true } : previous); }} />}
    {current?.error ? <FileImage size={48} aria-label="图像预览不可用" /> : !current?.loaded ? <span className="library-browse-image-loading" aria-label="正在加载图像" /> : null}
  </span>;
};

export const LibraryMasonry: React.FC<{ children: React.ReactNode; ids: string[] }> = ({ children, ids }) => {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<{ columns: number; ids: string[]; assignments: Map<string, number> }>({ columns: 0, ids: [], assignments: new Map() });
  const key = JSON.stringify(ids);
  useLayoutEffect(() => {
    const element = root.current; if (!element || typeof ResizeObserver === "undefined") return;
    const nodes = Array.from(element.querySelectorAll<HTMLElement>(":scope > [data-masonry-item]"));
    const place = () => {
      if (!element.clientWidth) return;
      const style = getComputedStyle(element), columns = Number(style.getPropertyValue("--masonry-columns")) || 1, gap = parseFloat(style.rowGap) || 0;
      const prefix = ids.slice(0, Math.min(ids.length, previous.current.ids.length)).every((id, index) => id === previous.current.ids[index]);
      const heights = Array<number>(columns).fill(0), assignments = new Map<string, number>();
      nodes.forEach((node, index) => {
        const id = ids[index], column = (prefix && columns === previous.current.columns ? previous.current.assignments.get(id) : undefined) ?? heights.indexOf(Math.min(...heights));
        node.style.gridColumn = String(column + 1); node.style.gridRow = "1"; node.style.transform = `translateY(${heights[column]}px)`;
        heights[column] += node.getBoundingClientRect().height + gap; assignments.set(id, column);
      });
      element.style.height = `${Math.max(0, ...heights) - (nodes.length ? gap : 0)}px`;
      previous.current = { columns, ids, assignments };
    };
    const observer = new ResizeObserver(place); observer.observe(element); nodes.forEach(node => observer.observe(node)); place();
    return () => observer.disconnect();
  }, [key]);
  return <div className="library-masonry-container"><div ref={root} className="library-browse-masonry">{children}</div></div>;
};

interface LayoutProps {
  items: LibraryItem[]; mode: LibraryBrowseMode; scope: LibraryBrowseScope; access: LibraryAccess; loading: boolean; paging: boolean;
  sort: LibraryBrowseSort | null; onSort: (key: LibraryBrowseSort["key"]) => void;
  onOpen: (node: LibraryNode, trigger: HTMLButtonElement) => void; canOpen: (node: LibraryNode) => boolean;
}
export const LibraryBrowseLayout: React.FC<LayoutProps> = ({ items, mode, scope, access, loading, paging, sort, onSort, onOpen, canOpen }) => {
  const suggested = scope.directoryId === null && (Boolean(scope.search.trim()) || scope.tab === "suggested");
  const size = scope.directoryId !== null || scope.tab === "all" && !scope.search.trim();
  const heading = suggested ? "最近活动时间" : "修改日期";
  const icon = (item: LibraryItem, card = false) => item.node.kind === "directory" ? <Folder size={card ? 48 : 20} aria-hidden="true" /> : image(item) ? <FileImage size={card ? 48 : 20} aria-hidden="true" /> : <File size={card ? 48 : 20} aria-hidden="true" />;
  const skeletons = Array.from({ length: loading ? 6 : paging ? 3 : 0 }, (_, i) => <div key={`loading-${i}`} data-masonry-item="" className={`library-browse-skeleton skeleton-${i % 3}`} aria-hidden="true" />);
  if (mode === "list") {
    const column = (key: LibraryBrowseSort["key"], name: string, className: string) => <div role="columnheader" data-library-column={key} className={className} aria-sort={sort?.key === key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
      <button type="button" disabled={loading || Boolean(scope.search.trim())} onClick={() => onSort(key)}>{name}{sort?.key === key ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button>
    </div>;
    return <div role="grid" aria-label="资料库文件" aria-busy={loading || paging} className="library-browse-list" onKeyDown={event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const row = (event.target as HTMLElement).closest('[role="row"]');
      if (!row) return;
      const rows = Array.from(event.currentTarget.querySelectorAll('[role="row"]'));
      const column = (event.target as HTMLElement).closest<HTMLElement>('[data-library-column]');
      const cells = (element: Element) => Array.from(element.querySelectorAll<HTMLElement>('[data-library-column]')).filter(cell => getComputedStyle(cell).display !== "none" && cell.querySelector('button:not(:disabled)'));
      let cell: HTMLElement | undefined;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) cell = cells(next).find(candidate => candidate.dataset.libraryColumn === column?.dataset.libraryColumn) ?? cells(next).find(candidate => candidate.dataset.libraryColumn === "name");
      } else {
        const choices = cells(row), direction = getComputedStyle(row).direction === "rtl" ? -1 : 1;
        cell = choices[choices.indexOf(column as HTMLElement) + (event.key === "ArrowRight" ? direction : -direction)];
      }
      const target = cell?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (target) { event.preventDefault(); target.focus(); target.scrollIntoView({ block: "nearest" }); }
    }}>
      <div role="row" className="library-browse-list-header">{column("name", "名称", "library-browse-name")}{column("date", heading, "library-browse-date")}{size && column("size", "大小", "library-browse-size")}</div>
      {!loading && items.map(item => <div key={item.node.id} role="row" data-library-item={item.node.id} className="library-browse-list-row">
        <div role="gridcell" data-library-column="name" className="library-browse-name">{icon(item)}{canOpen(item.node) ? <button type="button" className="library-directory-link" onClick={event => onOpen(item.node, event.currentTarget)} title={item.node.name}>{item.node.name}</button> : <span>{item.node.name}</span>}</div>
        <div role="gridcell" data-library-column="date" className="library-browse-date">{dateText(item, suggested)}</div>
        {size && <div role="gridcell" data-library-column="size" className="library-browse-size">{typeof item.node.file_size_bytes === "number" && Number.isFinite(item.node.file_size_bytes) && item.node.file_size_bytes >= 0 ? formatStorageBytes(item.node.file_size_bytes) : "—"}</div>}
      </div>)}
      {skeletons.map((node, index) => <div key={index} className="library-browse-list-skeleton" aria-hidden="true" />)}
    </div>;
  }
  const cards = (entries: LibraryItem[]) => entries.map(item => { const Tag = canOpen(item.node) ? "button" : "div"; return <div key={item.node.id} data-library-item={item.node.id} data-masonry-item="" className="library-browse-card-wrap">
    <Tag type={Tag === "button" ? "button" : undefined} className={`library-browse-card ${item.node.kind === "directory" ? "folder-card" : image(item) ? "image-card" : ["site", "site_preview"].includes(String(item.node.library_artifact_type)) || item.node.library_file_category === "video" ? "landscape-card" : "document-card"}`}
      data-disabled={!canOpen(item.node) || undefined} onClick={canOpen(item.node) ? event => onOpen(item.node, event.currentTarget as HTMLButtonElement) : undefined} title={item.node.name} aria-label={Tag === "button" ? item.node.name : undefined}>
      {!image(item) && <span className="library-browse-card-title">{icon(item)}<span>{item.node.name}</span></span>}
      {image(item) && canOpen(item.node) ? <LibraryImageArtwork key={item.node.id} item={item} access={access} /> : <span className="library-browse-card-artwork">{icon(item, true)}</span>}
      {image(item) && <span className="library-browse-card-title"><span>{item.node.name}</span></span>}
    </Tag>
  </div>; });
  const section = (entries: LibraryItem[], pending: boolean) => !scope.search.trim() && (entries.length > 0 && entries.every(item => item.node.kind === "directory") || scope.tab === "folders" && scope.directoryId === null)
    ? <div className="library-browse-folders">{cards(entries)}{pending && skeletons}</div>
    : <LibraryMasonry ids={[...entries.map(item => item.node.id), ...(pending ? skeletons.map((_, index) => `loading-${index}`) : [])]}>{cards(entries)}{pending && skeletons}</LibraryMasonry>;
  const folders = items.filter(item => item.node.kind === "directory"), files = items.filter(item => item.node.kind !== "directory");
  const grouped = !loading && !scope.search.trim() && (scope.directoryId !== null || scope.tab === "all") && folders.length > 0 && files.length > 0;
  return <div className="library-browse-grid" aria-busy={loading || paging}>{grouped ? <>
    <section><h2>文件夹</h2>{section(folders, false)}</section><section><h2>项目</h2>{section(files, paging)}</section>
  </> : section(loading ? [] : items, loading || paging)}</div>;
};
