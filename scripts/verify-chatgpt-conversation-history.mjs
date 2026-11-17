import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const file = 'src/chatgptConversationHistory.ts', api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: api }, { filename: file });
const message = (id, text, extra = {}) => ({ id, author: { role: 'assistant' }, content: { content_type: 'text', parts: [text] }, ...extra });
const node = (parent, raw = null) => ({ parent, children: [], message: raw });
const graph = { title: 'History', current_node: 'main', mapping: { side: node('root', message('side-message', 'excluded')), main: node('null-hop', message('actual-main', 'main')), root: node(null, message('actual-root', 'root')), 'null-hop': node('root') }, gizmo_id: 'g-p-project', default_model_slug: 'real-model' };
const decoded = api.decodeChatgptConversationHistory(graph);
assert.deepEqual(Array.from(decoded.activeNodeIds), ['root', 'null-hop', 'main']);
assert.deepEqual(Array.from(decoded.messages, row => row.id), ['actual-root', 'actual-main']);
assert.equal(decoded.currentNode, 'main'); assert.equal(decoded.integrity, 'complete');
console.log('PASS source parent chain excludes off-branch and retains null-message nodes');
let groups = 1;
function test(name, run) { run(); ++groups; console.log('PASS', name); }
const decodeOne = raw => api.decodeChatgptConversationHistory({ current_node: 'node', mapping: { node: node(null, raw) } }).messages[0];
test('actual node identity remains distinct from message identity and hidden current node is retained', () => {
  const value = { current_node: 'hidden-node', mapping: { root: node(null, message('message-root', 'visible')), 'hidden-node': node('root', message('message-hidden', 'hidden', { metadata: { is_visually_hidden_from_conversation: true } })) } };
  const result = api.decodeChatgptConversationHistory(value); assert.equal(result.currentNode, 'hidden-node'); assert.equal(result.messages.at(-1).id, 'message-hidden'); assert.equal(result.messages.at(-1).nodeId, 'hidden-node'); assert.equal(result.messages.at(-1).hidden, true);
});
test('null current node is a real empty active path, not last object or newest timestamp', () => {
  for (const current_node of [null, undefined]) {
    const result = api.decodeChatgptConversationHistory({ current_node, mapping: { latest: node(null, message('latest', 'not active', { create_time: 99999 })) } });
    assert.equal(result.integrity, 'complete'); assert.equal(result.messages.length, 0); assert.equal(result.currentNode, null);
  }
});
test('missing current or ancestor reports partial selected path without inventing root', () => {
  const missing = api.decodeChatgptConversationHistory({ current_node: 'absent', mapping: {} }); assert.equal(missing.integrity, 'missing-node'); assert.equal(missing.messages.length, 0);
  const partial = api.decodeChatgptConversationHistory({ current_node: 'child', mapping: { child: node('absent', message('actual', 'partial')) } });
  assert.equal(partial.integrity, 'missing-node'); assert.deepEqual(Array.from(partial.activeNodeIds), ['child']); assert.equal(partial.messages[0].id, 'actual'); assert.equal(partial.currentNode, 'child');
});
test('cycles stop once and never claim complete while off-branch corruption stays outside selected path', () => {
  const cycle = api.decodeChatgptConversationHistory({ current_node: 'a', mapping: { a: node('b', message('a-message', 'A')), b: node('a', message('b-message', 'B')) } });
  assert.equal(cycle.integrity, 'cycle'); assert.equal(cycle.messages.length, 2);
  const result = api.decodeChatgptConversationHistory({ current_node: 'a', mapping: { a: node(null, message('a-message', 'A')), broken: 17 } }); assert.equal(result.integrity, 'complete'); assert.equal(result.mapping.broken, 17);
});
test('malformed graph containers throw and malformed selected node or parent is not complete', () => {
  for (const value of [null, [], {}, { mapping: null }, { mapping: [] }]) assert.throws(() => api.decodeChatgptConversationHistory(value));
  for (const value of [{ current_node: 9, mapping: {} }, { current_node: 'a', mapping: { a: 4 } }, { current_node: 'a', mapping: { a: node(42, message('a', 'A')) } }]) assert.equal(api.decodeChatgptConversationHistory(value).integrity, 'invalid');
});
test('unknown and nontext message data is retained explicitly unsupported instead of empty text', () => {
  for (const raw of [{ id: 'tool', author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool text'] } },
    message('image', '', { content: { content_type: 'multimodal_text', parts: [{ image: 'raw pointer' }] } }),
    message('analysis', 'thinking', { channel: 'analysis' }), message('recipient', 'call', { recipient: 'python' }), { unknown: 1 }, 'invalid-message']) {
    const result = decodeOne(raw); assert.equal(result.unsupported, true); assert.equal(result.raw, raw);
  }
  assert.equal(decodeOne({ unknown: 1 }).id, null); assert.equal(decodeOne({ unknown: 1 }).text, null);
});
test('source text field wins even empty and parts concatenate without separators', () => {
  assert.equal(decodeOne(message('a', '', { content: { content_type: 'text', text: '', parts: ['ignored'] } })).text, '');
  assert.equal(decodeOne(message('a', '', { content: { content_type: 'text', parts: ['你', { notText: true }, '好'] } })).text, '你好');
});
test('source visual flag and post-feedback membership apply with exact role and boolean rules', () => {
  assert.equal(decodeOne(message('a', 'text', { metadata: { post_response_feedback: null } })).hidden, true);
  assert.equal(decodeOne(message('a', 'text', { author: { role: 'user' }, metadata: { post_response_feedback: true } })).hidden, false);
  assert.equal(decodeOne(message('a', 'text', { author: { role: 'user' }, metadata: { is_visually_hidden_from_conversation: true } })).hidden, true);
  assert.equal(decodeOne(message('a', 'text', { metadata: { is_visually_hidden_from_conversation: 'true' } })).hidden, false);
});
test('skip completion literal hides assistant independently of channel but never wrapped or user content', () => {
  for (const value of ['::SKIP_COMPLETION::', ' :: SKIP_COMPLETION :: ']) assert.equal(decodeOne(message('a', value, { channel: 'analysis' })).hidden, true);
  assert.equal(decodeOne(message('a', '`::SKIP_COMPLETION::`', { metadata: { automation_backing_run_conditional_updates_enabled: true } })).hidden, false);
  assert.equal(decodeOne(message('a', '::SKIP_COMPLETION::', { author: { role: 'user' } })).hidden, false);
});
test('notification hiding requires final/plain assistant and strict no-reason payload', () => {
  for (const value of ['skip_notification', '{"type":"skip_notification"}']) assert.equal(decodeOne(message('a', value, { channel: 'final' })).hidden, true);
  for (const value of ['{"type":"skip_notification","reason":"why"}', '{"type":"skip_notification","reason":" "}', '{"type":"skip_notification","extra":1}']) assert.equal(decodeOne(message('a', value)).hidden, false);
  for (const extra of [{ channel: 'analysis' }, { recipient: 'python' }, { recipient: ' all ' }, { author: { role: 'user' } }]) assert.equal(decodeOne(message('a', 'skip_notification', extra)).hidden, false);
  assert.equal(decodeOne(message('a', 'skip_notification', { recipient: ' ' })).hidden, true);
});
test('wrapped notifications use actual automation opt-in and source nonempty strings preserve whitespace', () => {
  const wrapped = '```json\n{"type":"skip_notification"}\n```';
  assert.equal(decodeOne(message('a', wrapped)).hidden, false);
  for (const metadata of [{ automation_backing_run_conditional_updates_enabled: true }, { automation_id: ' actual-id ' }]) assert.equal(decodeOne(message('a', wrapped, { metadata })).hidden, true);
  for (const metadata of [{ automation_backing_run_conditional_updates_enabled: false, automation_id: 'id' }, { automation_id: ' ' }, { automation_backing_run_conditional_updates_enabled: 'true' }]) assert.equal(decodeOne(message('a', wrapped, { metadata })).hidden, false);
});
test('real metadata and all raw branches are preserved without synthesizing server id or default effort', () => {
  const raw = { ...graph, conversation_origin: 'source-origin', is_do_not_remember: false, owner: { user_id: 'real-owner' }, async_status: { raw: 'state' }, custom_metadata: { retain: true } };
  const result = api.decodeChatgptConversationHistory(raw); assert.equal(result.raw, raw); assert.equal(result.mapping, raw.mapping);
  assert.equal(result.title, 'History'); assert.equal(result.projectId, 'g-p-project'); assert.equal(result.defaultModelSlug, 'real-model'); assert.equal(result.ownerUserId, 'real-owner');
  assert.equal(result.isDoNotRemember, false); assert.equal(result.conversationOrigin, 'source-origin'); assert.equal(result.asyncStatus, raw.async_status);
  assert.equal(result.serverId, undefined); assert.equal(result.thinkingEffort, null); assert.equal(raw.mapping.side.message.content.parts[0], 'excluded');
});
test('node and message string identities are preserved without trim or prototype inheritance', () => {
  const result = api.decodeChatgptConversationHistory({ current_node: '', mapping: { '': node(null, message('', 'actual empty strings')) } });
  assert.equal(result.currentNode, ''); assert.equal(result.messages[0].id, ''); assert.equal(result.messages[0].nodeId, '');
  const inherited = api.decodeChatgptConversationHistory({ current_node: 'toString', mapping: {} }); assert.equal(inherited.integrity, 'missing-node');
  const raw = JSON.parse('{"current_node":"__proto__","mapping":{"__proto__":{"parent":null,"message":{"id":"real","author":{"role":"user"},"content":{"content_type":"text","parts":["safe"]}}}}}');
  assert.equal(api.decodeChatgptConversationHistory(raw).messages[0].id, 'real'); assert.equal({}.message, undefined);
});
test('read-only is explicit source metadata and never inferred from owner identity', () => {
  for (const [raw, expected] of [[true, true], [false, false], [undefined, null], [null, null], ['true', null]]) assert.equal(api.decodeChatgptConversationHistory({ mapping: {}, current_node: null, owner: { user_id: 'other' }, is_read_only: raw }).isReadOnly, expected);
});
test('thinking effort uses reverse active chain including hidden assistants and exact enum', () => {
  const result = api.decodeChatgptConversationHistory({ current_node: 'hidden', mapping: {
    older: node(null, message('older', 'old', { metadata: { thinking_effort: 'extended' } })),
    hidden: node('older', message('hidden', 'hidden', { metadata: { thinking_effort: 'max', is_visually_hidden_from_conversation: true } })),
    other: node(null, message('other', 'off branch', { metadata: { thinking_effort: 'ultra' } }))
  } }); assert.equal(result.thinkingEffort, 'max');
  assert.equal(decodeOne(message('invalid', '', { metadata: { thinking_effort: 'MEDIUM' } })).text, '');
});
const effortFrom = (...raws) => api.projectChatgptHistoryThinkingEffort(raws.map((raw, index) => ({ nodeId: String(index), id: raw.id, raw, text: null, hidden: false, unsupported: false })));
const priorEffort = () => message('prior', '', { metadata: { thinking_effort: 'extended' } });
const tool = (name, value, metadata = {}, content = '{"status":"accepted"}') => message('tool', content, { author: { role: 'tool', name }, metadata: { thinking_effort: value, ...metadata } });
test('chain effort accepts all seven exact enums and skips invalid assistant values toward older evidence', () => {
  for (const effort of ['standard', 'extended', 'min', 'max', 'ultra', 'xhigh', 'zero']) assert.equal(effortFrom(message('a', '', { metadata: { thinking_effort: effort } })), effort);
  for (const effort of ['medium', ' Extended ', null, false, [], {}]) assert.equal(effortFrom(priorEffort(), message('a', '', { metadata: { thinking_effort: effort } })), 'extended');
  assert.equal(effortFrom(message('none', '')), null);
});
test('accepted effort-change tool is authoritative even with null effort and rejected result keeps older evidence', () => {
  assert.equal(effortFrom(priorEffort(), tool('thinking_effort.request_change', 'max')), 'max');
  assert.equal(effortFrom(priorEffort(), tool('thinking_effort.request_change', 'invalid')), null);
  for (const result of ['{"status":"rejected"}', 'not-json', '[{"status":"accepted"}]']) assert.equal(effortFrom(priorEffort(), tool('thinking_effort.request_change', 'max', {}, result)), 'extended');
});
test('pending elicitation effort handles direct metadata real fallback types and response-presence boundary', () => {
  assert.equal(effortFrom(priorEffort(), tool('other', 'max', { codex_mcp_elicitation: { status: 'pending' } })), 'max');
  assert.equal(effortFrom(priorEffort(), tool('other', 'max', { codex_mcp_elicitation: {} })), 'max');
  for (const type of ['confirm_action', 'oauth_required', 'plugin_suggestions']) assert.equal(effortFrom(priorEffort(), tool('other', 'ultra', { jit_plugin_data: { from_server: { type, body: { codex_mcp_elicitation: { status: 'pending' } } } } })), 'ultra');
  for (const metadata of [{ codex_mcp_elicitation: { status: 'accepted' } }, { codex_mcp_elicitation: { status: 'pending' }, codex_mcp_elicitation_response: false },
    { jit_plugin_data: { from_server: { type: ['confirm_action'], body: { codex_mcp_elicitation: {} } } } }]) assert.equal(effortFrom(priorEffort(), tool('other', 'max', metadata)), 'extended');
});
test('cold activity respects source realtime and background states independently of message text', () => {
  for (const [async_status, expected] of [[5, 'active'], [6, 'active'], [7, 'background'], [4, 'idle'], [1, 'idle'], [2, 'idle'], [null, 'idle'], ['5', 'idle'], [99, 'idle']]) {
    assert.equal(api.getChatgptHistoryActivity(api.decodeChatgptConversationHistory({ current_node: null, mapping: {}, async_status })), expected);
  }
});
test('streaming history activity reads actual current-node async source and exact final status condition', () => {
  const activity = (raw, extra = {}) => api.getChatgptHistoryActivity(api.decodeChatgptConversationHistory({ current_node: 'current', mapping: {
    visible: node(null, message('visible', 'visible', { metadata: { async_source: 'visible-but-not-current' } })), current: node('visible', raw)
  }, async_status: 3, ...extra }));
  assert.equal(activity(message('current', 'text', { metadata: { async_source: '' } })), 'active');
  assert.equal(activity(message('current', 'text', { channel: 'final', status: 'in_progress', metadata: { async_source: 'real' } })), 'active');
  for (const raw of [message('current', 'text'), message('current', 'text', { metadata: { async_source: true } }),
    message('current', 'text', { channel: 'final', status: 'finished_successfully', metadata: { async_source: 'real' } }),
    message('current', 'text', { channel: 'final', metadata: { async_source: 'real' } }), null]) assert.equal(activity(raw), 'idle');
  assert.equal(activity(message('current', 'text', { metadata: { async_source: 'real', is_visually_hidden_from_conversation: true } })), 'active');
  assert.equal(activity(null, { current_node: 'missing' }), 'idle');
});
test('special origins stay unknown without claiming unavailable ordinary cold history is gated', () => {
  for (const conversation_origin of ['tpp', 'flora']) for (const async_status of [null, 3, 5, 7]) assert.equal(api.getChatgptHistoryActivity(api.decodeChatgptConversationHistory({ mapping: {}, current_node: null, conversation_origin, async_status })), 'unknown');
  assert.equal(api.getChatgptHistoryActivity(api.decodeChatgptConversationHistory({ mapping: {}, current_node: null, conversation_origin: 'ordinary-source', async_status: 5 })), 'active');
});
console.log(`PASS ${groups} groups; source-shaped history graph only, no service or persistence`);
