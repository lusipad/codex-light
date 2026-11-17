import type { WorkThinkingEffort } from "./workModelCatalog";
type JsonRecord = Record<string, unknown>;
export interface ChatgptHistoryMessage {
  nodeId: string;
  id: string | null;
  raw: unknown;
  text: string | null;
  hidden: boolean;
  unsupported: boolean;
}
export interface ChatgptConversationHistory {
  raw: JsonRecord;
  mapping: JsonRecord;
  currentNode: string | null;
  activeNodeIds: string[];
  messages: ChatgptHistoryMessage[];
  /** Integrity of the selected ancestry only; unrelated branches remain raw. */
  integrity: 'complete' | 'missing-node' | 'cycle' | 'invalid';
  issues: string[];
  title: string | null;
  projectId: string | null;
  defaultModelSlug: string | null;
  thinkingEffort: WorkThinkingEffort | null;
  conversationOrigin: string | null;
  ownerUserId: string | null;
  isDoNotRemember: boolean | null;
  isReadOnly: boolean | null;
  asyncStatus: unknown;
}
const record = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
/** Wc42.g checks trimmed nonemptiness but returns the original string. */
const nonempty = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;
function text(raw: JsonRecord): string | null {
  const content = raw.content;
  if (!record(content) || content.content_type !== 'text') return null;
  return typeof content.text === 'string' ? content.text : Array.isArray(content.parts)
    ? content.parts.map(part => typeof part === 'string' ? part : '').join('') : null;
}
function skip(value: string, allowWrapped = false): { type: 'skip_completion' | 'skip_notification'; reason?: string } | null {
  let candidate = value.trim();
  if (/^::\s*SKIP_COMPLETION\s*::$/.test(candidate)) return { type: 'skip_completion' };
  if (allowWrapped) for (let i = 0; i < 4; ++i) {
    const body = /^(?<fence>`{3,}|~{3,})[ \t]*(?:json[ \t]*)?\r?\n(?<body>[\s\S]*?)\r?\n[ \t]*\k<fence>$/i.exec(candidate)?.groups?.body
      ?? /^<escape>([\s\S]*)<\/escape>$/.exec(candidate)?.[1]
      ?? /^(`{1,2})([^`](?:[\s\S]*[^`])?)\1$/.exec(candidate)?.[2];
    if (body != null) candidate = body.trim();
    else if (candidate.startsWith('"')) {
      try { const parsed: unknown = JSON.parse(candidate); if (typeof parsed !== 'string') return null; candidate = parsed.trim(); }
      catch { return null; }
    } else break;
  }
  if (candidate === 'skip_notification') return { type: 'skip_notification' };
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!record(parsed) || parsed.type !== 'skip_notification' || Object.keys(parsed).some(key => key !== 'type' && key !== 'reason')
      || own(parsed, 'reason') && (typeof parsed.reason !== 'string' || !/\S/.test(parsed.reason))) return null;
    return { type: 'skip_notification', ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}) };
  } catch { return null; }
}
export function isChatgptHistoryMessageHidden(value: unknown): boolean {
  if (!record(value) || !record(value.author)) return false;
  const assistant = value.author.role === 'assistant', metadata = record(value.metadata) ? value.metadata : null;
  if (assistant && metadata && own(metadata, 'post_response_feedback') || metadata?.is_visually_hidden_from_conversation === true) return true;
  const content = record(value.content) ? value.content : null, body = text(value) ?? '';
  if (assistant && content?.content_type === 'text' && skip(body)?.type === 'skip_completion') return true;
  const recipient = nonempty(value.recipient);
  if (!assistant || value.channel != null && value.channel !== 'final' || recipient !== null && recipient !== 'all' || content?.content_type !== 'text') return false;
  const enabled = metadata?.automation_backing_run_conditional_updates_enabled;
  const notification = skip(body, enabled === true || enabled == null && nonempty(metadata?.automation_id) !== null);
  return notification !== null && notification.reason == null;
}
function projectMessage(nodeId: string, raw: unknown): ChatgptHistoryMessage {
  const valid = record(raw) && typeof raw.id === 'string' && record(raw.author) && typeof raw.author.role === 'string' && own(raw, 'content');
  const body = valid ? text(raw) : null, role = valid ? (raw.author as JsonRecord).role : null;
  const recipient = valid ? nonempty(raw.recipient) : null;
  return { nodeId, id: valid ? raw.id as string : null, raw, text: body, hidden: isChatgptHistoryMessageHidden(raw),
    unsupported: !valid || body === null || role !== 'user' && role !== 'assistant'
      || role === 'assistant' && (recipient !== null && recipient !== 'all' || raw.channel != null && raw.channel !== 'final') };
}
/** lEsF.L: selected ancestry, including hidden messages; no catalog fallback here. */
export function projectChatgptHistoryThinkingEffort(messages: readonly ChatgptHistoryMessage[]): WorkThinkingEffort | null {
  const allowed: readonly string[] = ['standard', 'extended', 'min', 'max', 'ultra', 'xhigh', 'zero'];
  for (let index = messages.length - 1; index >= 0; --index) {
    const raw = messages[index].raw;
    if (!record(raw) || !record(raw.author)) continue;
    const metadata = record(raw.metadata) ? raw.metadata : null, value = metadata?.thinking_effort;
    const effort = typeof value === 'string' && allowed.includes(value) ? value as WorkThinkingEffort : null;
    if (raw.author.role === 'assistant' && effort !== null) return effort;
    if (raw.author.role !== 'tool') continue;
    if (raw.author.name === 'thinking_effort.request_change' && record(raw.content) && raw.content.content_type === 'text') {
      try { const parsed: unknown = JSON.parse(text(raw) ?? ''); if (record(parsed) && parsed.status === 'accepted') return effort; }
      catch { /* A non-JSON tool result does not acknowledge an effort change. */ }
    }
    if (effort === null || metadata?.codex_mcp_elicitation_response != null) continue;
    const data = record(metadata?.jit_plugin_data) ? metadata.jit_plugin_data.from_server : null;
    const fromServer = record(data) ? data : null;
    const fallback = fromServer && typeof fromServer.type === 'string' && ['confirm_action', 'oauth_required', 'plugin_suggestions'].includes(fromServer.type)
      && record(fromServer.body) ? fromServer.body.codex_mcp_elicitation : null;
    const elicitation = metadata?.codex_mcp_elicitation ?? fallback;
    if (record(elicitation) && (elicitation.status == null || elicitation.status === 'pending')) return effort;
  }
  return null;
}
/** AuIy.UI ancestry, not a flattened or time-sorted conversation mapping. */
export function decodeChatgptConversationHistory(value: unknown): ChatgptConversationHistory {
  if (!record(value) || !record(value.mapping)) throw new Error('ChatGPT 历史消息图无效。');
  const issues: string[] = [], activeNodeIds: string[] = [], messages: ChatgptHistoryMessage[] = [], visited = new Set<string>();
  let integrity: ChatgptConversationHistory['integrity'] = 'complete';
  const currentNode = value.current_node == null ? null : string(value.current_node);
  if (value.current_node != null && currentNode === null) { integrity = 'invalid'; issues.push('invalid-current-node'); }
  let id = currentNode;
  while (id !== null) {
    if (visited.has(id)) { integrity = 'cycle'; issues.push(`cycle:${id}`); break; }
    if (!own(value.mapping, id) || value.mapping[id] == null) { integrity = 'missing-node'; issues.push(`missing-node:${id}`); break; }
    const node = value.mapping[id];
    if (!record(node)) { integrity = 'invalid'; issues.push(`invalid-node:${id}`); break; }
    visited.add(id); activeNodeIds.push(id);
    if (node.message != null) messages.push(projectMessage(id, node.message));
    if (node.parent != null && typeof node.parent !== 'string') { integrity = 'invalid'; issues.push(`invalid-parent:${id}`); break; }
    id = node.parent as string | null | undefined ?? null;
  }
  messages.reverse();
  return { raw: value, mapping: value.mapping, currentNode, activeNodeIds: activeNodeIds.reverse(), messages, integrity, issues,
    title: string(value.title), projectId: string(value.gizmo_id), defaultModelSlug: string(value.default_model_slug),
    thinkingEffort: projectChatgptHistoryThinkingEffort(messages),
    conversationOrigin: string(value.conversation_origin), ownerUserId: record(value.owner) ? string(value.owner.user_id) : null,
    isDoNotRemember: typeof value.is_do_not_remember === 'boolean' ? value.is_do_not_remember : null,
    isReadOnly: typeof value.is_read_only === 'boolean' ? value.is_read_only : null, asyncStatus: value.async_status };
}

/** Cold ordinary history starts idle; this does not claim a local SSE is pending. */
export function getChatgptHistoryActivity(history: ChatgptConversationHistory): 'active' | 'background' | 'idle' | 'unknown' {
  if (history.conversationOrigin === 'tpp' || history.conversationOrigin === 'flora') return 'unknown';
  if (history.asyncStatus === 5 || history.asyncStatus === 6) return 'active';
  if (history.asyncStatus === 7) return 'background';
  if (history.asyncStatus === 3 && history.currentNode !== null && own(history.mapping, history.currentNode)) {
    const node = history.mapping[history.currentNode], raw = record(node) ? node.message : null;
    if (record(raw) && record(raw.metadata) && typeof raw.metadata.async_source === 'string'
      && !(raw.channel === 'final' && raw.status !== 'in_progress')) return 'active';
  }
  return 'idle';
}
