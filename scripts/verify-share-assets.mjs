import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const LIMIT = 25 * 1024 * 1024;
const identity = { accountId: "account-a", userId: "user-a", generation: 3 };
const candidate = (source, kind = "image") => ({ source, kind });
const context = signal => ({ thread: { id: "thread-a", cwd: "D:/untrusted", turns: [] }, signal });
const calls = [];
let safe = true, response, host, bitmap;
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shareAssetReader.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: module.exports, Error, Uint8Array, Blob,
  fetch: async (...args) => { calls.push(["fetch", ...args]); return response; },
  createImageBitmap: async value => { calls.push(["bitmap", value]); return bitmap; },
  require: name => name === "./bridge" ? {
    tauriInvoke: async (...args) => { calls.push(["host", ...args]); return host; },
  } : name === "./chatgptService" ? {
    sharedImageUrlSafe: async (...args) => { calls.push(["safe", ...args]); return safe; },
  } : name === "./fsClient" ? {
    base64ToBytes: value => new Uint8Array(Buffer.from(value, "base64")),
  } : assert.fail(`Unexpected import ${name}`),
});
const read = module.exports.createShareAssetReader(identity);
const controller = () => new AbortController();
function setup(chunks = [new Uint8Array([1, 2, 3])], headers = {}, ok = true) {
  calls.length = 0; safe = true;
  let index = 0, cancelled = 0, released = 0, closed = 0;
  const reader = {
    async read() { return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
    async cancel() { cancelled++; }, releaseLock() { released++; },
  };
  response = { ok, headers: new Headers({ "content-type": "image/png", ...headers }), body: {
    getReader: () => reader, async cancel() { cancelled++; },
  } };
  bitmap = { width: 23, height: 17, close() { closed++; } };
  return { reader, get cancelled() { return cancelled; }, get released() { return released; }, get closed() { return closed; } };
}
let tracked = setup(); safe = false;
assert.equal(await read(candidate("https://example.invalid/image.png"), context(controller().signal)), null);
assert.deepEqual(calls.map(call => call[0]), ["safe"], "unsafe URLs must not fetch, decode or call host");
tracked = setup();
const signal = controller().signal;
const image = await read(candidate("https://example.invalid/image.png"), context(signal));
assert.equal(image.width, 23); assert.equal(image.height, 17); assert.equal(image.bytes.length, 3);
assert.equal(tracked.closed, 1); assert.equal(tracked.cancelled, 1); assert.equal(tracked.released, 1);
assert.equal(calls[0][1], "https://example.invalid/image.png"); assert.deepEqual(calls[0][2], identity);
assert.deepEqual(JSON.parse(JSON.stringify(calls[1][2], (key, value) => key === "signal" ? undefined : value)), { credentials: "omit", redirect: "error" });
assert.equal(calls[1][2].signal, signal);
for (const headers of [
  { "content-length": String(LIMIT + 1) }, { "content-length": "-1" },
  { "content-length": "not-a-length" }, { "content-type": "text/html" },
]) {
  tracked = setup([], headers);
  assert.equal(await read(candidate("https://example.invalid/image.png"), context(controller().signal)), null);
  assert.equal(tracked.cancelled, 1); assert.equal(tracked.released, 0);
  assert.equal(calls.some(call => call[0] === "bitmap"), false);
}
tracked = setup([new Uint8Array(LIMIT), new Uint8Array([1])]);
assert.equal(await read(candidate("https://example.invalid/image.png"), context(controller().signal)), null);
assert.equal(tracked.cancelled, 1); assert.equal(tracked.released, 1);
assert.equal(calls.some(call => call[0] === "bitmap"), false);
tracked = setup([]);
assert.equal(await read(candidate("https://example.invalid/image.png"), context(controller().signal)), null);
assert.equal(tracked.released, 1);
tracked = setup([], {}, false);
assert.equal(await read(candidate("https://example.invalid/image.png"), context(controller().signal)), null);
assert.equal(tracked.cancelled, 1);

tracked = setup(); const early = controller(); early.abort();
await assert.rejects(read(candidate("https://example.invalid/image.png"), context(early.signal)), /abort/i);
assert.deepEqual(calls, []);
tracked = setup(); let resolveSafe; safe = new Promise(resolve => { resolveSafe = resolve; });
const lateSafeController = controller();
const lateSafe = read(candidate("https://example.invalid/image.png"), context(lateSafeController.signal));
lateSafeController.abort(); resolveSafe(true);
await assert.rejects(lateSafe, /abort/i); assert.deepEqual(calls.map(call => call[0]), ["safe"]);
tracked = setup(); let resolveChunk;
tracked.reader.read = () => new Promise(resolve => { resolveChunk = resolve; });
const chunkController = controller();
const lateChunk = read(candidate("https://example.invalid/image.png"), context(chunkController.signal));
while (!resolveChunk) await Promise.resolve();
chunkController.abort(); resolveChunk({ done: false, value: new Uint8Array([1]) });
await assert.rejects(lateChunk, /abort/i);
assert.equal(tracked.cancelled, 1); assert.equal(tracked.released, 1);
tracked = setup(); let resolveBitmap;
bitmap = new Promise(resolve => { resolveBitmap = resolve; });
const bitmapController = controller();
const lateBitmap = read(candidate("data:image/png;base64,AQID"), context(bitmapController.signal));
await Promise.resolve(); bitmapController.abort();
let closedLate = 0; resolveBitmap({ width: 4, height: 5, close() { closedLate++; } });
await assert.rejects(lateBitmap, /abort/i); assert.equal(closedLate, 1, "late bitmap must be released on cancellation");

setup(); host = { dataBase64: "AQID", mimeType: "application/octet-stream" };
const html = await read(candidate("visualizations/chart.html", "visualization"), context(controller().signal));
assert.equal(html.bytes.length, 3); assert.equal(calls[0][0], "host");
assert.equal(calls[0][1], "share_thread_asset_read");
assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), {
  expectedIdentity: identity, hostId: "local", threadId: "thread-a",
  kind: "visualization", source: "visualizations/chart.html",
}, "host must receive real thread identity, never renderer cwd authority");
assert.equal(calls.some(call => call[0] === "bitmap" || call[0] === "fetch"), false);
setup(); let resolveHost; host = new Promise(resolve => { resolveHost = resolve; });
const hostController = controller(), lateHost = read(candidate("local.png"), context(hostController.signal));
hostController.abort(); resolveHost({ dataBase64: "AQID", mimeType: "image/png" });
await assert.rejects(lateHost, /abort/i); assert.equal(calls.some(call => call[0] === "bitmap"), false);
setup();
for (const source of ["data:text/html;base64,AQID", "data:image/png;base64,", "data:image/png;base64,!!!!"]) {
  assert.equal(await read(candidate(source), context(controller().signal)), null);
}
assert.deepEqual(calls, []);
// Static IPC wiring only: this does not execute Rust, the native handler, or real identity reads.
const rust = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const handlerStart = rust.indexOf("async fn share_thread_asset_read(");
const handlerEnd = rust.indexOf("\nfn share_system_version(", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "locate the production asset IPC handler");
const handler = rust.slice(handlerStart, handlerEnd);
const identityRead = handler.indexOf("state.chatgpt_service.identity(");
const identityGuard = handler.indexOf("if identity != expected_identity");
const threadRead = handler.indexOf('"thread/read"');
const localRead = handler.indexOf("share_assets::read_local_share_asset(");
assert.ok(identityRead >= 0 && identityGuard > identityRead && threadRead > identityGuard && localRead > threadRead,
  "static IPC wiring must read and compare the full service identity before thread metadata and local asset reads");
console.log("PASS production share assets: URL safety, credential-free fetch, bounded streams, cancellation, host identity and bitmap release");
console.log("PASS static asset IPC wiring: full service identity comparison precedes thread/read and local file access (not native execution)");
