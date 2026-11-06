import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let tick = 0; tick < 18; tick++) await Promise.resolve(); };
const identity = { accountId: "account", userId: "user", generation: 1 };
const summary = (id, extra = {}) => ({ id, name: `环境 ${id}`, version_id: "v1", share_settings: "private", repositories: [{ repository_id: "repo", ref: "main" }], ...extra });
const config = (id = "one", extra = {}) => ({ ...summary(id), status: "ready", network_policy: { type: "disabled" }, ...extra });
const calls = [], repositoryCalls = [], api = {};
vm.runInNewContext(compile("src/cloudEnvironmentService.ts"), { exports: api, require: name => {
  assert.equal(name, "./chatgptService"); return {
    readCloudService: (operation, params, current, signal) => { const pending = deferred(); calls.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; },
    readChatgptService: (operation, params, current, signal) => { const pending = deferred(); repositoryCalls.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; },
    serviceErrorMessage: cause => cause.message || cause.code,
  };
} });
assert.throws(() => api.parseCloudPage({ data: [] }), /无法识别/);
assert.throws(() => api.parseCloudPage({ data: [summary("one", { version_id: "" })], next_cursor: null }), /无法识别/);
let control = new AbortController(); let start = calls.length;
let catalogRead = api.loadCloudCatalog(identity, control.signal);
assert.equal(calls.length - start, 2, "user/workspace first pages start concurrently");
assert.deepEqual(calls.slice(start).map(call => call.params.scope), ["user", "workspace"]);
for (const call of calls.slice(start)) { assert.equal(call.operation, "list"); assert.equal(call.params.limit, 100); assert.equal(call.params.omitDraft, true); assert.equal("cursor" in call.params, false); assert.equal(call.identity, identity); }
calls[start + 1].resolve({ data: [summary("same", { name: "共享记录" })], next_cursor: null });
calls[start].resolve({ data: [summary("same", { name: "个人记录" })], next_cursor: "user-next" }); await flush();
assert.equal(calls.at(-1).params.scope, "user"); assert.equal(calls.at(-1).params.cursor, "user-next");
calls.at(-1).resolve({ data: [], next_cursor: "empty-next" }); await flush(); assert.equal(calls.at(-1).params.cursor, "empty-next");
calls.at(-1).resolve({ data: [summary("two")], next_cursor: null }); let result = await catalogRead;
assert.equal(result.items.length, 2); assert.equal(result.items[0].name, "共享记录"); assert.equal(Object.keys(result.errors).length, 0);
assert.equal(calls.slice(start).filter(call => call.params.scope === "workspace").length, 1, "finished scope must never restart");
start = calls.length; catalogRead = api.loadCloudCatalog(identity, control.signal);
const failedScope = assert.rejects(catalogRead, cause => cause.code === "forbidden");
calls[start].resolve({ data: [summary("kept")], next_cursor: "repeat" }); calls[start + 1].reject({ code: "forbidden" }); await failedScope;
assert.equal(calls.length, start + 2, "a failed scope rejects the catalog and cannot present partial success");
start = calls.length; catalogRead = api.loadCloudCatalog(identity, control.signal);
const cursorLoop = assert.rejects(catalogRead, /重复分页游标/);
calls[start].resolve({ data: [summary("kept")], next_cursor: "repeat" }); calls[start + 1].resolve({ data: [], next_cursor: null }); await flush();
calls.at(-1).resolve({ data: [summary("later")], next_cursor: "repeat" }); await cursorLoop;
control = new AbortController(); start = calls.length; catalogRead = api.loadCloudCatalog(identity, control.signal); control.abort();
calls[start].resolve({ data: [summary("late")], next_cursor: "never" }); calls[start + 1].resolve({ data: [], next_cursor: null });
await assert.rejects(catalogRead, /取消/); assert.equal(calls.length, start + 2, "abort cannot start another page");
let nameRead = api.loadRepositoryName("opaque-id", identity, new AbortController().signal);
assert.equal(repositoryCalls.at(-1).operation, "github_repository"); assert.equal(repositoryCalls.at(-1).params.id, "opaque-id"); repositoryCalls.at(-1).resolve({ repository_full_name: "owner/actual-repository" }); assert.equal((await nameRead).name, "owner/actual-repository");
nameRead = api.loadRepositoryName("opaque-id", identity, new AbortController().signal); repositoryCalls.at(-1).reject({ status: 404 }); assert.equal((await nameRead).error, "未知仓库");
const draft = { id: "draft", base_version_id: "v1", revision: 2, repositories: [{ repository_id: "draft-repo", ref: "branch" }], network_policy: { type: "restricted", presets: ["package_managers"], egress_rules: [{ host: "actual.example.invalid" }] },
  install_script: "real draft script", cwd: "/workspace", secrets: [{ name: "API", source: "environment", value: "never-render", target: { environment_variable: "API", allowed_domains: ["allowed.invalid"] } }] };
const detailFixture = config("one", { draft }); const parsed = api.parseCloudDetail(detailFixture, "one", "draft");
assert.equal(parsed.draft.network.hosts[0], "actual.example.invalid"); assert.doesNotMatch(JSON.stringify(parsed), /never-render/);
assert.throws(() => api.parseCloudDetail(detailFixture, "wrong"), /身份不匹配/); assert.throws(() => api.parseCloudDetail(detailFixture, "one", "wrong"), /草稿/);
assert.throws(() => api.parseCloudDetail(config("one", { network_policy: { type: "vpc" } }), "one"), /无法识别/);
assert.equal(api.parseCloudDetail(config("one", { status: "new-server-state" }), "one").status, "new-server-state");

assert.equal(api.parseCloudSummary(summary("one", { description: "说明", version_revision: 1 })).description, "说明");
assert.deepEqual([api.cloudSharingLabel(api.parseCloudSummary(summary("one"))), api.cloudSharingLabel(api.parseCloudSummary(summary("one", { share_settings: "workspace" }))), api.cloudSharingLabel(api.parseCloudSummary(summary("one", { share_settings: "workspace", is_owner: true }))), api.cloudSharingLabel(api.parseCloudSummary(summary("one", { share_settings: "workspace", is_owner: false })))], ["私有", "共享", "由你共享", "与你共享"]);
assert.equal(api.filterCloudCatalog([api.parseCloudSummary(summary("one"))], " actual-repository ", { repo: { name: "owner/actual-repository", error: null } }).length, 1);
const viewSource = fs.readFileSync("src/components/CloudEnvironmentsView.tsx", "utf8"), app = fs.readFileSync("src/App.tsx", "utf8");
assert.doesNotMatch(viewSource, /DEFAULT_ENVIRONMENTS|codex_cloud_environments|handleToggleStatus|handleResetCache|Date\.now|分配算力|onStartChatInEnv/); assert.doesNotMatch(app, /onStartChatInEnv=/);
console.log("PASS cloud data: real scope pagination/dedup, failed scope rejection, repeated cursors, abort, repository resolution, strict config/draft identity, secret value omission, sharing labels and search; no HTTP/native claim.");
await import("./verify-cloud-environment-view.mjs");
