import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Minus, Plus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { savePreviewImageBytes } from "../imageSave";
import type { AppshotContext } from "../appshotContext";
import { base64ToBytes, getMetadata, readFileBase64 } from "../fsClient";
import "./AppshotAttachment.css";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const imageData = (value?: string | null) => value && /^data:image\/(?:png|jpeg);base64,[a-z\d+/]+=*$/i.test(value) ? value : null;
const userImageData = (value?: string | null) => value && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/]+=*$/i.test(value) ? value : null;
function localImageMime(bytes: Uint8Array, ordinary: boolean): string | null {
  const matches = (offset: number, values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (bytes.length >= 29 && matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (bytes.length >= 4 && matches(0, [255, 216, 255]) && matches(bytes.length - 2, [255, 217])) return "image/jpeg";
  if (!ordinary) return null;
  if (bytes.length >= 13 && (matches(0, [71, 73, 70, 56, 55, 97]) || matches(0, [71, 73, 70, 56, 57, 97]))) return "image/gif";
  if (bytes.length >= 20 && matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) {
    const size = bytes[4] + bytes[5] * 256 + bytes[6] * 65536 + bytes[7] * 16777216;
    if (size + 8 === bytes.length && matches(12, [86, 80, 56]) && [32, 76, 88].includes(bytes[15])) return "image/webp";
  }
  if (bytes.length >= 16 && matches(4, [102, 116, 121, 112])) {
    const size = bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3];
    if (size >= 16 && size <= bytes.length && size % 4 === 0) {
      for (let offset = 8; offset + 4 <= size; offset += 4) {
        if (offset !== 12 && (matches(offset, [97, 118, 105, 102]) || matches(offset, [97, 118, 105, 115]))) return "image/avif";
      }
    }
  }
  return null;
}
function localImagePath(value?: string | null): string | null {
  if (!value) return null;
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" || url.hostname && url.hostname !== "localhost" || url.search || url.hash) return null;
      value = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, "$1");
    } catch { return null; }
  }
  return !/[\x00-\x1f]/.test(value) && /^(?:[a-z]:[\\/]|\/[^/])/i.test(value) ? value : null;
}

function useImageSource(context: Pick<AppshotContext, "imageDataUrl" | "imagePath"> | null, id: string, ordinary = false) {
  const inline = ordinary ? userImageData(context?.imageDataUrl) : imageData(context?.imageDataUrl);
  const path = inline ? null : localImagePath(context?.imagePath);
  const binding = useMemo(() => ({ id, path, ordinary }), [id, path, ordinary]);
  const [local, setLocal] = useState<{ binding: typeof binding; src: string | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true, url: string | null = null;
    void (async () => {
      try {
        const metadata = await getMetadata(path);
        if (!active) return;
        if (!metadata.isFile || metadata.isDirectory) throw new Error("Unavailable image");
        const encoded = await readFileBase64(path);
        if (!active) return;
        if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || encoded.length % 4 || !/^[a-z\d+/]*={0,2}$/i.test(encoded)) throw new Error("Invalid image");
        const bytes = base64ToBytes(encoded);
        const mime = localImageMime(bytes, ordinary);
        if (!active) return;
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !mime) throw new Error("Invalid image");
        url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
        setLocal({ binding, src: url, error: false });
      } catch { if (active) setLocal({ binding, src: null, error: true }); }
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [binding, path]);
  const candidate = inline ?? (local?.binding === binding ? local.src : null);
  const [failed, setFailed] = useState<{ binding: typeof binding; src: string } | null>(null);
  const decodeFailed = failed?.binding === binding && failed.src === candidate;
  return {
    src: decodeFailed ? null : candidate,
    error: !!decodeFailed || local?.binding === binding && local.error || !!(context?.imageDataUrl || context?.imagePath) && !inline && !path,
    onError: () => { if (candidate) setFailed({ binding, src: candidate }); },
  };
}

