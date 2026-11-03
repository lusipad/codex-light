import {
  readChatgptService, serviceIdentity, shareAccessBootstrap, type ServiceIdentity,
} from "./chatgptService";

export interface ShareAccount {
  kind: "personal" | "workspace";
  name?: string;
  accountUserId: string;
}
export interface ShareAccess {
  identity: ServiceIdentity;
  gate: boolean;
  account: ShareAccount | null;
}
export interface ShareRecipient {
  id: string;
  label: string;
  secondaryLabel?: string;
  memberCount?: number;
  principal: { principal_id: string; principal_type: "user" | "group" };
}

function object(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A verified full bootstrap snapshot only; not an implementation of Statsig live evaluation. */
export function decodeShareAccess(bootstrap: unknown, accounts: unknown, identity: ServiceIdentity): ShareAccess {
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") throw Error("无法确认分享访问权限。");
  const payload: unknown = JSON.parse(bootstrap.statsigPayload);
  if (!object(payload) || !object(payload.user) || !object(payload.user.customIDs) ||
    payload.user.userID !== identity.userId || payload.user.customIDs.account_id !== identity.accountId ||
    !object(payload.feature_gates) || payload.is_delta === true || payload.isDelta === true ||
    payload.live_overlay != null ||
    ![undefined, "init-v1", "init-v2"].includes(payload.response_format)) {
    throw Error("分享访问权限数据不完整或与当前账号不符。");
  }
  const entry = payload.feature_gates["4157559322"] ?? payload.feature_gates["1016046617"];
  const gate = object(entry) ? entry[payload.response_format === "init-v2" ? "v" : "value"] : undefined;
  if (typeof gate !== "boolean") throw Error("当前账号的分享访问权限尚未确认。");
  if (!gate) return { identity, gate: false, account: null };
  if (!object(accounts) || !Array.isArray(accounts.accounts) || !Array.isArray(accounts.account_ordering) ||
    accounts.account_ordering[0] !== identity.accountId) throw Error("分享账号与当前账号不符。");
  const selected = accounts.accounts.filter((account: unknown) => object(account) && account.id === identity.accountId);
  if (selected.length !== 1) throw Error("无法确认分享账号。");
  const account = selected[0];
  if (!nonempty(account.account_user_id) || !["personal", "workspace"].includes(account.structure) ||
    account.is_deactivated === true || account.can_access_with_session === false ||
    (account.name != null && typeof account.name !== "string")) throw Error("当前账号不支持此分享访问范围。");
  return {
    identity, gate: true,
    account: {
      kind: account.structure, accountUserId: account.account_user_id,
      ...(account.name == null ? {} : { name: account.name }),
    },
  };
}

export async function readShareAccess(signal: AbortSignal): Promise<ShareAccess> {
  const identity = await serviceIdentity(signal);
  const [bootstrap, accounts] = await Promise.all([
    shareAccessBootstrap(identity, signal), readChatgptService("share_accounts", {}, identity, signal),
  ]);
  signal.throwIfAborted();
  return decodeShareAccess(bootstrap, accounts, identity);
}

export function decodeShareRecipients(users: unknown, groups: unknown, accountUserId: string): ShareRecipient[] {
  if (!object(users) || !Array.isArray(users.items) || !object(groups) || !Array.isArray(groups.items)) {
    throw Error("无法读取工作空间成员或群组。");
  }
  const result: ShareRecipient[] = [];
  for (const group of groups.items) {
    if (!object(group) || !nonempty(group.id) || !nonempty(group.name)) throw Error("群组信息不完整。");
    result.push({
      id: `group:${group.id}`, label: group.name,
      ...(Number.isInteger(group.num_members) && group.num_members >= 0 ? { memberCount: group.num_members } : {}),
      principal: { principal_id: group.id, principal_type: "group" },
    });
  }
  for (const user of users.items) {
    if (!object(user) || !nonempty(user.account_user_id) || !nonempty(user.id) ||
      (user.name != null && typeof user.name !== "string") ||
      (user.email != null && typeof user.email !== "string")) throw Error("成员信息不完整。");
    if (user.account_user_id === accountUserId) continue;
    result.push({
      id: `user:${user.account_user_id}`, label: user.name ?? user.email ?? user.id,
      ...(user.email == null ? {} : { secondaryLabel: user.email }),
      principal: { principal_id: user.account_user_id, principal_type: "user" },
    });
  }
  const ids = new Set<string>();
  return result.filter(recipient => !ids.has(recipient.id) && Boolean(ids.add(recipient.id)));
}
