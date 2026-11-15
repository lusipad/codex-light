import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function mount(project) {
  let cursor = 0, tree, closed = 0;
  const slots = [], effects = [], layouts = [], saves = [], cleanups = [], layoutCleanups = [], focus = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; }, useEffect(effect) { effects.push(effect); },
    useLayoutEffect(effect) { layouts.push(effect); },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync("src/components/ProjectEditDialog.tsx", "utf8")), {
    exports: module.exports, document: { activeElement: { isConnected: true, focus() { focus.push("trigger"); } } },
    require: name => name === "react" ? react : name === "../bridge" ? {
      isTauriRuntime: () => false, tauriInvoke: async () => ["D:/fixture-root", "D:/second-root"],
    } : name === "../fsClient" ? { baseNameFsPath: path => path.split("/").pop() } : {},
  });
  const props = { project, onSave: async patch => saves.push(patch), onClose() { closed++; }, onRemove() { throw Error("create must never remove a project"); } };
  const render = () => {
    cursor = 0; tree = module.exports.ProjectEditDialog(props);
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current ??= {
      showModal() {}, close() {}, querySelector() {}, focus() {}, isConnected: true,
    };
  };
  render();
  for (const effect of layouts.splice(0)) layoutCleanups.push(effect());
  for (const effect of effects.splice(0)) cleanups.push(effect());
  return { render, saves, find: predicate => nodes(tree).find(predicate), get closed() { return closed; },
    unmountBeforeFrame() {
      for (const cleanup of layoutCleanups) cleanup?.();
      focus.push("composer");
      for (const cleanup of cleanups) cleanup?.();
      return focus.at(-1);
    } };
}

const create = mount(undefined);
assert.equal(text(create.find(node => node.type === "h2")), "新建项目");
assert.equal(create.find(node => node.type === "input").props.value, "");
assert.equal(create.find(node => node.type === "button" && text(node) === "移除本地项目"), undefined);
create.find(node => node.type === "input").props.onChange({ target: { value: "Created from home" } }); create.render();
create.find(node => node.type === "button" && text(node) === "添加文件夹").props.onClick(); await flush(); create.render();
create.find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await flush();
assert.equal(create.saves.length, 1);
assert.equal(create.saves[0].name, "Created from home");
assert.equal(create.saves[0].roots[0].path, "D:/fixture-root");
assert.equal(create.saves[0].roots[1].path, "D:/second-root");
assert.equal(create.closed, 1);
assert.equal(create.unmountBeforeFrame(), "composer", "dialog teardown must finish restoring its trigger before the parent's next-frame Composer focus");

const edit = mount({ name: "Existing", roots: [{ path: "D:/existing" }] });
assert.equal(text(edit.find(node => node.type === "h2")), "编辑项目");
edit.find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await flush();
assert.equal(edit.saves.length, 0, "unchanged existing project must not become a create or write");
assert.equal(edit.closed, 1);
console.log("PASS shared real project form: empty create draft, name/multiple-folder save, no remove action, existing-edit no-op");

const app = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let createCallback, refreshCallback, selectCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "handleCreateHomeProject") createCallback = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "refreshWorkspacesAndMeta") refreshCallback = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "handleSelectHomeProject") selectCallback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(app); assert.ok(createCallback);
function host({ create, register } = {}) {
  const calls = [], updates = [], frames = [], focused = [];
  const selected = { id: "server:p1", serverProjectId: "p1", name: "Created", rootPaths: ["D:/fixture-root", "D:/second-root"] };
  const response = { workspaces: [{ path: "D:/fixture-root", active: true }],
    projectMembership: { localProjects: [selected], selectedProjectId: selected.id } };
  const context = { homeProjectCreateKeyRef: { current: "stable-key" }, executionIdentityRef: { current: "account-A" },
    homeProjectCreatedRef: { current: null }, refreshWorkspaceGenerationRef: { current: 0 }, navigationRequestRef: { current: 0 },
    activeRouteRef: { current: "home" }, pendingNewThreadProjectRef: { current: null }, pendingProjectlessRef: { current: true },
    createProject: async (...args) => { calls.push(["create", ...args]); return create ? create(context) : { id: "p1" }; },
    tauriInvoke: async (...args) => { calls.push(args); return register ? register(response, context) : response; },
    fileDedupeKey: path => path.toLowerCase(), setWorkspaces: value => updates.push(value), setSidebarProjectMembership: value => updates.push(value),
    setProjectsRefreshToken() {}, setHomeProjectCreateKey: key => updates.push(key), requestAnimationFrame: frame => frames.push(frame),
    document: { hasFocus: () => true }, composerTextareaRef: { current: { focus: () => focused.push(true) } },
  };
  const run = vm.runInNewContext(compile(`(${createCallback.getText(app)})`), context);
  return { context, calls, updates, frames, focused, selected, response, run: () => run({ name: "Created", roots: [{ path: "D:/fixture-root" }, { path: "D:/second-root" }] }) };
}
{
  const view = host(); await view.run();
  assert.equal(view.calls[0][3], "stable-key");
  assert.equal(view.calls[1][0], "workspace_register_created_project");
  assert.equal(view.calls[1][1].projectId, "p1");
  assert.equal(view.context.pendingNewThreadProjectRef.current, view.selected);
  assert.equal(view.context.pendingProjectlessRef.current, false);
  assert.equal(view.context.homeProjectCreateKeyRef.current, null);
  view.frames.forEach(frame => frame()); assert.equal(view.focused.length, 1);
}
for (const options of [
  { create: async () => ({ id: "" }) },
  { register: async response => ({ ...response, projectMembership: { ...response.projectMembership, selectedProjectId: "other" } }) },
  { register: async () => { throw Error("readback failed"); } },
]) {
  const view = host(options); await assert.rejects(view.run());
  assert.equal(view.updates.length, 0); assert.equal(view.context.pendingProjectlessRef.current, true);
  assert.equal(view.context.homeProjectCreateKeyRef.current, "stable-key", "uncertain creation retains the same retry key");
}
for (const change of [context => { context.homeProjectCreateKeyRef.current = null; }, context => { context.executionIdentityRef.current = "account-B"; }]) {
  const view = host({ create: async context => { change(context); return { id: "p1" }; } }); await view.run();
  assert.equal(view.calls.length, 1, "late create may not register or select in a different draft/account");
  assert.equal(view.updates.length, 0);
}
{
  let failed = true;
  const view = host({ register: async response => { if (failed) throw Error("disk full"); return response; } });
  await assert.rejects(view.run()); failed = false; await view.run();
  assert.equal(view.calls.filter(call => call[0] === "create").length, 1, "confirmed creation retries only native registration, never another create");
  assert.equal(view.calls.filter(call => call[0] === "workspace_register_created_project").length, 2);
}
console.log("PASS real home create callback: stable idempotency, native confirmed selection, multi-root identity, failed readback and stale draft/account isolation");
{
  let finishMetadata;
  const view = host();
  Object.assign(view.context, { threadPinRevisionRef: { current: 0 }, projectPinRevisionRef: { current: 0 },
    setPinnedThreadIds() {}, setPinnedProjectIds() {}, setWorkspaceHints() {},
    tauriInvoke: async command => command === "workspace_list" ? [{ path: "D:/old", active: true }]
      : command === "threads_meta_get" ? new Promise(resolve => { finishMetadata = resolve; }) : view.response,
  });
  const refresh = vm.runInNewContext(compile(`(${refreshCallback.getText(app)})`), view.context);
  const old = refresh(); await flush(); assert.ok(finishMetadata);
  await view.run();
  finishMetadata({ projectMembership: { localProjects: [], selectedProjectId: null } }); await old;
  const workspaceUpdates = view.updates.filter(Array.isArray);
  assert.equal(workspaceUpdates.at(-1)[0].path, "D:/fixture-root", "an older workspace/meta refresh cannot replace the newly selected project");
}

