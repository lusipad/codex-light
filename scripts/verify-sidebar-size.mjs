import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/SidebarResizeHandle.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function mount({ saved = null, shellWidth = 1200, invoke, runtime = {} } = {}) {
  const slots = [], listeners = new Map(), styles = new Map(), calls = [], notices = [];
  let cursor = 0, effect, cleanup, tree, observed = false, currentShellWidth = shellWidth;
  const sidebar = { parentElement: { getBoundingClientRect: () => ({ width: currentShellWidth }) }, style: {
    setProperty: (key, value) => styles.set(key, value),
    getPropertyValue: key => styles.get(key) ?? "",
    removeProperty: key => styles.delete(key),
  } };
  const handle = { parentElement: sidebar, setPointerCapture: () => {} };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect: callback => { effect = callback; },
  };
  runtime.react = react;
  runtime.window = { innerWidth: 1200,
    addEventListener: (key, callback) => listeners.set(key, callback),
    removeEventListener: key => listeners.delete(key),
  };
  if (!runtime.module) {
    runtime.module = { exports: {} };
    const reactFacade = Object.fromEntries(Object.keys(react).map(key => [key, (...args) => runtime.react[key](...args)]));
    vm.runInNewContext(compiled, {
    exports: runtime.module.exports,
    require: name => name === "react" ? reactFacade : name === "../bridge" ? { tauriInvoke: async (command, args) => {
      calls.push([command, args]);
      assert.equal(args.key, "sidebar-width");
      if (invoke) return invoke(command, args, calls.length);
      if (command === "desktop_state_set") saved = args.value;
      else return saved;
    } } : {},
    window: { innerWidth: 1200,
      addEventListener: (...args) => runtime.window.addEventListener(...args),
      removeEventListener: (...args) => runtime.window.removeEventListener(...args),
    },
    ResizeObserver: class {
      observe() { runtime.observe(true); }
      disconnect() { runtime.observe(false); }
    },
  });
  }
  runtime.observe = value => { observed = value; };
  const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
  const render = () => {
    cursor = 0;
    runtime.react = react;
    tree = runtime.module.exports.SidebarResizeHandle({ onError: (...args) => notices.push(args) });
    nodes(tree).find(node => node.props.role === "separator").props.ref.current = handle;
  };
  const separator = () => { render(); return nodes(tree).find(node => node.props.role === "separator"); };
  const key = (key, extra = {}) => separator().props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, ...extra });
  const down = (extra = {}) => separator().props.onPointerDown({ button: 0, isPrimary: true, pointerId: 1, clientX: 340, currentTarget: handle, preventDefault() {}, ...extra });
  const dispatch = (type, extra = {}) => listeners.get(type)?.({ pointerId: 1, clientX: 340, ...extra });
  render(); cleanup = effect();
  return { calls, notices, slots, styles, separator, key, down, dispatch,
    current: () => Number.parseFloat(styles.get("--sidebar-width")),
    resize: value => { currentShellWidth = value; dispatch("resize"); },
    unmount: () => cleanup(), listening: () => listeners.size, observed: () => observed,
    alert: () => { render(); return nodes(tree).find(node => node.props.role === "alert"); },
  };
}

const view = mount();
await flush();
assert.equal(view.current(), 340);
assert.equal(view.separator().props["aria-orientation"], "vertical");
view.down({ button: 2 }); view.dispatch("pointermove", { clientX: 500 });
assert.equal(view.current(), 340);
view.down({ isPrimary: false }); view.dispatch("pointermove", { clientX: 500 });
assert.equal(view.current(), 340);
view.down(); view.dispatch("pointermove", { pointerId: 2, clientX: 500 });
assert.equal(view.current(), 340);
view.dispatch("pointermove", { clientX: 1000 });
assert.equal(view.current(), 520);
assert.equal(view.calls.filter(([command]) => command === "desktop_state_set").length, 0, "drag only persists on completion");
view.dispatch("pointerup", { clientX: 1000 }); await flush();
assert.equal(view.calls.filter(([command]) => command === "desktop_state_set").at(-1)[1].value, 520);
assert.equal(view.calls.at(-1)[0], "desktop_state_get", "completed write is read back");
view.resize(600);
assert.equal(view.current(), 360);
assert.equal(view.separator().props["aria-valuemax"], 360);
view.resize(1200);
assert.equal(view.current(), 520, "viewport changes preserve the preferred width");
view.down(); view.dispatch("pointermove", { clientX: -500 });
assert.equal(view.current(), 240);
view.dispatch("pointercancel");
assert.equal(view.current(), 520, "cancel returns to start and does not persist");
view.key("ArrowLeft"); await flush();
assert.equal(view.current(), 510);
view.key("ArrowLeft", { nativeEvent: { isComposing: true } });
view.key("ArrowLeft", { ctrlKey: true });
assert.equal(view.current(), 510);
view.resize(420);
assert.equal(view.current(), 240);
view.key("ArrowLeft"); await flush();
assert.equal(view.current(), 240);
view.unmount();
assert.equal(view.styles.has("--sidebar-width"), false);
assert.equal(view.listening(), 0);
assert.equal(view.observed(), false);

