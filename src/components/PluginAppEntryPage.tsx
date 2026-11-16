import React, { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "../chatgptService";
import { loadPluginAppEntry, type PluginAppEntry } from "../pluginAppEntry";
import "./PluginManagementDetail.css";

interface PluginAppEntryPageProps {
  connectionIdentity: string;
  appId: string;
  onResolvePlugin: (pluginId: string) => void;
  onRoot: () => void;
}

type AppEntry = Extract<PluginAppEntry, { kind: "app" }>;
export function PluginAppEntryPage({ connectionIdentity, appId, onResolvePlugin, onRoot }: PluginAppEntryPageProps) {
  const scope = JSON.stringify([connectionIdentity, appId]);
  const current = useRef({ scope, epoch: 0, mounted: false, data: null as AppEntry | null });
  const ticket = useRef(0), request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onResolvePlugin, onRoot });
  callbacks.current = { onResolvePlugin, onRoot };
  const [state, setState] = useState<{ scope: string; epoch: number; data: AppEntry | null; loading: boolean; error: string | null } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.epoch++; current.current.data = null;
  }
  const epoch = current.current.epoch;
  const active = () => current.current.mounted && current.current.scope === scope && current.current.epoch === epoch;
  const reload = async () => {
    if (!active()) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    setState({ scope, epoch, data: current.current.data, loading: true, error: null });
    try {
      const result = await loadPluginAppEntry(appId, controller.signal);
      if (!valid()) return;
      if (result.kind === "plugin") { callbacks.current.onResolvePlugin(result.pluginId); return; }
      current.current.data = result;
      setState({ scope, epoch, data: result, loading: false, error: null });
    } catch (error) {
      if (valid()) setState({ scope, epoch, data: current.current.data, loading: false, error: serviceErrorMessage(error) });
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const visible = state?.scope === scope && state.epoch === epoch ? state : { data: null, loading: true, error: null };
  const { data, loading, error } = visible;
  return <article className="pmd-detail" aria-busy={loading}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航">
      <button type="button" onClick={() => { if (active()) callbacks.current.onRoot(); }}>插件设置</button>
      {data && <><span aria-hidden="true">/</span><span aria-current="page">{data.app.name}</span></>}
    </nav>
    {data && <header className="pmd-header"><div className="pmd-heading">
      <h1>{data.app.name}</h1>
      {data.app.description && <p className="pmd-description">{data.app.description}</p>}
    </div></header>}
    {loading && !data && <p role="status">正在加载…</p>}
    {(error || data?.metadataError) && <div role="alert"><p>{error || "无法加载插件设置"}</p>
      <button type="button" className="secondary-btn-sm" disabled={loading} onClick={() => { void reload(); }}>重试</button>
    </div>}
  </article>;
}
