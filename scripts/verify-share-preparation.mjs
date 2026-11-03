import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  modules.set(name, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/${name}.ts`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, require: dependency => load(dependency.replace("./", "")),
    Error, Set, Map, ArrayBuffer, Uint8Array, TextEncoder, AbortController, AbortSignal,
  });
  return exports;
}
const { prepareShareThread } = load("prepareShareThread");
const controller = () => new AbortController();
const options = () => ({ threadId: "thread-1", signal: controller().signal });
function requestFor(items) {
  return async method => method === "thread/read"
    ? { thread: { id: "thread-1", cwd: null, name: "share title", historyMode: "paginated" } }
    : { data: [{ id: "turn-1", items }], nextCursor: null };
}
const user = text => ({ type: "userMessage", content: [{ type: "text", text }] });
const calls = [];
const prepared = await prepareShareThread(options(), {
  request: requestFor([
    user(`## My request:\nAPI_KEY=abcdefgh12345678\n![one](local.png)\n![failed](missing.png)`),
    { type: "commandExecution", aggregatedOutput: "private tool output" },
    { type: "imageView", path: "local.png" },
  ]),
  readAsset: async (candidate, { thread, signal }) => {
    assert.equal(thread.id, "thread-1"); assert.equal(signal.aborted, false);
    calls.push(candidate.source);
    if (candidate.source === "missing.png") throw Error("read failed");
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", width: 20, height: 10 };
  },
});
assert.deepEqual(calls, ["local.png", "missing.png"], "collect the same source once");
assert.equal(prepared.threadId, "thread-1");
assert.equal(prepared.assets.length, 1);
assert.equal(prepared.assets[0].assetId, "asset-1");
assert.equal(prepared.findingCount, 1);
assert.ok(prepared.json.includes("<SECRET>"));
assert.ok(!prepared.json.includes("abcdefgh12345678"));
assert.ok(!prepared.json.includes("private tool output"));
assert.ok(!prepared.json.includes("local.png"));
assert.ok(!prepared.json.includes("missing.png"));
assert.ok(prepared.json.includes("codex:shared-asset/asset-1"));
assert.ok(prepared.json.includes("codex:shared-image-unavailable"));
assert.deepEqual(JSON.parse(JSON.stringify(prepared.redactedSnapshot.assets)), { "asset-1": { width: 20, height: 10 } });
assert.equal(prepared.metrics.collectionFailed, 1);
assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.json).byteLength);

let concurrency = 0, maximum = 0, started = [];
const many = await prepareShareThread(options(), {
  request: requestFor([user(Array.from({ length: 67 }, (_, index) => `![x](image-${index})`).join("\n"))]),
  readAsset: async candidate => {
    started.push(candidate.source);
    concurrency++; maximum = Math.max(maximum, concurrency);
    await new Promise(resolve => setImmediate(resolve));
    concurrency--;
    return { bytes: new Uint8Array([1]), mimeType: "image/png" };
  },
});
assert.equal(maximum, 4);
assert.equal(many.assets.length, 64);
assert.equal(many.metrics.countLimitExcluded, 3);
assert.equal(started[0], "image-3");
assert.equal(many.assets.at(-1).assetId, "asset-64");

// Reverse selection keeps later assets when the total exceeds 100 MiB.
const big = new Uint8Array(25 * 1024 * 1024);
const limits = await prepareShareThread(options(), {
  request: requestFor([user(Array.from({ length: 6 }, (_, index) => `![x](limit-${index})`).join("\n"))]),
  readAsset: async candidate => ({
    bytes: candidate.source === "limit-0" ? new Uint8Array(big.length + 1) : big,
    mimeType: "image/png",
  }),
});
assert.equal(limits.metrics.individualSizeExcluded, 1);
assert.equal(limits.metrics.totalSizeExcluded, 1);
assert.equal(limits.assets.length, 4);
const snapshots = limits.redactedSnapshot.turns[0].items[0].content[0].text;
assert.ok(snapshots.startsWith("![x](codex:shared-image-unavailable)\n![x](codex:shared-image-unavailable)"));

const wrongMime = await prepareShareThread(options(), {
  request: requestFor([user("![html](html)")]),
  readAsset: async () => ({ bytes: new Uint8Array([1]), mimeType: "text/html" }),
});
assert.equal(wrongMime.assets.length, 0);
assert.equal(wrongMime.metrics.collectionFailed, 1);
let current = true;
const accountController = controller();
let receivedSignal;
await assert.rejects(prepareShareThread({
  ...options(), signal: accountController.signal,
  assertCurrent: () => { if (!current) throw Error("账号变化"); },
}, {
  request: requestFor([user("![x](one)")]),
  readAsset: async (_, { signal }) => {
    receivedSignal = signal; current = false;
    return { bytes: new Uint8Array([1]), mimeType: "image/png" };
  },
}), /账号变化/);
assert.equal(receivedSignal.aborted, true, "identity failure cancels sibling collection");
const cancelled = controller();
let count = 0;
await assert.rejects(prepareShareThread({ ...options(), signal: cancelled.signal }, {
  request: requestFor([user("![x](one)")]),
  readAsset: async () => { count++; cancelled.abort(); throw Error("asset read aborted"); },
}), /取消/);
assert.equal(count, 1);
const empty = await prepareShareThread(options(), {
  request: requestFor([]), readAsset: async () => assert.fail("empty history has no assets"),
});
assert.equal(empty.redactedSnapshot.turns.length, 0);
assert.equal(empty.assets.length, 0);
console.log("PASS share preparation production pipeline: history, assets, limits, redaction, cancellation and identity");
