import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const plugins = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/plugins.ts", "utf8")), {
  exports: plugins.exports, require: () => ({ callAppServer() { throw Error("No protocol writes in this replay"); } }),
});
const module = { exports: {} };
const directory = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/pluginDirectory.ts", "utf8")), { exports: directory.exports, require: () => ({}) });
vm.runInNewContext(compile(fs.readFileSync("src/pluginPreparationFlow.ts", "utf8")), {
  exports: module.exports, require: name => name === "./pluginDirectory" ? directory.exports : plugins.exports,
});
const { finishPluginPreparation, preparationInstalledPlugin, pluginRequiresBrowserPreparation } = module.exports;
const identity = { accountId: "original-account", userId: "original-user", generation: 4 };
const plugin = { id: "sample@original", name: "sample", installed: true, enabled: true,
  source: { type: "local", path: "D:/original/sample" }, authPolicy: "ON_INSTALL", installPolicy: "AVAILABLE", availability: "AVAILABLE" };
const inventory = { marketplaces: [{ name: "original", path: "D:/original", plugins: [plugin] }] };
const make = (patch = {}) => ({ requestId: "original-attempt", reference: { pluginName: "sample", marketplacePath: "D:/original" },
  pluginId: plugin.id, hostId: "local", connectionIdentity: "account/context", workspace: "D:/workspace", context: 1, detailRequest: 8, view: {},
  identity, result: { authPolicy: "ON_INSTALL", appsNeedingAuth: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] },
  prompt: "original prompt", confirmed: true, browserPreparationRequired: false, completed: false, consumed: false, controller: new AbortController(), checking: null, ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(flow = make(), overrides = {}) {
  const calls = [], guards = [];
  const dependencies = {
    isCurrent: () => true,
    readRequiredApp: async (id, original, signal) => { calls.push(["final", id, original, signal]); return { kind: "ready" }; },
    readInventory: async () => { calls.push(["inventory"]); return inventory; },
    readIdentity: async () => { calls.push(["identity"]); return identity; },
    deliver: async (value, prompt, guard) => { calls.push(["draft", value.id, prompt]); guards.push(guard); return true; },
    ...overrides,
  };
  return { calls, guards, dependencies, run: () => finishPluginPreparation(flow, dependencies) };
}
{
  const flow = make(), waiting = deferred();
  let count = 0;
  const view = fixture(flow, { readRequiredApp: async (id, original) => {
    assert.equal(original, identity); count++; if (id === "one") await waiting.promise; return { kind: "ready" };
  } });
  const first = view.run(), second = view.run();
  assert.equal(first, second, "repeated checks share one required-app verification");
  waiting.resolve(); await first;
  assert.equal(count, 2);
  assert.equal(view.calls.filter(call => call[0] === "draft").length, 1);
  assert.equal(view.calls.at(-1)[2], "original prompt");
  assert.equal(flow.consumed, true);
  await view.run(); assert.equal(count, 2, "an accepted original draft cannot be dispatched twice");
}
for (const result of ["needsAuth", "unavailable"]) {
  const flow = make(), view = fixture(flow, { readRequiredApp: async () => ({ kind: result }) });
  if (result === "needsAuth") assert.match(await view.run(), /仍需连接/);
  else await assert.rejects(view.run(), /未能完成连接设置/);
  assert.equal(flow.completed, false); assert.equal(flow.prompt, "original prompt");
  assert.equal(view.calls.some(call => call[0] === "draft" || call[0] === "identity"), false, "partial/unavailable final verification cannot dispatch a draft");
}
for (const flow of [make({ confirmed: false }), make({ identity: null }), make()]) {
  const view = fixture(flow, { isCurrent: () => flow.identity !== identity || !flow.confirmed });
  await assert.rejects(view.run()); assert.equal(view.calls.length, 0);
}
{
  const changed = { marketplaces: [{ name: "replacement", path: "D:/replacement", plugins: [plugin] }] };
  assert.equal(preparationInstalledPlugin(make(), changed), null, "same plugin ID from another marketplace does not satisfy the original install");
}
for (const actual of [undefined, { ...inventory, marketplaceLoadErrors: [{ message: "failed" }] },
  { marketplaces: [{ ...inventory.marketplaces[0], plugins: [{ ...plugin, enabled: false }] }] },
  { marketplaces: [{ ...inventory.marketplaces[0], plugins: [{ ...plugin, installed: false }] }] }]) {
  const view = fixture(make(), { readInventory: async () => actual });
  await assert.rejects(view.run(), /安装或启用状态未确认/);
  assert.equal(view.calls.filter(call => call[0] === "draft").length, 0);
}
for (const field of ["accountId", "userId", "generation"]) {
  const view = fixture(make(), { readIdentity: async () => ({ ...identity, [field]: "changed" }) });
  await assert.rejects(view.run(), /账号已变化/);
  assert.equal(view.calls.some(call => call[0] === "draft"), false);
}
{
  const flow = make(), waiting = deferred(); let current = true;
  const view = fixture(flow, { isCurrent: () => current, readRequiredApp: async () => { await waiting.promise; return { kind: "ready" }; } });
  const pending = view.run(); current = false; waiting.resolve();
  await assert.rejects(pending, /请求已失效/);
  assert.equal(view.calls.some(call => call[0] === "draft" || call[0] === "identity"), false);
}
{
  const flow = make(); let rejectNavigation = true, oldGuard;
  const view = fixture(flow, { deliver: async (_plugin, prompt, guard) => {
    assert.equal(prompt, "original prompt"); oldGuard = guard; return !rejectNavigation;
  } });
  assert.match(await view.run(), /草稿已保留/);
  assert.equal(flow.consumed, false); assert.equal(oldGuard.isCurrent(), false, "a rejected navigation cannot revive its deferred callback later");
  rejectNavigation = false; await view.run(); assert.equal(flow.consumed, true);
}
{
  const flow = make(); let current = true;
  const view = fixture(flow, { isCurrent: () => current, deliver: async () => { current = false; return true; } });
  await view.run(); assert.equal(flow.consumed, true, "normal successful host navigation may unmount the origin");
}
{
  const flow = make({ prompt: null }), view = fixture(flow);
  await view.run(); assert.equal(flow.completed, true); assert.equal(flow.consumed, false);
  assert.equal(view.calls.some(call => call[0] === "draft"), false, "an install-only action never invents a prompt");
}
for (const name of ["browser", "chrome", "chrome-dev", "chrome-internal"]) {
  assert.equal(pluginRequiresBrowserPreparation({ ...plugin, name, id: `${name}@original` }, "ON_INSTALL"), true);
  assert.equal(pluginRequiresBrowserPreparation({ ...plugin, name, id: `${name}@original` }, "ON_USE"), false);
  assert.equal(pluginRequiresBrowserPreparation({ ...plugin, name, id: `other-${name}@original` }, "ON_INSTALL"), false);
}
assert.equal(pluginRequiresBrowserPreparation({ ...plugin, name: "other-browser", id: "other-browser@original" }, "ON_INSTALL"), false);
for (const appsNeedingAuth of [[], [{ id: "one", name: "One" }]]) {
  const browser = { ...plugin, id: "browser@original", name: "browser" };
  const flow = make({ pluginId: browser.id, reference: { pluginName: "browser", marketplacePath: "D:/original" },
    browserPreparationRequired: true, result: { authPolicy: "ON_INSTALL", appsNeedingAuth } });
  const view = fixture(flow, { readInventory: async () => ({ marketplaces: [{ ...inventory.marketplaces[0], plugins: [browser] }] }) });
  await assert.rejects(view.run(), /浏览器扩展准备/);
  assert.equal(view.calls.length, 0, "missing extension preparation cannot be satisfied by zero required apps or ready connector links");
  assert.equal(flow.consumed, false);
}
{
  let reads = 0;
  const browser = { ...plugin, id: "chrome@original", name: "chrome" };
  const flow = make({ pluginId: browser.id, reference: { pluginName: "chrome", marketplacePath: "D:/original" } });
  const view = fixture(flow, { readInventory: async () => ({ marketplaces: [{ ...inventory.marketplaces[0], plugins: [{ ...browser,
    source: ++reads === 1 ? { type: "git", url: "https://example.test/repo" } : { type: "local", path: "D:/installed/chrome" },
  }] }] }) });
  await assert.rejects(view.run(), /浏览器扩展准备/);
  assert.equal(reads, 2, "the final fresh inventory must recheck the actual installed source");
  assert.equal(view.calls.some(call => call[0] === "draft"), false);
}
console.log("PASS real required-app flow: original identity/source/ACK, single flight, all ready, fresh installation, account/cancel isolation, rejected handoff invalidation, one accepted original draft and zero install/turn writes");
