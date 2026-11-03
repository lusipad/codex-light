import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const source = fs.readFileSync("src/worktreeRemoval.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const wt = { path: "C:/repo/wt", gitDir: "C:/repo/.git", isPrimary: false };
function fixture(options = {}) {
  const calls = [];
  const threads = options.threads ?? [{ id: "a", cwd: `${wt.path}/src` }];
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto: webcrypto, AbortController, require() {
    return {
      async tauriInvoke(method, args) {
        calls.push([method, args]);
        if (method === "threads_meta_get") {
          if (options.metadataError) throw Error("metadata unavailable");
          return { pinnedThreadIds: options.pins ?? [] };
        }
        if (method === "git_worktree_delete_prepare") {
          if (options.prepareError) throw Error("invalid target");
          return wt.path;
        }
        if (method === "git_worktree_delete") {
          if (options.remove) return options.remove();
          return { worktreePath: wt.path, snapshotRef: null, warnings: ["snapshot unavailable"] };
        }
        throw Error(method);
      },
      async callAppServer(method, args) {
        calls.push([method, args]);
        if (method === "thread/read") {
          if (options.readError) throw Error("pin unavailable");
          return { thread: { id: args.threadId, cwd: `${wt.path}/child` } };
        }
        if (method === "thread/list") {
          if (options.loop) return { data: [], nextCursor: "again" };
          if (args.archived) return { data: options.missingArchive ? [] : [...threads, ...(options.secondPage ?? [])] };
          return args.cursor ? { data: options.secondPage ?? [] } :
            { data: threads, nextCursor: options.secondPage ? "page2" : null };
        }
        if (method === "thread/archive") {
          if (args.threadId === options.archiveError) throw Error("archive rejected");
          return {};
        }
        throw Error(method);
      },
    };
  } });
  return { api: exports, calls, run: () => exports.removeWorktreeWithConversations(wt) };
}
const methods = fixture => fixture.calls.map(call => call[0]);
{
  const { api } = fixture();
  assert(api.cwdInWorktree("c:\\REPO\\wt\\src", wt.path));
  assert(api.cwdInWorktree("C:/repo/wt/child/../src", wt.path));
  assert(!api.cwdInWorktree("C:/repo/wt-other", wt.path));
  assert(!api.cwdInWorktree("C:/repo/wt/../outside", wt.path));
}
for (const options of [
  { pins: ["outside-current-page"] }, { metadataError: true },
  { pins: ["missing"], readError: true }, { loop: true }, { prepareError: true },
]) {
  const f = fixture(options);
  await assert.rejects(f.run());
  assert(!methods(f).includes("thread/archive"));
  assert(!methods(f).includes("git_worktree_delete"));
}
{
  const f = fixture({ threads: [
    { id: "a", cwd: wt.path }, { id: "ephemeral", cwd: wt.path, ephemeral: true },
    { id: "ambient", cwd: wt.path, threadSource: "ambient_suggestions" },
    { id: "prefix", cwd: `${wt.path}-other` },
  ], secondPage: [{ id: "b", cwd: `${wt.path}/child` }] });
  const result = await f.run();
  assert.deepEqual(f.calls.filter(c => c[0] === "thread/archive").map(c => c[1].threadId), ["a", "b"]);
  assert.equal(methods(f)[0], "git_worktree_delete_prepare");
  assert.equal(methods(f).at(-1), "git_worktree_delete");
  assert.equal(result.snapshotRef, null);
  assert.equal(result.warnings[0], "snapshot unavailable");
}
{
  const f = fixture({ threads: [{ id: "a", cwd: wt.path }, { id: "b", cwd: wt.path }], archiveError: "b" });
  await assert.rejects(f.run(), /已有 1 个关联会话/);
  assert(!methods(f).includes("git_worktree_delete"));
}
{
  const f = fixture({ missingArchive: true });
  await assert.rejects(f.run(), /回读/);
  assert(!methods(f).includes("git_worktree_delete"));
}
{
  let resolve;
  const gate = new Promise(r => { resolve = r; });
  const f = fixture({ remove: () => gate });
  const first = f.run(), second = f.run();
  assert.equal(first, second, "Same worktree shares the in-flight operation");
  resolve({ worktreePath: wt.path, snapshotRef: "refs/codex/snapshots/test", warnings: [] });
  await first;
  assert.equal(methods(f).filter(m => m === "git_worktree_delete").length, 1);
}
{
  const f = fixture({ remove: () => ({}) });
  await assert.rejects(f.run(), /未返回可确认/);
}
const view = fs.readFileSync("src/components/WorktreesView.tsx", "utf8");
const ast = ts.createSourceFile("WorktreesView.tsx", view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleDeleteWorktree") handler = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function deletionHandler() {
  let resolve, reject;
  const pending = new Promise((a, b) => { resolve = a; reject = b; });
  const notices = [], errors = [];
  let removes = 0, refreshes = 0;
  const context = {
    exports: {}, AbortController, deletionControllerRef: { current: null }, actionPendingRef: { current: false }, actionBusyPath: null, creationControllerRef: { current: null },
    conversations: [], confirm: () => true, contextRef: { current: { revision: 1 } },
    mountedRef: { current: true }, setActionBusyPath() {},
    tauriInvoke: async (method, args) => {
      assert.equal(method, "worktree_preferences_read");
      assert.equal(args.hostId, "local");
      return { hostId: "local", preferences: { confirmBeforeDelete: true } };
    },
    removeWorktreeWithConversations: () => { removes++; return pending; },
    refresh: async () => { refreshes++; }, notify: text => notices.push(text),
    setError: text => errors.push(text), cwdInWorktree: () => false,
  };
  vm.runInNewContext(ts.transpileModule(`exports.run = ${handler}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { context, resolve, reject, notices, errors, run: () => context.exports.run(wt),
    get removes() { return removes; }, get refreshes() { return refreshes; } };
}
for (const fail of [false, true]) {
  const f = deletionHandler();
  const first = f.run();
  await f.run();
  assert.equal(f.removes, 1, "Production handler synchronously blocks double click");
  f.context.contextRef.current.revision += 2; // A -> B -> A remains a different context.
  if (fail) f.reject(Error("late failure"));
  else f.resolve({ warnings: [] });
  await first;
  assert.equal(f.refreshes, 0);
  assert.equal(f.notices.length + f.errors.length, 0, "Late results do not pollute another context");
}
{
  const f = deletionHandler();
  f.context.creationControllerRef.current = new AbortController();
  await f.run();
  assert.equal(f.removes, 0, "A worktree setup in progress blocks a simultaneous removal");
}
{
  const f = deletionHandler();
  const pending = f.run();
  f.reject(Error("archive failed"));
  await pending;
  assert.equal(f.refreshes, 1);
  assert.match(f.errors[0], /archive failed/);
}
console.log("WR: path boundaries, pin reread, pagination, partial archive, readback, single-flight and result contracts passed");
