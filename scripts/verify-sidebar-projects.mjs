import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Actual sidebar rendering and handlers with controlled React state and props.
// Effects run against stubbed service boundaries: L2 component contract only,
// not browser event bubbling, native storage or a live project service.
const code = ts.transpileModule(fs.readFileSync("src/components/CodexSidebar.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const orderModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarOrder.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: orderModule.exports });
const projectsModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarProjects.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: projectsModule.exports });
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const a = { id: "a", path: "D:/parity/alpha", label: "Alpha", active: true };
const b = { id: "b", path: "D:/parity/beta", label: "Beta", active: false };

export function mount(overrides = {}, storage = new Map(), useDefaultRecents = false, threadSections = { listSections: async () => [] }) {
  // Existing project-row fixtures explicitly hide duplicate project entries in Recent.
  if (!useDefaultRecents && !storage.has("codex_sidebar_show_projects_in_recents")) {
    storage.set("codex_sidebar_show_projects_in_recents", "false");
  }
  const hooks = [], calls = [], effects = [];
  const listeners = { window: new Map(), document: new Map() }, cleanups = new Map();
  const eventTarget = scope => ({
    addEventListener: (type, listener) => {
      if (!listeners[scope].has(type)) listeners[scope].set(type, new Set());
      listeners[scope].get(type).add(listener);
    },
    removeEventListener: (type, listener) => listeners[scope].get(type)?.delete(listener),
  });
  const documentStub = { ...eventTarget("document"), body: {}, activeElement: null, visibilityState: "visible", elementFromPoint: () => hitTarget };
  class ElementStub {}
  const dom = new Map();
  const element = node => {
    const id = node.type === "dialog" ? `dialog:${node.props["aria-label"]}`
      : node.props.role === "menu" ? `menu:${node.props["aria-label"]}`
      : node.props.role?.startsWith("menuitem") ? `item:${text(node)}`
      : node.props["data-thread-id"] ? `row:${node.props["data-thread-id"]}`
      : node.type === "button" && node.props.title ? `button:${node.props.title}` : null;
    if (!id) return null;
    let entry = dom.get(id);
    if (!entry) { entry = new ElementStub(); dom.set(id, entry); }
    entry.node = node;
    entry.isConnected = true;
    entry.open ??= false;
    entry.dataset = { threadId: node.props["data-thread-id"] };
    entry.closest = selector => {
      if (selector === "[data-thread-section-trigger]" && node.props["data-thread-section-trigger"] !== undefined) return entry;
      if (selector === "[data-thread-section-submenu]" && node.props["data-thread-section-submenu"] !== undefined) return entry;
      return null;
    };
    entry.focus = () => { documentStub.activeElement = entry; };
    entry.showModal = () => { entry.open = true; documentStub.activeElement = entry; };
    entry.close = () => {
      entry.open = false;
      // Native WebView2 repro: closing this modal can leave focus on the
      // document, so the component must restore its launcher explicitly.
      documentStub.activeElement = documentStub;
    };
    entry.getBoundingClientRect = () => ({ left: 20, right: 240, top: 100, bottom: 132, width: 220, height: 32 });
    entry.querySelectorAll = selector => all(node).filter(n => n.props.role?.startsWith("menuitem") &&
      (!selector?.includes('[role="menuitem"]') || n.props.role === "menuitem") && !n.props.disabled).map(element);
    entry.querySelector = selector => entry.querySelectorAll(selector)[0] ?? null;
    entry.contains = target => entry === target || all(node).some(n => element(n) === target);
    return entry;
  };
  let hitTarget = null;
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
      return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }];
    },
    useRef: value => { const i = cursor++; return hooks[i] ??= { current: value }; },
    useMemo: callback => callback(),
    useCallback: (callback, deps) => {
      const i = cursor++;
      if (!hooks[i] || deps.some((value, index) => !Object.is(value, hooks[i].deps[index]))) hooks[i] = { callback, deps };
      return hooks[i].callback;
    },
    useEffect: (callback, deps) => {
      const i = cursor++;
      if (!hooks[i] || deps.some((value, index) => !Object.is(value, hooks[i][index]))) {
        hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.set(i, callback()); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports,
    require: name => name === "react" ? react : name === "react-dom" ? { createPortal: node => ({ type: "portal", props: {}, children: [node] }) } : name === "lucide-react" ? { MessageCircle: "MessageCircle" } : name === "./Icons" ? { CheckIcon: "CheckIcon" } : name === "./ThreadActionsMenu" ? { ThreadActionsMenu: "ThreadActionsMenu" } : name === "./RenameThreadDialog" ? { RenameThreadDialog: "RenameThreadDialog" } : name === "./SidebarThreadHoverCard" ? { SidebarThreadHoverCard: "SidebarThreadHoverCard" } : name === "../sidebarOrder" ? orderModule.exports : name === "../sidebarProjects" ? projectsModule.exports : name === "../threadSections" ? threadSections : name === "../bridge" ? { tauriListen: async () => () => {} } : {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, console,
    window: { ...eventTarget("window"), innerWidth: 800, innerHeight: 600 },
    document: documentStub, HTMLElement: ElementStub,
  });
  const props = {
    collapsed: false, activeRoute: "home", workspaces: [a, b], activeWorkspace: a,
    threads: [{ id: "a1", name: "Alpha thread", cwd: a.path }, { id: "b1", name: "Beta thread", cwd: b.path }],
    pinnedThreadIds: [], workspaceHints: {}, activeThreadId: null, unreadInboxCount: 0,
    activityOnly: false, activityThreadIds: [],
    onSelectWorkspace: path => calls.push(["workspace", path]),
    onStartNewChat: (path, project) => calls.push(project ? ["new-chat", path, project.id] : ["new-chat", path]),
    onSelectThread: id => calls.push(["thread", id]),
    onNavigate: route => calls.push(["navigate", route]),
    ...overrides,
  };
  const render = () => {
    cursor = 0;
    const tree = module.exports.CodexSidebar(props);
    for (const entry of dom.values()) entry.isConnected = false;
    for (const node of all(tree)) {
      const el = element(node);
      if (el && node.props.ref) node.props.ref.current = el;
    }
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  const row = path => all(render()).find(n => n.props.title === path && n.props.className?.includes("sidebar-project-row"));
  return {
    render, row, calls, props, storage, dom, element, document: documentStub, setHitTarget: target => { hitTarget = target; },
    dispatch: (scope, type, payload = {}) => { for (const listener of [...(listeners[scope].get(type) || [])]) listener(payload); },
    setVisibility: value => { documentStub.visibilityState = value; },
    listenerCount: () => Object.values(listeners).reduce((sum, events) => sum + [...events.values()].reduce((n, set) => n + set.size, 0), 0),
    unmount: () => { for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); },
  };
}

