import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
const ast = ts.createSourceFile("DiffDrawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, registration, focusEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "openFilePreview") callback = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("onFilePreviewHandlerChange")) registration = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("previewFocusRequest")) focusEffect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback, "production preview callback exists");
assert.ok(registration, "production host registers its awaited preview handler");
assert.ok(focusEffect, "production host defers editor focus until modal close");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const preview = path => ({ path, content: "# Skill", isBinary: false, isImage: false });
function mount() {
  const reads = [], fallbacks = [], events = [], frames = new Map();
  let handler;
  const context = {
    cwd: "root", connectionIdentity: "local", open: true,
    activeKind: "files", previewFocusRequest: null,
    fileEditorRef: { current: { focus: () => events.push(["editorFocus"]) } },
    filePreviewPaneRef: { current: { focus: () => events.push(["paneFocus"]) } },
    window: { requestAnimationFrame: callback => { const id = frames.size + 1; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id) },
    setPreviewFocusRequest: value => { context.previewFocusRequest = value; },
    gitContextRef: { current: { cwd: "root", connectionIdentity: "local", open: true } },
    previewRequestRef: { current: 0 }, editRevisionRef: { current: 0 },
    isDirtyRef: { current: false }, filePreviewRef: { current: preview("old") },
    editedContentRef: { current: "old" }, editorOpenRef: { current: true },
    readTextPreviewViaProtocol(path) { const task = deferred(); reads.push({ path, ...task }); return task.promise; },
    invoke(command, args) { assert.equal(command, "fs_read_preview"); const task = deferred(); fallbacks.push({ ...args, ...task }); return task.promise; },
    MAX_TEXT_PREVIEW_BYTES: 262144, isPreviewFallbackError: () => true,
    console: { warn() {} }, showToast: text => events.push(["toast", text]),
    onFilePreviewHandlerChange: value => { handler = value; },
  };
  for (const name of ["FilePreview", "EditedContent", "IsDirty", "ActiveTab", "SelectedTreePath"]) {
    context[`set${name}`] = value => events.push([name, value]);
  }
  const run = node => vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  context.openFilePreview = run(callback);
  const cleanup = run(registration)();
  return { context, reads, fallbacks, events, cleanup, focus: () => run(focusEffect)(), frame: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }, get handler() { return handler; } };
}
{
  const view = mount(); view.context.isDirtyRef.current = true;
  assert.equal(await view.handler("SKILL.md"), false, "dirty editor refuses open");
  assert.equal(view.reads.length, 0, "dirty guard runs before any read");
  assert.equal(view.events.some(([name]) => name === "ActiveTab"), false);
  view.cleanup(); assert.equal(view.handler, null, "unmount unregisters host");
}
{
  const view = mount(), oldHandler = view.handler;
  view.context.gitContextRef.current = { cwd: "other", connectionIdentity: "remote", open: true };
  assert.equal(await oldHandler("SKILL.md"), false, "old registration cannot open in a new context");
  assert.equal(view.reads.length, 0);
}
for (const legacy of [false, true]) {
  const view = mount(), pending = view.handler("SKILL.md");
  if (legacy) {
    view.reads[0].reject(Error("binary fallback")); await settle();
    view.fallbacks[0].resolve(preview("SKILL.md"));
  } else view.reads[0].resolve(preview("SKILL.md"));
  assert.equal(await pending, true, "only applied read reports success");
  assert.equal(view.context.filePreviewRef.current.path, "SKILL.md");
  assert.ok(view.events.some(([name, value]) => name === "ActiveTab" && value === "files"));
  assert.ok(view.events.some(([name, value]) => name === "SelectedTreePath" && value === "SKILL.md"));
}
{
  const view = mount(), pending = view.handler("missing");
  view.reads[0].reject(Error("protocol failed")); await settle();
  view.fallbacks[0].reject(Error("missing"));
  assert.equal(await pending, false, "failed fallback cannot close skill detail");
  assert.equal(view.context.filePreviewRef.current.path, "old");
}
for (const invalidate of [
  view => view.context.previewRequestRef.current++,
  view => view.context.editRevisionRef.current++,
  view => { view.context.gitContextRef.current = { cwd: "other", connectionIdentity: "local", open: true }; },
  view => { view.context.gitContextRef.current = { cwd: "root", connectionIdentity: "remote", open: true }; },
  view => { view.context.gitContextRef.current = { cwd: "root", connectionIdentity: "local", open: false }; },
]) {
  for (const reject of [false, true]) {
    const view = mount(), pending = view.handler("SKILL.md");
    invalidate(view);
    if (reject) view.reads[0].reject(Error("late failure")); else view.reads[0].resolve(preview("SKILL.md"));
    assert.equal(await pending, false, "obsolete read returns false");
    assert.equal(view.context.filePreviewRef.current.path, "old");
    assert.equal(view.fallbacks.length, 0, "obsolete protocol cannot start fallback");
    assert.equal(view.events.some(([name]) => name === "ActiveTab"), false, "obsolete read cannot select Files");
  }
}
for (const binary of [false, true]) {
  const view = mount(), pending = view.handler("SKILL.md");
  view.reads[0].resolve({ ...preview("SKILL.md"), isBinary: binary }); await pending;
  const cleanupFocus = view.focus();
  assert.equal(view.events.some(([name]) => /Focus$/.test(name)), false, "focus cannot run synchronously while dialog is modal");
  view.frame();
  assert.ok(view.events.some(([name]) => name === (binary ? "paneFocus" : "editorFocus")));
  cleanupFocus();
}
for (const invalidate of [
  view => { view.context.editorOpenRef.current = false; },
  view => { view.context.gitContextRef.current = { cwd: "other", connectionIdentity: "local", open: true }; },
  view => view.context.previewRequestRef.current++,
  view => { view.context.filePreviewRef.current = preview("other.md"); },
]) {
  const view = mount(), pending = view.handler("SKILL.md");
  view.reads[0].resolve(preview("SKILL.md")); await pending;
  const cleanupFocus = view.focus(); invalidate(view); view.frame(); cleanupFocus();
  assert.equal(view.events.some(([name]) => /Focus$/.test(name)), false, "obsolete focus request cannot steal focus");
}
{
  const view = mount(), pending = view.handler("SKILL.md");
  view.reads[0].resolve(preview("SKILL.md")); await pending;
  view.focus()(); view.frame();
  assert.equal(view.events.some(([name]) => /Focus$/.test(name)), false, "effect cleanup cancels focus frame");
}
console.log("PASS skill file host: dirty guard, protocol/fallback apply, failed read, request/revision/context invalidation, reveal and unregister; native IPC unverified");
