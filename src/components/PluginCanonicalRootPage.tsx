import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadPluginCanonicalRoot, type PluginCanonicalRootSnapshot } from "../pluginCanonicalRoot";
import { PluginAppDetailsPage } from "./PluginAppDetailsPage";
import { GenericPluginManagementPage } from "./GenericPluginManagementPage";

type RootActions = { blocked: boolean; accountCount: number; isCurrent: () => boolean; snapshot: PluginCanonicalRootSnapshot };
type Props = Omit<React.ComponentProps<typeof PluginAppDetailsPage>, "appId" | "canonicalRoot" | "onUnavailable" | "onOpenPlugin" | "renderCanonicalActions"> & {
  onOpenApp: (appId: string) => void;
  refreshRevision?: number;
  selectedSkillName?: string | null;
  onCloseSkill?: () => void;
  renderCanonicalActions?: (context: RootActions) => React.ReactNode;
};
type RootState = { scope: string; version: number; loading: boolean; snapshot: PluginCanonicalRootSnapshot | null; error: boolean };

export function PluginCanonicalRootPage({ onOpenApp, refreshRevision, selectedSkillName, onCloseSkill, renderCanonicalActions, ...props }: Props) {
  const scope = JSON.stringify([props.connectionIdentity, props.pluginId, refreshRevision]);
  const lifetime = useRef({ scope, version: 0, mounted: false });
  if (lifetime.current.scope !== scope) lifetime.current = { scope, version: lifetime.current.version + 1, mounted: false };
  const version = lifetime.current.version;
  const active = () => lifetime.current.mounted && lifetime.current.scope === scope && lifetime.current.version === version;
  const [state, setState] = useState<RootState>({ scope, version, loading: true, snapshot: null, error: false });
  const sequence = useRef(0), controller = useRef<{ scope: string; version: number; value: AbortController } | null>(null);
  const decision = useRef(state);
  decision.current = state;
  const visible = state.scope === scope && state.version === version ? state : null;
  const snapshot = visible?.snapshot ?? null;
  const isCurrent = () => active() && decision.current.scope === scope && decision.current.version === version &&
    !decision.current.loading && !decision.current.error && decision.current.snapshot === snapshot && snapshot !== null;
  const reload = () => {
    if (!active()) return;
    controller.current?.value.abort();
    const abort = new AbortController(), token = ++sequence.current;
    controller.current = { scope, version, value: abort };
    const pending = { scope, version, loading: true, snapshot: null, error: false };
    decision.current = pending;
    setState(pending);
    void loadPluginCanonicalRoot(props.pluginId, abort.signal).then(next => {
      if (!active() || abort.signal.aborted || sequence.current !== token) return;
      const ready = { scope, version, loading: false, snapshot: next, error: false };
      decision.current = ready; setState(ready);
    }, () => {
      if (!active() || abort.signal.aborted || sequence.current !== token) return;
      const failed = { scope, version, loading: false, snapshot: null, error: true };
      decision.current = failed; setState(failed);
    });
  };
  useLayoutEffect(() => {
    lifetime.current.mounted = true;
    return () => { if (lifetime.current.scope === scope && lifetime.current.version === version) lifetime.current.mounted = false; };
  }, [scope, version]);
  useEffect(() => {
    reload();
    return () => {
      const owned = controller.current;
      if (owned?.scope === scope && owned.version === version) owned.value.abort();
    };
  }, [scope, version]);

  if (visible?.loading || !visible || visible.error || !snapshot) return <article className="pmd-detail" aria-busy={visible?.loading ?? true}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航"><button type="button" onClick={() => { if (active()) props.onBack(); }}>插件设置</button></nav>
    {visible?.error ? <div role="alert"><p>无法加载插件设置</p><button type="button" className="secondary-btn-sm" onClick={() => { if (active() && !decision.current.loading) reload(); }}>重试</button></div>
      : <p role="status">正在加载…</p>}
  </article>;
  if (snapshot.kind === "generic") return <GenericPluginManagementPage connectionIdentity={props.connectionIdentity} snapshot={snapshot}
    selectedSkillName={selectedSkillName} onCloseSkill={() => { if (isCurrent()) onCloseSkill?.(); }}
    onRetryRequirements={() => { if (isCurrent()) reload(); }}
    isCurrent={isCurrent} onBack={() => { if (isCurrent()) props.onBack(); }}
    onViewDetails={props.onViewDetails ? () => { if (isCurrent()) props.onViewDetails?.(); } : undefined}
    onOpenApp={appId => { if (isCurrent() && snapshot.genericUsage.some(entry => entry.id === appId)) onOpenApp(appId); }}
    actions={renderCanonicalActions?.({ blocked: !isCurrent(), accountCount: 0, isCurrent, snapshot })} />;
  return <PluginAppDetailsPage {...props} key={JSON.stringify([scope, version, snapshot.appId, snapshot.identity])} appId={snapshot.appId!}
    canonicalRoot={{ pluginHeader: snapshot.pluginHeader, hostedApp: snapshot.hostedApp }}
    onBack={() => { if (isCurrent()) props.onBack(); }} onOpenPlugin={() => { if (isCurrent()) reload(); }} onUnavailable={() => { if (isCurrent()) reload(); }}
    onSelectLink={(...args) => isCurrent() && props.onSelectLink(...args)}
    onRenamed={props.onRenamed ? () => { if (isCurrent()) props.onRenamed?.(); } : undefined}
    onDisconnected={props.onDisconnected ? () => { if (isCurrent()) props.onDisconnected?.(); } : undefined}
    onSync={props.onSync ? linkId => { if (isCurrent()) props.onSync?.(linkId); } : undefined}
    onViewDetails={props.onViewDetails ? () => { if (isCurrent()) props.onViewDetails?.(); } : undefined}
    renderCanonicalActions={renderCanonicalActions ? context => renderCanonicalActions({ ...context, snapshot, blocked: context.blocked || !isCurrent(), isCurrent: () => isCurrent() && context.isCurrent() }) : undefined} />;
}
