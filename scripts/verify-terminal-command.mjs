import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/TerminalDock.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TerminalDock.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let commandEffect, closeTab, retry, panelEffect, focusEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("await entry.ready")) commandEffect = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("handledPanelRequest.current")) panelEffect = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("entry.term.focus()")) focusEffect = node.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "closeTerminalTab") closeTab = node.initializer;
  if (ts.isJsxElement(node) && node.children.some(child => ts.isJsxText(child) && child.text === "重试命令")) {
    retry = node.openingElement.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === "onClick")?.initializer.expression;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function mount() {
  const ready = deferred(), requests = [], acks = [];
  const context = {
    open: true, pendingCommand: { id: 1, command: "npm test" }, activeTabId: "a", cwd: "repo-A",
    tabs: [{ id: "a", cwd: "repo-A" }], lastExecutedCmdId: { current: null },
    hiddenDocks: [],
    setHiddenDocks(value) { context.hiddenDocks = value; },
    revealDock(position) { context.hiddenDocks = context.hiddenDocks.filter(dock => dock !== position); },
    tabDragRef: { current: null },
    cancelTabDrag() { context.tabDragRef.current = null; },
    xtermMapRef: { current: new Map([["a", { ready: ready.promise, term: { dispose() {} }, el: { remove() {} }, output: { dispose() {} }, cancelHydration() {} }]]) },
    commandRetry: 0, selectedShell: "powershell.exe", crypto: { randomUUID: () => "new-session" },
    setCommandError(value) { context.error = value; },
    setCommandRetry(value) { context.commandRetry = value(context.commandRetry); },
    onCommandHandled(id) { acks.push(id); },
    invoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
    setTabs(value) { context.tabs = typeof value === "function" ? value(context.tabs) : value; },
    setActiveTabId(value) { context.activeTabId = value; },
    addNewTerminal() { context.newTerminals = (context.newTerminals || 0) + 1; },
    onClose() { context.open = false; },
  };
  return { context, ready, requests, acks, effect: vm.runInNewContext(compile(commandEffect), context),
    close: vm.runInNewContext(compile(closeTab), context), retry: vm.runInNewContext(compile(retry), context) };
}
{
  const view = mount();
  view.effect();
  await flush();
  assert.equal(view.requests.length, 0, "TC01: no write before readiness");
  view.ready.resolve(true); await flush();
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].args.data, "npm test\r");
  view.effect(); await flush();
  assert.equal(view.requests.length, 1, "TC03: in-flight command is not sent twice");
  view.requests[0].resolve(); await flush();
  assert.deepEqual(view.acks, [1]);
  view.context.open = false; view.effect();
  view.context.open = true; view.effect(); await flush();
  assert.equal(view.requests.length, 1, "TC03: hidden/reopened command is not replayed");
}
{
  const view = mount(), cleanup = view.effect();
  cleanup(); view.context.open = false; view.ready.resolve(true); await flush();
  assert.equal(view.requests.length, 0, "TC02: hide while waiting cancels unsent dispatch");
  view.context.open = true; view.effect(); await flush();
  assert.equal(view.requests.length, 1, "TC02: unsent command resumes once");
}
{
  const view = mount();
  view.effect(); view.ready.resolve(false); await flush();
  assert.equal(view.requests.length, 0);
  assert.ok(view.context.error.includes("尚未启动"), "TC04: startup failure is visible");
  assert.equal(view.context.lastExecutedCmdId.current, null);
}
{
  const view = mount();
  view.effect(); view.ready.resolve(true); await flush();
  view.requests[0].reject(Error("input interrupted")); await flush();
  assert.ok(view.context.error.includes("可能不完整"), "TC04: do not assume rejected input was never delivered");
  assert.deepEqual(view.acks, []);
  view.effect(); await flush();
  assert.equal(view.requests.length, 1, "TC04: failure never triggers automatic replay");
  view.retry(); view.effect(); await flush();
  assert.equal(view.context.commandRetry, 1);
  assert.equal(view.requests.length, 2, "TC04: explicit retry releases the command claim");
}
{
  const view = mount(), cleanup = view.effect();
  view.ready.resolve(true); await flush(); cleanup(); view.context.open = false;
  view.requests[0].reject(Error("late input failure")); await flush();
  assert.ok(view.context.error.includes("late input failure"), "hidden panel retains a late write failure");
}
{
  const view = mount();
  view.context.cwd = "repo-B"; view.effect();
  assert.equal(view.context.newTerminals, 1, "TC07: new workspace cannot dispatch to the previous terminal");
  assert.equal(view.requests.length, 0);
  view.context.tabs.push({ id: "b", cwd: "repo-B" }); view.effect();
  assert.equal(view.context.activeTabId, "b", "TC07: select an existing matching workspace terminal");
}
{
  const view = mount();
  view.context.tabDragRef.current = { tabId: "a" };
  view.close("a");
  assert.equal(view.context.tabDragRef.current, null, "closing the dragged tab cancels its drop");
  assert.equal(view.requests[0].method, "terminal_close");
  assert.equal(view.context.open, false);
  assert.equal(view.context.tabs[0].id, "new-session");
  assert.equal(view.context.activeTabId, "new-session", "TC06: last-tab replacement is selected");
}
// The actual App acknowledgment must not clear a newer toolbar command.
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let ack;
function findAck(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === "handleTerminalCommandHandled") ack = node.initializer.arguments[0];
  ts.forEachChild(node, findAck);
}
findAck(appAst);
let pending = { id: 2, command: "new command" };
const ackCallback = vm.runInNewContext(ts.transpileModule(`(${ack.getText(appAst)})`, {}).outputText, {
  setPendingTermCommand(update) { pending = update(pending); },
});
ackCallback(1); assert.equal(pending.id, 2);
ackCallback(2); assert.equal(pending, null);
assert.ok(!source.includes("if (!open) return null"), "TC05: hiding must preserve the terminal DOM");
assert.ok(appSource.includes("terminalWasOpened.current &&"), "TC05: retain the dock after first open");
console.log("PASS TC01–TC07 production command effects: readiness, cancellation, no replay, explicit retry, hidden failure, workspace identity, last-tab recovery and App acknowledgment");

