import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(read = async () => { throw Error('unconfigured fixture'); }) {
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/chatgptConversationList.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: api, require: name => name === 'react' ? {} : name === './chatgptTextClient' ? { readChatgptConversations: read } : {}, AbortController, Date, Map, Set }, { filename: 'chatgptConversationList.ts' });
  return api;
}
const api = load();
const page = api.decodeChatgptConversationPage({ offset: 0, limit: 20, total: 41, items: [{ id: 'a', title: ' Title ', update_time: '2026-11-18T00:00:00Z', gizmo_id: 'g-p-real', snippet: ' preview ' }, { notId: true }] });
assert.equal(page.items.length, 1); assert.equal(page.items[0].title, 'Title'); assert.equal(page.items[0].preview, 'preview');
assert.equal(api.getNextChatgptConversationOffset([page]), 20);
console.log('PASS actual page metadata and source item filtering');
let groups = 1;
function test(name, run) { run(); ++groups; console.log('PASS', name); }
const decode = extra => api.decodeChatgptConversationPage({ offset: 0, limit: 20, total: 0, items: [], ...extra });
test('metadata dictates next offset even when every item is filtered out', () => {
  const first = decode({ total: 61, items: [{ id: 1 }, null, { noId: true }] }); assert.equal(first.items.length, 0); assert.equal(api.getNextChatgptConversationOffset([first]), 20);
  const second = decode({ offset: 20, limit: 20, total: 61, items: [] }); assert.equal(api.getNextChatgptConversationOffset([first, second]), 40);
  assert.equal(api.getNextChatgptConversationOffset([decode({ offset: 40, limit: 5, total: 45 })]), null);
  assert.equal(api.getNextChatgptConversationOffset([decode({ offset: 40, limit: 5, total: 46 })]), 20);
});
test('missing or invalid paging metadata never becomes an empty successful page', () => {
  for (const value of [null, [], {}, { offset: 0, limit: 20 }, { offset: '0', limit: 20, total: 0 }, { offset: 0, limit: NaN, total: 0 }, { offset: 0, limit: 20, total: -1 }]) assert.throws(() => api.decodeChatgptConversationPage(value));
  for (const items of [{}, 'bad', true, 1]) assert.throws(() => decode({ items }));
  for (const items of [null, undefined]) assert.equal(decode({ items }).items.length, 0);
});
test('title and snippet preserve exact source trim fallback without fake names', () => {
  const result = decode({ items: [{ id: 'actual-id', title: '  ', snippet: ' ' }, { id: '', title: null }, { id: 'title', title: ' Real Title ', snippet: ' Real Preview ' }] });
  assert.equal(result.items[0].title, 'actual-id'); assert.equal(result.items[0].preview, null); assert.equal(result.items[1].title, ''); assert.equal(result.items[2].title, 'Real Title');
  for (const malformed of [{ id: 'bad', title: 1 }, { id: 'bad', snippet: false }]) assert.throws(() => decode({ items: [malformed] }));
});
test('real Date.parse seconds or null and raw gizmo metadata survive without guessing project membership', () => {
  const raw = { id: 'id', update_time: '2026-11-18T00:00:00+08:00', gizmo_id: 'g-custom', conversation_origin: 'unknown-origin', owner: { user_id: 'source-owner' } };
  const item = decode({ items: [raw] }).items[0]; assert.equal(item.updatedAt, Date.parse(raw.update_time) / 1000); assert.equal(item.raw, raw); assert.equal(item.gizmoId, 'g-custom'); assert.equal(item.projectId, undefined);
  for (const update_time of [null, undefined, 'not-a-date']) assert.equal(decode({ items: [{ id: 'x', update_time }] }).items[0].updatedAt, null);
});
console.log(`PASS ${groups} pure decoder groups`);
const principal = { accountId: 'account', userId: 'user', generation: 1 };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const calls = [];
  const library = load((identity, offset, includeProjectConversations, signal) => { const d = deferred(); calls.push({ identity, offset, includeProjectConversations, signal, ...d }); return d.promise; });
  const options = { identity: { ...principal }, ownerKey: 'account-host-a', includeProjectConversations: false };
  const controller = library.createChatgptConversationListController(() => options);
  return { calls, options, controller };
}
const f = fixture(), initial = f.controller.loadInitial();
assert.equal(f.calls.length, 1); assert.equal(f.calls[0].offset, 0);
f.calls[0].resolve({ offset: 0, limit: 20, total: 21, items: [{ id: 'first' }] }); assert.equal(await initial, true);
assert.equal(f.controller.getSnapshot().nextOffset, 20);
console.log('PASS controller initial actual read');
let controllerGroups = 1;
async function check(name, run) { await run(); ++controllerGroups; console.log('PASS', name); }
const response = (offset, total, items = [{ id: `id-${offset}` }]) => ({ offset, limit: 20, total, items });
await check('load more deduplicates concurrent requests and follows metadata after filtered empty pages', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 41, [{ id: 4 }])); await initial;
  const more = f.controller.loadMore(), repeated = f.controller.loadMore(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].offset, 20);
  f.calls[1].resolve(response(20, 41, [])); assert.equal(await more, true); assert.equal(await repeated, true); assert.equal(f.controller.getSnapshot().nextOffset, 40);
  const last = f.controller.loadMore(); f.calls[2].resolve(response(40, 41)); await last;
  assert.equal(f.controller.getSnapshot().nextOffset, null); assert.equal(await f.controller.loadMore(), false); assert.equal(f.calls.length, 3);
});
await check('failed more page retains every earlier page and explicit retry uses same actual offset', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 40)); await initial; const prior = f.controller.getSnapshot().pages;
  const more = f.controller.loadMore(); f.calls[1].reject(Error('network failed')); assert.equal(await more, false); assert.equal(f.controller.getSnapshot().pages, prior); assert.equal(f.controller.getSnapshot().failedAction, 'more');
  const retry = f.controller.retry(); assert.equal(f.calls[2].offset, 20); f.calls[2].resolve(response(20, 40)); await retry; assert.equal(f.controller.getSnapshot().pages.length, 2);
});
await check('bad initial metadata is error instead of loaded empty and supports explicit retry', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve({ items: [] }); assert.equal(await initial, false);
  assert.equal(f.controller.getSnapshot().loaded, false); assert.equal(f.controller.getSnapshot().failedAction, 'initial'); assert.notEqual(f.controller.getSnapshot().error, null);
  const retry = f.controller.retry(); assert.equal(f.calls[1].offset, 0); f.calls[1].resolve(response(0, 0, null)); assert.equal(await retry, true); assert.equal(f.controller.getSnapshot().loaded, true);
});
await check('scope changes cancel old account user generation host and include-project requests', async () => {
  for (const change of [options => { options.identity = { ...principal, accountId: 'other' }; }, options => { options.identity = { ...principal, userId: 'other' }; },
    options => { options.identity = { ...principal, generation: 2 }; }, options => { options.ownerKey = 'other-host'; }, options => { options.includeProjectConversations = true; }]) {
    const f = fixture(), old = f.controller.loadInitial(); change(f.options); assert.equal(f.controller.getSnapshot().loaded, false); f.controller.syncScope(); assert.equal(f.calls[0].signal.aborted, true);
    const next = f.controller.loadInitial(); f.calls[0].resolve(response(0, 0, [{ id: 'old' }])); assert.equal(await old, false);
    f.calls[1].resolve(response(0, 0, [{ id: 'new' }])); await next; assert.equal(f.controller.getSnapshot().items[0].id, 'new');
  }
});
await check('explicit reset retires old failure and retry state without polluting newer page', async () => {
  const f = fixture(), old = f.controller.loadInitial(); f.controller.reset(); const next = f.controller.loadInitial();
  f.calls[0].reject(Error('late failure')); assert.equal(await old, false); f.calls[1].resolve(response(0, 0)); await next;
  assert.equal(f.controller.getSnapshot().error, null); assert.equal(f.controller.getSnapshot().failedAction, null); assert.equal(f.controller.getSnapshot().loaded, true);
});
await check('real reader gets exact captured identity and include flag, signed-out state does no read', async () => {
  const f = fixture(); f.options.includeProjectConversations = true; const pending = f.controller.loadInitial();
  assert.equal(f.calls[0].identity.accountId, principal.accountId); assert.equal(f.calls[0].includeProjectConversations, true); assert.equal(f.calls[0].offset, 0);
  f.calls[0].resolve(response(0, 0)); await pending; f.options.identity = null; f.controller.syncScope(); assert.equal(await f.controller.loadInitial(), false); assert.equal(f.calls.length, 1);
});
await check('refresh refetches existing page count sequentially using new page metadata and commits atomically', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 50)); await initial;
  const more = f.controller.loadMore(); f.calls[1].resolve(response(20, 50)); await more; const oldPages = f.controller.getSnapshot().pages;
  const refreshing = f.controller.refresh(); assert.equal(f.calls[2].offset, 0); assert.equal(f.controller.getSnapshot().pages, oldPages);
  f.calls[2].resolve(response(0, 25, [{ id: 'new-first' }])); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[3].offset, 20); assert.equal(f.controller.getSnapshot().pages, oldPages);
  f.calls[3].resolve(response(20, 25, [{ id: 'new-second' }])); assert.equal(await refreshing, true);
  assert.equal(f.controller.getSnapshot().items[0].id, 'new-first'); assert.equal(f.controller.getSnapshot().items[1].id, 'new-second');
});
await check('refresh intermediate error retains all old pages and retry replays refresh rather than append', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 50)); await initial;
  const more = f.controller.loadMore(); f.calls[1].resolve(response(20, 50)); await more; const oldPages = f.controller.getSnapshot().pages;
  const refresh = f.controller.refresh(); f.calls[2].resolve(response(0, 50, [{ id: 'partial-new' }])); await new Promise(resolve => setImmediate(resolve));
  f.calls[3].reject(Error('refresh second page failed')); assert.equal(await refresh, false); assert.equal(f.controller.getSnapshot().pages, oldPages); assert.equal(f.controller.getSnapshot().failedAction, 'refresh');
  const retry = f.controller.retry(); assert.equal(f.calls[4].offset, 0); f.calls[4].resolve(response(0, 50, [{ id: 'fresh-first' }])); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[5].offset, 20); f.calls[5].resolve(response(20, 50, [{ id: 'fresh-second' }])); assert.equal(await retry, true); assert.equal(f.controller.getSnapshot().pages.length, 2); assert.equal(f.controller.getSnapshot().items[0].id, 'fresh-first');
});
await check('refresh uses new EOF to stop before old page count without relying on visible row count', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 50)); await initial;
  const more = f.controller.loadMore(); f.calls[1].resolve(response(20, 50)); await more;
  const refresh = f.controller.refresh(); f.calls[2].resolve(response(0, 10, [{ id: 'only-page' }])); assert.equal(await refresh, true);
  assert.equal(f.calls.length, 3); assert.equal(f.controller.getSnapshot().pages.length, 1); assert.equal(f.controller.getSnapshot().nextOffset, null);
});
await check('pending refresh and retry coalesce with actual in-flight request without cancelling it', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 21)); await initial;
  const more = f.controller.loadMore(), refreshing = f.controller.refresh(), retry = f.controller.retry();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].signal.aborted, false); f.calls[1].resolve(response(20, 21));
  assert.equal(await more, true); assert.equal(await refreshing, true); assert.equal(await retry, true); assert.equal(f.controller.getSnapshot().pages.length, 2);
});
await check('old-scope refresh pages never replace newer owner data after cancellation', async () => {
  const f = fixture(), initial = f.controller.loadInitial(); f.calls[0].resolve(response(0, 50)); await initial;
  const more = f.controller.loadMore(); f.calls[1].resolve(response(20, 50)); await more;
  const old = f.controller.refresh(); f.calls[2].resolve(response(0, 50, [{ id: 'old-new-first' }])); await new Promise(resolve => setImmediate(resolve));
  f.options.ownerKey = 'new-host'; f.controller.syncScope(); assert.equal(f.calls[3].signal.aborted, true); const next = f.controller.loadInitial();
  f.calls[3].resolve(response(20, 50)); assert.equal(await old, false); f.calls[4].resolve(response(0, 0, [{ id: 'new-owner' }])); await next;
  assert.equal(f.controller.getSnapshot().pages.length, 1); assert.equal(f.controller.getSnapshot().items[0].id, 'new-owner');
});
console.log(`PASS ${groups} decoder + ${controllerGroups} controller groups`);
