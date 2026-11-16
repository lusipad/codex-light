import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginDirectoryLocation.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports, URL, URLSearchParams });
const { parsePluginDirectoryLocation: parse, pluginDirectoryBrowseUrl: browse, pluginDirectoryDetailUrl: detail } = module.exports;
const base = "/plugins?directoryTab=installed&category=development&search=C%2B%2B+%E4%B8%AD%E6%96%87&hostId=old&unrelated=discard#unverified";
assert.equal(typeof module.exports.pluginDirectoryTabUrl, "function");
const tabUrl = module.exports.pluginDirectoryTabUrl(base, "personal");
assert.equal(tabUrl, "/plugins?directoryTab=personal&category=development&search=C%2B%2B+%E4%B8%AD%E6%96%87&hostId=old&unrelated=discard#unverified",
  "source selection changes only directoryTab, preserving query and hash");
assert.equal(module.exports.pluginDirectoryTabUrl("/plugins/item?mode=install#focus", "workspace"),
  "/plugins/item?mode=install&directoryTab=workspace#focus");
assert.throws(() => module.exports.pluginDirectoryTabUrl("/settings", "personal"), /Invalid/);
const marketCategory = "plugins-marketplace-" + encodeURIComponent("C:/真实市场/marketplace.json");
const categoryUrl = module.exports.pluginDirectoryCategoryUrl("/plugins?directoryTab=personal&extra=keep#position", marketCategory);
assert.equal(parse(categoryUrl).category, marketCategory, "marketplace identity is encoded once by each URL layer");
assert.equal(new URL(categoryUrl, "https://codex.invalid").hash, "#position");
assert.equal(module.exports.pluginDirectoryCategoryUrl(categoryUrl, null), "/plugins?directoryTab=personal&extra=keep#position");

assert.equal(parse("/plugins").pluginId, null);
assert.equal(parse(new URL("tauri://localhost/plugins")).search, "");
for (const id of ["same@local-a", "same@local-b", "@owner/plugin", "spaces in name", "中文插件", "literal%2F%", "slash/path@源"]) {
  const result = detail(base, { pluginId: id, pluginName: "真实/read 参数%", marketplacePath: "D:\\market place\\中文&目录", hostId: "current" });
  const parsed = parse(result);
  assert.equal(parsed.pluginId, id, "route identity round-trips once without confusing source or encoded separators");
  assert.equal(parsed.pluginName, "真实/read 参数%");
  assert.equal(parsed.marketplacePath, "D:\\market place\\中文&目录");
  assert.equal(parsed.search, "C++ 中文");
  assert.equal(parsed.directoryTab, "installed");
  assert.equal(parsed.category, "development");
  assert.equal(parsed.hostId, "current");
  assert.equal(result.includes("#"), false);
  assert.equal(result.includes("unrelated"), false);
  assert.equal(result.split("?")[0].slice("/plugins/".length).includes("/"), false);
}
assert.notEqual(detail(base, { pluginId: "same@source-a" }), detail(base, { pluginId: "same@source-b" }));
assert.equal(detail("/plugins", { pluginId: "a@b" }), "/plugins/a@b");
assert.equal(parse(detail(base, { pluginId: "id" })).hostId, null, "omitted current host removes stale browse host");
assert.equal(parse(detail(base, { pluginId: "id", hostId: null })).hostId, null);

const remote = detail("/plugins?breadcrumb=settings", {
  pluginId: "listing-id@source", pluginName: "remote-service-id", remoteMarketplaceName: "chatgpt-workspace", mode: "install",
});
assert.equal(parse(remote).pluginId, "listing-id@source");
assert.equal(parse(remote).pluginName, "remote-service-id", "real read reference is independent of route identity");
assert.equal(parse(remote).remoteMarketplaceName, "chatgpt-workspace");
assert.equal(parse(remote).marketplacePath, null);
assert.equal(parse(remote).mode, "install");
assert.equal(parse(remote).breadcrumb, "settings");
assert.equal(parse(detail("/plugins?breadcrumb=elsewhere", { pluginId: "id" })).breadcrumb, null);
assert.equal(parse(detail("/plugins", { pluginId: "id", breadcrumb: "settings" })).breadcrumb, "settings");
assert.equal(parse(detail("/plugins?breadcrumb=settings", { pluginId: "id", breadcrumb: null })).breadcrumb, null);
assert.equal(parse(browse(remote)).pluginName, null, "return to browse removes detail-only read parameters");
assert.equal(parse(browse(remote)).breadcrumb, null);

const retained = parse(browse(base));
assert.equal(retained.hostId, "old");
assert.equal(retained.search, "C++ 中文");
const patched = parse(browse(base, { search: "100% & + 中文", category: null, hostId: "other", directoryTab: "browse" }));
assert.equal(patched.search, "100% & + 中文");
assert.equal(patched.category, null);
assert.equal(patched.hostId, "other");
assert.equal(patched.directoryTab, "browse");
assert.equal(browse("/plugins?search=old&category=old&hostId=old", { search: "", category: null, hostId: null }), "/plugins");
assert.equal(parse("https://example.test/plugins/id?search=x").pluginId, "id");

for (const invalid of ["", "plugins", "garbage", "/settings/plugins", "/plugins/", "/plugins/a/b", "/plugins/a/../b", "/plugins\\id", "/plugins/%", "/plugins/%ZZ", "/plugins/%E4", "/plugins/%20", "/plugins?search=%E4", "//evil/plugins", "http://[invalid/plugins"]) {
  assert.equal(parse(invalid), null, `reject invalid location ${invalid}`);
}
assert.throws(() => detail("/plugins", { pluginId: "" }), /required/);
assert.throws(() => detail("/plugins", { pluginId: "   " }), /required/);
assert.throws(() => browse("/settings"), /Invalid/);
assert.throws(() => detail("/settings", { pluginId: "id" }), /Invalid/);
console.log("Plugin directory locations: identity, encoding, source, browse state, host and invalid route checks passed.");
