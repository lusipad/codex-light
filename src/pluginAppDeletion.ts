import { accountRead } from "./config";
import { deleteServicePluginApp, readServicePluginAppDeleteStatus, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { canonicalMcpAppId } from "./pluginManagementMcp";
import type { PluginAppManagementData } from "./pluginAppManagement";

export interface PluginAppDeleteStatus { appId: string; metadataId: string; presence: "present" | "not_found" }
export interface PluginAppDeleteResult {
  confirmed: boolean;
  delivery: "accepted" | "unknown" | "not_sent" | "rejected";
  warningCode: string | null;
  readback: PluginAppDeleteStatus | null;
}
type Snapshot = PluginAppManagementData & { identity: ServiceIdentity };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("应用删除状态响应格式或归属无效，请重新读取。");
const current = (signal: AbortSignal) => { if (signal.aborted) throw Error("请求已取消"); };
export function decodePluginAppDeleteStatus(raw: unknown, appId: string, metadataId: string): PluginAppDeleteStatus {
  const body = object(raw);
  if (!body || typeof body.appId !== "string" || !body.appId.trim() || canonicalMcpAppId(body.appId) !== canonicalMcpAppId(appId) ||
    body.metadataId !== metadataId || typeof body.metadataId !== "string" || !body.metadataId.trim() || body.presence !== "present" && body.presence !== "not_found") throw invalid();
  return { appId: body.appId, metadataId: body.metadataId, presence: body.presence };
}
async function verifyIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  current(signal); const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current(signal);
  if (account.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
    account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
}
export async function deletePluginApp(snapshot: Snapshot, signal: AbortSignal): Promise<PluginAppDeleteResult> {
  if (snapshot.canDelete !== true || snapshot.deleteDisabled !== false) throw Error("当前无法删除此应用，请重新读取。");
  await verifyIdentity(snapshot.identity, signal); current(signal);
  let raw: unknown;
  try { raw = await deleteServicePluginApp(snapshot.appId, snapshot.metadata.id, snapshot.identity, signal); }
  catch (error) { await verifyIdentity(snapshot.identity, signal); throw error; }
  await verifyIdentity(snapshot.identity, signal); current(signal);
  const result = object(raw), body = object(result?.body);
  if (!result || !body || typeof body.delivery !== "string" || !["accepted", "unknown", "not_sent", "rejected"].includes(body.delivery) ||
    body.warningCode !== null && typeof body.warningCode !== "string" || result.verification !== "confirmed" && result.verification !== "pending") throw invalid();
  let readback: PluginAppDeleteStatus | null = null;
  if (result.readback != null) {
    try { readback = decodePluginAppDeleteStatus(result.readback, snapshot.appId, snapshot.metadata.id); }
    catch { /* Preserve delivery; an invalid readback cannot confirm deletion. */ }
  }
  return { delivery: body.delivery as PluginAppDeleteResult["delivery"], warningCode: body.warningCode as string | null, readback,
    confirmed: result.verification === "confirmed" && body.delivery !== "rejected" && readback?.presence === "not_found" };
}
export async function readPluginAppDeletionStatus(snapshot: Snapshot, signal: AbortSignal): Promise<PluginAppDeleteStatus> {
  await verifyIdentity(snapshot.identity, signal); current(signal);
  let raw: unknown;
  try { raw = await readServicePluginAppDeleteStatus(snapshot.appId, snapshot.metadata.id, snapshot.identity, signal); }
  catch (error) { await verifyIdentity(snapshot.identity, signal); throw error; }
  await verifyIdentity(snapshot.identity, signal); current(signal);
  return decodePluginAppDeleteStatus(raw, snapshot.appId, snapshot.metadata.id);
}
