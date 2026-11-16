import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
function load(file, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, ...globals, require(name) {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.endsWith('.css')) return {};
    throw Error(`Unexpected import ${name}`);
  } });
  return exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const element = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(nodes)];
const text = node => !node || typeof node !== 'object' ? typeof node === 'string' ? node : '' : (node.children || []).map(text).join('');
const identity = { accountId: 'account-A', userId: 'user-A', generation: 7 };
const oneTemplateUrl = 'https://chatgpt.com/plugins/local%2Fraw%40openai-curated-remote?no_universal_links=1#settings/Plugins/local%2Fraw%40openai-curated-remote?product-sku=CODEX';
const template = (id, materializedAppIds = []) => ({ templateId: id, name: `Raw ${id}`, materializedAppIds, description: null });
const makeDetail = (overrides = {}) => ({ marketplaceName: 'original', marketplacePath: 'D:/original/marketplace.json',
  summary: { id: 'local@original', name: 'local', source: { type: 'local', path: 'D:/original/local' },
    installed: true, enabled: true, remotePluginId: 'local/raw@openai-curated-remote', availability: 'AVAILABLE' },
  apps: [], appTemplates: [template('template-A')], skills: [], hooks: [], mcpServers: [], ...overrides });
const snap = (detail, overrides = {}) => ({ templates: detail.appTemplates, remotePluginId: detail.summary.remotePluginId,
  eligibleTemplateIds: detail.appTemplates.map(item => item.templateId), identity, warnings: [], hideImplicitApp: false, ...overrides });
