import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = fs.readFileSync("src/cloudDraftResume.ts", "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const wire = context => JSON.parse(JSON.stringify(exports.cloudDraftResumeParams(context)));
const base = {
  threadId: "thread-A", path: null, includeServiceTier: false, reuseRunningThread: false,
  prepared: { modelProvider: "provider-from-preference", cwd: "/workspace/server", serviceTier: null,
    baseInstructions: "fixture-base", developerInstructions: "fixture-developer", personality: "friendly",
    config: { approval_policy: "never", approvals_reviewer: "user", sandbox_mode: "danger-full-access", sandbox_workspace_write: { writable_roots: ["D:/local"] },
      permissions: "local", default_permissions: "local", profile: "local", "profiles.local": { model: "local" }, network_requirements: {}, auto_review: true,
      "features.guardian_approval": true, "features.guardianv2.extra": true, "features.request_permissions_tool": true,
      "features.other": true, personality: "friendly" } },
};
const expected = { threadId: "thread-A", history: null, path: null, model: null, modelProvider: "provider-from-preference",
  cwd: "/workspace/server", baseInstructions: "fixture-base", developerInstructions: "fixture-developer", personality: "friendly",
  excludeTurns: true, config: { "features.other": true, personality: "friendly" } };
assert.deepEqual(wire(base), expected);
assert.deepEqual(wire({ ...base, includeServiceTier: true }), { ...expected, serviceTier: null });
assert.deepEqual(wire({ ...base, includeServiceTier: true, prepared: { ...base.prepared, serviceTier: "fast" } }), { ...expected, serviceTier: "fast" });

const reused = wire({ ...base, reuseRunningThread: true });
assert(!Object.hasOwn(reused, "baseInstructions") && !Object.hasOwn(reused, "developerInstructions") && !Object.hasOwn(reused, "config"));
assert.equal(reused.personality, "friendly");
const nullable = wire({ ...base, prepared: { modelProvider: null, cwd: null, personality: null, baseInstructions: null, developerInstructions: null, config: { feature: null, features: { guardianv2: true } } } });
assert.deepEqual(nullable, { threadId: "thread-A", history: null, path: null, model: null, modelProvider: null, cwd: null, personality: null, excludeTurns: true });
const features = wire({ ...base, prepared: { config: { features: { guardian_approval: true, guardianv2: true, request_permissions_tool: true, retained: false }, other: null } } });
assert.deepEqual(features.config, { features: { retained: false }, other: null });
assert.equal(base.prepared.config.approval_policy, "never", "preparation is not mutated by serialization");
console.log("PASS cloud draft resume wire: official field shape, null/omitted tier, idle reuse, instruction omission and server permission defaults");

function load(path, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, crypto: { randomUUID }, require: name => imports[name], ...globals });
  return exports;
}

