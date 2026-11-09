import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const tasks = [
  { id: "active-task", name: "Active fixture", status: "ACTIVE", kind: "cron", prompt: "Inspect fixture only",
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", cwds: ["fixture-repo"], executionEnvironment: "local", model: null },
  { id: "paused-task", name: "Paused fixture", status: "PAUSED", kind: "cron", prompt: "Paused fixture only",
    rrule: "FREQ=DAILY;BYHOUR=10;BYMINUTE=0", cwds: ["fixture-repo"], executionEnvironment: "local", model: null },
];
const flush = async () => { for (let i = 0; i < 40; ++i) await Promise.resolve(); };
function surface(props = {}) {
  let cursor = 0, tree, pending = [];
  const slots = [], calls = [], timers = new Map(); let timerId = 0, stopped = 0;
  const document = { activeElement: null };
  const control = { list: tasks, confirm: true, confirmations: [], scheduler: null, markRead: async () => true,
    delete: async id => tasks.filter(task => task.id !== id),
    save: async item => [...tasks.filter(task => task.id !== item.id), { ...item, id: item.id || "created-fixture" }] };
  const descendants = node => [node, ...node.children.filter(child => child && typeof child === "object").flatMap(descendants)];
  const changed = (old, deps) => !old || !deps || deps.length !== old.deps?.length || deps.some((value, i) => !Object.is(value, old.deps[i]));
  const react = {
    createElement: (type, props, ...children) => {
      const node = { type, props: { ...props }, children: children.flat(Infinity), parentElement: null };
      node.focus = () => { document.activeElement = node; };
      node.querySelector = selector => descendants(node).slice(1).find(child => child.type === selector);
      node.querySelectorAll = selector => descendants(node).slice(1).filter(child => child.type === selector);
      node.closest = selector => { let value = node; while (value) {
        if (selector.startsWith(".") && value.props.className?.split(" ").includes(selector.slice(1))) return value;
        value = value.parentElement;
      } return null; };
      for (const child of node.children) if (child && typeof child === "object") child.parentElement = node;
      if (node.props.onClick) { const click = node.props.onClick; node.props.onClick = event => click(event || { currentTarget: node, target: node }); }
      return node;
    },
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++, old = slots[i];
      if (changed(old, deps)) pending.push(() => { old?.stop?.(); slots[i] = { deps, stop: fn() }; }); },
    useMemo: (fn, deps) => { const i = cursor++; if (changed(slots[i], deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
  };
  const scheduler = {
    getSchedulerStatus: async () => { if (control.scheduler) return control.scheduler; throw Object.assign(Error("scheduler unavailable fixture"), { unavailable: true }); },
    isSchedulerUnavailableError: error => error?.unavailable === true,
    refreshSchedule: async () => { throw Error("unexpected refresh"); },
    runAutomationNow: async id => { calls.push({ method: "automations_run_now", args: { id } }); return { threadId: "fixture-thread" }; },
    markActivityRunRead: async (...args) => {
      calls.push({ method: "automations_mark_activity_run_read", args });
      return control.markRead(...args);
    },
    subscribeAutomationEvents: listener => { control.emit = listener; return () => { ++stopped; }; },
  };
  const bridge = { tauriInvoke: async (method, args) => {
    calls.push({ method, args });
    if (method === "automations_list") return typeof control.list === "function" ? control.list() : control.list;
    if (method === "automation_save") return control.save(args.item);
    if (method === "automation_delete") return control.delete(args.id);
    throw Error(`Unexpected command ${method}`);
  } };
  const window = { setInterval: fn => { timers.set(++timerId, fn); return timerId; },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/AutomationsView.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, window, document, confirm: message => { control.confirmations.push(message); return control.confirm; }, require: name => {
    if (name === "react") return react;
    if (name === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
    if (name === "../bridge") return bridge;
    if (name === "../automationsClient") return scheduler;
    if (name === "./ThreadActionsMenu") return { ThreadActionsMenu: "ThreadActionsMenu" };
    if (name === "../types" || name.endsWith(".css")) return {};
    throw Error(`Unexpected dependency ${name}`);
  } });
  const render = () => { cursor = 0; tree = exports.AutomationsView({ activeWorkspaceRoot: "fixture-repo", models: [{ id: "fixture-model", model: "fixture-model", displayName: "Fixture model" }], ...props }); };
  const effects = () => { const queue = pending; pending = []; for (const fn of queue) fn(); };
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(walk)];
  const content = node => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(content).join(" ") : String(node);
  const button = label => walk(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || content(node).trim() === label));
  const menu = () => walk(tree).find(node => node.type === "ThreadActionsMenu" && node.props.triggerAriaLabel === "已安排任务操作");
  const selectAction = id => {
    const actionMenu = menu();
    const item = actionMenu.props.items.find(item => item.id === id);
    assert.ok(item && !item.disabled, `available menu action ${id}`);
    return actionMenu.props.onSelect(id);
  };
  return { calls, control, render, effects, nodes: () => walk(tree), text: () => content(tree), button,
    menu, selectAction,
    settle: async () => { await flush(); render(); effects(); },
    unmount: () => { for (const slot of slots) slot?.stop?.(); assert.equal(timers.size, 0); assert.equal(stopped, 1); } };
}

for (const owner of ["current-thread", "other-thread"]) {
  let closed = 0;
  const drawer = surface({ threadTask: { id: "paused-task", threadId: "current-thread", onClose: () => { ++closed; } } });
  drawer.control.list = tasks.map(task => ({ ...task, targetThreadId: owner }));
  drawer.render(); drawer.effects(); await drawer.settle();
  assert.equal(drawer.button("添加"), undefined);
  assert.equal(drawer.button("Active fixture"), undefined);
  if (owner === "current-thread") {
    assert.match(drawer.text(), /Paused fixture/);
    assert.ok(drawer.button("编辑任务"));
    assert.ok(drawer.menu());
  } else {
    assert.match(drawer.text(), /未找到已安排任务/);
    assert.doesNotMatch(drawer.text(), /Paused fixture/);
    assert.equal(drawer.button("编辑任务"), undefined);
    assert.equal(drawer.menu(), undefined);
  }
  const keydown = drawer.nodes()[0].props.onKeyDown;
  const event = { key: "Escape", nativeEvent: { isComposing: true }, preventDefault() {}, stopPropagation() {} };
  keydown(event);
  assert.equal(closed, 0);
  keydown({ ...event, nativeEvent: {} });
  assert.equal(closed, 1);
  assert.ok(drawer.calls.every(call => call.method === "automations_list"));
  drawer.unmount();
}
console.log("PASS 10H02–10H03 read-only detail scope, thread ownership and Escape/IME guard");

{
  let refreshes = 0, reject;
  const view = surface({ onRunRead: () => { ++refreshes; } });
  const unread = { id: "active-task", lastRunAt: 100, lastStatus: "completed", lastThreadId: "shared", lastRunUnread: true };
  view.control.scheduler = { entries: [unread] };
  view.control.markRead = () => new Promise((_, fail) => { reject = fail; });
  const receipts = () => view.calls.filter(call => call.method === "automations_mark_activity_run_read");
  view.render(); view.effects(); await view.settle();
  assert.equal(receipts().length, 0, "a list load is not a detail visit");
  view.button("Active fixture").props.onClick(); await view.settle();
  assert.deepEqual(receipts().map(call => Array.from(call.args)), [["active-task", 100, "shared"]]);
  view.button("编辑任务").props.onClick(); await view.settle();
  reject(Error("write denied after leaving")); await view.settle();
  assert.doesNotMatch(view.text(), /write denied/);
  assert.equal(refreshes, 0);
  view.control.markRead = async () => { throw Error("write denied in detail"); };
  view.button("关闭任务详情").props.onClick(); await view.settle(); await view.settle();
  assert.match(view.text(), /write denied in detail/);
  assert.equal(receipts().length, 2, "failure is stable until another detail visit");
  view.button("关闭任务详情").props.onClick(); await view.settle();
  view.control.emit({ kind: "started", id: "active-task", name: "Active fixture", at: 200 });
  await view.settle();
  view.button("Active fixture").props.onClick(); await view.settle();
  assert.equal(receipts().length, 2, "a newer displayed running record blocks the stale completed snapshot");
  view.control.scheduler = { entries: [{ ...unread, lastRunAt: 200 }] };
  view.control.markRead = async () => {
    view.control.scheduler = { entries: [{ ...unread, lastRunAt: 200, lastRunUnread: false }] };
    return true;
  };
  view.control.emit({ kind: "finished", id: "active-task", name: "Active fixture", startedAt: 200,
    status: "completed", finishedAt: 210, threadId: "shared" });
  await view.settle(); await view.settle();
  assert.deepEqual(Array.from(receipts().at(-1).args), ["active-task", 200, "shared"]);
  assert.equal(refreshes, 1);
  assert.equal(receipts().length, 3);
  view.unmount();
}
console.log("PASS 10L detail receipts: exact displayed run, editing, stale responses, error and authoritative refresh");

{
  const opened = [];
  const view = surface({ onSelectThread: id => opened.push(["latest", id]), onSelectHistoryThread: id => opened.push(["history", id]) });
  const saved = (automationId, startedAt, status, threadId, error = null) =>
    ({ automationId, startedAt, finishedAt: startedAt + 10, status, threadId, error });
  view.control.scheduler = { entries: [{ id: "active-task", lastRunAt: 300, lastStatus: "completed", lastThreadId: "new" }],
    recentRuns: [
      saved("active-task", 100, "completed", "older"),
      saved("other", 400, "failed", null, "foreign error"),
      saved("active-task", 300, "completed", "new"),
      saved("active-task", 200, "failed", null, "no chat created"),
    ] };
  view.render(); view.effects(); await view.settle();
  view.button("Active fixture").props.onClick(); await view.settle();
  view.control.emit({ kind: "started", id: "active-task", name: "Active fixture", at: 300 });
  await view.settle();
  const rows = view.nodes().filter(node => node.props.className === "automation-run-result");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.children[0].children[0]), ["成功", "失败", "成功"]);
  assert.match(view.text(), /运行历史记录.*no chat created/);
  assert.doesNotMatch(view.text(), /foreign error/);
  const links = view.nodes().filter(node => node.type === "button" && node.children.includes("查看会话"));
  assert.equal(links.length, 2, "failure without a chat has no link");
  links.forEach(link => link.props.onClick());
  assert.deepEqual(opened, [["latest", "new"], ["history", "older"]]);
  view.unmount();
}

