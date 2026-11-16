import React, { useId, useLayoutEffect, useRef, useState } from "react";
import "./AddPluginMarketplaceDialog.css";

export function PluginCanonicalUninstall({ name, accountCount, disabled, isCurrent, onConfirm }: {
  name: string; accountCount: number; disabled: boolean; isCurrent: () => boolean; onConfirm: () => Promise<void>;
}) {
  const scope = JSON.stringify([name, accountCount]), generationRef = useRef({ scope }), mounted = useRef(false), sequence = useRef(0), flight = useRef<object | null>(null);
  if (generationRef.current.scope !== scope) generationRef.current = { scope };
  const generation = generationRef.current, id = useId(), trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), composing = useRef(false);
  const [selection, setSelection] = useState<{ generation: typeof generation; token: number; guard: () => boolean } | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const selected = selection?.generation === generation ? selection : null;
  const latest = useRef({ disabled, selected }); latest.current = { disabled, selected };
  const active = () => mounted.current && generationRef.current === generation;
  const valid = () => active() && selected !== null && latest.current.selected?.token === selected.token && selected.guard() && isCurrent();
  useLayoutEffect(() => { mounted.current = true; flight.current = null; composing.current = false; setSelection(null); setPending(false); setError(null); return () => { mounted.current = false; flight.current = null; }; }, [generation]);
  useLayoutEffect(() => {
    if (!selected) return;
    const element = dialog.current, previous = trigger.current; element?.showModal(); cancel.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [generation, selected?.token]);
  const close = () => { if (!active() || !selected || latest.current.selected?.token !== selected.token || flight.current !== null || composing.current) return; latest.current.selected = null; setSelection(null); setError(null); };
  return <><button ref={trigger} type="button" className="secondary-btn-sm" disabled={disabled || pending} onClick={() => {
    if (!active() || latest.current.disabled || flight.current !== null || latest.current.selected || !isCurrent()) return;
    const next = { generation, token: ++sequence.current, guard: isCurrent }; latest.current.selected = next; setSelection(next); setError(null);
  }}>卸载</button>
    {selected && <dialog key={`${scope}:${selected.token}`} ref={dialog} className="apm-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCompositionStart={() => { if (valid()) composing.current = true; }} onCompositionEnd={() => { if (active() && latest.current.selected?.token === selected.token) composing.current = false; }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation(); if (!active() || latest.current.selected?.token !== selected.token) return;
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (["Enter", "Escape"].includes(event.key)) event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')).filter(element => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1), focused = event.currentTarget.ownerDocument.activeElement;
          if (!first) event.preventDefault();
          else if (event.shiftKey && (focused === first || !event.currentTarget.contains(focused))) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (focused === last || !event.currentTarget.contains(focused))) { event.preventDefault(); first.focus(); }
        }
      }}>
      <form onSubmit={async event => {
        event.preventDefault(); event.stopPropagation(); if (!valid() || latest.current.disabled || flight.current !== null || composing.current) return;
        const request = {}; flight.current = request; setPending(true); setError(null);
        try { await onConfirm(); if (valid() && flight.current === request) { latest.current.selected = null; setSelection(null); } }
        catch (failure) { if (active() && latest.current.selected?.token === selected.token) setError(
          (failure as { code?: string } | null)?.code === "unconfirmed_removal" ? "卸载结果尚未确认，请关闭弹窗后核验卸载结果。" : "无法移除该插件。请重试"); }
        finally { if (active() && flight.current === request) { flight.current = null; setPending(false); } }
      }}>
        <header className="apm-header"><h2 id={`${id}-title`}>要卸载 {name} 吗？</h2><p id={`${id}-description`}>{accountCount > 1 ? "这将移除该插件及其关联的所有账户" : "重新添加后才能使用此插件"}</p></header>
        {error && <div className="apm-fields"><p role="alert" className="apm-error">{error}</p></div>}
        <footer className="apm-footer"><button ref={cancel} type="button" className="secondary-btn" disabled={pending} onClick={close}>取消</button>
          <button type="submit" className="danger-btn-sm" disabled={disabled || pending} aria-busy={pending}>卸载</button></footer>
      </form>
    </dialog>}
  </>;
}
