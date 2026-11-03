import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute production TSX effects with controlled component state and DOM refs.
// Backend writes are forbidden in these cases: Git commands open forms only.
const source = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
const ast = ts.createSourceFile("DiffDrawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let requestEffect, focusEffect, editorKey;
const refs = new Map();
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const fn = node.arguments[0];
    if (fn?.getText(ast).includes("handledShortcutRef.current === shortcutRequest.requestId")) requestEffect = fn;
    if (fn?.getText(ast).includes('shortcutFocus.target === "commit"')) focusEffect = fn;
  }
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attrs = node.attributes.properties;
    const attr = name => attrs.find(a => ts.isJsxAttribute(a) && a.name.getText(ast) === name)?.initializer;
    const ref = attr("ref")?.expression?.getText(ast);
    if (ref) refs.set(ref, attr("placeholder")?.text ?? attr("className")?.text);
    if (attr("className")?.text === "file-editor-textarea") editorKey = attr("onKeyDown")?.expression;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(refs.get("commitInputRef"), "输入 Git 提交说明 (留空自动生成)...");
assert.equal(refs.get("prTitleInputRef"), "PR 标题...");
assert.ok(requestEffect && focusEffect && editorKey, "production effects and editor key callback must exist");
function mount() {
  const events = [];
  const context = {
    shortcutRequest: null, handledShortcutRef: { current: null }, open: true, cwd: "A",
    activeTabId: "changes", activeKind: "changes", openTabs: [{ id: "changes" }, { id: "files" }, { id: "summary" }],
    filePreview: null, isDirty: false, savingFile: false, lastTurnOnly: false,
    gitWriteBusy: false, creatingPr: false, gitPreferences: { "git-create-pull-request-as-draft": false },
    shortcutFocus: null, fileTreeWidth: 250,
    commitInputRef: { current: { focus: () => events.push(["focus", "commit"]) } },
    prTitleInputRef: { current: { focus: () => events.push(["focus", "pr"]) } },
    onShortcutHandled: id => events.push(["ack", id]),
    onClose: () => events.push(["close"]),
    saveEditedFile: () => { events.push(["save"]); return Promise.resolve(true); },
    invoke: () => { throw Error("shortcut must not commit, generate or create a PR"); },
  };
  for (const key of ["activeTabId", "diffMode", "shortcutGitCwd", "shortcutFocus", "prDraft", "showPrModal"]) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { context[key] = value; events.push([key, value]); };
  }
  context.setFileTreeWidth = value => { context.fileTreeWidth = typeof value === "function" ? value(context.fileTreeWidth) : value; events.push(["treeWidth", context.fileTreeWidth]); };
  context.setActiveTab = tab => { context.activeTabId = tab; context.activeKind = tab; events.push(["tab", tab]); };
  const run = node => vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const dispatch = run(requestEffect), focus = run(focusEffect), key = run(editorKey);
  let sequence = 0;
  return { context, events, dispatch, focus, key, request(id, cwd = context.cwd) { context.shortcutRequest = { id, requestId: ++sequence, cwd }; dispatch(); } };
}
{
  const view = mount();
  view.context.lastTurnOnly = true;
  view.request("git-commit");
  assert.equal(view.context.activeTabId, "changes");
  assert.equal(view.context.diffMode, "working");
  assert.equal(view.context.shortcutGitCwd, "A", "explicit Git form remains usable independently of review display mode");
  view.focus();
  assert.ok(view.events.some(e => e[0] === "focus" && e[1] === "commit"));
  const count = view.events.length; view.dispatch();
  assert.equal(view.events.length, count, "same request is consumed once, including rerenders / StrictMode effect replay");
  view.request("git-create-draft-pull-request"); view.focus();
  assert.equal(view.context.prDraft, true);
  assert.equal(view.context.showPrModal, true);
  view.request("git-create-pull-request");
  assert.equal(view.context.prDraft, false);
  view.context.gitPreferences["git-create-pull-request-as-draft"] = true;
  view.request("git-create-pull-request");
  assert.equal(view.context.prDraft, true, "regular PR respects existing draft preference");
}
{
  const view = mount();
  view.request("next-tab"); assert.equal(view.context.activeTabId, "files");
  view.request("previous-tab"); assert.equal(view.context.activeTabId, "changes");
  view.request("previous-tab"); assert.equal(view.context.activeTabId, "summary", "tab cycling wraps");
  view.request("focus-tab-2"); assert.equal(view.context.activeTabId, "files");
  view.request("focus-tab-9"); assert.equal(view.context.activeTabId, "files", "missing slot never creates a tab");
  view.context.activeKind = "changes";
  view.request("toggle-file-tree"); assert.equal(view.context.fileTreeWidth, 0, "toggle hides the review tree, retaining Changes");
  view.request("toggle-file-tree"); assert.equal(view.context.fileTreeWidth, 250, "toggle restores the shared tree");
  view.context.activeKind = "files";
  view.request("toggle-file-tree"); assert.equal(view.context.fileTreeWidth, 0, "file editor uses the same tree visibility");
  assert.equal(view.events.some(event => event[0] === "close"), false, "tree toggle never closes the workspace or editor");
  view.context.shortcutRequest = { id: "toggle-file-tree", requestId: 999, cwd: "A", wasOpen: false }; view.dispatch();
  assert.equal(view.context.fileTreeWidth, 250, "opening a closed drawer shows its tree");
  assert.equal(view.context.activeKind, "files");
  view.context.cwd = ""; view.context.activeTabId = "changes";
  view.request("next-tab"); assert.equal(view.context.activeTabId, "files", "projectless existing tabs can still navigate");
}
{
  const view = mount();
  view.request("git-commit", "B");
  assert.deepEqual(view.events.map(e => e[0]), ["ack"], "old workspace request only acknowledges");
  view.context.open = false; view.request("git-create-pull-request");
  view.context.open = true; view.dispatch();
  assert.equal(view.context.showPrModal, undefined, "closed request cannot revive on reopen");
  view.request("git-commit"); view.context.cwd = "B"; view.focus();
  assert.equal(view.events.some(e => e[0] === "focus"), false, "pending focus cannot cross workspace");
  view.context.gitWriteBusy = true; view.request("git-create-pull-request");
  assert.equal(view.context.showPrModal, undefined, "busy Git operation cannot open a competing form");
}
{
  const view = mount();
  view.context.activeKind = "files";
  view.context.isDirty = true;
  view.context.filePreview = { isBinary: false, isImage: false };
  view.request("file-save");
  assert.equal(view.events.filter(e => e[0] === "save").length, 1);
  view.context.filePreview.isBinary = true; view.request("file-save");
  assert.equal(view.events.filter(e => e[0] === "save").length, 1);
  let prevented = 0;
  view.key({ ctrlKey: true, key: "s", preventDefault: () => ++prevented });
  assert.equal(prevented, 1, "existing editor-local Ctrl+S remains connected to save");
  assert.equal(view.events.filter(e => e[0] === "save").length, 2);
}
console.log("PASS workbench production effects: contextual one-shot requests, Git form/focus without writes, existing tab navigation and editor-local saving");
