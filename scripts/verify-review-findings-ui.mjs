import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sources = Object.fromEntries(["DiffDrawer", "CodeReviewView"].map(name => [name, fs.readFileSync(`src/components/${name}.tsx`, "utf8")]));
const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n old\n-new\n+changed\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-before\n+after";
const finding = (id, file = "a.ts", endLine = 2, rootPath = "D:/repo") => ({ id, threadId: "thread", turnId: "turn", rootPath, file, absolutePath: `${rootPath}/${file}`, title: `Finding ${id}`, body: `Body **${id}**`, startLine: endLine, endLine, side: "right" });
const all = [finding("a"), finding("b", "b.ts", 1), finding("missing-line", "a.ts", 99), finding("missing-file", "absent.ts"), finding("other-root", "a.ts", 2, "D:/other")];
const syntax = ts.createSourceFile("DiffDrawer.tsx", sources.DiffDrawer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && ["decodeGitDiffPath", "parseUnifiedDiff", "reviewPathKey", "findingMatchesLine", "reviewSelectionRange"].includes(node.name?.text)).map(node => node.getText(syntax)).join("\n");
const helperContext = { TextEncoder, TextDecoder };
vm.runInNewContext(ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, helperContext);
const parsed = helperContext.parseUnifiedDiff(`${diff}\n\\ No newline at end of file\n`);
assert.equal(parsed.filter(line => line.file === "b.ts" && line.newLine !== null).length, 1, "Trailing markers must never invent a right-side line");
const headerLike = helperContext.parseUnifiedDiff("--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n--- previous\n+++ changed\n");
assert.equal(headerLike.find(line => line.type === "add").file, "a.ts", "Code beginning +++ must not replace the current file header");
assert.equal(helperContext.decodeGitDiffPath('"b/\\344\\270\\255.ts"'), "b/中.ts");
assert.equal(helperContext.decodeGitDiffPath('"b/a space\\\"quote\\\\slash.ts"'), 'b/a space"quote\\slash.ts');
const chinese = helperContext.parseUnifiedDiff('--- "a/\\344\\270\\255.ts"\n+++ "b/\\344\\270\\255.ts"\n@@ -1 +1 @@\n-old\n+new\n').find(line => line.type === "add");
assert(helperContext.findingMatchesLine(finding("chinese", "中.ts", 1), chinese, "D:/repo"));
const aLine = parsed.find(line => line.file === "a.ts" && line.newLine === 2);
assert(helperContext.findingMatchesLine(finding("case", "A.ts", 2, "d:/REPO"), aLine, "D:/repo"));
assert(!helperContext.findingMatchesLine({ ...all[0], side: "left" }, aLine, "D:/repo"));
assert(!helperContext.findingMatchesLine(finding("next", "a.ts", 3), aLine, "D:/repo"));
assert(!helperContext.findingMatchesLine(all[4], aLine, "D:/repo"));
assert.deepEqual(Array.from(helperContext.reviewSelectionRange("first\r\nsecond\r\nthird\n", 2, 3)), [7, 20]);
assert.equal(helperContext.reviewSelectionRange("first\n", 1, 2), null, "A terminal newline must not invent an extra file line");
assert.equal(helperContext.reviewSelectionRange("", 1, 1), null);

