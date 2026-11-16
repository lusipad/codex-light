import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const locations = {};
for (const file of ["pluginDirectoryLocation", "pluginManagementLocation"]) {
  vm.runInNewContext(compile(fs.readFileSync(`src/${file}.ts`, "utf8")), { exports: locations, URL, URLSearchParams });
}
const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (["[activeRoute, commitActiveRoute]", "[settingsInitialSection, setSettingsInitialSection]", "navigateRouteHistory", "handleOpenPluginMarketplace", "handleOpenManagedPluginDirectory"].includes(name)) {
      callbacks[name] = node.initializer.arguments[0].getText(ast);
    }
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]) {
    const text = node.arguments[0].getText(ast);
    if (text.includes("const restorePageRoute")) callbacks.restore = text;
    if (text.includes("libraryLocationUrl(window.location.href") && text.includes("url.pathname")) callbacks.synchronize = text;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
function fixture(path, route = "home", utility = false) {
  const listeners = new Map(), calls = [], writes = [], sections = [], location = {};
  const setUrl = value => { const url = new URL(value, "https://private.test"); Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash }); };
  setUrl(path);
  const context = {
    ...locations, URL, URLSearchParams, activeRoute: route, activeRouteRef: { current: route },
    isQuickChatWindow: utility, isThreadWindow: false, libraryFileId: null, libraryCleanupTab: null,
    pluginManagementLocationRef: { current: Boolean(locations.parsePluginManagementLocation(location.href)) },
    parseSitesLocation: value => new URL(String(value), location.href).pathname === "/sites" ? {} : null,
    parseLibraryLocation: () => null, parseLibraryFileLocation: () => null,
    setLibraryFileId() {}, setLibraryCleanupTab() {}, closeLibraryFile() {},
    setSettingsInitialSection: section => sections.push(section),
    commitActiveRoute: value => { calls.push(value); context.activeRouteRef.current = value; },
    setPluginDirectoryMode: value => calls.push(["directory-mode", value]),
    setActiveRoute: value => { calls.push(value); context.activeRouteRef.current = value; },
    pluginManagementNavigationRef: { current: null }, pluginDirectoryNavigationRef: { current: null },
    sitesNavigationRef: { current: null }, libraryNavigationRef: { current: null },
    routeHistoryRef: { current: { entries: ["home", "settings", "library"], index: 1 } },
    personalizationNavigationGuardRef: { current: null }, navigatingRouteHistoryRef: { current: false }, setRouteHistoryVersion() {},
    window: { location, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
      history: { state: {}, replaceState: (_state, _title, value) => { writes.push(value); setUrl(value); },
        pushState(state, _title, value) { this.state = state; writes.push(value); setUrl(value); } } },
  };
  const evaluate = key => vm.runInNewContext(compile(`(${callbacks[key]})`), context);
  context.navigateRouteHistory = evaluate("navigateRouteHistory");
  return { context, calls, writes, sections, setUrl, evaluate, listeners,
    pop(value) { setUrl(value); listeners.get("popstate")(); } };
}