export type ImagePreviewZoomCommand = { type: "step-zoom"; delta: number } | { type: "reset-zoom" };
let previewZoomHandler: ((command: ImagePreviewZoomCommand) => void) | null = null;
export function dispatchImagePreviewZoom(command: ImagePreviewZoomCommand): boolean {
  if (!previewZoomHandler) return false;
  previewZoomHandler(command);
  return true;
}
const ZOOM_RAMP = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

function AppshotPreview({ id, title, src, text, trigger, onClose, onImageError, onPrevious, onNext, imageDraggable = false }: {
  id: string; title: string; src: string; text: string; trigger: React.RefObject<HTMLDivElement | null>; onClose: () => void;
  onImageError?: () => void; onPrevious?: () => void; onNext?: () => void; imageDraggable?: boolean;
}) {
  const [showText, setShowText] = useState(false);
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [explicitZoom, setExplicitZoom] = useState<number | null>(null);
  const [download, setDownload] = useState({ busy: false, error: false });
  const dialog = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null), viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; left: number; top: number; distance?: number; zoom?: number } | null>(null);
  const animationFrame = useRef<number | null>(null), downloadEpoch = useRef(0), saving = useRef(false), mounted = useRef(false);
  const hasText = text.trim().length > 0;
  const dimensions = natural?.src === src ? natural : null;
  const fit = dimensions && viewportSize.width > 0 && viewportSize.height > 0
    ? Math.min(1, viewportSize.width / dimensions.width, viewportSize.height / dimensions.height) * 100 : null;
  const zoom = explicitZoom ?? fit;
  const ramp = [...ZOOM_RAMP, ...(fit == null || ZOOM_RAMP.includes(fit) ? [] : [fit])].sort((a, b) => a - b);
  const minimum = ramp[0], maximum = ramp[ramp.length - 1];
  const zoomAt = (next: number, point?: { x: number; y: number }) => {
    if (zoom == null || !viewport.current) return;
    const area = viewport.current, rect = area.getBoundingClientRect();
    const x = point ? point.x - rect.left : rect.width / 2, y = point ? point.y - rect.top : rect.height / 2;
    const ratio = Math.max(minimum, Math.min(maximum, next)) / zoom;
    const left = (area.scrollLeft + x) * ratio - x, top = (area.scrollTop + y) * ratio - y;
    setExplicitZoom(Math.max(minimum, Math.min(maximum, next)));
    if (animationFrame.current != null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = requestAnimationFrame(() => { animationFrame.current = null; if (viewport.current === area) { area.scrollLeft = left; area.scrollTop = top; } });
  };
  const reset = () => { setExplicitZoom(null); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; } };
  const step = (direction: number) => {
    if (zoom == null) return;
    const next = direction > 0 ? ramp.find(value => value > zoom) : [...ramp].reverse().find(value => value < zoom);
    if (next != null) zoomAt(next);
  };
  const zoomConsumer = useRef<(command: ImagePreviewZoomCommand) => void>(() => {});
  zoomConsumer.current = command => { if (showText) return; if (command.type === "reset-zoom") reset(); else step(command.delta); };
  useEffect(() => {
    const previous = previewZoomHandler, handler = (command: ImagePreviewZoomCommand) => zoomConsumer.current(command);
    previewZoomHandler = handler;
    return () => { if (previewZoomHandler === handler) previewZoomHandler = previous; };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; downloadEpoch.current++; if (animationFrame.current != null) cancelAnimationFrame(animationFrame.current); };
  }, []);
  useEffect(() => {
    downloadEpoch.current++; saving.current = false; setDownload({ busy: false, error: false }); setExplicitZoom(null); setShowText(false);
  }, [src]);
  useEffect(() => {
    const original = trigger.current;
    close.current?.focus();
    const containFocus = (event: FocusEvent) => {
      if (document.hasFocus() && event.target instanceof Node && !dialog.current?.contains(event.target)) close.current?.focus();
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (document.hasFocus() && original?.isConnected && original.getAttribute("data-appshot-id") === id) original.focus({ preventScroll: true });
    };
  }, [id, trigger]);
  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const measure = () => { const rect = area.getBoundingClientRect(); setViewportSize({ width: rect.width, height: rect.height }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(area); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    const area = viewport.current;
    if (!area || showText) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || zoom == null) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaMode === 1 ? 16 * event.deltaY : event.deltaMode === 2 ? 800 * event.deltaY : event.deltaY;
      zoomAt(zoom * Math.exp(-delta / 200), { x: event.clientX, y: event.clientY });
    };
    area.addEventListener("wheel", wheel, { passive: false });
    return () => { area.removeEventListener("wheel", wheel); };
  }, [src, showText, zoom, fit]);
  useEffect(() => () => {
    for (const pointer of pointers.current.keys()) if (viewport.current?.hasPointerCapture?.(pointer)) viewport.current.releasePointerCapture(pointer);
    pointers.current.clear(); gesture.current = null;
  }, [src, showText]);
  const downloadImage = async () => {
    if (saving.current || !dimensions || !/^(?:data:image\/(?:png|jpeg|gif|webp|avif);base64,|blob:)/i.test(src)) return;
    saving.current = true; const epoch = ++downloadEpoch.current; setDownload({ busy: true, error: false });
    try { await savePreviewImageBytes(src); }
    catch { if (mounted.current && downloadEpoch.current === epoch) setDownload({ busy: false, error: true }); return; }
    finally { if (downloadEpoch.current === epoch) saving.current = false; }
    if (mounted.current && downloadEpoch.current === epoch) setDownload({ busy: false, error: false });
  };
  const releasePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const remaining = [...pointers.current.values()][0];
    gesture.current = remaining && viewport.current ? { ...remaining, left: viewport.current.scrollLeft, top: viewport.current.scrollTop } : null;
  };
  return createPortal(<div className="appshot-preview-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label={title} className="appshot-preview"
    onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "ArrowLeft" && onPrevious) { event.preventDefault(); event.stopPropagation(); onPrevious(); }
      if (event.key === "ArrowRight" && onNext) { event.preventDefault(); event.stopPropagation(); onNext(); }
    }
    if (event.key !== "Tab") return;
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="appshot-preview-toolbar">
      {hasText && <button type="button" aria-pressed={showText} aria-label={showText ? "显示屏幕截图" : "显示无障碍文本"} onClick={() => setShowText(value => !value)}>查看文本</button>}
      <button type="button" aria-label="下载图片" disabled={download.busy || !dimensions} onClick={() => void downloadImage()}><Download size={18} aria-hidden="true" /></button>
      <button ref={close} type="button" aria-label="关闭图片预览" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    {onPrevious && <button className="appshot-preview-previous" type="button" aria-label="上一张图像" onClick={onPrevious}><ChevronLeft size={18} aria-hidden="true" /></button>}
    {onNext && <button className="appshot-preview-next" type="button" aria-label="下一张图像" onClick={onNext}><ChevronRight size={18} aria-hidden="true" /></button>}
    <div ref={viewport} className={"appshot-preview-viewport" + (showText ? " appshot-preview-text-mode" : "")}
      onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}
      onPointerDownCapture={event => {
        if (showText || event.pointerType !== "touch") return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointers.current.values()];
        gesture.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop,
          ...(points.length === 2 && zoom != null ? { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom } : {}) };
      }} onPointerMoveCapture={event => {
        if (showText || event.pointerType !== "touch" || !pointers.current.has(event.pointerId) || !gesture.current) return;
        event.preventDefault(); event.stopPropagation(); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointers.current.values()], start = gesture.current;
        if (points.length >= 2 && start.distance && start.zoom) zoomAt(start.zoom * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / start.distance,
          { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
        else { event.currentTarget.scrollLeft = start.left - (event.clientX - start.x); event.currentTarget.scrollTop = start.top - (event.clientY - start.y); }
      }} onPointerUpCapture={releasePointer} onPointerCancelCapture={releasePointer}>
      {showText && hasText ? <div className="appshot-text-preview" onPointerDown={event => event.stopPropagation()}><div className="appshot-text-heading">纯文本</div>
        <div className="appshot-text-body"><pre>{text.trim()}</pre></div>
      </div> : <img className="appshot-preview-image" src={src} alt={title} draggable={imageDraggable}
        style={dimensions && zoom != null ? { width: dimensions.width * zoom / 100, height: dimensions.height * zoom / 100 } : undefined}
        onPointerDown={event => event.stopPropagation()}
        onLoad={event => { const image = event.currentTarget; if (image.naturalWidth > 0 && image.naturalHeight > 0) setNatural({ src, width: image.naturalWidth, height: image.naturalHeight }); }}
        onError={() => { onImageError?.(); onClose(); }} />}
    </div>
    {!showText && <div className="appshot-preview-zoom"><button type="button" aria-label="缩小图片" disabled={zoom == null || zoom <= minimum} onClick={() => step(-1)}><Minus size={18} aria-hidden="true" /></button>
      <span>{zoom == null ? "—" : Math.round(zoom) + "%"}</span>
      <button type="button" aria-label="放大图片" disabled={zoom == null || zoom >= maximum} onClick={() => step(1)}><Plus size={18} aria-hidden="true" /></button></div>}
    {download.error && <div className="appshot-preview-error" role="alert">无法保存图片</div>}
  </div></div>, document.body);
}

