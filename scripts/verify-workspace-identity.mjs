import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Actual App callback; native IPC promises and React state are controlled boundaries.
const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshWorkspacesAndMeta") callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast); assert.ok(callback);
const code = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
function mount(invoke) {
  let workspaces = [{ id: "old", serverProjectId: "old-server" }], hints = { old: "old-path" }, pins = ["old-pin"];
  let membership = { threadProjectAssignments: { old: { projectKind: "local", projectId: "old" } }, projectlessThreadIds: [], workspaceProjectAssignments: {} };
  const calls = [], warnings = [];
  const refresh = vm.runInNewContext(code, {
    refreshWorkspaceGenerationRef: { current: 0 },
    tauriInvoke: async method => { calls.push(method); return invoke(method, calls.length); },
    setWorkspaces: value => { workspaces = value; },
    setWorkspaceHints: value => { hints = value; },
    setPinnedThreadIds: value => { pins = value; },
    setSidebarProjectMembership: value => { membership = value; },
    console: { warn: (...args) => warnings.push(args) },
  });
  return { refresh, calls, warnings, workspaces: () => workspaces, hints: () => hints, pins: () => pins, membership: () => membership };
}
const newest = [{ id: "new", path: "D:/same-root", serverProjectId: "new-server" }];
{
  const old = deferred();
  const view = mount(async (method, count) => count === 1 ? old.promise : method === "workspace_list" ? newest : { pinnedThreadIds: ["new-pin"], workspaceHints: { new: "new-path" } });
  const pending = view.refresh(); await view.refresh();
  old.resolve([{ id: "stale", serverProjectId: "stale-server" }]); await pending;
  assert.equal(view.workspaces()[0].serverProjectId, "new-server", "old identity request must not overwrite a new snapshot");
  assert.equal(view.calls.filter(method => method === "threads_meta_get").length, 1, "stale workspace result must stop its metadata phase");
  assert.equal(view.pins()[0], "new-pin");
}
{
  const oldMeta = deferred();
  const metaRequested = deferred();
  let metadataReads = 0;
  const view = mount(async method => {
    if (method === "workspace_list") return newest;
    if (++metadataReads === 1) { metaRequested.resolve(); return oldMeta.promise; }
    return { workspaceHints: { new: "new-path" }, pinnedThreadIds: ["new-pin"] };
  });
  const pending = view.refresh();
  await metaRequested.promise;
  await view.refresh(); oldMeta.resolve({ workspaceHints: { stale: "stale-path" }, pinnedThreadIds: ["stale-pin"] }); await pending;
  assert.equal(view.hints().new, "new-path", "metadata arriving after another refresh cannot restore old workspace hints");
  assert.equal(view.pins()[0], "new-pin");
}
{
  const view = mount(async method => { if (method === "workspace_list") throw Error("IPC unavailable"); return { workspaceHints: { retained: "path" } }; });
  await view.refresh(); assert.equal(view.workspaces()[0].serverProjectId, "old-server", "failure must preserve last known identity instead of guessing a replacement");
  assert.equal(view.hints().old, "old-path", "workspace failure must retain the whole previous metadata snapshot");
  assert.equal(view.calls.length, 1); assert.equal(view.warnings.length, 1);
}
{
  const view = mount(async method => { if (method === "threads_meta_get") throw Error("metadata unavailable"); return newest; });
  await view.refresh(); assert.equal(view.workspaces()[0].serverProjectId, "old-server", "metadata failure cannot publish a partial identity snapshot");
  assert.equal(view.hints().old, "old-path"); assert.equal(view.warnings.length, 1);
}
console.log("PASS actual workspace identity refresh: explicit binding passthrough, stale workspace/metadata rejection and failure retention (L2)");

{
  const metadata = deferred(), requested = deferred();
  const view = mount(async method => {
    if (method === "workspace_list") return newest;
    requested.resolve(); return metadata.promise;
  });
  const pending = view.refresh(); await requested.promise;
  assert.equal(view.workspaces()[0].id, "old", "new workspace identities must wait for their client membership snapshot, avoiding mixed-generation grouping");
  assert.equal(view.membership().threadProjectAssignments.old.projectId, "old");
  const membership = { threadProjectAssignments: {}, projectlessThreadIds: ["new-none"], workspaceProjectAssignments: { new: null } };
  metadata.resolve({ projectMembership: membership }); await pending;
  assert.equal(view.workspaces()[0].serverProjectId, "new-server");
  assert.equal(view.membership(), membership);
}
console.log("PASS client membership snapshot: workspace identity waits for metadata; explicit no-project snapshot is published with it (L2)");