const h = surface(); h.render(); h.effects(); await h.settle();
assert.ok(h.nodes().some(node => /^h[1-3]$/.test(node.type) && node.children.join("") === "定时任务"), "official local configuration region uses its documented title");
assert.ok(h.button("添加"));
assert.doesNotMatch(h.text(), /~\/\.codex|automation\.toml|当前时间|已配置.*个任务|推荐预设模板|每日代码质量|每周一依赖|长期目标 \/goal/u);
assert.ok(h.button("Active fixture")); assert.equal(h.button("Paused fixture"), undefined, "default active filter excludes paused local tasks");
assert.equal(h.button("立即运行"), undefined, "row actions belong in selected details rather than every row");
assert.equal(h.menu(), undefined);
for (const label of ["任务", "下次运行", "已安排"]) assert.match(h.text(), new RegExp(label));
const search = h.nodes().find(node => node.type === "input" && node.props.placeholder === "搜索任务");
assert.ok(search); assert.equal(search.props.maxLength, 256);
h.button("筛选和排序任务").props.onClick(); h.render();
h.button("已暂停").props.onClick(); h.render();
assert.ok(h.button("Paused fixture")); assert.equal(h.button("Active fixture"), undefined);
h.button("筛选和排序任务").props.onClick(); h.render(); h.button("全部").props.onClick(); h.render();
assert.ok(h.button("Active fixture")); assert.ok(h.button("Paused fixture"));
h.nodes().find(node => node.type === "input" && node.props.placeholder === "搜索任务").props.onChange({ target: { value: "Paused fixture" } }); h.render();
assert.equal(h.button("Active fixture"), undefined); assert.ok(h.button("Paused fixture"));
h.nodes().find(node => node.type === "input" && node.props.placeholder === "搜索任务").props.onChange({ target: { value: "" } }); h.render();
h.button("Active fixture").props.onClick(); h.render();
assert.equal(h.nodes().some(node => node.props["aria-modal"] === true), false, "documented local detail outlet is not forced into a modal");
assert.ok(h.button("编辑任务"));
assert.deepEqual(Array.from(h.menu().props.items, item => item.label), ["立即运行", "暂停", "删除"]);
assert.equal(h.menu().props.items.at(-1).danger, true);
assert.equal(h.button("删除"), undefined, "danger action stays within the menu");
const before = h.calls.length;
await h.selectAction("run"); await h.settle();
assert.equal(h.calls.length, before, "unavailable scheduler never invokes a run or implicit fallback");
assert.match(h.text(), /尚未运行/, "actual callback reports that the task did not run");
const presented = [h.text(), ...h.nodes().map(node => node.props.title || "")].join("\n");
assert.doesNotMatch(presented, /回退.{0,12}(?:执行|运行)/u, "visible text and titles must not promise an execution fallback that the handler forbids");
h.unmount();
const status = surface();
status.control.list = [...tasks, { ...tasks[0], id: "completed-local", name: "Completed local fixture", status: "COMPLETED" },
  { ...tasks[0], id: "deleted-local", name: "Deleted local fixture", status: "DELETED" }];
