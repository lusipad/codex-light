import { accountRead } from "./config";
import { readPluginAppLinkPermissions, serviceIdentity, writePluginAppLinkPermission, type ServiceIdentity } from "./chatgptService";
import { decodePluginAppDetails, pluginAppAccountIdentity, pluginAppAccountNickname, selectPluginAppLinks, type PluginAppDetails } from "./pluginAppDetails";
import { pluginPermissionOptions, type PluginPermission } from "./pluginPermissions";
import { canonicalMcpAppId } from "./pluginManagementMcp";

export interface PluginAppLinkPermissionsSnapshot {
  identity: ServiceIdentity;
  routeAppId: string | null;
  appId: string;
  details: PluginAppDetails;
  personal: boolean;
  access: "allowed" | "denied" | "unavailable";
  defaultValue: PluginPermission | null;
  defaultError: string | null;
}

export interface PluginAppPermissionAccount {
  linkId: string;
  permission: PluginPermission | null;
  identity: string;
  nickname: string | null;
  avatarUrl: string | null;
  editable: boolean;
}

export interface PluginAppLinkPermissionBatchResult {
  snapshot: PluginAppLinkPermissionsSnapshot | null;
  confirmedLinkIds: string[];
  failedLinkIds: string[];
  pendingLinkIds: string[];
  refreshError: string | null;
}

export const pluginAppLinkPermissionOptions = [...pluginPermissionOptions,
  { value: "full_access", label: "允许使用所有工具", description: "无需询问即可使用工具。这会带来更高风险" },
] as { value: PluginPermission; label: string; description: string }[];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const permission = (value: unknown): value is PluginPermission => typeof value === "string" && pluginAppLinkPermissionOptions.some(option => option.value === value);
const invalid = () => Error("关联账户权限响应格式无效。");

export function pluginAppPermissionAccounts(snapshot: PluginAppLinkPermissionsSnapshot): PluginAppPermissionAccount[] {
  if (snapshot.details.links === null) return [];
  const name = snapshot.details.connector.name;
  return selectPluginAppLinks(snapshot.details, null).accounts.map(link => ({
    linkId: link.id, permission: link.apps_privacy_control ?? null,
    identity: pluginAppAccountIdentity(link, name, name.trim() ? `${name.trim()} 账户` : "账户"),
    nickname: pluginAppAccountNickname(link, name) ?? null, avatarUrl: link.owner_profile?.picture ?? null,
    editable: snapshot.personal && link.auth_status !== "REAUTH_REQUIRED" && link.owners.some(owner => owner.type === "USER" && owner.id === snapshot.identity.userId),
  }));
}

export function decodePluginAppLinkPermissions(raw: unknown, identity: ServiceIdentity, pluginId: string, appId: string | null): PluginAppLinkPermissionsSnapshot {
  const body = object(raw);
  if (!body || typeof body.appId !== "string" || !body.appId.trim() || typeof body.personal !== "boolean" || typeof body.access !== "string" ||
    !["allowed", "denied", "unavailable"].includes(String(body.access)) ||
    appId !== null && canonicalMcpAppId(body.appId) !== canonicalMcpAppId(appId)) throw invalid();
  const details = decodePluginAppDetails(body.details, pluginId, body.appId);
  const error = body.defaultError == null ? null : object(body.defaultError);
  if (body.defaultError != null && (!error || typeof error.code !== "string" || typeof error.message !== "string") ||
    body.defaultValue !== null && !permission(body.defaultValue)) throw invalid();
  const snapshot: PluginAppLinkPermissionsSnapshot = { identity, routeAppId: appId, appId: body.appId, details, personal: body.personal,
    access: body.access as PluginAppLinkPermissionsSnapshot["access"], defaultValue: body.defaultValue as PluginPermission | null,
    defaultError: error ? "无法加载插件设置" : null };
  const allowed = details.links !== null && details.connector.labels?.apps_privacy_control_available !== "false" && pluginAppPermissionAccounts(snapshot).some(account => account.editable);
  if (snapshot.access === "unavailable" ? details.links !== null : details.links === null || (snapshot.access === "allowed") !== allowed) throw invalid();
  if (snapshot.access === "allowed" && snapshot.defaultValue === null && !snapshot.defaultError) throw invalid();
  return snapshot;
}

