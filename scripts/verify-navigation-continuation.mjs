import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

assert.ok(fs.existsSync("src/navigationContinuation.ts"), "deferred navigation handshake must exist");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/navigationContinuation.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api, Promise });
const { awaitGuardedNavigation: wait, deferNavigation: defer, cancelNavigation: cancel, takeNavigation: take } = api;
const signal = () => new AbortController().signal;
let runs = 0;
assert.equal(await wait(null, () => { runs++; }, signal()), true);
assert.equal(runs, 1);
assert.equal(await wait(() => false, () => { runs++; }, signal()), false);
assert.equal(runs, 1, "busy false is not a deferred confirmation");
assert.equal(await wait(() => true, async () => false, signal()), false);
assert.equal(await wait(() => true, async () => true, signal()), true);
await assert.rejects(wait(() => true, () => { throw Error("sync-action"); }, signal()), /sync-action/);
await assert.rejects(wait(() => true, async () => { throw Error("async-action"); }, signal()), /async-action/);
await assert.rejects(wait(() => { throw Error("guard-error"); }, () => {}, signal()), /guard-error/);
const pending = { current: null }, guard = action => { defer(pending, action); return false; };
const first = wait(guard, () => { runs++; }, signal());
cancel(pending); assert.equal(await first, false);
const approved = wait(guard, () => { runs++; }, signal());
const approvedAction = take(pending); approvedAction(); approvedAction();
assert.equal(await approved, true); assert.equal(runs, 2, "approval is one-shot");
const old = wait(guard, () => { runs++; }, signal());
const newer = wait(guard, () => { runs++; }, signal());
assert.equal(await old, false); take(pending)(); assert.equal(await newer, true);
const declinedByAction = wait(guard, async () => false, signal());
take(pending)(); assert.equal(await declinedByAction, false, "approved navigation may still retire before its async commit");
const controller = new AbortController(), aborted = wait(guard, () => { runs++; }, controller.signal);
const late = pending.current; controller.abort(); assert.equal(await aborted, false);
const beforeAbort = runs; late(); assert.equal(runs, beforeAbort);
const pre = new AbortController(); pre.abort();
assert.equal(await wait(() => { throw Error("must not enter guard"); }, () => {}, pre.signal), false);
let finish; const executingController = new AbortController();
const executing = wait(() => true, () => new Promise(resolve => { finish = resolve; }), executingController.signal);
executingController.abort(); assert.equal(await executing, false); finish(true);
let plainRuns = 0; defer(pending, () => { plainRuns++; }); take(pending)(); assert.equal(plainRuns, 1);

