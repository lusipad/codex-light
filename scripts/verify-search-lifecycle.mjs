import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";

const text = fs.readFileSync(new URL("../src/components/QuickSearchModal.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("QuickSearchModal.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [], effects = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && /^REMOTE_/.test(node.name.getText(ast))) declarations.push(`const ${node.getText(ast)};`);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
const remoteEffect = effects.find(node => node.getText(ast).includes("const canSearch"));
const fileEffect = effects.find(node => node.getText(ast).includes("const search = createFuzzyFileSearch"));
const fileQueryEffect = effects.find(node => node.getText(ast).includes("fileSearchRef.current?.update("));
const lookupEffect = effects.find(node => node.getText(ast).includes("await getMetadata(path)"));
const recentEffect = effects.find(node => node.getText(ast).includes('"fs_recent_workspace_files"'));
assert.ok(remoteEffect);
const js = ts.transpileModule(`${declarations.join("\n")}\n({
  effect:${remoteEffect.getText(ast)},
  files:${fileEffect.getText(ast)},
  fileQuery:${fileQueryEffect.getText(ast)},
  lookup:${lookupEffect.getText(ast)},
  recent:${recentEffect.getText(ast)},
  resolveFileSearchPath: typeof resolveFileSearchPath === "function" ? resolveFileSearchPath : undefined
})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let n = 0; n < 16; n++) await Promise.resolve(); };
function mount() {
  const timers = new Map(), requests = [], fileControllers = [];
  let clock = 1000, timerId = 0;
  const context = {
    open: true, query: "target", workspacePath: "C:/repo-A", fileRoots: ["C:/repo-A"], fileScope: '["C:/repo-A"]', mode: "root", pathQuery: null, recentRequest: null,
    homeDir: async () => "C:\\Users\\tester",
    normalizeFsPath: async value => path.win32.normalize(value),
    joinFsPath: path.win32.join,
    remoteCacheRef: { current: new Map() },
    fileSearchRef: { current: null },
    createFuzzyFileSearch(roots, callbacks) {
      const controller = { roots, callbacks, updates: [], disposed: false,
        update(query) { this.updates.push(query); }, dispose() { this.disposed = true; } };
      fileControllers.push(controller); return controller;
    },
    console,
    Date: { now: () => clock },
    isTauriRuntime: () => true,
    window: {
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
      clearTimeout(id) { timers.delete(id); },
    },
    callAppServer(method, args) {
      const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise;
    },
    setRemoteResults(value) { context.results = typeof value === "function" ? value(context.results) : value; },
    setRemoteLoading(value) { context.loading = value; },
    getMetadata(path) { const pending = deferred(); requests.push({ method: "fs/getMetadata", path, ...pending }); return pending.promise; },
    setPathResult(result) { context.pathResult = result; },
    crypto: { randomUUID: () => "scan-id" },
    tauriInvoke(method, args) {
      if (method === "fs_cancel_recent_workspace_files") { requests.push({ method, args }); return Promise.resolve(); }
      const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise;
    },
    setRecentResult(result) { context.recentResult = result; },
    setHistoryResult(result) { context.historyResult = result; },
  };
  return {
    context, requests, timers, fileControllers, ...vm.runInNewContext(js, context),
    async start() {
      const cleanup = this.effect();
      const callbacks = [...timers.values()]; timers.clear();
      callbacks.forEach(fn => fn());
      await flush();
      return cleanup;
    },
    advance(ms) { clock += ms; },
  };
}
const resolveThreads = request => request.resolve({ data: [{ thread: { id: "thread-1", name: "target" } }] });
const byMethod = (view, name) => view.requests.filter(request => request.method === name);
const failures = [];
async function check(name, test) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
await check("SB11 empty file scan cancels on scope change and cannot apply late data", async () => {
  const view = mount();
  assert.equal(view.recent(), undefined);
  view.context.recentRequest = { roots: ["C:/repo-A", "C:/sibling"] };
  const cleanup = view.recent();
  assert.deepEqual(view.requests[0].args.roots, ["C:/repo-A", "C:/sibling"]);
  assert.deepEqual(view.requests[1].args.roots, view.requests[0].args.roots);
  cleanup();
  assert.equal(view.requests[2].method, "fs_cancel_recent_workspace_files");
  assert.equal(view.requests[2].args.requestId, "scan-id");
  view.requests[0].resolve([{ path: "C:/repo-A/a.txt", updatedAt: 1 }]);
  view.requests[1].resolve([{ path: "C:/repo-A/a.txt", updatedAt: 2 }]); await flush();
  assert.equal(view.context.recentResult, undefined);
  assert.equal(view.context.historyResult, undefined);
  view.context.recentRequest = { roots: ["C:/repo-B"] };
  const finish = view.recent();
  view.requests[3].resolve([{ path: "C:/repo-B/b.txt", updatedAt: 3 }]);
  view.requests[4].reject(Error("missing ripgrep")); await flush();
  assert.deepEqual(view.context.recentResult.request.roots, ["C:/repo-B"]);
  assert.equal(view.context.historyResult.files[0].path, "C:/repo-B/b.txt");
  assert.equal(view.context.recentResult.files, undefined);
  finish();
  assert.equal(view.requests.length, 5, "settled scans require no cancellation");
});
await check("SB08 direct paths resolve only inside the selected workspace", async () => {
  const view = mount();
  const resolve = view.resolveFileSearchPath;
  assert.equal(typeof resolve, "function", "direct path resolver exists");
  assert.equal(await resolve("C:/repo-A/src/测试.rs", ["c:/repo-a"]), "C:\\repo-A\\src\\测试.rs");
  assert.equal(await resolve("~/project/src", ["C:/Users/tester/project"]), "C:\\Users\\tester\\project\\src");
  assert.equal(await resolve("C:/sibling/src", ["C:/repo-A", "C:/sibling"]), "C:\\sibling\\src");
  for (const query of ["C:/repo-A-other/a", "C:/repo-A/../private/a", "C:/repo-A/dir/.. /a", "//?/C:/repo-A/a"]) {
    assert.equal(await resolve(query, ["C:/repo-A", "C:/sibling"]), null, query);
  }
});
await check("SB09 direct lookups bypass fuzzy and reject late metadata after leaving", async () => {
  const view = mount(), { context } = view;
  Object.assign(context, { mode: "files", query: "C:/repo-A/old", pathQuery: "C:/repo-A/old",
    pathRequest: { pathQuery: "C:/repo-A/old", roots: ["C:/repo-A"] } });
  const filesCleanup = view.files(); view.fileQuery();
  assert.equal(view.fileControllers[0].updates[0], "");
  const oldCleanup = view.lookup(); await flush();
  assert.equal(view.requests[0].path, "C:\\repo-A\\old");
  oldCleanup();
  context.pathRequest = { pathQuery: "C:/repo-A/new", roots: ["C:/repo-A"] };
  const currentCleanup = view.lookup(); await flush();
  view.requests[1].resolve({ isDirectory: true }); await flush();
  view.requests[0].resolve({ isFile: true }); await flush();
  assert.equal(context.pathResult.match.path, "C:\\repo-A\\new");
  assert.equal(context.pathResult.match.isDirectory, true);
  currentCleanup(); filesCleanup();
});
await check("SB10 direct lookup distinguishes absence and errors without automatic retry", async () => {
  for (const [error, failed] of [[Error("系统找不到指定的文件。 (os error 2)"), false], [Error("access denied"), true]]) {
    const view = mount();
    view.context.pathRequest = { pathQuery: "C:/repo-A/file", roots: ["C:/repo-A"] };
    const cleanup = view.lookup(); await flush();
    view.requests[0].reject(error); await flush();
    assert.equal(view.context.pathResult.failed, failed);
    assert.equal(view.requests.length, 1);
    cleanup();
  }
});
await check("SB12 file sessions pass both roots and reject unknown or escaping results", async () => {
  const view = mount();
  Object.assign(view.context, { mode: "files", fileRoots: ["C:/repo-A", "C:/sibling"], fileScope: '["C:/repo-A","C:/sibling"]' });
  const cleanup = view.files();
  assert.deepEqual(Array.from(view.fileControllers[0].roots), view.context.fileRoots);
  view.fileControllers[0].callbacks.onResults({ query: "target", files: [
    { root: "C:/sibling", path: "src/target.txt" }, { root: "C:/other", path: "target.txt" },
    { root: "C:/repo-A", path: "../target.txt" }, { path: "unknown.txt" },
  ] });
  assert.deepEqual(Array.from(view.context.results.files, file => file.absPath), ["C:/sibling/src/target.txt"]);
  cleanup();
});
await check("SB01 failed thread empty results have a bounded thirty-second cache", async () => {
  const view = mount(), cleanup = await view.start();
  view.requests.forEach(request => request.reject(Error("service offline")));
  await flush(); cleanup();
  view.context.open = false; view.effect();
  view.context.open = true; await view.start();
  assert.equal(byMethod(view, "thread/search").length, 1, "catch-to-empty remains fresh within 30s");
  view.advance(30001); await view.start();
  assert.equal(byMethod(view, "thread/search").length, 2, "failure cannot freeze this query forever");
});
await check("SB02 switching to files is independent of a pending old thread search", async () => {
  const view = mount(), cleanup = await view.start();
  assert.equal(byMethod(view, "fuzzyFileSearch").length, 0, "root cannot issue fuzzy search");
  cleanup(); view.context.mode = "files"; const cleanupFiles = view.files(); view.fileQuery();
  view.fileControllers[0].callbacks.onResults({ query: "target", files: [{ path: "target.txt" }] });
  assert.equal(view.context.results?.files[0]?.fileName, "target.txt");
  resolveThreads(byMethod(view, "thread/search")[0]); await flush();
  assert.equal(view.context.results.mode, "files");
  assert.equal(view.context.results.threads.length, 0);
  cleanupFiles();
});
await check("SB03 file view recreation never reuses a permanent result cache", async () => {
  const view = mount(); view.context.mode = "files";
  const cleanup = view.files(); view.fileQuery();
  assert.equal(view.fileControllers[0].updates[0], "target");
  cleanup(); const cleanupNext = view.files(); view.fileQuery();
  assert.equal(view.fileControllers[0].disposed, true);
  assert.equal(view.fileControllers[1].updates[0], "target");
  view.fileControllers[0].callbacks.onResults({ query: "target", files: [{ path: "stale.txt" }] });
  assert.equal(view.context.results, null, "disposed view callback cannot restore stale hits");
  cleanupNext();
});
await check("SB04 thread results become stale after thirty seconds", async () => {
  const view = mount(), cleanup = await view.start();
  resolveThreads(byMethod(view, "thread/search")[0]);
  await flush(); cleanup(); view.advance(30001);
  await view.start();
  assert.equal(byMethod(view, "thread/search").length, 2);
});
await check("SB05 old responses cannot populate another query or its cache", async () => {
  const view = mount(), cleanup = await view.start();
  cleanup(); view.context.query = "new-query"; await view.start();
  resolveThreads(view.requests[0]); await flush();
  assert.notEqual(view.context.results?.query, "target");
  assert.equal(view.context.remoteCacheRef.current.size, 0);
});
await check("SB06 close cancels debounce and files never request thread search", async () => {
  const view = mount();
  const cleanup = view.effect(); cleanup();
  assert.equal(view.timers.size, 0);
  view.context.mode = "files";
  await view.start();
  assert.equal(byMethod(view, "thread/search").length, 0);
  assert.equal(view.requests.length, 0);
});
await check("SB07 root queries use length three and 200ms, files accept one character", async () => {
  const view = mount(); view.context.query = "ab";
  await view.start(); assert.equal(view.requests.length, 0);
  view.context.mode = "files"; view.context.query = "a";
  const cleanup = view.files(); view.fileQuery();
  assert.equal(view.fileControllers[0].updates[0], "a");
  cleanup();
  assert.match(text, /REMOTE_DEBOUNCE_MS = 200/);
});
if (failures.length) process.exitCode = 1;
