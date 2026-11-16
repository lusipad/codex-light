import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginManagementLocation.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports, URL, URLSearchParams });
const { parsePluginManagementLocation: parse, pluginManagementDetailUrl: detail, pluginManagementRootUrl: root } = module.exports;
const base = "/settings/plugins-settings?hostId=stale&tab=mcps&marketplacePath=old&unrelated=discard#old";
assert.equal(parse(base).kind, "root");
assert.equal(parse(base).hostId, "stale");
assert.equal(parse(base).requestedTab, "mcps");
assert.equal(parse("/settings/plugins-settings?tab=apps").requestedTab, null);
assert.equal(root(base), "/settings/plugins-settings?hostId=stale");
assert.equal(root(base, { hostId: "ssh/current" }), "/settings/plugins-settings?hostId=ssh%2Fcurrent");
assert.equal(root(base, { hostId: null }), "/settings/plugins-settings");

for (const id of ["same@a", "same@b", "中文 插件", "literal%2F%", "owner/plugin", "a?b#c"]) {
  const href = detail(base, { pluginId: id, hostId: "ssh/中文", sourceType: "local", pluginName: "real read%", marketplacePath: "D:\\市场&目录" });
  const result = parse(href);
  assert.equal(result.kind, "plugin");
  assert.equal(result.section, "detail");
  assert.equal(result.pluginId, id);
  assert.equal(result.hostId, "ssh/中文");
  assert.equal(result.pluginName, "real read%");
  assert.equal(result.marketplacePath, "D:\\市场&目录");
  assert.equal(result.remoteMarketplaceName, null);
  assert.equal(href.includes("unrelated"), false);
  assert.equal(href.includes("#old"), false);
  assert.equal(href.includes("tab="), false);
}
for (const hostId of ["local", "durable"]) {
  const href = detail(base, { pluginId: "cli@market", remotePluginId: "raw/remote%id", sourceType: "remote", hostId,
    pluginName: "read-only", remoteMarketplaceName: "workspace" });
  assert.equal(href, "/settings/plugins-settings/raw%2Fremote%25id", "raw remote ID only: no source or host query on official direct branch");
  assert.equal(parse(href).pluginId, "raw/remote%id");
}
assert.equal(parse(detail(base, { pluginId: "cli@market", sourceType: "remote", remotePluginId: "raw-id", hostId: "ssh-one", remoteMarketplaceName: "actual remote", pluginName: "actual-read" })).pluginId, "cli@market");
assert.equal(parse(detail(base, { pluginId: "cli@market", sourceType: "remote", hostId: "local", remoteMarketplaceName: "actual remote", pluginName: "actual-read" })).remoteMarketplaceName, "actual remote", "missing remote ID falls back to source-qualified host route");

for (const [suffix, kind, section, appId, skillName] of [
  ["permissions", "permissions", "permissions", null, null], ["apps/app%2Fid", "app", "detail", "app/id", null],
  ["plugin", "plugin", "detail", null, null], ["plugin/permissions", "plugin", "permissions", null, null],
  ["plugin/sync", "plugin", "sync", null, null], ["plugin/skills/中文", "plugin", "detail", null, "中文"],
  ["plugin/apps/app", "plugin", "detail", "app", null], ["plugin/apps/app/permissions", "plugin", "permissions", "app", null],
  ["plugin/apps/app/sync", "plugin", "sync", "app", null],
]) {
  const result = parse(`/settings/plugins-settings/${suffix}?hostId=durable`);
  assert.equal(result.kind, kind); assert.equal(result.section, section);
  assert.equal(result.appId, appId); assert.equal(result.skillName, skillName);
}
assert.equal(parse("/settings/plugins-settings/hosts/local/plugins/a?hostId=wrong").hostId, "local", "host route wins over stale query");
for (const input of ["", "settings/plugins-settings", "//evil/settings/plugins-settings", "/settings/plugins-settings/", "/settings/plugins-settings//x",
  "/settings/plugins-settings/a/../b", "/settings/plugins-settings/%2e%2e", "/settings/plugins-settings/a/%2e%2e/b",
  "/settings/plugins-settings/a\\b", "/settings/plugins-settings/%00", "/settings/plugins-settings/%", "/settings/plugins-settings/%E4",
  "/settings/plugins-settings?hostId=%E4", "/settings/plugins-settings/hosts//plugins/a", "/settings/plugins-settings/hosts/h/plugins/a/sync",
  "/settings/plugins-settings/apps/a/sync", "/settings/plugins-settings/a/unknown", "/settings/plugins-settings/a/skills/", "/other"]) {
  assert.equal(parse(input), null, `reject malformed or unproven route: ${input}`);
}
assert.equal(parse(new URL("tauri://localhost/settings/plugins-settings/plugin")).pluginId, "plugin");
for (const pluginId of ["", " ", ".", "..", "\0"]) assert.throws(() => detail(base, { pluginId, sourceType: "local", hostId: "local" }), /Invalid/);
assert.throws(() => detail(base, { pluginId: "a", sourceType: "local", hostId: "" }), /Invalid/);
assert.throws(() => detail("/plugins", { pluginId: "a", sourceType: "local", hostId: "local" }), /Invalid/);
assert.throws(() => detail(base, { pluginId: "a", sourceType: "local", hostId: "local", marketplacePath: "path", remoteMarketplaceName: "remote" }), /Invalid/);
assert.throws(() => root("/plugins"), /Invalid/);
console.log("Plugin management locations: proven route tree, raw remote IDs, encoded identities, real source/host and malformed routes passed.");
