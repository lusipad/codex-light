import { accountRead } from "./config";
import { readServicePluginConnectionFinal, serviceIdentity, type ServiceIdentity } from "./chatgptService";

export interface PluginConnectionFinalOptions { requiresAppSetup?: boolean; requestedConnectorId?: string | null }
export type PluginConnectionFinalResult = { kind: "ready" } | { kind: "unavailable" } | {
  kind: "needsAuth";
  app: { id: string; name: string; description: string | null; category: null; installUrl: null };
};
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("连接校验响应格式或归属无效，请重试。");

export function decodePluginConnectionFinal(raw: unknown, requestedConnectorId: string | null): PluginConnectionFinalResult {
  const body = object(raw), result = object(body?.result);
  if (!body || body.requestedConnectorId !== requestedConnectorId || !result) throw invalid();
  if (result.kind === "ready" || result.kind === "unavailable") return { kind: result.kind };
  const app = object(result.app);
  // AF01 returns the original requested ID, not a metadata alias or the current selection.
  if (result.kind !== "needsAuth" || !app || requestedConnectorId === null || app.id !== requestedConnectorId ||
    typeof app.name !== "string" || app.description !== null && typeof app.description !== "string" || app.category !== null || app.installUrl !== null) throw invalid();
  return { kind: "needsAuth", app: { id: requestedConnectorId, name: app.name, description: app.description as string | null, category: null, installUrl: null } };
}

export async function readPluginConnectionFinal(options: PluginConnectionFinalOptions, identity: ServiceIdentity, signal: AbortSignal): Promise<PluginConnectionFinalResult> {
  if (options.requiresAppSetup !== undefined && typeof options.requiresAppSetup !== "boolean" ||
    options.requestedConnectorId != null && (typeof options.requestedConnectorId !== "string" || options.requestedConnectorId.length === 0)) throw Error("连接校验参数无效。");
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  const verify = async () => {
    current(); const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
    if (account.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
      account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  };
  await verify(); current();
  let raw: unknown;
  try { raw = await readServicePluginConnectionFinal(options, identity, signal); }
  catch (error) { await verify(); throw error; }
  await verify(); current();
  return decodePluginConnectionFinal(raw, options.requestedConnectorId ?? null);
}
