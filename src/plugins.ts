/**
 * App-server protocol wrappers for plugins, marketplaces, apps (connectors) and skills.
 *
 * Every call goes through `callAppServer` (src/bridge.ts -> Rust `app_server_call`).
 * The Rust bridge collapses JSON-RPC errors to their `error.message` string, so we
 * re-classify those strings into a small, UI-friendly error model.
 *
 * Browsing omits marketplaceKinds so the server can include the default remote
 * catalog when enabled. The response is not paginated; the view limits rendered
 * cards and caches the result. The default view uses plugin/installed.
 */

import { callAppServer } from "./bridge";

// ─────────────────────────────────────────────────────────────────────────────
// Types (subset of .ref/protocol/v2 Plugin*/Marketplace*/Apps*/Skills* schemas)
// ─────────────────────────────────────────────────────────────────────────────

export type MarketplaceKind =
  | "local"
  | "vertical"
  | "workspace-directory"
  | "shared-with-me"
  | "created-by-me-remote";

export type PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";

export type PluginAuthPolicy = "ON_INSTALL" | "ON_USE";

export type PluginAvailability = "AVAILABLE" | "DISABLED_BY_ADMIN";

export type PluginSource =
  | { type: "local"; path: string }
  | {
      type: "git";
      url: string;
      path?: string | null;
      refName?: string | null;
      sha?: string | null;
    }
  | {
      type: "npm";
      package: string;
      registry?: string | null;
      version?: string | null;
    }
  | { type: "remote" };

export interface PluginInterface {
  displayName?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  developerName?: string | null;
  category?: string | null;
  capabilities?: string[];
  websiteUrl?: string | null;
  privacyPolicyUrl?: string | null;
  termsOfServiceUrl?: string | null;
  defaultPrompt?: string[] | null;
  brandColor?: string | null;
  composerIcon?: string | null;
  composerIconUrl?: string | null;
  logo?: string | null;
  logoDark?: string | null;
  logoUrl?: string | null;
  logoUrlDark?: string | null;
  screenshots?: string[];
  screenshotUrls?: string[];
}

export interface PluginSummary {
  id: string;
  name: string;
  version?: string | null;
  localVersion?: string | null;
  remotePluginId?: string | null;
  remoteServicePlugin?: Record<string, unknown>;
  remotePolicyKnown?: boolean;
  source: PluginSource;
  installed: boolean;
  enabled: boolean;
  installedAt?: number | null;
  installPolicy: PluginInstallPolicy;
  installPolicySource?: string | null;
  mustShowInstallationInterstitial?: boolean | null;
  authPolicy: PluginAuthPolicy;
  availability?: PluginAvailability;
  disabledReason?: string | null;
  eligiblePlanTypes?: string[] | null;
  interface?: PluginInterface | null;
  keywords?: string[];
  shareContext?: unknown;
}

export interface MarketplaceInterface {
  displayName?: string | null;
}

export interface PluginMarketplaceEntry {
  name: string;
  /** Local marketplace.json path; `null` for remote-only catalogs. */
  path?: string | null;
  interface?: MarketplaceInterface | null;
  plugins: PluginSummary[];
}

export interface PluginSearchResponse {
  data: { marketplaceName: string; marketplacePath?: string | null; plugin: PluginSummary }[];
  nextCursor: string | null;
}

export interface MarketplaceLoadErrorInfo {
  marketplacePath: string;
  message: string;
}

/** `plugin/installed` response. */
export interface PluginInstalledResponse {
  marketplaces: PluginMarketplaceEntry[];
  marketplaceLoadErrors?: MarketplaceLoadErrorInfo[];
}

/** `plugin/list` response; the protocol has no pagination cursor. */
export interface PluginListResponse extends PluginInstalledResponse {
  featuredPluginIds?: string[];
}

export interface SkillInterface {
  displayName?: string | null;
  shortDescription?: string | null;
  brandColor?: string | null;
  defaultPrompt?: string | null;
  iconSmall?: string | null;
  iconLarge?: string | null;
  iconSmallUrl?: string | null;
  iconLargeUrl?: string | null;
}

export interface SkillSummary {
  name: string;
  description: string;
  path?: string | null;
  enabled: boolean;
  shortDescription?: string | null;
  interface?: SkillInterface | null;
}

