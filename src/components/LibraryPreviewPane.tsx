import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, File, FileImage, FileVideo, X } from "lucide-react";
import { readLibraryFile, readLibraryFileContent, type LibraryAccess } from "../libraryClient";
import { LIBRARY_PREVIEW_MAX_BYTES, libraryPreviewKind, type LibraryFile } from "../libraryPreview";
import { serviceErrorMessage } from "../chatgptService";
import { MarkdownView } from "./MarkdownView";
import "./LibraryPreviewPane.css";

export interface LibraryPreviewRequest {
  id: string;
  name: string;
  access: LibraryAccess;
  controller: AbortController;
}
interface PreviewState {
  request: LibraryPreviewRequest;
  file?: LibraryFile;
  text?: string;
  url?: string;
  error?: string;
  retry?: boolean;
  loading: boolean;
}
// These artifacts require their own gated surface or source-chat navigation.
const specialArtifacts = new Set(["writing_block", "automation_plan", "flashcards", "app_block", "site_preview", "chat_message_snapshot"]);

export const LibraryPreviewPane: React.FC<{ request: LibraryPreviewRequest; onClose: () => void; standalone?: boolean }> = ({ request, onClose, standalone = false }) => {
  const [state, setState] = useState<PreviewState | null>(null);
  const [revision, setRevision] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [download, setDownload] = useState<{ request: LibraryPreviewRequest; error?: string } | null>(null);
  const downloadOperation = useRef<AbortController | null>(null);
  const [storedWidth, setStoredWidth] = useState<number | null>(() => {
    const stored = localStorage.getItem("app-shell:right-panel-width:v3");
    if (stored === null) return null;
    const value = Number(stored);
    return Number.isFinite(value) ? value : null;
  });
  const [width, setWidth] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const pane = useRef<HTMLElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const renderedState = useRef<PreviewState | null>(null);
  useLayoutEffect(() => {
    const workspace = pane.current?.parentElement;
    if (!workspace || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const box = workspace.getBoundingClientRect();
      setBounds({ width: box.width, height: box.height });
    };
    const observer = new ResizeObserver(measure); observer.observe(workspace); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    const release = () => { if (url) { URL.revokeObjectURL(url); url = undefined; } };
    const cancel = () => { controller.abort(); release(); };
    request.controller.signal.addEventListener("abort", cancel, { once: true });
    if (request.controller.signal.aborted) controller.abort();
    setState({ request, loading: true }); setImageLoaded(false); setImageError(false);
    void (async () => {
      let file: LibraryFile | undefined;
      try {
        controller.signal.throwIfAborted();
        file = await readLibraryFile(request.access, request.id, controller.signal);
        controller.signal.throwIfAborted();
        const kind = libraryPreviewKind(file);
        const tooLarge = file.file_size_bytes != null && file.file_size_bytes > LIBRARY_PREVIEW_MAX_BYTES;
        if (tooLarge || specialArtifacts.has(file.library_artifact_type ?? "") || (kind === "image" && file.file_size_bytes == null)
          || !["image", "text", "markdown"].includes(kind)) {
          setState({ request, file, loading: false }); return;
        }
        const content = await readLibraryFileContent(request.access, file, controller.signal);
        controller.signal.throwIfAborted();
        if (kind === "image") {
          url = URL.createObjectURL(new Blob([content.bytes], { type: content.mimeType }));
          setState({ request, file, url, loading: false });
        } else setState({ request, file, text: new TextDecoder().decode(content.bytes), loading: false });
      } catch (cause) {
        if (controller.signal.aborted) return;
        const failure = cause as { status?: number; code?: string };
        setState({ request, file, error: serviceErrorMessage(cause), retry: failure?.status !== 403 && failure?.status !== 404
          && failure?.code !== "forbidden" && failure?.code !== "not_found", loading: false });
      }
    })();
    return () => { cancel(); request.controller.signal.removeEventListener("abort", cancel); };
  }, [request, revision]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => { if (!event.defaultPrevented && !request.controller.signal.aborted) onClose(); }, 0);
    };
    window.addEventListener("keydown", keydown, true);
    return () => { window.removeEventListener("keydown", keydown, true); clearTimeout(timeout); };
  }, [request, onClose]);
  useEffect(() => () => dragCleanup.current?.(), [request]);
  useLayoutEffect(() => () => {
    downloadOperation.current?.abort();
    downloadOperation.current = null;
  }, [request]);
  const full = standalone || (bounds.width > 0 && bounds.width < 672);
  const maxWidth = Math.max(320, bounds.width - 352);
  const initialWidth = bounds.width ? Math.max(320, Math.min(bounds.height * 1.6, bounds.width - 500), Math.min(640, bounds.width - 352)) : 600;
  const restoredWidth = storedWidth === null ? initialWidth : storedWidth <= 1 ? storedWidth * bounds.width : storedWidth;
  const actualWidth = Math.max(320, Math.min(width ?? restoredWidth, maxWidth));
  const resize = (value: number) => {
    const clamped = Math.max(320, Math.min(value, maxWidth)); setWidth(clamped); return clamped;
  };
  const persistWidth = (value: number) => {
    if (bounds.width <= 0) return;
    const ratio = value / bounds.width;
    localStorage.setItem("app-shell:right-panel-width:v3", String(ratio)); setStoredWidth(ratio); setWidth(null);
  };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); dragCleanup.current?.();
    const start = event.clientX; let resizedWidth = actualWidth;
    const move = (next: PointerEvent) => { resizedWidth = resize(actualWidth + start - next.clientX); };
    const stop = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", stop); dragCleanup.current = null;
    };
    const finish = () => { stop(); persistWidth(resizedWidth); };
    dragCleanup.current = stop;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", stop);
  };
  const current = state?.request === request && !request.controller.signal.aborted ? state : null;
  renderedState.current = current;
  const file = current?.file;
  const kind = file ? libraryPreviewKind(file) : null;
  const specialArtifact = specialArtifacts.has(file?.library_artifact_type ?? "");
  const name = file?.file_name ?? request.name;
  const tooLarge = file?.file_size_bytes != null && file.file_size_bytes > LIBRARY_PREVIEW_MAX_BYTES;
  const pendingType = specialArtifact || (kind && ["pdf", "artifact", "html", "deep-research"].includes(kind));
  const canDownload = file && !tooLarge && !specialArtifact && kind !== "deep-research" && file.state !== "trashed"
    && (file.provider == null || file.provider === "native");
  const currentDownload = download?.request === request && !request.controller.signal.aborted ? download : null;
  const downloading = !!currentDownload && currentDownload.error === undefined;
  const downloadError = currentDownload?.error !== undefined && <p role="alert">无法下载文件。{currentDownload.error}</p>;
  const unavailable = file && !current.loading && !current.error && !tooLarge && !specialArtifact
    && (kind === "unsupported" || (kind === "image" && file.file_size_bytes == null));
  const UnavailableIcon = kind === "image" ? FileImage : file?.mime_type?.toLowerCase().startsWith("video/") ? FileVideo : File;
  const downloadFile = async () => {
    if (!file || !canDownload || downloadOperation.current || request.controller.signal.aborted) return;
    const controller = new AbortController();
    downloadOperation.current = controller;
    const cancel = () => controller.abort();
    request.controller.signal.addEventListener("abort", cancel, { once: true });
    setDownload({ request });
    try {
      const { bytes, mimeType } = await readLibraryFileContent(request.access, file, controller.signal, "download");
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.file_name.split(/[\\/]/u).at(-1) || "download";
      anchor.rel = "noopener";
      try {
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setDownload(null);
    } catch (cause) {
      if (!controller.signal.aborted) setDownload({ request, error: serviceErrorMessage(cause) });
    } finally {
      request.controller.signal.removeEventListener("abort", cancel);
      if (downloadOperation.current === controller) downloadOperation.current = null;
    }
  };
  return <aside ref={pane} className={`library-preview-pane${full ? " full" : ""}`} style={{ width: full ? "100%" : actualWidth }} aria-label="文件预览">
    {!full && <div role="separator" tabIndex={0} aria-label="调整工作空间窗格大小" aria-orientation="vertical"
      aria-valuemin={320} aria-valuemax={Math.round(maxWidth)} aria-valuenow={Math.round(actualWidth)} className="library-preview-resize"
      onPointerDown={startResize} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
          event.preventDefault(); persistWidth(resize(event.key === "Home" ? 320 : event.key === "End" ? maxWidth : actualWidth + (event.key === "ArrowLeft" ? 10 : -10)));
        }
      }} />}
    <header className="library-preview-header"><span title={name}>{name}</span>
      {canDownload && <button type="button" aria-label="下载文件" title="下载文件" disabled={downloading}
        onClick={downloadFile}><Download size={18} aria-hidden="true" /></button>}
      <button type="button" aria-label="关闭预览" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className={`library-preview-body${kind === "text" || kind === "markdown" ? " document" : ""}`}>
      {!unavailable && downloadError}
      {(!current || current.loading) && <p role="status" aria-label="正在加载预览">正在加载预览</p>}
      {current?.error && <section><h3>{file ? "无法显示预览" : "无法打开此文件"}</h3><p role="alert">{current.error}</p>
        {current.retry && <button type="button" onClick={() => setRevision(value => value + 1)}>重试</button>}</section>}
      {current && !current.loading && !current.error && tooLarge && <h3>文件过大，无法预览</h3>}
      {current && !current.loading && !current.error && !tooLarge && <>
        {kind === "text" && current.text !== undefined && <pre dir="ltr" className="library-preview-text">{current.text}</pre>}
        {kind === "markdown" && current.text !== undefined && <MarkdownView content={current.text} remoteContent="no-remote-images" />}
        {kind === "image" && current.url && <div className="library-preview-image">
          {!imageLoaded && !imageError && <p role="status">正在加载预览</p>}
          {!imageError && <img src={current.url} alt={name} style={{ visibility: imageLoaded ? "visible" : "hidden" }}
            onLoad={() => { if (renderedState.current === current && !request.controller.signal.aborted) setImageLoaded(true); }}
            onError={() => { if (renderedState.current === current && !request.controller.signal.aborted) setImageError(true); }} />}
          {imageError && <section><p role="alert">无法显示预览</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试预览</button></section>}
        </div>}
        {unavailable && <section className="library-preview-unavailable" aria-labelledby="library-preview-unavailable-title">
          <span className="library-preview-unavailable-icon"><UnavailableIcon size={32} aria-hidden="true" /></span>
          <div className="library-preview-unavailable-copy">
            <h2 id="library-preview-unavailable-title">无法预览</h2>
            <p className="library-preview-unavailable-name">{name}</p>
            <p>{canDownload ? "此文件类型可下载" : "此类文件无法下载"}</p>
          </div>
          {canDownload && <button type="button" disabled={downloading} onClick={downloadFile}>下载文件</button>}
          {downloadError}
        </section>}
        {pendingType && <h3>无法显示预览</h3>}
      </>}
    </div>
  </aside>;
};
