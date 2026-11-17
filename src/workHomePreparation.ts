import { callAppServer } from "./bridge";
import { readWorkAccountInfo, serviceIdentity, readChatgptService, type ServiceIdentity } from "./chatgptService";
import { readLocalWorkAccess, type LocalWorkAccess, type WorkDecision } from "./workAccess";
import { readLocalWorkOrchestration, type LocalWorkOrchestration } from "./workOrchestrationAccess";
import { readWorkHomePreferences, type WorkHomeAtom, type WorkHomePreferencesSnapshot } from "./workHomePreferences";
import { parseWorkSelectedProject, readWorkProjectAccess, type WorkProjectAccessResult, type WorkSelectedProject } from "./workProjectAccess";
import { isWorkEnterprisePlan, projectWorkRunLocationCore, type WorkRunLocationState } from "./workRunLocation";
import { readWorkModelCatalog, selectWorkHomeModel, adaptWorkModelSelection, type WorkModelSelection, type WorkModelCatalog } from "./workModelCatalog";
import { readWorkExecutionPreparation, type WorkExecutionPreparation } from "./workExecutionPreparation";
import { loadModelCatalog } from "./modelCatalog";
import type { ModelInfo } from "./types";

type NotReady = { status: "not-ready"; reason: string; missingInputs: string[] };
export interface WorkCaptureTarget {
  status: "ready"; identity: ServiceIdentity; location: "local" | "cloud" | null;
  /** null when only effectiveLocation is invariant, not all menu fields. */
  state: WorkRunLocationState | null;
  preferences: WorkHomePreferencesSnapshot; access: LocalWorkAccess; orchestration: LocalWorkOrchestration;
  project: WorkProjectAccessResult; selectedWorkProject: WorkSelectedProject | null; selectedChatGptProjectId: string | null;
}
const same = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const changed = () => Object.assign(Error("Work 准备期间账号或套餐已变化。"), { code: "account_changed" });
const unavailable = (reason: string, ...missingInputs: string[]): NotReady => ({ status: "not-ready", reason, missingInputs });
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
async function fence(identity: ServiceIdentity, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted(); const actual = await serviceIdentity(signal); signal.throwIfAborted(); if (!same(identity, actual)) throw changed();
}
function preference(atom: WorkHomeAtom): unknown {
  if (atom.status === "unbound" || atom.status === "invalid") throw Error("Work 首页偏好尚未确认当前身份。");
  return "value" in atom ? atom.value : null;
}

/** Counterfactuals establish only the invariant capture destination, never a
 * guessed gate, capability, account plan or menu state. */
export function projectWorkCaptureDestination(input: {
  access: LocalWorkAccess; orchestration: LocalWorkOrchestration;
  persistedLocation: "local" | "cloud" | null; project: NonNullable<WorkProjectAccessResult["project"]>;
}): { ready: boolean; location: "local" | "cloud" | null; state: WorkRunLocationState | null } {
  const { access, orchestration, project } = input;
  const decisions = (decision: WorkDecision | null): WorkDecision[] => decision ? [decision] : [{ status: "allowed", accountId: access.identity.accountId }, { status: "loading" }];
  const bools = (value: boolean | null): boolean[] => value === null ? [false, true] : [value];
  const enterprise = orchestration.accountInfo.plan === null ? [false, true] : [isWorkEnterprisePlan(orchestration.accountInfo.plan)];
  const capability = orchestration.capability?.isCapable ?? null;
  const lockdown = orchestration.lockdown.loaded ? orchestration.lockdown.state === "disabled" : null;
  const states: WorkRunLocationState[] = [];
  for (const cloud of decisions(access.workCloud)) for (const local of decisions(access.workLocal))
    for (const rollout of bools(orchestration.gates.gate246)) for (const organization of enterprise)
      for (const capable of bools(capability)) for (const unlocked of bools(lockdown)) {
        const m2 = capable && unlocked && cloud.status === "allowed";
        const defaults = input.persistedLocation !== null || !m2 ? [false] : bools(orchestration.gates.gate355);
        for (const defaultCloud of defaults) states.push(projectWorkRunLocationCore({
          applyRolloutRules: rollout, cloudAccess: cloud, localAccess: local, enforceAccess: true,
          cloudProjectUnavailableReason: project.cloudUnavailableReason, lockedProject: project.locked,
          isEnterprise: organization, isM2SyncEnabled: m2,
          preferredLocation: input.persistedLocation ?? (m2 && defaultCloud ? "cloud" : "local"),
        }));
      }
  const first = states[0], ready = states.every(state => state.effectiveLocation === first.effectiveLocation);
  const complete = access.workCloud !== null && access.workLocal !== null && states.every(state => JSON.stringify(state) === JSON.stringify(first));
  return { ready, location: ready ? first.effectiveLocation : null, state: ready && complete ? first : null };
}

