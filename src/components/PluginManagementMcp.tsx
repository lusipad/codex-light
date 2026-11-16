import React from "react";
import { ChevronRight, Plug } from "lucide-react";
import type { PluginDetail } from "../plugins";
import { usePluginManagementMcp } from "../pluginManagementMcpState";

export function PluginManagementMcp({ detail, identity, cwd, onOpenSettings, onConfigUpdated }: {
  detail: PluginDetail; identity: string; cwd?: string;
  onOpenSettings?: () => void; onConfigUpdated?: () => void | Promise<void>;
}) {
  const { snapshot, retry, toggle } = usePluginManagementMcp(detail, identity, cwd, onConfigUpdated);
  const disabled = detail.summary.availability === "DISABLED_BY_ADMIN";
  return <section aria-label="MCP 服务器" aria-busy={!snapshot || snapshot.loading}>
    <h2>MCP 服务器</h2>
    {(!snapshot || snapshot.loading) && <p className="pm-detail-included-description" role="status">正在加载…</p>}
    {snapshot?.error && <div role="alert"><p>{snapshot.error}</p><button type="button" className="pm-detail-included-settings"
      disabled={snapshot.pending !== null || snapshot.loading} onClick={() => void retry()}>重试</button></div>}
    <div className="pm-detail-included-list">{snapshot?.rows.map((row, index) => <div className="pm-detail-included-skill" key={`${row.name}:${index}`}>
      {row.kind === "app" ? <div className="pm-detail-included-row">
        <span className="pm-detail-included-icon"><Plug size={24} aria-hidden="true" /></span>
        <span className="pm-detail-included-copy">{row.app.name}</span>
      </div> : <button type="button" className="pm-detail-included-row pm-detail-included-preview" disabled={!onOpenSettings}
        onClick={onOpenSettings} aria-label={`${row.name} 设置`}>
        <span className="pm-detail-included-icon"><Plug size={24} aria-hidden="true" /></span>
        <span className="pm-detail-included-copy">{row.name}</span><ChevronRight size={16} aria-hidden="true" />
      </button>}
      {row.kind === "config" && row.configKey !== null && <button type="button" role="switch" aria-label="切换 MCP 服务器的启用状态"
        aria-checked={row.enabled} className={`pm-skill-toggle ${row.enabled ? "on" : ""}`}
        disabled={disabled || snapshot.pending !== null || snapshot.uncertain} onClick={() => void toggle(row, !row.enabled)} />}
    </div>)}</div>
  </section>;
}
