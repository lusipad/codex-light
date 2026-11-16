import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadPluginAppManagement, pluginAppWorkspacePublishUrl } from "../pluginAppManagement";
import { tauriInvoke } from "../bridge";
import type { ServiceIdentity } from "../chatgptService";
import { PluginAppMetadataDialog, type AppManagementSnapshot, type AppMetadataIntent, type AppMetadataOperation } from "./PluginAppMetadataDialog";
import { PluginAppDeleteDialog, type AppDeleteIntent } from "./PluginAppDeleteDialog";
import "./PluginAppManagementSection.css";

export function PluginAppManagementSection({ scope, appId, isCurrent, onUpdated, onDeleted }: {
  scope: string; appId: string; isCurrent: () => boolean; onUpdated: () => Promise<void> | void; onDeleted: (identity: ServiceIdentity) => Promise<void>;
}) {
  const key = JSON.stringify([scope, appId]), lifetime = useRef({ key, mounted: false });
  if (lifetime.current.key !== key) lifetime.current = { key, mounted: false };
  const ticket = lifetime.current, request = useRef<AbortController | null>(null);
  const active = () => lifetime.current === ticket && ticket.mounted && isCurrent();
  const [state, setState] = useState<{ ticket: typeof ticket; data: AppManagementSnapshot | null; loading: boolean; error: boolean }>({ ticket, data: null, loading: true, error: false });
  const [editing, setEditing] = useState<{ ticket: typeof ticket; snapshot: AppManagementSnapshot; operation: AppMetadataOperation } | null>(null);
  const [intents, setIntents] = useState<Partial<Record<AppMetadataOperation, AppMetadataIntent | null>>>({});
  const [deleting, setDeleting] = useState<{ ticket: typeof ticket; snapshot: AppManagementSnapshot } | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<AppDeleteIntent | null>(null), [publishError, setPublishError] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const buttons = useRef<Record<AppMetadataOperation, HTMLButtonElement | null>>({ name: null, description: null });
  const decision = useRef(state); decision.current = state;
  const read = async (preserve = false) => {
    if (!active() || request.current !== null) return;
    const controller = new AbortController(); request.current = controller;
    const previous = preserve && decision.current.ticket === ticket ? decision.current.data : null;
    setState({ ticket, data: previous, loading: true, error: false });
    try {
      const data = await loadPluginAppManagement(appId, controller.signal);
      if (active() && !controller.signal.aborted) setState({ ticket, data, loading: false, error: false });
    } catch { if (active() && !controller.signal.aborted) setState({ ticket, data: previous, loading: false, error: true }); }
    finally { if (request.current === controller) request.current = null; }
  };
  useLayoutEffect(() => { ticket.mounted = true; return () => { ticket.mounted = false; request.current?.abort(); request.current = null; }; }, [ticket]);
  useEffect(() => { setEditing(null); setIntents({}); setDeleting(null); setDeleteIntent(null); setPublishError(false); void read(); }, [ticket]);
  const visible = state.ticket === ticket ? state : null, data = visible?.data ?? null;
  const edit = editing?.ticket === ticket ? editing : null;
  const deletion = deleting?.ticket === ticket ? deleting : null;
  if (!visible || visible.loading && !data) return null;
  if (data && !data.canEditName && !data.canEditDescription && !data.canDelete && !data.canPublish && !intents.name && !intents.description && !deleteIntent && !edit && !deletion) return null;
  const publishUrl = data ? pluginAppWorkspacePublishUrl(data) : null;
  return <section className="pams-section" aria-label="管理应用">
    <h2>管理应用</h2>
    {visible.error && <div className="pams-error"><span role="alert">无法加载插件设置</span>
      <button type="button" className="secondary-btn-sm" onClick={() => { if (active() && !decision.current.loading) void read(); }}>重试</button></div>
    }
    {data && <div className="pams-group">{(["name", "description"] as const).map(operation => {
        if (!(operation === "name" ? data.canEditName : data.canEditDescription) && !intents[operation]) return null;
        return <div className="pams-row" key={operation}><span>{operation === "name" ? "应用名称" : "应用描述"}</span>
          <div><button type="button" className="secondary-btn" ref={node => { if (node) buttons.current[operation] = node; }} onClick={() => {
            if (active() && decision.current.data === data && !decision.current.loading && !decision.current.error) setEditing({ ticket, snapshot: data, operation });
          }}>{intents[operation] ? "核验更改" : "编辑"}</button></div>
        </div>;
      })}
      {publishUrl && <div className="pams-row"><span>发布到工作空间</span><div><a className="pams-publish" href={publishUrl} onClick={async event => {
        event.preventDefault();
        if (!active() || decision.current.data !== data) return;
        setPublishError(false);
        try { await tauriInvoke("review_link_open", { url: publishUrl }); }
        catch { if (active() && decision.current.data === data) setPublishError(true); }
      }}>发布到工作空间</a></div></div>}
      {(data.canDelete || deleteIntent) && <div className="pams-row"><span className="pams-delete-label">删除应用
        {data.deleteRestriction === "tenant_catalog" && <small>删除此应用前，必须先将其从你的工作空间目录中移除</small>}
        {data.deleteRestriction === "content_unavailable" && <small role="alert">无法读取应用目录信息，请重新读取资格后重试。</small>}
      </span><div><button type="button" className="pams-delete" ref={node => { if (node) deleteButton.current = node; }} disabled={!deleteIntent && (!data.canDelete || data.deleteDisabled)} onClick={() => {
        if (active() && decision.current.data === data && (deleteIntent || data.canDelete && !data.deleteDisabled)) setDeleting({ ticket, snapshot: data });
      }}>{deleteIntent ? "核验删除结果" : "删除应用"}</button>
        {data.deleteRestriction === "content_unavailable" && <button type="button" className="secondary-btn-sm" disabled={visible.loading} onClick={() => { if (active()) void read(true); }}>重试</button>}
      </div></div>}
    </div>}
    {publishError && <p className="pams-error" role="alert">无法打开工作空间发布页面。请重试。</p>}
    {edit && <PluginAppMetadataDialog key={JSON.stringify([key, edit.snapshot.identity, edit.snapshot.metadata.id, edit.operation])} scope={key}
      snapshot={edit.snapshot} operation={edit.operation} intent={intents[edit.operation] ?? null} isCurrent={active}
      returnFocusRef={{ current: buttons.current[edit.operation] }} onIntentChange={intent => { if (active()) setIntents(previous => ({ ...previous, [edit.operation]: intent })); }}
      onReadback={actual => { if (active()) setState({ ticket, data: actual, loading: false, error: false }); }}
      onUpdated={async () => { if (active()) await onUpdated(); }} onClose={() => { if (active()) setEditing(null); }} />}
    {deletion && <PluginAppDeleteDialog key={JSON.stringify([key, deletion.snapshot.identity, deletion.snapshot.metadata.id])} scope={key}
      snapshot={deletion.snapshot} intent={deleteIntent} isCurrent={active} returnFocusRef={deleteButton}
      onIntentChange={intent => { if (active()) setDeleteIntent(intent); }}
      onReadback={actual => { if (active()) setState({ ticket, data: actual, loading: false, error: false }); }}
      onDeleted={async () => { if (active()) await onDeleted(deletion.snapshot.identity); }} onClose={() => { if (active()) setDeleting(null); }} />}
  </section>;
}
