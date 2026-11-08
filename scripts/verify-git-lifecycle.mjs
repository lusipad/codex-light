import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
const ast = ts.createSourceFile("DiffDrawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
const indexButtons = {};
let effect, branchEffect, branchPatch, keydown;
let projectEntries;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "displayedEntries") projectEntries = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "branchPatch") branchPatch = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && ["handleCommit", "handleCommitAndPush", "handlePush", "handleStage", "handleUnstage"].includes(node.name.getText(ast))) callbacks[node.name.getText(ast)] = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes('invoke<string>("git_diff"')) effect = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes('"git_branch_comparison"')) branchEffect = node.arguments[0];
  if (ts.isJsxSelfClosingElement(node) && node.getText(ast).includes("输入 Git 提交说明")) {
    keydown = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === "onKeyDown").initializer.expression;
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button") {
    const title = node.openingElement.attributes.properties.find(attr =>
      ts.isJsxAttribute(attr) && attr.name.getText(ast) === "title")?.initializer;
    if (title && ['"暂存文件"', '"取消暂存"'].includes(title.getText(ast))) {
      let branch = node.parent;
      while (branch && !ts.isBinaryExpression(branch)) branch = branch.parent;
      indexButtons[title.text] = { node, condition: branch?.left };
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function mount() {
  const requests = [], events = [];
  const context = {
    cwd: "repo-A", gitPreferencesReady: true, recordedTurnDiff: "", gitPreferences: { "git-always-force-push": false }, open: true, activeTab: "changes", diffMode: "working", selectedFile: "a.ts",
    baseBranch: "main", selectedCommitHash: null, turns: [],
    gitStatus: { entries: [{ path: "a.ts", staged: false }] }, displayedEntries: [{ path: "a.ts" }],
    commitMessage: "original draft", forceWithLease: false,
    gitWritePendingRef: { current: false }, gitContextRef: { current: { cwd: "repo-A" } },
    generationRef: { current: null }, generationMountedRef: { current: true },
    invoke(method, params) { const pending = deferred(); requests.push({ method, params, ...pending }); return pending.promise; },
    setCommitMessage(value) { context.commitMessage = typeof value === "function" ? value(context.commitMessage) : value; },
    onRefreshGit: () => events.push(["refresh"]), showToast: message => events.push(["toast", message]),
  };
  for (const name of ["Committing", "Pushing", "IndexWriting", "LoadingDiff", "DiffContent", "Commits", "SelectedCommitHash", "BranchResult"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { context[key] = value; events.push([key, value]); };
  }
  const render = node => { assert.ok(node, "production callback must exist"); return vm.runInNewContext(compile(node), context); };
  return { context, requests, events, commit: render(callbacks.handleCommit), both: render(callbacks.handleCommitAndPush), push: render(callbacks.handlePush), stage: render(callbacks.handleStage), unstage: render(callbacks.handleUnstage), effect: render(effect), projectEntries: render(projectEntries), branchEffect: render(branchEffect), branchPatch: render(branchPatch) };
}
async function flush() { for (let i = 0; i < 8; ++i) await Promise.resolve(); }
{
  const view = mount();
  view.context.diffMode = "branch";
  view.context.gitStatus.entries = [];
  view.context.branchRequest = { cwd: "repo-A", baseBranch: "old", reviewBaseCommit: null };
  view.branchEffect()();
  const current = { cwd: "repo-A", baseBranch: "new", reviewBaseCommit: "fixed-commit" };
  view.context.branchRequest = current;
  const cleanup = view.branchEffect();
  assert.equal(view.requests[1].method, "git_branch_comparison");
  assert.deepEqual(view.requests[1].params, current);
  view.requests[1].resolve([
    { path: "committed.ts", status: "A", patch: "first patch\n" },
    { path: "renamed.ts", status: "R", patch: "second patch\n" },
  ]);
  await flush();
  view.requests[0].reject(Error("late failure"));
  await flush();
  assert.equal(view.context.branchResult.request, current);
  view.context.branchComparison = view.context.branchResult;
  const entries = Array.from(view.projectEntries());
  assert.deepEqual(entries.map(entry => entry.path), ["committed.ts", "renamed.ts"]);
  assert.ok(entries.every(entry => !entry.staged && !entry.unstaged && !entry.untracked));
  view.context.selectedFile = null;
  assert.equal(view.branchPatch(), "first patch\nsecond patch\n");
  view.context.selectedFile = "renamed.ts";
  assert.equal(view.branchPatch(), "second patch\n");
  view.effect();
  assert.equal(view.requests.length, 2, "selection reuses the matching branch patch");
  cleanup();
}
{
  const view = mount();
  view.context.gitStatus.entries = [
    { path: "staged.ts", staged: true },
    { path: "mixed.ts", staged: true, unstaged: true, previousPath: "old.ts" },
    { path: "new.ts", untracked: true },
  ];
  view.context.diffMode = "unstaged";
  view.context.displayedEntries = view.projectEntries();
  assert.deepEqual(Array.from(view.context.displayedEntries, entry => entry.path), ["mixed.ts", "new.ts"]);
  view.context.selectedFile = "staged.ts";
  const cleanup = view.effect();
  assert.equal(view.requests[0].params.filePath, null);
  assert.equal(view.requests[0].params.unstaged, true);
  assert.equal(view.requests[0].params.staged, false);
  cleanup();
  view.context.selectedFile = "mixed.ts";
  const nextCleanup = view.effect();
  assert.equal(view.requests[1].params.filePath, "mixed.ts");
  assert.equal(view.requests[1].params.previousFilePath, null);
  nextCleanup();
  for (const request of view.requests) request.resolve("");
  await flush();
}
{
  const view = mount();
  view.context.gitStatus.entries[0].previousPath = "old [1].ts";
  const cleanup = view.effect();
  assert.equal(view.requests[0].params.previousFilePath, "old [1].ts");
  cleanup();
  view.context.selectedFile = "other.ts";
  const nextCleanup = view.effect();
  assert.equal(view.requests[1].params.previousFilePath, null, "old path never leaks into another selection");
  nextCleanup();
  view.requests[0].resolve("old rename");
  view.requests[1].resolve("other patch");
  await flush();
}
{
  const view = mount(), cleanup = view.effect();
  cleanup();
  view.requests[0].resolve("old patch"); await flush();
  assert.equal(view.context.diffContent, undefined, "GL01: stale success cannot replace a new diff");
  const nextCleanup = view.effect();
  nextCleanup();
  view.requests[1].reject(Error("old failure")); await flush();
  assert.equal(view.context.diffContent, undefined, "GL01: stale failure cannot replace a new diff");
  assert.equal(view.context.loadingDiff, true, "GL01: old finally cannot clear the current loading state");
}
{
  const view = mount(); view.context.diffMode = "commits";
  const cleanup = view.effect(); cleanup();
  view.requests[0].resolve([{ hash: "old" }]); await flush();
  assert.equal(view.requests.length, 1, "GL01: cancelled history cannot launch another diff request");
  assert.equal(view.context.commits, undefined);
}
{
  const view = mount(), pending = view.commit();
  await view.commit(); await view.both(); await view.push();
  assert.equal(view.requests.length, 1, "GL02: all write entries share the same synchronous lock");
  view.requests[0].resolve(); await flush();
  assert.equal(view.requests[1].method, "git_commit_changes");
  view.context.commitMessage = "newer user draft";
  view.requests[1].resolve(); await pending;
  assert.equal(view.context.commitMessage, "newer user draft", "GL03: late success preserves newly typed message");
  assert.equal(view.context.gitWritePendingRef.current, false);
}
{
  const view = mount(), pending = view.both();
  view.context.gitContextRef.current = { cwd: "repo-B" };
  view.requests[0].resolve(); await pending;
  assert.equal(view.requests.length, 1, "GL04: repo switch after stage prevents commit/push");
  assert.equal(view.context.commitMessage, "original draft");
}
{
  const view = mount(), pending = view.both();
  view.requests[0].resolve(); await flush();
  view.requests[1].resolve(); await flush();
  assert.equal(view.context.commitMessage, "", "GL05: confirmed commit clears only unchanged draft");
  assert.equal(view.requests[2].method, "git_push_changes");
  view.requests[2].reject(Error("push rejected")); await pending;
  assert.ok(view.events.some(event => String(event[1]).includes("push rejected")));
  const retry = view.push();
  assert.equal(view.requests[3].method, "git_push_changes", "GL05: retry pushes without another commit");
  view.requests[3].resolve(); await retry;
}
{
  const calls = [];
  const handler = vm.runInNewContext(compile(keydown), { handleCommit: () => calls.push("commit") });
  handler({ key: "Enter", ctrlKey: true, nativeEvent: { isComposing: true } });
  handler({ key: "Enter", ctrlKey: true, keyCode: 229, nativeEvent: {} });
  assert.deepEqual(calls, [], "GL06: composition cannot trigger Git commit");
  handler({ key: "Enter", ctrlKey: true, nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(calls, ["commit"]);
}
console.log("PASS GL01–GL06 actual diff effects and Git callbacks: stale responses, shared write lock, draft retention, repo-switch cancellation, push retry and IME");
{
  const view = mount();
  view.context.gitStatus.entries = [
    { path: "new [1].ts", previousPath: "old [1].ts", status: "RM", staged: true },
    { path: "copy.ts", previousPath: "source.ts", status: "C", staged: true },
  ];
  for (const [path, previous] of [["new [1].ts", "old [1].ts"], ["copy.ts", null], [undefined, null]]) {
    const pending = view.unstage(path);
    const request = view.requests.at(-1);
    assert.equal(request.method, "git_unstage");
    assert.equal(request.params.filePath, path ?? null);
    assert.equal(request.params.previousFilePath, previous);
    request.resolve();
    await pending;
  }
}
for (const action of ["stage", "unstage"]) {
  const view = mount(), pending = view[action]("a.ts");
  const ignored = [view.stage("b.ts"), view.unstage(), view.commit(), view.both(), view.push()];
  assert.equal(view.requests.length, 1, "GI05: stage/unstage and commit/push share one synchronous lock");
  assert.equal(view.requests[0].params.filePath, "a.ts");
  assert.equal(view.requests[0].params.cwd, "repo-A");
  view.requests[0].resolve(); await pending; await Promise.all(ignored);
  assert.equal(view.events.filter(e => e[0] === "refresh").length, 1);
  assert.equal(view.context.gitWritePendingRef.current, false);
  assert.equal(view.context.indexWriting, false);
  const all = view[action]();
  assert.equal(view.requests[1].params.filePath, null, "GI04: whole-index action is explicit");
  view.requests[1].reject(Error("index.lock")); await all;
  assert.ok(view.events.some(e => e[0] === "toast" && String(e[1]).includes("index.lock")));
  assert.equal(view.context.gitWritePendingRef.current, false, "GI07: failure releases retry lock");
}
for (const action of ["stage", "unstage"]) {
  for (const result of ["success", "failure"]) {
    const view = mount(), pending = view[action]("a.ts");
    view.context.gitContextRef.current = { cwd: "repo-B" };
    if (result === "success") view.requests[0].resolve();
    else view.requests[0].reject(Error("old repo error"));
    await pending;
    assert.equal(view.events.some(e => e[0] === "refresh" || e[0] === "toast"), false, "GI06: old repo results cannot refresh or notify B");
    assert.equal(view.context.gitWritePendingRef.current, false);
  }
}
console.log("PASS GI04–GI07 production index callbacks: all/single parameters, shared single-flight, retry and repo isolation; live Git verified separately in Rust");
for (const [entry, stage, unstage] of [
  [{ staged: false, unstaged: true, untracked: false }, true, false],
  [{ staged: false, unstaged: false, untracked: true }, true, false],
  [{ staged: true, unstaged: false, untracked: false }, false, true],
  [{ staged: true, unstaged: true, untracked: false }, true, true],
]) {
  for (const [label, expected] of [["暂存文件", stage], ["取消暂存", unstage]]) {
    const button = indexButtons[label];
    assert.ok(button?.condition, `${label} must have a production visibility condition`);
    const visible = vm.runInNewContext(`(${button.condition.getText(ast)})`, { entry });
    assert.equal(visible, expected, "GI03: mixed index/worktree status must not hide remaining changes");
    assert.match(button.node.getText(ast), /disabled=\{gitWriteBusy\}/);
  }
}
console.log("PASS GI03 production button conditions: staged plus unstaged exposes both actions; exact official layout remains unverified");