/** Ordinary new-chat-with-appshot home: no route/GPT/preview override. Model and
 * execution preparation deliberately do not delay capture admission. */
export async function readWorkCaptureTarget(input: {
  identity?: ServiceIdentity; preferences?: WorkHomePreferencesSnapshot;
}, signal: AbortSignal): Promise<WorkCaptureTarget | NotReady> {
  signal.throwIfAborted();
  const access = await readLocalWorkAccess(signal, { supportedSurface: true, workCloudSupportedSurface: true });
  const identity = { ...access.identity };
  if (input.identity && !same(identity, input.identity)) throw changed();
  await fence(identity, signal);
  if (access.combined?.status !== "allowed") return unavailable("work-access", "work-access");
  const preferences = input.preferences ?? await readWorkHomePreferences(identity, signal);
  if (!same(identity, preferences.identity)) throw changed();
  await fence(identity, signal);
  let selected: WorkSelectedProject | null, persisted: unknown;
  try { selected = parseWorkSelectedProject(preference(preferences.selectedProject)); persisted = preference(preferences.runLocation); }
  catch { return unavailable("home-preferences", "selected-project-or-run-location"); }
  if (persisted !== null && persisted !== "local" && persisted !== "cloud") return unavailable("home-preferences", "work-run-location");
  const orchestration = await readLocalWorkOrchestration(signal);
  if (!same(identity, orchestration.identity)) throw changed();
  await fence(identity, signal);
  // iRBf tY is a unique local backing, or the selected g-p ID. A local
  // selection is retained even when its backing is missing.
  const directChatProject = selected?.projectId.startsWith("g-p-") ? selected.projectId : null;
  const project = await readWorkProjectAccess({ identity, gate288: orchestration.gates.gate288,
    routeProjectId: null, selectedChatGptProjectId: directChatProject, selectedWorkProject: selected,
    localProjects: preferences.localProjects.status === "missing" ? { status: "missing" }
      : "value" in preferences.localProjects ? { status: preferences.localProjects.status === "invalid" ? "invalid" : "value", value: preferences.localProjects.value } : undefined,
    pendingBackingCount: 0, activeLockedProjectId: null, cachedSelectedProject: undefined,
    provisioningHostAvailable: false, provisionPermission: null }, signal);
  await fence(identity, signal);
  const after = await readWorkAccountInfo(identity, signal); await fence(identity, signal);
  if (after.authMethod !== orchestration.accountInfo.authMethod || after.plan !== orchestration.accountInfo.plan) throw changed();
  if (!project.project) return unavailable("project", ...project.missingInputs);
  const destination = projectWorkCaptureDestination({ access, orchestration, persistedLocation: persisted, project: project.project });
  if (!destination.ready) return unavailable("run-location", "run-location-influencing-inputs");
  return { status: "ready", identity, location: destination.location, state: destination.state,
    preferences, access, orchestration, project, selectedWorkProject: selected,
    selectedChatGptProjectId: directChatProject ?? (project.backingProjectId?.startsWith("g-p-") ? project.backingProjectId : null) };
}

