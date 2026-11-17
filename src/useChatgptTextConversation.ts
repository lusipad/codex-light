import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ServiceIdentity } from "./chatgptService";
import type { WorkModelSelection } from "./workModelCatalog";
import { createChatgptDraftIdentity, createChatgptTextRequest, createChatgptUserMessage, type ChatgptTextRequestInput } from "./chatgptMessages";
import { applyChatgptStreamFrame, closeChatgptStream, createChatgptStreamState, type ChatgptStreamMessage } from "./chatgptStreamState";
import { stopChatgptText, submitChatgptText } from "./chatgptTextClient";
import type { ChatgptConversationHistory } from "./chatgptConversationHistory";

export interface ChatgptTextConversationOptions {
  identity: ServiceIdentity | null;
  ownerKey: string;
  onOptimisticStart: (clientId: string) => boolean;
  onAccepted: (submittedPrompt: string, clientId: string) => void;
  onRestore: (submittedPrompt: string, clientId: string) => void;
}
export interface ChatgptConversationMessage extends ChatgptStreamMessage {
  id: string;
  optimistic: boolean;
  unsupported: boolean;
}
export interface ChatgptTextConversation {
  clientId: string;
  serverId: string | null;
  title: string | null;
  model: WorkModelSelection | null;
  currentNodeId: string | null;
  readOnly: boolean | null;
  history?: ChatgptConversationHistory;
  projectId: string | null;
  isTemporaryChat: boolean;
  messages: ChatgptConversationMessage[];
  pending: boolean;
  error: string | null;
  deliveryUnknown: boolean;
  stopPending: boolean;
  stopConfirmed: boolean;
  messageStreamComplete: boolean;
  transport: 'open' | 'done' | 'aborted' | 'error';
  unsupportedEventTypes: string[];
}
export interface ChatgptTextConversationSend extends Partial<Pick<ChatgptTextRequestInput,
  'systemHints' | 'timezone' | 'timezoneOffsetMinutes' | 'isTemporaryChat' | 'isDoNotRemember'
  | 'consumerLockdownModeDisabled' | 'requestedDefaultModel' | 'serviceTier' | 'conversationOrigin'>> {
  prompt: string;
  selection: WorkModelSelection;
  /** null creates a new chat; a string targets a captured existing record. */
  clientId?: string | null;
  projectId?: string | null;
}
const scopeKey = (options: Pick<ChatgptTextConversationOptions, 'ownerKey' | 'identity'>) => JSON.stringify([options.ownerKey,
  options.identity?.accountId, options.identity?.userId, options.identity?.generation]);
const errorText = (error: unknown) => typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
  ? error.message : typeof error === 'string' ? error : 'ChatGPT 请求未完成。';

