import React, { useEffect, useRef } from "react";
import "./RenameThreadDialog.css";
import "./FileDiscardDialog.css";

export function FileDiscardDialog({ onDecision }: { onDecision: (discard: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const decidedRef = useRef(false);
  const composingRef = useRef(false);
  const decide = (discard: boolean) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    onDecision(discard);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    continueRef.current?.focus();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={dialogRef} className="rename-thread-dialog file-discard-dialog"
      aria-labelledby="file-discard-title" aria-describedby="file-discard-description"
      onCancel={event => { event.preventDefault(); if (!composingRef.current) decide(false); }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => { composingRef.current = false; }}
      onKeyDown={event => {
        event.stopPropagation();
        if ((composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)
          && (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
      }}>
      <form onSubmit={event => {
        event.preventDefault();
        if (!composingRef.current) decide(true);
      }}>
        <header>
          <h2 id="file-discard-title">放弃文件更改？</h2>
          <p id="file-discard-description">您对此文件所做的未保存的更改将丢失</p>
        </header>
        <footer>
          <button ref={continueRef} type="button" onClick={() => decide(false)}>继续查看</button>
          <button type="submit" className="file-discard-confirm">放弃更改</button>
        </footer>
      </form>
    </dialog>
  );
}
