import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/ArchiveView.tsx", "utf8");
const rows = [
  { id: "a", name: "Zulu", updatedAt: 20, createdAt: 40, cwd: "D:/One" },
  { id: "b", name: "Alpha", updatedAt: 20, createdAt: 30, cwd: "D:/Two" },
  { id: "c", name: "Alpha", updatedAt: 10, createdAt: 50, cwd: "D:/One/child" },
  { id: "d", name: "Delta", updatedAt: 0, createdAt: 60, cwd: "D:/One" },
];
let reply = rows, reads = 0;
const writes = [], slots = [], effects = [];
let cursor = 0, mounted = false;
const React = {
  createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } }; },
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef(initial) { return slots[cursor++] ??= { current: initial }; },
  useMemo(fn, dependencies) { const i = cursor++, previous = slots[i]; if (!previous || dependencies.some((v,j) => !Object.is(v, previous.dependencies[j]))) slots[i] = { dependencies, value: fn() }; return slots[i].value; },
  useCallback(fn, dependencies) { return React.useMemo(() => fn, dependencies); },
  useDeferredValue(value) { return value; },
  useEffect(fn) { if (!mounted) effects.push(fn); }, useLayoutEffect() {},
};
const output = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText + "\nexports.TestMenu = ArchiveFilterMenu;", {
  exports: output, console, Date, Intl, Set, Map, document: { body: {} },
  require(name) {
    if (name === "react") return { ...React, default: React };
    if (name === "../bridge") return { callAppServer: async (method, params) => { assert.equal(method, "thread/list"); assert.equal(params.archived, true); reads++; return { data: reply, nextCursor: null }; } };
    if (name.endsWith(".css")) return {};
    if (name === "../sidebarProjects") {
      const module = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarProjects.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: module });
      return module;
    }
    if (name === "react-dom") return { createPortal: node => node };
    return new Proxy({}, { get: (_, key) => key });
  },
});
const props = {
  surface: "settings", workspaces: [], workspaceHints: {},
  projectMembership: { localProjects: [
    { id: "one", name: "Same", rootPaths: ["D:/One", "D:/Extra"], createdAt: 1, serverProjectId: "server-one" },
    { id: "two", name: "Same", rootPaths: ["D:/Two"], createdAt: 2 },
  ], threadProjectAssignments: {}, projectlessThreadIds: ["d"], workspaceProjectAssignments: {} },
  onSelectThread() {}, onUnarchive: async thread => { writes.push(["restore", thread.id]); reply = reply.filter(t => t.id !== thread.id); },
  onDelete: async () => ({ deletedThreadIds: [], error: null }), onDeleteAll: async () => ({ deletedThreadIds: [], error: null }),
};
const render = () => { cursor = 0; return output.ArchiveView(props); };
const nodes = (tree, predicate) => { const list = []; const walk = n => { if (!n || typeof n !== "object") return; if (predicate(n)) list.push(n); for (const child of n.props?.children || []) walk(child); }; walk(tree); return list; };
const cls = value => node => node.props?.className?.split(" ").includes(value);
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : (node?.props?.children || []).map(text).join("");
const ids = tree => nodes(tree, cls("archive-row")).map(node => node.props.key);
const filter = tree => nodes(tree, node => node.type?.name === "ArchiveFilterMenu")[0];
const project = tree => nodes(tree, node => node.props?.id === "archive-project-filter")[0];
render(); for (const effect of effects) effect(); mounted = true;
for (let i=0;i<8;i++) await Promise.resolve();
let pageReads = 0, reloads = 0, listenerRetries = 0;
props.projectMembership = { ...props.projectMembership, threadProjectAssignments: { a: { projectKind: "local", projectId: "one" } } };
props.workspaceHints = { c: "D:/Extra" };
props.cloudArchive = {
  items: [{ source: "cloud-task", id: "a", title: "Cloud Alpha", createdAt: 90, updatedAt: 100, displayTime: 100, environmentLabel: "Linux Build" },
    { source: "cloud-task", id: "c", title: "Zulu task", createdAt: 22, updatedAt: 25, displayTime: 25, environmentLabel: "Other Env" }],
  identity: { accountId: "account-a", userId: "user-a", generation: 1 }, status: "ready", error: null,
  loadingMore: false, pageError: null, nextCursor: "", httpEmptyStatus: null,
  reload: () => { reloads++; }, loadMore: () => { pageReads++; }, retryListeners: () => { listenerRetries++; },
};
const keys = tree => nodes(tree, cls("archive-row")).map(node => node.props.key);
let tree = render();
assert.equal(nodes(tree, cls("archive-cloud-row")).length, 2, "AC01: cloud tasks are part of the real mixed projection");
assert.ok(keys(tree).includes("local:a") && keys(tree).includes("cloud-task:a"), "AC01: source+id prevents collisions");
project(tree).props.onChange("project:local::one"); tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a", "local:a", "local:c"], "AC02: explicit task assignment; local hint allowed, task hint forbidden");
filter(tree).props.onSortKeyChange("created"); tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a", "local:c", "local:a"], "AC02: created sorting spans both sources");
filter(tree).props.onSortKeyChange("alphabetical"); tree = render();
assert.deepEqual(keys(tree), ["local:c", "cloud-task:a", "local:a"], "AC02: alphabetical projection spans both sources");
const initialCloudState = props.cloudArchive;
props.cloudArchive = { ...props.cloudArchive, items: props.cloudArchive.items.map(task => task.id === "a" ? { ...task, title: "Alpha" } : task) };
tree = render(); assert.deepEqual(keys(tree), ["cloud-task:a", "local:c", "local:a"], "AC02: same-title cross-source tie uses updated descending");
props.cloudArchive = initialCloudState; filter(tree).props.onSortKeyChange("updated"); tree = render();
filter(tree).props.onKindFilterChange("cloud"); tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a"]);
project(tree).props.onChange("all"); tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a", "cloud-task:c"]);
const cloudRows = nodes(tree, cls("archive-cloud-row"));
for (const row of cloudRows) {
  assert.equal(nodes(row, n => n.type === "a").length, 0);
  assert.equal(nodes(row, n => n.props?.className?.includes("danger")).length, 0);
  const restore = nodes(row, n => n.type === "button")[0]; assert.equal(restore.props.disabled, true); assert.equal(restore.props.onClick, undefined);
}
assert.ok(text(tree).includes("ChatGPT 会话归档尚未接入"));
project(tree).props.onChange("project:local::one"); tree = render();
assert.ok(text(tree).includes("Linux Build"), "AC03: single-group cloud description uses environment label");
const dateState = props.cloudArchive;
props.cloudArchive = { ...dateState, items: dateState.items.map(task => task.id === "a" ? { ...task, createdAt: null, updatedAt: null, displayTime: "2026-11-06T00:30:00Z" } : task) };
tree = render();
assert.ok(text(nodes(nodes(tree, n => n.props?.key === "cloud-task:a")[0], cls("archive-row-meta"))[0]).includes("2026"), "AC03: ISO display time is parsed separately from finite-number sorting");
project(tree).props.onChange("all"); tree = render();
assert.deepEqual(keys(tree), ["cloud-task:c", "cloud-task:a"], "AC03: ISO display time does not become a numeric sort timestamp");
props.cloudArchive = { ...dateState, items: dateState.items.map(task => task.id === "a" ? { ...task, updatedAt: null, createdAt: 90, displayTime: "invalid-date" } : task) };
tree = render();
assert.equal(text(nodes(nodes(tree, n => n.props?.key === "cloud-task:a")[0], cls("archive-row-meta"))[0]), "", "AC03: invalid chosen cloud updated display value must not fall back to creation");
props.cloudArchive = dateState; tree = render();
nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "Linux Build" } }); tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a"], "AC03: environment search");
nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "" } });
props.cloudArchive = { ...props.cloudArchive, items: props.cloudArchive.items.map(t => t.id === "c" ? { ...t, updatedAt: 200 } : t) }; tree = render();
assert.deepEqual(keys(tree), ["cloud-task:c", "cloud-task:a"], "AC04: real props update invalidates sort memo");
const more = nodes(tree, n => n.type === "button" && text(n) === "加载更多云端任务")[0]; assert.ok(more, "AC05: empty cursor is still a real next page"); more.props.onClick(); assert.equal(pageReads, 1);
props.cloudArchive = { ...props.cloudArchive, loadingMore: true }; tree = render(); assert.equal(nodes(tree, n => n.type === "button" && text(n) === "正在加载云端任务…")[0].props.disabled, true);
props.cloudArchive = { ...props.cloudArchive, loadingMore: false };
props.cloudArchive = { ...props.cloudArchive, pageError: "page failed" }; tree = render(); assert.ok(text(tree).includes("page failed"));
nodes(tree, n => n.type === "button" && text(n) === "重试加载云端任务")[0].props.onClick(); assert.equal(pageReads, 2);
filter(tree).props.onKindFilterChange("all"); props.cloudArchive = { ...props.cloudArchive, status: "error", error: "listener failed", identity: null, items: [] }; tree = render();
assert.ok(text(tree).includes("listener failed")); assert.equal(keys(tree).length, 4, "AC06: local success survives cloud source error");
nodes(tree, n => n.type === "button" && text(n) === "重试云端归档")[0].props.onClick(); assert.equal(listenerRetries, 1);
filter(tree).props.onKindFilterChange("local"); tree = render(); assert.ok(!text(tree).includes("listener failed"), "AC06: local mode hides unrelated cloud faults");
filter(tree).props.onKindFilterChange("cloud"); props.cloudArchive = { ...props.cloudArchive, status: "signed_out", error: null }; tree = render();
assert.ok(text(tree).includes("登录")); assert.equal(nodes(tree, cls("archive-empty")).length, 0); assert.equal(nodes(tree, n => n.type === "footer").length, 0, "AC07: signed out is not a successful empty count");
assert.equal(reads, 1, "AC08: pure source projection never reloads the local backend");
assert.deepEqual(writes, [], "AC08: cloud rows/sort/filter/load-more never call local mutations");
props.cloudArchive = initialCloudState; filter(tree).props.onKindFilterChange("all"); tree = render();
const localSameIdRow = nodes(tree, n => n.props?.key === "local:a")[0];
await nodes(localSameIdRow, n => n.type === "button" && text(n) === "取消归档")[0].props.onClick();
for(let i=0;i<12;i++) await Promise.resolve(); tree = render();
assert.ok(keys(tree).includes("cloud-task:a") && !keys(tree).includes("local:a"), "AC08: local restore readback cannot remove the cloud task with the same ID");
assert.deepEqual(writes, [["restore", "a"]]);
props.surface = "global"; tree = render(); assert.equal(nodes(tree, cls("archive-cloud-row")).length, 0); assert.equal(filter(tree), undefined);
console.log("PASS AC01–AC08: production mixed-source projection, composite IDs, task assignment, source state, paging actions and read-only mutation boundary");
