import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/AutomationsView.tsx", "utf8");
const ast = ts.createSourceFile("AutomationsView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
let loadCleanup;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["refresh", "handleCreate", "handleToggleStatus", "handleDelete", "handleRunNow", "handleStartEdit"].includes(node.name.getText(ast))) callbacks[node.name.getText(ast)] = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("++listRequestRef.current")) loadCleanup = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const automation = { id: "one", name: "task", prompt: "inspect", status: "ACTIVE", kind: "cron", cwds: ["repo"], rrule: "FREQ=DAILY" };
function mount() {
  const requests = [], notices = [];
  const context = {
    name: "draft", prompt: "inspect", kind: "cron", rrule: "FREQ=DAILY",
    activeWorkspaceRoot: "repo", execEnv: "local", selectedModel: "", editingItem: null,
    schedulerState: "ready", runBusyId: null, writePendingRef: { current: false }, runPendingRef: { current: false }, listRequestRef: { current: 0 },
    confirm: () => true, syncScheduleAfterConfigChange() {}, loadScheduler() {}, refresh() {},
    shortId: id => id, makeRecordKey: () => "key", appendRunRecord: (records, record) => [record, ...records],
    isSchedulerUnavailableError: error => error?.unavailable === true,
    setNotice: notice => notices.push(notice),
    tauriInvoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
    runAutomationNow(id) { return context.tauriInvoke("automations_run_now", { id }); },
  };
  for (const name of ["Automations", "Name", "Prompt", "EditingItem", "ShowCreateForm", "WriteBusy", "RunBusyId", "RunThreads", "RunHistory", "SchedulerState", "Scheduler", "Kind", "Rrule", "ExecEnv", "SelectedModel"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { context[key] = typeof value === "function" ? value(context[key] ?? (key === "runHistory" ? [] : {})) : value; };
  }
  const execute = node => vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "applyStartedEvent")
      context.applyStartedEvent = execute(node);
  }
  return { context, requests, notices, ...Object.fromEntries(Object.entries(callbacks).map(([name, node]) => [name, execute(node)])),
    cleanup: () => execute(loadCleanup)() };
}
{
  const view = mount(), pending = view.handleCreate();
  await view.handleCreate(); await view.handleToggleStatus(automation); await view.handleDelete("one");
  assert.equal(view.requests.length, 1, "AU01: shared write lock prevents rapid duplicate writes");
  view.handleStartEdit(automation);
  assert.equal(view.context.editingItem, null, "AU02: cannot replace editor during save");
  view.requests[0].reject(Error("save denied")); await pending;
  assert.equal(view.context.name, "draft"); assert.equal(view.context.prompt, "inspect");
  assert.ok(view.notices[0].text.includes("save denied"));
  assert.equal(view.context.writePendingRef.current, false);
  const retry = view.handleCreate(); view.requests[1].resolve([automation]); await retry;
  assert.equal(view.context.name, ""); assert.equal(view.context.showCreateForm, false);
}
for (const operation of ["handleToggleStatus", "handleDelete"]) {
  const view = mount(), pending = view[operation](operation === "handleDelete" ? "one" : automation);
  view.requests[0].reject(Error("write denied")); await pending;
  assert.equal(view.context.writePendingRef.current, false);
  assert.ok(view.notices[0].text.includes("write denied"), "AU01: status/delete failure is visible and unlocks");
}
{
  const view = mount(), older = view.refresh(), saving = view.handleCreate();
  view.requests[1].resolve([automation]); await saving;
  view.requests[0].resolve([]); await older;
  assert.equal(view.context.automations[0].id, "one", "AU03: old list cannot replace successful mutation");
  const stale = view.refresh(), cleanup = view.cleanup(); cleanup();
  view.requests[2].reject(Error("old read")); await stale;
  assert.equal(view.notices.length, 0, "AU03: unmounted old read failure is ignored");
}
{
  const view = mount(), saving = view.handleCreate(), readDuringSave = view.refresh();
  view.requests[0].resolve([automation]); await saving;
  view.requests[1].resolve([]); await readDuringSave;
  assert.equal(view.context.automations[0].id, "one", "AU03: a read started during save cannot erase its committed result");
}
{
  const view = mount(), running = view.handleRunNow(automation);
  await view.handleRunNow(automation);
  assert.equal(view.requests.length, 1, "AU04: synchronous lock prevents two executions");
  view.requests[0].resolve({ threadId: "thread-one" }); await running;
  assert.equal(view.context.runThreads.one, "thread-one");
  assert.equal(view.context.runPendingRef.current, false);
}
{
  const view = mount(); view.context.schedulerState = "unavailable";
  await view.handleRunNow(automation);
  assert.equal(view.requests.length, 0, "AU05: unavailable scheduler cannot fall back to implicit execution");
  assert.ok(view.notices[0].text.includes("尚未运行"));
  view.context.schedulerState = "ready";
  const pending = view.handleRunNow(automation);
  view.requests[0].reject({ unavailable: true }); await pending;
  assert.equal(view.requests.length, 1);
  assert.ok(view.notices.at(-1).text.includes("尚未运行"));
}
const appSource = fs.readFileSync("src/App.tsx", "utf8");
const app = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let selected;
function appVisit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === "AutomationsView") {
    selected = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(app) === "onSelectThread")?.initializer.expression;
  }
  ts.forEachChild(node, appVisit);
}
appVisit(app);
assert.equal(selected.getText(app), "selectThread", "AU06: restore full thread context using the existing selector");
assert.ok(!source.includes("onRunAutomationNow"), "AU05: no implicit alternate execution callback");
console.log("PASS AU01–AU06 production automation callbacks: shared CRUD lock, drafts, stale reads, run lock, honest unavailable state and full thread loading");
