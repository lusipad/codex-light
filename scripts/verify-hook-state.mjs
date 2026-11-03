import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const hook = { id: 'file.path:"hook"', cwd: "workspace", currentHash: "hash-1", raw: { key: 'file.path:"hook"' }, enabled: true, trustStatus: "untrusted" };
const data = hooks => ({ hooks, groups: [], warnings: [], errors: [] });
let listed, snapshot, result, writes;
const module = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/hookState.ts", "utf8")), {
  exports: module.exports, require: name => name === "./hooksClient" ? {
    listHooks: async () => listed.shift(),
  } : {
    configRead: async () => snapshot,
    configBatchWrite: async (...args) => { writes.push(args); return result; },
  },
});
const reset = () => {
  listed = [data([hook]), data([{ ...hook, enabled: false }])];
  snapshot = { layers: [{ name: { type: "user", file: "user/config.toml" }, version: "v1" }] };
  result = { status: "ok" }; writes = [];
};
reset();
await module.exports.writeHookState(["workspace"], [hook], false);
assert.equal(writes[0][0][0].keyPath, `hooks.state.${JSON.stringify(hook.id)}.enabled`);
assert.equal(writes[0][0][0].value, false);
assert.equal(writes[0][1].expectedVersion, "v1");
assert.equal(writes[0][1].filePath, "user/config.toml");
assert.equal(writes[0][1].reloadUserConfig, true);
reset(); listed[1] = data([{ ...hook, trustStatus: "trusted" }]);
await module.exports.writeHookState(["workspace"], [hook, hook], "trust");
assert.equal(writes[0][0].length, 1);
assert.equal(writes[0][0][0].value, hook.currentHash);
assert.ok(writes[0][0][0].keyPath.endsWith(".trusted_hash"));
for (const changed of [{ ...hook, isManaged: true }, { ...hook, currentHash: "hash-2" }, { ...hook, raw: {} }, null]) {
  reset(); listed[0] = data(changed ? [changed] : []);
  await assert.rejects(() => module.exports.writeHookState(["workspace"], [hook], false));
  assert.equal(writes.length, 0);
}
reset(); result.status = "okOverridden";
await assert.rejects(() => module.exports.writeHookState(["workspace"], [hook], false), /覆盖/);
reset(); listed[1] = data([hook]);
await assert.rejects(() => module.exports.writeHookState(["workspace"], [hook], false), /读回不一致/);
reset(); snapshot.layers[0].name.profile = "named";
await assert.rejects(() => module.exports.writeHookState(["workspace"], [hook], false), /用户配置层/);
assert.equal(writes.length, 0);
console.log("PASS HK01/HK02: exact quoted key, hash/managed guards, user-layer version, effective readback and override failure");

let slots = [], cursor = 0, effect, read, write, tree;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effect = fn; },
};
const component = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/components/HooksSettings.tsx", "utf8")), {
  exports: component.exports, require: name => name === "react" ? react : name === "../hooksClient" ? {
    listHooks: () => read(),
  } : { writeHookState: (...args) => write(...args) },
});
const render = () => { cursor = 0; tree = component.exports.HooksSettings({ activeWorkspaceRoot: "workspace" }); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join(" ") : typeof node === "string" ? node : "";
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
read = async () => data([{ ...hook, name: "test", source: "user", event: "preToolUse" }, { ...hook, id: "managed", name: "managed", isManaged: true }]);
render(); const cleanup = effect(); await flush(); render();
const toggle = nodes(tree).find(node => node.props["aria-label"] === "启用 test");
assert.ok(toggle); assert.equal(toggle.props.disabled, false);
assert.equal(nodes(tree).find(node => node.props["aria-label"] === "启用 managed").props.disabled, true);
let release, count = 0;
write = () => { count++; return new Promise(resolve => { release = resolve; }); };
toggle.props.onChange({ target: { checked: false } });
toggle.props.onChange({ target: { checked: false } });
assert.equal(count, 1);
cleanup(); const old = slots.slice(); release(data([])); await flush();
assert.deepEqual(slots, old);
slots = []; read = async () => { throw Error("disconnected"); };
render(); effect(); await flush(); render(); assert.match(text(tree), /disconnected/);
read = async () => data([]); nodes(tree).find(node => node.type === "button").props.onClick(); await flush(); render();
assert.match(text(tree), /没有匹配/); assert.doesNotMatch(text(tree), /disconnected/);
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes("<HooksSettings key={activeWorkspaceRoot}"));
assert.ok(!parent.includes("Hook 执行开关"));
console.log("PASS HK03/HK04: production single-flight, managed disable, unmount isolation, error retry and real settings wiring");
