import { accountRead } from "./config";
import { readStandalonePluginApp, resolvePluginAppEntry, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { decodePluginAppConnector, type PluginAppDetails } from "./pluginAppDetails";

export interface StandalonePluginApp {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  logoUrlDark: string | null;
}
export type PluginAppEntry =
  | { kind: "plugin"; identity: ServiceIdentity; appId: string; pluginId: string }
  | { kind: "app"; identity: ServiceIdentity; appId: string; app: StandalonePluginApp;
    connector: PluginAppDetails["connector"] | null; metadataError: { code: string; message: string } | null };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("应用入口响应无效，请重新读取。");

export function decodePluginAppAssociation(raw: unknown, appId: string): string | null {
  const body = object(raw);
  if (body?.appId !== appId || body.pluginId !== null && (typeof body.pluginId !== "string" || !body.pluginId.trim())) throw invalid();
  return body.pluginId as string | null;
}

export function decodeStandalonePluginApp(raw: unknown, appId: string) {
  const body = object(raw), app = object(body?.app);
  if (body?.appId !== appId || app?.id !== appId || typeof app.name !== "string") throw invalid();
  for (const key of ["description", "logoUrl", "logoUrlDark"] as const) if (app[key] !== null && typeof app[key] !== "string") throw invalid();
  const error = body.metadataError === null ? null : object(body.metadataError);
  if (body.connector === null ? !error || typeof error.code !== "string" || typeof error.message !== "string" : body.metadataError !== null) throw invalid();
  return { app: { id: appId, name: app.name, description: app.description as string | null, logoUrl: app.logoUrl as string | null, logoUrlDark: app.logoUrlDark as string | null },
    connector: body.connector === null ? null : decodePluginAppConnector(body.connector, appId),
    metadataError: error ? { code: error.code as string, message: error.message as string } : null };
}

export async function loadPluginAppEntry(appId: string, signal: AbortSignal): Promise<PluginAppEntry> {
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  current();
  const account = await accountRead(); current();
  if (account.account?.type !== "chatgpt") throw Error("请先登录 ChatGPT 账号。");
  const identity = await serviceIdentity(signal); current();
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  const pluginId = decodePluginAppAssociation(await resolvePluginAppEntry(appId, identity, signal), appId); current();
  const result: PluginAppEntry = pluginId === null
    ? { kind: "app", identity, appId, ...decodeStandalonePluginApp(await readStandalonePluginApp(appId, identity, signal), appId) }
    : { kind: "plugin", identity, appId, pluginId };
  current();
  const [after, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]); current();
  if (after.account?.type !== "chatgpt" || actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation ||
    after.workspaceRouting?.chatgptAccountId && after.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  return result;
}
