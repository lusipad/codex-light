import { readChatgptService, readCloudService, serviceErrorMessage, type ServiceIdentity } from "./chatgptService";

export interface CloudRepository { id: string; ref: string; depth?: number }
export interface CloudSummary { id: string; name: string; versionId: string; shareSettings: "private" | "workspace"; repositories: CloudRepository[]; isOwner?: boolean }
export interface CloudNetwork { type: "disabled" | "unrestricted" | "restricted"; hosts: string[]; packageManagers: boolean }
export interface CloudSecret { name: string; source: "environment" | "user_provided"; target: string; domains: string[]; error: string | null }
export interface CloudEditable { repositories: CloudRepository[]; network: CloudNetwork; installScript: string | null; cwd: string | null; startSkill: string | null; secrets: CloudSecret[] }
export interface CloudDetail extends CloudSummary, CloudEditable { status: string; draft: (CloudEditable & { id: string; baseVersionId: string; revision: number }) | null }
export interface CloudCatalog { items: CloudSummary[]; errors: Partial<Record<"user" | "workspace", string>> }
export interface RepositoryName { name: string | null; error: string | null }
const malformed = () => Error("Codex Cloud 返回了无法识别的数据。");
function string(value: unknown, nonempty = true): string { if (typeof value !== "string" || (nonempty && !value)) throw malformed(); return value; }
function optionalString(value: unknown): string | null { return value == null ? null : string(value, false); }
function repositories(value: any): CloudRepository[] {
  if (!Array.isArray(value)) throw malformed();
  return value.map(repo => {
    if (repo?.depth != null && (!Number.isInteger(repo.depth) || repo.depth < 1 || repo.depth > 2147483647)) throw malformed();
    return { id: string(repo?.repository_id), ref: string(repo?.ref), ...(repo.depth == null ? {} : { depth: repo.depth }) };
  });
}
export function parseCloudSummary(value: any): CloudSummary {
  if (!value || !["private", "workspace"].includes(value.share_settings) || (value.is_owner != null && typeof value.is_owner !== "boolean") ||
    (value.version_revision != null && (!Number.isInteger(value.version_revision) || value.version_revision <= 0))) throw malformed();
  return { id: string(value.id), name: string(value.name, false), versionId: string(value.version_id), shareSettings: value.share_settings,
    repositories: repositories(value.repositories), ...(value.is_owner == null ? {} : { isOwner: value.is_owner }) };
}
export function parseCloudPage(value: any): { items: CloudSummary[]; cursor: string | null } {
  if (!Array.isArray(value?.data) || (value.next_cursor !== null && typeof value.next_cursor !== "string")) throw malformed();
  return { items: value.data.map(parseCloudSummary), cursor: value.next_cursor || null };
}
function parseNetwork(value: any): CloudNetwork {
  if (!value || !["disabled", "unrestricted", "restricted"].includes(value.type)) throw malformed();
  if (value.type !== "restricted") return { type: value.type, hosts: [], packageManagers: false };
  if (!Array.isArray(value.egress_rules) || (value.presets != null && (!Array.isArray(value.presets) || value.presets.some((preset: any) => preset !== "package_managers")))) throw malformed();
  return { type: "restricted", hosts: value.egress_rules.map((rule: any) => string(rule?.host)), packageManagers: value.presets?.includes("package_managers") ?? false };
}
function parseSecrets(value: any): CloudSecret[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw malformed();
  return value.map(secret => {
    if (!secret || !["environment", "user_provided"].includes(secret.source)) throw malformed();
    const target = secret.target;
    const variable = target?.environment_variable;
    const header = target?.http_header;
    const domains = variable != null ? target.allowed_domains ?? [] : header?.allowed_domains;
    if (!Array.isArray(domains)) throw malformed();
    return { name: string(secret.name), source: secret.source, target: variable != null ? string(variable) : string(header?.header_name),
      domains: domains.map((domain: unknown) => string(domain, false)), error: secret.error == null ? null : string(secret.error.code) };
  });
}
function parseEditable(value: any): CloudEditable {
  const cwd = optionalString(value.cwd); if (cwd != null && !cwd.startsWith("/")) throw malformed();
  return { repositories: repositories(value.repositories), network: parseNetwork(value.network_policy), installScript: optionalString(value.install_script),
    cwd, startSkill: optionalString(value.start_skill), secrets: parseSecrets(value.secrets) };
}
export function parseCloudDetail(value: any, id: string, draftId?: string): CloudDetail {
  const summary = parseCloudSummary(value); if (summary.id !== id) throw Error("环境详情与请求身份不匹配，请重试。");
  let draft: CloudDetail["draft"] = null;
  if (value.draft != null) {
    if (!Number.isInteger(value.draft.revision) || value.draft.revision < 0) throw malformed();
    draft = { ...parseEditable(value.draft), id: string(value.draft.id), baseVersionId: string(value.draft.base_version_id), revision: value.draft.revision };
  }
  if (draftId && draft?.id !== draftId) throw Error("环境草稿与请求身份不匹配，请重试。");
  return { ...summary, ...parseEditable(value), status: string(value.status), draft };
}
export function filterCloudCatalog(items: CloudSummary[], query: string, names: Record<string, RepositoryName>): CloudSummary[] {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => item.name.toLocaleLowerCase().includes(search) || item.repositories.some(repo => names[repo.id]?.name?.toLocaleLowerCase().includes(search)));
}
export async function loadCloudCatalog(identity: ServiceIdentity, signal: AbortSignal): Promise<CloudCatalog> {
  const scopes = await Promise.all((["user", "workspace"] as const).map(async scope => {
    const items = new Map<string, CloudSummary>(), seen = new Set<string>(); let cursor: string | null = null;
    try {
      do {
        if (signal.aborted) throw Error("请求已取消");
        const page = parseCloudPage(await readCloudService("list", { scope, limit: 100, omitDraft: true, ...(cursor ? { cursor } : {}) }, identity, signal));
        if (signal.aborted) throw Error("请求已取消");
        for (const item of page.items) items.set(item.id, item);
        cursor = page.cursor;
        if (cursor) { if (seen.has(cursor)) throw Error("云端环境目录返回了重复分页游标，请刷新后重试。"); seen.add(cursor); }
      } while (cursor);
      return { scope, items: [...items.values()], error: null };
    } catch (cause) { if (signal.aborted) throw cause; return { scope, items: [...items.values()], error: serviceErrorMessage(cause) }; }
  }));
  const items = new Map<string, CloudSummary>(), errors: CloudCatalog["errors"] = {};
  for (const scope of scopes) { for (const item of scope.items) items.set(item.id, item); if (scope.error) errors[scope.scope] = scope.error; }
  return { items: [...items.values()], errors };
}
export async function loadRepositoryName(id: string, identity: ServiceIdentity, signal: AbortSignal): Promise<RepositoryName> {
  try {
    const body = await readChatgptService("github_repository", { id }, identity, signal) as { repository_full_name?: unknown };
    return { name: string(body?.repository_full_name), error: null };
  } catch (cause) {
    if (signal.aborted) throw cause;
    return { name: null, error: [401, 403, 404].includes((cause as { status?: number })?.status ?? 0) ? "未知仓库" : serviceErrorMessage(cause) };
  }
}
