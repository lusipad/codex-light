import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText, { exports, require: name => {
    if (name in imports) return imports[name];
    if (name.endsWith('.css')) return {};
    throw Error(name);
  } });
  return exports;
}
const helpers = load('src/pluginAppDetails.ts', {
  './config': {}, './chatgptService': {}, './pluginManagementMcp': { canonicalMcpAppId: value => value.replace(/^asdk_app_/, 'connector_') },
});
let state, retries = 0, backs = 0, plugins = 0, unavailable = 0;
const props = { connectionIdentity: 'connection/account-A', pluginId: 'tool@market', appId: 'connector_tool', onBack: () => backs++, onOpenPlugin: () => plugins++, onUnavailable: () => unavailable++ };
const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), useId: () => 'accounts-heading', useRef: value => ({ current: value }), useEffect: callback => callback(), Fragment: 'Fragment' };
const { PluginAppDetailsPage } = load('src/components/PluginAppDetailsPage.tsx', {
  react, '../pluginAppDetails': helpers, '../pluginAppDetailsState': { usePluginAppDetails: (...args) => {
    assert.deepEqual(args, [props.connectionIdentity, props.pluginId, props.appId]);
    return { state, reload: () => retries++ };
  } },
});
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('');
const render = () => PluginAppDetailsPage(props);
const link = extra => ({ id: 'one', connector_id: 'connector_tool', owners: [{ type: 'USER', id: 'provider-owner' }], ...extra });
const details = { pluginId: props.pluginId, pluginName: '真实插件', appId: props.appId, connector: { id: props.appId, name: '真实应用', description: '真实说明', enable_multi_links: true }, links: [], linksError: null };
const set = (data = details, extra = {}) => { state = { snapshot: { identity: { userId: 'user' }, details: data }, loading: false, error: null, ...extra }; };
state = { snapshot: null, loading: true, error: null };
assert.equal(render().props['aria-busy'], true);
assert.ok(nodes(render()).find(node => node.props.role === 'status'));
assert.equal(nodes(render()).some(node => node.type === 'h1'), false, 'pending metadata cannot invent an application heading');
nodes(render()).find(node => node.type === 'button').props.onClick(); assert.equal(backs, 1);
state = { snapshot: null, loading: false, error: '元数据读取失败' };
let tree = render(); assert.match(text(tree), /元数据读取失败/);
nodes(tree).find(node => node.type === 'button' && text(node) === '重试').props.onClick(); assert.equal(retries, 1);
set(); tree = render();
assert.equal(text(nodes(tree).find(node => node.type === 'h1')), '真实应用'); assert.match(text(tree), /真实说明/);
nodes(tree).find(node => node.type === 'button' && text(node) === '真实插件').props.onClick(); assert.equal(plugins, 1);
assert.equal(nodes(tree).some(node => node.type === 'section'), false, 'known empty links do not manufacture a connected-account card');
set({ ...details, links: null, linksError: { code: 'network', message: 'private transport error' } }); tree = render();
assert.match(text(tree), /无法加载已连接的帐户/); assert.match(text(tree), /真实应用/);
assert.equal(text(tree).includes('private transport error'), false, 'links error uses the observed product copy');
nodes(tree).find(node => node.type === 'button' && text(node) === '重试').props.onClick(); assert.equal(retries, 2);
set({ ...details, links: [link({ name: ' 工作账户 ', owner_profile: { email: ' provider@example.test ', name: 'Provider Name', nickname: 'Provider Nick' }, auth_status: 'REAUTH_REQUIRED' }),
  link({ id: 'two', name: 'connected', owner_profile: { name: 'Provider Name', nickname: 'Provider Nick' } }),
  link({ id: 'three', name: '真实应用', owner_profile: { nickname: 'Provider Nick' } }),
  link({ id: 'four', name: '本地昵称' }), link({ id: 'five', auth_type: 'NONE' }),
  link({ id: 'hidden', visibility: 'HIDDEN' }), link({ id: 'implicit_link::system' }),
] }); tree = render();
const rows = nodes(tree).filter(node => node.props.className === 'pap-account');
assert.equal(rows.length, 5, 'hidden and implicit links are excluded by the actual selection helper');
assert.match(text(rows[0]), /provider@example.test工作账户/);
assert.equal(text(nodes(rows[0]).find(node => node.props.className === 'sr-only')), '需要更新身份验证');
assert.equal(text(rows[1]), 'Provider Name'); assert.equal(text(rows[2]), 'Provider Nick');
assert.equal(text(rows[3]), '真实应用 账户本地昵称', 'missing provider identity uses app-only fallback instead of borrowing current user or alias');
assert.equal(text(rows[4]), '真实应用（未关联账户）');
assert.equal(nodes(tree).some(node => ['input', 'select', 'menu'].includes(node.type) || ['radio', 'switch', 'menuitem', 'option'].includes(node.props.role)), false);
assert.deepEqual(nodes(tree).filter(node => node.type === 'button').map(text), ['插件设置', '真实插件'], 'read-only first package has only actual ancestors and no fake connect, rename, selection, permission or sync controls');
set({ ...details, links: [] }, { loading: true });
assert.equal(render().props['aria-busy'], true);
set(details, { error: '刷新失败', loading: false });
tree = render(); assert.match(text(tree), /刷新失败/);
assert.equal(text(nodes(tree).find(node => node.type === 'h1')), '真实应用', 'failed refresh preserves already-read metadata');
set(details, { error: '刷新失败', loading: true });
assert.equal(nodes(render()).find(node => node.type === 'button' && text(node) === '重试').props.disabled, true);
state = { snapshot: null, error: null, loading: false, unavailable: true }; render();
assert.equal(unavailable, 1, 'only explicit membership loss asks the parent to replace to the plugin ancestor');
state = { snapshot: null, error: 'Real 403', loading: false, unavailable: false }; render();
assert.equal(unavailable, 1);
console.log('Plugin app details page: actual metadata, scoped hook props, loading/retry, independent link error and header, empty omission, real profile priority, nickname, expired sr-only status, filtered accounts and no unsupported writes passed.');
