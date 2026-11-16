import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText, { exports, ...extra, require: name => {
    if (name in imports) return imports[name];
    if (name.endsWith('.css')) return {};
    throw Error(name);
  } });
  return exports;
}
const helpers = load('src/pluginAppDetails.ts', {
  './config': {}, './chatgptService': {}, './pluginManagementMcp': { canonicalMcpAppId: value => value.replace(/^asdk_app_/, 'connector_') },
});
const persisted = new Map(), selections = [], writes = [];
const accountHelpers = load('src/pluginAppAccounts.ts', { './config': {}, './chatgptService': {}, './pluginAppDetails': helpers,
  './pluginManagementMcp': { canonicalMcpAppId: value => value.replace(/^asdk_app_/, 'connector_') },
}, { localStorage: { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) } });
let state, retries = 0, backs = 0, plugins = 0, unavailable = 0, cursor = 0, dirty = false, renamed = 0, renameResult = true, disconnected = 0, disconnectResult = null;
const disconnects = [];
const slots = [], effects = [], queue = [];
const props = { connectionIdentity: 'connection/account-A', pluginId: 'tool@market', appId: 'connector_tool', selectedLinkId: null,
  onSelectLink: (id, expected) => { if (expected !== undefined && props.selectedLinkId !== expected) return false; selections.push(id); props.selectedLinkId = id; return true; }, onRenamed: () => renamed++, onDisconnected: () => disconnected++, onBack: () => backs++, onOpenPlugin: () => plugins++, onUnavailable: () => unavailable++ };
const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), useId: () => 'accounts-heading', Fragment: 'Fragment',
  useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
  useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }]; },
  useEffect(callback, deps) { const index = cursor++, before = effects[index]; if (!before || deps.some((value, i) => value !== before.deps[i])) queue.push(() => { before?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
  useLayoutEffect(callback, deps) { react.useEffect(callback, deps); },
};
const { PluginAppDetailsPage } = load('src/components/PluginAppDetailsPage.tsx', {
  react, '../pluginAppDetails': helpers, '../pluginAppAccounts': accountHelpers, './PluginAccountMenu': { PluginAccountMenu: 'PluginAccountMenu' }, './PluginAccountRenameDialog': { PluginAccountRenameDialog: 'PluginAccountRenameDialog' }, '../pluginAppDetailsState': { usePluginAppDetails: (...args) => {
    assert.deepEqual(args, [props.connectionIdentity, props.pluginId, props.appId]);
    return { state, reload: () => retries++, rename: async (...args) => { writes.push(args); return renameResult; }, disconnect: async id => { disconnects.push([id, props.selectedLinkId]); return typeof disconnectResult === 'function' ? disconnectResult() : disconnectResult; }, clearRenameError: () => {} };
  } },
});
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('');
const render = () => { let tree, turn = 0; do { assert.ok(turn++ < 15); dirty = false; cursor = 0; tree = PluginAppDetailsPage(props); queue.splice(0).forEach(run => run()); } while (dirty); return tree; };
const link = extra => ({ id: 'one', connector_id: 'connector_tool', owners: [{ type: 'USER', id: 'provider-owner' }], ...extra });
const details = { pluginId: props.pluginId, pluginName: '真实插件', appId: props.appId, connector: { id: props.appId, name: '真实应用', description: '真实说明', enable_multi_links: true }, links: [], linksError: null };
const set = (data = details, extra = {}) => { state = { snapshot: { identity: { accountId: 'account', userId: 'user', generation: 1 }, details: data }, loading: false, error: null, pendingLinkId: null, blocked: false, writeError: null, ...extra }; };
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
const identityGroup = nodes(rows[0]).find(node => node.props.role === 'group');
assert.equal(identityGroup.props['aria-describedby'], nodes(rows[0]).find(node => node.props.className === 'sr-only').props.id);
assert.equal(text(rows[1]), 'Provider Name'); assert.equal(text(rows[2]), 'Provider Nick');
assert.equal(text(rows[3]), '真实应用 账户本地昵称', 'missing provider identity uses app-only fallback instead of borrowing current user or alias');
assert.equal(text(rows[4]), '真实应用（未关联账户）');
assert.equal(nodes(tree).some(node => ['input', 'select', 'menu'].includes(node.type) || ['radio', 'switch', 'menuitem', 'option'].includes(node.props.role)), false);
assert.deepEqual(nodes(tree).filter(node => node.type === 'button').map(text), ['插件设置', '真实插件'], 'missing auth metadata does not invent rename-row eligibility');
const readonlyMenus = nodes(tree).filter(node => node.type === 'PluginAccountMenu');
assert.equal(readonlyMenus.length, 5); assert.ok(readonlyMenus.every(node => node.props.onRename === null), 'real account actions remain separate from the read-only identity copy');
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
const actionDetails = { ...details, connector: { ...details.connector, id: 'asdk_app_tool', supported_auth: [{ type: 'OAUTH' }] },
  links: [link({ name: ' Work ', owner_profile: { email: 'real@example.test' }, auth_type: 'OAUTH' })] };
set(actionDetails); tree = render();
const renameRow = nodes(tree).find(node => node.type === 'button' && node.props.className === 'pap-account-open');
assert.equal(renameRow.props['aria-label'], '重命名 real@example.test（Work）', 'official Chinese row name includes the distinct nickname');
renameRow.props.onClick();
tree = render(); let dialog = nodes(tree).find(node => node.type === 'PluginAccountRenameDialog');
assert.ok(dialog); assert.equal(dialog.props.initialNickname, 'Work'); assert.equal(dialog.props.currentName, ' Work ');
assert.equal(selections.at(-1), 'one');
assert.equal(JSON.parse(persisted.get('selected-plugin-links-v1'))[JSON.stringify(['account', 'user', 'asdk_app_tool'])], 'one');
renameResult = false; assert.equal(await dialog.props.onSave('Not confirmed'), false); assert.equal(renamed, 0);
renameResult = true;
state.pendingLinkId = 'one'; render();
assert.equal(await dialog.props.onSave('Actual new name'), true); dialog.props.onClose();
assert.equal(renamed, 1, 'only actual confirmation notifies the application toast');
assert.equal(nodes(render()).some(node => node.type === 'PluginAccountRenameDialog'), false, 'confirmed completion can close before React commits the pending=false render');
for (const multi of [false, null, undefined]) {
  props.selectedLinkId = 'one';
  set({ ...actionDetails, connector: { ...actionDetails.connector, enable_multi_links: multi }, links: [actionDetails.links[0], link({ id: 'two', owner_profile: { email: 'second@example.test' } })] });
  tree = render(); const choices = nodes(tree).filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined);
  assert.equal(choices.length, 2, 'explicit multi eligibility is false whenever enable_multi_links is not true');
  assert.equal(choices[1].props['aria-label'], '选择 second@example.test', 'selection names the provider identity');
  assert.equal(choices[0].props['aria-labelledby'], `${choices[0].props.id} ${nodes(choices[0]).find(node => node.props.className === 'pap-account-nickname').props.id}`, 'distinct nickname participates in the source accessible name');
  choices[1].props.onClick(); tree = render(); assert.equal(selections.at(-1), 'two');
  assert.equal(nodes(tree).filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined)[1].props['aria-pressed'], true);
}
console.log('Plugin app details page: actual metadata/profile, independent errors, scoped source rename entry, raw selection persistence, confirmed close ordering and nonmulti explicit selection passed. OAuth/full App management/sync remain separate work.');

