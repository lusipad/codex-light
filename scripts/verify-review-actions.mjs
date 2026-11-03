import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, commitEffect, refreshGit;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleStartCodeReview") callback = node.initializer.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshGitStatus") refreshGit = node.initializer.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('"git_log_commits"')) commitEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);
const js = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function mount(overrides = {}) {
  const calls = [], notices = [], selected = [];
  const context = {
    useCallback: f => f, activeWorkspace: { path: "D:/repo" }, appServerStatus: { connected: true },
    selectedModelId: "model", selectedModelName: "model", gitCommits: [{ hash: "abc", subject: "Fix" }], gitContextCwd: "D:/repo",
    reviewStartPendingRef: { current: false }, reviewContextRef: { current: { cwd: "D:/repo", route: "review", generation: 0 } },
    navigationRequestRef: { current: 0 }, threadRequestRef: { current: 0 }, activeThreadIdRef: { current: null },
    threadsRef: { current: [] }, workspaceHintsRef: { current: {} }, attachmentIdentityKey: value => value.toLowerCase(),
    isStreaming: false,
    permissionMode: "ask", sessionAllowNetwork: false, fastMode: false, models: [],
    modelSupportsFast: () => false, reasoningEffort: "medium", reasoningSummary: "auto",
    reviewBusy: false, reviewLastResult: null, sidebarCreatedThread: null,
    setReviewBusy: value => { context.reviewBusy = value; },
    setReviewLastResult: value => { context.reviewLastResult = value; },
    setSidebarCreatedThread: value => { context.sidebarCreatedThread = value; },
    setReviewDiffTarget: value => { context.reviewDiffTarget = value; },
    setInitialWorkbenchTab: () => {}, setShowRightDrawer: () => {},
    showAppToast: (...args) => notices.push(args),
    refreshThreads: async () => {}, selectThread: async id => {
      selected.push(id); context.activeThreadIdRef.current = id; context.navigationRequestRef.current++;
      context.reviewContextRef.current = { ...context.reviewContextRef.current, route: "thread" };
    },
    ...overrides,
  };
  for (const method of ["callAppServer", "tauriInvoke"]) context[method] = (name, params) => {
    const pending = defer(); calls.push({ method, name, params, ...pending }); return pending.promise;
  };
  return { context, calls, notices, selected, start: vm.runInNewContext(js, context) };
}
{
  const calls = [], updates = [], context = {
    useCallback: f => f, activeWorkspace: { path: "A" }, gitRefreshRequestRef: { current: 0 },
    reviewContextRef: { current: { cwd: "A" } }, setGitStatus: value => updates.push(value), setGitBranches: value => updates.push(value),
    setGitContextCwd: () => {},
    tauriInvoke: name => { const pending = defer(); calls.push({ name, ...pending }); return pending.promise; },
  };
  const refresh = vm.runInNewContext(ts.transpileModule(`(${refreshGit})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const loading = refresh();
  context.reviewContextRef.current = { cwd: "B" };
  calls[0].resolve({ branch: "wrong" }); await loading;
  assert.equal(updates.length, 0, "RA08: stale Git context cannot overwrite review branches/status");
  assert.equal(calls.length, 1);
}
{
  const v = mount(), first = v.start({ kind: "uncommitted" });
  const duplicate = v.start({ kind: "uncommitted" });
  assert.equal(v.calls.length, 1, "RA01: rapid repeated starts create one request chain");
  await duplicate;
  v.calls[0].reject(Error("offline")); await first;
  assert.equal(v.context.reviewBusy, false);
  const retry = v.start({ kind: "uncommitted" });
  assert.equal(v.calls.length, 2);
  v.calls[1].reject(Error("offline")); await retry;
  assert.ok(v.notices.some(([text]) => text.includes("offline")));
}
{
  const v = mount(), start = v.start({ kind: "branch", branch: "base", instructions: "Check races" });
  assert.equal(v.calls[0].name, "git_merge_base", "RA02: branch resolves real merge base before creating a thread");
  assert.equal(v.calls[0].params.baseBranch, "base");
  v.calls[0].resolve("0123456789abcdef"); await flush();
  assert.equal(v.calls[1].name, "thread/start");
  assert.equal(v.calls[1].params.threadSource, "code_review");
  v.calls[1].resolve({ thread: { id: "new", projectId: "project" } }); await flush();
  assert.equal(v.calls[2].name, "turn/start");
  const p = v.calls[2].params;
  assert.equal(p.turnTrigger, "code_review");
  assert.equal(p.threadId, "new");
  assert.equal(p.collaborationMode, null);
  assert.equal(p.approvalPolicy, "on-request");
  assert.equal(p.approvalsReviewer, "user");
  assert.equal(p.sandboxPolicy.networkAccess, false);
  assert.ok(p.input[0].text.includes("0123456789abcdef") && p.input[0].text.includes("base") && p.input[0].text.includes("Check races"));
  v.calls[2].resolve({ turn: { id: "turn" } }); await start;
  assert.deepEqual(v.selected, ["new"]);
}
{
  const v = mount(), start = v.start({ kind: "branch", branch: "missing" });
  v.calls[0].reject(Error("no merge base")); await start;
  assert.equal(v.calls.length, 1, "RA03: merge-base failure cannot create a thread or start a model");
}
{
  const v = mount({ activeThreadIdRef: { current: "existing" }, threadsRef: { current: [{ id: "existing", cwd: "D:/repo" }] } });
  const start = v.start({ kind: "uncommitted" });
  await flush();
  assert.equal(v.calls[0].name, "turn/start", "RA04: inline uses current conversation");
  assert.equal(v.calls[0].params.threadId, "existing");
  assert.ok(v.calls[0].params.input[0].text.includes("untracked"));
  v.calls[0].resolve({ turn: { id: "turn" } }); await start;
  assert.deepEqual(v.selected, ["existing"]);
}
{
  const v = mount(), start = v.start({ kind: "uncommitted" });
  v.context.reviewContextRef.current = { cwd: "D:/other", route: "review", generation: 1 };
  v.calls[0].resolve({ thread: { id: "orphan" } }); await start;
  assert.equal(v.calls.length, 1, "RA05: context changed before thread creation returns cannot start a turn");
  assert.deepEqual(v.selected, []);
  assert.equal(v.context.reviewLastResult, null);
}
{
  const v = mount(), start = v.start({ kind: "uncommitted" });
  v.calls[0].resolve({ thread: { id: "new" } }); await flush();
  assert.equal(v.calls[1].name, "turn/start");
  v.context.navigationRequestRef.current++;
  v.calls[1].resolve({ turn: { id: "turn" } }); await start;
  assert.deepEqual(v.selected, ["new"], "RA06: late completion must not override newer navigation");
  assert.equal(v.context.reviewLastResult, null);
}
for (const request of [{ kind: "commit", sha: "abc" }, { kind: "custom", instructions: "Look here" }]) {
  const v = mount(), start = v.start(request);
  v.calls[0].resolve({ thread: { id: "legacy" } }); await flush();
  assert.equal(v.calls[1].name, "review/start", "RA07: existing commit/custom protocol paths remain available");
  assert.equal(v.calls[1].params.target.type, request.kind);
  v.calls[1].resolve({ reviewThreadId: "legacy" }); await start;
}
{
  const pending = defer(), updates = [], context = {
    activeRoute: "review", activeWorkspace: { path: "A" },
    tauriInvoke: () => pending.promise, setGitCommits: value => updates.push(value),
  };
  const effect = vm.runInNewContext(ts.transpileModule(`(${commitEffect})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const cleanup = effect(); cleanup(); pending.resolve([{ hash: "old" }]); await flush();
  assert.equal(updates.length, 1, "RA08: old project's commits cannot replace the new list after cleanup");
}
{
  const viewSource = fs.readFileSync("src/components/CodeReviewView.tsx", "utf8");
  const viewAst = ts.createSourceFile("CodeReviewView.tsx", viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  function collect(node) {
    if (ts.isCallExpression(node) && node.expression.getText(viewAst) === "useEffect") {
      const effect = node.arguments[0].getText(viewAst);
      if (effect.includes("setBranch") || effect.includes("setSha")) effects.push(effect);
    }
    ts.forEachChild(node, collect);
  }
  collect(viewAst);
  let branch = "main", sha = "";
  const context = { branches: ["develop"], defaultBranch: "develop", commits: [{ hash: "new" }],
    setBranch: value => { branch = value(branch); }, setSha: value => { sha = value(sha); } };
  for (const effect of effects) vm.runInNewContext(ts.transpileModule(`(${effect})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  assert.equal(branch, "develop", "RA08: asynchronous branch options replace a nonexistent default");
  assert.equal(sha, "new", "RA08: asynchronous commit options become selectable");
}
{
  const v = mount({ activeThreadIdRef: { current: "existing" }, threadsRef: { current: [{ id: "existing", cwd: "D:/repo" }] }, isStreaming: true });
  await v.start({ kind: "uncommitted" });
  assert.equal(v.calls.length, 0, "RA04: quick review cannot steer an already running turn");
}
{
  const v = mount({ gitContextCwd: "D:/old" });
  await v.start({ kind: "branch", branch: "old-branch" });
  assert.equal(v.calls.length, 0, "RA08: stale branch ownership cannot start review in another repository");
}
{
  const source = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
  const ast = ts.createSourceFile("DiffDrawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect, baseExpression;
  function collect(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0].getText(ast).includes("appliedReviewCwdRef")) effect = node.arguments[0].getText(ast);
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "reviewBaseCommit") baseExpression = node.initializer.getText(ast);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  const context = { cwd: "A", reviewTarget: { cwd: "A", baseBranch: "base", mergeBase: "sha" }, appliedReviewCwdRef: { current: null } };
  for (const [setter, key] of [["setDiffMode", "diffMode"], ["setBaseBranch", "baseBranch"], ["setDiffLayout", "diffLayout"], ["setSelectedFile", "selectedFile"]]) context[setter] = value => { context[key] = value; };
  const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const apply = vm.runInNewContext(compile(`(${effect})`), context);
  apply();
  assert.equal(context.diffMode, "branch");
  assert.equal(context.diffLayout, "split");
  assert.equal(vm.runInNewContext(compile(`(${baseExpression})`), context), "sha", "RA09: review diff uses the same merge base as the model request");
  context.cwd = "B"; apply();
  assert.equal(context.diffMode, "working");
  assert.equal(context.baseBranch, "");
  assert.equal(vm.runInNewContext(compile(`(${baseExpression})`), context), null, "RA09: old review target cannot leak to another repository");
}
console.log("PASS RA01-RA09: production review callbacks/effects, targets, permissions, merge base, single-flight, stale navigation and diff scope");