const event = (row, key, target = row) => ({ key, currentTarget: row, target, preventDefault() {}, stopPropagation() {} });
const view = mount();
assert.ok(text(view.render()).includes("Alpha thread"), "active project children must initially be visible");
assert.ok(text(view.render()).includes("Beta thread"), "unvisited projects must default to expanded too");
let row = view.row(a.path);
assert.equal(row.props.role, "button");
assert.equal(row.props["aria-expanded"], true);
row.props.onClick(event(row));
assert.equal(view.row(a.path).props["aria-expanded"], false, "whole row must collapse");
assert.ok(!text(view.render()).includes("Alpha thread"));
assert.ok(text(view.render()).includes("Beta thread"), "project expansion must be independent");
assert.deepEqual(view.calls, [], "disclosure must not select a workspace or create a thread");
for (const key of ["Enter", " "]) {
  row = view.row(a.path); row.props.onKeyDown(event(row, key));
}
assert.equal(view.row(a.path).props["aria-expanded"], false, "Enter and Space each toggle once");
row = view.row(a.path); row.props.onKeyDown(event(row, "Enter", {}));
assert.equal(view.row(a.path).props["aria-expanded"], false, "nested button key must not toggle parent");
view.props.activeWorkspace = b;
assert.equal(view.row(a.path).props["aria-expanded"], false);
view.props.collapsed = true; assert.equal(view.render(), null);
view.props.collapsed = false; assert.equal(view.row(a.path).props["aria-expanded"], false);
const reopened = mount({}, view.storage);
assert.equal(reopened.row(a.path).props["aria-expanded"], false, "remount must restore collapsed project");
assert.equal(reopened.row(b.path).props["aria-expanded"], true);
const projectRow = reopened.row(a.path);
const newChat = all(projectRow).find(n => n.type === "button" && n.props.title?.startsWith("在 Alpha"));
newChat.props.onClick(event(newChat));
assert.deepEqual(reopened.calls, [["new-chat", a.path]]);
assert.equal(reopened.row(a.path).props["aria-expanded"], false, "new chat must not toggle project");
const normalized = mount({ workspaces: [{ ...a, path: "D:\\PARITY\\ALPHA\\" }], activeWorkspace: null }, view.storage);
assert.equal(normalized.row("D:\\PARITY\\ALPHA\\").props["aria-expanded"], false, "same Windows path spelling must restore the same project state");
row = reopened.row(a.path); row.props.onClick(event(row)); row.props.onClick(event(row));
assert.equal(reopened.row(a.path).props["aria-expanded"], false, "two rapid clicks must toggle twice without stale state");
const key = "codex_sidebar_project_expansion_v1";
for (const value of ["broken-json", "null", "[]", JSON.stringify({ [a.path.toLowerCase()]: "false" })]) {
  assert.equal(mount({}, new Map([[key, value]])).row(a.path).props["aria-expanded"], true, "invalid persisted state must fall back to expanded");
}
console.log("PASS sidebar component: project disclosure, defaults, keyboard/action isolation, independent state, persistence and corrupt-storage fallback (L2)");

