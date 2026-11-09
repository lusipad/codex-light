import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer);
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = code => ts.transpileModule(`(${code})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const run = (name, context) => vm.runInNewContext(compile(declarations.get(name).arguments[0].getText(ast)), context);
const protocol = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/protocol.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: protocol.exports });
const { isThreadReadState } = protocol.exports;
const activitySource = fs.existsSync("src/threadActivity.ts")
  ? ts.transpileModule(fs.readFileSync("src/threadActivity.ts", "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText : "";
const activity = { exports: {} };
vm.runInNewContext(activitySource, {
  exports: activity.exports, require: () => protocol.exports,
});
const { beginActivitySession, threadHasActivity, threadNeedsAttention } = activity.exports;
const read = { revision: "r1", firstUnread: null };
const unread = { revision: "r2", firstUnread: { type: "threadStart" } };
const threads = [{ id: "unread", readState: unread }, { id: "read", readState: read }, { id: "unsupported" }];
const ids = run("activityThreadIds", {
  activityPriorityVisible: true,
  activityExclusions: new Set(),
  activitySnapshot: beginActivitySession(threads, "local", Date.now()),
  inboxItems: [{ id: "old-local", threadId: "read", read: false }],
})();
assert.deepEqual(Array.from(ids), ["unread"], "activity must follow service receipts rather than local notification history");
const activityCases = [
  ...threads, { id: "running", readState: read, status: "running" },
  { id: "approval", status: { type: "waitingOnApproval" } },
  { id: "input", status: { type: "active", activeFlags: ["waitingOnUserInput"] } },
];
const attention = run("activityAttentionCount", { threads: activityCases, threadNeedsAttention,
  activityHiddenScheduled: null, activityScheduleUnread: null })();
assert.equal(attention, 3, "unread and waiting need attention, running alone and old inbox history do not");
assert.equal(run("activityAttentionCount", { threads: activityCases, threadNeedsAttention,
  activityHiddenScheduled: new Set(["unread"]), activityScheduleUnread: null })(), 2);
assert.equal(run("activityAttentionCount", { threads: activityCases, threadNeedsAttention,
  activityHiddenScheduled: null, activityScheduleUnread: new Set(["read"]) })(), 4);
assert.equal(run("activityAttentionCount", { threads: activityCases, threadNeedsAttention,
  activityHiddenScheduled: new Set(["read"]), activityScheduleUnread: new Set(["read"]) })(), 3);
assert.deepEqual(Array.from(run("activityThreadIds", {
  activityPriorityVisible: true,
  activityExclusions: new Set(),
  activitySnapshot: beginActivitySession(activityCases, "local", Date.now()),
})()), ["approval", "input", "unread", "running"]);
assert.equal(threadNeedsAttention({ id: "cleared", readState: read, status: "idle" }), false);
for (const status of [
  "waitingOnUserInput", "waitingOnApproval",
  { type: "active", activeFlags: ["waitingOnApproval"] },
  { type: "active", activeFlags: ["waitingOnUserInput"] },
]) {
  assert.equal(threadNeedsAttention({ id: "waiting", readState: read, status }), true);
  assert.equal(threadHasActivity({ id: "waiting", readState: read, status }), true);
}
assert.equal(threadNeedsAttention({ id: "active", status: { type: "active", activeFlags: [] } }), false);
assert.equal(threadHasActivity({ id: "active", status: { type: "active", activeFlags: [] } }), true);
let attentionProp;
function findAttentionProp(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "activityAttentionCount")
    attentionProp = node.initializer.expression.getText(ast);
  ts.forEachChild(node, findAttentionProp);
}
findAttentionProp(ast);
assert.equal(attentionProp, "activityAttentionCount", "sidebar must consume the real attention count");
const sidebar = ts.createSourceFile("CodexSidebar.tsx", fs.readFileSync("src/components/CodexSidebar.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let filter;
function findFilter(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(sidebar) === "filteredThreads")
    filter = node.initializer.arguments[0].getText(sidebar);
  ts.forEachChild(node, findFilter);
}
findFilter(sidebar); assert.ok(filter);
const visible = vm.runInNewContext(compile(filter), {
  threads: [...threads, { id: "running", status: { type: "active" } },
    { id: "waiting", status: { type: "active", activeFlags: ["waitingOnUserInput"] } }],
  activityThreads: [{id:"unread"},{id:"running"},{id:"waiting"}], activityVisibleCount: 10,
  activityOnly: true, searchQuery: "",
})();
assert.deepEqual(Array.from(visible, thread => thread.id), ["unread", "running", "waiting"]);

const writes = [], toasts = [], localWrites = [];
const context = {
  activeThreadId: "unread", activeThreadObj: threads[0], activityThreadIds: ["unread"],
  isThreadReadState, handleSetThreadReadState: async (...args) => writes.push(args),
  showAppToast: (...args) => toasts.push(args), setInboxItems: update => localWrites.push(update),
};
const action = run("handleThreadMenuAction", context);
await action("mark_unread");
assert.deepEqual(writes, [["unread", "r2", false]]);
assert.equal(localWrites.length, 0, "read action cannot manufacture inbox changes");
assert.equal(toasts.length, 0, "no success until the real service result");
context.activeThreadObj = { id: "unread" };
await action("mark_unread");
assert.equal(writes.length, 1, "unsupported receipt does not write");

const menuCode = declarations.get("threadMenuItems").arguments[0].getText(ast);
const shortcuts = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shortcuts.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: shortcuts.exports });
const menuContext = {
  effectiveBindings: shortcuts.exports.effectiveBindings,
  keyboardState: { bindings: [], primaryNumberShortcutTarget: "tabs" },
  ...context, pinnedThreadIds: [], sidebarProjectMembership: { localProjects: [] }, projectMoveBusy: false,
  shareAvailable: false,
  workspaceOpenTargets: { items: null },
  React: { createElement: () => null },
};
for (const [, name] of menuCode.matchAll(/<(\w+Icon)/g)) menuContext[name] = () => null;
const menu = vm.runInNewContext(compile(menuCode), menuContext);
assert.equal(menu().some(item => item.id === "mark_unread"), false);
menuContext.activeThreadObj = threads[0];
assert.equal(menu().find(item => item.id === "mark_unread").label, "标记为已读");
menuContext.activeThreadObj = threads[1];
assert.equal(menu().find(item => item.id === "mark_unread").label, "标记为未读");

let finish, refreshes = 0;
const bulkCalls = [], errors = [], locks = new Set();
const bulkContext = {
  threadsRef: { current: threads }, isThreadReadState, readStateWritesRef: { current: locks },
  activitySessionRef: { current: {scope:"local",threadIds:["unread"]} },
  activityGenerationRef: { current: 1 }, activityScopeRef: { current: "local" },
  activityPriorityVisibleRef: { current: true },
  activityExclusionsRef: { current: new Set() },
  activityScheduleIdsRef: { current: null },
  activityScheduleUnreadRef: { current: null }, activityCanMarkRead: activity.exports.activityCanMarkRead,
  callAppServer: async (...args) => { bulkCalls.push(args); return args[0] === "thread/read" ? {readState:unread} : new Promise(resolve => { finish = resolve; }); },
  refreshThreads: async () => refreshes++, showAppToast: (...args) => errors.push(args),
};
const markAll = run("markAllThreadsRead", bulkContext);
const pending = markAll(); for(let i=0;i<5;i++) await Promise.resolve();
await markAll();
assert.equal(bulkCalls.length, 2, "bulk gestures share per-thread single-flight for read and update");
assert.equal(bulkCalls[0][0], "thread/read");
assert.equal(bulkCalls[1][0], "thread/readState/update");
assert.equal(bulkCalls[1][1].threadId, "unread");
assert.equal(bulkCalls[1][1].expectedRevision, "r2");
assert.equal(bulkCalls[1][1].operation.type, "read");
finish({ readState: read }); await pending;
assert.equal(locks.size, 0);
const beforeFailure = bulkCalls.length;
bulkContext.callAppServer = async (...args) => { bulkCalls.push(args); throw Error("revision conflict"); };
await markAll();
assert.equal(bulkCalls.length, beforeFailure + 1, "conflict is never automatically retried");
assert.match(errors[0][0], /revision conflict/);
assert.ok(refreshes >= 2, "partial failure still refreshes authoritative receipts");
const nextUnread = { revision: "r3", firstUnread: { type: "turn", turnId: "new-turn" } };
bulkContext.threadsRef.current = [{ id: "unread", readState: nextUnread }];
bulkContext.callAppServer = async (...args) => {
  bulkCalls.push(args);
  return { readState: args[0] === "thread/read" ? nextUnread : read };
};
await markAll();
assert.equal(bulkCalls.at(-1)[1].expectedRevision, "r3", "next gesture uses the latest receipt, never an old revision");
assert.equal(bulkContext.threadsRef.current[0].readState, nextUnread, "write replies cannot optimistically overwrite authoritative unread data");
assert.equal(locks.size, 0);
console.log("PASS RD01-RD04 and Activity predicate/handler regressions: service activity/attention, status and flag waiting, running without dot, source wiring, bulk single-flight/conflict/latest revision; UI actions, native and snapshot retention not covered");
