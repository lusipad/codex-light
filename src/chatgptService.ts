import { tauriInvoke } from "./bridge";
import type { CloudNetworkPolicy } from "./cloudDraftNetwork";
import type { ModelInfo } from "./types";
import { parseSiteDomains, type SiteDomain } from "./sitesService";
import { parsePinnedReviewComparison, parsePinnedReviewFile, parseRemotePullRequest, parseRemotePullRequestUrl,
  type PinnedReviewComparison, type PinnedReviewFile, type RemotePullRequest } from "./remoteReview";

export interface ServiceIdentity { accountId: string; userId: string; generation: number }
export interface CloudAccess { identity: ServiceIdentity; gateEvidence: "personal-plan-branch" | "incomplete" }
export interface ReviewProviderAccess {
  identity: ServiceIdentity;
  preferences: ReviewProviderPreferences;
  capabilities: { githubInstances: boolean | null; gitlab: boolean | null; reviewTabDefault: boolean | null };
  githubConnections: { hostname: string; name?: string | null; connection: { connectorId: string; accountLinkId: string } }[] | null;
  githubConnectionsError: string | null;
  gitlabInstances: { connectorId: string; hostname: string; name?: string | null }[] | null;
  gitlabInstancesError: string | null;
}
export interface ReviewProviderPreferences {
  gitHostingProvider: string;
  githubConnection: { hostname: string; connectorId: string; accountLinkId: string } | null;
  gitlabConnectorId: string | null;
}
export type ServiceOperation = "library_favorites" | "library_nodes" | "library_directory_path" | "library_file" | "library_file_content" | "library_suggested" | "library_images" | "library_settings" | "library_image" | "storage_usage" | "images_init" | "images_styles" |
  "images_recent" | "images_workspace_settings" | "images_asset" | "gpts_discovery" | "gpts_category" | "gpts_search" | "gpts_detail" | "gpts_about" | "gpts_avatar" | "gpts_workspace_settings" | "cloud_workspace_settings" |
  "sites_entry_access" | "sites_pinned" | "sites_pin" | "sites_asset" | "sites_access" | "sites_list" | "sites_shared" | "sites_detail" | "sites_environment" | "sites_domains" | "sites_share_access" | "sites_preferred_live_url" | "sites_workspace_settings" | "sites_users" | "sites_groups" | "sites_teams" | "github_repository" |
  "cloud_github_default" | "cloud_github_enterprise" | "cloud_github_links" | "cloud_github_installations" | "cloud_github_repositories" |
  "share_accounts" | "share_users" | "share_groups" | "wham_usage" | "account_me" | "profile_identity" | "profile_page";

function browserProfile() {
  const browser = (navigator as Navigator & { userAgentData?: {
    brands: { brand: string; version: string }[]; platform: string;
  } }).userAgentData;
  if (!browser?.brands?.length || !browser.platform) throw Error("无法读取浏览器上下文，请在原生应用中重试。");
  let deviceId = localStorage.getItem("codex_service_device_id_v1");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("codex_service_device_id_v1", deviceId);
  }
  return {
    language: "zh-CN", deviceId, userAgent: navigator.userAgent,
    userAgentClientHints: browser.brands.map(item => `${JSON.stringify(item.brand)};v=${JSON.stringify(item.version)}`).join(", "),
    platformClientHint: JSON.stringify(browser.platform),
  };
}

