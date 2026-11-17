import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const principal = { accountId: 'account', userId: 'user', generation: 1 };
const selection = { slug: 'actual-model', thinkingEffort: 'extended' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const requests = [], stops = [], events = [], modules = new Map(); let serial = 0;
  const options = { identity: { ...principal }, ownerKey: 'draft-a', onOptimisticStart: id => { events.push(['optimistic', id]); return true; },
    onAccepted: prompt => events.push(['accepted', prompt]), onRestore: prompt => events.push(['restore', prompt]) };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, require: key => {
        if (key === 'react') return {};
        if (key === './chatgptTextClient') return { submitChatgptText(input) { const d = deferred(); requests.push({ input, ...d }); return d.promise; }, stopChatgptText(...args) { const d = deferred(); stops.push({ args, ...d }); return d.promise; } };
        return load(key.slice(2));
      }, AbortController, Date, Intl, Map, Set, crypto: { randomUUID: () => `uuid-${++serial}` } }, { filename: name });
    return exports;
  }
  const api = load('useChatgptTextConversation');
  const decodeHistory = load('chatgptConversationHistory').decodeChatgptConversationHistory;
  const controller = api.createChatgptTextConversationController(() => options);
  return { controller, options, requests, stops, events, decodeHistory };
}
const f = fixture(); const sending = f.controller.send({ prompt: 'hello', selection });
assert.equal(f.requests.length, 1); assert.equal(f.requests[0].input.body.parent_message_id, 'client-created-root');
assert.equal(f.controller.getSnapshot().pending, true);
f.requests[0].input.onResponseAccepted(); f.requests[0].input.onFrame({ data: '[DONE]' }); f.requests[0].resolve({ status: 'transport-complete' });
assert.equal(await sending, true);
console.log('PASS optimistic root and response acceptance');
let groups = 1;
async function test(name, run) { await run(); ++groups; console.log('PASS', name); }
const frame = (request, payload) => request.input.onFrame({ event: '', data: JSON.stringify(payload), id: 'transport-only' });
const message = (id, text, role = 'assistant', extra = {}) => ({ conversation_id: 'server-real', message: { id, author: { role }, content: { content_type: 'text', parts: [text] }, ...extra } });
const done = request => { request.input.onFrame({ data: '[DONE]' }); request.resolve({ status: 'transport-complete' }); };
await test('response acceptance is once and optimistic routing false does not cancel dispatch', async () => {
  const f = fixture(); f.options.onOptimisticStart = () => false;
  const pending = f.controller.send({ prompt: 'original', selection }); assert.equal(f.requests.length, 1);
  assert.equal(f.events.length, 0); f.requests[0].input.onResponseAccepted(200); f.requests[0].input.onResponseAccepted(200);
  assert.deepEqual(f.events, [['accepted', 'original']]); done(f.requests[0]); assert.equal(await pending, true);
});
await test('followup parent is actual current message id and existing server/project are reused', async () => {
  const f = fixture(); const p = f.controller.send({ prompt: 'first', selection, projectId: 'project', systemHints: ['hint'], timezone: 'Asia/Shanghai', timezoneOffsetMinutes: -480 });
  const request = f.requests[0]; assert.equal(request.input.body.gizmo_id, 'project'); assert.equal(request.input.body.timezone_offset_min, -480);
  frame(request, message('assistant-actual', 'answer')); done(request); assert.equal(await p, true);
  const next = f.controller.send({ prompt: 'second', selection: { ...selection, slug: 'model-two' } });
  assert.equal(f.requests[1].input.body.parent_message_id, 'assistant-actual'); assert.equal(f.requests[1].input.body.conversation_id, 'server-real');
  assert.equal(f.requests[1].input.body.gizmo_id, 'project'); done(f.requests[1]); assert.equal(await next, true);
});
await test('same-id snapshots replace, actual user echo retires only matching optimistic id', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }), request = f.requests[0];
  const localUser = request.input.body.messages[0].id;
  frame(request, message('other-user', 'other', 'user')); assert.equal(f.controller.getSnapshot().messages[0].optimistic, true);
  frame(request, message(localUser, 'echo', 'user')); assert.equal(f.controller.getSnapshot().messages[0].optimistic, false);
  frame(request, message('a', 'one', 'assistant', { status: 'old' })); frame(request, message('a', 'two'));
  const rows = f.controller.getSnapshot().messages; assert.equal(rows.filter(row => row.id === 'a').length, 1); assert.equal(rows.at(-1).text, 'two'); assert.equal(rows.at(-1).raw.status, undefined);
  done(request); await pending;
});
await test('duplicate sends and missing identity are rejected before second dispatch', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection });
  assert.equal(await f.controller.send({ prompt: 'second', selection }), false); assert.equal(f.requests.length, 1);
  f.controller.reset(); f.requests[0].reject(Error('cancelled')); await pending;
  f.options.identity = null; assert.equal(await f.controller.send({ prompt: 'third', selection }), false);
});
await test('pre-response failure does not restore uncleared input, accepted failure requests scoped restore', async () => {
  for (const accepted of [false, true]) {
    const f = fixture(), pending = f.controller.send({ prompt: 'draft', selection }); const request = f.requests[0];
    if (accepted) request.input.onResponseAccepted(200); frame(request, message('a', 'partial')); request.reject(Error('network dropped'));
    assert.equal(await pending, false); const state = f.controller.getSnapshot(); assert.equal(state.pending, false); assert.equal(state.deliveryUnknown, true); assert.equal(state.messages.at(-1).text, 'partial');
    assert.equal(f.events.filter(event => event[0] === 'restore').length, accepted ? 1 : 0);
    assert.equal(await f.controller.send({ prompt: 'retry', selection }), false); assert.equal(f.requests.length, 1);
  }
});
await test('restore callback compares editor itself and preserves a new user draft', async () => {
  const f = fixture(); let editor = 'first';
  f.options.onAccepted = original => { if (editor === original) editor = ''; };
  f.options.onRestore = original => { if (editor === '') editor = original; };
  const pending = f.controller.send({ prompt: 'first', selection }); f.requests[0].input.onResponseAccepted(200); assert.equal(editor, '');
  editor = 'new user input'; f.requests[0].reject(Error('failure')); await pending; assert.equal(editor, 'new user input');
});
await test('account user generation and owner changes reject all late frames and acceptance', async () => {
  for (const change of [options => { options.identity = { ...principal, accountId: 'other' }; }, options => { options.identity = { ...principal, userId: 'other' }; },
    options => { options.identity = { ...principal, generation: 2 }; }, options => { options.ownerKey = 'new-draft'; }]) {
    const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); const request = f.requests[0];
    change(f.options); assert.equal(f.controller.getSnapshot(), null); request.input.onResponseAccepted(200); frame(request, message('late', 'late')); f.controller.syncScope();
    assert.equal(request.input.signal.aborted, true); request.reject(Error('old failure')); await pending;
    assert.equal(f.controller.getSnapshot(), null); assert.equal(f.events.some(event => ['accepted', 'restore'].includes(event[0])), false);
  }
});
await test('reset retires old request and late completion cannot overwrite a newer chat', async () => {
  const f = fixture(), old = f.controller.send({ prompt: 'old', selection }); const first = f.requests[0]; f.controller.reset();
  const next = f.controller.send({ prompt: 'new', selection }); const second = f.requests[1]; frame(second, message('new-id', 'new'));
  first.input.onResponseAccepted(200); frame(first, message('old-id', 'old')); done(first); assert.equal(await old, false);
  assert.equal(f.controller.getSnapshot().messages.at(-1).id, 'new-id'); done(second); assert.equal(await next, true);
});
await test('same owner callback/view change keeps already accepted conversation active', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); f.requests[0].input.onResponseAccepted(200);
  f.options.onOptimisticStart = () => false; f.controller.syncScope(); assert.equal(f.requests[0].input.signal.aborted, false);
  frame(f.requests[0], message('a', 'background')); done(f.requests[0]); assert.equal(await pending, true); assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'background');
});
await test('logical complete without raw DONE is unknown delivery and partial is retained', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); const request = f.requests[0];
  frame(request, message('a', 'partial')); frame(request, { type: 'message_stream_complete', conversation_id: 'server-real' });
  assert.equal(f.controller.getSnapshot().pending, true); assert.equal(f.controller.getSnapshot().messageStreamComplete, true);
  request.resolve({ status: 'transport-complete' }); assert.equal(await pending, false); assert.equal(f.controller.getSnapshot().deliveryUnknown, true); assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'partial');
});
await test('unknown payload and nontext/tool messages stay explicit with raw source retained', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); const request = f.requests[0];
  frame(request, { type: 'unsupported-event', value: 1 }); frame(request, { conversation_id: 'server-real', message: { id: 'image', author: { role: 'assistant' }, content: { content_type: 'image', parts: [] } } });
  assert.equal(f.controller.getSnapshot().messages.at(-1).unsupported, true); assert.equal(f.controller.getSnapshot().messages.at(-1).text, null);
  frame(request, message('tool', 'call', 'assistant', { recipient: 'python' })); assert.equal(f.controller.getSnapshot().messages.at(-1).unsupported, true);
  assert.equal(f.controller.getSnapshot().messages.at(-1).raw.recipient, 'python'); assert.equal(f.controller.getSnapshot().unsupportedEventTypes[0], 'unsupported-event'); done(request); await pending;
});
await test('stop without server id only aborts local connection and cannot claim remote stop', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); const request = f.requests[0]; request.input.onResponseAccepted(200);
  assert.equal(await f.controller.stop(), false); assert.equal(f.stops.length, 0); assert.equal(request.input.signal.aborted, true);
  assert.equal(f.controller.getSnapshot().stopConfirmed, false); assert.equal(f.controller.getSnapshot().deliveryUnknown, true); request.reject(Error('abort')); await pending;
});
await test('remote stop waits for real ACK, keeps partial and never starts a replacement request', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); const request = f.requests[0]; frame(request, message('a', 'partial'));
  const stopping = f.controller.stop(); assert.equal(f.controller.getSnapshot().stopPending, true); assert.equal(request.input.signal.aborted, false);
  assert.equal(f.stops[0].args[1], 'server-real'); f.stops[0].resolve(); assert.equal(await stopping, true); assert.equal(request.input.signal.aborted, true);
  assert.equal(f.controller.getSnapshot().stopConfirmed, true); assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'partial'); request.reject(Error('abort')); await pending;
});
await test('stop failure preserves active request and full completion racing ACK cannot leave stop pending', async () => {
  for (const stopSucceeds of [false, true]) {
    const f = fixture(), pending = f.controller.send({ prompt: 'first', selection }); const request = f.requests[0]; frame(request, message('a', 'answer'));
    const stopping = f.controller.stop(); done(request); assert.equal(await pending, true);
    if (stopSucceeds) f.stops[0].resolve(); else f.stops[0].reject(Error('stop failed'));
    assert.equal(await stopping, stopSucceeds); assert.equal(f.controller.getSnapshot().stopPending, false);
    assert.equal(f.controller.getSnapshot().stopConfirmed, stopSucceeds); assert.equal(f.requests.length, 1);
  }
});
await test('model selection is local and project mismatch cannot silently move an existing chat', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'first', selection, projectId: 'original' }); const request = f.requests[0];
  assert.equal(f.controller.selectModel({ ...selection, slug: 'next' }), false); frame(request, message('a', 'answer')); done(request); await pending;
  assert.equal(f.controller.selectModel({ ...selection, slug: 'next' }), true); assert.equal(f.controller.getSnapshot().model.slug, 'next');
  assert.equal(await f.controller.send({ prompt: 'next', selection, projectId: 'foreign' }), false); assert.equal(f.requests.length, 1);
});
await test('explicit reset during optimistic callback prevents dispatch without restoring a new draft', async () => {
  const f = fixture(); f.options.onOptimisticStart = () => { f.controller.reset(); return true; };
  assert.equal(await f.controller.send({ prompt: 'first', selection }), false); assert.equal(f.requests.length, 0); assert.equal(f.controller.getSnapshot(), null); assert.equal(f.events.length, 0);
});
await test('retired stop ACK and failure cannot alter the next owner or restore its draft', async () => {
  for (const accept of [false, true]) {
    const f = fixture(), old = f.controller.send({ prompt: 'old', selection }); const oldRequest = f.requests[0]; oldRequest.input.onResponseAccepted(200); frame(oldRequest, message('a', 'old'));
    const stop = f.controller.stop(); f.options.ownerKey = 'new'; f.controller.syncScope();
    assert.equal(f.stops[0].args[2].aborted, true); const next = f.controller.send({ prompt: 'new', selection }); const newRequest = f.requests[1];
    if (accept) f.stops[0].resolve(); else f.stops[0].reject(Error('late stop error'));
    assert.equal(await stop, false); oldRequest.reject(Error('old aborted')); await old;
    assert.equal(f.controller.getSnapshot().messages[0].text, 'new'); assert.equal(f.controller.getSnapshot().error, null); assert.equal(f.events.some(event => event[0] === 'restore'), false);
    done(newRequest); await next;
  }
});
await test('confirmed not-dispatched failure rolls back optimistic ancestry and allows explicit retry', async () => {
  const f = fixture(), first = f.controller.send({ prompt: 'first', selection });
  f.requests[0].reject({ message: 'requirements unavailable', completionDispatched: false }); assert.equal(await first, false);
  assert.equal(f.controller.getSnapshot().deliveryUnknown, false); assert.equal(f.controller.getSnapshot().messages.length, 0);
  const retry = f.controller.send({ prompt: 'first', selection }); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].input.body.parent_message_id, 'client-created-root'); done(f.requests[1]); assert.equal(await retry, true);
});
await test('dispatched and unconfirmed IPC failures retain unknown delivery and cannot retry', async () => {
  for (const evidence of [true, undefined, null, 'false']) {
    const f = fixture(), first = f.controller.send({ prompt: 'first', selection });
    f.requests[0].reject({ message: 'connection unavailable', ...(evidence === undefined ? {} : { completionDispatched: evidence }) }); await first;
    assert.equal(f.controller.getSnapshot().deliveryUnknown, true); assert.equal(await f.controller.send({ prompt: 'retry', selection }), false); assert.equal(f.requests.length, 1);
  }
});
await test('not-dispatched followup preserves previous actual parent for explicit retry', async () => {
  const f = fixture(), first = f.controller.send({ prompt: 'first', selection }); frame(f.requests[0], message('actual-parent', 'answer')); done(f.requests[0]); await first;
  const second = f.controller.send({ prompt: 'second', selection }); f.requests[1].reject({ message: 'local preflight rejected', completionDispatched: false }); await second;
  assert.equal(f.controller.getSnapshot().messages.at(-1).id, 'actual-parent'); assert.equal(f.controller.getSnapshot().deliveryUnknown, false);
  const retry = f.controller.send({ prompt: 'second', selection }); assert.equal(f.requests[2].input.body.parent_message_id, 'actual-parent'); assert.equal(f.requests[2].input.body.conversation_id, 'server-real'); done(f.requests[2]); await retry;
});
await test('two completed chats remain selectable with independent real server ancestry', async () => {
  const f = fixture(), a = f.controller.send({ prompt: 'A', selection }); const first = f.requests[0]; frame(first, message('a-parent', 'answer A')); done(first); await a;
  const aId = f.controller.getSnapshot().clientId; f.controller.newConversation(); assert.equal(f.controller.getSnapshot(), null);
  const b = f.controller.send({ prompt: 'B', selection: { ...selection, slug: 'model-b' } }); const second = f.requests[1];
  frame(second, { ...message('b-parent', 'answer B'), conversation_id: 'server-b' }); done(second); await b;
  const bId = f.controller.getSnapshot().clientId; assert.notEqual(aId, bId); assert.equal(f.controller.getConversations().length, 2);
  assert.equal(f.controller.open(aId), true); assert.equal(f.controller.getSnapshot().model.slug, selection.slug);
  const followup = f.controller.send({ prompt: 'A next', selection }); assert.equal(f.requests[2].input.body.parent_message_id, 'a-parent'); assert.equal(f.requests[2].input.body.conversation_id, 'server-real');
  done(f.requests[2]); await followup; f.controller.open(bId); assert.equal(f.controller.getSnapshot().messages.at(-1).id, 'b-parent'); assert.equal(f.controller.open('nonexistent'), false);
});
await test('background A frames cannot overwrite selected B and owner reset clears every record and flight', async () => {
  const f = fixture(), a = f.controller.send({ prompt: 'A', selection }); const first = f.requests[0]; first.input.onResponseAccepted(200); frame(first, message('a-parent', 'A partial'));
  const aId = f.controller.getSnapshot().clientId; f.controller.newConversation();
  const b = f.controller.send({ prompt: 'B', selection }); const second = f.requests[1]; frame(second, { ...message('b-parent', 'B partial'), conversation_id: 'server-b' });
  const bId = f.controller.getSnapshot().clientId; frame(first, message('a-parent', 'A updated')); assert.equal(f.controller.getSnapshot().clientId, bId); assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'B partial');
  assert.equal(first.input.signal.aborted, false); f.controller.open(aId); assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'A updated');
  f.options.identity = { ...principal, generation: 2 }; f.controller.syncScope(); assert.equal(f.controller.getConversations().length, 0); assert.equal(f.controller.getSnapshot(), null);
  assert.equal(first.input.signal.aborted, true); assert.equal(second.input.signal.aborted, true); first.reject(Error('old')); second.reject(Error('old')); await a; await b;
});
await test('background response acceptance and restore address the original draft even with identical prompts', async () => {
  const f = fixture(), drafts = new Map();
  f.options.onOptimisticStart = id => { drafts.set(id, 'same prompt'); return true; };
  f.options.onAccepted = (prompt, id) => { if (drafts.get(id) === prompt) drafts.set(id, ''); };
  f.options.onRestore = (prompt, id) => { if (drafts.get(id) === '') drafts.set(id, prompt); };
  const a = f.controller.send({ prompt: 'same prompt', selection }); const first = f.requests[0], aId = f.controller.getSnapshot().clientId;
  f.controller.newConversation(); const b = f.controller.send({ prompt: 'same prompt', selection }); const second = f.requests[1], bId = f.controller.getSnapshot().clientId;
  first.input.onResponseAccepted(200); assert.equal(drafts.get(aId), ''); assert.equal(drafts.get(bId), 'same prompt');
  drafts.set(bId, 'new B input'); first.reject(Error('A interrupted')); await a;
  assert.equal(drafts.get(aId), 'same prompt'); assert.equal(drafts.get(bId), 'new B input'); assert.equal(f.controller.getSnapshot().clientId, bId);
  assert.equal(f.controller.getConversations().find(item => item.clientId === aId).deliveryUnknown, true); done(second); await b;
});
await test('pending requests and duplicate guards belong to each conversation', async () => {
  const f = fixture(), a = f.controller.send({ prompt: 'A', selection }); const first = f.requests[0], aId = f.controller.getSnapshot().clientId;
  f.controller.newConversation(); const b = f.controller.send({ prompt: 'B', selection: { ...selection, slug: 'B-model' } }); const second = f.requests[1], bId = f.controller.getSnapshot().clientId;
  f.controller.open(aId); assert.equal(await f.controller.send({ prompt: 'duplicate A', selection }), false); assert.equal(f.requests.length, 2);
  done(second); await b; assert.equal(f.controller.getSnapshot().clientId, aId); assert.equal(f.controller.getSnapshot().pending, true);
  assert.equal(f.controller.getConversations().find(item => item.clientId === bId).pending, false); done(first); await a;
});
await test('late stop ACK modifies only original conversation while another one is selected', async () => {
  const f = fixture(), a = f.controller.send({ prompt: 'A', selection }); const first = f.requests[0]; frame(first, message('A-parent', 'partial A')); const aId = f.controller.getSnapshot().clientId;
  const stopping = f.controller.stop(); f.controller.newConversation(); const b = f.controller.send({ prompt: 'B', selection }); const second = f.requests[1], bId = f.controller.getSnapshot().clientId;
  f.stops[0].resolve(); assert.equal(await stopping, true); assert.equal(f.controller.getSnapshot().clientId, bId); assert.equal(f.controller.getSnapshot().pending, true);
  assert.equal(f.controller.getSnapshot().stopConfirmed, false); assert.equal(f.controller.getConversations().find(item => item.clientId === aId).stopConfirmed, true);
  assert.equal(second.input.signal.aborted, false); first.reject(Error('A stopped')); await a; done(second); await b;
});
await test('late home new-chat with navigation declined keeps selected B and independent root ancestry', async () => {
  const f = fixture(), b = f.controller.send({ prompt: 'B', selection }); const bRequest = f.requests[0]; frame(bRequest, message('B-real', 'B partial'));
  const bId = f.controller.getSnapshot().clientId; f.options.onOptimisticStart = () => false;
  const a = f.controller.send({ prompt: 'late Home A', selection, clientId: null });
  assert.equal(f.requests.length, 2); assert.equal(f.controller.getSnapshot().clientId, bId); assert.equal(f.requests[1].input.body.parent_message_id, 'client-created-root');
  assert.equal(f.requests[1].input.body.conversation_id, undefined); const aRecord = f.controller.getConversations().find(item => item.clientId !== bId);
  assert.ok(aRecord); frame(f.requests[1], message('A-real', 'A background')); assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'B partial');
  done(f.requests[1]); await a; assert.equal(f.controller.getSnapshot().clientId, bId); done(bRequest); await b;
});
await test('explicit existing target uses its ancestry without changing selected conversation when navigation declined', async () => {
  const f = fixture(), a = f.controller.send({ prompt: 'A', selection }); frame(f.requests[0], message('A-parent', 'A')); done(f.requests[0]); await a;
  const aId = f.controller.getSnapshot().clientId; f.controller.newConversation(); const b = f.controller.send({ prompt: 'B', selection }); frame(f.requests[1], { ...message('B-parent', 'B'), conversation_id: 'B-server' }); done(f.requests[1]); await b;
  const bId = f.controller.getSnapshot().clientId; f.options.onOptimisticStart = () => false;
  const follow = f.controller.send({ prompt: 'A next', selection, clientId: aId });
  assert.equal(f.requests[2].input.body.parent_message_id, 'A-parent'); assert.equal(f.requests[2].input.body.conversation_id, 'server-real'); assert.equal(f.controller.getSnapshot().clientId, bId);
  done(f.requests[2]); await follow;
});
await test('unknown explicit client target cannot turn into a new chat or append current chat', async () => {
  const f = fixture(); assert.equal(await f.controller.send({ prompt: 'retired target', selection, clientId: 'retired-id' }), false);
  assert.equal(f.requests.length, 0); assert.equal(f.controller.getConversations().length, 0);
});
await test('optimistic callback cannot override a newer selection made inside navigation handling', async () => {
  const f = fixture(), a = f.controller.send({ prompt: 'A', selection }); frame(f.requests[0], message('A-parent', 'A')); done(f.requests[0]); await a;
  const aId = f.controller.getSnapshot().clientId;
  f.options.onOptimisticStart = () => { f.controller.open(aId); return true; };
  const b = f.controller.send({ prompt: 'B', selection, clientId: null }); assert.equal(f.controller.getSnapshot().clientId, aId);
  assert.equal(f.requests[1].input.body.parent_message_id, 'client-created-root'); done(f.requests[1]); await b; assert.equal(f.controller.getSnapshot().clientId, aId);
});
await test('hydrate uses real current node as next parent even if hidden and unlike last visible message', async () => {
  const f = fixture(); const history = f.decodeHistory({ current_node: 'hidden-node', default_model_slug: 'actual-model', mapping: {
    root: { parent: null, message: { id: 'visible-message', author: { role: 'user' }, content: { content_type: 'text', parts: ['visible'] } } },
    'hidden-node': { parent: 'root', message: { id: 'hidden-message', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hidden'] }, metadata: { is_visually_hidden_from_conversation: true } } }
  } });
  const id = f.controller.hydrate(principal, history, { serverId: 'server-history', selection, temporary: false, select: true }); assert.ok(id);
  assert.equal(f.controller.getSnapshot().messages.length, 1); assert.equal(f.controller.getSnapshot().currentNodeId, 'hidden-node'); assert.equal(f.controller.getSnapshot().history, history);
  const send = f.controller.send({ prompt: 'next', selection }); assert.equal(f.requests[0].input.body.parent_message_id, 'hidden-node'); assert.equal(f.requests[0].input.body.conversation_id, 'server-history'); done(f.requests[0]); await send;
});
const historyFixture = (f, extra = {}) => f.decodeHistory({ current_node: 'real-node', mapping: { 'real-node': { parent: null, message: { id: 'actual-message', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['history'] } } } }, ...extra });
await test('hydrate checks current account user generation and source server identity without changing another chat', async () => {
  const f = fixture(), history = historyFixture(f);
  for (const identity of [{ ...principal, accountId: 'other' }, { ...principal, userId: 'other' }, { ...principal, generation: 2 }]) assert.equal(f.controller.hydrate(identity, history, { serverId: 'server', selection, temporary: false, select: true }), null);
  assert.equal(f.controller.hydrate(principal, history, { serverId: 'local-chatgpt:draft', selection, temporary: false }), null); assert.equal(f.controller.getConversations().length, 0);
  f.options.identity = null; assert.equal(f.controller.hydrate(principal, history, { serverId: 'server', selection, temporary: false }), null);
});
await test('hydrate defaults to background installation and preserves selected record unless explicitly admitted', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'active', selection }); const activeId = f.controller.getSnapshot().clientId;
  const history = historyFixture(f, { title: 'cold title', gizmo_id: 'g-p-real' }); const coldId = f.controller.hydrate(principal, history, { serverId: 'cold-server', selection: null, temporary: true });
  assert.ok(coldId); assert.equal(f.controller.getSnapshot().clientId, activeId); assert.equal(f.controller.getConversations().length, 2);
  f.controller.open(coldId); assert.equal(f.controller.getSnapshot().model, null); assert.equal(f.controller.getSnapshot().projectId, 'g-p-real'); assert.equal(f.controller.getSnapshot().isTemporaryChat, true);
  assert.equal(f.controller.selectModel(selection), true); assert.equal(f.controller.getSnapshot().model.slug, selection.slug); done(f.requests[0]); await pending;
});
await test('hydrate never overwrites pending or newer same-server messages and returns original client identity', async () => {
  const f = fixture(), pending = f.controller.send({ prompt: 'active', selection }); frame(f.requests[0], message('live-parent', 'live partial')); const liveId = f.controller.getSnapshot().clientId;
  const stale = historyFixture(f); assert.equal(f.controller.hydrate(principal, stale, { serverId: 'server-real', selection: null, temporary: false, select: true }), liveId);
  assert.equal(f.controller.getSnapshot().messages.at(-1).text, 'live partial'); assert.equal(f.controller.getSnapshot().pending, true);
  done(f.requests[0]); await pending; assert.equal(f.controller.hydrate(principal, stale, { serverId: 'server-real', selection: null, temporary: false }), liveId);
  assert.equal(f.controller.getSnapshot().currentNodeId, 'live-parent'); assert.equal(f.controller.getSnapshot().model.slug, selection.slug); assert.equal(f.controller.getConversations().length, 1);
});
await test('only explicit read-only blocks source followup, owner mismatch is not invented permission denial', async () => {
  for (const readOnly of [true, false, undefined]) {
    const f = fixture(), history = historyFixture(f, { is_read_only: readOnly, owner: { user_id: 'other-owner' } });
    f.controller.hydrate(principal, history, { serverId: 'history-server', selection, temporary: false, select: true });
    const pending = f.controller.send({ prompt: 'next', selection });
    if (readOnly === true) { assert.equal(await pending, false); assert.equal(f.requests.length, 0); assert.match(f.controller.getSnapshot().error, /只读/); }
    else { assert.equal(f.requests.length, 1); done(f.requests[0]); await pending; }
  }
});
await test('empty missing and cyclic graph can display partial data but never substitute a fabricated root', async () => {
  for (const raw of [{ current_node: null, mapping: {} }, { current_node: 'missing', mapping: {} },
    { current_node: 'node', mapping: { node: { parent: 'node', message: { id: 'actual', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['partial'] } } } } }]) {
    const f = fixture(), history = f.decodeHistory(raw); f.controller.hydrate(principal, history, { serverId: 'graph-server', selection, temporary: false, select: true });
    assert.equal(f.controller.getSnapshot().history, history); assert.equal(await f.controller.send({ prompt: 'next', selection }), false); assert.equal(f.requests.length, 0); assert.match(f.controller.getSnapshot().error, /当前节点/);
  }
});
await test('cold parent rolls back on confirmed preflight failure and unsupported raw history is retained', async () => {
  const f = fixture(), history = historyFixture(f, { mapping: { 'real-node': { parent: 'unsupported', message: { id: 'real-id', author: { role: 'assistant' }, content: { content_type: 'image', parts: [{ raw: true }] } } }, unsupported: { parent: null, message: 'raw-invalid' } } });
  f.controller.hydrate(principal, history, { serverId: 'cold-server', selection, temporary: false, select: true }); assert.equal(f.controller.getSnapshot().messages[0].unsupported, true);
  assert.equal(f.controller.getSnapshot().history.messages[0].raw, 'raw-invalid'); assert.match(f.controller.getSnapshot().error, /格式/);
  const pending = f.controller.send({ prompt: 'next', selection }); f.requests[0].reject({ message: 'preflight', completionDispatched: false }); await pending;
  assert.equal(f.controller.getSnapshot().currentNodeId, 'real-node'); const retry = f.controller.send({ prompt: 'next', selection }); assert.equal(f.requests[1].input.body.parent_message_id, 'real-node'); done(f.requests[1]); await retry;
});
await test('fillHistoryModel targets only captured empty history model without changing selection', async () => {
  const f = fixture(), history = historyFixture(f); const id = f.controller.hydrate(principal, history, { serverId: 'cold-model', selection: null, temporary: false });
  assert.equal(f.controller.getSnapshot(), null); assert.equal(f.controller.fillHistoryModel(id, selection, { identity: principal, ownerKey: 'draft-a' }), true);
  assert.equal(f.controller.getSnapshot(), null); assert.equal(f.controller.getConversations()[0].model.slug, selection.slug);
});
await test('late fill from old scope cannot populate same server id newly hydrated in another scope', async () => {
  for (const change of [options => { options.ownerKey = 'new-owner'; }, options => { options.identity = { ...principal, accountId: 'new-account' }; },
    options => { options.identity = { ...principal, userId: 'new-user' }; }, options => { options.identity = { ...principal, generation: 2 }; }]) {
    const f = fixture(), expected = { identity: { ...principal }, ownerKey: f.options.ownerKey }, history = historyFixture(f);
    f.controller.hydrate(principal, history, { serverId: 'same-server', selection: null, temporary: false }); change(f.options); f.controller.syncScope();
    f.controller.hydrate(f.options.identity, history, { serverId: 'same-server', selection: null, temporary: false, select: true });
    assert.equal(f.controller.fillHistoryModel('same-server', selection, expected), false); assert.equal(f.controller.getSnapshot().model, null);
    assert.equal(f.controller.fillHistoryModel('same-server', selection, { identity: f.options.identity, ownerKey: f.options.ownerKey }), true);
  }
});
await test('late model fill cannot override a user selection pending send or another conversation', async () => {
  const f = fixture(), history = historyFixture(f), expected = { identity: principal, ownerKey: 'draft-a' };
  const aId = f.controller.hydrate(principal, history, { serverId: 'history-a', selection: null, temporary: false, select: true });
  f.controller.selectModel({ ...selection, slug: 'user-selected' }); assert.equal(f.controller.fillHistoryModel(aId, selection, expected), false); assert.equal(f.controller.getSnapshot().model.slug, 'user-selected');
  const bId = f.controller.hydrate(principal, history, { serverId: 'history-b', selection: null, temporary: false, select: true });
  const pending = f.controller.send({ prompt: 'B next', selection: { ...selection, slug: 'pending-model' } });
  assert.equal(f.controller.fillHistoryModel(bId, selection, expected), false); assert.equal(f.controller.getSnapshot().model.slug, 'pending-model');
  assert.equal(f.controller.fillHistoryModel('missing', selection, expected), false); assert.equal(f.controller.getConversations().find(item => item.clientId === aId).model.slug, 'user-selected');
  done(f.requests[0]); await pending;
});
console.log(`PASS ${groups} groups; offline production controller and source request/stream modules`);
