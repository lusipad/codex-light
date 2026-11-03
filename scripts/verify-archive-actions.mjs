import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/ArchiveView.tsx", "utf8");
const ast = ts.createSourceFile("ArchiveView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
let visible;
function walk(node) {
  if (ts.isVariableDeclaration(node) && ["load", "mutate", "handleDelete", "handleDeleteDecision", "handleUnarchive"].includes(node.name.getText(ast))) callbacks[node.name.getText(ast)] = node.initializer.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "visible") visible = node.initializer.getText(ast);
  ts.forEachChild(node, walk);
}
walk(ast);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount() {
  const calls = [], mutations = [], notices = [], context = {
    useCallback: f => f, useMemo: f => f(), requestSeqRef: { current: 0 }, mountedRef: { current: true },
    mutationPendingRef: { current: false }, threads: [{ id: "keep", name: "Original" }], loading: false, error: null, busyId: null, restoredThread: null,
    deleteTarget: null, onShowToast: (...args) => notices.push(args),
  };
  context.callAppServer = (method, params) => { const p = deferred(); calls.push({ method, params, ...p }); return p.promise; };
  for (const name of ["onDelete", "onDeleteAll", "onUnarchive"]) context[name] = thread => { const p = deferred(); mutations.push({ name, thread, ...p }); return p.promise; };
  for (const [setter, key] of [["setThreads", "threads"], ["setLoading", "loading"], ["setError", "error"], ["setBusyId", "busyId"], ["setRestoredThread", "restoredThread"], ["setDeleteTarget", "deleteTarget"]]) context[setter] = value => { context[key] = typeof value === "function" ? value(context[key]) : value; };
  for (const name of ["load", "mutate", "handleDelete", "handleDeleteDecision", "handleUnarchive"]) if (callbacks[name]) context[name] = vm.runInNewContext(compile(`(${callbacks[name]})`), context);
  return { context, calls, mutations, notices };
}
{
  const v = mount(), loading = v.context.load();
  v.calls[0].resolve({ data: [{ id: "first" }], nextCursor: "page2" }); await flush();
  assert.equal(v.calls.length, 2, "AA01: archived list must follow nextCursor beyond the first 100 items");
  assert.equal(v.calls[1].params.cursor, "page2");
  v.calls[1].resolve({ data: [{ id: "last" }], nextCursor: null }); await loading;
  assert.deepEqual(Array.from(v.context.threads, x => x.id), ["first", "last"]);
  assert.equal(v.calls[0].params.searchTerm, undefined);
}
{
  const v = mount(), loading = v.context.load();
  v.calls[0].resolve({ data: [{ id: "partial" }], nextCursor: "same" }); await flush();
  v.calls[1].resolve({ data: [], nextCursor: "same" }); await loading;
  assert.ok(v.context.error);
  assert.equal(v.context.threads[0].id, "keep", "AA01: partial failed pagination cannot replace complete previous data");
}
for (const late of ["error", "success"]) {
  const v = mount(), old = v.context.load(), fresh = v.context.load();
  v.calls[1].resolve({ data: [{ id: "new" }], nextCursor: null }); await fresh;
  if (late === "error") v.calls[0].reject(Error("late")); else v.calls[0].resolve({ data: [{ id: "old" }], nextCursor: "stale" });
  await old;
  assert.equal(v.context.threads[0].id, "new");
  assert.equal(v.context.error, null);
  assert.equal(v.calls.length, 2, "AA01: stale response cannot continue pagination");
}
{
  const context = { threads: [{ id: "a", name: "Alpha" }, { id: "b", name: "Last page needle" }], query: "needle", useMemo: f => f() };
  const result = vm.runInNewContext(compile(`(${visible})`), context);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "b", "AA02: local search filters complete loaded data");
}
{
  const v = mount();
  await v.context.handleDelete({ id: "keep" });
  await v.context.handleDeleteDecision(false);
  assert.equal(v.mutations.length, 0, "AA03: cancellation does not write");
}
{
  const v = mount(), writing = v.context.handleUnarchive({ id: "keep" });
  await v.context.handleUnarchive({ id: "keep" }); await v.context.handleDelete({ id: "other" });
  assert.equal(v.mutations.length, 1, "AA03: synchronous mutation lock blocks repeated/conflicting writes");
  v.mutations[0].reject(Error("restore denied")); await writing;
  assert.equal(v.context.threads[0].id, "keep");
  assert.equal(v.context.mutationPendingRef.current, false);
  assert.ok(v.notices.some(([message]) => message.includes("restore denied")));
}
{
  const v = mount(), loading = v.context.load(), writing = v.context.handleUnarchive({ id: "keep" });
  v.calls[0].resolve({ data: [{ id: "obsolete" }], nextCursor: null }); await loading;
  v.mutations[0].resolve(); await flush();
  assert.equal(v.calls.length, 2, "AA06: mutation success must re-read actual archive data");
  v.calls[1].resolve({ data: [], nextCursor: null }); await writing;
  assert.equal(v.context.threads.length, 0);
  assert.equal(v.context.restoredThread.id, "keep", "AA05: restored identity is available for explicit View action");
  assert.equal(v.context.mutationPendingRef.current, false);
}
{
  const v = mount(); v.context.handleDelete({ id: "keep" });
  const deleting = v.context.handleDeleteDecision(true);
  v.mutations[0].reject(Error("unsupported")); await flush();
  assert.equal(v.calls.length, 1, "AA04: uncertain delete result requires a real list read, never a write retry");
  v.calls[0].resolve({ data: [{ id: "keep" }], nextCursor: null }); await deleting;
  assert.equal(v.context.threads[0].id, "keep");
  assert.ok(v.notices.some(([message]) => message.includes("unsupported")));
  assert.ok(!v.notices.some(([message, type]) => type === "success"), "AA04: rejected delete cannot be called successful");
}
{
  const v = mount(), loading = v.context.load();
  v.context.mountedRef.current = false;
  v.calls[0].resolve({ data: [{ id: "late" }], nextCursor: "next" }); await loading;
  assert.equal(v.context.threads[0].id, "keep");
  assert.equal(v.calls.length, 1);
}
{
  const v = mount(), writing = v.context.handleUnarchive({ id: "keep" });
  v.context.mountedRef.current = false;
  v.mutations[0].resolve(); await writing;
  assert.equal(v.context.threads[0].id, "keep", "AA06: mutation completion after leaving settings cannot update the old view");
  assert.equal(v.context.restoredThread, null);
  assert.equal(v.calls.length, 0, "AA06: unmounted archive cannot start a fresh list request");
  assert.equal(v.notices.length, 0, "AA06: unmounted archive cannot emit a success notice");
  assert.equal(v.context.mutationPendingRef.current, false);
}
{
  const source = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
  const body = source.slice(source.indexOf("async fn thread_delete("), source.indexOf("fn reveal_path_in_explorer("));
  assert.ok(body.includes(".await?;"), "AA04: real delete error propagates");
  assert.ok(body.indexOf('"thread/delete"') < body.indexOf("remove_thread_record"), "AA04: local cleanup follows server success");
  assert.ok(!body.includes('"thread/archive"'), "AA04: archive can never stand in for permanent deletion");
}
console.log("PASS AA01-AA06: production archive pagination, local search, mutation lock, explicit restoration, stale reads and delete failure");
