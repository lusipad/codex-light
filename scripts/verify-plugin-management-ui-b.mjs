import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const plugin = { id: "tool@market", name: "Tool", installed: true, enabled: true, source: { type: "local", path: "C:/isolated/tool" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const market = { name: "market", path: "C:/isolated/market.json", plugins: [plugin] };
export function harness(options = {}) {
  let managementToolbar;
  let cursor = 0, slots = [], effects = [], scheduled = [], changed = false, tree, removal, updates = 0;
  let installed = { marketplaces: [market] }, markets = [{ marketplace: market, canUpgrade: true, readOnlyReason: null, sourceType: "git" }];
  let features = [{ name: "plugins", enabled: true }], featureRead = async () => features;
  let enabledWrite = async (before, enabled) => {
    const after = { ...before, enabled }; installed = { marketplaces: [{ ...market, plugins: [after] }] };
    return { plugin: after, verification: "confirmed", error: null, refreshError: null, stale: false };
  };
  const basePlan = () => ({ marketplace: market, plugins: [plugin], completedIds: [], removePending: false, pendingPluginId: null, removed: false, error: null });
  let prepare = async () => basePlan(), run = async plan => ({ ...plan, completedIds: [plugin.id], removed: true, error: null });
  const calls = [], windows = new Map(), events = new Map(), frames = [];
  const props = { activeWorkspaceRoot: "C:/isolated", connectionIdentity: "local:one", manageOnly: true, initialTab: "plugins", onNavigationGuardChange() {} };
  const react = {
    createElement: (type, props, ...children) => type === managementToolbar && managementToolbar ? managementToolbar(props) : ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { changed = true; updates++; } slots[index] = next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
    useLayoutEffect(callback, deps) { react.useEffect(callback, deps); },
  };
  const client = {
    readConfiguredMarketplaces: async () => markets,
    setPluginEnabled: (...args) => { calls.push(["toggle", ...args]); return enabledWrite(...args); },
    verifyPluginEnabled: async (before, enabled) => {
      calls.push(["verify", before.id, enabled]);
      const actual = installed.marketplaces.flatMap(item => item.plugins).find(item => item.id === before.id);
      return { plugin: actual, verification: actual?.enabled === enabled ? "confirmed" : "pending", error: actual?.enabled === enabled ? null : "delivery unknown", refreshError: null, stale: false, configFilePath: "C:/isolated/config.toml" };
    },
    prepareMarketplaceRemoval: (...args) => { calls.push(["prepare", ...args]); return prepare(...args); },
    runMarketplaceRemoval: (...args) => { calls.push(["run", ...args]); return run(...args); },
  };
  Object.assign(client, options.management);
  const plugins = {
    classifyAppServerError: () => "unknown", errorDetail: String, errorSummary: String,
    pluginDisplayName: item => item.name, pluginDescription: () => "description", pluginDeveloper: () => "", pluginCategory: () => "",
    pluginSourceLabel: () => "本地", pluginVersion: () => "", marketplaceDisplayName: item => item.name, marketplaceSourceLabel: () => "Git",
    countMarketplacePlugins: item => ({ total: item.plugins.length, installed: item.plugins.length, enabled: item.plugins.filter(plugin => plugin.enabled).length }),
    listInstalledPlugins: async () => { calls.push(["installed"]); return installed; },
    listMarketplacePlugins: async () => ({ marketplaces: [] }),
    listSkills: async () => ({ data: [{ skills: [{ name: "Skill", path: "C:/isolated/skill", scope: "user", enabled: true, description: "skill" }], errors: [] }] }), flattenSkills: result => ({ skills: result.data.flatMap(item => item.skills) }),
    listApps: async () => ({ data: [{ id: "accessible", name: "Connected", isAccessible: true }, { id: "catalog", name: "Catalog", isAccessible: false }] }),
    upgradeMarketplace: async name => { calls.push(["upgrade", name]); return { selectedMarketplaces: [name], upgradedRoots: [], errors: [] }; },
  };
  Object.assign(plugins, options.plugins);
  const bridge = { tauriInvoke: async method => method === "skills_list_local" ? [] : method === "recommended_skills_list" ? { skills: [], repoRoot: "C:/isolated/recommended", source: "local", fetchedAt: null, error: null } : {}, callAppServer: async () => ({}), tauriListen: async (event, callback) => { events.set(event, callback); return () => events.delete(event); } };
  Object.assign(bridge, options.bridge);
  const window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }), addEventListener: (name, callback) => windows.set(name, callback), removeEventListener: name => windows.delete(name), setTimeout: () => 1, clearTimeout() {}, ...options.window };
  const load = (file, imports) => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
      { exports, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name], window, AbortController, URL, URLSearchParams, confirm: options.confirm ?? (() => true), requestAnimationFrame: callback => frames.push(callback), console });
    return exports;
  };
  const core = load("src/pluginManagementState.ts", { "./pluginManagement": client });
  const remote = { loadRemotePlugins: async () => ({ identity: null, marketplace: null, error: null, unsupported: true }),
    mergePluginInventories: cli => cli ?? { marketplaces: [] }, ...options.remote };
  const McpSettings = () => null;
  const recommended = load("src/recommendedSkills.ts", { "./bridge": bridge, "./plugins": plugins });
  const directory = load("src/pluginDirectory.ts", {});
  const location = load("src/pluginDirectoryLocation.ts", {});
  const directoryClient = { loadPluginDirectorySource: async () => ({ kind: "unresolved" }), ...options.directory };
  const directorySearch = { usePluginDirectorySearch: options.directorySearch ?? (() => ({ result: null, loading: false, error: null, unsupported: false, paging: false, pageError: null, nextCursor: null, loadMore() {}, retry() {} })) };
  managementToolbar = load("src/components/PluginManagementToolbar.tsx", { "lucide-react": { Search: "Search" } }).PluginManagementToolbar;
  const { SkillsMcpView } = load("src/components/SkillsMcpView.tsx", { "lucide-react": new Proxy({}, { get: (_, name) => String(name) }), "../bridge": bridge, "../fsClient": options.fs ?? {},
    "@tauri-apps/api/path": { homeDir: async () => "C:/isolated/home" },
    "../pluginDirectoryLocalGroups": load("src/pluginDirectoryLocalGroups.ts", {}),
    "./PluginDirectoryOriginsView": { PluginDirectoryOriginsView: "PluginDirectoryOriginsView" },
    "./PluginManagementToolbar": { PluginManagementToolbar: managementToolbar },
    "./AddPluginMarketplaceDialog": { AddPluginMarketplaceDialog: "AddPluginMarketplaceDialog" },
    "./PluginManagementDetail": { PluginManagementDetail: "PluginManagementDetail" },
    "./PluginPermissionsSettings": { PluginPermissionsSettings: "PluginPermissionsSettings" },
    "./PluginAppDetailsPage": { PluginAppDetailsPage: "PluginAppDetailsPage" },
    "./PluginCanonicalRootPage": { PluginCanonicalRootPage: "PluginCanonicalRootPage" },
    "./DurablePluginDirectoryPage": { DurablePluginDirectoryPage: "DurablePluginDirectoryPage" },
    "./PluginCanonicalUninstall": { PluginCanonicalUninstall: "PluginCanonicalUninstall" },
    "./PluginAppLinkPermissionsPage": { PluginAppLinkPermissionsPage: "PluginAppLinkPermissionsPage" },
    "./PluginAppSyncPage": { PluginAppSyncPage: "PluginAppSyncPage" },
    "./PluginAppEntryPage": { PluginAppEntryPage: "PluginAppEntryPage" },
    "./PluginManagementActions": { PluginManagementActions: "PluginManagementActions" },
    "../pluginManagementSkills": load("src/pluginManagementSkills.ts", { "./recommendedSkills": recommended }),
    "../pluginManagementLocation": load("src/pluginManagementLocation.ts", {}),
    "../config": { experimentalFeatureListAll: () => featureRead() }, "../mcpSettings": { readMcpSettings: async () => ({ entries: [{ name: "MCP" }] }), ...options.mcpSettings },
    "../pluginManagement": client, "../pluginManagementState": { ...core, useMarketplaceRemoval: (...args) => (removal = core.useMarketplaceRemoval(...args)) },
    "../plugins": plugins, "../pluginDirectory": directory, "../pluginDirectoryClient": directoryClient, "../pluginDirectorySearch": directorySearch, "../pluginDirectoryLocation": location, "../recommendedSkills": recommended, "../remotePlugins": remote, "./McpSettings": { McpSettings }, "./PluginPreparationPanel": {}, "./RecommendedSkillsPanel": {}, "./SkillPreviewDialog": { SkillPreviewDialog: "SkillPreviewDialog" },
    "./PluginDirectoryDetail": { PluginDirectoryDetail: "PluginDirectoryDetail" }, "./PluginDirectoryIncluded": { PluginDirectoryIncluded: "PluginDirectoryIncluded" },
    "./PluginLogo": { PluginLogo: "PluginLogo" }, "./PluginInstalledStrip": { PluginInstalledStrip: "PluginInstalledStrip" } });
  const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes),
    ...nodes(node.props?.actions), ...nodes(node.props?.included)] : [];
  const text = node => typeof node === "string" || typeof node === "number" ? String(node) : (node?.children || []).map(text).join("");
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const render = () => {
    let loops = 0;
    do { assert.ok(loops++ < 15); cursor = 0; changed = false; tree = SkillsMcpView(props);
      for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? modal : { focus() {}, querySelector: () => null, querySelectorAll: () => [], scrollLeft: 0, clientWidth: 768 };
      scheduled.splice(0).forEach(effect => effect());
    } while (changed);
    frames.splice(0).forEach(callback => callback()); return tree;
  };
  return { props, calls, core, modal, nodes, text, render, McpSettings, basePlan,
    async tick() { for (let i = 0; i < 45; i++) await Promise.resolve(); render(); },
    get tree() { return tree; }, get removal() { return removal; }, get updates() { return updates; },
    tabs: () => nodes(tree).filter(node => node.props.role === "tab" || node.props["aria-pressed"] !== undefined),
    button(label) { const node = nodes(tree).find(node => node.type === "button" && text(node).trim() === label); assert.ok(node, `button ${label}`); return node; },
    backManagedDetail() { const detail = nodes(tree).find(node => node.type === "PluginManagementDetail"); if (detail) detail.props.onBack(); else this.button("插件设置").props.onClick(); },
    setWrite(value) { enabledWrite = value; }, setRun(value) { run = value; }, setPrepare(value) { prepare = value; },
    setInstalled(value) { installed = value; }, setMarkets(value) { markets = value; }, setFeatures(value) { features = value; }, setFeatureRead(value) { featureRead = value; },
    focus() { windows.get("focus")?.(); }, event() { events.get("plugin-management-changed")?.({}); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); }, listeners: () => windows.size + events.size,
  };
}

