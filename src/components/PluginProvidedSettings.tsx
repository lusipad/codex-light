import React, { useEffect, useRef, useState } from "react";
import { callAppServer } from "../bridge";
import type { PluginDetail } from "../plugins";
import { discoverPluginProvidedSettings, type PluginProvidedSettingsView } from "../pluginProvidedSettings";
import { PluginProvidedSettingsForm } from "./PluginProvidedSettingsForm";

export async function readPluginProvidedSettingsViews(detail: PluginDetail): Promise<PluginProvidedSettingsView[]> {
  const rows: unknown[] = [], cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { data: unknown[]; nextCursor?: string | null } = await callAppServer("mcpServerStatus/list", { cursor, limit: 100, detail: "full" });
    if (!Array.isArray(page?.data)) throw Error("MCP 状态响应格式无效");
    rows.push(...page.data); cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (typeof cursor !== "string" || !cursor.trim() || cursors.has(cursor)) throw Error("MCP 状态分页无效");
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return discoverPluginProvidedSettings(detail, rows, "local");
}

export function PluginProvidedSettings({ detail, identity }: { detail: PluginDetail; identity: string }) {
  const scope = JSON.stringify([identity, detail.marketplacePath, detail.marketplaceName, detail.summary.id]);
  const current = useRef(scope); current.current = scope;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ scope: string; detail: PluginDetail; views: PluginProvidedSettingsView[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!detail.summary.installed) return;
    let alive = true;
    setState(null);
    void readPluginProvidedSettingsViews(detail).then(views => {
      if (alive && current.current === scope) setState({ scope, detail, views, error: false });
    }).catch(() => {
      if (alive && current.current === scope) setState({ scope, detail, views: [], error: true });
    });
    return () => { alive = false; };
  }, [scope, detail, revision]);
  const visible = state?.scope === scope && state.detail === detail ? state : null;
  if (!detail.summary.installed || !visible || !visible.error && !visible.views.length) return null;
  return <section aria-label="设置"><h2>设置</h2>
    {visible.error ? <div role="alert"><p>无法加载或保存设置。请重试。</p><button type="button" className="secondary-btn-sm" onClick={() => setRevision(value => value + 1)}>重试</button></div>
      : visible.views.map(view => <div key={JSON.stringify([view.hostId, view.server, view.readTool])}>
        {visible.views.length > 1 && <h3>{view.title}</h3>}
        <PluginProvidedSettingsForm view={view} identity={identity} disabled={detail.summary.availability === "DISABLED_BY_ADMIN"} />
      </div>)}
  </section>;
}
