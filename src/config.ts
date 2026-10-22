/**
 * app-server `config/*` (plus `experimentalFeature/*` and `account/*`) protocol client.
 *
 * Every helper below routes through `callAppServer` (Tauri `app_server_call`). When the
 * app-server is not connected — or the call is made outside the Tauri runtime — the
 * underlying invoke throws, and these helpers re-throw it as an identifiable
 * `AppServerProtocolError` so callers (SettingsView) can fall back to the legacy
 * Tauri commands (`config_read` / `config_update` / `config_save_raw`).
 */
import { callAppServer } from "./bridge";

/* ────────────────────────────── config/* types ────────────────────────────── */

export type ConfigMergeStrategy = "replace" | "upsert";

export interface ConfigEdit {
  keyPath: string;
  value: unknown;
  mergeStrategy?: ConfigMergeStrategy;
}

export interface ConfigLayerMetadata {
  name: Record<string, unknown>;
  version: string;
}

export interface ConfigReadResult {
  config: Record<string, unknown>;
  origins: Record<string, ConfigLayerMetadata>;
  layers?: unknown[] | null;
}

export interface ConfigWriteOverriddenMetadata {
  effectiveValue?: unknown;
  message: string;
  overridingLayer: ConfigLayerMetadata;
}

export interface ConfigWriteResult {
  filePath: string;
  status: "ok" | "okOverridden";
  version: string;
  overriddenMetadata?: ConfigWriteOverriddenMetadata | null;
}

export interface ConfigRequirementsResult {
  requirements: Record<string, unknown> | null;
}

export interface ConfigBatchWriteOptions {
  /** Hot-reload the written runtime settings into already-loaded threads. */
  reloadUserConfig?: boolean;
  /** Defaults to the user's ~/.codex/config.toml when null/omitted. */
  filePath?: string | null;
  expectedVersion?: string | null;
}

/** Canonical response type of `config/mcpServer/reload` (empty on success). */
export type McpServerReloadResult = Record<string, unknown>;

/* ──────────────────────── valid config.toml keys (strict) ─────────────────── */

/**
 * Keys that `codex --strict-config` actually accepts and that app-server reads.
 * SettingsView may only ever submit these key paths.
 */
export const VALID_CONFIG_KEYS = {
  model: "model",
  modelProvider: "model_provider",
  reasoningEffort: "model_reasoning_effort",
  approvalPolicy: "approval_policy",
  approvalsReviewer: "approvals_reviewer",
  sandboxMode: "sandbox_mode",
  webSearch: "web_search",
  modelVerbosity: "model_verbosity",
  modelCatalogJson: "model_catalog_json",
  instructions: "instructions",
} as const;

/**
 * Keys that codex does NOT understand (verified with `codex --strict-config`, see
 * docs/research/current-audit.md §0.4). They must never be written again and their
 * UI controls were removed from SettingsView.
 */
export const INVALID_CONFIG_KEYS = [
  "temperature",
  "top_p",
  "max_output_tokens",
  "context_window",
  "web_search_mode",
  "allow_network",
  "max_parallel_tools",
  "subagent_concurrency",
  "output_verbosity",
] as const;

/* ───────────────────── config protocol value enumerations ─────────────────── */

export type ReasoningEffortOption =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export type ApprovalPolicyOption = "untrusted" | "on-request" | "granular" | "never";
export type ApprovalsReviewerOption = "user" | "auto_review" | "guardian_subagent";
export type SandboxModeOption = "read-only" | "workspace-write" | "danger-full-access";
export type ModelVerbosityOption = "low" | "medium" | "high";
export type WebSearchModeOption = "disabled" | "cached" | "indexed" | "live";

/** Advertised by `model/list` (`supportedReasoningEfforts`) on app-server 0.159.0. */
export const REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/** `AskForApproval` accepted by app-server: untrusted | on-request | never | { granular }. */
export const APPROVAL_POLICY_OPTIONS: ApprovalPolicyOption[] = [
  "untrusted",
  "on-request",
  "granular",
  "never",
];

/** `ApprovalsReviewer` enum (guardian_subagent is the legacy compatibility value). */
export const APPROVALS_REVIEWER_OPTIONS: ApprovalsReviewerOption[] = [
  "user",
  "auto_review",
  "guardian_subagent",
];

export const SANDBOX_MODE_OPTIONS: SandboxModeOption[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
];

export const MODEL_VERBOSITY_OPTIONS: ModelVerbosityOption[] = ["low", "medium", "high"];

export const WEB_SEARCH_MODE_OPTIONS: WebSearchModeOption[] = [
  "disabled",
  "cached",
  "indexed",
  "live",
];

/** Object form of `approval_policy = "granular"` (required sub-fields per schema). */
export const GRANULAR_APPROVAL_POLICY = {
  granular: {
    mcp_elicitations: true,
    rules: true,
    sandbox_approval: true,
  },
} as const;

/* ─────────────────────── experimentalFeature/* types ─────────────────────── */

