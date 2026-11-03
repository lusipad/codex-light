import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

const source = fs.readFileSync("src/components/WorktreesView.tsx", "utf8");
const appSource = fs.readFileSync("src/App.tsx", "utf8");
const app = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let props, send;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === "WorktreesView") {
    props = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(app), attr.initializer?.expression]));
  }
  if (ts.isIfStatement(node) && node.expression.getText(app) === "!currentThreadId && useWorktree && targetCwd") send = node.expression;
  ts.forEachChild(node, visit);
}
visit(app);
const execute = (text, context) => vm.runInNewContext(ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText, context);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const row = path => ({ path, gitDir: path, branch: "main" });

function mount(root, options = {}) {
  const slots = [], effects = [], requests = [];
  const listeners = new Map();
  const confirmations = [], removals = [];
  let cursor = 0, mounted = true, tree;
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; if (mounted) render(); }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback) { cursor++; if (!mountedOnce) effects.push(callback); },
  };
  const invoke = (method, args) => {
    const pending = deferred(); requests.push({ method, args, ...pending });
    if (options.autoIO) {
      if (method === "git_worktrees_list") pending.resolve([{ ...row("isolated-checkout"), gitDir: "isolated-source", isPrimary: false }]);
      else if (method === "git_branches") pending.resolve(["main"]);
      else if (method === "worktree_preferences_read") Promise.resolve().then(() => options.preferences()).then(pending.resolve, pending.reject);
      else pending.reject(Error(method));
    }
    return pending.promise;
  };
  const client = {};
  execute(fs.readFileSync("src/worktreeCreation.ts", "utf8"), { exports: client, require: () => ({ tauriInvoke: invoke,
    tauriListen: async (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); },
  }), crypto: { randomUUID: () => "context-worktree-operation" } });
  const context = { exports: {}, setTimeout: options.autoIO ? () => 0 : setTimeout, clearTimeout, confirm: text => { confirmations.push(text); return options.confirm ?? true; }, AbortController,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "lucide-react") return {};
      if (name === "../bridge") return { tauriInvoke: invoke };
      if (name === "../worktreeCreation") return client;
      if (name === "../worktreeRemoval") return {
        loadWorktreeConversations: async () => [],
        cwdInWorktree: () => false,
        removeWorktreeWithConversations: async (...args) => { removals.push(args); if (options.autoIO) return { warnings: [] }; throw Error("Unexpected deletion in context test"); },
      };
      throw Error(`Unexpected import ${name}`);
    },
  };
  let mountedOnce = false;
  execute(source, context);
  function render() { cursor = 0; tree = context.exports.WorktreesView({ activeWorkspaceRoot: root, onStartChatInWorktree() {} }); }
  render(); mountedOnce = true;
  const cleanups = effects.map(effect => effect());
  function find(node, predicate) {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of node.children ?? []) { const found = find(child, predicate); if (found) return found; }
  }
  return { requests, state: slots, confirmations, removals,
    refresh: () => find(tree, node => node.tag === "button" && node.children.some(child => typeof child === "string" && child.trim() === "刷新列表")).props.onClick(),
    create: () => find(tree, node => node.tag === "button" && node.props.className === "primary-btn").props.onClick(),
    button: label => find(tree, node => node.tag === "button" && node.children.includes(label)),
    delete: () => find(tree, node => node.tag === "button" && node.props.className === "danger-btn-sm").props.onClick(),
    changeRoot: value => { root = value; render(); },
    emit: progress => listeners.get("worktree:create-progress")?.(progress),
    listeners,
    unmount() { mounted = false; cleanups.forEach(cleanup => cleanup?.()); },
  };
}

