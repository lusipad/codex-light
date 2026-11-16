import React, { useEffect, useRef, useState } from "react";
import { Boxes, ChevronRight } from "lucide-react";
import { tauriInvoke } from "../bridge";
import type { AppTemplateSummary, PluginDetail } from "../plugins";
import { loadLocalPluginTemplates, localPluginTemplateManagementUrl, type LocalPluginTemplateSnapshot } from "../pluginLocalTemplates";
import { PluginTemplateRows } from "./PluginTemplateRows";

interface Props {
  detail: PluginDetail;
  identity: string;
  blocked: boolean;
  onOpenApp?: (id: string) => void;
  onRefresh: () => Promise<void>;
}

export function LocalPluginApps({ detail, identity, blocked, onOpenApp, onRefresh }: Props) {
  const scopeRef = useRef({ detail, identity, blocked });
  if (scopeRef.current.detail !== detail || scopeRef.current.identity !== identity || scopeRef.current.blocked !== blocked) scopeRef.current = { detail, identity, blocked };
  const scope = scopeRef.current;
  const controller = useRef<AbortController | null>(null);
  const action = useRef(false);
  const awaitingReturn = useRef(false);
  const refresh = useRef(onRefresh); refresh.current = onRefresh;
  const [state, setState] = useState<{ scope: object; snapshot: LocalPluginTemplateSnapshot } | null>(null);
  const [error, setError] = useState<{ message: string; settings: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const current = () => scopeRef.current === scope && controller.current?.signal.aborted === false;
  useEffect(() => {
    const read = new AbortController(); controller.current = read;
    setState(null); setError(null); setBusy(null); action.current = false; awaitingReturn.current = false;
    void loadLocalPluginTemplates(detail, read.signal).then(snapshot => {
      if (scopeRef.current === scope && !read.signal.aborted) setState({ scope, snapshot });
    }).catch(() => { if (scopeRef.current === scope && !read.signal.aborted) setError({ message: "无法加载插件设置", settings: true }); });
    const returned = () => {
      if (!current() || !awaitingReturn.current || action.current) return;
      awaitingReturn.current = false;
      void refresh.current().catch(reason => { if (current()) setError({ message: `应用状态刷新失败：${String(reason)}`, settings: false }); });
    };
    window.addEventListener("focus", returned);
    return () => { read.abort(); window.removeEventListener("focus", returned); };
  }, [scope]);

  const snapshot = state?.scope === scope ? state.snapshot : null;
  const templates = snapshot?.templates ?? (detail.appTemplates ?? []) as AppTemplateSummary[];
  const apps = snapshot?.hideImplicitApp ? [] : detail.apps;
  const unmaterialized = templates.filter(template => template.materializedAppIds.length === 0);
  const managementUrl = (id: string) => !blocked && snapshot?.remotePluginId && snapshot.eligibleTemplateIds.includes(id)
    ? localPluginTemplateManagementUrl(snapshot.remotePluginId, templates.length) : null;
  const manage = async (id: string) => {
    if (!snapshot || !current() || action.current || !managementUrl(id)) return;
    action.current = true; setBusy(id); setError(null);
    try {
      const fresh = await loadLocalPluginTemplates(detail, controller.current!.signal, snapshot.identity ?? undefined);
      if (!current()) return;
      setState({ scope, snapshot: fresh });
      if (blocked || !fresh.remotePluginId || !fresh.eligibleTemplateIds.includes(id)) throw Error("当前无法管理此应用，请刷新后重试。");
      await tauriInvoke("review_link_open", { url: localPluginTemplateManagementUrl(fresh.remotePluginId, fresh.templates.length) });
      if (current()) awaitingReturn.current = true;
    } catch (reason) { if (current()) setError({ message: `无法打开应用管理：${String(reason)}`, settings: false }); }
    finally { if (current()) { action.current = false; setBusy(null); } }
  };
  if (snapshot && !error && apps.length + unmaterialized.length === 0) return null;
  return <>
    {!snapshot && !error && <div role="status" className="local-plugin-apps-loading">
      <span data-loading-indicator="" className="local-plugin-apps-spinner" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" opacity=".3" />
          <path d="M12 5a7 7 0 1 1-7 7" stroke="currentColor" strokeWidth="2" />
        </svg>
      </span><span>正在加载设置…</span>
    </div>}
    {error && <div className="local-plugin-apps-error"><span role="alert">{error.message}</span>
      <button type="button" className="local-plugin-apps-retry" onClick={() => {
        if (action.current || !current()) return;
        void refresh.current().catch(reason => { if (current()) setError({ message: error.settings ? "无法加载插件设置" : `应用状态刷新失败：${String(reason)}`, settings: error.settings }); });
      }}>重试</button></div>}
    {apps.length + unmaterialized.length > 0 && <section aria-label="使用的应用" className="local-plugin-apps">
    <div className="local-plugin-apps-header"><div className="local-plugin-apps-title-copy"><div className="local-plugin-apps-title">使用的应用</div></div></div>
    <div className="pm-detail-included-list">
      {apps.map(app => onOpenApp ? <button type="button" key={app.id} className="pm-detail-included-row pm-detail-included-preview"
        disabled={blocked} onClick={() => onOpenApp(app.id)}>
        <span className="pm-detail-included-icon"><Boxes size={24} aria-hidden="true" /></span>
        <span className="pm-detail-included-copy"><span>{app.name}</span>{app.description && <span className="pm-detail-included-description">{app.description}</span>}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button> : <div key={app.id} className="pm-detail-included-row"><span className="pm-detail-included-icon"><Boxes size={24} aria-hidden="true" /></span>
        <span className="pm-detail-included-copy"><span>{app.name}</span>{app.description && <span className="pm-detail-included-description">{app.description}</span>}</span></div>)}
      <PluginTemplateRows templates={templates} managementUrl={managementUrl} onManage={manage} busyTemplateId={busy} />
    </div>
    {snapshot?.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
  </section>}
  </>;
}
