import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const summary = { id: "actual@local", name: "Actual", installed: false, enabled: false,
  installPolicy: "AVAILABLE", authPolicy: "ON_USE" };
const emptyDirectory = async () => ({ marketplaces: [], featuredPluginIds: [] });
const emptySearch = { result: { data: [], nextCursor: null }, loading: false, error: null,
  unsupported: false, paging: false, pageError: null, nextCursor: null, loadMore() {} };

function routeWindow(path) {
  const location = { href: `https://codex.invalid${path}` };
  return { location, history: { state: {}, replaceState(state, _title, url) {
    this.state = state; location.href = new URL(url, location.href).href;
  } } };
}

async function openDetail(id, plugin) {
  const window = routeWindow(`/plugins/${encodeURIComponent(id)}?pluginName=Actual&marketplacePath=C%3A%2Fisolated%2Fmarket.json`);
  const view = harness({ window, plugins: {
    listMarketplacePlugins: emptyDirectory,
    readPlugin: async () => ({ summary: plugin, marketplaceName: "private-market",
      marketplacePath: "C:/isolated/market.json", skills: [], apps: [], hooks: [], mcpServers: [] }),
  } });
  view.props.manageOnly = false; view.props.initialTab = "plugins";
  view.setInstalled({ marketplaces: [] }); view.render(); await view.tick();
  return view;
}

const failures = [];
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

await check("deep-link response identity accepts local and raw remote identities", async () => {
  for (const [id, plugin] of [
    [summary.id, summary],
    ["remote-raw-id", { ...summary, remotePluginId: "remote-raw-id" }],
    ["shared-remote-id", { ...summary, shareContext: { remotePluginId: "shared-remote-id" } }],
  ]) {
    const view = await openDetail(id, plugin);
    try {
      assert.ok(view.nodes(view.tree).some(node => node.type === "h1" && view.text(node) === summary.name),
        `valid identity ${id} must render its confirmed metadata`);
      assert.ok(view.nodes(view.tree).some(node => node.type === "button" && view.text(node) === "安装" && !node.props.disabled),
        `valid identity ${id} retains its available installation action`);
    } finally { view.unmount(); }
  }
});

await check("deep-link rejects metadata belonging to a different plugin", async () => {
  const view = await openDetail("expected@local", summary);
  try {
    assert.equal(view.nodes(view.tree).some(node => node.type === "h1" && view.text(node) === summary.name), false,
      "a mismatching response must not replace the requested plugin identity");
    assert.equal(view.nodes(view.tree).some(node => node.type === "button" && view.text(node) === "安装" && !node.props.disabled), false,
      "a mismatching response must not expose an enabled installation action");
    assert.match(view.text(view.tree), /读取详情失败/,
      "identity rejection remains visible and retryable rather than becoming a blank detail page");
  } finally { view.unmount(); }
});

await check("explicit directory refresh retries the current search query", async () => {
  let retries = 0, sourceReads = 0;
  const view = harness({ window: routeWindow("/plugins?search=retained-query"),
    directory: { loadPluginDirectorySource: async () => { sourceReads++; return { kind: "local" }; } },
    plugins: { listMarketplacePlugins: emptyDirectory },
    directorySearch: () => ({ ...emptySearch, retry() { retries++; } }),
  });
  view.props.manageOnly = false; view.props.initialTab = "plugins";
  view.render(); await view.tick();
  try {
    const beforeRetries = retries, beforeSources = sourceReads;
    await view.button("刷新").props.onClick(); await view.tick();
    assert.ok(sourceReads > beforeSources, "refresh still reloads the directory source");
    assert.equal(retries, beforeRetries + 1, "refresh must request a new result for the unchanged current query");
    assert.equal(view.nodes(view.tree).find(node => node.props.id === "plugins-store-page-search")?.props.value,
      "retained-query", "refresh retains the search input");
  } finally { view.unmount(); }
});

assert.equal(failures.length, 0, `plugin directory review regressions failed: ${failures.join("; ")}`);
