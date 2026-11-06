import { accountRead } from "./config";
import { readAccountNotifications, writeAccountNotification, serviceIdentity, type ServiceIdentity } from "./chatgptService";

export interface AccountNotificationSetting {
  category: string; name: string; description: string;
  options: { channel: string; name: string; enabled: boolean }[];
}
export interface AccountNotificationSnapshot {
  identity: ServiceIdentity | null;
  access: "allowed" | "denied";
  settings: AccountNotificationSetting[];
  contacts: { email: boolean; sms: boolean } | null;
  contactsError: boolean;
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) =>
  a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;

export function decodeNotificationSettings(value: unknown): AccountNotificationSetting[] {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.settings)) throw Error("通知设置响应格式无效。");
  const categories = new Set<string>();
  return raw.settings.map(value => {
    const row = record(value);
    if (!row || typeof row.category !== "string" || !row.category || categories.has(row.category) ||
      typeof row.name !== "string" || typeof row.description !== "string" || !Array.isArray(row.options)) throw Error("通知设置响应格式无效。");
    categories.add(row.category);
    const channels = new Set<string>();
    const options = row.options.map(value => {
      const option = record(value);
      if (!option || typeof option.channel !== "string" || !option.channel || channels.has(option.channel) ||
        typeof option.name !== "string" || typeof option.enabled !== "boolean") throw Error("通知渠道响应格式无效。");
      channels.add(option.channel);
      return { channel: option.channel, name: option.name, enabled: option.enabled };
    });
    return { category: row.category, name: row.name, description: row.description, options };
  });
}

export async function loadAccountNotifications(signal: AbortSignal): Promise<AccountNotificationSnapshot> {
  const readAccount = async () => {
    if (signal.aborted) throw Error("请求已取消");
    try { return await accountRead(); }
    catch {
      if (signal.aborted) throw Error("请求已取消");
      throw Object.assign(Error("无法加载你的账户信息。"), { code: "notifications_account_unavailable" });
    }
  };
  const account = await readAccount();
  if (signal.aborted) throw Error("请求已取消");
  const denied: AccountNotificationSnapshot = { identity: null, access: "denied", settings: [], contacts: null, contactsError: false };
  if (account.account?.type !== "chatgpt") return denied;
  const identity = await serviceIdentity(signal);
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取期间账号发生变化，请重新刷新。");
  const body = record(await readAccountNotifications(identity, signal));
  if (!body || !["allowed", "denied"].includes(String(body.access)) || typeof body.contactsError !== "boolean") throw Error("通知访问资格响应格式无效。");
  const settings = decodeNotificationSettings(body);
  const contacts = record(body.contacts);
  if (body.contacts !== null && (!contacts || typeof contacts.email !== "boolean" || typeof contacts.sms !== "boolean")) throw Error("联系方式资格响应格式无效。");
  if (body.access === "denied" && settings.length) throw Error("通知访问资格响应格式无效。");
  const after = await readAccount(), current = await serviceIdentity(signal);
  if (signal.aborted) throw Error("请求已取消");
  if (JSON.stringify(account) !== JSON.stringify(after) || !sameIdentity(identity, current)) throw Error("读取期间账号发生变化，请重新刷新。");
  return { identity, access: body.access as "allowed" | "denied", settings,
    contacts: contacts ? { email: contacts.email as boolean, sms: contacts.sms as boolean } : null, contactsError: body.contactsError };
}

export async function updateAccountNotification(category: string, channel: string, enabled: boolean,
  identity: ServiceIdentity, signal: AbortSignal): Promise<{ settings: AccountNotificationSetting[] | null; verification: "confirmed" | "pending" }> {
  const result = await writeAccountNotification(category, channel, enabled, identity, signal);
  const settings = result.readback === null ? null : decodeNotificationSettings(result.readback);
  if (result.verification === "confirmed" && settings?.find(row => row.category === category)?.options.find(option => option.channel === channel)?.enabled !== enabled) {
    throw Error("通知设置读回与提交值不符，请重新读取。");
  }
  return { settings, verification: result.verification as "confirmed" | "pending" };
}