export type ExperimentalFeatureStage =
  | "beta"
  | "underDevelopment"
  | "stable"
  | "deprecated"
  | "removed";

export interface ExperimentalFeature {
  /** Stable key used in config.toml / CLI flag toggles. */
  name: string;
  stage: ExperimentalFeatureStage;
  /** Null when the feature is not in beta. */
  displayName?: string | null;
  description?: string | null;
  announcement?: string | null;
  /** Whether the feature is currently enabled in the loaded config. */
  enabled: boolean;
  defaultEnabled: boolean;
}

export interface ExperimentalFeatureListParams {
  cursor?: string | null;
  limit?: number | null;
  threadId?: string | null;
}

export interface ExperimentalFeatureListResult {
  data: ExperimentalFeature[];
  nextCursor?: string | null;
}

export interface ExperimentalFeatureEnablementResult {
  enablement: Record<string, boolean>;
}

/* ─────────────────────────── account/* types ─────────────────────────────── */

export type AccountPlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "prolite"
  | "promax"
  | "team"
  | "self_serve_business_prolite"
  | "self_serve_business_usage_based"
  | "business"
  | "ent26"
  | "enterprise_cbp_automation"
  | "enterprise_cbp_usage_based"
  | "enterprise"
  | "edu"
  | "edu_plus"
  | "edu_pro"
  | "unknown";

export interface ChatgptAccountInfo {
  type: "chatgpt";
  email?: string | null;
  planType: AccountPlanType;
}

export interface ApiKeyAccountInfo {
  type: "apiKey";
}

export interface AmazonBedrockAccountInfo {
  type: "amazonBedrock";
  usesCodexManagedCredentials?: boolean;
}

export type AccountInfo = ChatgptAccountInfo | ApiKeyAccountInfo | AmazonBedrockAccountInfo;

export interface AccountReadResult {
  account: AccountInfo | null;
  requiresOpenaiAuth: boolean;
  workspaceRouting?: {
    accountRoutingOverride?: string;
    backendOrigin?: string;
    chatgptAccountId?: string;
  } | null;
}

export interface RateLimitWindow {
  /** 0 - 100. */
  usedPercent: number;
  windowDurationMins?: number | null;
  /** Unix seconds. */
  resetsAt?: number | null;
}

export interface RateLimitCreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string | null;
}

export interface RateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  normalModelSlug?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: RateLimitCreditsSnapshot | null;
  individualLimit?: unknown;
  spendControlReached?: boolean | null;
  planType?: AccountPlanType | null;
  rateLimitReachedType?: string | null;
}

export interface RateLimitResetCredit {
  id: string;
  resetType: string;
  status: "available" | "redeeming" | "redeemed" | "unknown";
  grantedAt: number;
  expiresAt?: number | null;
  title?: string | null;
  description?: string | null;
}

export interface AccountRateLimitsResult {
  ordinaryUsageAllowed?: boolean | null;
  rateLimits?: RateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
  rateLimitResetCredits?: {
    availableCount: number;
    credits?: RateLimitResetCredit[] | null;
  } | null;
  accountId?: string | null;
}

export interface AccountUsageSummary {
  lifetimeTokens?: number | null;
  peakDailyTokens?: number | null;
  longestRunningTurnSec?: number | null;
  currentStreakDays?: number | null;
  longestStreakDays?: number | null;
}

export interface AccountUsageDailyBucket {
  /** YYYY-MM-DD (local date reported by the backend). */
  startDate: string;
  tokens: number;
}

export interface AccountUsageResult {
  summary: AccountUsageSummary;
  dailyUsageBuckets?: AccountUsageDailyBucket[] | null;
  threadUsage?: unknown | null;
}

/* ───────────────────────────── error type ────────────────────────────────── */

/** Thrown by every helper in this module when `callAppServer` fails. */
export class AppServerProtocolError extends Error {
  readonly method: string;
  readonly cause?: unknown;

