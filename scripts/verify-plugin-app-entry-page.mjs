import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const app = (name = '真实远端应用', extra = {}) => ({ kind: 'app', appId: 'app-A', identity: { accountId: 'account-A' },
  app: { id: 'app-A', name, description: '真实 hosted 说明', logoUrl: null, logoUrlDark: null }, connector: {}, metadataError: null, ...extra });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('');
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label);
function harness(read = async () => app()) {
  let slots = [], cursor = 0, effects = [], scheduled = [], output, writes = 0;
  let redirects = [], deletions = [], roots = 0, props = { connectionIdentity: 'connection-A', appId: 'app-A', isCurrent: () => api.routeCurrent, onResolvePlugin: id => redirects.push(id), onRoot: () => roots++, onDeleted: async identity => { deletions.push(identity); } };
  const calls = [], api = { read, routeCurrent: true };
  const react = {
    useId: () => 'hosted-description',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), Fragment: 'Fragment',
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/PluginAppEntryPage.tsx', 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText, { exports, AbortController, require: name => {
    if (name === 'react') return react;
    if (name === '../pluginAppEntry') return { loadPluginAppEntry: (...args) => { calls.push(args); return api.read(...args); } };
    if (name === '../chatgptService') return { serviceErrorMessage: error => error?.message || '读取失败' };
    if (name === './PluginAppManagementSection') return { PluginAppManagementSection: 'AppManagementSection' };
    if (name === './PluginDirectoryDetail') return { usePluginDetailExpansion: (identity, lines) => { assert.equal(lines, 3); return { expanded: false, overflowing: false, maxHeight: 48, fullHeight: 48, ref: { current: null }, toggle() {} }; } };
    if (name.endsWith('.css')) return {};
    throw Error(name);
  } });
  const flush = () => { for (const run of scheduled.splice(0)) run(); };
  const render = (commit = true) => { cursor = 0; output = exports.PluginAppEntryPage(props); if (commit) flush(); return output; };
  const tick = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); } };
  render();
  return { api, calls, render, flush, tick, get output() { return output; }, get redirects() { return redirects; }, get deletions() { return deletions; }, get roots() { return roots; }, get writes() { return writes; },
    set props(value) { props = { ...props, ...value }; }, unmount() { for (const entry of effects) entry?.cleanup?.(); } };
}
{
  const h = harness(); assert.ok(nodes(h.output).some(node => node.props.role === 'status'));
  assert.equal(nodes(h.output).some(node => node.type === 'h1'), false);
  await h.tick(); const tree = h.output;
  assert.equal(text(nodes(tree).find(node => node.type === 'h1')), '真实远端应用');
  assert.match(text(tree), /真实 hosted 说明/);
  assert.equal(nodes(tree).find(node => node.type === 'nav').props['aria-label'], '面包屑导航');
  assert.equal(text(nodes(tree).find(node => node.props['aria-current'] === 'page')), '真实远端应用');
  assert.deepEqual(nodes(tree).filter(node => node.type === 'button').map(text), ['插件设置'], 'header does not invent linked account, permissions or sync controls');
  const section = nodes(tree).find(node => node.type === 'AppManagementSection');
  assert.equal(section.props.appId, 'app-A'); assert.equal(section.props.isCurrent(), true);
  const deletedIdentity = { accountId: 'account-A', userId: 'user-A', generation: 3 };
  await section.props.onDeleted(deletedIdentity); assert.equal(h.deletions[0], deletedIdentity, 'deletion carries the exact initiating identity to the real root refresh');
  assert.equal(nodes(tree).some(node => ['input', 'select', 'img', 'section'].includes(node.type)), false, 'standalone header has no plugin ancestor, invented asset or management form');
  button(tree, '插件设置').props.onClick(); assert.equal(h.roots, 1); assert.equal(h.redirects.length, 0); h.unmount();
}
{
  const h = harness(async () => ({ kind: 'plugin', pluginId: 'real@market' })); await h.tick();
  assert.deepEqual(h.redirects, ['real@market']); assert.equal(nodes(h.output).some(node => node.type === 'h1'), false); h.unmount();
}
{
  const h = harness(async () => { throw Error('关联读取失败'); }); await h.tick();
  assert.match(text(h.output), /关联读取失败/); assert.equal(h.redirects.length, 0);
  assert.equal(nodes(h.output).some(node => node.type === 'h1'), false, 'association failure never becomes a null-association fallback');
  h.api.read = async () => app(); button(h.output, '重试').props.onClick(); await h.tick();
  assert.equal(h.calls.length, 2); assert.equal(text(nodes(h.output).find(node => node.type === 'h1')), '真实远端应用'); h.unmount();
}
{
  const h = harness(async () => app('保留标题', { connector: null, metadataError: { code: 'offline', message: 'private backend detail' } })); await h.tick();
  assert.match(text(h.output), /保留标题/); assert.match(text(h.output), /无法加载插件设置/); assert.equal(text(h.output).includes('private backend detail'), false);
  assert.equal(nodes(h.output).some(node => node.type === 'AppManagementSection'), false, 'failed metadata does not authorize a management surface');
  const gate = deferred(); h.api.read = () => gate.promise;
  button(h.output, '重试').props.onClick(); h.render(); assert.match(text(h.output), /保留标题/); assert.equal(button(h.output, '重试').props.disabled, true);
  gate.reject(Error('刷新失败')); await h.tick(); assert.match(text(h.output), /保留标题/); assert.match(text(h.output), /刷新失败/); h.unmount();
}
{
  const gate = deferred(), h = harness(() => gate.promise), oldRoot = button(h.output, '插件设置').props.onClick;
  h.props = { connectionIdentity: 'connection-B', appId: 'app-B' }; h.api.read = async () => app('B', { appId: 'app-B' });
  assert.equal(nodes(h.render(false)).some(node => node.type === 'h1'), false, 'scope change hides old data before effects'); h.flush();
  assert.equal(h.calls[0][1].aborted, true); await h.tick(); gate.resolve({ kind: 'plugin', pluginId: 'stale-owner' }); await h.tick();
  assert.equal(h.redirects.length, 0); assert.match(text(h.output), /B/); oldRoot(); assert.equal(h.roots, 0); h.unmount();
}
{
  const h = harness(async () => { throw Error('initial failure'); }); await h.tick(); const staleRetry = button(h.output, '重试').props.onClick;
  const gate = deferred(); h.api.read = () => gate.promise; staleRetry(); h.render();
  h.props = { connectionIdentity: 'connection-B' }; h.api.read = async () => app('B'); h.render(); await h.tick();
  h.props = { connectionIdentity: 'connection-A' }; h.api.read = async () => app('new-A');
  assert.equal(nodes(h.render(false)).some(node => node.type === 'h1'), false, 'ABA does not revive old A header'); h.flush(); await h.tick();
  gate.resolve({ kind: 'plugin', pluginId: 'stale-A-owner' }); await h.tick(); assert.match(text(h.output), /new-A/); assert.equal(h.redirects.length, 0);
  const count = h.calls.length; staleRetry(); await h.tick(); assert.equal(h.calls.length, count, 'retired A handler remains retired after ABA'); h.unmount();
}
{
  const gate = deferred(), h = harness(() => gate.promise); const root = button(h.output, '插件设置').props.onClick;
  h.unmount(); assert.equal(h.calls[0][1].aborted, true); const writes = h.writes;
  gate.resolve({ kind: 'plugin', pluginId: 'late-owner' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.writes, writes); assert.equal(h.redirects.length, 0); root(); assert.equal(h.roots, 0);
}
{
  const gate = deferred(), h = harness(() => gate.promise); const latest = [];
  h.props = { onResolvePlugin: id => latest.push(id) }; h.render(); gate.resolve({ kind: 'plugin', pluginId: 'current-owner' }); await h.tick();
  assert.deepEqual(latest, ['current-owner']); assert.equal(h.redirects.length, 0, 'same-scope completion uses current parent callback'); h.unmount();
}
{
  const h = harness(); await h.tick();
  const section = nodes(h.output).find(node => node.type === 'AppManagementSection');
  h.api.read = async () => app('真实刷新后的hosted标题');
  await section.props.onUpdated(); await h.tick(); assert.match(text(h.output), /真实刷新后的hosted标题/);
  h.api.read = async () => { throw Error('readback header failed'); };
  await assert.rejects(section.props.onUpdated(), /无法重新加载/); await h.tick();
  assert.match(text(h.output), /真实刷新后的hosted标题/); assert.match(text(h.output), /readback header failed/);
  h.api.routeCurrent = false; const count = h.calls.length;
  await assert.rejects(section.props.onUpdated(), /无法重新加载/); assert.equal(h.calls.length, count); h.unmount();
}
{
  const gate = deferred(), h = harness(() => gate.promise), root = button(h.output, '插件设置').props.onClick;
  h.api.routeCurrent = false;
  root(); assert.equal(h.roots, 0, 'URL retirement blocks callbacks before the parent rerenders');
  gate.resolve({ kind: 'plugin', pluginId: 'retired-route' }); await h.tick();
  assert.equal(h.redirects.length, 0); h.unmount();
}
console.log('Standalone plugin app entry: real component and hooks, association redirect/null/error, hosted header, independent metadata retry, scope/ABA/stale handlers and unmount passed. Full ManageApp writes and paired native pixels remain unverified.');
