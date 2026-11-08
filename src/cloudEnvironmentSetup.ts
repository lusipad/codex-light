import { callCloudThread, createCloudDraftReceipt, createCloudEnvironmentConfig, readCloudService, type ServiceIdentity } from "./chatgptService";
import { rememberCloudDraftBinding } from "./cloudDraftBindings";
import type { CloudDraftSession } from "./cloudDraftSession";
import type { readCloudDraftHistory } from "./cloudDraftHistory";
import { parseCloudDetail } from "./cloudEnvironmentService";
import { resolveCloudSetupModel } from "./cloudSetupModel";

type Receipt = Awaited<ReturnType<typeof createCloudEnvironmentConfig>>;
export interface CloudSetupSelection {
  name: string;
  repositories: { repositoryId: string; name: string; ref: string }[];
}
type Pending = { selection: CloudSetupSelection } & (
  | { phase: "creating-config" }
  | { phase: "config-created" | "creating-draft"; receipt: Receipt }
  | { phase: "sending"; receipt: Receipt; messageId: string }
);

const present = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const configId = (value: unknown): value is string => present(value) && /^[A-Za-z0-9_~-]{1,512}$/.test(value);
const nullableText = (value: unknown): value is string | null => value === null || present(value);
const setupKey = (identity: ServiceIdentity) => `cloud-environment-setup-v1:${JSON.stringify([identity.accountId, identity.userId])}`;
export const hasPendingCloudEnvironmentSetup = (identity: ServiceIdentity) => readPending(setupKey(identity)) !== null;

function readPending(key: string): Pending | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as Pending | null;
  if (!value || !present(value.selection?.name) || !Array.isArray(value.selection.repositories)
    || !value.selection.repositories.every(repo => repo && present(repo.repositoryId) && present(repo.name) && present(repo.ref))) {
    throw Error("无法读取待恢复的环境创建记录。");
  }
  if (value.phase === "creating-config") return value;
  if ((value.phase === "config-created" || value.phase === "creating-draft" || value.phase === "sending" && present(value.messageId)) && value.receipt
    && configId(value.receipt.config_id) && present(value.receipt.name) && present(value.receipt.version_id)
    && [value.receipt.environment_id, value.receipt.thread_id, value.receipt.onboarding_skill].every(nullableText)
    && (value.receipt.draft_id === null || configId(value.receipt.draft_id))) return value;
  throw Error("无法读取待恢复的环境创建记录。");
}

async function prepareSetupModel(identity: ServiceIdentity, signal: AbortSignal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  deadline.throwIfAborted();
  let cancel: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        cancel = () => reject(deadline.reason);
        deadline.addEventListener("abort", cancel, { once: true });
      }),
      resolveCloudSetupModel(identity, deadline),
    ]);
  } finally { deadline.removeEventListener("abort", cancel); }
}

function definitelyRefused(cause: unknown): boolean {
  const error = cause as { status?: number; code?: string } | null;
  if (error?.code === "invalid_request" || error?.code === "desktop_context_unavailable") return true;
  const status = error?.status;
  return typeof status === "number" && status >= 300 && status < 500 && status !== 408;
}

async function recoverReceipt(receipt: Receipt, identity: ServiceIdentity, signal: AbortSignal): Promise<Receipt> {
  const id = receipt.config_id;
  const raw = await (receipt.draft_id === null
    ? readCloudService("detail", { id }, identity, signal)
    : readCloudService("draft", { id, draftId: receipt.draft_id }, identity, signal)) as {
      environment_id?: unknown; thread_id?: unknown; onboarding_skill?: unknown;
    };
  const current = parseCloudDetail(raw, id, receipt.draft_id ?? undefined);
  const { environment_id = null, thread_id = null, onboarding_skill = null } = raw;
  if (current.shareSettings !== "private" || !nullableText(environment_id) || !nullableText(thread_id) || !nullableText(onboarding_skill)
    || (receipt.environment_id !== null && environment_id !== receipt.environment_id)
    || (receipt.thread_id !== null && thread_id !== null && thread_id !== receipt.thread_id)
    || (current.draft && !configId(current.draft.id))) throw Error("服务端设置会话与创建记录不匹配。");
  return {
    config_id: id, version_id: current.versionId, name: current.name, draft_id: current.draft?.id ?? null,
    environment_id, thread_id: thread_id ?? receipt.thread_id, onboarding_skill: onboarding_skill ?? receipt.onboarding_skill,
  };
}

