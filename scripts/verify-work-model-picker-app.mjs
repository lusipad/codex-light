import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = []; const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)?.initializer;
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const evaluate = (node, context) => { assert.ok(node, "actual App expression exists"); return vm.runInNewContext(compile(`(${node.getText(ast)})`), context); };
const callback = (name, context) => evaluate(variable(name)?.arguments[0], context);
const identity = { accountId: "work-account", userId: "work-user", generation: 3 };
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture() {
  let now = 0, serial = 0, identities = 0;
  const timers = new Map(), calls = [], rpc = [], notices = [], moduleCache = new Map();
  const config = { requirements: null, config: {}, pauseIdentityAt: 0, identityGate: null, identity: { ...identity }, rpcImmediate: false };
  const load = file => {
    if (moduleCache.has(file)) return moduleCache.get(file);
    const exports = {}; moduleCache.set(file, exports);
    vm.runInNewContext(compile(fs.readFileSync(file, "utf8")), { exports, AbortController, Promise,
      setTimeout: (callback, ms) => { const id = ++serial; timers.set(id, { at: now + ms, callback }); return id; }, clearTimeout: id => timers.delete(id),
      require: name => name === "./chatgptService" ? { readChatgptService: () => assert.fail("pure native adaptation must not read account models") }
        : load(`src/${name.slice(2)}.ts`) });
    return exports;
  };
  const context = {
    ...load("src/executionPolicy.ts"), ...load("src/workModelPermissionDecision.ts"), ...load("src/workModelCatalog.ts"),
    createWorkThreadModelSelectionController: load("src/workThreadModelSelection.ts").createWorkThreadModelSelectionController,
    AbortController, modelAccountIdentity: "owner", workHostIdentity: "local-host", committedWorkOwner: { current: "owner" }, committedWorkHost: { current: "local-host" },
    activeThreadIdRef: { current: "thread-one" }, threadRequestRef: { current: 1 },
    workModelRequest: { current: 0 }, workModelCommitting: { current: new Map() }, workNativeModelController: { current: null },
    workHomeModelCommitting: { current: false }, workHomeModelRevision: { current: 0 }, sendStartPendingRef: { current: new Set() },
    workPermissionRevision: { current: 4 }, threadExecutionRevisionsRef: { current: new Map([["thread-one", 2]]) },
    threadExecutionPoliciesRef: { current: new Map([["thread-one", { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false }, sandbox: "read-only" }]]) },
    workThreadContexts: { current: new Map() }, workNativeModelInputs: { current: { models: [
      { id: "runtime-a", model: "native-a", supportedReasoningEfforts: ["medium", "high"] },
      { id: "runtime-b", model: "native-b", supportedReasoningEfforts: ["medium", "high"] },
    ], modelsLoading: false, connected: true } }, appServerStatus: { connected: true },
    setWorkModelState: value => { context.modelState = typeof value === "function" ? value(context.modelState) : value; },
    setWorkModelRevision() {}, setWorkMessageRevision() {}, showAppToast: (...args) => notices.push(args),
    serviceIdentity: async () => { calls.push(["identity"]); if (++identities === config.pauseIdentityAt) await config.identityGate.promise; return { ...config.identity }; },
    configRead: async cwd => { calls.push(["config", cwd]); return { config: config.config }; },
    configRequirementsRead: async () => { calls.push(["requirements"]); return { requirements: config.requirements }; },
    callAppServer: async (method, params) => { calls.push([method, plain(params)]); if (config.rpcImmediate) return {}; const pending = deferred(); rpc.push(pending); return pending.promise; },
    homeWorkspace: { path: "C:/project" }, permissionMode: "custom", sessionAllowNetwork: false,
    activeWorkspace: { path: "C:/project" }, sidebarProjectMembership: { localProjects: [{ id: "project", serverProjectId: "server-project", rootPaths: ["C:/project"] }] },
    committedWorkDraftPolicy: { current: "draft-policy" }, fileDedupeKey: value => value.replaceAll("\\", "/").toLowerCase(),
    modelSelection: { eligibilityContext: {} },
    findModel: (models, id) => models.find(model => model.id === id), getDefaultModel: models => models[0],
  };
  const receipt = { scope: { identity: { ...identity }, hostIdentity: "local-host" }, threadId: "thread-one", serviceName: "codex_work_desktop", originator: "codex_work_desktop",
    cwd: "C:/project", projectId: "project", model: "native-a", reasoningEffort: "medium", guardianApprovalEnabledByStatsig: false, permissionProfileId: null,
    collaborationMode: { mode: "plan", settings: { model: "native-a", reasoning_effort: "medium", developer_instructions: null } } };
  context.workThreadContexts.current.set("thread-one", receipt);
  for (const name of ["confirmWorkModelPermissions", "confirmHomeWorkModel", "onWorkHomeModelApplied", "commitHomeWorkModel", "commitHomeWorkVersion", "selectWorkThreadModel"]) context[name] = callback(name, context);
  const effect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect"
    && node.arguments[0]?.getText(ast).includes("workNativeModelController.current = controller"));
  const cleanup = evaluate(effect?.arguments[0], context)();
  const advance = async ms => { now += ms; for (;;) { const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break; timers.delete(due[0]); due[1].callback(); await flush(); } await flush(); };
  return { context, receipt, calls, rpc, notices, config, cleanup, advance, identityReads: () => identities };
}
const updateCalls = f => f.calls.filter(([name]) => name === "thread/settings/update");
{
  const f = fixture(); let permissionInput;
  f.context.getModelConfiguration = () => ({ model: "native-a", reasoningEffort: "medium", serviceTier: null });
  f.context.confirmWorkModelPermissions = async input => { permissionInput = input; return true; };
  const prepared = { identity, target: { selectedWorkProject: { type: "local", projectId: "project" } },
    hostModels: f.context.workNativeModelInputs.current.models, isWorkModel: false, model: "chat-only", reasoningEffort: "ultra",
    execution: { defaultEnableFeatures: {} } };
  assert.equal(await f.context.confirmHomeWorkModel({ slug: "native-b-wm", thinkingEffort: "extended" }, prepared, new AbortController().signal), true);
  assert.equal(permissionInput.currentModel, "native-a", "Chat home selection must not masquerade as the previous native model");
  assert.equal(permissionInput.currentEffort, "medium", "native ultra confirmation compares actual previous native effort");
  f.cleanup();
}
{
  const f = fixture(); f.context.homeWorkspace = { path: "C:/ordinary-a" }; f.context.activeWorkspace = { path: "C:/ordinary-a" };
  f.context.sidebarProjectMembership.localProjects = [{ id: "work-b", serverProjectId: "server-b", rootPaths: ["C:/work-b"] }];
  const prepared = { identity, target: { selectedWorkProject: { type: "local", projectId: "work-b" } },
    hostModels: f.context.workNativeModelInputs.current.models, model: "native-a", reasoningEffort: "medium", execution: { defaultEnableFeatures: { guardian_approval: false } } };
  assert.equal(await f.context.confirmHomeWorkModel({ slug: "native-b-wm", thinkingEffort: "extended" }, prepared, new AbortController().signal), true);
  assert.deepEqual(f.calls.filter(([name]) => name === "config").map(([, cwd]) => cwd), ["C:/work-b", "C:/work-b"], "Work project B must never use ordinary home A to prove permissions"); f.cleanup();
}
for (const scenario of ["multi-root", "missing-project", "unconfirmed-server", "remote-materialization", "no-project"]) {
  const f = fixture(), selected = { type: "local", projectId: "project" };
  f.context.activeWorkspace = { path: "C:/unrelated" };
  if (scenario === "multi-root") f.context.sidebarProjectMembership.localProjects[0].rootPaths.push("C:/second");
  if (scenario === "missing-project") selected.projectId = "missing";
  if (scenario === "unconfirmed-server") f.context.sidebarProjectMembership.localProjects[0].serverProjectId = null;
  if (scenario === "remote-materialization") selected.projectId = "g-p-remote";
  const prepared = { identity, target: { selectedWorkProject: scenario === "no-project" ? null : selected }, hostModels: [], execution: {} };
  await assert.rejects(f.context.confirmHomeWorkModel({ slug: "native-b-wm" }, prepared, new AbortController().signal));
  assert.equal(f.calls.length, 0, `${scenario}: unknown Work cwd cannot borrow ordinary home config`); f.cleanup();
}
{
  const f = fixture(); f.context.sidebarProjectMembership.localProjects[0].rootPaths.push("C:/second");
  f.context.activeWorkspace = { path: "c:\\SECOND" };
  const prepared = { identity, target: { selectedWorkProject: { type: "local", projectId: "project" } },
    hostModels: f.context.workNativeModelInputs.current.models, model: "native-a", reasoningEffort: "medium", execution: { defaultEnableFeatures: {} } };
  assert.equal(await f.context.confirmHomeWorkModel({ slug: "native-b-wm", thinkingEffort: "extended" }, prepared, new AbortController().signal), true);
  assert.deepEqual(f.calls.filter(([name]) => name === "config").map(([, cwd]) => cwd), ["C:/second", "C:/second"]); f.cleanup();
}
for (const retirement of ["abort", "owner", "host", "permission", "draft-policy"]) {
  const f = fixture(), gate = deferred(), signal = new AbortController();
  f.context.configRead = async cwd => { f.calls.push(["config", cwd]); await gate.promise; return { config: {} }; };
  const prepared = { identity, target: { selectedWorkProject: { type: "local", projectId: "project" } },
    hostModels: f.context.workNativeModelInputs.current.models, model: "native-a", reasoningEffort: "medium", execution: { defaultEnableFeatures: {} } };
  const pending = f.context.confirmHomeWorkModel({ slug: "native-b-wm", thinkingEffort: "extended" }, prepared, signal.signal);
  if (retirement === "abort") signal.abort();
  else if (retirement === "owner") f.context.committedWorkOwner.current = "another-owner";
  else if (retirement === "host") f.context.committedWorkHost.current = "another-host";
  else if (retirement === "permission") f.context.workPermissionRevision.current++;
  else f.context.committedWorkDraftPolicy.current = "changed-project";
  gate.resolve(); await assert.rejects(pending);
  assert.equal(f.calls.filter(([name]) => name === "identity").length, 0, `${retirement}: retired initial config cannot proceed to permission proof`); f.cleanup();
}
{
  const f = fixture(), configuration = { model: "native-b", reasoningEffort: "high", serviceTier: null };
  const selecting = f.context.selectWorkThreadModel(configuration);
  assert.equal(f.context.workModelCommitting.current.has("thread-one"), true);
  await f.advance(320); assert.equal(updateCalls(f).length, 1); assert.equal(f.context.workThreadContexts.current.get("thread-one"), f.receipt);
  assert.deepEqual(updateCalls(f)[0][1], { threadId: "thread-one", model: "native-b", effort: "high", multiAgentMode: "explicitRequestOnly" });
  f.rpc[0].resolve({}); await selecting;
  const actual = f.context.workThreadContexts.current.get("thread-one"); assert.equal(actual.model, "native-b"); assert.equal(actual.collaborationMode.mode, "plan");
  assert.equal(f.context.workModelCommitting.current.size, 0); assert.equal(f.context.modelState.pending, false);
  assert.equal(f.calls.some(([method]) => ["config/value/write", "config/batchWrite", "desktop_state_set"].includes(method)), false, "native thread choice never writes ordinary defaults/last/home");
  f.cleanup();
}
for (const retirement of ["notification", "owner", "host", "disconnect"]) {
  const f = fixture(), selecting = f.context.selectWorkThreadModel({ model: "native-b", reasoningEffort: "high", serviceTier: null }); await f.advance(320);
  if (retirement === "notification") f.context.workThreadContexts.current.set("thread-one", { ...f.receipt, reasoningEffort: "low" });
  else if (retirement === "owner") f.context.committedWorkOwner.current = "other-owner";
  else if (retirement === "host") f.context.committedWorkHost.current = "other-host";
  else f.context.workNativeModelInputs.current.connected = false;
  const actual = f.context.workThreadContexts.current.get("thread-one"); f.rpc[0].resolve({}); await selecting;
  assert.equal(f.context.workThreadContexts.current.get("thread-one"), actual, `App ${retirement} guard rejects stale ACK projection`); f.cleanup();
}
for (const retirement of ["permission", "policy", "disconnect"]) {
  const f = fixture(); f.config.pauseIdentityAt = 3; f.config.identityGate = deferred();
  const selecting = f.context.selectWorkThreadModel({ model: "native-b", reasoningEffort: "high", serviceTier: null }); await f.advance(320);
  assert.equal(f.identityReads(), 3, "real App wrapper identity preflight is actually pending after permission confirmation");
  if (retirement === "permission") f.context.workPermissionRevision.current++;
  else if (retirement === "policy") f.context.threadExecutionRevisionsRef.current.set("thread-one", 3);
  else f.context.workNativeModelInputs.current.connected = false;
  f.config.identityGate.resolve(); await flush();
  assert.equal(updateCalls(f).length, 0, `${retirement} changes during the wrapper's final identity await must prevent the RPC, not only its ACK projection`);
  await selecting; f.cleanup();
}
{
  const f = fixture(), selecting = f.context.selectWorkThreadModel({ model: "native-b", reasoningEffort: "high", serviceTier: null }); await f.advance(320);
  f.rpc[0].reject(Error("settings denied")); await selecting;
  assert.equal(f.context.workThreadContexts.current.get("thread-one"), f.receipt, "rejected settings ACK cannot become local success");
  assert.equal(f.context.workModelCommitting.current.size, 0); assert.equal(f.context.modelState.pending, false);
  assert.match(f.context.modelState.error, /settings denied/); f.cleanup();
}
{
  const f = fixture(); f.config.requirements = { autoReview: { requiredOnModels: ["native-b"] } };
  await f.advance(0); const selecting = f.context.selectWorkThreadModel({ model: "native-b", reasoningEffort: "high", serviceTier: null }); await f.advance(320); await selecting;
  assert.equal(updateCalls(f).length, 0, "missing guardian confirmation is not a successful native selection"); assert.ok(f.notices.length); f.cleanup();
}
{
  const f = fixture(), applied = deferred(), commits = [];
  f.context.workHomeModels = { commit: selection => { commits.push(selection); return applied.promise; }, saveVersion: async version => { commits.push(version); return true; } };
  const selection = { slug: "native-b-wm", thinkingEffort: "extended", versionId: "actual-version" };
  const pending = f.context.commitHomeWorkModel(selection); assert.equal(f.context.workHomeModelCommitting.current, true);
  assert.equal(await f.context.commitHomeWorkModel(selection), false, "committing home cannot dispatch another consumer");
  applied.resolve(true); assert.equal(await pending, true); assert.equal(commits[0], selection); assert.equal(f.context.workHomeModelCommitting.current, false);
  const version = { versionId: "older", selectionMode: "model" }; assert.equal(await f.context.commitHomeWorkVersion(version), true); assert.equal(commits[1], version);
  assert.equal(f.context.workHomeModelRevision.current, 2);
  const hook = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useWorkHomeModelSelection");
  Object.assign(f.context, { workHomeSession: { key: "home-entry", target: { identity } }, appshots: [{}], attachedFiles: [], appServerStatus: { appServerVersion: "0.165.0" } });
  const input = evaluate(hook.arguments[0], f.context);
  assert.equal(input.entryKey, "home-entry"); assert.equal(input.target, f.context.workHomeSession.target); assert.equal(input.hasAttachments, true);
  assert.equal(input.confirmNativeSelection, f.context.confirmHomeWorkModel); assert.equal(input.onApplied, f.context.onWorkHomeModelApplied);
  f.cleanup();
}
let nativeComposer = variable("renderThreadComposer").body;
while (ts.isParenthesizedExpression(nativeComposer)) nativeComposer = nativeComposer.expression;
const nativeAttribute = name => (ts.isJsxSelfClosingElement(nativeComposer) ? nativeComposer : nativeComposer.openingElement).attributes.properties
  .find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === name)?.initializer?.expression;
{
  const f = fixture(), selections = [];
  Object.assign(f.context, { activeWorkContext: f.receipt, selectWorkThreadModel: value => selections.push(value), models: f.context.workNativeModelInputs.current.models,
    handleSelectComposerModel: () => assert.fail("Work reached ordinary default setter"), setReasoningEffort: () => assert.fail("Work reached ordinary effort setter"),
    modelSelection: { selectConfiguration: () => assert.fail("Work reached ordinary recent/default writer"), eligibilityContext: {} } });
  evaluate(nativeAttribute("onSelectModel"), f.context)("runtime-b", false);
  evaluate(nativeAttribute("onSelectReasoningEffort"), f.context)("high");
  const configuration = { model: "native-b", reasoningEffort: "high", serviceTier: null };
  evaluate(nativeAttribute("onSelectConfiguration"), f.context)(configuration);
  assert.equal(selections[0].model, "native-b"); assert.equal(selections[0].serviceTier, null); assert.equal(selections[1].model, "native-a"); assert.equal(selections[2], configuration);
  Object.assign(f.context, { workHomeSession: { key: "entry" }, workHomeModels: { catalog: {}, selection: {}, versionPreference: null, loading: false, pending: false, error: "", refresh() {} },
    modelAccountIdentity: "owner", workHostIdentity: "host", activeRoute: "home" });
  const picker = evaluate(variable("homeWorkPicker"), f.context); assert.equal(picker.onCommit, f.context.commitHomeWorkModel); assert.equal(picker.onVersionPreference, f.context.commitHomeWorkVersion);
  f.context.homeWorkPicker = picker; assert.equal(evaluate(nativeAttribute("workModelPicker"), f.context), picker);
  const homePicker = nodes.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === "workModelPicker" && node.initializer.expression.getText(ast) === "homeWorkPicker");
  assert.ok(homePicker, "real home JSX passes the specialized picker consumer"); f.cleanup();
}
for (const pending of ["home", "thread", "chat"]) {
  const f = mountProjectContext({ threadId: pending === "thread" ? "existing" : null });
  if (pending === "home") f.context.workHomeModelCommitting.current = true;
  if (pending === "thread") f.context.workModelCommitting.current.set("existing", 1);
  if (pending === "chat") { f.context.workHomeSession = { key: "chat-selection" }; f.context.workHomePickerRef.current = { pending: false, isWorkModel: false }; }
  await f.send(); assert.equal(f.calls.filter(([method]) => method !== "toast").length, 0, `${pending} selection cannot dispatch ordinary CLI with an old model`); assert.equal(f.state.promptInput, "hello");
}
{
  const f = mountProjectContext({ threadId: "existing" }), read = deferred(); f.context.readWorkThreadProvenance = () => read.promise;
  const pending = f.send(); f.context.workModelRequest.current++; read.resolve(null); await pending;
  assert.equal(f.calls.some(([method]) => method === "turn/start" || method === "thread/start"), false, "model revision changes during preflight retire the old submit");
}
{
  const context = { activeThreadId: "thread-one", loadingThread: false, workThreadRestoreState: { threadId: "thread-one", status: "error" },
    workPermissionRevision: { current: 4 }, planModeRef: { current: false }, setPlanMode: () => assert.fail("restore guard must keep Plan unchanged"),
    applyCollaborationMode: () => assert.fail("restore guard must not write mode"), showAppToast() {} };
  await callback("handleTogglePlanMode", context)(); assert.equal(context.workPermissionRevision.current, 4);
}
console.log("PASS actual App Work picker callbacks/JSX: native real controller/permission/config ACK, source fences, home/version hook boundary, no ordinary default writes, pending/revision/Chat submit guards and restore Plan guard. Offline AST/VM; no DOM, GUI or live service claimed.");
