import type { ModelInfo } from "./types";
import type { ApprovalPolicy, ApprovalsReviewer, SandboxPolicy } from "./executionPolicy";
import { workThreadContextMatches, type WorkThreadContext, type WorkThreadScope } from "./workThreadContext";

export interface WorkThreadModelSelection { model: string; reasoningEffort: string | null }
export interface WorkThreadModelSnapshot {
  scope: WorkThreadScope;
  context: WorkThreadContext;
  /** The actual currently available native host directory, not merged slugs. */
  models: readonly ModelInfo[];
  policyRevision: number;
}
export interface WorkThreadModelPermissionSettings {
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: ApprovalsReviewer;
  permissions?: string | null;
  sandboxPolicy?: SandboxPolicy;
}
export interface WorkThreadModelUpdate extends WorkThreadModelPermissionSettings {
  threadId: string; model: string; effort: string | null; multiAgentMode: "explicitRequestOnly";
}
interface Options {
  read: (threadId: string) => WorkThreadModelSnapshot | null;
  isCurrent: (snapshot: WorkThreadModelSnapshot) => boolean;
  /** {} means the caller confirmed the actual current permission/guardian
   * context without overrides. null/false mean unknown or cancelled. */
  preparePermissions: (input: { snapshot: WorkThreadModelSnapshot; selection: WorkThreadModelSelection }, signal: AbortSignal) => Promise<WorkThreadModelPermissionSettings | false | null>;
  update: (params: WorkThreadModelUpdate) => Promise<unknown>;
  /** Synchronous compare-and-set; never replace a newer notification context. */
  commit: (snapshot: WorkThreadModelSnapshot, next: WorkThreadContext) => boolean;
}
interface Job {
  scope: WorkThreadScope; selection: WorkThreadModelSelection; controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null; ready: boolean; settled: boolean;
  finish: (value: boolean) => void; fail: (error: unknown) => void;
}
interface Slot { pending: Job | null; running: Job | null }
const permissionKeys = new Set(["approvalPolicy", "approvalsReviewer", "permissions", "sandboxPolicy"]);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.prototype.toString.call(value) === "[object Object]";
function supports(models: readonly ModelInfo[], selection: WorkThreadModelSelection): boolean {
  const model = models.find(model => model.model === selection.model);
  return model !== undefined && (selection.reasoningEffort === null || (model.supportedReasoningEfforts ?? []).some(value =>
    (typeof value === "string" ? value : value.reasoningEffort) === selection.reasoningEffort));
}

/** SH13/14, MA01: 320ms only merges not-yet-started intents. Actual writes are
 * per-thread serial, and local mode projection follows a real object RPC ACK.
 * Method-unsupported remains an explicit rejection; no local-success fallback. */