const h = harness(); h.render(); await h.tick();
assert.deepEqual(h.tabs().map(node => h.text(node)), ["插件1", "应用1", "MCP1", "技能1", "市场1"]);
const search = h.nodes(h.tree).find(node => node.props.placeholder === "搜索插件");
search.props.onChange({ target: { value: "no match" } }); h.render();
assert.equal(h.tabs().length, 5, "search does not alter unfiltered counts");
search.props.onChange({ target: { value: "" } }); h.render();
h.setFeatureRead(async () => { throw Error("features unavailable"); }); h.focus(); await h.tick();
assert.equal(h.tabs().length, 5, "failed reads retain established eligibility and counts"); assert.match(h.text(h.tree), /features unavailable/);
h.setFeatureRead(async () => [{ name: "plugins", enabled: false }]); h.event(); await h.tick();
assert.deepEqual(h.tabs().map(node => h.text(node)), ["MCP1"]); assert.ok(h.nodes(h.tree).some(node => node.type === h.McpSettings));
h.setFeatureRead(async () => []); h.focus(); await h.tick(); assert.equal(h.tabs().length, 5, "absent feature follows official true default");
for (const counts of [{ plugins: 0, apps: 2, mcp: 1, skills: 1, marketplaces: 1 }, { plugins: 0, apps: 0, mcp: 0, skills: 0, marketplaces: 0 }]) {
  assert.equal(h.core.managementFallback("plugins", counts, true, true), "plugins");
  assert.equal(h.core.managementFallback("plugins", counts, false, true), counts.apps ? "apps" : "mcp");
}
console.log("PASS PMB01: real management tabs/counts, feature eligibility, search-independent counts, read failure retention and loading/empty fallback; MCP reuses production component");
h.button("插件1").props.onClick(); h.render();
const write = deferred(); h.setWrite(() => write.promise);
let toggle = h.nodes(h.tree).find(node => node.props.role === "switch");
toggle.props.onClick({ stopPropagation() {} }); toggle.props.onClick({ stopPropagation() {} }); h.render(); assert.equal(h.calls.filter(call => call[0] === "toggle").length, 1);
write.resolve({ verification: "pending", plugin: null, error: "delivery unknown", refreshError: null, stale: false }); await h.tick();
toggle = h.nodes(h.tree).find(node => node.props.role === "switch"); assert.equal(toggle.props.disabled, true); assert.match(h.text(h.tree), /待核验/);
h.button("重新核验并刷新技能").props.onClick(); await h.tick();
assert.equal(h.calls.filter(call => call[0] === "toggle").length, 1, "unknown writes are never replayed by readback");
h.setInstalled({ marketplaces: [{ ...market, plugins: [{ ...plugin, enabled: false }] }] });
h.button("重新核验并刷新技能").props.onClick(); await h.tick();
assert.equal(h.nodes(h.tree).find(node => node.props.role === "switch").props["aria-checked"], false);
assert.ok(!h.text(h.tree).includes("待核验"));
h.setWrite(async before => ({ verification: "confirmed", plugin: { ...before, enabled: true }, error: null, refreshError: "runtime refresh failed", stale: false }));
h.nodes(h.tree).find(node => node.props.role === "switch").props.onClick({ stopPropagation() {} }); await h.tick(); assert.match(h.text(h.tree), /runtime refresh failed/);
console.log("PASS PMB02: actual toggle handler single-flight, unknown delivery retained and read-only retry, confirmed write distinguished from refresh failure");
h.button("市场1").props.onClick(); h.render();
const preparation = deferred(); h.setPrepare(() => preparation.promise);
h.button("移除").props.onClick({ currentTarget: { focus() {} } }); h.render(); assert.equal(h.modal.open, true); assert.equal(h.calls.filter(call => call[0] === "run").length, 0);
preparation.resolve(h.basePlan()); await h.tick();
h.setRun(async (plan, options) => { const partial = { ...plan, completedIds: [plugin.id], error: "remove failed" }; options.onProgress(partial); return partial; });
h.button("卸载插件并移除市场").props.onClick(); await h.tick(); assert.match(h.text(h.tree), /已卸载 1 \/ 1/); assert.match(h.text(h.tree), /remove failed/);
h.setRun(async plan => { assert.deepEqual([...plan.completedIds], [plugin.id], "retry receives actual partial progress"); return { ...plan, removed: true, error: null }; });
h.button("重试剩余操作").props.onClick(); await h.tick(); assert.match(h.text(h.tree), /市场已移除/);
h.button("关闭").props.onClick(); h.render(); assert.equal(h.modal.open, false);
console.log("PASS PMB03: actual modal waits for enumeration and explicit confirmation, preserves partial progress, retries remaining state and restores close lifecycle");
h.setPrepare(async () => h.basePlan()); h.button("移除").props.onClick({ currentTarget: { focus() {} } }); await h.tick();
const late = deferred(); let options;
h.setRun((plan, value) => { options = value; return late.promise; }); h.button("卸载插件并移除市场").props.onClick(); h.render();
h.button("关闭").props.onClick(); h.render(); assert.equal(options.isCurrent(), false);
late.resolve({ ...h.basePlan(), pendingPluginId: plugin.id }); await h.tick(); assert.equal(h.removal.plan, null);
const preparationsBefore = h.calls.filter(call => call[0] === "prepare").length;
h.button("移除").props.onClick({ currentTarget: { focus() {} } }); await h.tick();
assert.equal(h.removal.plan.pendingPluginId, plugin.id, "closing retains unknown delivery for the next explicit attempt");
assert.equal(h.calls.filter(call => call[0] === "prepare").length, preparationsBefore, "reopen cannot discard unknown delivery by preparing a fresh write plan");
h.button("关闭").props.onClick(); h.render();
h.button("插件1").props.onClick(); h.render();
const lateToggle = deferred(); h.setWrite(() => lateToggle.promise); h.nodes(h.tree).find(node => node.props.role === "switch").props.onClick({ stopPropagation() {} });
h.props.connectionIdentity = "local:two"; h.render(); await h.tick();
lateToggle.resolve({ verification: "confirmed", plugin, error: "OLD_ACCOUNT", refreshError: null, stale: false }); await h.tick(); assert.ok(!h.text(h.tree).includes("OLD_ACCOUNT"));
h.unmount(); const updates = h.updates; await h.tick(); assert.equal(h.updates, updates); assert.equal(h.listeners(), 0);
console.log("PASS PMB04: close invalidates later removal steps, late completion cannot reopen modal, account/connection epoch isolates writes and listeners release");

