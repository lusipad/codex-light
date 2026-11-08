import { callCloudPublish, readCloudService, type CloudPublishOperation } from "./chatgptService";
import { listCloudDraftBindings } from "./cloudDraftBindings";
import type { CloudDraftSession } from "./cloudDraftSession";
import type { ServiceIdentity } from "./chatgptService";

export interface CloudPublishReview {
  baseVersionId: string;
  revision: number;
  turnId: string;
}

interface Receipt extends CloudPublishReview {
  key: string;
  operationId?: string;
  versionId?: string;
  confirmed?: boolean;
  failed?: boolean;
}

const storageKey = ({ identity, binding, threadId }: CloudDraftSession) =>
  `cloud-environment-publish-v1:${JSON.stringify([identity.accountId, identity.userId, binding.configId, binding.draftId, binding.environmentId, threadId])}`;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_~-]{1,512}$/.test(value);

export function readCloudPublication(session: CloudDraftSession): Receipt | null {
  if (!session.binding.draftId) return null;
  const raw = localStorage.getItem(storageKey(session));
  if (raw === null) return null;
  const entry = JSON.parse(raw) as Receipt | null;
  if (!entry || !id(entry.key) || !id(entry.baseVersionId) || !id(entry.turnId)
    || !Number.isSafeInteger(entry.revision) || entry.revision < 0
    || (entry.operationId !== undefined && !id(entry.operationId))
    || (entry.versionId !== undefined && (!id(entry.versionId) || !entry.operationId))
    || (entry.confirmed !== undefined && (entry.confirmed !== true || !entry.versionId))
    || (entry.failed !== undefined && (entry.failed !== true || !entry.operationId || !!entry.versionId))) {
    throw Error("无法读取环境发布回执。");
  }
  return entry;
}

export function pendingCloudPublication(configId: string, identity: ServiceIdentity): CloudDraftSession | null {
  for (const [threadId, binding] of listCloudDraftBindings(configId, identity)) {
    const session = { threadId, binding, identity };
    const receipt = readCloudPublication(session);
    if (receipt && !receipt.confirmed) return session;
  }
  return null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export async function advanceCloudPublication(
  session: CloudDraftSession, review: CloudPublishReview | null, signal: AbortSignal,
  validateReview: (review: CloudPublishReview) => Promise<void>,
): Promise<"published" | "checking" | "failed"> {
  const { identity, threadId, binding } = session;
  const { configId, draftId, environmentId } = binding;
  signal.throwIfAborted();
  if (!draftId || identity.accountId !== binding.accountId || identity.userId !== binding.userId)
    throw Error("环境发布与当前草稿账号不匹配。");
  if (!navigator.locks) throw Error("当前窗口无法安全发布环境。");
  const key = storageKey(session);
  return navigator.locks.request(key, { signal }, async () => {
    signal.throwIfAborted();
    let entry = readCloudPublication(session);
    const store = (value: Receipt) => { localStorage.setItem(key, JSON.stringify(value)); entry = value; return value; };
    const send = async (operation: CloudPublishOperation) => {
      signal.throwIfAborted();
      const body = await callCloudPublish({ configId, draftId, environmentId, operation }, identity, signal);
      signal.throwIfAborted();
      return body;
    };
    if (!entry) {
      if (!review) throw Error("请先审核当前环境草稿。");
      await validateReview(review);
      signal.throwIfAborted();
      entry = store({ ...review, key: crypto.randomUUID() });
    }
    if (entry.failed) return "failed";
    let current = entry;
    if (!current.operationId) {
      const raw = await send({ kind: "begin", expectedRevision: current.revision, idempotencyKey: current.key });
      const value = operationState(raw, environmentId);
      current = store({ ...current, operationId: value.id });
    }
    const operationId = current.operationId!;
    if (!current.versionId) {
      const deadline = Date.now() + 30 * 60_000;
      let wait = 1000, failures = 0;
      while (Date.now() < deadline) {
        let raw: unknown;
        try { raw = await send({ kind: "read", operationId }); }
        catch (cause) {
          signal.throwIfAborted();
          const { status, code } = (cause ?? {}) as { status?: number; code?: string };
          if (status !== 408 && status !== 429 && !(status && status >= 500)
            && !["network_error", "timeout", "transport_error"].includes(code ?? "")) throw cause;
          if (++failures >= 5) return "checking";
          await delay(Math.min(1000 * 2 ** failures, 30_000), signal);
          continue;
        }
        failures = 0;
        const { state } = operationState(raw, environmentId, operationId);
        if (state === "FAILED") { store({ ...current, failed: true }); return "failed"; }
        if (state === "SUCCEEDED") {
          const result = await send({ kind: "complete", operationId, threadId }) as {
            id?: unknown; draft?: { id?: unknown }; version_id?: unknown;
          } | null;
          if (result?.id !== configId || result.draft?.id !== draftId
            || !id(result.version_id) || result.version_id === current.baseVersionId) throw Error("无法确认环境发布版本。");
          current = store({ ...current, versionId: result.version_id });
          break;
        }
        await delay(wait, signal);
        wait = Math.min(wait * 2, 5000);
      }
    }
    if (!current.versionId) return "checking";
    const root = await readCloudService("detail", { id: configId }, identity, signal) as {
      id?: unknown; latest_ready_version_id?: unknown; version_id?: unknown; status?: unknown;
    } | null;
    signal.throwIfAborted();
    if (root?.id !== configId || (root.latest_ready_version_id !== current.versionId
      && !(root.status === "ready" && root.version_id === current.versionId))) return "checking";
    store({ ...current, confirmed: true });
    return "published";
  });
}

function operationState(raw: unknown, environmentId: string, operationId?: string) {
  const value = raw as { id?: unknown; kind?: unknown; environment_id?: unknown; state?: string } | null;
  if (!value || !id(value.id) || value.kind !== "APPROVE_ENVIRONMENT_CONFIG_DRAFT"
    || value.environment_id !== environmentId || (operationId && value.id !== operationId)
    || !["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(value.state ?? "")) throw Error("无法核对环境发布操作。");
  return { id: value.id, state: value.state };
}
