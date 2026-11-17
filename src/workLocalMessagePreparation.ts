import { serviceIdentity } from "./chatgptService";
import { readWorkLocalSubmissionPreparation, type WorkCaptureTarget, type WorkLocalSubmissionPreparation } from "./workHomePreparation";
import { readWorkDeveloperPreparation } from "./workDeveloperPreparation";
import { buildWorkDeveloperInstructions } from "./workDeveloperInstructions";
import type { createWorkCustomInstructionsCache } from "./workCustomInstructions";

export type WorkLocalMessagePreparation = Extract<WorkLocalSubmissionPreparation, { status: "not-ready" }>
  | (Extract<WorkLocalSubmissionPreparation, { status: "ready" }> & { developerInstructions: string });

/** Capture and message readiness are separate: the real account cache, model,
 * assignments and project-aware instructions are read only for this consumer. */
export async function readWorkLocalMessagePreparation(target: WorkCaptureTarget, input: { appServerVersion: string | null },
  customInstructions: ReturnType<typeof createWorkCustomInstructionsCache>, signal: AbortSignal,
): Promise<WorkLocalMessagePreparation> {
  signal.throwIfAborted();
  const preparation = await readWorkLocalSubmissionPreparation(target, input, signal);
  if (preparation.status !== "ready") return preparation;
  const developer = await readWorkDeveloperPreparation(preparation, {}, signal);
  signal.throwIfAborted();
  if (developer.status !== "ready") return { status: "not-ready", reason: "developer-instructions", missingInputs: developer.missingInputs };
  customInstructions.update(preparation.identity, developer.unifiedCustomInstructionsEnabled);
  // Uc.read is synchronous. Warm this principal's cache in the background;
  // sending neither waits for HTTP nor starts another refresh on every read.
  customInstructions.refreshOnce();
  signal.throwIfAborted();
  const identity = await serviceIdentity(signal);
  signal.throwIfAborted();
  if (identity.accountId !== preparation.identity.accountId || identity.userId !== preparation.identity.userId
    || identity.generation !== preparation.identity.generation) throw Error("Work 消息准备期间账号已变化。");
  return { ...preparation, developerInstructions: buildWorkDeveloperInstructions({ ...developer.inputs,
    customInstructions: customInstructions.read(preparation.identity) }) };
}
