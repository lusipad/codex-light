import { accountRead } from "./config";
import { readPluginPermissions, serviceIdentity, writePluginPermission, type ServiceIdentity } from "./chatgptService";

export type PluginPermission = "always_ask" | "ask_before_writes" | "review_important_actions" | "full_access";
export const pluginPermissionOptions = [
  { value: "always_ask", label: "始终询问", description: "读取或更改前先询问" },
  { value: "ask_before_writes", label: "允许使用只读工具", description: "读取时无需询问，但更改前需询问" },
  { value: "review_important_actions", label: "允许使用低风险工具", description: "自动批准低风险工具，但敏感工具可能会被拒绝" },
];
export interface PluginPermissionsSnapshot {
  identity: ServiceIdentity | null;
  access: "allowed" | "denied";
  value: PluginPermission | null;
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function decodePluginPermissions(raw: unknown, identity: ServiceIdentity): PluginPermissionsSnapshot {
  const value = object(raw);
  if (value?.access === "denied" && value.value === null) return { identity, access: "denied", value: null };
  if (value?.access !== "allowed" || typeof value.value !== "string" || ![...pluginPermissionOptions.map(option => option.value), "full_access"].includes(value.value)) throw Error("权限设置响应格式无效。");
  return { identity, access: "allowed", value: value.value as PluginPermission };
}
export async function loadPluginPermissions(signal: AbortSignal): Promise<PluginPermissionsSnapshot> {
  const account = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  if (account.account?.type !== "chatgpt") return { identity: null, access: "denied", value: null };
  const identity = await serviceIdentity(signal);
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  const snapshot = decodePluginPermissions(await readPluginPermissions(identity, signal), identity);
  if (signal.aborted) throw Error("请求已取消");
  const [after, current] = await Promise.all([accountRead(), serviceIdentity(signal)]);
  if (signal.aborted) throw Error("请求已取消");
  if (after.account?.type !== "chatgpt" || current.accountId !== identity.accountId || current.userId !== identity.userId || current.generation !== identity.generation ||
    after.workspaceRouting?.chatgptAccountId && after.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  return snapshot;
}
export async function savePluginPermission(snapshot: PluginPermissionsSnapshot, value: string, signal: AbortSignal) {
  if (!snapshot.identity || snapshot.access !== "allowed" || !pluginPermissionOptions.some(option => option.value === value)) throw Error("当前不允许修改此默认权限。");
  const result = await writePluginPermission(value, snapshot.identity, signal);
  const readback = result.readback == null ? null : decodePluginPermissions(result.readback, snapshot.identity);
  return { snapshot: readback, confirmed: result.verification === "confirmed" && readback?.access === "allowed" && readback.value === value };
}
