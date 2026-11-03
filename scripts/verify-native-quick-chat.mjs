import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/App.tsx", "utf8").replace(/\r\n/g, "\n");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let open, continuation, effect, key;
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (name === "handleOpenQuickChat") open = node.initializer.arguments[0].getText(ast);
    if (name === "promptStorageKey") key = node.initializer.getText(ast);
  }
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "quickChatContinueRef.current") continuation = node.right.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('"quick-chat:continue"')) effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(open && continuation && effect && key);
const commands = [], errors = []; let native = true, modal = false;
const context = { isTauriRuntime: () => native, tauriInvoke: async command => commands.push(command),
  setShowPopoutModal: update => { modal = update(modal); }, showAppToast: message => errors.push(message) };
const openChat = vm.runInNewContext(compile(`(${open})`), context);
await openChat(); assert.deepEqual(commands, ["quick_chat_toggle"]); assert.equal(modal, false);
native = false; await openChat(); assert.equal(modal, true); assert.equal(commands.length, 1);
native = true; context.tauriInvoke = async () => { throw Error("create failed"); }; await openChat(); assert.match(errors[0], /create failed/);
let selected = [], route, focus = 0;
const nav = { activeThreadIdRef: { current: "same" }, selectThread: id => selected.push(id), setActiveRoute: value => { route = value; }, setComposerFocusRequest: update => { focus = update(focus); } };
const receive = vm.runInNewContext(compile(`(${continuation})`), nav);
receive("same"); assert.deepEqual(selected, []); assert.equal(route, "thread"); assert.equal(focus, 1);
receive("other"); assert.deepEqual(selected, ["other"]);
let listener, release, unlistened = 0;
const off = vm.runInNewContext(compile(`(${effect})`), { isQuickChatWindow: false, isThreadWindow: false,
  quickChatContinueRef: { current: id => selected.push(id) },
  tauriListen: async (event, callback) => { assert.equal(event, "quick-chat:continue"); listener = callback; return new Promise(resolve => { release = resolve; }); } })();
