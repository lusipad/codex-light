import assert from "node:assert/strict";
import { mount } from "./verify-sidebar-projects.mjs";

// Execute the production sidebar with the existing controlled hooks/service
// fixture. This proves projection and actual callbacks, not browser/native UI.
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const rows = view => all(view.render()).filter(node => node.props["data-thread-id"]);
const ids = view => rows(view).map(node => node.props["data-thread-id"]);
const button = (view, label) => all(view.render()).find(node => node.type === "button" && text(node) === label);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const threads = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`, name: `Session ${i}`, updatedAt: i, cwd: "D:/parity/alpha",
  section: "custom", readState: { revision: `r${i}`, firstUnread: { type: "threadStart" } },
}));
const sessionIds = [...threads].reverse().map(thread => thread.id);
const base = { threads, activityOnly: true, activityThreadIds: sessionIds, onLoadMoreActivity() {} };
let cases = 0;
{
  const view = mount(base);
  assert.deepEqual(ids(view), sessionIds.slice(0, 10), "01 default limit is ten ordered priority members without project duplicates"); cases++;
}
{
  const view = mount({ ...base, activityVisibleCount: 12 });
  assert.deepEqual(ids(view), sessionIds, "02 explicit parent limit reveals remaining members"); cases++;
}
{
  let count = 0;
  const view = mount({ ...base, onLoadMoreActivity: () => { count++; view.props.activityVisibleCount = 20; } });
  button(view, "展开显示").props.onClick();
  assert.equal(count, 1);
  assert.deepEqual(ids(view), sessionIds);
  assert.equal(button(view, "展开显示"), undefined, "03 actual pagination callback reveals final page and disappears"); cases++;
}
{
  const view = mount({ ...base, activityThreadIds: ["t2", "missing", "t1", "t2", "t0"] });
  assert.deepEqual(ids(view), ["t2", "t1", "t0"], "04 join omits missing ids and duplicates, preserving session order over recency"); cases++;
}
{
  const view = mount(base);
  view.props.threads = threads.map(thread => ({ ...thread, updatedAt: 100 - thread.updatedAt, name: `Updated ${thread.id}`, readState: { revision: "read", firstUnread: null }, status: { type: "idle" } }));
  assert.deepEqual(ids(view), sessionIds.slice(0, 10));
  assert.ok(text(rows(view)[0]).includes("Updated t11"), "05 current summary joins retained ids after read/end without reordering"); cases++;
}
{
  const storage = new Map([["codex_sidebar_sort_mode", "manual"], ["codex_sidebar_manual_orders_v1", JSON.stringify({ recent: ["t0", "t1"] })]]);
  const view = mount(base, storage);
  view.render(); view.render();
  assert.deepEqual(ids(view), sessionIds.slice(0, 10), "06 ordinary manual order cannot reorder priority");
  assert.deepEqual(JSON.parse(storage.get("codex_sidebar_manual_orders_v1")).recent, ["t0", "t1"], "Activity must not overwrite ordinary manual order");
  assert.ok(rows(view).every(row => !row.props["data-order-group"]), "Activity does not offer manual drag/keyboard reordering"); cases++;
}
{
  const view = mount({ ...base, pinnedThreadIds: ["t11", "t10"] });
  assert.deepEqual(ids(view), sessionIds.slice(0, 10));
  assert.ok(!text(view.render()).includes("置顶"), "07 default Activity pin membership remains in priority without a duplicate pin group"); cases++;
}
{
  const view = mount(base, new Map(), false, { listSections: async () => [{ id: "custom", name: "Custom" }] });
  view.render(); await flush();
  assert.deepEqual(ids(view), sessionIds.slice(0, 10));
  assert.ok(!text(view.render()).includes("自定义分区"));
  assert.ok(!all(view.render()).some(node => node.type === "ThreadActionsMenu" && ["项目侧边栏选项", "聊天侧边栏选项"].includes(node.props.triggerAriaLabel)), "08 ordinary organization controls and custom/project duplication are absent"); cases++;
}
function search(view, value) {
  all(view.render()).find(node => node.type === "button" && node.props.title === "搜索聊天").props.onClick();
  all(view.render()).find(node => node.type === "input" && node.props.placeholder === "搜索聊天或任务...").props.onChange({ target: { value } });
}
{
  const view = mount(base);
  search(view, "Session 11");
  assert.deepEqual(ids(view), ["t11"]);
  assert.deepEqual(view.props.activityThreadIds, sessionIds, "09 search only projects session and does not change parent membership"); cases++;
}
{
  const view = mount(base);
  search(view, "Session 0");
  assert.deepEqual(ids(view), [], "10 search cannot promote an item outside visible page");
  assert.ok(button(view, "展开显示")); cases++;
}
{
  let bulk = 0;
  const view = mount({ ...base, onMarkAllRead: () => bulk++ });
  search(view, "Session 11");
  button(view, "全部已读").props.onClick();
  assert.equal(bulk, 1);
  assert.deepEqual(view.props.activityThreadIds, sessionIds, "11 bulk callback retains full parent scope beyond page/search"); cases++;
}
{
  const view = mount({ ...base, activityOnly: false, pinnedThreadIds: ["t0"] });
  assert.ok(text(view.render()).includes("置顶"));
  assert.ok(all(view.render()).some(node => node.type === "ThreadActionsMenu" && node.props.triggerAriaLabel === "聊天侧边栏选项"));
  assert.equal(button(view, "全部已读"), undefined);
  assert.equal(typeof button(view, "展开显示")?.props.onClick, "function", "12 normal projects retain their independent pagination"); cases++;
}
console.log(`PASS ${cases} Activity production-sidebar session projection sequences (L2; no browser/native/official pixel claim)`);
