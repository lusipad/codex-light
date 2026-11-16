import React, { useEffect, useId, useRef, useState } from "react";
import { serviceErrorMessage, type ServiceIdentity } from "../chatgptService";
import { loadPluginAppEntry, type PluginAppEntry } from "../pluginAppEntry";
import { PluginAppManagementSection } from "./PluginAppManagementSection";
import { usePluginDetailExpansion } from "./PluginDirectoryDetail";
import "./PluginManagementDetail.css";

interface PluginAppEntryPageProps {
  connectionIdentity: string;
  appId: string;
  isCurrent: () => boolean;
  onResolvePlugin: (pluginId: string) => void;
  onRoot: () => void;
  onDeleted: (identity: ServiceIdentity) => Promise<void>;
}

type AppEntry = Extract<PluginAppEntry, { kind: "app" }>;
export function PluginAppEntryPage({ connectionIdentity, appId, isCurrent, onResolvePlugin, onRoot, onDeleted }: PluginAppEntryPageProps) {
  const scope = JSON.stringify([connectionIdentity, appId]);
  const current = useRef({ scope, epoch: 0, mounted: false, data: null as AppEntry | null });
  const ticket = useRef(0), request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onResolvePlugin, onRoot, isCurrent, onDeleted });
  callbacks.current = { onResolvePlugin, onRoot, isCurrent, onDeleted };
  const [state, setState] = useState<{ scope: string; epoch: number; data: AppEntry | null; loading: boolean; error: string | null } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.epoch++; current.current.data = null;
  }
  const epoch = current.current.epoch;
  const active = () => current.current.mounted && current.current.scope === scope && current.current.epoch === epoch && callbacks.current.isCurrent();
  const reload = async () => {
    if (!active()) return false;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    setState({ scope, epoch, data: current.current.data, loading: true, error: null });
    try {
      const result = await loadPluginAppEntry(appId, controller.signal);
      if (!valid()) return false;
      if (result.kind === "plugin") { callbacks.current.onResolvePlugin(result.pluginId); return false; }
      current.current.data = result;
      setState({ scope, epoch, data: result, loading: false, error: null });
      return true;
    } catch (error) {
      if (valid()) setState({ scope, epoch, data: current.current.data, loading: false, error: serviceErrorMessage(error) });
      return false;
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const visible = state?.scope === scope && state.epoch === epoch ? state : { data: null, loading: true, error: null };
  const { data, loading, error } = visible;
  const descriptionId = useId();
  const expansion = usePluginDetailExpansion(`${scope}\0${data?.app.description ?? ""}`, 3);
  return <article className="pmd-detail" aria-busy={loading}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航">
      <button type="button" onClick={() => { if (active()) callbacks.current.onRoot(); }}>插件设置</button>
      {data && <><span aria-hidden="true">/</span><span aria-current="page">{data.app.name}</span></>}
    </nav>
    {data && <header className="pmd-header"><div className="pmd-heading">
      <h1>{data.app.name}</h1>
      {data.app.description && <div className="pmd-description">
        <div id={descriptionId} ref={expansion.ref} className="pmd-description-text" style={{ maxHeight: expansion.expanded ? expansion.fullHeight : expansion.maxHeight }}>{data.app.description}</div>
        {(expansion.overflowing || expansion.expanded) && <button type="button" className="pmd-expand" aria-controls={descriptionId} aria-expanded={expansion.expanded} onClick={() => { if (active()) expansion.toggle(); }}>{expansion.expanded ? "收起" : "展开"}</button>}
      </div>}
    </div></header>}
    {loading && !data && <p role="status">正在加载…</p>}
    {(error || data?.metadataError) && <div role="alert"><p>{error || "无法加载插件设置"}</p>
      <button type="button" className="secondary-btn-sm" disabled={loading} onClick={() => { void reload(); }}>重试</button>
    </div>}
    {data?.connector && <PluginAppManagementSection scope={scope} appId={appId} isCurrent={active} onDeleted={async identity => {
      if (active()) await callbacks.current.onDeleted(identity);
    }} onUpdated={async () => {
      if (!await reload()) throw Error("无法重新加载应用。请重试。");
    }} />}
  </article>;
}
