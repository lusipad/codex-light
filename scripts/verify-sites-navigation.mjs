import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
const filename = 'src/sitesNavigation.ts';
assert.ok(fs.existsSync(filename), 'Sites deep links require a shared URL contract');
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL });
const { parseSitesLocation: parse, sitesLocationUrl: url } = exports;
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(parse('/sites')), { view: 'owned', siteId: null, search: '' });
assert.deepEqual(plain(parse('/sites?view=shared&search=ignored')), { view: 'shared', siteId: null, search: '' });
assert.deepEqual(plain(parse('/sites?view=all&search=中文', true)), { view: 'all', siteId: null, search: '中文' });
assert.equal(parse('/sites?view=all').view, 'owned');
assert.equal(parse('/sites?view=pinned').view, 'pinned');
assert.equal(parse('/sites?view=unknown').view, 'owned');
assert.equal(parse('/sites/site%20one/settings').siteId, 'site one');
for (const value of ['/sites/one/edit', '/sites/%2F/settings', '/sites/%/settings', '/other']) assert.equal(parse(value), null, value);
assert.equal(url('/sites?utility=private&view=shared#anchor', { view: 'owned', siteId: null, search: '' }), '/sites?utility=private#anchor');
assert.equal(url('/sites?utility=private&search=keep#anchor', { view: 'pinned', siteId: 'site one', search: 'ignored' }), '/sites/site%20one/settings?utility=private&search=keep&view=pinned#anchor');
assert.equal(url('/sites?other=1&search=old#anchor', { view: 'all', siteId: null, search: '中文' }, true), '/sites?other=1&search=%E4%B8%AD%E6%96%87&view=all#anchor');
assert.equal(url('/sites?search=old&other=1', { view: 'owned', siteId: null, search: '' }, true), '/sites?other=1');
const app = fs.readFileSync('src/App.tsx', 'utf8');
assert.match(app, /parseSitesLocation\(window\.location\.href\)/);
assert.match(app, /activeRoute === "sites" && sitesNavigation\?\.canGoBack/);
assert.match(app, /activeRouteRef\.current === "sites"[\s\S]{0,350}sitesNavigationRef\.current/);
assert.match(app, /sites-route-view/);
assert.match(app, /<SitesView onNavigationChange=\{updateSitesNavigation\}/);
console.log('PASS Sites URL routes, collection search, unrelated query/hash retention, invalid paths and App navigation wiring');
// Execute the actual App toolbar callback with isolated state; no React renderer or backend.
const source = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, restoreEffect;
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'navigateRouteHistory') callback = node.initializer.arguments[0].getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' &&
      node.arguments[0]?.getText(source).includes('const restorePageRoute')) restoreEffect = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(callback);
assert.ok(restoreEffect, 'Sites native history must register the real App restore callback');
{
  const listeners = new Map(), restored = [], location = { href: 'https://private.test/sites?view=pinned', pathname: '/sites', search: '?view=pinned', hash: '' };
  const state = { current: 'home' };
  const restoreContext = { exports: {}, URL, activeRouteRef: state, isQuickChatWindow: false, isThreadWindow: false,
    pluginManagementHandoffRef: { current: null }, pluginManagementLocationRef: { current: false },
    parseSitesLocation: parse, parsePluginDirectoryLocation: () => null, parsePluginManagementLocation: () => null,
    parseLibraryFileLocation: () => null, parseLibraryLocation: () => null,
    setSettingsInitialSection() {}, setLibraryFileId() {}, setLibraryCleanupTab() {},
    setActiveRoute(value) { state.current = value; restored.push(value); },
    window: { location, history: { state: null },
      addEventListener(name, handler) { listeners.set(name, handler); },
      removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); } },
  };
  const restore = vm.runInNewContext(ts.transpileModule(`(${restoreEffect})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, restoreContext);
  const cleanup = restore(); listeners.get('popstate')();
  assert.deepEqual(restored, ['sites'], 'native history restores Sites after unrelated preceding restore branches');
  location.href = 'https://private.test/'; location.pathname = '/'; location.search = '';
  listeners.get('popstate')(); assert.equal(restored.at(-1), 'home');
  cleanup(); assert.equal(listeners.size, 0, 'the actual restore effect releases its listener');
}
let route = 'sites', siteBack = 0, siteForward = 0, libraryBack = 0, libraryForward = 0, version = 0, applied = [];
const activeRouteRef = { current: route };
const sitesNavigationRef = { current: { canGoBack: true, canGoForward: true, back: () => siteBack++, forward: () => siteForward++ } };
const libraryNavigationRef = { current: { canGoBack: true, canGoForward: true, back: () => libraryBack++, forward: () => libraryForward++ } };
const routeHistoryRef = { current: { entries: ['home', 'sites', 'settings'], index: 1 } };
const personalizationNavigationGuardRef = { current: null }, navigatingRouteHistoryRef = { current: false }, navExports = {};
vm.runInNewContext(ts.transpileModule(`const navigateRouteHistory = ${callback}; exports.navigate = navigateRouteHistory;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: navExports, activeRouteRef, sitesNavigationRef, libraryNavigationRef, routeHistoryRef, personalizationNavigationGuardRef, navigatingRouteHistoryRef,
  setRouteHistoryVersion: updater => { version = updater(version); }, setActiveRoute: value => applied.push(value),
});
navExports.navigate(-1); navExports.navigate(1);
assert.equal(siteBack, 1); assert.equal(siteForward, 1); assert.equal(routeHistoryRef.current.index, 1); assert.equal(applied.length, 0);
activeRouteRef.current = 'library'; navExports.navigate(-1); navExports.navigate(1);
assert.equal(libraryBack, 1); assert.equal(libraryForward, 1);
activeRouteRef.current = 'sites'; sitesNavigationRef.current = null;
personalizationNavigationGuardRef.current = () => false; navExports.navigate(-1);
assert.equal(routeHistoryRef.current.index, 1); assert.equal(applied.length, 0);
personalizationNavigationGuardRef.current = null; navExports.navigate(-1);
assert.equal(routeHistoryRef.current.index, 0); assert.equal(applied.at(-1), 'home'); assert.equal(version, 1);
navExports.navigate(-1); assert.equal(version, 1);
console.log('PASS actual App toolbar callback: Sites/Library child history priority, guarded route fallback and bounds');
