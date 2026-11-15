import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let greeting, projectName, homeWorkspace;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "projectName" &&
      /homeWorkspace|activeWorkspace/.test(node.initializer?.getText(ast) ?? "")) projectName = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "homeWorkspace") homeWorkspace = node.initializer;
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
function mount(activeWorkspace, isGitRepo = false, opened = false, projectless = false) {
  const state = { opened, focused: false }, selected = [];
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
    activeWorkspace, pendingProjectlessRef: { current: projectless }, gitStatus: { isGitRepo }, showHomeProjectPopover: opened,
    baseNameFsPath: fsModule.exports.baseNameFsPath,
    workspaces: activeWorkspace ? [activeWorkspace] : [],
    agentsMdInfo: { found: false }, WorkspacePopover: "WorkspacePopover",
    setShowHomeProjectPopover: value => { state.opened = typeof value === "function" ? value(state.opened) : value; },
    handleSelectWorkspace: path => selected.push(path),
    handleRemoveWorkspace() {}, handlePickNewFolder() {}, setShowAgentsMdModal() {},
  };
  context.homeWorkspace = homeWorkspace ? vm.runInNewContext(compile(homeWorkspace), context) : activeWorkspace;
  context.projectName = vm.runInNewContext(compile(projectName), context);
  const tree = vm.runInNewContext(compile(greeting), context);
  return { tree, state, selected, find: predicate => all(tree).find(predicate) };
}
{
  const view = mount({ label: "Previous project", path: "D:/previous" }, true, false, true);
  assert.equal(text(view.find(n => n.type === "h1")), "我们要构建什么？");
  assert.equal(view.find(n => n.type === "button"), undefined);
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

// Failed first creation renders the thread surface before any server thread exists.
let threadComposer;
function findThreadComposer(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ComposerBox" &&
      node.attributes.properties.some(p => p.name?.getText(ast) === "variant" && p.initializer?.text === "thread")) threadComposer = node;
  ts.forEachChild(node, findThreadComposer);
}
findThreadComposer(ast);
assert.ok(threadComposer);
const threadProperty = name => threadComposer.attributes.properties.find(p => p.name?.getText(ast) === name).initializer.expression;
const threadContext = { activeWorkspace: { path: "D:/old" }, homeWorkspace: null, activeThreadId: null,
  gitStatus: { branch: "old" }, gitBranches: ["old"], useWorktree: true, workspaceFiles: ["old.txt"], workspaceFileHits: ["old.txt"] };
let threadWorkspace;
function findThreadWorkspace(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "threadComposerWorkspace") threadWorkspace = node.initializer;
  ts.forEachChild(node, findThreadWorkspace);
}
findThreadWorkspace(ast);
if (threadWorkspace) threadContext.threadComposerWorkspace = vm.runInNewContext(compile(threadWorkspace), threadContext);
assert.equal(vm.runInNewContext(compile(threadProperty("activeWorkspace")), threadContext), null,
  "failed projectless first-send surface must not display the previous workspace");
for (const name of ["gitBranches", "workspaceFiles", "workspaceFileHits"]) {
  assert.equal(vm.runInNewContext(compile(threadProperty(name)), threadContext).length, 0, `${name}: failed projectless draft must not expose old context`);
}
assert.equal(vm.runInNewContext(compile(threadProperty("gitStatus")), threadContext), null);
assert.equal(vm.runInNewContext(compile(threadProperty("useWorktree")), threadContext), false);
for (const activeThreadId of [null, "existing-thread"]) {
  const context = { ...threadContext, activeThreadId, homeWorkspace: activeThreadId ? null : threadContext.activeWorkspace };
  context.threadComposerWorkspace = vm.runInNewContext(compile(threadWorkspace), context);
  assert.equal(vm.runInNewContext(compile(threadProperty("activeWorkspace")), context), context.activeWorkspace,
    "project-bound draft and existing server thread retain their workspace");
  assert.equal(vm.runInNewContext(compile(threadProperty("gitStatus")), context), context.gitStatus);
}

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