export interface WorkHostModelFilterInput {
  authMethod: string | null; config: unknown; availability: unknown;
  includeUltra: boolean; enabledReasoningEfforts: readonly string[];
}
/** Fixed Xvtr.a for the actual Work host (no API-key daybreak session). */
export function filterWorkHostModels(models: readonly ModelInfo[], input: WorkHostModelFilterInput): ModelInfo[] {
  const raw = record(record(input.config)?.config) ?? {}, profiles = record(raw.profiles), profile = typeof raw.profile === "string" ? record(profiles?.[raw.profile]) : null;
  const config = { ...raw }; if (profile) for (const [key, value] of Object.entries(profile)) if (value !== null) config[key] = value;
  const providers = record(config.model_providers), custom = typeof config.model_provider === "string" && providers !== null && Object.hasOwn(providers, config.model_provider);
  const configured = typeof config.model_catalog_json === "string" && config.model_catalog_json.trim().length > 0;
  const availability = record(input.availability) ?? {}, hidden = availability.use_hidden_models === true;
  const available = Array.isArray(availability.available_models) && availability.available_models.every(value => typeof value === "string") ? availability.available_models : [];
  const known = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"]);
  return models.flatMap(model => {
    const cyber = model.availableAccessPrograms?.cyber;
    const auth = input.authMethod;
    if (auth === "apikey" && cyber?.length && !cyber.includes("standard")) return [];
    const visible = model.model !== "codex-auto-review" && (configured && !model.hidden
      || (hidden && !custom && auth !== "amazonBedrock" ? available.includes(model.model ?? "") : !model.hidden));
    if (!visible) return [];
    const source = (model.supportedReasoningEfforts ?? []).map(value => typeof value === "string" ? { reasoningEffort: value } : value)
      .filter(value => input.includeUltra || value.reasoningEffort !== "ultra");
    const efforts = (auth === "copilot" ? [source.find(value => value.reasoningEffort === "medium") ?? { reasoningEffort: "medium", description: "medium effort" }] : source)
      .filter(value => known.has(value.reasoningEffort) && input.enabledReasoningEfforts.includes(value.reasoningEffort));
    return [{ ...model, supportedReasoningEfforts: efforts }];
  });
}
export type WorkLocalSubmissionPreparation = NotReady | {
  status: "ready"; identity: ServiceIdentity; target: WorkCaptureTarget; preferences: WorkHomePreferencesSnapshot; selection: WorkModelSelection;
  model: string; reasoningEffort: string | null; serviceName?: "codex_work_desktop";
  execution: Extract<WorkExecutionPreparation, { status: "ready" }>; hostModels: ModelInfo[];
  modelCatalogFilterMissingInputs: string[];
  catalog: WorkModelCatalog; isWorkModel: boolean;
};
export type WorkHomeModelPreparation = NotReady | (Omit<Extract<WorkLocalSubmissionPreparation, { status: "ready" }>, "execution"> & { execution: null });
export async function readWorkLocalSubmissionPreparation(target: WorkCaptureTarget, input: {
  appServerVersion: string | null;
}, signal: AbortSignal): Promise<WorkLocalSubmissionPreparation> {
  const result = await readLocalModelPreparation(target, input, signal, true, true);
  return result.status !== "ready" || result.execution !== null ? result as WorkLocalSubmissionPreparation : unavailable("execution", "native-execution");
}
export async function readWorkHomeModelPreparation(target: WorkCaptureTarget, input: {
  appServerVersion: string | null;
}, signal: AbortSignal): Promise<WorkHomeModelPreparation> {
  return readLocalModelPreparation(target, input, signal, false, false) as Promise<WorkHomeModelPreparation>;
}
/** Called only after a candidate is known to be Work. Base selection/model
 * remain current-home values, never the candidate passed to permission review. */
