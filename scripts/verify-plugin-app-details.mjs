import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const identity = { accountId: "account", userId: "user", generation: 7 };
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "account" } }, actual = identity, calls = 0;
const rawLink = (id, extra = {}) => ({ id, connector_id: "connector_A", owners: [{ type: "USER", id: "user" }], auth_status: "ACTIVE", ...extra });
const raw = () => ({ pluginId: "plugin", pluginName: "Real plugin", appId: "asdk_app_A", connector: { id: "connector_A", name: "App", enable_multi_links: true },
  linksError: null, links: [rawLink("expired", { auth_status: "REAUTH_REQUIRED" }), rawLink("active"), rawLink("hidden", { visibility: "HIDDEN" }), rawLink("implicit_link::A")] });
let response = raw(), onRead = () => {};
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginAppDetails.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, require: name => {
  if (name === "./config") return { accountRead: async () => account };
  if (name === "./pluginManagementMcp") return { canonicalMcpAppId: id => id.startsWith("asdk_app_") ? `connector_${id.slice(9)}` : id };
  if (name === "./chatgptService") return { serviceIdentity: async () => actual, readPluginAppDetails: async (...args) => { calls++; assert.equal(args[0], "plugin"); assert.equal(args[1], "asdk_app_A"); onRead(); return response; } };
  throw Error(name);
} });
const { decodePluginAppDetails: decode, selectPluginAppLinks: select, loadPluginAppDetails: load } = exports;
const { pluginAppProfileIdentity: profileIdentity, pluginAppAccountNickname: nickname, pluginAppAccountIdentity: accountIdentity } = exports;
const identityLink = { ...rawLink("profile"), name: "Work account", connector_name: "Service", owner_profile: { email: " email@test.invalid ", name: "Profile Name", nickname: "Profile Nickname" } };
assert.equal(profileIdentity(identityLink), "email@test.invalid"); assert.equal(nickname(identityLink, "App"), "Work account");
assert.equal(accountIdentity(identityLink, "App", "fallback"), "email@test.invalid");
identityLink.owner_profile.email = "  "; assert.equal(profileIdentity(identityLink), "Profile Name");
identityLink.owner_profile.name = ""; assert.equal(profileIdentity(identityLink), "Profile Nickname");
identityLink.owner_profile = null;
for (const name of ["", " connected ", "SERVICE"]) { identityLink.name = name; assert.equal(nickname(identityLink, "App"), undefined); }
identityLink.name = "App"; assert.equal(nickname(identityLink, "App", "App"), undefined);
identityLink.name = "Work"; assert.equal(accountIdentity(identityLink, "App", "fallback"), "Work");
identityLink.auth_type = "NONE"; assert.equal(accountIdentity(identityLink, " App ", "fallback"), "App");
identityLink.name = "connected"; identityLink.auth_type = "OAUTH"; assert.equal(accountIdentity(identityLink, "App", "fallback"), "fallback");
let data = decode(raw(), "plugin", "asdk_app_A");
let selected = select(data, null);
assert.equal(selected.accounts.length, 2);
assert.equal(selected.hasSystemLinks, true);
assert.equal(selected.selectedLink.id, "active");
assert.equal(select(data, "expired").selectedLink.id, "expired", "explicit expired selection is retained for reconnect presentation");
assert.equal(select(data, "hidden").selectedLink.id, "active");
data.connector.enable_multi_links = false;
assert.equal(select(data, "expired").selectedLink.id, "active", "single-account mode ignores query linkId");
data.links[1].auth_status = "REAUTH_REQUIRED";
assert.equal(select(data, null).selectedLink.id, "expired", "all expired falls back to first visible account");
data.links = [];
assert.equal(select(data, null).selectedLink, undefined);
assert.equal(select(data, null).hasSystemLinks, false);
const nullFields = raw(); nullFields.connector.labels = null; nullFields.connector.enable_multi_links = null;
nullFields.links[0].owner_profile = { nickname: "actual nickname", email: null, picture: null, token: "never-return" };
const nullDetails = decode(nullFields, "plugin", "asdk_app_A");
assert.equal(nullDetails.connector.labels, null); assert.equal(nullDetails.connector.enable_multi_links, null);
assert.equal(nullDetails.links[0].owner_profile.nickname, "actual nickname");
assert.equal(select(nullDetails, "expired").selectedLink.id, "active");
assert.ok(!JSON.stringify(nullDetails).includes("never-return"));
const partial = raw(); partial.links = null; partial.linksError = { code: "service_error", message: "Unable to read accounts" };
const partialDetails = decode(partial, "plugin", "asdk_app_A");
assert.equal(partialDetails.connector.name, "App", "links failure preserves actual metadata");
assert.throws(() => select(partialDetails, null), /无法读取关联账户/, "failed read cannot be interpreted as an empty account list");
for (const change of [body => { body.pluginId = "other"; }, body => { body.appId = "connector_B"; },
  body => { body.connector.id = "connector_B"; }, body => { body.links[0].connector_id = "connector_B"; },
  body => { body.links[0].owners = null; }, body => { body.links[0].apps_privacy_control = ["full_access"]; },
  body => { body.connector.enable_multi_links = "true"; }, body => { body.links[0].owner_profile = []; },
  body => { body.links = null; }, body => { body.linksError = { code: "error", message: "failed" }; }]) {
  const body = raw(); change(body); assert.throws(() => decode(body, "plugin", "asdk_app_A"));
}
const secrets = raw(); secrets.connector.actions = [{ token: "do-not-return" }]; secrets.links[0].access_token = "do-not-return";
assert.ok(!JSON.stringify(decode(secrets, "plugin", "asdk_app_A")).includes("do-not-return"));
for (const permission of [null, "always_ask", "ask_before_writes", "review_important_actions", "full_access"]) {
  const body = raw(); body.links[0].apps_privacy_control = permission;
  assert.equal(decode(body, "plugin", "asdk_app_A").links[0].apps_privacy_control, permission);
}
const signal = new AbortController().signal;
assert.equal((await load("plugin", "asdk_app_A", signal)).identity, identity);
onRead = () => { actual = { ...identity, generation: 8 }; };
await assert.rejects(load("plugin", "asdk_app_A", signal), /账号发生变化/);
actual = identity;
onRead = () => { throw { code: "app_not_in_plugin" }; };
await assert.rejects(load("plugin", "asdk_app_A", signal), error => error.code === "app_not_in_plugin");
onRead = () => { actual = { ...identity, generation: 8 }; throw { code: "app_not_in_plugin" }; };
await assert.rejects(load("plugin", "asdk_app_A", signal), /账号发生变化/, "membership loss from a retired identity cannot redirect the new account");
actual = identity; onRead = () => {}; account = { account: { type: "apiKey" } };
const before = calls; await assert.rejects(load("plugin", "asdk_app_A", signal), /请先登录/); assert.equal(calls, before);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "other" } };
await assert.rejects(load("plugin", "asdk_app_A", signal), /账号发生变化/); assert.equal(calls, before);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(load("plugin", "asdk_app_A", cancelled.signal), /已取消/); assert.equal(calls, before);
const bridgeExports = {}, sent = [];
let wrongIdentity = false;
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: bridgeExports, crypto: { randomUUID: () => "app-read-request" },
  navigator: { userAgent: "private-fixture", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
  localStorage: { getItem: () => "private-device" }, require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
    sent.push({ command, args });
    return { requestId: args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 9 } : identity, body: response };
  } } : {} });
assert.equal(await bridgeExports.readPluginAppDetails("plugin", "asdk_app_A", identity, signal), response);
assert.equal(sent[0].command, "plugin_app_details_read");
assert.equal(sent[0].args.request.pluginId, "plugin");
assert.equal(sent[0].args.request.appId, "asdk_app_A");
assert.equal(sent[0].args.request.expectedIdentity, identity);
wrongIdentity = true;
await assert.rejects(bridgeExports.readPluginAppDetails("plugin", "asdk_app_A", identity, signal), /账号发生变化/);
const beforeCancelled = sent.length;
await assert.rejects(bridgeExports.readPluginAppDetails("plugin", "asdk_app_A", identity, cancelled.signal), /已取消/);
assert.equal(sent.length, beforeCancelled);
assert.ok(fs.readFileSync("src-tauri/src/lib.rs", "utf8").includes("            plugin_app_details_read,"));
console.log("Plugin app details: strict ownership/shape, field allowlist, visible-link selection and account/generation/cancellation isolation passed.");