const many = Array.from({ length: 28 }, (_, i) => ({ id: `t${i}`, name: `Chat ${i}`, cwd: a.path, updatedAt: 100 - i }));
const listView = mount({ threads: many });
const rows = () => all(listView.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row"));
const more = () => all(listView.render()).find(n => n.type === "button" && text(n) === "展开显示");
assert.equal(rows().length, 5, "project list must initially show five rows");
more().props.onClick(); assert.equal(rows().length, 15);
more().props.onClick(); assert.equal(rows().length, 25);
more().props.onClick(); assert.equal(rows().length, 28); assert.equal(more(), undefined);
assert.deepEqual(listView.calls, [], "expanding list must not select or create a chat");
const six = mount({ threads: many.slice(0, 6) });
assert.equal(all(six.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row")).length, 6, "single remainder must be shown without an extra click");
listView.props.activeRoute = "thread"; listView.props.activeThreadId = "t27";
const selected = mount({ threads: many, activeRoute: "thread", activeThreadId: "t27" });
const selectedRows = all(selected.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row"));
assert.equal(selectedRows.length, 6, "selected row beyond limit must remain reachable");
assert.ok(selectedRows.some(n => text(n).includes("Chat 27")));
const sevenWithSelection = mount({ threads: many.slice(0, 7), activeRoute: "thread", activeThreadId: "t6" });
assert.equal(all(sevenWithSelection.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row")).length, 7, "single remainder is calculated after forcing the selected row");
console.log("PASS sidebar project lists: 5/15/25, final single remainder, forced selected row and no side effects (L2)");

const renderedIds = sidebar => all(sidebar.render())
  .filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row"))
  .map(n => n.props.key);
const pins = mount({
  threads: [
    { id: "pin-a", name: "Pin A", updatedAt: 30 },
    { id: "pin-b", name: "Pin B", updatedAt: 20 },
    { id: "pin-c", name: "Pin C", updatedAt: 10 },
  ], pinnedThreadIds: ["pin-c", "pin-a", "pin-b"],
});
assert.deepEqual(renderedIds(pins), ["pin-c", "pin-a", "pin-b"], "pinned rows must preserve saved pin order independently of recent sorting");
pins.props.threads = pins.props.threads.map(t => ({ ...t, updatedAt: t.id === "pin-b" ? 1000 : 0 }));
assert.deepEqual(renderedIds(pins), ["pin-c", "pin-a", "pin-b"], "activity updates must not reorder manually pinned rows");
pins.props.threads = pins.props.threads.filter(t => t.id !== "pin-a");
assert.deepEqual(renderedIds(pins), ["pin-c", "pin-b"], "temporarily missing pinned rows must not disturb remaining saved order");
const recency = mount({ threads: [
  { id: "zero", name: "Zero", recencyAt: 0, updatedAt: 999 },
  { id: "equal-a", name: "Equal A", recencyAt: 10, updatedAt: 50 },
  { id: "equal-b", name: "Equal B", recencyAt: 10, updatedAt: 100 },
  { id: "fallback", name: "Fallback", recencyAt: null, updatedAt: 20 },
  { id: "created", name: "Created", createdAt: 5 },
] });
assert.deepEqual(renderedIds(recency), ["fallback", "equal-a", "equal-b", "created", "zero"], "recent sort must use nullish recency fallback and stable ties");
console.log("PASS sidebar ordering: saved pinned order, refresh/missing pins, zero/null time and stable recent ties (L2)");

const ordered = mount({ threads: many.slice(0, 8) });
const organizer = sidebar => all(sidebar.render()).find(n => n.type === "ThreadActionsMenu" && n.props.triggerAriaLabel === "聊天侧边栏选项")?.props;
assert.ok(organizer(ordered), "sidebar must use shared hierarchical menu with official Chinese trigger label");
assert.deepEqual(Array.from(organizer(ordered).items.slice(0, 2), item => item.label), ["整理侧边栏", "聊天排序方式"]);
assert.deepEqual(Array.from(organizer(ordered).items[0].children, item => item.label), ["分项目显示", "合并显示"]);
assert.deepEqual(Array.from(organizer(ordered).items[1].children, item => item.label), ["最近更新", "手动排序"]);
assert.ok(organizer(ordered).items.slice(0, 2).every(item => item.children.every(child => child.type === "radio")));
organizer(ordered).onSelect("sort-manual");
const manualRows = () => all(ordered.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row"));
let drag = manualRows()[4], target = manualRows()[0];
assert.equal(drag.props["data-reorderable"], true);
const dragEvent = (node, clientY = 0) => ({ target: node, currentTarget: { setPointerCapture() {}, getBoundingClientRect: () => ({ left: 10, top: 50, width: 300, height: 31 }) }, pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY, preventDefault() {}, stopPropagation() {} });
ordered.setHitTarget({ closest: () => ({ dataset: { orderGroup: target.props["data-order-group"], threadId: target.props["data-thread-id"] }, getBoundingClientRect: () => ({ top: 0, height: 30 }) }) });
drag.props.onPointerDown(dragEvent(drag, 60)); drag.props.onPointerMove(dragEvent(drag, 1)); drag.props.onPointerUp(dragEvent(drag, 1));
drag.props.onClick();
assert.deepEqual(manualRows().map(n => n.props.key), ["t4", "t0", "t1", "t2", "t3"], "drag top half must place the row before target");
const restoredManual = mount({ threads: many.slice(0, 8) }, ordered.storage);
assert.deepEqual(renderedIds(restoredManual), ["t4", "t0", "t1", "t2", "t3"], "manual order and mode survive remount");
const moreManual = all(restoredManual.render()).find(n => n.type === "button" && text(n) === "展开显示");
moreManual.props.onClick();
assert.deepEqual(renderedIds(restoredManual), ["t4", "t0", "t1", "t2", "t3", "t5", "t6", "t7"], "hidden items must be retained after reordering visible rows");
const oldPreference = mount({ threads: many.slice(0, 8) }, new Map([["codex_sidebar_sort_mode", "created_at"]]));
assert.equal(all(oldPreference.render()).find(n => n.props.className?.includes("sidebar-thread-row")).props["data-reorderable"], undefined);
console.log("PASS sidebar manual mode: menu, drag, persistence, hidden rows and obsolete preference normalization (L2)");

const manualStorage = new Map([
  ["codex_sidebar_sort_mode", "manual"],
  ["codex_sidebar_manual_orders_v1", JSON.stringify({ "project:d:/parity/alpha": ["t2", "missing", "t0", "t1"] })],
]);
const creation = mount({ threads: many.slice(0, 3) }, manualStorage);
assert.deepEqual(renderedIds(creation), ["t2", "t0", "t1"]);
creation.props.threads = [...many.slice(0, 3), { id: "historic", name: "History", cwd: a.path, updatedAt: 999 }];
assert.deepEqual(renderedIds(creation), ["t2", "t0", "t1", "historic"], "newly discovered history goes to project tail");
creation.props.threads.push({ id: "explicit", name: "Created", cwd: a.path, updatedAt: 1 });
creation.props.createdThread = { id: "explicit", cwd: a.path };
creation.render();
assert.deepEqual(renderedIds(creation), ["explicit", "t2", "t0", "t1", "historic"], "successful explicit creation is prepended independently of timestamp");
creation.props.threads = creation.props.threads.map(t => t.id === "historic" ? { ...t, updatedAt: 2000 } : t);
assert.deepEqual(renderedIds(creation), ["explicit", "t2", "t0", "t1", "historic"], "discovered history must retain its learned manual position after later activity");
const allOrder = JSON.parse(creation.storage.get("codex_sidebar_manual_orders_v1"));
assert.ok(allOrder["project:d:/parity/alpha"].includes("missing"), "creation must preserve unloaded IDs");
const recentView = mount({ threads: [{ id: "old", name: "Old", updatedAt: 10 }, { id: "new", name: "New", updatedAt: 1 }] }, new Map([
  ["codex_sidebar_sort_mode", "manual"],
  ["codex_sidebar_manual_orders_v1", JSON.stringify({ recent: ["old", "unloaded"] })],
]));
assert.deepEqual(renderedIds(recentView), ["new", "old"], "unseen Recent entries go before stored ones");
const noDrag = mount({ threads: many.slice(0, 3) });
assert.ok(all(noDrag.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row")).every(n => !n.props["data-reorderable"]));
assert.deepEqual(ordered.calls, [], "manual reorder must not select, create or navigate");
console.log("PASS manual creation/history distinction, unloaded IDs, Recent position and updated-mode drag gate (L2)");

function pointerFixture() {
  const sidebar = mount({ threads: many.slice(0, 3) }, new Map([["codex_sidebar_sort_mode", "manual"]]));
  const nodes = all(sidebar.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row"));
  sidebar.setHitTarget({ closest: () => ({ dataset: { orderGroup: nodes[0].props["data-order-group"], threadId: "t0" }, getBoundingClientRect: () => ({ top: 0, height: 30 }) }) });
  return { sidebar, source: nodes[2] };
}
{
  const { sidebar, source } = pointerFixture();
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 6)); source.props.onPointerUp(dragEvent(source, 6));
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2"], "exactly six pixels must not activate drag");
  source.props.onClick(); assert.deepEqual(sidebar.calls, [["thread", "t2"]], "ordinary click remains available below drag threshold");
}
{
  const { sidebar, source } = pointerFixture();
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 20)); source.props.onPointerUp(dragEvent(source, 20));
  assert.deepEqual(renderedIds(sidebar), ["t0", "t2", "t1"], "drop in lower half goes after target");
  source.props.onClick(); assert.deepEqual(sidebar.calls, [], "drag completion must suppress row selection");
}
{
  const { sidebar, source } = pointerFixture();
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 20)); source.props.onPointerCancel(); source.props.onPointerUp(dragEvent(source, 20));
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2"], "cancelled drag must not persist");
}
{
  const { sidebar, source } = pointerFixture();
  sidebar.setHitTarget({ closest: () => ({ dataset: { orderGroup: "another-project", threadId: "t0" } }) });
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 20)); source.props.onPointerUp(dragEvent(source, 20));
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2"], "sorting must not perform unrequested cross-project migration");
}
console.log("PASS Pointer Events drag: strict six-pixel threshold, before/after, click suppression, cancellation and same-list scope (L2)");

for (const [scope, type, payload, visibility] of [
  ["window", "keydown", { key: "Escape", code: "Escape" }],
  ["window", "blur", {}],
  ["window", "resize", {}],
  ["document", "visibilitychange", {}, "hidden"],
]) {
  const { sidebar, source } = pointerFixture();
  source.props.onPointerDown(dragEvent(source, 0));
  source.props.onPointerMove(dragEvent(source, 20));
  if (visibility) sidebar.setVisibility(visibility);
  sidebar.dispatch(scope, type, payload);
  source.props.onPointerUp(dragEvent(source, 20));
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2"], `${type} must cancel before pointerup can persist order`);
  source.props.onClick();
  assert.deepEqual(sidebar.calls, [], `${type} must suppress a cancelled drag's trailing click`);
  source.props.onPointerDown(dragEvent(source, 0));
  source.props.onPointerUp(dragEvent(source, 0));
  source.props.onClick();
  assert.deepEqual(sidebar.calls, [["thread", "t2"]], "a fresh ordinary click must work after cancellation");
  sidebar.unmount();
  assert.equal(sidebar.listenerCount(), 0, "unmount must release window/document listeners");
}
{
  const { sidebar, source } = pointerFixture();
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 20));
  sidebar.dispatch("window", "keydown", { key: "a", code: "KeyA" });
  sidebar.dispatch("document", "visibilitychange");
  source.props.onPointerUp(dragEvent(source, 20));
  assert.deepEqual(renderedIds(sidebar), ["t0", "t2", "t1"], "ordinary keys and visible document must not cancel drag");
}
console.log("PASS drag lifecycle: Escape, blur, resize, hidden document, trailing click, fresh click and listener cleanup (L2)");

