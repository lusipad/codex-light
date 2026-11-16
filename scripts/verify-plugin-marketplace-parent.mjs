import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const input = { source: "private/market", refName: "dev", sparsePaths: ["plugins/a", "plugins/a"] };
const dialog = view => view.nodes(view.tree).find(node => node.type === "AddPluginMarketplaceDialog");
const ready = async options => { const view = harness(options); view.render(); await view.tick(); return view; };

let writes = [], navigation = [];
const view = await ready({ plugins: { addMarketplace: async (...args) => {
  writes.push(args); return { marketplaceName: "actual-market", alreadyAdded: false };
} } });
view.props.onBrowseDirectory = (...args) => navigation.push(args); view.render();
try {
  await dialog(view).props.onAdd(input); await view.tick();
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [[input.source, { refName: "dev", sparsePaths: input.sparsePaths }]]);
  assert.deepEqual(navigation, [["plugins", "actual-market"]], "navigation receives the server identity, not an invented source label");
  navigation = [];
  view.setFeatureRead(async () => { throw Error("refresh unavailable"); });
  await dialog(view).props.onAdd(input); await view.tick();
  assert.equal(writes.length, 2, "refresh failure never repeats marketplace/add");
  assert.match(view.text(view.tree), /actual-market 市场已配置，但刷新插件列表失败/);
  assert.deepEqual(navigation, [["plugins", "actual-market"]], "confirmed add still resolves and delegates guarded navigation");
  const notices = [];
  view.props.onNotify = (...args) => notices.push(args); view.render();
  await dialog(view).props.onAdd(input); await view.tick();
  assert.deepEqual(notices, [["已添加 actual-market 市场", "success"], ["actual-market 市场已配置，但刷新插件列表失败", "error"]], "success and refresh warning belong to the App host so the final warning survives handoff");
} finally { view.unmount(); }

const partial = await ready({ plugins: { addMarketplace: async () => ({ marketplaceName: "partial-market", alreadyAdded: false }) } });
try {
  partial.setInstalled({ marketplaces: [], marketplaceLoadErrors: [{ message: "partial inventory" }] });
  await dialog(partial).props.onAdd(input); await partial.tick();
  assert.match(partial.text(partial.tree), /partial-market 市场已配置，但刷新插件列表失败/, "partial inventory cannot be reported as a complete refresh");
} finally { partial.unmount(); }

const failed = await ready({ plugins: { addMarketplace: async () => { throw Error("write refused"); } } });
try { await assert.rejects(dialog(failed).props.onAdd(input), /write refused/, "write failures reach the dialog instead of closing it as success"); }
finally { failed.unmount(); }

let resolve;
const late = await ready({ plugins: { addMarketplace: () => new Promise(done => { resolve = done; }) } });
let navigated = false; late.props.onBrowseDirectory = () => { navigated = true; }; late.render();
try {
  const pending = dialog(late).props.onAdd(input);
  late.props.connectionIdentity = "local:other-account"; late.render(); await late.tick();
  const reads = late.calls.filter(call => call[0] === "installed").length;
  resolve({ marketplaceName: "old-account-market", alreadyAdded: true }); await pending; await late.tick();
  assert.equal(navigated, false);
  assert.equal(late.calls.filter(call => call[0] === "installed").length, reads, "stale ACK must not refresh the new account");
  assert.doesNotMatch(late.text(late.tree), /old-account-market/);
  assert.equal(dialog(late).props.open, false);
} finally { late.unmount(); }
console.log("Marketplace parent: precise parameters, truthful failures, confirmed-write refresh warning and account isolation passed.");