const identity = { accountId: "account-A", userId: "user-A", generation: 3 };
const calls = [];
let result;
let responseIdentity = identity;
let hostId = "durable";
let receipt = { draft_id: "draft-A", environment_id: "environment-A", thread_id: "thread-A" };
let creationCount = 0;
const saves = [];
let savedBody;
const service = load("src/chatgptService.ts", {
  "./bridge": { tauriInvoke: async (command, { request }) => {
    if (command === "chatgpt_service_cancel") return true;
    if (command === "cloud_service_save_draft") {
      const { requestId, ...params } = request;
      saves.push(JSON.parse(JSON.stringify(params)));
      return { requestId, identity: responseIdentity, body: savedBody };
    }
    if (command === "cloud_service_create_draft") {
      creationCount++;
      assert.equal(request.configId, "config-A");
      assert.deepEqual(request.expectedIdentity, identity);
      return { requestId: request.requestId, identity: responseIdentity, receipt };
    }
    assert.equal(command, "cloud_service_thread");
    assert.deepEqual(request.expectedIdentity, identity);
    calls.push(JSON.parse(JSON.stringify(request.operation)));
    return { requestId: request.requestId, identity: responseIdentity, hostId, body: result(request.operation) };
  } },
  "./sitesService": {}, "./remoteReview": {},
});
const { readCloudDraftHistory } = load("src/cloudDraftHistory.ts", { "./chatgptService": service });
const signal = new AbortController().signal;
const options = { cursor: null, turnLimit: 5, itemLimit: 98 };
result = ({ kind, turnId, cursor }) => {
  if (kind === "turns") return { data: [{ id: "newer" }, { id: "older" }], nextCursor: "older-turns" };
  if (turnId === "older") return { data: [], nextCursor: null };
  if (!cursor) return { data: [{ turnId, item: { id: "item-2" }, startedAtMs: 20, completedAtMs: 30 }], nextCursor: "page-2" };
  return { data: [{ id: "item-2" }, { id: "item-1" }], nextCursor: null };
};
const history = await readCloudDraftHistory("thread-A", identity, signal, options);
assert.deepEqual(calls, [
  { kind: "turns", threadId: "thread-A", cursor: null, limit: 5 },
  { kind: "items", threadId: "thread-A", turnId: "newer", cursor: null, limit: 98 },
  { kind: "items", threadId: "thread-A", turnId: "newer", cursor: "page-2", limit: 97 },
  { kind: "items", threadId: "thread-A", turnId: "older", cursor: null, limit: 98 },
]);
assert.equal(history.olderCursor, "older-turns");
assert.equal(history.turns[0].turn.id, "older");
assert.deepEqual(JSON.parse(JSON.stringify(history.turns[1].turn.items)), [{ id: "item-1" }, { id: "item-2", startedAtMs: 20 }]);
assert(history.turns[1].completedItemIds.has("item-2"));
assert.equal(history.turns[1].turn.itemsView, "full");
result = ({ kind }) => kind === "turns" ? { data: [{ id: "turn-A" }] } : { data: [{ id: "newest" }], nextCursor: "older-items" };
const partial = await readCloudDraftHistory("thread-A", identity, signal, { ...options, itemLimit: 1 });
assert.equal(partial.turns[0].turn.itemsView, "summary");
assert.equal(partial.turns[0].pagination.olderCursor, "older-items");
await assert.rejects(readCloudDraftHistory("thread-A", identity, signal, options), /重复游标/);
responseIdentity = { ...identity, generation: 4 };
await assert.rejects(readCloudDraftHistory("thread-A", identity, signal, options), /账号发生变化/);
responseIdentity = identity;
hostId = "local";
await assert.rejects(service.callCloudThread({ kind: "resume", params: expected }, identity, signal), /宿主不匹配/);
console.log("PASS durable draft history over IPC: scoped requests, wrapped items, order, deduplication, cursor progress and stale responses");

hostId = "durable";
const storage = new Map();
const bindings = load("src/cloudDraftBindings.ts", { "./chatgptService": service, "./cloudEnvironmentService": {} }, {
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
});
const delays = [];
let abortOnWait;
const { createCloudDraftSession, restoreCloudDraftSession } = load("src/cloudDraftSession.ts", {
  "./chatgptService": service, "./cloudDraftBindings": bindings,
  "./cloudDraftResume": exports, "./cloudDraftHistory": { readCloudDraftHistory },
}, {
  AbortController,
  setTimeout: (callback, delay) => { delays.push(delay); queueMicrotask(() => abortOnWait ? abortOnWait() : callback()); return 1; },
  clearTimeout: () => {},
});
result = operation => {
  assert.equal(operation.kind, "title");
  assert(bindings.readCloudDraftBinding(operation.threadId, identity), "binding must be stored before the title request");
  return new Promise(() => {});
};
const { session, persisted } = await createCloudDraftSession({ id: "config-A", name: "云环境" }, {}, identity, signal);
assert(persisted);
assert.equal(session.threadId, "thread-A");
assert.deepEqual(calls.at(-1), { kind: "title", threadId: "thread-A", name: "编辑 云环境" });
receipt = { ...receipt, thread_id: null };
await assert.rejects(createCloudDraftSession({ id: "config-A", name: "云环境" }, {}, identity, signal), { code: "cloud_draft_unconfirmed" });
assert.equal(calls.at(-1).kind, "title");

