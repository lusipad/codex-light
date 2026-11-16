import { accountRead } from "./config";
import { readLocalPluginTemplateSetup, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { decodeAppTemplates, listAllApps, readConnectorMetadata, type AppInfo, type AppTemplateSummary,
  type ConnectorMetadata, type PluginDetail } from "./plugins";

export interface LocalPluginTemplateSnapshot {
  templates: AppTemplateSummary[];
  remotePluginId: string | null;
  eligibleTemplateIds: string[];
  identity: ServiceIdentity | null;
  warnings: string[];
  hideImplicitApp: boolean;
}

// Fixed reference build's tQpF.Bk legacy aliases. Web management keeps the raw ID.
const legacyServiceIds: Record<string, string> = {
  box: "plugin_asdk_app_695bfc98071c8191bac7bc479aa27de7",
  gmail: "plugin_connector_1p_95d39881713c8191931482a62d6edff9",
  "google-calendar": "plugin_connector_1p_f8509de903288191b14a160c6c5d20b0",
  "google-drive": "plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7",
  notion: "plugin_asdk_app_69c18c28f1188191bf5b8445c4ab0a2e",
  "outlook-calendar": "plugin_connector_1p_fd0f4f41caa88191a9456514bbffa06d",
  "outlook-email": "plugin_connector_1p_6bcb5879c73c819196abc70016166099",
  salesforce: "plugin_asdk_app_697d413990c88191a2bf4799604f8f6c",
  sharepoint: "plugin_connector_1p_dca009ae2c848191ae14df3a47c5e7fd",
  slack: "plugin_asdk_app_69a1d78e929881919bba0dbda1f6436d",
  teams: "plugin_connector_1p_eba8b52fe53881918408d4b46b957644",
};

export function resolveLocalPluginServiceId(id: string | null | undefined): string | undefined {
  const index = id?.lastIndexOf("@") ?? -1;
  const suffix = id != null && index > 0 && index < id.length - 1 ? id.slice(index + 1) : null;
  if (id != null && (suffix === "openai-curated-remote" || !id.includes("@"))) return id;
  if (suffix !== null && suffix !== "openai-curated") return undefined;
  const key = id == null ? "" : id.slice(0, -(suffix?.length ?? 0) - 1);
  return Object.hasOwn(legacyServiceIds, key) ? legacyServiceIds[key] : undefined;
}

export function enrichLocalPluginTemplates(templates: AppTemplateSummary[], metadata: ConnectorMetadata[], directory: AppInfo[]): AppTemplateSummary[] {
  const byMetadataId = new Map(metadata.map(app => [app.id, app]));
  const byDirectoryId = new Map(directory.map(app => [app.id, app]));
  return templates.map(template => {
    const app = (template.canonicalConnectorId != null ? byMetadataId.get(template.canonicalConnectorId) : undefined) ?? byMetadataId.get(template.templateId);
    const entry = (template.canonicalConnectorId != null ? byDirectoryId.get(template.canonicalConnectorId) : undefined) ?? byDirectoryId.get(template.templateId);
    const category = entry?.branding?.category?.trim() || entry?.appMetadata?.categories?.find(value => value.trim())?.trim() || null;
    return { ...template, materializedAppIds: [...template.materializedAppIds],
      category: template.category?.trim() || category,
      description: template.description || app?.description || null,
      logoUrl: template.logoUrl || app?.iconUrl || app?.iconUrlDark || null,
      logoUrlDark: template.logoUrlDark || app?.iconUrlDark || app?.iconUrl || null,
    };
  });
}

export function localPluginTemplateManagementUrl(rawRemoteId: string, allTemplatesCount: number): string {
  const url = new URL(`/plugins/${encodeURIComponent(rawRemoteId)}`, "https://chatgpt.com");
  url.searchParams.set("no_universal_links", "1");
  if (allTemplatesCount === 1) url.hash = `settings/Plugins/${encodeURIComponent(rawRemoteId)}?product-sku=CODEX`;
  return url.href;
}

function originalRemoteId(detail: PluginDetail): string | null {
  const shared = detail.summary.shareContext;
  const fallback = shared && typeof shared === "object" && "remotePluginId" in shared ? shared.remotePluginId : null;
  const raw = detail.summary.remotePluginId ?? fallback;
  if (raw == null) return null;
  if (typeof raw !== "string") throw Error("模板所属插件 ID 格式无效。");
  return raw;
}

const sameIdentity = (left: ServiceIdentity, right: ServiceIdentity) => left.accountId === right.accountId && left.userId === right.userId && left.generation === right.generation;
const accountChanged = () => Object.assign(Error("读取期间账号或服务路由发生变化，请重新读取。"), { code: "account_changed" });

export async function loadLocalPluginTemplates(detail: PluginDetail, signal: AbortSignal, expectedIdentity?: ServiceIdentity): Promise<LocalPluginTemplateSnapshot> {
  const current = () => { if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" }); };
  current();
  const templates = decodeAppTemplates(detail.appTemplates);
  const apps = detail.apps.map(app => ({ ...app }));
  const implicit = detail.summary.installPolicySource === "IMPLICIT_CANONICAL_APP" && apps.length === 1;
  const remotePluginId = originalRemoteId(detail);
  const snapshot: LocalPluginTemplateSnapshot = { templates, remotePluginId, eligibleTemplateIds: [], identity: null, warnings: [], hideImplicitApp: false };
  const account = await accountRead(); current();
  const accountKey = JSON.stringify([account.account, account.workspaceRouting ?? null]);
  let identity: ServiceIdentity | null = null;
  if (account.account?.type === "chatgpt") {
    const actual = await serviceIdentity(signal); current();
    if (actual.accountId && actual.userId) {
      if (!Number.isFinite(actual.generation) || account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== actual.accountId) throw accountChanged();
      identity = { ...actual };
    }
  }
  if (expectedIdentity && (!identity || !sameIdentity(expectedIdentity, identity))) throw accountChanged();
  const verify = async () => {
    current();
    const actualAccount = await accountRead(); current();
    if (JSON.stringify([actualAccount.account, actualAccount.workspaceRouting ?? null]) !== accountKey) throw accountChanged();
    if (identity) {
      const actual = await serviceIdentity(signal); current();
      if (!sameIdentity(actual, identity)) throw accountChanged();
    }
  };
  if (!identity) { await verify(); return snapshot; }
  snapshot.identity = identity;
  const serviceId = resolveLocalPluginServiceId(remotePluginId);
  if (templates.length > 0 && remotePluginId !== null && serviceId === undefined) throw Error("无法解析模板所属服务插件 ID，请重新读取。");
  if (templates.length > 0 && serviceId !== undefined) {
    let raw: unknown;
    try { raw = await readLocalPluginTemplateSetup(serviceId, identity, signal); }
    catch (error) { await verify(); throw error; }
    await verify();
    const result = raw as { pluginId?: unknown; setupEligibleAppTemplateIds?: unknown } | null;
    if (!result || result.pluginId !== serviceId || !Array.isArray(result.setupEligibleAppTemplateIds) ||
        result.setupEligibleAppTemplateIds.some(id => typeof id !== "string")) throw Error("模板设置资格响应格式或所属插件无效。");
    snapshot.eligibleTemplateIds = [...new Set(result.setupEligibleAppTemplateIds)];
  }
  const targetIds = [...new Set([...apps.map(app => app.id), ...templates.map(template => template.canonicalConnectorId ?? template.templateId)])];
  const requests = [
    targetIds.length ? readConnectorMetadata(targetIds, { signal }) : Promise.resolve(null),
    templates.length ? listAllApps({ forceRefetch: true, signal }) : Promise.resolve(null),
    implicit ? readConnectorMetadata([apps[0].id], { includeTools: true, signal }) : Promise.resolve(null),
  ] as const;
  const [metadata, directory, tools] = await Promise.allSettled(requests);
  await verify();
  for (const [name, result] of [["应用元数据", metadata], ["应用目录", directory], ["应用工具摘要", tools]] as const) {
    if (result.status !== "rejected") continue;
    const error = result.reason as { name?: string; code?: string } | null;
    if (error?.name === "AbortError" || ["cancelled", "account_changed", "routing_unavailable", "not_logged_in", "invalid_auth", "auth_expired", "auth_unavailable", "login_required", "unsupported_auth", "unauthorized"].includes(error?.code ?? "")) throw result.reason;
    snapshot.warnings.push(`${name}读取失败：${String(result.reason)}`);
  }
  snapshot.templates = enrichLocalPluginTemplates(templates, metadata.status === "fulfilled" ? metadata.value ?? [] : [], directory.status === "fulfilled" ? directory.value ?? [] : []);
  if (implicit && tools.status === "fulfilled") {
    const toolSummaries = tools.value?.find(app => app.id === apps[0].id)?.toolSummaries;
    snapshot.hideImplicitApp = Array.isArray(toolSummaries) && toolSummaries.length === 0;
  }
  current();
  return snapshot;
}
