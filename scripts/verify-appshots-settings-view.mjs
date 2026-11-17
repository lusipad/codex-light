import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const flatten = node => !node || typeof node !== "object" ? [] : [node, ...(node.children ?? []).flatMap(flatten)];
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
function fixture(overrides = {}) {
  let active, tree, dirty = true, focus = null;
  const instances = new Map(), effects = [], listeners = new Map(), hotkeys = [], destinations = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const state = active, index = state.cursor++; state.slots[index] ??= { value: initial };
      return [state.slots[index].value, next => { state.slots[index].value = typeof next === "function" ? next(state.slots[index].value) : next; dirty = true; }]; },
    useRef(initial) { return active.slots[active.cursor++] ??= { current: initial }; },
    useEffect(fn, deps) { const state = active, index = state.cursor++, old = state.slots[index];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) effects.push(() => {
        old?.cleanup?.(); state.slots[index] = { deps, cleanup: fn() };
      }); },
  };
  react.useLayoutEffect = react.useEffect;
  const events = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => {
    if (listeners.get(name) === fn) listeners.delete(name);
  } };
  let select;
  const load = file => {
    const module = { exports: {} };
    vm.runInNewContext(compile(file), { exports: module.exports, document: { body: {}, ...events },
      window: { innerWidth: 800, innerHeight: 600, ...events }, require(name) {
        if (name === "react") return react;
        if (name === "react-dom") return { createPortal: node => node };
        if (name === "./GeneralPreferenceSelect") return select;
        if (name.endsWith(".css")) return {};
        if (name === "lucide-react") return { Check: "check-icon", ChevronDown: "chevron-icon" };
        throw Error(`Unexpected import ${name}`);
      } });
    return module.exports;
  };
  select = load("src/components/GeneralPreferenceSelect.tsx");
  const view = load("src/components/AppshotsSettings.tsx");
  let props = { available: true, configuredHotkey: "DoubleAlt", supported: true, hotkeyPending: false, hotkeyError: null,
    destination: "automatic", miniFeature: false, onHotkeyChange: value => hotkeys.push(value),
    onDestinationChange: value => destinations.push(value), ...overrides };
  const expand = node => {
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const state = instances.get(node.props.id) ?? { cursor: 0, slots: [] }; instances.set(node.props.id, state);
      state.cursor = 0; active = state; return expand(node.type(node.props));
    }
    return { ...node, children: node.children.map(expand) };
  };
  const render = () => {
    for (let guard = 0; dirty; guard++) {
      assert.ok(guard < 30); dirty = false; tree = expand(view.AppshotsSettingsView(props));
      for (const node of flatten(tree)) if (node.props.ref) {
        const items = (node.children ?? []).filter(item => item?.props?.role === "menuitemradio");
        node.props.ref.current = { focus: () => { focus = node.props.id; }, contains: () => false,
          querySelectorAll: () => items.map((_, index) => ({ focus: () => { focus = index; } })),
          getBoundingClientRect: () => ({ top: 100, bottom: 132, right: 500 }), offsetWidth: 360, offsetHeight: 120 };
      }
      effects.splice(0).forEach(effect => effect());
    }
    return tree;
  };
  render();
  return { hotkeys, destinations, get tree() { return render(); }, all: () => flatten(render()),
    update(patch) { props = { ...props, ...patch }; dirty = true; render(); },
    open(id) { const trigger = flatten(render()).find(node => node.props.id === id); trigger.props.onClick(); render(); },
    choose(value) { const item = flatten(render()).find(node => node.props.role === "menuitemradio" && text(node) === value); assert.ok(item); item.props.onClick(); render(); },
    focus: () => focus,
  };
}
const selected = view => view.all().filter(node => node.props.role === "menuitemradio" && node.props["aria-checked"]).map(text);
const menu = view => view.all().find(node => node.props.role === "menu");
assert.equal(fixture({ available: false }).tree, null);
const normal = fixture(); assert.match(text(normal.tree), /截取应用快照，向 ChatGPT 展示最前面的窗口/);
assert.match(text(normal.tree), /应用快照包含视觉和文本内容，包括滚动到屏幕外的文本。/);
assert.match(text(normal.tree), /同时按下两个 Alt 键/);
assert.equal(normal.all().some(node => ["video", "input"].includes(node.type)), false);
assert.equal(normal.all().some(node => node.props.role === "switch"), false);
normal.open("appshots-hotkey"); assert.deepEqual(selected(normal), ["Alt + Alt"]);
assert.match(menu(normal).props.className, /appshots-hotkey-select/);
normal.choose("Alt + Alt"); assert.deepEqual(normal.hotkeys, ["DoubleAlt"], "same-value selection reaches controller to clear its previous inline error; controller owns zero-RPC guard");
normal.open("appshots-hotkey"); normal.choose("Shift + Shift"); assert.deepEqual(normal.hotkeys, ["DoubleAlt", "DoubleShift"]);
assert.match(text(normal.tree), /Alt \+ Alt/, "view waits for real state readback");
normal.update({ configuredHotkey: "DoubleShift" }); assert.match(text(normal.tree), /同时按下两个 Shift 键/);
normal.open("appshots-hotkey"); normal.choose("无"); assert.deepEqual(normal.hotkeys, ["DoubleAlt", "DoubleShift", null]);
const custom = fixture({ configuredHotkey: "Ctrl+Alt+F7" }); assert.match(text(custom.tree), /Ctrl\+Alt\+F7/);
custom.open("appshots-hotkey"); assert.deepEqual(selected(custom), []); assert.deepEqual(custom.hotkeys, []);
const noHotkey = fixture({ configuredHotkey: null }); noHotkey.open("appshots-hotkey");
assert.deepEqual(selected(noHotkey), ["无"]); noHotkey.choose("无"); assert.deepEqual(noHotkey.hotkeys, [null], "null reselect also reaches the clear-error controller action");
const pending = fixture({ hotkeyPending: true, hotkeyError: "真实注册错误" });
assert.equal(pending.all().find(node => node.props.id === "appshots-hotkey").props.disabled, true);
assert.equal(pending.all().find(node => node.props.id === "appshots-destination").props.disabled, false);
assert.equal(text(pending.all().find(node => node.props.role === "alert")), "真实注册错误");
pending.open("appshots-hotkey"); assert.equal(menu(pending), undefined);
assert.equal(fixture({ supported: false }).all().some(node => node.props.id === "appshots-hotkey"), false);
assert.equal(fixture({ supported: null }).all().some(node => node.props.id === "appshots-hotkey"), true);
normal.open("appshots-destination"); assert.deepEqual(selected(normal), ["自动如果当前聊天最近使用过，则使用当前聊天；否则开始新聊天"]);
assert.match(menu(normal).props.className, /appshots-destination-select/);
normal.choose("自动如果当前聊天最近使用过，则使用当前聊天；否则开始新聊天"); assert.deepEqual(normal.destinations, ["automatic"]);
normal.open("appshots-destination"); normal.choose("新聊天始终开始新聊天"); assert.deepEqual(normal.destinations, ["automatic", "new-chat"]);
const unknown = fixture({ destination: "future", miniFeature: null });
assert.match(text(unknown.all().find(node => node.props.id === "appshots-destination")), /自动/);
assert.deepEqual(unknown.destinations, []); unknown.open("appshots-destination"); assert.deepEqual(selected(unknown), []);
assert.doesNotMatch(text(menu(unknown)), /Mini/);
const mini = fixture({ miniFeature: true }); mini.open("appshots-destination"); assert.match(text(menu(mini)), /在 Mini 中始终开始新聊天/);
assert.doesNotMatch(text(mini.tree), /可见时使用 Mini/);
menu(mini).props.onKeyDown({ key: "Escape", nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
assert.equal(menu(mini), undefined); assert.equal(mini.focus(), "appshots-destination");
const css = fs.readFileSync("src/components/AppshotsSettings.css", "utf8");
assert.match(css, /appshots-hotkey-select[^}]+min-width: 120px/s);
assert.match(css, /appshots-destination-select[^}]+width: 360px/s);
console.log("PASS Appshots settings production JSX + shared menu: availability, exact Chinese, Windows choices, raw custom/null, readback, pending/error, hotkey reselect controller action, destination reselect/unknown/Mini condition, portal classes and Escape focus. Isolated props; controller zero-RPC guard tested separately; no real service/native/pixel acceptance; visual score=null.");
