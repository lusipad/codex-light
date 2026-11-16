import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = (appId = 'app-A', name = appId) => ({ identity: { accountId: 'account-A', userId: 'user', generation: 1 },
  details: { pluginId: 'plugin', appId, connector: { id: appId, name }, links: [], linksError: null } });

function harness(read = async (_plugin, app) => snapshot(app)) {
  let slots = [], cursor = 0, effects = [], scheduled = [], output, props = ['connection-A', 'plugin', 'app-A'], writes = 0;
  const calls = [], saveCalls = [], disconnectCalls = [], api = { read, disconnect: async (before, _app, linkId) => ({ snapshot: { ...before,
    details: { ...before.details, links: before.details.links.filter(link => link.id !== linkId) } }, confirmed: true }), save: async (before, _app, linkId, name) => ({ snapshot: { ...before,
    details: { ...before.details, links: before.details.links.map(link => link.id === linkId ? { ...link, name: name.trim() } : link) } }, confirmed: true }) };
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pluginAppDetailsState.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, AbortController, require: name => {
    if (name === 'react') return react;
    if (name === './pluginAppDetails') return { loadPluginAppDetails: (...args) => { calls.push(args); return api.read(...args); } };
    if (name === './pluginAppAccounts') return { savePluginAppAccountName: (...args) => { saveCalls.push(args); return api.save(...args); },
      disconnectPluginAppAccount: (...args) => { disconnectCalls.push(args); return api.disconnect(...args); } };
    if (name === './chatgptService') return { serviceErrorMessage: error => error?.code === 'cancelled' ? '请求已取消。' : error?.message || '暂时无法读取服务，请重试。' };
    throw Error(`Unexpected dependency ${name}`);
  } });
  const flush = () => { for (const run of scheduled.splice(0)) run(); };
  const render = (commit = true) => { cursor = 0; output = exports.usePluginAppDetails(...props); if (commit) flush(); return output; };
  const tick = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } };
  render();
  return { calls, saveCalls, disconnectCalls, api, render, flush, tick, get output() { return output; }, get writes() { return writes; },
    set props(value) { props = value; }, unmount() { for (const entry of effects) entry?.cleanup?.(); } };
}

