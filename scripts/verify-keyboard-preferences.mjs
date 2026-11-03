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
let cursor = 0, invoke, state, bindingListener;
let listenerDisposed = false;
const react = {
  useState(initial) { const i = cursor++; if (!(i in reactHooks)) reactHooks[i] = initial; return [reactHooks[i], value => reactHooks[i] = typeof value === "function" ? value(reactHooks[i]) : value]; },
  useRef(initial) { const i = cursor++; return reactHooks[i] ??= { current: initial }; },
  useCallback(fn) { cursor++; return fn; },
  useEffect(fn, deps) { const i = cursor++, old = reactHooks[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); reactHooks[i] = { deps }; effects.push(() => reactHooks[i].cleanup = fn()); } },
};
const preferences = load("src/keyboardPreferences.ts", { react, "./shortcuts": shortcut, "./bridge": { tauriInvoke: (...args) => invoke(...args), tauriListen: async (name, fn) => { assert.equal(name, "keyboard-bindings-changed"); bindingListener = fn; return () => listenerDisposed = true; } } });
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
assert.equal(bindingConflict("new-chat", "Control+K", []), "打开命令菜单");
assert.equal(nativeAccelerators([key("newTask", null)])["new-chat"], null);
assert.equal(nativeAccelerators([key("newTask", "G G")])["new-chat"], null);
assert.equal(nativeAccelerators([key("newTask", "G")])["new-chat"], null, "bare keys must not become native global accelerators");
assert.ok(Object.values(nativeAccelerators([], true)).every(value => value === null));
assert.equal(nativeAccelerators([])["zoom-in"], "Ctrl+Shift+Equal");
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
assert.throws(() => updateKeyBindings([], "command-palette", { type: "set", accelerator: "G H" }), /不支持组合序列/);
assert.throws(() => updateKeyBindings([], "composer-submit", { type: "append", accelerator: "G H" }), /不支持组合序列/);
assert.equal(bindingConflict("composer-submit", "Enter", []), null, "official submit/approve Enter sharing");
assert.equal(bindingConflict("fork-thread", "G", [key("newTask", "G H")]), "新聊天", "a sequence prefix cannot shadow another binding");
assert.equal(bindingConflict("fork-thread", "G H", [key("newTask", "G")]), "新聊天");
const metadata = { command: "newTask", key: "Ctrl+Alt+N", version: 1, future: { keep: true } };
const metadataUpdated = updateKeyBindings([metadata, { ...unknown, future: 7 }], "new-chat", { type: "replace", previousAccelerator: "Ctrl+Alt+N", accelerator: "Ctrl+Alt+M" });
assert.deepEqual(plain(metadataUpdated.find(record => record.command === "newTask")), { ...metadata, key: "Ctrl+Alt+M" });
assert.equal(metadataUpdated.find(record => record.command === unknown.command).future, 7);
const aliasSaved = updateKeyBindings([{ command: "newThread", key: "Alt+N", extra: "keep" }, { command: "newTask", key: "Alt+F", version: 2 }, unknown], "new-chat", { type: "replace", previousAccelerator: "Alt+N", accelerator: "Alt+M" });
assert.deepEqual(plain(aliasSaved.find(record => record.key === "Alt+M")), { command: "newTask", key: "Alt+M", extra: "keep" });
assert.ok(aliasSaved.some(record => record.command === "newTask" && record.version === 2), "future record stays byte-shape equivalent on same-command update");
assert.ok(!aliasSaved.some(record => record.command === "newThread"));
const sharedAlias = [{ command: "closeTabOrWindow", key: "Alt+W", futureExtra: 9 }, unknown];
// Inject only test command metadata to exercise the shared-alias update path. This
// does not advertise closeTab in the production supported command catalog.
shortcut.SHORTCUT_COMMAND_IDS["fixture-close-tab"] = "closeTab";
preferences.configurableShortcuts.push({ id: "fixture-close-tab" });
const sharedSaved = updateKeyBindings(sharedAlias, "fixture-close-tab", { type: "set", accelerator: "Alt+Shift+W" });
assert.ok(sharedSaved.some(record => record.command === "closeWindow" && record.key === "Alt+W" && record.futureExtra === 9), "editing one legacy shared command preserves its peer");
assert.deepEqual(plain(shortcut.effectiveBindings("fixture-close-tab", sharedSaved)), ["Alt+Shift+W"]);
preferences.configurableShortcuts.pop(); delete shortcut.SHORTCUT_COMMAND_IDS["fixture-close-tab"];
const tabSaved = updateKeyBindings([{ command: "nextTab", key: "Ctrl+Tab" }, { command: "nextTab", key: "Ctrl+PageDown" }, unknown], "next-tab", { type: "set", accelerator: "Alt+T" });
assert.ok(tabSaved.filter(record => record.command === "nextTab").every(record => record.version === 1));
assert.deepEqual(plain(tabSaved.find(record => record.command === unknown.command)), unknown);
const official = JSON.parse(fs.readFileSync("scripts/fixtures/keyboard-defaults.json", "utf8"));
for (const def of preferences.configurableShortcuts) {
  const reference = official.defaults[shortcut.commandId(def.id)];
  assert.ok(reference, def.id);
  assert.deepEqual(plain(shortcut.defaultBindings(def.id)), reference, def.id + " defaults match original archive");
}
console.log("PASS KB01-KB04: production updates, null/reset, defaults from archive, conflict, native map, sequences and input/terminal scope");

