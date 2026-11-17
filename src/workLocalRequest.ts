import { compareWorkRuntimeVersions, type WorkExecutionPreparation } from "./workExecutionPreparation";

type Values = Record<string, unknown>;
const record = (value: unknown): value is Values => value !== null && typeof value === "object" && !Array.isArray(value);
// Fixed hR capability names / module71415 thresholds. These are runtime
// compatibility checks, independent of account rollout and Work admission.
const featureCapabilities = [
  ["command_sessions_world_state", "commandSessionsWorldState", null],
  ["guardian_native_multi_agent_history", "guardianNativeMultiAgentHistory", "0.166.0-alpha.3"],
  ["multi_agent_v2.preserve_fork_prefix", "preserveForkPrefix", "0.163.0-alpha.4"],
  ["async_compaction", "asyncCompaction", "0.163.0-alpha.11"],
  ["output_token_replay", "outputTokenReplay", "0.163.0-alpha.6"],
  ["incremental_tools", "incrementalTools", "0.162.0-alpha.17"],
  ["skill_catalog_deltas", "skillCatalogDeltas", "0.166.0-alpha.1"],
  ["incremental_tools_legacy", "incrementalToolsLegacy", "0.169.0-alpha.2"],
  ["incremental_tools_legacy_gcp", "incrementalToolsLegacyGcp", null],
  ["reasoning_effort_override", "reasoningEffortUpdates", "0.156.0"],
  ["instant_interrupt", "instantInterrupt", "0.159.0"],
  ["apply_patch_preserve_line_endings", "applyPatchPreserveLineEndings", "0.148.0-alpha.6"],
  ["compaction_image_budget", "compactionImageBudget", "0.149.1"],
  ["deferred_tool_world_state", "deferredToolWorldState", "0.146.0-alpha.6"],
  ["mcp_oauth_refresh_coordination", "mcpOauthRefreshCoordination", "0.154.0-alpha.1"],
  ["recommended_plugins", "recommendedPlugins", "0.147.0-alpha.1"],
  ["guardianv2_decisions_comparison", "guardianV2DecisionsComparison", "0.162.0-alpha.2"],
] as const;
const excludedFeatures = new Set(["search_mcp", "local_work_search_mcp", "auth_elicitation", "mcp_lazy_stdio_startup", "plugins", "apps",
  "tool_suggest", "tool_call_mcp_elicitation", "writing_blocks"]);
