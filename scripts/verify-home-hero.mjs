import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let greeting, projectName;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "projectName" &&
      node.initializer?.getText(ast).includes("activeWorkspace")) projectName = node.initializer;
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p =>
    p.name?.getText(ast) === "className" && p.initializer?.text === "home-greeting-wrap")) greeting = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(greeting && projectName);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") :
  typeof node === "string" ? node : "";
const fsModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/fsClient.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: fsModule.exports, require: () => ({}) });
function mount(activeWorkspace, isGitRepo = false, opened = false) {
  const state = { opened, focused: false }, selected = [];
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
    activeWorkspace, gitStatus: { isGitRepo }, showHomeProjectPopover: opened,
    baseNameFsPath: fsModule.exports.baseNameFsPath,
    workspaces: activeWorkspace ? [activeWorkspace] : [],
    agentsMdInfo: { found: false }, WorkspacePopover: "WorkspacePopover",
    setShowHomeProjectPopover: value => { state.opened = typeof value === "function" ? value(state.opened) : value; },
    handleSelectWorkspace: path => selected.push(path),
    handleRemoveWorkspace() {}, handlePickNewFolder() {}, setShowAgentsMdModal() {},
  };
  context.projectName = vm.runInNewContext(compile(projectName), context);
  const tree = vm.runInNewContext(compile(greeting), context);
  return { tree, state, selected, find: predicate => all(tree).find(predicate) };
}
{
  const view = mount(null);
  assert.equal(text(view.find(n => n.type === "h1")), "我们要构建什么？", "no workspace must not invent a project");
  assert.equal(view.find(n => n.type === "button"), undefined);
}
for (const git of [false, true]) {
  const view = mount({ label: "测试仓库", path: "D:/repo" }, git);
  assert.equal(text(view.find(n => n.type === "h1")),
    git ? "你想让我们在 测试仓库 中构建什么？" : "我们应该在测试仓库中做些什么？");
  const button = view.find(n => n.type === "button");
  assert.equal(button.props["aria-haspopup"], "dialog");
  assert.equal(button.props["aria-expanded"], false);
  button.props.onClick();
  assert.equal(view.state.opened, true);
}
for (const [path, expected] of [["D:\\Projects\\alpha\\", "alpha"], ["/tmp/beta/", "beta"], ["D:\\", "D:"], ["/", "/"]]) {
  const view = mount({ label: "", path });
  assert.equal(text(view.find(n => n.type === "button")), expected);
}
{
  const name = "长项目名".repeat(80);
  const view = mount({ label: name, path: "D:/long" }, true, true);
  assert.equal(text(view.find(n => n.type === "button")), name, "never truncate source text");
  const dialog = view.find(n => n.props.role === "dialog");
  assert.equal(dialog.props.id, view.find(n => n.type === "button").props["aria-controls"]);
  const picker = view.find(n => n.type === "WorkspacePopover");
  picker.props.onSelectWorkspace("D:/other");
  assert.deepEqual(view.selected, ["D:/other"], "Hero must reuse the shared workspace callback");
  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }, {}]) {
    view.state.opened = true;
    const event = {
      key: "Escape", nativeEvent,
      currentTarget: { querySelector: () => ({ focus() { view.state.focused = true; } }) },
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    };
    view.tree.props.onKeyDown(event);
    const composing = nativeEvent.isComposing || nativeEvent.keyCode === 229;
    assert.equal(view.state.opened, !!composing);
    if (!composing) {
      assert.equal(event.prevented, true);
      assert.equal(event.stopped, true);
      assert.equal(view.state.focused, true);
    }
  }
}
console.log("PASS production Home Hero: no project, Git/plain directory, path fallback, full long names, shared picker and IME-safe Escape (HC01-HC07, L2; geometry not tested)");

const composerAst = ts.createSourceFile("ComposerBox.tsx", fs.readFileSync("src/components/ComposerBox.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let composerProjectName;
function findComposerName(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(composerAst) === "projectName") composerProjectName = node.initializer;
  ts.forEachChild(node, findComposerName);
}
findComposerName(composerAst);
assert.ok(composerProjectName);
const nameCode = ts.transpileModule(`(${composerProjectName.getText(composerAst)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
for (const [activeWorkspace, expected] of [
  [null, "选择项目"],
  [{ label: " ", path: "D:\\Projects\\alpha\\" }, "alpha"],
  [{ label: "自定义项目", path: "D:/alpha" }, "自定义项目"],
]) {
  assert.equal(vm.runInNewContext(nameCode, { activeWorkspace, baseNameFsPath: fsModule.exports.baseNameFsPath }), expected);
}
console.log("PASS production Composer project label: no fake project, shared path fallback and explicit label");
