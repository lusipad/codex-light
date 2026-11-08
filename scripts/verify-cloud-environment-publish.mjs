import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/cloudEnvironmentPublish.ts", "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} });
const identity = { accountId: "account", userId: "user", generation: 1 };
const binding = { ...identity, configId: "config", draftId: "draft", environmentId: "env" };
const session = { identity, binding, threadId: "thread" };
const review = { baseVersionId: "v1", revision: 5, turnId: "turn" };
const operation = (state, id = "op") => ({ id, state, environment_id: "env", kind: "APPROVE_ENVIRONMENT_CONFIG_DRAFT" });
const failed = (code, id = "op") => ({ ...operation("FAILED", id), failure: { code } });
const completed = { id: "config", draft: { id: "draft" }, version_id: "v2" };
const ready = { id: "config", status: "ready", version_id: "v2" };

function fixture(storage = new Map(), expectedKey = "11111111-1111-4111-8111-111111111111") {
  const calls = [], answers = [];
  let root = ready, lock = Promise.resolve(), clock = 0;
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, Date: { now: () => clock },
    setTimeout(callback, ms) { clock += ms; queueMicrotask(callback); return clock; },
    clearTimeout() {}, crypto: { randomUUID: () => expectedKey },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) { storage.set(key, value); },
    },
    navigator: { locks: { request(_, { signal }, callback) {
      const result = lock.then(() => { signal.throwIfAborted(); return callback(); });
      lock = result.catch(() => {});
      return result;
    } } },
    require(name) {
      if (name === "./cloudDraftBindings") return { listCloudDraftBindings: (_, account) =>
        account.userId === identity.userId ? [["thread", binding]] : [] };
      assert.equal(name, "./chatgptService");
      return {
        async callCloudPublish(request, actual, signal) {
          assert.equal(actual, identity);
          assert.deepEqual([request.configId, request.draftId, request.environmentId], ["config", "draft", "env"]);
          signal.throwIfAborted();
          calls.push(request.operation);
          assert.ok(answers.length, `unexpected ${request.operation.kind}`);
          const value = answers.shift();
          if (typeof value === "function") return value();
          return value;
        },
        async readCloudService(kind, params, actual, signal) {
          assert.equal(kind, "detail"); assert.equal(params.id, "config"); assert.equal(actual, identity);
          signal.throwIfAborted(); calls.push({ kind: "root" }); return root;
        },
      };
    },
  });
  return { ...exports, calls, answers, storage, expectedKey,
    setRoot: value => { root = value; },
    run: (input = review, validate = async () => {}, signal = new AbortController().signal, retryId) =>
      exports.advanceCloudPublication(session, input, signal, validate, retryId),
    order: () => calls.map(value => value.kind) };
}

