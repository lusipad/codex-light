/**
 * app-server `hooks/*` protocol client.
 *
 * - `hooks/list` is read-only: hooks are defined in `~/.codex/hooks.json` or the
 *   `[hooks]` tables of `config.toml` (user / project / managed layers).
 * - Live hook runs are streamed as `hook/started` and `hook/completed`
 *   notifications through the Tauri `app-server:notification` event.
 *
 * Every helper talks to the app-server through `callAppServer` / `tauriListen`.
 * Outside the Tauri runtime the invoke/listen plumbing throws, so `listHooks`
 * wraps failures in an identifiable `HooksProtocolError` for the UI to degrade,
 * while `subscribeHookEvents` safely returns a no-op unsubscribe function.
 */
import { callAppServer, isTauriRuntime, tauriListen } from "./bridge";

/* ───────────────────────────── protocol types ────────────────────────────── */

export type HookEventName =
  | "preToolUse"
  | "permissionRequest"
  | "postToolUse"
  | "preCompact"
  | "postCompact"
  | "sessionStart"
  | "sessionEnd"
  | "userPromptSubmit"
  | "subagentStart"
  | "subagentStop"
  | "stop"
  | "interrupt";

export type HookSource =
  | "system"
  | "user"
  | "project"
  | "mdm"
  | "sessionFlags"
  | "plugin"
  | "cloudRequirements"
  | "cloudManagedConfig"
  | "legacyManagedConfigFile"
  | "legacyManagedConfigMdm"
  | "unknown";

export type HookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export type HookHandlerType = "command" | "mcpTool" | "prompt" | "agent";

export type HookRunStatus = "running" | "completed" | "failed" | "blocked" | "stopped";

export type HookExecutionMode = "sync" | "async";

export type HookOutputEntryKind = "warning" | "stop" | "feedback" | "context" | "error";

export interface HookOutputEntry {
  kind: HookOutputEntryKind | string;
  text: string;
}

/** Normalized hook definition returned by `hooks/list`. */
export interface HookInfo {
  /** Stable protocol key (sourcePath:event:group:index). */
  id: string;
  /** Best-effort display name (statusMessage / command / server.tool). */
  name: string;
  /** Camel-cased lifecycle event, e.g. "preToolUse". */
  event: HookEventName | string;
  /** Shell command for `command` handlers, `server.tool` for `mcpTool`. */
  command?: string;
  enabled: boolean;
  source?: HookSource | string;
  cwd: string;
  handlerType?: HookHandlerType | string;
  matcher?: string | null;
  timeoutSec?: number;
  trustStatus?: HookTrustStatus | string;
  isManaged?: boolean;
  sourcePath?: string;
  pluginId?: string | null;
  statusMessage?: string | null;
  displayOrder?: number;
  async?: boolean;
  raw?: Record<string, unknown>;
}

export interface HookWarningItem {
  cwd: string;
  message: string;
  /** Present for `errors` entries; null for plain `warnings` strings. */
  path?: string | null;
}

/** One `hooks/list` entry (per requested cwd). */
export interface HookGroup {
  cwd: string;
  hooks: HookInfo[];
  warnings: string[];
  errors: HookWarningItem[];
}

export interface HooksListResult {
  /** Flattened hooks across all groups. */
  hooks: HookInfo[];
  /** Hooks grouped by the cwd that was queried. */
  groups: HookGroup[];
  /** Flattened warnings (parse problems, unsupported hook types, ...). */
  warnings: HookWarningItem[];
  /** Flattened errors. */
  errors: HookWarningItem[];
}

/** Normalized `hook/started` / `hook/completed` live event. */
export interface HookLiveEvent {
  kind: "started" | "completed";
  /** `HookRunSummary.id` — used to merge started → completed records. */
  hookId?: string;
  /** No dedicated name field in the protocol; UI resolves it from HookInfo by id. */
  hookName?: string;
  eventName?: HookEventName | string;
  status?: HookRunStatus | string;
  handlerType?: HookHandlerType | string;
  source?: HookSource | string;
  sourcePath?: string;
  statusMessage?: string | null;
  entries?: HookOutputEntry[];
  /** Epoch milliseconds (normalized from seconds when needed). */
  startedAtMs?: number | null;
  completedAtMs?: number | null;
  durationMs?: number | null;
  threadId?: string;
  turnId?: string | null;
  /** Local clock time when the notification was received. */
  receivedAt: number;
  payload: Record<string, unknown>;
}

/* ──────────────────────────────── errors ────────────────────────────────── */

