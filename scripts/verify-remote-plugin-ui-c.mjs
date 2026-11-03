import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const actual = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/remotePlugins.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: actual, require: () => ({}), AbortController });
const identity = { accountId: "account-A", userId: "user-A", generation: 1 };
const raw = (id = "raw-1", name = "remote-tool", extra = {}) => ({ id, name, enabled: true, status: "ENABLED", release: { display_name: name }, ...extra });
const snapshot = (rows = [raw()], account = identity) => ({ identity: account, marketplace: actual.mapRemotePlugins(rows), error: null, unsupported: false });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup(options = {}) {
  let service = options.snapshot ?? snapshot(), load = async () => service, mode = "confirmed", runtimeFail = false;
  const calls = [], signals = [];
  const remote = {
    mergePluginInventories: actual.mergePluginInventories,
    loadRemotePlugins: signal => { calls.push(["inventory"]); signals.push(signal); return load(signal); },
    manageRemotePlugin: async (plugin, operation, account, signal) => {
      calls.push(["mutation", plugin.remotePluginId, operation, account]); signals.push(signal);
      if (mode === "pending") return { verification: "pending", snapshot: null, error: "delivery unknown" };
      const rows = operation === "uninstall" ? [] : [raw(plugin.remotePluginId, plugin.name, { enabled: operation === "enable" })];
      service = snapshot(rows, account); return { verification: "confirmed", snapshot: service, error: null };
    },
    verifyRemotePlugin: async (plugin, operation, account, signal) => {
      calls.push(["verify", plugin.remotePluginId, operation, account]); signals.push(signal);
      return mode === "pending" ? { verification: "pending", snapshot: service, error: "not synchronized" } : { verification: "confirmed", snapshot: service, error: null };
    },
    ...options.remote,
  };
  const plugins = {
    listSkills: async () => { calls.push(["skills"]); if (runtimeFail) throw Error("runtime offline"); return { data: [] }; },
    listApps: async () => { calls.push(["apps"]); return { data: [] }; },
    uninstallPlugin: async () => { calls.push(["LOCAL_UNINSTALL"]); throw Error("remote cannot use local uninstall"); },
    ...options.plugins,
  };
  const h = harness({ remote, plugins, confirm: options.confirm });
  h.setInstalled({ marketplaces: [] });
  return { h, calls, signals, setSnapshot(value) { service = value; }, setLoad(value) { load = value; }, setMode(value) { mode = value; }, runtimeFailure(value) { runtimeFail = value; } };
}
const card = (h, name) => { const node = h.nodes(h.tree).find(node => node.props.className?.includes("pm-plugin-card") && h.text(node).includes(name)); assert.ok(node, `card ${name}`); return node; };
const toggle = (h, name) => h.nodes(card(h, name)).find(node => node.props.role === "switch");
const uninstall = (h, name) => h.nodes(card(h, name)).find(node => node.type === "button" && h.text(node).trim() === "卸载");

