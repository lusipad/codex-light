interface ServiceAccount {
  account_id: string;
  account_user_id: string;
  account_user_role: string;
  structure: "personal" | "workspace";
  plan_type: string;
  is_zdr: boolean;
  is_deactivated?: boolean | null;
  name?: unknown;
}
interface ServiceAccountEntry {
  account: ServiceAccount;
  can_access_with_session?: boolean | null;
  features?: unknown;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Select from the raw accounts/check response; h_t's reordered flat inventory is a different shape. */
export function selectedServiceAccount(body: unknown, accountId: string): ServiceAccountEntry {
  const invalid = () => Error("账号成员信息不完整或与当前账号不符。");
  if (!object(body) || !object(body.accounts) || !Array.isArray(body.account_ordering)
    || body.account_ordering.some(id => typeof id !== "string" || !id)
    || new Set(body.account_ordering).size !== body.account_ordering.length
    || !body.account_ordering.includes(accountId) || !Object.hasOwn(body.accounts, accountId)) throw invalid();
  const entry = body.accounts[accountId];
  if (!object(entry) || !object(entry.account)) throw invalid();
  const account = entry.account;
  if (account.account_id !== accountId || !accountId
    || ["account_user_id", "account_user_role", "plan_type"].some(key => typeof account[key] !== "string" || !account[key])
    || !["personal", "workspace"].includes(account.structure as string) || typeof account.is_zdr !== "boolean"
    || (entry.can_access_with_session != null && typeof entry.can_access_with_session !== "boolean")
    || (account.is_deactivated != null && typeof account.is_deactivated !== "boolean")) throw invalid();
  return entry as unknown as ServiceAccountEntry;
}
