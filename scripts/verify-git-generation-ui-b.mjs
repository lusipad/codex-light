import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync(process.argv[2] ?? "src/components/DiffDrawer.tsx", "utf8");
const ast = ts.createSourceFile("DiffDrawer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), functions = {};
const names = ["requestGeneration", "cancelGeneration", "handleGenerateCommitMessage", "handleGeneratePrMessage", "handleCommit", "handleCommitAndPush", "handleCreatePr"];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) functions[node.name.getText(ast)] = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(names.every(name => functions[name]), "production actions must use real generation and explicit cancellation");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const generated = { operationId: "fixture", message: "Preserve the draft across asynchronous generation", title: "Preserve user input during generation", body: "## Summary\n- Preserve user input\n## Testing\n- Not run (not requested)" };
function fixture() {
  const calls = [], events = []; let generation = () => Promise.resolve(generated);
  const c = {
    cwd: "fixture", open: true, gitPreferencesReady: true, gitPreferences: { "git-always-force-push": false }, baseBranch: "main", forceWithLease: false,
    gitStatus: { entries: [{ path: "tracked", staged: false }] }, commitMessage: "", prTitle: "", prBody: "", prDraft: true,
    commitDraftRef: { current: "" }, prDraftRef: { current: { title: "", body: "" } },
    generationRef: { current: null }, generationMountedRef: { current: true }, gitWritePendingRef: { current: false }, gitContextRef: { current: {} },
    generateGitMessage: (...args) => { calls.push(["generate", ...args]); return generation(...args); },
    invoke: async (method, args) => { calls.push([method, args]); return method === "git_create_pr" ? "https://example.invalid/pr/1" : undefined; },
    showToast: message => events.push(["toast", message]), onRefreshGit: () => events.push(["refresh"]),
  };
  for (const [name, key] of [["setCommitMessage", "commitMessage"], ["setPrTitle", "prTitle"], ["setPrBody", "prBody"], ["setCommitting", "committing"], ["setCreatingPr", "creatingPr"], ["setGenerationKind", "generationKind"], ["setShowPrModal", "showPrModal"]]) {
    c[name] = value => { c[key] = typeof value === "function" ? value(c[key]) : value; events.push([key, c[key]]); };
  }
  // All callbacks must see the same live refs and setters, including their actual generation helper.
  const scope = { ...c, AbortController };
  for (const name of names) scope[name] = vm.runInNewContext(ts.transpileModule(`(${functions[name].getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  return { c, calls, events, ...Object.fromEntries(names.map(name => [name, scope[name]])), generation: value => generation = value,
    commitDraft(value) { c.commitMessage = value; scope.commitMessage = value; c.commitDraftRef.current = value; },
    prDraft(title, body) { c.prDraftRef.current = { title, body }; c.prTitle = scope.prTitle = title; c.prBody = scope.prBody = body; } };
}
for (const action of ["handleCommit", "handleCommitAndPush"]) {
  const f = fixture(), late = deferred(); f.generation(() => late.promise);
  const pending = f[action](); await f[action]();
  assert.deepEqual(f.calls.map(c => c[0]), ["generate"], "empty-message action must generate before any Git mutation and remain single-flight");
  late.reject(Error("model unavailable")); await pending;
  assert.deepEqual(f.calls.map(c => c[0]), ["generate"]); assert.equal(f.c.gitWritePendingRef.current, false);
  assert.ok(f.events.some(e => String(e[1]).includes("model unavailable")));
}
{
  const f = fixture(); await f.handleCommitAndPush();
  assert.deepEqual(f.calls.map(c => c[0]), ["generate", "git_stage", "git_commit_changes", "git_push_changes"]);
  assert.equal(f.calls[2][1].message, generated.message);
}
for (const change of ["draft", "context", "cancel"]) {
  const f = fixture(), late = deferred(); f.generation(() => late.promise);
  const pending = f.handleCommit();
  if (change === "draft") f.commitDraft("User changed draft");
  if (change === "context") f.c.gitContextRef.current = { cwd: "other" };
  if (change === "cancel") f.cancelGeneration();
  late.resolve(generated); await pending;
  assert.deepEqual(f.calls.map(c => c[0]), ["generate"], "a late generated result cannot continue a canceled or changed commit intent");
}
{
  const f = fixture(), late = deferred(); f.commitDraft("existing draft"); f.generation(() => late.promise);
  const pending = f.handleGenerateCommitMessage(); f.commitDraft("new user draft"); late.resolve(generated); await pending;
  assert.equal(f.c.commitMessage, "new user draft");
}
{
  const f = fixture(); f.prDraft("Explicit title", ""); await f.handleGeneratePrMessage();
  assert.equal(f.c.prTitle, "Explicit title"); assert.equal(f.c.prBody, generated.body);
  assert.deepEqual(f.calls.map(c => c[0]), ["generate"], "filling a PR form must not create or push it");
}
{
  const f = fixture(), late = deferred(); f.generation(() => late.promise);
  const pending = f.handleCreatePr(); f.prDraft("new title", "new body"); late.resolve(generated); await pending;
  assert.deepEqual(f.calls.map(c => c[0]), ["generate"]);
}
{
  const f = fixture(); f.prDraft("Explicit title", "Explicit body"); await f.handleCreatePr();
  assert.deepEqual(f.calls.map(c => c[0]), ["git_create_pr"]); assert.equal(f.calls[0][1].title, "Explicit title");
}
console.log("PASS GB05/GB06: actual production actions generate before Git writes, preserve drafts, isolate cancellation/context changes and never substitute filename templates");
