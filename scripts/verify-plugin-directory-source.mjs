import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const data = {};
vm.runInNewContext(compile("src/pluginDirectory.ts"), { exports: data });
const identity = { accountId: "account", userId: "user", generation: 1 };
function fixture(options = {}) {
  const calls = [], api = {}, controller = new AbortController();
  let reads = 0;
  vm.runInNewContext(compile("src/pluginDirectoryClient.ts"), { exports: api,
    require: name => name === "./pluginDirectory" ? data : name === "./config" ? {
      experimentalFeatureListAll: async () => options.features ?? [{ name: "remote_plugin", enabled: true }],
      accountRead: async () => { calls.push("account"); return options.account ?? { account: { type: "chatgpt" } }; },
    } : name === "./plugins" ? { readPlugin: async ref => {
      calls.push(["detail", ref]);
      return options.detail ?? { marketplaceName: "metadata-market", marketplacePath: null,
        summary: { id: "actual@metadata-market", name: "actual", remotePluginId: "remote-id", installed: false, installPolicy: "AVAILABLE" } };
    } } : { serviceIdentity: async () => { calls.push("identity"); return reads && options.changed ? { ...identity, generation: 2 } : identity; },
      readRemotePluginDirectoryHome: async () => { calls.push("home"); reads++; if (options.abort) controller.abort();
        return [{ id: "section", plugins: [{ id: "remote-id", display_name: "Home" }] }]; },
      readRemotePluginDirectoryCategory: async (...args) => { calls.push(["category", ...args]); return { plugins: [{ id: "category-plugin", display_name: "Category" }], nextCursor: "opaque-cursor" }; },
    },
  });
  return { calls, controller, run: () => api.loadPluginDirectorySource(controller.signal),
    detail: () => api.readLocalDirectoryListing("remote-id"),
    category: () => api.loadPluginDirectoryCategory(identity, "tools", "query", "cursor", controller.signal) };
}
for (const [features, kind] of [[[], "unresolved"], [[{ name: "remote_plugin", enabled: false }], "local"]]) {
  const h = fixture({ features }); assert.equal((await h.run()).kind, kind);
  assert.equal(h.calls.length, 0, "unresolved/disabled remote gate never reads the authenticated home endpoint");
}
{
  const h = fixture({ account: { account: { type: "apiKey" } } });
  assert.equal((await h.run()).kind, "requires-chatgpt"); assert.equal(h.calls.includes("home"), false);
}
{
  const h = fixture(), result = await h.run();
  assert.equal(result.kind, "remote"); assert.equal(result.sections[0].plugins[0].displayName, "Home");
  assert.equal(h.calls.filter(call => call === "home").length, 1);
}
for (const options of [{ changed: true }, { abort: true }, { account: { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "foreign" } } }]) {
  const h = fixture(options); await assert.rejects(h.run());
  if (options.abort) assert.equal(h.calls.at(-1), "home", "cancellation stops subsequent identity/account reads");
}
{
  const h = fixture(), result = await h.detail();
  assert.equal(h.calls[0][1].pluginName, "remote-id");
  assert.equal(h.calls[0][1].remoteMarketplaceName, "chatgpt-workspace");
  assert.equal(result.marketplaceName, "metadata-market", "installation uses confirmed metadata source rather than the initial lookup source");
  const page = await h.category(); assert.equal(page.plugins[0].displayName, "Category"); assert.equal(page.nextCursor, "opaque-cursor");
  assert.equal(h.calls[1][2], "tools"); assert.equal(h.calls[1][4], "cursor");
}
for (const detail of [{ marketplaceName: "", summary: {} }, { marketplaceName: "market", summary: {
  id: "unrelated", name: "actual", remotePluginId: "foreign", installed: false, installPolicy: "AVAILABLE",
} }, { marketplaceName: "market", summary: { id: "remote-id", name: "actual", installed: false } }]) {
  await assert.rejects(fixture({ detail }).detail());
}
console.log("PASS directory source: explicit gate, ChatGPT auth, identity roundtrip, cancellation and no accidental remote fallback");
