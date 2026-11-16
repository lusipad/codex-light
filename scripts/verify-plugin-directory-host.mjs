import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const locations = {};
vm.runInNewContext(compile(fs.readFileSync("src/pluginDirectoryLocation.ts", "utf8")), { exports: locations, URL, URLSearchParams });
const source = fs.readFileSync("src/App.tsx", "utf8"), ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initial, restore, synchronize, toolbar;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "[activeRoute, commitActiveRoute]") initial = node.initializer.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "navigateRouteHistory") toolbar = node.initializer.arguments[0].getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]) {
    const text = node.arguments[0].getText(ast);
    if (text.includes("const restorePageRoute")) restore = text;
    if (text.includes("libraryLocationUrl(window.location.href") && text.includes("url.pathname")) synchronize = text;
  }
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(initial && restore && synchronize);
function fixture(href, activeRoute = "home", utility = false) {
  const listeners = new Map(), calls = [], writes = [];
  const location = {};
  const setUrl = value => { const url = new URL(value, "https://private.test"); Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash }); };
  setUrl(href);
  const context = { URL, URLSearchParams, ...locations, activeRoute, activeRouteRef: { current: activeRoute },
    isQuickChatWindow: utility, isThreadWindow: false, libraryFileId: null, libraryCleanupTab: null,
    parseSitesLocation: value => new URL(String(value), "https://private.test").pathname.startsWith("/sites") ? {} : null,
    parseLibraryFileLocation: () => null, parseLibraryLocation: () => null,
    setLibraryFileId() {}, setLibraryCleanupTab() {},
    setActiveRoute: route => { calls.push(route); context.activeRouteRef.current = route; },
    window: { location, addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
      history: { state: null, replaceState: (_state, _unused, url) => { writes.push(url); setUrl(url); } } },
  };
  return { context, calls, writes, setUrl,
    initial: () => vm.runInNewContext(compile(`(${initial})`), context)(),
    restore: () => vm.runInNewContext(compile(`(${restore})`), context)(),
    synchronize: () => vm.runInNewContext(compile(`(${synchronize})`), context)(),
    pop: url => { setUrl(url); listeners.get("popstate")?.(); }, listeners,
  };
}
assert.equal(fixture("/plugins/id%2Fopaque?pluginName=raw&remoteMarketplaceName=chatgpt-workspace").initial(), "plugins");
assert.equal(fixture("/plugins").initial(), "plugins");
assert.equal(fixture("/plugins", "home", true).initial(), "home");
{
  assert.ok(toolbar);
  let back = 0, forward = 0;
  const applied = [], history = { entries: ["home", "plugins", "settings"], index: 1 };
  const context = { activeRouteRef: { current: "plugins" },
    pluginDirectoryNavigationRef: { current: { canGoBack: true, canGoForward: true, goBack: () => back++, goForward: () => forward++ } },
    routeHistoryRef: { current: history }, personalizationNavigationGuardRef: { current: null },
    navigatingRouteHistoryRef: { current: false }, setRouteHistoryVersion() {}, setActiveRoute: route => applied.push(route),
  };
  const navigate = vm.runInNewContext(compile(`(${toolbar})`), context);
  navigate(-1); navigate(1);
  assert.equal(back, 1); assert.equal(forward, 1); assert.equal(history.index, 1); assert.equal(applied.length, 0);
  context.pluginDirectoryNavigationRef.current = null;
  context.personalizationNavigationGuardRef.current = () => false;
  navigate(-1); assert.equal(history.index, 1, "route fallback still respects unsaved-navigation guards");
  context.personalizationNavigationGuardRef.current = null;
  navigate(-1); assert.equal(applied[0], "home"); assert.equal(history.index, 0);
}
{
  const h = fixture("/sites", "sites"), cleanup = h.restore();
  h.pop("/plugins/id?search=keep"); assert.equal(h.calls.at(-1), "plugins");
  h.pop("/plugins?search=keep"); assert.equal(h.calls.at(-1), "plugins");
  h.pop("/"); assert.equal(h.calls.at(-1), "home");
  cleanup(); assert.equal(h.listeners.size, 0);
}
{
  const h = fixture("/", "plugins"); h.synchronize(); assert.equal(h.context.window.location.pathname, "/plugins");
  const detail = fixture("/plugins/raw?search=keep&pluginName=actual", "plugins"); detail.synchronize();
  assert.equal(detail.writes.length, 0, "parent does not overwrite a child detail route");
}
{
  const h = fixture("/plugins/raw?search=old&category=tools&pluginName=actual&other=keep", "sites"); h.synchronize();
  assert.equal(h.context.window.location.pathname, "/sites", "leaving plugins must not erase the next service route");
  assert.equal(new URL(h.context.window.location.href).searchParams.get("other"), "keep");
  assert.equal(new URL(h.context.window.location.href).searchParams.has("pluginName"), false);
}
console.log("PASS actual App plugin initial/deep routes, history restore/cleanup, child detail retention and service-route handoff");
