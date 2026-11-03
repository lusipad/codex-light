import type { TurnData } from "./types";

export interface ShareThreadHistory {
  id: string;
  name?: string;
  cwd: string | null;
  turns: TurnData[];
}

type HistoryRequest = (method: string, params: Record<string, unknown>) => Promise<unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTurn(value: unknown): value is TurnData {
  return record(value) && typeof value.id === "string" && value.id.length > 0 &&
    (value.itemsView == null || value.itemsView === "full") && Array.isArray(value.items) &&
    value.items.every(item => record(item) && typeof item.type === "string");
}

/** Read the share's complete history independently of the renderer's recent-turn cache. */
export async function readShareThreadHistory(
  options: { threadId: string; signal: AbortSignal; assertCurrent?: () => void },
  request: HistoryRequest,
): Promise<ShareThreadHistory> {
  const checkCurrent = () => {
    if (options.signal.aborted) throw Error("分享已取消。");
    options.assertCurrent?.();
  };
  checkCurrent();
  if (!options.threadId.trim()) throw Error("无法确认要分享的会话。");
  const metadata = await request("thread/read", { threadId: options.threadId, includeTurns: false });
  checkCurrent();
  const readMetadata = (response: unknown) => {
    const thread = record(response) && record(response.thread) ? response.thread : null;
    if (!thread || thread.id !== options.threadId ||
      (thread.cwd !== null && typeof thread.cwd !== "string") ||
      (thread.name != null && typeof thread.name !== "string")) {
      throw Error("无法确认分享会话的信息，请重新打开会话。");
    }
    return thread;
  };
  let thread = readMetadata(metadata);
  const turns: TurnData[] = [];
  const turnIds = new Set<string>();
  const append = (data: unknown) => {
    if (!Array.isArray(data) || !data.every(isTurn)) throw Error("无法完整读取会话历史，请重试。");
    for (const turn of data as TurnData[]) {
      if (turnIds.has(turn.id)) throw Error("会话历史出现重复轮次，请重试。");
      turnIds.add(turn.id);
      turns.push(turn);
    }
  };
  // This client currently connects to the local host. Older local history modes
  // use a second full read; never resume execution just to obtain a share.
  if (thread.historyMode !== "paginated") {
    const full = await request("thread/read", { threadId: options.threadId, includeTurns: true });
    checkCurrent();
    thread = readMetadata(full);
    if (thread.historyMode === "paginated") throw Error("会话历史模式发生变化，请重试。");
    append(thread.turns);
    return {
      id: options.threadId, cwd: thread.cwd as string | null,
      ...(typeof thread.name === "string" ? { name: thread.name } : {}), turns,
    };
  }
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    checkCurrent();
    const page = await request("thread/turns/list", {
      threadId: options.threadId, limit: 5, sortDirection: "asc", itemsView: "full",
      ...(cursor === undefined ? {} : { cursor }),
    });
    checkCurrent();
    if (!record(page) || !Array.isArray(page.data) || !page.data.every(isTurn) ||
      (page.nextCursor != null && (typeof page.nextCursor !== "string" || !page.nextCursor))) {
      throw Error("无法完整读取会话历史，请重试。");
    }
    append(page.data);
    cursor = page.nextCursor as string | undefined ?? undefined;
    if (cursor !== undefined) {
      if (cursors.has(cursor)) throw Error("会话历史分页游标重复，请重试。");
      cursors.add(cursor);
    }
  } while (cursor !== undefined);
  checkCurrent();
  return {
    id: options.threadId, cwd: thread.cwd as string | null,
    ...(typeof thread.name === "string" ? { name: thread.name } : {}), turns,
  };
}
