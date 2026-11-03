import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const clone = v => JSON.parse(JSON.stringify(v));
const identity = { accountId: "account-a", userId: "user-a", generation: 1 };
const raw = (id = "raw-1", extra = {}) => ({ id, name: "same-name", enabled: true, status: "ENABLED", release: { display_name: "Remote plugin", interface: { short_description: "Real metadata" } }, ...extra });
function fixture() {
  let rows = [raw()], account = { account: { type: "chatgpt" } }, current = identity, failure = null, mutation = null;
  const calls = [], exports = {};
  const deps = {
    accountRead: async () => clone(account), serviceIdentity: async () => clone(current),
    readRemotePluginInventory: async (...args) => { calls.push(["read", ...args]); if (failure) throw failure; return clone(rows); },
    mutateRemotePlugin: async (...args) => { calls.push(["write", ...args]); if (failure) throw failure; return mutation ?? { pluginId: args[0], operation: args[1], plugins: rows, verification: "confirmed", delivery: "accepted", warningCode: null }; },
    serviceErrorMessage: e => e?.message ?? "service failure",
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/remotePlugins.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: () => deps, AbortController, console });
  return { ...exports, calls, rows: v => rows = v, fail: v => failure = v, account: v => account = v, identity: v => current = v, mutation: v => mutation = v };
}
{
  const f = fixture(), p = f.mapRemotePlugins([raw()]).plugins[0];
  assert.equal(p.id, "same-name@openai-curated-remote"); assert.equal(p.remotePluginId, "raw-1");
  assert.equal(p.interface.shortDescription, "Real metadata"); assert.equal(p.remotePolicyKnown, true);
  for (const enabled of [null, "false", 1]) assert.throws(() => f.mapRemotePlugins([raw("x", { enabled })]));
  assert.throws(() => f.mapRemotePlugins([raw(), raw()]));
  const missing = raw(); delete missing.enabled;
  assert.equal(f.mapRemotePlugins([missing]).plugins[0].installed, false);
  const unknown = f.mapRemotePlugins([raw("x", { installation_policy: "FUTURE_POLICY" })]).plugins[0];
  assert.equal(unknown.remotePolicyKnown, false); assert.equal(unknown.remoteServicePlugin.installation_policy, "FUTURE_POLICY");
  assert.equal((await f.manageRemotePlugin(unknown, "enable", identity)).verification, "rejected"); assert.equal(f.calls.length, 0);
}
{
  const f = fixture(), snapshot = await f.loadRemotePlugins();
  const local = { id: "same-name@local", name: "same-name", source: { type: "local", path: "fixture" } };
  const cliRemote = { ...snapshot.marketplace.plugins[0], id: "cli-id", source: { type: "git", url: "fixture" }, enabled: false };
  const merged = f.mergePluginInventories({ marketplaces: [{ name: "local", path: "fixture", plugins: [local, cliRemote, cliRemote] }] }, snapshot);
  assert.equal(merged.marketplaces.flatMap(m => m.plugins).length, 2);
  const remote = merged.marketplaces[0].plugins[1];
  assert.equal(remote.id, "cli-id"); assert.equal(remote.source.type, "git"); assert.equal(remote.enabled, true);
  const failed = { identity: null, marketplace: null, error: "denied", unsupported: false };
  assert.equal(f.mergePluginInventories({ marketplaces: [{ name: "local", plugins: [local] }] }, failed).marketplaces[0].plugins[0], local);
}
{
  const f = fixture(); f.account({ account: { type: "apiKey" } });
  assert.equal((await f.loadRemotePlugins()).unsupported, true); assert.equal(f.calls.length, 0);
  f.account({ account: { type: "chatgpt" } }); f.identity({ ...identity, generation: 2 });
  assert.match((await f.loadRemotePlugins(undefined, identity)).error, /账号/); assert.equal(f.calls.length, 0);
}
{
  const f = fixture(), p = f.mapRemotePlugins([raw()]).plugins[0];
  f.rows([raw("raw-1", { enabled: false })]);
  assert.equal((await f.manageRemotePlugin(p, "disable", identity)).verification, "confirmed");
  assert.equal(f.calls[0][1], "raw-1"); assert.equal(f.calls[0][2], "disable");
  f.fail({ code: "network_error", message: "lost" });
  assert.equal((await f.manageRemotePlugin(p, "uninstall", identity)).verification, "pending");
  const writes = f.calls.filter(c => c[0] === "write").length;
  assert.equal((await f.verifyRemotePlugin(p, "uninstall", identity)).verification, "pending");
  assert.equal(f.calls.filter(c => c[0] === "write").length, writes);
  f.fail(null); f.rows([]);
  assert.equal((await f.verifyRemotePlugin(p, "uninstall", identity)).verification, "confirmed");
  const defaultPlugin = f.mapRemotePlugins([raw("default", { installation_policy: "INSTALLED_BY_DEFAULT" })]).plugins[0];
  assert.equal((await f.manageRemotePlugin(defaultPlugin, "uninstall", identity)).verification, "rejected");
  f.fail({ code: "forbidden", message: "denied" });
  assert.equal((await f.manageRemotePlugin(p, "enable", identity)).verification, "rejected");
}
console.log("PASS remote plugin mapping, independent inventory, raw identity, policy and read-only recovery contracts");
