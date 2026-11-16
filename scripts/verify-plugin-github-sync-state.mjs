import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const repo = (id, name = `repo-${id}`) => ({ id, name, description: null });
const found = (id, query = '', pageToken = null, name = `repo-${id}`) => ({ ...repo(id, name), proof: { query, pageToken } });
const parent = appId => ({ identity: { accountId: 'account', userId: 'user', generation: 1 }, routeAppId: null, appId,
  details: { pluginId: 'plugin' } });
const status = id => ({ user_connection_details: { connection_instance_id: id, backing_link_id: 'link' } });
const scopeOf = (p, s) => JSON.stringify([p.identity.accountId, p.identity.userId, p.identity.generation, p.appId, s.user_connection_details.connection_instance_id]);
const snapshot = (repositories = [repo(1)], p = parent('app'), s = status('connection')) => ({ parent: p, status: s, linkId: 'link', connectionInstanceId: s.user_connection_details.connection_instance_id, repositories });
const build = (baseline, pages, query) => {
  const unique = new Map(); for (const value of [...pages.flat(), ...(query === '' ? baseline : [])]) if (!unique.has(value.id)) unique.set(value.id, value);
  const ids = new Set(baseline.map(value => value.id));
  return [...unique.values()].sort((a, b) => Number(ids.has(b.id)) - Number(ids.has(a.id)) || a.name.localeCompare(b.name));
};
function harness(options = {}) {
  let slots = [], cursor = 0, effects = [], scheduled = [], output, props = ['host', parent('app'), status('connection')], stateWrites = 0;
  const reads = [], searches = [], writes = [], api = { read: async (p, s) => snapshot([repo(1)], p, s), search: async () => ({ repositories: [found(2)], nextToken: null }),
    save: async (before, selection) => ({ snapshot: { ...before, repositories: selection }, confirmed: true, refreshError: null }), ...options };
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { stateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pluginGithubSyncState.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, AbortController, require: name => {
      if (name === 'react') return react;
      if (name === './chatgptService') return { serviceErrorMessage: error => error?.message || '读取失败，请重试。' };
      if (name === './pluginGithubSync') return { githubSyncScope: scopeOf, buildGithubSyncRepositories: build,
        loadPluginGithubSync: (...args) => { reads.push(args); return api.read(...args); },
        searchPluginGithubSync: (...args) => { searches.push(args); return api.search(...args); },
        savePluginGithubSync: (...args) => { writes.push(args); return api.save(...args); } };
      throw Error(`Unexpected dependency ${name}`);
    } });
  const flush = () => { for (const run of scheduled.splice(0)) run(); };
  const render = (commit = true) => { cursor = 0; output = exports.usePluginGithubSync(...props); if (commit) flush(); return output; };
  const tick = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); render(); } };
  render(); return { api, reads, searches, writes, render, tick, flush, get output() { return output; }, get stateWrites() { return stateWrites; },
    set props(value) { props = value; }, unmount() { for (const effect of effects) effect?.cleanup?.(); } };
}
{
  const h = harness(); await h.tick(); assert.equal(h.output.state.loading, false); assert.equal(h.output.state.repositories.map(value => value.id).join(), '1,2');
  h.output.toggle(2); h.render(); assert.equal(h.output.state.dirty, true); assert.equal(h.output.state.selectedIds.join(), '1,2');
  h.output.cancel(); h.render(); assert.equal(h.output.state.dirty, false); assert.equal(h.writes.length, 0); h.unmount();
}
for (const broken of ['read', 'search']) {
  const h = harness({ [broken]: async () => { throw Error(`${broken} failed`); } }); await h.tick();
  assert.equal(h.output.state.snapshot, null, 'initial config/search commit atomically'); assert.equal(h.output.state.blocked, true); assert.equal(h.output.state.error, `${broken} failed`);
  h.api.read = async (p, s) => snapshot([repo(1)], p, s); h.api.search = async () => ({ repositories: [found(2)], nextToken: null });
  await h.output.reload(); await h.tick(); h.output.toggle(2); h.render();
  h.api[broken] = async () => { throw Error(`later ${broken} failure`); }; const before = h.output.state.snapshot;
  await h.output.reload(); await h.tick(); assert.equal(h.output.state.snapshot, before); assert.equal(h.output.state.selectedIds.join(), '1,2');
  assert.equal(h.output.state.dirty, true); assert.equal(h.output.state.blocked, true); assert.equal(h.writes.length, 0); h.unmount();
}
{
  const h = harness(); await h.tick(); h.output.toggle(2); h.render();
  const old = deferred(); h.api.search = async (_p, _s, query) => query === 'old' ? old.promise : { repositories: [found(3, query)], nextToken: null };
  const first = h.output.submitQuery('  old '); const signal = h.searches.at(-1)[4];
  const latest = h.output.submitQuery(' new '); assert.equal(signal.aborted, true); await latest;
  old.resolve({ repositories: [found(99, 'old')], nextToken: null }); await first; await h.tick();
  assert.equal(h.output.state.query, 'new'); assert.equal(h.output.state.repositories.map(value => value.id).join(), '3');
  assert.equal(h.output.state.selectedIds.join(), '1,2', 'search-hidden draft selections retain their IDs');
  assert.equal(h.output.state.dirty, true); assert.equal(await h.output.save(), true); assert.equal(h.writes[0][1].map(value => value.id).join(), '1,2');
  assert.equal(h.writes[0][1][1].proof.query, '', 'selected old-query repository retains the original proof'); h.unmount();
}
{
  const h = harness({ search: async (_p, _s, _q, token) => token === null ? { repositories: [found(2)], nextToken: '' } : { repositories: [found(3, '', '')], nextToken: '' } });
  await h.tick(); assert.equal(h.output.state.nextToken, ''); await h.output.loadMore(); await h.tick();
  assert.equal(h.searches.at(-1)[3], ''); assert.match(h.output.state.pageError, /分页标记重复/);
  const count = h.searches.length; await h.output.loadMore(); assert.equal(h.searches.length, count, 'repeated opaque token does not loop');
  await h.output.reload(); await h.tick(); assert.equal(h.output.state.pageError, null); assert.equal(h.output.state.nextToken, ''); h.unmount();
}
{
  let pageFails = true;
  const h = harness({ search: async (_p, _s, _q, token) => { if (token === null) return { repositories: [found(2)], nextToken: 'next' };
    if (pageFails) throw Error('Page offline'); return { repositories: [found(3, '', token)], nextToken: null }; } });
  await h.tick(); await h.output.loadMore(); await h.tick(); assert.equal(h.output.state.pageError, 'Page offline'); assert.equal(h.output.state.blocked, false);
  pageFails = false; await h.output.loadMore(); await h.tick(); assert.equal(h.output.state.repositories.map(value => value.id).join(), '1,2,3'); assert.equal(h.output.state.nextToken, null); assert.equal(h.writes.length, 0); h.unmount();
}
{
  const h = harness({ read: async (p, s) => snapshot([repo(1, 'Zulu')], p, s), search: async () => ({ repositories: [found(2, '', null, 'Alpha'), found(1, '', null, 'Updated Zulu')], nextToken: null }) });
  await h.tick(); assert.equal(h.output.state.repositories.map(value => value.name).join(), 'Updated Zulu,Alpha');
  h.output.toggle(1); h.output.toggle(2); h.render(); assert.equal(h.output.state.repositories.map(value => value.name).join(), 'Updated Zulu,Alpha', 'draft selection does not reorder server baseline priority'); h.unmount();
}
{
  const h = harness({ read: async (p, s) => snapshot([1, 2, 3, 4, 5, 6].map(id => repo(id)), p, s), search: async () => ({ repositories: [found(7)], nextToken: null }) });
  await h.tick(); h.output.toggle(7); h.render(); assert.equal(h.output.state.selectedIds.length, 6);
  h.output.toggle(6); h.output.toggle(5); h.output.toggle(7); h.render(); assert.equal(h.output.state.selectedIds.length, 5); assert.equal(h.output.state.selectedIds.includes(7), true);
  assert.equal(await h.output.save(), true); assert.equal(h.writes[0][1].length, 5); h.unmount();
}
{
  const h = harness(); await h.tick(); h.output.toggle(1); h.render(); assert.equal(h.output.state.selectedIds.length, 0); assert.equal(await h.output.save(), false);
  assert.equal(h.writes.length, 0, 'empty selection belongs to the parent disable-confirmation flow'); h.unmount();
}
{
  const h = harness(); await h.tick(); h.output.toggle(2); h.render(); const gate = deferred(); h.api.save = () => gate.promise;
  const pending = h.output.save(); assert.equal(await h.output.save(), false); h.output.toggle(1); h.output.cancel();
  const reads = h.reads.length; await h.output.reload(); assert.equal(h.reads.length, reads); assert.equal(h.writes[0][2].aborted, false);
  gate.resolve({ snapshot: snapshot([repo(1), repo(2)]), confirmed: true, refreshError: null }); assert.equal(await pending, true); await h.tick();
  assert.equal(h.output.state.dirty, false); assert.equal(h.output.state.pending, false); assert.equal(h.writes.length, 1); h.unmount();
}
for (const actual of [null, snapshot([repo(1)]), snapshot([repo(1), repo(2)])]) {
  const h = harness(); await h.tick(); h.output.toggle(2); h.render(); h.api.save = async () => ({ snapshot: actual, confirmed: false, refreshError: 'Unconfirmed delivery' });
  assert.equal(await h.output.save(), false); await h.tick(); assert.equal(h.output.state.uncertain, true); assert.equal(h.output.state.dirty, true);
  h.output.cancel(); h.output.toggle(1); h.render(); assert.equal(h.output.state.selectedIds.join(), '1,2'); assert.equal(await h.output.save(), false);
  h.api.read = async (p, s) => snapshot([repo(1)], p, s); await h.output.reload(); await h.tick(); assert.equal(h.output.state.uncertain, true); assert.equal(h.output.state.blocked, true);
  h.api.read = async (p, s) => snapshot([repo(1), repo(2)], p, s); await h.output.reload(); await h.tick();
  assert.equal(h.output.state.uncertain, false); assert.equal(h.output.state.dirty, false); assert.equal(h.output.state.blocked, false); assert.equal(h.writes.length, 1); h.unmount();
}
for (const code of ['forbidden', 'invalid_request', 'not_found', 'cancelled', 'account_changed', 'github_sync_scope_changed']) {
  const h = harness(); await h.tick(); h.output.toggle(2); h.render(); h.api.save = async () => { throw { code, message: `Failure ${code}` }; };
  assert.equal(await h.output.save(), false); await h.tick(); const uncertain = ['cancelled', 'account_changed', 'github_sync_scope_changed'].includes(code);
  assert.equal(h.output.state.uncertain, uncertain); assert.equal(h.output.state.blocked, uncertain); assert.equal(h.output.state.dirty, true); assert.equal(h.output.state.saveError, `Failure ${code}`); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick(); h.output.toggle(2); h.render(); const staleSave = h.output.save;
  h.api.save = () => gate.promise; const pending = h.output.save();
  h.props = ['host', parent('other-app'), status('other-connection')]; assert.equal(h.render(false).state.snapshot, null); h.flush(); await h.tick();
  assert.equal(h.writes[0][2].aborted, true); h.props = ['host', parent('app'), status('connection')]; h.render(); await h.tick();
  gate.resolve({ snapshot: snapshot([repo(1), repo(2)]), confirmed: true, refreshError: null }); assert.equal(await pending, false); await h.tick();
  assert.equal(h.output.state.selectedIds.join(), '1'); assert.equal(await staleSave(), false); assert.equal(h.writes.length, 1); h.unmount();
}
{
  const gate = deferred(), h = harness(); await h.tick(); h.output.toggle(2); h.render(); h.api.save = () => gate.promise;
  const pending = h.output.save(); h.unmount(); assert.equal(h.writes[0][2].aborted, true); const count = h.stateWrites;
  gate.reject({ code: 'cancelled' }); assert.equal(await pending, false); h.output.cancel(); h.output.toggle(1); assert.equal(h.stateWrites, count); h.unmount();
}
{
  const h = harness({ search: async () => ({ repositories: [repo(2)], nextToken: null }) }); await h.tick(); h.output.toggle(2); h.render();
  assert.equal(await h.output.save(), false); h.render(); assert.match(h.output.state.saveError, /来源/); assert.equal(h.writes.length, 0, 'new IDs without search proof are not posted'); h.unmount();
}
{
  const gate = deferred(), h = harness({ read: () => gate.promise }); const oldReload = h.output.reload;
  h.props = ['other-host', parent('other'), status('other')]; h.api.read = async (p, s) => snapshot([repo(9)], p, s); h.render(); await h.tick();
  gate.resolve(snapshot([repo(1)])); await h.tick(); assert.equal(h.output.state.snapshot.parent.appId, 'other');
  const count = h.reads.length; await oldReload(); assert.equal(h.reads.length, count); h.unmount();
}
{
  const firstGate = deferred(), nextGate = deferred(), h = harness(); await h.tick(); h.output.toggle(2); h.render(); h.api.save = () => firstGate.promise;
  const first = h.output.save(); h.props = ['host', parent('other'), status('other')]; h.render(); await h.tick(); h.output.toggle(2); h.render();
  h.api.save = () => nextGate.promise; const next = h.output.save(); firstGate.reject(Error('Old write failed')); assert.equal(await first, false); await h.tick();
  assert.equal(h.output.state.pending, true); assert.equal(await h.output.save(), false, 'old finally cannot release a new scope write');
  const before = h.writes[1][0]; nextGate.resolve({ snapshot: { ...before, repositories: [repo(1), repo(2)] }, confirmed: true, refreshError: null }); assert.equal(await next, true); h.unmount();
}
{
  const h = harness(); await h.tick(); h.output.toggle(2); h.render();
  h.api.save = async () => ({ snapshot: snapshot([repo(1), repo(2)], parent('other-app')), confirmed: true, refreshError: null });
  assert.equal(await h.output.save(), false); await h.tick(); assert.equal(h.output.state.snapshot.parent.appId, 'app');
  assert.equal(h.output.state.uncertain, true); assert.equal(h.output.state.blocked, true); assert.equal(h.writes.length, 1); h.unmount();
}
{
  const gate = deferred(), h = harness({ search: () => gate.promise }); h.unmount(); const count = h.stateWrites;
  assert.equal(h.searches[0][4].aborted, true); gate.resolve({ repositories: [found(2)], nextToken: null }); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.stateWrites, count); assert.equal(await h.output.save(), false); h.unmount();
}
console.log('GitHub sync real hook: atomic reads, draft/proof preservation, query/page isolation, opaque token safety, baseline ordering, five-cap, confirmed save and unknown read-only recovery passed.');