// Only the URL helper is real here. The data loader's protocol/identity contract is
// independently covered by verify-plugin-local-templates; this suite owns the UI.
const urls = load('src/pluginLocalTemplates.ts', {
  './config': {}, './chatgptService': {}, './plugins': {},
}, { URL });
function mount(detail = makeDetail(), { read, bridge, onRefresh } = {}) {
  let props = { detail, identity: 'connection-A', blocked: false, onRefresh: onRefresh || (async () => { refreshes++; }) };
  let cursor = 0, tree, alive = true, lateSets = 0, refreshes = 0;
  const slots = [], effects = [], scheduled = [], reads = [], opens = [], events = new Map();
  const react = { createElement: element,
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { if (!alive) lateSets++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i];
      if (!old || deps.some((value, index) => value !== old.deps[index])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const window = { addEventListener(name, callback) { const listeners = events.get(name) || new Set(); listeners.add(callback); events.set(name, listeners); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); } };
  const { LocalPluginApps: Component } = load('src/components/LocalPluginApps.tsx', {
    react, 'lucide-react': { Boxes: 'Boxes', ChevronRight: 'ChevronRight' },
    '../bridge': { tauriInvoke: async (method, parameters) => { opens.push([method, parameters]); return bridge?.(method, parameters); } },
    '../pluginLocalTemplates': { localPluginTemplateManagementUrl: urls.localPluginTemplateManagementUrl,
      loadLocalPluginTemplates: async (...args) => { reads.push(args); return read ? read(args[0], args[1], args[2], reads.length) : snap(args[0]); } },
    './PluginTemplateRows': { PluginTemplateRows: 'TemplateRows' },
  }, { AbortController, window });
  const render = next => { if (next) props = { ...props, ...next }; cursor = 0; tree = Component(props); for (const run of scheduled.splice(0)) run(); return tree; };
  const tick = async () => { for (let i = 0; i < 40; i++) { await Promise.resolve(); if (alive) render(); } };
  const focus = () => { for (const callback of [...events.get('focus') || []]) callback(); };
  render();
  return { reads, opens, render, tick, focus, tree: () => tree, props: () => props,
    rows: () => nodes(tree).find(node => node.type === 'TemplateRows'),
    refreshes: () => refreshes, lateSets: () => lateSets,
    unmount() { alive = false; for (const effect of effects) effect?.cleanup?.(); },
    listenerCount: () => [...events.values()].reduce((sum, listeners) => sum + listeners.size, 0),
  };
}

{
  const pending = deferred(), detail = makeDetail(), view = mount(detail, { read: () => pending.promise });
  assert.equal(text(nodes(view.tree()).find(node => node.props.className === 'local-plugin-apps-title')), '使用的应用', 'BSnr.Header renders the plain title in its generic div');
  assert.equal(nodes(view.tree()).some(node => node.type === 'h2'), false, 'the source header does not introduce a heading role');
  assert.equal(nodes(view.tree()).some(node => node.props.className === 'pm-detail-included-count'), false, 'header does not invent a numeric badge');
  assert.match(text(view.tree()), /正在加载设置…/);
  assert.equal(view.rows().props.templates[0], detail.appTemplates[0], 'pending metadata keeps the original template row');
  assert.equal(view.rows().props.managementUrl('template-A'), null, 'pending eligibility grants no management link');
  const initialNodes = nodes(view.tree());
  assert.ok(initialNodes.findIndex(node => node.props.role === 'status') < initialNodes.findIndex(node => node.type === 'section'), 'loading precedes the Uses section');
  assert.ok(initialNodes.some(node => Object.hasOwn(node.props, 'data-loading-indicator')));
  assert.equal(view.reads[0][0], detail); assert.equal(view.reads[0][2], undefined);
  pending.resolve(snap(detail, { warnings: ['应用元数据读取失败：private fixture'] })); await view.tick();
  assert.equal(view.rows().props.templates[0].name, 'Raw template-A');
  assert.match(text(view.tree()), /应用元数据读取失败/);
  assert.equal(view.rows().props.managementUrl('template-A'), oneTemplateUrl);
  view.unmount();
}
{
  const detail = makeDetail({ appTemplates: [template('unmaterialized'), template('already', ['real-app'])] });
  const view = mount(detail); await view.tick();
  const href = view.rows().props.managementUrl('unmaterialized');
  assert.equal(new URL(href).hash, '', 'URL counts all raw templates, not only the unmaterialized row');
  view.render({ blocked: true }); assert.equal(view.rows().props.managementUrl('unmaterialized'), null);
  view.unmount();
}
{
  const detail = makeDetail(); let refreshes = 0, view;
  view = mount(detail, { read: (actual, _signal, _identity, count) => count === 1 ? Promise.reject(Error('private initial failure')) : snap(actual),
    onRefresh: async () => { refreshes++; view.render({ detail: { ...detail } }); } }); await view.tick();
  assert.match(text(view.tree()), /无法加载插件设置/);
  assert.doesNotMatch(text(view.tree()), /private initial failure/, 'the source error label does not expose raw RPC details');
  assert.equal(view.rows().props.templates[0], detail.appTemplates[0], 'failed metadata keeps the original template row');
  assert.equal(view.rows().props.managementUrl('template-A'), null);
  const retry = nodes(view.tree()).find(node => node.type === 'button' && text(node) === '重试');
  await retry.props.onClick(); await view.tick();
  assert.equal(refreshes, 1, 'error recovery delegates to the parent original-source plugin read');
  assert.ok(view.rows(), 'a new successful source detail read actually recovers the section');
  assert.doesNotMatch(text(view.tree()), /无法加载插件设置/);
  assert.equal(view.opens.length, 0); view.unmount();
}
{
  const detail = makeDetail(), ack = deferred(), view = mount(detail, { bridge: () => ack.promise }); await view.tick();
  const manage = view.rows().props.onManage;
  const first = manage('template-A'), second = manage('template-A'); await view.tick();
  assert.equal(view.reads.length, 2, 'one fresh eligibility read for repeated clicks');
  assert.equal(view.reads[1][0], detail); assert.equal(view.reads[1][2], identity, 'click verification preserves original account/generation');
  assert.equal(view.opens.length, 1); assert.equal(view.opens[0][0], 'review_link_open');
  assert.equal(view.opens[0][1].url, oneTemplateUrl);
  view.focus(); assert.equal(view.refreshes(), 0, 'focus before open ACK cannot report completion');
  ack.resolve(); await Promise.all([first, second]); await view.tick();
  assert.deepEqual(view.rows().props.templates[0].materializedAppIds, [], 'open ACK never creates a local instance');
  view.focus(); await view.tick(); assert.equal(view.refreshes(), 1);
  view.focus(); await view.tick(); assert.equal(view.refreshes(), 1, 'one pending return read is consumed once');
  assert.equal(view.opens.length, 1, 'return refresh never repeats the external action');
  view.unmount();
}
{
  const detail = makeDetail(), view = mount(detail, { read: (actual, _signal, _identity, count) => snap(actual, count > 1 ? { eligibleTemplateIds: [] } : {}) });
  await view.tick(); await view.rows().props.onManage('template-A'); await view.tick();
  assert.equal(view.opens.length, 0, 'fresh can_setup revocation cannot open an old eligible URL');
  assert.match(text(view.tree()), /当前无法管理/); view.unmount();
}
{
  const detail = makeDetail(), view = mount(detail, { bridge: () => Promise.reject(Error('private bridge failure')) });
  await view.tick(); await view.rows().props.onManage('template-A'); await view.tick();
  assert.match(text(view.tree()), /无法打开应用管理/); view.focus(); await view.tick();
  assert.equal(view.refreshes(), 0); assert.equal(view.opens.length, 1); view.unmount();
}
{
  let attempts = 0;
  const detail = makeDetail(), view = mount(detail, { onRefresh: async () => {
    if (++attempts === 1) throw Error('private return read failure');
  } });
  await view.tick(); await view.rows().props.onManage('template-A'); await view.tick();
  view.focus(); await view.tick(); assert.match(text(view.tree()), /应用状态刷新失败/);
  view.focus(); await view.tick(); assert.equal(attempts, 1, 'failed return is not an automatic refocus loop');
  nodes(view.tree()).find(node => node.type === 'button' && text(node) === '重试').props.onClick(); await view.tick();
  assert.equal(attempts, 2, 'explicit return recovery is read-only');
  assert.equal(view.opens.length, 1, 'return read recovery cannot reopen or instantiate'); view.unmount();
}
{
  const detail = makeDetail(); let view;
  const materialized = { ...detail, apps: [{ id: 'real-materialized', name: 'Real materialized App' }],
    appTemplates: [template('template-A', ['real-materialized'])] };
  view = mount(detail, { onRefresh: async () => { view.render({ detail: materialized }); } });
  await view.tick(); await view.rows().props.onManage('template-A'); await view.tick();
  assert.equal(view.rows().props.templates[0].materializedAppIds.length, 0);
  view.focus(); await view.tick();
  assert.equal(view.reads.at(-1)[0], materialized, 'materialization comes only from a new source detail read');
  assert.equal(view.rows().props.templates[0].materializedAppIds[0], 'real-materialized');
  assert.match(text(view.tree()), /Real materialized App/); assert.equal(view.opens.length, 1); view.unmount();
}
for (const stage of ['initial', 'fresh', 'bridge']) {
  const detail = makeDetail(), old = deferred();
  const view = mount(detail, { read: (actual, _signal, _identity, count) => stage === 'initial' && count === 1 || stage === 'fresh' && count === 2 ? old.promise : snap(actual),
    bridge: () => stage === 'bridge' ? old.promise : undefined });
  let manage;
  if (stage !== 'initial') { await view.tick(); manage = view.rows().props.onManage('template-A'); await view.tick(); }
  const different = makeDetail({ marketplacePath: 'D:/other/marketplace.json' });
  view.render({ detail: different, identity: 'connection-B' }); await view.tick();
  view.render({ detail, identity: 'connection-A' }); await view.tick();
  const reads = view.reads.length, opens = view.opens.length;
  old.resolve(snap(detail)); if (manage) await manage; await view.tick(); view.focus(); await view.tick();
  assert.equal(view.reads.length, reads); assert.equal(view.opens.length, opens);
  assert.equal(view.refreshes(), 0, `${stage} A-B-A late result cannot refresh a different page`);
  assert.ok(view.rows(), `${stage} stale completion cannot replace the new scope snapshot with a loading state`);
  assert.equal(view.rows().props.managementUrl('template-A'), oneTemplateUrl);
  view.unmount();
}
for (const stage of ['initial', 'fresh', 'bridge']) {
  const detail = makeDetail(), old = deferred();
  const view = mount(detail, { read: (actual, _signal, _identity, count) => stage === 'initial' || stage === 'fresh' && count === 2 ? old.promise : snap(actual),
    bridge: () => stage === 'bridge' ? old.promise : undefined });
  let manage;
  if (stage !== 'initial') { await view.tick(); manage = view.rows().props.onManage('template-A'); await view.tick(); }
  view.unmount(); old.resolve(snap(detail)); if (manage) await manage; await view.tick(); view.focus();
  assert.equal(view.lateSets(), 0, `${stage} late completion must not set state after unmount`);
  assert.equal(view.refreshes(), 0); assert.equal(view.listenerCount(), 0);
}
{
  const detail = makeDetail({ apps: [{ id: 'real-app', name: 'Actual app' }], appTemplates: [],
    summary: { ...makeDetail().summary, installPolicySource: 'IMPLICIT_CANONICAL_APP' } });
  const pending = deferred(), view = mount(detail, { read: () => pending.promise });
  assert.match(text(view.tree()), /Actual app/, 'unknown tools must not hide the actual app');
  pending.resolve(snap(detail, { hideImplicitApp: true })); await view.tick();
  assert.equal(view.tree(), null, 'confirmed fresh empty-tool result removes only the implicit app'); view.unmount();
}

// One integration pass runs the production enrichment helper as well as the component.
const pluginParsing = load('src/plugins.ts', { './bridge': { callAppServer() { throw Error('Unexpected protocol call'); } } });
function actualLoader({ metadata, directory } = {}) {
  return load('src/pluginLocalTemplates.ts', {
    './config': { accountRead: async () => ({ account: { type: 'chatgpt' } }) },
    './chatgptService': { serviceIdentity: async () => identity,
      readLocalPluginTemplateSetup: async id => ({ pluginId: id, setupEligibleAppTemplateIds: ['template-A'] }) },
    './plugins': { decodeAppTemplates: pluginParsing.decodeAppTemplates,
      readConnectorMetadata: metadata || (async () => []), listAllApps: directory || (async () => []) },
  }, { URL }).loadLocalPluginTemplates;
}
{
  const detail = makeDetail(), actual = actualLoader({ metadata: async () => { throw Error('private metadata unknown'); },
    directory: async () => { throw Error('private directory unknown'); } });
  const view = mount(detail, { read: (value, signal, original) => actual(value, signal, original) }); await view.tick();
  assert.equal(view.rows().props.templates[0].name, 'Raw template-A');
  assert.match(text(view.tree()), /应用元数据读取失败/); assert.match(text(view.tree()), /应用目录读取失败/);
  assert.equal(view.rows().props.templates[0].materializedAppIds.length, 0); view.unmount();
}
{
  const detail = makeDetail({ apps: [{ id: 'implicit-app', name: 'Implicit actual' }], appTemplates: [],
    summary: { ...makeDetail().summary, installPolicySource: 'IMPLICIT_CANONICAL_APP' } });
  const calls = [], actual = actualLoader({ metadata: async (ids, options) => {
    calls.push([ids, options]); if (options.includeTools) throw Error('private tools unknown');
    return [{ id: ids[0], name: 'Implicit metadata', toolSummaries: [] }];
  } });
  const view = mount(detail, { read: (value, signal, original) => actual(value, signal, original) }); await view.tick();
  assert.match(text(view.tree()), /Implicit actual/);
  assert.match(text(view.tree()), /应用工具摘要读取失败/);
  assert.equal(calls.filter(call => call[1].includeTools === true).length, 1,
    'normal metadata empty tools cannot replace the explicitly requested fresh tool read');
  view.unmount();
}

// Exercise the actual Included JSX gate, without executing unrelated settings tools.
const react = { createElement: element, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {} };
const { PluginDirectoryIncluded: Included } = load('src/components/PluginDirectoryIncluded.tsx', {
  react, 'lucide-react': { BookOpen: 'BookOpen', Boxes: 'Boxes', ChevronRight: 'ChevronRight', Plug: 'Plug', Workflow: 'Workflow' },
  '../recommendedSkills': { recommendedSkillDisplayName: name => name }, './SkillPreviewDialog': { SkillPreviewDialog: 'SkillPreview' },
  './PluginManagementMcp': { PluginManagementMcp: 'Mcp' }, './PluginProvidedSettings': { PluginProvidedSettings: 'Settings' },
  './LocalPluginApps': { LocalPluginApps: 'LocalApps' },
});
const includedProps = { detail: makeDetail(), installedSkills: [], connectionIdentity: 'A', workspaceRoot: 'D:/original', onRefreshApps: async () => {} };
const hasLocal = props => nodes(Included(props)).some(node => node.type === 'LocalApps');
assert.equal(hasLocal({ ...includedProps, presentation: 'settings' }), true);
assert.equal(hasLocal({ ...includedProps, presentation: 'directory' }), false);
assert.equal(hasLocal({ ...includedProps, presentation: 'settings', detail: makeDetail({ summary: { ...makeDetail().summary, source: { type: 'remote' } } }) }), false);
assert.equal(hasLocal({ ...includedProps, presentation: 'settings', onRefreshApps: undefined }), false);
assert.equal(hasLocal({ ...includedProps, presentation: 'settings', detail: makeDetail({ appTemplates: [] }) }), false);

// The parent callback is extracted from the production JSX, not rewritten here.
const source = fs.readFileSync('src/components/SkillsMcpView.tsx', 'utf8');
const ast = ts.createSourceFile('SkillsMcpView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refreshExpression;
function visit(node) { if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onRefreshApps' && node.initializer && ts.isJsxExpression(node.initializer)) refreshExpression = node.initializer.expression;
  ts.forEachChild(node, visit); }
visit(ast); assert.ok(refreshExpression, 'the actual parent must wire a guarded source refresh');
function parentRefresh() {
  const detail = makeDetail(), captured = { plugin: detail.summary, marketplace: { name: detail.marketplaceName, path: detail.marketplacePath } }, view = {};
  const calls = [], context = { presentation: 'settings', detail, includedDetailSource: captured, includedPluginContext: 4, includedDetailRequest: 9,
    includedView: view, detailRequestRef: { current: 9 }, detailContextRef: { current: captured }, preparationViewRef: { current: view },
    isPluginContextCurrent: value => value === context.currentContext, currentContext: 4,
    handleToggleDetail: async (...args) => calls.push(args) };
  const callback = vm.runInNewContext(compile(`(${refreshExpression.getText(ast)})`), context);
  return { callback, context, calls, captured };
}
{
  const test = parentRefresh(); await test.callback(); assert.equal(test.calls.length, 1);
  assert.equal(test.calls[0][0], test.captured.plugin); assert.equal(test.calls[0][1], test.captured.marketplace);
  assert.equal(test.calls[0][2].reload, true, 'return uses the same source plugin/read, never reinstallation or navigation');
}
for (const invalidate of [context => context.currentContext++, context => context.detailRequestRef.current++,
  context => { context.detailContextRef.current = { ...context.includedDetailSource }; }, context => { context.preparationViewRef.current = {}; }]) {
  const test = parentRefresh(); invalidate(test.context); await assert.rejects(test.callback(), /插件页面已变化/); assert.equal(test.calls.length, 0);
}
for (const restore of [false, true]) {
  const detail = makeDetail(), pending = deferred();
  const view = mount(detail, { read: (actual, _signal, _identity, count) => count === 2 ? pending.promise : snap(actual) });
  await view.tick();
  const oldManage = view.rows().props.onManage('template-A'); await view.tick();
  view.render({ blocked: true });
  if (restore) view.render({ blocked: false });
  pending.resolve(snap(detail)); await oldManage; await view.tick();
  assert.equal(view.opens.length, 0, `retired management read cannot open after blocked change${restore ? ' and restoration' : ''}`);
  if (restore) {
    await view.rows().props.onManage('template-A'); await view.tick();
    assert.equal(view.opens.length, 1, 'a new current management attempt still works');
  } else assert.equal(view.rows().props.managementUrl('template-A'), null);
  view.unmount();
}
console.log('PASS real LocalPluginApps and Included/parent wiring: initial/error reads, raw URL/fresh eligibility, original identity, open ACK without materialization, one read-only return refresh, scope/blocked-ABA/unmount isolation and guarded same-source plugin/read; no HTTP, creation or model calls.');
