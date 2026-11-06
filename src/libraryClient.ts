import { callAppServer } from "./bridge";
import { readChatgptService, serviceIdentity, shareAccessBootstrap, type ServiceIdentity } from "./chatgptService";
import { parseLibraryDirectoryPath, parseLibraryImagesPage, parseLibraryNodesPage, type LibraryDirectoryEntry, type LibraryItem, type LibraryPage } from "./libraryData";
import { LIBRARY_PREVIEW_MAX_BYTES, parseLibraryFile, type LibraryFile } from "./libraryPreview";
import type { LibraryBrowseScope } from "./libraryBrowse";

export type LibraryTab = "all" | "images";
export interface LibraryAccess { identity: ServiceIdentity; available: boolean; onedrive: boolean; newLayout?: boolean }

const supportedPlans = new Set(["free", "go", "plus", "pro", "promax", "prolite", "free_workspace", "team",
  "self_serve_business_prolite", "sci", "rosalind_academic", "business", "enterprise_cbp_trial",
  "enterprise_cbp_view_only", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "quorum",
  "enterprise", "hc", "hc_consumption", "deprecated_enterprise", "edu", "deprecated_edu", "k12"]);
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Full, identity-bound snapshots only; partial/live Statsig evaluations remain unsupported. */
export function decodeLibraryAccess(bootstrap: unknown, settings: unknown, account: unknown, identity: ServiceIdentity, accounts: unknown): LibraryAccess {
  if (!object(account) || account.account?.type !== "chatgpt"
    || (account.workspaceRouting?.chatgptAccountId != null && account.workspaceRouting.chatgptAccountId !== identity.accountId))
    throw Error("无法确认当前账号的资料库访问资格。");
  if (!object(accounts) || !Array.isArray(accounts.accounts) || !Array.isArray(accounts.account_ordering)
    || !accounts.account_ordering.includes(identity.accountId)) throw Error("无法确认资料库账号。");
  const selected = accounts.accounts.filter((entry: unknown) => object(entry) && entry.id === identity.accountId);
  if (selected.length !== 1 || !supportedPlans.has(selected[0].plan_type)
    || selected[0].can_access_with_session === false || selected[0].is_deactivated === true)
    throw Error("无法确认当前账号的资料库访问资格。");
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") throw Error("无法读取资料库访问权限。");
  const payload = JSON.parse(bootstrap.statsigPayload);
  if (!object(payload) || payload.user?.userID !== identity.userId || payload.user?.customIDs?.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format))
    throw Error("资料库权限数据不完整或与当前账号不符。");
  const compact = payload.response_format === "init-v2";
  const lookup = (values: any, key: string) => {
    let hash = 0;
    for (let i = 0; i < key.length; ++i) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    return values?.[key] ?? values?.[String(hash)];
  };
  const gate = (key: string): boolean | undefined => {
    const value = lookup(payload.feature_gates, key)?.[compact ? "v" : "value"];
    if (value !== undefined && typeof value !== "boolean") throw Error("资料库权限格式无效。");
    return value;
  };
  const layer = lookup(payload.layer_configs, "3017902351");
  const layerValue = compact ? payload.values?.[layer?.v] : layer?.value;
  const fileGate = gate("224248639"), layerGate = layerValue?.web_file_library_enabled;
  if (layerGate !== undefined && typeof layerGate !== "boolean") throw Error("资料库权限格式无效。");
  if (fileGate !== true && layerGate !== true) {
    if (fileGate === false && layerGate === false) return { identity, available: false, onedrive: false };
    throw Error("当前账号的资料库访问权限尚未确认。");
  }
  if (!object(settings) || (settings.flags !== undefined && !object(settings.flags))) throw Error("资料库地区设置响应无效。");
  const country = settings.flags?.file_library_enabled_for_registration_country;
  if (country !== undefined && typeof country !== "boolean") throw Error("资料库地区设置响应无效。");
  if (country === false) return { identity, available: false, onedrive: false };
  const onedrive = gate("3583034603");
  if (onedrive === undefined) throw Error("无法确认资料库来源权限，请重试。");
  // JD only excludes unsupported-auth; the ChatGPT identity above cannot produce that Cv reason.
  const newLayout = gate("3085093835");
  return { identity, available: true, onedrive, ...(newLayout === undefined ? {} : { newLayout }) };
}

export async function readLibraryAccess(signal: AbortSignal): Promise<LibraryAccess> {
  const identity = await serviceIdentity(signal);
  const [bootstrap, settings, account, accounts] = await Promise.all([
    shareAccessBootstrap(identity, signal), readChatgptService("library_settings", {}, identity, signal),
    callAppServer("account/read", { refreshToken: false }),
    readChatgptService("share_accounts", {}, identity, signal),
  ]);
  signal.throwIfAborted();
  const after = await serviceIdentity(signal);
  if (identity.accountId !== after.accountId || identity.userId !== after.userId || identity.generation !== after.generation)
    throw Error("读取期间账号发生变化，请重试。");
  return decodeLibraryAccess(bootstrap, settings, account, identity, accounts);
}

