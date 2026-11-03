import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function createResultsTracker() {
  const findings = {}, results = {};
  const options = { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/reviewFindings.ts", "utf8"), options).outputText, { exports: findings });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/reviewResults.ts", "utf8"), options).outputText, {
    exports: results, require: () => findings,
  });
  return results.createReviewResults(() => {});
}

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map(), effects = [], listeners = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.arguments[0].getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "tauriListen" && node.arguments[0]?.text) listeners.set(node.arguments[0].text, node.arguments[1].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = code => ts.transpileModule(`(${code})`, { fileName: "window.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const callback = (name, context) => vm.runInNewContext(compile(declarations.get(name).arguments[0].getText(ast)), context);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const calls = [], toasts = [];
let resolveOpen;
const context = {
  activeThreadId: "thread-123", showAppToast: (...args) => toasts.push(args),
  tauriInvoke: (command, params) => { calls.push({ command, params }); return new Promise(resolve => { resolveOpen = resolve; }); },
};
const action = callback("handleThreadMenuAction", context);
const opening = action("open_new_window");
assert.equal(calls.length, 1, "actual menu must invoke real window creation");
assert.equal(calls[0].command, "open_thread_window"); assert.equal(calls[0].params.threadId, "thread-123");
assert.equal(toasts.length, 0); resolveOpen("thread-label"); await opening;
context.activeThreadId = null; await action("open_new_window"); assert.equal(calls.length, 1);
context.activeThreadId = "thread-123"; context.tauriInvoke = async () => { throw Error("creation denied"); };
await action("open_new_window"); assert.equal(toasts.at(-1)[1], "error"); assert.match(toasts.at(-1)[0], /creation denied/);

const initialEffect = effects.find(effect => effect.includes("initialWindowThreadRef.current"));
assert.ok(initialEffect, "thread window must consume its initial thread after connection");
const selected = [], initial = { current: "thread-123" }, navigation = { current: 0 };
const initialContext = { appServerStatus: { connected: false }, threadEventsReady: false, initialWindowThreadRef: initial, navigationRequestRef: navigation,
  selectThread: async id => selected.push(id) };
const initialize = vm.runInNewContext(compile(initialEffect), initialContext);
initialize(); assert.equal(selected.length, 0); initialContext.appServerStatus.connected = true;
initialize(); assert.equal(selected.length, 0, "read waits until stream and approval listeners exist"); initialContext.threadEventsReady = true;
initialize(); await flush(); initialize(); assert.deepEqual(selected, ["thread-123"]);
initial.current = "stale"; navigation.current = 1; initialize(); assert.deepEqual(selected, ["thread-123"]);

const watch = effects.find(effect => effect.includes('callAppServer("fs/watch"'));
const watches = [];
const mountWatch = id => vm.runInNewContext(compile(watch), {
  activeWorkspace: { path: "D:/same" }, appServerStatus: { connected: true }, isQuickChatWindow: false, threadWindowId: id,
  workspaceWatchIdRef: { current: null }, callAppServer: async (method, params) => watches.push([method, params.watchId]), console,
})();
const offA = mountWatch("thread-a"), offB = mountWatch("thread-b");
assert.notEqual(watches[0][1], watches[1][1]); offA(); offB();
assert.equal(watches[0][1], watches[2][1]); assert.equal(watches[1][1], watches[3][1]);

const notificationProtocol = {}, notificationActions = {};
const moduleCode = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(moduleCode("src/protocol.ts"), { exports: notificationProtocol });
vm.runInNewContext(moduleCode("src/notificationActions.ts"), { exports: notificationActions, require: () => notificationProtocol });
for (const child of [false, true]) {
  let pending = [], inbox = 0, notifications = 0;
  let notification;
  const pendingRequestsRef = { current: [] };
  const handler = vm.runInNewContext(compile(listeners.get("app-server:server-request")), {
    isThreadWindow: child, isQuickChatWindow: false, pendingRequestRevisionRef: { current: 0 }, pendingRequestsRef,
    setPendingRequests: value => { pending = value; }, pendingRequestKey: request => `${request.generation}:${request.id}`,
    setInboxItems: () => inbox++, notify: event => { notifications++; notification = event; }, notificationRequestCategory: () => "permission",
    requestThreadId: request => request.params.threadId,
    notificationApprovalActions: notificationActions.notificationApprovalActions,
    notificationContextRef: { current: { ready: true } },
  });
  const request = { id: 7, generation: 2, notificationNonce: "request-first", method: "item/commandExecution/requestApproval", params: { threadId: "thread-123" } };
  handler(request);
  assert.equal(pending.length, 1); assert.equal(inbox, child ? 0 : 1); assert.equal(notifications, 1);
  assert.equal(notification.requestNonce, request.notificationNonce);
  assert.equal(notification.id, "permission-2:7-request-first");
  assert.deepEqual(Array.from(notification.actions, action => action.id), ["approve", "approve-for-session", "decline"]);
  assert.equal(notification.valid(), true);
  pendingRequestsRef.current = [{ ...request, notificationNonce: "request-reused" }];
  assert.equal(notification.valid(), false, "replacement with same id/generation must invalidate the old notification");
}
const key = declarations.get("promptStorageKey").getText(ast);
const draftKey = id => vm.runInNewContext(compile(key), { isQuickChatWindow: false, threadWindowId: id });
assert.notEqual(draftKey("thread-a"), draftKey("thread-b")); assert.notEqual(draftKey(null), draftKey("thread-a"));
const timeline = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/threadTimeline.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: timeline });
function streamWindow() {
  let turns = [];
  const active = { current: "thread-123" }, buffer = new timeline.ThreadHistoryBuffer();
  const handler = vm.runInNewContext(compile(declarations.get("handleNotification").getText(ast)), {
    reviewResultsRef: { current: createResultsTracker() },
    activeThreadIdRef: active, threadRequestRef: { current: 1 }, threadHistoryBufferRef: { current: buffer },
    mergeTimelineItem: timeline.mergeTimelineItem, setTurns: update => { turns = update(turns); },
  });
  return { active, buffer, handler, get turns() { return turns; }, load(value) { turns = value; } };
}
const a = streamWindow(), b = streamWindow();
const delta = text => ({ method: "item/agentMessage/delta", params: { threadId: "thread-123", turnId: "turn", itemId: "message", delta: text } });
for (const event of [delta("甲"), delta("乙")]) { a.handler(event); b.handler(event); }
assert.equal(a.turns[0].items[0].text, "甲乙"); assert.equal(b.turns[0].items[0].text, "甲乙");
b.active.current = "other"; a.handler(delta("丙")); b.handler(delta("丙"));
assert.equal(a.turns[0].items[0].text, "甲乙丙"); assert.equal(b.turns[0].items[0].text, "甲乙");
b.active.current = "thread-123"; b.buffer.begin(1, "thread-123"); b.handler(delta("丙"));
const history = JSON.parse(JSON.stringify(a.turns)); b.load(history);
for (const event of b.buffer.release(1, "thread-123", history)) b.handler(event);
assert.equal(b.turns[0].items[0].text, "甲乙丙", "snapshot plus buffered broadcast cannot duplicate already included suffix");
console.log("PASS NW01-NW05 production App callbacks/effects: native create/error/no-id, once after connection and no stale navigation, independent watch/unwatch and drafts, shared approval state, main-only inbox and host-arbitrated notifications. Native UI/visual unverified.");
