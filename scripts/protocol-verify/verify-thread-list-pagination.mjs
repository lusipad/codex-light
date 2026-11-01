// Explicit rollout replay fixtures read by the real CLI; no model generation or authentication.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sidebar-pagination-"));
let activeHome = home;
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const pending = new Map(), transcript = [], notifications = [];
let buffer = "", nextId = 1, stderr = "", passed = false;
let child;
function startServer() {
  child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    shell: binary.endsWith(".cmd"), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME: activeHome, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
  });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id != null) pending.get(message.id)?.(message);
      else if (message.method) notifications.push(message.method);
    }
  });
}
function rpc(method, params) {
  assert.notEqual(method, "turn/start", "probe must never request generation");
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, message => {
      clearTimeout(timer); pending.delete(id); transcript.push({ method, params, response: message });
      if (message.error) reject(Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
try {
  startServer();
  await rpc("initialize", { clientInfo: { name: "codex-native-sidebar-pagination", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const created = [];
  const fixtureText = "Fixed sidebar replay fixture. No model generation requested.";
  for (let i = 1; i <= 28; i++) {
    const { thread } = await rpc("thread/start", { cwd: process.cwd(), approvalPolicy: "on-request", sandbox: "read-only" });
    created.push(thread.id);
    await rpc("thread/inject_items", { threadId: thread.id, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: fixtureText }] }] });
    await rpc("thread/name/set", { threadId: thread.id, name: `01B list sample ${String(i).padStart(2, "0")}` });
    // inject_items supplies model context, not a visible user event. Seed a clearly
    // identified replay event only in this probe's own rollout, then let the real
    // CLI repair/index it. This does not test genuine conversation generation.
    assert.ok(path.resolve(thread.path).startsWith(path.resolve(home) + path.sep));
    fs.appendFileSync(thread.path, JSON.stringify({
      timestamp: new Date().toISOString(), type: "event_msg",
      payload: { type: "user_message", message: fixtureText, images: [], local_images: [], text_elements: [] },
    }) + "\n");
  }
  // Index a cold replay corpus rather than modifying the live state database.
  await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
  activeHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sidebar-replay-"));
  fs.cpSync(path.join(home, "sessions"), path.join(activeHome, "sessions"), { recursive: true });
  buffer = "";
  startServer();
  await rpc("initialize", { clientInfo: { name: "codex-native-sidebar-replay-reader", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  await rpc("thread/list", { limit: 100, useStateDbOnly: false });
  for (let i = 0; i < created.length; i++) {
    await rpc("thread/name/set", { threadId: created[i], name: `01B list sample ${String(i + 1).padStart(2, "0")}` });
  }
  const seen = new Set(), cursors = new Set();
  let cursor = null, pages = 0;
  do {
    const response = await rpc("thread/list", { limit: 3, archived: false, sortKey: "updated_at", sortDirection: "desc", useStateDbOnly: true, ...(cursor !== null ? { cursor } : {}) });
    assert.ok(Array.isArray(response.data)); assert.ok(response.data.length <= 3);
    for (const thread of response.data) { assert.ok(!seen.has(thread.id), "real pages must not repeat rows"); seen.add(thread.id); }
    cursor = response.nextCursor ?? null;
    if (cursor !== null) { assert.ok(!cursors.has(cursor)); cursors.add(cursor); }
    pages++;
  } while (cursor !== null);
  assert.ok(pages > 1); assert.equal(seen.size, created.length);
  assert.ok(created.every(id => seen.has(id)));
  assert.ok(!notifications.includes("turn/started"));
  passed = true;
  console.log(`PASS real CLI cursor traversal of replay fixtures: ${seen.size} threads over ${pages} pages; zero turn/started`);
  console.log(`Isolated native fixture CODEX_HOME: ${activeHome}`);
} finally {
  child.kill();
  fs.mkdirSync(".ref/protocol-probe", { recursive: true });
  fs.writeFileSync(".ref/protocol-probe/thread-list-pagination.json", JSON.stringify({ capturedAt: new Date().toISOString(), fixtureKind: "explicit-offline-rollout-replay-not-generated-conversations", binary, home: activeHome, seedHome: home, passed, transcript, notifications, stderr }, null, 2));
}
