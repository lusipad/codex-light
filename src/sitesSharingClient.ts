import { accountRead } from "./config";
import { readChatgptService, serviceIdentity, writeSiteSharingAccess, writeSiteSharingRecipient, serviceErrorMessage, type SiteSharingWriteResult, type SiteSharingMemberMutation } from "./chatgptService";
import { selectedServiceAccount } from "./serviceAccounts";
import { parseSiteSharing, parseSitePreferredUrl, type SiteSharingPolicy, type SiteSharingMode, type SiteSharingMemberTarget } from "./siteSharingData";
import type { SitesClientAccess } from "./sitesClient";

export interface SiteSharingContext { memberId: string; email: string | null; workspace: boolean; sharingManagementAllowed: boolean; canManageEditors: boolean; canInviteExternal: boolean; externalPermissionError: string | null; workspaceGroupsAllowed: boolean; teamsAllowed: boolean }
// Official Odt/Adt direct-chat plans; distinct from Og/Olt workspace permission categories.
const teamSupportedPlans = new Set(["free", "go", "plus", "pro", "promax", "prolite", "free_workspace", "team", "self_serve_business_prolite", "sci", "rosalind_academic", "business", "enterprise_cbp_trial", "enterprise_cbp_view_only", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "quorum", "enterprise", "hc", "hc_consumption", "deprecated_enterprise", "edu", "deprecated_edu", "k12"]);
const externalPermissionPlans = new Set(["business", "enterprise", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "enterprise_cbp_trial", "enterprise_cbp_view_only", "deprecated_enterprise", "hc", "hc_consumption", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "edu", "deprecated_edu", "k12", "quorum"]);
function allowed(access: SitesClientAccess, signal: AbortSignal) { signal.throwIfAborted(); if (!access.enabled) throw Error("当前账号不可使用站点。"); }
async function current(access: SitesClientAccess, signal: AbortSignal) {
  signal.throwIfAborted(); const identity = await serviceIdentity(signal);
  if (identity.accountId !== access.identity.accountId || identity.userId !== access.identity.userId || identity.generation !== access.identity.generation) throw Error("读取期间账号发生变化，请刷新权限。");
}
export async function readSiteSharingContext(access: SitesClientAccess, signal: AbortSignal): Promise<SiteSharingContext> {
  allowed(access, signal);
  const [body, authentication] = await Promise.all([readChatgptService("share_accounts", {}, access.identity, signal), accountRead()]);
  const entry = selectedServiceAccount(body, access.identity.accountId), account = entry.account;
  if (authentication.account?.type !== "chatgpt" || authentication.workspaceRouting?.chatgptAccountId != null && authentication.workspaceRouting.chatgptAccountId !== access.identity.accountId) throw Error("当前登录身份与站点账号不符。");
  const workspace = account.structure === "workspace", permissionPlan = externalPermissionPlans.has(account.plan_type);
  let permissions: string[] | null = null, externalPermissionError: string | null = null;
  if (access.externalSharingAllowed && workspace && permissionPlan) {
    try {
      const settings = await readChatgptService("sites_workspace_settings", {}, access.identity, signal) as { permissions?: unknown };
      if (!Array.isArray(settings?.permissions) || settings.permissions.some(value => typeof value !== "string")) throw Error("无法确认外部邀请权限。");
      permissions = settings.permissions;
    } catch (error) { signal.throwIfAborted(); externalPermissionError = serviceErrorMessage(error); }
  }
  await current(access, signal);
  return { memberId: account.account_user_id, email: typeof authentication.account.email === "string" ? authentication.account.email : null, workspace,
    sharingManagementAllowed: access.sharingManagementAllowed === true, canManageEditors: workspace && access.sharingManagementAllowed === true,
    canInviteExternal: access.externalSharingAllowed === true && (!permissionPlan || permissions !== null && (account.account_user_role === "account-owner" || permissions.includes("chatgpt.workspace.feature.sites.invite_external.access"))), externalPermissionError,
    workspaceGroupsAllowed: workspace && permissionPlan,
    // Official Windows host zy passes supportedSurface:true. Both account reads have completed here.
    teamsAllowed: workspace && access.workspaceTeamsAllowed === true && teamSupportedPlans.has(account.plan_type)
      && entry.can_access_with_session !== false && account.is_deactivated !== true && authentication.workspaceRouting?.chatgptAccountId === access.identity.accountId };
}
export async function writeSiteSharingMember(access: SitesClientAccess, id: string, target: SiteSharingMemberTarget, role: "viewer" | "editor" | null, signal: AbortSignal): Promise<SiteSharingWriteResult> {
  allowed(access, signal);
  if (![null, "viewer", "editor"].includes(role) || target.kind === "group" && role === "editor" || target.kind === "email" && role !== null) throw Error("当前参与者角色操作不可用。");
  let mutation: SiteSharingMemberMutation;
  if (target.kind === "email") { if (!target.email) throw Error("参与者邮箱缺失。"); mutation = { operation: "share_email_remove", email: target.email }; }
  else { if (!target.id) throw Error("参与者身份缺失。"); mutation = { operation: "share_recipient", recipient: target.id, recipient_type: target.kind, role }; }
  await current(access, signal);
  try {
    const result = await writeSiteSharingRecipient(id, mutation, access.identity, signal);
    await current(access, signal); return result;
  } catch (cause) {
    const error = cause as { code?: string; status?: number };
    if (!signal.aborted && error?.status != null && error.status >= 400 && error.status < 500 && error.code !== "sites_settings_unknown") throw cause;
    throw Object.assign(Error("共享操作结果未确认，请先刷新权限。"), { code: "site_sharing_unconfirmed", status: error?.status, cause });
  }
}
export async function readSiteSharingPolicy(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<SiteSharingPolicy | null> {
  allowed(access, signal); const result = parseSiteSharing(await readChatgptService("sites_share_access", { id }, access.identity, signal));
  await current(access, signal); return result;
}
export async function readSiteSharingUrl(access: SitesClientAccess, id: string, signal: AbortSignal): Promise<string | null> {
  allowed(access, signal); const result = parseSitePreferredUrl(await readChatgptService("sites_preferred_live_url", { id }, access.identity, signal));
  await current(access, signal); return result;
}
export async function writeSiteSharingMode(access: SitesClientAccess, id: string, mode: SiteSharingMode, signal: AbortSignal): Promise<SiteSharingWriteResult> {
  allowed(access, signal); if (!["custom", "workspace_all", "public"].includes(mode)) throw Error("当前共享方式不可保存。");
  await current(access, signal);
  try {
    const result = await writeSiteSharingAccess(id, mode as "custom" | "workspace_all" | "public", access.identity, signal);
    await current(access, signal); return result;
  } catch (cause) {
    const error = cause as { code?: string; status?: number };
    if (!signal.aborted && error?.status != null && error.status >= 400 && error.status < 500 && error.code !== "sites_settings_unknown") throw cause;
    throw Object.assign(Error("共享操作结果未确认，请先刷新权限。"), { code: "site_sharing_unconfirmed", status: error?.status, cause });
  }
}
