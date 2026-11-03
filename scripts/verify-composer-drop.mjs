import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("ComposerBox.tsx", fs.readFileSync("src/components/ComposerBox.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let drop, nativeEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleDrop") drop = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("onDragDropEvent")) nativeEffect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(drop);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const attachmentModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/threadAttachments.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: attachmentModule.exports, require: () => ({}) });
const plain = value => JSON.parse(JSON.stringify(value));
function mount(native = false, delayedRegistration = false) {
  const added = [], state = { dragging: false, error: null };
  let listener, offCount = 0, resolveRegistration;
  const registration = new Promise(resolve => { resolveRegistration = resolve; });
  const context = {
    window: { devicePixelRatio: 2 }, isTauriRuntime: () => native,
    boxRef: { current: { getBoundingClientRect: () => ({ left: 100, right: 500, top: 200, bottom: 400 }) } },
    onAddAttachedFiles: files => added.push(plain(files)),
    onAddAttachedFilesRef: { current: files => added.push(plain(files)) },
    setIsDragging: value => { state.dragging = value; },
    setDropError: value => { state.error = value; },
    createAttachedFileItem: attachmentModule.exports.createAttachedFileItem,
    console,
    require: () => ({ getCurrentWebview: () => ({
      onDragDropEvent: callback => {
        listener = callback;
        return delayedRegistration ? registration : Promise.resolve(() => { offCount++; });
      },
    }) }),
  };
  return {
    context, added, state,
    drop: vm.runInNewContext(compile(drop), context),
    effect: () => vm.runInNewContext(compile(nativeEffect), context)(),
    event: payload => listener({ payload }),
    resolve: () => resolveRegistration(() => { offCount++; }),
    offCount: () => offCount,
  };
}
const domDrop = files => ({
  dataTransfer: { files }, preventDefault() {}, stopPropagation() {},
});
{
  const view = mount();
  view.drop(domDrop([{ name: "file.txt" }]));
  assert.deepEqual(view.added, [], "filename alone must never become a local disk attachment");
  assert.ok(view.state.error, "unsupported drop must explain how to add the file");
}
assert.ok(nativeEffect, "Composer must subscribe to real native file paths");
for (const delayed of [false, true]) {
  const view = mount(true, delayed);
  const cleanup = view.effect();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  view.event({ type: "enter", paths: ["D:/file.txt"], position: { x: 300, y: 500 } });
  assert.equal(view.state.dragging, true);
  view.event({ type: "over", position: { x: 10, y: 10 } });
  assert.equal(view.state.dragging, false);
  view.event({ type: "drop", paths: ["D:/outside.txt"], position: { x: 10, y: 10 } });
  assert.equal(view.added.length, 0);
  view.event({ type: "drop", paths: ["D:/file.txt", "D:/image.png"], position: { x: 300, y: 500 } });
  assert.deepEqual(view.added[0].map(file => [file.path, file.kind]),
    [["D:/file.txt", "file"], ["D:/image.png", "image"]]);
  assert.equal(view.state.dragging, false);
  view.context.onAddAttachedFilesRef.current = files => view.added.push(["latest", ...plain(files)]);
  view.event({ type: "drop", paths: ["D:/new.txt"], position: { x: 300, y: 500 } });
  assert.equal(view.added[1][0], "latest");
  view.drop(domDrop([{ name: "duplicate.txt", path: "D:/duplicate.txt" }]));
  assert.equal(view.added.length, 2, "native drag owns file attachment in Tauri");
  view.event({ type: "enter", paths: [], position: { x: 300, y: 500 } });
  view.event({ type: "leave" });
  assert.equal(view.state.dragging, false);
  cleanup();
  if (delayed) {
    assert.equal(view.offCount(), 0);
    view.resolve();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  assert.equal(view.offCount(), 1);
  view.event({ type: "drop", paths: ["D:/stale.txt"], position: { x: 300, y: 500 } });
  assert.equal(view.added.length, 2, "unmounted listener must not modify another draft");
}
{
  const view = mount();
  assert.equal(view.effect(), undefined, "browser preview does not install a native subscription");
  view.drop(domDrop([{ name: "actual.txt", path: "D:/actual.txt" }]));
  assert.equal(view.added[0][0].path, "D:/actual.txt");
}
console.log("PASS production Composer drop: native paths, bounds/DPI, latest callback, no fake filename or duplicate, async listener cleanup (CD01-CD07, L2)");
