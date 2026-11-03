import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const source = fs.readFileSync("src/App.tsx", "utf8");
const shortcuts = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shortcuts.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: shortcuts.exports });
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["handleThreadMenuAction", "handleSlashAction", "threadMenuItems"].includes(node.name.getText(ast))) {
    functions[node.name.getText(ast)] = node.initializer.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(Object.keys(functions).length, 3);
const compile = code => ts.transpileModule(`(${code})`, { fileName: "action.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const writes = [], toasts = [], invokes = [], shares = [], openTargets = [];
let copySuccess = true;
const context = vm.createContext({
  activeThreadId: "11111111-1111-4111-8111-111111111111",
  showAppToast: (...args) => toasts.push(args),
  copyTextToClipboard: async text => { writes.push(text); return copySuccess; },
  navigator: { clipboard: { writeText: async text => { writes.push(text); if (!copySuccess) throw Error("clipboard denied"); } } },
  tauriInvoke: async (...args) => { invokes.push(args); throw Error("unknown command"); },
  isQuickChatWindow: false,
  shareAvailable: false,
  setShareThreadId: id => shares.push(id),
  workspaceOpenTargets: { openTarget: async id => openTargets.push(id) },
});
const menu = vm.runInContext(compile(functions.handleThreadMenuAction), context);
await menu("copy_deeplink");
assert.deepEqual(writes, ["codex://threads/11111111-1111-4111-8111-111111111111"]);
assert.equal(toasts.at(-1)[1], "success");
toasts.length = 0;
const copy = context.copyTextToClipboard;
let finishCopy;
context.copyTextToClipboard = () => new Promise(resolve => { finishCopy = resolve; });
const pendingCopy = menu("copy_deeplink"); assert.equal(toasts.length, 0, "success must wait for clipboard completion");
finishCopy(true); await pendingCopy; assert.equal(toasts.at(-1)[1], "success");
context.copyTextToClipboard = copy;
writes.length = 0; toasts.length = 0; copySuccess = false;
await menu("copy_deeplink");
assert.equal(toasts.length, 1); assert.equal(toasts[0][1], "error");
context.activeThreadId = null; writes.length = 0; toasts.length = 0;
await menu("copy_deeplink");
assert.equal(writes.length, 0); assert.equal(toasts.length, 0);
context.activeThreadId = "11111111-1111-4111-8111-111111111111";
const slash = vm.runInContext(compile(functions.handleSlashAction), context);
await menu("share_thread"); slash("share_thread");
assert.equal(writes.length, 0, "share cannot substitute a local deeplink");
assert.equal(invokes.length, 0, "share must not invoke a substitute command");
assert.equal(toasts.length, 1); assert.ok(toasts.every(([message, kind]) => /尚未确认或不可用/.test(message) && kind !== "success"));
assert.equal(shares.length, 0, "unverified sharing cannot open a publish dialog");
context.shareAvailable = true;
await menu("share_thread"); slash("share_thread");
assert.deepEqual(shares, [context.activeThreadId, context.activeThreadId]);
assert.equal(writes.length, 0, "opening the dialog cannot claim a share link");
assert.equal(invokes.length, 0, "App delegates preparation and publishing to the session");
const icons = [...functions.threadMenuItems.matchAll(/<(\w+Icon)/g)].map(match => match[1]);
const menuContext = {
  effectiveBindings: shortcuts.exports.effectiveBindings,
  keyboardState: { bindings: [], primaryNumberShortcutTarget: "tabs" },
  activeThreadId: context.activeThreadId, pinnedThreadIds: [], activityThreadIds: [],
  activeThreadObj: null, isThreadReadState: () => false,
  sidebarProjectMembership: { localProjects: [] }, projectMoveBusy: false,
  shareAvailable: false,
  workspaceOpenTargets: { items: null },
  React: { createElement: () => null },
};
for (const name of icons) menuContext[name] = () => null;
const items = vm.runInNewContext(compile(functions.threadMenuItems), menuContext);
assert.equal(items().find(item => item.id === "share_thread").disabled, true);
menuContext.shareAvailable = true;
assert.equal(items().find(item => item.id === "share_thread").disabled, false);
menuContext.activeThreadId = null;
assert.equal(items().find(item => item.id === "share_thread").disabled, true);
menuContext.activeThreadId = context.activeThreadId;
assert.equal(items().find(item => item.id === "open_new_window").disabled, false);
const detected = [{ id: "open_target:fileManager", label: "文件资源管理器", type: "radio", checked: true }];
menuContext.workspaceOpenTargets.items = detected;
assert.equal(items().find(item => item.id === "open_with_menu").children, detected, "OC01: actual App menu consumes detected targets without a static list");
menuContext.workspaceOpenTargets.items = null;
assert.equal(items().some(item => item.id === "open_with_menu"), false, "OC08: no fake menu for an empty catalog");
await menu("open_target:fileManager");
assert.deepEqual(openTargets, ["fileManager"], "OC02: the actual menu action passes the explicit target to the shared hook");
assert.equal(invokes.length, 0, "OC06: the old unregistered VS Code command is no longer invoked");
let forwardedOpen = false;
function findMenu(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ThreadActionsMenu") {
    const attrs = node.attributes.properties;
    if (attrs.some(attr => attr.name?.getText(ast) === "items" && attr.initializer?.getText(ast) === "{threadMenuItems}")) {
      forwardedOpen = attrs.some(attr => attr.name?.getText(ast) === "onOpenChange" && attr.initializer?.getText(ast) === "{workspaceOpenTargets.onMenuOpenChange}");
    }
  }
  ts.forEachChild(node, findMenu);
}
findMenu(ast);
assert.ok(forwardedOpen, "OC07: the actual menu opens and cancels the target query through its hook");
console.log("PASS NA01-NA03: canonical local deeplink and clipboard results; share opens the session only with verified availability and a thread, without fake links/success. Native receiver/live sharing and visual remain unverified.");
console.log("PASS OC App wiring: dynamic children, absent empty menu, explicit target delegation and open-change query lifecycle");
