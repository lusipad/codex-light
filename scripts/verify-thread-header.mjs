import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React };
let header, rename;
function visit(node) {
  if (ts.isConditionalExpression(node) && node.condition.getText(ast).includes('activeRoute === "thread"') &&
      node.whenTrue.getText(ast).includes('className="thread-header-rename-input"')) header = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleRenameThread") rename = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(header && rename, "Production header and rename callback must be exercised");
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const evaluate = (node, context) => vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: options }).outputText, context);
let editing = false, draft = "", calls = [];
const context = {
  React: { createElement }, activeRoute: "thread", activeThreadId: "thread-a",
  activeThreadObj: { name: "原始标题" }, turns: [], threadStatusChip: { label: "" },
  gitStatus: null, useWorktree: false, showGitMenu: false, BranchIcon() {},
  setEditingThreadTitle: value => { editing = value; }, setThreadTitleInput: value => { draft = value; },
  handleRenameThread: (...args) => calls.push(args),
};
function render() {
  context.editingThreadTitle = editing;
  context.threadTitleInput = draft;
  return evaluate(header, context);
}
function input() { return nodes(render()).find(node => node.type === "input"); }
function open() {
  nodes(render()).find(node => node.type === "button").props.onClick();
  assert.equal(editing, true);
  assert.equal(draft, "原始标题");
}
function target(value) {
  const element = { value, dataset: {}, select() { this.selected = true; } };
  const onBlur = input().props.onBlur;
  element.blur = () => onBlur({ currentTarget: element });
  return element;
}
function key(element, key, extra = {}) {
  let prevented = false;
  input().props.onKeyDown({
    key, nativeEvent: { isComposing: false }, currentTarget: element,
    preventDefault() { prevented = true; }, stopPropagation() {}, ...extra,
  });
  return prevented;
}
assert.ok(nodes(render()).some(node => node.type === "button"), "TH07: an existing empty thread retains title identity");
open();
const entered = target("  新标题  ");
input().props.onFocus({ currentTarget: entered });
assert.equal(entered.selected, true, "TH01: editor focus selects all text");
assert.equal(input().props["aria-label"], "聊天标题");
assert.equal(key(entered, "Enter"), true);
assert.equal(calls.length, 1, "TH02: Enter invokes the blur commit exactly once");
assert.equal(calls[0].join("|"), "thread-a|新标题");
assert.equal(editing, false);
calls = [];
open();
const escaped = target("取消更改");
assert.equal(key(escaped, "Escape"), true);
escaped.blur();
assert.equal(calls.length, 0, "TH03: delayed blur after Escape cannot save");
assert.equal(editing, false);
for (const value of ["", "   ", "原始标题", " 原始标题 "]) {
  open();
  target(value).blur();
  assert.equal(editing, false);
}
assert.equal(calls.length, 0, "TH04: blank and unchanged names never write");
open();
const composing = target("输入中");
key(composing, "Enter", { nativeEvent: { isComposing: true } });
key(composing, "Escape", { keyCode: 229 });
assert.equal(editing, true);
assert.equal(composing.dataset.cancelRename, undefined);
assert.equal(calls.length, 0, "TH06: IME candidate confirmation cannot submit/cancel");
composing.blur();
assert.equal(calls.length, 1, "TH05: an outside blur saves once");
context.activeRoute = "home";
context.activeThreadId = null;
assert.ok(!render(), "TH07: home has no thread identity");
context.activeRoute = "thread";
context.activeThreadId = "thread-a";
for (const branch of [undefined, ""]) {
  context.gitStatus = { branch };
  assert.ok(!nodes(render()).some(node => node.props.className === "project-branch-pill clickable"), "TH08: unknown branch has no invented fallback");
}
context.gitStatus = { branch: "feature/实际分支" };
assert.ok(nodes(render()).some(node => node.type === "span" && node.children.includes("feature/实际分支")));

let threads = [{ id: "thread-a", name: "before" }], request, toast;
const protocolContext = {
  callAppServer: async (...args) => { request = args; },
  setThreads: update => { threads = update(threads); },
  showAppToast: (...args) => { toast = args; },
};
await evaluate(rename, protocolContext)("thread-a", "after");
assert.equal(request[0], "thread/name/set");
assert.equal(request[1].threadId, "thread-a");
assert.equal(request[1].name, "after");
assert.equal(threads[0].name, "after", "TH05: acknowledged protocol updates the real title");
protocolContext.callAppServer = async () => { throw Error("offline"); };
await evaluate(rename, protocolContext)("thread-a", "not-saved");
assert.equal(threads[0].name, "after");
assert.equal(toast[1], "error", "TH05: failed save leaves the original acknowledged title and reports error");
console.log("PASS TH01–TH08 production JSX and rename callback: single blur commit, cancel, no-op, IME, empty thread, real branch, protocol success/failure");
