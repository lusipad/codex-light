import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let slots = [], cursor = 0, effect, invoke, state;
const react = {
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effect = fn; },
};
const exports = {};
vm.runInNewContext(compile(fs.readFileSync("src/gitPreferences.ts", "utf8")), {
  exports, require: name => name === "react" ? react : { tauriInvoke: (...args) => invoke(...args) },
});
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const render = () => { cursor = 0; state = exports.useGitPreferences(); };
const saved = new Map();
let requests = [], release;
invoke = async (cmd, args) => {
  requests.push({ cmd, args });
  if (cmd === "desktop_state_set") saved.set(args.key, args.value);
  return saved.get(args.key) ?? null;
};
render(); const cleanup = effect(); await flush(); render();
assert.equal(state.ready, true);
assert.equal(state.preferences["git-create-pull-request-as-draft"], true);
assert.equal(state.preferences["git-always-force-push"], false);
assert.equal(await state.save("git-review-mode", "last-turn-only"), true); render();
assert.equal(saved.get("git-review-mode"), "last-turn-only");
assert.equal(state.preferences["git-review-mode"], "last-turn-only");
assert.ok(requests.some(item => item.cmd === "desktop_state_get" && item.args.key === "git-review-mode"));
invoke = async () => { throw Error("disk failure"); };
assert.equal(await state.save("git-always-force-push", true), false); render();
assert.equal(state.preferences["git-always-force-push"], false);
assert.equal(state.ready, false);
assert.match(state.error, /disk failure/);
invoke = async (_cmd, args) => saved.get(args.key) ?? null;
await state.reload(); render(); assert.equal(state.ready, true);
let count = 0;
invoke = (cmd, args) => {
  count++;
  if (cmd === "desktop_state_set") return new Promise(resolve => { release = resolve; });
  return Promise.resolve(args.value);
};
const pending = state.save("git-always-force-push", true);
await state.save("git-always-force-push", true); assert.equal(count, 1);
cleanup(); const snapshot = slots.slice(); release(); await pending;
assert.deepEqual(slots, snapshot);
console.log("PASS GT01: defaults, isolated key readback, failure retains prior value, reload, single-flight and unmount protection");

const source = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
const ast = ts.createSourceFile("drawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let diffEffect, push, pr;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('invoke<string>("git_diff"')) diffEffect = node.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handlePush") push = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleCreatePr") pr = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
let calls = [], content, loading;
const context = {
  open: true, activeTab: "changes", cwd: "repo", gitPreferencesReady: true, recordedTurnDiff: "recorded patch",
  diffMode: "lastTurn", turns: [], selectedFile: null,
  setDiffContent: value => { content = value; }, setLoadingDiff: value => { loading = value; },
  invoke: async (...args) => { calls.push(args); return ""; },
};
const fn = node => vm.runInNewContext(compile(`(${node.getText(ast)})`), context);
fn(diffEffect)(); assert.equal(content, "recorded patch"); assert.equal(calls.length, 0);
context.recordedTurnDiff = ""; context.turns = [{ items: [{ type: "fileChange", changes: [{ path: "a.ts", diff: "historical patch" }] }] }];
fn(diffEffect)(); assert.equal(content, "historical patch"); assert.equal(calls.length, 0);
context.gitPreferencesReady = false; context.diffMode = "working";
fn(diffEffect)(); assert.match(content, /尚未读取/); assert.equal(calls.length, 0); assert.equal(loading, false);
assert.ok(source.includes('const diffMode = lastTurnOnly ? "lastTurn" : requestedDiffMode'));
assert.ok(source.includes('{!lastTurnOnly && <>'));
console.log("PASS GT02: production diff effect reads recorded changes with zero Git calls, unread preferences block Git diff");
Object.assign(context, {
  gitWritePendingRef: { current: false }, gitContextRef: { current: {} },
  gitPreferences: { "git-always-force-push": true }, forceWithLease: false,
  setPushing() {}, onRefreshGit() {}, showToast() {},
  prTitle: "Title", prBody: "Body", prDraft: true, baseBranch: "main",
  setCreatingPr() {}, setShowPrModal() {}, setPrTitle() {}, setPrBody() {},
});
calls = []; await fn(push)(); assert.equal(calls[0][0], "git_push_changes"); assert.equal(calls[0][1].forceWithLease, true);
calls = []; await fn(pr)(); assert.equal(calls[0][0], "git_create_pr"); assert.equal(calls[0][1].draft, true);
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(app.includes('forceWithLease: gitPreferencesState.preferences["git-always-force-push"]'));
assert.ok(app.includes("gitPreferencesState={gitPreferencesState}"));
console.log("PASS GT03: actual push/PR callbacks and top-bar settings wiring; no external pushes or PR creation");
