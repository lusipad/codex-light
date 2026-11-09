import type { ThreadSummary } from "./types";
import { isThreadReadState } from "./protocol";

export function threadNeedsAttention(thread: ThreadSummary): boolean {
  const status = thread.status;
  const type = typeof status === "string" ? status : status?.type;
  const flags = typeof status === "object" && status ? status.activeFlags ?? [] : [];
  return (isThreadReadState(thread.readState) && thread.readState.firstUnread != null) ||
    type === "systemError" || type === "waitingOnApproval" || type === "waitingOnUserInput" ||
    flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput");
}

export function activityThreadIsRunning(thread: ThreadSummary): boolean {
  const type = typeof thread.status === "string" ? thread.status : thread.status?.type;
  return type === "active" || type === "running";
}

export function threadHasActivity(thread: ThreadSummary): boolean {
  return threadNeedsAttention(thread) || activityThreadIsRunning(thread);
}

export interface ActivitySession {
  scope: string;
  activatedAt: number;
  threadIds: string[];
  knownThreadIds: string[];
  visibleCount: number;
}

export function excludeActivityThreads(session: ActivitySession | null, ids: string[]): ActivitySession | null {
  return session ? { ...session, threadIds: session.threadIds.filter(id => !ids.includes(id)) } : null;
}

export function clearReadActivityThreads(session: ActivitySession, threads: ThreadSummary[]): ActivitySession {
  const activeIds = new Set(threads.filter(threadHasActivity).map(thread => thread.id));
  const threadIds = session.threadIds.filter(id => activeIds.has(id));
  return threadIds.length === session.threadIds.length ? session : { ...session, threadIds };
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

function activityCandidates(threads: ThreadSummary[]): ThreadSummary[] {
  const priority = (thread: ThreadSummary) => {
    if (threadNeedsAttention({ ...thread, readState: null })) return 0;
    return isThreadReadState(thread.readState) && thread.readState.firstUnread != null ? 1 : 2;
  };
  return threads.filter(threadHasActivity).sort((a, b) => priority(a) - priority(b) ||
    (b.recencyAt ?? b.updatedAt ?? b.createdAt ?? 0) - (a.recencyAt ?? a.updatedAt ?? a.createdAt ?? 0));
}

export function beginActivitySession(threads: ThreadSummary[], scope: string, activatedAt: number): ActivitySession {
  return {
    scope, activatedAt, visibleCount: 10,
    threadIds: [...new Set(activityCandidates(threads).map(thread => thread.id))],
    knownThreadIds: [...new Set(threads.map(thread => thread.id))],
  };
}

export function mergeActivitySession(session: ActivitySession, threads: ThreadSummary[]): ActivitySession {
  const currentIds = new Set(threads.map(thread => thread.id));
  const knownIds = new Set(session.knownThreadIds);
  // app-server timestamps are seconds; the official catalog compares at second precision.
  const created = threads.filter(thread => !knownIds.has(thread.id) &&
    typeof thread.createdAt === "number" && Number.isFinite(thread.createdAt) &&
    thread.createdAt >= Math.floor(session.activatedAt / 1000)).map(thread => thread.id);
  const threadIds = [...new Set([...created, ...session.threadIds.filter(id => currentIds.has(id)),
    ...activityCandidates(threads).map(thread => thread.id)])];
  for (const id of currentIds) knownIds.add(id);
  if (knownIds.size === session.knownThreadIds.length && threadIds.length === session.threadIds.length &&
    threadIds.every((id, index) => id === session.threadIds[index])) return session;
  return { ...session, threadIds, knownThreadIds: [...knownIds] };
}
