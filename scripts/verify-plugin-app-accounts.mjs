import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
function load(file, imports, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => imports[name], ...extra });
  return exports;
}
const canonicalMcpAppId = id => id.startsWith("asdk_app_") ? `connector_${id.slice(9)}` : id;
const helpers = load("src/pluginAppDetails.ts", { "./config": {}, "./chatgptService": {}, "./pluginManagementMcp": { canonicalMcpAppId } });
const identity = { accountId: "account", userId: "user", generation: 1 };
const raw = (name = "Old") => ({ pluginId: "plugin", pluginName: "Actual plugin", pluginStatus: "DISABLED_BY_ADMIN", appId: "connector_A",
  connector: { id: "asdk_app_A", name: "App", enable_multi_links: true, supported_auth: [{ type: "OAUTH" }] }, linksError: null,
  links: [{ id: "link/a?%", connector_id: "connector_A", name, owners: [{ type: "USER", id: "other-user" }], auth_type: "OAUTH", auth_status: "REAUTH_REQUIRED" }] });
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "account" } }, actual = identity;
let reply = { verification: "confirmed", readback: raw("New") }, onWrite = () => {};
const writes = [], values = new Map();
const api = load("src/pluginAppAccounts.ts", { "./config": { accountRead: async () => account },
  "./chatgptService": { serviceIdentity: async () => actual, renamePluginAppAccount: async (...args) => { writes.push(args); onWrite(); return reply; } },
  "./pluginAppDetails": helpers, "./pluginManagementMcp": { canonicalMcpAppId },
}, { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
const { pluginAppAccountsPresentation: presentation, persistPluginAppSelection: persist, savePluginAppAccountName: save } = api;
const details = helpers.decodePluginAppDetails(raw(), "plugin", "asdk_app_A"), accounts = details.links;
assert.equal(details.connector.id, "asdk_app_A", "persistence identity retains actual metadata ID");
assert.equal(presentation(details, accounts).canRename, true, "multi rename does not invent owner, personal, admin or reauth gates");
for (const type of ["NONE", "API_KEY"]) {
  const d = { ...details, connector: { ...details.connector, supported_auth: [{ type }] } };
  assert.equal(presentation(d, [{ ...accounts[0], auth_type: type }]).visible, false);
  assert.equal(presentation(d, accounts).visible, true, "a real reauth-capable link preserves the settings account section");
}
assert.equal(presentation({ ...details, connector: { ...details.connector, supported_auth: undefined } }, accounts).canRename, false, "missing metadata cannot fabricate OAuth eligibility");
assert.equal(presentation({ ...details, connector: { ...details.connector, enable_multi_links: false } }, accounts).canRename, false);
const apple = "connector_6a99cb6846448190875813bf1e8e5504", appleLink = { ...accounts[0], connector_id: apple, auth_type: "API_KEY", auth_strategy_id: "apple.icloud_app_specific_password" };
assert.equal(presentation({ ...details, connector: { ...details.connector, id: apple, supported_auth: undefined } }, [appleLink]).canRename, true);
assert.equal(presentation({ ...details, connector: { ...details.connector, id: apple, supported_auth: [{ type: "NONE" }] } }, [appleLink]).visible, true);
assert.equal(presentation({ ...details, connector: { ...details.connector, id: `asdk_app_${apple.slice(10)}`, supported_auth: undefined } }, [appleLink]).canRename, false, "provider helper itself is exact raw ID, not a guessed Apple alias");
for (let i = 0; i < 101; i++) persist(identity, `raw-app-${i}`, `link-${i}`);
const readStore = () => JSON.parse(values.get("selected-plugin-links-v1"));
let store = readStore(); assert.equal(Object.keys(store).length, 100); assert.ok(!(JSON.stringify(["account", "user", "raw-app-0"]) in store));
persist(identity, "raw-app-1", "updated"); persist(identity, "raw-app-101", "new"); store = readStore();
assert.ok(JSON.stringify(["account", "user", "raw-app-1"]) in store); assert.ok(!(JSON.stringify(["account", "user", "raw-app-2"]) in store));
persist(identity, "raw-app-1", null); assert.ok(!(JSON.stringify(["account", "user", "raw-app-1"]) in readStore()));
persist(identity, "asdk_app_A", "raw"); persist(identity, "connector_A", "canonical"); persist({ ...identity, userId: "other" }, "asdk_app_A", "other");
assert.equal(readStore()[JSON.stringify(["account", "user", "asdk_app_A"])], "raw");
assert.equal(readStore()[JSON.stringify(["account", "user", "connector_A"])], "canonical");
const signal = new AbortController().signal, snapshot = { identity, details };
let result = await save(snapshot, "asdk_app_A", accounts[0].id, " New ", signal);
assert.equal(result.confirmed, true); assert.equal(writes[0][1], "asdk_app_A"); assert.equal(writes[0][3], "New");
reply = { verification: "confirmed", readback: raw("Other") }; assert.equal((await save(snapshot, "asdk_app_A", accounts[0].id, "New", signal)).confirmed, false, "ACK marker cannot override different actual readback");
reply = { verification: "pending", readback: null }; assert.equal((await save(snapshot, "asdk_app_A", accounts[0].id, "New", signal)).confirmed, false);
const count = writes.length;
for (const name of ["", "  ", "😀".repeat(65)]) await assert.rejects(save(snapshot, "asdk_app_A", accounts[0].id, name, signal));
await assert.rejects(save(snapshot, "other-app", accounts[0].id, "New", signal));
await assert.rejects(save(snapshot, "asdk_app_A", "missing", "New", signal)); assert.equal(writes.length, count);
actual = { ...identity, generation: 2 }; await assert.rejects(save(snapshot, "asdk_app_A", accounts[0].id, "New", signal), /账号发生变化/); assert.equal(writes.length, count);
actual = identity; reply = { verification: "confirmed", readback: raw("New") }; onWrite = () => { actual = { ...identity, userId: "other" }; };
await assert.rejects(save(snapshot, "asdk_app_A", accounts[0].id, "New", signal), /账号发生变化/);
const cancelled = new AbortController(); cancelled.abort(); const before = writes.length;
await assert.rejects(save(snapshot, "asdk_app_A", accounts[0].id, "New", cancelled.signal), /已取消/); assert.equal(writes.length, before);
console.log("Plugin app accounts: exact auth visibility, source rename eligibility, raw persisted namespace/100 last writes, actual readback, no bogus ACK, original request IDs and identity/cancellation checks passed.");