function mount(name, props, states = {}) {
  let cursor = 0;
  const slots = [], calls = [], effects = [];
  const react = {
    Fragment: "fragment",
    createElement(tag, attributes, ...children) { return { tag, props: attributes ?? {}, children: children.flat(Infinity) }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback) { effects.push(callback); }, useMemo: callback => callback(), useCallback: callback => callback,
  };
  const context = { exports: {}, __states: states, TextEncoder, TextDecoder, console: { ...console, warn() {} }, setTimeout: () => 0, clearTimeout() {},
    require(path) {
      if (path === "react") return { ...react, default: react };
      if (path === "../gitPreferences") return { GIT_DEFAULTS: {} };
      if (path === "./MarkdownView") return { MarkdownView: "MarkdownView" };
      if (path === "@tauri-apps/api/core") return { invoke: async (method, args) => { calls.push([method, args]); throw Error("File does not exist"); } };
      if (path === "../fsClient") return { baseNameFsPath: path => path.split(/[\\/]/).at(-1), readFileBytes: async path => { calls.push(["readFileBytes", path]); throw Error("File does not exist"); } };
      if (path === "../bridge") return { tauriInvoke: async () => { throw Error("Unexpected automatic action"); }, tauriListen: async () => () => {} };
      return {};
    },
  };
  const injected = ts.transform(ts.createSourceFile(`${name}.tsx`, sources[name], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), [ctx => root => {
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer)) {
        const key = node.name.elements[0]?.name?.getText();
        if (Object.hasOwn(states, key)) return ctx.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ctx.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments, [ctx.factory.createElementAccessExpression(ctx.factory.createIdentifier("__states"), ctx.factory.createStringLiteral(key))]));
      }
      return ts.visitEachChild(node, visit, ctx);
    };
    return ts.visitNode(root, visit);
  }]);
  const code = ts.createPrinter().printFile(injected.transformed[0]);
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  let tree;
  const render = () => { cursor = 0; tree = context.exports[name](props); return tree; };
  render();
  return { render, calls, effects, get tree() { return tree; } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (typeof tree.tag === "function") return nodes(tree.tag(tree.props));
  return [tree, ...tree.children.flatMap(nodes)];
}
const text = tree => !tree || typeof tree !== "object" ? String(tree ?? "") : typeof tree.tag === "function" ? text(tree.tag(tree.props)) : tree.children.map(text).join("");
{
  const props = { cwd: "D:/repo", onClose() {}, onRefreshGit() {},
    gitStatus: { additions: 20, deletions: 12, entries: [{ path: "a.ts", unstaged: true }, { path: "b.ts", staged: true }] } };
  const rawNodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(rawNodes)] : [];
  const header = view => text(rawNodes(view.tree).find(node => node.props.className === "diff-file-list-header"));
  const scoped = mount("DiffDrawer", props, { requestedDiffMode: "unstaged", scopedDiffContent: diff });
  assert.match(header(scoped), /已更改的文件 \(1\)\+2 -2/);
  const uncommitted = mount("DiffDrawer", props, { requestedDiffMode: "working", scopedDiffContent: diff });
  assert.match(header(uncommitted), /已更改的文件 \(2\)\+2 -2/);
  const selected = mount("DiffDrawer", props, { requestedDiffMode: "unstaged", scopedDiffContent: diff, selectedFile: "a.ts" });
  assert.doesNotMatch(header(selected), /\+\d|-[0-9]/);
  const empty = mount("DiffDrawer", { ...props, gitStatus: { entries: [{ path: "b.ts", staged: true }] } }, { requestedDiffMode: "unstaged" });
  assert.match(text(empty.tree), /无未暂存更改/);
}
{
  const uneven = [
    "--- a/a.ts", "+++ b/a.ts", "@@ -1,4 +1,4 @@", " before", "-old", "+new one", "+new two", " after",
    "-deleted", "@@ -8 +8,2 @@", "+inserted", " shared",
    "diff --git a/b.ts b/b.ts", "--- a/b.ts", "+++ b/b.ts", "@@ -1,2 +1 @@", "-before", "-second", "+after",
  ].join("\n");
  const split = mount("DiffDrawer", { cwd: "D:/repo", gitStatus: { entries: [{ path: "a.ts" }, { path: "b.ts" }] }, onClose() {}, onRefreshGit() {} },
    { scopedDiffContent: uneven, diffLayout: "split", wordWrap: true });
  const grid = nodes(split.tree).find(node => node.props.className?.startsWith("diff-split-grid"));
  assert.ok(grid.props.className.includes("diff-word-wrap"));
  const [oldColumn, newColumn] = grid.children;
  assert.equal(oldColumn.props.style.gridRow, newColumn.props.style.gridRow);
  const pairs = oldColumn.children.slice(1).map((oldCell, index) => [oldCell, newColumn.children[index + 1]].map(cell => ({
    line: text(nodes(cell).find(node => node.props.className === "diff-ln")),
    code: text(nodes(cell).find(node => node.props.className === "diff-tx")),
    gap: cell.props["aria-hidden"] === true,
  })));
  const pair = code => pairs.find(row => row.some(cell => cell.code === code));
  assert.deepEqual(pair("+new one").map(cell => [cell.line, cell.code]), [["2", "-old"], ["2", "+new one"]]);
  assert.equal(pair("+new two")[0].gap, true);
  assert.deepEqual(pair(" after").map(cell => cell.line), ["3", "4"]);
  assert.equal(pair("-deleted")[1].gap, true);
  assert.equal(pair("+inserted")[0].gap, true);
  assert.deepEqual(pair(" shared").map(cell => cell.line), ["8", "9"]);
  assert.equal(pair("-second")[1].gap, true);
}
const run = { attempt: 1, sequence: 1, threadId: "thread", turnId: "turn", cwd: "D:/repo", workspaceRoots: ["D:/repo"], status: "failed", text: "Partial **review**\n::code-comment{title=\"keep literal\"}", error: "Service failed" };
for (const status of ["starting", "running", "completed", "failed", "interrupted", "unknown"]) {
  const ui = mount("CodeReviewView", { workspacePath: "D:/repo", onStartReview() { throw Error("No automatic review"); }, reviewResult: { ...run, status }, reviewFindings: [all[0]], unresolvedFindings: [{ ...all[4], reason: "Unresolved path" }], lastResult: "obsolete" });
  assert(nodes(ui.tree).some(node => node.tag === "MarkdownView" && node.props.content === run.text), `${status}: raw review text must survive`);
  assert(text(ui.tree).includes("Service failed"));
  assert(!text(ui.tree).includes("obsolete"));
  assert(text(ui.tree).includes("Unresolved path"));
}
const empty = mount("CodeReviewView", { workspacePath: "D:/repo", onStartReview() {}, reviewResult: { ...run, status: "completed", text: "", error: null } });
assert(text(empty.tree).includes("未返回审查文本"));
assert(!text(empty.tree).includes("无发现"));
let opened;
const review = mount("CodeReviewView", { workspacePath: "D:/repo", onStartReview() {}, reviewResult: run, reviewFindings: [all[0]], onOpenReviewFinding: finding => { opened = finding; } });
assert.equal(opened, undefined);
nodes(review.tree).find(node => node.tag === "button" && text(node) === "a.ts:2").props.onClick();
assert.equal(opened.id, "a");