async function invokeService<T>(
  command: string, requestId: string, args: Record<string, unknown>, signal: AbortSignal,
  onCancelledResult?: (result: T) => Promise<void>,
): Promise<T> {
  if (signal.aborted) throw Error("请求已取消");
  const cancel = () => { void tauriInvoke("chatgpt_service_cancel", { requestId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await tauriInvoke<T>(command, args);
    if (signal.aborted) {
      await onCancelledResult?.(result);
      throw Error("请求已取消");
    }
    return result;
  } finally { signal.removeEventListener("abort", cancel); }
}

export function serviceIdentity(signal: AbortSignal): Promise<ServiceIdentity> {
  const requestId = crypto.randomUUID();
  return invokeService("chatgpt_service_identity", requestId, { requestId }, signal);
}

export function cloudServiceIdentity(signal: AbortSignal): Promise<ServiceIdentity> {
  const requestId = crypto.randomUUID();
  return invokeService("cloud_service_identity", requestId, { requestId }, signal);
}

export async function cloudServiceAccess(signal: AbortSignal): Promise<CloudAccess> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<CloudAccess>("cloud_service_access", requestId, { requestId }, signal);
  if (!result?.identity?.accountId || !result.identity.userId || !Number.isInteger(result.identity.generation) ||
    !["personal-plan-branch", "incomplete"].includes(result.gateEvidence)) throw Error("无法确认云端环境访问资格，请重试。");
  return result;
}

function responseBody(result: { requestId: string; identity: ServiceIdentity; body: unknown }, requestId: string, identity: ServiceIdentity): unknown {
  if (result.requestId !== requestId || result.identity.accountId !== identity.accountId ||
    result.identity.userId !== identity.userId || result.identity.generation !== identity.generation) {
    throw Error("读取期间账号发生变化，请重新刷新。");
  }
  return result.body;
}

export interface ImagesAssetRef {
  assetKey: string;
  sourceRequestId: string;
  role: "init_group" | "styles" | "image_suggestions" | "recent";
  id: string;
  groupId: string | null;
  variant: 0;
}

export interface GptAssetRef { assetKey: string; sourceRequestId: string; id: string }

/** Avatar grants come from the host's GPT metadata response, never from a renderer URL. */
export async function readGptsMetadata(
  operation: "gpts_discovery" | "gpts_category" | "gpts_search" | "gpts_detail", params: Record<string, unknown>,
  identity: ServiceIdentity, signal: AbortSignal,
): Promise<{ body: unknown; assets: GptAssetRef[] }> {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown; gptAssets?: unknown }>(
    "chatgpt_service_read", requestId,
    { request: { requestId, operation, params, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  const body = responseBody(result, requestId, identity);
  if (!Array.isArray(result.gptAssets)) throw Error("GPT 头像引用缺失，请重试。");
  const keys = new Set<string>();
  const valid = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
  for (const ref of result.gptAssets) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || !valid(ref.assetKey) || !valid(ref.id)
      || ref.sourceRequestId !== requestId || keys.has(ref.assetKey)) throw Error("GPT 头像引用无效，请重试。");
    keys.add(ref.assetKey);
  }
  return { body, assets: result.gptAssets };
}

export interface SiteAssetRef { assetKey: string; sourceRequestId: string; id: string }

export async function readSitesMetadata(
  operation: "sites_list" | "sites_shared" | "sites_pinned" | "sites_detail", params: Record<string, unknown>,
  identity: ServiceIdentity, signal: AbortSignal,
): Promise<{ body: unknown; assets: SiteAssetRef[] }> {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown; siteAssets?: unknown }>(
    "chatgpt_service_read", requestId,
    { request: { requestId, operation, params, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  const body = responseBody(result, requestId, identity);
  if (!Array.isArray(result.siteAssets)) throw Error("站点截图引用缺失，请重试。");
  const keys = new Set<string>();
  const valid = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
  for (const ref of result.siteAssets) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || !valid(ref.assetKey) || !valid(ref.id)
      || ref.sourceRequestId !== requestId || keys.has(ref.assetKey)) throw Error("站点截图引用无效，请重试。");
    keys.add(ref.assetKey);
  }
  return { body, assets: result.siteAssets };
}

export async function readSiteAsset(ref: SiteAssetRef, identity: ServiceIdentity, signal: AbortSignal): Promise<string> {
  const body = await readChatgptService("sites_asset", { asset_key: ref.assetKey, source_request_id: ref.sourceRequestId }, identity, signal) as { dataUrl?: unknown };
  if (typeof body?.dataUrl !== "string" || body.dataUrl.length > 12 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(body.dataUrl)) throw Error("站点截图无效，请重试。");
  return body.dataUrl;
}

export async function writeSitePin(id: string, pinned: boolean, identity: ServiceIdentity, signal: AbortSignal): Promise<{ project_id: string; is_pinned: boolean }> {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "chatgpt_service_site_pin", requestId,
    { request: { requestId, id, pinned, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  const body = responseBody(result, requestId, identity) as { project_id?: unknown; is_pinned?: unknown };
  if (body?.project_id !== id || typeof body.is_pinned !== "boolean") throw Error("置顶结果未知，请先重新读取置顶状态。");
  return { project_id: id, is_pinned: body.is_pinned };
}

export interface SiteTitleWrite { title: string; updated_at: string }
export interface SiteEnvironmentPatch {
  remove: string[];
  set_values: { is_secret: boolean; key: string; type: "envvar"; value: string }[];
}
export interface SiteEnvironmentSnapshot {
  entries: { is_secret: boolean; key: string; type: "envvar"; value: string | null }[];
  project_id: string;
  revision: number;
  updated_at: string | null;
  requires_secrets?: boolean;
}

async function writeSiteSettings(
  id: string, mutation: { operation: "title"; title: string } | ({ operation: "environment" } & SiteEnvironmentPatch) | { operation: "slug_availability" | "slug"; slug: string } | SiteDomainMutation | { operation: "share_access"; access_mode: "custom" | "workspace_all" | "public" } | SiteSharingMemberMutation,
  identity: ServiceIdentity, signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "chatgpt_service_sites_settings", requestId,
    { request: { requestId, id, mutation, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  return responseBody(result, requestId, identity);
}
export type SiteDomainMutation = { operation: "domain_add"; hostname: string } | { operation: "domain_refresh" | "domain_remove"; domain_id: string };
export type SiteSharingWriteResult = (Record<string, unknown> & { status: "pending" | "accepted" }) | null;
export type SiteSharingMemberMutation = { operation: "share_recipient"; recipient: string; recipient_type: "user" | "group"; role: "viewer" | "editor" | null } | { operation: "share_email_remove" | "share_email_invite"; email: string };
function sharingWriteResult(body: unknown): SiteSharingWriteResult {
  if (body === null) return null;
  if (!body || typeof body !== "object" || Array.isArray(body) || !["pending", "accepted"].includes((body as { status: string }).status)) throw Error("共享操作结果未确认，请刷新权限。");
  return body as Exclude<SiteSharingWriteResult, null>;
}
export async function writeSiteSharingAccess(id: string, mode: "custom" | "workspace_all" | "public", identity: ServiceIdentity, signal: AbortSignal): Promise<SiteSharingWriteResult> {
  return sharingWriteResult(await writeSiteSettings(id, { operation: "share_access", access_mode: mode }, identity, signal));
}
export async function writeSiteSharingRecipient(id: string, mutation: SiteSharingMemberMutation, identity: ServiceIdentity, signal: AbortSignal): Promise<SiteSharingWriteResult> {
  if (mutation.operation === "share_recipient") {
    if (!mutation.recipient || !["user", "group"].includes(mutation.recipient_type) || ![null, "viewer", "editor"].includes(mutation.role)
      || mutation.recipient_type === "group" && mutation.role === "editor") throw Error("共享成员操作无效。");
  } else if (!["share_email_remove", "share_email_invite"].includes(mutation.operation) || !mutation.email) throw Error("共享成员操作无效。");
  return sharingWriteResult(await writeSiteSettings(id, mutation, identity, signal));
}
export async function writeSiteDomain(id: string, mutation: SiteDomainMutation, identity: ServiceIdentity, signal: AbortSignal): Promise<SiteDomain> {
  const body = await writeSiteSettings(id, mutation, identity, signal);
  const domain = parseSiteDomains({ items: [body] }, id)[0];
  if (mutation.operation !== "domain_add" && domain.id !== mutation.domain_id) throw Error("域名返回与请求不符，请先重新读取配置。");
  return domain;
}
export interface SiteSlugAvailability { slug: string; available: boolean }
export interface SiteSlugChange { requestedSlug: string; status: "pending" | "complete" }
export async function readSiteSlugAvailability(id: string, slug: string, identity: ServiceIdentity, signal: AbortSignal): Promise<SiteSlugAvailability> {
  const body = await writeSiteSettings(id, { operation: "slug_availability", slug }, identity, signal) as { slug?: unknown; available?: unknown };
  if (!body || body.slug !== slug || typeof body.available !== "boolean") throw Error("站点 URL 可用性返回无效，请重试。");
  return { slug, available: body.available };
}
export async function writeSiteSlug(id: string, slug: string, identity: ServiceIdentity, signal: AbortSignal): Promise<SiteSlugChange> {
  const body = await writeSiteSettings(id, { operation: "slug", slug }, identity, signal) as { slug_change?: { requested_slug?: unknown; status?: unknown } };
  const change = body?.slug_change;
  if (!change || change.requested_slug !== slug || (change.status !== "pending" && change.status !== "complete")) throw Error("站点 URL 更改结果未知，请先重新读取站点。");
  return { requestedSlug: slug, status: change.status };
}

export async function writeSiteTitle(id: string, title: string, identity: ServiceIdentity, signal: AbortSignal): Promise<SiteTitleWrite> {
  const body = await writeSiteSettings(id, { operation: "title", title: title.trim() }, identity, signal) as SiteTitleWrite;
  if (!body || typeof body.title !== "string" || typeof body.updated_at !== "string") throw Error("名称保存结果未知，请先重新读取站点。");
  return body;
}

export async function writeSiteEnvironment(id: string, patch: SiteEnvironmentPatch, identity: ServiceIdentity, signal: AbortSignal): Promise<SiteEnvironmentSnapshot> {
  const body = await writeSiteSettings(id, { operation: "environment", ...patch }, identity, signal) as SiteEnvironmentSnapshot;
  if (!body || body.project_id !== id || typeof body.revision !== "number" || !Number.isFinite(body.revision)
    || (body.updated_at !== null && typeof body.updated_at !== "string")
    || (body.requires_secrets !== undefined && typeof body.requires_secrets !== "boolean") || !Array.isArray(body.entries)
    || body.entries.some(entry => !entry || typeof entry.key !== "string" || typeof entry.is_secret !== "boolean" || entry.type !== "envvar"
      || (entry.value !== null && typeof entry.value !== "string"))) throw Error("环境变量保存结果未知，请先重新读取配置。");
  return body;
}

export function isImagesAssetRef(value: unknown): value is ImagesAssetRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as ImagesAssetRef;
  const identifier = (text: unknown) => typeof text === "string" && text.length > 0 && text.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/u.test(text);
  return identifier(ref.assetKey) && identifier(ref.sourceRequestId) && identifier(ref.id) && ref.variant === 0
    && ["init_group", "styles", "image_suggestions", "recent"].includes(ref.role)
    && (ref.role === "init_group" ? identifier(ref.groupId) : ref.groupId === null);
}

/** Opaque host-issued image references; metadata URLs never authorize a download. */
export async function readImagesMetadata(
  operation: "images_init" | "images_styles" | "images_recent", params: Record<string, unknown>,
  identity: ServiceIdentity, signal: AbortSignal,
): Promise<{ body: unknown; assets: ImagesAssetRef[] }> {
  if (signal.aborted) throw Error("请求已取消");
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown; assets?: unknown }>(
    "chatgpt_service_read", requestId,
    { request: { requestId, operation, params, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  const body = responseBody(result, requestId, identity);
  if (!Array.isArray(result.assets)) throw Error("图像资源引用缺失，请重试。");
  const roles = operation === "images_init" ? ["init_group"] : operation === "images_styles" ? ["styles", "image_suggestions"] : ["recent"];
  const keys = new Set<string>();
  for (const ref of result.assets) {
    if (!isImagesAssetRef(ref) || ref.sourceRequestId !== requestId || !roles.includes(ref.role)) throw Error("图像资源引用无效，请重试。");
    if (keys.has(ref.assetKey)) throw Error("图像资源引用重复，请重试。");
    keys.add(ref.assetKey);
  }
  return { body, assets: result.assets };
}

export async function readCloudService(
  operation: "list" | "detail" | "draft", params: Record<string, unknown>, identity: ServiceIdentity, signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw Error("请求已取消");
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "cloud_service_read", requestId, { request: { requestId, operation, params, expectedIdentity: identity } }, signal,
  );
  return responseBody(result, requestId, identity);
}

export type CloudThreadOperation =
  | { kind: "read"; threadId: string }
  | { kind: "resume"; params: ReturnType<typeof import("./cloudDraftResume").cloudDraftResumeParams>; timeoutSeconds?: 120 | 240 | 480 }
  | { kind: "title"; threadId: string; name: string }
  | { kind: "turns"; threadId: string; cursor: string | null; limit: number }
  | { kind: "items"; threadId: string; turnId: string; cursor: string | null; limit: number }
  | { kind: "start_repository_apply"; threadId: string; clientUserMessageId: string; serviceTier: string | null; added: string[]; removed: string[] }
  | { kind: "start_environment_setup"; threadId: string; clientUserMessageId: string; cwd: string;
    model: string | null; effort: string | null; serviceTier: string | null; repositories: { name: string; ref: string }[];
    skill: string | null; privateDraft: boolean }
  | { kind: "start_environment_reply"; threadId: string; clientUserMessageId: string; cwd: string; text: string;
    model: string | null; effort: string | null; serviceTier: string | null }
  | { kind: "preferences" | "setup_preferences" | "requirements" };

export async function callCloudThread(operation: CloudThreadOperation, identity: ServiceIdentity, signal: AbortSignal): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; hostId: string; body: unknown }>(
    "cloud_service_thread", requestId, { request: { requestId, operation, expectedIdentity: identity } }, signal,
  );
  if (result.hostId !== "durable") throw Error("云端会话宿主不匹配。");
  return responseBody(result, requestId, identity);
}

export async function readCloudSetupModels(identity: ServiceIdentity, signal: AbortSignal): Promise<ModelInfo[]> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; hostId: string; body: unknown }>(
    "cloud_service_models", requestId, { request: { requestId, cursor: null, expectedIdentity: identity } }, signal,
  );
  if (result.hostId !== "durable") throw Error("云端会话宿主不匹配。");
  const body = responseBody(result, requestId, identity) as { data?: ModelInfo[] } | null;
  if (!Array.isArray(body?.data)) throw Error("无法读取云端模型。");
  return body.data;
}

export async function createCloudEnvironmentConfig(
  name: string, repositories: { repositoryId: string; ref: string }[], identity: ServiceIdentity, signal: AbortSignal,
) {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; receipt: {
    config_id: string; name: string; version_id: string; environment_id: string | null;
    thread_id: string | null; draft_id: string | null; onboarding_skill: string | null;
  } }>("cloud_service_create_config", requestId, {
    request: { requestId, name, repositories, expectedIdentity: identity },
  }, signal);
  const receipt = responseBody({ ...result, body: result.receipt }, requestId, identity) as typeof result.receipt | null;
  if (!receipt || ![receipt.config_id, receipt.name, receipt.version_id].every(value => typeof value === "string" && value.trim())
    || ![receipt.environment_id, receipt.thread_id, receipt.draft_id, receipt.onboarding_skill]
      .every(value => value === null || (typeof value === "string" && value.trim()))) {
    throw { code: "cloud_config_unconfirmed" };
  }
  return receipt;
}

