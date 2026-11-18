import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let invoke;
const config = {};
vm.runInNewContext(compile("src/config.ts"), {
  exports: config, require: () => ({ callAppServer: (...args) => invoke(...args) }),
});
invoke = async () => ({ data: [], nextCursor: "repeat" });
await assert.rejects(config.experimentalFeatureListAll(1, 3), /游标/);
invoke = async () => ({ data: null });
await assert.rejects(config.experimentalFeatureListAll(), /格式/);
let page = 0;
invoke = async () => ({ data: [], nextCursor: String(++page) });
await assert.rejects(config.experimentalFeatureListAll(1, 2), /页数/);
console.log("PASS EF04: malformed, repeated and truncated pages cannot appear complete");

const beta = { name: "sample", stage: "beta", enabled: false, defaultEnabled: false };
let features = [beta], writes = [], stored = false, effective = false, readFailure = false;
const client = {
  experimentalFeatureListAll: async () => features,
  configRead: async () => {
    if (readFailure) throw Error("read unavailable");
    return { config: { features: { sample: effective } },
      layers: [{ name: { type: "user" }, config: { features: { sample: stored } } }] };
  },
  configBatchWrite: async (edits, options) => { writes.push([edits, options]); stored = edits[0].value; return { status: "ok" }; },
  getConfigValue: (obj, path) => path.split(".").reduce((value, key) => value?.[key], obj),
};
const production = {};
vm.runInNewContext(compile("src/experimentalFeatures.ts"), { exports: production, require: () => client });
const officialSource = fs.readFileSync(".ref/parity/16.20/reference/experimental-feature-visibility-62b50dc0f510.js", "utf8");
const officialPredicate = vm.runInNewContext(`(${officialSource.match(/function i\(e\)\{return[^}]+\}/)[0]})`);
for (const name of ["sample", "memories", "multi_agent", "plugins", "plugin", "remote_control", "realtime_audio", "chronicle", "workspace_dependencies"]) {
  for (const stage of ["beta", "stable", "underDevelopment", "removed"]) {
    const feature = { ...beta, name, stage };
    assert.equal(production.isVisibleBetaFeature(feature), officialPredicate(feature));
  }
}
for (const name of ["memories", "multi_agent", "plugins", "plugin", "remote_control", "realtime_audio", "chronicle", "workspace_dependencies", "default_mode_request_user_input"]) {
  assert.equal(production.isVisibleBetaFeature({ ...beta, name }), false);
}
assert.equal(production.isVisibleBetaFeature(beta), true);
assert.equal(production.isVisibleBetaFeature({ ...beta, stage: "stable" }), false);
await assert.rejects(production.saveBetaFeature("missing", true), /不可用/);
assert.equal(writes.length, 0);
const result = await production.saveBetaFeature("sample", true);
assert.equal(result.overridden, true);
assert.equal(writes[0][0][0].keyPath, "features.sample");
assert.equal(writes[0][0][0].mergeStrategy, "upsert");
assert.equal(writes[0][1].reloadUserConfig, false);
assert.equal(writes[0][1].filePath, null);
assert.equal((await production.loadBetaFeatures())[0].enabled, false);
readFailure = true;
await assert.rejects(production.saveBetaFeature("sample", false), /读回/);
features = [{ ...beta, stage: "removed" }];
await assert.rejects(production.saveBetaFeature("sample", true), /不可用/);
assert.equal(writes.length, 2);
console.log("PASS EF01-EF02: beta exclusions, fresh eligibility, persistent upsert, effective override and failed readback");

let slots = [], cursor = 0, effects = [], tree, release, saves = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => effects.push(fn),
};
let save = async () => { saves++; return new Promise(resolve => { release = resolve; }); };
const component = {};
const componentCode = ts.transpileModule(fs.readFileSync("src/components/ExperimentalFeatures.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
vm.runInNewContext(componentCode, { exports: component, require: name => name === "react" ? react : {
  loadBetaFeatures: async () => [beta], saveBetaFeature: (...args) => save(...args),
} });
const render = connected => { cursor = 0; effects = []; tree = component.ExperimentalFeatures({ connected }); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const checkbox = () => nodes(tree).find(node => node.type === "input");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
render(true); let cleanup = effects[0](); await flush(); render(true);
assert.equal(checkbox().props.disabled, false);
const first = checkbox().props.onChange();
await checkbox().props.onChange();
assert.equal(saves, 1, "synchronous lock prevents double submit before rerender");
render(true); assert.equal(checkbox().props.disabled, true);
release({ enabled: true, overridden: false }); await first; render(true);
assert.equal(checkbox().props.checked, true);
assert.match(JSON.stringify(tree), /重启 Codex Light/);
save = async () => { throw Error("readback unavailable"); };
await checkbox().props.onChange(); render(true);
assert.equal(checkbox().props.disabled, true);
assert.equal(checkbox().props.checked, true, "failed readback does not claim requested value");
await nodes(tree).find(node => node.type === "button").props.onClick(); render(true);
assert.equal(checkbox().props.disabled, false);
save = async () => new Promise(resolve => { release = resolve; });
const late = checkbox().props.onChange(); cleanup(); const before = slots.slice();
release({ enabled: true, overridden: false }); await late;
assert.deepEqual(slots, before, "unmounted view cannot receive late mutation updates");
slots = []; render(false); cleanup = effects[0](); await flush(); render(false);
assert.equal(checkbox(), undefined);
assert.equal(nodes(tree).find(node => node.type === "button").props.disabled, true);
cleanup();
const view = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(view.includes('initialSection === "experimental" ? "general-settings"'));
assert.ok(!view.includes('slug: "experimental"') && !view.includes("experimentalFeatureSetEnablement"));
assert.ok(view.includes("<ExperimentalFeatures connected={appServerStatus.connected} />"));
console.log("PASS EF03/EF05: actual JSX callbacks, single-flight, restart, readback lock, reload, unmount and disconnected state; general-settings wiring");
