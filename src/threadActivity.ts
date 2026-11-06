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

export function threadHasActivity(thread: ThreadSummary): boolean {
  const type = typeof thread.status === "string" ? thread.status : thread.status?.type;
  return threadNeedsAttention(thread) || type === "active" || type === "running";
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
