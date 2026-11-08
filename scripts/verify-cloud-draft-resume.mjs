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
const configRequests = [];
let configReceipt = { config_id: "config-new", name: "Fixture", version_id: "v1", environment_id: null, thread_id: null,
  draft_id: null, onboarding_skill: null };
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
    if (command === "cloud_service_create_config") {
      const { requestId, ...fields } = request;
      configRequests.push(JSON.parse(JSON.stringify(fields)));
      return { requestId, identity: responseIdentity, receipt: configReceipt };
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
const initialConfigReceipt = configReceipt;
const selected = [{ repositoryId: "repo-new", ref: "main" }];
assert.equal(await service.createCloudEnvironmentConfig("Fixture", selected, identity, signal), initialConfigReceipt);
assert.deepEqual(configRequests, [{ name: "Fixture", repositories: selected, expectedIdentity: identity }]);
configReceipt = { ...initialConfigReceipt, config_id: "" };
await assert.rejects(service.createCloudEnvironmentConfig("Fixture", [], identity, signal), { code: "cloud_config_unconfirmed" });
configReceipt = initialConfigReceipt;
responseIdentity = { ...identity, generation: identity.generation + 1 };
await assert.rejects(service.createCloudEnvironmentConfig("Fixture", [], identity, signal), /账号发生变化/);
responseIdentity = identity;
const abortedConfig = new AbortController();
abortedConfig.abort();
await assert.rejects(service.createCloudEnvironmentConfig("Fixture", [], identity, abortedConfig.signal), /请求已取消/);
assert.equal(configRequests.length, 3);
console.log("PASS cloud configuration creation bridge: fixed input, real receipt, malformed response, identity and cancellation");
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
const network = load("src/cloudDraftNetwork.ts", {});
let metadataReadback;
const fields = load("src/cloudDraftFields.ts", {
  "./chatgptService": service, "./cloudEnvironmentService": environment, "./cloudDraftNetwork": network,
  "./cloudDraftBindings": { readBoundCloudDraft: async () => metadataReadback },
});
const { saveBoundDraftFields, draftFieldChanges, draftFieldsMatch, saveBoundDraftMetadata,
  draftMetadataValues, compareDraftMetadata } = fields;
const binding = session.binding;
const draftBody = (id = binding.draftId) => ({
  id: binding.configId, name: binding.name, version_id: "v1", status: "ready", share_settings: "private",
  repositories: [], network_policy: { type: "disabled" },
  draft: { id, base_version_id: "v1", revision: 3, repositories: [], network_policy: { type: "disabled" }, start_skill: "retained" },
});
const baseline = { ...environment.parseCloudDetail(draftBody(), binding.configId, binding.draftId).draft, revision: 2, installScript: "old" };
const values = { installScript: "", startSkill: "retained", network: baseline.network, repositories: baseline.repositories };
savedBody = draftBody();
const saved = await saveBoundDraftFields(binding, baseline, values, identity, signal);
assert.equal(saved.draft.revision, 3);
assert.deepEqual(saves, [{ configId: binding.configId, draftId: binding.draftId, baseVersionId: "v1",
  expectedRevision: 2, installScript: "", expectedIdentity: identity }]);
await assert.rejects(saveBoundDraftFields(binding, baseline, { ...values, installScript: "old" }, identity, signal), /没有更改/);
await assert.rejects(saveBoundDraftFields(binding, baseline, values, { ...identity, userId: "other" }, signal), /不匹配/);
assert.equal(saves.length, 1);
savedBody = draftBody("wrong-draft");
await assert.rejects(saveBoundDraftFields(binding, baseline, values, identity, signal), { code: "cloud_draft_save_unconfirmed" });
assert.equal(saves.length, 2, "malformed confirmed readback must not trigger another save");
console.log("PASS cloud draft save: changed fields only, explicit clear, no-op and identity rejection, malformed readback does not replay");

for (const [raw, normalized] of [[" *.Example.COM. ", "*.example.com"], ["192.0.2.1", "192.0.2.1"], ["*", "*"]])
  assert.equal(network.networkDomainEntry(raw, []).host, normalized);
for (const raw of ["https://example.com", "example.com:8080", "-bad", "192.1", "0x0a", "192.0.2.001", "*.192.0.2.1", "a".repeat(64)])
  assert.ok(network.networkDomainEntry(raw, []).error, raw);
assert.ok(network.networkDomainEntry("EXAMPLE.COM.", ["example.com"]).error);
const original = { ...values, installScript: "old" };
const restricted = { ...original, network: { type: "restricted", packageManagers: true, hosts: ["*.example.com", "192.0.2.1"] } };
const reversed = { ...restricted, network: { ...restricted.network, hosts: [...restricted.network.hosts].reverse() } };
const policy = { type: "restricted", presets: ["package_managers"], egress_rules: [{ host: "*.example.com" }, { host: "192.0.2.1" }] };
savedBody = draftBody();
savedBody.draft.network_policy = policy;
const updated = await saveBoundDraftFields(binding, baseline, restricted, identity, signal);
assert.deepEqual(saves.at(-1), { configId: binding.configId, draftId: binding.draftId, baseVersionId: "v1",
  expectedRevision: 2, networkPolicy: policy, expectedIdentity: identity });
assert.equal(updated.draft.network.type, "restricted");
assert.equal(Object.keys(draftFieldChanges(restricted, reversed)).length, 0);
assert(draftFieldsMatch(original, restricted, reversed));
assert(!draftFieldsMatch(original, restricted, { ...reversed, network: { ...reversed.network, packageManagers: false } }));
assert.equal(draftFieldChanges(restricted, original).networkPolicy.type, "disabled");
assert.equal(draftFieldChanges(restricted, { ...restricted, network: { ...restricted.network, type: "unrestricted" } }).networkPolicy.type, "unrestricted");
console.log("PASS cloud network: official hostname vectors, exact network-only IPC, order-independent readback and mode changes");

const root = environment.parseCloudDetail(draftBody(), binding.configId, binding.draftId);
const metadataBase = draftMetadataValues(root);
const metadataEdit = { ...metadataBase, name: "  新名称  ", description: "说明", shareSettings: "workspace" };
metadataReadback = root;
savedBody = { ...draftBody(), name: "新名称", description: "说明", share_settings: "workspace" };
const changed = await saveBoundDraftMetadata(binding, root.draft, metadataBase, metadataEdit, identity, signal);
assert.deepEqual(saves.at(-1), { configId: binding.configId, draftId: binding.draftId, baseVersionId: "v1", expectedRevision: 3,
  expectedIdentity: identity, metadata: { name: "新名称", description: "说明", shareSettings: "workspace" } });
assert.equal(compareDraftMetadata(metadataBase, metadataEdit, draftMetadataValues(changed)), "applied");
const saveCount = saves.length;
metadataReadback = changed;
assert.equal(await saveBoundDraftMetadata(binding, root.draft, metadataBase, metadataEdit, identity, signal), changed);
metadataReadback = { ...root, description: "并发修改" };
await assert.rejects(saveBoundDraftMetadata(binding, root.draft, metadataBase, metadataEdit, identity, signal), { code: "conflict" });
metadataReadback = { ...root, draft: { ...root.draft, revision: 4 } };
await assert.rejects(saveBoundDraftMetadata(binding, root.draft, metadataBase, metadataEdit, identity, signal), { code: "conflict" });
assert.equal(saves.length, saveCount, "preflight must not replay applied or conflicting metadata");
console.log("PASS cloud root metadata: exact field differences, trimmed name, preflight conflict and already-applied handling");

const currentRepositories = [{ id: "github-existing", ref: "pinned", depth: 3 }, { id: "github-old", ref: "stable" }];
const selectedRepositories = [currentRepositories[0], { id: "github-new", ref: "release" }];
const beforeRepositories = { ...original, repositories: currentRepositories };
const afterRepositories = { ...original, repositories: selectedRepositories };
savedBody = draftBody();
savedBody.draft.repositories = [{ repository_id: "github-new", ref: "release" }, { repository_id: "github-existing", ref: "pinned", depth: 3 }];
const repositoryResult = await saveBoundDraftFields(binding, { ...baseline, repositories: currentRepositories }, afterRepositories, identity, signal);
assert.deepEqual(saves.at(-1), {
  configId: binding.configId, draftId: binding.draftId, baseVersionId: "v1", expectedRevision: 2, expectedIdentity: identity,
  repositories: [{ repository_id: "github-existing", ref: "pinned", depth: 3 }, { repository_id: "github-new", ref: "release" }],
});
const confirmedFields = { ...afterRepositories, repositories: repositoryResult.draft.repositories };
assert(draftFieldsMatch(beforeRepositories, afterRepositories, confirmedFields));
assert.equal(Object.keys(draftFieldChanges(afterRepositories, confirmedFields)).length, 0);
assert(!draftFieldsMatch(beforeRepositories, afterRepositories, { ...confirmedFields, repositories: [{ ...selectedRepositories[0], depth: 1 }, selectedRepositories[1]] }));
assert.equal(draftFieldChanges(afterRepositories, { ...afterRepositories, repositories: [] }).repositories.length, 0);
const olderData = { ...beforeRepositories, repositories: [currentRepositories[0], currentRepositories[0]] };
assert.deepEqual(JSON.parse(JSON.stringify(draftFieldChanges(olderData, { ...olderData, startSkill: "changed" }))), { startSkill: "changed" });
console.log("PASS cloud draft repositories: exact payload, retained ref and depth, reordered readback and explicit clear");

let notify;
let stopped = 0;
let finishRegistration;
const liveReads = [];
const liveHistory = load("src/cloudDraftHistory.ts", {
  "./bridge": { tauriListen: async (name, handler) => {
    assert.equal(name, "cloud-app-server:notification");
    notify = handler;
    if (finishRegistration) await new Promise(resolve => { finishRegistration = resolve; });
    return () => { stopped++; };
  } },
  "./chatgptService": { callCloudThread: (operation, owner, active) => {
    assert.equal(operation.threadId, "thread-A");
    assert.equal(operation.cursor, null);
    assert.equal(owner, identity);
    if (operation.kind === "items") return Promise.resolve({ data: [{ id: `${operation.turnId}-message` }] });
    assert.equal(operation.kind, "turns");
    return new Promise((resolve, reject) => liveReads.push({ resolve, reject, active }));
  } },
});
const snapshot = (ids, olderCursor = null) => ({ turns: ids.map(id => ({ turn: { id, items: [] } })), olderCursor });
const event = { hostId: "durable", identity, method: "turn/completed", params: { threadId: "thread-A" } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const lifetime = new AbortController();
const seen = [];
const errors = [];
let liveSnapshot = snapshot(["old", "current"], "older");
let initialReady;
const watching = liveHistory.watchCloudDraftHistory("thread-A", identity, lifetime.signal,
  () => new Promise(resolve => { initialReady = resolve; }), options, {
    onInitial: value => { liveSnapshot = value; seen.push("initial"); },
    onRefresh: value => { liveSnapshot = liveHistory.mergeCloudDraftHistory(liveSnapshot, value); seen.push("refresh"); },
    onRefreshError: error => errors.push(error),
  });
await tick();
notify(event);
assert.equal(liveReads.length, 0, "event before restore must wait for its history snapshot");
initialReady(liveSnapshot);
const refresh = await watching;
assert.equal(liveReads.length, 1);
for (const foreign of [{ ...event, hostId: "local" }, { ...event, identity: { ...identity, generation: 2 } },
  { ...event, identity: { ...identity, userId: "foreign" } }, { ...event, params: { threadId: "other" } },
  { ...event, method: "item/started" }]) notify(foreign);
liveReads[0].resolve({ data: [] });
await tick();
assert.equal(liveReads.length, 1, "foreign events must not schedule a refresh");
assert.deepEqual(liveSnapshot.turns.map(({ turn }) => turn.id), ["old", "current"], "transient empty response retains visible history");
notify({ ...event, method: "turn/started" });
notify(event);
notify(event);
assert.equal(liveReads.length, 2, "events during refresh must coalesce");
liveReads[1].reject(Error("transient"));
await tick();
assert.equal(errors.length, 1);
assert.equal(liveReads.length, 3, "queued completion must survive refresh failure");
liveReads[2].resolve({ data: [{ id: "new" }, { id: "current" }] });
await tick();
assert.equal(JSON.stringify(liveSnapshot.turns.map(({ turn }) => turn.id)), '["old","current","new"]');
assert.equal(liveSnapshot.turns.at(-1).turn.items[0].id, "new-message");
refresh();
assert.equal(liveReads.length, 4, "manual retry refreshes without another resume");
lifetime.abort();
assert.equal(stopped, 1);
assert(liveReads[3].active.aborted);
liveReads[3].resolve({ data: [] });
notify(event);
await tick();
assert.deepEqual(seen, ["initial", "refresh", "refresh"]);
assert.equal(liveReads.length, 4);
const replacement = liveHistory.mergeCloudDraftHistory(snapshot(["old", "current"], "older"), snapshot(["current", "new"], "server-cursor"));
assert.equal(JSON.stringify(replacement), JSON.stringify(snapshot(["old", "current", "new"], "older")));
const lagged = liveHistory.mergeCloudDraftHistory(replacement, snapshot(["old", "current"], "server-cursor"));
assert.equal(JSON.stringify(lagged), JSON.stringify(replacement));
const disjoint = snapshot(["distant-new"], "gap");
assert.equal(liveHistory.mergeCloudDraftHistory(replacement, disjoint), disjoint);

const registering = new AbortController();
finishRegistration = true;
const registration = liveHistory.watchCloudDraftHistory("thread-A", identity, registering.signal,
  () => assert.fail("aborted registration must not resume"), options, {});
registering.abort();
finishRegistration();
await assert.rejects(registration, { name: "AbortError" });
assert.equal(stopped, 2, "late registration must release its listener");
console.log("PASS cloud draft live history: listener-before-resume, scoped notification bursts, refresh retry, pagination preservation and cancellation");

const journal = new Map();
const applyCalls = [];
let lockTail = Promise.resolve(), status = "active", startFailure, savedFailure, failStorage = false;
let currentDraft;
const applySession = { ...session, identity, threadId: "apply-thread" };
const repositoryBaseline = { ...baseline, repositories: currentRepositories };
const applyValues = { ...fields.draftFieldValues(repositoryBaseline), repositories: selectedRepositories };
const applyStorage = {
  getItem: key => journal.get(key) ?? null,
  setItem: (key, value) => { if (failStorage) throw Error("storage unavailable"); journal.set(key, value); },
  removeItem: key => journal.delete(key),
};
const journalState = () => JSON.parse([...journal.values()][0] ?? "null");
const bindingsForApply = {
  rememberCloudDraftBinding: () => true,
  listCloudDraftBindings: (configId, owner) => configId === binding.configId && owner.accountId === identity.accountId
    ? [[applySession.threadId, binding]] : [],
  readBoundCloudDraft: async () => ({ draft: currentDraft }),
};
const application = load("src/cloudDraftRepositoryApply.ts", {
  "./chatgptService": { callCloudThread: async (operation, owner) => {
    assert.equal(owner, identity);
    if (operation.kind === "read") return { thread: { id: operation.threadId, status: { type: status } } };
    assert.equal(journalState().state, "unconfirmed");
    applyCalls.push(operation);
    if (startFailure) throw startFailure;
    return { turn: { id: "accepted-turn" } };
  } },
  "./cloudDraftBindings": bindingsForApply,
  "./cloudDraftFields": { ...fields, saveBoundDraftFields: async (...args) => {
    assert.equal(journalState().state, "saving");
    if (savedFailure) throw savedFailure;
    const value = await saveBoundDraftFields(...args);
    currentDraft = value.draft;
    return value;
  } },
}, { localStorage: applyStorage, navigator: { locks: { request: (_key, { signal: active }, work) => {
  const operation = lockTail.then(() => { active.throwIfAborted(); return work(); });
  lockTail = operation.catch(() => {});
  return operation;
} } } });
const stageRepositories = () => application.saveDraftWithRepositoryApply(applySession, repositoryBaseline, applyValues,
  { "github-new": "org/new", "github-old": "org/old" }, signal);
const readyHistory = { turns: [{ turn: { id: "last", status: "completed", items: [{ type: "agentMessage" }] } }] };
const advanceApply = (history = readyHistory, retry = false) => application.advanceRepositoryApply(applySession, history, retry, signal);
failStorage = true;
const beforeApplySaves = saves.length;
await assert.rejects(stageRepositories(), /storage unavailable/);
assert.equal(saves.length, beforeApplySaves, "storage failure must not dispatch a write");
failStorage = false;
await stageRepositories();
const firstApplyId = journalState().id;
assert.equal(application.pendingRepositoryApplySession(binding.configId, identity).threadId, applySession.threadId);
assert.equal(application.pendingRepositoryApplySession(binding.configId, { ...identity, accountId: "other" }), null);
assert.equal(await advanceApply(), "queued");
assert.equal(applyCalls.length, 0);
status = "idle";
assert.equal(await advanceApply({ turns: [{ turn: { status: "interrupted", items: [] } }] }), "paused");
assert.equal(await advanceApply(), "paused");
assert.deepEqual(await Promise.all([advanceApply(readyHistory, true), advanceApply(readyHistory, true)]), ["sent", null]);
assert.equal(applyCalls.length, 1);
assert.equal(applyCalls[0].clientUserMessageId, firstApplyId);
assert.equal(JSON.stringify(applyCalls[0].added), '["org/new"]');
assert.equal(JSON.stringify(applyCalls[0].removed), '["org/old"]');
assert.equal(saves.length, beforeApplySaves + 1, "message retry must not rewrite the draft");

await stageRepositories();
const unknownApplyId = journalState().id;
startFailure = { code: "cloud_repository_apply_unconfirmed" };
assert.equal(await advanceApply(), "unconfirmed");
assert.equal(await advanceApply({ turns: [{ turn: { items: [{ type: "userMessage", clientId: "other-id" }] } }] }, true), "unconfirmed");
assert.equal(applyCalls.length, 2, "ambiguous delivery must never be replayed");
assert.equal(await advanceApply({ turns: [{ turn: { items: [{ type: "userMessage", clientId: unknownApplyId }] } }] }), "sent");

savedFailure = { code: "cloud_draft_save_unconfirmed" };
await assert.rejects(stageRepositories(), { code: "cloud_draft_save_unconfirmed" });
assert.equal(journalState().state, "saving");
currentDraft = repositoryBaseline;
assert.equal(await advanceApply(), "saving");
currentDraft = { ...repositoryBaseline, revision: repositoryBaseline.revision + 1, repositories: selectedRepositories };
startFailure = { code: "desktop_context_unavailable" };
assert.equal(await advanceApply(), "retry");
assert.equal(await advanceApply(), "retry");
startFailure = undefined;
currentDraft = { ...currentDraft, repositories: currentRepositories };
assert.equal(await advanceApply(readyHistory, true), "obsolete");
assert.equal(applyCalls.length, 3, "reverted changes must not send obsolete work");
assert.equal(journal.size, 0);
await assert.rejects(stageRepositories(), { code: "cloud_draft_save_unconfirmed" });
currentDraft = { ...repositoryBaseline, revision: repositoryBaseline.revision + 1 };
assert.equal(await advanceApply(), "superseded");
assert.equal(journal.size, 0);
assert.equal(applyCalls.length, 3, "a new revision with a different selection must not wake the saved message");
console.log("PASS cloud repository save and apply: journal-before-write, restart binding, queue, interruption, single dispatch, UUID recovery and obsolete filtering");