const threadRows = sidebar => all(sidebar.render()).filter(n => n.props.className?.split(/\s+/).includes("sidebar-thread-row"));
const keyMove = (sidebar, id, key, extra = {}) => {
  const node = threadRows(sidebar).find(n => n.props["data-thread-id"] === id);
  const e = { ...event(node, key), altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, ...extra };
  node.props.onKeyDownCapture?.(e);
};
{
  const sidebar = mount({ threads: many.slice(0, 8) }, new Map([
    ["codex_sidebar_sort_mode", "manual"],
    ["codex_sidebar_manual_orders_v1", JSON.stringify({ "project:d:/parity/alpha": ["t0", "unloaded", "t1", "t2", "t3", "t4", "t5", "t6", "t7"] })],
  ]));
  assert.equal(threadRows(sidebar)[0].props.role, "button", "focused thread row must expose main activation semantics");
  keyMove(sidebar, "t2", "ArrowUp");
  assert.deepEqual(renderedIds(sidebar), ["t0", "t2", "t1", "t3", "t4"], "Alt+Up moves exactly one visible slot");
  keyMove(sidebar, "t2", "ArrowDown");
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2", "t3", "t4"]);
  keyMove(sidebar, "t0", "ArrowUp"); keyMove(sidebar, "t4", "ArrowDown");
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2", "t3", "t4"], "visible boundaries must not cross into hidden rows");
  for (const extra of [{ altKey: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { defaultPrevented: true }, { target: {} }]) {
    keyMove(sidebar, "t2", "ArrowUp", extra);
    assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2", "t3", "t4"], "modifier/handled/child-target isolation");
  }
  keyMove(sidebar, "t2", "ArrowUp");
  sidebar.render();
  const saved = JSON.parse(sidebar.storage.get("codex_sidebar_manual_orders_v1"))["project:d:/parity/alpha"];
  assert.deepEqual(saved, ["t0", "unloaded", "t2", "t1", "t3", "t4", "t5", "t6", "t7"]);
  assert.deepEqual(renderedIds(mount({ threads: many.slice(0, 8) }, sidebar.storage)), ["t0", "t2", "t1", "t3", "t4"], "keyboard order must survive remount");
  assert.deepEqual(sidebar.calls, [], "keyboard reorder must not open a thread or navigate");
}
{
  const sidebar = mount({ threads: many.slice(0, 3) });
  keyMove(sidebar, "t2", "ArrowUp");
  assert.deepEqual(renderedIds(sidebar), ["t0", "t1", "t2"], "updated mode must not become manual via shortcut");
  const recent = mount({ threads: many.slice(0, 3).map(t => ({ ...t, cwd: undefined })) }, new Map([["codex_sidebar_sort_mode", "manual"]]));
  keyMove(recent, "t2", "ArrowUp");
  assert.deepEqual(renderedIds(recent), ["t0", "t2", "t1"], "Recent shares the same keyboard order contract");
}
console.log("PASS keyboard manual order: Alt adjacent move, boundaries, modifiers, child isolation, hidden/unloaded slots, project/Recent and remount (L2)");

{
  const threads = [
    { id: "project-a", name: "Project A", cwd: a.path, updatedAt: 3 },
    { id: "project-b", name: "Project B", cwd: b.path, updatedAt: 2 },
    { id: "independent", name: "Independent", updatedAt: 1 },
    { id: "pinned", name: "Pinned", cwd: a.path, updatedAt: 4 },
  ];
  const props = { threads, pinnedThreadIds: ["pinned"] };
  const sidebar = mount(props, new Map(), true);
  assert.deepEqual(renderedIds(sidebar), ["pinned", "project-a", "project-b", "project-a", "project-b", "independent"], "official default includes project chats in Recent as well as their project");
  const checkbox = () => organizer(sidebar).items.find(item => item.type === "checkbox");
  assert.equal(checkbox()?.checked, true);
  assert.equal(checkbox()?.label, "项目");
  organizer(sidebar).onSelect("recents-show-projects");
  assert.deepEqual(renderedIds(sidebar), ["pinned", "project-a", "project-b", "independent"], "unchecking only removes project duplicates from Recent");
  assert.equal(sidebar.storage.get("codex_sidebar_show_projects_in_recents"), "false");
  organizer(sidebar).onSelect("organize-list");
  assert.deepEqual(renderedIds(sidebar), ["pinned", "project-a", "project-b", "independent"], "merged list includes all unpinned chats even when project inclusion is off");
  assert.equal(checkbox(), undefined, "Recent-only checkbox must be absent in merged mode");
  assert.deepEqual(renderedIds(mount(props, sidebar.storage, true)), ["pinned", "project-a", "project-b", "independent"], "merged mode and inclusion preference survive remount");
  organizer(sidebar).onSelect("organize-project");
  assert.deepEqual(renderedIds(sidebar), ["pinned", "project-a", "project-b", "independent"], "returning to projects restores the saved off preference");
  assert.deepEqual(sidebar.calls, [], "organizing does not select or create threads");
  assert.ok(!text(sidebar.render()).includes("仅当前选定项目"), "invented scope choice must be removed");
  for (const [legacy, included] of [["all", true], ["projectless", false], ["current", false]]) {
    const migrated = mount(props, new Map([["codex_sidebar_filter_scope", legacy]]), true);
    const expected = included ? ["pinned", "project-a", "project-b", "project-a", "project-b", "independent"] : ["pinned", "project-a", "project-b", "independent"];
    assert.deepEqual(renderedIds(migrated), expected, "migrate explicit legacy scope without carrying its merged-list filter");
  }
}
console.log("PASS Recents inclusion: official true default, checkbox, merged-list independence, mode roundtrip, pins and legacy preference migration (L2)");

await new Promise(setImmediate);
const readyItems = organizer(ordered).items;
assert.equal(readyItems.at(-1).id, "new-section", "available section creation must be last, after organization/sort/show options");
assert.equal(readyItems.at(-1).separatorBefore, true);
assert.ok(!text(ordered.render()).includes("Organize sidebar"), "Sidebar must no longer render its obsolete inline panel");
console.log("PASS Sidebar hierarchical menu binding: official Chinese hierarchy, radio values, capability-gated final section action and no inline panel (L2 configuration)");

const dragPreview = sidebar => all(sidebar.render()).find(n => n.props.className === "sidebar-thread-drag-preview");
const dropIndicators = sidebar => threadRows(sidebar).filter(n => n.props["data-drop-placement"]);
{
  const { sidebar, source } = pointerFixture();
  sidebar.render();
  const saved = sidebar.storage.get("codex_sidebar_manual_orders_v1");
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 6));
  assert.equal(dragPreview(sidebar), undefined, "no drag preview before activation threshold");
  source.props.onPointerMove(dragEvent(source, 7));
  assert.ok(dragPreview(sidebar), "activated drag needs a floating preview outside sidebar clipping");
  assert.equal(all(sidebar.render()).filter(n => n.type === "portal").length, 1);
  assert.equal(text(dragPreview(sidebar)), "Chat 2");
  assert.equal(dragPreview(sidebar).props.style.top, 57);
  assert.equal(dragPreview(sidebar).props.style.left, 10);
  assert.equal(threadRows(sidebar).find(n => n.props["data-thread-id"] === "t2").props["data-dragging"], true);
  assert.equal(dropIndicators(sidebar)[0].props["data-thread-id"], "t0");
  assert.equal(dropIndicators(sidebar)[0].props["data-drop-placement"], "before");
  source.props.onPointerMove(dragEvent(source, 20));
  assert.equal(dropIndicators(sidebar)[0].props["data-thread-id"], "t1", "after-target indicator is normalized to next remaining row boundary");
  assert.equal(sidebar.storage.get("codex_sidebar_manual_orders_v1"), saved, "hover must not commit order");
  sidebar.setHitTarget(null); source.props.onPointerMove(dragEvent(source, 22));
  assert.equal(dropIndicators(sidebar).length, 0, "leaving a valid target clears indicator");
  assert.ok(dragPreview(sidebar), "preview follows pointer outside valid targets");
  source.props.onPointerCancel();
  assert.equal(dragPreview(sidebar), undefined);
  assert.ok(threadRows(sidebar).every(n => !n.props["data-dragging"]));
  assert.deepEqual(sidebar.calls, []);
}
for (const cancel of [
  sidebar => sidebar.dispatch("window", "keydown", { code: "Escape" }),
  sidebar => sidebar.dispatch("window", "blur"),
  sidebar => sidebar.dispatch("window", "resize"),
  sidebar => { sidebar.setVisibility("hidden"); sidebar.dispatch("document", "visibilitychange"); },
  (sidebar, source) => source.props.onLostPointerCapture(),
  sidebar => organizer(sidebar).onSelect("sort-updated_at"),
  sidebar => { sidebar.props.collapsed = true; sidebar.render(); sidebar.props.collapsed = false; },
  sidebar => { sidebar.props.threads = sidebar.props.threads.filter(t => t.id !== "t2"); },
]) {
  const { sidebar, source } = pointerFixture();
  source.props.onPointerDown(dragEvent(source, 0)); source.props.onPointerMove(dragEvent(source, 7));
  assert.ok(dragPreview(sidebar));
  cancel(sidebar, source); sidebar.render();
  assert.equal(dragPreview(sidebar), undefined, "lifecycle cancel must remove portal");
  assert.equal(dropIndicators(sidebar).length, 0);
}
console.log("PASS drag presentation state: threshold, source fade marker, portal/position, canonical indicator, hover no-write, outside and lifecycle cleanup (L2)");

