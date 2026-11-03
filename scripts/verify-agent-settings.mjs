import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/AgentSettings.tsx", "utf8");
const transpile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
let read, write, requirements;
const calls = [];
const config = {
  configRead: (...args) => { calls.push(["read", ...args]); return read(...args); },
  configBatchWrite: (...args) => { calls.push(["write", ...args]); return write(...args); },
  configRequirementsRead: () => requirements(),
  getConfigValue: (raw, key) => raw?.[key],
};
const mod = { exports: {} };
let slots = [], index = 0, effects = [], cleanups = [];
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => {
    const position = index++;
    if (!(position in slots)) slots[position] = initial;
    return [slots[position], value => { slots[position] = typeof value === "function" ? value(slots[position]) : value; }];
  },
  useRef: initial => {
    const position = index++;
    if (!(position in slots)) slots[position] = { current: initial };
    return slots[position];
  },
  useEffect: callback => { if (mounting) effects.push(callback); },
};
vm.runInNewContext(transpile(source), {
  exports: mod.exports,
  require: name => name === "react" ? react : name === "../config" ? config : {
    findModel: (models, name) => models.find(model => model.model === name),
    getSupportedEfforts: model => model?.supportedReasoningEfforts || [],
  },
});
const { userConfigLayer, agentConfigEdits, saveAgentConfig, AgentSettings } = mod.exports;
const snapshot = (values = {}, effective = values) => ({
  config: effective, origins: {},
  layers: [{ name: { type: "user", file: "C:/isolated/config.toml" }, version: "v1", config: values }],
});
const base = snapshot({ model: "wire", approval_policy: { granular: { sandbox_approval: false } } }, { model: "managed", sandbox_mode: "read-only" });
const draft = { model: "wire", model_reasoning_effort: "", model_verbosity: "", web_search: "", approval_policy: "", approvals_reviewer: "", sandbox_mode: "" };
assert.equal(agentConfigEdits(base, draft).length, 0);
const edited = { ...draft, model: "" };
assert.equal(agentConfigEdits(base, edited).length, 1);
assert.equal(agentConfigEdits(base, edited)[0].value, null);
for (const field of ["disabledReason", "profile"]) {
  const invalid = snapshot();
  if (field === "profile") invalid.layers[0].name.profile = "work";
  else invalid.layers[0].disabledReason = "managed";
  assert.throws(() => userConfigLayer(invalid), /用户配置层/);
}
console.log("PASS AS01/AS02: global user layer only, profile/disabled refusal, effective defaults never copied and granular policy preserved");

let persisted = snapshot({ model: "next" });
write = async () => ({ status: "ok", version: "v2" }); read = async () => persisted;
let result = await saveAgentConfig(base, { ...draft, model: "next" });
assert.match(result.message, /读回核验/);
const sent = calls.find(call => call[0] === "write");
assert.equal(sent[1].length, 1);
assert.equal(sent[2].filePath, "C:/isolated/config.toml");
assert.equal(sent[2].expectedVersion, "v1");
assert.equal(sent[2].reloadUserConfig, true);
persisted = snapshot({ model: "next" }, { model: "managed" });
assert.match((await saveAgentConfig(base, { ...draft, model: "next" })).message, /覆盖/);
write = async () => ({ status: "okOverridden", overriddenMetadata: { message: "policy" } });
assert.match((await saveAgentConfig(base, { ...draft, model: "next" })).message, /policy/);
read = async () => { throw Error("offline read"); };
await assert.rejects(() => saveAgentConfig(base, { ...draft, model: "next" }), /写入已返回成功.*草稿已保留/);
write = async () => { throw Error("version conflict"); };
await assert.rejects(() => saveAgentConfig(base, { ...draft, model: "next" }), /version conflict/);
console.log("PASS AS03: versioned minimal write, readback failure, managed override and conflict propagation");

let mounting = true, tree;
const props = {
  models: [{ id: "ui", model: "wire", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }],
  onConfigUpdated: async () => {},
};
function render() { index = 0; tree = AgentSettings(props); mounting = false; return tree; }
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...node.children.flatMap(child => nodes(child))];
}
function button(text) { return nodes(tree).find(node => node.type === "button" && node.children.includes(text)); }
function field(id) { return nodes(tree).find(node => node.props.id === `agent-${id}`); }
const settle = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };
read = async () => snapshot({ model: "wire" });
requirements = async () => ({ requirements: { allowedSandboxModes: ["read-only"] } });
render(); cleanups = effects.map(effect => effect()); await settle(); render();
field("model_verbosity").props.onChange({ target: { value: "low" } }); render();
let release;
write = () => new Promise(resolve => { release = resolve; });
const start = calls.length;
const saving = button("保存更改").props.onClick();
const duplicate = button("保存更改").props.onClick();
await duplicate;
assert.equal(calls.slice(start).filter(call => call[0] === "write").length, 1);
release({ status: "ok" }); await saving; render();
// Server readback did not retain low: failure must preserve the edited value.
assert.equal(field("model_verbosity").props.value, "low");
assert.ok(nodes(tree).some(node => node.props.role === "alert"));
const effortOptions = nodes(field("model_reasoning_effort")).filter(node => node.type === "option").map(node => node.props.value);
assert.deepEqual(effortOptions, ["", "high"]);
assert.equal(field("sandbox_mode").props.value, "");
const late = button("保存更改").props.onClick();
cleanups.forEach(cleanup => cleanup?.());
const beforeLate = slots.slice(0, 7);
release({ status: "ok" }); await late;
assert.deepEqual(slots.slice(0, 7), beforeLate);
console.log("PASS AS04-AS06: production JSX callbacks single-flight, draft retention, model-derived efforts and unmount invalidation");

const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes('<AgentSettings models={models} onConfigUpdated={onConfigUpdated} />'));
assert.ok(parent.includes('activeSection !== "agent" && activeSection !== "personalization" && activeSection !== "account" && activeSection !== "profile" && activeSection !== "plugins-settings" && activeSection !== "hooks-settings" && activeSection !== "git-settings" && activeSection !== "local-environments" && activeSection !== "worktrees" && activeSection !== "code-review" && activeSection !== "import" && activeSection !== "storage" && <div className="header-right-btns">'));
assert.ok(!parent.includes("真实可写预设"));
console.log("PASS AS UI wiring: dedicated agent actions replace generic save and unsupported presets");
