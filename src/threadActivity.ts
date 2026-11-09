import type { ThreadSummary } from "./types";
import { isThreadReadState } from "./protocol";

export function threadNeedsAttention(thread: ThreadSummary, scheduledUnread?: ReadonlySet<string> | null): boolean {
  const status = thread.status;
  const type = typeof status === "string" ? status : status?.type;
  const flags = typeof status === "object" && status ? status.activeFlags ?? [] : [];
  return scheduledUnread?.has(thread.id) === true ||
    (isThreadReadState(thread.readState) && thread.readState.firstUnread != null) ||
    type === "systemError" || type === "waitingOnApproval" || type === "waitingOnUserInput" ||
    flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput");
}

export function activityThreadIsRunning(thread: ThreadSummary): boolean {
  const type = typeof thread.status === "string" ? thread.status : thread.status?.type;
  return type === "active" || type === "running";
}

export function threadHasActivity(thread: ThreadSummary, scheduledUnread?: ReadonlySet<string> | null): boolean {
  return threadNeedsAttention(thread, scheduledUnread) || activityThreadIsRunning(thread);
}

export function activityCanMarkRead(thread: ThreadSummary, scheduled?: ReadonlySet<string> | null,
  scheduledUnread?: ReadonlySet<string> | null): boolean {
  const chatUnread = isThreadReadState(thread.readState) && thread.readState.firstUnread != null;
  return scheduled?.has(thread.id) ? scheduledUnread != null && (scheduledUnread.has(thread.id) || chatUnread) : chatUnread;
}

export interface ActivitySession {
  scope: string;
  activatedAt: number;
  threadIds: string[];
  knownThreadIds: string[];
  recentTimes: ReadonlyMap<string, number>;
  visibleCount: number;
}

export function excludeActivityThreads(session: ActivitySession | null, ids: string[]): ActivitySession | null {
  return session ? { ...session, threadIds: session.threadIds.filter(id => !ids.includes(id)) } : null;
}

export function clearReadActivityThreads(session: ActivitySession, threads: ThreadSummary[], pins?: ReadonlySet<string>,
  scheduledUnread?: ReadonlySet<string> | null): ActivitySession {
  const activeIds = new Set(threads.filter(thread => threadHasActivity(thread, scheduledUnread)).map(thread => thread.id));
  const threadIds = session.threadIds.filter(id => activeIds.has(id));
  return threadIds.length === session.threadIds.length ? session
    : rememberActivityRecentTimes({ ...session, threadIds, recentTimes: new Map() }, threads, pins);
}

export interface ActivityRecentGroup {
  dayStart: number;
  label: string;
  threads: ThreadSummary[];
}

function activityRecentEntries(session: ActivitySession, threads: ThreadSummary[], showPriority = true, pins?: ReadonlySet<string>) {
  const cutoff = new Date(session.activatedAt);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 6);
  const priority = new Set(session.threadIds);
  return threads.flatMap(thread => {
    const inPriority = priority.has(thread.id);
    if (pins?.has(thread.id) || (showPriority && inPriority)) return [];
    const time = (showPriority ? session.recentTimes.get(thread.id) : undefined) ??
      (thread.recencyAt ?? thread.updatedAt ?? thread.createdAt ?? 0) * 1000;
    return Number.isFinite(time) && (time >= cutoff.getTime() || inPriority) ? [{ thread, time }] : [];
  });
}

function rememberActivityRecentTimes(session: ActivitySession, threads: ThreadSummary[], pins?: ReadonlySet<string>): ActivitySession {
  const fresh = activityRecentEntries(session, threads, true, pins).filter(({ thread }) => !session.recentTimes.has(thread.id));
  if (!fresh.length) return session;
  const recentTimes = new Map(session.recentTimes);
  for (const { thread, time } of fresh) recentTimes.set(thread.id, time);
  return { ...session, recentTimes };
}

