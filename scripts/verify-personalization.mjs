import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/PersonalizationSettings.tsx", "utf8");
let invoke, slots = [], cursor = 0, effects = [], scheduled = [], rerender = false, nativeRuntime = false;
const calls = [], listeners = new Map(), hostListeners = new Map(), frames = [];
let focus = "", guard = null;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => {
      const next = typeof value === "function" ? value(slots[index]) : value;
      if (!Object.is(slots[index], next)) rerender = true;
      slots[index] = next;
    }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
  useEffect(callback, deps) {
    const index = cursor++, previous = effects[index];
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) scheduled.push(() => {
      previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() };
    });
  },
};
const mod = { exports: {} };
const MemorySettings = Symbol("MemorySettings");
const navigation = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/navigationContinuation.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: navigation });
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, {
  exports: mod.exports,
  require: name => name === "react" ? react : name === "../bridge" ? {
    isTauriRuntime: () => nativeRuntime,
    tauriInvoke: (...args) => { calls.push(args); return invoke(...args); },
    tauriListen: async (name, handler) => {
      const handlers = hostListeners.get(name) || new Set(); hostListeners.set(name, handlers); handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
  } : name === "./MemorySettings" ? { MemorySettings } : name === "../navigationContinuation" ? navigation : name.endsWith(".css") ? {} : { ChevronRightIcon: () => null },
  window: {
    addEventListener(name, handler) { const handlers = listeners.get(name) || new Set(); listeners.set(name, handlers); handlers.add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
  },
  requestAnimationFrame: callback => frames.push(callback),
});
const { PersonalizationSettings } = mod.exports;
const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const nativeDialog = { opened: false, showModal() { this.opened = true; }, close() { this.opened = false; } };
const props = { active: true, accountIdentity: "account-one", connectionIdentity: "connected:one", onNavigationGuardChange: value => { guard = value; } };
let tree;
function render() {
  let count = 0;
  do {
    assert.ok(count++ < 12, "production effects must converge");
    cursor = 0; rerender = false;
    tree = PersonalizationSettings(props);
    for (const node of nodes(tree)) {
      if (node.type === "dialog") node.props.ref.current = nativeDialog;
      else if (node.props.ref) node.props.ref.current = { focus() { focus = node.type === "textarea" ? "editor" : "entry"; } };
    }
    scheduled.splice(0).forEach(effect => effect());
  } while (rerender);
  frames.splice(0).forEach(callback => callback());
}
function button(label) {
  const result = nodes(tree).find(node => node.type === "button" && text(node) === label);
  assert.ok(result, `button ${label}`); return result;
}
const entry = () => nodes(tree).find(node => node.props.className === "personalization-entry-row");
const editor = () => nodes(tree).find(node => node.type === "textarea");
const edit = value => { editor().props.onChange({ target: { value } }); render(); };
const settle = async () => { for (let i = 0; i < 14; i++) await Promise.resolve(); };
const open = async () => { entry().props.onClick(); render(); await settle(); render(); };
const emitWindow = (name, event = {}) => { for (const handler of listeners.get(name) || []) handler(event); };
const emitHost = payload => { for (const handler of hostListeners.get("personal-instructions-changed") || []) handler(payload); };
const snapshot = { hostId: "local:home-one", path: "C:/isolated/AGENTS.md", contents: "initial\r\n", hasOverride: true };
let persisted = snapshot;
invoke = async () => persisted;
render(); await settle();
const memory = nodes(tree).find(node => node.type === MemorySettings);
assert.ok(memory, "memory is composed into the actual personalization overview");
memory.props.onNavigationGuardChange(() => false);
entry().props.onClick(); render();
assert.equal(editor(), undefined, "pending memory mutation prevents switching to the file editor");
assert.equal(guard(() => assert.fail("navigation must not run")), false, "memory busy protection reaches the global parent guard");
memory.props.onNavigationGuardChange(null);
assert.equal(editor(), undefined); assert.ok(entry()); assert.ok(text(entry()).includes("Codex 指令"));
assert.ok(text(entry()).includes("编辑所选机器上的 AGENTS.md 文件。代码仓库的说明也可能适用。"));
assert.equal(nodes(tree).filter(node => node.type === "a")[0].props.href, "https://developers.openai.com/codex/guides/agents-md/#create-global-guidance");
const link = () => nodes(tree).find(node => node.type === "a");
let preventedLink = 0;
const linkEvent = { preventDefault() { preventedLink++; } };
await link().props.onClick(linkEvent); assert.equal(preventedLink, 0, "browser preserves external href behavior");
nativeRuntime = true;
invoke = async method => { assert.equal(method, "open_help_link"); throw Error("shell unavailable"); };
await link().props.onClick(linkEvent); render(); assert.ok(text(tree).includes("无法打开说明文档"));
assert.equal(preventedLink, 1); assert.equal(calls.at(-1)[1].target, "global-guidance");
invoke = async () => persisted;
await open();
assert.equal(editor().props.value, snapshot.contents); assert.equal(editor().props.rows, 13); assert.equal(editor().props["aria-label"], "Codex 指令");
assert.equal(focus, "editor"); assert.ok(nodes(tree).some(node => text(node) === "这些说明已被 AGENTS.override.md 覆盖"));
assert.equal(button("保存").props.disabled, true); assert.equal(guard(() => assert.fail("clean guard must not execute actions")), true);
edit("draft\r\n  "); assert.equal(button("保存").props.disabled, false); assert.equal(listeners.get("beforeunload").size, 1);
invoke = async method => { assert.equal(method, "open_help_link"); return {}; };
await link().props.onClick(linkEvent); render();
assert.equal(editor().props.value, "draft\r\n  "); assert.equal(nativeDialog.opened, false, "external help opens independently without dirty navigation");
invoke = async () => persisted;
let navigated = 0;
assert.equal(guard(() => { navigated++; }), false); render(); assert.equal(nativeDialog.opened, true);
button("继续编辑").props.onClick(); render(); assert.equal(navigated, 0); assert.equal(editor().props.value, "draft\r\n  ");
let reentry;
assert.equal(guard(() => { reentry = guard(() => {}); navigated++; }), false); render();
button("放弃更改").props.onClick(); render(); assert.equal(reentry, true); assert.equal(navigated, 1); assert.equal(editor(), undefined);
await open(); edit("back draft"); button("返回").props.onClick(); render(); assert.equal(nativeDialog.opened, true);
button("继续编辑").props.onClick(); render(); assert.equal(editor().props.value, "back draft");
button("取消").props.onClick(); render(); assert.equal(editor(), undefined);
assert.equal(calls.filter(([method]) => method === "personal_instructions_write").length, 0);
console.log("PASS PI-B01: production row/exact local Chinese/real guidance link, override, back/cancel and global navigation discard with synchronous guard clearing");

await open(); edit("saved\n  ");
props.active = false; render(); assert.equal(tree, null); assert.equal(guard, null); assert.equal(listeners.get("keydown").size, 0);
props.active = true; render(); assert.equal(editor().props.value, "saved\n  ");
let release;
invoke = () => new Promise(resolve => { release = resolve; });
const first = button("保存").props.onClick(); const duplicate = button("保存").props.onClick(); await duplicate; render();
assert.equal(guard(() => assert.fail("busy navigation")), false);
const writes = calls.filter(([method]) => method === "personal_instructions_write"); assert.equal(writes.length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(writes[0][1])), { contents: "saved\n  ", expectedContents: snapshot.contents, expectedPath: snapshot.path, expectedHostId: snapshot.hostId });
release({ ...snapshot, contents: "saved\n  " }); await first; render();
assert.equal(editor(), undefined); assert.ok(nodes(tree).some(node => text(node) === "说明更新成功")); assert.equal(focus, "entry");
console.log("PASS PI-B02: inactive page preserves draft, save single-flight, busy navigation refuses, exact host/path/content CAS payload and verified result returns to entry");

