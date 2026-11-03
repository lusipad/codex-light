import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/PersonalizationSettings.tsx", "utf8");
const calls = [], listeners = new Map();
let invoke, slots = [], cursor = 0, pendingEffects = [], hooks = [];
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef: initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useEffect: (callback, deps) => {
    const index = cursor++;
    const old = hooks[index];
    if (!old || deps.some((value, offset) => value !== old.deps[offset])) {
      pendingEffects.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
    }
  },
};
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, {
  exports: mod.exports,
  require: name => name === "react" ? react : {
    tauriInvoke: (...args) => { calls.push(args); return invoke(...args); },
  },
  window: { addEventListener: (key, listener) => listeners.set(key, listener), removeEventListener: key => listeners.delete(key) },
  requestAnimationFrame: callback => callback(),
});
const { PersonalizationSettings } = mod.exports;
let active = true, tree;
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...(node.children || []).flatMap(nodes)];
}
const nativeDialog = { opened: false, showModal() { this.opened = true; }, close() { this.opened = false; } };
function render() {
  cursor = 0;
  tree = PersonalizationSettings({ active });
  for (const node of nodes(tree)) {
    if (node.type === "dialog") node.props.ref.current = nativeDialog;
    if (node.type === "button" && node.props.ref) node.props.ref.current = { focus() {} };
  }
  pendingEffects.splice(0).forEach(effect => effect());
}
function button(text) {
  const node = nodes(tree).find(node => node.type === "button" && node.children.includes(text));
  assert.ok(node, text); return node;
}
function editor() { return nodes(tree).find(node => node.type === "textarea"); }
function edit(value) { editor().props.onChange({ target: { value } }); render(); }
const settle = async () => { for (let count = 0; count < 10; count++) await Promise.resolve(); };
const snapshot = { path: "C:/isolated/AGENTS.md", contents: "initial\n", hasOverride: true };
invoke = async () => snapshot;
render();
assert.equal(editor(), undefined);
button("编辑 Codex 自定义指令").props.onClick(); await settle(); render();
assert.equal(editor().props.value, snapshot.contents);
assert.equal(editor().props.rows, 13);
assert.ok(nodes(tree).some(node => node.children.includes("这些说明已被 AGENTS.override.md 覆盖")));
assert.equal(button("保存").props.disabled, true);
edit("draft\r\n  ");
assert.equal(button("保存").props.disabled, false);
assert.ok(listeners.has("beforeunload"));
button("返回").props.onClick(); render();
assert.equal(nativeDialog.opened, true);
button("继续编辑").props.onClick(); render();
assert.equal(editor().props.value, "draft\r\n  ");
button("返回").props.onClick(); render();
button("放弃更改").props.onClick(); render();
assert.equal(editor(), undefined);
assert.equal(nativeDialog.opened, false);
button("编辑 Codex 自定义指令").props.onClick(); await settle(); render();
edit("cancelled"); button("取消").props.onClick(); render();
assert.equal(calls.filter(([method]) => method === "personal_instructions_write").length, 0);
console.log("PASS PI03: actual overview/editor JSX, exact text/13 rows, override warning, dirty save and cancel/back discard confirmation");

button("编辑 Codex 自定义指令").props.onClick(); await settle(); render(); edit("saved\n  ");
active = false; render(); assert.equal(tree, null);
active = true; render(); assert.equal(editor().props.value, "saved\n  ");
let release;
invoke = () => new Promise(resolve => { release = resolve; });
const saveButton = button("保存").props.onClick;
const first = saveButton(); const duplicate = saveButton(); await duplicate;
const writes = calls.filter(([method]) => method === "personal_instructions_write");
assert.equal(writes.length, 1);
assert.equal(writes[0][1].contents, "saved\n  ");
assert.equal(writes[0][1].expectedContents, "initial\n");
release({ ...snapshot, contents: "saved\n  " }); await first; render();
assert.equal(editor(), undefined);
assert.ok(nodes(tree).some(node => node.children.includes("Codex 自定义指令已更新")));
console.log("PASS PI04: section changes preserve draft, single write uses exact content and expected disk snapshot; successful readback returns to overview");

invoke = async () => snapshot;
button("编辑 Codex 自定义指令").props.onClick(); await settle(); render(); edit("");
invoke = async () => { throw Error("disk denied"); };
await button("保存").props.onClick(); render();
assert.equal(editor().props.value, "");
assert.ok(nodes(tree).some(node => node.props.role === "alert" && node.children.some(child => String(child).includes("disk denied"))));
let keys = 0;
invoke = async () => { keys++; throw Error("offline"); };
const keydown = nodes(tree).find(node => node.props.onKeyDown)?.props.onKeyDown;
const event = (key, composing = false, keyCode = 0) => ({
  key, ctrlKey: true, metaKey: false, keyCode, nativeEvent: { isComposing: composing }, preventDefault() {},
});
keydown(event("Enter", true)); keydown(event("s", false, 229)); await settle();
assert.equal(keys, 0);
keydown(event("s")); await settle(); render();
assert.equal(keys, 1);
nodes(tree).find(node => node.props.onKeyDown).props.onKeyDown(event("Enter")); await settle(); render();
assert.equal(keys, 2);
console.log("PASS PI05: failed/empty drafts retained, Ctrl+S and Ctrl+Enter save, IME and keyCode 229 never save");

invoke = () => new Promise(resolve => { release = resolve; });
const late = button("保存").props.onClick();
hooks.forEach(hook => hook?.cleanup?.());
const previous = slots.slice(0, 7);
release({ ...snapshot, contents: "" }); await late;
assert.deepEqual(slots.slice(0, 7), previous);
assert.equal(listeners.size, 0);
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes('<PersonalizationSettings active={activeSection === "personalization"} />'));
assert.ok(parent.includes('activeSection !== "personalization" &&'));
assert.ok(!parent.includes("智能体交流语气与人设偏好"));
assert.ok(!source.includes("config_update") && !source.includes("desktop_state_set"));
console.log("PASS PI04 wiring: unmount invalidation, listener cleanup and dedicated file contract replaces old personalization save");
