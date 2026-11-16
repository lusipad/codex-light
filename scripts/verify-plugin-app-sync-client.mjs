import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = (file, imports = {}, extra = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => imports[name] ?? {}, ...extra });
  return exports;
};
const canonicalMcpAppId = load('src/pluginManagementMcp.ts').canonicalMcpAppId;
const detailsApi = load('src/pluginAppDetails.ts', { './pluginManagementMcp': { canonicalMcpAppId } });
const identity = { accountId: 'account', userId: 'user', generation: 3 };
const link = id => ({ id, connector_id: 'connector_A', owners: [] });
const status = (extra = {}) => ({ user_connection_details: { auth_status: 'user_connected', connector_id: 'connector_A', backing_link_id: 'one', connection_instance_id: 'instance', activation_status: 'activated', ...extra } });
const raw = (statuses = [status()]) => ({ appId: 'asdk_app_A', details: { pluginId: 'plugin', pluginName: 'Plugin', appId: 'asdk_app_A',
  connector: { id: 'connector_A', name: 'App', enable_multi_links: true }, links: [link('one'), link('two')], linksError: null }, account: { id: 'account', structure: 'personal' }, statuses });
let current = identity, response = raw(), onRead = () => {}, write = async () => ({ body: { delivery: 'accepted' }, verification: 'pending' });
const reads = [], writes = [];
const api = load('src/pluginAppSync.ts', { './config': { accountRead: async () => ({ account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: current.accountId } }) },
  './pluginManagementMcp': { canonicalMcpAppId }, './pluginAppDetails': detailsApi, './chatgptService': {
    serviceIdentity: async () => current,
    readPluginAppSync: async (...args) => { reads.push(args); onRead(); return response; },
    disableServicePluginAppSync: async (...args) => { writes.push(args); return write(...args); },
  } });
const signal = new AbortController().signal;
const decode = (value = raw()) => api.decodePluginAppSync(value, 'plugin', null, 'one', identity);
const snapshot = decode();
assert.equal(snapshot.routeAppId, null); assert.equal(snapshot.statuses.length, 1);
for (const value of [{ ...raw(), statuses: null }, { ...raw(), account: {} }, { ...raw(), details: { ...raw().details, links: null, linksError: { code: 'offline', message: 'Offline' } } },
  raw([status({ backing_link_id: 'two' })]), raw([status({ connector_id: undefined })]), raw([status({ connection_instance_id: null })]), raw([status({ last_full_sync_completed_at: 'invalid' })]),
  raw([status({ last_delta_sync_completed_at: Infinity })])]) assert.throws(() => decode(value));
