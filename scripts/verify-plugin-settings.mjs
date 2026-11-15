import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/components/SkillsMcpView.tsx", "utf8");
const ast = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sections = {};
function visit(node) {
  if (ts.isJsxElement(node)) {
    const opening = node.openingElement.getText(ast);
    for (const name of ["panel-page-header", "sub-tabs", "pm-segment"]) {
      if (opening.includes(`className="${name}"`)) sections[name] = node.getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join(" ") : typeof node === "string" ? node : "";
const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
for (const manageOnly of [true, false]) {
  for (const subTab of ["plugins", "skills", "mcp"]) {
    const visits = [], changes = [];
    const context = { React: react, manageOnly, subTab, onManagePlugins: () => visits.push("management"), onBrowseDirectory: tab => visits.push(tab),
      searchQuery: "", setSearchQuery() {}, setSkillSearchIndex() {}, handleSkillSearchKey() {}, setSubTab: tab => changes.push(tab), refreshAll() {},
      installedCount: 2, remoteSkills: [], skills: [], config: null, appsData: [], appsInstalled: [], installedMarketplaces: [],
      selectTab: tab => changes.push(tab), visibleManagementTabs: ["plugins", "apps", "mcp", "skills", "marketplaces"],
      tabCounts: { plugins: 2, apps: 1, mcp: 0, skills: 1, marketplaces: 1 },
      tabLabels: { plugins: "插件", apps: "应用", mcp: "MCP", skills: "技能", marketplaces: "市场" },
      pluginMode: "installed", setPluginMode() {},
    };
    for (const name of ["Plus", "RefreshCw", "Boxes", "BookOpen", "Server", "AppWindow", "ShoppingBag", "Package", "Store"]) context[name] = name;
    const render = name => vm.runInNewContext(ts.transpileModule(`(${sections[name]})`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, context);
    const header = render("panel-page-header");
    const browse = nodes(header).find(node => node.type === "button" && text(node).includes("浏览目录"));
    assert.equal(!!browse, manageOnly);
    if (browse) { browse.props.onClick(); assert.deepEqual(visits, [subTab === "skills" ? "skills" : "plugins"]); }
    const tabs = nodes(render("sub-tabs")).filter(node => node.type === "button");
    assert.equal(tabs.length, manageOnly ? 5 : 2);
    tabs.forEach(node => node.props.onClick());
    assert.deepEqual(changes, manageOnly ? ["plugins", "apps", "mcp", "skills", "marketplaces"] : ["plugins", "skills"]);
    assert.equal(text(render("pm-segment")).includes("浏览市场"), !manageOnly);
  }
}
console.log("PASS PS02/PS03: production JSX management tabs and directory callbacks, directory and management tabs separated");
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(parent.includes("<SkillsMcpView"));
assert.ok(parent.includes("key={activeWorkspaceRoot}"));
assert.ok(parent.includes('onNavigateRoute?.(tab === "skills" ? "skills" : "plugins")'));
assert.ok(!parent.includes("插件市场与更新源"));
assert.ok(!parent.includes("setRealPlugins"));
assert.ok(parent.includes('activeSection === "plugins-settings" &&'));
assert.ok(parent.includes("manageOnly"));
assert.ok(!parent.includes("handleSaveVisual"));
assert.ok(!parent.includes("setConfigKeys"), "dedicated plugin settings cannot inherit generic config batch writes");
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(app.includes('if (r === "plugins" || r === "skills") setPluginDirectoryMode("browse")'));
assert.ok(app.includes('initialPluginMode={pluginDirectoryMode}'));
assert.ok(source.includes('manageOnly ? "installed" : initialPluginMode'));
console.log("PASS PS01/PS04: shared manager lifecycle and directory initial mode wired, fake policy form removed");
