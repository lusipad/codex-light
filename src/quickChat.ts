export interface QuickChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "done" | "error";
}

export interface QuickChatStreamState {
  messages: QuickChatMessage[];
  activeTurnId: string | null;
  isStreaming: boolean;
  error: string | null;
}

export function createQuickChatStreamState(
  messages: QuickChatMessage[] = [],
  activeTurnId: string | null = null
): QuickChatStreamState {
  return {
    messages,
    activeTurnId,
    isStreaming: Boolean(activeTurnId),
    error: null,
  };
}

export function quickChatItemText(item: any): string {
  if (typeof item?.text === "string") return item.text;
  if (typeof item?.content === "string") return item.content;
  if (Array.isArray(item?.content)) {
    return item.content
      .map((part: any) => typeof part === "string" ? part : part?.text || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function quickChatHistory(turns: any[]): QuickChatMessage[] {
  const messages: QuickChatMessage[] = [];
  for (const [turnIndex, turn] of (turns || []).entries()) {
    for (const [itemIndex, item] of (turn?.items || []).entries()) {
      const isUser = item?.type === "userMessage"
        || (item?.type === "message" && item?.role === "user");
      const isAssistant = item?.type === "agentMessage"
        || (item?.type === "message" && item?.role === "assistant");
      if (!isUser && !isAssistant) continue;
      const role = isUser ? "user" : "assistant";
      messages.push({
        id: item.id || `history-${turn?.id || turnIndex}-${itemIndex}`,
        role,
        content: quickChatItemText(item),
        status: "done",
      });
    }
  }
  return messages;
}

export function quickChatActiveTurnId(turns: any[]): string | null {
  const active = [...(turns || [])].reverse().find((turn) =>
    ["running", "inProgress", "active"].includes(turn?.status)
  );
  return active?.id || null;
}

function quickChatEventThreadId(params: any): string | null {
  return params?.threadId || params?.turn?.threadId || params?.thread?.id || null;
}

function quickChatError(params: any): string {
  const value = params?.turn?.error ?? params?.error ?? params;
  if (typeof value === "string") return value;
  return value?.message || JSON.stringify(value);
}

function mergeCompletedAssistantMessages(
  messages: QuickChatMessage[],
  items: any[] | null,
  turnId: string | null
): QuickChatMessage[] {
  const merged = messages.map((message) => ({ ...message }));
  const byId = new Map(merged.map((message, index) => [message.id, index]));
  for (const [index, item] of (items || []).entries()) {
    if (item?.type !== "agentMessage") continue;
    const id = item.id || `completed-${turnId || "turn"}-${index}`;
    const text = quickChatItemText(item);
    const existingIndex = byId.get(id);
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        content: text || existing.content,
        status: "done",
      };
    } else {
      byId.set(id, merged.length);
      merged.push({ id, role: "assistant", content: text, status: "done" });
    }
  }
  return merged.map((message) =>
    message.role === "assistant" && message.status !== "error"
      ? { ...message, status: "done" }
      : message
  );
}

export function applyQuickChatNotification(
  state: QuickChatStreamState,
  method: string,
  params: any,
  currentThreadId: string | null
): QuickChatStreamState {
  if (!currentThreadId) return state;
  const eventThreadId = quickChatEventThreadId(params);
  if (eventThreadId && eventThreadId !== currentThreadId) return state;

  if (method === "turn/started") {
    const turnId = params?.turn?.id || params?.turnId;
    if (!turnId) return state;
    return {
      ...state,
      activeTurnId: String(turnId),
      isStreaming: true,
      error: null,
    };
  }

  if (method === "item/agentMessage/delta" || method === "codex/event/agent_message_delta") {
    const turnId = params?.turnId || state.activeTurnId;
    if (state.activeTurnId && turnId && state.activeTurnId !== turnId) return state;
    const delta = params?.delta || params?.text || "";
    if (!delta) return state;
    const itemId = params?.itemId || `assistant-${turnId || "active"}`;
    const messages = [...state.messages];
    const index = messages.findIndex((message) => message.id === itemId);
    if (index >= 0) {
      const existing = messages[index];
      messages[index] = {
        ...existing,
        content: existing.content + delta,
        status: "streaming",
      };
    } else {
      messages.push({ id: itemId, role: "assistant", content: delta, status: "streaming" });
    }
    return { ...state, messages, isStreaming: true, error: null };
  }

  if (method === "turn/completed") {
    const turnId = params?.turn?.id || params?.turnId || null;
    if (state.activeTurnId && turnId && state.activeTurnId !== turnId) return state;
    const items = Array.isArray(params?.turn?.items) ? params.turn.items : null;
    const error = params?.turn?.error ? quickChatError(params.turn.error) : null;
    return {
      ...state,
      messages: mergeCompletedAssistantMessages(state.messages, items, turnId),
      activeTurnId: null,
      isStreaming: false,
      error,
    };
  }

  if (method === "error") {
    return {
      ...state,
      activeTurnId: null,
      isStreaming: false,
      error: quickChatError(params),
    };
  }

  return state;
}
