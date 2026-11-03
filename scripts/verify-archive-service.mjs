import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["deleteArchivedThreads", "handleUnarchiveThread", "handleDeleteArchivedThread", "handleDeleteAllArchivedThreads"];
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) callbacks.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function mount() {
  const calls = [], context = {
    useCallback: callback => callback,
    archiveMutationPendingRef: { current: false },
    threads: [{ id: "a" }, { id: "b" }, { id: "active" }], pins: ["a", "b", "active"], tick: 0, refreshes: 0,
    refreshThreads: async () => { context.refreshes++; },
    setThreads: update => { context.threads = update(context.threads); },
    setPinnedThreadIds: update => { context.pins = update(context.pins); },
    setArchiveRefreshTick: update => { context.tick = update(context.tick); },
  };
  for (const method of ["tauriInvoke", "callAppServer"]) context[method] = (name, params) => {
    const pending = deferred(); calls.push({ method, name, params, ...pending }); return pending.promise;
  };
  for (const name of names) context[name] = vm.runInNewContext(compile(`(${callbacks.get(name)})`), context);
  return { context, calls };
}
{
  const v = mount(), deleting = v.context.handleDeleteAllArchivedThreads();
  assert.equal(v.calls[0].name, "thread_delete_archived");
  assert.equal(v.calls[0].params.threadId, null, "AS01: bulk scope is selected at service time, without search or snapshot IDs");
  await assert.rejects(v.context.handleDeleteArchivedThread({ id: "b" }), /正在进行/);
  await assert.rejects(v.context.handleUnarchiveThread({ id: "b" }), /正在进行/);
  assert.equal(v.calls.length, 1, "AS02: both entry points and restore share one synchronous mutation lock");
  v.calls[0].resolve({ deletedThreadIds: ["a"], error: "denied b" });
  const report = await deleting;
  assert.equal(report.error, "denied b");
  assert.deepEqual(Array.from(v.context.threads, thread => thread.id), ["b", "active"]);
  assert.deepEqual(Array.from(v.context.pins), ["b", "active"]);
  assert.equal(v.context.tick, 1);
  assert.equal(v.context.refreshes, 1);
  assert.equal(v.context.archiveMutationPendingRef.current, false, "AS03: partial results clean only actual successful IDs and release the lock");
}
{
  const v = mount(), deleting = v.context.handleDeleteArchivedThread({ id: "a" });
  assert.equal(v.calls[0].params.threadId, "a");
  v.calls[0].resolve({ deletedThreadIds: [], error: null });
  assert.equal((await deleting).deletedThreadIds.length, 0);
  assert.equal(v.context.threads.length, 3, "AS04: stale archived selection does not clear a live conversation locally");
}
for (const response of [null, {}, { deletedThreadIds: [""], error: null }, { deletedThreadIds: ["a", "a"], error: null }, { deletedThreadIds: ["a"], error: 2 }]) {
  const v = mount(), deleting = v.context.handleDeleteAllArchivedThreads();
  v.calls[0].resolve(response);
  await assert.rejects(deleting, /未确认/);
  assert.equal(v.context.threads.length, 3);
  assert.equal(v.context.archiveMutationPendingRef.current, false, "AS05: invalid service reports cannot fabricate deletion success");
}
{
  const v = mount(), deleting = v.context.handleDeleteAllArchivedThreads();
  v.calls[0].reject(Error("transport disconnected"));
  await assert.rejects(deleting, /transport disconnected/);
  assert.equal(v.context.threads.length, 3);
  assert.equal(v.context.archiveMutationPendingRef.current, false);
  const restoring = v.context.handleUnarchiveThread({ id: "b" });
  assert.equal(v.calls[1].name, "thread/unarchive");
  await assert.rejects(v.context.handleDeleteAllArchivedThreads(), /正在进行/);
  v.calls[1].resolve({}); await restoring;
  assert.equal(v.context.archiveMutationPendingRef.current, false, "AS06: failed transport unlocks; restore participates in the same lock");
}
console.log("PASS AS01-AS06: actual App archive service scopes, shared mutation lock, partial IDs, stale selection, invalid reports and retry");
