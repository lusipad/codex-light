import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = (appId = 'app-A', name = appId) => ({ identity: { accountId: 'account-A', userId: 'user', generation: 1 },
  details: { pluginId: 'plugin', appId, connector: { id: appId, name }, links: [], linksError: null } });

function harness(read = async (_plugin, app) => snapshot(app)) {
  let slots = [], cursor = 0, effects = [], scheduled = [], output, props = ['connection-A', 'plugin', 'app-A'], writes = 0;
  const calls = [], api = { read };
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
    if (name === './chatgptService') return { serviceErrorMessage: error => error?.code === 'cancelled' ? '请求已取消。' : error?.message || '暂时无法读取服务，请重试。' };
    throw Error(`Unexpected dependency ${name}`);
  } });
  const flush = () => { for (const run of scheduled.splice(0)) run(); };
  const render = (commit = true) => { cursor = 0; output = exports.usePluginAppDetails(...props); if (commit) flush(); return output; };
  const tick = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } };
  render();
  return { calls, api, render, flush, tick, get output() { return output; }, get writes() { return writes; },
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