/** Thrown by `listHooks` (and by `subscribeHookEvents` when listening fails). */
export class HooksProtocolError extends Error {
  readonly method: string;
  readonly cause?: unknown;

  constructor(method: string, cause: unknown) {
    super(
      `app-server ${method} 调用失败: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "HooksProtocolError";
    this.method = method;
    this.cause = cause;
  }
}

export function isHooksProtocolError(err: unknown): err is HooksProtocolError {
  return err instanceof HooksProtocolError;
}

/* ───────────────────────────── normalization ─────────────────────────────── */

interface RawHooksListEntry {
  cwd?: unknown;
  hooks?: unknown;
  warnings?: unknown;
  errors?: unknown;
}

function toRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function basenameFromCommand(command: string): string | undefined {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return undefined;
  const cleaned = firstToken.replace(/^["']|["']$/g, "");
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || undefined;
}

function deriveHookName(input: {
  eventName: string;
  handlerType?: string;
  command?: string;
  server?: string;
  tool?: string;
  statusMessage?: string | null;
}): string {
  const statusMessage = (input.statusMessage || "").trim();
  if (statusMessage) return statusMessage;
  if (input.handlerType === "command" && input.command) {
    return basenameFromCommand(input.command) || input.command;
  }
  if (input.handlerType === "mcpTool") {
    if (input.server && input.tool) return `${input.server}.${input.tool}`;
    if (input.server) return input.server;
    if (input.tool) return input.tool;
  }
  if (input.eventName) return `${input.eventName} hook`;
  return "hook";
}

function normalizeHook(raw: unknown, cwd: string): HookInfo | null {
  const item = toRecord(raw);
  if (Object.keys(item).length === 0) return null;
  const eventName = typeof item.eventName === "string" ? item.eventName : "";
  const handlerType =
    typeof item.handlerType === "string" ? item.handlerType : undefined;
  const command =
    typeof item.command === "string" && item.command.trim()
      ? item.command.trim()
      : undefined;
  const server = typeof item.server === "string" ? item.server : undefined;
  const tool = typeof item.tool === "string" ? item.tool : undefined;
  const displayOrder =
    typeof item.displayOrder === "number" ? item.displayOrder : undefined;
  const id =
    typeof item.key === "string" && item.key
      ? item.key
      : `${cwd}:${eventName}:${displayOrder ?? 0}`;
  const statusMessage =
    typeof item.statusMessage === "string" ? item.statusMessage : null;

  let commandLabel = command;
  if (handlerType === "mcpTool" && server && tool && !commandLabel) {
    commandLabel = `mcp:${server}.${tool}`;
  }

  return {
    id,
    name: deriveHookName({
      eventName,
      handlerType,
      command,
      server,
      tool,
      statusMessage,
    }),
    event: eventName,
    command: commandLabel,
    enabled: item.enabled !== false,
    source: typeof item.source === "string" ? item.source : undefined,
    cwd,
    handlerType,
    matcher: typeof item.matcher === "string" ? item.matcher : null,
    timeoutSec:
      typeof item.timeoutSec === "number" ? item.timeoutSec : undefined,
    trustStatus:
      typeof item.trustStatus === "string" ? item.trustStatus : undefined,
    isManaged: item.isManaged === true,
    sourcePath: typeof item.sourcePath === "string" ? item.sourcePath : undefined,
    pluginId: typeof item.pluginId === "string" ? item.pluginId : null,
    statusMessage,
    displayOrder,
    async: item.async === true,
    raw: item,
  };
}

function normalizeWarnings(value: unknown, cwd: string): HookWarningItem[] {
  const items: HookWarningItem[] = [];
  if (!Array.isArray(value)) return items;
  for (const entry of value) {
    if (typeof entry === "string" && entry) {
      items.push({ cwd, message: entry, path: null });
    }
  }
  return items;
}

function normalizeErrors(value: unknown, cwd: string): HookWarningItem[] {
  const items: HookWarningItem[] = [];
  if (!Array.isArray(value)) return items;
  for (const entry of value) {
    const record = toRecord(entry);
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof entry === "string"
          ? entry
          : "";
    if (!message) continue;
    items.push({
      cwd,
      message,
      path: typeof record.path === "string" ? record.path : null,
    });
  }
  return items;
}

function normalizeHooksList(entries: unknown): HooksListResult {
  const groups: HookGroup[] = [];
  const hooks: HookInfo[] = [];
  const warnings: HookWarningItem[] = [];
  const errors: HookWarningItem[] = [];

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const entry = toRecord(rawEntry) as RawHooksListEntry;
    const cwd = typeof entry.cwd === "string" ? entry.cwd : "";
    const groupWarnings = normalizeWarnings(entry.warnings, cwd);
    const groupErrors = normalizeErrors(entry.errors, cwd);
    const groupHooks = (
      Array.isArray(entry.hooks) ? entry.hooks : []
    )
      .map((rawHook) => normalizeHook(rawHook, cwd))
      .filter((hook): hook is HookInfo => hook !== null);

    groups.push({
      cwd,
      hooks: groupHooks,
      warnings: groupWarnings.map((warning) => warning.message),
      errors: groupErrors,
    });
    hooks.push(...groupHooks);
    warnings.push(...groupWarnings);
    errors.push(...groupErrors);
  }

  return { hooks, groups, warnings, errors };
}

function toEpochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  // Protocol timestamps are int64; epoch seconds (~1.7e9) vs milliseconds (~1.7e12).
  return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
}

function normalizeHookEvent(
  kind: "started" | "completed",
  params: unknown
): HookLiveEvent {
  const record = toRecord(params);
  const run = toRecord(record.run);
  const startedAtMs = toEpochMs(run.startedAt);
  const completedAtMs = toEpochMs(run.completedAt);
  let durationMs: number | null = null;
  if (typeof run.durationMs === "number" && Number.isFinite(run.durationMs)) {
    durationMs = Math.max(0, Math.round(run.durationMs));
  } else if (startedAtMs != null && completedAtMs != null) {
    durationMs = Math.max(0, completedAtMs - startedAtMs);
  }
  const entries: HookOutputEntry[] = (
    Array.isArray(run.entries) ? run.entries : []
  )
    .map((rawEntry) => {
      const entry = toRecord(rawEntry);
      return typeof entry.text === "string"
        ? { kind: String(entry.kind ?? "context"), text: entry.text }
        : null;
    })
    .filter((entry): entry is HookOutputEntry => entry !== null);

  return {
    kind,
    hookId: typeof run.id === "string" ? run.id : undefined,
    eventName: typeof run.eventName === "string" ? run.eventName : undefined,
    status: typeof run.status === "string" ? run.status : undefined,
    handlerType:
      typeof run.handlerType === "string" ? run.handlerType : undefined,
    source: typeof run.source === "string" ? run.source : undefined,
    sourcePath:
      typeof run.sourcePath === "string" ? run.sourcePath : undefined,
    statusMessage:
      typeof run.statusMessage === "string" ? run.statusMessage : null,
    entries,
    startedAtMs,
    completedAtMs,
    durationMs,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    turnId: typeof record.turnId === "string" ? record.turnId : null,
    receivedAt: Date.now(),
    payload: record,
  };
}

/* ───────────────────────────────── API ──────────────────────────────────── */

/**
 * Read all hooks visible from the given working directories.
 * `hooks/list` is read-only; warnings/errors are returned instead of thrown.
 */
export async function listHooks(cwds: string[]): Promise<HooksListResult> {
  const normalizedCwds = Array.from(
    new Set(
      (Array.isArray(cwds) ? cwds : [])
        .map((cwd) => (typeof cwd === "string" ? cwd.trim() : ""))
        .filter(Boolean)
    )
  );
  try {
    // Empty cwds is valid: app-server falls back to its current session cwd.
    const response = await callAppServer<{ data?: unknown }>("hooks/list", {
      cwds: normalizedCwds,
    });
    return normalizeHooksList(response?.data);
  } catch (err) {
    if (err instanceof HooksProtocolError) throw err;
    throw new HooksProtocolError("hooks/list", err);
  }
}

/**
 * Subscribe to live `hook/started` / `hook/completed` notifications.
 * Returns an idempotent unsubscribe function (no-op outside Tauri).
 */
export async function subscribeHookEvents(
  onEvent: (event: HookLiveEvent) => void
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  try {
    const unlisten = await tauriListen<{ method?: string; params?: unknown }>(
      "app-server:notification",
      (payload) => {
        const method = payload?.method;
        if (method !== "hook/started" && method !== "hook/completed") return;
        try {
          onEvent(
            normalizeHookEvent(
              method === "hook/started" ? "started" : "completed",
              payload?.params
            )
          );
        } catch (err) {
          console.warn("hook 事件处理失败:", err);
        }
      }
    );
    return () => {
      try {
        unlisten();
      } catch {
        /* unlisten is best-effort */
      }
    };
  } catch (err) {
    throw new HooksProtocolError("hook/started|hook/completed", err);
  }
}