export interface AppSummary {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  installUrl?: string | null;
}

export interface PluginHookSummary {
  eventName: string;
  key: string;
}

/** `plugin/read` response.plugin */
export interface PluginDetail {
  marketplaceName: string;
  marketplacePath?: string | null;
  summary: PluginSummary;
  shareUrl?: string | null;
  description?: string | null;
  skills: SkillSummary[];
  onboardingSkill?: SkillSummary | null;
  hooks: PluginHookSummary[];
  apps: AppSummary[];
  appTemplates?: unknown[];
  mcpServers: string[];
  scheduledTasks?: unknown[] | null;
}

export interface PluginReadResponse {
  plugin: PluginDetail;
}

export interface PluginInstallResponse {
  appsNeedingAuth: AppSummary[];
  authPolicy: PluginAuthPolicy;
}

export interface MarketplaceAddResponse {
  alreadyAdded: boolean;
  installedRoot: string;
  marketplaceName: string;
}

export interface MarketplaceRemoveResponse {
  installedRoot?: string | null;
  marketplaceName: string;
}

export interface MarketplaceUpgradeErrorInfo {
  marketplaceName: string;
  message: string;
}

export interface MarketplaceUpgradeResponse {
  errors: MarketplaceUpgradeErrorInfo[];
  selectedMarketplaces: string[];
  upgradedRoots: string[];
}

// ── Apps / connectors ────────────────────────────────────────────────────────

export interface AppBranding {
  category?: string | null;
  developer?: string | null;
  isDiscoverableApp?: boolean;
  privacyPolicy?: string | null;
  termsOfService?: string | null;
  website?: string | null;
}

export interface AppMetadata {
  categories?: string[] | null;
  developer?: string | null;
  firstPartyRequiresInstall?: boolean | null;
  review?: { status: string } | null;
  seoDescription?: string | null;
  version?: string | null;
  versionNotes?: string | null;
}

/** `app/list` item (`AppInfo`). */
export interface AppInfo {
  id: string;
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  isAccessible?: boolean;
  installUrl?: string | null;
  logoUrl?: string | null;
  logoUrlDark?: string | null;
  labels?: Record<string, string> | null;
  pluginDisplayNames?: string[];
  distributionChannel?: string | null;
  branding?: AppBranding | null;
  appMetadata?: AppMetadata | null;
}

export interface AppsListResponse {
  data: AppInfo[];
  nextCursor?: string | null;
}

/** `app/installed` item (local runtime snapshot, works offline). */
export interface InstalledApp {
  id: string;
  runtimeName?: string | null;
  enabled: boolean;
  callable: boolean;
}

export interface AppsInstalledResponse {
  apps: InstalledApp[];
}

/** Readback facts only; catalog access and runtime callability do not prove OAuth completion. */
export interface PluginPreparationState {
  source: "runtime" | "catalog";
  catalog: AppInfo[];
  installed: InstalledApp[];
}

// ── Skills ───────────────────────────────────────────────────────────────────

export type SkillScope = "user" | "repo" | "system" | "admin" | string;

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  enabled: boolean;
  pluginId?: string | null;
  shortDescription?: string | null;
  interface?: SkillInterface | null;
}

export interface SkillErrorInfo {
  message: string;
  path: string;
}

export interface SkillsListEntry {
  cwd: string;
  skills: SkillMetadata[];
  errors: SkillErrorInfo[];
}

export interface SkillsListResponse {
  data: SkillsListEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Error model
// ─────────────────────────────────────────────────────────────────────────────

export type PluginErrorKind =
  | "forbidden"
  | "auth"
  | "network"
  | "not-connected"
  | "not-found"
  | "invalid-request"
  | "unknown";

export class PluginProtocolError extends Error {
  readonly kind: PluginErrorKind;
  readonly method: string;
  readonly detail: string;

