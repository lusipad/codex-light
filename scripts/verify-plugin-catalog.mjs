import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const requests = [];
const exports = {};
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
vm.runInNewContext(compile(fs.readFileSync("src/plugins.ts", "utf8")), {
  exports,
  require(name) {
    assert.equal(name, "./bridge");
    return { callAppServer: async (method, params) => {
      requests.push({ method, params });
      return { marketplaces: [{ name: "remote", path: null, plugins: [] }], featuredPluginIds: ["remote-id"] };
    } };
  },
});
for (const force of [false, true]) {
  const catalog = await exports.listMarketplacePlugins(["repo"], force);
  const { method, params } = requests.at(-1);
  assert.equal(method, "plugin/list");
  assert.equal("marketplaceKinds" in params, false, "PC01: server-enabled remote catalog must not be filtered out");
  assert.equal(params.forceRefetch, force, "PC02: explicit refresh forwarded");
  assert.deepEqual([...params.cwds], ["repo"]);
  assert.deepEqual(Object.keys(params).sort(), ["cwds", "forceRefetch"], "PC03: no invented pagination parameters");
  assert.equal(catalog.marketplaces[0].path, null);
  assert.equal(catalog.featuredPluginIds[0], "remote-id");
}
const source = fs.readFileSync("src/components/SkillsMcpView.tsx", "utf8");
const ast = ts.createSourceFile("SkillsMcpView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["remainingBrowseCards", "visibleBrowseGroups", "matchingBrowseCount"].includes(node.name.getText(ast))) {
    declarations[node.name.getText(ast)] = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const browseGroups = [80, 121].map((count, group) => ({
  marketplace: { name: `market-${group}` },
  plugins: Array.from({ length: count }, (_, id) => ({ id: `${group}-${id}` })),
}));
for (const count of [50, 100, 250]) {
  const context = { browseVisibleCount: count, browseGroups };
  for (const [name, expression] of Object.entries(declarations)) {
    context[name] = vm.runInNewContext(compile(`(${expression})`), context);
  }
  const visible = context.visibleBrowseGroups.flatMap(group => group.plugins);
  assert.equal(visible.length, Math.min(count, 201), "PC04: bounded client rendering spans market boundaries");
  assert.equal(new Set(visible.map(item => item.id)).size, visible.length);
  assert.equal(context.matchingBrowseCount, 201);
}
console.log("PC01–PC04 plugin catalog and bounded rendering regressions passed");
