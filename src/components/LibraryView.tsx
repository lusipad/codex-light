import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage } from "../chatgptService";
import { readLibraryAccess, readLibraryDirectoryPath, readLibraryPage, type LibraryAccess } from "../libraryClient";
import { mergeLibraryPages, type LibraryDirectoryEntry, type LibraryNode, type LibraryPage } from "../libraryData";
import { formatStorageBytes } from "../storageUsage";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { LibraryPreviewPane, type LibraryPreviewRequest } from "./LibraryPreviewPane";
import "./LibraryView.css";

interface DirectoryLocation { directoryId: string | null; known: LibraryDirectoryEntry[]; search: string }
const rootLocation: DirectoryLocation = { directoryId: null, known: [], search: "" };
// Official _q defaults to native; virtual library collections are not ordinary directories.
const nativeDirectory = (id: string) => !id.startsWith("library:")
  && !/^external-(?:gdrive|box|dropbox|sharepoint|onedrive|imanage):/u.test(id);

export interface LibraryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  back: () => void;
  forward: () => void;
}
interface LibraryViewProps { onNavigationChange?: (navigation: LibraryNavigation | null) => void }

export const LibraryView: React.FC<LibraryViewProps> = ({ onNavigationChange }) => {
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<LibraryPreviewRequest | null>(null);
  const previewRef = useRef<LibraryPreviewRequest | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const previewReturnLocation = useRef<DirectoryLocation | null>(null);
  const clearPreview = useCallback(() => {
    previewRef.current?.controller.abort(); previewRef.current = null; previewReturnLocation.current = null; setPreview(null);
  }, []);
  useEffect(() => () => previewRef.current?.controller.abort(), []);
  const [location, setLocation] = useState<DirectoryLocation>(rootLocation);
  const locationRef = useRef(location);
  const history = useRef<DirectoryLocation[]>([]);
  const future = useRef<DirectoryLocation[]>([]);
  const returnLocations = useRef(new Map<string | null, DirectoryLocation>());
  const searchInput = useRef<HTMLInputElement>(null);
  const query = location.search.trim();
  const [access, setAccess] = useState<LibraryAccess | null>(null);
  const identity = useRef<LibraryAccess["identity"] | null>(null);
  const [pages, setPages] = useState<LibraryPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [path, setPath] = useState<LibraryDirectoryEntry[] | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [visibleParents, setVisibleParents] = useState(Number.MAX_SAFE_INTEGER);
  const breadcrumbRef = useRef<HTMLSpanElement>(null);
  const measurementRef = useRef<HTMLSpanElement>(null);
  const source = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const pathPending = useRef(false);
  const usedCursors = useRef(new Set<string>());
  const readPath = async (current: LibraryAccess, controller: AbortController, directoryId: string) => {
    if (controller.signal.aborted || pathPending.current) return;
    pathPending.current = true; setPathLoading(true); setPathError(null);
    try {
      const result = await readLibraryDirectoryPath(current, directoryId, controller.signal);
      if (controller.signal.aborted) return;
      if (result.at(-1)?.id !== directoryId) throw Error("文件夹路径与当前目录不符，请重试。");
      const confirmed = result.filter(entry => !entry.is_root);
      locationRef.current = { ...locationRef.current, known: confirmed }; setPath(confirmed);
    } catch (cause) { if (!controller.signal.aborted) setPathError(serviceErrorMessage(cause)); }
    finally { if (!controller.signal.aborted) { pathPending.current = false; setPathLoading(false); } }
  };
  useEffect(() => {
    const controller = new AbortController(); source.current = controller;
    let unlisten: (() => void) | undefined;
    pending.current = false; pathPending.current = false; usedCursors.current.clear();
    setPages([]); setLoading(true); setPaging(false);
    setError(null); setPageError(null); setPathError(null); setPathLoading(false);
    void (async () => {
      let accessResolved = false;
      try {
        unlisten = await tauriListen("chatgpt-service:invalidated", () => {
          if (controller.signal.aborted) return;
          clearPreview();
          controller.abort(); identity.current = null; history.current = []; future.current = []; returnLocations.current.clear(); locationRef.current = rootLocation;
          setLocation(rootLocation); setPath(null); setAccess(null); setPages([]); setRevision(value => value + 1);
        });
        if (controller.signal.aborted) { unlisten(); return; }
        const current = await readLibraryAccess(controller.signal);
        if (controller.signal.aborted) return;
        accessResolved = true;
        const previous = identity.current;
        identity.current = current.identity;
        if (previous && (previous.accountId !== current.identity.accountId || previous.userId !== current.identity.userId
          || previous.generation !== current.identity.generation)) {
          const reset = { ...rootLocation };
          clearPreview();
          controller.abort(); history.current = []; future.current = []; returnLocations.current.clear(); locationRef.current = reset;
          setLocation(reset); setAccess(null); setPages([]); setPath(null); setRevision(value => value + 1);
          return;
        }
        setAccess(current);
        if (!current.available) clearPreview();
        if (current.available) {
          if (location.directoryId !== null && path?.at(-1)?.id !== location.directoryId) void readPath(current, controller, location.directoryId);
          const page = await readLibraryPage(current, "all", null, controller.signal, location.directoryId, query);
          if (!controller.signal.aborted) setPages([page]);
        }
      } catch (cause) { if (!controller.signal.aborted) { if (!accessResolved) setAccess(null); setError(serviceErrorMessage(cause)); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); unlisten?.(); };
  }, [revision, location.directoryId, query]);
  const changeLocation = useCallback((next: DirectoryLocation) => {
    clearPreview();
    if (next.directoryId === locationRef.current.directoryId && next.search.trim() === locationRef.current.search.trim()) {
      locationRef.current = next; setLocation(next); return;
    }
    source.current?.abort(); locationRef.current = next;
    setPages([]); setPath(null); setError(null); setPageError(null); setPathError(null);
    setLoading(true); setPaging(false); setPathLoading(false); setLocation(next);
  }, [clearPreview]);
  const renderedSource = source.current;
  const navigate = (directoryId: string | null, known: LibraryDirectoryEntry[], search = "") => {
    if (location.directoryId !== locationRef.current.directoryId) return;
    if (!access?.available || !renderedSource || renderedSource !== source.current || renderedSource.signal.aborted) return;
    if ((directoryId === locationRef.current.directoryId && search === locationRef.current.search) || (directoryId !== null && !nativeDirectory(directoryId))) return;
    future.current = [];
    const previous = { ...locationRef.current, known: path ?? locationRef.current.known };
    returnLocations.current.set(previous.directoryId, previous); history.current.push(previous);
    changeLocation({ directoryId, known, search });
  };
  const replaceSearch = (value: string) => {
    const current = locationRef.current;
    if (location.directoryId !== current.directoryId || location.search !== current.search
      || !renderedSource || renderedSource !== source.current || renderedSource.signal.aborted) return;
    if (value === current.search) return;
    if (value.trim() !== current.search.trim()) {
      source.current?.abort(); setPages([]); setLoading(true); setPaging(false); setError(null); setPageError(null);
    }
    const next = { ...current, search: value }; locationRef.current = next; setLocation(next);
  };
  const openDirectory = (node: LibraryNode) => {
    if (node.kind !== "directory" || !nativeDirectory(node.id)) return;
    navigate(node.id, [...(path ?? locationRef.current.known), { id: node.id, name: node.name }]);
  };
  const back = useCallback(() => {
    const previous = history.current.pop();
    if (previous) { future.current.push(locationRef.current); changeLocation(previous); }
  }, [changeLocation]);
  const forward = useCallback(() => {
    const next = future.current.pop();
    if (next) { history.current.push(locationRef.current); changeLocation(next); }
  }, [changeLocation]);
  useEffect(() => {
    onNavigationChange?.({ canGoBack: history.current.length > 0, canGoForward: future.current.length > 0, back, forward });
  }, [location, onNavigationChange, back, forward]);
  useEffect(() => () => onNavigationChange?.(null), [onNavigationChange]);
  const cursor = pages.at(-1)?.cursor ?? null;
  const loadMore = async () => {
    const controller = source.current;
    if (location.directoryId !== locationRef.current.directoryId || controller !== renderedSource
      || !access?.available || !controller || controller.signal.aborted || !cursor || pending.current) return;
    pending.current = true; setPaging(true); setPageError(null);
    try {
      const page = await readLibraryPage(access, "all", cursor, controller.signal, location.directoryId, query);
      if (controller.signal.aborted) return;
      if (page.cursor && (page.cursor === cursor || usedCursors.current.has(page.cursor)))
        throw Error("资料库返回了重复分页游标，请刷新后重试。");
      usedCursors.current.add(cursor); setPages(value => [...value, page]);
    } catch (cause) { if (!controller.signal.aborted) setPageError(serviceErrorMessage(cause)); }
    finally { if (!controller.signal.aborted) { pending.current = false; setPaging(false); } }
  };
  const retryPath = () => {
    if (location.directoryId !== locationRef.current.directoryId || source.current !== renderedSource
      || !renderedSource || renderedSource.signal.aborted || !access || location.directoryId === null) return;
    void readPath(access, renderedSource, location.directoryId);
  };
  const retryList = () => {
    if (location.directoryId === locationRef.current.directoryId && source.current === renderedSource && !renderedSource?.signal.aborted) {
      clearPreview();
      setRevision(value => value + 1);
    }
  };
  const openFile = (node: LibraryNode, trigger: HTMLButtonElement) => {
    if (node.kind !== "file" || !nativeDirectory(node.id) || !access?.available
      || location.directoryId !== locationRef.current.directoryId || !renderedSource
      || renderedSource !== source.current || renderedSource.signal.aborted) return;
    const returnLocation = previewRef.current && !previewRef.current.controller.signal.aborted ? previewReturnLocation.current : null;
    clearPreview(); previewTrigger.current = trigger;
    previewReturnLocation.current = returnLocation ?? { ...locationRef.current, known: path ?? locationRef.current.known };
    const request = { id: node.id, name: node.name, access, controller: new AbortController() };
    previewRef.current = request; setPreview(request);
  };
  const closePreview = (request: LibraryPreviewRequest) => {
    if (request !== previewRef.current) return;
    const returnLocation = previewReturnLocation.current;
    clearPreview();
    if (returnLocation && (returnLocation.directoryId !== locationRef.current.directoryId || returnLocation.search !== locationRef.current.search)) changeLocation(returnLocation);
    if (previewTrigger.current?.isConnected) previewTrigger.current.focus();
  };
  const ancestors = path ?? location.known;
  const breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: "资料库" }, ...ancestors];
  const breadcrumbKey = JSON.stringify(breadcrumbs);
  useLayoutEffect(() => {
    const container = breadcrumbRef.current, measurement = measurementRef.current;
    if (!container || !measurement || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const widths = Array.from(measurement.children, child => child.getBoundingClientRect().width);
      const menuWidth = widths.pop() ?? 0;
      const width = container.getBoundingClientRect().width;
      if (widths.reduce((total, value) => total + value, 0) <= width) { setVisibleParents(Math.max(0, widths.length - 1)); return; }
      let used = (widths[0] ?? 0) + menuWidth, count = 0;
      for (let index = widths.length - 1; index > 0; index--) {
        used += widths[index];
        if (used > width) break;
        count++;
      }
      setVisibleParents(count);
    };
    const observer = new ResizeObserver(measure); observer.observe(container); observer.observe(measurement); measure();
    return () => observer.disconnect();
  }, [breadcrumbKey]);
  const keep = Math.min(visibleParents, Math.max(0, breadcrumbs.length - 1));
  const hidden = keep > 0 ? breadcrumbs.slice(1, breadcrumbs.length - keep) : [];
  const visible = keep > 0 ? [breadcrumbs[0], ...breadcrumbs.slice(-keep)] : breadcrumbs.slice(-1);
  const selectBreadcrumb = (id: string | null) => navigate(id, id === null ? [] : ancestors.slice(0, ancestors.findIndex(entry => entry.id === id) + 1),
    returnLocations.current.get(id)?.search ?? (id === null ? "" : location.search));
  const items = mergeLibraryPages(pages);
  return <div className="library-workspace">
    <div className="library-view-container">
    <div className="library-view-header library-browse-header">
    <h1>{location.directoryId === null ? (query ? "搜索" : "资料库") : <span className="library-directory-navigation">
      <span className="library-breadcrumbs" ref={breadcrumbRef} role="navigation" aria-label="文件夹路径">
        <span className="library-breadcrumb-visible">{visible.map((entry, index) => <span className={`library-breadcrumb-entry${entry.id === location.directoryId && entry.id !== null ? " current" : ""}`} key={entry.id ?? "root"}>
          {index > 0 && <span className="library-breadcrumb-separator" aria-hidden="true">›</span>}
          {index === 1 && hidden.length > 0 && <><ThreadActionsMenu align="left" label="…" triggerAriaLabel="打开上级文件夹菜单"
            buttonClassName="library-breadcrumb-button" items={hidden.map(item => ({ id: item.id!, label: item.name }))} onSelect={selectBreadcrumb} /><span className="library-breadcrumb-separator" aria-hidden="true">›</span></>}
          {entry.id === location.directoryId && entry.id !== null ? <span className="library-breadcrumb-current" aria-current="page" title={entry.name}>{entry.name}</span>
            : <button type="button" className="library-breadcrumb-button" onClick={() => selectBreadcrumb(entry.id)}>{entry.name}</button>}
        </span>)}</span>
        <span className="library-breadcrumb-measure" aria-hidden="true"><span ref={measurementRef}>
          {breadcrumbs.map((entry, index) => <span key={entry.id ?? "root"}>{index > 0 && <span className="library-breadcrumb-separator">›</span>}{entry.name}</span>)}
          <span><span className="library-breadcrumb-separator">›</span>…</span>
        </span></span>
      </span>
    </span>}</h1>
    {access?.available && <div className="library-header-actions"><div className="library-search">
      <Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor="library-search-input">{location.directoryId === null ? "搜索资料库" : "在当前文件夹中搜索"}</label>
      <input id="library-search-input" ref={searchInput} type="text" autoComplete="off" value={location.search}
        placeholder={location.directoryId === null ? "搜索资料库" : "在当前文件夹中搜索"} onChange={event => replaceSearch(event.target.value)} />
      {location.search.length > 0 && <button type="button" aria-label="清空搜索" onClick={() => { searchInput.current?.focus(); replaceSearch(""); }}><X size={16} aria-hidden="true" /></button>}
    </div></div>}</div>
    {pathLoading && <p role="status">正在读取文件夹路径…</p>}
    {pathError && <section aria-label="文件夹路径状态"><p role="alert">{pathError}</p><button type="button" onClick={retryPath}>重试路径</button></section>}
    {loading && <p role="status">正在读取资料库…</p>}
    {error && <section aria-label="资料库服务状态"><p role="alert">{error}</p><button type="button" onClick={retryList}>重试</button></section>}
    {!loading && !error && access && !access.available && <p role="status">当前账号暂不支持资料库。</p>}
    {!loading && !error && access?.available && !items.length && !cursor && <section role="status">{query ? <h3>未找到文件</h3>
      : location.directoryId !== null ? <p>此文件夹为空。</p> : <><h3>创建新内容</h3><p>你使用 ChatGPT 创建的内容（如图像和文档）将显示在这里</p></>}</section>}
    {!loading && !error && access?.available && !items.length && cursor && <p role="status">当前页没有条目，可继续加载更多内容。</p>}
    {Boolean(items.length) && <table className="library-root-table"><thead><tr><th>名称</th><th>类型</th><th>大小</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.node.id}><td>{item.node.kind === "directory" && nativeDirectory(item.node.id)
        ? <button type="button" className="library-directory-link" onClick={() => openDirectory(item.node)}>{item.node.name}</button>
        : item.node.kind === "file" && nativeDirectory(item.node.id)
          ? <button type="button" className="library-directory-link" onClick={event => openFile(item.node, event.currentTarget)}>{item.node.name}</button> : item.node.name}</td><td>{item.node.kind === "directory" ? "文件夹" : item.node.kind === "file" ? typeof item.node.mime_type === "string" ? item.node.mime_type : "文件" : item.node.kind}</td>
        <td>{typeof item.node.file_size_bytes === "number" && item.node.file_size_bytes >= 0 ? formatStorageBytes(item.node.file_size_bytes) : "—"}</td></tr>)}</tbody></table>}
    {pageError && <p role="alert">{pageError}</p>}
    {cursor && <button type="button" disabled={paging} onClick={() => void loadMore()}>{paging ? "正在加载…" : pageError ? "重试加载" : "加载更多"}</button>}
    </div>
    {preview && !preview.controller.signal.aborted && <LibraryPreviewPane request={preview} onClose={() => closePreview(preview)} />}
  </div>;
};
