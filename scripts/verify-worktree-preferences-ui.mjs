import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Executes production React callbacks/effects with controlled native IPC, not pixel/native evidence.
const source = ts.transpileModule(fs.readFileSync("src/components/WorktreeSettings.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const defaults = () => ({ hostId: "local", preferences: { autoCleanupEnabled: true, keepCount: 15, upstreamRefreshMode: "never", confirmBeforeDelete: true }, expected: {} });
function mount(options = {}) {
  const hooks = [], effects = [], calls = [], frames = [];
  const listeners = new Map();
  let cursor = 0, tree, changes = 0, focused = "", root = "", data = defaults(), read = options.read ?? (async () => structuredClone(data));
  let write = async args => (data = { hostId: "local", preferences: structuredClone(args.preferences), expected: { revision: calls.length } });
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; changes++; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useEffect(callback) { effects.push(callback); },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, document: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) }, requestAnimationFrame: callback => frames.push(callback), require(name) {
    if (name === "react") return react;
    if (name.endsWith(".css")) return {};
    if (name === "../bridge") return { tauriInvoke: async (command, args) => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "desktop_state_get") return root;
      if (command === "desktop_state_set") { root = args.value; return; }
      if (command === "worktree_preferences_read") return read(args);
      if (command === "worktree_preferences_write") return write(args);
      throw Error(command);
    } };
    throw Error(name);
  } });
  const walk = node => node && typeof node === "object" ? [node, ...node.children.flatMap(walk)] : [];
  const text = node => typeof node === "string" ? node : node && typeof node === "object" ? node.children.map(text).join("") : "";
  function render() {
    cursor = 0; tree = module.exports.WorktreeSettings();
    for (const node of walk(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? modal : { focus() { focused = node.props.id || text(node); }, contains: target => target === "inside" };
    frames.splice(0).forEach(callback => callback()); return tree;
  }
  render(); const cleanup = effects[0]();
  return { calls, modal, render, listeners, text: () => text(render()), get changes() { return changes; }, get focused() { return focused; },
    find: id => walk(render()).find(node => node.props.id === id),
    button: label => walk(render()).find(node => node.type === "button" && text(node) === label),
    writes: () => calls.filter(call => call.command === "worktree_preferences_write"),
    setRead: callback => read = callback, setWrite: callback => write = callback,
    unmount: () => cleanup(),
  };
}
const enter = (isComposing = false) => ({ key: "Enter", keyCode: isComposing ? 229 : 13, nativeEvent: { isComposing }, preventDefault() {}, stopPropagation() {} });
const page = mount(); await flush(); page.render();
assert.equal(page.find("worktree-auto-cleanup").props["aria-checked"], true);
assert.equal(page.find("worktree-keep-count").props.value, "15");
page.find("worktree-snapshot-info").props.onClick(); assert.ok(page.find("worktree-snapshot-details"));
page.listeners.get("pointerdown")({ target: "inside" }); assert.ok(page.find("worktree-snapshot-details"));
page.listeners.get("pointerdown")({ target: "outside" }); assert.equal(page.find("worktree-snapshot-details"), undefined);
page.find("worktree-snapshot-info").props.onClick();
page.find("worktree-snapshot-info-container").props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
assert.equal(page.find("worktree-snapshot-details"), undefined);
const edit = value => page.find("worktree-keep-count").props.onChange({ target: { value } });
edit("21"); page.find("worktree-auto-cleanup").props.onClick();
assert.equal(page.modal.open, true); assert.equal(page.focused, "启用自动删除功能");
assert.equal(page.writes().length, 0, "opening confirmation must not disable cleanup");
page.button("启用自动删除功能").props.onClick(); page.render();
assert.equal(page.modal.open, false); assert.equal(page.focused, "worktree-auto-cleanup");
assert.equal(page.find("worktree-keep-count").props.value, "21", "cancel retains count draft and enabled preference");
page.find("worktree-auto-cleanup").props.onClick(); page.button("禁用自动删除功能").props.onClick(); await flush(); page.render();
assert.equal(page.writes().at(-1).args.preferences.autoCleanupEnabled, false);
assert.equal(page.find("worktree-auto-cleanup").props["aria-checked"], false);
assert.equal(page.find("worktree-keep-count").props.disabled, true); assert.equal(page.find("worktree-keep-count").props.value, "15");
assert.match(page.text(), /自动删除功能已禁用/);
page.find("worktree-auto-cleanup").props.onClick(); await flush();
assert.equal(page.find("worktree-auto-cleanup").props["aria-checked"], true, "enable writes directly without dialog");
for (const [input, normalized] of [[" -3.9 ", 1], ["19.9", 19]]) {
  edit(input); page.find("worktree-keep-count").props.onBlur(); await flush();
  assert.equal(page.writes().at(-1).args.preferences.keepCount, normalized);
  assert.equal(page.find("worktree-keep-count").props.value, String(normalized));
}
const count = page.writes().length;
for (const input of ["", "  ", "NaN", "Infinity", "19.9"]) {
  edit(input); page.find("worktree-keep-count").props.onBlur(); await flush();
  assert.equal(page.writes().length, count, "invalid or normalized unchanged count must not write");
  assert.equal(page.find("worktree-keep-count").props.value, "19");
}
edit("23"); page.find("worktree-keep-count").props.onKeyDown(enter(true)); await flush();
assert.equal(page.writes().length, count, "IME confirmation must not submit count");
page.find("worktree-keep-count").props.onKeyDown(enter()); await flush();
assert.equal(page.writes().at(-1).args.preferences.keepCount, 23);
page.find("worktree-upstream-refresh").props.onClick(); await flush();
assert.equal(page.writes().at(-1).args.preferences.upstreamRefreshMode, "best-effort");
page.find("worktree-confirm-delete").props.onClick(); await flush();
assert.equal(page.writes().at(-1).args.preferences.confirmBeforeDelete, false);
assert.equal(page.find("worktree-upstream-refresh").props["aria-checked"], true);
assert.equal(page.calls.filter(call => call.command === "worktree_preferences_read").length, page.writes().length + 1, "every accepted write must reread native persisted preferences");
page.setWrite(async () => { throw Error("CAS conflict"); });
edit("41"); page.find("worktree-keep-count").props.onBlur(); await flush();
assert.equal(page.find("worktree-keep-count").props.value, "41"); assert.match(page.text(), /无法保存自动删除限制.*CAS conflict/);
const reread = defaults(); reread.preferences.keepCount = 31; reread.expected = { external: 2 };
page.setRead(async () => structuredClone(reread)); page.button("重新读取").props.onClick(); await flush();
assert.equal(page.find("worktree-keep-count").props.value, "41", "explicit reread retains failed numeric draft");
page.setWrite(async args => ({ ...reread, preferences: args.preferences, expected: { saved: 3 } }));
page.find("worktree-keep-count").props.onBlur(); await flush();
assert.deepEqual(page.writes().at(-1).args.expected, { external: 2 }, "retry uses refreshed CAS identity");
assert.match(page.text(), /读回不一致/); assert.equal(page.find("worktree-keep-count").props.value, "41");
page.unmount();
assert.equal(page.listeners.size, 0, "snapshot info outside-interaction listener must be released");

const busy = mount(); await flush();
const pending = deferred(); busy.setWrite(() => pending.promise);
busy.find("worktree-keep-count").props.onChange({ target: { value: "32" } });
const input = busy.find("worktree-keep-count"); input.props.onBlur(); input.props.onKeyDown(enter());
busy.find("worktree-upstream-refresh").props.onClick();
assert.equal(busy.writes().length, 1, "blur/Enter/different control share single write guard");
assert.equal(busy.find("worktree-keep-count").props.disabled, true);
busy.unmount(); const before = busy.changes; pending.resolve({ ...defaults(), preferences: { ...defaults().preferences, keepCount: 32 } }); await flush();
assert.equal(busy.changes, before, "late write must not update unmounted state");
assert.equal(busy.calls.filter(call => call.command === "worktree_preferences_read").length, 1, "unmounted write must not dispatch reread");
const failed = mount(); await flush();
failed.setRead(async () => { throw Error("read denied"); }); failed.setWrite(async () => { throw Error("save denied"); });
failed.find("worktree-upstream-refresh").props.onClick(); await flush();
assert.equal(failed.find("worktree-upstream-refresh").props["aria-checked"], false);
assert.match(failed.text(), /save denied/); failed.button("重新读取").props.onClick(); await flush(); assert.match(failed.text(), /read denied/);
failed.unmount();
const denied = mount({ read: async () => { throw Error("initial denied"); } }); await flush();
assert.match(denied.text(), /initial denied/); assert.equal(denied.find("worktree-auto-cleanup").props.disabled, true);
denied.find("worktree-auto-cleanup").props.onClick(); assert.equal(denied.writes().length, 0);
denied.unmount();
const lateRead = deferred(), loading = mount({ read: () => lateRead.promise });
loading.unmount(); const loadingBefore = loading.changes; lateRead.resolve(defaults()); await flush();
assert.equal(loading.changes, loadingBefore, "late initial read must not update unmounted state");
console.log("PASS worktree preferences production React callbacks: confirmation/cancel, normalization/IME, native CAS/reread, failure drafts, singleflight and unmount isolation");
