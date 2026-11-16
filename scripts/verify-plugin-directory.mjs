import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const installed = { id: "installed@local", name: "Installed", installed: true, enabled: true,
  source: { type: "local", path: "C:/isolated/installed" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const available = { ...installed, id: "available@local", name: "Available", installed: false };
const market = { name: "private-local", path: "C:/isolated/market.json", plugins: [installed, available] };
let catalogReads = 0, detailReads = 0, installs = 0;
const view = harness({ plugins: {
  listMarketplacePlugins: async () => { catalogReads++; return { marketplaces: [market], featuredPluginIds: [] }; },
  pluginRefFor: plugin => ({ pluginName: plugin.name, marketplacePath: market.path }),
  readPlugin: async ref => { detailReads++; return { summary: ref.pluginName === "Installed" ? installed : available,
    marketplaceName: market.name, skills: [], hooks: [], apps: [], mcpServers: [] }; },
  installPlugin: async () => { installs++; return { appsNeedingAuth: [], authPolicy: "ON_USE" }; },
} });
view.props.manageOnly = false; view.props.initialTab = "plugins"; view.props.initialPluginMode = "browse";
view.setInstalled({ marketplaces: [{ ...market, plugins: [installed] }] });
view.render(); await view.tick();
const cards = () => view.nodes(view.tree).filter(node => node.props.className?.includes("pm-catalog-card"));
assert.equal(cards().length, 2, "directory includes installed and uninstalled plugins");
assert.ok(view.nodes(view.tree).some(node => node.type === "PluginInstalledStrip" && node.props.items.length === 1));
assert.equal(view.nodes(view.tree).some(node => node.props.className?.includes("pm-segment")), false, "directory is not installed/browse management");
const search = view.nodes(view.tree).find(node => node.type === "input" && node.props.id === "plugins-store-page-search");
assert.equal(search.props.autoFocus, true);
const install = view.nodes(cards()[1]).find(node => node.props["aria-label"] === "安装 Available");
assert.ok(install, "uninstalled card has an accessible icon install action");
assert.equal(view.nodes(cards()[0]).some(node => node.props["aria-label"] === "安装 Installed"), false);
await cards()[1].props.onClick(); await view.tick();
assert.equal(detailReads, 1);
assert.ok(view.nodes(view.tree).some(node => node.props.className === "pm-catalog-detail"));
assert.equal(cards().length, 0, "detail replaces directory instead of expanding the card");
assert.equal(view.nodes(view.tree).some(node => node.props.id === "plugins-store-page-search"), false, "detail does not retain an auto-focused directory header");
view.button("插件").props.onClick(); await view.tick();
assert.equal(cards().length, 2);
const before = catalogReads;
await view.button("刷新").props.onClick(); await view.tick();
assert.ok(catalogReads > before, "directory refresh must read the directory, not only installed inventory");
assert.equal(view.calls.filter(call => ["toggle", "run"].includes(call[0])).length, 0, "reading directory/details never mutates plugins");
let prevented = false;
cards()[1].props.onKeyDown({ key: "Enter", target: cards()[1], currentTarget: cards()[1], nativeEvent: {}, preventDefault() { prevented = true; } });
await view.tick();
assert.equal(prevented, true); assert.equal(detailReads, 2);
view.button("插件").props.onClick(); await view.tick();
const installAction = view.nodes(cards()[1]).find(node => node.props["aria-label"] === "安装 Available");
let stopped = 0;
installAction.props.onClick({ stopPropagation() { stopped++; } });
installAction.props.onClick({ stopPropagation() { stopped++; } });
await view.tick();
assert.equal(stopped, 2); assert.equal(installs, 1, "rapid icon clicks retain the production install single-flight lock");
assert.equal(detailReads, 2, "install action does not also navigate to detail");
view.unmount();
let openedCatalog = 0;
const fromSkills = harness({ plugins: { listMarketplacePlugins: async () => {
  openedCatalog++; return { marketplaces: [market], featuredPluginIds: [] };
} } });
fromSkills.props.manageOnly = false; fromSkills.props.initialTab = "skills";
fromSkills.render(); await fromSkills.tick();
fromSkills.tabs().find(node => fromSkills.text(node).startsWith("插件")).props.onClick(); await fromSkills.tick(); await fromSkills.tick();
assert.ok(openedCatalog > 0, "entering the directory from skills loads its catalog even with a retained installed-mode default");
fromSkills.unmount();
for (const notification of ["event", "focus"]) {
  let snapshot = { ...installed }, reads = 0;
  const external = harness({ plugins: { listMarketplacePlugins: async () => {
    reads++; return { marketplaces: [{ ...market, plugins: [{ ...snapshot }] }], featuredPluginIds: [] };
  } } });
  external.props.manageOnly = false; external.props.initialTab = "plugins";
  external.render(); await external.tick();
  const before = reads;
  snapshot = { ...installed, installed: false };
  external.setInstalled({ marketplaces: [] });
  external[notification](); await external.tick();
  assert.ok(reads > before, `${notification} refreshes the directory after an external uninstall`);
  assert.ok(external.nodes(external.tree).some(node => node.props["aria-label"] === "安装 Installed"));
  assert.equal(external.nodes(external.tree).some(node => node.props["aria-label"] === "管理 Installed"), false);
  external.unmount();
}
console.log("PASS plugin directory: installed cards/strip, search focus, icon actions, independent detail/back and real catalog refresh");
// These component tests inject transport/hook results. Source parsing and the real debounce/paging
// hook are verified independently; these assertions exercise production UI selection and handlers.
const identity = { accountId: "account-one", userId: "user-one", generation: 1 };
const flat = id => ({ id, displayName: `Remote ${id}`, description: "Flat listing", iconUrl: null, iconUrlDark: null,
  keywords: [], requiresLocalExecutor: undefined, isTemplate: false, installationPolicy: undefined, status: null, disabledReason: null });
const section = { id: "featured", slug: "featured-slug", title: "实际栏目", plugins: Array.from({ length: 9 }, (_, i) => flat(`remote-${i}`)) };
const remoteSource = { kind: "remote", identity, sections: [section] };
const emptySearch = { result: null, loading: false, error: null, unsupported: false, paging: false, pageError: null, nextCursor: null, loadMore() {}, retry() {} };
const urlWindow = () => {
  const state = { href: "https://codex.invalid/plugins" }, historyCalls = [];
  return { location: state, historyCalls,
    history: { pushState(_a, _b, url) { historyCalls.push(["push", url]); state.href = new URL(url, state.href).href; },
      replaceState(_a, _b, url) { historyCalls.push(["replace", url]); state.href = new URL(url, state.href).href; } } };
};
let metadataReads = 0, remoteInstalls = [], remoteCatalogReads = 0, searchOptions;
let metadataResolve;
const metadata = new Promise(resolve => { metadataResolve = resolve; });
const routeWindow = urlWindow();
const remoteView = harness({ window: routeWindow, directory: {
  loadPluginDirectorySource: async () => remoteSource,
  readLocalDirectoryListing: async id => { metadataReads++; assert.equal(id, "remote-0"); return metadata; },
}, directorySearch: options => { searchOptions = options; return options.query.trim() ? { ...emptySearch, result: { data: [{ plugin: available, marketplaceName: "search-source", marketplacePath: "C:/isolated/search-market.json" }], nextCursor: null } } : emptySearch; },
plugins: { listMarketplacePlugins: async (_cwds, _force, kinds) => { remoteCatalogReads++; assert.deepEqual(kinds, ["local"], "Personal may read local markets but Public must not load a mixed catalog"); return { marketplaces: [] }; },
  pluginRefFor: (plugin, market) => ({ pluginName: plugin.remotePluginId ?? plugin.name, remoteMarketplaceName: market.name }),
  installPlugin: async ref => { remoteInstalls.push(ref); return { appsNeedingAuth: [], authPolicy: "ON_USE" }; } } });
remoteView.props.manageOnly = false; remoteView.props.initialTab = "plugins"; remoteView.props.initialPluginMode = "browse";
remoteView.setInstalled({ marketplaces: [] }); remoteView.render(); await remoteView.tick();
const remoteCards = () => remoteView.nodes(remoteView.tree).filter(node => node.props.className === "pm-catalog-card");
assert.equal(remoteCards().length, 6, "remote home displays the actual section first six, not all nine");
assert.match(remoteView.text(remoteView.tree), /实际栏目/); assert.ok(remoteCatalogReads > 0, "source tabs determine genuine local Personal availability");
let preventedNavigation = 0;
const remoteInstall = remoteView.nodes(remoteCards()[0]).find(node => node.props["aria-label"] === "安装 Remote remote-0");
remoteInstall.props.onClick({ stopPropagation() { preventedNavigation++; } });
remoteInstall.props.onClick({ stopPropagation() { preventedNavigation++; } });
await remoteView.tick(); assert.equal(metadataReads, 1); assert.equal(remoteInstalls.length, 0);
assert.equal(remoteView.nodes(remoteView.tree).some(node => node.props.className === "pm-catalog-detail"), false, "metadata pre-read does not navigate");
metadataResolve({ summary: { ...available, id: "actual-local-id", remotePluginId: "remote-0", name: "actual-name" }, marketplaceName: "actual-source", marketplacePath: null, skills: [], hooks: [], apps: [], mcpServers: [] });
await remoteView.tick();
assert.equal(preventedNavigation, 2); assert.equal(remoteInstalls.length, 1);
assert.equal(remoteInstalls[0].pluginName, "remote-0"); assert.equal(remoteInstalls[0].remoteMarketplaceName, "actual-source", "installation uses read metadata source, not guessed home source/display name");
const remoteInput = () => remoteView.nodes(remoteView.tree).find(node => node.props.id === "plugins-store-page-search");
remoteInput().props.onChange({ target: { value: "not in home" } }); remoteView.render(); await remoteView.tick();
assert.equal(searchOptions.query, "not in home"); assert.equal(remoteCards().length, 1);
assert.equal(remoteCards()[0].props["aria-label"], "Available", "query uses full CLI search results rather than filtering home six");
remoteInput().props.onChange({ target: { value: "second" } }); remoteView.render();
assert.deepEqual(routeWindow.historyCalls.slice(-2).map(call => call[0]), ["push", "replace"]);
remoteView.unmount();

const categoryCalls = [], categoryWindow = urlWindow();
const categoryView = harness({ window: { ...categoryWindow, setTimeout(callback) { queueMicrotask(callback); return 1; } },
  directory: { loadPluginDirectorySource: async () => remoteSource,
    loadPluginDirectoryCategory: async (_identity, slug, query, cursor) => { categoryCalls.push({ slug, query, cursor }); return cursor ? { plugins: [flat("page-two")], nextCursor: null } : { plugins: [flat("category-only")], nextCursor: "next" }; },
  }, plugins: { listMarketplacePlugins: async () => { throw Error("must not read mixed markets"); } } });
categoryView.props.manageOnly = false; categoryView.props.initialTab = "plugins";
categoryView.setInstalled({ marketplaces: [] }); categoryView.render(); await categoryView.tick();
categoryView.button("查看更多").props.onClick(); await categoryView.tick(); await categoryView.tick();
assert.deepEqual(categoryCalls, [{ slug: "featured-slug", query: "", cursor: null }]);
assert.match(categoryView.text(categoryView.tree), /Remote category-only/); assert.doesNotMatch(categoryView.text(categoryView.tree), /Remote remote-0/);
categoryView.button("显示更多").props.onClick(); categoryView.button("显示更多").props.onClick(); await categoryView.tick();
assert.equal(categoryCalls.length, 2); assert.equal(categoryCalls[1].cursor, "next"); assert.match(categoryView.text(categoryView.tree), /Remote page-two/);
categoryView.unmount();

let lateResolve, lateInstalls = 0;
const late = harness({ directory: { loadPluginDirectorySource: async () => remoteSource, readLocalDirectoryListing: () => new Promise(resolve => { lateResolve = resolve; }) },
  plugins: { installPlugin: async () => { lateInstalls++; return { appsNeedingAuth: [] }; } } });
late.props.manageOnly = false; late.props.initialTab = "plugins"; late.setInstalled({ marketplaces: [] }); late.render(); await late.tick();
late.nodes(late.tree).find(node => node.props["aria-label"] === "安装 Remote remote-0").props.onClick({ stopPropagation() {} }); await late.tick();
late.props.connectionIdentity = "different-account"; late.render();
lateResolve({ summary: available, marketplaceName: "actual", skills: [], apps: [], hooks: [], mcpServers: [] }); await late.tick();
assert.equal(lateInstalls, 0, "old-account metadata cannot initiate an install"); late.unmount();
console.log("PASS remote directory production component: real sections/six-card bound, CLI search switch, URL search, full metadata install single-flight/source, true category paging and stale-account rejection");
const routeListeners = new Map();
const routeStack = [{ url: "https://codex.invalid/plugins?search=retained", state: { foreign: "preserved" } }];
let routeIndex = 0, navigation, routeReads = 0;
const routeLocation = { href: routeStack[0].url };
const historyWindow = { location: routeLocation,
  addEventListener(name, callback) { const listeners = routeListeners.get(name) ?? new Set(); listeners.add(callback); routeListeners.set(name, listeners); },
  removeEventListener(name, callback) { routeListeners.get(name)?.delete(callback); },
  history: { get state() { return routeStack[routeIndex].state; },
    pushState(state, _title, url) { routeStack.splice(++routeIndex); routeStack.push({ state, url: new URL(url, routeLocation.href).href }); routeLocation.href = routeStack[routeIndex].url; },
    replaceState(state, _title, url) { routeStack[routeIndex] = { state, url: new URL(url, routeLocation.href).href }; routeLocation.href = routeStack[routeIndex].url; },
    back() { if (routeIndex > 0) { routeLocation.href = routeStack[--routeIndex].url; routeListeners.get("popstate")?.forEach(callback => callback()); } },
    forward() { if (routeIndex + 1 < routeStack.length) { routeLocation.href = routeStack[++routeIndex].url; routeListeners.get("popstate")?.forEach(callback => callback()); } },
  } };
const routeView = harness({ window: historyWindow,
  directory: { loadPluginDirectorySource: async () => remoteSource, readLocalDirectoryListing: async () => {
    routeReads++; return { summary: { ...available, remotePluginId: "remote-0" }, marketplaceName: "metadata-source", skills: [], apps: [], hooks: [], mcpServers: [] };
  } }, directorySearch: () => ({ ...emptySearch, result: { data: [{ plugin: available, marketplaceName: market.name, marketplacePath: market.path }], nextCursor: null } }),
  plugins: { pluginRefFor: (plugin, marketplace) => ({ pluginName: plugin.name, marketplacePath: marketplace.path }), readPlugin: async ref => { routeReads++; assert.equal(ref.marketplacePath, market.path); return { summary: available, marketplaceName: market.name, marketplacePath: market.path, skills: [], apps: [], hooks: [], mcpServers: [] }; } } });
routeView.props.manageOnly = false; routeView.props.initialTab = "plugins"; routeView.props.onNavigationChange = value => { navigation = value; };
routeView.render(); await routeView.tick();
assert.equal(navigation.canGoBack, false); assert.equal(historyWindow.history.state.foreign, "preserved");
routeView.nodes(routeView.tree).find(node => node.props.className === "pm-catalog-card").props.onClick(); await routeView.tick();
assert.match(routeLocation.href, /\/plugins\/available%40local|\/plugins\/available@local/); assert.equal(navigation.canGoBack, true);
navigation.goBack(); await routeView.tick();
assert.equal(navigation.canGoForward, true); assert.ok(routeView.nodes(routeView.tree).some(node => node.props.id === "plugins-store-page-search" && node.props.value === "retained"));
navigation.goForward(); await routeView.tick();
assert.ok(routeView.nodes(routeView.tree).some(node => node.props.className === "pm-catalog-detail"));
assert.equal(routeReads, 2, "forward resolves the real metadata read parameters rather than replaying a mutation");
routeView.unmount(); assert.equal(navigation, null);
assert.equal([...routeListeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0, "route listeners release on unmount");
console.log("PASS plugin route component: source parameters in URL, retained search, real backward/forward availability, metadata readback and listener release");
let localKinds, fallbackCalls = 0;
const fallbackView = harness({ directory: { loadPluginDirectorySource: async () => remoteSource },
  directorySearch: () => ({ ...emptySearch, error: "Method not found", unsupported: true }),
  plugins: { listMarketplacePlugins: async (_roots, _force, kinds) => { fallbackCalls++; localKinds = kinds; return { marketplaces: [{ ...market, plugins: [{ ...available, name: "Beyond homepage" }] }] }; } } });
fallbackView.props.manageOnly = false; fallbackView.props.initialTab = "plugins"; fallbackView.setInstalled({ marketplaces: [] });
fallbackView.render(); await fallbackView.tick();
const beforeFallbackSearch = fallbackCalls;
fallbackView.nodes(fallbackView.tree).find(node => node.props.id === "plugins-store-page-search").props.onChange({ target: { value: "Beyond" } });
fallbackView.render(); await fallbackView.tick();
assert.equal(fallbackCalls - beforeFallbackSearch, 1); assert.deepEqual(Array.from(localKinds), ["local"]);
assert.match(fallbackView.text(fallbackView.tree), /Beyond homepage/); assert.doesNotMatch(fallbackView.text(fallbackView.tree), /Remote remote-0/);
fallbackView.unmount();
let forbiddenLocalReads = 0, retries = 0;
const failedSearch = harness({ directory: { loadPluginDirectorySource: async () => remoteSource },
  directorySearch: options => options.query.trim() ? ({ ...emptySearch, error: "403 forbidden", retry() { retries++; } }) : emptySearch,
  plugins: { listMarketplacePlugins: async () => { forbiddenLocalReads++; return { marketplaces: [] }; } } });
failedSearch.props.manageOnly = false; failedSearch.props.initialTab = "plugins"; failedSearch.render(); await failedSearch.tick();
const beforeFailedSearch = forbiddenLocalReads;
failedSearch.nodes(failedSearch.tree).find(node => node.props.id === "plugins-store-page-search").props.onChange({ target: { value: "denied" } }); failedSearch.render();
assert.match(failedSearch.text(failedSearch.tree), /403 forbidden/); assert.equal(forbiddenLocalReads, beforeFailedSearch, "permission failure must not initiate fallback reads");
failedSearch.button("重试").props.onClick(); assert.equal(retries, 1); failedSearch.unmount();
let finishInventory;
const loadingInventory = harness({ directory: { loadPluginDirectorySource: async () => remoteSource },
  plugins: { listInstalledPlugins: () => new Promise(resolve => { finishInventory = resolve; }) } });
loadingInventory.props.manageOnly = false; loadingInventory.props.initialTab = "plugins"; loadingInventory.render(); await loadingInventory.tick();
assert.ok(loadingInventory.nodes(loadingInventory.tree).some(node => node.props["aria-label"] === "正在读取安装状态"));
assert.equal(loadingInventory.nodes(loadingInventory.tree).some(node => node.props["aria-label"] === "安装 Remote remote-0"), false);
finishInventory({ marketplaces: [] }); await loadingInventory.tick();
assert.ok(loadingInventory.nodes(loadingInventory.tree).some(node => node.props["aria-label"] === "安装 Remote remote-0")); loadingInventory.unmount();
console.log("PASS component source boundaries: only missing-method triggers complete local fallback; 403 retains retry; unresolved inventory is never treated as uninstalled");
let detailAttempts = 0;
const failedMetadata = harness({ directory: { loadPluginDirectorySource: async () => remoteSource,
  readLocalDirectoryListing: async () => { detailAttempts++; if (detailAttempts === 1) throw Error("metadata denied"); return { summary: available, marketplaceName: "actual", skills: [], apps: [], hooks: [], mcpServers: [] }; } } });
failedMetadata.props.manageOnly = false; failedMetadata.props.initialTab = "plugins"; failedMetadata.render(); await failedMetadata.tick();
failedMetadata.nodes(failedMetadata.tree).find(node => node.props.className === "pm-catalog-card").props.onClick(); await failedMetadata.tick();
assert.match(failedMetadata.text(failedMetadata.tree), /metadata denied/);
assert.equal(failedMetadata.nodes(failedMetadata.tree).some(node => node.type === "button" && failedMetadata.text(node) === "重试"), false,
  "official detail error does not invent an extra retry action");
failedMetadata.button("插件").props.onClick(); await failedMetadata.tick();
failedMetadata.nodes(failedMetadata.tree).find(node => node.props.className === "pm-catalog-card").props.onClick();
await failedMetadata.tick(); assert.equal(detailAttempts, 2);
assert.doesNotMatch(failedMetadata.text(failedMetadata.tree), /metadata denied/); failedMetadata.unmount();
let explicitKinds;
const localSourceView = harness({ directory: { loadPluginDirectorySource: async () => ({ kind: "local" }) },
  plugins: { listMarketplacePlugins: async (_roots, _force, kinds) => { explicitKinds = kinds; return { marketplaces: [] }; } } });
localSourceView.props.manageOnly = false; localSourceView.props.initialTab = "plugins"; localSourceView.render(); await localSourceView.tick();
assert.deepEqual(Array.from(explicitKinds), ["local"]); assert.doesNotMatch(localSourceView.text(localSourceView.tree), /公开/); localSourceView.unmount();
console.log("PASS directory metadata read retry and explicit local source scoping");
for (const [hostId, pluginName, supported] of [["durable", "remote-0", true], ["arbitrary-host", "remote-0", false], ["durable", "wrong-id", false]]) {
  let directoryRequests = 0, metadataRequests = 0, writes = 0, localInventoryRequests = 0, hookEnabled;
  const hostWindow = urlWindow(); hostWindow.location.href = `https://codex.invalid/plugins/remote-0?hostId=${hostId}&pluginName=${pluginName}&remoteMarketplaceName=chatgpt-workspace`;
  const unsupportedHost = harness({ window: hostWindow,
    directory: { loadPluginDirectorySource: async () => { directoryRequests++; return remoteSource; }, readLocalDirectoryListing: async () => { metadataRequests++; throw Error("unexpected local detail"); } },
    directorySearch: options => { hookEnabled = options.enabled; return emptySearch; },
    plugins: { listInstalledPlugins: async () => { localInventoryRequests++; return { marketplaces: [] }; }, readPlugin: async () => { metadataRequests++; throw Error("unexpected local detail"); }, installPlugin: async () => { writes++; } } });
  unsupportedHost.props.manageOnly = false; unsupportedHost.props.initialTab = "plugins"; unsupportedHost.render(); await unsupportedHost.tick();
  if (supported) assert.equal(unsupportedHost.nodes(unsupportedHost.tree).find(node => node.type === "DurablePluginDirectoryPage")?.props.pluginId, "remote-0");
  else assert.match(unsupportedHost.text(unsupportedHost.tree), /当前入口尚不支持该主机/);
  assert.equal(directoryRequests + metadataRequests + writes + localInventoryRequests, 0, "explicit unknown host never falls back to local reads or installation");
  assert.equal(hookEnabled, false); unsupportedHost.unmount();
}
console.log("PASS exact durable detail delegates to service reader; unknown host or mismatched source stays rejected without local CLI reads or installation");

for (const outcome of ["missing", "failed", "partial"]) {
  let writes = 0, reads = 0, inventory = { marketplaces: [] }, finishRead;
  const ack = harness({ plugins: {
    listMarketplacePlugins: async () => ({ marketplaces: [market] }),
    listInstalledPlugins: async () => { reads++; if (writes && reads === 2) return new Promise((resolve, reject) => { finishRead = { resolve, reject }; }); return inventory; },
    pluginRefFor: () => ({ pluginName: available.name, marketplacePath: market.path }),
    installPlugin: async () => { writes++; return { appsNeedingAuth: [] }; },
  } });
  ack.props.manageOnly = false; ack.props.initialTab = "plugins";
  ack.render(); await ack.tick();
  const click = () => ack.nodes(ack.tree).find(node => node.props["aria-label"] === "安装 Available").props.onClick({ stopPropagation() {} });
  click(); await ack.tick();
  assert.equal(writes, 1);
  if (outcome === "failed") finishRead.reject(Error("inventory offline"));
  else finishRead.resolve(outcome === "partial" ? { marketplaces: [{ ...market, plugins: [{ ...available, installed: true }] }], marketplaceLoadErrors: [{ marketplacePath: "other", message: "unreadable" }] } : inventory);
  await ack.tick();
  assert.match(ack.text(ack.tree), /安装结果尚未确认/, `ACK + ${outcome} retains unresolved delivery`);
  assert.match(ack.text(ack.tree), /已安装.*刷新/, "ACK and inventory refresh failure are reported separately");
  const action = ack.nodes(ack.tree).find(node => node.props["aria-label"] === "安装 Available");
  if (action) { assert.equal(action.props.disabled, true); action.props.onClick({ stopPropagation() {} }); await ack.tick(); }
  assert.equal(writes, 1, "ACK with unresolved readback never replays installation");
  ack.button("刷新").props.onClick(); await ack.tick();
  assert.doesNotMatch(ack.text(ack.tree), /安装结果尚未确认/, "explicit complete refresh resolves the delivery lock");
  ack.unmount();
}
console.log("PASS ACK inventory readback: missing, rejected and partial reads retain installation uncertainty; explicit complete refresh recovers without replay");
for (const scope of ["connectionIdentity", "activeWorkspaceRoot"]) {
  let writes = 0, finishInstall;
  const scoped = harness({ plugins: {
    listMarketplacePlugins: async () => ({ marketplaces: [market] }),
    pluginRefFor: () => ({ pluginName: available.name, marketplacePath: market.path }),
    installPlugin: () => { writes++; return new Promise(resolve => { finishInstall = resolve; }); },
  } });
  scoped.setInstalled({ marketplaces: [] }); scoped.props.manageOnly = false; scoped.props.initialTab = "plugins";
  scoped.render(); await scoped.tick();
  const click = () => scoped.nodes(scoped.tree).find(node => node.props["aria-label"] === "安装 Available").props.onClick({ stopPropagation() {} });
  click(); await scoped.tick();
  const original = scoped.props[scope]; scoped.props[scope] = "other-scope"; scoped.render(); await scoped.tick();
  assert.doesNotMatch(scoped.text(scoped.tree), /安装结果尚未确认/, "A pending install does not contaminate B");
  finishInstall({ appsNeedingAuth: [] }); await scoped.tick();
  assert.doesNotMatch(scoped.text(scoped.tree), /已安装 Available/, "late A completion cannot toast in B");
  scoped.props[scope] = original; scoped.render(); await scoped.tick();
  assert.match(scoped.text(scoped.tree), /安装结果尚未确认/, "A journal survives A-B-A and automatic reads");
  click(); await scoped.tick(); assert.equal(writes, 1, "returning to A cannot replay unknown install");
  scoped.button("刷新").props.onClick(); await scoped.tick();
  assert.doesNotMatch(scoped.text(scoped.tree), /安装结果尚未确认/);
  scoped.unmount();
}
console.log("PASS installation scope journal: late ACK is isolated across account/project A-B-A; complete explicit read resolves uncertainty without replay");
