import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// L2: execute the actual component; refs, geometry and browser events are controlled.
const code = ts.transpileModule(fs.readFileSync("src/components/ThreadActionsMenu.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
function mount({ width = 800, height = 600, edge = false, align = "right", followRoot = false } = {}) {
  const hooks = [], effects = [], cleanups = new Map(), dom = new Map(), listeners = new Map(), frames = new Map(), calls = [];
  let cursor = 0, frameId = 0, tree;
  const browser = {
    innerWidth: width, innerHeight: height,
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const document = { ...browser, activeElement: null, body: {} };
  const memo = (fn, deps) => {
    const i = cursor++;
    if (!hooks[i] || deps.some((d, n) => !Object.is(d, hooks[i].deps[n]))) hooks[i] = { fn, deps };
    return hooks[i].fn;
  };
  const effect = (fn, deps) => {
    const i = cursor++;
    if (!hooks[i] || deps.some((d, n) => !Object.is(d, hooks[i][n]))) {
      hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.set(i, fn()); });
    }
  };
  const react = {
    Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], v => { hooks[i] = typeof v === "function" ? v(hooks[i]) : v; }]; },
    useRef: value => { const i = cursor++; return hooks[i] ??= { current: value }; },
    useCallback: memo, useEffect: effect, useLayoutEffect: effect,
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, require: name => name === "react" ? react : name === "react-dom" ? { createPortal: node => ({ type: "portal", props: {}, children: [node] }) } : {}, window: browser, document, console });
  const props = {
    triggerAriaLabel: "Test menu", align, items: [
      { id: "plain", label: "Plain" }, { id: "disabled", label: "Disabled", disabled: true },
      { id: "sort", label: "Sort", children: [{ id: "recent", label: "Recent", type: "radio", checked: true }, { id: "manual", label: "Manual", type: "radio", checked: false }] },
      { id: "heading", label: "Show", type: "label", separatorBefore: true },
      { id: "projects", label: "Projects", type: "checkbox", checked: true },
    ], onSelect: id => calls.push(id),
  };
  const element = node => {
    const id = node.props["data-menu-item-id"] || (node.type === "button" && node.props["aria-label"] === "Test menu" ? "trigger" : node.type === "button" && node.props.title ? node.props.title.toLowerCase() : node.props.className?.startsWith("thread-actions-submenu") ? "submenu" : node.props.role === "menu" ? "main" : null);
    if (!id) return null;
    let entry = dom.get(id);
    if (!entry) { entry = { focus: () => { document.activeElement = entry; }, contains: target => entry === target, getAttribute: key => entry.node.props[key] ?? null }; dom.set(id, entry); }
    entry.node = node;
    entry.getBoundingClientRect = () => {
      if (id === "sort" && followRoot) {
        const style = dom.get("main")?.node.props.style || {};
        const left = style.left ?? browser.innerWidth - (style.right ?? 0) - 230;
        const top = (style.top ?? browser.innerHeight - (style.bottom ?? 0) - 100) + 32;
        return { left, right: left + 230, top, bottom: top + 30, width: 230, height: 30 };
      }
      return id === "trigger" ? { top: edge ? height - 30 : 50, bottom: edge ? height - 10 : 70, left: edge ? width - 30 : 80, right: edge ? width - 10 : 100, width: 20, height: 20 } : id === "sort" ? { top: edge ? height - 40 : 100, bottom: edge ? height - 10 : 130, left: edge ? width - 240 : 80, right: edge ? width - 10 : 310, width: 230, height: 30 } : { top: 0, bottom: 100, left: 0, right: id === "submenu" ? 170 : 230, width: id === "submenu" ? 170 : 230, height: 100 };
    };
    entry.querySelectorAll = () => all(node).filter(n => n.type === "button" && n.props.role?.startsWith("menuitem") && !n.props.disabled).map(element);
    entry.querySelector = () => entry.querySelectorAll()[0] ?? null;
    entry.contains = target => entry === target || all(node).some(n => element(n) === target);
    return entry;
  };
  const render = () => {
    cursor = 0; tree = module.exports.ThreadActionsMenu(props);
    for (const node of all(tree)) { const el = element(node); if (el && node.props.ref) node.props.ref.current = el; }
    for (const run of effects.splice(0)) run();
    return tree;
  };
  const find = label => all(render()).find(n => n.type === "button" && (n.props["aria-label"] === label || n.props.title === label || text(n) === label));
  const flush = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } };
  const key = (name, submenu = false) => { const node = all(render()).find(n => n.props.role === "menu" && n.props.className?.startsWith(submenu ? "thread-actions-submenu" : "thread-actions-menu")); node.props.onKeyDown({ key: name, target: document.activeElement, currentTarget: element(node), preventDefault() {}, stopPropagation() {} }); render(); flush(); };
  render();
  return { render, find, props, calls, dom, document, browser, flush, key, listeners, unmount: () => { for (const fn of cleanups.values()) fn?.(); } };
}

