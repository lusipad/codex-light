import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
let slots = [], cursor = 0, effects = [], invoke, state, listener, stops = 0;
let listen = async (_name, callback) => { listener = callback; return () => { stops++; }; };
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effects.push(fn); },
};
const exports = {};
const webLinks = {};
let configSnapshot = { config: {} }, configCalls = 0;
vm.runInNewContext(compile(fs.readFileSync("src/webLinks.ts", "utf8")), {
  exports: webLinks, URL, require: name => name === "./config"
    ? { configRead: async () => { configCalls++; return configSnapshot; } }
    : { tauriInvoke: (...args) => invoke(...args) },
});
assert.equal(webLinks.resolveWebLinkTarget(undefined, true), "in-app-browser");
assert.equal(webLinks.resolveWebLinkTarget("external-browser", true), "external-browser");
assert.equal(webLinks.resolveWebLinkTarget("in-app-browser", false), "external-browser");
assert.throws(() => webLinks.resolveWebLinkTarget("unknown", false), /设置无效/);
vm.runInNewContext(compile(fs.readFileSync("src/reviewPreferences.ts", "utf8")), {
  exports, URL, require: name => name === "react" ? react : name === "./webLinks" ? webLinks : { tauriInvoke: (...args) => invoke(...args), tauriListen: (...args) => listen(...args) },
});
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const render = () => { cursor = 0; effects = []; state = exports.useCodeReviewPreferences(); };
let stored = { githubLinkTarget: "github", configuredGithubLinkTarget: null, localReviewInstructions: "" };
const calls = [];
invoke = async (command, args) => {
  calls.push([command, args]);
  if (command === "code_review_preferences_update") stored = { ...stored, ...args.patch,
    configuredGithubLinkTarget: args.patch.githubLinkTarget ?? stored.configuredGithubLinkTarget };
  return stored;
};
render(); const cleanup = effects[0](); await flush(); render();
assert.equal(state.ready, true);
assert.equal(state.preferences.githubLinkTarget, "github");
assert.equal(state.preferences.configuredGithubLinkTarget, null, "missing configuration stays distinct from explicit github");
state.setDraft("Focus on data loss"); render();
assert.equal(await state.save({ localReviewInstructions: state.draft }), true); render();
assert.equal(state.preferences.localReviewInstructions, "Focus on data loss");
assert.equal(state.preferences.configuredGithubLinkTarget, null, "saving instructions must not configure a link target");
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
const pending = state.save({ githubLinkTarget: "github" });
const duplicate = state.save({ githubLinkTarget: "github" });
assert.equal(duplicate, pending, "same in-flight draft shares its result");
await flush();
assert.equal(count, 1);
cleanup(); const before = slots.slice(); release(stored); await pending;
assert.deepEqual(slots, before);
console.log("PASS CRS03: production preference read/write/readback, failure draft retention, single-flight and late-unmount isolation");

slots = []; render();
invoke = async () => stored;
effects[0](); await flush(); render();
let finishFirst;
const writes = [];
invoke = async (command, args) => {
  if (command === "code_review_preferences_update") {
    writes.push(args.patch.localReviewInstructions);
    if (writes.length === 1) await new Promise(resolve => { finishFirst = resolve; });
    stored = { ...stored, ...args.patch };
  }
  return stored;
};
state.setDraft("A"); render();
const firstSave = state.save({ localReviewInstructions: "A" });
await flush();
state.setDraft("B"); render();
const secondSave = state.save({ localReviewInstructions: "B" });
await flush(); assert.deepEqual(writes, ["A"], "second draft must wait for first write/readback");
finishFirst(); assert.equal(await firstSave, true); render();
assert.equal(state.draft, "B", "older success must retain newer draft");
assert.equal(await secondSave, true); render();
assert.deepEqual(writes, ["A", "B"]);
assert.equal(state.preferences.localReviewInstructions, "B");
console.log("PASS CRB04: edits during save are retained and distinct drafts persist serially");

