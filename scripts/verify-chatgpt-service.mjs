import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
let id = 0, pending, calls = [], nativeFailure, mismatch = false;
const disk = new Map(); const identity = { accountId: "account", userId: "user", generation: 2 };
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
 { exports, crypto: { randomUUID: () => `request-${++id}` }, navigator: { userAgent: "Chrome/130.0", userAgentData: { brands: [{ brand: "Chromium", version: "130" }], platform: "Windows" } },
 localStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) },
 require: name => { assert.equal(name, "./bridge"); return { tauriInvoke: async (command, params) => {
   calls.push([command, params]); if (nativeFailure) throw nativeFailure;
   if (command === "chatgpt_service_identity" || command === "cloud_service_identity") return identity;
   if (command === "cloud_service_access") return { identity, gateEvidence: "personal-plan-branch" };
   if (command === "chatgpt_service_cancel") return true;
   if (pending) return new Promise(resolve => { pending.resolve = resolve; });
   return { requestId: params.request.requestId, identity: mismatch ? { ...identity, userId: "other" } : identity, body: { cuts: [] } };
 } }; } });
const signal = () => new AbortController(); let control = signal();
assert.equal(await exports.serviceIdentity(control.signal), identity);
assert.deepEqual(JSON.parse(JSON.stringify(await exports.readChatgptService("gpts_discovery", {}, identity, control.signal))), { cuts: [] });
const firstProfile = calls.at(-1)[1].request.profile;
assert.equal(firstProfile.userAgent, "Chrome/130.0"); assert.equal(firstProfile.platformClientHint, '"Windows"');
await exports.readChatgptService("gpts_detail", { id: "real-id" }, identity, control.signal);
assert.equal(calls.at(-1)[1].request.profile.deviceId, firstProfile.deviceId); assert.equal(disk.size, 1);
assert.ok(!JSON.stringify(calls).includes("getAuthStatus"));
mismatch = true; await assert.rejects(exports.readChatgptService("gpts_discovery", {}, identity, control.signal), /账号发生变化/); mismatch = false;
control = signal(); control.abort(); const count = calls.length; await assert.rejects(exports.readChatgptService("gpts_discovery", {}, identity, control.signal), /取消/); assert.equal(calls.length, count);
control = signal(); pending = {};
const read = exports.readChatgptService("gpts_discovery", {}, identity, control.signal); const request = calls.at(-1)[1].request;
control.abort(); assert.equal(calls.at(-1)[0], "chatgpt_service_cancel"); assert.equal(calls.at(-1)[1].requestId, request.requestId);
pending.resolve({ requestId: request.requestId, identity, body: { cuts: [] } }); await assert.rejects(read, /取消/); pending = null;
nativeFailure = { code: "not_logged_in" }; await assert.rejects(exports.serviceIdentity(signal().signal)); assert.match(exports.serviceErrorMessage(nativeFailure), /登录/);
assert.match(exports.serviceErrorMessage({ code: "forbidden" }), /无权/); assert.match(exports.serviceErrorMessage({ code: "rate_limited" }), /频繁/);
nativeFailure = null;
assert.equal(await exports.cloudServiceIdentity(signal().signal), identity);
assert.equal((await exports.cloudServiceAccess(signal().signal)).gateEvidence, "personal-plan-branch");
await exports.readCloudService("list", { scope: "user", limit: 100, omitDraft: true }, identity, signal().signal);
assert.equal(calls.at(-1)[0], "cloud_service_read");
assert.equal("profile" in calls.at(-1)[1].request, false, "ASB profile must be constructed by host, not browser");
mismatch = true; await assert.rejects(exports.readCloudService("detail", { id: "config" }, identity, signal().signal), /账号发生变化/); mismatch = false;
console.log("PASS BR frontend production helper: native identity/read only, observed browser profile/stable device identity, typed account generation, pre/inflight cancellation, late-result rejection and real failure classification; no bearer in JS");
