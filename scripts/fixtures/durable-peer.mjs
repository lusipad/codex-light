// Disposable loopback peer. The adjacent public test key is only for untrusted-TLS negative tests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const expectedProtocols = "codex-app-server, codex-client.desktop, openai-bearer.fixture-only";
const metrics = { routes: [], upgraded: 0, redirects: 0, followed: 0, closed: 0, canceledPeers: 0,
  tlsRequests: 0, tlsConnections: 0, initialize: null, resume: null, serverCloseReply: null,
  session: { connections: 0, closed: 0, initializeCount: 0, capabilities: null, attestations: 0, models: [], maxClientLength: 0 } };
const server = http.createServer((request, response) => {
  if (request.url === "/metrics") {
    const body = JSON.stringify(metrics);
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "close" });
    response.end(body);
  } else {
    metrics.followed++;
    response.writeHead(400, { Connection: "close" }).end();
  }
});

function frame(payload, opcode = 1, final = true) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  let header;
  if (data.length < 126) header = Buffer.from([(final ? 0x80 : 0) | opcode, data.length]);
  else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = (final ? 0x80 : 0) | opcode; header[1] = 126; header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (final ? 0x80 : 0) | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function sessionPeer(socket) {
  const session = metrics.session;
  let resumeAttempt = 0;
  session.connections++;
  socket.on("close", () => { session.closed++; });
  socket.on("end", () => socket.end());
  const models = [];
  let initialize, attested = false;
  return message => {
    if (message.method === "initialize") {
      session.initializeCount++;
      assert.equal(session.initializeCount, 1);
      assert.equal(typeof message.id, "string");
      assert.equal(message.jsonrpc, undefined);
      assert.equal(message.params.clientInfo.name, "codex-tauri-native");
      assert.equal(message.params.clientInfo.title, "Codex Native");
      assert.ok(message.params.clientInfo.version);
      const caps = message.params.capabilities;
      assert.equal(caps.requestAttestation, true);
      assert.equal(caps.experimentalApi, true);
      assert.equal(caps.explicitGatewayOauth, false);
      assert.ok(caps.optOutNotificationMethods.includes("turn/diff/updated"));
      session.capabilities = caps;
      initialize = message;
      socket.write(Buffer.concat([
        frame({ method: "fixture/pre-initialize", params: { private: "must not emit" } }),
        frame({ id: "attestation-fixture", method: "attestation/generate", params: {} }),
      ]));
      return;
    }
    if (message.id === "attestation-fixture") {
      assert.ok(initialize);
      assert.equal(message.error, undefined);
      const token = message.result.token;
      assert.match(token, /^v1\.[A-Za-z0-9_-]+$/);
      const bundle = Buffer.from("com.codex.native.tauri");
      const expected = Buffer.concat([Buffer.from([0xa2, 0x6a]), Buffer.from("error_code"),
        Buffer.from([1, 0x69]), Buffer.from("bundle_id"), Buffer.from([0x60 + bundle.length]), bundle]);
      assert.deepEqual(Buffer.from(token.slice(3), "base64url"), expected);
      session.attestations++;
      attested = true;
      socket.write(frame({ id: initialize.id, result: { userAgent: "loopback-app-server", platformFamily: "windows" } }));
      return;
    }
    assert.ok(attested);
    if (message.method !== "model/list") {
      const threadId = "thread-fixture";
      const turnId = "turn-fixture";
      const operations = {
        "configRequirements/read": [undefined, { requirements: null }],
        "thread/name/set": [{ threadId, name: "编辑 fixture" }, {}],
        "thread/read": [{ threadId, includeTurns: false }, { thread: { id: threadId } }],
        "thread/list": [{ cursor: "page-token", limit: 100, archived: false, useStateDbOnly: true, sortKey: "updated_at" }, { data: [{ id: threadId }], nextCursor: null }],
        "thread/resume": [{ threadId, history: null, model: null, serviceTier: null, excludeTurns: true }, { thread: { id: threadId } }],
        "thread/turns/list": [{ threadId, limit: 5, cursor: null, sortDirection: "desc", itemsView: "notLoaded" }, { data: [{ id: turnId }], nextCursor: null }],
        "thread/items/list": [{ threadId, turnId, limit: 98, cursor: null, sortDirection: "desc" }, { data: [{ turnId, item: { id: "item-fixture" } }], nextCursor: null }],
      };
      assert.ok(Object.hasOwn(operations, message.method));
      assert.ok(message.id.startsWith(`${message.method}:`));
      const [expected, result] = operations[message.method];
      assert.deepEqual(message.params, expected);
      if (message.method === "thread/resume" && resumeAttempt < 2) {
        const closingThread = resumeAttempt++ === 0 ? "another-thread" : threadId;
        socket.write(frame({ id: message.id, error: {
          code: -32603, message: `thread ${closingThread} is closing; retry thread/resume after the thread is closed`,
        } }));
        return;
      }
      socket.write(frame({ id: message.id, result }));
      return;
    }
    assert.match(message.id, /^model\/list:/);
    assert.equal(message.params.limit, 100);
    assert.equal(message.params.includeHidden, true);
    assert.ok(message.params.cursor === null || typeof message.params.cursor === "string");
    session.models.push({ id: message.id, cursorLength: message.params.cursor?.length ?? 0,
      limit: message.params.limit, includeHidden: message.params.includeHidden });
    models.push(message);
    if (models.length === 2) {
      const replies = models.slice().reverse().map(request => frame({ id: request.id,
        result: { data: [{ id: request.params.cursor ?? "first-page" }], nextCursor: null } }));
      socket.write(Buffer.concat([
        frame({ method: "fixture/notice", params: { threadId: "thread-fixture", delta: "来自回环" } }),
        ...replies,
      ]));
    }
  };
}

