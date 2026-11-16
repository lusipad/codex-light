import { accountRead } from "./config";
import { readRemotePluginDirectoryDetail, readRemotePluginCatalogInventory, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { mapRemotePlugins } from "./remotePlugins";
import { canonicalMcpAppId } from "./pluginManagementMcp";
import type { PluginDetail, SkillSummary } from "./plugins";

const invalid = () => Error("远程插件详情格式无效，请重新读取。");
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; };
const optionalText = (value: unknown): string | null | undefined => { if (value == null || typeof value === "string") return value; throw invalid(); };
const requiredText = (value: unknown): string => { if (typeof value !== "string") throw invalid(); return value; };
const array = (value: unknown): unknown[] => { if (value == null) return []; if (!Array.isArray(value)) throw invalid(); return value; };
const strings = (value: unknown): string[] => array(value).map(requiredText);
const uniqueApps = (values: string[]) => { const seen = new Set<string>(); return values.filter(value => { if (!value.trim()) throw invalid(); const key = canonicalMcpAppId(value); if (seen.has(key)) return false; seen.add(key); return true; }); };

function serviceRow(value: unknown) {
  const raw = record(value), release = record(raw.release), ui = record(release.interface);
  if (!requiredText(raw.id).trim() || !requiredText(raw.name).trim() || "enabled" in raw && typeof raw.enabled !== "boolean") throw invalid();
  for (const key of ["version", "display_name", "description"]) optionalText(release[key]);
  for (const key of ["short_description", "long_description", "developer_name", "category", "website_url", "privacy_policy_url", "terms_of_service_url", "default_prompt", "logo_url", "logo_url_dark", "composer_icon_url", "brand_color"]) optionalText(ui[key]);
  for (const key of ["capabilities", "default_prompts", "screenshot_urls"]) strings(ui[key]);
  strings(release.keywords);
  for (const key of ["installation_policy", "authentication_policy", "installation_policy_source", "status", "disabled_reason", "installed_at"]) optionalText(raw[key]);
  strings(raw.eligible_plan_types);
  if (raw.must_show_installation_interstitial != null && typeof raw.must_show_installation_interstitial !== "boolean") throw invalid();
  if ("disabled_skill_names" in raw && !Array.isArray(raw.disabled_skill_names)) throw invalid();
  strings(raw.disabled_skill_names);
  return { raw, release, ui };
}

