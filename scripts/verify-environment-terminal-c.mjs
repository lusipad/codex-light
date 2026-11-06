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
    pendingActionRef: { current: request() },
    createTerminalOutput: outputModule.exports.createTerminalOutput,
    terminalAppearance: () => ({fontFamily: 'Consolas', fontSize: 12, theme: {background: '#111111', foreground: '#eeeeee'}}),
    setCommandError(value) { context.error = value; },
    listen(name, handler) { const pending = deferred(); listeners.push({ name, handler, ...pending }); return pending.promise; },
    invoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
    document: { createElement: () => ({ style: {}, removed: false, addEventListener() {}, removeEventListener() {}, remove() { this.removed = true; } }) },
    window: {
      addEventListener(name, fn) { resizeHandlers.add(fn); },
      removeEventListener(name, fn) { resizeHandlers.delete(fn); },
    },
    ResizeObserver: class { observe() {} disconnect() { observerDisconnected++; } },
    FitAddon: class { fit() {} },
    Terminal: class {
      constructor(options) { this.options = options; this.writes = []; this.disposals = 0; this.parsed = []; terminals.push(this); }
      loadAddon() {} open() {} attachCustomKeyEventHandler(fn) { this.keyHandler = fn; } onData(fn) { this.input = fn; } onKey(fn) { this.userKey = fn; return {dispose() {}}; }
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
const queueEffect = effects.find(node => node.getText(ast).includes("handledActionsRef.current.has"));
const request = (id = "request-1") => ({
  id, sessionId: "term-1", workspaceCwd: "requested-workspace", cwd: "environment-definition-root",
  configPath: "environment.toml", expectedContent: "[environment]", index: 4, title: "测试操作",
});
{
  const view = mount();
  Object.assign(view.context, {
    pendingAction: request(), handledActionsRef: { current: new Set() },
    setTabs(update) { view.context.tabs = update(view.context.tabs); },
    setActiveTabId(id) { view.context.activeTabId = id; },
  });
  const queue = vm.runInNewContext(compile(queueEffect), view.context);
  queue(); queue();
  assert.equal(view.context.tabs.length, 1, "fixed session is replaced rather than duplicated");
  assert.equal(view.context.tabs[0].action.id, "request-1");
  assert.equal(view.context.handledActionsRef.current.size, 1, "repeated renders claim a request once");
  view.context.pendingAction = request("request-2"); queue();
  assert.equal(view.context.tabs[0].action.id, "request-2", "new request can rerun the same action session");
  assert.equal(view.context.tabs[0].cwd, "environment-definition-root");
}
{
  const view = mount(), results = [];
  view.context.tabs[0].action = request();
  view.context.onActionResultRef = { current: (...args) => results.push(args) };
  const cleanup = view.subscription();
  view.creation(); await flush();
  assert.equal(view.requests.length, 0, "action dispatch waits for both output subscriptions");
  view.listeners.forEach(listener => listener.resolve(() => {})); await flush();
  assert.equal(view.requests.length, 1);
  const first = view.requests[0];
  assert.equal(first.method, "terminal_run_environment_action");
  assert.equal(first.args.cwd, "requested-workspace", "host validates workspace selection rather than trusting execution cwd");
  assert.equal(first.args.index, 4);
  assert.equal(first.args.expectedContent, "[environment]");
  assert.equal("command" in first.args, false, "renderer never supplies an executable command");
  view.listeners[0].handler({ payload: { sessionId: "term-1", generation: "generation-1", startOffset: 4, endOffset: 8, data: "tail" } });
  first.resolve(snapshot("head")); await flush();
  const old = view.context.xtermMapRef.current.get("term-1");
  assert.equal(old.term.writes.join(""), "headtail", "output arriving before action snapshot is replayed exactly once");
  assert.equal(results.length, 1);
  assert.equal(results[0][0], "request-1", "acceptance is separate from command exit");
  assert.equal(results[0][1], undefined);
  old.term.parsed.forEach(callback => callback()); await flush();
  view.context.tabs[0].action = request("request-2");
  view.context.pendingActionRef.current = request("request-2");
  view.creation(); await flush();
  assert.equal(old.term.disposals, 1);
  assert.equal(view.requests[1].method, "terminal_run_environment_action", "rerun restarts backend instead of writing into its foreground process");
  view.listeners[0].handler({ payload: { sessionId: "term-1", generation: "generation-1", startOffset: 8, endOffset: 11, data: "old" } });
  view.listeners[0].handler({ payload: { sessionId: "term-1", generation: "generation-2", startOffset: 3, endOffset: 6, data: "new" } });
  view.requests[1].resolve({ ...snapshot("run"), generation: "generation-2" }); await flush();
  assert.equal(view.terminals[1].writes.join(""), "runnew", "fresh buffer ignores late old generation output");
  assert.deepEqual(results.map(item => item[0]), ["request-1", "request-2"]);
  cleanup();
  assert.equal(view.requests.at(-1).method, "terminal_close", "unmount closes owned action backend");
}
{
  const view = mount(), results = [];
  view.context.tabs[0].action = request();
  view.context.onActionResultRef = { current: (...args) => results.push(args) };
  view.subscription();
  view.listeners.forEach(listener => listener.resolve(() => {})); await flush();
  view.creation(); await flush();
  view.requests[0].reject(Error("configuration changed")); await flush();
  assert.match(results[0][1], /configuration changed/);
  view.creation(); await flush();
  assert.equal(view.requests.filter(item => item.method === "terminal_run_environment_action").length, 1, "failed run never automatically resends");
}
{
  const view = mount(), results = [];
  view.context.tabs[0].action = request();
  view.context.onActionResultRef = { current: (...args) => results.push(args) };
  view.subscription(); view.creation();
  view.context.pendingActionRef.current = null;
  view.listeners.forEach(listener => listener.resolve(() => {})); await flush();
  assert.equal(view.requests.length, 0, "scope cancellation while listeners connect must prevent unsent action");
  assert.match(results[0][1], /未发送/);
}
{
  const view = mount(), results = [];
  view.context.tabs[0].action = request();
  view.context.onActionResultRef = { current: (...args) => results.push(args) };
  const cleanup = view.subscription();
  view.listeners.forEach(listener => listener.resolve(() => {})); await flush();
  view.creation(); await flush();
  cleanup();
  assert.equal(results.length, 1, "closing while IPC is pending reports cancellation immediately");
  assert.match(results[0][1], /取消/);
  view.requests[0].resolve(snapshot("late")); await flush();
  assert.equal(results.length, 1, "late IPC response cannot overwrite cancelled result");
  assert.equal(view.requests.at(-1).method, "terminal_close", "late-started backend is closed when its renderer was removed");
}
console.log("PASS EC03 production TerminalDock effects: listener readiness, request deduplication, scoped config IPC, generation restart, output replay, failure propagation and action lifecycle cleanup");