export async function createCloudDraftReceipt(configId: string, identity: ServiceIdentity, signal: AbortSignal) {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; receipt: {
    draft_id: string; environment_id: string; thread_id: string | null;
  } }>("cloud_service_create_draft", requestId, { request: { requestId, configId, expectedIdentity: identity } }, signal);
  const receipt = responseBody({ ...result, body: result.receipt }, requestId, identity) as typeof result.receipt | null;
  if (!receipt || ![receipt.draft_id, receipt.environment_id].every(value => typeof value === "string" && value.trim())
    || (receipt.thread_id !== null && (typeof receipt.thread_id !== "string" || !receipt.thread_id.trim()))) {
    throw { code: "cloud_draft_unconfirmed" };
  }
  return { draftId: receipt.draft_id, environmentId: receipt.environment_id, threadId: receipt.thread_id };
}

export async function createCloudDraft(configId: string, identity: ServiceIdentity, signal: AbortSignal) {
  const { draftId, environmentId, threadId } = await createCloudDraftReceipt(configId, identity, signal);
  if (threadId === null) throw { code: "cloud_draft_unconfirmed" };
  return { draftId, environmentId, threadId };
}

export async function saveCloudDraftFields(request: {
  configId: string; draftId: string; baseVersionId: string; expectedRevision: number;
  installScript?: string; startSkill?: string; networkPolicy?: CloudNetworkPolicy;
  repositories?: { repository_id: string; ref: string; depth?: number }[];
  metadata?: { name?: string; description?: string; shareSettings?: "private" | "workspace" };
}, identity: ServiceIdentity, signal: AbortSignal): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "cloud_service_save_draft", requestId, { request: { ...request, requestId, expectedIdentity: identity } }, signal,
  );
  return responseBody(result, requestId, identity);
}

