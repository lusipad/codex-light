import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { execFileSync } from "node:child_process";
const source = process.argv.includes("--baseline") ? execFileSync("git", ["show", "ea66107:src/App.tsx"], { encoding: "utf8" }) : fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("src/App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "navigateRouteHistory") callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, walk);
}
walk(ast); assert.ok(callback);
const calls = [];
const context = {
  parsePluginManagementLocation: () => null, window: { location: { href: "https://private.test/" } },
  closeLibraryFile: () => calls.push("close-file"),
  activeRouteRef: { current: "library" },
  libraryNavigationRef: { current: { canGoBack: true, canGoForward: true, back: () => calls.push("back"), forward: () => calls.push("forward") } },
  routeHistoryRef: { current: { entries: ["home", "library", "settings"], index: 1 } },
  personalizationNavigationGuardRef: { current: null }, navigatingRouteHistoryRef: { current: false },
  setRouteHistoryVersion: () => {}, setActiveRoute: value => calls.push(value),
};
context.navigateRouteHistory = vm.runInNewContext(ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
context.navigateRouteHistory(-1); context.navigateRouteHistory(1);
assert.deepEqual(calls, ["back", "forward"]); assert.equal(context.routeHistoryRef.current.index, 1);
context.libraryNavigationRef.current.canGoBack = false;
context.navigateRouteHistory(-1); assert.equal(calls.at(-1), "home"); assert.equal(context.routeHistoryRef.current.index, 0);
context.activeRouteRef.current = "settings"; context.navigateRouteHistory(1);
assert.equal(calls.at(-1), "library", "other views use existing history even if stale library data exists");
context.activeRouteRef.current = "library-file";
context.navigateRouteHistory(1); assert.equal(calls.at(-1), "library");
context.navigateRouteHistory(-1); assert.equal(calls.at(-1), "close-file");
assert.ok(source.includes("onNavigationChange={updateLibraryNavigation}"));
console.log("PASS production App titlebar prioritizes current Library directory back/forward and preserves main route history at the root and on other views");
