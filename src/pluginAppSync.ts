import { accountRead } from "./config";
import { readPluginAppSync, disableServicePluginAppSync, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { decodePluginAppDetails, selectPluginAppLinks, type PluginAppDetails, type PluginAppLink } from "./pluginAppDetails";
import { canonicalMcpAppId } from "./pluginManagementMcp";

// Consumed fields from Fd8Z/tL; this is not a complete service wire decoder.
export interface PluginAppSyncStatus {
  user_connection_details: {
    auth_status: string;
    connector_id?: string | null;
    backing_link_id?: string | null;
    connection_instance_id: string;
    connection_type?: string | null;
    knowledge_connector_type?: string | null;
    activation_status?: string | null;
    last_full_sync_completed_at?: string | number | null;
    last_delta_sync_completed_at?: string | number | null;
  };
}

const adminApps = new Map([
  ["connector_1ee51bd730c272434e1b17c46f8a2397", "connector_69c18c28f1188191bf5b8445c4ab0a2e"],
  ["connector_bef400199679ee9f67f080058d5c9e89", "connector_4aaab2856305417b993eca9a216aaf6e"],
  ["connector_5ae2fd76f08447718080f11bc2faac6c", "connector_1e4f6a44acf14e3ca1d96672f8c945bc"],
  ["connector_601cc22bb3b740599c7274cf7e8084e8", "connector_246af0940da3457da0e751171dc1ce60"],
]);

export function matchPluginAppSyncStatuses(appId: string, links: PluginAppLink[], statuses: PluginAppSyncStatus[], allowLegacyAccountFallback: boolean) {
  const app = canonicalMcpAppId(appId);
  return statuses.filter(({ user_connection_details: details }) => {
    if (details.auth_status === "user_connected") {
      return details.backing_link_id != null
        ? links.some(link => link.id === details.backing_link_id && canonicalMcpAppId(link.connector_id) === app)
        : allowLegacyAccountFallback && app === "connector_2128aebfecb84f64a069897515042a44" && details.connection_type === "gmail_sync_connector";
    }
    const admin = details.auth_status === "admin_connected" || details.knowledge_connector_type === "google_drive_dwd" &&
      details.auth_status !== "admin_managed_disconnected" && (details.activation_status === "activated" || details.activation_status === "partially_activated");
    const connector = admin && details.connector_id != null ? canonicalMcpAppId(details.connector_id) : null;
    if (connector !== null) return (adminApps.get(connector) ?? connector) === app;
    return details.auth_status === "admin_connected" && allowLegacyAccountFallback && app === "connector_4aaab2856305417b993eca9a216aaf6e" &&
      details.connection_type === "outlook_admin_sync_connector" && details.backing_link_id == null;
  });
}

export function selectPluginAppSync(details: PluginAppDetails, selectedLinkId: string | null, statuses: PluginAppSyncStatus[]) {
  const { accounts, selectedLink } = selectPluginAppLinks(details, selectedLinkId);
  const allowLegacyAccountFallback = details.connector.enable_multi_links !== true || accounts.length <= 1;
  return { selectedLink, statuses: matchPluginAppSyncStatuses(details.appId, selectedLink ? [selectedLink] : [], statuses, allowLegacyAccountFallback) };
}

export function pluginAppSyncSummary(statuses: PluginAppSyncStatus[]): PluginAppSyncStatus | null {
  return statuses.find(({ user_connection_details: details }) => details.activation_status === "activating" || details.activation_status === "partially_activated") ??
    statuses.find(({ user_connection_details: details }) => details.activation_status === "activated") ?? statuses[0] ?? null;
}

export function pluginAppSyncBadge(activation: string | null | undefined): { label: string; variant: "outline" | "success" } {
  if (activation === "activating" || activation === "partially_activated") return { label: "正在同步", variant: "outline" };
  return activation === "activated" ? { label: "已同步", variant: "success" } : { label: "未同步", variant: "outline" };
}

export function pluginAppSyncUpdatedAt(status: PluginAppSyncStatus) {
  return status.user_connection_details.last_full_sync_completed_at ?? status.user_connection_details.last_delta_sync_completed_at ?? null;
}

// Presentation eligibility only. The backend must reread membership and status before a write.
export function pluginAppSyncCanDisable(status: PluginAppSyncStatus, account: { id: string; structure: string } | null, currentAccountId: string): boolean {
  const details = status.user_connection_details;
  return details.auth_status === "user_connected" && account !== null && account.id === currentAccountId &&
    (details.connection_instance_id.length !== 0 || account.structure === "personal" && details.backing_link_id != null);
}

export interface PluginAppSyncSnapshot {
  identity: ServiceIdentity;
  routeAppId: string | null;
  appId: string;
  details: PluginAppDetails;
  account: { id: string; structure: string } | null;
  statuses: PluginAppSyncStatus[];
}
const object = (raw: unknown): Record<string, unknown> | null => raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
const invalidSync = () => Error("同步状态响应格式无效，请重新读取。");
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const pair = (status: PluginAppSyncStatus) => JSON.stringify([status.user_connection_details.connection_instance_id, status.user_connection_details.backing_link_id ?? null]);

export function decodePluginAppSync(raw: unknown, pluginId: string, routeAppId: string | null, selectedLinkId: string | null, identity: ServiceIdentity): PluginAppSyncSnapshot {
  const body = object(raw);
  if (!body || typeof body.appId !== "string" || !body.appId || routeAppId !== null && canonicalMcpAppId(routeAppId) !== canonicalMcpAppId(body.appId) || !Array.isArray(body.statuses)) throw invalidSync();
  const details = decodePluginAppDetails(body.details, pluginId, body.appId);
  if (details.links === null) throw invalidSync();
  const account = body.account === null ? null : object(body.account);
  if (body.account !== null && (!account || typeof account.id !== "string" || !account.id || typeof account.structure !== "string")) throw invalidSync();
  const statuses = body.statuses.map(rawStatus => {
    const source = object(object(rawStatus)?.user_connection_details);
    if (!source || typeof source.auth_status !== "string" || typeof source.connection_instance_id !== "string") throw invalidSync();
    const result: PluginAppSyncStatus["user_connection_details"] = { auth_status: source.auth_status, connection_instance_id: source.connection_instance_id };
    for (const key of ["connector_id", "backing_link_id", "connection_type", "knowledge_connector_type", "activation_status"] as const) {
      if ((key === "connector_id" || key === "backing_link_id") && source[key] === undefined || source[key] != null && typeof source[key] !== "string") throw invalidSync();
      if (source[key] !== undefined) result[key] = source[key] as string | null;
    }
    for (const key of ["last_full_sync_completed_at", "last_delta_sync_completed_at"] as const) {
      const value = source[key];
      if (value != null && (typeof value !== "string" && typeof value !== "number" || !Number.isFinite(new Date(value as string | number).getTime()))) throw invalidSync();
      if (value !== undefined) result[key] = value as string | number | null;
    }
    return { user_connection_details: result };
  });
  if (selectPluginAppSync(details, selectedLinkId, statuses).statuses.length !== statuses.length) throw invalidSync();
  return { identity, routeAppId, appId: body.appId, details, account: account ? { id: account.id as string, structure: account.structure as string } : null, statuses };
}

async function verifySyncIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]);
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  if (account.account?.type !== "chatgpt" || !sameIdentity(identity, actual) || account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) {
    throw Object.assign(Error("读取期间账号发生变化，请重新刷新。"), { code: "account_changed" });
  }
}

