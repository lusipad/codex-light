import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";
import { mountReviewContext } from "./verify-review-actions.mjs";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, require = () => ({})) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(file, "utf8")), { exports, require });
  return exports;
}
const capabilities = load("src/modelCapabilities.ts");
const execution = load("src/executionPolicy.ts");
const { ModelTurnLedger } = load("src/modelSelection.ts", id => id === "./modelCapabilities" ? capabilities : {});
const model = { id: "menu-identity", model: "wire-identity", isDefault: true,
  defaultReasoningEffort: "low", supportedReasoningEfforts: ["low", "high"],
  serviceTiers: [{ id: "swift", name: "fast" }] };
const resolved = capabilities.resolveModelSelection([model], { model: "menu-identity", reasoningEffort: "high", serviceTier: "fast" }, {}, { fast: true, ultrafast: false });
assert.equal(resolved.available, true);
const configuration = plain(resolved.configuration);
assert.deepEqual(configuration, { model: "wire-identity", reasoningEffort: "high", serviceTier: "swift" });
function assertTriple(params) {
  assert.equal(params.model, configuration.model);
  assert.equal(params.effort, configuration.reasoningEffort);
  assert.equal(params.serviceTier, configuration.serviceTier);
  assert.notEqual(params.serviceTier, "priority", "fast tier is the directory's actual id, not a hardcoded priority alias");
}
for (const mode of ["send", "goal", "plan", "retry"]) {
  const view = mountProjectContext({ configuration });
  const recorded = [];
  const ledger = new ModelTurnLedger(async used => recorded.push(plain(used)));
  view.context.trackModelTurn = (id, used, send) => ledger.track(id, used, send);
  view.context.planMode = mode === "plan";
  view.context.applyCollaborationMode = async (id, enabled) => view.calls.push(["applyCollaborationMode", id, enabled]);
  if (mode === "goal") await view.goal("model request evidence");
  else await view.send(mode === "retry" ? "retry failed content" : undefined);
  const thread = view.calls.find(([method]) => method === "thread/start")?.[1];
  assert.equal(thread.model, configuration.model, `${mode}: thread creation uses backend model identity`);
  const turn = view.calls.find(([method]) => method === "turn/start")?.[1];
  assert.ok(turn, `${mode} crosses production turn/start boundary`); assertTriple(turn);
  if (mode === "plan") {
    const apply = view.calls.findIndex(([method]) => method === "applyCollaborationMode");
    assert.ok(apply >= 0 && apply < view.calls.findIndex(([method]) => method === "turn/start"));
  }
  assert.equal(recorded.length, 0, "RPC acknowledgement alone cannot record recent usage");
  await ledger.complete("created", "turn-created", "actual-user-item");
  assert.deepEqual(recorded, [configuration], "the confirmed actual turn is associated with the same request triple");
}
for (const invalid of ["selectionPending", "selectionInvalid"]) {
  for (const mode of ["send", "goal"]) {
    const view = mountProjectContext({ configuration }); view.context[invalid] = true;
    await view[mode](mode === "goal" ? "objective" : undefined);
    assert.equal(view.calls.some(([method]) => ["thread/start", "turn/start"].includes(method)), false, `${invalid} blocks ${mode}`);
  }
  const review = mountReviewContext({ configuration, [invalid]: true }); await review.start({ kind: "uncommitted" });
  assert.equal(review.calls.length, 0, `${invalid} blocks review model execution`);
}
{
  const view = mountProjectContext({ configuration });
  view.context.planMode = true;
  view.context.applyCollaborationMode = async () => { throw Error("settings rejected"); };
  await view.send();
  assert.equal(view.calls.some(([method]) => method === "turn/start"), false, "failed plan settings must not execute a turn with unconfirmed configuration");
  assert.equal(view.state.promptInput, "hello", "failed plan settings preserve the input");
}
console.log("PASS MC-B03/04/08/09 actual App send/goal/plan/retry callbacks: runtime id vs model, real custom fast tier, pending/invalid blocking and confirmed-turn ledger association");