const calls = [], flush = () => new Promise(setImmediate);
let store = [unknown], failWrite = false, failRead = false, failMenu = false, menuGate = null, storeRevision = 1, numberTarget = "tabs";
invoke = async (method, args) => {
  calls.push([method, args]);
  if (method === "shortcut_menu_sync") { if (menuGate) await menuGate; if (failMenu) throw Error("menu unavailable"); return; }
  if (method === "keyboard_number_target_read") return { value: numberTarget };
  if (method === "keyboard_number_target_write") { numberTarget = args.value; return { value: numberTarget }; }
  if (method === "keyboard_bindings_write") {
    if (failWrite) throw Error("disk denied");
    if (args.expectedRevision !== String(storeRevision)) throw Error("file changed, revision conflict");
    store = plain(args.bindings).sort((a, b) => a.command.localeCompare(b.command)); storeRevision++;
    return { bindings: store, warning: null, revision: String(storeRevision) };
  }
  if (method !== "keyboard_bindings_read") throw Error("unexpected invocation " + method);
  if (failRead) throw Error("read denied");
  return { bindings: plain(store), warning: null, revision: String(storeRevision) };
};
const render = () => { cursor = 0; state = preferences.useKeyboardPreferences(); for (const effect of effects.splice(0)) effect(); return state; };
render(); assert.equal(await state.save([]), false, "initial read blocks writes");
await flush(); render(); assert.deepEqual(plain(state.bindings), [unknown]);
const changed = updateKeyBindings(state.bindings, "new-chat", { type: "set", accelerator: "Ctrl+Alt+N" });
const firstSaveCall = calls.length;
assert.equal(await state.save(changed), true); render();
assert.equal(calls[firstSaveCall][0], "keyboard_bindings_write", "persist before changing native accelerators");
assert.equal(calls[firstSaveCall][1].expectedRevision, "1");
assert.equal(shortcut.matchShortcut(event("n", { ctrlKey: true, altKey: true }), state.bindings), "new-chat");
assert.equal(shortcut.matchShortcut(event("n", { ctrlKey: true }), state.bindings), null);
failWrite = true; const startCalls = calls.length;
assert.equal(await state.save([]), false); render(); assert.match(state.error, /保存快捷键失败/);
assert.deepEqual(plain(calls.at(-1)[1].accelerators), plain(nativeAccelerators(changed)), "failed write keeps actual disk bindings");
assert.equal(calls.slice(startCalls).filter(call => call[0] === "keyboard_bindings_write").length, 1);
failWrite = false;
store = [...store, key("future.external", "Ctrl+Alt+U")]; storeRevision++;
assert.equal(await state.save([]), false, "stale revision cannot overwrite an external edit"); render();
assert.ok(state.bindings.some(binding => binding.command === "future.external"));
assert.match(state.error, /revision conflict/);
failRead = true;
assert.equal(await state.save([]), false, "written but unconfirmed never reports success");
render(); assert.deepEqual(plain(state.bindings), []); assert.match(state.error, /已保存，但确认或菜单同步失败/);
failRead = false; failMenu = true;
assert.equal(await state.save(changed), false); render();
assert.match(state.error, /已保存.*菜单同步失败/); assert.deepEqual(plain(state.bindings), plain(changed));
failMenu = false; state.reload(); render(); await flush(); render(); assert.equal(state.error, null);
assert.equal(await state.saveNumberTarget("sidebar"), true); render();
assert.equal(state.primaryNumberShortcutTarget, "sidebar");
assert.deepEqual(plain(shortcut.effectiveBindings("sidebar-thread-1", [], state.primaryNumberShortcutTarget)), ["CmdOrCtrl+1"]);
numberTarget = "tabs"; store = [key("settings", "Ctrl+Alt+S")]; storeRevision++;
bindingListener({ changed: true }); render(); await flush(); render();
assert.equal(state.primaryNumberShortcutTarget, "tabs"); assert.deepEqual(plain(state.bindings), store);
let releaseMenu; menuGate = new Promise(resolve => releaseMenu = resolve);
const opening = state.setCapturing(true);
assert.equal(await state.setCapturing(false), false, "release is queued while capture startup is pending");
numberTarget = "sidebar"; bindingListener({ changed: true });
releaseMenu(); menuGate = null; await opening; await flush(); render(); await flush(); render();
assert.equal(state.capturing.current, false, "queued release clears capture after delayed startup");
assert.equal(state.primaryNumberShortcutTarget, "sidebar", "cross-window reload survives queued capture release");
assert.ok(Object.values(calls.at(-1)[1].accelerators).some(Boolean), "menu accelerators restored");
await state.setCapturing(true);
for (const hook of reactHooks) hook?.cleanup?.();
await flush(); assert.equal(listenerDisposed, true); assert.equal(state.capturing.current, false);
console.log("PASS KB05-KB07: production hook revision conflicts, write/readback/menu ordering, partial failure, target persistence, cross-window refresh and capture release");

