import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ImageOff } from "lucide-react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage, type ImagesAssetRef } from "../chatgptService";
import { readImagesAccess, readImagesCatalog, readImagesHistory, readImagesAsset,
  type ImagesAccess, type ImagesCatalogResult, type ImagesHistoryResult } from "../imagesClient";
import { mergeImagesCatalog, mergeImagesHistory, imagesSections, type CloudImage, type ImagePrompt, type ImagePromptGroup } from "../imagesData";
import { selectPromptAsset, selectHistoryAsset, selectHistoryPreview } from "../imagesAssets";
import { saveDecodedImage } from "../imageSave";
import { ImagesHistoryMasonry } from "./ImagesHistoryMasonry";
import { LibraryPagination } from "./LibraryPagination";
import "./ImagesView.css";

interface AssetProps {
  asset: ImagesAssetRef | null;
  access: ImagesAccess;
  scope: AbortSignal;
  alt?: string;
  onDecoded?: (src: string) => void;
  onUnavailable?: () => void;
}
/** Asset URLs are never taken from renderer metadata: only opaque host-registered refs. */
const ImagesAsset: React.FC<AssetProps> = ({ asset, access, scope, alt = "", onDecoded, onUnavailable }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  useEffect(() => {
    const controller = new AbortController();
    const revoke = () => { controller.abort(); image.current?.removeAttribute("src"); setSrc(null); };
    scope.addEventListener("abort", revoke, { once: true });
    setSrc(null); setFailed(false);
    if (scope.aborted) revoke();
    else if (asset) void readImagesAsset(asset, access, controller.signal).then(value => {
      if (!controller.signal.aborted && !scope.aborted) setSrc(value);
    }).catch(() => { if (!controller.signal.aborted && !scope.aborted) { setFailed(true); unavailable.current?.(); } });
    return () => { controller.abort(); scope.removeEventListener("abort", revoke); image.current?.removeAttribute("src"); };
  }, [asset, access, scope]);
  return src && !failed && !scope.aborted
    ? <img ref={image} className="images-asset" src={src} alt={alt} draggable={false}
      onLoad={() => { if (!scope.aborted) onDecoded?.(src); }}
      onError={() => { if (!scope.aborted) { image.current?.removeAttribute("src"); setSrc(null); setFailed(true); unavailable.current?.(); } }} />
    : <span className="images-asset-placeholder" aria-label={failed || !asset ? "图像不可用" : "正在加载图像"}><ImageOff size={20} aria-hidden="true" /></span>;
};

interface PreviewProps {
  images: CloudImage[];
  selectedId: string;
  pages: ImagesHistoryResult[];
  access: ImagesAccess;
  scope: AbortSignal;
  hasNextPage: boolean;
  paging: boolean;
  savingDialog: { current: boolean };
  onLoadNextPage: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}
