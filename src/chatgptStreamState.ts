/** Fixed 26.1111 plain-text SSE projection. No graph reconstruction, resume, tools or multimodal renderer. */
export interface ChatgptStreamFrame { event?: string; data: string; id?: string | null }
type ObjectValue = Record<string, unknown>;
export interface ChatgptStreamMessage { raw: ObjectValue; text: string | null }
export interface ChatgptStreamState {
  conversationId: string | null;
  messages: Record<string, ChatgptStreamMessage>;
  messageIds: string[];
  messageStreamComplete: boolean;
  mainStreamComplete: { conversationId: string; turnExchangeId: string; alternateResponseExpected?: boolean | null } | null;
  transport: 'open' | 'done' | 'aborted' | 'error';
  error: unknown;
  delta: { previous: ObjectValue; channels: Map<number, unknown> } | null;
}
export type ChatgptStreamOutcome = { kind: 'message'; id: string; isInput: boolean }
  | { kind: 'title'; conversationId: string; title: string }
  | { kind: 'message-complete' | 'main-complete' | 'done' | 'aborted' | 'ignored' }
  | { kind: 'unknown'; payload: unknown }
  | { kind: 'error'; source: 'server' | 'decode' | 'network'; error: unknown };
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
export function createChatgptStreamState(): ChatgptStreamState {
  return { conversationId: null, messages: Object.create(null) as Record<string, ChatgptStreamMessage>, messageIds: [], messageStreamComplete: false,
    mainStreamComplete: null, transport: 'open', error: null, delta: null };
}
function safe(key: string | number): void {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Unsafe delta path segment');
}
function copy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copy);
  if (!object(value)) return value;
  const result: ObjectValue = Object.create(null) as ObjectValue;
  for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: copy(item), writable: true, enumerable: true, configurable: true });
  return result;
}
function expand(raw: unknown): ObjectValue {
  if (!object(raw)) throw new Error('Unexpected delta non-object');
  const result = { ...raw };
  for (const [long, short] of [['channel', 'c'], ['path', 'p'], ['op', 'o'], ['value', 'v']]) {
    if (own(raw, short)) { result[long] = raw[short]; delete result[short]; }
  }
  if (result.op === 'patch') {
    if (!Array.isArray(result.value)) throw new Error('Unexpected delta patch value');
    result.value = result.value.map(expand);
  }
  return result;
}
function patch(holder: ObjectValue, delta: ObjectValue): void {
  const path = delta.path ?? '';
  if (typeof path !== 'string') throw new Error('Unexpected delta path');
  const keys: (string | number)[] = ['__root'];
  if (path !== '') for (const segment of (path.startsWith('/') ? path.slice(1) : path).split('/')) {
    const key = /^(?:0|[1-9]\d*)$/.test(segment) ? Number.parseInt(segment, 10) : segment.replace(/~1/g, '/').replace(/~0/g, '~');
    safe(key); keys.push(key);
  }
  const key = keys.pop()!;
  let target = holder;
  for (let i = 0; i < keys.length; ++i) {
    const part = keys[i];
    if (!own(target, part) || target[part] === undefined) target[part] = typeof (keys[i + 1] ?? key) === 'number' ? [] : {};
    const next = target[part];
    if (next === null || typeof next !== 'object') throw new Error('Unexpected delta intermediate value');
    target = next as ObjectValue;
  }
  const previous = own(target, key) ? target[key] : undefined, value = delta.value;
  switch (delta.op) {
    case 'patch': {
      const child = { __root: previous };
      for (const operation of delta.value as ObjectValue[]) patch(child, operation);
      target[key] = child.__root; break;
    }
    case 'add': if (Array.isArray(target)) target.splice(Number(key), 0, copy(value)); else target[key] = copy(value); break;
    case 'remove': if (Array.isArray(target)) target.splice(Number(key), 1); else delete target[key]; break;
    case 'replace': target[key] = copy(value); break;
    case 'append':
      if (typeof previous === 'string') target[key] = previous + value;
      else if (Array.isArray(previous)) previous.push(...(Array.isArray(value) ? value.map(copy) : [copy(value)]));
      else if (object(previous) && object(value)) for (const [name, item] of Object.entries(value)) { safe(name); previous[name] = copy(item); }
      else target[key] = copy(value);
      break;
    case 'truncate':
      if (previous && typeof previous === 'string') target[key] = previous.substring(0, value as number);
      else if (Array.isArray(previous)) previous.length = value as number;
      break;
    default: throw new Error('Unknown json delta operation');
  }
}
function decodeDelta(state: ChatgptStreamState, raw: unknown): unknown {
  if (!state.delta) throw new Error('Delta before delta_encoding');
  if (!object(raw)) throw new Error('Unexpected delta non-object');
  const inherited = { ...raw };
  for (const [long, short] of [['channel', 'c'], ['path', 'p'], ['op', 'o']]) if (!own(raw, short)) inherited[short] = state.delta.previous[long];
  const operation = expand(inherited), channel = operation.channel;
  if (typeof channel !== 'number' || !Number.isSafeInteger(channel) || channel < 0) throw new Error('Unexpected delta channel');
  const holder = { __root: copy(state.delta.channels.get(channel)) };
  patch(holder, operation);
  state.delta.channels.set(channel, holder.__root); state.delta.previous = operation;
  return holder.__root;
}
function text(message: ObjectValue): string | null {
  const content = message.content;
  if (!object(content) || content.content_type !== 'text') return null;
  if (typeof content.text === 'string') return content.text;
  return Array.isArray(content.parts) ? content.parts.map(part => typeof part === 'string' ? part : '').join('') : null;
}
function isMessage(value: unknown): value is ObjectValue & { id: string } {
  return object(value) && typeof value.id === 'string' && object(value.author) && typeof value.author.role === 'string' && own(value, 'content');
}
function failure(state: ChatgptStreamState, source: 'server' | 'decode' | 'network', error: unknown): ChatgptStreamOutcome {
  state.transport = 'error'; state.error = error; return { kind: 'error', source, error };
}
export function applyChatgptStreamFrame(state: ChatgptStreamState, frame: ChatgptStreamFrame): ChatgptStreamOutcome {
  if (state.transport !== 'open') return { kind: 'ignored' };
  const event = frame.event?.trim();
  if (event === 'heartbeat' || event === 'ping') return { kind: 'ignored' };
  if (frame.data.trim() === '[DONE]') { state.transport = 'done'; return { kind: 'done' }; }
  let payload: unknown;
  try { payload = JSON.parse(frame.data.split('\n').map(line => line.trim()).join('\n')); }
  catch { return { kind: 'unknown', payload: frame.data }; }
  if (object(payload) && payload.error) return failure(state, 'server', payload);
  const suppressDeltaError = event === 'delta' && state.delta !== null && state.messageStreamComplete;
  try {
    if (event === 'delta_encoding') {
      if (String(payload) !== 'v1') throw new Error('Unknown delta encoding');
      state.delta = { previous: { channel: 0, op: 'add', path: '', value: undefined }, channels: new Map() };
      return { kind: 'ignored' };
    }
    if (event === 'delta') payload = decodeDelta(state, payload);
  } catch (error) {
    return suppressDeltaError ? { kind: 'ignored' } : failure(state, 'decode', error);
  }
  if (!object(payload)) return { kind: 'unknown', payload };
  const typedPayload = typeof payload.type === 'string' && (payload.conversation_id === undefined || typeof payload.conversation_id === 'string')
    && (payload.title === undefined || typeof payload.title === 'string');
  if (typedPayload && payload.type === 'message_stream_complete') state.messageStreamComplete = true;
  const input = payload.type === 'input_message';
  const conversationId = payload.conversation_id;
  const fullMessage = isMessage(payload.message) && (conversationId == null || typeof conversationId === 'string');
  const message = fullMessage ? payload.message : input && typeof conversationId === 'string' ? payload.input_message : undefined;
  if (isMessage(message)) {
    if (typeof conversationId === 'string') state.conversationId = conversationId;
    if (!own(state.messages, message.id)) state.messageIds.push(message.id);
    state.messages[message.id] = { raw: copy(message) as ObjectValue, text: text(message) };
    return { kind: 'message', id: message.id, isInput: input };
  }
  if (typedPayload && typeof conversationId === 'string') {
    if (payload.type === 'message_stream_complete') { state.messageStreamComplete = true; return { kind: 'message-complete' }; }
    if (payload.type === 'main_stream_complete' && typeof payload.turn_exchange_id === 'string'
      && (payload.alternate_response_expected == null || typeof payload.alternate_response_expected === 'boolean')) {
      state.mainStreamComplete = { conversationId, turnExchangeId: payload.turn_exchange_id,
        ...(own(payload, 'alternate_response_expected') ? { alternateResponseExpected: payload.alternate_response_expected as boolean | null } : {}) };
      return { kind: 'main-complete' };
    }
    if (payload.type === 'title_generation' && typeof payload.title === 'string') return { kind: 'title', conversationId, title: payload.title };
  }
  return { kind: 'unknown', payload };
}
export function closeChatgptStream(state: ChatgptStreamState, reason: 'eof' | 'abort'): ChatgptStreamOutcome {
  if (state.transport !== 'open') return { kind: 'ignored' };
  if (reason === 'abort') { state.transport = 'aborted'; return { kind: 'aborted' }; }
  return failure(state, 'network', new Error('Stream ended before DONE'));
}
