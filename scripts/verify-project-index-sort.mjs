import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the whole production component with isolated hooks and transport.
const source = fs.readFileSync("src/components/ProjectsIndexView.tsx", "utf8");
const now = 1_800_000_000_000;
const projects = [
  { id: "a", name: "Alpha", updatedAt: (now - 3_600_000) / 1000 },
  { id: "b", name: "Beta", updatedAt: now - 7_200_000 },
  { id: "c", name: "alpha", updatedAt: now - 3_600_000 },
  { id: "d", name: "Delta", updatedAt: now - 86_400_000 },
].map((p, position) => ({ ...p, position, roots: [{ path: `D:/${p.id}` }] }));
const originalOrder = projects.map(p => p.id);
let serverProjects = projects;
let projectReads = 0;
const listeners = new Map();
const rootSlots = [], childSlots = new Map(), effects = [], writes = [], actions = [];
const copied = [];
let slots = rootSlots;
let cursor = 0;
const React = {
  createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } }; },
  useState(initial) {
    const index = cursor++;
    const ownerSlots = slots;
    if (!(index in ownerSlots)) ownerSlots[index] = typeof initial === "function" ? initial() : initial;
    return [ownerSlots[index], value => { ownerSlots[index] = typeof value === "function" ? value(ownerSlots[index]) : value; }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
  useMemo(fn, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      slots[index] = { dependencies, value: fn() };
    }
    return slots[index].value;
  },
  useCallback(fn, dependencies) { return React.useMemo(() => fn, dependencies); },
  useEffect(fn) { if (!mounted) effects.push(fn); },
};
let mounted = false;
const exported = {};
const context = {
  exports: exported, console, Intl, Element: class {}, document: { activeElement: null },
  Date: class extends Date { static now() { return now; } },
  require(name) {
    if (name === "react") return { ...React, default: React };
    if (name.endsWith(".css")) return {};
    if (name === "../clipboard") return { copyTextToClipboard: async value => { copied.push(value); return true; } };
    if (name === "../projects") return {
      listProjects: async () => { projectReads++; return serverProjects; },
      ...Object.fromEntries(["createProject", "deleteProject", "moveProject", "updateProject"].map(key => [key, (...args) => writes.push([key, ...args])])),
    };
    if (name === "../bridge") return { tauriListen: async (event, callback) => { listeners.set(event, callback); return () => listeners.delete(event); }, tauriInvoke: () => { throw Error("Unexpected native request"); } };
    return new Proxy({}, { get: (_, key) => key });
  },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
const props = {
  workspaces: [], activeWorkspace: null, workspaceHints: {},
  threads: [{ id: "thread-b", projectId: "b", updatedAt: (now - 60_000) / 1000 }],
  onSelectWorkspace: path => actions.push(["workspace", path]),
  onStartNewChatInProject: (...args) => actions.push(["chat", ...args]),
  onSelectThread: id => actions.push(["thread", id]), onPickNewFolder() {}, onRemoveWorkspace() {},
  onRenameThread: (id, name) => actions.push(["rename", id, name]),
};
function render() {
  cursor = 0;
  const mountedLists = new Set();
  const renderChildren = (node, owner) => {
    if (!node?.props) return node;
    const key = node.props.key ?? owner;
    if (node.type?.name === "ProjectChatList") {
      mountedLists.add(key);
      if (!childSlots.has(key)) childSlots.set(key, []);
      const rootCursor = cursor;
      slots = childSlots.get(key); cursor = 0;
      const child = node.type(node.props);
      slots = rootSlots; cursor = rootCursor;
      return child;
    }
    return { ...node, props: { ...node.props, children: node.props.children.map(child => renderChildren(child, key)) } };
  };
  const tree = renderChildren(exported.ProjectsIndexView(props));
  for (const key of childSlots.keys()) if (!mountedLists.has(key)) childSlots.delete(key);
  return tree;
}
const nodes = (tree, match) => {
  const found = [];
  const visit = node => { if (!node || typeof node !== "object") return; if (match(node)) found.push(node); for (const child of node.props?.children || []) visit(child); };
  visit(tree); return found;
};
const cls = name => node => node.props?.className?.split(" ").includes(name);
const text = node => typeof node === "string" ? node : (node?.props?.children || []).map(text).join("");
const ids = tree => nodes(tree, cls("projects-table-group")).map(node => node.props.key);
const sortButton = (tree, label) => nodes(tree, node => node.type === "button" && text(node).includes(label) && cls("project-sort-button")(node))[0];
render(); for (const effect of effects) effect(); mounted = true;
for (let i = 0; i < 8; i++) await Promise.resolve();
let tree = render();
assert.deepEqual(ids(tree), ["b", "c", "a", "d"], "PS01: effective updated descending; name/id ties follow official comparator direction");
const times = nodes(tree, cls("project-col-updated")).filter(node => node.type === "div");
assert.deepEqual(times.map(text), ["1 分钟前", "1 小时前", "1 小时前", "1 天前"], "PS02: seconds and milliseconds share display/sort units");
assert.equal(nodes(tree, cls("project-sort-direction")).length, 1);
assert.ok(sortButton(tree, "已更新"));
sortButton(tree, "名称").props.onClick(); tree = render();
assert.deepEqual(ids(tree), ["a", "c", "b", "d"], "PS03: changing to name defaults ascending");
sortButton(tree, "名称").props.onClick(); tree = render();
assert.deepEqual(ids(tree), ["d", "b", "c", "a"], "PS03: repeating name reverses direction");
const search = nodes(tree, node => node.type === "input" && node.props["aria-label"] === "搜索项目")[0];
search.props.onChange({ target: { value: "alpha" } }); tree = render();
assert.deepEqual(ids(tree), ["c", "a"], "PS04: filtering retains descending name order");
nodes(tree, node => node.type === "input" && node.props["aria-label"] === "搜索项目")[0].props.onChange({ target: { value: "" } });
tree = render();
sortButton(tree, "已更新").props.onClick(); tree = render();
assert.deepEqual(ids(tree), ["b", "c", "a", "d"], "PS05: switching to modified restores descending default");
const firstRow = nodes(tree, cls("projects-table-row"))[0];
firstRow.props.onClick({ detail: 1 }); tree = render();
assert.equal(nodes(tree, cls("projects-table-row"))[0].props.className.includes("active"), true);
sortButton(tree, "已更新").props.onClick(); tree = render();
assert.deepEqual(ids(tree), ["d", "a", "c", "b"]);
assert.equal(nodes(tree, cls("projects-table-row")).at(-1).props.className.includes("active"), true, "PS06: expansion follows project identity after reorder");
props.threads = [{ id: "thread-d", projectId: "d", updatedAt: now }];
tree = render();
assert.equal(ids(tree).at(-1), "d", "PS07: thread-array change alone invalidates effective-time sort; millisecond timestamp participates without multiplying twice");
assert.equal(nodes(tree, cls("project-col-updated")).filter(node => node.type === "div").map(text).at(-1), "刚刚");
serverProjects = projects.map(project => project.id === "a" ? { ...project, updatedAt: now + 60_000 } : project);
listeners.get("app-server:notification")({ method: "project/changed" });
for (let i = 0; i < 8; i++) await Promise.resolve();
tree = render();
assert.equal(ids(tree).at(-1), "a", "PS07: project-change notification reloads a new list and invalidates the display projection without changing sort");
assert.equal(projectReads, 2, "PS07: changed project data must enter through a real production reload");
assert.deepEqual(projects.map(p => p.id), originalOrder, "PS08: projection cannot mutate persisted project ordering");
assert.deepEqual(writes, [], "PS08: sorting never calls persistence");
assert.deepEqual(actions, [], "PS08: sorting/expansion does not start chats or select threads");
for (const label of ["名称", "已更新"]) {
  assert.equal(sortButton(tree, label).props.type, "button");
  assert.equal(sortButton(tree, label).props.title, undefined, "PS09: sorting must not introduce an unobserved native hover tooltip");
}
const beforePinOrder = ids(tree);
props.isProjectPinned = id => id === "c";
props.onSetProjectPinned = (id, pinned) => actions.push(["project-pin", id, pinned]);
tree = render();
const pinnedProject = nodes(tree, cls("projects-table-group")).find(row => row.props.key === "c");
const pinButton = nodes(pinnedProject, node => node.props?.["aria-label"] === "取消置顶项目")[0];
assert.ok(pinButton, "PS17: a pinned project has a dedicated unpin control");
pinButton.props.onClick();
nodes(pinnedProject, node => node.props?.triggerAriaLabel === "项目操作")[0].props.onSelect("pin");
assert.deepEqual(actions.splice(0), [["project-pin", "c", false], ["project-pin", "c", false]]);
assert.deepEqual(ids(tree), beforePinOrder, "PS17: pin state does not change project-center sorting");
const css = fs.readFileSync("src/components/ProjectsIndexView.css", "utf8");
props.threads = [
  { id: "matching", projectId: "d", name: "修复 Session 路径", cwd: "D:/isolated/chat", updatedAt: now - 60_000 },
  { id: "other", projectId: "d", name: "未命中", preview: "Session 只是正文" },
  { id: "foreign", name: "Session 未归属" },
  { id: "kept", projectId: "b", name: "先前展开的聊天" },
];
tree = render();
const searchProjects = value => {
  nodes(tree, node => node.type === "input" && node.props["aria-label"] === "搜索项目")[0]
    .props.onChange({ target: { value } });
  tree = render();
};
searchProjects("  sEsSiOn  ");
assert.deepEqual(ids(tree), ["d"], "PS10: title hits reveal only the owning project");
assert.equal(nodes(tree, node => node.props?.["aria-label"] === "展开/折叠项目").length, 0);
const hit = nodes(tree, node => node.type === "button" && text(node).includes("修复 Session 路径"))[0];
assert.ok(hit, "PS10: hit is keyboard accessible");
assert.equal(nodes(tree, cls("project-expanded-thread-item")).length, 1);
const chatMenus = nodes(tree, node => node.props?.triggerAriaLabel === "聊天操作");
assert.equal(chatMenus.length, 1, "PS10: expanded local chat has a single actions menu");
const openChat = nodes(tree, node => node.props?.["aria-label"] === "打开聊天");
assert.equal(openChat.length, 1, "PS10: expanded local chat has a dedicated open button");
hit.props.onClick({ stopPropagation() {} });
openChat[0].props.onClick();
assert.deepEqual(actions, [["thread", "matching"], ["thread", "matching"]]);
const chatMenu = chatMenus[0].props;
assert.equal(chatMenu.items.map(item => item.id).join(","), "rename,copy-link,copy-cwd");
chatMenu.onSelect("copy-link");
chatMenu.onSelect("copy-cwd");
assert.deepEqual(copied, ["codex://threads/matching", "D:/isolated/chat"]);
const renameDialog = () => nodes(render(), node => node.type === "RenameThreadDialog")[0];
chatMenu.onSelect("rename");
assert.equal(renameDialog().props.initialValue, "修复 Session 路径");
renameDialog().props.onClose();
assert.equal(renameDialog(), undefined);
assert.equal(actions.length, 2, "PS10: clipboard and rename cancellation do not open or change the chat");
chatMenu.onSelect("rename");
renameDialog().props.onSave(" 已重命名 ");
assert.deepEqual(actions.pop(), ["rename", "matching", "已重命名"]);
actions.pop();
props.pinnedThreadIds = [];
props.onTogglePinThread = id => actions.push(["pin", id]);
const pinMenu = () => nodes(render(), node => node.props?.triggerAriaLabel === "聊天操作")[0].props;
assert.equal(pinMenu().items[0].label, "置顶聊天", "PS16: pin action appears in the organization section");
pinMenu().onSelect("pin");
assert.deepEqual(actions.pop(), ["pin", "matching"]);
props.onArchiveProjectThread = async (thread, allowRunning) => actions.push(["archive", thread.id, allowRunning]);
pinMenu().onSelect("archive");
assert.deepEqual(actions.pop(), ["archive", "matching", false], "PS18: project archive targets the matching chat without opening it");
props.threads = props.threads.map(thread => thread.id === "matching" ? { ...thread, status: { type: "active" } } : thread);
pinMenu().onSelect("archive");
const archiveDialog = () => nodes(render(), node => node.type === "ProjectArchiveDialog")[0];
assert.ok(archiveDialog(), "PS18: running chat requires confirmation");
archiveDialog().props.onClose();
assert.equal(archiveDialog(), undefined, "PS18: cancel makes no archive request");
pinMenu().onSelect("archive");
await archiveDialog().props.onArchive();
assert.deepEqual(actions.pop(), ["archive", "matching", true]);
props.onArchiveProjectThreads = async (projectId, name, threads) => actions.push(["archive-project", projectId, name, threads.map(item => item.id).join(",")]);
const projectArchiveMenu = () => nodes(render(), node => node.props?.triggerAriaLabel === "项目操作")[0].props;
const batchDialog = () => nodes(render(), node => node.type === "ProjectBulkArchiveDialog")[0];
assert.ok(projectArchiveMenu().items.some(item => item.id === "archive-threads" && !item.disabled), "PS19: project menu exposes the batch action");
projectArchiveMenu().onSelect("archive-threads");
assert.equal(batchDialog().props.count, 2, "PS19: search does not narrow archive membership");
batchDialog().props.onClose();
assert.equal(batchDialog(), undefined);
projectArchiveMenu().onSelect("archive-threads");
props.threads = [...props.threads, { id: "late", projectId: "d", name: "晚到聊天" }];
await batchDialog().props.onArchive();
assert.deepEqual(actions.pop(), ["archive-project", "d", "Delta", "matching,other"], "PS19: late additions are outside the confirmed scope");
props.pinnedThreadIds = ["matching"];
assert.equal(pinMenu().items[0].label, "取消置顶聊天", "PS16: menu reads the shared persisted pin state");
pinMenu().onSelect("pin");
assert.deepEqual(actions.pop(), ["pin", "matching"]);
searchProjects("");
assert.deepEqual(nodes(tree, cls("projects-table-group")).filter(node => nodes(node, cls("active")).length).map(node => node.props.key),
  ["b"], "PS11: clearing search restores only manually expanded projects");
searchProjects("  D:/D  ");
assert.deepEqual(ids(tree), ["d"], "PS11: root path match does not force expansion");
assert.equal(nodes(tree, cls("project-expanded-thread-item")).length, 0);
searchProjects("Session");
props.threads = props.threads.map(thread => thread.id === "matching" ? { ...thread, name: "已改名" } : thread);
tree = render();
assert.deepEqual(ids(tree), [], "PS12: a title update removes stale matches without changing the query");
assert.deepEqual(writes, [], "search never writes project state");
searchProjects("");
props.threads = Array.from({length: 23}, (_, index) => ({
  id: `page-${index}`, projectId: "b", name: `Paging ${index}`, updatedAt: now - index * 2000,
})).reverse();
props.currentThreadId = "page-22";
tree = render();
const pageTitles = () => nodes(tree, cls("project-expanded-thread-title")).map(text);
assert.deepEqual(pageTitles(), [...Array.from({length: 10}, (_, index) => `Paging ${index}`), "Paging 22"],
  "PS13: sorted first ten and forced current chat");
const pageMore = () => nodes(tree, node => node.type === "button" && text(node) === "展开显示")[0];
pageMore().props.onClick({ currentTarget: {} }); tree = render();
assert.equal(pageTitles().length, 21, "PS14: one click adds ten more, retaining the current chat");
let focusRestored = 0;
const button = { closest: () => ({ focus: () => focusRestored++ }) };
context.document.activeElement = button;
pageMore().props.onClick({ currentTarget: button }); tree = render();
assert.equal(pageTitles().length, 23);
assert.equal(pageMore(), undefined);
assert.equal(focusRestored, 1, "PS14: disappearing pagination control leaves focus in its list");
const toggleBeta = () => nodes(tree, node => cls("projects-table-group")(node) && node.props.key === "b")
  .flatMap(node => nodes(node, candidate => candidate.props["aria-label"] === "展开/折叠项目"))[0]
  .props.onClick({ stopPropagation() {} });
toggleBeta(); tree = render(); toggleBeta(); tree = render();
assert.equal(pageTitles().length, 21, "PS15: remount retains the first extra batch only");
props.currentThreadId = null;
props.threads = props.threads.slice(-21);
tree = render();
assert.equal(pageTitles().length, 21, "PS15: a lone remaining row is revealed without another button");
assert.equal(pageMore(), undefined);
assert.deepEqual(writes, [], "paging is read-only");
assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.project-col-updated\s*\{\s*display: none;/);
assert.match(css, /\.project-sort-direction\s*\{[^}]*transition:\s*transform 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/, "PS09: rotation uses the official default duration and timing curve");
console.log("PASS PS01–PS19 project sorting, title search, chat paging, pin and archive actions");