export async function readChatgptService(
  operation: ServiceOperation, params: Record<string, unknown>, identity: ServiceIdentity, signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw Error("请求已取消");
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "chatgpt_service_read", requestId,
    { request: { requestId, operation, params, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  return responseBody(result, requestId, identity);
}

// Archive task HTTP-empty responses carry source semantics; the body-only reader loses them.
export async function readArchiveCloudTasksPage(
  cursor: string | null, identity: ServiceIdentity, signal: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  if (signal.aborted) throw Error("请求已取消");
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; status: number; body: unknown }>(
    "chatgpt_service_read", requestId,
    { request: { requestId, operation: "archive_cloud_tasks", params: { cursor }, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  let body: unknown;
  try { body = responseBody(result, requestId, identity); }
  catch { throw Object.assign(Error("读取期间账号发生变化，请重新刷新。"), { code: "account_changed" }); }
  if (!Number.isInteger(result.status) || !((result.status >= 200 && result.status < 300)
    || ([401, 403, 404].includes(result.status) && body === null))) throw Error("云端归档响应状态无效，请重试。");
  return { status: result.status, body };
}

export type ArchiveConversationAccess = { status: "allowed"; includeWorkCloud: boolean }
  | { status: "denied"; includeWorkCloud: null };

// The host resolves the current account's scope; the renderer never supplies it.
export async function readArchiveConversationsPage(
  offset: number, identity: ServiceIdentity, signal: AbortSignal,
): Promise<{ access: ArchiveConversationAccess; body: unknown }> {
  if (signal.aborted) throw Error("请求已取消");
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error("聊天归档分页位置无效。");
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; access: ArchiveConversationAccess; body: unknown }>(
    "archive_conversations_read", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile(), offset } }, signal,
  );
  let body: unknown;
  try { body = responseBody(result, requestId, identity); }
  catch { throw Object.assign(Error("读取期间账号发生变化，请重新刷新。"), { code: "account_changed" }); }
  const access = result.access;
  if (!access || !(access.status === "allowed" && typeof access.includeWorkCloud === "boolean" && body !== null && typeof body === "object" && !Array.isArray(body)
    || access.status === "denied" && access.includeWorkCloud === null && body === null)) {
    throw Error("聊天归档资格响应无效，请重试。");
  }
  return { access, body };
}

export interface ProfileMutationResult {
  verification: "confirmed" | "pending" | "not_applicable";
  body: unknown;
  readback: unknown;
}

export type ArchiveCloudSource = "cloud-task" | "chatgpt-conversation";

export async function deleteCloudArchiveItem(
  source: ArchiveCloudSource, targetId: string, identity: ServiceIdentity, signal: AbortSignal,
): Promise<"accepted" | "already-absent"> {
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  if (!["cloud-task", "chatgpt-conversation"].includes(source) || typeof targetId !== "string" || !targetId.trim()
    || targetId === "." || targetId === ".." || /[\u0000-\u001f\u007f-\u009f]/.test(targetId) || new TextEncoder().encode(targetId).length > 2048) {
    throw Object.assign(Error("删除目标无效。"), { code: "invalid_request" });
  }
  const requestId = crypto.randomUUID(), profile = browserProfile();
  const unknown = () => Object.assign(Error("删除结果尚未确认，请先刷新列表。"), { code: "archive_write_unknown" });
  let result: { requestId: string; identity: ServiceIdentity; status: "accepted" | "already-absent" };
  try {
    result = await invokeService("archive_delete", requestId,
      { request: { requestId, expectedIdentity: identity, profile, source, targetId } }, signal);
  } catch (error) {
    if (!(error as { code?: string })?.code) throw unknown();
    throw error;
  }
  if (!result || result.requestId !== requestId || result.identity?.accountId !== identity.accountId
    || result.identity?.userId !== identity.userId || result.identity?.generation !== identity.generation
    || !["accepted", "already-absent"].includes(result.status)) throw unknown();
  return result.status;
}

// An accepted write is not an independent readback of the conversation.
export async function unarchiveCloudItem(
  source: ArchiveCloudSource, targetId: string, identity: ServiceIdentity, signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  if (!["cloud-task", "chatgpt-conversation"].includes(source) || typeof targetId !== "string" || !targetId.trim()
    || targetId === "." || targetId === ".." || /[\u0000-\u001f\u007f-\u009f]/.test(targetId) || new TextEncoder().encode(targetId).length > 2048) {
    throw Object.assign(Error("取消归档目标无效。"), { code: "invalid_request" });
  }
  const requestId = crypto.randomUUID(), profile = browserProfile();
  const unknown = () => Object.assign(Error("取消归档结果尚未确认，请先刷新列表。"), { code: "archive_write_unknown" });
  let result: { requestId: string; identity: ServiceIdentity; status: "accepted" };
  try {
    result = await invokeService("archive_unarchive", requestId,
      { request: { requestId, expectedIdentity: identity, profile, source, targetId } }, signal);
  } catch (error) {
    if (!(error as { code?: string })?.code) throw unknown();
    throw error;
  }
  if (!result || result.requestId !== requestId || result.identity?.accountId !== identity.accountId
    || result.identity?.userId !== identity.userId || result.identity?.generation !== identity.generation || result.status !== "accepted") throw unknown();
}

export async function readAccountNotifications(identity: ServiceIdentity, signal: AbortSignal): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "account_notifications_read", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  return responseBody(result, requestId, identity);
}

