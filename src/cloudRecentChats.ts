import { callCloudThread, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { readCloudDraftBinding } from "./cloudDraftBindings";
import type { CloudDraftSession } from "./cloudDraftSession";

export interface CloudRecentChat {
  session: CloudDraftSession;
  title: string;
  recency: number;
}

export type CloudRecentAction = { kind: "rename"; name: string } | { kind: "archive" | "unarchive" };

export function sameCloudRecentIdentity(a: ServiceIdentity | undefined, b: ServiceIdentity): boolean {
  return a?.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
}

export async function applyCloudRecentAction(chat: CloudRecentChat, action: CloudRecentAction, signal: AbortSignal): Promise<boolean> {
  const { threadId, identity, binding } = chat.session;
  signal.throwIfAborted();
  if (!binding.conversation || binding.accountId !== identity.accountId || binding.userId !== identity.userId)
    throw Error("无法确认云端聊天身份。");
  if (action.kind === "rename") {
    const name = action.name.trim();
    if (!name || name === chat.title) return false;
    await callCloudThread({ kind: "title", threadId, name }, identity, signal);
    signal.throwIfAborted();
    const result = await callCloudThread({ kind: "read", threadId }, identity, signal) as { thread?: { id?: string; name?: string } };
    if (result.thread?.id !== threadId || result.thread.name !== name) throw Error("云端标题尚未确认，请重新查看聊天。");
  } else {
    await callCloudThread({ kind: "archive", threadId, archived: action.kind === "archive" }, identity, signal);
  }
  signal.throwIfAborted();
  return true;
}

type CatalogThread = {
  id: string;
  name?: unknown;
  preview?: unknown;
  recencyAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  environments?: { environmentConfigId?: string; environmentId?: string }[] | null;
  archived?: boolean;
  ephemeral?: boolean;
  sideConversation?: boolean;
  parentThreadId?: string | null;
  threadSource?: string;
};

const label = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function readCloudRecentChats(identity: ServiceIdentity, signal: AbortSignal): Promise<CloudRecentChat[]> {
  const chats = new Map<string, CloudRecentChat>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    const page = await callCloudThread({ kind: "list", cursor }, identity, signal) as {
      data: CatalogThread[]; nextCursor?: string | null;
    };
    signal.throwIfAborted();
    for (const thread of page.data) {
      if (chats.has(thread.id) || thread.archived || thread.ephemeral || thread.sideConversation ||
        thread.parentThreadId || thread.threadSource === "aeon_child" || thread.threadSource === "dreaming") continue;
      const known = readCloudDraftBinding(thread.id, identity);
      if (known && !known.conversation) continue;
      const environments = thread.environments;
      if (environments != null && (!Array.isArray(environments) || environments.length > 1)) continue;
      const environment = environments?.[0];
      if (known && environment?.environmentConfigId != null && environment.environmentConfigId !== known.configId) continue;
      const configId = environment?.environmentConfigId ?? known?.configId;
      const environmentId = environment?.environmentId ?? known?.environmentId;
      if (typeof configId !== "string" || !/^(?:[A-Za-z0-9_-]+~)?asenvcfg_[A-Za-z0-9_-]+(?![\s\S])/.test(configId)
        || typeof environmentId !== "string" || !environmentId.trim()) continue;
      const time = [thread.recencyAt, thread.updatedAt, thread.createdAt]
        .find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? 0;
      const binding = { accountId: identity.accountId, userId: identity.userId,
        configId, environmentId, draftId: null, name: known?.name ?? "",
        repositoryNamesById: known?.repositoryNamesById ?? {}, conversation: true as const };
      chats.set(thread.id, { session: { threadId: thread.id, identity, binding },
        title: label(thread.name) || label(thread.preview) || "新聊天", recency: time });
    }
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (cursors.has(cursor)) throw Error("云端聊天目录返回了重复游标。");
      cursors.add(cursor);
    }
  } while (cursor !== null);
  const current = await serviceIdentity(signal);
  signal.throwIfAborted();
  if (!sameCloudRecentIdentity(current, identity))
    throw Error("读取期间账号发生变化，请重新刷新。");
  return [...chats.values()].sort((a, b) => b.recency - a.recency);
}