const returning = harness(); returning.render(); await returning.tick();
returning.button("市场1").props.onClick(); returning.render();
returning.button("移除").props.onClick({ currentTarget: { focus() {} } }); await returning.tick();
let uninstallCount = 0;
const delivery = deferred();
returning.setRun(async plan => {
  if (plan.pendingPluginId) return { ...plan, error: "unknown delivery still unresolved" };
  uninstallCount++; await delivery.promise; return { ...plan, pendingPluginId: plugin.id, error: "delivery unknown" };
});
returning.button("卸载插件并移除市场").props.onClick(); returning.render();
returning.props.activeWorkspaceRoot = "C:/other"; returning.render(); await returning.tick();
delivery.resolve(); await returning.tick(); assert.equal(returning.removal.plan, null, "late A plan must not appear in B");
returning.props.activeWorkspaceRoot = "C:/isolated"; returning.render(); await returning.tick();
returning.button("市场1").props.onClick(); returning.render();
returning.button("移除").props.onClick({ currentTarget: { focus() {} } }); await returning.tick();
await returning.removal.confirm(); returning.render();
assert.equal(uninstallCount, 1, "A to B to A must retain unknown delivery and never replay the uninstall");
returning.unmount();
console.log("PASS PMB05: scope journal survives A to B to A without UI contamination or unknown uninstall replay");

