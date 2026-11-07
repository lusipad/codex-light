import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const storage = new Map();
const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const calls = [];
const cloud = { readCloudService: (...args) => new Promise(resolve => calls.push({ args, resolve })) };
function load(path, modules) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, localStorage, require: name => modules[name] });
  return exports;
}
const details = load("src/cloudEnvironmentService.ts", { "./chatgptService": cloud });
const { rememberCloudDraftBinding, readCloudDraftBinding, readBoundCloudDraft } = load("src/cloudDraftBindings.ts", {
  "./chatgptService": cloud, "./cloudEnvironmentService": details,
});
const identity = { accountId: "account-A", userId: "user-A", generation: 3 };
const binding = { accountId: identity.accountId, userId: identity.userId, configId: "config-A", draftId: "draft-A", environmentId: "environment-A", name: "环境 A", repositoryNamesById: { "repo-A": "owner/repo" } };
const key = "environment-setup-server-configs-v1";
const plain = value => JSON.parse(JSON.stringify(value));

assert.equal(rememberCloudDraftBinding("thread-A", { ...binding, generation: 3, token: "never-persist" }), true);
assert.deepEqual(plain(readCloudDraftBinding("thread-A", { ...identity, generation: 4 })), binding, "known binding survives a new identity generation");
assert.equal(readCloudDraftBinding("thread-A", { ...identity, userId: "other" }), null);
assert.equal(readCloudDraftBinding("thread-A", { ...identity, accountId: "other" }), null);
assert.equal(readCloudDraftBinding("constructor", identity), null);
assert.equal(rememberCloudDraftBinding("thread-bad", { ...binding, draftId: "" }), false);
assert.equal(readCloudDraftBinding("thread-bad", identity), null);
assert(!storage.get(key).includes("never-persist"));

for (let index = 1; index <= 99; index++) assert(rememberCloudDraftBinding(`thread-${index}`, binding));
const updated = { ...binding, draftId: "draft-A2" };
assert(rememberCloudDraftBinding("thread-A", updated));
assert(rememberCloudDraftBinding("thread-latest", binding));
assert.equal(Object.keys(JSON.parse(storage.get(key))).length, 100);
assert.equal(readCloudDraftBinding("thread-1", identity), null, "updating a binding makes it the most recent");
assert.equal(readCloudDraftBinding("thread-A", identity).draftId, "draft-A2");
storage.set(key, "malformed JSON");
assert.equal(readCloudDraftBinding("thread-A", identity), null);
assert(rememberCloudDraftBinding("thread-A", binding));

const config = {
  id: binding.configId, name: binding.name, status: "ready", version_id: "version-1", share_settings: "private", repositories: [], network_policy: { type: "disabled" },
  draft: { id: binding.draftId, base_version_id: "version-1", revision: 2, repositories: [], network_policy: { type: "disabled" } },
};
let controller = new AbortController();
const detail = readBoundCloudDraft(binding, identity, controller.signal);
assert.equal(calls.length, 1);
assert.deepEqual(plain(calls[0].args.slice(0, 3)), ["draft", { id: binding.configId, draftId: binding.draftId }, identity]);
calls[0].resolve(config);
assert.equal((await detail).draft.revision, 2);
for (const wrong of [{ ...config, id: "config-B" }, { ...config, draft: { ...config.draft, id: "draft-B" } }]) {
  const result = readBoundCloudDraft(binding, identity, controller.signal);
  const rejected = assert.rejects(result, /身份不匹配/);
  calls.at(-1).resolve(wrong);
  await rejected;
}
let before = calls.length;
await assert.rejects(readBoundCloudDraft(binding, { ...identity, userId: "other" }, controller.signal), /账号/);
assert.equal(calls.length, before, "different users cannot read another binding");
const late = readBoundCloudDraft(binding, identity, controller.signal);
const cancelled = assert.rejects(late, { name: "AbortError" });
controller.abort();
calls.at(-1).resolve(config);
await cancelled;
before = calls.length;
await assert.rejects(readBoundCloudDraft(binding, identity, controller.signal), { name: "AbortError" });
assert.equal(calls.length, before);

console.log("PASS cloud draft binding: 100 recent bindings, identity and generation, private draft GET, mismatched responses and cancellation");
