import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
  let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(value, `${name} production callback exists`);
  return ts.transpileModule(`(${value.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarProjects.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports });
const plain = value => JSON.parse(JSON.stringify(value));
const root = "D:/projects/shared", second = "D:/projects/second";
const multi = { id: "multi", name: "Multi", rootPaths: [root, second], serverProjectId: "server-multi", createdAt: 1 };
const same = { id: "same", name: "Same", rootPaths: [root], serverProjectId: "server-same", createdAt: 2 };
const metadata = { selectedProjectId: "multi", localProjects: [multi, same], threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {} };
export function mountProjectContext({ pending = null, membership = metadata, workspace = root, threadId = null, start, turn, worktree = false } = {}) {
  const calls = [], state = { promptInput: "hello", turns: [] };
  const context = {
    ...module.exports, promptInput: "hello", attachedFiles: [], isStreaming: false,
    activeThreadId: threadId, activeThreadIdRef: { current: threadId }, activeTurnIdRef: { current: null },
    pendingNewThreadProjectRef: { current: pending }, sidebarProjectMembership: membership,
    activeWorkspace: { path: workspace }, handleSaveGoalRef: { current: null },
    pendingTurnIdRef: { current: null }, threadRequestRef: { current: 0 }, pendingAttachmentSaveRef: { current: null },
    attachmentScopeRef: { current: threadId ? `thread:${threadId}` : "home" },
    steerSendPendingRef: { current: new Set() }, useWorktree: worktree, planMode: false,
    tauriInvoke: async (method, params) => { calls.push([method, plain(params)]); return { path: "D:/worktree" }; },
    permissionMode: "default", selectedModelId: undefined, reasoningEffort: null, reasoningSummary: "auto",
    sessionAllowNetwork: false, fastMode: false, models: [], console: { error() {}, warn() {} },
    callAppServer: async (method, params) => {
      calls.push([method, plain(params)]);
      if (method === "thread/start") return start ? start(params) : { thread: { id: "created", projectId: params.projectId } };
      assert.equal(method, "turn/start", "this harness only crosses declared send boundaries");
      return turn ? turn(params) : { turn: { id: "turn-created" } };
    },
    refreshThreads: () => {},
    showAppToast: (...args) => calls.push(["toast", ...args]),
    goalSet: async (id, patch) => { calls.push(["goalSet", id, plain(patch)]); return patch; },
    buildGoalPrompt: text => `/goal ${text}`,
    moveHomePromptToThread: id => calls.push(["moveHomePromptToThread", id]),
    moveHomeAttachmentsToThread: id => calls.push(["moveHomeAttachmentsToThread", id]),
    setThreadPrompt: (_id, update) => { state.promptInput = typeof update === "function" ? update(state.promptInput) : update; },
  };
  for (const name of ["ActiveRoute", "Turns", "IsStreaming", "ActiveTurnId", "SidebarCreatedThread", "ActiveThreadId", "WorkspaceHints", "PromptInput", "AttachedFiles", "ShowGoalModal", "ServerGoal"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { state[key] = typeof value === "function" ? value(state[key] ?? {}) : value; };
  }
  const sandbox = vm.createContext(context);
  const send = vm.runInContext(callback("handleSendMessage"), sandbox);
  context.handleSendMessage = send;
  const goal = vm.runInContext(callback("handleSaveGoal"), sandbox);
  return { send, goal, context, state, calls };
}

{
  const view = mountProjectContext();
  await view.send();
  const start = view.calls.find(c => c[0] === "thread/start")?.[1];
  assert.equal(start.projectId, multi.serverProjectId, "cold-start draft must restore selected project, not only its highlight");
  assert.equal(start.cwd, root);
  assert.deepEqual(start.runtimeWorkspaceRoots, [root, second]);
  assert.deepEqual(view.calls.find(c => c[0] === "turn/start")[1].runtimeWorkspaceRoots, [root, second]);
}
for (const options of [
  { membership: { ...metadata, selectedProjectId: "same" }, expected: same },
  { pending: same, expected: same },
  { workspace: "d:\\PROJECTS\\SHARED\\", expected: multi },
]) {
  const view = mountProjectContext(options);
  await view.send();
  assert.equal(view.calls.find(c => c[0] === "thread/start")[1].projectId, options.expected.serverProjectId);
}
for (const options of [
  { workspace: "D:/legacy" },
  { membership: { ...metadata, selectedProjectId: null } },
  { membership: { ...metadata, selectedProjectId: "deleted" } },
]) {
  const view = mountProjectContext(options); await view.send();
  const start = view.calls.find(c => c[0] === "thread/start")[1];
  assert.equal(start.projectId, undefined, "legacy paths and invalid selection must not guess an entity by cwd");
  assert.equal(start.runtimeWorkspaceRoots, undefined);
}
{
  const view = mountProjectContext({ membership: { ...metadata, localProjects: [{ ...multi, serverProjectId: null }] } });
  await view.send();
  assert.equal(view.calls.some(c => c[0] === "thread/start" || c[0] === "turn/start"), false);
  assert.equal(view.state.promptInput, "hello");
  assert.ok(view.calls.some(c => c[0] === "toast"));
}
{
  const view = mountProjectContext({ threadId: "existing", workspace: "D:/unrelated", pending: multi, worktree: true });
  await view.send();
  assert.equal(view.calls.some(c => c[0] === "thread/start"), false);
  const turn = view.calls.find(c => c[0] === "turn/start")[1];
  assert.equal(turn.threadId, "existing");
  assert.equal(turn.cwd, undefined, "existing conversation must inherit its runtime cwd, not the sidebar project");
  assert.equal(turn.runtimeWorkspaceRoots, undefined);
  assert.equal(view.calls.some(c => c[0] === "git_worktree_create"), false, "existing sends must not create another worktree");
}
{
  const view = mountProjectContext({ worktree: true });
  await view.send();
  assert.equal(view.calls.filter(c => c[0] === "git_worktree_create").length, 1);
  for (const method of ["thread/start", "turn/start"]) {
    const params = view.calls.find(c => c[0] === method)[1];
    assert.equal(params.cwd, "D:/worktree");
    assert.deepEqual(params.runtimeWorkspaceRoots, ["D:/worktree", second]);
  }
}
{
  const view = mountProjectContext();
  await view.goal("test objective");
  const starts = view.calls.filter(c => c[0] === "thread/start");
  assert.equal(starts.length, 1, "goal creation and immediate send must share the newly created thread before React commits");
  assert.equal(starts[0][1].projectId, multi.serverProjectId);
  assert.deepEqual(starts[0][1].runtimeWorkspaceRoots, [root, second]);
  assert.equal(view.calls.find(c => c[0] === "goalSet")[1], "created");
  assert.equal(view.calls.find(c => c[0] === "turn/start")[1].threadId, "created");
}
console.log("PASS production send/goal callbacks: restored selected entity, shared-root identity, explicit draft precedence, legacy isolation, missing mapping and single goal-created thread (L2)");
