import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
let slots = [], cursor = 0, effects = [], invoke, state;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effects.push(fn); },
};
const exports = {};
vm.runInNewContext(compile(fs.readFileSync("src/reviewPreferences.ts", "utf8")), {
  exports, URL, require: name => name === "react" ? react : { tauriInvoke: (...args) => invoke(...args) },
});
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const render = () => { cursor = 0; effects = []; state = exports.useCodeReviewPreferences(); };
let stored = { githubLinkTarget: "code-review-tab", localReviewInstructions: "" };
const calls = [];
invoke = async (command, args) => {
  calls.push([command, args]);
  if (command === "code_review_preferences_update") stored = { ...stored, ...args.patch };
  return stored;
};
render(); const cleanup = effects[0](); await flush(); render();
assert.equal(state.ready, true);
state.setDraft("Focus on data loss"); render();
assert.equal(await state.save({ localReviewInstructions: state.draft }), true); render();
assert.equal(state.preferences.localReviewInstructions, "Focus on data loss");
invoke = async () => { throw Error("disk failure"); };
state.setDraft("retry draft"); render();
assert.equal(await state.save({ localReviewInstructions: state.draft }), false); render();
assert.equal(state.draft, "retry draft");
assert.equal(state.preferences.localReviewInstructions, "Focus on data loss");
assert.match(state.error, /disk failure/);
invoke = async () => stored;
assert.equal(await state.save({ localReviewInstructions: state.draft }), false); render();
assert.match(state.error, /读回不一致/);
let release, count = 0;
invoke = command => {
  if (command !== "code_review_preferences_update") return Promise.resolve(stored);
  count++; return new Promise(resolve => { release = resolve; });
};
const pending = state.save({ githubLinkTarget: "external-browser" });
await state.save({ githubLinkTarget: "external-browser" });
assert.equal(count, 1);
cleanup(); const before = slots.slice(); release(stored); await pending;
assert.deepEqual(slots, before);
console.log("PASS CRS03: production preference read/write/readback, failure draft retention, single-flight and late-unmount isolation");

invoke = async (command, args) => { calls.push([command, args]); return stored; };
stored = { githubLinkTarget: "code-review-tab", localReviewInstructions: "Personal criteria" };
let opened = 0;
await exports.openReviewLink("https://github.com/org/repo/pull/1", () => opened++, () => true);
assert.equal(opened, 1);
stored.githubLinkTarget = "external-browser";
await exports.openReviewLink("https://github.com/org/repo/pull/1", () => opened++, () => true);
assert.equal(calls.at(-1)[0], "review_link_open");
await assert.rejects(exports.openReviewLink("javascript:alert(1)", () => {}, () => true), /HTTPS/);
stored.githubLinkTarget = "in-app-browser";
await assert.rejects(exports.openReviewLink("https://github.com/org/repo/pull/1", () => {}, () => true), /选择/);
let request;
await exports.runPullRequestReview({ number: 1, title: "Fix", head_ref_name: "feature" }, value => { request = value; }, () => true);
assert.equal(request.branch, "feature");
assert.match(request.instructions, /Personal criteria/);
await assert.rejects(exports.runPullRequestReview({ number: 1, title: "Missing" }, () => {}, () => true), /缺少源分支/);
request = null;
await exports.runPullRequestReview({ number: 1, title: "Late", head_ref_name: "feature" }, value => { request = value; }, () => false);
assert.equal(request, null, "navigation away cancels late preference read before starting review");
invoke = async () => { throw Error("preferences unavailable"); };
await assert.rejects(exports.runPullRequestReview({ number: 1, title: "Fix", head_ref_name: "feature" }, () => assert.fail(), () => true), /unavailable/);
console.log("PASS CRS04: real PR consumer helpers honor link destination and personal instructions, reject unavailable settings and cancel stale navigation");

slots = []; effects = []; cursor = 0;
let tree, timer, delay, saves = [];
const component = {};
vm.runInNewContext(compile(fs.readFileSync("src/components/CodeReviewSettings.tsx", "utf8")), {
  exports: component, require: () => react,
  window: { confirm: () => false, setTimeout: (fn, ms) => { timer = fn; delay = ms; return 1; }, clearTimeout: () => {} },
});
const viewState = { preferences: { githubLinkTarget: "code-review-tab", localReviewInstructions: "" },
  draft: "unsaved", ready: true, busy: false, error: null,
  save: async value => { saves.push(value); return true; }, load: () => assert.fail("cancel must keep draft"), setDraft: () => {} };
const renderView = () => { cursor = 0; effects = []; tree = component.CodeReviewSettings({ state: viewState }); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
renderView(); effects[0]();
assert.equal(delay, 3000);
timer(); assert.equal(saves.at(-1).localReviewInstructions, "unsaved");
const field = nodes(tree).find(node => node.type === "textarea");
let prevented = 0;
field.props.onKeyDown({ key: "s", ctrlKey: true, nativeEvent: { isComposing: true }, preventDefault: () => prevented++ });
assert.equal(saves.length, 1);
field.props.onKeyDown({ key: "s", ctrlKey: true, nativeEvent: {}, preventDefault: () => prevented++ });
assert.equal(prevented, 1); assert.equal(saves.length, 2);
const unmount = effects[1](); unmount(); assert.equal(saves.length, 3, "unmount flushes unsaved draft");
nodes(tree).find(node => node.type === "button").props.onClick();
viewState.error = "save failed"; timer = null; renderView(); effects[0](); assert.equal(timer, null);
const app = fs.readFileSync("src/App.tsx", "utf8");
const review = fs.readFileSync("src/components/CodeReviewView.tsx", "utf8");
const settings = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(app.includes("codeReviewPreferencesState={codeReviewPreferencesState}"));
assert.ok(review.includes("runPullRequestReview(pr, onStartReview, isCurrent)"));
assert.ok(!settings.includes("代码审查规范与门禁"));
assert.ok(settings.includes("codeReviewPathOverrides,"), "old preferences retained");
console.log("PASS CRS UI: 3000ms autosave, immediate save/IME guard, unmount flush, failure stops retry loop and real shared wiring");
