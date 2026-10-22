// Codex app-server protocol types & response builders.
// Mirrors `codex app-server generate-json-schema` (codex-cli 0.159.x).
// Keep this file dependency-free so both the app and future tools can import it.

export type RequestId = string | number;

export interface ServerRequestEnvelope {
  id: RequestId;
  method: string;
  params: any;
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export interface NetworkApprovalContext {
  host: string;
  protocol: "http" | "https" | "socks5Tcp" | "socks5Udp";
}

export interface NetworkPolicyAmendment {
  action: "allow" | "deny";
  host: string;
}

export interface CommandAction {
  type: string;
  command: string;
  name?: string;
  path?: string | null;
  query?: string | null;
}

export interface CommandExecutionRequestApprovalParams {
  approvalId?: string | null;
  command?: string | null;
  commandActions?: CommandAction[] | null;
  cwd?: string | null;
  environmentId?: string | null;
  itemId: string;
  kind?: "command" | "writeStdin";
  networkApprovalContext?: NetworkApprovalContext | null;
  proposedExecpolicyAmendment?: string[] | null;
  proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[] | null;
  reason?: string | null;
  startedAtMs: number;
  threadId: string;
  turnId: string;
}

export type CommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: NetworkPolicyAmendment } }
  | "decline"
  | "cancel";

export interface FileChangeRequestApprovalParams {
  grantRoot?: string | null;
  itemId: string;
  reason?: string | null;
  startedAtMs: number;
  threadId: string;
  turnId: string;
}

export type FileChangeApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export interface FileSystemSandboxEntry {
  access: "read" | "write" | "deny";
  path: any;
}

export interface AdditionalFileSystemPermissions {
  entries?: FileSystemSandboxEntry[] | null;
  globScanMaxDepth?: number | null;
  read?: string[] | null;
  write?: string[] | null;
}

export interface AdditionalNetworkPermissions {
  enabled?: boolean | null;
}

export interface RequestedPermissionProfile {
  fileSystem?: AdditionalFileSystemPermissions | null;
  network?: AdditionalNetworkPermissions | null;
}

export interface PermissionsRequestApprovalParams {
  cwd: string;
  environmentId?: string | null;
  itemId: string;
  permissions: RequestedPermissionProfile;
  reason?: string | null;
  startedAtMs: number;
  threadId: string;
  turnId: string;
}

export type PermissionGrantScope = "turn" | "session";

/* ------------------------------------------------------------------ */
/* request_user_input                                                  */
/* ------------------------------------------------------------------ */

export interface ToolRequestUserInputOption {
  label: string;
  description: string;
}

export interface ToolRequestUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options?: ToolRequestUserInputOption[] | null;
  isOther?: boolean;
  isSecret?: boolean;
}

export interface ToolRequestUserInputParams {
  itemId: string;
  threadId: string;
  turnId: string;
  questions: ToolRequestUserInputQuestion[];
  isBlocking: boolean;
  autoResolutionMs?: number | null;
}

export interface ToolRequestUserInputAnswer {
  answers: string[];
}

/* ------------------------------------------------------------------ */
/* Response builders (exact wire shapes required by app-server)        */
/* ------------------------------------------------------------------ */

export function commandApprovalResponse(
  decision: CommandExecutionApprovalDecision
): { decision: CommandExecutionApprovalDecision } {
  return { decision };
}

export function fileChangeApprovalResponse(
  decision: FileChangeApprovalDecision
): { decision: FileChangeApprovalDecision } {
  return { decision };
}

export function permissionsApprovalResponse(
  params: PermissionsRequestApprovalParams,
  scope: PermissionGrantScope,
  granted: boolean,
  strictAutoReview = false
): {
  permissions: RequestedPermissionProfile;
  scope: PermissionGrantScope;
  strictAutoReview: boolean;
} {
  const requested = params.permissions ?? {};
  return {
    permissions: granted
      ? {
          fileSystem: requested.fileSystem ?? null,
          network: requested.network ?? null,
        }
      : { fileSystem: null, network: null },
    scope,
    strictAutoReview,
  };
}

