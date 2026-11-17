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
const resumeInput = { ...input, baseParams: { cwd: "C:/project", model: "home-model", effort: "low", reasoningEffort: "low", serviceName: "must-not-copy", collaborationMode: mode },
  preparedDeveloperInstructions: "real project instructions", heartbeatRegistry: registry };
const resumed = api.projectWorkThreadResume(resumeInput);
assert.equal(resumed.request.model, null); assert.equal(resumed.request.developerInstructions, "real project instructions");
assert.equal("reasoningEffort" in resumed.request, false, "internal runtime input is not a new top-level RPC field");
for (const kind of ["schema", "schema-experimental"]) {
  const schema = JSON.parse(fs.readFileSync(`.ref/parity/16/desktop-host-r1-20261116-current/work-local-protocol-cli/${kind}/v2/ThreadResumeParams.json`, "utf8"));
  assert.equal(Object.hasOwn(schema.properties, "collaborationMode"), false, "both fixed CLI schemas exclude top-level resume collaborationMode");
  assert.equal("collaborationMode" in resumed.request, false, "manager mode must not become an invented resume RPC field");
  assert.ok(Object.keys(resumed.request).every(key => Object.hasOwn(schema.properties, key)), "projected resume contains only declared top-level fields");
}
assert.equal(resumed.instructionOptions.threadId, "thread-1"); assert.equal(resumed.instructionOptions.heartbeatEnabled, true);
assert.equal(api.projectWorkThreadResume({ ...resumeInput, heartbeatRegistry: null }).request, null);
assert.equal(api.projectWorkThreadResume({ ...resumeInput, preparedDeveloperInstructions: undefined }).request, null);
const resumeWithoutMode = api.projectWorkThreadResume({ ...resumeInput, context: external.context });
assert.ok(resumeWithoutMode.request, "a proven existing Work thread can resume to obtain its actual mode");
assert.equal("collaborationMode" in resumeWithoutMode.request, false, "unknown mode is omitted on restore, never borrowed from home params");
const proof = { threadId: "thread-1", accountId: "a", userId: "u", hostIdentity: scope.hostIdentity, serviceName: null };
const codingRead = { thread: { ...response.thread, originator: "codex", model: null, reasoningEffort: null } };
const freshScope = { ...scope, identity: { ...scope.identity, generation: 17 } };
const cold = api.restoreWorkThreadContext(freshScope, codingRead, undefined, proof);
assert.ok(cold.context, "validated persistent provenance restores non-prose Work under a fresh identity generation");
assert.equal(cold.context.scope.identity.generation, 17); assert.equal(cold.context.serviceName, null);
assert.equal(cold.context.model, null); assert.ok(cold.missingInputs.includes("work-thread-model"));
assert.equal(cold.context.collaborationMode, null, "persistent proof does not invent a model/mode");
const noModelResume = api.projectWorkThreadResume({ ...resumeInput, scope: freshScope, context: cold.context });
assert.ok(noModelResume.request, "unknown old read model can resume the real existing thread with model:null");
assert.equal(noModelResume.request.model, null); assert.equal("collaborationMode" in noModelResume.request, false);
assert.equal(api.projectWorkThreadFollowUp({ ...input, scope: freshScope, context: cold.context }).request, null, "follow-up still needs the actual model and confirmed mode");
const staleMode = api.restoreWorkThreadContext(freshScope, codingRead, created.context, proof);
assert.equal(staleMode.context.collaborationMode, null, "fresh-generation proof cannot reuse an old generation's in-memory mode");
for (const patch of [{ threadId: "other" }, { accountId: "other" }, { userId: "other" }, { hostIdentity: "other" }, { serviceName: "custom" }, { serviceName: undefined }]) {
  assert.equal(api.restoreWorkThreadContext(freshScope, codingRead, undefined, { ...proof, ...patch }).context, null);
  assert.equal(api.restoreWorkThreadContext(freshScope, response, undefined, { ...proof, ...patch }).context, null,
    "positive originator cannot bypass an explicitly supplied foreign or malformed durable proof");
}
for (const patch of [{ cwd: null }, { projectId: undefined }]) {
  const incomplete = api.restoreWorkThreadContext(freshScope, { thread: { ...codingRead.thread, ...patch } }, undefined, proof);
  assert.equal(api.projectWorkThreadResume({ ...resumeInput, scope: freshScope, context: incomplete.context }).request, null,
    "allowing unknown model on resume must not default unknown cwd/project");
}
const currentMode = api.restoreWorkThreadContext(freshScope, response, undefined, proof);
assert.ok(api.projectWorkThreadFollowUp({ ...input, scope: freshScope, context: currentMode.context }).request,
  "only the actual resume response's confirmed model/mode restores loaded follow-up");