async function readSyncSnapshot(pluginId: string, appId: string | null, selectedLinkId: string | null, identity: ServiceIdentity, signal: AbortSignal) {
  await verifySyncIdentity(identity, signal);
  let raw;
  try { raw = await readPluginAppSync(pluginId, appId, selectedLinkId, identity, signal); }
  catch (error) { await verifySyncIdentity(identity, signal); throw error; }
  const snapshot = decodePluginAppSync(raw, pluginId, appId, selectedLinkId, identity);
  await verifySyncIdentity(identity, signal);
  return snapshot;
}

export async function loadPluginAppSync(pluginId: string, appId: string | null, selectedLinkId: string | null, signal: AbortSignal): Promise<PluginAppSyncSnapshot> {
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  const identity = await serviceIdentity(signal);
  return readSyncSnapshot(pluginId, appId, selectedLinkId, identity, signal);
}

export async function disablePluginAppSync(snapshot: PluginAppSyncSnapshot, status: PluginAppSyncStatus, selectedLinkId: string | null, signal: AbortSignal): Promise<{
  snapshot: PluginAppSyncSnapshot | null; confirmed: boolean; refreshError: string | null;
}> {
  const matches = snapshot.statuses.filter(item => pair(item) === pair(status));
  if (matches.length !== 1 || !pluginAppSyncCanDisable(matches[0], snapshot.account, snapshot.identity.accountId)) throw Object.assign(Error("当前无法禁用同步，请重新读取。"), { code: "invalid_request" });
  const target = matches[0].user_connection_details;
  const selection = selectPluginAppSync(snapshot.details, selectedLinkId, snapshot.statuses);
  if (!selection.statuses.includes(matches[0])) throw Object.assign(Error("同步账户已改变，请重新读取。"), { code: "invalid_request" });
  await verifySyncIdentity(snapshot.identity, signal);
  try {
    const result = await disableServicePluginAppSync(snapshot.details.pluginId, snapshot.appId, selectedLinkId, target.connection_instance_id, target.backing_link_id ?? null, snapshot.identity, signal);
    if (!["accepted", "unknown"].includes(String(object(result.body)?.delivery))) throw invalidSync();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (["forbidden", "invalid_request", "not_found", "ip_not_authorized", "app_not_in_plugin"].includes(code ?? "")) { await verifySyncIdentity(snapshot.identity, signal); throw error; }
    // Other errors may follow a delivered POST. Never replay it to discover the result.
  }
  await verifySyncIdentity(snapshot.identity, signal);
  let actual: PluginAppSyncSnapshot;
  try { actual = await readSyncSnapshot(snapshot.details.pluginId, snapshot.routeAppId, selectedLinkId, snapshot.identity, signal); }
  catch (error) {
    await verifySyncIdentity(snapshot.identity, signal);
    if ((error as { code?: string } | null)?.code === "app_not_in_plugin") throw error;
    return { snapshot: null, confirmed: false, refreshError: "无法读取同步操作结果，请重新读取后核对。" };
  }
  const actualSelection = selectPluginAppSync(actual.details, selectedLinkId, actual.statuses);
  const confirmed = actual.appId === snapshot.appId && (actualSelection.selectedLink?.id ?? null) === (selection.selectedLink?.id ?? null) &&
    !actual.statuses.some(item => pair(item) === pair(matches[0]));
  return { snapshot: actual, confirmed, refreshError: null };
}
