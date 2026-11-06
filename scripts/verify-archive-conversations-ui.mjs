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
const cloudWrites = [];
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
    if (name === "../chatgptService") return { unarchiveCloudItem: (...args) => { cloudWrites.push(args); }, deleteCloudArchiveItem: (...args) => { cloudWrites.push(args); } };
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
const ids = tree => nodes(tree, cls("archive-row")).map(node => node.props.key?.replace(/^local:/, ""));
const filter = tree => nodes(tree, node => node.type?.name === "ArchiveFilterMenu")[0];
const project = tree => nodes(tree, node => node.props?.id === "archive-project-filter")[0];
render(); for (const effect of effects) effect(); mounted = true;
for (let i=0;i<8;i++) await Promise.resolve();
let taskMore = 0, conversationMore = 0, conversationRetry = 0;
props.projectMembership = { ...props.projectMembership, threadProjectAssignments: { a: { projectKind: "local", projectId: "one" } } };
props.cloudArchive = { items: [{ source: "cloud-task", id: "a", title: "任务 A", createdAt: 200, updatedAt: 200, displayTime: 200, environmentLabel: "Environment" }], identity: { accountId: "a", userId: "u", generation: 1 }, status: "ready", error: null, loadingMore: false, pageError: null, nextCursor: "next", httpEmptyStatus: null, reload() {}, loadMore: () => { taskMore++; }, retryListeners() {} };
props.conversationArchive = { items: [{ source: "chatgpt-conversation", id: "a", title: "会话 A", createdAt: 300, updatedAt: 300, displayTime: "2026-11-06T00:00:00Z", gizmoId: "one" }, { source: "chatgpt-conversation", id: "b", title: "server ID 不猜关联", createdAt: 400, updatedAt: 400, displayTime: "invalid", gizmoId: "server-one" }], identity: props.cloudArchive.identity, status: "ready", error: null, loadingMore: false, pageError: null, nextOffset: 0, includeWorkCloud: true, reload() {}, loadMore: () => { conversationMore++; }, retryListeners: () => { conversationRetry++; } };
const keys = tree => nodes(tree, cls("archive-row")).map(node => node.props.key);
let tree = render();
assert.equal(nodes(tree, cls("archive-conversation-row")).length, 2, "CV01: actual production projection includes conversations");
for(const key of ["local:a", "cloud-task:a", "chatgpt-conversation:a"]) assert.ok(keys(tree).includes(key), "CV01: three source IDs stay independent");
project(tree).props.onChange("project:local::one"); tree = render();
assert.deepEqual(keys(tree), ["chatgpt-conversation:a", "cloud-task:a", "local:a"], "CV02: exact entity gizmo matches; server project ID cannot match");
const savedMembership = props.projectMembership;
props.projectMembership = { ...savedMembership, projectlessThreadIds: [...savedMembership.projectlessThreadIds, "a"] }; tree = render();
assert.deepEqual(keys(tree), ["chatgpt-conversation:a"], "CV02: conversation uses gizmo directly, not local/task assignment/projectless state");
props.projectMembership = savedMembership; tree = render();
const taskState = props.cloudArchive;
props.cloudArchive = { ...taskState, status: "error", identity: null, items: [], error: "task-source-error" }; tree = render();
assert.ok(keys(tree).includes("chatgpt-conversation:a") && keys(tree).includes("local:a"), "CV03: task failure cannot erase successful conversation/local sources");
props.cloudArchive = taskState; tree = render();
const row = nodes(tree, cls("archive-conversation-row"))[0];
assert.equal(nodes(row, n => n.type === "a").length, 0, "CV03: absent internal ChatGPT page cannot be replaced with browser/local thread navigation");
for(const button of nodes(row, n => n.type === "button")) { assert.equal(button.props.disabled, true, "CV: untrusted reader cannot enable writes"); button.props.onClick(); }
assert.ok(text(tree).includes("ChatGPT 会话页面")); assert.ok(!text(tree).includes("ChatGPT 会话归档尚未接入"));
props.conversationArchive = { ...props.conversationArchive, items: props.conversationArchive.items.map(item => item.id === "a" ? { ...item, updatedAt: 50 } : item) }; tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a", "chatgpt-conversation:a", "local:a"], "CV04: changed source array invalidates memo without filter/sort toggles");
const more = nodes(tree, n => n.type === "button" && text(n) === "加载更多 ChatGPT 会话")[0]; more.props.onClick(); assert.equal(conversationMore, 1); assert.equal(taskMore, 0, "CV05: offset paging independent from cursor paging");
props.conversationArchive = { ...props.conversationArchive, pageError: "conversation-page-failure" }; tree = render();
nodes(tree, n => n.type === "button" && text(n) === "重试加载 ChatGPT 会话")[0].props.onClick(); assert.equal(conversationMore, 2);
nodes(tree, n => n.type === "button" && text(n) === "加载更多云端任务")[0].props.onClick(); assert.equal(taskMore, 1); assert.equal(conversationMore, 2);
props.conversationArchive = { ...props.conversationArchive, status: "error", identity: null, items: [], error: "conversation-failure", pageError: null }; tree = render();
assert.deepEqual(keys(tree), ["cloud-task:a", "local:a"], "CV06: conversation failure retains task/local successes");
assert.ok(text(tree).includes("conversation-failure")); nodes(tree, n => n.type === "button" && text(n) === "重试 ChatGPT 会话归档")[0].props.onClick(); assert.equal(conversationRetry, 1);
filter(tree).props.onKindFilterChange("local"); tree = render(); assert.ok(!text(tree).includes("conversation-failure"));
filter(tree).props.onKindFilterChange("cloud"); props.conversationArchive = { ...props.conversationArchive, status: "denied", error: null }; tree = render();
assert.ok(text(tree).includes("当前账号无权读取 ChatGPT 会话归档")); assert.deepEqual(keys(tree), ["cloud-task:a"], "CV06: denied conversation never hides available tasks");
props.cloudArchive = { ...props.cloudArchive, items: [], nextCursor: null }; tree = render();
assert.equal(nodes(tree, cls("archive-empty")).length, 0, "CV06: denied conversation source must not become an empty read success");
assert.equal(nodes(tree, n => n.type === "footer").length, 0);
assert.deepEqual(writes, [], "CV07: three-source projection and read-only controls never invoke local writes");
props.surface = "global"; tree = render(); assert.equal(nodes(tree, cls("archive-conversation-row")).length, 0); assert.equal(filter(tree), undefined);
console.log("PASS CV01–CV07: actual three-source projection, exact gizmo identity, independent source failures/paging, no navigation or mutations, legacy isolation");

assert.deepEqual(cloudWrites, [], "Untrusted reader direct handlers never call cloud writes");
assert.equal(nodes(render(), n => n.type?.name === "CloudArchiveDeleteDialog").length, 0, "Untrusted reader cannot open cloud delete confirmation");
