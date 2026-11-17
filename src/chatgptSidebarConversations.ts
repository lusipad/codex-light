import type { ChatgptTextConversation } from "./useChatgptTextConversation";
import type { ChatgptConversationListItem } from "./chatgptConversationList";
import { getChatgptHistoryActivity } from "./chatgptConversationHistory";

export interface ChatgptSidebarConversation {
  id: string;
  title: string;
  pending: boolean;
  serverId: string | null;
  gizmoId: string | null;
}
const isPending = (item: ChatgptTextConversation) => {
  const activity = item.history ? getChatgptHistoryActivity(item.history) : "idle";
  return item.pending || activity === "active" || activity === "background";
};

/** CL02's optimistic-before-recent order. Inputs must already belong to the
 * same owner. The source concurrent-title overlay is not implemented here:
 * listed server titles win. Pins and pagination remain outside this helper. */
export function mergeChatgptSidebarConversations(memory: readonly ChatgptTextConversation[],
  items: readonly ChatgptConversationListItem[]): ChatgptSidebarConversation[] {
  const serverIds = new Set<string>(), listed = items.filter(item => {
    if (serverIds.has(item.id)) return false;
    serverIds.add(item.id); return true;
  });
  const regular = memory.filter(item => !item.isTemporaryChat), seen = new Set(serverIds);
  const local: ChatgptSidebarConversation[] = [];
  for (const item of regular) {
    if (seen.has(item.clientId) || item.serverId !== null && seen.has(item.serverId)) continue;
    seen.add(item.clientId); if (item.serverId !== null) seen.add(item.serverId);
    const user = item.messages.find(message => message.raw.author !== null && typeof message.raw.author === "object"
      && !Array.isArray(message.raw.author) && (message.raw.author as Record<string, unknown>).role === "user");
    local.push({ id: item.clientId, serverId: item.serverId, gizmoId: item.projectId,
      title: item.title ?? user?.text ?? "新聊天", pending: isPending(item) });
  }
  return [...local, ...listed.map(item => ({ id: item.id, serverId: item.id, gizmoId: item.gizmoId, title: item.title,
    pending: regular.some(record => isPending(record) && (record.serverId === item.id || record.clientId === item.id)) }))];
}
