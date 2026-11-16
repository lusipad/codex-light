import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginAccountMenu.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const event = patch => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...patch });
function fixture() {
  let cursor = 0, dirty = true, effects = [], tree, focused = null, rename = 0, disconnect = 0, restores = 0;
  const slots = [], listeners = new Map();
  let props = { identity: "a", linkId: "one", accountName: "real@example.com", nickname: "Work", pending: false, disconnecting: false, onRename: () => rename++, onDisconnect: () => disconnect++ };
  const items = [0, 1].map(index => ({ focus: () => focused = index }));
  const trigger = { getBoundingClientRect: () => ({ left: 280, right: 308, top: 400, bottom: 428 }), contains: value => value === trigger, focus: () => restores++ };
  const menu = { offsetWidth: 220, offsetHeight: 76, querySelectorAll: () => props.onRename ? items : items.slice(0, 1), contains: value => value === menu || items.includes(value) };
  const register = (name, callback) => listeners.set(name, callback), remove = (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { if (JSON.stringify(slots[i]) !== JSON.stringify(next)) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; }, useId() { return "test-id"; },
    useLayoutEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, document: { body: {}, addEventListener: register, removeEventListener: remove }, window: { innerWidth: 640, innerHeight: 480, addEventListener: register, removeEventListener: remove }, require(name) {
    if (name === "react") return react;
    if (name === "react-dom") return { createPortal: node => node };
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "lucide-react") return { MoreHorizontal: "MoreHorizontal", Pencil: "Pencil", Unplug: "Unplug", Loader2: "Loader2" }; return {};
  } });
  function render() { for (let turn = 0; dirty; turn++) { assert.ok(turn < 20); dirty = false; cursor = 0; tree = exports.PluginAccountMenu(props);
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.props.role === "menu" ? menu : trigger;
    const batch = effects; effects = []; batch.forEach(run => run()); } return tree; }
  const find = predicate => nodes(render()).find(predicate);
  return { listeners, trigger, menu, items, get tree() { return render(); }, get focused() { return focused; }, get restores() { return restores; }, get rename() { return rename; }, get disconnect() { return disconnect; },
    get button() { return find(node => node.props["aria-haspopup"] === "menu"); }, get popup() { return find(node => node.props.role === "menu"); },
    get actions() { return nodes(render()).filter(node => node.props.role === "menuitem"); }, open() { this.button.props.onClick(event()); render(); },
    update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
{
  const f = fixture(); assert.equal(f.button.props["aria-label"], "real@example.com 的操作"); assert.match(f.button.props["aria-labelledby"], /nickname/);
  f.open(); assert.equal(f.focused, 0); assert.equal(f.actions.length, 2); assert.deepEqual(f.actions.map(node => nodes(node).find(child => child.type === "span").props.children), ["重命名账户", "断开连接"]);
  assert.match(f.actions[1].props.className, /danger/); assert.equal(f.popup.props.style.left, 88); assert.ok(f.popup.props.style.top < 400, "menu flips up near viewport bottom");
  const rename = f.actions[0]; rename.props.onClick(event()); rename.props.onClick(event()); assert.equal(f.rename, 1); assert.equal(f.disconnect, 0); assert.equal(f.popup, undefined); assert.equal(f.restores, 1); assert.equal(f.listeners.size, 0); f.unmount();
}
{
  const f = fixture(); f.update({ onRename: undefined, nickname: null }); assert.equal(f.button.props["aria-labelledby"], undefined); f.open(); assert.equal(f.actions.length, 1);
  f.actions[0].props.onClick(event()); assert.equal(f.disconnect, 1); assert.equal(f.rename, 0); f.unmount();
}
{
  const f = fixture(); f.button.props.onKeyDown(event({ key: "ArrowUp" })); f.tree; assert.equal(f.focused, 1);
  let stopped = 0, prevented = 0; const key = value => event({ key: value, target: f.items[1], stopPropagation: () => stopped++, preventDefault: () => prevented++ });
  f.popup.props.onKeyDown(key("Home")); assert.equal(f.focused, 0); f.popup.props.onKeyDown(key("End")); assert.equal(f.focused, 1);
  f.popup.props.onKeyDown(key("ArrowDown")); assert.equal(f.focused, 0); f.popup.props.onKeyDown(key("ArrowUp")); assert.equal(f.focused, 0);
  f.popup.props.onKeyDown(event({ key: "Escape", nativeEvent: { keyCode: 229 } })); assert.ok(f.popup);
  f.popup.props.onKeyDown(key("Escape")); assert.equal(f.popup, undefined); assert.equal(f.restores, 1); assert.equal(stopped, 5); assert.equal(prevented, 5); f.unmount();
}
{
  const f = fixture(); f.button.props.onKeyDown(event({ key: "ArrowDown", nativeEvent: { isComposing: true } })); assert.equal(f.popup, undefined); f.open();
  f.listeners.get("pointerdown")({ target: f.menu }); assert.ok(f.popup); f.listeners.get("pointerdown")({ target: {} }); assert.equal(f.popup, undefined); assert.equal(f.restores, 1); f.unmount();
}
{
  const f = fixture(); f.open(); const action = f.actions[1], oldTrigger = f.button; f.update({ pending: true, disconnecting: true }); assert.equal(f.popup, undefined); assert.equal(f.button.props.disabled, true); assert.equal(f.button.props["aria-busy"], true);
  action.props.onClick(event()); oldTrigger.props.onClick(event()); assert.equal(f.disconnect, 0); assert.equal(f.popup, undefined); assert.ok(nodes(f.tree).some(node => node.type === "Loader2")); f.unmount();
}
{
  const f = fixture(); f.open(); const oldAction = f.actions[1], oldTrigger = f.button; f.update({ identity: "b" }); f.update({ identity: "a" }); f.open();
  oldAction.props.onClick(event()); oldTrigger.props.onClick(event()); assert.equal(f.disconnect, 0); assert.ok(f.popup); const current = f.actions[1]; f.unmount(); current.props.onClick(event()); assert.equal(f.disconnect, 0); assert.equal(f.listeners.size, 0);
}
{
  const f = fixture(); f.open(); const oldAction = f.actions[1], oldPopup = f.popup;
  f.popup.props.onKeyDown(event({ key: "Escape" })); f.open(); oldAction.props.onClick(event()); oldPopup.props.onKeyDown(event({ key: "Escape" }));
  assert.equal(f.disconnect, 0); assert.ok(f.popup, "retired same-scope popup handlers cannot affect a newly opened menu"); f.unmount();
}
console.log("Plugin account menu: action order, eligibility, danger styling, single selection, end alignment/upward positioning, keyboard/focus, pending, IME, listener cleanup and stale/ABA/unmount handlers passed.");
