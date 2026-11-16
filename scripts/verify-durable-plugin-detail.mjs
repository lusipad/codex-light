import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const loadModule = (path, imports) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => { if (name in imports) return imports[name]; throw Error(name); } }); return exports; };
const remote = loadModule("src/remotePlugins.ts", { "./config": {}, "./chatgptService": {} });
const normalizer = loadModule("src/pluginManagementMcp.ts", {});
const identity = { accountId: "account", userId: "user", generation: 1 };
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "account" } }, actual = identity, rawResponse, rowsResponse, onDetail = () => {}, onRows = () => {}, reads = [];
const module = loadModule("src/durablePluginDetail.ts", { "./remotePlugins": remote, "./pluginManagementMcp": normalizer, "./config": { accountRead: async () => account }, "./chatgptService": {
  serviceIdentity: async () => actual,
  readRemotePluginDirectoryDetail: async (...args) => { reads.push("detail"); assert.equal(args[0], "raw-id"); assert.equal(args[1], identity); onDetail(); return rawResponse; },
  readRemotePluginCatalogInventory: async (...args) => { reads.push("inventory"); assert.equal(args[0], identity); onRows(); return rowsResponse; },
} });
const raw = () => ({ id: "raw-id", name: "tool", share_url: "https://example.test/share", release: { version: "2", display_name: "", description: "Release description", onboarding_skill_name: "second", interface: { short_description: null, long_description: "", default_prompt: null },
  skills: [{ name: "first", description: "First skill", interface: { display_name: "First", short_description: "Short", default_prompt: "Try first", icon_large_url: "https://example.test/icon" } }, { name: "second", description: "Second skill" }],
  app_ids: ["asdk_app_A", "connector_A"], app_templates: [
    { template_id: "template1", name: "Template One", description: "Template description", can_setup: true, canonical_connector_id: "connector_A", materialized_app_ids: ["connector_materialized", "asdk_app_USER"], instances: [{ id: "connector_USER", scope: "USER", name: "User instance" }, { id: "connector_WORK", scope: "WORKSPACE", name: "Workspace instance" }] },
    { template_id: "template2", name: "Template Two", can_setup: false, instances: [] },
  ], mcp_servers: [{ key: "actual.server" }] } });
