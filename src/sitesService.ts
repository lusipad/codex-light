export interface SitesAccess { enabled: boolean; workspace: boolean; editable: boolean }
export interface SiteSettingsCapabilities { slugChangeEnabled: boolean; customDomainsEnabled: boolean }
export interface SiteRecord {
  id: string; title: string; slug: string; description: string; status: "active" | "archived" | "suspended" | "deleting";
  liveUrl: string | null; updatedAt: string; disabledBy: string | null; role: string | null;
  hostedUrl: string | null; screenshotUrl: string | null;
  latestEditContext: { chatgptConversationId: string | null; codexThreadId: string | null } | null;
  owner: { name: string | null; email: string | null } | null;
  sharing: { accessMode: string; userCount: number; groupCount: number; countsAvailable: boolean | undefined };
  isPinned: boolean | null; raw: Record<string, unknown>;
}
export interface SitesPage { items: SiteRecord[]; cursor: string | null }
export interface SiteEnvironment { key: string; secret: boolean; value: string | null }
export interface SiteEnvironmentSnapshot { projectId: string; entries: SiteEnvironment[]; revision: number; updatedAt: string | null; requiresSecrets?: boolean }
export interface SiteDomain { id: string; projectId: string; hostname: string; status: "pending" | "active" | "failed"; cname: string | null; ipv4: string[]; ssl: string | null; error: string | null; providerStatus: string | null; workerName: string; createdAt: string; updatedAt: string; records: { name: string | null; type: string | null; value: string | null }[] }
const malformed = () => Error("Sites 服务返回了无法识别的数据。");
function string(value: unknown): string { if (typeof value !== "string") throw malformed(); return value; }
function optionalString(value: unknown): string | null { return value == null ? null : string(value); }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
export function parseSitesAccess(value: any): SitesAccess {
  if (typeof value?.enabled !== "boolean" || (value.supports_workspace_listing != null && typeof value.supports_workspace_listing !== "boolean") ||
    (value.supports_editable_listing != null && typeof value.supports_editable_listing !== "boolean")) throw malformed();
  return { enabled: value.enabled, workspace: value.supports_workspace_listing ?? false, editable: value.supports_editable_listing ?? false };
}
export function parseSiteSettingsCapabilities(value: any): SiteSettingsCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw malformed();
  return { slugChangeEnabled: value.slug_change_enabled === true, customDomainsEnabled: value.custom_domains_enabled === true };
}
export function parseSite(value: any): SiteRecord {
  if (!value || !["active", "archived", "suspended", "deleting"].includes(value.status) || !value.id ||
    (value.live_url !== null && typeof value.live_url !== "string") ||
    !value.sharing || typeof value.sharing.access_mode !== "string" || !Number.isInteger(value.sharing.user_count) || !Number.isInteger(value.sharing.group_count)) throw malformed();
  const updatedAt = string(value.updated_at);
  if (!Number.isFinite(Date.parse(updatedAt))) throw malformed();
  if ((value.is_pinned != null && typeof value.is_pinned !== "boolean") || (value.sharing.counts_available !== undefined && typeof value.sharing.counts_available !== "boolean")
    || value.sharing.user_count < 0 || value.sharing.group_count < 0) throw malformed();
  const context = value.latest_edit_context, owner = value.owner;
  if ((context != null && (typeof context !== "object" || Array.isArray(context))) || (owner != null && (typeof owner !== "object" || Array.isArray(owner)))) throw malformed();
  return { id: string(value.id), title: string(value.title), slug: string(value.slug), description: optionalString(value.description) ?? "",
    status: value.status, liveUrl: optionalString(value.live_url), updatedAt, disabledBy: optionalString(value.disabled_by), role: optionalString(value.current_user_role),
    hostedUrl: optionalString(value.hosted_url), screenshotUrl: optionalString(value.screenshot_url),
    latestEditContext: context == null ? null : { chatgptConversationId: optionalString(context.chatgpt_conversation_id), codexThreadId: optionalString(context.codex_thread_id) },
    owner: owner == null ? null : { name: optionalString(owner.name), email: optionalString(owner.email) },
    sharing: { accessMode: value.sharing.access_mode, userCount: value.sharing.user_count, groupCount: value.sharing.group_count, countsAvailable: value.sharing.counts_available },
    isPinned: value.is_pinned ?? null, raw: value };
}
/** The owned-list context infers owner; shared responses retain their actual role. */
export function siteRole(site: SiteRecord, context: "owned" | "shared" | "pinned"): string | null {
  return context === "owned" && site.role !== "editor" ? "owner" : site.role;
}
export function parseSitesPage(value: any): SitesPage {
  if (!Array.isArray(value?.items)) throw malformed();
  return { items: value.items.map(parseSite), cursor: optionalString(value.cursor) || null };
}
export function mergeSites(...pages: SiteRecord[][]): SiteRecord[] {
  const items = new Map<string, SiteRecord>();
  for (const page of pages) for (const site of page) {
    const old = items.get(site.id); if (!old || Date.parse(site.updatedAt) >= Date.parse(old.updatedAt)) items.set(site.id, site);
  }
  return [...items.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export function filterSites(items: SiteRecord[], query: string): SiteRecord[] {
  const search = query.trim().toLowerCase(); return items.filter(item => [item.title, item.slug, item.description].some(value => value.toLowerCase().includes(search)));
}
export function safeSiteUrl(value: string | null): string | null {
  try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function siteHostedDomainSuffix(site: Pick<SiteRecord, "hostedUrl" | "liveUrl" | "slug">): string | null {
  const value = site.hostedUrl ?? site.liveUrl;
  if (value === null) return null;
  try {
    const hostname = new URL(value).hostname, slug = site.slug.trim().toLowerCase();
    return !slug || !hostname.startsWith(`${slug}.`) || ![".chatgpt-team.site", ".chatgpt.site", ".appgardenapps.dev"].some(suffix => hostname.endsWith(suffix)) ? null : hostname.slice(slug.length);
  } catch { return null; }
}
export function parseSiteEnvironment(value: any, projectId: string): SiteEnvironment[] {
  if (value?.project_id !== projectId || !Array.isArray(value.entries)) throw malformed();
  return value.entries.map((entry: any) => {
    if (entry?.type !== "envvar" || typeof entry.is_secret !== "boolean") throw malformed();
    const actual = optionalString(entry.value);
    return { key: string(entry.key), secret: entry.is_secret, value: entry.is_secret ? null : actual };
  });
}
export function parseSiteEnvironmentSnapshot(value: any, projectId: string): SiteEnvironmentSnapshot {
  if (typeof value?.revision !== "number" || !Number.isFinite(value.revision) || !(value.updated_at === null || typeof value.updated_at === "string")
    || (value.requires_secrets !== undefined && typeof value.requires_secrets !== "boolean") || !Array.isArray(value.entries)
    || value.entries.some((entry: any) => !(entry?.value === null || typeof entry.value === "string"))) throw malformed();
  return { projectId, entries: parseSiteEnvironment(value, projectId), revision: value.revision, updatedAt: value.updated_at,
    ...(value.requires_secrets === undefined ? {} : { requiresSecrets: value.requires_secrets }) };
}
export function parseSiteDomains(value: any, projectId: string): SiteDomain[] {
  if (!Array.isArray(value?.items)) throw malformed();
  return value.items.map((domain: any) => {
    if (domain?.project_id !== projectId || !["pending", "active", "failed"].includes(domain.status) || !Array.isArray(domain.validation_records) || !Array.isArray(domain.apex_proxy_ipv4_targets)) throw malformed();
    return { id: string(domain.id), projectId, hostname: string(domain.hostname), status: domain.status, cname: nullableString(domain.cname_target), ipv4: domain.apex_proxy_ipv4_targets.map(string),
      ssl: nullableString(domain.ssl_status), error: nullableString(domain.last_error), providerStatus: nullableString(domain.provider_status), workerName: string(domain.worker_name),
      createdAt: string(domain.created_at), updatedAt: string(domain.updated_at), records: domain.validation_records.map((record: any) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) throw malformed();
        return { name: optionalString(record.name), type: optionalString(record.record_type), value: optionalString(record.value) };
      }) };
  });
}