let homeComposer;
function findHomeComposer(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ComposerBox" &&
      node.attributes.properties.some(p => p.name?.getText(ast) === "variant" && p.initializer?.text === "home")) homeComposer = node;
  ts.forEachChild(node, findHomeComposer);
}
findHomeComposer(ast);
assert.ok(homeComposer);
const contextProps = ["activeWorkspace", "gitStatus", "gitBranches", "useWorktree", "workspaceFiles", "workspaceFileHits"];
for (const projectless of [false, true]) {
  const context = { activeWorkspace: { path: "D:/previous", label: "Previous" }, pendingProjectlessRef: { current: projectless },
    gitStatus: { isGitRepo: true }, gitBranches: ["previous-branch"], useWorktree: true,
    workspaceFiles: ["private-project.txt"], workspaceFileHits: [{ path: "private-project.txt" }] };
  context.homeWorkspace = vm.runInNewContext(compile(homeWorkspace), context);
  const props = Object.fromEntries(contextProps.map(name => {
    const attribute = homeComposer.attributes.properties.find(p => p.name?.getText(ast) === name);
    return [name, vm.runInNewContext(compile(attribute.initializer.expression), context)];
  }));
  assert.equal(props.activeWorkspace, projectless ? null : context.activeWorkspace);
  assert.equal(props.gitStatus, projectless ? null : context.gitStatus);
  assert.equal(props.useWorktree, !projectless);
  assert.equal(props.gitBranches.length, projectless ? 0 : 1);
  assert.equal(props.workspaceFiles.length, projectless ? 0 : 1);
  assert.equal(props.workspaceFileHits.length, projectless ? 0 : 1);
}
let selectWorkspace, pickFolder;
function findWorkspaceSelection(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleSelectWorkspace") selectWorkspace = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handlePickNewFolder") pickFolder = node.initializer.arguments[0];
  ts.forEachChild(node, findWorkspaceSelection);
}
findWorkspaceSelection(ast);
for (const [route, threadId, draft] of [["home", null, true], ["thread", null, true], ["thread", "existing", false]]) {
  const scope = {
    activeRouteRef: { current: route }, pendingProjectlessRef: { current: true },
    activeThreadIdRef: { current: threadId },
    pendingNewThreadProjectRef: { current: { id: "previous" } }, isThreadWindow: false,
    setWorkspaces() {}, tauriInvoke: async () => [], console,
  };
  await vm.runInNewContext(compile(selectWorkspace), scope)("D:/selected");
  assert.equal(scope.pendingProjectlessRef.current, !draft, "explicit project selection releases home and failed-first-send drafts");
  assert.equal(scope.pendingNewThreadProjectRef.current === null, draft);
}
for (const [route, threadId, draft] of [["home", null, true], ["thread", null, true], ["thread", "existing", false]]) for (const outcome of ["cancel", "failure", "success"]) {
  const scope = {
    activeRouteRef: { current: route }, activeThreadIdRef: { current: threadId }, pendingProjectlessRef: { current: true },
    pendingNewThreadProjectRef: { current: null }, setWorkspaces() {}, console: { warn() {} },
    tauriInvoke: async command => {
      if (command === "pick_folder_dialog") return outcome === "cancel" ? null : "D:/new-project";
      if (outcome === "failure") throw Error("folder registration denied");
      return [{ path: "D:/new-project", active: true }];
    },
  };
  await vm.runInNewContext(compile(pickFolder), scope)();
  assert.equal(scope.pendingProjectlessRef.current, !(draft && outcome === "success"), "only a successfully added folder releases a draft; existing threads retain their context");
}
console.log("PASS H01 title and actual home Composer share projectless scope; explicit project selection releases it");

let modelOptions;
function findModelOptions(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "modelSelection") modelOptions = node.initializer.arguments[0];
  ts.forEachChild(node, findModelOptions);
}
findModelOptions(ast);
for (const [projectless, threadId, expected] of [[true, null, undefined], [false, null, "D:/selected"], [true, "existing-thread", "D:/selected"]]) {
  const scope = { activeWorkspace: { path: "D:/selected" }, homeWorkspace: projectless ? null : { path: "D:/selected" },
    activeThreadId: threadId, models: [], modelsLoading: false, appServerStatus: { connected: true },
    accountInfo: null, modelAccountIdentity: "test-account" };
  assert.equal(vm.runInNewContext(compile(modelOptions), scope).cwd, expected);
}
console.log("PASS home model preference reads use the effective draft project; existing threads retain their workspace");
