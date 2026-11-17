import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";
const plain = value => JSON.parse(JSON.stringify(value));
const identity = { userId: "work-user", accountId: "work-account", generation: 2 };
const root = "D:/projects/shared";
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function load(file, require = () => ({})) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, { exports, require, Error });
  return exports;
}
function fixture({ missingProject = false, worktree = false } = {}) {
  const view = mountProjectContext({ worktree, start: params => ({ thread: { id: "work-created", ...(missingProject ? {} : { projectId: params.projectId }), cwd: root,
    originator: params.serviceName ?? "Codex Desktop" }, model: "server-work-model", reasoningEffort: "medium", cwd: root }) });
  const { context, calls } = view, disk = new Map();
  const target = { status: "ready", identity, location: "local", selectedWorkProject: { type: "local", projectId: "multi" }, preferences: { mode: { status: "value", value: "work" } } };
  const prepared = { status: "ready", identity, target, model: "requested-work-model", reasoningEffort: "high", serviceName: "codex_work_desktop",
    developerInstructions: "Fixture from the separately tested project-aware assembler.",
    execution: { status: "ready", settings: { effectiveDetail: "STEPS_PROSE" }, defaultEnableFeatures: {}, values: {} } };
  Object.assign(context, load("src/workLocalRequest.ts"), load("src/workThreadContext.ts"), load("src/components/QuickSearchModal.tsx"), {
    workHomeSession: { key: "work-capture", target }, workCustomInstructions: {},
    appServerStatus: { appServerVersion: "0.165.0" },
    serviceIdentity: async () => ({ ...identity }),
    readWorkCaptureTarget: async () => target,
    readWorkLocalMessagePreparation: async () => prepared,
    getModelConfiguration: () => assert.fail("ordinary Codex model used for Work"),
    trackModelTurn: () => assert.fail("Work wrote ordinary model recents"),
  });
  const invoke = context.tauriInvoke, call = context.callAppServer;
  context.tauriInvoke = async (command, args) => {
    if (command === "desktop_state_set") { calls.push([command, plain(args)]); if (view.failDisk) throw Error("fixture disk failure"); disk.set(args.key, plain(args.value)); return; }
    if (command === "desktop_state_get") return disk.get(args.key) ?? null;
    return invoke(command, args);
  };
  Object.assign(context, load("src/workThreadProvenance.ts", () => ({ tauriInvoke: (...args) => context.tauriInvoke(...args) })));
  context.callAppServer = async (method, params) => {
    if (method === "thread/settings/update" || method === "turn/interrupt") { calls.push([method, plain(params)]); return {}; }
    return call(method, params);
  };
  return Object.assign(view, { target, prepared, disk });
}
{
  const f = fixture();
  assert.equal(await f.send(), true, JSON.stringify(f.calls));
  const start = f.calls.find(call => call[0] === "thread/start")[1];
  assert.equal(start.serviceName, "codex_work_desktop"); assert.equal(start.model, "requested-work-model");
  assert.equal(start.config.model_reasoning_effort, "high"); assert.equal(start.projectId, "server-multi");
  assert.equal(start.cwd, root); assert.equal(start.developerInstructions, f.prepared.developerInstructions);
  const turn = f.calls.find(call => call[0] === "turn/start")[1];
  assert.equal(turn.model, null); assert.equal(turn.effort, "medium");
  assert.equal(turn.collaborationMode.settings.model, "server-work-model");
  assert.equal(f.calls.find(call => call[0] === "hydrateThreadModel")[2].model, "server-work-model");
  assert.ok(f.disk.get("codex-native-work-thread:work-created"));
  assert.ok(f.calls.findIndex(call => call[0] === "desktop_state_set") < f.calls.findIndex(call => call[0] === "turn/start"));
  f.context.workHomeSession = null; f.context.activeThreadId = "work-created"; f.context.isStreaming = false;
  assert.equal(await f.send("Follow-up"), true);
  const second = f.calls.filter(call => call[0] === "turn/start")[1][1];
  assert.equal(second.model, null); assert.equal(second.effort, null);
  assert.equal(second.collaborationMode.settings.model, "server-work-model");
  assert.equal(f.calls.filter(call => call[0] === "thread/start").length, 1);
  const settingsBefore = f.calls.filter(call => call[0] === "thread/settings/update").length;
  f.context.planMode = true; // Another view's global flag must not replace this receipt.
  assert.equal(await f.send("Continue with the confirmed mode"), true);
  assert.equal(f.calls.filter(call => call[0] === "thread/settings/update").length, settingsBefore);
}
for (const invalid of ["remote-project", "changed-project", "not-ready"]) {
  const f = fixture();
  if (invalid === "remote-project") f.target.selectedWorkProject = { type: "chatgpt", projectId: "g-p-real" };
  if (invalid === "changed-project") f.context.readWorkCaptureTarget = async () => ({ ...f.target, selectedWorkProject: { type: "local", projectId: "other" } });
  if (invalid === "not-ready") f.context.readWorkLocalMessagePreparation = async () => ({ status: "not-ready", missingInputs: ["real-policy"] });
  await f.send(); assert.equal(f.calls.some(call => call[0] === "thread/start" || call[0] === "turn/start"), false);
  assert.equal(f.state.promptInput, "hello");
}
{
  const f = fixture(); await f.send("/goal A Work goal"); await f.goal("A Work goal");
  assert.equal(f.calls.some(call => ["thread/start", "turn/start", "goalSet"].includes(call[0])), false);
  assert.equal(f.state.promptInput, "hello");
}
{
  const f = fixture(), pending = deferred();
  f.context.readWorkLocalMessagePreparation = () => pending.promise;
  const first = f.send(); await Promise.resolve(); await Promise.resolve();
  await f.send(); pending.resolve(f.prepared); assert.equal(await first, true);
  assert.equal(f.calls.filter(call => call[0] === "thread/start").length, 1);
}
for (const stale of ["owner", "navigation", "abort"]) {
  const f = fixture(), pending = deferred();
  f.context.readWorkLocalMessagePreparation = () => pending.promise;
  const sending = f.send(); await Promise.resolve(); await Promise.resolve();
  if (stale === "owner") f.context.committedWorkOwner.current = "new-owner";
  if (stale === "navigation") f.context.navigationRequestRef.current++;
  if (stale === "abort") f.context.workSendPreparing.current.abort();
  pending.resolve(f.prepared); await sending;
  assert.equal(f.calls.some(call => call[0] === "thread/start"), false); assert.equal(f.state.promptInput, "hello");
}
{
  const f = fixture(), pending = deferred(), call = f.context.callAppServer;
  let entered = false;
  f.context.callAppServer = async (...args) => { if (args[0] === "thread/start") { entered = true; await pending.promise; } return call(...args); };
  const sending = f.send();
  for (let i = 0; i < 100 && !entered; i++) await Promise.resolve();
  assert.equal(entered, true, "the server mutation has really started before leaving its view");
  f.context.navigationRequestRef.current++; f.context.threadRequestRef.current++;
  pending.resolve(); await sending;
  assert.ok(f.disk.get("codex-native-work-thread:work-created"), "late creation ACK still records its original provenance");
  assert.equal(f.calls.some(call => call[0] === "turn/start"), false);
  assert.equal(f.context.workThreadContexts.current.size, 0, "late ACK does not publish a new active consumer");
}
{
  const f = fixture(); f.failDisk = true;
  await f.send(); assert.equal(f.calls.some(call => call[0] === "turn/start"), false);
  assert.equal(f.state.promptInput, "hello");
  assert.equal((await f.context.readWorkThreadProvenance("work-created")).accountId, identity.accountId,
    "a failed persistence does not erase the acknowledged Work origin in this process");
  assert.equal(f.context.activeThreadIdRef.current, "work-created");
  f.context.workHomeSession = null;
  await f.send();
  assert.equal(f.calls.filter(call => call[0] === "thread/start").length, 1, "retry does not create a second confirmed thread");
  f.failDisk = false;
  assert.equal(await f.send(), true, "explicit retry finishes the acknowledged empty thread's setup");
  assert.equal(f.calls.filter(call => call[0] === "thread/start").length, 1);
}
{
  const f = fixture({ missingProject: true });
  await f.send(); assert.equal(f.context.activeThreadIdRef.current, "work-created");
  assert.equal(f.calls.some(call => call[0] === "turn/start"), false);
  f.context.workHomeSession = null; await f.send();
  assert.equal(f.calls.filter(call => call[0] === "thread/start").length, 1);
}
{
  const f = fixture(), pending = deferred(), call = f.context.callAppServer;
  let entered = false;
  f.context.callAppServer = async (...args) => { if (args[0] === "thread/settings/update") { entered = true; await pending.promise; } return call(...args); };
  const sending = f.send();
  for (let i = 0; i < 100 && !entered; i++) await Promise.resolve();
  assert.equal(entered, true); f.context.workPermissionRevision.current++; pending.resolve(); await sending;
  assert.equal(f.calls.some(call => call[0] === "turn/start"), false);
  assert.equal(f.context.workThreadContexts.current.get("work-created").collaborationMode, null);
  assert.equal(f.state.promptInput, "hello");
}
{
  const f = fixture(); await f.send();
  f.context.workHomeSession = null; f.context.activeThreadId = "work-created"; f.context.isStreaming = false;
  f.context.workThreadContexts.current.clear();
  const before = f.calls.filter(call => call[0] === "turn/start").length;
  await f.send("Must preserve Work semantics");
  assert.equal(f.calls.filter(call => call[0] === "turn/start").length, before);
  assert.ok(f.calls.some(call => call[0] === "toast" && call[1].includes("尚未恢复")));
}
{
  const f = fixture(); f.prepared.execution.settings.effectiveDetail = "STEPS"; delete f.prepared.serviceName;
  assert.equal(await f.send(), true);
  assert.equal(Object.hasOwn(f.calls.find(call => call[0] === "thread/start")[1], "serviceName"), false);
  assert.equal(f.disk.get("codex-native-work-thread:work-created").serviceName, null);
  f.context.workHomeSession = null; f.context.workThreadContexts.current.clear();
  const before = f.calls.filter(call => call[0] === "turn/start").length;
  await f.send(); assert.equal(f.calls.filter(call => call[0] === "turn/start").length, before);
}
{
  const f = fixture(); await f.send(); f.context.workHomeSession = null;
  f.context.serviceIdentity = async () => ({ ...identity, accountId: "other-account" });
  const before = f.calls.filter(call => call[0] === "turn/start").length;
  await f.send(); assert.equal(f.calls.filter(call => call[0] === "turn/start").length, before);
  assert.ok(f.calls.some(call => call[0] === "toast" && call[1].includes("所属账号")));
}
{
  const f = fixture({ worktree: true }); let child;
  f.context.createEnvironmentWorktree = (_options, signal) => new Promise((_resolve, reject) => {
    child = signal; signal.addEventListener("abort", () => reject(Error("fixture cancelled")), { once: true });
  });
  const sending = f.send();
  for (let i = 0; i < 100 && !child; i++) await Promise.resolve();
  assert.ok(child); await f.interrupt(); await sending;
  assert.equal(child.aborted, true); assert.equal(f.context.worktreeCreationControllersRef.current.size, 0);
  assert.equal(f.calls.some(call => call[0] === "thread/start" || call[0] === "turn/start"), false);
  assert.equal(f.state.promptInput, "hello"); assert.equal(f.state.turns.length, 0);
  assert.equal(f.context.activeRouteRef.current, "home", "pre-create stop retains the explicit Work home intent");
  f.context.createEnvironmentWorktree = async () => ({ path: "D:/worktree" });
  assert.equal(await f.send(), true, "retry remains Work instead of falling through to ordinary Codex");
  assert.equal(f.calls.find(call => call[0] === "thread/start")[1].serviceName, "codex_work_desktop");
}
for (const phase of ["thread/start", "thread/settings/update", "turn/start"]) {
  const f = fixture(), pending = deferred(), call = f.context.callAppServer; let entered = false;
  f.context.callAppServer = async (...args) => { if (args[0] === phase) { entered = true; await pending.promise; } return call(...args); };
  const sending = f.send();
  for (let i = 0; i < 100 && !entered; i++) await Promise.resolve();
  assert.equal(entered, true);
  f.context.activeTurnIdRef.current = f.context.pendingTurnIdRef.current;
  await f.interrupt();
  assert.equal(f.calls.some(call => call[0] === "turn/interrupt"), false, "never interrupt a fabricated pending turn ID");
  pending.resolve(); await sending;
  if (phase === "turn/start") {
    const stopped = f.calls.filter(call => call[0] === "turn/interrupt"); assert.equal(stopped.length, 1);
    assert.deepEqual(stopped[0][1], { threadId: "work-created", turnId: "turn-created" });
  } else {
    assert.equal(f.calls.some(call => call[0] === "turn/start"), false);
    assert.equal(f.context.activeThreadIdRef.current, "work-created");
    assert.equal(f.state.promptInput, "hello"); assert.equal(f.state.turns.length, 0);
  }
  assert.equal(f.context.workActiveSend.current, null);
}
for (const stale of ["owner", "identity", "request", "host"]) {
  const f = fixture(), pending = deferred(), call = f.context.callAppServer; let entered = false;
  f.context.callAppServer = async (...args) => { if (args[0] === "turn/start") { entered = true; await pending.promise; } return call(...args); };
  const sending = f.send();
  for (let i = 0; i < 100 && !entered; i++) await Promise.resolve();
  assert.equal(entered, true);
  f.context.workActiveSend.current.abort();
  if (stale === "owner") f.context.committedWorkOwner.current = "different-account-or-host";
  if (stale === "identity") f.context.executionIdentityRef.current = "different-execution-identity";
  if (stale === "request") f.context.threadRequestRef.current++;
  if (stale === "host") f.context.workActiveSend.current = null;
  pending.resolve(); await sending;
  assert.equal(f.calls.some(call => call[0] === "turn/interrupt"), false, `${stale}: an old acknowledgement must not write through the current connection`);
}
console.log("PASS actual App Work sender: source request/confirmed model/project/instructions, native provenance roundtrip before turn, explicit mode ACK, loaded follow-up, no ordinary recents, no fake materialization, cancellation/duplicates, late creation receipt, disk failure and unknown restore guards. Isolated VM and IPC fixtures; no live account/model turn or GUI.");
