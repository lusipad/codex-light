import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], index = 0, effect, read, notify, releaseSubscription, stopped = 0;
let tree;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => {
    const position = index++;
    if (!(position in slots)) slots[position] = initial;
    return [slots[position], value => { slots[position] = value; }];
  },
  useRef: initial => {
    const position = index++;
    if (!(position in slots)) slots[position] = { current: initial };
    return slots[position];
  },
  useEffect: callback => { effect = callback; },
};
const mod = { exports: {} };
const source = fs.readFileSync("src/components/ProfileSettings.tsx", "utf8");
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, {
  exports: mod.exports, require: name => name === "react" ? react : name === "../config" ? {
    accountRead: () => read(),
  } : {
    tauriListen: (_event, callback) => { notify = callback; return new Promise(resolve => { releaseSubscription = resolve; }); },
  },
});
const render = () => { index = 0; tree = mod.exports.ProfileSettings(); };
function nodes(node) { return node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : []; }
const text = node => node && typeof node === "object" ? node.children.map(text).join(" ") : typeof node === "string" ? node : "";
const refresh = () => nodes(tree).find(node => node.type === "button").props.onClick();
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
read = async () => ({ account: { type: "chatgpt", email: "real@example.invalid", planType: "pro" }, requiresOpenaiAuth: true });
render(); const cleanup = effect(); await settle(); render();
assert.match(text(tree), /real@example.invalid/); assert.match(text(tree), /pro/);
assert.match(text(tree), /尚未接入账号服务/);
assert.equal(nodes(tree).filter(node => ["input", "textarea", "select"].includes(node.type)).length, 0);
for (const [account, expected] of [[null, "未登录"], [{ type: "apiKey" }, "API Key"], [{ type: "amazonBedrock" }, "Amazon Bedrock"]]) {
  read = async () => ({ account, requiresOpenaiAuth: false });
  await refresh(); render(); assert.ok(text(tree).includes(expected)); assert.ok(!text(tree).includes("real@example.invalid"));
}
console.log("PASS PF01/PF04: production JSX uses real account variants, no editable simulated identity or profile write");

let oldResolve, newResolve;
read = () => new Promise(resolve => { oldResolve = resolve; });
const old = refresh();
read = () => new Promise(resolve => { newResolve = resolve; });
const newer = refresh();
newResolve({ account: { type: "apiKey" } }); await newer;
oldResolve({ account: { type: "chatgpt", email: "old@example.invalid" } }); await old;
render(); assert.match(text(tree), /API Key/); assert.ok(!text(tree).includes("old@example.invalid"));
read = async () => { throw Error("offline"); };
await refresh(); render(); assert.match(text(tree), /offline/); assert.ok(!text(tree).includes("API Key"));
read = () => new Promise(resolve => { newResolve = resolve; });
notify({ method: "account/updated" }); render(); assert.match(text(tree), /正在读取/);
cleanup(); const state = slots.slice(0, 3);
releaseSubscription(() => { stopped++; }); await settle(); assert.equal(stopped, 1);
newResolve({ account: { type: "chatgpt", email: "late@example.invalid" } }); await settle();
assert.deepEqual(slots.slice(0, 3), state);
console.log("PASS PF02/PF03: stale identity rejection, failure clears old data, notification reload and late subscription/unmount cleanup");
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes('activeSection === "profile" && <ProfileSettings />'));
assert.ok(parent.includes('activeSection !== "profile" &&'));
assert.ok(!parent.includes("开发者个人资料 (Profile)"));
console.log("PASS PF04: old local profile editor and common save entry removed without deleting stored preferences");
