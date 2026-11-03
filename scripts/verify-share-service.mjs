import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { accountId: "account", userId: "user", generation: 7 };
const preparation = { preparationId: "opaque-preparation", identity };
const publication = { shareId: "server-share", shareUrl: "https://chatgpt.com/share/server-share" };
const calls = [], disk = new Map(), exports = {};
let sequence = 0, pending, failure, publicationResult = publication;
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports, URL, Error, crypto: { randomUUID: () => `request-${++sequence}` },
  navigator: { userAgent: "Chrome/130.0", userAgentData: { brands: [{ brand: "Chromium", version: "130" }], platform: "Windows" } },
  localStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) },
  require: name => {
    assert.equal(name, "./bridge");
    return { tauriInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "chatgpt_service_cancel" || command === "share_thread_discard") return;
      if (failure) throw failure;
      if (pending) return new Promise(resolve => { pending.resolve = resolve; });
      if (command === "share_thread_prepare") return preparation;
      if (command === "share_thread_publish") return publicationResult;
      assert.fail(`unexpected command ${command}`);
    } };
  },
});
const signal = () => new AbortController().signal;
const json = '{"version":1,"turns":[]}';
const assets = [{ assetId: "asset-1", mimeType: "image/png", bytesBase64: "AQID" }];
assert.equal(await exports.prepareSharedThread("thread", json, assets, identity, signal()), preparation);
const request = calls.at(-1).args.request;
assert.equal(calls.at(-1).command, "share_thread_prepare");
assert.equal(request.hostId, "local");
assert.equal(request.threadId, "thread");
assert.equal(request.snapshot, json);
assert.equal(request.assets, assets);
assert.equal(request.expectedIdentity, identity);
assert.equal("upload_url" in request, false);
assert.equal("manifest" in request, false);
const audience = { access: "invited", principals: [{ principal_id: "account-user", principal_type: "user" }] };
assert.equal(await exports.publishSharedThread("thread", preparation, audience, signal()), publication);
const publish = calls.at(-1).args.request;
assert.equal(publish.preparationId, preparation.preparationId);
assert.equal(publish.expectedIdentity, identity);
assert.equal(publish.access, "invited");
assert.equal(publish.principals, audience.principals);
assert.equal("snapshot" in publish, false);
assert.equal("upload_url" in publish, false);
assert.equal("manifest" in publish, false);
await exports.discardSharedThread(preparation.preparationId, identity);
assert.equal(calls.at(-1).command, "share_thread_discard");

const cancelled = new AbortController(); cancelled.abort();
const before = calls.length;
await assert.rejects(exports.prepareSharedThread("thread", json, [], identity, cancelled.signal), /取消/);
assert.equal(calls.length, before);
const during = new AbortController();
pending = {};
const late = exports.prepareSharedThread("thread", json, [], identity, during.signal);
const inFlight = calls.at(-1).args.request;
during.abort();
assert.equal(calls.at(-1).command, "chatgpt_service_cancel");
assert.equal(calls.at(-1).args.requestId, inFlight.requestId);
pending.resolve(preparation);
await assert.rejects(late, /取消/);
assert.equal(calls.at(-1).command, "share_thread_discard", "a completed prepare arriving after close releases its manifest");
assert.equal(calls.at(-1).args.preparationId, preparation.preparationId);
pending = null;
failure = { code: "publish_unknown" };
const count = calls.length;
await assert.rejects(exports.publishSharedThread("thread", preparation, audience, signal()), error => error.code === "publish_unknown");
assert.equal(calls.length, count + 1, "renderer must not automatically retry an uncertain publish");
assert.match(exports.serviceErrorMessage(failure), /避免重复/);
failure = null;
for (const invalid of [
  {}, { shareId: "id", shareUrl: "http://example.invalid/share" },
  { shareId: "id", shareUrl: "https://user:password@example.invalid/share" },
]) {
  publicationResult = invalid;
  await assert.rejects(exports.publishSharedThread("thread", preparation, audience, signal()));
}
assert.ok(!JSON.stringify(calls).includes("getAuthStatus"), "credentials remain in the host");
const native = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
for (const command of ["share_thread_prepare", "share_thread_publish", "share_thread_discard"]) {
  assert.match(native, new RegExp(`fn ${command}\\(`));
  assert.match(native, new RegExp(`^\\s+${command},$`, "m"), "command must be registered");
}
console.log("PASS native share IPC/renderer contracts: fixed payloads, cancellation, late prepare cleanup, unknown publish and server URLs");
