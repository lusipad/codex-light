import { callAppServer } from "./bridge";
import { experimentalFeatureListAll } from "./config";
import { readChatgptService, readGptsMetadata, serviceIdentity, shareAccessBootstrap, type GptAssetRef, type ServiceIdentity } from "./chatgptService";
import { parseGptDiscovery, parseGptSection, parseGptSearch, parseGptResource, parseGptAbout, type GptDiscovery, type GptSection, type GptResource, type GptAboutBlock } from "./gptsData";

export interface GptsAccess {
  identity: ServiceIdentity;
  available: boolean;
  seatAccess: boolean;
  newLayout: boolean;
  refreshDetails: boolean;
  isWorkspaceOwner: boolean;
  allowThirdPartyGpts?: string;
}
export interface GptsDiscoveryResult extends GptDiscovery { assets: GptAssetRef[] }
export interface GptsSectionResult extends GptSection { assets: GptAssetRef[] }
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
// Official Adt (direct ChatGPT access); sidebar and usage-based seat access have different rules.
const supportedPlans = new Set(["free", "go", "plus", "pro", "promax", "prolite", "free_workspace", "team", "self_serve_business_prolite", "sci", "rosalind_academic", "business", "enterprise_cbp_trial", "enterprise_cbp_view_only", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "quorum", "enterprise", "hc", "hc_consumption", "deprecated_enterprise", "edu", "deprecated_edu", "k12"]);
// Exact Olt table: team is intentionally absent.
const permissionPlans = new Set(["business", "enterprise", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "enterprise_cbp_trial", "enterprise_cbp_view_only", "deprecated_enterprise", "hc", "hc_consumption", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "edu", "deprecated_edu", "k12", "quorum"]);
const usagePlans = new Set(["self_serve_business_usage_based", "enterprise_cbp_usage_based", "enterprise_cbp_automation"]);
async function confirmIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  signal.throwIfAborted();
  const after = await serviceIdentity(signal);
  if (identity.accountId !== after.accountId || identity.userId !== after.userId || identity.generation !== after.generation)
    throw Error("读取期间账号发生变化，请重试。");
}

export async function readGptsAccess(signal: AbortSignal): Promise<GptsAccess> {
  const identity = await serviceIdentity(signal);
  const [auth, accounts, bootstrap, features] = await Promise.all([
    callAppServer("account/read", { refreshToken: false }), readChatgptService("share_accounts", {}, identity, signal),
    shareAccessBootstrap(identity, signal), experimentalFeatureListAll(),
  ]);
  signal.throwIfAborted();
  if (!object(auth) || auth.account?.type !== "chatgpt" || auth.workspaceRouting?.chatgptAccountId !== identity.accountId)
    throw Error("无法确认当前 GPT 账号。");
  if (!object(accounts) || !Array.isArray(accounts.account_ordering) || !accounts.account_ordering.includes(identity.accountId)
    || !object(accounts.accounts) || !object(accounts.accounts[identity.accountId])) throw Error("无法确认 GPT 账号信息。");
  const entry = accounts.accounts[identity.accountId], account = entry.account;
  if (!object(account) || account.account_id !== identity.accountId || !["personal", "workspace"].includes(account.structure)
    || typeof account.plan_type !== "string" || typeof account.account_user_id !== "string" || !account.account_user_id
    || typeof account.account_user_role !== "string" || typeof account.is_zdr !== "boolean"
    || (entry.features != null && (!Array.isArray(entry.features) || !entry.features.every((v: unknown) => typeof v === "string"))))
    throw Error("GPT 账号成员信息不完整。");
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") throw Error("无法读取 GPT 访问权限。");
  const payload = JSON.parse(bootstrap.statsigPayload);
  // Full-snapshot support boundary of this adapter, not an official mandatory has_updates contract.
  if (!object(payload) || payload.user?.userID !== identity.userId || payload.user?.customIDs?.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format))
    throw Error("GPT 权限快照不完整或与当前账号不符。");
  const gate = (key: string, required = false): boolean | undefined => {
    let hash = 0; for (let i = 0; i < key.length; ++i) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    const entry = payload.feature_gates[key] ?? payload.feature_gates[String(hash)];
    const value = entry?.[payload.response_format === "init-v2" ? "v" : "value"];
    if ((required || value !== undefined) && typeof value !== "boolean") throw Error("GPT 访问资格尚未确认。");
    return value;
  };
  if (!Array.isArray(features) || features.some(feature => !feature || typeof feature.name !== "string" || typeof feature.enabled !== "boolean"))
    throw Error("GPT 实验功能列表无效。");
  const chatEnabled = !features.some(feature => feature.name === "in_app_chat" && feature.enabled === false);
  let available = chatEnabled && supportedPlans.has(account.plan_type);
  const seatAccess = chatEnabled && (account.structure === "workspace" || usagePlans.has(account.plan_type))
    && entry.features?.includes("codex_only") === true && account.structure === "workspace";
  const permissionGate = gate("770071981", true);
  // Public directory also consumes workspace settings for its owner-specific restriction exception.
  let settings: any;
  if (!seatAccess && chatEnabled && (account.structure === "workspace" || permissionGate && permissionPlans.has(account.plan_type))) {
    settings = await readChatgptService("gpts_workspace_settings", {}, identity, signal);
    if (!object(settings) || (settings.permissions != null && (!Array.isArray(settings.permissions) || !settings.permissions.every((v: unknown) => typeof v === "string")))
      || (settings.allow_third_party_gpts != null && typeof settings.allow_third_party_gpts !== "string")) throw Error("GPT 工作空间设置格式无效。");
  }
  if (available && permissionGate && permissionPlans.has(account.plan_type)) available = settings?.permissions?.includes("chatgpt.workspace.feature.desktop-app-chat.access") === true;
  const newLayout = gate("3085093835") === true, refreshDetails = gate("2160578039") === true;
  await confirmIdentity(identity, signal);
  return { identity, available, seatAccess, newLayout, refreshDetails, isWorkspaceOwner: account.account_user_role === "account-owner", allowThirdPartyGpts: settings?.allow_third_party_gpts };
}