assert.equal(decode({ ...raw(), account: null }).account, null);
assert.equal(decode({ ...raw(), account: { id: 'other', structure: 'team' } }).account.id, 'other', 'read-only account information is not a write grant');
assert.equal(decode(raw([status({ last_full_sync_completed_at: '2026-11-16T00:00:00Z' })])).statuses.length, 1);
await api.loadPluginAppSync('plugin', null, 'one', signal); assert.equal(reads.at(-1)[1], null); assert.equal(reads.at(-1)[2], 'one');
response = raw([]);
let result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal);
assert.equal(result.confirmed, true); assert.equal(writes.length, 1); assert.equal(writes[0][1], 'asdk_app_A');
assert.equal(writes[0][2], 'one'); assert.equal(writes[0][3], 'instance'); assert.equal(writes[0][4], 'one');
assert.equal(reads.at(-1)[1], null, 'write readback resolves the original implicit route again');
response = raw(); result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal); assert.equal(result.confirmed, false, 'ACK alone is not proof of removal');
write = async () => { throw { code: 'network_error' }; }; response = raw([]);
const beforeUnknown = writes.length; result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal);
assert.equal(result.confirmed, true); assert.equal(writes.length, beforeUnknown + 1, 'unknown delivery is recovered only by GET');
write = async () => ({ body: { delivery: 'unknown' }, verification: 'pending' }); response = raw();
result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal); assert.equal(result.confirmed, false);
response = { ...raw([]), appId: 'asdk_app_B', details: { ...raw().details, appId: 'asdk_app_B', connector: { id: 'connector_B', name: 'B', enable_multi_links: true }, links: [ { ...link('one'), connector_id: 'connector_B' } ] } };
result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal); assert.equal(result.confirmed, false); assert.equal(result.snapshot.appId, 'asdk_app_B');
response = raw([]); response.details.links = [link('two')];
result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal); assert.equal(result.confirmed, false, 'new selected account cannot prove the old target stopped');
response = { ...raw(), statuses: {} }; result = await api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal);
assert.equal(result.snapshot, null); assert.equal(result.confirmed, false); assert.ok(result.refreshError);
write = async () => { throw { code: 'forbidden' }; }; response = raw(); const readsBeforeReject = reads.length;
await assert.rejects(api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal), error => error.code === 'forbidden'); assert.equal(reads.length, readsBeforeReject);
const beforeInvalid = writes.length;
await assert.rejects(api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'two', signal), error => error.code === 'invalid_request');
await assert.rejects(api.disablePluginAppSync({ ...snapshot, account: { id: 'other', structure: 'personal' } }, snapshot.statuses[0], 'one', signal), error => error.code === 'invalid_request');
await assert.rejects(api.disablePluginAppSync({ ...snapshot, statuses: [snapshot.statuses[0], snapshot.statuses[0]] }, snapshot.statuses[0], 'one', signal), error => error.code === 'invalid_request');
assert.equal(writes.length, beforeInvalid);
onRead = () => { current = { ...identity, generation: 4 }; };
await assert.rejects(api.loadPluginAppSync('plugin', null, 'one', signal), error => error.code === 'account_changed'); current = identity; onRead = () => {};
write = async () => { current = { ...identity, userId: 'other' }; return { body: { delivery: 'accepted' } }; };
const beforeChanged = reads.length; await assert.rejects(api.disablePluginAppSync(snapshot, snapshot.statuses[0], 'one', signal), error => error.code === 'account_changed');
assert.equal(reads.length, beforeChanged); current = identity;
const aborted = new AbortController(); aborted.abort();
await assert.rejects(api.loadPluginAppSync('plugin', null, 'one', aborted.signal), error => error.code === 'cancelled');
const sent = []; let wrongIdentity = false;
const bridge = load('src/chatgptService.ts', { './bridge': { tauriInvoke: async (command, args) => { sent.push({ command, args }); return {
  requestId: args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 5 } : identity, body: command.endsWith('_read') ? raw() : { delivery: 'accepted' }, verification: 'pending', readback: null }; } } },
{ crypto: { randomUUID: () => 'sync-request' }, navigator: { userAgent: 'private-fixture', userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'private-device' } });
await bridge.readPluginAppSync('plugin', null, 'one', identity, signal); assert.equal(sent.at(-1).command, 'plugin_app_sync_read'); assert.equal(sent.at(-1).args.request.appId, null);
await bridge.disableServicePluginAppSync('plugin', 'asdk_app_A', 'one', '', 'one', identity, signal);
assert.equal(sent.at(-1).command, 'plugin_app_sync_disable'); assert.equal(sent.at(-1).args.request.connectionInstanceId, ''); assert.equal(sent.at(-1).args.request.backingLinkId, 'one');
assert.equal('url' in sent.at(-1).args.request, false); assert.equal('status' in sent.at(-1).args.request, false);
wrongIdentity = true; await assert.rejects(bridge.readPluginAppSync('plugin', null, 'one', identity, signal), /账号发生变化/);
for (const command of ['plugin_app_sync_read', 'plugin_app_sync_disable']) assert.ok(fs.readFileSync('src-tauri/src/lib.rs', 'utf8').includes(`            ${command},`));
console.log('App sync client: strict scoped decode, fixed IPC, actual selected target, ACK/unknown readback, canonical and account isolation passed.');
