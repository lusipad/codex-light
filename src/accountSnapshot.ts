import { accountRead, accountRateLimitsRead, accountUsageRead, type AccountReadResult, type AccountRateLimitsResult, type AccountUsageResult } from "./config";

function identity(info: AccountReadResult) {
  return JSON.stringify([info.account, info.workspaceRouting ?? null]);
}

export async function loadAccountSnapshot(): Promise<{
  info: AccountReadResult;
  rateLimits: AccountRateLimitsResult | null;
  usage: AccountUsageResult | null;
  error: string | null;
}> {
  const before = await accountRead();
  if (!before.account) return { info: before, rateLimits: null, usage: null, error: null };
  const [rates, usage] = await Promise.allSettled([accountRateLimitsRead(), accountUsageRead()]);
  const after = await accountRead();
  if (identity(before) !== identity(after)) throw Error("读取期间账号发生变化，请重新刷新。");
  const failures: string[] = [];
  let rateLimits: AccountRateLimitsResult | null = null;
  if (rates.status === "fulfilled") {
    const accountId = before.workspaceRouting?.chatgptAccountId;
    if (accountId && rates.value.accountId && accountId !== rates.value.accountId) {
      failures.push("额度所属账号与当前账号不符，请重新刷新。");
    } else rateLimits = rates.value;
  } else failures.push(`额度读取失败：${String(rates.reason)}`);
  if (usage.status === "rejected") failures.push(`用量读取失败：${String(usage.reason)}`);
  return { info: after, rateLimits, usage: usage.status === "fulfilled" ? usage.value : null, error: failures.join(" · ") || null };
}
