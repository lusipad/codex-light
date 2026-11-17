import { tauriInvoke } from "./bridge";
import { serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { experimentalFeatureListAll } from "./config";
import { parseModelInstructionOverrides, type WorkDeveloperInstructionInput } from "./workDeveloperInstructions";
import type { WorkLocalSubmissionPreparation } from "./workHomePreparation";

export type WorkDeveloperAssemblerInputs = Omit<WorkDeveloperInstructionInput, "customInstructions">;
export type WorkDeveloperPreparation = { status: "not-ready"; missingInputs: string[] }
  | { status: "ready"; identity: ServiceIdentity; inputs: WorkDeveloperAssemblerInputs;
    unifiedCustomInstructionsEnabled: boolean | null; workspaceDependenciesReadFailed: boolean };
const same = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const notReady = (...missingInputs: string[]): WorkDeveloperPreparation => ({ status: "not-ready", missingInputs });

/** New local first-chat producer. The root supplies the separate authenticated
 * custom-instructions cache; this reader never opens or creates AGENTS.md. */
export async function readWorkDeveloperPreparation(
  preparation: Extract<WorkLocalSubmissionPreparation, { status: "ready" }>, input: {
    baseInstructions?: string | null; additionalDeveloperInstructions?: string | null;
    gitWorkspace?: "git" | "non-git" | "unknown";
  }, signal: AbortSignal,
): Promise<WorkDeveloperPreparation> {
  const identity = { ...preparation.identity };
  const current = async () => {
    signal.throwIfAborted(); const actual = await serviceIdentity(signal); signal.throwIfAborted();
    if (!same(identity, actual)) throw Object.assign(Error("开发者指令准备期间账号发生变化。"), { code: "account_changed" });
  };
  await current();
  if (!same(identity, preparation.execution.identity) || !same(identity, preparation.target.identity)) throw Object.assign(Error("执行准备不属于当前账号。"), { code: "account_changed" });
  if (preparation.target.location !== "local") return notReady("local-first-chat");
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
  const { execution } = preparation, values = execution.values;
  const prose = execution.settings.effectiveDetail === "STEPS_PROSE";
  const gate = execution.unifiedCustomInstructionsEnabled;
  return { status: "ready", identity, unifiedCustomInstructionsEnabled: typeof gate === "boolean" ? gate : null, workspaceDependenciesReadFailed,
    inputs: { threadId: null, baseInstructions: input.baseInstructions, additionalDeveloperInstructions: input.additionalDeveloperInstructions,
      gitSettings: { branchPrefix, commitInstructions, pullRequestInstructions }, gitWorkspace: input.gitWorkspace ?? "unknown",
      instructionOverrides: parseModelInstructionOverrides(values, preparation.model),
      artifactFollowupsEnabled: values.artifactFollowupsEnabled === true, workspaceDependenciesEnabled,
      worktreeCreationPreference: values.worktreeCreationPreference === true,
      // Our model registry has only the scheduling MCP attach path. Native UI
      // commands are not model dynamic tools; local automation text is a
      // separate source-always-on assembler section, not proof of tool attach.
      tools: { thread: false, worktree: false, worktreeLifecycle: false, sidebarSections: false },
      includeProseDetailLevelInstructions: prose, writingBlockInstructions: prose && execution.defaultEnableFeatures.writing_blocks === true } };
}