export function AppshotAttachment({ id, context, pending = false, variant = "composer", onRemove }: {
  id: string; context: AppshotContext | null; pending?: boolean; variant?: "composer" | "thread"; onRemove?: () => void;
}) {
  const { src, error, onError } = useImageSource(context, id);
  const title = context?.windowTitle?.trim() || context?.appName || "";
  const transition = imageData(context?.transitionSnapshotDataUrl);
  const icon = imageData(context?.appIconDataUrl);
  const rawHeight = context?.transitionSnapshotHeight;
  const height = typeof rawHeight === "number" && Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 140;
  const [opened, setOpened] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ src: string; width: number; height: number } | null>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const previewable = !pending && !!src;
  useEffect(() => { setOpened(null); }, [id, pending, src]);
  const screenshotHeight = dimensions?.src === src && dimensions.width > 0 && dimensions.height > 0
    ? Math.min(232 / dimensions.width, 140 / dimensions.height) * dimensions.height : 140;
  return <>
    <div ref={trigger} data-appshot-attachment="true" data-appshot-id={id} data-appshot-capture-request-id={pending ? id : undefined}
      aria-busy={pending || undefined} aria-label={title || undefined} className={`appshot-attachment appshot-attachment-${variant}${pending ? " appshot-attachment-pending" : ""}`}
      style={variant === "composer" ? { height: height + 8 } : undefined}
      role={previewable ? "button" : undefined} tabIndex={previewable ? 0 : undefined}
      onClick={previewable ? () => setOpened(id) : undefined}
      onKeyDown={previewable ? event => {
        if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpened(id); }
      } : undefined}>
      <div className="appshot-attachment-card" data-appshot-attachment-card="true">
        {variant === "composer" ? <div className="appshot-transition" style={{ height }}>
          {transition ? <img src={transition} alt="" aria-hidden="true" draggable={false} style={{ height, width: 232 }} /> : <span aria-hidden="true" style={{ height, width: 232 }} />}
        </div> : <>
          <div className="appshot-thread-visual"><div className="appshot-thread-image" style={{ height: screenshotHeight }}>
            {src && <img src={src} alt={title} draggable={false} onLoad={event => {
              const image = event.currentTarget;
              setDimensions({ src, width: image.naturalWidth, height: image.naturalHeight });
            }} onError={onError} />}
          </div>{icon && <img className="appshot-app-icon" src={icon} alt="" aria-hidden="true" draggable={false} />}</div>
          <div className="appshot-thread-title">{title}</div>
        </>}
        {!pending && onRemove && <button type="button" className="appshot-remove" aria-label={`移除 ${title}`} onClick={event => { event.stopPropagation(); onRemove(); }}><X size={12} aria-hidden="true" /></button>}
        {!pending && error && <span className="appshot-image-error" role="status">无法加载快照图片</span>}
      </div>
    </div>
    {opened === id && previewable && src && <AppshotPreview key={id} id={id} title={title} src={src} text={context?.axTree ?? ""} trigger={trigger} onClose={() => setOpened(null)} onImageError={onError} />}
  </>;
}