async function verifyIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  if (signal.aborted) throw Error("请求已取消");
  const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]);
  if (signal.aborted) throw Error("请求已取消");
  if (account.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
    account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
}

async function readSnapshot(pluginId: string, appId: string | null, identity: ServiceIdentity, signal: AbortSignal) {
  await verifyIdentity(identity, signal);
  let raw;
  try { raw = await readPluginAppLinkPermissions(pluginId, appId, identity, signal); }
  catch (error) {
    if ((error as { code?: string } | null)?.code === "app_not_in_plugin") await verifyIdentity(identity, signal);
    throw error;
  }
  const snapshot = decodePluginAppLinkPermissions(raw, identity, pluginId, appId);
  await verifyIdentity(identity, signal);
  return snapshot;
}

export async function loadPluginAppLinkPermissions(pluginId: string, appId: string | null, signal: AbortSignal): Promise<PluginAppLinkPermissionsSnapshot> {
  if (signal.aborted) throw Error("请求已取消");
  const account = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  if (account.account?.type !== "chatgpt") throw Error("请先登录 ChatGPT 账户。");
  const identity = await serviceIdentity(signal);
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  return readSnapshot(pluginId, appId, identity, signal);
}

export async function savePluginAppLinkPermissions(snapshot: PluginAppLinkPermissionsSnapshot, linkIds: string[], value: PluginPermission | null, signal: AbortSignal): Promise<PluginAppLinkPermissionBatchResult> {
  if (signal.aborted) throw Error("请求已取消");
  if (value !== null && !permission(value) || snapshot.access !== "allowed" || snapshot.defaultError || snapshot.defaultValue === null || snapshot.details.links === null) throw Error("当前无法修改账户权限，请重新读取。");
  const ids = [...new Set(linkIds)], accounts = pluginAppPermissionAccounts(snapshot);
  if (!ids.length || ids.some(id => accounts.filter(account => account.linkId === id && account.editable).length !== 1)) throw Error("请选择可更改权限的账户。");
  await verifyIdentity(snapshot.identity, signal);
  const results = await Promise.all(ids.map(async linkId => {
    if (accounts.find(account => account.linkId === linkId)!.permission === value) return { linkId, status: "accepted" as const };
    try {
      if (signal.aborted) throw Error("请求已取消");
      const result = await writePluginAppLinkPermission(snapshot.details.pluginId, snapshot.appId, linkId, value, snapshot.identity, signal);
      const delivery = object(result.body)?.delivery;
      if (!["accepted", "unknown", "not_sent"].includes(String(delivery))) throw invalid();
      return { linkId, status: delivery === "unknown" ? "pending" as const : "accepted" as const };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      return { linkId, status: ["forbidden", "invalid_request", "not_found", "ip_not_authorized"].includes(code ?? "") ? "failed" as const : "pending" as const };
    }
  }));
  await verifyIdentity(snapshot.identity, signal);
  let actual: PluginAppLinkPermissionsSnapshot | null = null, refreshError: string | null = null;
  try { actual = await readSnapshot(snapshot.details.pluginId, snapshot.routeAppId, snapshot.identity, signal); }
  catch (error) {
    if (signal.aborted || (error as { code?: string } | null)?.code === "app_not_in_plugin") throw error;
    await verifyIdentity(snapshot.identity, signal);
    refreshError = "无法加载插件设置";
  }
  if (actual !== null && actual.appId !== snapshot.appId) {
    return { snapshot: actual, confirmedLinkIds: [], failedLinkIds: [], pendingLinkIds: ids, refreshError: null };
  }
  const complete = actual !== null && actual.details.links !== null && actual.defaultValue !== null && !actual.defaultError;
  if (!complete) refreshError = "无法加载插件设置";
  const confirmedLinkIds: string[] = [], failedLinkIds: string[] = [], pendingLinkIds: string[] = [];
  for (const result of results) {
    if (result.status === "failed") { failedLinkIds.push(result.linkId); continue; }
    const links = actual?.details.links?.filter(link => link.id === result.linkId) ?? [];
    if (complete && links.length === 1 && (links[0].apps_privacy_control ?? null) === value) confirmedLinkIds.push(result.linkId);
    else pendingLinkIds.push(result.linkId);
  }
  return { snapshot: actual, confirmedLinkIds, failedLinkIds, pendingLinkIds, refreshError };
}
