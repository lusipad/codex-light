import { useEffect, useRef, useState } from "react";
import { readPluginUsageMetadata, readPluginUsageLinks, type ServiceIdentity } from "./chatgptService";
import { decodePluginAppConnector, decodePluginAppLinks, type PluginAppDetails, type PluginAppLink } from "./pluginAppDetails";
import { canonicalMcpAppId } from "./pluginManagementMcp";

export interface GenericPluginUsageState {
  connectors: Record<string, PluginAppDetails["connector"]>;
  links: PluginAppLink[] | null;
  metadataErrors: Record<string, string>;
  linksError: string | null;
}
const invalid = () => Error("应用使用信息响应格式或归属无效，请重新读取。");
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const appIds = (values: unknown): string[] => {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string" || !value.trim())) throw invalid();
  const seen = new Set<string>(); return values.filter((value: string) => { const key = canonicalMcpAppId(value); if (seen.has(key)) return false; seen.add(key); return true; });
};
export function decodeGenericPluginUsageMetadata(raw: unknown, appId: string): PluginAppDetails["connector"] {
  const body = object(raw);
  if (!body || typeof body.appId !== "string" || canonicalMcpAppId(body.appId) !== canonicalMcpAppId(appId)) throw invalid();
  return decodePluginAppConnector(body.connector, appId);
}
export function decodeGenericPluginUsageLinks(raw: unknown, expectedIds: string[]): PluginAppLink[] {
  const body = object(raw), expected = appIds(expectedIds), returned = appIds(body?.appIds);
  if (!body || !Array.isArray(body.appIds) || returned.length !== body.appIds.length || returned.length !== expected.length ||
    returned.some(id => !expected.some(value => canonicalMcpAppId(value) === canonicalMcpAppId(id))) || !Array.isArray(body.links)) throw invalid();
  const ids = new Set<string>();
  return body.links.map(rawLink => {
    const link = object(rawLink), appId = typeof link?.connector_id === "string" ? expected.find(id => canonicalMcpAppId(id) === canonicalMcpAppId(link.connector_id as string)) : undefined;
    if (!appId) throw invalid();
    const decoded = decodePluginAppLinks([rawLink], appId)[0];
    if (ids.has(decoded.id)) throw invalid(); ids.add(decoded.id); return decoded;
  });
}

export function useGenericPluginUsage(scope: string, ids: string[], identity: ServiceIdentity): GenericPluginUsageState {
  const requested = appIds(ids), key = JSON.stringify([scope, identity.accountId, identity.userId, identity.generation, requested]);
  const generationRef = useRef({ key }); if (generationRef.current.key !== key) generationRef.current = { key };
  const generation = generationRef.current;
  const empty = (): GenericPluginUsageState => ({ connectors: Object.create(null), links: requested.length ? null : [], metadataErrors: Object.create(null), linksError: null });
  const [stored, setStored] = useState<{ generation: typeof generation; value: GenericPluginUsageState } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let mounted = true, value = empty();
    const active = () => mounted && !controller.signal.aborted && generationRef.current === generation;
    const publish = (patch: Partial<GenericPluginUsageState>) => { if (!active()) return; value = { ...value, ...patch }; setStored({ generation, value }); };
    publish({});
    if (requested.length) {
      for (const appId of requested) void (async () => {
        try {
          const raw = await readPluginUsageMetadata(appId, identity, controller.signal);
          if (!active()) return;
          const connector = decodeGenericPluginUsageMetadata(raw, appId);
          publish({ connectors: Object.assign(Object.create(null), value.connectors, { [appId]: connector }) });
        } catch { if (active()) publish({ metadataErrors: Object.assign(Object.create(null), value.metadataErrors, { [appId]: "无法加载应用信息" }) }); }
      })();
      void (async () => {
        try {
          const raw = await readPluginUsageLinks(requested, identity, controller.signal);
          if (!active()) return;
          publish({ links: decodeGenericPluginUsageLinks(raw, requested), linksError: null });
        } catch { if (active()) publish({ links: null, linksError: "无法读取关联账户，请重试。" }); }
      })();
    }
    return () => { mounted = false; controller.abort(); };
  }, [key]);
  return stored?.generation === generation ? stored.value : empty();
}
