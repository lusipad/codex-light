import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PluginAppSyncSnapshot, PluginAppSyncStatus } from "../pluginAppSync";
import { usePluginGithubSync } from "../pluginGithubSyncState";
import "./PluginGithubSyncSettings.css";

export function PluginGithubSyncSettings({ connectionIdentity, parent, status, disabled = false, onDisable, onSaved }: {
  connectionIdentity: string; parent: PluginAppSyncSnapshot; status: PluginAppSyncStatus; disabled?: boolean;
  onDisable: () => boolean | void; onSaved?: () => void;
}) {
  const { state, reload, submitQuery, loadMore, toggle, cancel, save } = usePluginGithubSync(connectionIdentity, parent, status);
  const [query, setQuery] = useState(""), [localPending, setLocalPending] = useState(false), [localError, setLocalError] = useState<string | null>(null);
  const details = status.user_connection_details, scope = JSON.stringify([connectionIdentity, parent.identity.accountId, parent.identity.userId, parent.identity.generation,
    parent.details?.pluginId, parent.routeAppId, parent.appId, details.backing_link_id, details.connection_instance_id, state.scope]);
  const generationRef = useRef({ scope }), mounted = useRef(false), composing = useRef(false), flight = useRef<object | null>(null), id = useId();
  if (generationRef.current.scope !== scope) generationRef.current = { scope };
  const generation = generationRef.current, current = useRef({ state, disabled }); current.current = { state, disabled };
  const active = () => mounted.current && generationRef.current === generation;
  const busyNow = () => current.current.disabled || current.current.state.loading || current.current.state.searching || current.current.state.loadingMore || current.current.state.pending || flight.current !== null;
  const busy = disabled || state.loading || state.searching || state.loadingMore || state.pending || localPending;
  const locked = busy || state.blocked || state.uncertain;
  useLayoutEffect(() => {
    mounted.current = true; flight.current = null; composing.current = false; setQuery(""); setLocalPending(false); setLocalError(null);
    return () => { mounted.current = false; flight.current = null; };
  }, [generation]);
  const run = async (operation: "read" | "search" | "more" | "save") => {
    const latest = current.current.state;
    if (!active() || busyNow() || operation !== "read" && latest.uncertain || operation === "save" && (latest.blocked || !latest.dirty) || operation === "search" && composing.current) return;
    if (operation === "more" && latest.nextToken === null) return;
    const request = {}; flight.current = request; setLocalPending(true); setLocalError(null);
    try {
      if (operation === "read") await reload();
      else if (operation === "search") await submitQuery(query.trim());
      else if (operation === "more") await loadMore();
      else if (latest.selectedIds.length === 0) { if (await onDisable() === false && active()) setLocalError("当前无法禁用同步"); }
      else if (await save() && active() && flight.current === request) onSaved?.();
    } catch { if (active()) setLocalError(operation === "save" ? "无法保存已同步的代码仓库。请重试" : "无法加载插件设置"); }
    finally { if (active() && flight.current === request) { flight.current = null; setLocalPending(false); } }
  };
  return <section key={scope} className="pgs-settings" aria-labelledby={`${id}-heading`} aria-busy={busy}>
    <header><h2 id={`${id}-heading`}>已同步的代码仓库</h2><p>最多选择 5 个代码仓库进行同步，以获得更快、更完整的回答。其他代码仓库仍可访问</p></header>
    <form className="pgs-search" onCompositionStart={() => { if (active()) composing.current = true; }} onCompositionEnd={() => { if (active()) composing.current = false; }}
      onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } }}
      onSubmit={event => { event.preventDefault(); event.stopPropagation(); void run("search"); }}>
      <input type="search" name="repository-search" aria-label="搜索代码仓库" placeholder="搜索代码仓库" value={query} disabled={busy || state.uncertain}
        onChange={event => { if (active() && !busyNow() && !current.current.state.uncertain) setQuery(event.target.value); }} />
      <button type="submit" className="secondary-btn-sm" disabled={busy || state.uncertain}>搜索</button>
    </form>
    {state.loading && <p role="status"><Loader2 size={14} className="pm-spin" aria-hidden="true" />正在加载…</p>}
    {state.error ? <div role="alert"><p>无法加载插件设置</p><button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => { void run("read"); }}>重试</button></div>
      : !state.loading && <>
        <div className="pgs-repositories">{state.repositories.length === 0 ? <p>未找到代码仓库</p> : state.repositories.map(repository => {
          const checked = state.selectedIds.includes(repository.id), unavailable = locked || state.selectedIds.length >= 5 && !checked;
          return <label className="pgs-repository" key={repository.id}><input type="checkbox" checked={checked} disabled={unavailable} onChange={() => {
            const latest = current.current.state;
            if (!active() || busyNow() || latest.blocked || latest.uncertain || !latest.repositories.some(item => item.id === repository.id) || latest.selectedIds.length >= 5 && !latest.selectedIds.includes(repository.id)) return;
            setLocalError(null); toggle(repository.id);
          }} /><span><span className="pgs-name">{repository.name}</span>{repository.description && <span className="pgs-description">{repository.description}</span>}</span></label>;
        })}</div>
        {state.nextToken !== null && <button type="button" className="secondary-btn-sm" disabled={busy || state.uncertain} aria-busy={state.loadingMore} onClick={() => { void run("more"); }}>{state.loadingMore && <Loader2 size={14} className="pm-spin" aria-hidden="true" />}加载更多代码仓库</button>}
        {state.pageError && <div role="alert"><p>无法加载插件设置</p><button type="button" className="secondary-btn-sm" disabled={busy || state.uncertain} onClick={() => { void run("read"); }}>重试</button></div>}
      </>}
    {(state.saveError || localError || state.uncertain) && <div role="alert"><p>{state.uncertain ? "代码仓库保存结果尚未确认，请重新读取后核对。" : localError || "无法保存已同步的代码仓库。请重试"}</p>
      {state.uncertain && <button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => { void run("read"); }}>重新读取</button>}</div>}
    {state.dirty && <footer><button type="button" className="secondary-btn-sm" disabled={locked} onClick={() => { if (active() && !busyNow() && !current.current.state.blocked && !current.current.state.uncertain) { setLocalError(null); cancel(); } }}>取消</button>
      <button type="button" className="primary-btn-sm" disabled={locked || Boolean(state.error)} aria-busy={state.pending || localPending} onClick={() => { void run("save"); }}>{(state.pending || localPending) && <Loader2 size={14} className="pm-spin" aria-hidden="true" />}保存</button></footer>}
  </section>;
}