function leaf(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = []; const walk = node => { nodes.push(node); ts.forEachChild(node, walk); }; walk(ast);
  const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)?.initializer;
  const ref = { current: null }, confirmations = [], discarded = [];
  const state = { canNavigate: () => true, isDirty: () => true, discard: () => discarded.push(true) };
  const context = { ...api, pendingAction: ref, pendingNavigation: ref, latest: { current: state }, state,
    operation: { current: false }, dirty: () => true, dirtyNow: () => true,
    identity: "owner", currentIdentity: { current: "owner" }, currentContext: { current: "context" }, context: "context",
    currentActive: { current: true }, currentEditing: { current: true }, memoryNavigationGuard: { current: null },
    setConfirmation: value => confirmations.push(value), restoreFocus() {}, focusEditor() {}, closeEditor() {},
    current: { current: {} }, updateView() {}, confirmation: "discard", epoch: { current: 0 },
    mounted: { current: true }, generation: { current: 0 }, detailRequest: { current: 0 }, refreshQueued: { current: false },
    disposed: false, unlisten: undefined, onFocus() {}, window: { removeEventListener() {} },
    save: () => context.saveResult(), saveResult: async () => false,
  };
  const execute = node => {
    assert.ok(node, `production callback missing in ${file}`);
    const exports = {};
    vm.runInNewContext(ts.transpileModule(`exports.callback = (${node.getText(ast)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { ...context, exports });
    return exports.callback;
  };
  const button = label => nodes.filter(ts.isJsxElement).find(node => node.openingElement.tagName.getText(ast) === "button"
    && node.children.some(child => ts.isJsxText(child) && child.text.trim() === label));
  const attribute = (node, name) => node?.openingElement.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name)?.initializer?.expression;
  const keepNode = attribute(button("继续编辑"), "onClick");
  const keep = execute(ts.isIdentifier(keepNode) ? variable(keepNode.text) : keepNode);
  const discard = execute(attribute(button(file.includes("LocalEnvironment") ? "放弃" : "放弃更改"), "onClick"));
  const actualGuard = execute(variable("guard"));
  const dialogs = nodes.filter(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "dialog");
  context.cancelConfirmation = keep;
  const escape = execute(attribute(dialogs.find(node => /cancelNavigation|cancelConfirmation/.test(attribute(node, "onCancel")?.getText(ast) ?? "")), "onCancel"));
  const cleanups = nodes.filter(node => ts.isReturnStatement(node) && node.expression && ts.isArrowFunction(node.expression)
    && node.expression.getText(ast).includes("cancelNavigation("));
  assert.ok(cleanups.length, `unmount/context cleanup must cancel ${file}`);
  return { ref, context, actualGuard, keep, discard, escape, cleanup: execute(cleanups[0].expression),
    saveAndContinue: file.includes("LocalEnvironment") ? execute(attribute(button("保存并继续"), "onClick")) : null };
}
for (const name of ["PersonalizationSettings", "LocalEnvironmentSettings", "McpSettings", "ProfileSettings"]) {
  const h = leaf(`src/components/${name}.tsx`);
  let navigations = 0;
  const approved = wait(h.actualGuard, () => { navigations++; }, signal()); h.discard(); assert.equal(await approved, true);
  for (const cancelAction of [h.keep, () => h.escape({ preventDefault() {} }), h.cleanup]) {
    const result = wait(h.actualGuard, () => { navigations++; }, signal()); const stale = h.ref.current;
    cancelAction(); assert.equal(await result, false); stale(); assert.equal(navigations, 1, `${name} cancelled continuation remains inert`);
  }
  const replaced = wait(h.actualGuard, () => { navigations++; }, signal());
  const replacement = wait(h.actualGuard, () => { navigations++; }, signal());
  assert.equal(await replaced, false); h.keep(); assert.equal(await replacement, false);
  h.discard(); assert.equal(navigations, 1, `${name} later discard cannot resume a cancelled capture`);
  if (name === "PersonalizationSettings") {
    const nested = { current: null };
    h.context.memoryNavigationGuard.current = action => { defer(nested, action); return false; };
    const forwarded = wait(h.actualGuard, () => { navigations++; }, signal());
    assert.equal(typeof nested.current.onDeferred, "function", "nested guard receives the original action hooks");
    cancel(nested); assert.equal(await forwarded, false);
    h.context.memoryNavigationGuard.current = null;
  }
  if (h.saveAndContinue) {
    const failed = wait(h.actualGuard, () => { navigations++; }, signal());
    await h.saveAndContinue(); assert.equal(await failed, false, "failed save settles original capture");
    let finishSave;
    h.context.saveResult = () => new Promise(resolve => { finishSave = resolve; });
    const abandoned = wait(h.actualGuard, () => { navigations++; }, signal());
    const saving = h.saveAndContinue(); h.cleanup();
    assert.equal(await abandoned, false, "unmount cancels the continuation while save is pending");
    finishSave(true); await saving; assert.equal(navigations, 1);
  }
}
console.log("PASS guarded navigation: immediate/busy/deferred, approve/cancel/replace/abort/error/async result; four production leaf guards and discard/keep/Escape/context cleanup, failed save; no UI layout or service execution claimed.");
