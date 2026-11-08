import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/cloudPublishedChat.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const identity = { accountId: "account", userId: "user", generation: 1 };
const binding = { ...identity, configId: "asenvcfg_saved", draftId: "old-draft", environmentId: "old-env",
  name: "Published", repositoryNamesById: {} };
const target = { session: { identity, binding, threadId: "setup-thread" }, versionId: "v2" };
const signal = () => new AbortController().signal;

function fixture(storage = new Map(), queue = new Map()) {
  const calls = [], exports = {};
  let locked = false, rootVersion = "v2", activeIdentity = identity;
  let start = async () => ({ thread: { id: "remote-thread" } });
  vm.runInNewContext(compiled, {
    exports, localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    crypto: { randomUUID: () => "message-uuid" },
    navigator: { locks: { async request(_, { ifAvailable }, run) {
      assert.equal(ifAvailable, true);
      if (locked) return run(null);
      locked = true;
      try { return await run({}); }
      finally { locked = false; }
    } } },
    require(name) {
      if (name === "./chatgptService") return {
        async readCloudService(kind, params, actual) {
          assert.equal(kind, "detail"); assert.equal(actual, identity);
          calls.push("detail"); return { id: params.id, name: "Published", latest_ready_version_id: rootVersion };
        },
        async serviceIdentity() { return activeIdentity; },
        async callCloudThread(request, actual) {
          assert.equal(actual, identity);
          assert.equal(JSON.stringify(request), '{"kind":"start_saved_environment","environmentConfigId":"asenvcfg_saved","model":"remote","effort":"low","serviceTier":null}');
          calls.push("start"); return start();
        },
      };
      if (name === "./cloudSetupModel") return { resolveCloudSetupModel: async () => ({ model: "remote", effort: "low", serviceTier: null }) };
      if (name === "./cloudDraftBindings") return { rememberCloudDraftBinding(id, actual) {
        assert.equal(id, "remote-thread"); assert.equal(actual.draftId, null);
        assert.equal(actual.conversation, true); assert.equal(actual.userId, identity.userId);
        calls.push("binding"); return true;
      } };
      if (name === "./cloudEnvironmentReply") return { cloudReplyMaxLength: 32768, async changeCloudEnvironmentReply(session, text, _, id) {
        assert.equal(session.threadId, "remote-thread"); assert.equal(id, "message-uuid");
        calls.push("queue"); queue.set(id, text);
      } };
      assert.fail(name);
    },
  });
  return { ...exports, calls, storage, queue,
    setRoot: version => { rootVersion = version; },
    setIdentity: value => { activeIdentity = value; },
    setStart: value => { start = value; } };
}

{
  const f = fixture();
  assert.equal(await f.verifyPublishedCloudTarget(target, signal()), "Published");
  assert.equal(f.readPublishedCloudStart(target), null);
  assert.deepEqual(f.calls, ["detail"]);
  await f.startPublishedCloudChat(target, " 第一条云端消息 ", signal(), () => false);
  assert.deepEqual(f.calls, ["detail", "detail", "start", "queue", "binding"]);
  assert.equal(f.queue.get("message-uuid"), "第一条云端消息");
  assert.equal(f.readPublishedCloudStart(target).queued, true);
  const reopened = fixture(f.storage, f.queue);
  await reopened.startPublishedCloudChat(target, "", signal(), session => session.threadId === "remote-thread");
  assert.deepEqual(reopened.calls, ["binding"]);
  assert.equal(reopened.readPublishedCloudStart(target), null);
}
{
  const f = fixture();
  f.setRoot("v3");
  await assert.rejects(f.startPublishedCloudChat(target, "request", signal(), () => assert.fail("stale opened")), /最新就绪/);
  f.setRoot("v2");
  f.setIdentity({ ...identity, generation: 2 });
  await assert.rejects(f.startPublishedCloudChat(target, "request", signal(), () => assert.fail("stale opened")), /账号/);
  assert.deepEqual(f.calls, ["detail", "detail"]);
}
{
  const f = fixture();
  f.setStart(async () => { throw { code: "cloud_thread_start_unconfirmed" }; });
  await assert.rejects(f.startPublishedCloudChat(target, "keep me", signal(), () => assert.fail("ambiguous opened")),
    error => error.code === "cloud_thread_start_unconfirmed");
  const reopened = fixture(f.storage);
  await assert.rejects(reopened.startPublishedCloudChat(target, "keep me", signal(), () => assert.fail("ambiguous opened")),
    error => error.code === "cloud_thread_start_unconfirmed");
  assert.equal(reopened.readPublishedCloudStart(target).text, "keep me");
  assert.deepEqual(reopened.calls, []);
}
{
  const f = fixture();
  const controller = new AbortController();
  f.setStart(async () => { controller.abort(); return { thread: { id: "remote-thread" } }; });
  await assert.rejects(f.startPublishedCloudChat(target, "keep me", controller.signal, () => assert.fail("aborted opened")));
  assert.deepEqual(f.calls, ["detail", "start"]);
  assert.equal(f.readPublishedCloudStart(target).threadId, undefined);
}
{
  const f = fixture();
  let resolve;
  const response = new Promise(done => { resolve = done; });
  f.setStart(() => response);
  const opening = f.startPublishedCloudChat(target, "single launch", signal(), () => true);
  await assert.rejects(f.startPublishedCloudChat(target, "single launch", signal(), () => assert.fail("duplicate opened")), /已有云端聊天/);
  resolve({ thread: { id: "remote-thread" } });
  await opening;
  assert.equal(f.calls.filter(call => call === "start").length, 1);
}
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.match(app, /activeRouteRef\.current !== "cloud-new-chat"\) return false/);
assert.match(app, /setPublishedCloudTarget\(target\);\s*setActiveRoute\("cloud-new-chat"\)/);
console.log("PASS published cloud handoff: read-only selection, durable creation, persistent first message, no unknown replay and no late navigation");
