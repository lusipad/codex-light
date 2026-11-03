import { tauriInvoke } from "./bridge";
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
export type ServiceOperation = "library_favorites" | "library_nodes" | "images_init" | "images_styles" |
  "images_recent" | "gpts_discovery" | "gpts_category" | "gpts_search" | "gpts_detail" | "gpts_about" |
  "sites_access" | "sites_list" | "sites_shared" | "sites_detail" | "sites_environment" | "sites_domains" | "sites_share_access" | "github_repository" |
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

export interface ProfileMutationResult {
  verification: "confirmed" | "pending" | "not_applicable";
  body: unknown;
  readback: unknown;
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
    network_error: "服务连接失败，请检查网络后重试。", timeout: "服务请求超时，请重试。",
    desktop_context_unavailable: "应用服务尚未连接，请连接后重试。",
    publish_unknown: "无法确认分享是否已发布。为避免重复发布，请先检查已有分享。",
    profile_write_unknown: "无法确认资料是否已保存。请先重新读取核验，避免重复提交。",
    profile_name_rejected: "显示名称未通过审核。请换一个名称重试。",
    profile_bio_rejected: "简介未通过审核。请修改后重试。",
    profile_photo_rejected: "头像未通过审核。请换一张图片重试。",
    share_audience_changed: "此分享的访问范围已改变，请重新准备分享。",
    share_missing: "分享准备已失效，请重新打开分享。",
    share_busy: "分享正在发布，请稍候。",
    network_policy_unavailable: "无法读取组织网络策略，请重试。",
    network_restricted: "组织网络策略不允许访问此目标。",
    plugin_busy: "该插件正在执行另一项操作，请稍后重新读取。",
    plugin_write_unknown: "无法确认插件变更是否已送达，请先只读核验，避免重复提交。",
    plugin_readback_unavailable: "插件变更已提交，但完整库存读取失败，请只读核验。",
  };
  return (value?.code && messages[value.code]) || value?.message || "暂时无法读取服务，请重试。";
}
