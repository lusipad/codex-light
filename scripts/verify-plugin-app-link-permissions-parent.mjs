import assert from 'node:assert/strict';
import { harness } from './verify-plugin-management-ui-b.mjs';
const location = {}, listeners = new Map(), historyWrites = [], directoryReads = [];
const setUrl = input => { const url = new URL(input, 'https://private.test'); Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash }); };
setUrl('/settings/plugins-settings/plugin%2Freal/permissions?keep=literal%2Fvalue&linkId=one#anchor');
const summary = { id: 'plugin/real', remotePluginId: 'plugin/real', name: 'Real plugin', installed: true, enabled: true,
  source: { type: 'remote' }, installPolicy: 'AVAILABLE', authPolicy: 'ON_USE' };
const detail = { summary, marketplaceName: 'chatgpt-workspace', marketplacePath: null, apps: [], skills: [], hooks: [], mcpServers: [] };
const view = harness({ window: { location, history: { state: {}, replaceState(state, _title, url) { this.state = state; historyWrites.push(['replace', url]); setUrl(url); },
  pushState(state, _title, url) { this.state = state; historyWrites.push(['push', url]); setUrl(url); } },
  addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
  removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
}, directory: { readLocalDirectoryListing: async id => { directoryReads.push(id); return detail; } } });
const page = () => view.nodes(view.tree).find(node => node.type === 'PluginAppLinkPermissionsPage');
const pop = url => { setUrl(url); for (const listener of listeners.get('popstate') ?? []) listener(); view.render(); };
try {
  view.render(); await view.tick();
  assert.ok(page()); assert.equal(page().props.pluginId, 'plugin/real'); assert.equal(page().props.appId, null);
  assert.equal(page().props.selectedLinkId, 'one'); assert.equal(directoryReads.length, 0, 'the service permissions reader resolves canonical identity, not a competing CLI detail');
  const key = page().props.key; const firstWrite = historyWrites.length;
  assert.equal(page().props.onSelectLink('link/?中文'), true); await view.tick();
  assert.equal(page().props.key, key); assert.equal(page().props.selectedLinkId, 'link/?中文');
  assert.equal(historyWrites[firstWrite][0], 'replace'); assert.equal(new URL(location.href).searchParams.get('keep'), 'literal/value');
  assert.equal(new URL(location.href).hash, '#anchor');
  assert.equal(page().props.onSelectLink(null), true); await view.tick();
  assert.equal(location.pathname, '/settings/plugins-settings/plugin%2Freal/permissions'); assert.equal(page().props.selectedLinkId, null);
  const retiredSelect = page().props.onSelectLink, retiredUnavailable = page().props.onUnavailable;
  pop('/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A/permissions?linkId=unknown'); await view.tick();
  assert.equal(page().props.appId, 'asdk_app_A'); assert.notEqual(page().props.key, key); assert.equal(page().props.selectedLinkId, 'unknown');
  assert.equal(retiredSelect('old'), false); const beforeStale = historyWrites.length; retiredUnavailable('plugin'); await view.tick(); assert.equal(historyWrites.length, beforeStale);
  const unavailableWrite = historyWrites.length; page().props.onUnavailable('detail'); await view.tick();
  assert.equal(location.pathname, '/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A'); assert.equal(historyWrites[unavailableWrite][0], 'replace'); assert.equal(page(), undefined);
  pop('/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A/permissions'); await view.tick();
  const invalidMemberWrite = historyWrites.length; page().props.onUnavailable('plugin'); await view.tick();
  assert.equal(location.pathname, '/settings/plugins-settings/plugin%2Freal'); assert.equal(historyWrites[invalidMemberWrite][0], 'replace');
  pop('/settings/plugins-settings/plugin%2Freal/permissions'); await view.tick();
  const oldAccount = page().props.onSelectLink;
  view.props.connectionIdentity = 'other-account'; view.render(); await view.tick();
  view.props.connectionIdentity = 'local:one'; view.render(); await view.tick(); assert.equal(oldAccount('ABA'), false);
  page().props.onPlugin(); await view.tick(); assert.equal(location.pathname, '/settings/plugins-settings/plugin%2Freal'); assert.equal(historyWrites.at(-1)[0], 'push');
  pop('/settings/plugins-settings/plugin%2Freal/permissions'); await view.tick(); page().props.onRoot(); await view.tick(); assert.equal(location.pathname, '/settings/plugins-settings');
  pop('/settings/plugins-settings/plugin/permissions?hostId=ssh'); await view.tick(); assert.equal(page(), undefined);
  pop('/settings/plugins-settings/apps/app'); await view.tick(); assert.equal(page(), undefined, 'standalone app management cannot acquire an arbitrary link-permission editor');
  assert.equal(view.calls.filter(call => ['toggle', 'run'].includes(call[0])).length, 0);
} finally { view.unmount(); }
assert.equal([...listeners.values()].reduce((count, entries) => count + entries.size, 0), 0);
console.log('App link permission parent: canonical/explicit route separation, exact URL selection replacement, same reader lifetime, denied/member redirects, host/standalone isolation, stale/ABA guards and listener cleanup passed.');