{
  const view = mountProjectContext({ threadId: "streaming-thread", configuration });
  view.context.isStreaming = true; view.context.activeTurnIdRef.current = "running-turn";
  view.context.getModelConfiguration = () => { throw Error("next-turn configuration is pending"); };
  view.context.callAppServer = async (method, params) => { view.calls.push([method, plain(params)]); return {}; };
  await view.send("guide the existing turn");
  const steer = view.calls.find(([method]) => method === "turn/steer")?.[1]; assert.ok(steer);
  assert.equal(steer.expectedTurnId, "running-turn");
  for (const field of ["model", "effort", "serviceTier"]) assert.equal(field in steer, false, "steer must not replace the running turn's model configuration");
  assert.equal(view.calls.some(([method]) => ["thread/settings/update", "turn/start", "trackModelTurn"].includes(method)), false);
}
console.log("PASS MC-B09 actual streaming callback: steer binds expected turn and never overwrites running model/effort/tier");

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found); return compile(`(${found.getText(ast)})`);
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function queueFixture({ invalid = null, settingsFailure = false, response = { turn: { id: "actual-queue-turn" } } } = {}) {
  const calls = [], recorded = [], ledger = new ModelTurnLedger(async used => recorded.push(plain(used)));
  let finishSettings;
  const settings = new Promise(resolve => { finishSettings = resolve; });
  const context = {
    executionIdentityRef: { current: "fixture-account" },
    threadExecutionRevisionsRef: { current: new Map() },
    threadsRef: { current: [{ id: "queue-thread", cwd: "D:/repo" }] }, workspaceHintsRef: { current: {} },
    readWorkThreadProvenance: async () => null, workThreadContexts: { current: new Map() },
    resolveExecutionContext: async () => ({ policy: execution.resolvePresetExecutionPolicy("ask", ["D:/repo"]) }),
    captureThreadExecutionPolicy: (_id, response) => execution.readThreadExecutionPolicy(response),
    activeThreadIdRef: { current: "queue-thread" }, followupQueue: [{ id: "queued-item", text: "queued text" }],
    queueMutationThreadsRef: { current: new Set() }, steeredQueueItemsRef: { current: new Set() },
    isStreaming: false, threadRequestRef: { current: 1 },
    setQueueMutationVersion() {}, setFollowupQueue() {}, refreshThreadQueue: async () => calls.push(["refresh"]),
    isCurrentThreadRequest: (request, current, id, active) => request === current && id === active,
    getModelConfiguration() { if (invalid) throw Error(invalid); return configuration; },
    showAppToast: (...args) => calls.push(["toast", ...args]),
    handleSteerTurn: async (...args) => calls.push(["steer", ...args]),
    trackModelTurn: (id, used, send) => { calls.push(["track", id, plain(used)]); return ledger.track(id, used, send); },
    callAppServer: async (method, params) => {
      calls.push([method, plain(params)]);
      if (method === "thread/settings/update") { await settings; if (settingsFailure) throw Error("settings rejected"); return {}; }
      if (method === "thread/resume") {
        const policy = execution.resolvePresetExecutionPolicy("ask", ["D:/repo"]);
        return { approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer, sandbox: policy.sandboxPolicy };
      }
      assert.equal(method, "thread/queue/start"); return response;
    },
  };
  return { context, calls, recorded, ledger, finishSettings, start: vm.runInNewContext(callback("handleStartServerQueue"), context) };
}
for (const evidence of ["provenance", "receipt", "originator", "unreadable"]) for (const streaming of [false, true]) {
  const view = queueFixture(); view.context.isStreaming = streaming;
  if (evidence === "provenance") view.context.readWorkThreadProvenance = async () => ({ threadId: "queue-thread" });
  if (evidence === "receipt") view.context.workThreadContexts.current.set("queue-thread", {});
  if (evidence === "originator") view.context.threadsRef.current[0].originator = "codex_work_desktop";
  if (evidence === "unreadable") view.context.readWorkThreadProvenance = async () => { throw Error("source unavailable"); };
  const pending = view.start(); await flush();
  assert.equal(view.calls.some(([method]) => ["thread/settings/update", "thread/resume", "thread/queue/start", "steer"].includes(method)), false,
    `Work ${evidence}/${streaming} must not reach ordinary queue submission`);
  await pending; assert.equal(view.context.queueMutationThreadsRef.current.size, 0);
}
console.log("PASS Work queue start/steer sources reject before ordinary settings or dispatch, including unreadable provenance");
for (const retirement of ["thread", "owner"]) {
  const view = queueFixture(); let complete;
  view.context.readWorkThreadProvenance = () => new Promise(resolve => { complete = resolve; });
  const pending = view.start();
  if (retirement === "thread") view.context.activeThreadIdRef.current = "other-thread";
  else view.context.executionIdentityRef.current = "other-owner";
  complete(null); await pending; assert.equal(view.calls.length, 0, `queue provenance await respects ${retirement} retirement`);
}
{
  const view = queueFixture(); let complete;
  const sourceRead = new Promise(resolve => { complete = resolve; }); view.context.readWorkThreadProvenance = () => sourceRead;
  const first = view.start(), duplicate = view.start(); complete(null); await flush();
  assert.equal(view.calls.filter(([method]) => method === "thread/settings/update").length, 1, "ordinary duplicate clicks recheck the queue lock after source await");
  view.finishSettings(); await Promise.all([first, duplicate]);
  assert.equal(view.calls.filter(([method]) => method === "thread/queue/start").length, 1);
}
{
  const view = queueFixture(); const pending = view.start();
  await flush();
  assert.deepEqual(view.calls.map(([method]) => method), ["thread/settings/update"]);
  assertTriple(view.calls[0][1]);
  view.finishSettings(); await pending;
  assert.deepEqual(view.calls.slice(0, 4).map(([method]) => method), ["thread/settings/update", "thread/resume", "track", "thread/queue/start"]);
  assert.deepEqual(view.calls[3][1], { threadId: "queue-thread", queuedSubmissionId: "queued-item" });
  assert.equal(view.recorded.length, 0);
  await view.ledger.complete("queue-thread", "unrelated-turn", "wrong-user-item"); assert.equal(view.recorded.length, 0);
  await view.ledger.complete("queue-thread", "actual-queue-turn", "actual-user-item"); assert.deepEqual(view.recorded, [configuration]);
}
for (const options of [{ invalid: "pending" }, { invalid: "unavailable" }, { settingsFailure: true }]) {
  const view = queueFixture(options); const pending = view.start(); view.finishSettings(); await pending;
  assert.equal(view.calls.some(([method]) => method === "thread/queue/start" || method === "track"), false);
}
{
  const view = queueFixture(); const pending = view.start(); view.context.activeThreadIdRef.current = "another-chat";
  view.finishSettings(); await pending; assert.equal(view.calls.some(([method]) => method === "thread/queue/start"), false);
}
console.log("PASS MC-B05/09 actual queue callback: await real settings RPC before queue/start, custom triple, actual returned turn tracking, failed writes/pending/invalid/stale chat refusal");

{
  const view = mountReviewContext({ configuration }); const pending = view.start({ kind: "uncommitted" });
  await flush();
  assert.equal(view.calls[0].name, "thread/start"); assert.equal(view.calls[0].params.model, configuration.model);
  view.calls[0].resolve({ thread: { id: "review-thread" } }); await flush();
  assert.equal(view.calls[1].name, "turn/start"); assertTriple(view.calls[1].params);
  view.calls[1].resolve({ turn: { id: "review-turn" } }); await pending;
  assert.equal(view.tracker.getRuns()[0].turnId, "review-turn");
  assert.equal(view.context.trackedConfigurations?.length || 0, 0, "code review source remains excluded from ordinary Composer recent usage");
}
console.log("PASS MC-B09 actual quick review callback: same triple and review tracker, no unsupported promotion into ordinary Composer recents");
