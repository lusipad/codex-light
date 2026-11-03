import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/ArchiveView.tsx", "utf8");
const code = ts.transpileModule(`${source}\nexport { ArchiveDeleteDialog };`, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...tree.children.flatMap(nodes)];
const text = tree => !tree || typeof tree !== "object" ? String(tree ?? "") : tree.children.map(text).join("");
const button = (tree, label) => nodes(tree).find(node => node.tag === "button" && (text(node) === label || node.props.title === label));
function mount(name = "ArchiveView", supplied = {}) {
  const slots = [], effects = [], calls = [], writes = [], notices = [];
  let cursor = 0, tree;
  const trigger = { isConnected: true, disabled: false, matches() { return this.disabled; }, focus() { document.activeElement = this; } };
  const document = { activeElement: trigger };
  const react = {
    createElement(tag, props, ...children) {
      props ??= {};
      if (props.ref && !props.ref.current) props.ref.current = {
        isConnected: true, modal: false,
        showModal() { this.modal = true; }, close() { this.modal = false; },
        focus() { document.activeElement = this; },
      };
      return { tag, props, children: children.flat(Infinity) };
    },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || deps.some((x, i) => x !== slots[index].deps[i])) { effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); } },
    useCallback: f => f, useMemo: f => f(), useDeferredValue: value => value,
  };
  const context = { exports: {}, document, Date, Set, console,
    require(path) {
      if (path === "react") return { ...react, default: react };
      if (path === "../bridge") return { callAppServer(method, params) { const pending = deferred(); calls.push({ method, params, ...pending }); return pending.promise; } };
      return {};
    },
  };
  vm.runInNewContext(code, context);
  const props = { onSelectThread() { throw Error("Unexpected navigation"); }, onShowToast: (...args) => notices.push(args),
    onDelete(thread) { const pending = deferred(); writes.push({ action: "single", thread, ...pending }); return pending.promise; },
    onDeleteAll() { const pending = deferred(); writes.push({ action: "all", ...pending }); return pending.promise; },
    onUnarchive(thread) { const pending = deferred(); writes.push({ action: "restore", thread, ...pending }); return pending.promise; }, ...supplied };
  const render = () => { cursor = 0; tree = context.exports[name](props); return tree; };
  const runEffects = () => { while (effects.length) effects.shift()(); };
  render();
  return { render, runEffects, calls, writes, notices, document, trigger, get tree() { return tree; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const entries = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
async function loaded(data = entries) {
  const ui = mount(); ui.runEffects(); ui.render();
  assert(!button(ui.tree, "全部删除"), "AB01: loading cannot expose bulk action");
  ui.calls[0].resolve({ data, nextCursor: null }); await flush(); ui.render();
  return ui;
}
function openAll(ui) {
  button(ui.tree, "全部删除").props.onClick(); ui.render();
  const dialog = nodes(ui.tree).find(node => typeof node.tag === "function" && node.tag.name === "ArchiveDeleteDialog");
  assert(dialog && dialog.props.all);
  return dialog;
}
{
  for (const decision of [true, false]) {
    let focused = false;
    const fallbackRef = { current: { focus() { focused = true; } } };
    const dialog = mount("ArchiveDeleteDialog", { all: true, fallbackRef, onDecision() {} });
    dialog.runEffects();
    if (!decision) dialog.trigger.disabled = true;
    if (decision) nodes(dialog.tree).find(node => node.tag === "form").props.onSubmit({ preventDefault() {} });
    else button(dialog.tree, "取消").props.onClick();
    dialog.unmount();
    assert(focused, decision ? "AB09: confirmed deletion focuses stable list root before trigger removal" : "AB09: disabled cancel trigger falls back to stable root");
    assert.notEqual(dialog.document.activeElement, dialog.trigger);
  }
}
{
  const empty = await loaded([]); assert(!button(empty.tree, "全部删除"));
  const ui = mount(); ui.runEffects(); ui.calls[0].reject(Error("offline")); await flush(); ui.render();
  assert(!button(ui.tree, "全部删除"), "AB01: failed load cannot expose bulk action");
}
{
  const ui = await loaded();
  nodes(ui.tree).find(node => node.tag === "input").props.onChange({ target: { value: "not-matching" } }); ui.render();
  assert(text(ui.tree).includes("未找到匹配的归档聊天"));
  let dialog = openAll(ui);
  const confirmation = mount("ArchiveDeleteDialog", dialog.props); confirmation.runEffects();
  assert(text(confirmation.tree).includes("删除所有已归档本地聊天？"));
  assert(text(confirmation.tree).includes("这将永久删除所有本地已归档聊天记录"));
  assert(confirmation.tree.props.ref.current.modal, "AB09: actual modal dialog uses native Tab containment");
  assert.equal(confirmation.document.activeElement, button(confirmation.tree, "取消").props.ref.current);
  confirmation.tree.props.onCancel({ preventDefault() {} }); ui.render();
  assert.equal(ui.writes.length, 0, "AB02: Escape performs zero writes");
  confirmation.unmount(); assert.equal(confirmation.document.activeElement, confirmation.trigger);
  dialog = openAll(ui); await dialog.props.onDecision(false); ui.render();
  assert.equal(ui.writes.length, 0, "AB02: cancel performs zero writes");
  dialog = openAll(ui); const deleting = dialog.props.onDecision(true); ui.render();
  await dialog.props.onDecision(true);
  assert.equal(ui.writes.length, 1); assert.equal(ui.writes[0].action, "all");
  assert.equal(ui.writes[0].thread, undefined, "AB05: bulk action never receives filtered IDs");
  assert(button(ui.tree, "全部删除").props.disabled);
  ui.writes[0].resolve({ deletedThreadIds: ["a"], error: "second denied" }); await flush(); ui.render();
  assert.equal(ui.calls.length, 2, "AB06: partial deletion triggers a real reload");
  assert(ui.notices.some(([message, type]) => type === "error" && message.includes("1") && message.includes("second denied")));
  ui.calls[1].resolve({ data: [entries[1]], nextCursor: null }); await deleting; ui.render();
  assert(!text(ui.tree).includes("Alpha"));
  nodes(ui.tree).find(node => node.tag === "input").props.onChange({ target: { value: "" } }); ui.render();
  assert(text(ui.tree).includes("Beta")); assert.equal(ui.writes.length, 1);
}
{
  const ui = await loaded(); const deleting = openAll(ui).props.onDecision(true); ui.render();
  assert(button(ui.tree, "取消归档").props.disabled);
  button(ui.tree, "取消归档").props.onClick();
  assert.equal(ui.writes.length, 1, "AB02: restore cannot overlap bulk deletion even before React disabled updates");
  ui.writes[0].resolve({ deletedThreadIds: [], error: null }); await flush();
  ui.calls[1].resolve({ data: entries, nextCursor: null }); await deleting;
}
{
  const ui = await loaded(); const deleting = openAll(ui).props.onDecision(true);
  ui.writes[0].resolve({ deletedThreadIds: ["a", "b"], error: null }); await flush();
  ui.calls[1].reject(Error("lost connection")); await deleting; ui.render();
  assert(text(ui.tree).includes("删除已执行，刷新失败"));
  assert(!button(ui.tree, "全部删除"));
  button(ui.tree, "重试").props.onClick();
  assert.equal(ui.writes.length, 1, "AB08: refreshing failed deletion read never repeats deletion");
  ui.calls[2].resolve({ data: [], nextCursor: null }); await flush();
}
{
  const ui = await loaded(); button(ui.tree, "永久删除").props.onClick(); ui.render();
  const dialog = nodes(ui.tree).find(node => typeof node.tag === "function");
  assert.equal(dialog.props.all, false);
  const singleConfirmation = mount("ArchiveDeleteDialog", dialog.props);
  assert(text(singleConfirmation.tree).includes("删除已归档的聊天？"));
  assert(text(singleConfirmation.tree).includes("这将永久删除已归档的聊天"));
  const deleting = dialog.props.onDecision(true);
  assert.equal(ui.writes[0].action, "single");
  ui.writes[0].resolve({ deletedThreadIds: [], error: null }); await flush();
  assert(!ui.notices.some(([, type]) => type === "success"), "AB04: zero actual deletes are not success");
  ui.calls[1].resolve({ data: entries, nextCursor: null }); await deleting;
}
{
  const ui = await loaded(); const deleting = openAll(ui).props.onDecision(true);
  ui.writes[0].reject(Error("transport lost")); await flush();
  assert.equal(ui.calls.length, 2, "AB07: unknown result reads authoritative remaining archive");
  ui.calls[1].resolve({ data: [entries[1]], nextCursor: null }); await deleting; ui.render();
  assert(text(ui.tree).includes("Beta") && !text(ui.tree).includes("Alpha"));
  assert(ui.notices.some(([message]) => message.includes("结果未确认")));
}
{
  const ui = await loaded(); const deleting = openAll(ui).props.onDecision(true); ui.unmount();
  ui.writes[0].resolve({ deletedThreadIds: ["a", "b"], error: null }); await deleting;
  assert.equal(ui.calls.length, 1, "AB09: unmounted completion never reads into old view");
  assert.equal(ui.notices.length, 0);
}
console.log("PASS AB01-AB02/AB04-AB09: production bulk archive UI, dialog, scope, actual result, partial/unknown failures and unmount");
