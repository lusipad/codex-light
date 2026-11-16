import React, { useEffect, useRef, useState } from "react";
import { isTauriRuntime, tauriInvoke } from "../bridge";
import { CloseIcon } from "./Icons";
import { Loader2 } from "lucide-react";
import "./AddPluginMarketplaceDialog.css";

export interface AddPluginMarketplaceInput { source: string; refName: string | null; sparsePaths: string[] | null }
type Values = { source: string; refName: string; sparsePaths: string };
const empty = (): Values => ({ source: "", refName: "", sparsePaths: "" });
const HELP = "https://developers.openai.com/codex/plugins/build";
export function parseAddPluginMarketplaceInput(values: Values): AddPluginMarketplaceInput | null {
  const source = values.source.trim();
  if (!source) return null;
  const refName = values.refName.trim(), sparsePaths = values.sparsePaths.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
  return { source, refName: refName || null, sparsePaths: sparsePaths.length ? sparsePaths : null };
}

export function AddPluginMarketplaceDialog({ open, onOpenChange, onAdd, contextKey }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  onAdd: (input: AddPluginMarketplaceInput) => Promise<void>; contextKey: string;
}) {
  const [values, setValues] = useState<Values>(empty), [pending, setPending] = useState(false), [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<{ params: AddPluginMarketplaceInput; message: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), sourceInput = useRef<HTMLInputElement>(null);
  const epoch = useRef(0), flight = useRef<number | null>(null), composing = useRef(false);
  const current = useRef({ open, contextKey }); current.current = { open, contextKey };
  const reset = () => { setValues(empty()); setAttempted(false); setFailure(null); setLinkError(null); };
  useEffect(() => {
    const version = ++epoch.current;
    flight.current = null; setPending(false); composing.current = false; reset();
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null, element = dialog.current;
    element?.showModal(); sourceInput.current?.focus();
    return () => {
      if (epoch.current === version) { epoch.current++; flight.current = null; }
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, contextKey]);
  const valid = (version: number) => epoch.current === version && current.current.open && current.current.contextKey === contextKey;
  const close = () => {
    if (flight.current !== null || !current.current.open || current.current.contextKey !== contextKey) return;
    reset(); onOpenChange(false);
  };
  const change = (key: keyof Values, value: string) => { if (flight.current === null) setValues(previous => ({ ...previous, [key]: value })); };
  const params = parseAddPluginMarketplaceInput(values);
  const submitError = failure && JSON.stringify(params) === JSON.stringify(failure.params) ? failure.message : null;
  if (!open) return null;
  return <dialog ref={dialog} className="apm-dialog" aria-labelledby="plugin-marketplace-title"
    onCancel={event => { event.preventDefault(); if (!composing.current) close(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    } }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        if (["Enter", "Escape"].includes(event.key)) event.preventDefault();
        return;
      }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), active = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) { event.preventDefault(); first.focus(); }
      }
    }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (flight.current !== null || composing.current || !current.current.open || current.current.contextKey !== contextKey) return;
      setAttempted(true); const input = parseAddPluginMarketplaceInput(values); if (!input) return;
      const version = epoch.current; flight.current = version; setPending(true); setFailure(null);
      try { await onAdd(input); if (valid(version)) { reset(); onOpenChange(false); } }
      catch (cause) { if (valid(version)) setFailure({ params: input, message: cause instanceof Error ? cause.message : "添加插件市场失败" }); }
      finally { if (valid(version) && flight.current === version) { flight.current = null; setPending(false); } }
    }}>
      <header className="apm-header"><h2 id="plugin-marketplace-title">添加插件市场</h2>
        {!pending && <button type="button" className="apm-close" aria-label="关闭" onClick={close}><CloseIcon /></button>}
        <p>从 GitHub 仓库、Git URL 或本地文件夹添加。<a href={HELP} target="_blank" rel="noreferrer" onClick={event => {
          if (!isTauriRuntime()) return; event.preventDefault(); const version = epoch.current; setLinkError(null);
          void tauriInvoke("review_link_open", { url: HELP }).catch(cause => { if (valid(version)) setLinkError(`无法打开链接：${String(cause)}`); });
        }}>了解更多</a></p>
      </header>
      <div className="apm-fields">
        <label htmlFor="plugin-marketplace-source">来源<input id="plugin-marketplace-source" ref={sourceInput} autoFocus type="text" disabled={pending}
          placeholder="openai/plugins 或 git@github.com:org/repo.git" value={values.source}
          aria-invalid={attempted && !params} aria-describedby={attempted && !params ? "plugin-marketplace-source-error" : undefined}
          onChange={event => change("source", event.target.value)} />
          {attempted && !params && <span id="plugin-marketplace-source-error" className="apm-error">请输入市场来源</span>}
        </label>
        <label htmlFor="plugin-marketplace-ref">Git 引用<input id="plugin-marketplace-ref" type="text" disabled={pending} placeholder="主分支" value={values.refName} onChange={event => change("refName", event.target.value)} /></label>
        <label htmlFor="plugin-marketplace-sparse-paths">稀疏路径<textarea id="plugin-marketplace-sparse-paths" disabled={pending} placeholder="plugins/codex" value={values.sparsePaths} onChange={event => change("sparsePaths", event.target.value)} /></label>
        {submitError !== null && <div className="apm-error" role="alert">{submitError}</div>}
        {linkError && <div className="apm-error" role="alert">{linkError}</div>}
      </div>
      <footer className="apm-footer"><button type="button" className="secondary-btn" disabled={pending} onClick={close}>取消</button>
        <button type="submit" className="primary-btn" disabled={!params || pending} aria-busy={pending}>{pending && <Loader2 size={14} className="pm-spin" aria-hidden="true" />}添加市场</button></footer>
    </form>
  </dialog>;
}
