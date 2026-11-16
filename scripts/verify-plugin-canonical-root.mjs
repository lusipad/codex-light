import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { accountId: "account", userId: "user", generation: 7 };
const raw = () => ({ kind: "canonical", pluginId: "plugin", appId: "connector_real", pluginHeader: { id: "plugin", name: "", version: null, shortDescription: " Raw description ", logoUrl: "https://example.test/light.png", logoUrlDark: null },
  hostedApp: { name: "Hosted", description: null, logoUrl: null, logoUrlDark: "https://example.test/dark.png" }, hostedError: null, nativeEligibility: "unverified" });
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "account" } }, actual = identity, response = raw(), reads = 0, accounts = 0, identities = 0;
let onRead = () => {}, onAccount = () => {}, onIdentity = () => {};
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginCanonicalRoot.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, require(name) {
  if (name === "./config") return { accountRead: async () => { accounts++; onAccount(); return account; } };
  if (name === "./chatgptService") return { serviceIdentity: async () => { identities++; onIdentity(); return actual; }, readPluginCanonicalRoot: async (pluginId, passedIdentity, signal) => { reads++; assert.equal(pluginId, "plugin"); assert.equal(passedIdentity, identity); assert.ok(signal); onRead(); return response; } };
  throw Error(name);
} });
const { decodePluginCanonicalRoot: decode, loadPluginCanonicalRoot: load } = exports;
let value = decode(raw(), "plugin"); assert.equal(value.kind, "canonical"); assert.equal(value.pluginHeader.name, ""); assert.equal(value.pluginHeader.shortDescription, " Raw description ");
assert.equal(value.pluginHeader.version, null); assert.equal(value.hostedApp.logoUrlDark, "https://example.test/dark.png"); assert.equal(value.nativeEligibility, "unverified");
const generic = { ...raw(), kind: "generic", appId: null, hostedApp: null }; assert.equal(decode(generic, "plugin").kind, "generic");
const partial = { ...raw(), hostedApp: null, hostedError: { code: "service_error", message: "Hosted app content unavailable" } }; assert.equal(decode(partial, "plugin").hostedError.code, "service_error");
for (const change of [body => { body.kind = "native"; }, body => { body.pluginId = "other"; }, body => { body.pluginHeader.id = "other"; }, body => { body.appId = null; },
  body => { body.appId = " "; }, body => { body.kind = "generic"; }, body => { body.nativeEligibility = true; }, body => { delete body.nativeEligibility; }, body => { body.pluginHeader.name = null; },
  body => { body.pluginHeader.version = 1; }, body => { delete body.pluginHeader.logoUrl; }, body => { body.pluginHeader.shortDescription = {}; }, body => { body.hostedApp.name = false; },
  body => { body.hostedApp.logoUrlDark = []; }, body => { body.hostedError = { code: "bad", message: "bad" }; }, body => { body.hostedApp = null; }, body => { body.hostedError = []; },
  body => { body.hostedApp = null; body.hostedError = { code: 3, message: "bad" }; }, body => { body.hostedApp = null; body.hostedError = { code: "bad" }; }]) {
  const body = raw(); change(body); assert.throws(() => decode(body, "plugin"));
}
for (const body of [null, [], "root", { ...generic, hostedError: { code: "error", message: "invalid generic warning" } }, { ...generic, hostedApp: raw().hostedApp }]) assert.throws(() => decode(body, "plugin"));
const secrets = raw(); secrets.access_token = "private-secret"; secrets.pluginHeader.creator = "private-secret"; secrets.hostedApp.auth = "private-secret";
assert.ok(!JSON.stringify(decode(secrets, "plugin")).includes("private-secret"), "decoded snapshots contain only the frozen public DTO fields");
const signal = new AbortController().signal;
value = await load("plugin", signal); assert.equal(value.identity, identity); assert.equal(value.kind, "canonical"); assert.equal(reads, 1); assert.ok(accounts >= 2 && identities >= 2);
for (const replacement of [{ ...identity, accountId: "other" }, { ...identity, userId: "other" }, { ...identity, generation: 8 }]) {
  actual = identity; onRead = () => { actual = replacement; }; await assert.rejects(load("plugin", signal), /账号发生变化/);
}
actual = identity; onRead = () => { account = { account: { type: "apiKey" } }; }; await assert.rejects(load("plugin", signal), /账号发生变化/);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "account" } }; onRead = () => { account.workspaceRouting.chatgptAccountId = "other"; }; await assert.rejects(load("plugin", signal), /账号发生变化/);
account = { account: { type: "chatgpt" } }; onRead = () => { throw { code: "service_error", message: "actual failure" }; };
await assert.rejects(load("plugin", signal), error => error.code === "service_error");
onRead = () => { actual = { ...identity, generation: 9 }; throw { code: "not_found" }; }; await assert.rejects(load("plugin", signal), /账号发生变化/, "retired service errors cannot become a current root fallback");
actual = identity; onRead = () => {}; account = { account: { type: "apiKey" } }; const beforeWrongAuth = reads; await assert.rejects(load("plugin", signal), /登录 ChatGPT/); assert.equal(reads, beforeWrongAuth);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "other" } }; await assert.rejects(load("plugin", signal), /账号发生变化/); assert.equal(reads, beforeWrongAuth);
account = { account: { type: "chatgpt" } }; const stopped = new AbortController(); stopped.abort(); const beforeAbort = accounts; await assert.rejects(load("plugin", stopped.signal), /取消/); assert.equal(accounts, beforeAbort);
for (const when of ["account", "identity", "read"]) {
  const controller = new AbortController(); onAccount = () => { if (when === "account") controller.abort(); }; onIdentity = () => { if (when === "identity") controller.abort(); }; onRead = () => { if (when === "read") controller.abort(); };
  await assert.rejects(load("plugin", controller.signal), /取消/);
}
onAccount = onIdentity = onRead = () => {}; response = generic; actual = identity; assert.equal((await load("plugin", signal)).kind, "generic"); response = partial; assert.equal((await load("plugin", signal)).hostedApp, null);
console.log("Plugin canonical root: strict frozen DTO, canonical/generic invariants, independent hosted failure, raw strings/public whitelist, current account/user/generation, routing, cancellation and truthful service errors passed.");
