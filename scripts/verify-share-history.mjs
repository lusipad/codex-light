import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shareThreadHistory.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: module.exports, Error, Set, AbortController });
const { readShareThreadHistory } = module.exports;
const options = () => ({ threadId: "thread-1", signal: new AbortController().signal });
const metadata = { thread: { id: "thread-1", name: "标题", cwd: "D:\\test", historyMode: "paginated" } };
const turn = id => ({ id, items: [{ type: "agentMessage", text: id }], durationMs: 2 });
const calls = [];
const pages = [
  { data: [turn("1"), turn("2")], nextCursor: "page-2" },
  { data: [turn("3")], nextCursor: "page-3" },
  { data: [], nextCursor: null },
];
const history = await readShareThreadHistory(options(), async (method, params) => {
  calls.push({ method, params });
  return method === "thread/read" ? metadata : pages.shift();
});
assert.deepEqual(JSON.parse(JSON.stringify(history)), {
  id: "thread-1", name: "标题", cwd: "D:\\test", turns: [turn("1"), turn("2"), turn("3")],
});
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
  { method: "thread/read", params: { threadId: "thread-1", includeTurns: false } },
  { method: "thread/turns/list", params: { threadId: "thread-1", limit: 5, sortDirection: "asc", itemsView: "full" } },
  { method: "thread/turns/list", params: { threadId: "thread-1", limit: 5, sortDirection: "asc", itemsView: "full", cursor: "page-2" } },
  { method: "thread/turns/list", params: { threadId: "thread-1", limit: 5, sortDirection: "asc", itemsView: "full", cursor: "page-3" } },
]);
assert.equal(metadata.thread.turns, undefined, "reading must not mutate metadata");

// Invalid pages and cursor cycles must fail rather than publish partial history.
for (const invalid of [
  {}, { data: null }, { data: [], nextCursor: 1 }, { data: [{ id: "bad" }] },
  { data: [{ id: "", items: [] }] }, { data: [{ id: "bad", items: [null] }] },
]) {
  await assert.rejects(readShareThreadHistory(options(), async method =>
    method === "thread/read" ? metadata : invalid), /历史/);
}
let requests = 0;
await assert.rejects(readShareThreadHistory(options(), async method => {
  requests++;
  return method === "thread/read" ? metadata : { data: [], nextCursor: "loop" };
}), /游标/);
assert.equal(requests, 3, "cursor cycle stops before another RPC");
await assert.rejects(readShareThreadHistory(options(), async method =>
  method === "thread/read" ? metadata : { data: [turn("same"), turn("same")], nextCursor: null }), /重复/);
for (const badMetadata of [
  { thread: { ...metadata.thread, id: "other" } },
  { thread: { ...metadata.thread, cwd: undefined } },
  { thread: { ...metadata.thread, name: {} } },
]) {
  let reads = 0;
  await assert.rejects(readShareThreadHistory(options(), async () => { reads++; return badMetadata; }), /会话/);
  assert.equal(reads, 1);
}
const aborted = new AbortController(); aborted.abort();
await assert.rejects(readShareThreadHistory({ ...options(), signal: aborted.signal }, async () => {
  assert.fail("cancelled read must not send RPC");
}), /取消/);
const during = new AbortController();
let duringCalls = 0;
await assert.rejects(readShareThreadHistory({ ...options(), signal: during.signal }, async method => {
  duringCalls++;
  if (method === "thread/read") return metadata;
  during.abort();
  return { data: [turn("late")], nextCursor: "unused" };
}), /取消/);
assert.equal(duringCalls, 2, "late result cannot continue pagination");
let current = true;
await assert.rejects(readShareThreadHistory({
  ...options(), assertCurrent: () => { if (!current) throw Error("账号变化"); },
}, async () => { current = false; return metadata; }), /账号变化/);
await assert.rejects(readShareThreadHistory(options(), async method => {
  if (method === "thread/read") return metadata;
  throw Error("RPC failure");
}), /RPC failure/);
const legacyCalls = [];
const legacy = await readShareThreadHistory(options(), async (method, params) => {
  legacyCalls.push(params);
  return { thread: { id: "thread-1", cwd: null, turns: params.includeTurns ? [turn("legacy")] : [] } };
});
assert.equal(legacy.cwd, null);
assert.deepEqual(Array.from(legacy.turns, item => item.id), ["legacy"]);
assert.deepEqual(legacyCalls.map(params => params.includeTurns), [false, true]);
await assert.rejects(readShareThreadHistory(options(), async () => ({
  thread: { ...metadata.thread, turns: [{ id: "partial", itemsView: "summary", items: [] }] },
})), /历史/);
console.log("PASS share full-history pagination, completeness, cancellation and identity guards");