function UserImageAttachment({ source, id, open, onOpenChange, onUnavailable, onPrevious, onNext }: {
  source: string; id: string; open: boolean; onOpenChange: (open: boolean) => void; onUnavailable: () => void; onPrevious?: () => void; onNext?: () => void;
}) {
  const inline = userImageData(source);
  const { src, error, onError } = useImageSource({ imageDataUrl: inline, imagePath: inline ? null : source }, id, true);
  const trigger = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) { onUnavailable(); if (open) onOpenChange(false); } }, [error, open]);
  if (error) return <div className="user-image-thumbnail user-image-failed" role="img" aria-label="图片加载失败">失败</div>;
  if (!src) return <div className="user-image-thumbnail" aria-busy="true" />;
  return <><div ref={trigger} className="user-image-thumbnail" data-appshot-id={id} role="button" tabIndex={0} aria-label="用户附件"
    onClick={() => onOpenChange(true)} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenChange(true); }
    }}><img src={src} alt="用户附件" referrerPolicy="no-referrer" onError={onError} /></div>
    {open && <AppshotPreview key={source} id={id} title="用户附件" src={src} text="" trigger={trigger} onClose={() => onOpenChange(false)} onImageError={onError} onPrevious={onPrevious} onNext={onNext} imageDraggable />}</>;
}