export function decodeDurablePluginDetail(rawValue: unknown, rows: unknown[], rawId: string): { detail: PluginDetail; setupEligibleAppTemplateIds: string[] } {
  if (!Array.isArray(rows)) throw invalid();
  const source = serviceRow(rawValue);
  if (source.raw.id !== rawId) throw invalid();
  const inventory = rows.map(serviceRow), installedMarket = mapRemotePlugins(inventory.map(row => row.raw));
  const match = inventory.find(row => row.raw.id === rawId), selected = match ?? source;
  const summary = match ? installedMarket.plugins.find(plugin => plugin.remotePluginId === rawId)! : mapRemotePlugins([source.raw]).plugins[0];
  const { raw, release } = source, { ui } = selected;
  summary.interface = { ...summary.interface, shortDescription: optionalText(ui.short_description),
    defaultPrompt: ui.default_prompts == null ? ui.default_prompt == null ? null : [requiredText(ui.default_prompt)] : strings(ui.default_prompts),
    composerIcon: null, logo: null, logoDark: null, screenshots: [] };
  summary.mustShowInstallationInterstitial = selected.raw.must_show_installation_interstitial as boolean | null | undefined ?? null;
  if (!("enabled" in selected.raw)) summary.installedAt = null;
  const disabled = match ? strings(match.raw.disabled_skill_names) : [];
  const skills: SkillSummary[] = array(release.skills).map(value => {
    const skill = record(value), info = skill.interface == null ? null : record(skill.interface);
    const name = requiredText(skill.name), description = requiredText(skill.description);
    if (!name.trim()) throw invalid();
    if (info) for (const key of ["display_name", "short_description", "brand_color", "default_prompt", "icon_large_url", "icon_small_url"]) optionalText(info[key]);
    return { name, description, path: null, enabled: !disabled.includes(name), shortDescription: optionalText(info?.short_description) ?? null,
      interface: info ? { displayName: optionalText(info.display_name) ?? undefined, shortDescription: optionalText(info.short_description) ?? undefined,
        brandColor: optionalText(info.brand_color) ?? undefined, defaultPrompt: optionalText(info.default_prompt) ?? undefined,
        iconLargeUrl: optionalText(info.icon_large_url), iconSmallUrl: optionalText(info.icon_small_url) } : null };
  });
  const templates = array(release.app_templates).map(value => {
    const template = record(value), name = requiredText(template.name), templateId = requiredText(template.template_id);
    if (!templateId.trim() || template.can_setup != null && typeof template.can_setup !== "boolean") throw invalid();
    const canonicalConnectorId = optionalText(template.canonical_connector_id) ?? null;
    const instances = array(template.instances).map(value => { const instance = record(value), id = requiredText(instance.id); if (!id.trim()) throw invalid(); return { id, scope: requiredText(instance.scope), name: optionalText(instance.name) }; });
    const materialized = strings(template.materialized_app_ids), users = instances.filter(instance => instance.scope === "USER");
    return { name, templateId, category: null, canonicalConnectorId, description: optionalText(template.description) ?? null,
      logoUrl: optionalText(template.logo_url) ?? null, logoUrlDark: optionalText(template.logo_url_dark) ?? null, reason: optionalText(template.reason) ?? null,
      materializedAppIds: uniqueApps([...materialized, ...users.map(instance => instance.id)]), instances, users, canSetup: template.can_setup === true };
  });
  const users = templates.flatMap(template => template.users);
  const apps = uniqueApps([...strings(release.app_ids), ...users.map(instance => instance.id)]).map(id => {
    const key = canonicalMcpAppId(id), same = (candidate: string) => canonicalMcpAppId(candidate) === key;
    const template = templates.find(template => template.canonicalConnectorId != null && same(template.canonicalConnectorId) || template.materializedAppIds.some(same) || template.instances.some(instance => same(instance.id)));
    return { id, name: users.find(instance => same(instance.id))?.name ?? template?.name ?? id, description: template?.description ?? null, category: null, installUrl: null };
  });
  const onboardingName = optionalText(release.onboarding_skill_name);
  const detail: PluginDetail = { summary, marketplaceName: installedMarket.name, marketplacePath: null,
    description: optionalText(source.ui.long_description) ?? optionalText(release.description), shareUrl: optionalText(raw.share_url) ?? null,
    skills, onboardingSkill: summary.enabled ? skills.find(skill => skill.enabled && skill.name === onboardingName) ?? null : null,
    apps, appTemplates: templates.map(({ instances: _instances, users: _users, canSetup: _canSetup, ...template }) => template),
    hooks: [], mcpServers: array(release.mcp_servers).map(value => requiredText(record(value).key)), scheduledTasks: null };
  return { detail, setupEligibleAppTemplateIds: templates.filter(template => template.canSetup).map(template => template.templateId) };
}

export async function loadDurablePluginDetail(rawId: string, signal: AbortSignal): Promise<{ detail: PluginDetail; setupEligibleAppTemplateIds: string[]; identity: ServiceIdentity }> {
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  current(); const account = await accountRead(); current();
  if (account.account?.type !== "chatgpt") throw Error("请先登录 ChatGPT 账号。");
  const identity = await serviceIdentity(signal); current();
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  const verify = async () => {
    current(); const [after, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
    if (after.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
      after.workspaceRouting?.chatgptAccountId && after.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  };
  let raw: unknown, rows: unknown[];
  try { [raw, rows] = await Promise.all([readRemotePluginDirectoryDetail(rawId, identity, signal), readRemotePluginCatalogInventory(identity, signal)]); }
  catch (error) { await verify(); throw error; }
  await verify(); return { ...decodeDurablePluginDetail(raw, rows, rawId), identity };
}
