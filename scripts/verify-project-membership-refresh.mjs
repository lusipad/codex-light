import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the actual production callbacks with controlled RPC promises and React state.
// This is L2 notification/list concurrency evidence, not native UI verification.
const app = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const protocol = ts.createSourceFile("protocol.ts", fs.readFileSync("src/protocol.ts", "utf8"), ts.ScriptTarget.Latest, true);
function initializer(ast, name) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(found, `actual ${name} initializer must be found`);
  return found;
}
const compile = text => ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const refreshCode = compile(initializer(app, "refreshThreads").arguments[0].getText(app));
const notifyCode = compile(initializer(app, "handleNotification").getText(app));
const NOTIFICATION = vm.runInNewContext(compile(initializer(protocol, "NOTIFICATION").getText(protocol)));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
export function mountMembershipRefresh(rpc, initial = [{ id: "a", projectId: "A" }]) {
  let threads = initial, projectRefreshes = 0, workspaceRefreshes = 0;
  const calls = [], warnings = [], refreshes = [];
  const context = vm.createContext({
    NOTIFICATION, activeThreadIdRef: { current: "a" }, refreshThreadsGenerationRef: { current: 0 },
    callAppServer: async (method, params) => { calls.push({ method, params }); return rpc(method, params, calls.length); },
    setThreads: update => { threads = typeof update === "function" ? update(threads) : update; },
    setProjectsRefreshToken: update => { projectRefreshes = update(projectRefreshes); },
    refreshWorkspacesAndMeta: () => { workspaceRefreshes++; },
    console: { warn: (...args) => warnings.push(args) },
  });
  const refresh = vm.runInContext(refreshCode, context);
  context.refreshThreads = () => { const pending = refresh(); refreshes.push(pending); return pending; };
  return {
    refresh: context.refreshThreads,
    notify: vm.runInContext(notifyCode, context),
    threads: () => threads, calls, warnings,
    projectRefreshes: () => projectRefreshes,
    workspaceRefreshes: () => workspaceRefreshes,
    settle: () => Promise.all(refreshes),
  };
}

{
  const old = deferred();
  const view = mountMembershipRefresh(async (_method, _params, count) => count === 1 ? old.promise : { data: [{ id: "a", projectId: "B" }], nextCursor: null });
  const pending = view.refresh();
  view.notify({ method: NOTIFICATION.THREAD_PROJECT_UPDATED, params: { threadId: "a", projectId: "B" } });
  assert.equal(view.threads()[0].projectId, "B", "notification is applied immediately");
  old.resolve({ data: [{ id: "a", projectId: "A" }], nextCursor: "stale-page" });
  await pending; await view.settle();
  assert.equal(view.threads()[0].projectId, "B", "stale thread/list must not overwrite a newer canonical assignment");
  assert.equal(view.calls.length, 2, "notification refetches once and stale cursor traversal stops");
}
for (const params of [{ threadId: "a" }, { threadId: "a", projectId: 7 }, { threadId: "a", projectId: {} }, { threadId: 1, projectId: null }, { threadId: "", projectId: null }]) {
  const view = mountMembershipRefresh(async () => { throw Error("invalid notifications must not refetch"); });
  view.notify({ method: NOTIFICATION.THREAD_PROJECT_UPDATED, params });
  assert.equal(view.threads()[0].projectId, "A", "missing/invalid fields must not clear canonical membership");
  assert.equal(view.calls.length, 0);
}
{
  const older = deferred(), newest = deferred();
  const view = mountMembershipRefresh(async (_method, _params, count) => count === 1 ? older.promise : newest.promise);
  view.notify({ method: NOTIFICATION.THREAD_PROJECT_UPDATED, params: { threadId: "a", projectId: "B" } });
  view.notify({ method: NOTIFICATION.THREAD_PROJECT_UPDATED, params: { threadId: "a", projectId: null, project_id: "wrong-alias" } });
  assert.equal(view.threads()[0].projectId, null, "explicit camelCase null wins over legacy alias");
  newest.resolve({ data: [{ id: "a", projectId: null }], nextCursor: null });
  older.resolve({ data: [{ id: "a", projectId: "B" }], nextCursor: null });
  await view.settle(); assert.equal(view.threads()[0].projectId, null);
}
{
  const view = mountMembershipRefresh(async () => { throw Error("service disconnected"); });
  view.notify({ method: NOTIFICATION.THREAD_PROJECT_UPDATED, params: { threadId: "a", projectId: null } });
  await view.settle(); assert.equal(view.threads()[0].projectId, null, "read failure preserves the notification instead of restoring old membership");
  assert.ok(view.warnings.length);
}
{
  const view = mountMembershipRefresh(async () => ({ data: [{ id: "a", projectId: "A" }, { id: "b", projectId: "B" }], nextCursor: null }));
  view.notify({ method: NOTIFICATION.THREAD_PROJECT_UPDATED, params: { thread_id: "b", project_id: "B" } });
  await view.settle(); assert.equal(view.threads().find(t => t.id === "b").projectId, "B", "unknown/unselected threads are discovered globally");
  assert.equal(view.threads().find(t => t.id === "a").projectId, "A");
}
{
  const old = deferred();
  const view = mountMembershipRefresh(async (_method, _params, count) => count === 1 ? old.promise : { data: [{ id: "a", projectId: null }], nextCursor: null });
  const pending = view.refresh();
  view.notify({ method: NOTIFICATION.PROJECT_CHANGED, params: {} });
  old.resolve({ data: [{ id: "a", projectId: "deleted-project" }], nextCursor: null });
  await pending; await view.settle();
  assert.equal(view.projectRefreshes(), 1); assert.equal(view.threads()[0].projectId, null);
  assert.equal(view.workspaceRefreshes(), 1, "project changes must reload explicit workspace identity bindings");
}
console.log("PASS actual membership notification/list callbacks: stale pages, assignment/clear race, nullable fields, alias precedence, unknown threads, failure retention and project changes (L2)");
