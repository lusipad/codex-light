import assert from "node:assert/strict";
import { mount } from "./verify-sidebar-projects.mjs";

// Execute the actual Sidebar. Focus/DOM boundaries are controlled; browser
// default button activation, bubbling and Tab movement require native evidence.
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const view = mount({
  onTogglePinThread: id => view.calls.push(["pin", id]),
  onArchiveThread: thread => view.calls.push(["archive", thread.id]),
});
const row = () => all(view.render()).find(n => n.props["data-thread-id"] === "a1");
const menu = () => all(view.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "会话操作");
const item = label => all(menu()).find(n => n.props.role === "menuitem" && text(n).includes(label));
const event = (node, key, extra = {}) => ({
  key, currentTarget: view.element(node), target: view.element(node), clientX: 120, clientY: 150,
  defaultPrevented: false, stopped: false, isComposing: false,
  nativeEvent: { isComposing: extra.isComposing || false },
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.stopped = true; }, ...extra,
});
const openContext = () => {
  const node = row();
  view.element(node).focus();
  const ev = event(node);
  node.props.onContextMenu(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.stopped, true);
  assert.ok(menu(), "right click must render an accessible thread menu");
  assert.deepEqual(view.calls, [], "opening context menu must not select a thread");
  assert.equal(view.document.activeElement, view.element(item("重命名")), "first action must receive focus after opening");
};
const menuKey = key => {
  const node = menu();
  const ev = event(node, key, { target: view.document.activeElement });
  node.props.onKeyDown(ev);
  view.render();
  return ev;
};
openContext();
const mainActions = () => all(menu()).filter(n => n.type === "button" && n.props.role === "menuitem").map(text);
assert.deepEqual(mainActions(), ["重命名", "置顶", "移至分区", "归档"], "local sidebar actions follow official organization then lifecycle order");
assert.equal(text(menu()).includes("会话操作"), false, "the menu has no extra visible section heading");
assert.equal(text(menu()).includes("打开聊天"), false, "opening the row is not duplicated as a menu action");
assert.equal(/[📌✏️📦💬]/u.test(text(menu())), false, "menu labels use locale text without emoji substitutes");
for (const [key, label] of [["End", "归档"], ["Home", "重命名"], ["ArrowUp", "归档"], ["ArrowDown", "重命名"], ["ArrowDown", "置顶"], ["ArrowDown", "移至分区"]]) {
  const ev = menuKey(key);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.stopped, true);
  assert.equal(view.document.activeElement, view.element(item(label)), `${key} must move among real menu buttons`);
}
for (const node of all(menu()).filter(n => n.props.role === "menuitem")) assert.equal(node.type, "button");
let esc = event(menu(), "Escape");
view.dispatch("document", "keydown", esc);
assert.equal(menu(), undefined);
assert.equal(esc.defaultPrevented, true);
assert.equal(esc.stopped, true);
assert.equal(view.document.activeElement, view.element(row()), "Escape must restore the previous connected element");
for (const key of ["ContextMenu", "F10"]) {
  let node = row(), ev = event(node, key, { shiftKey: key === "F10" });
  node.props.onKeyDown(ev);
  assert.ok(menu(), `${key} must open the same thread menu`);
  assert.equal(ev.stopped, true);
  view.dispatch("document", "keydown", event(menu(), "Escape"));
  view.render();
}
for (const extra of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }, { isComposing: true }, { target: {} }]) {
  const node = row(); node.props.onKeyDown(event(node, "F10", { shiftKey: true, ...extra }));
  assert.equal(menu(), undefined, `nested/modified/prevented/IME event must not open menu: ${JSON.stringify(extra)}`);
}
const plainF10 = row(); plainF10.props.onKeyDown(event(plainF10, "F10"));
assert.equal(menu(), undefined);
openContext();
const container = view.element(menu()), child = view.element(item("置顶"));
view.dispatch("window", "scroll", { target: container }); assert.ok(menu(), "menu scrolling must not close itself");
view.dispatch("window", "scroll", { target: child }); assert.ok(menu(), "internal scrolling must not close itself");
view.dispatch("document", "mousedown", { target: child }); assert.ok(menu(), "menu pointerdown must not close itself");
const outside = { focus() { view.document.activeElement = outside; } };
outside.focus();
view.dispatch("document", "mousedown", { target: outside }); assert.equal(menu(), undefined);
assert.equal(view.document.activeElement, outside, "outside click must not steal focus");
openContext();
const tab = menuKey("Tab");
assert.equal(menu(), undefined);
assert.equal(tab.defaultPrevented, false, "Tab must keep browser default focus navigation");
assert.notEqual(view.document.activeElement, view.element(row()), "Tab must not restore the trigger");
for (const type of ["scroll", "resize"]) {
  openContext(); outside.focus(); view.dispatch("window", type, { target: outside });
  assert.equal(menu(), undefined); assert.equal(view.document.activeElement, outside);
}
openContext();
const pin = item("置顶"); pin.props.onClick(event(pin));
assert.equal(menu(), undefined);
assert.deepEqual(view.calls, [["pin", "a1"]], "action must call the real callback for the target thread once");
view.calls.length = 0;
const more = all(row()).find(n => n.type === "button" && n.props.title === "更多操作");
assert.equal(more.props["aria-haspopup"], "menu");
view.element(more).focus();
more.props.onClick(event(more));
assert.ok(menu());
assert.equal(all(row()).find(n => n.props.title === "更多操作").props["aria-expanded"], true);
view.dispatch("document", "keydown", event(menu(), "Escape"));
assert.equal(menu(), undefined);
assert.equal(view.document.activeElement, view.element(more), "more button must regain its own focus");
openContext();
view.props.collapsed = true; view.render(); view.render();
view.props.collapsed = false; assert.equal(menu(), undefined, "collapse must discard the hidden menu");
openContext();
view.props.threads = view.props.threads.filter(t => t.id !== "a1"); view.render(); view.render();
assert.equal(menu(), undefined);
const hiddenEscape = { key: "Escape", preventDefault() { throw new Error("hidden menu listener leaked"); } };
view.dispatch("document", "keydown", hiddenEscape);
view.unmount();
assert.equal(view.listenerCount(), 0, "unmount must release all listeners");
console.log("PASS actual sidebar thread menu: context/keyboard entry, navigation, callback, focus, outside/Tab/scroll/collapse/removal and cleanup (L2; not native or official runtime parity)");

