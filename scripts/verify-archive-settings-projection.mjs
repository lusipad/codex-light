import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/ArchiveView.tsx", "utf8");
const rows = [
  { id: "a", name: "Zulu", updatedAt: 20, createdAt: 40, cwd: "D:/One", path: "D:\\unrelated-parent\\Cafe\u0301 独立记录 nonce hidden-tail.jsonl" },
  { id: "b", name: "Alpha", updatedAt: 20, createdAt: 30, cwd: "D:/Two", path: "D:/records/b.jsonl" },
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
    if (name === "../bridge") return { callAppServer: async (method, params) => { assert.equal(method, "thread/list"); assert.equal(params.archived, true); reads++; if (reply instanceof Error) throw reply; return { data: reply, nextCursor: null }; } };
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
const rowMeta = (tree, id) => text(nodes(nodes(tree, n => n.props?.key === `local:${id}`)[0], cls("archive-row-meta"))[0]);
const filter = tree => nodes(tree, node => node.type?.name === "ArchiveFilterMenu")[0];
const project = tree => nodes(tree, node => node.props?.id === "archive-project-filter")[0];
render(); for (const effect of effects) effect(); mounted = true;
for (let i=0;i<8;i++) await Promise.resolve();
let tree = render();
assert.ok(tree.props.className.includes("archive-settings"), "AS01: settings has an explicit isolated surface");
assert.equal(nodes(tree, cls("archive-title")).length, 0, "AS01: settings reuses the outer section heading without a duplicate inner title");
assert.equal(nodes(tree, cls("archive-subtitle")).length, 0);
assert.equal(filter(tree).props.sortKey, "updated");
assert.deepEqual(ids(tree), ["a", "b", "c", "d"], "AS02: groups by max updated, then label/id; per-row updated desc/title tie; zero is valid");
assert.doesNotMatch(rowMeta(tree, "b"), /•/, "AS14: group header already supplies context");
filter(tree).props.onSortKeyChange("alphabetical"); tree = render();
assert.deepEqual(ids(tree), ["c", "d", "a", "b"], "AS03: unnamed group first; names sort ascending, same label groups retain IDs");
filter(tree).props.onSortKeyChange("created"); tree = render();
assert.deepEqual(ids(tree), ["d", "c", "a", "b"]);
const options = project(tree).props.options;
assert.deepEqual(Array.from(options.filter(o => o.label === "Same"), o => o.title), ["D:/One\nD:/Extra", "D:/Two"]);
assert.equal(options.filter(o => o.label === "Same").length, 2, "AS04: duplicate labels retain separate identities");
const one = options.find(o => o.value === "project:local::one"); assert.ok(one);
project(tree).props.onChange(one.value); tree = render();
assert.deepEqual(ids(tree), ["a"], "AS04: child cwd is not a project match and explicit projectless wins");
assert.equal(nodes(tree, cls("archive-group-header")).length, 0, "AS04: selected project is one unheaded group");
props.workspaceHints = { c: "D:\\Extra\\" }; tree = render();
assert.deepEqual(ids(tree), ["c", "a"], "AS05: hint normalized exact multi-root match invalidates memo");
props.projectMembership = { ...props.projectMembership, threadProjectAssignments: { b: { projectKind: "local", projectId: "server-one" }, d: { projectKind: "local", projectId: "one" } } }; tree = render();
assert.deepEqual(ids(tree), ["c", "a", "b"], "AS05: server ID mapping; explicit projectless still overrides assignment");
filter(tree).props.onSortKeyChange("alphabetical"); tree = render();
assert.deepEqual(ids(tree), ["b", "c", "a"], "AS05: title ties use updated descending, no id/collator sort substitution");
filter(tree).props.onSortKeyChange("updated"); tree = render();
assert.deepEqual(ids(tree), ["b", "a", "c"], "AS05: selected group equal-time ties use title ascending");
filter(tree).props.onSortKeyChange("created");
const assignedHints = props.workspaceHints;
for (const hint of ["d:/extra/", "/mnt/d/extra", "/D:/Extra", String.raw`\\?\D:\Extra`, String.raw`\\wsl$\Ubuntu\mnt\d\EXTRA`]) {
  props.workspaceHints = { c: hint }; tree = render();
  assert.deepEqual(ids(tree), ["c", "a", "b"], `AS05: official identity normalization must resolve ${hint}`);
}
props.workspaceHints = assignedHints;
const assignedMembership = props.projectMembership;
props.projectMembership = { ...assignedMembership, localProjects: [...assignedMembership.localProjects, { id: "duplicate", name: "Same", rootPaths: ["D:/One", "D:/Extra"], createdAt: 3 }] };
tree = render(); assert.deepEqual(ids(tree), ["b"], "AS05: ambiguous exact root never chooses arbitrary first candidate; explicit assignment still resolves");
props.projectMembership = { ...assignedMembership, threadProjectAssignments: { ...assignedMembership.threadProjectAssignments, b: { projectKind: "remote", projectId: "one", hostId: "remote-a" } } };
tree = render(); assert.deepEqual(ids(tree), ["c", "a"], "AS05: remote ID cannot match local identity; fallback cwd matches its own project");
props.projectMembership = { ...assignedMembership, workspaceProjectAssignments: { a: null, b: { projectKind: "local", projectId: "two" } } };
tree = render(); assert.deepEqual(ids(tree), ["c"], "AS05: persisted workspace overrides supersede stale thread assignments and cwd");
props.projectMembership = { ...assignedMembership, localProjects: assignedMembership.localProjects.map(project => project.id === "one" ? { ...project, rootPaths: [...project.rootPaths, "/Repo"] } : project) };
props.workspaceHints = { c: String.raw`\\wsl.localhost\Ubuntu\REPO` }; tree = render();
assert.deepEqual(ids(tree), ["c", "a", "b"], "AS05: WSL UNC identity drops distribution and folds case");
props.projectMembership = { ...props.projectMembership, localProjects: [...props.projectMembership.localProjects, { id: "collision", name: "Collision", rootPaths: [String.raw`\\wsl$\Other\Repo`], createdAt: 4 }] };
tree = render(); assert.deepEqual(ids(tree), ["a", "b"], "AS05: WSL normalization collisions remain ambiguous, never select first");
props.projectMembership = { ...assignedMembership, localProjects: assignedMembership.localProjects.map(project => project.id === "one" ? { ...project, rootPaths: [...project.rootPaths, "/"] } : project) };
props.workspaceHints = { c: "/" }; tree = render();
assert.deepEqual(ids(tree), ["c", "a", "b"], "AS05: a real root slash is not an empty input even after trailing-slash normalization");
props.projectMembership = assignedMembership; props.workspaceHints = assignedHints; tree = render();
filter(tree).props.onKindFilterChange("cloud"); tree = render();
assert.ok(text(tree).includes("云端归档尚未实现"));
assert.equal(nodes(tree, n => n.type === "footer").length, 0, "AS06: unavailable source cannot show a zero result count");
assert.equal(nodes(tree, cls("archive-empty")).length, 0, "AS06: unsupported cloud cannot masquerade as empty data");
assert.deepEqual(ids(tree), []);
filter(tree).props.onKindFilterChange("all"); tree = render();
assert.ok(text(tree).includes("云端归档尚未接入"));
assert.equal(reads, 1, "AS07: projections do not read/write backend");
assert.deepEqual(writes, []);
const search = nodes(tree, n => n.type === "input")[0];
search.props.onChange({ target: { value: "  CAFÉ 独立记录  " } }); tree = render();
assert.deepEqual(ids(tree), ["a"], "AS11: setting search uses canonical Unicode and actual rollout basename");
for (const value of ["unrelated-parent", "hidden-tail"]) {
  search.props.onChange({ target: { value } }); tree = render();
  assert.deepEqual(ids(tree), [], "AS11: parent folders and words beyond the third are excluded");
}
project(tree).props.onChange("project:local::two"); tree = render();
search.props.onChange({ target: { value: "CAFÉ 独立记录" } }); tree = render();
assert.deepEqual(ids(tree), [], "AS11: rollout match cannot bypass project filtering");
project(tree).props.onChange(one.value); tree = render();
assert.equal(reads, 1, "AS11: metadata searches do not read from the server");
search.props.onChange({ target: { value: "Alpha" } }); tree = render();
assert.deepEqual(ids(tree), ["c", "b"]);
await nodes(tree, n => n.type === "button" && n.props.className === "archive-refresh")[0].props.onClick();
for(let i=0;i<8;i++) await Promise.resolve(); tree = render();
assert.equal(filter(tree).props.sortKey, "created"); assert.equal(project(tree).props.value, "project:local::one"); assert.deepEqual(ids(tree), ["c", "b"]);
const restore = nodes(tree, n => n.type === "button" && text(n) === "取消归档")[0]; await restore.props.onClick(); for(let i=0;i<12;i++) await Promise.resolve(); tree = render();
assert.deepEqual(writes, [["restore", "c"]]); assert.deepEqual(ids(tree), ["b"], "AS08: real restore reload retains selected projection");
props.surface = "global"; tree = render();
assert.equal(filter(tree), undefined); assert.equal(nodes(tree, cls("archive-title")).map(text).join(""), "归档", "AS09: standalone heading stays unchanged"); assert.ok(text(tree).includes("归档的会话不会出现在侧边栏"));
assert.deepEqual(ids(tree), ["b"], "AS09: global retains legacy search, no settings projection");
nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "CAFÉ 独立记录" } }); tree = render();
assert.deepEqual(ids(tree), [], "AS11: standalone archive keeps its title-only search");
props.surface = "settings"; tree = render();
nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "" } }); tree = render();
props.cloudArchive = { status: "signed_out", items: [] };
project(tree).props.onChange("all"); tree = render();
nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "missing" } }); tree = render();
assert.ok(text(tree).includes("当前已读取的聊天中未找到匹配项"), "AS12: signed-out cloud does not mask a local search miss");
assert.ok(text(tree).includes("请登录 ChatGPT"));
assert.ok(filter(tree), "AS12: no match preserves search and filters");
nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "" } }); tree = render();
filter(tree).props.onKindFilterChange("local"); tree = render();
project(tree).props.onChange("project:local::two"); tree = render();
assert.ok(text(tree).includes("未找到匹配的归档聊天"), "AS12: project filter without text is still a search miss");
const refresh = () => nodes(tree, cls("archive-refresh"))[0].props.onClick();
reply = []; refresh(); tree = render();
assert.ok(text(tree).includes("正在加载已归档的聊天"));
for (let i=0;i<8;i++) await Promise.resolve(); tree = render();
assert.equal(filter(tree), undefined, "AS13: empty underlying data hides the toolbar");
assert.ok(text(tree).includes("暂无已归档的聊天"));
reply = Error("offline archive fixture"); refresh();
for (let i=0;i<8;i++) await Promise.resolve(); tree = render();
assert.ok(text(tree).includes("无法加载已归档的聊天"));
assert.equal(nodes(tree, cls("archive-empty")).length, 0, "AS13: failure is not a successful empty read");
reply = [
  { ...rows[0], cwd: null, path: "D:\\records\\archive source name ignored.jsonl" },
  { ...rows[1], cwd: "D:/Two" },
  { ...rows[2], cwd: "/", path: null },
];
props.projectMembership = { ...props.projectMembership, threadProjectAssignments: {
  ...props.projectMembership.threadProjectAssignments, a: { projectKind: "local", projectId: "one" },
} };
refresh(); for (let i=0;i<8;i++) await Promise.resolve(); tree = render();
project(tree).props.onChange(one.value); tree = render();
assert.match(rowMeta(tree, "a"), /，.+ • archive source name$/, "AS14: use only the path basename when cwd is absent");
assert.match(rowMeta(tree, "b"), / • Two$/, "AS14: prefer cwd over rollout path");
assert.doesNotMatch(rowMeta(tree, "c"), /•/, "AS14: blank basename cannot produce a dangling separator");
// Exercise the actual local menu's JSX and handlers without a browser DOM.
slots.length = 0;
const selection = [];
const menuProps = { kindFilter: "all", sortKey: "updated", onKindFilterChange: value => selection.push(["kind", value]), onSortKeyChange: value => selection.push(["sort", value]) };
const menuRender = () => { cursor = 0; return output.TestMenu(menuProps); };
let menuTree = menuRender();
const trigger = () => nodes(menuTree, n => n.type === "button" && n.props["aria-haspopup"] === "menu")[0];
assert.ok(menuTree.props.className.includes("general-preference-select"), "AS10: trigger inherits real shared select styles");
trigger().props.onClick(); menuTree = menuRender();
const radios = nodes(menuTree, n => n.props?.role === "menuitemradio");
assert.deepEqual(radios.map(text), ["全部聊天", "本地", "云端", "更新时间", "创建时间", "按字母顺序"]);
assert.equal(radios.filter(n => n.props["aria-checked"]).length, 2);
assert.deepEqual(nodes(menuTree, n => n.props?.role === "group").map(n => n.props["aria-label"]), ["类型", "排序方式"]);
let focused = -1, returned = 0;
const focusItems = radios.map((_, i) => ({ focus: () => { focused = i; } }));
slots[2].current = { focus: () => { returned++; } };
slots[3].current = { querySelectorAll: () => focusItems };
const menu = nodes(menuTree, n => n.props?.role === "menu")[0];
const key = (value, target = focusItems[0], composing = false) => menu.props.onKeyDown({ key: value, target, nativeEvent: { isComposing: composing }, preventDefault() {}, stopPropagation() {} });
key("End"); assert.equal(focused, 5);
key("ArrowDown", focusItems[5]); assert.equal(focused, 0);
key("Home", focusItems[4], true); assert.equal(focused, 0, "AS10: IME does not move focus");
key("Escape"); menuTree = menuRender(); assert.equal(trigger().props["aria-expanded"], false); assert.equal(returned, 1);
trigger().props.onClick(); menuTree = menuRender();
nodes(menuTree, n => n.props?.role === "menuitemradio").at(-1).props.onClick();
assert.deepEqual(selection, [["sort", "alphabetical"]]); assert.equal(returned, 2);
const css = fs.readFileSync("src/components/ArchiveView.css", "utf8");
assert.match(css, /\.archive-filter-menu \[role=menuitemradio\]\s*\{/, "AS10: nested group radios receive button styles");
console.log("PASS AS01–AS14: settings sort/group/filter, Unicode search, scoped states, source descriptions and standalone isolation");
