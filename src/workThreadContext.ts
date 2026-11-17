import type { ServiceIdentity } from "./chatgptService";
import type { WorkLocalCollaborationMode } from "./workLocalRequest";
import type { WorkThreadProvenance } from "./workThreadProvenance";

type Values = Record<string, unknown>;
export interface WorkThreadScope { identity: ServiceIdentity; hostIdentity: string }
/** Local receipt, never an extra app-server field. Capture only after an actual
 * Work-local thread/start ACK; a receipt survives a failed first turn. */
export interface WorkThreadContext {
  scope: WorkThreadScope;
  threadId: string;
  serviceName: "codex_work_desktop" | null;
  originator: string | null | undefined;
  model: string | null;
  reasoningEffort: string | null | undefined;
  cwd: string | null;
  projectId: string | null | undefined;
  collaborationMode: WorkLocalCollaborationMode | null;
  permissionProfileId?: string | null;
  guardianApprovalEnabledByStatsig?: boolean;
}
export interface WorkThreadContextResult { context: WorkThreadContext | null; missingInputs: string[] }
export interface WorkHeartbeatRegistry {
  status: "ready" | "loading" | "error";
  enabled?: boolean;
  automations?: readonly { kind: string; status: string; targetThreadId?: string }[];
}
const record = (value: unknown): Values | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Values : null;
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const validScope = (scope: WorkThreadScope) => string(scope?.hostIdentity) && string(scope.identity?.accountId) && string(scope.identity?.userId)
  && Number.isSafeInteger(scope.identity.generation) && scope.identity.generation >= 0;