{
  const sidebar = mount();
  const projectOptions = () => all(sidebar.render()).find(n => n.type === "ThreadActionsMenu" && n.props.triggerAriaLabel === "项目侧边栏选项")?.props;
  assert.ok(projectOptions(), "project header needs the official organization options entry");
  const items = () => projectOptions().items;
  assert.deepEqual(Array.from(items(), item => item.id), ["organize-project", "organize-list"], "organizeOnly exposes direct radio choices, no sort, checkbox or section action");
  assert.ok(items().every(item => item.type === "radio" && !item.children));
  assert.equal(items()[0].checked, true);
  assert.equal(items()[1].checked, false);
  projectOptions().onSelect("organize-list");
  assert.equal(items()[1].checked, true);
  assert.equal(organizer(sidebar).items[0].children[1].checked, true, "both organization entries share the same mode");
  assert.equal(sidebar.storage.get("codex_sidebar_organize_mode"), "list");
  assert.ok(!all(sidebar.render()).some(n => n.props.className === "sidebar-projects-tree"));
  organizer(sidebar).onSelect("organize-project");
  assert.equal(items()[0].checked, true);
  assert.equal(projectOptions().align, "left");
  assert.ok(all(sidebar.render()).some(n => n.props.title === "添加本地项目文件夹"), "creation entry remains available");
  assert.ok(!all(sidebar.render()).some(n => n.props.title === "管理所有项目"), "obsolete management tool is replaced, not retained alongside options");
  assert.deepEqual(sidebar.calls, [], "organization only changes the preference, without navigation or chat creation");
  const restored = mount({}, sidebar.storage);
  assert.equal(organizer(restored).items[0].children[0].checked, true);
}
console.log("PASS project header options: direct organize-only radios, shared mode, persistence, preserved creation and no navigation (L2)");

