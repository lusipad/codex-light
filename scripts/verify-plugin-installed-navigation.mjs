import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const plugin = { id: "actual@private", name: "Actual", installed: true, enabled: true };
const marketplace = { name: "private", path: "C:/isolated/market.json", plugins: [plugin] };
for (const different of [false, true]) {
  const reads = [], navigations = [];
  const view = harness({
    window: { location: { href: "https://codex.invalid/plugins" }, history: {
      state: {}, replaceState() {}, pushState(...args) { navigations.push(args); },
    } },
    plugins: {
      pluginRefFor: (item, market) => ({ pluginName: item.name, marketplacePath: market.path }),
      listMarketplacePlugins: async () => ({ marketplaces: [] }),
      readPlugin: async ref => { reads.push(ref); return {
        summary: different ? { ...plugin, id: "different@private" } : plugin,
        marketplaceName: "confirmed-source", marketplacePath: "C:/confirmed/market.json",
        skills: [], apps: [], hooks: [], mcpServers: [],
      }; },
    },
  });
  view.props.manageOnly = false; view.props.initialTab = "plugins";
  view.setInstalled({ marketplaces: [marketplace] }); view.render(); await view.tick();
  try {
    const strip = view.nodes(view.tree).find(node => node.type === "PluginInstalledStrip");
    const item = strip.props.items[0];
    assert.match(item.href, /marketplacePath=C%3A%2Fisolated%2Fmarket.json/);
    for (const modifiers of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
      let prevented = false;
      strip.props.onOpen(item, { button: 0, ...modifiers, preventDefault() { prevented = true; } });
      assert.equal(prevented, false);
    }
    assert.equal(reads.length, 0); assert.equal(navigations.length, 0);
    let prevented = false;
    strip.props.onOpen(item, { button: 0, preventDefault() { prevented = true; } });
    await view.tick();
    assert.equal(prevented, true); assert.equal(reads.length, 1); assert.equal(navigations.length, 1);
    const detail = view.nodes(view.tree).find(node => node.type === "PluginDirectoryDetail");
    assert.equal(!!detail, !different, "installed shortcut must reject another entity's metadata");
    if (!different) assert.equal(detail.props.detail.marketplaceName, "confirmed-source");
    else assert.match(view.text(view.tree), /无法加载插件/);
  } finally { view.unmount(); }
}
console.log("Installed strip navigation preserves modified links and checks returned entity identity.");
