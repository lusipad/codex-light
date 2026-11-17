import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.createSourceFile("ComposerBox.tsx", fs.readFileSync("src/components/ComposerBox.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let helper, expression;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "reconcileComposerAttachmentOrder") helper = node;
  if (ts.isJsxExpression(node) && node.expression?.getText(source).startsWith("!cloudActive && attachmentOrder.map")) expression = node.expression;
  ts.forEachChild(node, visit);
}
visit(source); assert.ok(helper); assert.ok(expression);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const reconcile = vm.runInNewContext(compile(helper.getText(source) + "\nreconcileComposerAttachmentOrder;"));
const keys = order => Array.from(order, item => item.kind + ":" + item.id);
let order = reconcile([], ["file-a"], ["older"], []);
order = reconcile(order, ["file-a"], ["older"], ["A"]);
assert.deepEqual(keys(order), ["pending:A", "appshot:older", "file:file-a"]);
order = reconcile(order, ["file-a", "file-b"], ["older"], ["A", "B"]);
assert.deepEqual(keys(order), ["pending:B", "pending:A", "appshot:older", "file:file-a", "file:file-b"]);
for (const completion of [["A", "B"], ["B", "A"]]) {
  let current = order;
  for (let i = 0; i < completion.length; i++) current = reconcile(current, ["file-a", "file-b"], ["older", ...completion.slice(0, i + 1)], ["A", "B"]);
  assert.deepEqual(keys(current), ["appshot:B", "appshot:A", "appshot:older", "file:file-a", "file:file-b"]);
  assert.equal(reconcile(current, ["file-a", "file-b"], ["older", "A", "B"], []), current, "unchanged render preserves identity");
}
assert.deepEqual(keys(reconcile(order, ["file-a", "file-b"], ["older"], [])), ["appshot:older", "file:file-a", "file:file-b"]);
assert.deepEqual(keys(reconcile([{ kind: "pending", id: "A" }, { kind: "file", id: "file-a" }, { kind: "appshot", id: "A" }], ["file-a"], ["A"], [])), ["file:file-a", "appshot:A"], "existing completed slot wins over a duplicate pending slot");
const removed = [];
function render(attachmentOrder, appshots, cloudActive = false) {
  return vm.runInNewContext(compile("(" + expression.getText(source) + ")"), { attachmentOrder, appshots, cloudActive,
    attachedFiles: [{ id: "file-a" }, { id: "file-b" }], React: { createElement: (type, props) => ({ type, props }) },
    ComposerAttachmentChip: "file", AppshotAttachment: "capture", onRemoveAttachedFile: id => removed.push(id), onRemoveAppshot: id => removed.push(id) });
}
const contexts = [{ id: "older", context: { appName: "Original" } }];
const waiting = render(order, contexts);
assert.equal(waiting[0].props.context, null); assert.equal(waiting[0].props.pending, true);
assert.equal(waiting[0].props.handoffHeightReady, false); assert.equal(waiting[0].props.onRemove, undefined);
const finishedOrder = reconcile(order, ["file-a", "file-b"], ["older", "B"], ["A"]);
const finished = render(finishedOrder, [...contexts, { id: "B", context: { appName: "Real" } }]);
assert.equal(finished[0].props.key, waiting[0].props.key); assert.equal(finished[0].props.pending, false);
finished[0].props.onRemove(); finished.at(-1).props.onRemove(); assert.deepEqual(removed, ["B", "file-b"]);
assert.equal(render(order, contexts, true), false);
console.log("Production Composer: newest-start first, mixed-file order, in-place completion, cancellation, stable key and unresolved handoff passed.");

const appSource = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let captureCallback;
function findCapture(node) {
  if (ts.isCallExpression(node) && node.expression.getText(appSource) === "useAppshotsEntry") captureCallback = node.arguments[0].properties.find(property => property.name?.getText(appSource) === "onCapture").initializer;
  ts.forEachChild(node, findCapture);
}
findCapture(appSource); assert.ok(captureCallback);
for (const completion of [[1, 2], [2, 1]]) {
  let contexts = [{ id: "restored", context: {} }];
  const generation = { current: { scope: 3 } };
  const capture = vm.runInNewContext(compile("(" + captureCallback.getText(appSource) + ")"), {
    appshotScope: "scope", appshotCaptureGenerations: generation, setScopedAppshots: (scope, update) => { assert.equal(scope, "scope"); contexts = update(contexts); }
  });
  for (const order of completion) capture({ id: "shot-" + order, context: {}, capture: { generation: 3, order } });
  assert.deepEqual(Array.from(contexts, item => item.id), ["shot-2", "shot-1", "restored"], "actual App capture insertion follows start rank even out of order");
  capture(contexts[0]); assert.equal(contexts.length, 3);
  generation.current.scope++; capture({ id: "stale", capture: { generation: 3, order: 4 } });
  assert.equal(contexts.length, 3, "send generation still rejects a late result");
}
console.log("Actual App callback: sequential/reversed completion retains start order, restored items, duplicate rejection and stale-generation guard.");
