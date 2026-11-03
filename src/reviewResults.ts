import type { TurnData } from "./types";
import { isQuickReviewPrompt } from "./reviewFindings";

export interface ReviewRun {
  attempt: number;
  sequence: number;
  startedAt: number | null;
  threadId: string;
  turnId: string | null;
  cwd: string;
  workspaceRoots: string[];
  status: "starting" | "running" | "completed" | "failed" | "interrupted" | "unknown";
  text: string;
  error: string | null;
}

type Notification = { method: string; params: any };
type TrackedRun = { run: ReviewRun; messages: Map<string, string>; completedItems: Set<string> };
const terminal = (status: ReviewRun["status"]) => ["completed", "failed", "interrupted"].includes(status);
const state = (status: unknown): ReviewRun["status"] => {
  if (status === "completed" || status === "failed" || status === "interrupted") return status;
  return ["inProgress", "running", "active"].includes(String(status)) ? "running" : "unknown";
};
const errorText = (error: any): string | null => typeof error === "string" ? error : error?.message ?? null;
const timestamp = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0
  ? value < 1_000_000_000_000 ? value * 1000 : value : null;
function itemText(item: any): string {
  if (typeof item?.text === "string") return item.text;
  const content = item?.input ?? item?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(part => typeof part === "string" ? part : part?.text ?? "").join("\n") : "";
}

// This only retains review results. The main conversation timeline still owns chat rendering.
export function createReviewResults(onChange: (runs: ReviewRun[]) => void) {
  let sequence = 0;
  const tracked: TrackedRun[] = [];
  const early = new Map<number, Notification[]>();
  const getRuns = () => tracked.map(({ run }) => ({ ...run, workspaceRoots: [...run.workspaceRoots] }));
  const publish = () => onChange(getRuns());
  const find = (threadId: string, turnId: string) => tracked.find(entry => entry.run.threadId === threadId && entry.run.turnId === turnId);
  function add(threadId: string, cwd: string, workspaceRoots: readonly string[], turnId: string | null, startedAt: number | null) {
    const entry: TrackedRun = {
      run: { attempt: ++sequence, sequence, startedAt, threadId, turnId, cwd, workspaceRoots: [...workspaceRoots], status: "starting", text: "", error: null },
      messages: new Map(), completedItems: new Set(),
    };
    tracked.push(entry);
    return entry;
  }
  function updateMessage(entry: TrackedRun, item: any, complete: boolean) {
    if (item?.type !== "agentMessage" || typeof item.id !== "string") return;
    if (!complete && entry.completedItems.has(item.id)) return;
    entry.messages.set(item.id, itemText(item));
    if (complete) entry.completedItems.add(item.id);
  }
  function updateText(entry: TrackedRun) {
    entry.run.text = [...entry.messages.values()].at(-1) ?? "";
  }
  function apply(entry: TrackedRun, { method, params }: Notification) {
    if (terminal(entry.run.status)) return;
    if (method === "turn/started") entry.run.status = "running";
    else if (method === "item/started" || method === "item/completed") {
      updateMessage(entry, params.item, method === "item/completed");
    } else if (method === "item/agentMessage/delta") {
      if (typeof params.itemId !== "string" || typeof params.delta !== "string" || entry.completedItems.has(params.itemId)) return;
      entry.messages.set(params.itemId, (entry.messages.get(params.itemId) ?? "") + params.delta);
    } else if (method === "turn/completed") {
      const items = params.turn?.items;
      if (Array.isArray(items)) {
        // A terminal turn carries authoritative item order, unlike completion arrival order.
        const assistants = items.filter(item => item?.type === "agentMessage");
        if (assistants.length) {
          entry.messages.clear();
          assistants.forEach((item, index) => updateMessage(entry, { ...item, id: item.id ?? `turn-item-${index}` }, true));
        }
      }
      const result = state(params.turn?.status ?? params.status);
      entry.run.status = result === "running" ? "unknown" : result;
      entry.run.error = errorText(params.turn?.error ?? params.error);
    } else if (method === "error") {
      entry.run.error = errorText(params.error ?? params);
      if (params.willRetry !== true) entry.run.status = "unknown";
    } else return;
    updateText(entry);
    publish();
  }
  function ingest(payload: Notification) {
    const params = payload.params ?? {};
    const threadId = params.threadId ?? params.turn?.threadId ?? params.thread?.id;
    const turnId = params.turnId ?? params.turn?.id;
    if (typeof threadId !== "string" || typeof turnId !== "string") return;
    const entry = find(threadId, turnId);
    if (entry) apply(entry, payload);
    else {
      // A start response can arrive after its events. Never assign the first seen turn as identity.
      for (const pending of tracked.filter(candidate => candidate.run.threadId === threadId && candidate.run.turnId === null)) {
        early.get(pending.run.attempt)?.push(payload);
      }
    }
  }
  return {
    getRuns,
    begin(threadId: string, cwd: string, workspaceRoots: readonly string[]) {
      const entry = add(threadId, cwd, workspaceRoots, null, Date.now());
      early.set(entry.run.attempt, []);
      publish();
      return entry.run.attempt;
    },
    bind(threadId: string, attempt: number, turnId: string) {
      const entry = tracked.find(candidate => candidate.run.threadId === threadId && candidate.run.attempt === attempt);
      if (!entry || !turnId || entry.run.turnId && entry.run.turnId !== turnId) return;
      const existing = find(threadId, turnId);
      if (existing && existing !== entry) {
        tracked.splice(tracked.indexOf(entry), 1);
        early.delete(attempt);
        publish();
        return;
      }
      entry.run.turnId = turnId;
      if (entry.run.status === "starting") entry.run.status = "running";
      const buffered = early.get(attempt) ?? [];
      early.delete(attempt);
      for (const event of buffered) {
        const id = event.params?.turnId ?? event.params?.turn?.id;
        if (id === turnId) apply(entry, event);
      }
      publish();
    },
    startUnconfirmed(threadId: string, attempt: number, error: unknown) {
      const entry = tracked.find(candidate => candidate.run.threadId === threadId && candidate.run.attempt === attempt);
      if (!entry || terminal(entry.run.status)) return;
      entry.run.status = "unknown";
      entry.run.error = errorText(error) ?? String(error);
      early.delete(attempt);
      publish();
    },
    ingest,
    disconnected() {
      for (const { run } of tracked) {
        if (run.status === "starting" || run.status === "running") run.status = "unknown";
      }
      publish();
    },
    hydrate(threadId: string, cwd: string, workspaceRoots: readonly string[], turns: TurnData[]) {
      for (const turn of turns) {
        if (!turn.id) continue;
        let entry = find(threadId, turn.id);
        if (!entry) {
          if (!turn.items?.some(item => item.type === "userMessage" && isQuickReviewPrompt(itemText(item)))) continue;
          entry = add(threadId, cwd, workspaceRoots, turn.id, timestamp(turn.startedAt));
        }
        const result = state(turn.status);
        if (terminal(entry.run.status) && !terminal(result)) continue;
        const startedAt = timestamp(turn.startedAt);
        if (startedAt !== null) entry.run.startedAt = startedAt;
        entry.run.status = result;
        entry.run.error = errorText(turn.error);
        const assistants = (turn.items ?? []).filter(item => item.type === "agentMessage");
        if (assistants.length) {
          if (terminal(result)) {
            entry.messages.clear();
            entry.completedItems.clear();
          }
          assistants.forEach((item, index) => updateMessage(entry!, { ...item, id: item.id ?? `turn-item-${index}` }, terminal(result)));
        }
        updateText(entry);
      }
      publish();
    },
  };
}
