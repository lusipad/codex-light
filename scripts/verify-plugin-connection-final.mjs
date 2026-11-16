import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const identity = { accountId: "a", userId: "u", generation: 4 };
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } }, actual = identity;
let body = { requestedConnectorId: "asdk_app_target", result: { kind: "ready" } }, afterRead = () => {};
const sent = [], exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginConnectionFinal.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports, require(name) {
    if (name === "./config") return { accountRead: async () => account };
    if (name === "./chatgptService") return { serviceIdentity: async () => actual, readServicePluginConnectionFinal: async (...args) => { sent.push(args); afterRead(); return body; } };
    throw Error(`Unexpected import ${name}`);
  },
});
const { decodePluginConnectionFinal: decode, readPluginConnectionFinal: read } = exports;
const options = { requiresAppSetup: true, requestedConnectorId: "asdk_app_target" }, signal = new AbortController().signal;
for (const kind of ["ready", "unavailable"]) assert.equal(decode({ requestedConnectorId: options.requestedConnectorId, result: { kind, private: "drop" } }, options.requestedConnectorId).kind, kind);
const app = { id: options.requestedConnectorId, name: "Name", description: null, category: null, installUrl: null };
assert.deepEqual(JSON.parse(JSON.stringify(decode({ ...body, result: { kind: "needsAuth", app: { ...app, private: "drop" } } }, options.requestedConnectorId))), { kind: "needsAuth", app });
for (const value of [null, {}, { ...body, requestedConnectorId: "connector_target" }, { ...body, result: { kind: "success" } },
  ...[{ ...app, id: "connector_target" }, { ...app, name: null }, { ...app, description: 2 }, { ...app, category: "other" }, { ...app, installUrl: "https://example.test" }].map(app => ({ ...body, result: { kind: "needsAuth", app } }))]) assert.throws(() => decode(value, options.requestedConnectorId));
assert.equal((await read(options, identity, signal)).kind, "ready");
assert.equal(sent.length, 1); assert.deepEqual(sent[0], [options, identity, signal]);
actual = { ...identity, generation: 5 }; const count = sent.length;
await assert.rejects(read(options, identity, signal), /账号发生变化/); assert.equal(sent.length, count); actual = identity;
account.workspaceRouting.chatgptAccountId = "foreign"; await assert.rejects(read(options, identity, signal), /账号发生变化/); account.workspaceRouting.chatgptAccountId = "a";
afterRead = () => { actual = { ...identity, userId: "foreign" }; };
await assert.rejects(read(options, identity, signal), /账号发生变化/); actual = identity;
const controller = new AbortController(); afterRead = () => controller.abort();
await assert.rejects(read(options, identity, controller.signal), /取消/); afterRead = () => {};
const stopped = new AbortController(); stopped.abort(); const before = sent.length;
await assert.rejects(read(options, identity, stopped.signal), /取消/); assert.equal(sent.length, before);
for (const value of [{ requestedConnectorId: "" }, { requiresAppSetup: "true" }, { requestedConnectorId: 1 }]) await assert.rejects(read(value, identity, signal));
body = { requestedConnectorId: null, result: { kind: "ready" } };
assert.equal((await read({}, identity, signal)).kind, "ready", "no setup preserves original options; no app is substituted");
assert.deepEqual(sent.at(-1)[0], {});
const bridge = {}, requests = [];
let sequence = 0, wrongIdentity = false, wrongRequest = false, waiting;
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: bridge, crypto: { randomUUID: () => `auth-final-${++sequence}` }, navigator: { userAgent: "fixture", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
  localStorage: { getItem: () => "private-device" }, require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
    requests.push({ command, args }); if (command === "chatgpt_service_cancel") return;
    return waiting ? waiting.promise : { requestId: wrongRequest ? "foreign-request" : args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 5 } : identity, body };
  } } : {},
});
await bridge.readServicePluginConnectionFinal({ ...options, requestId: "smuggled", expectedIdentity: { accountId: "foreign" }, url: "https://example.test" }, identity, signal);
let request = requests.at(-1); assert.equal(request.command, "plugin_connection_final_read");
assert.equal(request.args.request.requestId, "auth-final-1"); assert.equal(request.args.request.expectedIdentity, identity);
assert.equal(request.args.request.requestedConnectorId, options.requestedConnectorId); assert.equal(request.args.request.requiresAppSetup, true);
assert.equal("url" in request.args.request, false);
await bridge.readServicePluginConnectionFinal({}, identity, signal); request = requests.at(-1);
assert.equal("requiresAppSetup" in request.args.request, false); assert.equal("requestedConnectorId" in request.args.request, false);
wrongIdentity = true; await assert.rejects(bridge.readServicePluginConnectionFinal(options, identity, signal), /账号发生变化/); wrongIdentity = false;
wrongRequest = true; await assert.rejects(bridge.readServicePluginConnectionFinal(options, identity, signal), /账号发生变化/); wrongRequest = false;
const beforeStopped = requests.length; await assert.rejects(bridge.readServicePluginConnectionFinal(options, identity, stopped.signal), /取消/); assert.equal(requests.length, beforeStopped);
let resolve; waiting = { promise: new Promise(done => resolve = done) }; const inflight = new AbortController();
const operation = bridge.readServicePluginConnectionFinal(options, identity, inflight.signal), active = requests.at(-1);
inflight.abort(); assert.equal(requests.at(-1).command, "chatgpt_service_cancel"); assert.equal(requests.at(-1).args.requestId, active.args.request.requestId);
resolve({ requestId: active.args.request.requestId, identity, body }); await assert.rejects(operation, /取消/);
console.log("PASS final connection client: strict original target/result, no link success inference, account/routing/generation retirement and cancellation");
