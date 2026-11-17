import { callAppServer } from "./bridge";
import { readWorkAccountInfo, serviceIdentity, shareAccessBootstrap, type ServiceIdentity } from "./chatgptService";
import type { WorkDecision } from "./workAccess";
import { readWorkHomePreferences, type WorkHomeAtom, type WorkHomePreferencesSnapshot } from "./workHomePreferences";

type RecordValue = Record<string, unknown>;
export interface WorkExecutionAccess { identity: ServiceIdentity; combined: WorkDecision | null; base: { local: WorkDecision | null } }
export interface WorkAssignmentIdentity { userId: string; accountId: string; authMethod: string | null; stableId: string | null }
export interface WorkExecutionInput {
  identity: ServiceIdentity; appServerVersion: string | null; workAccess: WorkExecutionAccess;
  bootstrap: unknown; config: unknown; defaultModeRequestUserInput: WorkHomeAtom | undefined;
  legacyDetail?: "missing" | "unbound";
}
export type WorkExecutionPreparation = { status: "not-ready"; identity: ServiceIdentity; missingInputs: string[] }
  | { status: "ready"; identity: ServiceIdentity; assignmentIdentity: WorkAssignmentIdentity; values: RecordValue;
    assignmentFeatures: RecordValue; defaultEnableFeatures: RecordValue; policy: "preference" | "coding" | "everyday";
    settings: { configuredDetail: string | null; effectiveDetail: "STEPS_PROSE" | "STEPS_COMMANDS"; defaultModeRequestUserInput: boolean };
    missingInputs: [] };
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a: ServiceIdentity, b: ServiceIdentity) => a?.userId === b?.userId && a?.accountId === b?.accountId && a?.generation === b?.generation;
const validIdentity = (value: ServiceIdentity) => typeof value?.userId === "string" && !!value.userId && typeof value.accountId === "string" && !!value.accountId
  && Number.isSafeInteger(value.generation) && value.generation >= 0;
const notReady = (identity: ServiceIdentity, ...missingInputs: string[]): WorkExecutionPreparation => ({ status: "not-ready", identity: { ...identity }, missingInputs });
const featureGates = [
  ["2815533291", "local_work_search_mcp"], ["3013700042", "apply_patch_preserve_line_endings"], ["1786883712", "unified_exec"],
  ["241701189", "code_mode_buffered_exec"], ["1398371767", "code_mode_interrupt"], ["1570710371", "instant_interrupt"],
  ["4173592727", "executed_tool_call_metadata"], ["1615536597", "shell_snapshot"], ["3342304550", "shell_snapshot_v2"],
  ["770526561", "remote_models"], ["2734851136", "responses_websockets_v2"], ["4074240636", "reasoning_effort_override"],
  ["3701003275", "standalone_web_search"], ["1156958996", "collaboration_modes"], ["2929104770", "default_mode_request_user_input"],
  ["3390468622", "request_rule"], ["1935276618", "image_generation"], ["3762443246", "item_ids"], ["138621433", "image_detail_original"],
  ["2307253562", "codex_git_commit"], ["3026692602", "workspace_dependencies"], ["3902016271", "guardian_approval"],
  ["798686840", "guardian_native_multi_agent_history"], ["1690660828", "write_stdin_approval"], ["2731805027", "guardian_reuse_parent_compaction"],
  ["2701734443", "tool_search_always_defer_mcp_tools"], ["298803427", "mcp_lazy_stdio_startup"], ["2895893268", "incremental_tools"],
  ["18916273", "skill_catalog_deltas"], ["2036057545", "output_token_replay"], ["1693082043", "deferred_tool_world_state"],
  ["1859936703", "settings_tools"], ["2707717541", "writing_blocks"], ["2508143457", "concurrent_reasoning_summaries"],
] as const;
const overrideKeys = new Set(["search_mcp", "powershell_shell_version", "shell_snapshot", "shell_snapshot_v2", "unified_exec", "write_stdin_approval",
  "code_mode_buffered_exec", "code_mode_interrupt", "code_mode_tool_search", "instant_interrupt", "responses_websockets_v2", "reasoning_effort_override",
  "default_mode_request_user_input", "tool_search_always_defer_mcp_tools", "deferred_tool_world_state", "command_sessions_world_state", "incremental_tools",
  "incremental_tools_legacy", "incremental_tools_legacy_gcp", "untrusted_as_tool_output", "output_token_replay", "executor_capability_discovery_v2",
  "multi_agent_v2.preserve_fork_prefix", "retain_client_tool_outputs", "image_generation_sse"]);

