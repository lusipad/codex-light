import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const load = (file, requires, extra = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(file, "utf8")), {
    exports: module.exports, require: name => requires[name] ?? {}, console, ...extra,
  });
  return module.exports;
};
const shortcut = load("src/shortcuts.ts", {});
const event = (key, options = {}) => ({ key, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...options });
const reactHooks = [], effects = [];
let cursor = 0, invoke, state;
const react = {
  useState(initial) { const i = cursor++; if (!(i in reactHooks)) reactHooks[i] = initial; return [reactHooks[i], value => reactHooks[i] = typeof value === "function" ? value(reactHooks[i]) : value]; },
  useRef(initial) { const i = cursor++; return reactHooks[i] ??= { current: initial }; },
  useCallback(fn) { cursor++; return fn; },
  useEffect(fn, deps) { const i = cursor++, old = reactHooks[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); reactHooks[i] = { deps }; effects.push(() => reactHooks[i].cleanup = fn()); } },
};
const preferences = load("src/keyboardPreferences.ts", { react, "./shortcuts": shortcut, "./bridge": { tauriInvoke: (...args) => invoke(...args) } });
const { updateKeyBindings, nativeAccelerators, bindingConflict } = preferences;
const plain = value => JSON.parse(JSON.stringify(value));
const key = (command, key) => ({ command, key });
const unknown = key("future.action", "Ctrl+Alt+U");
let bindings = [unknown];
bindings = updateKeyBindings(bindings, "new-chat", { type: "set", accelerator: "Ctrl+Alt+N" });
assert.deepEqual(plain(shortcut.effectiveBindings("new-chat", bindings)), ["Ctrl+Alt+N", "CmdOrCtrl+Shift+O"], "set preserves the second binding");
bindings = updateKeyBindings(bindings, "new-chat", { type: "append", accelerator: "G G" });
assert.equal(shortcut.effectiveBindings("new-chat", bindings).length, 3);
bindings = updateKeyBindings(bindings, "new-chat", { type: "remove", accelerator: "Ctrl+Alt+N" });
assert.equal(shortcut.effectiveBindings("new-chat", bindings).length, 2);
bindings = updateKeyBindings(bindings, "new-chat", { type: "clear" });
assert.deepEqual(plain(shortcut.effectiveBindings("new-chat", bindings)), []);
bindings = updateKeyBindings(bindings, "new-chat", { type: "reset" });
assert.deepEqual(plain(bindings), [unknown], "reset removes custom records while retaining unknown commands");
const stolen = updateKeyBindings([], "fork-thread", { type: "set", accelerator: "CmdOrCtrl+K" });
assert.ok(!shortcut.effectiveBindings("command-palette", stolen).includes("CmdOrCtrl+K"));
const released = updateKeyBindings(stolen, "fork-thread", { type: "clear" });
assert.ok(shortcut.effectiveBindings("command-palette", released).includes("CmdOrCtrl+Shift+P"), "remaining alternate stays available");
const onlyDefault = updateKeyBindings([], "fork-thread", { type: "set", accelerator: "CmdOrCtrl+P" });
const restored = updateKeyBindings(onlyDefault, "fork-thread", { type: "clear" });
assert.ok(!restored.some(binding => binding.command === "searchFiles"), "released disabled default restores");
assert.equal(bindingConflict("new-chat", "Control+K", []), "命令面板 / 快速搜索");
assert.equal(nativeAccelerators([key("newTask", null)])["new-chat"], null);
assert.equal(nativeAccelerators([key("newTask", "G G")])["new-chat"], null);
assert.equal(nativeAccelerators([key("newTask", "G")])["new-chat"], null, "bare keys must not become native global accelerators");
assert.ok(Object.values(nativeAccelerators([], true)).every(value => value === null));
assert.equal(nativeAccelerators([])["zoom-in"], "CmdOrCtrl+Shift+Equal");
assert.equal(shortcut.normalizeAccelerator("Super+K"), "meta+k");
assert.equal(shortcut.normalizeAccelerator("Option+K"), "alt+k");
assert.notEqual(shortcut.normalizeAccelerator("Bogus+K"), "k");
assert.equal(shortcut.acceleratorFromEvent(event(":", { ctrlKey: true, shiftKey: true, code: "Semicolon" })), "Ctrl+Shift+;");
assert.equal(shortcut.acceleratorFromEvent(event("(", { ctrlKey: true, shiftKey: true, code: "Digit9" })), "Ctrl+Shift+9");
const custom = [key("newTask", "G G"), key("openCommandMenu", "Ctrl+Alt+K"), key("settings", "Super+K")];
const matcher = shortcut.createShortcutMatcher(() => custom);
assert.equal(matcher(event("g")).pending, true);
assert.equal(matcher(event("g")).id, "new-chat");
assert.equal(matcher(event("k")).id, null, "Super is never dropped");
assert.equal(matcher(event("k", { metaKey: true })).id, "open-settings");
assert.equal(matcher(event("k", { ctrlKey: true })).id, null, "overridden default no longer fires");
assert.equal(matcher(event("g")).pending, true);
assert.equal(matcher(event("Escape")).id, null);
const input = { closest: selector => selector === ".xterm" ? null : {} };
assert.equal(shortcut.shortcutEventAllowed(event("g", { target: input }), custom), false);
assert.equal(shortcut.shortcutEventAllowed(event("g", { ctrlKey: true, target: input }), custom), true);
const terminal = { closest: selector => selector === ".xterm" ? {} : null };
assert.equal(shortcut.shortcutEventAllowed(event("k", { ctrlKey: true, target: terminal }), []), false);
assert.equal(shortcut.shortcutEventAllowed(event("`", { ctrlKey: true, code: "Backquote", target: terminal }), []), true);
const official = JSON.parse(fs.readFileSync("scripts/fixtures/keyboard-defaults.json", "utf8"));
for (const def of preferences.configurableShortcuts) {
  const reference = official.defaults[shortcut.commandId(def.id)];
  assert.ok(reference, def.id);
  assert.deepEqual(plain(shortcut.defaultBindings(def.id)), reference, def.id + " defaults match original archive");
}
console.log("PASS KB01-KB04: production updates, null/reset, defaults from archive, conflict, native map, sequences and input/terminal scope");