listener({ threadId: "" }); listener({ threadId: 4 }); assert.equal(selected.length, 1);
listener({ threadId: "real-thread" }); assert.equal(selected.at(-1), "real-thread");
off(); listener({ threadId: "late" }); assert.equal(selected.at(-1), "real-thread");
release(() => unlistened++); for (let tick = 0; tick < 10; tick++) await Promise.resolve(); assert.equal(unlistened, 1);
const nativeKey = vm.runInNewContext(compile(`(${key})`), { isQuickChatWindow: true, threadWindowId: null });
const mainKey = vm.runInNewContext(compile(`(${key})`), { isQuickChatWindow: false, threadWindowId: null }); assert.notEqual(nativeKey, mainKey);
assert.match(source, /getItem\(promptStorageKey\)/); assert.match(source, /setItem\(promptStorageKey,/);
// Automation notifications now participate in host arbitration in every window;
// actual callback regressions verify main-only toast/inbox separately.
for (const marker of ["setInboxLoadError(null)", "let offMenu:"]) {
 const pos = source.indexOf(marker); assert.ok(source.slice(Math.max(0, pos - 160), pos).includes("if (isQuickChatWindow) return;"), `${marker}: native utility cannot own global persistence/menu/automation`);
}
assert.match(source, /!inboxHydrated \|\| isQuickChatWindow/);
let notificationContext;
function findNotificationContext(node) {
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "notificationContextRef.current") notificationContext = node.right.getText(ast);
  ts.forEachChild(node, findNotificationContext);
}
findNotificationContext(ast);
assert.ok(notificationContext);
assert.equal(vm.runInNewContext(compile(`(${notificationContext})`), {
  activeRoute: "thread", notificationState: { ready: true }, isQuickChatWindow: true, isThreadWindow: false,
}).ready, true, "Quick Chat participates in host-arbitrated notifications");
const nativeReturn = source.slice(source.indexOf("  if (isQuickChatWindow) {\n    return <>"), source.indexOf('      <AppTitleBar'));
assert.ok(nativeReturn.includes("<HotkeyWindow") && nativeReturn.includes('tauriInvoke("quick_chat_hide")') && nativeReturn.includes('tauriInvoke("quick_chat_continue"'));
assert.ok(nativeReturn.includes("<ThreadGoalModal") && nativeReturn.includes("renderThreadComposer()") && nativeReturn.includes("renderApprovals()"));
const capability = JSON.parse(fs.readFileSync("src-tauri/capabilities/quick-chat.json", "utf8")); assert.deepEqual(capability.windows, ["quick-chat"]);
let resolvedHandler, watchEffect, keyboardEffect, actionHandlers;
function contracts(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "unlistenResolved") resolvedHandler = node.initializer.arguments[1].getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0]?.getText(ast);
    if (callback?.includes('"fs/unwatch"')) watchEffect = callback;
    if (callback?.includes('const matcher = createShortcutMatcher')) keyboardEffect = callback;
  }
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "shortcutHandlersRef.current") actionHandlers = node.right;
  ts.forEachChild(node, contracts);
}
contracts(ast);
const requests = [{ id: 7, generation: 1 }, { id: "7", generation: 1 }, { id: 7, generation: 2 }];
const requestKey = request => `${request.generation}:${typeof request.id}:${request.id}`;
let responses = Object.fromEntries(requests.map(request => [requestKey(request), { sending: true }]));
const pendingRequestsRef = { current: requests }, revision = { current: 4 }; let renderedRequests;
const resolveRequest = vm.runInNewContext(compile(`(${resolvedHandler})`), {
  pendingRequestRevisionRef: revision, pendingRequestsRef, pendingRequestKey: requestKey,
  setPendingRequests: value => { renderedRequests = value; }, setRequestResponses: update => { responses = update(responses); },
});
resolveRequest({ id: 7, generation: 1 });
assert.deepEqual(pendingRequestsRef.current, requests.slice(1)); assert.equal(renderedRequests, pendingRequestsRef.current);
assert.equal(responses["1:number:7"], undefined); assert.ok(responses["1:string:7"] && responses["2:number:7"]); assert.equal(revision.current, 5);
assert.match(source, /unlistenResolved\.then\(\(f\) => f\(\)\)/);
const watchCalls = [];
const mountWatch = utility => vm.runInNewContext(compile(`(${watchEffect})`), {
  activeWorkspace: { path: "D:/same" }, appServerStatus: { connected: true }, isQuickChatWindow: utility, threadWindowId: null,
  workspaceWatchIdRef: { current: null }, callAppServer: async (method, params) => watchCalls.push([method, params.watchId]), console,
})();
const closeMain = mountWatch(false), closeUtility = mountWatch(true);
assert.notEqual(watchCalls[0][1], watchCalls[1][1]); closeMain(); closeUtility();
assert.equal(watchCalls[2][1], watchCalls[0][1]); assert.equal(watchCalls[3][1], watchCalls[1][1]);
const shortcuts = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/shortcuts.ts", "utf8")), { exports: shortcuts.exports });
let keydown; const actions = []; let prevented = 0;
vm.runInNewContext(compile(`(${keyboardEffect})`), {
  isQuickChatWindow: true, createShortcutMatcher: shortcuts.exports.createShortcutMatcher,
  keyboardBindingsRef: { current: [{ command: "openSettings", key: "Ctrl+K Ctrl+S" }] },
  keyboardNumberTargetRef: { current: "tabs" },
  keyboardContextRef: { current: { activeThreadId: null, activeRoute: "home", hasWorkspace: false } },
  shortcutHandlersRef: { current: { "new-chat": () => true } },
  document: { querySelector: () => null },
  keyboardState: { capturing: { current: false } }, shortcutEventAllowed: () => true,
  runShortcutAction: id => { actions.push(id); return true; }, window: { addEventListener: (event, callback) => { if (event === "keydown") keydown = callback; }, removeEventListener() {} },
})();
const stroke = key => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault() { prevented++; } });
keydown(stroke(",")); keydown(stroke("k")); assert.equal(prevented, 0); assert.deepEqual(actions, []);
keydown(stroke("n")); assert.deepEqual(actions, ["new-chat"]); assert.equal(prevented, 1);
const standalone = actionHandlers.properties.find(property => property.name?.getText(ast) === '"new-standalone-chat"');
const starts = [];
vm.runInNewContext(compile(`(${standalone.initializer.getText(ast)})`), { startNewThread: (...args) => starts.push(args) })();
assert.deepEqual(starts, [[undefined, undefined, true]]);
console.log("PASS QN01/QN03/QN04 production callbacks: real native command/failure, browser fallback, same-ID continuation, subscription cleanup, isolated drafts, main persistence/menu and host-arbitrated notifications");
console.log("PASS QN06-QN10 projectless command, typed generation approval resolution, partitioned watch lifecycle, utility shortcut and chord scope");
