import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/skillTrialPrompt.ts", "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const build = exports.buildSkillTrialPrompt;
assert.equal(build({ name: "demo" }), "$demo ");
assert.equal(build({ name: "demo", path: "C:\\Work\\demo)\\SKILL.md" }),
  "[$demo](C:\\\\Work\\\\demo\\)\\\\SKILL.md) ");
assert.equal(build({ name: "demo", defaultPrompt: "  explain this\n " }), "explain this $demo ");
assert.equal(build({ name: "demo", path: "/skills/demo/SKILL.md", defaultPrompt: "Use [$DEMO](elsewhere)" }),
  "Use [$DEMO](elsewhere) ");
assert.equal(build({ name: "demo", defaultPrompt: "Use $demonstration" }), "Use $demonstration ");
assert.equal(build({ name: "demo", path: "/x y/技能.md", defaultPrompt: "Use $demo" }),
  "Use $demo [$demo](/x y/技能.md) ");
assert.equal(build({ name: "a[b](c)", path: "/x)" }), "[$a\\[b\\]\\(c)](/x\\)) ");
assert.equal(build({ name: "demo", defaultPrompt: " \t\n" }), "$demo ");
console.log("PASS 8 skill trial prompt samples (official static contract; no model turn)");
