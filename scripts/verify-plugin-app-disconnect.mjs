import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = (file, imports, extra = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, { exports, require: name => imports[name] ?? {}, ...extra });
  return exports;
};
const canonicalMcpAppId = id => id.replace(/^asdk_app_/, 'connector_');
const helpers = load('src/pluginAppDetails.ts', { './pluginManagementMcp': { canonicalMcpAppId } });
const identity = { accountId: 'account', userId: 'user', generation: 1 };
const link = extra => ({ id: 'link/a?%中文', connector_id: 'connector_A', owners: [{ type: 'USER', id: 'another' }], auth_type: 'OAUTH', auth_status: 'REAUTH_REQUIRED', ...extra });
const body = (links = [link()]) => ({ pluginId: 'plugin', pluginName: 'Real plugin', pluginStatus: 'DISABLED_BY_ADMIN', appId: 'connector_A',
  connector: { id: 'asdk_app_A', name: 'App', enable_multi_links: false, supported_auth: [{ type: 'OAUTH' }] }, links, linksError: null });
const snapshot = { identity, details: helpers.decodePluginAppDetails(body(), 'plugin', 'asdk_app_A') };
let actual = identity, account = { account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: 'account' } };
let reply = { verification: 'confirmed', readback: body([]) }, afterWrite = () => {};
const writes = [];
const api = load('src/pluginAppAccounts.ts', { './config': { accountRead: async () => account }, './pluginAppDetails': helpers,
  './pluginManagementMcp': { canonicalMcpAppId }, './chatgptService': { serviceIdentity: async () => actual,
    disconnectServicePluginAppAccount: async (...args) => { writes.push(args); afterWrite(); return reply; } } });
assert.equal(typeof api.disconnectPluginAppAccount, 'function', 'actual account consumer must implement disconnect');
const disconnect = api.disconnectPluginAppAccount, signal = new AbortController().signal;
assert.equal((await disconnect(snapshot, 'asdk_app_A', link().id, signal)).confirmed, true, 'nonmulti last account with admin/other owner/reauth still uses the shared rule');
assert.equal(writes[0][1], 'asdk_app_A'); assert.equal(writes[0][2], link().id);
for (const readback of [body(), body([link({ visibility: 'HIDDEN' })]), { ...body(null), linksError: { code: 'offline', message: 'No complete list' } }]) {
  reply = { verification: 'confirmed', readback };
  assert.equal((await disconnect(snapshot, 'asdk_app_A', link().id, signal)).confirmed, false, 'only complete absence confirms deletion, not cache markers or hidden rows');
}
reply = { verification: 'pending', readback: body([]) };
assert.equal((await disconnect(snapshot, 'asdk_app_A', link().id, signal)).confirmed, false);
const before = writes.length;
for (const candidate of [body([link({ visibility: 'HIDDEN' })]), body([link({ id: 'implicit_link::system' })]), body([link(), link()])]) {
  const value = { identity, details: helpers.decodePluginAppDetails(candidate, 'plugin', 'asdk_app_A') };
  await assert.rejects(disconnect(value, 'asdk_app_A', candidate.links[0].id, signal));
}
await assert.rejects(disconnect(snapshot, 'other-app', link().id, signal));
await assert.rejects(disconnect(snapshot, 'asdk_app_A', 'missing', signal));
assert.equal(writes.length, before);
actual = { ...identity, generation: 2 }; await assert.rejects(disconnect(snapshot, 'asdk_app_A', link().id, signal), /账号发生变化/);
assert.equal(writes.length, before); actual = identity;
reply = { verification: 'confirmed', readback: body([]) }; afterWrite = () => { actual = { ...identity, userId: 'other' }; };
await assert.rejects(disconnect(snapshot, 'asdk_app_A', link().id, signal), /账号发生变化/);
actual = identity; afterWrite = () => {}; const cancelled = new AbortController(); cancelled.abort();
const cancelledBefore = writes.length; await assert.rejects(disconnect(snapshot, 'asdk_app_A', link().id, cancelled.signal), /已取消/); assert.equal(writes.length, cancelledBefore);
const sent = []; let wrongIdentity = false;
const bridge = load('src/chatgptService.ts', { './bridge': { tauriInvoke: async (command, args) => {
  sent.push({ command, args }); return { ...reply, requestId: args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 2 } : identity, body: {} };
} } }, { crypto: { randomUUID: () => 'disconnect-request' }, navigator: { userAgent: 'private-fixture', userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'private-device' } });
await bridge.disconnectServicePluginAppAccount('plugin', 'asdk_app_A', link().id, identity, signal);
assert.equal(sent[0].command, 'plugin_app_account_disconnect'); assert.equal(sent[0].args.request.linkId, link().id);
assert.equal(sent[0].args.request.expectedIdentity, identity); assert.equal('name' in sent[0].args.request, false);
wrongIdentity = true; await assert.rejects(bridge.disconnectServicePluginAppAccount('plugin', 'asdk_app_A', link().id, identity, signal), /账号发生变化/);
assert.ok(fs.readFileSync('src-tauri/src/lib.rs', 'utf8').includes('            plugin_app_account_disconnect,'));
console.log('Account disconnect client: exact typed target, shared last-account rule, full absence readback, no hidden/null success, original IDs, account/generation/abort and registered IPC passed.');