export async function writeAccountNotification(category: string, channel: string, enabled: boolean,
  identity: ServiceIdentity, signal: AbortSignal): Promise<ProfileMutationResult> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<ProfileMutationResult & { requestId: string; identity: ServiceIdentity }>(
    "account_notifications_write", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile(), category, channel, enabled } }, signal,
  );
  responseBody(result, requestId, identity);
  if (!["confirmed", "pending"].includes(result.verification)) throw Error("无法确认通知设置保存状态，请重新读取。");
  return result;
}

export type RemotePluginOperation = "enable" | "disable" | "uninstall";
export interface RemotePluginMutationResult {
  pluginId: string; operation: RemotePluginOperation; body: unknown;
  plugins: unknown[] | null; verification: "confirmed" | "pending";
  delivery: "accepted" | "unknown"; warningCode: string | null;
}

export async function readRemotePluginInventory(identity: ServiceIdentity, signal: AbortSignal): Promise<unknown[]> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; plugins: unknown[] }>(
    "remote_plugin_inventory", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile(), includeExtensions: true } }, signal,
  );
  responseBody({ ...result, body: null }, requestId, identity);
  if (!Array.isArray(result.plugins)) throw Error("无法确认远程插件完整库存，请重新读取。");
  return result.plugins;
}

