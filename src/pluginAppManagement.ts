import { accountRead } from "./config";
import { readPluginAppManagement, updatePluginAppMetadata, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { canonicalMcpAppId } from "./pluginManagementMcp";

export interface PluginAppManagementData {
  appId: string;
  metadata: { id: string; name: string; description?: string | null };
  canEditName: boolean;
  canEditDescription: boolean;
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("应用管理响应格式或归属无效，请重新读取。");

export function decodePluginAppManagement(raw: unknown, appId: string): PluginAppManagementData {
  const body = object(raw), metadata = object(body?.metadata);
  if (!appId.trim() || !body || typeof body.appId !== "string" || !body.appId.trim() || canonicalMcpAppId(body.appId) !== canonicalMcpAppId(appId) ||
    !metadata || typeof metadata.id !== "string" || !metadata.id.trim() || canonicalMcpAppId(metadata.id) !== canonicalMcpAppId(appId) || typeof metadata.name !== "string" ||
    typeof body.canEditName !== "boolean" || typeof body.canEditDescription !== "boolean") throw invalid();
  if (Object.hasOwn(metadata, "description") && metadata.description !== null && typeof metadata.description !== "string") throw invalid();
  return { appId: body.appId, metadata: { id: metadata.id, name: metadata.name,
    ...(Object.hasOwn(metadata, "description") ? { description: metadata.description as string | null } : {}) },
    canEditName: body.canEditName, canEditDescription: body.canEditDescription };
}

export async function loadPluginAppManagement(appId: string, signal: AbortSignal): Promise<PluginAppManagementData & { identity: ServiceIdentity }> {
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
  try { raw = await readPluginAppManagement(appId, identity, signal); }
  catch (error) { await verifyIdentity(); throw error; }
  await verifyIdentity(); current();
  return { ...decodePluginAppManagement(raw, appId), identity };
}

export interface PluginAppMetadataSaveResult {
  snapshot: (PluginAppManagementData & { identity: ServiceIdentity }) | null;
  confirmed: boolean;
  delivery: "accepted" | "unknown" | "not_sent" | "rejected";
  warningCode: string | null;
}
export async function savePluginAppMetadata(snapshot: PluginAppManagementData & { identity: ServiceIdentity }, operation: "name" | "description", input: string, signal: AbortSignal): Promise<PluginAppMetadataSaveResult> {
  if (operation !== "name" && operation !== "description" || typeof input !== "string") throw Error("应用编辑参数无效。");
  const value = operation === "name" ? input.trim() : input;
  if (operation === "name" ? !snapshot.canEditName || !value : !snapshot.canEditDescription) throw Error("当前无法更改应用，请重新读取。");
  if (value === snapshot.metadata[operation]) throw Error("应用内容尚未更改。");
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  const identity = snapshot.identity;
  const verify = async () => {
    current(); const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
    if (account.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
      account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  };
  await verify(); current();
  let result: unknown;
  try { result = await updatePluginAppMetadata(snapshot.appId, snapshot.metadata.id, operation, value, identity, signal); }
  catch (error) { await verify(); throw error; }
  await verify(); current();
  const response = object(result), body = object(response?.body);
  if (!response || !body || typeof body.delivery !== "string" || !["accepted", "unknown", "not_sent", "rejected"].includes(body.delivery) ||
    body.warningCode !== null && typeof body.warningCode !== "string" || response.verification !== "confirmed" && response.verification !== "pending") throw invalid();
  let actual: PluginAppMetadataSaveResult["snapshot"] = null;
  if (response.readback != null) {
    try {
      const decoded = decodePluginAppManagement(response.readback, snapshot.appId);
      if (decoded.metadata.id === snapshot.metadata.id) actual = { ...decoded, identity };
    } catch { /* An invalid readback cannot confirm a sent edit or replace the current metadata. */ }
  }
  return { snapshot: actual, delivery: body.delivery as PluginAppMetadataSaveResult["delivery"], warningCode: body.warningCode as string | null,
    confirmed: response.verification === "confirmed" && body.delivery !== "rejected" && actual !== null && actual.metadata[operation] === value };
}
