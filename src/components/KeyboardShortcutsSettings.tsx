import React, { useEffect, useRef, useState } from "react";
import { acceleratorFromEvent, commandId, effectiveBindings, normalizeAccelerator, migrateKeyBindings, shortcutAllowsAppend, shortcutAllowsSequence } from "../shortcuts";
import { bindingConflict, configurableShortcuts, updateKeyBindings, type KeyboardPreferencesState } from "../keyboardPreferences";
import "./KeyboardShortcutsSettings.css";

export const KeyboardShortcutsSettings: React.FC<{ state: KeyboardPreferencesState }> = ({ state }) => {
  const [query, setQuery] = useState("");
  const [keystrokes, setKeystrokes] = useState(false);
  const [editing, setEditing] = useState<{ id: string; previous: string | null; append: boolean; index: number } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [sequence, setSequence] = useState("");
  const captureRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<{ id: string; index: number } | HTMLElement | null>(null);
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
    if (editing || keystrokes || state.busy || !returnFocus.current) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    const button = "id" in target && "index" in target ? editButtons.current.get(`${target.id}:${target.index}`) : target as HTMLElement;
    if (mounted.current && button?.isConnected) button.focus();
  }, [editing, keystrokes, state.busy]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      returnFocus.current = null;
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
    if (!await latest.current.setCapturing(false) || !mounted.current) return;
    returnFocus.current = restoreFocus ? editing ? { id: editing.id, index: editing.index } : triggerRef.current : null;
    setEditing(null);
    setKeystrokes(false);
    setConflict(null);
  };
  const start = async (id: string, previous: string | null, append: boolean, index: number, trigger: HTMLElement) => {
    if (append && !shortcutAllowsAppend(id)) return;
    if (!await state.setCapturing(true) || !mounted.current) return;
    triggerRef.current = trigger;
    clearSequence();
    setConflict(null);
    setEditing({ id, previous, append, index });
  };
  const commit = async (accelerator: string) => {
    if (!editing) return;
    const occupied = bindingConflict(editing.id, accelerator, state.bindings, state.primaryNumberShortcutTarget);
    if (occupied) { clearSequence(); setConflict(`已由 ${occupied} 使用`); return; }
    const update = editing.append ? { type: "append" as const, accelerator } : editing.previous
      ? { type: "replace" as const, accelerator, previousAccelerator: editing.previous }
      : { type: "set" as const, accelerator };
    if (await state.save(updateKeyBindings(state.bindings, editing.id, update, state.primaryNumberShortcutTarget))) await finish();
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
      const match = configurableShortcuts.some(shortcut => effectiveBindings(shortcut.id, state.bindings, state.primaryNumberShortcutTarget)
        .some(key => normalizeAccelerator(key).startsWith(normalizeAccelerator(combined))));
      setQuery(query && match ? combined : accelerator);
      return;
    }
    if (prefix.current) {
      const combined = `${prefix.current} ${accelerator}`;
      clearSequence();
      void commit(combined);
    } else if (accelerator.includes("+") || !editing || !shortcutAllowsSequence(editing.id)) void commit(accelerator);
    else {
      prefix.current = accelerator;
      setSequence(`${accelerator} …`);
      timer.current = setTimeout(() => { clearSequence(); void commit(accelerator); }, 1000);
    }
  };
  const search = query.trim().toLocaleLowerCase();
  const rows = configurableShortcuts.filter(shortcut => keystrokes
    ? !search || effectiveBindings(shortcut.id, state.bindings, state.primaryNumberShortcutTarget).some(key => {
      const normalized = normalizeAccelerator(key), candidate = normalizeAccelerator(query);
      return normalized === candidate || normalized.startsWith(`${candidate} `);
    })
    : !search || `${commandId(shortcut.id)} ${shortcut.label} ${shortcut.description ?? ""}`.toLocaleLowerCase().includes(search));
  return <div className="keyboard-settings" onKeyDown={event => {
    if (editing || keystrokes) event.stopPropagation();
  }}>
    <label className="keyboard-settings-toolbar">
      <span>主要编号快捷键用于</span>
      <select aria-label="主要编号快捷键用于" value={state.primaryNumberShortcutTarget} disabled={state.busy || !!editing || keystrokes}
        onChange={event => void state.saveNumberTarget(event.target.value as "tabs" | "sidebar")}>
        <option value="tabs">选项卡</option><option value="sidebar">侧边栏聊天</option>
      </select>
    </label>
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
        const keys = effectiveBindings(shortcut.id, state.bindings, state.primaryNumberShortcutTarget);
        const custom = migrateKeyBindings(state.bindings).some(binding => binding.command === commandId(shortcut.id) && (binding.version == null || binding.version === 1));
        return <div className="keyboard-settings-row" key={shortcut.id}>
          <span title={shortcut.description}>{shortcut.label}</span>
          <div role="group" aria-label={shortcut.label} className="keyboard-settings-bindings">
            {(keys.length ? keys : [null]).map((key, index) =>
              <div className="keyboard-settings-binding" key={key ?? "none"}>
                <kbd>{key?.replaceAll("CmdOrCtrl", "Ctrl") ?? "未分配"}</kbd>
                <button type="button" ref={button => {
                  const id = `${shortcut.id}:${index}`;
                  if (button) editButtons.current.set(id, button); else editButtons.current.delete(id);
                }} aria-label={`更改 ${shortcut.label} 的按键组合`} disabled={state.busy || !!editing || keystrokes}
                  onClick={event => void start(shortcut.id, key, event.shiftKey && !!key && shortcutAllowsAppend(shortcut.id), index, event.currentTarget)}>编辑</button>
                {key && <button type="button" aria-label={`清除 ${shortcut.label} 的快捷键 ${key}`} disabled={state.busy || !!editing || keystrokes}
                  onClick={() => void state.save(updateKeyBindings(state.bindings, shortcut.id, { type: "remove", accelerator: key }, state.primaryNumberShortcutTarget))}>清除</button>}
                {index === 0 && custom && <button type="button" aria-label={`恢复 ${shortcut.label} 的默认快捷键`} disabled={state.busy || !!editing || keystrokes}
                  onClick={() => void state.save(updateKeyBindings(state.bindings, shortcut.id, { type: "reset" }, state.primaryNumberShortcutTarget))}>恢复默认</button>}
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