for (const layout of ["unified", "split"]) {
  const sent = [];
  const ui = mount("DiffDrawer", { cwd: "D:/repo", gitStatus: { entries: [{ path: "a.ts" }, { path: "b.ts" }] }, onClose() {}, onRefreshGit() {}, modelReviewComments: all, onSendReviewComment: prompt => sent.push(prompt) }, { scopedDiffContent: diff, diffLayout: layout });
  const list = nodes(ui.tree);
  const cards = list.filter(node => node.props["data-review-finding"]);
  assert.equal(cards.length, 5, `${layout}: each finding is retained exactly once`);
  const unanchored = list.find(node => node.props["aria-label"] === "未定位到当前差异行的审查发现");
  assert.deepEqual(nodes(unanchored).filter(node => node.props["data-review-finding"]).map(node => node.props["data-review-finding"]), ["missing-line", "missing-file", "other-root"]);
  assert.equal(sent.length, 0, "Receiving model findings must not send user comments");
  assert.equal(nodes(unanchored).filter(node => node.tag === "button" && node.props.disabled).length, 1);
  const missing = unanchored.children.find(child => nodes(child).some(node => node.props["data-review-finding"] === "missing-file"));
  nodes(missing).find(node => node.tag === "button").props.onClick();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  ui.render();
  assert(ui.calls.some(([method]) => method === "fs_read_preview"), "A missing file must reach the real existing preview path");
  assert(text(ui.tree).includes("读取文件失败"), "Preview failure remains visible");
  assert.equal(sent.length, 0);
}

// The existing manual composer still sends only after an explicit user action.
const sent = [];
const manual = mount("DiffDrawer", { cwd: "D:/repo", gitStatus: { entries: [{ path: "a.ts", unstaged: true }] }, onClose() {}, onRefreshGit() {}, onSendReviewComment: value => sent.push(value) }, { scopedDiffContent: diff, requestedDiffMode: "unstaged", selectedFile: "staged-only.ts", commentLineIdx: 5, commentText: "Check this change" });
assert.equal(sent.length, 0);
nodes(manual.tree).find(node => node.tag === "button" && text(node) === "发送给 Codex").props.onClick();
assert.equal(sent.length, 1);
assert(sent[0].includes("Check this change"));
assert(sent[0].includes("`a.ts`") && !sent[0].includes("staged-only.ts"));
const selected = mount("DiffDrawer", { cwd: "D:/repo", selectedPreviewFile: all[3].absolutePath, selectedReviewFinding: all[3], modelReviewComments: [all[3]], initialTab: "files", gitStatus: { entries: [] }, onClose() {}, onRefreshGit() {} });
selected.effects.find(effect => effect.toString().includes("setActiveReviewFinding(selectedReviewFinding)")).call(null);
for (let i = 0; i < 15; i++) await Promise.resolve();
selected.render();
assert(text(selected.tree).includes("读取文件失败"), "An explicit review-result file selection must not suppress errors");
const clean = mount("DiffDrawer", { cwd: "D:/repo", gitStatus: { entries: [] }, modelReviewComments: [all[3]], onClose() {}, onRefreshGit() {} });
assert(nodes(clean.tree).some(node => node.props["data-review-finding"] === "missing-file"), "A clean working tree must not hide findings");
const previewState = { filePreview: { path: all[0].absolutePath, content: "first\nsecond\n", isBinary: false, isImage: false }, activeReviewFinding: all[0] };
const stale = mount("DiffDrawer", { cwd: "D:/repo", initialTab: "files", gitStatus: { entries: [] }, modelReviewComments: [], onClose() {}, onRefreshGit() {} }, previewState);
assert(!nodes(stale.tree).some(node => node.props["data-review-finding"]), "A finding removed by a chat switch cannot remain in the ordinary file preview");
const wrongRoot = mount("DiffDrawer", { cwd: "D:/other", initialTab: "files", gitStatus: { entries: [] }, modelReviewComments: [all[0]], selectedReviewFinding: all[0], onClose() {}, onRefreshGit() {} }, previewState);
assert(!nodes(wrongRoot.tree).some(node => node.props["data-review-finding"]));
wrongRoot.effects.find(effect => effect.toString().includes("setActiveReviewFinding(selectedReviewFinding)")).call(null);
assert.equal(wrongRoot.calls.length, 0, "Reopening a drawer in another workspace must not open the old finding file");
console.log("RFUI01–RFUI06 PASS: real status/text, explicit finding navigation, file/line/root anchors in both layouts, missing preview errors, and manual-only sending");
