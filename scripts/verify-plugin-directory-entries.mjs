import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginDirectoryEntries.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { parsePluginDirectoryEntries: parse, parsePluginDirectoryEntriesPage: page, mergePluginDirectoryEntries: merge } = exports;
const row = (id, extra = {}) => ({ id, name: "same-name", scope: "WORKSPACE", release: {
  display_name: `Display ${id}`, description: "Release description", requires_local_executor: true,
  keywords: ["wrong"], interface: { short_description: "", capabilities: ["real"], logo_url: "https://example.com/logo" },
}, ...extra });
const entries = parse([row("one", { installation_policy: "FUTURE", teams: [{ id: "team-id", name: "Real team" }] }), row("two")], "workspace");
assert.equal(entries[0].listing.description, "", "nullish fallback must preserve an explicit empty short description");
assert.equal(entries[0].listing.keywords.join(), "real");
assert.equal(entries[0].listing.installationPolicy, "FUTURE");
assert.equal(entries[1].listing.installationPolicy, undefined, "missing policy cannot grant installation");
assert.equal(entries[0].teams[0].id, "team-id");
assert.equal(entries[1].teams.length, 0);
assert.equal(entries[0].listing.requiresLocalExecutor, true);
for (const entry of entries) for (const key of ["installed", "enabled", "remoteServicePlugin", "marketplaceName", "pluginId"]) {
  assert.equal(key in entry, false); assert.equal(key in entry.listing, false);
}
const created = parse([row("one"), row("three")], "workspace-created");
const combined = merge([entries, created]);
assert.equal(combined.length, 3, "same names cannot erase different raw identities");
assert.equal(combined[0].sources.join(), "workspace,workspace-created");
assert.equal(entries[0].sources.join(), "workspace", "merging must not modify cached input pages");
assert.equal(combined[0].source, "workspace", "first source and metadata remain deterministic");
const template = parse([row("template-id", { is_template: true }), row("different-template", { is_template: true })], "workspace");
const instance = parse([row("instance", { template_plugin_id: "template-id" })], "workspace");
for (const pages of [[template, instance], [instance, template]]) {
  const visible = merge(pages, { hideReferencedTemplates: true });
  assert.equal(visible.some(entry => entry.rawId === "template-id"), false);
  assert.equal(visible.some(entry => entry.rawId === "different-template"), true);
  assert.equal(visible.some(entry => entry.rawId === "instance"), true);
}
assert.equal(merge([template, instance]).length, 3, "template filtering is Workspace-specific, not a universal side effect");
assert.equal(page({ plugins: [row("one")], pagination: { next_page_token: "cursor" } }, "user").nextPageToken, "cursor");
assert.equal(page({ plugins: [], pagination: {} }, "user").nextPageToken, null);
for (const value of [null, {}, { error: "denied" }, { plugins: [], pagination: null },
  { plugins: [], pagination: { next_page_token: 3 } }, { plugins: {}, pagination: {} }]) assert.throws(() => page(value, "user"));
for (const value of [null, {}, [{ id: "flat", display_name: "Flat" }], [row("one", { release: null })],
  [row("one", { release: { display_name: "Name", interface: null } })], [row("", {})],
  [row("one", { teams: [{}] })], [row("one", { teams: [{ id: "team", name: 4 }] })],
  [row("one", { installation_policy: true })], [row("one", { template_plugin_id: false })],
  [row("one", { release: { display_name: "Name", interface: { capabilities: [4] } } })]]) assert.throws(() => parse(value, "workspace"));
assert.equal(parse([row("nullable", { release: { display_name: "Name", interface: {}, description: null } })], "user")[0].listing.description, null);
console.log("PASS full-release directory metadata, real source identity, policy uncertainty, cross-page templates and strict page failures");
