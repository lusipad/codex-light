import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const installed = { id: "installed@local", name: "Installed", installed: true, enabled: true,
  source: { type: "local", path: "C:/isolated/installed" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const available = { ...installed, id: "available@local", name: "Available", installed: false };
const market = { name: "private-local", path: "C:/isolated/market.json", plugins: [installed, available] };
let catalogReads = 0, detailReads = 0, installs = 0;
const view = harness({ plugins: {
  listMarketplacePlugins: async () => { catalogReads++; return { marketplaces: [market], featuredPluginIds: [] }; },
  pluginRefFor: plugin => ({ pluginName: plugin.name, marketplacePath: market.path }),
  readPlugin: async ref => { detailReads++; return { summary: ref.pluginName === "Installed" ? installed : available,
    marketplaceName: market.name, skills: [], hooks: [], apps: [], mcpServers: [] }; },
  installPlugin: async () => { installs++; return { appsNeedingAuth: [], authPolicy: "ON_USE" }; },
} });
view.props.manageOnly = false; view.props.initialTab = "plugins"; view.props.initialPluginMode = "browse";
view.setInstalled({ marketplaces: [{ ...market, plugins: [installed] }] });
view.render(); await view.tick();
const cards = () => view.nodes(view.tree).filter(node => node.props.className?.includes("pm-catalog-card"));
assert.equal(cards().length, 2, "directory includes installed and uninstalled plugins");
assert.ok(view.nodes(view.tree).some(node => node.props.className === "pm-installed-strip"));
assert.equal(view.nodes(view.tree).some(node => node.props.className?.includes("pm-segment")), false, "directory is not installed/browse management");
const search = view.nodes(view.tree).find(node => node.type === "input" && node.props.id === "plugins-store-page-search");
assert.equal(search.props.autoFocus, true);
const install = view.nodes(cards()[1]).find(node => node.props["aria-label"] === "安装 Available");
assert.ok(install, "uninstalled card has an accessible icon install action");
assert.equal(view.nodes(cards()[0]).some(node => node.props["aria-label"] === "安装 Installed"), false);
await cards()[1].props.onClick(); await view.tick();
assert.equal(detailReads, 1);
assert.ok(view.nodes(view.tree).some(node => node.props.className === "pm-catalog-detail"));
assert.equal(cards().length, 0, "detail replaces directory instead of expanding the card");
assert.equal(view.nodes(view.tree).some(node => node.props.id === "plugins-store-page-search"), false, "detail does not retain an auto-focused directory header");
view.button("插件").props.onClick(); await view.tick();
assert.equal(cards().length, 2);
const before = catalogReads;
await view.button("刷新").props.onClick(); await view.tick();
assert.ok(catalogReads > before, "directory refresh must read the directory, not only installed inventory");
assert.equal(view.calls.filter(call => ["toggle", "run"].includes(call[0])).length, 0, "reading directory/details never mutates plugins");
let prevented = false;
cards()[1].props.onKeyDown({ key: "Enter", target: cards()[1], currentTarget: cards()[1], nativeEvent: {}, preventDefault() { prevented = true; } });
await view.tick();
assert.equal(prevented, true); assert.equal(detailReads, 2);
view.button("插件").props.onClick(); await view.tick();
const installAction = view.nodes(cards()[1]).find(node => node.props["aria-label"] === "安装 Available");
let stopped = 0;
installAction.props.onClick({ stopPropagation() { stopped++; } });
installAction.props.onClick({ stopPropagation() { stopped++; } });
await view.tick();
assert.equal(stopped, 2); assert.equal(installs, 1, "rapid icon clicks retain the production install single-flight lock");
assert.equal(detailReads, 2, "install action does not also navigate to detail");
view.unmount();
let openedCatalog = 0;
const fromSkills = harness({ plugins: { listMarketplacePlugins: async () => {
  openedCatalog++; return { marketplaces: [market], featuredPluginIds: [] };
} } });
fromSkills.props.manageOnly = false; fromSkills.props.initialTab = "skills";
fromSkills.render(); await fromSkills.tick();
fromSkills.tabs().find(node => fromSkills.text(node).startsWith("插件")).props.onClick(); await fromSkills.tick();
assert.ok(openedCatalog > 0, "entering the directory from skills loads its catalog even with a retained installed-mode default");
fromSkills.unmount();
for (const notification of ["event", "focus"]) {
  let snapshot = { ...installed }, reads = 0;
  const external = harness({ plugins: { listMarketplacePlugins: async () => {
    reads++; return { marketplaces: [{ ...market, plugins: [{ ...snapshot }] }], featuredPluginIds: [] };
  } } });
  external.props.manageOnly = false; external.props.initialTab = "plugins";
  external.render(); await external.tick();
  const before = reads;
  snapshot = { ...installed, installed: false };
  external.setInstalled({ marketplaces: [] });
  external[notification](); await external.tick();
  assert.ok(reads > before, `${notification} refreshes the directory after an external uninstall`);
  assert.ok(external.nodes(external.tree).some(node => node.props["aria-label"] === "安装 Installed"));
  assert.equal(external.nodes(external.tree).some(node => node.props["aria-label"] === "管理 Installed"), false);
  external.unmount();
}
console.log("PASS plugin directory: installed cards/strip, search focus, icon actions, independent detail/back and real catalog refresh");