{
  const workspaces = [{ ...a, serverProjectId: "server-A" }, { ...b, serverProjectId: "server-B" }];
  const threads = [
    { id: "assigned-A", name: "Assigned A", cwd: b.path, projectId: "server-A", updatedAt: 5 },
    { id: "assigned-B", name: "Assigned B", cwd: a.path, projectId: "server-B", updatedAt: 4 },
    { id: "unknown", name: "Unknown project", cwd: a.path, projectId: "server-other", updatedAt: 3 },
    { id: "legacy-A", name: "Legacy A", cwd: a.path, updatedAt: 2 },
    { id: "null-B", name: "Unassigned B", cwd: b.path, projectId: null, updatedAt: 1 },
  ];
  const sidebar = mount({ workspaces, threads });
  const members = (view, path) => {
    const group = all(view.render()).find(n => n.props.className === "sidebar-project-group" && n.children.some(child => child?.props?.title === path));
    return all(group).filter(n => n.props["data-thread-id"]).map(n => n.props["data-thread-id"]);
  };
  assert.deepEqual(members(sidebar, a.path), ["assigned-A", "legacy-A"], "explicit server identity must win over conflicting cwd");
  assert.deepEqual(members(sidebar, b.path), ["assigned-B", "null-B"]);
  assert.deepEqual(renderedIds(sidebar), ["assigned-A", "legacy-A", "assigned-B", "null-B", "unknown"], "unknown canonical project must remain discoverable in Recent without guessing cwd membership");
  sidebar.props.workspaces = [{ ...a, serverProjectId: "server-A" }, { ...b, serverProjectId: "replacement" }];
  assert.deepEqual(members(sidebar, b.path), ["null-B"], "binding changes cannot retain stale canonical membership");
  assert.ok(renderedIds(sidebar).includes("assigned-B"));
  const withoutMap = mount({ threads });
  assert.deepEqual(members(withoutMap, a.path), ["legacy-A"]);
  assert.deepEqual(members(withoutMap, b.path), ["null-B"]);
  const manual = mount({ workspaces, threads }, new Map([["codex_sidebar_sort_mode", "manual"]]));
  manual.render(); manual.render();
  manual.props.createdThread = { id: "new-B", cwd: a.path, projectId: "server-B" };
  manual.render(); manual.render();
  const saved = JSON.parse(manual.storage.get("codex_sidebar_manual_orders_v1"));
  assert.equal(saved[`project:${b.path.toLowerCase()}`][0], "new-B");
  assert.ok(!saved[`project:${a.path.toLowerCase()}`].includes("new-B"), "new thread notification must not contaminate a cwd-derived group's manual order");
}
console.log("PASS explicit workspace project identity: canonical precedence, unknown preservation, legacy null fallback, rebinding and manual creation (L2)");