assert.equal(api.captureWorkThreadContext(scope, { model: "actual-work-model" }, { serviceName: null }).context, null);
assert.equal(typeof api.confirmWorkThreadResumeResult, "function", "actual resume results need source default-mode reconstruction");
const resumedActual = { ...response, model: "server-confirmed-model", reasoningEffort: "low",
  collaborationMode: { mode: "plan", settings: { model: "unrelated-response-mode", reasoning_effort: "ultra" } } };
const capturedPlan = { ...created.context, collaborationMode: { mode: "plan", settings: { ...mode.settings, reasoning_effort: "high" } } };
const confirmedResume = api.confirmWorkThreadResumeResult(scope, resumedActual, capturedPlan);
assert.equal(confirmedResume.context.model, "server-confirmed-model");
assert.equal(confirmedResume.context.collaborationMode.mode, "default", "source restoration does not preserve a home/previous Plan mode");
assert.equal(confirmedResume.context.collaborationMode.settings.model, "server-confirmed-model");
assert.equal(confirmedResume.context.collaborationMode.settings.reasoning_effort, "high", "captured same-thread reasoning precedes response");
assert.equal(confirmedResume.context.collaborationMode.settings.developer_instructions, null);
const noResponseMode = { ...resumedActual }; delete noResponseMode.collaborationMode;
const capturedNull = { ...capturedPlan, collaborationMode: { ...capturedPlan.collaborationMode, settings: { ...mode.settings, reasoning_effort: null } } };
assert.equal(api.confirmWorkThreadResumeResult(scope, noResponseMode, capturedNull).context.collaborationMode.settings.reasoning_effort, "low");
const latestOnly = { ...created.context, collaborationMode: null, reasoningEffort: "xhigh" };
assert.equal(api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, reasoningEffort: null }, latestOnly).context.collaborationMode.settings.reasoning_effort, "xhigh");
const knownNull = api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, reasoningEffort: null }, { ...latestOnly, reasoningEffort: null });
assert.equal(knownNull.context.reasoningEffort, null); assert.equal(knownNull.context.collaborationMode.settings.reasoning_effort, null);
assert.deepEqual(Array.from(knownNull.missingInputs), []);
const nullWithoutLatest = api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, reasoningEffort: null }, { ...latestOnly, reasoningEffort: undefined });
assert.equal(nullWithoutLatest.context.collaborationMode.settings.reasoning_effort, null, "explicit confirmed null is not unread reasoning");
const noActualModel = api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, model: undefined }, capturedPlan);
assert.equal(noActualModel.context.model, null); assert.equal(noActualModel.context.collaborationMode, null);
assert.ok(noActualModel.missingInputs.includes("work-thread-model"), "neither old receipt nor nested thread.model supplies the actual resume model");
const noActualReason = api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, reasoningEffort: undefined }, { ...latestOnly, reasoningEffort: undefined });
assert.equal(noActualReason.context.collaborationMode, null); assert.ok(noActualReason.missingInputs.includes("work-thread-reasoning"));
const malformedReason = api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, reasoningEffort: false }, latestOnly);
assert.equal(malformedReason.context.collaborationMode, null); assert.ok(malformedReason.missingInputs.includes("work-thread-reasoning"));
assert.equal(api.confirmWorkThreadResumeResult(scope, { ...noResponseMode, reasoningEffort: false }, capturedPlan).context.reasoningEffort, "high",
  "a valid captured reason short-circuits unused response fallback");
assert.equal(api.confirmWorkThreadResumeResult({ ...scope, hostIdentity: "wrong-host" }, noResponseMode, capturedPlan).context, null);
const newGenerationResume = api.confirmWorkThreadResumeResult(freshScope, noResponseMode, capturedPlan, proof);
assert.equal(newGenerationResume.context.collaborationMode.settings.reasoning_effort, "low", "old generation capture cannot supply reasoning to a newly authenticated scope");
const mutable = { identity: { ...scope.identity }, hostIdentity: scope.hostIdentity };
const frozen = api.captureWorkThreadContext(mutable, response, { serviceName: null }); mutable.identity.accountId = "changed";
response.collaborationMode.settings.model = "mutated-after-read";
assert.equal(frozen.context.scope.identity.accountId, "a"); assert.equal(frozen.context.collaborationMode.settings.model, "actual-work-model");
console.log("PASS Work thread continuity: owner/host/thread and durable non-prose provenance, fresh-generation restoration, both CLI resume schemas exclude mode, unknown-model null resume, actual ACK default-mode reconstruction with captured/response/latest reasoning and known-null preservation, strict follow-up and heartbeat; pure/offline only.");
