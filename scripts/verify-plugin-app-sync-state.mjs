import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const status = id => ({ user_connection_details: { auth_status: 'user_connected', connection_instance_id: id, backing_link_id: `link-${id}`, activation_status: 'activated' } });
const snapshot = (appId = 'app-A', statuses = [status('one')]) => ({ identity: { accountId: 'account', userId: 'user', generation: 1 }, routeAppId: null, appId,
  details: { pluginId: 'plugin', appId, connector: { id: appId, name: appId }, links: [{ id: 'link-one', connector_id: appId }], linksError: null },
  account: { id: 'account', structure: 'personal' }, statuses });
function harness(read = async () => snapshot()) {
  let slots = [], cursor = 0, effects = [], scheduled = [], output, props = ['connection', 'plugin', null, null], stateWrites = 0;
  const reads = [], writes = [], api = { read, disable: async before => ({ snapshot: { ...before, statuses: [] }, confirmed: true, refreshError: null }) };
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { stateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pluginAppSyncState.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, AbortController, require: name => {
      if (name === 'react') return react;
      if (name === './chatgptService') return { serviceErrorMessage: error => error?.message || '无法读取同步设置，请重试。' };
      if (name === './pluginAppSync') return { loadPluginAppSync: (...args) => { reads.push(args); return api.read(...args); },
        disablePluginAppSync: (...args) => { writes.push(args); return api.disable(...args); } };
      throw Error(`Unexpected dependency ${name}`);
    } });
  const flush = () => { for (const run of scheduled.splice(0)) run(); };
  const render = (commit = true) => { cursor = 0; output = exports.usePluginAppSync(...props); if (commit) flush(); return output; };
  const tick = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } };
  render(); return { api, reads, writes, render, tick, flush, get output() { return output; }, get stateWrites() { return stateWrites; },
    set props(value) { props = value; }, unmount() { for (const effect of effects) effect?.cleanup?.(); } };
}
{
  const h = harness(); assert.equal(h.output.state.loading, true); assert.equal(h.output.state.snapshot, null); await h.tick();
  assert.equal(h.output.state.blocked, false); assert.equal(h.output.state.snapshot.appId, 'app-A');
  assert.equal(await h.output.disable(h.output.state.snapshot.statuses[0]), true); await h.tick();
  assert.equal(h.output.state.snapshot.statuses.length, 0); assert.equal(h.output.state.pending, false); assert.equal(h.output.state.error, null); h.unmount();
}
{
  const h = harness(); await h.tick(); const gate = deferred(); h.api.disable = () => gate.promise;
  const selected = h.output.state.snapshot.statuses[0], pending = h.output.disable(selected); h.render();
  assert.equal(h.output.state.pending, true); assert.equal(h.output.state.snapshot.statuses.length, 1, 'no optimistic disappearance');
  assert.equal(await h.output.disable(selected), false); const reads = h.reads.length; await h.output.reload();
  assert.equal(h.reads.length, reads); assert.equal(h.writes[0][3].aborted, false, 'read retry must not interrupt in-flight disable');
  gate.resolve({ snapshot: snapshot('app-A', []), confirmed: true, refreshError: null }); assert.equal(await pending, true); await h.tick();
  assert.equal(h.output.state.pending, false); assert.equal(h.output.state.uncertain, false); assert.equal(h.writes.length, 1); h.unmount();
}
for (const actual of [null, snapshot('app-A', [])]) {
  const h = harness(); await h.tick(); h.api.disable = async () => ({ snapshot: actual, confirmed: false, refreshError: actual ? null : 'Refresh offline' });
  assert.equal(await h.output.disable(h.output.state.snapshot.statuses[0]), false); await h.tick();
  assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.uncertain, true); assert.ok(h.output.state.error);
  assert.equal(h.output.state.snapshot.statuses.length, actual ? 0 : 1);
  assert.equal(await h.output.disable(status('one')), false); assert.equal(h.writes.length, 1);
  const partial = snapshot(); partial.details.links = null; partial.details.linksError = { code: 'offline', message: 'Links unavailable' };
  h.api.read = async () => partial; await h.output.reload(); await h.tick();
  assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.uncertain, true); assert.equal(h.output.state.error, 'Links unavailable');
  h.api.read = async () => snapshot('app-A', []); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.blocked, false); assert.equal(h.output.state.uncertain, false); assert.equal(h.output.state.error, null); assert.equal(h.writes.length, 1); h.unmount();
}
for (const code of ['forbidden', 'invalid_request', 'not_found', 'ip_not_authorized', 'cancelled', 'account_changed', 'unknown', 'sync_write_unknown']) {
  const h = harness(); await h.tick(); h.api.disable = async () => { throw { code, message: `Failure ${code}` }; };
  assert.equal(await h.output.disable(h.output.state.snapshot.statuses[0]), false); await h.tick();
  const uncertain = ['cancelled', 'account_changed', 'unknown', 'sync_write_unknown'].includes(code);
  assert.equal(h.output.state.blocked, uncertain); assert.equal(h.output.state.uncertain, uncertain); assert.equal(h.output.state.pending, false);
  assert.equal(h.output.state.error, `Failure ${code}`); assert.equal(h.output.state.snapshot.statuses.length, 1);
  if (uncertain) { assert.equal(await h.output.disable(status('one')), false); assert.equal(h.writes.length, 1); }
  else { h.api.disable = async () => ({ snapshot: snapshot('app-A', []), confirmed: true, refreshError: null }); assert.equal(await h.output.disable(status('one')), true); assert.equal(h.writes.length, 2); }
  h.unmount();
}
for (const operation of ['read', 'disable']) {
  const h = harness(operation === 'read' ? async () => { throw { code: 'app_not_in_plugin' }; } : undefined); await h.tick();
  if (operation === 'disable') { h.api.disable = async () => { throw { code: 'app_not_in_plugin' }; }; await h.output.disable(h.output.state.snapshot.statuses[0]); await h.tick(); }
  assert.equal(h.output.state.unavailable, true); assert.equal(h.output.state.snapshot, null); assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.error, null); h.unmount();
}
{
  const first = deferred(), second = deferred(), h = harness(() => first.promise);
  h.api.read = () => second.promise; const pending = h.output.reload(); assert.equal(h.reads[0][3].aborted, true);
  second.resolve(snapshot('app-A', [status('latest')])); await pending; first.reject(Error('Old read failed')); await h.tick();
  assert.equal(h.output.state.snapshot.statuses[0].user_connection_details.connection_instance_id, 'latest'); assert.equal(h.output.state.error, null); h.unmount();
}
{
  const gate = deferred(), h = harness(() => gate.promise); const oldReload = h.output.reload;
  h.props = ['connection', 'plugin', null, 'link-two']; h.api.read = async (_plugin, _app, selected) => { assert.equal(selected, 'link-two'); return snapshot('app-A', [status('two')]); };
  assert.equal(h.render(false).state.snapshot, null, 'link changes hide old account status before effects'); h.flush(); await h.tick();
  assert.equal(h.reads[0][3].aborted, true); gate.resolve(snapshot()); await h.tick();
  assert.equal(h.output.state.snapshot.statuses[0].user_connection_details.connection_instance_id, 'two');
  const reads = h.reads.length; await oldReload(); assert.equal(h.reads.length, reads); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick(); const oldDisable = h.output.disable, selected = h.output.state.snapshot.statuses[0];
  h.api.disable = () => gate.promise; const pending = h.output.disable(selected);
  h.props = ['other-connection', 'plugin', null, null]; h.render(); await h.tick();
  h.props = ['connection', 'plugin', null, null]; h.render(); await h.tick();
  gate.resolve({ snapshot: snapshot('app-A', []), confirmed: true, refreshError: null }); assert.equal(await pending, false); await h.tick();
  assert.equal(h.output.state.snapshot.statuses.length, 1); assert.equal(await oldDisable(selected), false); assert.equal(h.writes.length, 1); h.unmount();
}
{
  const oldGate = deferred(), nextGate = deferred(), h = harness(); await h.tick(); h.api.disable = () => oldGate.promise;
  const old = h.output.disable(h.output.state.snapshot.statuses[0]); h.props = ['connection', 'plugin', null, 'link-two']; h.render(); await h.tick();
  h.api.disable = () => nextGate.promise; const next = h.output.disable(h.output.state.snapshot.statuses[0]);
  oldGate.reject(Error('Old failed write')); assert.equal(await old, false); await h.tick();
  assert.equal(h.output.state.pending, true); assert.equal(await h.output.disable(status('one')), false, 'old finally cannot release new scope write');
  nextGate.resolve({ snapshot: snapshot('app-A', []), confirmed: true, refreshError: null }); assert.equal(await next, true); h.unmount();
}
for (const partial of [false, true]) {
  const h = harness(); await h.tick(); const oldDisable = h.output.disable;
  const b = snapshot('app-B'); if (partial) { b.details.links = null; b.details.linksError = { code: 'offline', message: 'B links failed' }; }
  h.api.disable = async () => ({ snapshot: b, confirmed: true, refreshError: 'Old A refresh failed' });
  assert.equal(await h.output.disable(h.output.state.snapshot.statuses[0]), false, 'B readback cannot confirm an A disable'); await h.tick();
  assert.equal(h.output.state.snapshot.appId, 'app-B'); assert.equal(h.output.state.uncertain, false); assert.equal(h.output.state.blocked, partial);
  assert.equal(h.output.state.error, partial ? 'B links failed' : null); assert.equal(await oldDisable(status('one')), false); assert.equal(h.writes.length, 1); h.unmount();
}
{
  const h = harness(); await h.tick(); const oldDisable = h.output.disable;
  h.api.read = async () => snapshot('app-B'); await h.output.reload(); await h.tick();
  h.api.read = async () => snapshot('app-A'); await h.output.reload(); await h.tick();
  assert.equal(await oldDisable(status('one')), false, 'resolved app A-B-A does not revive A old callback'); assert.equal(h.writes.length, 0); h.unmount();
}
for (const operation of ['read', 'disable']) {
  const gate = deferred(), h = harness(operation === 'read' ? () => gate.promise : undefined); await h.tick();
  let pending;
  if (operation === 'disable') { h.api.disable = () => gate.promise; pending = h.output.disable(h.output.state.snapshot.statuses[0]); }
  h.unmount(); const writes = h.stateWrites;
  assert.equal(operation === 'read' ? h.reads[0][3].aborted : h.writes[0][3].aborted, true);
  gate.reject({ code: 'cancelled' }); if (pending) assert.equal(await pending, false); else { await Promise.resolve(); await Promise.resolve(); }
  assert.equal(h.stateWrites, writes); assert.equal(await h.output.disable(status('one')), false); await h.output.reload();
}
{
  const h = harness(); await h.tick(); const previous = h.output.state.snapshot; h.api.read = async () => { throw Error('Offline'); };
  await h.output.reload(); await h.tick(); assert.equal(h.output.state.snapshot, previous); assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.error, 'Offline'); h.unmount();
}
{
  const partial = snapshot('app-A', []); partial.details.links = null; partial.details.linksError = { code: 'offline', message: 'Links unavailable' };
  const h = harness(); await h.tick(); h.api.disable = async () => ({ snapshot: partial, confirmed: true, refreshError: null });
  assert.equal(await h.output.disable(h.output.state.snapshot.statuses[0]), false, 'a success flag cannot substitute complete account readback');
  await h.tick(); assert.equal(h.output.state.uncertain, true); assert.equal(h.output.state.blocked, true); h.unmount();
}
console.log('Plugin app sync real hook: confirmed readback, write single-flight, unknown read-only recovery, partial links, scope/link/actual-app ABA and cleanup passed.');