{
  const h = harness(); assert.equal(h.output.state.loading, true); assert.equal(h.output.state.snapshot, null);
  await h.tick(); assert.equal(h.output.state.snapshot.details.appId, 'app-A'); assert.equal(h.output.state.error, null);
  const before = h.output.state.snapshot, gate = deferred(); h.api.read = () => gate.promise;
  const pending = h.output.reload(); h.render(); assert.equal(h.output.state.snapshot, before); assert.equal(h.output.state.loading, true);
  gate.reject(Error('读取失败')); await pending; await h.tick();
  assert.equal(h.output.state.snapshot, before); assert.equal(h.output.state.error, '读取失败'); assert.equal(h.output.state.loading, false);
  h.api.read = async () => snapshot('app-A', '重新读取'); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.snapshot.details.connector.name, '重新读取'); assert.equal(h.output.state.error, null); h.unmount();
}
{
  const h = harness(async () => { throw Error('无访问权限'); }); await h.tick();
  assert.equal(h.output.state.snapshot, null); assert.equal(h.output.state.error, '无访问权限'); assert.equal(h.output.state.loading, false);
  h.api.read = async () => { const value = snapshot(); value.details.links = null; value.details.linksError = { code: 'offline', message: '账户列表读取失败' }; return value; };
  await h.output.reload(); await h.tick();
  assert.equal(h.output.state.error, null); assert.equal(h.output.state.snapshot.details.links, null);
  assert.equal(h.output.state.snapshot.details.linksError.message, '账户列表读取失败', 'independent links failure remains in metadata snapshot'); h.unmount();
}
{
  const gate = deferred(), h = harness(() => gate.promise); const oldReload = h.output.reload;
  h.props = ['connection-B', 'plugin', 'app-B']; h.api.read = async () => snapshot('app-B');
  const duringRender = h.render(false); assert.equal(duringRender.state.snapshot, null); assert.equal(duringRender.state.loading, true);
  h.flush(); assert.equal(h.calls[0][2].aborted, true); await h.tick();
  gate.resolve(snapshot('app-A')); await h.tick(); assert.equal(h.output.state.snapshot.details.appId, 'app-B');
  const count = h.calls.length; await oldReload(); assert.equal(h.calls.length, count, 'retired route callback cannot read current route'); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick(); const oldReload = h.output.reload;
  h.api.read = () => gate.promise; const old = h.output.reload();
  h.props = ['connection-B', 'plugin', 'app-A']; h.api.read = async () => snapshot('app-A', 'B'); h.render(); await h.tick();
  h.props = ['connection-A', 'plugin', 'app-A']; h.api.read = async () => snapshot('app-A', 'new-A');
  assert.equal(h.render(false).state.snapshot, null, 'A-B-A isolates earlier A data before effects'); h.flush(); await h.tick();
  gate.resolve(snapshot('app-A', 'stale-A')); await old; await h.tick(); assert.equal(h.output.state.snapshot.details.connector.name, 'new-A');
  const count = h.calls.length; await oldReload(); assert.equal(h.calls.length, count, 'A-B-A cannot revive old callbacks'); h.unmount();
}
{
  const first = deferred(), second = deferred(), h = harness(); await h.tick();
  h.api.read = () => first.promise; const p1 = h.output.reload(), firstSignal = h.calls.at(-1)[2];
  h.api.read = () => second.promise; const p2 = h.output.reload(); assert.equal(firstSignal.aborted, true);
  second.resolve(snapshot('app-A', 'latest')); await p2; first.resolve(snapshot('app-A', 'old')); await p1; await h.tick();
  assert.equal(h.output.state.snapshot.details.connector.name, 'latest'); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick();
  h.api.read = () => gate.promise; const old = h.output.reload();
  h.props = ['connection-A', 'other-plugin', 'app-A'];
  h.api.read = async (plugin, app) => { const value = snapshot(app); value.details.pluginId = plugin; return value; };
  assert.equal(h.render(false).state.snapshot, null, 'plugin ownership changes isolate an otherwise identical app');
  h.flush(); await h.tick(); gate.reject(Error('late failure')); await old; await h.tick();
  assert.equal(h.output.state.snapshot.details.pluginId, 'other-plugin'); assert.equal(h.output.state.error, null);
  assert.equal(h.calls.at(-1)[0], 'other-plugin'); h.unmount();
}
{
  const gate = deferred(), h = harness(() => gate.promise), staleReload = h.output.reload;
  const signal = h.calls[0][2]; h.unmount(); assert.equal(signal.aborted, true); const writes = h.writes;
  gate.reject({ code: 'cancelled' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.writes, writes, 'unmount abort does not update state or invent an error');
  const count = h.calls.length; await staleReload(); assert.equal(h.calls.length, count);
}
{
  const h = harness(async () => { throw { code: 'cancelled' }; }); await h.tick();
  assert.equal(h.output.state.error, '请求已取消。', 'service cancellation without an aborted local signal remains visible'); h.unmount();
}
console.log('Plugin app details state: real hook reads, read-only retry, independent links error, route/account ABA, retry ordering and unmount cancellation passed.');
{
  const h = harness(async () => { throw { code: 'app_not_in_plugin', message: 'No longer a member' }; }); await h.tick();
  assert.equal(h.output.state.unavailable, true, 'a specific membership loss must reach the route redirect consumer');
  assert.equal(h.output.state.error, null, 'membership loss is not a generic permission retry page');
  h.api.read = async () => { throw { code: 'forbidden', message: 'Real service denial' }; };
  await h.output.reload(); await h.tick(); assert.equal(h.output.state.unavailable, false);
  assert.equal(h.output.state.error, 'Real service denial', 'actual 403 must remain an error instead of redirecting'); h.unmount();
}

const accountSnapshot = (name = 'Original') => {
  const value = snapshot(); value.details.links = [{ id: 'link', connector_id: 'app-A', name, owners: [] }]; return value;
};
{
  const h = harness(async () => accountSnapshot(' Original ')); await h.tick();
  assert.equal(await h.output.rename('link', 'Original'), false);
  assert.equal(h.saveCalls.length, 0, 'same trimmed wire name does not start a rename'); h.unmount();
}
{
  const h = harness(async () => accountSnapshot()); assert.equal(await h.output.rename('link', 'New'), false);
  await h.tick(); assert.equal(await h.output.rename('link', '  Original  '), false); assert.equal(h.saveCalls.length, 0);
  const gate = deferred(); h.api.save = () => gate.promise;
  const pending = h.output.rename('link', 'New'); assert.equal(await h.output.rename('link', 'Duplicate'), false);
  const reads = h.calls.length, signal = h.saveCalls[0][4]; await h.output.reload(); assert.equal(h.calls.length, reads); assert.equal(signal.aborted, false);
  h.render(); assert.equal(h.output.state.pendingLinkId, 'link'); assert.equal(h.output.state.snapshot.details.links[0].name, 'Original');
  h.output.clearRenameError(); gate.resolve({ snapshot: accountSnapshot('New'), confirmed: true });
  assert.equal(await pending, true, 'only confirmed readback tells the dialog to close'); await h.tick();
  assert.equal(h.output.state.pendingLinkId, null); assert.equal(h.output.state.blocked, false);
  assert.equal(h.output.state.snapshot.details.links[0].name, 'New'); assert.equal(h.saveCalls[0][1], 'app-A'); h.unmount();
}
for (const actual of [null, accountSnapshot('Different actual')]) {
  const h = harness(async () => accountSnapshot()); await h.tick(); h.api.save = async () => ({ snapshot: actual, confirmed: false });
  assert.equal(await h.output.rename('link', 'Requested'), false); await h.tick();
  assert.equal(h.output.state.snapshot.details.links[0].name, actual ? 'Different actual' : 'Original');
  assert.equal(h.output.state.blocked, true); assert.match(h.output.state.writeError, /无法确认账户昵称是否已保存/);
  const error = h.output.state.writeError; h.output.clearRenameError(); h.render(); assert.equal(h.output.state.writeError, error);
  assert.equal(await h.output.rename('link', 'Again'), false); assert.equal(h.saveCalls.length, 1);
  h.api.read = async () => accountSnapshot('Verified'); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.blocked, false); assert.equal(h.output.state.writeError, null); assert.equal(h.saveCalls.length, 1); h.unmount();
}
for (const code of ['forbidden', 'invalid_request', 'not_found', 'cancelled', 'account_changed', 'transport_error']) {
  const h = harness(async () => accountSnapshot()); await h.tick(); h.api.save = async () => { throw { code, message: `Failure ${code}` }; };
  assert.equal(await h.output.rename('link', 'New'), false); await h.tick();
  const rejected = ['forbidden', 'invalid_request', 'not_found'].includes(code);
  assert.equal(h.output.state.blocked, !rejected); assert.equal(h.output.state.unavailable, false);
  assert.equal(h.output.state.snapshot.details.links[0].name, 'Original'); assert.ok(h.output.state.writeError);
  h.output.clearRenameError(); h.render(); assert.equal(h.output.state.writeError === null, rejected);
  if (!rejected) {
    assert.equal(await h.output.rename('link', 'No replay'), false); assert.equal(h.saveCalls.length, 1);
    h.api.read = async () => { throw Error('Readback offline'); }; await h.output.reload(); await h.tick();
    assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.error, 'Readback offline');
    h.api.read = async () => accountSnapshot(); await h.output.reload(); await h.tick(); assert.equal(h.output.state.blocked, false);
  }
  h.unmount();
}
{
  const h = harness(async () => accountSnapshot()); await h.tick();
  h.api.save = async () => { throw { code: 'app_not_in_plugin' }; }; await h.output.rename('link', 'New'); await h.tick();
  assert.equal(h.output.state.unavailable, true); assert.equal(h.output.state.snapshot, null); assert.equal(h.output.state.writeError, null); h.unmount();
}
{
  const oldGate = deferred(), nextGate = deferred(), h = harness(async () => accountSnapshot()); await h.tick(); const staleRename = h.output.rename;
  h.api.save = () => oldGate.promise; const old = h.output.rename('link', 'Old'); const oldSignal = h.saveCalls[0][4];
  h.props = ['connection-B', 'plugin', 'app-A']; h.render(); await h.tick(); assert.equal(oldSignal.aborted, true);
  h.api.save = () => nextGate.promise; const next = h.output.rename('link', 'Current'); h.render();
  oldGate.resolve({ snapshot: accountSnapshot('Old'), confirmed: true }); assert.equal(await old, false); await h.tick();
  assert.equal(h.output.state.pendingLinkId, 'link'); assert.equal(await h.output.rename('link', 'Duplicate'), false, 'old finally cannot unlock new scope write');
  nextGate.resolve({ snapshot: accountSnapshot('Current'), confirmed: true }); assert.equal(await next, true); await h.tick();
  h.props = ['connection-A', 'plugin', 'app-A']; h.render(); await h.tick();
  assert.equal(await staleRename('link', 'ABA old handler'), false); assert.equal(h.saveCalls.length, 2); h.unmount();
}
{
  const gate = deferred(), h = harness(async () => accountSnapshot()); await h.tick(); h.api.save = () => gate.promise;
  const pending = h.output.rename('link', 'New'), oldClear = h.output.clearRenameError; h.unmount();
  assert.equal(h.saveCalls[0][4].aborted, true); const writes = h.writes;
  gate.reject({ code: 'cancelled' }); assert.equal(await pending, false); oldClear();
  assert.equal(h.writes, writes); assert.equal(await h.output.rename('link', 'Again'), false); assert.equal(h.saveCalls.length, 1);
}
console.log('Plugin app account rename state: confirmed-only close, synchronous single-flight, actual readback, unknown-write read-only recovery, membership/403, ABA and unmount isolation passed.');
{
  const h = harness(async () => accountSnapshot()); await h.tick(); const gate = deferred(); h.api.disconnect = () => gate.promise;
  const pending = h.output.disconnect('link'); h.render(); assert.equal(h.output.state.pendingAction, 'disconnect');
  assert.equal(h.output.state.pendingLinkId, 'link'); assert.equal(await h.output.rename('link', 'Concurrent'), false);
  assert.equal(await h.output.disconnect('link'), null); assert.equal(h.disconnectCalls.length, 1);
  const count = h.calls.length; await h.output.reload(); assert.equal(h.calls.length, count); assert.equal(h.disconnectCalls[0][3].aborted, false);
  const actual = accountSnapshot(); actual.details.links = []; gate.resolve({ snapshot: actual, confirmed: true });
  assert.equal(await pending, actual, 'last account can be confirmed as a real empty list'); await h.tick();
  assert.equal(h.output.state.pendingAction, null); assert.equal(h.output.state.snapshot.details.links.length, 0); assert.equal(h.output.state.blocked, false); h.unmount();
}
for (const action of ['rename', 'disconnect']) {
  const h = harness(async () => accountSnapshot()); await h.tick(); const gate = deferred();
  h.api.save = h.api.disconnect = () => gate.promise;
  const pending = action === 'rename' ? h.output.rename('link', 'New') : h.output.disconnect('link'); h.render();
  assert.equal(h.output.state.pendingAction, action); assert.equal(await h.output.disconnect('link'), null);
  assert.equal(await h.output.rename('link', 'Other'), false);
  gate.resolve({ snapshot: null, confirmed: false }); assert.equal(await pending, action === 'rename' ? false : null); await h.tick();
  assert.equal(h.output.state.blocked, true);
  const partial = accountSnapshot(); partial.details.links = null; partial.details.linksError = { code: 'offline', message: 'No links' };
  h.api.read = async () => partial; await h.output.reload(); await h.tick();
  assert.equal(h.output.state.blocked, true, 'metadata-only read cannot recover an uncertain account write');
  assert.equal(h.output.state.pendingAction, null); assert.ok(h.output.state.writeError);
  assert.equal(await h.output.disconnect('link'), null); assert.equal(await h.output.rename('link', 'No replay'), false);
  h.api.read = async () => accountSnapshot('Actual'); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.blocked, false); assert.equal(h.output.state.writeError, null);
  assert.equal(h.saveCalls.length + h.disconnectCalls.length, 1, 'recovery only reads'); h.unmount();
}
{
  const h = harness(async () => accountSnapshot()); await h.tick();
  const actual = accountSnapshot('Actually renamed elsewhere'); h.api.disconnect = async () => ({ snapshot: actual, confirmed: false });
  assert.equal(await h.output.disconnect('link'), null); await h.tick();
  assert.equal(h.output.state.snapshot, actual); assert.match(h.output.state.writeError, /无法确认账户是否已断开/);
  assert.equal(h.output.state.blocked, true); h.unmount();
}
for (const code of ['forbidden', 'invalid_request', 'not_found', 'transport_error', 'app_not_in_plugin']) {
  const h = harness(async () => accountSnapshot()); await h.tick();
  h.api.disconnect = async () => { throw { code, message: 'Actual service error' }; };
  assert.equal(await h.output.disconnect('link'), null); await h.tick();
  assert.equal(h.output.state.pendingAction, null);
  assert.equal(h.output.state.unavailable, code === 'app_not_in_plugin');
  if (code === 'app_not_in_plugin') assert.equal(h.output.state.snapshot, null);
  else {
    assert.equal(h.output.state.snapshot.details.links.length, 1, 'rejected delete cannot remove the real account');
    assert.equal(h.output.state.writeError, '无法断开账户连接', 'source copy does not append raw transport or service diagnostics');
    assert.equal(h.output.state.blocked, code === 'transport_error');
  }
  h.unmount();
}
{
  const oldGate = deferred(), nextGate = deferred(), h = harness(async () => accountSnapshot()); await h.tick(); const staleDisconnect = h.output.disconnect;
  h.api.disconnect = () => oldGate.promise; const old = h.output.disconnect('link');
  h.props = ['connection-B', 'plugin', 'app-A']; h.render(); await h.tick(); assert.equal(h.disconnectCalls[0][3].aborted, true);
  h.api.save = () => nextGate.promise; const next = h.output.rename('link', 'Current');
  oldGate.resolve({ snapshot: accountSnapshot(), confirmed: true }); assert.equal(await old, null); await h.tick();
  assert.equal(h.output.state.pendingAction, 'rename'); assert.equal(await h.output.disconnect('link'), null, 'old disconnect finally cannot unlock a new rename');
  nextGate.resolve({ snapshot: accountSnapshot('Current'), confirmed: true }); assert.equal(await next, true); await h.tick();
  h.props = ['connection-A', 'plugin', 'app-A']; h.render(); await h.tick();
  assert.equal(await staleDisconnect('link'), null); assert.equal(h.disconnectCalls.length, 1); h.unmount();
}
{
  const gate = deferred(), h = harness(async () => accountSnapshot()); await h.tick(); h.api.disconnect = () => gate.promise;
  const pending = h.output.disconnect('link'); h.unmount(); assert.equal(h.disconnectCalls[0][3].aborted, true); const writes = h.writes;
  gate.reject({ code: 'cancelled' }); assert.equal(await pending, null); assert.equal(h.writes, writes);
  assert.equal(await h.output.disconnect('link'), null); assert.equal(h.disconnectCalls.length, 1);
}
console.log('Plugin app disconnect state: shared write exclusion, confirmed full empty-list return, unknown/partial readback protection, membership/denial, scope ABA and cleanup passed.');
