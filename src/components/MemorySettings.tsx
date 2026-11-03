import React, { useEffect, useRef, useState } from "react";
import { memoryPreferenceValues, useMemoryPreferences } from "../memoryPreferences";
import "./MemorySettings.css";

export function MemorySettings({ active, accountIdentity, connectionIdentity, onNavigationGuardChange }: {
  active: boolean; accountIdentity?: string; connectionIdentity?: string;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
}) {
  const state = useMemoryPreferences({ active, accountIdentity, connectionIdentity });
  const values = memoryPreferenceValues(state.data);
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const latest = useRef(state); latest.current = state;
  const epoch = useRef(0);
  const busy = state.loading || state.pending !== null;
  useEffect(() => {
    epoch.current++; setConfirm(false);
    return () => { epoch.current++; };
  }, [accountIdentity, connectionIdentity, active]);
  useEffect(() => {
    onNavigationGuardChange?.(active ? () => latest.current.canNavigate() : null);
    return () => onNavigationGuardChange?.(null);
  }, [active, accountIdentity, connectionIdentity, onNavigationGuardChange]);
  useEffect(() => {
    if (active && confirm) { dialog.current?.showModal(); cancelButton.current?.focus(); }
    else dialog.current?.close();
  }, [active, confirm]);
  const closeDialog = () => {
    const version = epoch.current;
    setConfirm(false);
    requestAnimationFrame(() => {
      if (version === epoch.current) (latest.current.error ? retryButton.current : deleteButton.current)?.focus();
    });
  };
  const reset = async () => {
    if (!latest.current.canNavigate()) return;
    const version = epoch.current;
    await state.reset();
    if (version === epoch.current) closeDialog();
  };
  if (!active) return null;
  const host = state.data?.hostName ?? "";
  const disabled = busy || Boolean(state.error);
  return <section className="memory-settings" aria-labelledby="codex-memory-heading" aria-busy={busy}>
    <h3 id="codex-memory-heading">Codex 记忆</h3>
    {state.loading && !state.data && <p role="status">正在加载…</p>}
    {state.error && <div role="alert" className="error-banner">{state.error}
      <button type="button" className="secondary-btn" ref={retryButton} disabled={busy} onClick={() => void state.reload()}>重试</button></div>}
    {state.data?.statusError && <p role="status" className="memory-settings-status-error">无法读取记忆状态：{state.data.statusError}</p>}
    {state.resetDone && <p role="status" className="success-banner">Codex 记忆已删除</p>}
    {state.data && !state.data.feature && <p role="status">这台电脑不支持 Codex 记忆功能</p>}
    {state.data?.feature && <div>
      <div className="memory-settings-row">
        <div><label htmlFor="codex-memory-enabled">启用 Codex 记忆功能</label>
          <p id="codex-memory-enabled-description">根据 {host} 上的聊天创建记忆，并使用这些记忆为今后在 {host} 上的聊天提供个性化体验</p>
          {values.enabledReason && <p className="memory-settings-lock">{values.enabledReason}</p>}</div>
        <button id="codex-memory-enabled" type="button" role="switch" aria-label="启用 Codex 记忆" aria-checked={values.enabled}
          aria-describedby="codex-memory-enabled-description" className="memory-settings-switch" disabled={disabled || Boolean(values.enabledReason)}
          onClick={() => void state.change("enabled", !values.enabled)}><span /></button>
      </div>
      <div className="memory-settings-row">
        <div><label htmlFor="codex-memory-external">允许从使用工具的聊天中生成记忆</label>
          <p id="codex-memory-external-description">从使用过 MCP 工具或网页搜索的聊天生成记忆</p>
          {values.externalReason && <p className="memory-settings-lock">{values.externalReason}</p>}</div>
        <button id="codex-memory-external" type="button" role="switch" aria-label="允许从使用工具的聊天中生成记忆" aria-checked={values.allowExternal}
          aria-describedby="codex-memory-external-description" className="memory-settings-switch"
          disabled={disabled || !state.data.feature.enabled || Boolean(values.externalReason)} onClick={() => void state.change("external-context", !values.allowExternal)}><span /></button>
      </div>
      <div className="memory-settings-row">
        <div><span>删除 Codex 记忆</span><p>删除 {host} 上的全部 Codex 记忆</p>
          {values.resetReason && <p className="memory-settings-lock">{values.resetReason}</p>}</div>
        <button type="button" className="secondary-btn" ref={deleteButton} disabled={disabled || Boolean(values.resetReason)} onClick={() => setConfirm(true)}>删除</button>
      </div>
    </div>}
    <dialog className="codex-modal-dialog memory-reset-dialog" ref={dialog} aria-labelledby="codex-memory-reset-title" aria-describedby="codex-memory-reset-description"
      onCancel={event => { event.preventDefault(); if (latest.current.canNavigate()) closeDialog(); }}
      onKeyDown={event => {
        if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <h3 id="codex-memory-reset-title">要删除全部 Codex 记忆吗？</h3>
      <p id="codex-memory-reset-description">此操作将删除 {host} 的所有 Codex 记忆</p>
      <div className="memory-reset-actions">
        <button type="button" className="secondary-btn" ref={cancelButton} disabled={busy} onClick={closeDialog}>取消</button>
        <button type="button" className="primary-btn" disabled={busy} onClick={reset}>删除</button>
      </div>
    </dialog>
  </section>;
}