export async function mutateRemotePlugin(
  pluginId: string, operation: RemotePluginOperation, identity: ServiceIdentity, signal: AbortSignal,
): Promise<RemotePluginMutationResult> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<RemotePluginMutationResult & { requestId: string; identity: ServiceIdentity }>(
    "remote_plugin_mutation", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile(), pluginId, operation } }, signal,
  );
  responseBody(result, requestId, identity);
  if (result.pluginId !== pluginId || result.operation !== operation ||
    !["confirmed", "pending"].includes(result.verification) || !["accepted", "unknown"].includes(result.delivery) ||
    (result.plugins !== null && !Array.isArray(result.plugins))) throw Error("无法确认远程插件变更结果，请先重新读取。");
  return result;
}

export async function mutateAccountProfile(
  operation: "account_name" | "username_check" | "username" | "profile", params: Record<string, unknown>,
  identity: ServiceIdentity, signal: AbortSignal,
): Promise<ProfileMutationResult> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<ProfileMutationResult & { requestId: string; identity: ServiceIdentity }>(
    "profile_mutation", requestId, { request: { requestId, operation, params, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  responseBody(result, requestId, identity);
  if (!["confirmed", "pending", "not_applicable"].includes(result.verification)) throw Error("无法确认资料保存状态，请重新读取。");
  return result;
}

export interface SharedThreadPreparation { preparationId: string; identity: ServiceIdentity }
export interface SharedThreadPublication { shareId: string; shareUrl: string }
export interface SharedThreadAsset { assetId: string; mimeType: string; bytesBase64: string }
export interface SharedThreadAudience {
  access: "public" | "workspace" | "invited";
  principals: { principal_id: string; principal_type: "user" | "group" }[];
}

export function discardSharedThread(preparationId: string, identity: ServiceIdentity): Promise<void> {
  return tauriInvoke("share_thread_discard", { preparationId, expectedIdentity: identity });
}

export function sharedImageUrlSafe(url: string, identity: ServiceIdentity, signal: AbortSignal): Promise<boolean> {
  const requestId = crypto.randomUUID();
  return invokeService<boolean>("share_thread_url_safe", requestId, {
    request: { requestId, expectedIdentity: identity, profile: browserProfile(), url },
  }, signal).then(safe => safe === true);
}

export function shareAccessBootstrap(identity: ServiceIdentity, signal: AbortSignal): Promise<unknown> {
  const requestId = crypto.randomUUID();
  return invokeService("share_thread_access", requestId, {
    request: { requestId, expectedIdentity: identity, profile: browserProfile() },
  }, signal);
}

function reviewProviderResponse(result: { requestId: string; identity: ServiceIdentity; body: unknown }, requestId: string, identity: ServiceIdentity): ReviewProviderAccess {
  const body = responseBody(result, requestId, identity) as Omit<ReviewProviderAccess, "identity">;
  if (!body || !body.capabilities ||
    ![body.capabilities.githubInstances, body.capabilities.gitlab, body.capabilities.reviewTabDefault].every(value => value === null || typeof value === "boolean") ||
    (body.githubConnectionsError !== null && typeof body.githubConnectionsError !== "string") ||
    (body.capabilities.githubInstances === true
      ? !(Array.isArray(body.githubConnections) && body.githubConnectionsError === null) && !(body.githubConnections === null && typeof body.githubConnectionsError === "string" && body.githubConnectionsError.length > 0)
      : body.githubConnections !== null || body.githubConnectionsError !== null) ||
    (body.capabilities.gitlab === true
      ? !(Array.isArray(body.gitlabInstances) && body.gitlabInstancesError === null) && !(body.gitlabInstances === null && typeof body.gitlabInstancesError === "string" && body.gitlabInstancesError.length > 0)
      : body.gitlabInstances !== null || body.gitlabInstancesError !== null) ||
    (Array.isArray(body.gitlabInstances) && (body.gitlabInstances.some(item => !item ||
      ![item.connectorId, item.hostname].every(value => typeof value === "string" && value.length > 0) ||
      (item.name !== undefined && item.name !== null && typeof item.name !== "string")) ||
      new Set(body.gitlabInstances.map(item => item.connectorId)).size !== body.gitlabInstances.length)) ||
    !body.preferences || typeof body.preferences.gitHostingProvider !== "string" ||
    (body.preferences.gitlabConnectorId !== null && typeof body.preferences.gitlabConnectorId !== "string") ||
    (body.preferences.githubConnection !== null && (!body.preferences.githubConnection ||
      ![body.preferences.githubConnection.hostname, body.preferences.githubConnection.connectorId, body.preferences.githubConnection.accountLinkId].every(value => typeof value === "string" && value.length > 0)))) {
    throw Error("代码审查提供商响应格式无效。");
  }
  return { ...body, identity };
}

export async function readReviewProviderAccess(identity: ServiceIdentity, signal: AbortSignal): Promise<ReviewProviderAccess> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "code_review_provider_read", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile() } }, signal,
  );
  return reviewProviderResponse(result, requestId, identity);
}

