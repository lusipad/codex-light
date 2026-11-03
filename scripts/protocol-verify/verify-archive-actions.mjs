// Real isolated archive lifecycle; never authenticates or starts a model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-archive-actions-"));
const home = path.join(directory, "home");
const workspace = path.join(directory, "workspace");
for (const location of [home, workspace]) fs.mkdirSync(location);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
let child, buffer = "", nextId = 0, stderr = "", passed = false, failure = null;
const pending = new Map(), transcript = [], notifications = [], checks = [];
function rpc(method, params) {
  assert.notEqual(method, "turn/start", "this probe cannot generate model turns");
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, response => {
      clearTimeout(timer);
      pending.delete(id);
      transcript.push({ method, params, response });
      resolve(response);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function request(method, params) {
  const response = await rpc(method, params);
  assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => { child.once("exit", resolve); child.stdin.end(); });
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
async function archivedList() {
  let cursor = null;
  const rows = [], cursors = new Set();
  do {
    const page = await request("thread/list", {
      archived: true, cursor, limit: 1, sortKey: "updated_at",
    });
    assert.ok(Array.isArray(page.data));
    rows.push(...page.data);
    cursor = page.nextCursor;
    if (cursor != null) {
      assert.ok(!cursors.has(cursor), "archived list must not repeat cursor");
      cursors.add(cursor);
    }
  } while (cursor != null);
  return { rows, pageCount: cursors.size + 1 };
}
try {
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-8000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id != null) pending.get(message.id)?.(message);
      else if (message.method) notifications.push(message);
    }
  });
  await request("initialize", {
    clientInfo: { name: "codex-native-archive-actions-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const ids = [];
  for (let index = 0; index < 2; index++) {
    const { thread } = await request("thread/start", { cwd: workspace, approvalPolicy: "on-request", sandbox: "read-only" });
    ids.push(thread.id);
    // Persist a rollout with a fixture message, without asking any model to execute.
    await request("thread/inject_items", {
      threadId: thread.id,
      items: [{ type: "message", role: "user", content: [{ type: "input_text", text: `Offline archive fixture ${index}.` }] }],
    });
    await request("thread/archive", { threadId: thread.id });
  }
  const archived = await archivedList();
  assert.deepEqual(new Set(archived.rows.map(thread => thread.id)), new Set(ids));
  assert.ok(archived.pageCount >= 2, "limit 1 must exercise multiple archived pages");
  check("two real archived rollouts are reachable through cursor pagination");
  await request("thread/unarchive", { threadId: ids[0] });
  assert.deepEqual((await archivedList()).rows.map(thread => thread.id), [ids[1]]);
  const restored = await request("thread/read", { threadId: ids[0], includeTurns: true });
  assert.equal(restored.thread.id, ids[0]);
  assert.equal(restored.thread.cwd, workspace);
  assert.ok(restored.thread.path.startsWith(path.join(home, "sessions") + path.sep));
  assert.ok(fs.existsSync(restored.thread.path), "restored rollout exists in active sessions");
  // Injected messages need not produce persisted model turns. Do not infer content
  // preservation from a non-model fixture; the lifecycle proof is the real path/read.
  check("unarchive removes only its row and real rollout is readable in active sessions");
  await request("thread/archive", { threadId: ids[0] });
  assert.equal((await archivedList()).rows.length, 2);
  await request("thread/delete", { threadId: ids[0] });
  assert.deepEqual((await archivedList()).rows.map(thread => thread.id), [ids[1]]);
  const deletedRead = await rpc("thread/read", { threadId: ids[0], includeTurns: false });
  assert.ok(deletedRead.error, "deleted rollout must no longer be readable");
  assert.equal((await request("thread/read", { threadId: ids[1], includeTurns: false })).thread.id, ids[1]);
  check("permanent delete removes archived rollout while preserving the other one");
  assert.ok(!notifications.some(event => event.method === "turn/started"));
  check("zero model turns");
  passed = true;
} catch (error) {
  failure = String(error?.stack || error);
  throw error;
} finally {
  await stop();
  const output = process.env.ARCHIVE_ACTIONS_PROBE_OUTPUT || ".ref/protocol-probe/archive-actions.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(), isolatedHome: home,
    passed, failure, checks, transcript, notifications, stderr,
    scope: "real isolated CLI archive lifecycle; not Tauri record persistence, official UI, or pixel parity",
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
