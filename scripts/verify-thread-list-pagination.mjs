import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshThreads") callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback, "execute the actual refreshThreads callback");
const code = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const protocol = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/protocol.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: protocol.exports });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function mount(rpc) {
  const calls = [], warnings = [], commits = [], readiness = [];
  const refresh = vm.runInNewContext(code, {
    refreshThreadsGenerationRef: { current: 0 },
    threadListRestoreRef: { current: null },
    isThreadReadState: protocol.exports.isThreadReadState,
    callAppServer: async (method, params) => { calls.push({ method, params }); return rpc(params, calls.length); },
    setThreads: value => commits.push(value),
    setChatHistoryReady: value => readiness.push(value),
    console: { warn: (...args) => warnings.push(args) },
  });
  return { refresh, calls, warnings, commits, readiness };
}
{
  const view = mount(async p => p.cursor === "page-2" ? { data: [{ id: "b" }, { id: "c" }], nextCursor: "page-3" } : p.cursor === "page-3" ? { data: [{ id: "d" }], nextCursor: null } : { data: [{ id: "a" }, { id: "b" }], nextCursor: "page-2" });
  await view.refresh();
  assert.deepEqual(Array.from(view.commits.at(-1), t => t.id), ["a", "b", "c", "d"], "all pages must be reachable and overlap deduplicated");
  assert.equal(view.calls.length, 3);
  assert.ok(view.calls.every(c => c.params.useStateDbOnly === true && c.params.sortKey === "updated_at" && c.params.sortDirection === "desc" && c.params.archived === false));
}
{
  const page = deferred();
  const view = mount(async p => p.cursor ? page.promise : { data: [{ id: "a" }], nextCursor: "later" });
  const pending = view.refresh(); await Promise.resolve(); await Promise.resolve();
  assert.equal(view.commits.length, 0, "partial catalog must not be published as complete");
  assert.deepEqual(view.readiness, []);
  page.resolve({ data: [{ id: "b" }], nextCursor: null }); await pending;
  assert.equal(view.commits[0].length, 2);
  assert.deepEqual(view.readiness, [true]);
  assert.deepEqual(view.warnings, [], "successful pagination must not throw during publication");
}
{
  const view = mount(async p => { if (p.cursor) throw Error("second page failed"); return { data: [{ id: "a" }], nextCursor: "later" }; });
  await view.refresh();
  assert.equal(view.commits.length, 0, "page failure must preserve existing catalog");
  assert.deepEqual(view.readiness, []);
  assert.equal(view.calls.length, 2, "must not switch read mode after a partial page");
  assert.ok(view.warnings.length);
}
{
  const view = mount(async p => { if (p.useStateDbOnly) throw Error("unsupported option"); return p.cursor ? { data: [{ id: "b" }], nextCursor: null } : { data: [{ id: "a" }], nextCursor: "repair-page" }; });
  await view.refresh(); assert.equal(view.commits[0].length, 2);
  assert.ok(view.calls.slice(1).every(c => !c.params.useStateDbOnly));
}
{
  const old = deferred();
  const view = mount(async (_p, count) => count === 1 ? old.promise : { data: [{ id: "new" }], nextCursor: null });
  const pending = view.refresh(); await view.refresh();
  old.resolve({ data: [{ id: "old" }], nextCursor: "stale-more" }); await pending;
  assert.equal(view.commits.length, 1, "stale refresh must not overwrite a newer catalog");
  assert.equal(view.commits[0][0].id, "new"); assert.equal(view.calls.length, 2);
  assert.deepEqual(view.readiness, [true]);
}
{
  const view = mount(async () => ({ data: [{ id: "a" }], nextCursor: "loop" }));
  await view.refresh(); assert.equal(view.calls.length, 2);
  assert.equal(view.commits.length, 0, "repeated cursor must not produce an incomplete success");
  assert.ok(view.warnings.length);
}
{
  const view = mount(async p => p.useStateDbOnly ? { data: [], nextCursor: null } : [{ id: "legacy" }]);
  await view.refresh(); assert.equal(view.commits[0][0].id, "legacy");
}
{
  const view = mount(async () => ({ data: [], nextCursor: null }));
  await view.refresh();
  assert.equal(view.commits[0].length, 0);
  assert.deepEqual(view.readiness, [true], "an empty catalog is ready after both reads complete");
}
console.log("PASS actual thread-list callback: complete pages, overlap, transactional failure, compatible fallback, stale refresh, repeated cursor and legacy arrays (L2)");