const calls = [], flush = () => new Promise(setImmediate);
let store = [unknown], failWrite = false, failRead = false, menuGate = null;
invoke = async (method, args) => {
  calls.push([method, args]);
  if (method === "shortcut_menu_sync") { if (menuGate) await menuGate; return; }
  if (method === "keyboard_bindings_write") { if (failWrite) throw Error("disk denied"); store = plain(args.bindings).sort((a, b) => a.command.localeCompare(b.command)); return { bindings: store, warning: null }; }
  if (failRead) throw Error("read denied");
  return { bindings: plain(store), warning: null };
};
const render = () => { cursor = 0; state = preferences.useKeyboardPreferences(); for (const effect of effects.splice(0)) effect(); return state; };
render(); assert.equal(await state.save([]), false, "initial read blocks writes");
await flush(); render(); assert.deepEqual(plain(state.bindings), [unknown]);
const changed = updateKeyBindings(state.bindings, "new-chat", { type: "set", accelerator: "Ctrl+Alt+N" });
assert.equal(await state.save(changed), true); render();
assert.equal(shortcut.matchShortcut(event("n", { ctrlKey: true, altKey: true }), state.bindings), "new-chat");
assert.equal(shortcut.matchShortcut(event("n", { ctrlKey: true }), state.bindings), null);
failWrite = true; const startCalls = calls.length;
assert.equal(await state.save([]), false); render(); assert.match(state.error, /保存快捷键失败/);
assert.deepEqual(plain(calls.at(-1)[1].accelerators), plain(nativeAccelerators(changed)), "disk failure restores previous native bindings");
assert.equal(calls.slice(startCalls).filter(call => call[0] === "keyboard_bindings_write").length, 1);
failWrite = false; failRead = true;
assert.equal(await state.save([]), true, "written but unconfirmed is partial success");
render(); assert.deepEqual(plain(state.bindings), []); assert.match(state.error, /已保存，但读取确认失败/);
failRead = false;
let releaseMenu; menuGate = new Promise(resolve => releaseMenu = resolve);
const opening = state.setCapturing(true);
assert.equal(await state.setCapturing(false), false, "release is queued while capture startup is pending");
releaseMenu(); menuGate = null; await opening; await flush(); render();
assert.equal(state.capturing.current, false, "queued release clears capture after delayed startup");
assert.ok(Object.values(calls.at(-1)[1].accelerators).some(Boolean), "menu accelerators restored");
for (const hook of reactHooks) hook?.cleanup?.();
console.log("PASS KB05-KB07: production hook startup, real persistence/readback, rollback, partial success, capture startup/release race");

