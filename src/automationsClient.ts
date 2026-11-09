// Frontend client for the Rust automation scheduler.
//
// Contract (implemented by the concurrent Rust task, may not exist yet):
//   automations_scheduler_status() -> { running, now, entries[], activityThreadIds[] }
//   automations_run_now({ id })    -> { threadId }
//   automations_refresh_schedule() -> same as scheduler_status()
//   events: "automation:run-started" { id, name, at }
//           "automation:run-finished" { id, name, status, threadId?, error?, finishedAt }
//
// Every command call throws a recognizable `SchedulerError`. When the backend
// commands are missing (Tauri reports "command ... not found") or the app runs
// outside a Tauri runtime, the error is marked `unavailable` so the UI can show
// the "调度器不可用（后端未就绪）" state and keep CRUD fully functional.
// Event subscription is a safe no-op outside Tauri and never throws.

import { isTauriRuntime, tauriInvoke, tauriListen } from "./bridge";

export type SchedulerRunStatus = "running" | "completed" | "failed" | string;

export interface SchedulerEntry {
  id: string;
  name: string;
  /** automation status from automation.toml: ACTIVE / PAUSED / COMPLETED. */
  status: string;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastThreadId: string | null;
  lastRunUnread: boolean;
  nextRunAt: number | null;
  /** outcome of the most recent scheduler execution. */
  lastStatus: SchedulerRunStatus | null;
  lastError: string | null;
  runCount: number;
}

export interface SchedulerStatus {
  running: boolean;
  now: number;
  entries: SchedulerEntry[];
  activityThreadIds: string[] | null;
  activityUnreadThreadIds: string[] | null;
}

export interface AutomationRunStartedEvent {
  kind: "started";
  id: string;
  name: string;
  at: number;
}

export interface AutomationRunFinishedEvent {
  kind: "finished";
  id: string;
  name: string;
  status: "completed" | "failed" | "interrupted" | "unknown";
  startedAt: number | null;
  threadId: string | null;
  error: string | null;
  finishedAt: number;
}

export type AutomationRunEvent = AutomationRunStartedEvent | AutomationRunFinishedEvent;

export type SchedulerErrorCode = "SCHEDULER_UNAVAILABLE" | "SCHEDULER_COMMAND_FAILED";

export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;
  readonly command: string;
  readonly unavailable: boolean;
  readonly originalError: unknown;

  constructor(
    command: string,
    message: string,
    unavailable: boolean,
    originalError?: unknown
  ) {
    super(message);
    this.name = "SchedulerError";
    this.command = command;
    this.code = unavailable ? "SCHEDULER_UNAVAILABLE" : "SCHEDULER_COMMAND_FAILED";
    this.unavailable = unavailable;
    this.originalError = originalError;
  }
}

export function isSchedulerError(error: unknown): error is SchedulerError {
  return error instanceof SchedulerError;
}

/** True when the scheduler backend command is missing / the app is not in Tauri. */
export function isSchedulerUnavailableError(error: unknown): boolean {
  return error instanceof SchedulerError && error.unavailable;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function isMissingCommandError(command: string, message: string): boolean {
  const text = message.toLowerCase();
  const cmd = command.toLowerCase();
  if (text.includes("tauri runtime required")) return true;
  if (text.includes("unknown command") || text.includes("no such command")) return true;
  if (text.includes(cmd) && (text.includes("not found") || text.includes("does not exist"))) {
    return true;
  }
  if (text.includes("not implemented") && text.includes(cmd)) return true;
  return false;
}

function normalizeEntry(raw: unknown): SchedulerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id =
    typeof source.id === "string"
      ? source.id
      : typeof source.automationId === "string"
        ? source.automationId
        : "";
  if (!id) return null;
  const rawLastStatus = source.lastStatus ?? source.last_status;
  const rawLastError = source.lastError ?? source.last_error;
  const rawLastThreadId = source.lastThreadId ?? source.last_thread_id;
  return {
    id,
    name: typeof source.name === "string" && source.name ? source.name : id,
    status: typeof source.status === "string" ? source.status : "",
    lastRunAt: toFiniteNumber(source.lastRunAt ?? source.last_run_at),
    lastFinishedAt: toFiniteNumber(source.lastFinishedAt ?? source.last_finished_at),
    lastThreadId: typeof rawLastThreadId === "string" && rawLastThreadId.trim() ? rawLastThreadId : null,
    lastRunUnread: source.lastRunUnread === true,
    nextRunAt: toFiniteNumber(source.nextRunAt ?? source.next_run_at),
    lastStatus: typeof rawLastStatus === "string" ? rawLastStatus : null,
    lastError: typeof rawLastError === "string" ? rawLastError : null,
    runCount: toFiniteNumber(source.runCount ?? source.run_count) ?? 0,
  };
}

function normalizeActivityIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.every(id => typeof id === "string" && id.trim().length > 0)) return null;
  return [...new Set<string>(raw)];
}

