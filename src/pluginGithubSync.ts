import { accountRead } from "./config";
import { readPluginGithubSync, searchPluginGithubRepositories, writePluginGithubSync, serviceIdentity, type PluginGithubSyncTarget, type ServiceIdentity } from "./chatgptService";
import { pluginAppGithubSyncStatuses, selectPluginAppSync, type PluginAppSyncSnapshot, type PluginAppSyncStatus } from "./pluginAppSync";
import { canonicalMcpAppId } from "./pluginManagementMcp";

export interface GithubSyncRepository {
  id: number;
  name: string;
  description: string | null;
  proof?: { query: string; pageToken: string | null };
}
export interface PluginGithubSyncSnapshot {
  parent: PluginAppSyncSnapshot;
  status: PluginAppSyncStatus;
  linkId: string;
  connectionInstanceId: string;
  repositories: GithubSyncRepository[];
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("代码仓库同步响应格式无效，请重新读取。");
const scopeChanged = () => Object.assign(Error("同步账户或应用已改变，请返回同步页重新读取。"), { code: "github_sync_scope_changed" });
const safeId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validToken = (value: unknown): value is string | null => value === null || typeof value === "string" && value.length <= 16384 && !/[\u0000-\u001f\u007f]/.test(value);

export function pluginGithubSyncStatuses(parent: PluginAppSyncSnapshot): PluginAppSyncStatus[] {
  return pluginAppGithubSyncStatuses(parent);
}

export function githubSyncScope(parent: PluginAppSyncSnapshot, status: PluginAppSyncStatus): string {
  const selected = parent.details.links === null ? null : selectPluginAppSync(parent.details, parent.selectedLinkId, parent.statuses).selectedLink?.id ?? null;
  return JSON.stringify([parent.identity.accountId, parent.identity.userId, parent.identity.generation, parent.details.pluginId, parent.routeAppId, parent.appId,
    selected, status.user_connection_details.connection_instance_id, status.user_connection_details.backing_link_id]);
}

function targetFor(parent: PluginAppSyncSnapshot, status: PluginAppSyncStatus): PluginGithubSyncTarget {
  const matches = pluginGithubSyncStatuses(parent).filter(item => item.user_connection_details.connection_instance_id === status.user_connection_details.connection_instance_id &&
    item.user_connection_details.backing_link_id === status.user_connection_details.backing_link_id);
  const details = matches[0]?.user_connection_details;
  if (matches.length !== 1 || !details?.connection_instance_id || !details.backing_link_id) throw scopeChanged();
  return { pluginId: parent.details.pluginId, appId: parent.routeAppId, resolvedAppId: parent.appId, selectedLinkId: parent.selectedLinkId,
    connectionInstanceId: details.connection_instance_id, backingLinkId: details.backing_link_id };
}

function decodeRepositories(raw: unknown): GithubSyncRepository[] {
  if (!Array.isArray(raw)) throw invalid();
  return raw.map(value => {
    const row = object(value);
    if (!row || !safeId(row.id) || typeof row.name !== "string" || row.description != null && typeof row.description !== "string") throw invalid();
    return { id: row.id, name: row.name, description: (row.description as string | null | undefined) ?? null };
  });
}

function decodeScope(raw: unknown, target: PluginGithubSyncTarget) {
  const body = object(raw);
  if (!body || typeof body.appId !== "string" || canonicalMcpAppId(body.appId) !== canonicalMcpAppId(target.resolvedAppId) || body.linkId !== target.backingLinkId || body.connectionInstanceId !== target.connectionInstanceId) throw scopeChanged();
  return body;
}

async function verifyIdentity(identity: ServiceIdentity, signal: AbortSignal) {
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  const [account, current] = await Promise.all([accountRead(), serviceIdentity(signal)]);
  if (signal.aborted) throw Object.assign(Error("请求已取消"), { code: "cancelled" });
  if (account.account?.type !== "chatgpt" || identity.accountId !== current.accountId || identity.userId !== current.userId || identity.generation !== current.generation ||
    account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Object.assign(Error("读取期间账号发生变化，请重新刷新。"), { code: "account_changed" });
}

export function buildGithubSyncRepositories(baseline: GithubSyncRepository[], pages: GithubSyncRepository[][], query: string): GithubSyncRepository[] {
  const selected = new Set(baseline.map(repo => repo.id)), items = new Map<number, GithubSyncRepository>();
  for (const repo of [...pages.flat(), ...(query === "" ? baseline : [])]) if (!items.has(repo.id)) items.set(repo.id, repo);
  return [...items.values()].sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.name.localeCompare(b.name));
}

export async function loadPluginGithubSync(parent: PluginAppSyncSnapshot, status: PluginAppSyncStatus, signal: AbortSignal): Promise<PluginGithubSyncSnapshot> {
  const target = targetFor(parent, status);
  await verifyIdentity(parent.identity, signal);
  let raw;
  try { raw = await readPluginGithubSync(target, parent.identity, signal); }
  catch (error) { await verifyIdentity(parent.identity, signal); throw error; }
  const body = decodeScope(raw, target), repositories = decodeRepositories(body.repositories);
  await verifyIdentity(parent.identity, signal);
  const unique = new Map<number, GithubSyncRepository>();
  for (const repo of repositories) if (!unique.has(repo.id)) unique.set(repo.id, repo);
  return { parent, status, linkId: target.backingLinkId, connectionInstanceId: target.connectionInstanceId, repositories: [...unique.values()] };
}

export async function searchPluginGithubSync(parent: PluginAppSyncSnapshot, status: PluginAppSyncStatus, query: string, pageToken: string | null, signal: AbortSignal): Promise<{
  repositories: GithubSyncRepository[]; nextToken: string | null;
}> {
  if (typeof query !== "string" || !validToken(pageToken)) throw Object.assign(Error("代码仓库搜索参数无效。"), { code: "invalid_request" });
  const submitted = query.trim(), target = targetFor(parent, status);
  await verifyIdentity(parent.identity, signal);
  let raw;
  try { raw = await searchPluginGithubRepositories(target, submitted, pageToken, parent.identity, signal); }
  catch (error) { await verifyIdentity(parent.identity, signal); throw error; }
  const body = decodeScope(raw, target);
  if (!validToken(body.nextToken)) throw invalid();
  const repositories = decodeRepositories(body.repositories).map(repo => ({ ...repo, proof: { query: submitted, pageToken } }));
  await verifyIdentity(parent.identity, signal);
  return { repositories, nextToken: body.nextToken };
}

export async function savePluginGithubSync(snapshot: PluginGithubSyncSnapshot, selection: GithubSyncRepository[], signal: AbortSignal): Promise<{
  snapshot: PluginGithubSyncSnapshot | null; confirmed: boolean; refreshError: string | null;
}> {
  const target = targetFor(snapshot.parent, snapshot.status), baseline = new Set(snapshot.repositories.map(repo => repo.id));
  const ids = new Set<number>();
  if (!selection.length || selection.length > 5) throw Object.assign(Error("请选择1至5个代码仓库；清空选择需要确认禁用同步。"), { code: "invalid_request" });
  const repositories = selection.map(repo => {
    if (!safeId(repo.id) || ids.has(repo.id) || !baseline.has(repo.id) && (!repo.proof || typeof repo.proof.query !== "string" || !validToken(repo.proof.pageToken))) throw Object.assign(Error("代码仓库选择或来源无效，请重新读取。"), { code: "invalid_request" });
    ids.add(repo.id);
    return baseline.has(repo.id) ? { id: repo.id } : { id: repo.id, query: repo.proof!.query, pageToken: repo.proof!.pageToken };
  });
  await verifyIdentity(snapshot.parent.identity, signal);
  try {
    const result = await writePluginGithubSync(target, repositories, snapshot.parent.identity, signal);
    if (!["accepted", "unknown"].includes(String(object(result.body)?.delivery))) throw invalid();
  } catch (error) {
    if (["invalid_request", "forbidden", "not_found", "ip_not_authorized", "app_not_in_plugin", "github_sync_scope_changed"].includes((error as { code?: string } | null)?.code ?? "")) {
      await verifyIdentity(snapshot.parent.identity, signal); throw error;
    }
    // A POST may already have applied. Read the same configuration; never replay it.
  }
  await verifyIdentity(snapshot.parent.identity, signal);
  let actual: PluginGithubSyncSnapshot;
  try { actual = await loadPluginGithubSync(snapshot.parent, snapshot.status, signal); }
  catch (error) {
    await verifyIdentity(snapshot.parent.identity, signal);
    if ((error as { code?: string } | null)?.code === "github_sync_scope_changed") throw error;
    return { snapshot: null, confirmed: false, refreshError: "无法读取代码仓库同步保存结果，请重新读取后核对。" };
  }
  const confirmed = actual.repositories.length === ids.size && actual.repositories.every(repo => ids.has(repo.id));
  return { snapshot: actual, confirmed, refreshError: confirmed ? null : "代码仓库同步保存结果尚未确认，请重新读取后核对。" };
}
