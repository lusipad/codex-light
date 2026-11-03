import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const compiled = ts.transpileModule(fs.readFileSync("src/worktreeRemoval.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const wt = { path: "C:/repo/wt", gitDir: "C:/repo/.git", isPrimary: false };
function harness(handler = () => undefined) {
  const calls = [], exports = {};
  const bridge = async (method, args) => { calls.push([method,args]); const result = handler(method,args); if (result !== undefined) return result;
    if (method === "git_worktree_delete_prepare") return wt.path;
    if (method === "threads_meta_get") return { pinnedThreadIds: [] };
    if (method === "thread/list") return { data: [{ id: "a", cwd: wt.path }, { id: "b", cwd: wt.path }], nextCursor: null };
    if (method === "thread/archive") return {};
    if (method === "git_worktree_delete") return { worktreePath: wt.path, snapshotRef: "snapshot", warnings: [] };
    if (method === "git_worktree_delete_cancel") return true;
    throw Error(method);
  };
  vm.runInNewContext(compiled,{ exports, crypto: webcrypto, AbortController, require: () => ({ tauriInvoke: bridge, callAppServer: bridge }) });
  return { calls, run: signal => exports.removeWorktreeWithConversations(wt,signal) };
}
const until = async condition => { for(let i=0;i<100&&!condition();i++) await Promise.resolve(); assert.ok(condition(), "expected stage reached"); };
{
  const h = harness(), controller = new AbortController(); controller.abort(); await assert.rejects(h.run(controller.signal), /未开始删除/); assert.equal(h.calls.length,0);
}
{
  const gate = deferred(), controller = new AbortController(), h = harness(method => method === "git_worktree_delete_prepare" ? gate.promise : undefined), run = h.run(controller.signal);
  controller.abort(); gate.resolve(wt.path); await assert.rejects(run,/取消/); assert.equal(h.calls.length,1);
}
{
  const gate = deferred(), controller = new AbortController(), h = harness((method,args) => method === "thread/archive" && args.threadId === "a" ? gate.promise : undefined), run = h.run(controller.signal);
  await until(() => h.calls.some(call => call[0] === "thread/archive")); controller.abort(); gate.resolve({}); await assert.rejects(run,/已有 1 个关联会话/); assert.equal(h.calls.filter(call => call[0] === "thread/archive").length,1); assert.equal(h.calls.filter(call => call[0] === "git_worktree_delete").length,0); assert.equal(h.calls.filter(call => call[0] === "git_worktree_delete_cancel").length,0);
}
console.log("PASS ECRM01: abort before prepare, late preparation and partial archive never start delete or archive further chats");
{
  const gate = deferred(), controller = new AbortController(), h = harness(method => method === "git_worktree_delete" ? gate.promise : undefined), run = h.run(controller.signal);
  await until(() => h.calls.some(call => call[0] === "git_worktree_delete")); const request = h.calls.find(call => call[0] === "git_worktree_delete")[1]; assert.match(request.operationId,/^[0-9a-f-]{36}$/); controller.abort(); controller.abort(); gate.reject(Error("cleanup cancelled")); await assert.rejects(run,/cleanup cancelled.*已有 2 个关联会话/); const cancels = h.calls.filter(call => call[0] === "git_worktree_delete_cancel"); assert.equal(cancels.length,1); assert.equal(cancels[0][1].operationId,request.operationId);
}
{
  const gate = deferred(), controller = new AbortController(), h = harness(method => method === "git_worktree_delete" ? gate.promise : undefined), run = h.run(controller.signal);
  await until(() => h.calls.some(call => call[0] === "git_worktree_delete")); const joined = h.run(); assert.equal(run,joined); controller.abort(); gate.resolve({ worktreePath: wt.path, snapshotRef: "snapshot", warnings: [] }); await assert.rejects(run,/取消.*删除结果尚未确认/); assert.equal(h.calls.filter(call => call[0] === "git_worktree_delete").length,1);
}
{
  const gate = deferred(), controller = new AbortController(), h = harness(method => method === "git_worktree_delete" ? gate.promise : method === "git_worktree_delete_cancel" ? Promise.reject(Error("cancel IPC lost")) : undefined), run = h.run(controller.signal);
  await until(() => h.calls.some(call => call[0] === "git_worktree_delete")); controller.abort(); gate.reject(Error("cleanup failed")); await assert.rejects(run,/取消请求未确认.*cancel IPC lost/);
}
console.log("PASS ECRM02: owner-cancel operation identity, one cancellation, shared delete single-flight, no false success on cancellation and cancellation IPC failure remains visible");
const viewSource = fs.readFileSync("src/components/WorktreesView.tsx", "utf8"), ast = ts.createSourceFile("WorktreesView.tsx", viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let lifecycle;
function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast) === "[activeWorkspaceRoot]") lifecycle = node.arguments[0].getText(ast); ts.forEachChild(node,visit); } visit(ast); assert.ok(lifecycle);
for (const reason of ["scope", "unmount"]) {
  const deleting = new AbortController(), creating = new AbortController(), context = { exports: {}, mountedRef: { current: false }, creationControllerRef: { current: creating }, deletionControllerRef: { current: deleting }, requestRef: { current: 3 }, setCreating() {}, refresh() {} };
  vm.runInNewContext(ts.transpileModule(`exports.effect = ${lifecycle}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context); const cleanup = context.exports.effect(); assert.equal(context.mountedRef.current,true); cleanup(); assert.equal(deleting.signal.aborted,true,reason); assert.equal(creating.signal.aborted,true,reason); assert.equal(context.deletionControllerRef.current,null); assert.equal(context.requestRef.current,4);
}
console.log("PASS ECRM03: production WorktreesView scope/unmount lifecycle aborts active deletion and setup and invalidates late list reads");
await import("./verify-worktree-removal.mjs");
