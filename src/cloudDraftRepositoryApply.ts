import { callCloudThread, type ServiceIdentity } from "./chatgptService";
import { listCloudDraftBindings, readBoundCloudDraft, rememberCloudDraftBinding } from "./cloudDraftBindings";
import { draftFieldValues, sameRepositoryFields, saveBoundDraftFields } from "./cloudDraftFields";
import type { readCloudDraftHistory } from "./cloudDraftHistory";
import type { CloudRepository } from "./cloudEnvironmentService";
import type { CloudDraftSession } from "./cloudDraftSession";

type History = Awaited<ReturnType<typeof readCloudDraftHistory>>;
type State = "saving" | "queued" | "paused" | "retry" | "unconfirmed";
interface Entry {
  id: string;
  state: State;
  base: string;
  revision: number;
  target: CloudRepository[];
  added: [string, string][];
  removed: [string, string][];
  deferred?: true;
}
export type RepositoryApplyStatus = State | "sent" | "obsolete" | "superseded";

function storageKey({ threadId, binding }: CloudDraftSession) {
  return `cloud-repository-apply-v1:${JSON.stringify([binding.accountId, binding.userId, binding.configId, binding.draftId, threadId])}`;
}

function readEntry(key: string): Entry | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const entry = JSON.parse(raw) as Entry | null;
  if (!entry || typeof entry.id !== "string" || typeof entry.base !== "string" || !Number.isSafeInteger(entry.revision)
    || !["saving", "queued", "paused", "retry", "unconfirmed"].includes(entry.state)
    || !Array.isArray(entry.target) || !entry.target.every(repo => repo && typeof repo.id === "string" && typeof repo.ref === "string")
    || ![entry.added, entry.removed].every(rows => Array.isArray(rows) && rows.every(row =>
      Array.isArray(row) && row.length === 2 && row.every(value => typeof value === "string")))) {
    throw Error("无法读取待处理的仓库变更记录。");
  }
  return entry;
}

function writeEntry(key: string, entry: Entry, state: State) {
  localStorage.setItem(key, JSON.stringify({ ...entry, state }));
}

function withApplyLock<T>(session: CloudDraftSession, signal: AbortSignal, operation: (key: string) => Promise<T>) {
  const { binding, identity } = session;
  signal.throwIfAborted();
  if (binding.accountId !== identity.accountId || binding.userId !== identity.userId) {
    throw Error("环境草稿与当前账号不匹配。");
  }
  if (!navigator.locks) throw Error("当前窗口无法安全保存仓库变更。");
  const key = storageKey(session);
  return navigator.locks.request(key, { signal }, () => {
    signal.throwIfAborted();
    return operation(key);
  });
}

export function pendingRepositoryApplySession(configId: string, identity: ServiceIdentity): CloudDraftSession | null {
  for (const [threadId, binding] of listCloudDraftBindings(configId, identity)) {
    const session = { threadId, identity, binding };
    if (readEntry(storageKey(session))) return session;
  }
  return null;
}

export function saveDraftWithRepositoryApply(
  session: CloudDraftSession, baseline: Parameters<typeof draftFieldValues>[0],
  values: ReturnType<typeof draftFieldValues>, names: Record<string, string>, signal: AbortSignal,
) {
  return withApplyLock(session, signal, async key => {
    const { binding, identity } = session;
    const before = new Set(baseline.repositories.map(repo => repo.id));
    const after = new Set(values.repositories.map(repo => repo.id));
    const allNames = { ...binding.repositoryNamesById, ...names };
    const pair = (id: string): [string, string] => [id, Object.hasOwn(allNames, id) ? allNames[id] : id];
    const added = [...after].filter(id => !before.has(id)).map(pair);
    const removed = [...before].filter(id => !after.has(id)).map(pair);
    const pending = readEntry(key);
    if (pending && (pending.state !== "saving" || pending.base !== baseline.baseVersionId
      || pending.revision !== baseline.revision || !sameRepositoryFields(pending.target, values.repositories))) {
      throw Error("请先核对当前待处理的仓库变更。");
    }
    if (!added.length && !removed.length) return saveBoundDraftFields(binding, baseline, values, identity, signal);
    if (added.length > 16 || removed.length > 16) throw Error("一次最多添加或移除 16 个仓库。");
    const entry: Entry = pending ?? {
      id: crypto.randomUUID(), state: "saving", base: baseline.baseVersionId,
      revision: baseline.revision, target: values.repositories, added, removed,
    };
    if (!rememberCloudDraftBinding(session.threadId, { ...binding, repositoryNamesById: allNames })) {
      throw Error("无法保存仓库变更对应的会话记录。");
    }
    writeEntry(key, entry, "saving");
    try {
      const detail = await saveBoundDraftFields(binding, baseline, values, identity, signal);
      writeEntry(key, entry, "queued");
      return detail;
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      if (!pending && !signal.aborted && ["invalid_request", "forbidden", "conflict"].includes(code ?? "")) {
        localStorage.removeItem(key);
      }
      throw cause;
    }
  });
}

