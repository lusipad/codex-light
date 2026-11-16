import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = (file, imports = {}, extra = {}) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, require: name => imports[name] ?? {}, ...extra }); return exports; };
const canonicalMcpAppId = load('src/pluginManagementMcp.ts').canonicalMcpAppId;
const detailsApi = load('src/pluginAppDetails.ts', { './pluginManagementMcp': { canonicalMcpAppId } });
const syncApi = load('src/pluginAppSync.ts', { './pluginAppDetails': detailsApi, './pluginManagementMcp': { canonicalMcpAppId } });
const appId = 'connector_76869538009648d5b282a4bb21c3d157', identity = { accountId: 'account', userId: 'user', generation: 2 };
const status = { user_connection_details: { auth_status: 'user_connected', knowledge_connector_type: 'github', connector_id: appId, backing_link_id: 'one', connection_instance_id: 'instance' } };
const parent = { identity, routeAppId: null, selectedLinkId: 'one', appId, account: null, statuses: [status], details: { pluginId: 'plugin', pluginName: 'Plugin', appId,
  connector: { id: appId, name: 'GitHub', enable_multi_links: true, sync_metadata: { user_allowed_to_sync: true } },
  links: [{ id: 'one', connector_id: appId, owners: [] }, { id: 'two', connector_id: appId, owners: [] }], linksError: null } };
const repo = (id, name = `Repo ${id}`) => ({ id, name, description: null });
const raw = (repositories = [repo(1)]) => ({ appId, linkId: 'one', connectionInstanceId: 'instance', repositories });
let actualIdentity = identity, response = raw(), page = { ...raw([repo(2)]), nextToken: '' }, onRead = () => {}, write = async () => ({ body: { delivery: 'accepted' }, verification: 'pending' });
const reads = [], searches = [], writes = [];
const api = load('src/pluginGithubSync.ts', { './config': { accountRead: async () => ({ account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: actualIdentity.accountId } }) },
  './pluginManagementMcp': { canonicalMcpAppId }, './pluginAppSync': syncApi, './chatgptService': { serviceIdentity: async () => actualIdentity,
    readPluginGithubSync: async (...args) => { reads.push(args); onRead(); return response; }, searchPluginGithubRepositories: async (...args) => { searches.push(args); return page; },
    writePluginGithubSync: async (...args) => { writes.push(args); return write(...args); } } });
const signal = new AbortController().signal;
assert.equal(api.pluginGithubSyncStatuses(parent).length, 1);
for (const change of [{ selectedLinkId: 'two' }, { appId: 'other' }, { details: { ...parent.details, links: null } },
  ...[false, null, undefined, 'true'].map(value => ({ details: { ...parent.details, connector: { ...parent.details.connector, sync_metadata: { user_allowed_to_sync: value } } } }))]) assert.equal(api.pluginGithubSyncStatuses({ ...parent, ...change }).length, 0);
const readonlyStatus = { user_connection_details: { ...status.user_connection_details, auth_status: 'admin_connected' } };
assert.equal(api.pluginGithubSyncStatuses({ ...parent, statuses: [readonlyStatus] }).length, 1, 'GitHub gate does not invent an owner/personal/user_connected restriction');
const adminParent = { ...parent, account: { id: 'account', structure: 'workspace' }, statuses: [readonlyStatus] };
assert.equal(syncApi.pluginAppSyncCanDisable(readonlyStatus, adminParent.account, identity.accountId), false);
assert.equal(syncApi.pluginAppGithubEmptyCanDisable(adminParent, readonlyStatus), true);
assert.equal(syncApi.pluginAppGithubEmptyCanDisable({ ...adminParent, selectedLinkId: 'two' }, readonlyStatus), false);
assert.equal(syncApi.pluginAppGithubEmptyCanDisable({ ...adminParent, account: { id: 'other', structure: 'personal' } }, readonlyStatus), false);
const stopCalls = [];
const stopApi = load('src/pluginAppSync.ts', { './config': { accountRead: async () => ({ account: { type: 'chatgpt' } }) }, './pluginAppDetails': detailsApi,
  './pluginManagementMcp': { canonicalMcpAppId }, './chatgptService': { serviceIdentity: async () => identity,
    readPluginAppSync: async () => ({ appId, details: parent.details, account: adminParent.account, statuses: [] }),
    disableServicePluginAppSync: async (...args) => { stopCalls.push(args); return { body: { delivery: 'accepted' } }; } } });