server.on("upgrade", (request, socket) => {
  socket.on("error", () => {});
  metrics.routes.push(request.url);
  assert.equal(request.headers["sec-websocket-protocol"], expectedProtocols);
  assert.equal(request.headers["chatgpt-account-id"], "fixture-account");
  assert.equal(request.headers["x-openai-product-sku"], "codex");
  assert.equal(request.headers.originator, "Codex Desktop");
  assert.equal(request.headers.authorization, undefined);
  if (request.url === "/redirect") {
    metrics.redirects++;
    socket.end("HTTP/1.1 307 Temporary Redirect\r\nLocation: /forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    return;
  }
  if (request.url === "/forbidden") { metrics.followed++; socket.destroy(); return; }
  assert.ok(["/durable", "/cancel", "/timeout", "/abort", "/stall", "/bad-protocol", "/no-protocol",
    "/duplicate-protocol", "/alternate-protocol", "/server-close", "/session"].includes(request.url));
  if (request.url === "/stall") {
    socket.on("close", () => { metrics.canceledPeers++; });
    socket.on("end", () => socket.end());
    return;
  }
  if (request.url === "/durable") metrics.upgraded++;
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  const selected = request.url === "/bad-protocol" ? "other-protocol" : request.url === "/alternate-protocol" ? "codex-client.desktop" : "codex-app-server";
  const protocol = request.url === "/no-protocol" ? "" : `Sec-WebSocket-Protocol: ${selected}\r\n`.repeat(request.url === "/duplicate-protocol" ? 2 : 1);
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${protocol}\r\n`);
  if (request.url === "/server-close") {
    const reason = Buffer.from("隔离关闭");
    socket.write(Buffer.concat([Buffer.from([0x88, 2 + reason.length, 0x0f, 0xa1]), reason]));
  } else if (!["/durable", "/session"].includes(request.url)) {
    if (["/cancel", "/timeout", "/abort"].includes(request.url)) socket.on("close", () => { metrics.canceledPeers++; });
    socket.on("end", () => socket.end());
    return;
  }
  const onSessionMessage = request.url === "/session" ? sessionPeer(socket) : null;
  let buffered = Buffer.alloc(0);
  let fragments = [];
  socket.on("data", bytes => {
    buffered = Buffer.concat([buffered, bytes]);
    while (buffered.length >= 2) {
      let length = buffered[1] & 127, offset = 2;
      assert.ok(buffered[1] & 128);
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        const wideLength = buffered.readBigUInt64BE(2);
        assert.ok(wideLength <= 1024n * 1024n);
        length = Number(wideLength); offset = 10;
      }
      assert.ok(length <= 1024 * 1024);
      if (buffered.length < offset + 4 + length) return;
      const final = Boolean(buffered[0] & 0x80);
      const opcode = buffered[0] & 15;
      const mask = buffered.subarray(offset, offset + 4);
      const body = buffered.subarray(offset + 4, offset + 4 + length).map((byte, index) => byte ^ mask[index % 4]);
      buffered = buffered.subarray(offset + 4 + length);
      if (opcode === 8) {
        if (request.url === "/server-close") {
          metrics.serverCloseReply = { code: body.readUInt16BE(), reason: body.subarray(2).toString("utf8") };
          socket.end();
        } else {
          metrics.closed++;
          socket.end(Buffer.concat([Buffer.from([0x88, body.length]), body]));
        }
        continue;
      }
      if (opcode === 9) { socket.write(frame(body, 10)); continue; }
      assert.ok(opcode === 1 || opcode === 0);
      fragments.push(body);
      assert.ok(fragments.reduce((size, part) => size + part.length, 0) <= 1024 * 1024);
      if (!final) continue;
      const messageBytes = Buffer.concat(fragments);
      fragments = [];
      const message = JSON.parse(messageBytes.toString("utf8"));
      if (onSessionMessage) {
        metrics.session.maxClientLength = Math.max(metrics.session.maxClientLength, messageBytes.length);
        onSessionMessage(message);
        continue;
      }
      if (message.method === "thread/resume") {
        assert.deepEqual(message, { id: "resume:fixture", method: "thread/resume", params: { threadId: "thread-fixture" } });
        metrics.resume = message;
        const frames = [{ method: "item/agentMessage/delta", params: { delta: "通知" } },
          { id: "resume:fixture", result: { thread: { id: "thread-fixture" } } }].map(value => {
          const data = Buffer.from(JSON.stringify(value));
          return Buffer.concat([Buffer.from([0x81, data.length]), data]);
        });
        socket.write(Buffer.concat(frames));
        continue;
      }
      assert.deepEqual(message, { id: "__codex_initialize__", method: "initialize" });
      metrics.initialize = message;
      const payload = Buffer.from(JSON.stringify({ id: "__codex_initialize__", result: { label: "分段回执" } }));
      const split = payload.indexOf(Buffer.from("分")) + 1;
      socket.write(Buffer.concat([Buffer.from([1, split]), payload.subarray(0, split),
        Buffer.from([0x80, payload.length - split]), payload.subarray(split)]));
    }
  });
});

const tls = https.createServer({
  key: fs.readFileSync(new URL("./durable-test-key.pem", import.meta.url)),
  cert: fs.readFileSync(new URL("./durable-test-cert.pem", import.meta.url)),
});
tls.on("request", (_request, response) => { metrics.tlsRequests++; response.writeHead(400).end(); });
tls.on("upgrade", (_request, socket) => { metrics.tlsRequests++; socket.destroy(); });
tls.on("connection", () => { metrics.tlsConnections++; });
await Promise.all([server, tls].map(listener => new Promise(resolve => listener.listen(0, "127.0.0.1", resolve))));
console.log(JSON.stringify({ port: server.address().port, tlsPort: tls.address().port }));
