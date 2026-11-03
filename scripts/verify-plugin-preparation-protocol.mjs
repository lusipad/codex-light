import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/plugins.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const ref = { pluginName: "sample", marketplacePath: "fixture/marketplace.json" };
function load(handler) {
  const calls = [], exports = {};
  vm.runInNewContext(compiled, {
    exports, crypto: { randomUUID: () => "fixture" },
    require: id => {
      assert.equal(id, "./bridge");
      return { callAppServer: async (method, params) => {
        calls.push({ method, params });
        return handler(method, params);
      } };
    },
  });
  return { api: exports, calls };
}
async function protocolReject(run, method) {
  await assert.rejects(run, error => error.name === "PluginProtocolError" && error.method === method);
}

for (const method of ["plugin/installed", "plugin/list"]) {
  for (const response of [
    null, {}, { marketplaces: null }, { marketplaces: [null] },
    { marketplaces: [{ name: "", plugins: [] }] },
    { marketplaces: [{ name: "market" }] },
    { marketplaces: [{ name: "market", plugins: [null] }] },
    { marketplaces: [{ name: "market", plugins: [{ id: "", installed: true }] }] },
    { marketplaces: [{ name: "market", plugins: [{ id: "a", installed: "true" }] }] },
    { marketplaces: [], marketplaceLoadErrors: null },
    { marketplaces: [], marketplaceLoadErrors: [{}] },
    { marketplaces: [], marketplaceLoadErrors: [{ marketplacePath: "/fixture", message: 5 }] },
  ]) {
    const { api } = load(() => response);
    await protocolReject(
      () => method === "plugin/installed" ? api.listInstalledPlugins() : api.listMarketplacePlugins(),
      method
    );
  }
  const { api } = load(() => ({
    marketplaces: [{ name: "market", plugins: [{ id: "a", installed: true }] }],
    marketplaceLoadErrors: [{ marketplacePath: "/fixture", message: "permission denied" }],
  }));
  const result = await (method === "plugin/installed" ? api.listInstalledPlugins() : api.listMarketplacePlugins());
  assert.equal(result.marketplaces[0].plugins[0].installed, true);
  assert.equal(result.marketplaceLoadErrors.length, 1, "partial load errors remain visible");
}

