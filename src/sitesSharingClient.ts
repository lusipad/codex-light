import { accountRead } from "./config";
import { readChatgptService, serviceIdentity, writeSiteSharingAccess, type SiteSharingWriteResult } from "./chatgptService";
import { selectedServiceAccount } from "./serviceAccounts";
import { parseSiteSharing, parseSitePreferredUrl, type SiteSharingPolicy, type SiteSharingMode } from "./siteSharingData";
import type { SitesClientAccess } from "./sitesClient";

export interface SiteSharingContext { memberId: string; email: string | null; workspace: boolean }
function allowed(access: SitesClientAccess, signal: AbortSignal) { signal.throwIfAborted(); if (!access.enabled) throw Error("当前账号不可使用站点。"); }
async function current(access: SitesClientAccess, signal: AbortSignal) {
  signal.throwIfAborted(); const identity = await serviceIdentity(signal);
  if (identity.accountId !== access.identity.accountId || identity.userId !== access.identity.userId || identity.generation !== access.identity.generation) throw Error("读取期间账号发生变化，请刷新权限。");
}
export async function readSiteSharingContext(access: SitesClientAccess, signal: AbortSignal): Promise<SiteSharingContext> {
  allowed(access, signal);
  const [body, authentication] = await Promise.all([readChatgptService("share_accounts", {}, access.identity, signal), accountRead()]);
  const account = selectedServiceAccount(body, access.identity.accountId).account;
  if (authentication.account?.type !== "chatgpt" || authentication.workspaceRouting?.chatgptAccountId != null && authentication.workspaceRouting.chatgptAccountId !== access.identity.accountId) throw Error("当前登录身份与站点账号不符。");
  await current(access, signal);
  return { memberId: account.account_user_id, email: typeof authentication.account.email === "string" ? authentication.account.email : null, workspace: account.structure === "workspace" };
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