export async function advanceRepositoryApply(session: CloudDraftSession, history: History, retry: boolean, signal: AbortSignal): Promise<RepositoryApplyStatus | null> {
  if (!readEntry(storageKey(session))) return null;
  return withApplyLock(session, signal, async key => {
    const entry = readEntry(key);
    if (!entry) return null;
    if (entry.state === "unconfirmed") {
      if (!history.turns.some(({ turn }) => turn.items.some(item => item.type === "userMessage" && item.clientId === entry.id))) return "unconfirmed";
      localStorage.removeItem(key);
      return "sent";
    }
    if ((entry.state === "paused" || entry.state === "retry") && !retry) return entry.state;
    const { threadId, binding, identity } = session;
    const current = (await readBoundCloudDraft(binding, identity, signal)).draft;
    signal.throwIfAborted();
    if (!current || current.baseVersionId !== entry.base
      || entry.state === "saving" && current.revision > entry.revision && !sameRepositoryFields(current.repositories, entry.target)) {
      localStorage.removeItem(key);
      return "superseded";
    }
    if (entry.state === "saving") {
      if (current.revision <= entry.revision) return "saving";
      writeEntry(key, entry, "queued");
    }
    const selected = new Set(current.repositories.map(repo => repo.id));
    const added = entry.added.filter(([id]) => selected.has(id)).map(([, name]) => name);
    const removed = entry.removed.filter(([id]) => !selected.has(id)).map(([, name]) => name);
    if (!added.length && !removed.length) {
      localStorage.removeItem(key);
      return "obsolete";
    }
    const thread = (await callCloudThread({ kind: "read", threadId }, identity, signal) as {
      thread?: { status?: { type?: string }; id?: string };
    }).thread;
    signal.throwIfAborted();
    const latest = history.turns.at(-1)?.turn;
    if (thread?.id !== threadId || thread.status?.type !== "idle" || latest?.status === "inProgress") {
      if (!entry.deferred || entry.state !== "queued") writeEntry(key, { ...entry, deferred: true }, "queued");
      return "queued";
    }
    if (!retry && latest?.status === "interrupted") {
      writeEntry(key, entry, "paused");
      return "paused";
    }
    if (!retry && entry.deferred && latest && (latest.status !== "completed" || !latest.items.some(item =>
      item.type === "agentMessage" || item.type === "contextCompaction" && item.source === "manual"))) return "queued";
    writeEntry(key, entry, "unconfirmed");
    let receipt: { turn?: { id?: string } };
    try {
      receipt = await callCloudThread({
        kind: "start_repository_apply", threadId, clientUserMessageId: entry.id, serviceTier: null, added, removed,
      }, identity, signal) as typeof receipt;
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      if (!signal.aborted && code === "desktop_context_unavailable") {
        writeEntry(key, entry, "retry");
        return "retry";
      }
      return "unconfirmed";
    }
    signal.throwIfAborted();
    if (typeof receipt?.turn?.id !== "string" || !receipt.turn.id) return "unconfirmed";
    localStorage.removeItem(key);
    return "sent";
  });
}
