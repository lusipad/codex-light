export interface ChatgptConversationLocation { id: string; projectId: string | null; temporary: boolean }
/** Fixed CU19 routes. Client and server ids share the route, not their meaning. */
export function chatgptConversationPath(location: ChatgptConversationLocation): string {
  return `${location.projectId === null ? "" : `/g/${encodeURIComponent(location.projectId)}`}/c/${encodeURIComponent(location.id)}${location.temporary ? "?temporary-chat=true" : ""}`;
}
export function parseChatgptConversationLocation(value: string): ChatgptConversationLocation | null {
  try {
    const url = new URL(value), match = /^(?:\/g\/([^/]+))?\/c\/([^/]+)$/.exec(url.pathname);
    if (!match) return null;
    return { id: decodeURIComponent(match[2]), projectId: match[1] === undefined ? null : decodeURIComponent(match[1]),
      temporary: url.searchParams.get("temporary-chat") === "true" };
  } catch { return null; }
}
