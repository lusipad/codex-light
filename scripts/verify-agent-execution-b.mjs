import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";
import { mountReviewContext } from "./verify-review-actions.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/executionPolicy.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports });
const { resolveConfiguredExecutionPolicy: configured, resolvePresetExecutionPolicy: preset } = module.exports;
const granular = { sandbox_approval: false, rules: false, mcp_elicitations: true, request_permissions: true };
const custom = {
  sandbox_mode: "workspace-write", approval_policy: { granular }, approvals_reviewer: "auto_review",
  sandbox_workspace_write: { writable_roots: ["E:/extra"], network_access: true, exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
  model_reasoning_summary: "none", web_search: "disabled", model_verbosity: "high",
};
for (const config of [{}, { sandbox_mode: "read-only", approval_policy: "untrusted", model_reasoning_summary: "concise" }, custom]) {
  const view = mountProjectContext();
  const reads = [];
  view.context.sessionAllowNetwork = true;
  view.context.configRead = async (...args) => { reads.push(args); return { config }; };
  await view.send();
  assert.deepEqual(reads, [["D:/projects/shared", true]], "actual cwd effective config must be read before new-thread execution");
  const start = view.calls.find(([method]) => method === "thread/start")?.[1];
  const turn = view.calls.find(([method]) => method === "turn/start")?.[1];
  assert.ok(start && turn);
  const expected = plain(configured(config, start.runtimeWorkspaceRoots));
  assert.deepEqual(turn.sandboxPolicy, expected.sandboxPolicy);
  assert.deepEqual(turn.approvalPolicy, expected.approvalPolicy);
  assert.equal(turn.approvalsReviewer, expected.approvalsReviewer);
  assert.equal(start.sandbox, expected.sandbox);
  assert.equal(turn.summary, config.model_reasoning_summary);
  for (const key of ["web_search", "model_verbosity", "model_reasoning_summary"]) {
    assert.equal(start.config[key], config[key]);
    assert.equal(key in turn, false, "configuration keys cannot become invented turn RPC fields");
  }
  if (config === custom) {
    assert.deepEqual(start.config.sandbox_workspace_write.writable_roots, ["E:/extra"]);
    assert.equal(start.config.sandbox_workspace_write.network_access, true);
    assert.equal(start.config.sandbox_workspace_write.exclude_slash_tmp, true);
    assert.equal(start.config.sandbox_workspace_write.exclude_tmpdir_env_var, true);
  } else assert.equal(turn.sandboxPolicy.networkAccess, false, "legacy session network defaults cannot widen effective read-only permissions");
}
for (const mode of ["ask", "auto", "full"]) {
  const view = mountProjectContext();
  view.context.permissionMode = mode;
  view.context.sessionAllowNetwork = false;
  view.context.configRead = async () => ({ config: custom });
  await view.send();
  const start = view.calls.find(([method]) => method === "thread/start")[1];
  const turn = view.calls.find(([method]) => method === "turn/start")[1];
  const expected = plain(preset(mode, start.runtimeWorkspaceRoots, false));
  assert.deepEqual(turn.sandboxPolicy, expected.sandboxPolicy);
  assert.deepEqual(turn.approvalPolicy, expected.approvalPolicy);
  assert.equal(turn.approvalsReviewer, expected.approvalsReviewer);
}
{
  const view = mountProjectContext({ threadId: "first" });
  const first = configured({ sandbox_mode: "danger-full-access" }, []);
  const second = configured({ sandbox_mode: "read-only", approval_policy: "untrusted" }, []);
  view.context.threadExecutionPoliciesRef.current.set("first", first);
  view.context.threadExecutionPoliciesRef.current.set("second", second);
  view.context.configRead = async () => { throw Error("existing thread must not consume newly saved defaults"); };
  await view.send();
  assert.equal(view.calls.find(([method]) => method === "turn/start")[1].sandboxPolicy.type, "dangerFullAccess");
  view.calls.length = 0;
  view.context.activeThreadId = "second"; view.context.activeThreadIdRef.current = "second"; view.context.threadRequestRef.current++;
  await view.send();
  const turn = view.calls.find(([method]) => method === "turn/start")[1];
  assert.equal(turn.sandboxPolicy.type, "readOnly");
  assert.equal(turn.approvalPolicy, "untrusted");
  assert.equal("summary" in turn, false, "existing threads retain server summary when the user has not overridden it");
  assert.equal(view.calls.some(([method]) => method === "thread/start"), false);
}
for (const mutate of [
  view => { view.context.threadRequestRef.current++; view.context.activeThreadIdRef.current = "elsewhere"; },
  view => { view.context.navigationRequestRef.current++; },
  view => { view.context.executionIdentityRef.current = "another-account"; },
]) {
  const view = mountProjectContext();
  let finish;
  view.context.configRead = () => new Promise(resolve => { finish = resolve; });
  const sending = view.send();
  await flush(); mutate(view); finish({ config: custom }); await sending;
  assert.equal(view.calls.some(([method]) => ["thread/start", "turn/start"].includes(method)), false, "late config cannot submit after navigation or identity changes");
}
{
  const view = mountProjectContext({ worktree: true });
  const reads = [];
  view.context.configRead = async cwd => { reads.push(cwd); return { config: custom }; };
  await view.send();
  assert.deepEqual(reads, ["D:/worktree"], "worktree's actual target cwd determines effective config");
}
{
  const view = mountProjectContext({ start: async () => ({ thread: { id: "server-restricted" }, approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } }) });
  view.context.configRead = async () => ({ config: custom });
  await view.send();
  const turn = view.calls.find(([method]) => method === "turn/start")[1];
  assert.equal(turn.sandboxPolicy.type, "readOnly", "authoritative server start permissions replace the requested policy");
  assert.equal(turn.approvalPolicy, "untrusted");
}
for (const config of [{ approval_policy: "unknown" }, { sandbox_mode: "unknown" }, { model_reasoning_summary: "invented" }]) {
  const view = mountProjectContext();
  view.context.configRead = async () => ({ config });
  await view.send();
  assert.equal(view.calls.some(([method]) => ["thread/start", "turn/start"].includes(method)), false);
  assert.equal(view.state.promptInput, "hello");
}
{
  const view = mountProjectContext({ start: async () => ({ thread: { id: "unconfirmed" }, sandbox: { type: "futurePolicy" } }) });
  await view.send();
  assert.equal(view.calls.some(([method]) => method === "turn/start"), false, "unknown authoritative start policy cannot be replaced with requested permissions");
}
{
  const view = mountProjectContext();
  view.context.configRead = async () => ({ config: custom });
  await view.goal("real default permissions");
  const start = view.calls.find(([method]) => method === "thread/start")[1];
  const turn = view.calls.find(([method]) => method === "turn/start")[1];
  assert.equal(start.config.model_reasoning_summary, "none");
  assert.equal(turn.sandboxPolicy.networkAccess, true);
  assert.equal(view.calls.filter(([method]) => method === "thread/start").length, 1);
}
{
  const view = mountReviewContext({ permissionMode: "custom", configRead: async () => ({ config: custom }) });
  const pending = view.start({ kind: "uncommitted" }); await flush();
  assert.equal(view.calls[0].name, "thread/start");
  assert.equal(view.calls[0].params.config.model_verbosity, "high");
  view.calls[0].resolve({ thread: { id: "review-custom" } }); await flush();
  assert.equal(view.calls[1].name, "turn/start");
  assert.equal(view.calls[1].params.sandboxPolicy.networkAccess, true);
  assert.deepEqual(plain(view.calls[1].params.approvalPolicy), { granular });
  view.calls[1].resolve({ turn: { id: "review-turn" } }); await pending;
}

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found);
  return ts.transpileModule(`(${found.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const oldFull = { approvalPolicy: "never", approvalsReviewer: "user", sandbox: { type: "dangerFullAccess" } };
const strictEvent = { threadSettings: { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } } };
for (const unknown of [false, true]) {
  const view = mountProjectContext({ threadId: "late-resume" });
  let finish;
  view.context.callAppServer = async (method, params) => {
    view.calls.push([method, plain(params)]);
    if (method === "thread/resume") return new Promise(resolve => { finish = resolve; });
    assert.equal(method, "turn/start"); return { turn: { id: "safe-turn" } };
  };
  const sending = view.send(); await flush();
  view.context.captureThreadExecutionPolicy("late-resume", unknown ? { threadSettings: { sandboxPolicy: { type: "future" } } } : strictEvent);
  finish(oldFull); await sending;
  const turn = view.calls.find(([method]) => method === "turn/start")?.[1];
  assert.equal(Boolean(turn), !unknown, "unknown authoritative event cannot resurrect an older resume policy");
  if (turn) assert.equal(turn.sandboxPolicy.type, "readOnly", "late fallback resume cannot overwrite an authoritative read-only event");
}
for (const branch of ["first-resume", "history-fallback", "identity-change"]) {
  const view = mountProjectContext({ threadId: "selection" });
  const context = view.context;
  Object.assign(context, {
    personalizationNavigationGuardRef: { current: null },
    beginThreadModelHydration: () => 0,
    reviewResultsRef: { current: { getRuns: () => [], hydrate() {} } },
    turnLifecycleRef: { current: 0 }, threadHistoryBufferRef: { current: { begin() {}, release: () => [] } },
    finishedTurnIdsRef: { current: new Set() }, earlierRequestRef: { current: false }, followTimelineRef: { current: false }, prependScrollRef: { current: null },
    normalizeTurnsFromList: () => [], normalizeTurnsFromThread: () => [], workspacesRef: { current: [] },
    listThreadAttachments: async () => [], mergeAttachmentItems: () => [], goalGet: async () => null,
  });
  for (const name of ["LoadingEarlierTurns", "LoadingThread", "HistoryError", "ThreadUsage", "ActiveThreadStatus", "PlanSteps", "TurnDiffFiles", "TurnsCursor", "HasMoreTurns"]) context[`set${name}`] = () => {};
  let finish, resumes = 0;
  context.callAppServer = async (method, params) => {
    view.calls.push([method, plain(params)]);
    if (method === "thread/read") return { thread: { id: "selection" } };
    if (method === "thread/turns/list") { if (branch === "history-fallback") throw Error("pagination unavailable"); return {}; }
    if (method === "thread/resume") {
      if (++resumes === 1 && branch === "history-fallback") return oldFull;
      return new Promise(resolve => { finish = resolve; });
    }
    assert.equal(method, "turn/start"); return { turn: { id: "selection-safe" } };
  };
  const selecting = vm.runInNewContext(callback("selectThread"), context)("selection"); await flush();
  assert.equal(typeof finish, "function");
  if (branch === "identity-change") { context.executionIdentityRef.current = "changed-account"; context.threadExecutionPoliciesRef.current.clear(); }
  else context.captureThreadExecutionPolicy("selection", strictEvent);
  finish(oldFull); await selecting;
  if (branch === "identity-change") assert.equal(context.threadExecutionPoliciesRef.current.has("selection"), false, "old-account resume cannot repopulate cleared permissions");
  else {
    await view.send();
    assert.equal(view.calls.find(([method]) => method === "turn/start")[1].sandboxPolicy.type, "readOnly", `${branch}: stale selectThread snapshot cannot widen the next turn`);
  }
}
{
  const view = mountProjectContext({ threadId: "plan-race" });
  view.context.captureThreadExecutionPolicy("plan-race", oldFull);
  view.context.planMode = true;
  let finish;
  view.context.applyCollaborationMode = () => new Promise(resolve => { finish = resolve; });
  const sending = view.send(); await flush();
  view.context.captureThreadExecutionPolicy("plan-race", strictEvent);
  finish(); await sending;
  assert.equal(view.calls.some(([method]) => method === "turn/start"), false, "Plan await cannot carry old full access past a newer permission event");
  assert.equal(view.state.promptInput, "hello");
}
{
  const view = mountReviewContext({ permissionMode: "custom", activeThreadIdRef: { current: "review-race" }, threadsRef: { current: [{ id: "review-race", cwd: "D:/repo" }] } });
  view.context.captureThreadExecutionPolicy("review-race", oldFull);
  const select = view.context.selectThread;
  view.context.selectThread = async id => { await select(id); view.context.captureThreadExecutionPolicy(id, strictEvent); };
  const pending = view.start({ kind: "uncommitted" }); await flush();
  assert.equal(view.calls[0].name, "turn/start");
  assert.equal(view.calls[0].params.sandboxPolicy.type, "readOnly", "review reads the authoritative permissions after asynchronous selection");
  view.calls[0].resolve({ turn: { id: "review-safe" } }); await pending;
}
{
  const view = mountProjectContext({ threadId: "queue-race" });
  view.context.captureThreadExecutionPolicy("queue-race", oldFull);
  let finish;
  Object.assign(view.context, {
    followupQueue: [{ id: "entry", text: "queued" }], queueMutationThreadsRef: { current: new Set() }, steeredQueueItemsRef: { current: new Map() },
    readWorkThreadProvenance: async () => null, workThreadContexts: { current: new Map() },
    setQueueMutationVersion() {}, handleSteerTurn() {}, setFollowupQueue() {}, refreshThreadQueue: async () => {},
    callAppServer: async (method, params) => {
      view.calls.push([method, plain(params)]);
      if (method === "thread/settings/update") return {};
      if (method === "thread/resume") return new Promise(resolve => { finish = resolve; });
      assert.fail(`unexpected execution after newer permission event: ${method}`);
    },
  });
  const starting = vm.runInNewContext(callback("handleStartServerQueue"), view.context)(); await flush();
  view.context.captureThreadExecutionPolicy("queue-race", strictEvent);
  finish(oldFull); await starting;
  assert.equal(view.context.threadExecutionPoliciesRef.current.get("queue-race").sandboxPolicy.type, "readOnly");
  assert.equal(view.calls.some(([method]) => method === "thread/queue/start"), false);
}
{
  const view = mountProjectContext({ threadId: "current" });
  view.context.threadExecutionPoliciesRef.current.set("current", configured(custom, []));
  view.context.captureThreadExecutionPolicy("current", { threadSettings: { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "futurePolicy" } } });
  assert.equal(view.context.threadExecutionPoliciesRef.current.has("current"), false, "unknown updated permissions invalidate the old snapshot");
  view.context.callAppServer = async () => { throw Error("permissions unavailable"); };
  await view.send();
  assert.equal(view.calls.some(([method]) => method === "turn/start"), false);
}
{
  function expression(name) {
    let found;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(found);
    return ts.transpileModule(`(${found.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }
  const context = { modelAccountIdentity: "account", activeThreadId: "first", activeWorkspace: { path: "D:/repo" },
    workPermissionRevision: { current: 0 },
    pendingProjectlessRef: { current: false }, permissionModes: {} };
  const readScope = () => {
    context.homeWorkspace = context.pendingProjectlessRef.current ? null : context.activeWorkspace;
    return vm.runInNewContext(expression("permissionScope"), context);
  };
  context.permissionScope = readScope();
  context.setPermissionModes = update => { context.permissionModes = update(context.permissionModes); };
  vm.runInNewContext(callback("setPermissionMode"), context)("full");
  assert.equal(vm.runInNewContext(expression("permissionMode"), context), "full");
  context.activeThreadId = "second"; context.permissionScope = readScope();
  assert.equal(vm.runInNewContext(expression("permissionMode"), context), "custom", "a new thread cannot inherit another thread's full-access preset");
  context.activeThreadId = null; context.permissionScope = readScope();
  assert.equal(vm.runInNewContext(expression("permissionMode"), context), "custom");
  const projectScope = context.permissionScope;
  context.pendingProjectlessRef.current = true; context.permissionScope = readScope();
  assert.notEqual(context.permissionScope, projectScope, "H01 a projectless draft must not use the previous project's permission slot");
  vm.runInNewContext(callback("setPermissionMode"), context)("full");
  context.pendingProjectlessRef.current = false; context.permissionScope = readScope();
  assert.equal(vm.runInNewContext(expression("permissionMode"), context), "custom", "returning to the project cannot inherit projectless full access");
  vm.runInNewContext(callback("setPermissionMode"), context)("ask");
  context.pendingProjectlessRef.current = true; context.permissionScope = readScope();
  assert.equal(vm.runInNewContext(expression("permissionMode"), context), "full", "the projectless draft retains only its own explicit preset");
  context.activeThreadId = "first"; context.modelAccountIdentity = "another-account"; context.permissionScope = readScope();
  assert.equal(vm.runInNewContext(expression("permissionMode"), context), "custom", "a new account cannot inherit a prior account's permission preset");
}
for (const failure of ["write", "confirmation", "unknown", "mismatch", null]) {
  const view = mountProjectContext({ threadId: "queued-thread" });
  view.context.threadExecutionPoliciesRef.current.set("queued-thread", configured(custom, ["D:/projects/shared"]));
  Object.assign(view.context, {
    followupQueue: [{ id: "entry", text: "queued" }], queueMutationThreadsRef: { current: new Set() }, steeredQueueItemsRef: { current: new Map() },
    setQueueMutationVersion() {}, handleSteerTurn() {}, setFollowupQueue() {}, refreshThreadQueue: async () => {},
    callAppServer: async (method, params) => {
      view.calls.push([method, plain(params)]);
      if (method === "thread/settings/update") { if (failure === "write") throw Error("write rejected"); return {}; }
      if (method === "thread/resume") {
        if (failure === "confirmation") throw Error("resume failed");
        if (failure === "unknown") return {};
        const policy = failure === "mismatch" ? configured({}, []) : configured(custom, ["D:/projects/shared"]);
        return { approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer, sandbox: policy.sandboxPolicy };
      }
      assert.equal(method, "thread/queue/start"); return { turn: { id: "queue-turn" } };
    },
  });
  await vm.runInNewContext(callback("handleStartServerQueue"), view.context)();
  assert.equal(view.calls.some(([method]) => method === "thread/queue/start"), failure === null, "queue starts only after effective permission confirmation");
  if (!failure) {
    const update = view.calls.find(([method]) => method === "thread/settings/update")[1];
    assert.deepEqual(update.approvalPolicy, { granular });
    assert.equal(update.sandboxPolicy.networkAccess, true);
  }
}
console.log("PASS AG-B06/B07 production App callbacks: cwd/worktree defaults, read-only, granular/network/roots/tmp, summary/web/verbosity, presets, thread isolation, stale navigation/identity, goal/review and queue write/readback failures");