status.render(); status.effects(); await status.settle();
assert.ok(status.button("Completed local fixture"), "local non-PAUSED status remains active rather than a finished run filter");
assert.equal(status.button("Deleted local fixture"), undefined);
status.button("筛选和排序任务").props.onClick(); status.render(); status.button("已完成").props.onClick(); status.render();
assert.equal(status.button("Completed local fixture"), undefined, "finished is not inferred from local status or a completed single run");
status.unmount();
const create = surface(); create.render(); create.effects(); await create.settle();
create.button("添加").props.onClick(); create.render();
assert.ok(create.nodes().some(node => node.type === "textarea"), "add opens real configuration fields");
assert.equal(create.nodes().some(node => node.props["aria-modal"] === true), false);
const nameField = () => create.nodes().find(node => node.type === "input" && node.props.placeholder !== "搜索任务" && node.props.value === "");
assert.ok(nameField()); nameField().props.onChange({ target: { value: "New fixture" } });
create.nodes().find(node => node.type === "textarea").props.onChange({ target: { value: "Inspect only fixture" } }); create.render();
const saveButton = () => create.button("创建") || create.button("保存修改");
assert.ok(saveButton()); create.control.save = async () => { throw Error("save fixture denied"); };
await saveButton().props.onClick(); await create.settle();
assert.ok(create.nodes().some(node => node.type === "input" && node.props.value === "New fixture"));
assert.ok(create.nodes().some(node => node.type === "textarea" && node.props.value === "Inspect only fixture"));
assert.match(create.text(), /save fixture denied/);
create.control.save = async item => [...tasks, { ...item, id: "created-fixture" }];
await saveButton().props.onClick(); await create.settle();
assert.ok(create.button("New fixture")); assert.equal(create.nodes().some(node => node.type === "textarea"), false);
create.button("添加").props.onClick(); create.render(); const writes = create.calls.filter(call => call.method === "automation_save").length;
create.button("取消").props.onClick(); create.render();
assert.equal(create.calls.filter(call => call.method === "automation_save").length, writes);
assert.equal(create.nodes().some(node => node.type === "textarea"), false); create.unmount();
const edits = surface(); edits.render(); edits.effects(); await edits.settle();
edits.button("Active fixture").props.onClick(); edits.render();
await edits.selectAction("status"); await edits.settle();
assert.equal(edits.calls.filter(call => call.method === "automation_save").at(-1).args.item.status, "PAUSED");
assert.equal(edits.menu().props.items.find(item => item.id === "status").label, "继续");
await edits.selectAction("status"); await edits.settle();
assert.equal(edits.calls.filter(call => call.method === "automation_save").at(-1).args.item.status, "ACTIVE");
const deleteDialog = () => edits.nodes().find(node => node.type === "dialog");
const deleteCalls = () => edits.calls.filter(call => call.method === "automation_delete");
const event = { preventDefault() {}, stopPropagation() {} };
const submit = () => deleteDialog().querySelector("form").props.onSubmit(event);
for (const dismiss of [
  () => edits.button("取消").props.onClick(),
  () => edits.button("关闭").props.onClick(),
  () => deleteDialog().props.onCancel(event),
  () => {
    const dialog = deleteDialog();
    dialog.getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 100 });
    dialog.props.onMouseDown({ target: dialog, currentTarget: dialog, clientX: 5, clientY: 20 });
  },
]) {
  edits.selectAction("delete"); await edits.settle();
  assert.equal(deleteDialog().props.role, "alertdialog");
  assert.match(edits.text(), /删除\s+Active fixture\s+？/);
  assert.match(edits.text(), /这将永久删除定时任务，并停止日后的运行/);
  assert.equal(deleteCalls().length, 0);
  dismiss(); await edits.settle();
  assert.equal(deleteDialog(), undefined);
  assert.equal(deleteCalls().length, 0, "cancelled confirmation cannot delete");
  assert.ok(edits.button("Active fixture"));
}
edits.selectAction("delete"); await edits.settle();
deleteDialog().props.onCompositionStart();
deleteDialog().props.onCancel(event);
submit(); await edits.settle();
assert.ok(deleteDialog(), "IME cancellation keeps the dialog open");
assert.equal(deleteCalls().length, 0);
deleteDialog().props.onCompositionEnd();
let rejectDelete;
edits.control.delete = () => new Promise((_, reject) => { rejectDelete = reject; });
submit(); submit(); deleteDialog().props.onCancel(event);
await edits.settle();
assert.equal(deleteCalls().length, 1);
assert.equal(deleteDialog().props["aria-busy"], true);
assert.equal(edits.button("取消").props.disabled, true);
assert.equal(edits.button("关闭"), undefined);
rejectDelete(Error("fixture denied")); await edits.settle();
assert.match(edits.text(), /删除任务失败：Error: fixture denied/);
assert.ok(edits.button("Active fixture"));
edits.control.delete = async id => tasks.filter(task => task.id !== id);
submit(); await edits.settle();
assert.equal(deleteCalls().length, 2);
assert.equal(deleteCalls().at(-1).args.id, "active-task");
assert.equal(deleteDialog(), undefined);
assert.equal(edits.button("Active fixture"), undefined);
edits.unmount();

