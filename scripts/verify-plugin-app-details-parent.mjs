import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const location = {}, listeners = new Map(), reads = [], historyWrites = [], notifications = [];
let accountAppReads = 0, serviceReads = 0, refreshFails = false, nextServiceRead = null;
const setUrl = input => {
  const url = new URL(input, "https://private.test");
  Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash });
};
setUrl("/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A");
const summary = { id: "plugin/real", remotePluginId: "plugin/real", name: "Actual plugin", installed: true, enabled: true,
  source: { type: "remote" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const detail = { summary, marketplaceName: "chatgpt-workspace", marketplacePath: null, apps: [], skills: [], hooks: [], mcpServers: [] };
const view = harness({ window: { location, history: { state: {},
  replaceState(state, _title, url) { this.state = state; historyWrites.push(["replace", url]); setUrl(url); }, pushState(state, _title, url) { this.state = state; historyWrites.push(["push", url]); setUrl(url); } },
  addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
  removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
}, directory: { readLocalDirectoryListing: async id => { reads.push(id); return detail; } },
plugins: { listApps: async () => { accountAppReads++; return { data: [] }; } },
remote: { loadRemotePlugins: async () => { serviceReads++; const gate = nextServiceRead; nextServiceRead = null; if (gate) await gate; return { identity: null, marketplace: null, unsupported: false, error: refreshFails ? 'Refresh offline' : null }; } } });
view.props.onNotify = (...args) => notifications.push(args);
const app = () => view.nodes(view.tree).find(node => node.type === "PluginAppDetailsPage");
const pop = url => { setUrl(url); for (const listener of listeners.get("popstate") ?? []) listener(); view.render(); };
try {
  view.render(); await view.tick();
  assert.equal(app().props.pluginId, "plugin/real"); assert.equal(app().props.appId, "asdk_app_A");
  assert.equal(reads.length, 0, "app route uses its scoped service reader instead of a competing plugin-only load");
  assert.ok(!view.text(view.tree).includes("此插件管理子页面尚未接入"));
  const initialKey = app().props.key;
  pop("/settings/plugins-settings/plugin%2Freal/apps/asdk_app_A?keep=literal%2Fvalue&linkId=old"); await view.tick();
  assert.equal(app().props.selectedLinkId, "old"); const retiredSelection = app().props.onSelectLink;
  const selectionWrite = historyWrites.length;
  assert.equal(app().props.onSelectLink("second/?中文"), true); await view.tick();
  assert.equal(new URL(location.href).searchParams.get("keep"), "literal/value");
  assert.equal(app().props.selectedLinkId, "second/?中文"); assert.equal(historyWrites[selectionWrite][0], "replace");
  const conditionalWrites = historyWrites.length;
  assert.equal(app().props.onSelectLink(null, "old"), false, "late removal fallback cannot overwrite the live URL's newer account selection");
  assert.equal(historyWrites.length, conditionalWrites);
  assert.equal(app().props.onSelectLink("healthy-after-delete", "second/?中文"), true);
  await view.tick(); assert.equal(app().props.selectedLinkId, "healthy-after-delete");
  assert.equal(app().props.key, initialKey, "selection does not remount the current App reader or discard its dialog draft");
  const appReadsBeforeDisconnect = accountAppReads, serviceReadsBeforeDisconnect = serviceReads;
  app().props.onDisconnected(); assert.deepEqual(notifications.at(-1), ['账户已断开连接', 'success']);
  await view.tick(); assert.ok(accountAppReads > appReadsBeforeDisconnect); assert.ok(serviceReads > serviceReadsBeforeDisconnect, 'confirmed disconnect refreshes real service inventory too');
  let releaseService; nextServiceRead = new Promise(resolve => { releaseService = resolve; });
  const errorsBeforeOverlap = notifications.filter(item => item[1] === 'error').length;
  app().props.onDisconnected(); app().props.onDisconnected(); await view.tick(); releaseService(); await view.tick();
  assert.equal(notifications.filter(item => item[1] === 'error').length, errorsBeforeOverlap, 'a superseded refresh cannot report failure after its replacement succeeds');
  refreshFails = true; app().props.onDisconnected(); await view.tick();
  assert.deepEqual(notifications.at(-1), ['账户已更新，但无法刷新账户列表', 'error'], 'refresh failure is distinct from an unconfirmed DELETE and never replays it');
  refreshFails = false;
  const retiredDisconnect = app().props.onDisconnected;
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B"); await view.tick();
  assert.equal(app().props.appId, "connector_B"); assert.notEqual(app().props.key, initialKey);
  const notificationsBeforeStale = notifications.length; retiredDisconnect(); await view.tick(); assert.equal(notifications.length, notificationsBeforeStale);
  assert.equal(retiredSelection("stale selection"), false, "retired parent rejects selection before the child persists it");
  assert.equal(new URL(location.href).searchParams.has("linkId"), false);
  const retiredMembership = app().props.onUnavailable;
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B/permissions"); await view.tick();
  retiredMembership(); await view.tick();
  assert.ok(location.pathname.endsWith("/permissions"), "retired detail result cannot redirect an independently opened subpage");
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B"); await view.tick();
  view.props.connectionIdentity = "account-B"; view.render(); await view.tick();
  assert.equal(app().props.connectionIdentity, "account-B");
  app().props.onOpenPlugin(); await view.tick();
  assert.equal(location.pathname, "/settings/plugins-settings/plugin%2Freal");
  assert.equal(app(), undefined); assert.deepEqual(reads, [], "service root navigation must not restore a local CLI detail");
  const root = view.nodes(view.tree).find(node => node.type === "PluginCanonicalRootPage");
  assert.ok(root); assert.equal(root.props.pluginId, "plugin/real");
  pop("/settings/plugins-settings/plugin%2Freal/apps/stale"); await view.tick();
  const previousWrites = historyWrites.length;
  app().props.onUnavailable(); await view.tick();
  assert.equal(location.pathname, "/settings/plugins-settings/plugin%2Freal");
  assert.equal(historyWrites[previousWrites][0], "replace", "expired membership replaces its broken deep link rather than trapping Back on it");
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B"); await view.tick();
  app().props.onBack(); await view.tick();
  assert.equal(location.pathname, "/settings/plugins-settings"); assert.equal(app(), undefined);
  pop("/settings/plugins-settings/plugin/apps/app?hostId=ssh"); await view.tick();
  assert.equal(app(), undefined, "an explicit remote host must not acquire the local service App reader");
  pop("/settings/plugins-settings/apps/app"); await view.tick();
  assert.equal(app(), undefined, "standalone app association is a separate route, not an assumed plugin owner");
  const entry = view.nodes(view.tree).find(node => node.type === "PluginAppEntryPage");
  assert.equal(entry.props.appId, "app");
  const beforeResolve = view.nodes(view.tree).find(node => node.type === "PluginAppEntryPage").props.onResolvePlugin;
  entry.props.onResolvePlugin("real/owner"); await view.tick();
  assert.equal(location.pathname, "/settings/plugins-settings/real%2Fowner/apps/app");
  assert.equal(app().props.pluginId, "real/owner");
  pop("/settings/plugins-settings/apps/other"); await view.tick();
  beforeResolve("wrong-owner"); await view.tick();
  assert.equal(location.pathname, "/settings/plugins-settings/apps/other", "a retired entry response cannot steal a different current app");
  assert.equal(view.calls.filter(call => ["toggle", "run"].includes(call[0])).length, 0);
} finally { view.unmount(); }
assert.equal([...listeners.values()].reduce((count, items) => count + items.size, 0), 0);
console.log("App details parent: real route identities, separate read consumer, remount/scope, plugin/root ancestors, host isolation, canonical entry redirect and stale response protection, no writes and listener cleanup passed.");
