import React, { useId, useLayoutEffect, useRef } from "react";
import "./AddPluginMarketplaceDialog.css";
import "./AppshotIntroDialog.css";

// Fixed 26.1111 Chinese copy. The platform illustration and pixel/native parity
// are not yet verified; do not replace the missing official asset with a fake SVG.
export function AppshotIntroDialog({ isCurrent, onAccept, onClose }: {
  isCurrent: () => boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  const titleId = useId(), descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false), composing = useRef(false), handled = useRef(false);
  const latest = useRef({ isCurrent, onAccept, onClose }); latest.current = { isCurrent, onAccept, onClose };
  const active = () => mounted.current && !handled.current && latest.current.isCurrent();
  useLayoutEffect(() => {
    mounted.current = true; handled.current = false; composing.current = false;
    const element = dialog.current, previous = document.activeElement;
    element?.showModal(); cancel.current?.focus({ preventScroll: true });
    return () => {
      const restore = mounted.current && latest.current.isCurrent();
      mounted.current = false; element?.close();
      if (restore && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const finish = (accept: boolean) => {
    if (!active() || composing.current) return;
    handled.current = true;
    if (accept) latest.current.onAccept(); else latest.current.onClose();
  };
  return <dialog ref={dialog} className="apm-dialog appshot-intro-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); finish(false); }}
    onClose={() => { if (active()) finish(false); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyUp={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = controls[0], last = controls.at(-1), focused = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && focused === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && focused === last) { event.preventDefault(); first.focus(); }
      }
    }} onClick={event => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish(false);
    }}>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (!composing.current) finish(true); }}>
      <div className="apm-header">
        <h2 id={titleId}>启用应用快照</h2>
        <p id={descriptionId}>应用快照可让你将当前窗口附加到消息中。它们会包含窗口中的所有文本，包括滚动到可见区域外的内容。</p>
      </div>
      <footer className="apm-footer">
        <button ref={cancel} type="button" className="secondary-btn" onClick={() => finish(false)}>取消</button>
        <button type="submit" className="primary-btn">启用</button>
      </footer>
    </form>
  </dialog>;
}
