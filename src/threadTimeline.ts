import type { TurnData } from "./types";

type TimelineNotification = { method: string; params: any };

/** Fixed official build h7t: replay buffered notifications after history hydration. */
function prepareHistoryReplay(events: TimelineNotification[], turns: TurnData[]): TimelineNotification[] {
  const key = (method: string, turnId: string, itemId: string, index: number | string = "") => `${method}:${turnId ?? ""}:${itemId}:${index}`;
  const hydratedText = (turnId: string, itemId: string, method: string, index?: number): string | null => {
    const item = turns.find((turn) => turn.id === turnId)?.items.find((item) => item.id === itemId);
    if (method === "item/agentMessage/delta" && item?.type === "agentMessage") return item.text ?? null;
    if (method === "item/commandExecution/outputDelta" && item?.type === "commandExecution") return item.aggregatedOutput ?? null;
    if (method === "item/plan/delta" && item?.type === "plan") return item.text ?? null;
    if (item?.type === "reasoning" && index != null) {
      const parts = method === "item/reasoning/summaryTextDelta" ? item.summary : item.content;
      const part = Array.isArray(parts) ? parts[index] : null;
      return typeof part === "string" ? part : part?.text ?? null;
    }
    return null;
  };
  const completed = new Set<string>();
  for (const turn of turns) {
    for (const item of turn.items || []) {
      if (item.id && (item.status === "completed" || item.status === "failed" || item.status === "declined")) {
        completed.add(key("item", turn.id, item.id));
      }
    }
  }
  const deltas = new Map<string, { text: string; hydrated: string | null; remaining: number }>();
  const isDelta = (method: string) => method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta" || method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta" || method === "item/plan/delta";
  for (const { method, params } of events) {
    if (method === "item/completed" && params.item?.id) {
      completed.add(key("item", params.turnId, params.item.id));
    } else if (isDelta(method)) {
      const index = params.summaryIndex ?? params.contentIndex;
      const id = key(method, params.turnId, params.itemId, index);
      const entry = deltas.get(id);
      if (entry) entry.text += params.delta;
      else deltas.set(id, { text: params.delta, hydrated: hydratedText(params.turnId, params.itemId, method, index), remaining: 0 });
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
    if (method === "item/started" && params.item) {
      const hydrated = turns.find(turn => turn.id === params.turnId)?.items.find(item => item.id === params.item.id);
      if (hydrated && hydrated.type === params.item.type) {
        if (params.item.type === "reasoning" || params.item.type === "commandExecution") {
          const fields = params.item.type === "reasoning" ? ["summary", "content"] : ["aggregatedOutput"];
          const item = { ...params.item };
          for (const field of fields) if (item[field] == null || item[field].length === 0) item[field] = hydrated[field];
          event = { ...event, params: { ...params, item } };
        } else if (params.item.type === "fileChange") {
          const item = { ...params.item };
          if ((item.changes == null || item.changes.length === 0) && hydrated.changes && hydrated.changes.length > 0) {
            item.changes = hydrated.changes;
          }
          event = { ...event, params: { ...params, item } };
        } else if (params.item.type === "mcpToolCall") {
          const item = { ...params.item };
          if (item.result == null && hydrated.result != null) item.result = hydrated.result;
          if (item.error == null && hydrated.error != null) item.error = hydrated.error;
          event = { ...event, params: { ...params, item } };
        } else if (params.item.type === "plan") {
          const item = { ...params.item };
          if (!item.text && hydrated.text) item.text = hydrated.text;
          event = { ...event, params: { ...params, item } };
        }
      }
    }
    if (method === "item/fileChange/patchUpdated" || method === "item/mcpToolCall/progress") {
      if (completed.has(key("item", params.turnId, params.itemId))) continue;
    }
    if (!isDelta(method)) { result.push(event); continue; }
    const id = key(method, params.turnId, params.itemId, params.summaryIndex ?? params.contentIndex);
    if (completed.has(key("item", params.turnId, params.itemId))) continue;
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
  let index = turns.findIndex((turn) => turn.id === turnId);
  if (index < 0) {
    const pendingIndex = turns.findIndex((turn) => turn.id.startsWith("pending-") || turn.id.startsWith("user-"));
    if (pendingIndex >= 0) {
      index = pendingIndex;
      turns = turns.map((t, i) => i === pendingIndex ? { ...t, id: turnId } : t);
    }
  }
  const turn = index < 0 ? { id: turnId, status: "running", items: [] } : turns[index];
  const items = [...turn.items];
  let itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) {
    const candidate = update({ id: itemId });
    if (candidate?.type === "userMessage" || candidate?.type === "user") {
      const optimisticIdx = items.findIndex(
        (it) => (it.type === "userMessage" || it.type === "user") && (it.id?.startsWith("u-") || it.id?.startsWith("pending-"))
      );
      if (optimisticIdx >= 0) {
        itemIndex = optimisticIdx;
      }
    }
  }
  const item = { ...update(itemIndex < 0 ? { id: itemId } : items[itemIndex]), id: itemId };
  if (itemIndex < 0) items.push(item); else items[itemIndex] = item;
  const next = { ...turn, items };
  return index < 0 ? [...turns, next] : turns.map((value, i) => i === index ? next : value);
}

export function isCurrentThreadRequest(request: number, currentRequest: number, threadId: string, activeThreadId: string | null): boolean {
  return request === currentRequest && threadId === activeThreadId;
}

export function recordPatchAutoReviewDenial(turns: TurnData[], params: any): TurnData[] {
  const { reviewId, turnId, targetItemId, action, review } = params ?? {};
  if (action?.type !== "applyPatch" || review?.status !== "denied"
    || typeof reviewId !== "string" || !reviewId || typeof targetItemId !== "string" || !targetItemId) return turns;
  const turn = turns.find(candidate => candidate.id === turnId);
  const id = `automatic-approval-review:${reviewId}`;
  if (!turn || turn.items.some(item => item.id === id)) return turns;
  const rationale = typeof review.rationale === "string" ? review.rationale : undefined;
  return mergeTimelineItem(turns, turn.id, id, () => ({ type: "patchAutoReviewDenial", targetItemId, rationale }));
}