export async function readLibraryPage(access: LibraryAccess, tab: LibraryTab, cursor: string | null, signal: AbortSignal, directoryId?: string | null, search = "", browse?: LibraryBrowseScope): Promise<LibraryPage> {
  if (!access.available) throw Error("当前账号暂不支持资料库。");
  if (tab === "images") return parseLibraryImagesPage(await readChatgptService("library_images", { cursor }, access.identity, signal));
  return parseLibraryNodesPage(await readChatgptService("library_nodes", {
    ...(directoryId != null ? { parent_directory_id: directoryId } : {}),
    ...(search ? { q: search } : {}),
    entry_surface: "library", cursor, categories: browse?.categories ?? [], source: browse?.sources.length === 1 ? browse.sources[0] : null,
    include_hidden_files: false, include_files: !(browse?.tab === "folders" && directoryId == null && !search),
    include_saved_entities: true, defer_sharing_badges: true, include_sites: false,
    include_folder_counts: false, include_onedrive: access.onedrive, hydrate_folder_thumbnails: true,
  }, access.identity, signal));
}

export async function readLibraryBrowsePage(access: LibraryAccess, scope: LibraryBrowseScope, cursor: string | null, signal: AbortSignal): Promise<LibraryPage> {
  if (!access.available) throw Error("当前账号暂不支持资料库。");
  const search = scope.search.trim(), source = scope.sources.length === 1 ? scope.sources[0] : null;
  if (!search && scope.directoryId === null && scope.tab === "suggested") {
    return parseLibraryImagesPage(await readChatgptService("library_suggested", {
      cursor, categories: scope.categories, source,
    }, access.identity, signal));
  }
  if (!search && scope.directoryId === null && scope.tab === "images") {
    return parseLibraryImagesPage(await readChatgptService("library_images", { cursor, source }, access.identity, signal));
  }
  const page = await readLibraryPage(access, "all", cursor, signal, scope.directoryId, search, scope);
  return scope.categories.length ? { ...page, items: page.items.filter(item => item.node.kind !== "directory") } : page;
}

export async function readLibraryDirectoryPath(access: LibraryAccess, directoryId: string, signal: AbortSignal): Promise<LibraryDirectoryEntry[]> {
  if (!access.available) throw Error("当前账号暂不支持资料库。");
  if (typeof directoryId !== "string" || !directoryId.trim()) throw Error("无法确认资料库目录。");
  return parseLibraryDirectoryPath(await readChatgptService("library_directory_path", {
    directory_id: directoryId,
  }, access.identity, signal));
}

export async function readLibraryFile(access: LibraryAccess, id: string, signal: AbortSignal): Promise<LibraryFile> {
  if (!access.available) throw Error("当前账号暂不支持资料库。");
  if (!id.trim()) throw Error("无法确认文件。");
  return parseLibraryFile(await readChatgptService("library_file", { library_file_id: id }, access.identity, signal), id);
}

export async function readLibraryFileContent(access: LibraryAccess, file: LibraryFile, signal: AbortSignal): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  if (!access.available) throw Error("当前账号暂不支持资料库。");
  const params: Record<string, unknown> = { library_file_id: file.id };
  if (file.file_id) params.file_id = file.file_id;
  if (typeof file.gizmo_id === "string" && file.gizmo_id) params.gizmo_id = file.gizmo_id;
  const body = await readChatgptService("library_file_content", params, access.identity, signal);
  const mime = object(body) && typeof body.mimeType === "string" ? body.mimeType.split(";")[0].trim().toLowerCase() : "";
  if (!object(body) || typeof body.bytesBase64 !== "string" || body.bytesBase64.length > Math.ceil(LIBRARY_PREVIEW_MAX_BYTES / 3) * 4
    || body.bytesBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(body.bytesBase64)
    || typeof body.mimeType !== "string" || /[\u0000-\u001f\u007f]/u.test(body.mimeType)
    || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/u.test(mime))
    throw Error("文件内容响应无效，请重试。");
  const raw = atob(body.bytesBase64);
  if (raw.length > LIBRARY_PREVIEW_MAX_BYTES) throw Error("文件过大，无法预览。");
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return { bytes: bytes.buffer, mimeType: mime };
}

export async function readLibraryImage(item: LibraryItem, access: LibraryAccess, signal: AbortSignal): Promise<string> {
  if (!access.available) throw Error("当前账号暂不支持资料库。");
  const params: Record<string, unknown> = {};
  const id = /^libfile_fde\d+_/u.test(item.node.id) ? item.node.id : item.node.file_id;
  if (typeof id === "string" && /^libfile_fde\d+_/u.test(id)) params.library_file_id = id;
  else if (typeof id === "string" && id) params.file_id = id;
  else throw Error("无法读取图像预览。");
  if (typeof item.node.gizmo_id === "string" && item.node.gizmo_id) params.gizmo_id = item.node.gizmo_id;
  const body = await readChatgptService("library_image", params, access.identity, signal);
  if (!object(body) || typeof body.dataUrl !== "string" || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+=*$/u.test(body.dataUrl))
    throw Error("无法读取图像预览。");
  return body.dataUrl;
}
