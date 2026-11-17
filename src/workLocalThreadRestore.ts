import { callAppServer } from "./bridge";
import { readWorkHeartbeatRegistry, serviceIdentity } from "./chatgptService";
import { readLocalWorkAccess } from "./workAccess";
import { readWorkExecutionPreparation } from "./workExecutionPreparation";
import { readWorkThreadDeveloperPreparation } from "./workDeveloperPreparation";
import { buildWorkDeveloperInstructions } from "./workDeveloperInstructions";
import { projectWorkLocalFeatureConfig } from "./workLocalRequest";
import { assertWorkThreadOwner, persistWorkThreadProvenance, readWorkThreadProvenance, type WorkThreadProvenance } from "./workThreadProvenance";
import { confirmWorkThreadResumeResult, projectWorkThreadHeartbeat, projectWorkThreadResume, restoreWorkThreadContext,
  workThreadContextMatches, type WorkThreadContext } from "./workThreadContext";
import type { createWorkCustomInstructionsCache } from "./workCustomInstructions";

export type WorkLocalThreadRestore = { kind: "ordinary" }
  | { kind: "loaded" | "resumed"; context: WorkThreadContext; response: any };
export interface WorkLocalThreadRestoreInput {
  threadId: string; hostIdentity: string; appServerVersion: string | null;
  metadata?: any; previous?: WorkThreadContext; forceResume?: boolean;
  provenance?: WorkThreadProvenance | null;
  isCurrent: () => boolean;
  isPolicyCurrent?: () => boolean;
}

/** Existing-thread recovery never reads a home project or model selection.
 * Ordinary threads return before account/assignment/registry preparation. */
export async function restoreWorkLocalThread(input: WorkLocalThreadRestoreInput,
  cache: ReturnType<typeof createWorkCustomInstructionsCache>, signal: AbortSignal,
): Promise<WorkLocalThreadRestore> {
  let work = false;
  const current = () => {
    signal.throwIfAborted();
    if (!input.isCurrent() || work && input.isPolicyCurrent?.() === false) throw Error("会话恢复操作已失效，输入已保留。");
  };
  current();
  const provenance = input.provenance === undefined ? await readWorkThreadProvenance(input.threadId) : input.provenance; current();
  const metadata = input.metadata ?? await callAppServer<any>("thread/read", { threadId: input.threadId, includeTurns: false }); current();
  if (metadata?.thread?.id !== input.threadId) throw Error("会话读取结果不属于目标线程。");
  if (!provenance && !input.previous && metadata.thread.originator !== "codex_work_desktop") return { kind: "ordinary" };
  work = true; current();
  const identity = await serviceIdentity(signal); current();
  const fence = async () => {
    current(); const actual = await serviceIdentity(signal); current();
    if (actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation) throw Error("Work 会话恢复期间账号已变化。");
  };
  if (provenance) assertWorkThreadOwner(provenance, identity, input.hostIdentity);
  const scope = { identity, hostIdentity: input.hostIdentity };
  const previous = input.previous && workThreadContextMatches(input.previous, scope, input.threadId) ? input.previous : undefined;
  const initial = restoreWorkThreadContext(scope, metadata, previous, provenance ?? undefined);
  if (!initial.context || initial.context.cwd === null || initial.context.projectId === undefined) throw Error("Work 会话的工作目录或项目来源尚未确认。");
  const context = initial.context;
  // A live, unchanged receipt already holds the confirmed mode. Revisiting it
  // must not reset Plan or add an account HTTP/registry dependency to follow-up.
  if (!input.forceResume && previous?.collaborationMode && !initial.missingInputs.length
    && context.model === previous.model && context.cwd === previous.cwd && context.projectId === previous.projectId
    && ["idle", "active"].includes(metadata.thread.status?.type)) return { kind: "loaded", context, response: metadata };
  const access = await readLocalWorkAccess(signal, { supportedSurface: true, workCloudSupportedSurface: true }); await fence();
  if (access.identity.accountId !== identity.accountId || access.identity.userId !== identity.userId || access.identity.generation !== identity.generation) throw Error("Work 执行配置不属于当前账号。");
  const execution = await readWorkExecutionPreparation({ identity, appServerVersion: input.appServerVersion,
    workAccess: access, cwd: context.cwd }, signal); await fence();
  if (execution.status !== "ready") throw Error(`Work 执行配置尚未就绪：${execution.missingInputs.join("、")}`);
  const registry = await readWorkHeartbeatRegistry(identity, input.threadId, signal); await fence();
  const heartbeat = projectWorkThreadHeartbeat(input.threadId, registry);
  if (heartbeat.heartbeatEnabled === null) throw Error("Work 心跳任务状态尚未确认。");
  const developer = await readWorkThreadDeveloperPreparation({ identity,
    model: previous?.collaborationMode?.settings.model ?? context.model, execution },
    { threadId: input.threadId, heartbeatEnabled: heartbeat.heartbeatEnabled }, signal); await fence();
  if (developer.status !== "ready") throw Error(`Work 会话指令尚未就绪：${developer.missingInputs.join("、")}`);
  cache.update(identity, developer.unifiedCustomInstructionsEnabled); cache.refreshOnce();
  const instructions = buildWorkDeveloperInstructions({ ...developer.inputs, customInstructions: cache.read(identity) });
  const projected = projectWorkThreadResume({ scope, context, threadId: input.threadId, heartbeatRegistry: registry,
    preparedDeveloperInstructions: instructions, baseParams: { cwd: context.cwd,
      config: projectWorkLocalFeatureConfig(execution.defaultEnableFeatures, {}, input.appServerVersion) } });
  if (!projected.request || projected.missingInputs.length) throw Error(`Work 恢复参数尚未就绪：${projected.missingInputs.join("、")}`);
  await fence();
  await persistWorkThreadProvenance(input.threadId, identity, input.hostIdentity, context.serviceName); await fence();
  const response = await callAppServer<any>("thread/resume", projected.request); await fence();
  if (response?.thread?.id !== input.threadId) throw Error("Work 恢复响应不属于目标线程。");
  const confirmed = confirmWorkThreadResumeResult(scope, response, previous ?? context, provenance ?? {
    threadId: input.threadId, userId: identity.userId, accountId: identity.accountId,
    hostIdentity: input.hostIdentity, serviceName: context.serviceName,
  });
  if (!confirmed.context || confirmed.missingInputs.length) throw Error(`Work 恢复结果尚未确认：${confirmed.missingInputs.join("、")}`);
  return { kind: "resumed", context: confirmed.context, response };
}