function selectionHost({ catalogOnly = false, read } = {}) {
  const calls = [], updates = [], notices = [];
  const projects = ["A", "B"].map(id => ({ id, name: id, rootPaths: ["D:/shared"], serverProjectId: `service-${id}` }));
  const reply = id => ({ workspaces: [{ path: "D:/shared", active: true }], projectMembership: {
    selectedProjectId: id, localProjects: projects,
  } });
  const context = { homeProjectGroups: projects.map(entity => ({ id: entity.id, entity, serverProjectId: entity.serverProjectId })),
    sidebarProjectMembership: { localProjects: catalogOnly ? [] : projects }, workspaceSelectionRef: { current: 0 },
    executionIdentityRef: { current: "account-A" }, navigationRequestRef: { current: 0 }, refreshWorkspaceGenerationRef: { current: 0 },
    activeRouteRef: { current: "home" }, pendingNewThreadProjectRef: { current: null }, pendingProjectlessRef: { current: true },
    handleSelectWorkspace: path => calls.push(["legacy", path]), fileDedupeKey: path => path.toLowerCase(),
    tauriInvoke: async (command, params) => { calls.push([command, params]); return read ? read(params, reply) : reply(params.projectId.replace("service-", "")); },
    setWorkspaces: value => updates.push(value), setSidebarProjectMembership: value => updates.push(value),
    showAppToast: (...args) => notices.push(args),
  };
  return { context, calls, updates, notices, reply,
    run: vm.runInNewContext(compile(`(${selectCallback.getText(app)})`), context) };
}
for (const catalogOnly of [false, true]) {
  const view = selectionHost({ catalogOnly }); await view.run("D:/shared", "B");
  assert.equal(view.calls[0][0], catalogOnly ? "workspace_register_created_project" : "workspace_select_project");
  assert.equal(view.calls[0][1].projectId, catalogOnly ? "service-B" : "B");
  assert.equal(view.context.pendingNewThreadProjectRef.current.id, "B", "same-root projects select by real identity, not folder");
  assert.equal(view.context.pendingProjectlessRef.current, false);
}
{
  let release;
  const view = selectionHost({ read: () => new Promise(resolve => { release = resolve; }) });
  const pending = view.run("D:/shared", "B");
  view.context.navigationRequestRef.current++;
  release(view.reply("B")); await pending;
  assert.equal(view.context.pendingProjectlessRef.current, true, "late selection cannot attach to a new projectless draft on the same home route");
  assert.equal(view.updates.length, 0);
}
{
  let release;
  const view = selectionHost({ read: (params, reply) => params.projectId === "A"
    ? new Promise(resolve => { release = resolve; }) : reply("B") });
  const old = view.run("D:/shared", "A"); await view.run("D:/shared", "B");
  release(view.reply("A")); await old;
  assert.equal(view.context.pendingNewThreadProjectRef.current.id, "B", "the older selection cannot replace a newer same-root project");
}
console.log("PASS real home selection: same-root IDs, catalog registration, newer selection and same-route draft isolation");
