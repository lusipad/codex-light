import { accountRead } from "./config";
import { mutateRemotePlugin, readRemotePluginInventory, serviceErrorMessage, serviceIdentity, type RemotePluginOperation, type ServiceIdentity } from "./chatgptService";
import type { PluginInstalledResponse, PluginMarketplaceEntry, PluginSummary } from "./plugins";

export interface RemotePluginSnapshot {
  identity: ServiceIdentity | null;
  marketplace: PluginMarketplaceEntry | null;
  error: string | null;
  unsupported: boolean;
}
export interface RemotePluginResult {
  verification: "confirmed" | "pending" | "unknown" | "rejected";
  snapshot: RemotePluginSnapshot | null;
  error: string | null;
}
const market = "openai-curated-remote";
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const string = (v: unknown): string | null => typeof v === "string" ? v : null;
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const remoteId = (p: PluginSummary) => p.remotePluginId ?? string(record(p.shareContext)?.remotePluginId);

export function mapRemotePlugins(rows: unknown[]): PluginMarketplaceEntry {
  const seen = new Set<string>();
  const plugins = rows.map(value => {
    const raw = record(value);
    if (!raw || !string(raw.id)?.trim() || !string(raw.name)?.trim() || seen.has(raw.id as string) ||
      ("enabled" in raw && typeof raw.enabled !== "boolean")) throw Error("无法识别远程插件库存，请重新读取。");
    seen.add(raw.id as string);
    const release = record(raw.release), ui = record(release?.interface);
    const installPolicy = raw.installation_policy ?? "AVAILABLE", authPolicy = raw.authentication_policy ?? "ON_USE";
    const policyKnown = ["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"].includes(String(installPolicy)) && ["ON_INSTALL", "ON_USE"].includes(String(authPolicy));
    const installedAt = typeof raw.installed_at === "string" ? Date.parse(raw.installed_at) / 1000 : NaN;
    return {
      id: `${raw.name}@${market}`, name: raw.name as string, remotePluginId: raw.id as string,
      source: { type: "remote" }, installed: "enabled" in raw, enabled: raw.enabled === true,
      version: string(release?.version), localVersion: null, shareContext: null,
      installedAt: Number.isFinite(installedAt) ? installedAt : null,
      installPolicy: ["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"].includes(String(installPolicy)) ? installPolicy : "NOT_AVAILABLE",
      authPolicy: ["ON_INSTALL", "ON_USE"].includes(String(authPolicy)) ? authPolicy : "ON_USE",
      installPolicySource: string(raw.installation_policy_source),
      availability: raw.status === "DISABLED_BY_ADMIN" ? "DISABLED_BY_ADMIN" : "AVAILABLE",
      disabledReason: string(raw.disabled_reason) ?? (raw.status === "DISABLED_BY_ADMIN" ? "disabled_by_admin" : null),
      eligiblePlanTypes: raw.eligible_plan_types == null ? null : strings(raw.eligible_plan_types),
      mustShowInstallationInterstitial: raw.must_show_installation_interstitial === true,
      remoteServicePlugin: raw, remotePolicyKnown: policyKnown,
      keywords: strings(release?.keywords ?? ui?.capabilities),
      interface: {
        displayName: string(release?.display_name), shortDescription: string(ui?.short_description) ?? string(release?.description),
        longDescription: string(ui?.long_description), developerName: string(ui?.developer_name), category: string(ui?.category),
        capabilities: strings(ui?.capabilities), websiteUrl: string(ui?.website_url), privacyPolicyUrl: string(ui?.privacy_policy_url), termsOfServiceUrl: string(ui?.terms_of_service_url),
        defaultPrompt: ui?.default_prompts == null ? (string(ui?.default_prompt) === null ? [] : [ui!.default_prompt as string]) : strings(ui.default_prompts),
        logoUrl: string(ui?.logo_url), logoUrlDark: string(ui?.logo_url_dark), composerIconUrl: string(ui?.composer_icon_url),
        brandColor: string(ui?.brand_color), screenshotUrls: strings(ui?.screenshot_urls),
      },
    } as PluginSummary;
  });
  return { name: market, path: null, plugins };
}

