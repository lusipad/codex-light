// Thread goal protocol helpers (`thread/goal/*`).
// Official Codex drives autonomous goals server-side: the client sets the goal,
// then starts a turn whose prompt is `/goal <objective>`; the server keeps
// working across turns and reports progress through `thread/goal/updated`.
import { callAppServer } from "./bridge";

export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget?: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface GoalSetPatch {
  objective?: string;
  status?: ThreadGoalStatus;
  tokenBudget?: number | null;
}

export async function goalGet(threadId: string): Promise<ThreadGoal | null> {
  const res = await callAppServer<{ goal: ThreadGoal | null }>("thread/goal/get", {
    threadId,
  });
  return res?.goal ?? null;
}

export async function goalSet(
  threadId: string,
  patch: GoalSetPatch
): Promise<ThreadGoal | null> {
  const res = await callAppServer<{ goal: ThreadGoal | null }>("thread/goal/set", {
    threadId,
    ...patch,
  });
  return res?.goal ?? null;
}

export async function goalClear(threadId: string): Promise<void> {
  await callAppServer("thread/goal/clear", { threadId });
}

/** `/goal <objective>` is the prompt convention the official app uses to kick off a goal turn. */
export function buildGoalPrompt(objective: string): string {
  const trimmed = objective.trim();
  return `/goal ${trimmed}`;
}

export function goalStatusLabel(status: ThreadGoalStatus | string | null): string {
  switch (status) {
    case "active":
      return "进行中";
    case "paused":
      return "已暂停";
    case "blocked":
      return "受阻";
    case "usageLimited":
      return "用量受限";
    case "budgetLimited":
      return "预算受限";
    case "complete":
      return "已完成";
    default:
      return String(status ?? "");
  }
}

export function formatGoalTokens(tokens?: number | null): string {
  if (tokens == null || !Number.isFinite(tokens)) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function formatGoalDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
}
