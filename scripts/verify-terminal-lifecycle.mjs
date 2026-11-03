import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/TerminalDock.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TerminalDock.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const subscription = effects.find(node => node.getText(ast).includes('"terminal:data"'));
const creation = effects.find(node => node.getText(ast).includes('"terminal_create_or_attach"'));
assert.ok(subscription && creation, "production effects must exist");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const outputModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(new URL("../src/terminalOutput.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText, { exports: outputModule.exports, TextEncoder, TextDecoder });
const snapshot = (text, id = "term-1") => ({
  sessionId: id, generation: "generation-1", replayLog: text,
  startOffset: 0, endOffset: new TextEncoder().encode(text).length, exited: false,
});
function mount() {
  const listeners = [], terminals = [], timers = new Set(), requests = [], resizeHandlers = new Set();
  let observerDisconnected = 0;
  const context = {
    open: true, tabs: [{ id: "term-1", cwd: "repo-A", shell: "powershell.exe" }],
    activeTabId: "term-1", cwd: "repo-A", fontSize: 13, selectedShell: "powershell.exe",
    containerRef: { current: { appendChild() {} } }, xtermMapRef: { current: new Map() },
    subscriptionsReadyRef: { current: Promise.resolve(false) },
    createTerminalOutput: outputModule.exports.createTerminalOutput,
    setCommandError(value) { context.error = value; },
    listen(name, handler) { const pending = deferred(); listeners.push({ name, handler, ...pending }); return pending.promise; },
    invoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
    document: { createElement: () => ({ style: {}, removed: false, remove() { this.removed = true; } }) },
    window: {
      addEventListener(name, fn) { resizeHandlers.add(fn); },
      removeEventListener(name, fn) { resizeHandlers.delete(fn); },
    },
    ResizeObserver: class { observe() {} disconnect() { observerDisconnected++; } },
    FitAddon: class { fit() {} },
    Terminal: class {
      constructor(options) { this.options = options; this.writes = []; this.disposals = 0; this.parsed = []; terminals.push(this); }
      loadAddon() {} open() {} attachCustomKeyEventHandler(fn) { this.keyHandler = fn; } onData(fn) { this.input = fn; }
      write(text, callback) { assert.equal(this.disposals, 0, "cannot write disposed terminal"); this.writes.push(text); if (callback) this.parsed.push(callback); }
      writeln(text) { this.write(text); }
      dispose() { this.disposals++; }
    },
  };
  return {
    context, listeners, terminals, timers, requests, resizeHandlers,
    subscription: vm.runInNewContext(compile(subscription), context),
    creation: vm.runInNewContext(compile(creation), context),
    disconnected: () => observerDisconnected,
  };
}
{
  const view = mount(), cleanup = view.subscription(), released = [];
  cleanup();
  view.listeners.forEach((entry, index) => entry.resolve(() => released.push(index)));
  await flush();
  assert.deepEqual(released, [0, 1], "TL01: late registration immediately unsubscribes");
}
for (const outcome of ["resolve", "reject"]) {
  const view = mount(), cleanupSubscriptions = view.subscription();
  let released = 0;
  view.listeners.forEach(entry => entry.resolve(() => released++));
  await flush();
  const cleanupView = view.creation();
  await flush();
  const entry = view.context.xtermMapRef.current.get("term-1");
  assert.equal(view.requests[0].method, "terminal_create_or_attach");
  assert.equal(view.timers.size, 1);
  cleanupSubscriptions();
  cleanupView();
  assert.equal(released, 2, "TL02: release both event subscriptions");
  assert.equal(entry.term.disposals, 1);
  assert.equal(entry.el.removed, true);
  assert.equal(view.context.xtermMapRef.current.size, 0);
  view.listeners[0].handler({ payload: { sessionId: "term-1", data: "late event" } });
  view.listeners[1].handler({ payload: { sessionId: "term-1" } });
  if (outcome === "resolve") view.requests[0].resolve(snapshot("late replay"));
  else view.requests[0].reject(Error("late launch failure"));
  await flush();
  assert.deepEqual(entry.term.writes, [], "TL03: late events and attach results cannot write disposed views");
  assert.equal(view.timers.size, 0, "TL04: clear fit timer");
  assert.equal(view.resizeHandlers.size, 0);
  assert.equal(view.disconnected(), 1);
}
{
  const view = mount(), cleanupSubscriptions = view.subscription();
  view.listeners.forEach(entry => entry.resolve(() => {}));
  await flush();
  const cleanupFirst = view.creation();
  await flush();
  cleanupFirst();
  view.context.tabs.push({ id: "term-2", cwd: "repo-B", shell: "cmd.exe" });
  view.context.activeTabId = "term-2";
  const cleanupSecond = view.creation();
  await flush();
  view.requests[0].resolve(snapshot("first tab output"));
  await flush();
  assert.deepEqual(view.terminals[0].writes, ["first tab output"], "tab switch retains its live terminal output");
  assert.deepEqual(view.terminals[1].writes, [], "cannot write replay into another tab");
  cleanupSecond();
  cleanupSubscriptions();
  assert.equal(view.timers.size, 0);
}
console.log("PASS TL01–TL04 production terminal effects: late subscriptions, view disposal, late attach/event suppression and timer/observer cleanup");
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  await flush();
  assert.equal(view.requests.length, 0, "TO02: no session starts before both listeners");
  view.listeners[0].resolve(() => {});
  await flush();
  assert.equal(view.requests.length, 0);
  view.listeners[1].resolve(() => {});
  await flush();
  const entry = view.context.xtermMapRef.current.get("term-1");
  view.terminals[0].input("replay-generated response");
  assert.equal(view.requests.length, 1, "hydration suppresses terminal-generated input");
  view.listeners[0].handler({ payload: {
    sessionId: "term-1", generation: "generation-1", startOffset: 4, endOffset: 8, data: "tail",
  } });
  view.requests[0].resolve(snapshot("head"));
  let ready = false;
  entry.ready.then(value => { ready = value; });
  await flush();
  assert.deepEqual(view.terminals[0].writes, ["head", "tail"], "TO03: early live event follows snapshot once");
  assert.equal(ready, false, "ready waits for actual xterm parse callback");
  view.terminals[0].input("still replaying");
  assert.equal(view.requests.length, 1);
  view.terminals[0].parsed.shift()();
  await flush();
  assert.equal(ready, true);
  view.terminals[0].input("user input");
  assert.equal(view.requests[1].args.data, "user input");
  cleanup(); cleanupView();
}
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  view.listeners[0].reject(Error("listener unavailable"));
  view.listeners[1].resolve(() => {});
  await flush();
  assert.equal(view.requests.length, 0, "listener failure must never create an unobserved session");
  assert.match(view.context.error, /listener unavailable/);
  assert.equal(await view.context.xtermMapRef.current.get("term-1").ready, false);
  cleanup(); cleanupView();
}
console.log("PASS TO02–TO03 listener readiness, failure, pre-attach buffering and parser-based input hydration");
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  view.listeners.forEach(entry => entry.resolve(() => {}));
  await flush();
  const entry = view.context.xtermMapRef.current.get("term-1");
  view.requests[0].resolve(snapshot("pending parse"));
  await flush();
  cleanup(); cleanupView();
  assert.equal(await entry.ready, false, "disposing during hydration releases pending command waiters");
  view.terminals[0].parsed.shift()();
  view.terminals[0].input("late parsed response");
  assert.equal(view.requests.length, 1, "late parse cannot re-enable input for disposed views");
}