const copyScope = (scope: WorkThreadScope): WorkThreadScope => ({ identity: { ...scope.identity }, hostIdentity: scope.hostIdentity });
export function workThreadContextMatches(context: WorkThreadContext, scope: WorkThreadScope, threadId: string): boolean {
  return validScope(scope) && context.threadId === threadId && context.scope.hostIdentity === scope.hostIdentity
    && context.scope.identity.accountId === scope.identity.accountId && context.scope.identity.userId === scope.identity.userId
    && context.scope.identity.generation === scope.identity.generation;
}
function collaboration(value: unknown): WorkLocalCollaborationMode | null {
  const mode = record(value), settings = record(mode?.settings);
  if (!mode || !string(mode.mode) || !settings || !string(settings.model)
    || settings.reasoning_effort !== null && typeof settings.reasoning_effort !== "string"
    || settings.developer_instructions != null && typeof settings.developer_instructions !== "string") return null;
  return { mode: mode.mode, settings: { model: settings.model, reasoning_effort: settings.reasoning_effort as string | null,
    ...(settings.developer_instructions === undefined ? {} : { developer_instructions: settings.developer_instructions as string | null }) } };
}
function readContext(scope: WorkThreadScope, response: unknown, previous?: WorkThreadContext,
  created?: { serviceName: "codex_work_desktop" | null; collaborationMode?: unknown }, provenance?: WorkThreadProvenance): WorkThreadContextResult {
  const raw = record(response), thread = record(raw?.thread);
  if (!validScope(scope)) return { context: null, missingInputs: ["work-thread-scope"] };
  if (!thread || !string(thread.id)) return { context: null, missingInputs: ["work-thread-id"] };
  if (provenance && (provenance.threadId !== thread.id || provenance.accountId !== scope.identity.accountId
    || provenance.userId !== scope.identity.userId || provenance.hostIdentity !== scope.hostIdentity
    || provenance.serviceName !== null && provenance.serviceName !== "codex_work_desktop")) return { context: null, missingInputs: ["work-thread-provenance"] };
  if (previous && !workThreadContextMatches(previous, scope, thread.id)) {
    if (!provenance) return { context: null, missingInputs: ["work-thread-scope"] };
    // Durable provenance proves ownership, not the old generation's runtime
    // settings. Rebind only fields returned by this fresh read/resume.
    previous = undefined;
  }
  if (!created && !previous && !provenance && thread.originator !== "codex_work_desktop") return { context: null, missingInputs: ["work-thread-provenance"] };
  if (created && created.serviceName !== null && created.serviceName !== "codex_work_desktop") return { context: null, missingInputs: ["work-thread-provenance"] };
  const field = (name: string) => Object.hasOwn(raw!, name) ? raw![name] : thread[name];
  const model = field("model"), reason = field("reasoningEffort"), cwd = field("cwd");
  const suppliedMode = Object.hasOwn(raw!, "collaborationMode") ? raw!.collaborationMode
    : created?.collaborationMode === undefined ? previous?.collaborationMode : created.collaborationMode;
  const context: WorkThreadContext = {
    scope: copyScope(scope), threadId: thread.id, serviceName: created ? created.serviceName : provenance ? provenance.serviceName : previous?.serviceName ?? null,
    originator: typeof thread.originator === "string" || thread.originator === null ? thread.originator : previous?.originator,
    model: string(model) ? model : null, reasoningEffort: typeof reason === "string" || reason === null ? reason : undefined,
    cwd: string(cwd) ? cwd : null,
    projectId: typeof thread.projectId === "string" || thread.projectId === null ? thread.projectId : undefined,
    collaborationMode: collaboration(suppliedMode),
    permissionProfileId: Object.hasOwn(raw!, "activePermissionProfile")
      ? raw!.activePermissionProfile === null ? null : string(record(raw!.activePermissionProfile)?.id) ? record(raw!.activePermissionProfile)!.id as string : undefined
      : previous?.permissionProfileId,
    guardianApprovalEnabledByStatsig: previous?.guardianApprovalEnabledByStatsig,
  };
  const missingInputs = [];
  if (context.model === null) missingInputs.push("work-thread-model");
  if (context.reasoningEffort === undefined) missingInputs.push("work-thread-reasoning");
  if (context.cwd === null) missingInputs.push("work-thread-cwd");
  if (context.projectId === undefined) missingInputs.push("work-thread-project");
  return { context, missingInputs };
}
export function captureWorkThreadContext(scope: WorkThreadScope, response: unknown,
  sent: { serviceName: "codex_work_desktop" | null; collaborationMode?: unknown }): WorkThreadContextResult {
  return readContext(scope, response, undefined, sent);
}
export function restoreWorkThreadContext(scope: WorkThreadScope, response: unknown, previous?: WorkThreadContext, provenance?: WorkThreadProvenance): WorkThreadContextResult {
  return readContext(scope, response, previous, undefined, provenance);
}
/** WLR14–16: normal local resume reconstructs the runtime's default mode from
 * its actual result. Neither response.collaborationMode nor home mode is this
 * producer's input. Captured fallbacks must belong to this same live scope. */
export function confirmWorkThreadResumeResult(scope: WorkThreadScope, response: unknown, previous?: WorkThreadContext,
  provenance?: WorkThreadProvenance): WorkThreadContextResult {
  const restored = restoreWorkThreadContext(scope, response, previous, provenance);
  if (!restored.context) return restored;
  const raw = record(response)!;
  const captured = previous && workThreadContextMatches(previous, scope, restored.context.threadId) ? previous : undefined;
  const capturedReasoning = captured?.collaborationMode?.settings.reasoning_effort;
  const responseReasoning = raw.reasoningEffort;
  const latestReasoning = captured?.reasoningEffort;
  let reasoning: string | null | undefined;
  const candidates = [capturedReasoning, responseReasoning, latestReasoning];
  let invalidReasoning = false;
  for (const value of candidates) {
    if (value == null) continue;
    if (typeof value === "string") reasoning = value;
    else invalidReasoning = true;
    break;
  }
  // The live runtime initializes latestReasoningEffort to null. Preserve a
  // confirmed null when a partial local receipt has no latest field yet.
  if (!invalidReasoning && reasoning === undefined && candidates.includes(null)) reasoning = null;
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : null;
  const context: WorkThreadContext = { ...restored.context, model, reasoningEffort: reasoning,
    collaborationMode: model !== null && reasoning !== undefined ? { mode: "default", settings: {
      model, reasoning_effort: reasoning, developer_instructions: null,
    } } : null };
  const missingInputs = restored.missingInputs.filter(name => name !== "work-thread-model" && name !== "work-thread-reasoning");
  if (model === null) missingInputs.push("work-thread-model");
  if (reasoning === undefined) missingInputs.push("work-thread-reasoning");
  return { context, missingInputs };
}
interface RequestInput { scope: WorkThreadScope; context: WorkThreadContext | null; threadId: string; baseParams: Values }
function requestMissing(input: RequestInput): string[] {
  if (!input.context) return ["work-thread-context"];
  if (!workThreadContextMatches(input.context, input.scope, input.threadId)) return ["work-thread-scope"];
  return [input.context.model === null ? "work-thread-model" : null, input.context.cwd === null ? "work-thread-cwd" : null,
    input.context.projectId === undefined ? "work-thread-project" : null].filter((value): value is string => value !== null);
}
/** WLC01–03: loaded follow-up uses the existing thread's confirmed mode; never
 * a home picker fallback. Queue/steer admission remains the caller's task. */
