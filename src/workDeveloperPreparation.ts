import { tauriInvoke } from "./bridge";
import { serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { experimentalFeatureListAll } from "./config";
import { parseModelInstructionOverrides, type WorkDeveloperInstructionInput } from "./workDeveloperInstructions";
import type { WorkLocalSubmissionPreparation } from "./workHomePreparation";
import type { WorkExecutionPreparation } from "./workExecutionPreparation";

export type WorkDeveloperAssemblerInputs = Omit<WorkDeveloperInstructionInput, "customInstructions">;
export type WorkDeveloperPreparation = { status: "not-ready"; missingInputs: string[] }
  | { status: "ready"; identity: ServiceIdentity; inputs: WorkDeveloperAssemblerInputs;
    unifiedCustomInstructionsEnabled: boolean | null; workspaceDependenciesReadFailed: boolean };
const same = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const notReady = (...missingInputs: string[]): WorkDeveloperPreparation => ({ status: "not-ready", missingInputs });

export interface WorkLocalDeveloperContext {
  identity: ServiceIdentity;
  /** Null means the existing thread has no confirmed model yet. It does not
   * authorize a home/default picker fallback. */
  model: string | null;
  execution: Extract<WorkExecutionPreparation, { status: "ready" }>;
}
export interface WorkDeveloperPreparationOptions {
  baseInstructions?: string | null; additionalDeveloperInstructions?: string | null;
  gitWorkspace?: "git" | "non-git" | "unknown";
}

async function readLocalDeveloperInputs(
  context: WorkLocalDeveloperContext,
  input: WorkDeveloperPreparationOptions & { threadId: string | null; heartbeatEnabled: boolean },
  signal: AbortSignal,
): Promise<WorkDeveloperPreparation> {
  const identity = { ...context.identity };
  const current = async () => {
    signal.throwIfAborted(); const actual = await serviceIdentity(signal); signal.throwIfAborted();
    if (!same(identity, actual)) throw Object.assign(Error("开发者指令准备期间账号发生变化。"), { code: "account_changed" });
  };
  await current();
  if (!same(identity, context.execution.identity)) throw Object.assign(Error("执行准备不属于当前账号。"), { code: "account_changed" });
  if (input.baseInstructions != null && typeof input.baseInstructions !== "string"
    || input.additionalDeveloperInstructions != null && typeof input.additionalDeveloperInstructions !== "string") return notReady("developer-context");
  if (input.gitWorkspace !== undefined && !["git", "non-git", "unknown"].includes(input.gitWorkspace)) return notReady("git-workspace");
  let gitValues: unknown[];
  try {
    gitValues = await Promise.all(["git-branch-prefix", "git-commit-instructions", "git-pr-instructions"].map(key => tauriInvoke("desktop_state_get", { key })));
  } catch { await current(); return notReady("git-settings"); }
  await current();
  // Registry defaults apply to confirmed absent values, not read failures.
  if (gitValues.some(value => value != null && typeof value !== "string")) return notReady("git-settings");
  const [branchPrefix, commitInstructions, pullRequestInstructions] = gitValues.map((value, index) => value == null ? index === 0 ? "codex/" : "" : value as string);
  let workspaceDependenciesEnabled = false, workspaceDependenciesReadFailed = false;
  try { workspaceDependenciesEnabled = (await experimentalFeatureListAll(100)).some(feature => feature.name === "workspace_dependencies" && feature.enabled === true); }
  catch { workspaceDependenciesReadFailed = true; } // GM's source-local catch is false.
  await current();
  const { execution } = context, values = execution.values;
  const prose = execution.settings.effectiveDetail === "STEPS_PROSE";
  const gate = execution.unifiedCustomInstructionsEnabled;
  return { status: "ready", identity, unifiedCustomInstructionsEnabled: typeof gate === "boolean" ? gate : null, workspaceDependenciesReadFailed,
    inputs: { threadId: input.threadId, heartbeatEnabled: input.heartbeatEnabled, baseInstructions: input.baseInstructions, additionalDeveloperInstructions: input.additionalDeveloperInstructions,
      gitSettings: { branchPrefix, commitInstructions, pullRequestInstructions }, gitWorkspace: input.gitWorkspace ?? "unknown",
      instructionOverrides: parseModelInstructionOverrides(values, context.model),
      artifactFollowupsEnabled: values.artifactFollowupsEnabled === true, workspaceDependenciesEnabled,
      worktreeCreationPreference: values.worktreeCreationPreference === true,
      // Our model registry has only the scheduling MCP attach path. Native UI
      // commands are not model dynamic tools; local automation text is a
      // separate source-always-on assembler section, not proof of tool attach.
      tools: { thread: false, worktree: false, worktreeLifecycle: false, sidebarSections: false },
      includeProseDetailLevelInstructions: prose, writingBlockInstructions: prose && execution.defaultEnableFeatures.writing_blocks === true } };
}

/** Keep homepage scope validation here; a restored thread never fabricates it. */
export async function readWorkDeveloperPreparation(
  preparation: Extract<WorkLocalSubmissionPreparation, { status: "ready" }>, input: WorkDeveloperPreparationOptions, signal: AbortSignal,
): Promise<WorkDeveloperPreparation> {
  signal.throwIfAborted();
  if (!same(preparation.identity, preparation.target.identity)) throw Object.assign(Error("执行准备不属于当前账号。"), { code: "account_changed" });
  if (preparation.target.location !== "local") return notReady("local-first-chat");
  return readLocalDeveloperInputs({ identity: preparation.identity, model: preparation.model, execution: preparation.execution },
    { ...input, threadId: null, heartbeatEnabled: false }, signal);
}

/** R8 i0 resume branch: real thread context, no home target, no home model. */
export async function readWorkThreadDeveloperPreparation(
  context: WorkLocalDeveloperContext,
  input: WorkDeveloperPreparationOptions & { threadId: string; heartbeatEnabled: boolean }, signal: AbortSignal,
): Promise<WorkDeveloperPreparation> {
  signal.throwIfAborted();
  if (typeof input.threadId !== "string" || !input.threadId.trim()) return notReady("work-thread-id");
  if (typeof input.heartbeatEnabled !== "boolean") return notReady("active-heartbeat");
  if (context.model !== null && typeof context.model !== "string") return notReady("work-thread-model");
  return readLocalDeveloperInputs(context, input, signal);
}
