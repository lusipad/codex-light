import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const source = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
for (const key of ["cloudDiffMode", "cloudBranchFormat", "cloudAutoSync", "cloudDefaultEnv"]) {
  assert.ok(!source.includes(key), `CP01 local ${key} cannot substitute cloud preference`);
}
assert.ok(source.includes('activeSection === "cloud-settings" && <CloudPreferencesSettings />'));
assert.ok(source.includes('activeSection !== "cloud-settings" &&'));
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/CloudPreferencesSettings.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, { exports, require: name => {
  assert.equal(name, "react");
  return { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
} });
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const tree = exports.CloudPreferencesSettings();
assert.match(JSON.stringify(tree), /尚未连接云端偏好服务/);
assert.ok(nodes(tree).some(node => node.props.role === "status"));
assert.ok(!nodes(tree).some(node => ["input", "select", "button"].includes(node.type)));
console.log("PASS CP01-CP03: actual capability JSX, no fake local cloud writes, templates or save controls; authenticated cloud operations not tested");
