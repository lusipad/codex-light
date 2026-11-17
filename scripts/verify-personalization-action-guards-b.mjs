import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, `${name} production callback exists`); return found;
}
function assignment(name) {
  let found;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === name) found = node.right;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, `${name} production handler exists`); return found;
}
function run(node, context) {
  return vm.runInContext(ts.transpileModule(`(${node.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
const actionModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/notificationActions.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: actionModule.exports, require: () => ({
  commandApprovalResponse: decision => ({ decision }), fileChangeApprovalResponse: decision => ({ decision }),
}) });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const state = { dirty: true, pending: null, route: "settings", draft: "keep this draft", files: ["attachment.png"], calls: [] };
  const context = vm.createContext({
    personalizationNavigationGuardRef: { current: action => {
      if (!state.dirty) return true;
      state.pending = action; return false;
    } },
    activeRouteRef: { current: "settings" }, commitActiveRoute: route => { state.route = route; state.calls.push(["route", route]); },
    notificationAccountRef: { current: "account-a" }, activeThreadIdRef: { current: "thread-a" },
    pendingRequestsRef: { current: [{ id: "request-a", generation: 7, method: "item/commandExecution/requestApproval", threadId: "thread-a", notificationNonce: "nonce-a" }] },
    pendingRequestKey: request => request.id, requestThreadId: request => request.threadId,
    respondingRequestsRef: { current: new Set() }, notificationApprovalResponse: actionModule.exports.notificationApprovalResponse,
    submitServerResponse: async (...args) => { state.calls.push(["approval", ...args]); },
    selectThread: async id => { state.calls.push(["select", id]); context.activeThreadIdRef.current = id; },
    notificationNativeActionRef: { current: null }, isQuickChatWindow: false,
    setPromptInput: value => { state.draft = value; state.calls.push(["draft", value]); },
    setAttachedFiles: value => { state.files = value; state.calls.push(["files", value]); },
    appshotScope: "account-a:thread:thread-a",
    retireAppshotCapture: scope => state.calls.push(["retire-appshot", scope]),
    setScopedAppshots: (scope, value) => state.calls.push(["appshots", scope, value]),
    showAppToast: (...args) => { state.calls.push(["toast", ...args]); },
  });
  context.setActiveRoute = run(callback("setActiveRoute"), context);
  context.notificationNativeActionRef.current = run(assignment("notificationNativeActionRef.current"), context);
  const slash = run(callback("handleSlashAction"), context);
  const event = { payload: { accountKey: "account-a", hostId: "local", threadId: "thread-a", requestId: "request-a", requestNonce: "nonce-a" }, action: "approve" };
  const cancel = () => { state.pending = null; };
  const discard = async () => {
    const action = state.pending; state.pending = null; state.dirty = false;
    action?.(); await flush();
  };
  return { context, state, event, slash, cancel, discard };
}
{
  const view = fixture();
  await view.context.notificationNativeActionRef.current(view.event);
  assert.equal(view.state.calls.length, 0, "dirty guard must run before navigation and approval side effects");
  view.cancel(); await view.discard();
  assert.equal(view.state.calls.length, 0, "cancelled navigation must not later deliver an approval");
}
{
  const view = fixture();
  await view.context.notificationNativeActionRef.current(view.event);
  await view.discard(); await view.discard();
  assert.equal(view.state.calls.filter(call => call[0] === "select").length, 1);
  const approvals = view.state.calls.filter(call => call[0] === "approval");
  assert.equal(approvals.length, 1, "discard must replay the entire continuation only once");
  assert.equal(approvals[0][1], "request-a"); assert.equal(approvals[0][2], 7);
  assert.equal(approvals[0][3].decision, "accept"); assert.equal(approvals[0][5], "nonce-a");
}
for (const expire of [
  view => { view.context.notificationAccountRef.current = "account-b"; },
  view => { view.context.pendingRequestsRef.current[0].notificationNonce = "nonce-new"; },
  view => { view.context.pendingRequestsRef.current = []; },
  view => { view.context.respondingRequestsRef.current.add("request-a"); },
]) {
  const view = fixture(); await view.context.notificationNativeActionRef.current(view.event);
  expire(view); await view.discard();
  assert.equal(view.state.calls.some(call => call[0] === "approval"), false, "replayed continuation must revalidate current account, live request and nonce");
}
console.log("PASS notification guard: zero effects while dirty/cancelled, single full replay and account/request/nonce revalidation");
{
  const view = fixture(); view.slash("reset_to_home");
  assert.equal(view.state.draft, "keep this draft"); assert.equal(view.state.files[0], "attachment.png");
  assert.equal(view.state.route, "settings"); assert.equal(view.state.calls.length, 0);
  view.cancel(); await view.discard(); assert.equal(view.state.calls.length, 0);
}
{
  const view = fixture(); view.slash("reset_to_home");
  await view.discard(); await view.discard();
  assert.equal(view.state.draft, ""); assert.equal(view.state.files.length, 0); assert.equal(view.state.route, "home");
  for (const kind of ["draft", "files", "route", "toast", "retire-appshot", "appshots"]) assert.equal(view.state.calls.filter(call => call[0] === kind).length, 1, `${kind} happens exactly once after discard`);
  const appshotClear = view.state.calls.find(call => call[0] === "appshots");
  assert.equal(appshotClear[1], "account-a:thread:thread-a");
  assert.ok(Array.isArray(appshotClear[2])); assert.equal(appshotClear[2].length, 0);
}
console.log("PASS reset guard: composer text, attachments, route and toast commit together only after confirmed discard");
