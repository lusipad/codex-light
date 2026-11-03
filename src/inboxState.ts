import type { InboxNotificationItem } from "./types";

export function restoreInboxHistory(
  saved: unknown,
  current: InboxNotificationItem[],
  changes: { cleared: boolean; allRead: boolean; removed: Set<string> },
): InboxNotificationItem[] {
  const history = Array.isArray(saved) && !changes.cleared
    ? saved.filter((item): item is InboxNotificationItem =>
        item !== null && typeof item === "object" &&
        typeof item.id === "string" && item.id.length > 0 &&
        typeof item.title === "string" && typeof item.subtitle === "string" &&
        typeof item.read === "boolean" &&
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt) &&
        ["automation", "approval", "thread_done", "mention", "goal", "activity"].includes(item.kind) &&
        (item.threadId === undefined || typeof item.threadId === "string"))
    : [];
  const merged = new Map<string, InboxNotificationItem>();
  for (const item of current) {
    if (!merged.has(item.id) && !changes.removed.has(item.id)) merged.set(item.id, item);
  }
  for (const item of history) {
    if (merged.has(item.id) || changes.removed.has(item.id)) continue;
    merged.set(item.id, changes.allRead ? { ...item, read: true } : item);
  }
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}
