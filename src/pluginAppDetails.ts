import { accountRead } from "./config";
import { readPluginAppDetails, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { canonicalMcpAppId } from "./pluginManagementMcp";
import type { PluginPermission } from "./pluginPermissions";

export interface PluginAppLink {
  id: string;
  connector_id: string;
  owners: { type: string; id: string }[];
  name?: string | null;
  connector_name?: string | null;
  auth_status?: string | null;
  auth_type?: string | null;
  visibility?: string | null;
  apps_privacy_control?: PluginPermission | null;
  owner_profile?: { name?: string | null; nickname?: string | null; email?: string | null; picture?: string | null } | null;
}
export interface PluginAppDetails {
  pluginId: string;
  pluginName: string;
  appId: string;
  connector: { id: string; name: string; description?: string | null; status?: string | null; enable_multi_links?: boolean | null;
    labels?: { apps_privacy_control_available?: string | null } | null };
  links: PluginAppLink[] | null;
  linksError: { code: string; message: string } | null;
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sameApp = (a: string, b: string) => canonicalMcpAppId(a) === canonicalMcpAppId(b);
const invalid = () => Error("应用详情响应格式或归属无效，请重新读取。");
const requiredString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function decodePluginAppConnector(raw: unknown, appId: string): PluginAppDetails["connector"] {
  const connector = object(raw);
  if (!connector || !requiredString(connector.id) || !sameApp(connector.id, appId) || typeof connector.name !== "string") throw invalid();
  if (connector.description != null && typeof connector.description !== "string" || connector.status != null && typeof connector.status !== "string" ||
    connector.enable_multi_links != null && typeof connector.enable_multi_links !== "boolean") throw invalid();
  const labels = connector.labels == null ? connector.labels : object(connector.labels);
  if (connector.labels != null && labels === null || labels?.apps_privacy_control_available != null && typeof labels.apps_privacy_control_available !== "string") throw invalid();
  return { id: connector.id, name: connector.name,
    ...(connector.description !== undefined ? { description: connector.description as string | null } : {}),
    ...(connector.status !== undefined ? { status: connector.status as string | null } : {}),
    ...(connector.enable_multi_links !== undefined ? { enable_multi_links: connector.enable_multi_links as boolean | null } : {}),
    ...(connector.labels === null ? { labels: null } : labels ? { labels: labels.apps_privacy_control_available === undefined ? {} : { apps_privacy_control_available: labels.apps_privacy_control_available as string | null } } : {}),
  };
}

export function decodePluginAppDetails(raw: unknown, pluginId: string, appId: string): PluginAppDetails {
  const body = object(raw);
  if (body?.pluginId !== pluginId || typeof body.pluginName !== "string" || !requiredString(body.appId) || !sameApp(body.appId, appId)) throw invalid();
  const connector = decodePluginAppConnector(body.connector, appId);
  const error = body.linksError === null ? null : object(body.linksError);
  if (body.links === null ? !error || !requiredString(error.code) || !requiredString(error.message) : !Array.isArray(body.links) || body.linksError !== null) throw invalid();
  const links = body.links === null ? null : (body.links as unknown[]).map(value => {
    const link = object(value);
    if (!link || !requiredString(link.id) || !requiredString(link.connector_id) || !sameApp(link.connector_id, appId) || !Array.isArray(link.owners)) throw invalid();
    const owners = link.owners.map(value => {
      const owner = object(value);
      if (!owner || !requiredString(owner.type) || !requiredString(owner.id)) throw invalid();
      return { type: owner.type, id: owner.id };
    });
    const result: PluginAppLink = { id: link.id, connector_id: link.connector_id, owners };
    for (const key of ["name", "connector_name", "auth_status", "auth_type", "visibility"] as const) {
      if (link[key] != null && typeof link[key] !== "string") throw invalid();
      if (link[key] !== undefined) result[key] = link[key] as string | null;
    }
    if (link.apps_privacy_control !== undefined) {
      if (link.apps_privacy_control !== null && (typeof link.apps_privacy_control !== "string" || !["always_ask", "ask_before_writes", "review_important_actions", "full_access"].includes(link.apps_privacy_control))) throw invalid();
      result.apps_privacy_control = link.apps_privacy_control as PluginPermission | null;
    }
    if (link.owner_profile !== undefined) {
      const profile = link.owner_profile === null ? null : object(link.owner_profile);
      if (link.owner_profile !== null && !profile) throw invalid();
      result.owner_profile = profile === null ? null : {};
      for (const key of ["name", "nickname", "email", "picture"] as const) {
        if (profile?.[key] != null && typeof profile[key] !== "string") throw invalid();
        if (profile?.[key] !== undefined) result.owner_profile![key] = profile[key] as string | null;
      }
    }
    return result;
  });
  return { pluginId, pluginName: body.pluginName, appId: body.appId, connector, links, linksError: error ? { code: error.code as string, message: error.message as string } : null };
}

// Zpwo.nA/Dr/wB; a link's name is its alias, not owner_profile.nickname.
export function pluginAppProfileIdentity(link: PluginAppLink): string | undefined {
  return link.owner_profile?.email?.trim() || link.owner_profile?.name?.trim() || link.owner_profile?.nickname?.trim() || undefined;
}
export function pluginAppAccountNickname(link: PluginAppLink, connectorName: string, appName?: string | null): string | undefined {
  const name = link.name?.trim();
  if (!name || name.toLocaleLowerCase() === "connected") return undefined;
  const connector = appName ?? link.connector_name ?? connectorName;
  return name.toLocaleLowerCase() === connector.trim().toLocaleLowerCase() || name.toLocaleLowerCase() === pluginAppProfileIdentity(link)?.toLocaleLowerCase() ? undefined : name;
}
export function pluginAppAccountIdentity(link: PluginAppLink, connectorName: string, fallback: string, appName?: string | null): string {
  return pluginAppProfileIdentity(link) || (link.auth_type === "NONE" && connectorName.trim() ? connectorName.trim() : pluginAppAccountNickname(link, connectorName, appName) ?? fallback);
}

/** CV1W.fD; single-account connectors ignore the query's linkId. */
export function selectPluginAppLinks(details: PluginAppDetails, selectedLinkId: string | null) {
  if (details.links === null) throw Error("无法读取关联账户，请重试。");
  const matching = details.links.filter(link => sameApp(link.connector_id, details.appId));
  const accounts = matching.filter(link => link.visibility !== "HIDDEN" && !link.id.startsWith("implicit_link::"));
  const selected = details.connector.enable_multi_links === true ? selectedLinkId : null;
  return { accounts, hasSystemLinks: matching.length !== accounts.length,
    selectedLink: accounts.find(link => link.id === selected) ?? accounts.find(link => link.auth_status !== "REAUTH_REQUIRED") ?? accounts[0] };
}

export async function loadPluginAppDetails(pluginId: string, appId: string, signal: AbortSignal): Promise<{ identity: ServiceIdentity; details: PluginAppDetails }> {
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  current();
  const account = await accountRead(); current();
  if (account.account?.type !== "chatgpt") throw Error("请先登录 ChatGPT 账号。");
  const identity = await serviceIdentity(signal); current();
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  const verifyIdentity = async () => {
    current();
    const [after, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
    if (after.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
      after.workspaceRouting?.chatgptAccountId && after.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  };
  let raw: unknown;
  try { raw = await readPluginAppDetails(pluginId, appId, identity, signal); }
  catch (error) {
    if ((error as { code?: string } | null)?.code === "app_not_in_plugin") await verifyIdentity();
    throw error;
  }
  const details = decodePluginAppDetails(raw, pluginId, appId); current();
  await verifyIdentity();
  return { identity, details };
}