slots = []; render();
invoke = async () => ({ ...stored });
const syncLoadCleanup = effects[0](), syncCleanup = effects[1]();
await flush(); render();
stored = { ...stored, localReviewInstructions: "other window" };
listener({}); await flush(); render();
assert.equal(state.preferences.localReviewInstructions, "other window");
assert.equal(state.draft, "other window", "pristine editor follows persisted cross-window updates");
invoke = async (command, args) => {
  if (command === "code_review_preferences_update") {
    stored = { ...stored, ...args.patch, configuredGithubLinkTarget: args.patch.githubLinkTarget,
      localReviewInstructions: "concurrent remote instructions" };
    listener({});
  }
  return { ...stored };
};
assert.equal(await state.save({ githubLinkTarget: "code-review-tab" }), true);
await flush(); render();
assert.equal(state.draft, "concurrent remote instructions", "a link save must not turn the old pristine value into a dirty draft that overwrites a remote edit");
state.setDraft("local unsaved"); render();
assert.equal(await state.save({ githubLinkTarget: "github" }), true);
await flush(); render();
assert.equal(state.draft, "local unsaved", "link saving still preserves a genuinely edited draft");
invoke = async () => ({ ...stored });
stored = { ...stored, localReviewInstructions: "second remote edit" };
listener({}); await flush(); render();
assert.equal(state.draft, "local unsaved", "remote refresh never discards a local draft");
assert.equal(state.preferences.localReviewInstructions, "second remote edit");
let finishRemoteRead;
invoke = async (command, args) => {
  if (command === "code_review_preferences_get" && !finishRemoteRead) {
    return new Promise(resolve => { finishRemoteRead = resolve; });
  }
  if (command === "code_review_preferences_update") stored = { ...stored, ...args.patch };
  return { ...stored };
};
listener({}); await flush();
const oldRemote = { ...stored };
assert.equal(await state.save({ localReviewInstructions: "local unsaved" }), true);
finishRemoteRead(oldRemote); await flush(); render();
assert.equal(state.preferences.localReviewInstructions, "local unsaved", "late remote read cannot revert a newer write");
syncLoadCleanup(); syncCleanup();
const stoppedBefore = stops; const unmountedSlots = slots.slice(); listener({}); await flush();
assert.equal(stops, stoppedBefore); assert.deepEqual(slots, unmountedSlots);
assert.ok(stops > 0, "unmount disposes subscription");
console.log("PASS CRB subscription: clean updates, dirty retention, read/write races and listener disposal");

slots = []; render(); invoke = async () => ({ ...stored });
let finishSubscribe;
listen = () => new Promise(resolve => { finishSubscribe = resolve; });
const lateLoadCleanup = effects[0](), lateSubscribeCleanup = effects[1]();
await flush(); lateLoadCleanup(); lateSubscribeCleanup();
const stopsBeforeLate = stops;
finishSubscribe(() => { stops++; }); await flush();
assert.equal(stops, stopsBeforeLate + 1, "late subscription is disposed immediately after unmount");
slots = []; render();
listen = async () => { throw Error("event transport unavailable"); };
const retryLoadCleanup = effects[0](), failedSubscribeCleanup = effects[1]();
await flush(); render();
assert.equal(state.ready, true);
assert.match(state.syncError, /event transport unavailable/);
state.retrySync(); render(); failedSubscribeCleanup();
listen = async (_name, callback) => { listener = callback; return () => { stops++; }; };
const recoveredSubscribeCleanup = effects[1](); await flush(); render();
assert.equal(state.syncError, null);
assert.equal(state.ready, true);
retryLoadCleanup(); recoveredSubscribeCleanup();
console.log("PASS CRB subscription recovery: late registration disposal and explicit retry without discarding usable preferences");

invoke = async (command, args) => { calls.push([command, args]); return stored; };
stored = { githubLinkTarget: "code-review-tab", configuredGithubLinkTarget: "code-review-tab", localReviewInstructions: "Personal criteria" };
let opened = 0;
await exports.openReviewLink("https://github.com/org/repo/pull/1", () => opened++, () => true);
assert.equal(opened, 1);
stored.githubLinkTarget = "github";
await exports.openReviewLink("https://github.com/org/repo/pull/1", () => opened++, () => true);
assert.equal(calls.at(-1)[0], "review_link_open");
assert.equal(configCalls, 1, "follow-browser-settings consumes the real general configuration reader");
configSnapshot = { config: { desktop: { "open-link-in-target-preference": "unknown" } } };
await assert.rejects(exports.openReviewLink("https://github.com/org/repo/pull/1", () => {}, () => true), /设置无效/);
configSnapshot = { config: {} };
await assert.rejects(exports.openReviewLink("javascript:alert(1)", () => {}, () => true), /HTTPS/);
await assert.rejects(exports.openReviewLink("https://user:secret@github.com/org/repo/pull/1", () => assert.fail(), () => true), /无凭据/);
let currentChecks = 0;
const opensBeforeStaleConfig = calls.filter(([command]) => command === "review_link_open").length;
await exports.openReviewLink("https://github.com/org/repo/pull/1", () => assert.fail(), () => ++currentChecks === 1);
assert.equal(calls.filter(([command]) => command === "review_link_open").length, opensBeforeStaleConfig, "navigation during general config read prevents external opening");
stored.githubLinkTarget = "in-app-browser";
await assert.rejects(exports.openReviewLink("https://github.com/org/repo/pull/1", () => {}, () => true), /选择/);
let request = null;
await assert.rejects(exports.runPullRequestReview({ number: 1, title: "Fix", head_ref_name: "feature" }, value => { request = value; }, () => true), /固定远程提交比较/);
assert.equal(request, null, "a local branch cannot substitute for exact remote private review");
await assert.rejects(exports.runPullRequestReview({ number: 1, title: "Missing" }, () => assert.fail(), () => true), /尚未接入/);
await exports.runPullRequestReview({ number: 1, title: "Late", head_ref_name: "feature" }, value => { request = value; }, () => false);
assert.equal(request, null, "navigation away cancels late preference read before starting review");
invoke = async () => { throw Error("preferences unavailable"); };
await assert.rejects(exports.openReviewLink("https://github.com/org/repo/pull/1", () => assert.fail(), () => true), /unavailable/);
console.log("PASS CRB01/02/09: official link enum/general settings, invalid targets, HTTPS guard, stale scope and explicit remote-review unavailability without a model turn");

