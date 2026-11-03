import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/ComposerBox.tsx", "utf8");
const ast = ts.createSourceFile("ComposerBox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleKeyDown") handler = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let sent = 0, queued = 0, selected = 0, prevented = 0;
const context = {
  composerEnterBehavior: "cmdAlways", promptInput: "hello", isStreaming: false, autocompleteMode: null,
  autocompleteItems: [], autocompleteIndex: 0, onSendMessage: () => sent++, onQueueMessage: () => queued++,
  handleAutocompleteSelect: () => selected++, setAutocompleteMode: () => {}, setAutocompleteIndex: () => {},
  localStorage: { getItem: () => null },
};
const keydown = vm.runInNewContext(compile(`(${handler})`), context);
function press(options = {}) {
  sent = queued = selected = prevented = 0;
  keydown({ key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false,
    nativeEvent: {}, preventDefault: () => prevented++, ...options });
  return [sent, queued, selected, prevented];
}
assert.deepEqual(press(), [0, 0, 0, 0], "GS02: cmdAlways plain Enter inserts a newline rather than submitting");
assert.deepEqual(press({ ctrlKey: true }), [1, 0, 0, 1]);
context.composerEnterBehavior = "enter";
assert.deepEqual(press(), [1, 0, 0, 1]);
assert.deepEqual(press({ shiftKey: true }), [0, 0, 0, 0]);
context.composerEnterBehavior = "cmdIfMultiline";
assert.deepEqual(press(), [1, 0, 0, 1]);
context.promptInput = "first\nsecond";
assert.deepEqual(press(), [0, 0, 0, 0]);
assert.deepEqual(press({ ctrlKey: true }), [1, 0, 0, 1]);
for (const mode of ["enter", "cmdIfMultiline", "cmdAlways"]) {
  context.composerEnterBehavior = mode;
  assert.deepEqual(press({ ctrlKey: true, nativeEvent: { isComposing: true } }), [0, 0, 0, 0]);
  assert.deepEqual(press({ ctrlKey: true, nativeEvent: { keyCode: 229 } }), [0, 0, 0, 0]);
  assert.deepEqual(press({ altKey: true }), [0, 0, 0, 0]);
}
context.composerEnterBehavior = "enter";
context.autocompleteMode = "slash";
context.autocompleteItems = [{ id: "review", insertText: "/review " }];
assert.deepEqual(press(), [0, 0, 1, 1], "GS03: selecting a completion never also submits the prompt");
assert.deepEqual(press({ key: "Tab" }), [0, 0, 1, 1]);
console.log("PASS GS02-GS03: production three-mode Enter behavior, multiline, IME and autocomplete precedence");

const appSource = fs.readFileSync("src/App.tsx", "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveHandler, loadEffect;
function findApp(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === "handleSetComposerEnterBehavior") saveHandler = node.initializer.arguments[0].getText(appAst);
  if (ts.isCallExpression(node) && node.expression.getText(appAst) === "useEffect" &&
      node.arguments[0]?.getText(appAst).includes('key: "composerEnterBehavior"')) loadEffect = node.arguments[0].getText(appAst);
  ts.forEachChild(node, findApp);
}
findApp(appAst);
assert.ok(saveHandler); assert.ok(loadEffect);
const normalize = vm.runInNewContext(compile(fs.readFileSync("src/composerPreferences.ts", "utf8").replaceAll("export ", "")) + "\nnormalizeComposerEnterBehavior");
for (const value of [null, undefined, "cmd-enter", {}, 1]) assert.equal(normalize(value), "enter");
for (const value of ["enter", "cmdIfMultiline", "cmdAlways"]) assert.equal(normalize(value), value);
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function mount(invoke, initial = "enter") {
  const state = { value: initial, busy: false, error: null };
  const calls = [];
  const ctx = {
    composerEnterBehavior: initial, composerEnterPendingRef: { current: false }, composerEnterRevisionRef: { current: 0 },
    normalizeComposerEnterBehavior: normalize,
    setComposerEnterBehavior: value => { state.value = value; ctx.composerEnterBehavior = value; },
    setComposerEnterSaving: value => state.busy = value, setComposerEnterError: value => state.error = value,
    tauriInvoke: (method, args) => { calls.push([method, args]); assert.equal(args.key, "composerEnterBehavior"); return invoke(method, args); },
  };
  return { state, calls, ctx, save: vm.runInNewContext(compile(`(${saveHandler})`), ctx), load: vm.runInNewContext(compile(`(${loadEffect})`), ctx) };
}
let stored = null;
const view = mount(async (method, args) => method === "desktop_state_set" ? (stored = args.value) : stored);
await view.save("cmdAlways"); assert.equal(stored, "cmdAlways"); assert.equal(view.state.value, "cmdAlways"); assert.equal(view.state.error, null);
const reopened = mount(async () => stored); reopened.load(); await new Promise(setImmediate); assert.equal(reopened.state.value, "cmdAlways");
const failed = mount(async () => { throw Error("denied"); }, "cmdIfMultiline");
await failed.save("cmdAlways"); assert.equal(failed.state.value, "cmdIfMultiline"); assert.match(failed.state.error, /保存失败/); assert.equal(failed.state.busy, false);
const unread = mount(async method => { if (method === "desktop_state_get") throw Error("read failed"); });
await unread.save("cmdAlways"); assert.equal(unread.state.value, "cmdAlways"); assert.match(unread.state.error, /确认失败/);
const mismatch = mount(async () => "enter"); await mismatch.save("cmdAlways"); assert.match(mismatch.state.error, /读回结果/);
const gate = defer(); const single = mount(async method => method === "desktop_state_set" ? gate.promise : "cmdAlways");
const pending = single.save("cmdAlways"); await single.save("enter"); assert.equal(single.calls.length, 1); gate.resolve(); await pending; assert.equal(single.state.busy, false);
const late = defer(); let reads = 0;
const race = mount(async method => method === "desktop_state_get" ? (++reads === 1 ? late.promise : "cmdAlways") : undefined);
race.load(); await race.save("cmdAlways"); late.resolve("enter"); await new Promise(setImmediate); assert.equal(race.state.value, "cmdAlways");
const removedRead = defer(); const removed = mount(async () => removedRead.promise); const cleanup = removed.load(); cleanup(); removedRead.resolve("cmdAlways"); await new Promise(setImmediate); assert.equal(removed.state.value, "enter");
const settings = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.match(settings, /!navigator\.userAgent\.includes\("Windows"\) && \([\s\S]*?<label>后台任务防休眠策略/);
assert.match(settings, /发送快捷键/); assert.match(settings, /Ctrl \+ Enter 用于多行提示/);
console.log("PASS GS01/GS04/GS05: independent preference key, normalization, persistence readback, remount, single-flight, rollback, read failure, stale load and Windows sleep-row condition (L2; native UI untested)");

const startupRead = defer();
const startup = mount(async () => startupRead.promise);
startup.ctx.composerEnterPendingRef.current = true;
startup.state.busy = true;
startup.load(); await startup.save("cmdIfMultiline");
assert.equal(startup.calls.length, 1, "pending startup read must prevent a write with an unloaded rollback snapshot");
startupRead.resolve("cmdAlways"); await new Promise(setImmediate);
assert.equal(startup.state.value, "cmdAlways"); assert.equal(startup.state.busy, false);
assert.match(appSource, /\[composerEnterSaving, setComposerEnterSaving\] = useState\(true\)/);
assert.match(appSource, /composerEnterPendingRef = useRef\(true\)/);
console.log("PASS GS04 startup race: edits disabled until the persisted preference has loaded");
