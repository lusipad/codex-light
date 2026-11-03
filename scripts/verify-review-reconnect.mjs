import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(`src/${name}.ts`, "utf8")), {
    exports, require: path => load(path.replace(/^\.\//, "")),
  });
  modules.set(name, exports);
  return exports;
}
const { createReviewResults } = load("reviewResults");
const { extractTextFromItem } = load("threadText");
const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
let effect, statusCallback, replayCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node);
  if (ts.isFunctionDeclaration(node)) declarations.set(node.name?.text, node);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("const restoreReviewResults")) effect = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast).startsWith("tauriListen") && node.arguments[0]?.getText(ast) === '"app-server:status"') statusCallback = node.arguments[1];
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "replayThreadNotificationRef.current") replayCallback = node.right;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect && statusCallback && replayCallback);
const cleanup = effect.body.statements.find(ts.isReturnStatement).expression.getText(ast);
const snippet = `(() => {
  ${declarations.get("disposed").parent.getText(ast)};
  ${declarations.get("reviewReconnectRevision").parent.getText(ast)};
  ${declarations.get("restoreReviewResults").parent.getText(ast)};
  ${declarations.get("handleNotification").parent.getText(ast)};
  return { restore: restoreReviewResults, status: ${statusCallback.getText(ast)}, notification: handleNotification, replay: ${replayCallback.getText(ast)}, cleanup: ${cleanup} };
})()`;
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function mount() {
  const tracker = createReviewResults(() => {}), calls = [], warnings = [];
  const attempt = tracker.begin("review-thread", "/old", ["/old"]);
  tracker.bind("review-thread", attempt, "review-turn");
  tracker.disconnected();
  const noop = () => {};
  const context = {
    reviewResultsRef: { current: tracker }, extractTextFromItem,
    callAppServer: (method, params) => { const pending = defer(); calls.push({ method, params, ...pending }); return pending.promise; },
    console: { warn: (...args) => warnings.push(args) },
    activeThreadIdRef: { current: "different-thread" }, threadRequestRef: { current: 0 },
    threadHistoryBufferRef: { current: { capture: () => true } }, NOTIFICATION: {},
    setAppServerStatus: noop, accountReadRequestRef: { current: 0 }, pendingRequestRevisionRef: { current: 0 },
    setAccountInfo: noop, setPendingRequests: noop, setRequestResponses: noop,
    refreshModels: noop, refreshThreads: noop, refreshPendingRequests: noop, refreshAccount: noop,
  };
  for (const key of ["unlistenResolved", "unlistenStatus", "unlistenNotification", "unlistenWorkspaceWarning", "unlistenServerReq"]) context[key] = Promise.resolve(noop);
  vm.createContext(context);
  vm.runInContext(compile(["mapTurnObject", "normalizeTurnsFromList"].map(name => declarations.get(name).getText(ast)).join("\n")), context);
  const handlers = vm.runInContext(compile(snippet), context);
  return { ...handlers, context, tracker, calls, warnings };
}
const delta = text => ({ method: "item/agentMessage/delta", params: { threadId: "review-thread", turnId: "review-turn", itemId: "answer", delta: text } });
const answer = status => ({ id: "review-turn", ...(status ? { status } : {}), ...(status === "failed" ? { error: { message: "real failure" } } : {}), items: [{ id: "answer", type: "agentMessage", text: "historical result" }] });
{
  const v = mount(), restoring = v.restore();
  assert.equal(v.calls[0].method, "thread/read");
  assert.equal(v.calls[0].params.includeTurns, false);
  v.calls[0].resolve({ thread: { cwd: "/actual" } }); await flush();
  assert.equal(v.calls[1].method, "thread/turns/list");
  assert.equal(v.calls[1].params.itemsView, "full");
  v.calls[1].resolve({ data: [{ id: "newer", status: "completed", items: [] }], nextCursor: "older" }); await flush();
  assert.equal(v.calls[2].params.cursor, "older");
  v.calls[2].resolve({ data: [answer("failed")], nextCursor: "more" }); await restoring;
  const [run] = v.tracker.getRuns();
  assert.equal(run.status, "failed", "RR01: reconnect uses the actual terminal state, including failure");
  assert.equal(run.text, "historical result");
  assert.equal(run.error, "real failure", "RR01: reconnect preserves real turn errors");
  assert.equal(v.calls.length, 3, "known review identity ends pagination after it is found");
}
{
  const v = mount(), restoring = v.restore();
  v.calls[0].resolve({ thread: { cwd: "/repo" } }); await flush();
  v.calls[1].resolve({ data: [], nextCursor: "repeat" }); await flush();
  v.calls[2].resolve({ data: [], nextCursor: "repeat" }); await restoring;
  assert.equal(v.tracker.getRuns()[0].status, "unknown");
  assert.ok(v.warnings[0][1].message.includes("游标重复"), "RR02: cursor loops must be reported instead of hydrated as success");
}
for (const invalidate of ["disconnect", "notification", "unmount"]) {
  const v = mount(), restoring = v.restore();
  v.calls[0].resolve({ thread: { cwd: "/repo" } }); await flush();
  if (invalidate === "disconnect") v.status({ connected: false });
  if (invalidate === "notification") v.notification(delta("fresh live text"));
  if (invalidate === "unmount") v.cleanup();
  v.calls[1].resolve({ data: [answer("completed")] }); await restoring;
  const [run] = v.tracker.getRuns();
  assert.equal(run.status, "unknown", `RR03: ${invalidate} invalidates an older history read`);
  assert.equal(run.text, invalidate === "notification" ? "fresh live text" : "");
}
{
  const v = mount(), payload = delta("one");
  v.notification(payload);
  assert.equal(v.tracker.getRuns()[0].text, "one", "RR04: offscreen notifications still reach review results");
  v.context.activeThreadIdRef.current = "review-thread";
  v.replay(payload);
  v.replay(structuredClone(payload));
  assert.equal(v.tracker.getRuns()[0].text, "one", "RR05: original and cloned payload replay cannot append the delta twice");
}
{
  const v = mount();
  v.status({ connected: true });
  assert.equal(v.calls[0].method, "thread/read", "RR06: actual connected callback initiates recovery");
  v.calls[0].resolve({ thread: { cwd: "/repo" } }); await flush();
  v.calls[1].resolve({ data: [answer()] }); await flush();
  assert.equal(v.tracker.getRuns()[0].status, "unknown", "RR07: historical missing status must remain unknown");
}
for (const changed of [false, true]) {
  const v = mount();
  v.context.threadId = "review-thread";
  v.context.loadedTurns = [answer("completed"), { id: "old-other-turn", status: "completed", items: [] }];
  const expression = name => compile(`(${declarations.get(name).initializer.getText(ast)})`);
  v.context.reviewHistorySnapshot = vm.runInContext(expression("reviewHistorySnapshot"), v.context);
  if (changed) v.notification(delta("newer live result"));
  v.context.currentReviews = vm.runInContext(expression("currentReviews"), v.context);
  const history = vm.runInContext(expression("reviewHistory"), v.context);
  assert.equal(history.some(turn => turn.id === "review-turn"), !changed,
    "RR08: actual selectThread snapshot filter excludes history that raced with a live result");
  assert.equal(history.some(turn => turn.id === "old-other-turn"), true,
    "RR08: unchanged older turns remain available for history discovery");
}
console.log("PASS RR01-RR08: actual reconnect callbacks, pagination, terminal states, stale recovery guards, offscreen ingestion, replay deduplication and selectThread history snapshot");
