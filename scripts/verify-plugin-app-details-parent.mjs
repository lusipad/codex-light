import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const location = {}, listeners = new Map(), reads = [], historyWrites = [];
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
}, directory: { readLocalDirectoryListing: async id => { reads.push(id); return detail; } } });
const app = () => view.nodes(view.tree).find(node => node.type === "PluginAppDetailsPage");
const pop = url => { setUrl(url); for (const listener of listeners.get("popstate") ?? []) listener(); view.render(); };
try {
  view.render(); await view.tick();
  assert.equal(app().props.pluginId, "plugin/real"); assert.equal(app().props.appId, "asdk_app_A");
  assert.equal(reads.length, 0, "app route uses its scoped service reader instead of a competing plugin-only load");
  assert.ok(!view.text(view.tree).includes("此插件管理子页面尚未接入"));
  const initialKey = app().props.key;
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B"); await view.tick();
  assert.equal(app().props.appId, "connector_B"); assert.notEqual(app().props.key, initialKey);
  const retiredMembership = app().props.onUnavailable;
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B/permissions"); await view.tick();
  retiredMembership(); await view.tick();
  assert.ok(location.pathname.endsWith("/permissions"), "retired detail result cannot redirect an independently opened subpage");
  pop("/settings/plugins-settings/plugin%2Freal/apps/connector_B"); await view.tick();
  view.props.connectionIdentity = "account-B"; view.render(); await view.tick();
  assert.equal(app().props.connectionIdentity, "account-B");
  app().props.onOpenPlugin(); await view.tick();
  assert.equal(location.pathname, "/settings/plugins-settings/plugin%2Freal");
  assert.equal(app(), undefined); assert.equal(reads.at(-1), "plugin/real");
  assert.ok(view.nodes(view.tree).find(node => node.type === "PluginManagementDetail"));
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
