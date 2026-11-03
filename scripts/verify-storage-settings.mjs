import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const view = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
const native = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const backend = fs.readFileSync("src-tauri/src/config_skills.rs", "utf8");
// The legacy handler could delete conversation files: its public invocation path must disappear too.
assert.ok(!native.includes("storage_clean_cache"), "STG02: legacy destructive Tauri command must be unregistered and removed");
assert.ok(!backend.includes("pub fn clean_storage_cache"), "STG02: rollout-deleting implementation must be removed");
assert.ok(!view.includes('"storage_clean_cache"'));
assert.ok(native.includes("storage_stats_get"), "STG04: other existing local-stat consumers remain supported");
assert.ok(view.includes('activeSection === "storage" && <StorageSettings />'));
assert.ok(!view.includes("setStorageStats") && !view.includes("const formatBytes"), "STG01: entering storage must not load or format local disk usage");
for (const suffix of ['<div className="header-right-btns">', 'saveBanner &&', 'errorBanner &&']) {
  assert.ok(view.includes(`activeSection !== "import" && activeSection !== "storage" && ${suffix}`), "STG03: no generic save/refresh/banner on storage page");
}
const source = fs.readFileSync("src/components/StorageSettings.tsx", "utf8");
const output = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const exports = {};
vm.runInNewContext(output, { exports, require: name => {
  assert.equal(name, "react", "STG01: unavailable cloud page must not load a local or unauthenticated data client");
  return { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
} });
const tree = exports.StorageSettings();
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
const rendered = nodes(tree);
const text = node => typeof node === "string" ? node : node?.children?.map(text).join("") || "";
assert.match(text(tree), /无法加载存储空间使用情况/);
assert.match(text(tree), /云端存储/);
assert.match(text(tree), /尚未连接/);
assert.ok(rendered.some(node => node.props.role === "status"));
assert.ok(!rendered.some(node => ["button", "input", "progress"].includes(node.type) || node.props.role === "progressbar"), "STG01/STG03: no fake retry/save/quota controls");
console.log("PASS STG01-STG04: rendered honest capability state, no local-stat substitution or write controls; destructive native entry and rollout deletion removed");
console.log("NOT TESTED STG05: official authenticated cloud usage, native UI and pixel parity");
