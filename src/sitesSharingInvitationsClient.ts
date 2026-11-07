import { readChatgptService, serviceIdentity, writeSiteSharingRecipient, type SiteSharingWriteResult } from "./chatgptService";
import { normalizeSiteSharingInviteEmail, parseSiteSharingUsers, parseSiteSharingGroups, parseSiteSharingTeamsPage, type SiteSharingInviteCandidate } from "./siteSharingInvitationData";
import type { SiteSharingMemberTarget } from "./siteSharingData";
import type { SitesClientAccess } from "./sitesClient";
import type { SiteSharingContext } from "./sitesSharingClient";

function allowed(access: SitesClientAccess, signal: AbortSignal) { signal.throwIfAborted(); if (!access.enabled) throw Error("当前账号不可使用站点。"); }
async function current(access: SitesClientAccess, signal: AbortSignal) {
  signal.throwIfAborted(); const identity = await serviceIdentity(signal);
  if (identity.accountId !== access.identity.accountId || identity.userId !== access.identity.userId || identity.generation !== access.identity.generation)
    throw Object.assign(Error("读取期间账号发生变化，请刷新权限。"), { code: "account_changed" });
}
export async function searchSiteSharingUsers(access: SitesClientAccess, context: SiteSharingContext, query: string, signal: AbortSignal): Promise<SiteSharingInviteCandidate[]> {
  allowed(access, signal); if (!context.workspace) throw Error("当前账号不可搜索工作区成员。");
  const q = query.trim(); if (!q) return [];
  await current(access, signal);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const result = parseSiteSharingUsers(await readChatgptService("sites_users", { query: q }, access.identity, combined));
  combined.throwIfAborted(); await current(access, signal); return result;
}
export async function searchSiteSharingGroups(access: SitesClientAccess, context: SiteSharingContext, query: string, signal: AbortSignal): Promise<SiteSharingInviteCandidate[]> {
  allowed(access, signal); if (!context.workspace || context.workspaceGroupsAllowed !== true) throw Error("当前账号不可搜索工作区群组。");
  const q = query.trim(); if (!q) return [];
  await current(access, signal);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const result = parseSiteSharingGroups(await readChatgptService("sites_groups", { query: q }, access.identity, combined));
  combined.throwIfAborted(); await current(access, signal); return result;
}
function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function readSiteSharingTeams(access: SitesClientAccess, context: SiteSharingContext, signal: AbortSignal): Promise<SiteSharingInviteCandidate[]> {
  allowed(access, signal); if (access.workspaceTeamsAllowed !== true || !context.workspace || context.teamsAllowed !== true) throw Error("当前账号不可读取工作区团队。");
  for (let failures = 0; ; failures++) {
    try {
      const result: SiteSharingInviteCandidate[] = [];
      for (let offset = 0; ; offset += 100) {
        await current(access, signal);
        if (access.workspaceTeamsAllowed !== true || context.teamsAllowed !== true) throw Object.assign(Error("工作区团队权限发生变化。"), { code: "account_changed" });
        const raw = await readChatgptService("sites_teams", { offset }, access.identity, signal);
        await current(access, signal);
        const page = parseSiteSharingTeamsPage(raw, access.identity.accountId); result.push(...page.items);
        if (!page.hasMore) return result;
      }
    } catch (error) {
      signal.throwIfAborted(); const failure = error as { status?: number; code?: string };
      if (failure?.code === "account_changed" || failures >= 3 || typeof failure?.status === "number" && ![408, 425, 429].includes(failure.status) && !(failure.status >= 500 && failure.status <= 599)) throw error;
      await retryDelay(Math.min(1000 * 2 ** failures, 30000), signal);
    }
  }
}
export async function writeSiteSharingInvitation(access: SitesClientAccess, id: string, target: SiteSharingMemberTarget, signal: AbortSignal): Promise<SiteSharingWriteResult> {
  allowed(access, signal);
  const email = target.kind === "email" ? normalizeSiteSharingInviteEmail(target.email) : null;
  if (target.kind === "email" ? !email : !target.id) throw Error("邀请身份无效。");
  await current(access, signal);
  try {
    const result = await writeSiteSharingRecipient(id, target.kind === "email"
      ? { operation: "share_email_invite", email: email! }
      : { operation: "share_recipient", recipient: target.id, recipient_type: target.kind, role: "viewer" }, access.identity, signal);
    await current(access, signal); return result;
  } catch (cause) {
    const error = cause as { code?: string; status?: number };
    if (!signal.aborted && error?.status != null && error.status >= 400 && error.status < 500 && error.code !== "sites_settings_unknown") throw cause;
    throw Object.assign(Error("共享邀请结果未确认，请先刷新权限。"), { code: "site_sharing_unconfirmed", status: error?.status, cause });
  }
}