for (const path of ["/settings/plugins-settings", "/settings/plugins-settings/id%2Fopaque/permissions", "/settings/plugins-settings/hosts/local/plugins/tool%40market?pluginName=Actual"]) {
  const h = fixture(path);
  assert.equal(h.evaluate("[activeRoute, commitActiveRoute]")(), "settings");
  assert.equal(h.evaluate("[settingsInitialSection, setSettingsInitialSection]")(), "plugins-settings");
  assert.equal(fixture(path, "home", true).evaluate("[activeRoute, commitActiveRoute]")(), "home", "utility windows do not acquire management routes");
}
for (const path of ["/settings/plugins-settings/unknown/subpath", "/settings/plugins-settings/%zz", "/settings/plugins-settings/a//b"]) {
  const h = fixture(path, "settings");
  assert.equal(h.evaluate("[activeRoute, commitActiveRoute]")(), "settings");
  assert.equal(h.evaluate("[settingsInitialSection, setSettingsInitialSection]")(), "plugins-settings");
  h.evaluate("synchronize")();
  assert.equal(h.context.window.location.pathname, "/settings/plugins-settings");
  assert.equal(h.writes.length, 1, "unknown management paths replace the current history entry");
  const utility = fixture(path, "home", true);
  assert.equal(utility.evaluate("[activeRoute, commitActiveRoute]")(), "home");
  utility.evaluate("synchronize")(); assert.equal(utility.writes.length, 0);
}
assert.equal(fixture("/settings/plugins-settings-other/id").evaluate("[activeRoute, commitActiveRoute]")(), "home");
assert.equal(fixture("/").evaluate("[settingsInitialSection, setSettingsInitialSection]")(), "general-settings");
{
  const h = fixture("/", "home"), cleanup = h.evaluate("restore")();
  h.pop("/settings/plugins-settings/tool?hostId=local");
  assert.equal(h.calls.at(-1), "settings"); assert.equal(h.sections.at(-1), "plugins-settings");
  h.pop("/settings/plugins-settings"); assert.equal(h.calls.at(-1), "settings");
  h.pop("/settings/plugins-settings/unknown/subpath?pluginName=untrusted#ignored");
  assert.equal(h.calls.at(-1), "settings"); assert.equal(h.sections.at(-1), "plugins-settings");
  assert.equal(h.context.window.location.pathname, "/settings/plugins-settings");
  assert.equal(h.context.window.location.search, ""); assert.equal(h.context.window.location.hash, "");
  h.pop("/"); assert.equal(h.calls.at(-1), "home");
  cleanup(); assert.equal(h.listeners.size, 0);
}
{
  const h = fixture("/settings/plugins-settings/tool?hostId=local&pluginName=Tool&marketplacePath=C%3A%2Fm.json&tab=mcps&other=keep#retained", "sites");
  h.evaluate("synchronize")();
  const url = new URL(h.context.window.location.href);
  assert.equal(url.pathname, "/sites"); assert.equal(url.searchParams.get("other"), "keep"); assert.equal(url.hash, "#retained");
  for (const key of ["hostId", "pluginName", "marketplacePath", "remoteMarketplaceName", "tab"]) assert.equal(url.searchParams.has(key), false);
  const ordinary = fixture("/settings/general-settings?other=keep", "settings"); ordinary.evaluate("synchronize")(); assert.equal(ordinary.writes.length, 0);
  const management = fixture("/settings/plugins-settings/id", "settings"); management.evaluate("synchronize")(); assert.equal(management.writes.length, 0);
}
{
  const h = fixture("/settings/plugins-settings/id", "settings"), traversed = [];
  h.context.pluginManagementNavigationRef.current = { canGoBack: true, canGoForward: true, goBack: () => traversed.push("back"), goForward: () => traversed.push("forward") };
  h.context.navigateRouteHistory(-1); h.context.navigateRouteHistory(1);
  assert.deepEqual(traversed, ["back", "forward"]); assert.equal(h.calls.length, 0); assert.equal(h.context.routeHistoryRef.current.index, 1);
  let pending;
  h.context.personalizationNavigationGuardRef.current = action => { pending = action; return false; };
  h.context.navigateRouteHistory(-1); assert.deepEqual(traversed, ["back", "forward"], "pending MCP or settings edits block internal traversal");
  pending(); assert.equal(traversed.at(-1), "back", "confirmed guard resumes the exact traversal");
  h.context.personalizationNavigationGuardRef.current = null;
  h.setUrl("/settings/general-settings"); h.context.navigateRouteHistory(-1);
  assert.equal(h.calls.at(-1), "home", "stale plugin navigation does not capture ordinary settings history");
}
assert.ok(source.includes("onPluginNavigationChange={updatePluginManagementNavigation}"));
assert.ok(callbacks.handleOpenPluginMarketplace, "the actual App owns the protected add-marketplace directory handoff");
{
  const h = fixture("/settings/plugins-settings?hostId=local", "settings");
  const openMarketplace = h.evaluate("handleOpenPluginMarketplace");
  let pending;
  h.context.personalizationNavigationGuardRef.current = apply => { pending = apply; return false; };
  openMarketplace("  "); assert.equal(pending, undefined, "empty marketplace names never produce navigation");
  openMarketplace("actual-market");
  assert.equal(h.writes.length, 0, "guard rejection must not mutate URL/history");
  assert.equal(h.calls.length, 0, "guard rejection must not change route or directory mode");
  pending(); pending();
  assert.deepEqual(h.writes, ["/plugins?directory=personal"], "the accepted handoff pushes one official destination");
  assert.deepEqual(h.calls, [["directory-mode", "browse"], "plugins"]);
  assert.equal(h.context.window.history.state.initialHostId, "local");
  assert.equal(h.context.window.history.state.initialMarketplaceName, "actual-market");
  assert.equal(h.context.window.history.state.initialTab, "plugins");
  assert.equal(h.context.window.history.state.pluginDirectoryEntrypoint, "SETTINGS");
}
{
  const h = fixture("/settings/plugins-settings", "settings"), openMarketplace = h.evaluate("handleOpenPluginMarketplace");
  let pending;
  h.context.personalizationNavigationGuardRef.current = apply => { pending = apply; return false; };
  openMarketplace("actual-market");
  h.context.activeRouteRef.current = "home";
  pending(); assert.equal(h.writes.length, 0, "a late accepted handoff cannot capture another route");
}
{
  const h = fixture("/settings/plugins-settings", "settings"), openMarketplace = h.evaluate("handleOpenPluginMarketplace");
  h.context.window.history.state = { retainedHostState: "retained" };
  h.context.personalizationNavigationGuardRef.current = apply => { apply(); return true; };
  openMarketplace("中文 / market?query=raw");
  assert.equal(h.writes.length, 1, "synchronous guard acceptance cannot duplicate the handoff");
  assert.equal(h.context.window.history.state.initialMarketplaceName, "中文 / market?query=raw", "names remain exact state data, never URL input");
  assert.equal(h.context.window.history.state.retainedHostState, "retained");
  assert.equal(h.context.window.location.search, "?directory=personal");
}
assert.ok(source.includes("onOpenPluginMarketplace={handleOpenPluginMarketplace}"));
assert.ok(callbacks.handleOpenManagedPluginDirectory, "the actual App protects management detail handoff");
{
  const summary = { id: "actual@market", name: "Actual", remotePluginId: null };
  const detail = { summary, marketplaceName: "private-market", marketplacePath: "C:/private/marketplace.json" };
  const h = fixture("/settings/plugins-settings/hosts/local/plugins/actual%40market", "settings");
  const open = h.evaluate("handleOpenManagedPluginDirectory");
  let pending;
  h.context.personalizationNavigationGuardRef.current = apply => { pending = apply; return false; };
  open(detail);
  assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 0);
  pending(); pending();
  assert.equal(h.writes.length, 1);
  const target = locations.parsePluginDirectoryLocation(h.context.window.location.href);
  assert.equal(target.pluginId, summary.id); assert.equal(target.pluginName, summary.name);
  assert.equal(target.marketplacePath, detail.marketplacePath); assert.equal(target.remoteMarketplaceName, null);
  assert.equal(target.hostId, "local"); assert.equal(target.breadcrumb, null, "ordinary header CL does not invent fallback breadcrumbs");
  assert.deepEqual(h.calls, [["directory-mode", "browse"], "plugins"]);
}
{
  const h = fixture("/settings/plugins-settings/hosts/local/plugins/entity%40remote", "settings");
  const open = h.evaluate("handleOpenManagedPluginDirectory");
  const detail = { summary: { id: "entity@remote", name: "DisplayName", remotePluginId: "raw-service-id" }, marketplaceName: "actual-remote", marketplacePath: null };
  open(detail);
  const target = locations.parsePluginDirectoryLocation(h.context.window.location.href);
  assert.equal(target.pluginId, detail.summary.id, "CL preserves entity ID rather than replacing it with the read request ID");
  assert.equal(target.pluginName, "raw-service-id"); assert.equal(target.remoteMarketplaceName, "actual-remote"); assert.equal(target.marketplacePath, null);
}
for (const [path, detail] of [
  ["/settings/plugins-settings/hosts/local/plugins/entity", { summary: { id: "entity", name: "Name" }, marketplaceName: "remote", marketplacePath: null }],
  ["/settings/plugins-settings/hosts/local/plugins/entity", { summary: { id: "entity", name: "Name", remotePluginId: "raw" }, marketplaceName: "", marketplacePath: null }],
  ["/settings/plugins-settings/raw-service-id", { summary: { id: "entity", name: "Name", remotePluginId: "raw" }, marketplaceName: "remote", marketplacePath: null }],
  ["/settings/plugins-settings/hosts/ssh-id/plugins/entity", { summary: { id: "entity", name: "Name" }, marketplaceName: "local", marketplacePath: "C:/m.json" }],
]) {
  const h = fixture(path, "settings"); h.evaluate("handleOpenManagedPluginDirectory")(detail);
  assert.equal(h.writes.length, 0, "missing true source/request ID or unsupported host/service never navigates");
}
{
  const h = fixture("/settings/plugins-settings/hosts/local/plugins/actual", "settings");
  let pending;
  h.context.personalizationNavigationGuardRef.current = apply => { pending = apply; return false; };
  h.evaluate("handleOpenManagedPluginDirectory")({ summary: { id: "actual", name: "Actual" }, marketplaceName: "market", marketplacePath: "C:/m.json" });
  h.setUrl("/settings/plugins-settings/hosts/local/plugins/other");
  pending(); assert.equal(h.writes.length, 0, "late confirmation cannot navigate a different current plugin");
}
assert.ok(source.includes("onOpenPluginDirectoryDetail={handleOpenManagedPluginDirectory}"));
console.log("PASS actual App management initialization, validated popstate, URL cleanup, internal traversal and settings navigation guards");