export async function loadRemotePlugins(signal = new AbortController().signal, expectedIdentity?: ServiceIdentity): Promise<RemotePluginSnapshot> {
  try {
    const account = await accountRead();
    if (signal.aborted) throw Error("请求已取消");
    if (account.account?.type !== "chatgpt") return { identity: null, marketplace: null, error: null, unsupported: true };
    const identity = await serviceIdentity(signal);
    if ((expectedIdentity && !sameIdentity(identity, expectedIdentity)) ||
      (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId)) throw Error("读取期间账号发生变化，请重新刷新。");
    const marketplace = mapRemotePlugins(await readRemotePluginInventory(identity, signal));
    const after = await accountRead(), current = await serviceIdentity(signal);
    if (signal.aborted || JSON.stringify(account) !== JSON.stringify(after) || !sameIdentity(identity, current)) throw Error("读取期间账号发生变化，请重新刷新。");
    return { identity, marketplace, error: null, unsupported: false };
  } catch (error) {
    return { identity: null, marketplace: null, error: serviceErrorMessage(error), unsupported: false };
  }
}

function verified(snapshot: RemotePluginSnapshot, id: string, operation: RemotePluginOperation): boolean {
  if (!snapshot.identity || !snapshot.marketplace || snapshot.error || snapshot.unsupported) return false;
  const row = snapshot.marketplace.plugins.find(p => remoteId(p) === id);
  return operation === "uninstall" ? !row : !!row?.installed && row.enabled === (operation === "enable");
}

export async function verifyRemotePlugin(plugin: PluginSummary, operation: RemotePluginOperation, identity: ServiceIdentity, signal = new AbortController().signal): Promise<RemotePluginResult> {
  const id = remoteId(plugin);
  if (!id) return { verification: "rejected", snapshot: null, error: "缺少远程插件身份，请重新读取。" };
  const snapshot = await loadRemotePlugins(signal, identity);
  return { verification: verified(snapshot, id, operation) ? "confirmed" : "pending", snapshot,
    error: snapshot.error ?? (snapshot.unsupported ? "当前登录方式不支持远程插件服务。" : null) };
}

export async function manageRemotePlugin(plugin: PluginSummary, operation: RemotePluginOperation, identity: ServiceIdentity, signal = new AbortController().signal): Promise<RemotePluginResult> {
  const id = remoteId(plugin);
  if (!id || !plugin.installed || plugin.remotePolicyKnown !== true ||
    (operation !== "uninstall" && plugin.availability === "DISABLED_BY_ADMIN") ||
    (operation === "uninstall" && plugin.installPolicy === "INSTALLED_BY_DEFAULT")) {
    return { verification: "rejected", snapshot: null, error: "此插件当前不允许该操作，请刷新权限与库存。" };
  }
  try {
    const result = await mutateRemotePlugin(id, operation, identity, signal);
    const snapshot: RemotePluginSnapshot | null = result.plugins === null ? null : { identity, marketplace: mapRemotePlugins(result.plugins), error: null, unsupported: false };
    return { verification: snapshot && verified(snapshot, id, operation) ? "confirmed" : "pending", snapshot,
      error: result.warningCode ? serviceErrorMessage({ code: result.warningCode, message: "变更已提交或送达未知，请先只读核验。" }) : null };
  } catch (error) {
    const code = record(error)?.code;
    const rejected = ["forbidden", "unauthorized", "unsupported_auth", "not_logged_in", "plugin_busy", "invalid_request", "plugin_policy_restricted", "plugin_not_installed"].includes(String(code));
    return { verification: rejected ? "rejected" : "pending", snapshot: null, error: serviceErrorMessage(error) };
  }
}

export function mergePluginInventories(input: PluginInstalledResponse | null, remote: RemotePluginSnapshot | null): PluginInstalledResponse {
  const cli = input ?? { marketplaces: [] };
  if (!remote?.identity || !remote.marketplace || remote.error || remote.unsupported) return cli;
  const service = new Map(remote.marketplace.plugins.map(p => [remoteId(p)!, p])), seen = new Set<string>();
  const marketplaces = cli.marketplaces.map(m => ({ ...m, plugins: m.plugins.flatMap(p => {
    const id = remoteId(p), key = id ? `remote:${id}` : `plugin:${m.path ?? m.name}:${p.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const latest = id ? service.get(id) : null;
    if (id) service.delete(id);
    return [latest ? { ...p, ...latest, id: p.id, source: p.source } : p];
  }) }));
  if (service.size) marketplaces.push({ ...remote.marketplace, plugins: [...service.values()] });
  return { ...cli, marketplaces };
}
