import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const slots = [], effects = [], queue = [], requests = [], contexts = [];
let cursor = 0, dirty = false, backs = 0, selected = 0, renamed = 0, disconnected = 0, sync = 0, directory = 0;
const openedApps = [];
const react = {
  Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
  useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }]; },
  useEffect(callback, deps) { const index = cursor++, before = effects[index]; if (!before || deps.some((value, i) => value !== before.deps[i])) queue.push(() => { before?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
  useLayoutEffect(callback, deps) { react.useEffect(callback, deps); },
};
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/PluginCanonicalRootPage.tsx', 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText, { exports, AbortController, require(name) {
  if (name === 'react') return react;
  if (name === './PluginAppDetailsPage') return { PluginAppDetailsPage: 'PluginAppDetailsPage' };
  if (name === './GenericPluginManagementPage') return { GenericPluginManagementPage: 'GenericPluginManagementPage' };
  if (name === '../pluginCanonicalRoot') return { loadPluginCanonicalRoot: (id, signal) => new Promise((resolve, reject) => { requests.push({ id, signal, resolve, reject }); }) };
  throw Error(name);
} });
const { PluginCanonicalRootPage } = exports;
const props = { connectionIdentity: 'account-A', pluginId: 'plugin-real', selectedLinkId: 'link-a', onOpenApp: id => openedApps.push(id),
  onBack: () => backs++, onSelectLink: () => { selected++; return true; }, onRenamed: () => renamed++, onDisconnected: () => disconnected++,
  onSync: () => sync++, onViewDetails: () => directory++, renderCanonicalActions: context => { contexts.push(context); return 'actual-actions'; } };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('');
const render = () => { let tree, count = 0; do { assert.ok(count++ < 15); dirty = false; cursor = 0; tree = PluginCanonicalRootPage(props); queue.splice(0).forEach(run => run()); } while (dirty); return tree; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); return render(); };
const snapshot = (kind = 'canonical', extra = {}) => ({ kind, pluginId: props.pluginId, appId: kind === 'canonical' ? 'asdk_app_real' : null,
  pluginHeader: { id: props.pluginId, name: '真实插件', version: '1.2', shortDescription: ' 官方短说明 ', logoUrl: 'https://example.test/plugin.png', logoUrlDark: null },
  hostedApp: { name: '真实Hosted App', description: '真实介绍', logoUrl: null, logoUrlDark: null }, hostedError: null, nativeEligibility: 'unverified',
  identity: { accountId: 'account', userId: 'user', generation: 1 },
  genericSource: kind === 'generic' ? { plugin: { id: props.pluginId }, installedPlugin: null } : null,
  genericDetail: kind === 'generic' ? { summary: { id: props.pluginId }, skills: [] } : null,
  genericUsage: kind === 'generic' ? [{ id: 'actual-app', template: null }] : [], setupEligibleAppTemplateIds: [], ...extra });
let tree = render(); assert.equal(requests.length, 1); assert.equal(requests[0].id, props.pluginId); assert.equal(tree.props['aria-busy'], true);
assert.ok(nodes(tree).some(node => node.props.role === 'status')); assert.equal(nodes(tree).some(node => node.type === 'ActualGenericPluginDetails'), false, 'pending cannot assume generic or canonical');
nodes(tree).find(node => node.type === 'button').props.onClick(); assert.equal(backs, 1);
const genericSnapshot = snapshot('generic');
requests[0].resolve(genericSnapshot); tree = await flush(); assert.equal(tree.type, 'GenericPluginManagementPage');
assert.equal(tree.props.snapshot, genericSnapshot); assert.equal(tree.props.isCurrent(), true);
tree.props.onOpenApp('actual-app'); tree.props.onOpenApp('foreign-app');
assert.deepEqual(openedApps, ['actual-app'], 'only actual service usage may open an App');
assert.equal(contexts.at(-1).snapshot, genericSnapshot, 'management actions receive the same trusted root snapshot');
assert.equal(nodes(tree).some(node => node.type === 'PluginAppDetailsPage'), false);
const oldGeneric = tree;

