import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginManagementActions.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function fixture(multiple = true) {
  let cursor = 0, dirty = true, effects = [], tree, focused = "", marketplace = 0, mcp = 0;
  const slots = [], listeners = new Map(), trigger = { contains: target => target === trigger, focus: () => focused = "trigger",
    getBoundingClientRect: () => ({ right: 780, top: 550, bottom: 578 }) };
  const items = [0, 1].map(index => ({ focus: () => focused = index }));
  const menu = { offsetWidth: 220, offsetHeight: 90, contains: target => target === menu || items.includes(target), querySelectorAll: () => items };
  let props = { onAddMarketplace: multiple ? () => marketplace++ : undefined, onAddMcp: () => mcp++ };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; if (JSON.stringify(slots[i]) !== JSON.stringify(value)) { slots[i] = value; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  }; react.useLayoutEffect = react.useEffect;
  const events = prefix => ({ addEventListener: (name, fn) => listeners.set(prefix + name, fn), removeEventListener: (name, fn) => { if (listeners.get(prefix + name) === fn) listeners.delete(prefix + name); } });
  const exports = {};
  vm.runInNewContext(source, { exports, document: { ...events("document:"), body: {} }, window: { ...events("window:"), innerWidth: 800, innerHeight: 600 },
    require(name) {
      if (name === "react") return react;
      if (name === "react-dom") return { createPortal: child => child };
      if (name === "lucide-react") return { ChevronDown: "ChevronDown" };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
      return {};
    },
  });
  const render = () => {
    for (let turn = 0; dirty; turn++) {
      assert.ok(turn < 15); cursor = 0; dirty = false; tree = exports.PluginManagementActions(props);
      for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.type === "button" ? trigger : menu;
      const pending = effects; effects = []; pending.forEach(run => run());
    } return tree;
  };
  return { get tree() { return render(); }, get focused() { return focused; }, get marketplace() { return marketplace; }, get mcp() { return mcp; }, items, trigger, menu, listeners,
    update(patch) { props = { ...props, ...patch }; dirty = true; return render(); },
    button() { return nodes(render()).find(node => node.type === "button"); },
    popup() { return nodes(render()).find(node => node.props.role === "menu"); },
    key(node, key, target = items[0], nativeEvent = {}) { let prevented = 0, stopped = 0; node.props.onKeyDown({ key, target, nativeEvent, preventDefault: () => prevented++, stopPropagation: () => stopped++ }); render(); return { prevented, stopped }; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
{
  const f = fixture(false); const button = f.button(); assert.equal(button.props.children, "添加 MCP 服务器");
  assert.equal(button.props["aria-haspopup"], undefined); button.props.onClick(); assert.equal(f.mcp, 1); assert.equal(f.marketplace, 0);
  assert.equal(f.popup(), undefined); assert.equal(f.listeners.size, 0); f.unmount();
}
{
  const f = fixture(); let button = f.button(); assert.equal(button.props["aria-haspopup"], "menu"); assert.equal(button.props["aria-expanded"], false);
  button.props.onClick(); let popup = f.popup(); assert.equal(popup.props["aria-label"], "添加"); assert.equal(f.focused, 0);
  assert.deepEqual(nodes(popup).filter(node => node.props.role === "menuitem").map(node => node.props.children), ["添加插件市场", "添加 MCP 服务器"]);
  assert.equal(popup.props.style.left, 560); assert.equal(popup.props.style.top, 456, "menu flips above bottom edge");
  assert.equal(f.listeners.size, 3);
  f.key(popup, "ArrowUp"); assert.equal(f.focused, 1); f.key(popup, "Home", f.items[1]); assert.equal(f.focused, 0);
  f.key(popup, "End"); assert.equal(f.focused, 1);
  assert.deepEqual(f.key(popup, "Escape", f.items[1], { isComposing: true }), { prevented: 0, stopped: 0 }); assert.ok(f.popup());
  assert.deepEqual(f.key(popup, "Escape"), { prevented: 1, stopped: 1 }); assert.equal(f.popup(), undefined); assert.equal(f.focused, "trigger"); assert.equal(f.listeners.size, 0);
  f.key(f.button(), "ArrowUp"); assert.equal(f.focused, 1);
  nodes(f.popup()).find(node => node.props.role === "menuitem").props.onClick(); assert.equal(f.marketplace, 1); assert.equal(f.mcp, 0); assert.equal(f.popup(), undefined); assert.equal(f.focused, "trigger");
  f.button().props.onClick(); nodes(f.popup()).filter(node => node.props.role === "menuitem")[1].props.onClick(); assert.equal(f.mcp, 1); assert.equal(f.marketplace, 1);
  f.button().props.onClick(); f.popup(); f.listeners.get("document:pointerdown")({ target: f.items[0] }); assert.ok(f.popup(), "inside pointer retains menu");
  f.listeners.get("document:pointerdown")({ target: {} }); assert.equal(f.popup(), undefined); assert.equal(f.listeners.size, 0);
  f.button().props.onClick(); f.popup(); f.key(f.popup(), "Tab"); assert.equal(f.popup(), undefined);
  f.button().props.onClick(); f.popup(); f.update({ onAddMarketplace: undefined }); assert.equal(f.popup(), undefined); assert.equal(f.listeners.size, 0);
  f.update({ onAddMarketplace: () => {} }); f.button().props.onClick(); f.popup(); f.unmount(); assert.equal(f.listeners.size, 0);
}
console.log("Plugin management actions: production single/double actions, truthful menu, focus/IME/keyboard, outside close, portal bounds and listener cleanup passed.");