  constructor(method: string, cause: unknown) {
    const detail = describeCause(cause);
    super(`${method} 调用失败: ${detail}`);
    this.name = "PluginProtocolError";
    this.method = method;
    this.detail = detail;
    this.kind = classifyMessage(detail);
  }
}

export function isPluginProtocolError(err: unknown): err is PluginProtocolError {
  return err instanceof PluginProtocolError;
}

export function errorDetail(err: unknown): string {
  if (err instanceof PluginProtocolError) return err.detail;
  return describeCause(err);
}

/** Single-line, HTML-stripped error text suitable for toasts. */
export function errorSummary(err: unknown, maxLength = 220): string {
  const text = errorDetail(err)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

export function classifyAppServerError(err: unknown): PluginErrorKind {
  if (err instanceof PluginProtocolError) return err.kind;
  return classifyMessage(errorDetail(err));
}

/** True for 403/forbidden and auth-gated failures (e.g. `app/list` without ChatGPT connectivity). */
export function isForbiddenError(err: unknown): boolean {
  const kind = classifyAppServerError(err);
  return kind === "forbidden" || kind === "auth";
}

function classifyMessage(detail: string): PluginErrorKind {
  const text = detail.toLowerCase();
  if (/403|forbidden/.test(text)) return "forbidden";
  if (
    /\b401\b|unauthorized|not authenticated|authentication required|login|log in|sign in|requires (an )?(auth|chatgpt)|chatgpt account/.test(
      text
    )
  ) {
    return "auth";
  }
  if (
    /tauri runtime required|app-server (is )?not connected|not connected|connection closed/.test(
      text
    )
  ) {
    return "not-connected";
  }
  if (
    /timed out|timeout|network|econn|enotfound|eai_again|\bdns\b|failed to fetch|connection refused|socket|offline|\b50[234]\b/.test(
      text
    )
  ) {
    return "network";
  }
  if (
    /-32600|invalid request|missing field|unknown variant|requires exactly one|expected one of|must be one of/.test(
      text
    )
  ) {
    return "invalid-request";
  }
  if (/not found|no such|does not exist|unknown plugin|unknown marketplace/.test(text)) {
    return "not-found";
  }
  return "unknown";
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name;
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object") {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    try {
      return JSON.stringify(cause).slice(0, 800);
    } catch {
      return String(cause);
    }
  }
  return String(cause ?? "未知错误");
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    return await callAppServer<T>(method, params);
  } catch (err) {
    throw new PluginProtocolError(method, err);
  }
}

function cwdsParam(cwds?: string[]): Record<string, unknown> {
  return cwds && cwds.length > 0 ? { cwds } : {};
}

