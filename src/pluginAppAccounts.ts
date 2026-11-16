import { accountRead } from "./config";
import { renamePluginAppAccount, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { decodePluginAppDetails, selectPluginAppLinks, type PluginAppDetails, type PluginAppLink } from "./pluginAppDetails";
import { canonicalMcpAppId } from "./pluginManagementMcp";

const passwordProviders = new Set(["connector_6a99cb6846448190875813bf1e8e5504", "connector_6a99cb684648819088fe4d6a0e373614"]);
function reauthType(link: PluginAppLink): string | null {
  if (link.id.startsWith("implicit_link::")) return null;
  if (link.auth_type === "OAUTH") return "OAUTH";
  return link.auth_type === "API_KEY" && link.auth_strategy_id === "apple.icloud_app_specific_password" && passwordProviders.has(link.connector_id) ? "APP_SPECIFIC_PASSWORD" : null;
}

export function pluginAppAccountsPresentation(details: PluginAppDetails, accounts: PluginAppLink[]) {
  const metadata = details.connector, password = passwordProviders.has(metadata.id);
  // A missing wire field is not evidence of OAuth support. Retain the read-only
  // first-stage content until the metadata needed for actions is available.
  if (!password && !Array.isArray(metadata.supported_auth)) return { visible: true, canRename: false };
  const types = metadata.supported_auth?.map(auth => auth.type) ?? [];
  const defaultAuth = password ? "APP_SPECIFIC_PASSWORD" : ["OAUTH", "NONE", "API_KEY"].find(type => types.includes(type)) ?? "UNSUPPORTED";
  const visible = !(["NONE", "API_KEY"].includes(defaultAuth) && !accounts.some(link => reauthType(link) !== null));
  return { visible, canRename: visible && metadata.enable_multi_links === true };
}

export function persistPluginAppSelection(identity: ServiceIdentity, appId: string, linkId: string | null): void {
  if (!identity.accountId || !identity.userId || !appId) return;
  const storageKey = "selected-plugin-links-v1", key = JSON.stringify([identity.accountId, identity.userId, appId]);
  let record: Record<string, string | null> = {};
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every(value => value === null || typeof value === "string")) record = { ...parsed } as Record<string, string | null>;
    } catch { /* Invalid persisted data has no valid selection. */ }
  }
  delete record[key];
  if (linkId !== null) record[key] = linkId;
  localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(record).slice(-100))));
}

export async function savePluginAppAccountName(snapshot: { identity: ServiceIdentity; details: PluginAppDetails }, appId: string, linkId: string, input: string, signal: AbortSignal) {
  const name = input.trim(), { identity, details } = snapshot;
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  current();
  if (!name || Array.from(name).length > 64) throw Error("账户昵称须为 1 至 64 个字符。");
  if (canonicalMcpAppId(details.appId) !== canonicalMcpAppId(appId) || details.links === null) throw Error("无法确认账户所属应用，请重新读取。");
  const accounts = selectPluginAppLinks(details, null).accounts;
  if (!pluginAppAccountsPresentation(details, accounts).canRename || accounts.filter(link => link.id === linkId).length !== 1) throw Error("当前无法重命名此账户。");
  const verifyIdentity = async () => {
    current();
    const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
    if (account.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
      account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  };
  await verifyIdentity();
  let result;
  try { result = await renamePluginAppAccount(details.pluginId, appId, linkId, name, identity, signal); }
  catch (error) {
    if ((error as { code?: string } | null)?.code === "app_not_in_plugin") await verifyIdentity();
    throw error;
  }
  current();
  const readback = result.readback == null ? null : decodePluginAppDetails(result.readback, details.pluginId, appId);
  await verifyIdentity();
  const actual = readback?.links ? selectPluginAppLinks(readback, null).accounts.filter(link => link.id === linkId) : [];
  return { snapshot: readback ? { identity, details: readback } : null,
    confirmed: result.verification === "confirmed" && actual.length === 1 && actual[0].name === name };
}
