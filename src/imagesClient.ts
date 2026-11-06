import { selectedServiceAccount } from "./serviceAccounts";
import { callAppServer } from "./bridge";
import { isImagesAssetRef, readChatgptService, readImagesMetadata, serviceIdentity, shareAccessBootstrap, type ImagesAssetRef, type ServiceIdentity } from "./chatgptService";
import { parseImagesCatalog, parseImagesHistory, parseImagesStyles, type ImagesCatalog, type ImagesHistoryPage, type ImagesStyles } from "./imagesData";

export interface ImagesAccess {
  identity: ServiceIdentity;
  available: boolean;
  sectionOrder?: string[];
  myImagesTabEnabled?: boolean;
  newLayout?: boolean;
}
export interface ImagesCatalogResult { catalog?: ImagesCatalog; styles?: ImagesStyles; catalogAssets: ImagesAssetRef[]; stylesAssets: ImagesAssetRef[]; errors: string[] }
export interface ImagesHistoryResult extends ImagesHistoryPage { assets: ImagesAssetRef[] }

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
async function confirmIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  signal.throwIfAborted();
  const after = await serviceIdentity(signal);
  if (identity.accountId !== after.accountId || identity.userId !== after.userId || identity.generation !== after.generation)
    throw Error("读取期间账号发生变化，请重试。");
}

/** Direct ImagesRoute capability only; sidebar/chat/holdout rules are independent. */
export async function readImagesAccess(signal: AbortSignal): Promise<ImagesAccess> {
  const identity = await serviceIdentity(signal);
  const [account, accounts, bootstrap] = await Promise.all([
    callAppServer("account/read", { refreshToken: false }),
    readChatgptService("share_accounts", {}, identity, signal), shareAccessBootstrap(identity, signal),
  ]);
  signal.throwIfAborted();
  if (!object(account) || account.account?.type !== "chatgpt"
    || account.workspaceRouting?.chatgptAccountId !== identity.accountId)
    throw Error("无法确认当前图像账号。");
  const selected = selectedServiceAccount(accounts, identity.accountId);
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") throw Error("无法读取图像访问权限。");
  const payload = JSON.parse(bootstrap.statsigPayload);
  // Supported full-snapshot adaptation, not a claim that official responses require has_updates.
  if (!object(payload) || payload.user?.userID !== identity.userId || payload.user?.customIDs?.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format))
    throw Error("图像权限数据不完整或与当前账号不符。");
  const compact = payload.response_format === "init-v2";
  const lookup = (values: any, key: string) => {
    let hash = 0;
    for (let i = 0; i < key.length; ++i) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    return values?.[key] ?? values?.[String(hash)];
  };
  const gate = (key: string, required = true): boolean | undefined => {
    const value = lookup(payload.feature_gates, key)?.[compact ? "v" : "value"];
    if ((required || value !== undefined) && typeof value !== "boolean") throw Error("图像访问资格尚未确认，请重试。");
    return value;
  };
  let available = selected.can_access_with_session !== false && selected.account.is_deactivated !== true;
  if (selected.account.structure === "workspace" && gate("1355972088")) {
    const settings = await readChatgptService("images_workspace_settings", {}, identity, signal);
    if (!object(settings) || (settings.permissions != null && (!Array.isArray(settings.permissions)
      || !settings.permissions.every((value: unknown) => typeof value === "string"))))
      throw Error("图像工作区权限格式无效。");
    available = available && settings.permissions?.includes("chatgpt.workspace.feature.image-gen.access") === true;
  }
  if (gate("3683713372")) {
    // Default host effective config; preserve raw failures instead of configRead's {} normalization.
    const effective = await callAppServer("config/read", { includeLayers: false });
    signal.throwIfAborted();
    if (!object(effective) || !object(effective.config)) throw Error("无法确认图像模型提供方。");
    const provider = effective.config.model_provider;
    if (provider != null && typeof provider !== "string") throw Error("图像模型提供方格式无效。");
    available = available && (provider ?? "openai") === "openai";
  }
  const config = (key: string) => {
    const entry = lookup(payload.dynamic_configs, key);
    if (entry === undefined) return undefined;
    const value = compact ? payload.values?.[entry?.v] : entry?.value;
    if (!object(value)) throw Error("图像布局配置格式无效。");
    return value;
  };
  const sectionOrder = config("3939855767")?.section_order;
  const myImagesTabEnabled = config("4161245824")?.my_images_tab_enabled;
  if (sectionOrder !== undefined && (!Array.isArray(sectionOrder) || !sectionOrder.every(value => typeof value === "string")))
    throw Error("图像类别顺序格式无效。");
  if (myImagesTabEnabled !== undefined && typeof myImagesTabEnabled !== "boolean") throw Error("图像布局配置格式无效。");
  const newLayout = gate("3085093835", false);
  await confirmIdentity(identity, signal);
  return { identity, available, sectionOrder, myImagesTabEnabled, newLayout };
}

export async function readImagesCatalog(access: ImagesAccess, signal: AbortSignal): Promise<ImagesCatalogResult> {
  if (!access.available) throw Error("当前账号暂不支持图像。");
  const [catalog, styles] = await Promise.allSettled([
    readImagesMetadata("images_init", {}, access.identity, signal).then(value => ({ data: parseImagesCatalog(value.body), assets: value.assets })),
    readImagesMetadata("images_styles", { include_image_suggestions: true }, access.identity, signal).then(value => ({ data: parseImagesStyles(value.body), assets: value.assets })),
  ]);
  await confirmIdentity(access.identity, signal);
  return {
    catalog: catalog.status === "fulfilled" ? catalog.value.data : undefined,
    styles: styles.status === "fulfilled" ? styles.value.data : undefined,
    catalogAssets: catalog.status === "fulfilled" ? catalog.value.assets : [],
    stylesAssets: styles.status === "fulfilled" ? styles.value.assets : [],
    errors: [catalog, styles].flatMap(result => result.status === "rejected" ? [String(result.reason)] : []),
  };
}

export async function readImagesHistory(access: ImagesAccess, cursor: string | null, signal: AbortSignal): Promise<ImagesHistoryResult> {
  if (!access.available) throw Error("当前账号暂不支持图像。");
  const result = await readImagesMetadata("images_recent", cursor === null ? { limit: 25 } : { limit: 20, after: cursor }, access.identity, signal);
  await confirmIdentity(access.identity, signal);
  return { ...parseImagesHistory(result.body), assets: result.assets };
}

export async function readImagesAsset(ref: ImagesAssetRef, access: ImagesAccess, signal: AbortSignal): Promise<string> {
  if (!access.available || !isImagesAssetRef(ref)) throw Error("图像资源不可用。");
  signal.throwIfAborted();
  const body = await readChatgptService("images_asset", { asset_key: ref.assetKey, source_request_id: ref.sourceRequestId }, access.identity, signal);
  if (!object(body) || typeof body.dataUrl !== "string" || body.dataUrl.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 64)
    throw Error("图像内容无效，请重试。");
  const prefix = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/u.exec(body.dataUrl);
  const encoded = prefix ? body.dataUrl.slice(prefix[0].length) : "";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!prefix || !encoded || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/]/u.test(encoded.slice(0, encoded.length - padding))
    || encoded.length / 4 * 3 - padding > 8 * 1024 * 1024)
    throw Error("图像内容无效，请重试。");
  await confirmIdentity(access.identity, signal);
  return body.dataUrl;
}