function normalizeInstalledResponse(
  raw: PluginInstalledResponse | null | undefined, method: string
): PluginInstalledResponse {
  if (!raw || !Array.isArray(raw.marketplaces)) {
    throw new PluginProtocolError(method, "响应缺少 marketplaces 数组，无法确认安装状态");
  }
  for (const marketplace of raw.marketplaces) {
    if (!marketplace || typeof marketplace.name !== "string" || !marketplace.name.trim() || !Array.isArray(marketplace.plugins)) {
      throw new PluginProtocolError(method, "响应包含无效的市场名称或 plugins 数组");
    }
    for (const plugin of marketplace.plugins) {
      if (!plugin || typeof plugin.id !== "string" || !plugin.id.trim() || typeof plugin.installed !== "boolean") {
        throw new PluginProtocolError(method, "响应包含无效的插件 ID 或 installed 状态");
      }
    }
  }
  if (raw.marketplaceLoadErrors !== undefined) {
    if (!Array.isArray(raw.marketplaceLoadErrors) || raw.marketplaceLoadErrors.some(error =>
      !error || typeof error.marketplacePath !== "string" || !error.marketplacePath.trim() || typeof error.message !== "string"
    )) {
      throw new PluginProtocolError(method, "响应包含无效的 marketplaceLoadErrors");
    }
  }
  return {
    marketplaces: raw.marketplaces,
    marketplaceLoadErrors: raw.marketplaceLoadErrors ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugins
// ─────────────────────────────────────────────────────────────────────────────

/** Reference to one plugin inside a marketplace. `plugin/read` + `plugin/install` accept exactly one of the two marketplace selectors. */
export interface PluginRef {
  pluginName: string;
  marketplacePath?: string | null;
  remoteMarketplaceName?: string | null;
}

/**
 * Default listing for the Plugins tab: `plugin/installed` (~34 KB on a real install).
 */
export async function listInstalledPlugins(cwds?: string[]): Promise<PluginInstalledResponse> {
  const raw = await call<PluginInstalledResponse>("plugin/installed", cwdsParam(cwds));
  return normalizeInstalledResponse(raw, "plugin/installed");
}

/**
 * Browse the server-enabled local and default remote catalog. Do not force
 * marketplace kinds that depend on account capabilities or feature gates.
 */
export async function listMarketplacePlugins(cwds?: string[], forceRefetch = false, marketplaceKinds?: MarketplaceKind[]): Promise<PluginListResponse> {
  const raw = await call<PluginListResponse>("plugin/list", {
    ...cwdsParam(cwds),
    forceRefetch,
    ...(marketplaceKinds ? { marketplaceKinds } : {}),
  });
  return {
    ...normalizeInstalledResponse(raw, "plugin/list"),
    featuredPluginIds: Array.isArray(raw?.featuredPluginIds) ? raw!.featuredPluginIds : [],
  };
}

/** Main directory search leaves scope unset; an explicit Public/Workspace scope is a different call site. */
export async function searchPlugins(searchTerm: string, cwds?: string[], cursor: string | null = null): Promise<PluginSearchResponse> {
  const raw = await call<PluginSearchResponse>("plugin/search", { searchTerm, ...cwdsParam(cwds), cursor, limit: 50 });
  if (!raw || !Array.isArray(raw.data) || (raw.nextCursor != null && typeof raw.nextCursor !== "string")) {
    throw new PluginProtocolError("plugin/search", "响应缺少有效的 data 或 nextCursor");
  }
  for (const entry of raw.data) {
    if (!entry || typeof entry.marketplaceName !== "string" || !entry.marketplaceName.trim() ||
        (entry.marketplacePath != null && typeof entry.marketplacePath !== "string") ||
        !entry.plugin || typeof entry.plugin.name !== "string" || !entry.plugin.name.trim()) {
      throw new PluginProtocolError("plugin/search", "响应包含无效的插件来源或名称");
    }
    normalizeInstalledResponse({ marketplaces: [{ name: entry.marketplaceName, path: entry.marketplacePath, plugins: [entry.plugin] }] }, "plugin/search");
  }
  return { data: raw.data, nextCursor: raw.nextCursor ?? null };
}

export function isUnsupportedPluginSearch(error: unknown): boolean {
  return error instanceof PluginProtocolError && error.method === "plugin/search" &&
    /(?:-32601\b|method not found|unknown (?:method|request)|unsupported (?:method|request)|(?:method|request).*(?:not supported|unsupported))/i.test(error.detail);
}

export function pluginRefFor(
  plugin: PluginSummary,
  marketplace: PluginMarketplaceEntry
): PluginRef {
  if (marketplace.path) {
    return { pluginName: plugin.name, marketplacePath: marketplace.path };
  }
  return { pluginName: plugin.remotePluginId ?? plugin.name, remoteMarketplaceName: marketplace.name };
}

/** `plugin/read` — full plugin detail (skills/apps/hooks/mcpServers). */
export async function readPlugin(ref: PluginRef): Promise<PluginDetail> {
  if (!ref.marketplacePath && !ref.remoteMarketplaceName) {
    throw new Error("plugin/read 需要 marketplacePath 或 remoteMarketplaceName 之一");
  }
  const params: Record<string, unknown> = { pluginName: ref.pluginName };
  if (ref.marketplacePath) params.marketplacePath = ref.marketplacePath;
  else params.remoteMarketplaceName = ref.remoteMarketplaceName;
  const res = await call<PluginReadResponse>("plugin/read", params);
  if (!res?.plugin) {
    throw new PluginProtocolError("plugin/read", "响应缺少 plugin 字段");
  }
  return {
    ...res.plugin,
    skills: Array.isArray(res.plugin.skills) ? res.plugin.skills : [],
    hooks: Array.isArray(res.plugin.hooks) ? res.plugin.hooks : [],
    apps: Array.isArray(res.plugin.apps) ? res.plugin.apps : [],
    appTemplates: Array.isArray(res.plugin.appTemplates) ? res.plugin.appTemplates : [],
    mcpServers: Array.isArray(res.plugin.mcpServers) ? res.plugin.mcpServers : [],
  };
}

/** `plugin/install`. `installAttemptId` is generated when omitted (client-side correlation id). */
export async function installPlugin(
  ref: PluginRef & { installAttemptId?: string }
): Promise<PluginInstallResponse> {
  if (!ref.marketplacePath && !ref.remoteMarketplaceName) {
    throw new Error("plugin/install 需要 marketplacePath 或 remoteMarketplaceName 之一");
  }
  const params: Record<string, unknown> = {
    pluginName: ref.pluginName,
    installAttemptId: ref.installAttemptId ?? createInstallAttemptId(),
  };
  if (ref.marketplacePath) params.marketplacePath = ref.marketplacePath;
  else params.remoteMarketplaceName = ref.remoteMarketplaceName;
  const res = await call<PluginInstallResponse>("plugin/install", params);
  if (!res || (res.authPolicy !== "ON_INSTALL" && res.authPolicy !== "ON_USE")) {
    throw new PluginProtocolError("plugin/install", "响应缺少有效的 authPolicy 字段");
  }
  if (!Array.isArray(res.appsNeedingAuth)) {
    throw new PluginProtocolError("plugin/install", "响应缺少 appsNeedingAuth 数组");
  }
  for (const app of res.appsNeedingAuth) validateAppSummary(app, "plugin/install");
  return {
    authPolicy: res.authPolicy,
    appsNeedingAuth: uniqueApps(res.appsNeedingAuth),
  };
}

/** `plugin/uninstall` — takes the full plugin id (`name@marketplace`). */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  await call<unknown>("plugin/uninstall", { pluginId });
}

function createInstallAttemptId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `attempt-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through to timestamp-based id
  }
  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketplaces
// ─────────────────────────────────────────────────────────────────────────────

export interface AddMarketplaceOptions {
  refName?: string;
  sparsePaths?: string[];
}

/** `marketplace/add` — source may be a git URL or a local path. */
export async function addMarketplace(
  source: string,
  options: AddMarketplaceOptions = {}
): Promise<MarketplaceAddResponse> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("marketplace/add 需要非空的 source");
  const params: Record<string, unknown> = { source: trimmed };
  if (options.refName?.trim()) params.refName = options.refName.trim();
  if (options.sparsePaths && options.sparsePaths.length > 0) {
    params.sparsePaths = options.sparsePaths;
  }
  return call<MarketplaceAddResponse>("marketplace/add", params);
}

/** `marketplace/remove`. */
export async function removeMarketplace(marketplaceName: string): Promise<MarketplaceRemoveResponse> {
  return call<MarketplaceRemoveResponse>("marketplace/remove", { marketplaceName });
}

/** `marketplace/upgrade` — omit `marketplaceName` to upgrade every configured marketplace. */
export async function upgradeMarketplace(
  marketplaceName?: string
): Promise<MarketplaceUpgradeResponse> {
  const params: Record<string, unknown> = {};
  if (marketplaceName?.trim()) params.marketplaceName = marketplaceName.trim();
  const res = await call<MarketplaceUpgradeResponse>("marketplace/upgrade", params);
  return {
    errors: Array.isArray(res?.errors) ? res.errors : [],
    selectedMarketplaces: Array.isArray(res?.selectedMarketplaces)
      ? res.selectedMarketplaces
      : [],
    upgradedRoots: Array.isArray(res?.upgradedRoots) ? res.upgradedRoots : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Apps / connectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `app/list` — remote app/connector catalog.
 * Can fail with `403 Forbidden` when the account/network cannot reach the app
 * service; callers must degrade gracefully (see `listInstalledApps` fallback).
 */
export async function listApps(
  options: { forceRefetch?: boolean; cursor?: string | null } = {}
): Promise<AppsListResponse> {
  const res = await call<AppsListResponse>("app/list", {
    forceRefetch: options.forceRefetch ?? false,
    ...(options.cursor != null ? { cursor: options.cursor } : {}),
  });
  if (!res || !Array.isArray(res.data)) {
    throw new PluginProtocolError("app/list", "响应缺少 data 数组");
  }
  if (res.nextCursor != null && (typeof res.nextCursor !== "string" || !res.nextCursor.trim())) {
    throw new PluginProtocolError("app/list", "响应包含无效 nextCursor");
  }
  for (const app of res.data) {
    validateAppSummary(app, "app/list");
    for (const key of ["isEnabled", "isAccessible"] as const) {
      if (app[key] !== undefined && typeof app[key] !== "boolean") {
        throw new PluginProtocolError("app/list", `应用 ${app.id} 的 ${key} 不是布尔值`);
      }
    }
  }
  return {
    data: res.data,
    nextCursor: res.nextCursor ?? null,
  };
}

/** Traverse the complete remote catalog; repeated IDs retain the first observed facts. */
export async function listAllApps(options: { forceRefetch?: boolean } = {}): Promise<AppInfo[]> {
  const data: AppInfo[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: AppsListResponse = await listApps({ ...options, cursor });
    data.push(...page.data);
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (cursors.has(cursor)) {
        throw new PluginProtocolError("app/list", "分页 nextCursor 重复，无法确认完整应用目录");
      }
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return uniqueApps(data);
}

/**
 * `app/installed` — local committed connector runtime snapshot. Works without
 * network access and is the fallback when `app/list` is forbidden.
 */
export async function listInstalledApps(
  options: { forceRefresh?: boolean } = {}
): Promise<InstalledApp[]> {
  const res = await call<AppsInstalledResponse>(
    "app/installed", options.forceRefresh ? { forceRefresh: true } : {}
  );
  if (!res || !Array.isArray(res.apps)) {
    throw new PluginProtocolError("app/installed", "响应缺少 apps 数组");
  }
  for (const app of res.apps) {
    if (
      !app || typeof app.id !== "string" || !app.id.trim() ||
      typeof app.enabled !== "boolean" || typeof app.callable !== "boolean" ||
      (app.runtimeName != null && typeof app.runtimeName !== "string")
    ) {
      throw new PluginProtocolError("app/installed", "响应包含无效的应用运行时状态");
    }
  }
  return uniqueApps(res.apps);
}

/** Prefer supported runtime APIs; this is capability detection, not an assertion about the account's lifecycle gate. */
export async function readPluginPreparationState(
  options: { forceRefetch?: boolean } = {}
): Promise<PluginPreparationState> {
  let installed: InstalledApp[] = [];
  try {
    installed = await listInstalledApps({ forceRefresh: options.forceRefetch });
    const catalog: AppInfo[] = [];
    for (let offset = 0; offset < installed.length; offset += 100) {
      const batch = installed.slice(offset, offset + 100);
      const requested = new Set(batch.map(app => app.id));
      const response = await call<{ apps: AppSummary[]; missingAppIds: string[] }>(
        "app/read", { appIds: [...requested] }
      );
      if (!response || !Array.isArray(response.apps) || !Array.isArray(response.missingAppIds)) {
        throw new PluginProtocolError("app/read", "响应缺少 apps 或 missingAppIds 数组");
      }
      for (const app of response.apps) {
        validateAppSummary(app, "app/read");
        if (!requested.has(app.id)) {
          throw new PluginProtocolError("app/read", "响应包含未请求的应用 ID");
        }
        const runtime = batch.find(item => item.id === app.id)!;
        catalog.push({ ...app, isAccessible: runtime.callable, isEnabled: runtime.enabled });
      }
      for (const id of response.missingAppIds) {
        if (typeof id !== "string" || !requested.has(id) || response.apps.some(app => app.id === id)) {
          throw new PluginProtocolError("app/read", "响应包含无效的 missingAppIds");
        }
      }
      if (batch.some(item => !response.apps.some(app => app.id === item.id) && !response.missingAppIds.includes(item.id))) {
        throw new PluginProtocolError("app/read", "响应未说明部分应用的元数据结果");
      }
    }
    return { source: "runtime", catalog: uniqueApps(catalog), installed };
  } catch (error) {
    if (!isUnsupportedAppMethod(error)) throw error;
    return { source: "catalog", catalog: await listAllApps(options), installed };
  }
}

function isUnsupportedAppMethod(error: unknown): boolean {
  if (!(error instanceof PluginProtocolError) || !["app/installed", "app/read"].includes(error.method)) return false;
  return /(?:-32601\b|method not found|unknown (?:method|request)|unsupported (?:method|request)|(?:method|request).*(?:not supported|unsupported))/i.test(error.detail);
}

function validateAppSummary(app: AppSummary, method: string): void {
  if (
    !app || typeof app.id !== "string" || !app.id.trim() ||
    typeof app.name !== "string" || !app.name.trim() ||
    (app.installUrl != null && typeof app.installUrl !== "string")
  ) {
    throw new PluginProtocolError(method, "响应包含无效的应用 id、name 或 installUrl");
  }
}

function uniqueApps<T extends { id: string }>(apps: T[]): T[] {
  const seen = new Set<string>();
  return apps.filter(app => {
    if (seen.has(app.id)) return false;
    seen.add(app.id);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills
// ─────────────────────────────────────────────────────────────────────────────

/** `skills/list` — authoritative skill list (user/repo/system/plugin scopes + enabled flags). */
export async function listSkills(
  cwds?: string[],
  forceReload = false
): Promise<SkillsListResponse> {
  const res = await call<SkillsListResponse>("skills/list", {
    ...cwdsParam(cwds),
    forceReload,
  });
  return {
    data: Array.isArray(res?.data)
      ? res.data.map((entry) => ({
          cwd: entry?.cwd ?? "",
          skills: Array.isArray(entry?.skills) ? entry.skills : [],
          errors: Array.isArray(entry?.errors) ? entry.errors : [],
        }))
      : [],
  };
}

export interface SetSkillEnabledParams {
  enabled: boolean;
  /** Name-based selector (`SkillMetadata.name`). */
  name?: string;
  /** Path-based selector (`SkillMetadata.path`), preferred unless name contains a colon. */
  path?: string;
}

/** `skills/config/write` — enable/disable a skill by path or name. */
export async function setSkillEnabled(params: SetSkillEnabledParams): Promise<void> {
  const payload: Record<string, unknown> = { enabled: params.enabled };
  if (params.name?.includes(":")) payload.name = params.name;
  else if (params.path) payload.path = params.path;
  else if (params.name) payload.name = params.name;
  else throw new Error("skills/config/write 需要 name 或 path 之一");
  await call<unknown>("skills/config/write", payload);
}

/** Flatten `skills/list` entries into one list of skills (first cwd wins on duplicates). */
export function flattenSkills(response: SkillsListResponse | null | undefined): {
  skills: SkillMetadata[];
  errors: SkillErrorInfo[];
} {
  const skills: SkillMetadata[] = [];
  const errors: SkillErrorInfo[] = [];
  const seen = new Set<string>();
  for (const entry of response?.data ?? []) {
    for (const skill of entry.skills ?? []) {
      const key = skill.path || skill.name;
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
    errors.push(...(entry.errors ?? []));
  }
  return { skills, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

export function pluginDisplayName(plugin: PluginSummary): string {
  return plugin.interface?.displayName?.trim() || plugin.name;
}

export function pluginDescription(plugin: PluginSummary, maxLength = 240): string {
  const raw =
    plugin.interface?.shortDescription?.trim() ||
    plugin.interface?.longDescription?.trim() ||
    "";
  if (!raw) return "暂无描述";
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}…`;
}

