import type { TurnData } from "./types";

type TimelineNotification = { method: string; params: any };

/** Fixed official build h7t: replay buffered notifications after history hydration. */
function prepareHistoryReplay(events: TimelineNotification[], turns: TurnData[]): TimelineNotification[] {
  const key = (method: string, turnId: string, itemId: string) => `${method}:${turnId ?? ""}:${itemId}`;
  const hydratedText = (turnId: string, itemId: string, method: string): string | null => {
    const item = turns.find((turn) => turn.id === turnId)?.items.find((item) => item.id === itemId);
    if (method === "item/agentMessage/delta" && item?.type === "agentMessage") return item.text ?? null;
    if (method === "item/commandExecution/outputDelta" && item?.type === "commandExecution") return item.aggregatedOutput ?? null;
    return null;
  };
  const completed = new Set<string>();
  const deltas = new Map<string, { text: string; hydrated: string | null; remaining: number }>();
  const isDelta = (method: string) => method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta";
  for (const { method, params } of events) {
    if (method === "item/completed" && params.item?.type === "agentMessage") {
      completed.add(key("item/agentMessage/delta", params.turnId, params.item.id));
    } else if (isDelta(method)) {
      const id = key(method, params.turnId, params.itemId);
      const entry = deltas.get(id);
      if (entry) entry.text += params.delta;
      else deltas.set(id, { text: params.delta, hydrated: hydratedText(params.turnId, params.itemId, method), remaining: 0 });
    }
  }
  for (const entry of deltas.values()) entry.remaining = entry.hydrated?.endsWith(entry.text) ? entry.text.length : 0;
  const result: TimelineNotification[] = [];
  for (let event of events) {
    const { method, params } = event;
    if (method === "item/started" && params.item?.type === "agentMessage" && params.item.text === "") {
      const entry = deltas.get(key("item/agentMessage/delta", params.turnId, params.item.id));
      const text = entry ? entry.hydrated : hydratedText(params.turnId, params.item.id, "item/agentMessage/delta");
      if (text != null && (!entry || entry.remaining > 0)) event = { ...event, params: { ...params, item: { ...params.item, text } } };
    }
    if (!isDelta(method)) { result.push(event); continue; }
    const id = key(method, params.turnId, params.itemId);
    if (method === "item/agentMessage/delta" && completed.has(id)) continue;
    const entry = deltas.get(id);
    const skip = Math.min(entry?.remaining ?? 0, params.delta.length);
    if (entry) entry.remaining -= skip;
    const delta = params.delta.slice(skip);
    if (delta) result.push({ ...event, params: { ...params, delta } });
  }
  return result;
}

export class ThreadHistoryBuffer {
  private pending: { request: number; threadId: string; events: TimelineNotification[] } | null = null;
  begin(request: number, threadId: string): void { this.pending = { request, threadId, events: [] }; }
  discard(): void { this.pending = null; }
  capture(event: TimelineNotification, request: number): boolean {
    const params = event.params ?? {};
    const threadId = params.threadId ?? params.thread_id;
    if (!this.pending || this.pending.request !== request || this.pending.threadId !== threadId) return false;
    const method = event.method === "codex/event/agent_message_delta" ? "item/agentMessage/delta" : event.method;
    const normalized = {
      ...params,
      threadId,
      turnId: params.turnId ?? params.turn?.id ?? params.turn_id,
      ...(method === "item/agentMessage/delta" ? { delta: params.delta || params.text || "" } : {}),
    };
    // Legacy text without an explicit item identity cannot be applied safely.
    if (method === "item/agentMessage/delta" && (!normalized.turnId || !normalized.itemId)) return true;
    this.pending.events.push({ ...event, method, params: normalized });
    return true;
  }
  release(request: number, threadId: string, turns: TurnData[]): TimelineNotification[] | null {
    if (!this.pending || this.pending.request !== request || this.pending.threadId !== threadId) return null;
    const events = this.pending.events;
    this.pending = null;
    return prepareHistoryReplay(events, turns);
  }
}

/** Delta identity is mandatory: never guess the last message or turn. */
export function mergeTimelineItem(turns: TurnData[], turnId: string | undefined, itemId: string | undefined, update: (item: any) => any): TurnData[] {
  if (!turnId || !itemId) return turns;
  const index = turns.findIndex((turn) => turn.id === turnId);
  const turn = index < 0 ? { id: turnId, status: "running", items: [] } : turns[index];
  const items = [...turn.items];
  const itemIndex = items.findIndex((item) => item.id === itemId);
  const item = update(itemIndex < 0 ? { id: itemId } : items[itemIndex]);
  if (itemIndex < 0) items.push(item); else items[itemIndex] = item;
  const next = { ...turn, items };
  return index < 0 ? [...turns, next] : turns.map((value, i) => i === index ? next : value);
}

export function isCurrentThreadRequest(request: number, currentRequest: number, threadId: string, activeThreadId: string | null): boolean {
  return request === currentRequest && threadId === activeThreadId;
}
