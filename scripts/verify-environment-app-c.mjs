import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = {};
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (["runEnvironmentAction", "handleEnvironmentActionResult"].includes(name)) nodes[name] = node.initializer.arguments[0];
    if (name === "environmentActionScope") nodes.scope = node.initializer;
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast) === "[environmentActionScope]") nodes.cleanup = node.arguments[0];
    if (node.expression.getText(ast) === "createShortcutMatcher") nodes.predicate = node.arguments[1];
  }
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "pendingAction") nodes.pendingAction = node.initializer.expression;
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of ["runEnvironmentAction", "handleEnvironmentActionResult", "scope", "cleanup", "predicate", "pendingAction"]) assert.ok(nodes[name], `production ${name} must exist`);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function mount() {
  const requests = [];
  const context = {
    environmentActionWaiter: { current: null }, environmentActionScopeRef: { current: "scope-one" }, pending: null, show: false, target: null,
    setTerminalTargetCwd(value) { context.target = value; },
    setPendingEnvironmentAction(value) { context.pending = typeof value === "function" ? value(context.pending) : value; },
    setShowTerminal(value) { context.show = value; },
    tauriInvoke(method, args) { requests.push({ method, args }); return Promise.resolve(); },
  };
  return {
    context, requests,
    run: vm.runInNewContext(compile(nodes.runEnvironmentAction), context),
    ack: vm.runInNewContext(compile(nodes.handleEnvironmentActionResult), context),
    cleanup: vm.runInNewContext(compile(nodes.cleanup), context)(),
  };
}
const request = id => ({ id, sessionId: `session-${id}`, cwd: "definition-root", workspaceCwd: "workspace-root" });
const outcome = promise => promise.then(() => "accepted", error => error.message);
{
  const view = mount(), first = outcome(view.run(request("one")));
  assert.equal(view.context.show, true);
  assert.equal(view.context.target, "definition-root");
  assert.equal(view.context.pending.workspaceCwd, "workspace-root");
  assert.equal(view.context.environmentActionWaiter.current.scope, "scope-one", "request captures synchronous render scope");
  assert.match(await outcome(view.run(request("two"))), /已有操作/, "single flight blocks concurrent dispatch");
  view.ack("old");
  assert.equal(view.context.environmentActionWaiter.current.id, "one");
  assert.equal(view.context.pending.id, "one", "old acknowledgment must not clear current request");
  view.ack("one");
  assert.equal(await first, "accepted");
  assert.equal(view.context.pending, null);
  assert.equal(view.context.environmentActionWaiter.current, null);
  const second = outcome(view.run(request("two")));
  view.ack("one", "late failure");
  assert.equal(view.context.environmentActionWaiter.current.id, "two", "late old failure cannot release new waiter");
  view.ack("two", "real IPC failure");
  assert.equal(await second, "real IPC failure");
  assert.equal(view.context.pending, null);
}
{
  const view = mount(), first = outcome(view.run(request("one")));
  const renderContext = {
    environmentActionWaiter: view.context.environmentActionWaiter,
    environmentActionScope: "scope-one", pendingEnvironmentAction: view.context.pending,
  };
  const renderPending = () => vm.runInNewContext(compile(nodes.pendingAction), renderContext);
  assert.equal(renderPending().id, "one", "same-scope render exposes queued operation");
  renderContext.environmentActionScope = "scope-two";
  assert.equal(renderPending(), null, "new-scope render masks old action before passive cleanup can run");
  assert.equal(view.context.pending.id, "one", "masking must work even while old state is still pending");
  view.context.environmentActionScopeRef.current = "scope-two";
  view.cleanup(); await first;
  const second = outcome(view.run(request("two")));
  renderContext.pendingEnvironmentAction = view.context.pending;
  assert.equal(renderPending().id, "two", "new request uses scopeRef updated by render");
  view.ack("two"); await second;
  assert.equal(renderPending(), null, "no waiter never exposes stale pending state");
}
for (const reason of ["scope change", "unmount"]) {
  const view = mount(), first = outcome(view.run(request("one")));
  view.cleanup();
  assert.match(await first, /上下文已变化/, `${reason} rejects pending promise`);
  assert.equal(view.context.pending, null);
  assert.equal(view.context.environmentActionWaiter.current, null);
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].method, "terminal_close");
  assert.equal(view.requests[0].args.sessionId, "session-one");
  view.cleanup();
  assert.equal(view.requests.length, 1, "cleanup is idempotent after releasing waiter");
  const next = outcome(view.run(request("two")));
  view.ack("one");
  assert.equal(view.context.pending.id, "two");
  view.ack("two");
  assert.equal(await next, "accepted");
}
for (const lateError of [undefined, "late IPC error"]) {
  const view = mount(), first = outcome(view.run(request("one")));
  view.context.environmentActionScopeRef.current = "scope-two";
  view.ack("one", lateError);
  assert.match(await first, /上下文已变化/, "ack between new render and passive cleanup must reject rather than accept stale action");
  assert.equal(view.context.pending, null);
  assert.equal(view.context.environmentActionWaiter.current, null);
  assert.equal(view.requests.length, 1, "stale-scope ack must close backend itself before clearing waiter");
  assert.equal(view.requests[0].method, "terminal_close");
  assert.equal(view.requests[0].args.sessionId, "session-one");
  view.cleanup();
  assert.equal(view.requests.length, 1, "later passive cleanup does not duplicate stale ack cancellation");
  const next = outcome(view.run(request("two")));
  view.ack("one");
  assert.equal(view.context.environmentActionWaiter.current.id, "two");
  view.ack("two");
  assert.equal(await next, "accepted");
}
{
  const baseline = {
    activeRoute: "thread", activeThreadId: "one", activeWorkspace: { path: "repo" }, modelAccountIdentity: "account",
    appServerStatus: { connected: true, binaryPath: "codex", appServerVersion: "1" },
  };
  const scope = context => vm.runInNewContext(compile(nodes.scope), context);
  const initial = scope(baseline);
  for (const override of [
    { activeRoute: "settings" }, { activeThreadId: "two" }, { activeWorkspace: { path: "other" } },
    { modelAccountIdentity: "other-account" }, { appServerStatus: { ...baseline.appServerStatus, connected: false } },
    { appServerStatus: { ...baseline.appServerStatus, binaryPath: "other-codex" } },
    { appServerStatus: { ...baseline.appServerStatus, appServerVersion: "2" } },
  ]) assert.notEqual(scope({ ...baseline, ...override }), initial, "each relevant identity change invalidates pending operation scope");
}
{
  const context = {
    isQuickChatWindow: false, focusedElement: null, localCommandsOnly: false,
    keyboardContextRef: { current: { activeRoute: "thread", hasWorkspace: true } },
    environmentActionRunner: { current: () => true },
    shortcutHandlersRef: { current: { "environment-action-1": () => true } },
  };
  const allowed = vm.runInNewContext(compile(nodes.predicate), context);
  assert.equal(allowed("environment-action-1"), true);
  context.keyboardContextRef.current.activeRoute = "home";
  assert.equal(allowed("environment-action-1"), true);
  context.keyboardContextRef.current.activeRoute = "settings";
  assert.equal(allowed("environment-action-1"), false);
  context.keyboardContextRef.current.activeRoute = "thread";
  context.keyboardContextRef.current.hasWorkspace = false;
  assert.equal(allowed("environment-action-1"), false);
  context.keyboardContextRef.current.hasWorkspace = true;
  context.environmentActionRunner.current = null;
  assert.equal(allowed("environment-action-1"), false);
  context.environmentActionRunner.current = () => true;
  context.localCommandsOnly = true;
  assert.equal(allowed("environment-action-1"), false, "terminal/editor local keyboard context cannot run global environment action");
  context.localCommandsOnly = false; context.isQuickChatWindow = true;
  assert.equal(allowed("environment-action-1"), false);
}
console.log("PASS environment App production callbacks: single flight, scoped acknowledgment/failure, scope/unmount cancellation, stale response isolation and global shortcut context guards");