// Execute the production JSX callbacks; this is a component replay, not browser or native UI evidence.
function mountSettings() {
  const hooks = [], effects = [], dom = new Map(), timers = new Map();
  let cursor = 0, tree, active, timerId = 0;
  const children = node => node && typeof node === "object" ? [node, ...node.children.flatMap(children)] : [];
  const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], v => hooks[i] = typeof v === "function" ? v(hooks[i]) : v]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, previous = hooks[i]; if (!previous || deps.some((d, j) => d !== previous.deps[j])) { previous?.cleanup?.(); hooks[i] = { deps }; effects.push(() => hooks[i].cleanup = fn()); } },
  };
  const state = { bindings: [], busy: false, error: null, capturing: { current: false }, writes: [], captures: [],
    async save(next) { this.writes.push(plain(next)); this.bindings = plain(next); return true; },
    async setCapturing(value) { this.captures.push(value); this.capturing.current = value; return true; }, reload() {},
  };
  const component = load("src/components/KeyboardShortcutsSettings.tsx", { react, "../shortcuts": shortcut, "../keyboardPreferences": preferences }, {
    document: { get activeElement() { return active; } },
    setTimeout(fn, ms) { assert.equal(ms, 1000); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  }).KeyboardShortcutsSettings;
  const element = node => {
    const id = node.props["aria-label"] ?? node.props.ref ?? node;
    if (!dom.has(id)) dom.set(id, { opened: false, focus() { active = this; }, showModal() { this.opened = true; }, close() { this.opened = false; } });
    return dom.get(id);
  };
  const render = () => {
    cursor = 0; tree = component({ state });
    for (const node of children(tree)) if (node.props.ref) node.props.ref.current = element(node);
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  const find = fn => children(render()).find(fn);
  const button = label => find(node => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
  const press = (node, key, options = {}) => {
    const nativeEvent = event(key, options);
    node.props.onKeyDown({ ...nativeEvent, nativeEvent, preventDefault() {}, stopPropagation() {} });
    render();
  };
  const click = async (node, options = {}) => {
    await node.props.onClick({ currentTarget: element(node), ...options }); await flush(); render();
  };
  render();
  return { state, find, button, press, click, render, timers,
    unmount: () => { for (const hook of hooks) hook?.cleanup?.(); } };
}
const page = mountSettings();
const search = () => page.find(node => node.type === "input" && node.props.type === "search");
search().props.onChange({ target: { value: "newTask" } }); page.render();
assert.ok(page.button("更改 新建会话 的按键组合"));
assert.equal(page.button("更改 打开设置 的按键组合"), undefined);
search().props.onChange({ target: { value: "" } }); page.render();
await page.click(page.button("使用快捷键搜索"));
page.press(search(), "n", { ctrlKey: true });
assert.equal(search().props.value, "Ctrl+N");
assert.ok(page.button("更改 新建会话 的按键组合"));
page.press(search(), "Escape"); assert.equal(page.state.capturing.current, false);
await page.click(page.button("更改 新建会话 的按键组合"));
const captureInput = () => page.find(node => node.type === "input" && node.props["aria-label"] === "为 新建会话 录入快捷键");
page.press(captureInput(), "x", { ctrlKey: true, altKey: true, isComposing: true });
assert.equal(page.state.writes.length, 0);
page.press(captureInput(), "k", { ctrlKey: true });
assert.ok(page.find(node => node.props.role === "alert"), "conflict shown inline without writing");
assert.equal(page.state.writes.length, 0);
page.press(captureInput(), "Escape"); await flush(); page.render();
await page.click(page.button("更改 新建会话 的按键组合"));
page.press(captureInput(), "g"); assert.equal(page.timers.size, 1);
page.press(captureInput(), "h"); await flush(); page.render();
assert.equal(page.timers.size, 0, "second stroke clears capture timer");
assert.ok(shortcut.effectiveBindings("new-chat", page.state.bindings).includes("G H"));
assert.equal(page.state.capturing.current, false);
await page.click(page.button("全部重置为默认值"));
await page.click(page.button("取消"));
assert.notEqual(page.state.bindings.length, 0, "reset cancellation leaves bindings intact");
await page.click(page.button("全部重置为默认值"));
await page.click(page.button("全部重置"));
assert.deepEqual(page.state.bindings, []);
page.unmount(); await flush(); assert.equal(page.state.capturing.current, false);
console.log("PASS KB08-KB10: production settings search, key search, IME, conflict, sequence capture, cancellation and confirmed reset (L2; browser/native unverified)");