{
  const workspaces = [{ ...a, serverProjectId: "server-A" }, { ...b, serverProjectId: "server-B" }];
  const threads = [
    { id: "override", name: "Workspace override", cwd: a.path, projectId: "server-A" },
    { id: "none", name: "Explicit no project", cwd: a.path, projectId: "server-A" },
    { id: "global", name: "Global assignment", cwd: b.path, projectId: "server-B" },
    { id: "flag", name: "Legacy no project", cwd: a.path },
    { id: "remote", name: "Remote assignment", cwd: a.path },
    { id: "legacy", name: "No client marker", cwd: a.path, projectId: null },
  ];
  const projectMembership = {
    threadProjectAssignments: { override: { projectKind: "local", projectId: a.id }, none: { projectKind: "local", projectId: a.id }, global: { projectKind: "local", projectId: a.id }, remote: { projectKind: "remote", projectId: "remote", hostId: "other-host" } },
    projectlessThreadIds: ["override", "global", "flag"],
    workspaceProjectAssignments: { override: { projectKind: "local", projectId: b.id }, none: null },
  };
  const sidebar = mount({ workspaces, threads, projectMembership });
  const members = path => {
    const group = all(sidebar.render()).find(n => n.props.className === "sidebar-project-group" && n.children.some(child => child?.props?.title === path));
    return all(group).filter(n => n.props["data-thread-id"]).map(n => n.props["data-thread-id"]);
  };
  assert.deepEqual(members(a.path), ["global", "legacy"], "global local assignment overrides canonical/cwd and its old projectless marker; null without client marker remains legacy");
  assert.deepEqual(members(b.path), ["override"], "workspace membership overrides global assignment, canonical and old projectless marker");
  assert.deepEqual(renderedIds(sidebar), ["global", "legacy", "override", "none", "flag", "remote"], "explicit no-project and remote assignments remain in Recent");
  sidebar.props.projectMembership = { ...projectMembership, workspaceProjectAssignments: { override: null, none: { projectKind: "local", projectId: b.id } } };
  assert.deepEqual(members(b.path), ["none"], "metadata snapshots must update the same resolver immediately");
}
console.log("PASS client membership precedence: workspace override/no-project, global assignment, projectless, remote isolation and legacy null (L2)");

