import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/pluginAppManagement.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const normalizer = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginManagementMcp.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: normalizer, require: name => { throw Error(name); } });
const identity = { accountId: "account", userId: "user", generation: 4 }, raw = () => ({ appId: "connector_actual", metadata: { id: "asdk_app_actual", name: "Actual metadata" }, canEditName: true, canEditDescription: false, canDelete: false, deleteDisabled: false, deleteRestriction: null, canPublish: false });
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "account" } }, actual = identity, response = raw(), reads = 0, accounts = 0, identities = 0;
let onRead = () => {}, onAccount = () => {}, onIdentity = () => {};
let onWrite = () => {}, writeResult, writes = [];
const exports = {};
vm.runInNewContext(source, { exports, require(name) {
  if (name === "./config") return { accountRead: async () => { accounts++; onAccount(); return account; } };
  if (name === "./pluginManagementMcp") return normalizer;
  if (name === "./chatgptService") return { serviceIdentity: async signal => { assert.ok(signal); identities++; onIdentity(); return actual; }, readPluginAppManagement: async (appId, passed, signal) => { reads++; assert.equal(appId, "asdk_app_actual"); assert.equal(passed, identity); assert.ok(signal); onRead(); return response; },
    updatePluginAppMetadata: async (...args) => { writes.push(args); onWrite(); return writeResult; } };
  throw Error(`Unexpected CLI/PATCH/UI import ${name}`);
} });
const { decodePluginAppManagement: decode, loadPluginAppManagement: load } = exports;
let data = decode(raw(), "asdk_app_actual"); assert.equal(data.appId, "connector_actual"); assert.equal(data.metadata.id, "asdk_app_actual"); assert.equal(data.metadata.name, "Actual metadata"); assert.equal(Object.hasOwn(data.metadata, "description"), false);
for (const description of [null, "", "  exact unnormalized text\n "]) { const body = raw(); body.metadata.description = description; assert.equal(decode(body, "asdk_app_actual").metadata.description, description); }
const empty = raw(); empty.metadata.name = ""; assert.equal(decode(empty, "asdk_app_actual").metadata.name, "");
const secret = raw(); secret.metadata.owners = [{ id: "private-secret" }]; secret.metadata.token = "private-secret"; secret.secret = "private-secret";
assert.ok(!JSON.stringify(decode(secret, "asdk_app_actual")).includes("private-secret"));
for (const field of ["canDelete", "deleteDisabled", "canPublish"]) for (const value of [undefined, null, "true", 1]) {
  const body = raw(); if (value === undefined) delete body[field]; else body[field] = value; assert.throws(() => decode(body, "asdk_app_actual"), `${field} must be an explicit boolean`);
}
for (const value of [undefined, false, "arbitrary", {}]) { const body = raw(); if (value === undefined) delete body.deleteRestriction; else body.deleteRestriction = value; assert.throws(() => decode(body, "asdk_app_actual")); }
for (const deleteRestriction of [null, "tenant_catalog", "content_unavailable"]) assert.equal(decode({ ...raw(), deleteRestriction }, "asdk_app_actual").deleteRestriction, deleteRestriction);
const publishUrl = exports.pluginAppWorkspacePublishUrl;
assert.equal(publishUrl(decode(raw(), "asdk_app_actual")), null);
for (const id of ["asdk_app_actual", "connector/raw?中%2F #&="]) {
  const body = { ...raw(), appId: id, metadata: { id, name: "private display name" }, canPublish: true }, snapshot = decode(body, id);
  assert.equal(publishUrl(snapshot), `https://chatgpt.com/admin/apps#drafts?publish=${encodeURIComponent(id)}`);
  assert.ok(!publishUrl(snapshot).includes("private display name"));
}
for (const change of [body => { body.appId = "foreign"; }, body => { body.metadata.id = "foreign"; }, body => { body.appId = ""; }, body => { body.metadata.id = ""; }, body => { body.metadata.name = null; },
  body => { body.metadata.description = 1; }, body => { body.metadata.description = undefined; }, body => { body.canEditName = "true"; }, body => { delete body.canEditDescription; }, body => { body.canEditDescription = null; }, body => { body.metadata = []; }]) {
  const body = raw(); change(body); assert.throws(() => decode(body, "asdk_app_actual"));
}
for (const body of [null, [], {}, { ...raw(), metadata: null }]) assert.throws(() => decode(body, "asdk_app_actual"));
const signal = new AbortController().signal;
data = await load("asdk_app_actual", signal); assert.equal(data.identity, identity); assert.equal(data.canEditName, true); assert.equal(reads, 1); assert.ok(accounts >= 2 && identities >= 2);
for (const changed of [{ ...identity, accountId: "other" }, { ...identity, userId: "other" }, { ...identity, generation: 5 }]) {
  actual = identity; onRead = () => { actual = changed; }; await assert.rejects(load("asdk_app_actual", signal), /账号发生变化/);
}
actual = identity; onRead = () => { account = { account: { type: "apiKey" } }; }; await assert.rejects(load("asdk_app_actual", signal), /账号发生变化/);
account = { account: { type: "chatgpt" } }; onRead = () => { throw { code: "forbidden", message: "real service rejection" }; }; await assert.rejects(load("asdk_app_actual", signal), error => error.code === "forbidden");
onRead = () => { actual = { ...identity, generation: 6 }; throw { code: "not_found" }; }; await assert.rejects(load("asdk_app_actual", signal), /账号发生变化/, "retired errors cannot replace the current app state");
actual = identity; onRead = () => {}; account = { account: { type: "apiKey" } }; const before = reads; await assert.rejects(load("asdk_app_actual", signal), /登录 ChatGPT/); assert.equal(reads, before);
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "other" } }; await assert.rejects(load("asdk_app_actual", signal), /账号发生变化/); assert.equal(reads, before);
account = { account: { type: "chatgpt" } }; const stopped = new AbortController(); stopped.abort(); const beforeAccounts = accounts; await assert.rejects(load("asdk_app_actual", stopped.signal), /取消/); assert.equal(accounts, beforeAccounts);
for (const when of ["account", "identity", "read"]) {
  const controller = new AbortController(); onAccount = () => { if (when === "account") controller.abort(); }; onIdentity = () => { if (when === "identity") controller.abort(); }; onRead = () => { if (when === "read") controller.abort(); };
  await assert.rejects(load("asdk_app_actual", controller.signal), /取消/);
}
onAccount = onIdentity = onRead = () => {}; actual = identity; account = { account: { type: "chatgpt" } };
const save = exports.savePluginAppMetadata, initial = { ...decode({ ...raw(), canEditDescription: true }, "asdk_app_actual"), identity };
const savedReadback = (field, value) => ({ ...raw(), canEditDescription: true, metadata: { ...raw().metadata, [field]: value } });
const mutation = (delivery, readback, verification = "confirmed") => ({ body: { delivery, warningCode: null }, readback, verification });
writeResult = mutation("accepted", savedReadback("name", "New name"));
let saved = await save(initial, "name", "  New name  ", signal); assert.equal(saved.confirmed, true); assert.equal(saved.snapshot.metadata.name, "New name");
assert.equal(writes[0][0], initial.appId); assert.equal(writes[0][1], initial.metadata.id, "write retains the actual raw metadata ID"); assert.equal(writes[0][2], "name"); assert.equal(writes[0][3], "New name"); assert.equal(writes[0][4], identity);
for (const value of ["", "  original whitespace\n ", "😀".repeat(65)]) {
  writeResult = mutation("accepted", savedReadback("description", value)); saved = await save(initial, "description", value, signal); assert.equal(saved.confirmed, true); assert.equal(writes.at(-1)[3], value);
}
const longName = "😀".repeat(65); writeResult = mutation("accepted", savedReadback("name", longName)); assert.equal((await save(initial, "name", longName, signal)).confirmed, true, "app names do not inherit the account nickname 64-code-point limit");
const beforeInvalidSave = writes.length; await assert.rejects(save(initial, "name", "  ", signal)); await assert.rejects(save({ ...initial, canEditName: false }, "name", "Other", signal));
await assert.rejects(save({ ...initial, canEditDescription: false }, "description", "Other", signal)); await assert.rejects(save(initial, "name", initial.metadata.name, signal)); assert.equal(writes.length, beforeInvalidSave);
for (const result of [mutation("unknown", null, "pending"), mutation("accepted", savedReadback("name", "Old")), mutation("rejected", savedReadback("name", "Target")),
  mutation("accepted", { ...savedReadback("name", "Target"), appId: "foreign" }), mutation("accepted", { ...savedReadback("name", "Target"), metadata: { id: "connector_actual", name: "Target" } })]) {
  writeResult = result; const count = writes.length; saved = await save(initial, "name", "Target", signal); assert.equal(saved.confirmed, false); assert.equal(writes.length, count + 1, "unknown or bad readback never resubmits");
}
writeResult = mutation("accepted", savedReadback("name", "Target")); onWrite = () => { actual = { ...identity, generation: 9 }; }; await assert.rejects(save(initial, "name", "Target", signal), /账号发生变化/);
actual = identity; onWrite = () => {}; const saveController = new AbortController(); onWrite = () => saveController.abort(); await assert.rejects(save(initial, "name", "Target", saveController.signal), /取消/); onWrite = () => {};
actual = { ...identity, userId: "other" }; const beforeStaleSave = writes.length; await assert.rejects(save(initial, "name", "Target", signal), /账号发生变化/); assert.equal(writes.length, beforeStaleSave); actual = identity;
let serial = 0, wrongIdentity = false, wrongRequest = false, waiting = null;
const sent = [], serviceExports = {}, routeId = "asdk_app/raw?%2F中";
const envelope = args => ({ requestId: wrongRequest ? "foreign-request" : args.request.requestId, identity: wrongIdentity ? { ...identity, generation: 99 } : identity,
  ...(args.request.operation ? mutation("accepted", savedReadback(args.request.operation, args.request.value)) : { body: raw() }) });
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: serviceExports, crypto: { randomUUID: () => `management-request-${++serial}` }, navigator: { userAgent: "private-test", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
  localStorage: { getItem: () => "private-device" }, require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
    sent.push({ command, args }); if (command === "chatgpt_service_cancel") return;
    if (waiting) return waiting.promise;
    return envelope(args);
  } } : {},
});
assert.deepEqual(await serviceExports.readPluginAppManagement(routeId, identity, signal), raw());
const request = sent.at(-1); assert.equal(request.command, "plugin_app_management_read"); assert.equal(request.args.request.appId, routeId, "IPC preserves the raw route ID for backend single-segment encoding");
assert.equal(request.args.request.expectedIdentity, identity); assert.match(request.args.request.requestId, /^management-request-/); assert.equal(request.args.request.profile.language, "zh-CN");
assert.equal("url" in request.args.request, false); assert.equal("operation" in request.args.request, false);
wrongIdentity = true; await assert.rejects(serviceExports.readPluginAppManagement(routeId, identity, signal), /账号发生变化/); wrongIdentity = false;
wrongRequest = true; await assert.rejects(serviceExports.readPluginAppManagement(routeId, identity, signal), /账号发生变化/); wrongRequest = false;
const beforeStoppedBridge = sent.length; await assert.rejects(serviceExports.readPluginAppManagement(routeId, identity, stopped.signal), /取消/); assert.equal(sent.length, beforeStoppedBridge);
let resolveWaiting; waiting = { promise: new Promise(resolve => resolveWaiting = resolve) };
const activeController = new AbortController(), activeRead = serviceExports.readPluginAppManagement(routeId, identity, activeController.signal), activeRequest = sent.at(-1);
activeController.abort(); const cancellation = sent.at(-1); assert.equal(cancellation.command, "chatgpt_service_cancel"); assert.equal(cancellation.args.requestId, activeRequest.args.request.requestId);
resolveWaiting(envelope(activeRequest.args)); await assert.rejects(activeRead, /取消/, "a cancelled request cannot deliver late management metadata");
waiting = null;
const bridgeSaved = await serviceExports.updatePluginAppMetadata(routeId, "metadata/raw?%2F中", "description", "  exact body\n ", identity, signal);
const updateRequest = sent.at(-1); assert.equal(updateRequest.command, "plugin_app_metadata_update"); assert.equal(updateRequest.args.request.appId, routeId); assert.equal(updateRequest.args.request.metadataId, "metadata/raw?%2F中");
assert.equal(updateRequest.args.request.operation, "description"); assert.equal(updateRequest.args.request.value, "  exact body\n "); assert.equal(updateRequest.args.request.expectedIdentity, identity); assert.equal(bridgeSaved.verification, "confirmed");
wrongIdentity = true; await assert.rejects(serviceExports.updatePluginAppMetadata(routeId, "metadata", "name", "New", identity, signal), /账号发生变化/); wrongIdentity = false;
wrongRequest = true; await assert.rejects(serviceExports.updatePluginAppMetadata(routeId, "metadata", "name", "New", identity, signal), /账号发生变化/); wrongRequest = false;
waiting = { promise: new Promise(resolve => resolveWaiting = resolve) };
const writeController = new AbortController(), activeWrite = serviceExports.updatePluginAppMetadata(routeId, "metadata", "name", "New", identity, writeController.signal), writeRequest = sent.at(-1);
writeController.abort(); assert.equal(sent.at(-1).command, "chatgpt_service_cancel"); assert.equal(sent.at(-1).args.requestId, writeRequest.args.request.requestId);
resolveWaiting(envelope(writeRequest.args)); await assert.rejects(activeWrite, /取消/, "write cancellation does not deliver a late ACK as confirmed state");
console.log("Standalone app management read: strict actual app identity, boolean capabilities and public fields, exact missing/null/empty description, current account/user/generation, routing, cancellation and truthful service failures passed.");