/** In-memory text-only owner. Route visibility is deliberately not its lifetime. */
export function createChatgptTextConversationController(getOptions: () => ChatgptTextConversationOptions) {
  let scope = scopeKey(getOptions()), epoch = 0, selectedId: string | null = null, selectionRevision = 0;
  const records = new Map<string, ChatgptTextConversation>(), listeners = new Set<() => void>();
  const empty = { conversation: null, conversations: [] } as { conversation: ChatgptTextConversation | null; conversations: ChatgptTextConversation[] };
  let snapshot = empty;
  interface Flight { clientId: string; epoch: number; scope: string; abort: AbortController; stopAbort: AbortController; prompt: string; accepted: boolean;
    onAccepted: ChatgptTextConversationOptions['onAccepted']; onRestore: ChatgptTextConversationOptions['onRestore'] }
  const flights = new Map<string, Flight>();
  const refresh = () => {
    snapshot = { conversation: selectedId ? records.get(selectedId) ?? null : null, conversations: [...records.values()] };
    for (const listener of listeners) listener();
  };
  const current = (request: Flight) => flights.get(request.clientId) === request && epoch === request.epoch && scope === request.scope && scopeKey(getOptions()) === request.scope;
  const put = (value: ChatgptTextConversation) => { records.set(value.clientId, value); refresh(); };
  const patch = (clientId: string, value: Partial<ChatgptTextConversation>) => { const record = records.get(clientId); if (record) put({ ...record, ...value }); };
  const reset = () => {
    ++epoch; ++selectionRevision; const retired = [...flights.values()]; flights.clear(); records.clear(); selectedId = null; scope = scopeKey(getOptions());
    for (const request of retired) { request.abort.abort(); request.stopAbort.abort(); } refresh();
  };
  const syncScope = () => { if (scope !== scopeKey(getOptions())) reset(); };
  const restore = (request: Flight) => { if (request.accepted && current(request)) request.onRestore(request.prompt, request.clientId); };
  const send = async (input: ChatgptTextConversationSend): Promise<boolean> => {
    syncScope();
    const options = getOptions(), state = input.clientId === null ? null
      : typeof input.clientId === 'string' ? records.get(input.clientId) ?? null : snapshot.conversation;
    if (typeof input.clientId === 'string' && !state) return false;
    if (!options.identity || !input.prompt.trim() || !input.selection.slug || state?.pending || state?.stopPending || state?.deliveryUnknown) return false;
    if (state?.readOnly === true) { patch(state.clientId, { error: '此聊天为只读。' }); return false; }
    if (state && (state.currentNodeId === null || state.history && state.history.integrity !== 'complete')) {
      patch(state.clientId, { error: '历史消息图的当前节点尚未完整确认，暂不能继续发送。' }); return false;
    }
    if (state && (!state.serverId && state.messages.length > 0 || input.projectId !== undefined && (input.projectId ?? null) !== state.projectId
      || input.isTemporaryChat !== undefined && input.isTemporaryChat !== state.isTemporaryChat)) {
      patch(state.clientId, { error: '当前会话的服务身份或项目上下文尚未确认。' }); return false;
    }
    const identity = { ...options.identity }, draft = createChatgptDraftIdentity(crypto.randomUUID());
    const user = createChatgptUserMessage({ id: crypto.randomUUID(), prompt: input.prompt, createdAt: Date.now() });
    const prior = state, projectId = prior?.projectId ?? input.projectId ?? null, clientId = prior?.clientId ?? draft.clientId;
    const parentMessageId = prior ? prior.currentNodeId : draft.parentMessageId;
    if (!parentMessageId) return false;
    const request: Flight = { clientId, epoch, scope, abort: new AbortController(), stopAbort: new AbortController(), prompt: input.prompt,
      accepted: false, onAccepted: options.onAccepted, onRestore: options.onRestore };
    flights.set(clientId, request);
    const read = () => records.get(clientId)!, update = (value: Partial<ChatgptTextConversation>) => patch(clientId, value);
    const stream = createChatgptStreamState();
    const optimistic: ChatgptConversationMessage = { id: user.id, raw: user as unknown as Record<string, unknown>, text: user.content.parts[0], optimistic: true, unsupported: false };
    const originalSelectionRevision = selectionRevision;
    put({ clientId, serverId: prior?.serverId ?? null, title: prior?.title ?? null,
      model: { ...input.selection }, currentNodeId: parentMessageId, readOnly: prior?.readOnly ?? null, history: prior?.history,
      projectId, isTemporaryChat: prior?.isTemporaryChat ?? input.isTemporaryChat ?? false,
      messages: [...(prior?.messages ?? []), optimistic], pending: true, error: null, deliveryUnknown: false,
      stopPending: false, stopConfirmed: false, messageStreamComplete: false, transport: 'open', unsupportedEventTypes: prior?.unsupportedEventTypes ?? [] });
    try {
      if (!current(request)) return false;
      // Returning false only declines navigation; it does not undo the user's send.
      const shouldSelect = options.onOptimisticStart(clientId);
      if (!current(request)) return false;
      if (shouldSelect && originalSelectionRevision === selectionRevision) { selectedId = clientId; ++selectionRevision; refresh(); }
      const body = createChatgptTextRequest({ ...input, model: input.selection.slug, thinkingEffort: input.selection.thinkingEffort,
        messages: [user], parentMessageId, conversationId: prior?.serverId, projectId,
        timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? new Date().getTimezoneOffset(),
        systemHints: input.systemHints ?? [], isTemporaryChat: read().isTemporaryChat });
      await submitChatgptText({ identity, body, signal: request.abort.signal,
        onResponseAccepted: () => {
          if (!current(request) || request.accepted) return;
          request.accepted = true; request.onAccepted(request.prompt, clientId);
        },
        onFrame: frame => {
          if (!current(request)) return;
          const outcome = applyChatgptStreamFrame(stream, frame);
          if (outcome.kind === 'error') throw new Error(errorText(outcome.error));
          if (outcome.kind === 'message') {
            const incoming = stream.messages[outcome.id], raw = incoming.raw;
            const author = raw.author as { role?: unknown } | undefined;
            const unsupported = incoming.text === null || !['user', 'assistant'].includes(String(author?.role))
              || raw.recipient != null && raw.recipient !== 'all';
            const item: ChatgptConversationMessage = { ...incoming, id: outcome.id, optimistic: false, unsupported };
            const messages = [...read().messages], index = messages.findIndex(message => message.id === outcome.id);
            if (index < 0) messages.push(item); else messages[index] = item;
            update({ messages, serverId: stream.conversationId ?? read().serverId, currentNodeId: outcome.id });
          } else if (outcome.kind === 'title') update({ title: outcome.title });
          else if (outcome.kind === 'unknown') {
            const payload = outcome.payload, type = payload !== null && typeof payload === 'object' && 'type' in payload && typeof payload.type === 'string'
              ? payload.type : 'unknown';
            if (!read().unsupportedEventTypes.includes(type)) update({ unsupportedEventTypes: [...read().unsupportedEventTypes, type] });
          }
          if (current(request)) update({ messageStreamComplete: stream.messageStreamComplete, transport: stream.transport });
        },
      });
      if (!current(request)) return false;
      if (stream.transport !== 'done') {
        const result = closeChatgptStream(stream, 'eof');
        throw new Error(result.kind === 'error' ? errorText(result.error) : 'ChatGPT 流结束尚未确认。');
      }
      update({ pending: false, transport: 'done' }); if (!read().stopPending) flights.delete(clientId); return true;
    } catch (error) {
      if (!current(request)) return false;
      closeChatgptStream(stream, request.abort.signal.aborted ? 'abort' : 'eof');
      const notDispatched = typeof error === 'object' && error !== null && 'completionDispatched' in error && error.completionDispatched === false;
      update({ pending: false, error: errorText(error), deliveryUnknown: !notDispatched, transport: stream.transport,
        ...(notDispatched ? { messages: prior?.messages ?? [], currentNodeId: prior?.currentNodeId ?? draft.parentMessageId } : {}) });
      restore(request); if (current(request) && !read().stopPending) flights.delete(clientId); return false;
    }
  };
  const stop = async (): Promise<boolean> => {
    syncScope(); const state = snapshot.conversation, request = state ? flights.get(state.clientId) : undefined;
    if (!request || !state?.pending || state.stopPending) return false;
    const read = () => records.get(request.clientId)!, update = (value: Partial<ChatgptTextConversation>) => patch(request.clientId, value);
    const serverId = state.serverId;
    if (!serverId) {
      update({ pending: false, deliveryUnknown: true, transport: 'aborted', error: '连接已取消；服务端停止尚未确认。' });
      restore(request); flights.delete(request.clientId); request.abort.abort(); return false;
    }
    update({ stopPending: true });
    try {
      await stopChatgptText({ ...getOptions().identity! }, serverId, request.stopAbort.signal);
      if (!current(request)) return false;
      update({ pending: false, stopPending: false, stopConfirmed: true, transport: 'aborted' });
      flights.delete(request.clientId); request.abort.abort(); return true;
    } catch (error) {
      if (!current(request)) return false;
      update({ stopPending: false, error: errorText(error) }); if (!read().pending) flights.delete(request.clientId); return false;
    }
  };
  const hydrate = (identity: ServiceIdentity, history: ChatgptConversationHistory,
    options: { serverId: string; selection: WorkModelSelection | null; temporary: boolean; select?: boolean }): string | null => {
    syncScope(); const principal = getOptions().identity;
    if (!principal || principal.accountId !== identity.accountId || principal.userId !== identity.userId || principal.generation !== identity.generation
      || !/^[A-Za-z0-9_-]+$/.test(options.serverId) || options.selection !== null && !options.selection.slug) return null;
    const existing = [...records.values()].find(record => record.serverId === options.serverId);
    if (existing) {
      if (options.select === true) { selectedId = existing.clientId; ++selectionRevision; refresh(); }
      return existing.clientId;
    }
    const messages: ChatgptConversationMessage[] = [];
    let malformedMessage = false;
    for (const message of history.messages) {
      if (message.id === null || message.raw === null || typeof message.raw !== 'object' || Array.isArray(message.raw)) { malformedMessage = true; continue; }
      if (!message.hidden) messages.push({ id: message.id, raw: message.raw as Record<string, unknown>, text: message.text, optimistic: false, unsupported: message.unsupported });
    }
    const clientId = options.serverId;
    if (options.select === true) { selectedId = clientId; ++selectionRevision; }
    put({ clientId, serverId: options.serverId, title: history.title, model: options.selection ? { ...options.selection } : null,
      currentNodeId: history.currentNode, readOnly: history.isReadOnly, history, projectId: history.projectId, isTemporaryChat: options.temporary,
      messages, pending: false, error: history.integrity !== 'complete' ? '历史消息图不完整，暂不能继续发送。'
        : malformedMessage ? '部分历史消息格式暂不支持，原始消息已保留。' : null,
      deliveryUnknown: false, stopPending: false, stopConfirmed: false, messageStreamComplete: false, transport: 'done', unsupportedEventTypes: [] });
    return clientId;
  };
  const getStateSnapshot = () => scope === scopeKey(getOptions()) ? snapshot : empty;
  const fillHistoryModel = (clientId: string, selection: WorkModelSelection,
    expected: { identity: ServiceIdentity; ownerKey: string }): boolean => {
    syncScope();
    if (scopeKey(expected) !== scopeKey(getOptions())) return false;
    const record = records.get(clientId);
    if (!record?.history || record.model !== null || record.pending || record.stopPending || !selection.slug) return false;
    patch(clientId, { model: { ...selection } }); return true;
  };
  return { getSnapshot: () => getStateSnapshot().conversation, getConversations: () => getStateSnapshot().conversations, getStateSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    syncScope, send, stop, reset, hydrate, fillHistoryModel,
    newConversation: () => { syncScope(); selectedId = null; ++selectionRevision; refresh(); },
    open: (clientId: string) => { syncScope(); if (!records.has(clientId)) return false; selectedId = clientId; ++selectionRevision; refresh(); return true; },
    selectModel: (selection: WorkModelSelection) => {
      syncScope(); const state = snapshot.conversation;
      if (!state || state.pending || state.stopPending || !selection.slug) return false;
      patch(state.clientId, { model: { ...selection } }); return true;
    },
  };
}

export function useChatgptTextConversation(options: ChatgptTextConversationOptions) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<ReturnType<typeof createChatgptTextConversationController> | null>(null);
  if (!controller.current) controller.current = createChatgptTextConversationController(() => latest.current);
  const owner = controller.current;
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getStateSnapshot, owner.getStateSnapshot);
  useLayoutEffect(() => { owner.syncScope(); }, [owner, options.ownerKey, options.identity?.accountId, options.identity?.userId, options.identity?.generation]);
  useLayoutEffect(() => () => owner.reset(), [owner]);
  return { ...snapshot, send: owner.send, stop: owner.stop, reset: owner.reset, hydrate: owner.hydrate, fillHistoryModel: owner.fillHistoryModel, newConversation: owner.newConversation, open: owner.open, selectModel: owner.selectModel };
}