export function pluginVersion(plugin: PluginSummary): string {
  return plugin.version?.trim() || plugin.localVersion?.trim() || "";
}

export function pluginSourceLabel(plugin: PluginSummary): string {
  const source = plugin.source;
  if (!source) return "未知来源";
  switch (source.type) {
    case "local":
      return `本地 · ${basename(source.path)}`;
    case "git":
      return `Git · ${source.url}`;
    case "npm":
      return `npm · ${source.package}`;
    case "remote":
      return "远程市场";
    default:
      return "未知来源";
  }
}

export function pluginDeveloper(plugin: PluginSummary): string {
  return plugin.interface?.developerName?.trim() || "";
}

export function pluginCategory(plugin: PluginSummary): string {
  return plugin.interface?.category?.trim() || "";
}

export function marketplaceDisplayName(marketplace: PluginMarketplaceEntry): string {
  return marketplace.interface?.displayName?.trim() || marketplace.name;
}

export function marketplaceSourceLabel(marketplace: PluginMarketplaceEntry): string {
  return marketplace.path ? "本地市场" : "远程市场";
}

export function countMarketplacePlugins(marketplace: PluginMarketplaceEntry): {
  total: number;
  installed: number;
  enabled: number;
} {
  const plugins = marketplace.plugins ?? [];
  return {
    total: plugins.length,
    installed: plugins.filter((p) => p.installed).length,
    enabled: plugins.filter((p) => p.installed && p.enabled).length,
  };
}

export function basename(path: string | null | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/[\\/]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}
