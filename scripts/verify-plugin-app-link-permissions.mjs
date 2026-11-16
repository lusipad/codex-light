import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = (file, imports, extra = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => imports[name] ?? {}, ...extra });
  return exports;
};
const canonicalMcpAppId = id => id.replace(/^asdk_app_/, 'connector_');
const helpers = load('src/pluginAppDetails.ts', { './pluginManagementMcp': { canonicalMcpAppId } });
const options = load('src/pluginPermissions.ts', {}).pluginPermissionOptions;
const identity = { accountId: 'account', userId: 'user', generation: 2 };
const link = (id, permission = null, extra = {}) => ({ id, connector_id: 'connector_A', owners: [{ type: 'USER', id: 'user' }], auth_type: 'OAUTH',
  owner_profile: { email: `${id}@example.test` }, apps_privacy_control: permission, ...extra });
const raw = (links = [link('one'), link('two')]) => ({ appId: 'asdk_app_A', personal: true, access: 'allowed', defaultValue: 'review_important_actions', defaultError: null,
  details: { pluginId: 'plugin', pluginName: 'Actual plugin', appId: 'connector_A', connector: { id: 'asdk_app_A', name: 'App', enable_multi_links: false }, links, linksError: null } });
let current = identity, account = { account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: 'account' } }, response = raw();
let onRead = () => {}, write = async () => ({ verification: 'pending', body: { delivery: 'accepted' } });
const writes = [], reads = [];
const api = load('src/pluginAppLinkPermissions.ts', { './config': { accountRead: async () => account }, './pluginAppDetails': helpers,
  './pluginPermissions': { pluginPermissionOptions: options }, './pluginManagementMcp': { canonicalMcpAppId }, './chatgptService': {
    serviceIdentity: async () => current, readPluginAppLinkPermissions: async (...args) => { reads.push(args); onRead(); return response; },
    writePluginAppLinkPermission: async (...args) => { writes.push(args); return write(...args); },
  } });
