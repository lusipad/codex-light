import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginDirectory.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const matches = exports.pluginDetailMatchesReference;
assert.equal(typeof matches, "function");
const detail = (overrides = {}, summary = {}) => ({ marketplaceName: "market", marketplacePath: "C:/isolated/market.json",
  summary: { id: "tool@market", name: "Tool", remotePluginId: "remote-id", shareContext: { remotePluginId: "shared-id" }, ...summary }, ...overrides });
const local = { pluginName: "Tool", marketplacePath: "C:/isolated/market.json" };
assert.equal(matches(detail(), local), true);
assert.equal(matches(detail({ marketplacePath: "C:/other/market.json" }), local), false, "same plugin ID cannot authorize a different marketplace path");
assert.equal(matches(detail({}, { name: "Other" }), local), false, "local plugin name is exact even when ID matches");
assert.equal(matches(detail({}, { name: "tool" }), local), false);
assert.equal(matches(detail({ marketplacePath: null }), local), false);
assert.equal(matches(detail({ marketplacePath: "" }), local), false);
for (const path of ["c:/ISOLATED/MARKET.JSON", "C:\\isolated\\market.json", "\\\\?\\C:\\isolated\\market.json", "//?/C:/isolated/market.json"]) {
  assert.equal(matches(detail({ marketplacePath: path }), local), true, path);
  assert.equal(matches(detail(), { ...local, marketplacePath: path }), true, path);
}
const unc = { pluginName: "Tool", marketplacePath: "\\\\server\\share\\folder\\market.json" };
for (const path of ["//SERVER/SHARE/folder/market.json", "\\\\?\\UNC\\server\\share\\folder\\market.json", "//?/unc/server/share/folder/market.json"]) {
  assert.equal(matches(detail({ marketplacePath: path }), unc), true, path);
  assert.equal(matches(detail({ marketplacePath: unc.marketplacePath }), { ...unc, marketplacePath: path }), true, path);
}
assert.equal(matches(detail({ marketplacePath: "//other/share/folder/market.json" }), unc), false);
assert.equal(matches(detail({ marketplacePath: "//server/other/folder/market.json" }), unc), false);
const posix = { pluginName: "Tool", marketplacePath: "/home/User/market.json" };
assert.equal(matches(detail({ marketplacePath: posix.marketplacePath }), posix), true);
assert.equal(matches(detail({ marketplacePath: "/home/user/market.json" }), posix), false, "POSIX case is meaningful");
assert.equal(matches(detail({ marketplacePath: "/home/User\\market.json" }), posix), false, "POSIX backslash is a filename character");
assert.equal(matches(detail({ marketplacePath: "C:/ISOLAT~1/market.json" }), local), false, "8.3 aliases require physical evidence, not a string guess");
assert.equal(matches(detail({ marketplacePath: "C:/link/market.json" }), local), false, "symlink identity cannot be inferred");
assert.equal(matches(detail({ marketplacePath: "C:/isolated/sub/../market.json" }), local), false, "parent traversal is not a proven physical identity");
const remote = { pluginName: "Tool", remoteMarketplaceName: "market" };
for (const pluginName of ["Tool", "remote-id", "shared-id", "tool@market"]) assert.equal(matches(detail(), { ...remote, pluginName }), true, pluginName);
assert.equal(matches(detail({ marketplacePath: "C:/materialized/market.json" }), remote), true, "remote reads may return a materialized local path");
assert.equal(matches(detail({ marketplaceName: "other" }), remote), false, "same ID cannot authorize another remote marketplace");
assert.equal(matches(detail({ marketplaceName: "Market" }), remote), false, "remote marketplace names are not Windows paths");
assert.equal(matches(detail(), { ...remote, pluginName: "REMOTE-ID" }), false);
assert.equal(matches(detail({}, { shareContext: { remotePluginId: 12 } }), { ...remote, pluginName: "12" }), false);
assert.equal(matches(detail(), { pluginName: "Tool" }), false);
assert.equal(matches(detail(), { ...local, remoteMarketplaceName: "market" }), false);
assert.equal(matches(detail(), { ...local, remoteMarketplaceName: "" }), false, "a second empty selector is still ambiguous");
for (const reference of [{ pluginName: "Tool", marketplacePath: "" }, { pluginName: "Tool", remoteMarketplaceName: " " }, { ...remote, pluginName: "" }, { ...remote, pluginName: " " }]) assert.equal(matches(detail(), reference), false);
assert.equal(matches(detail(), { ...local, remoteMarketplaceName: null }), true);
assert.equal(matches(detail(), { ...remote, marketplacePath: null }), true);
console.log("Plugin detail reference: exact selector/name provenance, Windows DOS/UNC aliases, POSIX case, remote identities and invalid selectors passed; no filesystem identity is inferred.");
