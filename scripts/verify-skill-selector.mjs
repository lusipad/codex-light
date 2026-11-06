import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/plugins.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("plugins.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(
  (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "setSkillEnabled",
);
assert.ok(declaration, "production setSkillEnabled function exists");
const { outputText } = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

function isolatedWriter(error) {
  const calls = [];
  const context = {
    exports: {},
    call: async (method, payload) => {
      calls.push({ method, payload: JSON.parse(JSON.stringify(payload)) });
      if (error) throw error;
    },
  };
  vm.runInNewContext(outputText, context, { filename: "setSkillEnabled.js" });
  return { write: context.exports.setSkillEnabled, calls };
}

const cases = [
  ["namespaced name takes precedence over path", { name: "plugin:skill", path: "/plugin/SKILL.md", enabled: true }, { name: "plugin:skill", enabled: true }],
  ["namespaced name without path", { name: "plugin:skill", enabled: true }, { name: "plugin:skill", enabled: true }],
  ["plain name prefers path", { name: "skill", path: "/user/SKILL.md", enabled: true }, { path: "/user/SKILL.md", enabled: true }],
  ["path without name", { path: "/user/SKILL.md", enabled: true }, { path: "/user/SKILL.md", enabled: true }],
  ["plain name remains a fallback", { name: "skill", enabled: true }, { name: "skill", enabled: true }],
  ["disable preserves false", { name: "plugin:skill", path: "/plugin/SKILL.md", enabled: false }, { name: "plugin:skill", enabled: false }],
];
let failures = 0;
async function check(label, verify) {
  try {
    await verify();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${label}`, error);
  }
}
for (const [label, params, payload] of cases) {
  await check(label, async () => {
    const { write, calls } = isolatedWriter();
    assert.equal(await write(params), undefined);
    assert.deepEqual(calls, [{ method: "skills/config/write", payload }]);
  });
}
await check("missing selector rejects before RPC", async () => {
  const { write, calls } = isolatedWriter();
  await assert.rejects(write({ enabled: true }), /^Error: skills\/config\/write 需要 name 或 path 之一$/);
  assert.deepEqual(calls, []);
});
await check("RPC error propagates unchanged", async () => {
  const error = new Error("write denied");
  const { write, calls } = isolatedWriter(error);
  await assert.rejects(write({ path: "/user/SKILL.md", enabled: false }), (actual) => actual === error);
  assert.deepEqual(calls, [{ method: "skills/config/write", payload: { path: "/user/SKILL.md", enabled: false } }]);
});
console.log(`Skill selector: ${cases.length + 2 - failures}/${cases.length + 2} passed`);
process.exitCode = failures ? 1 : 0;
