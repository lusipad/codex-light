import { readChatgptService, readSitesMetadata, readSiteAsset, writeSitePin, writeSiteTitle, writeSiteEnvironment, readSiteSlugAvailability, writeSiteSlug, writeSiteDomain, serviceIdentity, shareAccessBootstrap, serviceErrorMessage, type ServiceIdentity, type SiteAssetRef, type SiteEnvironmentPatch, type SiteSlugAvailability, type SiteSlugChange, type SiteDomainMutation } from "./chatgptService";
import { parseSitesAccess, parseSitesPage, parseSite, parseSiteDomains, parseSiteEnvironmentSnapshot, parseSiteSettingsCapabilities, type SiteRecord, type SitesAccess, type SiteDomain, type SiteEnvironment, type SiteEnvironmentSnapshot, type SiteSettingsCapabilities } from "./sitesService";

export interface SitesClientAccess extends SitesAccess { identity: ServiceIdentity; pinned: boolean; collectionPreview: boolean; slugChangeAllowed: boolean }
export type SitesListKind = "owned" | "shared" | "pinned";
export interface SitesClientPage { items: SiteRecord[]; cursor: string | null; assets: SiteAssetRef[] }
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
async function confirmIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  signal.throwIfAborted(); const current = await serviceIdentity(signal);
  if (current.accountId !== identity.accountId || current.userId !== identity.userId || current.generation !== identity.generation) throw Error("读取期间账号发生变化，请重试。");
}
export async function readSitesAccess(signal: AbortSignal): Promise<SitesClientAccess> {
  const identity = await serviceIdentity(signal), bootstrap = await shareAccessBootstrap(identity, signal);
  signal.throwIfAborted();
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") throw Error("无法读取站点访问权限。");
  const payload = JSON.parse(bootstrap.statsigPayload);
  if (!object(payload) || payload.user?.userID !== identity.userId || payload.user?.customIDs?.account_id !== identity.accountId || !object(payload.feature_gates)
    || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format)) throw Error("站点权限快照不完整或与当前账号不符。");
  const gate = (key: string, required = false) => {
    let hash = 0; for (let index = 0; index < key.length; index++) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) >>> 0;
    const entry = payload.feature_gates[key] ?? payload.feature_gates[String(hash)], value = entry?.[payload.response_format === "init-v2" ? "v" : "value"];
    if ((required || value !== undefined) && typeof value !== "boolean") throw Error("站点访问资格尚未确认。");
    return value === true;
  };
  const enabledGate = gate("637432221", true), sharing = gate("476199071"), pinned = gate("1425956883");
  const access: SitesClientAccess = { identity, enabled: false, workspace: false, editable: false, pinned: false, collectionPreview: gate("1498265771"), slugChangeAllowed: gate("324493575") };
  if (enabledGate) {
    const entry = await readChatgptService("sites_entry_access", {}, identity, signal);
    if (!object(entry) || typeof entry.enabled !== "boolean") throw Error("站点入口资格返回无效。");
    access.enabled = entry.enabled;
    if (entry.enabled && sharing) {
      const capabilities = parseSitesAccess(await readChatgptService("sites_access", {}, identity, signal));
      access.workspace = capabilities.enabled && capabilities.workspace;
      access.editable = capabilities.editable;
    }
    access.pinned = entry.enabled && pinned;
  }
  await confirmIdentity(identity, signal); return access;
}
function requireAccess(access: SitesClientAccess) { if (!access.enabled) throw Error("当前账号不可使用站点。"); }
function normalizedSiteSlug(access: SitesClientAccess, raw: string): string {
  requireAccess(access); if (!access.slugChangeAllowed) throw Error("当前账号不可更改站点 URL。");
  const slug = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(slug)) throw Error("站点 URL 格式无效。");
  return slug;
}
export async function checkSiteSlug(access: SitesClientAccess, id: string, rawSlug: string, signal: AbortSignal): Promise<SiteSlugAvailability> {
  const slug = normalizedSiteSlug(access, rawSlug); await confirmIdentity(access.identity, signal);
  const result = await readSiteSlugAvailability(id, slug, access.identity, signal);
  await confirmIdentity(access.identity, signal); return result;
}
export async function changeSiteSlug(access: SitesClientAccess, id: string, rawSlug: string, signal: AbortSignal): Promise<SiteSlugChange> {
  const slug = normalizedSiteSlug(access, rawSlug); await confirmIdentity(access.identity, signal);
  try {
    const result = await writeSiteSlug(id, slug, access.identity, signal);
    await confirmIdentity(access.identity, signal); return result;
  } catch (cause) { throw Object.assign(Error("站点 URL 更改结果未确认，请读取当前站点后再操作。"), { code: "site_slug_unconfirmed", status: (cause as { status?: number })?.status, cause }); }
}
export async function readSitesPage(access: SitesClientAccess, kind: SitesListKind, query: string, cursor: string | null, signal: AbortSignal, seenCursors: readonly string[] = []): Promise<SitesClientPage> {
  requireAccess(access);
  if (kind === "pinned" && !access.pinned || kind === "shared" && !access.workspace && !access.editable) throw Error("当前账号不可读取此站点目录。");
  const operation = kind === "pinned" ? "sites_pinned" : kind === "shared" && access.workspace ? "sites_shared" : "sites_list";
  const search = query.trim().toLowerCase();
  const params = operation === "sites_list" ? { limit: 20, include_editable: kind === "shared", ...(cursor !== null ? { after: cursor } : kind === "shared" ? { after: "sites-shared-projects:" } : {}) }
    : { limit: 20, ...(cursor !== null ? { after: cursor } : {}), ...(search ? { query: search } : {}) };
  let result;
  try { result = await readSitesMetadata(operation, params, access.identity, signal); }
  catch (error) {
    if (kind === "shared" && !access.workspace && cursor === null && (error as { status?: number })?.status === 400)
      throw Object.assign(Error("当前服务不支持共享站点列表。"), { code: "shared_fallback_unavailable", status: 400 });
    throw error;
  }
  const page = parseSitesPage(result.body);
  if (page.cursor !== null && (page.cursor === cursor || seenCursors.includes(page.cursor))) throw Error("站点服务返回了重复分页游标，请刷新后重试。");
  await confirmIdentity(access.identity, signal);
  return { ...page, items: kind === "shared" && !access.workspace ? page.items.filter(site => site.role !== "owner") : page.items, assets: result.assets };
}
export async function readSiteDetail(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<{ site: SiteRecord; assets: SiteAssetRef[] }> {
  requireAccess(access); const result = await readSitesMetadata("sites_detail", { id }, access.identity, signal), site = parseSite(result.body);
  if (site.id !== id) throw Error("站点详情与请求不符。");
  await confirmIdentity(access.identity, signal); return { site, assets: result.assets };
}
export interface SiteDomainSettings { capabilities: SiteSettingsCapabilities | null; domains: SiteDomain[] | null; errors: Record<string, string> }
export async function readSiteDomains(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<SiteDomain[]> {
  requireAccess(access);
  const domains = parseSiteDomains(await readChatgptService("sites_domains", { id }, access.identity, signal), id);
  await confirmIdentity(access.identity, signal); return domains;
}
async function mutateSiteDomain(access: SitesClientAccess, id: string, mutation: SiteDomainMutation, signal: AbortSignal): Promise<SiteDomain> {
  requireAccess(access); await confirmIdentity(access.identity, signal);
  try {
    const domain = await writeSiteDomain(id, mutation, access.identity, signal);
    await confirmIdentity(access.identity, signal); return domain;
  } catch (cause) {
    const error = cause as { code?: string; status?: number };
    if (!signal.aborted && error?.status != null && error.status >= 400 && error.status < 500 && error.code !== "sites_settings_unknown") throw cause;
    throw Object.assign(Error("域名操作结果未确认，请读取当前域名后再操作。"), { code: "site_domain_unconfirmed", status: error?.status, cause });
  }
}
export async function addSiteDomain(access: SitesClientAccess, id: string, rawHostname: string, signal: AbortSignal): Promise<SiteDomain> {
  const hostname = rawHostname.trim(); if (!hostname) throw Error("请输入域名。");
  return mutateSiteDomain(access, id, { operation: "domain_add", hostname }, signal);
}
export function refreshSiteDomain(access: SitesClientAccess, id: string, domainId: string, signal: AbortSignal): Promise<SiteDomain> {
  return mutateSiteDomain(access, id, { operation: "domain_refresh", domain_id: domainId }, signal);
}
export function removeSiteDomain(access: SitesClientAccess, id: string, domainId: string, signal: AbortSignal): Promise<SiteDomain> {
  return mutateSiteDomain(access, id, { operation: "domain_remove", domain_id: domainId }, signal);
}
export async function readSiteDomainSettings(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<SiteDomainSettings> {
  requireAccess(access); const result: SiteDomainSettings = { capabilities: null, domains: null, errors: {} };
  try {
    result.capabilities = parseSiteSettingsCapabilities(await readChatgptService("sites_access", {}, access.identity, signal));
    await confirmIdentity(access.identity, signal);
  } catch (error) { signal.throwIfAborted(); result.errors.capabilities = serviceErrorMessage(error); }
  if (result.capabilities?.customDomainsEnabled && !result.errors.capabilities) {
    try { result.domains = parseSiteDomains(await readChatgptService("sites_domains", { id }, access.identity, signal), id); }
    catch (error) { signal.throwIfAborted(); result.errors.domains = serviceErrorMessage(error); }
  }
  await confirmIdentity(access.identity, signal); return result;
}
export async function readSiteSettings(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<SiteDomainSettings & { environment: SiteEnvironment[] | null; environmentSnapshot: SiteEnvironmentSnapshot | null }> {
  requireAccess(access);
  const result: { environmentSnapshot: SiteEnvironmentSnapshot | null } = { environmentSnapshot: null }; const errors: Record<string, string> = {};
  const [domainSettings] = await Promise.all([readSiteDomainSettings(access, id, signal), (async () => {
    try { result.environmentSnapshot = parseSiteEnvironmentSnapshot(await readChatgptService("sites_environment", { id }, access.identity, signal), id); }
    catch (error) { signal.throwIfAborted(); errors.environment = serviceErrorMessage(error); }
  })()]);
  await confirmIdentity(access.identity, signal);
  return { ...domainSettings, environmentSnapshot: result.environmentSnapshot, environment: result.environmentSnapshot?.entries ?? null, errors: { ...domainSettings.errors, ...errors } };
}
export async function readSiteEnvironmentSnapshot(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<SiteEnvironmentSnapshot> {
  requireAccess(access);
  const snapshot = parseSiteEnvironmentSnapshot(await readChatgptService("sites_environment", { id }, access.identity, signal), id);
  await confirmIdentity(access.identity, signal); return snapshot;
}
export async function saveSiteTitle(access: SitesClientAccess, id: string, title: string, signal: AbortSignal): Promise<{ site: SiteRecord; assets: SiteAssetRef[] }> {
  requireAccess(access); const value = title.trim();
  if (!value || value.length > 100) throw Error("请输入不超过 100 个字符的站点名称。");
  await confirmIdentity(access.identity, signal);
  try {
    const acknowledged = await writeSiteTitle(id, value, access.identity, signal);
    if (acknowledged.title !== value) throw Error("服务返回的站点名称不符。");
    const actual = await readSiteDetail(access, id, signal);
    if (actual.site.title !== value) throw Error("站点名称尚未确认。");
    return actual;
  } catch (cause) { throw Object.assign(Error("站点名称保存结果未确认，请读取当前状态后再操作。"), { code: "site_title_unconfirmed", status: (cause as { status?: number })?.status, cause }); }
}
export async function saveSiteEnvironment(access: SitesClientAccess, id: string, patch: SiteEnvironmentPatch, signal: AbortSignal, baseline: SiteEnvironmentSnapshot): Promise<SiteEnvironmentSnapshot> {
  requireAccess(access);
  if (baseline.projectId !== id || !Array.isArray(patch.remove) || !Array.isArray(patch.set_values)) throw Error("环境变量保存参数无效。");
  const keys = new Set<string>();
  for (const entry of patch.set_values) {
    if (typeof entry.key !== "string" || !entry.key.trim() || keys.has(entry.key) || entry.type !== "envvar" || typeof entry.is_secret !== "boolean" || typeof entry.value !== "string") throw Error("环境变量的键必须非空且不能重复。");
    keys.add(entry.key);
  }
  if (patch.remove.some(key => typeof key !== "string" || !key.trim() || keys.has(key)) || new Set(patch.remove).size !== patch.remove.length) throw Error("环境变量删除参数无效。");
  await confirmIdentity(access.identity, signal);
  try {
    parseSiteEnvironmentSnapshot(await writeSiteEnvironment(id, patch, access.identity, signal), id);
    const actual = await readSiteEnvironmentSnapshot(access, id, signal);
    const expected = new Map(baseline.entries.map(entry => [entry.key, entry]));
    for (const key of patch.remove) expected.delete(key);
    for (const entry of patch.set_values) expected.set(entry.key, { key: entry.key, secret: entry.is_secret, value: entry.is_secret ? null : entry.value });
    const found = new Map(actual.entries.map(entry => [entry.key, entry]));
    if (found.size !== actual.entries.length || patch.remove.some(key => found.has(key)) || [...expected].some(([key, entry]) => {
      const saved = found.get(key); return !saved || saved.secret !== entry.secret || (!entry.secret && saved.value !== entry.value);
    })) throw Error("环境变量读回与保存内容不符。");
    return actual;
  } catch (cause) { throw Object.assign(Error("环境变量保存结果未确认，请读取当前状态后再操作。"), { code: "site_environment_unconfirmed", status: (cause as { status?: number })?.status, cause }); }
}
export async function readSiteScreenshot(ref: SiteAssetRef, access: SitesClientAccess, signal: AbortSignal): Promise<string> {
  requireAccess(access); const result = await readSiteAsset(ref, access.identity, signal); await confirmIdentity(access.identity, signal); return result;
}
export async function readSitePin(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<boolean> {
  requireAccess(access); if (!access.pinned) throw Error("当前账号不可置顶站点。");
  const body = await readChatgptService("sites_pin", { id }, access.identity, signal);
  if (!object(body) || (body.project_id !== undefined && body.project_id !== id) || typeof body.is_pinned !== "boolean") throw Error("站点置顶状态无效。");
  await confirmIdentity(access.identity, signal); return body.is_pinned;
}
export async function setSitePinned(access: SitesClientAccess, id: string, pinned: boolean, signal: AbortSignal): Promise<boolean> {
  requireAccess(access); if (!access.pinned) throw Error("当前账号不可置顶站点。");
  await confirmIdentity(access.identity, signal);
  try {
    const response = await writeSitePin(id, pinned, access.identity, signal);
    if (response.project_id !== id || response.is_pinned !== pinned) throw Error("服务返回的站点置顶状态不符。");
    const actual = await readSitePin(access, id, signal);
    if (actual !== pinned) throw Error("站点置顶状态尚未确认。");
    return actual;
  } catch (cause) { throw Object.assign(Error("站点置顶结果未确认，请读取当前状态后再操作。"), { code: "site_pin_unconfirmed", cause }); }
}