export function createWorkThreadModelSelectionController(options: Options) {
  const slots = new Map<string, Slot>();
  let disposed = false;
  const read = (threadId: string, scope?: WorkThreadScope): WorkThreadModelSnapshot | null => {
    const value = options.read(threadId), mode = value?.context?.collaborationMode;
    if (!value || !mode || !value.context.model || mode.settings.model !== value.context.model
      || value.context.cwd === null || value.context.projectId === undefined || !Array.isArray(value.models)
      || !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 0
      || !workThreadContextMatches(value.context, value.scope, threadId)
      || scope && !workThreadContextMatches(value.context, scope, threadId) || options.isCurrent(value) !== true) return null;
    return { ...value, scope: { identity: { ...value.scope.identity }, hostIdentity: value.scope.hostIdentity } };
  };
  const current = (threadId: string, job: Job, snapshot: WorkThreadModelSnapshot) => {
    if (disposed || job.controller.signal.aborted || job.settled || options.isCurrent(snapshot) !== true) return false;
    const actual = read(threadId, snapshot.scope);
    return actual !== null && actual.context === snapshot.context && actual.policyRevision === snapshot.policyRevision && supports(actual.models, job.selection);
  };
  const pump = (threadId: string, slot: Slot) => {
    if (disposed || slot.running || !slot.pending?.ready) return;
    const job = slot.pending; slot.pending = null; slot.running = job;
    void (async () => {
      try {
        const snapshot = read(threadId, job.scope);
        if (job.settled || job.controller.signal.aborted || !snapshot || !supports(snapshot.models, job.selection)) { job.finish(false); return; }
        const permissions = await options.preparePermissions({ snapshot, selection: { ...job.selection } }, job.controller.signal);
        if (!current(threadId, job, snapshot) || permissions === false || permissions === null) { job.finish(false); return; }
        if (!record(permissions) || Object.keys(permissions).some(key => !permissionKeys.has(key))
          || permissions.permissions !== undefined && permissions.permissions !== null && typeof permissions.permissions !== "string"
          || permissions.permissions != null && permissions.sandboxPolicy != null) throw Error("Work 模型权限尚未确认，未更新线程。");
        const response = await options.update({ ...permissions, threadId, model: job.selection.model,
          effort: job.selection.reasoningEffort, multiAgentMode: "explicitRequestOnly" });
        if (!record(response)) throw Error("Work 模型更新未返回确认回执。");
        if (!current(threadId, job, snapshot)) { job.finish(false); return; }
        const next: WorkThreadContext = { ...snapshot.context, model: job.selection.model, reasoningEffort: job.selection.reasoningEffort,
          collaborationMode: { ...snapshot.context.collaborationMode!, settings: { ...snapshot.context.collaborationMode!.settings,
            model: job.selection.model, reasoning_effort: job.selection.reasoningEffort } } };
        job.finish(options.commit(snapshot, next) === true);
      } catch (error) { job.fail(error); }
      finally {
        slot.running = null;
        pump(threadId, slot);
        if (!slot.running && !slot.pending && slots.get(threadId) === slot) slots.delete(threadId);
      }
    })();
  };
  return {
    select(threadId: string, selection: WorkThreadModelSelection, signal?: AbortSignal): Promise<boolean> {
      if (disposed || signal?.aborted) return Promise.resolve(false);
      let snapshot: WorkThreadModelSnapshot | null;
      try {
        snapshot = read(threadId);
        if (!snapshot || typeof selection.model !== "string" || !selection.model
          || selection.reasoningEffort !== null && typeof selection.reasoningEffort !== "string" || !supports(snapshot.models, selection)) return Promise.resolve(false);
      } catch (error) { return Promise.reject(error); }
      if (disposed || signal?.aborted) return Promise.resolve(false);
      let slot = slots.get(threadId);
      if (!slot) { slot = { pending: null, running: null }; slots.set(threadId, slot); }
      slot.pending?.finish(false);
      const target = slot;
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const settle = (done: () => void) => {
          if (job.settled) return;
          job.settled = true;
          if (job.timer !== null) { clearTimeout(job.timer); job.timer = null; }
          signal?.removeEventListener("abort", abort);
          done();
        };
        const abort = () => {
          controller.abort(); job.finish(false);
          if (target.pending === job) target.pending = null;
          if (!target.pending && !target.running && slots.get(threadId) === target) slots.delete(threadId);
        };
        const job: Job = { scope: snapshot!.scope, selection: { model: selection.model, reasoningEffort: selection.reasoningEffort },
          controller, timer: null, ready: false, settled: false,
          finish: value => settle(() => resolve(value)), fail: error => settle(() => reject(error)) };
        target.pending = job;
        signal?.addEventListener("abort", abort, { once: true });
        job.timer = setTimeout(() => { job.timer = null; job.ready = true; pump(threadId, target); }, 320);
      });
    },
    dispose() {
      disposed = true;
      for (const slot of slots.values()) for (const job of [slot.pending, slot.running]) {
        if (job) { job.controller.abort(); job.finish(false); }
      }
      slots.clear();
    },
  };
}