// This bounded decoder supports full V1/V2 snapshots, not SDK live overlays,
// local overrides, delta merging or exposure logging. Missing tables are unread.
function decoder(raw: unknown, identity: ServiceIdentity) {
  if (!record(raw) || typeof raw.statsigPayload !== "string") throw Error("bootstrap");
  const body: unknown = JSON.parse(raw.statsigPayload);
  if (!record(body) || body.has_updates !== true || body.is_delta === true || body.isDelta === true || body.live_overlay != null
    || ![undefined, "init-v1", "init-v2"].includes(body.response_format as string | undefined)
    || !record(body.user) || body.user.userID !== identity.userId || !record(body.user.customIDs) || body.user.customIDs.account_id !== identity.accountId
    || !record(body.feature_gates) || !record(body.dynamic_configs) || !record(body.layer_configs)) throw Error("bootstrap");
  const user = body.user, ids = user.customIDs as RecordValue;
  if (user.custom != null && !record(user.custom) || ids.stableID != null && typeof ids.stableID !== "string"
    || record(user.custom) && user.custom.auth_method != null && typeof user.custom.auth_method !== "string") throw Error("bootstrap-identity");
  const assignmentIdentity: WorkAssignmentIdentity = { userId: identity.userId, accountId: identity.accountId,
    authMethod: record(user.custom) && typeof user.custom.auth_method === "string" ? user.custom.auth_method : null,
    stableId: typeof ids.stableID === "string" ? ids.stableID : null };
  const compact = body.response_format === "init-v2";
  if (compact && !record(body.values) && !Array.isArray(body.values)) throw Error("bootstrap-values");
  const lookup = (table: unknown, key: string): RecordValue | undefined => {
    let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    const source = table as RecordValue, value = source[key] ?? source[String(hash)];
    if (value == null) return;
    if (!record(value)) throw Error("bootstrap-entry");
    return value;
  };
  const gate = (key: string) => {
    const entry = lookup(body.feature_gates, key); if (!entry) return false;
    const value = entry[compact ? "v" : "value"];
    if (typeof value !== "boolean") throw Error("bootstrap-gate");
    return value;
  };
  const rawConfig = (key: string, layer = false) => {
    const entry = lookup(layer ? body.layer_configs : body.dynamic_configs, key);
    if (!entry) return { value: {} as RecordValue, participating: false, active: undefined as boolean | undefined };
    if (compact && (!Number.isSafeInteger(entry.v) || (entry.v as number) < 0)) throw Error("bootstrap-index");
    const rawValue = compact ? (body.values as Record<string, unknown>)[String(entry.v)] ?? {} : entry.value ?? {};
    return { value: rawValue, participating: (compact ? entry.ue : entry.is_user_in_experiment) === true,
      active: compact ? entry.ea === true : typeof entry.is_experiment_active === "boolean" ? entry.is_experiment_active : undefined };
  };
  const config = (key: string, layer = false) => {
    const result = rawConfig(key, layer); if (!record(result.value)) throw Error("bootstrap-config");
    return { ...result, value: result.value };
  };
  const parameter = <T>(key: string, field: string, fallback: T, layer = false): T => {
    const source = rawConfig(key, layer).value, value = record(source) ? source[field] : undefined;
    return value == null || fallback !== null && (Array.isArray(fallback) ? !Array.isArray(value) : typeof value !== typeof fallback || Array.isArray(value)) ? fallback : value as T;
  };
  return { assignmentIdentity, gate, config, rawConfig, parameter };
}

