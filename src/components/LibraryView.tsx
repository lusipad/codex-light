import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage } from "../chatgptService";
import { readLibraryAccess, readLibraryPage, type LibraryAccess } from "../libraryClient";
import { mergeLibraryPages, type LibraryPage } from "../libraryData";
import { formatStorageBytes } from "../storageUsage";
import "./LibraryView.css";

export const LibraryView: React.FC = () => {
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<LibraryAccess | null>(null);
  const [pages, setPages] = useState<LibraryPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const source = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const usedCursors = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController(); source.current = controller;
    let unlisten: (() => void) | undefined;
    pending.current = false; usedCursors.current.clear();
    setAccess(null); setPages([]); setLoading(true); setPaging(false); setError(null); setPageError(null);
    void (async () => {
      try {
        unlisten = await tauriListen("chatgpt-service:invalidated", () => {
          if (controller.signal.aborted) return;
          controller.abort(); setAccess(null); setPages([]); setRevision(value => value + 1);
        });
        if (controller.signal.aborted) { unlisten(); return; }
        const current = await readLibraryAccess(controller.signal);
        if (controller.signal.aborted) return;
        setAccess(current);
        if (current.available) {
          const page = await readLibraryPage(current, "all", null, controller.signal);
          if (!controller.signal.aborted) setPages([page]);
        }
      } catch (cause) { if (!controller.signal.aborted) setError(serviceErrorMessage(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); unlisten?.(); };
  }, [revision]);
  const cursor = pages.at(-1)?.cursor ?? null;
  const loadMore = async () => {
    const controller = source.current;
    if (!access?.available || !controller || controller.signal.aborted || !cursor || pending.current) return;
    pending.current = true; setPaging(true); setPageError(null);
    try {
      const page = await readLibraryPage(access, "all", cursor, controller.signal);
      if (controller.signal.aborted) return;
      if (page.cursor && (page.cursor === cursor || usedCursors.current.has(page.cursor)))
        throw Error("资料库返回了重复分页游标，请刷新后重试。");
      usedCursors.current.add(cursor); setPages(value => [...value, page]);
    } catch (cause) { if (!controller.signal.aborted) setPageError(serviceErrorMessage(cause)); }
    finally { if (!controller.signal.aborted) { pending.current = false; setPaging(false); } }
  };
  const items = mergeLibraryPages(pages);
  return <div className="library-view-container">
    <div className="library-view-header"><h2>资料库</h2></div>
    {loading && <p role="status">正在读取资料库…</p>}
    {error && <section aria-label="资料库服务状态"><p role="alert">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></section>}
    {!loading && !error && access && !access.available && <p role="status">当前账号暂不支持资料库。</p>}
    {!loading && !error && access?.available && !items.length && !cursor && <p role="status">资料库中暂无内容。</p>}
    {!loading && !error && access?.available && !items.length && cursor && <p role="status">当前页没有条目，可继续加载更多内容。</p>}
    {Boolean(items.length) && <table className="library-root-table"><thead><tr><th>名称</th><th>类型</th><th>大小</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.node.id}><td>{item.node.name}</td><td>{item.node.kind === "directory" ? "文件夹" : item.node.kind === "file" ? typeof item.node.mime_type === "string" ? item.node.mime_type : "文件" : item.node.kind}</td>
        <td>{typeof item.node.file_size_bytes === "number" && item.node.file_size_bytes >= 0 ? formatStorageBytes(item.node.file_size_bytes) : "—"}</td></tr>)}</tbody></table>}
    {pageError && <p role="alert">{pageError}</p>}
    {cursor && <button type="button" disabled={paging} onClick={() => void loadMore()}>{paging ? "正在加载…" : pageError ? "重试加载" : "加载更多"}</button>}
  </div>;
};
