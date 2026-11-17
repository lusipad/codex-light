import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const file = "src/workLocalThreadRestore.ts";
assert.ok(fs.existsSync(file), "Cold Work selection must have a real restore consumer, not ordinary resume");
const plain = value => JSON.parse(JSON.stringify(value));
const identity = { userId: "user", accountId: "account", generation: 3 };
const scope = { identity, hostIdentity: "local-host" };
const metadata = () => ({ thread: { id: "old-work", model: "old-model", reasoningEffort: "high", cwd: "D:/old-project",
  projectId: "old-project-id", originator: "codex_work_desktop", status: { type: "notLoaded" } } });
const proof = () => ({ threadId: "old-work", userId: identity.userId, accountId: identity.accountId, hostIdentity: scope.hostIdentity, serviceName: null });
function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => dependencies[name] ?? {}, Error, ...globals });
  return exports;
}
function fixture() {
  const calls = [], cacheCalls = [], actual = { identity: { ...identity }, current: true, proof: proof(), metadata: metadata() };
  const receipt = load("src/workThreadContext.ts"), provenance = load("src/workThreadProvenance.ts", { "./bridge": {
    tauriInvoke: async (command, args) => { calls.push([command, plain(args)]); if (command === "desktop_state_get") return actual.proof; actual.proof = args.value; },
  } });
  const execution = { status: "ready", identity, settings: { effectiveDetail: "STEPS_PROSE" }, defaultEnableFeatures: { writing_blocks: true }, values: {} };
  const api = load(file, {
    "./bridge": { callAppServer: async (method, params) => { calls.push([method, plain(params)]); await actual.after?.(method);
      if (method === "thread/read") return actual.metadata;
      assert.equal(method, "thread/resume"); if (actual.resumeError) throw Error("resume failed");
      return { thread: { ...actual.metadata.thread, status: { type: "idle" } }, model: "confirmed-model", reasoningEffort: "medium",
        cwd: "D:/old-project", approvalPolicy: "on-request", sandbox: { type: "readOnly" } }; } },
    "./chatgptService": { serviceIdentity: async () => ({ ...actual.identity }), readWorkHeartbeatRegistry: async (_id, threadId) => {
      calls.push(["heartbeat", threadId]); if (actual.registryError) throw Error("registry unreadable");
      return { status: "ready", enabled: true, automations: actual.heartbeat ? [{ kind: "heartbeat", status: "ACTIVE", targetThreadId: threadId }] : [] }; } },
    "./workAccess": { readLocalWorkAccess: async () => ({ identity, combined: { status: "allowed" }, base: { local: { status: "allowed" } } }) },
    "./workExecutionPreparation": { readWorkExecutionPreparation: async input => { calls.push(["execution", plain(input)]); await actual.after?.("execution"); return execution; } },
    "./workDeveloperPreparation": { readWorkThreadDeveloperPreparation: async (context, options) => {
      calls.push(["developer", plain(context), plain(options)]); if (actual.developerError) return { status: "not-ready", missingInputs: ["git-settings"] };
      return { status: "ready", identity, unifiedCustomInstructionsEnabled: true, inputs: { threadId: options.threadId, heartbeatEnabled: options.heartbeatEnabled } }; } },
    "./workDeveloperInstructions": { buildWorkDeveloperInstructions: input => { calls.push(["assembler", plain(input)]); return `instructions:${input.threadId}:${input.heartbeatEnabled}:${input.customInstructions}`; } },
    "./workLocalRequest": { projectWorkLocalFeatureConfig: (features, existing) => ({ "features.fixture": true, ...existing }) },
    "./workThreadContext": receipt, "./workThreadProvenance": provenance,
  });
  const cache = { update: (...args) => cacheCalls.push(["update", ...plain(args)]), refreshOnce: () => cacheCalls.push(["refreshOnce"]),
    read: () => "cached account instruction" };
  const run = options => api.restoreWorkLocalThread({ threadId: "old-work", metadata: actual.metadata, hostIdentity: scope.hostIdentity,
    appServerVersion: "0.165.0", isCurrent: () => actual.current, ...options }, cache, new AbortController().signal);
  return { ...actual, actual, calls, cacheCalls, receipt, run };
}
{
  const f = fixture(); f.actual.heartbeat = true;
  const result = await f.run(); assert.equal(result.kind, "resumed");
  const request = f.calls.find(call => call[0] === "thread/resume")[1];
  assert.equal(request.cwd, "D:/old-project"); assert.equal(request.model, null);
  assert.equal(request.developerInstructions, "instructions:old-work:true:cached account instruction");
  for (const field of ["collaborationMode", "reasoningEffort", "serviceName"]) assert.equal(field in request, false);
  const execution = f.calls.find(call => call[0] === "execution")[1]; assert.equal(execution.cwd, "D:/old-project");
  const developer = f.calls.find(call => call[0] === "developer"); assert.equal(developer[1].model, "old-model");
  assert.equal(developer[2].threadId, "old-work");
  assert.equal(result.context.model, "confirmed-model"); assert.equal(result.context.collaborationMode.mode, "default");
  assert.equal(f.cacheCalls.filter(call => call[0] === "refreshOnce").length, 1);
}
{
  const f = fixture(); f.actual.metadata.thread.originator = "Codex Desktop"; // Non-prose is still proven by native provenance.
  assert.equal((await f.run()).kind, "resumed");
}
{
  const f = fixture(); f.actual.metadata.thread.model = null;
  assert.equal((await f.run()).kind, "resumed"); assert.equal(f.calls.find(call => call[0] === "developer")[1].model, null);
}
{
  const f = fixture(); f.actual.proof = null; f.actual.metadata.thread.originator = "Codex Desktop";
  assert.equal((await f.run()).kind, "ordinary"); assert.equal(f.calls.some(call => ["heartbeat", "execution", "thread/resume"].includes(call[0])), false);
}
for (const mismatch of ["accountId", "userId", "hostIdentity", "threadId"]) {
  const f = fixture(); f.actual.proof[mismatch] = "other";
  await assert.rejects(() => f.run()); assert.equal(f.calls.some(call => call[0] === "thread/resume"), false);
}
for (const failure of ["registryError", "developerError", "resumeError"]) {
  const f = fixture(); f.actual[failure] = true;
  await assert.rejects(() => f.run());
  assert.equal(f.calls.filter(call => call[0] === "thread/resume").length, failure === "resumeError" ? 1 : 0);
}
for (const stale of ["identity", "view"]) {
  const f = fixture(); f.actual.after = method => { if (method === "execution") {
    if (stale === "identity") f.actual.identity.generation++; else f.actual.current = false;
  } };
  await assert.rejects(() => f.run()); assert.equal(f.calls.some(call => call[0] === "thread/resume"), false);
}
for (const stale of ["identity", "view"]) {
  const f = fixture(); f.actual.after = method => { if (method === "thread/resume") {
    if (stale === "identity") f.actual.identity.generation++; else f.actual.current = false;
  } };
  await assert.rejects(() => f.run(), "a late resume ACK cannot publish a new Work context");
  assert.equal(f.calls.filter(call => call[0] === "thread/resume").length, 1);
}
{
  const f = fixture();
  await assert.rejects(() => f.run({ isPolicyCurrent: () => false }));
  assert.equal(f.calls.some(call => call[0] === "thread/resume"), false);
  f.actual.proof = null; f.actual.metadata.thread.originator = "Codex Desktop";
  await assert.rejects(() => f.run({ isPolicyCurrent: () => false }), "a previously read Work receipt remains Work even if disk proof disappears");
  const ordinary = fixture(); ordinary.actual.proof = null; ordinary.actual.metadata.thread.originator = "Codex Desktop";
  assert.equal((await ordinary.run({ isPolicyCurrent: () => false })).kind, "ordinary", "ordinary caller retains authoritative policy event reconciliation");
}
{
  const f = fixture(); f.actual.metadata.thread.status.type = "idle";
  const previous = f.receipt.captureWorkThreadContext(scope, { ...f.actual.metadata, collaborationMode: { mode: "plan", settings: {
    model: "old-model", reasoning_effort: "high", developer_instructions: null } } }, { serviceName: "codex_work_desktop" }).context;
  const result = await f.run({ previous }); assert.equal(result.kind, "loaded"); assert.equal(result.context.collaborationMode.mode, "plan");
  assert.equal(f.calls.some(call => ["heartbeat", "execution", "thread/resume"].includes(call[0])), false, "already loaded mode is not needlessly resumed or replaced");
  assert.equal((await f.run({ previous, forceResume: true })).kind, "resumed");
}
{
  const calls = []; let invalid, controller;
  const api = load("src/chatgptService.ts", { "./bridge": { tauriInvoke: async (command, args) => {
    calls.push([command, plain(args)]); if (command === "chatgpt_service_cancel") return;
    controller?.abort();
    return { requestId: "request-1", identity, enabled: true, automations: [
      { kind: "heartbeat", status: "ACTIVE", targetThreadId: "old-work" },
    ], ...invalid };
  } } }, { crypto: { randomUUID: () => "request-1" } });
  const registry = await api.readWorkHeartbeatRegistry(identity, "old-work", new AbortController().signal);
  assert.equal(registry.status, "ready"); assert.equal(registry.automations.length, 1);
  assert.deepEqual(calls[0], ["work_heartbeat_read", { request: { requestId: "request-1", expectedIdentity: identity }, threadId: "old-work" }]);
  for (const value of [{ requestId: "wrong" }, { identity: { ...identity, generation: 4 } }, { enabled: null },
    { automations: null }, { automations: [{ kind: "heartbeat", status: "ACTIVE", targetThreadId: "other" }] }]) {
    invalid = value; await assert.rejects(() => api.readWorkHeartbeatRegistry(identity, "old-work", new AbortController().signal));
  }
  invalid = undefined; controller = new AbortController();
  await assert.rejects(() => api.readWorkHeartbeatRegistry(identity, "old-work", controller.signal), /取消/);
  assert.ok(calls.some(call => call[0] === "chatgpt_service_cancel"));
}
console.log("PASS real Work cold-restore consumer and native registry wrapper: old cwd/model, non-prose durable provenance, null model, current registry/instructions, schema-only resume, real ACK mode, loaded skip, ordinary isolation, owner/host/cancel/error fences; offline only");