type Version = { parts: number[]; prerelease: (string | number)[] };
function version(raw: unknown): Version | null {
  if (typeof raw !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(raw);
  if (!match) return null;
  // Fixed ldD6 parser treats leading-zero prerelease identifiers as strings.
  return { parts: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".").map(part => /^(0|[1-9]\d*)$/.test(part) ? Number(part) : part) ?? [] };
}
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i] ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i]; if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x.localeCompare(y);
  }
  return 0;
}
export function compareWorkRuntimeVersions(left: string | null, right: string | null): number | null {
  const a = version(left), b = version(right); return a && b ? compare(a, b) : null;
}
function merge(a: unknown, b: RecordValue): RecordValue {
  const result = record(a) ? { ...a } : {};
  for (const [key, value] of Object.entries(b)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    result[key] = record(value) ? merge(result[key], value) : value;
  }
  return result;
}
type GuardianRule = { min_app_server_version: string; config: RecordValue };
export function projectWorkGuardianFeatures(features: RecordValue, experiment: (GuardianRule & { config_rules?: GuardianRule[] }) | null,
  appServerVersion: string | null): RecordValue {
  const runtime = version(appServerVersion); if (!experiment || !runtime) return features;
  let result = features;
  for (const candidate of [experiment, ...experiment.config_rules ?? []]) {
    if (!Object.keys(candidate.config).length || appServerVersion !== "0.0.0" && compare(runtime, version(candidate.min_app_server_version)!) < 0) continue;
    const old = result.guardianv2;
    result = { ...result, guardianv2: merge(old, candidate !== experiment && typeof old === "boolean" ? { enabled: old, ...candidate.config } : candidate.config) };
  }
  return result;
}

