import React, { useEffect, useRef, useState } from "react";
import { isTauriRuntime, tauriInvoke } from "../bridge";
import { useMcpSettingsState, type McpDraft, type McpPair } from "../mcpSettingsState";
import { CloseIcon } from "./Icons";
import { cancelNavigation, deferNavigation, takeNavigation } from "../navigationContinuation";
import "./McpSettings.css";

type Guard = (action: () => void) => boolean;
const DOCS = "https://developers.openai.com/codex/mcp/";
export function McpSettings({ cwd, connectionIdentity, onConfigUpdated, onRestartAppServer, onNavigationGuardChange,
  embedded = false, externalQuery, createRequest = 0 }: {
  cwd?: string; connectionIdentity: string; onConfigUpdated: () => void | Promise<void>;
  onRestartAppServer: () => void | Promise<unknown>; onNavigationGuardChange?: (guard: Guard | null) => void;
  embedded?: boolean; externalQuery?: string; createRequest?: number;
}) {
  const state = useMcpSettingsState({ cwd, connectionIdentity, onConfigUpdated, onRestartAppServer });
  const [query, setQuery] = useState(""), [confirmation, setConfirmation] = useState<"discard" | "reload" | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const latest = useRef(state); latest.current = state;
  const pendingAction = useRef<(() => void) | null>(null), epoch = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null), addButton = useRef<HTMLButtonElement>(null), nameInput = useRef<HTMLInputElement>(null), backButton = useRef<HTMLButtonElement>(null);
  const entryButtons = useRef(new Map<string, HTMLButtonElement>());
  const previousEditor = useRef<{ context: string; name: string | null } | null>(null);
  const context = JSON.stringify([cwd, connectionIdentity]);
  const currentContext = useRef(context); currentContext.current = context;
  const previousCreate = useRef({ context, request: createRequest });
  const restoreFocus = (detail = false) => {
    const version = epoch.current;
    requestAnimationFrame(() => {
      if (epoch.current !== version) return;
      if (detail) (latest.current.editor?.entry ? backButton.current : nameInput.current)?.focus();
      else addButton.current?.focus();
    });
  };
  const guard: Guard = action => {
    if (!latest.current.canNavigate()) return false;
    if (!latest.current.isDirty()) return true;
    deferNavigation(pendingAction, action); setConfirmation("discard"); return false;
  };
  useEffect(() => {
    epoch.current++; setConfirmation(null); cancelNavigation(pendingAction); setLinkError(null);
    return () => { epoch.current++; cancelNavigation(pendingAction); };
  }, [context]);
  useEffect(() => {
    onNavigationGuardChange?.(guard);
    return () => onNavigationGuardChange?.(null);
  }, [context, onNavigationGuardChange]);
  useEffect(() => {
    const previous = previousCreate.current;
    previousCreate.current = { context, request: createRequest };
    if (previous.context !== context || previous.request === createRequest || createRequest === 0) return;
    const version = epoch.current;
    const action = () => {
      const current = latest.current;
      if (epoch.current !== version || !current.canNavigate() || !current.data?.userLayer || current.busy || current.pending || current.restarting) return;
      current.open();
    };
    const current = latest.current;
    if (!current.data?.userLayer || current.busy || current.pending || current.restarting) return;
    if (guard(action)) action();
  }, [context, createRequest]);
  useEffect(() => {
    if (confirmation) dialog.current?.showModal(); else dialog.current?.close();
  }, [confirmation]);
  useEffect(() => {
    if (state.editor) {
      if (!previousEditor.current || previousEditor.current.context !== context) restoreFocus(true);
      previousEditor.current = { context, name: state.editor.entry?.name ?? null };
    } else {
      const previous = previousEditor.current; previousEditor.current = null;
      if (previous?.context === context) {
        const version = epoch.current;
        requestAnimationFrame(() => { if (epoch.current === version) (previous.name ? entryButtons.current.get(previous.name) ?? addButton.current : addButton.current)?.focus(); });
      }
    }
  }, [Boolean(state.editor), context]);
  useEffect(() => {
    if (!state.dirty && !state.busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [state.dirty, state.busy]);
  const disabled = state.busy || state.pending || state.restarting;
  const draft = state.editor?.draft;
  const change = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) => { if (draft) state.change({ ...draft, [key]: value }); };
  const arrayField = (key: "args" | "envVars", label: string, addLabel: string) => draft && <fieldset className="mcp-detail-array" disabled={disabled}>
    <legend>{label}</legend>
    {draft[key].map((value, index) => <div className="mcp-detail-input-row" key={index}>
      <input aria-label={`${label} ${index + 1}`} value={value} onChange={event => change(key, draft[key].map((old, position) => position === index ? event.target.value : old))} />
      <button type="button" className="icon-btn" aria-label={`移除${label} ${index + 1}`} onClick={() => change(key, draft[key].filter((_, position) => position !== index))}><CloseIcon /></button>
    </div>)}
    <button type="button" className="secondary-btn" onClick={() => change(key, [...draft[key], ""])}>{addLabel}</button>
  </fieldset>;
  const mapField = (key: "env" | "headers" | "envHeaders", label: string, addLabel: string) => draft && <fieldset className="mcp-detail-array" disabled={disabled}>
    <legend>{label}</legend>
    {draft[key].map((row, index) => <div className="mcp-detail-input-row" key={index}>
      {(["key", "value"] as const).map(part => <input key={part} aria-label={`${label} ${index + 1} ${part === "key" ? "名称" : "值"}`} value={row[part]}
        onChange={event => change(key, draft[key].map((old, position): McpPair => position === index ? { ...old, [part]: event.target.value } : old))} />)}
      <button type="button" className="icon-btn" aria-label={`移除${label} ${index + 1}`} onClick={() => change(key, draft[key].filter((_, position) => position !== index))}><CloseIcon /></button>
    </div>)}
    <button type="button" className="secondary-btn" onClick={() => change(key, [...draft[key], { key: "", value: "" }])}>{addLabel}</button>
  </fieldset>;
  const reload = () => { if (state.isDirty() && !state.pending) setConfirmation("reload"); else void state.reload(); };
  const docs = <a href={DOCS} aria-label="打开 MCP 文档" target="_blank" rel="noreferrer" onClick={event => {
    if (!isTauriRuntime()) return;
    event.preventDefault(); const version = epoch.current; setLinkError(null);
    void tauriInvoke("review_link_open", { url: DOCS }).catch(cause => { if (epoch.current === version) setLinkError(`无法打开 MCP 文档：${String(cause)}`); });
  }}>文档</a>;
  const restart = state.requiresRestart && <button type="button" className="secondary-btn" disabled={state.busy || state.pending || state.restarting} onClick={() => {
    const action = () => { latest.current.discard(); void latest.current.restart(); };
    if (guard(action)) action();
  }}>重启</button>;
  const filtered = state.entries.filter(entry => entry.name.toLowerCase().includes((externalQuery ?? query).trim().toLowerCase()));
  const rows = (plugin: boolean) => filtered.filter(entry => (entry.source === "plugin") === plugin).map(entry => <div className="mcp-settings-row" key={entry.name}>
    <div className="mcp-server-name"><span>{entry.name}</span>
      {entry.readOnlyReason && entry.source !== "plugin" && <span className="mcp-settings-description">{entry.readOnlyReason}</span>}
      {state.statuses[entry.name]?.authStatus === "notLoggedIn" && <span className="mcp-settings-description">需要身份验证</span>}
    </div>
    <div className="mcp-server-actions">
      {!plugin && <button type="button" className="secondary-btn" ref={node => { if (node) entryButtons.current.set(entry.name, node); else entryButtons.current.delete(entry.name); }}
        aria-label={`${entry.name} 设置`} disabled={disabled || Boolean(entry.readOnlyReason) || entry.transport === "unknown"} onClick={() => state.open(entry)}>设置</button>}
      {!plugin && (entry.enabled === null ? <span className="mcp-settings-description">启用状态未知</span> : <button type="button" className="mcp-settings-switch" role="switch" aria-label={`${entry.name} 启用`} aria-checked={entry.enabled}
        disabled={disabled || Boolean(entry.readOnlyReason)} onClick={() => void state.toggle(entry)}><span /></button>)}
    </div>
  </div>);
  return <div className="settings-scroll-container mcp-settings" aria-busy={state.busy || state.restarting}>
    {state.error && <div role="alert" className="error-banner">{state.error}<button type="button" className="secondary-btn" disabled={state.busy} onClick={reload}>重新读取</button></div>}
    {linkError && <p role="alert" className="error-banner">{linkError}</p>}
    {state.pending && <p role="status">操作已提交，等待配置核验。<button type="button" className="secondary-btn" disabled={state.loading} onClick={() => void state.reload()}>重新读取</button></p>}
    {state.loading && !state.data && <p role="status">正在加载…</p>}
    {!state.editor ? <>
      {(!embedded || restart) && <div className="mcp-settings-toolbar">{!embedded && <h3>服务器</h3>}<div>{restart}{!embedded && <button type="button" className="secondary-btn" ref={addButton}
        disabled={!state.data?.userLayer || disabled} onClick={() => state.open()}>添加服务器</button>}</div></div>}
      {state.statusError && <p role="alert" className="mcp-settings-description">{state.statusError}</p>}
      {!embedded && state.entries.length > 0 && <input className="mcp-settings-search" type="search" aria-label="搜索 MCP 服务器" placeholder="搜索 MCP 服务器" value={query} onChange={event => setQuery(event.target.value)} />}
      {rows(false)}
      {filtered.some(entry => entry.source === "plugin") && <section><h3>来自插件</h3>{rows(true)}</section>}
      {!state.loading && state.data && state.entries.length === 0 && <div className="mcp-settings-empty"><p>未连接 MCP 服务器</p>
        {!embedded && <button type="button" className="secondary-btn" disabled={!state.data.userLayer || disabled} onClick={() => state.open()}>添加服务器</button>}</div>}
      {state.entries.length > 0 && !filtered.length && <p>未找到 MCP 服务器</p>}
      {state.data && !state.data.userLayer && <p role="status">MCP 服务器设置不可用</p>}
    </> : draft && <section className="mcp-settings-detail">
      <div className="mcp-settings-toolbar"><button type="button" className="secondary-btn" ref={backButton} disabled={state.busy || state.restarting}
        onClick={() => { if (guard(state.discard)) state.discard(); }}>返回</button><div>{docs}{restart}
          {state.editor.entry && <button type="button" className="secondary-btn" disabled={disabled} onClick={() => void state.remove()}>卸载</button>}</div></div>
      <h3>{state.editor.entry ? `更新 ${state.editor.entry.name} MCP` : "连接至自定义 MCP"}</h3>
      {state.externalChange && <p role="status">配置已在其他位置更改。你的草稿已保留。<button type="button" className="secondary-btn" disabled={state.busy} onClick={() => setConfirmation("reload")}>重新加载</button></p>}
      <fieldset className="mcp-detail-fields" disabled={disabled}>
        <label htmlFor="mcp-detail-name">名称</label><input id="mcp-detail-name" ref={nameInput} value={draft.label} disabled={Boolean(state.editor.entry)} onChange={event => change("label", event.target.value)} />
        <label htmlFor="mcp-detail-transport">类型</label><select id="mcp-detail-transport" aria-label="MCP 服务器类型" value={draft.transport} disabled={Boolean(state.editor.entry)} onChange={event => change("transport", event.target.value as "stdio" | "http")}>
          <option value="stdio">STDIO</option><option value="http">流式 HTTP</option></select>
        {state.editor.entry && <p className="mcp-settings-description">如需切换 MCP 服务器类型，请先卸载当前配置。</p>}
        {draft.transport === "stdio" ? <>
          <label htmlFor="mcp-detail-command">启动命令</label><input id="mcp-detail-command" value={draft.command} onChange={event => change("command", event.target.value)} />
          {arrayField("args", "参数", "添加参数")}{mapField("env", "环境变量", "添加环境变量")}{arrayField("envVars", "环境变量传递", "添加变量")}
          <label htmlFor="mcp-detail-cwd">工作目录</label><input id="mcp-detail-cwd" value={draft.cwd} onChange={event => change("cwd", event.target.value)} />
        </> : <>
          <label htmlFor="mcp-detail-url">URL</label><input id="mcp-detail-url" value={draft.url} onChange={event => change("url", event.target.value)} />
          <label htmlFor="mcp-detail-bearer">Bearer 令牌环境变量</label><input id="mcp-detail-bearer" value={draft.bearer} onChange={event => change("bearer", event.target.value)} />
          {mapField("headers", "标头", "添加标头")}{mapField("envHeaders", "来自环境变量的标头", "添加变量")}
        </>}
      </fieldset>
      <div className="mcp-detail-save"><button type="button" className="primary-btn" disabled={disabled || state.externalChange || !state.dirty || !draft.label.trim() || !(draft.transport === "stdio" ? draft.command.trim() : draft.url.trim())} onClick={() => void state.save()}>保存</button></div>
    </section>}
    <dialog ref={dialog} className="codex-modal-dialog mcp-discard-dialog" aria-labelledby="mcp-discard-title" aria-describedby="mcp-discard-description" onCancel={event => { event.preventDefault(); setConfirmation(null); cancelNavigation(pendingAction); restoreFocus(true); }}>
      <h3 id="mcp-discard-title">放弃未保存的更改？</h3><p id="mcp-discard-description">{confirmation === "reload" ? "重新读取将替换当前 MCP 草稿。" : "离开将放弃当前 MCP 草稿。"}</p>
      <div className="mcp-detail-save"><button type="button" className="secondary-btn" autoFocus onClick={() => { setConfirmation(null); cancelNavigation(pendingAction); restoreFocus(true); }}>继续编辑</button>
        <button type="button" className="primary-btn" onClick={() => {
          if (currentContext.current !== context || !state.canNavigate()) return;
          const action = takeNavigation(pendingAction), replace = confirmation === "reload"; setConfirmation(null);
          if (replace) { action?.onCancelled?.(); void state.reload(true).then(() => restoreFocus(true)); return; }
          state.discard(); action?.();
        }}>放弃更改</button></div>
    </dialog>
  </div>;
}
