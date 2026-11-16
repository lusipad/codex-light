import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = text => ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
for (const file of ["src/pluginDirectoryLocation.ts", "src/pluginManagementLocation.ts"]) {
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, { exports, URL, URLSearchParams });
}
const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map(); let manage, restore, synchronize, recordRoute;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === "useCallback") {
    callbacks.set(node.name.getText(source), node.initializer.arguments[0]);
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "SkillsMcpView") {
    const attribute = node.attributes.properties.find(property => property.name?.getText(source) === "onManagePlugins");
    if (attribute) manage = attribute.initializer.expression;
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]) {
    const text = node.arguments[0].getText(source);
    if (text.includes("const restorePageRoute")) restore = node.arguments[0];
    if (text.includes("libraryLocationUrl(window.location.href") && text.includes("url.pathname")) synchronize = node.arguments[0];
    if (text.includes("history.entries = [...history.entries.slice")) recordRoute = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(source);
const settings = ts.createSourceFile("SettingsView.tsx", fs.readFileSync("src/components/SettingsView.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let settingsEffect;
function findSettings(node) {
  if (ts.isCallExpression(node) && node.expression.getText(settings) === "useEffect" &&
      node.arguments[0]?.getText(settings).includes('activeSection === "plugins-settings" && !parsePluginManagementLocation')) settingsEffect = node.arguments[0];
  ts.forEachChild(node, findSettings);
}
findSettings(settings); assert.ok(manage && restore && synchronize && recordRoute && settingsEffect);

const origin = "/plugins/tool@private?search=retain&category=developer-tools&directoryTab=personal&hostId=local&pluginName=tool&marketplacePath=D%3A%2Fprivate%2Fmarket.json";
function fixture(initialUrl = origin, initialRoute = "plugins") {
  const location = {}, writes = [], listeners = new Map(); let index = 0;
  const entries = [{ url: new URL(initialUrl, "https://private.test").href,
    state: { keep: "foreign-state", pluginDirectoryNavigation: { session: "directory-original", index: 2 } } }];
  const setLocation = url => { const next = new URL(url, "https://private.test"); Object.assign(location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }); };
  const history = {
    get state() { return entries[index].state; },
    pushState(state, _unused, url) { entries.splice(index + 1); entries.push({ state, url: new URL(url, location.href).href }); index++; writes.push(["push", url]); setLocation(entries[index].url); },
    replaceState(state, _unused, url) { entries[index] = { state, url: new URL(url, location.href).href }; writes.push(["replace", url]); setLocation(entries[index].url); },
    back() { if (index > 0) { index--; setLocation(entries[index].url); listeners.get("popstate")?.forEach(callback => callback()); } },
    forward() { if (index + 1 < entries.length) { index++; setLocation(entries[index].url); listeners.get("popstate")?.forEach(callback => callback()); } },
  };
  setLocation(entries[0].url);
  const scope = { ...exports, URL, URLSearchParams,
    window: { location, history, addEventListener: (name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback);
    }, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback) },
    activeRoute: initialRoute, activeRouteRef: { current: initialRoute }, activeSection: "general-settings",
    isQuickChatWindow: false, isThreadWindow: false, libraryFileId: null, libraryCleanupTab: null,
    parseSitesLocation: () => null, parseLibraryFileLocation: () => null, parseLibraryLocation: () => null,
    pluginManagementLocationRef: { current: false }, pluginDirectoryNavigationRef: { current: null }, pluginManagementNavigationRef: { current: null },
    pluginManagementHandoffRef: { current: null },
    personalizationNavigationGuardRef: { current: null }, routeHistoryRef: { current: { entries: ["plugins"], index: 0 } },
    navigatingRouteHistoryRef: { current: false }, setRouteHistoryVersion() {},
    setLibraryFileId() {}, setLibraryCleanupTab() {}, setPluginDirectoryMode() {},
    setSettingsInitialSection: section => { scope.activeSection = section; },
    commitActiveRoute: route => { scope.activeRoute = route; scope.activeRouteRef.current = route; },
    setPluginDirectoryNavigation: navigation => { scope.pluginDirectoryNavigation = navigation; },
    setPluginManagementNavigation: navigation => { scope.pluginManagementNavigation = navigation; },
  };
  const app = node => vm.runInNewContext(compile(node.getText(source)), scope);
  for (const name of ["withPluginHandoffNavigation", "updatePluginDirectoryNavigation", "updatePluginManagementNavigation", "setActiveRoute", "handleOpenPluginManagement", "navigateRouteHistory"]) {
    if (callbacks.has(name)) scope[name] = app(callbacks.get(name));
  }
  const lifecycle = app(restore)();
  const navigation = () => ({ canGoBack: false, canGoForward: false, goBack: () => history.back(), goForward: () => history.forward() });
  const flush = () => {
    app(synchronize)();
    if (scope.activeRoute === "settings") vm.runInNewContext(compile(settingsEffect.getText(settings)), scope)();
    app(recordRoute)();
    if (scope.activeRoute === "settings") {
      scope.updatePluginDirectoryNavigation(null);
      scope.updatePluginManagementNavigation(navigation());
    } else {
      scope.updatePluginManagementNavigation(null);
      scope.updatePluginDirectoryNavigation(navigation());
    }
  };
  scope.updatePluginDirectoryNavigation(navigation());
  return { scope, entries, writes, history, location, flush, dispose: lifecycle,
    manage: () => app(manage)(),
    back: () => { scope.navigateRouteHistory(-1); flush(); }, forward: () => { scope.navigateRouteHistory(1); flush(); } };
}

