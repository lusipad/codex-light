import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const plugin = { id: "tool@market", name: "Tool", installed: true, enabled: true, source: { type: "local", path: "C:/isolated/tool" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const market = { name: "market", path: "C:/isolated/market.json", plugins: [plugin] };
const metadata = summary => ({ summary, marketplaceName: market.name, marketplacePath: market.path, description: "Real metadata", skills: [], apps: [], hooks: [], mcpServers: [] });

function historyWindow(initial = "/settings/plugins-settings") {
  const listeners = new Map(), entries = [{ href: new URL(initial, "https://codex.invalid").href, state: null }];
  let index = 0;
  const location = { href: entries[0].href };
  const fire = () => { location.href = entries[index].href; for (const callback of [...(listeners.get("popstate") ?? [])]) callback({ state: entries[index].state }); };
  const history = {
    get state() { return entries[index].state; },
    pushState(state, _, url) { entries.splice(index + 1); entries.push({ href: new URL(url, location.href).href, state }); index++; location.href = entries[index].href; },
    replaceState(state, _, url) { entries[index] = { href: new URL(url, location.href).href, state }; location.href = entries[index].href; },
    back() { if (index > 0) { index--; fire(); } }, forward() { if (index + 1 < entries.length) { index++; fire(); } },
  };
  return { location, history,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    get length() { return entries.length; }, get index() { return index; },
    count(name) { return listeners.get(name)?.size ?? 0; },
    dispatch(name) { for (const callback of [...(listeners.get(name) ?? [])]) callback({}); },
  };
}

function fixture(initial) {
  const window = historyWindow(initial), calls = [];
  let inventory = { marketplaces: [market] }, read = async () => metadata(plugin), uninstall = async () => {};
  class PluginProtocolError extends Error {}
  const h = harness({ window, confirm: () => { calls.push(["confirm"]); return false; }, plugins: {
    PluginProtocolError,
    pluginRefFor: (summary, source) => source.path ? { pluginName: summary.name, marketplacePath: source.path } : { pluginName: summary.remotePluginId ?? summary.name, remoteMarketplaceName: source.name },
    readPlugin: async reference => { calls.push(["read", reference]); return read(reference); },
    listInstalledPlugins: async () => { calls.push(["inventory"]); if (inventory instanceof Error) throw inventory; return inventory; },
    uninstallPlugin: async id => { calls.push(["uninstall", id]); return uninstall(id); },
  } });
  const nodes = () => h.nodes(h.tree);
  const button = label => nodes().find(node => node.type === "button" && h.text(node).trim() === label);
  const detail = () => nodes().find(node => node.props.className === "pm-managed-detail");
  const open = async () => { const row = nodes().find(node => node.props.className === "pm-managed-plugin-open"); assert.ok(row, "real compact management row exists"); row.props.onClick(); await h.tick(); };
  return { h, window, calls, button, detail, open,
    setInventory(value) { inventory = value; }, setRead(value) { read = value; }, setUninstall(value) { uninstall = value; },
    count(name) { return calls.filter(call => call[0] === name).length; },
    async start() { h.render(); await h.tick(); },
  };
}

const navigation = fixture(); await navigation.start();
assert.ok(navigation.window.count("popstate") >= 2, "history positioning and detail restoration have independent live listeners");
await navigation.open();
let route = new URL(navigation.window.location.href);
assert.equal(route.pathname, "/settings/plugins-settings/hosts/local/plugins/tool%40market");
assert.equal(route.searchParams.get("pluginName"), "Tool");
assert.equal(route.searchParams.get("marketplacePath"), market.path);
assert.deepEqual(navigation.calls.find(call => call[0] === "read")[1], { pluginName: "Tool", marketplacePath: market.path });
assert.ok(navigation.detail()); assert.ok(navigation.button("卸载"));
navigation.h.backManagedDetail(); await navigation.h.tick();
assert.equal(new URL(navigation.window.location.href).pathname, "/settings/plugins-settings"); assert.equal(navigation.detail(), undefined);
navigation.window.history.back(); await navigation.h.tick(); assert.ok(navigation.detail()); assert.equal(navigation.count("read"), 2);
navigation.window.history.back(); await navigation.h.tick();
navigation.setRead(async () => metadata({ ...plugin, id: "different@market", name: "Wrong entity" }));
await navigation.open(); assert.match(navigation.h.text(navigation.h.tree), /身份与目录不一致/);
assert.equal(navigation.button("卸载"), undefined); assert.ok(!navigation.h.text(navigation.h.tree).includes("Wrong entity"));
navigation.h.unmount(); assert.equal(navigation.window.count("popstate"), 0);
console.log("PASS PMD01: actual compact row reads exact source, independent history restores details, wrong entity has no destructive action, listeners release");

const switching = fixture(); await switching.start();
const beforeUrl = switching.window.location.href; let stopped = 0;
switching.h.nodes(switching.h.tree).find(node => node.props.role === "switch").props.onClick({ stopPropagation() { stopped++; } });
await switching.h.tick(); assert.equal(stopped, 1); assert.equal(switching.window.location.href, beforeUrl); assert.equal(switching.count("read"), 0); assert.equal(switching.detail(), undefined);
switching.h.unmount();
console.log("PASS PMD02: actual switch stops propagation, does not read or navigate to management details");

const removed = fixture(); await removed.start(); await removed.open();
const ack = deferred(), readback = deferred(); removed.setUninstall(() => ack.promise);
removed.button("卸载").props.onClick(); removed.button("卸载").props.onClick(); removed.h.render();
assert.equal(removed.count("uninstall"), 1, "synchronous action lock prevents duplicate writes");
removed.setInventory(readback.promise); ack.resolve(); await removed.h.tick();
assert.ok(removed.detail(), "ACK alone does not close or report confirmed removal");
readback.resolve({ marketplaces: [] }); await removed.h.tick();
assert.equal(removed.detail(), undefined); assert.equal(new URL(removed.window.location.href).pathname, "/settings/plugins-settings");
assert.equal(removed.window.length, 2); assert.equal(removed.window.index, 1, "confirmed readback replaces current detail entry rather than adding history");
assert.equal(removed.count("uninstall"), 1); removed.h.unmount();
console.log("PASS PMD03: uninstall is single-flight; ACK waits for actual empty inventory before replacing detail with root");

for (const [label, inventory] of [["read failure", Error("inventory unavailable")], ["partial inventory", { marketplaces: [], marketplaceLoadErrors: [{ marketplacePath: market.path, message: "partial" }] }], ["still installed", { marketplaces: [market] }]]) {
  const pending = fixture(); await pending.start(); await pending.open(); pending.setInventory(inventory);
  pending.button("卸载").props.onClick(); await pending.h.tick();
  assert.ok(pending.detail(), label); assert.equal(pending.count("uninstall"), 1);
  assert.ok(!pending.button("卸载") || pending.button("卸载").props.disabled, `${label} keeps ambiguous write locked`);
  const verify = pending.button("核验卸载结果"); assert.ok(verify, `${label} exposes explicit read-only verification`);
  verify.props.onClick(); await pending.h.tick(); assert.equal(pending.count("uninstall"), 1, `${label} verification never repeats a mutation`);
  assert.ok(pending.detail());
  if (label === "still installed") {
    assert.equal(pending.button("卸载").props.disabled, false, "complete explicit readback allows a subsequent user-chosen retry");
    assert.equal(pending.button("核验卸载结果"), undefined);
    pending.button("卸载").props.onClick(); await pending.h.tick();
    assert.equal(pending.count("uninstall"), 2, "only a subsequent explicit uninstall issues the retry");
  }
  pending.setInventory({ marketplaces: [] }); pending.button("核验卸载结果").props.onClick(); await pending.h.tick();
  assert.equal(pending.detail(), undefined); assert.equal(pending.count("uninstall"), label === "still installed" ? 2 : 1);
  pending.h.unmount();
}
console.log("PASS PMD04: failed, partial and still-installed readbacks retain pending state; explicit verification only reads and absence later closes details");

const aba = fixture(); await aba.start(); await aba.open(); const oldAck = deferred(); aba.setUninstall(() => oldAck.promise);
aba.button("卸载").props.onClick(); aba.h.render();
aba.window.history.back(); await aba.h.tick(); await aba.open();
const reopened = aba.window.location.href; assert.ok(aba.detail());
aba.setInventory({ marketplaces: [] }); oldAck.resolve(); await aba.h.tick();
assert.ok(aba.detail(), "old uninstall completion cannot close a newly opened detail for the same ID");
assert.equal(aba.window.location.href, reopened); assert.equal(aba.count("uninstall"), 1); aba.h.unmount();
console.log("PASS PMD05: back then reopen same plugin isolates late uninstall completion by route request, including ABA identity");

for (const [url, expected] of [
  ["/settings/plugins-settings/hosts/ssh-one/plugins/tool%40market?pluginName=Tool&marketplacePath=C%3A%2Fisolated%2Fmarket.json", /不支持此主机/],
  ["/settings/plugins-settings/tool%40market/permissions?hostId=local", /子页面尚未接入/],
  ["/settings/plugins-settings/tool%40market/sync?hostId=local", /子页面尚未接入/],
  ["/settings/plugins-settings/tool%40market/skills/inspect?hostId=local", /子页面尚未接入/],
  ["/settings/plugins-settings/hosts/local/plugins/tool%40market", /无法确认插件来源/],
  ["/settings/plugins-settings/hosts/local/plugins/tool%40market?marketplacePath=C%3A%2Fisolated%2Fmarket.json", /无法确认插件来源/],
]) {
  const unsupported = fixture(url); await unsupported.start();
  assert.match(unsupported.h.text(unsupported.h.tree), expected); assert.equal(unsupported.count("read"), 0, "unsupported host/subpage or missing source cannot silently use local CLI");
  assert.equal(unsupported.count("uninstall"), 0); assert.equal(unsupported.button("卸载"), undefined); unsupported.h.unmount();
}
console.log("PASS PMD06: unsupported hosts and subpages never fall back to CLI; source-less host routes reject guessing");

for (const [key, value] of [["connectionIdentity", "local:new-account"], ["activeWorkspaceRoot", "C:/different-project"]]) {
  const changed = fixture(); await changed.start(); await changed.open();
  const oldOperation = deferred(); changed.setUninstall(() => oldOperation.promise);
  changed.button("卸载").props.onClick(); changed.h.render();
  changed.h.props[key] = value; changed.h.render(); await changed.h.tick();
  const currentUrl = changed.window.location.href, reads = changed.count("inventory");
  assert.ok(changed.detail(), "new context restores its own current route");
  changed.setInventory({ marketplaces: [] }); oldOperation.resolve(); await changed.h.tick();
  assert.equal(changed.window.location.href, currentUrl, `${key} rejects stale navigation`);
  assert.ok(changed.detail(), `${key} rejects old operation closing current details`);
  assert.equal(changed.count("inventory"), reads, `${key} rejects old operation launching inventory reads into the new context`);
  assert.ok(!changed.h.text(changed.h.tree).includes("已卸载 Tool"), `${key} rejects a stale success toast`);
  assert.equal(changed.count("uninstall"), 1); changed.h.unmount();
}
console.log("PASS PMD07: account/connection and project scope changes isolate old uninstall navigation, readback and success presentation");

const unsupportedWindow = historyWindow("/settings/plugins-settings?hostId=ssh-other"), forbiddenLocalReads = [];
const unsupportedRoot = harness({ window: unsupportedWindow,
  management: { readConfiguredMarketplaces: async () => { forbiddenLocalReads.push("readConfiguredMarketplaces"); return []; } },
  mcpSettings: { readMcpSettings: async () => { forbiddenLocalReads.push("readMcpSettings"); return { entries: [] }; } },
  plugins: Object.fromEntries(["listInstalledPlugins", "listMarketplacePlugins", "listSkills", "listApps", "readPlugin"].map(name => [name, async () => {
    forbiddenLocalReads.push(name); throw Error(`unsupported host attempted ${name}`);
  }])),
  bridge: { tauriInvoke: async method => { forbiddenLocalReads.push(method); return {}; },
    callAppServer: async method => { forbiddenLocalReads.push(method); return {}; } },
});
unsupportedRoot.render(); await unsupportedRoot.tick();
assert.deepEqual(forbiddenLocalReads, [], "explicit unsupported management root must not read local installed/catalog/skills/apps or local/recommended skill RPCs");
assert.equal(unsupportedRoot.nodes(unsupportedRoot.tree).some(node => node.type === unsupportedRoot.McpSettings), false, "unsupported host must not mount local MCP settings boundary");
assert.equal(unsupportedRoot.nodes(unsupportedRoot.tree).some(node => node.props.className === "pm-managed-plugin-open" || node.props.role === "switch"), false, "unsupported host must not present actionable local inventory");
assert.match(unsupportedRoot.text(unsupportedRoot.tree), /不支持此主机/);
unsupportedRoot.unmount();
console.log("PASS PMD08: explicit unsupported management root blocks local plugin/skill/app RPCs and local MCP mount; no actionable local inventory");

const hostTransition = fixture(); await hostTransition.start();
const staleInventory = deferred(); hostTransition.setInventory(staleInventory.promise); hostTransition.window.dispatch("focus");
hostTransition.window.history.pushState({}, "", "/settings/plugins-settings?hostId=ssh-other");
hostTransition.window.history.back(); await hostTransition.h.tick(); hostTransition.window.history.forward(); await hostTransition.h.tick();
const blockedReads = hostTransition.count("inventory");
staleInventory.resolve({ marketplaces: [market] }); await hostTransition.h.tick();
assert.match(hostTransition.h.text(hostTransition.h.tree), /不支持此主机/);
assert.equal(hostTransition.h.nodes(hostTransition.h.tree).some(node => node.props.className === "pm-managed-plugin-open" || node.props.role === "switch" || node.type === hostTransition.h.McpSettings), false);
assert.equal(hostTransition.count("inventory"), blockedReads, "late local inventory cannot trigger more local loads in unsupported host");
hostTransition.setInventory({ marketplaces: [market] }); hostTransition.window.history.back(); await hostTransition.h.tick(); await hostTransition.h.tick();
const localPlugins = hostTransition.h.tabs().find(node => hostTransition.h.text(node) === "插件1");
assert.ok(localPlugins, `local inventory is reloaded and counted after returning: ${hostTransition.h.text(hostTransition.h.tree)}`); localPlugins.props.onClick(); hostTransition.h.render();
assert.ok(hostTransition.h.nodes(hostTransition.h.tree).some(node => node.props.className === "pm-managed-plugin-open"), "return to local history restores real local inventory");
hostTransition.h.unmount();
console.log("PASS PMD09: local to unsupported host history rejects late local inventory; back to local restores the correct scope");

const localDefault = fixture();
const localDefaultPlugin = { ...plugin, installPolicy: "INSTALLED_BY_DEFAULT" };
localDefault.setInventory({ marketplaces: [{ ...market, plugins: [localDefaultPlugin] }] });
localDefault.setRead(async () => metadata(localDefaultPlugin));
localDefault.setUninstall(async () => localDefault.setInventory({ marketplaces: [] }));
await localDefault.start(); await localDefault.open();
try {
  assert.equal(localDefault.button("卸载").props.disabled, false, "the current host contract restricts default installation only for a remote source");
  localDefault.button("卸载").props.onClick(); await localDefault.h.tick();
  assert.equal(localDefault.count("uninstall"), 1);
  assert.equal(localDefault.count("confirm"), 0, "the host uninstall header does not acquire the service confirmation flow");
} finally { localDefault.h.unmount(); }
console.log("PASS PMD10: local default policy is distinct from administrator-protected remote default installation");

const directBreadcrumb = fixture("/settings/plugins-settings/hosts/local/plugins/tool%40market?hostId=local&pluginName=Tool&marketplacePath=C%3A%2Fisolated%2Fmarket.json");
await directBreadcrumb.start();
try {
  directBreadcrumb.h.backManagedDetail(); await directBreadcrumb.h.tick();
  assert.equal(new URL(directBreadcrumb.window.location.href).pathname, "/settings/plugins-settings");
  assert.equal(new URL(directBreadcrumb.window.location.href).search, "", "generic breadcrumb goes to the settings root rather than copying the uninstall-success host query");
} finally { directBreadcrumb.h.unmount(); }
console.log("PASS PMD11: direct-entry breadcrumb uses the generic management root");

for (const entry of ["list", "direct"]) {
  const wrongSource = fixture(entry === "direct" ? "/settings/plugins-settings/hosts/local/plugins/tool%40market?hostId=local&pluginName=Tool&marketplacePath=C%3A%2Fisolated%2Fmarket.json" : undefined);
  wrongSource.setRead(async () => ({ ...metadata(plugin), marketplaceName: "other-market", marketplacePath: "C:/other/market.json" }));
  await wrongSource.start();
  if (entry === "list") await wrongSource.open();
  try {
    assert.equal(wrongSource.button("卸载"), undefined, `${entry} must not expose canonical inventory actions for same-ID metadata from a different source`);
    assert.match(wrongSource.h.text(wrongSource.h.tree), /来源/);
  } finally { wrongSource.h.unmount(); }
}
console.log("PASS PMD12: list and direct-entry responses reject a different marketplace source even with the same plugin ID");