{
  let enabled = true, cwd;
  const entryCalls = [];
  await execute(`(${props.onStartChatInWorktree.getText(app)})("W")`, {
    navigationRequestRef: { current: 0 },
    tauriInvoke: async (method, args) => { entryCalls.push([method, args]); return [{ path: args.path, active: true }]; },
    setWorkspaces: value => { assert.equal(value[0].path, "W"); },
    setUseWorktree: value => { enabled = value; }, startNewThread: value => { cwd = value; }, showAppToast() {},
  });
  assert.equal(entryCalls[0][0], "workspace_add");
  assert.equal(entryCalls[0][1].path, "W");
  assert.equal(entryCalls[0][1].setActive, false, "WC01: registration must not activate before navigation is rechecked");
  assert.equal(cwd, "W");
  assert.equal(execute(send.getText(app), { currentThreadId: null, useWorktree: enabled, targetCwd: cwd }), false,
    "WC01: existing worktree must not enter worktree creation on first send");
  const sending = mountProjectContext({
    workspace: cwd, worktree: enabled,
    membership: { selectedProjectId: null, localProjects: [], threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {} },
  });
  await sending.send();
  assert.equal(sending.calls.some(call => call[0] === "git_worktree_create"), false);
  assert.equal(sending.calls.find(call => call[0] === "thread/start")?.[1].cwd, "W",
    "WC01: production send uses selected existing directory");
  let selected;
  execute(`(${props.onSelectThread.getText(app)})("thread-W")`, { selectThread: id => { selected = id; } });
  assert.equal(selected, "thread-W", "WC02: bound chat must use complete selector");
  assert.equal(execute(props.key.getText(app), { activeWorkspace: { path: "A" } }), "A", "WC04: context key isolates mounts");
}
{
  const navigationRequestRef = { current: 0 }, pending = deferred(), opened = [], notices = [];
  const context = {
    navigationRequestRef, tauriInvoke: () => pending.promise, setWorkspaces: value => opened.push(value),
    setUseWorktree() {}, startNewThread: value => opened.push(value), showAppToast: text => notices.push(text),
  };
  const entry = execute(`(${props.onStartChatInWorktree.getText(app)})`, context);
  const opening = entry("W"); ++navigationRequestRef.current;
  pending.resolve([{ path: "W" }]); await opening;
  assert.equal(opened.length, 0, "WC01: late registration must not navigate away from newer selection");
  context.tauriInvoke = async () => { throw Error("registration denied"); };
  await entry("W");
  assert.equal(opened.length, 0);
  assert.ok(notices.at(-1).includes("registration denied"), "WC01: registration failure preserves current view");
}
{
  const view = mount("A");
  const latest = view.refresh();
  view.requests[1].resolve([row("A-new")]); await flush();
  view.requests[2].resolve(["new"]); await latest;
  view.requests[0].resolve([row("A-old")]); await flush();
  assert.equal(view.state[0][0].path, "A-new", "WC03: stale list is ignored");
  assert.equal(view.requests.length, 3, "WC03: stale list cannot issue branches request");
  const older = view.refresh();
  view.requests[3].resolve([row("A-mid")]); await flush();
  const newer = view.refresh();
  view.requests[5].resolve([row("A-final")]); await flush();
  view.requests[6].resolve(["final"]); await newer;
  view.requests[4].resolve(["old"]); await older;
  assert.equal(view.state[1][0], "final", "WC03: stale branches are ignored");
  const failure = view.refresh(), success = view.refresh();
  view.requests[8].resolve([row("A-ok")]); await flush(); view.requests[9].resolve(["ok"]); await success;
  view.requests[7].reject(Error("old failure")); await failure;
  assert.equal(view.state[6], null, "WC03: stale error is ignored");
  view.unmount();
}
{
  const oldA = mount("A"); oldA.unmount();
  const b = mount("B");
  assert.equal(b.state[0].length, 0, "WC04: B initially has no A rows");
  oldA.requests[0].resolve([row("A-old")]); await flush();
  assert.equal(oldA.requests.length, 1, "WC04: unmounted list cannot continue branches");
  b.requests[0].reject(Error("B failure")); await flush(); b.unmount();
  const newA = mount("A");
  assert.equal(newA.state[0].length, 0, "WC04: A to B to A does not reuse old mount");
  const writing = newA.create(); await flush(); newA.unmount();
  assert.equal(newA.requests[1].args.operationId, "context-worktree-operation", "creation uses a dedicated operation identity");
  assert.equal(newA.requests[2].method, "git_worktree_create_cancel");
  assert.equal(newA.requests[2].args.operationId, newA.requests[1].args.operationId, "unmount cancels precisely the operation that was started");
  newA.requests[2].resolve();
  newA.requests[1].resolve(row("created")); await writing;
  assert.equal(newA.requests.length, 3, "WC05: canceled completed old write cannot refresh after unmount");
}
{
  const view = mount("refresh-fixture"), writing = view.create(); await flush();
  assert.equal(view.requests[1].method, "git_worktree_create");
  view.emit({ operationId: "foreign-operation", phase: "upstream-refresh" });
  assert.equal(view.button("跳过更新"), undefined, "foreign progress must not reveal a skip control");
  view.emit({ operationId: "context-worktree-operation", phase: "upstream-refresh", text: "isolated fetch output" });
  assert.equal(view.button("跳过更新").props.disabled, false);
  view.button("跳过更新").props.onClick(); view.button("跳过更新").props.onClick();
  assert.equal(view.requests.filter(request => request.method === "git_worktree_refresh_skip").length, 1, "skip is one signal for this fetch");
  assert.equal(view.requests.some(request => request.method === "git_worktree_create_cancel"), false, "skip must not cancel creation");
  assert.equal(view.requests[2].args.operationId, view.requests[1].args.operationId);
  view.requests[2].resolve();
  view.emit({ operationId: "context-worktree-operation", phase: "creating" });
  assert.equal(view.button("跳过更新"), undefined, "skip is shown only during upstream-refresh phase");
  view.button("取消创建 / 设置").props.onClick();
  assert.equal(view.requests[3].method, "git_worktree_create_cancel", "main cancel still uses creation signal");
  view.requests[3].resolve(); view.unmount(); const before = view.state.slice();
  view.emit({ operationId: "context-worktree-operation", phase: "upstream-refresh", text: "late output" });
  assert.deepEqual(view.state, before, "canceled/unmounted progress must not change state");
  view.requests[1].resolve(row("ignored-late-create")); await writing;
  assert.equal(view.listeners.size, 0, "native progress listener is released after operation");
}
for (const enabled of [true, false]) {
  const view = mount("delete-scope", { autoIO: true, confirm: false, preferences: async () => ({ hostId: "local", preferences: { confirmBeforeDelete: enabled } }) });
  await flush(); await view.delete();
  assert.equal(view.requests.filter(request => request.method === "worktree_preferences_read").length, 1);
  assert.equal(view.confirmations.length, enabled ? 1 : 0);
  assert.equal(view.removals.length, enabled ? 0 : 1, "only explicit false skips manual confirmation; cancel retains worktree");
  view.unmount();
}
{
  const view = mount("delete-scope", { autoIO: true, preferences: async () => { throw Error("preference read denied"); } });
  await flush(); await view.delete();
  assert.equal(view.removals.length, 0); assert.equal(view.confirmations.length, 0);
  assert.match(view.state[6], /preference read denied/); view.unmount();
}
{
  const preference = deferred(), view = mount("old-delete-scope", { autoIO: true, preferences: () => preference.promise });
  await flush(); const first = view.delete(); const second = view.delete(); await flush();
  assert.equal(view.requests.filter(request => request.method === "worktree_preferences_read").length, 1, "read phase must own the deletion singleflight lock");
  view.changeRoot("new-delete-scope"); preference.resolve({ hostId: "local", preferences: { confirmBeforeDelete: false } });
  await first; await second;
  assert.equal(view.removals.length, 0); assert.equal(view.confirmations.length, 0, "late preference response must not act in a changed context");
  view.unmount();
}
console.log("WC01–WC05 worktree context regressions passed");
