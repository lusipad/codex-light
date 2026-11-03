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

function mount(root) {
  const slots = [], effects = [], requests = [];
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
  const context = { exports: {}, setTimeout, clearTimeout, confirm: () => true,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "lucide-react") return {};
      if (name === "../bridge") return { tauriInvoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; } };
      if (name === "../worktreeRemoval") return {
        loadWorktreeConversations: async () => [],
        cwdInWorktree: () => false,
        removeWorktreeWithConversations: async () => { throw Error("Unexpected deletion in context test"); },
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
  return { requests, state: slots,
    refresh: () => find(tree, node => node.tag === "button" && node.children.some(child => typeof child === "string" && child.trim() === "刷新列表")).props.onClick(),
    create: () => find(tree, node => node.tag === "button" && node.props.className === "primary-btn").props.onClick(),
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
  const writing = newA.create(); newA.unmount();
  newA.requests[1].resolve(row("created")); await writing;
  assert.equal(newA.requests.length, 2, "WC05: completed old write cannot refresh after unmount");
}
console.log("WC01–WC05 worktree context regressions passed");
