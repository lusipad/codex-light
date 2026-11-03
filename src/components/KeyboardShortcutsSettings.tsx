import React, { useEffect, useRef, useState } from "react";
import { acceleratorFromEvent, commandId, effectiveBindings, normalizeAccelerator } from "../shortcuts";
import { bindingConflict, configurableShortcuts, updateKeyBindings, type KeyboardPreferencesState } from "../keyboardPreferences";
import "./KeyboardShortcutsSettings.css";

export const KeyboardShortcutsSettings: React.FC<{ state: KeyboardPreferencesState }> = ({ state }) => {
  const [query, setQuery] = useState("");
  const [keystrokes, setKeystrokes] = useState(false);
  const [editing, setEditing] = useState<{ id: string; previous: string | null; append: boolean } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [sequence, setSequence] = useState("");
  const captureRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefix = useRef("");
  const latest = useRef(state);
  const mounted = useRef(true);
  latest.current = state;
  const clearSequence = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    prefix.current = "";
    setSequence("");
  };
  useEffect(() => {
    if (editing) captureRef.current?.focus();
    else if (keystrokes) searchRef.current?.focus();
  }, [editing, keystrokes]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      void latest.current.setCapturing(false);
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (resetOpen) resetRef.current?.showModal();
    return () => { resetRef.current?.close(); if (resetOpen) previous?.focus(); };
  }, [resetOpen]);

  const finish = async (restoreFocus = true) => {
    clearSequence();
    if (!await latest.current.setCapturing(false)) return;
    setEditing(null);
    setKeystrokes(false);
    setConflict(null);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const start = async (id: string, previous: string | null, append: boolean, trigger: HTMLElement) => {
    if (!await state.setCapturing(true) || !mounted.current) return;
    triggerRef.current = trigger;
    clearSequence();
    setConflict(null);
    setEditing({ id, previous, append });
  };
  const commit = async (accelerator: string) => {
    if (!editing) return;
    const occupied = bindingConflict(editing.id, accelerator, state.bindings);
    if (occupied) { clearSequence(); setConflict(`已由 ${occupied} 使用`); return; }
    const update = editing.append ? { type: "append" as const, accelerator } : editing.previous
      ? { type: "replace" as const, accelerator, previousAccelerator: editing.previous }
      : { type: "set" as const, accelerator };
    if (await state.save(updateKeyBindings(state.bindings, editing.id, update))) await finish();
  };
  const capture = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || state.busy) return;
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      if (keystrokes) setQuery("");
      void finish();
      return;
    }
    const accelerator = acceleratorFromEvent(event.nativeEvent);
    if (!accelerator) return;
    if (keystrokes) {
      const combined = `${query} ${accelerator}`;
      const match = configurableShortcuts.some(shortcut => effectiveBindings(shortcut.id, state.bindings)
        .some(key => normalizeAccelerator(key).startsWith(normalizeAccelerator(combined))));
      setQuery(query && match ? combined : accelerator);
      return;
    }
    if (prefix.current) {
      const combined = `${prefix.current} ${accelerator}`;
      clearSequence();
      void commit(combined);
    } else if (accelerator.includes("+")) void commit(accelerator);
    else {
      prefix.current = accelerator;
      setSequence(`${accelerator} …`);
      timer.current = setTimeout(() => { clearSequence(); void commit(accelerator); }, 1000);
    }
  };
  const search = query.trim().toLocaleLowerCase();
  const rows = configurableShortcuts.filter(shortcut => keystrokes
    ? !search || effectiveBindings(shortcut.id, state.bindings).some(key => {
      const normalized = normalizeAccelerator(key), candidate = normalizeAccelerator(query);
      return normalized === candidate || normalized.startsWith(`${candidate} `);
    })
    : !search || `${commandId(shortcut.id)} ${shortcut.label}`.toLocaleLowerCase().includes(search));
  return <div className="keyboard-settings" onKeyDown={event => {
    if (editing || keystrokes) event.stopPropagation();
  }}>
    <div className="keyboard-settings-toolbar">
      <input ref={searchRef} type="search" value={query} readOnly={keystrokes}
        aria-label={keystrokes ? "捕获搜索快捷键" : "搜索键盘快捷键"} placeholder={keystrokes ? "按下搜索快捷键" : "搜索快捷键"}
        data-shortcut-capture={keystrokes || undefined} onKeyDown={keystrokes ? capture : undefined}
        onChange={event => setQuery(event.target.value)} />
      <button type="button" aria-label="使用快捷键搜索" aria-pressed={keystrokes} disabled={state.busy || !!editing}
        onClick={async event => {
          if (keystrokes) { setQuery(""); await finish(false); return; }
          triggerRef.current = event.currentTarget;
          if (await state.setCapturing(true) && mounted.current) { setQuery(""); setKeystrokes(true); }
        }}>使用快捷键搜索</button>
      <button type="button" disabled={state.busy || (!state.bindings.length && !state.error) || !!editing || keystrokes}
        onClick={() => setResetOpen(true)}>全部重置为默认值</button>
    </div>
    {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy} onClick={state.reload}>重新读取</button></div>}
    {state.busy && !editing && <p role="status">正在读取或保存快捷键…</p>}
    {!rows.length && <p role="status">没有匹配的快捷键</p>}
    <div className="keyboard-settings-rows">
      {rows.map(shortcut => {
        const keys = effectiveBindings(shortcut.id, state.bindings);
        const custom = state.bindings.some(binding => binding.command === commandId(shortcut.id));
        return <div className="keyboard-settings-row" key={shortcut.id}>
          <span>{shortcut.label}</span>
          <div role="group" aria-label={shortcut.label} className="keyboard-settings-bindings">
            {(keys.length ? keys : [null]).map((key, index) =>
              <div className="keyboard-settings-binding" key={key ?? "none"}>
                <kbd>{key?.replaceAll("CmdOrCtrl", "Ctrl") ?? "未分配"}</kbd>
                <button type="button" aria-label={`更改 ${shortcut.label} 的按键组合`} disabled={state.busy || !!editing || keystrokes}
                  onClick={event => void start(shortcut.id, key, event.shiftKey && !!key, event.currentTarget)}>编辑</button>
                {key && <button type="button" aria-label={`清除 ${shortcut.label} 的快捷键 ${key}`} disabled={state.busy || !!editing || keystrokes}
                  onClick={() => void state.save(updateKeyBindings(state.bindings, shortcut.id, { type: "remove", accelerator: key }))}>清除</button>}
                {index === 0 && custom && <button type="button" aria-label={`恢复 ${shortcut.label} 的默认快捷键`} disabled={state.busy || !!editing || keystrokes}
                  onClick={() => void state.save(updateKeyBindings(state.bindings, shortcut.id, { type: "reset" }))}>恢复默认</button>}
              </div>)}
            {editing?.id === shortcut.id && <div className="keyboard-settings-capture">
              <input ref={captureRef} readOnly data-shortcut-capture aria-label={`为 ${shortcut.label} 录入快捷键`}
                aria-invalid={!!conflict} value={sequence || "按下快捷键"} onKeyDown={capture}
                onBlur={() => { if (!state.busy) void finish(false); }} />
              <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => void finish()}>取消</button>
              {conflict && <span role="alert">{conflict}</span>}
            </div>}
          </div>
        </div>;
      })}
    </div>
    <dialog ref={resetRef} aria-label="重置所有键盘快捷键？" onCancel={event => { event.preventDefault(); if (!state.busy) setResetOpen(false); }}
      onKeyDown={event => event.stopPropagation()}>
      <h3>重置所有键盘快捷键？</h3>
      <p>这将丢弃所有自定义快捷键并恢复默认设置</p>
      <div className="keyboard-settings-toolbar">
        <button type="button" disabled={state.busy} onClick={() => setResetOpen(false)}>取消</button>
        <button type="button" disabled={state.busy} onClick={async () => { if (await state.save([])) setResetOpen(false); }}>全部重置</button>
      </div>
    </dialog>
  </div>;
};
