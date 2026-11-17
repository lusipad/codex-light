import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
assert.ok(fs.existsSync("src/workThreadContext.ts"), "Work threads need an owner-bound continuation receipt");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/workThreadContext.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });
const scope = { identity: { userId: "u", accountId: "a", generation: 4 }, hostIdentity: "local:connection-1" };
const mode = { mode: "default", settings: { model: "actual-work-model", reasoning_effort: "high", developer_instructions: null } };
const response = { thread: { id: "thread-1", originator: "codex_work_desktop", model: "actual-work-model", reasoningEffort: "high", cwd: "C:/project", projectId: "canonical-project" },
  model: "actual-work-model", reasoningEffort: "high", cwd: "C:/project", collaborationMode: mode };
const created = api.captureWorkThreadContext(scope, response, { serviceName: "codex_work_desktop" });
assert.deepEqual(Array.from(created.missingInputs), []);
assert.equal(created.context.threadId, "thread-1");
assert.equal(created.context.projectId, "canonical-project");
assert.equal(created.context.model, "actual-work-model");
const input = { scope, context: created.context, threadId: "thread-1", baseParams: { input: [{ type: "text", text: "follow-up" }], model: "home-model", effort: "low" } };
const follow = api.projectWorkThreadFollowUp(input);
assert.equal(follow.request.model, null); assert.equal(follow.request.effort, null);
assert.equal(follow.request.collaborationMode.settings.model, "actual-work-model");
assert.equal("serviceName" in follow.request, false);
assert.equal(input.baseParams.model, "home-model", "projection never rewrites the caller's ordinary parameters");
for (const patch of [{ identity: { ...scope.identity, accountId: "foreign" } }, { identity: { ...scope.identity, userId: "foreign" } },
  { identity: { ...scope.identity, generation: 5 } }, { hostIdentity: "local:connection-2" }]) {
  assert.equal(api.projectWorkThreadFollowUp({ ...input, scope: { ...scope, ...patch } }).request, null);
}
assert.equal(api.projectWorkThreadFollowUp({ ...input, threadId: "other-thread" }).request, null);
const restored = api.restoreWorkThreadContext(scope, { thread: response.thread }, created.context);
assert.equal(restored.context.collaborationMode.settings.model, "actual-work-model");
assert.equal(restored.context.serviceName, "codex_work_desktop");
const external = api.restoreWorkThreadContext(scope, { thread: response.thread });
assert.ok(external.context, "actual persisted Work originator establishes Work provenance");
assert.equal(api.projectWorkThreadFollowUp({ ...input, context: external.context }).request, null, "originator alone does not supply a collaboration mode");
const unknown = api.restoreWorkThreadContext(scope, { thread: { ...response.thread, originator: null } });
assert.equal(unknown.context, null); assert.ok(unknown.missingInputs.includes("work-thread-provenance"));
const coding = api.captureWorkThreadContext(scope, { ...response, thread: { ...response.thread, originator: "codex" } }, { serviceName: null });
assert.ok(coding.context, "explicit local receipt covers Work without prose serviceName");
assert.equal(api.restoreWorkThreadContext(scope, { thread: { ...response.thread, originator: "codex" } }, coding.context).context.threadId, "thread-1");
assert.equal(api.restoreWorkThreadContext({ ...scope, hostIdentity: "different-host" }, response, created.context).context, null);
const nullMode = api.restoreWorkThreadContext(scope, { ...response, collaborationMode: null }, created.context);
assert.equal(nullMode.context.collaborationMode, null, "explicit unconfirmed mode cannot resurrect an older mode");
assert.equal(api.projectWorkThreadFollowUp({ ...input, context: nullMode.context }).request, null);
assert.equal(api.projectWorkThreadFollowUp({ ...input, collaborationMode: { ...mode, settings: { ...mode.settings, model: "home-model" } } }).request, null);
const partial = api.captureWorkThreadContext(scope, { thread: { id: "created-before-first-turn-failed" } }, { serviceName: null });
assert.ok(partial.context, "confirmed creation retains Work provenance even before its first turn/settings are confirmed");
assert.ok(partial.missingInputs.includes("work-thread-model"));
assert.equal(api.projectWorkThreadFollowUp({ ...input, context: partial.context, threadId: partial.context.threadId }).request, null);
const unreadProject = api.captureWorkThreadContext(scope, { ...response, thread: { ...response.thread, projectId: undefined } }, { serviceName: null });
assert.ok(unreadProject.missingInputs.includes("work-thread-project"));
assert.equal(api.projectWorkThreadFollowUp({ ...input, context: unreadProject.context }).request, null, "unknown assignment is not projectless");
const registry = { status: "ready", enabled: true, automations: [{ kind: "heartbeat", status: "ACTIVE", targetThreadId: "thread-1" }] };
assert.equal(api.projectWorkThreadHeartbeat("thread-1", registry).heartbeatEnabled, true);
for (const automations of [[], [{ kind: "heartbeat", status: "PAUSED", targetThreadId: "thread-1" }],
  [{ kind: "cron", status: "ACTIVE", targetThreadId: "thread-1" }], [{ kind: "heartbeat", status: "ACTIVE", targetThreadId: "other" }]]) {
  assert.equal(api.projectWorkThreadHeartbeat("thread-1", { ...registry, automations }).heartbeatEnabled, false);
}
for (const registry of [null, { status: "loading" }, { status: "error" }, { status: "ready", enabled: true, automations: null }]) {
  assert.equal(api.projectWorkThreadHeartbeat("thread-1", registry).heartbeatEnabled, null);
}
assert.equal(api.projectWorkThreadHeartbeat("thread-1", { status: "ready", enabled: false }).heartbeatEnabled, false);
const resumeInput = { ...input, preparedDeveloperInstructions: "real project instructions", heartbeatRegistry: registry };
const resumed = api.projectWorkThreadResume(resumeInput);
assert.equal(resumed.request.model, null); assert.equal(resumed.request.developerInstructions, "real project instructions");
assert.equal("reasoningEffort" in resumed.request, false, "internal runtime input is not a new top-level RPC field");
assert.equal(resumed.instructionOptions.threadId, "thread-1"); assert.equal(resumed.instructionOptions.heartbeatEnabled, true);
assert.equal(api.projectWorkThreadResume({ ...resumeInput, heartbeatRegistry: null }).request, null);
assert.equal(api.projectWorkThreadResume({ ...resumeInput, preparedDeveloperInstructions: undefined }).request, null);
const resumeWithoutMode = api.projectWorkThreadResume({ ...resumeInput, context: external.context });
assert.ok(resumeWithoutMode.request, "a proven existing Work thread can resume to obtain its actual mode");
assert.equal("collaborationMode" in resumeWithoutMode.request, false, "unknown mode is omitted on restore, never borrowed from home params");
assert.equal(api.captureWorkThreadContext(scope, { model: "actual-work-model" }, { serviceName: null }).context, null);
const mutable = { identity: { ...scope.identity }, hostIdentity: scope.hostIdentity };
const frozen = api.captureWorkThreadContext(mutable, response, { serviceName: null }); mutable.identity.accountId = "changed";
response.collaborationMode.settings.model = "mutated-after-read";
assert.equal(frozen.context.scope.identity.accountId, "a"); assert.equal(frozen.context.collaborationMode.settings.model, "actual-work-model");
console.log("PASS Work thread continuity: actual response/owner/host/thread receipts, read-resume restoration, unknown provenance blocks, no home-model fallback, null-model follow-up with confirmed mode, current heartbeat registry and explicit prepared resume instructions; pure/offline only.");
