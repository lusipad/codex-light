import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const planner = {};
vm.runInNewContext(compile("src/worktreePolicy.ts"), { exports: planner });
const source = compile("src/worktreeCleanup.ts");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const input = {
  records: [{ path: "C:/old", ownerThreadId: null, createdAtMs: 1 }, { path: "C:/new", ownerThreadId: null, createdAtMs: 2 }],
  keepCount: 1, threadMetadataById: {}, pinnedThreadIds: [], protectedWorktreeDirs: [],
  nowMs: 10_000_000, protectPreMigrationOwnerlessWorktrees: false,
};
function fixture(native = true) {
  const calls = [], logs = [], exports = {};
  let listener, timer, removed = 0, cleared = 0;
  vm.runInNewContext(source, {
    exports, console: { warn: (...args) => logs.push(args) },
    setInterval: (callback, delay) => { assert.equal(delay, 30_000); timer = callback; return 73; },
    clearInterval: id => { assert.equal(id, 73); cleared++; },
    require: name => name === "./worktreePolicy" ? planner : {
      isTauriRuntime: () => native,
      tauriListen: async (event, callback) => { assert.equal(event, "worktree:cleanup-requested"); listener = callback; return () => { removed++; }; },
      tauriInvoke: (method, args) => {
        const response = deferred(); calls.push({ method, args, ...response });
        if (method === "worktree_cleanup_cancel") response.resolve();
        return response.promise;
      },
    },
  });
  return { install: exports.installWorktreeCleanup, calls, logs, event: () => listener(), tick: () => timer(), removed: () => removed, cleared: () => cleared };
}
{
  const f = fixture(false); f.install()(); await flush(); assert.equal(f.calls.length, 0);
}
{
  const f = fixture(), stop = f.install(); await flush();
  assert.equal(f.calls[0].method, "worktree_cleanup_prepare");
  f.event(); f.event(); f.tick(); assert.equal(f.calls.length, 1, "concurrent recovery kicks are single flight");
  f.calls[0].resolve({ token: "first", input, warnings: [] }); await flush();
  assert.equal(f.calls[1].method, "worktree_cleanup_execute");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].args)), { token: "first", candidatePaths: ["C:/old"] });
  f.calls[1].resolve({ deleted: [{ worktreePath: "C:/old" }], retained: [], errors: [] }); await flush();
  assert.equal(f.calls[2].method, "worktree_cleanup_prepare");
  f.calls[2].resolve(null); await flush();
  const count = f.calls.length; f.tick(); await flush();
  assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).method, "worktree_cleanup_prepare");
  f.calls.at(-1).resolve(null); await flush(); stop();
  assert.equal(f.removed(), 1); assert.equal(f.cleared(), 1);
  assert.ok(f.calls.every(call => !call.method.includes("enqueue")), "recovery timer never invents jobs");
}
{
  const f = fixture(), stop = f.install(); await flush(); stop();
  f.calls[0].resolve({ token: "late-only", input, warnings: [] }); await flush();
  assert.deepEqual(f.calls.map(call => call.method), ["worktree_cleanup_prepare", "worktree_cleanup_cancel"]);
  assert.equal(f.calls[1].args.token, "late-only", "late preparation cancels only its own token");
}
{
  const f = fixture(), stop = f.install(); await flush();
  f.calls[0].resolve({ token: "running", input, warnings: ["retained metadata"] }); await flush();
  stop(); assert.equal(f.calls[2].method, "worktree_cleanup_cancel"); assert.equal(f.calls[2].args.token, "running");
  f.calls[1].resolve({ deleted: [], retained: ["C:/old"], errors: ["cancelled"] }); await flush();
  assert.equal(f.calls.length, 3, "disposed execution never starts a new round");
}
{
  const f = fixture(), stop = f.install(); await flush();
  f.calls[0].resolve({ token: "failed", input, warnings: [] }); await flush();
  f.calls[1].reject(Error("disk save refused")); await flush();
  assert.equal(f.calls.length, 3); assert.equal(f.calls[2].method, "worktree_cleanup_cancel");
  assert.ok(f.logs.length); assert.equal(f.calls.filter(call => call.method === "worktree_cleanup_execute").length, 1);
  stop();
}
console.log("PASS WB08: production cleanup drains persisted revisions, uses the actual TS planner, serializes kicks and cancels only its own late token; the 30s timer never enqueues deletion");