export async function readRemotePullRequest(url: string, identity: ServiceIdentity, signal: AbortSignal): Promise<RemotePullRequest> {
  const target = parseRemotePullRequestUrl(url);
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "code_review_pull_request_read", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile() }, url: target.url }, signal,
  );
  return parseRemotePullRequest(responseBody(result, requestId, identity), target.url);
}

export async function readPinnedReviewComparison(url: string, identity: ServiceIdentity, signal: AbortSignal,
  snapshotId: string | null = null, commitSha: string | null = null): Promise<PinnedReviewComparison> {
  const target = parseRemotePullRequestUrl(url);
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "code_review_comparison_read", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile() }, url: target.url, snapshotId, commitSha }, signal,
  );
  return parsePinnedReviewComparison(responseBody(result, requestId, identity), target.url, snapshotId, commitSha);
}

export async function readPinnedReviewFile(url: string, identity: ServiceIdentity, signal: AbortSignal,
  snapshotId: string, commitSha: string | null, basePath: string | null, headPath: string | null): Promise<PinnedReviewFile> {
  const target = parseRemotePullRequestUrl(url);
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "code_review_revision_file_read", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile() }, url: target.url, snapshotId, commitSha, basePath, headPath }, signal,
  );
  return parsePinnedReviewFile(responseBody(result, requestId, identity), target.url, snapshotId, commitSha);
}

export function readPrivateReviewPreflight(url: string, snapshotId: string, commitSha: string | null,
  identity: ServiceIdentity, reviewId: string): Promise<unknown> {
  const target = parseRemotePullRequestUrl(url);
  return tauriInvoke("code_review_private_preflight", { request: { requestId: crypto.randomUUID(), expectedIdentity: identity,
    profile: browserProfile() }, url: target.url, snapshotId, commitSha, modelId: null, reviewId });
}

export function cancelPrivateReviewRequest(reviewId: string): Promise<boolean> {
  return tauriInvoke("code_review_private_cancel", { reviewId });
}

export async function updateReviewProviderPreference<K extends keyof ReviewProviderPreferences>(
  field: K, value: ReviewProviderPreferences[K], identity: ServiceIdentity, signal: AbortSignal, expectedValue: ReviewProviderPreferences[K],
): Promise<ReviewProviderAccess> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<{ requestId: string; identity: ServiceIdentity; body: unknown }>(
    "code_review_provider_update", requestId,
    { request: { requestId, expectedIdentity: identity, profile: browserProfile() }, field, value, expectedValue }, signal,
  );
  const access = reviewProviderResponse(result, requestId, identity);
  const actualConnection = access.preferences.githubConnection;
  const matches = field === "githubConnection"
    ? value === null ? actualConnection === null : actualConnection !== null &&
      (["hostname", "connectorId", "accountLinkId"] as const).every(key => actualConnection[key] === (value as NonNullable<ReviewProviderPreferences["githubConnection"]>)[key])
    : access.preferences[field] === (field === "gitlabConnectorId" && typeof value === "string" ? value.trim() : value);
  if (!matches) throw Error("提供商设置保存后读回不一致。");
  return access;
}

export async function prepareSharedThread(
  threadId: string, snapshot: string, assets: SharedThreadAsset[],
  identity: ServiceIdentity, signal: AbortSignal,
): Promise<SharedThreadPreparation> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<SharedThreadPreparation>("share_thread_prepare", requestId, {
    request: {
      requestId, expectedIdentity: identity, profile: browserProfile(),
      hostId: "local", threadId, snapshot, assets,
    },
  }, signal, async result => {
    if (result?.preparationId && result.identity) await discardSharedThread(result.preparationId, result.identity);
  });
  if (!result?.preparationId || result.identity?.accountId !== identity.accountId ||
    result.identity.userId !== identity.userId || result.identity.generation !== identity.generation) {
    throw Error("准备分享期间账号发生变化，请重新打开分享。");
  }
  return result;
}