  constructor(method: string, cause: unknown) {
    super(
      `app-server ${method} 调用失败: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "AppServerProtocolError";
    this.method = method;
    this.cause = cause;
  }
}

export function isAppServerProtocolError(err: unknown): err is AppServerProtocolError {
  return err instanceof AppServerProtocolError;
}

async function callProtocol<T>(method: string, params: unknown): Promise<T> {
  try {
    return await callAppServer<T>(method, params);
  } catch (err) {
    if (err instanceof AppServerProtocolError) throw err;
    throw new AppServerProtocolError(method, err);
  }
}

/* ─────────────────────────── config/* helpers ────────────────────────────── */

/** `config/read` — read the effective config (optionally resolved from `cwd` layers). */
export async function configRead(
  cwd?: string,
  includeLayers = false
): Promise<ConfigReadResult> {
  const params: Record<string, unknown> = { includeLayers };
  if (cwd && cwd.trim()) params.cwd = cwd;
  const result = await callProtocol<ConfigReadResult>("config/read", params);
  return {
    config: result?.config && typeof result.config === "object" ? result.config : {},
    origins: result?.origins && typeof result.origins === "object" ? result.origins : {},
    layers: result?.layers ?? null,
  };
}

/** `config/value/write` — write one dotted key path. */
export async function configValueWrite(
  keyPath: string,
  value: unknown,
  mergeStrategy: ConfigMergeStrategy = "replace"
): Promise<ConfigWriteResult> {
  return callProtocol<ConfigWriteResult>("config/value/write", {
    keyPath,
    value,
    mergeStrategy,
    filePath: null,
    expectedVersion: null,
  });
}

/** `config/batchWrite` — write several dotted key paths in one transaction. */
export async function configBatchWrite(
  edits: ConfigEdit[],
  opts: ConfigBatchWriteOptions = {}
): Promise<ConfigWriteResult> {
  return callProtocol<ConfigWriteResult>("config/batchWrite", {
    edits: edits.map((edit) => ({
      keyPath: edit.keyPath,
      value: edit.value,
      mergeStrategy: edit.mergeStrategy ?? "replace",
    })),
    reloadUserConfig: opts.reloadUserConfig === true,
    filePath: opts.filePath ?? null,
    expectedVersion: opts.expectedVersion ?? null,
  });
}

/**
 * Write valid config keys and hot-reload them into loaded threads.
 * SettingsView uses this as the primary save path; callers must only pass valid keys.
 */
export async function setConfigKeys(edits: ConfigEdit[]): Promise<ConfigWriteResult> {
  return configBatchWrite(edits, { reloadUserConfig: true });
}

/** `configRequirements/read` — managed requirements (requirements.toml / MDM). */
export async function configRequirementsRead(): Promise<ConfigRequirementsResult> {
  const result = await callProtocol<ConfigRequirementsResult>(
    "configRequirements/read",
    {}
  );
  return { requirements: result?.requirements ?? null };
}

/** `config/mcpServer/reload` — reload MCP server definitions after config changes. */
export async function mcpServerReload(): Promise<McpServerReloadResult> {
  return callProtocol<McpServerReloadResult>("config/mcpServer/reload", {});
}

/** Read a dotted path (e.g. "model_reasoning_effort") out of a config object. */
export function getConfigValue(
  config: Record<string, unknown> | null | undefined,
  dottedKey: string
): unknown {
  if (!config || !dottedKey) return undefined;
  let current: unknown = config;
  for (const part of dottedKey.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/* ─────────────────── experimentalFeature/* helpers ───────────────────────── */

/** `experimentalFeature/list` — one page of feature flags. */
export async function experimentalFeatureList(
  params: ExperimentalFeatureListParams = {}
): Promise<ExperimentalFeatureListResult> {
  const result = await callProtocol<ExperimentalFeatureListResult>(
    "experimentalFeature/list",
    {
      cursor: params.cursor ?? null,
      limit: params.limit ?? null,
      threadId: params.threadId ?? null,
    }
  );
  return {
    data: Array.isArray(result?.data) ? result.data : [],
    nextCursor: result?.nextCursor ?? null,
  };
}

/** Read every experimental feature, following `nextCursor` pages (152 on 0.159.0). */
export async function experimentalFeatureListAll(
  pageSize = 500,
  maxPages = 20
): Promise<ExperimentalFeature[]> {
  const all: ExperimentalFeature[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await experimentalFeatureList({ cursor, limit: pageSize });
    all.push(...result.data);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return all;
}

/** `experimentalFeature/enablement/set` — process-wide runtime enablement toggles. */
export async function experimentalFeatureSetEnablement(
  enablement: Record<string, boolean>
): Promise<ExperimentalFeatureEnablementResult> {
  const result = await callProtocol<ExperimentalFeatureEnablementResult>(
    "experimentalFeature/enablement/set",
    { enablement }
  );
  return {
    enablement:
      result?.enablement && typeof result.enablement === "object"
        ? result.enablement
        : {},
  };
}

/* ─────────────────────────── account/* helpers ───────────────────────────── */

/** `account/read` — current ChatGPT / API-key account, null when logged out. */
export async function accountRead(): Promise<AccountReadResult> {
  const result = await callProtocol<AccountReadResult>("account/read", {});
  return {
    account: result?.account ?? null,
    requiresOpenaiAuth: result?.requiresOpenaiAuth === true,
    workspaceRouting: result?.workspaceRouting ?? null,
  };
}

/** `account/rateLimits/read` — primary/secondary usage windows + reset credits. */
export async function accountRateLimitsRead(): Promise<AccountRateLimitsResult> {
  return callProtocol<AccountRateLimitsResult>("account/rateLimits/read", {});
}

/** `account/usage/read` — account-wide token usage summary + daily buckets. */
export async function accountUsageRead(): Promise<AccountUsageResult> {
  const result = await callProtocol<AccountUsageResult>("account/usage/read", {});
  return {
    summary: result?.summary ?? {},
    dailyUsageBuckets: Array.isArray(result?.dailyUsageBuckets)
      ? result.dailyUsageBuckets
      : null,
    threadUsage: result?.threadUsage ?? null,
  };
}
