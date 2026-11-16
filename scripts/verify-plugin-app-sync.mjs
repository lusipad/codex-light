import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const load = (file, imports = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => imports[name] ?? {} });
  return exports;
};
const canonicalMcpAppId = load('src/pluginManagementMcp.ts').canonicalMcpAppId;
const helpers = load('src/pluginAppDetails.ts', { './pluginManagementMcp': { canonicalMcpAppId } });
const api = load('src/pluginAppSync.ts', { './pluginAppDetails': helpers, './pluginManagementMcp': { canonicalMcpAppId } });
const link = (id, extra = {}) => ({ id, connector_id: 'connector_A', owners: [], ...extra });
const status = (extra = {}) => ({ user_connection_details: { auth_status: 'user_connected', connector_id: 'connector_A', backing_link_id: 'one',
  connection_instance_id: 'instance', activation_status: 'activated', ...extra } });
const details = (extra = {}) => ({ pluginId: 'plugin', pluginName: 'Plugin', appId: 'asdk_app_A', connector: { id: 'connector_A', name: 'App', enable_multi_links: true },
  links: [link('one'), link('two')], linksError: null, ...extra });
const one = status(), two = status({ backing_link_id: 'two' });
let selection = api.selectPluginAppSync(details(), 'one', [one, two]);
assert.equal(selection.selectedLink.id, 'one'); assert.equal(selection.statuses.length, 1); assert.equal(selection.statuses[0], one);
selection = api.selectPluginAppSync(details(), 'two', [one, two]); assert.equal(selection.statuses[0], two);
selection = api.selectPluginAppSync(details({ connector: { id: 'connector_A', name: 'App', enable_multi_links: false } }), 'two', [one, two]);
assert.equal(selection.selectedLink.id, 'one', 'single-account connectors ignore foreign URL selection');
assert.throws(() => api.selectPluginAppSync(details({ links: null, linksError: { code: 'offline', message: 'Unavailable' } }), 'one', [one]));
const hidden = details({ links: [link('one', { visibility: 'HIDDEN' }), link('implicit_link::system'), link('two')] });
selection = api.selectPluginAppSync(hidden, 'one', [one, two]); assert.equal(selection.selectedLink.id, 'two'); assert.equal(selection.statuses[0], two);
const match = (app, links, statuses, legacy = false) => api.matchPluginAppSyncStatuses(app, links, statuses, legacy);
assert.equal(match('asdk_app_A', [link('one')], [one]).length, 1);
assert.equal(match('connector_B', [link('one')], [one]).length, 0);
assert.equal(match('connector_A', [link('one', { connector_id: 'connector_B' })], [one]).length, 0);
assert.equal(match('connector_A', [], [one]).length, 0);
assert.equal(match('connector_A', [link('one')], [status({ auth_status: 'disconnected' })]).length, 0);
const gmail = 'connector_2128aebfecb84f64a069897515042a44';
const gmailStatus = status({ backing_link_id: null, connection_type: 'gmail_sync_connector' });
assert.equal(match(gmail, [], [gmailStatus], true).length, 1);
assert.equal(match(gmail, [], [gmailStatus], false).length, 0);
assert.equal(match(gmail, [], [status({ ...gmailStatus.user_connection_details, backing_link_id: 'other' })], true).length, 0);
const gmailDetails = details({ appId: gmail, connector: { id: gmail, name: 'Gmail', enable_multi_links: true }, links: [link('one', { connector_id: gmail }), link('two', { connector_id: gmail })] });
assert.equal(api.selectPluginAppSync(gmailDetails, 'one', [gmailStatus]).statuses.length, 0, 'multi-account legacy fallback must not borrow another account');
assert.equal(api.selectPluginAppSync({ ...gmailDetails, links: [gmailDetails.links[0]] }, 'one', [gmailStatus]).statuses.length, 1);
const mapping = [
  ['connector_1ee51bd730c272434e1b17c46f8a2397', 'connector_69c18c28f1188191bf5b8445c4ab0a2e'],
  ['connector_bef400199679ee9f67f080058d5c9e89', 'connector_4aaab2856305417b993eca9a216aaf6e'],
  ['connector_5ae2fd76f08447718080f11bc2faac6c', 'connector_1e4f6a44acf14e3ca1d96672f8c945bc'],
  ['connector_601cc22bb3b740599c7274cf7e8084e8', 'connector_246af0940da3457da0e751171dc1ce60'],
];
for (const [admin, app] of mapping) {
  const row = status({ auth_status: 'admin_connected', connector_id: admin, backing_link_id: null });
  assert.equal(match(app, [], [row]).length, 1); assert.equal(match('connector_other', [], [row], true).length, 0);
  assert.equal(api.pluginAppSyncCanDisable(row, { id: 'account', structure: 'personal' }, 'account'), false);
}
for (const activation of ['activated', 'partially_activated', 'activating']) {
  const row = status({ auth_status: 'pending', knowledge_connector_type: 'google_drive_dwd', activation_status: activation });
  assert.equal(match('connector_A', [], [row]).length, activation === 'activating' ? 0 : 1);
}
assert.equal(match('connector_A', [], [status({ auth_status: 'admin_managed_disconnected', knowledge_connector_type: 'google_drive_dwd' })]).length, 0);
const outlook = status({ auth_status: 'admin_connected', connector_id: null, backing_link_id: null, connection_type: 'outlook_admin_sync_connector' });
assert.equal(match(mapping[1][1], [], [outlook], true).length, 1);
assert.equal(match(mapping[1][1], [], [outlook], false).length, 0);
assert.equal(match(mapping[1][1], [], [status({ ...outlook.user_connection_details, connector_id: 'connector_other' })], true).length, 0, 'legacy fallback only when admin identity is null');
const syncing = status({ activation_status: 'partially_activated' }), inactive = status({ activation_status: 'unknown' });
assert.equal(api.pluginAppSyncSummary([inactive, one, syncing]), syncing); assert.equal(api.pluginAppSyncSummary([inactive, one]), one);
assert.equal(api.pluginAppSyncSummary([inactive]), inactive); assert.equal(api.pluginAppSyncSummary([]), null);
assert.equal(api.pluginAppSyncBadge('activating').label, '正在同步'); assert.equal(api.pluginAppSyncBadge('partially_activated').label, '正在同步');
assert.equal(api.pluginAppSyncBadge('activated').variant, 'success'); assert.equal(api.pluginAppSyncBadge('unknown').label, '未同步');
assert.equal(api.pluginAppSyncUpdatedAt(status({ last_full_sync_completed_at: 'full', last_delta_sync_completed_at: 'delta' })), 'full');
assert.equal(api.pluginAppSyncUpdatedAt(status({ last_full_sync_completed_at: null, last_delta_sync_completed_at: 'delta' })), 'delta');
assert.equal(api.pluginAppSyncUpdatedAt(one), null);
assert.equal(api.pluginAppSyncCanDisable(one, { id: 'account', structure: 'personal' }, 'account'), true);
assert.equal(api.pluginAppSyncCanDisable(one, null, 'account'), false);
assert.equal(api.pluginAppSyncCanDisable(one, { id: 'other', structure: 'personal' }, 'account'), false);
assert.equal(api.pluginAppSyncCanDisable(status({ connection_instance_id: '' }), { id: 'account', structure: 'personal' }, 'account'), true);
assert.equal(api.pluginAppSyncCanDisable(status({ connection_instance_id: '', backing_link_id: null }), { id: 'account', structure: 'personal' }, 'account'), false);
assert.equal(api.pluginAppSyncCanDisable(status({ connection_instance_id: '' }), { id: 'account', structure: 'team' }, 'account'), false);
assert.equal(api.pluginAppSyncCanDisable(one, { id: 'account', structure: 'team' }, 'account'), true, 'no invented personal/owner gate for ordinary disconnect');
console.log('Plugin App sync matching, account selection, admin and legacy branches, badges and eligibility passed.');