const clone = value => JSON.parse(JSON.stringify(value));
let result = module.decodeDurablePluginDetail(raw(), [], "raw-id"), detail = result.detail;
assert.equal(detail.marketplaceName, "openai-curated-remote"); assert.equal(detail.marketplacePath, null); assert.equal(detail.summary.id, "tool@openai-curated-remote"); assert.equal(detail.summary.remotePluginId, "raw-id");
assert.equal(detail.summary.installed, false); assert.equal(detail.summary.enabled, false); assert.equal(detail.summary.interface.shortDescription, null, "source null must not fall back to release description"); assert.equal(detail.summary.interface.defaultPrompt, null);
assert.equal(detail.summary.interface.displayName, ""); assert.equal(detail.description, "", "long description uses nullish fallback"); assert.equal(detail.shareUrl, "https://example.test/share");
assert.equal(detail.onboardingSkill, null); assert.ok(detail.skills.every(skill => skill.path === null && skill.enabled)); assert.equal(detail.skills[0].interface.iconLargeUrl, "https://example.test/icon"); assert.equal(detail.skills[1].interface, null);
assert.deepEqual(clone(detail.apps.map(app => [app.id, app.name])), [["asdk_app_A", "Template One"], ["connector_USER", "User instance"]]); assert.ok(!detail.apps.some(app => app.id === "connector_materialized" || app.id === "connector_WORK"));
assert.deepEqual(clone(detail.appTemplates[0].materializedAppIds), ["connector_materialized", "asdk_app_USER"]); assert.deepEqual(clone(result.setupEligibleAppTemplateIds), ["template1"]);
assert.deepEqual(clone(detail.mcpServers), ["actual.server"]); assert.deepEqual(clone(detail.hooks), []); assert.equal(detail.scheduledTasks, null);
const installed = raw(); installed.name = "inventory-name"; installed.enabled = true; installed.disabled_skill_names = ["first"]; installed.release.version = "installed-version";
result = module.decodeDurablePluginDetail(raw(), [installed], "raw-id"); assert.equal(result.detail.summary.id, "inventory-name@openai-curated-remote"); assert.equal(result.detail.summary.version, "installed-version"); assert.equal(result.detail.skills[0].enabled, false); assert.equal(result.detail.onboardingSkill.name, "second");
installed.disabled_skill_names = ["second"]; assert.equal(module.decodeDurablePluginDetail(raw(), [installed], "raw-id").detail.onboardingSkill, null);
installed.enabled = false; assert.equal(module.decodeDurablePluginDetail(raw(), [installed], "raw-id").detail.summary.installed, true); assert.equal(module.decodeDurablePluginDetail(raw(), [installed], "raw-id").detail.onboardingSkill, null);
const corruptMatchedSource = raw(); corruptMatchedSource.enabled = "true"; assert.throws(() => module.decodeDurablePluginDetail(corruptMatchedSource, [installed], "raw-id"), "matched inventory cannot hide malformed detail fields");
const defaulted = raw(); defaulted.release.interface.long_description = null; defaulted.release.skills = null; defaulted.release.app_ids = null; defaulted.release.app_templates = null; defaulted.release.mcp_servers = null; delete defaulted.share_url;
detail = module.decodeDurablePluginDetail(defaulted, [], "raw-id").detail; assert.equal(detail.description, "Release description"); assert.equal(detail.shareUrl, null); assert.equal(detail.skills.length, 0); assert.equal(detail.apps.length, 0);
for (const change of [body => { body.id = "other"; }, body => { body.release = null; }, body => { body.release.interface = []; }, body => { body.release.skills = false; }, body => { body.release.skills[0].name = 3; },
  body => { body.release.app_templates[0].instances = {}; }, body => { body.release.app_templates[0].instances[0].scope = null; }, body => { body.release.app_templates[0].can_setup = "true"; }, body => { body.release.app_ids = [1]; },
  body => { body.release.mcp_servers[0].key = null; }, body => { body.release.interface.screenshot_urls = [false]; }, body => { body.share_url = {}; }]) {
  const body = raw(); change(body); assert.throws(() => module.decodeDurablePluginDetail(body, [], "raw-id"));
}
assert.throws(() => module.decodeDurablePluginDetail(raw(), [null], "raw-id")); assert.throws(() => module.decodeDurablePluginDetail(raw(), [raw(), raw()], "raw-id"));
const disabledBad = raw(); disabledBad.disabled_skill_names = false; disabledBad.enabled = true; assert.throws(() => module.decodeDurablePluginDetail(raw(), [disabledBad], "raw-id"));
rawResponse = raw(); rowsResponse = []; const signal = new AbortController().signal;
result = await module.loadDurablePluginDetail("raw-id", signal); assert.equal(result.identity, identity); assert.equal(result.detail.summary.installed, false); assert.deepEqual(reads, ["detail", "inventory"]);
onRows = () => { throw { code: "inventory_failed" }; }; await assert.rejects(module.loadDurablePluginDetail("raw-id", signal), error => error.code === "inventory_failed");
onRows = () => {};
for (const changed of [{ ...identity, generation: 2 }, { ...identity, accountId: "other" }, { ...identity, userId: "other" }]) {
  actual = identity; onDetail = () => { actual = changed; }; await assert.rejects(module.loadDurablePluginDetail("raw-id", signal), /账号发生变化/);
}
actual = identity; onDetail = () => { account = { account: { type: "apiKey" } }; }; await assert.rejects(module.loadDurablePluginDetail("raw-id", signal), /账号发生变化/);
account = { account: { type: "chatgpt" } };
actual = identity; onDetail = () => { throw { code: "not_found" }; }; await assert.rejects(module.loadDurablePluginDetail("raw-id", signal), error => error.code === "not_found");
onDetail = () => {}; account = { account: { type: "apiKey" } }; const before = reads.length; await assert.rejects(module.loadDurablePluginDetail("raw-id", signal), /登录 ChatGPT/); assert.equal(reads.length, before);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "other" } }; await assert.rejects(module.loadDurablePluginDetail("raw-id", signal), /账号发生变化/); assert.equal(reads.length, before);
account = { account: { type: "chatgpt" } }; const stopped = new AbortController(); stopped.abort(); await assert.rejects(module.loadDurablePluginDetail("raw-id", stopped.signal), /取消/); assert.equal(reads.length, before);
const controller = new AbortController(); onRows = () => controller.abort(); await assert.rejects(module.loadDurablePluginDetail("raw-id", controller.signal), /取消/);
console.log("Durable detail W/Y: real inventory summary and disabled skills, nullish UI, service-only skill paths, onboarding, USER template normalization, setup eligibility, strict malformed data, parallel HTTP-only reads and identity/cancellation/error protection passed.");
