import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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
const fileQueryEffect = effects.find(node => node.getText(ast).includes("fileSearchRef.current?.update(query)"));
assert.ok(remoteEffect);
const js = ts.transpileModule(`${declarations.join("\n")}\n({
  effect:${remoteEffect.getText(ast)},
  files:${fileEffect.getText(ast)},
  fileQuery:${fileQueryEffect.getText(ast)}
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
    open: true, query: "target", workspacePath: "C:/repo-A", mode: "root",
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