export function projectWorkExecutionPreparation(input: WorkExecutionInput): WorkExecutionPreparation {
  const { identity, workAccess } = input;
  if (!validIdentity(identity) || !same(identity, workAccess.identity)) return notReady(identity, "work-access-identity");
  if (workAccess.combined === null) return notReady(identity, "work-access");
  const policy = workAccess.combined.status === "denied" && workAccess.combined.reason === "unsupported-auth" ? "coding"
    : workAccess.base.local === null ? null : ["allowed", "loading", "error"].includes(workAccess.base.local.status) ? "preference" : "everyday";
  if (policy === null) return notReady(identity, "codex-local-access");
  let decoded: ReturnType<typeof decoder>;
  try { decoded = decoder(input.bootstrap, identity); } catch (error) { return notReady(identity, error instanceof Error ? error.message : "bootstrap"); }
  const { assignmentIdentity, gate, config, rawConfig, parameter } = decoded;
  if (!record(input.config) || !record(input.config.config)) return notReady(identity, "config");
  const desktop = input.config.config.desktop;
  if (desktop != null && !record(desktop)) return notReady(identity, "desktop-config");
  const settings = record(desktop) ? desktop : {};
  const rawDetail = settings.conversationDetailMode;
  const configuredDetail = typeof rawDetail === "string" && ["STEPS_PROSE", "STEPS_COMMANDS", "STEPS_EXECUTION"].includes(rawDetail) ? rawDetail : null;
  if (policy === "preference" && configuredDetail === null && input.legacyDetail !== "missing") return notReady(identity, "legacy-detail-owner");
  const atom = input.defaultModeRequestUserInput;
  if (!atom || atom.status === "unbound") return notReady(identity, "default-request-owner");
  const defaultModeRequestUserInput = atom.status === "value" && typeof atom.value === "boolean" ? atom.value
    : typeof settings["default-mode-request-user-input-enabled"] === "boolean" ? settings["default-mode-request-user-input-enabled"] as boolean : true;
  const effectiveDetail = policy === "everyday" ? "STEPS_PROSE" : policy === "coding" ? "STEPS_COMMANDS"
    : configuredDetail === "STEPS_PROSE" ? "STEPS_PROSE" : "STEPS_COMMANDS";
  try {
    let assignmentFeatures: RecordValue = { apps_mcp_path_override: true, unified_image_budget: true, code_mode_tool_description_first: true,
      mcp_oauth_refresh_coordination: true, image_resize_notice: true, untrusted_as_tool_output: gate("556188542"),
      incremental_tools_legacy: gate("336805716"), incremental_tools_legacy_gcp: gate("1328034729") };
    for (const [id, key] of featureGates) if (gate(id)) assignmentFeatures[key] = true;
    const overrides = parameter("3902942138", "feature_overrides", {}, true);
    for (const [rawKey, value] of Object.entries(overrides)) {
      const key = rawKey.startsWith("features.") ? rawKey.slice(9) : rawKey;
      if (overrideKeys.has(key) && typeof value === "boolean") assignmentFeatures[key] = value;
    }
    for (const [id, field, keys] of [["2138468235", "enable_mcp_apps", ["enable_mcp_apps"]], ["223073164", "enable_plugins", ["apps", "plugins", "recommended_plugins"]],
      ["223073164", "enable_tool_suggest", ["tool_suggest"]], ["223073164", "enable_auth_elicitation", ["auth_elicitation"]],
      ["223073164", "enable_tool_call_mcp_elicitation", ["tool_call_mcp_elicitation"]]] as const) {
      const value = parameter(id, field, null, true); if (typeof value === "boolean") for (const key of keys) assignmentFeatures[key] = value;
    }
    const asyncCompaction = rawConfig("763333490").value;
    if (record(asyncCompaction) && typeof asyncCompaction.enabled === "boolean") assignmentFeatures.async_compaction = { enabled: asyncCompaction.enabled,
      model_async_compact_threshold_percent: Number.isInteger(asyncCompaction.model_async_compact_threshold_percent) && Number(asyncCompaction.model_async_compact_threshold_percent) >= 1
        && Number(asyncCompaction.model_async_compact_threshold_percent) <= 100 ? asyncCompaction.model_async_compact_threshold_percent : 65 };
    assignmentFeatures.guardianv2_decisions_comparison = gate("1233679297");
    const guardian = rawConfig("2553103476").value;
    if (record(guardian) && Object.keys(guardian).length) assignmentFeatures.guardianv2 = guardian;
    assignmentFeatures.realtime_conversation = gate("2380644311"); assignmentFeatures.compaction_image_budget = true;
    const guardianRules = parameter("1055689174", "config_rules", [] as unknown[], true);
    const rule = (value: unknown) => record(value) && version(value.min_app_server_version) && record(value.config) ? value as RecordValue & { min_app_server_version: string; config: RecordValue } : null;
    const guardianExperiment = rule({ min_app_server_version: parameter("1055689174", "min_app_server_version", "", true), config: parameter("1055689174", "config", {}, true) });
    let guardianV2Experiment: RecordValue | undefined;
    if (guardianExperiment) {
      const rules = guardianRules.map(rule).filter(value => value !== null);
      const experiment = { ...guardianExperiment, config_rules: rules };
      guardianV2Experiment = experiment;
      assignmentFeatures = projectWorkGuardianFeatures(assignmentFeatures, experiment, input.appServerVersion);
    }
    const attach = parameter("1574672957", "worktree_git_attach_enabled", false, true) && gate("505458")
      ? { mcpToolsSearchable: parameter("1159670331", "defer_codex_app", false) } : undefined;
    let shareCodexAppTools = false;
    if (assignmentIdentity.authMethod !== null) {
      const base = gate("1390641248"), external = rawConfig("2383501365");
      shareCodexAppTools = !external.participating || external.active === false ? base
        : record(external.value) && external.value.enabled === true && base;
    }
    const values: RecordValue = { deferredToolOutput: parameter("914834687", "enabled", false), artifactFollowupsEnabled: parameter("4192642686", "clickable_followups_enabled", false, true),
      unifiedProjects: gate("2880010779"), threadTimelineHistory: gate("1079089693"), serverQueuedFollowUps: gate("2120612410"), gitWorktreeAttach: attach,
      worktreeCreationPreference: gate("1560085069"), cloudQueuedFollowUps: gate("1189013788"), daybreak: { enabled: gate("2334492480"), modelAccess: gate("512083054") },
      gitContext: gate("4259148646"), guardianV2Experiment,
      experimentalFeatureGates: { daybreakProgramPropagation: gate("3915811017"), apiKeyDaybreak: gate("2128871722"), apiKeyModelDiscovery: gate("3599582195"),
        localThreadStoreCompression: gate("1538937767"), shareCodexAppTools, mcp20260728: gate("2797990056"), curatedRemoteMarketplace: gate("4218407052"), backgroundPaginatedRolloutMigration: gate("218512289") },
      toolCatalog: { restrictedGates: {}, gates: Object.fromEntries([["crossHostHandoff", "2256010998"], ["projectTools", "3672665"], ["threadPullRequestAssociations", "465741219"],
        ["shareThread", "4157559322"], ["multiAgentMode", "1186680773"], ["appLifecycle", "403472035"]].map(([key, id]) => [key, gate(id)])),
        configs: { modelAvailability: config("107580212").value, realtimeConversationPrompt: config("1193530394").value } },
      permissionRefresh: gate("4226282475"), personality: config("1867347216").value, instructions: config("1574672957", true).value };
    return { status: "ready", identity: { ...identity }, assignmentIdentity, values, assignmentFeatures,
      defaultEnableFeatures: !defaultModeRequestUserInput && assignmentFeatures.default_mode_request_user_input === true
        ? { ...assignmentFeatures, default_mode_request_user_input: false } : { ...assignmentFeatures }, policy,
      settings: { configuredDetail, effectiveDetail, defaultModeRequestUserInput }, missingInputs: [] };
  } catch (error) { return notReady(identity, error instanceof Error ? error.message : "bootstrap"); }
}

