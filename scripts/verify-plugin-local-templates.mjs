import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const protocol = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/plugins.ts", "utf8")), {
  exports: protocol.exports, require: () => ({ callAppServer() { throw Error("No real protocol calls in template replay"); } }),
});
const identity = { accountId: "original-account", userId: "original-user", generation: 5 };
const account = { account: { type: "chatgpt", email: "fixture@example.test" }, workspaceRouting: { chatgptAccountId: identity.accountId, backendOrigin: "https://fixture.invalid" } };
const template = { templateId: "template-one", name: "Original name", materializedAppIds: [], canonicalConnectorId: "canonical-one" };
const detail = patch => ({ summary: { id: "local@market", name: "local", remotePluginId: "gmail@openai-curated", ...patch?.summary },
  apps: patch?.apps ?? [], appTemplates: patch?.appTemplates ?? [template], ...patch,
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(overrides = {}) {
  const calls = [];
  const config = { accountRead: async () => { calls.push(["account"]); return account; }, ...overrides.config };
  const service = {
    serviceIdentity: async () => { calls.push(["identity"]); return identity; },
    readLocalPluginTemplateSetup: async (id, expected, signal) => {
      calls.push(["setup", id, expected, signal]); return { pluginId: id, setupEligibleAppTemplateIds: ["template-one"] };
    }, ...overrides.service,
  };
  const plugins = { ...protocol.exports,
    readConnectorMetadata: async (ids, options) => { calls.push(["metadata", plain(ids), options]); return []; },
    listAllApps: async options => { calls.push(["directory", options]); return []; },
    ...overrides.plugins,
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync("src/pluginLocalTemplates.ts", "utf8")), {
    exports: module.exports, URL, require: name => ({ "./config": config, "./chatgptService": service, "./plugins": plugins })[name],
  });
  return { ...module.exports, calls, service, config, plugins,
    load: (value = detail(), signal = new AbortController().signal, expected) => module.exports.loadLocalPluginTemplates(value, signal, expected) };
}

const pure = harness();
const legacyMap = {
  box: "plugin_asdk_app_695bfc98071c8191bac7bc479aa27de7", gmail: "plugin_connector_1p_95d39881713c8191931482a62d6edff9",
  "google-calendar": "plugin_connector_1p_f8509de903288191b14a160c6c5d20b0", "google-drive": "plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7",
  notion: "plugin_asdk_app_69c18c28f1188191bf5b8445c4ab0a2e", "outlook-calendar": "plugin_connector_1p_fd0f4f41caa88191a9456514bbffa06d",
  "outlook-email": "plugin_connector_1p_6bcb5879c73c819196abc70016166099", salesforce: "plugin_asdk_app_697d413990c88191a2bf4799604f8f6c",
  sharepoint: "plugin_connector_1p_dca009ae2c848191ae14df3a47c5e7fd", slack: "plugin_asdk_app_69a1d78e929881919bba0dbda1f6436d",
  teams: "plugin_connector_1p_eba8b52fe53881918408d4b46b957644",
};
for (const [slug, id] of Object.entries(legacyMap)) assert.equal(pure.resolveLocalPluginServiceId(`${slug}@openai-curated`), id);
for (const [raw, expected] of [["plugin_Raw", "plugin_Raw"], ["whatever@openai-curated-remote", "whatever@openai-curated-remote"],
  ["a@b@openai-curated-remote", "a@b@openai-curated-remote"], ["gmail@", legacyMap.gmail], ["Gmail@openai-curated", undefined],
  ["gmail@other-market", undefined], ["a@gmail@openai-curated", undefined], ["@gmail", undefined], ["unknown@openai-curated", undefined],
  ["constructor@openai-curated", undefined], [null, undefined], [undefined, undefined]]) assert.equal(pure.resolveLocalPluginServiceId(raw), expected);
for (const count of [0, 1, 2, 9]) {
  const raw = "gmail@openai-curated", url = new URL(pure.localPluginTemplateManagementUrl(raw, count));
  assert.equal(url.origin, "https://chatgpt.com"); assert.equal(url.pathname, `/plugins/${encodeURIComponent(raw)}`);
  assert.equal(url.search, "?no_universal_links=1");
  assert.equal(url.hash, count === 1 ? `#settings/Plugins/${encodeURIComponent(raw)}?product-sku=CODEX` : "");
}
{
  const raw = "plugin_/中文% ?#", url = new URL(pure.localPluginTemplateManagementUrl(raw, 1));
  assert.equal(url.pathname, `/plugins/${encodeURIComponent(raw)}`, "the raw external ID is encoded as one segment, independently of HTTP alias resolution");
}
{
  const originals = [{ ...template, category: "  ", description: "", logoUrl: "", logoUrlDark: "" },
    { ...template, templateId: "fallback", canonicalConnectorId: "missing", name: "Keep name", materializedAppIds: ["materialized"], description: " " }];
  const result = pure.enrichLocalPluginTemplates(originals,
    [{ id: "canonical-one", name: "Wrong metadata name", description: "Canonical description", iconUrlDark: "dark" },
      { id: "template-one", name: "Fallback", description: "Wrong fallback description", iconUrl: "wrong" },
      { id: "fallback", name: "Fallback", iconUrl: "light" }],
    [{ id: "canonical-one", name: "Directory", branding: { category: "  " }, appMetadata: { categories: ["", "  category  "] } },
      { id: "template-one", name: "Wrong fallback", branding: { category: "wrong" } }]);
  assert.equal(result[0].name, template.name); assert.equal(result[0].category, "category");
  assert.equal(result[0].description, "Canonical description"); assert.equal(result[0].logoUrl, "dark"); assert.equal(result[0].logoUrlDark, "dark");
  assert.equal(result[1].name, "Keep name"); assert.equal(result[1].description, " ", "description uses truthiness, not trimming");
  assert.equal(result[1].logoUrlDark, "light"); assert.deepEqual(plain(result[1].materializedAppIds), ["materialized"]);
  assert.equal(originals[0].description, "", "pure enrichment never mutates CLI data");
  assert.equal(pure.enrichLocalPluginTemplates([template], [], [{ id: "canonical-one", name: "Same", labels: ["not-category"] }])[0].category, null);
}
{
  const view = harness(), result = await view.load(detail(), undefined, identity);
  assert.equal(result.remotePluginId, "gmail@openai-curated");
  assert.equal(view.calls.find(call => call[0] === "setup")[1], legacyMap.gmail);
  assert.equal(view.calls.find(call => call[0] === "setup")[2].accountId, identity.accountId);
  assert.ok(view.calls.find(call => call[0] === "directory")[1].signal instanceof AbortSignal,
    "the full-directory reader receives the origin cancellation signal for subsequent pages");
  assert.deepEqual(plain(result.eligibleTemplateIds), [template.templateId]);
  assert.equal(result.identity.generation, identity.generation);
}
for (const value of [{ summary: { shareContext: { remotePluginId: "plugin_shared" } } },
  { summary: { remotePluginId: "whole@openai-curated-remote" } }]) {
  const view = harness(), result = await view.load(detail(value));
  const setup = view.calls.find(call => call[0] === "setup");
  if (value.summary.shareContext) { assert.equal(setup[1], "plugin_shared"); assert.equal(result.remotePluginId, "plugin_shared"); }
  else assert.equal(setup[1], value.summary.remotePluginId);
}
const identityFailures = [];
async function identityCase(name, run) {
  try { await run(); }
  catch (error) { identityFailures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}
for (const remotePluginId of ["", "  "]) await identityCase(`raw ID ${JSON.stringify(remotePluginId)} remains exact`, async () => {
  const view = harness(), result = await view.load(detail({ summary: { id: "plugin_cli_must_not_be_guessed", remotePluginId,
    shareContext: { remotePluginId: "plugin_shared_must_not_override_primary" } } }));
  assert.equal(result.remotePluginId, remotePluginId);
  assert.equal(view.calls.find(call => call[0] === "setup")[1], remotePluginId);
  assert.equal(new URL(view.localPluginTemplateManagementUrl(remotePluginId, 1)).pathname, `/plugins/${encodeURIComponent(remotePluginId)}`);
});
for (const summary of [{ remotePluginId: 7, shareContext: { remotePluginId: "plugin_fallback" } },
  { remotePluginId: null, shareContext: { remotePluginId: 7 } }]) await identityCase("invalid identity type is an error", async () => {
  const view = harness();
  await assert.rejects(view.load(detail({ summary: { id: "plugin_cli_must_not_be_guessed", ...summary } })), /插件.*ID.*格式/);
  assert.equal(view.calls.some(call => call[0] === "setup"), false);
});
for (const remotePluginId of ["unknown@other", "unknown@openai-curated", "Gmail@openai-curated"])
  await identityCase(`unknown service alias ${remotePluginId} is an error`, async () => {
    const view = harness();
    await assert.rejects(view.load(detail({ summary: { id: "plugin_cli_must_not_be_guessed", remotePluginId } })), /无法解析/);
    assert.equal(view.calls.some(call => call[0] === "setup"), false, "an unknown alias does not generate a service request or successful empty eligibility");
  });
for (const remotePluginId of ["", "  "]) {
  const view = harness({ service: { readLocalPluginTemplateSetup: async id => {
    assert.equal(id, remotePluginId); throw Error("service rejected plugin path segment");
  } } });
  await assert.rejects(view.load(detail({ summary: { remotePluginId } })), /service rejected plugin path segment/);
}
{
  const view = harness(), result = await view.load(detail({ summary: { remotePluginId: "unknown@other" }, appTemplates: [] }));
  assert.equal(result.templates.length, 0); assert.equal(view.calls.some(call => call[0] === "setup"), false);
}
{
  const view = harness(), result = await view.load(detail({ appTemplates: [template,
    { templateId: "already-materialized", name: "Existing", materializedAppIds: ["app-instance"] }] }));
  assert.equal(result.templates.length, 2, "the snapshot preserves all templates for the real external URL count");
  assert.equal(new URL(view.localPluginTemplateManagementUrl(result.remotePluginId, result.templates.length)).hash, "");
}
for (const read of [null, { type: "apiKey" }]) {
  const view = harness({ config: { accountRead: async () => ({ account: read }) } });
  const result = await view.load();
  assert.deepEqual(plain(result.templates), [template]); assert.equal(result.identity, null); assert.equal(result.hideImplicitApp, false);
  assert.equal(view.calls.length, 0, "without a proven user identity, raw templates survive without service/metadata/directory reads");
  await assert.rejects(view.load(detail(), undefined, identity), /账号或服务路由发生变化/);
  const unknown = await view.load(detail({ summary: { remotePluginId: "unknown@other" } }));
  assert.equal(unknown.remotePluginId, "unknown@other");
  assert.deepEqual(plain(unknown.templates), [template], "disabled unauthenticated setup queries do not parse a legitimate raw market string into a whole-section error");
}
{
  const view = harness({ service: { serviceIdentity: async () => ({ accountId: identity.accountId, userId: "", generation: 5 }) } });
  const result = await view.load(); assert.equal(result.identity, null);
  assert.equal(view.calls.some(call => ["setup", "metadata", "directory"].includes(call[0])), false);
}
for (const key of ["accountId", "userId", "generation"]) {
  const view = harness(); await assert.rejects(view.load(detail(), undefined, { ...identity, [key]: "changed" }), /账号或服务路由发生变化/);
  assert.equal(view.calls.some(call => call[0] === "setup"), false);
}
for (const response of [{ pluginId: "wrong", setupEligibleAppTemplateIds: [] }, { pluginId: legacyMap.gmail },
  { pluginId: legacyMap.gmail, setupEligibleAppTemplateIds: [false] }, null]) {
  const view = harness({ service: { readLocalPluginTemplateSetup: async () => response } });
  await assert.rejects(view.load(), /资格响应格式或所属插件无效/);
}
{
  const view = harness({ service: { readLocalPluginTemplateSetup: async () => { throw Error("setup read failed"); } } });
  await assert.rejects(view.load(), /setup read failed/, "unknown eligibility never degrades to a successful empty set");
}
{
  const view = harness({ service: { readLocalPluginTemplateSetup: async id => ({ pluginId: id, setupEligibleAppTemplateIds: [] }) } });
  const result = await view.load(); assert.deepEqual(plain(result.eligibleTemplateIds), []); assert.equal(result.templates.length, 1);
}
{
  const view = harness({ plugins: { readConnectorMetadata: async () => { throw Error("metadata offline"); }, listAllApps: async () => { throw Error("directory offline"); } } });
  const result = await view.load(detail({ appTemplates: [{ ...template, description: "CLI description", logoUrl: "CLI icon" }] }));
  assert.equal(result.templates[0].description, "CLI description"); assert.equal(result.templates[0].logoUrl, "CLI icon");
  assert.equal(result.warnings.length, 2); assert.deepEqual(plain(result.eligibleTemplateIds), [template.templateId]);
}
{
  const view = harness();
  const templates = Array.from({ length: 103 }, (_, index) => ({ templateId: `asdk_app_${index}`, name: `Template ${index}`, materializedAppIds: [] }));
  await view.load(detail({ apps: [{ id: "original-app", name: "App" }], appTemplates: templates }));
  const ids = view.calls.find(call => call[0] === "metadata")[1];
  assert.equal(ids.length, 104); assert.equal(ids[0], "original-app"); assert.equal(ids[1], "asdk_app_0");
  assert.equal(ids.includes("connector_0"), false, "template metadata IDs remain exact; batching belongs to the real typed reader");
}
for (const toolSummaries of [[], null, undefined, [{ name: "tool" }]]) {
  const view = harness({ plugins: { readConnectorMetadata: async (ids, options) => {
    view.calls.push(["metadata", plain(ids), options]);
    return options.includeTools ? [{ id: ids[0], name: "App", toolSummaries }] : [];
  } } });
  const result = await view.load(detail({ summary: { installPolicySource: "IMPLICIT_CANONICAL_APP" }, apps: [{ id: "only-app", name: "App" }] }));
  assert.equal(result.hideImplicitApp, Array.isArray(toolSummaries) && toolSummaries.length === 0);
  assert.equal(view.calls.filter(call => call[0] === "metadata" && call[2].includeTools === true).length, 1);
}
for (const patch of [{ apps: [{ id: "a", name: "A" }, { id: "b", name: "B" }], summary: { installPolicySource: "IMPLICIT_CANONICAL_APP" } },
  { apps: [{ id: "a", name: "A" }], summary: { installPolicySource: "OTHER" } }]) {
  const view = harness(); assert.equal((await view.load(detail(patch))).hideImplicitApp, false);
  assert.equal(view.calls.some(call => call[0] === "metadata" && call[2].includeTools), false);
}
{
  const view = harness({ plugins: { readConnectorMetadata: async (ids, options) => {
    if (options.includeTools) throw Error("tool summary unavailable");
    return [{ id: ids[0], name: "App", toolSummaries: [] }];
  } } });
  const result = await view.load(detail({ summary: { installPolicySource: "IMPLICIT_CANONICAL_APP" }, apps: [{ id: "only-app", name: "App" }] }));
  assert.equal(result.hideImplicitApp, false, "ordinary metadata's empty tools cannot replace the failed independent includeTools query");
  assert.equal(result.warnings.length, 1);
}
{
  const controller = new AbortController(); controller.abort(); const view = harness();
  await assert.rejects(view.load(detail(), controller.signal), /请求已取消/);
  assert.equal(view.calls.length, 0);
}
for (const code of ["cancelled", "account_changed", "routing_unavailable"]) {
  const view = harness({ plugins: { readConnectorMetadata: async () => { throw Object.assign(Error("scope retired"), { code }); } } });
  await assert.rejects(view.load(), /scope retired/);
}
{
  let actual = identity;
  const view = harness({ service: { serviceIdentity: async () => actual }, plugins: {
    readConnectorMetadata: async () => { actual = { ...identity, generation: 6 }; throw Error("optional metadata failed during an account change"); },
  } });
  await assert.rejects(view.load(), /账号或服务路由发生变化/, "an optional data failure cannot hide concurrent identity retirement");
}
{
  const view = harness({ config: { accountRead: async () => { throw Error("account state unavailable"); } } });
  await assert.rejects(view.load(), /account state unavailable/, "account uncertainty is not an unauthenticated-success fallback");
}
for (const phase of ["setup", "metadata"]) {
  const waiting = deferred(), controller = new AbortController(); let entered = false;
  const overrides = phase === "setup" ? { service: { readLocalPluginTemplateSetup: async () => { entered = true; return waiting.promise; } } }
    : { plugins: { readConnectorMetadata: async () => { entered = true; return waiting.promise; } } };
  const view = harness(overrides), pending = view.load(detail(), controller.signal);
  for (let turn = 0; turn < 40 && !entered; turn++) await Promise.resolve(); assert.equal(entered, true);
  controller.abort(); waiting.resolve(phase === "setup" ? { pluginId: legacyMap.gmail, setupEligibleAppTemplateIds: [] } : []);
  await assert.rejects(pending, /请求已取消/);
}
for (const change of ["account", "identity", "routing"]) {
  let accountReads = 0, identityReads = 0;
  const view = harness({ service: { serviceIdentity: async () => ({ ...identity, generation: change === "identity" && ++identityReads > 1 ? 6 : 5 }) },
    config: { accountRead: async () => {
      const current = ++accountReads > 1;
      return current && change === "account" ? { ...account, account: { type: "apiKey" } }
        : current && change === "routing" ? { ...account, workspaceRouting: { ...account.workspaceRouting, backendOrigin: "https://other.invalid" } } : account;
    } } });
  await assert.rejects(view.load(), /账号或服务路由发生变化/);
}
await assert.rejects(pure.load(detail({ appTemplates: [{ templateId: "bad", name: "Missing required materialized IDs" }] })), /appTemplates/);
assert.deepEqual(identityFailures, [], "raw identity preservation and unknown resolution errors must all pass");
console.log("PASS local template production resolver/enrichment/loader: all 11 legacy IDs, raw web URLs, canonical fallback, original names, real eligibility, unauthenticated raw data, optional warnings, exact metadata targets, includeTools-only hiding and account/routing/cancel isolation; zero writes");