{
  const view = mount();
  view.context.pendingCommand.cwd = "repo-B";
  view.effect(); view.ready.resolve(true); await flush();
  assert.equal(view.requests.length, 0, "TC08: scoped environment command cannot run in another workspace");
  assert.deepEqual(view.acks, [1]);
  assert.match(view.context.error, /已取消/);
}
console.log("PASS TC08: queued environment command workspace identity and cancellation");
{
  const view = mount();
  view.context.tabs[0].dockPosition = "right";
  view.context.hiddenDocks = ["right"];
  view.effect();
  view.ready.resolve(true); await flush();
  assert.deepEqual(view.context.hiddenDocks, []);
  assert.equal(view.requests.length, 0, "show the target before dispatching a command");
  view.effect(); await flush();
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].args.sessionId, "a");
}
{
  const view = mount();
  view.context.hiddenDocks = ["right"];
  view.context.tabs.push({ id: "b", cwd: "repo-A", dockPosition: "right" });
  view.close("a");
  assert.equal(view.context.activeTabId, "b");
  assert.equal(view.context.open, true);
  assert.deepEqual(view.context.hiddenDocks, []);
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].args.sessionId, "a");
}
console.log("PASS TC09: command dispatch and last-visible-tab closure reveal the surviving session");
{
  const a = { id: "a" }, b = { id: "b" }, action = { id: "action", action: { id: "setup" } };
  const bottom = { position: "bottom", selected: a, dockTabs: [a, action] };
  const right = { position: "right", selected: b, dockTabs: [b] };
  const focused = [], added = [], acknowledged = [];
  const context = {
    open: true, handledPanelRequest: { current: null }, groups: [right, bottom], hiddenDocks: [],
    get visibleGroups() { return context.groups.filter(group => !context.hiddenDocks.includes(group.position)); },
    onPanelRequestHandled(request) { acknowledged.push(request); },
    hideDock(position) { context.hiddenDocks.push(position); },
    revealDock(position) { context.hiddenDocks = context.hiddenDocks.filter(dock => dock !== position); },
    setActiveTabId(id) { context.activeTabId = id; },
    setPanelFocusId(id) { context.panelFocusId = id; },
    addNewTerminal(position) { added.push(position); return "new"; },
    xtermMapRef: { current: new Map([["a", { term: { focus() { focused.push("a"); } } }]]) },
  };
  const handle = vm.runInNewContext(compile(panelEffect), context);
  const focus = vm.runInNewContext(compile(focusEffect), context);
  const request = action => { context.panelRequest = { action }; handle(); };
  request("toggle-bottom"); handle();
  assert.deepEqual(context.hiddenDocks, ["bottom"], "hide only the bottom once per request");
  assert.deepEqual(context.visibleGroups, [right]);
  request("toggle-bottom"); focus();
  assert.deepEqual(context.hiddenDocks, []);
  assert.deepEqual(focused, ["a"]);
  bottom.selected = action;
  request("open-terminal"); bottom.selected = a; focus();
  request("open-terminal"); focus();
  assert.deepEqual(focused, ["a", "a", "a"], "repeat launch focuses the ordinary terminal");
  assert.equal(context.activeTabId, "a");
  assert.equal(added.length, 0);
  context.groups = [right];
  request("toggle-bottom"); handle();
  assert.deepEqual(added, ["bottom"], "create only when bottom is empty");
  assert.equal(acknowledged.length, 5);
}
console.log("PASS TC10: bottom-only toggle, terminal focus/reuse, empty destination and request deduplication");
