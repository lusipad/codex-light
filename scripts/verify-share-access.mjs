import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { accountId: "account-a", userId: "user-a", generation: 4 };
const clone = value => JSON.parse(JSON.stringify(value));
let identityRead, bootstrapRead, accountsRead;
const calls = [];
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shareAccess.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: module.exports, Error, Set,
  require: name => {
    assert.equal(name, "./chatgptService");
    return {
      serviceIdentity: async signal => { calls.push(["identity", signal]); return identityRead; },
      shareAccessBootstrap: async (expected, signal) => { calls.push(["bootstrap", expected, signal]); return bootstrapRead; },
      readChatgptService: async (...args) => { calls.push(["accounts", ...args]); return accountsRead; },
    };
  },
});
const { decodeShareAccess, decodeShareRecipients, readShareAccess } = module.exports;
function bootstrap(value = true, format) {
  return { statsigPayload: JSON.stringify({
    user: { userID: identity.userId, customIDs: { account_id: identity.accountId } },
    feature_gates: { "4157559322": format === "init-v2" ? { v: value } : { value } },
    ...(format ? { response_format: format } : {}),
  }) };
}
const accounts = () => ({
  account_ordering: [identity.accountId, "other"],
  accounts: [
    { id: "other", structure: "personal", account_user_id: "other-membership" },
    { id: identity.accountId, structure: "workspace", account_user_id: "membership-a", name: "Workspace" },
  ],
});
for (const format of [undefined, "init-v1", "init-v2"]) {
  const result = decodeShareAccess(bootstrap(true, format), accounts(), identity);
  assert.deepEqual(clone(result), { identity, gate: true, account: { kind: "workspace", accountUserId: "membership-a", name: "Workspace" } });
  const payload = JSON.parse(bootstrap(true, format).statsigPayload);
  payload.feature_gates["1016046617"] = payload.feature_gates["4157559322"];
  delete payload.feature_gates["4157559322"];
  assert.equal(decodeShareAccess({ statsigPayload: JSON.stringify(payload) }, accounts(), identity).gate, true);
  assert.deepEqual(clone(decodeShareAccess(bootstrap(false, format), null, identity)), { identity, gate: false, account: null });
}
const personal = accounts(); personal.accounts[1].structure = "personal"; delete personal.accounts[1].name;
assert.deepEqual(clone(decodeShareAccess(bootstrap(), personal, identity).account), { kind: "personal", accountUserId: "membership-a" });
for (const change of [
  p => { p.user.userID = "other"; }, p => { p.user.customIDs.account_id = "other"; },
  p => { delete p.user.customIDs; }, p => { p.feature_gates = {}; },
  p => { p.feature_gates["4157559322"].value = "true"; },
  p => { p.response_format = "unknown"; }, p => { p.is_delta = true; },
  p => { p.isDelta = true; }, p => { p.live_overlay = {}; },
  p => { p.feature_gates["4157559322"] = true; },
]) {
  const payload = JSON.parse(bootstrap().statsigPayload); change(payload);
  assert.throws(() => decodeShareAccess({ statsigPayload: JSON.stringify(payload) }, accounts(), identity));
}
for (const bad of [null, {}, { statsigPayload: {} }, { statsigPayload: "not-json" }]) {
  assert.throws(() => decodeShareAccess(bad, accounts(), identity));
}
for (const change of [
  a => { a.account_ordering.reverse(); }, a => { a.accounts.push(a.accounts[1]); },
  a => { a.accounts.pop(); }, a => { a.accounts[1].structure = "unknown"; },
  a => { a.accounts[1].account_user_id = ""; }, a => { a.accounts[1].name = 123; },
  a => { a.accounts[1].is_deactivated = true; }, a => { a.accounts[1].can_access_with_session = false; },
]) {
  const value = accounts(); change(value); assert.throws(() => decodeShareAccess(bootstrap(), value, identity));
}
const recipients = decodeShareRecipients({ items: [
  { id: "global-owner", account_user_id: "membership-a", name: "Self" },
  { id: "global-user", account_user_id: "membership-b", name: "Name", email: "mail@example.invalid" },
  { id: "other-id", account_user_id: "membership-b", name: "Duplicate" },
  { id: "global-email", account_user_id: "membership-c", email: "fallback@example.invalid" },
  { id: "global-id", account_user_id: "membership-d" },
] }, { items: [
  { id: "real-group", name: "Group", num_members: 12 },
  { id: "real-group", name: "Duplicate" },
] }, "membership-a");
assert.deepEqual(clone(recipients), [
  { id: "group:real-group", label: "Group", memberCount: 12, principal: { principal_id: "real-group", principal_type: "group" } },
  { id: "user:membership-b", label: "Name", secondaryLabel: "mail@example.invalid", principal: { principal_id: "membership-b", principal_type: "user" } },
  { id: "user:membership-c", label: "fallback@example.invalid", secondaryLabel: "fallback@example.invalid", principal: { principal_id: "membership-c", principal_type: "user" } },
  { id: "user:membership-d", label: "global-id", principal: { principal_id: "membership-d", principal_type: "user" } },
]);
for (const [users, groups] of [
  [null, { items: [] }], [{ items: [] }, {}],
  [{ items: [{ id: "global-only" }] }, { items: [] }],
  [{ items: [] }, { items: [{ id: "missing-name" }] }],
]) assert.throws(() => decodeShareRecipients(users, groups, "membership-a"));

identityRead = identity; bootstrapRead = bootstrap(); accountsRead = accounts();
const controller = new AbortController();
assert.equal((await readShareAccess(controller.signal)).account.accountUserId, "membership-a");
assert.equal(calls[1][0], "bootstrap"); assert.deepEqual(calls[1][1], identity);
assert.equal(calls[2][1], "share_accounts"); assert.deepEqual(clone(calls[2][2]), {});
assert.deepEqual(calls[2][3], identity);
assert.ok(calls.every(call => call.at(-1) === controller.signal));
let resolveAccounts;
accountsRead = new Promise(resolve => { resolveAccounts = resolve; });
const cancelled = new AbortController(), reading = readShareAccess(cancelled.signal);
await Promise.resolve(); cancelled.abort(); resolveAccounts(accounts());
await assert.rejects(reading, /abort/i);
console.log("PASS production share access: identity-bound V1/V2/hash gates, false/unknown, account matching, real principals and cancellation");