await assert.rejects(stopApi.disablePluginAppSync(adminParent, readonlyStatus, 'one', signal), error => error.code === 'invalid_request');
assert.equal(stopCalls.length, 0);
assert.equal((await stopApi.disablePluginAppSync(adminParent, readonlyStatus, 'one', signal, true)).confirmed, true);
assert.equal(stopCalls.length, 1); assert.equal(stopCalls[0][7], true, 'only the GitHub empty-selection origin reaches the exceptional confirmation path');
const connector = detailsApi.decodePluginAppConnector({ ...parent.details.connector, sync_metadata: { user_allowed_to_sync: true, secret: 'discard' } }, appId);
assert.equal(connector.sync_metadata.user_allowed_to_sync, true); assert.equal('secret' in connector.sync_metadata, false);
assert.throws(() => detailsApi.decodePluginAppConnector({ ...parent.details.connector, sync_metadata: { user_allowed_to_sync: 'true' } }, appId));
assert.deepEqual(Array.from(api.buildGithubSyncRepositories([repo(1, 'Zulu'), repo(2, 'Beta')], [[repo(2, 'Alias'), repo(3, 'Alpha')]], ''), value => value.id), [2, 1, 3]);
assert.deepEqual(Array.from(api.buildGithubSyncRepositories([repo(1), repo(2)], [[repo(2), repo(3)]], 'query'), value => value.id), [2, 3]);
const snapshot = await api.loadPluginGithubSync(parent, status, signal); assert.equal(snapshot.repositories.length, 1); assert.equal(reads.at(-1)[0].appId, null); assert.equal(reads.at(-1)[0].resolvedAppId, appId);
for (const malformed of [{ ...raw(), linkId: 'two' }, { ...raw(), connectionInstanceId: 'other' }, { ...raw(), appId: 'other' }, raw(null), raw([repo('1')]), raw([repo(-1)]), raw([repo(1.5)]), raw([repo(Number.MAX_SAFE_INTEGER + 1)])]) {
  response = malformed; await assert.rejects(api.loadPluginGithubSync(parent, status, signal));
}
response = raw([repo(0), repo(Number.MAX_SAFE_INTEGER)]); assert.equal((await api.loadPluginGithubSync(parent, status, signal)).repositories.length, 2);
response = raw([repo(1, 'first'), repo(1, 'second')]); assert.equal((await api.loadPluginGithubSync(parent, status, signal)).repositories[0].name, 'first');
let result = await api.searchPluginGithubSync(parent, status, '  q  ', null, signal); assert.equal(result.nextToken, ''); assert.equal(result.repositories[0].proof.query, 'q'); assert.equal(result.repositories[0].proof.pageToken, null);
await api.searchPluginGithubSync(parent, status, 'q', '', signal); assert.equal(searches.at(-1)[2], '');
page = { ...raw([repo('2')]), nextToken: null }; await assert.rejects(api.searchPluginGithubSync(parent, status, '', null, signal));
page = { ...raw([]), nextToken: false }; await assert.rejects(api.searchPluginGithubSync(parent, status, '', null, signal));
const selection = [repo(1), { ...repo(2), proof: { query: 'q', pageToken: '' } }];
response = raw([repo(2), repo(1)]); result = await api.savePluginGithubSync(snapshot, selection, signal); assert.equal(result.confirmed, true);
assert.equal(writes.at(-1)[0].appId, null); assert.equal(writes.at(-1)[1][0].query, undefined); assert.equal(writes.at(-1)[1][1].query, 'q'); assert.equal(writes.at(-1)[1][1].pageToken, '');
const beforeInvalid = writes.length;
for (const selected of [[], [repo(2)], [repo(1), repo(1)], Array.from({ length: 6 }, (_, i) => ({ ...repo(i), proof: { query: '', pageToken: null } }))]) await assert.rejects(api.savePluginGithubSync(snapshot, selected, signal), error => error.code === 'invalid_request');
assert.equal(writes.length, beforeInvalid, 'empty and unsupported selections never POST');
response = raw([repo(1)]); result = await api.savePluginGithubSync(snapshot, selection, signal); assert.equal(result.confirmed, false); assert.ok(result.refreshError);
write = async () => { throw { code: 'network_error' }; }; response = raw([repo(1), repo(2)]);
const unknownWrites = writes.length; result = await api.savePluginGithubSync(snapshot, selection, signal); assert.equal(result.confirmed, true); assert.equal(writes.length, unknownWrites + 1);
response = raw(null); result = await api.savePluginGithubSync(snapshot, selection, signal); assert.equal(result.snapshot, null); assert.equal(result.confirmed, false);
write = async () => { throw { code: 'forbidden' }; }; const readCount = reads.length;
await assert.rejects(api.savePluginGithubSync(snapshot, selection, signal), error => error.code === 'forbidden'); assert.equal(reads.length, readCount);
response = { ...raw(), linkId: 'two' }; write = async () => ({ body: { delivery: 'accepted' } });
await assert.rejects(api.savePluginGithubSync(snapshot, selection, signal), error => error.code === 'github_sync_scope_changed');
response = raw(); onRead = () => { actualIdentity = { ...identity, generation: 3 }; };
await assert.rejects(api.loadPluginGithubSync(parent, status, signal), error => error.code === 'account_changed'); actualIdentity = identity; onRead = () => {};
write = async () => { actualIdentity = { ...identity, userId: 'other' }; return { body: { delivery: 'accepted' } }; };
const beforeIdentity = reads.length; await assert.rejects(api.savePluginGithubSync(snapshot, selection, signal), error => error.code === 'account_changed'); assert.equal(reads.length, beforeIdentity);
actualIdentity = identity; const aborted = new AbortController(); aborted.abort(); await assert.rejects(api.loadPluginGithubSync(parent, status, aborted.signal), error => error.code === 'cancelled');
const sent = []; let wrongIdentity = false;
const bridge = load('src/chatgptService.ts', { './bridge': { tauriInvoke: async (command, args) => { sent.push({ command, args }); return { requestId: args.request.requestId,
  identity: wrongIdentity ? { ...identity, generation: 4 } : identity, body: command.endsWith('_write') ? { delivery: 'accepted' } : raw(), verification: 'pending', readback: null }; } } },
{ crypto: { randomUUID: () => 'github-request' }, navigator: { userAgent: 'fixture', userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'private-device' } });
const target = reads[0][0]; await bridge.readPluginGithubSync(target, identity, signal); assert.equal(sent.at(-1).command, 'plugin_github_sync_read');
await bridge.searchPluginGithubRepositories(target, 'q', '', identity, signal); assert.equal(sent.at(-1).args.request.pageToken, ''); assert.equal(sent.at(-1).command, 'plugin_github_sync_search');
await bridge.writePluginGithubSync(target, [{ id: 2, query: 'q', pageToken: '' }], identity, signal); assert.equal(sent.at(-1).command, 'plugin_github_sync_write'); assert.equal('url' in sent.at(-1).args.request, false);
await bridge.disableServicePluginAppSync('plugin', appId, 'one', 'instance', 'one', identity, signal, true); assert.equal(sent.at(-1).args.request.githubEmptySelection, true);
wrongIdentity = true; await assert.rejects(bridge.readPluginGithubSync(target, identity, signal), /账号发生变化/);
for (const command of ['plugin_github_sync_read', 'plugin_github_sync_search', 'plugin_github_sync_write']) assert.ok(fs.readFileSync('src-tauri/src/lib.rs', 'utf8').includes(`            ${command},`));
console.log('GitHub sync domain: exact gates, metadata allowlist, baseline ordering, safe projected IDs, scoped proof IPC, unknown readback and account isolation passed.');
