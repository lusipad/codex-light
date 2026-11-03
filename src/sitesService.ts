export interface SitesAccess { enabled: boolean; workspace: boolean; editable: boolean }
export interface SiteRecord {
  id: string; title: string; slug: string; description: string; status: "active" | "archived" | "suspended" | "deleting";
  liveUrl: string | null; updatedAt: string; disabledBy: string | null; role: string | null;
}
export interface SitesPage { items: SiteRecord[]; cursor: string | null }
export interface SiteEnvironment { key: string; secret: boolean; value: string | null }
export interface SiteDomain { id: string; hostname: string; status: string; cname: string | null; ipv4: string[]; ssl: string | null; error: string | null; records: { name: string | null; type: string | null; value: string | null }[] }
const malformed = () => Error("Sites 服务返回了无法识别的数据。");
function string(value: unknown): string { if (typeof value !== "string") throw malformed(); return value; }
function optionalString(value: unknown): string | null { return value == null ? null : string(value); }
export function parseSitesAccess(value: any): SitesAccess {
  if (typeof value?.enabled !== "boolean" || (value.supports_workspace_listing != null && typeof value.supports_workspace_listing !== "boolean") ||
    (value.supports_editable_listing != null && typeof value.supports_editable_listing !== "boolean")) throw malformed();
  return { enabled: value.enabled, workspace: value.supports_workspace_listing ?? false, editable: value.supports_editable_listing ?? false };
}
export function parseSite(value: any): SiteRecord {
  if (!value || !["active", "archived", "suspended", "deleting"].includes(value.status) || !value.id ||
    (value.live_url !== null && typeof value.live_url !== "string") ||
    !value.sharing || typeof value.sharing.access_mode !== "string" || !Number.isInteger(value.sharing.user_count) || !Number.isInteger(value.sharing.group_count)) throw malformed();
  const updatedAt = string(value.updated_at);
  if (!Number.isFinite(Date.parse(updatedAt))) throw malformed();
  return { id: string(value.id), title: string(value.title), slug: string(value.slug), description: optionalString(value.description) ?? "",
    status: value.status, liveUrl: optionalString(value.live_url), updatedAt, disabledBy: optionalString(value.disabled_by), role: optionalString(value.current_user_role) };
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
export function parseSiteEnvironment(value: any, projectId: string): SiteEnvironment[] {
  if (value?.project_id !== projectId || !Array.isArray(value.entries)) throw malformed();
  return value.entries.map((entry: any) => {
    if (entry?.type !== "envvar" || typeof entry.is_secret !== "boolean") throw malformed();
    const actual = optionalString(entry.value);
    return { key: string(entry.key), secret: entry.is_secret, value: entry.is_secret ? null : actual };
  });
}
export function parseSiteDomains(value: any, projectId: string): SiteDomain[] {
  if (!Array.isArray(value?.items)) throw malformed();
  return value.items.map((domain: any) => {
    if (domain?.project_id !== projectId || !["pending", "active", "failed"].includes(domain.status) || !Array.isArray(domain.validation_records) || !Array.isArray(domain.apex_proxy_ipv4_targets)) throw malformed();
    return { id: string(domain.id), hostname: string(domain.hostname), status: domain.status, cname: optionalString(domain.cname_target), ipv4: domain.apex_proxy_ipv4_targets.map(string),
      ssl: optionalString(domain.ssl_status), error: optionalString(domain.last_error), records: domain.validation_records.map((record: any) =>
        ({ name: optionalString(record?.name), type: optionalString(record?.record_type), value: optionalString(record?.value) })) };
  });
}
