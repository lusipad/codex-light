import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/cloudEnvironmentService.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const identity = { accountId: "account", userId: "user", generation: 22 };
const summary = (id, extra = {}) => ({ id, name: `环境 ${id}`, version_id: "version", share_settings: "private", repositories: [{ repository_id: "opaque-repository-id", ref: "main" }], ...extra });
const detail = (extra = {}) => ({ ...summary("one"), status: "ready", network_policy: { type: "disabled" }, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); };
function harness() {
  const api = {}, calls = [], repositoryCalls = [];
  vm.runInNewContext(compiled, { exports: api, require: name => {
    assert.equal(name, "./chatgptService");
    const read = calls => (operation, params, current, signal) => { const pending = deferred(); calls.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; };
    return { readCloudService: read(calls), readChatgptService: read(repositoryCalls), serviceErrorMessage: cause => cause?.message || cause?.code || "读取失败" };
  } });
  return { api, calls, repositoryCalls };
}
const plain = value => JSON.parse(JSON.stringify(value));
const checks = [];
const check = (name, run) => checks.push({ name, run });

check("native summary retains description, unpublished revision and each ownership state", () => {
  const { api } = harness();
  for (const isOwner of [undefined, false, true]) {
    const parsed = api.parseCloudSummary(summary("one", { description: "真实说明", version_revision: 1, ...(isOwner === undefined ? {} : { is_owner: isOwner }) }));
    assert.equal(parsed.description, "真实说明"); assert.equal(parsed.versionRevision, 1); assert.equal(parsed.isOwner, isOwner);
  }
  const absent = api.parseCloudSummary(summary("one"));
  assert.equal(absent.description, null); assert.equal(absent.versionRevision, null);
  assert.equal(api.parseCloudSummary(summary("one", { description: "", version_revision: 4 })).description, "");
  for (const extra of [{ description: 1 }, { description: null }, { version_revision: 0 }, { version_revision: 1.5 }, { is_owner: "true" }]) assert.throws(() => api.parseCloudSummary(summary("one", extra)), /无法识别/);
});
check("root metadata and draft configuration remain separate; secret values never enter parsed data", () => {
  const { api } = harness();
  const parsed = api.parseCloudDetail(detail({ name: "已保存名称", description: "已保存说明", version_revision: 1,
    draft: { id: "draft", base_version_id: "version", revision: 0, name: "not-a-real-draft-name", description: "not-a-real-draft-description",
      repositories: [{ repository_id: "draft-repository", ref: "branch", depth: 2 }], network_policy: { type: "restricted", presets: ["package_managers"], egress_rules: [{ host: "allowed.invalid" }] },
      install_script: "echo setup", cwd: "/workspace", start_skill: "actual-skill", secrets: [{ name: "API", source: "environment", value: "must-not-be-exposed", target: { environment_variable: "API", allowed_domains: ["allowed.invalid"] }, error: { code: "not_found" } }] } }), "one", "draft");
  assert.equal(parsed.name, "已保存名称"); assert.equal(parsed.description, "已保存说明"); assert.equal(parsed.versionRevision, 1);
  assert.equal(parsed.draft.name, undefined); assert.equal(parsed.draft.description, undefined);
  assert.deepEqual(plain(parsed.draft.repositories), [{ id: "draft-repository", ref: "branch", depth: 2 }]);
  assert.equal(parsed.draft.network.packageManagers, true); assert.equal(parsed.draft.network.hosts[0], "allowed.invalid");
  assert.equal(parsed.draft.installScript, "echo setup"); assert.equal(parsed.draft.cwd, "/workspace"); assert.equal(parsed.draft.startSkill, "actual-skill");
  assert.equal(parsed.draft.secrets[0].error, "not_found"); assert.doesNotMatch(JSON.stringify(parsed), /must-not-be-exposed|not-a-real-draft/);
  assert.throws(() => api.parseCloudDetail(detail({ name: "" }), "one"), /无法识别/);
  assert.throws(() => api.parseCloudDetail(detail(), "another"), /身份不匹配/);
});
check("official sharing labels preserve private, unknown owner, owned and shared-with-you states", () => {
  const { api } = harness();
  for (const [extra, label] of [[{}, "私有"], [{ share_settings: "workspace" }, "共享"], [{ share_settings: "workspace", is_owner: true }, "由你共享"], [{ share_settings: "workspace", is_owner: false }, "与你共享"]]) {
    assert.equal(api.cloudSharingLabel(api.parseCloudSummary(summary("one", extra))), label);
  }
});
check("two scopes start together, finish independently, deduplicate and retain later metadata", async () => {
  const { api, calls } = harness(), control = new AbortController();
  const pending = api.loadCloudCatalog(identity, control.signal);
  assert.equal(calls.length, 2); assert.deepEqual(calls.map(call => call.params.scope), ["user", "workspace"]);
  for (const call of calls) { assert.equal(call.identity, identity); assert.equal(call.signal, control.signal); assert.equal(call.params.limit, 100); assert.equal(call.params.omitDraft, true); assert.equal("cursor" in call.params, false); }
  calls[1].resolve({ data: [summary("same", { description: "共享说明", version_revision: 1 })], next_cursor: null });
  calls[0].resolve({ data: [summary("same")], next_cursor: "page2" }); await flush();
  assert.equal(calls.length, 3); assert.equal(calls[2].params.scope, "user"); assert.equal(calls[2].params.cursor, "page2");
  calls[2].resolve({ data: [], next_cursor: "page3" }); await flush();
  calls[3].resolve({ data: [summary("two")], next_cursor: null });
  const result = await pending;
  assert.equal(result.items.length, 2); assert.equal(result.items[0].description, "共享说明"); assert.equal(result.items[0].versionRevision, 1);
  assert.equal(Object.keys(result.errors).length, 0); assert.equal(calls.filter(call => call.params.scope === "workspace").length, 1);
});
check("a failed scope never resolves a partial catalog as complete", async () => {
  const { api, calls } = harness();
  const pending = api.loadCloudCatalog(identity, new AbortController().signal);
  const rejected = assert.rejects(pending, /workspace denied/);
  calls[0].resolve({ data: [summary("not-complete")], next_cursor: null }); calls[1].reject(Error("workspace denied"));
  await rejected;
});
check("a later page failure rejects previously collected rows", async () => {
  const { api, calls } = harness(); const pending = api.loadCloudCatalog(identity, new AbortController().signal);
  const rejected = assert.rejects(pending, /later page failed/);
  calls[0].resolve({ data: [summary("page-one")], next_cursor: "later" }); calls[1].resolve({ data: [], next_cursor: null }); await flush();
  calls[2].reject(Error("later page failed")); await rejected;
});
check("a failing scope stops the other scope from advancing to another round", async () => {
  const { api, calls } = harness(); const pending = api.loadCloudCatalog(identity, new AbortController().signal);
  const rejected = assert.rejects(pending, /workspace denied/);
  calls[1].reject(Error("workspace denied")); await rejected;
  calls[0].resolve({ data: [summary("partial")], next_cursor: "must-not-read" }); await flush();
  assert.equal(calls.length, 2);
});
check("each round waits for both scopes and later pages replace the same ID in native order", async () => {
  const { api, calls } = harness(); const pending = api.loadCloudCatalog(identity, new AbortController().signal);
  calls[0].resolve({ data: [summary("same", { description: "user first" })], next_cursor: "user-second" }); await flush();
  assert.equal(calls.length, 2, "do not advance user until the workspace response finishes the round");
  calls[1].resolve({ data: [summary("same", { description: "workspace first" })], next_cursor: null }); await flush();
  calls[2].resolve({ data: [summary("same", { description: "user second" })], next_cursor: null });
  assert.equal((await pending).items[0].description, "user second"); assert.equal(calls.length, 3);
});
check("a repeated cursor rejects the catalog rather than returning a partial success", async () => {
  const { api, calls } = harness(); const pending = api.loadCloudCatalog(identity, new AbortController().signal);
  const rejected = assert.rejects(pending, /重复分页游标/);
  calls[0].resolve({ data: [], next_cursor: "repeat" }); calls[1].resolve({ data: [], next_cursor: null }); await flush();
  calls[2].resolve({ data: [summary("partial")], next_cursor: "repeat" }); await rejected; assert.equal(calls.length, 3);
});
check("abort before start and after first responses cannot begin another page", async () => {
  let h = harness(), control = new AbortController(); control.abort(); await assert.rejects(h.api.loadCloudCatalog(identity, control.signal), /取消/); assert.equal(h.calls.length, 0);
  h = harness(); control = new AbortController(); const pending = h.api.loadCloudCatalog(identity, control.signal); const rejected = assert.rejects(pending, /取消/);
  control.abort(); h.calls[0].resolve({ data: [summary("late")], next_cursor: "never" }); h.calls[1].resolve({ data: [], next_cursor: null }); await rejected; assert.equal(h.calls.length, 2);
});
check("repository search uses resolved names and never opaque identifiers as names", async () => {
  const { api, repositoryCalls } = harness(); const item = api.parseCloudSummary(summary("one"));
  assert.equal(api.filterCloudCatalog([item], "opaque-repository-id", {}).length, 0);
  assert.equal(api.filterCloudCatalog([item], " ACTUAL/REPOSITORY ", { "opaque-repository-id": { name: "actual/repository", error: null } }).length, 1);
  let pending = api.loadRepositoryName("opaque-repository-id", identity, new AbortController().signal);
  repositoryCalls.at(-1).resolve({ repository_full_name: "actual/repository" }); assert.equal((await pending).name, "actual/repository");
  pending = api.loadRepositoryName("opaque-repository-id", identity, new AbortController().signal);
  repositoryCalls.at(-1).reject({ status: 404 }); const result = await pending; assert.equal(result.name, null); assert.match(result.error, /未知/);
});

let failed = 0;
for (const { name, run } of checks) { try { await run(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); } }
console.log(`${checks.length - failed} passed, ${failed} failed; production data helpers with isolated bridge, no HTTP/native/official pixel verification`);
if (failed) process.exitCode = 1;
