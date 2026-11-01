import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mount } from "./verify-sidebar-projects.mjs";

const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const event = extra => ({
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.stopped = true; }, nativeEvent: {}, ...extra,
});
const sidebar = mount({ onRenameThread: (...args) => sidebar.calls.push(["rename", ...args]) });
const row = () => all(sidebar.render()).find(n => n.props["data-thread-id"] === "a1");
const title = () => all(row()).find(n => n.props.className === "sidebar-thread-title");
const rename = () => all(sidebar.render()).find(n => n.type === "RenameThreadDialog");
row().props.onContextMenu(event({ clientX: 100, clientY: 100 }));
const renameItem = all(sidebar.render()).find(n => n.props.role === "menuitem" && text(n).includes("重命名"));
renameItem.props.onClick(event());
assert.ok(rename(), "sidebar rename must open a modal component instead of an inline blur-saving input");
assert.equal(rename().props.initialValue, "Alpha thread");
assert.deepEqual(sidebar.calls, [], "opening rename must not navigate or write");
rename().props.onSave("  保留空格  ");
assert.deepEqual(sidebar.calls, [["rename", "a1", "  保留空格  "]]);
sidebar.calls.length = 0;
rename().props.onClose();
sidebar.render();
assert.equal(rename(), undefined);
title().props.onDoubleClick(event());
assert.equal(rename(), undefined, "inactive title must not open rename");
sidebar.props.activeRoute = "thread"; sidebar.props.activeThreadId = "a1";
title().props.onDoubleClick(event());
assert.ok(rename(), "active title must use the same dialog");
rename().props.onClose(); sidebar.render();
sidebar.props.threads[0] = { id: "a1", cwd: "D:/parity/alpha", preview: "not a title" };
title().props.onDoubleClick(event());
assert.equal(rename().props.initialValue, "", "preview must not be saved as a generated title");
sidebar.unmount();

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
function mountDialog(initialValue) {
  let cursor = 0, focused, opened = false;
  const hooks = [], effects = [], calls = [];
  const previous = { isConnected: true, focus() { focused = previous; } };
  const input = { focus() { focused = input; }, select() { calls.push(["select"]); } };
  const dialog = {
    showModal() { opened = true; }, close() { opened = false; },
    getBoundingClientRect: () => ({ left: 200, right: 600, top: 100, bottom: 320 }),
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef: value => { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState: value => { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], value => { hooks[i] = value; }]; },
    useEffect: callback => { const i = cursor++; if (!hooks[i]) { hooks[i] = true; effects.push(callback); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync("src/components/RenameThreadDialog.tsx", "utf8")), {
    exports: module.exports, require: name => name === "react" ? react : {},
    document: { activeElement: previous },
  });
  const props = { initialValue, onClose: () => calls.push(["close"]), onSave: value => calls.push(["save", value]) };
  const render = () => {
    cursor = 0;
    const tree = module.exports.RenameThreadDialog(props);
    for (const node of all(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? dialog : input;
    return tree;
  };
  render();
  const cleanups = effects.map(effect => effect());
  return { props, calls, render, dialog, input, previous, get focused() { return focused; }, get opened() { return opened; },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
for (const value of ["  新名称  ", "", "Alpha thread"]) {
  const view = mountDialog("Alpha thread");
  assert.equal(view.opened, true);
  assert.equal(view.focused, view.input);
  assert.deepEqual(view.calls, [["select"]]);
  let nodes = all(view.render()), input = nodes.find(n => n.type === "input");
  assert.equal(input.props.value, "Alpha thread");
  assert.equal(input.props["aria-label"], "聊天标题");
  assert.equal(input.props.onBlur, undefined, "blur must never submit");
  input.props.onChange({ target: { value } });
  nodes = all(view.render());
  const form = nodes.find(n => n.type === "form"), root = nodes.find(n => n.type === "dialog");
  const ime = event({ key: "Enter", nativeEvent: { isComposing: true } });
  root.props.onKeyDown(ime);
  assert.equal(ime.defaultPrevented, true, "IME confirmation must not trigger native form submit");
  assert.equal(ime.stopped, true);
  const legacyIme = event({ key: "Enter", keyCode: 229 });
  root.props.onKeyDown(legacyIme);
  assert.equal(legacyIme.defaultPrevented, true);
  form.props.onSubmit(event());
  form.props.onSubmit(event());
  assert.deepEqual(view.calls.slice(1), [["close"], ["save", value]], "close before saving; duplicate submit writes once; retain exact input");
  view.unmount();
  assert.equal(view.opened, false);
  assert.equal(view.focused, view.previous);
}
for (const kind of ["cancel", "close", "escape", "backdrop"]) {
  const view = mountDialog("Original"), nodes = all(view.render()), root = nodes.find(n => n.type === "dialog");
  if (kind === "cancel") nodes.find(n => n.type === "button" && text(n) === "取消").props.onClick();
  if (kind === "close") nodes.find(n => n.props["aria-label"] === "关闭对话框").props.onClick();
  if (kind === "escape") root.props.onCancel(event());
  if (kind === "backdrop") {
    root.props.onMouseDown(event({ target: view.dialog, currentTarget: view.dialog, clientX: 250, clientY: 150 }));
    assert.equal(view.calls.length, 1, "clicking the dialog surface must not cancel");
    root.props.onMouseDown(event({ target: view.dialog, currentTarget: view.dialog, clientX: 10, clientY: 10 }));
  }
  assert.deepEqual(view.calls.slice(1), [["close"]]);
  assert.ok(!view.calls.some(call => call[0] === "save"));
  view.unmount();
}

// Execute the real App callback with a controlled RPC boundary. No optimistic
// label may survive a rejected request; other threads must be left untouched.
const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleRenameThread") handler = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler);
for (const succeeds of [true, false]) {
  let resolve, reject, threads = [{ id: "a", name: "Old" }, { id: "b", name: "Other" }];
  const calls = [], pending = new Promise((res, rej) => { resolve = res; reject = rej; });
  const rename = vm.runInNewContext(compile(`(${handler.getText(ast)})`), {
    setThreads: update => { threads = update(threads); },
    callAppServer: (...args) => { calls.push(args); return pending; },
    showAppToast: (...args) => calls.push(["toast", ...args]),
  });
  const result = rename("a", "  New  ");
  assert.equal(threads[0].name, "Old", "unacknowledged rename must not display success");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["thread/name/set", { threadId: "a", name: "  New  " }]);
  if (succeeds) resolve({}); else reject(new Error("refused"));
  await result;
  assert.equal(threads[0].name, succeeds ? "  New  " : "Old");
  assert.equal(threads[1].name, "Other");
  assert.equal(calls.some(call => call[0] === "toast" && call[1] === "无法保存更改。请重试" && call[2] === "error"), !succeeds);
}
console.log("PASS Sidebar rename entry, actual dialog cancellation/raw values/IME/submit guard/focus, and App RPC success/failure (L2; native dialog defaults and real service readback require separate evidence)");
