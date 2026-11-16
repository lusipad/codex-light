import type { AppInfo, PluginDetail } from "./plugins";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const normalize = (value: string) => value.trim().toLowerCase().replace(/^connector[_-]/, "").replace(/^mcp[_-]/, "").replace(/[\s_-]+/g, "");
export const canonicalMcpAppId = (id: string) => id.startsWith("asdk_app_") ? `connector_${id.slice(9)}` : id;
export type PluginMcpRow =
  | { kind: "app"; name: string; app: AppInfo }
  | { kind: "config"; name: string; configKey: string | null; enabled: boolean };

// Current oszP.LJ uses first-match config identity, not plugin ownership.
export function resolvePluginMcpRows(detail: PluginDetail, config: unknown, availableApps: AppInfo[]): PluginMcpRow[] {
  const root = object(config);
  const servers = object(root?.mcp_servers ?? root?.mcpServers) ?? {};
  const apps = availableApps;
  const release = object(detail.summary.remoteServicePlugin?.release);
  const manifestApps = object(object(release?.app_manifest)?.apps);
  const manifest = manifestApps !== null && detail.summary.version != null && detail.summary.version === release?.version
    ? new Map(Object.entries(manifestApps).map(([key, value]) => [key, object(value)?.id])) : undefined;
  return detail.mcpServers.map(name => {
    const manifestId = manifest?.get(name);
    const app = manifest
      ? apps.find(item => typeof manifestId === "string" && canonicalMcpAppId(item.id) === canonicalMcpAppId(manifestId))
      : apps.find(item => [item.id, item.name, ...item.pluginDisplayNames ?? [], ...Object.keys(item.labels ?? {}), ...Object.values(item.labels ?? {})]
        .some(value => normalize(value) === normalize(name)));
    if (app) return { kind: "app", name, app };
    const entry = Object.entries(servers).find(([key, value]) => {
      const rawName = object(value)?.name;
      return [key, typeof rawName === "string" && rawName.trim() ? rawName : key].some(value => normalize(value) === normalize(name));
    });
    return { kind: "config", name, configKey: entry?.[0] ?? null, enabled: object(entry?.[1])?.enabled !== false };
  });
}
