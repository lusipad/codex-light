import { accountRead } from "./config";
import { readPluginCanonicalRoot, serviceIdentity, type ServiceIdentity } from "./chatgptService";

export interface PluginCanonicalRoot {
  kind: "generic" | "canonical";
  pluginId: string;
  appId: string | null;
  pluginHeader: { id: string; name: string; version: string | null; shortDescription: string | null; logoUrl: string | null; logoUrlDark: string | null };
  hostedApp: { name: string; description: string | null; logoUrl: string | null; logoUrlDark: string | null } | null;
  hostedError: { code: string; message: string } | null;
  nativeEligibility: "unverified";
}
export type PluginCanonicalRootSnapshot = PluginCanonicalRoot & { identity: ServiceIdentity };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const invalid = () => Error("插件根详情响应格式无效。");

export function decodePluginCanonicalRoot(raw: unknown, pluginId: string): PluginCanonicalRoot {
  const body = object(raw), header = object(body?.pluginHeader), hosted = body?.hostedApp === null ? null : object(body?.hostedApp), error = body?.hostedError === null ? null : object(body?.hostedError);
  if (!body || !header || body.pluginId !== pluginId || header.id !== pluginId || body.kind !== "generic" && body.kind !== "canonical" || body.nativeEligibility !== "unverified" ||
    typeof header.name !== "string" || ![header.version, header.shortDescription, header.logoUrl, header.logoUrlDark].every(nullableString) ||
    body.hostedApp !== null && (!hosted || typeof hosted.name !== "string" || ![hosted.description, hosted.logoUrl, hosted.logoUrlDark].every(nullableString)) ||
    body.hostedError !== null && (!error || typeof error.code !== "string" || !error.code.trim() || typeof error.message !== "string")) throw invalid();
  if (body.kind === "generic" ? body.appId !== null || hosted !== null || error !== null
    : typeof body.appId !== "string" || !body.appId.trim() || (hosted === null) === (error === null)) throw invalid();
  return {
    kind: body.kind as PluginCanonicalRoot["kind"], pluginId, appId: body.appId as string | null,
    pluginHeader: { id: pluginId, name: header.name, version: header.version as string | null, shortDescription: header.shortDescription as string | null,
      logoUrl: header.logoUrl as string | null, logoUrlDark: header.logoUrlDark as string | null },
    hostedApp: hosted ? { name: hosted.name as string, description: hosted.description as string | null, logoUrl: hosted.logoUrl as string | null, logoUrlDark: hosted.logoUrlDark as string | null } : null,
    hostedError: error ? { code: error.code as string, message: error.message as string } : null,
    nativeEligibility: "unverified",
  };
}

export async function loadPluginCanonicalRoot(pluginId: string, signal: AbortSignal): Promise<PluginCanonicalRootSnapshot> {
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
  try { raw = await readPluginCanonicalRoot(pluginId, identity, signal); }
  catch (error) { await verifyIdentity(); throw error; }
  await verifyIdentity();
  return { identity, ...decodePluginCanonicalRoot(raw, pluginId) };
}
