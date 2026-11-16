import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const api = {}, requests = [];
const row = { marketplaceName: "private", marketplacePath: "C:/private/market.json", plugin: { id: "one@private", name: "one", installed: false } };
let reply = () => ({ data: [row], nextCursor: "next" });
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/plugins.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api, require: () => ({ callAppServer: async (method, params) => { requests.push({ method, params }); return reply(); } }) });
const page = await api.searchPlugins("typed query", ["C:/private"], null);
assert.equal(page.data[0], row); assert.equal(page.nextCursor, "next");
assert.equal(requests[0].method, "plugin/search");
assert.deepEqual(Object.keys(requests[0].params).sort(), ["cursor", "cwds", "limit", "searchTerm"]);
assert.equal(requests[0].params.limit, 50); assert.equal(requests[0].params.searchTerm, "typed query");
await api.searchPlugins("typed query", ["C:/private"], "next"); assert.equal(requests.at(-1).params.cursor, "next");
reply = () => ({ data: [] }); assert.equal((await api.searchPlugins("empty")).nextCursor, null, "protocol permits omitted nextCursor");
for (const value of [null, {}, { data: {}, nextCursor: null }, { data: [row], nextCursor: 1 },
  { data: [{ ...row, marketplaceName: "" }] }, { data: [{ ...row, plugin: { ...row.plugin, installed: "yes" } }] }]) {
  reply = () => value; await assert.rejects(api.searchPlugins("query"));
}
assert.equal(api.isUnsupportedPluginSearch(new api.PluginProtocolError("plugin/search", "unknown method")), true);
for (const [method, error] of [["plugin/search", "403 forbidden"], ["plugin/search", "network failure"], ["plugin/read", "unknown method"]]) {
  assert.equal(api.isUnsupportedPluginSearch(new api.PluginProtocolError(method, error)), false);
}
console.log("PASS plugin/search exact main-directory params, cursor, real source rows, strict response and missing-method-only fallback");