props.pluginId = 'canonical-plugin'; render(); assert.equal(requests.length, 2); assert.equal(requests[0].signal.aborted, true);
oldGeneric.props.onOpenApp('actual-app'); assert.equal(oldGeneric.props.isCurrent(), false);
assert.deepEqual(openedApps, ['actual-app'], 'retired generic pages cannot navigate');
const actual = snapshot(); requests[1].resolve(actual); tree = await flush(); assert.equal(tree.type, 'PluginAppDetailsPage');
assert.equal(tree.props.appId, actual.appId); assert.equal(tree.props.pluginId, props.pluginId); assert.equal(tree.props.selectedLinkId, 'link-a');
assert.equal(tree.props.canonicalRoot.pluginHeader, actual.pluginHeader); assert.equal(tree.props.canonicalRoot.hostedApp, actual.hostedApp);
tree.props.onBack(); tree.props.onSelectLink('link-b'); tree.props.onRenamed(); tree.props.onDisconnected(); tree.props.onSync('link-a'); tree.props.onViewDetails();
assert.deepEqual([backs, selected, renamed, disconnected, sync, directory], [2, 1, 1, 1, 1, 1]);
let childCurrent = true;
tree.props.renderCanonicalActions({ blocked: false, accountCount: 2, isCurrent: () => childCurrent });
const oldContext = contexts.at(-1); assert.equal(oldContext.blocked, false); assert.equal(oldContext.accountCount, 2); assert.equal(oldContext.isCurrent(), true);
childCurrent = false; assert.equal(oldContext.isCurrent(), false, 'child details eligibility remains required'); childCurrent = true;
const oldPage = tree;
oldPage.props.onUnavailable(); assert.equal(requests.length, 3); assert.equal(oldContext.isCurrent(), false, 'root reload invalidates actions before the next render');
oldPage.props.onUnavailable(); oldPage.props.onOpenPlugin(); oldPage.props.onBack(); oldPage.props.onSync('link-a'); assert.equal(oldPage.props.onSelectLink('link-a'), false);
assert.equal(requests.length, 3); assert.equal(backs, 2); assert.equal(sync, 1); assert.equal(selected, 1);
tree = render(); assert.equal(tree.props['aria-busy'], true); assert.equal(nodes(tree).some(node => node.type === 'PluginAppDetailsPage'), false);
requests[2].resolve(snapshot('generic')); tree = await flush(); assert.equal(tree.type, 'GenericPluginManagementPage', 'membership loss rereads real generic service details on the same root URL');

props.pluginId = 'error-plugin'; render(); const failure = requests.at(-1); failure.reject(new Error('private service details')); tree = await flush();
assert.match(text(tree), /无法加载插件设置/); assert.equal(text(tree).includes('private service details'), false); assert.ok(nodes(tree).some(node => node.props.role === 'alert'));
const retry = nodes(tree).find(node => node.type === 'button' && text(node) === '重试'); const beforeRetry = requests.length;
retry.props.onClick(); retry.props.onClick(); assert.equal(requests.length, beforeRetry + 1, 'one retry starts one actual root read'); render();
requests.at(-1).resolve(snapshot()); tree = await flush(); assert.equal(tree.type, 'PluginAppDetailsPage');
const previousCount = requests.length; tree.props.onOpenPlugin(); assert.equal(requests.length, previousCount + 1, 'opening the same plugin refreshes root dispatch without URL navigation'); render();
requests.at(-1).resolve(snapshot()); tree = await flush();

props.connectionIdentity = 'scope-A'; render(); const staleA = requests.at(-1);
props.connectionIdentity = 'scope-B'; render(); const staleB = requests.at(-1); assert.equal(staleA.signal.aborted, true);
props.connectionIdentity = 'scope-A'; render(); const currentA = requests.at(-1); assert.equal(staleB.signal.aborted, true);
staleA.resolve(snapshot('canonical', { appId: 'asdk_app_stale-A' })); staleB.reject(new Error('stale B'));
tree = await flush(); assert.equal(tree.type, 'article'); assert.equal(tree.props['aria-busy'], true, 'ABA cannot publish old canonical or error state');
currentA.resolve(snapshot()); tree = await flush(); assert.equal(tree.type, 'PluginAppDetailsPage'); assert.equal(tree.props.appId, 'asdk_app_real');

const beforeRefresh = tree;
props.refreshRevision = 1; tree = render();
assert.equal(tree.props['aria-busy'], true, 'same-URL external refresh retires the old root snapshot');
beforeRefresh.props.onViewDetails(); assert.equal(directory, 1, 'old root actions cannot survive an external refresh');
const refreshedRequest = requests.at(-1); assert.equal(currentA.signal.aborted, true);
refreshedRequest.resolve(snapshot()); tree = await flush(); assert.equal(tree.type, 'PluginAppDetailsPage');
tree.props.renderCanonicalActions({ blocked: false, accountCount: 1, isCurrent: () => true }); const unmountContext = contexts.at(-1);
const unmountedPage = tree; unmountedPage.props.onOpenPlugin(); const retryOnUnmount = requests.at(-1); const beforeUnmount = requests.length;
assert.equal(retryOnUnmount.signal.aborted, false); effects.forEach(effect => effect?.cleanup?.());
assert.equal(retryOnUnmount.signal.aborted, true, 'unmount must abort the latest same-scope retry, not only the effect initial request');
assert.equal(currentA.signal.aborted, true); assert.equal(unmountContext.isCurrent(), false); unmountedPage.props.onOpenPlugin(); assert.equal(requests.length, beforeUnmount);
assert.equal(unmountedPage.props.onSelectLink('link-a'), false);
console.log('Canonical root page: trusted generic service snapshot and usage navigation, canonical App/header delegation, retry and same-URL refresh, synchronous stale-action guards, abort, connection/plugin scope, ABA and unmount passed. Official pixels/native UI are unverified.');
