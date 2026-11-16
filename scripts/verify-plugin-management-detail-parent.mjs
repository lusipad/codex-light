import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const summary = { id: "tool@market", name: "Tool", installed: true, enabled: true, source: { type: "local", path: "C:/isolated/tool" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const metadata = { summary, marketplaceName: "market", marketplacePath: "C:/isolated/market.json", description: "Real content", skills: [{ name: "Tool:read", path: "C:/isolated/tool/SKILL.md", enabled: true, description: "Read" }], apps: [{ id: "actual-app", name: "Actual app" }], mcpServers: ["actual-server"], hooks: [{ eventName: "PreToolUse", key: "actual-hook" }] };
const settings = [], files = [];
const view = harness({ plugins: { pluginRefFor: () => ({ pluginName: "Tool", marketplacePath: metadata.marketplacePath }), readPlugin: async () => metadata },
  fs: { readFileText: async path => { files.push(path); return "real contents"; } } });
view.props.onOpenPluginSettings = section => settings.push(section);
view.props.workspaceRoots = ["C:/first-project-root", "C:/second-project-root"];
view.render(); await view.tick();
try {
  const open = view.nodes(view.tree).find(node => node.props.className === "pm-managed-plugin-open");
  open.props.onClick(); await view.tick();
  const detail = view.nodes(view.tree).find(node => node.type === "PluginManagementDetail");
  assert.ok(detail, "management uses its own complete detail presentation");
  assert.equal(detail.props.detail, metadata);
  assert.equal(view.nodes(view.tree).some(node => node.props.className === "pm-detail-grid"), false, "old raw ID/auth-policy card is removed");
  const included = view.nodes(detail).find(node => node.type === "PluginDirectoryIncluded");
  assert.equal(included.props.presentation, "settings");
  assert.equal(included.props.detail, metadata, "all declared apps, MCP, skills and hooks reach the real included component");
  assert.equal(included.props.mcpCwd, "C:/first-project-root", "official config read uses the first host root, not the active editor root");
  included.props.onOpenMcpSettings(); included.props.onOpenHooksSettings();
  assert.deepEqual(settings, ["connections", "hooks-settings"]);
  assert.equal(await included.props.loadSkillContents(metadata.skills[0], null), "real contents");
  assert.deepEqual(files, ["C:/isolated/tool/SKILL.md"]);
  assert.equal(view.calls.filter(call => ["toggle", "run"].includes(call[0])).length, 0, "reading management content never mutates its installation");
  detail.props.onBack(); await view.tick();
  assert.equal(view.nodes(view.tree).some(node => node.type === "PluginManagementDetail"), false);
  const openAgain = view.nodes(view.tree).find(node => node.props.className === "pm-managed-plugin-open");
  openAgain.props.onClick(); await view.tick();
  const actualIncluded = view.nodes(view.tree).find(node => node.type === "PluginDirectoryIncluded");
  assert.equal(typeof actualIncluded.props.onOpenApp, "function", "the management included App consumer receives real standalone navigation");
} finally { view.unmount(); }
console.log("Management detail parent: dedicated presentation, actual included metadata, file reads, settings navigation and safe return passed.");
