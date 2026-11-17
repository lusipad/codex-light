import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/AppearanceThemePresetPicker.tsx", "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const children = node => node && typeof node === "object" ? [node, ...node.children.flatMap(children)] : [];
const text = node => typeof node === "string" ? node : node && typeof node === "object"
  ? node.type?.name === "Badge" ? text(node.type(node.props)) : node.children.map(text).join("") : "";
const oldTheme = { surface: "#111111", ink: "#ffffff", accent: "#336699" };
const seed = { surface: "#222222", ink: "#eeeeee", accent: "#99cc33" };
function mount(width) {
  const hooks = [], effects = [], listeners = new Map(), windowListeners = new Map(), calls = [], elements = new Map();
  let cursor = 0, tree, active = null, rerender = false;
  const props = { id: "preset", label: "深色 代码主题", value: "codex", theme: oldTheme, variant: "dark", disabled: false, loading: false,
    presets: [{ id: "codex", label: "Codex" }, { id: "dracula", label: "Dracula" }, { id: "other", label: "Long actual theme name" }],
    onChange: id => calls.push(id) };
  const document = { body: {}, get activeElement() { return active; }, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const window = { innerWidth: width, innerHeight: 680, addEventListener: (key, fn) => windowListeners.set(key, fn), removeEventListener: key => windowListeners.delete(key) };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef: value => hooks[cursor++] ??= { current: value },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], value => { const next = typeof value === "function" ? value(hooks[index]) : value;
        if (!Object.is(next, hooks[index])) { hooks[index] = next; rerender = true; } }]; },
    useLayoutEffect: effect, useEffect: effect,
  };
  function effect(fn, deps) {
    const index = cursor++, before = hooks[index];
    if (before?.deps && deps && before.deps.every((v, i) => v === deps[i])) return;
    hooks[index] = { deps }; effects.push(() => { before?.cleanup?.(); hooks[index].cleanup = fn(); });
  }
  const exports = {};
  vm.runInNewContext(code, { exports, document, window, require(name) {
    if (name === "react") return react;
    if (name === "react-dom") return { createPortal: node => node };
    if (name.endsWith("appearanceTheme")) return { loadThemePreset: async () => seed };
    if (name.endsWith(".css")) return {};
    throw Error(name);
  } });
  function attach(node, parent) {
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "function") return;
    const key = node.props.id ?? node.props["data-preset-id"] ?? node.props.className ?? node.type;
    const el = elements.get(key) ?? { focus() { active = this; }, querySelectorAll() {
      return children(this.node).filter(n => n.props["data-preset-menu-item"] !== undefined).map(n => elements.get(n.props.id ?? n.props["data-preset-id"]));
    }, contains(target) { return target === this || !!target && this.contains(target.parent); },
    getBoundingClientRect() { return this.node.props.id === "preset" ? { left: 300, right: 476, top: 200, bottom: 232 } :
      { left: 236, right: 476, top: 238, bottom: 346 }; }, offsetWidth: 240, offsetHeight: 108 };
    elements.set(key, el); el.node = node; el.parent = parent;
    if (node.props.ref) node.props.ref.current = el;
    for (const child of node.children) attach(child, el);
  }
  const render = () => { for (let i = 0; i < 10; i++) {
    rerender = false; cursor = 0; tree = exports.AppearanceThemePresetPicker(props); attach(tree, null);
    effects.splice(0).forEach(fn => fn()); if (!rerender) return;
  } throw Error("picker render did not settle"); };
  const by = fn => children(tree).find(fn);
  const trigger = () => by(n => n.props.id === "preset");
  const item = id => by(n => n.props["data-preset-id"] === id);
  const key = (node, key, isComposing = false) => node.props.onKeyDown({ key, nativeEvent: { isComposing },
    target: active, preventDefault() {}, stopPropagation() {} });
  render();
  return { props, calls, active: () => active, render, by, item, trigger, key, listeners, windowListeners, window };
}

for (const width of [1000, 640]) {
  const v = mount(width);
  assert.equal(text(v.trigger()), "AaChatGPT");
  assert.equal(v.trigger().props["aria-expanded"], false);
  v.key(v.trigger(), "ArrowDown", true); v.render();
  assert.equal(v.trigger().props["aria-expanded"], false);
  v.trigger().props.onClick(); v.render();
  const root = () => v.by(n => n.props.id === "preset-menu");
  assert.equal(root().props.role, "menu");
  assert.match(text(root()), /ChatGPT.*Codex 主题/);
  assert.equal(v.item("dracula"), undefined);
  assert.equal(v.active().node.props["data-preset-id"], "codex");
  assert.equal(v.item("codex").props["aria-checked"], true);
  assert.equal(v.by(n => n.type === "input"), undefined);
  v.key(root(), "ArrowDown"); assert.equal(v.active().node.props.id, "preset-submenu-trigger");
  v.key(root(), "ArrowRight"); v.render();
  const sub = () => v.by(n => n.props.id === "preset-submenu");
  assert.equal(sub().props["data-preset-presentation"], width > 767 ? "flyout" : "inline");
  assert.equal(v.active().node.props["data-preset-id"], "dracula");
  v.item("dracula").props.onClick(); assert.deepEqual(v.calls, ["dracula"]);
  v.props.value = "dracula"; v.props.loading = true; v.props.disabled = true; v.render();
  assert.equal(v.trigger().props["aria-expanded"], true, "ack/busy updates do not dismiss the menu");
  assert.equal(v.item("dracula").props["aria-checked"], true);
  v.item("other").props.onClick(); assert.deepEqual(v.calls, ["dracula"]);
  v.key(sub(), "Escape"); v.render();
  assert.equal(sub(), undefined);
  assert.equal(v.active().node.props.id, "preset-submenu-trigger");
  v.key(root(), "Escape"); v.render();
  assert.equal(v.active().node.props.id, "preset");
  assert.equal(v.trigger().props["aria-expanded"], false);
  assert.equal(v.listeners.has("pointerdown"), false);
  assert.equal(v.listeners.has("focusin"), false);
  v.props.disabled = false; v.props.loading = false; v.props.value = "unknown-theme"; v.render();
  assert.equal(text(v.trigger()), "Aaunknown-theme");
  v.trigger().props.onClick(); v.render();
  v.listeners.get("pointerdown")({ target: {} }); v.render();
  assert.equal(v.trigger().props["aria-expanded"], false);
}
{
  const v = mount(1000);
  v.key(v.trigger(), "ArrowUp"); v.render();
  const root = v.by(n => n.props.id === "preset-menu");
  const subTrigger = v.by(n => n.props.id === "preset-submenu-trigger");
  assert.equal(v.active().node.props.id, "preset-submenu-trigger");
  subTrigger.props.onPointerEnter(); v.render();
  assert.equal(v.active().node.props.id, "preset-submenu-trigger", "pointer flyout does not steal focus");
  v.window.innerWidth = 760; v.windowListeners.get("resize")(); v.render();
  assert.equal(v.by(n => n.props.id === "preset-submenu").props["data-preset-presentation"], "inline");
  assert.equal(v.active().node.props["data-preset-id"], "dracula");
  v.listeners.get("focusin")({ target: {} }); v.render();
  assert.equal(v.trigger().props["aria-expanded"], false);
  assert.equal(v.windowListeners.size, 0);
  assert.equal(root.props.role, "menu");
}
assert.match(fs.readFileSync("src/components/AppearanceThemePresetPicker.css", "utf8"), /width:\s*240px/);
console.log("PASS actual appearance preset hierarchy, unknown names, keyboard, focus, wide/narrow menus, keep-open selection, disabled guard and outside close");
