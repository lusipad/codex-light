import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = (permissions = [null, null]) => ({ identity: { accountId: 'account', userId: 'user', generation: 1 }, appId: 'app', personal: true, access: 'allowed',
  defaultValue: 'review_important_actions', defaultError: null, details: { pluginId: 'plugin', appId: 'app', connector: { id: 'app', name: 'App' }, linksError: null,
    links: permissions.map((permission, i) => ({ id: `link-${i}`, connector_id: 'app', apps_privacy_control: permission, editable: true })) } });
const accounts = value => (value.details.links ?? []).map(link => ({ linkId: link.id, permission: link.apps_privacy_control, editable: link.editable }));
const batch = (value, options = {}) => ({ snapshot: value, confirmedLinkIds: [], failedLinkIds: [], pendingLinkIds: [], refreshError: null, ...options });
function harness(read = async () => snapshot()) {
  let cursor = 0, slots = [], effects = [], scheduled = [], output, props = ['connection', 'plugin', null], stateWrites = 0;
  const reads = [], writes = [], api = { read, save: async (before, ids, value) => batch({ ...before, details: { ...before.details,
    links: before.details.links.map(link => ids.includes(link.id) ? { ...link, apps_privacy_control: value } : link) } }, { confirmedLinkIds: ids }) };
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { stateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pluginAppLinkPermissionsState.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, AbortController, require: name => {
      if (name === 'react') return react;
      if (name === './chatgptService') return { serviceErrorMessage: error => error?.message || '无法读取账户权限，请重试。' };
      if (name === './pluginAppLinkPermissions') return {
        loadPluginAppLinkPermissions: (...args) => { reads.push(args); return api.read(...args); },
        savePluginAppLinkPermissions: (...args) => { writes.push(args); return api.save(...args); }, pluginAppPermissionAccounts: accounts,
      };
      throw Error(`Unexpected dependency ${name}`);
    } });
  const flush = () => { for (const run of scheduled.splice(0)) run(); };
  const render = (commit = true) => { cursor = 0; output = exports.usePluginAppLinkPermissions(...props); if (commit) flush(); return output; };
  const tick = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } };
  render(); return { api, reads, writes, render, tick, flush, get output() { return output; }, get stateWrites() { return stateWrites; },
    set props(value) { props = value; }, unmount() { for (const effect of effects) effect?.cleanup?.(); } };
}
{
  const h = harness(); assert.equal(h.output.state.loading, true); await h.tick();
  assert.equal(h.output.state.blocked, false); assert.equal(h.output.state.snapshot.appId, 'app');
  assert.equal(await h.output.change(['link-0'], 'review_important_actions'), true);
  assert.equal(h.writes.length, 1, 'raw null can become an explicit override despite matching effective default');
  await h.tick(); assert.equal(h.output.state.snapshot.details.links[0].apps_privacy_control, 'review_important_actions'); h.unmount();
}
{
  const h = harness(); await h.tick(); const gate = deferred(); h.api.save = () => gate.promise;
  const pending = h.output.change(['link-0', 'link-1'], 'always_ask'); h.render(); assert.equal(h.output.state.pending, true);
  assert.equal(await h.output.change(['link-1'], 'full_access'), false); const reads = h.reads.length;
  await h.output.reload(); assert.equal(h.reads.length, reads); assert.equal(h.writes[0][3].aborted, false);
  gate.resolve(batch(snapshot(['always_ask', null]), { confirmedLinkIds: ['link-0'], failedLinkIds: ['link-1'] }));
  assert.equal(await pending, false); await h.tick(); assert.equal(h.output.state.blocked, false);
  assert.equal(h.output.state.failedLinkIds.join(), 'link-1'); assert.equal(h.output.state.snapshot.details.links[0].apps_privacy_control, 'always_ask');
  h.api.save = async (_before, ids, value) => { assert.equal(ids.join(), 'link-1'); assert.equal(value, 'always_ask'); return batch(snapshot(['always_ask', 'always_ask']), { confirmedLinkIds: ids }); };
  assert.equal(await h.output.retryFailed(), true); await h.tick(); assert.equal(h.writes.length, 2); assert.equal(h.output.state.failedLinkIds.length, 0); h.unmount();
}
{
  const h = harness(); await h.tick(); h.api.save = async () => batch(snapshot(['always_ask', null]), { confirmedLinkIds: ['link-0'], pendingLinkIds: ['link-1'] });
  assert.equal(await h.output.change(['link-0', 'link-1'], 'always_ask'), false); await h.tick();
  assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.pendingLinkIds.join(), 'link-1');
  assert.equal(await h.output.retryFailed(), false); assert.equal(await h.output.change(['link-1'], 'always_ask'), false);
  for (const kind of ['links', 'default']) {
    const partial = snapshot(['always_ask', null]);
    if (kind === 'links') { partial.details.links = null; partial.details.linksError = { code: 'offline', message: '账户读取失败' }; }
    else { partial.defaultValue = null; partial.defaultError = '默认权限读取失败'; }
    h.api.read = async () => partial; await h.output.reload(); await h.tick();
    assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.pendingLinkIds.join(), 'link-1');
    assert.ok(h.output.state.refreshError); const refreshError = h.output.state.refreshError; h.output.clearErrors(); h.render(); assert.equal(h.output.state.refreshError, refreshError);
    if (kind === 'default') { assert.equal(h.output.state.snapshot.defaultValue, 'review_important_actions'); assert.equal(h.output.state.snapshot.defaultError, '默认权限读取失败'); }
  }
  h.api.read = async () => snapshot(['always_ask', 'full_access']); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.blocked, false); assert.equal(h.output.state.pendingLinkIds.length, 0); assert.equal(h.writes.length, 1, 'unknown recovery never replays a PATCH'); h.unmount();
}
{
  const h = harness(); await h.tick(); h.api.save = async () => batch(null, { confirmedLinkIds: ['link-0'], refreshError: 'Refresh failed' });
  assert.equal(await h.output.change(['link-0'], null), false); await h.tick();
  assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.refreshError, 'Refresh failed');
  h.api.read = async () => snapshot(); await h.output.reload(); await h.tick(); assert.equal(h.writes.length, 1); assert.equal(h.output.state.refreshError, null); h.unmount();
}
{
  const partial = snapshot(); partial.defaultValue = null; partial.defaultError = '默认权限不可用';
  const h = harness(async () => partial); await h.tick(); assert.equal(h.output.state.snapshot.defaultValue, null); assert.equal(h.output.state.blocked, true);
  assert.equal(await h.output.change(['link-0'], 'always_ask'), false); assert.equal(h.writes.length, 0); h.unmount();
}
{
  const h = harness(); await h.tick(); h.api.save = async () => batch(snapshot(), { failedLinkIds: ['link-0', 'link-1'] });
  await h.output.change(['link-0', 'link-1'], 'always_ask'); await h.tick();
  const actual = snapshot(['always_ask']); h.api.read = async () => actual; await h.output.reload(); await h.tick();
  assert.equal(h.output.state.failedLinkIds.length, 0, 'already changed or disappeared IDs are not fabricated');
  const readCount = h.reads.length; await h.output.retryFailed(); await h.tick();
  assert.equal(h.reads.length, readCount + 1, 'no remaining failed target is verified through a fresh read'); assert.equal(h.writes.length, 1); h.unmount();
}
for (const access of ['denied', 'unavailable']) {
  const value = snapshot(); value.access = access;
  const h = harness(async () => value); await h.tick();
  assert.equal(h.output.state.unavailable, access === 'denied' ? 'detail' : null);
  assert.equal(h.output.state.blocked, true); assert.equal(Boolean(h.output.state.error), access === 'unavailable'); h.unmount();
}
{
  const h = harness(async () => { throw { code: 'app_not_in_plugin' }; }); await h.tick();
  assert.equal(h.output.state.unavailable, 'plugin'); assert.equal(h.output.state.snapshot, null); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick(); const oldChange = h.output.change, oldRetry = h.output.retryFailed, oldClear = h.output.clearErrors;
  h.api.save = () => gate.promise; const pending = h.output.change(['link-0'], 'always_ask');
  h.props = ['other', 'plugin', 'app']; assert.equal(h.render(false).state.snapshot, null); h.flush(); await h.tick();
  assert.equal(h.writes[0][3].aborted, true);
  h.props = ['connection', 'plugin', null]; h.render(); await h.tick();
  gate.resolve(batch(snapshot(['always_ask', null]))); assert.equal(await pending, false); await h.tick();
  assert.equal(h.output.state.snapshot.details.links[0].apps_privacy_control, null);
  const count = h.writes.length; assert.equal(await oldChange(['link-0'], 'full_access'), false); assert.equal(await oldRetry(), false); oldClear(); assert.equal(h.writes.length, count); h.unmount();
}
{
  const oldGate = deferred(), nextGate = deferred(), h = harness(); await h.tick();
  h.api.save = () => oldGate.promise; const old = h.output.change(['link-0'], 'always_ask');
  h.props = ['other', 'plugin', null]; h.render(); await h.tick();
  h.api.save = () => nextGate.promise; const next = h.output.change(['link-1'], 'full_access');
  oldGate.resolve(batch(snapshot())); assert.equal(await old, false); await h.tick();
  assert.equal(h.output.state.pending, true); assert.equal(await h.output.change(['link-0'], 'always_ask'), false);
  nextGate.resolve(batch(snapshot([null, 'full_access']), { confirmedLinkIds: ['link-1'] })); assert.equal(await next, true); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick(); h.api.save = () => gate.promise;
  const pending = h.output.change(['link-0'], 'always_ask'); h.unmount(); assert.equal(h.writes[0][3].aborted, true); const count = h.stateWrites;
  gate.reject({ code: 'cancelled' }); assert.equal(await pending, false); h.output.clearErrors(); assert.equal(h.stateWrites, count);
  assert.equal(await h.output.retryFailed(), false); assert.equal(await h.output.change(['link-1'], 'full_access'), false);
}
{
  const h = harness(); await h.tick(); h.api.save = async () => { throw Error('Unknown delivery'); };
  await h.output.change(['link-0'], 'always_ask'); await h.tick(); assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.pendingLinkIds.join(), 'link-0');
  h.api.read = async () => { throw Error('Offline'); }; await h.output.reload(); await h.tick();
  assert.equal(h.output.state.error, 'Offline'); assert.equal(h.output.state.snapshot.details.links.length, 2); assert.equal(h.output.state.blocked, true); h.unmount();
}
{
  const first = deferred(), second = deferred(), h = harness(() => first.promise);
  h.api.read = () => second.promise; const latest = h.output.reload(); assert.equal(h.reads[0][2].aborted, true);
  second.resolve(snapshot(['full_access', null])); await latest;
  first.resolve(snapshot(['always_ask', null])); await h.tick();
  assert.equal(h.output.state.snapshot.details.links[0].apps_privacy_control, 'full_access', 'late same-scope read cannot replace latest read'); h.unmount();
}
{
  const h = harness(); await h.tick(); const partial = snapshot(); partial.identity = { accountId: 'different', userId: 'user', generation: 2 };
  partial.defaultValue = null; partial.defaultError = 'New identity default unavailable'; h.api.read = async () => partial;
  await h.output.reload(); await h.tick(); assert.equal(h.output.state.snapshot.defaultValue, null, 'never lend the previous identity default to a new identity');
  assert.equal(h.output.state.blocked, true); h.unmount();
}
{
  const h = harness(); await h.tick(); const actual = snapshot(); actual.details.links[1].editable = false;
  h.api.save = async () => batch(actual, { failedLinkIds: ['link-0', 'link-1'] }); await h.output.change(['link-0', 'link-1'], 'always_ask'); await h.tick();
  h.api.save = async (_before, ids) => { assert.equal(ids.join(), 'link-0', 'a failed account that became noneditable is excluded from retry');
    return batch(snapshot(['always_ask', null]), { confirmedLinkIds: ids }); };
  await h.output.retryFailed(); assert.equal(h.writes.length, 2); h.unmount();
}
{
  const h = harness(); await h.tick(); h.api.save = async () => batch(snapshot(), { failedLinkIds: ['link-0'] });
  await h.output.change(['link-0'], 'always_ask'); await h.tick(); assert.equal(h.output.state.failedLinkIds.join(), 'link-0');
  h.output.clearErrors(); h.render(); assert.equal(h.output.state.failedLinkIds.length, 0, 'target/mode changes reset the failed mutation');
  const count = h.writes.length, reads = h.reads.length; assert.equal(await h.output.retryFailed(), false);
  assert.equal(h.writes.length, count, 'reset cannot retry old IDs with the old permission'); assert.equal(h.reads.length, reads); h.unmount();
}
{
  const h = harness(); await h.tick(); h.api.save = async () => batch(snapshot(), { pendingLinkIds: ['link-0'] });
  await h.output.change(['link-0'], 'always_ask'); await h.tick();
  assert.ok(h.output.state.refreshError || h.output.state.error, 'unknown delivery exposes a visible read-only recovery message');
  h.output.clearErrors(); h.render(); assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.pendingLinkIds.join(), 'link-0');
  assert.equal(await h.output.retryFailed(), false); assert.equal(h.writes.length, 1); h.unmount();
}
console.log('Plugin app link permissions real hook: batch partial failure/retry, unknown read-only recovery, partial links/default safety, raw overrides, scope ABA, single-flight and cleanup passed.');
const resolved = (appId, permissions = [null, null]) => {
  const value = snapshot(permissions); value.routeAppId = null; value.appId = appId; value.details.appId = appId; value.details.connector.id = appId;
  value.details.links.forEach(link => { link.connector_id = appId; }); return value;
};
{
  const h = harness(async () => resolved('app-A')); await h.tick(); const oldChange = h.output.change;
  h.api.save = async () => batch(resolved('app-A'), { failedLinkIds: ['link-0'] });
  await h.output.change(['link-0'], 'always_ask'); await h.tick(); assert.equal(h.output.state.failedLinkIds.join(), 'link-0');
  h.api.read = async () => resolved('app-B'); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.snapshot.appId, 'app-B'); assert.equal(h.output.state.failedLinkIds.length, 0, 'new implicit canonical app resets A mutation');
  const count = h.writes.length; assert.equal(await h.output.retryFailed(), false); assert.equal(await oldChange(['link-0'], 'full_access'), false);
  assert.equal(h.writes.length, count, 'A callbacks cannot write B automatically'); h.unmount();
}
for (const partial of [false, true]) {
  const h = harness(async () => resolved('app-A')); await h.tick(); const beforeWrite = h.output.change;
  const b = resolved('app-B'); if (partial) { b.defaultValue = null; b.defaultError = 'B default unavailable'; }
  h.api.save = async () => batch(b, { confirmedLinkIds: ['link-0'], failedLinkIds: ['link-1'], pendingLinkIds: ['link-0'], refreshError: 'A refresh failed' });
  assert.equal(await h.output.change(['link-0', 'link-1'], 'always_ask'), false, 'A cannot report save success through a B readback'); await h.tick();
  assert.equal(h.output.state.snapshot.appId, 'app-B'); assert.equal(h.output.state.failedLinkIds.length, 0); assert.equal(h.output.state.pendingLinkIds.length, 0);
  assert.equal(h.output.state.refreshError, partial ? 'B default unavailable' : null); assert.equal(h.output.state.blocked, partial);
  assert.equal(h.output.state.snapshot.defaultValue, partial ? null : 'review_important_actions', 'B must not borrow A default');
  assert.equal(await beforeWrite(['link-0'], 'always_ask'), false); assert.equal(await h.output.retryFailed(), false); assert.equal(h.writes.length, 1); h.unmount();
}
{
  const h = harness(async () => resolved('app-A')); await h.tick();
  h.api.save = async () => batch(resolved('app-B', ['always_ask', null]), { confirmedLinkIds: ['link-0'] });
  assert.equal(await h.output.change(['link-0'], 'always_ask'), false, 'even a complete confirmed B response cannot confirm the original A mutation');
  await h.tick(); assert.equal(h.output.state.snapshot.appId, 'app-B'); assert.equal(h.output.state.blocked, false); assert.equal(h.writes.length, 1); h.unmount();
}
{
  const h = harness(async () => resolved('app-A')); await h.tick();
  h.api.save = async () => batch(null, { pendingLinkIds: ['link-0'], refreshError: 'A unknown' }); await h.output.change(['link-0'], 'always_ask'); await h.tick();
  const b = resolved('app-B'); b.defaultValue = null; b.defaultError = 'B default failed'; h.api.read = async () => b;
  await h.output.reload(); await h.tick();
  assert.equal(h.output.state.snapshot.defaultValue, null); assert.equal(h.output.state.pendingLinkIds.length, 0); assert.equal(h.output.state.refreshError, 'B default failed');
  assert.equal(h.output.state.blocked, true, 'only B own incomplete read blocks B, not an A pending mutation'); assert.equal(h.writes.length, 1); h.unmount();
}
console.log('Implicit resolved-app scope: canonical replacement resets mutations/defaults, retires A callbacks, never confirms A through B or writes B automatically.');
