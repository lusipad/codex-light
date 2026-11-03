import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const findings = {};
vm.runInNewContext(transpile("src/reviewFindings.ts"), { exports: findings });
const reviewPrompt = findings.buildQuickReviewPrompt("Review the fixture changes");
const exports = {};
vm.runInNewContext(transpile("src/reviewResults.ts"), { exports, require: () => findings });
const { createReviewResults } = exports;
let updates = 0;
const tracker = createReviewResults(() => updates++);
const event = (method, threadId, turnId, extra = {}) => tracker.ingest({ method, params: { threadId, turnId, ...extra } });
const completed = (threadId, turnId, status, items = []) => event("turn/completed", threadId, turnId, { turn: { id: turnId, status, items } });
const run = id => tracker.getRuns().find(r => r.turnId === id);
const attempt = tracker.begin("a", "/repo", ["/repo"]);
completed("a", "unrelated", "completed", [{ id: "bad", type: "agentMessage", text: "chat" }]);
completed("a", "first", "completed", [{ id: "one", type: "agentMessage", text: "early final" }]);
tracker.bind("a", attempt, "first");
assert.equal(run("first").status, "completed");
assert.equal(run("first").text, "early final");
assert.equal(run("unrelated"), undefined);
event("item/agentMessage/delta", "a", "first", { itemId: "one", delta: "late" });
event("turn/started", "a", "first");
assert.equal(run("first").text, "early final");
assert.equal(run("first").status, "completed");
const second = tracker.begin("a", "/repo", ["/repo"]);
tracker.bind("a", second, "second");
event("item/started", "a", "second", { item: { id: "older", type: "agentMessage", text: "" } });
event("item/agentMessage/delta", "a", "second", { itemId: "older", delta: "draft" });
event("item/started", "a", "second", { item: { id: "last", type: "agentMessage", text: "" } });
event("item/completed", "a", "second", { item: { id: "last", type: "agentMessage", text: "final" } });
event("item/completed", "a", "second", { item: { id: "older", type: "agentMessage", text: "old final" } });
completed("a", "second", "failed");
assert.equal(run("second").text, "final", "last message follows item identity, not late completion order");
assert.equal(run("second").status, "failed");
const third = tracker.begin("b", "/other", ["/other"]);
tracker.bind("b", third, "third");
event("item/agentMessage/delta", "b", "third", { itemId: "b1", delta: "partial" });
completed("a", "third", "completed");
assert.equal(run("third").status, "running", "thread identity must match");
completed("b", "third", undefined);
assert.equal(run("third").status, "unknown", "missing terminal state cannot mean success");
tracker.hydrate("b", "/other", ["/other"], [{ id: "third", status: "interrupted", items: [{ id: "b1", type: "agentMessage", text: "kept" }] }]);
assert.equal(run("third").status, "interrupted");
assert.equal(run("third").text, "kept");
tracker.hydrate("c", "/repo", ["/repo"], [
  { id: "ordinary", status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: "hello" }] }] },
  { id: "historic", status: "completed", items: [{ type: "userMessage", input: [{ type: "text", text: reviewPrompt }] }, { type: "agentMessage", id: "h1", text: "historic final" }] },
]);
assert.equal(run("ordinary"), undefined);
assert.equal(run("historic").text, "historic final");
const sequence = run("historic").sequence;
tracker.hydrate("c", "/repo", [], [{ id: "historic", status: "inProgress", items: [] }]);
assert.equal(run("historic").sequence, sequence);
assert.equal(run("historic").status, "completed", "stale history must not regress terminal state");
const pending = tracker.begin("d", "/repo", []);
tracker.bind("d", pending, "pending");
tracker.disconnected();
assert.equal(run("pending").status, "unknown");
tracker.hydrate("d", "/repo", [], [{ id: "pending", status: "completed", items: [] }]);
assert.equal(run("pending").status, "completed");
const unconfirmed = tracker.begin("e", "/repo", []);
tracker.startUnconfirmed("e", unconfirmed, "response lost");
assert.equal(tracker.getRuns().find(r => r.attempt === unconfirmed).status, "unknown");
const parallelA = tracker.begin("parallel-a", "/repo", []);
const parallelB = tracker.begin("parallel-b", "/other", []);
tracker.bind("parallel-a", parallelA, "pa");
tracker.bind("parallel-b", parallelB, "pb");
completed("parallel-b", "pb", "interrupted", [{ id: "pb-item", type: "agentMessage", text: "interrupted text" }]);
completed("parallel-a", "pa", "completed", [
  { id: "pa-old", type: "agentMessage", text: "not concatenated" },
  { id: "pa-last", type: "agentMessage", text: "authoritative last" },
]);
assert.equal(run("pa").text, "authoritative last");
assert.equal(run("pb").text, "interrupted text");
assert.equal(run("pb").status, "interrupted");
const before = tracker.getRuns().length;
tracker.bind("parallel-a", parallelA, "pa");
tracker.hydrate("parallel-a", "/repo", [], [{ id: "pa", status: "completed", items: [] }]);
assert.equal(tracker.getRuns().length, before);
assert.equal(run("pa").attempt, parallelA);
const missing = tracker.begin("missing", "/repo", []);
tracker.bind("missing", missing, "missing");
completed("missing", "missing", "newUnrecognizedStatus");
assert.equal(run("missing").status, "unknown");
const hydrationRace = tracker.begin("race", "/repo", []);
tracker.bind("race", hydrationRace, "race-turn");
event("item/completed", "race", "race-turn", { item: { id: "final-item", type: "agentMessage", text: "完整终稿" } });
tracker.hydrate("race", "/repo", [], [{ id: "race-turn", status: "inProgress", items: [{ id: "final-item", type: "agentMessage", text: "旧部分文本" }] }]);
completed("race", "race-turn", "completed", []);
assert.equal(run("race-turn").text, "完整终稿", "nonterminal history cannot erase an already completed message");
assert.ok(run("race-turn").startedAt > 1_000_000_000_000, "live reviews carry a millisecond start time");
tracker.hydrate("timestamps", "/repo", [], [
  { id: "seconds", startedAt: 1_700_000_000, status: "completed", items: [{ type: "userMessage", text: reviewPrompt }] },
  { id: "milliseconds", startedAt: 1_700_000_000_123, status: "completed", items: [{ type: "userMessage", text: reviewPrompt }] },
  { id: "no-time", status: "completed", items: [{ type: "userMessage", text: reviewPrompt }] },
]);
assert.equal(run("seconds").startedAt, 1_700_000_000_000);
assert.equal(run("milliseconds").startedAt, 1_700_000_000_123);
assert.equal(run("no-time").startedAt, null, "history cannot be dated as if it had just started");
assert.ok(updates > 0);
console.log("Review result controller: early events, identity, terminal states, last message, history, disconnect and concurrency passed");