const ImagesPreview: React.FC<PreviewProps> = ({ images, selectedId, pages, access, scope, hasNextPage, paging, savingDialog, onLoadNextPage, onSelect, onClose }) => {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const index = images.findIndex(image => image.id === selectedId), image = images[index];
  const original = image ? selectHistoryPreview(image, pages) : null;
  const [retry, setRetry] = useState(0);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<{ key: string; retry: number; src: string } | null>(null);
  const ready = decoded && !scope.aborted && decoded.key === original?.assetKey && decoded.retry === retry ? decoded : null;
  const currentReady = useRef(ready); currentReady.current = ready;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ source: NonNullable<typeof ready>; message: string } | null>(null);
  useEffect(() => () => { currentReady.current = null; }, []);
  const nextImage = images[index + 1];
  const canAdvance = !!nextImage || (hasNextPage && !paging);
  const advance = () => {
    if (nextImage) onSelect(nextImage.id);
    else if (canAdvance) onLoadNextPage();
  };
  useEffect(() => { close.current?.focus(); }, [selectedId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); onSelect(images[index - 1].id); }
      else if (event.key === "ArrowRight" && canAdvance) { event.preventDefault(); advance(); }
      else if (event.key === "Tab") {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  });
  if (!image) return null;
  const download = async () => {
    if (!ready || currentReady.current !== ready || savingDialog.current || scope.aborted) return;
    savingDialog.current = true;
    setSaving(true); setSaveError(null);
    try {
      const title = image.title?.trim() || `ChatGPT 图像 ${new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).format(new Date())}`;
      await saveDecodedImage(ready.src, title);
    } catch (cause) {
      if (currentReady.current === ready && !scope.aborted) setSaveError({ source: ready, message: serviceErrorMessage(cause) });
    } finally {
      savingDialog.current = false; setSaving(false);
    }
  };
  return createPortal(<div className="images-preview-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="images-preview-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="images-preview-title">
      <div className="images-preview-header"><h2 id="images-preview-title">{image.title || "图像"}</h2><div className="images-preview-navigation">
        <button type="button" aria-label="下载图像" disabled={!ready || saving} onClick={() => void download()}>下载图像</button>
        <button ref={close} type="button" onClick={onClose} aria-label="关闭图像预览">关闭</button>
      </div></div>
      <div className="images-preview-media">{original
        ? <ImagesAsset key={`${original.assetKey}:${retry}`} asset={original} access={access} scope={scope} alt={image.title || "图像"}
          onDecoded={src => setDecoded({ key: original.assetKey, retry, src })}
          onUnavailable={() => { setFailedId(image.id); setDecoded(null); }} />
        : <p role="status">原图不可用</p>}</div>
      <div className="images-preview-footer">{failedId === image.id && <span role="status">无法加载原图</span>}<div className="images-preview-navigation">
        {original && <button onClick={() => { setFailedId(null); setRetry(value => value + 1); }}>重新加载预览</button>}
        <button disabled={index <= 0} onClick={() => onSelect(images[index - 1].id)} aria-label="上一张图像">上一张</button>
        <button disabled={!canAdvance} onClick={advance} aria-label="下一张图像">下一张</button>
      </div></div>
      {saveError && saveError.source === ready && <p role="alert" className="images-inline-error">无法下载图像：{saveError.message}</p>}
    </div>
  </div>, document.body);
};

