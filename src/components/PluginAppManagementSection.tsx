import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadPluginAppManagement } from "../pluginAppManagement";
import { PluginAppMetadataDialog, type AppManagementSnapshot, type AppMetadataIntent, type AppMetadataOperation } from "./PluginAppMetadataDialog";
import "./PluginAppManagementSection.css";

export function PluginAppManagementSection({ scope, appId, isCurrent, onUpdated }: {
  scope: string; appId: string; isCurrent: () => boolean; onUpdated: () => Promise<void> | void;
}) {
  const key = JSON.stringify([scope, appId]), lifetime = useRef({ key, mounted: false });
  if (lifetime.current.key !== key) lifetime.current = { key, mounted: false };
  const ticket = lifetime.current, request = useRef<AbortController | null>(null);
  const active = () => lifetime.current === ticket && ticket.mounted && isCurrent();
  const [state, setState] = useState<{ ticket: typeof ticket; data: AppManagementSnapshot | null; loading: boolean; error: boolean }>({ ticket, data: null, loading: true, error: false });
  const [editing, setEditing] = useState<{ ticket: typeof ticket; snapshot: AppManagementSnapshot; operation: AppMetadataOperation } | null>(null);
  const [intents, setIntents] = useState<Partial<Record<AppMetadataOperation, AppMetadataIntent | null>>>({});
  const buttons = useRef<Record<AppMetadataOperation, HTMLButtonElement | null>>({ name: null, description: null });
  const decision = useRef(state); decision.current = state;
  const read = async () => {
    if (!active() || request.current !== null) return;
    const controller = new AbortController(); request.current = controller;
    setState({ ticket, data: null, loading: true, error: false });
    try {
      const data = await loadPluginAppManagement(appId, controller.signal);
      if (active() && !controller.signal.aborted) setState({ ticket, data, loading: false, error: false });
    } catch { if (active() && !controller.signal.aborted) setState({ ticket, data: null, loading: false, error: true }); }
    finally { if (request.current === controller) request.current = null; }
  };
  useLayoutEffect(() => { ticket.mounted = true; return () => { ticket.mounted = false; request.current?.abort(); request.current = null; }; }, [ticket]);
  useEffect(() => { setEditing(null); setIntents({}); void read(); }, [ticket]);
  const visible = state.ticket === ticket ? state : null, data = visible?.data ?? null;
  const edit = editing?.ticket === ticket ? editing : null;
  if (!visible || visible.loading) return null;
  if (data && !data.canEditName && !data.canEditDescription && !intents.name && !intents.description) return null;
  return <section className="pams-section" aria-label="管理应用">
    <h2>管理应用</h2>
    {visible.error ? <div className="pams-error"><span role="alert">无法加载插件设置</span>
      <button type="button" className="secondary-btn-sm" onClick={() => { if (active() && !decision.current.loading) void read(); }}>重试</button></div>
      : data && <div className="pams-group">{(["name", "description"] as const).map(operation => {
        if (!(operation === "name" ? data.canEditName : data.canEditDescription) && !intents[operation]) return null;
        return <div className="pams-row" key={operation}><span>{operation === "name" ? "应用名称" : "应用描述"}</span>
          <div><button type="button" className="secondary-btn" ref={node => { if (node) buttons.current[operation] = node; }} onClick={() => {
            if (active() && decision.current.data === data && !decision.current.loading && !decision.current.error) setEditing({ ticket, snapshot: data, operation });
          }}>{intents[operation] ? "核验更改" : "编辑"}</button></div>
        </div>;
      })}</div>}
    {edit && <PluginAppMetadataDialog key={JSON.stringify([key, edit.snapshot.identity, edit.snapshot.metadata.id, edit.operation])} scope={key}
      snapshot={edit.snapshot} operation={edit.operation} intent={intents[edit.operation] ?? null} isCurrent={active}
      returnFocusRef={{ current: buttons.current[edit.operation] }} onIntentChange={intent => { if (active()) setIntents(previous => ({ ...previous, [edit.operation]: intent })); }}
      onReadback={actual => { if (active()) setState({ ticket, data: actual, loading: false, error: false }); }}
      onUpdated={async () => { if (active()) await onUpdated(); }} onClose={() => { if (active()) setEditing(null); }} />}
  </section>;
}
