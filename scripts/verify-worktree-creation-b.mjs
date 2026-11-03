import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/worktreeCreation.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const calls = [], response = deferred(), exports = {};
  vm.runInNewContext(source, { exports, AbortController, crypto: { randomUUID: () => "fixture-operation" }, require: name => {
    assert.equal(name, "./bridge");
    return { tauriInvoke: async (method, args) => { calls.push([method, args]); return method === "git_worktree_create" ? response.promise : undefined; } };
  } });
  return { calls, response, create: exports.createEnvironmentWorktree };
}
const options = { sourceCwd: "C:/fixture", startingMode: "HEAD", branchName: null, ownerThreadId: null };
{
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(() => f.create(options, abort.signal), /取消/); assert.equal(f.calls.length, 0);
}
{
  const f = fixture(), abort = new AbortController(), result = f.create(options, abort.signal);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [["git_worktree_create", { ...options, operationId: "fixture-operation" }]]);
  abort.abort(); f.response.resolve({ path: "C:/created" });
  await assert.rejects(() => result, /取消/);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1][0], "git_worktree_create_cancel"); assert.equal(f.calls[1][1].operationId, "fixture-operation");
}
{
  const f = fixture(), abort = new AbortController(), result = f.create(options, abort.signal);
  f.response.reject(Error("工作树已创建并保留在 C:/created，环境设置未完成"));
  await assert.rejects(() => result, /C:\/created/); abort.abort();
  assert.equal(f.calls.length, 1, "failure is never replayed and releases its cancellation listener");
}
{
  const f = fixture(), abort = new AbortController(), result = f.create(options, abort.signal);
  f.response.resolve({ path: "C:/created" }); assert.equal((await result).path, "C:/created");
  abort.abort(); assert.equal(f.calls.length, 1);
}
{
  const f = fixture(), abort = new AbortController(), result = f.create(options, abort.signal);
  f.response.resolve({}); await assert.rejects(() => result, /真实目录/);
}
console.log("PASS EN05/EN07: production worktree client binds cancellation, rejects late results, keeps created-path failures and never repeats creation");