const decode = value => api.decodePluginAppLinkPermissions(value, identity, 'plugin', 'asdk_app_A');
const snapshot = decode(raw()), signal = new AbortController().signal;
assert.deepEqual(Array.from(api.pluginAppLinkPermissionOptions, option => option.label), ['始终询问', '允许使用只读工具', '允许使用低风险工具', '允许使用所有工具']);
assert.equal(snapshot.details.connector.id, 'asdk_app_A'); assert.equal(api.pluginAppPermissionAccounts(snapshot).length, 2);
assert.equal(api.pluginAppPermissionAccounts(snapshot)[0].identity, 'one@example.test');
for (const extra of [{ owners: [{ type: 'USER', id: 'other' }] }, { auth_status: 'REAUTH_REQUIRED' }]) {
  const value = raw([link('one', null, extra), link('two')]); assert.equal(api.pluginAppPermissionAccounts(decode(value))[0].editable, false);
}
for (const extra of [{ visibility: 'HIDDEN' }, { id: 'implicit_link::system' }]) assert.equal(api.pluginAppPermissionAccounts(decode(raw([link('one', null, extra), link('two')]))).length, 1);
const denied = raw(); denied.personal = false; denied.access = 'denied'; assert.equal(decode(denied).access, 'denied');
const hidden = raw(); hidden.details.connector.labels = { apps_privacy_control_available: 'false' }; hidden.access = 'denied'; assert.equal(decode(hidden).access, 'denied');
const partial = raw(); partial.access = 'unavailable'; partial.details.links = null; partial.details.linksError = { code: 'offline', message: 'No links' }; assert.equal(decode(partial).access, 'unavailable');
const defaults = raw(); defaults.defaultValue = null; defaults.defaultError = { code: 'offline', message: 'Never expose raw diagnostics' };
assert.equal(decode(defaults).defaultValue, null); assert.equal(decode(defaults).defaultError, '无法加载插件设置');
for (const value of [{ ...raw(), appId: 'other' }, { ...raw(), defaultValue: 'future' }, { ...raw(), defaultValue: null }, { ...raw(), personal: false }]) assert.throws(() => decode(value));
assert.equal((await api.loadPluginAppLinkPermissions('plugin', null, signal)).appId, 'asdk_app_A'); assert.equal(reads.at(-1)[1], null);
response = raw([link('one', 'review_important_actions'), link('two', 'review_important_actions')]);
let result = await api.savePluginAppLinkPermissions(snapshot, ['one', 'two', 'one'], 'review_important_actions', signal);
assert.equal(writes.length, 2, 'clicking an inherited checked value writes explicit overrides exactly once each');
assert.deepEqual(Array.from(result.confirmedLinkIds), ['one', 'two']); assert.equal(writes[0][1], 'asdk_app_A');
response = raw([link('one', 'full_access'), link('two', 'review_important_actions')]);
write = async (_plugin, _app, id) => { if (id === 'two') throw { code: 'forbidden', message: 'Rejected' }; return { verification: 'pending', body: { delivery: 'accepted' } }; };
result = await api.savePluginAppLinkPermissions(snapshot, ['one', 'two'], 'full_access', signal);
assert.deepEqual(Array.from(result.confirmedLinkIds), ['one']); assert.deepEqual(Array.from(result.failedLinkIds), ['two']);
assert.equal(result.pendingLinkIds.length, 0, 'an explicit refusal is kept distinct from unknown delivery');
write = async () => { throw { code: 'transport_error' }; }; response = raw([link('one', 'full_access'), link('two')]);
result = await api.savePluginAppLinkPermissions(snapshot, ['one'], 'full_access', signal); assert.deepEqual(Array.from(result.confirmedLinkIds), ['one'], 'unknown delivery can be verified only through the actual fresh value');
response = raw(); result = await api.savePluginAppLinkPermissions(snapshot, ['one'], 'full_access', signal); assert.deepEqual(Array.from(result.pendingLinkIds), ['one']);
response = defaults; result = await api.savePluginAppLinkPermissions(snapshot, ['one'], 'full_access', signal); assert.ok(result.refreshError); assert.equal(result.confirmedLinkIds.length, 0);
write = async () => ({ verification: 'pending', body: { delivery: 'accepted' } }); response = raw();
const overridden = decode(raw([link('one', 'full_access'), link('two')]));
await api.savePluginAppLinkPermissions(overridden, ['one'], null, signal); assert.equal(writes.at(-1)[3], null, 'reset must transmit explicit null');
const beforeSame = writes.length; await api.savePluginAppLinkPermissions(snapshot, ['one'], null, signal); assert.equal(writes.length, beforeSame, 'raw null reset is a no-op but still reads');
const beforeInvalid = writes.length;
await assert.rejects(api.savePluginAppLinkPermissions(snapshot, [], 'full_access', signal));
await assert.rejects(api.savePluginAppLinkPermissions(snapshot, ['missing'], 'full_access', signal));
await assert.rejects(api.savePluginAppLinkPermissions(decode(raw([link('one', null, { owners: [] }), link('two')])), ['one', 'two'], 'full_access', signal));
assert.equal(writes.length, beforeInvalid);
const implicit = api.decodePluginAppLinkPermissions(raw(), identity, 'plugin', null);
response = raw([link('one', 'full_access')]); response.appId = 'asdk_app_B'; response.details.appId = 'connector_B'; response.details.connector.id = 'asdk_app_B'; response.details.links[0].connector_id = 'connector_B';
result = await api.savePluginAppLinkPermissions(implicit, ['one'], 'full_access', signal);
assert.equal(reads.at(-1)[1], null, 'implicit writes must re-resolve the original canonical route on readback');
assert.equal(writes.at(-1)[1], 'asdk_app_A', 'the write still targets the actual app the user acted on');
assert.equal(result.snapshot.appId, 'asdk_app_B'); assert.equal(result.confirmedLinkIds.length, 0, 'a new app cannot confirm the old app action even if a provider link id is reused');
response = raw();
onRead = () => { current = { ...identity, generation: 3 }; };
await assert.rejects(api.loadPluginAppLinkPermissions('plugin', 'asdk_app_A', signal), /账号发生变化/); current = identity; onRead = () => {};
write = async () => { current = { ...identity, userId: 'other' }; return { body: { delivery: 'accepted' } }; };
const beforeChanged = reads.length; await assert.rejects(api.savePluginAppLinkPermissions(snapshot, ['one'], 'full_access', signal), /账号发生变化/); assert.equal(reads.length, beforeChanged, 'retired writes must not read the new account');
current = identity; const cancelled = new AbortController(); cancelled.abort(); const beforeCancelled = writes.length;
await assert.rejects(api.savePluginAppLinkPermissions(snapshot, ['one'], 'full_access', cancelled.signal), /已取消/); assert.equal(writes.length, beforeCancelled);
const sent = []; let wrongIdentity = false;
const bridge = load('src/chatgptService.ts', { './bridge': { tauriInvoke: async (command, args) => { sent.push({ command, args }); return {
  requestId: args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 5 } : identity, body: command.endsWith('_read') ? raw() : { delivery: 'accepted' }, readback: null, verification: 'pending' }; } } },
{ crypto: { randomUUID: () => 'link-permission-request' }, navigator: { userAgent: 'private-fixture', userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'private-device' } });
await bridge.readPluginAppLinkPermissions('plugin', null, identity, signal); assert.equal(sent.at(-1).args.request.appId, null);
await bridge.writePluginAppLinkPermission('plugin', 'asdk_app_A', 'one', null, identity, signal); assert.equal(sent.at(-1).args.request.value, null); assert.equal(sent.at(-1).command, 'plugin_app_link_permission_write');
wrongIdentity = true; await assert.rejects(bridge.readPluginAppLinkPermissions('plugin', 'asdk_app_A', identity, signal), /账号发生变化/);
for (const command of ['plugin_app_link_permissions_read', 'plugin_app_link_permission_write']) assert.ok(fs.readFileSync('src-tauri/src/lib.rs', 'utf8').includes(`            ${command},`));
console.log('App link permissions client: scoped canonical/explicit reads, owner/personal eligibility, default errors, raw override/null reset, batch partial/unknown actual verification, identity/abort and typed IPC passed.');
