import { useEffect, useRef, useState } from "react";
import { accountRead, accountRateLimitsRead } from "./config";
import { tauriListen } from "./bridge";
import { readChatgptService, serviceErrorMessage, serviceIdentity } from "./chatgptService";

export interface UsageWindow { key: string; minutes: number; remaining: number | null; resetsAt: number | null }
export interface UsageGroup { key: string; name: string | null; windows: UsageWindow[] }
export interface UsageCredits { available: boolean | null; unlimited: boolean | null; balance: string | null }
export interface UsageSnapshot {
  mode: "chatgpt" | "signed-out" | "other";
  plan: string | null;
  source: "service" | "connection" | null;
  groups: UsageGroup[];
  credits: UsageCredits | null;
  warning: string | null;
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const flag = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;

function windows(value: unknown, raw: boolean): UsageWindow[] {
  const snapshot = object(value);
  return ["primary", "secondary"].flatMap(role => {
    const bucket = object(snapshot[raw ? `${role}_window` : role]);
    const duration = number(bucket[raw ? "limit_window_seconds" : "windowDurationMins"]);
    if (duration === null || duration <= 0) return [];
    const used = number(bucket[raw ? "used_percent" : "usedPercent"]);
    const reset = number(bucket[raw ? "reset_at" : "resetsAt"]);
    return [{ key: role, minutes: raw ? duration / 60 : duration,
      remaining: used === null || used < 0 ? null : Math.max(0, Math.min(100, 100 - used)),
      resetsAt: reset !== null && reset >= 0 ? reset : null }];
  }).sort((a, b) => a.minutes - b.minutes);
}

function credits(value: unknown, raw: boolean): UsageCredits | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = object(value);
  return { available: flag(entry[raw ? "has_credits" : "hasCredits"]), unlimited: flag(entry.unlimited), balance: text(entry.balance) };
}

export function normalizeServiceUsage(value: unknown): Pick<UsageSnapshot, "groups" | "credits" | "plan"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error("用量数据格式不可用，请重试。");
  const raw = object(value);
  const groups: UsageGroup[] = [];
  if (raw.rate_limit && typeof raw.rate_limit === "object") groups.push({ key: "core", name: null, windows: windows(raw.rate_limit, true) });
  if (Array.isArray(raw.additional_rate_limits)) raw.additional_rate_limits.forEach((value, index) => {
    const entry = object(value), name = text(entry.limit_name);
    if (name && entry.rate_limit && typeof entry.rate_limit === "object") groups.push({ key: `additional-${index}`, name, windows: windows(entry.rate_limit, true) });
  });
  return { groups, credits: credits(raw.credits, true), plan: text(raw.plan_type) };
}

export function normalizeConnectionUsage(value: unknown): Pick<UsageSnapshot, "groups" | "credits"> {
  const raw = object(value), entries = Object.entries(object(raw.rateLimitsByLimitId));
  const snapshots = entries.length ? entries : raw.rateLimits ? [["core", raw.rateLimits] as [string, unknown]] : [];
  const groups = snapshots.map(([key, value]) => {
    const snapshot = object(value);
    return { key, name: text(snapshot.limitName), windows: windows(snapshot, false) };
  });
  // Credit snapshots belong to individual limits; do not add them together.
  const core = snapshots.find(([key, value]) => key === "codex" || key === "core" || !text(object(value).limitName));
  return { groups, credits: core ? credits(object(core[1]).credits, false) : null };
}

export function defaultUsageGroups(groups: UsageGroup[]): UsageGroup[] {
  const core = groups.find(group => group.name === null);
  const spark = groups.find(group => group.name?.toLowerCase().replace(/[_\s.]+/g, "-") === "gpt-5-3-codex-spark");
  return [core, spark].filter((group): group is UsageGroup => group !== undefined);
}

export async function loadUsageSnapshot(signal: AbortSignal): Promise<UsageSnapshot> {
  const before = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  const base: UsageSnapshot = { mode: before.account?.type === "chatgpt" ? "chatgpt" : before.account ? "other" : "signed-out",
    plan: before.account?.type === "chatgpt" ? before.account.planType : null,
    source: null, groups: [], credits: null, warning: null };
  if (base.mode !== "chatgpt") return base;
  const [service, connection] = await Promise.allSettled([
    (async () => { const identity = await serviceIdentity(signal); return readChatgptService("wham_usage", {}, identity, signal); })(),
    accountRateLimitsRead(),
  ]);
  if (signal.aborted) throw Error("请求已取消");
  const after = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("读取期间账号发生变化，请重新刷新。");
  if (service.status === "fulfilled" && service.value !== null) {
    const result = normalizeServiceUsage(service.value);
    return { ...base, ...result, plan: result.plan ?? base.plan, source: "service" };
  }
  base.warning = service.status === "rejected" ? serviceErrorMessage(service.reason) : "当前账号的使用情况暂不可用。";
  if (connection.status === "fulfilled") {
    const accountId = before.workspaceRouting?.chatgptAccountId;
    if (accountId && connection.value.accountId && connection.value.accountId !== accountId) throw Error("额度所属账号发生变化，请重新刷新。");
    return { ...base, ...normalizeConnectionUsage(connection.value), source: "connection" };
  }
  return { ...base, warning: `${base.warning} 当前连接的用量限制也未能读取。` };
}

export function useAccountUsage(accountIdentity: string | undefined, connectionIdentity: string) {
  const identity = JSON.stringify([accountIdentity, connectionIdentity]);
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [viewIdentity, setViewIdentity] = useState(identity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0), pending = useRef<AbortController | null>(null);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const refresh = async () => {
    const version = ++epoch.current, captured = identity;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    const current = () => version === epoch.current && currentIdentity.current === captured && !controller.signal.aborted;
    setData(null); setViewIdentity(captured); setError(null); setLoading(true);
    try { const result = await loadUsageSnapshot(controller.signal); if (current()) setData(result); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "使用情况读取失败，请重试。"); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const subscribe = (event: string, handler: (event: any) => void) => void tauriListen(event, handler)
      .then(stop => { if (disposed) stop(); else stops.push(stop); }).catch(() => {
        if (!disposed) setError("无法监听用量更新，请重新读取。");
      });
    subscribe("app-server:notification", event => {
      if (!disposed && ["account/updated", "account/rateLimits/updated"].includes(event.method)) void refresh();
    });
    subscribe("app-server:status", status => {
      if (disposed) return;
      if (status.connected) void refresh();
      else { epoch.current++; pending.current?.abort(); setData(null); setError("连接已断开，请重新连接后重试。"); setLoading(false); }
    });
    void refresh();
    return () => { disposed = true; epoch.current++; pending.current?.abort(); stops.forEach(stop => stop()); };
  }, [identity]);
  const visible = viewIdentity === identity;
  return { data: visible ? data : null, loading: visible && loading, error: visible ? error : null, refresh };
}
