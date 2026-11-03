import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const moduleText = ts.transpileModule(fs.readFileSync("src/inboxState.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { restoreInboxHistory } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
const item = (id, time, read = false) => ({ id, title: id, subtitle: "", kind: "activity", createdAt: time, read });
const changes = () => ({ cleared: false, allRead: false, removed: new Set() });
{
  const result = restoreInboxHistory([item("old", 1), item("same", 2)], [item("new", 4), item("same", 2, true)], changes());
  assert.deepEqual(result.map(i => i.id), ["new", "same", "old"]);
  assert.equal(result[1].read, true, "IL01: current read mutation wins over history");
  const cleared = changes(); cleared.cleared = true;
  assert.deepEqual(restoreInboxHistory([item("old", 1)], [item("new", 4)], cleared).map(i => i.id), ["new"]);
  const removed = changes(); removed.removed.add("old");
  assert.deepEqual(restoreInboxHistory([item("old", 1)], [], removed), [], "IL02: deleted history cannot resurrect");
  const allRead = changes(); allRead.allRead = true;
  const resultRead = restoreInboxHistory([item("old", 1)], [item("new-after-mark-all", 4)], allRead);
  assert.equal(resultRead[0].read, false, "IL02: events after mark-all remain unread");
  assert.equal(resultRead[1].read, true);
}
{
  const history = Array.from({ length: 130 }, (_, index) => item(String(index), index));
  const result = restoreInboxHistory([null, {}, { ...item("bad", 200), createdAt: NaN }, ...history], [], changes());
  assert.equal(result.length, 100, "IL03: bound restored history");
  assert.equal(result[0].id, "129");
  assert.deepEqual(restoreInboxHistory({}, [], changes()), []);
}
const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadEffect, saveEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const body = node.arguments[0]?.getText(ast) || "";
    if (body.includes('key: "inboxItems"') && body.includes('"desktop_state_get"')) loadEffect = node.arguments[0];
    if (body.includes('key: "inboxItems"') && body.includes('"desktop_state_set"')) saveEffect = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount() {
  const requests = [], timers = new Set(), errors = [];
  const context = {
    inboxItems: [], inboxHydrated: false, isQuickChatWindow: false, isThreadWindow: false,
    inboxHydrationChangesRef: { current: changes() }, inboxSaveQueueRef: { current: Promise.resolve() }, restoreInboxHistory,
    tauriInvoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
    setInboxItems(update) { context.inboxItems = typeof update === "function" ? update(context.inboxItems) : update; },
    setInboxHydrated(value) { context.inboxHydrated = value; },
    setInboxLoadError(value) { context.error = value; },
    showAppToast: (...args) => errors.push(args),
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
  };
  return { context, requests, errors, timers, load: vm.runInNewContext(compile(loadEffect), context), save: vm.runInNewContext(compile(saveEffect), context),
    fire() { for (const timer of timers) { timers.delete(timer); timer(); } } };
}
{
  const view = mount(); view.load();
  view.context.inboxItems = [item("live", 2)];
  view.requests[0].resolve([item("saved", 1)]); await flush();
  assert.deepEqual(view.context.inboxItems.map(i => i.id), ["live", "saved"]);
  assert.equal(view.context.inboxHydrated, true);
  const empty = mount(); empty.load(); empty.requests[0].resolve([]); await flush();
  assert.equal(empty.context.inboxHydrated, true, "IL03: empty read triggers hydrated state");
}
{
  const view = mount(), cleanup = view.load();
  cleanup(); view.requests[0].resolve([item("late", 1)]); await flush();
  assert.equal(view.context.inboxItems.length, 0, "IL04: unmounted read cannot update");
  const retry = mount(); retry.load(); retry.requests[0].reject(Error("storage read failed")); await flush();
  assert.ok(retry.context.error.includes("storage read failed"));
  assert.equal(retry.context.inboxHydrated, false);
  retry.save(); retry.fire(); await flush();
  assert.equal(retry.requests.length, 1, "IL04: failed history must never be overwritten");
  retry.load(); retry.requests[1].resolve([]); await flush();
  assert.equal(retry.context.inboxHydrated, true);
}
{
  const view = mount(); view.context.inboxHydrated = true;
  const first = [item("first", 1)], second = [item("second", 2)];
  view.context.inboxItems = first; view.save(); view.fire(); await flush();
  assert.equal(view.requests.length, 1);
  view.context.inboxItems = second; view.save(); view.fire(); await flush();
  assert.equal(view.requests.length, 1, "IL05: second storage write waits for first");
  view.requests[0].reject(Error("disk failure")); await flush();
  assert.equal(view.errors.length, 1, "IL06: persistence failure is visible");
  assert.equal(view.requests.length, 2, "IL06: next write survives a rejected previous request");
  assert.equal(view.requests[0].args.value[0].id, "first");
  assert.equal(view.requests[1].args.value[0].id, "second");
  view.requests[1].resolve(); await view.context.inboxSaveQueueRef.current;
}
console.log("PASS IL01–IL06 production history merge/effects: live events, read/delete/clear preservation, validation, cancellation, retry and ordered writes");
{
  const utility = mount(); utility.context.isQuickChatWindow = true;
  utility.load(); utility.context.inboxHydrated = true; utility.save(); utility.fire(); await flush();
  assert.equal(utility.requests.length, 0, "utility must not load/write the main inbox snapshot");
}
{
  const child = mount(); child.context.isThreadWindow = true;
  child.load(); child.context.inboxHydrated = true; child.save(); child.fire(); await flush();
  assert.equal(child.requests.length, 0, "thread window must not overwrite the main inbox snapshot");
}