/**
 * Build the exact payload for `item/tool/requestUserInput` responses:
 * `{ answers: { [questionId]: { answers: string[] } } }`
 */
export function userInputResponse(
  answersByQuestion: Record<string, string[] | string | undefined | null>
): { answers: Record<string, ToolRequestUserInputAnswer> } {
  const answers: Record<string, ToolRequestUserInputAnswer> = {};
  for (const [questionId, value] of Object.entries(answersByQuestion)) {
    if (value === undefined || value === null) continue;
    const list = Array.isArray(value) ? value : [value];
    const cleaned = list.map((v) => String(v).trim()).filter(Boolean);
    if (!cleaned.length) continue;
    answers[questionId] = { answers: cleaned };
  }
  return { answers };
}

/* ------------------------------------------------------------------ */
/* Request classification                                              */
/* ------------------------------------------------------------------ */

export type ApprovalKind =
  | "command"
  | "fileChange"
  | "permissions"
  | "userInput"
  | "elicitation"
  | "generic";

export function classifyServerRequest(method: string, params?: any): ApprovalKind {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return "command";
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return "fileChange";
    case "item/permissions/requestApproval":
      return "permissions";
    case "mcpServer/elicitation/request":
      return "elicitation";
    case "item/tool/requestUserInput":
    case "tool/requestUserInput":
    case "ask_user":
      return "userInput";
    default:
      if (params?.questions) return "userInput";
      if (params?.permissions) return "permissions";
      return "generic";
  }
}

/* ------------------------------------------------------------------ */
/* Legacy (v1) review approvals                                        */
/* ------------------------------------------------------------------ */

/**
 * Legacy `execCommandApproval` / `applyPatchApproval` responses use a different
 * decision vocabulary than the v2 `item/*` approval requests.
 * Variants: approved | approved_for_session | approved_mcp_policy_amendment |
 *           denied | timed_out | abort | {approved_execpolicy_amendment} |
 *           {network_policy_amendment}
 */
export type LegacyReviewDecisionValue =
  | "approved"
  | "approved_for_session"
  | "approved_mcp_policy_amendment"
  | "denied"
  | "timed_out"
  | "abort";

export function legacyReviewResponse(
  decision: LegacyReviewDecisionValue
): { decision: LegacyReviewDecisionValue } {
  return { decision };
}

export function isLegacyApprovalMethod(method: string): boolean {
  return method === "execCommandApproval" || method === "applyPatchApproval";
}

/* ------------------------------------------------------------------ */
/* MCP elicitation                                                     */
/* ------------------------------------------------------------------ */

export type McpElicitationAction = "accept" | "decline" | "cancel";

export function elicitationResponse(
  action: McpElicitationAction,
  content?: any
): { action: McpElicitationAction; content?: any } {
  if (action === "accept") {
    return { action, content: content ?? {} };
  }
  return { action };
}

/** Extract a human readable command line regardless of legacy/new shape. */
export function describeCommand(params: any): string {
  if (!params) return "";
  const raw = params.command;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.join(" ");
  if (Array.isArray(params.commandActions) && params.commandActions.length) {
    const action = params.commandActions[0];
    if (typeof action?.command === "string") return action.command;
  }
  return "";
}

/** Legacy approval responses used a different decision vocabulary. */
export function normalizeApprovalDecision(
  kind: ApprovalKind,
  decision: "accept" | "acceptForSession" | "decline" | "cancel"
): any {
  if (kind === "fileChange" && (decision === "acceptForSession")) {
    return fileChangeApprovalResponse(decision);
  }
  if (kind === "command" || kind === "fileChange") {
    return { decision };
  }
  return { decision };
}

/* ------------------------------------------------------------------ */
/* Notification helpers                                                */
/* ------------------------------------------------------------------ */

