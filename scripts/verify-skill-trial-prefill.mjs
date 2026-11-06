import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectNavigation } from "./verify-sidebar-project-selection.mjs";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useCallback") callbacks.set(node.name.getText(ast), node.initializer.arguments[0].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const evaluate = (name, context) => vm.runInNewContext(compile(callbacks.get(name)), context);
const skill = { name: "sample", path: "C:/isolated/SKILL.md", defaultPrompt: "Use sample" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount() {
  const view = mountProjectNavigation(), context = view.context;
  let drafts = { home: "old draft", "thread:other": "keep thread" };
  Object.assign(context, {
    activeRouteRef: { current: "skills" }, executionIdentityRef: { current: "account-A" },
    deepLinkRouteRef: { current: { route: "skills", revision: 0 } },
    skillTrialContextRef: { current: { key: "account/workspace/project/connection-A" } },
    skillTrialRequestRef: { current: 0 }, homePromptRevisionRef: { current: 0 },
    setPromptDrafts: update => { drafts = update(drafts); },
    buildSkillTrialPrompt: value => `${value.defaultPrompt} [$${value.name}](${value.path}) `,
    commitActiveRoute: route => { view.state.activeRoute = route; },
  });
  context.setActiveRoute = route => { context.activeRouteRef.current = route; view.state.activeRoute = route; };
  context.setThreadPrompt = evaluate("setThreadPrompt", context);
  context.handleTrySkill = evaluate("handleTrySkill", context);
  const actual = callbacks.has("commitNewThreadNavigation") ? evaluate("commitNewThreadNavigation", context) : view.start;
  context.commitNewThreadNavigation = (...args) => actual(...args);
  context.startNewThread = (...args) => actual(...args);
  return { ...view, run: context.handleTrySkill, drafts: () => JSON.parse(JSON.stringify(drafts)),
    deferNavigation(gate) {
      context.commitNewThreadNavigation = context.startNewThread = async (...args) => { await gate.promise; return actual(...args); };
    },
  };
}
let failures = 0, total = 0;
async function check(name, run) {
  total++;
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
await check("ST02 existing home is replaced and other thread is untouched", async () => {
  const v = mount(); assert.equal(await v.run(skill), true);
  assert.equal(v.drafts().home, v.context.buildSkillTrialPrompt(skill));
  assert.equal(v.drafts()["thread:other"], "keep thread");
});
await check("ST03 repeated trials leave the latest prefill only", async () => {
  const v = mount(); await v.run(skill);
  const second = { ...skill, defaultPrompt: "Second" }; await v.run(second);
  assert.equal(v.drafts().home, v.context.buildSkillTrialPrompt(second));
});
for (const change of ["account", "workspace", "project", "connection", "route", "navigation", "context-ABA", "route-ABA"]) {
  await check(`ST05 deferred guard cannot replay after ${change} changes`, async () => {
    const v = mount(); let resume;
    v.context.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
    assert.equal(await v.run(skill), false); assert.equal(v.calls.length, 0);
    v.context.personalizationNavigationGuardRef.current = null;
    if (change === "account") v.context.executionIdentityRef.current = "account-B";
    if (["account", "workspace", "project", "connection"].includes(change)) v.context.skillTrialContextRef.current = { key: change };
    if (change === "route") v.context.deepLinkRouteRef.current = { route: "settings", revision: 1 };
    if (change === "navigation") v.context.navigationRequestRef.current++;
    if (change === "context-ABA") v.context.skillTrialContextRef.current = { ...v.context.skillTrialContextRef.current };
    if (change === "route-ABA") v.context.deepLinkRouteRef.current = { route: "skills", revision: 2 };
    resume(); await settle();
    assert.equal(v.calls.length, 0, "stale confirmation must not navigate or focus");
    assert.equal(v.drafts().home, "old draft");
  });
}
await check("ST05 production context key tracks workspace, project and connection", async () => {
  let expression;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "skillTrialContextKey") expression = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(expression);
  const base = { modelAccountIdentity: "account-A", activeWorkspace: { path: "A" }, worktreeProjectScope: '["P",["A"]]',
    appServerStatus: { connected: true, binaryPath: "cli", appServerVersion: "1", userAgent: "agent" } };
  const key = value => vm.runInNewContext(expression, value);
  for (const next of [
    { ...base, modelAccountIdentity: "account-B" }, { ...base, activeWorkspace: { path: "B" } },
    { ...base, worktreeProjectScope: '["Q",["A"]]' }, { ...base, worktreeProjectScope: '["P",["A","B"]]' },
    ...Object.keys(base.appServerStatus).map(field => ({ ...base, appServerStatus: { ...base.appServerStatus, [field]: field === "connected" ? false : "changed" } })),
  ]) assert.notEqual(key(next), key(base));
});
await check("ST04 accepted continuation consumes once", async () => {
  const v = mount(); let resume;
  v.context.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
  await v.run(skill); v.context.personalizationNavigationGuardRef.current = null;
  resume(); resume(); await settle();
  assert.equal(v.context.navigationRequestRef.current, 1);
  assert.equal(v.drafts().home, v.context.buildSkillTrialPrompt(skill));
});
await check("ST07 new input during a delayed navigation survives", async () => {
  const v = mount(), gate = deferred(); v.deferNavigation(gate);
  const pending = v.run(skill); v.context.setThreadPrompt(null, "new user input");
  gate.resolve(); assert.equal(await pending, false);
  assert.equal(v.drafts().home, "new user input");
});
await check("ST04 edit while guard waits leaves the new draft and navigation untouched", async () => {
  const v = mount(); let resume;
  v.context.personalizationNavigationGuardRef.current = action => { resume = action; return false; };
  await v.run(skill); v.context.setThreadPrompt(null, "new input");
  v.context.personalizationNavigationGuardRef.current = null; resume(); await settle();
  assert.equal(v.context.navigationRequestRef.current, 0); assert.equal(v.drafts().home, "new input");
  assert.deepEqual(v.state.permissionModes, { "account:draft:D:/one": "full", "account:old": "ask" });
});
await check("ST07 older trial cannot replace a newer trial", async () => {
  const v = mount(), gate = deferred(); v.deferNavigation(gate);
  const older = v.run(skill);
  v.context.commitNewThreadNavigation = v.context.startNewThread = async () => {
    const token = ++v.context.navigationRequestRef.current;
    v.context.activeThreadIdRef.current = null; v.context.activeRouteRef.current = "home";
    return token;
  };
  const latest = { ...skill, defaultPrompt: "Latest" }; assert.equal(await v.run(latest), true);
  gate.resolve(); assert.equal(await older, false);
  assert.equal(v.drafts().home, v.context.buildSkillTrialPrompt(latest));
});
await check("ST07 home route alone cannot turn failed navigation into success", async () => {
  const v = mount(); v.context.activeThreadIdRef.current = null; v.context.activeRouteRef.current = "home";
  v.context.commitNewThreadNavigation = v.context.startNewThread = async () => null;
  assert.equal(await v.run(skill), false); assert.equal(v.drafts().home, "old draft");
});
console.log(`Skill trial production callbacks: ${total - failures}/${total} passed; no backend or model invoked`);
process.exitCode = failures ? 1 : 0;
