import type { SiteSharingMemberTarget, SiteSharingPolicy } from "./siteSharingData";
import type { SiteSharingContext } from "./sitesSharingClient";

export interface SiteSharingInviteCandidate {
  kind: "user" | "group" | "email"; target: SiteSharingMemberTarget; label: string; email?: string; size?: number;
  source: "users" | "groups" | "teams" | "external";
}
// Fixed official In email schema, preceded by Y's trim/lower. No additional RFC length limits.
export function normalizeSiteSharingInviteEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/.test(email) ? email : null;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => Error("共享目录返回了无法识别的数据。");
function items(raw: unknown): Record<string, unknown>[] {
  if (!object(raw) || !Array.isArray(raw.items) || raw.items.some(value => !object(value))) throw invalid();
  return raw.items;
}
export function parseSiteSharingUsers(raw: unknown): SiteSharingInviteCandidate[] {
  return items(raw).flatMap(entry => {
    if (typeof entry.account_user_id !== "string" || !entry.account_user_id
      || ["email", "name", "id"].some(key => entry[key] != null && typeof entry[key] !== "string")) throw invalid();
    if (entry.email == null) return [];
    const label = entry.name ?? entry.email ?? entry.id;
    if (typeof label !== "string") throw invalid();
    return [{ kind: "user" as const, target: { kind: "user" as const, id: entry.account_user_id }, label, email: entry.email as string, source: "users" as const }];
  });
}
export function parseSiteSharingGroups(raw: unknown): SiteSharingInviteCandidate[] {
  return items(raw).map(entry => {
    if (typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string"
      || entry.num_members != null && (typeof entry.num_members !== "number" || !Number.isFinite(entry.num_members))) throw invalid();
    return { kind: "group", target: { kind: "group", id: entry.id }, label: entry.name, size: entry.num_members as number | null | undefined ?? 0, source: "groups" };
  });
}
export function parseSiteSharingTeamsPage(raw: unknown, accountId: string): { items: SiteSharingInviteCandidate[]; hasMore: boolean } {
  const rows = items(raw);
  if (!object(raw) || typeof raw.has_more !== "boolean") throw invalid();
  const candidates: SiteSharingInviteCandidate[] = [];
  for (const entry of rows) {
    if (typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || typeof entry.workspace_id !== "string") throw invalid();
    if (entry.workspace_id === accountId) candidates.push({ kind: "group", target: { kind: "group", id: entry.id }, label: entry.name, size: 0, source: "teams" });
  }
  return { items: candidates, hasMore: raw.has_more };
}
export function filterSiteSharingInviteCandidates(
  policy: SiteSharingPolicy, context: SiteSharingContext, rawQuery: string,
  lists: { users: SiteSharingInviteCandidate[]; groups: SiteSharingInviteCandidate[]; teams: SiteSharingInviteCandidate[] },
): SiteSharingInviteCandidate[] {
  const query = rawQuery.trim(), memberIds = new Set(policy.users.flatMap(entry => entry.account_user_id == null ? [] : [entry.account_user_id]));
  const groupIds = new Set(policy.groups.map(entry => entry.id));
  const matches = (entry: SiteSharingInviteCandidate) => entry.label.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const teams = context.teamsAllowed === true ? lists.teams.filter(entry => entry.target.kind === "group" && !groupIds.has(entry.target.id) && matches(entry)) : [];
  if (!query) return teams;
  const teamIds = new Set(teams.flatMap(entry => entry.target.kind === "group" ? [entry.target.id] : []));
  const groups = context.workspaceGroupsAllowed === true ? lists.groups.filter(entry => entry.target.kind === "group" && !groupIds.has(entry.target.id) && !teamIds.has(entry.target.id) && matches(entry)) : [];
  const users = context.workspace ? lists.users.filter(entry => entry.target.kind === "user" && entry.target.id !== context.memberId && !memberIds.has(entry.target.id)) : [];
  const email = normalizeSiteSharingInviteEmail(query);
  const existingEmails = [context.email, ...policy.users.map(entry => entry.email), ...users.map(entry => entry.email)];
  const external: SiteSharingInviteCandidate[] = context.canInviteExternal && email && !existingEmails.some(value => value?.trim().toLowerCase() === email)
    ? [{ kind: "email", target: { kind: "email", email }, label: email, email, source: "external" }] : [];
  return [...teams, ...groups, ...users, ...external];
}
