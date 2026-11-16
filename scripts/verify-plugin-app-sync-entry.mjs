import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = (path, imports) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, require: name => imports[name] ?? {} }); return exports; };
const canonicalMcpAppId = load('src/pluginManagementMcp.ts', {}).canonicalMcpAppId;
const helpers = load('src/pluginAppDetails.ts', { './pluginManagementMcp': { canonicalMcpAppId } });
const domain = load('src/pluginAppSync.ts', { './pluginAppDetails': helpers, './pluginManagementMcp': { canonicalMcpAppId } });
let cursor = 0; const slots = [], pending = [], opened = [];
const react = { useRef: initial => slots[cursor++] ??= { current: initial }, useLayoutEffect(run, deps) { const i = cursor++, old = slots[i];
  if (!old || deps.some((value, index) => value !== old.deps[index])) pending.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); } };
const details = { appId: 'connector_A', connector: { enable_multi_links: false }, links: [{ id: 'actual', connector_id: 'connector_A', owners: [] }] };
const row = activation_status => ({ user_connection_details: { auth_status: 'user_connected', connection_instance_id: 'instance', backing_link_id: 'actual', connector_id: 'connector_A', activation_status } });
let state = { loading: false, blocked: false, error: null, snapshot: { identity: { accountId: 'account', userId: 'user', generation: 1 }, appId: 'connector_A', details, statuses: [row('activated'), row('activating')] } };
let props = { connectionIdentity: 'A', pluginId: 'plugin', appId: 'connector_A', selectedLinkId: 'foreign', disabled: false, onOpen: id => opened.push(id) };
const page = load('src/components/PluginAppSyncEntry.tsx', { react, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
  'lucide-react': { ChevronRight: 'ChevronRight' }, '../pluginAppSync': domain, '../pluginAppSyncState': { usePluginAppSync: () => ({ state }) } });
const render = () => { cursor = 0; const tree = page.PluginAppSyncEntry(props); pending.splice(0).forEach(run => run()); return tree; };
let tree = render(); assert.equal(tree.props.children[1].props.children, '正在同步'); tree.props.onClick(); assert.equal(opened.at(-1), 'actual', 'navigation uses actual fD selection, not foreign URL');
const retired = tree.props.onClick;
props = { ...props, selectedLinkId: 'next' }; render(); const before = opened.length; retired(); assert.equal(opened.length, before);
props = { ...props, selectedLinkId: 'foreign' }; render(); retired(); assert.equal(opened.length, before, 'ABA cannot revive retired link handler');
props = { ...props, disabled: true }; tree = render(); assert.equal(tree.props.disabled, true); tree.props.onClick(); assert.equal(opened.length, before);
props = { ...props, disabled: false };
for (const patch of [{ loading: true }, { blocked: true }, { error: 'Failed' }, { snapshot: { ...state.snapshot, statuses: [] } }]) { const old = state; state = { ...state, ...patch }; assert.equal(render(), null); state = old; }
tree = render(); const oldIdentityHandler = tree.props.onClick, oldKey = tree.key;
state = { ...state, snapshot: { ...state.snapshot, identity: { ...state.snapshot.identity, generation: 2 } } };
tree = render(); assert.notEqual(tree.key, oldKey); oldIdentityHandler(); assert.equal(opened.length, before);
tree = render(); slots.forEach(slot => slot?.cleanup?.()); tree.props.onClick(); assert.equal(opened.length, before);
console.log('App sync entry: actual status-only visibility, summary priority, single-account actual selection, pending and retired callbacks passed.');
