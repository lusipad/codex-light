import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let openCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleTrySkill") {
    callback = node.initializer.arguments[0].getText(ast);
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleOpenSkillFile") {
    openCallback = node.initializer.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback, "App must bind skill trials to a real draft host");
function mount({ blocked = false, moved = false, draft = "", afterStart } = {}) {
  const calls = [], notices = [], identity = {};
  const ctx = {
    personalizationNavigationGuardRef: { current: blocked ? action => { ctx.resume = action; return false; } : null },
    executionIdentityRef: { current: identity }, activeThreadIdRef: { current: null },
    activeRouteRef: { current: "skills" },
    skillTrialRequestRef: { current: 0 }, skillTrialContextRef: { current: {} }, homePromptRevisionRef: { current: 0 },
    deepLinkRouteRef: { current: { route: "skills", revision: 0 } }, navigationRequestRef: { current: 0 },
    buildSkillTrialPrompt: skill => `use $${skill.name} `,
    commitNewThreadNavigation: async () => {
      calls.push("new draft"); ctx.activeRouteRef.current = moved ? "thread" : "home";
      afterStart?.(ctx);
      return ++ctx.navigationRequestRef.current;
    },
    setThreadPrompt: (id, update) => { assert.equal(id, null); ctx.draft = typeof update === "function" ? update(ctx.draft) : update; },
    setComposerFocusRequest: () => calls.push("focus"),
    showAppToast: (...args) => notices.push(args), draft,
  };
  const code = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInNewContext(code, ctx); ctx.handleTrySkill = run;
  return { ctx, calls, notices, run };
}
let view = mount();
assert.equal(await view.run({ name: "demo", path: "/x" }), true);
assert.equal(view.ctx.draft, "use $demo ");
assert.deepEqual(view.calls, ["new draft", "focus"]);
view = mount({ draft: "unsent work" });
assert.equal(await view.run({ name: "demo" }), true);
assert.equal(view.ctx.draft, "use $demo ", "official default home prefill replaces the target text");
view = mount({ blocked: true });
assert.equal(await view.run({ name: "demo" }), false);
assert.deepEqual(view.calls, []);
view.ctx.personalizationNavigationGuardRef.current = null;
await view.ctx.resume();
await Promise.resolve();
await Promise.resolve();
assert.equal(view.ctx.draft, "use $demo ");
view = mount({ moved: true, draft: "keep" });
assert.equal(await view.run({ name: "demo" }), false);
assert.equal(view.ctx.draft, "keep");
view = mount({ afterStart: ctx => { ctx.executionIdentityRef.current = {}; }, draft: "keep" });
assert.equal(await view.run({ name: "demo" }), false);
assert.equal(view.ctx.draft, "keep");
assert.ok(!callback.includes("callAppServer") && !callback.includes("turn/start") && !callback.includes("setSideChatPrompt"));
assert.ok(openCallback);
for (const accepted of [true, false]) {
  const events = [], ref = { current: async () => { throw Error("stale closed registration"); } };
  const ctx = {
    skillFilePreviewHandlerRef: ref,
    flushSync: action => {
      action(); events.push("render open");
      ref.current = async path => { events.push(`read ${path}`); return accepted; };
    },
    setSelectedReviewFinding: value => { assert.equal(value, null); events.push("clear review"); },
    setSelectedPreviewFile: value => { assert.equal(value, null); events.push("clear external request"); },
    setPreviewLine: value => assert.equal(value, undefined),
    setShowRightDrawer: value => { assert.equal(value, true); events.push("open"); },
  };
  const open = vm.runInNewContext(ts.transpileModule(`(${openCallback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, ctx);
  assert.equal(await open("SKILL.md"), accepted);
  assert.deepEqual(events, ["clear review", "clear external request", "open", "render open", "read SKILL.md"]);
}
console.log("PASS skill trial draft host: no auto-send, target replacement, guard and stale identity");