slots = []; effects = []; cursor = 0;
let tree, timer, delay, saves = [], finishSave;
const component = {};
vm.runInNewContext(compile(fs.readFileSync("src/components/CodeReviewSettings.tsx", "utf8")), {
  exports: component, require: () => react,
  window: { confirm: () => false, setTimeout: (fn, ms) => { timer = fn; delay = ms; return 1; }, clearTimeout: () => {} },
});
const viewState = { preferences: { githubLinkTarget: "code-review-tab", localReviewInstructions: "" },
  draft: "unsaved", ready: true, busy: false, error: null,
  save: value => {
    saves.push(value);
    return new Promise(resolve => { finishSave = ok => {
      if (ok) viewState.preferences = { ...viewState.preferences, ...value };
      resolve(ok);
    }; });
  }, load: () => assert.fail("no invented reload control"), setDraft: value => { viewState.draft = value; } };
const renderView = () => { cursor = 0; effects = []; tree = component.CodeReviewSettings({ state: viewState }); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
renderView(); effects[0]();
assert.equal(delay, 3000);
timer(); assert.equal(saves.at(-1).localReviewInstructions, "unsaved");
const field = nodes(tree).find(node => node.type === "textarea");
assert.equal(field.props.rows, 10);
assert.equal(field.props.disabled, false);
let prevented = 0;
field.props.onKeyDown({ key: "s", ctrlKey: true, nativeEvent: { isComposing: true }, preventDefault: () => prevented++ });
assert.equal(saves.length, 1);
field.props.onKeyDown({ key: "s", ctrlKey: true, nativeEvent: {}, preventDefault: () => prevented++ });
assert.equal(prevented, 1); assert.equal(saves.length, 1, "repeated flush of in-flight draft is deduplicated");
viewState.busy = true; renderView();
assert.equal(nodes(tree).find(node => node.type === "textarea").props.disabled, false, "saving must not disable editing");
assert.equal(nodes(tree).find(node => node.type === "button").props.disabled, true);
nodes(tree).find(node => node.type === "textarea").props.onChange({ target: { value: "newer" } });
renderView();
finishSave(true); await flush(); renderView();
assert.equal(viewState.draft, "newer");
assert.ok(!nodes(tree).some(node => node.props.role === "status"), "old success cannot show Saved for newer draft");
effects[0](); timer();
assert.equal(saves.at(-1).localReviewInstructions, "newer");
finishSave(false); await flush(); renderView();
assert.equal(viewState.draft, "newer");
timer = null; effects[0](); assert.equal(timer, null, "failed draft does not loop automatically");
nodes(tree).find(node => node.type === "button").props.onClick();
assert.equal(saves.length, 3, "explicit retry resubmits failed draft");
finishSave(true); await flush(); renderView();
assert.ok(nodes(tree).some(node => node.props.role === "status" && node.props["aria-live"] === "polite"));
assert.equal(delay, 3000, "Saved feedback lasts three seconds");
timer(); renderView();
assert.ok(!nodes(tree).some(node => node.props.role === "status"));
nodes(tree).find(node => node.type === "textarea").props.onChange({ target: { value: "leaving" } });
renderView(); const unmount = effects[1](); unmount();
assert.equal(saves.at(-1).localReviewInstructions, "leaving", "unmount flushes newest draft");
finishSave(true); await flush();
const app = fs.readFileSync("src/App.tsx", "utf8");
const review = fs.readFileSync("src/components/CodeReviewView.tsx", "utf8");
const settings = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(app.includes("codeReviewPreferencesState={codeReviewPreferencesState}"));
assert.ok(review.includes("runPullRequestReview(pr, onStartReview, isCurrent)"));
assert.ok(!settings.includes("代码审查规范与门禁"));
assert.ok(settings.includes("codeReviewPathOverrides,"), "old preferences retained");
console.log("PASS CRS UI: rows=10, debounce, editable during save, draft identity, deduplicated flush, failure retry, 3s Saved, IME and unmount");
