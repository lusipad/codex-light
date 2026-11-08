import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const detail = {};
vm.runInNewContext(compile("src/cloudEnvironmentService.ts"), { exports: detail, require: () => ({}) });
const setupSource = compile("src/cloudEnvironmentSetup.ts");
const identity = { accountId: "account-A", userId: "user-A", generation: 1 };
const selection = { name: "repo", repositories: [{ repositoryId: "repo-A", name: "org/repo", ref: "main" }] };
const receipt = { config_id: "config-A", name: "repo", version_id: "v1", environment_id: null,
  thread_id: null, draft_id: null, onboarding_skill: null };
const raw = (thread = null, withDraft = false) => {
  const fields = { repositories: [], network_policy: { type: "restricted", presets: ["package_managers"], egress_rules: [] } };
  return { id: "config-A", name: "repo", version_id: "v1", status: "ready", share_settings: "private",
    ...fields, environment_id: withDraft ? "env-A" : null, thread_id: thread,
    draft: withDraft ? { ...fields, id: "draft-A", base_version_id: "v1", revision: 1 } : null };
};
const active = new AbortController().signal;
function fixture() {
  const storage = new Map(), calls = [];
  let tail = Promise.resolve();
  const state = { config: receipt, draft: { draftId: "draft-A", environmentId: "env-A", threadId: "thread-A" },
    readback: raw("thread-A", true), rejectStorage: false, deadline: new AbortController() };
  const pending = () => JSON.parse([...storage.values()][0] ?? "null");
  const bridge = {
    async createCloudEnvironmentConfig(name, repositories, expected) {
      assert.equal(expected.accountId, identity.accountId);
      assert.equal(pending().phase, "creating-config");
      calls.push(["config", name, JSON.parse(JSON.stringify(repositories))]);
      if (state.configError) throw state.configError;
      state.afterConfig?.();
      return state.config;
    },
    async createCloudDraftReceipt(configId) {
      assert.equal(pending().phase, "creating-draft");
      assert.equal(pending().receipt.config_id, configId);
      calls.push(["draft", configId]);
      if (state.draftError) throw state.draftError;
      return state.draft;
    },
    async readCloudService(operation, params) {
      calls.push(["read", operation, JSON.parse(JSON.stringify(params))]);
      return state.readback;
    },
  };
  const open = () => {
    const exports = {};
    vm.runInNewContext(setupSource, {
      exports,
      require: name => name === "./chatgptService" ? bridge : detail,
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => { if (state.rejectStorage) throw Error("storage unavailable"); storage.set(key, value); },
        removeItem: key => storage.delete(key),
      },
      navigator: { locks: { request: (_key, { signal }, fn) => {
        const job = tail.then(() => { signal.throwIfAborted(); return fn(); });
        tail = job.catch(() => {});
        return job;
      } } },
      AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout(ms) {
        assert.equal(ms, 30000);
        return state.deadline.signal;
      } },
    });
    return (input = selection, owner = identity, resolve = async () => null, signal = active) =>
      exports.advanceCloudEnvironmentSetup(input, owner, signal, resolve);
  };
  return { open, calls, state, pending };
}

const f = fixture();
const [initial, concurrent] = await Promise.all([f.open()(), f.open()()]);
assert.equal(initial.status, "ready");
assert.equal(concurrent.receipt.thread_id, "thread-A");
assert.deepEqual(f.calls, [["config", "repo", [{ repositoryId: "repo-A", ref: "main" }]],
  ["draft", "config-A"], ["read", "draft", { id: "config-A", draftId: "draft-A" }]]);
assert.equal(await f.open()(null, { ...identity, userId: "other" }), null);
const recovered = await f.open()(null, { ...identity, generation: 2 });
assert.equal(recovered.status, "ready");
assert.equal(recovered.selection.repositories[0].name, "org/repo");
f.state.readback = { ...raw("different", true) };
await assert.rejects(f.open()(null), /不匹配/);
assert.equal(f.calls.filter(([op]) => op === "config" || op === "draft").length, 2);

const rootUnknown = fixture();
rootUnknown.state.configError = { code: "cloud_config_unconfirmed" };
await assert.rejects(rootUnknown.open()(), { code: "cloud_config_unconfirmed" });
assert.equal((await rootUnknown.open()(null, identity, () => assert.fail("unknown root must not reconnect"))).status, "config_unconfirmed");
assert.equal(rootUnknown.calls.length, 1);

const draftUnknown = fixture();
draftUnknown.state.draftError = { code: "cloud_draft_unconfirmed" };
await assert.rejects(draftUnknown.open()(), { code: "cloud_draft_unconfirmed" });
draftUnknown.state.readback = raw("unassociated-root-thread");
assert.equal((await draftUnknown.open()(null)).status, "draft_unconfirmed");
draftUnknown.state.readback = raw("thread-A", true);
assert.equal((await draftUnknown.open()(null)).status, "ready");
assert.deepEqual(draftUnknown.calls.map(([op, route]) => [op, route]),
  [["config", "repo"], ["draft", "config-A"], ["read", "detail"], ["read", "detail"]]);

const nullable = fixture();
nullable.state.draft = { ...nullable.state.draft, threadId: null };
assert.equal((await nullable.open()()).status, "draft_unconfirmed");
assert.equal(nullable.pending().receipt.draft_id, "draft-A");
assert.equal((await nullable.open()(null)).status, "ready");
assert.deepEqual(nullable.calls.at(-1), ["read", "draft", { id: "config-A", draftId: "draft-A" }]);

const rejected = fixture();
rejected.state.draftError = { status: 403 };
await assert.rejects(rejected.open()(), { status: 403 });
assert.equal(rejected.pending().phase, "config-created");
rejected.state.draftError = null;
rejected.state.readback = raw();
assert.equal((await rejected.open()(null)).status, "ready");
assert.deepEqual(rejected.calls.map(([op]) => op), ["config", "draft", "read", "draft"]);

const direct = fixture();
direct.state.config = { ...receipt, environment_id: "env-A", thread_id: "thread-A" };
assert.equal((await direct.open()({ name: "New environment", repositories: [] })).receipt.draft_id, null);
assert.deepEqual(direct.calls, [["config", "New environment", []]]);

const unavailable = fixture();
unavailable.state.rejectStorage = true;
await assert.rejects(unavailable.open()(), /storage unavailable/);
assert.equal(unavailable.calls.length, 0);
const deadline = fixture();
await assert.rejects(deadline.open()(selection, identity, () => {
  deadline.state.deadline.abort(new DOMException("tier timeout", "TimeoutError"));
  return new Promise(() => {});
}), { name: "TimeoutError" });
assert.equal(deadline.calls.length, 0);
assert.equal(deadline.pending(), null);

const closed = fixture();
const closing = new AbortController();
closed.state.afterConfig = () => closing.abort();
await assert.rejects(closed.open()(selection, identity, async () => null, closing.signal), { name: "AbortError" });
assert.equal(closed.pending().phase, "config-created", "confirmed configuration survives navigation before draft creation");
closed.state.readback = raw();
assert.equal((await closed.open()(null)).status, "ready");
assert.deepEqual(closed.calls.map(([op]) => op), ["config", "read", "draft"]);
console.log("PASS cloud setup: tier preflight, write-ahead recovery, real receipt, serialized reopens and no automatic POST replay");
