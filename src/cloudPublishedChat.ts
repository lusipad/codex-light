import { callCloudThread, readCloudService, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { rememberCloudDraftBinding } from "./cloudDraftBindings";
import type { CloudDraftSession } from "./cloudDraftSession";
import { changeCloudEnvironmentReply, cloudReplyMaxLength } from "./cloudEnvironmentReply";
import { resolveCloudSetupModel } from "./cloudSetupModel";

export interface PublishedCloudTarget {
  session: CloudDraftSession;
  versionId: string;
}

export async function verifyPublishedCloudTarget(target: PublishedCloudTarget, signal: AbortSignal): Promise<string> {
  const { session: { binding, identity }, versionId } = target;
  const raw = await readCloudService("detail", { id: binding.configId }, identity, signal) as {
    id?: unknown; name?: unknown; latest_ready_version_id?: unknown;
  } | null;
  const after = await serviceIdentity(signal);
  signal.throwIfAborted();
  if (after.accountId !== identity.accountId || after.userId !== identity.userId || after.generation !== identity.generation)
    throw Error("云端账号已更改，请重新选择环境。");
  if (raw?.id !== binding.configId || raw.latest_ready_version_id !== versionId || typeof raw.name !== "string" || !raw.name.trim())
    throw Error("无法确认当前环境的最新就绪版本。");
  return raw.name;
}

interface StartRecord { text: string; messageId: string; threadId?: string; queued?: true }
const startKey = ({ session: { identity, binding }, versionId }: PublishedCloudTarget) =>
  `published-cloud-chat-v1:${JSON.stringify([identity.accountId, identity.userId, binding.configId, versionId])}`;

export function readPublishedCloudStart(target: PublishedCloudTarget): StartRecord | null {
  const raw = localStorage.getItem(startKey(target));
  if (raw === null) return null;
  const entry = JSON.parse(raw) as StartRecord | null;
  if (!entry || typeof entry.text !== "string" || !entry.text.trim() || entry.text.length > cloudReplyMaxLength || entry.text.includes("\0")
    || typeof entry.messageId !== "string" || !entry.messageId
    || (entry.threadId !== undefined && (typeof entry.threadId !== "string" || !entry.threadId))
    || (entry.queued !== undefined && (entry.queued !== true || !entry.threadId))) throw Error("无法读取云端聊天的发送记录。");
  return entry;
}

export async function startPublishedCloudChat(
  target: PublishedCloudTarget, text: string, signal: AbortSignal, open: (session: CloudDraftSession) => boolean,
) {
  const { session: { identity, binding } } = target;
  const key = startKey(target);
  signal.throwIfAborted();
  if (!navigator.locks) throw Error("当前窗口无法安全创建云端聊天。");
  await navigator.locks.request(key, { ifAvailable: true }, async lock => {
    if (!lock) throw Error("此环境已有云端聊天正在启动。");
    signal.throwIfAborted();
    let entry = readPublishedCloudStart(target);
    if (entry && !entry.threadId) throw { code: "cloud_thread_start_unconfirmed" };
    let name = binding.name;
    if (!entry) {
      const message = text.trim();
      if (!message || message.length > cloudReplyMaxLength || message.includes("\0")) throw Error("消息内容无效。");
      name = await verifyPublishedCloudTarget(target, signal);
      const settings = await resolveCloudSetupModel(identity, signal);
      signal.throwIfAborted();
      entry = { text: message, messageId: crypto.randomUUID() };
      localStorage.setItem(key, JSON.stringify(entry));
      let result: { thread?: { id?: string } };
      try {
        result = await callCloudThread({ kind: "start_saved_environment", environmentConfigId: binding.configId, ...settings }, identity, signal) as typeof result;
      } catch (cause) {
        const code = (cause as { code?: string } | null)?.code;
        if (!signal.aborted && (code === "invalid_request" || code === "desktop_context_unavailable")) localStorage.removeItem(key);
        throw cause;
      }
      signal.throwIfAborted();
      if (!result?.thread?.id) throw { code: "cloud_thread_start_unconfirmed" };
      entry = { ...entry, threadId: result.thread.id };
      localStorage.setItem(key, JSON.stringify(entry));
    }
    const current = await serviceIdentity(signal);
    signal.throwIfAborted();
    if (current.accountId !== identity.accountId || current.userId !== identity.userId || current.generation !== identity.generation)
      throw Error("云端账号已更改，请重新选择环境。");
    const session: CloudDraftSession = { identity, threadId: entry.threadId!,
      binding: { ...binding, name, draftId: null, conversation: true } };
    if (!entry.queued) {
      await changeCloudEnvironmentReply(session, entry.text, signal, entry.messageId);
      localStorage.setItem(key, JSON.stringify({ ...entry, queued: true }));
    }
    if (!rememberCloudDraftBinding(session.threadId, session.binding)) throw Error("无法保存云端聊天关联。");
    signal.throwIfAborted();
    if (open(session)) localStorage.removeItem(key);
  });
}
