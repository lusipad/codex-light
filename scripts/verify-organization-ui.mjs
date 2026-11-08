import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/WorktreesView.tsx", "utf8");
const ast = ts.createSourceFile("WorktreesView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refresh;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refresh") refresh = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const pending = [];
const context = {
  mountedRef: { current: true }, requestRef: { current: 0 }, activeWorkspaceRoot: "isolated-root",
  loading: false, error: null, worktrees: [],
  setLoading(value) { this.loading = value; },
  setError(value) { this.error = value; },
  setWorktrees(value) { this.worktrees = value; },
  setConversations() {}, setConversationError() {}, setBranches() {}, setSelectedBranch() {},
  loadWorktreeConversations: async () => [],
  tauriInvoke: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
};
for (const key of ["setLoading", "setError", "setWorktrees"]) context[key] = context[key].bind(context);
const run = vm.runInNewContext(ts.transpileModule(`(${refresh})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const first = run();
assert.equal(context.loading, true, "Pending worktree list must be a loading state, not an empty state");
pending[0].reject(Error("fixture denied")); await first;
assert.equal(context.loading, false);
assert.equal(context.error, "fixture denied");
const older = run(), latest = run();
pending[1].reject(Error("stale")); await older;
assert.equal(context.loading, true, "Stale completion must not end the newer loading state");
pending[2].resolve([]);
for (let i = 0; i < 8; i++) await Promise.resolve();
pending[3].resolve([]); await latest;
assert.equal(context.loading, false);
assert.equal(context.error, null);
assert.equal(context.worktrees.length, 0);

const projects = fs.readFileSync("src/components/ProjectsIndexView.tsx", "utf8");
const css = fs.readFileSync("src/components/ProjectsIndexView.css", "utf8");
assert.ok(projects.includes("project-col-updated"));
assert.equal(projects.split("<span>聊天数</span>").length - 1, 1,
  "Only the explicitly separate workspace fallback may retain the legacy count column");
assert.ok(css.includes("minmax(0, 1fr) 4rem 8rem"));
assert.ok(css.includes("max-width: 680px"));
const archive = fs.readFileSync("src/components/ArchiveView.tsx", "utf8");
assert.ok(archive.includes('aria-label="搜索已归档的聊天"'));
assert.ok(archive.includes('aria-label="删除已归档的聊天"'));
assert.ok(archive.includes('"未找到匹配的归档聊天" : "暂无已归档的聊天"'));
assert.ok(!archive.includes("🗄️"));

// Execute the production menu dispatcher: every moved action must remain connected,
// and a busy row must reject a callback even if it was already open.
const projectAst = ts.createSourceFile("ProjectsIndexView.tsx", projects, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let menuAction;
function visitProject(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(projectAst) === "onSelect"
      && node.initializer?.expression?.getText(projectAst).includes("setEditingProject")) menuAction = node.initializer.expression.getText(projectAst);
  ts.forEachChild(node, visitProject);
}
visitProject(projectAst);
const calls = [], project = { id: "isolated-project" };
const menuContext = {
  isBusy: false, project, roots: [{ path: "isolated-root" }],
  onRevealPath: root => calls.push(["reveal", root]),
  setEditingProject: item => calls.push(["edit", item.id]),
  handleMoveProject: (item, direction) => calls.push([direction, item.id]),
  setRemovingProject: item => calls.push(["remove", item.id]),
};
const select = vm.runInNewContext(ts.transpileModule(`(${menuAction})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, menuContext);
for (const action of ["reveal", "edit", "up", "down", "remove"]) select(action);
assert.deepEqual(calls, [["reveal", "isolated-root"], ["edit", project.id], ["up", project.id], ["down", project.id], ["remove", project.id]]);
menuContext.isBusy = true; select("remove");
assert.equal(calls.length, 5, "Busy menu dispatcher must not start a second mutation");

const projectApi = {};
const updates = [];
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/projects.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: projectApi,
  require: () => ({ callAppServer: async (method, params) => {
    updates.push([method, JSON.parse(JSON.stringify(params))]);
    return { project: { id: project.id, name: params.name ?? "Existing", roots: params.roots ?? [] } };
  } }),
});
await projectApi.updateProject(project.id, { name: " Updated " });
await projectApi.updateProject(project.id, { roots: [] });
await assert.rejects(projectApi.updateProject(project.id, { roots: [{ path: " " }] }));
assert.deepEqual(updates, [
  ["project/update", { projectId: project.id, name: "Updated" }],
  ["project/update", { projectId: project.id, roots: [] }],
], "an explicit empty root list differs from an omitted or malformed patch");
console.log("Organization UI: loading/error/stale request and current-source surface regressions passed");
