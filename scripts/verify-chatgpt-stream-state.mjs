import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const file = 'src/chatgptStreamState.ts', api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: api }, { filename: file });
const s = api.createChatgptStreamState();
const message = { id: 'actual-1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['你', '好'] } };
assert.equal(api.applyChatgptStreamFrame(s, { data: JSON.stringify({ conversation_id: 'server', message }) }).kind, 'message');
assert.equal(s.messages['actual-1'].text, '你好');
console.log('PASS actual full message identity and parts');
let groups = 1;
function test(name, run) { run(); ++groups; console.log('PASS', name); }
const fresh = () => api.createChatgptStreamState();
const send = (state, payload, event) => api.applyChatgptStreamFrame(state, { event, data: JSON.stringify(payload), id: 'transport-id' });
const full = (id, parts, extra = {}) => ({ conversation_id: 'conversation', message: { id, author: { role: 'assistant' }, content: { content_type: 'text', parts }, ...extra } });
const delta = (state, value) => send(state, value, 'delta');
function encoded() { const state = fresh(); send(state, 'v1', 'delta_encoding'); return state; }
test('same actual id replaces full snapshot while new ids create rows', () => {
  const state = fresh(); send(state, full('a', ['one'], { status: 'old' })); send(state, full('a', ['two'])); send(state, full('b', ['three']));
  assert.deepEqual([...state.messageIds], ['a', 'b']); assert.equal(state.messages.a.text, 'two'); assert.equal(state.messages.a.raw.status, undefined);
  assert.equal(state.conversationId, 'conversation'); assert.equal(state.messages['transport-id'], undefined);
});
test('text field priority, no separator parts, unsupported media stays explicit', () => {
  const state = fresh(); const f = full('a', ['a', { image: 'x' }, 'b']); send(state, f); assert.equal(state.messages.a.text, 'ab');
  f.message.content.text = ''; send(state, f); assert.equal(state.messages.a.text, '');
  f.message.content = { content_type: 'image', parts: [] }; send(state, f); assert.equal(state.messages.a.text, null);
});
test('v1 root snapshot and inherited string append retain immutable old messages', () => {
  const state = encoded(); delta(state, { v: full('a', ['你']) }); const old = state.messages.a;
  delta(state, { p: '/message/content/parts/0', o: 'append', v: '好' });
  delta(state, { v: '！' }); assert.equal(state.messages.a.text, '你好！'); assert.equal(old.text, '你'); assert.equal(old.raw.content.parts[0], '你');
});
test('channels isolate snapshots and metadata inheritance is global, full events do not seed channels', () => {
  const state = encoded(); delta(state, { c: 0, v: full('a', ['A']) }); delta(state, { c: 1, p: '', o: 'add', v: full('b', ['B']) });
  delta(state, { c: 0, p: '/message/content/parts/0', o: 'append', v: 'x' });
  delta(state, { c: 1, v: 'y' }); assert.equal(state.messages.a.text, 'Ax'); assert.equal(state.messages.b.text, 'By');
  const noSeed = encoded(); send(noSeed, full('a', ['A'])); delta(noSeed, { p: '/message/content/parts/0', o: 'append', v: 'x' }); assert.equal(noSeed.messages.a.text, 'A');
});
test('short keys override inherited long names and value never inherits', () => {
  const state = encoded(); delta(state, { v: full('a', ['A']) });
  delta(state, { channel: 2, path: '/message/content/parts/0', op: 'append', v: full('b', ['B']) });
  assert.equal(state.delta.channels.has(2), false); assert.equal(state.messages.b.text, 'B');
  delta(state, {}); assert.equal(state.delta.channels.get(0), undefined);
});
test('nested patch add remove replace append truncate and JSON pointer escaping', () => {
  const state = encoded(); delta(state, { v: full('a', ['A', 'B']) });
  delta(state, { o: 'patch', v: [ { p: '/message/content/parts/1', o: 'add', v: 'X' }, { p: '/message/content/parts/2', o: 'remove' },
    { p: '/message/content/parts/0', o: 'replace', v: 'Hello' }, { p: '/message/content/parts/0', o: 'truncate', v: 2 },
    { p: '/message/content/parts', o: 'append', v: ['!'] }, { p: '/message/metadata', o: 'append', v: { note: true } },
    { p: '/message/metadata/a~1b~0c', o: 'add', v: 3 } ] });
  assert.equal(state.messages.a.text, 'HeX!'); assert.equal(state.messages.a.raw.metadata['a/b~c'], 3);
});
test('invalid channel unsafe path and delta-before-encoding fail without losing partial text', () => {
  for (const operation of [{ c: -1, v: {} }, { c: 0.5, v: {} }, { p: '/message/__proto__/x', v: 1 }, { p: '/constructor/x', v: 1 }, { o: 'bogus' }]) {
    const state = encoded(); delta(state, { v: full('a', ['partial']) }); assert.equal(delta(state, operation).kind, 'error'); assert.equal(state.messages.a.text, 'partial');
  }
  assert.equal(delta(fresh(), { v: {} }).kind, 'error'); assert.equal({}.x, undefined);
});
test('unknown and malformed payloads do not manufacture empty messages', () => {
  const state = fresh(); for (const value of [null, 'plain string', {}, { type: 'unknown' }, { message: { id: 'a', content: {} } }]) assert.equal(send(state, value).kind, 'unknown');
  assert.equal(api.applyChatgptStreamFrame(state, { data: 'bad json' }).kind, 'unknown'); assert.equal(state.messageIds.length, 0); assert.equal(state.transport, 'open');
  assert.equal(send(state, { error: null }).kind, 'unknown');
});
test('server errors retain raw error and partial data, not generic empty text', () => {
  const state = fresh(); send(state, full('a', ['partial'])); const result = send(state, { error: { detail: 'failure' }, can_retry: false });
  assert.equal(result.kind, 'error'); assert.equal(result.source, 'server'); assert.equal(result.error.error.detail, 'failure'); assert.equal(state.messages.a.text, 'partial');
});
test('business complete and raw DONE are independent and terminal cannot reverse on abort', () => {
  const state = fresh(); send(state, { type: 'message_stream_complete', conversation_id: 'c' });
  assert.equal(state.messageStreamComplete, true); assert.equal(state.transport, 'open'); assert.equal(state.mainStreamComplete, null);
  send(state, { type: 'main_stream_complete', conversation_id: 'c', turn_exchange_id: 'turn', alternate_response_expected: null });
  assert.equal(state.mainStreamComplete.turnExchangeId, 'turn'); assert.equal(state.transport, 'open');
  assert.equal(api.applyChatgptStreamFrame(state, { data: '  [DONE]  ' }).kind, 'done'); assert.equal(api.closeChatgptStream(state, 'abort').kind, 'ignored'); assert.equal(state.transport, 'done');
});
test('EOF without sentinel is network error even after message complete; abort keeps partial', () => {
  const state = fresh(); send(state, full('a', ['partial'])); send(state, { type: 'message_stream_complete', conversation_id: 'c' });
  assert.equal(api.closeChatgptStream(state, 'eof').source, 'network'); assert.equal(state.messages.a.text, 'partial');
  const aborted = fresh(); send(aborted, full('a', ['partial'])); assert.equal(api.closeChatgptStream(aborted, 'abort').kind, 'aborted'); assert.equal(aborted.messages.a.text, 'partial');
});
test('post-completion delta decode errors ignored, encoding resets, event whitespace and input ids', () => {
  const state = encoded(); delta(state, { v: full('a', ['A']) }); send(state, { type: 'message_stream_complete', conversation_id: 'c' });
  assert.equal(delta(state, { o: 'bogus' }).kind, 'ignored'); assert.equal(state.transport, 'open');
  send(state, 'v1', '  delta_encoding  '); assert.equal(state.delta.channels.size, 0);
  const input = send(state, { type: 'input_message', conversation_id: 'actual-c', input_message: { id: 'user-1', author: { role: 'user' }, content: { content_type: 'text', text: 'user' } } });
  assert.equal(input.isInput, true); assert.equal(state.conversationId, 'actual-c');
  assert.equal(send(state, {}, '  heartbeat  ').kind, 'ignored');
});
test('decoder completion flag uses loose source schema independently of visible complete update', () => {
  const state = encoded(); assert.equal(send(state, { type: 'message_stream_complete' }).kind, 'unknown'); assert.equal(state.messageStreamComplete, true);
  assert.equal(delta(state, { o: 'bad' }).kind, 'ignored');
  const invalid = encoded(); send(invalid, { type: 'message_stream_complete', title: 4 }); assert.equal(invalid.messageStreamComplete, false);
  const fullWins = full('primary', ['full']); fullWins.type = 'input_message'; fullWins.input_message = { id: 'secondary', author: { role: 'user' }, content: {} };
  assert.equal(send(fresh(), fullWins).id, 'primary');
});
test('unknown encoding and missing decoder are fatal even after message completion', () => {
  const state = fresh(); send(state, { type: 'message_stream_complete' }); assert.equal(send(state, 'v2', 'delta_encoding').kind, 'error');
  const missing = fresh(); send(missing, { type: 'message_stream_complete' }); assert.equal(delta(missing, {}).kind, 'error');
});
console.log(`PASS ${groups} groups; no live service, resume, graph, tools or multimodal execution`);
