import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const view = harness();
view.render(); await view.tick();
try {
  assert.equal(view.core.managementFallback("mcp", { plugins: 1, apps: 0, mcp: 0, skills: 0, marketplaces: 0 }, false, true), "mcp",
    "the permanently available MCP category stays selected even with zero servers");
  const row = view.nodes(view.tree).find(node => node.props.className === "pm-managed-plugin-row");
  assert.ok(row, "management uses a compact row rather than a directory or metadata card");
  assert.ok(view.nodes(row).some(node => node.type === "PluginLogo"), "the row uses its real theme-aware logo");
  assert.equal(view.nodes(row).filter(node => node.props.role === "switch").length, 1);
  assert.equal(view.nodes(row).some(node => /卸载/.test(view.text(node))), false, "uninstall belongs to the detail header");
  assert.equal(view.nodes(row).some(node => node.props.className === "item-card-meta"), false, "raw source metadata does not crowd the compact list");
  assert.equal(view.nodes(view.tree).some(node => node.props.role === "tablist" && node.props["aria-label"] === "管理扩展程序"), false,
    "management segmented controls must not claim directory tablist semantics");
} finally { view.unmount(); }
console.log("Plugin management compact surface and MCP selection contracts passed.");

const emptyMarkets = harness(); emptyMarkets.setMarkets([]); emptyMarkets.render(); await emptyMarkets.tick();
try {
  const actions = emptyMarkets.nodes(emptyMarkets.tree).find(node => node.type === "PluginManagementActions");
  actions.props.onAddMarketplace(); emptyMarkets.render();
  assert.ok(emptyMarkets.nodes(emptyMarkets.tree).some(node => node.type === "AddPluginMarketplaceDialog" && node.props.open === true),
    "adding the first marketplace opens an independent dialog even when the empty marketplace category is hidden");
} finally { emptyMarkets.unmount(); }
