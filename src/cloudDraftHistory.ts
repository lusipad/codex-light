import { callCloudThread, type ServiceIdentity } from "./chatgptService";
import { tauriListen } from "./bridge";

interface HistoryEntry { id: string; [key: string]: unknown }
interface Page<T> { data: T[]; nextCursor?: string | null }
type Item = HistoryEntry | { item: HistoryEntry; turnId: string; startedAtMs?: number | null; completedAtMs?: number | null };

export async function readCloudDraftHistory(threadId: string, identity: ServiceIdentity, signal: AbortSignal, options: {
  cursor: string | null; turnLimit: number; itemLimit: number;
}) {
  const { cursor, turnLimit, itemLimit } = options;
  if (!Number.isInteger(itemLimit) || itemLimit < 1 || itemLimit > 100) throw Error("云端消息分页上限无效。");
  const page = await callCloudThread({ kind: "turns", threadId, cursor, limit: turnLimit }, identity, signal) as Page<HistoryEntry>;
  if (cursor !== null && page.nextCursor === cursor) throw Error("云端会话历史返回了重复游标。");
  const turns = [];
  const turnIds = new Set<string>();
  let remaining = Math.min(turnLimit, 5) * 100;
  for (const turn of page.data) {
    if (turnIds.has(turn.id)) continue;
    turnIds.add(turn.id);
    const items: HistoryEntry[] = [];
    const completedItemIds = new Set<string>();
    const seenItems = new Set<string>();
    const seenCursors = new Set<string | null>();
    let olderCursor: string | null = null;
    do {
      signal.throwIfAborted();
      if (seenCursors.has(olderCursor) || seenCursors.size >= 100) throw Error("云端消息分页未能推进。");
      if (remaining <= 0) break;
      seenCursors.add(olderCursor);
      const limit = Math.min(100, remaining, itemLimit - items.length);
      const result = await callCloudThread({ kind: "items", threadId, turnId: turn.id, cursor: olderCursor, limit }, identity, signal) as Page<Item>;
      if (result.data.length > limit) throw Error("云端消息分页超过请求上限。");
      for (const entry of result.data) {
        const wrapped = "item" in entry && "turnId" in entry
          ? entry as Extract<Item, { item: HistoryEntry }> : null;
        if (wrapped && wrapped.turnId !== turn.id) throw Error("云端消息所属轮次不匹配。");
        const item = wrapped ? wrapped.item : entry as HistoryEntry;
        if (wrapped?.completedAtMs != null) completedItemIds.add(item.id);
        if (seenItems.has(item.id)) continue;
        seenItems.add(item.id);
        items.push(wrapped?.startedAtMs == null ? item : { ...item, startedAtMs: wrapped.startedAtMs });
        remaining--;
      }
      olderCursor = result.nextCursor ?? null;
      if (olderCursor !== null && seenCursors.has(olderCursor)) throw Error("云端消息返回了重复游标。");
    } while (olderCursor !== null && remaining > 0 && items.length < itemLimit);
    items.reverse();
    const hasLoadedOldest = seenCursors.size > 0 && olderCursor === null;
    turns.push({
      turn: { ...turn, items, itemsView: hasLoadedOldest ? "full" : "summary" },
      completedItemIds,
      pagination: { olderCursor, hasLoadedOldest, newestSnapshotItemId: items.at(-1)?.id },
    });
  }
  signal.throwIfAborted();
  return { turns: turns.reverse(), olderCursor: page.nextCursor ?? null };
}

type History = Awaited<ReturnType<typeof readCloudDraftHistory>>;

export function mergeCloudDraftHistory(current: History, latest: History): History {
  if (!latest.turns.length) return current.turns.length ? current : latest;
  const newestIds = new Set(latest.turns.map(({ turn }) => turn.id));
  const overlap = current.turns.findIndex(({ turn }) => newestIds.has(turn.id));
  if (overlap < 0) return latest;
  const prefix = current.turns.slice(0, overlap);
  const lastOverlap = current.turns.findIndex(({ turn }) => turn.id === latest.turns.at(-1)?.turn.id);
  const suffix = lastOverlap < 0 ? [] : current.turns.slice(lastOverlap + 1);
  return {
    turns: [...prefix, ...latest.turns, ...suffix],
    olderCursor: prefix.length || current.turns[0].turn.id === latest.turns[0].turn.id ? current.olderCursor : latest.olderCursor,
  };
}

export async function watchCloudDraftHistory(
  threadId: string,
  identity: ServiceIdentity,
  signal: AbortSignal,
  restore: () => Promise<History>,
  limits: { turnLimit: number; itemLimit: number },
  callbacks: {
    onInitial: (history: History) => void;
    onRefresh: (history: History) => void;
    onRefreshError: (cause: unknown) => void;
  },
) {
  let ready = false;
  let pending = false;
  let reading = false;
  const refresh = async () => {
    if (!ready || reading) return;
    reading = true;
    try {
      while (pending && !signal.aborted) {
        pending = false;
        try {
          const latest = await readCloudDraftHistory(threadId, identity, signal, { ...limits, cursor: null });
          if (!signal.aborted) callbacks.onRefresh(latest);
        } catch (cause) {
          if (!signal.aborted) callbacks.onRefreshError(cause);
        }
      }
    } finally { reading = false; }
  };
  const requestRefresh = () => {
    if (signal.aborted) return;
    pending = true;
    void refresh();
  };
  signal.throwIfAborted();
  const stop = await tauriListen<{ hostId?: string; identity?: ServiceIdentity; method?: string; params?: { threadId?: string } }>(
    "cloud-app-server:notification", event => {
      if (signal.aborted || event?.hostId !== "durable" || event.params?.threadId !== threadId
        || event.identity?.accountId !== identity.accountId || event.identity.userId !== identity.userId
        || event.identity.generation !== identity.generation
        || (event.method !== "turn/started" && event.method !== "turn/completed")) return;
      requestRefresh();
    },
  );
  if (signal.aborted) {
    stop();
    signal.throwIfAborted();
  }
  signal.addEventListener("abort", stop, { once: true });
  try {
    const history = await restore();
    signal.throwIfAborted();
    callbacks.onInitial(history);
    ready = true;
    void refresh();
    return requestRefresh;
  } catch (cause) {
    signal.removeEventListener("abort", stop);
    if (!signal.aborted) stop();
    throw cause;
  }
}
