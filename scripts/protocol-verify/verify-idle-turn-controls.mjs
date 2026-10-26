// Real service boundary checks; isolated home, no authentication, no generation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-idle-controls-"));
const home = path.join(root, "home"), scratch = path.join(root, "workspace");
fs.mkdirSync(home); fs.mkdirSync(scratch);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
  shell: binary.endsWith(".cmd"), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
});
const transcript = [], notifications = [], pending = new Map();
let buffer = "", stderr = "", nextId = 1;
child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
child.stdout.setEncoding("utf8");
child.stdout.on("data", data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id != null && (message.result !== undefined || message.error !== undefined)) pending.get(message.id)?.(message);
    else if (message.method) notifications.push(message);
  }
});
function rpc(method, params) {
  assert.notEqual(method, "turn/start", "this probe must never start generation");
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, message => {
      clearTimeout(timer); pending.delete(id);
      transcript.push({ method, params, response: message }); resolve(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function result(message) { assert.ok(!message.error, JSON.stringify(message.error)); return message.result; }
let passed = false;
try {
  result(await rpc("initialize", { clientInfo: { name: "codex-native-idle-check", version: "0.1.0" }, capabilities: { experimentalApi: true } }));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const { thread } = result(await rpc("thread/start", { cwd: scratch, approvalPolicy: "on-request", sandbox: "read-only" }));
  result(await rpc("thread/inject_items", { threadId: thread.id, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Fixed idle-state probe. Do not generate." }] }] }));
  const historyBefore = result(await rpc("thread/turns/list", { threadId: thread.id }));
  const queueBefore = result(await rpc("thread/queue/list", { threadId: thread.id }));
  assert.equal(queueBefore.data.length, 0);
  console.log("PASS real thread starts idle with an empty queue");

  const steer = await rpc("turn/steer", { threadId: thread.id, expectedTurnId: "not-an-active-turn", clientUserMessageId: "idle-steer", input: [{ type: "text", text: "idle steer must fail" }] });
  assert.ok(steer.error, "idle Steer must reject");
  console.log(`PASS idle Steer rejects: ${steer.error.message}`);
  const interrupt = await rpc("turn/interrupt", { threadId: thread.id, turnId: "not-an-active-turn" });
  // Some server builds accept cancellation of an already-idle thread as a no-op.
  assert.ok(interrupt.error || JSON.stringify(interrupt.result) === "{}");
  console.log(`PASS idle interrupt returns ${interrupt.error ? `error: ${interrupt.error.message}` : "{} (no-op)"}`);
  const deleted = result(await rpc("thread/queue/delete", { threadId: thread.id, queuedSubmissionId: "missing-item" }));
  assert.equal(deleted.deleted, false);
  console.log("PASS deleting a missing queue item reports deleted:false");
  const start = await rpc("thread/queue/start", { threadId: thread.id, queuedSubmissionId: "missing-item" });
  assert.ok(start.error, "empty queue start must reject");
  console.log(`PASS empty queue start rejects: ${start.error.message}`);
  const historyAfter = result(await rpc("thread/turns/list", { threadId: thread.id }));
  const queueAfter = result(await rpc("thread/queue/list", { threadId: thread.id }));
  assert.deepEqual(historyAfter, historyBefore); assert.deepEqual(queueAfter, queueBefore);
  assert.equal(notifications.filter(event => event.method === "turn/started").length, 0);
  console.log("PASS boundary operations preserve history/queue and emit no turn/started");
  passed = true;
} finally {
  child.kill();
  fs.mkdirSync(".ref/protocol-probe", { recursive: true });
  fs.writeFileSync(".ref/protocol-probe/idle-turn-controls.json", JSON.stringify({ capturedAt: new Date().toISOString(), binary, isolatedHome: home, passed, transcript, notifications, ...(passed ? {} : { stderr }) }, null, 2));
}