function requireAccess(access: GptsAccess) {
  if (!access.available || access.seatAccess) throw Error("当前账号暂不支持 GPT 目录。");
}
export async function readGptsDiscovery(access: GptsAccess, signal: AbortSignal): Promise<GptsDiscoveryResult> {
  requireAccess(access);
  const result = await readGptsMetadata("gpts_discovery", {}, access.identity, signal);
  const parsed = parseGptDiscovery(result.body); await confirmIdentity(access.identity, signal);
  return { ...parsed, assets: result.assets };
}
export async function readGptsSearch(access: GptsAccess, query: string, cursor: string | null, signal: AbortSignal): Promise<GptsSectionResult> {
  requireAccess(access);
  const q = query.trim(); if (!q) throw Error("请输入 GPT 搜索词。");
  const result = await readGptsMetadata("gpts_search", { q, limit: 12, ...(cursor === null ? {} : { cursor }) }, access.identity, signal);
  const parsed = parseGptSearch(result.body);
  if (cursor !== null && parsed.cursor === cursor) throw Error("GPT 服务返回了重复分页游标，请重试。");
  await confirmIdentity(access.identity, signal);
  return { ...parsed, assets: result.assets };
}
export async function readGptsCategory(access: GptsAccess, section: GptSection, locale: string | null, signal: AbortSignal): Promise<GptsSectionResult> {
  requireAccess(access);
  if (!section.cursor) throw Error("GPT 分类没有下一页。");
  const read = (cursor: string) => readGptsMetadata("gpts_category", { id: section.id, cursor, limit: 6, ...(locale === null ? {} : { locale }) }, access.identity, signal);
  let result = await read(section.cursor), parsed = parseGptSection(result.body);
  if (parsed.id !== section.id) throw Error("GPT 分类在读取期间发生变化，请刷新。");
  if (parsed.cursor === section.cursor) throw Error("GPT 服务返回了重复分页游标，请重试。");
  if (parsed.rawItemCount === 0 && parsed.cursor !== null) {
    const next = parsed.cursor;
    result = await read(next); parsed = parseGptSection(result.body);
    if (parsed.cursor === next || parsed.cursor === section.cursor) throw Error("GPT 服务返回了重复分页游标，请重试。");
    if (parsed.id !== section.id) throw Error("GPT 分类在读取期间发生变化，请刷新。");
  }
  await confirmIdentity(access.identity, signal);
  return { ...parsed, assets: result.assets };
}
export async function readGptsDetail(access: GptsAccess, id: string, signal: AbortSignal): Promise<{ resource: GptResource; assets: GptAssetRef[] }> {
  requireAccess(access);
  const result = await readGptsMetadata("gpts_detail", { id }, access.identity, signal);
  const resource = parseGptResource(result.body);
  if (!resource || resource.id !== id) throw Error("GPT 详情与所选条目不符。");
  await confirmIdentity(access.identity, signal);
  return { resource, assets: result.assets };
}
export async function readGptsAbout(access: GptsAccess, id: string, signal: AbortSignal): Promise<GptAboutBlock[]> {
  requireAccess(access);
  const parsed = parseGptAbout(await readChatgptService("gpts_about", { id }, access.identity, signal));
  await confirmIdentity(access.identity, signal); return parsed;
}
export async function readGptsAvatar(ref: GptAssetRef, access: GptsAccess, signal: AbortSignal): Promise<string> {
  requireAccess(access);
  const body = await readChatgptService("gpts_avatar", { asset_key: ref.assetKey, source_request_id: ref.sourceRequestId }, access.identity, signal);
  if (!object(body) || typeof body.dataUrl !== "string" || body.dataUrl.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 64) throw Error("GPT 头像内容无效。");
  const prefix = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/u.exec(body.dataUrl), encoded = prefix ? body.dataUrl.slice(prefix[0].length) : "";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!prefix || !encoded || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/]/u.test(encoded.slice(0, encoded.length - padding))
    || encoded.length / 4 * 3 - padding > 8 * 1024 * 1024) throw Error("GPT 头像内容无效。");
  await confirmIdentity(access.identity, signal); return body.dataUrl;
}