{
  const sharedRoot = "D:/parity/shared";
  const secondRoot = "D:/parity/second";
  const projects = [
    { id: "multi", name: "Multi root", rootPaths: [sharedRoot, secondRoot], createdAt: 1, serverProjectId: "server-multi" },
    { id: "same", name: "Same root", rootPaths: [sharedRoot], createdAt: 2, serverProjectId: "server-same" },
  ];
  const sidebar = mount({
    workspaces: [{ id: sharedRoot, path: sharedRoot, label: "Legacy shared", active: true }],
    activeWorkspace: { id: sharedRoot, path: sharedRoot, label: "Legacy shared", active: true },
    projectMembership: {
      localProjects: projects,
      selectedProjectId: "same",
      threadProjectAssignments: {},
      projectlessThreadIds: [],
      workspaceProjectAssignments: {},
    },
    threads: [
      { id: "multi-thread", name: "Multi thread", cwd: secondRoot + "/src", projectId: "server-multi", updatedAt: 5 },
      { id: "same-thread", name: "Same thread", cwd: sharedRoot, projectId: "server-same", updatedAt: 4 },
      { id: "second-root-fallback", name: "Second root fallback", cwd: secondRoot + "/docs", updatedAt: 3 },
      { id: "unknown-project", name: "Unknown project", cwd: sharedRoot, projectId: "server-missing", updatedAt: 2 },
    ],
  });
  const projectRow = name => all(sidebar.render()).find(node =>
    node.props.className?.includes("sidebar-project-row") && node.props["aria-label"] === name);
  const projectGroup = name => {
    return all(sidebar.render()).find(node =>
      node.props.className === "sidebar-project-group" &&
      all(node).some(child => child.props?.["aria-label"] === name));
  };
  assert.ok(projectRow("Multi root"), "multi-root entity must render as one project row");
  assert.ok(projectRow("Same root"), "same-root entity must retain an independent project row");
  assert.equal(projectRow("Multi root").props.className.includes("selected"), false);
  assert.equal(projectRow("Same root").props.className.includes("selected"), true, "selected project identity wins over shared root path");
  assert.deepEqual(all(projectGroup("Multi root")).filter(node => node.props["data-thread-id"]).map(node => node.props["data-thread-id"]),
    ["multi-thread", "second-root-fallback"], "multi-root entity owns its second root scope");
  assert.deepEqual(all(projectGroup("Same root")).filter(node => node.props["data-thread-id"]).map(node => node.props["data-thread-id"]),
    ["same-thread"], "canonical assignment wins even when cwd is shared");
  assert.ok(renderedIds(sidebar).includes("unknown-project"), "unknown project stays in Recent");

  const multiRow = projectRow("Multi root");
  const callsBeforeDisclosure = sidebar.calls.length;
  multiRow.props.onClick({ currentTarget: multiRow, target: multiRow });
  assert.equal(sidebar.calls.length, callsBeforeDisclosure, "official expand branch must not select a workspace or project");
  assert.equal(projectRow("Multi root").props["aria-expanded"], false);
  assert.equal(projectRow("Same root").props["aria-expanded"], true, "same-root entity disclosure is independent");

  const newChat = all(projectGroup("Same root")).find(node => node.type === "button" && node.props.title?.startsWith("在 Same root"));
  newChat.props.onClick({ stopPropagation() {} });
  assert.equal(sidebar.calls.length, callsBeforeDisclosure + 1, "project new-chat delegates selection atomically to App instead of racing workspace writes");
  assert.deepEqual(sidebar.calls.at(-1), ["new-chat", sharedRoot, "same"], "entity new-chat action carries project identity");

  sidebar.props.createdThread = { id: "new-multi", cwd: secondRoot + "/src", projectId: "server-multi" };
  sidebar.props.threads.push({ id: "new-multi", name: "New multi", cwd: secondRoot + "/src", projectId: "server-multi", updatedAt: 10 });
  const organizerProps = all(sidebar.render()).find(node => node.type === "ThreadActionsMenu" && node.props.triggerAriaLabel === "聊天侧边栏选项")?.props;
  organizerProps.onSelect("sort-manual");
  sidebar.render();
  const saved = JSON.parse(sidebar.storage.get("codex_sidebar_manual_orders_v1"));
  assert.ok(saved["project:entity:multi"]?.includes("new-multi"), "manual order is keyed by entity id");
  assert.ok(!saved["project:d:/parity/shared"], "same-root entities must not reuse a path order key");
}
console.log("PASS local project entities in Sidebar: same-root identity, multi-root scope, disclosure isolation, Recent fallback and entity new-chat context (L2)");

const codexOnly = mount();
const codexOnlyNodes = all(codexOnly.render());
const brandHeading = codexOnlyNodes.find(node => node.props.className === "codex-brand-static-label");
assert.equal(brandHeading?.type, "div", "Codex-only mode must use the official static heading branch");
assert.equal(text(brandHeading), "Codex");
assert.equal(codexOnlyNodes.some(node => node.props.id === "codex-brand-product-menu"), false, "Codex-only mode must not render a mode menu");
assert.equal(codexOnlyNodes.some(node => node.props.className === "brand-product-option"), false, "unsupported ChatGPT/Work modes must not appear as placeholders");
console.log("PASS Codex-only Sidebar brand uses a static heading without unavailable mode placeholders (L2)");
