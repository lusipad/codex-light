import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual App callbacks, not a second implementation of navigation.
const source = fs.readFileSync("src/App.tsx", "utf8");
const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let navigation, factory, send;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "commitNewThreadNavigation") navigation = node.initializer.arguments[0].getText(tree);
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "handleSendMessage") send = node.initializer.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(tree) === "useLayoutEffect"
    && node.arguments[0]?.getText(tree).includes("workNewChatFactory.current = prepare;")) factory = node.arguments[0].getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(navigation && factory && send);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const continuation = {};
vm.runInNewContext(compile(fs.readFileSync("src/navigationContinuation.ts", "utf8")), { exports: continuation });
const identity = { userId: "fixture", accountId: "fixture", generation: 1 };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  const calls = [], state = { session: null, access: true, target: "local", mode: "work", prompt: "existing draft", files: ["existing file"], capture: ["existing shot"] };
  const context = {
    ...continuation, Error, Object, Promise,
    modelAccountIdentity: "owner", executionIdentityRef: { current: "owner" }, committedWorkOwner: { current: "owner" },
    navigationRequestRef: { current: 3 }, activeRouteRef: { current: "settings" },
    appshotCaptureGenerations: { current: { "owner:home": 7 } }, workNewChatFactory: { current: null },
    personalizationNavigationGuardRef: { current: null }, worktreeCreationControllersRef: { current: new Map() },
    pendingNewThreadProjectRef: { current: { id: "existing project" } }, pendingProjectlessRef: { current: false },
    threadRequestRef: { current: 2 }, threadHistoryBufferRef: { current: { discard: () => calls.push("discard-history") } },
    finishedTurnIdsRef: { current: new Set() }, activeThreadIdRef: { current: "old-thread" }, attachmentScopeRef: { current: "thread:old-thread" },
    earlierRequestRef: { current: false },
    readAppshotWorkAccess: async () => { calls.push("access"); return state.access; },
    activateWorkHome: async () => { calls.push("save-mode"); return { preferences: { mode: { status: "value", value: state.mode } } }; },
    parseWorkHomePreferences: saved => saved.preferences,
    readWorkCaptureTarget: async input => { calls.push(["target", input]); if (state.pending) await state.pending.promise; return { status: "ready", location: state.target, preferences: { mode: { status: "value", value: state.mode } } }; },
    homeCloud: { setActive: value => { calls.push(["cloud", value]); return state.cloudBusy !== true; } }, flushSync: fn => fn(),
    setWorkHomeSession: value => { state.session = typeof value === "function" ? value(state.session) : value; },
    retireAppshotCapture: () => calls.push("retire-home"), setPermissionModes: () => calls.push("clear-permissions"),
    setComposerFocusRequest: () => calls.push("focus"), commitActiveRoute: route => calls.push(["route", route]),
    showAppToast: (...args) => calls.push(["toast", ...args]), handleSelectWorkspace: () => assert.fail("unexpected workspace selection"),
    tauriInvoke: () => assert.fail("unexpected project write"),
  };
  for (const name of ["setLoadingEarlierTurns", "setLoadingThread", "setHistoryError", "setIsStreaming", "setActiveThreadId", "setActiveTurnId", "setActiveThreadStatus", "setTurns", "setTurnsCursor", "setHasMoreTurns", "setPlanSteps", "setPlanExplanation", "setTurnDiffFiles", "setThreadUsage"]) context[name] = () => {};
  vm.createContext(context);
  vm.runInContext(compile(`var commitNewThreadNavigation = ${navigation}; (${factory})();`), context);
  const controller = new AbortController();
  return { context, calls, state, controller, prepare: () => context.workNewChatFactory.current("capture-id", identity, controller.signal) };
}
{
  const f = fixture(), plan = await f.prepare();
  assert.equal(plan.scope, "home"); assert.equal(plan.captureGeneration, 7);
  assert.deepEqual(f.calls, ["access"]); // prepare alone never writes or navigates.
  assert.equal(await plan.activate(f.controller.signal), true);
  assert.equal(f.context.activeRouteRef.current, "home"); assert.equal(f.state.session.target.location, "local");
  assert.equal(f.state.session.key, "capture-id"); assert.equal(f.state.session.navigation, 4);
  assert.equal(f.context.pendingNewThreadProjectRef.current.id, "existing project");
  assert.equal(f.state.prompt, "existing draft"); assert.deepEqual(f.state.files, ["existing file"]); assert.deepEqual(f.state.capture, ["existing shot"]);
  assert.equal(f.calls.some(value => ["retire-home", "focus", "clear-permissions"].includes(value)), false);
  assert.equal(Object.hasOwn(f.calls.find(value => Array.isArray(value) && value[0] === "target")[1], "preferences"), false); // fresh read after guard.
  await f.context.commitNewThreadNavigation();
  assert.equal(f.state.session, null); assert.ok(f.calls.includes("retire-home")); assert.ok(f.calls.includes("focus"));
}
{
  const f = fixture(); f.state.access = null;
  await assert.rejects(f.prepare(), /资格/); assert.deepEqual(f.calls, ["access"]);
}
for (const stale of ["owner", "generation", "navigation", "abort"]) {
  const f = fixture(), plan = await f.prepare();
  if (stale === "owner") f.context.committedWorkOwner.current = "new-owner";
  if (stale === "generation") f.context.appshotCaptureGenerations.current["owner:home"]++;
  if (stale === "navigation") f.context.navigationRequestRef.current++;
  if (stale === "abort") f.controller.abort();
  assert.equal(await plan.activate(f.controller.signal), false); assert.equal(f.calls.includes("save-mode"), false);
}
for (const action of ["approve", "cancel", "abort"]) {
  const f = fixture(); let pending;
  f.context.personalizationNavigationGuardRef.current = continuation => { pending = continuation; continuation.onDeferred(); return false; };
  const plan = await f.prepare(), operation = plan.activate(f.controller.signal);
  for (let i = 0; i < 10 && !pending; i++) await Promise.resolve();
  assert.ok(pending); assert.equal(f.state.session, null); assert.ok(f.calls.includes("save-mode"));
  if (action === "approve") pending();
  else if (action === "cancel") pending.onCancelled();
  else f.controller.abort();
  assert.equal(await operation, action === "approve");
  if (action !== "approve") { pending(); await Promise.resolve(); assert.equal(f.state.session, null); assert.equal(f.context.activeRouteRef.current, "settings"); }
}
for (const location of ["cloud", null]) {
  const f = fixture(); f.state.target = location;
  const plan = await f.prepare(); await assert.rejects(plan.activate(f.controller.signal), /云端|运行位置/);
  assert.equal(f.state.session.target, null); assert.equal(f.calls.includes("retire-home"), false);
}
{
  const f = fixture(); f.state.cloudBusy = true;
  const plan = await f.prepare(); await assert.rejects(plan.activate(f.controller.signal), /仍在发送/);
  assert.equal(f.state.session, null); assert.equal(f.context.activeRouteRef.current, "settings");
  assert.equal(f.calls.some(value => Array.isArray(value) && value[0] === "target"), false);
}
{
  const f = fixture(), plan = await f.prepare(); f.state.pending = deferred();
  const operation = plan.activate(f.controller.signal);
  for (let i = 0; i < 20 && !f.calls.some(value => Array.isArray(value) && value[0] === "target"); i++) await Promise.resolve();
  assert.equal(f.state.session.target, null);
  f.controller.abort(); f.state.pending.resolve(); assert.equal(await operation, false);
  assert.equal(f.state.session.target, null);
}
// The previously unconditional send block is now replaced by the real sender.
// Its actual callback tests cover preparation failures and ordinary fallthrough.
await import("./verify-work-local-send.mjs");
console.log("PASS actual App Work callbacks: explicit owner mode ACK, fresh post-guard target, home draft/project/generation preservation, no early focus, deferred approve/cancel/abort, stale owner/navigation/generation fences, cloud blocked, late target rejection and no ordinary-send fallback. Isolated VM; no real account, GUI or model calls.");
