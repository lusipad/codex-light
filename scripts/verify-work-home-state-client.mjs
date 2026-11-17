import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
let sequence = 0, pending, failure, transform = value => value;
const calls = [], identity = { userId: "work-user", accountId: "work-account", generation: 4 };
const preferences = { owner: "bound", atoms: { "work-run-location-v1": "local" }, unboundAtoms: [],
  selectedProject: { placement: "owner-value", binding: "confirmed", value: null }, localProjects: { placement: "missing" } };
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const service = {};
vm.runInNewContext(compile("src/chatgptService.ts"), {
  exports: service, crypto: { randomUUID: () => `work-home-${++sequence}` },
  require: name => name === "./bridge" ? { tauriInvoke: async (command, args) => {
    calls.push({ command, args });
    if (command === "chatgpt_service_cancel") return;
    assert.equal(command, "work_home_preferences");
    if (failure) throw failure;
    const result = transform({ requestId: args.request.requestId, identity: { ...identity }, preferences });
    if (pending) return new Promise(resolve => { pending.resolve = () => resolve(result); });
    return result;
  } } : {},
});
const client = {};
vm.runInNewContext(compile("src/workHomePreferences.ts"), { exports: client, require: () => service, Error });
const read = (expected = identity, signal = new AbortController().signal) => client.readWorkHomePreferences(expected, signal);
assert.equal((await read()).runLocation.value, "local");
assert.deepEqual(Object.keys(calls[0].args.request).sort(), ["expectedIdentity", "requestId"]);
assert.equal((await read()).selectedProject.value, null);
for (const patch of [{ userId: "other" }, { accountId: "other" }, { generation: 5 }]) {
  transform = value => ({ ...value, identity: { ...value.identity, ...patch } });
  await assert.rejects(read(), /确认 Work 偏好/);
}
transform = value => ({ ...value, requestId: "wrong-request" }); await assert.rejects(read());
for (const bad of [null, [], { owner: "foreign" }, { owner: "bound" }]) {
  transform = value => ({ ...value, preferences: bad }); await assert.rejects(read());
}
transform = value => value;
const unavailable = Error("fixture host unavailable"); failure = unavailable;
await assert.rejects(read(), error => error === unavailable); failure = null;
const cancelled = new AbortController(); cancelled.abort(); const before = calls.length;
await assert.rejects(read(identity, cancelled.signal)); assert.equal(calls.length, before);
pending = {}; const during = new AbortController(), reading = read(identity, during.signal);
const requestId = calls.at(-1).args.request.requestId;
during.abort(); assert.equal(calls.at(-1).command, "chatgpt_service_cancel");
assert.equal(calls.at(-1).args.requestId, requestId);
pending.resolve(); await assert.rejects(reading, /取消/); pending = null;
pending = {}; const mutable = { ...identity }, mutableRead = read(mutable);
const initialRequest = calls.at(-1).args.request;
mutable.accountId = "changed"; assert.equal(initialRequest.expectedIdentity.accountId, identity.accountId);
pending.resolve(); const result = await mutableRead; pending = null;
assert.equal(result.identity.accountId, identity.accountId);
assert.equal(JSON.stringify(calls).includes("authToken"), false);
assert.equal(calls.some(call => call.command === "desktop_state_get"), false);
console.log("PASS actual Work preference client pipeline: restricted native command, identity/request ACK, value validation, no raw fallback, immutable request, RPC failure, pre/inflight cancellation and late-result rejection; isolated bridge, no real account or service.");
