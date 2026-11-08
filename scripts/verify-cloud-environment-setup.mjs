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
    async callCloudThread(operation) {
      calls.push([operation.kind, JSON.parse(JSON.stringify(operation))]);
      if (operation.kind === "read") return { thread: { id: "thread-A", name: state.title, cwd: "/workspace", status: { type: state.status ?? "idle" } } };
      if (operation.kind === "title") return {};
      assert.equal(operation.kind, "start_environment_setup");
      assert.equal(pending().phase, "sending");
      assert.equal(pending().messageId, operation.clientUserMessageId);
      if (state.turnError) throw state.turnError;
      return { turn: { id: "turn-A" } };
    },
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
    let modelPreparation;
    vm.runInNewContext(setupSource, {
      exports,
      require: name => name === "./chatgptService" ? bridge : name === "./cloudSetupModel"
        ? { resolveCloudSetupModel: (_identity, signal) => modelPreparation(signal) }
        : name === "./cloudDraftBindings" ? { rememberCloudDraftBinding: () => true } : detail,
      crypto: { randomUUID: () => "0843a3ba-7ae9-4e70-9c42-6054258ae17a" },
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
    const prepare = async () => ({ model: "model-A", effort: "medium", serviceTier: "priority" });
    const advance = (input = selection, owner = identity, resolve = prepare, signal = active) => {
      modelPreparation = resolve;
      return exports.advanceCloudEnvironmentSetup(input, owner, signal);
    };
    return Object.assign(advance, {
      session(input = selection) { modelPreparation = prepare; return exports.openCloudEnvironmentSetup(input, identity, active); },
      send(session, history = { turns: [] }) { modelPreparation = prepare; return exports.sendCloudEnvironmentSetup(session, history, active); },
    });
  };
  return { open, calls, state, pending };
}

const f = fixture();
const [initial, concurrent] = await Promise.all([f.open()(), f.open()()]);
assert.equal(initial.status, "ready");
assert.equal(initial.model, "model-A");
assert.equal(initial.serviceTier, "priority");
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
await assert.rejects(closed.open()(selection, identity, undefined, closing.signal), { name: "AbortError" });
assert.equal(closed.pending().phase, "config-created", "confirmed configuration survives navigation before draft creation");
closed.state.readback = raw();
assert.equal((await closed.open()(null)).status, "ready");
assert.deepEqual(closed.calls.map(([op]) => op), ["config", "read", "draft"]);
console.log("PASS cloud setup: tier preflight, write-ahead recovery, real receipt, serialized reopens and no automatic POST replay");

const launch = fixture();
const firstSession = (await launch.open().session()).session;
assert.equal(firstSession.setup.serviceTier, "priority");
assert.equal(firstSession.binding.draftId, "draft-A");
launch.state.status = "active";
assert.equal(await launch.open().send(firstSession), "waiting");
launch.state.status = "idle";
launch.state.turnError = { code: "cloud_setup_turn_unconfirmed" };
assert.deepEqual(await Promise.all([launch.open().send(firstSession), launch.open().send(firstSession)]), ["unconfirmed", "unconfirmed"]);
const send = launch.calls.find(([op]) => op === "start_environment_setup")[1];
assert.deepEqual(send.repositories, [{ name: "org/repo", ref: "main" }]);
assert.equal(send.privateDraft, true);
assert.equal(send.threadId, "thread-A");
const reopenedSession = (await launch.open().session(null)).session;
assert.equal(await launch.open().send(reopenedSession, { turns: [{ turn: { items: [{ type: "userMessage", clientId: "unrelated" }] } }] }), "unconfirmed");
assert.equal(await launch.open().send(reopenedSession, { turns: [{ turn: { items: [{ type: "userMessage", clientId: send.clientUserMessageId }] } }] }), "sent");
assert.equal(launch.pending(), null);
assert.equal(launch.calls.filter(([op]) => op === "start_environment_setup").length, 1);
assert.equal(launch.calls.filter(([op]) => op === "config" || op === "draft").length, 2);

const rootLaunch = fixture();
rootLaunch.state.config = { ...receipt, environment_id: "env-A", thread_id: "thread-A" };
rootLaunch.state.title = "existing title";
const rootSession = (await rootLaunch.open().session({ name: "New environment", repositories: [] })).session;
assert.equal(rootSession.binding.draftId, null);
assert.equal(await rootLaunch.open().send(rootSession), "sent");
assert.deepEqual(rootLaunch.calls.map(([op]) => op), ["config", "read", "start_environment_setup"]);
assert.equal(rootLaunch.calls.at(-1)[1].privateDraft, false);
console.log("PASS setup conversation launch: active thread wait, serialized first turn, UUID readback and root configuration session");

const capabilities = {}, resolver = {};
vm.runInNewContext(compile("src/modelCapabilities.ts"), { exports: capabilities });
const tierCalls = [];
let managed = { requirements: null }, configured = { model: null, model_reasoning_effort: "medium", service_tier: null };
let requirementsError;
vm.runInNewContext(compile("src/cloudSetupModel.ts"), {
  exports: resolver,
  require: name => name === "./modelCapabilities" ? capabilities : {
    async callCloudThread(operation, owner) {
      assert.equal(owner, identity);
      tierCalls.push(operation.kind);
      if (operation.kind === "requirements") {
        if (requirementsError) throw requirementsError;
        return managed;
      }
      assert.equal(operation.kind, "setup_preferences");
      return { config: configured };
    },
    async readCloudSetupModels() {
      tierCalls.push("models");
      return [{ id: "model-A", isDefault: true, defaultServiceTier: "fast", serviceTiers: [{ id: "priority", name: "Fast" }] }];
    },
  },
});
const modelSettings = () => resolver.resolveCloudSetupModel(identity, active);
assert.equal((await modelSettings()).serviceTier, "priority");
assert.deepEqual(tierCalls, ["requirements", "setup_preferences", "models"]);
managed = { requirements: { featureRequirements: { fast_mode: false, ultrafast_mode: true } }, supportsIndependentSpeedModes: true };
assert.equal((await modelSettings()).serviceTier, null);
configured = { ...configured, model: "model-A", service_tier: "ultrafast" };
const resolved = await modelSettings();
assert.equal(resolved.serviceTier, "ultrafast");
assert.equal(resolved.model, "model-A");
assert.deepEqual(tierCalls.slice(-2), ["requirements", "setup_preferences"]);
configured = { ...configured, service_tier: "flex" };
assert.equal((await modelSettings()).serviceTier, "flex");
configured = { ...configured, service_tier: "default" };
assert.equal((await modelSettings()).serviceTier, null);
requirementsError = { code: "cloud_host_closed" };
assert.equal((await modelSettings()).serviceTier, null);
requirementsError = { code: "account_changed" };
await assert.rejects(modelSettings(), { code: "account_changed" });
console.log("PASS cloud setup model: remote requirements, profile settings, first model page, speed access and failure boundaries");