invoke = async () => snapshot; await open(); edit("");
invoke = async () => { throw Error("disk denied"); };
await button("保存").props.onClick(); render(); assert.equal(editor().props.value, "");
assert.ok(nodes(tree).some(node => node.props.role === "alert" && text(node).includes("说明保存失败")));
let keySaves = 0;
invoke = async () => { keySaves++; throw Error("offline"); };
const key = (value, composing = false, keyCode = 0, meta = false) => ({ key: value, ctrlKey: !meta, metaKey: meta, altKey: false, isComposing: composing, keyCode, nativeEvent: { isComposing: composing }, preventDefault() {} });
emitWindow("keydown", key("s", true)); emitWindow("keydown", key("s", false, 229));
nodes(tree).find(node => node.props.onKeyDown).props.onKeyDown(key("Enter", true)); await settle(); assert.equal(keySaves, 0);
emitWindow("keydown", key("s")); await settle(); render(); assert.equal(keySaves, 1);
emitWindow("keydown", key("S", false, 0, true)); await settle(); render(); assert.equal(keySaves, 2);
emitWindow("keydown", key("Enter")); await settle(); assert.equal(keySaves, 2, "Enter is not registered globally");
nodes(tree).find(node => node.props.onKeyDown).props.onKeyDown(key("Enter")); await settle(); render(); assert.equal(keySaves, 3);
invoke = async () => ({ ...snapshot, contents: "wrong" }); await button("保存").props.onClick(); render();
assert.equal(editor().props.value, ""); assert.ok(text(tree).includes("写入后的指令与提交内容不一致"));
console.log("PASS PI-B03: failure/empty drafts retained, global CmdOrCtrl+S and source-proven local CmdOrCtrl+Enter, IME/229 exclusion and wrong readback refusal");

