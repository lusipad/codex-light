import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/pluginDirectorySearch.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  const slots = [], timers = new Map(), calls = [];
  let index = 0, dirty = true, effects = [], now = 0, timerId = 0, output;
  let props = { query: "  paint  ", cwds: ["D:/private"], identity: "account-a", enabled: true };
  const react = {
    useState(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial;
      return [slots[key], value => { slots[key] = typeof value === "function" ? value(slots[key]) : value; dirty = true; }];
    },
    useRef(initial) { const key = index++; return slots[key] ??= { current: initial }; },
    useEffect(run, deps) {
      const key = index++, previous = slots[key];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[key] = { deps, cleanup: run() }; });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, require: name => name === "react" ? react : {
      searchPlugins: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
      isUnsupportedPluginSearch: error => error?.message === "Method not found: plugin/search",
    },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  function render() {
    for (let count = 0; dirty; count++) {
      assert.ok(count < 30, "hook render must settle"); dirty = false; index = 0;
      output = exports.usePluginDirectorySearch(props);
      const pending = effects; effects = []; pending.forEach(run => run());
    }
    return output;
  }
  return {
    calls, timers, get value() { return render(); },
    update(patch) { props = { ...props, ...patch }; dirty = true; return render(); },
    tick(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } return render(); },
    async settle() { await Promise.resolve(); await Promise.resolve(); return render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const row = (id, marketplaceName = "market", marketplacePath = null) => ({ marketplaceName, marketplacePath, plugin: { id, name: id } });
const response = (data, nextCursor = null) => ({ data, nextCursor });

{
  const f = fixture();
  assert.equal(f.value.loading, true); f.tick(199); assert.equal(f.calls.length, 0);
  f.tick(1); assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)), ["paint", ["D:/private"], null]);
  f.calls[0].resolve(response([row("first")], "page-2")); await f.settle();
  assert.equal(f.value.result.data[0].plugin.id, "first");
  f.value.loadMore(); f.value.loadMore(); assert.equal(f.calls.length, 2, "duplicate pagination is single-flight");
  assert.equal(f.calls[1].args[2], "page-2");
  f.calls[1].reject(Error("offline")); await f.settle();
  assert.equal(f.value.pageError, "offline"); assert.equal(f.value.result.data.length, 1);
  f.value.loadMore(); assert.equal(f.calls[2].args[2], "page-2", "failed page retries its original cursor");
  f.calls[2].resolve(response([row("first"), row("first", "other"), row("second")], "page-2")); await f.settle();
  assert.equal(f.value.result.data.length, 3, "deduplicate same source, preserve distinct marketplace identity");
  assert.equal(f.value.nextCursor, null, "server cursor loop terminates"); f.value.loadMore(); assert.equal(f.calls.length, 3);
  assert.ok(f.value.pageError, "cursor loop must remain visible instead of pretending the directory is complete");
  f.unmount();
}
for (const patch of [{ query: "new" }, { cwds: ["D:/second"] }, { identity: "account-b" }, { enabled: false }, { query: "   " }]) {
  const f = fixture(); f.value; f.tick(200); f.update(patch);
  f.calls[0].resolve(response([row("stale")], "stale-cursor")); await f.settle();
  assert.equal(f.value.result, null, "scope change must reject old first page");
  if (patch.enabled === false || patch.query === "   ") { f.tick(200); assert.equal(f.calls.length, 1); assert.equal(f.value.loading, false); }
  f.unmount(); assert.equal(f.timers.size, 0);
}
{
  const f = fixture(); f.value; f.tick(150); f.update({ query: "new" }); f.tick(50); assert.equal(f.calls.length, 0);
  f.tick(150); assert.equal(f.calls[0].args[0], "new"); f.unmount();
  f.calls[0].resolve(response([row("unmounted")])); await f.settle(); assert.equal(f.value.result, null);
}
for (const message of ["403 forbidden", "network unavailable", "Method not found: plugin/search"]) {
  const f = fixture(); f.value; f.tick(200); f.calls[0].reject(Error(message)); await f.settle();
  assert.equal(f.value.unsupported, message === "Method not found: plugin/search");
  assert.equal(f.value.error, message); f.value.retry(); f.value; f.tick(200);
  assert.equal(f.calls.length, 2); f.calls[1].resolve(response([])); await f.settle();
  assert.equal(f.value.error, null); assert.equal(f.value.unsupported, false); assert.equal(f.value.result.data.length, 0); f.unmount();
}
{
  const f = fixture(); f.value; f.tick(200); f.calls[0].resolve(response([row("old")], "next")); await f.settle();
  f.value.loadMore(); f.update({ query: "next-query" }); f.tick(200);
  f.calls[2].resolve(response([row("current")])); await f.settle();
  f.calls[1].resolve(response([row("stale-page")], "leak")); await f.settle();
  assert.equal(f.value.result.data[0].plugin.id, "current"); assert.equal(f.value.result.data.length, 1); f.unmount();
}
{
  const f = fixture(); f.value; f.tick(200);
  f.calls[0].resolve(response([row("one"), row("one")], "a")); await f.settle();
  assert.equal(f.value.result.data.length, 1, "first page also deduplicates identities");
  f.value.loadMore(); f.calls[1].resolve(response([row("two")], "b")); await f.settle();
  f.value.loadMore(); f.calls[2].resolve(response([row("three")], "a")); await f.settle();
  assert.equal(f.value.nextCursor, null, "multi-page cursor cycle also terminates");
  assert.ok(f.value.pageError, "multi-page cursor cycle also reports an incomplete result");
  f.update({ query: "new" }); f.tick(200); f.calls[3].resolve(response([row("fresh")], "a")); await f.settle();
  f.value.loadMore(); assert.equal(f.calls[4].args[2], "a", "new query has an independent cursor history");
  f.unmount(); f.calls[4].reject(Error("late unmounted page")); await f.settle();
  assert.equal(f.value.pageError, null, "unmount rejects late pagination failure");
}
{
  const f = fixture(); f.value; f.tick(200); f.value.retry(); f.value;
  f.calls[0].resolve(response([row("before-retry")])); await f.settle();
  assert.equal(f.value.result, null, "retry invalidates even the same-query request");
  f.tick(200); f.calls[1].resolve(response([row("after-retry")])); await f.settle();
  assert.equal(f.value.result.data[0].plugin.id, "after-retry"); f.unmount();
}
console.log("PASS plugin directory search: production hook debounce, scoped late-response isolation, cursor retry/single-flight/loop, source identity, unsupported classification and unmount");
