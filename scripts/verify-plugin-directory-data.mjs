import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginDirectory.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { parsePluginDirectorySections: parse, remotePluginDirectoryEnabled: gate, directoryPluginInstallation: installation } = exports;
const listing = { id: "remote-id", display_name: "Readable", short_description: "Flat row", keywords: ["tool"] };
const sections = parse([{ id: "featured", title: "Featured", plugins: [listing] },
  { id: "featured", title: "Featured", url_slug: null, plugins: [{ ...listing, id: "second" }] }]);
assert.equal(sections.length, 1); assert.equal(sections[0].plugins.length, 2);
assert.equal(sections[0].plugins[0].displayName, "Readable");
assert.equal(sections[0].plugins[0].installationPolicy, undefined, "missing policy must not become AVAILABLE");
assert.equal("name" in sections[0].plugins[0], false, "home does not invent a protocol plugin name");
assert.equal("installed" in sections[0].plugins[0], false, "installed status comes from actual inventory");
assert.equal(parse([{ url_slug: "tools", title: null, plugins: [] }])[0].slug, "tools");
assert.equal(parse([{ id: "x", plugins: [{ ...listing, installation_policy: "FUTURE_POLICY" }] }])[0].plugins[0].installationPolicy, "FUTURE_POLICY");
for (const value of [null, {}, [{ plugins: [] }], [{ id: "x", plugins: {} }],
  [{ id: "x", plugins: [{ ...listing, id: "" }] }], [{ id: "x", plugins: [{ ...listing, keywords: [1] }] }],
  [{ id: "x", plugins: [{ ...listing, requires_local_executor: "yes" }] }]]) assert.throws(() => parse(value));
assert.equal(gate(null, true), undefined);
assert.equal(gate([], undefined), undefined);
assert.equal(gate([], false), false);
assert.equal(gate([{ name: "remote_plugin", enabled: false }], true), false);
assert.equal(gate([{ name: "remote_plugin", enabled: true }], false), true);
assert.equal(installation("remote-id", null).installed, undefined);
assert.equal(installation("remote-id", { marketplaces: [] }).installed, false);
const plugin = { id: "local@market", remotePluginId: "remote-id", installed: true };
assert.equal(installation("remote-id", { marketplaces: [{ plugins: [plugin] }] }).plugin, plugin);
const shared = { id: "other", shareContext: { remotePluginId: "shared-id" }, installed: true };
assert.equal(installation("shared-id", { marketplaces: [{ plugins: [shared] }] }).installed, true);
console.log("PASS remote directory flat home parsing, section merge, unknown policy/gate and three-state installed identity");
