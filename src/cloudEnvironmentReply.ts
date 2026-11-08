import { callCloudThread, type ServiceIdentity } from "./chatgptService";
import { listCloudDraftBindings } from "./cloudDraftBindings";
import type { readCloudDraftHistory } from "./cloudDraftHistory";
import type { CloudDraftSession } from "./cloudDraftSession";
import { resolveCloudSetupModel } from "./cloudSetupModel";

export const cloudReplyMaxLength = 32768;
type History = Awaited<ReturnType<typeof readCloudDraftHistory>>;
type Reply = { id: string; text: string } & (
  | { phase: "queued"; deferred?: boolean; paused?: boolean }
  | { phase: "sending" }
  | { phase: "accepted"; turnId: string }
);

const replyKey = ({ identity, threadId, binding }: CloudDraftSession) =>
  `cloud-environment-reply-v1:${JSON.stringify([identity.accountId, identity.userId, binding.configId, binding.draftId, threadId])}`;

function readReply(key: string): Reply | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as Reply | null;
  if (!value || typeof value.id !== "string" || !value.id || typeof value.text !== "string" || !value.text.trim()
    || value.text.length > cloudReplyMaxLength || value.text.includes("\0")
    || !(value.phase === "queued" || value.phase === "sending" || value.phase === "accepted" && typeof value.turnId === "string" && value.turnId)) {
    throw Error("无法读取待发送的回复。");
  }
  return value;
}

function withReplyLock<T>(session: CloudDraftSession, signal: AbortSignal, operation: (key: string) => Promise<T> | T) {
  const { identity, binding } = session;
  signal.throwIfAborted();
  if (identity.accountId !== binding.accountId || identity.userId !== binding.userId) throw Error("回复与当前账号不匹配。");
  if (!navigator.locks) throw Error("当前窗口无法安全发送回复。");
  const key = replyKey(session);
  return navigator.locks.request(key, { signal }, () => {
    signal.throwIfAborted();
    return operation(key);
  });
}

export function pendingCloudReplySession(configId: string, identity: ServiceIdentity): CloudDraftSession | null {
  for (const [threadId, binding] of listCloudDraftBindings(configId, identity)) {
    const session = { threadId, binding, identity };
    if (readReply(replyKey(session))) return session;
  }
  return null;
}

export function changeCloudEnvironmentReply(session: CloudDraftSession, text: string | null, signal: AbortSignal, initialId?: string) {
  return withReplyLock(session, signal, key => {
    const current = readReply(key);
    if (text === null) {
      if (current?.phase === "queued") localStorage.removeItem(key);
      return;
    }
    const message = text.trim();
    if (!message || message.length > cloudReplyMaxLength || message.includes("\0")) throw Error("回复内容无效。");
    if (current) {
      if (initialId && current.id === initialId && current.text === message) return;
      throw Error("请先处理上一条待发送的回复。");
    }
    localStorage.setItem(key, JSON.stringify({ id: initialId ?? crypto.randomUUID(), text: message, phase: "queued" } satisfies Reply));
  });
}

export type CloudReplyStatus = "queued" | "paused" | "unconfirmed" | "accepted" | null;
export async function advanceCloudEnvironmentReply(
  session: CloudDraftSession, history: History, signal: AbortSignal, resume = false,
): Promise<CloudReplyStatus> {
  if (!readReply(replyKey(session))) return null;
  return withReplyLock(session, signal, async key => {
    const current = readReply(key);
    if (!current) return null;
    if (current.phase !== "queued") {
      if (history.turns.some(({ turn }) => current.phase === "accepted" && turn.id === current.turnId
        || turn.items.some(item => item.type === "userMessage" && item.clientId === current.id))) {
        localStorage.removeItem(key);
        return null;
      }
      return current.phase === "accepted" ? "accepted" : "unconfirmed";
    }
    const latest = history.turns.at(-1)?.turn;
    if (!resume && (current.paused || (current.deferred && latest?.status === "interrupted"))) {
      if (!current.paused) localStorage.setItem(key, JSON.stringify({ ...current, paused: true }));
      return "paused";
    }
    const { identity, threadId } = session;
    const settings = await resolveCloudSetupModel(identity, signal);
    const { thread } = await callCloudThread({ kind: "read", threadId }, identity, signal) as {
      thread?: { id?: string; cwd?: string; status?: { type?: string } };
    };
    signal.throwIfAborted();
    if (thread?.id !== threadId || thread.status?.type !== "idle" || latest?.status === "inProgress") {
      if (!current.deferred || current.paused) localStorage.setItem(key, JSON.stringify({ ...current, deferred: true, paused: false }));
      return "queued";
    }
    if (!resume && current.deferred && latest && (latest.status !== "completed" || !latest.items.some(item =>
      item.type === "agentMessage" || item.type === "contextCompaction" && item.source === "manual"))) {
      localStorage.setItem(key, JSON.stringify({ ...current, paused: true }));
      return "paused";
    }
    if (!thread.cwd?.startsWith("/")) throw Error("无法确认设置会话的工作目录。");
    localStorage.setItem(key, JSON.stringify({ ...current, phase: "sending" }));
    try {
      const result = await callCloudThread({
        kind: "start_environment_reply", threadId, clientUserMessageId: current.id, cwd: thread.cwd,
        text: current.text, ...settings,
      }, identity, signal) as { turn?: { id?: string } };
      signal.throwIfAborted();
      if (!result?.turn?.id) return "unconfirmed";
      localStorage.setItem(key, JSON.stringify({ ...current, phase: "accepted", turnId: result.turn.id }));
      return "accepted";
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      if (!signal.aborted && (code === "invalid_request" || code === "desktop_context_unavailable")) {
        localStorage.setItem(key, JSON.stringify(current));
        throw cause;
      }
      return "unconfirmed";
    }
  });
}
