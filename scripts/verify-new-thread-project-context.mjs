import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
  let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(value, `${name} production callback exists`);
  return ts.transpileModule(`(${value.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarProjects.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports });
const plain = value => JSON.parse(JSON.stringify(value));
const appshotModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/appshotContext.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: appshotModule.exports });
const root = "D:/projects/shared", second = "D:/projects/second";
const multi = { id: "multi", name: "Multi", rootPaths: [root, second], serverProjectId: "server-multi", createdAt: 1 };
const same = { id: "same", name: "Same", rootPaths: [root], serverProjectId: "server-same", createdAt: 2 };
const metadata = { selectedProjectId: "multi", localProjects: [multi, same], threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {} };
const executionModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/executionPolicy.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: executionModule.exports });
export function mountProjectContext({ pending = null, membership = metadata, workspace = root, threadId = null, start, turn, worktree = false, projectless = false, configuration, selectionPending = false } = {}) {
  const calls = [], state = { promptInput: "hello", turns: [] };
  const context = {
    ...module.exports, ...executionModule.exports, ...appshotModule.exports, promptInput: "hello", attachedFiles: [], isStreaming: false,
    appshots: [], appshotScope: `fixture-account:thread:${threadId}`, modelAccountIdentity: "fixture-account",
    clearSentAppshots() {},
    moveHomeAppshotsToThread: id => calls.push(["moveHomeAppshotsToThread", id]),
    activeThreadId: threadId, activeThreadIdRef: { current: threadId }, activeTurnIdRef: { current: null },
    pendingNewThreadProjectRef: { current: pending }, pendingProjectlessRef: { current: projectless }, sidebarProjectMembership: membership,
    activeWorkspace: { path: workspace }, handleSaveGoalRef: { current: null },
    pendingTurnIdRef: { current: null }, threadRequestRef: { current: 0 }, pendingAttachmentSaveRef: { current: null },
    attachmentScopeRef: { current: threadId ? `thread:${threadId}` : "home" },
    steerSendPendingRef: { current: new Set() }, sendStartPendingRef: { current: new Set() }, useWorktree: worktree, planMode: false,
    tauriInvoke: async (method, params) => { calls.push([method, plain(params)]); return { path: "D:/worktree" }; },
    permissionMode: "custom", selectedModelId: undefined, selectedModelName: undefined, reasoningEffort: null, reasoningSummary: "auto",
    sessionAllowNetwork: false, fastMode: false, models: [], console: { error() {}, warn() {} },
    selectionPending,
    executionIdentityRef: { current: "fixture-account" },
    navigationRequestRef: { current: 0 },
    activeRouteRef: { current: "home" },
    homeCloud: { active: false },
    personalizationNavigationGuardRef: { current: null },
    worktreeCreationControllersRef: { current: new Map() },
    AbortController,
    threadExecutionPoliciesRef: { current: new Map() },
    threadExecutionRevisionsRef: { current: new Map() },
    threadsRef: { current: threadId ? [{ id: threadId, cwd: workspace }] : [] },
    workspaceHintsRef: { current: {} },
    configRead: async () => ({ config: {} }),
    getModelConfiguration: () => {
      if (context.selectionPending) throw new Error("模型配置更新中");
      if (context.selectionInvalid) throw new Error("模型已不可用");
      return configuration || { model: context.selectedModelName || context.selectedModelId || "fixture-model", reasoningEffort: context.reasoningEffort, serviceTier: null };
    },
    hydrateThreadModel: (id, configuration) => calls.push(["hydrateThreadModel", id, plain(configuration)]),
    trackModelTurn: async (id, configuration, run) => {
      calls.push(["trackModelTurn", id, plain(configuration)]);
      const result = await run();
      calls.push(["trackedTurn", id, plain(result)]);
      return result;
    },
    isCurrentThreadRequest: (request, currentRequest, id, currentId) => request === currentRequest && id === currentId,
    persistThreadAttachments: async () => ({ errors: [] }),
    crypto: { randomUUID: () => "fixture-message-id" },
    callAppServer: async (method, params) => {
      calls.push([method, plain(params)]);
      if (method === "thread/start") {
        const response = start ? await start(params) : { thread: { id: "created", projectId: params.projectId } };
        return { approvalPolicy: params.approvalPolicy, approvalsReviewer: params.approvalsReviewer,
          sandbox: context.resolveConfiguredExecutionPolicy({ sandbox_mode: params.sandbox, approval_policy: params.approvalPolicy, approvals_reviewer: params.approvalsReviewer, ...params.config }, params.runtimeWorkspaceRoots ?? []).sandboxPolicy, ...response };
      }
      if (method === "thread/resume") return { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } };
      assert.equal(method, "turn/start", "this harness only crosses declared send boundaries");
      return turn ? turn(params) : { turn: { id: "turn-created" } };
    },
    refreshThreads: () => {},
    showAppToast: (...args) => calls.push(["toast", ...args]),
    goalSet: async (id, patch) => { calls.push(["goalSet", id, plain(patch)]); return patch; },
    buildGoalPrompt: text => `/goal ${text}`,
    moveHomePromptToThread: id => calls.push(["moveHomePromptToThread", id]),
    moveHomeAttachmentsToThread: id => calls.push(["moveHomeAttachmentsToThread", id]),
    setThreadPrompt: (_id, update) => { state.promptInput = typeof update === "function" ? update(state.promptInput) : update; },
  };
  for (const name of ["ActiveRoute", "Turns", "IsStreaming", "ActiveTurnId", "SidebarCreatedThread", "ActiveThreadId", "WorkspaceHints", "PromptInput", "AttachedFiles", "ShowGoalModal", "ServerGoal"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { state[key] = typeof value === "function" ? value(state[key] ?? {}) : value; };
  }
  const sandbox = vm.createContext(context);
  const worktreeClient = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/worktreeCreation.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: worktreeClient, require: () => ({ tauriInvoke: (...args) => context.tauriInvoke(...args) }), crypto: context.crypto });
  context.createEnvironmentWorktree = worktreeClient.createEnvironmentWorktree;
  context.createWorktree = vm.runInContext(callback("createWorktree"), sandbox);
  context.commitActiveRoute = context.setActiveRoute;
  context.setActiveRoute = vm.runInContext(callback("setActiveRoute"), sandbox);
  context.captureThreadExecutionPolicy = vm.runInContext(callback("captureThreadExecutionPolicy"), sandbox);
  context.resolveExecutionContext = vm.runInContext(callback("resolveExecutionContext"), sandbox);
  const send = vm.runInContext(callback("handleSendMessage"), sandbox);
  context.handleSendMessage = send;
  const goal = vm.runInContext(callback("handleSaveGoal"), sandbox);
  return { send, goal, context, state, calls };
}

{
  const view = mountProjectContext();
  await view.send();
  const start = view.calls.find(c => c[0] === "thread/start")?.[1];
  assert.equal(start.projectId, multi.serverProjectId, "cold-start draft must restore selected project, not only its highlight");
  assert.equal(start.cwd, root);
  assert.deepEqual(start.runtimeWorkspaceRoots, [root, second]);
  assert.deepEqual(view.calls.find(c => c[0] === "turn/start")[1].runtimeWorkspaceRoots, [root, second]);
}
for (const options of [
  { membership: { ...metadata, selectedProjectId: "same" }, expected: same },
  { pending: same, expected: same },
  { workspace: "d:\\PROJECTS\\SHARED\\", expected: multi },
]) {
  const view = mountProjectContext(options);
  await view.send();
  assert.equal(view.calls.find(c => c[0] === "thread/start")[1].projectId, options.expected.serverProjectId);
}
for (const options of [
  { workspace: "D:/legacy" },
  { membership: { ...metadata, selectedProjectId: null } },
  { membership: { ...metadata, selectedProjectId: "deleted" } },
]) {
  const view = mountProjectContext(options); await view.send();
  const start = view.calls.find(c => c[0] === "thread/start")[1];
  assert.equal(start.projectId, undefined, "legacy paths and invalid selection must not guess an entity by cwd");
  assert.equal(start.runtimeWorkspaceRoots, undefined);
}
{
  const view = mountProjectContext({ membership: { ...metadata, localProjects: [{ ...multi, serverProjectId: null }] } });
  await view.send();
  assert.equal(view.calls.some(c => c[0] === "thread/start" || c[0] === "turn/start"), false);
  assert.equal(view.state.promptInput, "hello");
  assert.ok(view.calls.some(c => c[0] === "toast"));
}
{
  const view = mountProjectContext({ threadId: "existing", workspace: "D:/unrelated", pending: multi, worktree: true });
  await view.send();
  assert.equal(view.calls.some(c => c[0] === "thread/start"), false);
  const turn = view.calls.find(c => c[0] === "turn/start")[1];
  assert.equal(turn.threadId, "existing");
  assert.equal(turn.cwd, undefined, "existing conversation must inherit its runtime cwd, not the sidebar project");
  assert.equal(turn.runtimeWorkspaceRoots, undefined);
  assert.equal(view.calls.some(c => c[0] === "git_worktree_create"), false, "existing sends must not create another worktree");
}
{
  const view = mountProjectContext({ worktree: true });
  await view.send();
  assert.equal(view.calls.filter(c => c[0] === "git_worktree_create").length, 1);
  for (const method of ["thread/start", "turn/start"]) {
    const params = view.calls.find(c => c[0] === method)[1];
    assert.equal(params.cwd, "D:/worktree");
    assert.deepEqual(params.runtimeWorkspaceRoots, ["D:/worktree", second]);
  }
}
{
  const view = mountProjectContext();
  await view.goal("test objective");
  const starts = view.calls.filter(c => c[0] === "thread/start");
  assert.equal(starts.length, 1, "goal creation and immediate send must share the newly created thread before React commits");
  assert.equal(starts[0][1].projectId, multi.serverProjectId);
  assert.deepEqual(starts[0][1].runtimeWorkspaceRoots, [root, second]);
  assert.equal(view.calls.find(c => c[0] === "goalSet")[1], "created");
  assert.equal(view.calls.find(c => c[0] === "turn/start")[1].threadId, "created");
}
for (const action of ["send", "goal"]) {
  const view = mountProjectContext({ projectless: true, worktree: true });
  await view[action]("projectless request");
  const params = view.calls.find(call => call[0] === "thread/start")[1];
  assert.equal(params.projectId, null);
  assert.equal(params.cwd, undefined);
  assert.equal(params.runtimeWorkspaceRoots, undefined);
  assert.equal(view.calls.some(call => call[0] === "git_worktree_create"), false);
  assert.equal(view.context.pendingProjectlessRef.current, false);
}
console.log("PASS production send/goal callbacks: selected project, explicit projectless send/goal without cwd/worktree, draft precedence, missing mapping and single goal-created thread (L2)");

for (const action of ["send", "goal"]) for (const outcome of ["setup-rejected", "cancelled"]) {
  const view = mountProjectContext({ worktree: true });
  let finish;
  view.context.tauriInvoke = async (method, params) => {
    view.calls.push([method, plain(params)]);
    if (method === "git_worktree_create_cancel") return;
    assert.equal(method, "git_worktree_create");
    assert.equal(params.sourceCwd, root);
    assert.equal(params.startingMode, "HEAD");
    assert.equal(params.branchName, null);
    assert.equal(params.ownerThreadId, null);
    assert.equal(params.operationId, "fixture-message-id");
    if (outcome === "setup-rejected") throw Error("fixture setup script failed");
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = view[action](action === "goal" ? "setup must complete first" : undefined);
  if (outcome === "cancelled") {
    assert.equal(typeof finish, "function", "setup creation must be in flight before cancellation");
    for (const controller of view.context.worktreeCreationControllersRef.current.keys()) controller.abort();
    finish({ path: "D:/preserved-after-cancel" });
  }
  await pending;
  assert.equal(view.calls.some(([method]) => ["thread/start", "turn/start", "goalSet"].includes(method)), false, `${action}/${outcome}: setup cannot fall through into execution`);
  assert.equal(view.state.promptInput, "hello", "setup failure or cancellation preserves the draft");
  assert.equal(view.context.worktreeCreationControllersRef.current.size, 0);
  if (outcome === "cancelled") assert.equal(view.calls.filter(([method]) => method === "git_worktree_create_cancel").length, 1);
}
{
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("route !== activeRoute")) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(effect, "actual route-scoped worktree cancellation effect exists");
  const view = mountProjectContext({ worktree: true });
  let finish;
  view.context.tauriInvoke = async (method, params) => {
    view.calls.push([method, plain(params)]);
    if (method === "git_worktree_create_cancel") return;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = view.send();
  const runEffect = vm.runInNewContext(ts.transpileModule(`(${effect.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, view.context);
  const controller = [...view.context.worktreeCreationControllersRef.current.keys()][0];
  assert.ok(controller);
  assert.equal(view.context.activeRouteRef.current, "thread", "production route setter records the intended route synchronously");
  view.context.activeRoute = "thread"; runEffect();
  assert.equal(controller.signal.aborted, false, "home to thread during send cannot cancel its own setup");
  view.context.setActiveRoute("settings"); view.context.activeRoute = "settings"; runEffect();
  assert.equal(controller.signal.aborted, true, "actual navigation away cancels the exact pending setup");
  finish({ path: "D:/preserved-after-navigation" }); await pending;
  assert.equal(view.calls.some(([method]) => ["thread/start", "turn/start"].includes(method)), false);
}
console.log("PASS worktree setup production wrapper/client: send and goal await setup, explicit failure/cancel preserve drafts without execution, real route transitions cancel only on leaving");

for (const change of ["selected-project", "selected-roots"]) {
  let scopeExpression, cancellationEffect;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "worktreeProjectScope") scopeExpression = node.initializer;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast).includes("worktreeProjectScope")) cancellationEffect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(scopeExpression && cancellationEffect, "real project scope participates in setup cancellation");
  const view = mountProjectContext({ worktree: true });
  let finish;
  view.context.tauriInvoke = async (method, params) => {
    view.calls.push([method, plain(params)]);
    if (method === "git_worktree_create_cancel") return;
    return new Promise(resolve => { finish = resolve; });
  };
  const evaluate = text => vm.runInNewContext(ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, view.context);
  const pending = view.send(), controller = [...view.context.worktreeCreationControllersRef.current.keys()][0];
  assert.ok(controller);
  const before = evaluate(scopeExpression.getText(ast));
  const cleanup = evaluate(cancellationEffect.getText(ast))();
  view.context.sidebarProjectMembership = { ...metadata, selectedProjectId: change === "selected-project" ? "same" : "multi",
    localProjects: change === "selected-roots" ? [{ ...multi, rootPaths: [root, "D:/changed-second-root"] }, same] : metadata.localProjects };
  assert.notEqual(evaluate(scopeExpression.getText(ast)), before, "same first root cannot hide project identity or additional roots changing");
  cleanup();
  assert.equal(controller.signal.aborted, true, "project/root metadata change immediately cancels setup rather than merely rejecting the later chat");
  finish({ path: "D:/preserved-after-project-change" }); await pending;
  assert.equal(view.calls.some(([method]) => ["thread/start", "turn/start"].includes(method)), false);
}
console.log("PASS worktree project scope: switching same-root projects or changing selected additional roots cancels the in-flight creation operation");
