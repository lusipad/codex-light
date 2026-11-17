import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function callback(name) {
  let found;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.arguments[0]; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(found, `${name} must be the actual App callback`); return compile(`(${found.getText(ast)})`);
}
function sendRestoreGuard() {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleSendMessage") {
      found = node.initializer.arguments[0].body.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(ast).includes("workThreadRestoreState"));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(found, "actual sender needs a restore-state guard");
  return compile(`(async () => { ${found.getText(ast)} throw Error("ordinary send reached"); })`);
}
const execution = {};
vm.runInNewContext(compile(fs.readFileSync("src/executionPolicy.ts", "utf8")), { exports: execution });
const timeline = {};
vm.runInNewContext(compile(fs.readFileSync("src/threadTimeline.ts", "utf8")), { exports: timeline });
const identity = { accountId: "account", userId: "user", generation: 7 };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const until = async predicate => { for (let i = 0; i < 60 && !predicate(); i++) await Promise.resolve(); assert.ok(predicate(), "actual restore boundary must be reached"); };
function fixture({ kind = "work", historyFailure = false, restoreFailure = false, pause = false, warm = false } = {}) {
  const calls = [], hydrations = [], historyResponses = [], notices = [], state = { restore: null, historyError: null, turns: [], loading: false };
  const metadata = { thread: { id: "thread-1", model: "old-work-model", reasoningEffort: "medium", cwd: "C:/old-project", projectId: "old-project",
    originator: kind === "work" ? "codex_work_desktop" : "codex", status: { type: warm ? "idle" : "notLoaded" }, ephemeral: false } };
  const mode = { mode: warm ? "plan" : "default", settings: { model: "restored-work-model", reasoning_effort: "high", developer_instructions: null } };
  const receipt = { scope: { identity: { ...identity }, hostIdentity: "host-1" }, threadId: "thread-1", serviceName: kind === "non-prose" ? null : "codex_work_desktop",
    originator: metadata.thread.originator, model: "restored-work-model", reasoningEffort: "high", cwd: "C:/old-project", projectId: "old-project", collaborationMode: mode };
  const response = { thread: { ...metadata.thread, model: receipt.model, reasoningEffort: "high", turns: [] }, model: receipt.model, reasoningEffort: "high",
    approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } };
  const gate = deferred(), currentContext = { value: null };
  const context = {
    ...execution, ...timeline, AbortController, console: { warn() {}, error() {} },
    personalizationNavigationGuardRef: { current: null }, activityScopeRef: { current: "activity" }, markScheduledActivityRead() {},
    worktreeCreationControllersRef: { current: new Map() }, executionIdentityRef: { current: "owner-view" },
    modelAccountIdentity: "owner-view", committedWorkOwner: { current: "owner-view" }, committedWorkHost: { current: "host-1" }, workHostIdentity: "host-1",
    appServerStatus: { appServerVersion: "0.165.0", connected: true }, workCustomInstructions: {},
    workThreadRestoreController: { current: null }, workThreadContexts: { current: new Map() }, workPermissionRevision: { current: 0 },
    setWorkThreadRestoreState: value => { state.restore = typeof value === "function" ? value(state.restore) : value; },
    readWorkThreadProvenance: async id => { calls.push(["provenance", id]); return kind === "non-prose" ? {
      threadId: id, accountId: identity.accountId, userId: identity.userId, hostIdentity: "host-1", serviceName: null,
    } : null; },
    restoreWorkLocalThread: async (input, cache, signal) => {
      calls.push(["work-restore", input, cache, signal]); currentContext.value = input;
      if (pause) await gate.promise;
      if (restoreFailure) throw Error("Work instructions or heartbeat unavailable");
      if (kind === "ordinary") return { kind: "ordinary" };
      return { kind: warm ? "loaded" : "resumed", context: receipt, response };
    },
    beginThreadModelHydration: () => "hydration-ticket", hydrateThreadModel: (...args) => hydrations.push(args),
    reviewResultsRef: { current: { getRuns: () => [], hydrate() {} } },
    pendingNewThreadProjectRef: { current: null }, pendingProjectlessRef: { current: false },
    navigationRequestRef: { current: 0 }, threadRequestRef: { current: 0 }, turnLifecycleRef: { current: 0 }, activeThreadIdRef: { current: null },
    attachmentScopeRef: { current: "home" }, threadHistoryBufferRef: { current: { begin() {}, release: () => [] } },
    finishedTurnIdsRef: { current: new Set() }, earlierRequestRef: { current: false }, followTimelineRef: { current: false }, prependScrollRef: { current: null },
    threadExecutionPoliciesRef: { current: new Map() }, threadExecutionRevisionsRef: { current: new Map() },
    permissionMode: "custom", sessionAllowNetwork: false,
    configRead: async () => { throw Error("existing thread must not read the home config"); },
    threadsRef: { current: [metadata.thread] }, workspaceHintsRef: { current: {} }, workspacesRef: { current: [] },
    normalizeTurnsFromList: page => page.data ?? [], normalizeTurnsFromThread: value => { historyResponses.push(value); return []; },
    listThreadAttachments: async () => [], mergeAttachmentItems: (restored, existing) => existing,
    goalGet: async () => null, replayThreadNotificationRef: { current() {} }, handleSelectWorkspace() {},
    showAppToast: (...args) => notices.push(args), setAttachedFiles() {}, setActiveRoute() {},
    setLoadingThread: value => { state.loading = value; }, setHistoryError: value => { state.historyError = value; },
    setTurns: value => { state.turns = typeof value === "function" ? value(state.turns) : value; },
    callAppServer: async (method, params) => {
      calls.push([method, params]);
      if (method === "thread/read") return metadata;
      if (method === "thread/resume") return response;
      assert.equal(method, "thread/turns/list"); if (historyFailure) throw Error("history pagination unsupported");
      return { data: [] };
    },
  };
  for (const name of ["LoadingEarlierTurns", "IsStreaming", "ThreadUsage", "ServerGoal", "ActiveThreadId", "ActiveTurnId", "ActiveThreadStatus", "PlanSteps", "TurnDiffFiles", "TurnsCursor", "HasMoreTurns"]) context[`set${name}`] = () => {};
  vm.createContext(context);
  context.captureThreadExecutionPolicy = vm.runInContext(callback("captureThreadExecutionPolicy"), context);
  context.resolveExecutionContext = vm.runInContext(callback("resolveExecutionContext"), context);
  context.selectThread = vm.runInContext(callback("selectThread"), context);
  if (warm) { context.workThreadContexts.current.set("thread-1", receipt); context.captureThreadExecutionPolicy("thread-1", response); }
  return { context, calls, hydrations, historyResponses, notices, state, metadata, receipt, response, gate, currentContext,
    setRestoreFailure(value) { restoreFailure = value; },
    select: () => context.selectThread("thread-1"), resolve: () => context.resolveExecutionContext("thread-1", "C:/old-project", ["C:/old-project"]) };
}
const count = (f, method) => f.calls.filter(([name]) => name === method).length;
for (const kind of ["work", "non-prose"]) {
  const f = fixture({ kind, historyFailure: true }); await f.select();
  assert.equal(count(f, "work-restore"), 1, "actual selectThread routes known Work through its dedicated restore producer");
  assert.equal(count(f, "thread/resume"), 0, "Work must not invoke ordinary resume, including history fallback");
  assert.equal(f.context.workThreadContexts.current.get("thread-1"), f.receipt);
  assert.ok(f.hydrations.some(([, response]) => response === f.response), "actual restore ACK, not a manufactured response, hydrates the thread");
  assert.equal(f.context.threadExecutionPoliciesRef.current.get("thread-1").sandboxPolicy.type, "readOnly");
  assert.ok(f.historyResponses.includes(f.response), "history fallback reuses the completed dedicated restore response");
  assert.equal(f.currentContext.value.threadId, "thread-1"); assert.equal(f.currentContext.value.metadata, f.metadata);
  assert.equal(f.currentContext.value.forceResume, true); assert.equal(f.currentContext.value.hostIdentity, "host-1");
  if (kind === "non-prose") assert.equal(f.currentContext.value.provenance.serviceName, null);
}
{
  const f = fixture({ restoreFailure: true, historyFailure: true }); await f.select();
  assert.equal(count(f, "thread/resume"), 0, "Work preparation failure must not fall through to bare history resume");
  assert.equal(f.context.workThreadContexts.current.size, 0); assert.equal(f.context.threadExecutionPoliciesRef.current.size, 0);
  assert.ok(f.state.restore?.error, "restore error remains visible and blocks the Work sender");
  const failedDraft = "keep this thread draft", callsBefore = f.calls.length;
  const blocked = vm.runInNewContext(sendRestoreGuard(), { activeThreadIdRef: f.context.activeThreadIdRef, loadingThread: false,
    workThreadRestoreState: f.state.restore, showAppToast: (...args) => f.notices.push(args), promptInput: failedDraft });
  await blocked(); assert.equal(f.calls.length, callsBefore, "error retry state cannot enter any ordinary send RPC");
  f.setRestoreFailure(false); await f.select();
  assert.equal(f.state.restore, null); assert.equal(f.context.workThreadContexts.current.get("thread-1"), f.receipt, "reselect retries the real restore producer");
  assert.equal(count(f, "thread/resume"), 0);
}
{
  const f = fixture({ kind: "ordinary", historyFailure: true }); await f.select();
  assert.equal(count(f, "thread/resume"), 2, "ordinary initial resume and historical fallback remain intact");
  assert.equal(f.context.workThreadContexts.current.size, 0);
}
{
  const f = fixture({ warm: true }); await f.select();
  assert.equal(count(f, "thread/resume"), 0); assert.equal(f.currentContext.value.forceResume, false);
  assert.equal(f.context.workThreadContexts.current.get("thread-1").collaborationMode.mode, "plan", "revisiting a confirmed loaded Work thread does not reset Plan");
}
for (const retirement of ["owner", "host", "navigation", "policy", "permission-choice", "abort"]) {
  const f = fixture({ pause: true }), pending = f.select(); await until(() => count(f, "work-restore") === 1);
  if (retirement === "owner") { f.context.executionIdentityRef.current = "new-owner"; f.context.committedWorkOwner.current = "new-owner"; }
  if (retirement === "host") f.context.committedWorkHost.current = "host-2";
  if (retirement === "navigation") f.context.navigationRequestRef.current++;
  if (retirement === "permission-choice") f.context.workPermissionRevision.current++;
  if (retirement === "abort") f.context.workThreadRestoreController.current.abort();
  const strict = { approvalPolicy: "never", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } };
  if (retirement === "policy") f.context.captureThreadExecutionPolicy("thread-1", strict);
  const before = f.context.threadExecutionPoliciesRef.current.get("thread-1");
  f.gate.resolve(); await pending;
  assert.equal(f.context.workThreadContexts.current.size, 0, `late ${retirement} ACK cannot publish a Work context`);
  assert.equal(f.context.threadExecutionPoliciesRef.current.get("thread-1"), before, `late ${retirement} ACK cannot overwrite current policy`);
}
for (const kind of ["work", "ordinary"]) {
  const f = fixture({ kind }); f.context.activeThreadIdRef.current = "thread-1";
  const resolved = await f.resolve(); assert.equal(resolved.policy.sandboxPolicy.type, "readOnly");
  assert.equal(count(f, "work-restore"), 1, "permission cache miss uses the same source-aware restore entry");
  assert.equal(count(f, "thread/resume"), kind === "work" ? 0 : 1);
}
{
  const f = fixture({ restoreFailure: true }); f.context.activeThreadIdRef.current = "thread-1";
  await assert.rejects(f.resolve()); assert.equal(count(f, "thread/resume"), 0, "missing permissions cannot bypass failed Work preparation");
}
for (const blocked of ["loading", "error", "ready"]) {
  let writes = 0, toggles = 0;
  const context = { activeRouteRef: { current: "thread" }, activeThreadId: "thread-1", loadingThread: blocked === "loading",
    workThreadRestoreState: blocked === "error" ? { threadId: "thread-1", status: "error" } : null,
    workPermissionRevision: { current: 0 }, planModeRef: { current: false },
    setPlanMode() { toggles++; }, applyCollaborationMode: async () => { writes++; }, showAppToast() {} };
  await vm.runInNewContext(callback("handleTogglePlanMode"), context)();
  assert.equal(writes, blocked === "ready" ? 1 : 0, "Plan cannot use an ordinary model while Work restoration is pending or failed");
  assert.equal(toggles, blocked === "ready" ? 1 : 0);
}
console.log("PASS actual App Work recovery: cold/non-prose source routing, real response hydration/policy, protected history fallback, ordinary resume preservation, warm Plan, permission cache miss, blocked Plan writes, and late owner/host/navigation/policy fences. VM services only; no live account/model/native execution.");