// Reuse the client suite's isolated transport fixture with the actual hook and client together.
const fixtureAst = ts.createSourceFile("client-tests.mjs", fs.readFileSync("scripts/verify-plugin-management-b.mjs", "utf8"), ts.ScriptTarget.Latest, true);
const fixtureCode = fixtureAst.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "fixture" || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["clone", "plugin"].includes(declaration.name.getText(fixtureAst)))).map(node => node.getText(fixtureAst)).join("\n");
const fixture = new Function("fs", "vm", "ts", `${fixtureCode}\nreturn fixture;`)(fs, vm, ts);
const transport = fixture(), integrated = harness();
integrated.setMarkets([{ marketplace: transport.market, canUpgrade: true, readOnlyReason: null, sourceType: "git" }]);
integrated.render(); await integrated.tick();
integrated.setPrepare(() => transport.prepareMarketplaceRemoval(transport.market)); integrated.setRun((...args) => transport.runMarketplaceRemoval(...args));
integrated.button("市场1").props.onClick(); integrated.render();
integrated.button("移除").props.onClick({ currentTarget: { focus() {} } }); await integrated.tick();
transport.mode("uninstall-unknown"); let switched = false;
transport.hook(event => { if (event === "uninstall" && !switched) { switched = true; integrated.props.activeWorkspaceRoot = "C:/other"; integrated.render(); } });
await integrated.removal.confirm(); await integrated.tick(); assert.equal(integrated.removal.plan, null);
integrated.props.activeWorkspaceRoot = "C:/isolated"; integrated.render(); await integrated.tick();
integrated.button("市场1").props.onClick(); integrated.render();
integrated.button("移除").props.onClick({ currentTarget: { focus() {} } }); await integrated.tick();
await integrated.removal.confirm(); integrated.render();
assert.equal(transport.calls.filter(call => call[0] === "uninstall").length, 1, "production hook + production removal client never replay unknown uninstall across A B A");
assert.equal(transport.calls.filter(call => call[0] === "remove").length, 0);
integrated.unmount();
console.log("PASS PMB06: production hook and production client integration retains real transport uncertainty through A to B to A without a second uninstall or marketplace removal");

