import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import ${name}`);
  } }, { filename: path });
  return exports;
}
const recommendedModule = load("src/recommendedSkills.ts", { "./bridge": {}, "./plugins": {} });
const { filterManagedSkills: filter } = load("src/pluginManagementSkills.ts", { "./recommendedSkills": recommendedModule });
const skill = (name, extra = {}) => ({ name, description: "Description", path: `/home/user/.codex/skills/${name}/SKILL.md`, scope: "user", enabled: true, ...extra });
const recommended = (id, name = id) => ({ id, name, description: "Catalog description", repoPath: `skills/.curated/${id}` });
const names = items => Array.from(items, item => item.name).join(",");

const own = skill("own");
assert.equal(filter([own], null).length, 0, "unknown/loading/failed catalog does not classify skills");
assert.equal(filter([own], [recommended("different")])[0], own);
assert.equal(filter([own], [])[0], own, "a successfully empty catalog preserves user skills");
assert.equal(filter([skill("PDF")], []).length, 1, "featured names cannot replace a real catalog");
const sameCompactA = skill("my-pdf"), sameCompactB = skill("my_pdf");
assert.equal(filter([sameCompactA, sameCompactB], [recommended("my-pdf")]).length, 0, "all matching rows are excluded, not only the first result");
assert.equal(filter([skill("alphabet")], [recommended("alpha")]).length, 1, "no substring match");
assert.equal(filter([skill("name", { path: "C:\\Users\\u\\.codex\\skills\\catalog-id\\SKILL.md" })], [recommended("catalog-id")]).length, 0, "SKILL.md parent participates in keys");
assert.equal(filter([skill("name", { path: "/custom/catalog-id.MD" })], [recommended("catalog-id")]).length, 0, "standalone markdown stem participates");
assert.equal(filter([skill("name", { interface: { displayName: "Real Catalog Display" } })], [recommended("catalog", "Real Catalog Display")]).length, 0);
assert.equal(filter([skill("gh_api")], [recommended("catalog", "GH API")]).length, 0);
assert.equal(filter([skill("中文甲")], [recommended("catalog", "中文乙")]).length, 0, "official compact-key behavior includes an empty ASCII compact key");

const scoped = [own, ...["repo", "system", "admin", "future"].map(scope => skill(scope, { scope }))];
assert.equal(names(filter(scoped, [])), "own");
const pluginPaths = [
  "/home/u/.codex/plugins/cache/market/plugin/1.0/skills/s/SKILL.md",
  "C:\\u\\PLUGINS\\cache\\market\\plugin\\1.0\\skills\\s\\SKILL.md",
  "/custom/plugins/plugin/skills/s/SKILL.md",
  "/custom/plugins/plugin/SKILL.md",
  "/custom/plugins/cache/market/plugin/1.0/SKILL.md",
  "  ./plugins/plugin/SKILL.md  ",
];
for (const path of pluginPaths) assert.equal(filter([skill("owned", { path })], []).length, 0, path);
for (const path of ["/custom/plugins/plugin/readme.md", "/custom/plugins/plugin", "/custom/plugins/cache/market/plugin/1.0/readme.md", "/custom/pluginsish/plugin/skills/s/SKILL.md"]) {
  assert.equal(filter([skill("ordinary", { path })], []).length, 1, `not a plugin skill: ${path}`);
}
assert.equal(filter([skill("no-child", { path: "/custom/plugins/plugin/skills/" })], []).length, 1);
const standalone = skill("independent", { path: "/custom/plugins/project/.agents/skills/independent/SKILL.md" });
assert.equal(filter([standalone], [])[0], standalone, "standalone .agents/skills takes precedence over a plugins ancestor");
const unusual = skill("metadata-only", { pluginId: "unproven", path: "/home/u/.codex/skills/metadata-only/SKILL.md" });
assert.equal(filter([unusual], [])[0], unusual, "path ownership follows the fixed official parser");

const later = skill("duplicate", { path: "/z/duplicate/SKILL.md", description: "later" });
const earlier = skill("duplicate", { path: "/a/duplicate/SKILL.md", description: "earlier", enabled: false });
const exactCase = skill("Duplicate", { path: "/b/duplicate/SKILL.md" });
const source = [later, earlier, exactCase];
const snapshot = JSON.stringify(source);
const result = filter(source, []);
assert.equal(result.length, 2, "deduplication uses exact raw name, not normalized name");
assert.equal(result.includes(earlier), true);
assert.equal(result.includes(later), false);
assert.equal(result.includes(exactCase), true);
assert.equal(JSON.stringify(source), snapshot, "classification must not mutate source metadata");
const alpha = skill("z-raw", { interface: { displayName: "Alpha" } }), zulu = skill("a-raw", { interface: { displayName: "Zulu" } });
assert.equal(filter([zulu, alpha], [])[0], alpha, "sort by real display name, then raw name");
console.log("PASS managed skills: catalog boundaries, per-row exact keys, scope/path ownership, raw-name deduplication and stable metadata");