export async function advanceCloudEnvironmentSetup(
  selection: CloudSetupSelection | null, identity: ServiceIdentity, signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!navigator.locks) throw Error("当前窗口无法安全创建环境。");
  const key = setupKey(identity);
  return navigator.locks.request(key, { signal }, async () => {
    signal.throwIfAborted();
    const pending = readPending(key);
    if (pending?.phase === "creating-config") return { status: "config_unconfirmed" as const };
    const chosen = pending?.selection ?? selection;
    if (!chosen) return null;
    const settings = await prepareSetupModel(identity, signal);
    signal.throwIfAborted();
    const save = (value: Pending) => localStorage.setItem(key, JSON.stringify(value));
    let receipt: Receipt;
    if (pending) {
      receipt = await recoverReceipt(pending.receipt, identity, signal);
      if (pending.phase === "creating-draft" && receipt.draft_id === null) {
        return { status: "draft_unconfirmed" as const, receipt: pending.receipt };
      }
      save({ ...pending, receipt });
    } else {
      save({ phase: "creating-config", selection: chosen });
      try {
        receipt = await createCloudEnvironmentConfig(chosen.name, chosen.repositories.map(({ repositoryId, ref }) => ({ repositoryId, ref })), identity, signal);
      } catch (cause) {
        if (!signal.aborted && definitelyRefused(cause)) localStorage.removeItem(key);
        throw cause;
      }
      save({ phase: "config-created", selection: chosen, receipt });
    }
    if (receipt.thread_id === null && pending?.phase !== "creating-draft" && pending?.phase !== "sending") {
      signal.throwIfAborted();
      save({ phase: "creating-draft", selection: chosen, receipt });
      let draft: Awaited<ReturnType<typeof createCloudDraftReceipt>>;
      try {
        draft = await createCloudDraftReceipt(receipt.config_id, identity, signal);
      } catch (cause) {
        if (!signal.aborted && definitelyRefused(cause)) save({ phase: "config-created", selection: chosen, receipt });
        throw cause;
      }
      receipt = { ...receipt, draft_id: draft.draftId, environment_id: draft.environmentId, thread_id: draft.threadId };
      save({ phase: "creating-draft", selection: chosen, receipt });
    }
    signal.throwIfAborted();
    if (receipt.thread_id === null || receipt.environment_id === null) return { status: "draft_unconfirmed" as const, receipt };
    return { status: "ready" as const, receipt: { ...receipt, thread_id: receipt.thread_id, environment_id: receipt.environment_id }, selection: chosen, ...settings };
  });
}

export async function openCloudEnvironmentSetup(selection: CloudSetupSelection | null, identity: ServiceIdentity, signal: AbortSignal) {
  const result = await advanceCloudEnvironmentSetup(selection, identity, signal);
  if (!result || result.status !== "ready") return result;
  const { receipt, serviceTier } = result;
  const session: CloudDraftSession = {
    threadId: receipt.thread_id, identity, setup: { serviceTier },
    binding: {
      accountId: identity.accountId, userId: identity.userId, configId: receipt.config_id, draftId: receipt.draft_id,
      environmentId: receipt.environment_id, name: receipt.name,
      repositoryNamesById: Object.fromEntries(result.selection.repositories.map(repo => [repo.repositoryId, repo.name])),
    },
  };
  return { status: "ready" as const, session, persisted: rememberCloudDraftBinding(session.threadId, session.binding) };
}

export async function sendCloudEnvironmentSetup(session: CloudDraftSession, history: Awaited<ReturnType<typeof readCloudDraftHistory>>, signal: AbortSignal) {
  const { threadId, identity, binding } = session;
  if (!session.setup || identity.accountId !== binding.accountId || identity.userId !== binding.userId) return null;
  const key = setupKey(identity);
  return navigator.locks.request(key, { signal }, async () => {
    signal.throwIfAborted();
    const pending = readPending(key);
    if (!pending || pending.phase === "creating-config" || pending.receipt.thread_id !== threadId
      || pending.receipt.config_id !== binding.configId || pending.receipt.draft_id !== binding.draftId
      || pending.receipt.environment_id !== binding.environmentId) return null;
    if (pending.phase === "sending") {
      if (!history.turns.some(({ turn }) => turn.items.some(item => item.type === "userMessage" && item.clientId === pending.messageId))) return "unconfirmed";
      localStorage.removeItem(key);
      return "sent";
    }
    const { thread } = await callCloudThread({ kind: "read", threadId }, identity, signal) as {
      thread?: { id?: string; name?: string | null; cwd?: string; status?: { type?: string } };
    };
    if (thread?.id !== threadId || thread.status?.type !== "idle" || history.turns.at(-1)?.turn.status === "inProgress") return "waiting";
    if (!thread.cwd?.startsWith("/")) throw Error("无法确认设置会话的工作目录。");
    const settings = await prepareSetupModel(identity, signal);
    if (!thread.name) {
      const title = Array.from(`设置 ${pending.receipt.name}`).slice(0, 60).join("");
      await callCloudThread({ kind: "title", threadId, name: title }, identity, signal);
    }
    signal.throwIfAborted();
    const messageId = crypto.randomUUID();
    localStorage.setItem(key, JSON.stringify({ ...pending, phase: "sending", messageId }));
    try {
      const result = await callCloudThread({
        kind: "start_environment_setup", threadId, clientUserMessageId: messageId, cwd: thread.cwd,
        ...settings, repositories: pending.selection.repositories.map(({ name, ref }) => ({ name, ref })),
        skill: pending.receipt.onboarding_skill, privateDraft: pending.receipt.draft_id !== null,
      }, identity, signal) as { turn?: { id?: string } };
      signal.throwIfAborted();
      if (!result?.turn?.id) return "unconfirmed";
    } catch (cause) {
      if (!signal.aborted && definitelyRefused(cause)) {
        localStorage.setItem(key, JSON.stringify(pending));
        throw cause;
      }
      return "unconfirmed";
    }
    localStorage.removeItem(key);
    return "sent";
  });
}