// A read finishing after unmount must not revive state or leave menu capture suspended.
reactHooks.length = 0; effects.length = 0; listenerDisposed = false;
const normalInvoke = invoke;
let releaseRead;
const readGate = new Promise(resolve => releaseRead = resolve);
invoke = async (method, args) => { if (method === "keyboard_bindings_read") await readGate; return normalInvoke(method, args); };
render();
for (const hook of reactHooks) hook?.cleanup?.();
releaseRead(); await flush();
assert.deepEqual(plain(reactHooks[0]), [], "late initial read cannot replace unmounted state");
assert.equal(listenerDisposed, true, "late listener setup is disposed");
assert.equal(state.capturing.current, false);
invoke = normalInvoke;

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
  const state = { bindings: [], busy: false, error: null, capturing: { current: false }, primaryNumberShortcutTarget: "tabs", writes: [], captures: [],
    async saveNumberTarget(value) { this.primaryNumberShortcutTarget = value; return true; },
    async save(next) { this.writes.push(plain(next)); this.bindings = plain(next); return true; },
    async setCapturing(value) { this.captures.push(value); this.capturing.current = value; return true; }, reload() {},
  };
  const component = load("src/components/KeyboardShortcutsSettings.tsx", { react, "../shortcuts": shortcut, "../keyboardPreferences": preferences }, {
    document: { get activeElement() { return active; } },
    setTimeout(fn, ms) { assert.equal(ms, 1000); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  }).KeyboardShortcutsSettings;
  const element = node => {
    const id = node.domId ?? node.props["aria-label"] ?? node.props.ref ?? node;
    if (!dom.has(id)) dom.set(id, { opened: false, isConnected: false, focus() { if (this.isConnected && !this.disabled) active = this; }, showModal() { this.opened = true; }, close() { this.opened = false; } });
    return dom.get(id);
  };
  const render = () => {
    cursor = 0; tree = component({ state });
    for (const value of dom.values()) value.isConnected = false;
    const attach = (node, path) => {
      if (!node || typeof node !== "object") return;
      node.domId = path;
      const target = element(node); target.isConnected = true; target.disabled = !!node.props.disabled;
      if (typeof node.props.ref === "function") node.props.ref(target);
      else if (node.props.ref) node.props.ref.current = target;
      node.children.forEach((child, index) => attach(child, `${path}/${child?.props?.key ?? index}`));
    };
    attach(tree, "root");
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
  return { state, find, button, press, click, render, timers, element, get active() { return active; },
    unmount: () => { for (const hook of hooks) hook?.cleanup?.(); for (const value of dom.values()) value.isConnected = false; active = null; } };
}
const page = mountSettings();
const search = () => page.find(node => node.type === "input" && node.props.type === "search");
search().props.onChange({ target: { value: "newTask" } }); page.render();
assert.ok(page.button("更改 新聊天 的按键组合"));
assert.equal(page.button("更改 设置 的按键组合"), undefined);
search().props.onChange({ target: { value: "" } }); page.render();
await page.click(page.button("使用快捷键搜索"));
page.press(search(), "n", { ctrlKey: true });
assert.equal(search().props.value, "Ctrl+N");
assert.ok(page.button("更改 新聊天 的按键组合"));
page.press(search(), "Escape"); assert.equal(page.state.capturing.current, false);
await page.click(page.button("更改 新聊天 的按键组合"));
const captureInput = () => page.find(node => node.type === "input" && node.props["aria-label"] === "为 新聊天 录入快捷键");
page.press(captureInput(), "x", { ctrlKey: true, altKey: true, isComposing: true });
assert.equal(page.state.writes.length, 0);
page.press(captureInput(), "k", { ctrlKey: true });
assert.ok(page.find(node => node.props.role === "alert"), "conflict shown inline without writing");
assert.equal(page.state.writes.length, 0);
page.press(captureInput(), "Escape"); await flush(); page.render();
assert.equal(page.active, page.element(page.button("更改 新聊天 的按键组合")), "cancel returns focus to the enabled edit trigger");
await page.click(page.button("更改 新聊天 的按键组合"));
const originalSave = page.state.save; page.state.save = async () => false;
page.press(captureInput(), "y", { altKey: true }); await flush(); page.render();
assert.ok(captureInput(), "failed save retains capture for correction");
assert.equal(page.state.capturing.current, true);
page.state.save = originalSave;
page.press(captureInput(), "Escape"); await flush(); page.render();
await page.click(page.button("更改 新聊天 的按键组合"));
page.press(captureInput(), "g"); assert.equal(page.timers.size, 1);
page.press(captureInput(), "h"); await flush(); page.render();
assert.equal(page.timers.size, 0, "second stroke clears capture timer");
assert.ok(shortcut.effectiveBindings("new-chat", page.state.bindings).includes("G H"));
assert.equal(page.state.capturing.current, false);
assert.equal(page.active, page.element(page.button("更改 新聊天 的按键组合")), "saving a changed key returns focus to the newly mounted edit button");
await page.click(page.button("全部重置为默认值"));
await page.click(page.button("取消"));
assert.notEqual(page.state.bindings.length, 0, "reset cancellation leaves bindings intact");
await page.click(page.button("全部重置为默认值"));
await page.click(page.button("全部重置"));
assert.deepEqual(page.state.bindings, []);
const numberSelect = page.find(node => node.type === "select" && node.props["aria-label"] === "主要编号快捷键用于");
await numberSelect.props.onChange({ target: { value: "sidebar" } }); page.render();
assert.equal(page.state.primaryNumberShortcutTarget, "sidebar");
search().props.onChange({ target: { value: "当前编辑器中的消息" } }); page.render();
assert.ok(page.button("更改 发送消息 的按键组合"), "search includes official command descriptions");
search().props.onChange({ target: { value: "" } }); page.render();
await page.click(page.button("更改 打开命令菜单 的按键组合"));
const hostInput = page.find(node => node.type === "input" && node.props["aria-label"] === "为 打开命令菜单 录入快捷键");
page.press(hostInput, "g"); await flush(); page.render();
assert.equal(page.timers.size, 0, "host commands record one stroke without sequence timer");
assert.deepEqual(plain(shortcut.effectiveBindings("command-palette", page.state.bindings)), ["G", "CmdOrCtrl+Shift+P"]);
page.unmount(); await flush(); assert.equal(page.state.capturing.current, false);
const departing = mountSettings();
await departing.click(departing.button("更改 新聊天 的按键组合"));
let releaseCapture;
const releaseGate = new Promise(resolve => releaseCapture = resolve);
departing.state.setCapturing = async value => { if (!value) await releaseGate; return true; };
const departingInput = departing.find(node => node.type === "input" && node.props["aria-label"] === "为 新聊天 录入快捷键");
departing.press(departingInput, "Escape"); departing.unmount(); releaseCapture(); await flush();
assert.equal(departing.active, null, "delayed capture release after unmount cannot steal focus");
console.log("PASS KB08-KB10: production settings search, key search, IME, conflict, sequence capture, cancellation and confirmed reset (L2; browser/native unverified)");