const upgrading = harness(); upgrading.setMarkets([
  { marketplace: market, canUpgrade: true, readOnlyReason: null, sourceType: "git" },
  { marketplace: { ...market, name: "local" }, canUpgrade: false, readOnlyReason: null, sourceType: "local" },
]); upgrading.render(); await upgrading.tick(); upgrading.button("市场2").props.onClick(); upgrading.render();
upgrading.button("全部升级").props.onClick(); await upgrading.tick();
assert.deepEqual(upgrading.calls.filter(call => call[0] === "upgrade"), [["upgrade", "market"]], "upgrade-all cannot bypass configured Git eligibility");
upgrading.unmount();
console.log("PASS PMB07: upgrade-all enumerates only configured eligible Git markets, never a broad unqualified backend upgrade");

const rootLocation = { href: "https://test.invalid/settings/plugins-settings/raw%2Fplugin?keep=value&linkId=old#anchor" };
const navigation = [];
const rootHistory = { state: {}, replaceState(state, _, url) { this.state = state; rootLocation.href = new URL(url, rootLocation.href).href; navigation.push(["replace", url]); },
  pushState(state, _, url) { this.state = state; rootLocation.href = new URL(url, rootLocation.href).href; navigation.push(["push", url]); } };
const roots = harness({ window: { location: rootLocation, history: rootHistory } });
const viewed = []; roots.props.onOpenPluginDirectoryDetail = value => viewed.push(value);
roots.render(); await roots.tick();
const rootPage = roots.nodes(roots.tree).find(node => node.type === "PluginCanonicalRootPage");
assert.ok(rootPage, "unqualified service root must use the canonical decision reader");
assert.equal(rootPage.props.pluginId, "raw/plugin"); assert.equal(rootPage.props.selectedLinkId, "old");
rootPage.props.onViewDetails(); assert.deepEqual(viewed, ["raw/plugin"], "directory action uses the actual raw service identity");
assert.equal(rootPage.props.onSelectLink("actual/?中文", "wrong"), false);
assert.equal(rootPage.props.onSelectLink("actual/?中文", "old"), true);
assert.equal(new URL(rootLocation.href).pathname, "/settings/plugins-settings/raw%2Fplugin");
assert.equal(new URL(rootLocation.href).searchParams.get("keep"), "value");
assert.equal(new URL(rootLocation.href).hash, "#anchor");
rootPage.props.onSync("actual/?中文");
assert.equal(new URL(rootLocation.href).pathname.endsWith("/sync"), false, "old account callbacks cannot navigate after selection changes");
roots.render();
const currentRoot = roots.nodes(roots.tree).find(node => node.type === "PluginCanonicalRootPage");
currentRoot.props.onSync("actual/?中文");
assert.equal(new URL(rootLocation.href).pathname, "/settings/plugins-settings/raw%2Fplugin/sync");
assert.equal(new URL(rootLocation.href).searchParams.get("linkId"), "actual/?中文");
assert.equal(rootPage.props.onSelectLink(null), false); rootPage.props.onViewDetails(); assert.equal(viewed.length, 1);
roots.unmount();
console.log("PASS PMB08: service roots delegate canonical dispatch; raw directory identity, root-preserving account selection, fresh sync and retired route callbacks are enforced");

