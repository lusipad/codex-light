import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const hook = { id: 'file.path:"hook"', cwd: "workspace", currentHash: "hash-1", raw: { key: 'file.path:"hook"' }, enabled: true, trustStatus: "trusted" };
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

const { verifyHooksUI } = await import("./verify-hooks-settings-b-ui.mjs");
await verifyHooksUI();
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes("<HooksSettings"));
assert.ok(parent.includes("connectionIdentity="));
assert.ok(!parent.includes("Hook 执行开关"));
console.log("PASS HK03/HK04: production source-review UI regression and real settings wiring");
