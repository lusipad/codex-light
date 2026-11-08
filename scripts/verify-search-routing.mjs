import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const parse = path => ts.createSourceFile(path, fs.readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = parse("src/components/QuickSearchModal.tsx"), app = parse("src/App.tsx");
let items, keydown, focus, appSlash, selectedFileSearchText;
const shortcuts = {};
const helpers = [];
function visit(node, ast) {
  if (ast === app && ts.isFunctionDeclaration(node) && node.name?.text === "selectedFileSearchText") selectedFileSearchText = node;
  if (ast === page && ts.isFunctionDeclaration(node) && ["fileDedupeKey"].includes(node.name?.text)) helpers.push(node);
  if (ts.isVariableDeclaration(node) && ast === page) {
    if (node.name.getText(ast) === "items") items = node.initializer.arguments[0];
    if (node.name.getText(ast) === "handleKeyDown") keydown = node.initializer;
  }
  if (ast === page && ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("lastActiveElementRef.current = document.activeElement")) focus = node.arguments[0];
  if (ast === app && ts.isJsxAttribute(node) && node.name.getText(ast) === "onSelectSlashCommand") appSlash = node.initializer.expression;
  if (ast === app && ts.isPropertyAssignment(node) && ["command-palette", "command-palette-alt", "file-search"].includes(node.name.text) &&
      node.initializer.getText(ast).includes("setQuickSearchMode")) shortcuts[node.name.text] = node.initializer;
  ts.forEachChild(node, child => visit(child, ast));
}
visit(page, page); visit(app, app);
const execute = (node, ast, context) => {
  assert.ok(node, "production callback exists");
  return vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
};
const slash = { id: "goal", command: "/goal", title: "Goal", description: "goal", kind: "action", action: "open_goal_dialog" };
function mount(overrides = {}) {
  const calls = [];
  const context = {
    query: "goal", mode: "root", workspacePath: "repo-B", remoteResults: null,
    threads: [], workspaceFileHits: [], skills: [], SLASH_COMMANDS: [slash],
    REMOTE_THREAD_LIMIT: 9,
    runCmd: "npm run dev", testCmd: "npm test", buildCmd: "npm run build",
    selectedIndex: 0,
    inputRef: { current: { focus() {} } },
    React: { createElement() { return {}; } },
    ...overrides,
  };
  for (const icon of ["Command", "MessageSquare", "Play", "Folder", "Settings", "FileText", "BookOpen"]) context[icon] = () => null;
  for (const name of ["onSelectSlashCommand", "onClose", "onTriggerCommand", "onSelectFile", "onSearchFiles", "onSelectThread", "onNavigateSettings", "onNavigateRoute", "onStartNewChat", "onSelectSkill"]) {
    context[name] = (...args) => calls.push([name, ...args]);
  }
  context.setSelectedIndex = value => { context.selectedIndex = typeof value === "function" ? value(context.selectedIndex) : value; };
  context.setQuery = value => { context.query = value; };
  for (const helper of helpers) vm.runInNewContext(ts.transpileModule(helper.getText(page), {}).outputText, context);
  return { context, calls, results: () => execute(items, page, context)() };
}
{
  const view = mount();
  view.results().find(item => item.id === "slash-goal").onSelect();
  assert.equal(view.calls[0][0], "onSelectSlashCommand", "SR01: slash is separate from shell command dispatch");
  assert.equal(view.calls[0][1], slash);
  assert.ok(!view.calls.some(call => call[0] === "onTriggerCommand"));
  const calls = [], dispatch = execute(appSlash, app, {
    handleSlashAction: value => calls.push(["action", value]),
    setPromptInput: value => calls.push(["draft", value]),
  });
  dispatch(slash);
  dispatch({ kind: "insert", insertText: "/review inspect changes" });
  assert.deepEqual(calls, [["action", "open_goal_dialog"], ["draft", "/review inspect changes"]]);
}
{
  const view = mount({ mode: "files", query: "npm", remoteResults: {
    mode: "files", query: "npm", workspacePath: "repo-B", threads: [],
    files: [{ fileName: "npm.txt", relPath: "npm.txt", absPath: "repo-B/npm.txt" }],
  } });
  const result = view.results();
  assert.equal(result.length, 1);
  assert.equal(result[0].category, "file", "SR02: files mode excludes matching run actions");
  view.context.mode = "root";
  assert.ok(view.results().some(item => item.category === "action"));
  const modes = [], opened = [];
  for (const name of ["file-search", "command-palette", "command-palette-alt"]) {
    execute(shortcuts[name], app, {
      showQuickSearch: false, lastFileSearchSeed: { current: "" }, selectedFileSearchText: () => undefined,
      setQuickSearchInitialQuery() {},
      setQuickSearchMode: mode => modes.push(mode), setShowQuickSearch: value => opened.push(value),
    })();
  }
  assert.deepEqual(modes, ["files", "root", "root"], "SR03: every entry chooses its mode");
  assert.deepEqual(opened, [true, true, true]);
}
{
  class Input {
    type = "text";
    value = "前缀  路径/测试🚀.rs  后缀";
    selectionStart = 2;
    selectionEnd = this.value.indexOf("后缀");
  }
  class Textarea extends Input {}
  const input = new Input();
  const document = { activeElement: input, getSelection: () => null };
  assert.ok(selectedFileSearchText, "file shortcut must capture selection before the search input takes focus");
  const select = execute(selectedFileSearchText, app, { document, HTMLInputElement: Input, HTMLTextAreaElement: Textarea });
  assert.equal(select(), "路径/测试🚀.rs");
  input.type = "password";
  assert.equal(select(), undefined);
  for (const value of ["a\nb", "a\rb", "a\0b", "a".repeat(257), " "]) {
    const textarea = new Textarea();
    Object.assign(textarea, { value, selectionStart: 0, selectionEnd: value.length });
    document.activeElement = textarea;
    assert.equal(select(), undefined);
  }
  document.activeElement = { contains: node => node === 1 || node === 2 };
  const selection = { anchorNode: 1, focusNode: 2, toString: () => " src/main.rs " };
  document.getSelection = () => selection;
  assert.equal(select(), "src/main.rs");
  selection.focusNode = 3;
  assert.equal(select(), undefined);
  const seeds = [];
  const context = {
    showQuickSearch: false, lastFileSearchSeed: { current: "" },
    selectedFileSearchText: () => "src/main.rs",
    setQuickSearchInitialQuery: request => seeds.push(request.value),
    setQuickSearchMode() {}, setShowQuickSearch() {},
  };
  const openFiles = execute(shortcuts["file-search"], app, context);
  openFiles();
  context.showQuickSearch = true;
  context.selectedFileSearchText = () => { throw Error("must not read the menu's own selection"); };
  openFiles();
  execute(shortcuts["command-palette"], app, context)();
  assert.deepEqual(seeds, ["src/main.rs", "src/main.rs", ""]);
}
{
  const view = mount({ query: "match", remoteResults: {
    mode: "root", query: "match", workspacePath: "repo-A",
    files: [{ absPath: "repo-A/match", relPath: "match", fileName: "match" }],
    threads: [{ id: "old", name: "match" }],
  } });
  assert.equal(view.results().length, 0, "SR05: same query cannot expose old-workspace results");
  view.context.workspacePath = "repo-A";
  assert.equal(view.results().length, 1, "root shows threads, never fuzzy files");
}
{
  const view = mount({ query: "files" });
  let focused = 0;
  view.context.inputRef.current.focus = () => focused++;
  view.results().find(item => item.id === "search-files").onSelect();
  assert.equal(view.context.query, "", "official file drill-in clears search");
  assert.deepEqual(view.calls, [["onSearchFiles"]], "drill-in changes mode without closing");
  assert.equal(focused, 1, "mouse drill-in restores focus to the search input");
}
{
  const view = mount();
  view.context.items = [{ section: "a", onSelect: () => view.calls.push(["select"]) }];
  const key = execute(keydown, page, view.context);
  for (const keyName of ["Enter", "Escape", "ArrowDown", "Tab"]) {
    key({ key: keyName, nativeEvent: { isComposing: true }, preventDefault() { throw Error("IME navigation consumed"); } });
    key({ key: keyName, keyCode: 229, nativeEvent: {}, preventDefault() { throw Error("IME navigation consumed"); } });
  }
  assert.deepEqual(view.calls, [], "SR04: composing keys do not execute/close");
  key({ key: "Enter", nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(view.calls, [["select"]]);
}
{
  const timers = new Set(); let focusCalls = 0;
  const context = {
    open: true, document: { activeElement: { focus() { focusCalls++; } } },
    lastActiveElementRef: { current: null }, inputRef: { current: { focus() { focusCalls++; } } },
    setQuery() {}, setSelectedIndex() {},
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
  };
  const effect = execute(focus, page, context), cleanup = effect();
  cleanup(); assert.equal(timers.size, 0, "SR06: closing cancels delayed focus");
  context.open = false; effect();
  assert.equal(focusCalls, 1, "SR06: restores trigger focus");
}
console.log("PASS SR01–SR06 production search routing: slash action/draft, file mode, entry modes, IME, workspace-scoped results and focus cleanup");