const failed = surface(); let resolveList;
failed.control.list = () => new Promise(resolve => { resolveList = resolve; });
failed.render(); failed.effects(); await failed.settle();
assert.match(failed.text(), /正在加载任务/); assert.doesNotMatch(failed.text(), /没有符合筛选条件的任务/);
resolveList([]); await failed.settle(); assert.match(failed.text(), /没有符合筛选条件的任务/); failed.unmount();
const retry = surface(); retry.control.list = async () => { throw Error("list fixture denied"); };
retry.render(); retry.effects(); await retry.settle();
assert.match(retry.text(), /list fixture denied/); assert.doesNotMatch(retry.text(), /没有符合筛选条件的任务/);
retry.control.list = tasks; await retry.button("重试").props.onClick(); await retry.settle();
assert.ok(retry.button("Active fixture")); retry.unmount();

const sorting = surface();
sorting.control.list = [{ ...tasks[0], id: "z", name: "Zulu fixture", updatedAt: 100 },
  { ...tasks[0], id: "a", name: "Alpha fixture", updatedAt: 200 }];
sorting.control.scheduler = { running: true, now: 0, entries: [{ id: "z", nextRunAt: 1000 }, { id: "a", nextRunAt: 2000 }] };
sorting.render(); sorting.effects(); await sorting.settle();
const readCount = sorting.calls.length;
for (const [label, expected] of [["名称", ["Alpha fixture", "Zulu fixture"]], ["下次运行", ["Zulu fixture", "Alpha fixture"]], ["最近更新", ["Alpha fixture", "Zulu fixture"]]]) {
  sorting.button("筛选和排序任务").props.onClick(); sorting.render(); sorting.button(label).props.onClick(); sorting.render();
  const names = sorting.nodes().filter(node => node.type === "button" && /^(Alpha|Zulu) fixture$/.test(node.props["aria-label"] || "")).map(node => node.props["aria-label"]);
  assert.deepEqual(names, expected, `${label} sorts only loaded local rows`);
  assert.equal(sorting.calls.length, readCount, "local filtering/sorting does not trigger writes or extra list calls");
}
sorting.unmount();
const dirtyFailures = [];
for (const [field, value] of [["schedule", "FREQ=HOURLY;INTERVAL=1"], ["environment", "local"], ["model", "fixture-model"]]) {
  for (const exit of ["close", "add", "row", "cancel"]) {
    const draft = surface();
    try {
      draft.render(); draft.effects(); await draft.settle(); draft.button("添加").props.onClick(); draft.render();
      const selects = draft.nodes().filter(node => node.type === "select");
      if (field === "schedule") draft.nodes().find(node => node.type === "input" && String(node.props.value).startsWith("FREQ=")).props.onChange({ target: { value } });
      if (field === "environment") selects.find(node => node.children.some(child => child?.props?.value === "worktree")).props.onChange({ target: { value } });
      if (field === "model") selects.find(node => node.children.some(child => child?.props?.value === "")).props.onChange({ target: { value } });
      draft.render(); draft.control.confirm = false;
      const exitButton = exit === "close" ? "关闭任务详情" : exit === "add" ? "添加" : exit === "row" ? "Active fixture" : "取消";
      draft.button(exitButton).props.onClick(); draft.render();
      assert.equal(draft.control.confirmations.length, 1, `${field}-only draft asks before ${exit}`);
      assert.ok(draft.nodes().some(node => node.type === "textarea"), `declined ${exit} keeps configuration`);
      assert.ok(draft.nodes().some(node => ["input", "select"].includes(node.type) && node.props.value === value), `${field} draft remains intact`);
    } catch (error) { dirtyFailures.push(`${field}/${exit}: ${error.message}`); }
    finally { draft.unmount(); }
  }
}
for (const exit of ["关闭任务详情", "取消"]) {
  const edit = surface();
  try {
    edit.render(); edit.effects(); await edit.settle(); edit.button("Active fixture").props.onClick(); edit.render();
    edit.button("编辑任务").props.onClick(); edit.render(); edit.control.confirm = true;
    edit.button(exit).props.onClick(); edit.render();
    assert.equal(edit.nodes().some(node => node.type === "textarea"), false);
    assert.ok(edit.nodes().some(node => node.type === "aside" && node.props["aria-label"] === "任务详情"), `${exit} from editing returns to selected detail`);
    assert.ok(edit.menu(), `${exit} preserves selected task actions`);
  } catch (error) { dirtyFailures.push(`edit/${exit}: ${error.message}`); }
  finally { edit.unmount(); }
}
for (const failure of dirtyFailures) console.error(`FAIL ${failure}`);
assert.equal(dirtyFailures.length, 0, "configuration discard protection and edit-to-detail navigation");
console.log("PASS production Automation JSX: documented local table/filter/search/detail, actual unavailable callback, create failure/retry/cancel and cleanup");
console.log("PASS actual pause/resume/delete confirmation, loading/error/retry and name/next-run/update local sorting");
const summaries = surface();
const clockLabel = (hour, minute) => new Intl.DateTimeFormat("zh-CN", { hour: "numeric", minute: "2-digit" })
  .format(new Date(2024, 0, 1, hour, minute));
