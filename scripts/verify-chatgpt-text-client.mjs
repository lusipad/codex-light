import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { accountId: "account-a", userId: "user-a", generation: 7 };
const foreign = { ...identity, generation: 8 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const calls = [], frames = [], accepted = [], channels = [], timers = new Map(), storage = new Map(options.deviceId ? [["codex.chatgpt-conversations.device-id", options.deviceId]] : []);
  const submit = deferred(), stop = deferred(), history = deferred(), list = deferred(), abort = new AbortController();
  let uuid = 0, reads = 0, tick = 10, timerId = 0;
  const navigator = Object.assign(Object.create({ hardwareConcurrency: 8 }), { userAgent: "Actual WebView fixture UA", language: "zh-CN", languages: ["zh-CN", "en"],
    userAgentData: { brands: [{ brand: "WebView Test", version: "123" }], platform: "Windows" } });
  class Channel {
    constructor(onmessage) { this.onmessage = onmessage ?? (() => {}); channels.push(this); }
    emit(packet) { this.onmessage(packet); }
  }
  const globals = { structuredClone, AbortController, TextEncoder, URLSearchParams, btoa: value => Buffer.from(value, "binary").toString("base64"),
    navigator, screen: { width: 1280, height: 800 }, performance: { now: () => ++tick, timeOrigin: 123456, memory: { jsHeapSizeLimit: 1000000 } },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` },
    localStorage: { getItem: key => { if (options.storageThrows) throw Error("storage denied"); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (options.storageThrows) throw Error("storage denied"); storage.set(key, value); } },
    document: { scripts: [{ src: "tauri://localhost/assets/actual.js" }], documentElement: { getAttribute: () => null } },
    window: { location: { search: "?source=fixture&source=second" },
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) },
  };
  const actualModules = new Map();
  function load(file) {
    if (actualModules.has(file)) return actualModules.get(file);
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(`src/${file}.ts`, "utf8"), { fileName: `${file}.ts`, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    vm.runInNewContext(source, { ...globals, module, exports: module.exports, require(name) {
      if (name === "@tauri-apps/api/core") return { Channel };
      if (name === "./bridge") return { tauriInvoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "chatgpt_text_submit") return submit.promise;
        if (command === "chatgpt_text_stop") return stop.promise;
        if (command === "chatgpt_conversation_history_read") return history.promise;
        if (command === "chatgpt_conversation_list_read") return list.promise;
        if (command === "chatgpt_service_cancel") return;
        throw Error(`Forbidden ordinary CLI or unexpected command: ${command}`);
      } };
      if (name === "./chatgptService") return { serviceIdentity: async signal => { signal?.throwIfAborted(); reads++;
        return options.readIdentity ? options.readIdentity(reads, signal) : { ...identity }; } };
      if (name.startsWith("./")) return load(name.slice(2));
      throw Error(`Unexpected dependency ${name}`);
    } }, { filename: `src/${file}.ts` });
    actualModules.set(file, module.exports); return module.exports;
  }
  const messages = load("chatgptMessages"), client = load("chatgptTextClient");
  const body = messages.createChatgptTextRequest({ model: "service-model", thinkingEffort: "extended", messages: [
    messages.createChatgptUserMessage({ id: "user-message", prompt: "  真实中文草稿  ", createdAt: 10000 }),
  ], parentMessageId: "client-created-root", timezone: "Asia/Shanghai", timezoneOffsetMinutes: -480, systemHints: ["hint"], isTemporaryChat: false });
  const start = (onFrame = frame => frames.push(frame), owner = identity, onResponseAccepted = status => accepted.push(status)) =>
    client.submitChatgptText({ identity: owner, body, signal: abort.signal, onFrame, onResponseAccepted });
  const request = command => calls.find(call => call.command === command)?.args.request;
  const packet = (sequence, overrides = {}) => ({ requestId: request("chatgpt_text_submit").requestId, identity: { ...identity }, sequence,
    kind: "frame", event: "message", data: `frame-${sequence}`, id: `event-${sequence}`, ...overrides });
  const emit = (sequence, overrides) => channels[0].emit(packet(sequence, overrides));
  const responsePacket = (sequence, overrides = {}) => packet(sequence, { kind: "response", responseStatus: 200, event: "", data: "", id: "", ...overrides });
  const respond = (sequence, overrides) => channels[0].emit(responsePacket(sequence, overrides));
  const receipt = (eventCount, overrides = {}) => ({ requestId: request("chatgpt_text_submit").requestId, identity: { ...identity }, status: "transport-complete", eventCount, ...overrides });
  return { ...client, body, start, submit, stop, history, list, abort, calls, frames, accepted, channels, timers, storage, navigator, request, packet, emit, responsePacket, respond, receipt,
    get reads() { return reads; }, expire: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const groups = [];
const test = (name, fn) => groups.push([name, fn]);
const rejection = promise => promise.then(() => ({ ok: true }), error => ({ error }));
const failed = async promise => { const result = await promise; assert.ok(result.error, "must reject rather than report success"); return result.error; };

test("fresh owner before dispatch and after receipt", async () => {
  const before = fixture({ readIdentity: () => foreign }), rejected = rejection(before.start()); await failed(rejected); assert.equal(before.calls.length, 0);
  const after = fixture({ readIdentity: count => count === 1 ? identity : foreign }), result = rejection(after.start()); await flush();
  after.submit.resolve(after.receipt(0)); await failed(result); assert.equal(after.reads, 2);
  assert.ok(after.calls.some(c => c.command === "chatgpt_service_cancel"));
});
test("actual source device key, observed browser profile and requirements envelope", async () => {
  const h = fixture({ deviceId: "saved-device" }), result = h.start(); await flush(); const request = h.request("chatgpt_text_submit");
  assert.equal(request.profile.deviceId, "saved-device"); assert.equal(request.profile.userAgent, h.navigator.userAgent);
  assert.equal(request.profile.userAgentClientHints, '"WebView Test";v="123"'); assert.equal(request.profile.platformClientHint, '"Windows"');
  assert.ok(request.requirementsKey.startsWith("gAAAAAC"));
  const fields = JSON.parse(Buffer.from(request.requirementsKey.slice(7), "base64").toString("utf8"));
  assert.equal(fields.length, 25); assert.equal(fields[4], h.navigator.userAgent); assert.equal(fields[5], "tauri://localhost/assets/actual.js");
  assert.equal(fields[15], "source,source"); assert.equal(fields[16], 8);
  assert.equal(request.body.parent_message_id, "client-created-root"); assert.equal(request.body.messages[0].content.parts[0], "真实中文草稿");
  h.submit.resolve(h.receipt(0)); await result; assert.deepEqual(h.calls.map(c => c.command), ["chatgpt_text_submit"]);
});
test("device generation persists only the Chat key and storage failure keeps generated identity", async () => {
  for (const storageThrows of [false, true]) {
    const h = fixture({ storageThrows }), result = h.start(); await flush(); const request = h.request("chatgpt_text_submit");
    assert.match(request.profile.deviceId, /^00000000-/); assert.notEqual(request.profile.deviceId, request.requestId);
    if (!storageThrows) assert.equal(h.storage.get("codex.chatgpt-conversations.device-id"), request.profile.deviceId);
    h.submit.resolve(h.receipt(0)); await result;
  }
  const h = fixture(); h.navigator.userAgentData = undefined; const rejected = rejection(h.start()); await failed(rejected); assert.equal(h.calls.length, 0);
});
test("request body and principal snapshot precede asynchronous owner read", async () => {
  const read = deferred(), h = fixture({ readIdentity: count => count === 1 ? read.promise : identity }), owner = { ...identity };
  const result = h.start(undefined, owner); owner.accountId = "mutated"; h.body.messages[0].content.parts[0] = "mutated"; h.body.system_hints.push("mutated");
  read.resolve(identity); await flush(); const request = h.request("chatgpt_text_submit");
  assert.equal(request.expectedIdentity.accountId, identity.accountId); assert.equal(request.body.messages[0].content.parts[0], "真实中文草稿");
  assert.deepEqual(Array.from(request.body.system_hints), ["hint"]); h.submit.resolve(h.receipt(0)); await result;
});
test("ordered Channel frames and late packets after cleanup", async () => {
  const h = fixture(), result = h.start(); await flush(); h.emit(1); h.emit(2); h.submit.resolve(h.receipt(2));
  assert.equal((await result).eventCount, 2); assert.deepEqual(h.frames.map(f => f.data), ["frame-1", "frame-2"]);
  h.emit(3); assert.equal(h.frames.length, 2); assert.equal(h.timers.size, 0);
});

test("response metadata shares delivery sequence but only signals real HTTP acceptance", async () => {
  const h = fixture(), order = [], result = h.start(frame => { order.push("frame"); h.frames.push(frame); }, identity,
    status => { order.push("response"); h.accepted.push(status); }); await flush();
  h.respond(1); assert.deepEqual(h.accepted, [200]); assert.equal(h.frames.length, 0);
  h.emit(2); h.submit.resolve(h.receipt(2)); assert.equal((await result).eventCount, 2);
  assert.deepEqual(order, ["response", "frame"]); assert.deepEqual(h.frames.map(frame => frame.data), ["frame-2"]);

  for (const patch of [{ identity: foreign }, { requestId: "foreign-request" }, { responseStatus: 199 }, { responseStatus: 300 },
    { responseStatus: "200" }, { responseStatus: 200.5 }, { responseStatus: undefined }, { event: "message" }, { data: "fake-frame" }, { id: "fake-id" }]) {
    const bad = fixture(), rejected = rejection(bad.start()); await flush(); bad.respond(1, patch);
    assert.equal(bad.accepted.length, 0); assert.equal(bad.frames.length, 0);
    assert.ok(bad.calls.some(call => call.command === "chatgpt_service_cancel"), "invalid metadata cancels native request");
    bad.submit.resolve(bad.receipt(1)); await failed(rejected);
  }
  const duplicate = fixture(), rejected = rejection(duplicate.start()); await flush(); duplicate.respond(1); duplicate.respond(2);
  assert.deepEqual(duplicate.accepted, [200]); assert.equal(duplicate.frames.length, 0);
  assert.ok(duplicate.calls.some(call => call.command === "chatgpt_service_cancel"));
  duplicate.submit.resolve(duplicate.receipt(2)); await failed(rejected);

  const dead = fixture(), completed = dead.start(); await flush(); const queued = dead.channels[0].onmessage;
  dead.submit.resolve(dead.receipt(0)); await completed; queued(dead.responsePacket(1));
  assert.equal(dead.accepted.length, 0, "queued callback after cleanup cannot signal acceptance");
  const aborted = fixture(), cancelled = rejection(aborted.start()); await flush(); const old = aborted.channels[0].onmessage;
  aborted.abort.abort(); old(aborted.responsePacket(1)); aborted.submit.reject(Error("native cancelled")); await failed(cancelled);
  assert.equal(aborted.accepted.length, 0);
  const finalRead = deferred(), late = fixture({ readIdentity: count => count === 1 ? identity : finalRead.promise });
  const retired = rejection(late.start()); await flush(); late.submit.resolve(late.receipt(0)); await flush();
  assert.equal(late.reads, 2); late.respond(1); finalRead.resolve(foreign); await failed(retired);
  assert.equal(late.accepted.length, 0, "metadata beyond the settled native count cannot run during late owner validation");
  const optional = fixture(), withoutHandler = optional.submitChatgptText({ identity, body: optional.body, signal: optional.abort.signal,
    onFrame: frame => optional.frames.push(frame) }); await flush(); optional.respond(1); optional.emit(2); optional.submit.resolve(optional.receipt(2));
  await withoutHandler; assert.equal(optional.frames.length, 1, "metadata remains separate when the optional callback is absent");
  const original = Error("acceptance consumer retired"), callback = fixture();
  const callbackFailure = rejection(callback.start(undefined, identity, () => { throw original; })); await flush(); callback.respond(1);
  assert.ok(callback.calls.some(call => call.command === "chatgpt_service_cancel")); callback.submit.resolve(callback.receipt(1));
  assert.equal(await failed(callbackFailure), original); assert.equal(callback.frames.length, 0);
});
test("foreign request/identity and sequence gaps cancel native request", async () => {
  for (const overrides of [{ requestId: "foreign" }, { identity: foreign }, { sequence: 2 }, { event: 3 }]) {
    const h = fixture(), result = rejection(h.start()); await flush(); h.emit(1, overrides);
    assert.equal(h.frames.length, 0); assert.ok(h.calls.some(c => c.command === "chatgpt_service_cancel"));
    h.submit.resolve(h.receipt(0)); await failed(result); h.emit(1); assert.equal(h.frames.length, 0);
  }
});
test("consumer callback error cancels native and remains original failure", async () => {
  const original = Error("consumer decode failure"), h = fixture(), result = rejection(h.start(() => { throw original; })); await flush();
  h.emit(1); assert.ok(h.calls.some(c => c.command === "chatgpt_service_cancel")); h.submit.resolve(h.receipt(1)); assert.equal(await failed(result), original);
});
test("abort before, during invoke and during IPC tail never succeeds", async () => {
  const before = fixture(); before.abort.abort(); await failed(rejection(before.start())); assert.equal(before.calls.length, 0);
  const during = fixture(), result = rejection(during.start()); await flush(); during.abort.abort(); during.emit(1);
  assert.equal(during.frames.length, 0); assert.ok(during.calls.some(c => c.command === "chatgpt_service_cancel"));
  during.submit.reject(Error("native cancellation")); await failed(result);
  const tail = fixture(), pending = rejection(tail.start()); await flush(); tail.submit.resolve(tail.receipt(1)); await flush();
  assert.equal(tail.timers.size, 1); tail.abort.abort(); await failed(pending); assert.equal(tail.timers.size, 0);
  tail.emit(1); assert.equal(tail.frames.length, 0);
  const finalRead = deferred(), last = fixture({ readIdentity: count => count === 1 ? identity : finalRead.promise });
  const final = rejection(last.start()); await flush(); last.submit.resolve(last.receipt(0)); await flush();
  assert.equal(last.reads, 2); last.abort.abort(); finalRead.resolve(identity); await failed(final);
});
test("native receipt waits for real IPC tail and rejects missing/unknown acknowledgment", async () => {
  const h = fixture(); let settled = false; const result = h.start().then(value => { settled = true; return value; }); await flush();
  h.submit.resolve(h.receipt(2)); await flush(); assert.equal(settled, false); h.emit(1); await flush(); assert.equal(settled, false);
  h.emit(2); await result; assert.equal(h.timers.size, 0);
  const missing = fixture(), timed = rejection(missing.start()); await flush(); missing.submit.resolve(missing.receipt(1)); await flush(); missing.expire(); await failed(timed);
  for (const patch of [{ status: "accepted" }, { requestId: "other" }, { identity: foreign }, { eventCount: -1 }, { eventCount: 1.5 }]) {
    const bad = fixture(), rejected = rejection(bad.start()); await flush(); bad.submit.resolve(bad.receipt(0, patch)); await failed(rejected);
  }
});
test("excess frame during final owner check cannot pass declared receipt count", async () => {
  const finalRead = deferred(), h = fixture({ readIdentity: count => count === 1 ? identity : finalRead.promise });
  const result = rejection(h.start()); await flush(); h.emit(1); h.submit.resolve(h.receipt(1)); await flush(); assert.equal(h.reads, 2);
  h.emit(2); finalRead.resolve(identity); await failed(result); assert.equal(h.frames.length, 1, "receipt bounds delivery before consumer callback");
});
test("transport-error receipt drains already-delivered partial frames then rejects original structured error", async () => {
  const h = fixture(); let settled = false;
  const result = rejection(h.start()).then(value => { settled = true; return value; }); await flush();
  const nativeError = { code: "network", message: "connection interrupted after partial output", status: 503 };
  h.submit.resolve(h.receipt(2, { status: "transport-error", error: nativeError })); await flush();
  assert.equal(settled, false, "a failed invoke queue must not drop its already-issued Channel tail");
  h.emit(1); await flush(); assert.equal(settled, false); h.emit(2);
  const error = await failed(result); assert.equal(error.code, nativeError.code); assert.equal(error.message, nativeError.message); assert.equal(error.status, nativeError.status);
  assert.deepEqual(h.frames.map(frame => frame.data), ["frame-1", "frame-2"]); h.emit(3); assert.equal(h.frames.length, 2);
  for (const mode of ["foreign", "sequence", "abort"]) {
    const bad = fixture(), rejected = rejection(bad.start()); await flush();
    bad.submit.resolve(bad.receipt(2, { status: "transport-error", error: nativeError })); await flush();
    if (mode === "abort") bad.abort.abort();
    else bad.emit(1, mode === "foreign" ? { requestId: "foreign" } : { sequence: 2 });
    await failed(rejected); bad.emit(1); bad.emit(2); assert.equal(bad.frames.length, 0);
    assert.ok(bad.calls.some(call => call.command === "chatgpt_service_cancel"));
  }
});
test("stop requires actual accepted ACK and fresh owner; local cancellation is not server stop", async () => {
  const stale = fixture({ readIdentity: () => foreign });
  await failed(rejection(stale.stopChatgptText(identity, "server-conversation", stale.abort.signal))); assert.equal(stale.calls.length, 0);
  const never = fixture(); never.abort.abort();
  await failed(rejection(never.stopChatgptText(identity, "server-conversation", never.abort.signal))); assert.equal(never.calls.length, 0);
  const h = fixture(), result = h.stopChatgptText(identity, "server-conversation", h.abort.signal); await flush(); const request = h.request("chatgpt_text_stop");
  assert.equal(request.conversationId, "server-conversation"); assert.equal(request.profile.userAgent, h.navigator.userAgent);
  h.stop.resolve({ requestId: request.requestId, identity, status: "accepted" }); await result; assert.equal(h.reads, 2);
  for (const patch of [{ status: "cancelled" }, { requestId: "other" }, { identity: foreign }]) {
    const bad = fixture(), rejected = rejection(bad.stopChatgptText(identity, "server-conversation", bad.abort.signal)); await flush();
    bad.stop.resolve({ requestId: bad.request("chatgpt_text_stop").requestId, identity, status: "accepted", ...patch }); await failed(rejected);
  }
  const owner = fixture({ readIdentity: count => count === 1 ? identity : foreign }), denied = rejection(owner.stopChatgptText(identity, "server-conversation", owner.abort.signal)); await flush();
  owner.stop.resolve({ requestId: owner.request("chatgpt_text_stop").requestId, identity, status: "accepted" }); await failed(denied);
  const cancelled = fixture(), aborted = rejection(cancelled.stopChatgptText(identity, "server-conversation", cancelled.abort.signal)); await flush(); cancelled.abort.abort();
  cancelled.stop.resolve({ requestId: cancelled.request("chatgpt_text_stop").requestId, identity, status: "accepted" }); await failed(aborted);
  assert.ok(cancelled.calls.some(c => c.command === "chatgpt_service_cancel"));
});

test("complete history read retains raw graph and isolates project and temporary inputs", async () => {
  for (const projectId of [null, "g-custom", "g-p-real"]) {
    const h = fixture(), result = h.readChatgptConversation(identity, "server-history", { temporary: true, projectId }, h.abort.signal);
    await flush(); const request = h.request("chatgpt_conversation_history_read");
    assert.equal(request.conversationId, "server-history"); assert.equal(request.temporary, true);
    assert.equal(request.projectId, projectId === "g-p-real" ? projectId : null);
    const graph = { mapping: { root: { message: null, parent: null } }, current_node: "root", unknown: { preserved: true } };
    h.history.resolve({ requestId: request.requestId, identity, status: 200, body: graph });
    assert.equal(await result, graph); assert.equal(h.reads, 2);
    assert.equal(h.calls.filter(c => c.command !== "chatgpt_conversation_history_read").length, 0);
  }
});
test("history invalid/local ID, stale identity, cancellation and bad receipt never publish", async () => {
  for (const id of ["", "local-chatgpt:uuid", "../other", "server?query", "汉字"]) {
    const h = fixture(); await failed(rejection(h.readChatgptConversation(identity, id, {}, h.abort.signal))); assert.equal(h.calls.length, 0); assert.equal(h.reads, 0);
  }
  for (const scenario of ["request", "identity", "shape", "owner", "cancel", "http", "status"]) {
    const h = fixture(scenario === "owner" ? { readIdentity: count => count === 1 ? identity : foreign } : {});
    const result = rejection(h.readChatgptConversation(identity, "server-history", {}, h.abort.signal)); await flush();
    const request = h.request("chatgpt_conversation_history_read"); assert.equal(request.temporary, false);
    if (scenario === "cancel") h.abort.abort();
    if (scenario === "http") h.history.reject({ code: "http_error", status: 423, message: "locked" });
    else h.history.resolve({ requestId: scenario === "request" ? "other" : request.requestId,
      identity: scenario === "identity" ? foreign : identity, status: scenario === "status" ? 423 : 200,
      body: scenario === "shape" ? [] : { mapping: {}, current_node: null } });
    const error = await failed(result);
    if (scenario === "http") assert.equal(error.status, 423);
    if (scenario === "cancel") assert.ok(h.calls.some(c => c.command === "chatgpt_service_cancel"));
  }
});

test("ordinary list uses only safe offset and explicit project scope, retaining actual page metadata", async () => {
  for (const offset of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1, "20"]) {
    const h = fixture(); await failed(rejection(h.readChatgptConversations(identity, offset, false, h.abort.signal)));
    assert.equal(h.calls.length, 0); assert.equal(h.reads, 0);
  }
  for (const include of [false, true]) {
    const h = fixture(), result = h.readChatgptConversations(identity, 20, include, h.abort.signal); await flush();
    const request = h.request("chatgpt_conversation_list_read");
    assert.equal(request.offset, 20); assert.equal(request.includeProjectConversations, include);
    assert.equal(request.limit, undefined); assert.equal(request.cursor, undefined); assert.equal(request.isArchived, undefined);
    const page = { items: [], offset: 20, limit: 20, total: 55, metadata: { preserved: true } };
    h.list.resolve({ requestId: request.requestId, identity, status: 200, body: page });
    assert.equal(await result, page); assert.equal(h.reads, 2); assert.equal(h.calls.length, 1);
  }
});
test("list cancellation, stale owner, bad receipt and HTTP errors never become empty success", async () => {
  for (const scenario of ["cancel", "owner", "request", "identity", "status", "shape", "http"]) {
    const h = fixture(scenario === "owner" ? { readIdentity: count => count === 1 ? identity : foreign } : {});
    const result = rejection(h.readChatgptConversations(identity, 0, false, h.abort.signal)); await flush();
    const request = h.request("chatgpt_conversation_list_read");
    if (scenario === "cancel") h.abort.abort();
    if (scenario === "http") h.list.reject({ code: "http_error", status: 429, message: "retry later" });
    else h.list.resolve({ requestId: scenario === "request" ? "other" : request.requestId,
      identity: scenario === "identity" ? foreign : identity, status: scenario === "status" ? 500 : 200,
      body: scenario === "shape" ? [] : { items: [], offset: 0, limit: 20, total: 0 } });
    const error = await failed(result);
    if (scenario === "http") assert.equal(error.status, 429);
    if (scenario === "cancel") assert.ok(h.calls.some(c => c.command === "chatgpt_service_cancel"));
  }
});

let failures = 0;
for (const [name, run] of groups) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`ChatGPT text client: ${groups.length - failures}/${groups.length} groups passed; controlled Channel/DOM only, no native HTTP/model`);
process.exitCode = failures ? 1 : 0;
