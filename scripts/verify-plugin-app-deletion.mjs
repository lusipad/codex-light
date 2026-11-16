import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/pluginAppDeletion.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const normalizer = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginManagementMcp.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: normalizer });
const identity = { accountId: "a", userId: "u", generation: 3 }, snapshot = { appId: "asdk_app_actual", metadata: { id: "connector_actual", name: "Private name" }, canDelete: true, deleteDisabled: false, identity };
const status = presence => ({ appId: "connector_actual", metadataId: "connector_actual", presence });
const mutation = (delivery, readback, verification = "confirmed") => ({ body: { delivery, warningCode: null }, verification, readback });
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } }, actual = identity, deleteResult = mutation("accepted", status("not_found")), readResult = status("not_found");
let onDelete = () => {}, onStatus = () => {}, onAccount = () => {}, onIdentity = () => {}; const deletes = [], reads = [];
const exports = {};
vm.runInNewContext(source, { exports, require(name) {
  if (name === "./config") return { accountRead: async () => { onAccount(); return account; } };
  if (name === "./pluginManagementMcp") return normalizer;
  if (name === "./chatgptService") return { serviceIdentity: async () => { onIdentity(); return actual; },
    deleteServicePluginApp: async (...args) => { deletes.push(args); onDelete(); return deleteResult; },
    readServicePluginAppDeleteStatus: async (...args) => { reads.push(args); onStatus(); return readResult; } };
  throw Error(`Unexpected management/root/CLI import ${name}`);
} });
const { decodePluginAppDeleteStatus: decode, deletePluginApp: remove, readPluginAppDeletionStatus: read } = exports, signal = new AbortController().signal;
for (const presence of ["present", "not_found"]) assert.equal(decode(status(presence), snapshot.appId, snapshot.metadata.id).presence, presence);
assert.deepEqual(JSON.parse(JSON.stringify(decode({ ...status("present"), token: "secret", owners: ["secret"] }, snapshot.appId, snapshot.metadata.id))), status("present"));
for (const body of [null, {}, [], { ...status("present"), appId: "foreign" }, { ...status("present"), metadataId: "asdk_app_actual" }, { ...status("present"), presence: null }, { ...status("present"), presence: "deleted" }]) assert.throws(() => decode(body, snapshot.appId, snapshot.metadata.id));
let result = await remove(snapshot, signal); assert.equal(result.confirmed, true); assert.equal(result.delivery, "accepted"); assert.equal(deletes.length, 1);
assert.equal(deletes[0][0], snapshot.appId); assert.equal(deletes[0][1], snapshot.metadata.id); assert.equal(deletes[0][2], identity); assert.equal(deletes[0][3], signal);
for (const response of [mutation("rejected", status("not_found")), mutation("accepted", status("present")), mutation("unknown", null, "pending"), mutation("accepted", { ...status("not_found"), metadataId: "foreign" }), mutation("accepted", { presence: "not_found" })]) {
  deleteResult = response; const before = deletes.length; result = await remove(snapshot, signal); assert.equal(result.confirmed, false); assert.equal(deletes.length, before + 1, "unconfirmed result is never automatically retried");
}
deleteResult = mutation("unknown", null, "pending"); result = await remove(snapshot, signal); const beforeRead = deletes.length;
assert.equal((await read({ ...snapshot, canDelete: false, deleteDisabled: true }, signal)).presence, "not_found"); assert.equal(deletes.length, beforeRead, "read-only recovery does not require current owner/delete eligibility or repeat DELETE");
onStatus = () => { throw { code: "not_found", status: 404 }; }; await assert.rejects(read(snapshot, signal), error => error.code === "not_found", "an exception 404 is not a typed not_found confirmation"); onStatus = () => {};
const denied = deletes.length; await assert.rejects(remove({ ...snapshot, canDelete: false }, signal)); await assert.rejects(remove({ ...snapshot, deleteDisabled: true }, signal)); assert.equal(deletes.length, denied);
for (const changed of [{ ...identity, accountId: "other" }, { ...identity, userId: "other" }, { ...identity, generation: 4 }]) {
  actual = identity; onDelete = () => { actual = changed; }; await assert.rejects(remove(snapshot, signal), /账号发生变化/);
}
actual = identity; onDelete = () => { throw { code: "forbidden" }; }; await assert.rejects(remove(snapshot, signal), error => error.code === "forbidden");
onDelete = () => { actual = { ...identity, generation: 5 }; throw { code: "forbidden" }; }; await assert.rejects(remove(snapshot, signal), /账号发生变化/); actual = identity; onDelete = () => {};
onStatus = () => { actual = { ...identity, userId: "retired" }; }; await assert.rejects(read(snapshot, signal), /账号发生变化/); actual = identity; onStatus = () => {};
account = { account: { type: "apiKey" } }; const beforeDenied = deletes.length; await assert.rejects(remove(snapshot, signal), /账号发生变化/); assert.equal(deletes.length, beforeDenied);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "foreign" } }; await assert.rejects(read(snapshot, signal), /账号发生变化/);
account = { account: { type: "chatgpt" } }; const stopped = new AbortController(); stopped.abort(); const beforeCancelled = deletes.length; await assert.rejects(remove(snapshot, stopped.signal), /取消/); assert.equal(deletes.length, beforeCancelled);
const inFlight = new AbortController(); onDelete = () => inFlight.abort(); await assert.rejects(remove(snapshot, inFlight.signal), /取消/); onDelete = () => {};
let serial = 0, wrongIdentity = false, wrongRequest = false, waiting = null;
const sent = [], bridgeExports = {}, rawAppId = "asdk_app/raw?中%2F", rawMetadataId = "connector/raw?metadata%2F中";
const envelope = (command, args) => ({ requestId: wrongRequest ? "foreign-request" : args.request.requestId, identity: wrongIdentity ? { ...identity, userId: "foreign" } : identity,
  ...(command === "plugin_app_delete" ? mutation("accepted", { appId: rawAppId, metadataId: rawMetadataId, presence: "not_found" }) : { body: { appId: rawAppId, metadataId: rawMetadataId, presence: "not_found" } }) });
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: bridgeExports, crypto: { randomUUID: () => `delete-fixture-${++serial}` }, navigator: { userAgent: "private-test", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
  localStorage: { getItem: () => "private-device" }, require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
    sent.push({ command, args }); if (command === "chatgpt_service_cancel") return;
    return waiting ? waiting.promise : envelope(command, args);
  } } : {},
});
for (const [method, command] of [["deleteServicePluginApp", "plugin_app_delete"], ["readServicePluginAppDeleteStatus", "plugin_app_delete_status_read"]]) {
  await bridgeExports[method](rawAppId, rawMetadataId, identity, signal); const request = sent.at(-1);
  assert.equal(request.command, command); assert.equal(request.args.request.appId, rawAppId); assert.equal(request.args.request.metadataId, rawMetadataId); assert.equal(request.args.request.expectedIdentity, identity); assert.match(request.args.request.requestId, /^delete-fixture-/);
  assert.equal("url" in request.args.request, false); assert.equal("body" in request.args.request, false);
  wrongIdentity = true; await assert.rejects(bridgeExports[method](rawAppId, rawMetadataId, identity, signal), /账号发生变化/); wrongIdentity = false;
  wrongRequest = true; await assert.rejects(bridgeExports[method](rawAppId, rawMetadataId, identity, signal), /账号发生变化/); wrongRequest = false;
  const before = sent.length; await assert.rejects(bridgeExports[method](rawAppId, rawMetadataId, identity, stopped.signal), /取消/); assert.equal(sent.length, before);
  let resolve; waiting = { promise: new Promise(done => resolve = done) }; const controller = new AbortController(), operation = bridgeExports[method](rawAppId, rawMetadataId, identity, controller.signal), activeRequest = sent.at(-1);
  controller.abort(); assert.equal(sent.at(-1).command, "chatgpt_service_cancel"); assert.equal(sent.at(-1).args.requestId, activeRequest.args.request.requestId);
  resolve(envelope(command, activeRequest.args)); await assert.rejects(operation, /取消/); waiting = null;
}
console.log("Standalone app deletion client: fixed raw targets, strict public presence DTO, exact not-found confirmation, rejection/unknown preservation without replay, read-only recovery and account/routing/abort protection passed.");