const scheduleCases = [
  ["Daily", "rrule:byminute=0;FREQ=DAILY;byhour=9", `每天 ${clockLabel(9, 0)}`],
  ["Weekdays", "BYDAY=FR,MO,TH,TU,WE;BYHOUR=9;FREQ=WEEKLY;BYMINUTE=30", `工作日 ${clockLabel(9, 30)}`],
  ["Weekend", "FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=9;BYMINUTE=30", `周末 ${clockLabel(9, 30)}`],
  ["Monday", "BYDAY=MO;FREQ=WEEKLY;BYHOUR=10;BYMINUTE=0", "星期一（时间：10:00）"],
  ["Two days", "FREQ=WEEKLY;BYDAY=MO,SU;BYHOUR=10;BYMINUTE=0", "星期日和星期一（时间：10:00）"],
  ["Hours", "INTERVAL=2;FREQ=HOURLY;BYMINUTE=0", "每 2 小时"],
  ["Hours with all days", "FREQ=HOURLY;BYDAY=SU,MO,TU,WE,TH,FR,SA", "每小时"],
  ["Forty-eight hours", "FREQ=HOURLY;INTERVAL=48", "每2 天"],
  ["Hourly with ignored day restriction", "FREQ=HOURLY;BYDAY=MO", "自定义安排"],
  ["Alternating weeks", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=10;BYMINUTE=0", "自定义安排"],
  ["Invalid hour", "FREQ=DAILY;BYHOUR=24;BYMINUTE=0", "自定义安排"],
  ["Multiple hours", "FREQ=DAILY;BYHOUR=9,10;BYMINUTE=0", "自定义安排"],
  ["Missing minute", "FREQ=DAILY;BYHOUR=9", "自定义安排"],
  ["One time", "FREQ=DAILY;COUNT=1;BYHOUR=9;BYMINUTE=0", "自定义安排"],
  ["Minutes", "FREQ=MINUTELY;INTERVAL=30", "自定义安排"],
  ["Day range", "FREQ=WEEKLY;BYDAY=WE,MO,TU;BYHOUR=10;BYMINUTE=0", "一-三（时间：10:00）"],
  ["Linked heartbeat", "RRULE:INTERVAL=30;FREQ=MINUTELY", "每 30 分钟", { kind: "heartbeat", targetThreadId: "fixture-thread" }],
  ["Unlinked heartbeat", "FREQ=MINUTELY;INTERVAL=30", "自定义安排", { kind: "heartbeat" }],
  ["Filtered heartbeat", "FREQ=MINUTELY;INTERVAL=30;BYDAY=MO", "自定义安排", { kind: "heartbeat", targetThreadId: "fixture-thread" }],
];
summaries.control.list = scheduleCases.map(([name, rrule, , overrides], i) => ({ ...tasks[0], id: `schedule-${i}`, name, rrule, ...overrides }));
summaries.render(); summaries.effects(); await summaries.settle();
const rowLabels = () => summaries.nodes().filter(node => node.props.className === "automation-task-schedule").map(node => node.children.join(""));
assert.deepEqual(rowLabels(), scheduleCases.map(([, , label]) => label), "table describes supported RRULE semantics");
summaries.button("Monday").props.onClick(); summaries.render();
assert.ok(summaries.nodes().some(node => node.type === "dd" && node.children.join("") === scheduleCases[3][2]), "detail shares the schedule summary");
summaries.button("编辑任务").props.onClick(); summaries.render();
assert.ok(summaries.nodes().some(node => node.type === "input" && node.props.value === scheduleCases[3][1]), "edit preserves the original RRULE");
summaries.button("取消").props.onClick(); summaries.render();
summaries.nodes().find(node => node.props.placeholder === "搜索任务").props.onChange({ target: { value: "工作日" } }); summaries.render();
assert.deepEqual(rowLabels(), [scheduleCases[1][2]], "search matches the summary visible in the table");
assert.ok(summaries.calls.every(call => call.method === "automations_list"), "reading and searching summaries never writes");
summaries.unmount();
console.log("PASS RRULE schedule summaries in table, detail and search; unsupported rules fall back");

const once = surface();
const anchor = Date.parse("2030-01-02T03:04:05Z");
const pending = Date.parse("2030-01-03T04:05:06Z");
const dateTimeLabel = ms => `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(ms)} · ${new Intl.DateTimeFormat("zh-CN", { timeStyle: "short" }).format(ms)}`;
const onceRule = "DTSTART:20300102T030405Z\r\nRRULE:COUNT=1;FREQ=DAILY";
once.control.list = [
  { ...tasks[0], id: "pending", name: "Pending once", rrule: onceRule },
  { ...tasks[0], id: "consumed", name: "Consumed once", rrule: onceRule },
  { ...tasks[0], id: "invalid", name: "Invalid once", rrule: onceRule.replace("20300102", "20300230") },
  { ...tasks[0], id: "excluded", name: "Excluded once", rrule: `${onceRule}\nEXDATE:20300102T030405Z` },
];
once.control.scheduler = { running: true, now: 0, entries: [{ id: "pending", nextRunAt: pending }, { id: "consumed", nextRunAt: null }] };
once.render(); once.effects(); await once.settle();
const onceLabels = () => once.nodes().filter(node => node.props.className === "automation-task-schedule").map(node => node.children.join(""));
assert.deepEqual(onceLabels(), [dateTimeLabel(pending), dateTimeLabel(anchor), "自定义安排", "自定义安排"]);
once.button("Pending once").props.onClick(); once.render();
assert.ok(once.nodes().some(node => node.type === "dd" && node.children.join("") === dateTimeLabel(pending)));
once.button("编辑任务").props.onClick(); once.render();
assert.ok(once.nodes().some(node => node.type === "textarea" && node.props.value === onceRule));
once.button("取消").props.onClick(); once.render();
once.nodes().find(node => node.props.placeholder === "搜索任务").props.onChange({ target: { value: dateTimeLabel(anchor) } }); once.render();
assert.deepEqual(onceLabels(), [dateTimeLabel(anchor)]);
assert.ok(once.calls.every(call => call.method === "automations_list"));
once.button("Consumed once").props.onClick(); once.render();
once.button("编辑任务").props.onClick(); once.render();
once.nodes().find(node => node.type === "input" && node.props.value === "Consumed once").props.onChange({ target: { value: "Renamed once" } }); once.render();
once.button("保存修改").props.onClick(); await once.settle();
assert.equal(once.calls.find(call => call.method === "automation_save")?.args.item.rrule, onceRule);
once.unmount();
console.log("PASS 10J official one-shot date/time format, scheduler precedence, consumed fallback, invalid rules and multiline editor");
console.log("NOT TESTED: official layout/pixel parity, native GUI or real task execution");
