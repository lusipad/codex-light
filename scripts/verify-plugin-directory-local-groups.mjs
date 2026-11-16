import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginDirectoryLocalGroups.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { groupPluginDirectoryLocal: group } = exports;
const market = (path, id, name = "Same", displayName) => ({
  name, path, interface: displayName === undefined ? undefined : { displayName },
  plugins: [{ id, name: id }],
});
const home = "C:\\Users\\Lus";
const disambiguated = group([
  market("D:/A/shared/marketplace.json", "a", "Demo"),
  market("D:/B/shared/marketplace.json", "b", "Demo"),
], home).marketplaces;
assert.equal(disambiguated[0].title, "Demo · .../A/shared");
assert.equal(disambiguated[1].title, "Demo · .../B/shared");
const sourceFallback = group([
  market("D:/Same/marketplace.json", "file", "Demo"),
  market("D:\\Same\\marketplace.json", "backslash", "Demo"),
], home).marketplaces;
assert.equal(sourceFallback.every(item => item.title === "Demo · D:/Same"), true);
const distinctLabels = group([
  market("D:/A/marketplace.json", "a", "Demo"),
  market("D:/B/marketplace.json", "b", "demo"),
], home).marketplaces;
assert.equal(distinctLabels.every(item => !item.title.includes(" · ")), true, "duplicate label detection is case sensitive");
assert.equal(group([
  market("D:/Parent/.agents/plugins/marketplace.json", "agents", "Same"),
  market(null, "remote", "Same"),
], home).marketplaces.find(item => item.items[0].plugin.id === "agents").title, "Same · Parent");
const ordered = group([
  market("D:/z", "z", "Zulu"), market("D:/c", "c", "ChatGPT official"),
  market("D:/b", "b", "openai-bundled"), market("D:/a", "a", "Alpha"),
], home).marketplaces;
assert.equal(ordered.map(item => item.items[0].plugin.id).join(), "b,c,a,z");
assert.equal(ordered[0].title, "Built by OpenAI");
for (const alias of ["codex-official", "openai-bundled", "openai-curated", "openai-curated-remote", "openai-primary-runtime"]) {
  assert.equal(group([market("D:/alias", "alias", alias)], home).marketplaces[0].title, "Built by OpenAI");
}
assert.equal(group([market("D:/named", "named", "My OpenAI market")], home).marketplaces[0].title, "My OpenAI market");
assert.equal(group([market("D:/empty", "empty", "   ")], home).marketplaces.length, 0);
assert.equal(group([
  market("D:/empty-first", "empty", "   "), market("D:/empty-first", "visible", "Visible"),
], home).marketplaces[0].items[0].plugin.id, "visible");
const casePaths = group([
  market("D:/Caps/marketplace.json", "upper", "Same"),
  market("D:/caps/marketplace.json", "lower", "Same"),
], home).marketplaces;
assert.equal(casePaths.find(item => item.items[0].plugin.id === "upper").title, "Same · Caps");
assert.equal(casePaths.find(item => item.items[0].plugin.id === "lower").title, "Same · caps");
assert.equal(group([
  market("D:/CAPS/MARKETPLACE.JSON", "uppercase-file", "Same"),
  market("D:/other/marketplace.json", "other", "Same"),
], home).marketplaces.find(item => item.items[0].plugin.id === "uppercase-file").title, "Same · MARKETPLACE.JSON");
const created = market("c:/users/lus/.agents/plugins/marketplace.json", "created");
const other = market("C:/Users/Lus/repo/marketplace.json", "other");
const sameName = market("D:/markets/marketplace.json", "different");
const remote = market(null, "remote", "Same");
const result = group([created, other, sameName, remote], home);
assert.equal(result.created.length, 1);
assert.equal(result.created[0].plugin, created.plugins[0]);
assert.equal(result.created[0].marketplace, created);
assert.equal(result.marketplaces.length, 3, "same display names cannot merge marketplace identities");
for (const source of [other, sameName, remote]) {
  const expected = source.path ?? `remote:${source.name}`;
  const actual = result.marketplaces.find(item => item.id === `plugins-marketplace-${encodeURIComponent(expected)}`);
  assert.equal(actual.items[0].marketplace, source);
}
assert.equal(result.marketplaces.some(item => item.id === "plugins-marketplace-remote%3ASame"), true);
for (const path of [
  "\\\\?\\C:\\Users\\Lus\\.agents\\plugins\\marketplace.json",
  "\\\\?\\c:/Users/Lus/.agents/plugins/marketplace.json",
]) assert.equal(group([market(path, path)], `${home}\\`).created.length, 1);
assert.equal(group([market("\\\\?\\uNc\\server\\share\\user\\.agents\\plugins\\marketplace.json", "unc")],
  "\\\\server\\share\\user\\").created.length, 1);
assert.equal(group([market("/HOME/LUS/.agents/plugins/marketplace.json", "posix")], "/home/lus/").created.length, 1);
for (const path of [
  "c:/users/lus/.agents/plugins/marketplace.json/",
  " c:/users/lus/.agents/plugins/marketplace.json",
  "c:/users/lus/A/../.agents/plugins/marketplace.json",
  "c:/users//lus/.agents/plugins/marketplace.json",
  "\\\\?\\C:Users\\Lus\\.agents\\plugins\\marketplace.json",
  "\\\\?\\UNC/server/share/user/.agents/plugins/marketplace.json",
  "C:/Users/LUS~1/.agents/plugins/marketplace.json",
]) assert.equal(group([market(path, path)], home).created.length, 0, `must not broaden string equivalence: ${path}`);
const caseVariant = market("C:/Users/Lus/.agents/plugins/marketplace.json", "case-variant");
const duplicate = market(created.path, "same-identity");
const firstIdentity = group([created, caseVariant, duplicate], home);
assert.equal(firstIdentity.created.length, 2, "only first matching raw identity enters Created");
assert.equal(firstIdentity.marketplaces.length, 1);
assert.equal(firstIdentity.marketplaces[0].items[0].plugin, caseVariant.plugins[0]);
const duplicatePath = group([other, market(other.path, "second", "different title"), sameName], home);
assert.equal(duplicatePath.marketplaces.length, 2);
assert.equal(duplicatePath.marketplaces.find(item => item.items[0].marketplace === other).items.length, 2);
assert.equal(duplicatePath.marketplaces.find(item => item.items[0].marketplace === other).title, "Same · repo");
assert.equal(group([market("D:/label", "label", "fallback", "  Real label  ")], home).marketplaces[0].title, "Real label");
assert.equal(group([market("D:/blank", "blank", "fallback", "   ")], home).marketplaces[0].title, "fallback");
assert.equal(group([], home).created.length, 0);
assert.equal(created.plugins.length, 1, "grouping must not mutate input entities");
console.log("PASS home-only Created attribution, original identities/references, exact title disambiguation and official label ordering");