const projectCalls = [];
const projectView = mount({
  threads: [{ id: "a1", name: "Alpha thread", cwd: "D:/parity/alpha", projectId: "server-alpha" }],
  projectMembership: {
    threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {},
    localProjects: [
      { id: "alpha", name: "Alpha", rootPaths: ["D:/parity/alpha"], createdAt: 1, serverProjectId: "server-alpha" },
      { id: "beta", name: "Beta", rootPaths: ["D:/parity/beta"], createdAt: 2, serverProjectId: "server-beta" },
    ],
  },
  onMoveThreadToProject: (threadId, projectId) => projectCalls.push([threadId, projectId]),
});
const projectRow = () => all(projectView.render()).find(n => n.props["data-thread-id"] === "a1");
const projectMenu = () => all(projectView.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "会话操作");
const projectEvent = node => ({
  currentTarget: projectView.element(node), target: projectView.element(node), clientX: 120, clientY: 150,
  preventDefault() {}, stopPropagation() {},
});
projectRow().props.onContextMenu(projectEvent(projectRow()));
projectView.render();
const moveProject = all(projectMenu()).find(n => n.type === "button" && n.props.role === "menuitem" && text(n).includes("移至项目"));
assert.ok(moveProject, "mapped local project threads expose the project move action");
moveProject.props.onClick(projectEvent(moveProject));
projectView.render();
const projectsSubmenu = all(projectView.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "项目");
assert.ok(projectsSubmenu, "project move opens its own submenu");
assert.equal(
  projectView.document.activeElement,
  projectView.element(all(projectsSubmenu).find(n => n.type === "button")),
  "keyboard activation focuses the first project target",
);
assert.deepEqual(
  all(projectsSubmenu).filter(n => n.type === "button" && n.props.role === "menuitem").map(text),
  ["Alpha", "Beta", "聊天"],
  "targets are mapped local projects followed by Chats",
);
projectView.dispatch("document", "keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
assert.ok(projectMenu(), "Escape from project submenu returns to the parent menu");
assert.equal(projectView.document.activeElement, projectView.element(moveProject), "Escape restores focus to the project submenu trigger");
moveProject.props.onClick(projectEvent(moveProject));
projectView.render();
const beta = all(projectsSubmenu).find(n => n.type === "button" && text(n) === "Beta");
beta.props.onClick(projectEvent(beta));
assert.deepEqual(projectCalls, [["a1", "server-beta"]], "the selected thread id and server project id reach the transaction callback");
assert.equal(projectMenu(), undefined, "selecting a project closes the row menu");
projectView.unmount();
console.log("PASS sidebar project move submenu: only mapped local threads, target choices and selected thread transaction callback (L2)");
