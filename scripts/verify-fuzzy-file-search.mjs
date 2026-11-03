import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/fuzzyFileSearch.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function mount() {
  const requests = [], results = [], loading = [], errors = [];
  const registration = deferred();
  let handler, released = 0;
  const module = { exports: {} };
  const bridge = {
    tauriListen(name, callback) { assert.equal(name, "app-server:notification"); handler = callback; return registration.promise; },
    callAppServer(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
  };
  vm.runInNewContext(compiled, {
    exports: module.exports, require: () => bridge, crypto: { randomUUID: () => "session-A" },
  });
  const search = module.exports.createFuzzyFileSearch(["C:/repo-A"], {
    onResults: value => results.push(value), onLoading: value => loading.push(value), onError: error => errors.push(error),
  });
  return {
    search, requests, results, loading, errors,
    listen() { registration.resolve(() => { released++; }); },
    emit(method, params) { handler({ method: `fuzzyFileSearch/${method}`, params: { sessionId: "session-A", ...params } }); },
    released: () => released,
    async started() { this.listen(); await flush(); requests[0].resolve({}); await flush(); },
  };
}
{
  const view = mount();
  const done = view.search.update("a");
  await flush(); assert.equal(view.requests.length, 0, "FS01 install listener before start");
  await view.started();
  assert.equal(view.requests[1].method, "fuzzyFileSearch/sessionUpdate");
  assert.equal(view.requests[1].args.query, "a", "one character needs no shared debounce");
  view.requests[1].resolve({}); await done;
  view.emit("sessionCompleted", {});
  assert.equal(view.loading.at(-1), true, "FS12 a startup/old completion cannot finish a query before its results");
  view.emit("sessionUpdated", { query: "other", files: ["wrong"] });
  view.emit("sessionUpdated", { sessionId: "other", query: "a", files: ["wrong"] });
  assert.equal(view.results.length, 0);
  view.emit("sessionUpdated", { query: "a", files: [{ path: "a.txt" }] });
  view.emit("sessionCompleted", {});
  assert.equal(view.results[0].files[0].path, "a.txt");
  assert.equal(view.loading.at(-1), false);
  view.search.dispose(); await flush();
  assert.equal(view.released(), 1);
  assert.equal(view.requests.at(-1).method, "fuzzyFileSearch/sessionStop");
  view.requests.at(-1).resolve({});
  view.emit("sessionUpdated", { query: "a", files: ["late"] });
  assert.equal(view.results.length, 1, "FS02 dispose rejects late notifications");
}
{
  const view = mount();
  view.search.update("A"); view.search.update("B");
  await view.started();
  assert.equal(view.requests[1].args.query, "B", "FS03 coalesce queued obsolete queries");
  view.search.update("C"); await flush();
  assert.equal(view.requests.length, 3, "slow old acknowledgment must not block the next query");
  assert.equal(view.requests[2].args.query, "C");
  view.search.dispose(); await flush();
  assert.equal(view.requests.length, 4, "FS04 stop immediately without waiting for update acknowledgment");
  view.requests[1].resolve({});
  view.requests[2].resolve({}); await flush();
  assert.equal(view.requests[3].method, "fuzzyFileSearch/sessionStop");
  view.requests[3].resolve({});
}
{
  const view = mount(); view.search.update("A"); await view.started();
  view.requests[1].reject(Error("fuzzy file search session not found")); await flush();
  assert.equal(view.requests[2].method, "fuzzyFileSearch/sessionStart");
  view.search.dispose(); await flush();
  assert.equal(view.requests.length, 3);
  view.requests[2].resolve({}); await flush();
  assert.equal(view.requests[3].method, "fuzzyFileSearch/sessionStop", "FS11 late restart is stopped without sending another query");
  view.requests[3].resolve({});
}
{
  const view = mount(); view.search.update("A");
  view.listen(); await flush(); view.search.dispose();
  assert.equal(view.requests.length, 1);
  view.requests[0].resolve({}); await flush();
  assert.equal(view.requests[1].method, "fuzzyFileSearch/sessionStop", "FS05 late start is stopped without update");
  view.requests[1].resolve({});
}
{
  const view = mount(); view.search.update("A"); view.search.dispose();
  view.listen(); await flush();
  assert.equal(view.requests.length, 0, "FS06 close before listener readiness cannot create a session");
  assert.equal(view.released(), 1);
}
{
  const view = mount(); view.search.update("A"); view.listen(); await flush();
  const cleanup = view.search.dispose();
  view.requests[0].reject(Error("-32601 Method not found"));
  await cleanup; await flush();
  assert.equal(view.errors.length, 0, "FS13 late unsupported reply cannot call an already released listener");
  assert.equal(view.requests.length, 1, "closed view cannot issue a fallback query");
}
{
  const view = mount(); view.search.update("A"); view.listen(); await flush();
  view.requests[0].reject(Error("-32601 Method not found")); await flush();
  assert.equal(view.requests[1].method, "fuzzyFileSearch", "FS07 only unsupported session falls back");
  view.requests[1].resolve({ files: [{ path: "A.txt" }] }); await flush();
  assert.equal(view.results[0].query, "A");
  assert.equal(view.loading.at(-1), false);
  view.search.dispose(); await flush();
  assert.equal(view.requests.length, 2, "unsupported sessions have nothing to stop");
}
{
  const view = mount(); view.search.update("A"); view.listen(); await flush();
  view.requests[0].reject(Error("access denied")); await flush();
  assert.equal(view.errors.length, 1);
  assert.equal(view.requests.length, 1, "FS08 real failures are not masked by fallback");
  view.search.update("B"); await flush();
  assert.equal(view.requests[1].method, "fuzzyFileSearch/sessionStart", "next query can retry failed startup");
  view.requests[1].resolve({}); await flush(); view.requests[2].resolve({}); await flush();
  view.search.dispose(); await flush(); view.requests[3].resolve({});
}
{
  const view = mount(); view.search.update("A"); await view.started();
  view.requests[1].reject(Error("fuzzy file search session not found")); await flush();
  assert.equal(view.requests[2].method, "fuzzyFileSearch/sessionStart");
  view.requests[2].resolve({}); await flush();
  assert.equal(view.requests[3].method, "fuzzyFileSearch/sessionUpdate", "FS09 reconnect recovers lost session");
  view.requests[3].resolve({}); await flush();
  view.search.dispose(); await flush(); view.requests[4].resolve({});
}
{
  const view = mount(); await view.search.update("   "); await flush();
  assert.equal(view.requests.length, 0, "FS10 empty query does not start session");
  assert.equal(view.results[0].files.length, 0);
  assert.equal(view.loading.at(-1), false);
}
console.log("PASS FS01–FS13 production file search session lifecycle, fallback, recovery, stale events and cleanup");