const menu = mount();
menu.find("Test menu").props.onClick(); menu.render(); menu.flush();
assert.equal(menu.document.activeElement, menu.dom.get("plain"), "opening focuses first enabled item");
assert.equal(menu.find("Projects")?.props.role, "menuitemcheckbox");
assert.equal(menu.find("Projects")?.props["aria-checked"], true);
assert.ok(all(menu.render()).some(n => n.props.role === "separator"));
assert.ok(!menu.find("Show"), "label must not be an actionable button");
menu.key("ArrowDown"); assert.equal(menu.document.activeElement, menu.dom.get("sort"), "skip disabled and labels");
menu.key("ArrowRight"); menu.render(); menu.flush();
assert.equal(menu.find("Recent")?.props.role, "menuitemradio");
assert.equal(menu.find("Recent")?.props["aria-checked"], true);
assert.equal(menu.document.activeElement, menu.dom.get("recent"));
assert.equal(all(menu.render()).filter(n => n.type === "portal").length, 2, "submenu must escape parent overflow in its own portal");
menu.key("ArrowDown", true); assert.equal(menu.document.activeElement, menu.dom.get("manual"));
menu.key("Home", true); assert.equal(menu.document.activeElement, menu.dom.get("recent"));
menu.key("End", true); assert.equal(menu.document.activeElement, menu.dom.get("manual"));
menu.key("ArrowLeft", true); assert.equal(menu.document.activeElement, menu.dom.get("sort"));
assert.equal(menu.find("Recent"), undefined);
menu.key("ArrowRight"); menu.render(); menu.flush();
for (const fn of menu.listeners.get("mousedown") || []) fn({ target: menu.dom.get("recent") });
assert.ok(menu.find("Recent"), "clicking inside submenu must not be treated as outside");
menu.find("Manual").props.onClick({ currentTarget: menu.dom.get("manual") }); menu.render();
assert.deepEqual(menu.calls, ["manual"]); assert.equal(menu.find("Manual"), undefined);
assert.equal(menu.document.activeElement, menu.dom.get("trigger"));
menu.find("Test menu").props.onClick(); menu.render(); menu.flush();
menu.find("Disabled").props.onClick({ currentTarget: menu.dom.get("disabled") }); menu.render(); assert.deepEqual(menu.calls, ["manual"]);
menu.find("Plain").props.onClick({ currentTarget: menu.dom.get("plain") }); menu.render(); assert.deepEqual(menu.calls, ["manual", "plain"], "ordinary leaf path remains functional");
menu.find("Test menu").props.onClick(); menu.render(); menu.flush();
for (const fn of menu.listeners.get("keydown") || []) fn({ key: "Escape", stopPropagation() {}, preventDefault() {} });
menu.render(); assert.equal(menu.find("Plain"), undefined); assert.equal(menu.document.activeElement, menu.dom.get("trigger"));
menu.find("Test menu").props.onClick(); menu.render(); menu.flush();
for (const fn of menu.listeners.get("mousedown") || []) fn({ target: {} });
menu.render(); assert.equal(menu.find("Plain"), undefined);
menu.unmount(); assert.equal([...menu.listeners.values()].reduce((n, entries) => n + entries.size, 0), 0, "listeners released");

const edge = mount({ edge: true });
edge.find("Test menu").props.onClick(); edge.render(); edge.flush();
edge.find("Sort").props.onClick({ currentTarget: edge.dom.get("sort") }); edge.render(); edge.flush();
edge.find("Sort").props.onClick({ currentTarget: edge.dom.get("sort") }); edge.render();
assert.ok(edge.find("Recent"), "clicking an already-hovered/open parent keeps the submenu available");
edge.dom.get("sort").focus(); edge.key("ArrowRight");
assert.equal(edge.document.activeElement, edge.dom.get("recent"), "Right focuses a submenu already opened by hover/click");
const submenu = all(edge.render()).find(n => n.props.className === "thread-actions-submenu");
assert.ok(submenu.props.style.left >= 8 && submenu.props.style.left + 170 <= 792, "submenu fits viewport width");
assert.ok(submenu.props.style.top >= 8 && submenu.props.style.top + 100 <= 592, "submenu fits viewport height");
assert.ok(submenu.props.style.left < edge.dom.get("sort").getBoundingClientRect().left, "right edge flips submenu left");
edge.browser.innerWidth = 500; edge.browser.innerHeight = 200;
for (const fn of edge.listeners.get("resize") || []) fn();
const repositioned = all(edge.render()).find(n => n.props.className === "thread-actions-submenu");
assert.ok(repositioned.props.style.left >= 8 && repositioned.props.style.left + 170 <= 492, "resize repositions visible submenu");
assert.ok(repositioned.props.style.top >= 8 && repositioned.props.style.top + 100 <= 192);
edge.unmount();
const alignedEdge = mount({ edge: true, align: "left" });
alignedEdge.find("Test menu").props.onClick(); alignedEdge.render(); alignedEdge.flush();
const rootAtEdge = all(alignedEdge.render()).find(n => n.props.className?.startsWith("thread-actions-menu--") || n.props.className === "thread-actions-menu thread-actions-menu--left");
assert.ok(rootAtEdge.props.style.left >= 8 && rootAtEdge.props.style.left + 230 <= 792, "left-aligned root clamps by measured width");
alignedEdge.unmount();
const followsRoot = mount({ edge: true, align: "left", followRoot: true });
followsRoot.find("Test menu").props.onClick(); followsRoot.render(); followsRoot.flush();
followsRoot.find("Sort").props.onClick({ currentTarget: followsRoot.dom.get("sort") }); followsRoot.render(); followsRoot.flush();
followsRoot.browser.innerWidth = 500;
for (const fn of followsRoot.listeners.get("resize") || []) fn();
followsRoot.render(); // Commit the newly clamped root position before measuring its child anchor.
const committedSubmenu = all(followsRoot.render()).find(n => n.props.className === "thread-actions-submenu");
const committedAnchor = followsRoot.dom.get("sort").getBoundingClientRect();
assert.equal(committedSubmenu.props.style.left, committedAnchor.left - 6 - 170, "submenu must remeasure after the root position commits, not retain its pre-commit anchor");
followsRoot.unmount();
console.log("PASS actual shared menu: typed items, separate portal, scoped keyboard/focus, selection, disabled/plain paths, outside/Escape, viewport and listener cleanup (L2)");