export async function readWorkExecutionPreparation(input: { identity: ServiceIdentity; appServerVersion: string | null; workAccess: WorkExecutionAccess;
  preferences?: WorkHomePreferencesSnapshot }, signal: AbortSignal): Promise<WorkExecutionPreparation> {
  const identity = { ...input.identity }, changed = () => Object.assign(Error("执行准备期间账号或认证发生变化。"), { code: "account_changed" });
  const current = async () => { signal.throwIfAborted(); const actual = await serviceIdentity(signal); signal.throwIfAborted(); if (!same(identity, actual)) throw changed(); };
  const route = async () => { const raw = await callAppServer("account/read", { refreshToken: false }); await current();
    if (!record(raw) || !record(raw.account) || raw.account.type !== "chatgpt" || !record(raw.workspaceRouting) || raw.workspaceRouting.chatgptAccountId !== identity.accountId) throw changed(); };
  await current(); if (!validIdentity(identity) || !same(identity, input.workAccess.identity)) throw changed();
  await route(); const before = await readWorkAccountInfo(identity, signal); await current();
  let bootstrap: unknown, config: unknown, preferences = input.preferences;
  const missing: string[] = [];
  try { bootstrap = await shareAccessBootstrap(identity, signal); } catch { missing.push("bootstrap"); } await current();
  try { config = await callAppServer("config/read", { includeLayers: true, cwd: null }); } catch { missing.push("config"); } await current();
  if (!preferences) { try { preferences = await readWorkHomePreferences(identity, signal); } catch { missing.push("default-request-owner"); } await current(); }
  if (preferences && !same(identity, preferences.identity)) throw changed();
  await route(); const after = await readWorkAccountInfo(identity, signal); await current();
  if (before.authMethod !== after.authMethod || before.plan !== after.plan) throw changed();
  if (missing.length) return notReady(identity, ...missing);
  const atom = preferences && "defaultModeRequestUserInput" in preferences ? preferences.defaultModeRequestUserInput as WorkHomeAtom : undefined;
  const legacyDetail = preferences && "legacyDetail" in preferences ? preferences.legacyDetail as "missing" | "unbound" : undefined;
  return projectWorkExecutionPreparation({ ...input, identity, bootstrap, config, defaultModeRequestUserInput: atom, legacyDetail });
}
