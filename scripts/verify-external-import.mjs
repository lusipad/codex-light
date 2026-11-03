import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
let slots = [], cursor = 0, effects = [], invoke, readMetadata, readBytes, timer, state;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => { effects.push(fn); },
};
const listeners = new Map(), requests = [];
const exports = {};
vm.runInNewContext(compile(fs.readFileSync("src/externalImport.ts", "utf8")), {
  exports, setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
  require: name => name === "react" ? react : name === "./fsClient" ? {
    getMetadata: (...args) => readMetadata(...args), readFileBytes: (...args) => readBytes(...args),
  } : {
    callAppServer: (...args) => { requests.push(args); return invoke(...args); },
    tauriListen: async (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); },
  },
});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const item = { itemType: "AGENTS_MD", description: "Instructions", cwd: "repo", details: null };
const completion = (id = "job") => ({ importId: id, itemTypeResults: [{ itemType: "AGENTS_MD",
  successes: [{ itemType: "AGENTS_MD", source: "repo/CLAUDE.md", target: "repo/AGENTS.md" }], failures: [] }] });
const emit = (method, params) => listeners.get("app-server:notification")?.({ method, params });
invoke = async () => ({ items: [item] });
await exports.detectImportProvider("cursor", "repo", false);
assert.equal(requests.at(-1)[1].migrationSource, "cursor");
assert.equal(requests.at(-1)[1].includeHome, false);
await exports.detectImportProvider("claude-code", "repo", true);
assert.equal("migrationSource" in requests.at(-1)[1], false);
invoke = async () => ({ items: null });
await assert.rejects(exports.detectImportProvider("cursor", "", true), /格式/);
console.log("PASS IM01: production provider migrationSource mapping and malformed detection rejection");

readMetadata = async () => ({ isFile: true }); readBytes = async () => new Uint8Array([1, 2, 3]);
invoke = async (method, params) => {
  assert.equal(method, "externalAgentConfig/import");
  assert.ok(listeners.has("app-server:notification"), "subscribe before request");
  assert.equal(params.source, "app");
  emit("externalAgentConfig/import/completed", completion("unrelated"));
  emit("externalAgentConfig/import/completed", completion());
  return { importId: "job" };
};
let report = await exports.executeExternalImport("claude-code", [item], () => {});
assert.match(report.successes[0].readback, /3 字节/);
assert.equal(report.importId, "job");
assert.equal(listeners.size, 0);
assert.ok(timer == null);
invoke = async () => {
  const partial = completion();
  partial.itemTypeResults[0].failures.push({ itemType: "AGENTS_MD", source: "repo/other.md", message: "permission denied" });
  emit("externalAgentConfig/import/completed", partial);
  return { importId: "job" };
};
report = await exports.executeExternalImport("claude-code", [item], () => {});
assert.equal(report.successes.length, 1);
assert.equal(report.failures.length, 1);
assert.equal(report.failures[0].message, "permission denied");
let counts = [], settled = false;
invoke = async () => ({ importId: "job" });
const running = exports.executeExternalImport("cursor", [item], count => counts.push(count)).then(value => { settled = true; return value; });
await flush(); assert.equal(settled, false, "accepted import ID is not completion");
emit("externalAgentConfig/import/progress", completion("other"));
assert.equal(counts.length, 0);
emit("externalAgentConfig/import/progress", completion());
assert.equal(counts.at(-1), 1);
readBytes = async () => { throw Error("readback denied"); };
emit("externalAgentConfig/import/completed", completion());
emit("externalAgentConfig/import/completed", completion());
report = await running;
assert.match(report.successes[0].readback, /读回失败/);
assert.equal(listeners.size, 0);
const disconnected = exports.executeExternalImport("cursor", [item], () => {});
const rejectsDisconnected = assert.rejects(disconnected, /连接中断/);
await flush(); listeners.get("app-server:status")({ connected: false }); await rejectsDisconnected;
assert.equal(listeners.size, 0);
const timeout = exports.executeExternalImport("cursor", [item], () => {});
const rejectsTimeout = assert.rejects(timeout, /超时/);
await flush(); timer(); await rejectsTimeout;
assert.equal(listeners.size, 0);
console.log("PASS IM04/IM05/IM06: early/duplicate/unrelated notifications, accepted != completed, readback failure, disconnect/timeout and listener release");

let changed = false, writes = 0, refreshed = 0;
invoke = async method => {
  if (method === "externalAgentConfig/detect") return { items: [changed ? { ...item, description: "changed" } : item] };
  writes++;
  emit("externalAgentConfig/import/completed", completion());
  return { importId: "job" };
};
const render = () => { cursor = 0; effects = []; state = exports.useExternalImports(async () => { refreshed++; }); };
render(); const cleanup = effects[0]();
await state.detect("repo", false); render();
state.setSelected([exports.importChoiceId(state.choices[0])]); render();
changed = true;
await state.start(); render();
assert.equal(writes, 0);
assert.match(state.error, /来源已变化/);
await state.detect("repo", false); render();
state.setSelected([exports.importChoiceId(state.choices[0])]); render();
const first = state.start(); await state.start(); await first; render();
assert.equal(writes, 1); assert.equal(refreshed, 1);
assert.equal(state.reports.length, 1);
assert.equal(state.selected.length, 0);
assert.equal(state.phase, "finished");
assert.equal(state.reports[0].successes[0].readback.includes("失败"), true);
state.setSelected([exports.importChoiceId(state.choices[0])]); render();
invoke = async method => {
  if (method === "externalAgentConfig/detect") return { items: [{ ...item, description: "changed" }] };
  throw Error("connection lost after submit");
};
const staleStart = state.start;
await state.start();
const before = requests.length;
await staleStart();
assert.equal(requests.length, before, "unknown result must synchronously block stale callbacks before React rerenders");
render(); assert.equal(state.uncertain, true);
await state.start(); assert.equal(requests.length, before, "unknown result must block duplicate import");
cleanup();
console.log("PASS IM03/IM06: source revalidation, synchronous single-flight, App-owned reports/refresh and uncertain-result retry guard");

slots = []; cursor = 0; effects = [];
const component = {};
vm.runInNewContext(compile(fs.readFileSync("src/components/ImportSettings.tsx", "utf8")), {
  exports: component, window: { confirm: () => false },
  require: name => name === "react" ? react : { importChoiceId: exports.importChoiceId },
});
let startCount = 0, selection;
const tree = component.ImportSettings({ cwd: "repo", state: {
  ...state, phase: "choosing", uncertain: false, choices: [{ provider: "cursor", item }], selected: ["selected"],
  start: () => { startCount++; }, setSelected: value => { selection = value; },
} });
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join(" ") : typeof node === "string" ? node : "";
nodes(tree).find(node => node.type === "button" && text(node).startsWith("导入所选")).props.onClick();
assert.equal(startCount, 0);
nodes(tree).find(node => node.type === "button" && text(node) === "取消选择").props.onClick();
assert.equal(selection.length, 0);
const app = fs.readFileSync("src/App.tsx", "utf8"), parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(app.includes("const externalImportsState = useExternalImports("));
assert.ok(parent.includes("<ImportSettings state={externalImportsState} cwd={activeWorkspaceRoot} />"));
assert.ok(!parent.includes('[Cursor Rules (${res.path})]'));
assert.ok(!parent.includes('value: { customPersonaPrompt: merged }'));
console.log("PASS IM02/IM07 UI: cancelled confirmation/selection never writes; real shared pipeline replaces destructive legacy preference overwrite");
