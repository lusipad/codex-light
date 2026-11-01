import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mount } from "./verify-sidebar-projects.mjs";

const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const event = extra => ({ preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
const sidebar = mount({ onRenameThread: (...args) => sidebar.calls.push(args) });
const row = () => all(sidebar.render()).find(n => n.props["data-thread-id"] === "a1");
const card = () => all(sidebar.render()).find(n => n.type === "SidebarThreadHoverCard");
assert.equal(typeof row().props.onPointerEnter, "function", "the actual sidebar must offer the rich card rather than a title-only tooltip");
row().props.onPointerEnter(event({ pointerType: "touch", currentTarget: sidebar.element(row()) }));
assert.equal(card(), undefined, "touch must not trigger hover");
row().props.onPointerEnter(event({ pointerType: "mouse", currentTarget: sidebar.element(row()) }));
assert.ok(card());
assert.equal(card().props.thread.id, "a1");
assert.equal(card().props.projectLabel, "Alpha");
assert.equal(row().props["aria-describedby"], "sidebar-thread-hover-card");
sidebar.props.threads = sidebar.props.threads.map(t => t.id === "a1" ? { ...t, name: "Refreshed" } : t);
assert.equal(card().props.thread.name, "Refreshed", "open card must receive current thread data, not a stale captured snapshot");
assert.deepEqual(sidebar.calls, []);
card().props.onClose(); sidebar.render();
row().props.onFocus(event({ target: {}, currentTarget: { matches: () => true } }));
assert.equal(card(), undefined, "nested focus must not trigger row hover");
const focusedRow = { matches: () => true };
row().props.onFocus(event({ target: focusedRow, currentTarget: focusedRow }));
assert.ok(card(), "focus-visible row opens immediately");
row().props.onContextMenu(event({ clientX: 100, clientY: 100 }));
assert.equal(card(), undefined, "context menu and hover must not overlap");
sidebar.unmount();
for (const change of ["collapse", "remove"]) {
  const view = mount();
  const treeRow = all(view.render()).find(n => n.props["data-thread-id"] === "a1");
  treeRow.props.onPointerEnter(event({ pointerType: "mouse", currentTarget: view.element(treeRow) }));
  assert.ok(all(view.render()).find(n => n.type === "SidebarThreadHoverCard"));
  if (change === "collapse") view.props.collapsed = true;
  else view.props.threads = view.props.threads.filter(t => t.id !== "a1");
  view.render(); view.render();
  assert.equal(all(view.render()).find(n => n.type === "SidebarThreadHoverCard"), undefined);
  view.unmount();
}

const code = ts.transpileModule(fs.readFileSync("src/components/SidebarThreadHoverCard.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
function mountCard(overrides = {}) {
  let cursor = 0, tree, active, timerId = 0, tick = 0, hit = null;
  const hooks = [], effects = [], cleanup = new Map(), timers = new Map(), calls = [], refs = {}, resizeObservers = [];
  const listeners = new Map();
  const target = scope => ({
    addEventListener(type, fn) { const key = `${scope}:${type}`; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); },
    removeEventListener(type, fn) { listeners.get(`${scope}:${type}`)?.delete(fn); },
  });
  const rect = { left: 30, right: 250, top: 100, bottom: 132, width: 220, height: 32 };
  const anchor = { ...target("anchor"), isConnected: true, getBoundingClientRect: () => rect, contains: node => node === anchor };
  const root = {
    ...target("card"), getBoundingClientRect: () => {
      const style = tree?.props.style ?? {};
      const maxWidth = style.maxWidth ?? 320;
      const minWidth = style.minWidth ?? 224;
      const width = Math.max(Math.min(320, maxWidth), minWidth);
      return { left: 252, right: 252 + width, top: 100, bottom: 174, width, height: 74 };
    },
    contains: node => node === root || node === refs.input,
  };
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizeObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([{ target: root }]); }
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useCallback: fn => fn,
    useEffect(callback, deps) {
      const i = cursor++;
      if (!hooks[i] || deps.some((value, j) => !Object.is(value, hooks[i][j]))) {
        hooks[i] = deps; effects.push(() => { cleanup.get(i)?.(); cleanup.set(i, callback()); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const module = { exports: {} };
  const window = {
    ...target("window"), innerWidth: 800, innerHeight: 600,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: tick + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const document = { ...target("document"), get activeElement() { return active; }, elementFromPoint: () => hit };
  vm.runInNewContext(code, {
    exports: module.exports, require: name => name === "react" ? react : {},
    window, document, queueMicrotask: fn => fn(), ResizeObserver: FakeResizeObserver, Date,
  });
  const props = { thread: { id: "a1", name: "Name", recencyAt: 0, updatedAt: 123 }, projectLabel: "Alpha", anchor, onClose: () => calls.push(["close"]), onRename: value => calls.push(["rename", value]), ...overrides };
  const render = () => {
    cursor = 0; tree = module.exports.SidebarThreadHoverCard(props);
    for (const node of all(tree)) if (node.props.ref) {
      const el = node.props.role === "tooltip" ? root : {
        value: node.props.value, dataset: {},
        focus() { active = this; calls.push(["focus"]); }, select() { calls.push(["select"]); },
        blur() { node.props.onBlur?.(event({ currentTarget: this })); },
      };
      node.props.ref.current = el;
      if (node.type === "input") refs.input = el;
    }
    effects.splice(0).forEach(fn => fn());
    return tree;
  };
  return {
    props, calls, root, anchor, rect, document, window, render, resizeObservers, exports: module.exports,
    nodes: () => all(render()), input: () => all(render()).find(n => n.type === "input"),
    emit(scope, type, payload) { for (const fn of [...(listeners.get(`${scope}:${type}`) || [])]) fn(payload); },
    advance(ms) { tick += ms; for (const [id, timer] of [...timers]) if (timer.at <= tick) { timers.delete(id); timer.fn(); } },
    setHit(value) { hit = value; }, get inputElement() { return refs.input; },
    unmount() { cleanup.forEach(fn => fn?.()); cleanup.clear(); },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    timerCount: () => timers.size,
  };
}
{
  const view = mountCard(), tree = view.render();
  assert.equal(tree.props.role, "tooltip");
  assert.equal(tree.props.style.left, undefined, "layout position is measured after mounting");
  const settled = view.render();
  assert.equal(settled.props.style.left, 252);
  assert.equal(settled.props.style.top, 100);
  assert.equal(view.calls.length, 0, "hover must not steal focus");
  assert.ok(text(settled).includes("Alpha"));
  assert.ok(!text(settled).includes("123"), "raw timestamp must not leak into visible content");
  view.window.innerWidth = 450;
  view.emit("window", "resize", {});
  const narrow = view.render().props.style;
  assert.equal(narrow.maxWidth, 190, "card max width must fit the official right-side available width after 8px collision padding");
  assert.equal(narrow.minWidth, 190, "minimum width must not force the card beyond the available side");
  assert.equal(narrow.left, 252, "right-side card stays 2px from the anchor and within the 8px viewport margin");
  view.window.innerWidth = 800;
  view.rect.left = 390; view.rect.right = 610; view.emit("window", "resize", {});
  view.render();
  view.resizeObservers[0].trigger();
  const flipped = view.render().props.style;
  assert.equal(view.root.getBoundingClientRect().width, 320, "card regains its natural width after more space becomes available");
  assert.equal(flipped.maxWidth, 380);
  assert.equal(flipped.left, 68, "card flips left and remeasures after its width grows");
  view.rect.top = 570; view.rect.bottom = 602;
  view.emit("window", "scroll", {});
  assert.ok(view.render().props.style.top <= 518, "card must fit bottom boundary");
  view.window.innerWidth = 800; view.rect.left = 30; view.rect.right = 250; view.rect.top = 100; view.rect.bottom = 132;
  view.emit("window", "resize", {}); view.render();
  view.emit("anchor", "pointerleave", { clientX: 249, clientY: 115 });
  view.emit("document", "pointermove", { target: {}, clientX: 251, clientY: 116 });
  assert.equal(view.calls.length, 0, "pointer corridor must keep the 2px gap usable");
  view.emit("card", "pointerenter", {});
  view.advance(101); assert.equal(view.calls.length, 0);
  view.emit("card", "pointerleave", { clientX: 252, clientY: 116 });
  view.emit("document", "pointermove", { target: {}, clientX: 700, clientY: 500 });
  assert.ok(view.calls.some(call => call[0] === "close"));
  view.unmount();
  assert.equal(view.listenerCount(), 0); assert.equal(view.timerCount(), 0);
  assert.ok(view.resizeObservers.every(observer => observer.disconnected), "card size observer disconnects on unmount");
}
for (const [scope, type, payload] of [
  ["window", "blur", {}],
  ["window", "keydown", { key: "Escape" }],
  ["window", "codex:dismiss-tooltips", {}],
  ["anchor", "focusout", { relatedTarget: {} }],
]) {
  const view = mountCard(); view.render();
  view.emit("anchor", "pointerleave", { clientX: 250, clientY: 115 });
  view.emit(scope, type, payload);
  assert.ok(view.calls.some(c => c[0] === "close"), `${scope}:${type} dismisses`);
  view.unmount(); assert.equal(view.timerCount(), 0); assert.equal(view.listenerCount(), 0);
}
{
  const view = mountCard(); view.render();
  view.emit("anchor", "focusout", { relatedTarget: view.root });
  assert.equal(view.calls.length, 0, "focus transfer into card stays open");
  view.emit("window", "keydown", { key: "Escape", isComposing: true });
  assert.equal(view.calls.length, 0);
  view.emit("anchor", "pointerleave", { clientX: 250, clientY: 115 });
  view.advance(99); assert.equal(view.calls.length, 0);
  view.advance(1); assert.deepEqual(view.calls, [["close"]], "stationary pointer outside closes after 100ms");
  view.unmount();
}
for (const [value, key, expected] of [["  Changed  ", "Enter", "Changed"], ["Name", "Enter", null], [" ", "Enter", null], ["Cancelled", "Escape", null]]) {
  const view = mountCard();
  view.nodes().find(n => n.type === "button").props.onClick(event());
  let input = view.input();
  assert.ok(input); assert.ok(view.calls.some(call => call[0] === "select"));
  input.props.onChange({ target: { value } }); input = view.input();
  const ime = event({ key: "Enter", nativeEvent: { isComposing: true } });
  input.props.onKeyDown(ime);
  assert.equal(ime.defaultPrevented, true); assert.ok(view.input());
  input.props.onKeyDown(event({ key, nativeEvent: {}, currentTarget: view.inputElement }));
  input.props.onBlur(event({ currentTarget: view.inputElement }));
  assert.deepEqual(view.calls.filter(c => c[0] === "rename"), expected ? [["rename", expected]] : []);
  view.unmount(); assert.equal(view.listenerCount(), 0); assert.equal(view.timerCount(), 0);
}
{
  const view = mountCard();
  const { formatSidebarHoverTime } = view.exports;
  const now = new Date(2026, 9, 31, 12).getTime();
  for (const [minutes, label] of [[0, "1 分"], [59, "59 分"], [60, "1 小时"], [1440, "1 天"], [10080, "1 周"], [43200, "1 个月"], [525600, "1 年"]]) {
    assert.equal(formatSidebarHoverTime((now - minutes * 60000) / 1000, now), label);
  }
  assert.equal(formatSidebarHoverTime(undefined, now), null);
  assert.equal(formatSidebarHoverTime(NaN, now), null);
}
console.log("PASS actual Sidebar rich-hover entry and card content/geometry/corridor/edit/IME/cleanup/time contracts (L2; browser pointer/focus/native parity separate)");
