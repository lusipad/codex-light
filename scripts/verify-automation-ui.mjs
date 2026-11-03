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
function surface() {
  let cursor = 0, tree, pending = [];
  const slots = [], calls = [], timers = new Map(); let timerId = 0, stopped = 0;
  const document = { activeElement: null };
  const control = { list: tasks, confirm: true, confirmations: [], scheduler: null,
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
    subscribeAutomationEvents: () => () => { ++stopped; },
  };
  const bridge = { tauriInvoke: async (method, args) => {
    calls.push({ method, args });
    if (method === "automations_list") return typeof control.list === "function" ? control.list() : control.list;
    if (method === "automation_save") return control.save(args.item);
    if (method === "automation_delete") return tasks.filter(task => task.id !== args.id);
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
    if (name === "../types" || name.endsWith(".css")) return {};
    throw Error(`Unexpected dependency ${name}`);
  } });
  const render = () => { cursor = 0; tree = exports.AutomationsView({ activeWorkspaceRoot: "fixture-repo", models: [{ id: "fixture-model", model: "fixture-model", displayName: "Fixture model" }] }); };
  const effects = () => { const queue = pending; pending = []; for (const fn of queue) fn(); };
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(walk)];
  const content = node => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(content).join(" ") : String(node);
  const button = label => walk(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || content(node).trim() === label));
  return { calls, control, render, effects, nodes: () => walk(tree), text: () => content(tree), button,
    settle: async () => { await flush(); render(); effects(); },
    unmount: () => { for (const slot of slots) slot?.stop?.(); assert.equal(timers.size, 0); assert.equal(stopped, 1); } };
}

const h = surface(); h.render(); h.effects(); await h.settle();
assert.ok(h.nodes().some(node => /^h[1-3]$/.test(node.type) && node.children.join("") === "定时任务"), "official local configuration region uses its documented title");
assert.ok(h.button("添加"));
assert.doesNotMatch(h.text(), /~\/\.codex|automation\.toml|当前时间|已配置.*个任务|推荐预设模板|每日代码质量|每周一依赖|长期目标 \/goal/u);
assert.ok(h.button("Active fixture")); assert.equal(h.button("Paused fixture"), undefined, "default active filter excludes paused local tasks");
assert.equal(h.button("立即运行"), undefined, "row actions belong in selected details rather than every row");
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
for (const action of ["立即运行", "编辑", "暂停"]) assert.ok(h.button(action), `detail retains ${action}`);
assert.ok(h.nodes().some(node => node.type === "button" && /删除/.test(node.props["aria-label"] || node.children.join(""))), "delete remains reachable from detail");
const before = h.calls.length;
h.button("立即运行").props.onClick(); await h.settle();
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
await edits.button("暂停").props.onClick(); await edits.settle();
assert.equal(edits.calls.filter(call => call.method === "automation_save").at(-1).args.item.status, "PAUSED");
await edits.button("启用").props.onClick(); await edits.settle();
assert.equal(edits.calls.filter(call => call.method === "automation_save").at(-1).args.item.status, "ACTIVE");
edits.control.confirm = false; const beforeCancel = edits.calls.length;
await edits.button("删除").props.onClick(); await edits.settle();
assert.equal(edits.calls.length, beforeCancel, "cancelled confirmation cannot delete");
edits.control.confirm = true; await edits.button("删除").props.onClick(); await edits.settle();
assert.equal(edits.calls.filter(call => call.method === "automation_delete").at(-1).args.id, "active-task"); edits.unmount();

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
    edit.button("编辑").props.onClick(); edit.render(); edit.control.confirm = true;
    edit.button(exit).props.onClick(); edit.render();
    assert.equal(edit.nodes().some(node => node.type === "textarea"), false);
    assert.ok(edit.nodes().some(node => node.type === "aside" && node.props["aria-label"] === "任务详情"), `${exit} from editing returns to selected detail`);
    assert.ok(edit.button("立即运行"), `${exit} preserves selected task actions`);
  } catch (error) { dirtyFailures.push(`edit/${exit}: ${error.message}`); }
  finally { edit.unmount(); }
}
for (const failure of dirtyFailures) console.error(`FAIL ${failure}`);
assert.equal(dirtyFailures.length, 0, "configuration discard protection and edit-to-detail navigation");
console.log("PASS production Automation JSX: documented local table/filter/search/detail, actual unavailable callback, create failure/retry/cancel and cleanup");
console.log("PASS actual pause/resume/delete confirmation, loading/error/retry and name/next-run/update local sorting");
console.log("NOT TESTED: official layout/pixel parity, native GUI or real task execution");