export function projectWorkThreadFollowUp(input: RequestInput & { collaborationMode?: unknown }): { request: Values | null; missingInputs: string[] } {
  const missingInputs = requestMissing(input);
  const mode = collaboration(input.collaborationMode === undefined ? input.context?.collaborationMode : input.collaborationMode);
  if (!mode) missingInputs.push("work-thread-collaboration-mode");
  else if (mode.settings.model !== input.context?.model) missingInputs.push("work-thread-model-mismatch");
  if (missingInputs.length) return { request: null, missingInputs };
  return { request: { ...input.baseParams, threadId: input.threadId, model: null, effort: null, collaborationMode: mode }, missingInputs };
}
export function projectWorkThreadHeartbeat(threadId: string, registry: WorkHeartbeatRegistry | null | undefined): { heartbeatEnabled: boolean | null; missingInputs: string[] } {
  if (!string(threadId) || registry?.status !== "ready" || typeof registry.enabled !== "boolean") return { heartbeatEnabled: null, missingInputs: ["active-heartbeat"] };
  if (!registry.enabled) return { heartbeatEnabled: false, missingInputs: [] };
  if (!Array.isArray(registry.automations) || registry.automations.some(item => !record(item) || typeof item.kind !== "string"
    || typeof item.status !== "string" || item.kind === "heartbeat" && !string(item.targetThreadId))) return { heartbeatEnabled: null, missingInputs: ["active-heartbeat"] };
  return { heartbeatEnabled: registry.automations.some(item => item.kind === "heartbeat" && item.status === "ACTIVE" && item.targetThreadId === threadId), missingInputs: [] };
}
export function projectWorkThreadResume(input: RequestInput & { preparedDeveloperInstructions?: string; heartbeatRegistry: WorkHeartbeatRegistry | null | undefined }): {
  request: Values | null; instructionOptions: { threadId: string; heartbeatEnabled: boolean } | null; missingInputs: string[];
} {
  // The existing runtime can resolve its own model on resume. Unknown read
  // metadata is not permission to replace it with a home selection.
  const missingInputs = requestMissing(input).filter(name => name !== "work-thread-model"), heartbeat = projectWorkThreadHeartbeat(input.threadId, input.heartbeatRegistry);
  missingInputs.push(...heartbeat.missingInputs);
  if (typeof input.preparedDeveloperInstructions !== "string") missingInputs.push("project-aware-developer-instructions");
  const instructionOptions = heartbeat.heartbeatEnabled === null ? null : { threadId: input.threadId, heartbeatEnabled: heartbeat.heartbeatEnabled };
  if (missingInputs.length) return { request: null, instructionOptions, missingInputs };
  // reasoningEffort is an official manager input, not a declared top-level
  // ThreadResumeParams field. Do not copy home/turn options into this RPC.
  const { effort: _effort, reasoningEffort: _reasoning, serviceName: _service, collaborationMode: _mode, ...base } = input.baseParams;
  return { request: { ...base, threadId: input.threadId, model: null, developerInstructions: input.preparedDeveloperInstructions }, instructionOptions, missingInputs };
}