export async function publishSharedThread(
  threadId: string, preparation: SharedThreadPreparation, audience: SharedThreadAudience,
  signal: AbortSignal,
): Promise<SharedThreadPublication> {
  const requestId = crypto.randomUUID();
  const result = await invokeService<SharedThreadPublication>("share_thread_publish", requestId, {
    request: {
      requestId, expectedIdentity: preparation.identity, profile: browserProfile(),
      hostId: "local", threadId, preparationId: preparation.preparationId, ...audience,
    },
  }, signal);
  if (!result?.shareId || !result.shareUrl) throw Error("分享服务未返回可用链接。");
  const url = new URL(result.shareUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw Error("分享服务返回了无效链接。");
  return result;
}

export function serviceErrorMessage(error: unknown): string {
  const value = error as { code?: string; status?: number; message?: string };
  const messages: Record<string, string> = {
    not_logged_in: "请先登录 ChatGPT 账号。", auth_unavailable: "暂时无法读取登录状态，请重试。",
    invalid_auth: "当前认证不支持此服务，请重新登录 ChatGPT 账号。", auth_expired: "登录已过期，请重新登录。",
    unauthorized: "服务未接受当前登录，请重新登录后重试。", not_found: "此资源不存在或已不可用。",
    invalid_response: "服务返回了无法识别的数据。", transport_error: "服务连接失败，请检查网络后重试。",
    conflict: "账号或资源在读取期间发生变化，请刷新。", service_error: "服务暂时不可用，请稍后重试。",
    redirect_rejected: "服务返回了不支持的跳转，请重试。",
    login_required: "请先登录 ChatGPT 账号。", unsupported_auth: "当前登录方式不支持此服务。",
    account_changed: "读取期间账号发生变化，请重新刷新。", routing_unavailable: "账号服务路由暂不可用，请重新登录或重试。",
    forbidden: "当前账号无权访问此服务。", rate_limited: "请求过于频繁，请稍后重试。",
    cancelled: "请求已取消。", transport_unavailable: "系统 HTTP 组件不可用。",
    cloud_draft_unconfirmed: "无法确认环境草稿，请先检查聊天列表。",
    cloud_config_unconfirmed: "环境创建结果尚未确认，请先核对环境列表。",
    cloud_config_pending: "此账号已有正在处理或尚未确认的环境创建请求。",
    cloud_draft_save_unconfirmed: "保存结果尚未确认，请先核对服务端草稿。",
    cloud_repository_apply_unconfirmed: "应用消息的投递结果尚未确认。",
    cloud_setup_turn_unconfirmed: "设置消息的投递结果尚未确认，请先核对会话。",
    cloud_setup_reply_unconfirmed: "回复的投递结果尚未确认，请先核对会话。",
    cloud_draft_pending: "此环境已有正在处理或尚未确认的草稿请求，请检查聊天列表。",
    cloud_resume_timeout: "恢复云端会话超时。", cloud_thread_closing: "云端会话正在关闭。",
    network_error: "服务连接失败，请检查网络后重试。", timeout: "服务请求超时，请重试。",
    desktop_context_unavailable: "应用服务尚未连接，请连接后重试。",
    publish_unknown: "无法确认分享是否已发布。为避免重复发布，请先检查已有分享。",
    profile_write_unknown: "无法确认资料是否已保存。请先重新读取核验，避免重复提交。",
    notifications_account_unavailable: "无法加载你的账户信息。",
    notifications_write_unknown: "无法确认通知设置是否已保存。请先重新读取核验，避免重复提交。",
    notifications_readback_failed: "通知设置已提交，但读取失败。请重新读取核验。",
    profile_name_rejected: "显示名称未通过审核。请换一个名称重试。",
    profile_bio_rejected: "简介未通过审核。请修改后重试。",
    profile_photo_rejected: "头像未通过审核。请换一张图片重试。",
    share_audience_changed: "此分享的访问范围已改变，请重新准备分享。",
    share_missing: "分享准备已失效，请重新打开分享。",
    share_busy: "分享正在发布，请稍候。",
    network_policy_unavailable: "无法读取组织网络策略，请重试。",
    archive_access_unknown: "暂时无法确认当前账号的聊天归档资格，请重试。",
    archive_scope_changed: "归档读取范围已变化，请从首页重新读取。",
    archive_write_unknown: "归档变更结果尚未确认，请先刷新列表后再决定是否重试。",
    network_restricted: "组织网络策略不允许访问此目标。",
    plugin_busy: "该插件正在执行另一项操作，请稍后重新读取。",
    plugin_write_unknown: "无法确认插件变更是否已送达，请先只读核验，避免重复提交。",
    plugin_readback_unavailable: "插件变更已提交，但完整库存读取失败，请只读核验。",
  };
  return (value?.code && messages[value.code]) || value?.message || "暂时无法读取服务，请重试。";
}