export const ImagesView: React.FC = () => {
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<ImagesAccess | null>(null);
  const [catalog, setCatalog] = useState<ImagesCatalogResult | null>(null);
  const [pages, setPages] = useState<ImagesHistoryResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ id: string } | null>(null);
  const previewId = preview?.id ?? null;
  const [assetRevision, setAssetRevision] = useState({ catalog: 0, history: 0 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null), composer = useRef<HTMLDivElement>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null), previewTrigger = useRef<HTMLButtonElement | null>(null);
  const restorePreviewFocus = useRef(false);
  const savingDialog = useRef(false);
  const source = useRef<AbortController | null>(null), assetSource = useRef(new AbortController());
  const catalogAssetSource = useRef(new AbortController());
  const identity = useRef<ImagesAccess["identity"] | null>(null);
  const pending = useRef(false), usedCursors = useRef(new Set<string>());
  const closePreview = useCallback(() => { restorePreviewFocus.current = true; setPreview(null); }, []);
  useLayoutEffect(() => {
    if (preview !== null || !restorePreviewFocus.current) return;
    restorePreviewFocus.current = false;
    // React has now committed inert=false on the original trigger's ancestors.
    if (previewTrigger.current?.isConnected && !previewTrigger.current.disabled) previewTrigger.current.focus();
  }, [preview]);
  const revokeAssets = useCallback(() => { assetSource.current.abort(); catalogAssetSource.current.abort(); setPreview(null); }, []);
  const rotateAssets = (kind: "catalog" | "history") => {
    const controller = kind === "catalog" ? catalogAssetSource : assetSource;
    controller.current.abort(); controller.current = new AbortController();
    setAssetRevision(value => ({ ...value, [kind]: value[kind] + 1 }));
    if (kind === "history") { setPreview(null); setHidden(new Set()); }
  };
  const refresh = useCallback(() => {
    source.current?.abort(); revokeAssets();
    setCatalog(previous => previous ? { ...previous, catalogAssets: [], stylesAssets: [] } : null);
    setPages(previous => previous.map(page => ({ ...page, assets: [] })));
    setRevision(value => value + 1);
  }, [revokeAssets]);
  useLayoutEffect(() => {
    const element = composer.current, container = root.current;
    if (!element || !container) return;
    const measure = () => container.style.setProperty("--images-composer-height", `${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [access?.available]);
  useEffect(() => {
    const controller = new AbortController(); source.current = controller; pending.current = false;
    revokeAssets(); usedCursors.current.clear(); setLoading(true); setCatalogLoading(true); setHistoryLoading(true); setPaging(false); setError(null); setHistoryError(null);
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await tauriListen("chatgpt-service:invalidated", () => {
          if (controller.signal.aborted) return;
          controller.abort(); revokeAssets(); identity.current = null; setAccess(null); setCatalog(null); setPages([]); setDraft(""); setNotice(""); setSection(null);
          setRevision(value => value + 1);
        });
        if (controller.signal.aborted) { unlisten(); return; }
        const current = await readImagesAccess(controller.signal);
        if (controller.signal.aborted) return;
        const previous = identity.current;
        if (previous && (previous.accountId !== current.identity.accountId || previous.userId !== current.identity.userId || previous.generation !== current.identity.generation)) {
          setCatalog(null); setPages([]); setDraft(""); setNotice(""); setSection(null);
        }
        identity.current = current.identity;
        setAccess(current);
        if (!current.available) { setCatalog(null); setPages([]); return; }
        // The catalog's two endpoints settle together; history is an independent query.
        void readImagesCatalog(current, controller.signal).then(result => {
          if (!controller.signal.aborted) { rotateAssets("catalog"); setCatalog(result); }
        }).catch(cause => {
          if (!controller.signal.aborted) setCatalog({ catalogAssets: [], stylesAssets: [], errors: [serviceErrorMessage(cause)] });
        }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
        void readImagesHistory(current, null, controller.signal).then(result => {
          if (!controller.signal.aborted) { rotateAssets("history"); setPages([result]); }
        }).catch(cause => {
          if (!controller.signal.aborted) { setHistoryError(serviceErrorMessage(cause)); setPages(previous => previous.map(page => ({ ...page, assets: [] }))); }
        }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
      } catch (cause) { if (!controller.signal.aborted) { setAccess(null); setError(serviceErrorMessage(cause)); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); assetSource.current.abort(); catalogAssetSource.current.abort(); unlisten?.(); };
  }, [revision, revokeAssets]);
  useEffect(() => {
    const interval = window.setInterval(refresh, 300000);
    let returningFromSave = false;
    const blur = () => { if (savingDialog.current) returningFromSave = true; };
    const focus = () => {
      const skip = returningFromSave || savingDialog.current;
      returningFromSave = false;
      if (!skip) refresh();
    };
    window.addEventListener("blur", blur); window.addEventListener("focus", focus); window.addEventListener("online", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); window.removeEventListener("online", refresh); };
  }, [refresh]);
  const scope = source.current, assetScope = assetSource.current.signal, catalogAssetScope = catalogAssetSource.current.signal;
  const groups = catalog?.catalog ? mergeImagesCatalog(catalog.catalog, catalog.styles) : [];
  const sections = imagesSections(groups, access?.sectionOrder);
  const historyTab = access?.myImagesTabEnabled === true;
  const selected = section === "my_images" && historyTab ? "my_images" : section !== null && sections.includes(section) ? section : sections[0] ?? "";
  const tabKeydown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = [...(sections.length ? sections : [""]), ...(historyTab ? ["my_images"] : [])];
    const index = keys.indexOf(selected);
    const next = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1
      : event.key === "ArrowRight" ? (index + 1) % keys.length : event.key === "ArrowLeft" ? (index + keys.length - 1) % keys.length : null;
    if (next === null) return;
    event.preventDefault(); setSection(keys[next]);
    document.getElementById(`images-tab-${encodeURIComponent(keys[next])}`)?.focus();
  };
  const images = mergeImagesHistory(pages), visibleImages = images.filter(image => !hidden.has(image.id));
  const previewImages = images.filter(image => !image.output_blocked && (hidden.has(image.id)
    ? image.id === previewId && selectHistoryPreview(image, pages)?.role === "recent_preview"
    : selectHistoryAsset(image, pages) || selectHistoryPreview(image, pages)));
  const previewIds = new Set(previewImages.map(image => image.id));
  const activePreview = previewId !== null && previewIds.has(previewId);
  const cursor = pages.at(-1)?.cursor ?? null;
  const hasNextPage = !!cursor && !historyError && !historyLoading;
  const loadMore = async (advanceFrom?: { id: string }) => {
    if (!access?.available || !scope || scope !== source.current || scope.signal.aborted || pending.current || !hasNextPage || !cursor || usedCursors.current.has(cursor)) return;
    pending.current = true; setPaging(true); setHistoryError(null);
    try {
      const result = await readImagesHistory(access, cursor, scope.signal);
      if (scope.signal.aborted || scope !== source.current) return;
      usedCursors.current.add(cursor);
      const nextPages = [...pages, result];
      // The merged snapshot hides denials immediately and keeps unrelated grants.
      setPages(nextPages);
      const previousIds = new Set(images.map(image => image.id));
      const next = advanceFrom && mergeImagesHistory(nextPages).find(image => !previousIds.has(image.id)
        && (selectHistoryAsset(image, nextPages) || selectHistoryPreview(image, nextPages)));
      setPreview(current => {
        if (current && result.items.some(item => item.id === current.id && (item.is_archived || item.output_blocked))) return null;
        return next && current === advanceFrom ? { id: next.id } : current;
      });
      if (result.cursor && usedCursors.current.has(result.cursor)) setHistoryError("图像服务返回重复分页，请重试。");
    } catch (cause) {
      if (!scope.signal.aborted) {
        // The host can revoke a newest deny before rejecting its remaining asset
        // registration. An error therefore cannot preserve any old history grant.
        assetSource.current.abort(); setPreview(null);
        setPages(previous => previous.map(page => ({ ...page, assets: [] })));
        setHistoryError(serviceErrorMessage(cause));
      }
    }
    finally { if (!scope.signal.aborted) { pending.current = false; setPaging(false); } }
  };
  const selectPrompt = (item: ImagePrompt, group: ImagePromptGroup) => {
    if (!scope || scope !== source.current || scope.signal.aborted || catalogLoading) return;
    const prompt = typeof item.prompt_text === "string" ? item.prompt_text : "";
    if (prompt) { setDraft(prompt); draftInput.current?.focus(); }
    const action = item.action ?? group.action;
    setNotice(prompt ? "已放入本地草稿。图像生成尚未接入，不会自动发送。" : action ? "此模板需要图像生成或上传服务，当前尚未接入。" : "此模板没有可读取的提示词。");
  };
  const history = <section className="images-history" aria-labelledby="images-history-heading">
    <h2 id="images-history-heading">我的图像</h2>
    {historyLoading && pages.length === 0 && <p role="status" className="images-message">正在加载图像…</p>}
    {!historyLoading && !historyError && visibleImages.length === 0 && !cursor && <p className="images-message">你用 ChatGPT 创建的图像将显示在这里</p>}
    <ImagesHistoryMasonry items={visibleImages.map(image => ({ id: image.id, content:
      <button className="images-history-card" data-image-history={image.id} disabled={historyLoading || !previewIds.has(image.id)}
        aria-label={image.title || "查看图像"} onClick={event => { if (!scope || scope !== source.current || scope.signal.aborted || historyLoading) return; previewTrigger.current = event.currentTarget; setPreview({ id: image.id }); }}>
        {image.output_blocked ? <span className="images-asset-placeholder">无法显示此图像</span> : access && <ImagesAsset key={`${assetRevision.history}:${image.id}`} asset={selectHistoryAsset(image, pages)} access={access} scope={assetScope}
          onUnavailable={() => {
            if (!selectHistoryAsset(image, pages)) return;
            setHidden(previous => new Set(previous).add(image.id));
            if (previewId === image.id && selectHistoryPreview(image, pages)?.role !== "recent_preview") closePreview();
          }} />}
      </button> }))} />
    {historyError && <div role="alert" className="images-inline-error">无法加载图像：{historyError}<button className="images-retry" disabled={paging || historyLoading} aria-label="重试加载图像" onClick={refresh}>重试</button></div>}
    <LibraryPagination key={`${revision}:${pages.length}`} hasNextPage={hasNextPage} fetching={historyLoading || paging} onLoadNextPage={() => void loadMore()} />
  </section>;
  return <div ref={root} className={`images-view-container${access?.newLayout === true ? " images-layout-wide" : ""}`}>
    <div className="images-scroll" inert={activePreview || undefined}><div className="images-page-content">
      <header className="images-view-header"><h1>图像</h1>{access?.available && <button className="images-refresh" onClick={refresh} disabled={loading}>刷新</button>}</header>
      {error && <div role="alert" className="images-inline-error">{error}<button className="images-retry" onClick={refresh}>重试</button></div>}
      {!error && !access && loading && <p role="status">正在加载图像…</p>}
      {access && !access.available && <p role="status" className="images-message">当前账号暂不支持图像。</p>}
      {access?.available && <>
        <nav className="images-tabs" role="tablist" aria-label="图像提示词类别">
          {(sections.length ? sections : [""]).map(value => <button key={value} id={`images-tab-${encodeURIComponent(value)}`} role="tab" aria-selected={selected === value}
            aria-controls="images-category-panel" tabIndex={selected === value ? 0 : -1} onKeyDown={tabKeydown} onClick={() => setSection(value)}>{value === "Templates" ? "模板" : value || "热门"}</button>)}
          {historyTab && <button id="images-tab-my_images" role="tab" aria-selected={selected === "my_images"} aria-controls="images-category-panel" tabIndex={selected === "my_images" ? 0 : -1} onKeyDown={tabKeydown} onClick={() => setSection("my_images")}>我的图像</button>}
        </nav>
        <div id="images-category-panel" role="tabpanel" tabIndex={0} aria-labelledby={`images-tab-${encodeURIComponent(selected)}`} aria-busy={selected === "my_images" ? historyLoading : catalogLoading}>
          {selected === "my_images" ? history : <div className="images-prompts">
            {catalog?.errors.length ? <div role="alert" className="images-inline-error">部分图像提示无法加载：{catalog.errors.join("；")}<button className="images-retry" onClick={refresh} disabled={catalogLoading}>重试</button></div> : null}
            {catalogLoading && !catalog && <div className="images-prompt-grid" aria-label="正在加载图像提示">{Array.from({ length: 15 }, (_, index) => <div key={index} className="images-skeleton" />)}</div>}
            {!catalogLoading && catalog?.catalog && groups.length === 0 && <div className="images-message">从你的创意开始<br />描述你想创建的图像</div>}
            {groups.filter(group => group.kind == null || group.kind === "prompt_collection")
              .map((group): ImagePromptGroup => ({ ...group, items: group.items.filter(item => !sections.some(Boolean) || (item.section || "") === selected) }))
              .filter(group => group.items.length > 0).map((group, index) => {
              const items = group.items;
              const presentation = group.presentation, imageCard = presentation === "image_card" || presentation === "portrait";
              if (!imageCard && presentation !== "text_pill" && presentation !== "icon_pill") return <section key={group.id} className="images-prompt-group"><p>此提示集合的呈现方式尚不支持。</p></section>;
              return <section key={group.id} className="images-prompt-group" aria-label={typeof group.title === "string" ? group.title : undefined}>
                {index > 0 && typeof group.title === "string" && <h2>{group.title}</h2>}
                <div className={imageCard ? "images-prompt-grid" : presentation === "text_pill" ? "images-text-pills" : "images-icon-pills"}>
                  {items.map(item => <button key={item.id} className={imageCard ? "images-prompt-card" : presentation === "text_pill" ? "images-text-pill" : "images-icon-pill"}
                    aria-label={[item.title, item.image_alt].filter(value => typeof value === "string" && value).filter((value, i, values) => values.indexOf(value) === i).join(", ") || "图像模板"}
                    disabled={catalogLoading} title="选择只会填入本地草稿；生成与上传尚未接入" onClick={() => selectPrompt(item, group)}>
                    {presentation !== "text_pill" && <span className={presentation === "icon_pill" ? "images-icon-wrap" : undefined}><ImagesAsset key={`${assetRevision.catalog}:${group.id}:${item.id}`} asset={selectPromptAsset(group, item, catalog!)} access={access} scope={catalogAssetScope} /></span>}
                    <span className={imageCard ? "images-prompt-title" : undefined}>{item.title}</span>
                  </button>)}
                </div>
              </section>;
            })}
          </div>}
        </div>
        {!historyTab && history}
      </>}
    </div></div>
    {access?.available && <div className="images-composer-overlay" ref={composer} inert={activePreview || undefined} aria-label="图像草稿（生成尚未接入）">
      <textarea ref={draftInput} aria-label="图像提示词草稿" placeholder="描述你想创建的图像" value={draft} rows={2} onChange={event => setDraft(event.target.value)} />
      <div className="images-composer-footer"><span role="status">{notice || "本地草稿；生成、上传和编辑尚未接入。"}</span><button className="images-composer-send" disabled aria-label="生成图像尚未连接"><ArrowUp size={18} /></button></div>
    </div>}
    {preview && activePreview && access?.available && <ImagesPreview images={previewImages} selectedId={preview.id} pages={pages} access={access}
      scope={assetScope} hasNextPage={hasNextPage} paging={paging} savingDialog={savingDialog} onLoadNextPage={() => void loadMore(preview)}
      onSelect={id => setPreview({ id })} onClose={closePreview} />}
  </div>;
};
