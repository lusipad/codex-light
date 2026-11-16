import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { execFileSync } from "node:child_process";
const source = process.argv.includes("--baseline") ? execFileSync("git", ["show", "4241446:src/plugins.ts"], { encoding: "utf8" }) : fs.readFileSync("src/plugins.ts", "utf8");
function load(respond) {
  const calls = [], exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: () => ({ callAppServer: async (method, params) => { calls.push({ method, params }); return respond(method, params); } }),
  });
  return { api: exports, calls };
}
const ref = { pluginName: "actual", marketplacePath: "D:/private/market.json" };
for (const value of [undefined, null, {}, "unknown"]) {
  const { api } = load(() => ({ plugin: { summary: {}, appTemplates: value } }));
  await assert.rejects(api.readPlugin(ref), error => error.method === "plugin/read", "missing/invalid required templates cannot become an empty successful detail");
}
const raw = { templateId: "raw/id", name: "", materializedAppIds: ["first", "second"], category: "  raw category  ", description: "", logoUrl: null, reason: "NO_ACTIVE_WORKSPACE", unknown: "drop" };
{
  const { api } = load(() => ({ plugin: { summary: {}, appTemplates: [raw] } }));
  const result = await api.readPlugin(ref);
  assert.equal(result.appTemplates[0].name, ""); assert.equal(result.appTemplates[0].description, "");
  assert.equal(result.appTemplates[0].category, raw.category); assert.equal("unknown" in result.appTemplates[0], false);
  for (const value of [[null], [{ ...raw, name: 1 }], [{ ...raw, templateId: null }], [{ ...raw, materializedAppIds: null }],
    [{ ...raw, materializedAppIds: [1] }], [{ ...raw, category: 1 }], [{ ...raw, reason: "UNKNOWN" }]]) assert.throws(() => api.decodeAppTemplates(value));
}
{
  const ids = Array.from({ length: 205 }, (_, i) => `raw-${i}`);
  const { api, calls } = load((_method, { appIds }) => ({ apps: appIds.map(id => ({ id, name: "", iconUrl: `https://example.test/${id}`, toolSummaries: [], private: "drop" })), missingAppIds: [] }));
  const rows = await api.readConnectorMetadata([...ids, ids[0]], { includeTools: true });
  assert.equal(rows.length, 205); assert.deepEqual(calls.map(call => call.params.appIds.length), [100, 100, 5]);
  assert.equal(calls.every(call => call.method === "app/read" && call.params.includeTools === true), true);
  assert.equal(rows[0].name, ""); assert.equal("private" in rows[0], false); assert.equal(rows[0].toolSummaries.length, 0);
}
for (const body of [null, {}, { apps: [], missingAppIds: [] }, { apps: [{ id: "foreign", name: "Foreign" }], missingAppIds: [] },
  { apps: [{ id: "wanted", name: "Name" }], missingAppIds: ["wanted"] }, { apps: [], missingAppIds: [1] },
  { apps: [{ id: "wanted", name: "Name", iconUrl: 2 }], missingAppIds: [] }, { apps: [{ id: "wanted", name: "Name", toolSummaries: false }], missingAppIds: [] }]) {
  const { api, calls } = load(() => body); await assert.rejects(api.readConnectorMetadata(["wanted"]));
  assert.equal(calls.length, 1, "malformed metadata never becomes a catalog fallback");
}
{
  const { api, calls } = load((method, params) => {
    if (method === "app/read") throw Error("-32601 method not found");
    assert.equal(method, "app/list");
    return params.cursor ? { data: [{ id: "wanted", name: "From second page", logoUrl: "https://example.test/icon" }], nextCursor: null }
      : { data: [{ id: "other", name: "Other" }], nextCursor: "page2" };
  });
  const rows = await api.readConnectorMetadata(["wanted"], { includeTools: true });
  assert.equal(rows[0].name, "From second page"); assert.equal(rows[0].iconUrl, "https://example.test/icon");
  assert.equal("toolSummaries" in rows[0], false, "catalog fallback cannot invent empty tools and hide an implicit app");
  assert.equal(calls.length, 3);
}
{
  const { api, calls } = load(() => { throw Error("403 forbidden"); });
  await assert.rejects(api.readConnectorMetadata(["wanted"])); assert.equal(calls.length, 1);
}
{
  const controller = new AbortController(), { api, calls } = load(() => { controller.abort(); return { apps: [], missingAppIds: ["wanted"] }; });
  await assert.rejects(api.readConnectorMetadata(["wanted"], { signal: controller.signal }), /取消/);
  const before = calls.length; await assert.rejects(api.readConnectorMetadata(["wanted"], { signal: controller.signal }), /取消/); assert.equal(calls.length, before);
}
{
  const controller = new AbortController(), { api, calls } = load(() => { controller.abort(); return { data: [{ id: "first", name: "First" }], nextCursor: "must-not-read" }; });
  await assert.rejects(api.listAllApps({ signal: controller.signal }), /取消/);
  assert.equal(calls.length, 1, "retired directory completion cannot request a second page");
  assert.equal("signal" in calls[0].params, false, "AbortSignal is local lifecycle state, not an invented app/list parameter");
}
{
  const bridge = {}, sent = [], identity = { accountId: "a", userId: "u", generation: 5 };
  let foreign = false;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: bridge, crypto: { randomUUID: () => "template-fixture" }, navigator: { userAgent: "fixture", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
    localStorage: { getItem: () => "private-device" }, require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
      sent.push({ command, args }); return { requestId: args.request.requestId, identity: foreign ? { ...identity, generation: 6 } : identity, body: { pluginId: args.request.pluginId, setupEligibleAppTemplateIds: [] } };
    } } : {},
  });
  const signal = new AbortController().signal, rawId = "raw/id@openai-curated-remote?中%2F";
  await bridge.readLocalPluginTemplateSetup(rawId, identity, signal);
  assert.equal(sent[0].command, "plugin_template_setup_read"); assert.equal(sent[0].args.request.pluginId, rawId);
  assert.equal(sent[0].args.request.expectedIdentity, identity); assert.equal("url" in sent[0].args.request, false);
  foreign = true; await assert.rejects(bridge.readLocalPluginTemplateSetup(rawId, identity, signal), /账号发生变化/);
  const stopped = new AbortController(); stopped.abort(); const before = sent.length;
  await assert.rejects(bridge.readLocalPluginTemplateSetup(rawId, identity, stopped.signal), /取消/); assert.equal(sent.length, before);
}
console.log("PASS template protocol: strict required wire DTO, 100-target batching, complete coverage, exact raw ownership, typed icon/tools metadata, unsupported-only complete catalog fallback and cancellation");