function supports(version: string | null, name: string, minimum: string | null): boolean {
  if (version === "0.0.0") return true; // No hR capability is in JF's special exclusions.
  if (version === null || minimum === null || compareWorkRuntimeVersions(version, minimum) === null) return false;
  if (name === "compactionImageBudget") {
    if (version.startsWith("0.149.0-alpha.4.")) return compareWorkRuntimeVersions(version, "0.149.0-alpha.4.3")! >= 0;
    if (version.startsWith("0.149.0-alpha.7.")) return compareWorkRuntimeVersions(version, "0.149.0-alpha.7.3")! >= 0;
    if (version.startsWith("0.150.0-")) return false;
  }
  return compareWorkRuntimeVersions(version, minimum)! >= 0;
}
export function projectWorkLocalFeatureConfig(features: Values, existing: Values, appServerVersion: string | null): Values {
  const filtered = { ...features };
  for (const [key, name, minimum] of featureCapabilities) if (filtered[key] != null && !supports(appServerVersion, name, minimum)) delete filtered[key];
  const guardian = filtered.guardianv2;
  if (record(guardian) && !supports(appServerVersion, "guardianV2StructuredConfig", "0.148.0-alpha.18")) filtered.guardianv2 = guardian.enabled === true;
  const projected = Object.fromEntries(Object.entries(filtered).flatMap(([raw, value]) => {
    const key = raw.startsWith("features.") ? raw.slice(9) : raw;
    return excludedFeatures.has(key) ? [] : [[`features.${key}`, value]];
  }));
  return { ...projected, ...existing };
}
const personality = (value: unknown): "friendly" | "pragmatic" | null => value === "friendly" || value === "pragmatic" ? value : null;
export interface WorkLocalThreadRequestInput {
  baseParams: Values; hostConfig: Values; selection: { model: string | null; reasoningEffort: string | null };
  preparation: WorkExecutionPreparation; appServerVersion: string | null;
  // undefined means the project-aware assembler has not run. null is an
  // explicit prepared empty result; neither creates made-up prompt text.
  preparedDeveloperInstructions?: string | null;
}
export function buildWorkLocalThreadRequest(input: WorkLocalThreadRequestInput) {
  const { preparation, selection, baseParams } = input;
  if (preparation.status !== "ready") return { request: null, instructionOptions: null, missingInputs: [...preparation.missingInputs] };
  const prose = preparation.settings.effectiveDetail === "STEPS_PROSE";
  const missingInputs: string[] = [];
  if (!selection.model) missingInputs.push("selected-work-model");
  if (input.preparedDeveloperInstructions === undefined) missingInputs.push("project-aware-developer-instructions");
  const assignmentPersonality = record(preparation.values.personality) ? preparation.values.personality.default_personality : undefined;
  const config = projectWorkLocalFeatureConfig(preparation.defaultEnableFeatures, record(baseParams.config) ? baseParams.config : {}, input.appServerVersion);
  if (selection.reasoningEffort !== null) config.model_reasoning_effort = selection.reasoningEffort;
  const request: Values = { ...baseParams, model: selection.model, config,
    personality: personality(input.hostConfig.personality) ?? personality(input.hostConfig.model_personality) ?? personality(assignmentPersonality) ?? "friendly" };
  if (prose) request.serviceName = "codex_work_desktop";
  if (input.preparedDeveloperInstructions !== undefined) request.developerInstructions = input.preparedDeveloperInstructions;
  return { request, instructionOptions: { model: selection.model, includeProseDetailLevelInstructions: prose,
    writingBlockInstructions: prose && preparation.defaultEnableFeatures.writing_blocks === true }, missingInputs };
}
export interface WorkLocalCollaborationMode { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions?: string | null } }
export function buildWorkLocalTurnRequest(input: { baseParams: Values; threadId: string; createdThreadModel: string;
  collaborationMode?: WorkLocalCollaborationMode | null }): Values {
  const { baseParams, collaborationMode } = input;
  return { ...baseParams, threadId: input.threadId, model: collaborationMode ? null : input.createdThreadModel,
    effort: collaborationMode?.settings.reasoning_effort, ...(collaborationMode ? { collaborationMode } : {}) };
}
export interface WorkSearchMcpContext {
  mode: string; is_web_access_restricted: boolean; session_persistent: boolean;
  defaultModeOnFullAccess?: string | null; legalModel?: string | null; allowed_domains?: string[]; [key: string]: unknown;
}
/** Only consumes an already discovered and trusted search context. This does
 * not claim hosted search is available or create an MCP/tool registration. */
export function mergeWorkSearchMcpMetadata(metadata: Record<string, string> | null | undefined, context: WorkSearchMcpContext | null | undefined,
  currentPermissions?: { activePermissionProfile?: { id: string } | null; sandboxPolicy?: { type: string } | null } | null,
  request?: { permissions?: string | null; sandboxPolicy?: { type: string } | null }): Record<string, string> | null | undefined {
  if (context == null) return metadata;
  const meta: unknown = JSON.parse(metadata?.mcp_request_meta ?? "{}"); if (!record(meta)) throw Error("搜索 MCP metadata 必须是对象。");
  const old = meta["openai/search_context"], decoded: unknown = typeof old === "string" ? JSON.parse(old) : old ?? {};
  if (!record(decoded)) throw Error("搜索 MCP context 必须是对象。");
  const { defaultModeOnFullAccess, legalModel: _legalModel, ...rest } = context;
  let profile = currentPermissions?.activePermissionProfile;
  if (request?.permissions != null || request?.sandboxPolicy != null) profile = request.permissions == null ? null : { id: request.permissions };
  const sandbox = request?.sandboxPolicy ?? currentPermissions?.sandboxPolicy;
  const full = profile == null ? sandbox?.type === "dangerFullAccess" : profile.id === ":danger-full-access";
  const mode = full && defaultModeOnFullAccess != null ? defaultModeOnFullAccess : rest.mode;
  const result: Values = { ...decoded, ...rest, mode,
    is_web_access_restricted: (defaultModeOnFullAccess == null ? rest.is_web_access_restricted : mode === "cached") || decoded.is_web_access_restricted === true };
  if (Array.isArray(result.allowed_domains) && result.allowed_domains.length === 0) delete result.allowed_domains;
  return { ...metadata, mcp_request_meta: JSON.stringify({ ...meta, "openai/search_context": JSON.stringify(result) }) };
}
