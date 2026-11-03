import { accountRead, type AccountReadResult } from "./config";
import { mutateAccountProfile, readChatgptService, serviceErrorMessage, serviceIdentity, type ProfileMutationResult, type ServiceIdentity } from "./chatgptService";

export type { ProfileMutationResult } from "./chatgptService";
export interface AccountMe { id: string; name: string | null; email: string | null; picture: string | null }
export interface PublicProfile {
  displayName: string | null; bio: string | null; username: string | null;
  profileUrl: string | null; pictureUrl: string | null;
  canEdit: boolean | null; canEditUsername: boolean | null;
}
export interface PublicProfilePage extends PublicProfile { isSelf: boolean | null }
export interface AccountProfileSnapshot {
  account: AccountReadResult; identity: ServiceIdentity | null; me: AccountMe | null;
  profile: PublicProfile | null; page: PublicProfilePage | null;
  errors: { me?: string; profile?: string; page?: string };
}

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const boolean = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function decodeAccountMe(value: unknown, identity: ServiceIdentity): AccountMe | null {
  if (value === null) return null;
  const raw = record(value);
  if (!raw || raw.id !== identity.userId) throw Error("账户资料与当前登录身份不符，请重新读取。");
  return { id: identity.userId, name: string(raw.name), email: string(raw.email), picture: httpsUrl(raw.picture) };
}

export function decodePublicProfile(value: unknown, page: true): PublicProfilePage | null;
export function decodePublicProfile(value: unknown, page?: false): PublicProfile | null;
export function decodePublicProfile(value: unknown, page = false): PublicProfile | PublicProfilePage | null {
  if (value === null) return null;
  const raw = record(value), details = record(raw?.profile_details);
  if (!raw || !details) throw Error("无法识别公开资料，请重新读取。");
  const access = page ? raw : record(raw.viewer_access);
  const usernamePermission = page ? boolean(access?.can_edit_username) : !access ? null : access.can_edit_username == null || access.can_edit_username === true ? true : access.can_edit_username === false ? false : null;
  const result: PublicProfile = { displayName: string(details.display_name), bio: string(details.description), username: string(details.username),
    profileUrl: httpsUrl(details.profile_url), pictureUrl: httpsUrl(details.profile_picture_url),
    canEdit: boolean(access?.can_edit), canEditUsername: usernamePermission };
  return page ? { ...result, isSelf: boolean(raw.is_self) } : result;
}

export function normalizeUsername(value: string): string { return value.trim().replace(/^@/, "").trim(); }
export function usernameValidationMessage(value: string): string | null {
  const name = normalizeUsername(value);
  if (!name) return "请输入用户名";
  if (name.length < 3) return "用户名须至少包含 3 个字符";
  if (name.length > 20) return "用户名不能超过 20 个字符";
  if (!/^[a-z0-9._-]+$/.test(name)) return "请使用 3-20 个小写字母、数字、句点、下划线或连字符";
  if (/^[._-]|[._-]$/.test(name)) return "用户名不能以句点、下划线或连字符开头或结尾";
  return null;
}

export async function loadAccountProfile(signal: AbortSignal): Promise<AccountProfileSnapshot> {
  const account = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  const empty: AccountProfileSnapshot = { account, identity: null, me: null, profile: null, page: null, errors: {} };
  if (account.account?.type !== "chatgpt") return empty;
  const identity = await serviceIdentity(signal);
  const id = account.workspaceRouting?.chatgptAccountId;
  if (id && id !== identity.accountId) throw Error("账户资料与当前登录身份不符，请重新读取。");
  const [me, profile, page] = await Promise.allSettled([
    readChatgptService("account_me", {}, identity, signal).then(raw => decodeAccountMe(raw, identity)),
    readChatgptService("profile_identity", {}, identity, signal).then(raw => decodePublicProfile(raw)),
    readChatgptService("profile_page", {}, identity, signal).then(raw => decodePublicProfile(raw, true)),
  ]);
  if (signal.aborted) throw Error("请求已取消");
  const after = await accountRead(), current = await serviceIdentity(signal);
  if (signal.aborted) throw Error("请求已取消");
  if (JSON.stringify(account) !== JSON.stringify(after) || !sameIdentity(identity, current)) throw Error("读取期间账户发生变化，请重新读取。");
  const result = { ...empty, account: after, identity };
  if (me.status === "fulfilled") result.me = me.value; else result.errors.me = serviceErrorMessage(me.reason);
  if (profile.status === "fulfilled") result.profile = profile.value; else result.errors.profile = serviceErrorMessage(profile.reason);
  if (page.status === "fulfilled") result.page = page.value; else result.errors.page = serviceErrorMessage(page.reason);
  return result;
}

export function updateAccountName(name: string, identity: ServiceIdentity, signal: AbortSignal): Promise<ProfileMutationResult> {
  return mutateAccountProfile("account_name", { name }, identity, signal);
}
export async function checkProfileUsername(username: string, identity: ServiceIdentity, signal: AbortSignal): Promise<{ available: boolean }> {
  const result = await mutateAccountProfile("username_check", { username }, identity, signal);
  const body = record(result.body);
  if (typeof body?.available !== "boolean") throw Error("无法确认用户名是否可用，请重试。");
  return { available: body.available };
}
export function updateProfileUsername(username: string, identity: ServiceIdentity, signal: AbortSignal): Promise<ProfileMutationResult> {
  return mutateAccountProfile("username", { username }, identity, signal);
}
export function updatePublicProfile(fields: { displayName?: string; bio?: string }, identity: ServiceIdentity, signal: AbortSignal): Promise<ProfileMutationResult> {
  const params: Record<string, unknown> = {};
  if (fields.displayName !== undefined) params.display_name = fields.displayName;
  if (fields.bio !== undefined) params.description = fields.bio;
  return mutateAccountProfile("profile", params, identity, signal);
}
