import { accountRead } from "./config";
import { readPluginCanonicalRoot, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { decodeDurablePluginDetail } from "./durablePluginDetail";
import { canonicalMcpAppId } from "./pluginManagementMcp";
import type { PluginDetail } from "./plugins";

export interface PluginGenericUsageTemplate {
  templateId: string; name: string; description: string | null; logoUrl: string | null; logoUrlDark: string | null;
  reason: string | null; canSetup: boolean; instances: { id: string; scope: string; name: string | null }[] | null;
}
export interface PluginGenericUsageEntry { id: string | null; template: PluginGenericUsageTemplate | null }

export interface PluginCanonicalRoot {
  kind: "generic" | "canonical";
  pluginId: string;
  appId: string | null;
  pluginHeader: { id: string; name: string; version: string | null; shortDescription: string | null; logoUrl: string | null; logoUrlDark: string | null };
  hostedApp: { name: string; description: string | null; logoUrl: string | null; logoUrlDark: string | null } | null;
  hostedError: { code: string; message: string } | null;
  nativeEligibility: "unverified";
  genericSource: { plugin: Record<string, unknown>; installedPlugin: Record<string, unknown> | null } | null;
  genericDetail: PluginDetail | null;
  genericUsage: PluginGenericUsageEntry[];
  setupEligibleAppTemplateIds: string[];
}
export type PluginCanonicalRootSnapshot = PluginCanonicalRoot & { identity: ServiceIdentity };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const invalid = () => Error("插件根详情响应格式无效。");

function pick(value: unknown, keys: string[]): Record<string, unknown> {
  const source = object(value); if (!source) throw invalid();
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
}
function publicGenericPlugin(value: unknown): Record<string, unknown> {
  const source = object(value); if (!source) throw invalid();
  const plugin = pick(source, ["id", "name", "enabled", "status", "installation_policy", "authentication_policy", "installation_policy_source", "disabled_reason", "eligible_plan_types", "must_show_installation_interstitial", "installed_at", "disabled_skill_names", "share_url"]);
  const rawRelease = object(source.release); if (!rawRelease) throw invalid();
  const release = pick(rawRelease, ["display_name", "version", "description", "keywords", "onboarding_skill_name", "app_ids"]);
  release.interface = pick(rawRelease.interface, ["short_description", "long_description", "developer_name", "category", "website_url", "privacy_policy_url", "terms_of_service_url", "logo_url", "logo_url_dark", "composer_icon_url", "screenshot_urls", "default_prompts", "default_prompt", "brand_color", "capabilities"]);
  for (const key of ["skills", "app_templates", "mcp_servers"]) {
    if (!Object.hasOwn(rawRelease, key)) continue;
    if (rawRelease[key] === null) { release[key] = null; continue; }
    if (!Array.isArray(rawRelease[key])) throw invalid();
    release[key] = rawRelease[key].map(value => {
      if (key === "mcp_servers") return pick(value, ["key"]);
      if (key === "skills") {
        const skill = pick(value, ["name", "description"]), row = object(value)!;
        if (Object.hasOwn(row, "interface")) skill.interface = row.interface === null ? null : pick(row.interface, ["display_name", "short_description", "brand_color", "default_prompt", "icon_large_url", "icon_small_url"]);
        return skill;
      }
      const template = pick(value, ["template_id", "name", "description", "canonical_connector_id", "materialized_app_ids", "logo_url", "logo_url_dark", "reason", "can_setup"]), row = object(value)!;
      if (Object.hasOwn(row, "instances")) {
        if (row.instances !== null && !Array.isArray(row.instances)) throw invalid();
        template.instances = row.instances === null ? null : (row.instances as unknown[]).map(instance => pick(instance, ["id", "scope", "name"]));
      }
      return template;
    });
  }
  plugin.release = release; return plugin;
}

/** CV1W.pS uses materialized ids, unlike W.apps which merges USER instances. */
function genericUsage(plugin: Record<string, unknown>): PluginGenericUsageEntry[] {
  const release = object(plugin.release)!, rawTemplates = (release.app_templates ?? []) as Record<string, unknown>[];
  const templates = rawTemplates.map(template => ({
    templateId: template.template_id as string, name: template.name as string, description: template.description as string | null | undefined ?? null,
    logoUrl: template.logo_url as string | null | undefined ?? null, logoUrlDark: template.logo_url_dark as string | null | undefined ?? null,
    reason: template.reason as string | null | undefined ?? null, canSetup: template.can_setup === true,
    instances: template.instances == null ? null : (template.instances as Record<string, unknown>[]).map(instance => ({ id: instance.id as string, scope: instance.scope as string, name: instance.name as string | null | undefined ?? null })),
  }));
  const materialized = rawTemplates.map(template => (template.materialized_app_ids ?? []) as string[]), seen = new Set<string>();
  const ids = [...(release.app_ids ?? []) as string[], ...materialized.flat()].filter(id => { const key = canonicalMcpAppId(id); if (seen.has(key)) return false; seen.add(key); return true; });
  return [...ids.map(id => ({ id, template: templates[materialized.findIndex(values => values.some(value => canonicalMcpAppId(value) === canonicalMcpAppId(id)))] ?? null })),
    ...templates.flatMap((template, index) => materialized[index].length ? [] : [{ id: null, template }])];
}

export function decodePluginCanonicalRoot(raw: unknown, pluginId: string): PluginCanonicalRoot {
  const body = object(raw), header = object(body?.pluginHeader), hosted = body?.hostedApp === null ? null : object(body?.hostedApp), error = body?.hostedError === null ? null : object(body?.hostedError);
  if (!body || !header || body.pluginId !== pluginId || header.id !== pluginId || body.kind !== "generic" && body.kind !== "canonical" || body.nativeEligibility !== "unverified" ||
    typeof header.name !== "string" || ![header.version, header.shortDescription, header.logoUrl, header.logoUrlDark].every(nullableString) ||
    body.hostedApp !== null && (!hosted || typeof hosted.name !== "string" || ![hosted.description, hosted.logoUrl, hosted.logoUrlDark].every(nullableString)) ||
    body.hostedError !== null && (!error || typeof error.code !== "string" || !error.code.trim() || typeof error.message !== "string")) throw invalid();
  if (body.kind === "generic" ? body.appId !== null || hosted !== null || error !== null
    : typeof body.appId !== "string" || !body.appId.trim() || (hosted === null) === (error === null)) throw invalid();
  let genericSource: PluginCanonicalRoot["genericSource"] = null, genericDetail: PluginDetail | null = null, usage: PluginGenericUsageEntry[] = [], setupEligibleAppTemplateIds: string[] = [];
  if (body.kind === "generic") {
    const source = object(body.genericSource); if (!source || !Object.hasOwn(source, "installedPlugin")) throw invalid();
    const plugin = publicGenericPlugin(source.plugin), installedPlugin = source.installedPlugin === null ? null : publicGenericPlugin(source.installedPlugin);
    if (plugin.id !== pluginId || installedPlugin && installedPlugin.id !== pluginId) throw invalid();
    const mapped = decodeDurablePluginDetail(plugin, installedPlugin ? [installedPlugin] : [], pluginId);
    genericSource = { plugin, installedPlugin }; genericDetail = mapped.detail; usage = genericUsage(plugin); setupEligibleAppTemplateIds = mapped.setupEligibleAppTemplateIds;
  } else if (body.genericSource !== null) throw invalid();
  return {
    kind: body.kind as PluginCanonicalRoot["kind"], pluginId, appId: body.appId as string | null,
    pluginHeader: { id: pluginId, name: header.name, version: header.version as string | null, shortDescription: header.shortDescription as string | null,
      logoUrl: header.logoUrl as string | null, logoUrlDark: header.logoUrlDark as string | null },
    hostedApp: hosted ? { name: hosted.name as string, description: hosted.description as string | null, logoUrl: hosted.logoUrl as string | null, logoUrlDark: hosted.logoUrlDark as string | null } : null,
    hostedError: error ? { code: error.code as string, message: error.message as string } : null,
    nativeEligibility: "unverified",
    genericSource, genericDetail, genericUsage: usage, setupEligibleAppTemplateIds,
  };
}

export async function loadPluginCanonicalRoot(pluginId: string, signal: AbortSignal): Promise<PluginCanonicalRootSnapshot> {
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  current();
  const account = await accountRead(); current();
  if (account.account?.type !== "chatgpt") throw Error("请先登录 ChatGPT 账号。");
  const identity = await serviceIdentity(signal); current();
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  const verifyIdentity = async () => {
    current(); const [after, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
    if (after.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
      after.workspaceRouting?.chatgptAccountId && after.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  };
  let raw: unknown;
  try { raw = await readPluginCanonicalRoot(pluginId, identity, signal); }
  catch (error) { await verifyIdentity(); throw error; }
  await verifyIdentity();
  return { identity, ...decodePluginCanonicalRoot(raw, pluginId) };
}