const prepared = async ({ metadata, preferences }) => {
  assert.equal(metadata.thread.id, "thread-A");
  assert.equal(preferences.config.personality, "friendly");
  return base;
};
function restoreFixture(errors) {
  return operation => {
    if (operation.kind === "read") return { thread: { id: "thread-A" } };
    if (operation.kind === "preferences") return { config: { personality: "friendly" } };
    if (operation.kind === "turns") return { data: [], nextCursor: null };
    assert.equal(operation.kind, "resume");
    if (errors.length) throw { code: errors.shift() };
    return { thread: { id: "thread-A" } };
  };
}
calls.length = 0;
result = restoreFixture(["cloud_resume_timeout", "cloud_thread_closing", "cloud_resume_timeout"]);
const restored = await restoreCloudDraftSession(session, prepared, options, signal);
assert.equal(restored.response.thread.id, "thread-A");
assert.deepEqual(calls.slice(0, 2).map(op => op.kind), ["read", "preferences"]);
const attempts = calls.filter(op => op.kind === "resume");
assert.deepEqual(attempts.map(op => op.timeoutSeconds), [120, 240, 240, 480]);
assert(attempts.every(op => JSON.stringify(op.params) === JSON.stringify(attempts[0].params)));
assert.deepEqual(delays, [750, 750, 750]);
result = restoreFixture(Array(5).fill("cloud_thread_closing"));
await assert.rejects(restoreCloudDraftSession(session, prepared, options, signal), { code: "cloud_thread_closing" });
assert.deepEqual(delays.slice(-4), [750, 1500, 3000, 6000]);
const historyFailure = Error("history unavailable");
const resumeAfterHistoryFailure = restoreFixture(["cloud_resume_timeout"]);
result = operation => {
  if (operation.kind === "turns") throw historyFailure;
  return resumeAfterHistoryFailure(operation);
};
calls.length = 0;
await assert.rejects(restoreCloudDraftSession(session, prepared, options, signal), historyFailure);
assert.deepEqual(calls.filter(op => op.kind === "resume").map(op => op.timeoutSeconds), [120, 240]);
const cancel = new AbortController();
abortOnWait = () => cancel.abort();
calls.length = 0;
result = restoreFixture(["cloud_resume_timeout"]);
await assert.rejects(restoreCloudDraftSession(session, prepared, options, cancel.signal), { name: "AbortError" });
assert.equal(calls.filter(op => op.kind === "resume").length, 1);
assert.equal(creationCount, 2, "resume retries must not issue draft creation requests");
console.log("PASS cloud draft session: confirmed receipt precedes nonblocking title, bounded resume retries and cancellation without duplicate creation");

const environment = load("src/cloudEnvironmentService.ts", { "./chatgptService": service });
const { saveBoundDraftScripts } = load("src/cloudDraftScripts.ts", { "./chatgptService": service, "./cloudEnvironmentService": environment });
const binding = session.binding;
const draftBody = (id = binding.draftId) => ({
  id: binding.configId, name: binding.name, version_id: "v1", status: "ready", share_settings: "private",
  repositories: [], network_policy: { type: "disabled" },
  draft: { id, base_version_id: "v1", revision: 3, repositories: [], network_policy: { type: "disabled" }, start_skill: "retained" },
});
const baseline = { ...environment.parseCloudDetail(draftBody(), binding.configId, binding.draftId).draft, revision: 2, installScript: "old" };
const values = { installScript: "", startSkill: "retained" };
savedBody = draftBody();
const saved = await saveBoundDraftScripts(binding, baseline, values, identity, signal);
assert.equal(saved.draft.revision, 3);
assert.deepEqual(saves, [{ configId: binding.configId, draftId: binding.draftId, baseVersionId: "v1",
  expectedRevision: 2, installScript: "", expectedIdentity: identity }]);
await assert.rejects(saveBoundDraftScripts(binding, baseline, { ...values, installScript: "old" }, identity, signal), /没有更改/);
await assert.rejects(saveBoundDraftScripts(binding, baseline, values, { ...identity, userId: "other" }, signal), /不匹配/);
assert.equal(saves.length, 1);
savedBody = draftBody("wrong-draft");
await assert.rejects(saveBoundDraftScripts(binding, baseline, values, identity, signal), { code: "cloud_draft_save_unconfirmed" });
assert.equal(saves.length, 2, "malformed confirmed readback must not trigger another save");
console.log("PASS cloud draft save: changed fields only, explicit clear, no-op and identity rejection, malformed readback does not replay");
