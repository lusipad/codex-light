import { useEffect, useRef, useState } from "react";
import { configRead, configValueWrite } from "./config";
import { listAllApps, type AppInfo, type PluginDetail } from "./plugins";
import { resolvePluginMcpRows, type PluginMcpRow } from "./pluginManagementMcp";

interface Snapshot {
  scope: string;
  detail: PluginDetail;
  config: unknown;
  loading: boolean;
  pending: string | null;
  optimisticEnabled: boolean | null;
  error: string | null;
  uncertain: boolean;
}
export function usePluginManagementMcp(detail: PluginDetail, identity: string, cwd?: string, onConfigUpdated?: () => void | Promise<void>) {
  const scope = JSON.stringify([identity, cwd ?? null]);
  const current = useRef({ scope, detail });
  current.current = { scope, detail };
  const epoch = useRef(0), busy = useRef<object | null>(null), alive = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [apps, setApps] = useState<{ scope: string; detail: PluginDetail; data: AppInfo[]; error: string | null } | null>(null);
  const appRequest = useRef(0);
  const isCurrent = (generation: number) => alive.current && epoch.current === generation && current.current.scope === scope && current.current.detail === detail;
  const readApps = async () => {
    if (!alive.current || current.current.scope !== scope || current.current.detail !== detail) return;
    const generation = epoch.current, request = ++appRequest.current;
    try {
      const data = await listAllApps({ forceRefetch: true });
      if (isCurrent(generation) && request === appRequest.current) setApps({ scope, detail, data, error: null });
    } catch (error) {
      if (isCurrent(generation) && request === appRequest.current) setApps({ scope, detail, data: [], error: `应用目录读取失败；以下为当前配置匹配结果：${String(error)}` });
    }
  };
  const read = async () => {
    if (!alive.current || busy.current || current.current.scope !== scope || current.current.detail !== detail) return;
    const token = {}, generation = epoch.current;
    busy.current = token;
    setSnapshot({ scope, detail, config: null, loading: true, pending: null, optimisticEnabled: null, error: null, uncertain: false });
    try {
      const result = await configRead(cwd, true);
      if (!isCurrent(generation)) return;
      setSnapshot({ scope, detail, config: result.config, loading: false, pending: null, optimisticEnabled: null, error: null, uncertain: false });
    } catch (error) {
      if (isCurrent(generation)) setSnapshot({ scope, detail, config: null, loading: false, pending: null, optimisticEnabled: null, error: `无法加载 MCP 服务器：${String(error)}`, uncertain: true });
    } finally { if (busy.current === token) busy.current = null; }
  };
  useEffect(() => {
    epoch.current++;
    alive.current = true;
    busy.current = null;
    void read();
    void readApps();
    return () => { alive.current = false; epoch.current++; busy.current = null; };
  }, [scope, detail]);

  const visible = snapshot?.scope === scope && snapshot.detail === detail ? snapshot : null;
  const appState = apps?.scope === scope && apps.detail === detail ? apps : null;
  const rows = visible && !visible.loading && visible.config !== null ? resolvePluginMcpRows(detail, visible.config, appState?.data ?? []).map(row =>
    row.kind === "config" && visible.pending === row.configKey && visible.optimisticEnabled !== null ? { ...row, enabled: visible.optimisticEnabled } : row)
    : [];
  const toggle = async (row: PluginMcpRow, enabled: boolean) => {
    if (!alive.current || busy.current || !snapshot || snapshot.scope !== scope || snapshot.detail !== detail || snapshot.loading || snapshot.uncertain ||
      current.current.scope !== scope || current.current.detail !== detail || detail.summary.availability === "DISABLED_BY_ADMIN" ||
      row.kind !== "config" || row.configKey === null || !rows.includes(row) || row.enabled === enabled) return;
    const token = {}, generation = epoch.current, key = row.configKey;
    busy.current = token;
    setSnapshot({ ...snapshot, pending: key, optimisticEnabled: enabled, error: null });
    let writeError: unknown = null;
    try {
      // Quoted segments preserve a literal server key containing dots or quotes.
      await configValueWrite(`mcp_servers.${JSON.stringify(key)}.enabled`, enabled, "upsert");
    } catch (error) { writeError = error; }
    if (!isCurrent(generation)) return;
    try {
      const config = await configRead(cwd, true);
      if (!isCurrent(generation)) return;
      // App metadata can arrive during a write; confirmation concerns the actual config key.
      const actual = resolvePluginMcpRows(detail, config.config, []).find(item => item.kind === "config" && item.configKey === key);
      const confirmed = actual?.kind === "config" && actual.enabled === enabled;
      setSnapshot({ scope, detail, config: config.config, loading: false, pending: null, optimisticEnabled: null, uncertain: false,
        error: confirmed ? null : writeError ? `无法更改 MCP 服务器：${String(writeError)}` : "配置已提交，但读取的启用状态与请求不一致，请核对配置来源。" });
      if (confirmed && onConfigUpdated) {
        try { await onConfigUpdated(); }
        catch (error) { if (isCurrent(generation)) setSnapshot(value => value && ({ ...value, error: `启用状态已确认，但刷新应用配置失败：${String(error)}` })); }
      }
    } catch (error) {
      if (isCurrent(generation)) setSnapshot({ ...snapshot, pending: null, optimisticEnabled: null, uncertain: true,
        error: `无法确认配置结果，请重新读取后核对：${String(writeError ?? error)}` });
    } finally { if (busy.current === token) busy.current = null; }
  };
  return { snapshot: visible ? { ...visible, rows, error: visible.error ?? appState?.error ?? null } : null,
    retry: async () => { await Promise.all([read(), readApps()]); }, toggle };
}