export async function readWorkHomeNativeModelPreparation(target: WorkCaptureTarget, input: { appServerVersion: string | null }, signal: AbortSignal): Promise<WorkLocalSubmissionPreparation> {
  const result = await readLocalModelPreparation(target, input, signal, false, true);
  return result.status !== "ready" || result.execution !== null ? result as WorkLocalSubmissionPreparation : unavailable("execution", "native-execution");
}
async function readLocalModelPreparation(target: WorkCaptureTarget, input: {
  appServerVersion: string | null;
}, signal: AbortSignal, requireWork: boolean, prepareNative: boolean): Promise<WorkLocalSubmissionPreparation | WorkHomeModelPreparation> {
  const identity = { ...target.identity }; await fence(identity, signal);
  if (target.location !== "local") return unavailable("execution-location", "local-execution-location");
  const before = await readWorkAccountInfo(identity, signal); await fence(identity, signal);
  if (before.authMethod !== target.orchestration.accountInfo.authMethod || before.plan !== target.orchestration.accountInfo.plan) throw changed();
  const preferences = await readWorkHomePreferences(identity, signal); await fence(identity, signal);
  if (!same(identity, preferences.identity)) throw changed();
  try {
    if (JSON.stringify(parseWorkSelectedProject(preference(preferences.selectedProject))) !== JSON.stringify(target.selectedWorkProject)
      || preference(preferences.runLocation) !== preference(target.preferences.runLocation)) return unavailable("work-target-changed", "work-target");
  } catch { return unavailable("home-preferences", "selected-project-or-run-location"); }
  let home: unknown, last: unknown;
  try { home = preference(preferences.homeModel); last = preference(preferences.lastModel); }
  catch { return unavailable("model-preferences", "home-or-last-model"); }
  const modelValue = (raw: unknown): WorkModelSelection | null => {
    if (raw === null) return null;
    const value = record(raw); if (!value || typeof value.slug !== "string" || !value.slug) throw Error("Work 模型选择无效");
    return { slug: value.slug, thinkingEffort: value.thinkingEffort as WorkModelSelection["thinkingEffort"] ?? null,
      versionId: typeof value.versionId === "string" ? value.versionId : null };
  };
  const catalog = await readWorkModelCatalog(identity, signal); await fence(identity, signal);
  let chosen: ReturnType<typeof selectWorkHomeModel>;
  try { chosen = selectWorkHomeModel(catalog, { homeSelection: modelValue(home), lastSelection: modelValue(last), plan: before.plan }); }
  catch { return unavailable("model-preferences", "model-selection"); }
  if (requireWork && !chosen.isWorkModel) return unavailable("model-selection", "work-model-selection");
  if (!prepareNative) {
    const after = await readWorkAccountInfo(identity, signal); await fence(identity, signal);
    if (before.authMethod !== after.authMethod || before.plan !== after.plan) throw changed();
    return { status: "ready", identity, target, preferences, selection: chosen.selection, model: chosen.selection.slug,
      reasoningEffort: chosen.selection.thinkingEffort, execution: null, hostModels: [], modelCatalogFilterMissingInputs: [],
      catalog, isWorkModel: chosen.isWorkModel };
  }
  const execution = await readWorkExecutionPreparation({ identity, appServerVersion: input.appServerVersion, workAccess: target.access, preferences }, signal);
  await fence(identity, signal);
  if (execution.status !== "ready") return unavailable("execution", ...execution.missingInputs);
  const missing: string[] = []; let rawModels: ModelInfo[] = [], config: unknown, settings: unknown;
  try { rawModels = await loadModelCatalog(); } catch { missing.push("host-model-list"); } await fence(identity, signal);
  try { config = await callAppServer("config/read", { includeLayers: true, cwd: null }); if (!record(record(config)?.config)) missing.push("host-config"); } catch { missing.push("host-config"); } await fence(identity, signal);
  try { settings = await readChatgptService("library_settings", {}, identity, signal); } catch { /* Q3tq's authenticated default applies when query has no data. */ } await fence(identity, signal);
  const tools = record(execution.values.toolCatalog), configs = record(tools?.configs), gates = record(tools?.gates);
  const ultra = gates?.multiAgentMode; if (typeof ultra !== "boolean") missing.push("host-ultra-gate");
  const visibility = record(record(record(settings)?.settings)?.model_picker_reasoning_effort_visibility)?.enabled;
  const efforts = Array.isArray(visibility) && visibility.every(value => typeof value === "string") ? visibility : ["low", "medium", "high", "xhigh"];
  const models = missing.length ? [] : filterWorkHostModels(rawModels, { authMethod: before.authMethod, config,
    availability: configs?.modelAvailability, includeUltra: ultra === true, enabledReasoningEfforts: efforts });
  // SGof deliberately retains an unmatched slug/effort. A failed/empty host
  // directory does not invent a new eligibility gate or choose another model.
  const mapped = adaptWorkModelSelection(chosen.selection, models);
  const after = await readWorkAccountInfo(identity, signal); await fence(identity, signal);
  if (before.authMethod !== after.authMethod || before.plan !== after.plan || after.plan !== target.orchestration.accountInfo.plan) throw changed();
  return { status: "ready", identity, target, preferences, selection: chosen.selection, model: mapped.model, reasoningEffort: mapped.reasoningEffort,
    ...(execution.settings.effectiveDetail === "STEPS_PROSE" ? { serviceName: "codex_work_desktop" as const } : {}),
    execution, hostModels: models, modelCatalogFilterMissingInputs: missing, catalog, isWorkModel: chosen.isWorkModel };
}
