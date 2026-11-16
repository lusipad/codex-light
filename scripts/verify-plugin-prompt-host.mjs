import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectNavigation } from "./verify-sidebar-project-selection.mjs";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
let openSettings;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useCallback") callbacks.set(node.name.getText(ast), node.initializer.arguments[0].getText(ast));
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onOpenPluginSettings") openSettings = node.initializer.expression.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callbacks.has("handleTryPlugin"), "App must host plugin starter prompts as real drafts");
const evaluate = (name, context) => vm.runInNewContext(ts.transpileModule(`(${callbacks.get(name)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const plugin = { id: "actual/name@source)", name: "internal-name", interface: { displayName: "Display [label]" } };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount() {
  const v = mountProjectNavigation(), c = v.context;
  let drafts = { home: "old", "thread:other": "keep" };
  Object.assign(c, {
    activeRouteRef: { current: "plugins" }, executionIdentityRef: { current: "account-A" },
    deepLinkRouteRef: { current: { route: "plugins", revision: 0 } },
    skillTrialRequestRef: { current: 0 }, skillTrialContextRef: { current: { key: "account-project-connection" } },
    homePromptRevisionRef: { current: 0 },
    pluginDisplayName: p => p.interface?.displayName?.trim() || p.name,
    setPromptDrafts: update => { drafts = update(drafts); },
  });
  c.setThreadPrompt = evaluate("setThreadPrompt", c);
  c.commitNewThreadNavigation = evaluate("commitNewThreadNavigation", c);
  return { ...v, run: evaluate("handleTryPlugin", c), drafts: () => drafts };
}
{
  const v = mount(); assert.equal(await v.run(plugin, "  Actual prompt\n第二行  "), true);
  assert.equal(v.drafts().home, "[@Display \\[label\\]](plugin://actual/name@source\\)) Actual prompt\n第二行");
  assert.equal(v.drafts()["thread:other"], "keep");
  assert.equal(v.context.activeThreadIdRef.current, null);
  assert.equal(v.state.activeRoute, "home");
  assert.equal(v.calls.some(call => call[0] === "invoke"), false, "local draft must not call model or backend");
}
{
  const v = mount();
  assert.equal(await v.run({ ...plugin, id: "  opaque\\id@source  ", interface: null }, " use raw "), true);
  assert.equal(v.drafts().home, "[@internal-name](plugin://opaque\\\\id@source) use raw", "retain raw id and escape Markdown, without URI encoding");
}
for (const [value, prompt] of [[{ ...plugin, id: " " }, "valid"], [{ ...plugin, name: "" }, "valid"], [plugin, " \n"]]) {
  const v = mount(); assert.equal(await v.run(value, prompt), false); assert.equal(v.calls.length, 0); assert.equal(v.drafts().home, "old");
}
for (const change of ["account", "project", "connection", "context-ABA", "route-ABA", "navigation", "draft", "new-trial"]) {
  const v = mount(); let resume;
  v.context.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
  assert.equal(await v.run(plugin, "original"), false);
  v.context.personalizationNavigationGuardRef.current = null;
  if (change === "account") v.context.executionIdentityRef.current = "account-B";
  if (["project", "connection", "context-ABA"].includes(change)) v.context.skillTrialContextRef.current = { key: "account-project-connection" };
  if (change === "route-ABA") v.context.deepLinkRouteRef.current = { route: "plugins", revision: 2 };
  if (change === "navigation") v.context.navigationRequestRef.current++;
  if (change === "draft") v.context.setThreadPrompt(null, "new text");
  if (change === "new-trial") v.context.skillTrialRequestRef.current++;
  const token = v.context.navigationRequestRef.current;
  resume(); await settle();
  assert.equal(v.context.navigationRequestRef.current, token, change);
  assert.equal(v.drafts().home, change === "draft" ? "new text" : "old", change);
}
{
  const v = mount(); let resume;
  v.context.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
  await v.run(plugin, "once"); v.context.personalizationNavigationGuardRef.current = null;
  resume(); resume(); await settle();
  assert.equal(v.context.navigationRequestRef.current, 1);
  assert.equal(v.drafts().home.endsWith(" once"), true);
}
{
  const v = mount(); let release;
  v.context.commitNewThreadNavigation = async () => {
    await new Promise(resolve => { release = resolve; });
    v.context.activeThreadIdRef.current = null; v.context.activeRouteRef.current = "home";
    return ++v.context.navigationRequestRef.current;
  };
  const pending = v.run(plugin, "late"); v.context.setThreadPrompt(null, "new draft"); release();
  assert.equal(await pending, false); assert.equal(v.drafts().home, "new draft");
}
for (const change of ["account", "context-ABA", "new-navigation", "thread", "route", "failed-navigation"]) {
  const v = mount(); let release;
  v.context.commitNewThreadNavigation = async () => {
    const token = ++v.context.navigationRequestRef.current;
    await new Promise(resolve => { release = resolve; });
    return change === "failed-navigation" ? null : token;
  };
  const pending = v.run(plugin, "late");
  v.context.activeThreadIdRef.current = null; v.context.activeRouteRef.current = "home";
  if (change === "account") v.context.executionIdentityRef.current = "account-B";
  if (change === "context-ABA") v.context.skillTrialContextRef.current = { key: "account-project-connection" };
  if (change === "new-navigation") v.context.navigationRequestRef.current++;
  if (change === "thread") v.context.activeThreadIdRef.current = "new-thread";
  if (change === "route") v.context.activeRouteRef.current = "settings";
  release(); assert.equal(await pending, false, change); assert.equal(v.drafts().home, "old", change);
}
assert.match(source, /onTryPlugin=\{handleTryPlugin\}/);
assert.ok(!/callAppServer|turn\/start|thread\/start|showAppToast/.test(callbacks.get("handleTryPlugin")));
{
  assert.ok(openSettings);
  const calls = [];
  const open = vm.runInNewContext(ts.transpileModule(`(${openSettings})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    setSettingsInitialSection: section => calls.push(["section", section]), setActiveRoute: route => calls.push(["route", route]),
  });
  for (const section of ["connections", "hooks-settings"]) {
    calls.length = 0; open(section);
    assert.deepEqual(calls, [["section", section], ["route", "settings"]]);
  }
}
console.log("PASS plugin prompt production draft callback, precise mention, guards, identity revisions, single consumption and no model execution");