const menu = (tree, id) => nodes(tree).find(node => node.type === 'PluginAccountMenu' && node.props.linkId === id);
set({ ...actionDetails, links: [actionDetails.links[0], link({ id: 'reauth', auth_status: 'REAUTH_REQUIRED' }), link({ id: 'healthy' })] });
tree = render(); assert.ok(menu(tree, 'one'), 'the actual account row must expose its action menu');
props.selectedLinkId = 'healthy';
disconnectResult = { identity: state.snapshot.identity, details: { ...state.snapshot.details, links: state.snapshot.details.links.slice(1) } };
await menu(tree, 'one').props.onDisconnect();
assert.deepEqual(disconnects.at(-1), ['one', 'one'], 'target selection happens before DELETE');
assert.equal(props.selectedLinkId, 'healthy', 'confirmed removal chooses the first healthy sibling'); assert.equal(disconnected, 1);
set(actionDetails); tree = render();
disconnectResult = { identity: state.snapshot.identity, details: { ...actionDetails, links: [] } };
await menu(tree, 'one').props.onDisconnect(); assert.equal(props.selectedLinkId, null); assert.equal(disconnected, 2);
assert.equal(backs, 1, 'last account does not navigate away or uninstall');
set(actionDetails); tree = render(); disconnectResult = null;
await menu(tree, 'one').props.onDisconnect(); assert.equal(props.selectedLinkId, 'one'); assert.equal(disconnected, 2, 'unconfirmed outcomes never notify success');
state = { ...state, blocked: true, writeError: '无法确认账户是否已断开，请重新读取后核对。' }; render();
state = { ...state, blocked: false, writeError: null, snapshot: { ...state.snapshot, details: { ...actionDetails, links: [] } } }; render();
assert.equal(props.selectedLinkId, null); assert.equal(disconnected, 3, 'explicit complete read recovery may confirm absence without another DELETE');
assert.equal(disconnects.length, 3);
set(actionDetails); tree = render(); let resolveDisconnect;
disconnectResult = () => new Promise(resolve => { resolveDisconnect = resolve; });
const pendingDisconnect = menu(tree, 'one').props.onDisconnect();
const beforeDuplicate = disconnects.length; await menu(tree, 'one').props.onDisconnect(); assert.equal(disconnects.length, beforeDuplicate);
props.selectedLinkId = 'external';
resolveDisconnect({ identity: state.snapshot.identity, details: { ...actionDetails, links: [] } }); await pendingDisconnect;
assert.equal(props.selectedLinkId, 'external', 'post-delete fallback cannot overwrite a newer explicit URL selection');
console.log('App account menus: target-first selection, confirmed healthy/last fallback, unknown read-only recovery, no duplicate DELETE and no stale selection overwrite passed.');