button("取消").props.onClick(); render();
props.connectionIdentity = "connected:initial-error"; render();
invoke = async () => { throw Error("read failed"); }; await open();
assert.equal(editor(), undefined); assert.ok(text(tree).includes("说明加载失败"));
invoke = async () => snapshot; button("重试").props.onClick(); await settle(); render(); assert.equal(editor().props.value, snapshot.contents);
// Read begun while clean must not clobber edits typed before the response arrives.
invoke = () => new Promise(resolve => { release = resolve; }); emitWindow("focus"); render();
edit("typed during refresh"); release({ ...snapshot, contents: "external changed" }); await settle(); render();
assert.equal(editor().props.value, "typed during refresh"); assert.ok(text(tree).includes("你的草稿已保留"));
const readsBefore = calls.length;
emitHost({ hostId: snapshot.hostId, path: snapshot.path }); await settle(); render(); assert.equal(calls.length, readsBefore);
emitHost({ hostId: "other", path: snapshot.path }); await settle(); assert.equal(calls.length, readsBefore);
button("重新加载").props.onClick(); render(); assert.equal(nativeDialog.opened, true);
button("继续编辑").props.onClick(); render(); assert.equal(editor().props.value, "typed during refresh");
invoke = async () => ({ ...snapshot, contents: "fresh disk\r\n" });
button("重新加载").props.onClick(); render(); focus = "dialog";
button("放弃更改").props.onClick(); await settle(); render();
assert.equal(editor().props.value, "fresh disk\r\n");
assert.equal(focus, "editor", "explicit successful reload restores focus after closing the discard dialog");
focus = "other-control";
invoke = async () => ({ ...snapshot, contents: "cross-window clean" }); emitHost({ hostId: snapshot.hostId, path: snapshot.path }); await settle(); render();
assert.equal(editor().props.value, "cross-window clean");
assert.equal(focus, "other-control", "background reload must not steal focus");
edit("reload pending at identity change"); emitHost({ hostId: snapshot.hostId, path: snapshot.path }); render();
invoke = () => new Promise(resolve => { release = resolve; });
button("重新加载").props.onClick(); render(); button("放弃更改").props.onClick(); render();
const staleReload = release;
props.connectionIdentity = "connected:after-stale-reload"; render(); focus = "new-identity-control";
staleReload({ ...snapshot, contents: "stale explicit reload" }); await settle(); render();
assert.equal(editor(), undefined); assert.equal(focus, "new-identity-control", "late explicit reload must not focus the new identity");
console.log("PASS PI-B04: initial error retry, clean focus/cross-window refresh, dirty and in-flight refresh preserve drafts, unrelated host ignored and explicit reload requires confirmation");

if (editor()) { button("取消").props.onClick(); render(); }
invoke = () => new Promise(resolve => { release = resolve; }); entry().props.onClick(); render();
const oldRead = release;
props.accountIdentity = "account-two"; render(); assert.equal(editor(), undefined); assert.ok(entry());
invoke = async () => ({ ...snapshot, hostId: "local:home-two", contents: "second identity" }); await open();
oldRead({ ...snapshot, contents: "late old account" }); await settle(); render(); assert.equal(editor().props.value, "second identity");
edit("account two draft");
invoke = () => new Promise(resolve => { release = resolve; }); const lateWrite = button("保存").props.onClick(); render(); const releaseWrite = release;
props.connectionIdentity = "disconnected:one"; render(); assert.equal(editor(), undefined);
props.connectionIdentity = "connected:one"; render(); assert.equal(editor(), undefined);
releaseWrite({ ...snapshot, hostId: "local:home-two", contents: "account two draft" }); await lateWrite; render();
assert.equal(editor(), undefined); assert.ok(!text(tree).includes("说明更新成功"));
invoke = async () => ({ ...snapshot, contents: "current" }); await open(); edit("pending unmount");
invoke = () => new Promise(resolve => { release = resolve; }); const unmountedWrite = button("保存").props.onClick();
effects.forEach(effect => effect?.cleanup?.()); const stateBefore = slots.filter(slot => slot === null || typeof slot !== "object");
release({ ...snapshot, contents: "pending unmount" }); await unmountedWrite; await settle();
assert.deepEqual(slots.filter(slot => slot === null || typeof slot !== "object"), stateBefore);
assert.equal(guard, null); assert.equal([...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0), 0);
assert.equal([...hostListeners.values()].reduce((sum, handlers) => sum + handlers.size, 0), 0);
console.log("PASS PI-B05: account/connection identity and reconnect isolate late reads/writes, no old content/success, unmount invalidates callbacks and disposes all listeners/guard");

assert.ok(!source.includes("config_update") && !source.includes("desktop_state_set"));
assert.ok(!source.includes("custom_instructions:"), "local AGENTS.md must not masquerade as cloud account instructions");
console.log("PASS PI-B06: local file contract and real Memory composition; account/gated Markdown are not fabricated");
