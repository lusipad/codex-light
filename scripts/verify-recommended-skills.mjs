import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/recommendedSkills.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const item = { id: "demo.skill", name: "Demo", description: "", repoPath: "skills/.curated/demo.skill" };
const destination = "C:/Project/.codex/skills/demo.skill";
const installed = { destination, skill: {
  ...item, path: `${destination}/SKILL.md`, dirPath: destination, installed: true, content: "# Demo",
} };
const catalog = { skills: [item], repoRoot: "C:/cache/skills", source: "cache", fetchedAt: 100, error: "refresh failed" };
function fixture(options = {}) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === "./bridge") return { async tauriInvoke(method, args) {
      calls.push([method, args]);
      if (options.invokeError) throw Error("native unavailable");
      return method === "recommended_skills_list" ? (options.catalog ?? catalog) : (options.installed ?? installed);
    } };
    if (name === "./plugins") return {
      async listSkills(cwds, forceReload) {
        calls.push(["skills/list", cwds, forceReload]);
        if (options.discoveryError) throw Error("transport disconnected");
        return options.discovery ?? { data: [{ cwd: "C:/Project", skills: [{ path: `${destination}/SKILL.md` }], errors: [] }] };
      },
      flattenSkills(response) {
        return { skills: response.data.flatMap(entry => entry.skills), errors: response.data.flatMap(entry => entry.errors) };
      },
    };
    throw Error(name);
  } });
  return { api: exports, calls };
}

{
  const f = fixture();
  const result = await f.api.readRecommendedSkills(true);
  assert.equal(result.skills[0].id, item.id);
  assert.equal(result.error, "refresh failed", "目录刷新错误不能抹掉缓存或伪装成功");
  assert.equal(f.calls[0][1].refresh, true);
}
for (const invalid of [
  {}, { ...catalog, skills: null }, { ...catalog, error: undefined },
  { ...catalog, fetchedAt: NaN }, { ...catalog, repoRoot: "relative" },
  { ...catalog, skills: [item, item] }, { ...catalog, skills: [{ ...item, repoPath: "skills/.curated/other" }] },
]) {
  await assert.rejects(fixture({ catalog: invalid }).api.readRecommendedSkills(false));
}
{
  const f = fixture();
  assert.equal((await f.api.installRecommendedSkill(item, "c:\\PROJECT")).destination, destination);
  assert.equal(f.calls[0][1].skillId, item.id);
  assert.equal(f.calls[0][1].repoPath, item.repoPath);
  assert.equal(f.calls[0][1].installRoot, "c:\\PROJECT");
}
for (const invalid of [
  {}, { ...installed, destination: `${destination}-other` },
  { ...installed, skill: { ...installed.skill, path: `${destination}/SKILL.md.other` } },
  { ...installed, skill: { ...installed.skill, installed: false } },
  { ...installed, skill: { ...installed.skill, dirPath: `${destination}-other` } },
  { ...installed, skill: { ...installed.skill, id: "other" } },
  { ...installed, destination: "relative", skill: { ...installed.skill, content: undefined } },
]) {
  await assert.rejects(fixture({ installed: invalid }).api.installRecommendedSkill(item, "C:/Project"));
}
{
  const value = { destination: "C:/Other/.codex/skills/demo.skill", skill: {
    ...installed.skill, path: "C:/Other/.codex/skills/demo.skill/SKILL.md", dirPath: "C:/Other/.codex/skills/demo.skill",
  } };
  await assert.rejects(fixture({ installed: value }).api.installRecommendedSkill(item, "C:/Project"));
}
{
  const f = fixture();
  const result = await f.api.verifyRecommendedSkillDiscovery("c:\\PROJECT\\.codex\\skills\\demo.skill\\", "C:/Project");
  assert.equal(result.found, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(Array.from(f.calls[0][1]), ["C:/Project"]);
  assert.equal(f.calls[0][2], true);
  await f.api.verifyRecommendedSkillDiscovery(destination, null);
  assert.equal(f.calls[1][1], undefined);
}
for (const path of [`${destination}-other/SKILL.md`, `${destination}/nested/SKILL.md`, `${destination}/SKILL.md.bak`]) {
  const result = await fixture({ discovery: { data: [{ skills: [{ path }], errors: [] }] } })
    .api.verifyRecommendedSkillDiscovery(destination, null);
  assert.equal(result.found, false);
  assert.match(result.errors.join(" "), /已安装.*尚未发现/);
}
{
  const result = await fixture({ discoveryError: true }).api.verifyRecommendedSkillDiscovery(destination, null);
  assert.equal(result.found, false);
  assert.match(result.errors.join(" "), /读取失败.*不代表文件未安装.*transport disconnected/);
}
{
  const result = await fixture({ discovery: {} }).api.verifyRecommendedSkillDiscovery(destination, null);
  assert.equal(result.found, false);
  assert.match(result.errors.join(" "), /响应格式无效/);
}
{
  const result = await fixture({ discovery: { data: [{ skills: [{ path: `${destination}/SKILL.md` }], errors: [{ message: "other skill invalid" }] }] } })
    .api.verifyRecommendedSkillDiscovery(destination, null);
  assert.equal(result.found, true);
  assert.equal(result.errors[0], "other skill invalid");
}
await assert.rejects(fixture({ invokeError: true }).api.installRecommendedSkill(item, null), /native unavailable/);
console.log("Recommended skills: cache/error, response validation, install identity, exact discovery and read failures passed");
