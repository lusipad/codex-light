import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
const ast = ts.createSourceFile("DiffDrawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
let change, close, discardEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["openFilePreview", "saveEditedFile", "closeFilePreview"].includes(node.name.getText(ast))) callbacks[node.name.getText(ast)] = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("discardResolverRef.current?.(false)")) discardEffect = node.arguments[0];
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attrs = node.attributes.properties;
    const attr = name => attrs.find(item => ts.isJsxAttribute(item) && item.name.getText(ast) === name)?.initializer;
    if (attr("className")?.getText(ast) === '"file-editor-textarea"') change = attr("onChange").expression;
    if (attr("title")?.getText(ast) === '"关闭预览"') close = attr("onClick").expression;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const preview = path => ({ path, content: `${path} original`, isBinary: false, isImage: false });
function mount() {
  const reads = [], writes = [], events = [];
  const context = {
    filePreview: preview("A"), editedContent: "A draft", currentDir: "root",
    previewRequestRef: { current: 0 }, editRevisionRef: { current: 0 },
    savePromiseRef: { current: null }, closePromiseRef: { current: null },
    editedContentRef: { current: "A draft" }, editorOpenRef: { current: true },
    discardResolverRef: { current: null },
    isDirtyRef: { current: false }, filePreviewRef: { current: preview("A") },
    gitContextRef: { current: { cwd: "root" } },
    readTextPreviewViaProtocol(path) { const pending = deferred(); reads.push({ path, ...pending }); return pending.promise; },
    saveFileEditorSnapshot(path, baseContent, content) {
      const pending = deferred();
      writes.push({ path, baseContent, content, ...pending });
      return pending.promise.then(result => result ?? "saved");
    },
    invoke() { throw Error("unexpected fallback"); }, MAX_TEXT_PREVIEW_BYTES: 262144,
    isPreviewFallbackError: () => false, console: { warn() {} },
    showToast: message => events.push(["toast", message]), onRefreshGit: () => events.push(["git"]),
    refreshDirectory: () => events.push(["directory"]),
  };
  for (const name of ["FilePreview", "EditedContent", "IsDirty", "SavingFile", "DiscardConfirmation"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { context[key] = value; events.push([key, value]); };
  }
  const run = node => {
    assert.ok(node, "production callback must exist");
    return vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  };
  context.saveEditedFile = run(callbacks.saveEditedFile);
  context.closeFilePreview = run(callbacks.closeFilePreview);
  assert.match(close.getText(ast), /closeFilePreview/);
  return {
    context, reads, writes, events, open: run(callbacks.openFilePreview),
    save: context.saveEditedFile, edit: run(change), close: context.closeFilePreview,
    discardCleanup: run(discardEffect)(),
    decide(discard) {
      const resolve = context.discardResolverRef.current;
      context.discardResolverRef.current = null;
      context.setDiscardConfirmation(false);
      resolve?.(discard);
    },
  };
}
{
  const view = mount(), a = view.open("A"), b = view.open("B");
  view.reads[1].resolve(preview("B")); await b;
  view.reads[0].resolve(preview("A")); await a;
  assert.equal(view.context.filePreview.path, "B", "FE01: late A cannot overwrite B");
  const old = view.open("old"), latest = view.open("latest");
  view.reads[3].resolve(preview("latest")); await latest;
  view.reads[2].reject(Error("old read failed")); await old;
  assert.equal(view.context.filePreview.path, "latest");
  assert.equal(view.events.some(event => event[0] === "toast"), false, "FE01: stale failure cannot show a current error");
}
{
  const view = mount(), refresh = view.open("A", { silent: true });
  view.edit({ target: { value: "new unsaved draft" } });
  view.reads[0].resolve(preview("A")); await refresh;
  assert.equal(view.context.editedContent, "new unsaved draft", "FE02: refresh cannot replace edits made during read");
  assert.equal(view.context.isDirty, true);
  await view.open("B");
  assert.equal(view.reads.length, 1, "FE06: dirty switching cannot start a destructive read");
}
{
  const view = mount(), save = view.save();
  assert.equal(view.save(), save, "FC03: concurrent callers share the same pending result");
  assert.equal(view.writes.length, 1, "FE04: synchronous single-flight write guard");
  view.edit({ target: { value: "edited while saving" } });
  view.writes[0].resolve(); await save;
  assert.equal(view.context.editedContent, "edited while saving");
  assert.equal(view.context.isDirty, true, "FE03: saved snapshot cannot clear subsequent changes");
  assert.equal(view.context.filePreview.content, "A draft", "FE03: saved base reflects the actual written snapshot");
  const retry = view.save();
  view.writes[1].reject(Error("protocol failed"));
  await retry;
  assert.equal(view.context.isDirty, true);
  assert.equal(view.context.savePromiseRef.current, null, "FE04: failure releases retry guard");
}
{
  const view = mount(), read = view.open("B");
  view.close();
  view.reads[0].resolve(preview("B")); await read;
  assert.equal(view.context.filePreview, null, "FE05: closed preview cannot be resurrected by a late read");
  const saving = mount(), pending = saving.save();
  saving.close();
  saving.writes[0].resolve(); await pending;
  assert.equal(saving.context.filePreview, null, "FE05: late save cannot restore a closed preview");
}
console.log("PASS FE01–FE06 actual editor callbacks: read identity, draft preservation, save snapshots, single-flight failure/retry and closed preview isolation");
{
  const view = mount();
  view.edit({ target: { value: "first draft" } });
  const closing = view.close();
  assert.equal(view.close(), closing, "FC03: duplicate close shares one operation");
  assert.equal(view.save(), view.context.savePromiseRef.current, "FC03: shortcut shares close's save");
  assert.equal(view.writes.length, 1);
  view.edit({ target: { value: "typed while closing" } });
  view.writes[0].resolve(); await settle();
  assert.equal(view.context.filePreview.path, "A", "FC02: a newer draft prevents close");
  assert.equal(view.writes.length, 2);
  assert.equal(view.writes[1].baseContent, "first draft");
  assert.equal(view.writes[1].content, "typed while closing");
  view.writes[1].resolve(); await closing;
  assert.equal(view.context.filePreview, null, "FC01/02: close only after saving the latest draft");
  assert.equal(view.context.editedContent, "");
  assert.equal(view.context.discardConfirmation, false, "successful close has no discard prompt");
}
{
  const view = mount();
  view.edit({ target: { value: "keep me" } });
  const closing = view.close();
  view.writes[0].reject(Error("save failed")); await settle();
  assert.equal(view.context.discardConfirmation, true, "FC04: prompt appears only after failed save");
  assert.equal(view.close(), closing);
  view.decide(false); await closing;
  assert.equal(view.context.editedContent, "keep me");
  assert.equal(view.context.isDirty, true);
  assert.equal(view.context.filePreview.path, "A");
  const retry = view.close();
  view.writes[1].resolve("conflict"); await settle();
  assert.equal(view.context.discardConfirmation, true, "conflict cannot be treated as saved");
  view.decide(true); await retry;
  assert.equal(view.context.filePreview, null, "FC05: explicit discard closes the original preview");
  assert.equal(view.writes.length, 2, "discard does not trigger another write");
}
for (const phase of ["saving", "confirming"]) {
  const view = mount();
  view.edit({ target: { value: "old draft" } });
  const closing = view.close();
  if (phase === "confirming") { view.writes[0].reject(Error("failed")); await settle(); }
  view.context.filePreviewRef.current = preview("B");
  view.context.filePreview = preview("B");
  view.context.previewRequestRef.current++;
  if (phase === "saving") view.writes[0].resolve();
  else view.decide(true);
  await closing;
  assert.equal(view.context.filePreview.path, "B", `FC06: stale ${phase} cannot close another file`);
}
{
  const view = mount();
  view.edit({ target: { value: "old workspace" } });
  const closing = view.close();
  view.writes[0].reject(Error("failed")); await settle();
  view.context.editorOpenRef.current = false;
  view.discardCleanup();
  await closing;
  assert.equal(view.context.filePreview.path, "A", "FC06: actual cleanup cancels confirmation without dropping draft");
  assert.equal(view.context.discardResolverRef.current, null);
  assert.equal(view.context.closePromiseRef.current, null);
}
{
  const view = mount();
  view.edit({ target: { value: "pending across hide and reopen" } });
  const closing = view.close();
  view.context.editorOpenRef.current = false;
  view.discardCleanup();
  view.context.editorOpenRef.current = true;
  view.writes[0].resolve();
  await closing;
  assert.equal(view.context.filePreview.path, "A", "FC06: reopening cannot revive a close intention invalidated while saving");
  assert.equal(view.context.isDirty, true, "late save confirmation cannot clear a newer editor lifetime");
}
const dialog = fs.readFileSync("src/components/FileDiscardDialog.tsx", "utf8");
for (const label of ["放弃文件更改？", "您对此文件所做的未保存的更改将丢失", "继续查看", "放弃更改"]) assert.ok(dialog.includes(label));
assert.equal((dialog.match(/<button\b/g) ?? []).length, 2, "official contract has only two action buttons");
assert.doesNotMatch(dialog, /CloseIcon/);
console.log("PASS FC01–FC06 production close/save callbacks: save-until-clean, shared promises, failed-save confirmation, continue/discard and invalidation; dialog/native/pixels not runtime verified");