for (const [saved, expected] of [[100, 240], [900, 520], [NaN, 340], ["480", 340]]) {
  const hydrated = mount({ saved });
  await flush();
  assert.equal(hydrated.current(), expected);
  assert.equal(hydrated.calls.length, 1, "loading and normalization must not write preferences");
  hydrated.unmount();
}

let releaseInitial, persisted;
const late = mount({ invoke: async (command, args, count) => {
  if (count === 1) return new Promise(resolve => { releaseInitial = resolve; });
  if (command === "desktop_state_set") persisted = args.value;
  else return persisted;
} });
late.key("ArrowRight"); await flush();
releaseInitial(490); await flush();
assert.equal(late.current(), 350, "late hydration cannot overwrite user input");
late.unmount();

let releaseWrite;
const queued = mount({ invoke: async (command, args, count) => {
  if (count === 1) return null;
  if (command === "desktop_state_set" && args.value === 350) await new Promise(resolve => { releaseWrite = resolve; });
  if (command === "desktop_state_set") persisted = args.value;
  else return persisted;
} });
await flush();
queued.key("ArrowRight"); await flush();
queued.key("ArrowRight"); await flush();
assert.equal(queued.calls.filter(([command]) => command === "desktop_state_set").length, 1);
releaseWrite(); await flush();
assert.equal(persisted, 360, "rapid adjustments serialize persistence and readback");
queued.unmount();

for (const editNewInstance of [true, false]) {
  const runtime = {};
  let stored = 340, releaseOldWrite;
  const invoke = async (command, args) => {
    if (command === "desktop_state_set") {
      if (args.value === 350) await new Promise(resolve => { releaseOldWrite = resolve; });
      stored = args.value;
    } else return stored;
  };
  const old = mount({ runtime, invoke });
  await flush();
  old.key("ArrowRight"); await flush();
  old.key("ArrowRight");
  old.unmount();
  const reopened = mount({ runtime, invoke });
  await flush();
  if (editNewInstance) reopened.key("ArrowLeft");
  await flush();
  releaseOldWrite(); await flush(); await flush();
  assert.equal(stored, editNewInstance ? 330 : 360, "old queued writes cannot overtake edits made after reopening");
  assert.equal(reopened.current(), stored, "reopened sidebar must hydrate after previous pending writes finish");
  reopened.unmount();
}

const failed = mount({ invoke: async command => {
  if (command === "desktop_state_set") throw Error("disk full");
  return null;
} });
await flush(); failed.key("ArrowRight"); await flush();
assert.ok(failed.alert(), "save error remains visible even without a toast provider");
assert.equal(failed.notices.at(-1)[1], "error");
failed.unmount();

let mismatch = true;
const retry = mount({ invoke: async (command, args, count) => {
  if (count === 1) return null;
  if (command === "desktop_state_set") persisted = args.value;
  else return mismatch ? -1 : persisted;
} });
await flush(); retry.key("ArrowRight"); await flush();
assert.ok(retry.alert(), "a readback mismatch is reported as a save failure");
mismatch = false;
retry.key("ArrowRight"); await flush();
assert.equal(retry.alert(), undefined, "successful retry clears the failure");
retry.unmount();

let resolveUnmounted;
const unmounted = mount({ invoke: () => new Promise(resolve => { resolveUnmounted = resolve; }) });
await flush();
unmounted.unmount();
const snapshot = [...unmounted.slots];
resolveUnmounted(480); await flush();
assert.deepEqual(unmounted.slots, snapshot);
assert.equal(unmounted.styles.size, 0);
assert.match(fs.readFileSync("src/components/CodexSidebar.tsx", "utf8"), /<SidebarResizeHandle onError=\{onShowToast\}/);
assert.match(fs.readFileSync("src/components/CodexSidebar.tsx", "utf8"), /if \(collapsed\) return null;/, "collapse unmounts the resize handle and its listeners");
console.log("PASS sidebar resize production component: persisted readback, clamp, pointer ownership/cancel, keyboard, viewport recovery, serialized writes, failures and unmount isolation");
