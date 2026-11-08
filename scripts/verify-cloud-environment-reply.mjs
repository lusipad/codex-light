import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/cloudEnvironmentReply.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const identity = { accountId: "account-A", userId: "user-A", generation: 1 };
const binding = { accountId: identity.accountId, userId: identity.userId, configId: "config-A", draftId: null, environmentId: "env-A" };
const session = { threadId: "thread-A", identity, binding };
const signal = new AbortController().signal;
const history = (status, items = [], id = "turn-A") => ({ turns: [{ turn: { id, status, items } }] });
const completed = history("completed", [{ type: "agentMessage" }]);
const storage = new Map(), sends = [];
let status = "active", refuse, tail = Promise.resolve(), lastId = 0;
const load = () => {
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    crypto: { randomUUID: () => `client-${++lastId}` },
    navigator: { locks: { request: (_name, { signal: scope }, work) => {
      const result = tail.then(() => { scope.throwIfAborted(); return work(); });
      tail = result.catch(() => {});
      return result;
    } } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    require: name => name === "./cloudDraftBindings" ? {
      listCloudDraftBindings: (configId, current) => configId === binding.configId && current.userId === identity.userId ? [[session.threadId, binding]] : [],
    } : name === "./cloudSetupModel" ? {
      resolveCloudSetupModel: async () => ({ model: "model-A", effort: "medium", serviceTier: null }),
    } : {
      async callCloudThread(operation, owner) {
        assert.equal(owner.accountId, identity.accountId);
        if (operation.kind === "read") return { thread: { id: session.threadId, cwd: "/workspace", status: { type: status } } };
        assert.equal(operation.kind, "start_environment_reply");
        assert.equal(status, "idle");
        const journal = JSON.parse([...storage.values()][0]);
        assert.equal(journal.phase, "sending");
        assert.equal(journal.id, operation.clientUserMessageId);
        sends.push(JSON.parse(JSON.stringify(operation)));
        if (refuse) throw refuse;
        return { turn: { id: "reply-turn" } };
      },
    },
  });
  return exports;
};
const change = text => load().changeCloudEnvironmentReply(session, text, signal);
const advance = (latest = completed, resume = false) => load().advanceCloudEnvironmentReply(session, latest, signal, resume);
await assert.rejects(change("   "), /内容无效/);
assert.equal(storage.size, 0);
await change("  安装依赖。\n使用 npm。  ");
assert.equal(await advance(history("inProgress")), "queued");
assert.equal(sends.length, 0);
assert.equal(load().pendingCloudReplySession(binding.configId, identity).threadId, session.threadId);
assert.equal(load().pendingCloudReplySession(binding.configId, { ...identity, userId: "other" }), null);
status = "idle";
assert.equal(await advance(history("interrupted")), "paused");
assert.equal(await advance(), "paused");
assert.deepEqual(await Promise.all([advance(completed, true), advance(completed, true)]), ["accepted", "accepted"]);
assert.equal(sends.length, 1);
assert.equal(sends[0].text, "安装依赖。\n使用 npm。");
assert.equal(await advance(history("completed", [], "reply-turn")), null);
assert.equal(storage.size, 0);

await change("保留至核对");
refuse = { code: "cloud_setup_reply_unconfirmed" };
assert.equal(await advance(), "unconfirmed");
await change(null);
assert.equal(await advance(history("completed", [{ type: "userMessage", clientId: "wrong" }])), "unconfirmed");
assert.equal(await advance(history("completed", [{ type: "userMessage", clientId: sends[1].clientUserMessageId }])), null);
assert.equal(sends.length, 2);

await change("可撤销");
status = "active";
assert.equal(await advance(), "queued");
await change(null);
assert.equal(await advance(), null);
assert.equal(sends.length, 2);
console.log("PASS cloud environment reply: queued/paused, restart identity, exclusive dispatch, exact Unicode and uncertain readback");
