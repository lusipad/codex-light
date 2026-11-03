import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let overlay, focusEffect, appCommand, shortcutMap, menuHandlers, trayHandlers;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleAppCommand") {
    appCommand = node.initializer.arguments[0];
  }
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "shortcutHandlersRef.current") {
    shortcutMap = node.right;
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "installNativeMenuHandler") {
    menuHandlers = node.arguments[0];
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "installTrayHandler") {
    trayHandlers = node.arguments[0];
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "div" &&
      node.openingElement.attributes.properties.some(p => p.name?.getText(ast) === "className" &&
        p.initializer?.text === "codex-modal-overlay") &&
      node.getText(ast).includes("project-move-title")) overlay = node;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("projectMoveCancelRef.current")) focusEffect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(overlay);
assert.ok(focusEffect);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
function mount(busy = false) {
  const doc = { activeElement: null };
  const element = () => ({ isConnected: true, focus() { doc.activeElement = this; } });
  const previous = element(), cancel = element(), proceed = element();
  doc.activeElement = previous;
  const closed = [];
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
    projectMoveConfirmation: { projectName: "Target", plan: { missingSources: ["D:/source"] } },
    projectMoveBusy: busy, projectMoveCancelRef: { current: cancel },
    setProjectMoveConfirmation: value => closed.push(value),
    confirmProjectMove() { throw Error("keyboard/cancel must not commit"); },
    document: doc,
  };
  const tree = vm.runInNewContext(compile(overlay), context);
  const cleanup = vm.runInNewContext(compile(focusEffect), context)();
  tree.querySelectorAll = selector => {
    assert.ok(selector.includes("button"));
    return busy ? [] : [cancel, proceed];
  };
  return { tree, cleanup, closed, doc, previous, cancel, proceed };
}
const event = (view, options = {}) => ({
  key: "", nativeEvent: {}, shiftKey: false, target: view.tree, currentTarget: view.tree,
  preventDefault() { this.prevented = true; },
  stopPropagation() { this.stopped = true; }, ...options,
});
{
  const view = mount();
  assert.equal(view.doc.activeElement, view.cancel);
  view.cleanup?.();
  assert.equal(view.doc.activeElement, view.previous, "closing must restore the connected launcher");
}
{
  const view = mount();
  view.previous.isConnected = false;
  view.cleanup?.();
  assert.equal(view.doc.activeElement, view.cancel, "never focus a detached launcher");
}
for (const shift of [false, true]) {
  const view = mount();
  view.doc.activeElement = shift ? view.cancel : view.proceed;
  const key = event(view, { key: "Tab", shiftKey: shift });
  view.tree.props.onKeyDown(key);
  assert.equal(key.prevented, true, "boundary Tab must not escape");
  assert.equal(view.doc.activeElement, shift ? view.proceed : view.cancel);
  assert.equal(key.stopped, true);
}
for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
  const view = mount(), key = event(view, { key: "Escape", nativeEvent });
  view.tree.props.onKeyDown(key);
  assert.deepEqual(view.closed, []);
  assert.equal(key.prevented, true);
  assert.equal(key.stopped, true);
}
for (const busy of [false, true]) {
  const view = mount(busy), escape = event(view, { key: "Escape" });
  view.tree.props.onKeyDown(escape);
  assert.deepEqual(view.closed, busy ? [] : [null]);
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  const shortcut = event(view, { key: "n", ctrlKey: true });
  view.tree.props.onKeyDown(shortcut);
  assert.equal(shortcut.stopped, true, "modal keys must not reach App shortcuts");
  if (busy) {
    const tab = event(view, { key: "Tab" });
    view.tree.props.onKeyDown(tab);
    assert.equal(tab.prevented, true);
  }
  view.closed.length = 0;
  view.tree.props.onMouseDown(event(view, { target: {} }));
  assert.deepEqual(view.closed, []);
  view.tree.props.onMouseDown(event(view));
  assert.deepEqual(view.closed, busy ? [] : [null]);
  view.closed.length = 0;
  const cancel = all(view.tree).find(node => node.type === "button" && node.props.ref);
  assert.equal(cancel.props.disabled, busy);
  if (!busy) {
    cancel.props.onClick();
    assert.deepEqual(view.closed, [null]);
  }
}
console.log("PASS production project move modal: focus cleanup, Tab boundaries, shortcut isolation, IME Escape, busy and cancel (PMK01-PMK06, L2)");

assert.ok(appCommand && shortcutMap && menuHandlers && trayHandlers);
const shortcutNames = [
  ...shortcutMap.properties.filter(ts.isPropertyAssignment).map(p => p.name.text),
  ...Array.from({ length: 6 }, (_, index) => `recent-thread-${index + 1}`),
];
const zoomCommands = ["zoom-in", "zoom-out", "zoom-reset"];
for (const confirmation of [null, { threadId: "source" }]) {
  for (const busy of [false, true]) {
    const calls = [];
    const context = {
      keyboardState: { capturing: { current: false } },
      projectMoveConfirmation: confirmation, projectMoveBusy: busy,
      shortcutHandlersRef: { current: Object.fromEntries(shortcutNames.map(name =>
        [name, payload => calls.push([name, payload])])) },
      keyboardShortcutsOpenRef: { current: false },
      handlePickNewFolder: async () => calls.push(["open-workspace"]),
      setActiveRoute: route => calls.push([route]),
      window: { location: { reload: () => calls.push(["reload"]) } },
      cycleTheme: async () => calls.push(["toggle-theme"]),
      showAppToast: message => calls.push(["toast", message]),
    };
    const dispatch = vm.runInNewContext(compile(appCommand), context);
    const menu = vm.runInNewContext(compile(menuHandlers), { appCommandRef: { current: dispatch } });
    const tray = vm.runInNewContext(compile(trayHandlers), { appCommandRef: { current: dispatch } });
    for (const command of [...shortcutNames, "open-workspace", "settings", "reload"]) {
      calls.length = 0;
      await dispatch(command);
      assert.equal(calls.length, confirmation && !zoomCommands.includes(command) ? 0 : 1,
        `${command}: confirmation=${!!confirmation}, busy=${busy}`);
    }
    for (const [command, callback] of [
      ["new-chat", menu["new-chat"]], ["settings", menu.settings],
      ["toggle-sidebar", menu["toggle-sidebar"]], ["new-chat", tray["new-chat"]],
      ["zoom-in", menu["zoom-in"]], ["toggle-theme", menu["toggle-theme"]],
    ]) {
      calls.length = 0;
      await callback();
      const blocked = confirmation && ![...zoomCommands, "toggle-theme"].includes(command);
      assert.equal(calls.length, blocked ? 0 : 1, `native callback ${command}, modal=${!!confirmation}`);
    }
  }
}
console.log("PASS production command dispatcher and menu/tray callbacks: modal blocks background actions, preserves zoom/theme, resumes after close (PMK07, L2)");
