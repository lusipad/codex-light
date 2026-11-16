import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/SkillsMcpView.tsx", "utf8");
const ast = ts.createSourceFile("SkillsMcpView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["isPluginContextCurrent", "updateInstallUncertainty", "updateUninstallUncertainty", "verifyUninstalledPlugin", "handleInstallPlugin", "handleUninstallPlugin", "handleToggleDetail", "loadInstalledPlugins", "loadBrowsePlugins", "resetBrowseCache"];
const nodes = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) nodes[node.name.getText(ast)] = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const waitForRequests = async (view, count) => {
  for (let i = 0; i < 40 && view.requests.length < count; i++) await Promise.resolve();
  assert.ok(view.requests.length >= count, `production action must reach request ${count}`);
};
const plugin = { id: "tool@market", name: "tool", installPolicy: "AVAILABLE", availability: "AVAILABLE" };
const marketplace = { name: "market", path: "repo/market.json" };
function mount() {
  const requests = [], notices = [], reads = [];
  const context = {
    pluginActionRef: { current: new Set() }, busyPluginIds: new Set(), pluginMode: "browse",
    unconfirmedInstalls: new Set(), installedData: null, pluginPreparations: {}, pluginUpdates: {},
    installScope: "isolated-account-project", installUncertaintyRef: { current: new Map() }, unsupportedDirectoryHost: () => false,
    uninstallUncertaintyRef: { current: new Map() }, closeManagedDetail() {},
    manageOnly: true, directoryRead: { current: null }, setDirectorySource() {}, AbortController,
    managementBase: () => "/settings/plugins-settings", updateDirectoryUrl() {}, remoteId: item => item.remotePluginId ?? null,
    pluginManagementDetailUrl: (() => { const exports = {}; vm.runInNewContext(compile(fs.readFileSync("src/pluginManagementLocation.ts", "utf8")), { exports, URL, URLSearchParams }); return exports.pluginManagementDetailUrl; })(),
    preparationAttemptRef: { current: 0 }, PluginProtocolError: class extends Error {},
    preparationViewRef: { current: { tab: "plugins", detail: null } }, preparationReads: { current: new Set() }, preparationFlows: { current: new Map() },
    managementHostId: "local", connectionIdentity: "isolated-account", activeWorkspaceRoot: "A",
    serviceIdentity: async () => { throw Error("Connector identity is not configured in this action replay"); },
    pluginContextRef: { current: 0 }, pluginMountedRef: { current: true },
    installedRequestRef: { current: 0 }, browseRequestRef: { current: 0 },
    installedLoadingRef: { current: false }, browseLoadingRef: { current: false }, browseLoadedRef: { current: false },
    detailRequestRef: { current: 0 }, detailContextRef: { current: null }, detailKey: null,
    workspaceCwds: () => ["A"],
    isServicePlugin: item => item.source?.type === "remote", handleRemotePlugin: async () => {},
    pluginKey: (item, market) => `${market.name}::${item.id}`,
    pluginRefFor: (item, market) => ({ pluginName: item.name, marketplacePath: market.path }),
    pluginDisplayName: item => item.name, errorSummary: error => error.message,
    toViewError: error => ({ message: error.message }), confirm: () => { reads.push("confirm"); return true; },
    notify: (...args) => notices.push(args), loadRemoteSkills: async () => reads.push("skills"),
  };
  for (const method of ["installPlugin", "uninstallPlugin", "readPlugin", "listInstalledPlugins", "listMarketplacePlugins"]) {
    context[method] = (...args) => { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; };
  }
  for (const name of ["PluginPreparations", "UnconfirmedInstalls", "UnconfirmedUninstalls", "BusyPluginId", "BusyPluginIds", "InstalledData", "InstalledLoading", "InstalledError", "BrowseData", "BrowseLoading", "BrowseError", "BrowseVisibleCount", "DetailKey", "Detail", "DetailError", "DetailLoading"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { context[key] = typeof value === "function" ? value(context[key]) : value; };
  }
  const flowExports = {};
  const directoryExports = {};
  vm.runInNewContext(compile(fs.readFileSync("src/pluginDirectory.ts", "utf8")), { exports: directoryExports, require: () => ({}) });
  vm.runInNewContext(compile(fs.readFileSync("src/pluginPreparationFlow.ts", "utf8")), {
    exports: flowExports, require: name => { if (name === "./pluginDirectory") return directoryExports; assert.equal(name, "./plugins"); return context; },
  });
  Object.assign(context, flowExports);
  for (const [name, node] of Object.entries(nodes)) context[name] = vm.runInNewContext(compile(`(${node.getText(ast)})`), context);
  return { ...context, context, requests, notices, reads, unmount: () => { context.pluginMountedRef.current = false; ++context.pluginContextRef.current; } };
}
{
  const view = mount();
    const blocked = view.handleUninstallPlugin({ ...plugin, source: { type: "remote" }, installPolicy: "INSTALLED_BY_DEFAULT" });
  assert.equal(view.requests.length, 0, "PA02: admin-installed plugin cannot be uninstalled");
  await blocked;
  assert.equal(view.reads.length, 0, "PA02: admin policy blocks before confirmation");
  await view.handleInstallPlugin({ ...plugin, installPolicy: "NOT_AVAILABLE" }, marketplace);
  await view.handleInstallPlugin({ ...plugin, availability: "DISABLED_BY_ADMIN" }, marketplace);
  assert.equal(view.requests.length, 0, "PA02: handler enforces install policy");
}
{
  const view = mount(), first = view.handleInstallPlugin(plugin, marketplace);
  await view.handleInstallPlugin(plugin, marketplace); await view.handleUninstallPlugin(plugin, marketplace);
  await waitForRequests(view, 1);
  assert.equal(view.requests.length, 1, "PA01: same plugin writes are single flight");
  const other = view.handleInstallPlugin({ ...plugin, id: "other@market", name: "other" }, marketplace);
  await waitForRequests(view, 2);
  assert.equal(view.requests.length, 2, "PA01: different plugins remain independent");
  view.requests[0].reject(Error("denied")); view.requests[1].reject(Error("offline")); await first; await other;
  assert.equal(view.context.pluginActionRef.current.size, 0);
  assert.equal(view.context.busyPluginIds.size, 0);
  assert.ok(view.notices.some(([text]) => text.includes("denied")), "PA06: mutation failures visible");
}
for (const outcome of ["resolve", "reject"]) {
  const view = mount(), reading = view.handleToggleDetail(plugin, marketplace);
  view.context.detailKey = "market::tool@market";
  await view.handleToggleDetail(plugin, marketplace);
  view.requests[0][outcome](outcome === "resolve" ? { name: "late" } : Error("late"));
  await reading;
  assert.equal(view.context.detail, null, "PA03: collapsed details ignore late data");
  assert.equal(view.context.detailError, null);
  assert.equal(view.context.detailLoading, false);
  assert.equal(view.context.detailContextRef.current, null);
}
for (const loader of ["loadInstalledPlugins", "loadBrowsePlugins"]) {
  const view = mount();
  const first = view[loader](loader === "loadInstalledPlugins" ? { silent: true } : true);
  const second = view[loader](loader === "loadInstalledPlugins" ? { silent: true } : true);
  if (loader === "loadBrowsePlugins") assert.equal(view.requests[1].args[1], true, "PA04: explicit reload requests fresh catalog");
  view.requests[0].resolve({ marketplaces: [{ name: "old" }] }); await first;
  const loading = loader === "loadInstalledPlugins" ? "installedLoadingRef" : "browseLoadingRef";
  assert.equal(view.context[loading].current, true, "PA04: stale finally cannot unlock newer read");
  view.requests[1].resolve({ marketplaces: [{ name: "new" }] }); await second;
  const key = loader === "loadInstalledPlugins" ? "installedData" : "browseData";
  assert.equal(view.context[key].marketplaces[0].name, "new");
  const stale = view[loader](loader === "loadInstalledPlugins" ? { silent: true } : true);
  view.unmount(); view.requests[2].reject(Error("old context")); await stale;
  assert.equal(view.context[loader === "loadInstalledPlugins" ? "installedError" : "browseError"], null);
}
{
  const view = mount(), old = view.loadBrowsePlugins(true);
  view.context.pluginContextRef.current += 2;
  const latest = view.loadBrowsePlugins(true);
  view.requests[1].resolve({ marketplaces: [{ name: "new A" }] }); await latest;
  view.requests[0].resolve({ marketplaces: [{ name: "old A" }] }); await old;
  assert.equal(view.context.browseData.marketplaces[0].name, "new A", "PA04: A to B to A invalidates original context");
  const writing = view.handleInstallPlugin(plugin, marketplace);
  await waitForRequests(view, 3);
  const before = view.requests.length;
  ++view.context.pluginContextRef.current;
  view.requests.at(-1).resolve({ appsNeedingAuth: [] }); await writing;
  assert.equal(view.requests.length, before, "PA05: old-context write completion cannot refresh current project");
  assert.equal(view.notices.length, 0);
}
for (const action of ["handleInstallPlugin", "handleUninstallPlugin"]) {
  const view = mount(), oldRead = view.loadBrowsePlugins(true), writing = view[action](plugin, marketplace);
  await waitForRequests(view, 2);
  view.requests[1].resolve({ appsNeedingAuth: [] }); await flush();
  const reads = view.requests.filter(request => request.method.startsWith("list"));
  assert.ok(reads.some(request => request.method === "listInstalledPlugins"), "PA05: mutation rereads installed state");
  assert.ok(reads.length >= 3, "PA05: active catalog reread after mutation");
  view.requests[0].resolve({ marketplaces: [{ name: "old" }] }); await oldRead;
  for (const request of reads.slice(1)) request.resolve({ marketplaces: [{ name: "committed", plugins: [] }] });
  await writing;
  assert.equal(view.context.browseData.marketplaces[0].name, "committed", "PA05: stale catalog cannot undo readback");
}
{
  const view = mount();
  const writing = view.handleInstallPlugin(plugin, marketplace);
  await waitForRequests(view, 1);
  view.requests[0].reject(new view.context.PluginProtocolError("bad install response"));
  await flush();
  assert(view.context.unconfirmedInstalls.has(plugin.id));
  view.requests[1].reject(Error("readback offline"));
  await writing;
  await view.handleInstallPlugin(plugin, marketplace);
  assert.equal(view.requests.length, 2, "Unconfirmed write cannot be retried as a new install");
  const partial = view.loadInstalledPlugins({ confirmInstallResult: true });
  view.requests[2].resolve({ marketplaces: [], marketplaceLoadErrors: [{ marketplacePath: "repo", message: "unreadable" }] });
  await partial;
  assert(view.context.unconfirmedInstalls.has(plugin.id), "Incomplete market cannot prove plugin absent");
  const retry = view.loadInstalledPlugins({ confirmInstallResult: true });
  view.requests[3].resolve({ marketplaces: [] });
  await retry;
  assert.equal(view.context.unconfirmedInstalls.size, 0, "Fresh complete readback resolves unknown installation");
}
{
  const view = mount();
  const writing = view.handleInstallPlugin(plugin, marketplace);
  await waitForRequests(view, 1);
  view.requests[0].resolve({ authPolicy: "ON_INSTALL", appsNeedingAuth: [{ id: "app", name: "App" }] });
  await flush();
  assert.equal(view.context.pluginPreparations[plugin.id].result.authPolicy, "ON_INSTALL");
  for (const request of view.requests.slice(1)) request.resolve({ marketplaces: [] });
  await writing;
  const uninstalling = view.handleUninstallPlugin(plugin);
  view.requests.at(-1).resolve({});
  await flush();
  assert.equal(view.context.pluginPreparations[plugin.id], undefined, "Uninstall removes retained preparation");
  for (const request of view.requests.filter(item => item.method.startsWith("list"))) request.resolve({ marketplaces: [] });
  await uninstalling;
}
console.log("PA01–PA07 plugin actions and unconfirmed installation recovery passed");
