import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the production callback; controlled promises prove ordering, not native parity.
const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "startNewThread") {
    callback = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "production startNewThread callback must be found");
const code = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const project = { id: "multi", serverProjectId: "server-multi", rootPaths: ["D:/one", "D:/two"] };
const snapshot = { workspaces: [{ path: "D:/one", active: true }], projectMembership: { selectedProjectId: "multi", localProjects: [project] } };
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function mount({ select = async () => snapshot, persist = async () => ({ errors: [] }) } = {}) {
  const calls = [], state = {
    permissionModes: { "account:draft:D:/one": "full", "account:old": "ask" },
    attachmentDrafts: { "thread:old": [{ id: "draft", persisted: false }] },
    attachedFiles: [{ id: "draft", persisted: false }], activeRoute: "thread", activeThreadId: "old",
  };
  const context = {
    setPermissionModes: update => { state.permissionModes = update(state.permissionModes ?? {}); },
    navigationRequestRef: { current: 0 }, activeThreadIdRef: { current: "old" },
    attachmentScopeRef: { current: "thread:old" },
    setComposerAttachmentDrafts: update => { state.attachmentDrafts = update(state.attachmentDrafts); },
    attachedFilesRef: { current: state.attachedFiles }, refreshWorkspaceGenerationRef: { current: 0 },
    pendingNewThreadProjectRef: { current: null }, pendingProjectlessRef: { current: false }, threadRequestRef: { current: 0 },
    threadHistoryBufferRef: { current: { discard: () => calls.push(["discard"]) } },
    finishedTurnIdsRef: { current: new Set() }, earlierRequestRef: { current: false },
    composerTextareaRef: { current: { focus: () => calls.push(["focus"]) } },
    persistThreadAttachments: async (...args) => { calls.push(["persist", ...plain(args)]); return persist(...args); },
    tauriInvoke: async (...args) => { calls.push(["invoke", ...plain(args)]); return select(...args); },
    handleSelectWorkspace: path => calls.push(["workspace", path]),
    showAppToast: (...args) => calls.push(["toast", ...args]),
    setTimeout: fn => fn(),
  };
  for (const name of ["Workspaces", "SidebarProjectMembership", "LoadingEarlierTurns", "LoadingThread", "HistoryError", "IsStreaming", "ActiveThreadId", "ActiveTurnId", "ActiveThreadStatus", "Turns", "TurnsCursor", "HasMoreTurns", "PlanSteps", "PlanExplanation", "TurnDiffFiles", "TokenUsage", "AttachedFiles", "ActiveRoute", "ComposerFocusRequest"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { state[key] = value; calls.push([`set${name}`, value]); };
  }
  return { start: vm.runInNewContext(code, context), context, state, calls };
}
async function waitForSelection(view, count = 1) {
  for (let tick = 0; tick < 20 && view.calls.filter(c => c[0] === "invoke").length < count; tick++) {
    await Promise.resolve();
  }
  assert.equal(view.calls.filter(c => c[0] === "invoke").length, count, "callback must reach the controlled persistence promise");
}
{
  const disk = deferred(), view = mount({ select: () => disk.promise });
  const pending = view.start("D:/one", project);
  await waitForSelection(view);
  assert.equal(view.state.activeThreadId, "old", "selection must finish before clearing the current thread");
  assert.equal(view.state.attachedFiles.length, 1, "selection must finish before clearing attachments");
  assert.equal(view.calls.some(c => c[0] === "discard"), false);
  disk.resolve(snapshot); await pending;
  assert.deepEqual(plain(view.calls.find(c => c[0] === "invoke")), ["invoke", "workspace_select_project", { projectId: "multi" }]);
  assert.equal(view.calls.some(c => c[0] === "workspace"), false, "canonical project must not race a second workspace write");
  assert.deepEqual(view.state.workspaces, snapshot.workspaces);
  assert.deepEqual(view.state.sidebarProjectMembership, snapshot.projectMembership);
  assert.equal(view.context.pendingNewThreadProjectRef.current, project, "all roots remain attached to the new draft");
  assert.equal(view.state.activeRoute, "home");
  assert.equal(view.state.activeThreadId, null);
  assert.deepEqual(plain(view.state.permissionModes), { "account:old": "ask" }, "a fresh draft resets only draft permission presets");
  assert.deepEqual(plain(view.state.attachmentDrafts["thread:old"]), [{ id: "draft", persisted: false }],
    "leaving a thread keeps its unsent attachment draft scoped to that thread");
  assert.equal(view.context.attachmentScopeRef.current, "home");
}
{
  const view = mount({ select: async () => { throw Error("disk denied"); } });
  await view.start("D:/one", project);
  assert.equal(view.state.activeThreadId, "old");
  assert.equal(view.state.attachedFiles.length, 1);
  assert.equal(view.context.pendingNewThreadProjectRef.current, null);
  assert.equal(view.calls.some(c => c[0] === "discard"), false);
  assert.match(view.calls.find(c => c[0] === "toast")[1], /选择项目失败.*disk denied/);
}
{
  const view = mount({ persist: async () => ({ errors: [{ message: "attachment denied" }] }) });
  await view.start("D:/one", project);
  assert.equal(view.calls.some(c => c[0] === "persist"), false, "navigating away keeps unsent attachments local to their composer scope");
  assert.equal(view.state.activeThreadId, null);
}
for (const fails of [false, true]) {
  const disk = deferred(), view = mount({ select: () => disk.promise });
  const pending = view.start("D:/one", project);
  await waitForSelection(view);
  ++view.context.navigationRequestRef.current;
  if (fails) disk.reject(Error("late error")); else disk.resolve(snapshot);
  await pending;
  assert.equal(view.state.activeThreadId, "old", "stale completion must not clear the newer view");
  assert.equal(view.state.sidebarProjectMembership, undefined);
  assert.equal(view.calls.some(c => c[0] === "toast"), false, "stale failures must not toast over the newer view");
}
{
  const older = deferred(), newer = deferred();
  const view = mount({ select: (_method, params) => params.projectId === "multi" ? older.promise : newer.promise });
  const first = view.start("D:/one", project);
  await waitForSelection(view);
  const secondProject = { ...project, id: "next" };
  const second = view.start("D:/one", secondProject);
  await waitForSelection(view, 2);
  newer.resolve({ ...snapshot, projectMembership: { selectedProjectId: "next" } });
  await second;
  older.resolve(snapshot); await first;
  assert.equal(view.state.sidebarProjectMembership.selectedProjectId, "next");
  assert.equal(view.context.pendingNewThreadProjectRef.current.id, "next");
}
for (const invalid of [{ ...project, serverProjectId: null }, { ...project, rootPaths: [] }]) {
  const view = mount();
  await view.start("D:/one", invalid);
  assert.equal(view.calls.some(c => c[0] === "invoke" || c[0] === "persist"), false);
  assert.equal(view.state.activeThreadId, "old");
}
{
  const view = mount();
  await view.start("D:/legacy");
  assert.equal(view.calls.some(c => c[0] === "invoke"), false);
  assert.deepEqual(view.calls.find(c => c[0] === "workspace"), ["workspace", "D:/legacy"]);
  assert.equal(view.state.activeRoute, "home");
}
console.log("PASS actual project new-chat callback: persistence ordering, IO failure retention, attachment failure, stale navigation, repeated selection, multi-root context and legacy fallback (L2)");
export { mount as mountProjectNavigation };
