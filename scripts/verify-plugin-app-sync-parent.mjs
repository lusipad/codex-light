import assert from 'node:assert/strict';
import { harness } from './verify-plugin-management-ui-b.mjs';
const location = {}, listeners = new Map(), historyWrites = [], directoryReads = [];
const notifications = [];
let appReads = 0, serviceReads = 0, refreshFails = false, nextServiceRead = null;
const setUrl = input => { const url = new URL(input, 'https://private.test'); Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash }); };
setUrl('/settings/plugins-settings/plugin%2Freal/sync?linkId=one');
const view = harness({ window: { location, history: { state: {}, replaceState(state, _title, url) { this.state = state; historyWrites.push(['replace', url]); setUrl(url); },
  pushState(state, _title, url) { this.state = state; historyWrites.push(['push', url]); setUrl(url); } },
  addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
  removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
}, directory: { readLocalDirectoryListing: async id => { directoryReads.push(id); throw Error('No competing detail read expected'); } },
plugins: { listApps: async () => { appReads++; return { data: [] }; } },
remote: { loadRemotePlugins: async () => { serviceReads++; const gate = nextServiceRead; nextServiceRead = null; if (gate) await gate; return { identity: null, marketplace: null, unsupported: false, error: refreshFails ? 'Offline' : null }; } } });
view.props.onNotify = (...args) => notifications.push(args);
const page = type => view.nodes(view.tree).find(node => node.type === type);
const sync = () => page('PluginAppSyncPage');
const pop = url => { setUrl(url); for (const listener of listeners.get('popstate') ?? []) listener(); view.render(); };
try {
  view.render(); await view.tick();
  assert.ok(sync()); assert.equal(sync().props.pluginId, 'plugin/real'); assert.equal(sync().props.appId, null); assert.equal(sync().props.selectedLinkId, 'one');
  assert.equal(directoryReads.length, 0);
  const beforeApps = appReads, beforeService = serviceReads;
  sync().props.onUpdated(); await view.tick(); assert.ok(appReads > beforeApps); assert.ok(serviceReads > beforeService);
  let releaseService; nextServiceRead = new Promise(resolve => { releaseService = resolve; });
  const errorCount = notifications.length; sync().props.onUpdated(); sync().props.onUpdated(); await view.tick(); releaseService(); await view.tick();
  assert.equal(notifications.length, errorCount, 'a superseded refresh cannot report a stale failure');
  refreshFails = true; sync().props.onUpdated(); await view.tick(); assert.deepEqual(notifications.at(-1), ['同步已更新，但无法刷新应用状态', 'error']); refreshFails = false;
  const oldRoot = sync().props.onRoot, oldUnavailable = sync().props.onUnavailable;
  const oldUpdated = sync().props.onUpdated;
  pop('/settings/plugins-settings/plugin%2Freal/sync?linkId=two'); await view.tick();
  const count = historyWrites.length, oldRefreshCount = serviceReads; oldRoot(); oldUnavailable(); oldUpdated(); await view.tick(); assert.equal(historyWrites.length, count, 'old link callbacks do not redirect the new link'); assert.equal(serviceReads, oldRefreshCount);
  pop('/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A/sync?linkId=two'); await view.tick(); assert.equal(sync().props.appId, 'asdk_app_A');
  sync().props.onUnavailable(); await view.tick(); assert.equal(location.pathname, '/settings/plugins-settings/plugin%2Freal'); assert.equal(historyWrites.at(-1)[0], 'replace');
  pop('/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A?keep=drop&linkId=old#old'); await view.tick();
  assert.ok(page('PluginAppDetailsPage')); const retiredOpen = page('PluginAppDetailsPage').props.onSync;
  pop('/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A?linkId=new'); await view.tick();
  const beforeStale = historyWrites.length; retiredOpen('old'); await view.tick(); assert.equal(historyWrites.length, beforeStale);
  page('PluginAppDetailsPage').props.onSync('actual/?中文'); await view.tick();
  assert.equal(location.pathname, '/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A/sync');
  assert.equal(new URL(location.href).searchParams.get('linkId'), 'actual/?中文'); assert.equal(new URL(location.href).searchParams.size, 1); assert.equal(location.hash, ''); assert.ok(sync());
  const retired = sync().props.onRoot; view.props.connectionIdentity = 'other'; view.render(); await view.tick(); view.props.connectionIdentity = 'local:one'; view.render(); await view.tick();
  const beforeABA = historyWrites.length; retired(); await view.tick(); assert.equal(historyWrites.length, beforeABA);
  sync().props.onRoot(); await view.tick(); assert.equal(location.pathname, '/settings/plugins-settings');
  pop('/settings/plugins-settings/plugin/sync?hostId=ssh'); await view.tick(); assert.equal(sync(), undefined);
  pop('/settings/plugins-settings/apps/app'); await view.tick(); assert.equal(sync(), undefined);
} finally { view.unmount(); }
assert.equal([...listeners.values()].reduce((count, entries) => count + entries.size, 0), 0);
console.log('App sync parent: canonical/explicit readers, actual-link navigation, query replacement, stale/ABA/host/standalone guards passed.');
