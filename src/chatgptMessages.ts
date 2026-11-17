export const CHATGPT_CLIENT_ROOT = "client-created-root";

/** Qh8n.E/OOaz.co: a client draft and its root are separate from a server id. */
export function createChatgptDraftIdentity(uuid: string) {
  return { clientId: `local-chatgpt:${uuid}`, parentMessageId: CHATGPT_CLIENT_ROOT };
}

/** Fixed 26.1111 a1Qm.Ll ordinary text-only user message. This is not a
 * completion result or a local app-server TurnItem. */
export interface ChatgptUserMessage {
  author: { metadata: Record<string, never>; name: null; role: "user" };
  channel: null;
  content: { content_type: "text"; parts: [string] };
  create_time: number;
  end_turn: null;
  id: string;
  metadata: { automation_creation_attribution: { origin: "conversation"; flow_id: string } };
  recipient: "all";
  status: "finished_successfully";
  update_time: null;
  weight: 1;
}

export function createChatgptUserMessage(input: { id: string; prompt: string; createdAt: number }): ChatgptUserMessage {
  return {
    author: { metadata: {}, name: null, role: "user" }, channel: null,
    content: { content_type: "text", parts: [input.prompt.trim()] }, create_time: input.createdAt / 1000,
    end_turn: null, id: input.id,
    metadata: { automation_creation_attribution: { origin: "conversation", flow_id: input.id } },
    recipient: "all", status: "finished_successfully", update_time: null, weight: 1,
  };
}

export interface ChatgptTextRequestInput {
  model: string;
  thinkingEffort: string | null;
  messages: ChatgptUserMessage[];
  parentMessageId: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  timezone: string;
  timezoneOffsetMinutes: number;
  systemHints: string[];
  isTemporaryChat: boolean;
  isDoNotRemember?: boolean;
  consumerLockdownModeDisabled?: boolean;
  requestedDefaultModel?: string;
  serviceTier?: string | null;
  conversationOrigin?: string | null;
}

/** Y86X.U ordinary next-message projection. The caller must supply actual
 * draft/server ancestry and verified conditions; undefined is omitted on wire.
 * This does not supply requirements, conduit, uploads or source gated context. */
export function createChatgptTextRequest(input: ChatgptTextRequestInput) {
  const defaultOverride = input.conversationOrigin !== "tpp" && input.conversationOrigin !== "flora"
    && input.requestedDefaultModel !== input.model ? input.requestedDefaultModel : undefined;
  return {
    action: "next" as const, model: input.model, parent_message_id: input.parentMessageId ?? undefined,
    conversation_id: input.conversationId ?? undefined,
    timezone: input.timezone, timezone_offset_min: input.timezoneOffsetMinutes,
    history_and_training_disabled: input.isTemporaryChat || undefined,
    is_do_not_remember: input.isDoNotRemember, consumer_lockdown_mode_disabled: input.consumerLockdownModeDisabled,
    requested_default_model: defaultOverride, one_off_model_override: defaultOverride != null || undefined,
    service_tier: input.serviceTier ?? undefined,
    system_hints: input.systemHints.length ? [...input.systemHints] : undefined,
    thinking_effort: input.thinkingEffort ?? undefined, conversation_origin: input.conversationOrigin ?? undefined,
    ...(input.projectId == null ? {} : { gizmo_id: input.projectId,
      conversation_mode: { kind: "gizmo_interaction", gizmo_id: input.projectId } }),
    messages: input.messages, supported_encodings: ["v1"],
  };
}
