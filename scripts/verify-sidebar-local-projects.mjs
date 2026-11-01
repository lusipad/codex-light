import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const path = "src/sidebarProjects.ts";
assert.ok(fs.existsSync(path), "local project grouping must use entity identity, not directory projection");
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports });
const { buildSidebarProjectGroups, sidebarThreadProjects, threadStartProjectParams } = module.exports;
const root = "D:/projects/shared", second = "D:/projects/second";
const projects = [
  { id: "multi", name: "Multi", rootPaths: [root, second], createdAt: 1, serverProjectId: "s-multi" },
  { id: "same", name: "Same root", rootPaths: [root], createdAt: 2, serverProjectId: "s-same" },
];
const metadata = { localProjects: projects, threadProjectAssignments: {}, workspaceProjectAssignments: {}, projectlessThreadIds: [] };
const workspaces = [{ id: root, path: root, label: "Projection" }, { id: second, path: second, label: "Second projection" }, { id: "D:/legacy", path: "D:/legacy", label: "Legacy" }];
const groups = buildSidebarProjectGroups(workspaces, metadata);
assert.deepEqual(Array.from(groups, g => g.id), ["multi", "same", "D:/legacy"], "shared roots do not merge entities; covered directory projections do not duplicate them");
const ids = (thread, membership = metadata) => Array.from(sidebarThreadProjects(thread, groups, membership, {}), g => g.id);
assert.deepEqual(ids({ id: "a", cwd: root, projectId: "s-multi" }), ["multi"], "explicit canonical assignment wins over directory owner");
assert.deepEqual(ids({ id: "b", cwd: root }), ["same"], "single-root project owns shared cwd fallback");
assert.deepEqual(ids({ id: "c", cwd: second + "/child" }), ["multi"], "second root participates in project scope");
assert.deepEqual(ids({ id: "d", cwd: root + "-other" }), [], "prefix requires a path separator");
assert.deepEqual(ids({ id: "e", cwd: root, projectId: "unknown" }), []);
assert.deepEqual(ids({ id: "f", cwd: root }, { ...metadata, projectlessThreadIds: ["f"] }), []);
assert.deepEqual(ids({ id: "g", cwd: root }, { ...metadata, threadProjectAssignments: { g: { projectKind: "local", projectId: "multi" } } }), ["multi"]);
const ties = buildSidebarProjectGroups([], { ...metadata, localProjects: [
  { id: "a", name: "A", rootPaths: [root], createdAt: 4 }, { id: "z", name: "Z", rootPaths: [root], createdAt: 4 },
] });
assert.deepEqual(Array.from(sidebarThreadProjects({ id: "tie", cwd: root }, ties, metadata, {}), g => g.id), ["z"]);
const start = JSON.parse(JSON.stringify(threadStartProjectParams(projects[0], "D:/worktree")));
assert.deepEqual(start, { projectId: "s-multi", runtimeWorkspaceRoots: ["D:/worktree", second] });
assert.throws(() => threadStartProjectParams({ ...projects[0], serverProjectId: null }), /项目/);
assert.deepEqual(JSON.parse(JSON.stringify(threadStartProjectParams(null))), {});
assert.equal(projects[0].rootPaths[0], root, "runtime workspace override must not mutate configured roots");
console.log("PASS local project entities: shared roots, multi-root scopes, canonical/client priority, root owner ties, legacy projection and start parameters (L2)");