for (const mode of ["confirmed", "unknown", "admin", "retired"]) {
  const location = { href: "https://test.invalid/settings/plugins-settings/raw-service" }, writes = [];
  const history = { state: {}, replaceState(state, _, url) { this.state = state; location.href = new URL(url, location.href).href; },
    pushState(state, _, url) { this.state = state; location.href = new URL(url, location.href).href; } };
  const servicePlugin = { ...plugin, id: "service@remote", remotePluginId: "raw-service", remoteServicePlugin: {}, remotePolicyKnown: true,
    installPolicy: mode === "admin" ? "INSTALLED_BY_DEFAULT" : "AVAILABLE", source: { type: "remote" } };
  const identity = { accountId: "service-account", userId: "service-user", generation: 0 };
  const snapshot = installed => ({ identity, unsupported: false, error: null, marketplace: { name: "service", plugins: [{ ...servicePlugin, installed }] } });
  const h = harness({ window: { location, history }, confirm: () => { throw Error("canonical removal must use its own HTML confirmation"); },
    remote: { loadRemotePlugins: async () => snapshot(true), mergePluginInventories: (cli, remote) => remote?.marketplace ? { marketplaces: [remote.marketplace] } : cli ?? { marketplaces: [] },
      manageRemotePlugin: async () => { writes.push("uninstall"); return { verification: mode === "unknown" ? "unknown" : "confirmed", error: mode === "unknown" ? "delivery unknown" : null, snapshot: snapshot(mode === "unknown") }; },
      verifyRemotePlugin: async () => { writes.push("verify"); return { verification: "confirmed", error: null, snapshot: snapshot(false) }; } } });
  h.render(); await h.tick();
  let root = h.nodes(h.tree).find(node => node.type === "PluginCanonicalRootPage");
  const context = { blocked: false, accountCount: 2, isCurrent: () => true };
  let actions = root.props.renderCanonicalActions(context), uninstall = h.nodes(actions).find(node => node.type === "PluginCanonicalUninstall");
  assert.ok(uninstall); assert.equal(uninstall.props.accountCount, 2);
  if (mode === "admin") { assert.equal(uninstall.props.disabled, true); assert.equal(writes.length, 0); h.unmount(); continue; }
  assert.equal(uninstall.props.disabled, false);
  if (mode === "retired") {
    location.href = "https://test.invalid/settings/plugins-settings/other";
    assert.equal(uninstall.props.isCurrent(), false); await uninstall.props.onConfirm(); assert.equal(writes.length, 0); h.unmount(); continue;
  }
  if (mode === "unknown") {
    await assert.rejects(uninstall.props.onConfirm(), /尚未确认/); await h.tick();
    assert.equal(new URL(location.href).pathname, "/settings/plugins-settings/raw-service");
    root = h.nodes(h.tree).find(node => node.type === "PluginCanonicalRootPage"); actions = root.props.renderCanonicalActions(context);
    assert.equal(h.nodes(actions).find(node => node.type === "PluginCanonicalUninstall").props.disabled, true);
    const verify = h.nodes(actions).find(node => node.type === "button" && h.text(node) === "核验卸载结果"); assert.ok(verify);
    verify.props.onClick(); await h.tick(); assert.deepEqual(writes, ["uninstall", "verify"], "unknown delivery is recovered by read, never a second uninstall");
  } else { await uninstall.props.onConfirm(); assert.deepEqual(writes, ["uninstall"]); }
  assert.equal(new URL(location.href).pathname, "/settings/plugins-settings", "confirmed root removal replaces the retired detail");
  h.unmount();
}
console.log("PASS PMB09: canonical removal passes real account count, skips native confirm, respects admin/fresh route, replaces confirmed detail and recovers unknown delivery without replay");
{
  const location = { href: "https://test.invalid/plugins/raw%2Fservice?pluginName=raw%2Fservice&remoteMarketplaceName=chatgpt-workspace&hostId=durable" }, reads = [], manages = [];
  const history = { state: {}, replaceState(state, _, url) { this.state = state; location.href = new URL(url, location.href).href; },
    pushState(state, _, url) { this.state = state; location.href = new URL(url, location.href).href; } };
  const h = harness({ window: { location, history }, plugins: { readPlugin: async () => { reads.push("plugin/read"); throw Error("must not read local CLI for durable"); } } });
  h.props.manageOnly = false; h.props.onManagePlugin = id => manages.push(id); h.render(); await h.tick();
  const page = h.nodes(h.tree).find(node => node.type === "DurablePluginDirectoryPage"); assert.ok(page); assert.equal(page.props.pluginId, "raw/service");
  assert.equal(reads.length, 0); assert.equal(h.tree.props.className, "panel-page pm-extensions-page pm-directory-page");
  page.props.onManage("raw/service"); assert.deepEqual(manages, ["raw/service"]);
  page.props.onBack(); await h.tick(); assert.equal(new URL(location.href).pathname, "/plugins"); assert.equal(new URL(location.href).search, "?hostId=durable");
  assert.equal(h.nodes(h.tree).some(node => node.type === "DurablePluginDirectoryPage"), false); assert.match(h.text(h.tree), /当前入口尚不支持该主机/); assert.equal(reads.length, 0, "missing browse host/gate producer must not fall back to local CLI"); h.unmount();
}
console.log("PASS PMB10: exact durable entry delegates to service details while local CLI stays blocked; parent preserves directory layout and host-preserving return URL; browse adapter remains unavailable");
