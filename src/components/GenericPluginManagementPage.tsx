import React, { useEffect, useMemo, useRef } from "react";
import type { PluginCanonicalRootSnapshot } from "../pluginCanonicalRoot";
import { useGenericPluginUsage } from "../genericPluginUsage";
import { canonicalMcpAppId } from "../pluginManagementMcp";
import { PluginManagementDetail } from "./PluginManagementDetail";
import { PluginLogo } from "./PluginLogo";
import "./GenericPluginManagementPage.css";

interface GenericPluginManagementPageProps {
  connectionIdentity: string;
  snapshot: PluginCanonicalRootSnapshot;
  actions?: React.ReactNode;
  onBack: () => void;
  onViewDetails?: () => void;
  onOpenApp: (appId: string) => void;
  isCurrent: () => boolean;
}

export function GenericPluginManagementPage({ connectionIdentity, snapshot, actions, onBack, onViewDetails, onOpenApp, isCurrent }: GenericPluginManagementPageProps) {
  const mounted = useRef(false);
  const scope = useRef({ snapshot, connectionIdentity, epoch: 0 });
  if (scope.current.snapshot !== snapshot || scope.current.connectionIdentity !== connectionIdentity) {
    scope.current = { snapshot, connectionIdentity, epoch: scope.current.epoch + 1 };
  }
  const ticket = scope.current;
  const identity = JSON.stringify([connectionIdentity, snapshot.identity.accountId, snapshot.identity.userId, snapshot.identity.generation, snapshot.pluginId, ticket.epoch]);
  const appIds = useMemo(() => snapshot.genericUsage.flatMap(entry => entry.id === null ? [] : [entry.id]), [snapshot]);
  const usage = useGenericPluginUsage(identity, appIds, snapshot.identity);
  const current = () => mounted.current && scope.current === ticket && isCurrent();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const detail = snapshot.genericDetail;
  const title = detail?.summary.interface?.displayName ?? detail?.summary.name;
  useEffect(() => {
    if (title === undefined || !isCurrent()) return;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [identity, title]);
  const guardAction = (event: React.SyntheticEvent) => {
    if (!current()) { event.preventDefault(); event.stopPropagation(); }
  };
  if (snapshot.kind !== "generic" || !detail) return <div role="alert">无法加载插件设置</div>;
  return <PluginManagementDetail detail={detail} identity={identity}
    onBack={() => { if (current()) onBack(); }}
    onViewDetails={onViewDetails ? () => { if (current()) onViewDetails(); } : undefined}
    actions={actions ? <div className="gpm-actions" onClickCapture={guardAction} onKeyDownCapture={guardAction}>{actions}</div> : undefined}>
    {snapshot.genericUsage.length > 0 && <section className="gpm-section" aria-label="使用的应用">
      <h2>使用的应用</h2>
      <div className="gpm-group">{snapshot.genericUsage.map((entry, index) => {
        const connector = entry.id === null ? undefined : usage.connectors[entry.id];
        const links = entry.id === null ? [] : usage.links?.filter(link => canonicalMcpAppId(link.connector_id) === canonicalMcpAppId(entry.id!) && link.visibility !== "HIDDEN" && !link.id.startsWith("implicit_link::"));
        const selected = links?.find(link => link.auth_status !== "REAUTH_REQUIRED") ?? links?.[0];
        const name = connector?.name ?? entry.template?.name ?? entry.id ?? "";
        const description = connector?.description ?? entry.template?.description;
        const logo = { id: entry.id ?? entry.template?.templateId ?? String(index), source: { type: "remote" as const },
          interface: { logoUrl: connector?.logo_url ?? entry.template?.logoUrl, logoUrlDark: connector?.logo_url_dark ?? entry.template?.logoUrlDark } };
        return <button type="button" className="gpm-row" key={entry.id ?? entry.template?.templateId ?? index} disabled={entry.id === null}
          onClick={() => { if (entry.id !== null && current()) onOpenApp(entry.id); }}>
          {/* Known-app vectors and hosted logo transport remain separate parity gaps. */}
          <PluginLogo plugin={logo} className="gpm-app-logo" />
          <span className="gpm-label"><span>{name}</span>{description && <span className="gpm-description">{description}</span>}</span>
          <span className="gpm-trailing">{entry.id === null ? "尚未为你的工作空间配置" : <>{selected?.auth_status === "REAUTH_REQUIRED" && <span>重新关联</span>}<span aria-hidden="true">›</span></>}</span>
        </button>;
      })}</div>
    </section>}
    {detail.skills.length > 0 && <section className="gpm-section" aria-label="技能">
      <h2>技能</h2>
      <div className="gpm-group">{detail.skills.map(skill => <div className="gpm-row gpm-skill" key={skill.name}>
        <span className="gpm-label"><span>{skill.interface?.displayName ?? skill.name}</span>
          {(skill.interface?.shortDescription ?? skill.description) && <span className="gpm-description">{skill.interface?.shortDescription ?? skill.description}</span>}</span>
      </div>)}</div>
    </section>}
  </PluginManagementDetail>;
}