function normalizeSchedulerStatus(raw: unknown): SchedulerStatus {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  const entries: SchedulerEntry[] = [];
  for (const candidate of rawEntries) {
    const entry = normalizeEntry(candidate);
    if (entry) entries.push(entry);
  }
  return {
    running: source.running === true || source.isRunning === true,
    now: toFiniteNumber(source.now) ?? Date.now(),
    entries,
    activityThreadIds: normalizeActivityIds(source.activityThreadIds),
    activityUnreadThreadIds: normalizeActivityIds(source.activityUnreadThreadIds),
  };
}

function normalizeRunNowResult(raw: unknown): { threadId: string; startedAt?: number } {
  if (!raw || typeof raw !== "object") return { threadId: "" };
  const source = raw as Record<string, unknown>;
  const threadId = source.threadId ?? source.thread_id;
  return {
    threadId: typeof threadId === "string" ? threadId : "",
    startedAt: toFiniteNumber(source.startedAt) ?? undefined,
  };
}

async function invokeScheduler<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  normalize: (raw: unknown) => T
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new SchedulerError(
      command,
      `当前环境不支持 Tauri 命令（${command}），调度器不可用`,
      true
    );
  }
  try {
    const raw = await tauriInvoke<unknown>(command, args);
    return normalize(raw);
  } catch (error) {
    if (isSchedulerError(error)) throw error;
    const message = describeError(error);
    const unavailable = isMissingCommandError(command, message);
    throw new SchedulerError(
      command,
      unavailable ? `调度器命令未注册（${command}）` : message,
      unavailable,
      error
    );
  }
}

/** Current scheduler snapshot (running flag, scheduler clock, per-automation entries). */
export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  return invokeScheduler("automations_scheduler_status", undefined, normalizeSchedulerStatus);
}

export async function markActivityRunsRead(threadIds: string[], through: number): Promise<number> {
  return invokeScheduler("automations_mark_activity_runs_read", { threadIds, through }, raw => {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      throw new Error("调度器未返回有效的已读结果");
    }
    return raw;
  });
}

export async function markActivityRunRead(automationId: string, startedAt: number, threadId: string): Promise<boolean> {
  return invokeScheduler("automations_mark_activity_run_read", { automationId, startedAt, threadId }, raw => {
    if (typeof raw !== "boolean") throw new Error("调度器未返回有效的单次运行已读结果");
    return raw;
  });
}

/** Ask the scheduler to recompute its plan; returns the fresh status snapshot. */
export async function refreshSchedule(): Promise<SchedulerStatus> {
  return invokeScheduler("automations_refresh_schedule", undefined, normalizeSchedulerStatus);
}

/** Trigger one automation immediately; resolves with the created thread id. */
export async function runAutomationNow(id: string): Promise<{ threadId: string; startedAt?: number }> {
  return invokeScheduler("automations_run_now", { id }, normalizeRunNowResult);
}

function normalizeStartedEvent(payload: unknown): AutomationRunStartedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id : "";
  if (!id) return null;
  return {
    kind: "started",
    id,
    name: typeof source.name === "string" && source.name ? source.name : id,
    at: toFiniteNumber(source.at) ?? Date.now(),
  };
}

function normalizeFinishedEvent(payload: unknown): AutomationRunFinishedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id : "";
  if (!id) return null;
  const rawStatus = typeof source.status === "string" ? source.status.toLowerCase() : "";
  if (!["completed", "failed", "interrupted", "unknown"].includes(rawStatus)) return null;
  const threadId = source.threadId ?? source.thread_id;
  const error = source.error;
  return {
    kind: "finished",
    id,
    name: typeof source.name === "string" && source.name ? source.name : id,
    status: rawStatus as AutomationRunFinishedEvent["status"],
    startedAt: toFiniteNumber(source.startedAt),
    threadId: typeof threadId === "string" && threadId ? threadId : null,
    error: typeof error === "string" && error ? error : null,
    finishedAt: toFiniteNumber(source.finishedAt ?? source.finished_at) ?? Date.now(),
  };
}

/**
 * Subscribe to `automation:run-started` / `automation:run-finished`.
 * Returns an idempotent unsubscribe function. Outside Tauri (or when event
 * registration fails) this is a silent no-op.
 */
export function subscribeAutomationEvents(
  onEvent: (event: AutomationRunEvent) => void
): () => void {
  let disposed = false;
  const unlisteners: Array<() => void> = [];

  const attach = async (
    eventName: string,
    normalize: (payload: unknown) => AutomationRunEvent | null
  ): Promise<void> => {
    try {
      const unlisten = await tauriListen<unknown>(eventName, (payload) => {
        if (disposed) return;
        const event = normalize(payload);
        if (!event) return;
        try {
          onEvent(event);
        } catch {
          // A broken listener must never take down the app.
        }
      });
      if (disposed) {
        try {
          unlisten();
        } catch {
          // ignore
        }
        return;
      }
      unlisteners.push(unlisten);
    } catch {
      // Event bridge unavailable: degrade silently.
    }
  };

  if (isTauriRuntime()) {
    void attach("automation:run-started", normalizeStartedEvent);
    void attach("automation:run-finished", normalizeFinishedEvent);
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    disposed = true;
    const pending = unlisteners.splice(0, unlisteners.length);
    for (const unlisten of pending) {
      try {
        unlisten();
      } catch {
        // ignore
      }
    }
  };
}