for (const response of [
  null, {}, { authPolicy: "ON_INSTALL" }, { appsNeedingAuth: [] },
  { authPolicy: "UNKNOWN", appsNeedingAuth: [] },
  { authPolicy: "ON_USE", appsNeedingAuth: {} },
  ...[
    null, { id: "", name: "App" }, { id: "a", name: 1 },
    { id: "a", name: "App", installUrl: 42 },
  ].map(app => ({ authPolicy: "ON_INSTALL", appsNeedingAuth: [app] })),
]) {
  const { api } = load(() => response);
  await protocolReject(() => api.installPlugin(ref), "plugin/install");
}
for (const policy of ["ON_INSTALL", "ON_USE"]) {
  const { api } = load(() => ({ authPolicy: policy, appsNeedingAuth: [
    { id: "a", name: "App", installUrl: "https://example.com/connect" },
    { id: "a", name: "Duplicate" }, { id: "b", name: "Other", installUrl: null },
  ] }));
  const result = await api.installPlugin(ref);
  assert.equal(result.authPolicy, policy);
  assert.deepEqual(Array.from(result.appsNeedingAuth, app => app.id), ["a", "b"]);
  assert.equal(result.appsNeedingAuth[0].name, "App");
}
{
  const { api, calls } = load((method, params) => {
    assert.equal(method, "app/list");
    return params.cursor === "page-2"
      ? { data: [{ id: "a", name: "Repeated" }, { id: "b", name: "Second", isAccessible: true }], nextCursor: null }
      : { data: [{ id: "a", name: "First", isAccessible: false }], nextCursor: "page-2" };
  });
  const apps = await api.listAllApps({ forceRefetch: true });
  assert.deepEqual(Array.from(apps, app => app.id), ["a", "b"]);
  assert.equal(apps[0].isAccessible, false, "first catalog fact wins on repeated IDs");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.params.forceRefetch === true));
  assert.equal(calls[1].params.cursor, "page-2");
}
for (const response of [
  null, {}, { data: null }, { data: [null] }, { data: [{ id: 1, name: "Bad" }] },
  { data: [{ id: "a", name: "Bad", isAccessible: "yes" }] },
  { data: [], nextCursor: 42 }, { data: [], nextCursor: "" },
]) {
  const { api } = load(() => response);
  await protocolReject(() => api.listAllApps(), "app/list");
}
{
  const { api, calls } = load(() => ({ data: [], nextCursor: "loop" }));
  await protocolReject(() => api.listAllApps(), "app/list");
  assert.equal(calls.length, 2, "cursor loop stops before making a duplicate request");
}
for (const response of [
  null, {}, { apps: null }, { apps: [null] }, { apps: [{ id: "a", enabled: true }] },
  { apps: [{ id: "a", enabled: "yes", callable: true }] },
  { apps: [{ id: "", enabled: true, callable: true }] },
  { apps: [{ id: "a", enabled: true, callable: true, runtimeName: 12 }] },
]) {
  const { api } = load(method => method === "app/list" ? { data: [] } : response);
  await protocolReject(() => api.readPluginPreparationState(), "app/installed");
}
{
  const { api, calls } = load(method => method === "app/read"
    ? { apps: [{ id: "a", name: "Unavailable" }, { id: "b", name: "Callable" }], missingAppIds: [] }
    : { apps: [{ id: "a", enabled: false, callable: false }, { id: "b", enabled: true, callable: true }] });
  const state = await api.readPluginPreparationState({ forceRefetch: true });
  assert.equal(state.source, "runtime");
  assert.equal(state.catalog[0].isAccessible, false);
  assert.equal(state.installed[0].enabled, false);
  assert.equal(state.installed[0].callable, false);
  assert.equal(state.catalog[1].isAccessible, true);
  assert.equal(state.installed[1].callable, true);
  assert.deepEqual(Object.keys(state).sort(), ["catalog", "installed", "source"], "readback reports facts, never OAuth success");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params)), { forceRefresh: true });
  assert.ok(calls.every(call => call.method === "app/read" || call.method === "app/installed"));
}
for (const failedMethod of ["app/read", "app/installed"]) {
  const { api, calls } = load(method => {
    if (method === failedMethod) throw Error("offline");
    return { apps: [{ id: "a", enabled: true, callable: true }] };
  });
  await protocolReject(() => api.readPluginPreparationState(), failedMethod);
  assert.ok(!calls.some(call => call.method === "app/list"), "ordinary errors never fall back to catalog");
}
for (const unsupportedMethod of ["app/read", "app/installed"]) {
  const { api, calls } = load(method => {
    if (method === unsupportedMethod) throw Error("Method not found (-32601)");
    if (method === "app/list") return { data: [{ id: "a", name: "Catalog", isAccessible: true }] };
    return { apps: [{ id: "a", enabled: false, callable: false }] };
  });
  const state = await api.readPluginPreparationState();
  assert.equal(state.source, "catalog");
  assert.equal(state.catalog[0].isAccessible, true);
  assert.equal(state.installed.length, unsupportedMethod === "app/read" ? 1 : 0);
  assert.ok(calls.some(call => call.method === "app/list"));
}
{
  const installed = Array.from({ length: 205 }, (_, index) => ({ id: `app-${index}`, enabled: true, callable: index % 2 === 0 }));
  const { api, calls } = load((method, params) => method === "app/installed"
    ? { apps: installed }
    : { apps: params.appIds.map(id => ({ id, name: id })), missingAppIds: [] });
  const state = await api.readPluginPreparationState();
  assert.equal(state.catalog.length, 205);
  assert.deepEqual(calls.filter(call => call.method === "app/read").map(call => call.params.appIds.length), [100, 100, 5]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params)), {}, "normal read omits forceRefresh");
}
for (const response of [
  {}, { apps: [], missingAppIds: [] }, { apps: [], missingAppIds: ["unknown"] },
  { apps: [{ id: "unknown", name: "Unknown" }], missingAppIds: [] },
  { apps: [{ id: "a", name: "App" }], missingAppIds: ["a"] },
]) {
  const { api } = load(method => method === "app/installed"
    ? { apps: [{ id: "a", enabled: true, callable: false }] } : response);
  await protocolReject(() => api.readPluginPreparationState(), "app/read");
}
{
  const { api } = load(method => method === "app/installed"
    ? { apps: [{ id: "a", enabled: true, callable: false }] }
    : { apps: [], missingAppIds: ["a"] });
  const state = await api.readPluginPreparationState();
  assert.equal(state.catalog.length, 0);
  assert.equal(state.installed.length, 1, "missing metadata preserves runtime facts");
}
console.log("Plugin preparation protocol: strict install response, catalog pagination, runtime facts and read failures passed.");
