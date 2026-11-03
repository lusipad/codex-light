import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const parse = path => {
  const source = fs.readFileSync(path, "utf8");
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};
const page = parse("src/components/ProjectsIndexView.tsx"), app = parse("src/App.tsx");
const callbacks = {}, keyboard = [];
let appStart, loadEffect;
function walk(node, source) {
  if (source === page && ts.isVariableDeclaration(node) &&
      ["loadProjects", "handleStartChatInProject", "handleCreateProject"].includes(node.name.getText(source))) {
    const initial = node.initializer;
    callbacks[node.name.getText(source)] = ts.isCallExpression(initial) ? initial.arguments[0] : initial;
  }
  if (source === page && ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("++projectLoadRequestRef.current")) loadEffect = node.arguments[0];
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
    if (source === app && node.name.getText(source) === "onStartNewChatInProject") appStart = node.initializer.expression;
    if (source === page && node.name.getText(source) === "onKeyDown") keyboard.push(node.initializer.expression);
  }
  ts.forEachChild(node, child => walk(child, source));
}
walk(page, page); walk(app, app);
const execute = (node, source, context) => {
  assert.ok(node, "production callback must exist");
  return vm.runInNewContext(ts.transpileModule(`(${node.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const project = { id: "server-b", name: "B", roots: [{ path: "D:/shared" }, { path: "D:/second" }] };
const entities = [
  { id: "a", serverProjectId: "server-a", rootPaths: ["D:/shared"] },
  { id: "b", serverProjectId: "server-b", rootPaths: ["D:/shared", "D:/second"] },
];
const calls = [];
const start = execute(appStart, app, {
  sidebarProjectMembership: { localProjects: entities },
  startNewThread: (...args) => calls.push(args), showAppToast: (...args) => calls.push(["toast", ...args]),
});
const forward = execute(callbacks.handleStartChatInProject, page, {
  onStartNewChatInProject: start, notify() { throw Error("Unexpected missing roots"); },
});
forward(project);
assert.equal(calls[0][1], entities[1], "PI01: same root projects must retain the selected entity and all roots");
start("D:/shared", { ...project, id: "unknown" });
assert.equal(calls[1][0], "toast", "PI02: unknown identity must not fall back to a different project");
start("D:/legacy");
assert.deepEqual(calls[2], ["D:/legacy"]);
{
  const first = deferred(), second = deferred(), updates = [];
  const pending = [first, second];
  const ref = { current: 0 };
  const load = execute(callbacks.loadProjects, page, {
    projectLoadRequestRef: ref, listProjects: () => pending.shift().promise,
    setProjects: value => updates.push(["projects", value]), setLoadState: value => updates.push(["state", value]),
    console: { warn() {} },
  });
  const older = load(), latest = load();
  second.resolve([project]); await latest;
  first.reject(Error("old error")); await older;
  assert.deepEqual(updates, [["projects", [project]], ["state", "ready"]], "PI03: stale failure cannot erase the latest project list");
  const third = deferred();
  pending.push(third);
  const unmounted = load();
  const cleanup = execute(loadEffect, page, { loadProjects() {}, projectLoadRequestRef: ref })();
  cleanup();
  third.resolve([]); await unmounted;
  assert.equal(updates.length, 2, "PI04: invalidated load cannot write page state");
  const olderSuccess = deferred(), latestSuccess = deferred();
  pending.push(olderSuccess, latestSuccess);
  const fourth = load(), fifth = load();
  latestSuccess.resolve([{ ...project, name: "latest" }]); await fifth;
  olderSuccess.resolve([{ ...project, name: "stale" }]); await fourth;
  assert.equal(updates.length, 4);
  assert.equal(updates[2][1][0].name, "latest", "PI03: stale success cannot overwrite the latest project");
}
{
  const pending = deferred(), events = [];
  const context = {
    createPendingRef: { current: false }, draftName: " B ", draftRoots: ["D:/shared", "D:/second"],
    createProject: (...args) => { events.push(["create", ...args]); return pending.promise; },
    setFormError: value => events.push(["error", value]), setFormBusy: value => events.push(["busy", value]),
    resetCreateForm: () => events.push(["reset"]), loadProjects: async () => [project],
    onProjectsChanged: () => events.push(["changed"]), notify: (...args) => events.push(["notify", ...args]),
  };
  const create = execute(callbacks.handleCreateProject, page, context);
  const first = create(); await create();
  assert.equal(events.filter(event => event[0] === "create").length, 1, "PI05: repeated create is single-flight");
  pending.reject(Error("rejected")); await first;
  assert.equal(context.createPendingRef.current, false);
  assert.equal(events.some(event => event[0] === "reset"), false, "PI05: failed create retains form input");
  assert.match(events.find(event => event[0] === "error" && event[1])?.[1], /rejected/);
  context.createProject = async () => project;
  // The function closes over its VM context; replace through the context object before the next call.
  await create();
  assert.ok(events.some(event => event[0] === "reset"), "PI05: failure allows a successful retry");
}
assert.equal(keyboard.length, 2);
for (const node of keyboard) {
  const dispatched = [];
  const busy = { current: false };
  const keydown = execute(node, page, {
    createPendingRef: busy, handleCreateProject: () => dispatched.push("create"),
    handleAddManualRoot: () => dispatched.push("root"), resetCreateForm: () => dispatched.push("reset"),
  });
  for (const event of [
    { key: "Enter", nativeEvent: { isComposing: true } },
    { key: "Enter", keyCode: 229, nativeEvent: {} },
  ]) keydown({ ...event, preventDefault() {} });
  busy.current = true;
  keydown({ key: "Escape", nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(dispatched, [], "PI05–PI06: IME and busy keys cannot submit or discard the form");
}
console.log("PASS PI01–PI06 production project page: identity/all roots, unknown mapping, latest-only loads, single-flight retry, IME and busy Escape");
