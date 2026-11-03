import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
let id = 0, pending, calls = [], nativeFailure, mismatch = false, responseBody = { cuts: [] };
const disk = new Map(); const identity = { accountId: "account", userId: "user", generation: 2 };
const exports = {};
const remoteExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/remoteReview.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: remoteExports, URL });
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
 { exports, crypto: { randomUUID: () => `request-${++id}` }, navigator: { userAgent: "Chrome/130.0", userAgentData: { brands: [{ brand: "Chromium", version: "130" }], platform: "Windows" } },
 localStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) },
 require: name => { if (name === "./remoteReview") return remoteExports; assert.equal(name, "./bridge"); return { tauriInvoke: async (command, params) => {
   calls.push([command, params]); if (nativeFailure) throw nativeFailure;
   if (command === "chatgpt_service_identity" || command === "cloud_service_identity") return identity;
   if (command === "cloud_service_access") return { identity, gateEvidence: "personal-plan-branch" };
   if (command === "chatgpt_service_cancel") return true;
   if (pending) return new Promise(resolve => { pending.resolve = resolve; });
   return { requestId: params.request.requestId, identity: mismatch ? { ...identity, userId: "other" } : identity, body: responseBody };
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

const providerPreferences = { gitHostingProvider: "github", githubConnection: null, gitlabConnectorId: null };
responseBody = { capabilities: { githubInstances: false, gitlab: null, reviewTabDefault: true }, githubConnections: null, githubConnectionsError: null,
  gitlabInstances: null, gitlabInstancesError: null, preferences: providerPreferences };
let access = await exports.readReviewProviderAccess(identity, signal().signal);
assert.equal(access.identity, identity);
assert.equal(access.capabilities.gitlab, null, "unconfirmed layer stays unknown");
assert.equal(calls.at(-1)[0], "code_review_provider_read");
responseBody = { capabilities: { githubInstances: true, gitlab: true, reviewTabDefault: false }, githubConnections: [], githubConnectionsError: null,
  gitlabInstances: [], gitlabInstancesError: null, preferences: providerPreferences };
access = await exports.readReviewProviderAccess(identity, signal().signal);
assert.equal(access.githubConnections.length, 0, "confirmed empty connections is a real empty list");
responseBody = { ...responseBody, githubConnections: null };
await assert.rejects(exports.readReviewProviderAccess(identity, signal().signal), /响应格式无效/);
responseBody = { ...responseBody, githubConnectionsError: "connections unavailable" };
assert.equal((await exports.readReviewProviderAccess(identity, signal().signal)).githubConnectionsError, "connections unavailable");
responseBody = { ...responseBody, gitlabInstances: null };
await assert.rejects(exports.readReviewProviderAccess(identity, signal().signal), /响应格式无效/);
responseBody = { ...responseBody, gitlabInstancesError: "GitLab links unavailable" };
assert.equal((await exports.readReviewProviderAccess(identity, signal().signal)).gitlabInstancesError, "GitLab links unavailable");
const gitlabValidBody = { ...responseBody, gitlabInstancesError: null,
  gitlabInstances: [{ connectorId: "gitlab-work", hostname: "git.example.com", name: "Work" }] };
for (const instances of [[{}], [{ connectorId: "c", hostname: "git.example.com", name: {} }],
  [gitlabValidBody.gitlabInstances[0], gitlabValidBody.gitlabInstances[0]]]) {
  responseBody = { ...gitlabValidBody, gitlabInstances: instances };
  await assert.rejects(exports.readReviewProviderAccess(identity, signal().signal), /响应格式无效/);
}
responseBody = gitlabValidBody;
mismatch = true;
await assert.rejects(exports.readReviewProviderAccess(identity, signal().signal), /账号发生变化/);
mismatch = false;
control = signal(); pending = {};
const providerRead = exports.readReviewProviderAccess(identity, control.signal);
const providerRequest = calls.at(-1)[1].request;
control.abort();
assert.equal(calls.at(-1)[1].requestId, providerRequest.requestId);
pending.resolve({ requestId: providerRequest.requestId, identity, body: responseBody });
await assert.rejects(providerRead, /取消/); pending = null;
responseBody = { capabilities: { githubInstances: true, gitlab: true, reviewTabDefault: false }, githubConnections: [], githubConnectionsError: null,
  gitlabInstances: [], gitlabInstancesError: null,
  preferences: { ...providerPreferences, githubConnection: { accountLinkId: "link", connectorId: "connector", hostname: "github.example.test" } } };
await exports.updateReviewProviderPreference("githubConnection", { hostname: "github.example.test", connectorId: "connector", accountLinkId: "link" }, identity, signal().signal, null);
assert.equal(calls.at(-1)[0], "code_review_provider_update");
assert.equal(calls.at(-1)[1].expectedValue, null);
await assert.rejects(exports.updateReviewProviderPreference("gitHostingProvider", "gitlab", identity, signal().signal, "github"), /读回不一致/);
responseBody = { ...responseBody, gitlabInstances: [{ connectorId: "gitlab-work", hostname: "git.example.com" }],
  preferences: { ...providerPreferences, gitlabConnectorId: "gitlab-work" } };
await exports.updateReviewProviderPreference("gitlabConnectorId", "gitlab-work", identity, signal().signal, null);
assert.equal(calls.at(-1)[1].value, "gitlab-work");
responseBody = { ...responseBody, capabilities: { ...responseBody.capabilities, gitlab: null } };
await assert.rejects(exports.readReviewProviderAccess(identity, signal().signal), /响应格式无效/, "unknown gate cannot carry a fabricated instance inventory");
console.log("PASS CR provider client: native capability identity, unknown vs disabled, real empty connections, malformed data and cancellation");

const prUrl = "https://github.com/owner/repo/pull/7";
responseBody = { pullRequest: { hostname: "github.com", owner: "owner", repository: "repo", number: 7, url: prUrl },
  account: { hostId: "local", hostname: "github.com", login: "reviewer" },
  metadata: { status: "success", headRevision: "head", additions: 1, deletions: 0, changedFiles: 1, createdAt: "2026-11-04T00:00:00Z", authorLogin: "author" },
  summary: { status: "success", headRevision: "head", title: "PR", state: "open", baseBranch: "main", headBranch: "feature" },
  description: "Real description", diff: { headRevision: "head", unifiedDiff: "" } };
assert.equal((await exports.readRemotePullRequest(`${prUrl}#comment`, identity, signal().signal)).description, "Real description");
assert.equal(calls.at(-1)[0], "code_review_pull_request_read");
assert.equal(calls.at(-1)[1].url, prUrl);
assert.equal("account" in calls.at(-1)[1], false, "source account is acquired by host, not renderer supplied");
let beforeInvalid = calls.length;
await assert.rejects(exports.readRemotePullRequest("https://github.com/owner/repo/issues/7", identity, signal().signal), /链接/);
assert.equal(calls.length, beforeInvalid, "invalid PR does not acquire a native service request");
mismatch = true;
await assert.rejects(exports.readRemotePullRequest(prUrl, identity, signal().signal), /账号发生变化/); mismatch = false;
control = signal(); pending = {};
const readingPr = exports.readRemotePullRequest(prUrl, identity, control.signal);
const readingPrId = calls.at(-1)[1].request.requestId;
control.abort(); assert.equal(calls.at(-1)[1].requestId, readingPrId);
pending.resolve({ requestId: readingPrId, identity, body: responseBody });
await assert.rejects(readingPr, /取消/); pending = null;
console.log("PASS remote PR client: canonical URL, host-owned source account, bound request/identity, rejected invalid targets and inflight cancellation");
