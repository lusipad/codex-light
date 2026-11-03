import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
let slots = [], cursor = 0, effect, tree, invoke;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effect = fn; },
};
const module = { exports: {} }, queued = [], requests = [];
const source = fs.readFileSync("src/components/LocalEnvironmentSettings.tsx", "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText, {
  exports: module.exports, window: { confirm: () => false },
  require: name => name === "react" ? react : { tauriInvoke: (...args) => { requests.push(args); return invoke(...args); } },
});
const snapshot = {
  path: "repo/.codex/environments/environment.toml", fileName: "environment.toml",
  files: ["environment.toml", "other.toml"], exists: true, content: "version = 1",
  expectedContent: "version = 1", schemaError: null,
  environment: { name: "Env", actions: [{ name: "Test", command: "echo test", platform: null }] },
};
const render = () => { cursor = 0; tree = module.exports.LocalEnvironmentSettings({ cwd: "repo", onRunCommand: (...args) => queued.push(args) }); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join(" ") : typeof node === "string" ? node : "";
const button = label => nodes(tree).find(node => node.type === "button" && text(node).replace(/\s+/g, " ").trim() === label);
const editor = () => nodes(tree).find(node => node.type === "textarea");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
invoke = async () => snapshot;
render(); const cleanup = effect(); await flush(); render();
assert.equal(editor().props.value, snapshot.content);
editor().props.onChange({ target: { value: "draft" } }); render();
assert.equal(button("运行 Test").props.disabled, true);
button("运行 Test").props.onClick(); await flush(); assert.equal(queued.length, 0);
const beforeReload = requests.length;
button("重新读取").props.onClick(); await flush();
assert.equal(requests.length, beforeReload, "cancel discard must retain draft");
invoke = async () => { throw Error("external conflict"); };
button("保存环境").props.onClick(); await flush(); render();
assert.equal(editor().props.value, "draft");
assert.match(text(tree), /external conflict/);
const saveRequest = requests.at(-1);
assert.equal(saveRequest[0], "local_environment_save");
assert.equal(saveRequest[1].expectedContent, snapshot.expectedContent);
assert.equal(saveRequest[1].content, "draft");
invoke = async () => ({ ...snapshot, content: "draft", expectedContent: "draft" });
button("保存环境").props.onClick(); await flush(); render();
assert.match(text(tree), /已保存并读回/);
invoke = async () => "echo checked";
button("运行 Test").props.onClick(); await flush(); render();
assert.deepEqual(queued, [["repo", "echo checked"]]);
assert.equal(requests.at(-1)[1].expectedContent, "draft");
let release, count = 0;
invoke = () => { count++; return new Promise(resolve => { release = resolve; }); };
button("运行 Test").props.onClick(); button("运行 Test").props.onClick();
assert.equal(count, 1);
cleanup(); const state = slots.slice(); release("late command"); await flush();
assert.equal(queued.length, 1);
assert.deepEqual(slots, state);
console.log("PASS LE02/LE03: production editor draft/conflict/retry, cancelled discard, checked command identity, single-flight and late-unmount isolation");
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(parent.includes("<LocalEnvironmentSettings key={activeWorkspaceRoot}"));
assert.ok(!parent.includes("setLocalEnvToml"));
assert.ok(parent.includes('activeSection !== "local-environments" &&'));
assert.ok(app.includes('if (cwd !== activeWorkspace?.path) throw Error'));
assert.ok(app.includes('if (pendingTermCommand) throw Error'));
assert.ok(app.includes("setPendingTermCommand({ id: Date.now(), command, cwd });"));
console.log("PASS LE04: workspace-scoped editor and existing real PTY command queue wiring");