export function UserImageAttachments({ sources, id }: { sources: string[]; id: string }) {
  const signature = JSON.stringify(sources);
  const binding = useMemo(() => ({ id, sources }), [id, signature]);
  const currentBinding = useRef(binding), mounted = useRef(true);
  currentBinding.current = binding;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [selection, setSelection] = useState<{ binding: typeof binding; index: number } | null>(null);
  const [failed, setFailed] = useState<{ binding: typeof binding; indices: number[] } | null>(null);
  const unavailable = failed?.binding === binding ? failed.indices : [];
  const available = sources.map((_, index) => index).filter(index => !unavailable.includes(index));
  return <>{sources.map((source, index) => {
    const position = available.indexOf(index), previous = available[position - 1], next = available[position + 1];
    return <UserImageAttachment key={index + ":" + source} source={source} id={id + "-image-" + index} open={selection?.binding === binding && selection.index === index}
      onOpenChange={open => {
        if (mounted.current && currentBinding.current === binding) setSelection(old => open ? { binding, index } : old?.binding === binding && old.index === index ? null : old);
      }}
      onUnavailable={() => { if (mounted.current && currentBinding.current === binding) setFailed(old => {
        const indices = old?.binding === binding ? old.indices : [];
        return indices.includes(index) ? old : { binding, indices: [...indices, index] };
      }); }}
      onPrevious={previous == null ? undefined : () => {
        if (mounted.current && currentBinding.current === binding) setSelection(old => old?.binding === binding && old.index === index ? { binding, index: previous } : old);
      }}
      onNext={next == null ? undefined : () => {
        if (mounted.current && currentBinding.current === binding) setSelection(old => old?.binding === binding && old.index === index ? { binding, index: next } : old);
      }} />;
  })}</>;
}