export function activityRecentGroups(session: ActivitySession, threads: ThreadSummary[], now: number,
  showPriority = true, pins?: ReadonlySet<string>): ActivityRecentGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups: ActivityRecentGroup[] = [];
  const seen = new Set<string>();
  for (const { thread, time } of activityRecentEntries(session, threads, showPriority, pins).sort((a, b) => b.time - a.time)) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    const day = new Date(time);
    const dayStart = day.setHours(0, 0, 0, 0);
    const previous = groups.at(-1);
    if (previous?.dayStart === dayStart) {
      previous.threads.push(thread);
    } else {
      const label = dayStart === today.getTime() ? "今天" : dayStart === yesterday.getTime() ? "昨天"
        : day.toLocaleDateString("zh-CN", { weekday: "long" });
      groups.push({ dayStart, label, threads: [thread] });
    }
  }
  return groups;
}

export function restoreActivityThreads(session: ActivitySession, originalOrder: string[], restoredIds: string[],
  threads: ThreadSummary[]): ActivitySession {
  const restored = new Set(restoredIds);
  const available = new Set(threads.map(thread => thread.id));
  const returning = new Set(originalOrder.filter(id => restored.has(id) && available.has(id)));
  if (!returning.size) return session;
  const threadIds = session.threadIds.filter(id => !returning.has(id));
  const retained = new Set(threadIds);
  let index = 0;
  for (const id of originalOrder) {
    if (returning.has(id)) {
      threadIds.splice(index++, 0, id);
    } else if (retained.has(id)) {
      index++;
    }
  }
  return threadIds.every((id, index) => id === session.threadIds[index]) && threadIds.length === session.threadIds.length
    ? session : { ...session, threadIds };
}

function activityCandidates(threads: ThreadSummary[], scheduledUnread?: ReadonlySet<string> | null): ThreadSummary[] {
  const priority = (thread: ThreadSummary) => {
    if (threadNeedsAttention({ ...thread, readState: null })) return 0;
    return threadNeedsAttention(thread, scheduledUnread) ? 1 : 2;
  };
  return threads.filter(thread => threadHasActivity(thread, scheduledUnread)).sort((a, b) => priority(a) - priority(b) ||
    (b.recencyAt ?? b.updatedAt ?? b.createdAt ?? 0) - (a.recencyAt ?? a.updatedAt ?? a.createdAt ?? 0));
}

export function beginActivitySession(threads: ThreadSummary[], scope: string, activatedAt: number,
  pins?: ReadonlySet<string>, scheduledUnread?: ReadonlySet<string> | null): ActivitySession {
  return rememberActivityRecentTimes({
    scope, activatedAt, visibleCount: 10,
    threadIds: [...new Set(activityCandidates(threads, scheduledUnread).map(thread => thread.id))],
    knownThreadIds: [...new Set(threads.map(thread => thread.id))],
    recentTimes: new Map(),
  }, threads, pins);
}

export function mergeActivitySession(session: ActivitySession, threads: ThreadSummary[], pins?: ReadonlySet<string>,
  scheduledUnread?: ReadonlySet<string> | null): ActivitySession {
  const currentIds = new Set(threads.map(thread => thread.id));
  const knownIds = new Set(session.knownThreadIds);
  // app-server timestamps are seconds; the official catalog compares at second precision.
  const created = threads.filter(thread => !knownIds.has(thread.id) &&
    typeof thread.createdAt === "number" && Number.isFinite(thread.createdAt) &&
    thread.createdAt >= Math.floor(session.activatedAt / 1000)).map(thread => thread.id);
  const threadIds = [...new Set([...created, ...session.threadIds.filter(id => currentIds.has(id)),
    ...activityCandidates(threads, scheduledUnread).map(thread => thread.id)])];
  for (const id of currentIds) knownIds.add(id);
  const unchanged = knownIds.size === session.knownThreadIds.length && threadIds.length === session.threadIds.length &&
    threadIds.every((id, index) => id === session.threadIds[index]);
  return rememberActivityRecentTimes(unchanged ? session : { ...session, threadIds, knownThreadIds: [...knownIds] }, threads, pins);
}
