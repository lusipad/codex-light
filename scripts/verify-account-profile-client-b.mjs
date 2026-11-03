import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, URL, AbortController, require: name => imports[name], ...globals });
  return exports;
}
const identity = { accountId: "account", userId: "user", generation: 3 };
let account = { account: { type: "chatgpt", email: "auth@example.invalid", planType: "pro" }, workspaceRouting: { chatgptAccountId: "account" } };
let readAccount = async () => account, readIdentity = async () => identity, read, mutate;
const calls = [];
const api = load("src/accountProfile.ts", {
  "./config": { accountRead: () => readAccount() },
  "./chatgptService": { serviceIdentity: signal => readIdentity(signal),
    readChatgptService: (operation, params, expected, signal) => { calls.push({ operation, params, expected, signal }); return read(operation); },
    mutateAccountProfile: (...args) => mutate(...args), serviceErrorMessage: cause => cause.message || String(cause) },
});
const me = { id: "user", name: "真实账户姓名", email: "me@example.invalid", picture: "https://example.invalid/me" };
const publicBody = { profile_details: { display_name: "不同公开名称", description: "实际简介", username: "actual~123", profile_url: "https://example.invalid/u/actual~123", profile_picture_url: "https://example.invalid/public" }, viewer_access: { can_edit: false } };
read = async operation => operation === "account_me" ? me : operation === "profile_identity" ? publicBody : { ...publicBody, can_edit: true, is_self: false };
let snapshot = await api.loadAccountProfile(new AbortController().signal);
assert.equal(snapshot.me.name, "真实账户姓名"); assert.equal(snapshot.profile.displayName, "不同公开名称");
assert.equal(snapshot.page.canEdit, true); assert.equal(snapshot.page.isSelf, false);
assert.equal(snapshot.profile.canEditUsername, true, "valid viewer access missing username flag follows official non-denial branch");
assert.equal(snapshot.me.picture, "https://example.invalid/me"); assert.equal(snapshot.profile.pictureUrl, "https://example.invalid/public");
assert.equal(snapshot.profile.profileUrl, "https://example.invalid/u/actual~123");
assert.deepEqual(calls.map(call => call.operation), ["account_me", "profile_identity", "profile_page"]);
assert.ok(calls.every(call => Object.keys(call.params).length === 0 && call.expected === identity));
for (const permission of [false, "true", 1, undefined]) {
  const body = { ...publicBody, viewer_access: permission === undefined ? undefined : { can_edit_username: permission } };
  assert.equal(api.decodePublicProfile(body).canEditUsername, permission === false ? false : null);
}
assert.equal(api.decodePublicProfile({ ...publicBody, viewer_access: { can_edit_username: null } }).canEditUsername, true);
assert.equal(api.decodePublicProfile({ profile_details: { profile_url: "javascript:alert(1)", profile_picture_url: "file:///C:/private" } }).profileUrl, null);
assert.throws(() => api.decodeAccountMe({ ...me, id: "other" }, identity), /身份不符/);
assert.throws(() => api.decodePublicProfile([]));
read = async operation => { if (operation === "account_me") throw Error("me unavailable"); return operation === "profile_identity" ? publicBody : null; };
snapshot = await api.loadAccountProfile(new AbortController().signal);
assert.equal(snapshot.me, null); assert.equal(snapshot.profile.displayName, "不同公开名称"); assert.equal(snapshot.page, null); assert.match(snapshot.errors.me, /me unavailable/);
let revisions = 0; readIdentity = async () => ({ ...identity, generation: ++revisions === 1 ? 3 : 4 });
await assert.rejects(() => api.loadAccountProfile(new AbortController().signal), /账户发生变化/);
readIdentity = async () => identity; readAccount = async () => ({ account: null }); calls.length = 0;
snapshot = await api.loadAccountProfile(new AbortController().signal); assert.equal(snapshot.identity, null); assert.equal(calls.length, 0);
console.log("PASS AP-B01: real sources remain distinct; partial/restricted data, URLs and permissions preserve semantics; identity generations and signed-out states cannot borrow profile data");

assert.equal(api.normalizeUsername("  @ real_name "), "real_name");
for (const value of ["abc", "a.b_c-d", "abc.data", "abc.html", "a".repeat(20)]) assert.equal(api.usernameValidationMessage(value), null);
for (const value of ["ab", "a".repeat(21), "Name", "中文名", "a b", ".abc", "abc-", "@@abc", "abc~123"]) assert.ok(api.usernameValidationMessage(value));
const mutations = [];
mutate = async (...args) => { mutations.push(args); return { verification: "confirmed", body: { available: true }, readback: {} }; };
await api.updateAccountName(" 姓名原串 ", identity, new AbortController().signal);
assert.equal(mutations.at(-1)[1].name, " 姓名原串 ");
await api.updatePublicProfile({ bio: "" }, identity, new AbortController().signal);
assert.deepEqual(Object.keys(mutations.at(-1)[1]), ["description"]); assert.equal(mutations.at(-1)[1].description, "");
assert.equal((await api.checkProfileUsername("abc", identity, new AbortController().signal)).available, true);
mutate = async () => ({ body: { available: "true" } });
await assert.rejects(() => api.checkProfileUsername("abc", identity, new AbortController().signal), /无法确认/);
console.log("PASS AP-B02: exact username normalization/format without invented suffix bans; account name raw string and sparse public fields; malformed availability cannot authorize save");

const ipc = [], storage = new Map(); let response;
const bridge = { tauriInvoke: async (command, args) => { ipc.push({ command, args }); return response(command, args); } };
const transport = load("src/chatgptService.ts", { "./bridge": bridge, "./remoteReview": load("src/remoteReview.ts", {}) }, {
  crypto: { randomUUID: () => "fixture-request" }, navigator: { userAgent: "fixture", userAgentData: { platform: "Windows", brands: [{ brand: "Chromium", version: "130" }] } },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
});
response = async (_command, args) => ({ requestId: args.request.requestId, identity, verification: "confirmed", body: {}, readback: me });
await transport.mutateAccountProfile("account_name", { name: "原串" }, identity, new AbortController().signal);
assert.equal(ipc.at(-1).command, "profile_mutation"); assert.equal(ipc.at(-1).args.request.operation, "account_name");
assert.ok(!JSON.stringify(ipc).includes("token")); assert.deepEqual([...storage.keys()], ["codex_service_device_id_v1"]);
response = async (_command, args) => ({ requestId: args.request.requestId, identity: { ...identity, userId: "other" }, verification: "confirmed", body: {}, readback: me });
await assert.rejects(() => transport.mutateAccountProfile("account_name", { name: "raw" }, identity, new AbortController().signal), /账号发生变化/);
const controller = new AbortController(); controller.abort(); const count = ipc.length;
await assert.rejects(() => transport.mutateAccountProfile("profile", { description: "" }, identity, controller.signal), /取消/); assert.equal(ipc.length, count);
assert.match(transport.serviceErrorMessage({ code: "profile_bio_rejected" }), /简介未通过审核/);
console.log("PASS AP-B03: actual mutation IPC binds request/account/user/generation and browser context; cancelled writes never invoke host; profile credentials do not enter storage or renderer parameters");
