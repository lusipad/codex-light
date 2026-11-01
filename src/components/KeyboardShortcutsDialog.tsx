import React, { useEffect, useRef, useState } from "react";
import { availableShortcuts } from "../shortcuts";
import { CloseIcon } from "./Icons";
import "./KeyboardShortcutsDialog.css";

export const KeyboardShortcutsDialog: React.FC<{
  onClose: () => void;
  hasActiveThread: boolean;
  hasWorkspace: boolean;
}> = ({ onClose, hasActiveThread, hasWorkspace }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const groups = [
    { key: "global", label: "通用" },
    { key: "thread", label: "聊天" },
    { key: "panels", label: "面板" },
    { key: "composer", label: "通用" },
  ] as const;
  const matches = availableShortcuts({ hasActiveThread, hasWorkspace }).filter(item =>
    !search || `${item.id} ${item.label} ${item.keys}`.toLocaleLowerCase().includes(search)
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    searchRef.current?.focus();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="keyboard-shortcuts-dialog"
      aria-label="键盘快捷键"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (query) setQuery("");
          else onClose();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === "/") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header>
        <h2>键盘快捷键</h2>
        <button type="button" aria-label="关闭键盘快捷键" onClick={onClose}><CloseIcon size={18} /></button>
      </header>
      <input
        ref={searchRef}
        type="search"
        aria-label="搜索键盘快捷键"
        placeholder="搜索快捷键"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="keyboard-shortcuts-list">
        {!matches.length && <p role="status">没有匹配的快捷键</p>}
        {groups.map(group => {
          const items = matches.filter(item => item.group === group.key);
          return items.length ? (
            <section key={group.key}>
              <h3>{group.label}</h3>
              {items.map(item => (
                <div className="keyboard-shortcuts-row" key={item.id}>
                  <span>{item.label}</span><kbd>{item.keys}</kbd>
                </div>
              ))}
            </section>
          ) : null;
        })}
      </div>
    </dialog>
  );
};