/** Notification methods the UI cares about, grouped for the dispatcher. */
export const NOTIFICATION = {
  TURN_STARTED: "turn/started",
  TURN_COMPLETED: "turn/completed",
  TURN_DIFF_UPDATED: "turn/diff/updated",
  TURN_PLAN_UPDATED: "turn/plan/updated",
  TURN_MODERATION: "turn/moderationMetadata",
  ITEM_STARTED: "item/started",
  ITEM_COMPLETED: "item/completed",
  ITEM_AGENT_DELTA: "item/agentMessage/delta",
  ITEM_REASONING_TEXT_DELTA: "item/reasoning/textDelta",
  ITEM_REASONING_SUMMARY_DELTA: "item/reasoning/summaryTextDelta",
  ITEM_REASONING_SUMMARY_PART: "item/reasoning/summaryPartAdded",
  ITEM_COMMAND_OUTPUT_DELTA: "item/commandExecution/outputDelta",
  ITEM_COMMAND_TERMINAL_INTERACTION: "item/commandExecution/terminalInteraction",
  ITEM_FILE_CHANGE_DELTA: "item/fileChange/outputDelta",
  ITEM_FILE_CHANGE_PATCH: "item/fileChange/patchUpdated",
  ITEM_MCP_PROGRESS: "item/mcpToolCall/progress",
  ITEM_PLAN_DELTA: "item/plan/delta",
  ITEM_AUTO_REVIEW_STARTED: "item/autoApprovalReview/started",
  ITEM_AUTO_REVIEW_COMPLETED: "item/autoApprovalReview/completed",
  SERVER_REQUEST_RESOLVED: "serverRequest/resolved",
  THREAD_STARTED: "thread/started",
  THREAD_STATUS_CHANGED: "thread/status/changed",
  THREAD_ARCHIVED: "thread/archived",
  THREAD_UNARCHIVED: "thread/unarchived",
  THREAD_DELETED: "thread/deleted",
  THREAD_CLOSED: "thread/closed",
  THREAD_REVERTED: "thread/reverted",
  THREAD_NAME_UPDATED: "thread/name/updated",
  THREAD_GOAL_UPDATED: "thread/goal/updated",
  THREAD_GOAL_CLEARED: "thread/goal/cleared",
  THREAD_QUEUE_CHANGED: "thread/queue/changed",
  THREAD_TOKEN_USAGE: "thread/tokenUsage/updated",
  THREAD_SETTINGS_UPDATED: "thread/settings/updated",
  THREAD_COMPACTED: "thread/compacted",
  PROJECT_CHANGED: "project/changed",
  SKILLS_CHANGED: "skills/changed",
  MCP_STATUS_UPDATED: "mcpServer/startupStatus/updated",
  ACCOUNT_UPDATED: "account/updated",
  ACCOUNT_RATE_LIMITS: "account/rateLimits/updated",
  CONFIG_WARNING: "configWarning",
  WARNING: "warning",
  GUARDIAN_WARNING: "guardianWarning",
  DEPRECATION_NOTICE: "deprecationNotice",
  ERROR: "error",
  FS_CHANGED: "fs/changed",
  FUZZY_SESSION_UPDATED: "fuzzyFileSearch/sessionUpdated",
  FUZZY_SESSION_COMPLETED: "fuzzyFileSearch/sessionCompleted",
  MODEL_REROUTED: "model/rerouted",
  HOOK_STARTED: "hook/started",
  HOOK_COMPLETED: "hook/completed",
} as const;

/** Token usage snapshot from `thread/tokenUsage/updated`. */
export interface TokenUsageSnapshot {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  contextWindow?: number;
  modelContextWindow?: number;
  percentRemaining?: number;
  [key: string]: any;
}

/** Merge sparse token-usage updates (server sends rolling partial snapshots). */
export function mergeTokenUsage(
  prev: TokenUsageSnapshot | null,
  next: any
): TokenUsageSnapshot | null {
  if (!next || typeof next !== "object") return prev;
  const patch = next.tokenUsage ?? next.usage ?? next;
  return { ...(prev ?? {}), ...patch };
}

/** Merge sparse rate-limit updates. */
export function mergeRateLimits(prev: any, next: any): any {
  if (!next || typeof next !== "object") return prev;
  return { ...(prev ?? {}), ...next };
}
