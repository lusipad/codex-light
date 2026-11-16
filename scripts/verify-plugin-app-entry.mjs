import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => imports[name] });
  return exports;
}
const identity = { accountId: "account", userId: "user", generation: 4 }, appId = "asdk_app_real";
const connector = { id: "connector_real", name: "Metadata name" };
const standalone = () => ({ appId, app: { id: appId, name: "Hosted name", description: "Hosted description", logoUrl: null, logoUrlDark: null }, connector, metadataError: null });
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: identity.accountId } }, actual = identity;
let association = { appId, pluginId: "real/plugin" }, content = standalone(), onResolve = () => {}, onRead = () => {};
const calls = [], api = { serviceIdentity: async () => actual,
  resolvePluginAppEntry: async (id, scope) => { calls.push(["resolve", id, scope]); onResolve(); return association; },
  readStandalonePluginApp: async (id, scope) => { calls.push(["standalone", id, scope]); onRead(); return content; } };
const helpers = load("src/pluginAppDetails.ts", { "./config": {}, "./chatgptService": {}, "./pluginManagementMcp": { canonicalMcpAppId: id => id.replace(/^asdk_app_/, "connector_") } });
const { loadPluginAppEntry: read, decodePluginAppAssociation: decode, decodeStandalonePluginApp: decodeApp } = load("src/pluginAppEntry.ts", {
  "./config": { accountRead: async () => account }, "./chatgptService": api, "./pluginAppDetails": helpers,
});
const signal = new AbortController().signal;
let result = await read(appId, signal);
assert.equal(result.kind, "plugin"); assert.equal(result.pluginId, "real/plugin");
assert.equal(calls.filter(call => call[0] === "standalone").length, 0, "associated apps never enter standalone management");
association = { appId, pluginId: null }; result = await read(appId, signal);
assert.equal(result.kind, "app"); assert.equal(result.app.name, "Hosted name"); assert.equal(result.app.id, appId);
assert.equal(result.connector.id, "connector_real"); assert.equal(calls.at(-1)[1], appId);
content = { ...standalone(), connector: null, metadataError: { code: "service_error", message: "Metadata unavailable" } };
result = await read(appId, signal); assert.equal(result.app.name, "Hosted name"); assert.equal(result.connector, null); assert.equal(result.metadataError.code, "service_error");
for (const raw of [null, "plugin", {}, { appId }, { appId, pluginId: false }, { appId, pluginId: " " }, { appId: "other", pluginId: null }]) assert.throws(() => decode(raw, appId));
for (const change of [body => { body.app.id = "other"; }, body => { body.app.name = false; }, body => { delete body.app.logoUrl; },
  body => { body.connector = { connector }; }, body => { body.metadataError = { code: "error", message: "failed" }; }]) {
  const body = standalone(); change(body); assert.throws(() => decodeApp(body, appId));
}
const unrelated = { ...standalone(), secret: "never-return", app: { ...standalone().app, access_token: "never-return" } };
assert.ok(!JSON.stringify(decodeApp(unrelated, appId)).includes("never-return"));
const before = calls.filter(call => call[0] === "standalone").length;
association = { appId }; await assert.rejects(read(appId, signal));
assert.equal(calls.filter(call => call[0] === "standalone").length, before, "missing association cannot become null");
association = { appId, pluginId: null }; content = standalone();
onResolve = () => { throw Error("service unavailable"); };
await assert.rejects(read(appId, signal), /service unavailable/);
assert.equal(calls.filter(call => call[0] === "standalone").length, before);
const cancelled = new AbortController(); onResolve = () => cancelled.abort();
await assert.rejects(read(appId, cancelled.signal), /已取消/);
assert.equal(calls.filter(call => call[0] === "standalone").length, before);
onResolve = () => {}; onRead = () => { actual = { ...identity, generation: 5 }; };
await assert.rejects(read(appId, signal), /账号发生变化/);
actual = identity; onRead = () => {}; account = { account: { type: "apiKey" } };
const count = calls.length; await assert.rejects(read(appId, signal), /请先登录/); assert.equal(calls.length, count);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "other" } };
await assert.rejects(read(appId, signal), /账号发生变化/); assert.equal(calls.length, count);
let wrongIdentity = false;
const sent = [], serviceExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: serviceExports, crypto: { randomUUID: () => "entry-request" }, navigator: { userAgent: "private", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
    localStorage: { getItem: () => "private-device" }, require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
      sent.push({ command, args }); return { requestId: args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 8 } : identity, body: association };
    } } : {} });
await serviceExports.resolvePluginAppEntry(appId, identity, signal); await serviceExports.readStandalonePluginApp(appId, identity, signal);
assert.deepEqual(sent.map(call => call.command), ["plugin_app_resolve", "plugin_app_standalone_read"]);
assert.ok(sent.every(call => call.args.request.appId === appId && call.args.request.expectedIdentity === identity && !("pluginId" in call.args.request)));
wrongIdentity = true; await assert.rejects(serviceExports.resolvePluginAppEntry(appId, identity, signal), /账号发生变化/);
console.log("Plugin app entry: actual association/null split, strict response, hosted fallback, independent metadata error, scoped IPC, no CLI substitute, cancellation and account isolation passed.");