{
  const view = fixture(); view.manage(); view.flush();
  assert.equal(view.location.pathname, "/settings/plugins-settings", "Manage targets the established management root");
  assert.equal(view.entries.length, 2, "Manage must preserve the directory detail as a distinct browser history entry");
  assert.equal(view.entries[0].url, `https://private.test${origin}`);
  assert.equal(view.entries[0].state.keep, "foreign-state");
  assert.equal(view.scope.pluginManagementNavigation.canGoBack, true, "a newly mounted management root retains the boundary back action");
  view.back();
  assert.equal(view.scope.activeRoute, "plugins"); assert.equal(view.location.href, `https://private.test${origin}`);
  assert.equal(view.scope.pluginDirectoryNavigation.canGoForward, true);
  view.forward(); assert.equal(view.scope.activeRoute, "settings"); assert.equal(view.location.pathname, "/settings/plugins-settings");
  view.back(); assert.equal(view.location.href, `https://private.test${origin}`, "repeated cross-page traversal preserves exact source/search/category/tab");
  assert.deepEqual(Array.from(view.scope.routeHistoryRef.current.entries), ["plugins", "settings"], "native boundary traversal must not append duplicate shell routes");
  assert.equal(view.scope.routeHistoryRef.current.index, 0);
  view.dispose();
}
{
  const view = fixture(); let resume;
  view.scope.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
  view.manage(); assert.equal(view.location.href, `https://private.test${origin}`);
  assert.equal(view.writes.length, 0, "declining a dirty-draft guard writes no history markers or routes");
  assert.equal(view.scope.activeRoute, "plugins");
  assert.equal(view.scope.activeSection, "general-settings", "declining navigation preserves the previous settings selection too");
  view.scope.personalizationNavigationGuardRef.current = null;
  resume(); view.flush(); assert.equal(view.entries.length, 2);
  resume(); assert.equal(view.entries.length, 2, "a resumed handoff is consumed once");
  view.dispose();
}
{
  const view = fixture();
  view.scope.routeHistoryRef.current = { entries: ["home", "plugins"], index: 1 };
  view.manage(); view.flush();
  view.history.back(); view.flush();
  assert.deepEqual(Array.from(view.scope.routeHistoryRef.current.entries), ["home", "plugins", "settings"],
    "direct native Back must restore the handoff's shell position rather than append another Plugins route");
  assert.equal(view.scope.routeHistoryRef.current.index, 1);
  assert.equal(view.location.href, `https://private.test${origin}`);
  view.history.forward(); view.flush();
  assert.equal(view.scope.routeHistoryRef.current.index, 2);
  assert.equal(view.location.pathname, "/settings/plugins-settings");
  view.history.back(); view.flush();
  view.back(); assert.equal(view.scope.activeRoute, "home", "shell Back after native Back follows the original Home ancestor");
  view.dispose();
}
{
  const view = fixture(); view.manage(); view.flush();
  view.history.pushState(view.history.state, "", exports.pluginManagementAppUrl(view.location.href, { appId: "actual-app" }));
  view.history.back(); view.flush();
  view.scope.setActiveRoute("home"); view.flush();
  assert.equal(view.scope.routeHistoryRef.current.entries.at(-1), "home",
    "a same-App-route popstate must not leave the skip-append flag armed for the next unrelated route");
  view.dispose();
}
{
  const view = fixture(); let resume;
  view.scope.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
  view.manage(); view.history.replaceState({}, "", "/plugins/another?pluginName=another&marketplacePath=D%3A%2Fother");
  const before = view.writes.length;
  resume(); assert.equal(view.writes.length, before, "late confirmation cannot cross from a different directory detail");
  view.dispose();
}
{
  const view = fixture(); view.scope.activeRoute = "skills"; view.scope.activeRouteRef.current = "skills";
  view.scope.routeHistoryRef.current.entries = ["skills"];
  view.manage(); view.flush();
  assert.equal(view.location.pathname, "/settings/plugins-settings", "the shared directory reached through the Skills tab retains its Manage action");
  view.back(); assert.equal(view.location.href, `https://private.test${origin}`);
  assert.equal(view.scope.routeHistoryRef.current.entries[0], "plugins", "the original plugin URL restores the directory rather than the old Skills tab");
  view.dispose();
}
{
  const view = fixture(); view.manage(); view.flush(); let back = 0, forward = 0;
  view.scope.updatePluginManagementNavigation({ canGoBack: true, canGoForward: true, goBack: () => back++, goForward: () => forward++ });
  view.scope.navigateRouteHistory(-1); view.scope.navigateRouteHistory(1);
  assert.equal(back, 1); assert.equal(forward, 1, "a child's own subpage history takes priority over the cross-page boundary");
  const stale = view.scope.pluginManagementNavigation;
  view.history.replaceState({}, "", "/settings/plugins-settings/other");
  stale.goBack(); stale.goForward();
  assert.equal(back, 1); assert.equal(forward, 1, "retired boundary wrappers cannot invoke old child navigation");
  view.dispose();
}
{
  const view = fixture(); view.manage(); view.flush();
  view.scope.personalizationNavigationGuardRef.current = () => false;
  const before = view.writes.length;
  view.back();
  assert.equal(view.location.pathname, "/settings/plugins-settings"); assert.equal(view.writes.length, before,
    "the existing management history guard also protects the boundary Back action");
  view.dispose();
}
const { harness } = await import("./verify-plugin-management-ui-b.mjs");
const childPlugin = { id: "tool@private", name: "tool", installed: true, enabled: true, source: { type: "local", path: "D:/private/tool" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const childMarket = { name: "private", path: "D:/private/market.json", plugins: [childPlugin] };
async function mountDirectory(view, initialTab = "plugins") {
  const child = harness({ window: view.scope.window, directory: { loadPluginDirectorySource: async () => ({ kind: "local" }) }, plugins: {
    listInstalledPlugins: async () => ({ marketplaces: [childMarket] }), listMarketplacePlugins: async () => ({ marketplaces: [childMarket] }),
    pluginRefFor: () => ({ pluginName: childPlugin.name, marketplacePath: childMarket.path }),
    readPlugin: async () => ({ summary: childPlugin, marketplaceName: childMarket.name, marketplacePath: childMarket.path,
      skills: [], apps: [], appTemplates: [], hooks: [], mcpServers: [] }),
  } });
  child.props.manageOnly = false; child.props.initialTab = initialTab;
  child.props.onManagePlugins = () => view.manage(); child.props.onNavigationChange = view.scope.updatePluginDirectoryNavigation;
  child.render(); await child.tick(); return child;
}
{
  const view = fixture("/", "skills"), child = await mountDirectory(view, "skills");
  child.tabs().find(node => child.text(node).startsWith("插件")).props.onClick(); await child.tick();
  assert.equal(view.location.pathname, "/", "the real shared Skills child has not written a directory URL merely by changing tabs");
  child.button("管理").props.onClick(); child.unmount(); view.flush();
  assert.equal(view.location.pathname, "/settings/plugins-settings", "the visible Manage action reached through Skills must navigate");
  view.back(); assert.equal(view.location.pathname, "/plugins", "Back restores the actual Plugins body rather than interpreting '/' as Home");
  view.dispose();
}
{
  const sourceUrl = exports.pluginDirectoryDetailUrl("/plugins", { pluginId: childPlugin.id, pluginName: childPlugin.name, marketplacePath: childMarket.path });
  const view = fixture(sourceUrl); view.manage(); view.flush(); view.back();
  const child = await mountDirectory(view);
  child.nodes(child.tree).find(node => node.props.className === "pm-catalog-back").props.onClick(); await child.tick();
  const card = child.nodes(child.tree).find(node => node.props.className?.includes("pm-catalog-card"));
  assert.ok(card); card.props.onClick(); await child.tick();
  assert.equal(view.location.href, `https://private.test${sourceUrl}`);
  assert.equal(view.scope.pluginDirectoryNavigation.canGoBack, true);
  assert.equal(view.scope.pluginDirectoryNavigation.canGoForward, false, "new child pushes truncate the old management forward entry even when the detail URL and copied boundary marker match");
  assert.equal(view.scope.routeHistoryRef.current.entries.length, 1, "the old shell forward route must be retired with the truncated browser entry");
  view.scope.navigateRouteHistory(1);
  assert.equal(view.location.href, `https://private.test${sourceUrl}`, "shell fallback cannot resurrect the old management route after a new child branch");
  child.unmount(); view.dispose();
}
console.log("PASS actual directory-to-management handoff: exact root, preserved source/search/category/history, toolbar and direct-native back/forward, same-route popstate flag cleanup, dirty-draft rejection and stale single-use continuation");
