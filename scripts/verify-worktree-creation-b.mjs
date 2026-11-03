import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/worktreeCreation.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture({ skipResponse, listenResponse } = {}) {
  const calls = [], response = deferred(), exports = {};
  let listener, unlistened = 0;
  vm.runInNewContext(source, { exports, AbortController, crypto: { randomUUID: () => "fixture-operation" }, require: name => {
    assert.equal(name, "./bridge");
    return {
      tauriInvoke: async (method, args) => {
        calls.push([method, args]);
        if (method === "git_worktree_create") return response.promise;
        if (method === "git_worktree_refresh_skip") return skipResponse?.promise;
      },
      tauriListen: async (event, handler) => {
        assert.equal(event, "worktree:create-progress"); listener = handler;
        if (listenResponse) await listenResponse.promise;
        return () => { listener = undefined; unlistened++; };
      },
    };
  } });
  return { calls, response, create: exports.createEnvironmentWorktree, emit: payload => listener?.(payload), get unlistened() { return unlistened; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
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
{
  const skipResponse = deferred(), f = fixture({ skipResponse }), abort = new AbortController(), refresh = new AbortController();
  refresh.abort();
  const result = f.create(options, abort.signal, { signal: refresh.signal });
  await tick();
  assert.deepEqual(f.calls.map(call => call[0]), ["git_worktree_refresh_skip"], "pre-aborted skip must await native acknowledgement before creation");
  skipResponse.resolve(); await tick();
  assert.deepEqual(f.calls.map(call => call[0]), ["git_worktree_refresh_skip", "git_worktree_create"]);
  f.response.resolve({ path: "C:/created" }); await result;
  abort.abort(); assert.equal(f.calls.length, 2);
}
{
  const skipResponse = deferred(), f = fixture({ skipResponse }), abort = new AbortController(), refresh = new AbortController();
  refresh.abort();
  const result = f.create(options, abort.signal, { signal: refresh.signal });
  skipResponse.reject(Error("native skip failed"));
  await assert.rejects(() => result, /native skip failed/);
  abort.abort();
  assert.deepEqual(f.calls.map(call => call[0]), ["git_worktree_refresh_skip"], "failed early skip must not create or retain cancellation listeners");
}
{
  const listenResponse = deferred(), f = fixture({ listenResponse }), abort = new AbortController();
  const result = f.create(options, abort.signal, { onProgress: () => assert.fail("cancelled progress must not escape") });
  abort.abort();
  f.emit({ operationId: "fixture-operation", phase: "upstream-refresh" });
  listenResponse.resolve();
  await assert.rejects(() => result, /取消/);
  assert.deepEqual(f.calls.map(call => call[0]), ["git_worktree_create_cancel"]);
  assert.equal(f.unlistened, 1, "listen registration completing after abort must be disposed");
}
{
  const f = fixture(), abort = new AbortController(), refresh = new AbortController(), progress = [];
  const result = f.create(options, abort.signal, { signal: refresh.signal, onProgress: event => progress.push(event) });
  await tick();
  f.emit({ operationId: "other-operation", phase: "upstream-refresh" });
  f.emit({ operationId: "fixture-operation", phase: "upstream-refresh" });
  assert.equal(progress.length, 1);
  refresh.abort();
  assert.equal(f.calls.filter(call => call[0] === "git_worktree_refresh_skip").length, 1);
  f.response.resolve({ path: "C:/created" }); await result;
  assert.equal(f.unlistened, 1); abort.abort();
  assert.equal(f.calls.filter(call => call[0] === "git_worktree_create_cancel").length, 0);
}
const native = fs.readFileSync("src-tauri/src/lib.rs", "utf8").split("async fn git_worktree_create(")[1].split("fn git_worktree_create_cancel(")[0];
assert.equal((native.match(/\.emit_to\(tauri::EventTarget::webview_window\(/g) || []).length, 2, "both native progress phases must target the owning webview");
assert.doesNotMatch(native, /\.emit\("worktree:create-progress"/, "progress must not broadcast to every window");
console.log("PASS EN05/EN07/WU client: cancellation, early-skip ACK/failure, late listener cleanup, scoped progress and native webview target");
