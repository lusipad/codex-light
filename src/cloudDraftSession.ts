import { callCloudThread, createCloudDraft, type ServiceIdentity } from "./chatgptService";
import { rememberCloudDraftBinding, type CloudDraftBinding } from "./cloudDraftBindings";
import { readCloudDraftHistory } from "./cloudDraftHistory";
import { cloudDraftResumeParams } from "./cloudDraftResume";

export interface CloudDraftSession {
  threadId: string;
  identity: ServiceIdentity;
  binding: CloudDraftBinding;
  setup?: { serviceTier: string | null };
}

export async function createCloudDraftSession(environment: { id: string; name: string }, repositoryNamesById: Record<string, string>, identity: ServiceIdentity, signal: AbortSignal) {
  const receipt = await createCloudDraft(environment.id, identity, signal);
  signal.throwIfAborted();
  const binding: CloudDraftBinding = {
    accountId: identity.accountId,
    userId: identity.userId,
    configId: environment.id,
    draftId: receipt.draftId,
    environmentId: receipt.environmentId,
    name: environment.name,
    repositoryNamesById,
  };
  const persisted = rememberCloudDraftBinding(receipt.threadId, binding);
  const title = Array.from(`编辑 ${environment.name}`.trim()).slice(0, 60).join("");
  // Navigation can unmount the catalog immediately after the confirmed receipt.
  void callCloudThread({ kind: "title", threadId: receipt.threadId, name: title }, identity, new AbortController().signal).catch(() => {});
  return { session: { threadId: receipt.threadId, identity, binding }, persisted };
}

function waitForResume(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, delay);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function resumeThread(params: ReturnType<typeof cloudDraftResumeParams>, identity: ServiceIdentity, signal: AbortSignal) {
  const deadlines = [120, 240, 480] as const;
  let timeouts = 0;
  let closing = 0;
  while (true) {
    signal.throwIfAborted();
    try {
      return await callCloudThread({ kind: "resume", params, timeoutSeconds: deadlines[timeouts] }, identity, signal);
    } catch (cause) {
      signal.throwIfAborted();
      const code = (cause as { code?: string } | null)?.code;
      if (code === "cloud_thread_closing" && closing < 4) {
        await waitForResume(750 * 2 ** closing++, signal);
      } else if (code === "cloud_resume_timeout" && timeouts < 2) {
        timeouts++;
        await waitForResume(750, signal);
      } else {
        throw cause;
      }
    }
  }
}

type ResumeContext = Omit<Parameters<typeof cloudDraftResumeParams>[0], "threadId">;

export async function prepareCloudDraftContext({ metadata, preferences }: { metadata: unknown; preferences: unknown }): Promise<ResumeContext> {
  const thread = (metadata as { thread?: { cwd?: unknown; path?: unknown } })?.thread;
  if (!thread) throw Error("无法读取云端会话配置。");
  const { cwd, path } = thread;
  if (cwd != null && cwd !== "" && (typeof cwd !== "string" || !cwd.startsWith("/"))) throw Error("云端会话的工作目录无效。");
  if (path != null && typeof path !== "string") throw Error("云端会话路径无效。");
  const config = (preferences as { config?: { personality?: unknown; model_personality?: unknown } })?.config;
  const personality = [config?.personality, config?.model_personality].find(value => value === "friendly" || value === "pragmatic" || value === "none") as string | undefined;
  return {
    path: path ?? null,
    includeServiceTier: false,
    reuseRunningThread: false,
    prepared: {
      cwd: cwd || "/",
      modelProvider: null,
      personality: personality ?? "friendly",
      config: { "tools.experimental_request_user_input.enabled": false },
    },
  };
}

export async function restoreCloudDraftSession(session: CloudDraftSession, prepare: (input: {
  metadata: unknown;
  preferences: unknown;
  signal: AbortSignal;
}) => Promise<ResumeContext>, historyLimits: { turnLimit: number; itemLimit: number }, signal: AbortSignal) {
  signal.throwIfAborted();
  const { threadId, identity, binding } = session;
  if (binding.accountId !== identity.accountId || binding.userId !== identity.userId) {
    throw Error("环境草稿与当前账号不匹配。");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const active = controller.signal;
    const metadata = await callCloudThread({ kind: "read", threadId }, identity, active);
    const preferences = await callCloudThread({ kind: "preferences" }, identity, active);
    const context = await prepare({ metadata, preferences, signal: active });
    active.throwIfAborted();
    const params = cloudDraftResumeParams({ ...context, threadId, ...(session.setup ? {
      includeServiceTier: true, prepared: { ...context.prepared, serviceTier: session.setup.serviceTier },
    } : {}) });
    const historyRequest = readCloudDraftHistory(threadId, identity, active, { ...historyLimits, cursor: null })
      .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    let response: unknown;
    try {
      response = await resumeThread(params, identity, active);
    } catch (cause) {
      if (!active.aborted) await historyRequest;
      throw cause;
    }
    const history = await historyRequest;
    active.throwIfAborted();
    if (!history.ok) throw history.error;
    return { response, history: history.value };
  } finally {
    signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