{
  const f = fixture();
  f.answers.push(operation("PENDING"), operation("RUNNING"), operation("SUCCEEDED"), completed);
  const outcomes = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(outcomes, ["published", "published"]);
  assert.deepEqual(f.order(), ["begin", "read", "read", "complete", "root", "root"]);
  assert.equal(f.readCloudPublication(session).confirmed, true);
  assert.equal(f.pendingCloudPublication("config", identity), null);
}
{
  const f = fixture();
  f.answers.push(() => { throw Error("lost begin"); });
  await assert.rejects(f.run(), /lost begin/);
  assert.equal(f.readCloudPublication(session).key, f.expectedKey);
  const restarted = fixture(f.storage);
  restarted.answers.push(operation("PENDING"), operation("FAILED"));
  assert.equal(await restarted.run(null), "failed");
  assert.equal(restarted.calls[0].idempotencyKey, f.expectedKey);
  assert.equal(restarted.calls[0].expectedRevision, 5);
  assert.deepEqual(restarted.order(), ["begin", "read"]);
  assert.equal(restarted.pendingCloudPublication("config", identity).threadId, "thread");
  assert.equal(restarted.pendingCloudPublication("config", { ...identity, userId: "different" }), null);
}
{
  const f = fixture();
  f.setRoot({ ...ready, version_id: "v1" });
  f.answers.push(operation("PENDING"), operation("SUCCEEDED"), completed);
  assert.equal(await f.run(), "checking");
  assert.equal(f.readCloudPublication(session).versionId, "v2");
  const restarted = fixture(f.storage);
  assert.equal(await restarted.run(null), "published");
  assert.deepEqual(restarted.order(), ["root"]);
}
{
  const f = fixture();
  f.answers.push(operation("PENDING"), operation("SUCCEEDED", "wrong"));
  await assert.rejects(f.run(), /无法核对/);
  const restarted = fixture(f.storage);
  restarted.answers.push(() => { throw { code: "transport_error" }; },
    ...Array.from({ length: 4 }, () => () => { throw { status: 503 }; }));
  assert.equal(await restarted.run(null), "checking");
  assert.deepEqual(restarted.order(), Array(5).fill("read"));
}
{
  const f = fixture();
  await assert.rejects(f.run(review, async () => { throw Error("revision changed"); }), /revision changed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.storage.size, 0);
  const controller = new AbortController();
  f.answers.push(operation("PENDING"), () => { controller.abort(); return operation("SUCCEEDED"); });
  await assert.rejects(f.run(review, async () => {}, controller.signal));
  assert.deepEqual(f.order(), ["begin", "read"]);
  assert.equal(f.readCloudPublication(session).operationId, "op");
}
for (const code of ["APPROVAL_FAILED_BEFORE_SNAPSHOT", "APPROVAL_FAILED_AFTER_SNAPSHOT"]) {
  const f = fixture();
  f.answers.push(operation("PENDING"), failed(code));
  assert.equal(await f.run(), "failed");
  assert.equal(f.readCloudPublication(session).failureCode, code);
  const reopened = fixture(f.storage, "22222222-2222-4222-8222-222222222222");
  reopened.answers.push(failed(code));
  await assert.rejects(reopened.run(null, async () => { throw Error("revision changed"); }, undefined, "op"), /revision changed/);
  assert.deepEqual(reopened.order(), ["read"]);
  assert.equal(reopened.readCloudPublication(session).key, f.expectedKey);
  reopened.answers.push(failed(code), operation("PENDING", "op-new"), operation("SUCCEEDED", "op-new"), completed);
  const validated = [];
  assert.equal(await reopened.run(null, async v => validated.push([v.baseVersionId, v.revision, v.turnId]), undefined, "op"), "published");
  await reopened.run(null, undefined, undefined, "op");
  assert.deepEqual(validated, [["v1", 5, "turn"]]);
  assert.deepEqual(reopened.order(), ["read", "read", "begin", "read", "complete", "root"]);
  assert.equal(reopened.calls[2].idempotencyKey, reopened.expectedKey);
}
{
  const f = fixture();
  f.answers.push(operation("PENDING"), failed("STALE_BASE"));
  assert.equal(await f.run(), "failed");
  assert.equal(await f.run(null, undefined, undefined, "op"), "failed");
  assert.deepEqual(f.order(), ["begin", "read"]);
  const [key, raw] = [...f.storage][0];
  const { failureCode, ...legacy } = JSON.parse(raw);
  f.storage.set(key, JSON.stringify(legacy));
  f.answers.push(failed("APPROVAL_FAILED_AFTER_SNAPSHOT"));
  assert.equal(await f.run(null), "failed");
  assert.equal(f.readCloudPublication(session).failureCode, "APPROVAL_FAILED_AFTER_SNAPSHOT");
  assert.deepEqual(f.order(), ["begin", "read", "read"]);
  f.answers.push(operation("RUNNING"));
  await assert.rejects(f.run(null, undefined, undefined, "op"), /仍处于失败状态/);
  assert.equal(f.readCloudPublication(session).key, f.expectedKey);
  assert.deepEqual(f.order(), ["begin", "read", "read", "read"]);
}
console.log("PASS private cloud publication: resumable receipts, exact version readback and explicit retry of a revalidated recoverable terminal failure");
