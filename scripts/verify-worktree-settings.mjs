import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

let slots = [], cursor = 0, effect, tree, invoke;
const requests = [];
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effect = fn; },
};
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/WorktreeSettings.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, {
  exports: module.exports,
  require: name => name === "react" ? react : { tauriInvoke: (...args) => { requests.push(args); return invoke(...args); } },
});
const render = () => { cursor = 0; tree = module.exports.WorktreeSettings(); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join(" ") : typeof node === "string" ? node : "";
const input = () => nodes(tree).find(node => node.type === "input");
const save = () => nodes(tree).find(node => node.type === "button");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let stored = null;
invoke = async (command, args) => {
  assert.equal(args.key, "git-worktree-root");
  if (command === "desktop_state_set") stored = args.value;
  else return stored;
};
render(); const cleanup = effect(); await flush(); render();
assert.equal(input().props.value, "");
assert.equal(save().props.disabled, true);
input().props.onChange({ target: { value: "  D:/isolated/trees  " } }); render();
save().props.onClick(); await flush(); render();
assert.equal(stored, "D:/isolated/trees");
assert.equal(input().props.value, stored);
assert.match(text(tree), /已保存/);
input().props.onChange({ target: { value: "relative" } }); render();
invoke = async () => { throw Error("absolute path required"); };
save().props.onClick(); await flush(); render();
assert.equal(input().props.value, "relative");
assert.match(text(tree), /absolute path required/);
invoke = async command => command === "desktop_state_get" ? "different" : undefined;
save().props.onClick(); await flush(); render();
assert.equal(input().props.value, "relative");
assert.match(text(tree), /读回不一致/);
let release, calls = 0;
invoke = () => { calls++; return new Promise(resolve => { release = resolve; }); };
save().props.onClick(); save().props.onClick();
assert.equal(calls, 1, "duplicate clicks must not write twice");
cleanup(); const before = slots.slice(); release(); await flush();
assert.deepEqual(slots, before, "late response must not update unmounted settings");
console.log("PASS WT06: real settings component trim/readback, failure draft retention, duplicate writes and late response isolation");
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes('<WorktreeSettings />'));
assert.ok(!parent.includes("闲置工作树自动清理保留天数"));
assert.ok(!parent.includes("自动共享 node_modules"));
assert.ok(parent.includes("worktreeRetentionDays,"), "preserve historical preference data");
console.log("PASS WT UI wiring: dedicated root editor replaces unsupported policy controls while retaining historical data");