{
  const f = setup(); f.h.render(); await f.h.tick();
  assert.ok(f.h.tabs().some(node => f.h.text(node) === "插件 (1)")); assert.equal(toggle(f.h, "remote-tool").props.disabled, false);
  f.setLoad(async () => ({ identity: null, marketplace: null, error: "service unavailable", unsupported: false })); f.h.focus(); await f.h.tick();
  assert.match(f.h.text(f.h.tree), /service unavailable/); assert.ok(card(f.h, "remote-tool")); assert.equal(toggle(f.h, "remote-tool").props.disabled, true, "failed service refresh retains visible facts but disables stale writes");
  f.h.unmount();
  const local = setup({ snapshot: { identity: null, marketplace: null, error: "remote offline", unsupported: false } });
  local.h.setInstalled({ marketplaces: [{ name: "local", plugins: [{ id: "local-id", name: "Local", installed: true, enabled: true, source: { type: "local", path: "local" }, installPolicy: "AVAILABLE" }] }] });
  local.h.render(); await local.h.tick(); assert.ok(card(local.h, "Local")); assert.equal(toggle(local.h, "Local").props.disabled, false); local.h.unmount();
  const serviceOnly = setup({ plugins: { listInstalledPlugins: async () => { throw Error("local inventory failed"); } } });
  serviceOnly.h.render(); await serviceOnly.h.tick(); assert.ok(card(serviceOnly.h, "remote-tool")); assert.match(serviceOnly.h.text(serviceOnly.h.tree), /local inventory failed/); serviceOnly.h.unmount();
}
console.log("PASS RPC-UI01: independent CLI/service loading, partial failures retain the other source and stale service facts remain visibly restricted");
{
  const f = setup({ snapshot: snapshot([raw("raw-1", "Same"), raw("raw-2", "Same")]) });
  f.h.setInstalled({ marketplaces: [{ name: "cli", path: "local", plugins: [
    { id: "execution-id", name: "Same", remotePluginId: "raw-1", installed: true, enabled: false, source: { type: "local", path: "cli-executor" }, installPolicy: "AVAILABLE" },
    { id: "custom-local", name: "Same", installed: true, enabled: true, source: { type: "local", path: "custom" }, installPolicy: "AVAILABLE" },
  ] }] });
  f.h.render(); await f.h.tick();
  assert.ok(f.h.tabs().some(node => f.h.text(node) === "插件 (3)"));
  const cards = f.h.nodes(f.h.tree).filter(node => node.props.className?.includes("pm-plugin-card")); assert.equal(cards.length, 3);
  const execution = cards.find(node => f.h.text(node).includes("execution-id")); assert.ok(execution);
  f.h.nodes(execution).find(node => node.props.role === "switch").props.onClick(); await f.h.tick();
  assert.equal(f.calls.find(call => call[0] === "mutation")[1], "raw-1", "CLI execution source retained by merge must still dispatch the matched raw id to service");
  assert.equal(f.calls.filter(call => call[0] === "LOCAL_UNINSTALL").length, 0); f.h.unmount();
}
console.log("PASS RPC-UI02: actual mapper/merge deduplicates raw ids, retains local same-name entries and dispatches service-backed CLI execution rows using raw identity");
{
  const f = setup(); f.setMode("pending"); f.h.render(); await f.h.tick();
  const button = toggle(f.h, "remote-tool"); button.props.onClick(); button.props.onClick(); await f.h.tick();
  assert.equal(f.calls.filter(call => call[0] === "mutation").length, 1); assert.equal(toggle(f.h, "remote-tool").props.disabled, true);
  f.h.button("核验远程操作结果").props.onClick(); await f.h.tick(); f.h.button("核验远程操作结果").props.onClick(); await f.h.tick();
  assert.equal(f.calls.filter(call => call[0] === "mutation").length, 1); assert.equal(f.calls.filter(call => call[0] === "verify").length, 2);
  f.setSnapshot(snapshot([raw("raw-1", "remote-tool", { enabled: false })])); f.setMode("confirmed");
  f.h.button("核验远程操作结果").props.onClick(); await f.h.tick(); assert.equal(toggle(f.h, "remote-tool").props["aria-checked"], false);
  f.runtimeFailure(true); toggle(f.h, "remote-tool").props.onClick(); await f.h.tick();
  assert.equal(toggle(f.h, "remote-tool").props["aria-checked"], true); assert.match(f.h.text(f.h.tree), /插件变更已确认，但运行时刷新失败/);
  const mutations = f.calls.filter(call => call[0] === "mutation").length; f.runtimeFailure(false); f.h.button("重新刷新运行时").props.onClick(); await f.h.tick();
  assert.equal(f.calls.filter(call => call[0] === "mutation").length, mutations); assert.ok(!f.h.text(f.h.tree).includes("runtime offline"));
  uninstall(f.h, "remote-tool").props.onClick(); await f.h.tick(); assert.ok(!f.h.nodes(f.h.tree).some(node => node.props.className?.includes("pm-plugin-card") && f.h.text(node).includes("remote-tool")));
  assert.equal(f.calls.filter(call => call[0] === "LOCAL_UNINSTALL").length, 0); f.h.unmount();
}
console.log("PASS RPC-UI03/04/05: remote toggle/uninstall only use service, pending retries only read, and confirmed service facts survive independent runtime refresh failure");
{
  for (const extra of [{ installation_policy: "INSTALLED_BY_DEFAULT" }, { status: "DISABLED_BY_ADMIN" }, { authentication_policy: "UNKNOWN" }]) {
    const f = setup({ snapshot: snapshot([raw("raw-1", "restricted", extra)]) }); f.h.render(); await f.h.tick();
    if (extra.installation_policy) { assert.equal(toggle(f.h, "restricted").props.disabled, false); assert.ok(f.h.nodes(card(f.h, "restricted")).some(node => node.type === "button" && f.h.text(node).trim() === "由管理员安装" && node.props.disabled)); }
    else assert.equal(toggle(f.h, "restricted").props.disabled, true);
    if (extra.authentication_policy) { assert.match(f.h.text(f.h.tree), /无法识别此插件的服务策略/); assert.equal(uninstall(f.h, "restricted").props.disabled, true); }
    assert.equal(f.calls.filter(call => call[0] === "mutation").length, 0); f.h.unmount();
  }
  const cancel = setup({ confirm: () => false }); cancel.h.render(); await cancel.h.tick(); uninstall(cancel.h, "remote-tool").props.onClick(); await cancel.h.tick();
  assert.equal(cancel.calls.filter(call => call[0] === "mutation").length, 0); cancel.h.unmount();
}
console.log("PASS RPC-UI06: admin toggle and default remote uninstall restrictions remain distinct, unknown policies block writes, and canceled uninstall sends nothing");
{
  const late = deferred(), f = setup({ remote: { manageRemotePlugin: async () => late.promise } }); f.h.render(); await f.h.tick();
  toggle(f.h, "remote-tool").props.onClick(); f.h.render();
  f.setSnapshot(snapshot([raw("raw-B", "Account B")], { accountId: "B", userId: "B", generation: 2 })); f.h.props.connectionIdentity = "account-B"; f.h.render(); await f.h.tick();
  assert.ok(f.signals.some(signal => signal.aborted)); assert.ok(!f.h.text(f.h.tree).includes("remote-tool"));
  late.resolve({ verification: "pending", snapshot: null, error: "OLD_ACCOUNT" }); await f.h.tick(); assert.ok(!f.h.text(f.h.tree).includes("OLD_ACCOUNT"));
  f.setSnapshot(snapshot([raw()], { ...identity, generation: 3 })); f.h.props.connectionIdentity = "local:one"; f.h.render(); await f.h.tick();
  assert.equal(toggle(f.h, "remote-tool").props.disabled, true); assert.match(f.h.text(f.h.tree), /待核验/);
  f.h.button("核验远程操作结果").props.onClick(); await f.h.tick(); assert.equal(f.calls.filter(call => call[0] === "mutation").length, 0);
  f.h.unmount(); const updates = f.h.updates; await f.h.tick(); assert.equal(f.h.updates, updates); assert.equal(f.h.listeners(), 0);
}
console.log("PASS RPC-UI07: account switches abort requests and isolate stale writes, A B A retains uncertainty with read-only recovery, and all listeners release on unmount");
{
  const late = deferred(); let mutations = 0;
  const f = setup({ remote: { manageRemotePlugin: async () => { mutations++; return late.promise; } } });
  f.h.render(); await f.h.tick(); toggle(f.h, "remote-tool").props.onClick(); f.h.render();
  f.setSnapshot(snapshot([raw()], { ...identity, generation: 2 })); f.h.props.connectionIdentity = "same-account-reconnected"; f.h.render(); await f.h.tick();
  assert.equal(f.h.button("核验远程操作结果").props.disabled, true, "original transport is still in flight");
  late.resolve({ verification: "pending", snapshot: null, error: "delivery unknown" }); await f.h.tick();
  assert.equal(f.h.button("核验远程操作结果").props.disabled, false, "settled old-generation transport must release current-scope read-only recovery");
  f.h.button("核验远程操作结果").props.onClick(); await f.h.tick(); assert.equal(mutations, 1, "reconnect recovery never repeats POST");
  f.h.unmount();
}
console.log("PASS RPC-UI08: same-account reconnect projects late transport settlement into read-only recovery without reusing stale snapshots or replaying POST");
{
  const first = deferred(), second = deferred(); let writes = 0;
  const f = setup({ snapshot: snapshot([raw("one", "Remote One"), raw("two", "Remote Two")]), remote: { manageRemotePlugin: async () => (++writes === 1 ? first.promise : second.promise) } });
  f.h.render(); await f.h.tick();
  toggle(f.h, "Remote One").props.onClick(); toggle(f.h, "Remote Two").props.onClick(); f.h.render();
  assert.equal(writes, 2, "different remote plugins remain independent while both transports are pending");
  f.h.unmount(); const updates = f.h.updates;
  first.resolve({ verification: "pending", snapshot: null, error: "late one" }); second.resolve({ verification: "pending", snapshot: null, error: "late two" }); await f.h.tick();
  assert.equal(f.h.updates, updates, "late journal updates after unmount never call component state setters"); assert.equal(f.h.listeners(), 0);
}
console.log("PASS RPC-UI09: distinct raw ids mutate independently and late mutation/journal notifications cannot update an unmounted component");
